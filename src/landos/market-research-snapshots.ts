// LandOS — Market Research quarterly snapshot store.
//
// The Market Research department's retained market dataset: LandPortal Drill
// Deep values collected through the visible authenticated browser workflow and
// OWNED by LandOS so quarterly historical comparison happens here, not at the
// provider. One MarketSnapshot per reporting quarter + exact filter set; every
// metric row belongs to exactly one snapshot + geography and is IMMUTABLE once
// written (INSERT OR IGNORE — a later collection can only add missing
// geographies, never overwrite retained research). Corrections go through the
// audited correction log only. Geography identity is shared with the Market
// Matrix (USPS state / 5-digit county FIPS / 5-digit ZIP): one geography
// system, one database (store/landos.db).

import { getLandosDb } from './db.js';
import {
  FIPS_TO_STATE, MARKET_METRICS, emptyMetrics, isUsState, isCountyFips, isZip,
  type AcreageBand, type MarketMetrics,
} from './market-matrix.js';

// ─────────────────────────────────────────────────────────────────────────
// Filters — the exact applied collection filter set
// ─────────────────────────────────────────────────────────────────────────

export interface MarketResearchFilters {
  status: 'sold';
  propertyType: 'land';
  lookbackMonths: 12;
  acreageBand: AcreageBand;
}

export function fixedInitialFilters(band: AcreageBand = '2-5'): MarketResearchFilters {
  return { status: 'sold', propertyType: 'land', lookbackMonths: 12, acreageBand: band };
}

/** Canonical identity string for a filter set — QoQ comparison is only ever
 *  allowed between snapshots sharing this exact key. */
export function marketFilterKey(f: MarketResearchFilters): string {
  return `${f.status}|${f.propertyType}|${f.lookbackMonths}mo|${f.acreageBand}`;
}

export function describeFilters(f: MarketResearchFilters): string {
  return `Sold · Land · trailing 1 year · ${f.acreageBand} acres`;
}

/** Reporting quarter (YYYY-Qn) for a collection date. */
export function quarterForDate(d = new Date()): string {
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Geography — shared State → County → ZIP hierarchy
// ─────────────────────────────────────────────────────────────────────────

export type MrGeoLevel = 'state' | 'county' | 'zip';

export interface MrGeographyInput {
  level: MrGeoLevel;
  state: string;           // USPS abbreviation
  fips?: string;           // county FIPS (county rows; zip rows carry parent county fips)
  zip?: string;            // 5-digit ZIP (zip rows)
  name?: string;           // display name
}

export interface MrGeography {
  id: number;
  geoKey: string;
  level: MrGeoLevel;
  state: string;
  fips: string;
  zip: string;
  name: string;
  parentKey: string;
}

export const STATE_NAME: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};

export function mrGeoKey(g: MrGeographyInput): string {
  if (g.level === 'zip') return `zip:${g.zip}`;
  if (g.level === 'county') return `county:${g.fips}`;
  return `state:${g.state.toUpperCase()}`;
}

function mrParentKey(g: MrGeographyInput): string {
  if (g.level === 'zip') return g.fips ? `county:${g.fips}` : `state:${g.state.toUpperCase()}`;
  if (g.level === 'county') {
    // A county's canonical state is its FIPS prefix (border counties can be
    // shown under an adjacent state's grouping by the provider).
    const st = g.fips ? FIPS_TO_STATE[g.fips.slice(0, 2)] : undefined;
    return `state:${(st ?? g.state).toUpperCase()}`;
  }
  return 'us';
}

/** Validate a geography input; returns null (never throws) for a broken
 *  identity so a bad provider row falls out instead of fabricating identity. */
export function validateMrGeography(g: MrGeographyInput): MrGeographyInput | null {
  const state = (g.state || '').toUpperCase();
  if (g.level === 'state') return isUsState(state) ? { ...g, state } : null;
  if (g.level === 'county') {
    if (!isCountyFips(g.fips)) return null;
    const trueState = FIPS_TO_STATE[g.fips!.slice(0, 2)];
    return trueState ? { ...g, state: trueState } : null;
  }
  if (!isZip(g.zip)) return null;
  if (g.fips !== undefined && !isCountyFips(g.fips)) return null;
  return isUsState(state) ? { ...g, state } : null;
}

/** Idempotently register a geography; returns its stable row. Name fills in
 *  when we learn it (a display improvement, never an identity change). */
export function ensureMrGeography(input: MrGeographyInput): MrGeography | null {
  const g = validateMrGeography(input);
  if (!g) return null;
  const db = getLandosDb();
  const geoKey = mrGeoKey(g);
  const parentKey = mrParentKey(g);
  const name = g.name?.trim()
    || (g.level === 'state' ? (STATE_NAME[g.state] ?? g.state) : g.level === 'zip' ? `ZIP ${g.zip}` : '');
  db.prepare(
    `INSERT INTO landos_mr_geography (geo_key, level, state, fips, zip, name, parent_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(geo_key) DO UPDATE SET
       name = CASE WHEN excluded.name != '' THEN excluded.name ELSE landos_mr_geography.name END,
       parent_key = CASE WHEN excluded.parent_key != '' THEN excluded.parent_key ELSE landos_mr_geography.parent_key END`,
  ).run(geoKey, g.level, g.state, g.fips ?? '', g.zip ?? '', name, parentKey);
  const row = db.prepare('SELECT id, geo_key, level, state, fips, zip, name, parent_key FROM landos_mr_geography WHERE geo_key = ?').get(geoKey) as
    { id: number; geo_key: string; level: MrGeoLevel; state: string; fips: string; zip: string; name: string; parent_key: string };
  return { id: row.id, geoKey: row.geo_key, level: row.level, state: row.state, fips: row.fips, zip: row.zip, name: row.name, parentKey: row.parent_key };
}

export function getMrGeography(geoKey: string): MrGeography | null {
  const row = getLandosDb().prepare('SELECT id, geo_key, level, state, fips, zip, name, parent_key FROM landos_mr_geography WHERE geo_key = ?').get(geoKey) as
    { id: number; geo_key: string; level: MrGeoLevel; state: string; fips: string; zip: string; name: string; parent_key: string } | undefined;
  return row ? { id: row.id, geoKey: row.geo_key, level: row.level, state: row.state, fips: row.fips, zip: row.zip, name: row.name, parentKey: row.parent_key } : null;
}

// ─────────────────────────────────────────────────────────────────────────
// Snapshots
// ─────────────────────────────────────────────────────────────────────────

export interface MrSnapshot {
  id: number;
  quarter: string;
  filterKey: string;
  filters: MarketResearchFilters;
  provider: string;
  collectedAt: string;      // ISO — first real collection into this snapshot
  status: 'collecting' | 'retained';
  counts: { state: number; county: number; zip: number };
}

interface MrSnapshotRow {
  id: number; quarter: string; filter_key: string; filters_json: string;
  provider: string; collected_at: string; status: 'collecting' | 'retained';
}

function snapshotCounts(id: number): MrSnapshot['counts'] {
  const rows = getLandosDb().prepare(
    `SELECT g.level AS level, COUNT(*) AS n FROM landos_mr_metric m
     JOIN landos_mr_geography g ON g.id = m.geography_id
     WHERE m.snapshot_id = ? GROUP BY g.level`,
  ).all(id) as Array<{ level: MrGeoLevel; n: number }>;
  const counts = { state: 0, county: 0, zip: 0 };
  for (const r of rows) counts[r.level] = r.n;
  return counts;
}

function rowToSnapshot(r: MrSnapshotRow): MrSnapshot {
  let filters: MarketResearchFilters;
  try { filters = JSON.parse(r.filters_json) as MarketResearchFilters; }
  catch { filters = fixedInitialFilters(); }
  return {
    id: r.id, quarter: r.quarter, filterKey: r.filter_key, filters,
    provider: r.provider, collectedAt: r.collected_at, status: r.status,
    counts: snapshotCounts(r.id),
  };
}

/** Get or create the snapshot for a quarter + filter set. NEVER reuses a
 *  snapshot across different filter sets or quarters. */
export function getOrCreateMrSnapshot(opts: {
  quarter: string; filters: MarketResearchFilters; provider: string; collectedAt?: string;
}): MrSnapshot {
  const db = getLandosDb();
  const key = marketFilterKey(opts.filters);
  const existing = db.prepare('SELECT id, quarter, filter_key, filters_json, provider, collected_at, status FROM landos_mr_snapshot WHERE quarter = ? AND filter_key = ?')
    .get(opts.quarter, key) as MrSnapshotRow | undefined;
  if (existing) return rowToSnapshot(existing);
  db.prepare(
    `INSERT INTO landos_mr_snapshot (quarter, filter_key, filters_json, provider, collected_at, status)
     VALUES (?, ?, ?, ?, ?, 'collecting')`,
  ).run(opts.quarter, key, JSON.stringify(opts.filters), opts.provider, opts.collectedAt ?? new Date().toISOString());
  const row = db.prepare('SELECT id, quarter, filter_key, filters_json, provider, collected_at, status FROM landos_mr_snapshot WHERE quarter = ? AND filter_key = ?')
    .get(opts.quarter, key) as MrSnapshotRow;
  return rowToSnapshot(row);
}

export function listMrSnapshots(): MrSnapshot[] {
  const rows = getLandosDb().prepare(
    'SELECT id, quarter, filter_key, filters_json, provider, collected_at, status FROM landos_mr_snapshot ORDER BY quarter DESC, id DESC',
  ).all() as MrSnapshotRow[];
  return rows.map(rowToSnapshot);
}

export function getMrSnapshot(id: number): MrSnapshot | null {
  const row = getLandosDb().prepare('SELECT id, quarter, filter_key, filters_json, provider, collected_at, status FROM landos_mr_snapshot WHERE id = ?')
    .get(id) as MrSnapshotRow | undefined;
  return row ? rowToSnapshot(row) : null;
}

/** The prior snapshot with the SAME exact filter set (nearest earlier quarter),
 *  or null. Mismatched filter sets never compare. */
export function priorMrSnapshot(current: MrSnapshot): MrSnapshot | null {
  const row = getLandosDb().prepare(
    `SELECT id, quarter, filter_key, filters_json, provider, collected_at, status FROM landos_mr_snapshot
     WHERE filter_key = ? AND quarter < ? ORDER BY quarter DESC, id DESC LIMIT 1`,
  ).get(current.filterKey, current.quarter) as MrSnapshotRow | undefined;
  return row ? rowToSnapshot(row) : null;
}

// ─────────────────────────────────────────────────────────────────────────
// Metrics — immutable once written
// ─────────────────────────────────────────────────────────────────────────

export interface MrMetricInput {
  geography: MrGeographyInput;
  metrics: Partial<MarketMetrics>;
  countyCount?: number | null;   // provider-displayed "# Counties" (state rows)
  zipCount?: number | null;      // provider-displayed "# Zip Codes" (state/county rows)
  provider: string;
  sourceRef: string;
  observedAt: string;            // ISO — when the value was actually displayed/read
}

export interface MrWriteResult {
  written: number;
  /** Already retained for this snapshot+geography — left untouched (immutable). */
  preserved: number;
  /** Broken identity or zero returned values — not written, never fabricated. */
  skipped: number;
}

function cleanMetrics(input: Partial<MarketMetrics>): { metrics: MarketMetrics; known: number } {
  const metrics = emptyMetrics();
  let known = 0;
  for (const k of MARKET_METRICS) {
    const v = input[k];
    if (typeof v === 'number' && Number.isFinite(v)) { metrics[k] = v; known++; }
  }
  return { metrics, known };
}

/**
 * Record returned metric values into a snapshot. Idempotent and additive ONLY:
 * an existing (snapshot, geography) metric row is preserved untouched, so a
 * resumed or repeated collection can never overwrite retained research and can
 * never create duplicate geography metrics. Rows with no returned values are
 * skipped (an uncollected geography is ABSENT, never zero).
 */
export function recordMrMetrics(snapshotId: number, rows: MrMetricInput[]): MrWriteResult {
  const db = getLandosDb();
  const snap = getMrSnapshot(snapshotId);
  if (!snap) throw new Error(`Unknown market research snapshot ${snapshotId}`);
  let written = 0, preserved = 0, skipped = 0;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO landos_mr_metric
       (snapshot_id, geography_id, metrics_json, county_count, zip_count, provider, source_ref, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((items: MrMetricInput[]) => {
    for (const item of items) {
      const geo = ensureMrGeography(item.geography);
      if (!geo) { skipped++; continue; }
      const { metrics, known } = cleanMetrics(item.metrics);
      const hasStructure = typeof item.countyCount === 'number' || typeof item.zipCount === 'number';
      if (known === 0 && !hasStructure) { skipped++; continue; }
      const res = insert.run(
        snapshotId, geo.id, JSON.stringify(metrics),
        typeof item.countyCount === 'number' ? item.countyCount : null,
        typeof item.zipCount === 'number' ? item.zipCount : null,
        item.provider, item.sourceRef, item.observedAt,
      );
      if (res.changes > 0) written++; else preserved++;
    }
    if (written > 0) {
      db.prepare(`UPDATE landos_mr_snapshot SET updated_at = strftime('%s','now') WHERE id = ?`).run(snapshotId);
    }
  });
  tx(rows);
  return { written, preserved, skipped };
}

/** The audited correction flow — the ONLY path allowed to change a retained
 *  metric row. Records before/after + reason; never silent. */
export function correctMrMetric(opts: {
  snapshotId: number; geoKey: string; metrics: Partial<MarketMetrics>; reason: string; correctedBy: string;
}): boolean {
  const db = getLandosDb();
  const geo = getMrGeography(opts.geoKey);
  if (!geo) return false;
  const row = db.prepare('SELECT id, metrics_json FROM landos_mr_metric WHERE snapshot_id = ? AND geography_id = ?')
    .get(opts.snapshotId, geo.id) as { id: number; metrics_json: string } | undefined;
  if (!row) return false;
  if (!opts.reason.trim()) throw new Error('A correction requires an explicit reason (audited flow).');
  const { metrics } = cleanMetrics(opts.metrics);
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO landos_mr_correction (metric_id, before_json, after_json, reason, corrected_by) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, row.metrics_json, JSON.stringify(metrics), opts.reason, opts.correctedBy);
    db.prepare('UPDATE landos_mr_metric SET metrics_json = ? WHERE id = ?').run(JSON.stringify(metrics), row.id);
  });
  tx();
  return true;
}

/** GAP FILL — audited, ADD-ONLY: merges values for metric keys ABSENT on the
 *  retained row. Existing retained values are NEVER modified (previously
 *  accepted operator information cannot change without confirmation); every
 *  fill records a correction-audit entry with the live-read provenance. */
export function fillMissingMrMetrics(opts: {
  snapshotId: number; geoKey: string; metrics: Partial<MarketMetrics>; sourceRef: string; observedAt: string;
}): { filled: string[] } {
  const db = getLandosDb();
  const geo = getMrGeography(opts.geoKey);
  if (!geo) return { filled: [] };
  const row = db.prepare('SELECT id, metrics_json FROM landos_mr_metric WHERE snapshot_id = ? AND geography_id = ?')
    .get(opts.snapshotId, geo.id) as { id: number; metrics_json: string } | undefined;
  if (!row) return { filled: [] };
  const existing = JSON.parse(row.metrics_json) as Record<string, number>;
  const { metrics: incoming } = cleanMetrics(opts.metrics);
  const filled: string[] = [];
  const merged: Record<string, number> = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (typeof v !== 'number') continue;
    if (typeof existing[k] === 'number') continue;   // add-only: never overwrite
    merged[k] = v; filled.push(k);
  }
  if (filled.length === 0) return { filled };
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO landos_mr_correction (metric_id, before_json, after_json, reason, corrected_by) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, row.metrics_json, JSON.stringify(merged),
        `gap fill: added missing ${filled.join(', ')} from live Drill Deep re-read at ${opts.observedAt} (${opts.sourceRef}); existing values untouched`,
        'collectMarketGapFill');
    db.prepare('UPDATE landos_mr_metric SET metrics_json = ? WHERE id = ?').run(JSON.stringify(merged), row.id);
  });
  tx();
  return { filled };
}

/** Retain provider-listed ZIP↔county memberships (INSERT OR IGNORE). */
export function recordMrZipMembership(pairs: Array<{ zip: string; fips: string }>, source: string): number {
  const db = getLandosDb();
  const ins = db.prepare('INSERT OR IGNORE INTO landos_mr_zip_county (zip, fips, source) VALUES (?, ?, ?)');
  let added = 0;
  const tx = db.transaction(() => {
    for (const p of pairs) {
      if (!/^\d{5}$/.test(p.zip) || !/^\d{5}$/.test(p.fips)) continue;
      if (ins.run(p.zip, p.fips, source).changes > 0) added++;
    }
  });
  tx();
  return added;
}

/** NULL-only backfill of the structural `# Counties` / `# ZIPs` cells on an
 *  existing retained row (COALESCE semantics: an already-retained count is
 *  never changed). Returns true when a cell was actually filled. */
export function backfillMrStructureCounts(opts: {
  snapshotId: number; geoKey: string; countyCount?: number; zipCount?: number;
}): boolean {
  const db = getLandosDb();
  const geo = getMrGeography(opts.geoKey);
  if (!geo) return false;
  const res = db.prepare(
    `UPDATE landos_mr_metric
     SET county_count = COALESCE(county_count, ?), zip_count = COALESCE(zip_count, ?)
     WHERE snapshot_id = ? AND geography_id = ?
       AND ((county_count IS NULL AND ? IS NOT NULL) OR (zip_count IS NULL AND ? IS NOT NULL))`,
  ).run(
    typeof opts.countyCount === 'number' ? opts.countyCount : null,
    typeof opts.zipCount === 'number' ? opts.zipCount : null,
    opts.snapshotId, geo.id,
    typeof opts.countyCount === 'number' ? opts.countyCount : null,
    typeof opts.zipCount === 'number' ? opts.zipCount : null,
  );
  return res.changes > 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Reads — level rows (with QoQ), geography summary
// ─────────────────────────────────────────────────────────────────────────

export interface MrComparison {
  quarter: string;
  collectedAt: string;
  metrics: MarketMetrics;
}

export interface MrGeoMetricRow {
  geoKey: string;
  level: MrGeoLevel;
  state: string;
  fips: string;
  zip: string;
  name: string;
  parentKey: string;
  metrics: MarketMetrics;
  countyCount: number | null;
  zipCount: number | null;
  provider: string;
  sourceRef: string;
  observedAt: string;
  /** Matching prior-quarter values (same exact filter set), when retained. */
  prior: MrComparison | null;
  /** Retained child geography count in THIS snapshot (drill affordance). */
  childCount: number;
}

interface MetricJoinRow {
  geo_key: string; level: MrGeoLevel; state: string; fips: string; zip: string;
  name: string; parent_key: string; metrics_json: string;
  county_count: number | null; zip_count: number | null;
  provider: string; source_ref: string; observed_at: string;
}

function parseMetricsJson(s: string): MarketMetrics {
  const base = emptyMetrics();
  try {
    const parsed = JSON.parse(s) as Partial<MarketMetrics>;
    for (const k of MARKET_METRICS) {
      const v = parsed[k];
      base[k] = typeof v === 'number' && Number.isFinite(v) ? v : null;
    }
  } catch { /* keep nulls */ }
  return base;
}

/** Rows for one level of one snapshot, optionally scoped to a parent geography. */
export function listMrRows(snapshotId: number, level: MrGeoLevel, parentKey?: string): MrGeoMetricRow[] {
  const db = getLandosDb();
  const snap = getMrSnapshot(snapshotId);
  if (!snap) return [];
  const prior = priorMrSnapshot(snap);

  // A county's ZIP listing is the UNION of canonically-parented ZIPs and
  // provider-listed memberships: a cross-county ZIP is parented to ONE county
  // but LandPortal shows it under every county it touches — so must we.
  const membershipFips = level === 'zip' && parentKey?.startsWith('county:') ? parentKey.slice('county:'.length) : null;
  const parentFilter = membershipFips
    ? ' AND (g.parent_key = ? OR g.zip IN (SELECT zip FROM landos_mr_zip_county WHERE fips = ?))'
    : parentKey ? ' AND g.parent_key = ?' : '';
  const sql = `SELECT g.geo_key, g.level, g.state, g.fips, g.zip, g.name, g.parent_key,
                      m.metrics_json, m.county_count, m.zip_count, m.provider, m.source_ref, m.observed_at
               FROM landos_mr_metric m JOIN landos_mr_geography g ON g.id = m.geography_id
               WHERE m.snapshot_id = ? AND g.level = ?${parentFilter}
               ORDER BY g.name, g.geo_key`;
  const rows = (membershipFips
    ? db.prepare(sql).all(snapshotId, level, parentKey, membershipFips)
    : parentKey
      ? db.prepare(sql).all(snapshotId, level, parentKey)
      : db.prepare(sql).all(snapshotId, level)) as MetricJoinRow[];

  const priorByGeo = new Map<string, MetricJoinRow>();
  if (prior) {
    const priorRows = db.prepare(
      `SELECT g.geo_key, g.level, g.state, g.fips, g.zip, g.name, g.parent_key,
              m.metrics_json, m.county_count, m.zip_count, m.provider, m.source_ref, m.observed_at
       FROM landos_mr_metric m JOIN landos_mr_geography g ON g.id = m.geography_id
       WHERE m.snapshot_id = ? AND g.level = ?`,
    ).all(prior.id, level) as MetricJoinRow[];
    for (const r of priorRows) priorByGeo.set(r.geo_key, r);
  }

  const childCounts = new Map<string, number>();
  const childRows = db.prepare(
    `SELECT g.parent_key AS pk, COUNT(*) AS n FROM landos_mr_metric m
     JOIN landos_mr_geography g ON g.id = m.geography_id
     WHERE m.snapshot_id = ? GROUP BY g.parent_key`,
  ).all(snapshotId) as Array<{ pk: string; n: number }>;
  for (const r of childRows) childCounts.set(r.pk, r.n);

  return rows.map((r) => {
    const p = priorByGeo.get(r.geo_key);
    return {
      geoKey: r.geo_key, level: r.level, state: r.state, fips: r.fips, zip: r.zip,
      name: r.name, parentKey: r.parent_key,
      metrics: parseMetricsJson(r.metrics_json),
      countyCount: r.county_count, zipCount: r.zip_count,
      provider: r.provider, sourceRef: r.source_ref, observedAt: r.observed_at,
      prior: p && prior ? { quarter: prior.quarter, collectedAt: prior.collectedAt, metrics: parseMetricsJson(p.metrics_json) } : null,
      childCount: childCounts.get(r.geo_key) ?? 0,
    };
  });
}

export interface MrGeoSummary {
  row: MrGeoMetricRow;
  snapshot: { id: number; quarter: string; collectedAt: string; filters: MarketResearchFilters; provider: string };
  priorSnapshot: { quarter: string; collectedAt: string } | null;
}

export function getMrGeoSummary(snapshotId: number, geoKey: string): MrGeoSummary | null {
  const snap = getMrSnapshot(snapshotId);
  const geo = getMrGeography(geoKey);
  if (!snap || !geo) return null;
  const rows = listMrRows(snapshotId, geo.level, geo.parentKey || undefined).filter((r) => r.geoKey === geoKey);
  if (rows.length === 0) return null;
  const prior = priorMrSnapshot(snap);
  return {
    row: rows[0],
    snapshot: { id: snap.id, quarter: snap.quarter, collectedAt: snap.collectedAt, filters: snap.filters, provider: snap.provider },
    priorSnapshot: prior ? { quarter: prior.quarter, collectedAt: prior.collectedAt } : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Baseline import — attach already-retained Market Matrix LandPortal rows
// ─────────────────────────────────────────────────────────────────────────

/**
 * One-time (idempotent) baseline: the LandPortal Drill Deep rows already
 * retained in the Market Matrix (sold / 2–5 acres) become quarterly Market
 * Research snapshots so the workspace opens on REAL retained operating data.
 * Reads the matrix; never modifies it. Safe to call on every server start:
 * INSERT OR IGNORE means re-runs write nothing new.
 */
export function importMatrixBaseline(): { snapshots: number; written: number } {
  const db = getLandosDb();
  const periods = db.prepare(
    `SELECT DISTINCT period FROM landos_market_snapshot
     WHERE side = 'sold' AND acreage_band = '2-5' AND provider LIKE '%landportal%' AND period != ''
     ORDER BY period`,
  ).all() as Array<{ period: string }>;
  let written = 0;
  let snapshots = 0;
  for (const { period } of periods) {
    const rows = db.prepare(
      `SELECT geo_level, state, fips, county_name, zip, metrics_json, provider, source_ref, extraction_ts
       FROM landos_market_snapshot
       WHERE side = 'sold' AND acreage_band = '2-5' AND provider LIKE '%landportal%' AND period = ?`,
    ).all(period) as Array<{ geo_level: MrGeoLevel; state: string; fips: string; county_name: string; zip: string; metrics_json: string; provider: string; source_ref: string; extraction_ts: string }>;
    if (rows.length === 0) continue;
    const earliest = rows.map((r) => r.extraction_ts).filter(Boolean).sort()[0] ?? new Date().toISOString();
    const snap = getOrCreateMrSnapshot({
      quarter: period, filters: fixedInitialFilters('2-5'),
      provider: 'LandPortal Market Research (Drill Deep)', collectedAt: earliest,
    });
    snapshots++;
    const inputs: MrMetricInput[] = rows.map((r) => ({
      geography: {
        level: r.geo_level, state: r.state,
        ...(r.fips ? { fips: r.fips } : {}),
        ...(r.zip ? { zip: r.zip } : {}),
        ...(r.county_name && r.geo_level === 'county' ? { name: `${r.county_name} County` } : {}),
      },
      metrics: parseMetricsJson(r.metrics_json),
      provider: r.provider,
      sourceRef: r.source_ref,
      observedAt: r.extraction_ts,
    }));
    written += recordMrMetrics(snap.id, inputs).written;
  }
  return { snapshots, written };
}

// ─────────────────────────────────────────────────────────────────────────
// Metric dictionary — plain-language definitions for the owner UI
// ─────────────────────────────────────────────────────────────────────────

export const MR_METRIC_DICTIONARY: Array<{ key: string; label: string; plain: string }> = [
  { key: 'salesCount', label: 'Count', plain: 'Number of sold land listings returned for the trailing 1-year window.' },
  { key: 'daysOnMarket', label: 'DOM (Days on Market)', plain: 'How many days a typical listing took to sell. Lower means faster-moving land.' },
  { key: 'sellThroughRate', label: 'STR (Sell-Through Rate)', plain: 'Sold parcels divided by parcels listed for sale, as a percent. Above 100% is possible when sales outrun current inventory.' },
  { key: 'absorptionRate', label: 'AR (Absorption Rate)', plain: 'Sold parcels divided by total available parcels, as a percent. Higher means demand is absorbing supply faster.' },
  { key: 'monthsOfSupply', label: 'MoS (Months of Supply)', plain: 'How many months current inventory would last at the current sales pace. Lower favors sellers.' },
  { key: 'population', label: 'Population', plain: 'Resident population of the geography.' },
  { key: 'populationDensity', label: 'Density', plain: 'Residents per square mile.' },
  { key: 'populationGrowth', label: 'Growth', plain: 'Population growth rate, as a percent.' },
  { key: 'medianPrice', label: 'Median Price', plain: 'Median sold price for the filtered listings.' },
  { key: 'medianPricePerAcre', label: 'PPA (Price Per Acre)', plain: 'Median sold price divided by acreage — the core land pricing measure.' },
];
