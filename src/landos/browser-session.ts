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
import type { BrowserDriver, BrowserPageRead, BrowserScreenshot } from './browser-intelligence.js';
import { landosArtifactPath } from './storage-profile.js';
import { contextZoomOutSteps, parseAcresFromFields, isDistinctOverlayCapture, fileSha256, OVERLAY_CAPTURE_PLAN } from './parcel-visual-framing.js';

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
  screenshot(opts: { path: string; fullPage?: boolean }): Promise<unknown>;
  type?(selector: string, text: string, opts?: { delay?: number }): Promise<void>;
  keyboard?: { press(key: string): Promise<void> };
  bringToFront?(): Promise<void>;
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
  return {
    enabled: flag === '1' || flag === 'true' || flag === 'yes',
    cdpUrl: get('BROWSER_INTEL_CDP_URL') || 'http://127.0.0.1:9222',
    screenshotDir: get('BROWSER_INTEL_SHOT_DIR') || landosArtifactPath('browser-shots'),
    chromePath: get('BROWSER_INTEL_CHROME_PATH') || undefined,
    profileDir: get('BROWSER_INTEL_PROFILE_DIR') || path.join(os.homedir(), '.landos-chrome'),
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

/** Create one opaque ownership boundary for a Deal Intelligence run. */
export function createBrowserWorkflowScope(label: string): BrowserWorkflowScope {
  return Symbol(label);
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
    const identity = await verifyChromeCdpEndpoint(cfg.cdpUrl);
    if (identity.answering && !identity.ok) {
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
  if (state.workingPage) return state.workingPage;
  state.workingPage = await state.browser.newPage();
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
  const lend = async (): Promise<{ ok: boolean; status: BrowserSessionStatus; value?: T }> => {
    const status = await ensureBrowserSession(deps);
    if (status !== 'live' && status !== 'auth_needed') return { ok: false, status };
    const page = await getWorkingPage();
    const value = await fn(page);
    return { ok: true, status, value };
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

function portFromCdp(cdpUrl: string): number {
  const m = cdpUrl.match(/:(\d+)/);
  return m ? Number(m[1]) : 9222;
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
  // A foreign runtime squatting on the port would swallow the launch: Chrome
  // could not bind it, and attaching would drive a browser we do not own.
  if (!deps.puppeteer) {
    const identity = await verifyChromeCdpEndpoint(cfg.cdpUrl);
    if (identity.answering && !identity.ok) {
      return {
        status: 'unreachable', launched: false, reused: false, chromePath: null, profileDir: cfg.profileDir,
        error: `${identity.reason} Set BROWSER_INTEL_CDP_URL to a free port (for example http://127.0.0.1:9223) and restart LandOS.`,
        health: await health0(),
      };
    }
  }
  // Launch Google Chrome with the LandOS profile + remote debugging.
  const chrome = resolveChromePath(cfg.chromePath);
  if (!chrome.path) {
    return {
      status: 'unreachable', launched: false, reused: false, chromePath: null, profileDir: cfg.profileDir,
      error: `Google Chrome was not found. Checked: ${chrome.checked.join(' ; ')}. Install Chrome or set BROWSER_INTEL_CHROME_PATH. (Edge is never used.)`,
      health: await health0(),
    };
  }
  const port = portFromCdp(cfg.cdpUrl);
  const spawnImpl = deps.spawn ?? defaultSpawn;
  // BACKGROUND BY DEFAULT: a Chrome LandOS launches itself must never open over
  // or steal focus from the operator's work. The window goes far offscreen and
  // keeps rendering (anti-throttle flags); the persistent profile keeps the
  // LandPortal login either way. BROWSER_INTEL_FOREGROUND=1 restores a visible
  // window for manual operator sessions (e.g. a one-time captcha/2FA login).
  const background = cfg.foreground !== true;
  try {
    spawnImpl(chrome.path, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${cfg.profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      ...(background ? BACKGROUND_CHROME_ARGS : []),
      LANDPORTAL_SESSION_URL,
    ]);
    state.launchedBackground = background;
  } catch (err) {
    return { status: 'unreachable', launched: false, reused: false, chromePath: chrome.path, profileDir: cfg.profileDir, error: `Failed to launch Chrome: ${(err as Error)?.message ?? 'unknown'}.`, health: await health0() };
  }
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
    return base('session_unavailable', { sessionStatus: ready.status, reason: ready.error ?? 'Chrome/CDP session could not be started.', note: 'Browser session unavailable — see reason.' });
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
      && lanePageRegistry.get(lanePage)?.lane === laneOwner
    ) {
      return lanePage;
    }
    // A driver normally originates inside its mission context. The lazy fallback
    // also covers a driver constructed just before the async workflow starts.
    workflowOwner ??= browserWorkflowContext.getStore() ?? null;
    if (lanePage) lanePageRegistry.delete(lanePage);
    lanePage = await state.browser.newPage();
    laneBrowser = state.browser;
    lanePageRegistry.set(lanePage, { lane: laneOwner, workflow: workflowOwner });
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

  return {
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
    async captureLandPortalVisuals(url: string, opts: { timeoutMs: number }) {
      // Serialize on the NAMED landportalCaptureGate: camera framing, overlay
      // dialogs and paint-gated screenshots cannot interleave on one Chrome
      // window, even though each capture runs on its own lane page. Ordinary
      // navigation/read operations on other lane pages stay concurrent.
      const work = async () => {
      const empty = {
        fields: {} as Record<string, string>,
        parcelShotPath: null as string | null,
        compsMapShotPath: null as string | null,
        overlayShots: [] as Array<{ overlay: string; path: string; purpose: string }>,
        overlayMisses: [] as Array<{ overlay: string; reason: string }>,
        terrainShotPath: null as string | null,
        compRows: [] as string[],
        compCards: [] as string[],
        compDetails: [] as string[],
        mapReached: false,
        capturedAtIso: now(),
      };
      await ensureBrowserSession(deps);
      if (!state.browser) return empty;
      // Always use this driver's registered lane page. A different Deal may
      // have an authenticated, fully rendered parcel page open concurrently;
      // scanning browser.pages() and borrowing whichever looked "ready" mixed
      // subject facts/screenshots across Deals and let this lane navigate a page
      // it did not own.
      const page = await getLanePage();
      const dir = cfg.screenshotDir;
      try { (await import('fs')).mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const FIELDS = (): { fields: Record<string, string> } => {
        const fields: Record<string, string> = {};
        const add = (k: string, v: string) => { const key = (k || '').replace(/\s+/g, ' ').trim().replace(/[:#]+$/, ''); const val = (v || '').replace(/\s+/g, ' ').trim(); if (key && val && key.length <= 48 && !fields[key]) fields[key] = val; };
        const hidden = (el: any): boolean => { const s = (window as any).getComputedStyle ? (window as any).getComputedStyle(el) : null; return !!(s && (s.display === 'none' || s.visibility === 'hidden')); };
        document.querySelectorAll('dl').forEach((dl: any) => { const dt = dl.querySelectorAll('dt'); const dd = dl.querySelectorAll('dd'); for (let i = 0; i < Math.min(dt.length, dd.length); i++) add(dt[i].textContent || '', dd[i].textContent || ''); });
        document.querySelectorAll('tr').forEach((tr: any) => { const c = tr.querySelectorAll('th,td'); if (c.length === 2) add(c[0].textContent || '', c[1].textContent || ''); });
        document.querySelectorAll('p,div,li').forEach((el: any) => { if (hidden(el)) return; const sp = el.querySelectorAll(':scope > span'); if (sp.length === 2) add(sp[0].textContent || '', sp[1].textContent || ''); });
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
        await sleep(6500);
        // Do not use the generic popup closer here: LandPortal's parcel-detail
        // sidebar also exposes an accessible "Close" control and must remain
        // open as the parcel-identity proof for this screenshot.
        // Read the full parcel fact sheet on the parcel view (before the map click).
        const fieldsOut = await page.evaluate<{ fields: Record<string, string> }>(FIELDS as unknown as () => { fields: Record<string, string> });
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
        let parcelSignals = await readParcelSignals();
        for (let attempt = 0; attempt < 8 && !parcelSignals.propertyPanel; attempt++) {
          await sleep(2000);
          parcelSignals = await readParcelSignals();
        }
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
          await sleep(9000);
          parcelSignals = await readParcelSignals();
          for (let attempt = 0; attempt < 8 && !parcelSignals.propertyPanel; attempt++) {
            await sleep(2000);
            parcelSignals = await readParcelSignals();
          }
        }
        if (!parcelSignals.authenticated || !parcelSignals.propertyPanel || !parcelSignals.mapRendered) {
          logger.warn({ event: 'landportal_visual_rejected', reason: 'parcel_not_ready', ...parcelSignals }, 'landportal_visual_rejected');
          if (!parcelSignals.authenticated) {
            state.auth = { authenticated: false, atIso: now() };
            state.status = 'auth_needed';
          }
          return empty;
        }
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
        const contextSteps = contextZoomOutSteps(parseAcresFromFields(fieldsOut.fields ?? {}));
        const zoomedOutSteps = await zoomOutParcelMap(contextSteps);
        logger.info({ event: 'landportal_visual_zoom', completed: zoomedOutSteps, requested: contextSteps }, 'landportal_visual_zoom');
        if (zoomedOutSteps !== contextSteps) return empty;
        const bearingDegrees = await orientRoadBelowParcel();
        logger.info({ event: 'landportal_visual_orientation', bearingDegrees }, 'landportal_visual_orientation');
        // Mapbox re-fetches/repaints satellite tiles after every camera change;
        // the former 900 ms pause routinely captured only the gray base canvas.
        await sleep(16000);
        const parcelFile = path.join(dir, `landportal-parcel-${Date.now()}.png`);
        await page.screenshot({ path: parcelFile });
        // The parcel/sidebar chrome alone makes a gray map screenshot look like
        // a non-empty PNG. At this viewport real satellite tiles are materially
        // larger; retry once, then reject rather than promote an unpainted map.
        if (fs.statSync(parcelFile).size < 500_000) {
          await sleep(10000);
          await page.screenshot({ path: parcelFile });
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
        const captureOverlay = async (overlay: string, candidates: string[], purpose: string): Promise<void> => {
          try {
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
            await page.screenshot({ path: file });
            // DISTINCTNESS GATE: byte-identical to the base parcel view (or any
            // earlier capture) means the layer never rendered. Wait once more
            // for slow tiles, then record the overlay as unavailable rather
            // than promoting a relabeled copy of the base map.
            let sha: string | null = null;
            try { sha = fileSha256(file); } catch { sha = null; }
            if (sha && !isDistinctOverlayCapture(sha, capturedShas)) {
              await sleep(6500);
              await page.screenshot({ path: file });
              try { sha = fileSha256(file); } catch { sha = null; }
            }
            if (sha && !isDistinctOverlayCapture(sha, capturedShas)) {
              try { fs.unlinkSync(file); } catch { /* best-effort cleanup */ }
              overlayMisses.push({ overlay, reason: 'the toggled layer produced no visible change over the base map at parcel scale — no distinct overlay image exists to save.' });
            } else {
              if (sha) capturedShas.push(sha);
              overlayShots.push({ overlay, path: file, purpose });
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
          const terrainOn = await clickNamedButton('Toggle 3D terrain');
          if (terrainOn) {
            await sleep(4500);
            const terrainFile = path.join(dir, `landportal-terrain-${Date.now()}.png`);
            await page.screenshot({ path: terrainFile });
            // Same distinctness gate: a "terrain" frame identical to the flat
            // base capture proves 3D never engaged — keep it absent instead.
            let terrainSha: string | null = null;
            try { terrainSha = fileSha256(terrainFile); } catch { terrainSha = null; }
            if (terrainSha && !isDistinctOverlayCapture(terrainSha, capturedShas)) {
              try { fs.unlinkSync(terrainFile); } catch { /* best-effort cleanup */ }
            } else {
              if (terrainSha) capturedShas.push(terrainSha);
              terrainShotPath = terrainFile;
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
        const mapReached = await page.evaluate<boolean>((() => { const a = (document.querySelector('a.js-lp-estimate-show-on-map') as any) || Array.from(document.querySelectorAll('a')).find((x: any) => /^show on map$/i.test((x.textContent || '').trim())); if (a) { a.scrollIntoView(); a.click(); return true; } return false; }) as unknown as () => boolean);
        await sleep(6000);
        let compsMapShotPath: string | null = null;
        let mapRows: string[] = [];
        if (mapReached) {
          const compsFile = path.join(dir, `landportal-compsmap-${Date.now()}.png`);
          await page.screenshot({ path: compsFile });
          compsMapShotPath = compsFile;
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
        const compDetails: string[] = [];
        if (compCards.length) {
          let detailPage: PageLike | null = null;
          try {
            detailPage = await state.browser.newPage();
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
                await sleep(7000);
                const facts = await detailPage.evaluate<Record<string, string>>(COMP_DETAIL as unknown as () => Record<string, string>);
                compDetails.push(JSON.stringify({ apn: card.apn, propertyId: card.propertyId, sourceUrl: detailUrl, facts }));
              } catch {
                // One unreachable comp page never fails the capture; the row
                // simply keeps only what the sidebar surface stated.
              }
            }
          } catch { /* the enrichment tab is best-effort */ } finally {
            // Always close the tab this capture opened — an enrichment tab left
            // behind is exactly the browser-cleanup regression the operator sees.
            const closable = detailPage as unknown as { close?: () => Promise<void> } | null;
            if (closable?.close) { try { await closable.close(); } catch { /* already gone */ } }
          }
        }
        return { fields: fieldsOut.fields ?? {}, parcelShotPath: parcelFile, compsMapShotPath, overlayShots, overlayMisses, terrainShotPath, compRows: compRows ?? [], compCards: compCards ?? [], compDetails, mapRows: mapRows ?? [], mapReached, capturedAtIso: now() };
      } catch (error) {
        logger.warn({ event: 'landportal_visual_capture_failed', error: error instanceof Error ? error.message : String(error) }, 'landportal_visual_capture_failed');
        return empty;
      } finally {
        // The authenticated lane page is intentionally retained for the next
        // read-only mission; the driver owns its lifecycle.
      }
      };
      const run = landportalCaptureGate.then(work, work);
      landportalCaptureGate = run.then(() => undefined, () => undefined);
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
      const page = await state.browser.newPage();
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
        // No bringToFront: a fresh tab is already its window's selected tab at
        // creation, and raising the window would put it over the operator's work.
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
        await new Promise((r) => setTimeout(r, 6500)); // let the SPA fully render the detail panel
        const out = await page.evaluate<{ fields: Record<string, string>; snippets: string[] }>(FULL as unknown as () => { fields: Record<string, string>; snippets: string[] });
        return { url: page.url(), fields: out.fields ?? {}, snippets: out.snippets ?? [] };
      } finally {
        try { await (page as unknown as { close?: () => Promise<void> }).close?.(); } catch { /* leave the tab if close is unavailable */ }
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
      const READ = (): Array<{ index: number; text: string; kind: string }> => {
        // Deterministic collector — MUST match clickCandidate's collector exactly.
        const SEL = '.leaflet-popup-content,[class*="popup" i],[class*="result" i] li,[class*="result" i] tr,[class*="results" i] [class*="card" i],[class*="results" i] [class*="row" i],[class*="result-item" i],[class*="parcel" i],[class*="feature" i] li,[role=row],[class*="list" i] li,table tbody tr,[class*="card" i],[role=option],[class*="autocomplete" i] li,[class*="autocomplete" i] [class*="item" i],[class*="suggestion" i],[class*="typeahead" i] li,[class*="search-result" i],[class*="dropdown-menu" i] li,li[class*="search" i],li[class*="variant" i]';
        const seen = new Set<any>(); const out: any[] = [];
        Array.from(document.querySelectorAll(SEL)).forEach((el: any) => {
          if (seen.has(el)) return; seen.add(el);
          const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 1, height: 1 };
          if (!rect.width || !rect.height) return; // visible only
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (text.length < 3 || text.length > 220) return;
          out.push({ el, text });
        });
        const kindOf = (el: any): string => { const c = (el.className && el.className.toString ? el.className.toString() : '').toLowerCase(); const tag = (el.tagName || '').toLowerCase(); if (/popup/.test(c)) return 'popup'; if (/card/.test(c)) return 'card'; if (tag === 'tr' || /row/.test(c)) return 'row'; if (tag === 'li') return 'row'; if (tag === 'button') return 'button'; return 'element'; };
        const byText = new Set<string>(); const res: any[] = [];
        out.forEach((o) => { if (byText.has(o.text)) return; byText.add(o.text); res.push({ index: res.length, text: o.text, kind: kindOf(o.el) }); });
        return res.slice(0, 40);
      };
      return page.evaluate<Array<{ index: number; text: string; kind: string }>>(READ);
    },
    async clickCandidate(index, opts) {
      const page = await getLanePage();
      const CLICK = (target: number): boolean => {
        const SEL = '.leaflet-popup-content,[class*="popup" i],[class*="result" i] li,[class*="result" i] tr,[class*="results" i] [class*="card" i],[class*="results" i] [class*="row" i],[class*="result-item" i],[class*="parcel" i],[class*="feature" i] li,[role=row],[class*="list" i] li,table tbody tr,[class*="card" i],[role=option],[class*="autocomplete" i] li,[class*="autocomplete" i] [class*="item" i],[class*="suggestion" i],[class*="typeahead" i] li,[class*="search-result" i],[class*="dropdown-menu" i] li,li[class*="search" i],li[class*="variant" i]';
        const seen = new Set<any>(); const out: any[] = [];
        Array.from(document.querySelectorAll(SEL)).forEach((el: any) => {
          if (seen.has(el)) return; seen.add(el);
          const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 1, height: 1 };
          if (!rect.width || !rect.height) return;
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (text.length < 3 || text.length > 220) return;
          out.push({ el, text });
        });
        const byText = new Set<string>(); const res: any[] = [];
        out.forEach((o) => { if (byText.has(o.text)) return; byText.add(o.text); res.push(o.el); });
        const el = res[target]; if (!el) return false;
        // Prefer a checkbox/radio inside the option (LandPortal's APN autocomplete
        // renders each matching parcel as a selectable checkbox row that must be
        // ticked before submitting), then an anchor/button, else the element itself.
        const clickable = (el.matches && el.matches('a,button,[role=button],[onclick],input[type=checkbox],input[type=radio]'))
          ? el
          : (el.querySelector && el.querySelector('input[type=checkbox],input[type=radio],a[href],button,[role=button],[onclick]')) || el;
        if (clickable.scrollIntoView) clickable.scrollIntoView();
        clickable.click();
        return true;
      };
      await page.evaluate<boolean>(CLICK as unknown as () => boolean, index);
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
  };
}
