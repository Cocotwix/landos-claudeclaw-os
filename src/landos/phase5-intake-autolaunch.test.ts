// Phase 5 regression: the intake auto-launch contract.
//
// POST /api/landos/leads/manual auto-launches ONE deal_intelligence mission per
// new lead, fire-and-forget, idempotent. This file exercises the REAL intake
// entrypoint (autoLaunchDealIntelligenceForIntake) with fake capabilities,
// injected lifecycle hooks, and real stores on the in-memory test DB. The
// idempotency guards live in launchDealIntelligenceMission (missionStore.
// activeMission + snapshotStore.activeRun); the helper hides `completion`
// (production is fire-and-forget), so the harness derives completion from the
// terminal research-status hook the helper is contracted to fire on settle.

import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { autoLaunchDealIntelligenceForIntake, INTAKE_TRIGGER } from './deal-intelligence-intake.js';
import { launchDealIntelligenceMission } from './deal-intelligence-run.js';
import {
  DEAL_INTELLIGENCE_KIND,
  DEAL_INTELLIGENCE_SCOPE,
  type DealIntelligenceCapabilities,
} from './deal-intelligence-mission.js';
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
      capabilityResolution: 'RESOLVED', capabilityInvocationId: 'cap-test',
      identity: CONFIRMED,
      facts: [], subjectMarket: { state: 'TN', county: 'Roane', acres: 12.28 }, subjectAcres: 12.28, acreageConflict: false,
    }),
    government_records: async () => ok({ records: [] }),
    zoning_land_use: async () => ok({ zoning: 'A-1', zoningKnown: true, items: [], facts: [] }),
    environmental_terrain: async () => ok({ items: [], constraints: [] }),
    access_utilities: async () => ok({ items: [], accessStatus: 'public_road_proximity' as const, utilitiesKnown: true, utilitiesSummary: '' }),
    comparables: async () => ok({ candidates: [] as never, duplicatesMerged: 0 }),
    market_intelligence: async () => ok({ facts: [], summary: '' }),
    evidence_visuals: async () => ({ status: 'completed' as const, summary: 'ok', data: { evidence: [] }, evidence: [] }),
    ...overrides,
  };
}

function caps(overrides: Partial<DealIntelligenceCapabilities> = {}): DealIntelligenceCapabilities {
  return {
    collectors: collectors(),
    marketPulse: async () => ({ marketMatrix: null, marketPulse: null, facts: [], summary: 'no market read' }),
    ...overrides,
  };
}

const RUN_OPTS = { timeoutMsOverride: 10_000, joinPollMs: 5, joinDeadlineMs: 5_000 };

/**
 * The REAL intake auto-launch, wrapped only to recover a `completion` promise:
 * production is fire-and-forget, so settle is observed through the injected
 * research-status lifecycle hook, which the helper is contracted to call with a
 * terminal status exactly once per launched mission.
 */
function autoLaunchForNewLead(
  dealCardId: number,
  stores: { missionStore: MissionGraphStore; snapshotStore: PropertyIntelligenceStore },
  capabilities = caps(),
) {
  let settle: () => void = () => {};
  const settled = new Promise<void>((resolve) => { settle = resolve; });
  const launch = autoLaunchDealIntelligenceForIntake({
    dealCardId,
    opportunityId: 9000 + dealCardId,
    capabilities,
    missionStore: stores.missionStore,
    snapshotStore: stores.snapshotStore,
    hooks: {
      research: (_opportunityId, status) => { if (status !== 'running') settle(); },
      discoveryBrief: () => {},
    },
    ...RUN_OPTS,
  });
  if (!launch) throw new Error('intake auto-launch returned null for a valid lead');
  return {
    launch,
    completion: launch.alreadyRunning
      ? Promise.resolve(null)
      : settled.then(() => stores.snapshotStore.primaryRun(dealCardId)?.snapshot ?? null),
  };
}

beforeEach(() => {
  _initTestLandosDb();
  resetMissionGraphStoreCache();
  resetPropertyIntelligenceStoreCache();
});

describe('intake auto-launch: one lead, one mission', () => {
  it('one valid intake produces EXACTLY one active mission and one active run', async () => {
    const missionStore = new MissionGraphStore();
    const snapshotStore = new PropertyIntelligenceStore();

    const { launch, completion } = autoLaunchForNewLead(61, { missionStore, snapshotStore });
    expect(launch.alreadyRunning).toBe(false);
    expect(launch.dealCardId).toBe(61);
    // Mission id and snapshot run id are the SAME id.
    expect(launch.runId).toBe(launch.missionId);

    await completion;
    const missions = missionStore.listMissions(DEAL_INTELLIGENCE_KIND, DEAL_INTELLIGENCE_SCOPE, 61);
    expect(missions).toHaveLength(1);
    expect(missions[0]!.trigger).toBe(INTAKE_TRIGGER);
    expect(snapshotStore.history(61)).toHaveLength(1);
    expect(snapshotStore.primaryRun(61)!.runId).toBe(launch.runId);
  });

  it('is fire-and-forget: launch returns while the mission is still running', async () => {
    const missionStore = new MissionGraphStore();
    const snapshotStore = new PropertyIntelligenceStore();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const first = autoLaunchForNewLead(
      62,
      { missionStore, snapshotStore },
      caps({
        collectors: collectors({
          parcel_identity: async () => {
            await gate;
            return ok({ capabilityResolution: 'RESOLVED', capabilityInvocationId: 'cap-test', identity: CONFIRMED, facts: [], subjectMarket: {}, subjectAcres: 12.28, acreageConflict: false });
          },
        }),
      }),
    );
    // The launch result exists NOW, while the root lane is still gated: the
    // route can answer the intake request without awaiting research.
    expect(first.launch.missionId).toBeTruthy();
    expect(missionStore.activeMission(DEAL_INTELLIGENCE_KIND, DEAL_INTELLIGENCE_SCOPE, 62)).toBeTruthy();
    expect(snapshotStore.activeRun(62)).toBeTruthy();

    release();
    await first.completion;
  });

  it('a duplicate submission while the mission is active starts NO second mission', async () => {
    const missionStore = new MissionGraphStore();
    const snapshotStore = new PropertyIntelligenceStore();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const first = autoLaunchForNewLead(
      63,
      { missionStore, snapshotStore },
      caps({
        collectors: collectors({
          parcel_identity: async () => {
            await gate;
            return ok({ capabilityResolution: 'RESOLVED', capabilityInvocationId: 'cap-test', identity: CONFIRMED, facts: [], subjectMarket: {}, subjectAcres: 12.28, acreageConflict: false });
          },
        }),
      }),
    );
    expect(first.launch.alreadyRunning).toBe(false);

    // The user double-submits the same lead (or the form retries).
    const second = autoLaunchForNewLead(63, { missionStore, snapshotStore });
    expect(second.launch.alreadyRunning).toBe(true);
    expect(second.launch.missionId).toBe(first.launch.missionId);
    // The duplicate returned the EXISTING mission and wrote nothing new.
    expect(missionStore.listMissions(DEAL_INTELLIGENCE_KIND, DEAL_INTELLIGENCE_SCOPE, 63)).toHaveLength(1);
    expect(snapshotStore.history(63)).toHaveLength(1);
    expect(await second.completion).toBeNull();

    release();
    await first.completion;
    // Still exactly one mission and one run after everything settles.
    expect(missionStore.listMissions(DEAL_INTELLIGENCE_KIND, DEAL_INTELLIGENCE_SCOPE, 63)).toHaveLength(1);
    expect(snapshotStore.history(63)).toHaveLength(1);
  });

  it('two DIFFERENT leads each get their own mission — the guard is per Deal Card', async () => {
    const missionStore = new MissionGraphStore();
    const snapshotStore = new PropertyIntelligenceStore();
    const a = autoLaunchForNewLead(64, { missionStore, snapshotStore });
    const b = autoLaunchForNewLead(65, { missionStore, snapshotStore });
    expect(a.launch.alreadyRunning).toBe(false);
    expect(b.launch.alreadyRunning).toBe(false);
    expect(a.launch.missionId).not.toBe(b.launch.missionId);
    await Promise.all([a.completion, b.completion]);
    expect(missionStore.listMissions(DEAL_INTELLIGENCE_KIND, DEAL_INTELLIGENCE_SCOPE, 64)).toHaveLength(1);
    expect(missionStore.listMissions(DEAL_INTELLIGENCE_KIND, DEAL_INTELLIGENCE_SCOPE, 65)).toHaveLength(1);
  });

  it('a manual re-run is still available AFTER the auto-launched mission completes', async () => {
    const missionStore = new MissionGraphStore();
    const snapshotStore = new PropertyIntelligenceStore();
    const first = autoLaunchForNewLead(66, { missionStore, snapshotStore });
    await first.completion;

    // The operator presses Run Property Intelligence later: a NEW sequence.
    const rerun = launchDealIntelligenceMission({
      dealCardId: 66,
      trigger: 'operator',
      capabilities: caps(),
      missionStore,
      snapshotStore,
      ...RUN_OPTS,
    });
    expect(rerun.launch.alreadyRunning).toBe(false);
    expect(rerun.launch.missionId).not.toBe(first.launch.missionId);
    expect(rerun.launch.sequence).toBe(2);
    await rerun.completion;
    expect(missionStore.listMissions(DEAL_INTELLIGENCE_KIND, DEAL_INTELLIGENCE_SCOPE, 66)).toHaveLength(2);
    // The re-run becomes the current snapshot; the auto-launched one stays history.
    expect(snapshotStore.primaryRun(66)!.runId).toBe(rerun.launch.runId);
    expect(snapshotStore.history(66)).toHaveLength(2);
  });

  it('the active-RUN guard alone refuses a duplicate even if the mission row is gone', async () => {
    // The guard is a belt-and-braces pair: missionStore.activeMission OR
    // snapshotStore.activeRun. Simulate the run row alone being active.
    const missionStore = new MissionGraphStore();
    const snapshotStore = new PropertyIntelligenceStore();
    snapshotStore.createRun({
      runId: 'di_orphan_run',
      dealCardId: 67,
      trigger: 'lead_intake',
      startedAt: new Date().toISOString(),
      specialists: [],
    });

    const dup = autoLaunchForNewLead(67, { missionStore, snapshotStore });
    expect(dup.launch.alreadyRunning).toBe(true);
    expect(dup.launch.runId).toBe('di_orphan_run');
    expect(await dup.completion).toBeNull();
    expect(missionStore.listMissions(DEAL_INTELLIGENCE_KIND, DEAL_INTELLIGENCE_SCOPE, 67)).toHaveLength(0);
  });
});
