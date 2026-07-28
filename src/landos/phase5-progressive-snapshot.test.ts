// Phase 5 regression: progressive (mid-flight) Deal Intelligence content.
//
// Contract under test (Agent 2's progressive lane):
//   • Each child settle persists a preliminary partial on the RUN row
//     (progress_json via PropertyIntelligenceStore.updateProgress), readable by
//     the poll without any reassembly or provider work.
//   • The preliminary content is NEVER promoted primary. Promotion happens only
//     at join, in completeRun, which also clears the progressive content.
//   • The final join overwrites the partial with the real snapshot.
//   • A failed child's absence stays VISIBLE in the preliminary content — never
//     papered over by the lanes that did land.

import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { launchDealIntelligenceMission, runDealIntelligenceMission } from './deal-intelligence-run.js';
import { type DealIntelligenceCapabilities } from './deal-intelligence-mission.js';
import { MissionGraphStore, resetMissionGraphStoreCache } from './mission-graph-store.js';
import { PropertyIntelligenceStore, resetPropertyIntelligenceStoreCache } from './property-intelligence-store.js';
import type { PropertyIntelligenceCollectors, SpecialistOutcome } from './property-intelligence-collector-types.js';
import type { SnapshotIdentity } from './property-intelligence-snapshot.js';

const CONFIRMED: SnapshotIdentity = {
  state: 'confirmed', normalizedAddress: 'OLD RIDGE RD', county: 'Roane', state_: 'TN',
  apn: '073090 04200', apnVariants: ['073090 04200'], owner: 'SACHAN DILEEP S', ownerMailing: null,
  situs: 'OLD RIDGE RD', acres: 12.28, acreageBasis: 'deeded', coordinates: null,
  hasParcelGeometry: false, sourceConfidence: 'high', conflicts: [], explanation: 'Confirmed against TN Comptroller.',
};

function ok<T>(data: T): SpecialistOutcome<T> {
  return { status: 'completed', summary: 'ok', data };
}

function collectors(overrides: Partial<PropertyIntelligenceCollectors> = {}): PropertyIntelligenceCollectors {
  return {
    parcel_identity: async () => ok({
      identity: CONFIRMED,
      facts: [], subjectMarket: { state: 'TN', county: 'Roane', acres: 12.28 }, subjectAcres: 12.28, acreageConflict: false,
    }),
    government_records: async () => ok({ records: [] }),
    zoning_land_use: async () => ok({ zoning: 'A-1', zoningKnown: true, items: [], facts: [] }),
    environmental_terrain: async () => ok({ items: [], constraints: [] }),
    access_utilities: async () => ok({ items: [], accessStatus: 'public_road_proximity' as const, utilitiesKnown: true, utilitiesSummary: '' }),
    comparables: async () => ok({
      candidates: [
        { provider: 'LandPortal visible', lane: 'landportal', addressDesc: '100 Ridge Rd', state: 'TN', price: 60_000, priceKind: 'sold', saleOrListDate: '2026-01-10', acres: 10, pricePerAcre: 6_000, sourceUrl: 'https://landportal.com/x', compClass: 'vacant_land' },
      ] as never,
      duplicatesMerged: 0,
    }),
    market_intelligence: async () => ok({ facts: [], summary: '' }),
    evidence_visuals: async () => ({ status: 'completed' as const, summary: 'ok', data: { evidence: [] }, evidence: [] }),
    ...overrides,
  };
}

interface Deferred { promise: Promise<void>; release: () => void }
function deferred(): Deferred {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

/** Capabilities whose slow supporting market lane is held open by a gate. */
function gatedCaps(gate: Promise<void>, overrides: Partial<DealIntelligenceCapabilities> = {}): DealIntelligenceCapabilities {
  return {
    collectors: collectors(),
    marketPulse: async () => {
      await gate;
      return { marketMatrix: null, marketPulse: null, facts: [], summary: 'no market read' };
    },
    ...overrides,
  };
}

function plainCaps(overrides: Partial<DealIntelligenceCapabilities> = {}): DealIntelligenceCapabilities {
  return gatedCaps(Promise.resolve(), overrides);
}

const RUN_OPTS = { timeoutMsOverride: 10_000, joinPollMs: 5, joinDeadlineMs: 8_000 };

async function pollUntil<T>(read: () => T | null | undefined, describe_: string, timeoutMs = 5_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for: ${describe_}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeEach(() => {
  _initTestLandosDb();
  resetMissionGraphStoreCache();
  resetPropertyIntelligenceStoreCache();
});

describe('progressive snapshot: per-child settle persists preliminary content', () => {
  it('settled lanes appear on the RUN row while the mission is still running', async () => {
    const snapshotStore = new PropertyIntelligenceStore();
    const missionStore = new MissionGraphStore();
    const gate = deferred();

    const { launch, completion } = launchDealIntelligenceMission({
      dealCardId: 71, capabilities: gatedCaps(gate.promise), missionStore, snapshotStore, ...RUN_OPTS,
    });

    // Wait until comparables has settled while the projection is still gated.
    // Read through a FRESH store instance — the poll path, not the writer.
    const progress = await pollUntil(() => {
      const row = new PropertyIntelligenceStore().activeRun(71);
      return row?.progress?.settled.includes('comparables') ? row.progress : null;
    }, 'comparables settled in progressive content');

    expect(progress.preliminary).toBe(true);
    expect(progress.runId).toBe(launch.runId);
    expect(progress.settled).toContain('parcel_identity');
    expect(progress.settled).toContain('comparables');
    // The gated supporting lane is honestly OUTSTANDING, not settled.
    expect(progress.outstanding).toContain('market_intelligence');
    // Real content from the settled lanes is already present…
    expect(progress.snapshot.identity.apn).toBe('073090 04200');
    // …and the partial is marked for exactly what it is.
    expect(progress.snapshot.preliminary).toBe(true);
    expect(progress.snapshot.isPrimary).toBe(false);
    // The run itself still reads as running with no completion timestamp.
    const row = new PropertyIntelligenceStore().activeRun(71)!;
    expect(row.status).toBe('running');
    expect(row.completedAt).toBeNull();

    gate.release();
    await completion;
  });

  it('preliminary content is NEVER promoted primary while the run is in flight', async () => {
    const snapshotStore = new PropertyIntelligenceStore();
    const gate = deferred();
    const { completion } = launchDealIntelligenceMission({
      dealCardId: 72, capabilities: gatedCaps(gate.promise), snapshotStore, ...RUN_OPTS,
    });

    await pollUntil(() => {
      const row = new PropertyIntelligenceStore().activeRun(72);
      return row?.progress ? row : null;
    }, 'progressive content persisted');

    // Progressive content exists, but NOTHING is primary and no snapshot is stored.
    const fresh = new PropertyIntelligenceStore();
    expect(fresh.primaryRun(72)).toBeNull();
    expect(fresh.activeRun(72)!.snapshot).toBeNull();
    expect(fresh.activeRun(72)!.isPrimary).toBe(false);

    gate.release();
    await completion;
  });

  it('a running re-run keeps the PRIOR snapshot as the current read', async () => {
    const snapshotStore = new PropertyIntelligenceStore();
    await runDealIntelligenceMission({ dealCardId: 73, capabilities: plainCaps(), snapshotStore, ...RUN_OPTS });
    const v1 = snapshotStore.primaryRun(73)!;

    const gate = deferred();
    const second = launchDealIntelligenceMission({
      dealCardId: 73, capabilities: gatedCaps(gate.promise), snapshotStore, ...RUN_OPTS,
    });
    await pollUntil(() => {
      const row = new PropertyIntelligenceStore().activeRun(73);
      return row?.progress ? row : null;
    }, 'second run progressive content');

    // Mid-flight partial exists on run 2; run 1 is STILL the promoted read.
    expect(new PropertyIntelligenceStore().primaryRun(73)!.runId).toBe(v1.runId);

    gate.release();
    await second.completion;
    // Only at join does promotion move.
    expect(new PropertyIntelligenceStore().primaryRun(73)!.runId).toBe(second.launch.runId);
  });

  it('the final join OVERWRITES the partial with the real snapshot and clears progress', async () => {
    const snapshotStore = new PropertyIntelligenceStore();
    const gate = deferred();
    const { launch, completion } = launchDealIntelligenceMission({
      dealCardId: 74, capabilities: gatedCaps(gate.promise), snapshotStore, ...RUN_OPTS,
    });
    await pollUntil(() => {
      const row = new PropertyIntelligenceStore().activeRun(74);
      return row?.progress ? row : null;
    }, 'progressive content before join');

    gate.release();
    const snapshot = await completion;
    expect(snapshot).toBeTruthy();

    const finished = new PropertyIntelligenceStore().getRun(launch.runId)!;
    // The real snapshot is stored and promoted; the mid-flight partial is gone,
    // so a finished run can never serve stale preliminary data.
    expect(finished.snapshot).toBeTruthy();
    expect(finished.snapshot!.identity.apn).toBe('073090 04200');
    expect(finished.isPrimary).toBe(true);
    expect(finished.progress).toBeNull();
    expect(finished.completedAt).not.toBeNull();
  });

  it('a FAILED child stays visible in the preliminary content — never papered over', async () => {
    const snapshotStore = new PropertyIntelligenceStore();
    const gate = deferred();
    const { completion } = launchDealIntelligenceMission({
      dealCardId: 75,
      capabilities: gatedCaps(gate.promise, {
        collectors: collectors({ comparables: async () => { throw new Error('comp provider unreachable'); } }),
      }),
      snapshotStore,
      ...RUN_OPTS,
    });

    const progress = await pollUntil(() => {
      const row = new PropertyIntelligenceStore().activeRun(75);
      return row?.progress?.settled.includes('comparables') ? row.progress : null;
    }, 'failed comparables settled in progressive content');

    // The failed lane is settled (terminal), and the partial DISCLOSES the gap.
    const specialists = progress.snapshot.specialists;
    const comps = specialists.find((row) => row.id === 'comparables')!;
    expect(comps.status).toBe('failed');
    const disclosed = [...progress.snapshot.blockers, ...progress.snapshot.missingInformation].join(' ');
    expect(disclosed).toMatch(/comparable/i);
    // Nothing is asserted FROM the failed lane.
    expect(progress.snapshot.comps.sold).toHaveLength(0);
    expect(progress.snapshot.comps.active).toHaveLength(0);
    // And the still-gated projection lane is reported as outstanding, with no
    // terminal "did not report" wording for a lane that is merely in flight.
    expect(progress.outstanding).toContain('market_intelligence');
    for (const line of progress.snapshot.missingInformation) {
      if (line.includes('Deal Card projection')) {
        expect(line).not.toMatch(/did not report a result/);
      }
    }

    gate.release();
    await completion;
  });
});
