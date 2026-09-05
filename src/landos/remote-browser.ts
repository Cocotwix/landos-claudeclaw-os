/**
 * Remote browser transport for research lanes whose local automation profile
 * keeps being challenged (Zillow). One provider, one narrow seam:
 *
 *   Browserbase — chosen over Browserless because it gives the two things the
 *   Zillow adapter actually needs with the smallest change to the existing
 *   puppeteer `connect` architecture: a first-class PERSISTENT CONTEXT (cookies,
 *   local storage, cache and session identity survive across sessions) and
 *   session RECONNECTION by id through one CDP websocket. Browserless offers
 *   reconnection but treats persistent profiles as a launch-argument concern.
 *
 * What this module never does: solve, hold, script or automate any anti-bot
 * challenge; alter fingerprints; rotate proxies or network identity. The
 * provider's own challenge-solving and stealth options are explicitly turned
 * OFF in every session request. A challenged page is reported as blocked.
 *
 * Configuration (no secret is embedded; the value is read from the process
 * environment the way every other provider credential is):
 *   LANDOS_REMOTE_BROWSER_PROVIDER=browserbase
 *   BROWSERBASE_API_KEY=<api key>
 *   BROWSERBASE_PROJECT_ID=<project id>
 *
 * Session state (context id, last session id) is kept under
 * `.runtime/landos/remote-browser/<label>.json` so a reconnect resumes the
 * same identity and the same still-running session instead of opening a new
 * one. Closing releases the remote session; the context (the identity) stays.
 */

import fs from 'node:fs';
import path from 'node:path';

export type RemoteBrowserProvider = 'browserbase';

export interface RemoteBrowserConfig {
  provider: RemoteBrowserProvider | null;
  apiKey: string | null;
  projectId: string | null;
  apiBase: string;
  connectBase: string;
}

export const REMOTE_BROWSER_PROVIDER_ENV = 'LANDOS_REMOTE_BROWSER_PROVIDER';
export const BROWSERBASE_API_KEY_ENV = 'BROWSERBASE_API_KEY';
export const BROWSERBASE_PROJECT_ID_ENV = 'BROWSERBASE_PROJECT_ID';

export function remoteBrowserConfig(env: NodeJS.ProcessEnv = process.env): RemoteBrowserConfig {
  const provider = (env[REMOTE_BROWSER_PROVIDER_ENV] ?? '').trim().toLowerCase();
  const apiKey = (env[BROWSERBASE_API_KEY_ENV] ?? '').trim() || null;
  const projectId = (env[BROWSERBASE_PROJECT_ID_ENV] ?? '').trim() || null;
  return {
    provider: provider === 'browserbase' && apiKey && projectId ? 'browserbase' : null,
    apiKey,
    projectId,
    apiBase: (env.BROWSERBASE_API_BASE ?? 'https://api.browserbase.com/v1').replace(/\/+$/, ''),
    connectBase: (env.BROWSERBASE_CONNECT_BASE ?? 'wss://connect.browserbase.com').replace(/\/+$/, ''),
  };
}

/** True when a remote provider is fully configured. */
export function remoteBrowserConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return remoteBrowserConfig(env).provider != null;
}

export interface RemotePageLike {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  evaluate<T>(fn: (() => T) | string, ...args: unknown[]): Promise<T>;
  close?(opts?: { runBeforeUnload?: boolean }): Promise<void>;
  setViewport?(v: { width: number; height: number }): Promise<void>;
}

export interface RemoteBrowserLike {
  newPage(): Promise<RemotePageLike>;
  disconnect?(): Promise<void> | void;
  close?(): Promise<void>;
}

export interface RemoteSessionState {
  provider: RemoteBrowserProvider;
  label: string;
  contextId: string;
  sessionId: string | null;
  updatedAt: string;
}

export interface RemoteBrowserHandle {
  provider: RemoteBrowserProvider;
  contextId: string;
  sessionId: string;
  /** True when an existing RUNNING session was resumed instead of created. */
  reconnected: boolean;
  /**
   * A URL the operator can open to WATCH this remote session live in a normal
   * browser tab (Browserbase's fullscreen debugger view). Null when the
   * provider did not return one. It carries no LandOS credential; it is the
   * provider's own signed viewing link. This is how a human sees, and if the
   * provider surfaces an interactive challenge, clears it — the same single
   * operator interaction the local flow allowed, now on the remote session.
   */
  liveViewUrl: string | null;
  newPage(): Promise<RemotePageLike>;
  /** Close the pages this handle opened, disconnect, and release the remote
   *  session. The persistent context (identity) is kept. */
  close(): Promise<void>;
}

export interface RemoteSessionDeps {
  fetch?: typeof fetch;
  /** puppeteer-style connect over the provider's CDP websocket. */
  connect?: (browserWSEndpoint: string) => Promise<RemoteBrowserLike>;
  /** Directory for the per-label state file (default `.runtime/landos/remote-browser`). */
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

function stateFile(deps: RemoteSessionDeps, label: string): string {
  const dir = deps.stateDir ?? path.join(process.cwd(), '.runtime', 'landos', 'remote-browser');
  return path.join(dir, `${label}.json`);
}

export function readRemoteSessionState(label: string, deps: RemoteSessionDeps = {}): RemoteSessionState | null {
  try {
    const raw = fs.readFileSync(stateFile(deps, label), 'utf8');
    const parsed = JSON.parse(raw) as RemoteSessionState;
    return parsed && typeof parsed.contextId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function writeRemoteSessionState(label: string, state: RemoteSessionState, deps: RemoteSessionDeps): void {
  const file = stateFile(deps, label);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

async function loadConnect(): Promise<(browserWSEndpoint: string) => Promise<RemoteBrowserLike>> {
  const mod = await import('puppeteer-core') as unknown as {
    connect?: (opts: Record<string, unknown>) => Promise<RemoteBrowserLike>;
    default?: { connect?: (opts: Record<string, unknown>) => Promise<RemoteBrowserLike> };
  };
  const connect = mod.connect ?? mod.default?.connect?.bind(mod.default);
  if (!connect) throw new Error('puppeteer-core is not installed.');
  return (browserWSEndpoint) => connect({ browserWSEndpoint, protocolTimeout: 60_000, defaultViewport: null });
}

async function browserbaseRequest<T>(
  config: RemoteBrowserConfig,
  doFetch: typeof fetch,
  method: 'GET' | 'POST',
  route: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await doFetch(`${config.apiBase}${route}`, {
    method,
    headers: {
      'x-bb-api-key': config.apiKey as string,
      'content-type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Browserbase ${method} ${route} failed: HTTP ${response.status}${text ? ` ${text.slice(0, 200)}` : ''}`);
  }
  return await response.json() as T;
}

/**
 * Open (or resume) the ONE persistent remote session for a label. The
 * provider's challenge-solving and stealth features are explicitly disabled;
 * the session is a plain browser with a persistent identity.
 */
export async function openRemoteBrowserSession(label: string, deps: RemoteSessionDeps = {}): Promise<RemoteBrowserHandle> {
  const config = remoteBrowserConfig(deps.env ?? process.env);
  if (config.provider !== 'browserbase') {
    throw new Error(`Remote browser is not configured: set ${REMOTE_BROWSER_PROVIDER_ENV}=browserbase, ${BROWSERBASE_API_KEY_ENV} and ${BROWSERBASE_PROJECT_ID_ENV}.`);
  }
  const doFetch = deps.fetch ?? fetch;
  const connect = deps.connect ?? await loadConnect();
  const nowIso = () => new Date((deps.now ?? Date.now)()).toISOString();

  let state = readRemoteSessionState(label, deps);
  if (!state || state.provider !== 'browserbase') {
    const context = await browserbaseRequest<{ id: string }>(config, doFetch, 'POST', '/contexts', { projectId: config.projectId });
    state = { provider: 'browserbase', label, contextId: context.id, sessionId: null, updatedAt: nowIso() };
    writeRemoteSessionState(label, state, deps);
  }

  // Resume a still-running session on the same identity rather than opening a
  // second one: the same pages, cookies and storage continue.
  let sessionId: string | null = null;
  let reconnected = false;
  if (state.sessionId) {
    try {
      const existing = await browserbaseRequest<{ id: string; status: string }>(config, doFetch, 'GET', `/sessions/${state.sessionId}`);
      if (existing.status === 'RUNNING') { sessionId = existing.id; reconnected = true; }
    } catch { /* fall through to a fresh session on the same context */ }
  }
  if (!sessionId) {
    const created = await browserbaseRequest<{ id: string }>(config, doFetch, 'POST', '/sessions', {
      projectId: config.projectId,
      browserSettings: {
        context: { id: state.contextId, persist: true },
        // Never: no challenge solving, no stealth, no fingerprint changes.
        solveCaptchas: false,
        advancedStealth: false,
      },
      keepAlive: true,
    });
    sessionId = created.id;
  }
  state = { ...state, sessionId, updatedAt: nowIso() };
  writeRemoteSessionState(label, state, deps);

  const browser = await connect(`${config.connectBase}?apiKey=${encodeURIComponent(config.apiKey as string)}&sessionId=${encodeURIComponent(sessionId)}`);
  // Operator viewing: the provider's own signed fullscreen debugger URL. Best
  // effort — a session with no debug view is still fully usable headlessly.
  let liveViewUrl: string | null = null;
  try {
    const debug = await browserbaseRequest<{ debuggerFullscreenUrl?: string; debuggerUrl?: string }>(
      config, doFetch, 'GET', `/sessions/${sessionId}/debug`,
    );
    liveViewUrl = debug.debuggerFullscreenUrl ?? debug.debuggerUrl ?? null;
  } catch { /* no live view available; headless operation is unaffected */ }
  const pages: RemotePageLike[] = [];
  const contextId = state.contextId;
  return {
    provider: 'browserbase',
    contextId,
    sessionId,
    reconnected,
    liveViewUrl,
    async newPage() {
      const page = await browser.newPage();
      pages.push(page);
      return page;
    },
    async close() {
      for (const page of pages) { try { await page.close?.({ runBeforeUnload: false }); } catch { /* gone */ } }
      try { await browser.disconnect?.(); } catch { /* ignore */ }
      try {
        await browserbaseRequest(config, doFetch, 'POST', `/sessions/${sessionId}`, { projectId: config.projectId, status: 'REQUEST_RELEASE' });
      } catch { /* the provider times the session out on its own */ }
      const current = readRemoteSessionState(label, deps);
      if (current && current.sessionId === sessionId) writeRemoteSessionState(label, { ...current, sessionId: null, updatedAt: nowIso() }, deps);
    },
  };
}

/** The one-line provisioning requirement, for reports and status surfaces. */
export function remoteBrowserProvisioningRequirement(): string {
  return `Browserbase account with an API key and project id; configure ${BROWSERBASE_API_KEY_ENV} and ${BROWSERBASE_PROJECT_ID_ENV} in the environment file and set ${REMOTE_BROWSER_PROVIDER_ENV}=browserbase.`;
}
