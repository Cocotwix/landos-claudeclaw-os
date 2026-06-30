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
import { readEnvFile } from '../env.js';
import type { BrowserDriver, BrowserPageRead, BrowserScreenshot } from './browser-intelligence.js';

// The functions passed to page.evaluate() below execute INSIDE the operator's
// browser (not Node), so the DOM globals are declared as `any` purely to satisfy
// the Node typechecker. They are never executed in this process.
declare const document: any;
declare const Event: any;

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
}
export interface BrowserLike {
  version(): Promise<string>;
  pages(): Promise<PageLike[]>;
  newPage(): Promise<PageLike>;
  isConnected(): boolean;
  disconnect(): Promise<void>;
}
export interface PuppeteerLike {
  connect(opts: { browserURL?: string; browserWSEndpoint?: string }): Promise<BrowserLike>;
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
}

/** LandPortal entry URL opened in the session for manual login / auth detection. */
export const LANDPORTAL_SESSION_URL = 'https://www.landportal.com/';

/** Standard Google Chrome install paths (Windows). Edge is intentionally excluded. */
export const CHROME_CANDIDATE_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
];

const ENV_KEYS = ['BROWSER_INTEL_LIVE', 'BROWSER_INTEL_CDP_URL', 'BROWSER_INTEL_SHOT_DIR', 'BROWSER_INTEL_CHROME_PATH', 'BROWSER_INTEL_PROFILE_DIR'];

/** Read live-session config. The shell environment wins; otherwise the same keys
 *  are read from the .env FILE (these are non-secret config flags, never secrets).
 *  `env` is injectable so tests never read the real environment. */
export function readSessionConfig(env?: Record<string, string | undefined>): BrowserSessionConfig {
  const proc = env ?? process.env;
  let fileVals: Record<string, string> = {};
  if (!env) { try { fileVals = readEnvFile(ENV_KEYS); } catch { fileVals = {}; } }
  const get = (k: string) => (proc[k] ?? fileVals[k] ?? '').trim();
  const flag = get('BROWSER_INTEL_LIVE').toLowerCase();
  return {
    enabled: flag === '1' || flag === 'true' || flag === 'yes',
    cdpUrl: get('BROWSER_INTEL_CDP_URL') || 'http://127.0.0.1:9222',
    screenshotDir: get('BROWSER_INTEL_SHOT_DIR') || path.join(os.tmpdir(), 'landos-browser-shots'),
    chromePath: get('BROWSER_INTEL_CHROME_PATH') || undefined,
    profileDir: get('BROWSER_INTEL_PROFILE_DIR') || path.join(os.homedir(), '.landos-chrome'),
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
}
const state: SessionState = { browser: null, workingPage: null, status: 'disabled', cdpUrl: '', connectedAtIso: null, auth: { authenticated: null, atIso: null }, lastCheckIso: null, screenshotDir: '' };

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
  try {
    const browser = await pup.connect({ browserURL: cfg.cdpUrl });
    await browser.version(); // probe
    state.browser = browser;
    state.workingPage = null; // a fresh working tab is acquired lazily
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

/** Acquire (and cache) a single dedicated LandOS working tab in the operator's
 *  Chrome. Reuses an existing tab when possible; opens one new tab otherwise so
 *  we never spawn a tab per call. Never closes operator tabs. */
async function getWorkingPage(): Promise<PageLike> {
  if (!state.browser) throw new Error('No live browser session.');
  if (state.workingPage) return state.workingPage;
  const pages = await state.browser.pages();
  state.workingPage = pages.length ? pages[pages.length - 1] : await state.browser.newPage();
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

/** Disconnect (NOT close) — the operator's browser stays open all day. */
export async function disconnectBrowserSession(): Promise<void> {
  try { if (state.browser) await state.browser.disconnect(); } catch { /* ignore */ }
  state.browser = null;
  state.workingPage = null;
  if (state.status === 'live') state.status = 'unreachable';
}

/** Test-only: reset the singleton between tests. */
export function _resetBrowserSession(): void {
  state.browser = null; state.workingPage = null; state.status = 'disabled'; state.cdpUrl = '';
  state.connectedAtIso = null; state.auth = { authenticated: null, atIso: null }; state.lastCheckIso = null; state.screenshotDir = '';
}

// ─────────────────────────────────────────────────────────────────────────
// Operator flow: launch Chrome (NOT Edge) + connect + open LandPortal
// ─────────────────────────────────────────────────────────────────────────

/** Injectable process spawn (tests pass a no-op; prod uses child_process). */
export type SpawnLike = (cmd: string, args: string[]) => void;

const defaultSpawn: SpawnLike = (cmd, args) => {
  // Lazy import so a build/test never pulls a process unintentionally.
  // detached + unref + ignored stdio → Chrome keeps running after this returns.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cp = require('child_process') as typeof import('child_process');
  const child = cp.spawn(cmd, args, { detached: true, stdio: 'ignore' });
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
  try {
    spawnImpl(chrome.path, [`--remote-debugging-port=${port}`, `--user-data-dir=${cfg.profileDir}`, '--no-first-run', '--no-default-browser-check', LANDPORTAL_SESSION_URL]);
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
  const snippets: string[] = [];
  document.querySelectorAll('h1,h2,h3').forEach((h: any) => { const t = (h.textContent || '').trim(); if (t) snippets.push(t.slice(0, 120)); });
  const bodyText = (document.body && document.body.innerText) || '';
  const loginLike = /sign in|log in|login|password/i.test(bodyText.slice(0, 2000)) && Object.keys(fields).length === 0;
  return { fields, snippets: snippets.slice(0, 8), loginLike };
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

  const nav = async (url: string, timeoutMs: number): Promise<BrowserPageRead> => {
    await ensureBrowserSession(deps);
    const page = await getWorkingPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const read = await readPage(page);
    if (deps.detectAuth !== false && read.loginLike) state.status = 'auth_needed';
    return { url: read.url, fields: read.fields, snippets: read.snippets };
  };

  return {
    id,
    configured() { return browserSessionStatus() === 'live'; },
    async open(url, opts) { return nav(url, opts?.timeoutMs ?? timeoutDefault); },
    async search(query, opts) {
      await ensureBrowserSession(deps);
      const page = await getWorkingPage();
      await doSearch(page, query);
      const read = await readPage(page);
      if (deps.detectAuth !== false && read.loginLike) state.status = 'auth_needed';
      return { url: read.url, fields: read.fields, snippets: read.snippets };
    },
    async readFields() {
      const page = await getWorkingPage();
      const read = await readPage(page);
      return { url: read.url, fields: read.fields, snippets: read.snippets };
    },
    async screenshot(purpose): Promise<BrowserScreenshot> {
      const page = await getWorkingPage();
      const dir = cfg.screenshotDir;
      const file = path.join(dir, `${id}-${Date.now()}.png`);
      try { (await import('fs')).mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
      await page.screenshot({ path: file });
      return { path: file, capturedAtIso: now(), purpose };
    },
  };
}
