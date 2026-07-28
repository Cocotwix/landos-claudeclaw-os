import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { MissionGraphStore, resetMissionGraphStoreCache } from './mission-graph-store.js';
import {
  launchFanOutMission,
  readFanOutMission,
  type FanOutMissionDefinition,
  type MissionChildExecutor,
} from './mission-graph-runner.js';
import { resetPropertyIntelligenceStoreCache } from './property-intelligence-store.js';
import type { MissionChildSpec, MissionChildState } from './mission-graph.js';

const CHILDREN: MissionChildSpec[] = [
  { key: 'identity', label: 'Identity', purpose: 'root lane', role: 'required', dependsOn: [], timeoutMs: 5_000 },
  { key: 'context', label: 'Context', purpose: 'needs identity', role: 'required', dependsOn: ['identity'], timeoutMs: 5_000 },
  { key: 'market', label: 'Market', purpose: 'needs identity', role: 'supporting', dependsOn: ['identity'], timeoutMs: 5_000 },
];

function definition(executors: Partial<Record<string, MissionChildExecutor>>): FanOutMissionDefinition {
  return {
    kind: 'test_fanout',
    label: 'Test fan-out',
    scope: 'deal_card',
    children: CHILDREN,
    executors: {
      identity: async () => ({ status: 'completed', summary: 'identity ok', result: { apn: '073090 04200' } }),
      context: async (ctx) => ({ status: 'completed', summary: 'context ok', result: { sawUpstream: ctx.upstream } }),
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

describe('fan-out: one parent launches multiple children', () => {
  it('creates a parent mission and every child mission row up front', async () => {
    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({ definition: definition({}), scopeId: 32, store });

    expect(launch.alreadyRunning).toBe(false);
    expect(launch.childCount).toBe(3);
    expect(launch.sequence).toBe(1);

    const children = store.listChildren(launch.missionId);
    expect(children).toHaveLength(3);
    expect(children.map((c) => c.key)).toEqual(['identity', 'context', 'market']);

    await completion;
  });

  it('returns the SAME mission when a second launch races an in-flight one', async () => {
    const store = new MissionGraphStore();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const first = launchFanOutMission({
      definition: definition({ identity: async () => { await gate; return { status: 'completed', summary: 'slow', result: {} }; } }),
      scopeId: 32,
      store,
    });
    const second = launchFanOutMission({ definition: definition({}), scopeId: 32, store });

    expect(second.launch.alreadyRunning).toBe(true);
    expect(second.launch.missionId).toBe(first.launch.missionId);
    expect(await second.completion).toBeNull();

    release();
    await first.completion;
    expect(store.listMissions('test_fanout', 'deal_card', 32)).toHaveLength(1);
  });

  it('keeps one Deal Card mission from leaking onto another Deal Card', async () => {
    const store = new MissionGraphStore();
    await launchFanOutMission({ definition: definition({}), scopeId: 32, store }).completion;
    await launchFanOutMission({ definition: definition({}), scopeId: 31, store }).completion;

    const a = readFanOutMission({ kind: 'test_fanout', scope: 'deal_card', label: 'x', children: CHILDREN }, 32, store);
    const b = readFanOutMission({ kind: 'test_fanout', scope: 'deal_card', label: 'x', children: CHILDREN }, 31, store);
    expect(a.mission!.missionId).not.toBe(b.mission!.missionId);
    expect(a.children.every((c) => c.status === 'completed')).toBe(true);
    expect(b.children.every((c) => c.status === 'completed')).toBe(true);
  });
});

describe('gather + join', () => {
  it('joins every successful child handback into the parent', async () => {
    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({ definition: definition({}), scopeId: 32, store });
    const join = await completion;

    expect(join!.status).toBe('joined');
    expect(join!.allTerminal).toBe(true);
    expect(join!.contributions.identity).toEqual({ apn: '073090 04200' });
    expect(join!.contributions.market).toEqual({ fips: '47145' });

    const mission = store.getMission(launch.missionId)!;
    expect(mission.status).toBe('joined');
    expect(mission.completedAt).not.toBeNull();
    expect(mission.join!.contributed).toEqual(['identity', 'context', 'market']);
  });

  it('hands a child the structured results of the children it depends on', async () => {
    const store = new MissionGraphStore();
    const join = await launchFanOutMission({ definition: definition({}), scopeId: 32, store }).completion;
    expect((join!.contributions.context as { sawUpstream: unknown }).sawUpstream).toEqual({
      identity: { apn: '073090 04200' },
    });
  });

  it('runs the children of one wave concurrently', async () => {
    const store = new MissionGraphStore();
    let inFlight = 0;
    let maxInFlight = 0;
    const concurrent: MissionChildExecutor = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return { status: 'completed', summary: 'ok', result: {} };
    };
    await launchFanOutMission({
      definition: definition({ context: concurrent, market: concurrent }),
      scopeId: 32,
      store,
    }).completion;
    expect(maxInFlight).toBe(2);
  });

  it('waits for a foreign-claimed predecessor and consumes its stored handback', async () => {
    const store = new MissionGraphStore();
    let contextStarted = false;
    const { launch, completion } = launchFanOutMission({
      definition: definition({
        // This executor must never run: the test worker below wins the claim.
        identity: async () => {
          throw new Error('the local runner must not execute a foreign-claimed lane');
        },
        context: async (ctx) => {
          contextStarted = true;
          return {
            status: 'completed',
            summary: 'context consumed the late identity',
            result: { sawUpstream: ctx.upstream },
          };
        },
      }),
      scopeId: 32,
      store,
      joinDeadlineMs: 1_000,
      joinPollMs: 5,
      missionIdFactory: () => 'mg_foreign_predecessor',
    });

    // Simulate another worker atomically claiming the root before this runner.
    expect(store.claimChild(launch.missionId, 'identity', '2026-07-26T00:00:00.000Z')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(contextStarted).toBe(false);
    expect(store.listChildren(launch.missionId).find((child) => child.key === 'context')!.status).toBe('queued');

    store.settleChild({
      missionId: launch.missionId,
      childKey: 'identity',
      status: 'completed',
      summary: 'identity settled by another worker',
      result: { apn: '073090 04200', worker: 'foreign' },
      completedAt: '2026-07-26T00:00:01.000Z',
    });

    const join = await completion;
    expect(contextStarted).toBe(true);
    expect(join!.allTerminal).toBe(true);
    expect((join!.contributions.context as { sawUpstream: unknown }).sawUpstream).toEqual({
      identity: { apn: '073090 04200', worker: 'foreign' },
    });
  });
});

describe('a failed, blocked or skipped child produces an explicit parent outcome', () => {
  it('classifies a thrown child as failed and names it in the parent outcome', async () => {
    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({
      definition: definition({ context: async () => { throw new Error('ECONNREFUSED connect'); } }),
      scopeId: 32,
      store,
    });
    const join = await completion;

    expect(join!.status).toBe('failed');
    expect(join!.requiredGaps.map((g) => g.key)).toEqual(['context']);
    expect(join!.outcome).toContain('Context (failed');
    expect(join!.outcome).toMatch(/did NOT complete/);

    const failed = store.listChildren(launch.missionId).find((c) => c.key === 'context')!;
    expect(failed.status).toBe('failed');
    expect(failed.failureCategory).toBeTruthy();
    // The sibling that worked is still joined; one failure never discards the rest.
    expect(join!.contributions).toHaveProperty('identity');
    expect(join!.contributions).toHaveProperty('market');
    expect(store.getMission(launch.missionId)!.status).toBe('failed');
  });

  it('classifies a child that overruns its budget as a timeout failure', async () => {
    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({
      definition: definition({ market: async () => { await new Promise((r) => setTimeout(r, 500)); return { status: 'completed', summary: 'late', result: {} }; } }),
      scopeId: 32,
      store,
      timeoutMsOverride: 20,
    });
    const join = await completion;

    const market = store.listChildren(launch.missionId).find((c) => c.key === 'market')!;
    expect(market.status).toBe('failed');
    expect(market.failureCategory).toBe('timeout');
    expect(join!.status).toBe('joined_with_gaps');
    expect(join!.outcome).toContain('Market (failed: timeout)');
  });

  it('reports blocked when the only missing required contribution is blocked', async () => {
    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({
      definition: definition({ identity: async () => ({ status: 'blocked', summary: 'No subject property card is linked.' }) }),
      scopeId: 32,
      store,
    });
    const join = await completion;

    expect(join!.status).toBe('blocked');
    expect(join!.outcome).toMatch(/coverage or input gap, not evidence/);

    // Both dependants are SKIPPED, not failed — they never ran.
    const children = store.listChildren(launch.missionId);
    expect(children.find((c) => c.key === 'context')!.status).toBe('skipped');
    expect(children.find((c) => c.key === 'market')!.status).toBe('skipped');
    expect(children.find((c) => c.key === 'context')!.summary).toMatch(/upstream contribution/i);
  });

  it('reports joined_with_gaps and still names a blocked supporting child', async () => {
    const store = new MissionGraphStore();
    const join = await launchFanOutMission({
      definition: definition({ market: async () => ({ status: 'blocked', summary: 'No seeded county reference.' }) }),
      scopeId: 32,
      store,
    }).completion;

    expect(join!.status).toBe('joined_with_gaps');
    expect(join!.requiredGaps).toEqual([]);
    expect(join!.gaps.map((g) => g.key)).toEqual(['market']);
    expect(join!.outcome).toContain('Market (blocked)');
  });

  it('fails a child with no registered executor instead of leaving it queued', async () => {
    const store = new MissionGraphStore();
    const def = definition({});
    delete (def.executors as Record<string, unknown>).market;
    const { launch, completion } = launchFanOutMission({ definition: def, scopeId: 32, store });
    await completion;

    const market = store.listChildren(launch.missionId).find((c) => c.key === 'market')!;
    expect(market.status).toBe('failed');
    expect(market.failureCategory).toBe('configuration');
  });

  it('refuses to launch a definition whose graph cannot be laid out', () => {
    const store = new MissionGraphStore();
    const broken: FanOutMissionDefinition = {
      ...definition({}),
      children: [{ key: 'a', label: 'A', purpose: '', role: 'required', dependsOn: ['ghost'], timeoutMs: 1 }],
    };
    expect(() => launchFanOutMission({ definition: broken, scopeId: 32, store })).toThrow(/unknown child "ghost"/);
    expect(store.listMissions('test_fanout', 'deal_card', 32)).toHaveLength(0);
  });
});

describe('the parent never completes before its children are terminal', () => {
  it('refuses a completion write while a child is still running', async () => {
    const store = new MissionGraphStore();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const { launch, completion } = launchFanOutMission({
      definition: definition({ market: async () => { await gate; return { status: 'completed', summary: 'late', result: {} }; } }),
      scopeId: 32,
      store,
    });

    // While `market` is in flight the parent must still read as running.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.getMission(launch.missionId)!.status).toBe('running');
    expect(store.getMission(launch.missionId)!.completedAt).toBeNull();

    const refused = store.completeMission({
      missionId: launch.missionId,
      status: 'joined',
      outcome: 'premature',
      join: {
        status: 'joined',
        contributions: {},
        contributionsBySlot: {},
        routing: [],
        contributed: [],
        accepted: [],
        incomplete: [],
        gaps: [],
        requiredGaps: [],
        outstanding: [],
        allTerminal: true,
        allRequiredTerminal: true,
        allRequiredAccepted: true,
        outcome: 'premature',
      },
      completedAt: '2026-07-26T00:00:00.000Z',
    });
    expect(refused.completed).toBe(false);
    expect(refused.reason).toMatch(/still outstanding/);
    expect(store.getMission(launch.missionId)!.status).toBe('running');

    release();
    await completion;
    expect(store.getMission(launch.missionId)!.status).toBe('joined');
  });

  it('stops at the join deadline and names the outstanding child instead of joining over it', async () => {
    const store = new MissionGraphStore();
    const def = definition({});
    // A child another worker claimed: the runner cannot claim it, so it never
    // settles here. The parent must report it, not silently drop it.
    const { launch, completion } = launchFanOutMission({
      definition: def,
      scopeId: 32,
      store,
      joinDeadlineMs: 60,
      joinPollMs: 10,
      missionIdFactory: () => 'mg_stuck',
    });
    store.claimChild('mg_stuck', 'market', '2026-07-26T00:00:00.000Z');
    const join = await completion;

    expect(join!.status).toBe('running');
    expect(join!.allTerminal).toBe(false);
    expect(join!.outstanding.map((g) => g.key)).toEqual(['market']);
    expect(join!.outcome).toMatch(/cannot complete yet/i);
    // The parent row is NOT completed while a child is outstanding.
    expect(store.getMission(launch.missionId)!.status).toBe('running');
    expect(store.getMission(launch.missionId)!.completedAt).toBeNull();
  });
});

describe('the join deadline honors every child budget', () => {
  // REGRESSION: the default deadline was a flat 120s while the Deal Intelligence
  // projection refresh carries a 20-minute budget. For a child ANOTHER worker
  // claimed, the parent gave up mid-budget: it resolved with a running join and
  // left the mission row `running` over a lane that was still legitimately
  // inside its own time budget. The default deadline is now derived from the
  // mission's largest child budget, so it can never be shorter than any child's
  // legal running time. An explicit joinDeadlineMs still wins (previous test).
  const SLOW_CHILDREN: MissionChildSpec[] = [
    { key: 'identity', label: 'Identity', purpose: 'root lane', role: 'required', dependsOn: [], timeoutMs: 5_000 },
    { key: 'slow_refresh', label: 'Slow refresh', purpose: 'long-budget supporting lane', role: 'supporting', dependsOn: [], timeoutMs: 300_000 },
  ];
  const slowDefinition = (): FanOutMissionDefinition => ({
    kind: 'test_fanout',
    label: 'Test fan-out',
    scope: 'deal_card',
    children: SLOW_CHILDREN,
    executors: {
      identity: async () => ({ status: 'completed', summary: 'identity ok', result: { apn: '073090 04200' } }),
      slow_refresh: async () => ({ status: 'completed', summary: 'refresh ok', result: { ran: true } }),
    },
  });

  it('keeps waiting past the old flat default while a foreign-claimed lane is inside its budget, then joins its late result', async () => {
    const store = new MissionGraphStore();
    let nowMs = 0;
    const { launch, completion } = launchFanOutMission({
      definition: slowDefinition(),
      scopeId: 32,
      store,
      joinPollMs: 5,
      clockMs: () => nowMs,
      missionIdFactory: () => 'mg_slow_budget',
    });
    // Another worker claims the slow lane before this runner can, so this
    // parent can only wait for whatever that worker records.
    expect(store.claimChild('mg_slow_budget', 'slow_refresh', '2026-07-26T00:00:00.000Z')).toBe(true);

    // Let dispatch finish and the join wait capture its start at t=0, THEN move
    // the clock past the old 120s flat deadline but well inside the lane's 300s
    // budget: the parent must STILL be waiting, not resolved with a running join.
    await new Promise((resolve) => setTimeout(resolve, 40));
    nowMs = 200_000;
    const settledEarly = await Promise.race([
      completion.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 80)),
    ]);
    expect(settledEarly).toBe(false);
    expect(store.getMission(launch.missionId)!.status).toBe('running');

    // The foreign worker lands the result inside the lane's budget; the parent
    // joins it instead of having already given up.
    store.settleChild({
      missionId: 'mg_slow_budget',
      childKey: 'slow_refresh',
      status: 'completed',
      summary: 'refresh landed late but inside its budget',
      result: { ran: true, late: true },
      completedAt: '2026-07-26T00:04:00.000Z',
    });
    const join = await completion;
    expect(join!.allTerminal).toBe(true);
    expect(join!.status).toBe('joined');
    expect(join!.contributions.slow_refresh).toEqual({ ran: true, late: true });
    expect(store.getMission(launch.missionId)!.status).toBe('joined');
  });

  it('still gives up once the DERIVED deadline (largest budget + margin) passes, naming the outstanding child', async () => {
    const store = new MissionGraphStore();
    let nowMs = 0;
    const { launch, completion } = launchFanOutMission({
      definition: slowDefinition(),
      scopeId: 32,
      store,
      joinPollMs: 5,
      clockMs: () => nowMs,
      missionIdFactory: () => 'mg_slow_orphan',
    });
    expect(store.claimChild('mg_slow_orphan', 'slow_refresh', '2026-07-26T00:00:00.000Z')).toBe(true);

    // Let dispatch settle and the join wait begin before the clock moves, then
    // jump past 300s budget + 60s margin. Nothing ever lands for the lane.
    await new Promise((resolve) => setTimeout(resolve, 40));
    nowMs = 400_000;
    const join = await completion;
    expect(join!.status).toBe('running');
    expect(join!.allTerminal).toBe(false);
    expect(join!.outstanding.map((g) => g.key)).toEqual(['slow_refresh']);
    // The parent is NEVER completed over a non-terminal child.
    expect(store.getMission(launch.missionId)!.status).toBe('running');
    expect(store.getMission(launch.missionId)!.completedAt).toBeNull();
  });
});

describe('persistence and restart behaviour', () => {
  it('persists the parent, children and join across a fresh store instance', async () => {
    const writer = new MissionGraphStore();
    const { launch } = launchFanOutMission({ definition: definition({}), scopeId: 32, store: writer });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const reader = new MissionGraphStore();
    const view = readFanOutMission({ kind: 'test_fanout', scope: 'deal_card', label: 'x', children: CHILDREN }, 32, reader);
    expect(view.mission!.missionId).toBe(launch.missionId);
    expect(view.children).toHaveLength(3);
    expect(view.join!.contributions.identity).toEqual({ apn: '073090 04200' });
  });

  it('a re-run creates a new sequence and leaves the prior mission readable', async () => {
    const store = new MissionGraphStore();
    const first = launchFanOutMission({ definition: definition({}), scopeId: 32, store });
    await first.completion;
    const second = launchFanOutMission({ definition: definition({}), scopeId: 32, store });
    await second.completion;

    expect(second.launch.sequence).toBe(2);
    const history = store.listMissions('test_fanout', 'deal_card', 32);
    expect(history.map((m) => m.sequence)).toEqual([2, 1]);
    expect(store.getMission(first.launch.missionId)!.status).toBe('joined');
  });

  it('closes an interrupted mission honestly instead of showing it as still progressing', async () => {
    const store = new MissionGraphStore();
    launchFanOutMission({
      definition: definition({ identity: async () => new Promise(() => {}) as Promise<never> }),
      scopeId: 32,
      store,
      missionIdFactory: () => 'mg_interrupted',
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const reclaimed = store.reclaimStaleMissions(0, Date.now() + 60_000);
    expect(reclaimed).toBe(1);

    const mission = store.getMission('mg_interrupted')!;
    expect(mission.status).toBe('failed');
    expect(mission.failureCategory).toBe('interrupted');
    expect(mission.outcome).toMatch(/did not finish and no result was joined/);
    // No child is left stranded in queued/running.
    expect(store.listChildren('mg_interrupted').every((c) => c.status === 'failed')).toBe(true);
  });

  it('redacts a secret-shaped handback before it reaches the store', async () => {
    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({
      definition: definition({ market: async () => ({ status: 'completed', summary: 'ok', result: { token: 'super-secret', fips: '47145' } }) }),
      scopeId: 32,
      store,
    });
    await completion;
    const market = store.listChildren(launch.missionId).find((c) => c.key === 'market')!;
    expect((market.result as Record<string, unknown>).token).toBe('[redacted]');
    expect((market.result as Record<string, unknown>).fips).toBe('47145');
  });

  it('claims a child exactly once so two workers cannot run the same lane', () => {
    const store = new MissionGraphStore();
    store.createMission({
      missionId: 'mg_claim',
      kind: 'test_fanout',
      scope: 'deal_card',
      scopeId: 32,
      trigger: 'test',
      startedAt: '2026-07-26T00:00:00.000Z',
      children: CHILDREN,
    });
    expect(store.claimChild('mg_claim', 'identity', '2026-07-26T00:00:01.000Z')).toBe(true);
    expect(store.claimChild('mg_claim', 'identity', '2026-07-26T00:00:02.000Z')).toBe(false);
    const child = store.listChildren('mg_claim').find((c: MissionChildState) => c.key === 'identity')!;
    expect(child.status).toBe('running');
    expect(child.attempt).toBe(1);
  });
});
