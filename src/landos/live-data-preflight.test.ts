import { describe, it, expect } from 'vitest';
import {
  preflightLiveData,
  LIVE_DATA_ENV_KEYS,
  OLLAMA_HOST_DEFAULT,
  GEMMA_NORMALIZER_MODEL_DEFAULT,
} from './live-data-preflight.js';

// Step 0 preflight tests. Everything is injected — NO external call, NO real
// env/fs/network dependency. The leg is never wired here; we assert only that
// the preflight refuses a live path (keeps the stub) when anything is missing,
// names the exact missing item, and that Gemma degrades without blocking.

const ALL_COMP_ENV = {
  [LIVE_DATA_ENV_KEYS.liveComps]: '1',
  [LIVE_DATA_ENV_KEYS.apifyToken]: 'tok',
  [LIVE_DATA_ENV_KEYS.apifyRedfinSearchActor]: 'user/redfin-search',
  [LIVE_DATA_ENV_KEYS.apifyRedfinDetailActor]: 'user/redfin-detail',
};

const reachableGemma = async () => ({ reachable: true, modelPresent: true });
const downGemma = async () => ({ reachable: false, modelPresent: false });

describe('Step 0 preflight — comps gating (Apify per-source)', () => {
  it('with NOTHING set: comps not ready, names every missing item, keeps the stub', async () => {
    const p = await preflightLiveData({ env: {}, probeGemma: downGemma });
    expect(p.comps.ready).toBe(false);
    expect(p.comps.usesStub).toBe(true);
    // Exact missing items are named (live provider must NOT be registered).
    expect(p.comps.missing.some((m) => m.includes(LIVE_DATA_ENV_KEYS.liveComps))).toBe(true);
    expect(p.comps.missing).toContain(LIVE_DATA_ENV_KEYS.apifyToken);
    expect(p.comps.missing).toContain(LIVE_DATA_ENV_KEYS.apifyRedfinSearchActor);
    expect(p.comps.missing).toContain(LIVE_DATA_ENV_KEYS.apifyRedfinDetailActor);
    expect(p.comps.reason).toMatch(/DISABLED/);
  });

  it('flag on but APIFY_TOKEN missing: names exactly APIFY_TOKEN and stays on the stub', async () => {
    const env = { ...ALL_COMP_ENV };
    delete (env as Record<string, string>)[LIVE_DATA_ENV_KEYS.apifyToken];
    const p = await preflightLiveData({ env, probeGemma: downGemma });
    expect(p.comps.ready).toBe(false);
    expect(p.comps.missing).toContain(LIVE_DATA_ENV_KEYS.apifyToken);
    expect(p.comps.missing).not.toContain(LIVE_DATA_ENV_KEYS.apifyRedfinSearchActor);
    expect(p.comps.usesStub).toBe(true);
  });

  it('missing APIFY_REDFIN_SEARCH_ACTOR fails loud (names it exactly, keeps the stub)', async () => {
    const env = { ...ALL_COMP_ENV };
    delete (env as Record<string, string>)[LIVE_DATA_ENV_KEYS.apifyRedfinSearchActor];
    const p = await preflightLiveData({ env, probeGemma: downGemma });
    expect(p.comps.ready).toBe(false);
    expect(p.comps.usesStub).toBe(true);
    expect(p.comps.missing).toContain(LIVE_DATA_ENV_KEYS.apifyRedfinSearchActor);
    expect(p.comps.missing).not.toContain(LIVE_DATA_ENV_KEYS.apifyRedfinDetailActor);
    expect(p.comps.reason).toMatch(/APIFY_REDFIN_SEARCH_ACTOR/);
  });

  it('missing APIFY_REDFIN_DETAIL_ACTOR fails loud (names it exactly, keeps the stub)', async () => {
    const env = { ...ALL_COMP_ENV };
    delete (env as Record<string, string>)[LIVE_DATA_ENV_KEYS.apifyRedfinDetailActor];
    const p = await preflightLiveData({ env, probeGemma: downGemma });
    expect(p.comps.ready).toBe(false);
    expect(p.comps.usesStub).toBe(true);
    expect(p.comps.missing).toContain(LIVE_DATA_ENV_KEYS.apifyRedfinDetailActor);
    expect(p.comps.reason).toMatch(/APIFY_REDFIN_DETAIL_ACTOR/);
  });

  it('the only accepted comp keys are TOKEN + SEARCH_ACTOR + DETAIL_ACTOR (no single/zillow variant)', () => {
    // No-underscore / single-actor / zillow variants do not exist on the contract.
    expect(LIVE_DATA_ENV_KEYS.apifyToken).toBe('APIFY_TOKEN');
    expect(LIVE_DATA_ENV_KEYS.apifyRedfinSearchActor).toBe('APIFY_REDFIN_SEARCH_ACTOR');
    expect(LIVE_DATA_ENV_KEYS.apifyRedfinDetailActor).toBe('APIFY_REDFIN_DETAIL_ACTOR');
    expect((LIVE_DATA_ENV_KEYS as Record<string, string>).apifyRedfinActor).toBeUndefined();
    expect((LIVE_DATA_ENV_KEYS as Record<string, string>).apifyZillowActor).toBeUndefined();
  });

  it('all comp keys + flag present: ready, no missing items, stub not used', async () => {
    const p = await preflightLiveData({ env: { ...ALL_COMP_ENV }, probeGemma: reachableGemma });
    expect(p.comps.ready).toBe(true);
    expect(p.comps.missing).toEqual([]);
    expect(p.comps.usesStub).toBe(false);
  });
});

describe('Step 0 preflight — imagery gating (allowlisted capture-visual.js, no Google)', () => {
  it('Chromium missing -> honest-disable, names the (separately-approved) install, keeps the stub', async () => {
    const p = await preflightLiveData({
      env: { [LIVE_DATA_ENV_KEYS.liveImagery]: '1' },
      captureScriptExists: () => true,
      chromiumInstalled: () => false,
      probeGemma: downGemma,
    });
    expect(p.imagery.ready).toBe(false);
    expect(p.imagery.usesStub).toBe(true);
    expect(p.imagery.missing.some((m) => /Chromium/.test(m))).toBe(true);
    expect(p.imagery.missing.some((m) => /SEPARATE approval/.test(m))).toBe(true);
    expect(p.imagery.reason).toMatch(/visual not captured yet/);
  });

  it('flag off -> imagery stays on the stub even with everything else present', async () => {
    const p = await preflightLiveData({
      env: {},
      captureScriptExists: () => true,
      chromiumInstalled: () => true,
      probeGemma: downGemma,
    });
    expect(p.imagery.ready).toBe(false);
    expect(p.imagery.missing.some((m) => m.includes(LIVE_DATA_ENV_KEYS.liveImagery))).toBe(true);
  });

  it('flag on + script present + Chromium installed -> ready', async () => {
    const p = await preflightLiveData({
      env: { [LIVE_DATA_ENV_KEYS.liveImagery]: '1' },
      captureScriptExists: () => true,
      chromiumInstalled: () => true,
      probeGemma: downGemma,
    });
    expect(p.imagery.ready).toBe(true);
    expect(p.imagery.usesStub).toBe(false);
    expect(p.imagery.reason).toMatch(/never identity/);
  });
});

describe('Step 0 preflight — Gemma normalizer degrades, never blocks', () => {
  it('unreachable -> deterministic_only mode (no fabrication), comps/imagery unaffected', async () => {
    const p = await preflightLiveData({ env: { ...ALL_COMP_ENV }, probeGemma: downGemma });
    expect(p.gemma.mode).toBe('deterministic_only');
    expect(p.gemma.reachable).toBe(false);
    expect(p.gemma.host).toBe(OLLAMA_HOST_DEFAULT);
    expect(p.gemma.model).toBe(GEMMA_NORMALIZER_MODEL_DEFAULT);
    // Gemma being down does NOT make the (ready) comps capability not-ready.
    expect(p.comps.ready).toBe(true);
    expect(p.allEnabledReady).toBe(true);
  });

  it('reachable + model present -> gemma_normalize mode', async () => {
    const p = await preflightLiveData({ env: {}, probeGemma: reachableGemma });
    expect(p.gemma.mode).toBe('gemma_normalize');
    expect(p.gemma.reachable).toBe(true);
    expect(p.gemma.modelPresent).toBe(true);
  });

  it('honors OLLAMA_HOST / GEMMA_NORMALIZER_MODEL overrides', async () => {
    const p = await preflightLiveData({
      env: { [LIVE_DATA_ENV_KEYS.ollamaHost]: 'http://gpu.local:11434', [LIVE_DATA_ENV_KEYS.gemmaModel]: 'gemma-4-12b-q4' },
      probeGemma: downGemma,
    });
    expect(p.gemma.host).toBe('http://gpu.local:11434');
    expect(p.gemma.model).toBe('gemma-4-12b-q4');
  });

  it('a throwing probe is treated as unreachable (never throws out of preflight)', async () => {
    const p = await preflightLiveData({ env: {}, probeGemma: async () => { throw new Error('connrefused'); } });
    expect(p.gemma.mode).toBe('deterministic_only');
    expect(p.gemma.reachable).toBe(false);
  });
});

describe('Step 0 preflight — overall readiness', () => {
  it('a disabled capability does not make the leg "not ready"', async () => {
    // Nothing enabled at all -> both on stubs, but allEnabledReady is true.
    const p = await preflightLiveData({ env: {}, probeGemma: downGemma });
    expect(p.comps.usesStub).toBe(true);
    expect(p.imagery.usesStub).toBe(true);
    expect(p.allEnabledReady).toBe(true);
  });

  it('an ENABLED-but-incomplete capability makes the leg not ready', async () => {
    const p = await preflightLiveData({ env: { [LIVE_DATA_ENV_KEYS.liveComps]: '1' }, probeGemma: downGemma });
    expect(p.comps.ready).toBe(false);
    expect(p.allEnabledReady).toBe(false);
  });
});
