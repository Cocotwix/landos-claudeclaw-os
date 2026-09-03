// LandOS — ArcGIS structured-service DISCOVERY (PART 3).
//
// A very large share of U.S. county parcel and zoning maps are Esri underneath,
// including many that look bespoke. Before anything clicks a map, this module
// walks from whatever URL LandOS has down to the actual queryable services:
//
//   app URL → portal item → app config → web map → operational layers → layer
//   service root → folders → services → layers
//
// Everything here is generic. There is no county in this file, and none may be
// added: a deployment differs only in which layers exist and what its fields
// are called, and both are discovered at runtime.
//
// The transport is injected so the whole traversal is testable without a
// network, and so the escalation budget in `gis-escalation.ts` can count and
// cap real requests.

/* ─────────────────────────────── transport ───────────────────────────── */

export interface ArcgisHttpResponse {
  status: number;
  contentType: string;
  body: string;
  /** URL after redirects. */
  url: string;
}

export interface ArcgisRequestInit {
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export type ArcgisFetch = (url: string, init?: ArcgisRequestInit) => Promise<ArcgisHttpResponse>;

export interface ArcgisDiscoveryDeps {
  fetch?: ArcgisFetch;
  /** Refuse to start another request when the owning stage has spent its budget. */
  canRequest?: () => boolean;
  /** Called before every request so a caller can enforce a request budget. */
  onRequest?: (url: string) => void;
  timeoutMs?: number;
}

/** Beyond this the URL risks a host-side length rejection, so switch to POST. */
const GET_URL_LIMIT = 1800;

const DEFAULT_TIMEOUT_MS = 20_000;

export const defaultArcgisFetch: ArcgisFetch = async (url, init = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(init.timeoutMs ?? DEFAULT_TIMEOUT_MS, 60_000)));
  try {
    const response = await fetch(url, {
      method: init.method ?? 'GET',
      body: init.body,
      headers: {
        // Several county web adaptors reject an empty user agent outright.
        'user-agent': 'LandOS/1.0 (official parcel research)',
        accept: 'application/json,text/plain,*/*',
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      body: await response.text(),
      url: response.url || url,
    };
  } finally {
    clearTimeout(timer);
  }
};

/** An ArcGIS error. The service answers HTTP 200 with the error in the BODY,
 *  so the HTTP status can never be trusted on its own. */
export interface ArcgisError {
  code: number;
  message: string;
  /** 499 = token required, 498 = invalid token. */
  requiresToken: boolean;
}

export class ArcgisRequestError extends Error {
  constructor(readonly url: string, readonly detail: ArcgisError | null, message: string) {
    super(message);
    this.name = 'ArcgisRequestError';
  }
}

function parseArcgisError(payload: unknown): ArcgisError | null {
  const error = (payload as { error?: { code?: number; message?: string } })?.error;
  if (!error) return null;
  const code = Number(error.code ?? 0);
  return { code, message: String(error.message ?? 'ArcGIS error'), requiresToken: code === 499 || code === 498 };
}

/**
 * Fetch an ArcGIS REST resource as JSON. Adds `f=json`, switches to POST when
 * the URL would be too long, refuses HTML bodies (a WAF page or a services
 * directory rendering), and surfaces the in-body error rather than a 200.
 */
export async function arcgisJson<T = Record<string, unknown>>(
  endpoint: string,
  params: Record<string, string> = {},
  deps: ArcgisDiscoveryDeps = {},
): Promise<T> {
  const http = deps.fetch ?? defaultArcgisFetch;
  const search = new URLSearchParams({ f: 'json', ...params });
  const getUrl = `${endpoint}${endpoint.includes('?') ? '&' : '?'}${search}`;
  if (deps.canRequest && !deps.canRequest()) {
    throw new ArcgisRequestError(endpoint, null, 'ArcGIS request skipped because the owning stage budget is spent.');
  }
  deps.onRequest?.(endpoint);

  const response = getUrl.length <= GET_URL_LIMIT
    ? await http(getUrl, { timeoutMs: deps.timeoutMs })
    : await http(endpoint, {
        method: 'POST',
        body: search.toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        timeoutMs: deps.timeoutMs,
      });

  const trimmed = response.body.trimStart();
  if (trimmed.startsWith('<')) {
    // HTML where JSON was asked for: a login wall, a bot interstitial, or a
    // services directory that ignored f=json. Never parse it as data.
    throw new ArcgisRequestError(endpoint, null, `Expected JSON from ${endpoint} but received HTML (HTTP ${response.status}).`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    throw new ArcgisRequestError(endpoint, null, `Unparseable response from ${endpoint} (HTTP ${response.status}).`);
  }

  const error = parseArcgisError(payload);
  if (error) {
    throw new ArcgisRequestError(endpoint, error, `${endpoint} returned ArcGIS error ${error.code}: ${error.message}`);
  }
  if (response.status >= 400) {
    throw new ArcgisRequestError(endpoint, null, `${endpoint} returned HTTP ${response.status}.`);
  }
  return payload as T;
}

/* ──────────────────────────── URL structure ──────────────────────────── */

/**
 * The server context is NOT fixed. `/arcgis`, `/server`, `/mapping`,
 * `/hosting` and bespoke contexts all occur; only `/rest/services` is
 * invariant, so that is what LandOS anchors on.
 */
const REST_SERVICES = /^(.*?)\/rest\/services(?:\/(.*))?$/i;
const SERVICE_TYPES = ['MapServer', 'FeatureServer', 'ImageServer', 'GeocodeServer', 'GeometryServer', 'VectorTileServer', 'GPServer'] as const;
export type ArcgisServiceType = (typeof SERVICE_TYPES)[number];

export interface ParsedArcgisUrl {
  /** Everything up to and including `/rest/services`. */
  servicesRoot: string;
  /** Folder path, when the service lives in one. */
  folder: string | null;
  serviceName: string | null;
  serviceType: ArcgisServiceType | null;
  /** Service URL without a layer index. */
  serviceUrl: string | null;
  layerId: number | null;
}

/** Split an ArcGIS REST URL into its parts. Returns null when it is not one. */
export function parseArcgisUrl(url: string): ParsedArcgisUrl | null {
  const clean = url.split('?')[0].replace(/\/+$/, '');
  const match = REST_SERVICES.exec(clean);
  if (!match) return null;
  const servicesRoot = `${match[1]}/rest/services`;
  const rest = match[2] ?? '';
  if (!rest) return { servicesRoot, folder: null, serviceName: null, serviceType: null, serviceUrl: null, layerId: null };

  const parts = rest.split('/');
  const typeIndex = parts.findIndex((p) => (SERVICE_TYPES as readonly string[]).includes(p));
  if (typeIndex < 0) {
    // Only a folder path was supplied.
    return { servicesRoot, folder: rest, serviceName: null, serviceType: null, serviceUrl: null, layerId: null };
  }
  const serviceType = parts[typeIndex] as ArcgisServiceType;
  const before = parts.slice(0, typeIndex);
  const serviceName = before[before.length - 1] ?? null;
  const folder = before.length > 1 ? before.slice(0, -1).join('/') : null;
  const serviceUrl = `${servicesRoot}/${before.join('/')}/${serviceType}`;
  const after = parts[typeIndex + 1];
  const layerId = after !== undefined && /^\d+$/.test(after) ? Number(after) : null;
  return { servicesRoot, folder, serviceName, serviceType, serviceUrl, layerId };
}

/** Contexts to probe when a services root 404s. Ordered by real-world frequency. */
export const ARCGIS_CONTEXT_CANDIDATES = ['arcgis', 'server', 'ArcGIS', 'gis', 'mapping', 'hosting', 'arcgissvr', 'agsmap'] as const;

/** ArcGIS Online / Portal item ids are exactly 32 lowercase hex characters. */
export const ARCGIS_ITEM_ID_PATTERN = /^[0-9a-f]{32}$/;

/**
 * Find a host's ArcGIS services root by probing the contexts that actually
 * occur in the wild.
 *
 * This is the single step that turns "LandOS has the county's official domain"
 * into "LandOS can query the county's parcels", with no per-county code. A 404
 * at `/arcgis/rest/services` usually means the wrong context, not a missing
 * server — so concluding "no GIS here" from one probe would be wrong far more
 * often than it would be right.
 */
export async function probeArcgisServicesRoot(
  hostOrUrl: string,
  deps: ArcgisDiscoveryDeps = {},
  contexts: readonly string[] = ARCGIS_CONTEXT_CANDIDATES,
): Promise<{ servicesRoot: string; currentVersion: number | null } | null> {
  let origin: string;
  try {
    origin = new URL(/^https?:/i.test(hostOrUrl) ? hostOrUrl : `https://${hostOrUrl}`).origin;
  } catch { return null; }

  for (const context of contexts) {
    const servicesRoot = `${origin}/${context}/rest/services`;
    try {
      // `/rest/info` is the cheapest existence probe and answers on every
      // ArcGIS Server even when the services directory listing is disabled.
      const info = await arcgisJson<{ currentVersion?: number }>(`${origin}/${context}/rest/info`, {}, deps);
      return { servicesRoot, currentVersion: typeof info.currentVersion === 'number' ? info.currentVersion : null };
    } catch {
      // Wrong context, or no server here. Try the next one.
    }
  }
  return null;
}

/** Pull an item id out of an app URL (`?id=`, `?appid=`, `/experience/<id>`). */
export function extractItemId(url: string): string | null {
  try {
    const parsed = new URL(url);
    for (const key of ['id', 'appid', 'appId', 'itemId', 'webmap']) {
      const value = parsed.searchParams.get(key);
      if (value && ARCGIS_ITEM_ID_PATTERN.test(value.toLowerCase())) return value.toLowerCase();
    }
    const pathHit = /\/(?:experience|apps|webmap)\/([0-9a-f]{32})/i.exec(parsed.pathname);
    if (pathHit) return pathHit[1].toLowerCase();
  } catch { /* fall through */ }
  const bare = /\b([0-9a-f]{32})\b/.exec(url);
  return bare ? bare[1].toLowerCase() : null;
}

/** Sharing API root for a portal. Defaults to ArcGIS Online. */
export function sharingRoot(portalUrl?: string | null): string {
  const base = (portalUrl ?? 'https://www.arcgis.com').replace(/\/+$/, '');
  return base.endsWith('/sharing/rest') ? base : `${base}/sharing/rest`;
}

/* ─────────────────────── service + layer metadata ────────────────────── */

export interface ArcgisLayerSummary {
  id: number;
  name: string;
  type: string;
  geometryType: string | null;
  parentLayerId: number | null;
  subLayerIds: number[] | null;
  serviceUrl: string;
  layerUrl: string;
  fields: Array<{ name: string; type: string; alias: string }>;
  capabilities: string;
  maxRecordCount: number | null;
  supportsPagination: boolean;
  queryable: boolean;
  /**
   * The service the layer belongs to, by name. A layer called "Sterling" tells
   * you nothing; the same layer inside a service called ZONING_CODE tells you
   * everything. Role classification would be wrong without this.
   */
  serviceName: string | null;
  /** The service's own description, which is where disclaimers live. */
  serviceDescription: string;
  /**
   * Discovery order of the seed this layer came from. Lower is more preferred,
   * so a county's own service outranks a statewide mirror when both publish a
   * plausible parcel layer.
   */
  sourceRank: number;
}

export interface ArcgisServiceSummary {
  serviceUrl: string;
  serviceType: ArcgisServiceType;
  currentVersion: number | null;
  description: string;
  capabilities: string;
  layers: ArcgisLayerSummary[];
  /** True when the service is a cached tile service and cannot answer attribute queries. */
  tiledOnly: boolean;
}

interface RawLayer {
  id?: number;
  name?: string;
  type?: string;
  geometryType?: string;
  parentLayerId?: number;
  subLayerIds?: number[] | null;
  fields?: Array<{ name?: string; type?: string; alias?: string }>;
  capabilities?: string;
  maxRecordCount?: number;
  advancedQueryCapabilities?: { supportsPagination?: boolean };
}

function toLayerSummary(
  raw: RawLayer,
  serviceUrl: string,
  serviceCapabilities: string,
  serviceName: string | null = null,
  serviceDescription = '',
  sourceRank = 0,
): ArcgisLayerSummary {
  const capabilities = raw.capabilities ?? serviceCapabilities ?? '';
  return {
    serviceName,
    serviceDescription,
    sourceRank,
    id: Number(raw.id ?? 0),
    name: String(raw.name ?? ''),
    type: String(raw.type ?? ''),
    geometryType: raw.geometryType ?? null,
    parentLayerId: raw.parentLayerId ?? null,
    subLayerIds: raw.subLayerIds ?? null,
    serviceUrl,
    layerUrl: `${serviceUrl}/${raw.id ?? 0}`,
    fields: (raw.fields ?? []).map((f) => ({ name: String(f.name ?? ''), type: String(f.type ?? ''), alias: String(f.alias ?? f.name ?? '') })),
    capabilities,
    maxRecordCount: typeof raw.maxRecordCount === 'number' ? raw.maxRecordCount : null,
    supportsPagination: raw.advancedQueryCapabilities?.supportsPagination === true,
    // `Query` is case-sensitive in the capabilities string. A service with only
    // `Map` renders tiles and cannot answer an attribute query.
    queryable: /(^|,)\s*Query\s*(,|$)/.test(capabilities),
  };
}

/**
 * Describe a service and all of its layers. Uses the bulk `/layers` endpoint
 * so one request replaces N per-layer requests; falls back to the service root
 * when a deployment does not support it.
 */
export async function describeArcgisService(
  serviceUrl: string,
  deps: ArcgisDiscoveryDeps = {},
  sourceRank = 0,
): Promise<ArcgisServiceSummary> {
  const parsed = parseArcgisUrl(serviceUrl);
  const serviceType = (parsed?.serviceType ?? 'MapServer') as ArcgisServiceType;
  const root = await arcgisJson<{
    currentVersion?: number;
    serviceDescription?: string;
    description?: string;
    capabilities?: string;
    singleFusedMapCache?: boolean;
    layers?: RawLayer[];
    tables?: RawLayer[];
  }>(serviceUrl, {}, deps);

  const capabilities = String(root.capabilities ?? '');
  const description = String(root.serviceDescription ?? root.description ?? '');
  const serviceName = parsed?.serviceName ?? null;
  const wrap = (l: RawLayer) => toLayerSummary(l, serviceUrl, capabilities, serviceName, description, sourceRank);

  let layers: ArcgisLayerSummary[] = [];
  try {
    const bulk = await arcgisJson<{ layers?: RawLayer[]; tables?: RawLayer[] }>(`${serviceUrl}/layers`, {}, deps);
    layers = [...(bulk.layers ?? []), ...(bulk.tables ?? [])].map(wrap);
  } catch {
    // Older or restricted deployments have no /layers. The service root still
    // lists layer ids and names, just without field definitions.
    layers = [...(root.layers ?? []), ...(root.tables ?? [])].map(wrap);
  }

  return {
    serviceUrl,
    serviceType,
    currentVersion: typeof root.currentVersion === 'number' ? root.currentVersion : null,
    description,
    capabilities,
    layers,
    tiledOnly: root.singleFusedMapCache === true,
  };
}

/** Enumerate every service under a services root, recursing folders once. */
export async function enumerateArcgisServices(
  servicesRoot: string,
  deps: ArcgisDiscoveryDeps = {},
  options: { maxFolders?: number } = {},
): Promise<Array<{ name: string; type: ArcgisServiceType; url: string }>> {
  const maxFolders = options.maxFolders ?? 24;
  const root = await arcgisJson<{ folders?: string[]; services?: Array<{ name: string; type: string }> }>(servicesRoot, {}, deps);
  const out: Array<{ name: string; type: ArcgisServiceType; url: string }> = [];

  const collect = (services: Array<{ name: string; type: string }> | undefined) => {
    for (const service of services ?? []) {
      if (!(SERVICE_TYPES as readonly string[]).includes(service.type)) continue;
      // Folder services come back folder-qualified already; do not re-prepend.
      out.push({ name: service.name, type: service.type as ArcgisServiceType, url: `${servicesRoot}/${service.name}/${service.type}` });
    }
  };

  collect(root.services);
  for (const folder of (root.folders ?? []).slice(0, maxFolders)) {
    try {
      const sub = await arcgisJson<{ services?: Array<{ name: string; type: string }> }>(`${servicesRoot}/${folder}`, {}, deps);
      collect(sub.services);
    } catch {
      // A single unreadable folder must never abort the enumeration.
    }
  }
  return out;
}

/* ───────────────────── app / item / web map traversal ────────────────── */

export interface DiscoveredLayerRef {
  title: string;
  url: string;
  /** Where the reference came from, so a wrong turn is traceable. */
  origin: 'experience_builder_datasource' | 'web_map_operational_layer' | 'web_appbuilder_config' | 'services_enumeration' | 'direct_url';
  itemId?: string;
}

interface WebMapLayer {
  title?: string;
  url?: string;
  itemId?: string;
  layerType?: string;
  layers?: WebMapLayer[];
}

/** Flatten a web map's operational layers, recursing group layers. */
export function flattenWebMapLayers(operationalLayers: WebMapLayer[] | undefined): DiscoveredLayerRef[] {
  const out: DiscoveredLayerRef[] = [];
  const walk = (layers: WebMapLayer[] | undefined) => {
    for (const layer of layers ?? []) {
      if (layer.layers?.length) { walk(layer.layers); continue; }
      if (!layer.url) {
        // Item-backed layer with no inline URL. Recorded so the caller can
        // resolve it, rather than silently dropped.
        if (layer.itemId) out.push({ title: String(layer.title ?? layer.itemId), url: '', origin: 'web_map_operational_layer', itemId: layer.itemId });
        continue;
      }
      out.push({
        title: String(layer.title ?? layer.url),
        // Many older web maps still advertise http; upgrade before fetching.
        url: layer.url.replace(/^http:\/\//i, 'https://'),
        origin: 'web_map_operational_layer',
        ...(layer.itemId ? { itemId: layer.itemId } : {}),
      });
    }
  };
  walk(operationalLayers);
  return out;
}

/** Pull pre-resolved feature-layer URLs out of an Experience Builder app config. */
export function experienceBuilderLayers(appData: Record<string, unknown>): {
  layers: DiscoveredLayerRef[];
  webMapItemIds: string[];
  portalUrl: string | null;
} {
  const dataSources = (appData.dataSources ?? {}) as Record<string, {
    type?: string;
    url?: string;
    itemId?: string;
    portalUrl?: string;
    sourceLabel?: string;
    layerId?: number;
  }>;
  const layers: DiscoveredLayerRef[] = [];
  const webMapItemIds: string[] = [];
  let portalUrl: string | null = null;

  for (const [key, source] of Object.entries(dataSources)) {
    if (source?.portalUrl && !portalUrl) portalUrl = source.portalUrl;
    if (source?.type === 'WEB_MAP' && source.itemId) { webMapItemIds.push(source.itemId); continue; }
    if (source?.url) {
      layers.push({
        title: String(source.sourceLabel ?? key),
        url: source.url.replace(/^http:\/\//i, 'https://'),
        origin: 'experience_builder_datasource',
        ...(source.itemId ? { itemId: source.itemId } : {}),
      });
    }
  }
  return { layers, webMapItemIds, portalUrl };
}

/** Web AppBuilder / configurable / Instant apps all point at one web map id. */
export function webAppBuilderWebMapId(appData: Record<string, unknown>): string | null {
  const map = appData.map as { itemId?: string } | undefined;
  if (map?.itemId && ARCGIS_ITEM_ID_PATTERN.test(map.itemId)) return map.itemId;
  const values = appData.values as { webmap?: string } | undefined;
  if (values?.webmap && ARCGIS_ITEM_ID_PATTERN.test(values.webmap)) return values.webmap;
  const direct = appData.webmap;
  if (typeof direct === 'string' && ARCGIS_ITEM_ID_PATTERN.test(direct)) return direct;
  return null;
}

export interface ItemTraversalResult {
  layers: DiscoveredLayerRef[];
  /** Item types walked, for the evidence trail. */
  path: string[];
}

/**
 * Walk a portal item down to concrete service URLs. Handles the three shapes
 * that cover essentially all county deployments: Experience Builder, Web
 * AppBuilder / Instant / configurable apps, and a plain web map.
 */
export async function traverseArcgisItem(
  itemId: string,
  portalUrl: string | null,
  deps: ArcgisDiscoveryDeps = {},
  depth = 0,
): Promise<ItemTraversalResult> {
  if (depth > 2) return { layers: [], path: ['depth_limit'] };
  const sharing = sharingRoot(portalUrl);
  const path: string[] = [];

  const item = await arcgisJson<{ type?: string; typeKeywords?: string[]; url?: string }>(
    `${sharing}/content/items/${itemId}`, {}, deps,
  );
  const itemType = String(item.type ?? 'unknown');
  path.push(itemType);

  // A Feature/Map Service item points straight at the service.
  if (item.url && /\/rest\/services\//i.test(item.url)) {
    return { layers: [{ title: itemType, url: item.url.replace(/^http:\/\//i, 'https://'), origin: 'direct_url', itemId }], path };
  }

  const data = await arcgisJson<Record<string, unknown>>(`${sharing}/content/items/${itemId}/data`, {}, deps);

  // Experience Builder: dataSources usually carry resolved layer URLs already,
  // which lets LandOS skip the web map entirely.
  if (data.dataSources) {
    const exb = experienceBuilderLayers(data);
    path.push('experience_builder');
    if (exb.layers.length) return { layers: exb.layers, path };
    for (const webMapId of exb.webMapItemIds.slice(0, 2)) {
      const nested = await traverseArcgisItem(webMapId, exb.portalUrl ?? portalUrl, deps, depth + 1);
      if (nested.layers.length) return { layers: nested.layers, path: [...path, ...nested.path] };
    }
  }

  // A web map itself.
  if (Array.isArray(data.operationalLayers)) {
    path.push('web_map');
    return { layers: flattenWebMapLayers(data.operationalLayers as WebMapLayer[]), path };
  }

  // Web AppBuilder / Instant / configurable app wrapping a web map.
  const webMapId = webAppBuilderWebMapId(data);
  if (webMapId) {
    path.push('app_config');
    const nested = await traverseArcgisItem(webMapId, portalUrl, deps, depth + 1);
    return { layers: nested.layers, path: [...path, ...nested.path] };
  }

  return { layers: [], path: [...path, 'no_layers_found'] };
}

/* ───────────────────────── layer role classification ─────────────────── */

export type LayerRole = 'parcel' | 'zoning' | 'address' | 'boundary' | 'overlay' | 'imagery' | 'other';

/** Tokens that make a layer look like the thing named, scored positively. */
const ROLE_NAME_TOKENS: Record<Exclude<LayerRole, 'other'>, RegExp[]> = {
  parcel: [/\bparcels?\b/i, /\btax\s*parcels?\b/i, /\bcadastr/i, /\bproperty\b/i, /\bownership\b/i, /\blots?\b/i, /\bassessor/i, /\breal\s*propert/i],
  zoning: [/\bzoning\b/i, /\bzone[sd]?\b/i, /\bland\s*use\b/i, /\bfuture\s*land\s*use\b/i, /\bflu\b/i, /\bzoning\s*districts?\b/i],
  address: [/\baddress(es|\s*points?)?\b/i, /\bsitus\b/i, /\bE911\b/i],
  boundary: [/\bboundar/i, /\bmunicipalit/i, /\btownship/i, /\bcity\s*limits?\b/i, /\bcorporate\s*limits?\b/i, /\bjurisdiction/i, /\bcounty\b/i],
  overlay: [/\boverlay\b/i, /\bdistricts?\b/i, /\bhistoric\b/i],
  imagery: [/\bimagery\b/i, /\bortho/i, /\baerial\b/i, /\bbasemap\b/i],
};

/** Tokens that disqualify a layer even when the name otherwise matches. */
const PARCEL_NEGATIVE_TOKENS = [
  /\bcentroid/i, /\bpoints?\b/i, /\bdimension/i, /\blines?\b/i, /\bannotation/i,
  /\bhistoric/i, /\barchive/i, /\bold\b/i, /\bfootprint/i, /\bsales?\b/i, /\btext\b/i,
  // "Parcel Number", "Parcel Label" and friends are cartographic label layers
  // that carry the parcel name but none of the parcel data.
  /\bnumbers?\b/i, /\blabels?\b/i, /\bcallouts?\b/i, /\banno\b/i,
];

/**
 * Layer names arrive as `NYS_Tax_Parcels_Public` as often as `Tax Parcels`.
 * Underscore is a word character, so `\bParcels\b` would not match the first
 * form — separators are flattened to spaces before any token test.
 */
function normalizeLayerName(name: string): string {
  return String(name ?? '').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Esri annotation feature classes carry these and never carry parcel data. */
const ANNOTATION_FIELDS = new Set(['ANNOTATIONCLASSID', 'TEXTSTRING', 'FONTNAME', 'SYMBOLID']);

/**
 * Field names that carry each role, drawn from what county deployments
 * actually publish. Matched case-insensitively with separators stripped, so
 * `PARCEL_ID`, `parcelid` and `Parcel Id` all resolve the same.
 */
export const FIELD_ROLE_CANDIDATES = {
  parcelId: [
    // Printed tax-map identifiers come first: a county that stores the printed
    // number with its own padding ("023  003.02") publishes it under a
    // TAX_MAP_NO / PBA_NUM style column beside a compact GISLINK.
    'TAXMAPNO', 'TAXMAPNUM', 'TAXMAP', 'PBANUM',
    'PARCELID', 'PARCELNO', 'PARCELNUM', 'PARCELNUMB', 'PARCELNMBR', 'APN', 'APNTEXT', 'PIN', 'PIN2', 'PID', 'PIDTEXT',
    'TAXPIN', 'TAXID', 'TMS', 'TMSNUMBER', 'GPIN', 'PROPERTYID', 'ACCOUNT', 'ACCOUNTNO', 'ACCT', 'MAPNO', 'MAPNUM',
    'GISLINK', 'PRINTKEY', 'SBL', 'SWISSBLID', 'SWISPRINTKEYID', 'SWISPIN', 'MUNIPARCELID', 'PARCEL',
  ],
  owner: [
    'PRIMARYOWNER', 'OWNERNAME', 'OWNERNAME1', 'OWNNAME1', 'OWNNAME', 'OWNERNME', 'OWNER', 'OWNER2', 'OWNERS', 'DEEDOWNER',
    'TAXPAYERNAME', 'TAXPAYER', 'NYSNAME', 'NAME1', 'NAME',
  ],
  situsAddress: [
    'PARCELADDR', 'SITEADDRESS', 'SITEADDRES', 'SITUSADDRESS', 'SITUSADDR', 'SITUS', 'PHYSADDR', 'PROPADDR',
    'PROPADDRESS', 'FULLADDR', 'LOCATION', 'ADDRESS', 'ADDR',
  ],
  acres: ['CALCACRES', 'GISACRES', 'DEEDACRES', 'DEEDAC', 'LEGALACRES', 'TOTALACRES', 'ACREAGE', 'ACERAGE', 'ACRES', 'ACRE', 'AREAAC'],
  zoningCode: [
    'ZONINGCODE', 'ZONECODE', 'ZONECLASS', 'ZONINGCLASS', 'ZONEABBR', 'ZONINGABBR', 'ZONETYPE', 'ZONEDIST',
    'ZONING', 'ZONE', 'ZNG', 'ZONINGCD', 'ZONINGDESC',
  ],
  zoningDescription: ['ZONINGDESC', 'ZONEDESC', 'ZONEDESCRIPTION', 'ZONENAME', 'ZONINGNAME', 'LONGNAME', 'DESCRIPTION', 'DESCRIPT'],
  municipality: [
    'MUNINAME', 'MUNICIPALITY', 'MUNICIPALI', 'CITYTOWNNAME', 'TOWNSHIP', 'TOWN', 'TWP', 'TWN', 'CITY',
    'JURISDICTION', 'JURIS', 'PLACE', 'SWIS',
  ],
  county: ['COUNTYNAME', 'COUNTY', 'COUNTYFIPS', 'COUNTYID'],
  schoolDistrict: ['SCHOOLNAME', 'SCHOOLCODE', 'SCHDIST', 'SCHOOLDIST', 'SCHOOL'],
  propertyClass: ['PROPCLASS', 'PROPERTYCLASS', 'USEDASCODE', 'USEDASDESC', 'LANDUSE', 'LUC', 'CLASSCD', 'PARCELTYPE'],
} as const;

export type FieldRole = keyof typeof FIELD_ROLE_CANDIDATES;

function normalizeFieldName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

/**
 * Resolve which of a layer's fields holds a given role. Candidates are ordered
 * most-specific first, so `CALC_ACRES` wins over a bare `ACRES` when both
 * exist and `PRIMARY_OWNER` wins over a generic `NAME`.
 */
export function resolveField(
  fields: ReadonlyArray<{ name: string }>,
  role: FieldRole,
): string | null {
  const byNormalized = new Map(fields.map((f) => [normalizeFieldName(f.name), f.name]));
  for (const candidate of FIELD_ROLE_CANDIDATES[role]) {
    const hit = byNormalized.get(candidate);
    if (hit) return hit;
  }
  return null;
}

/**
 * Every field whose name STARTS with a candidate for the role.
 *
 * Field names in county data are routinely truncated to ten characters by the
 * shapefile heritage of the pipeline that produced them, so a real acreage
 * field arrives as something like `Acreage_Ca` and matches no exact candidate.
 * This is deliberately kept separate from `resolveField` and returns every
 * match rather than one: a caller must validate the VALUE before trusting a
 * prefix hit, because a prefix will happily match an unrelated field that
 * merely shares an opening word.
 */
export function candidateFieldsByPrefix(
  fields: ReadonlyArray<{ name: string }>,
  role: FieldRole,
): string[] {
  const out: string[] = [];
  for (const field of fields) {
    const normalized = normalizeFieldName(field.name);
    for (const candidate of FIELD_ROLE_CANDIDATES[role]) {
      // Short candidates would match far too much to be worth guessing on.
      if (candidate.length < 5) continue;
      if (normalized.startsWith(candidate) && normalized !== candidate) { out.push(field.name); break; }
    }
  }
  return out;
}

export interface LayerRoleVerdict {
  role: LayerRole;
  score: number;
  reason: string;
}

/**
 * Classify what a layer is FOR, from its name plus the fields it actually
 * carries. Field evidence outweighs the name, because county layer names are
 * inconsistent while the field set is not.
 */
export function classifyLayerRole(layer: ArcgisLayerSummary): LayerRoleVerdict {
  const name = normalizeLayerName(layer.name);
  // The service name is often the only thing that disambiguates. A county that
  // publishes one layer per town inside a ZONING service gives those layers
  // town names and the full parcel attribute schema; without the service name
  // every one of them reads as a parcel layer and the wrong one gets queried.
  const serviceName = normalizeLayerName(layer.serviceName ?? '');
  const fieldNames = layer.fields.map((f) => f.name);

  // An annotation class is a map-label layer. It can be polygon-shaped and
  // named "Parcel Number", so it must be rejected on its fields, not its name.
  if (fieldNames.some((f) => ANNOTATION_FIELDS.has(normalizeFieldName(f)))) {
    return { role: 'other', score: 0, reason: `Layer "${layer.name}" is a cartographic annotation class, not a data layer.` };
  }
  const hasParcelId = !!resolveField(fieldNames.map((n) => ({ name: n })), 'parcelId');
  const hasOwner = !!resolveField(fieldNames.map((n) => ({ name: n })), 'owner');
  const hasSitus = !!resolveField(fieldNames.map((n) => ({ name: n })), 'situsAddress');
  const hasAcres = !!resolveField(fieldNames.map((n) => ({ name: n })), 'acres');
  const hasZoningCode = !!resolveField(fieldNames.map((n) => ({ name: n })), 'zoningCode');
  const isPolygon = layer.geometryType === 'esriGeometryPolygon';
  const negative = PARCEL_NEGATIVE_TOKENS.some((t) => t.test(name));

  const nameHit = (role: Exclude<LayerRole, 'other'>) => ROLE_NAME_TOKENS[role].some((t) => t.test(name));
  const serviceHit = (role: Exclude<LayerRole, 'other'>) => ROLE_NAME_TOKENS[role].some((t) => t.test(serviceName));

  // Zoning is checked before parcel: a zoning layer often carries parcel-ish
  // fields too, and misrouting it would silently corrupt the parcel lane.
  if (isPolygon && (nameHit('zoning') || serviceHit('zoning') || (hasZoningCode && !hasOwner && !hasSitus))) {
    const score = (nameHit('zoning') ? 4 : 0) + (serviceHit('zoning') ? 3 : 0) + (hasZoningCode ? 3 : 0);
    const where = nameHit('zoning') ? `named "${layer.name}"` : `named "${layer.name}" inside the "${layer.serviceName}" service`;
    return { role: 'zoning', score, reason: `Polygon layer ${where}${hasZoningCode ? ' carrying a zoning-code field' : ''}.` };
  }

  // A service that publishes one polygon layer per municipality gives those
  // layers town names and the full parcel attribute schema, so they read as
  // parcel layers on fields alone. The service name is what tells them apart.
  if (isPolygon && serviceHit('boundary') && !serviceHit('parcel') && !nameHit('parcel')) {
    return { role: 'boundary', score: 3, reason: `Polygon layer "${layer.name}" inside the "${layer.serviceName}" service is a jurisdiction boundary.` };
  }

  if (isPolygon && !negative) {
    const identityFields = [hasParcelId, hasOwner, hasSitus, hasAcres].filter(Boolean).length;
    if (nameHit('parcel') || serviceHit('parcel') || identityFields >= 3) {
      const score = (nameHit('parcel') ? 4 : 0) + (serviceHit('parcel') ? 2 : 0) + identityFields;
      return { role: 'parcel', score, reason: `Polygon layer "${layer.name}" carrying ${identityFields} of 4 parcel identity fields.` };
    }
  }

  if (nameHit('address')) return { role: 'address', score: 3, reason: `Layer named "${layer.name}" looks like an address layer.` };
  if (isPolygon && nameHit('boundary')) return { role: 'boundary', score: 3, reason: `Polygon layer named "${layer.name}" looks like a jurisdiction boundary.` };
  if (nameHit('imagery')) return { role: 'imagery', score: 2, reason: `Layer named "${layer.name}" is imagery or a basemap.` };
  if (isPolygon && nameHit('overlay')) return { role: 'overlay', score: 2, reason: `Polygon layer named "${layer.name}" looks like an overlay district.` };
  return { role: 'other', score: 0, reason: `Layer "${layer.name}" matched no known role.` };
}

/**
 * Best layer for a role across every discovered service.
 *
 * Ties break on `sourceRank`, which is why a county's own parcel service wins
 * over a statewide mirror of the same parcels: the county is the record of
 * origin, carries more attributes, and is more current.
 */
export function pickLayerForRole(
  layers: readonly ArcgisLayerSummary[],
  role: LayerRole,
): { layer: ArcgisLayerSummary; verdict: LayerRoleVerdict } | null {
  const ranked = layers
    .map((layer) => ({ layer, verdict: classifyLayerRole(layer) }))
    .filter((entry) => entry.verdict.role === role && entry.layer.queryable)
    .sort((a, b) => (a.layer.sourceRank - b.layer.sourceRank) || (b.verdict.score - a.verdict.score));
  return ranked[0] ?? null;
}

/**
 * Service-description language that says, in the publisher's own words, that a
 * code is for assessment rather than land-use regulation. Counties do publish
 * this caveat, and honouring it is the difference between an honest data point
 * and a false entitlement claim.
 */
const ASSESSMENT_ONLY_DISCLAIMER = [
  /for assessment purposes only/i,
  /not indicative of (local )?zoning/i,
  /assessment (code|classification)s? (only|are not)/i,
  /does not (represent|reflect) (the )?(official |legal )?zoning/i,
];

/** The publisher's own caveat, verbatim, when the service states one. */
export function assessmentOnlyDisclaimer(description: string): string | null {
  if (!description) return null;
  for (const pattern of ASSESSMENT_ONLY_DISCLAIMER) {
    const hit = pattern.exec(description);
    if (!hit) continue;
    // Return the surrounding sentence so the operator reads the real caveat,
    // not a fragment LandOS chose.
    const start = description.lastIndexOf('.', hit.index) + 1;
    const end = description.indexOf('.', hit.index + hit[0].length);
    return description.slice(start, end === -1 ? undefined : end + 1).trim();
  }
  return null;
}

/* ──────────────────────────────── query ──────────────────────────────── */

export interface ArcgisQueryOptions {
  where?: string;
  /** Point or polygon geometry in WGS84. */
  geometry?: { x: number; y: number } | { rings: Array<Array<[number, number]>> };
  spatialRel?: string;
  outFields?: string;
  returnGeometry?: boolean;
  resultRecordCount?: number;
  orderByFields?: string;
  returnCountOnly?: boolean;
}

export interface ArcgisFeature {
  attributes: Record<string, unknown>;
  geometry?: { rings?: Array<Array<[number, number]>>; x?: number; y?: number };
}

export interface ArcgisQueryResult {
  features: ArcgisFeature[];
  /** True when the service capped the result set, so the answer is partial. */
  exceededTransferLimit: boolean;
  count: number | null;
}

/**
 * Query a layer. Always requests `outSR=4326` — the layer's native spatial
 * reference is usually Web Mercator or State Plane, and geometry returned in
 * those units is unusable downstream and produces nonsense acreage.
 */
export async function queryArcgisLayer(
  layerUrl: string,
  options: ArcgisQueryOptions,
  deps: ArcgisDiscoveryDeps = {},
): Promise<ArcgisQueryResult> {
  const params: Record<string, string> = {
    where: options.where ?? '1=1',
    outFields: options.outFields ?? '*',
    returnGeometry: options.returnGeometry ? 'true' : 'false',
    outSR: '4326',
  };
  if (options.geometry) {
    if ('rings' in options.geometry) {
      params.geometry = JSON.stringify({ rings: options.geometry.rings, spatialReference: { wkid: 4326 } });
      params.geometryType = 'esriGeometryPolygon';
    } else {
      params.geometry = JSON.stringify({ x: options.geometry.x, y: options.geometry.y, spatialReference: { wkid: 4326 } });
      params.geometryType = 'esriGeometryPoint';
    }
    params.inSR = '4326';
    params.spatialRel = options.spatialRel ?? 'esriSpatialRelIntersects';
  }
  if (options.resultRecordCount) params.resultRecordCount = String(options.resultRecordCount);
  if (options.orderByFields) params.orderByFields = options.orderByFields;
  if (options.returnCountOnly) params.returnCountOnly = 'true';

  const payload = await arcgisJson<{
    features?: ArcgisFeature[];
    exceededTransferLimit?: boolean;
    count?: number;
  }>(`${layerUrl}/query`, params, deps);

  return {
    features: payload.features ?? [],
    exceededTransferLimit: payload.exceededTransferLimit === true,
    count: typeof payload.count === 'number' ? payload.count : null,
  };
}

/**
 * Where-clause cascade for a printed APN.
 *
 * The single highest-frequency real failure is an exact match returning zero
 * rows because the county stores the key differently from how it prints it
 * (padding, leading zeros, a trailing roll year, a SWIS prefix). So LandOS
 * tries exact, then punctuation-insensitive, then a prefix match — and reports
 * which strategy hit, so a weaker match is never mistaken for an exact one.
 */
export interface ApnWhereStrategy {
  where: string;
  strategy: 'exact' | 'normalized' | 'prefix';
  /** A prefix hit is weaker evidence and must be reconciled before acceptance. */
  exact: boolean;
}

function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export function apnWhereCascade(apn: string, field: string): ApnWhereStrategy[] {
  const raw = apn.trim();
  if (!raw) return [];
  const collapsed = raw.replace(/\s+/g, ' ');
  const out: ApnWhereStrategy[] = [
    { where: `${field} = '${sqlLiteral(collapsed)}'`, strategy: 'exact', exact: true },
  ];

  // The portable normalization. A county stores the same parcel with different
  // internal padding than it prints ("073 090    04200 000 2026" for a printed
  // "073090 04200"), so neither an exact match nor a whole-string containment
  // finds it. Interleaving the printed identifier's own tokens with wildcards
  // does, using nothing but LIKE.
  //
  // SQL functions are deliberately NOT used for this. Hosted services run
  // standardized queries and reject REPLACE outright, so a normalization built
  // on it would fail on exactly the deployments that need it most.
  const tokens = collapsed.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (tokens.length > 1) {
    const interleaved = tokens.map(sqlLiteral).join('%');
    out.push({ where: `${field} LIKE '${interleaved}%'`, strategy: 'normalized', exact: false });
    out.push({ where: `${field} LIKE '%${interleaved}%'`, strategy: 'normalized', exact: false });
  }

  // Last segment alone. Weakest, and only useful once reconciliation gates it.
  const tail = tokens[tokens.length - 1];
  if (tail && tokens.length > 1) {
    out.push({ where: `${field} LIKE '%${sqlLiteral(tail)}%'`, strategy: 'prefix', exact: false });
  }
  if (tokens.length === 1) {
    out.push({ where: `${field} LIKE '%${sqlLiteral(collapsed)}%'`, strategy: 'prefix', exact: false });
  }
  return out;
}

/**
 * Every field on a layer that could hold the printed parcel identifier,
 * best-guess first.
 *
 * One field is not enough: a deployment may publish the identifier in a padded
 * form in one column and a compact form in another, and only one of them will
 * match a given printed spelling. Bounded so a wide layer cannot turn a search
 * into a sweep.
 */
export function parcelIdFieldCandidates(
  fields: ReadonlyArray<{ name: string }>,
  limit = 3,
): string[] {
  const byNormalized = new Map(fields.map((f) => [normalizeFieldName(f.name), f.name]));
  const out: string[] = [];
  for (const candidate of FIELD_ROLE_CANDIDATES.parcelId) {
    const hit = byNormalized.get(candidate);
    if (hit && !out.includes(hit)) out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}

/** Where-clause candidates for a street address, most selective first. */
export function addressWhereCandidates(address: string, field: string): string[] {
  const clean = address.trim().replace(/\s+/g, ' ');
  if (!clean) return [];
  const upper = sqlLiteral(clean.toUpperCase());
  const withoutNumber = sqlLiteral(clean.toUpperCase().replace(/^\d+\s+/, ''));
  const out = [`UPPER(${field}) = '${upper}'`, `UPPER(${field}) LIKE '${upper}%'`];
  if (withoutNumber && withoutNumber !== upper) out.push(`UPPER(${field}) LIKE '%${withoutNumber}%'`);
  return out;
}

/** Reproject nothing: geometry already arrives as 4326 rings from `queryArcgisLayer`. */
export function featureRings(feature: ArcgisFeature): Array<Array<[number, number]>> | null {
  const rings = feature.geometry?.rings;
  if (!rings?.length) return null;
  return rings;
}
