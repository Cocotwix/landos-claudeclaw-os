// Comparable GEOGRAPHY reconciliation — where a comp LandOS already retained
// actually is, and how far that is from the subject.
//
// Discovery is not the problem this file solves. The candidates are already on
// the Deal Card. What discovery did not establish is their GEOGRAPHY: LandWatch
// and Redfin rows arrive with the city and ZIP glued inside one address run and
// no coordinate at all, so every one of them measured `null` miles from the
// subject. Valuation could then not tell a sale two miles down the road from a
// premium-submarket sale twenty-six miles away, and the second priced the
// subject as if it were the first.
//
// Four rules keep this lane honest and bounded:
//
//   1. NO DISCOVERY. Every record here is already persisted on the Deal Card.
//      Nothing searches a marketplace, widens a market, or adds a comparable,
//      and no provider listing page is revisited.
//   2. RETAINED EVIDENCE FIRST. A coordinate the row already carries wins. Then
//      the shared geocode cache. Only then a public geocode of the address the
//      row itself states.
//   3. APPROXIMATION IS LABELLED, NEVER PROMOTED. When only a ZIP is usable, the
//      published ZCTA centroid places the record in the right AREA — it is
//      persisted as `approximate` and can never be called local evidence.
//   4. NOTHING IS DELETED. A record whose geography cannot be established stays
//      retained and visible as market context with its reason stated. Weak
//      geography lowers weight; it never removes a candidate.
//
// The geocoders are the public, keyless US Census services LandOS already uses
// (`geocoding.geo.census.gov` for addresses, TIGERweb for ZCTA centroids). No
// paid API, no key, no secret.

import { getLandosDb, landosAudit, type LandosEntity } from './db.js';
import { listComps, enrichCompCoordinates, type CompRow } from './comps.js';
import { compDistanceMiles } from './acreage-router.js';
import {
  assessCompGeography,
  parseCompLocality,
  type CompGeoPrecision,
  type CompGeoTierId,
} from './comp-geography.js';

/** Public TIGERweb layer 2 = 2020 Census ZIP Code Tabulation Areas. */
const ZCTA_QUERY_URL = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2/query';

export type GeoFetch = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface CompGeographyResult {
  compId: number;
  address: string;
  city: string | null;
  zip: string | null;
  /** The point the distance was measured from — parcel or area. */
  lat: number | null;
  lng: number | null;
  /** True when that point is an area centroid, not this parcel's location. */
  areaPoint: boolean;
  distanceMiles: number | null;
  precision: CompGeoPrecision;
  tierId: CompGeoTierId;
  source: string;
  /** True when this run wrote something new onto the row. */
  changed: boolean;
  changes: string[];
  reason: string;
}

export interface CompGeographyReconciliationResult {
  dealCardId: number;
  subjectResolved: boolean;
  /** Retained rows examined. */
  examined: number;
  resolved: number;
  approximate: number;
  unresolved: number;
  byTier: Record<CompGeoTierId, number>;
  results: CompGeographyResult[];
}

export interface CompGeographyOptions {
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: GeoFetch;
  /** Injected for tests; skips the street-address geocode pass when false. */
  runAddressGeocode?: boolean;
  nowIso?: () => string;
}

// ── ZCTA centroid (area-level fallback) ──────────────────────────────────────

interface CentroidHit { lat: number; lng: number }

/**
 * The published centroid of a ZIP Code Tabulation Area. This is an AREA point,
 * not a parcel point: it says which market the record belongs to, never where
 * the parcel sits. Cached in the shared geocode cache under a `zcta:` key —
 * including misses, so a ZIP with no published ZCTA is never re-queried in a
 * loop.
 */
export async function zctaCentroid(
  zip: string,
  deps: { fetchImpl?: GeoFetch } = {},
): Promise<CentroidHit | null> {
  const code = String(zip ?? '').trim().match(/^\d{5}/)?.[0];
  if (!code) return null;
  const db = getLandosDb();
  const key = `zcta:${code}`;
  const cached = db.prepare('SELECT lat, lng, provider FROM landos_geocode_cache WHERE address_key = ?').get(key) as
    | { lat: number | null; lng: number | null; provider: string } | undefined;
  if (cached) {
    return typeof cached.lat === 'number' && typeof cached.lng === 'number'
      ? { lat: cached.lat, lng: cached.lng }
      : null;
  }

  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as GeoFetch);
  let hit: CentroidHit | null = null;
  try {
    const url = `${ZCTA_QUERY_URL}?where=${encodeURIComponent(`GEOID='${code}'`)}&outFields=GEOID,CENTLAT,CENTLON&returnGeometry=false&f=json`;
    const response = await fetchImpl(url);
    if (response.ok) {
      const payload = await response.json() as { features?: Array<{ attributes?: Record<string, unknown> }> };
      const attributes = payload.features?.[0]?.attributes;
      const lat = Number(attributes?.CENTLAT);
      const lng = Number(attributes?.CENTLON);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
        && !(lat === 0 && lng === 0)) hit = { lat, lng };
    }
  } catch { /* a miss is cached below; nothing is invented */ }

  db.prepare(`INSERT INTO landos_geocode_cache (address_key, lat, lng, provider, created_at)
    VALUES (?, ?, ?, 'us_census_zcta', strftime('%s','now'))
    ON CONFLICT(address_key) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, provider=excluded.provider, created_at=excluded.created_at`)
    .run(key, hit?.lat ?? null, hit?.lng ?? null);
  return hit;
}

// ── The lane ─────────────────────────────────────────────────────────────────

interface SubjectPlace {
  lat: number | null;
  lng: number | null;
  city: string | null;
  zip: string | null;
  county: string | null;
  state: string | null;
}

function loadSubjectPlace(dealCardId: number): SubjectPlace | null {
  const db = getLandosDb();
  const row = db.prepare(`SELECT p.lat, p.lng, p.city, p.zip, p.county, p.state
    FROM landos_deal_card_property l JOIN landos_property_card p ON p.id = l.card_id
    WHERE l.deal_card_id = ? ORDER BY l.card_id LIMIT 1`).get(dealCardId) as
    | { lat: number | null; lng: number | null; city: string | null; zip: string | null; county: string | null; state: string | null }
    | undefined;
  if (!row) return null;
  return {
    lat: typeof row.lat === 'number' ? row.lat : null,
    lng: typeof row.lng === 'number' ? row.lng : null,
    city: row.city || null,
    zip: row.zip || null,
    county: row.county || null,
    state: row.state || null,
  };
}

/**
 * Reconcile the geography of every comparable already retained on one Deal
 * Card, and persist it.
 *
 * Adds no comparable, visits no marketplace, and re-runs no research. It reads
 * the rows LandOS already holds, establishes the strongest location each row's
 * OWN retained evidence supports, measures it against the subject, and records
 * the tier that measurement earns.
 */
export async function reconcileCompGeography(
  dealCardId: number,
  opts: CompGeographyOptions = {},
): Promise<CompGeographyReconciliationResult> {
  const db = getLandosDb();
  const nowIso = opts.nowIso ?? (() => new Date().toISOString());
  const subject = loadSubjectPlace(dealCardId);
  const subjectPoint = subject && subject.lat != null && subject.lng != null
    ? { lat: subject.lat, lng: subject.lng } : null;

  // Pass 1: the existing bounded, free street-address geocode over rows that
  // still carry no coordinate. Already approved, already cached, already
  // state/ZIP-verified — nothing new is contacted here.
  if (opts.runAddressGeocode !== false) {
    try {
      await enrichCompCoordinates(dealCardId, {
        max: 200,
        // Geography reconciliation revisits NO provider listing page. The
        // coordinate-enrichment path can scrape a retained Redfin/Trulia page
        // for a point, and that is a legitimate capability — it is simply not
        // this lane's business, so the seam is closed rather than left to fire
        // as a side effect. Free, keyless geocoders only.
        listingFetchImpl: async () => ({ ok: false, status: 0, text: async () => '' }),
      });
    } catch { /* rows that stay unplaced fall through to the honest paths below */ }
  }

  const rows = listComps({ dealCardId, limit: 500 });
  // `lat`/`lng` are never written here: this lane establishes geography over
  // records LandOS already holds, and the one point it can newly produce is an
  // area centroid, which belongs in `geo_lat`/`geo_lng`. Parcel coordinates are
  // written by the coordinate-enrichment path above, on its own evidence.
  const update = db.prepare(`UPDATE landos_comp
    SET geo_lat = ?, geo_lng = ?, city = ?, zip = ?, distance_miles = ?,
        geo_precision = ?, geo_source = ?, geo_tier = ?, geo_resolved_at = ?, updated_at = strftime('%s','now')
    WHERE id = ?`);

  const results: CompGeographyResult[] = [];
  const byTier: Record<CompGeoTierId, number> = { local: 0, expanded: 0, broader: 0, unresolved: 0 };

  for (const row of rows) {
    const parsed = parseCompLocality(row.address_desc);
    const city = (row.city || parsed.city || '').trim() || null;
    const zip = (row.zip || parsed.zip || '').trim().match(/^\d{5}/)?.[0] ?? null;
    const state = (row.state || parsed.state || '').trim() || null;

    // The record's own PARCEL point, when it has one, always wins.
    const parcelLat = typeof row.lat === 'number' ? row.lat : null;
    const parcelLng = typeof row.lng === 'number' ? row.lng : null;
    let areaLat: number | null = null;
    let areaLng: number | null = null;
    let precision: CompGeoPrecision = parcelLat != null && parcelLng != null ? 'exact' : 'unresolved';
    let source = parcelLat != null && parcelLng != null
      ? `${row.source_label} retained coordinates`
      : '';

    if (parcelLat == null || parcelLng == null) {
      // Only the AREA is recoverable. That is still real, disclosed evidence —
      // it just may never be promoted to a parcel location, so a rerun can
      // never quietly relabel it `exact` either.
      const centroid = zip ? await zctaCentroid(zip, { fetchImpl: opts.fetchImpl }) : null;
      if (centroid) {
        areaLat = centroid.lat;
        areaLng = centroid.lng;
        precision = 'approximate';
        source = `US Census ZCTA ${zip} area centroid (area-level only; never a parcel location)`;
      }
    }

    const lat = parcelLat ?? areaLat;
    const lng = parcelLng ?? areaLng;
    const distance = subjectPoint && lat != null && lng != null
      ? compDistanceMiles(subjectPoint, { lat, lng })
      : null;

    const assessment = assessCompGeography({
      distanceMiles: distance,
      precision,
      comp: { city, zip, county: row.county || null, state },
      subject: {
        city: subject?.city ?? null,
        zip: subject?.zip ?? null,
        county: subject?.county ?? null,
        state: subject?.state ?? null,
      },
    });

    const changes: string[] = [];
    if (row.geo_lat == null && areaLat != null) changes.push('area point');
    if (!row.city && city) changes.push('city');
    if (!row.zip && zip) changes.push('ZIP');
    if (row.distance_miles !== assessment.distanceMiles) changes.push('distance from subject');
    if (row.geo_tier !== assessment.tierId) changes.push('geographic tier');
    if (row.geo_precision !== assessment.precision) changes.push('geographic precision');

    update.run(
      areaLat, areaLng, city ?? '', zip ?? '', assessment.distanceMiles,
      assessment.precision, source, assessment.tierId, nowIso(), row.id,
    );

    byTier[assessment.tierId] += 1;
    results.push({
      compId: row.id,
      address: row.address_desc,
      city, zip,
      lat, lng,
      areaPoint: areaLat != null && areaLng != null,
      distanceMiles: assessment.distanceMiles,
      precision: assessment.precision,
      tierId: assessment.tierId,
      source: source || 'No location evidence retained for this record',
      changed: changes.length > 0,
      changes,
      reason: assessment.reason,
    });
  }

  const entity = (rows[0]?.entity ?? 'landos') as LandosEntity;
  landosAudit('landos/comp-geography', 'comp_geography_reconciled',
    `deal ${dealCardId}: ${results.length} retained comparables reconciled geographically — `
    + `${byTier.local} local, ${byTier.expanded} expanded, ${byTier.broader} broader-market, ${byTier.unresolved} unresolved. `
    + 'No comparable discovered, no provider search re-run.',
    { entity, refTable: 'landos_deal_card', refId: dealCardId });

  return {
    dealCardId,
    subjectResolved: subjectPoint != null,
    examined: rows.length,
    resolved: results.filter((r) => r.precision === 'exact').length,
    approximate: results.filter((r) => r.precision === 'approximate').length,
    unresolved: results.filter((r) => r.precision === 'unresolved').length,
    byTier,
    results,
  };
}

export type { CompRow };
