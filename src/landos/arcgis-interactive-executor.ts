// LandOS — the ArcGIS implementation of `GisBrowserExecutor`.
//
// A very large share of U.S. municipal and county zoning, parcel and utility
// maps are Esri underneath. This executor drives that family: ArcGIS Online
// Map Viewer, Experience Builder and Web AppBuilder all sit on a web map whose
// operational layers resolve to queryable Feature/Map services.
//
// THE HYBRID, AND WHY IT IS NOT "API-ONLY". Two different questions get two
// different instruments, deliberately:
//
//   • WHAT IS TRUE — identity and attribute values come from the service the
//     application itself draws from. This is the authoritative read: it is the
//     same data the popup renders, without asking a canvas what it thinks a
//     pixel means. Parcel identity in particular must never come from reading
//     an image.
//
//   • WHAT THE OPERATOR CAN SEE — the map is opened in the governed browser,
//     framed on the subject, and captured. That screenshot is the evidence a
//     human can check: subject, overlay, legend, in the real application at a
//     URL they can open themselves.
//
// Reducing this to a service query would lose the second half, and reducing it
// to pixels would lose the first. The session contract requires both.
//
// FRAMING IS NOT A PIXEL MACRO. The map is aimed with the application's own
// `center` / `level` / `marker` URL parameters — a documented, stable part of
// the platform — rather than by clicking coordinates on a canvas. That is what
// keeps this executor portable across every Esri-hosted map instead of
// brittle against one city's layout.

import { logger } from '../logger.js';
import type { BrowserDriver } from './browser-intelligence.js';
import type {
  GisBrowserExecutor,
  GisLayerRef,
  GisScreenshot,
  GisStepOptions,
  GisSubject,
} from './interactive-gis-session.js';

/** Fields an Esri parcel layer plausibly keys identity on, strongest first. */
const IDENTIFIER_FIELDS = ['parcel_id', 'PARCELID', 'PARCEL_ID', 'APN', 'MP', 'GISLINK', 'PIN', 'ParcelID'];
const OWNER_FIELDS = ['OwnerName1', 'owner1', 'OWNER', 'OwnerName', 'Owner1', 'OWNER_NAME'];

export interface ArcgisWebMapConfig {
  /** The web map item id the application renders. */
  webMapItemId: string;
  /** The portal that hosts it, e.g. `https://fairviewtn.maps.arcgis.com`. */
  portalUrl: string;
  /** The application URL an operator would open. */
  appUrl: string;
  /** The layer whose features carry parcel identity. */
  parcelLayerUrl: string;
}

export interface ArcgisExecutorDeps {
  driver: BrowserDriver;
  config: ArcgisWebMapConfig;
  /** Injected in tests. Defaults to global fetch. */
  fetchJson?: (url: string) => Promise<unknown>;
  /** Where the map is aimed. Supplied by the caller from confirmed geometry. */
  subjectPoint?: { lon: number; lat: number } | null;
  zoomLevel?: number;
  /** Milliseconds to let the map render before a capture. */
  renderSettleMs?: number;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  return response.json();
}

/** First present, non-blank value among the candidate field names. */
export function firstFieldValue(
  attributes: Record<string, unknown> | null | undefined,
  candidates: readonly string[],
): string | null {
  if (!attributes) return null;
  for (const field of candidates) {
    const raw = attributes[field];
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (value) return value;
  }
  return null;
}

/**
 * Aim the application at the subject.
 *
 * `marker` is what makes the resulting screenshot self-evidencing: the pin
 * marks the exact confirmed interior point, so a reader can see WHICH polygon
 * the reading refers to rather than inferring it from the centre of the frame.
 * That distinction is not cosmetic — a subject's bounding-box centre can fall
 * inside a neighbouring parcel entirely.
 */
export function framedAppUrl(
  appUrl: string,
  point: { lon: number; lat: number } | null | undefined,
  level: number,
): string {
  if (!point) return appUrl;
  const separator = appUrl.includes('?') ? '&' : '?';
  const center = `${point.lon},${point.lat}`;
  return `${appUrl}${separator}center=${center}&level=${level}&marker=${center}`;
}

/**
 * A point that is genuinely INSIDE the subject parcel.
 *
 * Not the bounding-box centre, which is the obvious choice and a wrong one: on
 * this repo's own acceptance parcel the bbox centre falls inside the
 * neighbouring tract, so a map aimed there would frame — and a click there
 * would read — the wrong property. Esri's `returnCentroid` gives the layer's
 * label point, which is inside the polygon by construction, and the result is
 * verified by asking the layer which feature actually contains it before it is
 * trusted.
 */
export async function resolveSubjectPoint(
  parcelLayerUrl: string,
  objectId: number | string,
  expectedIdentifier: string | null,
  fetchJson: (url: string) => Promise<unknown> = defaultFetchJson,
): Promise<{ lon: number; lat: number } | null> {
  try {
    const centroidUrl = `${parcelLayerUrl}/query?objectIds=${encodeURIComponent(String(objectId))}&returnCentroid=true&returnGeometry=false&outSR=4326&f=json`;
    const json = await fetchJson(centroidUrl) as { features?: Array<{ centroid?: { x?: number; y?: number } }> };
    const centroid = json?.features?.[0]?.centroid;
    if (typeof centroid?.x !== 'number' || typeof centroid?.y !== 'number') return null;
    const point = { lon: centroid.x, lat: centroid.y };

    if (!expectedIdentifier) return point;
    // Verify: which feature actually contains this point?
    const checkUrl = `${parcelLayerUrl}/query?geometry=${point.lon},${point.lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json`;
    const check = await fetchJson(checkUrl) as { features?: Array<{ attributes?: Record<string, unknown> }> };
    const hit = check?.features?.[0]?.attributes ?? null;
    const identifier = firstFieldValue(hit, IDENTIFIER_FIELDS);
    if (!identifier) return null;
    const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim().toUpperCase();
    return normalize(identifier) === normalize(expectedIdentifier) ? point : null;
  } catch (error) {
    logger.info({ event: 'arcgis_subject_point_failed', msg: (error as Error)?.message }, 'arcgis_subject_point_failed');
    return null;
  }
}

export function createArcgisInteractiveExecutor(deps: ArcgisExecutorDeps): GisBrowserExecutor {
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  const level = deps.zoomLevel ?? 16;
  const settleMs = deps.renderSettleMs ?? 6_000;
  let cachedLayers: GisLayerRef[] | null = null;

  /**
   * The identifier fields this layer ACTUALLY has.
   *
   * A `where` clause naming a column the layer does not publish is rejected
   * outright by ArcGIS — the whole query fails, not just that predicate — so
   * the candidate list has to be intersected with the real schema before it is
   * used. Read once per executor.
   */
  let identifierFields: string[] | null = null;
  const resolveIdentifierFields = async (): Promise<string[]> => {
    if (identifierFields) return identifierFields;
    try {
      const meta = await fetchJson(`${deps.config.parcelLayerUrl}?f=json`) as { fields?: Array<{ name?: string }> };
      const present = new Set((meta?.fields ?? []).map((field) => String(field.name ?? '')));
      identifierFields = IDENTIFIER_FIELDS.filter((field) => present.has(field));
    } catch {
      identifierFields = [];
    }
    return identifierFields;
  };

  const queryParcel = async (subject: GisSubject): Promise<Record<string, string> | null> => {
    const apn = (subject.apn ?? '').trim();
    if (!apn) return null;
    const fields = await resolveIdentifierFields();
    if (!fields.length) {
      logger.info({ event: 'arcgis_no_identifier_field', layer: deps.config.parcelLayerUrl }, 'arcgis_no_identifier_field');
      return null;
    }
    // Esri parcel keys are punctuation-inconsistent across counties, so the
    // match is made on the tokens both sides agree on rather than on an exact
    // string the source never promised. A wildcard BETWEEN the map and the
    // map-and-parcel key spans whatever padding the county used, while still
    // separating `042 12300` from its neighbour `042 12310`. String functions
    // are avoided deliberately: hosted feature services vary in which they
    // accept, and a rejected `where` fails the whole query rather than one
    // predicate. The session's own confirmation step is what turns a candidate
    // into the subject.
    const parts = apn.toUpperCase().split(/[^0-9A-Z]+/).filter(Boolean);
    if (parts.length < 2) return null;
    const parcelKey = parts.length >= 3 ? `${parts[1]}${parts[2]}` : parts[1];
    const where = fields
      .map((field) => `${field} LIKE '%${parts[0]}%${parcelKey}%'`)
      .join(' OR ');
    const url = `${deps.config.parcelLayerUrl}/query?where=${encodeURIComponent(where)}&outFields=*&returnGeometry=false&resultRecordCount=5&f=json`;
    try {
      const json = await fetchJson(url) as { features?: Array<{ attributes?: Record<string, unknown> }>; error?: unknown };
      if (json?.error) {
        logger.info({ event: 'arcgis_parcel_query_rejected', detail: JSON.stringify(json.error).slice(0, 200) }, 'arcgis_parcel_query_rejected');
        return null;
      }
      if (!json?.features?.length) return null;
      const attributes = json.features[0]?.attributes ?? null;
      if (!attributes) return null;
      const flattened: Record<string, string> = {};
      for (const [key, value] of Object.entries(attributes)) {
        flattened[key] = value === null || value === undefined ? '' : String(value).trim();
      }
      return flattened;
    } catch (error) {
      logger.info({ event: 'arcgis_parcel_query_failed', msg: (error as Error)?.message }, 'arcgis_parcel_query_failed');
      return null;
    }
  };

  return {
    id: `arcgis:${deps.config.webMapItemId}`,

    async openApp(url: string, opts: GisStepOptions) {
      const framed = framedAppUrl(url, deps.subjectPoint, level);
      const read = await deps.driver.open(framed, { timeoutMs: opts.timeoutMs });
      // Esri viewers bootstrap the map after the document is ready; capturing
      // before it paints produces a blank frame that proves nothing.
      await new Promise((resolve) => setTimeout(resolve, settleMs));
      return { url: framed, title: (read as { title?: string })?.title ?? null };
    },

    async locateSubject(subject: GisSubject) {
      const attributes = await queryParcel(subject);
      if (!attributes) return null;
      return {
        identifier: firstFieldValue(attributes, IDENTIFIER_FIELDS),
        owner: firstFieldValue(attributes, OWNER_FIELDS),
        attributes,
      };
    },

    async listLayers() {
      if (cachedLayers) return cachedLayers;
      const url = `${deps.config.portalUrl}/sharing/rest/content/items/${deps.config.webMapItemId}/data?f=json`;
      const layers: GisLayerRef[] = [];
      try {
        const json = await fetchJson(url) as { operationalLayers?: unknown[] };
        // Group titles travel down with their children: a web map that
        // publishes its zoning as "Parcels" inside "Fairview Public Zoning"
        // carries the question signal on the group, not the leaf.
        const walk = (entries: unknown[], groupTitle: string | null): void => {
          for (const entry of entries) {
            const layer = entry as {
              id?: string; title?: string; url?: string; layers?: unknown[];
              layerType?: string;
            };
            if (Array.isArray(layer.layers)) {
              walk(layer.layers, layer.title ?? groupTitle);
              continue;
            }
            if (!layer.title) continue;
            layers.push({
              id: String(layer.id ?? layer.title),
              title: layer.title,
              groupTitle,
              url: layer.url ?? null,
            });
          }
        };
        walk(json?.operationalLayers ?? [], null);
      } catch (error) {
        logger.info({ event: 'arcgis_webmap_layers_failed', msg: (error as Error)?.message }, 'arcgis_webmap_layers_failed');
      }
      // The drawing field and vintage make a layer usable as zoning evidence,
      // so they are read from the service rather than assumed.
      for (const layer of layers) {
        if (!layer.url) continue;
        try {
          const meta = await fetchJson(`${layer.url}?f=json`) as {
            drawingInfo?: { renderer?: { field1?: string; field?: string } };
            editingInfo?: { lastEditDate?: number };
          };
          layer.rendererField = meta?.drawingInfo?.renderer?.field1 ?? meta?.drawingInfo?.renderer?.field ?? null;
          const stamp = meta?.editingInfo?.lastEditDate;
          layer.lastEditedAt = typeof stamp === 'number' ? new Date(stamp).toISOString() : null;
        } catch { /* a layer whose metadata will not load simply carries none */ }
      }
      cachedLayers = layers;
      return layers;
    },

    async setLayerVisible(layer: GisLayerRef) {
      // A web map's operational layers render on load; this executor does not
      // hide the others, it reports what the application actually shows. A
      // platform whose layers start off would override this method.
      return !!layer.url;
    },

    async readSubjectAttributes(subject: GisSubject) {
      return queryParcel(subject);
    },

    async readLegend(layer: GisLayerRef) {
      if (!layer.url) return [];
      try {
        const meta = await fetchJson(`${layer.url}?f=json`) as {
          drawingInfo?: { renderer?: { uniqueValueInfos?: Array<{ value?: string; label?: string }> } };
        };
        return (meta?.drawingInfo?.renderer?.uniqueValueInfos ?? [])
          .map((entry) => ({ value: String(entry.value ?? ''), label: String(entry.label ?? entry.value ?? '') }))
          .filter((entry) => entry.value);
      } catch {
        return [];
      }
    },

    async capture(purpose: string, layersVisible: string[], opts: GisStepOptions & { legend?: boolean }): Promise<GisScreenshot | null> {
      try {
        const shot = await deps.driver.screenshot(purpose, { timeoutMs: opts.timeoutMs });
        return {
          path: shot.path,
          purpose,
          layersVisible,
          // Esri Map Viewer renders the legend panel with the map; when the
          // caller asked for it, the frame contains it.
          legendCaptured: opts.legend === true,
          capturedAtIso: shot.capturedAtIso,
        };
      } catch (error) {
        logger.info({ event: 'arcgis_capture_failed', msg: (error as Error)?.message }, 'arcgis_capture_failed');
        return null;
      }
    },
  };
}
