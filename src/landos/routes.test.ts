// Contract tests for the LandOS OS Spine v1 dashboard API. Same pattern as
// src/dashboard.contract.test.ts: Hono app.request(), no real port, token
// auth from src/test-env-setup.ts, in-memory DBs.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { Hono } from 'hono';

import { _initTestDatabase } from '../db.js';
import { buildDashboardApp } from '../dashboard.js';
import { _initTestLandosDb, getLandosDb } from './db.js';

const TOKEN = 'test-contract-token';

let app: Hono;

beforeAll(() => {
  app = buildDashboardApp(undefined) as unknown as Hono;
});

beforeEach(() => {
  _initTestDatabase();
  _initTestLandosDb();
});

async function get(path: string) {
  return app.request(path + (path.includes('?') ? '&' : '?') + 'token=' + TOKEN);
}

async function post(path: string, body?: unknown) {
  return app.request(path + (path.includes('?') ? '&' : '?') + 'token=' + TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('LandOS routes — auth', () => {
  it('rejects /api/landos/overview without a token', async () => {
    const res = await app.request('/api/landos/overview');
    expect(res.status).toBe(401);
  });
});

describe('LandOS routes — overview and registries', () => {
  it('returns overview with counts, departments, and pending approvals', async () => {
    const res = await get('/api/landos/overview');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.counts).toBeTypeOf('object');
    expect(body.counts.lead).toBe(0);
    expect(Array.isArray(body.departments)).toBe(true);
    expect(body.departments.length).toBeGreaterThanOrEqual(8);
    expect(Array.isArray(body.pendingApprovalList)).toBe(true);
  });

  it('lists both business entities', async () => {
    const res = await get('/api/landos/entities');
    const body = (await res.json()) as any;
    expect(body.entities.map((e: any) => e.id)).toEqual(['LAND_ALLY', 'TY_LAND_BIZ']);
  });

  it('serves the rubric config from Duke Section 7', async () => {
    const res = await get('/api/landos/rubric');
    const body = (await res.json()) as any;
    expect(body.status).toBe('approved');
    expect(body.factors).toHaveLength(6);
    expect(body.factors.reduce((s: number, f: any) => s + f.maxPoints, 0)).toBe(100);
  });

  it('serves the strategy registry', async () => {
    const res = await get('/api/landos/strategies');
    const body = (await res.json()) as any;
    expect(body.strategies.length).toBe(13);
  });
});

describe('LandOS routes — entity filter', () => {
  it('filters leads by entity', async () => {
    const db = getLandosDb();
    db.prepare(`INSERT INTO landos_lead (entity, source) VALUES ('LAND_ALLY', 'web')`).run();
    db.prepare(`INSERT INTO landos_lead (entity, source) VALUES ('TY_LAND_BIZ', 'mail')`).run();

    const all = (await (await get('/api/landos/leads')).json()) as any;
    expect(all.leads).toHaveLength(2);

    const la = (await (await get('/api/landos/leads?entity=LAND_ALLY')).json()) as any;
    expect(la.leads).toHaveLength(1);
    expect(la.leads[0].entity).toBe('LAND_ALLY');

    const ty = (await (await get('/api/landos/leads?entity=TY_LAND_BIZ')).json()) as any;
    expect(ty.leads).toHaveLength(1);
    expect(ty.leads[0].entity).toBe('TY_LAND_BIZ');
  });
});

describe('LandOS routes — approval workflow', () => {
  it('creates, lists, and approves a gated-action request', async () => {
    const created = (await (await post('/api/landos/approvals', {
      actionType: 'paid_credit',
      title: 'Use 1 LandPortal comp credit for test parcel',
      requestedBy: 'duke-due-diligence',
    })).json()) as any;
    expect(created.id).toBeTypeOf('number');
    expect(created.status).toBe('pending');

    const pending = (await (await get('/api/landos/approvals?status=pending')).json()) as any;
    expect(pending.approvals).toHaveLength(1);

    const approved = (await (await post(`/api/landos/approvals/${created.id}/approve`, { decidedBy: 'tyler' })).json()) as any;
    expect(approved.approval.status).toBe('approved');

    // Decision is final: a second decision 404s.
    const again = await post(`/api/landos/approvals/${created.id}/reject`, {});
    expect(again.status).toBe(404);

    // Audit trail captured request + decision.
    const audit = (await (await get('/api/landos/audit')).json()) as any;
    const actions = audit.audit.map((a: any) => a.action);
    expect(actions).toContain('approval_requested');
    expect(actions).toContain('approval_approved');
  });

  it('rejects approval creation without required fields', async () => {
    const res = await post('/api/landos/approvals', { title: 'no action type' });
    expect(res.status).toBe(400);
  });
});

describe('LandOS routes — rules, playbooks, research', () => {
  it('creates rules as draft only', async () => {
    const created = (await (await post('/api/landos/rules', {
      name: 'Minimum net profit baseline',
      body: 'Global minimum net profit is $10,000.',
      scope: 'global',
    })).json()) as any;
    expect(created.status).toBe('draft');

    const rules = (await (await get('/api/landos/rules')).json()) as any;
    expect(rules.rules[0].status).toBe('draft');
  });

  it('creates playbooks at raw_training by default and exposes the lifecycle', async () => {
    const created = (await (await post('/api/landos/playbooks', { name: 'Seller call openings' })).json()) as any;
    expect(created.stage).toBe('raw_training');

    const list = (await (await get('/api/landos/playbooks')).json()) as any;
    expect(list.lifecycle[0]).toBe('raw_training');
    expect(list.lifecycle[list.lifecycle.length - 1]).toBe('agent_instruction_update');
  });

  it('creates and filters research items by kind', async () => {
    await post('/api/landos/research', { kind: 'market', title: 'County absorption check' });
    await post('/api/landos/research', { kind: 'ai_change', title: 'New model release' });

    const market = (await (await get('/api/landos/research?kind=market')).json()) as any;
    expect(market.research).toHaveLength(1);
    expect(market.research[0].kind).toBe('market');

    const bad = await post('/api/landos/research', { kind: 'gossip', title: 'nope' });
    expect(bad.status).toBe(400);
  });
});

describe('LandOS routes — intake orchestrator auth', () => {
  const INTAKE_BODY = { transport: 'manual_api', text: 'APN: 051-012-05, Colleton County, SC' };

  it('accepts POST /api/landos/intake with the ?token= query param (same mechanism as other dashboard routes)', async () => {
    const res = await post('/api/landos/intake', INTAKE_BODY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.plan).toBeTypeOf('object');
    expect(body.plan.classification.classification).toBe('parcel_level');
  });

  it('rejects POST /api/landos/intake without a token', async () => {
    const res = await app.request('/api/landos/intake', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(INTAKE_BODY),
    });
    expect(res.status).toBe(401);
  });

  it('rejects POST /api/landos/intake when the token is sent as a header instead of the query param', async () => {
    // Reproduces the 401 seen from the browser console: the dashboard auth
    // middleware reads c.req.query('token') only — Authorization/x-dashboard-token
    // headers are ignored. The fix is to send ?token=, not a header.
    const res = await app.request('/api/landos/intake', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        'x-dashboard-token': TOKEN,
      },
      body: JSON.stringify(INTAKE_BODY),
    });
    expect(res.status).toBe(401);
  });

  it('gates /api/landos/intake identically to an existing dashboard route', async () => {
    // Same auth behavior as a known-good route: no token -> 401 for both.
    const intakeNoToken = await app.request('/api/landos/intake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(INTAKE_BODY) });
    const overviewNoToken = await app.request('/api/landos/overview');
    expect(intakeNoToken.status).toBe(overviewNoToken.status);
    expect(intakeNoToken.status).toBe(401);
  });
});

describe('LandOS routes — Duke execution bridge auth + safety', () => {
  // Use non-identity text so the route takes the preflight "skip" path and makes
  // NO live LandPortal call (verification never starts without an identifier).
  const NO_IDENTITY = { text: 'what should we do with this?' };

  it('rejects POST /api/landos/intake/duke-verification without a token', async () => {
    const res = await app.request('/api/landos/intake/duke-verification', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(NO_IDENTITY),
    });
    expect(res.status).toBe(401);
  });

  it('accepts the route with ?token= and returns a read-only verification result', async () => {
    const res = await post('/api/landos/intake/duke-verification', NO_IDENTITY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.verification.executionMode).toBe('duke_verification_read_only');
    expect(body.verification.parcelVerified).toBe(false);
    expect(body.verification.strategyUnderwritingBlocked).toBe(true);
    expect(body.dealCardUpdatePlan.persistedNow).toBe(false);
  });

  it('returns the FULL contract shape the UI renders (regression: endpoint wired + shaped)', async () => {
    // If this route is missing/misshaped, the dashboard button appears to do
    // nothing. Assert both top-level objects and the arrays the UI maps over.
    const res = await post('/api/landos/intake/duke-verification', NO_IDENTITY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.verification).toBeTypeOf('object');
    expect(body.verification.status).toBeTypeOf('string');
    expect(Array.isArray(body.verification.sourceAttempts)).toBe(true);
    expect(Array.isArray(body.verification.dataGaps)).toBe(true);
    expect(body.dealCardUpdatePlan).toBeTypeOf('object');
    expect(body.dealCardUpdatePlan.matchStatus).toBeTypeOf('string');
    expect(Array.isArray(body.dealCardUpdatePlan.timeline)).toBe(true);
  });

  it('a coordinate-pair input is never verified (no coordinate parcel identity)', async () => {
    const res = await post('/api/landos/intake/duke-verification', { text: '34.0522, -118.2437' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.verification.parcelVerified).toBe(false);
    expect(body.verification.identity).toBeUndefined();
  });

  it('requires text', async () => {
    const res = await post('/api/landos/intake/duke-verification', {});
    expect(res.status).toBe(400);
  });
});

describe('LandOS routes — offer scenarios', () => {
  it('evaluates strategies and labels DRAFT output', async () => {
    const res = await post('/api/landos/strategies/evaluate', { expectedValueUsd: 100000 });
    const body = (await res.json()) as any;
    const flip = body.scenarios.find((s: any) => s.strategy === 'quick_flip');
    expect(flip.offerLowUsd).toBe(40000);
    expect(flip.offerHighUsd).toBe(60000);
    expect(flip.outputLabel).toBe('CONFIRMED PARAMETERS');

    const landHome = body.scenarios.find((s: any) => s.strategy === 'land_home_package');
    expect(landHome.feasible).toBe(false);

    const wholesale = body.scenarios.find((s: any) => s.strategy === 'wholesale_assignment');
    expect(wholesale.outputLabel).toBe('DRAFT (UNCONFIRMED PARAMETERS)');
  });

  it('rejects a non-positive EV', async () => {
    const res = await post('/api/landos/strategies/evaluate', { expectedValueUsd: -5 });
    expect(res.status).toBe(400);
  });
});
