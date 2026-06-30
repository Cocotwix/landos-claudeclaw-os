import { describe, it, expect, beforeEach } from 'vitest';
import {
  ensureBrowserSession, browserSessionStatus, browserSessionHealth, disconnectBrowserSession,
  makeLiveBrowserDriver, readSessionConfig, _resetBrowserSession,
  type PuppeteerLike, type BrowserLike, type PageLike, type BrowserSessionConfig,
} from './browser-session.js';
import { makeLandPortalBrowser, LANDPORTAL_SCREENSHOT_PURPOSE } from './landportal-browser.js';

const LIVE: BrowserSessionConfig = { enabled: true, cdpUrl: 'http://127.0.0.1:9222', screenshotDir: require('os').tmpdir() + '/landos-test-shots' };

// Fake page: evaluate(fn, query) → SUBMIT(true); evaluate(fn) → canned extraction.
function fakePage(canned: { url: string; fields: Record<string, string>; snippets?: string[]; loginLike?: boolean }) {
  const state = { url: '', gotos: 0, shots: 0 };
  const page: PageLike & { _state: typeof state } = {
    _state: state,
    async goto(u: string) { state.url = u; state.gotos += 1; },
    url() { return state.url || canned.url; },
    async evaluate<T>(_fn: unknown, ...args: unknown[]): Promise<T> {
      if (args.length && typeof args[0] === 'string') return true as unknown as T; // SUBMIT
      return { fields: canned.fields, snippets: canned.snippets ?? [], loginLike: !!canned.loginLike } as unknown as T;
    },
    async screenshot() { state.shots += 1; },
  };
  return page;
}

function fakePuppeteer(canned: Parameters<typeof fakePage>[0]) {
  const counts = { connect: 0, disconnect: 0, newPage: 0 };
  const page = fakePage(canned);
  let connected = true;
  const browser: BrowserLike = {
    async version() { return 'HeadlessChrome/1'; },
    async pages() { return [page]; },
    async newPage() { counts.newPage += 1; return page; },
    isConnected() { return connected; },
    async disconnect() { counts.disconnect += 1; connected = false; },
  };
  const pup: PuppeteerLike & { _counts: typeof counts; _page: typeof page } = {
    _counts: counts, _page: page,
    async connect() { counts.connect += 1; return browser; },
  };
  return pup;
}

const LP_FIELDS = {
  url: 'https://www.landportal.com/property/388',
  fields: { 'Property Address': '388 Gilstrap Rd', APN: '042 123', Owner: 'TEST OWNER', County: 'White', State: 'GA', Acreage: '5 ac', FEMA: 'Zone X' },
};

describe('persistent browser session', () => {
  beforeEach(() => _resetBrowserSession());

  it('is DISABLED by default (no BROWSER_INTEL_LIVE) — never connects', async () => {
    expect(readSessionConfig({}).enabled).toBe(false);
    const status = await ensureBrowserSession({ config: { ...LIVE, enabled: false }, puppeteer: fakePuppeteer(LP_FIELDS) });
    expect(status).toBe('disabled');
  });

  it('reads BROWSER_INTEL_LIVE + CDP url from env', () => {
    const cfg = readSessionConfig({ BROWSER_INTEL_LIVE: '1', BROWSER_INTEL_CDP_URL: 'http://127.0.0.1:9333' });
    expect(cfg.enabled).toBe(true);
    expect(cfg.cdpUrl).toBe('http://127.0.0.1:9333');
  });

  it('connects to the persistent Chrome when enabled + reachable', async () => {
    const pup = fakePuppeteer(LP_FIELDS);
    const status = await ensureBrowserSession({ config: LIVE, puppeteer: pup });
    expect(status).toBe('live');
    expect(browserSessionStatus()).toBe('live');
    expect(pup._counts.connect).toBe(1);
  });

  it('REUSES one session across multiple leads (connects once, no relogin)', async () => {
    const pup = fakePuppeteer(LP_FIELDS);
    await ensureBrowserSession({ config: LIVE, puppeteer: pup });
    await ensureBrowserSession({ config: LIVE, puppeteer: pup }); // lead 2
    await ensureBrowserSession({ config: LIVE, puppeteer: pup }); // lead 3
    expect(pup._counts.connect).toBe(1); // connected once, reused
  });

  it('reports UNREACHABLE when no Chrome answers (parked, not a crash)', async () => {
    const pup: PuppeteerLike = { async connect() { throw new Error('ECONNREFUSED'); } };
    const status = await ensureBrowserSession({ config: LIVE, puppeteer: pup });
    expect(status).toBe('unreachable');
    const health = await browserSessionHealth({ config: LIVE, puppeteer: pup });
    expect(health.healthy).toBe(false);
    expect(health.note).toMatch(/remote debugging|reachable/i);
  });

  it('disconnects (does NOT close) so the operator browser stays open', async () => {
    const pup = fakePuppeteer(LP_FIELDS);
    await ensureBrowserSession({ config: LIVE, puppeteer: pup });
    await disconnectBrowserSession();
    expect(pup._counts.disconnect).toBe(1);
  });

  it('health/status never leak cookies or tokens', async () => {
    const pup = fakePuppeteer(LP_FIELDS);
    const health = await browserSessionHealth({ config: LIVE, puppeteer: pup });
    const json = JSON.stringify(health).toLowerCase();
    expect(json).not.toContain('cookie');
    expect(json).not.toContain('token');
    expect(json).not.toContain('password');
  });
});

describe('live BrowserDriver (read-only)', () => {
  beforeEach(() => _resetBrowserSession());

  it('is configured only when the session is live; parked otherwise', async () => {
    const driver = makeLiveBrowserDriver('landportal', { config: { ...LIVE, enabled: false } });
    await ensureBrowserSession({ config: { ...LIVE, enabled: false } });
    expect(driver.configured()).toBe(false);
  });

  it('LandPortal live workflow: ONE screenshot + structured extraction, session reused', async () => {
    const pup = fakePuppeteer(LP_FIELDS);
    const driver = makeLiveBrowserDriver('landportal', { config: LIVE, puppeteer: pup });
    await ensureBrowserSession({ config: LIVE, puppeteer: pup });
    const lp = makeLandPortalBrowser({ driver });

    const lead1 = await lp.runWorkflow({ searchKey: { address: '388 Gilstrap Rd', county: 'White', state: 'GA' } }, { timeoutMs: 1000 });
    expect(lead1.status).toBe('retrieved');
    expect(lead1.screenshots).toHaveLength(1);
    expect(lead1.screenshots[0].purpose).toBe(LANDPORTAL_SCREENSHOT_PURPOSE);
    expect(lead1.patch.apn).toBe('042 123');
    expect(lead1.patch.owner).toBe('TEST OWNER');

    // Second property without logging in again — same session reused.
    const lead2 = await lp.runWorkflow({ searchKey: { address: '12 Other Rd', county: 'White', state: 'GA' } }, { timeoutMs: 1000 });
    expect(lead2.status).toBe('retrieved');
    expect(pup._counts.connect).toBe(1); // never reconnected / re-logged-in
  });

  it('auth detection: a login-like page flips status to auth_needed (no fabrication)', async () => {
    const pup = fakePuppeteer({ url: 'https://www.landportal.com/login', fields: {}, loginLike: true });
    const driver = makeLiveBrowserDriver('landportal', { config: LIVE, puppeteer: pup });
    await ensureBrowserSession({ config: LIVE, puppeteer: pup });
    await driver.open('https://www.landportal.com', { timeoutMs: 1000 });
    expect(browserSessionStatus()).toBe('auth_needed');
  });

  it('the live driver exposes ONLY read-only methods (no write/purchase/export)', () => {
    const driver = makeLiveBrowserDriver('landportal', { config: LIVE });
    const keys = Object.keys(driver);
    expect(keys).toEqual(expect.arrayContaining(['open', 'search', 'readFields', 'screenshot', 'configured']));
    expect(keys).not.toContain('purchase');
    expect(keys).not.toContain('export');
    expect(keys).not.toContain('write');
  });
});
