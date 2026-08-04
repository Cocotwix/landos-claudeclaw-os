// Universal browser-tab lifecycle contract.
//
// Every browser-based research workflow closes the pages it created once its
// information is persisted — after success, failure, timeout, cancellation,
// or malformed output — and never touches operator pages. These tests cover
// the shared owned-pages wrapper, the session temp tabs, the county-records
// and Brockovich wiring, and the Hermes lane's endpoint-level sweep.

import fs from 'node:fs';
import path from 'node:path';

import { describe, it, expect, beforeEach } from 'vitest';

import {
  ensureBrowserSession, makeLiveBrowserDriver, _resetBrowserSession, _lanePageCount,
  type PuppeteerLike, type BrowserLike, type PageLike, type BrowserSessionConfig,
} from './browser-session.js';
import { withOwnedPages } from './browser-owned-pages.js';
import { runBrockovichDataCenterMap } from './brockovich-data-center.js';
import type { BrowserDriver } from './browser-intelligence.js';

const LIVE: BrowserSessionConfig = {
  enabled: true,
  cdpUrl: 'http://127.0.0.1:9222',
  screenshotDir: require('os').tmpdir() + '/landos-lifecycle-shots',
  profileDir: require('os').tmpdir() + '/landos-lifecycle-profile',
};

function fakePage() {
  const state = { url: '', closed: 0 };
  const page: PageLike & { _state: typeof state; close(): Promise<void> } = {
    _state: state,
    async goto(u: string) { state.url = u; },
    async close() { state.closed += 1; },
    isClosed() { return state.closed > 0; },
    url() { return state.url; },
    async evaluate<T>(): Promise<T> { return { fields: {}, snippets: [] } as unknown as T; },
    async screenshot() { /* no-op */ },
  };
  return page;
}

function fakePuppeteer() {
  const operatorTab = fakePage();
  const created: Array<ReturnType<typeof fakePage>> = [];
  const browser: BrowserLike = {
    async version() { return 'HeadlessChrome/1'; },
    async pages() { return [operatorTab, ...created.filter((p) => p._state.closed === 0)]; },
    async newPage() { const p = fakePage(); created.push(p); return p; },
    isConnected() { return true; },
    async disconnect() { /* no-op */ },
  };
  const pup: PuppeteerLike & { _operatorTab: typeof operatorTab; _created: typeof created } = {
    _operatorTab: operatorTab,
    _created: created,
    async connect() { return browser; },
  };
  return pup;
}

describe('session temp tabs are tracked and always closed', () => {
  beforeEach(() => _resetBrowserSession());

  it('readFullPanel closes its fresh tab and leaves no tracked page behind', async () => {
    const pup = fakePuppeteer();
    await ensureBrowserSession({ config: LIVE, puppeteer: pup });
    const driver = makeLiveBrowserDriver('lifecycle-test', { config: LIVE, puppeteer: pup });
    await driver.readFullPanel!('https://landportal.com/?property=x', { timeoutMs: 8000 });
    expect(pup._created.length).toBe(1);
    expect(pup._created[0]._state.closed).toBe(1);
    expect(pup._operatorTab._state.closed).toBe(0);
    expect(_lanePageCount()).toBe(0);
  }, 15000);

  it('registers temp tabs for workflow-scoped reaping (source contract)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/landos/browser-session.ts'), 'utf8');
    expect(src).toContain('trackTempSessionPage(detailPage)');
    expect(src).toContain('trackTempSessionPage(page)');
    expect(src).toMatch(/finally \{\s*await releaseTempSessionPage\(page\);/);
  });
});

describe('shared owned-pages wrapper (finally-style)', () => {
  const scopedDriver = () => {
    const calls = { begin: 0, close: 0 };
    const driver = {
      id: 'fake',
      configured: () => true,
      async open() { return { url: '', fields: {}, snippets: [] }; },
      async search() { return { url: '', fields: {}, snippets: [] }; },
      async readFields() { return { url: '', fields: {}, snippets: [] }; },
      async screenshot() { return { path: null }; },
      async beginOwnedPageScope() { calls.begin += 1; return 'scope-1'; },
      async closeOwnedPageScope() { calls.close += 1; return { closed: 2, failed: 0, preserved: 1 }; },
    } as unknown as BrowserDriver;
    return { driver, calls };
  };

  it('closes the scope and annotates the result on success', async () => {
    const { driver, calls } = scopedDriver();
    const result = await withOwnedPages(driver, async () => ({ note: 'done' } as { note: string; browserCleanup?: { closed: number; failed: number; preserved: number } }));
    expect(calls).toEqual({ begin: 1, close: 1 });
    expect(result.browserCleanup).toEqual({ closed: 2, failed: 0, preserved: 1 });
    expect(result.note).toMatch(/browser cleanup: 2 page\(s\) closed/);
  });

  it('closes the scope on failure without masking the error', async () => {
    const { driver, calls } = scopedDriver();
    await expect(withOwnedPages(driver, async () => { throw new Error('workflow failed'); }))
      .rejects.toThrow('workflow failed');
    expect(calls.close).toBe(1);
  });

  it('runs without a scope when the driver has no lifecycle hooks', async () => {
    const bare = { id: 'bare', configured: () => true } as unknown as BrowserDriver;
    const result = await withOwnedPages(bare, async () => ({ note: 'ok' }));
    expect(result.note).toBe('ok');
  });
});

describe('research services own their pages', () => {
  it('county-records runWorkflow and ask run inside the shared owned-page scope (source contract)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/landos/county-records-browser.ts'), 'utf8');
    expect(src).toMatch(/import \{ withOwnedPages \} from '\.\/browser-owned-pages\.js';/);
    expect(src).toMatch(/runWorkflow\(input, opts\) \{\s*return withOwnedPages\(driver/);
    expect(src).toMatch(/return withOwnedPages\(driver, async \(\) => \{\s*const ev = await runCountyWorkflow/);
  });

  it('landportal browser uses the shared wrapper (no local copy)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/landos/landportal-browser.ts'), 'utf8');
    expect(src).toMatch(/import \{ withOwnedPages \} from '\.\/browser-owned-pages\.js';/);
    expect(src).not.toMatch(/async function withOwnedPages/);
  });

  it('Brockovich map closes its owned pages even when the workflow fails', async () => {
    const calls = { begin: 0, close: 0 };
    const driver = {
      id: 'brockovich',
      configured: () => true,
      async open() { throw new Error('map never loaded'); },
      async evaluate() { return {}; },
      async screenshot() { return { path: null }; },
      async beginOwnedPageScope() { calls.begin += 1; return 'scope-b'; },
      async closeOwnedPageScope() { calls.close += 1; return { closed: 1, failed: 0, preserved: 0 }; },
    } as unknown as BrowserDriver;
    const result = await runBrockovichDataCenterMap({ lat: 43.3, lng: -76.6, driver });
    expect(result.status).toBe('unavailable');
    expect(calls).toEqual({ begin: 1, close: 1 });
  });
});

describe('Hermes lane endpoint-level tab hygiene', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/landos/hermes-landportal-auto.ts'), 'utf8');

  it('sweeps lane-created research tabs in a finally, success or failure alike', () => {
    expect(src).toMatch(/const pagesBefore = tabHygiene \? await snapshotLanePages/);
    expect(src).toMatch(/\} finally \{\s*if \(tabHygiene\) \{\s*const swept = await closeLaneCreatedPages/);
  });

  it('never touches a real browser from a test run and preserves pre-existing pages', () => {
    expect(src).toMatch(/!deps\.skipTabHygiene && !process\.env\.VITEST/);
    expect(src).toMatch(/!before\.has\(tab\.id\)/);
    expect(src).toMatch(/keep one authenticated landportal page alive/i);
  });
});
