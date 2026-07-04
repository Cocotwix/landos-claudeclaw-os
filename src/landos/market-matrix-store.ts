// LandOS — Market Matrix store (thin DB adapter over the pure core).
//
// Owns persistence for the Market Intelligence department: the validated
// snapshot table (quarterly facts by geography + band + side), saved
// MarketQueries, the ingestion review queue, and the county reference. It wires
// the pure engine in market-matrix.ts to store/landos.db. The DATABASE resolves
// which snapshot each county contributes (newest applicable) and the pure
// engine computes ranking/exclusion; the AI layer only interprets.
//
// Ingestion contract: BOTH the development fixture and live browser extraction
// call ingestMarketSnapshots(), which validates each payload, upserts the valid
// ones (with full provenance), and parks the rejected ones in the review queue
// with their exact errors. Nothing is silently repaired.

import { getLandosDb } from './db.js';
import { SEED_COUNTY_REF, SEEDED_REF_STATES, type CountyRef } from './market-county-ref.js';
import {
  validateMarketSnapshot,
  executeMarketQuery,
  explainMarketResults,
  emptyMetrics,
  comparePeriods,
  STATE_FIPS,
  FIPS_TO_STATE,
  MARKET_METRICS,
  type MarketMetrics,
  type MarketMetric,
  type MarketSnapshotPayload,
  type NormalizedMarketSnapshot,
  type MarketQuery,
  type MarketQueryResult,
  type MarketExplanation,
  type ResolvedCountySnapshot,
  type MarketSide,
  type AcreageBand,
  type Confidence,
} from './market-matrix.js';

// ─────────────────────────────────────────────────────────────────────────
// County reference seeding
// ─────────────────────────────────────────────────────────────────────────

// Track seeding PER DB INSTANCE (not a bare boolean) so a swapped database — a
// fresh in-memory test DB via _initTestLandosDb(), or a reopened file — is
// re-seeded instead of skipped by a stale module flag.
const seededDbs = new WeakSet<object>();
/** Idempotently seed the county reference. Cheap; safe to call on every entry. */
export function ensureCountyRefSeeded(): void {
  const db = getLandosDb();
  if (seededDbs.has(db)) return;
  const stmt = db.prepare('INSERT OR IGNORE INTO landos_market_county_ref (fips, state, county_name) VALUES (?, ?, ?)');
  const tx = db.transaction((rows: readonly CountyRef[]) => {
    for (const r of rows) stmt.run(r.fips, r.state, r.countyName);
  });
  tx(SEED_COUNTY_REF);
  seededDbs.add(db);
}

export function listCountyRef(state?: string): CountyRef[] {
  ensureCountyRefSeeded();
  const db = getLandosDb();
  const rows = (state
    ? db.prepare('SELECT fips, state, county_name FROM landos_market_county_ref WHERE state = ? ORDER BY county_name').all(state.toUpperCase())
    : db.prepare('SELECT fips, state, county_name FROM landos_market_county_ref ORDER BY state, county_name').all()) as Array<{ fips: string; state: string; county_name: string }>;
  return rows.map((r) => ({ fips: r.fips, state: r.state, countyName: r.county_name }));
}

// ─────────────────────────────────────────────────────────────────────────
// Ingestion
// ─────────────────────────────────────────────────────────────────────────

export type IngestCategory = 'accepted' | 'flagged' | 'unknown' | 'rejected';
export interface IngestItemResult {
  index: number;
  /** True when the record was written to the Market Matrix (accepted OR flagged). */
  accepted: boolean;
  category: IngestCategory;
  key?: string;
  /** Identity for the data-quality report (geo + level). */
  label?: string;
  errors: string[];
  flags: string[];
}
export interface IngestResult {
  total: number;
  /** Written to the matrix with no flags. */
  accepted: number;
  /** Written to the matrix but carrying ≥1 flag (accepted + flagged for review). */
  flagged: number;
  /** Valid shape but ZERO known metrics — no usable data; not written. */
  unknown: number;
  /** Rejected by validation (impossible / broken / malformed) — parked for review. */
  rejected: number;
  items: IngestItemResult[];
}

function metricsToJson(m: MarketMetrics): string {
  return JSON.stringify(m);
}
function metricsFromJson(s: string): MarketMetrics {
  const base = emptyMetrics();
  try {
    const parsed = JSON.parse(s) as Partial<MarketMetrics>;
    for (const k of MARKET_METRICS) {
      const v = parsed[k];
      base[k] = typeof v === 'number' && Number.isFinite(v) ? v : null;
    }
  } catch { /* keep empty */ }
  return base;
}

function upsertSnapshot(n: NormalizedMarketSnapshot): void {
  const db = getLandosDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO landos_market_snapshot
       (snapshot_key, geo_level, state, fips, county_name, zip, acreage_band, side, period,
        metrics_json, confidence, provider, source_ref, extraction_ts, agent_run_id, flags_json, ingested_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(snapshot_key) DO UPDATE SET
       metrics_json = excluded.metrics_json,
       confidence = excluded.confidence,
       provider = excluded.provider,
       source_ref = excluded.source_ref,
       extraction_ts = excluded.extraction_ts,
       agent_run_id = excluded.agent_run_id,
       county_name = excluded.county_name,
       flags_json = excluded.flags_json,
       updated_at = excluded.updated_at`,
  ).run(
    n.key, n.geography.level, n.geography.state, n.geography.fips ?? '', n.geography.county ?? '',
    n.geography.zip ?? '', n.acreageBand, n.side, n.period, metricsToJson(n.metrics), n.confidence,
    n.provenance.provider, n.provenance.sourceRef, n.provenance.extractionTimestamp, n.provenance.agentRunId,
    JSON.stringify(n.flags ?? []), now, now,
  );
  // Keep the reference in sync when a valid county snapshot names a county.
  if (n.geography.level === 'county' && n.geography.fips && n.geography.county) {
    db.prepare('INSERT OR IGNORE INTO landos_market_county_ref (fips, state, county_name) VALUES (?, ?, ?)')
      .run(n.geography.fips, n.geography.state, n.geography.county);
  }
}

function queueRejected(raw: unknown, errors: string[]): void {
  const provider = (() => {
    const p = (raw as { provenance?: { provider?: unknown } })?.provenance?.provider;
    return typeof p === 'string' ? p : '';
  })();
  getLandosDb().prepare(
    `INSERT INTO landos_market_review_queue (provider, raw_json, errors_json) VALUES (?, ?, ?)`,
  ).run(provider, JSON.stringify(raw ?? null), JSON.stringify(errors));
}

/**
 * Ingest raw market snapshot payloads through the SINGLE validated pipeline.
 * Valid payloads are upserted (idempotent on the snapshot key) with provenance;
 * invalid payloads are parked in the review queue with their exact errors. Both
 * the fixture and live extraction use this identical path.
 */
export function ingestMarketSnapshots(payloads: unknown[]): IngestResult {
  ensureCountyRefSeeded();
  const items: IngestItemResult[] = [];
  let accepted = 0, flagged = 0, unknown = 0, rejected = 0;
  payloads.forEach((raw, index) => {
    const v = validateMarketSnapshot(raw);
    if (!v.valid || !v.normalized) {
      queueRejected(raw, v.errors);
      rejected++;
      items.push({ index, accepted: false, category: 'rejected', errors: v.errors, flags: v.flags ?? [] });
      return;
    }
    const n = v.normalized;
    const label = snapshotLabel(n);
    const knownMetrics = MARKET_METRICS.filter((m) => n.metrics[m] !== null && n.metrics[m] !== undefined).length;
    // UNKNOWN: valid shape but no usable data — do NOT write an empty snapshot,
    // but report it so the extraction's data quality is visible.
    if (knownMetrics === 0) {
      unknown++;
      items.push({ index, accepted: false, category: 'unknown', key: n.key, label, errors: [], flags: [], });
      return;
    }
    upsertSnapshot(n);
    if (n.flags.length > 0) {
      flagged++;
      items.push({ index, accepted: true, category: 'flagged', key: n.key, label, errors: [], flags: n.flags });
    } else {
      accepted++;
      items.push({ index, accepted: true, category: 'accepted', key: n.key, label, errors: [], flags: [] });
    }
  });
  return { total: payloads.length, accepted, flagged, unknown, rejected, items };
}

/** Short human label for a snapshot (for the data-quality report). */
function snapshotLabel(n: NormalizedMarketSnapshot): string {
  if (n.geography.level === 'zip') return `ZIP ${n.geography.zip} (${n.geography.state})`;
  if (n.geography.level === 'county') return `${n.geography.county || n.geography.fips} County (${n.geography.state})`;
  return `${n.geography.state} (state)`;
}

// ─────────────────────────────────────────────────────────────────────────
// Snapshot resolution — the newest applicable county snapshot
// ─────────────────────────────────────────────────────────────────────────

interface SnapshotRow {
  fips: string; county_name: string; state: string; period: string;
  metrics_json: string; confidence: string; provider: string; extraction_ts: string;
}

/** All county-level snapshots matching a side + band (optionally a period). */
function loadCountySnapshots(side: MarketSide, band: AcreageBand, period?: string): SnapshotRow[] {
  const db = getLandosDb();
  const sql = `SELECT fips, county_name, state, period, metrics_json, confidence, provider, extraction_ts
               FROM landos_market_snapshot
               WHERE geo_level = 'county' AND side = ? AND acreage_band = ?${period ? ' AND period = ?' : ''}`;
  const args: unknown[] = period ? [side, band, period] : [side, band];
  return db.prepare(sql).all(...args) as SnapshotRow[];
}

/** Pick the newest snapshot per FIPS from a set of rows. */
function newestByCounty(rows: SnapshotRow[]): Map<string, SnapshotRow> {
  const byFips = new Map<string, SnapshotRow>();
  for (const r of rows) {
    const cur = byFips.get(r.fips);
    if (!cur || comparePeriods(r.period, cur.period) > 0) byFips.set(r.fips, r);
  }
  return byFips;
}

function resolveScopeStates(query: MarketQuery): Set<string> {
  const states = new Set<string>();
  for (const s of query.scope.states ?? []) states.add(s.toUpperCase());
  for (const f of query.scope.counties ?? []) {
    const st = FIPS_TO_STATE[f.slice(0, 2)];
    if (st) states.add(st);
  }
  return states;
}

/**
 * Build the county universe for a query: every reference county in scope UNION
 * every ingested county in scope. Each gets its newest applicable snapshot, or
 * an EMPTY-metrics snapshot (so a county with no data is EXCLUDED with a reason
 * rather than silently disappearing). This is the "database computes retrieval"
 * half; the pure engine then computes inclusion/ranking.
 */
export function resolveCountyUniverse(query: MarketQuery): ResolvedCountySnapshot[] {
  ensureCountyRefSeeded();
  const rows = loadCountySnapshots(query.side, query.acreageBand, query.period && query.period.length ? query.period : undefined);
  const newest = newestByCounty(rows);

  const scopeStates = resolveScopeStates(query);
  const scopeCounties = new Set((query.scope.counties ?? []));

  // ZIP scope → resolve to counties via any zip snapshot carrying a FIPS.
  if ((query.scope.zips ?? []).length) {
    const db = getLandosDb();
    for (const zip of query.scope.zips!) {
      const r = db.prepare(`SELECT fips FROM landos_market_snapshot WHERE zip = ? AND fips != '' LIMIT 1`).get(zip) as { fips?: string } | undefined;
      if (r?.fips) scopeCounties.add(r.fips);
    }
  }

  const universe = new Map<string, { fips: string; countyName: string; state: string }>();
  const inScope = (fips: string, state: string): boolean => {
    if (scopeCounties.size && !scopeCounties.has(fips)) return false;
    if (scopeStates.size && !scopeStates.has(state.toUpperCase())) return false;
    return true;
  };

  for (const ref of listCountyRef()) {
    if (inScope(ref.fips, ref.state)) universe.set(ref.fips, { fips: ref.fips, countyName: ref.countyName, state: ref.state });
  }
  for (const [fips, r] of newest) {
    if (inScope(fips, r.state)) universe.set(fips, { fips, countyName: r.county_name || universe.get(fips)?.countyName || fips, state: r.state });
  }

  const out: ResolvedCountySnapshot[] = [];
  for (const c of universe.values()) {
    const row = newest.get(c.fips);
    out.push({
      fips: c.fips,
      countyName: c.countyName,
      state: c.state,
      period: row?.period ?? '',
      metrics: row ? metricsFromJson(row.metrics_json) : emptyMetrics(),
      confidence: (row?.confidence as Confidence) ?? 'low',
      provider: row?.provider ?? '',
      lastUpdated: row?.extraction_ts ?? '',
    });
  }
  return out;
}

/** Run a MarketQuery end-to-end: resolve the universe, execute deterministically. */
export function runMarketQuery(query: MarketQuery): MarketQueryResult {
  return executeMarketQuery(resolveCountyUniverse(query), query);
}

/** Run a MarketQuery and attach the deterministic explanation (matches results). */
export function runMarketQueryWithExplanation(query: MarketQuery): { result: MarketQueryResult; explanation: MarketExplanation } {
  const result = runMarketQuery(query);
  return { result, explanation: explainMarketResults(result) };
}

// ─────────────────────────────────────────────────────────────────────────
// Saved MarketQueries (durable, reload-safe business assets)
// ─────────────────────────────────────────────────────────────────────────

export interface SavedMarketQuery {
  id: number;
  name: string;
  description: string;
  query: MarketQuery;
  createdAt: number;
  updatedAt: number;
}

export function saveMarketQuery(opts: { name: string; description?: string; query: MarketQuery; entity?: string | null; id?: number }): number {
  const db = getLandosDb();
  const now = Math.floor(Date.now() / 1000);
  if (opts.id) {
    db.prepare(`UPDATE landos_market_query SET name = ?, description = ?, query_json = ?, updated_at = ? WHERE id = ?`)
      .run(opts.name, opts.description ?? '', JSON.stringify(opts.query), now, opts.id);
    return opts.id;
  }
  const res = db.prepare(`INSERT INTO landos_market_query (entity, name, description, query_json) VALUES (?, ?, ?, ?)`)
    .run(opts.entity ?? null, opts.name, opts.description ?? '', JSON.stringify(opts.query));
  return res.lastInsertRowid as number;
}

function rowToSaved(r: { id: number; name: string; description: string; query_json: string; created_at: number; updated_at: number }): SavedMarketQuery {
  return { id: r.id, name: r.name, description: r.description, query: JSON.parse(r.query_json) as MarketQuery, createdAt: r.created_at, updatedAt: r.updated_at };
}

export function listMarketQueries(): SavedMarketQuery[] {
  const rows = getLandosDb().prepare(`SELECT id, name, description, query_json, created_at, updated_at FROM landos_market_query ORDER BY created_at DESC, id DESC`).all() as Array<Parameters<typeof rowToSaved>[0]>;
  return rows.map(rowToSaved);
}

export function getMarketQueryById(id: number): SavedMarketQuery | undefined {
  const r = getLandosDb().prepare(`SELECT id, name, description, query_json, created_at, updated_at FROM landos_market_query WHERE id = ?`).get(id) as Parameters<typeof rowToSaved>[0] | undefined;
  return r ? rowToSaved(r) : undefined;
}

export function deleteMarketQuery(id: number): boolean {
  return getLandosDb().prepare(`DELETE FROM landos_market_query WHERE id = ?`).run(id).changes > 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Heatmap + county drilldown + review queue + coverage
// ─────────────────────────────────────────────────────────────────────────

export interface HeatmapCell {
  fips: string;
  countyName: string;
  state: string;
  value: number | null;   // null = Unknown → render GREY (never zero)
  confidence: Confidence | null;
  period: string | null;
  hasData: boolean;
}
export interface HeatmapData {
  state: string;
  metric: MarketMetric;
  side: MarketSide;
  acreageBand: AcreageBand;
  cells: HeatmapCell[];
  min: number | null;
  max: number | null;
  knownCount: number;
  unknownCount: number;
}

/** County-level heatmap for a state: one cell per reference county, colored by
 *  the selected metric. Counties with no data (or the metric missing) return
 *  value=null so the UI renders them grey (Unknown), never zero. */
export function getHeatmapData(opts: { state: string; metric: MarketMetric; side: MarketSide; acreageBand: AcreageBand; period?: string }): HeatmapData {
  ensureCountyRefSeeded();
  const state = opts.state.toUpperCase();
  const rows = loadCountySnapshots(opts.side, opts.acreageBand, opts.period && opts.period.length ? opts.period : undefined);
  const newest = newestByCounty(rows.filter((r) => r.state.toUpperCase() === state));
  const cells: HeatmapCell[] = [];
  let min: number | null = null; let max: number | null = null; let known = 0;
  for (const ref of listCountyRef(state)) {
    const row = newest.get(ref.fips);
    const metrics = row ? metricsFromJson(row.metrics_json) : null;
    const value = metrics ? metrics[opts.metric] : null;
    const hasData = value !== null && value !== undefined;
    if (hasData) {
      known++;
      min = min === null ? value! : Math.min(min, value!);
      max = max === null ? value! : Math.max(max, value!);
    }
    cells.push({
      fips: ref.fips, countyName: ref.countyName, state: ref.state,
      value: hasData ? value! : null,
      confidence: row ? (row.confidence as Confidence) : null,
      period: row?.period ?? null,
      hasData,
    });
  }
  cells.sort((a, b) => a.countyName.localeCompare(b.countyName));
  return { state, metric: opts.metric, side: opts.side, acreageBand: opts.acreageBand, cells, min, max, knownCount: known, unknownCount: cells.length - known };
}

export interface CountyDrilldownSnapshot {
  period: string; side: MarketSide; acreageBand: AcreageBand;
  metrics: MarketMetrics; confidence: Confidence; provider: string;
  sourceRef: string; extractionTs: string;
}
export interface CountyDrilldown {
  fips: string; countyName: string; state: string;
  snapshots: CountyDrilldownSnapshot[];
  periods: string[];
}

/** Full history for one county (all periods/bands/sides), newest first. */
export function getCountyDrilldown(fips: string): CountyDrilldown | undefined {
  ensureCountyRefSeeded();
  const db = getLandosDb();
  const ref = db.prepare('SELECT fips, state, county_name FROM landos_market_county_ref WHERE fips = ?').get(fips) as { fips: string; state: string; county_name: string } | undefined;
  const rows = db.prepare(
    `SELECT period, side, acreage_band, metrics_json, confidence, provider, source_ref, extraction_ts
     FROM landos_market_snapshot WHERE geo_level = 'county' AND fips = ? ORDER BY period DESC`,
  ).all(fips) as Array<{ period: string; side: string; acreage_band: string; metrics_json: string; confidence: string; provider: string; source_ref: string; extraction_ts: string }>;
  if (!ref && rows.length === 0) return undefined;
  const snapshots = rows.map((r) => ({
    period: r.period, side: r.side as MarketSide, acreageBand: r.acreage_band as AcreageBand,
    metrics: metricsFromJson(r.metrics_json), confidence: r.confidence as Confidence,
    provider: r.provider, sourceRef: r.source_ref, extractionTs: r.extraction_ts,
  }));
  const state = ref?.state ?? FIPS_TO_STATE[fips.slice(0, 2)] ?? '';
  return {
    fips,
    countyName: ref?.county_name ?? rows[0]?.period ?? fips,
    state,
    snapshots,
    periods: [...new Set(snapshots.map((s) => s.period))],
  };
}

export interface ReviewQueueItem {
  id: number; provider: string; errors: string[]; raw: unknown; status: string; createdAt: number;
}
export function listReviewQueue(status = 'open'): ReviewQueueItem[] {
  const rows = getLandosDb().prepare(`SELECT id, provider, raw_json, errors_json, status, created_at FROM landos_market_review_queue WHERE status = ? ORDER BY created_at DESC, id DESC`).all(status) as Array<{ id: number; provider: string; raw_json: string; errors_json: string; status: string; created_at: number }>;
  return rows.map((r) => ({ id: r.id, provider: r.provider, errors: safeJson<string[]>(r.errors_json, []), raw: safeJson<unknown>(r.raw_json, null), status: r.status, createdAt: r.created_at }));
}
function safeJson<T>(s: string, fallback: T): T { try { return JSON.parse(s) as T; } catch { return fallback; } }

export interface FlaggedSnapshot {
  key: string; level: string; state: string; fips: string; countyName: string; zip: string;
  period: string; side: string; acreageBand: string; flags: string[]; provider: string; updatedAt: number;
}
/** Snapshots written to the matrix but carrying data-quality flags (accepted +
 *  flagged for review — e.g. LandPortal STR > 100%). Never hidden. */
export function listFlaggedSnapshots(limit = 200): FlaggedSnapshot[] {
  const rows = getLandosDb().prepare(
    `SELECT snapshot_key, geo_level, state, fips, county_name, zip, period, side, acreage_band, flags_json, provider, updated_at
     FROM landos_market_snapshot WHERE flags_json != '[]' AND flags_json != '' ORDER BY updated_at DESC, id DESC LIMIT ?`,
  ).all(limit) as Array<{ snapshot_key: string; geo_level: string; state: string; fips: string; county_name: string; zip: string; period: string; side: string; acreage_band: string; flags_json: string; provider: string; updated_at: number }>;
  return rows.map((r) => ({
    key: r.snapshot_key, level: r.geo_level, state: r.state, fips: r.fips, countyName: r.county_name, zip: r.zip,
    period: r.period, side: r.side, acreageBand: r.acreage_band, flags: safeJson<string[]>(r.flags_json, []), provider: r.provider, updatedAt: r.updated_at,
  }));
}

export interface MatrixCoverage {
  snapshotCount: number;
  countyWithDataCount: number;
  refCountyCount: number;
  seededStates: string[];
  periods: string[];
  reviewQueueOpen: number;
  flaggedSnapshotCount: number;
  savedQueryCount: number;
  latestPeriod: string | null;
}
export function getMatrixCoverage(): MatrixCoverage {
  ensureCountyRefSeeded();
  const db = getLandosDb();
  const snap = db.prepare(`SELECT COUNT(*) AS n FROM landos_market_snapshot`).get() as { n: number };
  const withData = db.prepare(`SELECT COUNT(DISTINCT fips) AS n FROM landos_market_snapshot WHERE geo_level = 'county' AND fips != ''`).get() as { n: number };
  const refN = db.prepare(`SELECT COUNT(*) AS n FROM landos_market_county_ref`).get() as { n: number };
  const periods = (db.prepare(`SELECT DISTINCT period FROM landos_market_snapshot WHERE period != '' ORDER BY period DESC`).all() as Array<{ period: string }>).map((r) => r.period);
  const review = db.prepare(`SELECT COUNT(*) AS n FROM landos_market_review_queue WHERE status = 'open'`).get() as { n: number };
  const flaggedN = db.prepare(`SELECT COUNT(*) AS n FROM landos_market_snapshot WHERE flags_json != '[]' AND flags_json != ''`).get() as { n: number };
  const saved = db.prepare(`SELECT COUNT(*) AS n FROM landos_market_query`).get() as { n: number };
  return {
    snapshotCount: snap.n,
    countyWithDataCount: withData.n,
    refCountyCount: refN.n,
    seededStates: [...SEEDED_REF_STATES],
    periods,
    reviewQueueOpen: review.n,
    flaggedSnapshotCount: flaggedN.n,
    savedQueryCount: saved.n,
    latestPeriod: periods[0] ?? null,
  };
}

export { STATE_FIPS };
