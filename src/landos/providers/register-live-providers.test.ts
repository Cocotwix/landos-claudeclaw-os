import { describe, it, expect } from 'vitest';
import { registerLiveProviders } from './register-live-providers.js';
import { preflightLiveData } from '../live-data-preflight.js';
import type { ApifyRunner } from './apify-comp-provider.js';

const READY_ENV = {
  LANDOS_LIVE_COMPS: '1',
  APIFY_TOKEN: 'tok_test',
  APIFY_REDFIN_ACTOR: 'acme/redfin',
  APIFY_ZILLOW_ACTOR: 'acme/zillow',
};

// A runner that must never actually run during registration (registration wires
// providers, it does not call them). Throws if invoked.
const neverRunner: ApifyRunner = { async run() { throw new Error('runner should not be called at registration'); } };

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

  it('swaps Redfin/Zillow to live when preflight is ready, leaving the others stubbed', async () => {
    const res = await registerLiveProviders({
      env: READY_ENV,
      makeRunner: () => ({ async run() { return []; } }),
    });
    expect(res.compsLive).toBe(true);

    const redfin = res.registry.find((p) => p.id === 'redfin')!;
    const zillow = res.registry.find((p) => p.id === 'zillow')!;
    const landwatch = res.registry.find((p) => p.id === 'landwatch')!;
    const landportal = res.registry.find((p) => p.id === 'landportal')!;

    // live providers report no_comps on an empty dataset (not not_connected)
    expect((await redfin.retrieve({}, { timeoutMs: 1000 })).status).toBe('no_comps');
    expect((await zillow.retrieve({}, { timeoutMs: 1000 })).status).toBe('no_comps');
    // the others stay stubs
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
});
