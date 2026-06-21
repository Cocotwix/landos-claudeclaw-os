// Focused tests for the dashboard-safe Live Comps readiness status.
//
// Proves the status is BOOLEANS-only and never leaks a secret value, actor slug,
// env key name, reason string, or missing array — and that hitting the route
// makes NO provider call and incurs NO spend.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { Hono } from 'hono';

import { _initTestDatabase } from '../db.js';
import { buildDashboardApp } from '../dashboard.js';
import { _initTestLandosDb, getLandosDb } from './db.js';
import { liveCompsReadinessStatus } from './routes.js';
import { LIVE_DATA_ENV_KEYS, type LiveDataPreflight } from './live-data-preflight.js';

const TOKEN = 'test-contract-token';
const K = LIVE_DATA_ENV_KEYS;

const EXPECTED_KEYS = [
  'liveCompsEnabled',
  'apifyTokenPresent',
  'redfinSearchActorPresent',
  'redfinDetailActorPresent',
  'redfinCompsReady',
  'providerCallsMade',
  'spendUsd',
].sort();

/** Synthetic preflight (no env, no provider). missing = exact key names. */
function pf(missing: string[], ready: boolean): LiveDataPreflight {
  return {
    comps: { capability: 'comps', ready, missing, reason: 'redacted-in-test', usesStub: !ready },
    imagery: { capability: 'imagery', ready: false, missing: [], reason: '', usesStub: true },
    gemma: { reachable: false, modelPresent: false, model: 'm', host: 'h', mode: 'deterministic_only', reason: '' },
    allEnabledReady: ready,
  };
}

describe('liveCompsReadinessStatus — booleans only, derived from missing-key membership', () => {
  it('fully configured -> all true, ready, zero calls/spend', () => {
    const s = liveCompsReadinessStatus(pf([], true));
    expect(s).toEqual({
      liveCompsEnabled: true,
      apifyTokenPresent: true,
      redfinSearchActorPresent: true,
      redfinDetailActorPresent: true,
      redfinCompsReady: true,
      providerCallsMade: 0,
      spendUsd: 0,
    });
  });

  it('missing token -> only apifyTokenPresent is false', () => {
    const s = liveCompsReadinessStatus(pf([K.apifyToken], false));
    expect(s.apifyTokenPresent).toBe(false);
    expect(s.redfinSearchActorPresent).toBe(true);
    expect(s.redfinDetailActorPresent).toBe(true);
    expect(s.liveCompsEnabled).toBe(true);
    expect(s.redfinCompsReady).toBe(false);
  });

  it('missing search actor -> only redfinSearchActorPresent is false', () => {
    const s = liveCompsReadinessStatus(pf([K.apifyRedfinSearchActor], false));
    expect(s.redfinSearchActorPresent).toBe(false);
    expect(s.apifyTokenPresent).toBe(true);
    expect(s.redfinDetailActorPresent).toBe(true);
  });

  it('missing detail actor -> only redfinDetailActorPresent is false', () => {
    const s = liveCompsReadinessStatus(pf([K.apifyRedfinDetailActor], false));
    expect(s.redfinDetailActorPresent).toBe(false);
    expect(s.apifyTokenPresent).toBe(true);
    expect(s.redfinSearchActorPresent).toBe(true);
  });

  it('flag-off missing entry (suffixed) -> liveCompsEnabled false', () => {
    const s = liveCompsReadinessStatus(pf([`${K.liveComps} (set to 1 to enable)`], false));
    expect(s.liveCompsEnabled).toBe(false);
  });

  it('returns EXACTLY the seven status fields (no reason, no missing, no extras)', () => {
    const s = liveCompsReadinessStatus(pf([K.apifyToken], false));
    expect(Object.keys(s).sort()).toEqual(EXPECTED_KEYS);
  });

  it('serialized output contains NO secret/config literals (key names, slugs, flags)', () => {
    // Even with everything missing, the payload is booleans + zeros only.
    const s = liveCompsReadinessStatus(
      pf([`${K.liveComps} (set to 1 to enable)`, K.apifyToken, K.apifyRedfinSearchActor, K.apifyRedfinDetailActor], false),
    );
    const json = JSON.stringify(s);
    expect(json).not.toMatch(/APIFY_TOKEN/);
    expect(json).not.toMatch(/APIFY_REDFIN_SEARCH_ACTOR/);
    expect(json).not.toMatch(/APIFY_REDFIN_DETAIL_ACTOR/);
    expect(json).not.toMatch(/LANDOS_LIVE_COMPS/);
    expect(json).not.toMatch(/tri_angle/);
    expect(json).not.toMatch(/redacted-in-test/); // reason string never leaks
    // Only booleans and zeros are present as values.
    for (const v of Object.values(s)) expect(['boolean', 'number'].includes(typeof v)).toBe(true);
  });
});

describe('GET /api/landos/live-comps/preflight — route is safe + status-only', () => {
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

  it('requires auth', async () => {
    const res = await app.request('/api/landos/live-comps/preflight');
    expect(res.status).toBe(401);
  });

  it('returns 200 with exactly the seven status fields and zero calls/spend', async () => {
    const res = await get('/api/landos/live-comps/preflight');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(EXPECTED_KEYS);
    expect(body.providerCallsMade).toBe(0);
    expect(body.spendUsd).toBe(0);
    for (const k of ['liveCompsEnabled', 'apifyTokenPresent', 'redfinSearchActorPresent', 'redfinDetailActorPresent', 'redfinCompsReady']) {
      expect(typeof body[k]).toBe('boolean');
    }
  });

  it('remains safe when configuration is incomplete (no throw, still status-only)', async () => {
    // Test env has no APIFY_* configured -> not ready, but the route still 200s
    // with a clean boolean payload and never errors.
    const res = await get('/api/landos/live-comps/preflight');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('reason');
    expect(body).not.toHaveProperty('missing');
  });

  it('makes NO provider call and records NO spend (no model_call / cost_record rows)', async () => {
    await get('/api/landos/live-comps/preflight');
    const db = getLandosDb();
    const modelCalls = db.prepare('SELECT COUNT(*) AS n FROM landos_model_call').get() as { n: number };
    const costRows = db.prepare('SELECT COUNT(*) AS n FROM landos_cost_record').get() as { n: number };
    expect(modelCalls.n).toBe(0);
    expect(costRows.n).toBe(0);
  });
});
