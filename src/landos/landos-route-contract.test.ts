// Regression: the LandOS dashboard API contract must be served by the SAME app
// the live server boots (buildDashboardApp -> startDashboard). These four GETs
// are what Command / Acquire / Cost Control call on load; a stale or unmounted
// backend returns the catch-all 404 for them. This test fails loud if any of the
// four ever stops being served (i.e. regresses to 404) from the real app path.
//
// NOTE: a 404 here means a code/mounting regression. A 404 in the LIVE dashboard
// while this test passes means the running process is STALE — rebuild + restart.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { Hono } from 'hono';

import { _initTestDatabase } from '../db.js';
import { buildDashboardApp } from '../dashboard.js';
import { _initTestLandosDb } from './db.js';

const TOKEN = 'test-contract-token';

const CONTRACT_PATHS = [
  '/api/landos/structure',
  '/api/landos/models',
  '/api/landos/models?entity=TY_LAND_BIZ',
  '/api/landos/cost-board',
] as const;

let app: Hono;

beforeAll(() => {
  app = buildDashboardApp(undefined) as unknown as Hono;
});

beforeEach(() => {
  _initTestDatabase();
  _initTestLandosDb();
});

function withToken(path: string): string {
  return path + (path.includes('?') ? '&' : '?') + 'token=' + TOKEN;
}

describe('LandOS dashboard API route contract (Command / Acquire / Cost Control)', () => {
  it('every contract endpoint is SERVED (never the catch-all 404) from the live app', async () => {
    for (const path of CONTRACT_PATHS) {
      const res = await app.request(withToken(path));
      expect(res.status, `${path} must not 404`).not.toBe(404);
      expect(res.status, `${path} should be 200`).toBe(200);
    }
  });

  it('an unknown /api/landos path still 404s (proves the catch-all is the 404 source)', async () => {
    const res = await app.request(withToken('/api/landos/definitely-not-a-route'));
    expect(res.status).toBe(404);
  });

  it('contract endpoints are token-gated (401 without a token, not 404)', async () => {
    for (const path of CONTRACT_PATHS) {
      const bare = path.split('?')[0];
      const res = await app.request(bare);
      expect(res.status, `${bare} should be 401 without a token`).toBe(401);
    }
  });
});
