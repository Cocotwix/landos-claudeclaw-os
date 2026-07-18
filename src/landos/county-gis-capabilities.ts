// County GIS capability registry: official ArcGIS endpoints per county plus
// exact-overlap math backed by the county's own geometry service. Local grid
// sampling is the fallback so screening still returns an estimate when the
// geometry service is down. New counties are added as registry entries; no
// adapter code changes.

import { gridOverlapPercent, ringsAreaAcres, type Rings } from './parcel-spatial.js';

export interface CountyGisLayers {
  parcels?: string;
  zoning?: string;
  zoningOverlays?: Array<{ name: string; url: string }>;
  futureLandUse?: string;
  rightOfWay?: string;
  floodZones?: string;
  wetlands?: string;
  roads?: string;
  addresses?: string;
  contours?: string;
  aerialImage?: string;
}

export interface CountyGisCapability {
  countyLabel: string;
  state: string;
  match(county: string | undefined, state: string | undefined): boolean;
  geometryServiceUrl?: string;
  layers: CountyGisLayers;
  /** Public map viewer for operator links and browser screenshots. */
  mapViewerUrl?: string;
  /** Register of deeds / recorder search entry point, when publicly linkable. */
  recorderSearchUrl?: string;
  assessorSearchUrl?: string;
}

const BEAUFORT_GIS = 'https://gis.beaufortcountysc.gov/server/rest/services';
const FAYETTE_GIS = 'https://gis.fayettecountyga.gov/arcgis/rest/services';

function normalizeState(value: string | undefined): string {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw === 'SOUTH CAROLINA') return 'SC';
  if (raw === 'TENNESSEE') return 'TN';
  return raw;
}

export const COUNTY_GIS_CAPABILITIES: CountyGisCapability[] = [
  {
    // Fayette County publishes its tax-parcel geometry and county orthophoto
    // service openly through ArcGIS.  The APN-specific lookup lives in the
    // shared official-parcel adapter; this registry entry makes the resulting
    // geometry available to every overlay and county-GIS workflow.
    countyLabel: 'Fayette County',
    state: 'GA',
    match: (county, state) => normalizeState(state) === 'GA' && /fayette/i.test(county ?? ''),
    layers: {
      parcels: `${FAYETTE_GIS}/Pictometry/parcelsRO/MapServer/0`,
      zoning: `${FAYETTE_GIS}/Pictometry/ZoningRO/MapServer/0`,
      wetlands: `${FAYETTE_GIS}/Pictometry/NWIWetlandsRO/MapServer/0`,
      roads: `${FAYETTE_GIS}/Pictometry/RoadsRO/MapServer/0`,
      aerialImage: `${FAYETTE_GIS}/Basemaps/2018_Imagery_Dynamic/ImageServer`,
    },
    mapViewerUrl: 'https://qpublic.schneidercorp.com/Application.aspx?AppID=942&LayerID=18406&PageTypeID=1&PageID=0',
    recorderSearchUrl: 'https://www.fayetteclerk.com/',
    assessorSearchUrl: 'https://qpublic.schneidercorp.com/Application.aspx?AppID=942&LayerID=18406&PageTypeID=2&PageID=8204',
  },
  {
    countyLabel: 'Beaufort County',
    state: 'SC',
    match: (county, state) => normalizeState(state) === 'SC' && /beaufort/i.test(county ?? ''),
    geometryServiceUrl: `${BEAUFORT_GIS}/Utilities/Geometry/GeometryServer`,
    layers: {
      parcels: `${BEAUFORT_GIS}/ArchiveParcels/MapServer/14`,
      zoning: `${BEAUFORT_GIS}/Zoning/MapServer/9`,
      zoningOverlays: [
        { name: 'St Helena Cultural Overlay', url: `${BEAUFORT_GIS}/Zoning/MapServer/8` },
        { name: 'Airport Overlay Districts', url: `${BEAUFORT_GIS}/Zoning/MapServer/2` },
        { name: 'Heritage Corridor Overlay', url: `${BEAUFORT_GIS}/Zoning/MapServer/0` },
      ],
      futureLandUse: `${BEAUFORT_GIS}/BC_FLU/MapServer/0`,
      rightOfWay: `${BEAUFORT_GIS}/ROW/MapServer/0`,
      floodZones: `${BEAUFORT_GIS}/FloodZones/MapServer/0`,
      wetlands: `${BEAUFORT_GIS}/Wetlands/MapServer/0`,
      roads: `${BEAUFORT_GIS}/RoadClass/MapServer/0`,
      addresses: `${BEAUFORT_GIS}/Addresses/MapServer/0`,
      contours: `${BEAUFORT_GIS}/Contours/MapServer`,
      aerialImage: 'https://image.beaufortcountysc.gov/server/rest/services/T2026Aerials/ImageServer',
    },
    mapViewerUrl: 'https://gis.beaufortcountysc.gov/mapapps/BeaufortCountyGIS/',
    recorderSearchUrl: 'https://sc.beaufortcountysc.gov/rod/web/login.jsp',
    assessorSearchUrl: 'https://propertysearch.beaufortcountysc.gov/',
  },
  {
    // Pickens County SC publishes its GIS through an ArcGIS Online org
    // (no county geometry service — overlaps fall back to the local grid
    // estimate, honestly labeled). Roads are the county-hosted TIGER 2024
    // centerlines (classification only; ownership stays unverified).
    countyLabel: 'Pickens County',
    state: 'SC',
    match: (county, state) => normalizeState(state) === 'SC' && /pickens/i.test(county ?? ''),
    layers: {
      floodZones: 'https://services1.arcgis.com/59960rq18IxUcAVI/arcgis/rest/services/pickens_county_sc_flood_layer/FeatureServer/0',
      wetlands: 'https://services1.arcgis.com/59960rq18IxUcAVI/arcgis/rest/services/Pickens_County_SC_wetlands/FeatureServer/0',
      // National Census TIGERweb local-road centerlines (the county publishes
      // no own centerline layer; TIGER classification only — ownership stays
      // unverified and the frontage lane labels it that way).
      roads: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer/8',
    },
  },
];

export function findCountyGis(county: string | undefined, state: string | undefined): CountyGisCapability | null {
  return COUNTY_GIS_CAPABILITIES.find((capability) => capability.match(county, state)) ?? null;
}

type ArcFeature = { attributes?: Record<string, unknown>; geometry?: { rings?: Rings; paths?: Array<Array<[number, number]>> } };
type ArcResponse = { features?: ArcFeature[]; error?: { message?: string } };

async function fetchJson<T>(url: string, timeoutMs: number, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(timeoutMs, 60_000)));
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`County GIS HTTP ${response.status}.`);
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function queryLayerByPolygon(
  layerUrl: string,
  parcelRings: Rings,
  outFields: string,
  options: { returnGeometry?: boolean; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ArcFeature[]> {
  const params = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ rings: parcelRings }),
    geometryType: 'esriGeometryPolygon',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
    returnGeometry: options.returnGeometry ? 'true' : 'false',
    outSR: '4326',
  });
  // POST, not GET: a real parcel polygon puts the query far past the URL-length
  // limit some ArcGIS hosts enforce (AGOL returns HTTP 404 for ~3 kB GET URLs),
  // and every ArcGIS query endpoint accepts form-encoded POST.
  const response = await fetchJson<ArcResponse>(`${layerUrl}/query`, options.timeoutMs ?? 25_000, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
  }, options.signal);
  if (response.error) throw new Error(response.error.message || 'County GIS layer query failed.');
  return response.features ?? [];
}

export async function queryLayerByEnvelope(
  layerUrl: string,
  parcelRings: Rings,
  outFields: string,
  padDegrees: number,
  options: { returnGeometry?: boolean; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ArcFeature[]> {
  const shell = parcelRings[0] ?? [];
  if (!shell.length) return [];
  const xs = shell.map((p) => p[0]);
  const ys = shell.map((p) => p[1]);
  const envelope = {
    xmin: Math.min(...xs) - padDegrees,
    ymin: Math.min(...ys) - padDegrees,
    xmax: Math.max(...xs) + padDegrees,
    ymax: Math.max(...ys) + padDegrees,
    spatialReference: { wkid: 4326 },
  };
  const params = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify(envelope),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
    returnGeometry: options.returnGeometry ? 'true' : 'false',
    outSR: '4326',
  });
  const response = await fetchJson<ArcResponse>(`${layerUrl}/query?${params}`, options.timeoutMs ?? 25_000, undefined, options.signal);
  if (response.error) throw new Error(response.error.message || 'County GIS layer query failed.');
  return response.features ?? [];
}

export interface ExactOverlap {
  attributes: Record<string, unknown>;
  overlapAcres: number | null;
  overlapPercent: number | null;
  method: 'geometry_service_geodesic' | 'local_grid_estimate';
}

/**
 * Exact per-feature overlap acreage of overlay features against the parcel,
 * computed by the county's own geometry service (geodesic). Falls back to a
 * dense local grid estimate of the combined overlap when the service fails.
 */
export async function computeExactOverlaps(
  capability: CountyGisCapability,
  parcelRings: Rings,
  layerUrl: string,
  outFields: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ overlaps: ExactOverlap[]; parcelAcresGeodesic: number | null }> {
  const features = await queryLayerByPolygon(layerUrl, parcelRings, outFields, { ...options, returnGeometry: true });
  const withGeometry = features.filter((feature) => feature.geometry?.rings?.length);
  if (!withGeometry.length) return { overlaps: [], parcelAcresGeodesic: null };

  const parcelAcresLocal = ringsAreaAcres(parcelRings);
  if (capability.geometryServiceUrl) {
    try {
      const intersect = await fetchJson<{ geometries?: Array<{ rings?: Rings }>; error?: unknown }>(
        `${capability.geometryServiceUrl}/intersect`,
        options.timeoutMs ?? 30_000,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            f: 'json',
            sr: '4326',
            geometry: JSON.stringify({ geometryType: 'esriGeometryPolygon', geometry: { rings: parcelRings } }),
            geometries: JSON.stringify({ geometryType: 'esriGeometryPolygon', geometries: withGeometry.map((feature) => ({ rings: feature.geometry!.rings })) }),
          }),
        },
        options.signal,
      );
      const polygons = (intersect.geometries ?? []).map((geometry) => (geometry.rings?.length ? { rings: geometry.rings } : null));
      const nonEmpty = polygons.filter((polygon): polygon is { rings: Rings } => !!polygon);
      const areasPayload = [{ rings: parcelRings }, ...nonEmpty];
      const areas = await fetchJson<{ areas?: number[]; error?: unknown }>(
        `${capability.geometryServiceUrl}/areasAndLengths`,
        options.timeoutMs ?? 30_000,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            f: 'json',
            sr: '4326',
            calculationType: 'geodesic',
            areaUnit: JSON.stringify({ areaUnit: 'esriAcres' }),
            lengthUnit: '9002',
            polygons: JSON.stringify(areasPayload),
          }),
        },
        options.signal,
      );
      if (Array.isArray(areas.areas) && areas.areas.length === areasPayload.length) {
        const parcelAcres = Math.abs(areas.areas[0]);
        let areaCursor = 1;
        const overlaps: ExactOverlap[] = withGeometry.map((feature, index) => {
          if (!polygons[index]) return { attributes: feature.attributes ?? {}, overlapAcres: 0, overlapPercent: 0, method: 'geometry_service_geodesic' };
          const acres = Math.abs(areas.areas![areaCursor]);
          areaCursor += 1;
          return {
            attributes: feature.attributes ?? {},
            overlapAcres: Math.round(acres * 1000) / 1000,
            overlapPercent: parcelAcres > 0 ? Math.round(acres / parcelAcres * 10_000) / 100 : null,
            method: 'geometry_service_geodesic',
          };
        });
        return { overlaps, parcelAcresGeodesic: Math.round(parcelAcres * 1000) / 1000 };
      }
    } catch {
      // fall through to the local estimate
    }
  }

  const combinedPercent = gridOverlapPercent(parcelRings, withGeometry.map((feature) => feature.geometry!.rings!), 48);
  const overlaps: ExactOverlap[] = withGeometry.map((feature) => {
    const percent = gridOverlapPercent(parcelRings, [feature.geometry!.rings!], 48);
    return {
      attributes: feature.attributes ?? {},
      overlapAcres: percent != null && parcelAcresLocal > 0 ? Math.round(parcelAcresLocal * percent / 100 * 1000) / 1000 : null,
      overlapPercent: percent,
      method: 'local_grid_estimate',
    };
  });
  void combinedPercent;
  return { overlaps, parcelAcresGeodesic: null };
}
