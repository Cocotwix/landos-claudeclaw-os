// LandOS data-provider abstraction layer.
//
// Every external DATA source connects through a standardized adapter that
// normalizes to one internal schema. Swapping a provider (e.g. LandPortal ->
// Realie.ai for parcel data) is a config + adapter change — no agent, workflow,
// or report change. This module scaffolds the registry and the parcel domain:
// the existing LandPortal integration is WRAPPED (not hard-coded), and a Realie.ai
// adapter stub sits behind the same interface, selectable by config. Stubs make
// NO live/paid calls; the LandPortal adapter only calls out when actually invoked
// (its resolver is injected so tests run with no network).

import type { LpResolveArgs, LpResolveResult } from '../landportal-client.js';

export type DataDomain = 'parcel' | 'comps' | 'crm' | 'market';

/** One internal, provider-agnostic parcel record. Coordinates are intentionally
 *  excluded from identity (kept only as optional search-area context elsewhere). */
export interface NormalizedParcel {
  verified: boolean;
  source: string;
  status: string;
  apn?: string | null;
  fips?: string | null;
  propertyId?: string | null;
  situsAddress?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  owner?: string | null;
  acres?: number | null;
  note: string;
}

export interface ParcelLookupArgs {
  address?: string; city?: string; state?: string; zip?: string;
  apn?: string; county?: string; fips?: string; owner?: string; propertyId?: string;
}

export interface ParcelProvider {
  readonly id: string;
  readonly label: string;
  /** True when credentials/config are present to actually run. Presence-only —
   *  never reads or exposes the secret value itself. */
  configured(env?: Record<string, string | undefined>): boolean;
  lookup(args: ParcelLookupArgs, opts: { timeoutMs: number }): Promise<NormalizedParcel>;
}

// ── LandPortal parcel adapter (wraps the existing resolver) ───────────────────

export interface LandPortalParcelDeps {
  /** Injected so tests need no live call; default wires the real resolver. */
  resolve?: (args: LpResolveArgs, timeoutMs: number) => Promise<LpResolveResult>;
}

export function makeLandPortalParcelAdapter(deps: LandPortalParcelDeps = {}): ParcelProvider {
  return {
    id: 'landportal',
    label: 'LandPortal v2 (exact, non-credit)',
    configured() { return true; }, // already wired in LandOS
    async lookup(args, opts): Promise<NormalizedParcel> {
      const resolve = deps.resolve ?? (await import('../landportal-client.js')).lpResolveForPreflight;
      const r = await resolve(
        { address: args.address, city: args.city, state: args.state, zip: args.zip, apn: args.apn, county: args.county, fips: args.fips, owner: args.owner, propertyid: args.propertyId },
        opts.timeoutMs,
      );
      const ps = r.property_summary;
      return {
        verified: r.verified,
        source: 'LandPortal v2',
        status: r.status,
        apn: r.apn,
        fips: r.fips,
        propertyId: r.propertyid,
        situsAddress: r.situs_address ?? null,
        city: r.city ?? null,
        county: ps ? (ps.county ?? null) : null,
        state: r.state ?? null,
        owner: r.owner ?? null,
        acres: ps && ps.lot_size_acres ? Number(ps.lot_size_acres) || null : null,
        note: r.match_notes,
      };
    },
  };
}

// ── Realie.ai parcel adapter (live-ready behind the same interface) ───────────

export const REALIE_ENV_KEY = 'REALIE_API_KEY';
/** Optional override; defaults to Realie's public parcel endpoint base. */
export const REALIE_BASE_ENV_KEY = 'REALIE_API_BASE';
const REALIE_DEFAULT_BASE = 'https://api.realie.ai/v1';

/** Minimal fetch surface so tests inject a fake and no live/paid call is made. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface RealieParcelDeps {
  /** Injected in tests; default is the global fetch — only ever CALLED when the
   *  adapter is configured (a key is present), so tests stay offline by default. */
  fetchImpl?: FetchLike;
  /** Env used for key/base resolution. Default process.env. Presence only. */
  env?: Record<string, string | undefined>;
}

/** Normalize a Realie parcel payload into NormalizedParcel. Conservative: an
 *  unrecognized/empty shape is reported unverified (never fabricated). */
function normalizeRealie(raw: unknown): NormalizedParcel {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const apn = str(r.apn) ?? str(r.parcel_number);
  const matched = !!(apn || str(r.property_id) || str(r.situs_address));
  return {
    verified: false, // external data source is needs-verification context, never auto-verified
    source: 'Realie.ai',
    status: matched ? 'matched_needs_verification' : 'no_match',
    apn,
    fips: str(r.fips) ?? str(r.county_fips),
    propertyId: str(r.property_id) ?? str(r.id),
    situsAddress: str(r.situs_address) ?? str(r.address),
    city: str(r.city),
    county: str(r.county),
    state: str(r.state),
    owner: str(r.owner) ?? str(r.owner_name),
    acres: num(r.acres) ?? num(r.lot_size_acres),
    note: matched
      ? 'Realie.ai returned a parcel match. Labeled needs_verification (external source is context, not parcel verification).'
      : 'Realie.ai returned no exact parcel match; no parcel fabricated.',
  };
}

export function makeRealieParcelAdapter(deps: RealieParcelDeps = {}): ParcelProvider {
  return {
    id: 'realie',
    label: 'Realie.ai (parcel data)',
    configured(env = deps.env ?? process.env) {
      const v = env[REALIE_ENV_KEY];
      return typeof v === 'string' && v.trim().length > 0; // presence only
    },
    async lookup(args): Promise<NormalizedParcel> {
      const env = deps.env ?? process.env;
      const key = (env[REALIE_ENV_KEY] ?? '').trim();
      if (!key) {
        // Not configured: fail loud, make NO call, never fabricate a parcel.
        return {
          verified: false,
          source: 'Realie.ai',
          status: 'not_configured',
          note: 'Realie.ai adapter is wired but not configured (no REALIE_API_KEY). No live call made; no parcel fabricated.',
        };
      }
      // Configured: live-ready REST lookup (injected fetch in tests; never paid in tests).
      const base = (env[REALIE_BASE_ENV_KEY] ?? REALIE_DEFAULT_BASE).trim().replace(/\/+$/, '');
      const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
      const params = new URLSearchParams();
      if (args.address) params.set('address', args.address);
      if (args.city) params.set('city', args.city);
      if (args.state) params.set('state', args.state);
      if (args.zip) params.set('zip', args.zip);
      if (args.apn) params.set('apn', args.apn);
      if (args.county) params.set('county', args.county);
      if (args.fips) params.set('fips', args.fips);
      if (args.owner) params.set('owner', args.owner);
      if (args.propertyId) params.set('property_id', args.propertyId);
      try {
        const res = await fetchImpl(`${base}/parcels/lookup?${params.toString()}`, {
          method: 'GET',
          headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
        });
        if (!res.ok) {
          return {
            verified: false,
            source: 'Realie.ai',
            status: `error_${res.status}`,
            note: `Realie.ai lookup failed (HTTP ${res.status}). No parcel fabricated.`,
          };
        }
        return normalizeRealie(await res.json());
      } catch (e: unknown) {
        return {
          verified: false,
          source: 'Realie.ai',
          status: 'error',
          note: `Realie.ai lookup error: ${(e as Error)?.message ?? String(e)}. No parcel fabricated.`,
        };
      }
    },
  };
}

// ── Registry ──────────────────────────────────────────────────────────────────

export interface DataSourcesConfig {
  parcel: 'landportal' | 'realie';
  // comps/crm/market are registered domains; their providers are wired in later
  // passes. Recorded here so selection is config-driven from day one.
  comps?: string;
  crm?: string;
  market?: string;
}

export const DEFAULT_DATA_SOURCES: DataSourcesConfig = {
  parcel: 'landportal',
  comps: 'apify_redfin',
  crm: 'none',
  market: 'apify_census',
};

export interface DataRegistryDeps {
  landPortal?: LandPortalParcelDeps;
}

/**
 * The data-provider registry. Selects the active provider per domain from config
 * and returns the wrapped adapter. The current LandPortal integration is wrapped
 * (not hard-coded) so it can be swapped for Realie.ai (or any future provider) via
 * config + a new adapter, with zero agent/workflow change.
 */
export class DataProviderRegistry {
  private config: DataSourcesConfig;
  private parcelAdapters: Map<string, ParcelProvider>;
  constructor(config: DataSourcesConfig = DEFAULT_DATA_SOURCES, deps: DataRegistryDeps = {}) {
    this.config = config;
    this.parcelAdapters = new Map<string, ParcelProvider>([
      ['landportal', makeLandPortalParcelAdapter(deps.landPortal)],
      ['realie', makeRealieParcelAdapter()],
    ]);
  }
  /** The active parcel provider per config (default LandPortal). */
  parcel(): ParcelProvider {
    const p = this.parcelAdapters.get(this.config.parcel);
    if (!p) throw new Error(`no parcel adapter registered for "${this.config.parcel}"`);
    return p;
  }
  /** All registered parcel providers (for diagnostics/dashboard). */
  parcelProviders(): ParcelProvider[] {
    return [...this.parcelAdapters.values()];
  }
  activeConfig(): DataSourcesConfig {
    return { ...this.config };
  }
}
