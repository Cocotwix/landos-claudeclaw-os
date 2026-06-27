// LandOS — county derivation via the free US Census geocoder.
//
// Realie's address endpoint can only constrain a match by city+county (both
// required together) and ignores ZIP. Fresh leads usually arrive as
// address+city+state+zip with NO county, which forces a statewide street-name
// match. This module derives the county (administrative scope) for an address so
// the official Realie lookup can be locality-constrained. This is a SUPPORTING
// record search to scope an exact lookup — NOT identity-by-coordinate. Subject
// identity still comes from Realie's official record + locality validation.
//
// Free, keyless (US Census Geocoder). Injectable fetch so tests never hit the net.

export type GeoFetch = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface DerivedCounty {
  county: string;
  state: string;
  zip: string | null;
  /** 5-digit state+county FIPS when available. */
  fips: string | null;
}

const CENSUS_ONELINE = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress';

/** Derive the county for a full address via the Census geocoder. Returns null on
 *  no match / error — callers then proceed without county (the locality guard
 *  still prevents a wrong-locality match from being trusted). */
export async function deriveCounty(
  input: { address?: string; city?: string; state?: string; zip?: string },
  deps: { fetchImpl?: GeoFetch } = {},
): Promise<DerivedCounty | null> {
  const oneLine = [input.address, input.city, input.state, input.zip].map((x) => (x ?? '').trim()).filter(Boolean).join(', ');
  if (!oneLine || !input.address) return null;
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as GeoFetch);
  const url = `${CENSUS_ONELINE}?address=${encodeURIComponent(oneLine)}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const body = (await res.json()) as any;
    const match = body?.result?.addressMatches?.[0];
    if (!match) return null;
    const counties = match?.geographies?.['Counties'] ?? match?.geographies?.['County'];
    const c = Array.isArray(counties) ? counties[0] : undefined;
    const ac = match?.addressComponents ?? {};
    const county = (c?.BASENAME ?? c?.NAME ?? '').toString().trim() || null;
    const stateFips = (c?.STATE ?? '').toString().trim();
    const countyFips = (c?.COUNTY ?? '').toString().trim();
    const fips = stateFips && countyFips ? `${stateFips.padStart(2, '0')}${countyFips.padStart(3, '0')}` : null;
    if (!county) return null;
    return {
      county,
      state: (ac.state ?? input.state ?? '').toString().trim(),
      zip: (ac.zip ?? input.zip ?? null) || null,
      fips,
    };
  } catch {
    return null;
  }
}
