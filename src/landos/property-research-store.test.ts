import { describe, expect, it } from 'vitest';

import {
  executePropertyProvider,
  type CanonicalPropertyInput,
  type NormalizedPropertyEvidence,
  type PropertyProviderAdapter,
  type PropertyProviderResult,
} from './property-intelligence-contract.js';
import { mergeCanonicalPropertyResearch } from './property-research-store.js';

const property: CanonicalPropertyInput = {
  propertyCardId: 41,
  dealCardId: 9,
  normalizedAddress: '12 old ridge rd kingston tn 37763',
  address: '12 Old Ridge Rd',
  city: 'Kingston', county: 'Roane', state: 'TN', zip: '37763',
  apn: '073090 04200', fips: '47145', landPortalPropertyId: 'lp-41',
};

function evidence(overrides: Partial<NormalizedPropertyEvidence> = {}): NormalizedPropertyEvidence {
  return {
    id: 'assessor:owner', propertyCardId: 41, dealCardId: 9, providerId: 'assessor',
    field: 'owner', value: 'Dileep Sachan', subjectClassification: 'verified_subject',
    strength: 'official_record', sourceUrl: 'https://county.example/parcel/41',
    retrievedAt: '2026-08-01T12:00:00.000Z', confidence: 'high', kind: 'fact',
    validation: { valid: true, reasons: [] },
    ...overrides,
  };
}

function result(overrides: Partial<PropertyProviderResult> = {}): PropertyProviderResult {
  return {
    contractVersion: 'property-provider-v1', runId: 'run-1', laneId: 'assessor', providerId: 'assessor', input: property,
    execution: { attempted: true, startedAt: '2026-08-01T11:59:59.000Z', completedAt: '2026-08-01T12:00:00.000Z', durationMs: 1_000, result: {} },
    validation: { valid: true, subjectClassification: 'verified_subject', checks: [], rejectedEvidenceIds: [] },
    evidence: [evidence()], status: 'verified',
    persistence: { attempted: false, persisted: false, retainedEvidenceCount: 0, rejectedEvidenceCount: 0, reason: null },
    failureReason: null,
    ...overrides,
  };
}

describe('canonical property research monotonic merge', () => {
  it('retains verified official facts across blank, context-only, weaker, and failed reruns', () => {
    const first = mergeCanonicalPropertyResearch(null, result());
    expect(first.record.facts.owner.value).toBe('Dileep Sachan');

    const weak = result({
      runId: 'run-2', laneId: 'market_context', providerId: 'market',
      execution: { ...result().execution, completedAt: '2026-08-01T13:00:00.000Z' },
      validation: { valid: true, subjectClassification: 'context_only', checks: [], rejectedEvidenceIds: [] },
      evidence: [evidence({ id: 'market:owner', providerId: 'market', value: '', subjectClassification: 'context_only', strength: 'context_only' })],
      status: 'context_only',
    });
    const second = mergeCanonicalPropertyResearch(first.record, weak);
    expect(second.record.facts.owner.value).toBe('Dileep Sachan');
    expect(second.rejectedEvidenceCount).toBe(1);

    const failed = mergeCanonicalPropertyResearch(second.record, result({
      runId: 'run-3', status: 'failed', evidence: [], failureReason: 'timeout',
      validation: { valid: false, subjectClassification: 'no_match', checks: [{ check: 'execution', passed: false, reason: 'timeout' }], rejectedEvidenceIds: [] },
    }));
    expect(failed.accepted).toBe(true);
    expect(failed.record.facts.owner.value).toBe('Dileep Sachan');
    expect(failed.record.lanes.assessor.retainedStatus).toBe('verified');
    expect(failed.record.lanes.assessor.latestAttemptStatus).toBe('failed');
  });

  it('fails closed on cross-property scope and APN mismatch', () => {
    const first = mergeCanonicalPropertyResearch(null, result());
    const crossed = result({
      runId: 'run-cross',
      input: { ...property, propertyCardId: 42, apn: 'DIFFERENT-APN' },
      evidence: [evidence({ propertyCardId: 42 })],
    });
    const merged = mergeCanonicalPropertyResearch(first.record, crossed);
    expect(merged.accepted).toBe(false);
    expect(merged.reasons.join(' ')).toMatch(/different canonical property|propertyCardId/i);
    expect(merged.record.propertyCardId).toBe(41);
  });

  it('keeps independent lane status and accepted evidence when another provider fails', () => {
    const assessor = mergeCanonicalPropertyResearch(null, result());
    const zillowFailure = mergeCanonicalPropertyResearch(assessor.record, result({
      runId: 'run-z', laneId: 'zillow', providerId: 'zillow', status: 'failed', evidence: [],
      failureReason: 'provider unavailable',
      validation: { valid: true, subjectClassification: 'no_match', checks: [], rejectedEvidenceIds: [] },
    }));
    expect(zillowFailure.record.lanes.assessor.retainedStatus).toBe('verified');
    expect(zillowFailure.record.lanes.zillow.latestAttemptStatus).toBe('failed');
    expect(zillowFailure.record.facts.owner.value).toBe('Dileep Sachan');
  });
});

describe('provider adapter execution', () => {
  it('turns a provider timeout into an explicit failed handback', async () => {
    const adapter: PropertyProviderAdapter<string> = {
      laneId: 'slow', providerId: 'slow',
      execute: () => new Promise(() => undefined),
      validate: () => ({ valid: true, subjectClassification: 'verified_subject', checks: [], rejectedEvidenceIds: [] }),
      normalize: () => [], status: () => 'verified',
    };
    const settled = await executePropertyProvider({ runId: 'timeout-run', property, adapter, timeoutMs: 5 });
    expect(settled.execution.attempted).toBe(true);
    expect(settled.status).toBe('failed');
    expect(settled.failureReason).toMatch(/timed out/);
  });
});
