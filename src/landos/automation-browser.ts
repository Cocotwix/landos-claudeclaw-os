// THE LANDOS AUTOMATION BROWSER — one owned Chrome, one owned endpoint.
//
// LandOS automation must never use, attach to, activate or control the
// operator's interactive Chrome. This module is the ONLY place in LandOS that
// may launch a browser or hand out a CDP endpoint, and every automation lane —
// LandPortal subject, comps, visuals, Browser Use, Hermes, QA — goes through it.
//
// ── Why this exists (the defect it closes) ────────────────────────────────
//
// Backgrounding was implemented once, in `startBrowserSession`, and it worked:
// the persistent LandOS Chrome sits at --window-position=-32000,-32000 and stays
// there. But three OTHER launchers spawned Chrome directly and never ran that
// code:
//
//   zillow-land-comps.ts   port 9334, profile %TEMP%/landos-zillow-<ts>-<rand>
//   redfin-land-comps.ts   port 9335, profile %TEMP%/landos-redfin-<ts>-<rand>
//   sprint-system/qa-browser.ts       config profile, no position flags
//
// None passed --window-position, and each used a BRAND-NEW throwaway profile.
// That second detail is the actual mechanism: the main window is offscreen only
// because its PERSISTENT profile remembers that position from an earlier launch.
// A fresh profile remembers nothing, so Chrome opens it at the default cascade
// position — centre screen, foreground, focused — for the 30-135 seconds a comps
// lane runs, twice per property. Every previous fix was applied to the one path
// that was already behaving.
//
// A fourth path launched `chrome.exe <url>` with NO --user-data-dir at all,
// which Windows hands to the operator's running Chrome, raising it.
//
// ── The guarantees ────────────────────────────────────────────────────────
//
//   • ONE Chrome process, ONE persistent profile, ONE fixed CDP port.
//   • Launch is ALWAYS offscreen. There is no foreground code path and no flag
//     that produces one during research.
//   • Attachment FAILS CLOSED: the process answering the port must be a Chrome
//     running our exact --user-data-dir. "Some browser answered" is not enough —
//     on this machine port 9222 is owned by msedgewebview2.
//   • Never a fallback to another browser. A guard failure is an error, not a
//     downgrade to whatever Chrome happens to be open.
//   • LandPortal keeps the persistent default context, so authentication
//     survives restarts without holding tabs open.
//   • Anti-bot lanes get DISPOSABLE incognito contexts inside the same process,
//     so their cookies never touch the authenticated profile.
//   • Every page a lane opens is closed in `finally` — success, failure,
//     timeout or cancellation alike.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn as nodeSpawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { logger } from '../logger.js';
import { readEnvFile } from '../env.js';

const execFileAsync = promisify(execFile);

/** Standard Google Chrome install paths (Windows). Edge is never considered. */
export const CHROME_CANDIDATE_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
];

/**
 * Offscreen placement + anti-throttle. -32000 is far outside any real desktop,
 * so the window renders and screenshots at full fidelity while being impossible
 * to see or to cover the operator's work with.
 *
 * These are NOT optional and there is deliberately no foreground variant: a
 * window that can be placed onscreen is a window that can take the foreground.
 */
export const OFFSCREEN_CHROME_ARGS = [
  '--window-position=-32000,-32000',
  '--window-size=1920,1080',
  '--disable-backgrounding-occluded-windows',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
] as const;

/**
 * The one page the automation browser always keeps.
 *
 * Chrome exits when its last page closes, so a reaper that closed every
 * automation tab also killed the browser — observed the first time this ran
 * against the live instance. One inert offscreen about:blank keeps the process
 * and its authenticated profile alive between jobs, and holds no site state.
 */
export const CONTROL_PAGE_URL = 'about:blank';

/** Flags every automation launch carries. */
const BASE_CHROME_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  // Anti-bot lanes (Zillow/Redfin) fail against a browser that advertises
  // automation. --enable-automation is therefore NEVER set, which also means the
  // ownership guard cannot use Browser.getBrowserCommandLine and verifies at the
  // OS level instead.
  '--disable-blink-features=AutomationControlled',
] as const;

const ENV_KEYS = [
  'LANDOS_AUTOMATION_CDP_PORT',
  'LANDOS_AUTOMATION_PROFILE_DIR',
  'LANDOS_AUTOMATION_CHROME_PATH',
  'BROWSER_INTEL_CDP_URL',
  'BROWSER_INTEL_PROFILE_DIR',
  'BROWSER_INTEL_CHROME_PATH',
];

/** The default automation port. NEVER 9222: that is the conventional port every
 *  other tool on a workstation grabs (here, msedgewebview2 owns it). */
export const DEFAULT_AUTOMATION_PORT = 9224;

export interface AutomationBrowserConfig {
  /** Fixed loopback CDP endpoint LandOS owns. */
  endpoint: string;
  port: number;
  /** Persistent profile. LandPortal auth lives here and survives restarts. */
  profileDir: string;
  chromePath: string | null;
  chromeChecked: string[];
}

function envValue(key: string, fileVals: Record<string, string>, proc: NodeJS.ProcessEnv): string {
  return String(proc[key] ?? fileVals[key] ?? '').trim();
}

function portFromUrl(value: string): number | null {
  const match = /:(\d+)\s*$/.exec(value.trim().replace(/\/+$/, ''));
  const port = match ? Number(match[1]) : NaN;
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

/**
 * Resolve the automation browser's fixed identity.
 *
 * Legacy `BROWSER_INTEL_*` keys are still honoured so an existing operator
 * install keeps its already-authenticated profile — but port 9222 is refused
 * from ANY source. It is the port foreign runtimes squat on, and attaching to
 * one is precisely the failure this module exists to make impossible.
 */
export function automationBrowserConfig(env?: NodeJS.ProcessEnv): AutomationBrowserConfig {
  const proc = env ?? process.env;
  let fileVals: Record<string, string> = {};
  if (!env) { try { fileVals = readEnvFile(ENV_KEYS); } catch { fileVals = {}; } }

  const explicitPort = Number(envValue('LANDOS_AUTOMATION_CDP_PORT', fileVals, proc));
  const legacyPort = portFromUrl(envValue('BROWSER_INTEL_CDP_URL', fileVals, proc));
  let port = Number.isInteger(explicitPort) && explicitPort > 0
    ? explicitPort
    : legacyPort ?? DEFAULT_AUTOMATION_PORT;
  if (port === 9222) {
    logger.warn({ port }, 'automation_browser_refused_port_9222');
    port = DEFAULT_AUTOMATION_PORT;
  }

  const profileDir = envValue('LANDOS_AUTOMATION_PROFILE_DIR', fileVals, proc)
    || envValue('BROWSER_INTEL_PROFILE_DIR', fileVals, proc)
    || path.join(os.homedir(), '.landos-chrome');

  const configuredChrome = envValue('LANDOS_AUTOMATION_CHROME_PATH', fileVals, proc)
    || envValue('BROWSER_INTEL_CHROME_PATH', fileVals, proc)
    || undefined;
  const chromeChecked = [configuredChrome, ...CHROME_CANDIDATE_PATHS].filter((x): x is string => !!x);
  let chromePath: string | null = null;
  for (const candidate of chromeChecked) {
    try { if (fs.existsSync(candidate)) { chromePath = candidate; break; } } catch { /* keep looking */ }
  }

  return {
    endpoint: `http://127.0.0.1:${port}`,
    port,
    profileDir: path.resolve(profileDir),
    chromePath,
    chromeChecked,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Ownership guard — fail closed, never fall back
// ─────────────────────────────────────────────────────────────────────────

export interface AutomationOwnership {
  owned: boolean;
  answering: boolean;
  pid: number | null;
  browser: string;
  /** Why ownership was refused. Null only when `owned` is true. */
  reason: string | null;
  /** True when the owned Chrome's own command line proves it was launched with
   *  the OFFSCREEN window position (-32000,-32000). Activating a tab in such a
   *  window can never appear over the operator's work — this is what lets a
   *  session that ATTACHED (rather than launched) still activate lane tabs so
   *  background pages actually lay out and paint. Null when unknown. */
  offscreen?: boolean | null;
}

/** Normalise a Windows/POSIX path for comparison (case + separators). */
function pathKey(value: string): string {
  return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
}

/** The PID listening on a loopback TCP port. */
async function pidListeningOn(port: number): Promise<number | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`,
      ], { timeout: 10_000, windowsHide: true });
      const pid = Number(String(stdout).trim());
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    }
    const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { timeout: 10_000 });
    const pid = Number(String(stdout).trim().split(/\s+/)[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** The full command line of a process, or null when it cannot be read. */
async function commandLineOf(pid: number): Promise<string | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue; if ($null -ne $p) { [Console]::Out.Write([string]$p.CommandLine) }`,
      ], { timeout: 10_000, windowsHide: true });
      const line = String(stdout).trim();
      return line || null;
    }
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command='], { timeout: 10_000 });
    const line = String(stdout).trim();
    return line || null;
  } catch {
    return null;
  }
}

/** Pull `--user-data-dir=...` out of a Chrome command line (quoted or bare). */
export function userDataDirFromCommandLine(commandLine: string | null | undefined): string | null {
  if (!commandLine) return null;
  const quoted = /--user-data-dir="([^"]+)"/.exec(commandLine);
  if (quoted?.[1]) return quoted[1];
  // Bare form runs to the next ` --flag` or end of string; profile paths may
  // contain spaces, so stopping at whitespace alone would truncate them.
  const bare = /--user-data-dir=(.+?)(?=\s+--|\s*$)/.exec(commandLine);
  return bare?.[1]?.trim() || null;
}

let ownershipCache: { port: number; pid: number; profileKey: string; offscreen: boolean | null } | null = null;

/**
 * Prove the process answering our CDP port is OUR automation Chrome.
 *
 * Two independent checks, both required:
 *   1. /json/version reports genuine Google Chrome (not Edge/Electron/WebView2).
 *   2. The OS process listening on the port is running with our exact
 *      --user-data-dir.
 *
 * Check 2 is the one that matters. Identity-by-browser-type was the old guard,
 * and it would happily have attached to the operator's Chrome had it ever been
 * started with a debugging port — it only ever asked "is this a Chrome?", never
 * "is this MY Chrome?".
 */
export async function verifyAutomationOwnership(
  config: AutomationBrowserConfig = automationBrowserConfig(),
  deps: {
    fetchImpl?: typeof fetch;
    pidForPort?: (port: number) => Promise<number | null>;
    commandLine?: (pid: number) => Promise<string | null>;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<AutomationOwnership> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const getPid = deps.pidForPort ?? pidListeningOn;
  const getCmd = deps.commandLine ?? commandLineOf;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let browser = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    let payload: Record<string, unknown> | null = null;
    try {
      const response = await fetchImpl(`${config.endpoint}/json/version`, { signal: controller.signal });
      if (!response.ok) {
        return { owned: false, answering: false, pid: null, browser: '', reason: 'The automation CDP endpoint is not answering /json/version.' };
      }
      payload = await response.json() as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }
    browser = String(payload?.Browser ?? '').trim();
    const userAgent = String(payload?.['User-Agent'] ?? '').trim();
    const combined = `${browser} ${userAgent}`;
    if (/LenovoVantage|Electron|Teams|WebView2|Edg(e|A|iOS)?\//i.test(combined) || /^Edg/i.test(browser)) {
      return {
        owned: false, answering: true, pid: null, browser,
        reason: `Port ${config.port} is held by a foreign runtime (${browser || userAgent}). LandOS will not attach to it.`,
      };
    }
    if (!/^(Headless)?Chrome\//.test(browser)) {
      return { owned: false, answering: true, pid: null, browser, reason: `Port ${config.port} is not Google Chrome (${browser || 'unknown'}).` };
    }
  } catch {
    return { owned: false, answering: false, pid: null, browser: '', reason: 'The automation CDP endpoint is not answering.' };
  }

  const pid = await getPid(config.port);
  if (pid == null) {
    return { owned: false, answering: true, pid: null, browser, reason: `Could not identify the process listening on port ${config.port}; refusing to attach.` };
  }
  if (ownershipCache && ownershipCache.port === config.port && ownershipCache.pid === pid
    && ownershipCache.profileKey === pathKey(config.profileDir)) {
    return { owned: true, answering: true, pid, browser, reason: null, offscreen: ownershipCache.offscreen };
  }

  // CIM occasionally returns an empty value for a live process while Chrome
  // is busy. Empty means "not read", not "no profile flag". Retry the exact
  // PID briefly, still fail closed, and never infer ownership from CDP alone.
  let commandLine: string | null = null;
  for (let attempt = 0; attempt < 3 && !commandLine; attempt += 1) {
    commandLine = await getCmd(pid);
    if (!commandLine && attempt < 2) await sleep(75);
  }
  if (!commandLine) {
    return { owned: false, answering: true, pid, browser, reason: `Could not read the command line of process ${pid} on port ${config.port} after 3 bounded attempts; refusing to attach.` };
  }
  const userDataDir = userDataDirFromCommandLine(commandLine);
  if (!userDataDir) {
    return { owned: false, answering: true, pid, browser, reason: `Process ${pid} on port ${config.port} declares no --user-data-dir; it is not the LandOS automation browser.` };
  }
  if (pathKey(userDataDir) !== pathKey(config.profileDir)) {
    // This is the operator's Chrome, or another project's. Never attach.
    return {
      owned: false, answering: true, pid, browser,
      reason: `Process ${pid} on port ${config.port} is running profile "${userDataDir}", not the LandOS automation profile. Refusing to attach to a browser LandOS does not own.`,
    };
  }
  // Proven from the process's OWN command line, not assumed: the single
  // launch path always positions the automation window at -32000,-32000.
  const offscreen = commandLine ? /--window-position=-32000,-32000/.test(commandLine) : null;
  ownershipCache = { port: config.port, pid, profileKey: pathKey(config.profileDir), offscreen };
  return { owned: true, answering: true, pid, browser, reason: null, offscreen };
}

// ─────────────────────────────────────────────────────────────────────────
// Launch
// ─────────────────────────────────────────────────────────────────────────

export type SpawnLike = (cmd: string, args: string[]) => { unref?: () => void; pid?: number };

const defaultSpawn: SpawnLike = (cmd, args) => {
  const child = nodeSpawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return child;
};

export interface LaunchAutomationResult {
  launched: boolean;
  reused: boolean;
  endpoint: string;
  profileDir: string;
  chromePath: string | null;
  pid: number | null;
  error: string | null;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Launch (or reuse) the dedicated automation Chrome.
 *
 * Reuse only ever means "our own already-running instance": the ownership guard
 * decides, so a foreign browser on the port produces an error rather than a
 * silent attach.
 */
export async function launchAutomationBrowser(
  deps: {
    config?: AutomationBrowserConfig;
    spawn?: SpawnLike;
    maxPolls?: number;
    pollMs?: number;
    /** Injectable ownership probe so tests can launch without a real browser. */
    verifyOwnership?: (config: AutomationBrowserConfig) => Promise<AutomationOwnership>;
  } = {},
): Promise<LaunchAutomationResult> {
  const config = deps.config ?? automationBrowserConfig();
  const verify = deps.verifyOwnership ?? verifyAutomationOwnership;
  const base = { endpoint: config.endpoint, profileDir: config.profileDir, chromePath: config.chromePath };

  const existing = await verify(config);
  if (existing.owned) {
    return { ...base, launched: false, reused: true, pid: existing.pid, error: null };
  }
  if (existing.answering) {
    // Something else holds the port. Do NOT pick another port and do NOT attach.
    return { ...base, launched: false, reused: false, pid: null, error: existing.reason };
  }
  if (!config.chromePath) {
    return { ...base, launched: false, reused: false, pid: null, error: `Google Chrome was not found. Checked: ${config.chromeChecked.join(' ; ')}.` };
  }

  try { fs.mkdirSync(config.profileDir, { recursive: true }); } catch { /* Chrome will report a real failure */ }
  const spawnImpl = deps.spawn ?? defaultSpawn;
  try {
    spawnImpl(config.chromePath, [
      `--remote-debugging-port=${config.port}`,
      `--user-data-dir=${config.profileDir}`,
      ...BASE_CHROME_ARGS,
      ...OFFSCREEN_CHROME_ARGS,
      CONTROL_PAGE_URL,
    ]);
  } catch (err) {
    return { ...base, launched: false, reused: false, pid: null, error: `Failed to launch the automation browser: ${(err as Error)?.message ?? 'unknown'}.` };
  }

  const maxPolls = deps.maxPolls ?? 24;
  const pollMs = deps.pollMs ?? 500;
  for (let i = 0; i < maxPolls; i++) {
    const owned = await verify(config);
    if (owned.owned) return { ...base, launched: true, reused: false, pid: owned.pid, error: null };
    await sleep(pollMs);
  }
  return { ...base, launched: true, reused: false, pid: null, error: 'The automation browser was launched but its debugging port did not come up.' };
}

// ─────────────────────────────────────────────────────────────────────────
// Connect + strict tab lifecycle
// ─────────────────────────────────────────────────────────────────────────

/** Minimal structural page/browser types: puppeteer-core is loaded lazily so
 *  tests and builds never need a browser present. */
export interface AutomationPage {
  goto(url: string, opts?: unknown): Promise<unknown>;
  close(opts?: unknown): Promise<void>;
  setViewport?(v: { width: number; height: number }): Promise<void>;
  evaluate?<T>(fn: unknown, ...args: unknown[]): Promise<T>;
  [key: string]: unknown;
}
export interface AutomationContext {
  newPage(): Promise<AutomationPage>;
  close?(): Promise<void>;
  [key: string]: unknown;
}
export interface AutomationBrowser {
  version(): Promise<string>;
  isConnected(): boolean;
  newPage(): Promise<AutomationPage>;
  pages(): Promise<AutomationPage[]>;
  createBrowserContext?(): Promise<AutomationContext>;
  createIncognitoBrowserContext?(): Promise<AutomationContext>;
  disconnect?(): Promise<void> | void;
  [key: string]: unknown;
}

interface PuppeteerLike {
  connect(opts: { browserURL: string; protocolTimeout?: number; defaultViewport?: null }): Promise<AutomationBrowser>;
}

async function loadPuppeteer(): Promise<PuppeteerLike | null> {
  try {
    const mod = await import('puppeteer-core') as unknown as { connect?: PuppeteerLike['connect']; default?: PuppeteerLike };
    if (typeof mod.connect === 'function') return { connect: mod.connect };
    if (mod.default?.connect) return { connect: mod.default.connect.bind(mod.default) };
    return null;
  } catch {
    return null;
  }
}

export class AutomationBrowserUnavailable extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'AutomationBrowserUnavailable';
  }
}

/**
 * Connect to the owned automation browser.
 *
 * Throws rather than returning a browser LandOS does not own. There is no
 * fallback path by design: a caller that cannot get the automation browser must
 * report that honestly, never quietly drive the operator's session instead.
 */
export async function connectAutomationBrowser(
  deps: { config?: AutomationBrowserConfig; puppeteer?: PuppeteerLike; protocolTimeoutMs?: number } = {},
): Promise<AutomationBrowser> {
  const config = deps.config ?? automationBrowserConfig();
  const ownership = await verifyAutomationOwnership(config);
  if (!ownership.owned) {
    throw new AutomationBrowserUnavailable(ownership.reason ?? 'The LandOS automation browser is not available.');
  }
  const pup = deps.puppeteer ?? await loadPuppeteer();
  if (!pup) throw new AutomationBrowserUnavailable('puppeteer-core is not installed.');
  const browser = await pup.connect({
    browserURL: config.endpoint,
    protocolTimeout: deps.protocolTimeoutMs ?? 60_000,
    defaultViewport: null,
  });
  await browser.version();
  return browser;
}

/** Close a page without ever letting a cleanup error mask the real outcome. */
async function closeQuietly(page: AutomationPage | null): Promise<void> {
  if (!page) return;
  try { await page.close({ runBeforeUnload: false }); } catch { /* already gone */ }
}

async function closeContextQuietly(context: AutomationContext | null): Promise<void> {
  if (!context?.close) return;
  try { await context.close(); } catch { /* already gone */ }
}

/**
 * Run `work` on a page in the PERSISTENT profile, and close that page in
 * `finally` whatever happens.
 *
 * Use this for LandPortal work that needs the authenticated session. The
 * authentication lives in the profile on disk, so nothing has to stay open to
 * preserve it.
 */
export async function withAutomationTab<T>(
  work: (page: AutomationPage) => Promise<T>,
  deps: { browser?: AutomationBrowser; config?: AutomationBrowserConfig; label?: string } = {},
): Promise<T> {
  const browser = deps.browser ?? await connectAutomationBrowser({ config: deps.config });
  let page: AutomationPage | null = null;
  try {
    page = await browser.newPage();
    return await work(page);
  } finally {
    await closeQuietly(page);
    if (!deps.browser) { try { await browser.disconnect?.(); } catch { /* ignore */ } }
  }
}

/**
 * Run `work` inside a DISPOSABLE incognito context, then destroy the context.
 *
 * Anti-bot sources (Zillow, Redfin) used to each spawn their own throwaway-
 * profile Chrome for this isolation — which is exactly what put a fresh,
 * position-less, foreground window on the operator's screen twice per property.
 * An incognito context gives the same cookie/storage isolation inside the one
 * owned offscreen process, and disposing it wipes the state just as completely.
 */
export async function withDisposableContext<T>(
  label: string,
  work: (page: AutomationPage) => Promise<T>,
  deps: { browser?: AutomationBrowser; config?: AutomationBrowserConfig } = {},
): Promise<T> {
  const browser = deps.browser ?? await connectAutomationBrowser({ config: deps.config });
  let context: AutomationContext | null = null;
  let page: AutomationPage | null = null;
  try {
    const create = browser.createBrowserContext ?? browser.createIncognitoBrowserContext;
    if (typeof create === 'function') {
      context = await create.call(browser);
      page = await context.newPage();
    } else {
      // Older puppeteer without context support still gets a strictly closed
      // page; isolation degrades but the window/tab guarantees do not.
      logger.warn({ label }, 'automation_browser_no_context_isolation');
      page = await browser.newPage();
    }
    return await work(page);
  } finally {
    await closeQuietly(page);
    await closeContextQuietly(context);
    if (!deps.browser) { try { await browser.disconnect?.(); } catch { /* ignore */ } }
  }
}

/**
 * A disposable incognito context that presents the small surface a lane driver
 * already expects from a browser: `newPage()` and `close()`.
 *
 * `close()` disposes the CONTEXT and drops the connection. It never closes the
 * automation browser — that would end the authenticated session every other
 * lane depends on. This shape lets a lane that used to own a whole throwaway
 * Chrome keep its existing open/use/close structure verbatim while actually
 * running inside the one owned process.
 */
export interface DisposableContextHandle {
  newPage(): Promise<AutomationPage>;
  close(): Promise<void>;
}

export async function openDisposableContextHandle(
  label: string,
  deps: { browser?: AutomationBrowser; config?: AutomationBrowserConfig } = {},
): Promise<DisposableContextHandle> {
  const browser = deps.browser ?? await connectAutomationBrowser({ config: deps.config });
  const create = browser.createBrowserContext ?? browser.createIncognitoBrowserContext;
  let context: AutomationContext | null = null;
  if (typeof create === 'function') {
    context = await create.call(browser);
  } else {
    logger.warn({ label }, 'automation_browser_no_context_isolation');
  }
  const pages: AutomationPage[] = [];
  return {
    async newPage(): Promise<AutomationPage> {
      const page = context ? await context.newPage() : await browser.newPage();
      pages.push(page);
      return page;
    },
    async close(): Promise<void> {
      // Close every page this handle handed out, THEN the context. A page left
      // behind by an early return is exactly how tabs used to accumulate.
      for (const page of pages) await closeQuietly(page);
      await closeContextQuietly(context);
      if (!deps.browser) { try { await browser.disconnect?.(); } catch { /* ignore */ } }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Orphan reaping
// ─────────────────────────────────────────────────────────────────────────

/** A page target in the automation browser. */
export interface AutomationTarget { id: string; type: string; url: string; title: string }

/** Hosts whose pages are automation work product and are safe to reap. */
const AUTOMATION_HOSTS = /(^|\.)(landportal\.com|zillow\.com|redfin\.com)$/i;

/**
 * Decide whether a target is a reapable automation page.
 *
 * Conservative on purpose: only page targets, only automation hosts, plus
 * LandOS's own dashboard origin (a QA lane leaks token-bearing dashboard tabs).
 * about:blank and the browser's own UI are left alone.
 */
export function isReapableAutomationTarget(target: AutomationTarget, dashboardOrigin?: string): boolean {
  if (target.type !== 'page') return false;
  let url: URL;
  try { url = new URL(target.url); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (AUTOMATION_HOSTS.test(url.hostname)) return true;
  if (dashboardOrigin) {
    try { if (url.origin === new URL(dashboardOrigin).origin) return true; } catch { /* ignore */ }
  }
  return false;
}

export interface ReapResult { inspected: number; closed: number; failed: number; remaining: number }

/**
 * What a reap is allowed to close.
 *
 * `automation-hosts` is the in-run default: work is still legitimately in
 * flight elsewhere in the process, so only pages this module can PROVE are
 * automation work product are touched.
 *
 * `all-pages` is for the process lifecycle boundary only. At startup nothing in
 * this process owns a tab yet, so every page in the owned browser is by
 * definition stranded and only one inert control page is retained.
 */
export type ReapScope = 'automation-hosts' | 'all-pages';

/**
 * Close every orphan automation page in the owned browser.
 *
 * Runs against the CDP HTTP interface so it works even when no puppeteer
 * connection is held. Target URLs are never logged: a leaked dashboard tab
 * carries a token in its query string.
 */
export async function reapOrphanAutomationTabs(
  deps: {
    config?: AutomationBrowserConfig;
    dashboardOrigin?: string;
    fetchImpl?: typeof fetch;
    scope?: ReapScope;
    /** Injectable ownership probe so tests can reap without a real browser. */
    verifyOwnership?: (config: AutomationBrowserConfig) => Promise<AutomationOwnership>;
  } = {},
): Promise<ReapResult> {
  const config = deps.config ?? automationBrowserConfig();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const scope: ReapScope = deps.scope ?? 'automation-hosts';
  const ownership = await (deps.verifyOwnership ?? verifyAutomationOwnership)(config);
  if (!ownership.owned) throw new AutomationBrowserUnavailable(ownership.reason ?? 'Automation browser unavailable.');

  const list = await (await fetchImpl(`${config.endpoint}/json/list`)).json() as AutomationTarget[];
  const pageTargets = list.filter((target) => target.type === 'page');
  let reapable: AutomationTarget[];
  if (scope === 'all-pages') {
    // Prefer RETAINING an existing inert page over closing everything and
    // minting a replacement: minting is a target creation this module avoids
    // whenever an equivalent page already exists.
    const keep = pageTargets.find((target) => target.url === CONTROL_PAGE_URL) ?? null;
    reapable = pageTargets.filter((target) => target !== keep);
  } else {
    reapable = list.filter((target) => isReapableAutomationTarget(target, deps.dashboardOrigin));
  }

  // Chrome exits with its last page. Guarantee a control page SURVIVES this
  // reap, or closing the final orphan takes the browser — and the live
  // authenticated session — down with it.
  const survivors = pageTargets.filter((target) => !reapable.includes(target));
  if (reapable.length > 0 && survivors.length === 0) {
    try {
      await fetchImpl(`${config.endpoint}/json/new?${encodeURIComponent(CONTROL_PAGE_URL)}`, { method: 'PUT' });
    } catch {
      // Older Chrome builds accept GET for /json/new.
      try { await fetchImpl(`${config.endpoint}/json/new?${encodeURIComponent(CONTROL_PAGE_URL)}`); } catch { /* reported below */ }
    }
  }

  let closed = 0;
  let failed = 0;
  const closedIds = new Set<string>();
  for (const target of reapable) {
    try {
      const response = await fetchImpl(`${config.endpoint}/json/close/${encodeURIComponent(target.id)}`);
      if (response.ok) { closed += 1; closedIds.add(target.id); } else failed += 1;
    } catch { failed += 1; }
  }
  // `/json/close` ACKNOWLEDGES a close; it does not wait for the target to be
  // torn down, so a target just closed can still appear in the very next
  // `/json/list`. Counting the raw re-read reported "remaining: 4" for a browser
  // that had settled at one page — a false leak alarm on the one number that
  // exists to say honestly whether anything survived. Targets confirmed closed
  // are therefore excluded by id rather than trusted to have vanished, which
  // needs no settle delay and leaves a genuinely surviving tab still counted.
  const after = await (await fetchImpl(`${config.endpoint}/json/list`)).json() as AutomationTarget[];
  const stillOpen = after.filter((target) => !closedIds.has(target.id));
  const remaining = scope === 'all-pages'
    // One retained control page is the intended end state, not a leftover.
    ? Math.max(0, stillOpen.filter((target) => target.type === 'page').length - 1)
    : stillOpen.filter((target) => isReapableAutomationTarget(target, deps.dashboardOrigin)).length;
  // Counts only — a leaked dashboard tab carries a token in its URL.
  logger.info({ scope, inspected: list.length, closed, failed, remaining }, 'automation_browser_orphans_reaped');
  return { inspected: list.length, closed, failed, remaining };
}

export interface AutomationReclaim extends ReapResult {
  /** False when there was no owned automation browser to reclaim from. */
  ran: boolean;
  note: string;
}

/**
 * RECLAIM TABS STRANDED BY A PREVIOUS LANDOS PROCESS.
 *
 * ── The defect this closes ────────────────────────────────────────────────
 *
 * Every tab-cleanup path in LandOS is in-process: `closeSurplusSessionPages`
 * walks `lanePageRegistry` and `state.workingPage`, and the post-run reap fires
 * on one route's tail. All of it dies with the process.
 *
 * The automation Chrome does NOT die with the process — that is the whole point
 * of it. It is persistent so LandPortal authentication survives restarts. So the
 * two lifetimes diverge: the runtime restarts constantly while one Chrome runs
 * for days, and every restart strands whatever tabs the dying process held.
 *
 * The reliable stranding is the shared working tab. `withWorkingPage` acquires a
 * LandPortal tab and caches it for reuse across leads; nothing but
 * `closeSurplusSessionPages` ever closes it, and the Market Research / playbook
 * lanes that borrow it never call that. One restart mid-sweep = one permanently
 * stranded LandPortal tab, each holding its own renderer process. Observed live:
 * four stranded LandPortal tabs across sixteen Chrome processes and ~1.4 GB,
 * reclaimable only by running `npm run landos:browser reap` by hand.
 *
 * ── Why this is safe here and only here ───────────────────────────────────
 *
 * At process start nothing in THIS process owns a tab, and the PID lock in
 * `acquireLock` refuses to run a second LandOS, so no live run can own one
 * either. Every page present is therefore stranded, which is what licenses
 * `all-pages` — the in-run reap must stay conservative and does.
 *
 * The ownership guard still decides: it proves the port belongs to a Chrome
 * running the LandOS profile before anything is closed, so the operator's own
 * Chrome can never be reached. Best-effort by design — no automation browser
 * running is the normal case, not a failure, and a reclaim must never block
 * startup.
 */
export async function reclaimStrandedAutomationTabs(
  deps: {
    config?: AutomationBrowserConfig;
    dashboardOrigin?: string;
    fetchImpl?: typeof fetch;
    verifyOwnership?: (config: AutomationBrowserConfig) => Promise<AutomationOwnership>;
  } = {},
): Promise<AutomationReclaim> {
  const idle: ReapResult = { inspected: 0, closed: 0, failed: 0, remaining: 0 };
  try {
    const result = await reapOrphanAutomationTabs({ ...deps, scope: 'all-pages' });
    return {
      ...result,
      ran: true,
      note: result.closed === 0
        ? 'The automation browser held no tab stranded by a previous LandOS process.'
        : `Reclaimed ${result.closed} tab(s) stranded by a previous LandOS process; one inert control page was retained.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.info({ reason: message }, 'automation_browser_reclaim_skipped');
    return { ...idle, ran: false, note: `No owned automation browser to reclaim from (${message}).` };
  }
}
