// Stage 2 closeout — the New Lead front door owns the release of parcel work.
//
// Before this, deterministic resolution returning RESOLVED both accepted the
// subject AND released all eleven parcel-dependent lanes, so the LLM review
// raced its own downstream research. The mission graph is the ordering owner:
// a `subject_understanding` child sits between `parcel_identity` and every
// parcel-dependent lane, and the existing `dependsOn` skip mechanics hold them.

import { describe, expect, it } from 'vitest';

import {
  DEAL_INTELLIGENCE_CHILDREN,
  SUBJECT_UNDERSTANDING_LANE,
  dealIntelligenceChildrenForCaller,
  dealIntelligenceExecutors,
  type DealIntelligenceCapabilities,
  type SubjectUnderstandingLaneResult,
} from './deal-intelligence-mission.js';

const PARCEL_DEPENDENT = DEAL_INTELLIGENCE_CHILDREN
  .filter((spec) => spec.key !== SUBJECT_UNDERSTANDING_LANE && spec.dependsOn.includes('parcel_identity'))
  .map((spec) => spec.key);

function lane(result: Partial<SubjectUnderstandingLaneResult>): DealIntelligenceCapabilities {
  return {
    collectors: {} as DealIntelligenceCapabilities['collectors'],
    subjectUnderstanding: async () => ({
      outcome: 'research_ready',
      promotion: { status: 'promoted', reason: 'accepted' },
      subjectVersion: 'iv:1:v1',
      question: null,
      reasoningTurns: 1,
      ...result,
    } as SubjectUnderstandingLaneResult),
  } as DealIntelligenceCapabilities;
}

const run = (capabilities: DealIntelligenceCapabilities) =>
  dealIntelligenceExecutors(capabilities)[SUBJECT_UNDERSTANDING_LANE](
    { scopeId: 1 } as Parameters<ReturnType<typeof dealIntelligenceExecutors>[string]>[0],
  );

describe('the fresh New Lead graph puts subject understanding before parcel work', () => {
  it('every parcel-dependent lane waits on subject_understanding, not on resolution', () => {
    const children = dealIntelligenceChildrenForCaller('new_lead');
    expect(children.some((spec) => spec.key === SUBJECT_UNDERSTANDING_LANE)).toBe(true);
    expect(PARCEL_DEPENDENT.length).toBeGreaterThan(5);

    for (const key of PARCEL_DEPENDENT) {
      const spec = children.find((child) => child.key === key)!;
      expect(spec.dependsOn).toContain(SUBJECT_UNDERSTANDING_LANE);
      expect(spec.dependsOn).not.toContain('parcel_identity');
    }
  });

  it('subject_understanding itself still waits on deterministic resolution', () => {
    const spec = dealIntelligenceChildrenForCaller('new_lead')
      .find((child) => child.key === SUBJECT_UNDERSTANDING_LANE)!;
    // Ordering, not requirement: a blocked resolution must not skip the front
    // door, because an address-only lead is the one whose targeted question the
    // operator most needs. `new-lead-front-door.test.ts` pins that behaviour.
    expect(spec.awaits).toEqual(['parcel_identity']);
    expect(spec.dependsOn).toEqual([]);
    expect(spec.role).toBe('required');
  });

  it('every other caller keeps exactly the child list it had before', () => {
    for (const caller of ['deal_card', 'internal_workflow', 'tools', null, undefined]) {
      const children = dealIntelligenceChildrenForCaller(caller);
      expect(children.some((spec) => spec.key === SUBJECT_UNDERSTANDING_LANE)).toBe(false);
      for (const key of PARCEL_DEPENDENT) {
        expect(children.find((child) => child.key === key)!.dependsOn).toContain('parcel_identity');
      }
    }
  });
});

describe('only an accepted subject releases parcel-dependent research', () => {
  it('research_ready plus a promotion completes the lane', async () => {
    const outcome = await run(lane({}));
    expect(outcome.status).toBe('completed');
  });

  it('research_ready on an already-accepted parcel also completes', async () => {
    const outcome = await run(lane({ promotion: { status: 'already_accepted', reason: 'same parcel' } }));
    expect(outcome.status).toBe('completed');
  });

  it.each([
    ['candidate_set', { status: 'not_research_ready', reason: 'ranked candidates' }],
    ['needs_targeted_input', { status: 'not_research_ready', reason: 'one question' }],
  ] as const)('%s blocks every parcel-dependent lane', async (outcomeName, promotion) => {
    const result = await run(lane({
      outcome: outcomeName,
      promotion,
      question: { question: 'Which parcel is being sold?' },
    }));
    expect(result.status).toBe('blocked');
    // The one question is what the operator sees, not a stack trace.
    expect(result.summary).toBe('Which parcel is being sold?');
  });

  it('a stale subject version blocks rather than releasing research', async () => {
    const result = await run(lane({
      outcome: 'research_ready',
      promotion: { status: 'stale_subject_version', reason: 'the subject moved' },
    }));
    expect(result.status).toBe('blocked');
  });

  it('a refused promotion blocks rather than releasing research', async () => {
    const result = await run(lane({
      outcome: 'research_ready',
      promotion: { status: 'accepted_subject_differs', reason: 'another parcel is accepted' },
    }));
    expect(result.status).toBe('blocked');
  });

  it('the lane blocks rather than assuming acceptance when nothing is bound', async () => {
    const result = await run({ collectors: {} } as DealIntelligenceCapabilities);
    expect(result.status).toBe('blocked');
  });
});
