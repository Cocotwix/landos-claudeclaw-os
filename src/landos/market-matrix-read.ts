// LandOS — Market Matrix consumption for the Property Card.
//
// Given a Property Card's geography (state, county, zip) + acreage band, resolve
// the single best applicable Market Matrix snapshot using the fallback chain:
//     ZIP → County → County (All Acreage) → ZIP (All Acreage) → State → Unavailable
// where each geography rung is tried against EVERY acreage band that genuinely
// contains the subject's acreage before the geography widens — a 60-acre subject
// belongs to both "50+" and "50–100", so a store holding only one of them is not
// a missing record. Unavailable therefore means the Market Matrix carries nothing
// for this subject, never that one lookup key happened to miss. Every resolution
// reports `resolvedKey` — the geography key that actually carried it — so a
// surface can never imply the subject's primary key answered when a wider one did.
// The packet returned is compact and honest: match level, the snapshot's displayed
// facts (PPA / DOM / STR / population growth / liquidity), source + confidence,
// staleness (always shown, never hidden), and 2–3 discovery-call talking points
// that may reference ONLY the displayed facts. This is the read side of the
// master database — the Property Card is a CONSUMER, not a duplicate analyzer.

import { getLandosDb } from './db.js';
import { listCountyRef } from './market-matrix-store.js';
import { mrBridgeCountyFips, mrBridgeCountyName, mrBridgeLookup } from './market-research-store-bridge.js';
import {
  emptyMetrics, comparePeriods, parsePeriod, isCountyFips, STATE_FIPS,
  ACREAGE_BAND_LABEL, MARKET_METRIC_LABEL,
  type MarketMetrics, type MarketMetric, type MarketSide, type AcreageBand, type Confidence,
} from './market-matrix.js';

export type MatchLevel = 'zip' | 'county' | 'county_all_acreage' | 'zip_all_acreage' | 'state' | 'unavailable';

export const MATCH_LEVEL_LABEL: Record<MatchLevel, string> = {
  zip: 'ZIP match',
  county: 'County match',
  county_all_acreage: 'County (all acreage) match',
  zip_all_acreage: 'ZIP (all acreage) match',
  state: 'State match',
  unavailable: 'No Market Matrix data',
};

export interface MarketMatrixResolution {
  matchLevel: MatchLevel;
  available: boolean;
  geography: { state?: string; county?: string; fips?: string; zip?: string };
  /** The geography key that ACTUALLY carried this record (`zip:<zip>`,
   *  `county:<fips>`, `state:<st>`), null when nothing did. A record found under
   *  a wider key than the subject's primary one is still a found record — but the
   *  surface must say which key answered, so this is never optional. */
  resolvedKey: string | null;
  /** Compact operator label for `resolvedKey`, e.g. "<County> County (50–100 acres)". */
  resolvedKeyLabel: string | null;
  /** The band the SUBJECT is in. Null when its acreage is unknown. */
  acreageBandRequested: AcreageBand | null;
  acreageBandUsed: AcreageBand | null;
  /**
   * Set whenever the answer did not come from the subject's own band.
   *
   * A resolution that quietly widened to another band, another geography or the
   * all-acreage read is still an answer about a DIFFERENT population than the
   * one asked about, and the operator has to be told which. Null means the
   * subject's own band answered.
   */
  bandFallback: { from: AcreageBand | null; to: AcreageBand; why: string } | null;
  side: MarketSide;
  period: string | null;
  confidence: Confidence | null;
  source: string | null;
  provider: string | null;
  staleness: { label: string; quartersOld: number | null; isStale: boolean };
  facts: {
    pricePerAcre: number | null;
    daysOnMarket: number | null;
    sellThroughRate: number | null;
    populationGrowth: number | null;
    liquidity: string | null;
  };
  metrics: MarketMetrics | null;
  talkingPoints: string[];
  note: string;
}

interface SnapRow {
  fips: string; county_name: string; state: string; zip: string; period: string;
  acreage_band: string; metrics_json: string; confidence: string; provider: string; source_ref: string;
}

function metricsFromJson(s: string): MarketMetrics {
  const base = emptyMetrics();
  try {
    const parsed = JSON.parse(s) as Partial<MarketMetrics>;
    for (const k of Object.keys(base) as (keyof MarketMetrics)[]) {
      const v = parsed[k];
      base[k] = typeof v === 'number' && Number.isFinite(v) ? v : null;
    }
  } catch { /* keep empty */ }
  return base;
}

function newest(rows: SnapRow[]): SnapRow | undefined {
  let best: SnapRow | undefined;
  for (const r of rows) if (!best || comparePeriods(r.period, best.period) > 0) best = r;
  return best;
}

/** County names arrive both with and without the "County" suffix (seed vs.
 *  ingestion); render exactly one. */
function countyDisplay(name: string): string {
  const bare = name.replace(/\s+county$/i, '').trim();
  return bare ? `${bare} County` : '';
}

/** Resolve a county FIPS from a fips-or-name + state. The Market Matrix county
 *  reference covers only the counties already ingested there, so a name that
 *  misses falls through to the Market Research geography table, which carries
 *  every U.S. county. Locality scoping only — never parcel identity. */
function resolveFips(county: string | undefined, state: string | undefined): string | undefined {
  if (county && isCountyFips(county)) return county;
  if (county && state) {
    const match = listCountyRef(state).find((c) => c.countyName.toLowerCase() === county.replace(/\s+county$/i, '').trim().toLowerCase());
    if (match) return match.fips;
    return mrBridgeCountyFips(county, state) ?? undefined;
  }
  return undefined;
}

/** Current quarter key from a date (injectable for deterministic tests). */
export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
}

function computeStaleness(period: string | null, nowPeriod: string): MarketMatrixResolution['staleness'] {
  if (!period) return { label: 'No snapshot', quartersOld: null, isStale: false };
  const p = parsePeriod(period); const n = parsePeriod(nowPeriod);
  if (!p || !n) return { label: period, quartersOld: null, isStale: false };
  const q = (n.year - p.year) * 4 + (n.quarter - p.quarter);
  if (q <= 0) return { label: `Current (${period})`, quartersOld: 0, isStale: false };
  return { label: `${q} quarter${q === 1 ? '' : 's'} old (${period})`, quartersOld: q, isStale: q >= 2 };
}

function liquidityLabel(m: MarketMetrics): string | null {
  if (m.monthsOfSupply !== null) return m.monthsOfSupply < 4 ? 'Tight supply' : m.monthsOfSupply <= 8 ? 'Balanced supply' : 'Soft supply';
  if (m.sellThroughRate !== null) return m.sellThroughRate >= 50 ? 'Liquid (high sell-through)' : m.sellThroughRate >= 35 ? 'Moderately liquid' : 'Thin (low sell-through)';
  return null;
}

function money(n: number | null): string | null { return n === null ? null : `$${Math.round(n).toLocaleString()}`; }

/** Build 2–3 talking points that reference ONLY the displayed facts. */
function buildTalkingPoints(res: MarketMatrixResolution, countyLabel: string): string[] {
  const pts: string[] = [];
  const bandKey = res.acreageBandUsed ?? res.acreageBandRequested ?? 'all';
  const bandTxt = ACREAGE_BAND_LABEL[bandKey].toLowerCase();
  const scope = res.matchLevel === 'state' ? `${res.geography.state} statewide` : countyLabel;
  if (res.facts.pricePerAcre !== null) {
    pts.push(`${scope} ${res.side === 'sold' ? 'sold' : 'for-sale'} land (${bandTxt}) is reading around ${money(res.facts.pricePerAcre)}/acre (${res.period}, ${MATCH_LEVEL_LABEL[res.matchLevel].toLowerCase()}).`);
  }
  if (res.facts.daysOnMarket !== null) {
    pts.push(`Median days on market is ${Math.round(res.facts.daysOnMarket)} days${res.facts.liquidity ? `, ${res.facts.liquidity.toLowerCase()}` : ''}.`);
  }
  if (res.facts.sellThroughRate !== null && pts.length < 3) {
    pts.push(`Sell-through rate is ${res.facts.sellThroughRate}% — anchor expectations to real recent activity, not ZIP boundaries.`);
  }
  if (res.facts.populationGrowth !== null && pts.length < 3) {
    pts.push(`Population growth is ${res.facts.populationGrowth}%, a demand signal worth mentioning.`);
  }
  return pts.slice(0, 3);
}

/**
 * Resolve the best Market Matrix snapshot for a Property Card. Pure over the DB:
 * runs the ZIP → County → County-All-Acreage → ZIP-All-Acreage → State fallback,
 * trying every band the subject's acreage belongs to at each geography rung, and
 * returns the displayed facts + talking points, the key that carried them, or an
 * honest "unavailable" packet once every key for this subject has been tried.
 * Never fabricates a metric; talking points reference only displayed facts.
 */
export function resolveMarketMatrix(input: {
  state?: string;
  county?: string;   // FIPS or county name
  zip?: string;
  acreageBand?: AcreageBand;
  /** Every other band that also genuinely contains the subject's acreage (see
   *  acreageBandsForAcres). Tried, in order, at each geography rung after the
   *  primary band and before the geography widens — so a store that recorded
   *  60 acres under "50–100" still answers a "50+" request. Bands that do NOT
   *  contain the subject acreage must never be passed here. */
  acreageBands?: AcreageBand[];
  side?: MarketSide;
  nowPeriod?: string;
}): MarketMatrixResolution {
  const db = getLandosDb();
  const state = input.state ? input.state.toUpperCase() : undefined;
  // The subject's own band, or null when its acreage is unknown. An unknown
  // size asks for the all-acreage read EXPLICITLY rather than defaulting into a
  // band the subject may not belong to.
  const requestedBand: AcreageBand | null = input.acreageBand ?? null;
  const band: AcreageBand = requestedBand ?? 'all';
  const side: MarketSide = input.side ?? 'sold';
  const nowPeriod = input.nowPeriod ?? currentPeriod();
  const fips = resolveFips(input.county, state);
  const countyName = fips
    ? (listCountyRef(state).find((c) => c.fips === fips)?.countyName
      ?? mrBridgeCountyName(fips)
      ?? (isCountyFips(input.county ?? '') ? undefined : input.county)
      ?? fips)
    : (input.county ?? '');

  // Primary band first; every additional containing band after it, deduped.
  const bands: AcreageBand[] = [];
  for (const b of [band, ...(input.acreageBands ?? [])]) if (!bands.includes(b)) bands.push(b);

  const base: MarketMatrixResolution = {
    matchLevel: 'unavailable', available: false,
    geography: { state, county: countyName || undefined, fips, zip: input.zip },
    resolvedKey: null, resolvedKeyLabel: null,
    acreageBandRequested: requestedBand, acreageBandUsed: null, bandFallback: null, side, period: null, confidence: null,
    source: null, provider: null,
    staleness: { label: 'No snapshot', quartersOld: null, isStale: false },
    facts: { pricePerAcre: null, daysOnMarket: null, sellThroughRate: null, populationGrowth: null, liquidity: null },
    metrics: null, talkingPoints: [], note: '',
  };

  const resolvedKeyFor = (row: SnapRow, matchLevel: MatchLevel): { key: string; label: string } => {
    if (matchLevel === 'zip' || matchLevel === 'zip_all_acreage') {
      const z = row.zip || input.zip || '';
      return { key: `zip:${z}`, label: `ZIP ${z}` };
    }
    if (matchLevel === 'state') {
      const s = row.state || state || '';
      return { key: `state:${s}`, label: `${s} statewide` };
    }
    const f = row.fips || fips || '';
    return { key: `county:${f}`, label: countyDisplay(countyName || row.county_name || f) || f };
  };

  const finalize = (row: SnapRow, matchLevel: MatchLevel, bandUsed: AcreageBand): MarketMatrixResolution => {
    const metrics = metricsFromJson(row.metrics_json);
    const resolved = resolvedKeyFor(row, matchLevel);
    const res: MarketMatrixResolution = {
      ...base,
      matchLevel, available: true, acreageBandUsed: bandUsed,
      bandFallback: bandUsed === requestedBand ? null : {
        from: requestedBand,
        to: bandUsed,
        why: requestedBand == null
          ? 'The subject acreage is unknown, so no subject band could be requested; this is the all-acreage read for the geography.'
          : `No ${MATCH_LEVEL_LABEL[matchLevel].toLowerCase()} record carried real activity for the subject's ${ACREAGE_BAND_LABEL[requestedBand].toLowerCase()} band, so the ${ACREAGE_BAND_LABEL[bandUsed].toLowerCase()} record answered instead.`,
      },
      resolvedKey: resolved.key,
      resolvedKeyLabel: `${resolved.label} (${ACREAGE_BAND_LABEL[bandUsed].toLowerCase()})`,
      period: row.period, confidence: row.confidence as Confidence,
      source: row.source_ref || row.provider || null, provider: row.provider || null,
      staleness: computeStaleness(row.period, nowPeriod),
      facts: {
        pricePerAcre: metrics.medianPricePerAcre,
        daysOnMarket: metrics.daysOnMarket,
        sellThroughRate: metrics.sellThroughRate,
        populationGrowth: metrics.populationGrowth,
        liquidity: liquidityLabel(metrics),
      },
      metrics,
      talkingPoints: [],
      note: `Resolved via ${MATCH_LEVEL_LABEL[matchLevel]} (${resolved.label}) from the Market Matrix (master market database).`,
    };
    res.talkingPoints = buildTalkingPoints(res, countyName || (fips ?? ''));
    return res;
  };

  const SELECT = `SELECT fips, county_name, state, zip, period, acreage_band, metrics_json, confidence, provider, source_ref
       FROM landos_market_snapshot`;

  // ONE lookup for every rung: the Market Matrix table first, then the retained
  // quarterly Market Research collection for the same geography key and band.
  // The matrix stays authoritative; the bridge only answers where it held
  // nothing, so no ingested row is ever displaced by the collection.
  const lookup = (
    level: 'zip' | 'county' | 'state',
    key: { fips?: string; zip?: string; state?: string },
    b: AcreageBand,
  ): SnapRow | undefined => {
    const where = level === 'zip'
      ? `${SELECT} WHERE geo_level = 'zip' AND zip = ? AND side = ? AND acreage_band = ?`
      : level === 'county'
        ? `${SELECT} WHERE geo_level = 'county' AND fips = ? AND side = ? AND acreage_band = ?`
        : `${SELECT} WHERE geo_level = 'state' AND state = ? AND side = ? AND acreage_band = ?`;
    const primary = level === 'zip' ? key.zip! : level === 'county' ? key.fips! : key.state!;
    const matrixRow = newest(db.prepare(where).all(primary, side, b) as SnapRow[]);
    if (matrixRow) return matrixRow;
    return mrBridgeLookup({ level, fips: key.fips, zip: key.zip, state: key.state, band: b, side }) ?? undefined;
  };

  /**
   * A row EXISTS and a row SAYS SOMETHING are different questions.
   *
   * The quarterly Market Research collection covers every ZIP in the country,
   * so a rural ZIP now reliably has a row for the subject's band — and it is
   * frequently a row recording zero sales and zero metrics. Under a pure
   * first-key-wins chain that empty ZIP row displaced a county record holding
   * ninety-nine real sales, and the operator's headline read "0% sell-through ·
   * 0 recorded sales" for a market that is actually moving.
   *
   * So a rung is only ACCEPTED when its row carries at least one headline
   * number and did not record zero sales. Everything else is remembered, and
   * the narrowest one still answers if no rung ever carries a real number — an
   * empty record is a worse answer than a wider one, never worse than none.
   */
  const carriesRealActivity = (row: SnapRow): boolean => {
    const metrics = metricsFromJson(row.metrics_json);
    if (metrics.salesCount !== null && metrics.salesCount <= 0) return false;
    return metrics.medianPricePerAcre !== null
      || metrics.medianPrice !== null
      || metrics.daysOnMarket !== null
      || (metrics.salesCount !== null && metrics.salesCount > 0);
  };
  // Narrowest-first, so [0] is the closest record to the subject.
  const thin: Array<{ row: SnapRow; matchLevel: MatchLevel; band: AcreageBand }> = [];
  const consider = (
    row: SnapRow | undefined,
    matchLevel: MatchLevel,
    b: AcreageBand,
  ): MarketMatrixResolution | null => {
    if (!row) return null;
    if (carriesRealActivity(row)) return finalize(row, matchLevel, b);
    thin.push({ row, matchLevel, band: b });
    return null;
  };

  // 1. ZIP, every containing band
  if (input.zip) {
    for (const b of bands) {
      const res = consider(lookup('zip', { zip: input.zip }, b), 'zip', b);
      if (res) return res;
    }
  }

  // 2. County, every containing band
  if (fips) {
    for (const b of bands) {
      const res = consider(lookup('county', { fips }, b), 'county', b);
      if (res) return res;
    }

    // 3. County (All Acreage) — the county is the operator's primary market
    //    geography, so its all-acreage read is preferred over a much thinner
    //    ZIP-level sample before either widens to the state.
    if (!bands.includes('all')) {
      const res = consider(lookup('county', { fips }, 'all'), 'county_all_acreage', 'all');
      if (res) return res;
    }
  }

  // 4. ZIP (All Acreage) — the subject's own ZIP still holds a record; only its
  //    band missed. That is a found record, not a missing one.
  if (input.zip && !bands.includes('all')) {
    const res = consider(lookup('zip', { zip: input.zip }, 'all'), 'zip_all_acreage', 'all');
    if (res) return res;
  }

  // 5. State
  if (state) {
    for (const b of [...bands, 'all' as AcreageBand]) {
      const row = lookup('state', { state }, b);
      const res = consider(row, 'state', row ? (row.acreage_band as AcreageBand) ?? b : b);
      if (res) return res;
    }
  }

  // 5b. Nothing carried a real number, but a record for this subject does
  //     exist. Return the narrowest one rather than claiming no research
  //     exists — and let the read state plainly that it recorded no activity.
  if (thin.length) {
    const res = finalize(thin[0].row, thin[0].matchLevel, thin[0].band);
    return {
      ...res,
      note: `${res.note} This record exists but recorded no sales activity in the period, so it states an empty market rather than a priced one.`,
    };
  }

  // 6. Unavailable — every geography key for this subject was tried.
  return {
    ...base,
    note: fips || state || input.zip
      ? `No Market Matrix snapshot for ${countyName || input.zip || state || 'this area'} (${ACREAGE_BAND_LABEL[band]}, ${side}) under any of its resolved geography keys — ZIP, county, county all-acreage or state. This county is a Browser Agent ingestion candidate; nothing is fabricated.`
      : 'No resolvable geography (need state + county or ZIP) to consume the Market Matrix.',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Operator-facing report section — one source of truth for the Property Card
// AND the Discovery Call Report. Both render this; no duplicate calculation.
// ─────────────────────────────────────────────────────────────────────────

/** Map a property's acreage to the Market Matrix band whose data should apply.
 *  Below 5 ac → 2–5 (the closest supported band); otherwise the natural band.
 *  null → 2–5 (the default operating band). The resolver's fallback chain then
 *  fills in from County/State when a band is missing — never fabricates. */
export function acreageBandForAcres(acres: number | null | undefined): AcreageBand | null {
  // Unknown acreage selects NO band. It previously selected '2-5', which reads
  // as a positive claim about a subject whose size nobody knows, and which the
  // resolver then answered with real numbers for a band the subject may not be
  // in. The caller must decide what to do about an unknown size; this function
  // will not decide it for them.
  if (typeof acres !== 'number' || !Number.isFinite(acres) || acres <= 0) return null;
  // Every band is reachable by its own span. '0-1' and '1-2' were previously
  // unreachable — anything under 5 acres collapsed into '2-5' — so a 1.5-acre
  // subject was reported against 2-5-acre comparables while its real 1-2 record
  // sat unread in the collection.
  if (acres < 1) return '0-1';
  if (acres < 2) return '1-2';
  if (acres < 5) return '2-5';
  if (acres < 10) return '5-10';
  if (acres < 20) return '10-20';
  if (acres < 50) return '20-50';
  return '50+';
}

/** The numeric span of each supported band, so containment is decided by the
 *  subject's acreage rather than by a string key. 'all' is not a span. */
const ACREAGE_BAND_SPAN: Record<Exclude<AcreageBand, 'all'>, { min: number; max: number }> = {
  '0-1': { min: 0, max: 1 },
  '1-2': { min: 1, max: 2 },
  '2-5': { min: 2, max: 5 },
  '5-10': { min: 5, max: 10 },
  '10-20': { min: 10, max: 20 },
  '20-50': { min: 20, max: 50 },
  '50-100': { min: 50, max: 100 },
  '100+': { min: 100, max: Number.POSITIVE_INFINITY },
  '50+': { min: 50, max: Number.POSITIVE_INFINITY },
};

/**
 * Every band a subject of this acreage genuinely belongs to, primary band first
 * then narrowest containing span onward. A 60-acre subject is a "50+" property
 * AND a "50–100" property, so a Market Matrix that recorded the county under
 * only one of those labels has NOT failed to cover it — the lookup key did.
 * This never widens past containment: a 60-acre subject never reaches "20–50".
 */
export function acreageBandsForAcres(acres: number | null | undefined): AcreageBand[] {
  const primary = acreageBandForAcres(acres);
  // No acreage, no bands. An empty list is what tells the resolver to ask for
  // the all-acreage read explicitly rather than implying a band.
  if (primary == null) return [];
  const out: AcreageBand[] = [primary];
  if (typeof acres !== 'number' || !Number.isFinite(acres) || acres <= 0) return out;
  // An open-ended band ("50+", "100+") is the widest possible span; keep the
  // width finite so the narrowest-first ordering stays a real comparison.
  const width = (b: Exclude<AcreageBand, 'all'>): number => {
    const span = ACREAGE_BAND_SPAN[b];
    return Number.isFinite(span.max) ? span.max - span.min : Number.MAX_SAFE_INTEGER - span.min;
  };
  const containing = (Object.keys(ACREAGE_BAND_SPAN) as Array<Exclude<AcreageBand, 'all'>>)
    .filter((b) => acres >= ACREAGE_BAND_SPAN[b].min && acres < ACREAGE_BAND_SPAN[b].max)
    .sort((a, b) => width(a) - width(b));
  for (const b of containing) if (!out.includes(b)) out.push(b);
  return out;
}

export interface MarketMatrixReportField { label: string; value: string | null; unknown: boolean }
export interface MarketMatrixReportSection {
  available: boolean;
  coverageLevel: MatchLevel;
  coverageLabel: string;
  /** The geography key that actually carried the record, and its operator label. */
  resolvedKey: string | null;
  resolvedKeyLabel: string | null;
  acreageBandRequested: string;
  acreageBandUsed: string | null;
  side: MarketSide;
  period: string | null;
  snapshotDate: string | null;
  staleness: string;
  isStale: boolean;
  confidence: Confidence | null;
  source: string | null;
  provider: string | null;
  fields: MarketMatrixReportField[];
  talkingPoints: string[];
  note: string;
}

function fmtMetricValue(m: MarketMetric, v: number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (m === 'medianPrice' || m === 'medianPricePerAcre') return `$${Math.round(v).toLocaleString()}`;
  if (m === 'sellThroughRate' || m === 'absorptionRate' || m === 'populationGrowth') return `${v}%`;
  if (m === 'daysOnMarket') return `${Math.round(v)} days`;
  if (m === 'monthsOfSupply') return `${v} mo`;
  return Math.round(v).toLocaleString();
}

/**
 * Build the operator-facing Market Intelligence section from a resolved Market
 * Matrix packet. Every metric is shown with its real value OR "Unknown" (never
 * guessed, never zero). This is consumed IDENTICALLY by the Property Card and the
 * Discovery Call Report so there is one source of truth and no duplicate logic.
 */
export function buildMarketMatrixReportSection(res: MarketMatrixResolution): MarketMatrixReportSection {
  const M = res.metrics;
  const f = (m: MarketMetric, label: string): MarketMatrixReportField => {
    const value = fmtMetricValue(m, M ? M[m] : null);
    return { label, value, unknown: value === null };
  };
  const fields: MarketMatrixReportField[] = [
    f('medianPricePerAcre', 'Price per Acre'),
    f('daysOnMarket', 'Days on Market'),
    f('sellThroughRate', 'Sell-Through Rate'),
    f('absorptionRate', 'Absorption Rate'),
    f('monthsOfSupply', 'Months of Supply'),
    f('population', 'Population'),
    f('populationDensity', 'Population Density'),
    f('populationGrowth', 'Population Growth'),
  ];
  return {
    available: res.available,
    coverageLevel: res.matchLevel,
    coverageLabel: MATCH_LEVEL_LABEL[res.matchLevel],
    resolvedKey: res.resolvedKey,
    resolvedKeyLabel: res.resolvedKeyLabel,
    acreageBandRequested: res.acreageBandRequested ? ACREAGE_BAND_LABEL[res.acreageBandRequested] : 'Not requested (subject acreage unknown)',
    acreageBandUsed: res.acreageBandUsed ? ACREAGE_BAND_LABEL[res.acreageBandUsed] : null,
    side: res.side,
    period: res.period,
    snapshotDate: res.period,
    staleness: res.staleness.label,
    isStale: res.staleness.isStale,
    confidence: res.confidence,
    source: res.source ?? res.provider,
    provider: res.provider,
    fields,
    talkingPoints: res.talkingPoints,
    note: res.available
      ? `Market Matrix ${MATCH_LEVEL_LABEL[res.matchLevel].toLowerCase()} carried by ${res.resolvedKeyLabel ?? 'the resolved geography'}, ${res.side}, ${res.period}. Confidence ${res.confidence}. ${res.staleness.label}.`
      : res.note,
  };
}

/** One-call convenience: resolve a property's geography against the Market Matrix
 *  and format the operator section. Used by the deal-card report route. Every
 *  band the subject's acreage belongs to is tried, so a band-label mismatch in
 *  the store never reads as missing coverage. */
export function resolveMarketMatrixSection(input: {
  state?: string; county?: string; zip?: string; acres?: number | null; side?: MarketSide; nowPeriod?: string;
}): MarketMatrixReportSection {
  const acres = input.acres ?? null;
  const res = resolveMarketMatrix({
    state: input.state, county: input.county, zip: input.zip,
    acreageBand: acreageBandForAcres(acres) ?? undefined,
    acreageBands: acreageBandsForAcres(acres),
    side: input.side ?? 'sold', nowPeriod: input.nowPeriod,
  });
  return buildMarketMatrixReportSection(res);
}

export { STATE_FIPS };
