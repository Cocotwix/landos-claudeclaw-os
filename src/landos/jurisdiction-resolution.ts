// LandOS — JURISDICTION RESOLUTION from sparse locality evidence.
//
// A lead that says "Fairview, Tennessee" names a real place, and every official
// parcel source LandOS has is selected BY COUNTY. Until the county is
// established, the strongest parcel lane in the system cannot even be chosen —
// `officialParcelSourceCoverage` says so in as many words: "Official parcel
// sources are selected by county, so none can be applied until the county is
// established." That was the first of the two reasons the live Fairview run
// could not resolve.
//
// The county is DERIVED FROM EVIDENCE, never from memory:
//
//   1. U.S. Census Bureau TIGERweb, States layer      → the state's FIPS code
//   2. TIGERweb Incorporated Places / Census Designated Places, by name + state
//                                                      → the place and its
//                                                        official centroid
//   3. TIGERweb Counties layer, point-in-polygon on that centroid
//                                                      → the county and its FIPS
//
// Every step is an official federal geospatial service, keyless, free, and
// reachable over ordinary HTTPS. No browser, no CDP, no paid API, and no
// county name is ever inferred from a model's recollection.
//
// Deliberate refusals:
//   • Two places of the same name in one state is an AMBIGUOUS locality. The
//     county is not established and the ambiguity is named. Picking the larger
//     one would be exactly the "nearest plausible" behaviour LandOS forbids.
//   • A county the operator already supplied is never overwritten. A
//     disagreement is a recorded conflict.
//   • A place centroid is used ONLY to select the containing county. It never
//     verifies a parcel: coordinates are not parcel identity (invariant 3).
//
// The next sprint (zoning / subdivision) needs the same answer plus the FIPS
// codes and the source trail, so this returns them rather than a bare string.

import { bareCountyName, countyNamesAgree, stateNamesAgree, uspsFromStateName } from './landportal-canonical-identity.js';

const TIGERWEB = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb';
/** States (0) and Counties (1) in the current vintage. */
const STATE_COUNTY_LAYER = `${TIGERWEB}/State_County/MapServer`;
/** Incorporated Places (4) and Census Designated Places (5). */
const PLACES_LAYER = `${TIGERWEB}/Places_CouSub_ConCity_SubMCD/MapServer`;

export const JURISDICTION_SOURCE_LABEL = 'U.S. Census Bureau TIGERweb geographic services';

export interface JurisdictionSourceRef {
  label: string;
  url: string;
  /** What this particular request established. */
  established: string;
}

export interface JurisdictionResolution {
  /** The operator's own words, never rewritten. */
  rawLocalityInput: string | null;
  locality: string | null;
  /** The official place type, e.g. "Incorporated Place". */
  localityKind: string | null;
  county: string | null;
  /** 5-digit county FIPS. The key every official parcel source is chosen by. */
  countyFips: string | null;
  state: string | null;
  stateFips: string | null;
  zip: string | null;
  sources: JurisdictionSourceRef[];
  confidence: 'high' | 'medium' | 'low' | 'none';
  conflicts: string[];
  /** True when a county AND a state exist, so a parcel source can be selected. */
  sufficientForParcelSource: boolean;
  /** Why this resolution ended where it did. Operator-readable. */
  basis: string;
}

export interface JurisdictionResolutionInput {
  /** City / town / municipality as supplied. */
  locality?: string | null;
  /** A county the operator already supplied. Never overwritten, only checked. */
  county?: string | null;
  state?: string | null;
  zip?: string | null;
}

export type JurisdictionFetchJson = (url: string, timeoutMs: number) => Promise<unknown>;

export interface JurisdictionResolutionOptions {
  fetchJson?: JurisdictionFetchJson;
  timeoutMs?: number;
}

interface ArcFeature { attributes?: Record<string, unknown> }
interface ArcResponse { features?: ArcFeature[] }

const text = (value: unknown): string | null => {
  const result = String(value ?? '').trim();
  return result && result.toLowerCase() !== 'null' ? result : null;
};

/** ArcGIS string literal. Single quotes are the only escape that matters. */
const sql = (value: string): string => value.replace(/'/g, "''");

export const defaultJurisdictionFetchJson: JurisdictionFetchJson = async (url, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'LandOS/1.0 (jurisdiction resolution; public census services)' },
    });
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

function attributesOf(payload: unknown): Array<Record<string, unknown>> {
  const features = (payload as ArcResponse | null)?.features;
  return Array.isArray(features)
    ? features.map((feature) => feature?.attributes ?? {}).filter((row) => Object.keys(row).length > 0)
    : [];
}

function query(layer: string, where: string, outFields: string): string {
  return `${layer}/query?where=${encodeURIComponent(where)}&outFields=${encodeURIComponent(outFields)}&returnGeometry=false&f=json`;
}

function pointQuery(layer: string, lat: number, lon: number, outFields: string): string {
  const geometry = encodeURIComponent(JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }));
  return `${layer}/query?geometry=${geometry}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects`
    + `&outFields=${encodeURIComponent(outFields)}&returnGeometry=false&f=json`;
}

function empty(input: JurisdictionResolutionInput, basis: string): JurisdictionResolution {
  return {
    rawLocalityInput: text(input.locality),
    locality: text(input.locality),
    localityKind: null,
    county: bareCountyName(input.county),
    countyFips: null,
    state: text(input.state),
    stateFips: null,
    zip: text(input.zip),
    sources: [],
    confidence: 'none',
    conflicts: [],
    sufficientForParcelSource: !!bareCountyName(input.county) && !!text(input.state),
    basis,
  };
}

/**
 * Establish the jurisdiction a locality sits in, from official federal geography.
 *
 * Never throws: an unreachable service is an unestablished jurisdiction with a
 * stated reason, which is a usable answer. A resolver lane that cannot answer
 * must not be able to fail the mission.
 */
export async function resolveJurisdiction(
  input: JurisdictionResolutionInput,
  options: JurisdictionResolutionOptions = {},
): Promise<JurisdictionResolution> {
  const fetchJson = options.fetchJson ?? defaultJurisdictionFetchJson;
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 15_000);
  const locality = text(input.locality);
  const suppliedState = text(input.state);
  const suppliedCounty = bareCountyName(input.county);

  if (!locality || !suppliedState) {
    return empty(input, !suppliedState
      ? 'No state is known for this lead, so no place can be looked up in the federal geography.'
      : 'No city, town, or municipality is known for this lead, so its county cannot be established from geography.');
  }

  const sources: JurisdictionSourceRef[] = [];
  const conflicts: string[] = [];

  // ── 1. The state, by its own USPS code, from the official States layer ────
  const usps = uspsFromStateName(suppliedState) ?? suppliedState.toUpperCase();
  let stateRow: Record<string, unknown> | null = null;
  try {
    const url = query(`${STATE_COUNTY_LAYER}/0`, `STUSAB='${sql(usps)}'`, 'STATE,NAME,STUSAB');
    stateRow = attributesOf(await fetchJson(url, timeoutMs))[0] ?? null;
    if (stateRow) sources.push({ label: `${JURISDICTION_SOURCE_LABEL} — States`, url, established: `State ${text(stateRow.STUSAB)} (FIPS ${text(stateRow.STATE)})` });
  } catch {
    return empty(input, 'The federal geography service could not be reached to identify the state.');
  }
  if (!stateRow) return empty(input, `No state matched the USPS code "${usps}" in the federal geography.`);
  const stateFips = text(stateRow.STATE);
  const stateUsps = text(stateRow.STUSAB) ?? usps;

  // ── 2. The place, by name within that state ──────────────────────────────
  // Incorporated places first; a Census Designated Place is a real, official
  // locality too, and a lead may well name one.
  const bareLocality = locality.replace(/\s+(city|town|village|borough|township)$/i, '').trim();
  let places: Array<Record<string, unknown>> = [];
  let localityKind: string | null = null;
  let placeUrl = '';
  for (const [layer, kind] of [['4', 'Incorporated Place'], ['5', 'Census Designated Place']] as const) {
    const url = query(
      `${PLACES_LAYER}/${layer}`,
      `UPPER(BASENAME)='${sql(bareLocality.toUpperCase())}' AND STATE='${sql(stateFips ?? '')}'`,
      'GEOID,NAME,BASENAME,STATE,CENTLAT,CENTLON',
    );
    try {
      const rows = attributesOf(await fetchJson(url, timeoutMs));
      if (rows.length) { places = rows; localityKind = kind; placeUrl = url; break; }
    } catch {
      return {
        ...empty(input, 'The federal geography service could not be reached to identify the locality.'),
        sources,
        state: stateUsps,
        stateFips,
      };
    }
  }

  if (!places.length) {
    return {
      ...empty(input, `No incorporated place or census designated place named "${bareLocality}" exists in ${stateUsps} in the federal geography, so its county cannot be established.`),
      sources,
      state: stateUsps,
      stateFips,
    };
  }
  if (places.length > 1) {
    // Two same-named places in one state is a real ambiguity. Choosing one
    // would be a guess about WHICH property this lead is about.
    conflicts.push(
      `Ambiguous locality: ${places.length} places named "${bareLocality}" exist in ${stateUsps} (${places.map((row) => text(row.GEOID)).filter(Boolean).join(', ')}). The county is not established until the lead names which one.`,
    );
    return {
      rawLocalityInput: locality,
      locality: bareLocality,
      localityKind,
      county: suppliedCounty,
      countyFips: null,
      state: stateUsps,
      stateFips,
      zip: text(input.zip),
      sources: [...sources, { label: `${JURISDICTION_SOURCE_LABEL} — ${localityKind}s`, url: placeUrl, established: `${places.length} same-named places` }],
      confidence: 'low',
      conflicts,
      sufficientForParcelSource: !!suppliedCounty,
      basis: conflicts[0],
    };
  }

  const place = places[0];
  sources.push({ label: `${JURISDICTION_SOURCE_LABEL} — ${localityKind}s`, url: placeUrl, established: `${text(place.NAME)} (GEOID ${text(place.GEOID)})` });

  // ── 3. The county containing that place's official centroid ──────────────
  const lat = Number(text(place.CENTLAT));
  const lon = Number(text(place.CENTLON));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return {
      ...empty(input, 'The federal geography returned no centroid for this place, so its county could not be selected.'),
      locality: text(place.BASENAME) ?? bareLocality,
      localityKind,
      sources,
      state: stateUsps,
      stateFips,
    };
  }
  let countyRow: Record<string, unknown> | null = null;
  const countyUrl = pointQuery(`${STATE_COUNTY_LAYER}/1`, lat, lon, 'GEOID,BASENAME,NAME,STATE');
  try {
    countyRow = attributesOf(await fetchJson(countyUrl, timeoutMs))[0] ?? null;
  } catch {
    return {
      ...empty(input, 'The federal geography service could not be reached to identify the county.'),
      locality: text(place.BASENAME) ?? bareLocality,
      localityKind,
      sources,
      state: stateUsps,
      stateFips,
    };
  }
  if (!countyRow) {
    return {
      ...empty(input, `The federal geography located ${text(place.NAME)} but returned no containing county.`),
      locality: text(place.BASENAME) ?? bareLocality,
      localityKind,
      sources,
      state: stateUsps,
      stateFips,
    };
  }
  const county = bareCountyName(countyRow.BASENAME ?? countyRow.NAME);
  const countyFips = text(countyRow.GEOID);
  sources.push({ label: `${JURISDICTION_SOURCE_LABEL} — Counties`, url: countyUrl, established: `${county} County (FIPS ${countyFips})` });

  // A county the operator already accepted is never replaced by geography.
  if (suppliedCounty && county && !countyNamesAgree(suppliedCounty, county)) {
    conflicts.push(
      `County conflict: this lead carries ${suppliedCounty} County while the federal geography places ${text(place.NAME)} in ${county} County, ${stateUsps}. The retained value was not changed.`,
    );
  }
  if (suppliedState && !stateNamesAgree(suppliedState, stateUsps)) {
    conflicts.push(`State conflict: the lead says ${suppliedState} and the federal geography resolved ${stateUsps}.`);
  }

  const resolvedCounty = conflicts.length ? suppliedCounty : county;
  return {
    rawLocalityInput: locality,
    locality: text(place.BASENAME) ?? bareLocality,
    localityKind,
    county: resolvedCounty,
    countyFips: conflicts.length ? null : countyFips,
    state: stateUsps,
    stateFips,
    zip: text(input.zip),
    sources,
    confidence: conflicts.length ? 'low' : 'high',
    conflicts,
    sufficientForParcelSource: !!resolvedCounty && !!stateUsps,
    basis: conflicts.length
      ? conflicts[0]
      : `${text(place.NAME)} lies in ${county} County, ${stateUsps} (county FIPS ${countyFips}), established by point-in-polygon against the U.S. Census Bureau's own place and county geography. This selects the parcel source; it is not parcel evidence.`,
  };
}
