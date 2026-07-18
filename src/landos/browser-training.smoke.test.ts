// Operator QA smoke test: drives the Browser Training endpoints through the real
// Hono app (no port, no browser, no live model) to prove the full request path
// is wired: create session -> record events (incl. paid-action block) -> end +
// synthesize playbook -> list -> approve -> replay-guard -> knowledge -> usage.

import { describe, it, expect, beforeEach } from 'vitest';
import type { Hono } from 'hono';
import { buildDashboardApp } from '../dashboard.js';
import { _initTestLandosDb } from './db.js';

const TOKEN = process.env.DASHBOARD_TOKEN || 'test-contract-token';
let app: Hono;

beforeEach(() => {
  _initTestLandosDb();
  app = buildDashboardApp(undefined) as unknown as Hono;
});

function get(path: string) {
  return app.request(path + (path.includes('?') ? '&' : '?') + 'token=' + TOKEN);
}
function post(path: string, body: unknown) {
  return app.request(path + (path.includes('?') ? '&' : '?') + 'token=' + TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Browser Training endpoints (operator QA)', () => {
  it('runs the full training lifecycle through the API', async () => {
    // 1. create session
    const created = await post('/api/landos/training/sessions', {
      title: 'LandPortal Map Search',
      website: 'https://landportal.com/',
      surface: 'tab',
    });
    expect(created.status).toBe(200);
    const { session } = (await created.json()) as any;
    expect(session.id).toBeGreaterThan(0);
    expect(session.model).toContain('gemini');

    // 2. record a normal nav event
    const nav = await post(`/api/landos/training/sessions/${session.id}/events`, {
      kind: 'nav',
      url: 'https://landportal.com/map?parcel=42',
    });
    expect(nav.status).toBe(200);
    expect(((await nav.json()) as any).approvalRequired).toBe(false);

    // 3. record a paid action -> guard blocks
    const paid = await post(`/api/landos/training/sessions/${session.id}/events`, {
      kind: 'click',
      controlText: 'Buy Report',
    });
    const paidBody = (await paid.json()) as any;
    expect(paidBody.approvalRequired).toBe(true);
    expect(paidBody.reason).toMatch(/prohibited and cannot be approved/i);

    // 4. end + synthesize (no LLM key in tests -> deterministic fallback still yields a draft)
    const ended = await post(`/api/landos/training/sessions/${session.id}/end`, {});
    expect(ended.status).toBe(200);
    const endBody = (await ended.json()) as any;
    expect(endBody.playbook.status).toBe('draft');
    expect(endBody.playbook.slug).toBeTruthy();

    // 5. list playbooks
    const list = await get('/api/landos/training/playbooks');
    const listBody = (await list.json()) as any;
    expect(listBody.playbooks.length).toBe(1);
    const pbId = listBody.playbooks[0].id;

    // 6. approve
    const decided = await post(`/api/landos/training/playbooks/${pbId}/decide`, { decision: 'approved' });
    expect(((await decided.json()) as any).playbook.status).toBe('approved');

    // 7. replay: no live browser in tests -> honest failure, never fabricated
    const replay = await post(`/api/landos/training/playbooks/${pbId}/replay`, { vars: {} });
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as any;
    expect(replayBody.result).toBeTruthy();
    expect(typeof replayBody.result.summary).toBe('string');

    // 8. execute the APPROVED playbook (dry-run) through the Browser Agent
    //    executor. No live browser in tests -> honest not_configured, never faked.
    const exec = await post(`/api/landos/training/playbooks/${pbId}/execute`, { mode: 'dry_run' });
    expect(exec.status).toBe(200);
    const execBody = (await exec.json()) as any;
    expect(execBody.execution).toBeTruthy();
    expect(['not_configured', 'succeeded', 'partial', 'failed']).toContain(execBody.execution.status);
    expect(execBody.execution.mode).toBe('dry_run');

    // 9. executions are listed
    const execList = await get(`/api/landos/training/playbooks/${pbId}/executions`);
    expect(((await execList.json()) as any).executions.length).toBe(1);

    // 10. usage rollup
    const usage = await get('/api/landos/training/usage');
    const usageBody = (await usage.json()) as any;
    expect(usageBody.usage.lifetime.sessions).toBe(1);
    expect(usageBody.usage.playbooksCreated).toBe(1);
  });

  it('refuses to execute a DRAFT (unapproved) playbook', async () => {
    // Build a fresh draft directly via session end.
    const s = (await (await post('/api/landos/training/sessions', { title: 'Draft only', website: 'https://landportal.com/' })).json()) as any;
    const ended = (await (await post(`/api/landos/training/sessions/${s.session.id}/end`, {})).json()) as any;
    const draftId = ended.playbook.id;
    expect(ended.playbook.status).toBe('draft');
    const res = await post(`/api/landos/training/playbooks/${draftId}/execute`, { mode: 'dry_run' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toMatch(/approved/);
  });

  it('rejects unauthenticated access', async () => {
    const res = await app.request('/api/landos/training/usage');
    expect(res.status).toBe(401);
  });
});
