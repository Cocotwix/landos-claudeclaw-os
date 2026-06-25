import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { Hono } from 'hono';
import { _initTestDatabase } from '../db.js';
import { buildDashboardApp } from '../dashboard.js';
import { _initTestLandosDb } from './db.js';

const TOKEN = 'test-contract-token';
let app: Hono;
beforeAll(() => { app = buildDashboardApp(undefined) as unknown as Hono; });
beforeEach(() => { _initTestDatabase(); _initTestLandosDb(); });

describe('GET /api/landos/model-router/capabilities', () => {
  it('exposes capability dimensions + per-model profiles (no secrets)', async () => {
    const res = await app.request('/api/landos/model-router/capabilities?token=' + TOKEN);
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(b.dimensions).toContain('reasoning');
    expect(b.models.map((m: any) => m.modelId)).toContain('claude');
    expect(JSON.stringify(b)).not.toMatch(/API_KEY|Bearer |token=/i);
  });
});

describe('POST /api/landos/model-router/preview', () => {
  it('returns a deterministic high-stakes -> Claude decision (no model call)', async () => {
    const res = await app.request('/api/landos/model-router/preview?token=' + TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ needs: { reasoning: 0.8 }, stakes: 'high' }),
    });
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(b.decision.chosenModelId).toBe('claude');
    expect(b.decision.escalated).toBe(true);
  });

  it('previews local preference for low-stakes summarization', async () => {
    const res = await app.request('/api/landos/model-router/preview?token=' + TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ needs: { summarization: 0.7 }, stakes: 'low', estimatedConfidence: 0.9 }),
    });
    const b = (await res.json()) as any;
    expect(b.decision.chosenModelId).toMatch(/^gemma/);
    expect(b.decision.openSourcePreferred).toBe(true);
  });

  it('honors an unavailable override without substituting', async () => {
    const res = await app.request('/api/landos/model-router/preview?token=' + TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ needs: { summarization: 0.5 }, operatorOverrideModelId: 'gpt', availableModelIds: ['claude'] }),
    });
    const b = (await res.json()) as any;
    expect(b.decision.chosenModelId).toBe('gpt');
    expect(b.decision.available).toBe(false);
    expect(b.decision.unavailableSelected).toBe('gpt');
  });
});
