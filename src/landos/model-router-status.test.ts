import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { Hono } from 'hono';
import { _initTestDatabase } from '../db.js';
import { buildDashboardApp } from '../dashboard.js';
import { _initTestLandosDb } from './db.js';

const TOKEN = 'test-contract-token';
let app: Hono;
beforeAll(() => { app = buildDashboardApp(undefined) as unknown as Hono; });
beforeEach(() => { _initTestDatabase(); _initTestLandosDb(); });

const post = (path: string, body: unknown) =>
  app.request(path + '?token=' + TOKEN, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('GET /api/landos/model-router/status', () => {
  it('reports safe-mode flag + provider presence (booleans, no secrets) + environments', async () => {
    const res = await app.request('/api/landos/model-router/status?token=' + TOKEN);
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(typeof b.liveRouting).toBe('boolean');
    expect(b.safeMode).toBe(!b.liveRouting);
    expect(b.highStakesDefault).toBe('claude');
    expect(b.providerPresence.claude).toBe(true);
    expect(Array.isArray(b.environments)).toBe(true);
    // no secret values leak
    expect(JSON.stringify(b)).not.toMatch(/sk-|API_KEY=|Bearer /i);
  });
});

describe('manual override controls (persistent)', () => {
  it('sets, resolves by precedence, and resets overrides', async () => {
    expect((await post('/api/landos/model-router/override', { scope: 'global', modelId: 'claude' })).status).toBe(200);
    expect((await post('/api/landos/model-router/override', { scope: 'task_type', key: 'summarization', modelId: 'gemma-4-e4b' })).status).toBe(200);

    const t = await (await app.request('/api/landos/model-router/override?token=' + TOKEN + '&taskType=summarization')).json() as any;
    expect(t.override.scope).toBe('task_type');
    expect(t.override.modelId).toBe('gemma-4-e4b');

    const g = await (await app.request('/api/landos/model-router/override?token=' + TOKEN)).json() as any;
    expect(g.override.modelId).toBe('claude');

    await post('/api/landos/model-router/override/reset', { scope: 'task_type', key: 'summarization' });
    const after = await (await app.request('/api/landos/model-router/override?token=' + TOKEN + '&taskType=summarization')).json() as any;
    expect(after.override.modelId).toBe('claude'); // falls back to global
  });

  it('rejects an unknown modelId', async () => {
    const res = await post('/api/landos/model-router/override', { scope: 'global', modelId: 'not-a-model' });
    expect(res.status).toBe(400);
  });
});
