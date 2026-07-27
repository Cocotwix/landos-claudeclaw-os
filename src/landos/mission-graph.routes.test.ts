// Mission graph HTTP contract.
//
// Proves the operator-visible surface: one launch action creates a parent
// mission plus its child missions, the read returns both, a failed/blocked
// child is visible through the API, and one Deal Card's mission never leaks
// onto another.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';

import { _initTestDatabase } from '../db.js';
import { buildDashboardApp } from '../dashboard.js';
import { _initTestLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { upsertPropertyCard } from './property-card.js';
import { resetMissionGraphStoreCache } from './mission-graph-store.js';
import { resetPropertyIntelligenceStoreCache } from './property-intelligence-store.js';
import type { MissionAcceptanceVerdict } from './mission-acceptance.js';
import type { MissionProviderAssignment } from './mission-provider-routing.js';
import type { MissionChildState, MissionJoin, MissionStatus } from './mission-graph.js';

/** The route FLATTENS a child's identity onto the row, so the operator surface can
 *  read it without walking a nested object. Mirrors MissionGraphPanel.tsx. */
type MissionChildRow = Omit<MissionChildState, 'identity' | 'acceptance' | 'provider'> & {
  missionId: string;
  group: string;
  assignedRole: string;
  agentKey: string | null;
  agentName: string;
  agentGroup: string | null;
  agentRole: string | null;
  implAgentId: string | null;
  contributionSlot: string;
  acceptance: MissionAcceptanceVerdict | null;
  provider: MissionProviderAssignment | null;
};

/** The JSON shape the route returns. Mirrors web/src/components/MissionGraphPanel.tsx. */
interface MissionGraphView {
  label: string;
  kind: string;
  mission: {
    missionId: string;
    sequence: number;
    status: MissionStatus;
    trigger: string;
    outcome: string | null;
    startedAt: string;
    completedAt: string | null;
    error: string | null;
    failureCategory: string | null;
  } | null;
  children: MissionChildRow[];
  join: MissionJoin | null;
  history: Array<{ missionId: string; sequence: number; status: string; startedAt: string; completedAt: string | null }>;
}

const TOKEN = 'test-contract-token';

let app: Hono;

beforeAll(() => {
  app = buildDashboardApp(undefined) as unknown as Hono;
});

beforeEach(() => {
  _initTestDatabase();
  _initTestLandosDb();
  resetMissionGraphStoreCache();
  resetPropertyIntelligenceStoreCache();
});

function withToken(path: string): string {
  return path + (path.includes('?') ? '&' : '?') + 'token=' + TOKEN;
}

function seedDeal(input: { address: string; county?: string; state?: string; apn?: string; verified?: boolean }): number {
  const deal = createDealCard({ entity: 'LAND_ALLY', title: input.address });
  const { card } = upsertPropertyCard({
    entity: 'LAND_ALLY',
    activeInputAddress: input.address,
    county: input.county,
    state: input.state,
    apn: input.apn,
    fips: input.verified ? '47145' : undefined,
    verified: input.verified,
    verificationSource: input.verified ? 'Tennessee Comptroller parcel layer' : undefined,
  });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
  return deal.id;
}

async function runMission(dealId: number): Promise<MissionGraphView> {
  const res = await app.request(withToken(`/api/landos/deal-cards/${dealId}/mission-graph/run`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wait: true }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { missionGraph: MissionGraphView }).missionGraph;
}

async function readMission(dealId: number): Promise<MissionGraphView> {
  const res = await app.request(withToken(`/api/landos/deal-cards/${dealId}/mission-graph`));
  expect(res.status).toBe(200);
  return ((await res.json()) as { missionGraph: MissionGraphView }).missionGraph;
}

describe('GET /api/landos/deal-cards/:id/mission-graph', () => {
  it('reads as not-yet-run without starting anything', async () => {
    const dealId = seedDeal({ address: 'OLD RIDGE RD', county: 'Knox', state: 'TN', apn: '073090 04200', verified: true });
    const view = await readMission(dealId);
    expect(view.mission).toBeNull();
    expect(view.children).toEqual([]);
    expect(view.join).toBeNull();
  });

  it('404s an unknown Deal Card and 400s a non-numeric id', async () => {
    const missing = await app.request(withToken('/api/landos/deal-cards/999999/mission-graph'));
    expect(missing.status).toBe(404);
    const bad = await app.request(withToken('/api/landos/deal-cards/not-a-number/mission-graph'));
    expect(bad.status).toBe(400);
    const missingRun = await app.request(withToken('/api/landos/deal-cards/999999/mission-graph/run'), { method: 'POST' });
    expect(missingRun.status).toBe(404);
  });

  it('requires the dashboard token', async () => {
    const dealId = seedDeal({ address: 'OLD RIDGE RD', county: 'Knox', state: 'TN' });
    const res = await app.request(`/api/landos/deal-cards/${dealId}/mission-graph`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/landos/deal-cards/:id/mission-graph/run', () => {
  it('launches one parent mission with three child missions and joins them', async () => {
    const dealId = seedDeal({ address: 'OLD RIDGE RD', county: 'Knox', state: 'TN', apn: '073090 04200', verified: true });
    const view = await runMission(dealId);

    expect(view.mission).not.toBeNull();
    expect(view.mission!.sequence).toBe(1);
    expect(view.mission!.status).toBe('joined');
    expect(view.children.map((c) => c.key)).toEqual(['parcel_identity', 'deal_context', 'market_coverage']);
    expect(view.join!.contributed).toHaveLength(3);
    expect(view.join!.allTerminal).toBe(true);
    expect(view.mission!.outcome).toContain('Every child mission contributed');
  });

  it('exposes the joined child handbacks to the parent through the API', async () => {
    const dealId = seedDeal({ address: 'OLD RIDGE RD', county: 'Knox', state: 'TN', apn: '073090 04200', verified: true });
    const view = await runMission(dealId);
    const identity = view.join!.contributions.parcel_identity as Record<string, unknown>;
    expect(identity.apn).toBe('073090 04200');
    expect(identity.identityState).toBe('confirmed');
    expect(identity.dealCardId).toBe(dealId);
  });

  it('surfaces a blocked child explicitly instead of reporting plain success', async () => {
    // Roane County, TN has no seeded LandOS market reference.
    const dealId = seedDeal({ address: 'OLD RIDGE RD', county: 'Roane', state: 'TN', apn: '073090 04200', verified: true });
    const view = await runMission(dealId);

    expect(view.mission!.status).toBe('joined_with_gaps');
    const market = view.children.find((c) => c.key === 'market_coverage')!;
    expect(market.status).toBe('blocked');
    expect(view.join!.gaps.map((g) => g.key)).toEqual(['market_coverage']);
    expect(view.mission!.outcome).toContain('Market reference coverage (blocked)');
  });

  it('blocks the parent and skips the dependants when no subject parcel is linked', async () => {
    const deal = createDealCard({ entity: 'LAND_ALLY', title: 'Bare lead' });
    const view = await runMission(deal.id);

    expect(view.mission!.status).toBe('blocked');
    expect(view.children.find((c) => c.key === 'parcel_identity')!.status).toBe('blocked');
    expect(view.children.find((c) => c.key === 'deal_context')!.status).toBe('skipped');
    expect(view.join!.contributions).toEqual({});
  });

  it('persists the parent and children for a later independent read', async () => {
    const dealId = seedDeal({ address: 'OLD RIDGE RD', county: 'Knox', state: 'TN', apn: '073090 04200', verified: true });
    const launched = await runMission(dealId);
    const reread = await readMission(dealId);

    expect(reread.mission!.missionId).toBe(launched.mission!.missionId);
    expect(reread.children).toHaveLength(3);
    expect(reread.join!.contributed).toHaveLength(3);
    expect(reread.history).toHaveLength(1);
  });

  it('a re-run creates mission #2 and keeps mission #1 in history', async () => {
    const dealId = seedDeal({ address: 'OLD RIDGE RD', county: 'Knox', state: 'TN', apn: '073090 04200', verified: true });
    await runMission(dealId);
    const second = await runMission(dealId);
    expect(second.mission!.sequence).toBe(2);
    expect(second.history.map((h) => h.sequence)).toEqual([2, 1]);
  });

  it('never contaminates another Deal Card', async () => {
    const knox = seedDeal({ address: '4200 SUTHERLAND AVE', county: 'Knox', state: 'TN', apn: 'R1234-567A', verified: true });
    const roane = seedDeal({ address: 'OLD RIDGE RD', county: 'Roane', state: 'TN', apn: '073090 04200', verified: true });
    await runMission(knox);
    await runMission(roane);

    const knoxView = await readMission(knox);
    const roaneView = await readMission(roane);
    expect(knoxView.mission!.missionId).not.toBe(roaneView.mission!.missionId);
    expect((knoxView.join!.contributions.parcel_identity as Record<string, unknown>).apn).toBe('R1234-567A');
    expect((roaneView.join!.contributions.parcel_identity as Record<string, unknown>).apn).toBe('073090 04200');
    expect(knoxView.mission!.status).toBe('joined');
    expect(roaneView.mission!.status).toBe('joined_with_gaps');
  });

  it('exposes each child"s parent, group, role, specialist, provider and acceptance', async () => {
    const dealId = seedDeal({ address: 'OLD RIDGE RD', county: 'Knox', state: 'TN', apn: '073090 04200', verified: true });
    const view = await runMission(dealId);
    const identity = view.children.find((child) => child.key === 'parcel_identity')!;

    expect(identity.missionId).toBe(view.mission!.missionId);
    expect(identity.group).toBe('subject_identity');
    expect(identity.assignedRole).toBe('Subject parcel identity of record');
    expect(identity.agentKey).toBe('dd_bot');
    expect(identity.agentName).toBe('Property Research Agent');
    expect(identity.contributionSlot).toBe('identity');
    expect(identity.acceptance!.state).toBe('accepted');
    // Provider selection is visible, and a deterministic lane says so plainly.
    expect(identity.provider!.mode).toBe('deterministic');
    expect(identity.provider!.providerId).toBeNull();

    // Handbacks reach the parent under their declared slot.
    expect(Object.keys(view.join!.contributionsBySlot).sort()).toEqual(['deal_context', 'identity', 'market_coverage']);
    expect(view.join!.routing.find((route) => route.childKey === 'parcel_identity')!.slot).toBe('identity');
  });

  it('keeps identity, acceptance and provider through an independent re-read', async () => {
    const dealId = seedDeal({ address: 'OLD RIDGE RD', county: 'Knox', state: 'TN', apn: '073090 04200', verified: true });
    await runMission(dealId);
    resetMissionGraphStoreCache();
    const view = await readMission(dealId);
    const market = view.children.find((child) => child.key === 'market_coverage')!;
    expect(market.agentName).toBe('Market Research Agent');
    expect(market.contributionSlot).toBe('market_coverage');
    expect(market.acceptance!.state).toBe('accepted');
    expect(market.provider!.mode).toBe('deterministic');
  });

  it('reports the mission provider catalog, with Hermes optional and not required', async () => {
    const res = await app.request(withToken('/api/landos/model-router/mission-providers'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      hermes: { configured: boolean; optional: boolean };
      missionRoutable: string[];
      catalog: Array<{ id: string; surface: string; missionRoutable: boolean; optional: boolean; detail: string }>;
    };

    expect(body.hermes.optional).toBe(true);
    const hermes = body.catalog.find((entry) => entry.id === 'hermes')!;
    expect(hermes.optional).toBe(true);
    // Claude is the safe-mode target and must remain routable without Hermes.
    expect(body.missionRoutable).toContain('claude');
    expect(body.missionRoutable).not.toContain('codex');
    const codex = body.catalog.find((entry) => entry.id === 'codex')!;
    expect(codex.surface).toBe('agent_session');
    expect(codex.missionRoutable).toBe(false);
  });

  it('leaves the existing Property Intelligence surface working', async () => {
    const dealId = seedDeal({ address: 'OLD RIDGE RD', county: 'Knox', state: 'TN', apn: '073090 04200', verified: true });
    await runMission(dealId);
    const res = await app.request(withToken(`/api/landos/deal-cards/${dealId}/property-intelligence`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { propertyIntelligence: { snapshot: unknown; run: unknown } };
    // The fan-out mission is a SEPARATE mission kind; it must not fabricate a
    // Property Intelligence run or snapshot.
    expect(body.propertyIntelligence.run).toBeNull();
    expect(body.propertyIntelligence.snapshot).toBeNull();
  });
});
