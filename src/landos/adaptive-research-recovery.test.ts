import { describe, expect, it, vi } from 'vitest';

import {
  buildRecoveryEnvelope,
  decideRecovery,
  parseRecoveryPlan,
  planIsEvidence,
  planRecovery,
  recoveryStateFor,
  renderRecoveryPrompt,
  type RecoveryPlanner,
} from './adaptive-research-recovery.js';

const FAIRVIEW = {
  apn: '042-123.00-000',
  address: '0 Kingwood Blvd, Fairview, TN 37062',
  municipality: 'Fairview',
  county: 'Williamson',
  state: 'TN',
};

const GOOD_PLAN = JSON.stringify({
  approach: 'Read the post-April-2026 official Fairview zoning map for the subject parcel.',
  searchQueries: ['Fairview TN official zoning map GIS'],
  candidateSources: [
    { label: 'City of Fairview zoning GIS', url: 'https://gis.fairview-tn.org', why: 'The adopting jurisdiction publishes the official map.', expectedAuthority: 'official_primary' },
    { label: 'A news article about the 2026 code', url: 'https://example.com/news', why: 'Names the adoption date.', expectedAuthority: 'reputable_secondary' },
  ],
  gisLayers: ['Zoning'],
  stopWhen: 'The district polygon containing the subject APN is read and captured.',
});

describe('recovery is gated by materiality, never open-ended', () => {
  // Spec test 1.
  it('never invokes recovery when the deterministic path already answered', async () => {
    const planner = vi.fn<RecoveryPlanner>();
    const result = await planRecovery({
      envelope: buildRecoveryEnvelope({
        dealCardId: 89, laneId: 'zoning_land_use', question: 'Current zoning?', subject: FAIRVIEW,
      }),
      outcome: 'RETURNED',
      planner,
    });

    expect(planner).not.toHaveBeenCalled();
    expect(result.attempted).toBe(false);
    expect(result.reason).toBe('answered');
    expect(result.recoveryState).toBe('not_applicable');
  });

  // Spec test 2.
  it('invokes recovery on a high-materiality deterministic miss', async () => {
    const planner = vi.fn<RecoveryPlanner>().mockResolvedValue(GOOD_PLAN);
    const result = await planRecovery({
      envelope: buildRecoveryEnvelope({
        dealCardId: 89,
        laneId: 'zoning_land_use',
        question: 'What is the current zoning district containing APN 042-123.00-000?',
        subject: FAIRVIEW,
        methodsAlreadyTried: ['deterministic zoning collector'],
      }),
      outcome: 'PARTIAL',
      planner,
    });

    expect(planner).toHaveBeenCalledOnce();
    expect(result.attempted).toBe(true);
    expect(result.materiality).toBe('high');
    expect(result.plan?.gisLayers).toContain('Zoning');
  });

  // Spec test 3.
  it('does not launch deep research for a low-materiality miss', async () => {
    const planner = vi.fn<RecoveryPlanner>();
    const result = await planRecovery({
      envelope: buildRecoveryEnvelope({
        dealCardId: 89, laneId: 'market_intelligence', question: 'Market colour?', subject: FAIRVIEW,
      }),
      outcome: 'UNRESOLVED',
      planner,
    });

    expect(planner).not.toHaveBeenCalled();
    expect(result.reason).toBe('below_materiality_threshold');
    expect(result.budget).toBe(0);
  });

  it('leaves a blocked lane to access rather than to more searching', () => {
    const decision = decideRecovery({ laneId: 'government_records', outcome: 'BLOCKED' });
    expect(decision.attempt).toBe(false);
    expect(decision.reason).toBe('not_recoverable');
  });

  // Spec test 18.
  it('stops at the budget and cannot recurse indefinitely', async () => {
    const planner = vi.fn<RecoveryPlanner>().mockResolvedValue(GOOD_PLAN);
    const envelope = buildRecoveryEnvelope({
      dealCardId: 89, laneId: 'zoning_land_use', question: 'Current zoning?', subject: FAIRVIEW,
    });
    expect(envelope.attemptsBudget).toBe(3);

    // Spend the budget.
    const spent = await planRecovery({ envelope, outcome: 'UNRESOLVED', attemptsUsed: 3, planner });
    expect(spent.attempted).toBe(false);
    expect(spent.reason).toBe('budget_exhausted');
    expect(planner).not.toHaveBeenCalled();
    expect(spent.recoveryState).toBe('adaptive_public_research_exhausted');
  });

  it('spends exactly one attempt per pass', async () => {
    const planner = vi.fn<RecoveryPlanner>().mockResolvedValue(GOOD_PLAN);
    const envelope = buildRecoveryEnvelope({
      dealCardId: 89, laneId: 'access_utilities', question: 'Public sewer?', subject: FAIRVIEW,
    });
    const first = await planRecovery({ envelope, outcome: 'PARTIAL', attemptsUsed: 0, planner });
    expect(first.attemptsUsed).toBe(1);
    const second = await planRecovery({ envelope, outcome: 'PARTIAL', attemptsUsed: first.attemptsUsed, planner });
    expect(second.attemptsUsed).toBe(2);
    expect(planner).toHaveBeenCalledTimes(2);
  });
});

describe('a deterministic miss is not a researched unknown', () => {
  it('distinguishes recovery-not-attempted from research-exhausted', () => {
    expect(recoveryStateFor({ outcome: 'UNRESOLVED', attemptsUsed: 0, budget: 3 }))
      .toBe('recovery_not_attempted');
    expect(recoveryStateFor({ outcome: 'UNRESOLVED', attemptsUsed: 3, budget: 3 }))
      .toBe('adaptive_public_research_exhausted');
    expect(recoveryStateFor({ outcome: 'UNRESOLVED', attemptsUsed: 1, budget: 3 }))
      .toBe('recovery_in_progress');
    expect(recoveryStateFor({ outcome: 'RETURNED', attemptsUsed: 0, budget: 3 }))
      .toBe('not_applicable');
  });
});

describe('the planner directs research and never states facts', () => {
  // Spec test 4.
  it('treats a discovered source as navigation, never as authoritative fact', () => {
    expect(planIsEvidence()).toBe(false);
    const plan = parseRecoveryPlan(GOOD_PLAN);
    // Every source carries how strong it is EXPECTED to be, which is not the
    // same as evidence having been retrieved from it.
    expect(plan?.candidateSources[0].expectedAuthority).toBe('official_primary');
    expect(plan?.candidateSources[1].expectedAuthority).toBe('reputable_secondary');
  });

  it('downgrades an unlabelled source to the weakest reading, not the strongest', () => {
    const plan = parseRecoveryPlan(JSON.stringify({
      approach: 'x',
      candidateSources: [{ label: 'Some page', url: 'https://example.com', why: 'looked relevant' }],
    }));
    expect(plan?.candidateSources[0].expectedAuthority).toBe('search_result');
  });

  it('states the authority boundary in the prompt it sends', () => {
    const prompt = renderRecoveryPrompt(buildRecoveryEnvelope({
      dealCardId: 89,
      laneId: 'zoning_land_use',
      question: 'Current zoning?',
      subject: FAIRVIEW,
      methodsAlreadyTried: ['deterministic zoning collector'],
    }));
    expect(prompt).toMatch(/You do not answer the question/);
    expect(prompt).toMatch(/LandOS .*remains the sole/s);
    expect(prompt).toMatch(/do not propose toggling every layer/);
    // The failed route travels with the request so it is not proposed again.
    expect(prompt).toMatch(/ALREADY TRIED[\s\S]*deterministic zoning collector/);
    expect(prompt).toContain('042-123.00-000');
  });

  it('returns no plan rather than a fabricated one when the reply is malformed', async () => {
    const planner = vi.fn<RecoveryPlanner>().mockResolvedValue('I could not do that.');
    const result = await planRecovery({
      envelope: buildRecoveryEnvelope({
        dealCardId: 89, laneId: 'zoning_land_use', question: 'Current zoning?', subject: FAIRVIEW,
      }),
      outcome: 'UNRESOLVED',
      planner,
    });
    expect(result.plan).toBeNull();
    expect(result.notes.join(' ')).toMatch(/returned no usable plan/);
  });

  it('treats a planner outage as a failed attempt, not a failed question', async () => {
    const planner = vi.fn<RecoveryPlanner>().mockRejectedValue(new Error('hermes runtime not found'));
    const result = await planRecovery({
      envelope: buildRecoveryEnvelope({
        dealCardId: 89, laneId: 'zoning_land_use', question: 'Current zoning?', subject: FAIRVIEW,
      }),
      outcome: 'UNRESOLVED',
      planner,
    });
    expect(result.attempted).toBe(true);
    expect(result.plan).toBeNull();
    expect(result.notes.join(' ')).toMatch(/hermes runtime not found/);
  });

  it('rejects a reply that carries nothing to do', () => {
    expect(parseRecoveryPlan('{}')).toBeNull();
    expect(parseRecoveryPlan('')).toBeNull();
  });
});
