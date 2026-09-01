// LandOS — CANONICAL SUBJECT STATE: the one typed answer to "what property is
// this Deal Card about, and how strongly is that held?"
//
// LandOS is looking for THE PROPERTY, not a particular identifier. A working
// research subject may be sufficiently established through any single valid
// route (APN + jurisdiction, LandPortal id + FIPS, official record, a
// subject-matching survey/deed) without official county verification. Two
// distinct concepts therefore never collapse into one flag:
//
//   subjectResolved     — LandOS's current best-supported working conclusion
//                         uniquely establishes the property. Research may run.
//   officiallyVerified  — an official assessor/county parcel record confirms
//                         it. Strictly stronger; never implied by the first.
//
// Downstream systems consume THIS state instead of independently re-deciding
// identity from `verification_status` strings, mission payloads, or their own
// discovery re-derivations. Lack of official verification must never erase a
// research-grade established subject; stronger official evidence upgrades
// confidence later without changing the subject.
//
// This module is a PURE READ composition over the existing identity
// infrastructure (`resolveCanonicalIdentity`, the property card, the shared
// acreage basis, the acquisition comm log). It is not a new identity store.

import { getLandosDb } from './db.js';
import { getAcquisition } from './acquisitions.js';
import { loadSellerStatedFacts } from './seller-stated-facts.js';
import { buildAcreageBasis, governingAcreageOf, supersededAcreageOf, type GoverningAcreage } from './acreage-basis.js';
import { resolveSubjectAcreage, type SubjectAcreageResolution } from './subject-acreage.js';
import {
  resolveCanonicalIdentity,
  type CanonicalIdentitySource,
  type CanonicalIdentityView,
} from './canonical-identity.js';
import { operatorRecordFor } from './property-intelligence-live.js';
import type { PropertyIdentityStatus } from './property-summary-slice.js';
import type { CapabilityPrerequisite, CapabilityPrerequisiteClause } from './capability-contract.js';

export interface CanonicalSubjectState {
  dealCardId: number;
  propertyCardId: number | null;
  /** The working research subject is sufficiently established. */
  subjectResolved: boolean;
  /** An official assessor/county parcel record confirms the subject.
   *  NEVER implied by `subjectResolved`. */
  officiallyVerified: boolean;
  /**
   * The official source string behind `officiallyVerified`, verbatim.
   *
   * A claim that an official record confirms this parcel is a claim about a
   * specific record, and a surface that prints the claim must be able to print
   * the record. Null whenever `officiallyVerified` is false.
   */
  officialVerificationSource: string | null;
  status: PropertyIdentityStatus;
  source: CanonicalIdentitySource;
  apn: string | null;
  /** Normalized parcel identifier (lowercase alphanumerics) for equivalence
   *  checks; formatting variants are never a distinct identity. */
  apnNormalized: string | null;
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  /** County FIPS where known. */
  fips: string | null;
  zip: string | null;
  owner: string | null;
  /**
   * The correlation token every consumer must report back.
   *
   * Consumers agreeing on values today is not the same as consumers agreeing on
   * the SUBJECT. A lane that ran against an older subject can coincidentally
   * carry matching acreage and still be answering about a different parcel, and
   * a lane whose values look wrong may simply be older. This token is what makes
   * that difference visible instead of guessable.
   */
  subjectVersion: string;
  /** Row id of the durable identity version behind the token, when one exists. */
  subjectVersionId: number | null;
  /** THE single governing acreage conclusion. Alternate measurements remain
   *  reference evidence on the shared acreage basis record. */
  governingAcreage: GoverningAcreage;
  /**
   * Measurements the governing basis has retired: real records with their
   * original source and date, kept as history. Never a current alternative and
   * never a conflict for the operator to resolve.
   */
  supersededAcreage: Array<{
    kind: string;
    value: number;
    source: string | null;
    observedAt: string | null;
    reason: string;
  }>;
  /** Seller communications or seller-stated facts exist for this deal, so
   *  seller-scoped research has its prerequisite regardless of parcel state. */
  sellerCommunicationsAvailable: boolean;
  /** Why the working subject is established (or not) — provenance prose. */
  basis: string;
  confidence: number;
  sourceRefs: string[];
  confirmedAt: number | null;
}

function normalizeApn(value: string | null): string | null {
  const normalized = (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized.length > 0 ? normalized : null;
}

/** Only an authority-specific government/assessor source can satisfy the
 * stronger official-verification axis.  A provider panel may establish the
 * working subject, even when a legacy card carries `verified_property`, but it
 * never becomes an official record by virtue of that status string alone. */
export function isOfficialPropertyVerificationSource(value: unknown): boolean {
  const text = String(value ?? '').trim();
  if (!text || /landportal|provider:|realie|regrid|propertyradar|attom|data ?tree/i.test(text)) return false;
  return /official|assessor|property[ -]?appraiser|cadastral|government|(?:county|state|municipal).{0,32}(?:gis|parcel (?:map|layer|record)|property record)|(?:gis|parcel (?:map|layer)).{0,32}(?:county|state|municipal)/i.test(text);
}

function cardExtras(propertyCardId: number | null): { fips: string | null; officiallyVerified: boolean; officialVerificationSource: string | null } {
  if (propertyCardId == null) return { fips: null, officiallyVerified: false, officialVerificationSource: null };
  try {
    const row = getLandosDb()
      .prepare('SELECT fips, verification_status, verification_source FROM landos_property_card WHERE id = ?')
      .get(propertyCardId) as { fips?: string | null; verification_status?: string | null; verification_source?: string | null } | undefined;
    const officiallyVerified = row?.verification_status === 'verified_property'
      && isOfficialPropertyVerificationSource(row?.verification_source);
    return {
      fips: typeof row?.fips === 'string' && row.fips.trim() ? row.fips.trim() : null,
      officiallyVerified,
      officialVerificationSource: officiallyVerified ? String(row?.verification_source ?? '').trim() || null : null,
    };
  } catch {
    return { fips: null, officiallyVerified: false, officialVerificationSource: null };
  }
}

function sellerCommunicationsAvailable(dealCardId: number, propertyCardId: number | null): boolean {
  try {
    const acquisition = getAcquisition(dealCardId);
    if (acquisition.commLog.length + acquisition.discovery.length > 0) return true;
  } catch { /* no acquisition record — no communications */ }
  try {
    if (propertyCardId != null && loadSellerStatedFacts(propertyCardId).length > 0) return true;
  } catch { /* seller-stated facts unavailable — not a subject question */ }
  return false;
}

/** Governing acreage from the SAME shared basis record every operator surface
 *  reads. When the reconciled operator record is unavailable (no public run
 *  yet), the canonical identity's acreage stands in with an unknown basis —
 *  a working figure, never presented as a settled measurement. */
function governingAcreageFor(dealCardId: number, view: CanonicalIdentityView): SubjectAcreageResolution {
  // The shared resolver first: it reads every store that can carry a
  // measurement, so it answers on cards where the reconciled operator record
  // does not exist yet. Reading the operator record first is what left the
  // canonical side reporting "not established" while typed acreage evidence
  // sat in the store unread.
  try {
    const resolved = resolveSubjectAcreage(dealCardId, view.propertyCardId);
    if (resolved.governing.value != null) return resolved;
  } catch { /* evidence unreadable — the reconciled record may still answer */ }

  try {
    const record = operatorRecordFor(dealCardId);
    if (record) {
      const governing = record.identity.governingAcreage ?? governingAcreageOf(record.identity.acreageBasis);
      if (governing.value != null) {
        return {
          governing,
          reconciliation: record.identity.acreageBasis,
          superseded: supersededAcreageOf(record.identity.acreageBasis),
          signals: [],
        };
      }
    }
  } catch { /* the reconciled record is a refinement, not a prerequisite */ }

  // Nothing retained. The identity version's own figure stands in as a working
  // number with an unknown basis — never presented as a settled measurement.
  return {
    governing: { value: view.acreage, kind: null, source: null, disputed: false, observedAt: null },
    reconciliation: buildAcreageBasis({}),
    superseded: [],
    signals: [],
  };
}

/**
 * The stable correlation token for an accepted subject.
 *
 * Built from the durable identity version when one exists. When the version has
 * not been built yet the accepted legacy verdict still needs a token, so it is
 * derived from the facts that define that verdict — it stays stable across
 * reads and changes when the accepted identity changes, which is exactly what
 * consumers correlate on.
 */
function subjectVersionToken(view: CanonicalIdentityView, acreage: GoverningAcreage): string {
  const identity = view.versionId != null
    ? `iv:${view.versionId}:v${view.versionNumber ?? 0}`
    : view.confirmed
      ? `legacy:${view.propertyCardId ?? 'none'}:${view.confirmedAt ?? 0}`
      : `unresolved:${view.dealCardId}:${view.status}`;
  // The governing acreage is part of the SUBJECT, not a detail hanging off it.
  //
  // Correlating on the identity row alone made the token unable to answer the
  // question consumers actually ask. A lane that ran when the acreage was
  // unestablished carries the same identity token as one that ran after a
  // survey settled it, so its conclusion ("no per-acre band can be converted
  // into a parcel value") kept rendering as current beside a header showing the
  // settled size. Same token, different governing facts, contradictory page.
  const acres = acreage.value != null ? `${acreage.value}:${acreage.kind ?? 'unknown'}` : 'none';
  return `${identity}#ac:${acres}`;
}

/**
 * The subject block every Deal Card consumer returns, verbatim.
 *
 * One shape, one producer. A consumer that builds its own subject block from
 * whatever fields it happens to hold is the failure this exists to end: the
 * fields may agree today and still be answering about different subject
 * versions, and nothing on the wire would show it.
 */
export interface CanonicalSubjectProjection {
  dealCardId: number;
  subjectVersion: string;
  subjectVersionId: number | null;
  subjectResolved: boolean;
  officiallyVerified: boolean;
  status: PropertyIdentityStatus;
  apn: string | null;
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  fips: string | null;
  zip: string | null;
  owner: string | null;
  acreage: {
    value: number | null;
    basis: string | null;
    source: string | null;
    observedAt: string | null;
    /** A genuine unsettled disagreement between current measurements. */
    disputed: boolean;
    /** Retained measurements this basis has retired. History, not alternatives. */
    superseded: CanonicalSubjectState['supersededAcreage'];
  };
  basis: string;
  confidence: number;
}

export function canonicalSubjectProjection(dealCardId: number): CanonicalSubjectProjection {
  const subject = resolveCanonicalSubjectState(dealCardId);
  return {
    dealCardId,
    subjectVersion: subject.subjectVersion,
    subjectVersionId: subject.subjectVersionId,
    subjectResolved: subject.subjectResolved,
    officiallyVerified: subject.officiallyVerified,
    status: subject.status,
    apn: subject.apn,
    address: subject.address,
    city: subject.city,
    county: subject.county,
    state: subject.state,
    fips: subject.fips,
    zip: subject.zip,
    owner: subject.owner,
    acreage: {
      value: subject.governingAcreage.value,
      basis: subject.governingAcreage.kind,
      source: subject.governingAcreage.source,
      observedAt: subject.governingAcreage.observedAt,
      disputed: subject.governingAcreage.disputed,
      superseded: subject.supersededAcreage,
    },
    basis: subject.basis,
    confidence: subject.confidence,
  };
}

/**
 * Is a result that ran against `ranAgainst` still current?
 *
 * A result correlated to an older subject version stays visible as history and
 * is never presented as a current conclusion. An uncorrelated result (no version
 * recorded) is treated as NOT current: it cannot prove which subject it answered
 * about, and assuming it answered about this one is the substitution this whole
 * contract exists to prevent.
 */
export function isCurrentForSubject(ranAgainst: string | null | undefined, current: string): boolean {
  return typeof ranAgainst === 'string' && ranAgainst.length > 0 && ranAgainst === current;
}

/** Does the working subject satisfy ONE declared prerequisite? */
export function subjectMeetsPrerequisite(subject: CanonicalSubjectState, prerequisite: CapabilityPrerequisite): boolean {
  switch (prerequisite) {
    case 'parcel': return subject.subjectResolved;
    case 'county': return !!(subject.county && subject.state) || !!subject.fips;
    case 'zip': return !!subject.zip;
    case 'owner': return !!subject.owner;
    case 'seller_communications': return subject.sellerCommunicationsAvailable;
  }
}

/**
 * The declared prerequisites the subject does NOT yet satisfy. A clause that is
 * an array is any-of (e.g. county OR ZIP for market geography); the clause's
 * first member names the gap when none of its alternatives hold. Empty result
 * means the capability/item may run NOW.
 */
export function unmetPrerequisites(
  subject: CanonicalSubjectState,
  clauses: readonly CapabilityPrerequisiteClause[] | undefined,
): CapabilityPrerequisite[] {
  const unmet: CapabilityPrerequisite[] = [];
  for (const clause of clauses ?? []) {
    const alternatives = Array.isArray(clause) ? clause : [clause];
    if (!alternatives.some((p) => subjectMeetsPrerequisite(subject, p))) unmet.push(alternatives[0]);
  }
  return unmet;
}

/**
 * PURE READ. The subject state every decision point consumes.
 *
 * `subjectResolved` follows the accepted canonical identity (the spine verdict
 * or the built identity version). `officiallyVerified` follows the official
 * parcel-record flag on the property card. The two are reported independently.
 */
export function resolveCanonicalSubjectState(dealCardId: number): CanonicalSubjectState {
  const view = resolveCanonicalIdentity(dealCardId);
  const extras = cardExtras(view.propertyCardId);
  const acreage = governingAcreageFor(dealCardId, view);
  return {
    dealCardId,
    propertyCardId: view.propertyCardId,
    // Official verification is strictly STRONGER than research-grade
    // establishment, so a verified legacy card whose spine verdict was never
    // written is still an established subject. The reverse never holds.
    subjectResolved: view.confirmed || extras.officiallyVerified,
    officiallyVerified: extras.officiallyVerified,
    officialVerificationSource: extras.officialVerificationSource,
    status: view.status,
    source: view.source,
    apn: view.apn,
    apnNormalized: normalizeApn(view.apn),
    address: view.address,
    city: view.city,
    county: view.county,
    state: view.state,
    fips: extras.fips,
    zip: view.zip,
    owner: view.owner,
    subjectVersion: subjectVersionToken(view, acreage.governing),
    subjectVersionId: view.versionId,
    governingAcreage: acreage.governing,
    supersededAcreage: acreage.superseded.map((entry) => ({
      kind: entry.kind,
      value: entry.value as number,
      source: entry.source,
      observedAt: entry.observedAt,
      reason: entry.supersededReason,
    })),
    sellerCommunicationsAvailable: sellerCommunicationsAvailable(dealCardId, view.propertyCardId),
    basis: view.basis,
    confidence: view.confidence,
    sourceRefs: view.sourceRefs,
    confirmedAt: view.confirmedAt,
  };
}
