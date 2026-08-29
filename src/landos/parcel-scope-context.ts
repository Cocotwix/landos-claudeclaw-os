// Parcel scope and neighboring-owner context.
//
// Three concepts that a LandPortal investigation constantly blurs are kept
// apart here:
//
//   1. the individual parcel,
//   2. the contiguous ownership cluster,
//   3. the transaction subject.
//
// Retaining a parcel record during research never makes it subject truth. A
// LandPortal owner-name sweep pulls in whatever happens to sit next to the
// subject, so a neighbouring owner's acreage, improvements, and listing price
// have to stay addressable without ever being readable as the subject's.
//
// This is deliberately not a parcel graph. It holds the smallest scope label a
// piece of evidence needs in order to stop speaking for a parcel it does not
// describe, plus the owner-name clues a LandPortal sweep can actually see.
//
// No network and no persistence of its own: callers hand it retained evidence
// and operator-confirmed context and get back labelled scopes.

/** Where a parcel sits relative to the transaction subject. */
export type ParcelScope =
  | 'subject_parcel'
  | 'seller_ownership_cluster'
  | 'related_seller_parcel'
  | 'other_owner_neighbor'
  | 'historical_parent_parcel'
  | 'unresolved_related_parcel';

/** Only `subject_parcel` may contribute canonical subject facts. */
export function scopeCarriesSubjectFacts(scope: ParcelScope): boolean {
  return scope === 'subject_parcel';
}

export const PARCEL_SCOPE_LABELS: Record<ParcelScope, string> = {
  subject_parcel: 'Subject parcel',
  seller_ownership_cluster: 'Seller ownership cluster',
  related_seller_parcel: 'Related seller parcel',
  other_owner_neighbor: 'Other-owner neighbor',
  historical_parent_parcel: 'Historical / parent parcel',
  unresolved_related_parcel: 'Unresolved related parcel',
};

/** How a neighbouring owner name compares to the subject's. A name match is a
 *  clue for an investigator, never a relationship. */
export type OwnerRelation =
  | 'same_exact_owner'
  | 'same_surname'
  | 'different_owner'
  | 'unknown';

export const OWNER_RELATION_LABELS: Record<OwnerRelation, string> = {
  same_exact_owner: 'Same owner name as the subject',
  same_surname: 'Shares the subject owner surname',
  different_owner: 'Different owner',
  unknown: 'Owner not displayed',
};

/** Normalize a displayed owner name for comparison: drop record punctuation,
 *  collapse whitespace, uppercase. */
export function normalizeOwnerName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
}

const NAME_SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V']);

/** Best-effort surname from an assessor-style owner string. County records lead
 *  with the surname ("HILL EUGENE W JR"), so the first token is the surname and
 *  a bare suffix is not. Returns '' when nothing usable is present. */
export function ownerSurname(value: unknown): string {
  const normalized = normalizeOwnerName(value);
  if (normalized === '') return '';
  const first = normalized.split(' ')[0];
  if (first === undefined || first === '' || NAME_SUFFIXES.has(first)) return '';
  return first;
}

/** Compare a neighbouring owner to the subject owner. Either name being absent
 *  is `unknown`, never `different_owner`: a missing name is missing evidence,
 *  not evidence of difference. */
export function classifyOwnerRelation(
  subjectOwner: unknown,
  neighborOwner: unknown,
): OwnerRelation {
  const subject = normalizeOwnerName(subjectOwner);
  const neighbor = normalizeOwnerName(neighborOwner);
  if (subject === '' || neighbor === '') return 'unknown';
  if (subject === neighbor) return 'same_exact_owner';
  const subjectSurname = ownerSurname(subject);
  const neighborSurname = ownerSurname(neighbor);
  if (subjectSurname !== '' && subjectSurname === neighborSurname) return 'same_surname';
  return 'different_owner';
}

/** Compare APNs ignoring the punctuation county records vary on. */
export function sameApn(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): string =>
    typeof v === 'string' ? v.replace(/[^0-9A-Za-z]/g, '').toUpperCase() : '';
  const left = norm(a);
  return left !== '' && left === norm(b);
}

/** A parcel seen next to the subject during a LandPortal owner-name sweep. */
export interface NeighborParcelContext {
  apn: string | null;
  displayedOwner: string | null;
  ownerRelation: OwnerRelation;
  /** Only from retained evidence that actually speaks to improvements. */
  improvement: 'improved' | 'vacant' | 'unknown';
  scope: ParcelScope;
  /** Why this scope was assigned, in operator-readable terms. */
  basis: string;
  source: string;
}

export interface NeighborContextInput {
  apn?: string | null;
  displayedOwner?: string | null;
  improvement?: 'improved' | 'vacant' | 'unknown';
  source?: string | null;
  /** APNs the operator has confirmed belong to the seller holding. */
  operatorConfirmedClusterApns?: readonly string[];
}

/**
 * Assign a scope to one parcel observed beside the subject.
 *
 * Operator-confirmed cluster membership outranks a name comparison: the
 * operator knowing which parcels the sellers own is stronger evidence than two
 * surnames matching on a map. A shared surname alone only earns
 * `unresolved_related_parcel`, because spouse, inheritance, and common
 * ownership are inferences this function is not entitled to make.
 */
export function classifyNeighborParcel(
  subjectApn: unknown,
  subjectOwner: unknown,
  input: NeighborContextInput,
): NeighborParcelContext {
  const apn = typeof input.apn === 'string' && input.apn.trim() !== '' ? input.apn.trim() : null;
  const displayedOwner =
    typeof input.displayedOwner === 'string' && input.displayedOwner.trim() !== ''
      ? input.displayedOwner.trim()
      : null;
  const ownerRelation = classifyOwnerRelation(subjectOwner, displayedOwner);
  const source = typeof input.source === 'string' && input.source.trim() !== ''
    ? input.source.trim()
    : 'LandPortal owner-name context';
  const improvement = input.improvement ?? 'unknown';

  let scope: ParcelScope;
  let basis: string;

  if (apn !== null && sameApn(apn, subjectApn)) {
    scope = 'subject_parcel';
    basis = 'Matches the verified subject APN.';
  } else if (
    apn !== null
    && (input.operatorConfirmedClusterApns ?? []).some((candidate) => sameApn(candidate, apn))
  ) {
    scope = 'related_seller_parcel';
    basis = 'Operator-confirmed as part of the seller holding.';
  } else if (ownerRelation === 'same_exact_owner') {
    scope = 'related_seller_parcel';
    basis = 'Displays the same owner name as the subject parcel.';
  } else if (ownerRelation === 'same_surname') {
    scope = 'unresolved_related_parcel';
    basis =
      'Shares the subject owner surname. A shared surname is an investigative clue only; no '
      + 'family, marital, inheritance, or common-ownership relationship is inferred from it.';
  } else if (ownerRelation === 'different_owner') {
    scope = 'other_owner_neighbor';
    basis = 'A different owner name is displayed, so this is neighboring context only.';
  } else {
    scope = 'unresolved_related_parcel';
    basis = 'No owner name was displayed for this parcel.';
  }

  return { apn, displayedOwner, ownerRelation, improvement, scope, basis, source };
}

/** Operator-supplied parcel context, usable the moment it is given. */
export interface OperatorParcelContext {
  /** What the operator stated, in their terms. */
  statement: string;
  /** APNs the operator attributes to the seller holding, when they named any. */
  clusterApns: string[];
  /** Parcel count the operator attributes to the seller holding. */
  clusterParcelCount: number | null;
  /** True when the operator placed a manufactured home on a retained parcel. */
  adjoiningManufacturedHome: boolean;
  /** Whether independent retrieval has since supported the statement. */
  corroboration: 'operator_confirmed' | 'corroborated' | 'contradicted';
}

export const CORROBORATION_LABELS: Record<OperatorParcelContext['corroboration'], string> = {
  operator_confirmed:
    'Operator-confirmed. Usable working evidence; independent corroboration not yet retrieved.',
  corroborated: 'Operator-confirmed and independently corroborated.',
  contradicted: 'Operator-confirmed, but independent evidence disagrees. Investigate.',
};

/**
 * Whether the Land + Home Package exit is worth investigating.
 *
 * The trigger is deliberately cheap: a manufactured home standing on a parcel
 * the sellers retain says the product is plausible in this exact parcel
 * context, which is all an investigation needs to start. It says nothing about
 * whether a home may lawfully be placed on the subject, so the result keeps
 * `legallyApproved` false and names what still has to be established.
 */
export interface LandHomeTrigger {
  triggered: boolean;
  legallyApproved: false;
  label: string;
  reason: string;
  openQuestions: string[];
}

export function evaluateLandHomeTrigger(
  context: Pick<OperatorParcelContext, 'adjoiningManufacturedHome'>,
): LandHomeTrigger {
  if (!context.adjoiningManufacturedHome) {
    return {
      triggered: false,
      legallyApproved: false,
      label: 'Land + Home Package — not triggered',
      reason: 'No manufactured home is established on a parcel the sellers retain.',
      openQuestions: [],
    };
  }
  return {
    triggered: true,
    legallyApproved: false,
    label: 'Land + Home Package — investigate',
    reason:
      'A manufactured home stands on a parcel the sellers retain, so the product is plausible '
      + 'enough in this parcel context to investigate. This is a trigger to research, not a '
      + 'finding that a home may lawfully be placed on the subject.',
    openQuestions: [
      'Manufactured-home zoning and use eligibility on the subject parcel.',
      'Public water and sewer availability, or well and septic feasibility.',
      'Site and placement constraints on the subject parcel.',
      'Closed manufactured-home sales that included the land, excluding park, lot-rent, and leased-land transactions.',
      'Supported finished resale value, kept separate from current vacant-land FMV.',
    ],
  };
}

/** Scope of a retained marketplace listing relative to the subject. */
export type ListingScope =
  | 'subject_parcel_listing'
  | 'related_seller_parcel_listing'
  | 'ownership_cluster_listing'
  | 'unrelated_property_listing'
  | 'unresolved_listing_scope';

export const LISTING_SCOPE_LABELS: Record<ListingScope, string> = {
  subject_parcel_listing: 'Subject parcel listing',
  related_seller_parcel_listing: 'Related seller parcel listing',
  ownership_cluster_listing: 'Ownership-cluster / multi-parcel listing',
  unrelated_property_listing: 'Unrelated property listing',
  unresolved_listing_scope: 'Unresolved listing scope',
};

/** A listing only supplies subject facts when it is scoped to the subject. */
export function listingCarriesSubjectFacts(scope: ListingScope): boolean {
  return scope === 'subject_parcel_listing';
}

export interface ListingScopeInput {
  listingAcres?: number | null;
  listingApn?: string | null;
  mentionsManufacturedHome?: boolean;
  subjectApn?: string | null;
  subjectAcres?: number | null;
  subjectIsVacant?: boolean;
  clusterParcelCount?: number | null;
}

export interface ListingScopeAssessment {
  scope: ListingScope;
  label: string;
  basis: string;
  carriesSubjectFacts: boolean;
}

/**
 * Scope a retained listing against the subject.
 *
 * An APN on the listing settles it. Otherwise acreage does the work: a listing
 * materially larger than the subject cannot be describing the subject alone,
 * and when the sellers hold several contiguous parcels the combined holding is
 * the honest reading. An improved listing against a vacant subject is decisive
 * on its own, because a vacant parcel does not have a house on it.
 */
export function classifyListingScope(input: ListingScopeInput): ListingScopeAssessment {
  const finish = (scope: ListingScope, basis: string): ListingScopeAssessment => ({
    scope,
    label: LISTING_SCOPE_LABELS[scope],
    basis,
    carriesSubjectFacts: listingCarriesSubjectFacts(scope),
  });

  if (typeof input.listingApn === 'string' && input.listingApn.trim() !== '') {
    if (sameApn(input.listingApn, input.subjectApn)) {
      return finish('subject_parcel_listing', 'The listing carries the subject APN.');
    }
    return finish(
      'related_seller_parcel_listing',
      'The listing carries an APN other than the subject.',
    );
  }

  const listingAcres = typeof input.listingAcres === 'number' && Number.isFinite(input.listingAcres)
    ? input.listingAcres
    : null;
  const subjectAcres = typeof input.subjectAcres === 'number' && Number.isFinite(input.subjectAcres)
    ? input.subjectAcres
    : null;
  const improvedAgainstVacant = input.subjectIsVacant === true
    && input.mentionsManufacturedHome === true;
  const materiallyLarger = listingAcres != null
    && subjectAcres != null
    && listingAcres > subjectAcres * 1.25;

  if (!materiallyLarger && !improvedAgainstVacant) {
    return finish(
      'unresolved_listing_scope',
      'No APN is present and nothing in the listing separates it from the subject.',
    );
  }

  const reasons: string[] = [];
  if (materiallyLarger && listingAcres != null && subjectAcres != null) {
    reasons.push(`the listed ${listingAcres} acres materially exceed the subject's ${subjectAcres}`);
  }
  if (improvedAgainstVacant) {
    reasons.push('it markets a manufactured home while the subject is vacant land');
  }
  const because = reasons.join(', and ');

  if ((input.clusterParcelCount ?? 0) > 1) {
    return finish(
      'ownership_cluster_listing',
      `Scoped to the combined seller holding because ${because}. Its acreage, improvement, size, `
        + 'and price describe the cluster and are not subject facts.',
    );
  }
  return finish(
    'unresolved_listing_scope',
    `Not the subject, because ${because}. No confirmed seller holding is recorded to scope it to.`,
  );
}
