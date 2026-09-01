// Stage 2.1 — "an official record confirms it" is a claim about a document.
//
// The live panel printed that sentence from a boolean, with nothing behind it
// that an operator could open. These tests pin the trace: the phrase's own flag
// is set only by a subject-specific official record, that record is named, and
// the four things that are NOT official parcel confirmation cannot set it —
// a provider panel, a geocode, generic county context, and an operator's own
// acceptance.

import { describe, expect, it } from 'vitest';

import {
  deriveSubjectCandidates,
  decideSubjectOutcome,
  type SubjectEvidenceFact,
} from './subject-understanding.js';
import { gateSnapshotToCurrentSubject } from './property-intelligence-snapshot.js';

function fact(over: Partial<SubjectEvidenceFact> & { factId: string; field: SubjectEvidenceFact['field']; value: string }): SubjectEvidenceFact {
  return {
    label: 'seeded',
    quoted: over.value,
    inferred: false,
    weight: 'well_supported',
    parcelRelationship: 'subject',
    source: { kind: 'seller_text', label: 'Lead intake text', url: null, locator: null, retrievedAt: null, officiality: 'unverified' },
    ...over,
  } as SubjectEvidenceFact;
}

const JURISDICTION = [
  fact({ factId: 'intake:1:county', field: 'county', value: 'Bradford' }),
  fact({ factId: 'intake:2:state', field: 'state', value: 'FL' }),
];

function subjectFrom(evidence: SubjectEvidenceFact[]) {
  return decideSubjectOutcome(deriveSubjectCandidates(evidence)).subject;
}

describe('the official-record claim names its record or is not made', () => {
  it('a subject-specific official parcel record is cited with source, id, fields and date', () => {
    const subject = subjectFrom([
      ...JURISDICTION,
      fact({
        factId: 'assessor:0:apn', field: 'apn', value: '00083A03400',
        weight: 'confirmed',
        source: {
          kind: 'official_record',
          label: 'Bradford County Property Appraiser parcel record',
          url: 'https://example.invalid/parcel/00083A03400',
          locator: 'parcel 00083A03400',
          retrievedAt: '2026-08-30T00:00:00.000Z',
          officiality: 'official',
        },
      }),
    ])!;

    expect(subject.verification.officiallyVerified).toBe(true);
    const record = subject.verification.officialRecord!;
    expect(record.source).toBe('Bradford County Property Appraiser parcel record');
    expect(record.sourceType).toBe('official_record');
    expect(record.recordIdentifier).toBe('parcel 00083A03400');
    expect(record.fieldsMatched).toContain('apn');
    expect(record.observedAt).toBe('2026-08-30T00:00:00.000Z');
    expect(record.qualifies).toContain('00083A03400');
    // The claim is traceable back to one retained statement.
    expect(subject.provenance.apn.factId).toBe(record.factId);
  });

  it.each([
    ['a provider panel', 'provider_record' as const, 'officially_linked' as const, 'LandPortal authenticated parcel panel'],
    ['a geocoded address', 'geometry' as const, 'unverified' as const, 'Address geocoder pin'],
    ['generic county context', 'provider_record' as const, 'unverified' as const, 'Bradford County, Florida overview page'],
    ['an operator acceptance', 'operator_narrative' as const, 'unverified' as const, 'Operator accepted this parcel'],
  ])('%s is never official parcel-record confirmation', (_label, kind, officiality, source) => {
    const subject = subjectFrom([
      ...JURISDICTION,
      fact({
        factId: 'src:0:apn', field: 'apn', value: '00083A03400',
        source: { kind, label: source, url: null, locator: null, retrievedAt: null, officiality },
      }),
    ])!;

    // Research-grade confidence is NOT revoked because official confirmation is
    // pending — that is the other half of the requirement.
    expect(subject.verification.researchGrade).toBe(true);
    expect(subject.verification.officiallyVerified).toBe(false);
    expect(subject.verification.officialRecord).toBeNull();
    expect(subject.verification.outstanding.join(' ')).toContain('Official county assessor or GIS parcel record');
  });
});

describe('historical derived content cannot drive current operator decisions', () => {
  const snapshot = {
    subjectVersion: 'confirmed:115:v3',
    strategies: [{ id: 'subdivide', label: 'Subdivide into four lots' }],
    recommendation: {
      preferredStrategy: 'subdivide',
      why: 'the older read liked it',
      whatWouldChangeIt: ['a survey'],
      postureWhy: 'stale posture',
      shouldPursue: 'yes',
    },
  } as unknown as Parameters<typeof gateSnapshotToCurrentSubject>[0];

  it('a snapshot correlated to the current subject renders as current', () => {
    const gated = gateSnapshotToCurrentSubject(snapshot, 'confirmed:115:v3')!;
    expect(gated.currentness.stale).toBe(false);
    expect(gated.historical).toBeNull();
    expect(gated.snapshot.strategies.length).toBe(1);
  });

  it('a snapshot from an older subject version is emptied of strategy and recommendation', () => {
    const gated = gateSnapshotToCurrentSubject(snapshot, 'confirmed:115:v4')!;
    expect(gated.currentness.stale).toBe(true);
    expect(gated.snapshot.strategies).toEqual([]);
    expect(gated.snapshot.recommendation.preferredStrategy).toBeNull();
    expect(gated.snapshot.recommendation.shouldPursue).toBe('undetermined');
    // The old conclusion is not deleted; it is contained as history.
    expect(gated.historical).not.toBeNull();
  });

  it('a snapshot that never recorded which subject it answered about is treated as stale', () => {
    const uncorrelated = { ...(snapshot as object), subjectVersion: '' } as typeof snapshot;
    const gated = gateSnapshotToCurrentSubject(uncorrelated, 'confirmed:115:v3')!;
    expect(gated.currentness.stale).toBe(true);
    expect(gated.currentness.ranAgainst).toBeNull();
    expect(gated.snapshot.strategies).toEqual([]);
  });
});
