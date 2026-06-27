// LandOS — Parcel Identity CAPABILITY router.
//
// The business workflow (Due Diligence) requests the CAPABILITY "verify parcel
// identity"; it never names a vendor. This router selects a provider by config
// (intended primary: Realie.ai once REALIE_API_KEY is present), falls back only
// to other CONFIGURED providers (LandPortal as legacy fallback; County Records
// Browser Agent as a future official-record provider), and NEVER silently
// substitutes — the chosen provider + fallback reason are reported as provenance.
//
// Output is the canonical LpResolveResult the DD path already consumes (kept as
// the transitional canonical for parcel identity), plus a ParcelProvenance
// record. No provider-specific field names leak to callers beyond this canonical.
//
// Hard rules honored: exact identifiers only (no coordinates/geocoding/proximity
// ever forwarded for identity); missing key => provider unavailable; if no
// provider can verify => Needs Verification (never fabricate). No paid call is
// made here unless the selected provider actually runs (and Realie/County are
// gated by configuration/approval).

import { logger } from '../logger.js';
import { readEnvFile } from '../env.js';
import {
  lpResolveForPreflight,
  landPortalConfigured,
  type LpResolveArgs,
  type LpResolveResult,
} from './landportal-client.js';
import {
  makeRealieParcelAdapter,
  type ParcelLookupArgs,
  type NormalizedParcel,
} from './providers/data-registry.js';
import { makeCountyRecordsBrowserPlaceholder } from './browser-agents.js';

// Re-export the canonical types so business code imports them from the CAPABILITY,
// never from the vendor client.
export type { LpResolveArgs, LpResolveResult } from './landportal-client.js';

export const PARCEL_PROVIDER_ENV = 'LANDOS_PARCEL_PROVIDER';
export type ParcelProviderId = 'realie' | 'landportal' | 'county_records_browser';

/** Intended production primary. Realie sits behind this abstraction; it becomes
 *  active automatically once REALIE_API_KEY is present. */
export const DEFAULT_PRIMARY_PARCEL_PROVIDER: ParcelProviderId = 'realie';
/** Fallback order after the active provider (legacy LandPortal, then the future
 *  official-record County Records Browser). */
export const DEFAULT_PARCEL_FALLBACK_ORDER: ParcelProviderId[] = ['landportal', 'county_records_browser'];

export interface ParcelProvenance {
  provider: ParcelProviderId | 'none';
  /** True when the active/primary provider was unavailable and another was used. */
  fellBack: boolean;
  /** Providers tried/skipped, in order, with why (never a secret value). */
  attempted: Array<{ provider: ParcelProviderId; outcome: 'used' | 'unavailable' | 'error' }>;
  reason: string;
  sourceTimestamp: string;
}

export interface ParcelIdentityOutcome {
  result: LpResolveResult;
  provenance: ParcelProvenance;
}

export interface ResolveParcelDeps {
  /** Injected in tests so no .env/network is touched. */
  landPortalResolve?: (args: LpResolveArgs, timeoutMs: number) => Promise<LpResolveResult>;
  realieLookup?: (args: ParcelLookupArgs, opts: { timeoutMs: number }) => Promise<NormalizedParcel>;
  /** Override availability per provider (tests). Default = real presence checks. */
  configured?: Partial<Record<ParcelProviderId, boolean>>;
  /** Override the active provider (default = env LANDOS_PARCEL_PROVIDER or Realie). */
  activeProvider?: ParcelProviderId;
  fallbackOrder?: ParcelProviderId[];
  now?: () => string;
}

function present(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Active provider from config; defaults to the intended primary (Realie). */
export function activeParcelProvider(env: NodeJS.ProcessEnv = process.env): ParcelProviderId {
  const v = (env[PARCEL_PROVIDER_ENV] ?? '').trim().toLowerCase();
  if (v === 'realie' || v === 'landportal' || v === 'county_records_browser') return v;
  return DEFAULT_PRIMARY_PARCEL_PROVIDER;
}

/** Presence-only Realie config check (process.env, then .env), mirroring how
 *  other secrets resolve. Never reads/returns the value. */
function realieConfigured(): boolean {
  if (present(process.env.REALIE_API_KEY)) return true;
  if (process.env.LANDOS_DISABLE_DOTENV_FALLBACK) return false;
  try { return present(readEnvFile(['REALIE_API_KEY']).REALIE_API_KEY); } catch { return false; }
}

function isConfigured(id: ParcelProviderId, deps: ResolveParcelDeps): boolean {
  if (deps.configured && id in deps.configured) return !!deps.configured[id];
  switch (id) {
    case 'realie': return realieConfigured();
    case 'landportal': return landPortalConfigured();
    case 'county_records_browser': return makeCountyRecordsBrowserPlaceholder().configured(); // false until wired
  }
}

/** Map the LandPortal-shaped args to the provider-neutral lookup args. EXACT
 *  identifiers only — coordinates/point are intentionally dropped (never used to
 *  identify a parcel). */
function toLookupArgs(args: LpResolveArgs): ParcelLookupArgs {
  return {
    address: args.address,
    city: args.city,
    state: args.state,
    zip: args.zip,
    apn: args.apn,
    county: args.county,
    fips: args.fips,
    owner: args.owner,
    propertyId: args.propertyid,
  };
}

/** Normalize a provider-neutral NormalizedParcel into the canonical
 *  LpResolveResult the DD path consumes. */
function normalizedToResult(n: NormalizedParcel): LpResolveResult {
  const status: LpResolveResult['status'] = n.verified
    ? 'verified'
    : n.status.startsWith('error')
      ? 'error'
      : 'not_verified';
  return {
    verified: n.verified,
    status,
    propertyid: n.propertyId ?? null,
    fips: n.fips ?? null,
    apn: n.apn ?? null,
    situs_address: n.situsAddress ?? null,
    city: n.city ?? null,
    state: n.state ?? null,
    owner: n.owner ?? null,
    match_notes: `[${n.source}] ${n.note}`,
    source: n.source, // provider provenance flows through to the verification bridge
    zoning: n.zoning ?? null, // canonical zoning (e.g. Realie zoningCode) flows to DD
    candidates: [],
  };
}

function notVerifiedResult(notes: string): LpResolveResult {
  return {
    verified: false, status: 'not_verified', propertyid: null, fips: null, apn: null,
    situs_address: null, city: null, state: null, owner: null, match_notes: notes, candidates: [],
  };
}

/**
 * Resolve parcel identity through the capability abstraction. Returns the
 * canonical result + provenance. Never silently substitutes a provider; if no
 * configured provider can run, returns a not-verified result labeled Needs
 * Verification (no fabrication).
 */
export async function resolveParcelIdentity(
  args: LpResolveArgs,
  timeoutMs: number,
  deps: ResolveParcelDeps = {},
): Promise<ParcelIdentityOutcome> {
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const active = deps.activeProvider ?? activeParcelProvider();
  const fallback = deps.fallbackOrder ?? DEFAULT_PARCEL_FALLBACK_ORDER;
  const order: ParcelProviderId[] = [active, ...fallback.filter((p) => p !== active)];

  const attempted: ParcelProvenance['attempted'] = [];

  for (const id of order) {
    if (!isConfigured(id, deps)) {
      attempted.push({ provider: id, outcome: 'unavailable' });
      continue;
    }
    try {
      let result: LpResolveResult;
      if (id === 'landportal') {
        result = await (deps.landPortalResolve ?? lpResolveForPreflight)(args, timeoutMs);
      } else if (id === 'realie') {
        const lookup = deps.realieLookup ?? makeRealieParcelAdapter().lookup;
        const n = await lookup(toLookupArgs(args), { timeoutMs });
        result = normalizedToResult(n);
      } else {
        // county_records_browser is a placeholder; isConfigured() returns false,
        // so this branch is unreachable until the provider is wired.
        throw new Error('county_records_browser not implemented');
      }
      attempted.push({ provider: id, outcome: 'used' });
      const fellBack = id !== active;
      const reason = fellBack
        ? `Primary parcel provider "${active}" unavailable; used configured fallback "${id}". Not a silent substitution.`
        : `Parcel provider "${id}" (active).`;
      logger.info({ event: 'parcel_capability_resolved', provider: id, fellBack, attempted }, 'parcel_capability_resolved');
      return { result, provenance: { provider: id, fellBack, attempted, reason, sourceTimestamp: now } };
    } catch (err) {
      attempted.push({ provider: id, outcome: 'error' });
      logger.warn({ event: 'parcel_capability_provider_error', provider: id, msg: (err as Error)?.message }, 'parcel_capability_provider_error');
      // try the next configured provider in order
    }
  }

  // No configured provider could verify identity -> Needs Verification.
  const reason = 'No configured parcel-identity provider available; returning Needs Verification (no fabrication, no proximity inference).';
  logger.warn({ event: 'parcel_capability_unavailable', attempted }, 'parcel_capability_unavailable');
  return {
    result: notVerifiedResult(reason),
    provenance: { provider: 'none', fellBack: false, attempted, reason, sourceTimestamp: now },
  };
}

/** Convenience wrapper for existing callers that expect just an LpResolveResult.
 *  Provenance is still logged inside resolveParcelIdentity. */
export async function resolveParcelIdentityResult(
  args: LpResolveArgs,
  timeoutMs: number,
  deps: ResolveParcelDeps = {},
): Promise<LpResolveResult> {
  return (await resolveParcelIdentity(args, timeoutMs, deps)).result;
}
