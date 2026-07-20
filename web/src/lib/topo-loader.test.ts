// Regression: Heat Map topology cache must retry after a failed load.
//
// The owner hit this live (2026-07-19): Heat Map → Drill Deep → back to
// Heat Map stayed on the loading state forever because a rejected topology
// fetch promise was cached at module scope for the rest of the page session.

import { describe, it, expect } from 'vitest';
import { makeTopoLoader } from './topo-loader';

describe('makeTopoLoader', () => {
  it('caches a successful load across calls (fetch once)', async () => {
    let calls = 0;
    const load = makeTopoLoader(async () => { calls++; return 'topo'; });
    expect(await load()).toBe('topo');
    expect(await load()).toBe('topo');
    expect(calls).toBe(1);
  });

  it('does NOT cache a failed load — the next mount retries and recovers', async () => {
    let calls = 0;
    const load = makeTopoLoader(async () => {
      calls++;
      if (calls === 1) throw new Error('geo fetch failed');
      return 'topo';
    });
    await expect(load()).rejects.toThrow('geo fetch failed');
    // Simulates leaving the Heat Map and coming back: the retry must succeed.
    expect(await load()).toBe('topo');
    expect(await load()).toBe('topo');
    expect(calls).toBe(2);
  });

  it('shares one in-flight promise between concurrent callers', async () => {
    let calls = 0;
    let release!: (v: string) => void;
    const load = makeTopoLoader(() => { calls++; return new Promise<string>((r) => { release = r; }); });
    const a = load(); const b = load();
    release('topo');
    expect(await a).toBe('topo');
    expect(await b).toBe('topo');
    expect(calls).toBe(1);
  });
});
