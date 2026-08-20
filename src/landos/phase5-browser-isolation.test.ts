// Phase 5 regression: browser lane isolation.
//
// Contract under test (Agent 3's browser layer):
//   • The LandOS-spawned automation Chrome opens as a BACKGROUND window
//     (offscreen position + anti-throttling flags) and never steals focus.
//   • Specialist lane drivers each own their OWN page — the live driver no
//     longer funnels every lane through the one shared working tab, which was
//     the chokepoint that serialized comparables behind the projection refresh.
//   • bringToFront is allowed on research paths ONLY inside the
//     state.launchedBackground gate, and otherwise only at the operator-initiated
//     "Open LandPortal" entry point. Ownership verification on connect means the
//     operator's own Chrome can never be the attached browser at all.
//   • Cleanup closes exactly the pages LandOS lanes created — never an operator
//     tab, never pages[0].

import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  BACKGROUND_CHROME_ARGS,
  closeSurplusSessionPages,
  createBrowserWorkflowScope,
  ensureBrowserSession,
  makeLiveBrowserDriver,
  runInBrowserWorkflowScope,
  _lanePageCount,
  _resetBrowserSession,
  type BrowserLike,
  type BrowserSessionConfig,
  type PageLike,
  type PuppeteerLike,
} from './browser-session.js';
import { OFFSCREEN_CHROME_ARGS } from './automation-browser.js';

const SOURCE_PATH = path.join(process.cwd(), 'src/landos/browser-session.ts');
const OWNER_PATH = path.join(process.cwd(), 'src/landos/automation-browser.ts');

// ── Source-text contract (pattern: browser-session-landportal-capture.test.ts) ──

describe('browser isolation: source contract', () => {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');

  it('spawns the automation Chrome with the background/offscreen flag set', () => {
    // The exported flag set itself: a real headed window parked far offscreen,
    // with occlusion/background throttling disabled so tiles still paint.
    expect(BACKGROUND_CHROME_ARGS).toContain('--window-position=-32000,-32000');
    expect(BACKGROUND_CHROME_ARGS).toContain('--disable-backgrounding-occluded-windows');
    expect(BACKGROUND_CHROME_ARGS).toContain('--disable-background-timer-throttling');
    expect(BACKGROUND_CHROME_ARGS).toContain('--disable-renderer-backgrounding');
    // The spawn itself moved to automation-browser.ts — the ONE module allowed to
    // launch a browser — and it applies the offscreen flags UNCONDITIONALLY. The
    // old `background ? … : []` opt-out is deliberately gone: a window that can be
    // placed onscreen is a window that can take the foreground.
    expect([...BACKGROUND_CHROME_ARGS]).toEqual([...OFFSCREEN_CHROME_ARGS]);
    expect(source).not.toContain('spawnImpl(');
    const ownerSource = fs.readFileSync(OWNER_PATH, 'utf8');
    const spawnAt = ownerSource.indexOf('spawnImpl(config.chromePath');
    expect(spawnAt).toBeGreaterThan(-1);
    const spawnCall = ownerSource.slice(spawnAt, ownerSource.indexOf(']);', spawnAt));
    expect(spawnCall).toContain('...OFFSCREEN_CHROME_ARGS');
    expect(spawnCall).not.toContain('background ?');
  });

  it('the live driver routes lanes through a PER-LANE page, never the shared working tab', () => {
    const driverAt = source.indexOf('export function makeLiveBrowserDriver');
    expect(driverAt).toBeGreaterThan(-1);
    const driver = source.slice(driverAt);
    // Every lane-path acquisition is the driver's own page…
    expect(driver).toContain('getLanePage');
    // …and the old shared-tab chokepoint is gone from the driver entirely.
    expect(driver).not.toContain('getWorkingPage()');
  });

  it('lane-created pages are registered so cleanup can tell them from operator tabs', () => {
    expect(source).toContain('const lanePageRegistry = new Map<PageLike, LanePageOwner>()');
    // The owned-scope cleanup requires an exact DRIVER owner match, and
    // un-registers only the page that driver closes.
    expect(source).toContain('lanePageRegistry.get(page)?.lane !== laneOwner');
    expect(source).toContain('lanePageRegistry.delete(page)');
  });

  it('NEVER raises a window except the LandOS-spawned offscreen background one', () => {
    // Two things establish this now, and neither is the old blanket guard:
    //  1. ensureBrowserSession REFUSES to attach unless verifyAutomationOwnership
    //     proves the answering Chrome is LandOS's own profile+port, so a page in
    //     this module can never belong to the operator's Chrome.
    //  2. automation-browser.ts is the only launcher, and it is always offscreen.
    // Activation therefore survives in exactly THREE places: the two research
    // paths (the one-pass capture and the LandPortal top-bar map search), both
    // gated on state.launchedBackground, and the operator pressing
    // "Open LandPortal" to log in. Research never reaches the last one, and
    // browser-session-candidate-selection.test.ts pins that exact split.
    expect(source).toContain('await verifyAutomationOwnership(automationBrowserConfig())');
    const callSites = [...source.matchAll(/bringToFront\?\.\(\)/g)].map((m) => m.index ?? 0);
    expect(callSites).toHaveLength(3);

    const openAt = source.indexOf('export async function openLandPortalInSession');
    expect(openAt).toBeGreaterThan(-1);
    const openEnd = source.indexOf('export ', openAt + 10);
    const operatorSites = callSites.filter((at) => at > openAt && at < openEnd);
    expect(
      operatorSites,
      'the one ungated activation must be the operator-initiated Open LandPortal entry point',
    ).toHaveLength(1);

    for (const at of callSites.filter((at) => !operatorSites.includes(at))) {
      const preceding = source.slice(Math.max(0, at - 400), at);
      expect(
        preceding,
        'a research-path bringToFront is not gated on state.launchedBackground — only the LandOS offscreen window may be activated',
      ).toContain('if (state.launchedBackground)');
    }
    // No unguarded direct invocation form either.
    expect(source).not.toMatch(/await page\.bringToFront\(\)/);
  });

  it('workflow cleanup closes only pages with an exact workflow owner', () => {
    const cleanupAt = source.indexOf('export async function closeSurplusSessionPages');
    expect(cleanupAt).toBeGreaterThan(-1);
    const cleanup = source.slice(cleanupAt, source.indexOf('export', cleanupAt + 10));
    expect(cleanup).toContain('lanePageRegistry.get(page)?.workflow !== scope');
    expect(cleanup).not.toContain('pages[0]');
  });

  it('LandPortal capture never scans for or borrows another ready parcel page', () => {
    const captureAt = source.indexOf('async captureLandPortalVisuals');
    const capture = source.slice(captureAt, source.indexOf('async readFullPanel', captureAt));
    expect(capture).toContain('const page = await getLanePage()');
    expect(capture).not.toContain('for (const candidate of await state.browser.pages())');
    expect(capture).not.toContain('reusedReadyParcelPage');
  });
});

// ── Runtime contract on a fake puppeteer (pattern: browser-session.test.ts) ──

const LIVE: BrowserSessionConfig = {
  enabled: true,
  cdpUrl: 'http://127.0.0.1:9222',
  screenshotDir: path.join(require('os').tmpdir(), 'landos-test-shots'),
  profileDir: path.join(require('os').tmpdir(), 'landos-test-profile'),
};

interface FakePage extends PageLike {
  _id: number;
  _closed: boolean;
  isClosed?(): boolean;
}

/** Fake puppeteer whose newPage() creates a DISTINCT page every time. */
function fakeMultiPagePuppeteer() {
  let nextId = 0;
  const created: FakePage[] = [];
  const makePage = (): FakePage => {
    const self: FakePage = {
      _id: nextId++,
      _closed: false,
      async goto() { /* navigation recorded implicitly */ },
      url() { return 'https://www.landportal.com/property/388'; },
      async evaluate<T>(_fn: unknown, ...args: unknown[]): Promise<T> {
        if (args.length && typeof args[0] === 'string') return true as unknown as T;
        return {
          url: 'https://www.landportal.com/property/388', title: 'Land Portal',
          headings: [], navItems: [], buttons: [], searchControls: [], links: [],
          hasMap: false, hasTable: false,
          fields: { APN: '042 123', Owner: 'TEST OWNER' }, snippets: [], loginLike: false,
        } as unknown as T;
      },
      async screenshot() { /* noop */ },
      isClosed() { return self._closed; },
    };
    (self as unknown as { close: () => Promise<void> }).close = async () => { self._closed = true; };
    return self;
  };
  const operatorTab = makePage(); // pages[0]: the operator's own tab
  const browser: BrowserLike = {
    async version() { return 'HeadlessChrome/1'; },
    async pages() { return [operatorTab, ...created.filter((p) => !p._closed)]; },
    async newPage() { const p = makePage(); created.push(p); return p; },
    isConnected() { return true; },
    async disconnect() { /* noop */ },
  };
  const pup: PuppeteerLike & { _created: FakePage[]; _operatorTab: FakePage } = {
    _created: created,
    _operatorTab: operatorTab,
    async connect() { return browser; },
  };
  return pup;
}

describe('browser isolation: two concurrent lanes get DISTINCT pages', () => {
  beforeEach(() => _resetBrowserSession());

  it('each lane driver owns its own page and reuses it across its own calls', async () => {
    const pup = fakeMultiPagePuppeteer();
    await ensureBrowserSession({ config: LIVE, puppeteer: pup });

    const laneA = makeLiveBrowserDriver('landportal', { config: LIVE, puppeteer: pup });
    const laneB = makeLiveBrowserDriver('zillow', { config: LIVE, puppeteer: pup });

    // Both lanes run CONCURRENTLY — neither waits on the other's tab.
    const [readA, readB] = await Promise.all([
      laneA.search('subject parcel', { timeoutMs: 1000 }),
      laneB.search('vacant land comps', { timeoutMs: 1000 }),
    ]);
    expect(readA.fields.APN).toBe('042 123');
    expect(readB.fields.APN).toBe('042 123');

    // Two lanes → two DISTINCT lane pages, both tracked for cleanup.
    expect(pup._created).toHaveLength(2);
    expect(pup._created[0]).not.toBe(pup._created[1]);
    expect(_lanePageCount()).toBe(2);

    // A second call on the SAME lane reuses that lane's page — no third page.
    await laneA.search('again', { timeoutMs: 1000 });
    expect(pup._created).toHaveLength(2);
  });

  it('lane cleanup closes ONLY lane-created pages, never the operator tab', async () => {
    const pup = fakeMultiPagePuppeteer();
    await ensureBrowserSession({ config: LIVE, puppeteer: pup });
    const lane = makeLiveBrowserDriver('landportal', { config: LIVE, puppeteer: pup });

    const scope = await lane.beginOwnedPageScope!();
    await lane.search('subject parcel', { timeoutMs: 1000 });
    expect(pup._created).toHaveLength(1);
    const lanePage = pup._created[0];
    expect(lanePage._closed).toBe(false);

    const result = await lane.closeOwnedPageScope!(scope);
    // The lane's page is closed and de-registered…
    expect(lanePage._closed).toBe(true);
    expect(result.closed).toBeGreaterThanOrEqual(1);
    expect(_lanePageCount()).toBe(0);
    // …and the operator's pre-existing tab was never touched.
    expect(pup._operatorTab._closed).toBe(false);
  });

  it('a scope close cannot reap another lane page, even when both lanes are live concurrently', async () => {
    const pup = fakeMultiPagePuppeteer();
    await ensureBrowserSession({ config: LIVE, puppeteer: pup });
    const laneA = makeLiveBrowserDriver('landportal', { config: LIVE, puppeteer: pup });
    const laneB = makeLiveBrowserDriver('zillow', { config: LIVE, puppeteer: pup });

    // Lane B's page exists before lane A's scope begins and remains live while
    // A closes. The old global registry treated it as A-owned and killed it.
    await laneB.search('comps', { timeoutMs: 1000 });
    const laneBPage = pup._created[0];
    const scope = await laneA.beginOwnedPageScope!();
    await laneA.search('subject', { timeoutMs: 1000 });
    const laneAPage = pup._created[1];
    await laneA.closeOwnedPageScope!(scope);

    // A closes exactly its page. B and the operator tab survive untouched.
    expect(laneAPage._closed).toBe(true);
    expect(laneBPage._closed).toBe(false);
    expect(pup._operatorTab._closed).toBe(false);
    expect(_lanePageCount()).toBe(1);

    // B continues on the SAME page; no self-healing retry or duplicate tab is
    // needed because another lane never interrupted it.
    const read = await laneB.search('comps again', { timeoutMs: 1000 });
    expect(read.fields.APN).toBe('042 123');
    expect(pup._created).toHaveLength(2);
    expect(laneBPage._closed).toBe(false);
  });

  it('mission cleanup is Deal-scoped and preserves another Deal plus every operator page', async () => {
    const pup = fakeMultiPagePuppeteer();
    await ensureBrowserSession({ config: LIVE, puppeteer: pup });
    const dealA = createBrowserWorkflowScope('deal-101');
    const dealB = createBrowserWorkflowScope('deal-202');
    const laneA = runInBrowserWorkflowScope(dealA, () =>
      makeLiveBrowserDriver('landportal', { config: LIVE, puppeteer: pup }));
    const laneB = runInBrowserWorkflowScope(dealB, () =>
      makeLiveBrowserDriver('landportal', { config: LIVE, puppeteer: pup }));

    await runInBrowserWorkflowScope(dealA, () => laneA.search('deal A subject', { timeoutMs: 1000 }));
    await runInBrowserWorkflowScope(dealB, () => laneB.search('deal B subject', { timeoutMs: 1000 }));
    const [pageA, pageB] = pup._created;

    const cleanedA = await closeSurplusSessionPages(dealA);
    expect(cleanedA.closed).toBe(1);
    expect(pageA._closed).toBe(true);
    expect(pageB._closed).toBe(false);
    expect(pup._operatorTab._closed).toBe(false);

    // A global/no-token cleanup has no authority and therefore preserves all
    // remaining pages, including Deal B and the operator.
    const global = await closeSurplusSessionPages();
    expect(global.closed).toBe(0);
    expect(pageB._closed).toBe(false);
    expect(pup._operatorTab._closed).toBe(false);

    const cleanedB = await closeSurplusSessionPages(dealB);
    expect(cleanedB.closed).toBe(1);
    expect(pageB._closed).toBe(true);
    expect(pup._operatorTab._closed).toBe(false);
  });
});
