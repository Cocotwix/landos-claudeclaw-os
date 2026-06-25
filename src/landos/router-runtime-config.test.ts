import { describe, it, expect } from 'vitest';
import {
  resolveLiveRouting,
  resolveOllamaHost,
  resolveOllamaModelMap,
  setLiveRouting,
  setOllamaHost,
  setOllamaModelMap,
  ROUTER_RUNTIME_KEYS,
  DEFAULT_OLLAMA_MODEL_MAP,
  type SettingsStore,
} from './router-runtime-config.js';
import { OllamaClient } from './model-execution.js';

/** In-memory dashboard_settings fake (no DB, hermetic). */
function fakeStore(seed: Record<string, string> = {}): SettingsStore & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    getDashboardSetting: (k) => map.get(k) ?? null,
    setDashboardSetting: (k, v) => { map.set(k, v); },
  };
}

describe('resolveLiveRouting — persisted setting wins over env', () => {
  it('returns enabled from a "1" setting (source=setting)', () => {
    const r = resolveLiveRouting(fakeStore({ [ROUTER_RUNTIME_KEYS.liveRouting]: '1' }));
    expect(r).toEqual({ enabled: true, source: 'setting' });
  });
  it('returns disabled from a "0" setting even though env may differ (source=setting)', () => {
    const r = resolveLiveRouting(fakeStore({ [ROUTER_RUNTIME_KEYS.liveRouting]: '0' }));
    expect(r).toEqual({ enabled: false, source: 'setting' });
  });
  it('falls back to env when no setting is present (source=env)', () => {
    const r = resolveLiveRouting(fakeStore({}));
    expect(r.source).toBe('env'); // value tracks the env flag (false in tests)
    expect(typeof r.enabled).toBe('boolean');
  });
});

describe('resolveOllamaHost — setting over env over empty default', () => {
  it('uses the persisted host (source=setting)', () => {
    const r = resolveOllamaHost(fakeStore({ [ROUTER_RUNTIME_KEYS.ollamaHost]: 'http://localhost:11434' }));
    expect(r).toEqual({ host: 'http://localhost:11434', source: 'setting' });
  });
  it('is empty when neither setting nor env is present (provider not installed)', () => {
    const r = resolveOllamaHost(fakeStore({}));
    expect(r.host).toBe('');
    expect(r.source).toBe('default');
  });
});

describe('resolveOllamaModelMap — defaults + override', () => {
  it('returns the built-in defaults when unset', () => {
    expect(resolveOllamaModelMap(fakeStore({}))).toEqual(DEFAULT_OLLAMA_MODEL_MAP);
  });
  it('merges a persisted JSON override (override wins per key)', () => {
    const store = fakeStore({ [ROUTER_RUNTIME_KEYS.ollamaModelMap]: JSON.stringify({ 'gemma-4-12b-q4': 'gemma4:12b-custom' }) });
    const m = resolveOllamaModelMap(store);
    expect(m['gemma-4-12b-q4']).toBe('gemma4:12b-custom');
    expect(m['gemma-4-e4b']).toBe(DEFAULT_OLLAMA_MODEL_MAP['gemma-4-e4b']); // default kept
  });
  it('ignores malformed JSON and keeps defaults', () => {
    expect(resolveOllamaModelMap(fakeStore({ [ROUTER_RUNTIME_KEYS.ollamaModelMap]: '{not json' }))).toEqual(DEFAULT_OLLAMA_MODEL_MAP);
  });
});

describe('setters persist to the expected keys', () => {
  it('setLiveRouting / setOllamaHost / setOllamaModelMap round-trip', () => {
    const store = fakeStore({});
    setLiveRouting(true, store);
    setOllamaHost('http://localhost:11434', store);
    setOllamaModelMap({ 'gemma-4-e4b': 'gemma3:4b' }, store);
    expect(resolveLiveRouting(store).enabled).toBe(true);
    expect(resolveOllamaHost(store).host).toBe('http://localhost:11434');
    expect(resolveOllamaModelMap(store)['gemma-4-e4b']).toBe('gemma3:4b');
  });
});

describe('OllamaClient — execution-path model-id -> Ollama tag translation', () => {
  it('translates the internal id to the configured Ollama tag', () => {
    const c = new OllamaClient({ host: 'http://localhost:11434', modelMap: DEFAULT_OLLAMA_MODEL_MAP });
    expect(c.ollamaTagFor('gemma-4-12b-q4')).toBe('gemma4:12b');
    expect(c.ollamaTagFor('gemma-4-e4b')).toBe('gemma3:4b');
  });
  it('falls back to the id itself when unmapped', () => {
    const c = new OllamaClient({ host: 'http://localhost:11434', modelMap: {} });
    expect(c.ollamaTagFor('mystery')).toBe('mystery');
  });
  it('POSTs the MAPPED tag (not the internal id) to /api/generate', async () => {
    const calls: any[] = [];
    const origFetch = globalThis.fetch;
    // @ts-expect-error test stub
    globalThis.fetch = async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ response: 'hi from gemma' }) } as any;
    };
    try {
      const c = new OllamaClient({ host: 'http://localhost:11434', modelMap: DEFAULT_OLLAMA_MODEL_MAP });
      const r = await c.complete('gemma-4-12b-q4', { prompt: 'ping' });
      expect(r.text).toBe('hi from gemma');
      expect(r.modelId).toBe('gemma-4-12b-q4');      // internal id preserved in result
      expect(calls[0].body.model).toBe('gemma4:12b'); // real Ollama tag sent on the wire
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
