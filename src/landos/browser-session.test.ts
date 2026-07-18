import { describe, it, expect, beforeEach } from 'vitest';
import {
  ensureBrowserSession, browserSessionStatus, browserSessionHealth, disconnectBrowserSession,
  makeLiveBrowserDriver, readSessionConfig, _resetBrowserSession, withWorkingPage,
  startBrowserSession, openLandPortalInSession, resolveChromePath,
  type PuppeteerLike, type BrowserLike, type PageLike, type BrowserSessionConfig, type SpawnLike,
} from './browser-session.js';
import { makeLandPortalBrowser, LANDPORTAL_SCREENSHOT_PURPOSE } from './landportal-browser.js';

const LIVE: BrowserSessionConfig = { enabled: true, cdpUrl: 'http://127.0.0.1:9222', screenshotDir: require('os').tmpdir() + '/landos-test-shots', profileDir: require('os').tmpdir() + '/landos-test-profile' };

// Fake page: evaluate(fn, query) → SUBMIT(true); evaluate(fn) → canned extraction.
function fakePage(canned: { url: string; fields: Record<string, string>; snippets?: string[]; loginLike?: boolean }) {
  const state = { url: '', gotos: 0, shots: 0 };
  const page: PageLike & { _state: typeof state } = {
    _state: state,
    async goto(u: string) { state.url = u; state.gotos += 1; },
    url() { return state.url || canned.url; },
    async evaluate<T>(_fn: unknown, ...args: unknown[]): Promise<T> {
      if (args.length && typeof args[0] === 'string') return true as unknown as T; // SUBMIT / SELECT / CLICK
      // Doubles as a readPage result AND a PageObservation (observe()): extra keys
      // are harmless to readPage and give the Website-Intelligence path a usable
      // APN search control + record fields to reach a verified record.
      return {
        url: state.url || canned.url, title: 'Land Portal', headings: [], navItems: [], buttons: [],
        searchControls: [{ selector: '#apn', label: 'APN' }, { selector: '#address', label: 'Address' }],
        links: [], hasMap: false, hasTable: false,
        fields: canned.fields, snippets: canned.snippets ?? [], loginLike: !!canned.loginLike,
      } as unknown as T;
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

  it('serializes concurrent missions through the one persistent working tab', async () => {
    const pup = fakePuppeteer(LP_FIELDS);
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => { firstStarted = resolve; });
    const releaseFirstPromise = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let active = 0;
    let maxActive = 0;

    const first = withWorkingPage(async () => {
      active += 1; maxActive = Math.max(maxActive, active); firstStarted();
      await releaseFirstPromise;
      active -= 1;
      return 'first';
    }, { config: LIVE, puppeteer: pup });
    await firstStartedPromise;
    const second = withWorkingPage(async () => {
      active += 1; maxActive = Math.max(maxActive, active); active -= 1;
      return 'second';
    }, { config: LIVE, puppeteer: pup });

    expect(active).toBe(1);
    releaseFirst();
    await expect(first).resolves.toMatchObject({ ok: true, value: 'first' });
    await expect(second).resolves.toMatchObject({ ok: true, value: 'second' });
    expect(maxActive).toBe(1);
    expect(pup._counts.newPage).toBe(1);
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

  it('live driver: structured read + ONE screenshot, session reused across leads (no re-login)', async () => {
    // Session mechanics (the full agentic LandPortal retrieval is covered by
    // landportal-agentic.test.ts). Prove read/screenshot work and the SAME session
    // is reused across leads without reconnecting or re-logging-in.
    const pup = fakePuppeteer(LP_FIELDS);
    const driver = makeLiveBrowserDriver('landportal', { config: LIVE, puppeteer: pup });
    await ensureBrowserSession({ config: LIVE, puppeteer: pup });

    // Lead 1 — open, read structured fields, capture exactly one screenshot.
    await driver.open('https://landportal.com', { timeoutMs: 1000 });
    const read1 = await driver.readFields({ timeoutMs: 1000 });
    const shot1 = await driver.screenshot(LANDPORTAL_SCREENSHOT_PURPOSE, { timeoutMs: 1000 });
    expect(read1.fields.APN).toBe('042 123');
    expect(read1.fields.Owner).toBe('TEST OWNER');
    expect(shot1.purpose).toBe(LANDPORTAL_SCREENSHOT_PURPOSE);

    // Lead 2 — same session, never reconnected / re-logged-in.
    await driver.open('https://landportal.com', { timeoutMs: 1000 });
    await driver.readFields({ timeoutMs: 1000 });
    expect(pup._counts.connect).toBe(1);
  }, 10_000);

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

describe('Start Browser Intelligence (launch + connect, Chrome only)', () => {
  beforeEach(() => _resetBrowserSession());

  it('resolves a configured Chrome path that exists (Edge never considered)', () => {
    const r = resolveChromePath(process.execPath); // a real existing exe
    expect(r.path).toBe(process.execPath);
    // The default candidate list is Chrome-only — no Edge anywhere.
    expect(r.checked.join(' ').toLowerCase()).not.toContain('edge');
    expect(r.checked.join(' ')).toMatch(/Google\\Chrome\\Application\\chrome\.exe/);
  });

  it('disabled when live mode is off (no launch)', async () => {
    const spawnCalls: string[] = [];
    const spawn: SpawnLike = (cmd) => spawnCalls.push(cmd);
    const r = await startBrowserSession({ config: { ...LIVE, enabled: false }, spawn });
    expect(r.status).toBe('disabled');
    expect(r.launched).toBe(false);
    expect(spawnCalls).toHaveLength(0);
  });

  it('REUSES a running session instead of launching a second Chrome', async () => {
    const pup = fakePuppeteer(LP_FIELDS); // connects immediately
    const spawnCalls: string[] = [];
    const spawn: SpawnLike = (cmd) => spawnCalls.push(cmd);
    const r = await startBrowserSession({ config: LIVE, puppeteer: pup, spawn });
    expect(r.reused).toBe(true);
    expect(r.launched).toBe(false);
    expect(spawnCalls).toHaveLength(0); // never launched a second browser
  });

  it('launches Google Chrome with the LandOS profile + remote debugging, then connects', async () => {
    const launched = { yes: false };
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const spawn: SpawnLike = (cmd, args) => { launched.yes = true; calls.push({ cmd, args }); };
    // Connect fails until "Chrome" is launched, then succeeds (simulates startup).
    const base = fakePuppeteer(LP_FIELDS);
    const pup: PuppeteerLike = { async connect(o) { if (!launched.yes) throw new Error('not up'); return base.connect(o); } };
    const r = await startBrowserSession({
      config: { ...LIVE, chromePath: process.execPath }, puppeteer: pup, spawn, maxPolls: 5, pollMs: 1,
    });
    expect(r.launched).toBe(true);
    expect(r.reused).toBe(false);
    expect(r.chromePath).toBe(process.execPath);
    expect(['live', 'auth_needed']).toContain(r.status);
    const args = calls[0].args.join(' ');
    expect(args).toContain('--remote-debugging-port=9222');
    expect(args).toContain('--user-data-dir=');
    expect(calls[0].cmd.toLowerCase()).not.toContain('edge'); // Chrome, not Edge
  });

  it('reports the exact issue when Chrome is not found at any path', async () => {
    const r = await startBrowserSession({
      // a bogus configured path forces the resolver to the (machine-dependent)
      // candidates; we still get a structured error path when none exist.
      config: { ...LIVE, chromePath: 'Z:\\nope\\chrome.exe' },
      puppeteer: { async connect() { throw new Error('down'); } },
      spawn: () => { throw new Error('should not launch when not found'); },
      maxPolls: 1, pollMs: 1,
    }).catch((e) => ({ error: String(e) } as any));
    // Either Chrome was found on this machine (launched) OR a clear not-found error.
    if (r.chromePath == null) {
      expect(r.error).toMatch(/Chrome was not found|Checked:/i);
      expect(String(r.error).toLowerCase()).not.toContain('edge');
    } else {
      expect(r.chromePath).toMatch(/chrome\.exe/i);
    }
  });

  it('open LandPortal: authenticated page → live; login page → auth_needed', async () => {
    const pupAuthed = fakePuppeteer(LP_FIELDS); // has property fields, not loginLike
    await ensureBrowserSession({ config: LIVE, puppeteer: pupAuthed });
    const ok = await openLandPortalInSession({ config: LIVE, puppeteer: pupAuthed });
    expect(ok.authenticated).toBe(true);
    expect(ok.status).toBe('live');
    expect(ok.health.landportalAuthenticated).toBe(true);

    _resetBrowserSession();
    const pupLogin = fakePuppeteer({ url: 'https://www.landportal.com/login', fields: {}, loginLike: true });
    await ensureBrowserSession({ config: LIVE, puppeteer: pupLogin });
    const needs = await openLandPortalInSession({ config: LIVE, puppeteer: pupLogin });
    expect(needs.authenticated).toBe(false);
    expect(needs.status).toBe('auth_needed');
    expect(needs.note).toMatch(/log into landportal/i);
  });
});
