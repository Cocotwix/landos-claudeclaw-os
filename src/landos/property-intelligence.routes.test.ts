// Property Intelligence HTTP contract.
//
// Proves the operator-visible surface: one launch action, a progress read while
// it runs, a snapshot read afterwards, honest 404/409 handling, and no
// cross-Deal-Card contamination through the API.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';

import { _initTestDatabase } from '../db.js';
import { buildDashboardApp } from '../dashboard.js';
import { _initTestLandosDb } from './db.js';
import { createDealCard } from './deal-card.js';
import { PropertyIntelligenceStore, resetPropertyIntelligenceStoreCache } from './property-intelligence-store.js';
import { initialSpecialistRecords, type PropertyIntelligenceSnapshot } from './property-intelligence-snapshot.js';
import { DEAL_INTELLIGENCE_CHILDREN, DEAL_INTELLIGENCE_KIND, DEAL_INTELLIGENCE_SCOPE,
  dealIntelligenceChildrenForCaller,
} from './deal-intelligence-mission.js';
import { MissionGraphStore } from './mission-graph-store.js';

const TOKEN = 'test-contract-token';

let app: Hono;

beforeAll(() => {
  app = buildDashboardApp(undefined) as unknown as Hono;
});

beforeEach(() => {
  _initTestDatabase();
  _initTestLandosDb();
  resetPropertyIntelligenceStoreCache();
});

function withToken(path: string): string {
  return path + (path.includes('?') ? '&' : '?') + 'token=' + TOKEN;
}

function snapshotFor(dealCardId: number, runId: string, overrides: Partial<PropertyIntelligenceSnapshot> = {}): PropertyIntelligenceSnapshot {
  return {
    snapshotVersion: 1,
    dealCardId,
    runId,
    sequence: 1,
    isPrimary: true,
    status: 'complete',
    startedAt: '2026-07-25T00:00:00.000Z',
    completedAt: '2026-07-25T00:05:00.000Z',
    durationMs: 300_000,
    identity: {
      state: 'confirmed', normalizedAddress: 'OLD RIDGE RD', county: 'Roane', state_: 'TN',
      apn: '073090 04200', apnVariants: ['073090 04200'], owner: 'SACHAN DILEEP S', ownerMailing: null,
      situs: 'OLD RIDGE RD', acres: 12.28, acreageBasis: 'deeded', coordinates: null,
      hasParcelGeometry: false, sourceConfidence: 'high', conflicts: [], explanation: 'Confirmed.',
    },
    facts: [], governmentRecords: [], dueDiligence: [],
    comps: { policyExplanation: 'LandPortal primary.', landPortalUsable: true, landPortalRowsSeen: 0, caps: { zillow: 2, redfin: 2 }, sold: [], active: [], landHomeOnly: [], rejected: [], duplicatesMerged: 0, summaryLine: '' },
    valuation: { priceable: false, range: null, pricePerAcreRange: null, likelyRetail: null, dispositionRange: null, basis: '', adjustments: [], confidence: 'none', uncertainty: [], materialGaps: [], notPriceableReason: 'No comps.', nextActionToPrice: 'Widen the search.' },
    strategies: [],
    recommendation: { preferredStrategy: null, why: '', whatWouldChangeIt: [], posture: 'hold', postureWhy: '' },
    evidence: [], specialists: initialSpecialistRecords(),
    headline: { keyOpportunity: '', topRisks: [], confidence: 'low', confidenceWhy: '' },
    blockers: [], missingInformation: [], nextActions: [],
    ...overrides,
  };
}

describe('Property Intelligence API', () => {
  it('serves the snapshot read for an existing Deal Card', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'PI contract card' });
    const res = await app.request(withToken(`/api/landos/deal-cards/${deal.id}/property-intelligence`));
    expect(res.status).toBe(200);
    const body = await res.json() as { propertyIntelligence: { snapshot: unknown; run: unknown; specialists: unknown[]; history: unknown[] } };
    expect(body.propertyIntelligence.snapshot).toBeNull();
    expect(body.propertyIntelligence.run).toBeNull();
    expect(body.propertyIntelligence.specialists).toEqual([]);
    expect(body.propertyIntelligence.history).toEqual([]);
  });

  it('joins SOP 10B market context from LandOS Market Research on every snapshot read', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'PI market-context card' });
    const res = await app.request(withToken(`/api/landos/deal-cards/${deal.id}/property-intelligence`));
    expect(res.status).toBe(200);
    const body = await res.json() as { marketContext: {
      source: string;
      county: { available: boolean; note: string };
      zip: { available: boolean };
      subjectBand: { available: boolean };
      fastestBand: { available: boolean };
    } };
    expect(body.marketContext.source).toBe('LandOS Market Research');
    // No geography on this card: every record reports honestly unavailable
    // instead of substituting another county, ZIP, or band.
    expect(body.marketContext.county.available).toBe(false);
    expect(body.marketContext.zip.available).toBe(false);
    expect(body.marketContext.subjectBand.available).toBe(false);
    expect(body.marketContext.fastestBand.available).toBe(false);
  });

  it('serves the bounded Workspace V2 projection without compatibility duplicates', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'PI workspace projection card' });
    const res = await app.request(withToken(`/api/landos/deal-cards/${deal.id}/property-intelligence?view=workspace-v2`));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body.propertyIntelligence).toBeDefined();
    expect(body.propertyIntelligence).toHaveProperty('snapshot');
    expect(body.propertyIntelligence).toHaveProperty('compsValuation');
    expect(body).toHaveProperty('marketContext');
    expect(body).toHaveProperty('landPortalFacts');
    expect(body.propertyIntelligence).not.toHaveProperty('mission');
    expect(body.propertyIntelligence).not.toHaveProperty('history');
    expect(body).not.toHaveProperty('documentRegistry');
    expect(body).not.toHaveProperty('compsValuation');
  });

  it('returns the persisted snapshot and specialist roster once a run exists', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'PI snapshot card' });
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId: 'pi_http_1', dealCardId: deal.id, trigger: 'operator', startedAt: '2026-07-25T00:00:00.000Z', specialists: initialSpecialistRecords() });
    store.updateSpecialist({ runId: 'pi_http_1', specialistId: 'parcel_identity', status: 'completed', summary: 'Parcel confirmed.' });
    store.completeRun({ runId: 'pi_http_1', dealCardId: deal.id, status: 'complete', completedAt: '2026-07-25T00:05:00.000Z', snapshot: snapshotFor(deal.id, 'pi_http_1') });

    const res = await app.request(withToken(`/api/landos/deal-cards/${deal.id}/property-intelligence`));
    expect(res.status).toBe(200);
    const body = await res.json() as { propertyIntelligence: {
      snapshot: PropertyIntelligenceSnapshot;
      run: { runId: string; status: string; isPrimary: boolean };
      specialists: Array<{ id: string; status: string }>;
      history: Array<{ runId: string }>;
    } };
    expect(body.propertyIntelligence.snapshot.identity.apn).toBe('073090 04200');
    expect(body.propertyIntelligence.run.runId).toBe('pi_http_1');
    expect(body.propertyIntelligence.run.isPrimary).toBe(true);
    expect(body.propertyIntelligence.specialists).toHaveLength(initialSpecialistRecords().length);
    // The read route projects the immutable snapshot's recorded mission state;
    // it must not infer a terminal specialist transition from current facts.
    expect(body.propertyIntelligence.specialists.find((s) => s.id === 'parcel_identity')!.status).toBe('queued');
    expect(body.propertyIntelligence.history).toHaveLength(1);
  });

  it('serves a progress-only read for polling', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'PI progress card' });
    const store = new PropertyIntelligenceStore();
    // A freshly started run: the stale-run reclaimer must leave it alone.
    store.createRun({ runId: 'pi_http_2', dealCardId: deal.id, trigger: 'operator', startedAt: new Date().toISOString(), specialists: initialSpecialistRecords() });
    store.updateSpecialist({ runId: 'pi_http_2', specialistId: 'comparables', status: 'running' });

    const res = await app.request(withToken(`/api/landos/deal-cards/${deal.id}/property-intelligence/progress`));
    expect(res.status).toBe(200);
    const body = await res.json() as { run: { status: string }; specialists: Array<{ id: string; status: string }>; snapshotStatus: string | null };
    expect(body.run.status).toBe('running');
    expect(body.specialists.find((s) => s.id === 'comparables')!.status).toBe('running');
    expect(body.snapshotStatus).toBeNull();
  });

  it('404s for a Deal Card that does not exist', async () => {
    for (const path of ['property-intelligence', 'property-intelligence/progress']) {
      const res = await app.request(withToken(`/api/landos/deal-cards/999999/${path}`));
      expect(res.status).toBe(404);
    }
    const run = await app.request(withToken('/api/landos/deal-cards/999999/property-intelligence/run'), { method: 'POST' });
    expect(run.status).toBe(404);
  });

  it('400s on a non-numeric Deal Card id', async () => {
    const res = await app.request(withToken('/api/landos/deal-cards/not-a-number/property-intelligence'));
    expect(res.status).toBe(400);
  });

  it('is token gated', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'PI auth card' });
    const res = await app.request(`/api/landos/deal-cards/${deal.id}/property-intelligence`);
    expect(res.status).toBe(401);
  });

  it('returns the in-flight run instead of launching a second mission', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'PI duplicate card' });
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId: 'pi_http_3', dealCardId: deal.id, trigger: 'operator', startedAt: new Date().toISOString(), specialists: initialSpecialistRecords() });

    const res = await app.request(withToken(`/api/landos/deal-cards/${deal.id}/property-intelligence/run`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { launch: { alreadyRunning: boolean; runId: string } };
    expect(body.launch.alreadyRunning).toBe(true);
    expect(body.launch.runId).toBe('pi_http_3');
  });

  it('exposes the parent Deal Intelligence mission on the snapshot read', async () => {
    // Phase 5 Item 18: the operator control creates ONE parent mission on the
    // native mission graph. Before any run there is no mission, and the read
    // says so rather than implying one exists.
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'PI mission card' });
    const res = await app.request(withToken(`/api/landos/deal-cards/${deal.id}/property-intelligence`));
    expect(res.status).toBe(200);
    const body = await res.json() as { propertyIntelligence: { mission: unknown } };
    expect(body.propertyIntelligence).toHaveProperty('mission');
    expect(body.propertyIntelligence.mission).toBeNull();
  });

  it('the operator run control creates a parent mission with every specialist child', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'PI launch card' });
    const res = await app.request(withToken(`/api/landos/deal-cards/${deal.id}/property-intelligence/run`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { launch: { runId: string; missionId: string; childCount: number; alreadyRunning: boolean } };
    expect(body.launch.alreadyRunning).toBe(false);
    // One id for the parent mission AND the versioned snapshot run.
    expect(body.launch.missionId).toBe(body.launch.runId);
    expect(body.launch.childCount).toBe(dealIntelligenceChildrenForCaller(null).length);

    const store = new MissionGraphStore();
    const mission = store.latestMission(DEAL_INTELLIGENCE_KIND, DEAL_INTELLIGENCE_SCOPE, deal.id)!;
    expect(mission.missionId).toBe(body.launch.missionId);
    const children = store.listChildren(mission.missionId);
    expect(children.map((child) => child.key)).toEqual(dealIntelligenceChildrenForCaller(null).map((spec) => spec.key));
    // Declared identity is written WITH the child row, before the lane runs.
    const strategy = children.find((child) => child.key === 'strategy')!;
    expect(strategy.identity.agentName).toBeTruthy();
    expect(strategy.identity.contributionSlot).toBe('strategy');
  });

  it('never serves one Deal Card the other card snapshot', async () => {
    const a = createDealCard({ entity: 'TY_LAND_BIZ', title: 'PI card A' });
    const b = createDealCard({ entity: 'TY_LAND_BIZ', title: 'PI card B' });
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId: 'pi_a', dealCardId: a.id, trigger: 'operator', startedAt: 'now', specialists: initialSpecialistRecords() });
    store.completeRun({ runId: 'pi_a', dealCardId: a.id, status: 'complete', completedAt: 'later', snapshot: snapshotFor(a.id, 'pi_a') });

    const res = await app.request(withToken(`/api/landos/deal-cards/${b.id}/property-intelligence`));
    const body = await res.json() as { propertyIntelligence: { snapshot: unknown } };
    expect(body.propertyIntelligence.snapshot).toBeNull();
  });
});
