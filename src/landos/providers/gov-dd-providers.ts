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
export const femaFloodProvider = makeGovProvider(
  { id: 'fema_flood', label: 'FEMA flood (NFHL)', capability: 'flood' },
  async (input, fetchImpl, now) => {
    // Future live path (NFHL identify by point). Parses a flood-zone string.
    const url = `https://hazards.fema.gov/nfhl?lat=${input.lat ?? ''}&lng=${input.lng ?? ''}`;
    const res = await fetchImpl(url);
    if (!res.ok) return { capability: 'flood', provider: 'fema_flood', status: 'error', value: null, confidence: 'none', timestamp: now, sourceUrl: url, note: `FEMA HTTP ${res.status}.` };
    const j = (await res.json()) as { floodZone?: string };
    const zone = typeof j.floodZone === 'string' && j.floodZone.trim() ? j.floodZone.trim() : null;
    return zone
      ? { capability: 'flood', provider: 'fema_flood', status: 'verified', value: zone, confidence: 'high', timestamp: now, sourceUrl: url, note: 'FEMA NFHL flood zone (official).' }
      : { capability: 'flood', provider: 'fema_flood', status: 'needs_verification', value: null, confidence: 'none', timestamp: now, sourceUrl: url, note: 'FEMA returned no flood zone for the point.' };
  },
);

// ── USFWS / NWI wetlands ─────────────────────────────────────────────────────
export const nwiWetlandsProvider = makeGovProvider(
  { id: 'nwi_wetlands', label: 'USFWS NWI wetlands', capability: 'wetlands' },
  async (input, fetchImpl, now) => {
    const url = `https://www.fws.gov/wetlands/arcgis?lat=${input.lat ?? ''}&lng=${input.lng ?? ''}`;
    const res = await fetchImpl(url);
    if (!res.ok) return { capability: 'wetlands', provider: 'nwi_wetlands', status: 'error', value: null, confidence: 'none', timestamp: now, sourceUrl: url, note: `NWI HTTP ${res.status}.` };
    const j = (await res.json()) as { wetlandsPct?: number };
    const pct = typeof j.wetlandsPct === 'number' && Number.isFinite(j.wetlandsPct) ? j.wetlandsPct : null;
    return pct !== null
      ? { capability: 'wetlands', provider: 'nwi_wetlands', status: 'verified', value: pct, unit: '%', confidence: 'high', timestamp: now, sourceUrl: url, note: 'USFWS NWI wetlands coverage (official).' }
      : { capability: 'wetlands', provider: 'nwi_wetlands', status: 'needs_verification', value: null, confidence: 'none', timestamp: now, sourceUrl: url, note: 'NWI returned no wetlands coverage.' };
  },
);

// ── USGS 3DEP slope ──────────────────────────────────────────────────────────
export const usgsSlopeProvider = makeGovProvider(
  { id: 'usgs_slope', label: 'USGS 3DEP slope', capability: 'slope' },
  async (input, fetchImpl, now) => {
    const url = `https://elevation.nationalmap.gov/arcgis?lat=${input.lat ?? ''}&lng=${input.lng ?? ''}`;
    const res = await fetchImpl(url);
    if (!res.ok) return { capability: 'slope', provider: 'usgs_slope', status: 'error', value: null, confidence: 'none', timestamp: now, sourceUrl: url, note: `USGS HTTP ${res.status}.` };
    const j = (await res.json()) as { slopeAvgDeg?: number };
    const deg = typeof j.slopeAvgDeg === 'number' && Number.isFinite(j.slopeAvgDeg) ? j.slopeAvgDeg : null;
    return deg !== null
      ? { capability: 'slope', provider: 'usgs_slope', status: 'verified', value: deg, unit: '°', confidence: 'medium', timestamp: now, sourceUrl: url, note: 'USGS 3DEP average slope (derived from elevation).' }
      : { capability: 'slope', provider: 'usgs_slope', status: 'needs_verification', value: null, confidence: 'none', timestamp: now, sourceUrl: url, note: 'USGS returned no slope.' };
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
