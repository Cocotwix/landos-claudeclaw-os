// LandOS comp-search-area — a STRUCTURAL one-way wall for market research.
//
// A CompSearchArea is the ONLY thing the provisional Redfin/market lane may use to
// pick a search area. It is intentionally a DISTINCT, branded type that is NOT a
// parcel identifier: it cannot be passed to the LandPortal resolver (LpResolveArgs)
// and it carries no APN / property id / owner / FIPS / coordinates. This makes it
// structurally impossible for a comp-search area to identify, infer, or verify a
// parcel. It only ever flows INTO market research, never back into verification.
//
// This module deliberately imports NOTHING from the parcel-verification path
// (landportal-client / duke-verification-bridge). A regression test enforces that.

declare const COMP_SEARCH_AREA_BRAND: unique symbol;

export interface CompSearchArea {
  /** Structural brand — prevents this from being used as a parcel identifier. */
  readonly [COMP_SEARCH_AREA_BRAND]: true;
  /** Locality only. NO apn/propertyId/owner/fips/coordinates — by construction. */
  readonly address?: string;
  readonly city?: string;
  readonly state?: string;
  readonly zip?: string;
  /** Where the locality came from (audit only; never an identity signal). */
  readonly origin: 'supplied' | 'verified_source';
}

function clean(v?: string): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Build a CompSearchArea from locality fields. Returns null when there is no
 * usable locality (no ZIP and no city/state). NEVER accepts coordinates, APN,
 * property id, owner, or FIPS — those are identity fields and are excluded by
 * type. Pure.
 */
export function makeCompSearchArea(
  input: { address?: string; city?: string; state?: string; zip?: string },
  origin: 'supplied' | 'verified_source',
): CompSearchArea | null {
  const zip = clean(input.zip)?.match(/\d{5}/)?.[0];
  const city = clean(input.city);
  const state = clean(input.state);
  const address = clean(input.address);
  if (!zip && !(city && state)) return null; // no usable area -> no provisional search
  // The brand is a compile-time-only phantom (declared `unique symbol`); it has no
  // runtime value, so we cast rather than set it. This keeps CompSearchArea a
  // distinct type that cannot be passed where an LpResolveArgs is required.
  return { address, city, state, zip, origin } as unknown as CompSearchArea;
}

/** Project a CompSearchArea to the locality fields the comp provider consumes.
 *  Returns ONLY locality fields — never identity. */
export function compSearchAreaLocality(area: CompSearchArea): { address?: string; city?: string; state?: string; zip?: string } {
  return { address: area.address, city: area.city, state: area.state, zip: area.zip };
}
