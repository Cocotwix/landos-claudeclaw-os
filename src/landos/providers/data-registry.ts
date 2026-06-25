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

// ── Realie.ai parcel adapter (STUB behind the same interface) ─────────────────

export const REALIE_ENV_KEY = 'REALIE_API_KEY';

export function makeRealieParcelAdapter(): ParcelProvider {
  return {
    id: 'realie',
    label: 'Realie.ai (parcel data)',
    configured(env = process.env) {
      const v = env[REALIE_ENV_KEY];
      return typeof v === 'string' && v.trim().length > 0; // presence only
    },
    async lookup(): Promise<NormalizedParcel> {
      // Scaffold: no live/paid call. When REALIE_API_KEY exists, this adapter will
      // call Realie's REST API and normalize to NormalizedParcel. Until then it
      // fails loud (never fabricates a parcel).
      return {
        verified: false,
        source: 'Realie.ai',
        status: 'not_configured',
        note: 'Realie.ai adapter is scaffolded but not configured (no REALIE_API_KEY). No live call made; no parcel fabricated.',
      };
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
