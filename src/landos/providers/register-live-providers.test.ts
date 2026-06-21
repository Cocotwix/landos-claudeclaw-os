import { describe, it, expect } from 'vitest';
import { registerLiveProviders } from './register-live-providers.js';
import { preflightLiveData, type LiveDataPreflight } from '../live-data-preflight.js';
import type { ApifyRunner } from './apify-comp-provider.js';

// The ONLY accepted comp env keys: token + the two-stage search/detail actors.
// There is no single-actor variant and no default/fallback actor id.
const READY_ENV = {
  LANDOS_LIVE_COMPS: '1',
  APIFY_TOKEN: 'tok_test',
  APIFY_REDFIN_SEARCH_ACTOR: 'tri_angle/redfin-search',
  APIFY_REDFIN_DETAIL_ACTOR: 'tri_angle/redfin-detail',
};

// A runner that must never actually run during registration (registration wires
// providers, it does not call them). Throws if invoked.
const neverRunner: ApifyRunner = { async run() { throw new Error('runner should not be called at registration'); } };

/** A preflight that reports comps READY without consulting env — used to prove
 *  registration still re-checks the env and never falls back to a default id. */
const forceReadyPreflight = async (): Promise<LiveDataPreflight> => ({
  comps: { capability: 'comps', ready: true, missing: [], reason: 'forced ready', usesStub: false },
  imagery: { capability: 'imagery', ready: false, missing: [], reason: '', usesStub: true },
  gemma: { reachable: false, modelPresent: false, model: 'g', host: 'h', mode: 'deterministic_only', reason: '' },
  allEnabledReady: true,
});

describe('registerLiveProviders — gated swap', () => {
  it('keeps all stubs when comps are not enabled, surfacing the preflight reason', async () => {
    const res = await registerLiveProviders({
      env: {}, // nothing set
      makeRunner: () => neverRunner,
    });
    expect(res.compsLive).toBe(false);
    expect(res.reason).toMatch(/LANDOS_LIVE_COMPS/);
    // every provider is still the not_connected stub
    for (const p of res.registry) {
      const r = await p.retrieve({}, { timeoutMs: 1000 });
      expect(r.status).toBe('not_connected');
    }
  });

  it('swaps Redfin to the live two-stage provider when ready; Zillow + others stay stubbed', async () => {
    const res = await registerLiveProviders({
      env: READY_ENV,
      makeRunner: () => ({ async run() { return []; } }),
    });
    expect(res.compsLive).toBe(true);
    // Honest reason names the actual two-stage actors + Zillow staying stubbed.
    expect(res.reason).toMatch(/tri_angle\/redfin-search -> tri_angle\/redfin-detail/);
    expect(res.reason).toMatch(/Zillow stays stubbed/);

    const redfin = res.registry.find((p) => p.id === 'redfin')!;
    const zillow = res.registry.find((p) => p.id === 'zillow')!;
    const landwatch = res.registry.find((p) => p.id === 'landwatch')!;
    const landportal = res.registry.find((p) => p.id === 'landportal')!;

    // Live Redfin two-stage: no trusted centroid on a bare query -> graceful no_comps
    // (not not_connected). It never invents a location.
    expect((await redfin.retrieve({}, { timeoutMs: 1000 })).status).toBe('no_comps');
    // Zillow + the others remain honest stubs this leg.
    expect((await zillow.retrieve({}, { timeoutMs: 1000 })).status).toBe('not_connected');
    expect((await landwatch.retrieve({}, { timeoutMs: 1000 })).status).toBe('not_connected');
    expect((await landportal.retrieve({}, { timeoutMs: 1000 })).status).toBe('not_connected');
  });

  it('uses the real preflight by default and stays stubbed with a bare env', async () => {
    const res = await registerLiveProviders({
      preflight: () => preflightLiveData({ env: { APIFY_TOKEN: 'only_token' } }),
      makeRunner: () => neverRunner,
    });
    expect(res.compsLive).toBe(false);
    expect(res.reason).toMatch(/DISABLED/);
  });

  it('does not invoke the runner during registration', async () => {
    // neverRunner throws if .run is called; a clean resolve proves wiring is lazy
    const res = await registerLiveProviders({ env: READY_ENV, makeRunner: () => neverRunner });
    expect(res.compsLive).toBe(true);
  });

  it('NO fallback actor id: ready preflight but missing search/detail env -> stays stubbed, no client built', async () => {
    let runnerBuilt = false;
    // Force preflight ready, but provide token only — no search/detail actor ids.
    const res = await registerLiveProviders({
      preflight: forceReadyPreflight,
      env: { APIFY_TOKEN: 'tok_only' },
      makeRunner: () => { runnerBuilt = true; return neverRunner; },
    });
    expect(res.compsLive).toBe(false);
    // The reason names the exact required keys (proves it never defaulted one in).
    expect(res.reason).toMatch(/APIFY_REDFIN_SEARCH_ACTOR/);
    expect(res.reason).toMatch(/APIFY_REDFIN_DETAIL_ACTOR/);
    // No Apify client/runner is constructed when a required id is missing.
    expect(runnerBuilt).toBe(false);
    // Redfin remains the honest stub.
    const redfin = res.registry.find((p) => p.id === 'redfin')!;
    expect((await redfin.retrieve({}, { timeoutMs: 1000 })).status).toBe('not_connected');
  });

  it('no Apify client is built after a FAILED preflight', async () => {
    let runnerBuilt = false;
    const res = await registerLiveProviders({
      env: {}, // preflight fails (comps disabled)
      makeRunner: () => { runnerBuilt = true; return neverRunner; },
    });
    expect(res.compsLive).toBe(false);
    expect(runnerBuilt).toBe(false);
  });
});
