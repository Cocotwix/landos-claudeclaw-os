// Stage 2 closeout — the front door runs once, and acceptance is what releases
// the rest of the mission.
//
// `new-lead-subject-gate.test.ts` pins the graph SHAPE. This pins the two
// behaviours that shape implies and that the live QA leads exercised:
//
//   • the lane runs exactly once per fresh New Lead mission, automatically —
//     no operator presses Run, and a blocked resolution does not skip it,
//     because an address-only lead is precisely the one whose targeted
//     question the operator needs;
//   • a promotion hands the deal to the EXISTING coverage recovery path, so
//     the parcel-dependent work that was held actually gets done.

import { describe, expect, it, vi } from 'vitest';

import {
  DEAL_INTELLIGENCE_CHILDREN,
  SUBJECT_UNDERSTANDING_LANE,
  dealIntelligenceChildrenForCaller,
  dealIntelligenceChildrenForSubject,
  dealIntelligenceExecutors,
  type DealIntelligenceCapabilities,
  type SubjectUnderstandingLaneResult,
} from './deal-intelligence-mission.js';
import { planMissionWaves } from './mission-graph.js';

const ctx = { scopeId: 4242, missionId: 'm1', scope: 'deal_card', upstream: {}, provider: null } as never;

function capabilities(
  result: Partial<SubjectUnderstandingLaneResult>,
  onRun?: () => void,
): DealIntelligenceCapabilities {
  return {
    collectors: {} as DealIntelligenceCapabilities['collectors'],
    subjectUnderstanding: async () => {
      onRun?.();
      return {
        outcome: 'research_ready',
        promotion: { status: 'promoted', reason: 'accepted' },
        subjectVersion: 'iv:1:v2',
        question: null,
        reasoningTurns: 1,
        ...result,
      } as SubjectUnderstandingLaneResult;
    },
  } as DealIntelligenceCapabilities;
}

describe('Subject Understanding launches automatically, exactly once', () => {
  it('is a child of the fresh New Lead mission, so nothing needs pressing Run', () => {
    const children = dealIntelligenceChildrenForCaller('new_lead');
    const lane = children.filter((spec) => spec.key === SUBJECT_UNDERSTANDING_LANE);
    // Exactly one lane, declared once in the definition.
    expect(lane).toHaveLength(1);
    expect(DEAL_INTELLIGENCE_CHILDREN.filter((s) => s.key === SUBJECT_UNDERSTANDING_LANE)).toHaveLength(1);
    expect(lane[0].role).toBe('required');
  });

  it('runs after resolution but is NOT skipped when resolution blocks', () => {
    const lane = dealIntelligenceChildrenForCaller('new_lead')
      .find((spec) => spec.key === SUBJECT_UNDERSTANDING_LANE)!;
    // `awaits` is ordering; `dependsOn` would skip the lane whenever resolution
    // failed — the exact lead whose one question the operator needs.
    expect(lane.awaits).toEqual(['parcel_identity']);
    expect(lane.dependsOn).toEqual([]);
  });

  it('is scheduled after resolution and before every parcel-dependent lane', () => {
    const children = dealIntelligenceChildrenForCaller('new_lead');
    const waves = planMissionWaves(children);
    const waveOf = (key: string) => waves.findIndex((wave) => wave.includes(key));

    const resolution = waveOf('parcel_identity');
    const frontDoor = waveOf(SUBJECT_UNDERSTANDING_LANE);
    expect(frontDoor).toBeGreaterThan(resolution);

    for (const spec of children) {
      if (!spec.dependsOn.includes(SUBJECT_UNDERSTANDING_LANE)) continue;
      expect(waveOf(spec.key)).toBeGreaterThan(frontDoor);
    }
  });

  it('the executor invokes the capability exactly once per run', async () => {
    let runs = 0;
    const executors = dealIntelligenceExecutors(capabilities({}, () => { runs += 1; }));
    await executors[SUBJECT_UNDERSTANDING_LANE](ctx);
    expect(runs).toBe(1);
  });

  it('still returns the one targeted question when resolution found no parcel', async () => {
    const executors = dealIntelligenceExecutors(capabilities({
      outcome: 'needs_targeted_input',
      promotion: { status: 'not_research_ready', reason: 'no parcel identifier' },
      question: { question: 'Do you have the parcel number, or a county parcel-record link?' },
    }));
    const outcome = await executors[SUBJECT_UNDERSTANDING_LANE](ctx);
    expect(outcome.status).toBe('blocked');
    expect(outcome.summary).toBe('Do you have the parcel number, or a county parcel-record link?');
  });
});

describe('a successful promotion hands the deal to the existing recovery path', () => {
  it('runs the existing coverage cycle once, detached, and only on a real promotion', async () => {
    const cycles: Array<{ dealCardId: number; trigger: string }> = [];
    const recover = vi.fn(async (dealCardId: number, _entity: string, trigger: string) => {
      cycles.push({ dealCardId, trigger });
    });

    // The seam as routes wires it: promotion, then the existing
    // `runDealCoverageCycle`. Nothing new is scheduled for any other outcome.
    const promote = async (result: SubjectUnderstandingLaneResult) => {
      if (result.promotion?.status === 'promoted') await recover(4242, 'TY_LAND_BIZ', 'automatic');
      return result;
    };

    await promote({
      outcome: 'research_ready', promotion: { status: 'promoted', reason: 'accepted' },
      subjectVersion: 'iv:1:v2', question: null, reasoningTurns: 1,
    });
    expect(cycles).toEqual([{ dealCardId: 4242, trigger: 'automatic' }]);

    for (const status of ['already_accepted', 'not_research_ready', 'stale_subject_version', 'accepted_subject_differs']) {
      await promote({
        outcome: 'research_ready', promotion: { status, reason: status },
        subjectVersion: 'iv:1:v2', question: null, reasoningTurns: 1,
      });
    }
    // Still one: recovery follows an accepted subject, not every run.
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('the lanes that were held are the ones the recovery path can now run', () => {
    const held = dealIntelligenceChildrenForCaller('new_lead')
      .filter((spec) => spec.dependsOn.includes(SUBJECT_UNDERSTANDING_LANE)).map((s) => s.key);
    expect(held).toContain('government_records');
    expect(held).toContain('zoning_land_use');
    expect(held).toContain('valuation');
    expect(held).toContain('strategy');
    expect(held.length).toBeGreaterThanOrEqual(9);
  });

  it('a geography-only lane is released by its own prerequisite, not by acceptance', () => {
    // `market_intelligence` declares county-or-ZIP. When the subject already
    // satisfies that, the EXISTING accelerator drops its identity edge, so it
    // runs beside the front door rather than behind it — which is what the live
    // QA leads showed: market completed while every parcel lane waited.
    const countyKnown = dealIntelligenceChildrenForSubject(() => [], 'new_lead');
    const market = countyKnown.find((spec) => spec.key === 'market_intelligence')!;
    expect(market.dependsOn).not.toContain(SUBJECT_UNDERSTANDING_LANE);
    expect(market.dependsOn).not.toContain('parcel_identity');

    // With the prerequisite unmet it keeps its conservative edge.
    const countyUnknown = dealIntelligenceChildrenForSubject(() => ['county'], 'new_lead');
    expect(countyUnknown.find((spec) => spec.key === 'market_intelligence')!.dependsOn)
      .toContain(SUBJECT_UNDERSTANDING_LANE);
  });
});
