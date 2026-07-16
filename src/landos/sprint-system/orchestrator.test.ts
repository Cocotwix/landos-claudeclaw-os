// Staged-orchestrator tests: lifecycle ordering, the browser-QA gate between
// workstreams, the repair loop with mandatory retests, the ten acceptance
// refusal conditions, and sprint-level final regression/review requirements.

import { describe, expect, it } from 'vitest';
import { addEvidence, openFindings } from './ledger.js';
import {
  acceptWorkstream,
  beginRepair,
  completeSprint,
  completeSprintRefusals,
  markExternallyBlocked,
  recordBrowserQaResult,
  recordFinalRegression,
  recordFinalReview,
  recordPhase,
  recordRepair,
  retestFinding,
  startWorkstream,
  startWorkstreamProblems,
  verifyRequirement,
  workstreamAcceptanceRefusals,
} from './orchestrator.js';
import {
  FIXED_NOW,
  driveToAwaitingQa,
  makeLedger,
  passIndependentQa,
  sampleFinding,
} from './test-fixtures.js';

describe('staged workstream ordering', () => {
  it('refuses to start workstream 2 before workstream 1 passes browser QA', () => {
    const ledger = makeLedger();
    startWorkstream(ledger, 'ws1', FIXED_NOW);
    const problems = startWorkstreamProblems(ledger, 'ws2');
    expect(problems.join(' ')).toMatch(/dependency ws1 is implementing/);
    expect(() => startWorkstream(ledger, 'ws2', FIXED_NOW)).toThrow(/cannot start ws2/);
  });

  it('refuses a second in-flight workstream even without a dependency edge', () => {
    const ledger = makeLedger();
    ledger.workstreams[1].dependsOn = [];
    startWorkstream(ledger, 'ws1', FIXED_NOW);
    expect(() => startWorkstream(ledger, 'ws2', FIXED_NOW)).toThrow(/ws1 is still implementing/);
  });

  it('allows workstream 2 once workstream 1 passed browser QA and acceptance', () => {
    const ledger = makeLedger();
    driveToAwaitingQa(ledger, 'ws1');
    passIndependentQa(ledger, 'ws1');
    acceptWorkstream(ledger, 'ws1', undefined, FIXED_NOW);
    expect(ledger.workstreams[0].status).toBe('browser_qa_passed');
    expect(startWorkstreamProblems(ledger, 'ws2')).toEqual([]);
    startWorkstream(ledger, 'ws2', FIXED_NOW);
    expect(ledger.workstreams[1].status).toBe('implementing');
  });

  it('enforces phase order: no browser QA before managed runtime verification', () => {
    const ledger = makeLedger();
    startWorkstream(ledger, 'ws1', FIXED_NOW);
    recordPhase(ledger, 'ws1', 'implementation', { status: 'pass', detail: 'ok' }, FIXED_NOW);
    expect(() =>
      recordPhase(ledger, 'ws1', 'browser_qa', { status: 'pass', detail: 'qa' }, FIXED_NOW),
    ).toThrow(/targeted_tests has not run/);
    expect(() =>
      recordPhase(ledger, 'ws1', 'production_build', { status: 'pass', detail: 'build' }, FIXED_NOW),
    ).toThrow(/targeted_tests has not run/);
  });

  it('blocks later phases while an earlier phase is failing', () => {
    const ledger = makeLedger();
    startWorkstream(ledger, 'ws1', FIXED_NOW);
    recordPhase(ledger, 'ws1', 'implementation', { status: 'pass', detail: 'ok' }, FIXED_NOW);
    recordPhase(ledger, 'ws1', 'targeted_tests', { status: 'fail', detail: '2 failing' }, FIXED_NOW);
    expect(() =>
      recordPhase(ledger, 'ws1', 'integration_tests', { status: 'pass', detail: 'ok' }, FIXED_NOW),
    ).toThrow(/targeted_tests last failed/);
  });
});

describe('browser-QA gate and repair loop', () => {
  it('requires browser QA before acceptance', () => {
    const ledger = makeLedger();
    driveToAwaitingQa(ledger, 'ws1');
    const refusals = workstreamAcceptanceRefusals(ledger, 'ws1');
    expect(refusals.join(' ')).toContain('independent browser QA has not run');
  });

  it('a failed browser QA returns the work to the builder with structured findings', () => {
    const ledger = makeLedger();
    driveToAwaitingQa(ledger, 'ws1');
    const created = recordBrowserQaResult(
      ledger,
      'ws1',
      { result: 'fail', reportPath: 'qa/report.md', evidenceIds: [], findings: [sampleFinding()] },
      FIXED_NOW,
    );
    expect(ledger.workstreams[0].status).toBe('browser_qa_failed');
    expect(created[0].status).toBe('open');
    expect(created[0].liveUrl).not.toContain('token=');
    expect(() => acceptWorkstream(ledger, 'ws1', undefined, FIXED_NOW)).toThrow(/unresolved QA findings/);
  });

  it('a failing QA without findings is rejected — no vague failures', () => {
    const ledger = makeLedger();
    driveToAwaitingQa(ledger, 'ws1');
    expect(() =>
      recordBrowserQaResult(ledger, 'ws1', { result: 'fail', reportPath: 'r.md', evidenceIds: [], findings: [] }, FIXED_NOW),
    ).toThrow(/at least one structured finding/);
  });

  it('findings cannot be closed without a repair and a retest', () => {
    const ledger = makeLedger();
    driveToAwaitingQa(ledger, 'ws1');
    const [finding] = recordBrowserQaResult(
      ledger,
      'ws1',
      { result: 'fail', reportPath: 'qa/report.md', evidenceIds: [], findings: [sampleFinding()] },
      FIXED_NOW,
    );
    const evidence = addEvidence(ledger, { kind: 'browser_journey', summary: 'retest run', workstreamId: 'ws1' }, FIXED_NOW);
    expect(() => retestFinding(ledger, finding.id, { result: 'pass', evidenceId: evidence.id }, FIXED_NOW)).toThrow(
      /a repair must be recorded before a retest/,
    );
    expect(() => recordRepair(ledger, finding.id, { summary: 'fixed payload', regressionCoverage: '' }, FIXED_NOW)).toThrow(
      /must name its regression coverage/,
    );
    recordRepair(ledger, finding.id, { summary: 'fixed shared payload builder', regressionCoverage: 'deal-card payload regression test' }, FIXED_NOW);
    expect(ledger.findings[0].status).toBe('repaired_awaiting_retest');
    expect(ledger.workstreams[0].status).toBe('repairing');
    expect(openFindings(ledger, 'ws1')).toHaveLength(1);
    retestFinding(ledger, finding.id, { result: 'pass', evidenceId: evidence.id }, FIXED_NOW);
    expect(ledger.findings[0].status).toBe('closed_retested');
  });

  it('a failed retest reopens the finding', () => {
    const ledger = makeLedger();
    driveToAwaitingQa(ledger, 'ws1');
    const [finding] = recordBrowserQaResult(
      ledger,
      'ws1',
      { result: 'fail', reportPath: 'qa/report.md', evidenceIds: [], findings: [sampleFinding()] },
      FIXED_NOW,
    );
    recordRepair(ledger, finding.id, { summary: 'attempt', regressionCoverage: 'test added' }, FIXED_NOW);
    const evidence = addEvidence(ledger, { kind: 'browser_journey', summary: 'retest run', workstreamId: 'ws1' }, FIXED_NOW);
    retestFinding(ledger, finding.id, { result: 'fail', evidenceId: evidence.id }, FIXED_NOW);
    expect(ledger.findings[0].status).toBe('open');
  });

  it('a QA recheck cannot pass while findings still await retest', () => {
    const ledger = makeLedger();
    driveToAwaitingQa(ledger, 'ws1');
    const [finding] = recordBrowserQaResult(
      ledger,
      'ws1',
      { result: 'fail', reportPath: 'qa/report.md', evidenceIds: [], findings: [sampleFinding()] },
      FIXED_NOW,
    );
    beginRepair(ledger, 'ws1', FIXED_NOW);
    recordRepair(ledger, finding.id, { summary: 'fix', regressionCoverage: 'regression test' }, FIXED_NOW);
    expect(() =>
      recordBrowserQaResult(ledger, 'ws1', { result: 'pass', reportPath: 'qa/recheck.md', evidenceIds: [], findings: [], recheck: true }, FIXED_NOW),
    ).toThrow(/unresolved or awaiting retest/);
  });
});

describe('the ten acceptance refusals', () => {
  it('refuses acceptance for missing persistence proof and unverified requirements', () => {
    const ledger = makeLedger();
    driveToAwaitingQa(ledger, 'ws1');
    const qa = addEvidence(ledger, { kind: 'independent_browser_qa', summary: 'qa pass', workstreamId: 'ws1' }, FIXED_NOW);
    recordBrowserQaResult(ledger, 'ws1', { result: 'pass', reportPath: 'qa/r.md', evidenceIds: [qa.id], findings: [] }, FIXED_NOW);
    const refusals = workstreamAcceptanceRefusals(ledger, 'ws1');
    expect(refusals.join(' ')).toContain('required proof missing: screenshot');
    expect(refusals.join(' ')).toContain('refresh persistence was required but not tested');
    expect(refusals.join(' ')).toContain('requirement ws1-R1 is unverified');
  });

  it('refuses to treat an internally fixable defect as an external blocker', () => {
    const ledger = makeLedger();
    driveToAwaitingQa(ledger, 'ws1');
    recordBrowserQaResult(
      ledger,
      'ws1',
      {
        result: 'fail',
        reportPath: 'qa/r.md',
        evidenceIds: [],
        findings: [sampleFinding({ disposition: 'external', externalJustification: '', externalApprovedBy: 'builder' })],
      },
      FIXED_NOW,
    );
    const refusals = workstreamAcceptanceRefusals(ledger, 'ws1');
    expect(refusals.join(' ')).toContain('labeled external without independent justification');
  });

  it('refuses acceptance while a recurred failure pattern awaits root-cause review', () => {
    const ledger = makeLedger();
    driveToAwaitingQa(ledger, 'ws1');
    recordBrowserQaResult(
      ledger,
      'ws1',
      { result: 'fail', reportPath: 'qa/r.md', evidenceIds: [], findings: [sampleFinding()] },
      FIXED_NOW,
    );
    const refusals = workstreamAcceptanceRefusals(ledger, 'ws1', {
      patternsAwaitingRootCause: ['frontend-backend-divergence'],
    });
    expect(refusals.join(' ')).toContain('root-cause review');
  });

  it('an external block requires non-builder approval and a justification', () => {
    const ledger = makeLedger();
    expect(() => markExternallyBlocked(ledger, 'ws1', { justification: '', approvedBy: 'Tyler' }, FIXED_NOW)).toThrow();
    expect(() =>
      markExternallyBlocked(ledger, 'ws1', { justification: 'County GIS endpoint is down', approvedBy: 'builder' }, FIXED_NOW),
    ).toThrow(/non-builder approval/);
    markExternallyBlocked(ledger, 'ws1', { justification: 'County GIS endpoint is down', approvedBy: 'Tyler' }, FIXED_NOW);
    expect(ledger.workstreams[0].status).toBe('externally_blocked');
  });
});

describe('final regression, final review, completion', () => {
  function ledgerWithBothPassed() {
    const ledger = makeLedger();
    driveToAwaitingQa(ledger, 'ws1');
    passIndependentQa(ledger, 'ws1');
    acceptWorkstream(ledger, 'ws1', undefined, FIXED_NOW);
    driveToAwaitingQa(ledger, 'ws2');
    passIndependentQa(ledger, 'ws2');
    acceptWorkstream(ledger, 'ws2', undefined, FIXED_NOW);
    return ledger;
  }

  it('final regression cannot run while any workstream has not passed browser QA', () => {
    const ledger = makeLedger();
    driveToAwaitingQa(ledger, 'ws1');
    expect(() =>
      recordFinalRegression(ledger, { result: 'pass', detail: 'x', evidenceIds: ['E1'] }, FIXED_NOW),
    ).toThrow(/every workstream must pass browser QA/);
  });

  it('the sprint cannot complete without final regression and an independent final review', () => {
    const ledger = ledgerWithBothPassed();
    expect(completeSprintRefusals(ledger)).toContain('final combined regression has not run');
    const evidence = addEvidence(ledger, { kind: 'final_regression', summary: 'combined journey pass' }, FIXED_NOW);
    recordFinalRegression(ledger, { result: 'pass', detail: 'combined pass', evidenceIds: [evidence.id] }, FIXED_NOW);
    expect(completeSprintRefusals(ledger)).toContain('independent final review has not run');
    expect(() =>
      recordFinalReview(ledger, { result: 'pass', detail: 'ok', evidenceIds: [evidence.id], reviewer: 'builder' }, FIXED_NOW),
    ).toThrow(/distinct from the builder/);
    recordFinalReview(ledger, { result: 'pass', detail: 'reviewed live', evidenceIds: [evidence.id], reviewer: 'landos-final-reviewer' }, FIXED_NOW);
    expect(completeSprintRefusals(ledger)).toEqual([]);
    completeSprint(ledger, FIXED_NOW);
    expect(ledger.sprintStatus).toBe('complete');
    expect(ledger.workstreams.every((ws) => ws.finalAcceptance === 'accepted')).toBe(true);
  });

  it('a failed final review blocks completion', () => {
    const ledger = ledgerWithBothPassed();
    const evidence = addEvidence(ledger, { kind: 'final_regression', summary: 'combined run' }, FIXED_NOW);
    recordFinalRegression(ledger, { result: 'pass', detail: 'combined', evidenceIds: [evidence.id] }, FIXED_NOW);
    recordFinalReview(ledger, { result: 'fail', detail: 'cross-workstream regression', evidenceIds: [evidence.id], reviewer: 'landos-final-reviewer' }, FIXED_NOW);
    expect(() => completeSprint(ledger, FIXED_NOW)).toThrow(/independent final review failed/);
  });
});
