import { describe, expect, it } from 'vitest';

import type {
  ExpectedKnowledgeSubject,
  KnowledgeReadBundle,
  KnowledgeReadItem,
  KnowledgeReadState,
  LandosKnowledgeRecord,
} from './knowledge-contract.js';
import {
  buildKnowledgeResearchPlan,
  normalizeJurisdictionSourceLocator,
} from './knowledge-research-planner.js';

const EXPECTED: ExpectedKnowledgeSubject[] = [
  { subjectKey: 'authority.zoning', label: 'Zoning Authority', providerLane: 'jurisdiction_authority' },
  { subjectKey: 'subdivision.minimum_frontage', label: 'Minimum Frontage', providerLane: 'subdivision_rules' },
  { subjectKey: 'subdivision.plat_requirement', label: 'Plat Requirement', providerLane: 'subdivision_rules' },
];

function item(subjectKey: string, state: KnowledgeReadState, input: {
  id?: string;
  drifted?: boolean;
  accepted?: boolean;
} = {}): KnowledgeReadItem {
  return {
    state,
    record: {
      id: input.id ?? `kn_${subjectKey}_${state}`,
      domain: 'jurisdiction', knowledgeType: 'factual', scopeKind: 'jurisdiction',
      scopeKey: 'TN:municipal:test', subjectKey, statement: subjectKey, value: subjectKey,
      sourceAuthority: 'official_government_source', confidence: 'confirmed', status:
        state === 'CONFLICTING' ? 'conflicting'
          : state === 'UNRESOLVED' ? 'unresolved'
            : state === 'SUPERSEDED' ? 'superseded' : 'active',
      sensitivity: 'public', effectiveFrom: null, effectiveTo: null,
      retrievedAt: '2026-08-01T00:00:00.000Z', lastVerifiedAt: '2026-08-01T00:00:00.000Z',
      freshnessPolicy: 'jurisdiction_procedure', freshUntil: '2027-02-01T00:00:00.000Z',
      supersedesKnowledgeId: null, disputeGroup: null, contentHash: subjectKey,
      compilerVersion: 'test', createdBy: 'test', acceptanceReason: 'fixture',
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    } as LandosKnowledgeRecord,
    sources: [{
      evidenceNamespace: 'property_evidence', evidenceRef: '1', role: 'supports',
      label: 'Official source', url: 'https://example.gov/rules', retrievedAt: '2026-08-01T00:00:00.000Z',
      fingerprintDrifted: input.drifted ?? false,
      supportStillAccepted: input.accepted ?? true,
    }],
  };
}

function bundle(items: KnowledgeReadItem[]): KnowledgeReadBundle {
  return {
    scopeKind: 'jurisdiction', scopeKey: 'TN:municipal:test', subjectPrefix: null, items,
    counts: {
      current: items.filter((row) => row.state === 'CURRENT').length,
      stale: items.filter((row) => row.state === 'STALE').length,
      conflicting: items.filter((row) => row.state === 'CONFLICTING').length,
      unresolved: items.filter((row) => row.state === 'UNRESOLVED').length,
      superseded: items.filter((row) => row.state === 'SUPERSEDED').length,
    },
    retrievedInMs: 1, modelCalls: 0, researchRuns: 0,
  };
}

describe('shared knowledge-aware research planner', () => {
  it('plans current, stale, missing and conflict states independently', () => {
    const plan = buildKnowledgeResearchPlan(bundle([
      item('authority.zoning', 'CURRENT'),
      item('subdivision.minimum_frontage', 'STALE'),
      item('subdivision.plat_requirement', 'CONFLICTING'),
    ]), [...EXPECTED, {
      subjectKey: 'subdivision.recording_requirement', label: 'Recording', providerLane: 'subdivision_rules',
    }]);

    expect(Object.fromEntries(plan.subjects.map((row) => [row.subjectKey, row.decision]))).toEqual({
      'authority.zoning': 'REUSE',
      'subdivision.minimum_frontage': 'REFRESH',
      'subdivision.plat_requirement': 'BLOCKED_CONFLICT',
      'subdivision.recording_requirement': 'RESEARCH_NEW',
    });
    expect(plan.researchEligibleSubjectKeys).toEqual([
      'subdivision.minimum_frontage', 'subdivision.recording_requirement',
    ]);
    expect(plan.modelCalls).toBe(0);
  });

  it('blocks unresolved knowledge and never lets it masquerade as reuse', () => {
    const plan = buildKnowledgeResearchPlan(bundle([
      item('authority.zoning', 'UNRESOLVED'),
    ]), EXPECTED.slice(0, 1));
    expect(plan.subjects[0]).toMatchObject({ decision: 'BLOCKED_CONFLICT', researchAllowed: false });
  });

  it('refreshes superseded-only history rather than reusing it', () => {
    const plan = buildKnowledgeResearchPlan(bundle([
      item('authority.zoning', 'SUPERSEDED'),
    ]), EXPECTED.slice(0, 1));
    expect(plan.subjects[0]).toMatchObject({ decision: 'REFRESH', freshnessState: 'SUPERSEDED' });
  });

  it('turns a current support fingerprint drift into refresh without changing the value', () => {
    const drifted = item('authority.zoning', 'CURRENT', { drifted: true });
    const priorValue = drifted.record.value;
    const plan = buildKnowledgeResearchPlan(bundle([drifted]), EXPECTED.slice(0, 1));
    expect(plan.subjects[0]).toMatchObject({ decision: 'REFRESH', freshnessState: 'DRIFTED' });
    expect(drifted.record.value).toBe(priorValue);
  });

  it('releases only refresh/new subjects to provider lanes and skips reuse lanes', () => {
    const plan = buildKnowledgeResearchPlan(bundle([
      item('authority.zoning', 'CURRENT'),
      item('subdivision.minimum_frontage', 'CURRENT'),
    ]), EXPECTED);
    expect(plan.counts).toEqual({ expected: 3, reuse: 2, refresh: 0, researchNew: 1, blockedConflict: 0 });
    expect(plan.researchEligibleSubjectKeys).toEqual(['subdivision.plat_requirement']);
    expect(plan.providerLanesSkipped).toEqual(['jurisdiction_authority']);
    expect(plan.providerLanesEligible).toEqual(['subdivision_rules']);
  });

  it('normalizes only the known upload-path aliases for planning dedupe', () => {
    expect(normalizeJurisdictionSourceLocator('https://Fairview-TN.org/content/uploads/rules.pdf?download=1'))
      .toBe(normalizeJurisdictionSourceLocator('https://fairview-tn.org/wp-content/uploads/rules.pdf#page=2'));
  });
});
