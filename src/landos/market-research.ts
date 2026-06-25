// LandOS Market Research (market_bot) — County Scorecard scaffold.
//
// Evaluates counties on the seven-metric framework and maintains the County
// Scorecard in the knowledge layer (markets/county_scorecard.json). This is
// BUSINESS intelligence: a county scorecard does NOT attach to a Deal Card (only
// a property-scoped market pulse does — see deal-card-attachment-policy.ts).
//
// SCAFFOLD: the metric schema, scorecard persistence, and ranking are real;
// metric COMPUTE is left as injected source calls (defaulting to "unavailable",
// never fabricated). No paid/live calls are made here. Real adapters (Apify
// LandWatch, Census, constrained browser) wire into computeMetrics in a later pass
// through the data-provider registry.

import { R2_PATHS, type KnowledgeStore } from './knowledge-store.js';

/** The seven county metrics (Vision §5 Market Research). */
export interface CountyMetrics {
  avgPricePerAcreUsd: number | null;        // 2–5 ac, 24mo
  populationDensityPerSqMi: number | null;  // target 50–150
  daysOnMarket: number | null;              // all acreage, 90-day; target < 90
  absorptionRatePct: number | null;         // 2–5 ac, 90-day; target > 50%
  salesDensity3yr: number | null;           // all acreage; target > 400
  forSaleCount90d: number | null;           // tracked/benchmarked
  sellThroughRatePct: number | null;        // tracked/benchmarked
}

export const COUNTY_METRIC_KEYS: ReadonlyArray<keyof CountyMetrics> = [
  'avgPricePerAcreUsd', 'populationDensityPerSqMi', 'daysOnMarket', 'absorptionRatePct',
  'salesDensity3yr', 'forSaleCount90d', 'sellThroughRatePct',
];

export interface CountyScorecardEntry {
  county: string;
  state: string;
  fips?: string | null;
  metrics: CountyMetrics;
  /** Per-metric source + confidence; 'unavailable' when no source is connected. */
  metricSources: Record<keyof CountyMetrics, { source: string; confidence: 'reported' | 'unavailable' }>;
  /** 0–100 composite from available metrics only (null when too few available). */
  score: number | null;
  generatedAt: string;
  notes: string[];
}

export interface CountyScorecard {
  version: 1;
  counties: CountyScorecardEntry[];
  updatedAt: string;
}

const EMPTY_METRICS: CountyMetrics = {
  avgPricePerAcreUsd: null, populationDensityPerSqMi: null, daysOnMarket: null,
  absorptionRatePct: null, salesDensity3yr: null, forSaleCount90d: null, sellThroughRatePct: null,
};

/** Injected metric computation. Default = all unavailable (no fabrication, no
 *  live call). Real source adapters replace this in a later pass. */
export type MetricsComputer = (county: string, state: string) => Promise<{
  metrics: CountyMetrics;
  metricSources: CountyScorecardEntry['metricSources'];
}>;

function unavailableSources(): CountyScorecardEntry['metricSources'] {
  const s = {} as CountyScorecardEntry['metricSources'];
  for (const k of COUNTY_METRIC_KEYS) s[k] = { source: '(no source connected)', confidence: 'unavailable' };
  return s;
}

const defaultComputer: MetricsComputer = async () => ({ metrics: { ...EMPTY_METRICS }, metricSources: unavailableSources() });

/** Composite score from AVAILABLE metrics only, against Vision targets. Returns
 *  null when fewer than 3 metrics are available (never scores on thin data). */
export function scoreCounty(m: CountyMetrics): number | null {
  const checks: Array<number> = [];
  if (m.populationDensityPerSqMi != null) checks.push(m.populationDensityPerSqMi >= 50 && m.populationDensityPerSqMi <= 150 ? 1 : 0);
  if (m.daysOnMarket != null) checks.push(m.daysOnMarket < 90 ? 1 : 0);
  if (m.absorptionRatePct != null) checks.push(m.absorptionRatePct > 50 ? 1 : 0);
  if (m.salesDensity3yr != null) checks.push(m.salesDensity3yr > 400 ? 1 : 0);
  if (m.sellThroughRatePct != null) checks.push(m.sellThroughRatePct > 50 ? 1 : 0);
  if (m.avgPricePerAcreUsd != null) checks.push(m.avgPricePerAcreUsd > 0 ? 1 : 0);
  if (m.forSaleCount90d != null) checks.push(m.forSaleCount90d >= 0 ? 1 : 0);
  if (checks.length < 3) return null;
  return Math.round((checks.reduce((a, b) => a + b, 0) / checks.length) * 100);
}

export interface MarketResearchDeps {
  store: KnowledgeStore;
  computeMetrics?: MetricsComputer;
  nowIso?: string;
}

/** Build (or refresh) a county scorecard entry. Business intelligence — NOT a
 *  Deal Card output. Persists the scorecard to markets/county_scorecard.json. */
export async function evaluateCounty(county: string, state: string, deps: MarketResearchDeps, fips?: string): Promise<CountyScorecardEntry> {
  const now = deps.nowIso ?? new Date().toISOString();
  const { metrics, metricSources } = await (deps.computeMetrics ?? defaultComputer)(county, state);
  const anyAvailable = COUNTY_METRIC_KEYS.some((k) => metricSources[k].confidence === 'reported');
  const entry: CountyScorecardEntry = {
    county, state, fips: fips ?? null, metrics, metricSources,
    score: scoreCounty(metrics),
    generatedAt: now,
    notes: anyAvailable ? [] : ['No market-data source connected yet; metrics are unavailable, never fabricated.'],
  };
  const scorecard = await loadScorecard(deps.store);
  const i = scorecard.counties.findIndex((c) => c.county.toLowerCase() === county.toLowerCase() && c.state.toLowerCase() === state.toLowerCase());
  if (i >= 0) scorecard.counties[i] = entry; else scorecard.counties.push(entry);
  scorecard.updatedAt = now;
  await deps.store.put(R2_PATHS.countyScorecard(), JSON.stringify(scorecard, null, 2));
  return entry;
}

export async function loadScorecard(store: KnowledgeStore): Promise<CountyScorecard> {
  const txt = await store.getText(R2_PATHS.countyScorecard());
  if (!txt) return { version: 1, counties: [], updatedAt: new Date(0).toISOString() };
  try { return JSON.parse(txt) as CountyScorecard; } catch { return { version: 1, counties: [], updatedAt: new Date(0).toISOString() }; }
}
