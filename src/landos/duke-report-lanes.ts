// Default Duke Report Source Lanes v1.
//
// A lean, token-efficient, structured orchestration layer for the default Duke
// dashboard report. It turns a LandPortal verification outcome into a set of
// typed "source lanes" with a single Verification Captain decision, so a slow
// LandPortal call (up to a 3-minute ceiling) NEVER collapses the whole report
// into a thin failure message.
//
// Pure module: no network, no agent, no tokens, no comp credits. The caller
// runs the LandPortal lane (exact search) and passes its normalized outcome in.
//
// Verification authority is STRICT and exact-only:
//   - Only the LandPortal lane (and, when implemented, official county/assessor/
//     GIS exact records) can verify parcel identity.
//   - Local Area Data, Redfin/Zillow, and LandWatch can NEVER verify identity.
//   - No coordinates/geocoder/proximity/point/map-pin/visual verification.
//   - If identity is not verified: label is "Local Area Context, Not Parcel
//     Verified" and comps/score/valuation/offer/strategy are blocked.

import type { CompMode } from './duke-report-runner.js';
import { STRATEGIES, GLOBAL_MIN_NET_PROFIT_USD, SUBDIVISION_MIN_NET_PROFIT_USD } from './offer-engine.js';

/** LandPortal exact-search verification ceiling for the default report. */
export const LANDPORTAL_VERIFICATION_TIMEOUT_MS = 3 * 60 * 1000;
/** LandWatch lane only runs for verified parcels strictly over this acreage. */
export const LANDWATCH_MIN_ACRES = 50;
export const LOCAL_AREA_NOT_VERIFIED_LABEL = 'Local Area Context, Not Parcel Verified';

/** Shown when a market count cannot be pulled from any default source. */
export const MARKET_COUNT_UNAVAILABLE_SOURCE = 'unavailable from current default sources';

/**
 * Preferred source order for land-specific active/sold counts. Redfin and Zillow
 * are tried first when the workflow supports them; otherwise a clearly-labeled
 * better local/public land source may be used (never blended silently, never
 * relabeled as Redfin/Zillow). These sources are MARKET CONTEXT ONLY and can
 * never verify parcel identity.
 */
export const MARKET_COUNT_SOURCE_PRIORITY = [
  'Redfin',
  'Zillow',
  'local MLS public search',
  'county/local public listing portal',
  'Realtor.com land search',
  'LandWatch market listings',
] as const;

/** A land-listing count with the source it came from. count === null => unavailable. */
export interface MarketCount {
  /** Land-specific count, or null when unavailable. Never a home/housing count. */
  count: number | null;
  /** Source name for the count, or the unavailable-source label when count is null. */
  source: string;
  /** True only when the count deliberately blends multiple sources (all listed). */
  blended?: boolean;
  /** Every source that fed a blended count (required when blended === true). */
  blendedSources?: string[];
}

/** Annual growth context for the local area. Labeled by TYPE and source; never a bare number. */
export interface AnnualGrowth {
  /** Percent (e.g. 1.8 for 1.8%), or null when unavailable. */
  value: number | null;
  /** What the number means. 'unavailable' when value is null. */
  type: 'population' | 'market_price' | 'unavailable';
  /** Source/status label, e.g. "Census / cached source" or the unavailable label. */
  source: string;
}

/** A single sold-land record (context only). Used to compute median price per
 *  acre, the price-per-acre range, and acre-band buckets. Pure: nothing fetched.
 *  Never used to verify parcel identity. */
export interface LandSoldRecord {
  acres: number;
  pricePerAcre: number;
  source?: string;
  /** How many months ago it sold (used to bucket 6mo vs 12mo windows). */
  monthsAgo?: number;
}

/** Optional, caller-supplied local market data for the Local Area Data lane.
 *  Everything defaults to clearly-labeled "unavailable" — the pure lane never
 *  fetches anything and never invents a count. */
export interface LocalAreaMarketInput {
  activeLandListings?: MarketCount;
  soldLandLast6Months?: MarketCount;
  /** 12-month sold count, used as a fallback when the 6-month sample is thin. */
  soldLandLast12Months?: MarketCount;
  annualGrowth?: AnnualGrowth;
  /** Raw sold-land records for computing $/acre median, range, and acre bands. */
  soldRecords?: LandSoldRecord[];
}

/** Minimum usable sold sample (records with a real $/acre) for a PASS verdict. */
export const MARKET_SUPPORT_MIN_SOLD_PASS = 5;

export type MarketSupportVerdict = 'PASS' | 'THIN' | 'FAIL';

/** Acre bands for bucketing sold $/acre where data exists. */
export const ACRE_BANDS: ReadonlyArray<{ label: string; min: number; max: number }> = [
  { label: '0-1 ac', min: 0, max: 1 },
  { label: '1-5 ac', min: 1, max: 5 },
  { label: '5-10 ac', min: 5, max: 10 },
  { label: '10-20 ac', min: 10, max: 20 },
  { label: '20-50 ac', min: 20, max: 50 },
  { label: '50+ ac', min: 50, max: Infinity },
];

export interface LocalMarketSupport {
  verdict: MarketSupportVerdict;
  reason: string;
  activeCount: number | null;
  soldCount6: number | null;
  soldCount12: number | null;
  medianPpa: number | null;
  ppaMin: number | null;
  ppaMax: number | null;
  /** Per-band median $/acre + count, only for bands that have data. */
  bands: Array<{ label: string; count: number; medianPpa: number }>;
  ppaSource: string;
}

function medianOf(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Compute a decision-grade local market-support read from caller-supplied
 * context. Pure: it fetches nothing and invents nothing. Verdict rules:
 *   FAIL — no usable active-listing OR sold data from approved sources.
 *   THIN — some data, but the usable sold sample is below the PASS threshold.
 *   PASS — usable sold sample (records carrying a real $/acre) >= the threshold.
 * $/acre median, range, and acre bands are computed ONLY from real sold records;
 * they are never derived from coordinates, proximity, or the subject parcel.
 */
export function computeLocalMarketSupport(market: LocalAreaMarketInput | null | undefined): LocalMarketSupport {
  const active = normCount(market?.activeLandListings);
  const sold6 = normCount(market?.soldLandLast6Months);
  const sold12 = normCount(market?.soldLandLast12Months);
  const records = (market?.soldRecords ?? []).filter(
    r => Number.isFinite(r.acres) && r.acres > 0 && Number.isFinite(r.pricePerAcre) && r.pricePerAcre > 0,
  );

  const ppas = records.map(r => r.pricePerAcre);
  const medianPpa = ppas.length ? Math.round(medianOf(ppas)) : null;
  const ppaMin = ppas.length ? Math.round(Math.min(...ppas)) : null;
  const ppaMax = ppas.length ? Math.round(Math.max(...ppas)) : null;
  const ppaSource = records.find(r => r.source?.trim())?.source?.trim()
    ?? (ppas.length ? 'supplied sold records' : MARKET_COUNT_UNAVAILABLE_SOURCE);

  const bands = ACRE_BANDS.map(b => {
    const inBand = records.filter(r => r.acres >= b.min && r.acres < b.max);
    return { label: b.label, count: inBand.length, medianPpa: inBand.length ? Math.round(medianOf(inBand.map(r => r.pricePerAcre))) : 0 };
  }).filter(b => b.count > 0);

  // Effective usable sold sample: prefer the real $/acre-bearing records; else a
  // supplied 6mo, else a supplied 12mo count.
  const usableSold = records.length || (sold6.count ?? 0) || (sold12.count ?? 0);
  const hasAnyData = active.count !== null || sold6.count !== null || sold12.count !== null || records.length > 0;

  let verdict: MarketSupportVerdict;
  let reason: string;
  if (!hasAnyData) {
    verdict = 'FAIL';
    reason = 'no usable local sold/listing data available from approved sources';
  } else if (records.length >= MARKET_SUPPORT_MIN_SOLD_PASS) {
    verdict = 'PASS';
    reason = `${records.length} usable sold records with $/acre (>= ${MARKET_SUPPORT_MIN_SOLD_PASS}); median and range computed from real solds`;
  } else {
    verdict = 'THIN';
    reason = `usable sold sample is weak (${usableSold} sold, ${records.length} with $/acre; need >= ${MARKET_SUPPORT_MIN_SOLD_PASS} priced solds for PASS)`;
  }

  return {
    verdict, reason,
    activeCount: active.count, soldCount6: sold6.count, soldCount12: sold12.count,
    medianPpa, ppaMin, ppaMax, bands, ppaSource,
  };
}

export type LaneStatus = 'success' | 'blocked' | 'timeout' | 'not_available' | 'skipped' | 'failed';
export type LaneSourceType = 'landportal' | 'local_area' | 'verification' | 'redfin_zillow' | 'landwatch' | 'strategy';

export interface DukeLaneResult {
  laneId: string;
  laneName: string;
  status: LaneStatus;
  sourceType: LaneSourceType;
  /** Whether this source TYPE is ever allowed to verify parcel identity. */
  canVerifyParcel: boolean;
  /** Whether this lane acts as a verification authority in this run. */
  parcelVerificationAuthority: boolean;
  /** Whether this lane actually verified parcel identity. */
  verifiedParcelIdentity: boolean;
  findings: string[];
  warnings: string[];
  blockingReason: string | null;
  nextAction: string | null;
  durationMs?: number;
  /** Always false by default; the default report never spends a comp credit. */
  compCreditUsed: boolean;
}

export interface LandPortalLaneInput {
  /** Normalized LandPortal verification outcome from lpResolveForPreflight. */
  status: 'success' | 'timeout' | 'not_verified' | 'multiple_candidates' | 'error';
  verified: boolean;
  durationMs?: number;
  /** e.g. "APN 08-2518, FIPS 37061" when verified. Never coordinates. */
  identitySummary?: string | null;
  reason?: string | null;
}

export interface DukeReportLanesInput {
  landPortal: LandPortalLaneInput;
  compMode: CompMode;
  /** County/state anchor from the operator input (local context only). */
  localAreaAnchor?: string | null;
  /** Optional market data for the Local Area Data snapshot (context only).
   *  Omitted/partial fields render as clearly-labeled "unavailable". */
  localAreaMarket?: LocalAreaMarketInput | null;
  /** Verified parcel acreage when known (for the LandWatch > 50 ac gate). */
  acres?: number | null;
}

export interface DukeReportLanes {
  parcelVerified: boolean;
  parcelIdentitySummary: string | null;
  /** Exactly "Local Area Context, Not Parcel Verified" when unverified, else null. */
  unverifiedLabel: string | null;
  lanes: DukeLaneResult[];
  compCreditUsed: boolean;
  nextAction: string;
  /** Compact one-line report summary (structured, not a long essay). */
  summary: string;
}

function lane(partial: Partial<DukeLaneResult> & Pick<DukeLaneResult, 'laneId' | 'laneName' | 'status' | 'sourceType'>): DukeLaneResult {
  return {
    canVerifyParcel: false,
    parcelVerificationAuthority: false,
    verifiedParcelIdentity: false,
    findings: [],
    warnings: [],
    blockingReason: null,
    nextAction: null,
    compCreditUsed: false,
    ...partial,
  };
}

function sourceRank(source: string): number {
  const i = MARKET_COUNT_SOURCE_PRIORITY.findIndex(s => s.toLowerCase() === source.trim().toLowerCase());
  return i === -1 ? MARKET_COUNT_SOURCE_PRIORITY.length : i;
}

/**
 * Pick the single best-ranked REAL land count from supplied candidates, honoring
 * the Redfin > Zillow > local/public > other order. Candidates with a null/NaN
 * count are dropped — this never invents a count and never blends. Returns an
 * unavailable MarketCount when nothing usable was supplied. Pure.
 */
export function selectPreferredMarketCount(
  candidates: ReadonlyArray<{ source: string; count: number | null }>,
): MarketCount {
  const valid = candidates.filter(
    c => typeof c.count === 'number' && Number.isFinite(c.count) && c.count >= 0 && !!c.source.trim(),
  );
  if (!valid.length) return { count: null, source: MARKET_COUNT_UNAVAILABLE_SOURCE };
  valid.sort((a, b) => sourceRank(a.source) - sourceRank(b.source));
  return { count: valid[0].count, source: valid[0].source.trim() };
}

/** Normalize a possibly-missing MarketCount to an explicit unavailable record. */
function normCount(c: MarketCount | undefined): MarketCount {
  if (c && typeof c.count === 'number' && Number.isFinite(c.count) && c.count >= 0) return c;
  return { count: null, source: MARKET_COUNT_UNAVAILABLE_SOURCE };
}

/** Render one count + its source as two findings lines (count line, source line). */
function countLines(label: string, c: MarketCount): [string, string] {
  if (c.count === null) {
    return [`${label}: unavailable`, `${label} source: ${MARKET_COUNT_UNAVAILABLE_SOURCE}`];
  }
  const blended = c.blended && c.blendedSources?.length;
  const countText = blended ? `${c.count} (blended count)` : `${c.count}`;
  const sourceText = blended ? `blended — ${c.blendedSources!.join(', ')}` : c.source.trim();
  return [`${label}: ${countText}`, `${label} source: ${sourceText}`];
}

/** Render the annual-growth line, always labeling TYPE and source (never bare). */
function growthLine(g: AnnualGrowth | undefined): string {
  if (!g || g.value === null || g.type === 'unavailable' || !Number.isFinite(g.value as number)) {
    return `Annual growth: unavailable | Source: ${MARKET_COUNT_UNAVAILABLE_SOURCE}`;
  }
  const kind = g.type === 'population' ? 'Annual population growth' : 'Annual market price growth';
  return `${kind}: ${g.value}% | Source: ${g.source.trim() || MARKET_COUNT_UNAVAILABLE_SOURCE}`;
}

/**
 * Build the compact Local Area Data lane (unverified market snapshot). Pure
 * string assembly over caller-supplied context — it fetches nothing, invents no
 * count, scores/values/offers nothing, and never verifies identity. Every count
 * carries a source; missing data is labeled "unavailable", not guessed.
 */
function buildLocalAreaLane(
  parcelVerified: boolean,
  anchor: string | null,
  market: LocalAreaMarketInput | null | undefined,
): DukeLaneResult {
  const hasAnchor = !!(anchor && anchor.trim());
  const areaText = hasAnchor ? anchor!.trim() : 'not provided';

  // Verified parcels show the real parcel block elsewhere; keep this lane terse.
  if (parcelVerified) {
    return lane({
      laneId: 'local_area_data', laneName: 'Local Area Data', sourceType: 'local_area',
      canVerifyParcel: false,
      status: hasAnchor ? 'success' : 'not_available',
      findings: hasAnchor ? [`Local area: ${areaText}`] : [],
      nextAction: 'For assessor/tax/GIS/zoning/utilities detail, run a County Deep Dive (on demand) — not part of the Duke Report.',
    });
  }

  // Unverified with no anchor: nothing to anchor market context to. With no
  // anchor and no data, local market support is FAIL (never neutral).
  if (!hasAnchor) {
    return lane({
      laneId: 'local_area_data', laneName: 'Local Area Data', sourceType: 'local_area',
      canVerifyParcel: false,
      status: 'not_available',
      findings: [
        LOCAL_AREA_NOT_VERIFIED_LABEL,
        'Local Market Support: FAIL',
        'Local Market Support reason: no county/state anchor and no usable local sold/listing data available from approved sources',
      ],
      nextAction: 'Provide a county/state anchor for local market context, then verify parcel identity via exact APN, address, or owner in an official county or LandPortal source.',
    });
  }

  // Unverified WITH an anchor: emit the compact market snapshot.
  const active = normCount(market?.activeLandListings);
  const sold = normCount(market?.soldLandLast6Months);
  const [activeCountLine, activeSourceLine] = countLines('Active land listings', active);
  const [soldCountLine, soldSourceLine] = countLines('Land sold last 6 months', sold);

  const haveActive = active.count !== null;
  const haveSold = sold.count !== null;
  const sourceStatus: 'success' | 'partial' | 'not_available' =
    haveActive && haveSold ? 'success' : (haveActive || haveSold) ? 'partial' : 'not_available';

  const marketRead = (haveActive || haveSold)
    ? `${areaText}: ${haveActive ? `${active.count} active` : 'active count unavailable'}, ${haveSold ? `${sold.count} sold in the last 6 months` : 'sold count unavailable'} (land listings, market context only — parcel not verified).`
    : `Land market counts for ${areaText} are unavailable from current default sources. Treat as context only; no parcel was verified.`;

  // ── Decision-grade market-support read (PASS / THIN / FAIL) ─────────────────
  const support = computeLocalMarketSupport(market);
  const sold12 = normCount(market?.soldLandLast12Months);
  const [sold12CountLine, sold12SourceLine] = countLines('Land sold last 12 months', sold12);
  const ppaMedianLine = support.medianPpa !== null
    ? `Median sold price per acre: $${support.medianPpa.toLocaleString('en-US')}/ac | Source: ${support.ppaSource}`
    : `Median sold price per acre: unavailable | Source: ${MARKET_COUNT_UNAVAILABLE_SOURCE}`;
  const ppaRangeLine = support.ppaMin !== null && support.ppaMax !== null
    ? `Sold price per acre range: $${support.ppaMin.toLocaleString('en-US')}–$${support.ppaMax.toLocaleString('en-US')}/ac | Source: ${support.ppaSource}`
    : `Sold price per acre range: unavailable | Source: ${MARKET_COUNT_UNAVAILABLE_SOURCE}`;
  const bandLine = support.bands.length
    ? `Acre-band buckets: ${support.bands.map(b => `${b.label}: ${b.count} sold, median $${b.medianPpa.toLocaleString('en-US')}/ac`).join('; ')}`
    : `Acre-band buckets: unavailable (no usable sold $/acre records)`;

  return lane({
    laneId: 'local_area_data', laneName: 'Local Area Data', sourceType: 'local_area',
    canVerifyParcel: false,
    status: 'success', // the lane successfully produced compact context
    findings: [
      LOCAL_AREA_NOT_VERIFIED_LABEL,
      `Area: ${areaText}`,
      growthLine(market?.annualGrowth),
      activeCountLine,
      activeSourceLine,
      soldCountLine,
      soldSourceLine,
      sold12CountLine,
      sold12SourceLine,
      ppaMedianLine,
      ppaRangeLine,
      bandLine,
      `Market read: ${marketRead}`,
      `Source status: ${sourceStatus}`,
      `Local Market Support: ${support.verdict}`,
      `Local Market Support reason: ${support.reason}`,
    ],
    warnings: [
      'Local Area, Redfin/Zillow, and other market sources are context only and can never verify parcel identity.',
      ...(support.verdict === 'FAIL' ? ['Local Market Support: FAIL — no usable local sold/listing data; market support is not decision-grade.'] : []),
    ],
    nextAction: 'Verify parcel identity via exact APN, address, or owner in an official county or LandPortal source. For market counts run market scout or a manual Redfin/Zillow check; for assessor/tax/GIS/zoning detail run a County Deep Dive (on demand).',
  });
}

/**
 * Build the default Duke Report source lanes from a LandPortal verification
 * outcome. Pure. The Verification Captain consumes ONLY the LandPortal lane
 * (verification authority); downstream lanes are gated on its decision.
 */
export function buildDukeReportLanes(input: DukeReportLanesInput): DukeReportLanes {
  const lp = input.landPortal;
  const parcelVerified = lp.status === 'success' && lp.verified === true;
  const acres = typeof input.acres === 'number' && Number.isFinite(input.acres) ? input.acres : null;

  // ── Lane 1: LandPortal Exact Search (verification authority) ────────────────
  const landPortalLane = lane({
    laneId: 'landportal_exact_search',
    laneName: 'LandPortal Exact Search',
    sourceType: 'landportal',
    canVerifyParcel: true,
    parcelVerificationAuthority: true,
    verifiedParcelIdentity: parcelVerified,
    status: lp.status === 'success' ? 'success'
      : lp.status === 'timeout' ? 'timeout'
      : lp.status === 'error' ? 'failed'
      : 'blocked', // not_verified / multiple_candidates
    findings: parcelVerified
      ? [lp.identitySummary ? `Verified parcel: ${lp.identitySummary}` : 'Parcel verified by exact LandPortal search.']
      : [lp.reason ? `Not verified: ${lp.reason}` : 'Parcel not verified by exact LandPortal search.'],
    blockingReason: parcelVerified ? null
      : lp.status === 'timeout' ? 'LandPortal exact search timed out (3-minute ceiling) before verifying identity.'
      : 'LandPortal exact search did not confirm a single parcel.',
    nextAction: parcelVerified ? null
      : 'Retry, or provide APN + county/state/FIPS, or owner + county/state, for exact lookup.',
    durationMs: lp.durationMs,
  });

  // ── Lane 2: Local Area Data (quick, non-verifying, compact market snapshot) ──
  const localAreaLane = buildLocalAreaLane(
    parcelVerified,
    input.localAreaAnchor ?? null,
    input.localAreaMarket ?? null,
  );

  // ── Lane 3: Verification Captain (final decision; LandPortal-only) ──────────
  const verificationCaptainLane = lane({
    laneId: 'verification_captain',
    laneName: 'Verification Captain',
    sourceType: 'verification',
    canVerifyParcel: true,
    parcelVerificationAuthority: true,
    verifiedParcelIdentity: parcelVerified,
    status: 'success', // the captain always renders a decision
    findings: parcelVerified
      ? [`Parcel VERIFIED${lp.identitySummary ? `: ${lp.identitySummary}` : ''} via exact LandPortal search.`]
      : ['Parcel NOT verified. Local Area Context only. Redfin/Zillow/LandWatch/local-area context can never verify identity.'],
    blockingReason: parcelVerified ? null
      : 'Parcel identity not verified — blocks comps, score, valuation, offer, and strategy.',
    nextAction: parcelVerified ? null : landPortalLane.nextAction,
  });

  // ── Lane 4: Redfin/Zillow Comps (only after verification) ───────────────────
  const compsLane = lane({
    laneId: 'redfin_zillow_comps',
    laneName: 'Redfin/Zillow Comps',
    sourceType: 'redfin_zillow',
    canVerifyParcel: false,
    status: parcelVerified ? 'not_available' : 'blocked',
    blockingReason: parcelVerified ? null : 'Parcel not verified — comps blocked.',
    findings: [],
    warnings: parcelVerified ? ['Redfin/Zillow are market context only and never verify parcel identity.'] : [],
    nextAction: parcelVerified
      ? 'Connect a Redfin/Zillow comp source or add manual comps to compute Expected Value (no comp credit).'
      : null,
  });

  // ── Lane 5: LandWatch (verified AND > 50 acres) ─────────────────────────────
  let landWatchLane: DukeLaneResult;
  if (!parcelVerified) {
    landWatchLane = lane({
      laneId: 'landwatch', laneName: 'LandWatch (large acreage)', sourceType: 'landwatch',
      status: 'blocked', blockingReason: 'Parcel not verified — LandWatch blocked.',
    });
  } else if (acres === null) {
    landWatchLane = lane({
      laneId: 'landwatch', laneName: 'LandWatch (large acreage)', sourceType: 'landwatch',
      status: 'skipped', blockingReason: 'Verified acreage unknown; LandWatch requires confirmed acreage over 50.',
      nextAction: 'Confirm verified acreage to evaluate the large-acreage market.',
    });
  } else if (acres <= LANDWATCH_MIN_ACRES) {
    landWatchLane = lane({
      laneId: 'landwatch', laneName: 'LandWatch (large acreage)', sourceType: 'landwatch',
      status: 'skipped', blockingReason: `Acreage threshold not met (${acres} ac ≤ ${LANDWATCH_MIN_ACRES} ac).`,
    });
  } else {
    landWatchLane = lane({
      laneId: 'landwatch', laneName: 'LandWatch (large acreage)', sourceType: 'landwatch',
      status: 'not_available',
      warnings: ['LandWatch is market context only and never verifies identity or overrides official acreage/APN/owner.'],
      nextAction: 'Connect a LandWatch large-acreage source for comparable large parcels (no comp credit).',
    });
  }

  // ── Lane 6: Strategy / Offer (only after verification) ───────────────────────
  const confirmedBands = STRATEGIES.filter(s => s.confirmed && s.offerPctLowOfEv != null)
    .map(s => `${s.label} ${s.offerPctLowOfEv}-${s.offerPctHighOfEv}% of EV`);
  const strategyLane = lane({
    laneId: 'strategy_offer',
    laneName: 'Strategy / Offer',
    sourceType: 'strategy',
    canVerifyParcel: false,
    status: parcelVerified ? 'success' : 'blocked',
    blockingReason: parcelVerified ? null : 'Parcel not verified — no score, valuation, offer, or strategy.',
    findings: parcelVerified
      ? [
          `Strategy bands (offer-engine): ${confirmedBands.join('; ')}.`,
          `Min net profit baseline $${GLOBAL_MIN_NET_PROFIT_USD.toLocaleString('en-US')}; subdivision $${SUBDIVISION_MIN_NET_PROFIT_USD.toLocaleString('en-US')}.`,
          'Distinct strategies are preserved; a concrete offer needs Expected Value from a comp source.',
        ]
      : [],
    nextAction: parcelVerified
      ? 'Add comps (Redfin/Zillow or manual) to compute Expected Value, then apply per-strategy offer bands.'
      : null,
  });

  const lanes = [landPortalLane, localAreaLane, verificationCaptainLane, compsLane, landWatchLane, strategyLane];
  const unverifiedLabel = parcelVerified ? null : LOCAL_AREA_NOT_VERIFIED_LABEL;
  const nextAction = parcelVerified
    ? 'Add comps to compute Expected Value and per-strategy offer bands.'
    : (landPortalLane.nextAction ?? 'Provide APN + county/state/FIPS or owner + county for exact lookup.');

  const laneStatusSummary = `LandPortal ${landPortalLane.status}; comps ${compsLane.status}; landwatch ${landWatchLane.status}; strategy ${strategyLane.status}`;
  const summary = parcelVerified
    ? `Duke Report: parcel VERIFIED${lp.identitySummary ? ` (${lp.identitySummary})` : ''}. ${laneStatusSummary}.`
    : `Duke Report: ${LOCAL_AREA_NOT_VERIFIED_LABEL}. ${laneStatusSummary}.`;

  return {
    parcelVerified,
    parcelIdentitySummary: parcelVerified ? (lp.identitySummary ?? null) : null,
    unverifiedLabel,
    lanes,
    compCreditUsed: false,
    nextAction,
    summary,
  };
}

/**
 * Render the Default Duke Report source lanes into a compact, operator-readable
 * report for the dashboard/chat surface. Pure string formatting — it only reads
 * lane fields, so it never scores, values, comps, offers, or recommends strategy
 * on its own, and emits no coordinate/proximity/map-pin language. When the
 * parcel is unverified it leads with "Local Area Context, Not Parcel Verified".
 */
export function renderDukeReportLanes(report: DukeReportLanes): string {
  const lines: string[] = [];
  lines.push(
    report.parcelVerified
      ? `Duke Report — parcel VERIFIED${report.parcelIdentitySummary ? ` (${report.parcelIdentitySummary})` : ''}`
      : `Duke Report — ${LOCAL_AREA_NOT_VERIFIED_LABEL}`,
  );
  lines.push('');
  for (const l of report.lanes) {
    lines.push(`${l.laneName}: ${l.status}`);
    for (const f of l.findings) lines.push(`  ${f}`);
    if (l.blockingReason) lines.push(`  ${l.blockingReason}`);
  }
  lines.push('');
  lines.push(`Next: ${report.nextAction}`);
  return lines.join('\n');
}

// ── County Deep Dive: on-demand second-layer workflow (NOT run by default) ─────

export const COUNTY_DEEP_DIVE_CHECKLIST: readonly string[] = [
  'County assessor record',
  'Tax records / delinquency',
  'County GIS / parcel viewer (exact APN/address only)',
  'Planning / zoning',
  'Health department / septic / perc',
  'Roads / public works / access',
  'Utilities (water/power/sewer)',
  'Permits',
  'HOA / POA',
  'Title / legal checklist',
];

/** Structured placeholder for the on-demand County Deep Dive. It is never part
 *  of the default report and verifies nothing on its own (exact records only). */
export function buildCountyDeepDivePlaceholder(): DukeLaneResult {
  return lane({
    laneId: 'county_deep_dive',
    laneName: 'County Deep Dive (on demand)',
    sourceType: 'local_area',
    canVerifyParcel: false,
    status: 'not_available',
    findings: ['On-demand second-layer workflow — not part of the default Duke Report.'],
    warnings: [`Checklist: ${COUNTY_DEEP_DIVE_CHECKLIST.join(', ')}.`],
    nextAction: 'Ask Tyler to run a County Deep Dive; it is never run by default.',
  });
}
