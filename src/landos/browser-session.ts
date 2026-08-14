// LandOS — Persistent Browser Session manager + live Puppeteer driver.
//
// Activates the EXISTING Browser Intelligence BrowserDriver seam against a real,
// persistent Chrome the operator launches once (with remote debugging) and logs
// into manually. LandOS CONNECTS to that running Chrome over CDP and reuses the
// same session across many leads — it never launches with stored credentials,
// never closes the operator's browser (disconnect only, so it stays open all
// day), and never reads/writes/prints cookies or tokens.
//
// This is NOT a new browser architecture: it implements the BrowserDriver
// interface from browser-intelligence.ts. Puppeteer is loaded dynamically and is
// fully injectable (PuppeteerLike) so tests never launch or connect to anything.
//
// STRICT READ-ONLY: open / navigate / read visible fields / capture a screenshot
// only. No clicks on buy/export/report/billing controls; no writes; no purchases.

import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawn as nodeSpawn } from 'child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { automationBrowserConfig, launchAutomationBrowser, verifyAutomationOwnership } from './automation-browser.js';
import type { BrowserDriver, BrowserPageRead, BrowserScreenshot } from './browser-intelligence.js';
import { landosArtifactPath } from './storage-profile.js';
import { assessMapViewportFrame, contextZoomOutSteps, parseAcresFromFields, inspectSavedParcelVisual, isDistinctOverlayCapture, fileSha256, OVERLAY_CAPTURE_PLAN, type MapViewportClip, type ParcelVisualCaptureKind } from './parcel-visual-framing.js';
import { evaluateThreeDCaptureEligibility, landPortalIdentityFromUrl } from './landportal-operating-rules.js';
import {
  landPortalCompCardsFromApi,
  landPortalCompDetailsFromApi,
  landPortalFactsFromApi,
  landPortalSimilarsFrom,
} from './landportal-api.js';

// The functions passed to page.evaluate() below execute INSIDE the operator's
// browser (not Node), so the DOM globals are declared as `any` purely to satisfy
// the Node typechecker. They are never executed in this process.
declare const document: any;
declare const Event: any;
declare const window: any;
declare const location: any;

// ─────────────────────────────────────────────────────────────────────────
// Injectable Puppeteer seam (tests inject a fake; prod loads puppeteer-core)
// ─────────────────────────────────────────────────────────────────────────

export interface PageLike {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  url(): string;
  evaluate<T>(fn: (() => T) | string, ...args: unknown[]): Promise<T>;
  screenshot(opts: { path: string; fullPage?: boolean; clip?: MapViewportClip }): Promise<unknown>;
  type?(selector: string, text: string, opts?: { delay?: number }): Promise<void>;
  keyboard?: { press(key: string): Promise<void>; down?(key: string): Promise<void>; up?(key: string): Promise<void> };
  mouse?: {
    move(x: number, y: number, options?: { steps?: number }): Promise<void>;
    down(options?: { button?: 'left' | 'right' | 'middle' }): Promise<void>;
    up(options?: { button?: 'left' | 'right' | 'middle' }): Promise<void>;
  };
  bringToFront?(): Promise<void>;
  /** Runs BEFORE any of the page's own scripts, on every document it loads. */
  evaluateOnNewDocument?(fn: string | ((...args: unknown[]) => unknown), ...args: unknown[]): Promise<unknown>;
  /** Real puppeteer pages report closure; fakes may omit it. */
  isClosed?(): boolean;
  /** Puppeteer event API (present on real pages; optional for test fakes).
   *  Used to passively read the JSON responses the page itself loads during
   *  the normal visible workflow — never to issue requests of our own. */
  on?(event: string, handler: (...args: never[]) => void): void;
  off?(event: string, handler: (...args: never[]) => void): void;
}
export interface BrowserLike {
  version(): Promise<string>;
  pages(): Promise<PageLike[]>;
  newPage(): Promise<PageLike>;
  isConnected(): boolean;
  disconnect(): Promise<void>;
}
export interface PuppeteerLike {
  connect(opts: { browserURL?: string; browserWSEndpoint?: string; protocolTimeout?: number }): Promise<BrowserLike>;
}

export type BrowserSessionStatus = 'live' | 'disabled' | 'unreachable' | 'auth_needed';

export interface BrowserSessionConfig {
  /** Live execution is OFF unless explicitly enabled (BROWSER_INTEL_LIVE). */
  enabled: boolean;
  /** CDP endpoint of the operator's persistent Chrome (remote debugging). */
  cdpUrl: string;
  /** Local dir for proof screenshots (NOT the repo; property work product). */
  screenshotDir: string;
  /** Chrome executable to launch (Google Chrome ONLY — never Edge). */
  chromePath?: string;
  /** Dedicated persistent Chrome profile dir (keeps the LandPortal login). */
  profileDir: string;
  /** Opt OUT of background (offscreen) launching. Default false: a Chrome that
   *  LandOS spawns itself must never appear over — or steal focus from — the
   *  operator's work. Set BROWSER_INTEL_FOREGROUND=1 to get a visible window. */
  foreground?: boolean;
}

/**
 * Flags that keep a LandOS-SPAWNED Chrome out of the operator's way while it
 * keeps rendering normally:
 * - the window opens far offscreen (a real HEADED window — LandPortal's login,
 *   session fingerprint and map painting are only proven on headed Chrome, and
 *   the persistent profile keeps its cookies either way), and
 * - occlusion/background throttling is disabled so map tiles still paint and
 *   timers still run in a window nobody can see.
 * A pre-existing reachable Chrome on the CDP port is always REUSED as-is (one
 * profile dir can never back two live instances), so these flags only shape
 * fresh spawns.
 */
export const BACKGROUND_CHROME_ARGS = [
  '--window-position=-32000,-32000',
  '--window-size=1920,1080',
  '--disable-backgrounding-occluded-windows',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
] as const;

/** LandPortal entry URL opened in the session for manual login / auth detection. */
export const LANDPORTAL_SESSION_URL = 'https://landportal.com/';

/** Standard Google Chrome install paths (Windows). Edge is intentionally excluded. */
export const CHROME_CANDIDATE_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
];

const ENV_KEYS = ['BROWSER_INTEL_LIVE', 'BROWSER_INTEL_CDP_URL', 'BROWSER_INTEL_SHOT_DIR', 'BROWSER_INTEL_CHROME_PATH', 'BROWSER_INTEL_PROFILE_DIR', 'BROWSER_INTEL_FOREGROUND'];

/** LandPortal browser-login credential env var names (values NEVER printed/logged/
 *  returned). Read from the shell env or the .env FILE via readEnvFile. */
export const LANDPORTAL_CRED_ENV = { email: 'LANDPORTAL_EMAIL', password: 'LANDPORTAL_PASSWORD' } as const;

/** Read live-session config. The shell environment wins; otherwise the same keys
 *  are read from the .env FILE (these are non-secret config flags, never secrets).
 *  `env` is injectable so tests never read the real environment. */
export function readSessionConfig(env?: Record<string, string | undefined>): BrowserSessionConfig {
  const proc = env ?? process.env;
  let fileVals: Record<string, string> = {};
  if (!env) { try { fileVals = readEnvFile(ENV_KEYS); } catch { fileVals = {}; } }
  const get = (k: string) => (proc[k] ?? fileVals[k] ?? '').trim();
  const flag = get('BROWSER_INTEL_LIVE').toLowerCase();
  const fg = get('BROWSER_INTEL_FOREGROUND').toLowerCase();
  // The endpoint, profile and executable are OWNED by automation-browser.ts —
  // this module never invents its own. That is what keeps a single answer to
  // "which browser is LandOS's?", and it is why the old `|| 'http://127.0.0.1:9222'`
  // default is gone: 9222 is the port every other tool grabs (msedgewebview2
  // holds it on this machine), and defaulting to it is how automation ends up
  // pointed at a browser LandOS does not own.
  const owned = automationBrowserConfig(env);
  return {
    enabled: flag === '1' || flag === 'true' || flag === 'yes',
    cdpUrl: owned.endpoint,
    screenshotDir: get('BROWSER_INTEL_SHOT_DIR') || landosArtifactPath('browser-shots'),
    chromePath: owned.chromePath ?? undefined,
    profileDir: owned.profileDir,
    // Retained for the operator's explicit "Open LandPortal" login action only.
    // Research never reads it; there is no foreground research path.
    foreground: fg === '1' || fg === 'true' || fg === 'yes',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Singleton session state — ONE connection reused across all leads
// ─────────────────────────────────────────────────────────────────────────

interface SessionState {
  browser: BrowserLike | null;
  workingPage: PageLike | null;
  status: BrowserSessionStatus;
  cdpUrl: string;
  connectedAtIso: string | null;
  /** LandPortal auth, set when LandPortal is opened/checked in the session. */
  auth: { authenticated: boolean | null; atIso: string | null };
  lastCheckIso: string | null;
  screenshotDir: string;
  /** True when THIS process spawned Chrome as an offscreen background window.
   *  Only such a window may ever be activated (it is invisible at -32000, so
   *  activating a tab in it cannot cover the operator's work). */
  launchedBackground: boolean;
}
const state: SessionState = { browser: null, workingPage: null, status: 'disabled', cdpUrl: '', connectedAtIso: null, auth: { authenticated: null, atIso: null }, lastCheckIso: null, screenshotDir: '', launchedBackground: false };

// LEGACY shared working tab. Playbook/market-research routines that lend the
// single working tab still serialize here: overlapping CDP workflows on ONE tab
// can stall target setup (observed as `Network.enable timed out`). Specialist
// lane drivers no longer queue here — each driver owns its OWN page (below), so
// independent lanes browse concurrently. Keep the queue alive after a failed
// mission so a recoverable provider error never blocks the next retry.
let workingPageGate: Promise<unknown> = Promise.resolve();

// ── NAMED narrow serializations (per-lane pages removed the broad chokepoint) ──
//
// landportalCaptureGate — the ONE-PASS LandPortal visual capture drives window
// activation, the map camera, overlay dialogs and screenshot paint gates. Two
// captures interleaving on the same Chrome window corrupt each other's framing,
// so captures serialize here even though each runs on its own lane page. This
// is deliberately the ONLY cross-lane exclusion around LandPortal map work:
// plain navigation/reads on separate lane pages run concurrently.
let landportalCaptureGate: Promise<unknown> = Promise.resolve();
//
// landportalAuthGate — the automatic login drives the shared working tab and
// writes the one auth cache. Two lanes logging in concurrently would race the
// form; the second waiter re-checks the fresh cache and returns without a
// second login.
let landportalAuthGate: Promise<unknown> = Promise.resolve();

// Every page a LANE DRIVER created (never an operator tab, never pages[0]),
// keyed by the ONE driver instance that owns it. A plain set answered only
// "did some LandOS lane create this page?" and let lane A's scope cleanup reap
// lane B's live page. Ownership is the safety boundary: cleanup may close only
// pages whose owner matches the driver closing its scope.
export type BrowserWorkflowScope = symbol;

interface LanePageOwner {
  lane: symbol;
  /** The Deal/workflow whose async execution created this lane. Null means the
   *  page has no proven workflow owner and global cleanup must preserve it. */
  workflow: BrowserWorkflowScope | null;
}

const browserWorkflowContext = new AsyncLocalStorage<BrowserWorkflowScope>();
const lanePageRegistry = new Map<PageLike, LanePageOwner>();

// Short-lived helper tabs (comp-detail enrichment, full-panel reads) are
// registered under this lane so a watchdog-killed run can still reap them via
// closeSurplusSessionPages: they carry the creating workflow's scope, and the
// synthetic lane symbol can never collide with a driver's per-instance lane.
const sessionTempLane = Symbol('landos-session-temp-tab');

// ── THE PERMANENT CONTROL PAGE ────────────────────────────────────────────
//
// The automation Chrome exits with its last page, so exactly one inert
// about:blank is kept alive to hold the process (and its authenticated
// profile) open. That page is infrastructure, not a research surface.
//
// It was being reused AS a research surface: research navigated the retained
// control target in place — same CDP target id, page count unchanged — so
// nothing leaked, no reaper could see it, and the operator was left with a
// LandPortal page as the browser's only tab.
//
// Identity is tracked by page reference rather than by URL, because a freshly
// created research tab is also about:blank for its first moments. Every
// research-page acquisition consults this and refuses to hand the control page
// out; nothing else is needed to keep it inert.
const controlPages = new WeakSet<PageLike>();

function markControlPage(page: PageLike): void {
  controlPages.add(page);
}

function isControlPage(page: PageLike | null | undefined): boolean {
  return !!page && controlPages.has(page);
}

/**
 * Adopt the browser's lone inert page as the control page.
 *
 * Adoption is NOT a connect-time-only event. The control page is also minted
 * after this module is already attached — the launcher creates it, and
 * `reapOrphanAutomationTabs` creates a replacement whenever closing the last
 * orphan would otherwise take Chrome down with it. A control page adopted only
 * on connect leaves every later replacement unprotected until the next
 * reconnect, which is exactly the window research needs to claim it.
 *
 * Idempotent, and deliberately conservative: with more than one page open there
 * is no way to tell the control page from a live research tab, so nothing is
 * adopted rather than guessing.
 */
async function adoptExistingControlPage(browser: BrowserLike): Promise<boolean> {
  try {
    const pages = await browser.pages();
    if (pages.length !== 1) return false;
    const [only] = pages;
    let url = '';
    try { url = only.url(); } catch { return false; }
    if (url !== 'about:blank') return false;
    markControlPage(only);
    return true;
  } catch {
    return false; // a browser that cannot be listed has no control page to adopt
  }
}

/**
 * Register the automation browser's CURRENT control page as protected.
 *
 * Call this immediately after anything that can create or replace it — the
 * post-run reap most of all, which mints a fresh about:blank at the CDP level
 * where no `PageLike` handle exists for this module to have marked.
 */
export async function adoptAutomationControlPage(): Promise<boolean> {
  if (!state.browser || !safeConnected(state.browser)) return false;
  return adoptExistingControlPage(state.browser);
}

/**
 * Track a short-lived session tab for workflow-scoped cleanup.
 *
 * `fallbackOwner` is the creating driver's own workflow. Reading only the async
 * store left a temp tab with `workflow: null` whenever it was opened from a
 * continuation that had lost the context, and an unowned page is preserved by
 * cleanup rather than closed — so it survived the run that made it.
 */
function trackTempSessionPage(page: PageLike, fallbackOwner: BrowserWorkflowScope | null = null): void {
  const workflow = browserWorkflowContext.getStore() ?? fallbackOwner;
  lanePageRegistry.set(page, { lane: sessionTempLane, workflow });
}

/** Untrack + close a short-lived session tab (used in finally paths). */
async function releaseTempSessionPage(page: PageLike | null): Promise<void> {
  if (!page) return;
  lanePageRegistry.delete(page);
  try { await (page as unknown as { close?: () => Promise<void> }).close?.(); } catch { /* already gone */ }
}

/**
 * Every workflow scope that has been created and not yet cleaned up.
 *
 * Scope-owned cleanup alone left tabs behind: work that runs AFTER a run's
 * cleanup (the post-run visual capture, identity promotion) opens fresh pages,
 * and pages opened by transports that never registered an owner were invisible
 * to it. Two sequential properties therefore grew the tab set from 1 to 6.
 *
 * Counting live scopes lets the LAST run standing sweep everything the browser
 * is still holding, without a concurrent run's live page ever being closed
 * underneath it.
 */
const activeWorkflowScopes = new Set<BrowserWorkflowScope>();

/** Create one opaque ownership boundary for a Deal Intelligence run. */
export function createBrowserWorkflowScope(label: string): BrowserWorkflowScope {
  const scope = Symbol(label);
  activeWorkflowScopes.add(scope);
  return scope;
}

/** Test-only: how many runs currently hold a browser ownership scope. */
export function _activeWorkflowScopeCount(): number { return activeWorkflowScopes.size; }

/**
 * IN-FLIGHT BROWSER WORK, COUNTED PER OWNING SCOPE.
 *
 * A mission joins when its children reach terminal states, but a child can
 * settle while browser work it started is still running. That trailing work
 * then opened a page AFTER the scope was released, so no scoped cleanup could
 * ever match it and the tab survived until a manual reap.
 *
 * The cleanup boundary is therefore driven by the work itself, not by the
 * child rows and not by a timer: a driver increments its owning scope before
 * every browser operation and decrements in a `finally`, so success, failure,
 * timeout and cancellation all release ownership identically.
 */
const scopedBrowserWork = new Map<BrowserWorkflowScope, number>();

function beginScopedBrowserWork(scope: BrowserWorkflowScope | null): void {
  if (!scope) return;
  scopedBrowserWork.set(scope, (scopedBrowserWork.get(scope) ?? 0) + 1);
}

function endScopedBrowserWork(scope: BrowserWorkflowScope | null): void {
  if (!scope) return;
  const next = (scopedBrowserWork.get(scope) ?? 1) - 1;
  if (next <= 0) scopedBrowserWork.delete(scope);
  else scopedBrowserWork.set(scope, next);
}

/** Test-only: browser operations still running under this scope. */
export function _scopedBrowserWorkCount(scope: BrowserWorkflowScope): number {
  return scopedBrowserWork.get(scope) ?? 0;
}

/**
 * Test-only: hold one unit of owned work open, and release it.
 *
 * Real drivers reject instantly without a live session, so the safety-bound
 * branch cannot otherwise be exercised deterministically.
 */
export function _holdScopedBrowserWork(scope: BrowserWorkflowScope): () => void {
  beginScopedBrowserWork(scope);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    endScopedBrowserWork(scope);
  };
}

export interface ScopedBrowserWorkDrain {
  drained: boolean;
  outstanding: number;
  waitedMs: number;
}

/**
 * Wait until every browser operation owned by this scope has settled.
 *
 * Returns as soon as the count reaches zero — the deadline is a safety bound
 * for a driver that never returns, not a pacing device. Callers clean up either
 * way; a scope that could not drain is reported rather than silently ignored.
 */
export async function awaitScopedBrowserWorkDrained(
  scope: BrowserWorkflowScope,
  options: { timeoutMs?: number; pollMs?: number; clockMs?: () => number } = {},
): Promise<ScopedBrowserWorkDrain> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pollMs = options.pollMs ?? 100;
  const clock = options.clockMs ?? (() => Date.now());
  const start = clock();
  for (;;) {
    const outstanding = scopedBrowserWork.get(scope) ?? 0;
    if (outstanding === 0) return { drained: true, outstanding: 0, waitedMs: clock() - start };
    const waitedMs = clock() - start;
    if (waitedMs >= timeoutMs) return { drained: false, outstanding, waitedMs };
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** Run async work inside a browser ownership boundary. AsyncLocalStorage keeps
 * the token attached to every specialist continuation without route globals. */
export function runInBrowserWorkflowScope<T>(scope: BrowserWorkflowScope, run: () => T): T {
  return browserWorkflowContext.run(scope, run);
}

/** Test-only: how many lane pages are currently tracked. */
export function _lanePageCount(): number { return lanePageRegistry.size; }

export interface SessionDeps {
  puppeteer?: PuppeteerLike;
  config?: BrowserSessionConfig;
  now?: () => string;
}

/** Dynamically load puppeteer-core (prod only). Never throws — returns null when
 *  the package is unavailable so the session reports 'unreachable', not a crash. */
async function loadPuppeteer(): Promise<PuppeteerLike | null> {
  try {
    const mod = (await import('puppeteer-core')) as unknown as { connect?: PuppeteerLike['connect']; default?: PuppeteerLike };
    if (typeof mod.connect === 'function') return { connect: mod.connect.bind(mod) };
    if (mod.default && typeof mod.default.connect === 'function') return mod.default;
    return null;
  } catch {
    return null;
  }
}

/**
 * Ensure a live session: REUSE the existing connection if Chrome is still
 * connected, otherwise connect to the operator's persistent Chrome over CDP. This
 * is the heart of "one session reused across leads." Never launches a browser,
 * never stores a credential. Returns the resulting status.
 */
export async function ensureBrowserSession(deps: SessionDeps = {}): Promise<BrowserSessionStatus> {
  const cfg = deps.config ?? readSessionConfig();
  const now = deps.now ?? (() => new Date().toISOString());
  state.cdpUrl = cfg.cdpUrl;
  state.screenshotDir = cfg.screenshotDir;
  state.lastCheckIso = now();
  if (!cfg.enabled) { state.status = 'disabled'; return 'disabled'; }

  // Reuse: if we already hold a live connection, keep it (no reconnect, no relogin).
  if (state.browser && safeConnected(state.browser)) { state.status = 'live'; return 'live'; }

  const pup = deps.puppeteer ?? (await loadPuppeteer());
  if (!pup) { state.status = 'unreachable'; state.browser = null; return 'unreachable'; }
  // Identity gate (real connections only; injected test doubles skip the HTTP
  // probe): if something IS answering on the port but it is not our Google
  // Chrome — Edge, Lenovo Vantage's embedded runtime, an Electron shell — we
  // refuse to attach rather than drive a browser LandOS does not own.
  if (!deps.puppeteer) {
    // OWNERSHIP, not merely browser-type. The old check asked "is a Chrome
    // answering?" and would have attached to the operator's own Chrome the
    // moment it had a debugging port. This asks "is this MY Chrome, on MY
    // profile?" and fails closed when it is not.
    const ownership = await verifyAutomationOwnership(automationBrowserConfig());
    if (!ownership.owned) {
      if (ownership.answering) logger.warn({ reason: ownership.reason }, 'browser_session_refused_unowned_endpoint');
      state.browser = null;
      state.status = 'unreachable';
      return 'unreachable';
    }
  }
  try {
    // protocolTimeout 60s (default 180s): a wedged target/protocol call fails
    // fast and honest instead of freezing a whole mission for three minutes.
    const browser = await pup.connect({ browserURL: cfg.cdpUrl, protocolTimeout: 60_000 });
    await browser.version(); // probe
    state.browser = browser;
    state.workingPage = null; // a fresh working tab is acquired lazily
    lanePageRegistry.clear(); // page handles from a previous connection are dead
    // The launcher's inert page is infrastructure — claim it before any lane can.
    await adoptExistingControlPage(browser);
    state.connectedAtIso = now();
    state.status = 'live';
    return 'live';
  } catch {
    state.browser = null;
    state.status = 'unreachable';
    return 'unreachable';
  }
}

function safeConnected(b: BrowserLike): boolean {
  try { return b.isConnected(); } catch { return false; }
}

// ─────────────────────────────────────────────────────────────────────────
// CDP endpoint identity — never attach to a foreign browser runtime
// ─────────────────────────────────────────────────────────────────────────

export interface CdpEndpointIdentity {
  ok: boolean;
  answering: boolean;
  browser: string;
  userAgent: string;
  reason: string | null;
}

/**
 * Classify a CDP /json/version payload. Only genuine Google Chrome passes.
 * Edge, Electron shells, and embedded third-party runtimes (e.g. Lenovo
 * Vantage's browser, which squats on 127.0.0.1:9222) are rejected so LandOS
 * never drives — or leaks token-bearing pages into — a browser it does not own.
 */
export function classifyCdpVersionInfo(info: Record<string, unknown> | null | undefined): CdpEndpointIdentity {
  const browser = String(info?.Browser ?? '').trim();
  const userAgent = String(info?.['User-Agent'] ?? '').trim();
  const combined = `${browser} ${userAgent}`;
  if (!browser && !userAgent) {
    return { ok: false, answering: true, browser, userAgent, reason: 'CDP endpoint returned no browser identity.' };
  }
  if (/LenovoVantage|Electron|Teams|WebView2|Edg(e|A|iOS)?\//i.test(combined) || /^Edg/i.test(browser)) {
    return { ok: false, answering: true, browser, userAgent, reason: `CDP endpoint is a foreign/Edge runtime (${browser || userAgent}); LandOS attaches only to its own Google Chrome.` };
  }
  if (!/^(Headless)?Chrome\//.test(browser)) {
    return { ok: false, answering: true, browser, userAgent, reason: `CDP endpoint is not Google Chrome (${browser || 'unknown browser'}).` };
  }
  return { ok: true, answering: true, browser, userAgent, reason: null };
}

/** Probe a CDP endpoint's /json/version and verify it is genuine Chrome. */
export async function verifyChromeCdpEndpoint(
  cdpUrl: string,
  fetchImpl: (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }> = fetch,
): Promise<CdpEndpointIdentity> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const base = cdpUrl.replace(/\/+$/, '');
    const response = await fetchImpl(`${base}/json/version`, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, answering: false, browser: '', userAgent: '', reason: 'CDP endpoint is not answering /json/version.' };
    }
    return classifyCdpVersionInfo(await response.json() as Record<string, unknown>);
  } catch {
    return { ok: false, answering: false, browser: '', userAgent: '', reason: 'CDP endpoint is not answering.' };
  } finally {
    clearTimeout(timer);
  }
}

/** Acquire (and cache) one dedicated LandOS working tab. Do not attach to an
 * arbitrary existing Chrome page: a heavy or stale target can hang CDP target
 * setup before the provider workflow begins. The fresh tab is created once per
 * managed session and then reused across leads; operator tabs are never closed. */
async function getWorkingPage(): Promise<PageLike> {
  if (!state.browser) throw new Error('No live browser session.');
  // The control page is never a working surface. Drop it and allocate.
  if (isControlPage(state.workingPage)) state.workingPage = null;
  if (state.workingPage) return state.workingPage;
  // BACKGROUND BY DEFAULT. This tab is acquired during NORMAL RESEARCH — the
  // LandPortal auth check (`ensureLandPortalAuthenticated`) is on the New Lead
  // path — and `newPage()` activates the tab and raises its window. That was a
  // real foregrounding on the research route, once per managed session.
  // `openLandPortalInSession` re-activates it deliberately, because THAT one is
  // the operator asking to see LandPortal so they can log in.
  state.workingPage = await openResearchTab(state.browser);
  return state.workingPage;
}

export interface BrowserSessionHealth {
  healthy: boolean;
  status: BrowserSessionStatus;
  cdpUrl: string;
  connectedAtIso: string | null;
  lastCheckIso: string | null;
  screenshotDir: string;
  /** LandPortal auth (null = not checked this session). Never a cookie/token. */
  landportalAuthenticated: boolean | null;
  landportalAuthCheckedIso: string | null;
  note: string;
}

/** Session health — for the status endpoint. Never returns cookies/tokens. */
export async function browserSessionHealth(deps: SessionDeps = {}): Promise<BrowserSessionHealth> {
  const status = await ensureBrowserSession(deps);
  const note = {
    live: 'Connected to the persistent Chrome session (reused across leads).',
    disabled: 'Live browser execution is disabled. Set BROWSER_INTEL_LIVE=1 and Start Browser Intelligence.',
    unreachable: 'No reachable Chrome on the CDP endpoint. Click Start Browser Intelligence to launch the LandOS Chrome profile.',
    auth_needed: 'Connected, but LandPortal needs a manual login once. Click Open LandPortal, sign in, then Refresh Status.',
  }[status];
  return {
    healthy: status === 'live', status, cdpUrl: state.cdpUrl,
    connectedAtIso: state.connectedAtIso, lastCheckIso: state.lastCheckIso, screenshotDir: state.screenshotDir,
    landportalAuthenticated: state.auth.authenticated, landportalAuthCheckedIso: state.auth.atIso,
    note,
  };
}

export function browserSessionStatus(): BrowserSessionStatus { return state.status; }

/**
 * The connected browser, for transports that must create their OWN target.
 *
 * The shared working page cannot serve every caller: opening a page through
 * `newPage()` activates it, and a lane that reads dozens of government portals
 * would yank the operator's Chrome away each time. Such a caller needs the
 * browser handle so it can create a BACKGROUND target instead
 * (`Target.createTarget` with `background: true`), which never activates.
 *
 * Returns null unless a session is live. Callers must still close what they
 * open — this hands out no lifecycle management.
 */
export function sessionBrowser(): BrowserLike | null {
  return state.status === 'live' ? state.browser : null;
}

/**
 * True only when THIS process spawned the offscreen background window. Callers
 * outside this module use it to gate tab activation the same way the capture
 * path does: an invisible window may be activated, a visible one never raised.
 */
export function browserSpawnedInBackground(): boolean { return state.launchedBackground; }

/**
 * Lend the single persistent working tab to a read-only routine (e.g. a Browser
 * Playbook that must drive a multi-step page it can't express through the generic
 * BrowserDriver primitives). Ensures the session is live first; if it is not, the
 * routine is NOT run and { ok:false, status } is returned so the caller can report
 * an honest blocker. The routine must stay read-only (navigate / read / expand /
 * screenshot) — never a paid, write, or billing action. Never returns cookies.
 */
export async function withWorkingPage<T>(
  fn: (page: PageLike) => Promise<T>,
  deps: SessionDeps = {},
): Promise<{ ok: boolean; status: BrowserSessionStatus; value?: T }> {
  // The shared working tab is browser work too. It is opened outside the lane
  // drivers, so without this bracket a run could clean up while a working-page
  // consumer was still going and the tab it then opened would outlive the run.
  const owner = browserWorkflowContext.getStore() ?? null;
  const lend = async (): Promise<{ ok: boolean; status: BrowserSessionStatus; value?: T }> => {
    beginScopedBrowserWork(owner);
    try {
      const status = await ensureBrowserSession(deps);
      if (status !== 'live' && status !== 'auth_needed') return { ok: false, status };
      const page = await getWorkingPage();
      const value = await fn(page);
      return { ok: true, status, value };
    } finally {
      endScopedBrowserWork(owner);
    }
  };
  const run = workingPageGate.then(lend, lend);
  workingPageGate = run.then(() => undefined, () => undefined);
  return run;
}

/** Discard the shared working tab so the next workflow gets a FRESH one.
 *  Used after a watchdog timeout: a page wedged by a provider render storm
 *  can hang CDP calls indefinitely, and reusing that tab poisons every
 *  subsequent run. Also clears a stuck lending gate. */
export function resetWorkingPage(): void {
  const page = state.workingPage as unknown as { close?: () => Promise<void> } | null;
  state.workingPage = null;
  workingPageGate = Promise.resolve();
  landportalCaptureGate = Promise.resolve();
  landportalAuthGate = Promise.resolve();
  if (page?.close) void page.close().catch(() => { /* already gone */ });
}

export interface SessionPageCleanup {
  /** Pages open in the connected browser before cleanup ran. */
  before: number;
  /** Pages still open afterwards. */
  after: number;
  closed: number;
  /** Stated whenever cleanup could not run, so a skipped cleanup is never
   *  reported as a clean one. */
  note: string;
}

/**
 * Close pages a workflow opened, leaving the operator's own tabs alone.
 *
 * The persistent Chrome belongs to the operator, so this NEVER closes the
 * browser and never closes the first tab or the shared working tab. It closes
 * only the surplus pages a research run left behind, which is what stops a long
 * mission from accumulating dead parcel/comp tabs across re-runs.
 *
 * Reports honestly when there was no live session to clean.
 */
export async function closeSurplusSessionPages(
  scope: BrowserWorkflowScope | undefined = browserWorkflowContext.getStore(),
): Promise<SessionPageCleanup> {
  // RELEASE THE SCOPE ON EVERY PATH. The scope is registered at run start and
  // used to be released only on the one path that reached the final sweep — so
  // a run that finished with no connected browser (the common case when no lane
  // needed one), or whose page listing threw, leaked its scope forever.
  // `activeWorkflowScopes` could then never return to empty, which disables the
  // final sweep for the REST OF THE PROCESS: pages opened after a run's own
  // cleanup boundary survive, accumulating run over run until a restart. A
  // leaked token must never be able to disarm the sweep, so release is
  // unconditional and happens even when this function throws.
  try {
  const browser = state.browser;
  if (!browser || !browser.isConnected()) {
    return { before: 0, after: 0, closed: 0, note: 'No live browser session was connected, so no workflow page needed closing.' };
  }
  let pages: PageLike[];
  try {
    pages = await browser.pages();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { before: 0, after: 0, closed: 0, note: `The browser session could not be inspected (${message}), so page cleanup was NOT performed.` };
  }
  // No ownership token means there is no safe deletion target. Timing, tab
  // position and URL cannot distinguish an operator page or another Deal's
  // concurrent page, so global cleanup fails closed.
  if (!scope) {
    return {
      before: pages.length,
      after: pages.length,
      closed: 0,
      note: `No browser workflow ownership scope was supplied; all ${pages.length} page(s) were preserved.`,
    };
  }
  let closed = 0;
  for (const page of pages) {
    if (lanePageRegistry.get(page)?.workflow !== scope) continue;
    const closable = page as unknown as { close?: () => Promise<void> };
    if (typeof closable.close !== 'function') continue;
    try { await closable.close(); closed += 1; lanePageRegistry.delete(page); } catch { /* already gone */ }
  }

  // RELEASE THE CACHED LANDPORTAL WORKING TAB. It used to be held open across
  // leads, which left a landportal.com tab sitting in the browser after every
  // run. Nothing is lost by closing it: LandPortal authentication lives in the
  // persistent profile on disk, not in an open tab, so the next run re-opens a
  // fresh tab and is still signed in. The control page keeps Chrome alive.
  if (state.workingPage && !isControlPage(state.workingPage)) {
    const working = state.workingPage as unknown as { close?: () => Promise<void> };
    if (typeof working.close === 'function') {
      try { await working.close(); closed += 1; } catch { /* already gone */ }
    }
    lanePageRegistry.delete(state.workingPage);
    state.workingPage = null;
  } else if (state.workingPage) {
    // The control page must never have become the working tab; release the
    // reference without closing the process-keeper.
    state.workingPage = null;
  }

  // FINAL SWEEP. When this was the last run holding a scope, nothing else can
  // legitimately still own a page, so everything except the inert control page
  // is closed. Without this, pages opened after a run's own cleanup — the
  // post-run visual capture, and transports that never registered an owner —
  // survived indefinitely and accumulated run over run.
  activeWorkflowScopes.delete(scope);
  if (activeWorkflowScopes.size === 0) {
    let remaining: PageLike[] = [];
    try { remaining = await browser.pages(); } catch { remaining = []; }
    // Chrome exits with its last page, so exactly one is RETAINED rather than
    // closed-and-reopened: retaining avoids creating a page at all, and page
    // creation is itself an activation that this module must never perform.
    // An inert about:blank keeps the browser (and its authenticated profile)
    // alive and holds no site state.
    // RETAIN THE INERT CONTROL PAGE, NOT WHICHEVER TAB HAPPENS TO BE FIRST.
    //
    // This used to keep `remaining[0]` and blank it. When a research tab sorted
    // first, the real about:blank control page was closed as surplus and the
    // research tab became the survivor — and if blanking it then failed (a
    // heavy SPA can outlast the 5s navigation), the operator was left with a
    // LandPortal property page as the browser's only tab. Preferring an
    // existing about:blank keeps the control page inert and lets every
    // property-specific tab close.
    const urlOf = (page: PageLike): string => {
      try { return page.url(); } catch { return ''; }
    };
    const controlPage = remaining.find((page) => urlOf(page) === 'about:blank') ?? remaining[0];
    let kept = false;
    for (const page of remaining) {
      const url = urlOf(page);
      if (!kept && page === controlPage) {
        kept = true;
        if (url && url !== 'about:blank') {
          try { await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 5_000 }); } catch { /* inert either way */ }
        }
        lanePageRegistry.delete(page);
        // From here on this page is infrastructure: acquisition refuses it, so
        // no later research navigation can land on the control target.
        markControlPage(page);
        continue;
      }
      const closable = page as unknown as { close?: () => Promise<void> };
      if (typeof closable.close !== 'function') continue;
      try { await closable.close(); closed += 1; lanePageRegistry.delete(page); } catch { /* already gone */ }
    }
  }

  let after = pages.length - closed;
  try { after = (await browser.pages()).length; } catch { /* keep the computed count */ }
  return {
    before: pages.length,
    after,
    closed,
    note: closed === 0
      ? `No page owned by this browser workflow was open; all ${after} other page(s) were preserved.`
      : `Closed ${closed} page(s) owned by this browser workflow; ${after} operator or other-workflow page(s) were left untouched. The browser itself was never closed.`,
  };
  } finally {
    if (scope) activeWorkflowScopes.delete(scope);
  }
}

/** Disconnect (NOT close) — the operator's browser stays open all day. */
export async function disconnectBrowserSession(): Promise<void> {
  try { if (state.browser) await state.browser.disconnect(); } catch { /* ignore */ }
  state.browser = null;
  state.workingPage = null;
  lanePageRegistry.clear();
  if (state.status === 'live') state.status = 'unreachable';
}

/** Test-only: reset the singleton between tests. */
export function _resetBrowserSession(): void {
  state.browser = null; state.workingPage = null; state.status = 'disabled'; state.cdpUrl = '';
  state.connectedAtIso = null; state.auth = { authenticated: null, atIso: null }; state.lastCheckIso = null; state.screenshotDir = '';
  state.launchedBackground = false;
  workingPageGate = Promise.resolve();
  landportalCaptureGate = Promise.resolve();
  landportalAuthGate = Promise.resolve();
  lanePageRegistry.clear();
}

// ─────────────────────────────────────────────────────────────────────────
// Operator flow: launch Chrome (NOT Edge) + connect + open LandPortal
// ─────────────────────────────────────────────────────────────────────────

/** Injectable process spawn (tests pass a no-op; prod uses child_process). */
export type SpawnLike = (cmd: string, args: string[]) => void;

const defaultSpawn: SpawnLike = (cmd, args) => {
  // ESM import (this module is ESM; `require` is undefined at runtime).
  // detached + unref + ignored stdio → Chrome keeps running after this returns.
  const child = nodeSpawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.unref();
};

/** Resolve the Google Chrome executable. Edge is never considered. Returns the
 *  first existing candidate (configured path wins) + the list that was checked. */
export function resolveChromePath(configured?: string): { path: string | null; checked: string[] } {
  const checked = [configured, ...CHROME_CANDIDATE_PATHS].filter((x): x is string => !!x);
  for (const c of checked) {
    try { if (fs.existsSync(c)) return { path: c, checked }; } catch { /* ignore */ }
  }
  return { path: null, checked };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface StartSessionDeps extends SessionDeps {
  spawn?: SpawnLike;
  /** Connect-poll attempts after launch (tests set small). */
  maxPolls?: number;
  pollMs?: number;
}

export interface StartSessionResult {
  status: BrowserSessionStatus;
  /** True when this call launched Chrome; false when an existing session was reused. */
  launched: boolean;
  reused: boolean;
  /** The Chrome executable used, when launched. */
  chromePath: string | null;
  profileDir: string;
  /** Set when Chrome could not be found / launched. */
  error: string | null;
  health: BrowserSessionHealth;
}

/**
 * Start Browser Intelligence: reuse the persistent Chrome session if it is already
 * answering on the CDP port; otherwise launch GOOGLE CHROME (never Edge) with the
 * dedicated LandOS profile + remote debugging, then connect. One profile, reused
 * across leads — never a new profile or login per property. Never stores a
 * credential; the spawn is injectable so tests/builds never launch a browser.
 */
export async function startBrowserSession(deps: StartSessionDeps = {}): Promise<StartSessionResult> {
  const cfg = deps.config ?? readSessionConfig();
  const health0 = (): Promise<BrowserSessionHealth> => browserSessionHealth({ ...deps });
  if (!cfg.enabled) {
    return { status: 'disabled', launched: false, reused: false, chromePath: null, profileDir: cfg.profileDir, error: 'Live mode disabled — set BROWSER_INTEL_LIVE=1 and restart LandOS.', health: await health0() };
  }
  // Already reachable → reuse, do not launch a second Chrome.
  const pre = await ensureBrowserSession(deps);
  if (pre === 'live' || pre === 'auth_needed') {
    return { status: pre, launched: false, reused: true, chromePath: null, profileDir: cfg.profileDir, error: null, health: await health0() };
  }
  // THE ONLY LAUNCH PATH. This module no longer spawns Chrome itself: the
  // automation-browser owner does, always offscreen, always on the owned
  // profile and port, and it refuses to attach to anything it cannot prove it
  // owns. There is deliberately no foreground variant of this launch — a
  // research run must never be able to put a window on the operator's screen.
  let launchAttempted = false;
  const owned = await launchAutomationBrowser({
    // Honour an injected session config (tests) by projecting it onto the owner's
    // shape, so the launch still goes through the single owned code path.
    config: {
      endpoint: cfg.cdpUrl,
      port: Number(cfg.cdpUrl.match(/:(\d+)/)?.[1] ?? automationBrowserConfig().port),
      profileDir: cfg.profileDir,
      chromePath: cfg.chromePath ?? automationBrowserConfig().chromePath,
      chromeChecked: [],
    },
    spawn: deps.spawn ? (cmd: string, args: string[]) => { launchAttempted = true; deps.spawn!(cmd, args); return {}; } : undefined,
    // With an injected puppeteer there is no real browser to interrogate, so
    // ownership is asserted by the injected connection instead of the OS.
    verifyOwnership: deps.puppeteer
      ? async () => ({ owned: launchAttempted, answering: launchAttempted, pid: null, browser: 'injected', reason: launchAttempted ? null : 'not launched' })
      : undefined,
  });
  if (owned.error) {
    return {
      status: 'unreachable', launched: false, reused: false, chromePath: owned.chromePath, profileDir: owned.profileDir,
      error: owned.error, health: await health0(),
    };
  }
  state.launchedBackground = true;
  const chrome = { path: owned.chromePath };
  // Poll for the CDP endpoint to come up, then connect.
  const maxPolls = deps.maxPolls ?? 20;
  const pollMs = deps.pollMs ?? 500;
  let status: BrowserSessionStatus = 'unreachable';
  for (let i = 0; i < maxPolls; i++) {
    status = await ensureBrowserSession(deps);
    if (status === 'live' || status === 'auth_needed') break;
    await sleep(pollMs);
  }
  return {
    status, launched: true, reused: false, chromePath: chrome.path, profileDir: cfg.profileDir,
    error: status === 'live' || status === 'auth_needed' ? null : 'Chrome launched but the debugging port is not answering yet — click Refresh Status in a moment.',
    health: await health0(),
  };
}

export interface OpenLandPortalResult {
  connected: boolean;
  authenticated: boolean;
  status: BrowserSessionStatus;
  url: string | null;
  note: string;
  health: BrowserSessionHealth;
}

/**
 * Open LandPortal in the persistent session so the operator can log in once, and
 * detect whether the session is authenticated. Read-only navigation only. After a
 * manual login, calling this again (Refresh) detects authentication.
 */
export async function openLandPortalInSession(deps: SessionDeps = {}): Promise<OpenLandPortalResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const status = await ensureBrowserSession(deps);
  if (status !== 'live' && status !== 'auth_needed') {
    return { connected: false, authenticated: false, status, url: null, note: 'No live Chrome session — click Start Browser Intelligence first.', health: await browserSessionHealth(deps) };
  }
  const page = await getWorkingPage();
  await page.goto(LANDPORTAL_SESSION_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  // The ONE deliberate activation in this module: the operator pressed "Open
  // LandPortal" specifically to see it and log in. Research never reaches here.
  try { await (page as unknown as { bringToFront?: () => Promise<void> }).bringToFront?.(); } catch { /* best-effort */ }
  const read = await readPage(page);
  const authenticated = !read.loginLike;
  state.auth = { authenticated, atIso: now() };
  state.status = authenticated ? 'live' : 'auth_needed';
  return {
    connected: true, authenticated, status: state.status, url: page.url(),
    note: authenticated ? 'LandPortal session is authenticated and ready.' : 'Log into LandPortal in the opened Chrome tab, then click Refresh Status.',
    health: await browserSessionHealth(deps),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// AUTOMATIC readiness: start the session AND log into LandPortal from env
// credentials — so the operator never starts the browser or logs in by hand.
// Credentials are read from env/.env, passed to the browser ONLY to type into
// the login form, and NEVER printed, logged, returned, or screenshotted.
// ─────────────────────────────────────────────────────────────────────────

export type LandPortalPhase =
  | 'session_unavailable'  // browser could not be started/connected
  | 'browser_live'         // connected but LandPortal auth unknown/not yet done
  | 'logging_in'           // a login attempt was made this call
  | 'authenticated'        // LandPortal is signed in and ready
  | 'auth_failed'          // login attempted but did not authenticate (see reason)
  | 'no_credentials';      // env credentials are missing (see missingEnv)

export interface LandPortalReadiness {
  phase: LandPortalPhase;
  ready: boolean;
  sessionStatus: BrowserSessionStatus;
  authenticated: boolean;
  /** Exact technical cause when phase is auth_failed / session_unavailable. */
  reason: string | null;
  /** Credential env var NAMES that are missing (never values). */
  missingEnv: string[];
  /** Whether a login was attempted this call (for the "logging in" UI state). */
  attempted: boolean;
  note: string;
}

export interface LandPortalCreds { email: string; password: string }

/** Read LandPortal login creds from the shell env or the .env FILE. Returns the
 *  present creds and the NAMES of any missing vars — never the values. */
export function readLandPortalCreds(env?: Record<string, string | undefined>): { creds: LandPortalCreds | null; missing: string[] } {
  const proc = env ?? process.env;
  let fileVals: Record<string, string> = {};
  if (!env) { try { fileVals = readEnvFile([LANDPORTAL_CRED_ENV.email, LANDPORTAL_CRED_ENV.password]); } catch { fileVals = {}; } }
  const get = (k: string) => (proc[k] ?? fileVals[k] ?? '').trim();
  const email = get(LANDPORTAL_CRED_ENV.email);
  const password = get(LANDPORTAL_CRED_ENV.password);
  const missing: string[] = [];
  if (!email) missing.push(LANDPORTAL_CRED_ENV.email);
  if (!password) missing.push(LANDPORTAL_CRED_ENV.password);
  return { creds: missing.length ? null : { email, password }, missing };
}

export interface EnsureReadyDeps extends SessionDeps {
  spawn?: SpawnLike;
  maxPolls?: number;
  pollMs?: number;
  /** Injectable credential reader (tests). */
  readCreds?: () => { creds: LandPortalCreds | null; missing: string[] };
  /** Injectable landportal URL (tests). */
  landportalUrl?: string;
  /** Post-login settle delay before re-checking auth (default 4500ms; tests small). */
  settleMs?: number;
}

/**
 * Ensure a live browser session exists — reuse it if connected, otherwise LAUNCH
 * the dedicated LandOS Chrome (never Tyler's normal Chrome) and connect. The
 * operator never clicks Start. Returns the resulting status + whether we launched.
 */
export async function ensureBrowserSessionReady(deps: EnsureReadyDeps = {}): Promise<{ status: BrowserSessionStatus; started: boolean; error: string | null }> {
  const status = await ensureBrowserSession(deps);
  if (status === 'live' || status === 'auth_needed') return { status, started: false, error: null };
  const start = await startBrowserSession(deps);
  return { status: start.status, started: start.launched, error: start.error };
}

/**
 * Open a lane tab WITHOUT activating it.
 *
 * `browser.newPage()` is `Target.createTarget` with `background` unset, which
 * Chrome treats as "focus this" — it selects the tab and raises the window over
 * whatever the operator has in front of them. Passing `background: true` gives
 * the same tab, the same `Page` object and the same capabilities, minus the
 * interruption.
 *
 * Returns null when the CDP route is unavailable (a test fake, an older
 * protocol, a disconnected session) so the caller falls back to `newPage()`
 * rather than failing the lane. Opening the tab is never worth losing the run.
 */
/**
 * Keeps a research tab from ever becoming TWO tabs.
 *
 * WHY DOCUMENT-START. A tab the PAGE opens is not ours to create, so
 * `Target.createTarget({background:true})` cannot apply to it, and Chrome always
 * activates a page-opened target — that is what put LandPortal over the
 * operator's work. A CDP trace proved it: the comps target carried
 * `openerId` = our lane page and was the only one that ever became active.
 *
 * Neutralising `window.open` at CLICK time was not enough, because a bundle
 * that captured `window.open` at load time keeps calling the original. This
 * runs before any of the page's own scripts, on every document, so the
 * reference the site captures IS this one.
 *
 * It changes only WHERE a navigation lands — never what is clicked, requested
 * or read. Same-tab is also what the comps code already assumed: it screenshots
 * and scrapes the very page it clicked from.
 */
export const SUPPRESS_POPUPS_JS = `(() => {
  try {
    // A stub for callers that do \`var w = window.open(...); w.focus()\`. It
    // NEVER navigates: not the new tab (there isn't one) and not this tab.
    // Navigating here is what sent the lane into LandPortal's heavy comps SPA
    // and pushed the run past its budget.
    var stub = function () {
      var loc = { href: '', assign: function () {}, replace: function () {}, reload: function () {} };
      return {
        closed: true, opener: null, location: loc,
        focus: function () {}, blur: function () {}, close: function () {}, postMessage: function () {},
        document: { write: function () {}, writeln: function () {}, close: function () {} },
      };
    };
    window.open = function () { return stub(); };
    // A target=_blank anchor would spawn the same tab without window.open.
    // Cancel only the DEFAULT action, in the CAPTURE phase so it lands before
    // the site's handlers, and do NOT rewrite the anchor's target: retargeting
    // to _self merely moves the navigation into this tab instead of stopping it.
    // Propagation is left alone so the page's own click handlers still run.
    document.addEventListener('click', function (event) {
      var node = event.target;
      while (node && node.nodeType === 1) {
        if (String(node.tagName).toLowerCase() === 'a') {
          var target = '';
          try { target = String(node.target || ''); } catch (e) { target = ''; }
          if (target && target !== '_self') { try { event.preventDefault(); } catch (e) { /* not cancelable */ } }
          break;
        }
        node = node.parentNode;
      }
    }, true);
  } catch (e) { /* a page that blocks this is no worse than before */ }
})()`;

/** Install the suppressor before the tab loads anything. Best-effort by design. */
async function suppressPopups(page: PageLike): Promise<void> {
  try { await page.evaluateOnNewDocument?.(SUPPRESS_POPUPS_JS); } catch { /* older page API */ }
}

/**
 * The ONE way a research tab is opened: background target first, `newPage()`
 * only when the CDP route is unavailable, popup suppression either way.
 *
 * The fallback still activates the tab — that is Chrome's behaviour for
 * `newPage()` and there is no way around it — but it cannot then spawn a
 * SECOND, page-opened tab on top.
 */
async function openResearchTab(browser: BrowserLike): Promise<PageLike> {
  const background = await openBackgroundTab(browser);
  // A newly created tab is never the control page; asserting it here keeps the
  // guarantee at the one place every research page is born.
  if (background && !isControlPage(background)) return background;
  const page = await browser.newPage();
  await suppressPopups(page);
  return page;
}

async function openBackgroundTab(browser: BrowserLike): Promise<PageLike | null> {
  const cdpCapable = browser as unknown as {
    target?(): { createCDPSession(): Promise<{ send(m: string, p: unknown): Promise<{ targetId: string }>; detach(): Promise<void> }> };
    waitForTarget?(
      predicate: (t: { url(): string; _targetId?: string }) => boolean,
      options?: { timeout?: number },
    ): Promise<{ page(): Promise<PageLike | null> }>;
  };
  if (typeof cdpCapable.target !== 'function' || typeof cdpCapable.waitForTarget !== 'function') return null;
  let cdp: { send(m: string, p: unknown): Promise<{ targetId: string }>; detach(): Promise<void> } | null = null;
  try {
    cdp = await cdpCapable.target().createCDPSession();
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', background: true });
    const target = await cdpCapable.waitForTarget!(
      (t) => t._targetId === targetId,
      { timeout: 10_000 },
    );
    const page = (await target.page()) ?? null;
    // Installed on the fresh about:blank, so it is in place before the tab
    // navigates anywhere and before any site script can capture window.open.
    if (page) await suppressPopups(page);
    return page;
  } catch {
    return null;
  } finally {
    if (cdp) { try { await cdp.detach(); } catch { /* session already gone */ } }
  }
}

/* ── RESULT / SUGGESTION CANDIDATE COLLECTOR ─────────────────────────────────
 *
 * ONE source of truth, shared by `readCandidates` and `clickCandidate`. They
 * previously held two hand-copied selector nets that had to stay identical by
 * discipline; they are now literally the same string, so the index a caller
 * reads is always the element that gets clicked.
 *
 * ROOT CAUSE THIS REPLACES: the broad net below also matches a SITE'S OWN
 * navigation. On LandPortal the tabs "Map Search" and "Market research" matched
 * it and, being higher in the document, occupied indexes 0 and 1 — so "select
 * the TOP suggestion" clicked a nav tab and opened Map Search while the real
 * top suggestion sat unread at index 2. The address then failed to match and
 * the run stopped with "no confident match".
 *
 * The fix is an order of authority, narrowest evidence first:
 *
 *   1. THE OPEN SUGGESTION LIST. A typeahead is defined structurally — a
 *      visible list attached directly beneath the search input and overlapping
 *      it horizontally. That is what a suggestion dropdown IS on any site, so
 *      it holds without knowing a single vendor class name. When one is open,
 *      its children ARE the candidates, in DOM order: index 0 is the top
 *      suggestion, by construction.
 *   2. EXPLICIT OPTION ROLES. `[role=option]` and named autocomplete markup.
 *   3. THE GENERIC RESULT NET, unchanged — but now with navigation, header,
 *      tablist and sidebar chrome excluded, because a menu item was never a
 *      search result.
 *
 * Only step 3 guesses. Steps 1 and 2 are exact, so when the page tells us
 * plainly what its options are, nothing is inferred.
 */
const CANDIDATE_COLLECTOR_JS = `(() => {
  var OPTION_SEL = '[role=option],[role=listbox] li,[class*="autocomplete" i] li,[class*="autocomplete" i] [class*="item" i],[class*="suggestion" i],[class*="typeahead" i] li,[class*="dropdown-menu" i] li,[class*="prediction" i] li';
  var BROAD_SEL = '.leaflet-popup-content,[class*="popup" i],[class*="result" i] li,[class*="result" i] tr,[class*="results" i] [class*="card" i],[class*="results" i] [class*="row" i],[class*="result-item" i],[class*="parcel" i],[class*="feature" i] li,[role=row],[class*="list" i] li,table tbody tr,[class*="card" i],[role=option],[class*="autocomplete" i] li,[class*="autocomplete" i] [class*="item" i],[class*="suggestion" i],[class*="typeahead" i] li,[class*="search-result" i],[class*="dropdown-menu" i] li,li[class*="search" i],li[class*="variant" i]';
  var CHROME_SEL = 'nav,header,footer,[role=navigation],[role=menubar],[role=tablist],[class*="navbar" i],[class*="nav-bar" i],[class*="sidebar" i],[class*="topbar" i],[class*="breadcrumb" i],[class*="site-header" i],[class*="app-header" i]';
  var box = function (el) { return el && el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; };
  var vis = function (el) { var r = box(el); return !!(r.width && r.height); };
  var txt = function (el) { return ((el && el.textContent) || '').replace(/\\s+/g, ' ').trim(); };
  var usable = function (t) { return t.length >= 3 && t.length <= 220; };

  // The input the address was typed into: the focused one, else the only one
  // holding a value, else the first visible search box.
  var inputs = Array.prototype.slice.call(document.querySelectorAll('input[type=text],input[type=search],input:not([type])')).filter(vis);
  var input = null;
  for (var a = 0; a < inputs.length; a++) { if (inputs[a] === document.activeElement) { input = inputs[a]; break; } }
  if (!input) { for (var b = 0; b < inputs.length; b++) { if (((inputs[b].value || '') + '').trim()) { input = inputs[b]; break; } } }
  if (!input) input = inputs[0] || null;

  // Step 1 — the dropdown physically attached to that input.
  var suggestionItems = [];
  if (input) {
    var ir = box(input);
    var lists = document.querySelectorAll('ul,ol,[role=listbox],[class*="dropdown" i],[class*="autocomplete" i],[class*="suggestion" i],[class*="typeahead" i],[class*="prediction" i]');
    var topMost = null;
    for (var i = 0; i < lists.length; i++) {
      var list = lists[i];
      if (!vis(list)) continue;
      var r = box(list);
      // Attached: starts at the input's lower edge, within a small gap.
      if (!(r.top >= ir.bottom - 12 && r.top <= ir.bottom + 24)) continue;
      // Aligned: overlaps the input horizontally.
      if (!(r.left < ir.right && r.right > ir.left)) continue;
      var kids = Array.prototype.slice.call(list.children).filter(function (c) { return vis(c) && usable(txt(c)); });
      if (!kids.length) continue;
      if (!topMost || r.top < box(topMost.list).top) topMost = { list: list, kids: kids };
    }
    if (topMost) suggestionItems = topMost.kids;
  }

  var collect = function (els, skipChrome) {
    var seen = []; var out = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (seen.indexOf(el) >= 0) continue; seen.push(el);
      if (!vis(el)) continue;
      if (skipChrome && el.closest && el.closest(CHROME_SEL)) continue;
      var t = txt(el);
      if (!usable(t)) continue;
      out.push({ el: el, text: t });
    }
    return out;
  };

  var found = collect(suggestionItems, false);
  if (!found.length) found = collect(Array.prototype.slice.call(document.querySelectorAll(OPTION_SEL)), false);
  if (!found.length) found = collect(Array.prototype.slice.call(document.querySelectorAll(BROAD_SEL)), true);

  var byText = []; var picked = [];
  for (var k = 0; k < found.length; k++) {
    if (byText.indexOf(found[k].text) >= 0) continue;
    byText.push(found[k].text);
    picked.push(found[k]);
  }
  return picked.slice(0, 40);
})()`;

/** The clickable target inside a candidate, and where it is on screen. */
interface CandidateBox { x: number; y: number; inViewport: boolean; text: string }

/**
 * Prefer a checkbox/radio inside the option (LandPortal's APN autocomplete
 * renders each matching parcel as a selectable checkbox row that must be ticked
 * before submitting), then an anchor/button, else the element itself.
 */
const CLICK_TARGET_JS = `(function (el) {
  if (!el) return null;
  var t = (el.matches && el.matches('a,button,[role=button],[onclick],input[type=checkbox],input[type=radio]'))
    ? el
    : (el.querySelector && el.querySelector('input[type=checkbox],input[type=radio],a[href],button,[role=button],[onclick]')) || el;
  return t;
})`;

const READ_CANDIDATES_JS = `(() => {
  var found = ${CANDIDATE_COLLECTOR_JS};
  var kindOf = function (el) {
    var c = (el.className && el.className.toString ? el.className.toString() : '').toLowerCase();
    var tag = (el.tagName || '').toLowerCase();
    if (/popup/.test(c)) return 'popup';
    if (/card/.test(c)) return 'card';
    if (tag === 'tr' || /row/.test(c)) return 'row';
    if (tag === 'li') return 'row';
    if (tag === 'button') return 'button';
    return 'element';
  };
  return found.map(function (o, i) { return { index: i, text: o.text, kind: kindOf(o.el) }; });
})()`;

/** Scroll the chosen candidate into view and report its centre for a real click. */
function locateCandidateJs(index: number): string {
  const target = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  return `(() => {
    var found = ${CANDIDATE_COLLECTOR_JS};
    var entry = found[${target}];
    if (!entry) return null;
    var el = ${CLICK_TARGET_JS}(entry.el);
    if (!el) return null;
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    var r = el.getBoundingClientRect();
    var vw = window.innerWidth || 0, vh = window.innerHeight || 0;
    var x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    return {
      x: x, y: y,
      inViewport: r.width > 0 && r.height > 0 && x > 0 && y > 0 && x < vw && y < vh,
      text: entry.text,
    };
  })()`;
}

/**
 * The DOM-click fallback. Skipped entirely when a real mouse click already
 * navigated the page — re-clicking a stale element then would be a second,
 * unintended interaction.
 */
function clickCandidateJs(index: number): string {
  const target = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  return `(() => {
    var found = ${CANDIDATE_COLLECTOR_JS};
    var entry = found[${target}];
    if (!entry) return false;
    var el = ${CLICK_TARGET_JS}(entry.el);
    if (!el) return false;
    if (el.scrollIntoView) el.scrollIntoView();
    el.click();
    return true;
  })()`;
}

// Dismiss cookie/consent/close popups that commonly block a login form. Returns
// how many were dismissed. Runs in the browser; never reads credentials.
const LP_DISMISS_POPUPS = (): number => {
  let n = 0;
  const rx = /^(accept|accept all|i agree|agree|got it|ok|allow all|close|dismiss|continue)$/i;
  const els = Array.from(document.querySelectorAll('button,[role=button],a')) as any[];
  for (const el of els) {
    const t = ((el.textContent || el.getAttribute?.('aria-label') || '') as string).replace(/\s+/g, ' ').trim();
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
    if (r.width > 0 && r.height > 0 && rx.test(t)) { try { el.click(); n++; } catch { /* ignore */ } }
    if (n >= 3) break;
  }
  return n;
};

// Open a login form that hides behind a visible "Log in" / "Sign in" trigger
// (nav link, header button, modal opener). LandPortal's marketing homepage keeps
// the real #login-user/#login-pwd form HIDDEN inside a modal until the trigger
// is clicked — so a visible-only field scan legitimately finds nothing until
// this runs. Returns 'clicked' or 'no_trigger'. Read-only beyond the click.
const LP_OPEN_LOGIN = (): string => {
  const visible = (el: any): boolean => { const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 }; return r.width > 1 && r.height > 1; };
  const els = Array.from(document.querySelectorAll('a,button,[role=button]')) as any[];
  const trigger = els.find((el) => visible(el) && /^(log ?in|sign ?in)$/i.test(((el.textContent || el.getAttribute?.('aria-label') || '') as string).replace(/\s+/g, ' ').trim()));
  if (!trigger) return 'no_trigger';
  try { trigger.click(); return 'clicked'; } catch { return 'no_trigger'; }
};

// Fill the LandPortal login form and submit. Values arrive as args (typed into
// the page only) and are NEVER returned. Returns a DIAGNOSTIC CODE, not creds.
// Field identification is layered (type/name/id/placeholder/autocomplete/label
// semantics), never a single brittle CSS class.
const LP_LOGIN = (email: string, password: string): string => {
  const setVal = (el: any, v: string) => {
    el.focus();
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, v); else el.value = v;
    el.dispatchEvent(new (window as any).Event('input', { bubbles: true }));
    el.dispatchEvent(new (window as any).Event('change', { bubbles: true }));
  };
  const visible = (el: any): boolean => { const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 }; return r.width > 1 && r.height > 1; };
  const emailEl = (Array.from(document.querySelectorAll('input[type=email],input[name*="email" i],input[id*="email" i],input[autocomplete="username"],input[name*="user" i],input[id*="user" i],input[id*="login" i],input[placeholder*="email" i],input[placeholder*="user" i]')) as any[]).find(visible)
    || (Array.from(document.querySelectorAll('input[type=text]')) as any[]).find(visible);
  if (!emailEl) return 'no_email_field';
  const passEl = (Array.from(document.querySelectorAll('input[type=password]')) as any[]).find(visible);
  if (!passEl) return 'no_password_field';
  setVal(emailEl, email);
  setVal(passEl, password);
  const form = passEl.closest ? passEl.closest('form') : null;
  const submitText = (b: any) => (((b.value || b.textContent || '') as string).replace(/\s+/g, ' ').trim());
  const isSubmit = (b: any) => visible(b) && b !== emailEl && b !== passEl && /^(log ?in|sign ?in|continue|submit)$/i.test(submitText(b));
  // Prefer a control INSIDE the password field's own container (LandPortal's
  // modal submits via <a class="btn-login">Log in</a> — an anchor, not a
  // button — and the page ALSO has an unrelated nav "Log in" anchor, so the
  // scoped search must run before any document-wide fallback).
  let btn: any = null;
  let anc: any = passEl.parentElement;
  for (let d = 0; anc && d < 6 && !btn; d++) {
    btn = (Array.from(anc.querySelectorAll('button,input[type=submit],[role=button],a')) as any[]).find(isSubmit);
    anc = anc.parentElement;
  }
  if (!btn) btn = (Array.from(document.querySelectorAll('button[type=submit],input[type=submit],button,[role=button]')) as any[]).find(isSubmit);
  if (btn) { btn.click(); return 'submitted'; }
  if (form && form.requestSubmit) { form.requestSubmit(); return 'submitted'; }
  if (passEl.form && passEl.form.submit) { passEl.form.submit(); return 'submitted'; }
  return 'no_submit';
};

// Detect a captcha / 2FA challenge that auto-login cannot clear.
const LP_CHALLENGE = (): string | null => {
  const t = ((document.body && document.body.innerText) || '').slice(0, 3000).toLowerCase();
  if (/are you a human|verify you are|captcha|recaptcha|hcaptcha|press and hold/.test(t)) return 'captcha';
  if (/two-factor|2fa|verification code|one-time code|authenticator/.test(t)) return '2fa';
  return null;
};

/**
 * Ensure LandPortal is authenticated in the persistent session — AUTOMATICALLY.
 * Starts the browser if needed, reuses the SINGLE working tab (no duplicate
 * LandPortal tabs), dismisses blocking popups, and — if not already signed in —
 * logs in using the env credentials. Diagnoses recoverable failures. Returns a
 * granular readiness with an exact technical reason on failure. NEVER logs,
 * returns, or screenshots credentials.
 */
export async function ensureLandPortalAuthenticated(deps: EnsureReadyDeps = {}): Promise<LandPortalReadiness> {
  // Owned work: this opens/navigates the shared LandPortal tab outside the lane
  // drivers, and a trailing auth check that ran past the cleanup boundary was
  // the second producer of a surviving landportal.com tab.
  const authOwner = browserWorkflowContext.getStore() ?? null;
  beginScopedBrowserWork(authOwner);
  try {
    return await ensureLandPortalAuthenticatedInner(deps);
  } finally {
    endScopedBrowserWork(authOwner);
  }
}

async function ensureLandPortalAuthenticatedInner(deps: EnsureReadyDeps = {}): Promise<LandPortalReadiness> {
  const now = deps.now ?? (() => new Date().toISOString());
  const url = deps.landportalUrl ?? LANDPORTAL_SESSION_URL;
  const base = (phase: LandPortalPhase, over: Partial<LandPortalReadiness>): LandPortalReadiness => ({
    phase, ready: false, sessionStatus: state.status, authenticated: false, reason: null, missingEnv: [], attempted: false, note: '', ...over,
  });

  // FAST PATH: a recently verified authenticated session is reused WITHOUT
  // re-navigating LandPortal. The authenticated app is a heavy map SPA — a
  // per-mission reload both wastes minutes and can stall the shared tab.
  // Verified live 2026-07-14: per-mission goto after login caused 180s protocol
  // stalls; the cache makes repeat missions instant. TTL keeps it honest.
  const AUTH_FRESH_MS = 10 * 60 * 1000;
  const freshAuth = (): LandPortalReadiness | null => {
    if (state.auth?.authenticated && state.auth.atIso && state.browser && safeConnected(state.browser)) {
      const ageMs = Date.now() - Date.parse(state.auth.atIso);
      if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < AUTH_FRESH_MS) {
        state.status = 'live';
        return base('authenticated', { ready: true, sessionStatus: 'live', authenticated: true, note: 'LandPortal session verified recently — reused without reloading the app.' });
      }
    }
    return null;
  };
  const cached = freshAuth();
  if (cached) return cached;

  // Concurrent lanes serialize on the NAMED auth gate: exactly one login
  // attempt drives the form; every queued lane re-checks the (now fresh) cache
  // first and returns without a second login.
  const work = async (): Promise<LandPortalReadiness> => {
    const nowCached = freshAuth();
    if (nowCached) return nowCached;

  const ready = await ensureBrowserSessionReady(deps);
  if (ready.status !== 'live' && ready.status !== 'auth_needed') {
    // The PRE-RUN check for every LandPortal lane. A launch was already
    // attempted above; if the endpoint is still not answering, say so at error
    // level with the endpoint and the operator's command, because every lane
    // behind this point degrades into a silent timeout instead.
    logger.error({
      event: 'landportal_browser_unavailable_pre_run',
      status: ready.status,
      launchAttempted: ready.started,
      cdpUrl: state.cdpUrl,
      error: ready.error,
    }, 'landportal_browser_unavailable_pre_run');
    return base('session_unavailable', { sessionStatus: ready.status, reason: `${ready.error ?? 'Chrome/CDP session could not be started.'} Check \`npm run landos:browser status\` and start it with \`npm run landos:browser start\`.`, note: 'Browser session unavailable — see reason.' });
  }

  const page = await getWorkingPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  } catch (err) {
    return base('auth_failed', { sessionStatus: ready.status, reason: `LandPortal page failed to load: ${(err as Error)?.message ?? 'navigation error'}.`, note: 'LandPortal did not load.' });
  }
  try { await page.evaluate<number>(LP_DISMISS_POPUPS as unknown as () => number); } catch { /* best-effort */ }

  let read = await readPage(page);
  if (!read.loginLike) {
    state.auth = { authenticated: true, atIso: now() };
    state.status = 'live';
    return base('authenticated', { ready: true, sessionStatus: 'live', authenticated: true, note: 'LandPortal already authenticated — ready.' });
  }

  // Not signed in → attempt automatic login from env credentials.
  const { creds, missing } = (deps.readCreds ?? (() => readLandPortalCreds()))();
  if (!creds) {
    state.status = 'auth_needed';
    return base('no_credentials', { sessionStatus: 'auth_needed', missingEnv: missing, reason: `Missing LandPortal credentials: set ${missing.join(' and ')} in .env.`, note: 'Automatic login cannot run — credential env vars are missing.' });
  }

  const challengeBefore = await page.evaluate<string | null>(LP_CHALLENGE as unknown as () => string | null).catch(() => null);
  if (challengeBefore) {
    state.status = 'auth_needed';
    return base('auth_failed', { attempted: false, sessionStatus: 'auth_needed', reason: challengeBefore === 'captcha' ? 'LandPortal presented a captcha — automatic login cannot clear it.' : 'LandPortal requires 2FA/verification — automatic login cannot clear it.', note: 'Login blocked by a human-verification challenge.' });
  }

  let code = 'no_email_field';
  let triggerUsed = false;
  try {
    code = await page.evaluate<string>(LP_LOGIN as unknown as () => string, creds.email, creds.password);
    // The real login form may be HIDDEN behind a "Log in" trigger (modal or a
    // navigation to a login page). When no visible field exists, open it via
    // the trigger, let it render, and retry once. This is the repair for the
    // 2026-07 LandPortal homepage change (hidden #login-user modal form).
    if (code === 'no_email_field' || code === 'no_password_field') {
      const opened = await page.evaluate<string>(LP_OPEN_LOGIN as unknown as () => string).catch(() => 'no_trigger');
      if (opened === 'clicked') {
        triggerUsed = true;
        // Give the modal/login page time to render (animation + lazy mount).
        // Deliberately NO popup-dismiss here — the login modal's own Close
        // button matches the dismiss patterns and would shut the form we just
        // opened. Verified live 2026-07-14.
        await new Promise((r) => setTimeout(r, deps.settleMs ?? 3500));
        code = await page.evaluate<string>(LP_LOGIN as unknown as () => string, creds.email, creds.password);
      }
    }
  }
  catch (err) { return base('auth_failed', { attempted: true, sessionStatus: state.status, reason: `Login form interaction failed: ${(err as Error)?.message ?? 'evaluate error'}.`, note: 'Could not drive the login form.' }); }

  if (code !== 'submitted') {
    const via = triggerUsed ? ' (a Log in trigger was clicked and the form was still not usable)' : ' (no visible form and no Log in trigger found)';
    const reason = code === 'no_email_field' ? `LandPortal login form not found (email/username field missing)${via} — the login UI may have changed.`
      : code === 'no_password_field' ? `LandPortal password field not found${via} — the login UI may have changed.`
      : 'LandPortal login submit control not found — the login UI may have changed.';
    state.status = 'auth_needed';
    return base('auth_failed', { attempted: true, sessionStatus: 'auth_needed', reason, note: 'Automatic login could not be submitted.' });
  }

  // Wait for the post-login navigation/render, then re-check auth.
  await new Promise((r) => setTimeout(r, deps.settleMs ?? 4500));
  const challengeAfter = await page.evaluate<string | null>(LP_CHALLENGE as unknown as () => string | null).catch(() => null);
  read = await readPage(page);
  if (!read.loginLike && !challengeAfter) {
    state.auth = { authenticated: true, atIso: now() };
    state.status = 'live';
    return base('authenticated', { ready: true, attempted: true, sessionStatus: 'live', authenticated: true, note: 'LandPortal signed in automatically from env credentials — ready.' });
  }
  state.status = 'auth_needed';
  const reason = challengeAfter
    ? (challengeAfter === 'captcha' ? 'LandPortal presented a captcha after submit — automatic login cannot clear it.' : 'LandPortal requires 2FA/verification after submit — automatic login cannot clear it.')
    : 'Submitted env credentials but LandPortal still shows a login page — credentials may be wrong or the account is locked.';
  return base('auth_failed', { attempted: true, sessionStatus: 'auth_needed', reason, note: 'Automatic login did not authenticate — see reason.' });
  };
  const run = landportalAuthGate.then(work, work);
  landportalAuthGate = run.then(() => undefined, () => undefined);
  return run;
}

// ─────────────────────────────────────────────────────────────────────────
// In-page extraction (runs in the real browser; fake page returns canned data)
// ─────────────────────────────────────────────────────────────────────────

/** Serialized DOM reader: visible label→value pairs from definition lists,
 *  tables, and labeled rows, plus a few visible text snippets. Read-only. */
const EXTRACT_FN = (): { fields: Record<string, string>; snippets: string[]; loginLike: boolean } => {
  const fields: Record<string, string> = {};
  const add = (k: string, v: string) => {
    const key = (k || '').replace(/\s+/g, ' ').trim().replace(/[:#]+$/, '');
    const val = (v || '').replace(/\s+/g, ' ').trim();
    if (key && val && key.length <= 40 && !fields[key]) fields[key] = val;
  };
  // dt/dd
  document.querySelectorAll('dl').forEach((dl: any) => {
    const dts = dl.querySelectorAll('dt'); const dds = dl.querySelectorAll('dd');
    for (let i = 0; i < Math.min(dts.length, dds.length); i++) add(dts[i].textContent || '', dds[i].textContent || '');
  });
  // two-cell table rows
  document.querySelectorAll('tr').forEach((tr: any) => {
    const cells = tr.querySelectorAll('th,td');
    if (cells.length === 2) add(cells[0].textContent || '', cells[1].textContent || '');
  });
  // label + adjacent value
  document.querySelectorAll('label,[class*="label"],[class*="Label"]').forEach((el: any) => {
    const k = el.textContent || ''; const sib = (el.nextElementSibling && el.nextElementSibling.textContent) || '';
    if (k && sib) add(k, sib);
  });
  // Listing sites are client-rendered and rarely expose useful values through
  // label/value pairs.  Keep only compact, visible card text that carries both
  // a price and a lot-size/address signal; this gives the comp parser one
  // complete listing record instead of unrelated page headings.
  const snippets: string[] = [];
  const seen = new Set<string>();
  const visible = (el: any): boolean => {
    const r = el?.getBoundingClientRect?.();
    if (!r || r.width < 1 || r.height < 1) return false;
    const s = (window as any).getComputedStyle?.(el);
    return !(s && (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity || '1') < 0.1));
  };
  document.querySelectorAll('article,li,[data-test*="property" i],[data-testid*="property" i],[class*="list-card" i],[class*="ListCard"]').forEach((el: any) => {
    if (!visible(el)) return;
    const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t.length >= 20 && t.length <= 900 && /\$\s?[\d,]{4,}/.test(t) && /\b(?:acres?|ac|sq\s?ft\s*lot|lot)\b/i.test(t) && !seen.has(t)) {
      seen.add(t); snippets.push(t);
    }
  });
  document.querySelectorAll('h1,h2,h3').forEach((h: any) => { const t = (h.textContent || '').trim(); if (t && !seen.has(t)) snippets.push(t.slice(0, 120)); });
  const bodyText = (document.body && document.body.innerText) || '';
  const loginLike = /sign in|log in|login|password/i.test(bodyText.slice(0, 2000)) && Object.keys(fields).length === 0;
  return { fields, snippets: snippets.slice(0, 40), loginLike };
};

async function readPage(page: PageLike): Promise<BrowserPageRead & { loginLike: boolean }> {
  const out = await page.evaluate<{ fields: Record<string, string>; snippets: string[]; loginLike: boolean }>(EXTRACT_FN);
  return { url: page.url(), fields: out.fields ?? {}, snippets: out.snippets ?? [], loginLike: !!out.loginLike };
}

/** Best-effort read-only search: type into the first search box and submit. */
async function doSearch(page: PageLike, query: string): Promise<void> {
  const SUBMIT = (q: string): boolean => {
    const el: any = document.querySelector('input[type=search]') || document.querySelector('input[name*="search" i]')
      || document.querySelector('input[placeholder*="search" i]') || document.querySelector('input[type=text]');
    if (!el) return false;
    el.focus(); el.value = q;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const form: any = el.closest('form');
    if (form) { form.requestSubmit ? form.requestSubmit() : form.submit(); }
    return true;
  };
  const ok = await page.evaluate<boolean>(SUBMIT as unknown as () => boolean, query);
  if (!ok && page.keyboard) { /* nothing to type into; leave page as-is */ }
}

// ─────────────────────────────────────────────────────────────────────────
// Live BrowserDriver (implements the existing seam)
// ─────────────────────────────────────────────────────────────────────────

export interface LiveDriverDeps extends SessionDeps {
  /** Detect a not-logged-in page and flip session status to 'auth_needed'. */
  detectAuth?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// JURISDICTION SCOPE CONTROLS (state / county filter dropdowns)
//
// These run INSIDE the page, so each one is self-contained — no closure over
// anything in this module. They exist because a scope filter is only really
// applied when the widget DISPLAYS the chosen value; clicking an option is not
// the same thing, and treating it as the same is how a search got submitted with
// both jurisdiction dropdowns still reading "Select Value".
// ─────────────────────────────────────────────────────────────────────────────

/** One scope dropdown exactly as the page renders it. */
export interface ScopeControlView {
  /** The control's own label (from its label element, aria-label, name or id). */
  label: string;
  /** The displayed selection, or null when it still shows a placeholder. */
  selected: string | null;
  /** True while the control is disabled — a dependent list that has not loaded. */
  disabled: boolean;
}

/** Does a rendered dropdown label denote the wanted jurisdiction? Tolerates the
 *  site's own wording ("Roane" vs "Roane County", "Tennessee" vs "TN"). */
export function scopeLabelMatches(displayed: string, wanted: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\bcount(y|ies)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const a = norm(displayed), b = norm(wanted);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

// NOTE: each script below runs INSIDE the page, so it repeats its own container
// lookup rather than calling a shared helper — a closure over module scope does
// not exist in the browser. The lookup: the select2 widgets inside the search
// scope wrapper when the surface has one, else every visible select2 widget in
// document order.

/** Read every scope dropdown's label, displayed selection and enabled state. */
const SCOPE_CONTROLS_SCRIPT = ((): ScopeControlView[] => {
  const PLACEHOLDER = /^(select(\s+(a\s+)?(value|option|one))?|choose(\s+(a\s+)?(value|option|one))?|--.*--|all|any|none|)$/i;
  const containersOf = (): any[] => {
    const root = (document.querySelector('.search-selects-wr') || document) as any;
    return (Array.from(root.querySelectorAll('.select2-container')) as any[]).filter((c) => {
      const r = c.getBoundingClientRect ? c.getBoundingClientRect() : null;
      return !!c.querySelector('.select2-selection') && !!r && r.width > 0 && r.height > 0;
    });
  };
  const labelOf = (container: any, hidden: any): string => {
    const tag = container.parentElement ? container.parentElement.querySelector('label') : null;
    const parts = [
      tag ? tag.textContent : '',
      hidden ? hidden.getAttribute('aria-label') : '',
      hidden ? hidden.getAttribute('name') : '',
      hidden ? hidden.getAttribute('id') : '',
      container.getAttribute ? container.getAttribute('aria-label') : '',
    ];
    for (const p of parts) { const t = (p || '').replace(/\s+/g, ' ').trim(); if (t) return t; }
    return '';
  };
  const out: ScopeControlView[] = [];
  for (const c of containersOf()) {
    const rendered = c.querySelector('.select2-selection__rendered');
    const isPlaceholder = !!(rendered && rendered.querySelector('.select2-selection__placeholder'));
    const text = ((rendered && rendered.textContent) || '').replace(/\s+/g, ' ').replace(/^\s*×\s*/, '').trim();
    const prev = c.previousElementSibling;
    const hidden = prev && prev.tagName === 'SELECT' ? prev : null;
    out.push({
      label: labelOf(c, hidden),
      selected: isPlaceholder || PLACEHOLDER.test(text) ? null : text,
      disabled: String(c.className || '').includes('disabled') || !!(hidden && hidden.disabled),
    });
  }
  if (out.length) return out;
  // Fallback: plain native selects used as scope filters.
  const root = (document.querySelector('.search-selects-wr') || document) as any;
  for (const el of Array.from(root.querySelectorAll('select')) as any[]) {
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (!r || r.width <= 0 || r.height <= 0) continue;
    const opt = el.selectedOptions && el.selectedOptions[0];
    const text = ((opt && opt.textContent) || '').replace(/\s+/g, ' ').trim();
    out.push({ label: labelOf(el, el), selected: PLACEHOLDER.test(text) || !el.value ? null : text, disabled: !!el.disabled });
  }
  return out;
}) as unknown as () => ScopeControlView[];

/** Clear a stale selection so one property's scope can never narrow another's. */
const CLEAR_SCOPE_SCRIPT = ((which: number): void => {
  const root = (document.querySelector('.search-selects-wr') || document) as any;
  const c = (Array.from(root.querySelectorAll('.select2-container')) as any[])
    .filter((x) => { const r = x.getBoundingClientRect ? x.getBoundingClientRect() : null; return !!x.querySelector('.select2-selection') && !!r && r.width > 0 && r.height > 0; })[which];
  if (!c) return;
  const clear = c.querySelector('.select2-selection__clear');
  if (clear) { clear.click(); return; }
  const hidden = c.previousElementSibling;
  if (hidden && hidden.tagName === 'SELECT') {
    hidden.value = '';
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
  }
}) as unknown as () => void;

/** Open one scope dropdown. */
const OPEN_SCOPE_SCRIPT = ((which: number): boolean => {
  const root = (document.querySelector('.search-selects-wr') || document) as any;
  const c = (Array.from(root.querySelectorAll('.select2-container')) as any[])
    .filter((x) => { const r = x.getBoundingClientRect ? x.getBoundingClientRect() : null; return !!x.querySelector('.select2-selection') && !!r && r.width > 0 && r.height > 0; })[which];
  if (!c || String(c.className || '').includes('disabled')) return false;
  const sel = c.querySelector('.select2-selection');
  if (!sel) return false;
  sel.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  sel.click();
  return true;
}) as unknown as () => boolean;

/** Type into the open dropdown's search field to filter its options. */
const TYPE_SCOPE_SCRIPT = ((value: string): void => {
  const sf = document.querySelector('.select2-search__field');
  if (!sf) return;
  sf.value = value;
  sf.dispatchEvent(new Event('input', { bubbles: true }));
  sf.dispatchEvent(new window.KeyboardEvent('keyup', { bubbles: true }));
}) as unknown as () => void;

/** Has the (possibly dependent, possibly async) option list produced the value?
 *  Waiting on THIS instead of a fixed sleep is what stops an unloaded county
 *  list from looking like "no such county". */
const HAS_SCOPE_OPTION_SCRIPT = ((value: string): boolean => {
  const want = String(value).toLowerCase();
  return (Array.from(document.querySelectorAll('.select2-results__option')) as any[]).some((o) => {
    const t = (o.textContent || '').trim().toLowerCase();
    if (!t || /searching|loading|no results/.test(t)) return false;
    return t === want || t.indexOf(want) >= 0 || want.indexOf(t) >= 0;
  });
}) as unknown as () => boolean;

/** Click the matching option, preferring an exact label. */
const PICK_SCOPE_SCRIPT = ((value: string): boolean => {
  const want = String(value).toLowerCase();
  const opts = Array.from(document.querySelectorAll('.select2-results__option')) as any[];
  const text = (o: any) => (o.textContent || '').trim().toLowerCase();
  const el = opts.find((o) => text(o) === want)
    || opts.find((o) => text(o).replace(/\s+county$/, '') === want)
    || opts.find((o) => text(o).indexOf(want) >= 0);
  if (!el) return false;
  el.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  el.click();
  return true;
}) as unknown as () => boolean;

/** Close an open dropdown without selecting anything. */
const CLOSE_SCOPE_SCRIPT = ((): void => {
  const sf = document.querySelector('.select2-search__field') || document.body;
  sf.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape', keyCode: 27 }));
  document.body.click();
}) as unknown as () => void;

/**
 * A live, read-only BrowserDriver backed by the persistent session. configured()
 * is true only when the session is live. open/search/readFields navigate + read;
 * screenshot saves one proof image. Auth detection: when a navigated page looks
 * like a login page, status flips to 'auth_needed' and the read returns no
 * property fields (never fabricated). Never performs a paid/write/billing action.
 */
export function makeLiveBrowserDriver(id: string, deps: LiveDriverDeps = {}): BrowserDriver {
  const cfg = deps.config ?? readSessionConfig();
  const now = deps.now ?? (() => new Date().toISOString());
  const timeoutDefault = 20000;
  // Identity is per DRIVER INSTANCE, not the human-readable lane id: two Deal
  // Intelligence missions may both have a "landportal" lane at the same time.
  // Sharing by id would let one Deal close the other's live page.
  const laneOwner = Symbol(id);
  let workflowOwner: BrowserWorkflowScope | null = browserWorkflowContext.getStore() ?? null;

  // ── PER-LANE PAGE ──────────────────────────────────────────────────────────
  // Each driver INSTANCE owns its own page instead of funnelling every lane
  // through the one shared working tab. Profile cookies are browser-wide, so an
  // authenticated LandPortal session works from any lane page; what lanes must
  // NOT share is the tab itself — that chokepoint serialized independent lanes
  // and forced the mission graph's comparables→projection `awaits` workaround.
  // The page is acquired lazily, cached for the driver's lifetime, registered
  // for cleanup, and re-acquired when the session reconnects or it was closed.
  let lanePage: PageLike | null = null;
  let laneBrowser: BrowserLike | null = null;
  const getLanePage = async (): Promise<PageLike> => {
    if (!state.browser) throw new Error('No live browser session.');
    if (
      lanePage
      && laneBrowser === state.browser
      && lanePage.isClosed?.() !== true
      // A cached handle that has since become the retained control page is not
      // reusable: navigating it would turn the inert control tab into a
      // research surface.
      && !isControlPage(lanePage)
      && lanePageRegistry.get(lanePage)?.lane === laneOwner
    ) {
      return lanePage;
    }
    // OWNERSHIP FOLLOWS THE LIVE RUN, NOT THE DRIVER'S BIRTH.
    //
    // Several drivers are built once at route setup and reused across runs
    // (`makeLandPortalBrowser({ driver: makeLiveBrowserDriver('landportal') })`).
    // Capturing the scope only on first use pinned such a driver to the FIRST
    // run it ever served, so every later run's page was registered to a scope
    // that had already been released — cleanup then read it as "operator or
    // other-workflow" and preserved it. That is the surviving LandPortal
    // property tab.
    //
    // Adopting the currently active scope at acquisition time keeps a page
    // owned by the run that is actually using it; the captured owner remains
    // the fallback for a continuation that has lost the async context.
    const liveScope = browserWorkflowContext.getStore() ?? null;
    if (liveScope) workflowOwner = liveScope;
    else workflowOwner ??= null;
    if (lanePage) lanePageRegistry.delete(lanePage);
    // BACKGROUND FIRST. `newPage()` activates the new tab and raises its window,
    // so a research lane opening one yanks Chrome over whatever the operator is
    // doing. `Target.createTarget` with `background: true` creates the identical
    // tab without activating it. Same page object, same driver, same behaviour —
    // the only difference is that the operator never sees it happen.
    lanePage = await openResearchTab(state.browser);
    laneBrowser = state.browser;
    lanePageRegistry.set(lanePage, { lane: laneOwner, workflow: workflowOwner });
    // OWNERSHIP IS THE CLEANUP CONTRACT, so it is observable.
    //
    // A page registered with no workflow can never be matched by scoped
    // cleanup — that is exactly how a trailing lane's tab used to survive a
    // run. The owning scope now stays alive until the work that opened this
    // page settles, so `owned:false` should not occur for mission work; when
    // it does, this line names it instead of leaving a silent orphan.
    logger.info({
      lane: id,
      owned: workflowOwner != null,
      scope: workflowOwner ? String(workflowOwner) : null,
      activeScopes: activeWorkflowScopes.size,
    }, 'browser_lane_page_registered');
    return lanePage;
  };

  const nav = async (url: string, timeoutMs: number): Promise<BrowserPageRead> => {
    await ensureBrowserSession(deps);
    const page = await getLanePage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    // Zillow/Redfin and public-record portals paint result cards after DOM
    // content loads.  Reading immediately produces an empty page and a false
    // "no results" outcome; wait briefly for the visible client-side render.
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    const read = await readPage(page);
    if (deps.detectAuth !== false && read.loginLike) state.status = 'auth_needed';
    return { url: read.url, fields: read.fields, snippets: read.snippets };
  };

  // ── OWNED-PAGE SCOPES ────────────────────────────────────────────────────
  // A LandPortal job gets one registered page owned by this driver instance.
  // The scope records the pages that already existed for its cleanup report,
  // but closure is decided by exact registry ownership — timing alone can
  // never prove a page belongs to this lane when other lanes run concurrently.
  const ownedScopes = new Map<string, Set<PageLike>>();

  /**
   * Count every driver call as OWNED work of this driver's workflow.
   *
   * Ownership is taken from the driver's captured `workflowOwner`, not from the
   * ambient async context: a trailing operation may resume on a continuation
   * that has lost the AsyncLocalStorage store, and it still belongs to the run
   * that created this driver — that is precisely the case that produced an
   * unowned tab. Release happens in `finally` (and on a synchronous throw), so
   * success, failure, timeout and cancellation all settle identically and no
   * call can hold the mission scope open forever.
   *
   * Applied to the whole surface rather than method-by-method so a browser
   * entry point added later is owned by construction.
   */
  const asOwnedDriver = <T extends object>(driver: T): T => {
    const passthrough = new Set(['id', 'configured']);
    const wrapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(driver)) {
      if (typeof value !== 'function' || passthrough.has(key)) {
        wrapped[key] = value;
        continue;
      }
      wrapped[key] = (...args: unknown[]): unknown => {
        workflowOwner ??= browserWorkflowContext.getStore() ?? null;
        const owner = workflowOwner;
        beginScopedBrowserWork(owner);
        let result: unknown;
        try {
          result = (value as (...a: unknown[]) => unknown).apply(driver, args);
        } catch (error) {
          endScopedBrowserWork(owner);
          throw error;
        }
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          return (result as Promise<unknown>).finally(() => endScopedBrowserWork(owner));
        }
        endScopedBrowserWork(owner);
        return result;
      };
    }
    return wrapped as T;
  };

  return asOwnedDriver({
    id,
    configured() { return browserSessionStatus() === 'live'; },
    async beginOwnedPageScope() {
      await ensureBrowserSession(deps);
      const token = `lp-scope-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const preexisting = new Set<PageLike>();
      try { for (const p of await state.browser!.pages()) preexisting.add(p); } catch { /* nothing open yet */ }
      ownedScopes.set(token, preexisting);
      return token;
    },
    async closeOwnedPageScope(token: string) {
      const preexisting = ownedScopes.get(token);
      ownedScopes.delete(token);
      const result = { closed: 0, failed: 0, preserved: preexisting?.size ?? 0 };
      if (!preexisting || !state.browser) return result;
      let pages: PageLike[] = [];
      try { pages = await state.browser.pages(); } catch { return result; }
      for (const page of pages) {
        // The driver may close only its OWN registered pages. In particular:
        //   * another lane's page is preserved even if it appeared after this
        //     scope began (the former cross-lane reap defect);
        //   * the shared auth/working page is not this driver's property; and
        //   * an unregistered page is treated as operator-owned because page
        //     provenance is unknown. Unknown ownership must fail closed.
        if (lanePageRegistry.get(page)?.lane !== laneOwner) continue;
        // Never close the process-keeper, whatever the registry says.
        if (isControlPage(page)) continue;
        try {
          await (page as unknown as { close?: () => Promise<void> }).close?.();
          lanePageRegistry.delete(page);
          if (page === lanePage) lanePage = null;
          result.closed += 1;
          if (preexisting.has(page)) result.preserved = Math.max(0, result.preserved - 1);
        } catch {
          result.failed += 1;
        }
      }
      return result;
    },
    async open(url, opts) { return nav(url, opts?.timeoutMs ?? timeoutDefault); },
    async search(query, opts) {
      await ensureBrowserSession(deps);
      const page = await getLanePage();
      await doSearch(page, query);
      const read = await readPage(page);
      if (deps.detectAuth !== false && read.loginLike) state.status = 'auth_needed';
      return { url: read.url, fields: read.fields, snippets: read.snippets };
    },
    async readFields() {
      const page = await getLanePage();
      const read = await readPage(page);
      return { url: read.url, fields: read.fields, snippets: read.snippets };
    },
    // ONE-PASS LandPortal capture in the authenticated working tab: full parcel fields +
    // a wide parcel screenshot + all comparable rows (expands "View all") + clicks
    // the real "Show on Map" anchor (js-lp-estimate-show-on-map) and screenshots
    // the comps map. Proves the map was reached (mapReached) and never touches a
    // paid Comp/Slope report control. Read-only; closes the tab it opened.
    async captureLandPortalVisuals(url: string, opts: {
      timeoutMs: number;
      captureLabels?: string[];
      onSubjectFacts?: (payload: { url: string; fields: Record<string, string> }) => void;
    }) {
      // Serialize on the NAMED landportalCaptureGate: camera framing, overlay
      // dialogs and paint-gated screenshots cannot interleave on one Chrome
      // window, even though each capture runs on its own lane page. Ordinary
      // navigation/read operations on other lane pages stay concurrent.
      // Stamped BEFORE the gate so `queuedMs` on entry states what queueing
      // actually cost this capture — the number that made gap 2 visible.
      const enqueuedAtMs = Date.now();
      const work = async () => {
      // Gate wait ONLY. Measured here, before session readiness, because a cold
      // browser launch is work this capture does for itself and queueing is
      // time it spent doing nothing.
      const queuedMs = Date.now() - enqueuedAtMs;
      const empty = {
        fields: {} as Record<string, string>,
        parcelShotPath: null as string | null,
        compsMapShotPath: null as string | null,
        overlayShots: [] as Array<{ overlay: string; path: string; purpose: string }>,
        visualShots: [] as Array<{
          label: string;
          path: string;
          kind: 'parcel_page' | 'overlay' | 'parcel_3d';
          purpose: string;
          overlay?: string;
          soilDetails?: Array<{ symbol: string | null; name: string | null; fields: Record<string, string> }>;
        }>,
        overlayMisses: [] as Array<{ overlay: string; reason: string }>,
        terrainShotPath: null as string | null,
        compRows: [] as string[],
        compCards: [] as string[],
        compDetails: [] as string[],
        mapReached: false,
        capturedAtIso: now(),
      };
      // ── GAP 1: A DEAD DEDICATED BROWSER MUST NEVER BE SILENT ────────────
      // This used to be `ensureBrowserSession()` followed by
      // `if (!state.browser) return empty`. With the dedicated browser's CDP
      // endpoint not answering, three consecutive runs produced ZERO capture
      // log lines and then a clean 300-second timeout, which reads exactly
      // like "LandPortal had nothing" instead of "LandOS had no browser".
      //
      // Two changes, both narrow: RECOVER first (`ensureBrowserSessionReady`
      // launches the dedicated LandOS Chrome — never the operator's — when the
      // endpoint is not answering), and when recovery fails, FAIL LOUDLY: an
      // error log naming the CDP endpoint and the operator's next command, and
      // a thrown error rather than an empty payload the caller cannot tell
      // apart from a genuinely empty parcel.
      const readiness = await ensureBrowserSessionReady(deps);
      if (!state.browser) {
        const detail = `dedicated LandOS browser session is ${readiness.status}${readiness.error ? ` (${readiness.error})` : ''}`;
        logger.error({
          event: 'landportal_capture_browser_unavailable',
          status: readiness.status,
          launchAttempted: readiness.started,
          cdpUrl: state.cdpUrl,
          error: readiness.error,
          url,
        }, 'landportal_capture_browser_unavailable');
        throw new Error(`LandPortal capture cannot run: ${detail}. Check \`npm run landos:browser status\` and start it with \`npm run landos:browser start\`.`);
      }
      logger.info({ event: 'landportal_capture_entered', queuedMs, sessionReadyMs: Date.now() - enqueuedAtMs - queuedMs }, 'landportal_capture_entered');
      // Comparables retrieved directly from LandPortal's parcel endpoint. When
      // these are present the sidebar scrape and the per-comparable drill-down
      // are skipped entirely — that loop opened up to twelve pages in sequence.
      let apiCompCards: string[] | null = null;
      let apiCompDetails: string[] | null = null;
      // Always use this driver's registered lane page. A different Deal may
      // have an authenticated, fully rendered parcel page open concurrently;
      // scanning browser.pages() and borrowing whichever looked "ready" mixed
      // subject facts/screenshots across Deals and let this lane navigate a page
      // it did not own.
      const page = await getLanePage();
      const dir = cfg.screenshotDir;
      try { (await import('fs')).mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      // ── WAIT FOR THE CONDITION, NOT FOR THE CLOCK ───────────────────────
      // This capture used to spend 96 seconds of unconditional `sleep()` in a
      // single linear pass, before the overlay loop multiplied several of them.
      // Every one of those waits was sized for the worst case LandPortal has
      // ever shown, so a page ready in a second still cost the full pessimistic
      // pause. That is the reason a capture with a KNOWN parcel URL took about
      // thirteen minutes on 5170 Hwy 60.
      //
      // The ceilings were not wrong, so they are kept exactly as they were:
      // this returns as soon as the page proves it is ready and waits the full
      // original duration when it never does. Strictly faster on the common
      // path, never slower on the bad one.
      // Each probe is itself bounded, and the cadence is deliberately unhurried.
      // The first version polled every 400ms with no per-probe timeout, and that
      // hung the capture outright: `ready()` here runs `page.evaluate` against a
      // heavy SPA, so one probe that never resolves stalls the loop past every
      // deadline, and probing that often can destroy the execution context on
      // its own. A probe that does not answer within PROBE_TIMEOUT_MS is simply
      // not-ready, exactly like one that answers false.
      const PROBE_TIMEOUT_MS = 5_000;
      const pollUntil = async (
        ready: () => Promise<boolean>,
        capMs: number,
        intervalMs = 1_500,
      ): Promise<boolean> => {
        const deadline = Date.now() + capMs;
        for (;;) {
          try {
            let timer: ReturnType<typeof setTimeout> | null = null;
            const bounded = await Promise.race([
              ready(),
              new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS); }),
            ]);
            if (timer) clearTimeout(timer);
            if (bounded) return true;
          } catch { /* a probe failure is not readiness */ }
          if (Date.now() >= deadline) return false;
          await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
        }
      };
      const FIELDS = (): { fields: Record<string, string> } => {
        const fields: Record<string, string> = {};
        const add = (k: string, v: string) => { const key = (k || '').replace(/\s+/g, ' ').trim().replace(/[:#]+$/, ''); const val = (v || '').replace(/\s+/g, ' ').trim(); if (key && val && key.length <= 48 && !fields[key]) fields[key] = val; };
        const hidden = (el: any): boolean => { const s = (window as any).getComputedStyle ? (window as any).getComputedStyle(el) : null; return !!(s && (s.display === 'none' || s.visibility === 'hidden')); };
        // LandPortal's parcel facts are explicit tab rows. Read those first and
        // never let a broad two-span wrapper pair unrelated adjacent metrics.
        document.querySelectorAll('p.tab-row,.tab-row').forEach((el: any) => {
          if (hidden(el)) return;
          const title = el.querySelector?.('.tab-row__title');
          const value = el.querySelector?.('.tab-row__value');
          if (title && value) add(title.textContent || '', value.textContent || '');
        });
        document.querySelectorAll('dl').forEach((dl: any) => { const dt = dl.querySelectorAll('dt'); const dd = dl.querySelectorAll('dd'); for (let i = 0; i < Math.min(dt.length, dd.length); i++) add(dt[i].textContent || '', dd[i].textContent || ''); });
        document.querySelectorAll('tr').forEach((tr: any) => { const c = tr.querySelectorAll('th,td'); if (c.length === 2) add(c[0].textContent || '', c[1].textContent || ''); });
        return { fields };
      };
      // Each row is returned as "<section label><row text>". The section
      // label is the page's OWN heading for the block the row sits in, and it is
      // the only place LandPortal states whether these are closed sales or
      // asking prices — the row text itself never says. Without it the parser
      // had to guess, and a guessed transaction type decides the whole
      // valuation. An empty label means the page did not say; that stays
      // unknown rather than being defaulted.
      // ── The LandPortal comparable card, read as DATA rather than as text ────
      //
      // ROOT CAUSE OF THE LOST "SOLD" STATUS: LandPortal states a comparable's
      // transaction status in a DOM ATTRIBUTE (`data-mlsstatus="sold"`), never
      // in the row's visible text. The row renders only
      // "$153,500 Acres: 13.10 | APN: 115 02100". Reading textContent alone
      // therefore discarded the one fact that decides whether a row may price
      // the subject, so every LandPortal comp arrived downstream as
      // status=unknown and the parcel came out "not priceable".
      //
      // The card also carries LandPortal's own identity for the comp
      // (data-propertyid + data-fips + data-apn). That triple rebuilds the
      // comp's OWN parcel page — the second surface, where the address, the
      // sale date and the land/improvement facts actually live.
      //
      // Returned as JSON strings so the existing string[] transport is unchanged.
      const COMP_CARDS = (): string[] => {
        const attr = (el: any, name: string): string | null => {
          const v = el.getAttribute ? el.getAttribute(name) : null;
          const s = (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
          return s ? s : null;
        };
        const out: string[] = [];
        document.querySelectorAll('.lp-estimate-comparable-card').forEach((el: any, index: number) => {
          const text = (el.textContent || '').replace(/\s+/g, ' ').replace(/[›»]/g, '').trim();
          if (!text) return;
          const block = el.closest ? el.closest('.lp-estimate-comparables') : null;
          const title = block ? block.querySelector('.lp-estimate-comparables-header__title') : null;
          out.push(JSON.stringify({
            text,
            sectionLabel: title ? (title.textContent || '').replace(/\s+/g, ' ').trim() : '',
            // LandPortal's stated status: the authoritative sold/active signal
            // on this surface. Never inferred from the presence of a price.
            mlsStatus: attr(el, 'data-mlsstatus'),
            propertyId: attr(el, 'data-propertyid'),
            fips: attr(el, 'data-fips'),
            // The card's APN spacing is preserved exactly — it is the canonical
            // identity the two surfaces are merged on.
            apn: attr(el, 'data-apn'),
            mlsPropertyId: attr(el, 'data-mlspropertyid'),
            index: attr(el, 'data-index') ?? String(index),
          }));
        });
        return out.slice(0, 40);
      };
      // Read the labelled fact rows off a comparable's own parcel page. Only the
      // fields the comp workflow actually consumes are taken; owner, mailing and
      // mortgage details are deliberately left behind.
      const COMP_DETAIL = (): Record<string, string> => {
        const WANT = [
          'Parcel ID', 'Parcel Address', 'Parcel Address City', 'Parcel Address State',
          'Parcel Address Zip Code', 'Parcel Address County', 'Acres', 'MLS Acres',
          'Building SqFt', 'Improvement Value', 'Parcel Use Description', 'Zoning Code',
          'Last Sale Price', 'Last Sale Date', 'Last Sold Date', 'Listing Status',
          'Listing Price', 'MLS Property Type', 'Centroid Latitude', 'Centroid Longitude',
          'Land Market Value', 'Total Market Value',
        ];
        const out: Record<string, string> = {};
        document.querySelectorAll('p.tab-row, .tab-row').forEach((el: any) => {
          const t = el.querySelector ? el.querySelector('.tab-row__title') : null;
          const v = el.querySelector ? el.querySelector('.tab-row__value') : null;
          if (!t || !v) return;
          const key = (t.textContent || '').replace(/\s+/g, ' ').trim();
          const val = (v.textContent || '').replace(/\s+/g, ' ').trim();
          if (key && val && WANT.indexOf(key) >= 0 && !out[key]) out[key] = val.slice(0, 90);
        });
        return out;
      };
      // Legacy text-only reader. Retained as the fallback for a LandPortal
      // layout that does not render the structured comparable cards.
      const COMP_ROWS = (): string[] => {
        const out: string[] = []; const seen = new Set<string>();
        const labelFor = (el: any): string => {
          let node: any = el;
          for (let hop = 0; hop < 6 && node; hop += 1) {
            let sib: any = node.previousElementSibling;
            while (sib) {
              const tag = (sib.tagName || '').toLowerCase();
              const text = (sib.textContent || '').replace(/\s+/g, ' ').trim();
              if (text && text.length < 120 && (/^h[1-6]$/.test(tag) || /title|heading|header|label/i.test(sib.className || ''))) return text;
              sib = sib.previousElementSibling;
            }
            node = node.parentElement;
          }
          return '';
        };
        document.querySelectorAll('*').forEach((el: any) => {
          if (el.children && el.children.length > 2) return;
          const t = (el.textContent || '').replace(/\s+/g, ' ').replace(/[›»]/g, '').trim();
          if (/^\$[\d,]+\s+Acres?:\s*[\d.]+/i.test(t) && t.length < 90 && !seen.has(t)) {
            seen.add(t);
            out.push(labelFor(el) + '' + t);
          }
        });
        return out.slice(0, 30);
      };
      // Scroll the window AND every scrollable container so a lazy-loaded result
      // list materialises. Pure navigation: no click, no write.
      const SCROLL_RESULTS = (): void => {
        window.scrollBy(0, Math.max(600, window.innerHeight));
        document.querySelectorAll('*').forEach((el: any) => {
          if (!el || typeof el.scrollHeight !== 'number') return;
          if (el.scrollHeight > el.clientHeight + 80 && el.clientHeight > 120) el.scrollTop = el.scrollTop + el.clientHeight;
        });
      };

      // Read the expanded Show-on-Map result surface. A result is any compact
      // element carrying a price plus either acreage, an APN, or a street-style
      // address. Each row is returned as "<section label><row text>" so the
      // parser can read the page's OWN wording for sold/active status instead of
      // guessing. Any result link href is appended so the row keeps a source URL.
      const MAP_ROWS = (): string[] => {
        const out: string[] = []; const seen = new Set<string>();
        const STREET = /(rd|road|st|street|ave|avenue|dr|drive|ln|lane|hwy|highway|blvd|trl|trail|way|ct|court|pl|place|cir|circle|pike|pkwy)/i;
        const labelFor = (el: any): string => {
          let node: any = el;
          for (let hop = 0; hop < 6 && node; hop += 1) {
            let sib: any = node.previousElementSibling;
            while (sib) {
              const tag = (sib.tagName || '').toLowerCase();
              const text = (sib.textContent || '').replace(/\s+/g, ' ').trim();
              if (text && text.length < 120 && (/^h[1-6]$/.test(tag) || /title|heading|header|label|tab/i.test(sib.className || ''))) return text;
              sib = sib.previousElementSibling;
            }
            node = node.parentElement;
          }
          const region = el.closest ? el.closest('[aria-label]') : null;
          return region ? String(region.getAttribute('aria-label') || '') : '';
        };
        const linkFor = (el: any): string => {
          const a = el.querySelector ? el.querySelector('a[href]') : null;
          const own = el.closest ? el.closest('a[href]') : null;
          const href = (a && a.getAttribute('href')) || (own && own.getAttribute('href')) || '';
          if (!href || /^javascript:/i.test(href)) return '';
          try { return new URL(href, location.href).toString(); } catch { return ''; }
        };
        document.querySelectorAll('*').forEach((el: any) => {
          if (!el || (el.querySelectorAll && el.querySelectorAll('*').length > 12)) return;
          const t = (el.textContent || '').replace(/\s+/g, ' ').replace(/[›»]/g, '').trim();
          if (!t || t.length > 260) return;
          if (!/\$[\d,]+/.test(t)) return;
          if (!(/acres?\s*:?\s*[\d.]/i.test(t) || /APN/i.test(t) || STREET.test(t))) return;
          if (seen.has(t)) return;
          seen.add(t);
          const href = linkFor(el);
          out.push(labelFor(el) + '' + t + (href ? ' | URL: ' + href : ''));
        });
        return out.slice(0, 60);
      };

      try {
        try { await (page as unknown as { setViewport?: (v: { width: number; height: number }) => Promise<void> }).setViewport?.({ width: 1600, height: 1000 }); } catch { /* best-effort */ }
        // Activate the capture tab ONLY inside the LandOS-spawned BACKGROUND
        // window: it sits offscreen at -32000, so activating a tab there can
        // never appear over the operator's work. A pre-existing visible Chrome
        // window is never raised — that was the focus-steal defect. Lane pages
        // become their window's selected tab at creation, and the capture gate
        // keeps another capture from de-selecting this one mid-run.
        if (state.launchedBackground) {
          try { await (page as unknown as { bringToFront?: () => Promise<void> }).bringToFront?.(); } catch { /* best-effort */ }
        }
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
        } catch (error) {
          // LandPortal's map SPA can exceed the navigation event deadline while
          // continuing to render the correct parcel in the same tab. Do not fail
          // on that event alone; the authenticated panel, identity fields, map,
          // and painted-tile gates below decide whether the page is usable.
          logger.warn({ event: 'landportal_navigation_timeout_continuing', error: error instanceof Error ? error.message : String(error) }, 'landportal_navigation_timeout_continuing');
        }
        // The blind 6500ms settle that used to sit here is folded into the
        // property-panel poll below, which waits for the same thing and is the
        // only signal that actually decides whether the page is usable.
        await sleep(250);
        logger.info({ event: 'landportal_capture_navigated' }, 'landportal_capture_navigated');
        // The generic popup closer was intentionally skipped here because the
        // parcel-detail sidebar also has a Close button. That decision is the
        // root cause of the repeated skip-tracing ad in retained screenshots:
        // the late offer stayed over the map and full-page capture preserved it.
        // Capture cleanup below targets only obstructions overlapping the map,
        // leaving the parcel sidebar open for identity and fact extraction.
        // LandPortal's logged-out shell still accepts the property query string
        // and renders state/county/APN text over a national map. That is not a
        // parcel visual. Require the authenticated property panel and a rendered
        // map before any screenshot can be treated as evidence.
        const readParcelSignals = () => page.evaluate<{ authenticated: boolean; propertyPanel: boolean; mapRendered: boolean; hasPropertyHeading: boolean; hasParcelField: boolean; hasOwnerField: boolean }>((() => {
          const text = ((document.body && (document.body as any).innerText) || '').replace(/\s+/g, ' ');
          const authenticated = /\blogout\b/i.test(text) && !/\blog\s*in\b/i.test(text.slice(0, 1200));
          const hasPropertyHeading = /property\s+(?:overview|details)/i.test(text);
          const hasParcelField = /parcel\s+(?:id|address)/i.test(text);
          const hasOwnerField = /owner\s+(?:name|of\s+record)/i.test(text);
          const propertyPanel = hasPropertyHeading && hasParcelField && hasOwnerField;
          const mapRendered = !!document.querySelector('canvas,.mapboxgl-canvas,.leaflet-container,[class*="map" i] canvas,[id*="map" i]');
          return { authenticated, propertyPanel, mapRendered, hasPropertyHeading, hasParcelField, hasOwnerField };
        }) as unknown as () => { authenticated: boolean; propertyPanel: boolean; mapRendered: boolean; hasPropertyHeading: boolean; hasParcelField: boolean; hasOwnerField: boolean });
        // Same 22.5s ceiling as the previous 6500ms pre-wait plus 8x2000ms poll,
        // but it exits the moment the authenticated property panel is present.
        let parcelSignals = await readParcelSignals();
        await pollUntil(async () => {
          parcelSignals = await readParcelSignals();
          return parcelSignals.propertyPanel;
        }, 22_500);
        // A newly opened authenticated LandPortal tab occasionally paints only
        // the account shell on its first deep-link navigation. Re-open the exact
        // parcel URL once before giving up; this is still read-only and avoids
        // treating a transient client-side route miss as an expired session.
        if (parcelSignals.authenticated && !parcelSignals.propertyPanel) {
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
          } catch (error) {
            logger.warn({ event: 'landportal_navigation_timeout_continuing', retry: true, error: error instanceof Error ? error.message : String(error) }, 'landportal_navigation_timeout_continuing');
          }
          // Same 25s ceiling as the previous 9000ms pre-wait plus 8x2000ms poll.
          await pollUntil(async () => {
            parcelSignals = await readParcelSignals();
            return parcelSignals.propertyPanel;
          }, 25_000);
        }
        if (!parcelSignals.authenticated || !parcelSignals.propertyPanel || !parcelSignals.mapRendered) {
          logger.warn({ event: 'landportal_visual_rejected', reason: 'parcel_not_ready', ...parcelSignals }, 'landportal_visual_rejected');
          if (!parcelSignals.authenticated) {
            state.auth = { authenticated: false, atIso: now() };
            state.status = 'auth_needed';
          }
          return empty;
        }
        // Read facts only after the authenticated parcel panel is ready. The
        // former pre-readiness scrape could snapshot a partial SPA and its
        // generic two-span fallback could pair unrelated terrain values.
        const fieldsOut = await page.evaluate<{ fields: Record<string, string> }>(FIELDS as unknown as () => { fields: Record<string, string> });

        // ── DIRECT RETRIEVAL: LandPortal's own parcel endpoint ──────────────
        // The page we are already authenticated on serves itself from
        // `POST /wp-json/lp-internal/v1/single-property` with `{property_id,
        // fips}` — the identifiers already encoded in this URL. One ~1.5s call
        // returns 144 subject fields AND the comparables, including comp
        // coordinates the scrape never obtained (which is why every comp read
        // "location unresolved"). The fetch runs INSIDE the page so the session
        // cookie and REST nonce stay in the browser and are never handled here.
        //
        // This is retrieval only. Everything below it — the framed map,
        // overlay, terrain and 3D captures — still happens on CDP, because
        // there the rendered image IS the evidence.
        const apiIdentity = landPortalIdentityFromUrl(url);
        let apiSubject: { properties: Record<string, unknown> } | null = null;
        if (apiIdentity?.propertyId && apiIdentity.fips) {
          try {
            // `PageLike.evaluate` takes no arguments, so the request body is
            // embedded as JSON. Both values come from the parcel URL's own
            // base64 identity triple and are serialized, never concatenated.
            const requestBody = JSON.stringify({
              property_id: Number(apiIdentity.propertyId),
              fips: String(apiIdentity.fips),
            });
            apiSubject = await page.evaluate<{ properties: Record<string, unknown> } | null>(`(async () => {
              const nonce = (() => {
                for (const k of ['wpApiSettings', 'lpInternal', 'lp_internal']) {
                  const v = window[k] && window[k].nonce;
                  if (typeof v === 'string' && v) return v;
                }
                const m = /"nonce"\\s*:\\s*"([A-Za-z0-9]+)"/.exec(document.documentElement.innerHTML);
                return m ? m[1] : null;
              })();
              const headers = { 'content-type': 'application/json' };
              if (nonce) headers['X-WP-Nonce'] = nonce;
              const res = await fetch('/wp-json/lp-internal/v1/single-property', {
                method: 'POST', credentials: 'include', headers, body: ${JSON.stringify(requestBody)},
              });
              if (!res.ok) return null;
              const body = await res.json();
              const data = body && typeof body === 'object' && 'data' in body ? body.data : body;
              // Without the nonce this endpoint answers 200 with geometry only.
              // A payload with no 'properties' is not a usable subject read.
              return data && data.properties ? { properties: data.properties } : null;
            })()`);
          } catch (error) {
            logger.warn({ event: 'landportal_api_read_failed', error: error instanceof Error ? error.message : String(error) }, 'landportal_api_read_failed');
          }
        }
        if (apiSubject?.properties) {
          const apiFacts = landPortalFactsFromApi(apiSubject.properties);
          // The API is the stronger surface, so it wins on conflict; anything
          // only the panel stated is preserved rather than dropped.
          fieldsOut.fields = { ...(fieldsOut.fields ?? {}), ...apiFacts };
          const similars = landPortalSimilarsFrom(apiSubject.properties);
          apiCompCards = landPortalCompCardsFromApi(similars);
          apiCompDetails = landPortalCompDetailsFromApi(similars);
          logger.info({
            event: 'landportal_api_subject_read',
            factCount: Object.keys(apiFacts).length,
            comps: apiCompCards.length,
          }, 'landportal_api_subject_read');
          // HAND THE SUBJECT OVER NOW. The parcel facts are complete at this
          // point; everything below is imagery, and the identity lane used to
          // wait the whole capture out for data it already had. This only
          // announces what was read — the capture continues exactly as before,
          // and a consumer that throws cannot affect it.
          if (opts.onSubjectFacts) {
            try { opts.onSubjectFacts({ url, fields: { ...(fieldsOut.fields ?? {}) } }); }
            catch (error) {
              logger.warn({ event: 'landportal_subject_facts_handoff_failed', error: error instanceof Error ? error.message : String(error) }, 'landportal_subject_facts_handoff_failed');
            }
          }
        }
        // Capture only the painted map canvas, never the full LandPortal page.
        // Before every frame, remove visible ads/offers/modals/chat/banner UI
        // that overlaps the map. The parcel-detail sidebar is deliberately not
        // touched; the clip excludes it while it remains available for identity
        // and fact extraction.
        const PREPARE_MAP_CAPTURE = (): { clip: MapViewportClip | null; viewport: { width: number; height: number }; obstructions: string[]; dismissed: number; hiddenChrome: number } => {
          const visible = (el: any): boolean => {
            if (!el?.getBoundingClientRect) return false;
            const rect = el.getBoundingClientRect();
            const style = (window as any).getComputedStyle?.(el);
            return rect.width > 2 && rect.height > 2
              && !(style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.1));
          };
          const canvases = Array.from(document.querySelectorAll(
            'canvas.mapboxgl-canvas,.leaflet-container,[class*="map" i] canvas,[id*="map" i] canvas,canvas',
          )).filter(visible) as any[];
          const map = canvases
            .map((el) => ({ el, rect: el.getBoundingClientRect() }))
            .filter(({ rect }) => rect.width >= 600 && rect.height >= 400)
            .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];
          const viewport = { width: window.innerWidth, height: window.innerHeight };
          if (!map) return { clip: null, viewport, obstructions: ['rendered map viewport missing'], dismissed: 0, hiddenChrome: 0 };
          const raw = map.rect;
          // LandPortal paints its compact right-edge toolbar (including the
          // vertical "LP Intelligence" rail and compass) over the final 32px
          // of the canvas. CSS visibility changes are not reliable for that
          // GPU-composited shell, so keep a small deterministic inset out of
          // every persisted map artifact. The subject remains centered and
          // the saved image contains map pixels only.
          const rightEdgeChromeInset = 40;
          const availableWidth = Math.min(
            window.innerWidth - Math.max(0, Math.floor(raw.left)),
            Math.floor(raw.width),
          );
          const clip = {
            x: Math.max(0, Math.floor(raw.left)),
            y: Math.max(0, Math.floor(raw.top)),
            width: Math.max(1, availableWidth - rightEdgeChromeInset),
            height: Math.min(window.innerHeight - Math.max(0, Math.floor(raw.top)), Math.floor(raw.height)),
          };
          const overlap = (rect: any): boolean =>
            rect.left < clip.x + clip.width && rect.right > clip.x
            && rect.top < clip.y + clip.height && rect.bottom > clip.y;
          const obstructionRx = /skip.?trac|buy tokens|advert|special offer|upgrade|subscribe|chat|cookie|tooltip|promotion|report offer|enhance your leads/i;
          const direct = Array.from(document.querySelectorAll(
            '[role=dialog],[aria-modal=true],iframe,[class*="modal" i],[class*="advert" i],[class*="banner" i],[class*="chat" i],[class*="tooltip" i],[class*="intercom" i],[class*="popup" i]',
          ));
          // The current skip-tracing offer uses a generic container without a
          // stable modal class. Locate it by live text and walk up to the
          // overlapping positioned card that owns its close control.
          const textMatches = Array.from(document.querySelectorAll('body *'))
            .filter((el: any) => {
              const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
              return text.length > 0 && text.length < 900 && obstructionRx.test(text);
            })
            .map((el: any) => {
              let node = el;
              for (let hop = 0; hop < 6 && node?.parentElement; hop += 1) {
                const rect = node.getBoundingClientRect();
                const style = (window as any).getComputedStyle?.(node);
                const positioned = style && (style.position === 'fixed' || style.position === 'absolute');
                if (positioned && rect.width >= 180 && rect.height >= 100) break;
                node = node.parentElement;
              }
              return node;
            });
          const candidates = [...new Set([...direct, ...textMatches])].filter((el: any) => {
            if (!visible(el) || el.contains(map.el)) return false;
            const text = String(el.textContent || el.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim();
            const rect = el.getBoundingClientRect();
            const style = (window as any).getComputedStyle?.(el);
            const positionedAboveMap = style
              && (style.position === 'fixed' || style.position === 'absolute')
              && Number.parseInt(style.zIndex || '0', 10) >= 10;
            return overlap(rect) && (
              obstructionRx.test(text)
              || /dialog|modal|advert|banner|chat|tooltip|intercom/i.test(String(el.className || ''))
              || el.tagName === 'IFRAME'
              || (positionedAboveMap && rect.width >= 180 && rect.height >= 100)
            );
          }) as any[];
          let dismissed = 0;
          for (const el of candidates) {
            const close = Array.from(el.querySelectorAll?.('button,a,[role=button]') ?? []).find((button: any) =>
              /^(?:close|dismiss|no thanks|not now|×|x)$/i.test(
                String(button.textContent || button.getAttribute?.('aria-label') || button.getAttribute?.('title') || '').replace(/\s+/g, ' ').trim(),
              )) as any;
            try {
              if (close) close.click();
              else {
                el.setAttribute('data-landos-capture-hidden', 'true');
                el.style.setProperty('display', 'none', 'important');
              }
              dismissed++;
            } catch { /* final obstruction scan rejects the frame */ }
          }
          const remaining = candidates.filter(visible).map((el: any) =>
            String(el.textContent || el.getAttribute?.('aria-label') || el.className || 'visual obstruction')
              .replace(/\s+/g, ' ').trim().slice(0, 80));
          // A map-only business artifact must also omit LandPortal's ordinary
          // floating controls. Hide them only for the screenshot and restore
          // immediately afterwards so later overlay/terrain actions still work.
          const chromeSeeds = Array.from(document.querySelectorAll(
            'button,[role=button],.mapboxgl-ctrl-group,.lp-map-controls,.mapboxgl-ctrl-compass,[aria-label*="compass" i],[title*="compass" i],[class*="intelligence" i]',
          ))
            .filter((el: any) => {
              const rect = el.getBoundingClientRect();
              return visible(el) && overlap(rect) && !el.contains(map.el)
                && rect.width <= 220 && rect.height <= 700;
            });
          // Hiding only the button glyph/text can leave its styled toolbar shell
          // behind as an empty dark block. Promote each control to the highest
          // compact wrapper that is still wholly floating over the map. The
          // width cap prevents this walk from ever reaching the map/page shell.
          const captureChromeWrapper = (seed: any): any => {
            let node = seed;
            for (let hop = 0; hop < 5 && node.parentElement; hop += 1) {
              const parent = node.parentElement;
              if (parent.contains(map.el)) break;
              const rect = parent.getBoundingClientRect();
              const style = (window as any).getComputedStyle?.(parent);
              const className = String(parent.className || '');
              const compactFloatingWrapper = overlap(rect)
                && rect.width > 2 && rect.height > 2
                && rect.width <= 220 && rect.height <= 700
                && (
                  style?.position === 'fixed'
                  || style?.position === 'absolute'
                  || /ctrl|control|toolbar|button-group|map-tools|mapbox/i.test(className)
                  || Math.abs(rect.width - node.getBoundingClientRect().width) <= 8
                );
              if (!compactFloatingWrapper) break;
              node = parent;
            }
            return node;
          };
          const chromeNodes = chromeSeeds.map(captureChromeWrapper);
          const intelligenceLabel = Array.from(document.querySelectorAll('body *')).find((el: any) =>
            visible(el)
            && overlap(el.getBoundingClientRect())
            && /^LP Intelligence$/i.test(String(el.textContent || '').replace(/\s+/g, ' ').trim()));
          if (intelligenceLabel) {
            let node: any = intelligenceLabel;
            for (let hop = 0; hop < 3 && node.parentElement; hop += 1) {
              const parent = node.parentElement;
              const text = String(parent.textContent || '').replace(/\s+/g, ' ').trim();
              const rect = parent.getBoundingClientRect();
              if (!/^LP Intelligence$/i.test(text) || rect.width > 180 || rect.height > 650) break;
              node = parent;
            }
            chromeNodes.push(captureChromeWrapper(node));
          }
          let hiddenChrome = 0;
          for (const el of [...new Set(chromeNodes)] as any[]) {
            if (el.hasAttribute?.('data-landos-capture-chrome-hidden')) continue;
            el.setAttribute?.('data-landos-capture-chrome-hidden', 'true');
            el.style?.setProperty('visibility', 'hidden', 'important');
            hiddenChrome += 1;
          }
          return { clip, viewport, obstructions: remaining, dismissed, hiddenChrome };
        };
        const RESTORE_MAP_CAPTURE_CHROME = (): void => {
          document.querySelectorAll('[data-landos-capture-chrome-hidden]').forEach((el: any) => {
            el.style?.removeProperty('visibility');
            el.removeAttribute?.('data-landos-capture-chrome-hidden');
          });
        };
        const captureMapViewport = async (file: string, kind: ParcelVisualCaptureKind): Promise<boolean> => {
          for (let attempt = 1; attempt <= 2; attempt += 1) {
            // Wait -> inspect live page -> dismiss -> re-inspect. Repeating this
            // pass is essential because the skip-tracing offer arrives after
            // the parcel map has already painted.
            await sleep(attempt === 1 ? 1800 : 900);
            await page.evaluate(PREPARE_MAP_CAPTURE as unknown as () => { clip: MapViewportClip | null; viewport: { width: number; height: number }; obstructions: string[]; dismissed: number; hiddenChrome: number });
            await sleep(900);
            const frame = await page.evaluate(PREPARE_MAP_CAPTURE as unknown as () => { clip: MapViewportClip | null; viewport: { width: number; height: number }; obstructions: string[]; dismissed: number; hiddenChrome: number });
            const verdict = assessMapViewportFrame({ clip: frame.clip, viewport: frame.viewport, obstructions: frame.obstructions });
            if (!verdict.accepted || !frame.clip) {
              await page.evaluate(RESTORE_MAP_CAPTURE_CHROME as unknown as () => void);
              logger.warn({ event: 'landportal_visual_rejected', attempt, reason: verdict.reason }, 'landportal_visual_rejected');
              continue;
            }
            let saved: ReturnType<typeof inspectSavedParcelVisual>;
            let after: { clip: MapViewportClip | null; viewport: { width: number; height: number }; obstructions: string[]; dismissed: number; hiddenChrome: number };
            try {
              await page.screenshot({ path: file, clip: frame.clip });
              // Inspect the saved PNG itself (dimensions, bytes and hash), then
              // inspect the live page once more. If a late offer appeared during
              // the screenshot, dismissed > 0 proves that saved frame may contain
              // it, so delete and recapture rather than persisting contamination.
              saved = inspectSavedParcelVisual({ filePath: file, kind, expectedClip: frame.clip });
              after = await page.evaluate(PREPARE_MAP_CAPTURE as unknown as () => { clip: MapViewportClip | null; viewport: { width: number; height: number }; obstructions: string[]; dismissed: number; hiddenChrome: number });
            } finally {
              await page.evaluate(RESTORE_MAP_CAPTURE_CHROME as unknown as () => void);
            }
            if (saved.accepted && after.dismissed === 0 && after.obstructions.length === 0) return true;
            try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* rejected capture stays unpromoted */ }
            logger.warn({
              event: 'landportal_visual_rejected',
              attempt,
              reason: saved.reason ?? (after.dismissed > 0 ? 'late obstruction appeared during saved-image capture.' : after.obstructions.join(', ')),
            }, 'landportal_visual_rejected');
          }
          return false;
        };
        const overlayShots: Array<{ overlay: string; path: string; purpose: string }> = [];
        const buttonState = async (name: string): Promise<boolean> => page.evaluate<boolean>(((expected: string) => {
          const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
          const wanted = normalize(expected);
          const visible = (el: any): boolean => {
            if (!el || !el.getBoundingClientRect) return false;
            const rect = el.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) return false;
            const style = (window as any).getComputedStyle ? (window as any).getComputedStyle(el) : null;
            return !(style && (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') < 0.1));
          };
          return Array.from(document.querySelectorAll('button,[role=button]')).some((el: any) => {
            if (!visible(el)) return false;
            const accessibleName = el.getAttribute?.('aria-label') || el.getAttribute?.('title') || el.textContent || '';
            return normalize(accessibleName) === wanted;
          });
        }) as unknown as () => boolean, name);
        const clickNamedButton = async (name: string): Promise<boolean> => page.evaluate<boolean>(((expected: string) => {
          const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
          const wanted = normalize(expected);
          const visible = (el: any): boolean => {
            if (!el || !el.getBoundingClientRect) return false;
            const rect = el.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) return false;
            const style = (window as any).getComputedStyle ? (window as any).getComputedStyle(el) : null;
            return !(style && (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') < 0.1));
          };
          const button = Array.from(document.querySelectorAll('button,[role=button]')).find((el: any) => {
            if (!visible(el)) return false;
            const accessibleName = el.getAttribute?.('aria-label') || el.getAttribute?.('title') || el.textContent || '';
            return normalize(accessibleName) === wanted;
          }) as any || (wanted === 'zoom out'
            ? document.querySelector('button.mapboxgl-ctrl-zoom-out,.leaflet-control-zoom-out,button[aria-label*="zoom out" i],button[title*="zoom out" i]')
            : wanted === 'fit'
              ? document.querySelector('button[class*="fit" i],button[aria-label*="fit" i],button[title*="fit" i]')
              : null) as any;
          if (!button) return false;
          button.click();
          return true;
        }) as unknown as () => boolean, name);
        const focusMapCanvas = async (): Promise<boolean> => page.evaluate<boolean>((() => {
          const canvas = document.querySelector('canvas.mapboxgl-canvas, canvas');
          if (!canvas) return false;
          canvas.setAttribute('tabindex', '0');
          canvas.focus();
          return document.activeElement === canvas;
        }) as unknown as () => boolean);
        const zoomOutParcelMap = async (steps: number): Promise<number> => {
          let completed = 0;
          for (let step = 0; step < steps; step++) {
            let driven = false;
            if (page.keyboard && await focusMapCanvas()) {
              await page.keyboard.press('-');
              driven = true;
            } else {
              driven = await clickNamedButton('Zoom out');
            }
            if (!driven) break;
            completed++;
            await sleep(950);
          }
          return completed;
        };
        const orientRoadBelowParcel = async (): Promise<number> => {
          if (!page.keyboard || !(await focusMapCanvas())) return 0;
          // LandPortal uses Mapbox's 10-degree Shift+Arrow bearing step. The
          // subject's road is north of the mapped polygon; a 180-degree bearing
          // puts the road-side foreground at the bottom and the property above.
          // Orientation is a framing nicety. Some Chrome/CDP builds reject the
          // combined "Shift+ArrowRight" chord outright ("Unknown key"), and an
          // unhandled throw here aborted the WHOLE capture — losing the parcel
          // screenshot, the sidebar comp rows AND the Show-on-Map surface. Fall
          // back to an explicit Shift down/up, then give up on rotation alone.
          try {
            for (let step = 0; step < 18; step++) {
              await page.keyboard.press('Shift+ArrowRight');
              await sleep(90);
            }
            return 180;
          } catch {
            const chorded = page.keyboard as unknown as { down?: (k: string) => Promise<void>; up?: (k: string) => Promise<void> };
            try {
              if (!chorded.down || !chorded.up) throw new Error('chorded keyboard unavailable');
              await chorded.down('Shift');
              for (let step = 0; step < 18; step++) {
                await page.keyboard.press('ArrowRight');
                await sleep(90);
              }
              await chorded.up('Shift');
              return 180;
            } catch {
              logger.warn({ event: 'landportal_visual_orientation', reason: 'bearing_rotation_unsupported' }, 'landportal_visual_orientation');
              return 0;
            }
          }
        };
        const raiseTerrainCamera = async (): Promise<boolean> => {
          if (!page.keyboard || !(await focusMapCanvas())) return false;
          try {
            if (page.keyboard.down && page.keyboard.up) {
              await page.keyboard.down('Shift');
              for (let step = 0; step < 7; step++) await page.keyboard.press('ArrowUp');
              await page.keyboard.up('Shift');
            } else {
              for (let step = 0; step < 7; step++) await page.keyboard.press('Shift+ArrowUp');
            }
            return true;
          } catch {
            return false;
          }
        };
        // The default parcel view fills the frame with the subject and hides the
        // surrounding road/neighbor context. Normalize the camera to the parcel
        // first ("Fit" centers the subject with its complete boundary), then
        // step out a PARCEL-CONTEXT amount only: enough to keep the subject
        // centered at roughly a quarter of the frame with the ~5-8 immediately
        // surrounding parcels and the fronting road readable. The former FIXED
        // five-step zoom-out was the county-scale defect: each Mapbox step
        // doubles the linear extent, so five steps rendered the subject as a
        // tiny pin with its boundary sub-pixel. Refuse to save a misleading
        // tight crop if the site's zoom controls cannot be driven.
        await clickNamedButton('Fit');
        await sleep(1400);
        let closeParcelPath: string | null = null;
        if (!opts.captureLabels || opts.captureLabels.includes('close_parcel_aerial')) {
          const closeFile = path.join(dir, `landportal-close-${Date.now()}.png`);
          if (await captureMapViewport(closeFile, 'parcel_context')) closeParcelPath = closeFile;
        }
        // Every category resumes from a fresh Fit, never from the previous
        // capture's bearing, zoom, overlay, or terrain state.
        await clickNamedButton('Fit');
        await sleep(1400);
        const contextSteps = contextZoomOutSteps(parseAcresFromFields(fieldsOut.fields ?? {}));
        const zoomedOutSteps = await zoomOutParcelMap(contextSteps);
        logger.info({ event: 'landportal_visual_zoom', completed: zoomedOutSteps, requested: contextSteps }, 'landportal_visual_zoom');
        if (zoomedOutSteps !== contextSteps) return empty;
        // Mapbox re-fetches/repaints satellite tiles after every camera change;
        // a 900 ms pause routinely captured only the gray base canvas.
        //
        // The old shape was a blind 16s wait, one capture, then a blind 10s wait
        // and a second capture. But the code already KNOWS what a painted tile
        // looks like: the size gate below. So capture on a short cadence and
        // stop the instant the bytes prove the satellite tiles painted, within
        // the same 26s total budget the two blind waits spent unconditionally.
        const parcelFile = path.join(dir, `landportal-parcel-${Date.now()}.png`);
        let parcelCaptureOk = false;
        const painted = await pollUntil(async () => {
          parcelCaptureOk = await captureMapViewport(parcelFile, 'parcel_context');
          if (!parcelCaptureOk) return false;
          try { return fs.statSync(parcelFile).size >= 500_000; } catch { return false; }
        }, 26_000);
        if (!parcelCaptureOk) return empty;
        if (!painted) {
          // Budget spent without a painted frame. Keep the original last-chance
          // recapture so behaviour at the ceiling is unchanged.
          if (!(await captureMapViewport(parcelFile, 'parcel_context'))) return empty;
        }
        if (fs.statSync(parcelFile).size < 500_000) {
          logger.warn({ event: 'landportal_visual_rejected', reason: 'satellite_tiles_unpainted', bytes: fs.statSync(parcelFile).size }, 'landportal_visual_rejected');
          return empty;
        }
        // Every capture hash from this pass. An overlay/terrain screenshot that
        // is byte-identical to the base parcel view (or to any earlier capture)
        // proves its layer never painted — it must never be saved under a new
        // label. That relabeled-base-map reuse was the identical-image defect.
        const capturedShas: string[] = [];
        const requestedCaptureLabels = new Set(opts.captureLabels ?? [
          'road_frontage_aerial', 'close_parcel_aerial', 'clean_parcel_aerial', 'wider_context',
          'wetlands_overlay', 'soil_overlay', 'contour_terrain_view', 'fema_flood_overlay',
          'front_side_3d', 'rear_side_3d',
        ]);
        const fieldShowsImpact = (pattern: RegExp): boolean => Object.entries(fieldsOut.fields ?? {}).some(([key, raw]) => {
          if (!pattern.test(key)) return false;
          const value = String(raw ?? '').trim().toLowerCase();
          if (!value || /^(?:none|no|n\/a|not present|0(?:\.0+)?%?)$/.test(value)) return false;
          const numeric = Number(value.replace(/[^0-9.-]/g, ''));
          if (Number.isFinite(numeric)) return numeric > 0;
          return /\b(?:yes|present|mapped|within|intersects?|impact)\b/.test(value)
            && !/\b(?:outside|not|no)\b/.test(value);
        });
        if (!fieldShowsImpact(/wetland/i)) requestedCaptureLabels.delete('wetlands_overlay');
        if (!fieldShowsImpact(/fema|flood/i)) requestedCaptureLabels.delete('fema_flood_overlay');
        const threeDEligibility = evaluateThreeDCaptureEligibility(fieldsOut.fields ?? {});
        if (threeDEligibility.decision !== 'eligible') {
          requestedCaptureLabels.delete('front_side_3d');
          requestedCaptureLabels.delete('rear_side_3d');
        }
        const visualShots: Array<{
          label: string;
          path: string;
          kind: 'parcel_page' | 'overlay' | 'parcel_3d';
          purpose: string;
          overlay?: string;
          soilDetails?: Array<{ symbol: string | null; name: string | null; fields: Record<string, string> }>;
        }> = [];
        if (closeParcelPath && requestedCaptureLabels.has('close_parcel_aerial')) {
          visualShots.push({ label: 'close_parcel_aerial', path: closeParcelPath, kind: 'parcel_page', purpose: 'Full-boundary close parcel aerial' });
        }
        if (requestedCaptureLabels.has('clean_parcel_aerial')) {
          visualShots.push({ label: 'clean_parcel_aerial', path: parcelFile, kind: 'parcel_page', purpose: 'Full-boundary clean parcel aerial' });
        }
        if (requestedCaptureLabels.has('wider_context')) {
          visualShots.push({ label: 'wider_context', path: parcelFile, kind: 'parcel_page', purpose: 'Full-boundary wider parcel context' });
        }
        try { capturedShas.push(fileSha256(parcelFile)); } catch { /* gate degrades gracefully */ }
        const openOverlayDialog = async (): Promise<boolean> => {
          if (await buttonState('Close')) return true;
          const opened = await clickNamedButton('Basemaps and overlays');
          if (!opened) return false;
          await sleep(500);
          return buttonState('Close');
        };
        const closeOverlayDialog = async (): Promise<boolean> => {
          if (!(await buttonState('Close'))) return true;
          const closed = await clickNamedButton('Close');
          if (!closed) return false;
          await sleep(350);
          return !(await buttonState('Close'));
        };
        const overlayMisses: Array<{ overlay: string; reason: string }> = [];
        const collectVisibleSoilDetails = async (): Promise<Array<{ symbol: string | null; name: string | null; fields: Record<string, string> }>> => {
          if (!page.mouse) return [];
          const canvas = await page.evaluate<null | { left: number; top: number; width: number; height: number }>((() => {
            const candidates = Array.from(document.querySelectorAll('canvas')).map((el: any) => ({ rect: el.getBoundingClientRect() }))
              .filter((item: any) => item.rect.width > 600 && item.rect.height > 400)
              .sort((a: any, b: any) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
            const rect = candidates[0]?.rect;
            return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
          }) as unknown as () => null | { left: number; top: number; width: number; height: number });
          if (!canvas) return [];
          const found = new Map<string, { symbol: string | null; name: string | null; fields: Record<string, string> }>();
          const fractions = [0.28, 0.4, 0.5, 0.6, 0.72];
          for (const y of fractions) for (const x of fractions) {
            await page.mouse.move(canvas.left + canvas.width * x, canvas.top + canvas.height * y);
            await page.mouse.down(); await page.mouse.up();
            await sleep(500);
            const detail = await page.evaluate<null | { symbol: string | null; name: string | null; fields: Record<string, string> }>((() => {
              const visible = (el: any) => {
                const rect = el?.getBoundingClientRect?.(); const style = el ? window.getComputedStyle(el) : null;
                return !!rect && rect.width > 10 && rect.height > 10 && style?.display !== 'none' && style?.visibility !== 'hidden';
              };
              const popup = Array.from(document.querySelectorAll('.mapboxgl-popup,.leaflet-popup,[role=dialog]')).find(visible) as any;
              if (!popup) return null;
              const fields: Record<string, string> = {};
              popup.querySelectorAll('tr').forEach((row: any) => {
                const cells = row.querySelectorAll('th,td');
                if (cells.length >= 2) {
                  const key = String(cells[0].textContent || '').replace(/\s+/g, ' ').trim();
                  const value = String(cells[1].textContent || '').replace(/\s+/g, ' ').trim();
                  if (key && value) fields[key] = value;
                }
              });
              const text = String(popup.innerText || '').replace(/\s+/g, ' ').trim();
              for (const line of text.split(/\n|\s{2,}/)) {
                const match = line.match(/^([^:]{2,60}):\s*(.{1,180})$/);
                if (match && !fields[match[1].trim()]) fields[match[1].trim()] = match[2].trim();
              }
              if (!Object.keys(fields).length) return null;
              const entries = Object.entries(fields);
              const symbol = entries.find(([key]) => /map.?unit|symbol|abbr/i.test(key))?.[1] ?? null;
              const name = entries.find(([key]) => /soil|map.?unit.*name|series/i.test(key))?.[1] ?? null;
              return { symbol, name, fields };
            }) as unknown as () => null | { symbol: string | null; name: string | null; fields: Record<string, string> });
            if (detail) found.set(`${detail.symbol ?? ''}|${detail.name ?? ''}|${JSON.stringify(detail.fields)}`, detail);
            try { await page.keyboard?.press('Escape'); } catch { /* popup close is best effort */ }
          }
          return [...found.values()];
        };
        if (requestedCaptureLabels.has('road_frontage_aerial')) {
          await closeOverlayDialog();
          await clickNamedButton('Fit');
          await sleep(1400);
          const frontageZoom = await zoomOutParcelMap(contextSteps);
          if (frontageZoom === contextSteps) {
            await orientRoadBelowParcel();
            await sleep(7000);
            const frontageFile = path.join(dir, `landportal-frontage-${Date.now()}.png`);
            if (await captureMapViewport(frontageFile, 'parcel_context')) {
              visualShots.push({ label: 'road_frontage_aerial', path: frontageFile, kind: 'parcel_page', purpose: 'Full-boundary road frontage aerial' });
            }
          }
        }
        const captureOverlay = async (overlay: string, candidates: string[], purpose: string): Promise<void> => {
          try {
            const semanticLabel = /wetland/i.test(overlay)
              ? 'wetlands_overlay'
              : /soil/i.test(overlay)
                ? 'soil_overlay'
                : /contour/i.test(overlay)
                  ? 'contour_terrain_view'
                  : /fema|flood/i.test(overlay)
                    ? 'fema_flood_overlay'
                    : purpose;
            if (!requestedCaptureLabels.has(semanticLabel)) return;
            await closeOverlayDialog();
            await clickNamedButton('Reset map rotation to north');
            await clickNamedButton('Fit');
            await sleep(1400);
            if (await zoomOutParcelMap(contextSteps) !== contextSteps) {
              overlayMisses.push({ overlay, reason: 'the full-boundary camera baseline could not be established.' });
              return;
            }
            if (!(await openOverlayDialog())) {
              overlayMisses.push({ overlay, reason: 'the Basemaps and overlays dialog could not be opened.' });
              return;
            }
            // Resolve the control name LandPortal actually renders for this
            // overlay (e.g. "Contour Lines" vs "Contours").
            let label: string | null = null;
            for (const candidate of candidates) {
              if ((await buttonState(`Enable ${candidate}`)) || (await buttonState(`Disable ${candidate}`))) { label = candidate; break; }
            }
            if (!label) {
              await closeOverlayDialog();
              overlayMisses.push({ overlay, reason: 'no toggle control for this overlay exists in the current LandPortal workspace.' });
              return;
            }
            const enableName = `Enable ${label}`;
            const disableName = `Disable ${label}`;
            if (await buttonState(enableName)) await clickNamedButton(enableName);
            if (!(await buttonState(disableName))) {
              await closeOverlayDialog();
              overlayMisses.push({ overlay, reason: 'the overlay toggle never reported an enabled state.' });
              return;
            }
            // Let the toggled layer's tiles actually paint before the capture —
            // screenshotting right after the click is how the identical
            // base-map images were produced.
            await sleep(4500);
            if (!(await closeOverlayDialog())) {
              overlayMisses.push({ overlay, reason: 'the overlay dialog could not be closed for an unobstructed capture.' });
              return;
            }
            const file = path.join(dir, `${purpose}-${Date.now()}.png`);
            if (!(await captureMapViewport(file, 'overlay'))) {
              overlayMisses.push({ overlay, reason: 'a clean unobstructed map viewport could not be isolated.' });
              return;
            }
            // DISTINCTNESS GATE: byte-identical to the base parcel view (or any
            // earlier capture) means the layer never rendered. Wait once more
            // for slow tiles, then record the overlay as unavailable rather
            // than promoting a relabeled copy of the base map.
            let sha: string | null = null;
            try { sha = fileSha256(file); } catch { sha = null; }
            if (sha && !isDistinctOverlayCapture(sha, capturedShas)) {
              await sleep(6500);
              if (!(await captureMapViewport(file, 'overlay'))) {
                overlayMisses.push({ overlay, reason: 'the overlay frame became obstructed before recapture.' });
                return;
              }
              try { sha = fileSha256(file); } catch { sha = null; }
            }
            if (sha && !isDistinctOverlayCapture(sha, capturedShas)) {
              try { fs.unlinkSync(file); } catch { /* best-effort cleanup */ }
              overlayMisses.push({ overlay, reason: 'the toggled layer produced no visible change over the base map at parcel scale — no distinct overlay image exists to save.' });
            } else {
              const soilDetails = /soil/i.test(overlay) ? await collectVisibleSoilDetails() : [];
              if (sha) capturedShas.push(sha);
              overlayShots.push({ overlay, path: file, purpose });
              visualShots.push({ label: semanticLabel, path: file, kind: 'overlay', purpose, overlay, soilDetails });
            }
            if (await openOverlayDialog()) {
              if (await buttonState(disableName)) await clickNamedButton(disableName);
              await closeOverlayDialog();
            }
            await sleep(600);
          } catch { overlayMisses.push({ overlay, reason: 'overlay capture errored; the layer is recorded absent, never substituted.' }); }
        };
        for (const planned of OVERLAY_CAPTURE_PLAN) {
          await captureOverlay(planned.overlay, [...planned.candidates], planned.purpose);
        }
        let terrainShotPath: string | null = null;
        try {
          await closeOverlayDialog();
          await clickNamedButton('Reset map rotation to north');
          await clickNamedButton('Fit');
          await sleep(1400);
          if (await zoomOutParcelMap(contextSteps) !== contextSteps) throw new Error('3d full-boundary camera baseline unavailable');
          const terrainOn = await clickNamedButton('Toggle 3D terrain');
          if (terrainOn) {
            await sleep(4500);
            await raiseTerrainCamera();
            await sleep(3500);
            const terrainFile = path.join(dir, `landportal-terrain-${Date.now()}.png`);
            if (!(await captureMapViewport(terrainFile, 'terrain'))) throw new Error('clean terrain viewport unavailable');
            // Same distinctness gate: a "terrain" frame identical to the flat
            // base capture proves 3D never engaged — keep it absent instead.
            let terrainSha: string | null = null;
            try { terrainSha = fileSha256(terrainFile); } catch { terrainSha = null; }
            if (terrainSha && !isDistinctOverlayCapture(terrainSha, capturedShas)) {
              try { fs.unlinkSync(terrainFile); } catch { /* best-effort cleanup */ }
            } else {
              if (terrainSha) capturedShas.push(terrainSha);
              terrainShotPath = terrainFile;
              if (requestedCaptureLabels.has('front_side_3d')) {
                visualShots.push({ label: 'front_side_3d', path: terrainFile, kind: 'parcel_3d', purpose: 'Raised full-footprint front 3D view' });
              }
              if (requestedCaptureLabels.has('rear_side_3d')) {
                await orientRoadBelowParcel();
                await sleep(5000);
                const rearFile = path.join(dir, `landportal-terrain-rear-${Date.now()}.png`);
                if (await captureMapViewport(rearFile, 'terrain')) {
                  const rearSha = fileSha256(rearFile);
                  if (isDistinctOverlayCapture(rearSha, capturedShas)) {
                    capturedShas.push(rearSha);
                    visualShots.push({ label: 'rear_side_3d', path: rearFile, kind: 'parcel_3d', purpose: 'Raised full-footprint rear 3D view' });
                  } else {
                    try { fs.unlinkSync(rearFile); } catch { /* rejected duplicate */ }
                  }
                }
              }
            }
          }
        } catch { terrainShotPath = null; }
        // Expand "View all" so every comp row is in the DOM, then read them.
        await page.evaluate(() => { const els = Array.from(document.querySelectorAll('button,a,span,div')) as any[]; const va = els.find((e) => /^view all/i.test((e.textContent || '').replace(/\s+/g, ' ').trim()) && (e.children || []).length === 0); if (va) va.click(); });
        await sleep(1500);
        const compRows = await page.evaluate<string[]>(COMP_ROWS as unknown as () => string[]);
        // Structured cards carry the status attribute and LandPortal's identity
        // triple. The text rows above stay as the fallback for an older layout.
        const compCards = await page.evaluate<string[]>(COMP_CARDS as unknown as () => string[]).catch(() => [] as string[]);
        // Click the real comps "Show on Map" anchor (free; never the paid Comp Report).
        //
        // THE ONE INTERACTION THAT FOREGROUNDED CHROME. LandPortal publishes this
        // anchor with target="_blank", so the click made the PAGE open the comps
        // map in a new tab. A page-opened target is not ours to create, so
        // `Target.createTarget({background:true})` cannot apply to it, and Chrome
        // always activates a tab a page opens — which is what put LandPortal over
        // the operator's work. A CDP target trace proved it: the comps target
        // carried `openerId` = our lane page and was the only one that ever
        // became its window's active tab.
        //
        // The click itself is UNCHANGED. The popup is cancelled upstream, at
        // document start, by `SUPPRESS_POPUPS_JS` — which suppresses the new
        // target WITHOUT navigating this tab, so the lane stays on the parcel
        // page exactly as it did in the verified runs. Retargeting the anchor to
        // `_self` was tried and rejected: it sent the lane into LandPortal's
        // heavy comps SPA and blew the lane's time budget.
        const mapReached = await page.evaluate<boolean>((() => { const a = (document.querySelector('a.js-lp-estimate-show-on-map') as any) || Array.from(document.querySelectorAll('a')).find((x: any) => /^show on map$/i.test((x.textContent || '').trim())); if (a) { a.scrollIntoView(); a.click(); return true; } return false; }) as unknown as () => boolean);
        await sleep(6000);
        let compsMapShotPath: string | null = null;
        let mapRows: string[] = [];
        if (mapReached) {
          const compsFile = path.join(dir, `landportal-compsmap-${Date.now()}.png`);
          if (await captureMapViewport(compsFile, 'comps_map')) compsMapShotPath = compsFile;
          // The expanded results view lazy-loads its result list. Scroll every
          // scrollable container (and the window) a few times so rows below the
          // fold enter the DOM before reading. Read-only: scrolling only.
          for (let pass = 0; pass < 4; pass += 1) {
            await page.evaluate(SCROLL_RESULTS as unknown as () => void);
            await sleep(1400);
          }
          mapRows = await page.evaluate<string[]>(MAP_ROWS as unknown as () => string[]);
          const listFile = path.join(dir, `landportal-compslist-${Date.now()}.png`);
          try { await page.screenshot({ path: listFile }); } catch { /* screenshot is best-effort */ }
        }

        // ── Second surface: each comparable's OWN LandPortal parcel page ──────
        //
        // "Show on Map" pins these comps on the map; the pin's destination is
        // the comp's own parcel page, which is where the street address, the
        // sale date and the land-versus-improvement facts live. The sidebar row
        // carries none of them. Rebuilding that URL from the card's identity
        // triple reaches the same surface deterministically, without depending
        // on hit-testing a map pin.
        //
        // Read-only, in a SEPARATE tab so the authenticated subject tab is never
        // navigated away from, and the tab is always closed again.
        // The direct endpoint already returned every one of these facts for
        // every comparable, so the sequential drill-down is skipped outright.
        const compDetails: string[] = apiCompDetails ?? [];
        if (!apiCompDetails && compCards.length) {
          let detailPage: PageLike | null = null;
          try {
            // Background: this comp-detail tab is pure reading, and activating
            // it would put LandPortal over the operator's work mid-run.
            detailPage = await openResearchTab(state.browser);
            trackTempSessionPage(detailPage, workflowOwner);
            for (const raw of compCards.slice(0, 12)) {
              let card: { apn?: string | null; fips?: string | null; propertyId?: string | null } = {};
              try { card = JSON.parse(raw); } catch { continue; }
              if (!card.apn || !card.fips || !card.propertyId) continue;
              // Same token format the subject parcel URL uses: the query string
              // "fips=..&apn=..&propertyid=.." base64-encoded, spaces as '+'.
              const token = Buffer.from(
                `fips=${card.fips}&apn=${String(card.apn).replace(/ /g, '+')}&propertyid=${card.propertyId}`,
                'utf8',
              ).toString('base64');
              const detailUrl = `https://landportal.com/?property=${token}`;
              try {
                await detailPage.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(60_000, opts.timeoutMs) });
                // Was a blind 7s per comparable, paid twelve times in sequence:
                // ~2 minutes of the capture spent waiting on pages that are
                // usually ready in well under a second. The read itself is the
                // readiness signal, so run it on a short cadence and stop as
                // soon as it yields facts, inside the same 7s ceiling.
                let facts: Record<string, string> = {};
                await pollUntil(async () => {
                  facts = await detailPage!.evaluate<Record<string, string>>(COMP_DETAIL as unknown as () => Record<string, string>);
                  return Object.keys(facts ?? {}).length > 0;
                }, 7_000);
                compDetails.push(JSON.stringify({ apn: card.apn, propertyId: card.propertyId, sourceUrl: detailUrl, facts }));
              } catch {
                // One unreachable comp page never fails the capture; the row
                // simply keeps only what the sidebar surface stated.
              }
            }
          } catch { /* the enrichment tab is best-effort */ } finally {
            // Always close the tab this capture opened — an enrichment tab left
            // behind is exactly the browser-cleanup regression the operator sees.
            await releaseTempSessionPage(detailPage);
          }
        }
        // API comparables are the stronger surface: they carry the MLS status,
        // acreage, sale date and coordinates the sidebar row never stated.
        return { fields: fieldsOut.fields ?? {}, parcelShotPath: parcelFile, compsMapShotPath, overlayShots, visualShots, overlayMisses, terrainShotPath, compRows: compRows ?? [], compCards: (apiCompCards?.length ? apiCompCards : compCards) ?? [], compDetails, mapRows: mapRows ?? [], mapReached, capturedAtIso: now() };
      } catch (error) {
        logger.warn({ event: 'landportal_visual_capture_failed', error: error instanceof Error ? error.message : String(error) }, 'landportal_visual_capture_failed');
        return empty;
      } finally {
        // The authenticated lane page is intentionally retained for the next
        // read-only mission; the driver owns its lifecycle.
      }
      };
      // ── GAP 2: THE GATE MAY NOT OUTLIVE THE RUN THAT HOLDS IT ───────────
      // Serialization is still correct (see the header above): two captures
      // interleaving on one Chrome window corrupt each other's framing. What
      // was wrong is that the gate was held for as long as the browser work
      // ran, with no relation to the budget its own caller had declared. A
      // capture whose caller had ALREADY given up — timed out, result
      // discarded — kept every later capture queued behind it. Measured: a run
      // launched at 00:23:35 entered at 00:29:59, so its 300s identity window
      // had expired before a single line of work began, for a retrieval that
      // takes four seconds.
      //
      // The successor therefore waits on this capture OR on this capture's own
      // declared timeout, whichever comes first. Nothing is cancelled and no
      // work is abandoned: an overrunning capture still finishes and still
      // returns to its caller, it simply stops being an unbounded queue for
      // everyone behind it. The queue cost it did impose is logged on entry.
      const run = landportalCaptureGate.then(work, work);
      const staleHoldMs = Math.max(1, opts.timeoutMs);
      landportalCaptureGate = Promise.race([
        run.then(() => undefined, () => undefined),
        new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            logger.warn({ event: 'landportal_capture_gate_released_stale', heldMs: staleHoldMs, url }, 'landportal_capture_gate_released_stale');
            resolve();
          }, staleHoldMs);
          (timer as unknown as { unref?: () => void }).unref?.();
        }),
      ]);
      return run;
    },
    // Full-panel read: opens the parcel's canonical deep link in a FRESH tab (the
    // reused working tab is throttled/stale and only paints the collapsed MLS
    // block), waits for the SPA to fully render, then captures label/value pairs
    // from definition lists, two-cell rows, AND two-span detail rows WITHOUT an
    // off-screen filter (LandPortal's valuation/zoning/environmental/terrain rows
    // sit below the fold as two-span rows). Closes the tab it opened; never closes
    // the operator's browser. Read-only navigation to the SAME verified parcel.
    async readFullPanel(url: string, opts: { timeoutMs: number }) {
      await ensureBrowserSession(deps);
      if (!state.browser) return { url, fields: {}, snippets: [] };
      const page = await openResearchTab(state.browser);
      trackTempSessionPage(page, workflowOwner);
      const FULL = (): { fields: Record<string, string>; snippets: string[] } => {
        const fields: Record<string, string> = {};
        const add = (k: string, v: string) => {
          const key = (k || '').replace(/\s+/g, ' ').trim().replace(/[:#]+$/, '');
          const val = (v || '').replace(/\s+/g, ' ').trim();
          if (key && val && key.length <= 48 && !fields[key]) fields[key] = val;
        };
        const hidden = (el: any): boolean => {
          if (!el) return true;
          const st = (window as any).getComputedStyle ? (window as any).getComputedStyle(el) : null;
          return !!(st && (st.display === 'none' || st.visibility === 'hidden'));
        };
        document.querySelectorAll('dl').forEach((dl: any) => { const dt = dl.querySelectorAll('dt'); const dd = dl.querySelectorAll('dd'); for (let i = 0; i < Math.min(dt.length, dd.length); i++) add(dt[i].textContent || '', dd[i].textContent || ''); });
        document.querySelectorAll('tr').forEach((tr: any) => { const c = tr.querySelectorAll('th,td'); if (c.length === 2) add(c[0].textContent || '', c[1].textContent || ''); });
        document.querySelectorAll('p,div,li').forEach((el: any) => { if (hidden(el)) return; const sp = el.querySelectorAll(':scope > span'); if (sp.length === 2) add(sp[0].textContent || '', sp[1].textContent || ''); });
        const snippets: string[] = [];
        document.querySelectorAll('h1,h2,h3').forEach((h: any) => { const t = (h.textContent || '').trim(); if (t) snippets.push(t.slice(0, 120)); });
        return { fields, snippets: snippets.slice(0, 8) };
      };
      try {
        // No bringToFront, and the tab above was created in the BACKGROUND, so
        // it is not even its window's selected tab. Reading a parcel panel must
        // never put LandPortal over the operator's work.
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
        await new Promise((r) => setTimeout(r, 6500)); // let the SPA fully render the detail panel
        const out = await page.evaluate<{ fields: Record<string, string>; snippets: string[] }>(FULL as unknown as () => { fields: Record<string, string>; snippets: string[] });
        return { url: page.url(), fields: out.fields ?? {}, snippets: out.snippets ?? [] };
      } finally {
        await releaseTempSessionPage(page);
      }
    },
    async readLinks() {
      const page = await getLanePage();
      const READ_LINKS = (): Array<{ text: string; href: string }> => {
        const out: Array<{ text: string; href: string }> = [];
        document.querySelectorAll('a[href]').forEach((a: any) => {
          const href = a.href || ''; const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
          if (href && /^https?:/i.test(href)) out.push({ text: text.slice(0, 100), href });
        });
        return out.slice(0, 400);
      };
      return page.evaluate<Array<{ text: string; href: string }>>(READ_LINKS);
    },
    async readForms() {
      const page = await getLanePage();
      const READ_FORMS = (): Array<{ formIndex: number; fields: any[]; submitLabel?: string; submitSelector?: string }> => {
        const labelFor = (el: any): string => {
          if (el.id) { const lab = document.querySelector('label[for="' + el.id + '"]'); if (lab && lab.textContent) return lab.textContent.replace(/\s+/g, ' ').trim(); }
          const wrap = el.closest && el.closest('label'); if (wrap && wrap.textContent) return wrap.textContent.replace(/\s+/g, ' ').trim();
          const prev = el.previousElementSibling; if (prev && prev.textContent && prev.textContent.length < 60) return prev.textContent.replace(/\s+/g, ' ').trim();
          return '';
        };
        const sel = (el: any): string => el.id ? '#' + (window as any).CSS.escape(el.id) : el.name ? '[name="' + el.name + '"]' : '';
        const forms = Array.from(document.querySelectorAll('form')).slice(0, 6);
        const list: Array<{ formIndex: number; fields: any[]; submitLabel?: string; submitSelector?: string }> = [];
        forms.forEach((form: any, formIndex: number) => {
          const fields: any[] = [];
          form.querySelectorAll('input, select, textarea').forEach((el: any) => {
            const type = (el.getAttribute('type') || el.tagName || 'text').toLowerCase();
            const s = sel(el);
            if (!s) return;
            fields.push({ selector: s, name: el.name || undefined, id: el.id || undefined, label: labelFor(el) || undefined, placeholder: el.placeholder || undefined, type });
          });
          const submit = form.querySelector('button[type=submit], input[type=submit], button, input[type=button]') as any;
          list.push({ formIndex, fields, submitLabel: submit ? (submit.value || submit.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) : undefined, submitSelector: submit ? sel(submit) : undefined });
        });
        return list;
      };
      return page.evaluate<Array<{ formIndex: number; fields: any[]; submitLabel?: string; submitSelector?: string }>>(READ_FORMS);
    },
    async fillAndSubmit(fieldSelector, value, submitSelector, opts) {
      const page = await getLanePage();
      const FILL = (sel: string, val: string, sub: string | null): boolean => {
        const el = document.querySelector(sel) as any; if (!el) return false;
        el.focus(); el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
        const subEl = sub ? (document.querySelector(sub) as any) : null;
        if (subEl) { subEl.click(); return true; }
        const form = el.closest('form'); if (form) { (form.requestSubmit ? form.requestSubmit() : form.submit()); return true; }
        return false;
      };
      await page.evaluate<boolean>(FILL as unknown as () => boolean, fieldSelector, value, submitSelector ?? null);
      // best-effort settle for navigation / async result render
      await new Promise((r) => setTimeout(r, Math.min(opts.timeoutMs, 3500)));
      const read = await readPage(page);
      return { url: read.url, fields: read.fields, snippets: read.snippets };
    },
    async observe() {
      const page = await getLanePage();
      const OBSERVE = (): unknown => {
        const cssEscape = (s: string) => (window as any).CSS && (window as any).CSS.escape ? (window as any).CSS.escape(s) : s;
        const sel = (el: any): string => el.id ? '#' + cssEscape(el.id) : el.name ? '[name="' + el.name + '"]' : '';
        const txt = (el: any, n = 60): string => ((el && el.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, n);
        // Visible-only: modern SPAs keep many hidden modals (login, saved-search,
        // purchase) in the DOM. Reading them pollutes classification + planning, so
        // skip display:none / visibility:hidden / zero-size / far-offscreen nodes.
        const vw = (window as any).innerWidth || 1280, vh = (window as any).innerHeight || 900;
        const vis = (el: any): boolean => {
          if (!el || !el.getBoundingClientRect) return false;
          const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false;
          const st = (window as any).getComputedStyle ? (window as any).getComputedStyle(el) : null;
          if (st && (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') < 0.1)) return false;
          if (r.bottom < 0 || r.top > vh + 200 || r.right < 0 || r.left > vw + 200) return false; // far offscreen
          return true;
        };
        const labelFor = (el: any): string => {
          if (el.id) { const lab = document.querySelector('label[for="' + el.id + '"]'); if (lab) return txt(lab); }
          const wrap = el.closest && el.closest('label'); if (wrap) return txt(wrap);
          const prev = el.previousElementSibling; if (prev && (prev.textContent || '').length < 60) return txt(prev);
          return '';
        };
        const headings = Array.from(document.querySelectorAll('h1,h2,h3')).filter(vis).map((h: any) => txt(h)).filter(Boolean).slice(0, 20);
        const navItems = Array.from(document.querySelectorAll('nav a, nav button, [class*="sidebar" i] a, [class*="sidebar" i] button, [class*="menu" i] a, [role=tab]')).filter(vis).map((a: any) => txt(a, 40)).filter(Boolean).slice(0, 40);
        const buttons = Array.from(document.querySelectorAll('button, input[type=submit], input[type=button], [role=button]')).filter(vis).map((b: any) => (b.value || txt(b, 40))).filter(Boolean).slice(0, 40);
        const searchControls: any[] = [];
        Array.from(document.querySelectorAll('input, select')).filter(vis).slice(0, 60).forEach((el: any) => {
          const type = (el.getAttribute('type') || el.tagName || 'text').toLowerCase();
          if (/hidden|checkbox|radio|file|submit|button/.test(type)) return;
          const s = sel(el); if (!s) return;
          const options = el.tagName === 'SELECT' ? Array.from(el.options || []).map((o: any) => txt(o, 40)).filter(Boolean).slice(0, 30) : undefined;
          searchControls.push({ selector: s, label: labelFor(el) || undefined, placeholder: el.placeholder || undefined, name: el.name || undefined, id: el.id || undefined, type: el.tagName === 'SELECT' ? 'select-one' : type, options });
        });
        const links: any[] = [];
        document.querySelectorAll('a[href]').forEach((a: any) => { const href = a.href || ''; if (href && /^https?:/i.test(href)) links.push({ text: txt(a, 80), href }); });
        const bodyText = (document.body && document.body.innerText) || '';
        const hasMap = !!(document.querySelector('.leaflet-container, .mapboxgl-canvas, [class*="esri" i], canvas, [class*="map" i] canvas, [id*="map" i]') || /\bmap\b/i.test(headings.join(' ')));
        const hasTable = !!document.querySelector('table tr');
        // visible label:value fields (definition lists, two-cell rows)
        const fields: Record<string, string> = {};
        const addF = (k: string, v: string) => { const key = (k || '').replace(/\s+/g, ' ').trim().replace(/[:#]+$/, ''); const val = (v || '').replace(/\s+/g, ' ').trim(); if (key && val && key.length <= 40 && !fields[key]) fields[key] = val; };
        document.querySelectorAll('dl').forEach((dl: any) => { const dts = dl.querySelectorAll('dt'); const dds = dl.querySelectorAll('dd'); for (let i = 0; i < Math.min(dts.length, dds.length); i++) addF(dts[i].textContent || '', dds[i].textContent || ''); });
        document.querySelectorAll('tr').forEach((tr: any) => { const cells = tr.querySelectorAll('th,td'); if (cells.length === 2) addF(cells[0].textContent || '', cells[1].textContent || ''); });
        // Two-span label:value rows (common in detail panels — e.g. a row with a
        // title span + a value span). Generic; captures custom property panels.
        document.querySelectorAll('p,div,li').forEach((el: any) => { if (!vis(el)) return; const sp = el.querySelectorAll(':scope > span'); if (sp.length === 2) addF(sp[0].textContent || '', sp[1].textContent || ''); });
        const loginLike = /sign in|log in|login|password/i.test(bodyText.slice(0, 2000)) && Object.keys(fields).length === 0;
        // Custom (non-<select>) search-method toggle: a visible, short clickable
        // pill whose text IS a method name (Address/APN/Owner/Parcel/Lat) and which
        // sits next to a text input (a search bar). Generic across SPAs.
        let methodToggle: { current: string } | undefined;
        const METHOD_WORD = /^(address|apn|parcel(\s*id)?|owner|lat(itude)?(\s*\/?\s*long(itude)?)?|coordinates?)$/i;
        const togCands = Array.from(document.querySelectorAll('button,[role=button],[aria-haspopup],[class*="dropdown" i] > *,[class*="select" i] *,div,span')).filter(vis);
        for (const el of togCands as any[]) {
          const tx = txt(el, 24);
          if (!METHOD_WORD.test(tx)) continue;
          const r = el.getBoundingClientRect();
          // must be near a visible text input (a search bar) on the same row
          const nearInput = Array.from(document.querySelectorAll('input')).filter(vis).some((inp: any) => { const ir = inp.getBoundingClientRect(); return Math.abs(ir.top - r.top) < 60 && ir.left > r.left - 20; });
          if (nearInput) { methodToggle = { current: tx }; break; }
        }
        // INTERMEDIATE-STATE signals for failure diagnosis (generic; visible only).
        const inView = (el: any): boolean => { const r = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 }; return r.width > 0 && r.height > 0; };
        const checkboxEls = Array.from(document.querySelectorAll('input[type=checkbox]')).filter(inView) as any[];
        const radioEls = Array.from(document.querySelectorAll('input[type=radio]')).filter(inView) as any[];
        const OPTION_SEL = '[role=option],[class*="autocomplete" i] li,[class*="autocomplete" i] [class*="item" i],[class*="suggestion" i],[class*="typeahead" i] li,[class*="result-item" i],[class*="dropdown-menu" i] li';
        const optionEls = Array.from(document.querySelectorAll(OPTION_SEL)).filter(inView) as any[];
        const submitEl = (Array.from(document.querySelectorAll('button[type=submit],input[type=submit],button,[role=button]')).filter(inView) as any[])
          .find((b: any) => /^(search|go|find|submit|apply|view\s*(parcel|property)?|open)$/i.test((b.value || b.textContent || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()));
        const submitDisabled = !!submitEl && (submitEl.disabled === true || submitEl.getAttribute('aria-disabled') === 'true' || /disabled/i.test(submitEl.className || ''));
        const VALID_SEL = '[role=alert],[class*="error" i],[class*="invalid" i],[class*="validation" i],[class*="required" i],[aria-invalid=true]';
        const validationMessages = Array.from(document.querySelectorAll(VALID_SEL)).filter(inView).map((e: any) => txt(e, 120)).filter((s: string) => s && s.length > 1).slice(0, 6);
        const hasModal = Array.from(document.querySelectorAll('[role=dialog],[aria-modal=true],[class*="modal" i],[class*="dialog" i]')).some(inView);
        const selectedOption = optionEls.some((o: any) => o.getAttribute('aria-selected') === 'true' || /(\bselected\b|\bactive\b|\bis-selected\b)/i.test(o.className || ''));
        const hasSelection = checkboxEls.some((c: any) => c.checked) || radioEls.some((r: any) => r.checked) || selectedOption;
        const filterActive = Array.from(document.querySelectorAll('[class*="filter" i][class*="active" i],[class*="chip" i],[class*="applied" i],[aria-pressed=true]')).some(inView);
        const interactive = {
          checkboxes: checkboxEls.length,
          radios: radioEls.length,
          selectableOptions: optionEls.length,
          submit: submitEl ? { present: true, disabled: submitDisabled, label: (submitEl.value || txt(submitEl, 20)) || undefined } : { present: false, disabled: false },
          validationMessages,
          hasModal,
          hasSelection,
          filterActive,
        };
        return { url: location.href, title: document.title || '', headings, navItems, buttons, searchControls, links: links.slice(0, 300), hasMap, hasTable, fields, loginLike, methodToggle, interactive };
      };
      return page.evaluate<unknown>(OBSERVE);
    },
    async selectByText(selector, optionText) {
      const page = await getLanePage();
      const SELECT = (s: string, t: string): boolean => {
        const el = document.querySelector(s) as any; if (!el) return false;
        if (el.tagName === 'SELECT') { const opt = Array.from(el.options).find((o: any) => (o.textContent || '').trim().toLowerCase().includes(t.toLowerCase())); if (opt) { el.value = (opt as any).value; el.dispatchEvent(new Event('change', { bubbles: true })); return true; } }
        return false;
      };
      await page.evaluate<boolean>(SELECT as unknown as () => boolean, selector, optionText);
      await new Promise((r) => setTimeout(r, 400));
    },
    async clickByText(text) {
      const page = await getLanePage();
      const CLICK = (t: string): boolean => {
        const els = Array.from(document.querySelectorAll('button, a, [role=tab], [role=button], li, span'));
        const el = els.find((e: any) => ((e.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === t.toLowerCase())) as any
          || els.find((e: any) => ((e.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase().includes(t.toLowerCase()) && (e.textContent || '').length < 40)) as any;
        if (el) { el.click(); return true; }
        return false;
      };
      await page.evaluate<boolean>(CLICK as unknown as () => boolean, text);
      await new Promise((r) => setTimeout(r, 1200));
    },
    async readCandidates() {
      const page = await getLanePage();
      return page.evaluate<Array<{ index: number; text: string; kind: string }>>(READ_CANDIDATES_JS);
    },
    async clickCandidate(index, opts) {
      const page = await getLanePage();
      // Locate first, in the SAME collector order readCandidates returned, and
      // get the on-screen box back so the click below can be a real one.
      const box = await page.evaluate<CandidateBox | null>(locateCandidateJs(index));
      if (box) {
        // REAL browser interaction. A dispatched `el.click()` is untrusted, and
        // several typeaheads (LandPortal's included) commit a suggestion only on
        // a genuine pointer sequence.
        let clicked = false;
        if (page.mouse && box.inViewport) {
          try {
            await page.mouse.move(box.x, box.y, { steps: 6 });
            await page.mouse.down();
            await page.mouse.up();
            clicked = true;
          } catch { /* fall through to the DOM click */ }
        }
        // The DOM click runs ONLY when the real click could not. Firing both
        // would be a second interaction on a page the first one may already
        // have navigated — clicking whatever now occupies that index.
        if (!clicked) await page.evaluate<boolean>(clickCandidateJs(index));
      }
      await new Promise((r) => setTimeout(r, Math.min(opts.timeoutMs, 2500))); // panel/popup settle
    },
    async typeSearch(selector, value, opts) {
      const page = await getLanePage();
      // Set the value via the native setter (React/Angular-safe) and dispatch the
      // input/keyup events that drive a debounced typeahead. Then nudge with real
      // keystrokes if available (some typeaheads only fire on trusted key events).
      const SET = ((s: string, v: string): boolean => {
        const el = document.querySelector(s) as any; if (!el) return false;
        el.focus();
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, v); else el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new (window as any).KeyboardEvent('keydown', { bubbles: true }));
        el.dispatchEvent(new (window as any).KeyboardEvent('keyup', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }) as unknown as () => boolean;
      await page.evaluate(SET, selector, value);
      if (page.type && page.keyboard) { try { await page.evaluate(((s: string) => { const i = document.querySelector(s) as any; if (i) i.focus(); }) as unknown as () => void, selector); await page.keyboard.press('Space'); await page.keyboard.press('Backspace'); } catch { /* best-effort nudge */ } }
      await new Promise((r) => setTimeout(r, Math.min(opts.timeoutMs, 3200))); // let the typeahead resolve
    },
    // Submit the current search AFTER a typeahead option was selected. LandPortal's
    // APN/Parcel-ID flow needs the matching parcel option ticked, THEN Search clicked
    // (selecting the option alone does not open the parcel). Two independent submit
    // paths so an icon-only Search button OR an Enter-only SPA both work:
    //   1) click a Search/Go/submit control (matched by text, aria-label, class, or
    //      being the submit button inside the search form), and
    //   2) RE-FOCUS the search input (selecting the checkbox option stole focus) and
    //      press Enter — a trusted keypress plus a dispatched Enter event for SPAs.
    async submitSearch(opts) {
      const page = await getLanePage();
      const CLICK_SUBMIT = (): boolean => {
        const rx = /^(search|go|find|submit|view\s*(parcel|property)?|open|apply)$/i;
        const visible = (e: any): boolean => { const r = e && e.getBoundingClientRect ? e.getBoundingClientRect() : null; return !!(r && r.width > 0 && r.height > 0); };
        const els = Array.from(document.querySelectorAll('button[type=submit],input[type=submit],button,[role=button],a[role=button],a')) as any[];
        let b = els.find((e) => {
          if (!visible(e)) return false;
          const r = e.getBoundingClientRect(); if (r.top > 360) return false; // near the top search bar
          const t = ((e.value || e.textContent || e.getAttribute?.('aria-label') || e.getAttribute?.('title') || '') as string).replace(/\s+/g, ' ').trim();
          const meta = ((e.className && e.className.toString ? e.className.toString() : '') + ' ' + (e.getAttribute?.('aria-label') || '') + ' ' + (e.id || '')).toLowerCase();
          return (t.length > 0 && t.length < 24 && rx.test(t)) || /(^|[^a-z])(search|submit)([^a-z]|$)/.test(meta);
        });
        // Fallback: the submit button INSIDE the search form (icon-only buttons have no text).
        if (!b) {
          const input = document.querySelector('input[type=text],input[type=search],input:not([type])') as any;
          const form = input && input.closest ? input.closest('form') : null;
          if (form) b = form.querySelector('button[type=submit],input[type=submit],button');
        }
        if (b && visible(b)) { b.scrollIntoView?.({ block: 'center' }); b.click(); return true; }
        return false;
      };
      const clicked = await page.evaluate<boolean>(CLICK_SUBMIT as unknown as () => boolean);
      // Always ALSO submit via the search input + Enter. Selecting the autocomplete
      // checkbox moved focus onto the option, so re-focus the input first; then fire
      // a synthetic Enter (SPA handlers) and, when available, a trusted keypress.
      const FOCUS_INPUT = ((): string | null => {
        const i = document.querySelector('input[type=text],input[type=search],input:not([type])') as any;
        if (!i) return null;
        i.focus();
        for (const type of ['keydown', 'keypress', 'keyup']) {
          i.dispatchEvent(new (window as any).KeyboardEvent(type, { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
        }
        const form = i.closest ? i.closest('form') : null;
        if (form && form.requestSubmit) { try { form.requestSubmit(); } catch { /* ignore */ } }
        return i.id ? '#' + i.id : (i.name ? '[name="' + i.name + '"]' : 'input');
      }) as unknown as () => string | null;
      const focusedSel = await page.evaluate<string | null>(FOCUS_INPUT);
      if (page.keyboard) {
        try {
          if (focusedSel) { await page.evaluate(((s: string) => { const el = document.querySelector(s) as any; if (el && el.focus) el.focus(); }) as unknown as () => void, focusedSel); }
          await page.keyboard.press('Enter');
        } catch { /* best-effort */ }
      }
      void clicked;
      await new Promise((r) => setTimeout(r, Math.min(opts.timeoutMs, 3500))); // parcel/results settle
    },
    async selectMethod(method) {
      const page = await getLanePage();
      const OPEN = (m: string): boolean => {
        const METHOD = /^(address|apn|parcel(\s*id)?|owner|lat(itude)?)/i;
        const inputs = Array.from(document.querySelectorAll('input')).filter((i: any) => { const r = i.getBoundingClientRect(); return r.width > 1 && r.top < 220; });
        for (const el of Array.from(document.querySelectorAll('div,button,span,p')) as any[]) {
          const tx = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (tx.length > 28 || !METHOD.test(tx)) continue;
          const r = el.getBoundingClientRect(); if (r.width < 1 || r.top > 220) continue;
          if (inputs.some((i: any) => { const ir = i.getBoundingClientRect(); return Math.abs(ir.top - r.top) < 70; })) { el.click(); return true; }
        }
        return false;
      };
      await page.evaluate(OPEN as unknown as () => boolean, method);
      await new Promise((r) => setTimeout(r, 450));
      const PICK = (m: string): boolean => {
        const want = m === 'apn' ? /^(apn|parcel)/i : m === 'address' ? /^address$/i : m === 'owner' ? /^owner$/i : /^lat/i;
        const opts = Array.from(document.querySelectorAll('li,p,span,div,[class*="option" i]')) as any[];
        const el = opts.find((o) => { const t = (o.textContent || '').replace(/\s+/g, ' ').trim(); return t.length < 18 && want.test(t); });
        if (el) { el.click(); return true; } return false;
      };
      await page.evaluate(PICK as unknown as () => boolean, method);
      await new Promise((r) => setTimeout(r, 700));
    },
    // ── JURISDICTION SCOPE ───────────────────────────────────────────────
    // ROOT CAUSE THIS REPLACES: the previous implementation reported success
    // whenever it managed to CLICK an option, never reading back what the widget
    // then displayed. A dependent county list that had not finished loading, a
    // still-disabled control, or a click the widget ignored all produced a
    // "confirmed" scope while both dropdowns still displayed "Select Value" —
    // and the search was submitted unscoped. It also addressed the dropdowns by
    // their position among ALL select2 widgets on the page, and never cleared a
    // selection left over from the previous property.
    //
    // Now: address the controls by their own labels, clear stale selections,
    // wait for the DEPENDENT list to actually populate, and count a filter as
    // applied only when the widget VISIBLY renders the chosen value.
    async setScope(values, opts) {
      const page = await getLanePage();
      const confirmed: string[] = [];
      const budget = Math.max(2000, Math.min(opts.timeoutMs, 15000));
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      // Read every scope control's rendered label + state, in page order. This is
      // the single source of truth for "what is on screen" — used to wait, to
      // decide whether to clear, and to confirm.
      const readControls = (): Promise<ScopeControlView[]> => page.evaluate(SCOPE_CONTROLS_SCRIPT as unknown as () => ScopeControlView[]);

      // Wait until `predicate` holds for the rendered controls, or the budget runs out.
      const waitFor = async (predicate: (c: ScopeControlView[]) => boolean, ms: number): Promise<ScopeControlView[]> => {
        const deadline = Date.now() + ms;
        let view = await readControls();
        while (!predicate(view) && Date.now() < deadline) {
          await sleep(200);
          view = await readControls();
        }
        return view;
      };

      for (let i = 0; i < values.length; i++) {
        const val = values[i];
        // A DEPENDENT control (county) only becomes usable once its parent
        // selection has loaded its option list. Wait for it instead of walking
        // past a still-disabled widget and leaving the filter unset.
        let view = await waitFor((c) => !!c[i] && !c[i].disabled, i === 0 ? 1500 : budget);
        if (!view[i] || view[i].disabled) continue;

        // Stale scope from a previous property is cleared before anything new is
        // applied, so one property's county can never narrow another's search.
        if (view[i].selected && view[i].selected!.toLowerCase() !== val.toLowerCase()) {
          await page.evaluate(CLEAR_SCOPE_SCRIPT as unknown as () => void, i);
          await sleep(250);
        }

        const opened = await page.evaluate(OPEN_SCOPE_SCRIPT as unknown as () => boolean, i);
        if (!opened) continue;
        await sleep(400);
        await page.evaluate(TYPE_SCOPE_SCRIPT as unknown as () => void, val);

        // Wait for the option list to actually contain the wanted value. A fixed
        // sleep is what let an unloaded county list look like "no such county".
        const listReady = await (async () => {
          const deadline = Date.now() + budget;
          while (Date.now() < deadline) {
            if (await page.evaluate(HAS_SCOPE_OPTION_SCRIPT as unknown as () => boolean, val)) return true;
            await sleep(200);
          }
          return false;
        })();
        if (!listReady) { await page.evaluate(CLOSE_SCOPE_SCRIPT as unknown as () => void); continue; }

        await page.evaluate(PICK_SCOPE_SCRIPT as unknown as () => boolean, val);

        // VISUAL CONFIRMATION. The widget must render the chosen value before we
        // report the filter applied. Anything else and this returns nothing for
        // this control, which is what blocks the search downstream.
        view = await waitFor((c) => !!c[i]?.selected && scopeLabelMatches(c[i].selected!, val), budget);
        if (view[i]?.selected && scopeLabelMatches(view[i].selected!, val)) confirmed.push(view[i].selected!);
      }
      return confirmed;
    },
    // The visual read the search-configuration checkpoint compares against.
    async readScope() {
      const page = await getLanePage();
      const controls = await page.evaluate(SCOPE_CONTROLS_SCRIPT as unknown as () => ScopeControlView[]);
      if (!controls.length) return { available: false, state: null, county: null, extras: [] };
      const byRole = (rx: RegExp): ScopeControlView | undefined => controls.find((c) => rx.test(c.label));
      // Prefer the control's own label; fall back to page order (state, county)
      // only when the surface labels nothing.
      const state = byRole(/state/i) ?? controls[0];
      const county = byRole(/count(y|ies)/i) ?? controls[1];
      const extras = controls
        .filter((c) => c !== state && c !== county && c.selected)
        .map((c) => `${c.label || 'filter'}: ${c.selected}`);
      return {
        available: true,
        state: state?.selected ?? null,
        county: county?.selected ?? null,
        extras,
      };
    },
    async screenshot(purpose, opts): Promise<BrowserScreenshot> {
      const page = await getLanePage();
      const dir = cfg.screenshotDir;
      const file = path.join(dir, `${id}-${Date.now()}.png`);
      try { (await import('fs')).mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
      // fullPage captures the ENTIRE property view / comps map + sidebar uncropped.
      await page.screenshot({ path: file, fullPage: (opts as { fullPage?: boolean } | undefined)?.fullPage === true });
      return { path: file, capturedAtIso: now(), purpose };
    },
    async evaluate(fn, ...args) {
      const page = await getLanePage();
      return page.evaluate(fn, ...args);
    },
  });
}
