// LandOS — Inherited property / representative-seller handling.
//
// Seller (lead contact) and owner-of-record names frequently differ: inheritance,
// probate, estate, trust, LLC, spouse, executor, administrator, power of attorney.
// A name mismatch must NEVER invalidate the parcel. Parcel identity comes from
// APN / parcel ID / county / state / address / legal description / coordinates /
// official records — NOT the seller's name. We preserve BOTH identities, keep the
// owner-of-record as the verified record, keep the seller relationship Seller-
// stated until independently verified, keep authority-to-sell Needs Verification,
// and generate the right verification tasks. Pure + deterministic.

export type IdentityStatus = 'verified' | 'needs_verification' | 'not_verified';
export type AuthorityStatus = 'verified' | 'needs_verification' | 'not_applicable';

/** Likely relationship inferred from the owner-of-record string (display only;
 *  never used to verify authority — it only tailors the verification tasks). */
export type SellerRelationshipGuess =
  | 'trust' | 'llc_entity' | 'estate_probate' | 'life_estate' | 'multiple_owners'
  | 'individual' | 'unknown';

const ENTITY_PATTERNS: Array<{ guess: SellerRelationshipGuess; rx: RegExp }> = [
  { guess: 'trust', rx: /\btrust\b|\btrustee\b|\b(rev(ocable)?|irrev(ocable)?)\s+(living\s+)?trust\b|\bfamily\s+trust\b/i },
  { guess: 'llc_entity', rx: /\bllc\b|\bl\.l\.c\.|\binc\b|\bcorp\b|\bcompany\b|\bltd\b|\bpartners?\b|\bproperties\b|\bholdings\b/i },
  { guess: 'estate_probate', rx: /\bestate\b|\bheirs?\b|\bdeceased\b|\bdecd\b|\bexecutor\b|\badministrator\b|\bprobate\b/i },
  { guess: 'life_estate', rx: /\blife\s+estate\b|\blife\s+tenant\b|\bremainder(man)?\b|\bL\/?E\b/ },
  { guess: 'multiple_owners', rx: /\b(et\s+al|et\s+ux|et\s+vir)\b|;|\b&\b|\band\b.*\b(jr|sr|ii|iii)\b/i },
];

function normName(s?: string): string {
  return (s ?? '').toLowerCase().replace(/[.,]/g, ' ').replace(/\b(jr|sr|ii|iii|iv|mr|mrs|ms|dr)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Loose person-name match: same surname + a shared given/initial. Tolerates
 *  order ("JACK BLACK" vs "BLACK, JACK") and middle names. Never strict. */
export function namesLikelyMatch(a?: string, b?: string): boolean {
  const na = normName(a); const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = new Set(na.split(' ').filter((w) => w.length > 1));
  const tb = new Set(nb.split(' ').filter((w) => w.length > 1));
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared += 1;
  // Need at least 2 shared tokens (e.g. first+last), or one shared token when one
  // side is a single name — but a single shared common word is not enough.
  const minTokens = Math.min(ta.size, tb.size);
  return shared >= 2 || (minTokens === 1 && shared === 1);
}

export function guessRelationship(ownerOfRecord?: string): SellerRelationshipGuess {
  const o = ownerOfRecord ?? '';
  for (const { guess, rx } of ENTITY_PATTERNS) if (rx.test(o)) return guess;
  return o.trim() ? 'individual' : 'unknown';
}

export interface VerificationTask {
  task: string;
  reason: string;
  status: 'needs_verification';
}

export interface SellerAuthorityAssessment {
  /** True only when a parcel identifier (APN/parcel id/address+locality) exists. */
  parcelIdentified: boolean;
  sellerName?: string;
  ownerOfRecord?: string;
  /** True when the names plausibly match (no mismatch). */
  nameMatch: boolean;
  /** Parcel identity is independent of the name mismatch. */
  parcelIdentityStatus: IdentityStatus;
  /** Owner-of-record from an official source can be Verified. */
  ownerOfRecordStatus: IdentityStatus;
  /** The seller's relationship to the property stays Seller-stated until verified. */
  sellerRelationshipStatus: 'seller_stated' | 'verified';
  /** Authority to sell stays Needs Verification until confirmed. */
  authorityToSellStatus: AuthorityStatus;
  relationshipGuess: SellerRelationshipGuess;
  verificationTasks: VerificationTask[];
  /** Operator-facing summary line. */
  summary: string;
}

/**
 * Assess seller authority vs owner-of-record. A name mismatch NEVER invalidates
 * the parcel; it only flags that seller authority needs verification and tailors
 * the verification tasks (probate / trust / LLC / POA / signatories). Pure.
 */
export function assessSellerAuthority(input: {
  sellerName?: string;
  ownerOfRecord?: string;
  parcelVerified: boolean;
  ownerFromOfficialSource?: boolean;
}): SellerAuthorityAssessment {
  const nameMatch = namesLikelyMatch(input.sellerName, input.ownerOfRecord);
  const relationshipGuess = guessRelationship(input.ownerOfRecord);
  const ownerOfRecordStatus: IdentityStatus = input.ownerFromOfficialSource ? 'verified' : input.parcelVerified ? 'verified' : 'needs_verification';

  const tasks: VerificationTask[] = [];
  const add = (task: string, reason: string) => tasks.push({ task, reason, status: 'needs_verification' });

  // Name mismatch (or an entity owner) → seller authority is unconfirmed; build tasks.
  const mismatch = !!(input.sellerName && input.ownerOfRecord && !nameMatch);
  if (mismatch || relationshipGuess !== 'individual') {
    add('Verify seller authority to sell', 'Seller name differs from owner of record (or owner is an entity) — confirm who is legally authorized to sell.');
    add('Verify deed transfer / chain of title', 'Confirm how the seller is connected to the owner-of-record on title.');
  }
  if (relationshipGuess === 'estate_probate' || mismatch) {
    add('Verify probate / estate status', 'Possible inherited / estate property — confirm probate is open/closed and who has authority.');
    add('Verify inheritance / heirship', 'Confirm the seller is a legal heir or estate representative.');
    add('Verify executor / administrator authority', 'If estate: confirm letters testamentary / of administration.');
    add('Confirm required signatories', 'Estates / multiple heirs may require several signatures to convey.');
  }
  if (relationshipGuess === 'trust') {
    add('Verify trust authority', 'Confirm the trustee and the trust\'s authority to convey the parcel.');
    add('Confirm required signatories', 'Confirm which trustee(s) must sign.');
  }
  if (relationshipGuess === 'llc_entity') {
    add('Verify LLC / entity authority', 'Confirm the entity is in good standing and who is authorized to sign for it.');
    add('Confirm authorized signatory', 'Confirm the member/manager/officer authorized to convey.');
  }
  if (relationshipGuess === 'life_estate' || relationshipGuess === 'multiple_owners') {
    add('Confirm required signatories', 'Life estate / multiple owners may require additional signatures (e.g. remaindermen).');
  }
  // POA is always a possibility when the seller isn't the record owner.
  if (mismatch) add('Verify power of attorney (if applicable)', 'If the seller signs on the owner\'s behalf, confirm a valid POA.');

  const authorityToSellStatus: AuthorityStatus = tasks.length ? 'needs_verification' : 'verified';

  return {
    parcelIdentified: input.parcelVerified,
    sellerName: input.sellerName,
    ownerOfRecord: input.ownerOfRecord,
    nameMatch,
    parcelIdentityStatus: input.parcelVerified ? 'verified' : 'needs_verification',
    ownerOfRecordStatus,
    sellerRelationshipStatus: 'seller_stated',
    authorityToSellStatus,
    relationshipGuess,
    verificationTasks: tasks,
    summary: !input.sellerName || !input.ownerOfRecord
      ? (input.parcelVerified ? 'Parcel verified. Owner-of-record on file; seller relationship Seller-stated.' : 'Parcel not yet verified.')
      : nameMatch
        ? 'Parcel verified. Seller name matches owner of record (no authority flag).'
        : `Parcel verified. Seller (${input.sellerName}) differs from owner of record (${input.ownerOfRecord}) — parcel is NOT rejected; seller authority Needs Verification.`,
  };
}
