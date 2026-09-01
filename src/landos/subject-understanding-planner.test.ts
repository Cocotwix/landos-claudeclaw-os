// Stage 2.1 — the production LLM Deal Manager actually reviews the decision.
//
// The defect class Stage 2 left behind: the planner was injectable and nothing
// was bound, so every live run recorded zero reasoning turns and the loop was
// a deterministic parser wearing an agent's clothes. These tests pin the two
// paths the acceptance gate names — a clear lead reviewed at zero tool calls,
// and an ambiguous lead inside the existing four-action and one-question caps —
// plus the refusals that keep the model an untrusted proposer.

import { describe, expect, it } from 'vitest';

import {
  SUBJECT_UNDERSTANDING_ALLOWED_CAPABILITIES,
  SUBJECT_UNDERSTANDING_ACTION_LIMIT,
  understandSubject,
  type SubjectEvidenceFact,
  type SubjectUnderstandingPlannerInput,
} from './subject-understanding.js';
import {
  SUBJECT_UNDERSTANDING_PROFILE,
  createSubjectUnderstandingPlanner,
  subjectUnderstandingPrompt,
} from './subject-understanding-planner.js';

function fact(over: Partial<SubjectEvidenceFact> & { factId: string; field: SubjectEvidenceFact['field']; value: string }): SubjectEvidenceFact {
  return {
    label: 'seeded',
    quoted: over.value,
    inferred: false,
    weight: 'well_supported',
    parcelRelationship: 'subject',
    source: { kind: 'seller_text', label: 'Lead intake text', url: null, locator: 'Retained raw intake', retrievedAt: null, officiality: 'unverified' },
    ...over,
  } as SubjectEvidenceFact;
}

const CLEAR_LEAD: SubjectEvidenceFact[] = [
  fact({ factId: 'intake:0:apn', field: 'apn', value: '00083A03400' }),
  fact({ factId: 'intake:1:county', field: 'county', value: 'Bradford' }),
  fact({ factId: 'intake:2:state', field: 'state', value: 'FL' }),
];

/** Two equally weighted sources naming different parcels: genuinely ambiguous. */
const AMBIGUOUS_LEAD: SubjectEvidenceFact[] = [
  ...CLEAR_LEAD,
  fact({
    factId: 'doc:0:apn', field: 'apn', value: '00091B01200',
    source: { kind: 'document', label: 'Supplied deed', url: null, locator: 'page 1', retrievedAt: null, officiality: 'unverified' },
  }),
];

const CONCUR = JSON.stringify({
  reading: 'The lead states one parcel identifier with its county and state; that establishes the subject.',
  nextCheck: null,
  proposedOutcome: 'research_ready',
  question: null,
});

describe('the production planner binding reuses the existing model path', () => {
  it('runs on the persistent property specialist, clarify toolset, and the shared model override', () => {
    const seen: string[][] = [];
    const binding = createSubjectUnderstandingPlanner({
      invoke: async (args) => { seen.push(args); return CONCUR; },
    })!;
    expect(binding).toBeTruthy();
    expect(binding.provenance.profile).toBe(SUBJECT_UNDERSTANDING_PROFILE);
    expect(binding.provenance.profile).toBe('landos-property');
    expect(binding.provenance.toolsets).toBe('clarify');
    expect(binding.provenance.provider).toBeTruthy();
    expect(binding.provenance.model).toBeTruthy();
    // The allowlist travels with the run; it is not widened for the model.
    expect(binding.provenance.allowedCapabilities).toEqual([...SUBJECT_UNDERSTANDING_ALLOWED_CAPABILITIES]);
  });

  it('the prompt offers the model no capability outside the existing allowlist', () => {
    const input: SubjectUnderstandingPlannerInput = {
      dealCardId: 1, evidence: CLEAR_LEAD, candidates: [], conflicts: [], excludedParcels: [],
      deterministicOutcome: 'candidate_set', checksAlreadyRun: [], actionsRemaining: 4,
      allowedCapabilities: SUBJECT_UNDERSTANDING_ALLOWED_CAPABILITIES,
    };
    const prompt = subjectUnderstandingPrompt(input);
    for (const id of SUBJECT_UNDERSTANDING_ALLOWED_CAPABILITIES) expect(prompt).toContain(id);
    for (const forbidden of ['comps-', 'market-intelligence', 'valuation', 'seller-communication', 'deal-brain']) {
      expect(prompt).not.toContain(forbidden);
    }
  });
});

describe('a fresh clear lead is reviewed by the model and completes with zero tool calls', () => {
  it('spends exactly one reasoning turn and no action', async () => {
    let turns = 0;
    const binding = createSubjectUnderstandingPlanner({
      invoke: async () => { turns += 1; return CONCUR; },
    })!;

    const result = await understandSubject({
      dealCardId: 1,
      evidence: CLEAR_LEAD,
      subjectVersionAtStart: 'v1',
      planner: binding.planner,
      plannerProvenance: binding.provenance,
      executor: async () => { throw new Error('no evidence check may run on a settled reading'); },
    });

    expect(result.outcome).toBe('research_ready');
    expect(turns).toBe(1);
    expect(result.audit.plannerInvocations).toBe(1);
    expect(result.audit.actionsUsed).toBe(0);
    expect(result.audit.reasoning.bound).toBe(true);
    expect(result.audit.reasoning.turns).toBe(1);
    expect(result.audit.reasoning.profile).toBe('landos-property');
    expect(result.audit.stopReason).toBe('research_ready');
  });

  it('refuses and records an evidence check the model asks for on a settled reading', async () => {
    const wantsACheck = JSON.stringify({
      reading: 'I would like the assessor record anyway.',
      nextCheck: { capabilityId: 'assessor-tax', reason: 'double-check the parcel' },
      proposedOutcome: 'research_ready',
      question: null,
    });
    let executed = 0;
    const binding = createSubjectUnderstandingPlanner({ invoke: async () => wantsACheck })!;

    const result = await understandSubject({
      dealCardId: 1, evidence: CLEAR_LEAD, subjectVersionAtStart: 'v1',
      planner: binding.planner, plannerProvenance: binding.provenance,
      executor: async () => { executed += 1; return []; },
    });

    expect(executed).toBe(0);
    expect(result.audit.actionsUsed).toBe(0);
    expect(result.outcome).toBe('research_ready');
    const refused = result.audit.toolRequests.find((request) => request.capabilityId === 'assessor-tax');
    expect(refused?.accepted).toBe(false);
    expect(refused?.refusalReason).toContain('no evidence check is authorized');
  });
});

describe('a genuinely ambiguous lead uses the bounded loop and stays inside its caps', () => {
  it('never exceeds the four-action limit, even when the model keeps asking', async () => {
    const alwaysAsks = JSON.stringify({
      reading: 'Two sources name different parcels.',
      nextCheck: { capabilityId: 'assessor-tax', reason: 'settle which parcel the county records' },
      proposedOutcome: null,
      question: null,
    });
    let executed = 0;
    const binding = createSubjectUnderstandingPlanner({ invoke: async () => alwaysAsks })!;

    const result = await understandSubject({
      dealCardId: 1, evidence: AMBIGUOUS_LEAD, subjectVersionAtStart: 'v1',
      planner: binding.planner, plannerProvenance: binding.provenance,
      executor: async () => { executed += 1; return []; },
    });

    expect(result.outcome).toBe('candidate_set');
    expect(executed).toBe(SUBJECT_UNDERSTANDING_ACTION_LIMIT);
    expect(result.audit.actionsUsed).toBe(SUBJECT_UNDERSTANDING_ACTION_LIMIT);
    expect(result.audit.stopReason).toBe('action_limit_reached');
    expect(result.audit.reasoning.turns).toBeGreaterThan(0);
  });

  it('returns at most one targeted question and never promotes an unsupported subject', async () => {
    const asksOnce = JSON.stringify({
      reading: 'Nothing here decides between the two parcels.',
      nextCheck: null,
      proposedOutcome: 'candidate_set',
      question: {
        question: 'Which parcel is being sold, 00083A03400 or 00091B01200?',
        why: 'Two sources of equal weight name different parcels.',
        unblocks: 'LandOS confirms that parcel and begins research.',
        acceptableAnswers: ['00083A03400', '00091B01200'],
      },
    });
    const binding = createSubjectUnderstandingPlanner({ invoke: async () => asksOnce })!;

    const result = await understandSubject({
      dealCardId: 1, evidence: AMBIGUOUS_LEAD, subjectVersionAtStart: 'v1',
      planner: binding.planner, plannerProvenance: binding.provenance,
    });

    expect(result.outcome).toBe('candidate_set');
    expect(result.subject).toBeNull();
    expect(result.question).not.toBeNull();
    expect(result.question!.question.split('?').filter((part) => part.trim()).length).toBe(1);
  });

  it('a capability outside the allowlist is refused, recorded, and never executed', async () => {
    const forbidden = JSON.stringify({
      reading: 'I want comparable sales.',
      nextCheck: { capabilityId: 'comps-valuation', reason: 'price it' },
      proposedOutcome: null,
      question: null,
    });
    let executed = 0;
    const binding = createSubjectUnderstandingPlanner({ invoke: async () => forbidden })!;

    const result = await understandSubject({
      dealCardId: 1, evidence: AMBIGUOUS_LEAD, subjectVersionAtStart: 'v1',
      planner: binding.planner, plannerProvenance: binding.provenance,
      executor: async () => { executed += 1; return []; },
    });

    expect(executed).toBe(0);
    const refusal = result.audit.toolRequests.find((request) => request.refusalReason?.includes('comps-valuation'));
    expect(refusal).toBeTruthy();
    expect(refusal!.accepted).toBe(false);
  });

  it('malformed model output falls back safely and never invents a subject', async () => {
    const binding = createSubjectUnderstandingPlanner({ invoke: async () => 'I think it is probably the north lot.' })!;
    const result = await understandSubject({
      dealCardId: 1, evidence: AMBIGUOUS_LEAD, subjectVersionAtStart: 'v1',
      planner: binding.planner, plannerProvenance: binding.provenance,
    });
    expect(result.audit.stopReason).toBe('planner_output_invalid');
    expect(result.subject).toBeNull();
    expect(result.outcome).toBe('candidate_set');
  });

  it('a model proposing research_ready over unsettled evidence does not get it', async () => {
    // The model's proposed outcome is a proposal. The deterministic derivation
    // over retained evidence is the decision.
    const overclaim = JSON.stringify({
      reading: 'It is obviously the first parcel.',
      nextCheck: null,
      proposedOutcome: 'research_ready',
      question: null,
    });
    const binding = createSubjectUnderstandingPlanner({ invoke: async () => overclaim })!;
    const result = await understandSubject({
      dealCardId: 1, evidence: AMBIGUOUS_LEAD, subjectVersionAtStart: 'v1',
      planner: binding.planner, plannerProvenance: binding.provenance,
    });
    expect(result.outcome).toBe('candidate_set');
    expect(result.subject).toBeNull();
  });

  it('stale model output cannot be written as the authoritative subject', async () => {
    const binding = createSubjectUnderstandingPlanner({ invoke: async () => CONCUR })!;
    const result = await understandSubject({
      dealCardId: 1, evidence: CLEAR_LEAD, subjectVersionAtStart: 'v1',
      planner: binding.planner, plannerProvenance: binding.provenance,
      currentSubjectVersion: () => 'v2',
    });
    expect(result.persistable).toBe(false);
    expect(result.audit.stopReason).toBe('subject_changed_underneath');
  });
});
