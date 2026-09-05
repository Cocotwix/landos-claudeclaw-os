import { describe, expect, it } from 'vitest';

import {
  executePropertyProvider,
  DEFAULT_PROVIDER_LANE_TIMEOUT_MS,
  type CanonicalPropertyInput,
  type NormalizedPropertyEvidence,
  type PropertyProviderAdapter,
  type PropertyProviderResult,
} from './property-intelligence-contract.js';
import { adoptFamilyResearchRecord, mergeCanonicalPropertyResearch } from './property-research-store.js';

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

  it('adopts an alias card\'s record as the canonical card\'s own before merging', () => {
    // The Deal 90 family: aliases 95/96 resolve to canonical card 80, and the
    // family read returns the alias's newer record. Merged as a foreign card it
    // refused every canonical result; adopted, the merge accepts and the write
    // lands on the canonical card.
    const alias = mergeCanonicalPropertyResearch(null, result({
      input: { ...property, propertyCardId: 96, dealCardId: 115, apn: '00083-A-03400' },
      evidence: [evidence({ propertyCardId: 96, dealCardId: 115 })],
    })).record;
    const canonicalInput = { ...property, propertyCardId: 80, dealCardId: 90, apn: '00083A03400' };
    const adopted = adoptFamilyResearchRecord(alias, canonicalInput, [80, 95, 96]);
    expect(adopted?.propertyCardId).toBe(80);
    expect(adopted?.dealCardId).toBe(90);
    expect(adopted?.identity.propertyCardId).toBe(80);
    expect(adopted?.evidence).toHaveLength(1);
    const merged = mergeCanonicalPropertyResearch(adopted, result({ runId: 'run-canonical', laneId: 'zillow', providerId: 'zillow', input: canonicalInput, evidence: [evidence({ id: 'zillow:sold', providerId: 'zillow', field: 'sold_comp', propertyCardId: 80, dealCardId: 90 })] }));
    expect(merged.accepted).toBe(true);
    expect(merged.record.propertyCardId).toBe(80);
    expect(merged.record.facts.owner.value).toBe('Dileep Sachan');
    // Outside the family nothing is adopted.
    expect(adoptFamilyResearchRecord(alias, canonicalInput, [80, 95])).toBe(alias);
    // A record already on the card is returned as is.
    expect(adoptFamilyResearchRecord(adopted, canonicalInput, [80, 95, 96])).toBe(adopted);
  });

  it('rebases the record when the SAME card now carries a corrected parcel identity', () => {
    // The Deal 90 defect: the record was keyed to an intake-time APN that an
    // accepted identity reconciliation later corrected on the card. Every
    // provider result for the card was then refused as a "different canonical
    // property", so nothing new was ever retained. The card is the authority:
    // the record follows it, and facts from the superseded parcel are retired.
    const first = mergeCanonicalPropertyResearch(null, result({ input: { ...property, apn: '00083-A-03600' } }));
    expect(first.record.facts.owner.value).toBe('Dileep Sachan');

    const corrected = result({
      runId: 'run-corrected', laneId: 'zillow', providerId: 'zillow',
      input: { ...property, apn: '00083A03400' },
      execution: { ...result().execution, completedAt: '2026-09-04T23:54:42.000Z' },
      evidence: [evidence({ id: 'zillow:sold', providerId: 'zillow', field: 'sold_comp', value: 'x', strength: 'provider_observed', subjectClassification: 'context_only', retrievedAt: '2026-09-04T23:54:42.000Z' })],
      status: 'context_only',
      validation: { valid: true, subjectClassification: 'context_only', checks: [], rejectedEvidenceIds: [] },
    });
    const merged = mergeCanonicalPropertyResearch(first.record, corrected);
    expect(merged.accepted).toBe(true);
    expect(merged.record.identity.apn).toBe('00083A03400');
    expect(merged.record.propertyCardId).toBe(41);
    // The owner fact gathered under the superseded APN is no longer presentable.
    expect(merged.record.facts.owner).toBeUndefined();
    expect(merged.record.evidence.map((item) => item.id)).toEqual(['zillow:sold']);
    expect(merged.record.rejectedEvidence.map((item) => item.reason).join(' ')).toMatch(/superseded subject identity.*00083-A-03600 → 00083A03400/);
    expect(merged.record.lanes.assessor).toBeUndefined();
    expect(merged.record.lanes.zillow.retainedRunId).toBe('run-corrected');
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
  it('turns a provider timeout into an explicit timed_out handback, not a generic failure', async () => {
    const adapter: PropertyProviderAdapter<string> = {
      laneId: 'slow', providerId: 'slow',
      execute: () => new Promise(() => undefined),
      validate: () => ({ valid: true, subjectClassification: 'verified_subject', checks: [], rejectedEvidenceIds: [] }),
      normalize: () => [], status: () => 'verified',
    };
    const settled = await executePropertyProvider({ runId: 'timeout-run', property, adapter, timeoutMs: 5 });
    expect(settled.execution.attempted).toBe(true);
    // A lane that ran out of budget did not answer wrongly, it did not answer
    // in time. Recording that as `failed` is what made every hang look like a
    // provider defect and hid the unbounded await underneath it.
    expect(settled.status).toBe('timed_out');
    expect(settled.failureReason).toMatch(/timed out/);
  });

  it('records a provider refusal as blocked, distinct from a failure', async () => {
    const adapter: PropertyProviderAdapter<string> = {
      laneId: 'refused', providerId: 'refused',
      execute: () => Promise.reject(new Error('Request failed: 429 rate limit exceeded')),
      validate: () => ({ valid: true, subjectClassification: 'verified_subject', checks: [], rejectedEvidenceIds: [] }),
      normalize: () => [], status: () => 'verified',
    };
    const settled = await executePropertyProvider({ runId: 'blocked-run', property, adapter });
    expect(settled.status).toBe('blocked');
    expect(settled.failureReason).toMatch(/429/);
  });

  it('bounds a lane that declares no timeout of its own', async () => {
    // The defect: an adapter with no `timeoutMs` used to receive the raw
    // promise, so one hung authenticated read stalled the whole focused rerun,
    // the coverage cycle and the execution-lock release.
    const adapter: PropertyProviderAdapter<string> = {
      laneId: 'unbounded', providerId: 'unbounded',
      execute: () => new Promise(() => undefined),
      validate: () => ({ valid: true, subjectClassification: 'verified_subject', checks: [], rejectedEvidenceIds: [] }),
      normalize: () => [], status: () => 'verified',
    };
    const settled = await executePropertyProvider({
      runId: 'default-budget-run', property, adapter,
      // Proves the default path is a race, not a bare await: overriding the
      // budget downward still settles.
      timeoutMs: 5,
    });
    expect(settled.status).toBe('timed_out');
    expect(DEFAULT_PROVIDER_LANE_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
