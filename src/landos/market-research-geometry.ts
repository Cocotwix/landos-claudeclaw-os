// LandOS — Market Research map geometry (stored separately from market values).
//
// State and county boundaries are vendored TopoJSON assets served to the web
// app (web/public/geo/*-10m.json, U.S. Census cartographic boundaries via
// us-atlas). ZIP polygons are 2020 Census ZCTA boundaries fetched ONCE per ZIP
// from the free public Census TIGERweb service and retained in
// landos_mr_geometry, so map rendering reads LandOS-owned geometry and never
// depends on the provider. Geometry is presentation data only — it never
// carries or implies a market value.

import { getLandosDb } from './db.js';

export interface ZctaFeature {
  type: 'Feature';
  properties: { zip: string };
  geometry: unknown;
}

export interface ZctaGeometryResult {
  type: 'FeatureCollection';
  features: ZctaFeature[];
  /** ZIPs with no retained/fetchable boundary — the UI shows an explicit
   *  unavailable state for them, never a fabricated shape. */
  unavailable: string[];
}

const TIGERWEB_ZCTA_URL =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query';

export type ZctaFetcher = (zips: string[]) => Promise<Map<string, unknown>>;

/** Fetch ZCTA polygon geometries (GeoJSON, WGS84) for a batch of ZIPs. */
async function fetchZctaBatch(zips: string[]): Promise<Map<string, unknown>> {
  const where = `ZCTA5 IN (${zips.map((z) => `'${z.replace(/[^0-9]/g, '')}'`).join(',')})`;
  const params = new URLSearchParams({
    where, outFields: 'ZCTA5', returnGeometry: 'true', outSR: '4326',
    geometryPrecision: '4', f: 'geojson',
  });
  const res = await fetch(`${TIGERWEB_ZCTA_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`TIGERweb ZCTA query failed (${res.status})`);
  const body = (await res.json()) as { features?: Array<{ properties?: { ZCTA5?: string }; geometry?: unknown }>; error?: unknown };
  if (body.error) throw new Error('TIGERweb ZCTA query returned an error');
  const out = new Map<string, unknown>();
  for (const f of body.features ?? []) {
    const zip = f.properties?.ZCTA5;
    if (zip && f.geometry) out.set(zip, f.geometry);
  }
  return out;
}

/**
 * Return retained ZCTA geometries for the given ZIPs, fetching and caching any
 * missing ones. A ZIP whose boundary cannot be retrieved is reported in
 * `unavailable` (a ZCTA does not exist for every USPS ZIP) — never invented.
 */
export async function getZipGeometries(zips: string[], fetcher: ZctaFetcher = fetchZctaBatch): Promise<ZctaGeometryResult> {
  const db = getLandosDb();
  const wanted = [...new Set(zips.filter((z) => /^\d{5}$/.test(z)))];
  const features: ZctaFeature[] = [];
  const missing: string[] = [];

  const read = db.prepare('SELECT geometry_json FROM landos_mr_geometry WHERE geo_key = ?');
  for (const zip of wanted) {
    const row = read.get(`zip:${zip}`) as { geometry_json: string } | undefined;
    if (row && row.geometry_json) {
      try { features.push({ type: 'Feature', properties: { zip }, geometry: JSON.parse(row.geometry_json) }); continue; }
      catch { /* refetch below */ }
    }
    missing.push(zip);
  }

  const unavailable: string[] = [];
  if (missing.length > 0) {
    const write = db.prepare(
      `INSERT INTO landos_mr_geometry (geo_key, geometry_json, source) VALUES (?, ?, ?)
       ON CONFLICT(geo_key) DO UPDATE SET geometry_json = excluded.geometry_json, source = excluded.source, fetched_at = strftime('%s','now')`,
    );
    for (let i = 0; i < missing.length; i += 40) {
      const batch = missing.slice(i, i + 40);
      let fetched = new Map<string, unknown>();
      try { fetched = await fetcher(batch); }
      catch { unavailable.push(...batch); continue; }
      for (const zip of batch) {
        const geometry = fetched.get(zip);
        if (!geometry) { unavailable.push(zip); continue; }
        write.run(`zip:${zip}`, JSON.stringify(geometry), 'census_tigerweb_zcta520');
        features.push({ type: 'Feature', properties: { zip }, geometry });
      }
    }
  }
  return { type: 'FeatureCollection', features, unavailable };
}
