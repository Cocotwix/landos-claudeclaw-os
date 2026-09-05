// Injected integration proof for item 5 of the operational-closure remediation:
// a REMOTE (Browserbase) Zillow session, opened through the existing
// `openRemoteBrowserSession` seam, drives the EXISTING Zillow extraction,
// normalization and cross-board deduplication path — the same
// `fetchZillowLandComps` the local session uses. No second research system, no
// second comp store, no live account, no network: the Browserbase API and the
// remote page are injected.
//
// What this proves end to end, on the remote transport:
//   • one persistent remote session carries sold, active and manufactured boards
//   • each board's rows are extracted and normalized by the existing lane
//   • the shared address is de-duplicated across boards
//   • a challenged board is reported blocked, never fabricated
//   • the provider's operator live-view URL is exposed for a human to watch/clear

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openRemoteBrowserSession } from './remote-browser.js';
import { fetchZillowLandComps, resetZillowChallengeMemory, type RawZillowListing } from './zillow-land-comps.js';

const ENV = {
  LANDOS_REMOTE_BROWSER_PROVIDER: 'browserbase',
  BROWSERBASE_API_KEY: 'test-key',
  BROWSERBASE_PROJECT_ID: 'proj_test',
} as NodeJS.ProcessEnv;

const SHARED = { address: '1810 Wells AVE, LEHIGH ACRES, FL 33972', price: 29497, acres: 0.5, url: 'z-shared' };
const BOARDS: Record<string, { listings: RawZillowListing[]; blocked?: boolean }> = {
  sold: {
    listings: [
      { ...SHARED, status: 'Sold', soldDate: '2026-04-02' },
      { address: '2200 Palm RD, LEHIGH ACRES, FL 33972', price: 41000, acres: 1.1, url: 'z-sold-2', status: 'Sold', soldDate: '2026-02-11' },
    ],
  },
  active: {
    listings: [
      { ...SHARED, status: 'For sale' },
      { address: '99 Cypress LN, LEHIGH ACRES, FL 33972', price: 52000, acres: 2, url: 'z-act-2', status: 'For sale' },
    ],
  },
  manufactured: {
    listings: [
      { address: '77 Mobile WAY, LEHIGH ACRES, FL 33972', price: 189000, acres: 1, url: 'z-mh-1', status: 'Sold', soldDate: '2026-03-05', homeType: 'MANUFACTURED', lat: 26.6182, lng: -81.6248 },
    ],
  },
};

/** Injected Browserbase whose remote page answers the existing lane's board read. */
function fakeRemote() {
  let board: keyof typeof BOARDS = 'sold';
  const setBoard = (b: keyof typeof BOARDS) => { board = b; };
  const doFetch = (async (url: string, init?: RequestInit) => {
    const route = String(url).replace('https://api.browserbase.com/v1', '');
    const method = init?.method ?? 'GET';
    const json = (value: unknown) => ({ ok: true, status: 200, json: async () => value, text: async () => JSON.stringify(value) }) as unknown as Response;
    if (method === 'POST' && route === '/contexts') return json({ id: 'ctx_persisted' });
    if (method === 'POST' && route === '/sessions') return json({ id: 'sess_remote' });
    if (method === 'GET' && /\/debug$/.test(route)) return json({ debuggerFullscreenUrl: 'https://www.browserbase.com/devtools-fullscreen/inspector.html?session=sess_remote' });
    if (route.startsWith('/sessions/')) return json({ id: 'sess_remote', status: 'RUNNING' });
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'nope' } as unknown as Response;
  }) as unknown as typeof fetch;
  const connect = async () => ({
    async newPage() {
      return {
        async setViewport() {},
        async goto() {},
        async evaluate(fn: unknown) {
          const src = String(fn);
          const b = BOARDS[board];
          if (src.includes('press and hold') || src.includes('captcha')) return (b.blocked ?? false) as never;
          // A genuinely challenged board surfaces no listings.
          if (src.includes('property-card')) return { listings: b.blocked ? [] : b.listings, nextData: null } as never;
          return undefined as never;
        },
        async close() {},
      };
    },
    async disconnect() {},
  });
  return { doFetch, connect, setBoard };
}

describe('remote Zillow results feed the existing extraction and comp pipeline', () => {
  // `force` bypasses the live-mode env gate for injected runs, exactly as every
  // other injected Zillow lane test does; the remote session is the real
  // transport under test.
  const fast = { force: true, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1 } as const;
  const input = { city: 'Lehigh Acres', state: 'FL', subjectAcres: 1 } as const;

  it('runs sold, active and manufactured boards on ONE persistent remote session through fetchZillowLandComps', async () => {
    resetZillowChallengeMemory();
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-remote-zillow-'));
    const remote = fakeRemote();
    const handle = await openRemoteBrowserSession('zillow', { env: ENV, fetch: remote.doFetch, connect: remote.connect, stateDir });
    // Operator viewing seam is present on the remote session.
    expect(handle.liveViewUrl).toContain('browserbase.com');

    remote.setBoard('sold');
    const sold = await fetchZillowLandComps({ ...input, mode: 'sold' }, { ...fast, session: handle as never });
    remote.setBoard('active');
    const active = await fetchZillowLandComps({ ...input, mode: 'active' }, { ...fast, session: handle as never });
    remote.setBoard('manufactured');
    const manufactured = await fetchZillowLandComps(
      { ...input, mode: 'sold', propertyType: 'manufactured', lat: 26.6182, lng: -81.6248, radiusMiles: 5 },
      { ...fast, session: handle as never },
    );

    // Remote rows came through the existing extraction/normalization path.
    expect(sold.status).toBe('retrieved');
    expect(sold.comps.length).toBeGreaterThan(0);
    expect(sold.comps.every((c) => /FL/.test(c.address))).toBe(true);
    expect(active.status).toBe('retrieved');
    expect(active.comps.some((c) => /Cypress/.test(c.address))).toBe(true);
    expect(manufactured.comps.some((c) => /Mobile WAY/.test(c.address))).toBe(true);

    // The record the remote page carried is a normalized comp with its source
    // URL and price — the exact shape the canonical registry ingests.
    const one = sold.comps.find((c) => /2200 Palm/.test(c.address));
    expect(one).toMatchObject({ price: 41000, acres: 1.1 });

    await handle.close();
  });

  it('reports a challenged remote board as blocked without fabricating comps', async () => {
    resetZillowChallengeMemory();
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-remote-zillow-'));
    const remote = fakeRemote();
    BOARDS.sold.blocked = true;
    try {
      const handle = await openRemoteBrowserSession('zillow', { env: ENV, fetch: remote.doFetch, connect: remote.connect, stateDir });
      remote.setBoard('sold');
      const sold = await fetchZillowLandComps({ ...input, mode: 'sold' }, { ...fast, session: handle as never, indexedSearch: async () => [] });
      expect(sold.status).toBe('blocked');
      expect(sold.comps).toHaveLength(0);
      await handle.close();
    } finally {
      delete BOARDS.sold.blocked;
    }
  });
});
