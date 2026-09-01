// Stage 2.1 — a validated reading becomes an ACCEPTED subject, or it does not.
//
// Stage 2 wrote an auditable reading and stopped. The defect class: a supported
// `research_ready` result changed nothing an operator could act on, because
// every Deal Card consumer reads the Stage 1 spine and nothing promoted into
// it. These tests pin the promotion and, more importantly, the five ways it
// must REFUSE — a promotion that cannot refuse is a second identity store.

import { describe, expect, it, beforeEach } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import { promoteUnderstoodSubject } from './subject-promotion.js';
import { writeParcelIdentity, readParcelIdentity } from './parcel-identity.js';
import { canonicalSubjectProjection, resolveCanonicalSubjectState } from './canonical-subject-state.js';
import {
  deriveSubjectCandidates,
  decideSubjectOutcome,
  UNBOUND_REASONING,
  type SubjectEvidenceFact,
  type SubjectUnderstandingResult,
} from './subject-understanding.js';

const DEAL = 8801;

/** A New Lead with a shared property record and no accepted parcel yet. */
function seedLead(id = DEAL): number {
  const db = getLandosDb();
  db.prepare(`INSERT INTO landos_deal_card (id, entity, title, status) VALUES (?, 'TY_LAND_BIZ', 'Controlled safe lead', 'new')`).run(id);
  db.prepare(`
    INSERT INTO landos_property_card (id, entity, verification_status, active_input_address, address_key, county, state)
    VALUES (?, 'TY_LAND_BIZ', 'unverified_lead', '1180 Sinking Creek Rd', 'sinking creek rd', 'Bradford', 'FL')
  `).run(id);
  db.prepare(`INSERT INTO landos_deal_card_property (deal_card_id, card_id, role) VALUES (?, ?, 'subject')`).run(id, id);
  return id;
}

function fact(over: Partial<SubjectEvidenceFact> & { factId: string; field: SubjectEvidenceFact['field']; value: string }): SubjectEvidenceFact {
  return {
    label: 'seeded',
    quoted: over.value,
    inferred: false,
    weight: 'well_supported',
    parcelRelationship: 'subject',
    source: { kind: 'seller_text', label: 'Lead intake text', url: null, locator: 'Retained raw intake', retrievedAt: null, officiality: 'unverified' },
    ...over,
  } as SubjectEvidenceFact;
}

/** Run the real deterministic derivation, so the result under test is one the
 *  product could actually produce rather than a hand-built fixture. */
function readingFor(evidence: SubjectEvidenceFact[], subjectVersion: string, persistable = true): SubjectUnderstandingResult {
  const derivation = deriveSubjectCandidates(evidence);
  const decision = decideSubjectOutcome(derivation);
  return {
    dealCardId: DEAL,
    outcome: decision.outcome,
    subject: decision.subject,
    candidates: derivation.candidates,
    conflicts: derivation.conflicts,
    question: null,
    evidence,
    excludedParcels: derivation.excludedParcels,
    confidence: decision.subject?.confidence ?? 0,
    persistable,
    audit: {
      actionLimit: 4,
      actionsUsed: 0,
      plannerInvocations: 1,
      subjectVersionAtStart: subjectVersion,
      stopReason: 'research_ready',
      reasoning: { ...UNBOUND_REASONING, bound: true, turns: 1 },
      toolRequests: [],
      steps: [],
    },
  };
}

const CLEAR_LEAD: SubjectEvidenceFact[] = [
  fact({ factId: 'intake:0:apn', field: 'apn', value: '00083A03400' }),
  fact({ factId: 'intake:1:county', field: 'county', value: 'Bradford' }),
  fact({ factId: 'intake:2:state', field: 'state', value: 'FL' }),
  fact({ factId: 'intake:3:address', field: 'address', value: '1180 Sinking Creek Rd' }),
];

describe('a validated research_ready reading promotes through the Stage 1 accepted-subject path', () => {
  beforeEach(() => _initTestLandosDb());

  it('writes the accepted subject and exposes it through CanonicalSubjectState and the projection', () => {
    seedLead();
    const version = resolveCanonicalSubjectState(DEAL).subjectVersion;
    const reading = readingFor(CLEAR_LEAD, version);
    expect(reading.outcome).toBe('research_ready');

    const promotion = promoteUnderstoodSubject({
      dealCardId: DEAL, result: reading, subjectVersionAtStart: version, actor: 'test:stage-2.1',
    });

    expect(promotion.status).toBe('promoted');
    expect(promotion.wrote).toBe(true);
    // Through the EXISTING writer: the Stage 1 spine verdict is what changed.
    expect(readParcelIdentity(DEAL)?.state).toBe('confirmed');

    const state = resolveCanonicalSubjectState(DEAL);
    expect(state.subjectResolved).toBe(true);
    expect(state.apnNormalized).toBe('00083a03400');
    // Research-grade is not official verification, and promotion never claims it.
    expect(state.officiallyVerified).toBe(false);

    // Deal Card consumers read the promoted subject through the shared
    // projection, not the understanding snapshot.
    const projection = canonicalSubjectProjection(DEAL);
    expect(JSON.stringify(projection)).toContain('00083A03400');
    expect(promotion.subjectVersionAfter).toBe(state.subjectVersion);
    expect(promotion.subjectVersionAfter).not.toBe(promotion.subjectVersionBefore);
  });

  it('corroborating the same accepted parcel rewrites nothing', () => {
    seedLead();
    const version = resolveCanonicalSubjectState(DEAL).subjectVersion;
    promoteUnderstoodSubject({ dealCardId: DEAL, result: readingFor(CLEAR_LEAD, version), subjectVersionAtStart: version, actor: 'test:first' });

    const second = resolveCanonicalSubjectState(DEAL).subjectVersion;
    const again = promoteUnderstoodSubject({
      dealCardId: DEAL, result: readingFor(CLEAR_LEAD, second), subjectVersionAtStart: second, actor: 'test:second',
    });
    expect(again.status).toBe('already_accepted');
    expect(again.wrote).toBe(false);
  });

  it('an operator-accepted subject is never silently replaced by a reading naming another parcel', () => {
    seedLead();
    getLandosDb().prepare(`UPDATE landos_property_card SET apn = '00083A03000' WHERE id = ?`).run(DEAL);
    writeParcelIdentity(DEAL, {
      subjectCardId: DEAL, state: 'confirmed', confidence: 0.95,
      basis: 'Operator accepted parcel 00083A03000.',
      evidenceRefs: ['Operator acceptance'],
    }, 'operator');

    const version = resolveCanonicalSubjectState(DEAL).subjectVersion;
    const promotion = promoteUnderstoodSubject({
      dealCardId: DEAL, result: readingFor(CLEAR_LEAD, version), subjectVersionAtStart: version, actor: 'test:stage-2.1',
    });

    expect(promotion.status).toBe('accepted_subject_differs');
    expect(promotion.wrote).toBe(false);
    expect(resolveCanonicalSubjectState(DEAL).apnNormalized).toBe('00083a03000');
  });
});

describe('promotion refuses everything that is not a validated research-ready subject', () => {
  beforeEach(() => _initTestLandosDb());

  it('candidate_set never promotes and never alters an accepted subject', () => {
    const evidence = [
      ...CLEAR_LEAD,
      fact({ factId: 'doc:0:apn', field: 'apn', value: '00091B01200', source: { kind: 'document', label: 'Supplied deed', url: null, locator: 'page 1', retrievedAt: null, officiality: 'unverified' } }),
    ];
    const reading = readingFor(evidence, 'v1');
    expect(reading.outcome).toBe('candidate_set');

    const promotion = promoteUnderstoodSubject({ dealCardId: DEAL, result: reading, subjectVersionAtStart: 'v1', actor: 'test', readSubjectVersion: () => 'v1' });
    expect(promotion.status).toBe('not_research_ready');
    expect(promotion.wrote).toBe(false);
  });

  it('needs_targeted_input never promotes', () => {
    const reading = readingFor([fact({ factId: 'intake:0:address', field: 'address', value: '1180 Sinking Creek Rd' })], 'v1');
    expect(reading.outcome).toBe('needs_targeted_input');

    const promotion = promoteUnderstoodSubject({ dealCardId: DEAL, result: reading, subjectVersionAtStart: 'v1', actor: 'test', readSubjectVersion: () => 'v1' });
    expect(promotion.status).toBe('not_research_ready');
    expect(promotion.wrote).toBe(false);
  });

  it('a stale reading cannot overwrite a newer accepted subject version', () => {
    const reading = readingFor(CLEAR_LEAD, 'v1');
    const promotion = promoteUnderstoodSubject({
      dealCardId: DEAL, result: reading, subjectVersionAtStart: 'v1', actor: 'test',
      // The subject moved between the run and the write.
      readSubjectVersion: () => 'v2',
    });
    expect(promotion.status).toBe('stale_subject_version');
    expect(promotion.wrote).toBe(false);
  });

  it('a reading the loop already marked unpersistable is refused before any read', () => {
    const promotion = promoteUnderstoodSubject({
      dealCardId: DEAL, result: readingFor(CLEAR_LEAD, 'v1', false), subjectVersionAtStart: 'v1', actor: 'test',
      readSubjectVersion: () => { throw new Error('must not be consulted'); },
    });
    expect(promotion.status).toBe('stale_subject_version');
  });

  it('invariant 2: an address that geocoded is never promoted as a parcel', () => {
    // Research-grade by an official source, but with no parcel identifier at all.
    const evidence = [
      fact({
        factId: 'gis:0:legal_description', field: 'legal_description', value: 'LOT 4 BLK B',
        source: { kind: 'official_record', label: 'Bradford County GIS parcel layer', url: null, locator: 'layer 3', retrievedAt: null, officiality: 'official' },
        weight: 'confirmed',
      }),
      fact({ factId: 'intake:0:address', field: 'address', value: '1180 Sinking Creek Rd' }),
    ];
    const reading = readingFor(evidence, 'v1');
    const promotion = promoteUnderstoodSubject({ dealCardId: DEAL, result: reading, subjectVersionAtStart: 'v1', actor: 'test', readSubjectVersion: () => 'v1' });
    expect(promotion.wrote).toBe(false);
    expect(['not_research_ready', 'insufficient_parcel_identity']).toContain(promotion.status);
  });
});
