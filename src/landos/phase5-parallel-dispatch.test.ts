// Phase 5 regression: independent mission children genuinely overlap.
//
// The Phase 5 defect being guarded against: the comparables lane sat serialized
// behind the slow supporting deal_card_projection refresh (observed live on
// Deal 32 runs 6-11 and Deal 54 run 1: comparables started 1-2 ms after the
// projection finished, adding 50-272 s of pure serial time per run, ~22 % of
// mission wall clock). The contract now is:
//
//   1. comparables waits ONLY on parcel_identity — never on the projection.
//   2. The constraint lanes fan out concurrently after identity settles.
//   3. One slow supporting lane never gates an unrelated lane.
//   4. A blocked or failed awaited lane never freezes a lane that does not
//      consume it (`awaits` orders, `dependsOn` skips).

import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { MissionGraphStore, resetMissionGraphStoreCache } from './mission-graph-store.js';
import { resetPropertyIntelligenceStoreCache } from './property-intelligence-store.js';
import {
  launchFanOutMission,
  type FanOutMissionDefinition,
  type MissionChildExecutor,
} from './mission-graph-runner.js';
import { missionChildPredecessors, type MissionChildSpec } from './mission-graph.js';
import { DEAL_INTELLIGENCE_CHILDREN } from './deal-intelligence-mission.js';

beforeEach(() => {
  _initTestLandosDb();
  resetMissionGraphStoreCache();
  resetPropertyIntelligenceStoreCache();
});

// ── The REAL deal_intelligence graph declares the parallel shape ─────────────

describe('deal_intelligence graph shape (Phase 5 ordering contract)', () => {
  const byKey = new Map(DEAL_INTELLIGENCE_CHILDREN.map((spec) => [spec.key, spec]));

  it('comparables waits only on parcel_identity', () => {
    const comparables = byKey.get('comparables')!;
    expect(comparables).toBeTruthy();
    expect(missionChildPredecessors(comparables)).toEqual(['parcel_identity']);
  });

  it('the constraint and market lanes each wait only on parcel_identity', () => {
    for (const key of ['government_records', 'zoning_land_use', 'environmental_terrain', 'access_utilities', 'market_intelligence', 'evidence_visuals']) {
      const spec = byKey.get(key)!;
      expect(spec, `child ${key} must exist`).toBeTruthy();
      expect(missionChildPredecessors(spec), `child ${key} must fan out at identity-settle`).toEqual(['parcel_identity']);
    }
  });

  it('the retired projection refresh is absent from the canonical graph', () => {
    for (const spec of DEAL_INTELLIGENCE_CHILDREN) {
      expect(
        missionChildPredecessors(spec),
        `${spec.key} must not wait on deal_card_projection`,
      ).not.toContain('deal_card_projection');
    }
    expect(byKey.has('deal_card_projection')).toBe(false);
  });

  it('valuation AWAITS comparables and the constraint lanes but hard-depends only on identity', () => {
    const valuation = byKey.get('valuation')!;
    expect(valuation.dependsOn).toEqual(['parcel_identity']);
    expect(valuation.awaits ?? []).toContain('comparables');
    // Ordering without skip: a missing awaited lane must not cancel valuation.
    expect(valuation.dependsOn).not.toContain('comparables');
  });
});

// ── Runtime: clock-instrumented executors on a mirror of the topology ────────

interface Deferred {
  promise: Promise<void>;
  release: () => void;
}
function deferred(): Deferred {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

/** Mirror of the deal_intelligence topology, small enough to instrument. */
function topology(): MissionChildSpec[] {
  return [
    { key: 'identity', label: 'Identity', purpose: 'root', role: 'required', dependsOn: [], timeoutMs: 5_000 },
    { key: 'projection', label: 'Projection refresh', purpose: 'slow supporting refresh', role: 'supporting', dependsOn: ['identity'], timeoutMs: 5_000 },
    { key: 'comparables', label: 'Comparables', purpose: 'comps', role: 'required', dependsOn: ['identity'], timeoutMs: 5_000 },
    { key: 'zoning', label: 'Zoning', purpose: 'constraint', role: 'required', dependsOn: ['identity'], timeoutMs: 5_000 },
    { key: 'environmental', label: 'Environmental', purpose: 'constraint', role: 'required', dependsOn: ['identity'], timeoutMs: 5_000 },
    { key: 'access', label: 'Access', purpose: 'constraint', role: 'required', dependsOn: ['identity'], timeoutMs: 5_000 },
    { key: 'market', label: 'Market', purpose: 'market pulse', role: 'supporting', dependsOn: ['identity'], timeoutMs: 5_000 },
    {
      key: 'valuation', label: 'Valuation', purpose: 'value conclusion', role: 'required',
      dependsOn: ['identity'], awaits: ['comparables', 'zoning', 'environmental', 'access'], timeoutMs: 5_000,
    },
  ];
}

function makeDefinition(
  events: string[],
  overrides: Record<string, MissionChildExecutor>,
): FanOutMissionDefinition {
  const instrumented = (key: string): MissionChildExecutor => async () => {
    events.push(`${key}:start`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    events.push(`${key}:end`);
    return { status: 'completed', summary: `${key} ok`, result: { key } };
  };
  const executors: Record<string, MissionChildExecutor> = {};
  for (const spec of topology()) executors[spec.key] = instrumented(spec.key);
  return {
    kind: 'phase5_dispatch',
    label: 'Phase 5 dispatch topology',
    scope: 'deal_card',
    children: topology(),
    executors: { ...executors, ...overrides },
  };
}

describe('per-child concurrent dispatch (no wave barrier, no serialization)', () => {
  it('comparables STARTS before the slow projection refresh FINISHES', async () => {
    const events: string[] = [];
    const comparablesEnded = deferred();
    const definition = makeDefinition(events, {
      // The projection cannot finish until comparables has already completed.
      // Under the old serialized graph this deadlocks and the projection times
      // out — which is exactly the regression this test exists to catch.
      projection: async () => {
        events.push('projection:start');
        await comparablesEnded.promise;
        events.push('projection:end');
        return { status: 'completed', summary: 'refresh ok', result: { ran: true } };
      },
      comparables: async () => {
        events.push('comparables:start');
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push('comparables:end');
        comparablesEnded.release();
        return { status: 'completed', summary: 'comps ok', result: { candidateCount: 2 } };
      },
    });

    const store = new MissionGraphStore();
    const join = await launchFanOutMission({
      definition, scopeId: 32, store, timeoutMsOverride: 2_000, joinPollMs: 5, joinDeadlineMs: 4_000,
    }).completion;

    expect(join!.status).toBe('joined');
    expect(events.indexOf('comparables:start')).toBeGreaterThan(-1);
    expect(events.indexOf('comparables:start')).toBeLessThan(events.indexOf('projection:end'));
    expect(events.indexOf('comparables:end')).toBeLessThan(events.indexOf('projection:end'));
  });

  it('zoning/environmental/access/market run concurrently after identity settles', async () => {
    const events: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const concurrent = (key: string): MissionChildExecutor => async () => {
      events.push(`${key}:start`);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 25));
      inFlight -= 1;
      events.push(`${key}:end`);
      return { status: 'completed', summary: `${key} ok`, result: { key } };
    };
    const definition = makeDefinition(events, {
      zoning: concurrent('zoning'),
      environmental: concurrent('environmental'),
      access: concurrent('access'),
      market: concurrent('market'),
    });

    const join = await launchFanOutMission({
      definition, scopeId: 33, store: new MissionGraphStore(), timeoutMsOverride: 2_000, joinPollMs: 5, joinDeadlineMs: 4_000,
    }).completion;

    expect(join!.status).toBe('joined');
    // All four post-identity lanes were genuinely in flight at once.
    expect(maxInFlight).toBe(4);
    // And none of them starts before the root identity lane has ended.
    for (const key of ['zoning', 'environmental', 'access', 'market', 'comparables', 'projection']) {
      expect(events.indexOf('identity:end')).toBeLessThan(events.indexOf(`${key}:start`));
    }
  });

  it('one slow supporting lane never gates a lane that consumes nothing from it', async () => {
    const events: string[] = [];
    const projectionGate = deferred();
    const valuationDone = deferred();
    const definition = makeDefinition(events, {
      projection: async () => {
        events.push('projection:start');
        await projectionGate.promise;
        events.push('projection:end');
        return { status: 'completed', summary: 'refresh ok', result: { ran: true } };
      },
      valuation: async (ctx) => {
        events.push('valuation:start');
        events.push('valuation:end');
        valuationDone.release();
        return { status: 'completed', summary: 'priced', result: { upstreamKeys: Object.keys(ctx.upstream).sort() } };
      },
    });

    const store = new MissionGraphStore();
    const { completion } = launchFanOutMission({
      definition, scopeId: 34, store, timeoutMsOverride: 3_000, joinPollMs: 5, joinDeadlineMs: 6_000,
    });

    // Valuation settles WHILE the supporting projection is still in flight.
    await valuationDone.promise;
    expect(events).toContain('valuation:end');
    expect(events).not.toContain('projection:end');

    projectionGate.release();
    const join = await completion;
    expect(join!.status).toBe('joined');
    // Valuation consumed its awaited lanes, not the projection.
    const valuation = (join!.contributions.valuation as { upstreamKeys: string[] });
    expect(valuation.upstreamKeys).toContain('comparables');
    expect(valuation.upstreamKeys).not.toContain('projection');
  });

  it('a BLOCKED awaited lane never freezes valuation: it still runs and discloses the gap', async () => {
    const events: string[] = [];
    const definition = makeDefinition(events, {
      zoning: async () => ({ status: 'blocked', summary: 'No zoning source exists for this county yet.' }),
      valuation: async (ctx) => ({
        status: 'completed',
        summary: 'priced without zoning',
        result: { upstreamKeys: Object.keys(ctx.upstream).sort() },
      }),
    });

    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({
      definition, scopeId: 35, store, timeoutMsOverride: 2_000, joinPollMs: 5, joinDeadlineMs: 4_000,
    });
    const join = await completion;

    const children = store.listChildren(launch.missionId);
    const valuation = children.find((child) => child.key === 'valuation')!;
    // `awaits` is ordering, never a skip: the valuation lane RAN.
    expect(valuation.status).toBe('completed');
    expect((valuation.result as { upstreamKeys: string[] }).upstreamKeys).not.toContain('zoning');
    expect((valuation.result as { upstreamKeys: string[] }).upstreamKeys).toContain('comparables');
    // The blocked lane itself stays visible as blocked — never hidden.
    expect(children.find((child) => child.key === 'zoning')!.status).toBe('blocked');
    expect(join!.outcome).toContain('Zoning');
  });

  it('a FAILED awaited lane never freezes valuation either', async () => {
    const events: string[] = [];
    const definition = makeDefinition(events, {
      comparables: async () => { throw new Error('provider unreachable'); },
      valuation: async (ctx) => ({
        status: 'completed',
        summary: 'not priceable without comps, and says so',
        result: { upstreamKeys: Object.keys(ctx.upstream).sort(), priceable: false },
      }),
    });

    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({
      definition, scopeId: 36, store, timeoutMsOverride: 2_000, joinPollMs: 5, joinDeadlineMs: 4_000,
    });
    await completion;

    const children = store.listChildren(launch.missionId);
    expect(children.find((child) => child.key === 'comparables')!.status).toBe('failed');
    const valuation = children.find((child) => child.key === 'valuation')!;
    expect(valuation.status).toBe('completed');
    expect((valuation.result as { upstreamKeys: string[] }).upstreamKeys).not.toContain('comparables');
  });
});
