// LandOS resolver planner — flexible intake -> strongest exact LandPortal v2 path.
//
// No single field is mandatory. From whatever identifiers Tyler supplies, this
// deterministically selects the STRONGEST safe exact-lookup path and builds the
// LpResolveArgs for it. Coordinates are never an input. Pure + deterministic.
//
// Priority (strongest first):
//   1. LandPortal property id + FIPS
//   2. APN + county/state (or city/state)
//   3. full street address + city/state/ZIP
//   4. full street address + county/state
//   5. owner + city/state
//   6. owner + county/state
//   7. owner + street address
//   8. partial street address + city/state
//   9. (none usable)

import type { LpResolveArgs } from './landportal-client.js';

export type ResolverPathId =
  | 'lp_property_id_fips'
  | 'apn_locality'
  | 'address_city_state_zip'
  | 'address_county_state'
  | 'owner_city_state'
  | 'owner_county_state'
  | 'owner_address'
  | 'partial_address_city_state'
  | 'none';

export interface IntakeFields {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
  fips?: string;
  apn?: string;
  owner?: string;
  propertyId?: string;
}

export interface ResolverPlan {
  path: ResolverPathId;
  args: LpResolveArgs;
  reason: string;
  /** True when a street address is available now (comps/market may start immediately). */
  addressAvailableNow: boolean;
  /** True when dependent lanes (comps/market) must wait for the resolver to return
   *  a source address/locality first (non-address identifier inputs). */
  dependentReleaseAfterResolve: boolean;
  /** Echo of the original supplied fields (audit/trace). */
  original: IntakeFields;
}

function has(v?: string): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}
function t(v?: string): string | undefined {
  return has(v) ? v.trim() : undefined;
}
/** A "full" street address carries a leading house number; otherwise it's partial. */
function isFullStreetAddress(addr?: string): boolean {
  return has(addr) && /^\s*\d/.test(addr.trim());
}

/**
 * Select the strongest exact resolver path from the supplied identifiers. Pure.
 * Always records the chosen path + original input. Never uses coordinates.
 */
export function planResolver(fields: IntakeFields): ResolverPlan {
  const f: IntakeFields = {
    address: t(fields.address), city: t(fields.city), state: t(fields.state), zip: t(fields.zip),
    county: t(fields.county), fips: t(fields.fips), apn: t(fields.apn), owner: t(fields.owner),
    propertyId: t(fields.propertyId),
  };
  const localityCS = !!(f.city && f.state);
  const localityCo = !!(f.county && f.state);
  const make = (
    path: ResolverPathId, args: LpResolveArgs, reason: string,
    addressNow: boolean, dependent: boolean,
  ): ResolverPlan => ({ path, args, reason, addressAvailableNow: addressNow, dependentReleaseAfterResolve: dependent, original: fields });

  // 1. property id + FIPS — strongest, unambiguous.
  if (f.propertyId && f.fips) {
    return make('lp_property_id_fips', { propertyid: f.propertyId, fips: f.fips }, 'LandPortal property id + FIPS (direct).', false, true);
  }
  // 2. APN + locality.
  if (f.apn && (localityCo || localityCS || f.fips)) {
    return make('apn_locality', { apn: f.apn, ...(f.county ? { county: f.county } : {}), ...(f.state ? { state: f.state } : {}), ...(f.fips ? { fips: f.fips } : {}) },
      'APN + county/state (or FIPS) exact search.', false, true);
  }
  // 3. full address + city/state/ZIP.
  if (isFullStreetAddress(f.address) && localityCS) {
    return make('address_city_state_zip',
      { address: f.address, city: f.city, state: f.state, ...(f.zip ? { zip: f.zip } : {}), ...(f.fips ? { fips: f.fips } : {}) },
      `Full street address + city/state${f.zip ? '/ZIP' : ''} exact lookup.`, true, false);
  }
  // 4. full address + county/state.
  if (isFullStreetAddress(f.address) && localityCo) {
    return make('address_county_state',
      { address: f.address, ...(f.city ? { city: f.city } : {}), state: f.state, county: f.county, ...(f.fips ? { fips: f.fips } : {}) },
      'Full street address + county/state exact lookup.', true, false);
  }
  // 5. owner + city/state.
  if (f.owner && localityCS) {
    return make('owner_city_state', { owner: f.owner, ...(f.county ? { county: f.county } : {}), state: f.state, ...(f.fips ? { fips: f.fips } : {}) },
      'Owner + city/state exact search.', false, true);
  }
  // 6. owner + county/state.
  if (f.owner && localityCo) {
    return make('owner_county_state', { owner: f.owner, county: f.county, state: f.state, ...(f.fips ? { fips: f.fips } : {}) },
      'Owner + county/state exact search.', false, true);
  }
  // 7. owner + street address.
  if (f.owner && has(f.address)) {
    return make('owner_address', { owner: f.owner, address: f.address, ...(f.city ? { city: f.city } : {}), ...(f.state ? { state: f.state } : {}) },
      'Owner + street address exact search.', true, false);
  }
  // 8. partial address + city/state (no house number).
  if (has(f.address) && localityCS) {
    return make('partial_address_city_state', { address: f.address, city: f.city, state: f.state, ...(f.zip ? { zip: f.zip } : {}) },
      'Partial street address + city/state (no house number) — may need a stronger identifier.', true, false);
  }

  return make('none', {}, 'No usable exact-lookup identifier combination supplied.', false, false);
}

/** The smallest useful extra identifier to request, given what was supplied and
 *  the candidate-ambiguity situation. Prefers the lightest disambiguator. */
export function smallestNextIdentifier(fields: IntakeFields): string {
  if (!has(fields.zip) && (has(fields.address) || has(fields.city))) return 'ZIP code';
  if (!has(fields.owner)) return 'owner name';
  if (!has(fields.apn)) return 'APN (parcel number)';
  if (!has(fields.county) && !has(fields.fips)) return 'county';
  return 'LandPortal property id + FIPS';
}
