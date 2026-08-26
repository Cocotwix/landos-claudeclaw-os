// Focused proof of the bounded intelligence → capability → reconciliation
// seam: structured requests derive only from persisted unresolved material
// conflicts, validation is deny-by-default and deal-scoped, the orchestrator
// executes at most one capability and one targeted re-read, and remaining
// uncertainty stops honestly instead of researching recursively.

import { describe, expect, it, vi } from 'vitest';

import type { CapabilityResult } from './capability-contract.js';
import {
  FRESH_EVIDENCE_DAYS,
  derivePropertyCapabilityRequests,
  projectCurrentIntelligenceReconciliation,
  runIntelligenceReconciliation,
  validateIntelligenceCapabilityRequest,
  type IntelligenceCapabilityRequest,
  type IntelligenceReconciliationRecord,
  type ReconciliationDeps,
} from './intelligence-capability-reconcile.js';

const FAIRVIEW_IMPROVEMENT_CONFLICT = {
  subject: 'Recorded improvement versus visible condition',
  statement: 'Record claim: Retained parcel evidence records an improvement of approximately 1,534 square feet built in 1968. — Grounded visual observation: No dwelling, manufactured home, or other structure is visible in retained imagery (vision_improvements).',
  resolution: 'Plausible explanations include a stale assessor record, a removed structure, or stale imagery. Recommended verification: Obtain the current official assessor improvement detail for APN 042-123.00-000.',
};

const ACREAGE_CONFLICT = {
  subject: 'acreage',
  statement: 'Retained acreage differs across sources: 75.91 ac (Canonical parcel identity) vs 50.69 ac (Provider record).',
  resolution: 'Unresolved. No retained source outranks the others for parcel area.',
};

const RESOLVED_CONFLICT = {
  subject: 'valuation',
  statement: 'The LandOS comp-based value and the LandPortal estimate differ materially.',
  resolution: 'The LandPortal estimate is an additional source indication only; the LandOS comp-based valuation remains the working value.',
};

function product(conflicts = [FAIRVIEW_IMPROVEMENT_CONFLICT], read = 'Before read.') {
  return { conflicts, read };
}

function capabilityResult(overrides: Partial<CapabilityResult> & { facts?: Record<string, unknown> } = {}): CapabilityResult {
  return {
    invocationId: 'cap_test',
    capability: { id: 'assessor-tax', name: 'Assessor & Tax', contractVersion: '1.0', description: '' },
    status: 'SUCCEEDED',
    subjectResolution: 'RESOLVED',
    canonicalSubject: null,
    facts: { recordStatus: 'official_record_retrieved', summary: 'Official record retrieved.' },
    evidence: [{ source: 'County assessor', sourceUrl: null, retrievedAt: '2026-08-21T00:00:00.000Z' }],
    warnings: [],
    missingInformation: [],
    timestamps: { startedAt: '2026-08-21T00:00:00.000Z', completedAt: '2026-08-21T00:00:05.000Z' },
    execution: { mode: 'refresh', durationMs: 5000, reused: false },
    ...overrides,
    ...(overrides.facts ? { facts: overrides.facts as CapabilityResult['facts'] } : {}),
  } as CapabilityResult;
}

const validationContext = (overrides: Partial<Parameters<typeof validateIntelligenceCapabilityRequest>[1]> = {}) => ({
  dealCardId: 89,
  openConflictSubjects: [FAIRVIEW_IMPROVEMENT_CONFLICT.subject, ACREAGE_CONFLICT.subject],
  capabilityExists: (id: string) => id === 'assessor-tax',
  latestResult: () => null,
  ...overrides,
});

describe('current reconciliation projection', () => {
  const record = {
    completedAt: '2026-08-23T12:00:00.000Z',
  } as IntelligenceReconciliationRecord;

  it('retains a reconciliation beside the product produced by that run', () => {
    expect(projectCurrentIntelligenceReconciliation(record, {
      generatedAt: '2026-08-23T11:59:59.000Z',
    })).toBe(record);
  });

  it('suppresses the retained record once a newer specialist read supersedes it', () => {
    expect(projectCurrentIntelligenceReconciliation(record, {
      generatedAt: '2026-08-24T12:00:00.000Z',
    })).toBeNull();
  });
});

describe('derivePropertyCapabilityRequests', () => {
  it('emits a valid deal-scoped structured request for the improvement conflict, servicing it with assessor-tax', () => {
    const requests = derivePropertyCapabilityRequests(product(), 89);
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request.intelligenceLayer).toBe('property');
    expect(request.dealCardId).toBe(89);
    expect(request.issueType).toBe('current_improvement_conflict');
    expect(request.requestedCapability).toBe('assessor-tax');
    expect(request.question).toContain('current official assessor improvement detail');
    expect(request.reasonMaterial).toContain('1,534 square feet');
    expect(request.evidenceConflictRefs).toEqual([FAIRVIEW_IMPROVEMENT_CONFLICT.subject]);
  });

  it('maps an acreage conflict to official parcel evidence and never to averaging', () => {
    const requests = derivePropertyCapabilityRequests(product([ACREAGE_CONFLICT]), 12);
    expect(requests).toHaveLength(1);
    expect(requests[0].issueType).toBe('acreage_conflict');
    expect(requests[0].requestedCapability).toBe('assessor-tax');
    expect(requests[0].expectedResolution).toMatch(/never averaged/i);
  });

  it('ignores conflicts already resolved by provenance and subjects it has no doctrine for', () => {
    expect(derivePropertyCapabilityRequests(product([RESOLVED_CONFLICT]), 89)).toHaveLength(0);
    expect(derivePropertyCapabilityRequests(product([{ subject: 'frontage', statement: 'Frontage differs.', resolution: 'Unresolved. Needs a survey.' }]), 89)).toHaveLength(0);
  });
});

describe('validateIntelligenceCapabilityRequest', () => {
  const request = (): IntelligenceCapabilityRequest => derivePropertyCapabilityRequests(product(), 89)[0];

  it('refuses an arbitrary non-allowlisted capability', () => {
    const rogue = { ...request(), requestedCapability: 'landportal-comp-search' };
    const verdict = validateIntelligenceCapabilityRequest(rogue, validationContext({
      capabilityExists: () => true,
    }));
    expect(verdict.ok).toBe(false);
    expect(verdict.decision).toBe('refused');
    if (!verdict.ok) expect(verdict.refusalReason).toMatch(/not allowlisted/);
  });

  it('refuses a capability that does not exist in the registry', () => {
    const rogue = { ...request(), requestedCapability: 'invented-tool' };
    const verdict = validateIntelligenceCapabilityRequest(rogue, validationContext());
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.refusalReason).toMatch(/not a registered/);
  });

  it('refuses cross-deal invocation: deal A cannot invoke against deal B', () => {
    const verdict = validateIntelligenceCapabilityRequest(request(), validationContext({ dealCardId: 42 }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.refusalReason).toMatch(/Cross-deal invocation is refused/);
  });

  it('refuses a request that references no unresolved material conflict', () => {
    const verdict = validateIntelligenceCapabilityRequest(request(), validationContext({ openConflictSubjects: ['something else'] }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.refusalReason).toMatch(/not materially relevant/);
  });

  it('suppresses a rerun when sufficiently fresh official evidence already answers', () => {
    const verdict = validateIntelligenceCapabilityRequest(request(), validationContext({
      latestResult: () => capabilityResult(),
      now: () => new Date('2026-08-25T00:00:00.000Z'),
    }));
    expect(verdict.ok).toBe(true);
    expect(verdict.decision).toBe('reuse_evidence');
  });

  it('executes when the only retained result is stale or never answered officially', () => {
    const stale = validateIntelligenceCapabilityRequest(request(), validationContext({
      latestResult: () => capabilityResult(),
      now: () => new Date(Date.parse('2026-08-21T00:00:05.000Z') + (FRESH_EVIDENCE_DAYS + 1) * 86_400_000),
    }));
    expect(stale.decision).toBe('execute');
    const unanswered = validateIntelligenceCapabilityRequest(request(), validationContext({
      latestResult: () => capabilityResult({ status: 'NEEDS_INPUT', facts: { recordStatus: 'not_retrieved' } }),
    }));
    expect(unanswered.decision).toBe('execute');
  });
});

// ── The bounded orchestrator ───────────────────────────────────────────────

function makeDeps(overrides: Partial<ReconciliationDeps> = {}) {
  const persisted: unknown[] = [];
  const deps: ReconciliationDeps & { persisted: unknown[] } = {
    readPropertyProduct: vi.fn(() => product()),
    validate: vi.fn((request, open) => validateIntelligenceCapabilityRequest(request, validationContext({ openConflictSubjects: open }))),
    invokeCapability: vi.fn(async () => capabilityResult()),
    rereadIntelligence: vi.fn(async () => ({ outcome: 'produced', refreshedLayers: ['property', 'deal'] })),
    persistRecord: vi.fn((record) => { persisted.push(record); }),
    persisted,
    ...overrides,
  };
  return deps;
}

describe('runIntelligenceReconciliation', () => {
  it('executes exactly ONE capability and ONE targeted re-read, then stops', async () => {
    const deps = makeDeps({
      // Two eligible conflicts: still one execution, one re-read.
      readPropertyProduct: vi.fn(() => product([FAIRVIEW_IMPROVEMENT_CONFLICT, ACREAGE_CONFLICT])),
    });
    const record = await runIntelligenceReconciliation({ dealCardId: 89 }, deps);
    expect(deps.invokeCapability).toHaveBeenCalledTimes(1);
    expect(deps.rereadIntelligence).toHaveBeenCalledTimes(1);
    expect(record.execution.executionCount).toBe(1);
    expect(record.reread.rereadCount).toBe(1);
    expect(deps.persistRecord).toHaveBeenCalledTimes(1);
  });

  it('a refused request is persisted with its reason and runs nothing — no substitute search', async () => {
    const deps = makeDeps({
      validate: vi.fn(() => ({ ok: false as const, decision: 'refused' as const, refusalReason: 'not allowlisted' })),
    });
    const record = await runIntelligenceReconciliation({ dealCardId: 89 }, deps);
    expect(record.status).toBe('refused');
    expect(record.validation.refusalReason).toBe('not allowlisted');
    expect(record.statusReason).toMatch(/No substitute research was run/);
    expect(deps.invokeCapability).not.toHaveBeenCalled();
    expect(deps.rereadIntelligence).not.toHaveBeenCalled();
  });

  it('fresh existing evidence is reused: re-read happens, capability does not run again', async () => {
    const deps = makeDeps({
      validate: vi.fn(() => ({ ok: true as const, decision: 'reuse_evidence' as const, existingInvocationId: 'cap_prior' })),
      readPropertyProduct: vi.fn()
        .mockReturnValueOnce(product())
        .mockReturnValue(product([], 'Reconciled read.')),
    });
    const record = await runIntelligenceReconciliation({ dealCardId: 89 }, deps);
    expect(deps.invokeCapability).not.toHaveBeenCalled();
    expect(record.execution.executionCount).toBe(0);
    expect(record.execution.reusedExistingEvidence).toBe(true);
    expect(record.reread.rereadCount).toBe(1);
    expect(record.status).toBe('resolved');
  });

  it('new official evidence can change the interpretation while both sides of the old evidence survive', async () => {
    const after = product([], 'The official record shows land only; the older provider improvement claim is likely historical and stays retained as source evidence.');
    const deps = makeDeps({
      readPropertyProduct: vi.fn()
        .mockReturnValueOnce(product())
        .mockReturnValue(after),
    });
    const record = await runIntelligenceReconciliation({ dealCardId: 89 }, deps);
    expect(record.status).toBe('resolved');
    // Provenance survives reconciliation: the record carries the OLD claim and
    // the NEW conclusion side by side; nothing overwrote the history.
    expect(record.before.conflictStatement).toContain('1,534 square feet');
    expect(record.after.read).toContain('likely historical');
    expect(record.before.read).toBe('Before read.');
  });

  it('an official record that still carries the improvement leaves the conflict partially resolved, not blindly adopted', async () => {
    const stillConflicted = product([{
      ...FAIRVIEW_IMPROVEMENT_CONFLICT,
      resolution: 'The official record still reports the improvement but conflicts with grounded imagery; the official record may itself be stale. Recommended verification: confirm during seller discovery or a site inspection.',
    }], 'Reconciled but still conflicted.');
    const deps = makeDeps({
      readPropertyProduct: vi.fn()
        .mockReturnValueOnce(product())
        .mockReturnValue(stillConflicted),
    });
    const record = await runIntelligenceReconciliation({ dealCardId: 89 }, deps);
    expect(record.status).toBe('partially_resolved');
    expect(record.readiness).toBe('yellow');
    expect(record.recommendedNextAction).toMatch(/seller discovery/);
  });

  it('a bounded attempt that retrieves nothing stays honestly unresolved and does not chase permits or rerun', async () => {
    const deps = makeDeps({
      invokeCapability: vi.fn(async () => capabilityResult({
        status: 'NEEDS_INPUT',
        facts: { recordStatus: 'not_retrieved', summary: 'No assessor or tax record has been retrieved for this subject.' },
        warnings: ['No official parcel source returned an assessor record.'],
      })),
    });
    const record = await runIntelligenceReconciliation({ dealCardId: 89 }, deps);
    expect(record.status).toBe('unresolved');
    expect(record.readiness).toBe('yellow');
    expect(record.statusReason).toMatch(/never treated as proof/i);
    // STOP means stop: one invocation, one re-read, nothing else.
    expect(deps.invokeCapability).toHaveBeenCalledTimes(1);
    expect(deps.rereadIntelligence).toHaveBeenCalledTimes(1);
  });

  it('a failing capability invocation is recorded as the unresolved outcome, never retried', async () => {
    const deps = makeDeps({
      invokeCapability: vi.fn(async () => { throw new Error('adapter unreachable'); }),
    });
    const record = await runIntelligenceReconciliation({ dealCardId: 89 }, deps);
    expect(record.status).toBe('unresolved');
    expect(record.statusReason).toContain('adapter unreachable');
    expect(deps.invokeCapability).toHaveBeenCalledTimes(1);
  });

  it('with no supported unresolved conflict it records no_material_request and runs nothing', async () => {
    const deps = makeDeps({ readPropertyProduct: vi.fn(() => product([RESOLVED_CONFLICT])) });
    const record = await runIntelligenceReconciliation({ dealCardId: 89 }, deps);
    expect(record.status).toBe('no_material_request');
    expect(deps.invokeCapability).not.toHaveBeenCalled();
    expect(deps.rereadIntelligence).not.toHaveBeenCalled();
  });

  it('every run is deal-scoped and explicitly operator-triggered on the record', async () => {
    const deps = makeDeps();
    const record = await runIntelligenceReconciliation({ dealCardId: 89 }, deps);
    expect(record.dealCardId).toBe(89);
    expect(record.trigger).toBe('operator_reconcile');
    expect(record.request?.dealCardId).toBe(89);
  });
});
