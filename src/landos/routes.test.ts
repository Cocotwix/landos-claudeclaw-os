// Contract tests for the LandOS OS Spine v1 dashboard API. Same pattern as
// src/dashboard.contract.test.ts: Hono app.request(), no real port, token
// auth from src/test-env-setup.ts, in-memory DBs.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { Hono } from 'hono';

import { _initTestDatabase } from '../db.js';
import { buildDashboardApp } from '../dashboard.js';
import { _initTestLandosDb, getLandosDb, logModelCall } from './db.js';

// The live DD routes now default to the parcel-identity CAPABILITY. These route
// tests exercise the verification BRIDGE mapping, so delegate the capability to
// the real LandPortal resolver (its no-network arg-validation paths) for
// deterministic, network-free behavior. Capability *selection* is covered by
// parcel-capability.test.ts.
vi.mock('./parcel-capability.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const { lpResolveForPreflight } = await import('./landportal-client.js');
  return { ...actual, resolveParcelIdentityResult: (args: unknown, t: unknown) => (lpResolveForPreflight as any)(args, t) };
});

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

describe('LandOS routes — cost board (actual recorded spend)', () => {
  it('aggregates recorded model_call rows by department/provider/runtime/model — never a fake number', async () => {
    logModelCall({ agentId: 'duke', provider: 'anthropic', model: 'claude', taskClass: 'strategy', estCostUsd: 0.02, workflow: 'research_due_diligence', inputTokens: 1000, outputTokens: 500 });
    logModelCall({ agentId: 'duke', provider: 'google', model: 'gemma-4-e4b', taskClass: 'parse', estCostUsd: 0, workflow: 'research_due_diligence' });
    const res = await get('/api/landos/cost-board');
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(b.totalCalls).toBe(2);
    expect(b.totalUsd).toBeCloseTo(0.02, 6);
    // Runtime derived from the neutral registry: claude=cloud, gemma=local.
    expect(b.byRuntime.cloud).toBeCloseTo(0.02, 6);
    expect(b.byRuntime.local).toBe(0);
    // Records the ACTUAL model that ran (claude), not a suggestion.
    expect(b.byModel.find((m: any) => m.modelId === 'claude').usd).toBeCloseTo(0.02, 6);
    expect(b.byDepartment.find((d: any) => d.department === 'research_due_diligence').calls).toBe(2);
  });

  it('returns an honest empty board when no spend is recorded (no fabricated rows)', async () => {
    const res = await get('/api/landos/cost-board');
    const b = (await res.json()) as any;
    expect(b.totalCalls).toBe(0);
    expect(b.totalUsd).toBe(0);
    expect(b.byModel).toEqual([]);
  });
});

describe('LandOS routes — verified-gate (Deal Card only after verified identity)', () => {
  it('REJECTS creation when the parcel is unverified — even if the client claims verified:true — and writes NO card', async () => {
    // Non-identifier text => runDukeVerification returns unverified WITHOUT any
    // LandPortal call (no network). The endpoint never reads a client 'verified'
    // flag; it re-verifies server-side, so a lying flag cannot create a card.
    const res = await post('/api/landos/deal-cards/from-verification', {
      text: 'tell me something interesting about clouds',
      entity: 'TY_LAND_BIZ',
      verified: true, // lying client flag — must be ignored
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.created).toBe(false);
    expect(body.parcelVerified).toBe(false);
    expect(body.reason).toMatch(/Local Area Context — Not Parcel Verified/);

    // NO Deal Card and NO property card were written.
    const deals = (await (await get('/api/landos/deal-cards')).json()) as any;
    expect(deals.dealCards).toHaveLength(0);
    const props = (await (await get('/api/landos/property-cards')).json()) as any;
    expect(props.cards).toHaveLength(0);
  });

  it('rejects an invalid entity and writes no card', async () => {
    const res = await post('/api/landos/deal-cards/from-verification', { text: 'anything', entity: 'NOPE' });
    expect(res.status).toBe(400);
    const deals = (await (await get('/api/landos/deal-cards')).json()) as any;
    expect(deals.dealCards).toHaveLength(0);
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

describe('SPA shell is served no-store (stale-bundle regression)', () => {
  // Root cause of "the new button does nothing": the SPA HTML shell was cached
  // by the browser while assets are content-hashed + immutable, pinning the user
  // to an old bundle. The shell MUST be no-store so new frontend builds load.
  it('GET / sets Cache-Control: no-store on the SPA shell', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect((res.headers.get('cache-control') ?? '').toLowerCase()).toContain('no-store');
  });

  it('GET a SPA deep link (/landos) sets Cache-Control: no-store', async () => {
    const res = await app.request('/landos');
    expect(res.status).toBe(200);
    expect((res.headers.get('cache-control') ?? '').toLowerCase()).toContain('no-store');
  });

  it('hashed assets stay immutable (only the shell is no-store)', async () => {
    // Sanity: the immutable policy on /assets/* is correct and unchanged.
    const res = await app.request('/');
    const html = await res.text();
    const m = html.match(/assets\/[A-Za-z0-9_.-]+\.js/);
    if (m) {
      const asset = await app.request('/' + m[0]);
      expect((asset.headers.get('cache-control') ?? '').toLowerCase()).toContain('immutable');
    }
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

  it('returns the FULL product contract shape the UI renders (verification + analysis + ace + market + deal)', async () => {
    const res = await post('/api/landos/intake/duke-verification', NO_IDENTITY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.verification).toBeTypeOf('object');
    expect(body.verification.status).toBeTypeOf('string');
    expect(Array.isArray(body.verification.sourceAttempts)).toBe(true);
    expect(Array.isArray(body.verification.dataGaps)).toBe(true);
    expect(body.dukeAnalysis).toBeTypeOf('object');
    expect(body.dukeAnalysis.strategyStatus).toBe('blocked_unverified_parcel');
    expect(body.acePrep).toBeTypeOf('object');
    expect(Array.isArray(body.acePrep.questions)).toBe(true);
    expect(body.marketPulse).toBeTypeOf('object');
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

  it('a FULL street address is a valid identifier — never no_parcel_identifier_in_input', async () => {
    // 731 Filter Plant Dr, Fayetteville, NC 28301 parses to an address with no
    // FIPS -> LandPortal returns ambiguous_fips offline (no network). The route
    // must attempt the lookup and report needs-county/FIPS, not "no identifier".
    const res = await post('/api/landos/intake/duke-verification', { text: '731 Filter Plant Dr, Fayetteville, NC 28301' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.verification.dataGaps).not.toContain('no_parcel_identifier_in_input');
    expect(body.verification.dataGaps).toContain('needs_county_or_fips');
    expect(body.verification.sourceAttempts[0].status).not.toBe('skipped');
    expect(body.verification.parcelVerified).toBe(false);
    expect(body.verification.strategyUnderwritingBlocked).toBe(true);
    // Market Pulse v1 runs as labeled local-area context.
    expect(body.marketPulse.eligible).toBe(true);
    expect(body.marketPulse.label).toBe('Local Area Context, Not Parcel Verified');
    const pop = body.marketPulse.signals.find((s: any) => s.signal === 'population_growth_direction');
    expect(pop.status).toBe('source_available');
    expect(pop.sourceUrl).toMatch(/census\.gov/);
  });

  it('requires text', async () => {
    const res = await post('/api/landos/intake/duke-verification', {});
    expect(res.status).toBe(400);
  });
});

describe('LandOS routes — Duke property data (propertyid + FIPS, non-comp)', () => {
  // Proves the propertyid+FIPS path bypasses /search, pulls /property-data, and
  // returns a verified dashboard contract with normalized property data. global
  // fetch is stubbed (no real network / no real token / no comp credit).
  const PROP_BODY = { text: 'propertyid 173393466, FIPS 47031' };
  let fetchCalls: string[] = [];

  beforeEach(() => {
    fetchCalls = [];
    process.env.LP_JWT_TOKEN = 'test-fake-token'; // fake; the stub ignores it
    vi.stubGlobal('fetch', async (url: unknown) => {
      fetchCalls.push(String(url));
      const property = {
        propertyid: '173393466', apn: '076-022.02', situsfullstreetaddress: '123 Smoke Rd',
        situscity: 'Manchester', situsstate: 'TN', situszip5: '37355', situscounty: 'Coffee',
        ownername1full: 'Smoke Owner LLC', landusecodedescription: 'Vacant', lotsizeacres: '12.5',
        road_frontage: '210', land_locked: 'false', wetlands_cover_percentage: '3', fema_cover_percentage: '0',
        buildability_total_perc: '88', buildability_area: '11', slope_average: '4',
        markettotalvalue: '60000', tlp_estimate: '75000', tlp_ppa: '6000',
        // Individual embedded similar-sale rows in the non-comp response.
        similars: JSON.stringify([
          { sold_year: 2024, sold_price: 45000, price_acres: 9000, apn: '076-001.00', propertyid: '999001' },
          { sold_year: 2023, price_acres: 6000 },
        ]),
      };
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { property }, meta: { requests_left: '100' } }) } as unknown as Response;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LP_JWT_TOKEN;
  });

  it('bypasses /search, pulls /property-data, and returns normalized verified property data', async () => {
    const res = await post('/api/landos/intake/duke-verification', PROP_BODY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.verification.parcelVerified).toBe(true);
    expect(body.verification.propertyData.sourceName).toBe('LandPortal');
    expect(body.verification.propertyData.identity.propertyId).toBe('173393466');
    expect(body.verification.propertyData.identity.fips).toBe('47031');
    expect(body.verification.propertyData.landFacts.acres).toBe(12.5);
    expect(body.verification.propertyData.valuation.marketTotal).toBe(60000);
    expect(body.dukeAnalysis.strategyStatus).toBe('ready_for_preliminary_review');
    expect(body.acePrep.status).toBe('ready');
    // Market Pulse derives local area from VERIFIED county/state (no area words
    // in a propertyid+FIPS input) — Coffee County, TN, not "unknown area".
    expect(body.marketPulse.eligible).toBe(true);
    expect(body.marketPulse.localArea.descriptor).toMatch(/Coffee/);
    expect(body.marketPulse.localArea.descriptor).toMatch(/TN/);
    // Individual embedded similar-sale rows are surfaced (no comp credit).
    expect(body.verification.propertyData.similarRowsAvailable).toBe(true);
    expect(body.verification.propertyData.similarSales.length).toBe(2);
    expect(body.verification.propertyData.similarSales[0].salePrice).toBe(45000);
    expect(body.verification.propertyData.similarSales[0].apn).toBe('076-001.00');
    // Bypassed search: hit /property-data, never /search.
    expect(fetchCalls.some((u) => u.includes('/property-data'))).toBe(true);
    expect(fetchCalls.some((u) => u.includes('/search'))).toBe(false);
    // Never a comp report tool / comp credit.
    expect(fetchCalls.some((u) => /comp_report|comp-report|lp_comp/.test(u))).toBe(false);
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

describe('LandOS routes — Deal Card create/edit/save/reload/update', () => {
  it('creates a Deal Card via POST and reads it back via GET (reload)', async () => {
    const create = await post('/api/landos/deal-cards', {
      entity: 'TY_LAND_BIZ', title: 'Generic seller lead', sellerNotes: 'placeholder note',
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as any;
    const id = created.dealCard.id;
    expect(id).toBeGreaterThan(0);
    expect(created.dealCard.title).toBe('Generic seller lead');

    // "Reload": fresh GET hits the DB and recovers the saved card.
    const reload = await get(`/api/landos/deal-cards/${id}`);
    expect(reload.status).toBe(200);
    const reloaded = (await reload.json()) as any;
    expect(reloaded.dealCard.title).toBe('Generic seller lead');
    expect(reloaded.dealCard.seller_notes).toBe('placeholder note');
    expect(reloaded.dealCard.entity).toBe('TY_LAND_BIZ');
    expect(reloaded.dealCard.status).toBe('new');
  });

  it('rejects a create with no/invalid entity', async () => {
    const res = await post('/api/landos/deal-cards', { title: 'no entity' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid status on create', async () => {
    const res = await post('/api/landos/deal-cards', { entity: 'LAND_ALLY', status: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('updates the SAME card via PATCH (no duplicate) and persists across reload', async () => {
    const create = await post('/api/landos/deal-cards', { entity: 'LAND_ALLY', title: 'Before' });
    const id = ((await create.json()) as any).dealCard.id;

    const before = await get('/api/landos/deal-cards');
    const beforeCount = ((await before.json()) as any).dealCards.length;

    const patch = await app.request(`/api/landos/deal-cards/${id}?token=${TOKEN}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'After', status: 'researching', askingPrice: 42000 }),
    });
    expect(patch.status).toBe(200);

    const reload = await get(`/api/landos/deal-cards/${id}`);
    const reloaded = (await reload.json()) as any;
    expect(reloaded.dealCard.title).toBe('After');
    expect(reloaded.dealCard.status).toBe('researching');
    expect(reloaded.dealCard.asking_price).toBe(42000);

    // No duplicate record was created by the update.
    const after = await get('/api/landos/deal-cards');
    expect(((await after.json()) as any).dealCards.length).toBe(beforeCount);
  });

  it('PATCH of a missing card returns 404', async () => {
    const res = await app.request(`/api/landos/deal-cards/999999?token=${TOKEN}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'ghost' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('LandOS routes — Deal Card DD/Research worksheet', () => {
  async function put(path: string, body: unknown) {
    return app.request(path + (path.includes('?') ? '&' : '?') + 'token=' + TOKEN, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  async function newDealId(): Promise<number> {
    const create = await post('/api/landos/deal-cards', { entity: 'TY_LAND_BIZ', title: 'DD route deal' });
    return ((await create.json()) as any).dealCard.id;
  }

  it('GET returns an honest empty worksheet plus label vocab', async () => {
    const id = await newDealId();
    const res = await get(`/api/landos/deal-cards/${id}/dd`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.dd.exists).toBe(false);
    expect(body.dd.parcelIdentityStatus).toBe('local_area_context_not_verified');
    expect(body.fieldLabels).toContain('Local Area Context, Not Parcel Verified');
    expect(Array.isArray(body.parcelIdentityStatuses)).toBe(true);
  });

  it('PUT saves DD fields and a reload recovers them (persistence)', async () => {
    const id = await newDealId();
    const save = await put(`/api/landos/deal-cards/${id}/dd`, {
      apn: '555-001', apnLabel: 'Seller stated',
      county: 'Sample County', state: 'TX', acreage: 35,
      dataGaps: ['Confirm access'], riskFlags: ['No survey'],
    });
    expect(save.status).toBe(200);

    const reload = await get(`/api/landos/deal-cards/${id}/dd`);
    const dd = ((await reload.json()) as any).dd;
    expect(dd.exists).toBe(true);
    expect(dd.apn).toBe('555-001');
    expect(dd.apnLabel).toBe('Seller stated');
    expect(dd.acreage).toBe(35);
    expect(dd.dataGaps).toEqual(['Confirm access']);
    expect(dd.riskFlags).toEqual(['No survey']);
  });

  it('PUT enforces the Verified-needs-a-source guardrail and returns a warning', async () => {
    const id = await newDealId();
    const save = await put(`/api/landos/deal-cards/${id}/dd`, { apn: '9', apnLabel: 'Verified' });
    const body = (await save.json()) as any;
    expect(body.dd.apnLabel).toBe('Needs verification');
    expect(body.warnings.length).toBeGreaterThan(0);
  });

  it('GET/PUT on a missing deal card returns 404', async () => {
    const g = await get('/api/landos/deal-cards/999999/dd');
    expect(g.status).toBe(404);
    const p = await put('/api/landos/deal-cards/999999/dd', { apn: 'x' });
    expect(p.status).toBe(404);
  });
});

describe('LandOS routes — Deal Card Market Research worksheet', () => {
  async function put(path: string, body: unknown) {
    return app.request(path + (path.includes('?') ? '&' : '?') + 'token=' + TOKEN, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  async function newDealId(): Promise<number> {
    const create = await post('/api/landos/deal-cards', { entity: 'TY_LAND_BIZ', title: 'Market route deal' });
    return ((await create.json()) as any).dealCard.id;
  }

  it('GET returns an honest empty worksheet plus label vocab', async () => {
    const id = await newDealId();
    const res = await get(`/api/landos/deal-cards/${id}/market`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.market.exists).toBe(false);
    expect(body.market.marketReviewStatus).toBe('not_reviewed');
    expect(body.demandLabels).toContain('strong_demand');
    expect(body.demandLabels).toContain('needs_research');
    expect(Array.isArray(body.sourceConfidenceLabels)).toBe(true);
  });

  it('PUT saves Market fields and a reload recovers them (persistence)', async () => {
    const id = await newDealId();
    const save = await put(`/api/landos/deal-cards/${id}/market`, {
      marketReviewStatus: 'moderate_demand',
      targetAreaLabel: 'Sample submarket',
      buyerDemandNotes: 'Active local buyers per manual review',
      buyerDemandLabel: 'strong_demand',
      dataGaps: ['Confirm absorption'], riskFlags: ['Thin sold data'],
    });
    expect(save.status).toBe(200);

    const reload = await get(`/api/landos/deal-cards/${id}/market`);
    const market = ((await reload.json()) as any).market;
    expect(market.exists).toBe(true);
    expect(market.targetAreaLabel).toBe('Sample submarket');
    expect(market.buyerDemandLabel).toBe('strong_demand');
    expect(market.dataGaps).toEqual(['Confirm absorption']);
    expect(market.riskFlags).toEqual(['Thin sold data']);
  });

  it('PUT downgrades a demand rating with no supporting note and returns a warning', async () => {
    const id = await newDealId();
    const save = await put(`/api/landos/deal-cards/${id}/market`, {
      subdivisionDemandLabel: 'strong_demand',
    });
    const body = (await save.json()) as any;
    expect(body.market.subdivisionDemandLabel).toBe('needs_research');
    expect(body.warnings.length).toBeGreaterThan(0);
  });

  it('PUT downgrades source confidence high without a source link', async () => {
    const id = await newDealId();
    const save = await put(`/api/landos/deal-cards/${id}/market`, { sourceConfidence: 'high' });
    const body = (await save.json()) as any;
    expect(body.market.sourceConfidence).toBe('needs_research');
    expect(body.warnings.length).toBeGreaterThan(0);
  });

  it('GET/PUT on a missing deal card returns 404', async () => {
    const g = await get('/api/landos/deal-cards/999999/market');
    expect(g.status).toBe(404);
    const p = await put('/api/landos/deal-cards/999999/market', { targetAreaLabel: 'x' });
    expect(p.status).toBe(404);
  });
});

describe('LandOS routes — knowledge layer + data providers (presence-only)', () => {
  it('knowledge/status reports backend selection + provider config without secret values', async () => {
    const res = await get('/api/landos/knowledge/status');
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(['local-fs', 'r2']).toContain(b.knowledgeStore.selected);
    expect(typeof b.knowledgeStore.reason).toBe('string');
    // r2.missing carries env KEY NAMES only, never values
    expect(Array.isArray(b.knowledgeStore.r2.missing)).toBe(true);
    const ids = b.dataProviders.parcelProviders.map((p: any) => p.id).sort();
    expect(ids).toEqual(['landportal', 'realie']);
    const realie = b.dataProviders.parcelProviders.find((p: any) => p.id === 'realie');
    expect(typeof realie.configured).toBe('boolean');
    // No secret VALUE leaks into the payload (key NAMES like
    // LANDOS_R2_SECRET_ACCESS_KEY are fine; an actual bearer/value is not).
    expect(JSON.stringify(b)).not.toMatch(/Bearer\s+\S/i);
  });

  it('agent knowledge manifest: 404 for unknown agent, empty list for a known fresh agent', async () => {
    const bad = await get('/api/landos/knowledge/agents/nope_bot');
    expect(bad.status).toBe(404);
    const ok = await get('/api/landos/knowledge/agents/market_bot');
    expect(ok.status).toBe(200);
    const b = (await ok.json()) as any;
    expect(b.agentKey).toBe('market_bot');
    expect(Array.isArray(b.items)).toBe(true);
  });

  it('market/scorecard returns a scorecard shape (metrics unavailable until a source connects)', async () => {
    const res = await get('/api/landos/market/scorecard');
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(b.scorecard.version).toBe(1);
    expect(Array.isArray(b.scorecard.counties)).toBe(true);
  });
});

describe('LandOS routes — post-discovery DD layer', () => {
  it('dd-providers status: free gov providers dormant by default', async () => {
    const res = await get('/api/landos/dd-providers/status');
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(b.liveEnabled).toBe(false);
    expect(b.providers.map((p: any) => p.capability).sort()).toEqual(['demographics', 'flood', 'slope', 'wetlands']);
  });

  it('seller-stated facts: add (Seller-stated) + list + summary', async () => {
    const { upsertCardFromDukeRun } = await import('./property-card.js');
    const { linkPropertyToDeal } = await import('./deal-card.js');
    const created = await post('/api/landos/deal-cards', { entity: 'TY_LAND_BIZ', title: 'Seller deal' });
    const id = ((await created.json()) as any).dealCard.id;
    const { card } = upsertCardFromDukeRun({ entity: 'TY_LAND_BIZ', activeInputAddress: '472 WEST RD', county: 'Worth', state: 'GA', apn: '00830-054-000', fips: '13321', owner: 'X', acres: 8.6, verified: true, verificationSource: 'Realie.ai', summary: 'v' });
    linkPropertyToDeal({ dealCardId: id, cardId: card.id, role: 'subject' });
    const bad = await post(`/api/landos/deal-cards/${id}/seller-facts`, { kind: 'nope', value: 'x' });
    expect(bad.status).toBe(400);
    const add = await post(`/api/landos/deal-cards/${id}/seller-facts`, { kind: 'liens', value: 'maybe a tax lien' });
    expect(add.status).toBe(201);
    const list = await get(`/api/landos/deal-cards/${id}/seller-facts`);
    const lb = (await list.json()) as any;
    expect(lb.facts).toHaveLength(1);
    expect(lb.summary.discoveryCaptured).toBe(true);
    expect(lb.summary.riskFlags.some((f: string) => /Seller-stated/i.test(f))).toBe(true);
  });

  it('county verification: plan (no browsing) + manual mark (agent dormant)', async () => {
    const { upsertCardFromDukeRun } = await import('./property-card.js');
    const { linkPropertyToDeal } = await import('./deal-card.js');
    const created = await post('/api/landos/deal-cards', { entity: 'TY_LAND_BIZ', title: 'County deal' });
    const id = ((await created.json()) as any).dealCard.id;
    const { card } = upsertCardFromDukeRun({ entity: 'TY_LAND_BIZ', activeInputAddress: '472 WEST RD', county: 'Worth', state: 'GA', apn: '00830-054-000', fips: '13321', owner: 'X', acres: 8.6, verified: true, verificationSource: 'Realie.ai', summary: 'v' });
    linkPropertyToDeal({ dealCardId: id, cardId: card.id, role: 'subject' });
    const plan = await post(`/api/landos/deal-cards/${id}/county-verification/plan`, { task: 'verify_owner' });
    expect(plan.status).toBe(200);
    const pb = (await plan.json()) as any;
    expect(pb.note).toMatch(/dormant/i);
    // exact identifier (APN+county/state) present -> plan allowed (bounded)
    expect(pb.plan.allowed).toBe(true);
    const mark = await post(`/api/landos/deal-cards/${id}/county-verification/mark`, { task: 'verify_owner', status: 'needs_human_or_county_call', note: 'call county' });
    expect(mark.status).toBe(201);
    const listed = await get(`/api/landos/deal-cards/${id}/county-verification`);
    const lb = (await listed.json()) as any;
    expect(lb.records).toHaveLength(1);
    expect(lb.availableTasks).toContain('verify_apn');
  });

  it('underwriting prep is blocked on an unverified deal (no offer computed)', async () => {
    const created = await post('/api/landos/deal-cards', { entity: 'TY_LAND_BIZ', title: 'UW deal' });
    const id = ((await created.json()) as any).dealCard.id;
    const res = await get(`/api/landos/deal-cards/${id}/underwriting-prep`);
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(b.underwritingPrep.state).toBe('blocked');
    expect(b.underwritingPrep.minimumProfitRules.length).toBeGreaterThan(0);
  });
});

describe('LandOS routes — Deal Card DD readiness surfacing', () => {
  it('report response includes readiness; list rows include a reportSummary', async () => {
    const created = await post('/api/landos/deal-cards', { entity: 'TY_LAND_BIZ', title: 'Readiness deal' });
    const id = ((await created.json()) as any).dealCard.id;

    const rep = await get(`/api/landos/deal-cards/${id}/report`);
    expect(rep.status).toBe(200);
    const rb = (await rep.json()) as any;
    expect(rb.readiness).toBeDefined();
    expect(rb.readiness.discoveryReportState).toBe('not_generated');
    expect(rb.readiness.nextBestAction.action).toBe('needs_parcel_verification');

    const list = await get('/api/landos/deal-cards');
    const item = ((await list.json()) as any).dealCards.find((d: any) => d.id === id);
    expect(item.reportSummary).toBeDefined();
    expect(item.reportSummary.exists).toBe(false);
    expect(item.reportSummary.ddPercentComplete).toBe(0);
  });
});

describe('LandOS routes — visual image serving + capture gating (no Google call)', () => {
  it('serves a stored captured image by card+service; 404 when none; 400 on bad service', async () => {
    const fsm = await import('fs');
    const pathm = await import('path');
    const { upsertCardFromDukeRun, saveCardVisualCapture } = await import('./property-card.js');
    const { card } = upsertCardFromDukeRun({
      entity: 'TY_LAND_BIZ', activeInputAddress: '472 WEST RD', county: 'Worth', state: 'GA',
      apn: '00830-054-000', fips: '13321', owner: 'X', acres: 8.6, verified: true, verificationSource: 'Realie.ai', summary: 'v',
    });
    const dir = pathm.join(process.cwd(), 'store', 'visuals');
    fsm.mkdirSync(dir, { recursive: true });
    const file = pathm.join(dir, `test_${card.id}_maps.png`);
    fsm.writeFileSync(file, Buffer.from([137, 80, 78, 71])); // PNG magic bytes
    saveCardVisualCapture(card.id, { maps_static: { storedPath: file, timestamp: 't' } }, { provider: 'google' });

    const ok = await get(`/api/landos/visual/image?cardId=${card.id}&service=maps_static`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('image/png');

    const noCap = await get(`/api/landos/visual/image?cardId=${card.id}&service=street_view_static`);
    expect(noCap.status).toBe(404);

    const badSvc = await get(`/api/landos/visual/image?cardId=${card.id}&service=evil`);
    expect(badSvc.status).toBe(400);

    fsm.unlinkSync(file);
  });

  it('capture route is gated: 400 when Google is not configured (no call made)', async () => {
    // hermetic test env (LANDOS_DISABLE_DOTENV_FALLBACK) → key not resolvable → gated off.
    const res = await post('/api/landos/property-cards/1/visual-capture', {});
    expect(res.status).toBe(400);
    const b = (await res.json()) as any;
    expect(String(b.error)).toMatch(/not configured/i);
  });
});
