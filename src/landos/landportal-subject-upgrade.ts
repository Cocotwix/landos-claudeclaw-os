// LandOS — ONE bounded LandPortal subject upgrade.
//
// LandPortal starts optimistically from whatever the lead supplied, which for a
// sparse lead is a bare parcel notation and a town. Universal Property
// Resolution then frequently establishes a far stronger subject while that
// browser workflow is still searching — measured on Fairview: LandPortal was
// still pending at release, holding "Map 042 Parcel 123", while the resolver
// had already established Williamson County, parcel 042 123.00, Landsouth LLC
// and 75.86 acres.
//
// This module builds the better lookup package. It does NOT decide when to run
// it and it never drives a browser: the layer that owns the capture decides
// that, because that layer is the only one that knows whether an agent is
// already in flight. Two concurrent LandPortal agents for one subject is the
// failure this separation exists to prevent.
//
// Ordering is a PREFERENCE, not a promise: the adapter attempts what LandPortal
// actually supports, in the order strength dictates, and a failed parcel lookup
// legitimately falls through to owner + jurisdiction.

export const LANDPORTAL_LOOKUP_STRATEGIES = [
  /** LandPortal's own canonical record. Nothing is stronger. */
  'retained_parcel_url',
  'property_id_and_fips',
  'apn_and_jurisdiction',
  'owner_and_jurisdiction',
  'exact_address',
  'coordinates',
] as const;
export type LandPortalLookupStrategy = (typeof LANDPORTAL_LOOKUP_STRATEGIES)[number];

export interface LandPortalLookupAttempt {
  order: number;
  strategy: LandPortalLookupStrategy;
  /** Exactly the keys this attempt would search on. */
  keys: Record<string, string | number>;
  rationale: string;
}

export interface LandPortalSearchPackage {
  landPortalParcelUrl: string | null;
  landPortalPropertyId: string | null;
  fips: string | null;
  state: string | null;
  county: string | null;
  city: string | null;
  apn: string | null;
  owner: string | null;
  address: string | null;
  zip: string | null;
  acres: number | null;
  lat: number | null;
  lng: number | null;
  /** Attempts in preference order. The adapter decides what it supports. */
  attempts: LandPortalLookupAttempt[];
  /** What this package has that the keys LandPortal started with did not. */
  gainedOverIntake: string[];
  /** True only when something materially stronger is now available. */
  strongerThanIntake: boolean;
  reason: string;
}

export interface LandPortalSubjectSnapshot {
  landPortalParcelUrl?: string | null;
  landPortalPropertyId?: string | null;
  fips?: string | null;
  state?: string | null;
  county?: string | null;
  city?: string | null;
  apn?: string | null;
  owner?: string | null;
  address?: string | null;
  zip?: string | null;
  acres?: number | null;
  lat?: number | null;
  lng?: number | null;
}

const text = (value: unknown): string | null => {
  const result = String(value ?? '').trim();
  return result && result.toLowerCase() !== 'null' ? result : null;
};
const positive = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Build the strongest lookup package currently available, and say plainly
 * whether it is actually better than what LandPortal already had.
 *
 * A package that gains nothing returns `strongerThanIntake: false`, and the
 * caller must not spend a second capture on it.
 */
export function buildLandPortalSearchPackage(
  resolved: LandPortalSubjectSnapshot,
  intake: LandPortalSubjectSnapshot,
): LandPortalSearchPackage {
  const parcelUrl = text(resolved.landPortalParcelUrl);
  const propertyId = text(resolved.landPortalPropertyId);
  const fips = text(resolved.fips);
  const state = text(resolved.state);
  const county = text(resolved.county);
  const city = text(resolved.city);
  const apn = text(resolved.apn);
  const owner = text(resolved.owner);
  const address = text(resolved.address);
  const zip = text(resolved.zip);
  const acres = positive(resolved.acres);
  // 0/0 is the null island, not a location. A card that simply has no
  // coordinates stores zeros, and offering them as a lookup key would send
  // LandPortal to the Gulf of Guinea.
  const coordinate = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
  };
  const lat = coordinate(resolved.lat);
  const lng = coordinate(resolved.lng);

  const attempts: LandPortalLookupAttempt[] = [];
  const push = (strategy: LandPortalLookupStrategy, keys: Record<string, string | number>, rationale: string): void => {
    attempts.push({ order: attempts.length + 1, strategy, keys, rationale });
  };

  if (parcelUrl) push('retained_parcel_url', { landPortalParcelUrl: parcelUrl }, 'A verified canonical LandPortal parcel record already exists; open it directly rather than searching.');
  if (propertyId && fips) push('property_id_and_fips', { landPortalPropertyId: propertyId, fips }, 'LandPortal\'s own primary key plus the county FIPS addresses the parcel page exactly.');
  if (apn && (county || state || fips)) {
    push('apn_and_jurisdiction', {
      apn, ...(county ? { county } : {}), ...(state ? { state } : {}), ...(fips ? { fips } : {}),
    }, 'A confirmed parcel identifier inside an established jurisdiction is the strongest search LandPortal supports without its own key.');
  }
  if (owner && (county || state)) {
    push('owner_and_jurisdiction', {
      owner, ...(county ? { county } : {}), ...(state ? { state } : {}),
    }, 'An owner of record inside an established jurisdiction is an independent parcel-lookup key. It is a lookup key only and never a seller-authority claim.');
  }
  // A STREET address, which starts with a house number. "Map 042 Parcel 123" is
  // a parcel notation the operator typed, not something to search an address by.
  if (address && /^\s*\d+[A-Za-z]?\s+\S/.test(address)) {
    push('exact_address', { address, ...(city ? { city } : {}), ...(state ? { state } : {}), ...(zip ? { zip } : {}) }, 'An exact street address, when the lead actually has one.');
  }
  if (lat != null && lng != null) {
    push('coordinates', { lat, lng }, 'A locator of last resort. Coordinates never verify a parcel; any candidate they surface must still be corroborated.');
  }

  // What is genuinely new relative to the keys LandPortal started with?
  const gained: string[] = [];
  const isNew = (value: string | null, before: unknown): boolean => !!value && !text(before);
  if (isNew(parcelUrl, intake.landPortalParcelUrl)) gained.push('a canonical LandPortal parcel URL');
  if (isNew(propertyId, intake.landPortalPropertyId)) gained.push('the LandPortal property id');
  if (isNew(fips, intake.fips)) gained.push('the county FIPS');
  if (isNew(county, intake.county)) gained.push(`the county (${county})`);
  if (isNew(apn, intake.apn)) gained.push(`a parcel identifier (${apn})`);
  if (isNew(owner, intake.owner)) gained.push(`the owner of record (${owner})`);
  if (isNew(state, intake.state)) gained.push(`the state (${state})`);

  const strongerThanIntake = gained.length > 0 && attempts.length > 0;
  return {
    landPortalParcelUrl: parcelUrl,
    landPortalPropertyId: propertyId,
    fips, state, county, city, apn, owner, address, zip, acres, lat, lng,
    attempts,
    gainedOverIntake: gained,
    strongerThanIntake,
    reason: strongerThanIntake
      ? `Universal Property Resolution established ${gained.join(', ')} after the LandPortal workflow had already started from the raw lead.`
      : attempts.length === 0
        ? 'No LandPortal lookup key is available for this subject.'
        : 'The resolved subject carries nothing the LandPortal workflow did not already have.',
  };
}
