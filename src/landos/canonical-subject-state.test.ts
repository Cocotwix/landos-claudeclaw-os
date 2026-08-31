// Canonical Subject State — the working research subject and its official
// verification are DIFFERENT concepts, reported independently.
//
// The defect class: a subject established through a valid research-grade route
// (APN + jurisdiction via the spine verdict) read as "no subject at all" in
// consumers that gated on the official `verified_property` flag, and different
// surfaces printed different acreages for the same parcel. Every decision point
// consumes THIS state instead of re-deciding identity.

import { describe, it, expect, beforeEach } from 'vitest';

import { resolveCanonicalSubjectState } from './canonical-subject-state.js';
import { resolveCanonicalIdentity } from './canonical-identity.js';
import { buildAcreageBasis, governingAcreageOf } from './acreage-basis.js';
import { writeParcelIdentity } from './parcel-identity.js';
import { _initTestLandosDb, getLandosDb } from './db.js';

/** A subject established research-grade (spine-confirmed) whose property card
 *  has NOT reached official `verified_property`. */
function seedResearchGradeSubject(id: number, verificationStatus: string): number {
  const db = getLandosDb();
  db.prepare(`INSERT INTO landos_deal_card (id, entity, title, status) VALUES (?, 'TY_LAND_BIZ', 'Research-grade subject', 'new')`).run(id);
  db.prepare(`
    INSERT INTO landos_property_card (id, entity, verification_status, active_input_address, address_key,
      apn, county, state, city, zip, owner, acres, fips, verification_source)
    VALUES (?, 'TY_LAND_BIZ', ?, '1206 Mockingbird Valley Rd', 'mockingbird valley rd',
      '4870-90-2087', 'Iredell', 'NC', 'Statesville', '28625', 'DOE JOHN', 10.5, '37097',
      ?)
  `).run(id, verificationStatus, verificationStatus === 'verified_property'
    ? 'Official Iredell County assessor parcel record'
    : 'LandPortal authenticated parcel panel');
  db.prepare(`INSERT INTO landos_deal_card_property (deal_card_id, card_id, role) VALUES (?, ?, 'subject')`).run(id, id);
  writeParcelIdentity(id, {
    subjectCardId: id, state: 'confirmed', confidence: 0.9,
    basis: 'Parcel identity established from APN 4870-90-2087 plus county FIPS 37097 (LandPortal authenticated parcel panel).',
    evidenceRefs: ['LandPortal authenticated parcel panel'],
    confirmedBy: 'property-resolution',
  });
  return id;
}

describe('subjectResolved is independent of officiallyVerified', () => {
  beforeEach(() => _initTestLandosDb());

  it('a research-grade established subject is resolved while official verification is still outstanding', () => {
    seedResearchGradeSubject(71, 'unverified_lead');
    const subject = resolveCanonicalSubjectState(71);
    expect(subject.subjectResolved).toBe(true);
    expect(subject.officiallyVerified).toBe(false);
    expect(subject.apn).toBe('4870-90-2087');
    expect(subject.apnNormalized).toBe('4870902087');
    expect(subject.county).toBe('Iredell');
    expect(subject.state).toBe('NC');
    expect(subject.fips).toBe('37097');
    expect(subject.zip).toBe('28625');
    expect(subject.owner).toBe('DOE JOHN');
  });

  it('official verification upgrades officiallyVerified without changing the subject', () => {
    seedResearchGradeSubject(72, 'verified_property');
    const subject = resolveCanonicalSubjectState(72);
    expect(subject.subjectResolved).toBe(true);
    expect(subject.officiallyVerified).toBe(true);
    expect(subject.apn).toBe('4870-90-2087');
  });

  it('a legacy verified-property flag backed only by a provider does not imply official verification', () => {
    const id = seedResearchGradeSubject(77, 'verified_property');
    getLandosDb().prepare(`UPDATE landos_property_card
      SET verification_source = 'LandPortal authenticated parcel panel' WHERE id = ?`).run(id);
    const subject = resolveCanonicalSubjectState(id);
    expect(subject.subjectResolved).toBe(true);
    expect(subject.officiallyVerified).toBe(false);
  });

  it('an unestablished subject is neither resolved nor verified, and erases nothing it does not have', () => {
    const db = getLandosDb();
    db.prepare(`INSERT INTO landos_deal_card (id, entity, title, status) VALUES (73, 'TY_LAND_BIZ', 'Unresolved lead', 'new')`).run();
    const subject = resolveCanonicalSubjectState(73);
    expect(subject.subjectResolved).toBe(false);
    expect(subject.officiallyVerified).toBe(false);
    expect(subject.governingAcreage.value).toBeNull();
  });

  it('consumers reading the shared answer agree with the canonical identity', () => {
    seedResearchGradeSubject(74, 'unverified_lead');
    const view = resolveCanonicalIdentity(74);
    const subject = resolveCanonicalSubjectState(74);
    expect(subject.subjectResolved).toBe(view.confirmed);
    expect(subject.apn).toBe(view.apn);
    expect(subject.county).toBe(view.county);
    expect(subject.basis).toBe(view.basis);
  });

  it('seller communications availability defaults to false with no captured contact', () => {
    seedResearchGradeSubject(75, 'unverified_lead');
    expect(resolveCanonicalSubjectState(75).sellerCommunicationsAvailable).toBe(false);
  });

  it('the working acreage stands in from the canonical identity when no reconciled record exists', () => {
    seedResearchGradeSubject(76, 'unverified_lead');
    const subject = resolveCanonicalSubjectState(76);
    expect(subject.governingAcreage.value).toBe(10.5);
    expect(subject.governingAcreage.disputed).toBe(false);
  });
});

describe('governing acreage — one conclusion, survey governs', () => {
  it('a subject-matching recorded survey governs over a materially different GIS/assessed figure without an operator blocker', () => {
    const basis = buildAcreageBasis({
      assessed: { value: 9.8, source: 'County assessor roll' },
      gisGeometry: { value: 9.6, source: 'County GIS geometry' },
      surveyed: { value: 11.2, source: 'Recorded survey/plat' },
    });
    const governing = governingAcreageOf(basis);
    expect(governing.kind).toBe('surveyed');
    expect(governing.value).toBe(11.2);
    // GIS/assessor discrepancy against a survey is publication lag, not a
    // blocker: the survey settles the size the way an operator acceptance does.
    expect(basis.tylerDecisionRequired).toBe(false);
    expect(governing.disputed).toBe(false);
  });

  it('without a survey, a material assessed-vs-GIS split keeps the dispute visible on the governing conclusion', () => {
    const basis = buildAcreageBasis({
      assessed: { value: 10, source: 'County assessor roll' },
      gisGeometry: { value: 14, source: 'County GIS geometry' },
    });
    const governing = governingAcreageOf(basis);
    expect(governing.value).not.toBeNull();
    expect(governing.disputed).toBe(basis.tylerDecisionRequired);
  });

  it('an operator-accepted value is the governing conclusion over every measured basis', () => {
    const basis = buildAcreageBasis({
      assessed: { value: 10, source: 'County assessor roll' },
      surveyed: { value: 11.2, source: 'Recorded survey/plat' },
      operatorAccepted: { value: 10.9, source: 'Tyler accepted' },
    });
    const governing = governingAcreageOf(basis);
    expect(governing.kind).toBe('operator_accepted');
    expect(governing.value).toBe(10.9);
  });

  it('no measurements at all yields an honest null, never a fabricated number', () => {
    const governing = governingAcreageOf(buildAcreageBasis({}));
    expect(governing.value).toBeNull();
    expect(governing.kind).toBeNull();
  });
});
