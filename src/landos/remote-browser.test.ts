import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  openRemoteBrowserSession,
  readRemoteSessionState,
  remoteBrowserConfig,
  remoteBrowserConfigured,
} from './remote-browser.js';

const ENV = {
  LANDOS_REMOTE_BROWSER_PROVIDER: 'browserbase',
  BROWSERBASE_API_KEY: 'test-key',
  BROWSERBASE_PROJECT_ID: 'proj_test',
} as NodeJS.ProcessEnv;

/** An injected Browserbase API: records every call, never touches the network. */
function fakeBrowserbase(opts: { runningSession?: string | null } = {}) {
  const calls: Array<{ method: string; route: string; body: Record<string, unknown> | null }> = [];
  let sessionCounter = 0;
  const doFetch = (async (url: string, init?: RequestInit) => {
    const route = String(url).replace('https://api.browserbase.com/v1', '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    calls.push({ method, route, body });
    const json = (value: unknown) => ({ ok: true, status: 200, json: async () => value, text: async () => JSON.stringify(value) }) as unknown as Response;
    if (method === 'POST' && route === '/contexts') return json({ id: 'ctx_persisted' });
    if (method === 'POST' && route === '/sessions') { sessionCounter += 1; return json({ id: `sess_${sessionCounter}` }); }
    if (method === 'GET' && /^\/sessions\/[^/]+\/debug$/.test(route)) {
      const id = route.slice('/sessions/'.length, -'/debug'.length);
      return json({ debuggerFullscreenUrl: `https://www.browserbase.com/devtools-fullscreen/inspector.html?session=${id}` });
    }
    if (method === 'GET' && route.startsWith('/sessions/')) {
      const id = route.slice('/sessions/'.length);
      return json({ id, status: opts.runningSession === id ? 'RUNNING' : 'COMPLETED' });
    }
    if (method === 'POST' && route.startsWith('/sessions/')) return json({ ok: true });
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' } as unknown as Response;
  }) as unknown as typeof fetch;
  const connected: string[] = [];
  const pages: Array<{ closed: boolean }> = [];
  const connect = async (ws: string) => {
    connected.push(ws);
    return {
      async newPage() { const page = { closed: false, async goto() {}, async evaluate() { return undefined as never; }, async close() { page.closed = true; } }; pages.push(page); return page; },
      async disconnect() {},
    };
  };
  return { calls, doFetch, connect, connected, pages };
}

describe('remote browser transport (Browserbase, injected)', () => {
  it('is unconfigured without the provider and both credential names', () => {
    expect(remoteBrowserConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(remoteBrowserConfigured({ ...ENV, BROWSERBASE_PROJECT_ID: '' } as NodeJS.ProcessEnv)).toBe(false);
    expect(remoteBrowserConfig(ENV).provider).toBe('browserbase');
  });

  it('creates one persistent context, one session with challenge solving OFF, and remembers both', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-remote-'));
    const fake = fakeBrowserbase();
    const handle = await openRemoteBrowserSession('zillow', { env: ENV, fetch: fake.doFetch, connect: fake.connect, stateDir });
    expect(handle.contextId).toBe('ctx_persisted');
    expect(handle.sessionId).toBe('sess_1');
    expect(handle.reconnected).toBe(false);
    // Operator viewing: the provider's own signed fullscreen debugger URL,
    // carrying no LandOS credential.
    expect(handle.liveViewUrl).toBe('https://www.browserbase.com/devtools-fullscreen/inspector.html?session=sess_1');
    const sessionCreate = fake.calls.find((call) => call.method === 'POST' && call.route === '/sessions')!;
    const settings = sessionCreate.body!.browserSettings as Record<string, unknown>;
    expect(settings.solveCaptchas).toBe(false);
    expect(settings.advancedStealth).toBe(false);
    expect((settings.context as Record<string, unknown>).id).toBe('ctx_persisted');
    expect((settings.context as Record<string, unknown>).persist).toBe(true);
    expect(sessionCreate.body).not.toHaveProperty('proxies');
    expect(fake.connected[0]).toContain('sessionId=sess_1');
    expect(readRemoteSessionState('zillow', { stateDir })?.sessionId).toBe('sess_1');
    await handle.newPage();
    await handle.close();
    expect(fake.pages[0].closed).toBe(true);
    expect(fake.calls.some((call) => call.route === '/sessions/sess_1' && call.body?.status === 'REQUEST_RELEASE')).toBe(true);
    // The identity survives the close; only the session id is cleared.
    expect(readRemoteSessionState('zillow', { stateDir })).toMatchObject({ contextId: 'ctx_persisted', sessionId: null });
  });

  it('reconnects to a still-running session on the same context instead of opening a second one', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-remote-'));
    const first = fakeBrowserbase();
    const opened = await openRemoteBrowserSession('zillow', { env: ENV, fetch: first.doFetch, connect: first.connect, stateDir });
    // Simulate a dropped connection: the state still names sess_1 and the
    // provider still reports it RUNNING.
    const second = fakeBrowserbase({ runningSession: opened.sessionId });
    const resumed = await openRemoteBrowserSession('zillow', { env: ENV, fetch: second.doFetch, connect: second.connect, stateDir });
    expect(resumed.reconnected).toBe(true);
    expect(resumed.sessionId).toBe('sess_1');
    expect(resumed.contextId).toBe('ctx_persisted');
    expect(second.calls.some((call) => call.method === 'POST' && call.route === '/contexts')).toBe(false);
    expect(second.calls.some((call) => call.method === 'POST' && call.route === '/sessions')).toBe(false);
  });
});
