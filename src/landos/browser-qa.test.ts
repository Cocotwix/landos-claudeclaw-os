import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BrowserQaBlocked,
  acquireBrowserForQa,
  runBrowserQa,
  scrubSecretsFromText,
  waitForLandosHealth,
  type BrowserQaPuppeteerPage,
  type BrowserQaScenario,
} from './browser-qa.js';
import type { AutomationBrowser, LaunchAutomationResult } from './automation-browser.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function launchResult(overrides: Partial<LaunchAutomationResult> = {}): LaunchAutomationResult {
  return {
    launched: false,
    reused: true,
    endpoint: 'http://127.0.0.1:9224',
    profileDir: 'C:\\Users\\test\\.landos-chrome',
    chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    pid: 4242,
    error: null,
    ...overrides,
  };
}

function fakeBrowser(page?: BrowserQaPuppeteerPage) {
  const disconnect = vi.fn(async () => undefined);
  const browser = {
    version: vi.fn(async () => 'Chrome/150'),
    isConnected: () => true,
    newPage: vi.fn(async () => page ?? ({} as BrowserQaPuppeteerPage)),
    pages: vi.fn(async () => []),
    disconnect,
  } as unknown as AutomationBrowser;
  return { browser, disconnect };
}

function fakePage(root: string) {
  const handlers = new Map<string, Array<(value: any) => void>>();
  let currentUrl = 'about:blank';
  const close = vi.fn(async () => undefined);
  const page = {
    on(event: string, handler: (value: any) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return page;
    },
    async goto(url: string) { currentUrl = url; },
    async reload() { return undefined; },
    async screenshot(opts: { path: string }) { fs.writeFileSync(opts.path, 'png'); },
    async waitForSelector() { return {}; },
    async click() { return undefined; },
    async bringToFront() { return undefined; },
    async setViewport() { return undefined; },
    async evaluate<T>(fn: (...args: any[]) => T, ...args: any[]): Promise<T> {
      if (String(fn).includes('location.pathname')) return new URL(currentUrl).pathname as T;
      return fn(...args);
    },
    url: () => currentUrl,
    close,
    emit(event: string, value: any) { for (const handler of handlers.get(event) ?? []) handler(value); },
    root,
  } as unknown as BrowserQaPuppeteerPage & { emit(event: string, value: any): void };
  return { page, close };
}

describe('LandOS canonical browser QA infrastructure', () => {
  it('waits boundedly for LandOS health and reports the successful attempt', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('starting'))
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 200 });
    const result = await waitForLandosHealth('http://localhost:3141', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
      maxAttempts: 4,
    });
    expect(result).toEqual({ ok: true, attempts: 3, detail: 'HTTP 200 after 3 attempt(s)' });
  });

  it('authenticates the health probe without returning the credential in evidence', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 200 });
    const result = await waitForLandosHealth('http://localhost:3141', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      token: 'synthetic-health-token',
    });
    const requested = fetchImpl.mock.calls[0]?.[0] as URL;
    expect(requested.searchParams.get('token')).toBe('synthetic-health-token');
    expect(JSON.stringify(result)).not.toContain('synthetic-health-token');
  });

  it('uses the healthy owned CDP 9224 connection before any new launch', async () => {
    const { browser } = fakeBrowser();
    const connect = vi.fn(async () => browser);
    const acquired = await acquireBrowserForQa({
      launch: async () => launchResult({ reused: true, launched: false }),
      connect,
    });
    expect(acquired.source).toBe('existing-cdp');
    expect(acquired.pid).toBe(4242);
    expect(connect).toHaveBeenCalledOnce();
  });

  it('uses the managed-launch fallback when CDP was initially unavailable', async () => {
    const { browser } = fakeBrowser();
    const acquired = await acquireBrowserForQa({
      launch: async () => launchResult({ reused: false, launched: true, pid: 5151 }),
      connect: async () => browser,
    });
    expect(acquired.source).toBe('managed-launch');
    expect(acquired.pid).toBe(5151);
  });

  it('returns a genuine blocked result for an unsafe foreign port owner and never connects', async () => {
    const connect = vi.fn();
    await expect(acquireBrowserForQa({
      launch: async () => launchResult({ reused: false, error: 'Port 9224 is held by a foreign runtime.' }),
      connect,
    })).rejects.toEqual(expect.objectContaining({
      name: 'BrowserQaBlocked',
      message: 'Port 9224 is held by a foreign runtime.',
    } satisfies Partial<BrowserQaBlocked>));
    expect(connect).not.toHaveBeenCalled();
  });

  it('closes only the page it created, disconnects the client, and preserves the managed browser', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-browser-qa-'));
    tempDirs.push(root);
    const { page, close } = fakePage(root);
    const { browser, disconnect } = fakeBrowser(page);
    const scenario: BrowserQaScenario = {
      id: 'cleanup-proof', route: '/proof',
      async run(qa) { qa.check('real assertion', true, 'visible result'); await qa.screenshot('proof'); },
    };
    const report = await runBrowserQa({
      root,
      scenario,
      deps: {
        launch: async () => launchResult(),
        connect: async () => browser,
        fetchImpl: vi.fn(async () => ({ status: 200 })) as unknown as typeof fetch,
        now: () => new Date('2026-08-25T20:00:00.000Z'),
      },
    });
    expect(report.outcome).toBe('PASS');
    expect(close).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(report.cleanup).toEqual({ pageClosed: true, browserDisconnected: true, browserProcessPreserved: true });
    expect(fs.existsSync(report.reportJsonPath!)).toBe(true);
    expect(report.screenshots).toHaveLength(1);
  });

  it('reports assertion and browser diagnostic failures as FAIL with actionable evidence', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-browser-qa-'));
    tempDirs.push(root);
    const { page } = fakePage(root);
    const { browser } = fakeBrowser(page);
    const scenario: BrowserQaScenario = {
      id: 'failure-proof', route: '/proof',
      async run(qa) {
        qa.check('visible assertion', false, 'expected operator text was missing');
        (qa.page as typeof page).emit('pageerror', { message: 'render crashed' });
      },
    };
    const report = await runBrowserQa({
      root,
      scenario,
      deps: {
        launch: async () => launchResult(),
        connect: async () => browser,
        fetchImpl: vi.fn(async () => ({ status: 200 })) as unknown as typeof fetch,
        now: () => new Date('2026-08-25T20:00:00.000Z'),
      },
    });
    expect(report.outcome).toBe('FAIL');
    expect(report.reason).toContain('1 step failure(s), 1 relevant browser diagnostic error(s)');
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'page-error', message: 'render crashed' })]));
  });

  it('retains expected provider and navigation cancellations as non-fatal evidence', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-browser-qa-'));
    tempDirs.push(root);
    const { page } = fakePage(root);
    const { browser } = fakeBrowser(page);
    const scenario: BrowserQaScenario = {
      id: 'expected-diagnostics', route: '/proof',
      allowIssue: (issue) => issue.kind === 'http-error' && issue.status === 503 && issue.url?.endsWith('/api/provider') === true,
      async run(qa) {
        (qa.page as typeof page).emit('response', {
          status: () => 503,
          url: () => 'http://localhost:3141/api/provider',
        });
        (qa.page as typeof page).emit('console', {
          type: () => 'error',
          text: () => 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)',
        });
        (qa.page as typeof page).emit('requestfailed', {
          url: () => 'http://localhost:3141/api/provider',
          resourceType: () => 'fetch',
          failure: () => ({ errorText: 'net::ERR_ABORTED' }),
        });
        qa.check('honest setup state', true, 'provider requirement shown');
      },
    };
    const report = await runBrowserQa({
      root,
      scenario,
      deps: {
        launch: async () => launchResult(),
        connect: async () => browser,
        fetchImpl: vi.fn(async () => ({ status: 200 })) as unknown as typeof fetch,
        now: () => new Date('2026-08-25T20:00:00.000Z'),
      },
    });
    expect(report.outcome).toBe('PASS');
    expect(report.issues).toHaveLength(3);
    expect(report.issues.every((issue) => issue.severity === 'warning')).toBe(true);
  });
});

describe('QA artifacts never persist a dashboard token', () => {
  it('redacts token/key/code query values wherever they appear, leaving the rest intact', () => {
    expect(scrubSecretsFromText('GET http://localhost:3141/api/landos/deal-cards/90?token=abc123secret&deal=90'))
      .toBe('GET http://localhost:3141/api/landos/deal-cards/90?token=[redacted]&deal=90');
    // JSON-escaped ampersand form, and the credential parameter aliases.
    expect(scrubSecretsFromText('"url":"http://x/y?deal=1\u0026key=SECRETVAL\u0026page=overview"'))
      .toBe('"url":"http://x/y?deal=1\u0026key=[redacted]\u0026page=overview"');
    expect(scrubSecretsFromText('?apiKey=AAA&access_token=BBB&password=CCC'))
      .toBe('?apiKey=[redacted]&access_token=[redacted]&password=[redacted]');
    // A React key prop or a bare "key=?" placeholder is not a credential.
    expect(scrubSecretsFromText('key={row.id} and SELECT ... WHERE key=?')).toBe('key={row.id} and SELECT ... WHERE key=?');
    // Nothing to redact leaves the string unchanged.
    expect(scrubSecretsFromText('deal=90&page=overview')).toBe('deal=90&page=overview');
  });
});
