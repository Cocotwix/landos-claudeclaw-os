// Optional jurisdiction boundary overlays for the LandOS comp map.
//
// Three nationwide layers — county, municipality, and ZIP area — fetched from
// the U.S. Census Bureau's public TIGERweb service and drawn as SVG paths over
// the raster tiles the map already renders.
//
// Why this qualified as "straightforward through the existing renderer":
//   • TIGERweb is authoritative, nationwide, public, and needs no key, account,
//     charge, or terms acceptance. No new provider architecture.
//   • Its `f=geojson` output plus `maxAllowableOffset` returns a viewport-
//     appropriate simplification — a whole county comes back around 1 KB rather
//     than 70 KB — so nothing large is loaded into the browser and no tile cache
//     or proxy is needed. The browser asks for exactly the geography around the
//     subject, once, and keeps it in memory for the session.
//   • It answers CORS with the caller's own origin, so the request goes straight
//     from the page. There is no LandOS proxy in the path.
//
// Honesty rules baked in here rather than left to the caller:
//   • The ZIP layer is a Census ZCTA and is labeled as one. A ZCTA is a
//     statistical approximation built from census blocks; it is NOT the USPS
//     delivery jurisdiction, and calling it "ZIP boundary" would assert a legal
//     line that does not exist.
//   • Rural America mostly has no incorporated place. Rather than showing an
//     empty "City" layer at the subject, the municipal layer falls back to the
//     Census county subdivision (the town/township that actually governs there)
//     and SAYS which one of the two it drew.

import { lngToWorldX, latToWorldY, type LatLng } from './slippy';

export type BoundaryLayerId = 'county' | 'municipality' | 'zcta';

export interface BoundaryLayerSpec {
  id: BoundaryLayerId;
  /** Control label. */
  label: string;
  /** What the operator is actually looking at, stated without overclaim. */
  caption: string;
  /** Stroke colour. Colour NEVER carries the distinction on its own. */
  stroke: string;
  /** Dash pattern — this is what distinguishes the layers without colour. */
  dash: string;
  width: number;
}

export const BOUNDARY_LAYERS: readonly BoundaryLayerSpec[] = [
  {
    id: 'county',
    label: 'County',
    caption: 'County boundary — U.S. Census TIGER',
    stroke: '#f0c674',
    dash: '',
    width: 2.5,
  },
  {
    id: 'municipality',
    label: 'City / municipality',
    caption: 'Municipal boundary — U.S. Census TIGER',
    stroke: '#7dd3fc',
    dash: '10 6',
    width: 2,
  },
  {
    id: 'zcta',
    label: 'ZIP area / Census ZCTA',
    caption: 'ZIP area approximated by the Census ZIP Code Tabulation Area — not a USPS jurisdiction boundary',
    stroke: '#c4b5fd',
    dash: '3 5',
    width: 2,
  },
];

/** A ring of lng/lat pairs. */
export type Ring = Array<[number, number]>;

export interface BoundaryFeature {
  layer: BoundaryLayerId;
  /** The name to show on hover or click, e.g. "Cayuga County". */
  name: string;
  /** The honest description of what this line is. */
  caption: string;
  /** Outer rings only; holes are not drawn, and none of these layers has any. */
  rings: Ring[];
}

export interface BoundaryFetchResult {
  layer: BoundaryLayerId;
  features: BoundaryFeature[];
  /** Set when the layer genuinely has nothing here, or the service failed. */
  note: string | null;
}

const TIGERWEB = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb';

/** TIGERweb layer paths. Current-vintage layers, not the ACS/2020 snapshots. */
const ENDPOINTS = {
  county: `${TIGERWEB}/State_County/MapServer/1`,
  place: `${TIGERWEB}/Places_CouSub_ConCity_SubMCD/MapServer/4`,
  countySubdivision: `${TIGERWEB}/Places_CouSub_ConCity_SubMCD/MapServer/1`,
  zcta: `${TIGERWEB}/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1`,
} as const;

/**
 * Geometry simplification, in degrees.
 *
 * This is the single knob that keeps the overlay light. At 0.002° the returned
 * outline is accurate to roughly 200 m — invisible at the zoom levels a comp map
 * is read at, and two orders of magnitude smaller on the wire than the full
 * shape. A boundary overlay exists to answer "is this comp in the same county",
 * not to survey a property line, so the trade is the right way round.
 */
const SIMPLIFY_DEGREES = 0.002;

function pointQuery(endpoint: string, at: LatLng, outFields: string): string {
  const params = new URLSearchParams({
    where: '1=1',
    geometry: `${at.lng},${at.lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: String(SIMPLIFY_DEGREES),
    f: 'geojson',
  });
  return `${endpoint}/query?${params.toString()}`;
}

/** Pull outer rings out of a GeoJSON Polygon or MultiPolygon. */
export function ringsFromGeoJson(geometry: unknown): Ring[] {
  const g = geometry as { type?: string; coordinates?: unknown } | null;
  if (!g || !Array.isArray(g.coordinates)) return [];
  if (g.type === 'Polygon') {
    return (g.coordinates as Ring[]).filter((r) => Array.isArray(r) && r.length > 2);
  }
  if (g.type === 'MultiPolygon') {
    const out: Ring[] = [];
    for (const poly of g.coordinates as Ring[][]) {
      if (Array.isArray(poly) && Array.isArray(poly[0]) && poly[0].length > 2) out.push(poly[0]);
    }
    return out;
  }
  return [];
}

async function queryLayer(url: string): Promise<Array<{ props: Record<string, unknown>; rings: Ring[] }>> {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`Census TIGERweb returned HTTP ${res.status}`);
  const body = await res.json() as { features?: Array<{ properties?: Record<string, unknown>; geometry?: unknown }> };
  return (body.features ?? [])
    .map((f) => ({ props: f.properties ?? {}, rings: ringsFromGeoJson(f.geometry) }))
    .filter((f) => f.rings.length > 0);
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Fetch one layer's boundary around a point.
 *
 * Every failure path returns a NOTE rather than throwing or silently drawing
 * nothing: an operator who toggles "County" and sees no line needs to know
 * whether the county has no boundary here (impossible) or the Census service did
 * not answer (possible), because only one of those is worth retrying.
 */
export async function fetchBoundaryLayer(layer: BoundaryLayerId, at: LatLng): Promise<BoundaryFetchResult> {
  const spec = BOUNDARY_LAYERS.find((l) => l.id === layer)!;
  try {
    if (layer === 'county') {
      const rows = await queryLayer(pointQuery(ENDPOINTS.county, at, 'BASENAME,NAME,STATE'));
      if (!rows.length) return { layer, features: [], note: 'The Census county layer returned no county at this location.' };
      return {
        layer,
        features: rows.map((r) => ({
          layer,
          name: str(r.props.NAME) ?? str(r.props.BASENAME) ?? 'County',
          caption: spec.caption,
          rings: r.rings,
        })),
        note: null,
      };
    }

    if (layer === 'zcta') {
      const rows = await queryLayer(pointQuery(ENDPOINTS.zcta, at, 'BASENAME,NAME'));
      if (!rows.length) return { layer, features: [], note: 'No Census ZCTA covers this location.' };
      return {
        layer,
        features: rows.map((r) => ({
          layer,
          name: `ZIP area ${str(r.props.BASENAME) ?? ''} / Census ZCTA`.replace(/\s+/g, ' ').trim(),
          caption: spec.caption,
          rings: r.rings,
        })),
        note: null,
      };
    }

    // Municipality: an incorporated place governs where one exists. Most rural
    // parcels sit in no incorporated place at all, so the town/township that
    // actually governs there is drawn instead — and named as what it is.
    const places = await queryLayer(pointQuery(ENDPOINTS.place, at, 'BASENAME,NAME'));
    if (places.length) {
      return {
        layer,
        features: places.map((r) => ({
          layer,
          name: str(r.props.NAME) ?? str(r.props.BASENAME) ?? 'Municipality',
          caption: 'Incorporated place boundary — U.S. Census TIGER',
          rings: r.rings,
        })),
        note: null,
      };
    }
    const subs = await queryLayer(pointQuery(ENDPOINTS.countySubdivision, at, 'BASENAME,NAME'));
    if (!subs.length) {
      return { layer, features: [], note: 'No incorporated place or Census county subdivision covers this location.' };
    }
    return {
      layer,
      features: subs.map((r) => ({
        layer,
        name: str(r.props.NAME) ?? str(r.props.BASENAME) ?? 'County subdivision',
        caption: 'Census county subdivision — there is no incorporated place at this location',
        rings: r.rings,
      })),
      note: 'No incorporated place covers this location, so the Census county subdivision (town/township) is drawn instead.',
    };
  } catch (err) {
    return {
      layer,
      features: [],
      note: `Boundary unavailable: ${err instanceof Error ? err.message : String(err)}.`,
    };
  }
}

/**
 * Project one ring to an SVG path in the map canvas's pixel space.
 *
 * Points are thinned to whole pixels: at county scale a simplified ring still
 * carries many vertices that land on the same pixel, and emitting them all makes
 * a path string several times longer than the shape it draws.
 */
export function ringToSvgPath(
  ring: Ring,
  center: LatLng,
  zoom: number,
  width: number,
  height: number,
): string {
  const z = Math.round(zoom);
  const cx = lngToWorldX(center.lng, z);
  const cy = latToWorldY(center.lat, z);
  const originX = cx - width / 2;
  const originY = cy - height / 2;

  let d = '';
  let lastX: number | null = null;
  let lastY: number | null = null;
  for (const [lng, lat] of ring) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const x = Math.round(lngToWorldX(lng, z) - originX);
    const y = Math.round(latToWorldY(lat, z) - originY);
    if (x === lastX && y === lastY) continue;
    d += d ? `L${x} ${y}` : `M${x} ${y}`;
    lastX = x;
    lastY = y;
  }
  return d ? `${d}Z` : '';
}
