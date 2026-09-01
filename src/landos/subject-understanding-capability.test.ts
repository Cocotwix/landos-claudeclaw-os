// Stage 2 — the placement over live sources.
//
// `subject-understanding.test.ts` proves the contract. This proves the wiring:
// that deterministic parsers arrive as CANDIDATES carrying their own weight and
// provenance, that a page's own words stay distinguishable from a parse, and
// that a parcel retained beside the subject never enters the subject.

import { describe, expect, it } from 'vitest';

import { buildLeadEvidence, type LeadEvidenceSources } from './subject-understanding-capability.js';
import { deriveSubjectCandidates, decideSubjectOutcome } from './subject-understanding.js';
import type { CanonicalSubjectState } from './canonical-subject-state.js';

function subjectState(overrides: Partial<CanonicalSubjectState> = {}): CanonicalSubjectState {
  return {
    dealCardId: 7001,
    propertyCardId: null,
    subjectResolved: false,
    officiallyVerified: false,
    status: 'unresolved',
    source: 'none',
    apn: null,
    apnNormalized: null,
    address: null,
    city: null,
    county: null,
    state: null,
    fips: null,
    zip: null,
    owner: null,
    subjectVersion: 'unresolved:7001:unresolved#ac:none',
    subjectVersionId: null,
    governingAcreage: { value: null, kind: null, source: null, disputed: false, observedAt: null },
    supersededAcreage: [],
    sellerCommunicationsAvailable: false,
    basis: 'No accepted identity yet.',
    confidence: 0,
    sourceRefs: [],
    confirmedAt: null,
    ...overrides,
  } as CanonicalSubjectState;
}

function sources(overrides: Partial<LeadEvidenceSources> = {}): LeadEvidenceSources {
  return {
    rawIntake: '',
    subject: subjectState(),
    artifacts: [],
    workingState: { apn: null, owner: null, acreage: null, roadName: null, county: null },
    operatorContext: null,
    retainedParcels: [],
    ...overrides,
  };
}

describe('buildLeadEvidence', () => {
  it('marks a parsed value the operator actually wrote as quoted, and a derived one as inferred', () => {
    const facts = buildLeadEvidence(sources({
      rawIntake: 'Parcel 4471-200-015 in Douglas County GA, seller wants to move quick.',
    }));

    const apn = facts.find((fact) => fact.field === 'apn')!;
    expect(apn.quoted).toBe('4471-200-015');
    expect(apn.inferred).toBe(false);
    expect(apn.weight).toBe('well_supported');

    // Whatever the parser could not read back out of the operator's own words
    // is LandOS's reading, and it says so rather than presenting as a quote.
    for (const fact of facts.filter((f) => f.inferred)) expect(fact.quoted).toBeNull();
  });

  it('keeps the operator\'s words whole beside the parsed fields', () => {
    const raw = 'Got a call about 812 Quarry Loop, Marion NC. No parcel number yet.';
    const facts = buildLeadEvidence(sources({ rawIntake: raw }));
    const verbatim = facts.find((fact) => fact.quoted === raw);
    expect(verbatim).toBeDefined();
    expect(verbatim!.source.kind).toBe('seller_text');
  });

  it('lets an accepted official record outrank a parse of the same lead', () => {
    const facts = buildLeadEvidence(sources({
      rawIntake: 'I think the parcel is 073-014.00 but I am not certain.',
      subject: subjectState({
        subjectResolved: true,
        officiallyVerified: true,
        apn: '073-014.00',
        county: 'White',
        state: 'TN',
        status: 'confirmed',
        source: 'identity_version',
        subjectVersion: 'iv:12:v1#ac:none',
      }),
    }));

    const apnFacts = facts.filter((fact) => fact.field === 'apn');
    expect(apnFacts.some((fact) => fact.weight === 'confirmed' && fact.source.officiality === 'official')).toBe(true);
    // Same parcel written two ways is one candidate, and the official record
    // is the one that governs.
    const { candidates } = deriveSubjectCandidates(facts);
    expect(candidates).toHaveLength(1);
    expect(decideSubjectOutcome(deriveSubjectCandidates(facts)).outcome).toBe('research_ready');
  });

  it('never lets a parcel retained beside the subject into the subject', () => {
    const facts = buildLeadEvidence(sources({
      rawIntake: 'Selling the vacant lot, the doublewide next door stays with them.',
      subject: subjectState({
        subjectResolved: true,
        apn: '0451-00-021',
        county: 'Cherokee',
        state: 'SC',
        status: 'confirmed',
        source: 'identity_version',
      }),
      workingState: { apn: '0451-00-021', owner: null, acreage: null, roadName: null, county: 'Cherokee' },
      retainedParcels: [
        { apn: '0451-00-021', owner: 'OKONKWO D', acres: 4.62, buildingSqft: 0 },
        { apn: '0451-00-022', owner: 'OKONKWO D', acres: 5.1, buildingSqft: 1568 },
      ],
    }));

    // The subject's own record is not re-added as a neighbour.
    const related = facts.filter((fact) => fact.parcelRelationship === 'related_parcel');
    expect(related.map((fact) => fact.value)).toContain('0451-00-022');
    expect(related.map((fact) => fact.value)).not.toContain('0451-00-021');

    const { candidates, excludedParcels } = deriveSubjectCandidates(facts);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].subject.apnNormalized).toBe('045100021');
    // The neighbour's acreage and its manufactured home stay out of the subject.
    expect(candidates[0].subject.acres).not.toBe(5.1);
    expect(excludedParcels.map((parcel) => parcel.identifier)).toContain('0451-00-022');
    const improvements = facts.filter((fact) => fact.field === 'improvement');
    expect(improvements.length).toBeGreaterThan(0);
    for (const fact of improvements) expect(fact.parcelRelationship).toBe('related_parcel');
  });

  it('carries the operator narrative through as scope evidence', () => {
    const facts = buildLeadEvidence(sources({
      operatorContext: {
        statement: 'Seller owns three adjoining lots and is selling only the middle one.',
        clusterApns: [],
        adjoiningManufacturedHome: true,
      },
    }));
    const narrative = facts.find((fact) => fact.source.kind === 'operator_narrative')!;
    expect(narrative.quoted).toMatch(/three adjoining lots/);
    expect(narrative.inferred).toBe(false);
  });

  it('returns an empty set rather than inventing evidence for an empty lead', () => {
    expect(buildLeadEvidence(sources())).toEqual([]);
    const { candidates } = deriveSubjectCandidates(buildLeadEvidence(sources()));
    expect(candidates).toHaveLength(0);
  });
});
