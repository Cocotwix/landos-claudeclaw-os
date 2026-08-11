// LandOS — NATIONWIDE authority stack resolution.
//
// Who actually controls land use for THIS parcel. The operator must not have to
// know the answer before LandOS researches it, and the engine must not assume
// the answer from county containment — the assumption that "the county zones
// unincorporated land" is right in much of the country and wrong in the rest.
//
// The backbone is the Census Bureau's geography service, which is a federal
// official source that answers the same question the same way in every state:
// which county, which county subdivision, and whether the point falls inside an
// incorporated place. One distinction it draws is doing most of the work here:
//
//   "Whitewater township", "Sterling town"  → a minor civil division that is a
//                                             functioning GOVERNMENT
//   "Warthen CCD", "Sandersville CCD"       → a census county division, which
//                                             is a STATISTICAL area and governs
//                                             nothing at all
//
// Treating a CCD as a local government would send the engine looking for a
// township zoning ordinance that cannot exist, and then reporting the absence
// as an unresolved authority instead of the correct answer, which is that the
// county is the local authority.

import { defaultGovFetchText, readJsonBody, type GovFetchText } from './gis-transport.js';
import { buildCitation } from './land-use-evidence.js';
import { stateName } from './state-legal-sources.js';
import {
  evidencedValue,
  provisionalValue,
  unresolvedAuthority,
  unresolvedValue,
  type AuthorityPattern,
  type AuthorityStack,
  type GovernmentUnitType,
  type IncorporationStatus,
  type LegalSourceCitation,
  type ResolvedAuthority,
} from './land-use-types.js';
import type { JurisdictionClue } from './gis-platform-types.js';

/* ───────────────────────── census geography lane ─────────────────────── */

const CENSUS_GEOCODER = 'https://geocoding.geo.census.gov/geocoder/geographies';

export interface CensusGeography {
  matchedAddress: string | null;
  state: string | null;
  county: string | null;
  /** The county-subdivision NAME exactly as the Census publishes it. */
  countySubdivision: string | null;
  /** The incorporated place, when the point falls inside one. */
  incorporatedPlace: string | null;
  latitude: number | null;
  longitude: number | null;
  /** The query URL, so the conclusion is reproducible. */
  sourceUrl: string;
}

/**
 * Whether a Census county-subdivision name denotes a GOVERNMENT or a
 * statistical area.
 *
 * The Census appends the unit type to the name, and that suffix is the signal.
 * A "CCD" (census county division) and a "county subdivision not defined" entry
 * are statistical constructs with no governing body; everything else names a
 * real minor civil division.
 */
export function classifyCountySubdivision(name: string | null): { isGovernment: boolean; unitType: GovernmentUnitType; cleanName: string | null } {
  if (!name) return { isGovernment: false, unitType: 'unknown', cleanName: null };
  const value = name.trim();
  if (/\bCCD\b/i.test(value) || /not\s+defined/i.test(value) || /\bunorganized\b/i.test(value)) {
    return { isGovernment: false, unitType: 'unknown', cleanName: value };
  }
  const lower = value.toLowerCase();
  const unitType: GovernmentUnitType =
    /\btownship\b/.test(lower) ? 'township'
      : /\btown\b/.test(lower) ? 'town'
        : /\bcity\b/.test(lower) ? 'city'
          : /\bvillage\b/.test(lower) ? 'village'
            : /\bborough\b/.test(lower) ? 'borough'
              : /\bplantation\b|\bgore\b|\bgrant\b/.test(lower) ? 'special_district'
                : 'municipality';
  return { isGovernment: true, unitType, cleanName: value };
}

export function classifyIncorporatedPlace(name: string | null): { unitType: GovernmentUnitType; cleanName: string | null } {
  if (!name) return { unitType: 'unknown', cleanName: null };
  const lower = name.toLowerCase();
  const unitType: GovernmentUnitType =
    /\bcity\b/.test(lower) ? 'city'
      : /\btown\b/.test(lower) ? 'town'
        : /\bvillage\b/.test(lower) ? 'village'
          : /\bborough\b/.test(lower) ? 'borough'
            : /\btownship\b/.test(lower) ? 'township'
              : 'municipality';
  return { unitType, cleanName: name.trim() };
}

function firstName(features: unknown): string | null {
  if (!Array.isArray(features) || !features.length) return null;
  const value = (features[0] as Record<string, unknown>)?.NAME ?? (features[0] as Record<string, unknown>)?.BASENAME;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Resolve the federal geography for one address.
 *
 * Address first, coordinates as the fallback. Both are supported because a
 * rural address the geocoder cannot match is common, and a parcel centroid
 * from the GIS lane answers the same question just as authoritatively.
 */
export async function resolveCensusGeography(
  input: {
    address?: string | null; city?: string | null; state?: string | null;
    latitude?: number | null; longitude?: number | null;
    /**
     * Free-text identity as the operator recorded it, used when the property
     * record carries no structured city or state. This is what lets the engine
     * start from property identity ALONE and still resolve the authority
     * stack — the nationwide-adaptability case, not a convenience.
     */
    oneLine?: string | null;
  },
  deps: { fetchText?: GovFetchText } = {},
): Promise<CensusGeography | null> {
  const fetchText = deps.fetchText ?? defaultGovFetchText;
  const common = 'benchmark=Public_AR_Current&vintage=Current_Current&format=json&layers=all';

  const urls: string[] = [];
  if (input.address?.trim() && input.state?.trim()) {
    const params = new URLSearchParams({
      street: input.address.trim(),
      city: (input.city ?? '').trim(),
      state: input.state.trim(),
    });
    urls.push(`${CENSUS_GEOCODER}/address?${params.toString()}&${common}`);
  }
  if (typeof input.latitude === 'number' && typeof input.longitude === 'number') {
    urls.push(`${CENSUS_GEOCODER}/coordinates?x=${input.longitude}&y=${input.latitude}&${common}`);
  }
  // The one-line route last, and only when it carries more than the street.
  // It resolves messy operator text and reconciles it against the federal
  // address file — a live run corrected a transposed ZIP and still returned
  // the right county and township.
  const oneLine = (input.oneLine ?? '').trim();
  if (oneLine && /[a-z]{2,}/i.test(oneLine.replace(/^\s*\d+\s*/, '')) && oneLine.includes(',')) {
    urls.push(`${CENSUS_GEOCODER}/onelineaddress?address=${encodeURIComponent(oneLine)}&${common}`);
  }

  for (const url of urls) {
    try {
      const response = await fetchText(url, { timeoutMs: 30_000, headers: { accept: 'application/json' } });
      if (response.blocked || response.status >= 400) continue;
      const payload = readJsonBody(response.body) as
        { result?: { addressMatches?: Array<Record<string, unknown>>; geographies?: Record<string, unknown> } } | null;

      // The address route nests geographies under a match; the coordinate route
      // returns them at the top level. Both shapes are handled rather than
      // assuming the address route always succeeds.
      const match = payload?.result?.addressMatches?.[0];
      const geographies = (match?.geographies ?? payload?.result?.geographies) as Record<string, unknown> | undefined;
      if (!geographies) continue;

      const coordinates = match?.coordinates as { x?: number; y?: number } | undefined;
      return {
        matchedAddress: typeof match?.matchedAddress === 'string' ? match.matchedAddress : null,
        state: firstName(geographies['States']),
        county: firstName(geographies['Counties']),
        countySubdivision: firstName(geographies['County Subdivisions']),
        incorporatedPlace: firstName(geographies['Incorporated Places']),
        latitude: typeof coordinates?.y === 'number' ? coordinates.y : input.latitude ?? null,
        longitude: typeof coordinates?.x === 'number' ? coordinates.x : input.longitude ?? null,
        sourceUrl: url,
      };
    } catch {
      // A geocoder outage is not a reason to abandon the run; the GIS clues
      // still carry jurisdiction evidence.
    }
  }
  return null;
}

/* ────────────────────────── authority assembly ───────────────────────── */

export interface AuthorityResolutionInput {
  county: string | null;
  state: string | null;
  city: string | null;
  /** Jurisdiction attributes the official parcel source published. */
  jurisdictionClues: readonly JurisdictionClue[];
  /** Incorporated status the official parcel source stated, when it did. */
  gisIncorporatedStatus: 'incorporated' | 'unincorporated' | null;
  gisLocalGovernment: string | null;
  gisSourceUrl: string | null;
  geography: CensusGeography | null;
  /**
   * What the ZONING lane established about who actually zones. Supplied after
   * the ordinance search, because the only reliable way to learn that a county
   * does not zone is to read the county saying so.
   */
  zoningAuthorityFinding?: {
    body: string;
    unitType: GovernmentUnitType;
    citations: LegalSourceCitation[];
    /** True when the finding is that NOBODY conventionally zones here. */
    noConventionalZoning: boolean;
  } | null;
  subdivisionAuthorityFinding?: {
    body: string;
    unitType: GovernmentUnitType;
    citations: LegalSourceCitation[];
  } | null;
  septicAuthorityFinding?: { body: string; citations: LegalSourceCitation[]; url: string | null } | null;
  roadAuthorityFinding?: { body: string; citations: LegalSourceCitation[]; url: string | null } | null;
  /** True when the state lane found a statewide land-division framework. */
  stateFrameworkPresent: boolean;
  statePreemptionPresent: boolean;
  now: string;
}

function censusCitation(geography: CensusGeography, now: string, statement: string): LegalSourceCitation {
  return buildCitation({
    url: geography.sourceUrl,
    label: 'U.S. Census Bureau geography service',
    citation: null,
    excerpt: statement,
    format: 'json_api',
    publisher: 'U.S. Census Bureau',
    tierHint: 'state_agency',
    retrievedAt: now,
  });
}

/**
 * Build the authority stack.
 *
 * Every role is resolved from evidence or left explicitly unresolved. There is
 * no branch here that fills a role because the other roles are filled.
 */
export function resolveAuthorityStack(input: AuthorityResolutionInput): AuthorityStack {
  const { geography, now } = input;
  const stateLabel = stateName(input.state) ?? geography?.state ?? input.state ?? null;

  /* State. */
  const state: ResolvedAuthority = stateLabel
    ? {
        role: 'state',
        name: geography?.state
          ? evidencedValue(geography.state, [censusCitation(geography, now, `The Census geography service places this address in ${geography.state}.`)])
          : provisionalValue(stateLabel, [], 'State taken from the property record rather than an official geography lookup.'),
        unitType: 'state',
        relationship: input.stateFrameworkPresent
          ? 'Sets the statewide framework the local unit administers or supplements.'
          : 'No statewide land-division framework was established for this subject.',
        officialUrl: null,
      }
    : unresolvedAuthority('state', 'No state was established for this subject.');

  /* County. */
  const countyLabel = geography?.county ?? input.county ?? null;
  const county: ResolvedAuthority = countyLabel
    ? {
        role: 'county',
        name: geography?.county
          ? evidencedValue(geography.county, [censusCitation(geography, now, `The Census geography service places this address in ${geography.county}.`)])
          : provisionalValue(countyLabel, [], 'County taken from the property record rather than an official geography lookup.'),
        unitType: /\bparish\b/i.test(countyLabel) ? 'parish' : 'county',
        relationship: null,
        officialUrl: null,
      }
    : unresolvedAuthority('county', 'No county was established for this subject.');

  /* Incorporation and the local unit. */
  const place = classifyIncorporatedPlace(geography?.incorporatedPlace ?? null);
  const subdivision = classifyCountySubdivision(geography?.countySubdivision ?? null);

  let incorporation: AuthorityStack['incorporation'];
  if (geography) {
    const status: IncorporationStatus = geography.incorporatedPlace ? 'incorporated' : 'unincorporated';
    incorporation = evidencedValue(status, [censusCitation(
      geography, now,
      geography.incorporatedPlace
        ? `The address falls inside the incorporated place ${geography.incorporatedPlace}.`
        : 'The address falls inside no incorporated place, so it is unincorporated territory.',
    )]);
  } else if (input.gisIncorporatedStatus) {
    incorporation = provisionalValue(
      input.gisIncorporatedStatus,
      input.gisSourceUrl
        ? [buildCitation({ url: input.gisSourceUrl, label: 'Official parcel source', excerpt: `The official parcel source states this parcel is ${input.gisIncorporatedStatus}.`, format: 'json_api', tierHint: 'official_gis', retrievedAt: now })]
        : [],
      'Incorporation taken from the parcel source; no federal geography lookup succeeded.',
    );
  } else {
    incorporation = unresolvedValue<IncorporationStatus>('Neither a federal geography lookup nor the parcel source established whether this parcel is incorporated.');
  }

  /**
   * The local unit. An incorporated place is the local unit. Otherwise a
   * county subdivision is the local unit ONLY when it is a real minor civil
   * division; a CCD is a statistical area and the county is the local unit.
   */
  let localUnit: ResolvedAuthority;
  if (place.cleanName && geography) {
    localUnit = {
      role: 'local_unit',
      name: evidencedValue(place.cleanName, [censusCitation(geography, now, `The address falls inside ${place.cleanName}.`)]),
      unitType: place.unitType,
      relationship: 'Incorporated municipality containing the parcel.',
      officialUrl: null,
    };
  } else if (subdivision.isGovernment && subdivision.cleanName && geography) {
    localUnit = {
      role: 'local_unit',
      name: evidencedValue(subdivision.cleanName, [censusCitation(geography, now, `The address falls inside the minor civil division ${subdivision.cleanName}.`)]),
      unitType: subdivision.unitType,
      relationship: 'Minor civil division with its own governing body.',
      officialUrl: null,
    };
  } else if (geography && countyLabel) {
    localUnit = {
      role: 'local_unit',
      name: evidencedValue(countyLabel, [censusCitation(
        geography, now,
        subdivision.cleanName
          ? `The county subdivision containing this address is ${subdivision.cleanName}, a census statistical division rather than a unit of government, so the county is the local unit.`
          : 'No minor civil division government contains this address, so the county is the local unit.',
      )]),
      unitType: 'unincorporated_county',
      relationship: 'No sub-county government contains the parcel; the county is the local unit of government.',
      officialUrl: null,
    };
  } else if (input.gisLocalGovernment) {
    localUnit = {
      role: 'local_unit',
      name: provisionalValue(input.gisLocalGovernment, [], 'Local government taken from the parcel source; no federal geography lookup succeeded.'),
      unitType: 'unknown',
      relationship: null,
      officialUrl: null,
    };
  } else {
    localUnit = unresolvedAuthority('local_unit', 'No local unit of government was established for this parcel.');
  }

  /* Zoning authority — only ever from a finding, never inferred. */
  const zoningAuthority: ResolvedAuthority = input.zoningAuthorityFinding
    ? {
        role: 'zoning',
        name: input.zoningAuthorityFinding.noConventionalZoning
          ? evidencedValue(
              `${input.zoningAuthorityFinding.body} — no conventional zoning`,
              input.zoningAuthorityFinding.citations,
            )
          : evidencedValue(input.zoningAuthorityFinding.body, input.zoningAuthorityFinding.citations),
        unitType: input.zoningAuthorityFinding.unitType,
        relationship: input.zoningAuthorityFinding.noConventionalZoning
          ? 'This body would hold zoning authority, and it states that it does not exercise conventional zoning here.'
          : 'Holds zoning authority for this parcel.',
        officialUrl: input.zoningAuthorityFinding.citations[0]?.url ?? null,
      }
    : unresolvedAuthority('zoning', 'LandOS did not establish which body zones this parcel. It is not inferred from county containment.');

  const subdivisionAuthority: ResolvedAuthority = input.subdivisionAuthorityFinding
    ? {
        role: 'subdivision',
        name: evidencedValue(input.subdivisionAuthorityFinding.body, input.subdivisionAuthorityFinding.citations),
        unitType: input.subdivisionAuthorityFinding.unitType,
        relationship: 'Administers land division and subdivision approval for this parcel.',
        officialUrl: input.subdivisionAuthorityFinding.citations[0]?.url ?? null,
      }
    : unresolvedAuthority('subdivision', 'LandOS did not establish which body approves land division for this parcel.');

  const septicHealthAuthority: ResolvedAuthority = input.septicAuthorityFinding
    ? {
        role: 'septic_health',
        name: evidencedValue(input.septicAuthorityFinding.body, input.septicAuthorityFinding.citations),
        unitType: 'special_district',
        relationship: 'Approves onsite sewage management for this parcel.',
        officialUrl: input.septicAuthorityFinding.url,
      }
    : unresolvedAuthority('septic_health', 'LandOS did not establish the onsite wastewater authority for this parcel.');

  const roadAccessAuthority: ResolvedAuthority = input.roadAuthorityFinding
    ? {
        role: 'road_access',
        name: evidencedValue(input.roadAuthorityFinding.body, input.roadAuthorityFinding.citations),
        unitType: 'state',
        relationship: 'Controls access permits on the road serving this parcel.',
        officialUrl: input.roadAuthorityFinding.url,
      }
    : unresolvedAuthority('road_access', 'LandOS did not establish which authority controls access on the road serving this parcel.');

  const pattern = classifyAuthorityPattern({
    incorporated: incorporation.value,
    localUnitIsGovernmentBelowCounty: localUnit.unitType !== 'unincorporated_county' && localUnit.unitType !== 'county' && localUnit.unitType !== 'unknown',
    stateFrameworkPresent: input.stateFrameworkPresent,
    statePreemptionPresent: input.statePreemptionPresent,
    noConventionalZoning: input.zoningAuthorityFinding?.noConventionalZoning ?? false,
    zoningResolved: !!input.zoningAuthorityFinding,
    zoningBodyDiffersFromSubdivisionBody:
      !!input.zoningAuthorityFinding && !!input.subdivisionAuthorityFinding
      && input.zoningAuthorityFinding.body !== input.subdivisionAuthorityFinding.body,
  });

  /* Other authorities: jurisdiction clues the parcel source published that
     are not already represented above. Evidence, never a determination. */
  const covered = new Set([
    state.name.value, county.name.value, localUnit.name.value,
  ].filter(Boolean).map((value) => String(value).toLowerCase()));
  const otherAuthorities: ResolvedAuthority[] = input.jurisdictionClues
    .filter((clue) => clue.name && !covered.has(clue.name.toLowerCase()))
    .slice(0, 4)
    .map((clue) => ({
      role: 'other' as const,
      name: provisionalValue(clue.name, [buildCitation({
        url: clue.sourceUrl, label: `Official parcel source (${clue.sourceField})`,
        excerpt: clue.statement, format: 'json_api', tierHint: 'official_gis', retrievedAt: now,
      })], 'Reported by the official parcel source as a jurisdiction attribute; its governing role was not established.'),
      unitType: censusUnitTypeFor(clue.level),
      relationship: 'Reported by the official parcel source. Its governing role over land use was not established.',
      officialUrl: clue.sourceUrl,
    }));

  return {
    state, county, localUnit, incorporation,
    zoningAuthority, subdivisionAuthority, septicHealthAuthority, roadAccessAuthority,
    otherAuthorities,
    pattern,
    patternExplanation: explainPattern(pattern, {
      localUnitName: localUnit.name.value,
      countyName: county.name.value,
      stateName: state.name.value,
    }),
  };
}

function censusUnitTypeFor(level: JurisdictionClue['level']): GovernmentUnitType {
  switch (level) {
    case 'state': return 'state';
    case 'county': return 'county';
    case 'parish': return 'parish';
    case 'city': return 'city';
    case 'town': return 'town';
    case 'township': return 'township';
    case 'village': return 'village';
    case 'borough': return 'borough';
    case 'municipality': return 'municipality';
    case 'unincorporated_county': return 'unincorporated_county';
    case 'planning_jurisdiction': return 'planning_jurisdiction';
    default: return 'unknown';
  }
}

/** PART 1 A–G. Classified from resolved facts; never assumed from the state. */
export function classifyAuthorityPattern(facts: {
  incorporated: IncorporationStatus | null;
  localUnitIsGovernmentBelowCounty: boolean;
  stateFrameworkPresent: boolean;
  statePreemptionPresent: boolean;
  noConventionalZoning: boolean;
  zoningResolved: boolean;
  zoningBodyDiffersFromSubdivisionBody: boolean;
}): AuthorityPattern {
  if (facts.noConventionalZoning) return 'no_zoning_other_controls_apply';
  if (!facts.zoningResolved) return 'unresolved';
  if (facts.zoningBodyDiffersFromSubdivisionBody) return 'overlapping_authorities';
  if (facts.statePreemptionPresent) return 'state_preemption_present';
  if (facts.stateFrameworkPresent && facts.localUnitIsGovernmentBelowCounty) return 'state_framework_local_administration';
  if (facts.incorporated === 'incorporated') return 'municipal_zoning_split_control';
  if (facts.incorporated === 'unincorporated' && !facts.localUnitIsGovernmentBelowCounty) return 'county_unincorporated_control';
  return 'local_ordinance_controls';
}

function explainPattern(
  pattern: AuthorityPattern,
  names: { localUnitName: string | null; countyName: string | null; stateName: string | null },
): string {
  const local = names.localUnitName ?? 'the local unit';
  const county = names.countyName ?? 'the county';
  const state = names.stateName ?? 'the state';
  switch (pattern) {
    case 'state_framework_local_administration':
      return `${state} sets a statewide land-division framework and ${local} administers local approval within it.`;
    case 'county_unincorporated_control':
      return `The parcel is unincorporated and no sub-county government contains it, so ${county} is the local land-use authority.`;
    case 'municipal_zoning_split_control':
      return `${local} zones the parcel while other aspects remain with ${county} or ${state}.`;
    case 'state_preemption_present':
      return `${state} law limits what ${local} may restrict, so the state and local rules must be read together.`;
    case 'local_ordinance_controls':
      return `No statewide framework was established as controlling, so local ordinance governs.`;
    case 'no_zoning_other_controls_apply':
      return `No conventional zoning applies here. Subdivision, access, septic and building rules still do, and they are what govern what can be done.`;
    case 'overlapping_authorities':
      return `Different bodies control zoning and subdivision for this parcel, so both must be satisfied.`;
    case 'unresolved':
      return 'LandOS did not establish which body controls land use for this parcel.';
  }
}
