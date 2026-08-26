import { describe, expect, it } from 'vitest';
import {
  applyFreeLayerDefaults,
  FREE_DEFAULT_LAYER_IDS,
  FREE_DEFAULTS_MARKER_KEY,
  FREE_DEFAULTS_VERSION,
} from './free-layer-defaults';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    map,
  };
}

function fakeManager(ids: string[]) {
  const calls: Array<{ id: string; enabled: boolean; origin?: string }> = [];
  return {
    calls,
    layers: new Map(ids.map((id) => [id, {}])),
    setEnabled: async (id: string, enabled: boolean, opts?: { origin?: string }) => {
      calls.push({ id, enabled, origin: opts?.origin });
    },
  };
}

describe('GEV free-layer default migration', () => {
  it('never includes a credential-required or key-gated layer in the default-ON set', () => {
    expect(FREE_DEFAULT_LAYER_IDS).not.toContain('local-firms');
    expect(FREE_DEFAULT_LAYER_IDS).not.toContain('ais-live-vessels');
    expect(FREE_DEFAULT_LAYER_IDS.length).toBeGreaterThanOrEqual(12);
  });

  it('enables every present eligible layer once, durably (origin tool), and stamps the marker', async () => {
    const storage = fakeStorage();
    const manager = fakeManager([...FREE_DEFAULT_LAYER_IDS]);
    const enabled = await applyFreeLayerDefaults(manager, storage);
    expect(enabled).toEqual([...FREE_DEFAULT_LAYER_IDS]);
    expect(manager.calls.every((call) => call.enabled && call.origin === 'tool')).toBe(true);
    expect(storage.map.get(FREE_DEFAULTS_MARKER_KEY)).toBe(FREE_DEFAULTS_VERSION);
  });

  it('respects the operator after migration: a manual OFF is never re-forced on later visits', async () => {
    const storage = fakeStorage();
    const first = fakeManager([...FREE_DEFAULT_LAYER_IDS]);
    await applyFreeLayerDefaults(first, storage);
    // Operator turns earthquakes OFF; a later visit must not touch anything.
    const second = fakeManager([...FREE_DEFAULT_LAYER_IDS]);
    const enabled = await applyFreeLayerDefaults(second, storage);
    expect(enabled).toEqual([]);
    expect(second.calls).toHaveLength(0);
  });

  it('skips layers the running app does not register, and survives a failing layer', async () => {
    const storage = fakeStorage();
    const manager = fakeManager(['earthquakes', 'satellites']);
    manager.setEnabled = async (id: string) => {
      manager.calls.push({ id, enabled: true, origin: 'tool' });
      if (id === 'earthquakes') throw new Error('degraded');
    };
    const enabled = await applyFreeLayerDefaults(manager, storage);
    expect(enabled).toEqual(['satellites']);
  });

  it('does nothing (and does not loop-force) when storage is unavailable', async () => {
    const manager = fakeManager([...FREE_DEFAULT_LAYER_IDS]);
    const enabled = await applyFreeLayerDefaults(manager, null);
    expect(enabled).toEqual([]);
    expect(manager.calls).toHaveLength(0);
  });
});
