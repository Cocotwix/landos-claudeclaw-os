// LandOS live-provider registration — the single gated swap point.
//
// Consults preflightLiveData() and, ONLY when the comps capability is fully
// ready, swaps the Redfin/Zillow stub providers for live Apify-backed ones.
// Everything else (LandWatch, LandPortal, and ALL imagery) stays exactly as it
// was — imagery is intentionally untouched this leg.
//
// No call sites are changed by this module. Callers opt in by using the returned
// registry with retrieveComps(); until they do, the honest stubs remain in force.

import {
  defaultCompRegistry,
  type CompProvider,
} from '../comp-retrieval.js';
import {
  preflightLiveData,
  LIVE_DATA_ENV_KEYS,
  type LiveDataPreflight,
} from '../live-data-preflight.js';
import {
  makeApifyCompProvider,
  makeDefaultApifyRunner,
  type ApifyRunner,
} from './apify-comp-provider.js';

type Env = Record<string, string | undefined>;

export interface RegisterLiveProvidersDeps {
  /** Injected in tests so no real preflight/env/network is touched. */
  preflight?: () => Promise<LiveDataPreflight>;
  env?: Env;
  /** Build the Apify runner from a token. Injected in tests; the default lazily
   *  constructs apify-client and is only built when comps are ready. */
  makeRunner?: (token: string) => ApifyRunner;
  /** Starting registry to swap into. Defaults to the all-stub registry. */
  baseRegistry?: CompProvider[];
}

export interface RegisterLiveProvidersResult {
  /** Drop-in registry for retrieveComps(): live where ready, stub elsewhere. */
  registry: CompProvider[];
  /** True only when the live Apify comp providers were actually wired in. */
  compsLive: boolean;
  /** Loud, honest reason — mirrors the preflight reason on any gap. */
  reason: string;
}

/**
 * Build the comp provider registry, swapping Redfin/Zillow stubs for live Apify
 * providers ONLY when preflightLiveData() reports comps ready. On any gap the
 * honest stub stays and the preflight reason is surfaced verbatim. Imagery is
 * not part of this leg and is never touched here.
 */
export async function registerLiveProviders(
  deps: RegisterLiveProvidersDeps = {},
): Promise<RegisterLiveProvidersResult> {
  const env = deps.env ?? process.env;
  const runPreflight = deps.preflight ?? (() => preflightLiveData({ env }));
  const makeRunner = deps.makeRunner ?? makeDefaultApifyRunner;
  const registry = [...(deps.baseRegistry ?? defaultCompRegistry())];

  const preflight = await runPreflight();

  if (!preflight.comps.ready) {
    // Honest stub stays connected; surface exactly what is missing.
    return { registry, compsLive: false, reason: preflight.comps.reason };
  }

  const token = (env[LIVE_DATA_ENV_KEYS.apifyToken] ?? '').trim();
  const redfinActor = (env[LIVE_DATA_ENV_KEYS.apifyRedfinActor] ?? '').trim();
  const zillowActor = (env[LIVE_DATA_ENV_KEYS.apifyZillowActor] ?? '').trim();
  // preflight.comps.ready already guarantees these are present; re-check so a
  // ready signal can never produce a provider pointed at an empty actor id.
  if (!token || !redfinActor || !zillowActor) {
    return {
      registry,
      compsLive: false,
      reason: 'comp retrieval DISABLED: preflight reported ready but token/actor id was empty at registration. Honest stub stays connected.',
    };
  }

  const runner = makeRunner(token);
  const live: Record<string, CompProvider> = {
    redfin: makeApifyCompProvider('redfin', { actorId: redfinActor, runner }),
    zillow: makeApifyCompProvider('zillow', { actorId: zillowActor, runner }),
  };

  const swapped = registry.map((p) => live[p.id] ?? p);
  return {
    registry: swapped,
    compsLive: true,
    reason: 'Live comp retrieval wired (Apify Redfin/Zillow). LandWatch/LandPortal and all imagery remain on their stubs.',
  };
}
