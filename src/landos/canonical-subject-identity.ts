// Canonical acquisition-subject identity.
//
// LandOS may hold ONE active Deal Card per canonical acquisition subject. This
// module is the single place that decides whether two records describe the same
// subject, so the New Lead path, the identity-correction path and the
// canonicalization migration all agree by construction.
//
// The rule that matters: identity is the PARCEL, not the address string. Rural
// addressing, mailing addresses and feed formatting all vary for one parcel, and
// three separate cards were created for one Bradford County parcel precisely
// because matching ran on raw intake text before the identifier was normalized
// or corrected. Address is therefore only ever a PROVISIONAL key, and every
// provisional record is rematched once an official APN appears.

/** How much of the parent parcel the acquisition covers. */
export type SubjectScope =
  | { kind: 'whole_parcel' }
  /** A split/partial conveyance carved out of the parent parcel. */
  | { kind: 'partial'; label: string }
  /** Several parcels acquired together. */
  | { kind: 'assemblage'; label: string };

export interface SubjectIdentityInput {
  state?: string | null;
  county?: string | null;
  apn?: string | null;
  address?: string | null;
  zip?: string | null;
  lat?: number | null;
  lng?: number | null;
  scope?: SubjectScope | null;
}

export type SubjectKeyBasis = 'apn' | 'provisional_address' | 'provisional_point' | 'none';

export interface SubjectKey {
  key: string;
  basis: SubjectKeyBasis;
  /** True only for an APN-based key; a provisional key must be rematched later. */
  official: boolean;
}

const WHOLE_PARCEL: SubjectScope = { kind: 'whole_parcel' };

/**
 * Normalize a parcel identifier for COMPARISON only.
 *
 * Case, spaces, dots and dashes are formatting, not identity: `00083-A-03400`,
 * `00083 A 03400` and `00083A03400` are one parcel. The normalized form is never
 * written back over the stored APN — the retained value keeps its own formatting
 * and provenance.
 */
export function normalizeApn(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const stripped = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return stripped.length > 0 ? stripped : null;
}

/**
 * Reject a parcel identifier that swallowed a neighbouring intake field.
 *
 * Deal 114 was created because the parser appended the seller-stated acreage to
 * the APN and produced `00083-A-034001.5`, which no APN comparison could ever
 * match to `00083-A-03400`. A trailing decimal acreage is not part of any parcel
 * identifier, so it is stripped and reported rather than silently accepted as a
 * distinct parcel.
 */
export function stripAbsorbedAcreage(raw: string | null | undefined): {
  apn: string | null;
  absorbedAcreage: number | null;
} {
  if (typeof raw !== 'string' || raw.trim() === '') return { apn: null, absorbedAcreage: null };
  const trimmed = raw.trim();
  // A real APN never ends in a decimal fraction. `...034001.5` = APN + "1.5" ac.
  // The head is greedy and the acreage tail is bounded, so the split takes the
  // SHORTEST trailing decimal ("1.5") rather than swallowing parcel digits into
  // it ("034001.5", which would leave a truncated "00083-A").
  const match = /^(.*)(\d{1,4}\.\d{1,3})$/.exec(trimmed);
  if (!match) return { apn: trimmed, absorbedAcreage: null };
  const [, head, tail] = match;
  const acreage = Number(tail);
  if (!Number.isFinite(acreage) || acreage <= 0) return { apn: trimmed, absorbedAcreage: null };
  const cleaned = head.replace(/[\s\-.]+$/, '');
  if (normalizeApn(cleaned) == null) return { apn: trimmed, absorbedAcreage: null };
  return { apn: cleaned, absorbedAcreage: acreage };
}

/**
 * A ZIP is five digits AND is not simply the street number repeated.
 *
 * The Lake Butler feed supplied ZIP `19554` — the house number of
 * `19554 NW 137th Ln`. Accepting it split one parcel across two postal
 * identities, so a ZIP echoing the address's leading house number is refused.
 */
export function acceptZip(zip: string | null | undefined, address: string | null | undefined): string | null {
  if (typeof zip !== 'string') return null;
  const digits = zip.trim().slice(0, 5);
  if (!/^\d{5}$/.test(digits)) return null;
  const houseNumber = typeof address === 'string' ? /^\s*(\d+)/.exec(address)?.[1] : undefined;
  if (houseNumber && houseNumber === digits) return null;
  return digits;
}

/** Two-letter USPS state code, or null when the value is not one. */
export function normalizeState(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

/** County/jurisdiction name reduced to comparable letters. */
export function normalizeJurisdiction(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.toUpperCase().replace(/\bCOUNTY\b|\bPARISH\b|\bBOROUGH\b/g, '').replace(/[^A-Z0-9]/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

function scopeSuffix(scope: SubjectScope | null | undefined): string {
  const value = scope ?? WHOLE_PARCEL;
  if (value.kind === 'whole_parcel') return 'whole';
  // A split, partial conveyance or assemblage is a DIFFERENT acquisition subject
  // even on the same parent APN, so its label participates in the key.
  return `${value.kind}:${value.label.trim().toLowerCase()}`;
}

/** Street-type tokens that make a string recognisable as a postal address. */
const STREET_TOKENS = new RegExp(
  '\\b(?:st|street|rd|road|ln|lane|ave|avenue|dr|drive|ct|court|blvd|boulevard|hwy|highway'
  + '|way|pkwy|parkway|trl|trail|cir|circle|pl|place|ter|terrace|loop|route|rte|pike|run'
  + '|path|row|bnd|bend|xing|crossing|holw|hollow|ridge|rdg|creek|crk|county\\s+road|cr)\\b',
  'i',
);

/**
 * Is this string plausibly a street address rather than prose?
 *
 * Conversational intake hands this module whatever the parser pulled out of a
 * paste, and a sentence fragment ("...parcel number and I am not...") normalizes
 * into a perfectly well-formed key that then claims a subject and silently
 * blocks or absorbs real leads. A provisional key is a weak claim already; it
 * must at least be a claim about an ADDRESS.
 *
 * Deliberately permissive: a leading house number OR a street-type token is
 * enough. This rejects prose, not unusual addressing.
 */
function isPlausibleStreetAddress(cleaned: string): boolean {
  if (cleaned.length < 4 || cleaned.length > 120) return false;
  if (/^\s*\d+\s+\S/.test(cleaned)) return true;
  return STREET_TOKENS.test(cleaned);
}

function normalizeAddress(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return null;
  return isPlausibleStreetAddress(cleaned) ? cleaned : null;
}

/**
 * The comparison key for an acquisition subject.
 *
 * An APN-based key is `official` and stable. Anything weaker is provisional and
 * MUST be revisited by {@link shouldRematch} once a parcel identifier lands.
 */
export function subjectKey(input: SubjectIdentityInput): SubjectKey {
  const scope = scopeSuffix(input.scope);
  const { apn: repaired } = stripAbsorbedAcreage(input.apn);
  const apn = normalizeApn(repaired);
  const state = normalizeState(input.state);
  const jurisdiction = normalizeJurisdiction(input.county);
  // A usable APN plus its governing jurisdiction is the only official identity.
  // State alone is enough when the county has not been resolved yet: an APN is
  // unique within its county, and a missing county must not fabricate a second
  // parcel identity for the same APN.
  if (apn && state) return { key: `apn:${state}:${jurisdiction ?? '?'}:${apn}:${scope}`, basis: 'apn', official: true };

  const address = normalizeAddress(input.address);
  const zip = acceptZip(input.zip, input.address);
  if (address && (state || zip)) {
    return { key: `addr:${state ?? '?'}:${zip ?? '?'}:${address}:${scope}`, basis: 'provisional_address', official: false };
  }
  if (typeof input.lat === 'number' && typeof input.lng === 'number'
    && Number.isFinite(input.lat) && Number.isFinite(input.lng)) {
    // ~11 m of precision: enough to collide the same parcel centroid, far too
    // coarse to ever establish identity on its own (invariant 3).
    return {
      key: `pt:${input.lat.toFixed(4)}:${input.lng.toFixed(4)}:${scope}`,
      basis: 'provisional_point',
      official: false,
    };
  }
  return { key: '', basis: 'none', official: false };
}

/** Do these two records describe the same acquisition subject? */
export function isSameSubject(a: SubjectIdentityInput, b: SubjectIdentityInput): boolean {
  const left = subjectKey(a);
  const right = subjectKey(b);
  if (left.basis === 'none' || right.basis === 'none') return false;
  return left.key === right.key;
}

/**
 * A provisional record must be rematched when its identity is corrected — that
 * is the step whose absence left three active cards for one parcel: each card's
 * APN was corrected LATER, and nothing revisited the duplicate question after
 * the correction landed.
 */
export function shouldRematch(before: SubjectIdentityInput, after: SubjectIdentityInput): boolean {
  const previous = subjectKey(before);
  const next = subjectKey(after);
  if (next.basis === 'none') return false;
  if (previous.key !== next.key) return true;
  // Same key, but the basis was upgraded from provisional to official.
  return !previous.official && next.official;
}
