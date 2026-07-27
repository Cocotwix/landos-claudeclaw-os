// Items 15 + 16 end to end through the runner and the durable store.
//
// Item 15: every child carries its parent, group, assigned role, specialist agent
//          identity, provider assignment and the contribution slot its handback
//          belongs to — and all of it survives a fresh store read.
// Item 16: a child that exits successfully but delivers an unacceptable result
//          does NOT pass, and the parent never reports full success over it.

import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import { MissionGraphStore, resetMissionGraphStoreCache } from './mission-graph-store.js';
import {
  launchFanOutMission,
  readFanOutMission,
  type FanOutMissionDefinition,
  type MissionChildExecutor,
} from './mission-graph-runner.js';
import { resetPropertyIntelligenceStoreCache } from './property-intelligence-store.js';
import { normalizeStoredMissionJoin, planMissionWaves, type MissionChildSpec, type MissionJoin } from './mission-graph.js';
import { scopeIntegrityCheck } from './mission-acceptance.js';

const CHILDREN: MissionChildSpec[] = [
  {
    key: 'identity',
    label: 'Identity',
    purpose: 'root lane',
    role: 'required',
    dependsOn: [],
    timeoutMs: 5_000,
    group: 'subject_identity',
    assignedRole: 'Subject parcel identity of record',
    agentKey: 'dd_bot',
    contributionSlot: 'subject_identity',
    provider: { mode: 'deterministic', rationale: 'Reads accepted LandOS records.' },
    acceptance: { requiredFields: ['apn'], checks: [scopeIntegrityCheck('dealCardId')] },
  },
  {
    key: 'context',
    label: 'Context',
    purpose: 'needs identity',
    role: 'required',
    dependsOn: ['identity'],
    timeoutMs: 5_000,
    group: 'deal_intelligence',
    assignedRole: 'Deal Card context rollup',
    agentKey: 'success_bot',
    contributionSlot: 'deal_context',
    provider: { mode: 'deterministic', rationale: 'Reads accepted LandOS records.' },
    acceptance: { requiredFields: ['propertyCount'], expectedFields: ['comps'] },
  },
  {
    key: 'market',
    label: 'Market',
    purpose: 'needs identity',
    role: 'supporting',
    dependsOn: ['identity'],
    timeoutMs: 5_000,
    group: 'deal_intelligence',
    assignedRole: 'County market reference coverage',
    agentKey: 'market_bot',
    contributionSlot: 'market_coverage',
    provider: { mode: 'deterministic', rationale: 'Reads seeded reference rows.' },
    acceptance: { requiredFields: ['fips'] },
  },
];

function definition(executors: Partial<Record<string, MissionChildExecutor>> = {}): FanOutMissionDefinition {
  return {
    kind: 'identity_fanout',
    label: 'Identity fan-out',
    scope: 'deal_card',
    children: CHILDREN,
    executors: {
      identity: async () => ({ status: 'completed', summary: 'identity ok', result: { apn: '073090 04200', dealCardId: 32 } }),
      context: async () => ({ status: 'completed', summary: 'context ok', result: { propertyCount: 1, comps: 3 } }),
      market: async () => ({ status: 'completed', summary: 'market ok', result: { fips: '47145' } }),
      ...executors,
    } as Record<string, MissionChildExecutor>,
  };
}

beforeEach(() => {
  _initTestLandosDb();
  resetMissionGraphStoreCache();
  resetPropertyIntelligenceStoreCache();
});

// ── Item 15 ─────────────────────────────────────────────────────────────────

describe('every child carries its identity, role, agent and provider assignment', () => {
  it('records parent, group, assigned role, specialist agent and contribution slot', async () => {
    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({ definition: definition(), scopeId: 32, store });
    await completion;

    const children = store.listChildren(launch.missionId);
    const identity = children.find((child) => child.key === 'identity')!;
    expect(identity.identity.missionId).toBe(launch.missionId);
    expect(identity.identity.group).toBe('subject_identity');
    expect(identity.identity.assignedRole).toBe('Subject parcel identity of record');
    expect(identity.identity.agentKey).toBe('dd_bot');
    // The specialist identity is resolved from the roster, not re-typed by hand.
    expect(identity.identity.agentName).toBe('Property Research Agent');
    expect(identity.identity.agentGroup).toBe('acquisitions');
    expect(identity.identity.implAgentId).toBe('duke-due-diligence');
    expect(identity.identity.contributionSlot).toBe('subject_identity');

    // A real group holds more than one lane.
    const grouped = children.filter((child) => child.identity.group === 'deal_intelligence').map((child) => child.key);
    expect(grouped.sort()).toEqual(['context', 'market']);
  });

  it('carries the identity BEFORE the lanes run, not only after they settle', () => {
    const store = new MissionGraphStore();
    const { launch } = launchFanOutMission({
      definition: definition({ identity: async () => new Promise(() => ({ status: 'completed', summary: 'never', result: {} })) }),
      scopeId: 32,
      store,
      joinDeadlineMs: 10,
      joinPollMs: 5,
    });
    const queued = store.listChildren(launch.missionId).find((child) => child.key === 'market')!;
    expect(queued.status).toBe('queued');
    expect(queued.identity.agentName).toBe('Market Research Agent');
    expect(queued.identity.contributionSlot).toBe('market_coverage');
  });

  it('persists identity and the provider assignment across a fresh store instance', async () => {
    const first = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({ definition: definition(), scopeId: 32, store: first });
    await completion;

    resetMissionGraphStoreCache();
    const reread = readFanOutMission(definition(), 32, new MissionGraphStore());
    const market = reread.children.find((child) => child.key === 'market')!;
    expect(market.identity.agentKey).toBe('market_bot');
    expect(market.identity.contributionSlot).toBe('market_coverage');
    expect(market.provider).not.toBeNull();
    expect(market.provider!.mode).toBe('deterministic');
    // A deterministic lane must never claim a provider or imply spend.
    expect(market.provider!.providerId).toBeNull();
    expect(market.provider!.reason).toMatch(/no credit is spent/i);
    expect(reread.mission!.missionId).toBe(launch.missionId);
  });
});

describe('handbacks are routed to the correct parent contribution', () => {
  it('places every accepted handback in its DECLARED slot, not its child key', async () => {
    const store = new MissionGraphStore();
    const { completion } = launchFanOutMission({ definition: definition(), scopeId: 32, store });
    const join = await completion;

    expect(Object.keys(join!.contributionsBySlot).sort()).toEqual(['deal_context', 'market_coverage', 'subject_identity']);
    expect(join!.contributionsBySlot.subject_identity).toMatchObject({ apn: '073090 04200' });
    expect(join!.contributionsBySlot.market_coverage).toMatchObject({ fips: '47145' });
    // The by-child map stays available for the existing surface.
    expect(join!.contributions.identity).toMatchObject({ apn: '073090 04200' });
  });

  it('records who routed what, where it went, and its acceptance state', async () => {
    const store = new MissionGraphStore();
    const { completion } = launchFanOutMission({ definition: definition(), scopeId: 32, store });
    const join = await completion;

    const route = join!.routing.find((entry) => entry.childKey === 'identity')!;
    expect(route).toMatchObject({
      slot: 'subject_identity',
      group: 'subject_identity',
      agentKey: 'dd_bot',
      agentName: 'Property Research Agent',
      assignedRole: 'Subject parcel identity of record',
      acceptanceState: 'accepted',
      routed: true,
    });
    expect(join!.routing).toHaveLength(3);
    expect(join!.routing.every((entry) => entry.routed)).toBe(true);
  });

  it('refuses a definition where two children claim the same contribution slot', () => {
    const clashing: MissionChildSpec[] = [
      { ...CHILDREN[0], key: 'a', dependsOn: [], contributionSlot: 'shared' },
      { ...CHILDREN[1], key: 'b', dependsOn: [], contributionSlot: 'shared' },
    ];
    expect(() => planMissionWaves(clashing)).toThrow(/both route their handback to contribution slot "shared"/);
  });

  it('refuses a child assigned to a specialist agent that does not exist', () => {
    expect(() => planMissionWaves([{ ...CHILDREN[0], agentKey: 'ghost_bot' }])).toThrow(
      /unknown specialist agent "ghost_bot"/,
    );
  });
});

// ── Item 16 ─────────────────────────────────────────────────────────────────

describe('a child that exits successfully but delivers an unacceptable result does not pass', () => {
  it('REJECTS a clean exit with no handback and refuses to join it', async () => {
    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({
      definition: definition({
        // Exits cleanly, reports success, hands back nothing.
        identity: async () => ({ status: 'completed', summary: 'all good!', result: null }),
      }),
      scopeId: 32,
      store,
    });
    const join = await completion;

    const identity = store.listChildren(launch.missionId).find((child) => child.key === 'identity')!;
    expect(identity.status).toBe('rejected');
    expect(identity.acceptance!.state).toBe('rejected');
    expect(identity.failureCategory).toBe('unacceptable_result');

    // It contributed nothing, and the parent did not report success.
    expect(join!.contributed).not.toContain('identity');
    expect(join!.contributionsBySlot.subject_identity).toBeUndefined();
    expect(join!.accepted).not.toContain('identity');
    expect(join!.status).toBe('failed');
    expect(join!.allRequiredAccepted).toBe(false);
    expect(join!.routing.find((entry) => entry.childKey === 'identity')!.routed).toBe(false);
  });

  it('REJECTS a result that is missing a required term and names the term', async () => {
    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({
      definition: definition({
        identity: async () => ({ status: 'completed', summary: 'identity ok', result: { dealCardId: 32, owner: 'SACHAN DILEEP S' } }),
      }),
      scopeId: 32,
      store,
    });
    const join = await completion;

    const identity = store.listChildren(launch.missionId).find((child) => child.key === 'identity')!;
    expect(identity.status).toBe('rejected');
    expect(identity.acceptance!.reason).toMatch(/apn/);
    expect(identity.acceptance!.checks.find((check) => check.id === 'field:apn')!.passed).toBe(false);
    expect(join!.status).toBe('failed');
  });

  it('REJECTS a handback belonging to a different Deal Card', async () => {
    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({
      definition: definition({
        identity: async () => ({ status: 'completed', summary: 'identity ok', result: { apn: '1', dealCardId: 47 } }),
      }),
      scopeId: 32,
      store,
    });
    await completion;
    const identity = store.listChildren(launch.missionId).find((child) => child.key === 'identity')!;
    expect(identity.status).toBe('rejected');
    expect(identity.acceptance!.reason).toMatch(/Scope mismatch/i);
  });

  it('states a rejection SEPARATELY from an execution failure in the parent outcome', async () => {
    const rejected = await launchFanOutMission({
      definition: definition({ identity: async () => ({ status: 'completed', summary: 'fine', result: null }) }),
      scopeId: 32,
      store: new MissionGraphStore(),
    }).completion;

    const threw = await launchFanOutMission({
      definition: definition({ identity: async () => { throw new Error('provider exploded'); } }),
      scopeId: 33,
      store: new MissionGraphStore(),
    }).completion;

    expect(rejected!.status).toBe('failed');
    expect(threw!.status).toBe('failed');
    expect(rejected!.outcome).toMatch(/returned a result that did NOT meet their acceptance requirement/i);
    expect(rejected!.outcome).not.toMatch(/failed to execute/i);
    expect(threw!.outcome).toMatch(/failed to execute/i);
    expect(threw!.outcome).not.toMatch(/did NOT meet their acceptance requirement/i);
  });

  it('keeps a precise blocker distinguishable from both', async () => {
    const join = await launchFanOutMission({
      definition: definition({
        identity: async () => ({ status: 'blocked', summary: 'No subject property card is linked to this Deal Card.' }),
      }),
      scopeId: 32,
      store: new MissionGraphStore(),
    }).completion;

    expect(join!.status).toBe('blocked');
    expect(join!.outcome).toMatch(/coverage or input gap/i);
    expect(join!.gaps.find((gap) => gap.key === 'identity')!.acceptanceState).toBe('blocked');
  });

  it('skips the dependants of a rejected lane instead of failing them', async () => {
    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({
      definition: definition({ identity: async () => ({ status: 'completed', summary: 'fine', result: null }) }),
      scopeId: 32,
      store,
    });
    await completion;
    const children = store.listChildren(launch.missionId);
    expect(children.find((child) => child.key === 'context')!.status).toBe('skipped');
    expect(children.find((child) => child.key === 'market')!.status).toBe('skipped');
  });
});

describe('the parent never presents an incomplete result as a full one', () => {
  it('marks a lane missing an expected term INCOMPLETE, still contributing', async () => {
    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({
      definition: definition({
        // Required term present, expected term absent.
        context: async () => ({ status: 'completed', summary: 'context ok', result: { propertyCount: 1 } }),
      }),
      scopeId: 32,
      store,
    });
    const join = await completion;

    const context = store.listChildren(launch.missionId).find((child) => child.key === 'context')!;
    expect(context.status).toBe('partial');
    expect(context.acceptance!.state).toBe('incomplete');
    expect(join!.contributed).toContain('context');
    expect(join!.incomplete).toContain('context');
    expect(join!.accepted).not.toContain('context');
    expect(join!.allRequiredAccepted).toBe(false);
    // The outcome always states acceptance, so "joined" cannot be misread.
    expect(join!.outcome).toMatch(/Acceptance: 2 accepted, 1 incomplete \(context\)/);
  });

  it('reports allRequiredAccepted only when every required lane was accepted', async () => {
    const join = await launchFanOutMission({
      definition: definition(),
      scopeId: 32,
      store: new MissionGraphStore(),
    }).completion;
    expect(join!.status).toBe('joined');
    expect(join!.accepted.sort()).toEqual(['context', 'identity', 'market']);
    expect(join!.allRequiredAccepted).toBe(true);
    expect(join!.outcome).toMatch(/Acceptance: 3 accepted\./);
  });

  it('does not report full success when a SUPPORTING handback is rejected', async () => {
    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({
      definition: definition({ market: async () => ({ status: 'completed', summary: 'fine', result: {} }) }),
      scopeId: 32,
      store,
    });
    const join = await completion;

    expect(store.listChildren(launch.missionId).find((child) => child.key === 'market')!.status).toBe('rejected');
    // A supporting rejection does not fail the mission, but it is never `joined`.
    expect(join!.status).toBe('joined_with_gaps');
    expect(join!.gaps.map((gap) => gap.key)).toContain('market');
  });
});

describe('acceptance verdicts persist for the operator', () => {
  it('keeps the failed requirement readable after a fresh store read', async () => {
    const first = new MissionGraphStore();
    await launchFanOutMission({
      definition: definition({ identity: async () => ({ status: 'completed', summary: 'fine', result: { dealCardId: 32 } }) }),
      scopeId: 32,
      store: first,
    }).completion;

    resetMissionGraphStoreCache();
    const view = readFanOutMission(definition(), 32, new MissionGraphStore());
    const identity = view.children.find((child) => child.key === 'identity')!;
    expect(identity.status).toBe('rejected');
    expect(identity.acceptance!.state).toBe('rejected');
    expect(identity.acceptance!.checks.some((check) => !check.passed)).toBe(true);
    expect(view.mission!.status).toBe('failed');
  });

  // A mission stored BEFORE the identity layer existed carries none of these
  // columns. It must still read with its declared identity, must keep its
  // recorded result, and must never be presented as though it had been accepted.
  it('reads a pre-existing row with the DECLARED slot, not a fabricated fallback', async () => {
    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({ definition: definition(), scopeId: 32, store });
    await completion;

    // Blank every identity/acceptance/provider column, as a legacy row has them.
    getLandosDb()
      .prepare(
        `UPDATE landos_mission_child
         SET group_key = NULL, assigned_role = NULL, agent_key = NULL, agent_name = NULL,
             agent_group = NULL, agent_role = NULL, impl_agent_id = NULL,
             contribution_slot = NULL, acceptance_json = NULL, provider_json = NULL
         WHERE mission_id = ?`,
      )
      .run(launch.missionId);

    resetMissionGraphStoreCache();
    const view = readFanOutMission(definition(), 32, new MissionGraphStore());
    const identity = view.children.find((child) => child.key === 'identity')!;

    // The declared slot wins over the child key.
    expect(identity.identity.contributionSlot).toBe('subject_identity');
    expect(identity.identity.group).toBe('subject_identity');
    expect(identity.identity.agentName).toBe('Property Research Agent');
    // The recorded result is untouched...
    expect(identity.status).toBe('completed');
    expect(identity.result).toMatchObject({ apn: '073090 04200' });
    // ...but an unevaluated result is never presented as accepted.
    expect(identity.acceptance!.state).toBe('not_evaluated');
    expect(identity.provider).toBeNull();
  });

  // REGRESSION: a mission JOINED before these fields existed has a stored join
  // with no routing/accepted/incomplete/contributionsBySlot. Handing that back raw
  // gave readers a MissionJoin whose declared arrays were undefined, which threw
  // during render and blanked the operator's mission panel for every pre-existing
  // mission. Every read path must return the full shape.
  it('normalizes a join STORED before the acceptance fields existed', async () => {
    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({ definition: definition(), scopeId: 32, store });
    await completion;

    // Rewrite the stored join to the OLD shape, exactly as Item 14 wrote it.
    const stored = store.getMission(launch.missionId)!.join!;
    const legacy = {
      status: stored.status,
      contributions: stored.contributions,
      contributed: stored.contributed,
      gaps: [],
      requiredGaps: [],
      outstanding: [],
      allTerminal: true,
      allRequiredTerminal: true,
      outcome: stored.outcome,
    };
    getLandosDb()
      .prepare('UPDATE landos_mission SET join_json = ? WHERE mission_id = ?')
      .run(JSON.stringify(legacy), launch.missionId);

    resetMissionGraphStoreCache();
    const view = readFanOutMission(definition(), 32, new MissionGraphStore());
    const join = view.join!;

    // Every declared field is present and safe to read.
    expect(Array.isArray(join.routing)).toBe(true);
    expect(Array.isArray(join.accepted)).toBe(true);
    expect(Array.isArray(join.incomplete)).toBe(true);
    expect(join.contributionsBySlot).toBeDefined();

    // Routing is rebuilt from the definition, so slots still display.
    expect(join.routing).toHaveLength(3);
    expect(join.routing.find((route) => route.childKey === 'identity')!.slot).toBe('subject_identity');
    expect(Object.keys(join.contributionsBySlot).sort()).toEqual(['deal_context', 'market_coverage', 'subject_identity']);

    // Acceptance is NEVER reconstructed: unevaluated is not accepted.
    expect(join.accepted).toEqual([]);
    expect(join.allRequiredAccepted).toBe(false);
    expect(join.routing.every((route) => route.acceptanceState === 'not_evaluated')).toBe(true);
    // The original parent status is untouched.
    expect(join.status).toBe('joined');
  });

  it('leaves an already-complete join untouched', () => {
    const complete = {
      status: 'joined',
      contributions: { a: 1 },
      contributionsBySlot: { slot_a: 1 },
      routing: [],
      contributed: ['a'],
      accepted: ['a'],
      incomplete: [],
      gaps: [],
      requiredGaps: [],
      outstanding: [],
      allTerminal: true,
      allRequiredTerminal: true,
      allRequiredAccepted: true,
      outcome: 'done',
    } as unknown as MissionJoin;
    expect(normalizeStoredMissionJoin(complete, CHILDREN, [])).toBe(complete);
  });

  it('fills a stored gap that predates the acceptance and agent fields', () => {
    const legacy = {
      status: 'joined_with_gaps',
      contributions: {},
      contributed: [],
      gaps: [{ key: 'market', label: 'Market', role: 'supporting', status: 'blocked', failureCategory: null, reason: 'no coverage' }],
      requiredGaps: [],
      outstanding: [],
      allTerminal: true,
      allRequiredTerminal: true,
      outcome: 'gaps',
    } as unknown as MissionJoin;
    const normalized = normalizeStoredMissionJoin(legacy, CHILDREN, []);
    expect(normalized.gaps[0].acceptanceState).toBe('not_evaluated');
    expect(normalized.gaps[0].group).toBe('deal_intelligence');
    expect(normalized.gaps[0].agentName).toBe('Market Research Agent');
  });

  it('reports a child that never ran as not evaluated, never as accepted', async () => {
    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({
      definition: definition({ identity: async () => ({ status: 'blocked', summary: 'no parcel linked' }) }),
      scopeId: 32,
      store,
    });
    await completion;
    const skipped = store.listChildren(launch.missionId).find((child) => child.key === 'context')!;
    expect(skipped.status).toBe('skipped');
    expect(skipped.acceptance!.state).toBe('not_evaluated');
  });
});
