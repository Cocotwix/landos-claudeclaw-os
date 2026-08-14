// Is an incoming comparable observation the SAME PARCEL as one already on file?
//
// The comp registry used to answer that by comparing VALUES: its canonical key
// was built out of price and acreage, and its duplicate test required both to
// match to within a cent and a ten-thousandth of an acre. So the moment two
// capture generations read different figures for one parcel — precisely when
// reconciliation matters — the registry concluded they were different
// properties and stored both.
//
// On 5170 Hwy 60 that produced two rows for APN 044 068.01: $200,000 over 5.05
// acres and $550,000 over 20.55. Which one priced the subject depended on which
// duplicate the downstream dedupe happened to rank first.
//
// Identity decides this instead, on the same basis parcel identity is
// established everywhere else in LandOS (PERMANENT_MEMORY invariants 2-4):
// LandPortal's own canonical property id read off the row's parcel URL, or an
// APN inside a stated jurisdiction. Nothing weaker — an address, a price, a
// coordinate — may collapse two rows into one, because merging two genuinely
// different parcels is worse than keeping a duplicate.

import { apnIdentifiersEquivalent } from './landportal-capability.js';
import { countyNamesAgree, stateNamesAgree } from './landportal-canonical-identity.js';
import { landPortalIdentityFromUrl } from './landportal-operating-rules.js';

/** The identity-bearing fields of a comparable, incoming or already stored. */
export interface CompIdentityInput {
  apn?: string | null;
  county?: string | null;
  state?: string | null;
  sourceUrl?: string | null;
}

const compact = (value: unknown): string => String(value ?? '').replace(/\s+/g, '').toUpperCase();

/**
 * The registry key for a comparable, derived from parcel identity alone.
 *
 * Returns null when identity cannot be established. A caller that gets null
 * must fall back to its previous key rather than invent one: an unidentifiable
 * row stays exactly where it was.
 */
export function compParcelRegistryKey(input: CompIdentityInput): string | null {
  const identity = landPortalIdentityFromUrl(input.sourceUrl ?? null);
  if (identity?.propertyId) return `landportal-parcel|property:${identity.propertyId}`;
  const apn = compact(input.apn);
  if (!apn) return null;
  // An APN is only unique inside its jurisdiction, so an APN with no stated
  // county, state or FIPS is not an identity and cannot key a row.
  const fips = compact(identity?.fips);
  if (fips) return `landportal-parcel|fips:${fips}|apn:${apn}`;
  const jurisdiction = [compact(input.county), compact(input.state)].filter(Boolean).join(',');
  if (!jurisdiction) return null;
  return `landportal-parcel|where:${jurisdiction}|apn:${apn}`;
}

/**
 * Do these two observations describe the same parcel?
 *
 * LandPortal's canonical property id settles it outright when both sides carry
 * one. Otherwise an equivalent APN carries the match unless a stated
 * jurisdiction CONTRADICTS it.
 *
 * That is deliberately weaker than the subject-identity gate in
 * `comp-subject-identity.ts`, and for the opposite reason. There, a false match
 * deletes a real comparable, so an unconfirmable identity must not match. Here
 * a false NON-match is the damage: it forks one parcel into two rows with
 * conflicting figures, which is the defect being repaired. Both sides are also
 * already scoped to a single deal card's comparable set, and an APN is unique
 * inside its county, so an equivalent APN with no contradicting jurisdiction is
 * the same parcel. Two stated jurisdictions that disagree still block the
 * match, and a row with no APN and no property id matches nothing.
 */
export function sameCompParcel(a: CompIdentityInput, b: CompIdentityInput): boolean {
  const aId = landPortalIdentityFromUrl(a.sourceUrl ?? null)?.propertyId ?? null;
  const bId = landPortalIdentityFromUrl(b.sourceUrl ?? null)?.propertyId ?? null;
  if (aId && bId) return aId === bId;
  if (!a.apn || !b.apn || !apnIdentifiersEquivalent(a.apn, b.apn)) return false;
  if (a.county && b.county && !countyNamesAgree(a.county, b.county)) return false;
  if (a.state && b.state && !stateNamesAgree(a.state, b.state)) return false;
  return true;
}
