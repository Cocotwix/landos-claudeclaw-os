// LandOS — Market Matrix core model (pure, deterministic, DB-free).
//
// The Market Matrix is the master market-intelligence database for LandOS. It
// answers "where should Tyler buy land?" by storing FACTUAL market metrics per
// geography + acreage band + quarter, and executing deterministic MarketQueries
// over them. The database COMPUTES; the AI INTERPRETS. This module owns the
// business rules that must never move: geography identity (FIPS), the ingestion
// contract (MarketSnapshotPayload), validation (reject — never silently repair),
// deterministic query execution + ranking + exclusion reporting, the natural-
// language → MarketQuery converter, and the deterministic explanation generator
// (which reads FROM the query result so it can never disagree with it).
//
// Hard rules encoded here:
//   - County identity is the 5-digit FIPS (state 2 + county 3). County NAME is
//     display-only. State is a USPS abbreviation. ZIP resolves to a county.
//   - Unknown is null, never 0. A missing metric excludes a county from a query
//     that needs it (with a reason) — it is never treated as zero.
//   - Derived scores are NOT stored and NOT computed here beyond what a query
//     explicitly asks for; facts are stored, interpretation happens at read time.
//   - No fabrication. Validation rejects impossible/broken/missing/out-of-range
//     records; rejected records go to a review queue, never a silent fix.

// ─────────────────────────────────────────────────────────────────────────
// Geography identity
// ─────────────────────────────────────────────────────────────────────────

export const US_STATES: readonly string[] = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL',
  'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT',
  'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
];

export function isUsState(v: unknown): v is string {
  return typeof v === 'string' && (US_STATES as readonly string[]).includes(v.toUpperCase());
}

/** Canonical 5-digit county FIPS check (state 2 + county 3). */
export function isCountyFips(v: unknown): v is string {
  return typeof v === 'string' && /^\d{5}$/.test(v);
}

export function isZip(v: unknown): v is string {
  return typeof v === 'string' && /^\d{5}$/.test(v);
}

/** The 2-digit state FIPS prefix for each state, so a county FIPS can be checked
 *  against its stated USPS state. Display/validation only. */
export const STATE_FIPS: Record<string, string> = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10',
  DC: '11', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19',
  KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27',
  MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35',
  NY: '36', NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44',
  SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53',
  WV: '54', WI: '55', WY: '56',
};

/** Reverse map: 2-digit state FIPS → USPS abbreviation. */
export const FIPS_TO_STATE: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_FIPS).map(([abbr, fips]) => [fips, abbr]),
);

export type GeoLevel = 'county' | 'state' | 'zip';

export interface Geography {
  level: GeoLevel;
  state: string;          // USPS abbreviation (uppercase)
  fips?: string;          // 5-digit county FIPS (required for county level)
  county?: string;        // display-only county name
  zip?: string;           // 5-digit ZIP (required for zip level)
}

// ─────────────────────────────────────────────────────────────────────────
// Acreage bands / periods / side
// ─────────────────────────────────────────────────────────────────────────

export const ACREAGE_BANDS = ['all', '0-1', '1-2', '2-5', '5-10', '10-20', '20-50', '50-100', '100+', '50+'] as const;
export type AcreageBand = (typeof ACREAGE_BANDS)[number];
export function isAcreageBand(v: unknown): v is AcreageBand {
  return typeof v === 'string' && (ACREAGE_BANDS as readonly string[]).includes(v);
}
export const ACREAGE_BAND_LABEL: Record<AcreageBand, string> = {
  all: 'All acreage', '0-1': '0–1 acre', '1-2': '1–2 acres', '2-5': '2–5 acres', '5-10': '5–10 acres',
  '10-20': '10–20 acres', '20-50': '20–50 acres', '50-100': '50–100 acres', '100+': '100+ acres',
  '50+': '50+ acres',
};

export const MARKET_SIDES = ['sold', 'for_sale'] as const;
export type MarketSide = (typeof MARKET_SIDES)[number];
export function isMarketSide(v: unknown): v is MarketSide {
  return v === 'sold' || v === 'for_sale';
}

/** Quarterly period key: YYYY-Qn (n in 1..4). */
export function isPeriod(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-Q[1-4]$/.test(v);
}
/** Compare two period keys chronologically. Returns >0 when a is newer. */
export function comparePeriods(a: string, b: string): number {
  const pa = parsePeriod(a); const pb = parsePeriod(b);
  if (!pa || !pb) return 0;
  return pa.year !== pb.year ? pa.year - pb.year : pa.quarter - pb.quarter;
}
export function parsePeriod(v: string): { year: number; quarter: number } | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(v);
  return m ? { year: Number(m[1]), quarter: Number(m[2]) } : null;
}

export type Confidence = 'high' | 'medium' | 'low';
export function isConfidence(v: unknown): v is Confidence {
  return v === 'high' || v === 'medium' || v === 'low';
}

// ─────────────────────────────────────────────────────────────────────────
// Metrics — the factual market values. null = Unknown (never 0).
// ─────────────────────────────────────────────────────────────────────────

export const MARKET_METRICS = [
  'salesCount',
  'listingCount',
  'medianPrice',
  'medianPricePerAcre',
  'daysOnMarket',
  'sellThroughRate',
  'absorptionRate',
  'monthsOfSupply',
  'population',
  'populationDensity',
  'populationGrowth',
  'salesDensity',
] as const;
export type MarketMetric = (typeof MARKET_METRICS)[number];
export function isMarketMetric(v: unknown): v is MarketMetric {
  return typeof v === 'string' && (MARKET_METRICS as readonly string[]).includes(v);
}

export const MARKET_METRIC_LABEL: Record<MarketMetric, string> = {
  salesCount: 'Sales count',
  listingCount: 'Listing count',
  medianPrice: 'Median price',
  medianPricePerAcre: 'Median $/acre',
  daysOnMarket: 'Days on Market',
  sellThroughRate: 'Sell-through rate',
  absorptionRate: 'Absorption rate',
  monthsOfSupply: 'Months of supply',
  population: 'Population',
  populationDensity: 'Population density',
  populationGrowth: 'Population growth',
  salesDensity: 'Sales density',
};

/** Metrics that read as percentages (for display + range validation). */
const PERCENT_METRICS: MarketMetric[] = ['sellThroughRate', 'absorptionRate', 'populationGrowth'];
export function isPercentMetric(m: MarketMetric): boolean {
  return PERCENT_METRICS.includes(m);
}

export type MarketMetrics = Record<MarketMetric, number | null>;

export function emptyMetrics(): MarketMetrics {
  return Object.fromEntries(MARKET_METRICS.map((m) => [m, null])) as MarketMetrics;
}

// ─────────────────────────────────────────────────────────────────────────
// Provenance + the ingestion contract (MarketSnapshotPayload)
// ─────────────────────────────────────────────────────────────────────────

export interface MarketProvenance {
  provider: string;            // e.g. 'browser_agent:landportal'
  sourceRef: string;           // URL / screen / report reference
  extractionTimestamp: string; // ISO
  agentRunId: string;          // provider run correlation id
}

/**
 * The validated ingestion contract. The Market Intelligence department NEVER
 * consumes raw browser output — only MarketSnapshotPayload objects that pass
 * validation. Both the development fixture and live extraction flow through the
 * identical pipeline (validate → store valid / queue rejected).
 */
export interface MarketSnapshotPayload {
  geography: Geography;
  acreageBand: AcreageBand;
  side: MarketSide;
  period: string;               // YYYY-Qn
  metrics: Partial<MarketMetrics>;
  confidence: Confidence;
  provenance: MarketProvenance;
}

/** A normalized, validated snapshot ready to persist. */
export interface NormalizedMarketSnapshot {
  geography: Required<Pick<Geography, 'level' | 'state'>> & Geography;
  acreageBand: AcreageBand;
  side: MarketSide;
  period: string;
  metrics: MarketMetrics;
  confidence: Confidence;
  provenance: MarketProvenance;
  /** Stable identity for upsert: level-scope + band + side + period. */
  key: string;
  /** Values that are POSSIBLE but outside the expected operational range — the
   *  record is accepted, but each flag is surfaced for review (never silently
   *  trusted). Empty for a clean record. */
  flags: string[];
}

export interface ValidationResult {
  valid: boolean;
  normalized?: NormalizedMarketSnapshot;
  /** Hard failures — the record is rejected (impossible / broken / malformed). */
  errors: string[];
  /** Soft warnings — the record is accepted but flagged for review. */
  flags: string[];
}

// Two-tier metric bounds, grounded in LandPortal's OWN metric definitions:
//   - HARD [hardMin, hardMax]: outside = IMPOSSIBLE → REJECT (never clamped). A
//     value here is a parse error or broken data, not a real market reading.
//   - SOFT [softMin, softMax] (optional): inside hard but outside soft = POSSIBLE
//     but unusual → ACCEPT + FLAG for review (never silently trusted, never lost).
// Unknown (null / undefined / omitted) is allowed and stored as null.
//
// Sell-Through Rate (LandPortal: "Sold parcels ÷ Parcels listed for sale × 100")
// LEGITIMATELY exceeds 100% when period sales outrun current listings (thin
// inventory) — observed up to ~126% at state level and 400%+ at ZIP level in live
// data. So STR is NOT capped at 100 (that earlier assumption was wrong); it is
// flagged above 100 and only rejected as garbage above a very high hard cap or
// when negative (a sell-through can't be negative).
// Absorption Rate (LandPortal: "Sold ÷ Total available × 100") is conventionally
// 0–100% (observed ≤ ~56% at state level) but can run higher in thin markets;
// same treatment: flag above 100, reject only negatives / absurd values.
interface MetricBounds { hardMin: number; hardMax: number; softMin?: number; softMax?: number }
const METRIC_BOUNDS: Record<MarketMetric, MetricBounds> = {
  salesCount: { hardMin: 0, hardMax: 5_000_000 },
  listingCount: { hardMin: 0, hardMax: 5_000_000 },
  medianPrice: { hardMin: 0, hardMax: 1_000_000_000 },
  medianPricePerAcre: { hardMin: 0, hardMax: 100_000_000 },
  daysOnMarket: { hardMin: 0, hardMax: 3650 },
  sellThroughRate: { hardMin: 0, hardMax: 10_000, softMin: 0, softMax: 100 },
  absorptionRate: { hardMin: 0, hardMax: 10_000, softMin: 0, softMax: 100 },
  monthsOfSupply: { hardMin: 0, hardMax: 600, softMin: 0, softMax: 240 },
  population: { hardMin: 0, hardMax: 50_000_000 },
  populationDensity: { hardMin: 0, hardMax: 200_000 },
  populationGrowth: { hardMin: -100, hardMax: 1000, softMin: -50, softMax: 50 },
  salesDensity: { hardMin: 0, hardMax: 1_000_000 },
};

/** A human-readable "why this is flagged, not rejected" note per metric. */
function flagReason(metric: MarketMetric, v: number, b: MetricBounds): string {
  if (metric === 'sellThroughRate') return `${MARKET_METRIC_LABEL[metric]}=${v}% exceeds the usual 0–100% — legitimate for LandPortal STR (sold ÷ listed; thin inventory sells more than is currently listed). Accepted, flagged for review.`;
  if (metric === 'absorptionRate') return `${MARKET_METRIC_LABEL[metric]}=${v}% exceeds the usual 0–100% — possible in a thin market (sold ÷ total available). Accepted, flagged for review.`;
  return `${MARKET_METRIC_LABEL[metric]}=${v} is outside the expected range [${b.softMin}, ${b.softMax}]. Accepted, flagged for review.`;
}

function geoKey(g: Geography): string {
  if (g.level === 'zip') return `zip:${g.zip}`;
  if (g.level === 'county') return `county:${g.fips}`;
  return `state:${g.state}`;
}

/** Build the stable upsert key for a normalized snapshot. */
export function snapshotKey(s: {
  geography: Geography; acreageBand: AcreageBand; side: MarketSide; period: string;
}): string {
  return `${geoKey(s.geography)}|${s.acreageBand}|${s.side}|${s.period}`;
}

/**
 * Validate a raw ingestion payload. Returns valid + normalized, OR valid=false
 * with an explicit list of every reason. NEVER silently repairs a value: a bad
 * value is a rejection reason, not a fix. Unknown metrics are allowed (stored as
 * null); only PRESENT-but-impossible metrics reject.
 */
export function validateMarketSnapshot(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const p = (raw ?? {}) as Partial<MarketSnapshotPayload>;

  // ── Geography ──────────────────────────────────────────────────────────
  const g = (p.geography ?? {}) as Partial<Geography>;
  const level = g.level;
  if (level !== 'county' && level !== 'state' && level !== 'zip') {
    errors.push(`geography.level must be county|state|zip (got ${JSON.stringify(g.level)})`);
  }
  const state = typeof g.state === 'string' ? g.state.toUpperCase() : '';
  if (!isUsState(state)) errors.push(`geography.state must be a USPS abbreviation (got ${JSON.stringify(g.state)})`);

  let fips = typeof g.fips === 'string' ? g.fips.trim() : undefined;
  let zip = typeof g.zip === 'string' ? g.zip.trim() : undefined;
  if (level === 'county') {
    if (!isCountyFips(fips)) {
      errors.push(`county geography requires a 5-digit FIPS (got ${JSON.stringify(g.fips)})`);
    } else if (isUsState(state) && fips!.slice(0, 2) !== STATE_FIPS[state]) {
      errors.push(`county FIPS ${fips} does not belong to state ${state} (expected prefix ${STATE_FIPS[state]})`);
    }
  }
  if (level === 'zip') {
    if (!isZip(zip)) errors.push(`zip geography requires a 5-digit ZIP (got ${JSON.stringify(g.zip)})`);
    // A ZIP snapshot may carry the resolved county FIPS; if present it must be valid.
    if (fips !== undefined && !isCountyFips(fips)) errors.push(`zip geography FIPS, when present, must be 5 digits (got ${JSON.stringify(g.fips)})`);
  }
  if (level === 'state' && fips !== undefined && !isCountyFips(fips)) {
    errors.push(`state geography must not carry a county FIPS`);
    fips = undefined;
  }

  // ── Dimensions ─────────────────────────────────────────────────────────
  if (!isAcreageBand(p.acreageBand)) errors.push(`acreageBand invalid (got ${JSON.stringify(p.acreageBand)})`);
  if (!isMarketSide(p.side)) errors.push(`side must be sold|for_sale (got ${JSON.stringify(p.side)})`);
  if (!isPeriod(p.period)) errors.push(`period must be YYYY-Qn (got ${JSON.stringify(p.period)})`);
  if (!isConfidence(p.confidence)) errors.push(`confidence must be high|medium|low (got ${JSON.stringify(p.confidence)})`);

  // ── Provenance ─────────────────────────────────────────────────────────
  const prov = (p.provenance ?? {}) as Partial<MarketProvenance>;
  if (!prov.provider || typeof prov.provider !== 'string') errors.push('provenance.provider is required');
  if (!prov.extractionTimestamp || typeof prov.extractionTimestamp !== 'string' || Number.isNaN(Date.parse(prov.extractionTimestamp))) {
    errors.push('provenance.extractionTimestamp must be an ISO timestamp');
  }

  // ── Metrics: present-but-IMPOSSIBLE (outside hard bounds) rejects; present-
  //    but-UNUSUAL (outside soft bounds) is accepted + flagged; missing is fine. ─
  const metrics = emptyMetrics();
  const flags: string[] = [];
  const rawMetrics = (p.metrics ?? {}) as Partial<MarketMetrics>;
  for (const key of Object.keys(rawMetrics)) {
    if (!isMarketMetric(key)) { errors.push(`unknown metric "${key}"`); continue; }
    const v = rawMetrics[key];
    if (v === null || v === undefined) continue; // unknown, allowed
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(`metric ${key} must be a finite number or null (got ${JSON.stringify(v)})`);
      continue;
    }
    const b = METRIC_BOUNDS[key];
    if (v < b.hardMin || v > b.hardMax) {
      errors.push(`metric ${key}=${v} is impossible (outside hard range [${b.hardMin}, ${b.hardMax}]) — rejected as broken/parse error`);
      continue;
    }
    metrics[key] = v; // accepted value
    if ((b.softMin !== undefined && v < b.softMin) || (b.softMax !== undefined && v > b.softMax)) {
      flags.push(flagReason(key, v, b));
    }
  }

  if (errors.length > 0) return { valid: false, errors, flags };

  const geography: Geography = {
    level: level!,
    state,
    ...(fips ? { fips } : {}),
    ...(g.county ? { county: String(g.county) } : {}),
    ...(zip ? { zip } : {}),
  };
  const normalized: NormalizedMarketSnapshot = {
    geography: geography as NormalizedMarketSnapshot['geography'],
    acreageBand: p.acreageBand as AcreageBand,
    side: p.side as MarketSide,
    period: p.period as string,
    metrics,
    confidence: p.confidence as Confidence,
    provenance: {
      provider: prov.provider as string,
      sourceRef: typeof prov.sourceRef === 'string' ? prov.sourceRef : '',
      extractionTimestamp: prov.extractionTimestamp as string,
      agentRunId: typeof prov.agentRunId === 'string' ? prov.agentRunId : '',
    },
    key: '',
    flags,
  };
  normalized.key = snapshotKey(normalized);
  return { valid: true, normalized, errors: [], flags };
}

// ─────────────────────────────────────────────────────────────────────────
// MarketQuery — the reusable structured search business object
// ─────────────────────────────────────────────────────────────────────────

export type ThresholdOp = 'gte' | 'lte' | 'gt' | 'lt' | 'eq';
export interface MarketThreshold {
  metric: MarketMetric;
  op: ThresholdOp;
  value: number;
}
export interface MarketQuerySort {
  metric: MarketMetric;
  direction: 'asc' | 'desc';
}
export interface MarketQueryScope {
  states?: string[];      // USPS abbreviations
  counties?: string[];    // 5-digit FIPS
  zips?: string[];        // 5-digit ZIPs
}

export interface MarketQuery {
  name?: string;
  side: MarketSide;
  acreageBand: AcreageBand;
  /** '' or omitted = newest available per county. */
  period?: string;
  scope: MarketQueryScope;
  thresholds: MarketThreshold[];
  sort: MarketQuerySort;
  limit?: number;
}

export function defaultMarketQuery(): MarketQuery {
  return {
    side: 'sold',
    acreageBand: '2-5',
    scope: {},
    thresholds: [],
    sort: { metric: 'medianPricePerAcre', direction: 'asc' },
    limit: 100,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Deterministic query execution over resolved county snapshots
// ─────────────────────────────────────────────────────────────────────────

/** A county's newest-applicable snapshot, as resolved by the store, plus its
 *  display identity. The pure engine reasons only over these. */
export interface ResolvedCountySnapshot {
  fips: string;
  countyName: string;
  state: string;
  period: string;
  metrics: MarketMetrics;
  confidence: Confidence;
  provider: string;
  lastUpdated: string;
}

export interface RankedCounty {
  fips: string;
  countyName: string;
  state: string;
  rank: number;
  sortValue: number;
  period: string;
  confidence: Confidence;
  metrics: MarketMetrics;
  /** The threshold + sort metric values that made this county qualify. */
  qualifyingMetrics: Array<{ metric: MarketMetric; value: number }>;
}

export interface ExcludedCounty {
  fips: string;
  countyName: string;
  state: string;
  reasons: string[];
  missingMetrics: MarketMetric[];
}

export interface MarketQueryResult {
  query: MarketQuery;
  results: RankedCounty[];
  excluded: ExcludedCounty[];
  analyzedCount: number;
  includedCount: number;
  excludedCount: number;
}

function passesThreshold(v: number, op: ThresholdOp, target: number): boolean {
  switch (op) {
    case 'gte': return v >= target;
    case 'lte': return v <= target;
    case 'gt': return v > target;
    case 'lt': return v < target;
    case 'eq': return v === target;
  }
}

export const OP_LABEL: Record<ThresholdOp, string> = {
  gte: 'at least', lte: 'at most', gt: 'above', lt: 'below', eq: 'equal to',
};

function inScope(c: ResolvedCountySnapshot, scope: MarketQueryScope): boolean {
  const states = scope.states?.map((s) => s.toUpperCase());
  if (states && states.length && !states.includes(c.state.toUpperCase())) return false;
  if (scope.counties && scope.counties.length && !scope.counties.includes(c.fips)) return false;
  // ZIP scope is resolved to counties before this engine runs; a county passes
  // ZIP scope only if the store included it (empty zips = no ZIP restriction).
  return true;
}

/**
 * Execute a MarketQuery deterministically over the resolved per-county snapshots.
 * The DATABASE decides which snapshot each county contributes (newest applicable
 * for the side/band/period); THIS decides who qualifies + the ranking. A county
 * missing ANY metric the query needs (a threshold metric or the sort metric) is
 * EXCLUDED with a reason — never treated as 0 and never silently dropped.
 */
export function executeMarketQuery(
  snapshots: ResolvedCountySnapshot[],
  query: MarketQuery,
): MarketQueryResult {
  const neededMetrics = new Set<MarketMetric>([query.sort.metric, ...query.thresholds.map((t) => t.metric)]);
  const inScopeSnaps = snapshots.filter((s) => inScope(s, query.scope));

  const results: RankedCounty[] = [];
  const excluded: ExcludedCounty[] = [];

  for (const s of inScopeSnaps) {
    const missing: MarketMetric[] = [];
    for (const m of neededMetrics) if (s.metrics[m] === null || s.metrics[m] === undefined) missing.push(m);
    if (missing.length > 0) {
      excluded.push({
        fips: s.fips, countyName: s.countyName, state: s.state,
        reasons: missing.map((m) => `Missing ${MARKET_METRIC_LABEL[m]}`),
        missingMetrics: missing,
      });
      continue;
    }
    // All needed metrics present — evaluate thresholds.
    let passes = true;
    const qualifying: Array<{ metric: MarketMetric; value: number }> = [];
    for (const t of query.thresholds) {
      const v = s.metrics[t.metric] as number;
      if (!passesThreshold(v, t.op, t.value)) { passes = false; break; }
      qualifying.push({ metric: t.metric, value: v });
    }
    if (!passes) continue; // filtered out by a threshold (not "excluded for missing data")
    const sortValue = s.metrics[query.sort.metric] as number;
    qualifying.push({ metric: query.sort.metric, value: sortValue });
    results.push({
      fips: s.fips, countyName: s.countyName, state: s.state,
      rank: 0, sortValue, period: s.period, confidence: s.confidence,
      metrics: s.metrics, qualifyingMetrics: qualifying,
    });
  }

  // Deterministic sort: by sort metric, tie-break by FIPS for stability.
  results.sort((a, b) => {
    const cmp = query.sort.direction === 'asc' ? a.sortValue - b.sortValue : b.sortValue - a.sortValue;
    return cmp !== 0 ? cmp : a.fips.localeCompare(b.fips);
  });
  const limit = query.limit && query.limit > 0 ? query.limit : results.length;
  const limited = results.slice(0, limit);
  limited.forEach((r, i) => { r.rank = i + 1; });

  return {
    query,
    results: limited,
    excluded,
    analyzedCount: inScopeSnaps.length,
    includedCount: limited.length,
    excludedCount: excluded.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Deterministic explanation — reads FROM the result, so it always matches
// ─────────────────────────────────────────────────────────────────────────

export interface MarketExplanation {
  headline: string;
  perCounty: Array<{ fips: string; countyName: string; state: string; rank: number; why: string }>;
  excludedSummary: string;
  method: string;
}

const fmtMetric = (m: MarketMetric, v: number): string => {
  if (m === 'medianPrice' || m === 'medianPricePerAcre') return `$${Math.round(v).toLocaleString()}`;
  if (isPercentMetric(m)) return `${v}%`;
  if (m === 'daysOnMarket') return `${Math.round(v)} days`;
  if (m === 'monthsOfSupply') return `${v} mo`;
  return Math.round(v).toLocaleString();
};

/**
 * Generate the operator explanation for WHY each county qualified — sourced
 * ENTIRELY from the deterministic MarketQueryResult (never a separate compute).
 * Because every value comes from the result rows, the explanation can never
 * disagree with the ranking (acceptance: AI explanations exactly match results).
 */
export function explainMarketResults(result: MarketQueryResult): MarketExplanation {
  const { query } = result;
  const sortLabel = MARKET_METRIC_LABEL[query.sort.metric];
  const dir = query.sort.direction === 'asc' ? 'lowest-first' : 'highest-first';
  const thresholdText = query.thresholds.length
    ? query.thresholds.map((t) => `${MARKET_METRIC_LABEL[t.metric]} ${OP_LABEL[t.op]} ${fmtMetric(t.metric, t.value)}`).join(', ')
    : 'no threshold filters';

  const perCounty = result.results.map((r) => {
    const parts = r.qualifyingMetrics.map((q) => `${MARKET_METRIC_LABEL[q.metric]} ${fmtMetric(q.metric, q.value)}`);
    const why = `Ranked #${r.rank} in ${r.state}. ${r.countyName} qualified with ${parts.join('; ')} (${ACREAGE_BAND_LABEL[query.acreageBand]}, ${query.side === 'sold' ? 'sold' : 'for-sale'}, ${r.period}, confidence ${r.confidence}).`;
    return { fips: r.fips, countyName: r.countyName, state: r.state, rank: r.rank, why };
  });

  const headline = result.includedCount > 0
    ? `${result.includedCount} counties matched, ranked by ${sortLabel} (${dir}); filters: ${thresholdText}.`
    : `No counties matched (filters: ${thresholdText}). ${result.excludedCount} excluded for missing data.`;

  const excludedSummary = result.excludedCount > 0
    ? `${result.excludedCount} of ${result.analyzedCount} counties in scope were excluded for missing required data (never counted as zero).`
    : 'No counties were excluded for missing data in scope.';

  return {
    headline,
    perCounty,
    excludedSummary,
    method: 'Rankings are computed deterministically by the Market Matrix database. This explanation reports those exact results; it never re-estimates or overrides them.',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Natural language → MarketQuery converter (deterministic v1)
// ─────────────────────────────────────────────────────────────────────────

export interface NlParseResult {
  query: MarketQuery;
  recognized: string[];
  unrecognized: string[];
}

const STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

/**
 * Convert an operator's natural-language market question into a structured
 * MarketQuery. This is the deterministic v1 converter: it recognizes the common
 * operator patterns (top-N, acreage bands, metric thresholds, sort intent, state
 * scope, side) and reports exactly what it recognized and what it did not — it
 * never invents a filter it did not read. The database then executes the query.
 */
export function parseMarketQuery(text: string): NlParseResult {
  const q = defaultMarketQuery();
  const recognized: string[] = [];
  const t = ` ${text.toLowerCase()} `;

  // Side
  if (/\bfor[- ]?sale\b|\bactive\b|\blisting/.test(t)) { q.side = 'for_sale'; recognized.push('side: for sale'); }
  else if (/\bsold\b|\bsales\b|\bclosed\b/.test(t)) { q.side = 'sold'; recognized.push('side: sold'); }

  // Acreage band
  const bandMatch =
    /\b2\s*(?:-|to)\s*5\b/.test(t) ? '2-5'
      : /\b5\s*(?:-|to)\s*10\b/.test(t) ? '5-10'
        : /\b10\s*(?:-|to)\s*20\b/.test(t) ? '10-20'
          : /\b20\s*(?:-|to)\s*50\b/.test(t) ? '20-50'
            : /\b50\s*\+|\b50\s*(?:plus|and up|acres or more)/.test(t) ? '50+'
              : /\ball acreage\b|\ball bands\b/.test(t) ? 'all'
                : null;
  if (bandMatch) { q.acreageBand = bandMatch as AcreageBand; recognized.push(`acreage band: ${ACREAGE_BAND_LABEL[bandMatch as AcreageBand]}`); }
  else if (/\bflip/.test(t)) { q.acreageBand = '2-5'; recognized.push('acreage band: 2–5 acres (from "flip")'); }

  // top N
  const topN = /\btop\s+(\d{1,4})\b/.exec(t);
  if (topN) { q.limit = Number(topN[1]); recognized.push(`limit: top ${topN[1]}`); }

  // Thresholds
  const num = (s: string) => Number(s.replace(/[$,%\s]/g, ''));
  const thresh = (metric: MarketMetric, op: ThresholdOp, value: number, label: string) => {
    q.thresholds.push({ metric, op, value }); recognized.push(label);
  };
  let m: RegExpExecArray | null;
  if ((m = /\b(?:str|sell[- ]?through)\b[^0-9]*(above|over|greater than|at least|>=|>|under|below|less than|<=|<)?\s*(\d{1,3})\s*%?/.exec(t))) {
    const op = /under|below|less|<=|<$/.test(m[1] ?? '') ? (/<=/.test(m[1] ?? '') ? 'lte' : 'lt') : (/at least|>=/.test(m[1] ?? '') ? 'gte' : 'gt');
    thresh('sellThroughRate', op, num(m[2]), `sell-through ${OP_LABEL[op]} ${num(m[2])}%`);
  }
  if ((m = /\b(?:dom|days on market)\b[^0-9]*(above|over|greater than|at least|>=|>|under|below|less than|<=|<)?\s*(\d{1,4})/.exec(t))) {
    const op = /above|over|greater|>|at least|>=/.test(m[1] ?? '') ? (/at least|>=/.test(m[1] ?? '') ? 'gte' : 'gt') : (/<=/.test(m[1] ?? '') ? 'lte' : 'lt');
    thresh('daysOnMarket', op, num(m[2]), `days-on-market ${OP_LABEL[op]} ${num(m[2])}`);
  }
  if ((m = /\bpopulation growth\b[^0-9-]*(above|over|greater than|at least|>=|>|under|below|less than|<=|<)?\s*(-?\d{1,3})\s*%?/.exec(t))) {
    const op = /under|below|less|<=|<$/.test(m[1] ?? '') ? (/<=/.test(m[1] ?? '') ? 'lte' : 'lt') : (/at least|>=/.test(m[1] ?? '') ? 'gte' : 'gt');
    thresh('populationGrowth', op, num(m[2]), `population growth ${OP_LABEL[op]} ${num(m[2])}%`);
  }

  // Sort intent (last recognized sort intent wins).
  if (/\blow(est)?\s+price per acre\b|\bcheap(est)?\b|\blow \$\/ac/.test(t)) { q.sort = { metric: 'medianPricePerAcre', direction: 'asc' }; recognized.push('sort: lowest $/acre'); }
  else if (/\bhigh(est)?\s+price per acre\b/.test(t)) { q.sort = { metric: 'medianPricePerAcre', direction: 'desc' }; recognized.push('sort: highest $/acre'); }
  else if (/\bpopulation growth\b|\bgrow(ing|th)\b|\bfast(est)? growing\b/.test(t)) { q.sort = { metric: 'populationGrowth', direction: 'desc' }; recognized.push('sort: strongest population growth'); }
  else if (/\bhigh(est)? (liquidity|sell[- ]?through)\b|\bliquid\b|\bmost liquid\b/.test(t)) { q.sort = { metric: 'sellThroughRate', direction: 'desc' }; recognized.push('sort: highest sell-through (liquidity)'); }
  else if (/\blow(est)? days on market\b|\bfast(est)? selling\b|\blow dom\b/.test(t)) { q.sort = { metric: 'daysOnMarket', direction: 'asc' }; recognized.push('sort: lowest days-on-market'); }
  else if (/\bmost sales\b|\bhigh(est)? sales\b|\bmost active\b/.test(t)) { q.sort = { metric: 'salesCount', direction: 'desc' }; recognized.push('sort: most sales'); }

  // State scope
  const states = new Set<string>();
  for (const [name, abbr] of Object.entries(STATE_NAME_TO_ABBR)) {
    if (new RegExp(`\\b${name}\\b`).test(t)) states.add(abbr);
  }
  for (const abbr of US_STATES) {
    if (new RegExp(`\\b${abbr.toLowerCase()}\\b`).test(t) && abbr.length === 2) {
      // Avoid false positives on common 2-letter words by requiring uppercase in source OR a state name already found.
      if (new RegExp(`\\b${abbr}\\b`).test(text)) states.add(abbr);
    }
  }
  if (states.size) { q.scope.states = [...states]; recognized.push(`states: ${[...states].join(', ')}`); }

  // Unrecognized: content words we did not map (for honesty, not for guessing).
  const consumedRe = /\b(top|\d+|acre|acres|flip|flips|str|sell|through|dom|days|market|population|growth|price|per|low|lowest|high|highest|cheap|cheapest|liquid|liquidity|sold|sales|for|sale|active|listing|listings|counties|county|land|in|the|with|and|under|over|above|below|at|least|than|greater|less|most|fast|fastest|selling|band|bands|all|plus|or|more|to)\b/g;
  const unrecognized = text.toLowerCase()
    .replace(/[^a-z0-9%$ ]/g, ' ')
    .replace(consumedRe, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STATE_NAME_TO_ABBR[w] && !US_STATES.includes(w.toUpperCase()));

  return { query: q, recognized, unrecognized: [...new Set(unrecognized)] };
}
