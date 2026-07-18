// Governance tests: proof-backed completion claims, the recurrence
// root-cause gate, the accepted-capability freeze, and the QA brief's
// independence from builder narrative.

import { describe, expect, it } from 'vitest';
import { addEvidence, renderLedgerReport } from './ledger.js';
import { unsupportedClaims } from './claims.js';
import {
  completeRootCauseReview,
  emptyRegistry,
  knownFailurePatternSummaries,
  patternsAwaitingRootCause,
  recordOccurrence,
  reviewRequired,
} from './recurrence.js';
import {
  capabilitiesTouchedBy,
  emptyCapabilityRegistry,
  freezeCapability,
  freezeRefusals,
  reopenProblems,
  type FreezeSpec,
} from './capabilities.js';
import { buildQaBrief, briefLeakProblems } from './qa-brief.js';
import {
  FIXED_NOW,
  driveToAwaitingQa,
  makeLedger,
  passIndependentQa,
} from './test-fixtures.js';
import {
  acceptWorkstream,
  recordFinalRegression,
  recordFinalReview,
  completeSprint,
} from './orchestrator.js';

describe('proof-backed completion claims', () => {
  it('flags completion claims without linked ledger evidence as unverified', () => {
    const ledger = makeLedger();
    const report = [
      'The Deal Card payload is implemented and working.',
      'Migration finished; everything is verified.',
    ].join('\n');
    const problems = unsupportedClaims(report, ledger);
    expect(problems).toHaveLength(2);
    expect(problems[0].problem).toContain('without a linked ledger evidence id');
  });

  it('accepts claims that cite real ledger evidence and rejects invented ids', () => {
    const ledger = makeLedger();
    const evidence = addEvidence(ledger, { kind: 'browser_journey', summary: 'journey pass' }, FIXED_NOW);
    expect(unsupportedClaims(`Deal Card verified in the live browser [E:${evidence.id}].`, ledger)).toEqual([]);
    const invented = unsupportedClaims('Deal Card verified in the live browser [E:E999].', ledger);
    expect(invented).toHaveLength(1);
    expect(invented[0].problem).toContain('not in ledger');
  });

  it('ignores negated and forward-looking statements', () => {
    const ledger = makeLedger();
    expect(
      unsupportedClaims('The report is not verified yet. Repairs remain pending before it is complete.', ledger),
    ).toEqual([]);
  });

  it('proof-links generated workstream identifiers that contain claim words', () => {
    const ledger = makeLedger();
    for (const workstream of ledger.workstreams) workstream.operatorOutcome = 'Research details are visible.';
    ledger.workstreams[0].id = 'ws-verified-research';
    ledger.workstreams[0].name = 'Verified research mission';
    const evidence = addEvidence(ledger, { kind: 'independent_browser_qa', summary: 'browser QA pass' }, FIXED_NOW);
    ledger.workstreams[0].browserQaResult = {
      result: 'pass',
      at: FIXED_NOW(),
      reportPath: 'qa/report.md',
      evidenceIds: [evidence.id],
    };
    expect(unsupportedClaims(renderLedgerReport(ledger), ledger)).toEqual([]);
  });
});

describe('recurrence root-cause gate', () => {
  it('requires a root-cause review when the same pattern occurs twice', () => {
    const registry = emptyRegistry();
    const first = recordOccurrence(registry, 'frontend-backend-divergence', {
      sprintId: 's1',
      findingId: 'F1',
      at: FIXED_NOW(),
      summary: 'acreage missing on card',
    });
    expect(first.reviewRequired).toBe(false);
    const second = recordOccurrence(registry, 'frontend-backend-divergence', {
      sprintId: 's2',
      findingId: 'F3',
      at: FIXED_NOW(),
      summary: 'comps missing on card',
    });
    expect(second.reviewRequired).toBe(true);
    expect(patternsAwaitingRootCause(registry)).toEqual(['frontend-backend-divergence']);
  });

  it('an incomplete review is rejected; a complete one clears the gate', () => {
    const registry = emptyRegistry();
    recordOccurrence(registry, 'stale-frontend-payload', { sprintId: 's1', findingId: 'F1', at: FIXED_NOW(), summary: 'a' });
    recordOccurrence(registry, 'stale-frontend-payload', { sprintId: 's2', findingId: 'F2', at: FIXED_NOW(), summary: 'b' });
    expect(() =>
      completeRootCauseReview(registry, 'stale-frontend-payload', {
        failurePattern: 'stale payload',
        sharedRootCause: '',
        whyAutomatedTestsMissedIt: '',
        whyBrowserQaMissedIt: '',
        missingInvariant: '',
        missingAcceptanceJourney: '',
        sharedRepair: '',
        newRegressionTest: '',
        newBrowserAssertion: '',
        affectedCapabilities: [],
        reopenAcceptedCapability: false,
      }, FIXED_NOW),
    ).toThrow(/incomplete/);
    completeRootCauseReview(registry, 'stale-frontend-payload', {
      failurePattern: 'stale payload served after rebuild',
      sharedRootCause: 'server caches the vite manifest',
      whyAutomatedTestsMissedIt: 'tests never compared served assets with dist',
      whyBrowserQaMissedIt: 'QA ran before the rebuild',
      missingInvariant: 'served bundle equals dist/web bundle',
      missingAcceptanceJourney: 'dashboard-shell-health',
      sharedRepair: 'bundle-freshness preflight check',
      newRegressionTest: 'operator-qa-runner bundle test',
      newBrowserAssertion: 'live_frontend_bundle_current preflight',
      affectedCapabilities: ['platform'],
      reopenAcceptedCapability: false,
    }, FIXED_NOW);
    expect(reviewRequired(registry, 'stale-frontend-payload')).toBe(false);
    expect(patternsAwaitingRootCause(registry)).toEqual([]);
  });

  it('a recurrence after a completed review re-triggers the gate', () => {
    const registry = emptyRegistry();
    recordOccurrence(registry, 'refresh-data-loss', { sprintId: 's1', findingId: 'F1', at: FIXED_NOW(), summary: 'a' });
    recordOccurrence(registry, 'refresh-data-loss', { sprintId: 's2', findingId: 'F2', at: FIXED_NOW(), summary: 'b' });
    completeRootCauseReview(registry, 'refresh-data-loss', {
      failurePattern: 'p', sharedRootCause: 'c', whyAutomatedTestsMissedIt: 'w', whyBrowserQaMissedIt: 'w',
      missingInvariant: 'i', missingAcceptanceJourney: 'j', sharedRepair: 'r', newRegressionTest: 't',
      newBrowserAssertion: 'a', affectedCapabilities: [], reopenAcceptedCapability: false,
    }, FIXED_NOW);
    recordOccurrence(registry, 'refresh-data-loss', { sprintId: 's3', findingId: 'F9', at: FIXED_NOW(), summary: 'c' });
    expect(reviewRequired(registry, 'refresh-data-loss')).toBe(true);
    expect(knownFailurePatternSummaries(registry)[0]).toContain('ROOT-CAUSE REVIEW OUTSTANDING');
  });
});

function completedLedger() {
  const ledger = makeLedger();
  for (const wsId of ['ws1', 'ws2']) {
    driveToAwaitingQa(ledger, wsId);
    passIndependentQa(ledger, wsId);
    acceptWorkstream(ledger, wsId, undefined, FIXED_NOW);
  }
  const evidence = addEvidence(ledger, { kind: 'final_regression', summary: 'combined pass' }, FIXED_NOW);
  recordFinalRegression(ledger, { result: 'pass', detail: 'combined', evidenceIds: [evidence.id] }, FIXED_NOW);
  recordFinalReview(ledger, { result: 'pass', detail: 'ok', evidenceIds: [evidence.id], reviewer: 'landos-final-reviewer' }, FIXED_NOW);
  completeSprint(ledger, FIXED_NOW);
  return ledger;
}

const freezeSpec: FreezeSpec = {
  id: 'deal-card-v2',
  name: 'Deal Card v2',
  department: 'acquisitions',
  acceptedVersion: '0bbf16c',
  goldenJourneyIds: ['verified-property-strong-evidence'],
  regressionFixtures: ['fixture-a'],
  sharedInvariants: ['frontend equals backend payload'],
  browserAssertions: ['card renders verified evidence'],
  proofArtifacts: ['.runtime/landos/qa/run/report.json'],
  knownLimitations: [],
  deliberateExternalBlockers: [],
  sharedDependencyPaths: ['src/landos/deal-card-report.ts'],
  tylerAcceptance: { required: false, grantedAt: null },
};

describe('accepted-capability freeze', () => {
  it('refuses to freeze a capability from an unproven sprint', () => {
    const ledger = makeLedger();
    const refusals = freezeRefusals(ledger, freezeSpec);
    expect(refusals.join(' ')).toContain('final combined regression did not pass');
  });

  it('freezes an accepted capability with regression protection and guards reopening', () => {
    const registry = emptyCapabilityRegistry();
    const ledger = completedLedger();
    const capability = freezeCapability(registry, ledger, freezeSpec, FIXED_NOW);
    expect(capability.acceptedAt).toBe(FIXED_NOW());
    expect(() => freezeCapability(registry, ledger, freezeSpec, FIXED_NOW)).toThrow(/already frozen/);
    expect(
      reopenProblems(registry, 'deal-card-v2', { reason: 'approved_enhancement', justification: 'add export', approvedBy: '' }).join(' '),
    ).toContain('requires explicit approval');
    expect(
      reopenProblems(registry, 'deal-card-v2', { reason: 'verified_regression', justification: 'journey verified-property-strong-evidence fails on comps tab' }),
    ).toEqual([]);
  });

  it('flags protected journeys when shared dependency paths change', () => {
    const registry = emptyCapabilityRegistry();
    const ledger = completedLedger();
    freezeCapability(registry, ledger, freezeSpec, FIXED_NOW);
    const touched = capabilitiesTouchedBy(registry, ['src/landos/deal-card-report.ts', 'src/unrelated.ts']);
    expect(touched).toHaveLength(1);
    expect(touched[0].journeyIds).toEqual(['verified-property-strong-evidence']);
    expect(capabilitiesTouchedBy(registry, ['src/unrelated.ts'])).toEqual([]);
  });
});

describe('QA brief independence', () => {
  it('contains requirements and journey but never the builder narrative', () => {
    const ledger = makeLedger();
    ledger.workstreams[0].builderResult = 'Everything is implemented perfectly and fully verified, trust me.';
    const brief = buildQaBrief('C:/repo', ledger, 'ws1', {
      liveUrl: 'http://localhost:3141/landos?token=secret123',
      acceptedFacts: ['APN 123-45-678 is 12.5 acres'],
    });
    expect(brief.requirements[0].text).toContain('visible in the live browser');
    expect(brief.liveUrl).not.toContain('secret123');
    expect(JSON.stringify(brief)).not.toContain('trust me');
    expect(briefLeakProblems(brief, ledger)).toEqual([]);
    expect(brief.mandate.join(' ')).toContain('prove the implementation wrong');
  });
});
