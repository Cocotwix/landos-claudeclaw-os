// Is a comparable row the SUBJECT PARCEL ITSELF?
//
// A property cannot be a comparable for its own valuation: its own sale is the
// thing being valued, so admitting it lets the subject help set its own price.
// On 5170 Hwy 60 the subject's APN 023 003.02 sat in the valuation set carrying
// weight against a 40.5-acre subject.
//
// Identity decides this, never resemblance. Either of two things establishes
// it: LandPortal's own canonical property id, read off the row's parcel URL, or
// an APN that reconciles with the subject's INSIDE the same jurisdiction —
// exactly the identity gate PERMANENT_MEMORY invariant 2 requires. Address text
// decides nothing here: a shared street is not a shared parcel, and the subject
// row on card 77 in fact carries ANOTHER parcel's URL, so a URL-only test would
// have missed it.

import { apnIdentifiersEquivalent } from './landportal-capability.js';
import { countyNamesAgree, stateNamesAgree } from './landportal-canonical-identity.js';
import { landPortalIdentityFromUrl } from './landportal-operating-rules.js';

/** The canonical identity of the subject parcel — what a row must MATCH to be
 *  the subject, as opposed to merely resembling it. */
export interface SubjectParcelIdentity {
  apn: string | null;
  county: string | null;
  state: string | null;
  landPortalPropertyId: string | null;
}

/** The identity-bearing fields of a comparable row. */
export interface CompParcelIdentityRow {
  apn: string | null;
  county: string | null;
  state: string | null;
  sourceUrl: string | null;
}

/**
 * Returns the identity basis when the row IS the subject parcel, or null.
 *
 * A row that states no jurisdiction cannot have its APN confirmed against the
 * subject's, so it is NOT treated as the subject: an unconfirmable identity
 * leaves a row exactly where it was rather than deleting a real comparable on a
 * guess. The same holds when the subject itself has no established identity.
 */
export function subjectParcelMatch(
  row: CompParcelIdentityRow,
  subject: SubjectParcelIdentity,
): string | null {
  const rowPropertyId = landPortalIdentityFromUrl(row.sourceUrl)?.propertyId ?? null;
  if (rowPropertyId && subject.landPortalPropertyId && rowPropertyId === subject.landPortalPropertyId) {
    return `LandPortal property id ${rowPropertyId}`;
  }
  if (!row.apn || !subject.apn || !apnIdentifiersEquivalent(row.apn, subject.apn)) return null;
  const countyKnown = !!row.county && !!subject.county;
  const stateKnown = !!row.state && !!subject.state;
  if (!countyKnown && !stateKnown) return null;
  if (countyKnown && !countyNamesAgree(row.county, subject.county)) return null;
  if (stateKnown && !stateNamesAgree(row.state, subject.state)) return null;
  const jurisdiction = [subject.county, subject.state].filter(Boolean).join(', ');
  return `APN ${row.apn}${jurisdiction ? ` in ${jurisdiction}` : ''}`;
}
