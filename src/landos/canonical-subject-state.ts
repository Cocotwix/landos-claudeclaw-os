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
import { governingAcreageOf, type GoverningAcreage } from './acreage-basis.js';
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
  /** THE single governing acreage conclusion. Alternate measurements remain
   *  reference evidence on the shared acreage basis record. */
  governingAcreage: GoverningAcreage;
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

function cardExtras(propertyCardId: number | null): { fips: string | null; officiallyVerified: boolean } {
  if (propertyCardId == null) return { fips: null, officiallyVerified: false };
  try {
    const row = getLandosDb()
      .prepare('SELECT fips, verification_status, verification_source FROM landos_property_card WHERE id = ?')
      .get(propertyCardId) as { fips?: string | null; verification_status?: string | null; verification_source?: string | null } | undefined;
    return {
      fips: typeof row?.fips === 'string' && row.fips.trim() ? row.fips.trim() : null,
      officiallyVerified: row?.verification_status === 'verified_property'
        && isOfficialPropertyVerificationSource(row?.verification_source),
    };
  } catch {
    return { fips: null, officiallyVerified: false };
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
function governingAcreageFor(dealCardId: number, view: CanonicalIdentityView): GoverningAcreage {
  try {
    const record = operatorRecordFor(dealCardId);
    if (record) {
      const governing = record.identity.governingAcreage ?? governingAcreageOf(record.identity.acreageBasis);
      if (governing.value != null) return governing;
    }
  } catch { /* the reconciled record is a refinement, not a prerequisite */ }
  return { value: view.acreage, kind: null, source: null, disputed: false };
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
  return {
    dealCardId,
    propertyCardId: view.propertyCardId,
    // Official verification is strictly STRONGER than research-grade
    // establishment, so a verified legacy card whose spine verdict was never
    // written is still an established subject. The reverse never holds.
    subjectResolved: view.confirmed || extras.officiallyVerified,
    officiallyVerified: extras.officiallyVerified,
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
    governingAcreage: governingAcreageFor(dealCardId, view),
    sellerCommunicationsAvailable: sellerCommunicationsAvailable(dealCardId, view.propertyCardId),
    basis: view.basis,
    confidence: view.confidence,
    sourceRefs: view.sourceRefs,
    confirmedAt: view.confirmedAt,
  };
}
