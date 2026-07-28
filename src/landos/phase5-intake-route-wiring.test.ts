// Phase 5 regression: the intake route's auto-launch WIRING.
//
// The behavioral contract of the launcher itself (one mission per lead,
// duplicate idempotency, lifecycle updates) lives in
// phase5-intake-autolaunch.test.ts against the real helper. This file pins the
// routing decision in POST /api/landos/leads/manual: an operating profile
// outside the vitest env auto-launches the Deal Intelligence mission for the
// created Deal Card, while the test/QA env keeps the Phase-1 research path.
// The launcher is mocked so no real mission (and no real capability work) ever
// runs from this file — a fire-and-forget mission with real capabilities would
// outlive the per-test DB reset and contaminate sibling tests.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Hono } from 'hono';

import { autoLaunchDealIntelligenceForIntake } from './deal-intelligence-intake.js';

vi.mock('./deal-intelligence-intake.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./deal-intelligence-intake.js')>();
  return {
    ...actual,
    autoLaunchDealIntelligenceForIntake: vi.fn(() => ({
      runId: 'di_wiring_test',
      missionId: 'di_wiring_test',
      dealCardId: 0,
      sequence: 1,
      childCount: 10,
      alreadyRunning: false,
    })),
  };
});

import { buildDashboardApp } from '../dashboard.js';
import { _initTestDatabase } from '../db.js';
import { _initTestLandosDb } from './db.js';

const TOKEN = 'test-contract-token';
const launcher = vi.mocked(autoLaunchDealIntelligenceForIntake);

let app: Hono;
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  app = buildDashboardApp(undefined) as unknown as Hono;
  _initTestDatabase();
  _initTestLandosDb();
  launcher.mockClear();
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

async function postLead(body: Record<string, unknown>) {
  return app.request(`/api/landos/leads/manual?token=${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/landos/leads/manual auto-launch wiring', () => {
  it('operating env: a saved lead launches ONE Deal Intelligence mission for its Deal Card', async () => {
    process.env.NODE_ENV = 'production';
    const res = await postLead({ sellerName: 'Wiring Test Seller', address: '1 Wiring Way', state: 'TN' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { dealCardId: number; opportunityId: number };

    expect(launcher).toHaveBeenCalledTimes(1);
    const input = launcher.mock.calls[0]![0];
    expect(input.dealCardId).toBe(body.dealCardId);
    expect(input.opportunityId).toBe(body.opportunityId);
    expect(input.capabilities).toBeTruthy();
    expect(typeof input.browserCleanup).toBe('function');
  });

  it('operating env: the 201 does not depend on the launcher succeeding', async () => {
    process.env.NODE_ENV = 'production';
    launcher.mockReturnValueOnce(null);
    const res = await postLead({ sellerName: 'Wiring Failure Seller', address: '2 Wiring Way', state: 'TN' });
    expect(res.status).toBe(201);
    expect(launcher).toHaveBeenCalledTimes(1);
  });

  it('vitest env: intake keeps the Phase-1 research path and never auto-launches', async () => {
    const res = await postLead({ sellerName: 'Test Env Seller', address: '3 Wiring Way', state: 'TN' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { researchStatus: string };
    expect(body.researchStatus).toBe('queued');
    expect(launcher).not.toHaveBeenCalled();
  });
});
