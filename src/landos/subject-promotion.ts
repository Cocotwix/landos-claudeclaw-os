// LandOS — promoting an understood subject through the EXISTING Stage 1
// accepted-subject path.
//
// Subject Understanding produces a reading. A reading is not an accepted
// subject, and Stage 2 shipped with the two disconnected: the auditable
// `subject_understanding_v1` snapshot was written, and every downstream
// consumer went on reading whatever the Stage 1 spine already held. A supported
// `research_ready` result therefore changed nothing an operator could act on.
//
// This module closes that gap WITHOUT adding a second identity store. It owns
// no state. Every write below goes through machinery that already existed and
// already refuses the dangerous cases:
//
//   applyLaneEvidence()               — fills the shared property card, and
//                                       REFUSES to replace an accepted parcel
//                                       identifier or jurisdiction with a
//                                       different one. That refusal is what
//                                       makes silent supersession impossible.
//   writeParcelIdentity()             — the accepted-subject verdict, written
//                                       only when none is already confirmed.
//   synchronizePropertySummaryForDeal — builds the durable versioned slice the
//                                       canonical projection reads.
//
// The guard in front of all three is invariant 2: a parcel-level identifier
// plus its jurisdiction, checked by the same `hasStrongParcelIdentity` the
// resolution path uses. An address that geocoded is still not a parcel.

import { hasStrongParcelIdentity } from './property-card.js';
import { readParcelIdentity, writeParcelIdentity } from './parcel-identity.js';
import { applyLaneEvidence, readResolverSubject } from './universal-property-resolution.js';
import { synchronizePropertySummaryForDeal } from './property-summary-legacy-adapter.js';
import { resolveCanonicalSubjectState } from './canonical-subject-state.js';
import {
  normalizeSubjectApn,
  type SubjectUnderstandingResult,
  type WorkingAcquisitionSubject,
} from './subject-understanding.js';

export type SubjectPromotionStatus =
  /** The Stage 1 accepted subject was created or filled from this reading. */
  | 'promoted'
  /** The same parcel is already accepted. Nothing to do; nothing rewritten. */
  | 'already_accepted'
  /** `candidate_set` or `needs_targeted_input`. Never promotes. */
  | 'not_research_ready'
  /** The accepted subject moved between the run and the write. */
  | 'stale_subject_version'
  /** Invariant 2: no parcel identifier plus jurisdiction. */
  | 'insufficient_parcel_identity'
  /** An accepted subject exists and this reading names a different parcel. */
  | 'accepted_subject_differs';

export interface SubjectPromotion {
  status: SubjectPromotionStatus;
  /** One operator-readable sentence. */
  reason: string;
  /** True only when this call actually changed accepted state. */
  wrote: boolean;
  subjectVersionBefore: string;
  subjectVersionAfter: string | null;
  apn: string | null;
}

export interface PromoteSubjectInput {
  dealCardId: number;
  result: SubjectUnderstandingResult;
  /** The version the reading was produced against. */
  subjectVersionAtStart: string;
  actor: string;
  /** Injected in tests. Production re-reads the live canonical state. */
  readSubjectVersion?: (dealCardId: number) => string;
}

function evidenceRefsFor(subject: WorkingAcquisitionSubject): string[] {
  const refs = new Set<string>();
  for (const provenance of Object.values(subject.provenance)) {
    refs.add(provenance.locator ? `${provenance.source} (${provenance.locator})` : provenance.source);
  }
  return [...refs];
}

/**
 * Promote a validated `research_ready` reading, or explain why it did not.
 *
 * The version is re-read IMMEDIATELY before the write, not trusted from the
 * start of the run: a run that took a minute is a run during which an operator
 * could have accepted something else.
 */
export function promoteUnderstoodSubject(input: PromoteSubjectInput): SubjectPromotion {
  const { dealCardId, result } = input;
  const readVersion = input.readSubjectVersion
    ?? ((id: number) => resolveCanonicalSubjectState(id).subjectVersion);
  const before = input.subjectVersionAtStart;
  const refuse = (status: SubjectPromotionStatus, reason: string, apn: string | null = null): SubjectPromotion =>
    ({ status, reason, wrote: false, subjectVersionBefore: before, subjectVersionAfter: null, apn });

  if (result.outcome !== 'research_ready' || !result.subject) {
    return refuse(
      'not_research_ready',
      `The reading is ${result.outcome}; only a supported research-ready subject is promoted.`,
    );
  }
  if (!result.persistable) {
    return refuse('stale_subject_version', 'The accepted subject changed during this run, so the reading was not promoted.');
  }

  const subject = result.subject;
  const apn = subject.apn;

  // Stale-write protection, at the moment of the write.
  const current = readVersion(dealCardId);
  if (current !== before) {
    return refuse(
      'stale_subject_version',
      `The accepted subject moved from ${before} to ${current} before this reading could be written; the newer subject stands.`,
      apn,
    );
  }

  // Invariant 2. A parcel identifier plus its jurisdiction, or nothing.
  if (!hasStrongParcelIdentity({
    apn: apn ?? undefined,
    lpPropertyId: subject.lpPropertyId ?? undefined,
    fips: subject.fips ?? undefined,
    county: subject.county ?? undefined,
    state: subject.state ?? undefined,
  })) {
    return refuse(
      'insufficient_parcel_identity',
      'The reading carries no parcel identifier with its jurisdiction, so it cannot establish an accepted subject.',
      apn,
    );
  }

  const accepted = readParcelIdentity(dealCardId);
  if (accepted?.state === 'confirmed') {
    const acceptedApn = normalizeSubjectApn(resolveCanonicalSubjectState(dealCardId).apn);
    const readingApn = normalizeSubjectApn(apn);
    if (acceptedApn && readingApn && acceptedApn !== readingApn) {
      return refuse(
        'accepted_subject_differs',
        `An accepted subject already names a different parcel; this reading (${apn}) was retained as evidence and was not written.`,
        apn,
      );
    }
    return {
      status: 'already_accepted',
      reason: 'The same parcel is already the accepted subject; the reading corroborates it and rewrote nothing.',
      wrote: false,
      subjectVersionBefore: before,
      subjectVersionAfter: readVersion(dealCardId),
      apn,
    };
  }

  const resolverSubject = readResolverSubject(dealCardId);
  if (!resolverSubject) {
    return refuse('insufficient_parcel_identity', 'This Deal Card carries no shared property record to write the subject onto.', apn);
  }

  // The shared writer. It FILLS; it refuses to contradict accepted values, and
  // that refusal is the operator-acceptance protection, not a check reinvented
  // here.
  const applied = applyLaneEvidence(resolverSubject, {
    apn,
    county: subject.county,
    state: subject.state,
    city: subject.city,
    zip: subject.zip,
    fips: subject.fips,
    lpPropertyId: subject.lpPropertyId,
  }, input.actor);
  // A REFUSAL is a conflict: the shared record already holds a different
  // accepted value, and that protection is the operator's. Filling nothing is
  // not a conflict — it means resolution already wrote these very fields, which
  // is the normal fresh New Lead case now that resolution lands a candidate
  // first. Treating "nothing to fill" as a conflict blocked exactly the
  // promotion this path exists to perform.
  if (applied.refusedFor.length > 0) {
    return refuse(
      'accepted_subject_differs',
      `The shared property record refused this reading (${applied.refusedFor.join('; ')}); nothing was written.`,
      apn,
    );
  }

  writeParcelIdentity(dealCardId, {
    subjectCardId: resolverSubject.propertyCardId,
    state: 'confirmed',
    basis: `Subject Understanding established this subject from ${result.evidence.length} retained statement(s): ${subject.interest.statement}`,
    confidence: subject.confidence,
    evidenceRefs: evidenceRefsFor(subject),
  }, input.actor);

  // Build the durable versioned slice, so the canonical projection and every
  // Deal Card consumer read the promoted subject through the Stage 1 path.
  synchronizePropertySummaryForDeal({
    dealCardId,
    actor: input.actor,
    changeReason: 'Subject Understanding promoted a validated research-ready subject.',
  });

  return {
    status: 'promoted',
    reason: `Promoted ${apn ?? subject.lpPropertyId ?? 'the identified record'} through the accepted-subject path.`,
    wrote: true,
    subjectVersionBefore: before,
    subjectVersionAfter: readVersion(dealCardId),
    apn,
  };
}
