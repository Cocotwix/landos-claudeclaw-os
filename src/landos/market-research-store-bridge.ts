// LandOS — read-time bridge from the quarterly Market Research store to the
// Market Matrix read path.
//
// TWO stores hold the same kind of fact and only one of them was readable.
//
//   landos_market_snapshot   the Market Matrix table every operator surface
//                            reads (market-matrix-read, getCountyDrilldown,
//                            propertyMarketContextFor). ~212 counties.
//   landos_mr_*              the quarterly LandOS Market Research collection —
//                            all 3,138 counties, ~32k ZIPs, every acreage band,
//                            sold land, trailing 12 months.
//
// The collection flows ONE way (`importMatrixBaseline`: matrix → MR), so a lead
// in any county outside the matrix's 212 read "No LandOS Market Research record
// exists" while LandOS held that county's sold count, median $/acre, DOM,
// sell-through, absorption, months of supply and population the whole time.
//
// This module closes that gap at READ time only. It stores nothing, duplicates
// nothing, and never invents a row: it projects retained Market Research metrics
// into the shape the matrix read already consumes, carrying the real provider,
// source reference, quarter and observation timestamp so provenance is never
// laundered. The matrix table stays authoritative — the bridge is consulted only
// after a matrix key misses.
//
// SIDE: the Market Research collection is sold-side only. A `for_sale` request
// returns null rather than a sold row relabeled — active competition stays
// honestly unmeasured instead of silently substituted.

import { getLandosDb } from './db.js';
import { marketFilterKey, fixedInitialFilters } from './market-research-snapshots.js';
import { isAcreageBand, type AcreageBand, type MarketSide } from './market-matrix.js';

/** The Market Research collection's own acreage bands. '50+' and 'all' aside,
 *  these are the filter sets the quarterly Drill Deep collection ran. */
const MR_COLLECTED_BANDS: ReadonlySet<string> = new Set([
  'all', '0-1', '1-2', '2-5', '5-10', '10-20', '20-50', '50-100', '100+',
]);

/** A retained Market Research row, projected into the Market Matrix row shape. */
export interface MrBridgeRow {
  geo_level: 'county' | 'zip' | 'state';
  fips: string;
  county_name: string;
  state: string;
  zip: string;
  period: string;
  side: MarketSide;
  acreage_band: string;
  metrics_json: string;
  confidence: string;
  provider: string;
  source_ref: string;
  extraction_ts: string;
}

interface SnapshotRow { id: number; quarter: string; provider: string }
interface MetricRow { metrics_json: string; provider: string; source_ref: string; observed_at: string }
interface GeoRow { id: number; fips: string; zip: string; state: string; name: string }

function geographyRow(geoKey: string): GeoRow | null {
  const row = getLandosDb().prepare(
    'SELECT id, fips, zip, state, name FROM landos_mr_geography WHERE geo_key = ?',
  ).get(geoKey) as GeoRow | undefined;
  return row ?? null;
}

/** Newest-first snapshots that ran EXACTLY this filter set. */
function snapshotsForBand(band: AcreageBand): SnapshotRow[] {
  if (!MR_COLLECTED_BANDS.has(band)) return [];
  const filterKey = marketFilterKey(fixedInitialFilters(band));
  return getLandosDb().prepare(
    'SELECT id, quarter, provider FROM landos_mr_snapshot WHERE filter_key = ? ORDER BY quarter DESC, id DESC',
  ).all(filterKey) as SnapshotRow[];
}

function metricRow(snapshotId: number, geographyId: number): MetricRow | null {
  const row = getLandosDb().prepare(
    'SELECT metrics_json, provider, source_ref, observed_at FROM landos_mr_metric WHERE snapshot_id = ? AND geography_id = ?',
  ).get(snapshotId, geographyId) as MetricRow | undefined;
  return row ?? null;
}

function project(
  geoLevel: MrBridgeRow['geo_level'],
  geo: GeoRow,
  snapshot: SnapshotRow,
  metric: MetricRow,
  band: AcreageBand,
): MrBridgeRow {
  return {
    geo_level: geoLevel,
    fips: geo.fips ?? '',
    county_name: (geo.name ?? '').replace(/\s+county$/i, '').trim(),
    state: geo.state ?? '',
    zip: geo.zip ?? '',
    period: snapshot.quarter,
    side: 'sold',
    acreage_band: band,
    metrics_json: metric.metrics_json,
    // Retained quarterly collection read directly off the provider's own
    // displayed figures — the same standing this data already carries where the
    // deal-scoped acreage matrix consumes it.
    confidence: 'high',
    provider: metric.provider || snapshot.provider,
    source_ref: metric.source_ref,
    extraction_ts: metric.observed_at,
  };
}

/**
 * Newest retained Market Research row for one geography key + acreage band.
 * Null when the collection never ran that band, never covered that geography,
 * or the request is for the for-sale side the collection does not carry.
 */
export function mrBridgeLookup(input: {
  level: MrBridgeRow['geo_level'];
  fips?: string | null;
  zip?: string | null;
  state?: string | null;
  band: AcreageBand;
  side: MarketSide;
}): MrBridgeRow | null {
  if (input.side !== 'sold') return null;
  if (!isAcreageBand(input.band) || !MR_COLLECTED_BANDS.has(input.band)) return null;

  const geoKey = input.level === 'zip'
    ? (input.zip ? `zip:${input.zip.trim()}` : null)
    : input.level === 'county'
      ? (input.fips ? `county:${input.fips.trim()}` : null)
      : (input.state ? `state:${input.state.trim().toUpperCase()}` : null);
  if (!geoKey) return null;

  const geo = geographyRow(geoKey);
  if (!geo) return null;

  for (const snapshot of snapshotsForBand(input.band)) {
    const metric = metricRow(snapshot.id, geo.id);
    if (metric) return project(input.level, geo, snapshot, metric, input.band);
  }
  return null;
}

/**
 * Every retained Market Research band for one county, newest snapshot per band.
 * Used to complete the county drilldown so the county / subject-band / fastest-
 * band records and the deal-scoped acreage matrix all see the same coverage.
 */
export function mrBridgeCountyRows(fips: string): MrBridgeRow[] {
  const trimmed = (fips ?? '').trim();
  if (!/^\d{5}$/.test(trimmed)) return [];
  const geo = geographyRow(`county:${trimmed}`);
  if (!geo) return [];
  const rows: MrBridgeRow[] = [];
  for (const band of MR_COLLECTED_BANDS) {
    if (!isAcreageBand(band)) continue;
    for (const snapshot of snapshotsForBand(band)) {
      const metric = metricRow(snapshot.id, geo.id);
      if (!metric) continue;
      rows.push(project('county', geo, snapshot, metric, band));
      break;
    }
  }
  return rows;
}

/** County display name retained by the Market Research collection, or null. */
export function mrBridgeCountyName(fips: string): string | null {
  const geo = geographyRow(`county:${(fips ?? '').trim()}`);
  const name = (geo?.name ?? '').replace(/\s+county$/i, '').trim();
  return name || null;
}

/**
 * Resolve a county FIPS from a county name + state against the Market Research
 * geography table — the only county reference in LandOS that covers all 3,138
 * counties. Locality scoping only: a FIPS resolved here never establishes parcel
 * identity, and an ambiguous name resolves to nothing rather than a guess.
 */
export function mrBridgeCountyFips(county: string | null | undefined, state: string | null | undefined): string | null {
  const name = (county ?? '').replace(/\s+county$/i, '').trim();
  const st = (state ?? '').trim().toUpperCase();
  if (!name || !/^[A-Z]{2}$/.test(st)) return null;
  const rows = getLandosDb().prepare(
    `SELECT fips FROM landos_mr_geography
      WHERE level = 'county' AND upper(state) = ?
        AND (lower(name) = lower(?) OR lower(name) = lower(?))
      LIMIT 2`,
  ).all(st, name, `${name} County`) as Array<{ fips: string }>;
  return rows.length === 1 ? rows[0].fips : null;
}
