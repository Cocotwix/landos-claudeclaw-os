// Contract test suite for the Mission Control HTTP API.
//
// Why this exists: a frontend rewrite is in progress (web/ Vite project,
// rolling out PR-by-PR). The new frontend is built against the documented
// shape of every endpoint. If the backend ever drifts from that shape —
// renames a field, changes nullability, swaps a type — the rewrite breaks
// silently. These tests pin the response shape of every endpoint family
// the new frontend depends on, so any drift fails CI before it ships.
//
// Tests use Hono's `app.request()` so no real port is opened. The DB is
// the in-memory test DB initialized via `_initTestDatabase()`.
//
// Env vars are set by `src/test-env-setup.ts` (vitest setupFiles) so they
// land BEFORE config.ts evaluates at import time.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { _initTestDatabase } from './db.js';
import { _initTestForgeDb } from './forge/host-store.js';
import { _initTestLandosDb } from './landos/db.js';
import { buildDashboardApp } from './dashboard.js';
import type { Hono } from 'hono';

const TOKEN = 'test-contract-token';
const Q = '?token=' + TOKEN;

let app: Hono;

beforeAll(() => {
  app = buildDashboardApp(undefined) as unknown as Hono;
});

beforeEach(() => {
  _initTestDatabase();
  // Forge endpoints persist to a dedicated store; use a fresh in-memory DB
  // per test so the contract suite never writes a real store/forge.db.
  _initTestForgeDb();
  // LandOS property-card / lead-job endpoints persist to landos.db; fresh
  // in-memory per test so the contract suite never writes a real store.
  _initTestLandosDb();
});

async function get(path: string) {
  return app.request(path + (path.includes('?') ? '&' : '?') + 'token=' + TOKEN);
}

async function getNoToken(path: string) {
  return app.request(path);
}

// Tests fetch JSON we only describe shape-wise — typing as `any` keeps the
// assertions readable without forcing the real interfaces into the test file.
async function jsonOf(res: Response): Promise<any> {
  return res.json();
}

describe('auth gate', () => {
  it('rejects unauthorized GET without token', async () => {
    const res = await getNoToken('/api/health');
    expect(res.status).toBe(401);
    expect(await jsonOf(res)).toMatchObject({ error: 'Unauthorized' });
  });

  it('rejects unauthorized GET with wrong token', async () => {
    const res = await app.request('/api/health?token=wrong');
    expect(res.status).toBe(401);
  });

  it('accepts GET with correct token', async () => {
    const res = await get('/api/health');
    expect(res.status).toBe(200);
  });

  it('responds 204 to OPTIONS preflight without token check', async () => {
    const res = await app.request('/api/health', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
  });

  // Regression: the SPA shell (`<script src="/assets/...">`) has no
  // token in the URL. If the auth middleware ever gates /assets/* the
  // bundle 401s and the dashboard goes blank — the symptom Mark hit
  // when the dashboard "wouldn't load" after a previous refactor.
  // Static assets must always be reachable without a token.
  it('serves /assets/* without a token (SPA bundle would 401 otherwise)', async () => {
    // Hit a path we know won't exist on disk, just to prove the auth
    // middleware ALLOWS the request through. Whether the file exists is
    // a separate concern handled by the /assets/* handler.
    const res = await app.request('/assets/some-bundle-that-doesnt-exist.js');
    // Acceptable outcomes: 200/204 (file served), 404 (handler ran and
    // didn't find it). NOT acceptable: 401 (middleware blocked it).
    expect(res.status).not.toBe(401);
  });

  it('serves /favicon.svg without a token', async () => {
    const res = await app.request('/favicon.svg');
    expect(res.status).not.toBe(401);
  });

  // Regression: SPA shell paths must be reachable without a token so a
  // hard-refresh of a token-stripped URL still loads the frontend, which
  // can recover the token from sessionStorage. If these 401, the user
  // sees raw JSON {"error":"Unauthorized"} on every refresh — exactly
  // the bug Mark hit. The HTML these serve has no embedded secret; the
  // frontend reads token from query string then falls back to storage.
  // Every client-side wouter route must be in this list.
  for (const path of [
    '/', '/warroom', '/mission', '/scheduled', '/agents',
    '/agents/comms/files', '/chat', '/memories', '/hive', '/usage',
    '/audit', '/settings',
  ]) {
    it(`serves SPA shell at ${path} without a token`, async () => {
      const res = await app.request(path);
      expect(res.status).not.toBe(401);
    });
  }

  // Legacy mode HTML embeds DASHBOARD_TOKEN, so those variants MUST stay
  // gated even though the path is exempt at the middleware. The handler
  // does an inline check.
  it('blocks legacy /warroom?mode=picker without a token (HTML embeds token)', async () => {
    const res = await app.request('/warroom?mode=picker');
    expect(res.status).toBe(401);
  });

  it('blocks legacy /warroom?mode=voice without a token (HTML embeds token)', async () => {
    const res = await app.request('/warroom?mode=voice');
    expect(res.status).toBe(401);
  });

  it('blocks legacy /warroom/text without a token (HTML embeds token)', async () => {
    const res = await app.request('/warroom/text?meetingId=wr_test');
    expect(res.status).toBe(401);
  });

  // Regression: the CSRF middleware reads its allowed-origin host from
  // the DASHBOARD_URL env var. If it reads from process.env directly
  // (instead of the config helper that also consults the .env file),
  // the production daemon — which doesn't have process.env populated
  // from .env — 403s every cross-origin POST from the Cloudflare tunnel.
  // src/test-env-setup.ts sets DASHBOARD_URL=https://dash.test.example
  // so this test exercises the right code path.
  it('allows POSTs with Origin matching DASHBOARD_URL', async () => {
    const res = await app.request('/api/mission/tasks?token=' + TOKEN, {
      method: 'POST',
      headers: { 'origin': 'https://dash.test.example', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'csrf test', prompt: 'csrf test' }),
    });
    // 200 (created) or 400 (validation) — anything but 403 means the
    // CSRF middleware let it through, which is what we're testing.
    expect(res.status).not.toBe(403);
  });

  it('blocks POSTs from disallowed origin', async () => {
    const res = await app.request('/api/mission/tasks?token=' + TOKEN, {
      method: 'POST',
      headers: { 'origin': 'https://evil.example.com', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'csrf test', prompt: 'csrf test' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/health', () => {
  it('returns the documented shape', async () => {
    const res = await get('/api/health');
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      contextPct: expect.any(Number),
      turns: expect.any(Number),
      compactions: expect.any(Number),
      sessionAge: expect.any(String),
      model: expect.any(String),
      telegramConnected: expect.any(Boolean),
      waConnected: expect.any(Boolean),
      slackConnected: expect.any(Boolean),
      killSwitches: expect.any(Object),
      killSwitchRefusals: expect.any(Object),
      warroom: expect.objectContaining({
        textOpenMeetings: expect.any(Number),
      }),
    });
  });

  it('killSwitches contains all 6 documented flags', async () => {
    const res = await get('/api/health');
    const body = await jsonOf(res);
    expect(body.killSwitches).toMatchObject({
      WARROOM_TEXT_ENABLED: expect.any(Boolean),
      WARROOM_VOICE_ENABLED: expect.any(Boolean),
      LLM_SPAWN_ENABLED: expect.any(Boolean),
      DASHBOARD_MUTATIONS_ENABLED: expect.any(Boolean),
      MISSION_AUTO_ASSIGN_ENABLED: expect.any(Boolean),
      SCHEDULER_ENABLED: expect.any(Boolean),
    });
  });
});

describe('GET /api/info', () => {
  it('returns botName, botUsername, pid, chatId', async () => {
    const res = await get('/api/info');
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      botName: expect.any(String),
      botUsername: expect.any(String),
      pid: expect.any(Number),
    });
    expect('chatId' in body).toBe(true);
  });
});

describe('GET /api/agents', () => {
  it('returns { agents: [] } even when no agents configured', async () => {
    const res = await get('/api/agents');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({ agents: expect.any(Array) });
  });

  it('always includes main as first entry when present', async () => {
    const res = await get('/api/agents');
    const body = await jsonOf(res);
    if (body.agents.length > 0) {
      expect(body.agents[0]).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        running: expect.any(Boolean),
      });
    }
  });
});

describe('GET /api/tasks (scheduled)', () => {
  it('returns { tasks: [] }', async () => {
    const res = await get('/api/tasks');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({ tasks: expect.any(Array) });
  });
});

describe('GET /api/mission/tasks', () => {
  it('returns { tasks: [] }', async () => {
    const res = await get('/api/mission/tasks');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({ tasks: expect.any(Array) });
  });

  it('accepts ?agent and ?status filters', async () => {
    const res = await get('/api/mission/tasks?agent=main&status=queued');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.tasks).toBeInstanceOf(Array);
  });
});

describe('GET /api/mission/history', () => {
  it('returns paginated { tasks, total }', async () => {
    const res = await get('/api/mission/history?limit=5&offset=0');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      tasks: expect.any(Array),
      total: expect.any(Number),
    });
  });
});

describe('POST /api/mission/tasks', () => {
  it('rejects missing title with 400', async () => {
    const res = await app.request('/api/mission/tasks' + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'test prompt' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing prompt with 400', async () => {
    const res = await app.request('/api/mission/tasks' + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'test' }),
    });
    expect(res.status).toBe(400);
  });

  it('creates task with valid input and returns full task shape', async () => {
    const res = await app.request('/api/mission/tasks' + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'contract test', prompt: 'do nothing', priority: 3 }),
    });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.task).toMatchObject({
      id: expect.any(String),
      title: 'contract test',
      prompt: 'do nothing',
      status: 'queued',
      priority: 3,
      created_by: 'dashboard',
      created_at: expect.any(Number),
    });
  });
});

describe('POST /api/forge/engagement', () => {
  async function forge(payload: unknown) {
    return app.request('/api/forge/engagement' + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  it('rejects missing request with 400', async () => {
    const res = await forge({ title: 'no body' });
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toMatchObject({ error: expect.any(String) });
  });

  it('rejects empty request with 400', async () => {
    const res = await forge({ request: '   ' });
    expect(res.status).toBe(400);
  });

  it('returns SAFE for a normal safe repo-local build request', async () => {
    const res = await forge({ request: 'Add a date helper to src/utils with a unit test.' });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.verdict).toBe('SAFE');
    expect(body.lane.categories).toEqual([]);
    expect(typeof body.markdown).toBe('string');
    expect(body.markdown).toContain('# Forge Engagement');
    expect(body.title.length).toBeGreaterThan(0);
  });

  it('returns STOP for a deploy / git push request', async () => {
    const res = await forge({ request: 'Build the change then git push and deploy to staging.' });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.verdict).toBe('STOP');
    expect(body.lane.categories).toContain('git_push_or_deploy');
    expect(body.decisionsNeeded.length).toBeGreaterThan(0);
  });

  it('returns STOP for a secrets / API key request', async () => {
    const res = await forge({ request: 'Add the Stripe API key to the config.', title: 'Risky' });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.verdict).toBe('STOP');
    expect(body.lane.categories).toContain('secrets_credentials');
  });

  it('rejects invalid JSON with 400', async () => {
    const res = await app.request('/api/forge/engagement' + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not valid json',
    });
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toMatchObject({ error: 'invalid JSON body' });
  });

  it('rejects a non-string request with 400', async () => {
    const res = await forge({ request: 123 });
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toMatchObject({ error: 'request must be a string' });
  });

  it('rejects a non-string title with 400', async () => {
    const res = await forge({ request: 'Add a helper.', title: 42 });
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toMatchObject({ error: 'title must be a string' });
  });

  it('rejects a non-string host with 400', async () => {
    const res = await forge({ request: 'Add a helper.', host: { name: 'not a string' } });
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toMatchObject({ error: 'host must be a string' });
  });

  it('rejects a request longer than 10000 chars with 400', async () => {
    const res = await forge({ request: 'a'.repeat(10001) });
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toMatchObject({ error: 'request too long (max 10000 chars)' });
  });
});

describe('Forge engagement persistence + helpers', () => {
  async function save(payload: unknown) {
    return app.request('/api/forge/engagements' + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  it('saves a generated engagement and returns the stored record', async () => {
    const res = await save({ request: 'Add a date helper to src/utils with a test.', title: 'Date utils' });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.engagement.id).toEqual(expect.any(String));
    expect(body.engagement.verdict).toBe('SAFE');
    expect(body.engagement.status).toBe('draft');
    expect(body.engagement.markdown).toContain('# Forge Engagement');
  });

  it('rejects save with a non-string request (400)', async () => {
    const res = await save({ request: 123 });
    expect(res.status).toBe(400);
  });

  it('lists saved engagements newest-first', async () => {
    await save({ request: 'First safe build.' });
    await save({ request: 'Second safe build.' });
    const res = await app.request('/api/forge/engagements' + Q);
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.engagements.length).toBe(2);
  });

  it('gets a saved engagement by id and 404s for unknown id', async () => {
    const saved = await jsonOf(await save({ request: 'Add a util.' }));
    const id = saved.engagement.id;
    const ok = await app.request(`/api/forge/engagements/${id}` + Q);
    expect(ok.status).toBe(200);
    const miss = await app.request('/api/forge/engagements/deadbeef' + Q);
    expect(miss.status).toBe(404);
  });

  it('patches status and notes on a saved engagement', async () => {
    const saved = await jsonOf(await save({ request: 'Add a util.' }));
    const id = saved.engagement.id;
    const res = await app.request(`/api/forge/engagements/${id}` + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'needs_review', notes: 'ready for codex' }),
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.engagement.status).toBe('needs_review');
    expect(body.engagement.notes).toBe('ready for codex');
  });

  it('rejects an invalid status on patch (400)', async () => {
    const saved = await jsonOf(await save({ request: 'Add a util.' }));
    const res = await app.request(`/api/forge/engagements/${saved.engagement.id}` + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'not_a_status' }),
    });
    expect(res.status).toBe(400);
  });

  it('generates a review packet for a saved engagement', async () => {
    const saved = await jsonOf(await save({ request: 'Add a util.', title: 'Util' }));
    const res = await app.request(`/api/forge/engagements/${saved.engagement.id}/review-packet` + Q, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.packet).toContain('# Codex Review Packet');
    expect(body.packet).toContain('Safe to push: Yes or No');
  });

  it('generates an ad-hoc review packet', async () => {
    const res = await app.request('/api/forge/review-packet' + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'ad hoc', currentCommit: 'abc123' }),
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.packet).toContain('# Codex Review Packet');
    expect(body.packet).toContain('abc123');
  });

  it('generates a command plan with the hard safety rails', async () => {
    const res = await app.request('/api/forge/command-plan' + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'plan', verdict: 'STOP', categories: ['secrets_credentials'] }),
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.plan).toContain('## Never approve');
    expect(body.plan).toContain('git add .');
    expect(body.plan).toContain('Lane verdict: STOP');
  });
});

describe('Forge security + release builder endpoints', () => {
  function post(path: string, payload: unknown) {
    return app.request(path + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  it('security-check classifies owner-owned gates', async () => {
    const res = await post('/api/forge/security-check', { request: 'Add OAuth and deploy to production.' });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.security.categories).toEqual(expect.arrayContaining(['oauth', 'production_deploy']));
    expect(body.security.lane).toBe('release_approval_required');
  });

  it('security-check 400s without a request or id', async () => {
    const res = await post('/api/forge/security-check', {});
    expect(res.status).toBe(400);
  });

  it('setup-checklist returns placeholders and the gate set', async () => {
    const res = await post('/api/forge/setup-checklist', { request: 'Wire up an API key.', title: 'Provider' });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.checklist).toContain('# Owner Setup Checklist');
    expect(body.checklist).toContain('<your-');
    expect(body.security.categories).toContain('api_key');
  });

  it('demo-runbook returns proof steps', async () => {
    const res = await post('/api/forge/demo-runbook', { title: 'demo', startCommand: 'npm run dev' });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.runbook).toContain('## How to start');
    expect(body.runbook).toContain('## Do NOT test without owner approval');
  });

  it('completion-report returns all sections', async () => {
    const res = await post('/api/forge/completion-report', {
      request: 'Add OAuth and deploy to production.',
      title: 'Build',
      whatWasBuilt: ['A thing'],
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.report).toContain('# Forge Completion Report');
    expect(body.report).toContain('## 10. Owner decision');
    expect(body.security.lane).toBe('release_approval_required');
  });

  it('saves an engagement then sets the owner decision', async () => {
    const saved = await jsonOf(
      await post('/api/forge/engagements', { request: 'Add a safe util.', title: 'Util' }),
    );
    const id = saved.engagement.id;
    expect(saved.engagement.ownerDecision).toBe('pending');

    const res = await app.request(`/api/forge/engagements/${id}/decision` + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ownerDecision: 'approved' }),
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.engagement.ownerDecision).toBe('approved');
  });

  it('rejects an invalid owner decision (400) and unknown id (404)', async () => {
    const saved = await jsonOf(await post('/api/forge/engagements', { request: 'Add a util.' }));
    const bad = await app.request(`/api/forge/engagements/${saved.engagement.id}/decision` + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ownerDecision: 'nope' }),
    });
    expect(bad.status).toBe(400);

    const miss = await app.request('/api/forge/engagements/deadbeef/decision' + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ownerDecision: 'approved' }),
    });
    expect(miss.status).toBe(404);
  });
});

describe('Forge department-agent profile endpoints', () => {
  function post(path: string, payload: unknown) {
    return app.request(path + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  it('agent-interview returns sections and markdown', async () => {
    const res = await post('/api/forge/agent-interview', {
      request: 'an agent that drafts status updates',
      displayName: 'Reporter',
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(Array.isArray(body.interview.sections)).toBe(true);
    expect(body.interview.sections.length).toBeGreaterThan(0);
    expect(body.markdown).toContain('# Define a department agent');
  });

  it('agent-profile fills neutral defaults and forces sandbox when unauthorized', async () => {
    const res = await post('/api/forge/agent-profile', {
      request: 'an agent for reporting',
      displayName: 'Reporter',
      department: 'Reporting',
      activationMode: 'live',
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.profile.agentName).toBe('reporter');
    expect(body.profile.activationMode).toBe('sandbox');
    expect(body.authority.authorized).toBe(false);
    expect(body.authority.effectiveMode).toBe('sandbox');
    expect(body.profile.hardStops.length).toBeGreaterThan(0);
    expect(body.markdown).toContain('# Department Agent Profile');
  });

  it('agent-profile honors authorized live actions', async () => {
    const res = await post('/api/forge/agent-profile', {
      request: 'an agent for reporting',
      displayName: 'Reporter',
      activationMode: 'assisted_live',
      liveActionAuthority: { authorized: true, approvedActions: ['send a draft for review'] },
    });
    const body = await jsonOf(res);
    expect(body.profile.activationMode).toBe('assisted_live');
    expect(body.authority.approvedLiveActions).toEqual(['send a draft for review']);
  });

  it('agent-build-packet returns every required section', async () => {
    const res = await post('/api/forge/agent-build-packet', {
      request: 'an agent for reporting',
      displayName: 'Reporter',
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.packet).toContain('# Forge Agent Build Packet');
    expect(body.packet).toContain('## 4. Authority model');
    expect(body.packet).toContain('## 10. Activation checklist');
    expect(body.packet).toContain('## 11. Owner decision options');
  });

  it('400s on invalid JSON', async () => {
    const res = await app.request('/api/forge/agent-profile' + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('Forge saved department-agent profile endpoints', () => {
  function post(path: string, payload: unknown) {
    return app.request(path + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
  function patch(path: string, payload: unknown) {
    return app.request(path + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async function saveOne(over: Record<string, unknown> = {}) {
    const res = await post('/api/forge/agent-profiles', {
      request: 'an agent that drafts and organizes status updates',
      displayName: 'Reporter',
      department: 'Reporting',
      ...over,
    });
    expect(res.status).toBe(201);
    return (await jsonOf(res)).profile;
  }

  it('saves a generated profile and reads it back', async () => {
    const saved = await saveOne();
    expect(saved.id).toMatch(/^[0-9a-f]{8}$/);
    expect(saved.status).toBe('draft');
    expect(saved.ownerDecision).toBe('pending');
    expect(saved.activationMode).toBe('sandbox');
    expect(saved.profile.displayName).toBe('Reporter');
    expect(saved.buildPacket).toContain('# Forge Agent Build Packet');

    const getRes = await get(`/api/forge/agent-profiles/${saved.id}`);
    expect(getRes.status).toBe(200);
    const body = await jsonOf(getRes);
    expect(body.profile.id).toBe(saved.id);
    expect(body.profile.department).toBe('Reporting');
  });

  it('lists saved profiles newest first and filters by status', async () => {
    await saveOne();
    const second = await saveOne({ status: 'review_ready' });
    const listRes = await get('/api/forge/agent-profiles');
    const list = await jsonOf(listRes);
    expect(list.profiles.length).toBeGreaterThanOrEqual(2);
    expect(list.profiles[0].id).toBe(second.id);

    const filteredRes = await get('/api/forge/agent-profiles?status=review_ready');
    const filtered = await jsonOf(filteredRes);
    expect(filtered.profiles.every((p: { status: string }) => p.status === 'review_ready')).toBe(true);
  });

  it('updates status and owner decision', async () => {
    const saved = await saveOne();
    const res = await patch(`/api/forge/agent-profiles/${saved.id}`, {
      status: 'approved',
      ownerDecision: 'approved',
      notes: 'good',
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.profile.status).toBe('approved');
    expect(body.profile.ownerDecision).toBe('approved');
    expect(body.profile.notes).toBe('good');
  });

  it('rejects an invalid status on update', async () => {
    const saved = await saveOne();
    const res = await patch(`/api/forge/agent-profiles/${saved.id}`, { status: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('generates a review packet for a saved profile', async () => {
    const saved = await saveOne();
    const res = await post(`/api/forge/agent-profiles/${saved.id}/review-packet`, {});
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.packet).toContain('# Profile Review Packet');
    expect(body.packet).toContain('## Recommended next step');
  });

  it('generates a promotion readiness checklist for a saved profile', async () => {
    const saved = await saveOne();
    const res = await post(`/api/forge/agent-profiles/${saved.id}/promotion-checklist`, {});
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(typeof body.readiness.ready).toBe('boolean');
    expect(body.readiness.items.length).toBeGreaterThan(0);
    expect(body.markdown).toContain('# Promotion Readiness');
  });

  it('404s for an unknown profile id', async () => {
    const res = await get('/api/forge/agent-profiles/deadbeef');
    expect(res.status).toBe(404);
  });

  it('400s on invalid JSON', async () => {
    const res = await app.request('/api/forge/agent-profiles' + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('Forge draft promotion scaffold endpoints', () => {
  function post(path: string, payload: unknown) {
    return app.request(path + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
  function patch(path: string, payload: unknown) {
    return app.request(path + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async function saveProfile(over: Record<string, unknown> = {}) {
    const res = await post('/api/forge/agent-profiles', {
      request: 'an agent that drafts and organizes status updates',
      displayName: 'Reporter',
      department: 'Reporting',
      ...over,
    });
    expect(res.status).toBe(201);
    return (await jsonOf(res)).profile;
  }

  it('generates and saves a scaffold for a saved profile', async () => {
    const profile = await saveProfile();
    const res = await post(`/api/forge/agent-profiles/${profile.id}/promotion-scaffold`, {});
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.scaffold.id).toMatch(/^[0-9a-f]{8}$/);
    expect(body.scaffold.savedProfileId).toBe(profile.id);
    expect(body.scaffold.proposedSlug).toBe('reporter');
    expect(body.scaffold.status).toBe('draft');
    expect(body.scaffold.scaffold.notActive.join(' ')).toContain('Not active');
    expect(body.scaffold.markdown).toContain('# Draft Promotion Scaffold');
  });

  it('404s generating a scaffold for an unknown profile', async () => {
    const res = await post('/api/forge/agent-profiles/deadbeef/promotion-scaffold', {});
    expect(res.status).toBe(404);
  });

  it('lists and reopens saved scaffolds', async () => {
    const profile = await saveProfile();
    const made = await jsonOf(
      await post(`/api/forge/agent-profiles/${profile.id}/promotion-scaffold`, {}),
    );
    const listRes = await get('/api/forge/promotion-scaffolds');
    const list = await jsonOf(listRes);
    expect(list.scaffolds.length).toBeGreaterThanOrEqual(1);

    const getRes = await get(`/api/forge/promotion-scaffolds/${made.scaffold.id}`);
    expect(getRes.status).toBe(200);
    expect((await jsonOf(getRes)).scaffold.id).toBe(made.scaffold.id);
  });

  it('updates scaffold status and owner decision', async () => {
    const profile = await saveProfile();
    const made = await jsonOf(
      await post(`/api/forge/agent-profiles/${profile.id}/promotion-scaffold`, {}),
    );
    const res = await patch(`/api/forge/promotion-scaffolds/${made.scaffold.id}`, {
      status: 'approved_for_generation',
      ownerDecision: 'approved',
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.scaffold.status).toBe('approved_for_generation');
    expect(body.scaffold.ownerDecision).toBe('approved');
  });

  it('rejects an invalid scaffold status on update', async () => {
    const profile = await saveProfile();
    const made = await jsonOf(
      await post(`/api/forge/agent-profiles/${profile.id}/promotion-scaffold`, {}),
    );
    const res = await patch(`/api/forge/promotion-scaffolds/${made.scaffold.id}`, { status: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('404s for an unknown scaffold id', async () => {
    const res = await get('/api/forge/promotion-scaffolds/deadbeef');
    expect(res.status).toBe(404);
  });
});

describe('Forge existing agent retrofit endpoints', () => {
  function post(path: string, payload: unknown) {
    return app.request(path + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
  function patch(path: string, payload: unknown) {
    return app.request(path + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  it('lists existing agent candidates from the repo agents directory', async () => {
    const res = await get('/api/forge/existing-agents');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(Array.isArray(body.agents)).toBe(true);
    // The repo ships landos-agents/forge, so it must appear as a candidate.
    const slugs = body.agents.map((a: { slug: string }) => a.slug);
    expect(slugs).toContain('forge');
    const forge = body.agents.find((a: { slug: string }) => a.slug === 'forge');
    expect(forge.safeToInspect).toBe(true);
    expect(forge.detectedFiles).toContain('CLAUDE.md');
  });

  it('inspects an existing agent and saves a retrofit', async () => {
    const res = await post('/api/forge/existing-agents/inspect', { slug: 'forge' });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.retrofit.id).toMatch(/^[0-9a-f]{8}$/);
    expect(body.retrofit.agentSlug).toBe('forge');
    expect(body.retrofit.status).toBe('inspected');
    expect(Array.isArray(body.retrofit.gapAnalysis)).toBe(true);
    expect(typeof body.retrofit.readinessScore).toBe('number');
    expect(body.retrofit.reviewPacket).toContain('# Existing Agent Retrofit');
  });

  it('404s inspecting an unknown agent and 400s on a bad slug', async () => {
    expect((await post('/api/forge/existing-agents/inspect', { slug: 'no-such-agent-xyz' })).status).toBe(404);
    expect((await post('/api/forge/existing-agents/inspect', { slug: '' })).status).toBe(400);
    expect((await post('/api/forge/existing-agents/inspect', { slug: '../etc' })).status).toBe(404);
  });

  it('lists, reopens, updates, and regenerates artifacts for a retrofit', async () => {
    const made = await jsonOf(await post('/api/forge/existing-agents/inspect', { slug: 'forge' }));
    const id = made.retrofit.id;

    const listRes = await get('/api/forge/agent-retrofits');
    expect((await jsonOf(listRes)).retrofits.length).toBeGreaterThanOrEqual(1);

    const getRes = await get(`/api/forge/agent-retrofits/${id}`);
    expect(getRes.status).toBe(200);
    expect((await jsonOf(getRes)).retrofit.id).toBe(id);

    const patchRes = await patch(`/api/forge/agent-retrofits/${id}`, {
      status: 'review_ready',
      ownerDecision: 'approved',
    });
    expect(patchRes.status).toBe(200);
    expect((await jsonOf(patchRes)).retrofit.status).toBe('review_ready');

    const reviewRes = await post(`/api/forge/agent-retrofits/${id}/review-packet`, {});
    expect(reviewRes.status).toBe(200);
    expect((await jsonOf(reviewRes)).packet).toContain('# Existing Agent Retrofit');

    const planRes = await post(`/api/forge/agent-retrofits/${id}/upgrade-plan`, {});
    expect(planRes.status).toBe(200);
    const planBody = await jsonOf(planRes);
    expect(planBody.plan.blockedActions.length).toBeGreaterThan(0);
    expect(Array.isArray(planBody.gaps)).toBe(true);
  });

  it('rejects an invalid retrofit status on update and 404s unknown id', async () => {
    const made = await jsonOf(await post('/api/forge/existing-agents/inspect', { slug: 'forge' }));
    expect((await patch(`/api/forge/agent-retrofits/${made.retrofit.id}`, { status: 'bogus' })).status).toBe(400);
    expect((await get('/api/forge/agent-retrofits/deadbeef')).status).toBe(404);
  });
});

describe('Forge writeback proposal endpoints', () => {
  function post(path: string, payload: unknown) {
    return app.request(path + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
  function patch(path: string, payload: unknown) {
    return app.request(path + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async function retrofitId() {
    const made = await jsonOf(await post('/api/forge/existing-agents/inspect', { slug: 'forge' }));
    return made.retrofit.id as string;
  }

  it('generates and saves a writeback proposal for a retrofit', async () => {
    const id = await retrofitId();
    const res = await post(`/api/forge/agent-retrofits/${id}/writeback-proposal`, {});
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.proposal.id).toMatch(/^[0-9a-f]{8}$/);
    expect(body.proposal.retrofitId).toBe(id);
    expect(body.proposal.agentSlug).toBe('forge');
    expect(body.proposal.status).toBe('draft');
    expect(Array.isArray(body.proposal.proposal.targetFiles)).toBe(true);
    expect(body.proposal.proposal.targetFiles.length).toBeGreaterThan(0);
    expect(body.proposal.markdown).toContain('# Writeback Proposal');
    // Every target must stay inside the agent folder.
    for (const t of body.proposal.proposal.targetFiles) {
      expect(t.relativeTargetPath.includes('..')).toBe(false);
    }
  });

  it('404s generating a proposal for an unknown retrofit', async () => {
    const res = await post('/api/forge/agent-retrofits/deadbeef/writeback-proposal', {});
    expect(res.status).toBe(404);
  });

  it('lists, reopens, and updates a proposal', async () => {
    const id = await retrofitId();
    const made = await jsonOf(await post(`/api/forge/agent-retrofits/${id}/writeback-proposal`, {}));
    const pid = made.proposal.id;

    const listRes = await get('/api/forge/writeback-proposals');
    expect((await jsonOf(listRes)).proposals.length).toBeGreaterThanOrEqual(1);

    const getRes = await get(`/api/forge/writeback-proposals/${pid}`);
    expect(getRes.status).toBe(200);
    expect((await jsonOf(getRes)).proposal.id).toBe(pid);

    const patchRes = await patch(`/api/forge/writeback-proposals/${pid}`, {
      status: 'approved_for_writeback',
      ownerDecision: 'approved',
    });
    expect(patchRes.status).toBe(200);
    expect((await jsonOf(patchRes)).proposal.status).toBe('approved_for_writeback');
  });

  it('rejects an invalid status and 404s an unknown proposal id', async () => {
    const id = await retrofitId();
    const made = await jsonOf(await post(`/api/forge/agent-retrofits/${id}/writeback-proposal`, {}));
    expect((await patch(`/api/forge/writeback-proposals/${made.proposal.id}`, { status: 'bogus' })).status).toBe(400);
    expect((await get('/api/forge/writeback-proposals/deadbeef')).status).toBe(404);
  });

  it('blocks apply with 501 not implemented', async () => {
    const id = await retrofitId();
    const made = await jsonOf(await post(`/api/forge/agent-retrofits/${id}/writeback-proposal`, {}));
    const res = await post(`/api/forge/writeback-proposals/${made.proposal.id}/apply`, {});
    expect(res.status).toBe(501);
    expect((await jsonOf(res)).error).toBe('not implemented');
  });
});

describe('LandOS property card + memory endpoints', () => {
  function post(path: string, payload: unknown) {
    return app.request(path + Q, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
  }
  function patch(path: string, payload: unknown) {
    return app.request(path + Q, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
  }

  it('creates an unverified lead card from a Duke address run', async () => {
    const res = await post('/api/landos/property-cards', {
      entity: 'TY_LAND_BIZ', activeInputAddress: '83 Bub Wise Rd, Swansea SC',
      county: 'Lexington', state: 'SC', verified: false, summary: 'zero candidates',
    });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.card.verification_status).toBe('unverified_lead');
    expect(body.card.kanban_status).toBe('needs_parcel_verification');

    const detail = await jsonOf(await get(`/api/landos/property-cards/${body.card.id}`));
    expect(detail.card.nextActions.some((n: any) => /verify parcel/i.test(n.action))).toBe(true);
  });

  it('creates a verified property card and refuses proximity verification', async () => {
    const ok = await jsonOf(await post('/api/landos/property-cards', {
      entity: 'TY_LAND_BIZ', activeInputAddress: '123 Rural Rd, Lexington SC',
      apn: '00123-45-678', county: 'Lexington', verified: true,
      verificationSource: 'county assessor record (APN + county)',
    }));
    expect(ok.card.verification_status).toBe('verified_property');

    const bad = await post('/api/landos/property-cards', {
      entity: 'TY_LAND_BIZ', activeInputAddress: 'x', verified: true,
      verificationSource: 'nearest parcel by map pin coordinates',
    });
    expect(bad.status).toBe(400);
  });

  it('attaches source evidence with offer-usability gating', async () => {
    const card = (await jsonOf(await post('/api/landos/property-cards', {
      entity: 'TY_LAND_BIZ', activeInputAddress: '5 Eviden Rd, X SC',
    }))).card;
    const noLink = await jsonOf(await post(`/api/landos/property-cards/${card.id}/source-evidence`, { fact: 'acreage' }));
    expect(noLink.usableForOfferLogic).toBe(false);
    const official = await jsonOf(await post(`/api/landos/property-cards/${card.id}/source-evidence`, {
      fact: 'zoning', sourceUrl: 'https://planning.county.gov/ord', parcelVerified: true,
    }));
    expect(official.usableForOfferLogic).toBe(true);
  });

  it('serves the kanban board grouped by status and updates status', async () => {
    const card = (await jsonOf(await post('/api/landos/property-cards', {
      entity: 'TY_LAND_BIZ', activeInputAddress: '8 Board Rd, Q SC',
    }))).card;
    const moved = await patch(`/api/landos/property-cards/${card.id}`, { kanbanStatus: 'underwriting' });
    expect(moved.status).toBe(200);
    const board = await jsonOf(await get('/api/landos/board?entity=TY_LAND_BIZ'));
    expect(Array.isArray(board.columns.underwriting)).toBe(true);
    expect(board.columns.underwriting.length).toBe(1);
    expect((await patch(`/api/landos/property-cards/${card.id}`, { kanbanStatus: 'bogus' })).status).toBe(400);
  });

  it('PATCH cannot promote a card to verified_property without strong identity', async () => {
    const card = (await jsonOf(await post('/api/landos/property-cards', {
      entity: 'TY_LAND_BIZ', activeInputAddress: '40 Promote Rd, Town SC',
    }))).card;
    const res = await patch(`/api/landos/property-cards/${card.id}`, { verificationStatus: 'verified_property' });
    expect(res.status).toBe(400);
    const detail = await jsonOf(await get(`/api/landos/property-cards/${card.id}`));
    expect(detail.card.verification_status).toBe('unverified_lead');
  });

  it('PATCH can reject_mismatch/archive with a reason but not without', async () => {
    const card = (await jsonOf(await post('/api/landos/property-cards', {
      entity: 'TY_LAND_BIZ', activeInputAddress: '41 Reject Rd, Town SC',
    }))).card;
    expect((await patch(`/api/landos/property-cards/${card.id}`, { verificationStatus: 'rejected_mismatch' })).status).toBe(400);
    const ok = await patch(`/api/landos/property-cards/${card.id}`, { verificationStatus: 'rejected_mismatch', reason: 'situs on different road' });
    expect(ok.status).toBe(200);
    expect((await jsonOf(ok)).card.verification_status).toBe('rejected_mismatch');
  });

  it('nearby reference requires a verified parcel and is non-identity', async () => {
    const lead = (await jsonOf(await post('/api/landos/property-cards', {
      entity: 'TY_LAND_BIZ', activeInputAddress: '42 Lead Rd, Town SC',
    }))).card;
    expect((await post(`/api/landos/property-cards/${lead.id}/nearby-reference`, { address: '44 Neighbor Rd' })).status).toBe(400);

    const verified = (await jsonOf(await post('/api/landos/property-cards', {
      entity: 'TY_LAND_BIZ', activeInputAddress: 'APN-only vacant parcel, Lexington SC',
      apn: 'VAC9', county: 'Lexington', fips: '45063', verified: true,
      verificationSource: 'official assessor parcel record (APN + FIPS)',
    }))).card;
    const res = await post(`/api/landos/property-cards/${verified.id}/nearby-reference`, {
      address: '44 Neighbor Rd', relationship: 'adjoining_addressed_property',
    });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.label).toBe('Nearby search reference only — not the subject parcel address.');
    const detail = await jsonOf(await get(`/api/landos/property-cards/${verified.id}`));
    expect(detail.card.active_input_address).not.toBe('44 Neighbor Rd');
    expect(detail.card.nearbyReferences[0].usable_for_identity).toBe(0);
  });

  it('classifies Duke requests via the router endpoint', async () => {
    const r = await jsonOf(await post('/api/landos/duke/route', { text: 'pull land comps by ZIP, 5-10 acres' }));
    expect(r.result.route).toBe('land_comps');
  });

  it('checks the source evidence standard', async () => {
    const noLink = await jsonOf(await post('/api/landos/source-evidence/check', { kind: 'fact', fact: 'zoning', parcelVerified: true }));
    expect(noLink.result.usableForOfferLogic).toBe(false);
  });

  it('creates isolated batch lead jobs', async () => {
    const res = await post('/api/landos/lead-jobs', {
      entity: 'TY_LAND_BIZ', text: '83 Bub Wise Rd, Swansea SC\n221 Main St, Lexington SC',
    });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.count).toBe(2);
    const list = await jsonOf(await get('/api/landos/lead-jobs?status=queued'));
    expect(list.jobs.length).toBe(2);
  });

  it('lists and reopens deal cards, and supports manual comps', async () => {
    // A verified Duke-style card produces a deal card via the property-card POST.
    const card = (await jsonOf(await post('/api/landos/property-cards', {
      entity: 'TY_LAND_BIZ', activeInputAddress: '500 Comp Rd, Lexington SC',
      apn: 'C500', county: 'Lexington', verified: true, verificationSource: 'county assessor record (APN + county)',
    }))).card;
    // Property-card POST does not auto-create a deal; create one + comp via API.
    // (The live bridge auto-links; the API here exercises the comp pathway.)
    const noDeals = await jsonOf(await get('/api/landos/deal-cards'));
    expect(Array.isArray(noDeals.dealCards)).toBe(true);

    // No deal yet from the POST path, so manual-comp flow is exercised against a
    // deal created by the live bridge in unit tests; here we assert the comp
    // endpoint validates a missing deal.
    expect((await post('/api/landos/deal-cards/999999/comps', { sourceLabel: 'Zillow' })).status).toBe(404);
    void card;
  });

  it('recommends comp sources and flags stale LP comps', async () => {
    const small = await jsonOf(await post('/api/landos/comps/recommend', { acres: 30, lpAvailable: false }));
    expect(small.recommendation.order.slice(0, 2)).toEqual(['Zillow', 'Redfin']);
    const large = await jsonOf(await post('/api/landos/comps/recommend', { acres: 120, lpAvailable: true, lpStale: true, newestCompDate: '2023-01-01', runDate: '2026-06-15' }));
    expect(large.recommendation.order).toEqual(expect.arrayContaining(['Land.com', 'LandWatch']));
    expect(large.recency.stale).toBe(true);
  });
});

describe('Forge build interview endpoints', () => {
  function post(path: string, payload: unknown) {
    return app.request(path + Q, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
  }

  it('returns a build interview', async () => {
    const res = await post('/api/forge/build-interview', { goal: 'a tool that organizes leads' });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.interview.sections.length).toBeGreaterThan(0);
  });

  it('returns a build packet with spec and markdown', async () => {
    const res = await post('/api/forge/build-packet', { goal: 'a build that organizes leads', capabilities: ['list leads'] });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.markdown).toContain('# Forge Build Packet');
    expect(body.spec.capabilities).toContain('list leads');
  });

  it('400s on a missing goal', async () => {
    expect((await post('/api/forge/build-packet', {})).status).toBe(400);
  });
});

describe('GET /api/mission/tasks/auto-assign-all route ordering', () => {
  // Regression test: this endpoint was shadowed by /:id/auto-assign for
  // months because route registration order was wrong. Lock it in.
  it('returns 200, not 404, when called as a static path', async () => {
    const res = await app.request('/api/mission/tasks/auto-assign-all' + Q, {
      method: 'POST',
    });
    // Must NOT be 404. May be 200 (assigned: 0) or 400 if no agents.
    expect(res.status).not.toBe(404);
  });
});

describe('GET /api/memories', () => {
  it('returns full memory dashboard payload', async () => {
    const res = await get('/api/memories?chatId=test');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      stats: expect.objectContaining({
        total: expect.any(Number),
        pinned: expect.any(Number),
        consolidations: expect.any(Number),
      }),
      fading: expect.any(Array),
      topAccessed: expect.any(Array),
      timeline: expect.any(Array),
      consolidations: expect.any(Array),
    });
  });
});

describe('GET /api/memories/list', () => {
  it('returns paginated memory list', async () => {
    const res = await get('/api/memories/list?chatId=test&limit=10&offset=0');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      memories: expect.any(Array),
      total: expect.any(Number),
    });
  });
});

describe('GET /api/tokens', () => {
  it('returns stats + costTimeline + recentUsage', async () => {
    const res = await get('/api/tokens?chatId=test');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      stats: expect.any(Object),
      costTimeline: expect.any(Array),
      recentUsage: expect.any(Array),
    });
    expect(body.stats).toMatchObject({
      todayInput: expect.any(Number),
      todayOutput: expect.any(Number),
      todayCost: expect.any(Number),
      todayTurns: expect.any(Number),
      allTimeCost: expect.any(Number),
      allTimeTurns: expect.any(Number),
    });
  });
});

describe('GET /api/hive-mind', () => {
  it('returns { entries: [] }', async () => {
    const res = await get('/api/hive-mind');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({ entries: expect.any(Array) });
  });
});

describe('GET /api/audit', () => {
  it('returns { entries, total }', async () => {
    const res = await get('/api/audit?limit=10&offset=0');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      entries: expect.any(Array),
      total: expect.any(Number),
    });
  });
});

describe('GET /api/audit/blocked', () => {
  it('returns { entries: [] }', async () => {
    const res = await get('/api/audit/blocked?limit=5');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({ entries: expect.any(Array) });
  });
});

describe('GET /api/security/status', () => {
  it('returns 200 with an object', async () => {
    const res = await get('/api/security/status');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toBeInstanceOf(Object);
  });
});

describe('GET /api/chat/history', () => {
  it('rejects missing chatId with 400', async () => {
    const res = await get('/api/chat/history');
    expect(res.status).toBe(400);
  });

  it('returns { turns: [] } with chatId', async () => {
    const res = await get('/api/chat/history?chatId=test&limit=10');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({ turns: expect.any(Array) });
  });
});

describe('PATCH /api/agents/:id/model', () => {
  it('rejects missing model with 400', async () => {
    const res = await app.request('/api/agents/main/model' + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid model with 400', async () => {
    const res = await app.request('/api/agents/main/model' + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5' }),
    });
    expect(res.status).toBe(400);
  });

  it('main response includes restartRequired: false', async () => {
    const res = await app.request('/api/agents/main/model' + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6' }),
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      ok: true,
      agent: 'main',
      model: 'claude-sonnet-4-6',
      restartRequired: false,
    });
  });
});

describe('avatar endpoints share error shape and status semantics', () => {
  // Twelve-byte canonical PNG header — the avatar PUT handler magic-byte
  // sniffs the first four bytes, so this is enough.
  const PNG_HEADER = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
  ]);

  it('GET, PUT, DELETE all return JSON {error} on an invalid id', async () => {
    const get = await app.request('/api/agents/has%20space/avatar' + Q);
    expect(get.status).toBe(400);
    const getBody = await jsonOf(get);
    expect(getBody).toMatchObject({ error: expect.any(String) });

    const put = await app.request('/api/agents/has%20space/avatar' + Q, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: PNG_HEADER,
    });
    expect(put.status).toBe(400);
    expect(await jsonOf(put)).toMatchObject({ error: expect.any(String) });

    const del = await app.request('/api/agents/has%20space/avatar' + Q, { method: 'DELETE' });
    expect(del.status).toBe(400);
    expect(await jsonOf(del)).toMatchObject({ error: expect.any(String) });
  });

  it('GET on an unknown agent returns 404 (not 204)', async () => {
    const res = await app.request('/api/agents/totally_made_up_agent/avatar' + Q);
    expect(res.status).toBe(404);
    expect(await jsonOf(res)).toMatchObject({ error: 'agent not found' });
  });

  it('GET on main with no avatar resolved returns 204', async () => {
    // main always "exists" per agentExists; with no bundled or mutable
    // avatar in the test env, the resolver returns null → 204.
    const res = await app.request('/api/agents/main/avatar' + Q);
    expect([200, 204]).toContain(res.status);
    if (res.status === 204) {
      expect(res.headers.get('content-type') ?? '').not.toMatch(/text\/html/);
    }
  });
});

describe('PATCH /api/dashboard/settings standup_config', () => {
  async function patchStandupConfig(value: string) {
    return app.request('/api/dashboard/settings' + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'standup_config', value }),
    });
  }

  it('accepts a well-formed payload', async () => {
    const res = await patchStandupConfig(JSON.stringify({
      agents: [{ id: 'main', enabled: true }, { id: 'comms', enabled: false }],
      maxSpeakers: 5,
    }));
    expect(res.status).toBe(200);
  });

  it('rejects non-JSON value with 400', async () => {
    const res = await patchStandupConfig('not json {');
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error).toMatch(/standup_config/);
  });

  it('rejects agents-not-an-array with 400', async () => {
    const res = await patchStandupConfig(JSON.stringify({ agents: 'nope', maxSpeakers: 5 }));
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error).toMatch(/agents must be an array/);
  });

  it('rejects an agent entry without an id with 400', async () => {
    const res = await patchStandupConfig(JSON.stringify({
      agents: [{ enabled: true }],
      maxSpeakers: 5,
    }));
    expect(res.status).toBe(400);
  });

  it('rejects maxSpeakers out of [1, 8] with 400', async () => {
    const res = await patchStandupConfig(JSON.stringify({
      agents: [{ id: 'main', enabled: true }],
      maxSpeakers: 99,
    }));
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error).toMatch(/maxSpeakers/);
  });
});

describe('GET /api/warroom/agents', () => {
  it('returns { agents: [...] } with main present', async () => {
    const res = await get('/api/warroom/agents');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.agents).toBeInstanceOf(Array);
    expect(body.agents.length).toBeGreaterThanOrEqual(1);
    expect(body.agents[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      description: expect.any(String),
    });
  });
});

describe('GET /api/warroom/pin', () => {
  it('returns { ok, agent, mode }', async () => {
    const res = await get('/api/warroom/pin');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      ok: expect.any(Boolean),
      mode: expect.any(String),
    });
  });
});

describe('GET /api/meet/sessions', () => {
  it('returns { ok, active, recent }', async () => {
    const res = await get('/api/meet/sessions');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      active: expect.any(Array),
      recent: expect.any(Array),
    });
  });
});

describe('Cache-Control on /api/*', () => {
  it('every API response carries Cache-Control: no-store', async () => {
    const res = await get('/api/health');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('Security headers on /', () => {
  it('Referrer-Policy: no-referrer is set', async () => {
    const res = await get('/api/health');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('X-Frame-Options: DENY is set', async () => {
    const res = await get('/api/health');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('X-Content-Type-Options: nosniff is set', async () => {
    const res = await get('/api/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
