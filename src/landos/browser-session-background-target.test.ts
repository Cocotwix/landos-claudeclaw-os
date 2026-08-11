import os from 'node:os';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  makeLiveBrowserDriver, _resetBrowserSession, SUPPRESS_POPUPS_JS,
  type BrowserLike, type BrowserSessionConfig, type PageLike, type PuppeteerLike,
} from './browser-session.js';

/**
 * NONINTERACTIVE PROOF that the LandPortal research path never foregrounds Chrome.
 *
 * The existing fake browser in `browser-session.test.ts` implements no CDP
 * surface, so `openBackgroundTab` returns null there and every lane page is
 * created through the `newPage()` FALLBACK — which is exactly the call that
 * activates a tab. Those tests therefore cannot see this defect at all.
 *
 * This fake implements `target()`/`waitForTarget()`, so the real background
 * route is exercised and the following are observable without launching Chrome:
 *
 *   - Target.createTarget is called with `background: true`
 *   - `newPage()` is never used for a research tab
 *   - `bringToFront` is never called on any page
 *   - the candidate collector still reads the attached suggestion list first
 *     (the LandPortal SOP: type address → suggestions → click the TOP one)
 */

const LIVE: BrowserSessionConfig = {
  enabled: true,
  cdpUrl: 'http://127.0.0.1:9222',
  screenshotDir: `${os.tmpdir()}/landos-bg-test-shots`,
  profileDir: `${os.tmpdir()}/landos-bg-test-profile`,
};

interface Recorded {
  createTargetCalls: Array<Record<string, unknown>>;
  newPageCalls: number;
  bringToFrontCalls: number;
  evaluated: string[];
  mouse: string[];
  /** Ordered log per page, so document-start ordering is observable. */
  timeline: string[];
  onNewDocument: string[];
}

function fakeBackgroundBrowser(canned: { candidateBox: unknown }) {
  const rec: Recorded = {
    createTargetCalls: [], newPageCalls: 0, bringToFrontCalls: 0, evaluated: [], mouse: [],
    timeline: [], onNewDocument: [],
  };
  let nextTargetId = 0;

  const makePage = (): PageLike => {
    let url = 'https://landportal.com/';
    const page: PageLike = {
      async evaluateOnNewDocument(fn: string | ((...a: unknown[]) => unknown)) {
        rec.onNewDocument.push(String(fn));
        rec.timeline.push('evaluateOnNewDocument');
      },
      async goto(u: string) { url = u; rec.timeline.push(`goto:${u}`); },
      url() { return url; },
      async evaluate<T>(fn: (() => T) | string, ...args: unknown[]): Promise<T> {
        const source = String(fn);
        rec.evaluated.push(source);
        // locateCandidateJs → the on-screen box for a real mouse click.
        if (source.includes('inViewport')) return canned.candidateBox as T;
        // The collector read path.
        if (source.includes('kindOf')) {
          return [{ index: 0, text: '9490, Elk Lake Road Grand Traverse MI', kind: 'row' }] as unknown as T;
        }
        if (args.length && typeof args[0] === 'string') return true as unknown as T;
        return {
          url, title: 'Land Portal', headings: [], navItems: [], buttons: [],
          searchControls: [{ selector: '#address', label: 'Address' }],
          links: [], hasMap: false, hasTable: false, fields: {}, snippets: [], loginLike: false,
        } as unknown as T;
      },
      async screenshot() { /* not exercised here */ },
      async close() { /* tracked by the driver's own scope */ },
      isClosed() { return false; },
      // Present so a call would be RECORDED rather than silently no-op'd.
      async bringToFront() { rec.bringToFrontCalls += 1; },
      mouse: {
        async move(x: number, y: number) { rec.mouse.push(`move:${x},${y}`); },
        async down() { rec.mouse.push('down'); },
        async up() { rec.mouse.push('up'); },
      },
      keyboard: { async press(k: string) { rec.mouse.push(`key:${k}`); } },
      setDefaultNavigationTimeout() { /* noop */ },
    } as unknown as PageLike;
    return page;
  };

  const pagesByTarget = new Map<string, PageLike>();

  const browser = {
    async version() { return 'HeadlessChrome/1'; },
    async pages() { return [...pagesByTarget.values()]; },
    async newPage() { rec.newPageCalls += 1; const p = makePage(); pagesByTarget.set(`np-${rec.newPageCalls}`, p); return p; },
    isConnected() { return true; },
    async disconnect() { /* noop */ },
    // ── the CDP surface the background route needs ──────────────────────────
    target() {
      return {
        async createCDPSession() {
          return {
            async send(method: string, params: unknown) {
              if (method === 'Target.createTarget') {
                rec.createTargetCalls.push(params as Record<string, unknown>);
                const targetId = `bg-${++nextTargetId}`;
                pagesByTarget.set(targetId, makePage());
                return { targetId };
              }
              return { targetId: '' };
            },
            async detach() { /* noop */ },
          };
        },
      };
    },
    async waitForTarget(predicate: (t: { url(): string; _targetId?: string }) => boolean) {
      for (const [targetId, page] of pagesByTarget) {
        if (predicate({ url: () => page.url(), _targetId: targetId })) {
          return { async page() { return page; } };
        }
      }
      throw new Error('no matching target');
    },
  } as unknown as BrowserLike;

  const pup: PuppeteerLike = { async connect() { return browser; } };
  return { pup, rec };
}

/**
 * Runs the REAL suppressor source against a DOM stub, so its semantics are
 * proven rather than asserted from the source text.
 */
function runSuppressor() {
  const navigations: string[] = [];
  const listeners: Array<{ type: string; handler: (e: unknown) => void; capture: boolean }> = [];
  const win: Record<string, unknown> = {
    location: {
      get href() { return 'https://landportal.com/'; },
      set href(v: string) { navigations.push(v); },
    },
  };
  const doc = {
    addEventListener(type: string, handler: (e: unknown) => void, capture: boolean) {
      listeners.push({ type, handler, capture });
    },
    querySelector() { return null; },
  };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', `${SUPPRESS_POPUPS_JS}`)(win, doc);
  return { win, navigations, listeners };
}

function anchorClick(target: string) {
  let prevented = false;
  const anchor = { nodeType: 1, tagName: 'A', target, parentNode: null };
  const event = { target: anchor, preventDefault() { prevented = true; } };
  return { anchor, event, wasPrevented: () => prevented };
}

describe('popup suppressor semantics (Option A: cancel, never relocate)', () => {
  it('swallows window.open without navigating this tab anywhere', () => {
    const { win, navigations } = runSuppressor();
    const opened = (win.open as (u: string, t?: string) => Record<string, unknown>)('https://landportal.com/?market_comps=abc', '_blank');

    expect(navigations).toEqual([]);
    // A usable stub, so `var w = window.open(...); w.focus()` cannot throw.
    expect(opened).toBeTruthy();
    expect(typeof opened.focus).toBe('function');
    expect(typeof opened.close).toBe('function');
    expect(opened.closed).toBe(true);

    // Setting location on the stub must not navigate the lane either.
    (opened.location as { href: string }).href = 'https://landportal.com/?market_comps=abc';
    expect(navigations).toEqual([]);
  });

  it('cancels a target=_blank anchor without rewriting its target', () => {
    const { listeners } = runSuppressor();
    const click = listeners.find((l) => l.type === 'click')!;
    expect(click.capture).toBe(true); // beats the site's own handlers

    const blank = anchorClick('_blank');
    click.handler(blank.event);
    expect(blank.wasPrevented()).toBe(true);
    // NOT retargeted — that is what pushed the lane into the comps SPA.
    expect(blank.anchor.target).toBe('_blank');
  });

  it('leaves ordinary same-tab links completely alone', () => {
    const { listeners } = runSuppressor();
    const click = listeners.find((l) => l.type === 'click')!;

    for (const target of ['', '_self']) {
      const ordinary = anchorClick(target);
      click.handler(ordinary.event);
      expect(ordinary.wasPrevented()).toBe(false);
      expect(ordinary.anchor.target).toBe(target);
    }
  });
});

describe('LandPortal research never foregrounds Chrome (no browser launched)', () => {
  beforeEach(() => _resetBrowserSession());

  it('creates its research tab as a BACKGROUND target and never calls newPage or bringToFront', async () => {
    const { pup, rec } = fakeBackgroundBrowser({ candidateBox: { x: 120, y: 340, inViewport: true, text: 'top suggestion' } });
    const driver = makeLiveBrowserDriver('landportal', { config: LIVE, puppeteer: pup });

    await driver.open!('https://landportal.com/', { timeoutMs: 2000 });
    await driver.typeSearch!('#address', '9490 Elk Lake Rd', { timeoutMs: 500 });
    const candidates = await driver.readCandidates!({ timeoutMs: 500 });
    await driver.clickCandidate!(0, { timeoutMs: 500 });

    // The tab was created through Target.createTarget, in the background.
    expect(rec.createTargetCalls.length).toBeGreaterThan(0);
    for (const params of rec.createTargetCalls) {
      expect(params.background).toBe(true);
      expect(params.url).toBe('about:blank');
    }
    // The activating paths were never taken.
    expect(rec.newPageCalls).toBe(0);
    expect(rec.bringToFrontCalls).toBe(0);

    // SOP preserved: the TOP suggestion is index 0 and is clicked for real.
    expect(candidates[0]).toMatchObject({ index: 0, text: '9490, Elk Lake Road Grand Traverse MI' });
    expect(rec.mouse).toEqual(['move:120,340', 'down', 'up']);
  });

  it('reuses ONE background tab across the whole lane instead of opening more', async () => {
    const { pup, rec } = fakeBackgroundBrowser({ candidateBox: { x: 10, y: 20, inViewport: true, text: 't' } });
    const driver = makeLiveBrowserDriver('landportal', { config: LIVE, puppeteer: pup });

    await driver.open!('https://landportal.com/', { timeoutMs: 2000 });
    await driver.readCandidates!({ timeoutMs: 500 });
    await driver.open!('https://landportal.com/property/1', { timeoutMs: 2000 });
    await driver.readCandidates!({ timeoutMs: 500 });

    expect(rec.createTargetCalls).toHaveLength(1);
    expect(rec.newPageCalls).toBe(0);
    expect(rec.bringToFrontCalls).toBe(0);
    // The driver settles 2.5s after each navigation, so two opens exceed the
    // default per-test budget.
  }, 20_000);

  it('falls back to a DOM click only when no real mouse click is possible', async () => {
    // An option scrolled out of the viewport cannot receive a real pointer
    // sequence; the DOM click is then the only way, and it must be the ONLY
    // interaction (never both).
    const { pup, rec } = fakeBackgroundBrowser({ candidateBox: { x: 0, y: 0, inViewport: false, text: 't' } });
    const driver = makeLiveBrowserDriver('landportal', { config: LIVE, puppeteer: pup });

    await driver.open!('https://landportal.com/', { timeoutMs: 2000 });
    await driver.clickCandidate!(0, { timeoutMs: 500 });

    expect(rec.mouse).toEqual([]);
    expect(rec.evaluated.some((s) => s.includes('el.click()'))).toBe(true);
    expect(rec.bringToFrontCalls).toBe(0);
  });

  it('installs the popup suppressor BEFORE the tab navigates anywhere', async () => {
    // This is the fix the click-time shim could not deliver: LandPortal's bundle
    // captures window.open at load time, so the override has to already be the
    // reference it captures.
    const { pup, rec } = fakeBackgroundBrowser({ candidateBox: null });
    const driver = makeLiveBrowserDriver('landportal', { config: LIVE, puppeteer: pup });
    await driver.open!('https://landportal.com/', { timeoutMs: 2000 });

    expect(rec.onNewDocument).toHaveLength(1);
    const script = rec.onNewDocument[0];
    expect(script).toContain('window.open = function () { return stub(); }');
    // Capture-phase listener, so it beats the site's own click handlers.
    expect(script).toMatch(/addEventListener\('click',[\s\S]*\}, true\)/);
    // Option A: cancel the popup, never relocate it into this tab.
    expect(script).toContain('event.preventDefault()');
    expect(script).not.toContain("target = '_self'");
    expect(script).not.toContain('window.location.href =');

    // Ordering is the whole point: document-start hook, THEN navigation.
    const installedAt = rec.timeline.indexOf('evaluateOnNewDocument');
    const firstGoto = rec.timeline.findIndex((e) => e.startsWith('goto:'));
    expect(installedAt).toBeGreaterThanOrEqual(0);
    expect(firstGoto).toBeGreaterThan(installedAt);
  });

  it('suppresses popups on the newPage FALLBACK too, when CDP is unavailable', async () => {
    // A browser with no CDP surface: openBackgroundTab returns null and the
    // fallback runs. It still must not be able to spawn a second tab.
    const { pup, rec } = fakeBackgroundBrowser({ candidateBox: null });
    const noCdp = { async connect() {
      const b = await pup.connect({} as never) as unknown as Record<string, unknown>;
      const stripped = { ...b } as Record<string, unknown>;
      delete stripped.target; delete stripped.waitForTarget;
      return stripped as unknown as BrowserLike;
    } } as PuppeteerLike;

    const driver = makeLiveBrowserDriver('landportal', { config: LIVE, puppeteer: noCdp });
    await driver.open!('https://landportal.com/', { timeoutMs: 2000 });

    expect(rec.createTargetCalls).toHaveLength(0);
    expect(rec.newPageCalls).toBe(1);
    expect(rec.onNewDocument).toHaveLength(1);
    expect(rec.onNewDocument[0]).toContain('window.open = function () { return stub(); }');
    expect(rec.bringToFrontCalls).toBe(0);
  });

  it('the shared working tab — acquired by the research auth check — is also background', async () => {
    // `ensureLandPortalAuthenticated` runs on the New Lead path and acquires
    // this tab. It used to be created with newPage(), which activated Chrome
    // once per managed session. Proven here through the public lending API.
    const { pup, rec } = fakeBackgroundBrowser({ candidateBox: null });
    const { withWorkingPage } = await import('./browser-session.js');
    const held = await withWorkingPage(async (page) => page.url(), { config: LIVE, puppeteer: pup });

    expect(held.ok).toBe(true);
    expect(rec.createTargetCalls.length).toBeGreaterThan(0);
    expect(rec.createTargetCalls.every((p) => p.background === true)).toBe(true);
    expect(rec.newPageCalls).toBe(0);
    expect(rec.bringToFrontCalls).toBe(0);
  });

  it('the collector it actually ships reads the attached suggestion list FIRST', async () => {
    const { pup, rec } = fakeBackgroundBrowser({ candidateBox: { x: 1, y: 1, inViewport: true, text: 't' } });
    const driver = makeLiveBrowserDriver('landportal', { config: LIVE, puppeteer: pup });
    await driver.open!('https://landportal.com/', { timeoutMs: 2000 });
    await driver.readCandidates!({ timeoutMs: 500 });

    const collector = rec.evaluated.find((s) => s.includes('kindOf'))!;
    expect(collector).toBeTruthy();
    // Suggestion list → explicit option roles → broad net, in that order.
    expect(collector.indexOf('collect(suggestionItems, false)'))
      .toBeLessThan(collector.indexOf('querySelectorAll(OPTION_SEL)'));
    expect(collector.indexOf('querySelectorAll(OPTION_SEL)'))
      .toBeLessThan(collector.indexOf('querySelectorAll(BROAD_SEL)'));
    // Navigation chrome can never be a candidate on the guessing path.
    expect(collector).toContain('el.closest(CHROME_SEL)');
  });
});
