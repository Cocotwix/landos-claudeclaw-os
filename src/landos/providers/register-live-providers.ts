// LandOS live-provider registration — the single gated swap point.
//
// Consults preflightLiveData() and, ONLY when the comps capability is fully
// ready, swaps the Redfin stub for the live two-stage tri_angle provider
// (tri_angle/redfin-search -> tri_angle/redfin-detail). Everything else
// (Zillow, LandWatch, LandPortal, and ALL imagery) stays on its stub.
//
// Why Zillow stays stubbed THIS leg: there is no validated Zillow detail payload
// shape (the fixture is tri_angle/redfin-detail only). Wiring Zillow "live" would
// mean parsing a guessed shape — which would fabricate. We fail loud instead and
// keep the honest stub until a validated Zillow shape + fixture exist.
//
// No call sites are changed by this module. Callers opt in by using the returned
// registry with retrieveComps(); until they do, the honest stubs remain in force.

import {
  defaultCompRegistry,
  type CompProvider,
} from '../comp-retrieval.js';
import {
  preflightLiveData,
  resolveLiveDataEnv,
  LIVE_DATA_ENV_KEYS,
  type LiveDataPreflight,
} from '../live-data-preflight.js';
import {
  makeRedfinTwoStageProvider,
  makeDefaultApifyRunner,
  type ApifyRunner,
  type ApifySpendHook,
} from './apify-comp-provider.js';
import { logCostRecord } from '../db.js';

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
  /** Cost-logging hook (real actor id only — never credentials). Defaults to
   *  landos_cost_record. Injected in tests. */
  onSpend?: ApifySpendHook;
}

export interface RegisterLiveProvidersResult {
  /** Drop-in registry for retrieveComps(): live where ready, stub elsewhere. */
  registry: CompProvider[];
  /** True only when the live Redfin two-stage comp provider was wired in. */
  compsLive: boolean;
  /** Loud, honest reason — mirrors the preflight reason on any gap. */
  reason: string;
}

/** Default spend logger: records the fact of a paid Apify actor call (actual
 *  actor id, stage, row count) to landos_cost_record. NEVER logs credentials.
 *  Cost is recorded at $0 here (per-run pricing is reconciled separately); the
 *  point is an auditable record that the paid actor ran. */
function defaultOnSpend(): ApifySpendHook {
  return (ev) => {
    logCostRecord({
      category: 'apify_comp_actor',
      description: `Apify ${ev.stage} actor ${ev.actorId} returned ${ev.rows} row(s)`,
      amountUsd: 0,
      refTable: 'landos_comp',
    });
  };
}

/**
 * Build the comp provider registry, swapping the Redfin stub for the live
 * two-stage tri_angle provider ONLY when preflightLiveData() reports comps ready.
 * On any gap the honest stub stays and the preflight reason is surfaced verbatim.
 * Zillow/LandWatch/LandPortal and all imagery are never touched here.
 */
export async function registerLiveProviders(
  deps: RegisterLiveProvidersDeps = {},
): Promise<RegisterLiveProvidersResult> {
  // Resolve from the APPROVED config source (.env via readEnvFile; exported
  // process.env wins) so live retrieval sees the same keys the status card does,
  // WITHOUT exporting secrets into process.env. Tests inject deps.env directly.
  const env = deps.env ?? resolveLiveDataEnv();
  const runPreflight = deps.preflight ?? (() => preflightLiveData({ env }));
  const makeRunner = deps.makeRunner ?? makeDefaultApifyRunner;
  const registry = [...(deps.baseRegistry ?? defaultCompRegistry())];

  const preflight = await runPreflight();

  if (!preflight.comps.ready) {
    // Honest stub stays connected; surface exactly what is missing.
    return { registry, compsLive: false, reason: preflight.comps.reason };
  }

  const token = (env[LIVE_DATA_ENV_KEYS.apifyToken] ?? '').trim();
  // Two-stage actors come ONLY from their explicit env keys. No single-actor
  // variant, NO default actor id, NO fallback — a missing id keeps the stub.
  const searchActor = (env[LIVE_DATA_ENV_KEYS.apifyRedfinSearchActor] ?? '').trim();
  const detailActor = (env[LIVE_DATA_ENV_KEYS.apifyRedfinDetailActor] ?? '').trim();

  // preflight.comps.ready already guarantees these are present; re-check so a
  // ready signal can never produce a provider pointed at an empty actor id.
  if (!token || !searchActor || !detailActor) {
    return {
      registry,
      compsLive: false,
      reason: `comp retrieval DISABLED: preflight reported ready but a required Apify value was empty at registration (need ${LIVE_DATA_ENV_KEYS.apifyToken}, ${LIVE_DATA_ENV_KEYS.apifyRedfinSearchActor}, ${LIVE_DATA_ENV_KEYS.apifyRedfinDetailActor}). Honest stub stays connected.`,
    };
  }

  const runner = makeRunner(token);
  const onSpend = deps.onSpend ?? defaultOnSpend();
  const liveRedfin = makeRedfinTwoStageProvider({ searchActorId: searchActor, detailActorId: detailActor, runner, onSpend });

  const swapped = registry.map((p) => (p.id === 'redfin' ? liveRedfin : p));
  return {
    registry: swapped,
    compsLive: true,
    reason: `Live Redfin two-stage comp retrieval wired (${searchActor} -> ${detailActor}). Zillow stays stubbed (no validated Zillow detail shape this leg); LandWatch/LandPortal and all imagery remain on their stubs.`,
  };
}
