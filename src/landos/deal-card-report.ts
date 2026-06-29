// Deal Card — DD + Market + Strategy operational report engine.
//
// This is the operational workflow that turns the three Deal Card worksheets
// (Due Diligence + Research, Market Research, Strategy) into a single runnable
// report. From one Deal Card action it:
//   1. Builds parcel identity inputs from the Deal Card (DD worksheet + linked
//      property cards + people) — address, APN, county/state, owner, LP URL,
//      LandPortal property id + FIPS.
//   2. Runs the EXISTING safe, non-credit LandPortal exact resolve
//      (runDukeVerification -> injected lpResolveForPreflight). This is NOT a
//      comp credit, NOT a comp report tool, NOT GIS scraping, and never uses
//      coordinates/proximity/imagery to identify a parcel.
//   3. Builds the Due Diligence + Research leg (property-level): source-labeled
//      facts when verified; "Local Area Context, Not Parcel Verified" otherwise.
//   4. Builds the Market Research leg (market-level): structured non-paid source
//      targets + a market follow-up checklist for manual/source entry. It never
//      verifies parcel identity and never fabricates demand/comps/pricing.
//   5. Applies the EXISTING Strategy logic (duke-analysis + offer-engine) and
//      builds the Strategy leg (decision-level): candidates, most viable exit,
//      offer readiness, blockers, next confirmations, per-exit notes, target
//      profit baseline. It never invents a value, comp, EV, or final offer.
//   6. Updates the three worksheets (non-destructively: lists are unioned,
//      manual deep notes are preserved) and persists a practical local report
//      that survives reload.
//
// Hard rules (mirrors LandOS build operating rules):
//   - Departments stay separate: DD is property-level, Market is market-level,
//     Strategy is decision-level. Market never verifies a parcel; DD never
//     becomes a market conclusion; Strategy never fabricates comps/EVs/offers.
//   - No comp credit, no comp report tool, no paid API, no .env/secret read.
//   - No fabricated parcel facts, comps, solds, actives, demand, days-on-market,
//     pricing, EVs, or offers. Missing data is an honest gap, never invented.
//   - File-backed SQLite (store/landos.db, gitignored). No external system
//     mutation, no property-specific work product in the repo.
//
// The engine is pure orchestration with an INJECTED resolver so it is fully
// unit-testable without any live network call; the route wires the real
// non-credit lpResolveForPreflight.

import {
  getLandosDb,
  landosAudit,
  DEAL_CARD_REPORT_STATUSES,
  type DealCardReportStatus,
  type StrategyOfferReadiness,
  type LandosEntity,
} from './db.js';
import { getDealCard, type DealCardDetail } from './deal-card.js';
import { getDealCardDd, upsertDealCardDd, type DealCardDdView, type DealCardSourceLink, type DealCardDdPatch } from './deal-card-dd.js';
import { getDealCardMarket, upsertDealCardMarket, type DealCardMarketView, type DealCardMarketPatch } from './deal-card-market.js';
import { getDealCardStrategy, upsertDealCardStrategy, type DealCardStrategyView, type DealCardStrategyPatch } from './deal-card-strategy.js';
import { runDukeVerification, type DukeVerificationResult } from './duke-verification-bridge.js';
import { buildDukeAnalysis } from './duke-analysis.js';
import { GLOBAL_MIN_NET_PROFIT_USD, SUBDIVISION_MIN_NET_PROFIT_USD } from './offer-engine.js';
import { SOURCE_ADAPTERS, extractAreaSignals, marketPulseEligibility } from './source-adapters.js';
import { emptyLpPropertySummary, type LpResolveArgs, type LpResolveResult } from './landportal-client.js';
import type { DukePropertyData } from './duke-property-data.js';
import { buildVisualPropertyContext, type VisualPropertyContext, type VisualService } from './providers/google-visual.js';
import { loadCardVisualCapture, saveCardVisualCapture, upsertCardFromDukeRun, type CardVisualAsset } from './property-card.js';
import { capturePropertyVisuals, type CaptureInput, type CaptureResult } from './google-visual-capture.js';
import { googleVisualConfigured, resolveGoogleVisualEnv } from './providers/google-visual.js';
import { buildDdChecklist, mergeGovDdRows, summarizeDdCompleteness, type DdChecklistRow, type DdCompleteness } from './dd-checklist.js';
import { fetchFemaFlood, fetchNwiWetlands, fetchUsgsSlope, type GovFetch } from './providers/gov-dd-providers.js';
import { fetchCensusDemographics, emptyCensus, type CensusDemographics, type CensusFetch } from './census-demographics.js';

export interface MarketCompView {
  price: number; saleDateIso: string; acres: number | null; pricePerAcre: number | null; sourceUrl: string; sourceLabel: string; addressDesc?: string;
}
export interface MarketCompsView {
  status: 'collected' | 'no_comps' | 'not_configured' | 'no_area' | 'error' | 'not_run';
  /** Which provider produced the comps actually shown ('realie' | 'apify' | 'none'). */
  primaryProvider: 'realie' | 'apify' | 'none';
  /** Failover chain tried, e.g. ['realie:collected'] or ['realie:no_comps','apify:error']. */
  providerChain: string[];
  soldCount: number;
  activeCount: number;
  sold: MarketCompView[];
  active: MarketCompView[];
  /** Supplemental sold comps from a secondary provider (e.g. Zillow) — attributed,
   *  kept OUT of the primary (Realie) price-per-acre band to avoid polluting it. */
  supplementalSold: MarketCompView[];
  /** Realie valuation-only rows (market value, no usable sale) — kept separate. */
  valuation: MarketCompView[];
  metrics: { soldAvgPrice: number | null; soldAvgPpa: number | null; soldMedianPpa: number | null; ppaMin: number | null; ppaMax: number | null; activeAvgPrice: number | null; domMedian: number | null };
  /** Sparse-market explanation when sold comps are thin/absent. */
  sparseExplanation: string | null;
  providers: Array<{ providerId: string; status: string; kept: number }>;
  source: string;
  timestamp: string | null;
  note: string;
}
function emptyMarketComps(): MarketCompsView {
  return { status: 'not_run', primaryProvider: 'none', providerChain: [], soldCount: 0, activeCount: 0, sold: [], active: [], supplementalSold: [], valuation: [], metrics: { soldAvgPrice: null, soldAvgPpa: null, soldMedianPpa: null, ppaMin: null, ppaMax: null, activeAvgPrice: null, domMedian: null }, sparseExplanation: null, providers: [], source: 'multi-provider', timestamp: null, note: 'Not run.' };
}
const avg = (ns: number[]): number | null => (ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : null);
const median = (ns: number[]): number | null => { if (!ns.length) return null; const s = [...ns].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const ppas = (rows: MarketCompView[]): number[] => rows.map((c) => c.pricePerAcre).filter((p): p is number => typeof p === 'number');

/**
 * Market comps with PROVIDER FAILOVER: 1) Realie premium comparables (primary —
 * row-level, by coordinates, authorized on our key), 2) Apify Redfin fallback,
 * else honest provider_error / no_comps. Every comp keeps its provider. Sparse
 * rural/infill markets get a price-per-acre band + explanation instead of silence.
 */
async function liveMarketComps(q: CompQueryLite): Promise<MarketCompsView> {
  const chain: string[] = [];
  const finalize = async (v: MarketCompsView): Promise<MarketCompsView> => {
    // ── Supplemental Zillow lane (active listings + supplemental sold). Active is
    //    NEVER labeled sold; Zillow sold kept separate from Realie's PPA band. ──
    if (typeof q.lat === 'number' && typeof q.lng === 'number') {
      const { fetchZillowComps } = await import('./zillow-comps.js');
      const { withEnvFileSecrets } = await import('../env.js');
      const zc = await fetchZillowComps({ lat: q.lat, lng: q.lng, zip: q.zip }, { env: withEnvFileSecrets(['APIFY_TOKEN', 'LANDOS_ZILLOW_ACTOR']) });
      chain.push(`zillow:${zc.status}`);
      if (zc.status === 'collected') {
        const zView = (c: { price: number | null; acres: number | null; pricePerAcre: number | null; sourceUrl: string | null; city: string | null; state: string | null; saleOrListDateIso: string | null }): MarketCompView => ({ price: c.price ?? 0, saleDateIso: c.saleOrListDateIso ?? '', acres: c.acres, pricePerAcre: c.pricePerAcre, sourceUrl: c.sourceUrl ?? '', sourceLabel: 'zillow', addressDesc: [c.city, c.state].filter(Boolean).join(', ') || undefined });
        v.active = zc.active.map(zView);
        v.supplementalSold = zc.sold.map(zView);
        v.providers.push({ providerId: 'zillow', status: 'connected', kept: zc.active.length + zc.sold.length });
        if (v.status !== 'collected' && (zc.active.length > 0 || zc.sold.length > 0)) v.status = 'collected';
      } else {
        // Honest readiness: record WHY Zillow produced nothing (not_authorized /
        // not_configured / no_results / error) instead of silently omitting it.
        v.providers.push({ providerId: 'zillow', status: zc.status, kept: 0 });
      }
    }
    v.providerChain = chain;
    v.activeCount = v.active.length;
    const p = ppas(v.sold).sort((a, b) => a - b);
    const pct = (q2: number): number | null => (p.length ? p[Math.min(p.length - 1, Math.floor(q2 * p.length))] : null);
    v.metrics.soldAvgPrice = avg(v.sold.map((c) => c.price));
    v.metrics.soldAvgPpa = avg(p);
    v.metrics.soldMedianPpa = median(p);
    // Outlier-resistant band (p25–p75) — comp sets mix raw land with improved/
    // commercial parcels, so a raw min–max is misleading. Median + IQR is usable.
    v.metrics.ppaMin = pct(0.25);
    v.metrics.ppaMax = pct(0.75);
    v.soldCount = v.sold.length;
    if (v.soldCount > 0 && v.soldCount < 3) v.sparseExplanation = `Sparse market: only ${v.soldCount} verifiable sold comp(s). Lean on the median price-per-acre ($${v.metrics.soldMedianPpa}/ac) + valuation/area context; widen radius/timeframe before pricing.`;
    else if (v.soldCount === 0 && v.valuation.length > 0) v.sparseExplanation = 'No verifiable sold comps; using Realie valuation-only rows + area context. Confirm with a wider comp search before pricing.';
    return v;
  };

  // ── 1) Realie premium comparables (primary) ────────────────────────────────
  if (typeof q.lat === 'number' && typeof q.lng === 'number') {
    const { fetchRealieComps } = await import('./realie-comps.js');
    const { withEnvFileSecrets } = await import('../env.js');
    const rc = await fetchRealieComps(q.lat, q.lng, { env: withEnvFileSecrets(['REALIE_API_KEY', 'REALIE_API_BASE']), radiusMiles: 10, maxResults: 30, subjectAcres: q.acres ?? null, subjectImproved: q.improved === true });
    chain.push(`realie:${rc.status}`);
    if (rc.status === 'collected' && rc.sold.length > 0) {
      const toView = (c: { soldPrice: number | null; soldDateIso: string | null; acres: number | null; pricePerAcre: number | null; address: string | null; parcelId: string | null }): MarketCompView => ({ price: c.soldPrice ?? 0, saleDateIso: c.soldDateIso ?? '', acres: c.acres, pricePerAcre: c.pricePerAcre, sourceUrl: '', sourceLabel: 'realie', addressDesc: c.address ?? c.parcelId ?? undefined });
      return await finalize({ ...emptyMarketComps(), status: 'collected', primaryProvider: 'realie', sold: rc.sold.map(toView), valuation: rc.valuation.map(toView), providers: [{ providerId: 'realie', status: 'connected', kept: rc.sold.length }], source: 'Realie premium comparables', timestamp: new Date().toISOString(), note: rc.note });
    }
    // Realie valuation-only (no sold) — keep for context but still try Apify for sold.
    if (rc.status === 'collected' && rc.valuation.length > 0) {
      const toView = (c: { soldPrice: number | null; soldDateIso: string | null; acres: number | null; pricePerAcre: number | null; address: string | null }): MarketCompView => ({ price: c.soldPrice ?? 0, saleDateIso: c.soldDateIso ?? '', acres: c.acres, pricePerAcre: c.pricePerAcre, sourceUrl: '', sourceLabel: 'realie', addressDesc: c.address ?? undefined });
      const valuationView = rc.valuation.map(toView);
      const apify = await apifyComps(q, chain);
      if (apify.status === 'collected') { apify.valuation = valuationView; return await finalize(apify); }
      return await finalize({ ...emptyMarketComps(), status: 'collected', primaryProvider: 'realie', sold: [], valuation: valuationView, providers: [{ providerId: 'realie', status: 'connected', kept: 0 }], source: 'Realie premium comparables (valuation-only)', timestamp: new Date().toISOString(), note: rc.note });
    }
  } else {
    chain.push('realie:no_coords');
  }

  // ── 2) Apify Redfin fallback ───────────────────────────────────────────────
  return await finalize(await apifyComps(q, chain));
}

async function apifyComps(q: CompQueryLite, chain: string[]): Promise<MarketCompsView> {
  const { registerLiveProviders } = await import('./providers/register-live-providers.js');
  const { retrieveComps } = await import('./comp-retrieval.js');
  const reg = await registerLiveProviders({ onSpend: () => {} });
  if (!reg.compsLive) { chain.push('apify:not_configured'); return { ...emptyMarketComps(), status: 'not_configured', note: `Apify not wired: ${reg.reason}` }; }
  if (!q.state || !(q.address || q.city || q.zip)) { chain.push('apify:no_area'); return { ...emptyMarketComps(), status: 'no_area', note: 'No address/city/ZIP + state to search comps.' }; }
  const res = await retrieveComps(
    { address: q.address, city: q.city, county: q.county, state: q.state, zip: q.zip, acres: q.acres, centroid: typeof q.lat === 'number' && typeof q.lng === 'number' ? { lat: q.lat, lng: q.lng } : null, centroidTier: 'A' },
    { registry: reg.registry },
  );
  const sold: MarketCompView[] = res.comps.map((c) => ({ price: c.price, saleDateIso: c.saleDateIso, acres: c.acres, pricePerAcre: c.pricePerAcre, sourceUrl: c.sourceUrl, sourceLabel: c.sourceLabel, addressDesc: c.addressDesc }));
  const doms = res.needsVerification.map((nn) => nn.daysOnMarket).filter((d): d is number => typeof d === 'number');
  const anyConnected = res.providers.some((p) => p.status === 'connected' || p.status === 'no_comps');
  const anyError = res.providers.some((p) => p.status === 'error' || p.status === 'timeout');
  const status: MarketCompsView['status'] = res.hasComps ? 'collected' : (anyError && !anyConnected ? 'error' : 'no_comps');
  chain.push(`apify:${status}`);
  const providerNote = anyError && !res.hasComps ? ' Upstream Apify comp actor failed (error/timeout) — not a confirmed empty market.' : '';
  return {
    ...emptyMarketComps(),
    status, primaryProvider: res.hasComps ? 'apify' : 'none',
    sold: sold.slice(0, 25), active: [], valuation: [],
    metrics: { ...emptyMarketComps().metrics, domMedian: median(doms) },
    providers: res.providers.map((p) => ({ providerId: p.providerId, status: p.status, kept: p.kept })),
    source: 'Apify Redfin', timestamp: new Date().toISOString(), note: res.note + providerNote,
  };
}

type GovDdView = DealCardReportView['govDd'];
function emptyGovDd(): GovDdView {
  const nr = (kind: string) => ({ status: 'not_run', note: `Not run (no verified parcel coordinates) — ${kind} Needs Verification.`, source: null, timestamp: null });
  return {
    flood: { ...nr('flood'), zone: null },
    wetlands: { ...nr('wetlands'), type: null },
    slope: { ...nr('slope'), slopeDeg: null },
  };
}
/** Run free government environmental DD for a verified parcel with coordinates
 *  (FEMA flood + NWI wetlands + USGS slope — all contract-verified + free, run
 *  live; injectable fetches for tests). Coordinates are SUPPORTING context only,
 *  never identity. Unverified/area-only parcels have no coordinates -> not_run. */
async function buildGovDd(
  verification: DukeVerificationResult,
  deps: { femaFetch?: GovFetch; nwiFetch?: GovFetch; usgsFetch?: GovFetch },
): Promise<GovDdView> {
  const co = verification.coordinates;
  if (!verification.parcelVerified || !co) return emptyGovDd();
  const [flood, wet, slope] = await Promise.all([
    fetchFemaFlood(co.lat, co.lng, { fetchImpl: deps.femaFetch }),
    fetchNwiWetlands(co.lat, co.lng, { fetchImpl: deps.nwiFetch }),
    fetchUsgsSlope(co.lat, co.lng, { fetchImpl: deps.usgsFetch }),
  ]);
  return {
    flood: { status: flood.status, zone: flood.value == null ? null : String(flood.value), note: flood.note, source: flood.sourceUrl, timestamp: flood.timestamp },
    wetlands: { status: wet.status, type: wet.value == null ? null : String(wet.value), note: wet.note, source: wet.sourceUrl, timestamp: wet.timestamp },
    slope: { status: slope.status, slopeDeg: typeof slope.value === 'number' ? slope.value : null, note: slope.note, source: slope.sourceUrl, timestamp: slope.timestamp },
  };
}

// ── Persisted verified reuse (no provider call) ──────────────────────────────

/**
 * Build a resolver that REUSES a persisted, already-verified Property Card instead
 * of calling any data provider. Returns a verified LpResolveResult carrying the
 * card's identity + acreage; all other land facts stay blank (reported as data
 * gaps / Needs Verification — never fabricated). This is how the Discovery Call
 * Report runs from persisted verified data without consuming another Realie call.
 */
export function buildPersistedResolver(
  pc: Record<string, unknown>,
): (args: LpResolveArgs, timeoutMs: number) => Promise<LpResolveResult> {
  return async () => {
    const summary = emptyLpPropertySummary();
    summary.propertyid = s(pc.lp_property_id) || s(pc.property_id) || s(pc.parcel_id);
    summary.apn = s(pc.apn);
    summary.county = s(pc.county);
    summary.state = s(pc.state);
    summary.city = s(pc.city);
    summary.situs_address = s(pc.active_input_address);
    summary.owner = s(pc.owner);
    const acres = typeof pc.acres === 'number' ? pc.acres : undefined;
    if (acres !== undefined) { summary.lot_size_acres = String(acres); summary.calc_acres = String(acres); }
    const origSource = s(pc.verification_source);
    return {
      verified: true,
      status: 'verified',
      propertyid: summary.propertyid || null,
      fips: s(pc.fips) || null,
      apn: summary.apn || null,
      situs_address: summary.situs_address || null,
      city: summary.city || null,
      state: summary.state || null,
      owner: summary.owner || null,
      match_notes: `Reused persisted verified Property Card${pc.id ? ` #${pc.id}` : ''} — no provider call, no Realie credit.`,
      source: `Persisted verified Property Card${origSource ? ` (orig: ${origSource})` : ''}`,
      zoning: s(pc.zoning) || null, // carried when the card persists zoning (else Unknown)
      property_summary: summary,
      candidates: [],
    };
  };
}

const REPORT_STATUS_SET = new Set<string>(DEAL_CARD_REPORT_STATUSES);

// ── Public report shape ─────────────────────────────────────────────────────

/** One row in the report's unified source table. Honest status per source; a
 *  comp credit is NEVER used, so creditUsed is always false here. */
export interface DealCardReportSourceRow {
  source: string;
  kind: 'parcel_exact' | 'market_pulse';
  status:
    | 'used_non_credit'
    | 'attempted_not_verified'
    | 'unavailable'
    | 'not_connected'
    | 'manual_entry_needed';
  detail: string;
  /** Always false: this workflow never spends a LandPortal comp credit. */
  compCreditUsed: false;
}

export interface DealCardReportView {
  exists: boolean;
  dealCardId: number;
  reportStatus: DealCardReportStatus;
  /** Human parcel-verification label (e.g. "Parcel verified (LandPortal exact,
   *  non-credit)" or "Local Area Context, Not Parcel Verified"). */
  parcelVerificationStatus: string;
  parcelVerified: boolean;
  ddSummary: string;
  marketSummary: string;
  strategySummary: string;
  mostViableStrategy: string;
  offerReadiness: StrategyOfferReadiness;
  sourceTable: DealCardReportSourceRow[];
  dataGaps: string[];
  riskFlags: string[];
  countyVerificationChecklist: string[];
  marketFollowUpChecklist: string[];
  strategyBlockers: string[];
  nextConfirmations: string[];
  preCallStrategyNotes: string;
  /** Full DD fact checklist — every standard field with a Verified value (+source)
   *  or an explicit Unknown / Needs Verification status. Never fabricated. Mirrors
   *  the Discovery Call Report checklist. */
  ddFactChecklist: DdChecklistRow[];
  /** Completeness summary derived from the checklist (X of N verified). */
  ddCompleteness: DdCompleteness;
  /** Visual Property Context (Google) — supporting context only, never parcel
   *  verification. Deep links + image placeholders/captured refs, all labeled
   *  "Visual Signal, Not Verified Fact". Built purely (no Google call here). */
  visualContext: VisualPropertyContext;
  /** Free government environmental DD (live where contract-verified + lat/lng
   *  available). FEMA flood is activated; others labeled honestly when absent. */
  govDd: {
    flood: { status: string; zone: string | null; note: string; source: string | null; timestamp: string | null };
    wetlands: { status: string; type: string | null; note: string; source: string | null; timestamp: string | null };
    slope: { status: string; slopeDeg: number | null; note: string; source: string | null; timestamp: string | null };
  };
  /** Apify Redfin sold comps + active listings + market metrics (live where
   *  configured). Persisted; honest status when sparse/unavailable. */
  marketComps: MarketCompsView;
  /** US Census ACS county demographics (supporting market context; never identity).
   *  Honest not_configured when no free CENSUS_API_KEY. */
  demographics: CensusDemographics;
  creditUsage: {
    landportalNonCreditUsed: boolean;
    compCreditUsed: false;
    note: string;
  };
  /** Unix seconds when the report was last generated, or null when never run. */
  generatedAt: number | null;
  updatedBy: string;
}

export interface DealCardReportDeps {
  /** The bounded LandPortal exact resolver (never a comp tool/credit). */
  resolve: (args: LpResolveArgs, timeoutMs: number) => Promise<LpResolveResult>;
  timeoutMs: number;
  /** Who ran the report (audit/display only). */
  actor?: string;
  /** Presence-only flag (resolved by the route from GOOGLE_MAPS_API_KEY). Kept as
   *  a dep so this engine never reads .env/secrets. Default false. */
  googleVisualConfigured?: boolean;
  /** Force a fresh provider re-verification even when a verified Property Card is
   *  already linked. Default false → reuse persisted verified data (no provider
   *  call / no Realie credit). Set true only on explicit operator re-verify. */
  reverify?: boolean;
  /** Injected gov-DD fetches for tests (keep the suite offline). Default = live. */
  femaFetch?: GovFetch;
  nwiFetch?: GovFetch;
  usgsFetch?: GovFetch;
  /** Injected Google visual capture for tests. Default = live capturePropertyVisuals. */
  captureVisuals?: (input: CaptureInput) => Promise<CaptureResult>;
  /** Injected comp retrieval for tests. Default = live Apify Redfin registry. */
  retrieveCompsImpl?: (q: CompQueryLite) => Promise<MarketCompsView>;
  /** Injected Census fetch for tests. Default = live (honest not_configured w/o key). */
  censusFetch?: CensusFetch;
}

/** Minimal comp query the report builds from the verified parcel. */
export interface CompQueryLite {
  address?: string; city?: string; county?: string; state?: string; zip?: string;
  acres?: number; lat?: number; lng?: number;
  /** True when the subject has a structure (improved). Controls vacant-land comp
   *  validation — when false, improved/house sales are excluded from valuation. */
  improved?: boolean;
}

export interface DealCardReportResult {
  report: DealCardReportView;
  warnings: string[];
}

// ── Small helpers ───────────────────────────────────────────────────────────

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const n = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** Union two string lists, trimmed, de-duplicated, order-stable (base first). */
function union(base: string[], extra: string[]): string[] {
  const out: string[] = [];
  for (const x of [...base, ...extra]) {
    const v = (x ?? '').trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Union source-link lists by url (de-duplicated). */
function unionLinks(base: DealCardSourceLink[], extra: DealCardSourceLink[]): DealCardSourceLink[] {
  const out: DealCardSourceLink[] = [];
  const seen = new Set<string>();
  for (const l of [...base, ...extra]) {
    const url = (l?.url ?? '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ label: (l.label ?? '').trim(), url });
  }
  return out;
}

/** Human label for a strategy id used by duke-analysis candidates. */
const STRATEGY_LABELS: Record<string, string> = {
  quick_flip: 'Quick flip',
  subdivide: 'Subdivide',
  land_home_package: 'Land-home package',
  improved_property_value_add: 'Improved-property / mobile-home value-add',
  teardown_land_only: 'Teardown / land-only fallback',
  pass_no_offer: 'Pass / no offer',
};
function strategyLabel(id: string): string {
  return STRATEGY_LABELS[id] ?? id;
}

// ── Identity inputs ─────────────────────────────────────────────────────────

interface FirstPropertyCard {
  apn?: string;
  lp_property_id?: string;
  fips?: string;
  lp_url?: string;
  county?: string;
  state?: string;
  owner?: string;
  acres?: number | null;
}

/**
 * Build the parcel-identity text the safe resolver parses, from the Deal Card's
 * available inputs: a LandPortal URL, APN, owner, county/state, and a labeled
 * propertyid+FIPS. The DD worksheet wins for manually-entered values; the linked
 * property card backfills. Identity NEVER comes from coordinates/proximity.
 */
export function buildIdentityText(deal: DealCardDetail, dd: DealCardDdView): string {
  const prop = (deal.propertyCards?.[0] ?? {}) as FirstPropertyCard;
  const owner =
    (deal.people ?? []).find((p) => {
      const role = (p as { role?: string }).role;
      return role === 'owner' || role === 'record_owner';
    }) as { name?: string } | undefined;

  const apn = s(dd.apn) || s(prop.apn);
  const county = s(dd.county) || s(prop.county);
  const state = s(dd.state) || s(prop.state);
  const lpUrl = s(prop.lp_url);
  const propertyId = s(prop.lp_property_id);
  const fips = s(prop.fips);
  const ownerName = s(owner?.name) || s(prop.owner);
  // The street address of the subject parcel. WITHOUT this, an address-only lead
  // (no APN/owner/LP URL) produced an identity text of just the state, so the
  // report could never run an address-based verification. Include it so the
  // capability resolves address leads (APN still takes precedence when present).
  const address = s((prop as { active_input_address?: string }).active_input_address) || s((prop as { address?: string }).address);

  const lines: string[] = [];
  if (lpUrl) lines.push(lpUrl);
  if (apn) lines.push(`APN: ${apn}`);
  if (propertyId) lines.push(`propertyid: ${propertyId}`);
  if (fips) lines.push(`fips: ${fips}`);
  // A full "street, city, ST zip" line lets extractPropertyArgs build an address
  // lookup. Placed before county/state so the address parse wins for address leads.
  if (address) lines.push(address);
  if (county) lines.push(`${county} County`);
  if (state) lines.push(state);
  if (ownerName) lines.push(`Owner: ${ownerName}`);
  return lines.join('\n');
}

// ── Due Diligence + Research leg (property-level) ────────────────────────────

const TRUE_RE = /^(1|y|yes|true|t)$/i;

interface DdLeg {
  summary: string;
  patch: DealCardDdPatch;
  dataGaps: string[];
  riskFlags: string[];
  verificationWarnings: string[];
  countyChecklist: string[];
  /** Source link to attach for the verified LandPortal source (or null). */
  lpSourceLink: DealCardSourceLink | null;
}

/**
 * Build the DD/Research leg. When the parcel is source-verified by LandPortal
 * (non-credit), it writes source-labeled facts and a 'source_verified' identity
 * status WITH a named LandPortal source link (so the worksheet's "Verified needs
 * a source" guardrail is satisfied honestly). When not verified, it sets
 * 'local_area_context_not_verified', records the data gaps + verification
 * warnings, and never labels anything Verified. Manual content is preserved:
 * lists are unioned and free-text values are only set from the source.
 */
function buildDdLeg(verification: DukeVerificationResult, dd: DealCardDdView): DdLeg {
  const dataGaps: string[] = [];
  const riskFlags: string[] = [];
  const verificationWarnings: string[] = [];
  const countyChecklist: string[] = [];

  if (verification.parcelVerified && verification.propertyData) {
    const pd: DukePropertyData = verification.propertyData;
    const id = pd.identity;
    const f = pd.landFacts;

    // A named, provider-agnostic source citation for the verified record. For
    // LandPortal we cite the exact propertyid+FIPS record; for any other verified
    // source (Realie, or a reused persisted verified Property Card) we cite the
    // named source with a map reference to the verified parcel. This is source
    // attribution, never a fabricated fact — it lets verified DD facts stay
    // labeled "Verified" honestly.
    const srcLabel = verification.verificationSource || 'Verified source';
    const isLandPortal = /landportal/i.test(srcLabel);
    const mapsRef = id.situsAddress
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(id.situsAddress)}`
      : null;
    const lpSourceLink: DealCardSourceLink | null =
      isLandPortal && id.propertyId && id.fips
        ? { label: 'LandPortal exact property data (non-credit)', url: `https://landportal.com/?propertyid=${id.propertyId}&fips=${id.fips}` }
        : mapsRef
          ? { label: `${srcLabel} — verified parcel (map reference)`, url: mapsRef }
          : null;

    const patch: DealCardDdPatch = {
      parcelIdentityStatus: lpSourceLink ? 'source_verified' : 'apn_provided',
    };
    if (id.apn) { patch.apn = id.apn; patch.apnLabel = lpSourceLink ? 'Verified' : 'Needs verification'; }
    if (id.county) patch.county = id.county;
    if (id.state) patch.state = id.state;
    if (id.county || id.state) patch.locationLabel = lpSourceLink ? 'Verified' : 'Needs verification';
    if (typeof f.acres === 'number') { patch.acreage = f.acres; patch.acreageLabel = lpSourceLink ? 'Verified' : 'Needs verification'; }
    // Zoning: prefer the explicit provider zoning code (e.g. Realie zoningCode);
    // fall back to land use. Honest Unknown when neither is present.
    const zoningVal = f.zoning ?? f.landUse;
    if (zoningVal) { patch.zoning = zoningVal; patch.zoningLabel = lpSourceLink ? 'Verified' : 'Needs verification'; }

    // Access (from landlocked source flag — confirm legal/recorded access).
    if (f.landLocked !== undefined) {
      patch.accessStatus = TRUE_RE.test(f.landLocked.trim())
        ? 'Flagged landlocked per source — confirm legal/recorded access'
        : 'Not flagged landlocked per source — confirm access/easement';
      patch.accessLabel = lpSourceLink ? 'Verified' : 'Needs verification';
    }
    // Flood (FEMA %) and wetlands (%) — source facts.
    if (typeof f.femaPct === 'number') {
      patch.floodStatus = `FEMA floodplain ~${f.femaPct}%`;
      patch.floodLabel = lpSourceLink ? 'Verified' : 'Needs verification';
    }
    if (typeof f.wetlandsPct === 'number') {
      patch.wetlandsStatus = `Wetlands ~${f.wetlandsPct}%`;
      patch.wetlandsLabel = lpSourceLink ? 'Verified' : 'Needs verification';
    }
    if (typeof f.roadFrontageFt === 'number') {
      patch.roadFrontageNotes = `Road frontage ~${f.roadFrontageFt} ft (per LandPortal). Confirm legal access.`;
    }

    // Data gaps: surface the source's missing fields verbatim (never invented).
    for (const g of pd.dataGaps) dataGaps.push(`Source field not returned: ${g}`);

    // Risk flags from the source facts (deterministic; mirrors duke-analysis).
    if (f.landLocked !== undefined && TRUE_RE.test(f.landLocked.trim())) riskFlags.push('Landlocked per source — confirm legal/recorded access.');
    if (typeof f.wetlandsPct === 'number' && f.wetlandsPct >= 25) riskFlags.push(`Significant wetlands (~${f.wetlandsPct}%).`);
    if (typeof f.femaPct === 'number' && f.femaPct >= 25) riskFlags.push(`Significant FEMA floodplain (~${f.femaPct}%).`);
    if (typeof f.slopeAvgDeg === 'number' && f.slopeAvgDeg >= 15) riskFlags.push(`Steep average slope (~${f.slopeAvgDeg}°).`);
    if (typeof f.buildabilityPct === 'number' && f.buildabilityPct < 30) riskFlags.push(`Low buildability (~${f.buildabilityPct}%).`);

    // Manual county/official verification checklist (still required even when LP
    // verifies identity — county records confirm zoning/access/utilities/flood).
    countyChecklist.push(
      'Confirm zoning / land use with the county planning/zoning department.',
      'Confirm legal access (recorded easement or road frontage) with the county.',
      'Confirm utilities availability (power/water/sewer/septic) at the parcel.',
      'Confirm flood zone via the official FEMA flood map for the parcel.',
      'Confirm taxes / liens / delinquencies on the county tax record.',
    );

    if (!lpSourceLink) {
      verificationWarnings.push(`${srcLabel} verified the parcel but no citation URL/address was available; DD facts are labeled "Needs verification" rather than "Verified".`);
    }

    const summary = [
      `Parcel verified via ${srcLabel}.`,
      id.apn ? `APN ${id.apn}.` : '',
      [id.county, id.state].filter(Boolean).join(', '),
      typeof f.acres === 'number' ? `~${f.acres} ac.` : '',
      f.landUse ? `Land use: ${f.landUse}.` : '',
      pd.dataGaps.length ? `${pd.dataGaps.length} source field(s) not returned (see data gaps).` : 'All requested source fields returned.',
    ].filter(Boolean).join(' ');

    return { summary, patch, dataGaps, riskFlags, verificationWarnings, countyChecklist, lpSourceLink };
  }

  // ── Not verified — Local Area Context, Not Parcel Verified ───────────────
  const patch: DealCardDdPatch = { parcelIdentityStatus: 'local_area_context_not_verified' };
  dataGaps.push('Parcel identity not source-verified.');
  for (const g of verification.dataGaps) dataGaps.push(`Verification gap: ${g}`);
  riskFlags.push('Parcel identity not verified — no parcel fact may be treated as Verified, and no offer guidance is valid yet.');
  verificationWarnings.push('Due Diligence + Research is Local Area Context, Not Parcel Verified. Confirm exact parcel identity before treating any field as Verified.');
  if (verification.nextAction) verificationWarnings.push(verification.nextAction);

  countyChecklist.push(
    'Verify exact parcel identity via the county assessor/GIS by APN + county (or LandPortal property id + FIPS).',
    'Confirm owner of record on the county assessor/recorder.',
    'Confirm zoning / land use with the county planning/zoning department.',
    'Confirm legal access (recorded easement or road frontage).',
    'Confirm utilities availability and flood zone.',
  );

  const summary =
    verification.summary ||
    'Parcel not source-verified. Local Area Context, Not Parcel Verified. Confirm exact parcel identity before any parcel fact is treated as Verified.';

  return { summary, patch, dataGaps, riskFlags, verificationWarnings, countyChecklist, lpSourceLink: null };
}

// ── Market Research leg (market-level) ───────────────────────────────────────

interface MarketLeg {
  summary: string;
  patch: DealCardMarketPatch;
  sourceRows: DealCardReportSourceRow[];
  followUpChecklist: string[];
  dataGaps: string[];
}

/**
 * Build the Market Research leg. MARKET-LEVEL only: it structures the non-paid
 * source targets (the governed adapter registry + market-pulse signals) and an
 * operational market follow-up checklist for manual/source entry. It NEVER
 * verifies parcel identity and NEVER fabricates demand, comps, solds, actives,
 * days-on-market, or pricing. The target area is derived from the verified
 * county/state (preferred) or the local-area signals — using the source's place
 * name, never coordinates. Demand labels are left to manual entry; the report
 * only nudges market_review_status from 'not_reviewed' to the honest
 * 'needs_research' so the lane reads as structured-but-not-concluded.
 */
function buildMarketLeg(
  deal: DealCardDetail,
  verification: DukeVerificationResult,
  market: DealCardMarketView,
): MarketLeg {
  const verifiedId = verification.parcelVerified ? verification.propertyData?.identity : undefined;
  const area = extractAreaSignals(`${deal.title ?? ''} ${deal.package_notes ?? ''} ${deal.seller_notes ?? ''}`);
  const county = s(verifiedId?.county) || s(area.county);
  const state = s(verifiedId?.state) || s(area.state);
  const areaLabel = [county ? `${county} County` : '', state].filter(Boolean).join(', ');

  const pulse = marketPulseEligibility({ county: county || undefined, state: state || undefined });

  // Unified market source table: each market-pulse adapter is a non-paid source
  // TARGET. None are connected this sprint, so each is "manual_entry_needed" —
  // the operational source-entry path. No demand is invented.
  const sourceRows: DealCardReportSourceRow[] = SOURCE_ADAPTERS.filter((a) => a.kind === 'market_pulse').map((a) => ({
    source: a.label,
    kind: 'market_pulse' as const,
    status: a.availability === 'available' ? ('used_non_credit' as const) : ('manual_entry_needed' as const),
    detail: a.availability === 'available'
      ? `${a.label} connected. Signals: ${a.capability.marketPulseSignals.join(', ') || 'n/a'}.`
      : `Not connected. Enter findings manually from this source. Signals to capture: ${a.capability.marketPulseSignals.join(', ') || 'n/a'}.`,
    compCreditUsed: false as const,
  }));

  const followUpChecklist = [
    `Enter active land listings for ${areaLabel || 'the target area'} (acreage bands, asking $ / acre).`,
    'Enter recent sold land context (sale prices, acreage, sale dates) — notes only, no comps computed.',
    'Enter days-on-market notes for comparable land in the area.',
    'Rate local buyer demand by exit type (manufactured-home, subdivision, infill-lot, rural acreage) with a supporting note.',
    'Enter county growth / planning / comprehensive-plan notes if known or safely sourced.',
    'Attach a source link for each market finding and set the source confidence honestly.',
  ];

  const dataGaps: string[] = [];
  if (!pulse.eligible) dataGaps.push('No city/county + state known for the deal — Market Research target area is not yet defined.');
  if (market.buyerDemandLabel === 'not_reviewed') dataGaps.push('Local buyer demand not reviewed yet.');

  // Non-destructive patch: only set the target area label when empty, and only
  // nudge the review status from 'not_reviewed' to 'needs_research'. Demand
  // labels and notes are left exactly as the operator entered them.
  const patch: DealCardMarketPatch = {};
  if (!s(market.targetAreaLabel) && areaLabel) patch.targetAreaLabel = areaLabel;
  if (market.marketReviewStatus === 'not_reviewed') patch.marketReviewStatus = 'needs_research';
  patch.dataGaps = union(market.dataGaps, dataGaps);

  const summary = [
    areaLabel ? `Target area: ${areaLabel}.` : 'Target area not yet defined (need city/county + state).',
    pulse.eligible
      ? 'Market Pulse eligible as local area context (separate from parcel verification).'
      : 'Market Pulse not eligible yet (no city/county + state).',
    'No approved non-paid market adapter is connected — market findings are entered manually via the follow-up checklist. No comps, solds, actives, days-on-market, demand, or pricing are computed or invented.',
  ].filter(Boolean).join(' ');

  return { summary, patch, sourceRows, followUpChecklist, dataGaps };
}

// ── Strategy leg (decision-level) ────────────────────────────────────────────

interface StrategyLeg {
  summary: string;
  patch: DealCardStrategyPatch;
  mostViable: string;
  offerReadiness: StrategyOfferReadiness;
  blockers: string[];
  nextConfirmations: string[];
  preCallNotes: string;
}

/**
 * Build the Strategy leg from the EXISTING strategy logic (duke-analysis applies
 * the offer-engine baselines). Reads DD (verified property data) + Market and
 * produces candidates, the most viable exit, an honest offer readiness, blockers,
 * next confirmations, distinct per-exit notes, and the target-profit baseline. It
 * NEVER fabricates a value, comp, EV, or final offer, and NEVER auto-advances to
 * 'ready_for_offer'. Manual deep notes are preserved (only empty fields are
 * filled); lists are unioned.
 */
function buildStrategyLeg(verification: DukeVerificationResult, strategy: DealCardStrategyView): StrategyLeg {
  const analysis = buildDukeAnalysis({
    parcelVerified: verification.parcelVerified,
    propertyData: verification.parcelVerified ? verification.propertyData : undefined,
    dataGaps: verification.dataGaps,
  });

  const candidateIds = analysis.strategyCandidates.map((c) => c.strategy);
  const candidateLabels = candidateIds.map(strategyLabel);

  // Honest offer readiness mapping. Never auto 'ready_for_offer'.
  let offerReadiness: StrategyOfferReadiness;
  if (!verification.parcelVerified) offerReadiness = 'blocked';
  else offerReadiness = 'needs_confirmation';

  const blockers: string[] = [];
  const nextConfirmations: string[] = [];

  if (!verification.parcelVerified) {
    blockers.push('Parcel identity not verified — Strategy and Underwriting are blocked until a named source confirms identity.');
    nextConfirmations.push('Verify exact parcel identity (county assessor/GIS by APN + county, or LandPortal property id + FIPS).');
  } else {
    if (analysis.strategyStatus === 'blocked_needs_more_data') {
      blockers.push('Core land facts incomplete — gather more data before a preliminary strategy review.');
    }
    nextConfirmations.push('Confirm legal access, title/authority, and utilities before any offer.');
    nextConfirmations.push('Establish a source-backed valuation before any offer math (valuation is not ready yet).');
    if (analysis.offerReadiness.status === 'needs_verified_valuation') {
      blockers.push('Valuation not ready: no verified valuation data yet — no offer/EV is computed.');
    }
  }
  for (const r of analysis.redFlags) blockers.push(r);

  // Most viable: first non-pass candidate when verified; blocked otherwise.
  const firstNonPass = candidateIds.find((id) => id !== 'pass_no_offer');
  const mostViable = verification.parcelVerified && firstNonPass
    ? `${strategyLabel(firstNonPass)} (preliminary — confirm access/title/valuation).`
    : '';

  // Distinct per-exit rationale notes (only fill when the operator left empty).
  const rationaleFor = (id: string): string => analysis.strategyCandidates.find((c) => c.strategy === id)?.rationale ?? '';

  const targetProfitNote =
    `Minimum net profit baseline $${GLOBAL_MIN_NET_PROFIT_USD.toLocaleString()}. ` +
    `Subdivision projects target $${SUBDIVISION_MIN_NET_PROFIT_USD.toLocaleString()}+ net per project. ` +
    'No property-specific offer/EV is computed; valuation is not ready until a source-backed value, costs, and risk are set.';

  const preCallNotes = verification.parcelVerified
    ? 'Parcel verified. Lead with confirming access/title/utilities and motivation; do not present any number — valuation is not ready. Keep exit options open (flip, subdivide, land-home, value-add, teardown, pass).'
    : 'Parcel not verified. Treat as local-area context only. Confirm parcel identity and ownership/authority before discussing price; present no number.';

  const patch: DealCardStrategyPatch = {
    offerReadiness,
    strategyCandidates: union(strategy.strategyCandidates, candidateLabels),
    blockers: union(strategy.blockers, blockers),
    nextConfirmations: union(strategy.nextConfirmations, nextConfirmations),
  };
  if (!s(strategy.currentRecommendation)) {
    patch.currentRecommendation = verification.parcelVerified
      ? 'Preliminary strategy review available. Confirm access/title/utilities and establish a source-backed valuation before any offer.'
      : 'Blocked: verify parcel identity before any strategy or offer guidance.';
  }
  if (!s(strategy.mostViableStrategy) && mostViable) patch.mostViableStrategy = mostViable;
  if (!s(strategy.quickFlipNotes) && rationaleFor('quick_flip')) patch.quickFlipNotes = rationaleFor('quick_flip');
  if (!s(strategy.subdivideNotes) && rationaleFor('subdivide')) patch.subdivideNotes = rationaleFor('subdivide');
  if (!s(strategy.landHomePackageNotes) && rationaleFor('land_home_package')) patch.landHomePackageNotes = rationaleFor('land_home_package');
  if (!s(strategy.improvedValueAddNotes) && rationaleFor('improved_property_value_add')) patch.improvedValueAddNotes = rationaleFor('improved_property_value_add');
  if (!s(strategy.teardownLandOnlyNotes) && rationaleFor('teardown_land_only')) patch.teardownLandOnlyNotes = rationaleFor('teardown_land_only');
  if (!s(strategy.passNoOfferReason) && !verification.parcelVerified) {
    patch.passNoOfferReason = 'No offer while parcel identity is unverified. Pass remains available if numbers/risk do not work after verification.';
  }
  if (!s(strategy.riskAdjustedNotes) && analysis.redFlags.length) patch.riskAdjustedNotes = analysis.redFlags.join(' ');
  if (!s(strategy.targetProfitNote)) patch.targetProfitNote = targetProfitNote;
  if (!s(strategy.preCallStrategyNotes)) patch.preCallStrategyNotes = preCallNotes;

  const summary = verification.parcelVerified
    ? `Strategy candidates: ${candidateLabels.join(', ')}. Most viable (preliminary): ${firstNonPass ? strategyLabel(firstNonPass) : 'pending'}. Offer readiness: needs confirmation (valuation not ready, no offer computed).`
    : 'Strategy blocked: parcel identity not verified. No candidates, valuation, or offer until identity is confirmed by a named source.';

  return { summary, patch, mostViable, offerReadiness, blockers, nextConfirmations, preCallNotes };
}

// ── Persistence ──────────────────────────────────────────────────────────────

interface DealCardReportRow {
  deal_card_id: number;
  report_status: DealCardReportStatus;
  parcel_verification_status: string;
  parcel_verified: number;
  dd_summary: string;
  market_summary: string;
  strategy_summary: string;
  most_viable_strategy: string;
  offer_readiness: StrategyOfferReadiness;
  landportal_noncredit_used: number;
  comp_credit_used: number;
  report_json: string;
  updated_by: string;
  updated_at: number;
}

function emptyReport(dealCardId: number): DealCardReportView {
  return {
    exists: false,
    dealCardId,
    reportStatus: 'not_run',
    parcelVerificationStatus: 'Not run',
    parcelVerified: false,
    ddSummary: '',
    marketSummary: '',
    strategySummary: '',
    mostViableStrategy: '',
    offerReadiness: 'not_reviewed',
    sourceTable: [],
    dataGaps: [],
    riskFlags: [],
    countyVerificationChecklist: [],
    marketFollowUpChecklist: [],
    strategyBlockers: [],
    nextConfirmations: [],
    preCallStrategyNotes: '',
    ddFactChecklist: buildDdChecklist({}, null),
    ddCompleteness: summarizeDdCompleteness(buildDdChecklist({}, null)),
    visualContext: buildVisualPropertyContext({}, { configured: false }),
    govDd: emptyGovDd(),
    marketComps: emptyMarketComps(),
    demographics: emptyCensus(),
    creditUsage: {
      landportalNonCreditUsed: false,
      compCreditUsed: false,
      note: 'No report run yet. The DD + Market + Strategy report never spends a LandPortal comp credit.',
    },
    generatedAt: null,
    updatedBy: '',
  };
}

function rowToView(row: DealCardReportRow): DealCardReportView {
  let parsed: Partial<DealCardReportView> = {};
  try {
    const j = JSON.parse(row.report_json);
    if (j && typeof j === 'object') parsed = j as Partial<DealCardReportView>;
  } catch { /* fall back to structured columns below */ }
  const base = emptyReport(row.deal_card_id);
  return {
    ...base,
    ...parsed,
    exists: true,
    dealCardId: row.deal_card_id,
    reportStatus: REPORT_STATUS_SET.has(row.report_status) ? row.report_status : 'failed',
    parcelVerificationStatus: row.parcel_verification_status || base.parcelVerificationStatus,
    parcelVerified: row.parcel_verified === 1,
    ddSummary: row.dd_summary,
    marketSummary: row.market_summary,
    strategySummary: row.strategy_summary,
    mostViableStrategy: row.most_viable_strategy,
    offerReadiness: row.offer_readiness,
    creditUsage: {
      landportalNonCreditUsed: row.landportal_noncredit_used === 1,
      compCreditUsed: false,
      note: parsed.creditUsage?.note ?? base.creditUsage.note,
    },
    generatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function getReportRow(dealCardId: number): DealCardReportRow | undefined {
  return getLandosDb()
    .prepare('SELECT * FROM landos_deal_card_report WHERE deal_card_id = ?')
    .get(dealCardId) as DealCardReportRow | undefined;
}

/** Read the persisted report for a Deal Card (honest empty view when none). */
export function getDealCardReport(dealCardId: number): DealCardReportView {
  const row = getReportRow(dealCardId);
  return row ? rowToView(row) : emptyReport(dealCardId);
}

export interface DealCardReportSummary {
  exists: boolean;
  reportStatus: DealCardReportStatus | 'not_run';
  parcelVerified: boolean;
  ddPercentComplete: number;
  generatedAt: number | null;
}

/** Lightweight per-deal report summary for list/board rows (avoids loading the
 *  full report). Reads the persisted row and parses the completeness only. */
export function getDealCardReportSummary(dealCardId: number): DealCardReportSummary {
  const row = getReportRow(dealCardId);
  if (!row) return { exists: false, reportStatus: 'not_run', parcelVerified: false, ddPercentComplete: 0, generatedAt: null };
  let pct = 0;
  try {
    const j = JSON.parse(row.report_json) as Partial<DealCardReportView>;
    pct = j.ddCompleteness?.percentComplete ?? 0;
  } catch { pct = 0; }
  return {
    exists: true,
    reportStatus: REPORT_STATUS_SET.has(row.report_status) ? row.report_status : 'failed',
    parcelVerified: row.parcel_verified === 1,
    ddPercentComplete: pct,
    generatedAt: row.updated_at,
  };
}

function persistReport(dealCardId: number, view: DealCardReportView, updatedBy: string, entity: string): void {
  const db = getLandosDb();
  const existing = getReportRow(dealCardId);
  const now = Math.floor(Date.now() / 1000);
  const json = JSON.stringify({ ...view, exists: undefined, generatedAt: undefined });
  const cols = [
    view.reportStatus,
    view.parcelVerificationStatus,
    view.parcelVerified ? 1 : 0,
    view.ddSummary,
    view.marketSummary,
    view.strategySummary,
    view.mostViableStrategy,
    view.offerReadiness,
    view.creditUsage.landportalNonCreditUsed ? 1 : 0,
    0, // comp_credit_used: never
    json,
    updatedBy,
  ];
  if (existing) {
    db.prepare(
      `UPDATE landos_deal_card_report SET
         report_status = ?, parcel_verification_status = ?, parcel_verified = ?,
         dd_summary = ?, market_summary = ?, strategy_summary = ?,
         most_viable_strategy = ?, offer_readiness = ?,
         landportal_noncredit_used = ?, comp_credit_used = ?,
         report_json = ?, updated_by = ?, updated_at = ?
       WHERE deal_card_id = ?`,
    ).run(...cols, now, dealCardId);
  } else {
    db.prepare(
      `INSERT INTO landos_deal_card_report
         (deal_card_id, report_status, parcel_verification_status, parcel_verified,
          dd_summary, market_summary, strategy_summary, most_viable_strategy, offer_readiness,
          landportal_noncredit_used, comp_credit_used, report_json, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(dealCardId, ...cols, now);
  }
  landosAudit(updatedBy, existing ? 'deal_card_report_updated' : 'deal_card_report_created', `deal ${dealCardId} DD+Market+Strategy report (${view.reportStatus})`, {
    entity: entity || null,
    refTable: 'landos_deal_card_report',
    refId: dealCardId,
  });
}

// ── The operational workflow ─────────────────────────────────────────────────

/**
 * Run the DD + Market + Strategy report for a Deal Card. Builds identity inputs
 * from the Deal Card, runs the SAFE non-credit LandPortal exact resolve
 * (injected), builds the three department legs, updates the three worksheets
 * (non-destructively), and persists a reload-safe report. Returns null when the
 * Deal Card does not exist. Never spends a comp credit, never fabricates parcel
 * facts/comps/demand/pricing/EVs/offers, and never mutates an external system.
 */
export async function runDealCardReport(
  dealCardId: number,
  deps: DealCardReportDeps,
): Promise<DealCardReportResult | null> {
  const deal = getDealCard(dealCardId);
  if (!deal) return null;
  const actor = (deps.actor ?? 'tyler/report').trim() || 'tyler/report';
  const warnings: string[] = [];

  const dd = getDealCardDd(dealCardId);
  const market = getDealCardMarket(dealCardId);
  const strategy = getDealCardStrategy(dealCardId);

  // 1. Safe parcel identification. REUSE persisted verified data when a linked
  //    Property Card is already verified (no provider call, no Realie credit),
  //    unless the operator forces re-verification. Only re-query the provider
  //    when there is no verified card or reverify is explicitly requested.
  const verifiedCard = (deal.propertyCards as Array<Record<string, unknown>>).find(
    (c) => c.verification_status === 'verified_property' &&
      (s(c.apn) || s(c.lp_property_id) || s(c.parcel_id) || s(c.active_input_address)),
  );
  const usedPersistedVerification = !!verifiedCard && !deps.reverify;
  const effectiveResolve = usedPersistedVerification ? buildPersistedResolver(verifiedCard!) : deps.resolve;

  const identityText = buildIdentityText(deal, dd);
  let verification: DukeVerificationResult;
  try {
    verification = await runDukeVerification(identityText, { resolve: effectiveResolve, timeoutMs: deps.timeoutMs });
  } catch {
    // Unexpected engine error — honest failed report, no worksheet mutation.
    const failed: DealCardReportView = {
      ...emptyReport(dealCardId),
      exists: true,
      reportStatus: 'failed',
      parcelVerificationStatus: 'Failed — safe lookup error',
      ddSummary: 'The report could not run: the safe parcel lookup errored. No worksheet was changed and no comp credit was used.',
      generatedAt: Math.floor(Date.now() / 1000),
      updatedBy: actor,
    };
    persistReport(dealCardId, failed, actor, s(deal.entity));
    return { report: getDealCardReport(dealCardId), warnings: ['Safe parcel lookup errored; report saved as failed.'] };
  }

  // Propagate VERIFIED IDENTITY to the subject property card so its
  // verification_status / kanban agree with the report. Parcel-identity
  // verification is SEPARATE from DD completeness: a Realie-verified parcel must
  // read "identity verified" on the card even while DD is still incomplete.
  // Strong identity only (APN or property id); never downgrades (only runs on
  // parcelVerified), so a verified card stays verified across reruns.
  if (verification.parcelVerified && verification.propertyData) {
    const pid = verification.propertyData.identity as { apn?: string; propertyId?: string; fips?: string; county?: string; state?: string; situsAddress?: string; owner?: string };
    const subjectCard = (deal.propertyCards as Array<Record<string, unknown>> | undefined)?.[0];
    const subjectCardId = subjectCard ? Number(subjectCard.id) : undefined;
    if (subjectCardId && (s(pid.apn) || s(pid.propertyId))) {
      const lf = verification.propertyData.landFacts as { acres?: number } | undefined;
      upsertCardFromDukeRun({
        entity: s(deal.entity) as LandosEntity,
        agentId: 'duke-due-diligence',
        cardId: subjectCardId,
        activeInputAddress: s(pid.situsAddress) || s((subjectCard as { active_input_address?: string }).active_input_address) || s(deal.title) || `deal ${dealCardId}`,
        county: s(pid.county), state: s(pid.state), apn: s(pid.apn),
        lpPropertyId: s(pid.propertyId), fips: s(pid.fips), owner: s(pid.owner),
        acres: typeof lf?.acres === 'number' ? lf.acres : undefined,
        verified: true,
        verificationSource: verification.verificationSource ?? 'Realie.ai (non-credit)',
        summary: verification.propertyData.note ?? verification.summary,
      });
    }
  }

  const landportalAttempted = verification.sourceAttempts.some((a) => a.status !== 'skipped');
  const landportalUnavailable = verification.dataGaps.includes('landportal_unavailable');

  // 2. Department legs (kept separate).
  const ddLeg = buildDdLeg(verification, dd);
  const marketLeg = buildMarketLeg(deal, verification, market);
  const strategyLeg = buildStrategyLeg(verification, strategy);

  // 3. Update the three worksheets (non-destructive: lists unioned, manual
  //    deep notes preserved). Attach the LandPortal source link to DD so the
  //    verified facts legitimately carry the "Verified" label.
  const ddPatch: DealCardDdPatch = {
    ...ddLeg.patch,
    dataGaps: union(dd.dataGaps, ddLeg.dataGaps),
    riskFlags: union(dd.riskFlags, ddLeg.riskFlags),
    sourceLinks: ddLeg.lpSourceLink ? unionLinks(dd.sourceLinks, [ddLeg.lpSourceLink]) : dd.sourceLinks,
    updatedBy: actor,
  };
  const ddRes = upsertDealCardDd(dealCardId, ddPatch);
  if (ddRes) warnings.push(...ddRes.warnings);

  const marketRes = upsertDealCardMarket(dealCardId, { ...marketLeg.patch, updatedBy: actor });
  if (marketRes) warnings.push(...marketRes.warnings);

  const strategyRes = upsertDealCardStrategy(dealCardId, { ...strategyLeg.patch, updatedBy: actor });
  if (strategyRes) warnings.push(...strategyRes.warnings);

  // 4. Build the unified source table (parcel-exact + market-pulse). The parcel
  //    source reflects the actual provider/provenance (LandPortal, Realie, or a
  //    reused persisted verified Property Card). No comp credit is ever used.
  const parcelSourceLabel = usedPersistedVerification
    ? (verification.verificationSource || 'Persisted verified Property Card') + ' (reused — no provider call)'
    : (verification.verificationSource || 'Parcel identity provider') + ' (non-credit)';
  const lpRow: DealCardReportSourceRow = {
    source: parcelSourceLabel,
    kind: 'parcel_exact',
    status: verification.parcelVerified
      ? 'used_non_credit'
      : landportalUnavailable
        ? 'unavailable'
        : landportalAttempted
          ? 'attempted_not_verified'
          : 'manual_entry_needed',
    detail: verification.parcelVerified
      ? (usedPersistedVerification
          ? 'Parcel identity reused from the persisted verified Property Card — no provider call, no Realie credit.'
          : 'Parcel verified via the non-credit exact property-data lookup. No comp credit used.')
      : landportalUnavailable
        ? 'LandPortal exact lookup unavailable (not configured or unreachable). No comp credit used.'
        : landportalAttempted
          ? `${verification.summary}`
          : 'No usable parcel identifier on the Deal Card yet — provide APN + county/state, owner + county/state, or LP property id + FIPS.',
    compCreditUsed: false,
  };
  const sourceTable = [lpRow, ...marketLeg.sourceRows];

  // 5. Aggregate gaps/risks for the report (de-duplicated; worksheet stays the
  //    source of truth, the report mirrors the current combined picture).
  const dataGaps = union(union(ddLeg.dataGaps, marketLeg.dataGaps), []);
  const riskFlags = union(ddLeg.riskFlags, []);

  // 6. Report status: verified+clean -> complete; verified-with-gaps or
  //    local-area-context -> complete_with_gaps; lookup unavailable -> blocked.
  let reportStatus: DealCardReportStatus;
  if (landportalUnavailable) reportStatus = 'blocked';
  else if (verification.parcelVerified && dataGaps.length === 0) reportStatus = 'complete';
  else reportStatus = 'complete_with_gaps';

  const parcelVerificationStatus = verification.parcelVerified
    ? `Parcel verified (${verification.verificationSource || 'exact source'}, non-credit)`
    : verification.localAreaContextLabel ?? 'Not parcel verified';

  // Visual Property Context (supporting only, never verification). Built PURELY
  // here — NO Google call. Captured images (from a prior explicit capture) are
  // loaded from the linked Property Card and surfaced as dashboard-safe URLs;
  // services without a capture render as placeholders + deep links.
  // Government environmental DD (FEMA/NWI/USGS) — computed first so its verified
  // facts merge into the DD checklist with their OWN per-field provenance.
  const govDd = await buildGovDd(verification, { femaFetch: deps.femaFetch, nwiFetch: deps.nwiFetch, usgsFetch: deps.usgsFetch });
  const ddChecklistRows = mergeGovDdRows(
    buildDdChecklist(verification.propertyData?.landFacts, verification.verificationSource ?? null),
    govDd,
  );
  const vid = verification.identity;
  const visualCardId = (verifiedCard?.id ?? (deal.propertyCards as Array<Record<string, unknown>>)[0]?.id) as number | undefined;
  // ITEM 1: Google visual auto-capture/REUSE. For a verified parcel, capture once
  // (satellite + Street View) and persist to the card; on later runs reuse the
  // persisted capture (no repeat Google call). Honest no-op when not configured.
  const googleConfigured = deps.googleVisualConfigured ?? googleVisualConfigured();
  if (visualCardId && googleConfigured && verification.parcelVerified) {
    const already = loadCardVisualCapture(visualCardId);
    // Best available address for imagery: the verified situs, else the card's
    // original input address (a verified parcel may lack a normalized situs).
    const imageryAddress = s(vid?.situsAddress) || s((deal.propertyCards?.[0] as { active_input_address?: string } | undefined)?.active_input_address) || '';
    const hasCoordsOrAddr = !!(verification.coordinates || imageryAddress);
    if (Object.keys(already).length === 0 && hasCoordsOrAddr) {
      // Imagery needs coordinates. When the parcel provider returns none, geocode
      // the VERIFIED address for IMAGERY ONLY (supporting context, never identity)
      // so satellite/Street-View reliably appear for a verified parcel.
      let imageryCoords = verification.coordinates ?? null;
      if (!imageryCoords && imageryAddress) {
        try {
          const { deriveCounty } = await import('./providers/county-geocode.js');
          const g = await deriveCounty({ address: imageryAddress, city: vid?.city, state: vid?.state });
          if (g && g.lat != null && g.lng != null) imageryCoords = { lat: g.lat, lng: g.lng };
        } catch { /* supporting-only; never fail the report */ }
      }
      try {
        // The capture reads its key from the env it's given; the app keeps secrets
        // in the .env FILE (not process.env), so pass the file-resolved Google key
        // (same fix class as Realie/Zillow). Test injection (deps.captureVisuals)
        // is used as-is.
        const doCapture = deps.captureVisuals ?? ((inp: CaptureInput) => capturePropertyVisuals(inp, { env: resolveGoogleVisualEnv() }));
        const cap = await doCapture({
          propertyLabel: imageryAddress || `deal ${dealCardId}`,
          address: imageryAddress || null,
          coords: imageryCoords,
        });
        if (cap.captured && Object.keys(cap.assets).length > 0) {
          saveCardVisualCapture(visualCardId, cap.assets as Record<string, CardVisualAsset>, { provider: 'google' });
        }
      } catch { /* visuals are supporting-only; never fail the report on a capture error */ }
    }
  }
  const rawCaptured = visualCardId ? loadCardVisualCapture(visualCardId) : {};
  const captured: Partial<Record<VisualService, { storedPath: string; timestamp?: string; url?: string }>> = {};
  for (const [svc, a] of Object.entries(rawCaptured)) {
    captured[svc as VisualService] = {
      storedPath: a.storedPath,
      timestamp: a.timestamp,
      url: `/api/landos/visual/image?cardId=${visualCardId}&service=${encodeURIComponent(svc)}`,
    };
  }
  const visualContext = buildVisualPropertyContext(
    {
      address: vid?.situsAddress ?? null,
      city: vid?.city ?? null,
      county: vid?.county ?? null,
      state: vid?.state ?? null,
    },
    { configured: deps.googleVisualConfigured ?? false, captured },
  );

  // ITEM 2: Apify Redfin sold comps + market metrics for the verified parcel's
  // area. Live where configured (injectable for tests); honest status otherwise.
  let marketComps = emptyMarketComps();
  if (verification.parcelVerified) {
    const lf = verification.propertyData?.landFacts as { acres?: number; buildingAreaSqft?: number | string; buildingArea?: number | string; yearBuilt?: number | string; landUse?: string } | undefined;
    // Improved subject = has a structure (building area / year built / use code).
    const bArea = Number(String(lf?.buildingAreaSqft ?? lf?.buildingArea ?? '').replace(/[^0-9.]/g, '')) || 0;
    const subjectImproved = bArea > 0 || (!!lf?.yearBuilt && Number(lf.yearBuilt) > 1900) || /home|house|dwelling|residence|mobile|improv|structure/i.test(lf?.landUse ?? '');
    const q: CompQueryLite = {
      improved: subjectImproved,
      address: vid?.situsAddress ?? undefined,
      city: vid?.city ?? undefined,
      county: vid?.county ?? undefined,
      state: vid?.state ?? undefined,
      // ZIP for the Zillow supplemental lane — from the situs address tail.
      zip: vid?.situsAddress?.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1],
      acres: typeof lf?.acres === 'number' ? lf.acres : undefined,
      lat: verification.coordinates?.lat,
      lng: verification.coordinates?.lng,
    };
    try {
      marketComps = await (deps.retrieveCompsImpl ?? liveMarketComps)(q);
    } catch (e: unknown) {
      marketComps = { ...emptyMarketComps(), status: 'error', note: `Comp retrieval error: ${(e as Error)?.message ?? String(e)}.` };
    }
  }

  // Census demographics (supporting market context) for the verified parcel's county.
  let demographics = emptyCensus();
  if (verification.parcelVerified) {
    demographics = await fetchCensusDemographics(verification.identity?.fips, { fetchImpl: deps.censusFetch });
  }

  const view: DealCardReportView = {
    exists: true,
    dealCardId,
    reportStatus,
    parcelVerificationStatus,
    parcelVerified: verification.parcelVerified,
    ddSummary: ddLeg.summary,
    marketSummary: marketLeg.summary,
    strategySummary: strategyLeg.summary,
    mostViableStrategy: strategyLeg.mostViable,
    offerReadiness: strategyLeg.offerReadiness,
    sourceTable,
    dataGaps,
    riskFlags,
    countyVerificationChecklist: ddLeg.countyChecklist,
    marketFollowUpChecklist: marketLeg.followUpChecklist,
    strategyBlockers: union(strategyLeg.blockers, []),
    nextConfirmations: union(strategyLeg.nextConfirmations, []),
    preCallStrategyNotes: strategyLeg.preCallNotes,
    ddFactChecklist: ddChecklistRows,
    ddCompleteness: summarizeDdCompleteness(ddChecklistRows),
    visualContext,
    govDd,
    marketComps,
    demographics,
    creditUsage: {
      landportalNonCreditUsed: landportalAttempted && !landportalUnavailable,
      compCreditUsed: false,
      note: 'LandPortal non-credit exact property data only. No comp-credit tool (lp_comp_report_create / lp_comp_report_get) was called. No paid API, no secret read.',
    },
    generatedAt: Math.floor(Date.now() / 1000),
    updatedBy: actor,
  };

  persistReport(dealCardId, view, actor, s(deal.entity));
  // Read back so what we return is exactly what persisted (proves reload-safety).
  return { report: getDealCardReport(dealCardId), warnings };
}
