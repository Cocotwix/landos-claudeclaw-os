import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { runDealIntelligenceMission, launchDealIntelligenceMission } from './deal-intelligence-run.js';
import { DEAL_INTELLIGENCE_CHILDREN, DEAL_INTELLIGENCE_KIND, DEAL_INTELLIGENCE_SCOPE, type DealIntelligenceCapabilities } from './deal-intelligence-mission.js';
import { MissionGraphStore, resetMissionGraphStoreCache } from './mission-graph-store.js';
import { PropertyIntelligenceStore, resetPropertyIntelligenceStoreCache } from './property-intelligence-store.js';
import type { PropertyIntelligenceCollectors, SpecialistOutcome } from './property-intelligence-mission.js';
import type { SnapshotIdentity } from './property-intelligence-snapshot.js';

const CONFIRMED: SnapshotIdentity = {
  state: 'confirmed', normalizedAddress: 'OLD RIDGE RD', county: 'Roane', state_: 'TN',
  apn: '073090 04200', apnVariants: ['073090 04200'], owner: 'SACHAN DILEEP S', ownerMailing: null,
  situs: 'OLD RIDGE RD', acres: 12.28, acreageBasis: 'deeded', coordinates: null,
  hasParcelGeometry: false, sourceConfidence: 'high', conflicts: [], explanation: 'Confirmed against TN Comptroller.',
};

function ok<T>(data: T, status: SpecialistOutcome<T>['status'] = 'completed', summary = 'ok'): SpecialistOutcome<T> {
  return { status, summary, data };
}

function collectors(overrides: Partial<PropertyIntelligenceCollectors> = {}): PropertyIntelligenceCollectors {
  return {
    parcel_identity: async () => ok({
      identity: CONFIRMED,
      facts: [{ key: 'apn', label: 'Parcel number (APN)', value: '073090 04200', grade: 'confirmed_fact' as const, source: 'TN Comptroller', sourceUrl: null, retrievedAt: null, note: null }],
      subjectMarket: { state: 'TN', county: 'Roane', acres: 12.28 },
      subjectAcres: 12.28,
      acreageConflict: false,
    }),
    government_records: async () => ok({
      records: [{ key: 'owners', label: 'Named ownership parties', value: 'SACHAN DILEEP S', grade: 'confirmed_fact' as const, source: 'County', sourceUrl: null, retrievedAt: null, note: null }],
    }),
    zoning_land_use: async () => ok({
      zoning: 'A-1 — Agricultural',
      zoningKnown: true,
      items: [{ key: 'zoning', label: 'Zoning', verdict: 'good' as const, headline: 'A-1', grade: 'confirmed_fact' as const, detail: null, sourceUrl: null, missing: [] }],
      facts: [],
    }),
    environmental_terrain: async () => ok({
      items: [{ key: 'flood', label: 'Floodplain', verdict: 'good' as const, headline: 'Outside the mapped floodplain.', grade: 'likely_indication' as const, detail: null, sourceUrl: null, missing: [] }],
      constraints: [],
    }),
    access_utilities: async () => ok({
      items: [{ key: 'access', label: 'Access', verdict: 'caution' as const, headline: 'Mapped road contact.', grade: 'likely_indication' as const, detail: null, sourceUrl: null, missing: [] }],
      accessStatus: 'public_road_proximity' as const,
      utilitiesKnown: true,
      utilitiesSummary: 'Power at the road.',
    }),
    comparables: async () => ok({
      candidates: [
        { provider: 'LandPortal visible', lane: 'landportal', addressDesc: '100 Ridge Rd', state: 'TN', price: 60_000, priceKind: 'sold', saleOrListDate: '2026-01-10', acres: 10, pricePerAcre: 6_000, sourceUrl: 'https://landportal.com/x', compClass: 'vacant_land' },
        { provider: 'Zillow', lane: 'active', addressDesc: '200 Ridge Rd', state: 'TN', price: 75_000, priceKind: 'list', saleOrListDate: '2026-05-01', acres: 12, pricePerAcre: 6_250, sourceUrl: 'https://zillow.com/y', compClass: 'vacant_land' },
      ] as never,
      duplicatesMerged: 0,
    }),
    market_intelligence: async () => ok({ facts: [], summary: '' }),
    evidence_visuals: async () => ({
      status: 'completed' as const,
      summary: '1 screenshot retained.',
      data: { evidence: [] },
      evidence: [{ id: 'v1', kind: 'screenshot' as const, label: 'LandPortal parcel page', sourceType: 'landportal', sourceUrl: null, viewUrl: '/api/landos/inspection/image?cardId=32&key=parcel_page', retrievedAt: null, confidence: 'high' as const, supports: 'visual_evidence', sha256: 'abc', bytes: 100 }],
    }),
    ...overrides,
  };
}

function caps(overrides: Partial<DealIntelligenceCapabilities> = {}): DealIntelligenceCapabilities {
  return {
    collectors: collectors(),
    subjectResearch: async () => ({ ok: true, note: 'LandPortal and county subject research completed.' }),
    marketPulse: async () => ({
      marketMatrix: { summaryLine: 'Roane TN sold band resolved.' },
      marketPulse: { plainEnglish: 'Land is moving in Roane County.' },
      facts: [
        { key: 'market_matrix', label: 'Market Matrix', value: 'Roane TN sold band resolved.', grade: 'likely_indication' as const, source: 'LandOS Market Matrix', sourceUrl: null, retrievedAt: null, note: null },
        { key: 'market_pulse', label: 'Market Pulse', value: 'Land is moving in Roane County.', grade: 'likely_indication' as const, source: 'LandOS Market Pulse', sourceUrl: null, retrievedAt: null, note: null },
      ],
      summary: 'Market Matrix and Market Pulse assembled.',
    }),
    ...overrides,
  };
}

const RUN_OPTS = { timeoutMsOverride: 10_000, joinPollMs: 5, joinDeadlineMs: 5_000 };

beforeEach(() => {
  _initTestLandosDb();
  resetPropertyIntelligenceStoreCache();
  resetMissionGraphStoreCache();
});

describe('Deal Intelligence run lifecycle', () => {
  it('one operator action creates ONE parent mission with every specialist child', async () => {
    const missionStore = new MissionGraphStore();
    const snapshot = await runDealIntelligenceMission({ dealCardId: 32, capabilities: caps(), missionStore, ...RUN_OPTS });

    const mission = missionStore.latestMission(DEAL_INTELLIGENCE_KIND, DEAL_INTELLIGENCE_SCOPE, 32);
    expect(mission).toBeTruthy();
    expect(mission!.scopeId).toBe(32);
    const children = missionStore.listChildren(mission!.missionId);
    expect(children).toHaveLength(DEAL_INTELLIGENCE_CHILDREN.length);
    expect(children.every((child) => ['completed', 'partial'].includes(child.status))).toBe(true);
    // The mission id and the snapshot run id are the SAME id.
    expect(snapshot!.runId).toBe(mission!.missionId);
    expect(snapshot!.missionId).toBe(mission!.missionId);
  });

  it('assembles accepted handbacks into ONE current snapshot the Deal Card reads', async () => {
    const store = new PropertyIntelligenceStore();
    await runDealIntelligenceMission({ dealCardId: 32, capabilities: caps(), snapshotStore: store, ...RUN_OPTS });

    const primary = store.primaryRun(32);
    expect(primary).toBeTruthy();
    expect(primary!.isPrimary).toBe(true);
    const snapshot = primary!.snapshot!;
    expect(snapshot.identity.apn).toBe('073090 04200');
    expect(snapshot.identity.state).toBe('confirmed');
    expect(snapshot.governmentRecords).toHaveLength(1);
    expect(snapshot.dueDiligence.map((item) => item.key)).toEqual(expect.arrayContaining(['zoning', 'flood', 'access']));
    expect(snapshot.comps.sold.length + snapshot.comps.active.length).toBeGreaterThan(0);
    expect(snapshot.strategies).toHaveLength(5);
    expect(snapshot.evidence.some((item) => item.kind === 'screenshot')).toBe(true);
    expect(snapshot.facts.some((fact) => fact.key === 'market_matrix')).toBe(true);
    expect(snapshot.facts.some((fact) => fact.key === 'market_pulse')).toBe(true);
    // Every child shows as a specialist row on the snapshot.
    expect(snapshot.specialists).toHaveLength(DEAL_INTELLIGENCE_CHILDREN.length);
  });

  it('refuses a second mission while one is in flight', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = launchDealIntelligenceMission({
      dealCardId: 32,
      capabilities: caps({
        collectors: collectors({ parcel_identity: async () => { await gate; return ok({ identity: CONFIRMED, facts: [], subjectMarket: {}, subjectAcres: 12.28, acreageConflict: false }); } }),
      }),
      ...RUN_OPTS,
    });
    expect(first.launch.alreadyRunning).toBe(false);

    const second = launchDealIntelligenceMission({ dealCardId: 32, capabilities: caps(), ...RUN_OPTS });
    expect(second.launch.alreadyRunning).toBe(true);
    expect(second.launch.missionId).toBe(first.launch.missionId);

    release();
    await first.completion;
  });

  it('a re-run becomes the current snapshot and the earlier run stays readable as history', async () => {
    const store = new PropertyIntelligenceStore();
    await runDealIntelligenceMission({ dealCardId: 32, capabilities: caps(), snapshotStore: store, ...RUN_OPTS });
    await runDealIntelligenceMission({ dealCardId: 32, capabilities: caps(), snapshotStore: store, ...RUN_OPTS });

    const history = store.history(32);
    expect(history).toHaveLength(2);
    expect(history[0].sequence).toBe(2);
    expect(history[0].isPrimary).toBe(true);
    // The earlier attempt is retained in full, simply no longer the current read.
    expect(history[1].sequence).toBe(1);
    expect(history[1].isPrimary).toBe(false);
    expect(history[1].snapshot).toBeTruthy();
    expect(store.primaryRun(32)!.sequence).toBe(2);
  });

  it('a FAILED re-run never overrides the current accepted snapshot', async () => {
    const store = new PropertyIntelligenceStore();
    await runDealIntelligenceMission({ dealCardId: 32, capabilities: caps(), snapshotStore: store, ...RUN_OPTS });
    const good = store.primaryRun(32)!;

    // Identity throws: the required root lane fails, so the parent mission fails.
    await runDealIntelligenceMission({
      dealCardId: 32,
      snapshotStore: store,
      capabilities: caps({ collectors: collectors({ parcel_identity: async () => { throw new Error('LandPortal unreachable'); } }) }),
      ...RUN_OPTS,
    });

    const primary = store.primaryRun(32)!;
    expect(primary.runId).toBe(good.runId);
    expect(primary.sequence).toBe(1);
    expect(primary.snapshot!.identity.apn).toBe('073090 04200');
    // The failed attempt is still recorded, with its reason.
    const latest = store.latestRun(32)!;
    expect(latest.sequence).toBe(2);
    expect(latest.status).toBe('failed');
    expect(latest.isPrimary).toBe(false);
    expect(latest.error).toBeTruthy();
  });

  it('records what the run did with the browser pages it opened', async () => {
    const store = new PropertyIntelligenceStore();
    const snapshot = await runDealIntelligenceMission({
      dealCardId: 32,
      capabilities: caps(),
      snapshotStore: store,
      browserCleanup: async () => ({ before: 4, after: 1, closed: 3, note: 'Closed 3 page(s) the workflow opened; 1 operator tab was left untouched.' }),
      ...RUN_OPTS,
    });
    expect(snapshot!.browserCleanup).toEqual({ before: 4, after: 1, closed: 3, note: expect.stringContaining('Closed 3 page(s)') });
    expect(store.primaryRun(32)!.snapshot!.browserCleanup!.closed).toBe(3);
    expect(snapshot!.missingInformation.join(' ')).toMatch(/Browser cleanup/);
  });

  it('states honestly when browser cleanup could not run', async () => {
    const snapshot = await runDealIntelligenceMission({
      dealCardId: 32,
      capabilities: caps(),
      browserCleanup: async () => { throw new Error('CDP disconnected'); },
      ...RUN_OPTS,
    });
    expect(snapshot!.browserCleanup!.note).toMatch(/could not run/i);
    expect(snapshot!.browserCleanup!.note).toMatch(/may still be open/i);
  });

  it('survives a restart: a fresh store reads the same current snapshot', async () => {
    await runDealIntelligenceMission({ dealCardId: 32, capabilities: caps(), ...RUN_OPTS });
    // A brand-new store instance is what a restarted process gets.
    resetPropertyIntelligenceStoreCache();
    resetMissionGraphStoreCache();
    const afterRestart = new PropertyIntelligenceStore();
    const missionsAfterRestart = new MissionGraphStore();

    const primary = afterRestart.primaryRun(32)!;
    expect(primary.snapshot!.identity.apn).toBe('073090 04200');
    expect(primary.snapshot!.strategies).toHaveLength(5);
    const mission = missionsAfterRestart.latestMission(DEAL_INTELLIGENCE_KIND, DEAL_INTELLIGENCE_SCOPE, 32)!;
    expect(mission.missionId).toBe(primary.runId);
    expect(missionsAfterRestart.listChildren(mission.missionId)).toHaveLength(DEAL_INTELLIGENCE_CHILDREN.length);
  });

  it('keeps two Deal Cards completely isolated', async () => {
    const store = new PropertyIntelligenceStore();
    const missionStore = new MissionGraphStore();
    await runDealIntelligenceMission({ dealCardId: 32, capabilities: caps(), snapshotStore: store, missionStore, ...RUN_OPTS });
    await runDealIntelligenceMission({
      dealCardId: 47,
      snapshotStore: store,
      missionStore,
      capabilities: caps({
        collectors: collectors({
          parcel_identity: async () => ok({
            identity: { ...CONFIRMED, apn: '999 111', county: 'Fayette', normalizedAddress: 'OTHER RD' },
            facts: [], subjectMarket: { state: 'TN', county: 'Fayette' }, subjectAcres: 5, acreageConflict: false,
          }),
        }),
      }),
      ...RUN_OPTS,
    });

    expect(store.primaryRun(32)!.snapshot!.identity.apn).toBe('073090 04200');
    expect(store.primaryRun(47)!.snapshot!.identity.apn).toBe('999 111');
    expect(store.history(32)).toHaveLength(1);
    expect(store.history(47)).toHaveLength(1);
    const m32 = missionStore.latestMission(DEAL_INTELLIGENCE_KIND, DEAL_INTELLIGENCE_SCOPE, 32)!;
    const m47 = missionStore.latestMission(DEAL_INTELLIGENCE_KIND, DEAL_INTELLIGENCE_SCOPE, 47)!;
    expect(m32.missionId).not.toBe(m47.missionId);
  });

  it('one blocked research lane does NOT cancel valuation or strategy', async () => {
    // The Phase 5 rule, end to end: zoning blocks, and the deal still prices and
    // still gets a five-strategy analysis, with the zoning gap disclosed.
    const store = new PropertyIntelligenceStore();
    await runDealIntelligenceMission({
      dealCardId: 32,
      snapshotStore: store,
      capabilities: caps({
        collectors: collectors({
          zoning_land_use: async () => ({
            status: 'blocked',
            summary: 'No zoning snapshot exists for this parcel yet.',
            data: { zoning: null, zoningKnown: false, items: [], facts: [] },
          }),
        }),
      }),
      ...RUN_OPTS,
    });

    const snapshot = store.primaryRun(32)!.snapshot!;
    expect(snapshot.strategies).toHaveLength(5);
    expect(snapshot.comps.sold.length + snapshot.comps.active.length).toBeGreaterThan(0);
    // The gap is stated, and it is stated as a zoning gap — not as a dead deal.
    const stated = [...snapshot.blockers, ...snapshot.missingInformation].join(' ');
    expect(stated).toMatch(/Zoning/i);
    expect(snapshot.status).not.toBe('failed');
  });

  it('an empty comp set is an honest INCOMPLETE answer, never a rejection', async () => {
    // A source that was reached and returned nothing has still delivered a real
    // result. Rejecting it would push the mission to invent comps it never found.
    const missionStore = new MissionGraphStore();
    await runDealIntelligenceMission({
      dealCardId: 32,
      missionStore,
      capabilities: caps({ collectors: collectors({ comparables: async () => ok({ candidates: [] as never, duplicatesMerged: 0 }) }) }),
      ...RUN_OPTS,
    });
    const mission = missionStore.latestMission(DEAL_INTELLIGENCE_KIND, DEAL_INTELLIGENCE_SCOPE, 32)!;
    const comps = missionStore.listChildren(mission.missionId).find((child) => child.key === 'comparables')!;
    expect(comps.status).toBe('partial');
    expect(comps.acceptance!.state).toBe('incomplete');
  });

  it('REJECTS comps pulled from a government record, and never joins them', async () => {
    // Phase 5 forbids assessor/recorder/deed verification on comparable
    // properties. The rule fails the lane rather than passing quietly.
    const store = new PropertyIntelligenceStore();
    const missionStore = new MissionGraphStore();
    await runDealIntelligenceMission({
      dealCardId: 32,
      snapshotStore: store,
      missionStore,
      capabilities: caps({
        collectors: collectors({
          comparables: async () => ok({
            candidates: [
              { provider: 'Roane County Assessor', lane: 'landportal', addressDesc: '100 Ridge Rd', state: 'TN', price: 60_000, priceKind: 'sold', saleOrListDate: '2026-01-10', acres: 10, pricePerAcre: 6_000, sourceUrl: null, compClass: 'vacant_land' },
            ] as never,
            duplicatesMerged: 0,
          }),
        }),
      }),
      ...RUN_OPTS,
    });
    const mission = missionStore.latestMission(DEAL_INTELLIGENCE_KIND, DEAL_INTELLIGENCE_SCOPE, 32)!;
    const comps = missionStore.listChildren(mission.missionId).find((child) => child.key === 'comparables')!;
    expect(comps.status).toBe('rejected');
    expect(comps.acceptance!.reason).toMatch(/Assessor/);

    const snapshot = store.primaryRun(32)!.snapshot!;
    // Nothing from the rejected lane is asserted.
    expect(snapshot.comps.sold).toHaveLength(0);
    expect(snapshot.comps.active).toHaveLength(0);
    expect(snapshot.valuation.priceable).toBe(false);
    expect(snapshot.blockers.join(' ')).toMatch(/Comparable sales/i);
    // The valuation and strategy lanes still RAN — a rejected comp lane changes
    // what can be concluded, it does not cancel the rest of the mission.
    expect(snapshot.strategies).toHaveLength(5);
  });
});
