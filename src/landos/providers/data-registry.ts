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
import { validateLocality } from './locality-validation.js';

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
  zip?: string | null;
  owner?: string | null;
  acres?: number | null;
  // ── Extended canonical fields (additive/optional; populated when a provider
  //    supplies them). Never required; older providers simply omit them. ──
  zoning?: string | null;
  /** State FIPS (2-digit) when a provider supplies it. */
  fipsState?: string | null;
  /** County FIPS (3-digit) when a provider supplies it. Canonical `fips` is the
   *  5-digit fipsState+fipsCounty concatenation; this preserves the part. */
  fipsCounty?: string | null;
  landArea?: number | null;
  legalDesc?: string | null;
  subdivision?: string | null;
  // ── Provenance (preserved for every fact) ──
  /** ISO timestamp the record was produced. */
  timestamp?: string;
  /** Confidence in the match. Exact official-id matches are 'high'. */
  confidence?: 'high' | 'medium' | 'low' | 'none';
  /** What we searched by (e.g. 'parcelId', 'address'). */
  searchedIdentifier?: string;
  /** What the record matched on (e.g. the returned parcelId). */
  matchedIdentifier?: string | null;
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

// ── Realie.ai parcel adapter — matches the VERIFIED official API contract ─────
//
// Contract (docs.realie.ai, confirmed 2026-06):
//   Base URL : https://app.realie.ai/api
//   Address  : GET /public/property/address/   required: state, address
//              (address = street line 1 only) optional: county, city, unitNumberStripped
//   Parcel   : GET /public/property/parcelId/  required: state, county, parcelId
//   Auth     : header  Authorization: <API_KEY>   (raw key — NOT Bearer)
//   Response : { property: { parcelId, fipsCounty, ownerName, addressFull, city,
//                state, zipCode, acres, zoningCode, county, fipsState, landArea,
//                legalDesc, subdivision, ... } }
//
// Location/lat-long/nearest/map-pin endpoints are NEVER used for subject identity.

export const REALIE_ENV_KEY = 'REALIE_API_KEY';
/** Optional base override; defaults to the verified official base. */
export const REALIE_BASE_ENV_KEY = 'REALIE_API_BASE';
export const REALIE_DEFAULT_BASE = 'https://app.realie.ai/api';
export const REALIE_ADDRESS_PATH = '/public/property/address/';
export const REALIE_PARCEL_PATH = '/public/property/parcelId/';

/** Minimal fetch surface so tests inject a fake and no live/paid call is made. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface RealieParcelDeps {
  /** Injected in tests; default is the global fetch — only ever CALLED when the
   *  adapter is configured (a key is present) AND sufficient exact identifiers
   *  are provided, so tests stay offline by default and no credit is spent. */
  fetchImpl?: FetchLike;
  /** Env used for key/base resolution. Default process.env. Presence only. */
  env?: Record<string, string | undefined>;
  /** ISO clock for provenance timestamps (tests inject a fixed value). */
  now?: () => string;
  /** County derivation (root-cause fix): when an address lookup has no county,
   *  derive it so Realie can be locality-constrained (city+county). Injected;
   *  default undefined = no derivation (preserves offline tests). The capability
   *  wires the live Census geocoder. */
  deriveCounty?: (input: { address?: string; city?: string; state?: string; zip?: string }) => Promise<{ county: string; state: string; zip: string | null; fips: string | null } | null>;
}

/** Normalize a Realie `property` object into the canonical NormalizedParcel.
 *  Reads ONLY the documented field names under `property`. An empty/garbled
 *  payload is reported unverified (never fabricated). */
function normalizeRealieProperty(
  body: unknown,
  ctx: { searchedIdentifier: string; matchedBy: 'parcelId' | 'address'; timestamp: string },
): NormalizedParcel {
  const root = (body ?? {}) as Record<string, unknown>;
  const p = (root.property ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const parcelId = str(p.parcelId);
  // Canonical FIPS is the 5-digit fipsState(2)+fipsCounty(3) concatenation. Realie
  // returns fipsCounty as the 3-digit COUNTY code (e.g. '321'), NOT the full FIPS.
  // Only form the 5-digit code when BOTH parts are present; otherwise leave the
  // canonical fips undefined and keep fipsCounty alone (never pretend it's full).
  const fipsState = str(p.fipsState);
  const fipsCounty = str(p.fipsCounty);
  const fipsFull = fipsState && fipsCounty ? `${fipsState.padStart(2, '0')}${fipsCounty.padStart(3, '0')}` : null;
  const matched = !!(parcelId || str(p.addressFull) || str(p.ownerName));
  if (!matched) {
    return {
      verified: false, source: 'Realie.ai', status: 'no_match',
      timestamp: ctx.timestamp, confidence: 'none', searchedIdentifier: ctx.searchedIdentifier, matchedIdentifier: null,
      note: 'Realie.ai returned no property; no parcel fabricated.',
    };
  }
  return {
    // Realie is an exact, official-record lookup (by parcelId or address) with NO
    // proximity/nearest. A returned property is an authoritative exact match, so
    // subject identity is Verified — never derived from coordinates.
    verified: true,
    source: 'Realie.ai',
    status: 'verified',
    apn: parcelId,
    fips: fipsFull, // canonical 5-digit (state+county), or null when not derivable
    propertyId: parcelId,
    situsAddress: str(p.addressFull),
    city: str(p.city),
    county: str(p.county),
    state: str(p.state),
    zip: str(p.zipCode),
    owner: str(p.ownerName),
    acres: num(p.acres),
    zoning: str(p.zoningCode),
    fipsState,
    fipsCounty,
    landArea: num(p.landArea),
    legalDesc: str(p.legalDesc),
    subdivision: str(p.subdivision),
    timestamp: ctx.timestamp,
    confidence: 'high',
    searchedIdentifier: ctx.searchedIdentifier,
    matchedIdentifier: parcelId,
    note: `Realie.ai exact ${ctx.matchedBy} match (official property record).`,
  };
}

function unverified(status: string, note: string, now: string, searchedIdentifier: string): NormalizedParcel {
  return { verified: false, source: 'Realie.ai', status, timestamp: now, confidence: 'none', searchedIdentifier, matchedIdentifier: null, note };
}

export function makeRealieParcelAdapter(deps: RealieParcelDeps = {}): ParcelProvider {
  return {
    id: 'realie',
    label: 'Realie.ai (official property/parcel records)',
    configured(env = deps.env ?? process.env) {
      const v = env[REALIE_ENV_KEY];
      return typeof v === 'string' && v.trim().length > 0; // presence only
    },
    async lookup(args): Promise<NormalizedParcel> {
      const env = deps.env ?? process.env;
      const now = (deps.now ?? (() => new Date().toISOString()))();
      const key = (env[REALIE_ENV_KEY] ?? '').trim();
      if (!key) {
        // Not configured: make NO call, never fabricate a parcel.
        return unverified('not_configured', 'Realie.ai not configured (no REALIE_API_KEY). No live call made.', now, '');
      }

      const base = (env[REALIE_BASE_ENV_KEY] || REALIE_DEFAULT_BASE).trim().replace(/\/+$/, '');
      const state = (args.state ?? '').trim();
      let county = (args.county ?? '').trim();
      const addrLine1ForCounty = (args.address ?? '').split(',')[0].trim();
      // ROOT-CAUSE FIX (A): Realie's address endpoint only constrains by city when
      // county is also supplied (and ignores ZIP). When a fresh lead has an
      // address but no county, derive the county so the lookup is locality-scoped
      // instead of a statewide street-name match. Derivation is a supporting
      // record search; identity still comes from Realie + locality validation.
      let derivedZip: string | null = null;
      if (!county && state && addrLine1ForCounty && deps.deriveCounty) {
        const d = await deps.deriveCounty({ address: addrLine1ForCounty, city: args.city, state, zip: args.zip }).catch(() => null);
        if (d?.county) { county = d.county.trim(); derivedZip = d.zip; }
      }
      // ParcelLookupArgs.apn carries the parcel id for Realie's parcelId endpoint.
      const parcelId = (args.apn ?? args.propertyId ?? '').trim();
      // Realie's address endpoint wants STREET LINE 1 ONLY. Real leads often arrive
      // as a full address string ("472 West Rd, Poulan, GA 31781"); take the part
      // before the first comma so the exact lookup isn't broadened/failed. This is
      // pure string normalization — never geocoding or proximity.
      const addressLine1 = (args.address ?? '').split(',')[0].trim();

      // Choose the endpoint from the EXACT identifiers present. No coordinates,
      // no location/nearest endpoint is ever used to identify the subject parcel.
      let path: string;
      let params: URLSearchParams;
      let searchedIdentifier: string;
      let matchedBy: 'parcelId' | 'address';
      if (state && county && parcelId) {
        path = REALIE_PARCEL_PATH;
        params = new URLSearchParams({ state, county, parcelId });
        searchedIdentifier = `parcelId:${parcelId} (${county}, ${state})`;
        matchedBy = 'parcelId';
      } else if (state && addressLine1) {
        path = REALIE_ADDRESS_PATH;
        params = new URLSearchParams({ state, address: addressLine1 }); // street line 1 only
        if (county) params.set('county', county);
        if (args.city && county) params.set('city', args.city.trim()); // city requires county
        searchedIdentifier = `address:${addressLine1} (${state})`;
        matchedBy = 'address';
      } else {
        // Not enough exact identifiers to run an official lookup — never guess,
        // never use proximity. Caller treats this as Needs Verification.
        return unverified(
          'insufficient_identifiers',
          'Realie.ai needs state+county+parcelId (parcel lookup) or state+address (address lookup). No call made; coordinates are never used to identify a parcel.',
          now,
          '',
        );
      }

      const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
      try {
        const res = await fetchImpl(`${base}${path}?${params.toString()}`, {
          method: 'GET',
          headers: { authorization: key, accept: 'application/json' }, // raw key, NOT Bearer
        });
        if (res.status === 404) return unverified('no_match', 'Realie.ai: no property found for the exact identifier.', now, searchedIdentifier);
        if (res.status === 401) return unverified('error_401', 'Realie.ai: unauthorized (key missing/invalid).', now, searchedIdentifier);
        if (res.status === 403) return unverified('error_403', 'Realie.ai: usage limit exceeded (403).', now, searchedIdentifier);
        if (res.status === 429) return unverified('error_429', 'Realie.ai: rate limited (429).', now, searchedIdentifier);
        if (!res.ok) return unverified(`error_${res.status}`, `Realie.ai lookup failed (HTTP ${res.status}). No parcel fabricated.`, now, searchedIdentifier);
        const n = normalizeRealieProperty(await res.json(), { searchedIdentifier, matchedBy, timestamp: now });
        // ROOT-CAUSE FIX (B): never trust a returned parcel whose locality differs
        // from the searched locality (Realie's statewide street-name match can
        // return the wrong place). Validate state/zip/county; downgrade on conflict.
        if (n.verified && matchedBy === 'address') {
          const check = validateLocality(
            { city: args.city, county: county || args.county, state, zip: args.zip ?? derivedZip },
            { city: n.city, county: n.county, state: n.state, zip: n.zip },
          );
          if (!check.ok) {
            return {
              ...n, verified: false, status: 'locality_mismatch', confidence: 'none',
              note: `Realie returned a parcel in a DIFFERENT locality than searched. ${check.note} Searched ${searchedIdentifier}; returned "${n.situsAddress ?? 'n/a'}" (${n.city ?? '?'}, ${n.county ?? '?'} ${n.state ?? '?'} ${n.zip ?? ''}). Needs Verification — NOT marked Verified.`,
            };
          }
          return { ...n, confidence: check.confidence, note: `${n.note} Locality check (${check.confidence}): ${check.note}` };
        }
        return n;
      } catch (e: unknown) {
        return unverified('error', `Realie.ai lookup error: ${(e as Error)?.message ?? String(e)}. No parcel fabricated.`, now, searchedIdentifier);
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
