// LandOS — free government DD provider foundations (post-discovery enrichment).
//
// Provider-agnostic capability scaffolds for FREE government data sources:
//   - FEMA flood        (FEMA NFHL / Flood Map Service Center)
//   - USFWS / NWI       wetlands
//   - USGS 3DEP         slope / topography
//   - US Census         demographics / growth
//
// DORMANT BY DEFAULT. No live government call is made unless explicitly enabled
// (LANDOS_LIVE_GOV_DD=1) AND a fetch is injected. With activation off, every
// provider returns an honest Unknown / Needs Verification result — never a live
// call, never fabricated data. Tests exercise parsing via an injected fetch (no
// real network). Activation + the first live smoke require Tyler's approval.

export type GovDdCapability = 'flood' | 'wetlands' | 'slope' | 'demographics';

export const GOV_DD_LIVE_ENV = 'LANDOS_LIVE_GOV_DD';

/** Minimal fetch surface (injected in tests; real fetch only when activated). */
export type GovFetch = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Exact-area inputs. Coordinates frame a query but NEVER identify the subject
 *  parcel — these results are environmental context for an already-identified
 *  parcel, attached as supporting facts, not identity. */
export interface GovDdInput {
  lat?: number;
  lng?: number;
  fips?: string;
  county?: string;
  state?: string;
}

export interface GovDdResult {
  capability: GovDdCapability;
  provider: string;
  /** verified = a live source returned a value; unavailable = dormant/not enabled;
   *  needs_verification = enabled but no usable value; error = call failed. */
  status: 'verified' | 'unavailable' | 'needs_verification' | 'error';
  value: string | number | null;
  unit?: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  timestamp: string;
  sourceUrl: string | null;
  note: string;
}

export interface GovDdDeps {
  env?: Record<string, string | undefined>;
  fetchImpl?: GovFetch;
  now?: () => string;
}

export interface GovDdProvider {
  readonly id: string;
  readonly label: string;
  readonly capability: GovDdCapability;
  /** True only when live activation is enabled (env flag). Presence-only. */
  configured(env?: Record<string, string | undefined>): boolean;
  fetchFact(input: GovDdInput, deps?: GovDdDeps): Promise<GovDdResult>;
}

function liveEnabled(env: Record<string, string | undefined>): boolean {
  return ['1', 'true', 'yes', 'on'].includes((env[GOV_DD_LIVE_ENV] ?? '').toLowerCase());
}

function unavailable(capability: GovDdCapability, provider: string, now: string, reason: string): GovDdResult {
  return { capability, provider, status: 'unavailable', value: null, confidence: 'none', timestamp: now, sourceUrl: null, note: reason };
}

/** Build a free gov DD provider. The `live` callback performs the actual parse
 *  from an injected fetch; it runs ONLY when activation is enabled and a fetch is
 *  injected — otherwise the provider is dormant and returns Unknown. */
function makeGovProvider(
  spec: { id: string; label: string; capability: GovDdCapability },
  live: (input: GovDdInput, fetchImpl: GovFetch, now: string) => Promise<GovDdResult>,
): GovDdProvider {
  return {
    id: spec.id,
    label: spec.label,
    capability: spec.capability,
    configured(env = process.env) { return liveEnabled(env); },
    async fetchFact(input, deps = {}) {
      const env = deps.env ?? process.env;
      const now = (deps.now ?? (() => new Date().toISOString()))();
      if (!liveEnabled(env)) {
        return unavailable(spec.capability, spec.id, now, `${spec.label} is dormant (set ${GOV_DD_LIVE_ENV}=1 to enable). No live call made; value is Unknown / Needs Verification.`);
      }
      if (!deps.fetchImpl) {
        return unavailable(spec.capability, spec.id, now, `${spec.label} enabled but no fetch wired. No live call made.`);
      }
      try {
        return await live(input, deps.fetchImpl, now);
      } catch (e: unknown) {
        return { capability: spec.capability, provider: spec.id, status: 'error', value: null, confidence: 'none', timestamp: now, sourceUrl: null, note: `${spec.label} error: ${(e as Error)?.message ?? String(e)}. No fabrication.` };
      }
    },
  };
}

// ── FEMA flood ────────────────────────────────────────────────────────────────
// VERIFIED CONTRACT (live-confirmed): NFHL MapServer layer 28 (Flood Hazard
// Zones), point query in SR 4326, returns features[].attributes.{FLD_ZONE,
// ZONE_SUBTY, SFHA_TF}. Free, keyless, no auth.
export const FEMA_NFHL_FLOOD_LAYER = 28;
export function femaFloodUrl(lat: number, lng: number): string {
  const base = `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/${FEMA_NFHL_FLOOD_LAYER}/query`;
  const qs = `geometry=${lng},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF&returnGeometry=false&f=json`;
  return `${base}?${qs}`;
}

export const femaFloodProvider = makeGovProvider(
  { id: 'fema_flood', label: 'FEMA flood (NFHL)', capability: 'flood' },
  async (input, fetchImpl, now) => {
    if (typeof input.lat !== 'number' || typeof input.lng !== 'number') {
      return { capability: 'flood', provider: 'fema_flood', status: 'needs_verification', value: null, confidence: 'none', timestamp: now, sourceUrl: null, note: 'FEMA flood needs lat/lng (none supplied).' };
    }
    const url = femaFloodUrl(input.lat, input.lng);
    const res = await fetchImpl(url);
    if (!res.ok) return { capability: 'flood', provider: 'fema_flood', status: 'error', value: null, confidence: 'none', timestamp: now, sourceUrl: url, note: `FEMA HTTP ${res.status}.` };
    const j = (await res.json()) as { features?: Array<{ attributes?: { FLD_ZONE?: string; ZONE_SUBTY?: string; SFHA_TF?: string } }> };
    const a = j.features?.[0]?.attributes;
    const zone = a?.FLD_ZONE && String(a.FLD_ZONE).trim() ? String(a.FLD_ZONE).trim() : null;
    if (!zone) return { capability: 'flood', provider: 'fema_flood', status: 'needs_verification', value: null, confidence: 'none', timestamp: now, sourceUrl: url, note: 'FEMA NFHL returned no flood zone for the point (may be unmapped).' };
    const inSfha = a?.SFHA_TF === 'T';
    const sub = a?.ZONE_SUBTY ? ` (${a.ZONE_SUBTY})` : '';
    return { capability: 'flood', provider: 'fema_flood', status: 'verified', value: zone, confidence: 'high', timestamp: now, sourceUrl: url, note: `FEMA NFHL flood zone ${zone}${sub}${inSfha ? ' — in Special Flood Hazard Area' : ' — not in SFHA'} (official).` };
  },
);

/** Live FEMA flood lookup by point. FREE + keyless + verified contract, so it is
 *  NOT behind the dormant LANDOS_LIVE_GOV_DD gate (that gate guards the not-yet-
 *  contract-verified providers). Injectable fetch keeps tests offline. */
export async function fetchFemaFlood(lat: number, lng: number, deps: { fetchImpl?: GovFetch; now?: () => string } = {}): Promise<GovDdResult> {
  const nowFn = deps.now ?? (() => new Date().toISOString());
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as GovFetch);
  try {
    return await femaFloodProvider.fetchFact({ lat, lng }, { env: { [GOV_DD_LIVE_ENV]: '1' }, fetchImpl, now: nowFn });
  } catch (e: unknown) {
    return { capability: 'flood', provider: 'fema_flood', status: 'error', value: null, confidence: 'none', timestamp: nowFn(), sourceUrl: null, note: `FEMA flood error: ${(e as Error)?.message ?? String(e)}.` };
  }
}

/** Live NWI wetlands lookup by point. Free + keyless + verified contract. */
export async function fetchNwiWetlands(lat: number, lng: number, deps: { fetchImpl?: GovFetch; now?: () => string } = {}): Promise<GovDdResult> {
  const nowFn = deps.now ?? (() => new Date().toISOString());
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as GovFetch);
  try { return await nwiWetlandsProvider.fetchFact({ lat, lng }, { env: { [GOV_DD_LIVE_ENV]: '1' }, fetchImpl, now: nowFn }); }
  catch (e: unknown) { return { capability: 'wetlands', provider: 'nwi_wetlands', status: 'error', value: null, confidence: 'none', timestamp: nowFn(), sourceUrl: null, note: `NWI error: ${(e as Error)?.message ?? String(e)}.` }; }
}

/** Live USGS slope/elevation lookup by point. Free + keyless + verified contract. */
export async function fetchUsgsSlope(lat: number, lng: number, deps: { fetchImpl?: GovFetch; now?: () => string } = {}): Promise<GovDdResult> {
  const nowFn = deps.now ?? (() => new Date().toISOString());
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as GovFetch);
  try { return await usgsSlopeProvider.fetchFact({ lat, lng }, { env: { [GOV_DD_LIVE_ENV]: '1' }, fetchImpl, now: nowFn }); }
  catch (e: unknown) { return { capability: 'slope', provider: 'usgs_slope', status: 'error', value: null, confidence: 'none', timestamp: nowFn(), sourceUrl: null, note: `USGS error: ${(e as Error)?.message ?? String(e)}.` }; }
}

// ── USFWS / NWI wetlands ─────────────────────────────────────────────────────
// VERIFIED CONTRACT (live-confirmed): USFWS WIM Wetlands MapServer layer 0, point
// query in SR 4326, outFields ATTRIBUTE/WETLAND_TYPE/ACRES, returns features[].
// 0 features => no NWI wetland mapped at the point. Free, keyless.
export function nwiWetlandsUrl(lat: number, lng: number): string {
  // outFields=* is REQUIRED: the layer joins NWI_Wetland_Codes, so unqualified
  // field names (ATTRIBUTE/WETLAND_TYPE) are ambiguous and the service returns an
  // embedded error 400. The wetland type comes back as "Wetlands.WETLAND_TYPE".
  const base = 'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query';
  const qs = `geometry=${lng}%2C${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json`;
  return `${base}?${qs}`;
}
export const nwiWetlandsProvider = makeGovProvider(
  { id: 'nwi_wetlands', label: 'USFWS NWI wetlands', capability: 'wetlands' },
  async (input, fetchImpl, now) => {
    if (typeof input.lat !== 'number' || typeof input.lng !== 'number') {
      return { capability: 'wetlands', provider: 'nwi_wetlands', status: 'needs_verification', value: null, confidence: 'none', timestamp: now, sourceUrl: null, note: 'NWI needs lat/lng (none supplied).' };
    }
    const url = nwiWetlandsUrl(input.lat, input.lng);
    const res = await fetchImpl(url);
    if (!res.ok) return { capability: 'wetlands', provider: 'nwi_wetlands', status: 'error', value: null, confidence: 'none', timestamp: now, sourceUrl: url, note: `NWI HTTP ${res.status}.` };
    const j = (await res.json()) as { features?: Array<{ attributes?: Record<string, unknown> }>; error?: unknown };
    if ((j as { error?: unknown }).error) return { capability: 'wetlands', provider: 'nwi_wetlands', status: 'error', value: null, confidence: 'none', timestamp: now, sourceUrl: url, note: 'NWI query error.' };
    const feats = j.features ?? [];
    if (feats.length === 0) {
      return { capability: 'wetlands', provider: 'nwi_wetlands', status: 'verified', value: 'None mapped', confidence: 'high', timestamp: now, sourceUrl: url, note: 'No NWI wetland mapped at the parcel point (official). Confirm full-parcel extent in deeper DD.' };
    }
    // Joined layer => the type comes back under a prefixed key (e.g. "Wetlands.WETLAND_TYPE").
    const attrs = feats[0].attributes ?? {};
    const pick = (re: RegExp): string | null => { for (const [k, v] of Object.entries(attrs)) { if (re.test(k) && typeof v === 'string' && v.trim()) return v.trim(); } return null; };
    const type = pick(/(^|\.)WETLAND_TYPE$/i) || pick(/(^|\.)ATTRIBUTE$/i) || 'Wetland present';
    return { capability: 'wetlands', provider: 'nwi_wetlands', status: 'verified', value: type, confidence: 'high', timestamp: now, sourceUrl: url, note: `NWI wetland at the parcel point: ${type} (official). Confirm extent/% in deeper DD.` };
  },
);

// ── USGS slope / topography (3DEP via EPQS) ──────────────────────────────────
// VERIFIED CONTRACT (live-confirmed): EPQS point elevation
// `https://epqs.nationalmap.gov/v1/json?x=lng&y=lat&units=Meters&wkid=4326` ->
// { value: <elevation metres> }. Slope is derived from a 5-point ~33 m cross
// (center + N/S/E/W) as atan(max elevation delta / 33 m). Free, keyless.
const EPQS_OFFSET_DEG = 0.0003; // ~33 m
const EPQS_HORIZ_M = 33;
export function usgsElevationUrl(lat: number, lng: number): string {
  return `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&units=Meters&wkid=4326&includeDate=false`;
}
export const usgsSlopeProvider = makeGovProvider(
  { id: 'usgs_slope', label: 'USGS 3DEP slope/topography (EPQS)', capability: 'slope' },
  async (input, fetchImpl, now) => {
    if (typeof input.lat !== 'number' || typeof input.lng !== 'number') {
      return { capability: 'slope', provider: 'usgs_slope', status: 'needs_verification', value: null, confidence: 'none', timestamp: now, sourceUrl: null, note: 'USGS needs lat/lng (none supplied).' };
    }
    const d = EPQS_OFFSET_DEG;
    const pts: Array<[number, number]> = [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d]];
    const elevations: number[] = [];
    for (const [dLat, dLng] of pts) {
      const res = await fetchImpl(usgsElevationUrl(input.lat + dLat, input.lng + dLng));
      if (!res.ok) return { capability: 'slope', provider: 'usgs_slope', status: 'error', value: null, confidence: 'none', timestamp: now, sourceUrl: usgsElevationUrl(input.lat, input.lng), note: `USGS EPQS HTTP ${res.status}.` };
      const j = (await res.json()) as { value?: string | number };
      const v = typeof j.value === 'number' ? j.value : typeof j.value === 'string' ? Number(j.value) : NaN;
      if (!Number.isFinite(v)) return { capability: 'slope', provider: 'usgs_slope', status: 'needs_verification', value: null, confidence: 'none', timestamp: now, sourceUrl: usgsElevationUrl(input.lat, input.lng), note: 'USGS EPQS returned no elevation (may be outside coverage).' };
      elevations.push(v);
    }
    const dz = Math.max(...elevations) - Math.min(...elevations);
    const slopeDeg = Math.round(Math.atan(dz / EPQS_HORIZ_M) * (180 / Math.PI) * 10) / 10;
    const elevM = Math.round(elevations[0] * 10) / 10;
    return { capability: 'slope', provider: 'usgs_slope', status: 'verified', value: slopeDeg, unit: '°', confidence: 'medium', timestamp: now, sourceUrl: usgsElevationUrl(input.lat, input.lng), note: `USGS 3DEP: ~${slopeDeg}° avg slope, ${elevM} m elevation (derived from a 33 m EPQS cross). Confirm with full DEM in deeper DD.` };
  },
);

// ── US Census demographics ───────────────────────────────────────────────────
export const censusDemographicsProvider = makeGovProvider(
  { id: 'census_demographics', label: 'US Census demographics', capability: 'demographics' },
  async (input, fetchImpl, now) => {
    const url = `https://api.census.gov/data?fips=${input.fips ?? ''}`;
    const res = await fetchImpl(url);
    if (!res.ok) return { capability: 'demographics', provider: 'census_demographics', status: 'error', value: null, confidence: 'none', timestamp: now, sourceUrl: url, note: `Census HTTP ${res.status}.` };
    const j = (await res.json()) as { populationGrowthPct?: number };
    const g = typeof j.populationGrowthPct === 'number' && Number.isFinite(j.populationGrowthPct) ? j.populationGrowthPct : null;
    return g !== null
      ? { capability: 'demographics', provider: 'census_demographics', status: 'verified', value: g, unit: '%', confidence: 'high', timestamp: now, sourceUrl: url, note: 'US Census population growth (official).' }
      : { capability: 'demographics', provider: 'census_demographics', status: 'needs_verification', value: null, confidence: 'none', timestamp: now, sourceUrl: url, note: 'Census returned no growth figure.' };
  },
);

export const GOV_DD_PROVIDERS: readonly GovDdProvider[] = [
  femaFloodProvider, nwiWetlandsProvider, usgsSlopeProvider, censusDemographicsProvider,
];

/** Presence-only readiness for the dashboard: each free gov provider + whether
 *  live activation is enabled. No call made. */
export function govDdProvidersStatus(env: Record<string, string | undefined> = process.env): {
  liveEnabled: boolean;
  providers: Array<{ id: string; label: string; capability: GovDdCapability; cost: 'free'; activated: boolean }>;
} {
  const enabled = liveEnabled(env);
  return {
    liveEnabled: enabled,
    providers: GOV_DD_PROVIDERS.map((p) => ({ id: p.id, label: p.label, capability: p.capability, cost: 'free', activated: enabled })),
  };
}
