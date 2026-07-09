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
import { readEnvFile } from '../env.js';
import type { BrowserDriver, BrowserPageRead, BrowserScreenshot } from './browser-intelligence.js';

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
export const LANDPORTAL_SESSION_URL = 'https://landportal.com/';

/** Standard Google Chrome install paths (Windows). Edge is intentionally excluded. */
export const CHROME_CANDIDATE_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
];

const ENV_KEYS = ['BROWSER_INTEL_LIVE', 'BROWSER_INTEL_CDP_URL', 'BROWSER_INTEL_SHOT_DIR', 'BROWSER_INTEL_CHROME_PATH', 'BROWSER_INTEL_PROFILE_DIR'];

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
  const status = await ensureBrowserSession(deps);
  if (status !== 'live' && status !== 'auth_needed') return { ok: false, status };
  const page = await getWorkingPage();
  const value = await fn(page);
  return { ok: true, status, value };
}

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

// Fill the LandPortal login form and submit. Values arrive as args (typed into
// the page only) and are NEVER returned. Returns a DIAGNOSTIC CODE, not creds.
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
  const emailEl = (Array.from(document.querySelectorAll('input[type=email],input[name*="email" i],input[id*="email" i],input[autocomplete="username"],input[name*="user" i],input[placeholder*="email" i]')) as any[]).find(visible)
    || (Array.from(document.querySelectorAll('input[type=text]')) as any[]).find(visible);
  if (!emailEl) return 'no_email_field';
  const passEl = (Array.from(document.querySelectorAll('input[type=password]')) as any[]).find(visible);
  if (!passEl) return 'no_password_field';
  setVal(emailEl, email);
  setVal(passEl, password);
  const form = passEl.closest ? passEl.closest('form') : null;
  const btn = (Array.from(document.querySelectorAll('button[type=submit],input[type=submit],button,[role=button]')) as any[])
    .find((b) => visible(b) && /^(log ?in|sign ?in|continue|submit)$/i.test(((b.value || b.textContent || '') as string).replace(/\s+/g, ' ').trim()));
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
  try { code = await page.evaluate<string>(LP_LOGIN as unknown as () => string, creds.email, creds.password); }
  catch (err) { return base('auth_failed', { attempted: true, sessionStatus: state.status, reason: `Login form interaction failed: ${(err as Error)?.message ?? 'evaluate error'}.`, note: 'Could not drive the login form.' }); }

  if (code !== 'submitted') {
    const reason = code === 'no_email_field' ? 'LandPortal login form not found (email/username field missing) — the login UI may have changed.'
      : code === 'no_password_field' ? 'LandPortal password field not found — the login UI may have changed.'
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
    // ONE-PASS LandPortal capture in a FRESH deep-link tab: full parcel fields +
    // a wide parcel screenshot + all comparable rows (expands "View all") + clicks
    // the real "Show on Map" anchor (js-lp-estimate-show-on-map) and screenshots
    // the comps map. Proves the map was reached (mapReached) and never touches a
    // paid Comp/Slope report control. Read-only; closes the tab it opened.
    async captureLandPortalVisuals(url: string, opts: { timeoutMs: number }) {
      const empty = {
        fields: {} as Record<string, string>,
        parcelShotPath: null as string | null,
        compsMapShotPath: null as string | null,
        overlayShots: [] as Array<{ overlay: string; path: string; purpose: string }>,
        terrainShotPath: null as string | null,
        compRows: [] as string[],
        mapReached: false,
        capturedAtIso: now(),
      };
      await ensureBrowserSession(deps);
      if (!state.browser) return empty;
      const page = await state.browser.newPage();
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
      const COMP_ROWS = (): string[] => {
        const out: string[] = []; const seen = new Set<string>();
        document.querySelectorAll('*').forEach((el: any) => {
          if (el.children && el.children.length > 2) return;
          const t = (el.textContent || '').replace(/\s+/g, ' ').replace(/[›»]/g, '').trim();
          if (/^\$[\d,]+\s+Acres?:\s*[\d.]+/i.test(t) && t.length < 90 && !seen.has(t)) { seen.add(t); out.push(t); }
        });
        return out.slice(0, 30);
      };
      try {
        try { await (page as unknown as { setViewport?: (v: { width: number; height: number }) => Promise<void> }).setViewport?.({ width: 1600, height: 1000 }); } catch { /* best-effort */ }
        await (page as unknown as { bringToFront?: () => Promise<void> }).bringToFront?.();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
        await sleep(6500);
        const parcelFile = path.join(dir, `landportal-parcel-${Date.now()}.png`);
        await page.screenshot({ path: parcelFile });
        // Read the full parcel fact sheet on the parcel view (before the map click).
        const fieldsOut = await page.evaluate<{ fields: Record<string, string> }>(FIELDS as unknown as () => { fields: Record<string, string> });
        const overlayShots: Array<{ overlay: string; path: string; purpose: string }> = [];
        const clickVisible = async (labels: RegExp[]): Promise<boolean> => page.evaluate<boolean>(((patterns: string[]) => {
          const rx = patterns.map((p) => new RegExp(p, 'i'));
          const visible = (el: any): boolean => {
            if (!el || !el.getBoundingClientRect) return false;
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) return false;
            const st = (window as any).getComputedStyle ? (window as any).getComputedStyle(el) : null;
            return !(st && (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') < 0.1));
          };
          const els = Array.from(document.querySelectorAll('button,a,label,span,div,[role=button],[role=menuitem]')) as any[];
          const el = els.find((e) => {
            if (!visible(e)) return false;
            const text = (e.textContent || e.getAttribute?.('aria-label') || e.getAttribute?.('title') || '').replace(/\s+/g, ' ').trim();
            return text.length > 0 && text.length < 80 && rx.some((r) => r.test(text));
          });
          if (el) { el.scrollIntoView?.({ block: 'center', inline: 'center' }); el.click(); return true; }
          return false;
        }) as unknown as () => boolean, labels.map((r) => r.source));
        try { await clickVisible([/base\s*maps?/i, /overlays?/i, /basemaps?\s*&?\s*overlays?/i]); await sleep(700); } catch { /* best-effort */ }
        const captureOverlay = async (label: string, purpose: string, labels: RegExp[]): Promise<void> => {
          try {
            const on = await clickVisible(labels);
            if (!on) return;
            await sleep(1800);
            const file = path.join(dir, `${purpose}-${Date.now()}.png`);
            await page.screenshot({ path: file });
            overlayShots.push({ overlay: label, path: file, purpose });
            await clickVisible(labels).catch(() => false);
            await sleep(600);
          } catch { /* overlay unavailable; leave it absent */ }
        };
        await captureOverlay('Contour Lines', 'landportal_overlay_contour_lines', [/contour/i, /topo/i]);
        await captureOverlay('Wetlands', 'landportal_overlay_wetlands', [/wetland/i, /nwi/i]);
        await captureOverlay('FEMA Floodplain', 'landportal_overlay_fema_floodplain', [/fema/i, /flood/i]);
        let terrainShotPath: string | null = null;
        try {
          const terrainOn = await clickVisible([/^3d$/i, /3d view/i, /terrain/i]);
          if (terrainOn) {
            await sleep(2200);
            terrainShotPath = path.join(dir, `landportal-terrain-${Date.now()}.png`);
            await page.screenshot({ path: terrainShotPath });
          }
        } catch { terrainShotPath = null; }
        // Expand "View all" so every comp row is in the DOM, then read them.
        await page.evaluate(() => { const els = Array.from(document.querySelectorAll('button,a,span,div')) as any[]; const va = els.find((e) => /^view all/i.test((e.textContent || '').replace(/\s+/g, ' ').trim()) && (e.children || []).length === 0); if (va) va.click(); });
        await sleep(1500);
        const compRows = await page.evaluate<string[]>(COMP_ROWS as unknown as () => string[]);
        // Click the real comps "Show on Map" anchor (free; never the paid Comp Report).
        const mapReached = await page.evaluate<boolean>((() => { const a = (document.querySelector('a.js-lp-estimate-show-on-map') as any) || Array.from(document.querySelectorAll('a')).find((x: any) => /^show on map$/i.test((x.textContent || '').trim())); if (a) { a.scrollIntoView(); a.click(); return true; } return false; }) as unknown as () => boolean);
        await sleep(6000);
        let compsMapShotPath: string | null = null;
        if (mapReached) { const compsFile = path.join(dir, `landportal-compsmap-${Date.now()}.png`); await page.screenshot({ path: compsFile }); compsMapShotPath = compsFile; }
        return { fields: fieldsOut.fields ?? {}, parcelShotPath: parcelFile, compsMapShotPath, overlayShots, terrainShotPath, compRows: compRows ?? [], mapReached, capturedAtIso: now() };
      } catch {
        return empty;
      } finally {
        try { await (page as unknown as { close?: () => Promise<void> }).close?.(); } catch { /* leave tab */ }
      }
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
        await page.bringToFront?.();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
        await new Promise((r) => setTimeout(r, 6500)); // let the SPA fully render the detail panel
        const out = await page.evaluate<{ fields: Record<string, string>; snippets: string[] }>(FULL as unknown as () => { fields: Record<string, string>; snippets: string[] });
        return { url: page.url(), fields: out.fields ?? {}, snippets: out.snippets ?? [] };
      } finally {
        try { await (page as unknown as { close?: () => Promise<void> }).close?.(); } catch { /* leave the tab if close is unavailable */ }
      }
    },
    async readLinks() {
      const page = await getWorkingPage();
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
      const page = await getWorkingPage();
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
      const page = await getWorkingPage();
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
      const page = await getWorkingPage();
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
      const page = await getWorkingPage();
      const SELECT = (s: string, t: string): boolean => {
        const el = document.querySelector(s) as any; if (!el) return false;
        if (el.tagName === 'SELECT') { const opt = Array.from(el.options).find((o: any) => (o.textContent || '').trim().toLowerCase().includes(t.toLowerCase())); if (opt) { el.value = (opt as any).value; el.dispatchEvent(new Event('change', { bubbles: true })); return true; } }
        return false;
      };
      await page.evaluate<boolean>(SELECT as unknown as () => boolean, selector, optionText);
      await new Promise((r) => setTimeout(r, 400));
    },
    async clickByText(text) {
      const page = await getWorkingPage();
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
      const page = await getWorkingPage();
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
      const page = await getWorkingPage();
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
      const page = await getWorkingPage();
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
      const page = await getWorkingPage();
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
      const page = await getWorkingPage();
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
    async setScope(values, opts) {
      const page = await getWorkingPage();
      const confirmed: string[] = [];
      // Drive the search-scope dropdowns in order (e.g. State, then County). Works
      // with Select2 widgets (open → type → click result) — a standard library.
      for (let i = 0; i < values.length; i++) {
        const val = values[i];
        const opened = await page.evaluate(((w: number) => {
          const conts = Array.from(document.querySelectorAll('.search-selects-wr .select2-container, .select2-container')) as any[];
          const c = conts[w]; if (!c) return false;
          if ((c.className || '').includes('disabled')) return false;
          const sel = c.querySelector('.select2-selection'); if (!sel) return false;
          sel.dispatchEvent(new (window as any).MouseEvent('mousedown', { bubbles: true })); sel.click(); return true;
        }) as unknown as () => boolean, i);
        if (!opened) continue;
        await new Promise((r) => setTimeout(r, 450));
        await page.evaluate(((v: string) => { const sf = document.querySelector('.select2-search__field') as any; if (sf) { sf.value = v; sf.dispatchEvent(new Event('input', { bubbles: true })); sf.dispatchEvent(new (window as any).KeyboardEvent('keyup', { bubbles: true })); } }) as unknown as () => void, val);
        await new Promise((r) => setTimeout(r, 900));
        const picked = await page.evaluate(((v: string): boolean => {
          const opts2 = Array.from(document.querySelectorAll('.select2-results__option')) as any[];
          const el = opts2.find((o) => (o.textContent || '').trim().toLowerCase() === v.toLowerCase()) || opts2.find((o) => (o.textContent || '').trim().toLowerCase().includes(v.toLowerCase()));
          if (el) { el.dispatchEvent(new (window as any).MouseEvent('mouseup', { bubbles: true })); el.click(); return true; } return false;
        }) as unknown as () => boolean, val);
        if (picked) confirmed.push(val);
        await new Promise((r) => setTimeout(r, Math.min(opts.timeoutMs, 1200)));
      }
      return confirmed;
    },
    async screenshot(purpose, opts): Promise<BrowserScreenshot> {
      const page = await getWorkingPage();
      const dir = cfg.screenshotDir;
      const file = path.join(dir, `${id}-${Date.now()}.png`);
      try { (await import('fs')).mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
      // fullPage captures the ENTIRE property view / comps map + sidebar uncropped.
      await page.screenshot({ path: file, fullPage: (opts as { fullPage?: boolean } | undefined)?.fullPage === true });
      return { path: file, capturedAtIso: now(), purpose };
    },
  };
}
