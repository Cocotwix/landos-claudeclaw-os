// LandOS — Market Matrix consumption for the Property Card.
//
// Given a Property Card's geography (state, county, zip) + acreage band, resolve
// the single best applicable Market Matrix snapshot using the fallback chain:
//     ZIP → County → County (All Acreage) → State → Unavailable
// and return a compact, honest packet: match level, the snapshot's displayed
// facts (PPA / DOM / STR / population growth / liquidity), source + confidence,
// staleness (always shown, never hidden), and 2–3 discovery-call talking points
// that may reference ONLY the displayed facts. This is the read side of the
// master database — the Property Card is a CONSUMER, not a duplicate analyzer.

import { getLandosDb } from './db.js';
import { listCountyRef } from './market-matrix-store.js';
import {
  emptyMetrics, comparePeriods, parsePeriod, isCountyFips, STATE_FIPS,
  ACREAGE_BAND_LABEL, MARKET_METRIC_LABEL,
  type MarketMetrics, type MarketMetric, type MarketSide, type AcreageBand, type Confidence,
} from './market-matrix.js';

export type MatchLevel = 'zip' | 'county' | 'county_all_acreage' | 'state' | 'unavailable';

export const MATCH_LEVEL_LABEL: Record<MatchLevel, string> = {
  zip: 'ZIP match',
  county: 'County match',
  county_all_acreage: 'County (all acreage) match',
  state: 'State match',
  unavailable: 'No Market Matrix data',
};

export interface MarketMatrixResolution {
  matchLevel: MatchLevel;
  available: boolean;
  geography: { state?: string; county?: string; fips?: string; zip?: string };
  acreageBandRequested: AcreageBand;
  acreageBandUsed: AcreageBand | null;
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

/** Resolve a county FIPS from a fips-or-name + state. */
function resolveFips(county: string | undefined, state: string | undefined): string | undefined {
  if (county && isCountyFips(county)) return county;
  if (county && state) {
    const match = listCountyRef(state).find((c) => c.countyName.toLowerCase() === county.replace(/\s+county$/i, '').trim().toLowerCase());
    if (match) return match.fips;
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
  const bandTxt = ACREAGE_BAND_LABEL[res.acreageBandUsed ?? res.acreageBandRequested].toLowerCase();
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
 * runs the ZIP → County → County-All-Acreage → State fallback and returns the
 * displayed facts + talking points, or an honest "unavailable" packet. Never
 * fabricates a metric; talking points reference only displayed (non-null) facts.
 */
export function resolveMarketMatrix(input: {
  state?: string;
  county?: string;   // FIPS or county name
  zip?: string;
  acreageBand?: AcreageBand;
  side?: MarketSide;
  nowPeriod?: string;
}): MarketMatrixResolution {
  const db = getLandosDb();
  const state = input.state ? input.state.toUpperCase() : undefined;
  const band = input.acreageBand ?? '2-5';
  const side: MarketSide = input.side ?? 'sold';
  const nowPeriod = input.nowPeriod ?? currentPeriod();
  const fips = resolveFips(input.county, state);
  const countyName = fips ? (listCountyRef(state).find((c) => c.fips === fips)?.countyName ?? input.county ?? fips) : (input.county ?? '');

  const base: MarketMatrixResolution = {
    matchLevel: 'unavailable', available: false,
    geography: { state, county: countyName || undefined, fips, zip: input.zip },
    acreageBandRequested: band, acreageBandUsed: null, side, period: null, confidence: null,
    source: null, provider: null,
    staleness: { label: 'No snapshot', quartersOld: null, isStale: false },
    facts: { pricePerAcre: null, daysOnMarket: null, sellThroughRate: null, populationGrowth: null, liquidity: null },
    metrics: null, talkingPoints: [], note: '',
  };

  const finalize = (row: SnapRow, matchLevel: MatchLevel, bandUsed: AcreageBand): MarketMatrixResolution => {
    const metrics = metricsFromJson(row.metrics_json);
    const res: MarketMatrixResolution = {
      ...base,
      matchLevel, available: true, acreageBandUsed: bandUsed,
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
      note: `Resolved via ${MATCH_LEVEL_LABEL[matchLevel]} from the Market Matrix (master market database).`,
    };
    res.talkingPoints = buildTalkingPoints(res, countyName || (fips ?? ''));
    return res;
  };

  // 1. ZIP
  if (input.zip) {
    const rows = db.prepare(
      `SELECT fips, county_name, state, zip, period, acreage_band, metrics_json, confidence, provider, source_ref
       FROM landos_market_snapshot WHERE geo_level = 'zip' AND zip = ? AND side = ? AND acreage_band = ?`,
    ).all(input.zip, side, band) as SnapRow[];
    const row = newest(rows);
    if (row) return finalize(row, 'zip', band);
  }

  // 2. County (requested band)
  if (fips) {
    const rows = db.prepare(
      `SELECT fips, county_name, state, zip, period, acreage_band, metrics_json, confidence, provider, source_ref
       FROM landos_market_snapshot WHERE geo_level = 'county' AND fips = ? AND side = ? AND acreage_band = ?`,
    ).all(fips, side, band) as SnapRow[];
    const row = newest(rows);
    if (row) return finalize(row, 'county', band);

    // 3. County (All Acreage)
    if (band !== 'all') {
      const allRows = db.prepare(
        `SELECT fips, county_name, state, zip, period, acreage_band, metrics_json, confidence, provider, source_ref
         FROM landos_market_snapshot WHERE geo_level = 'county' AND fips = ? AND side = ? AND acreage_band = 'all'`,
      ).all(fips, side) as SnapRow[];
      const allRow = newest(allRows);
      if (allRow) return finalize(allRow, 'county_all_acreage', 'all');
    }
  }

  // 4. State
  if (state) {
    const rows = db.prepare(
      `SELECT fips, county_name, state, zip, period, acreage_band, metrics_json, confidence, provider, source_ref
       FROM landos_market_snapshot WHERE geo_level = 'state' AND state = ? AND side = ? AND (acreage_band = ? OR acreage_band = 'all')`,
    ).all(state, side, band) as SnapRow[];
    const row = newest(rows);
    if (row) return finalize(row, 'state', (row.acreage_band as AcreageBand) ?? band);
  }

  // 5. Unavailable
  return {
    ...base,
    note: fips || state
      ? `No Market Matrix snapshot for ${countyName || state || 'this area'} (${ACREAGE_BAND_LABEL[band]}, ${side}). This county is a Browser Agent ingestion candidate; nothing is fabricated.`
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
export function acreageBandForAcres(acres: number | null | undefined): AcreageBand {
  if (typeof acres !== 'number' || !Number.isFinite(acres) || acres <= 0) return '2-5';
  if (acres < 5) return '2-5';
  if (acres < 10) return '5-10';
  if (acres < 20) return '10-20';
  if (acres < 50) return '20-50';
  return '50+';
}

export interface MarketMatrixReportField { label: string; value: string | null; unknown: boolean }
export interface MarketMatrixReportSection {
  available: boolean;
  coverageLevel: MatchLevel;
  coverageLabel: string;
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
    acreageBandRequested: ACREAGE_BAND_LABEL[res.acreageBandRequested],
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
      ? `Market Matrix ${MATCH_LEVEL_LABEL[res.matchLevel].toLowerCase()} for ${ACREAGE_BAND_LABEL[res.acreageBandUsed ?? res.acreageBandRequested].toLowerCase()}, ${res.side}, ${res.period}. Confidence ${res.confidence}. ${res.staleness.label}.`
      : res.note,
  };
}

/** One-call convenience: resolve a property's geography against the Market Matrix
 *  and format the operator section. Used by the deal-card report route. */
export function resolveMarketMatrixSection(input: {
  state?: string; county?: string; zip?: string; acres?: number | null; side?: MarketSide; nowPeriod?: string;
}): MarketMatrixReportSection {
  const band = acreageBandForAcres(input.acres ?? null);
  const res = resolveMarketMatrix({ state: input.state, county: input.county, zip: input.zip, acreageBand: band, side: input.side ?? 'sold', nowPeriod: input.nowPeriod });
  return buildMarketMatrixReportSection(res);
}

export { STATE_FIPS };
