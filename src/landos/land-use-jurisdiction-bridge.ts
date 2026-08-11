// LAND USE → ZONING JURISDICTION BRIDGE
//
// Two subsystems resolve WHO governs a parcel, and they were allowed to hold
// contradictory state:
//
//   • The Land Use engine resolves the full authority stack from the federal
//     geography service. For deal 83 it named "Whitewater township" as the
//     zoning authority and tiered it `verified_official`.
//   • The zoning slice builds its own jurisdiction determination from official
//     boundary collectors, and shows "No jurisdiction determination has been
//     collected." when it has none.
//
// The zoning slice had none because BOTH its entry points refuse to collect
// until the versioned parcel identity reaches `confirmed`, and identity
// reconciliation deliberately caps a provider-panel match at `candidate`,
// reserving `confirmed` for an official county parcel record. On a parcel whose
// county publishes no official parcel service, that is never reached — so the
// operator saw an authority in one section and "not collected" in another.
//
// This module is the missing connection. It does NOT research anything: it
// reads the ALREADY-ACCEPTED Land Use determination and restates its zoning
// authority as the zoning slice's own normalized claim, carrying the original
// citations. One engine, one accepted answer, every section.
//
// What it will not do:
//   • It never invents an authority. No accepted value means no claim.
//   • It never upgrades quality. Only a `verified_official` land-use value
//     becomes a `confirmed` determination; anything weaker stays `probable`.
//   • It never touches the parcel-level gate. Zoning DISTRICT lookup still
//     requires confirmed parcel geometry, because a district is read from the
//     parcel polygon. Jurisdiction is read from the address point, which is
//     why it does not need one.

import { getLandUseDetermination } from './land-use-store.js';
import type {
  AuthorityStack,
  EvidencedValue,
  LandUseDetermination,
  LegalSourceCitation,
  ResolvedAuthority,
} from './land-use-types.js';
import type { ZoningAuthorityLevel } from './zoning-types.js';

export const LAND_USE_BRIDGE_SOURCE = 'Accepted land-use authority determination';

/** Government unit type → the zoning slice's coarser authority level. */
function authorityLevelFor(authority: ResolvedAuthority | undefined): ZoningAuthorityLevel {
  switch (authority?.unitType) {
    case 'city': case 'town': case 'village': case 'borough':
    case 'municipality': case 'independent_city': case 'consolidated_city_county':
      return 'municipality';
    case 'township':
      return 'township';
    case 'county': case 'parish': case 'borough_census_area': case 'unincorporated_county':
      return 'county';
    case 'special_district': case 'planning_jurisdiction':
      return 'special_district';
    case 'state':
      return 'state';
    default:
      return 'unknown';
  }
}

/**
 * The zoning slice's incorporation vocabulary, derived from the land-use
 * incorporation finding together with the unit that actually administers
 * zoning. A township that administers zoning is `township_jurisdiction` even
 * though the territory is unincorporated — the two facts are not the same.
 */
function incorporationStatusFor(
  stack: AuthorityStack | undefined,
  level: ZoningAuthorityLevel,
): string {
  const incorporation = stack?.incorporation?.value ?? null;
  if (level === 'township') return 'township_jurisdiction';
  if (incorporation === 'incorporated' && level === 'municipality') return 'incorporated_municipality';
  if (incorporation === 'unincorporated' && level === 'county') return 'unincorporated_county';
  if (level === 'special_district') return 'special_planning_area';
  return 'undetermined';
}

/** First citation carrying a URL, else the first citation at all. */
function primaryCitation(value: EvidencedValue<string> | undefined): LegalSourceCitation | null {
  const citations = value?.citations ?? [];
  return citations.find((citation) => !!citation.url) ?? citations[0] ?? null;
}

/**
 * Which authority actually governs zoning, per the accepted determination.
 * `zoningAuthority` is resolved as its own role precisely so this is not
 * inferred from county containment; `localUnit` is the fallback only when the
 * zoning role itself was never resolved.
 */
function governingAuthority(stack: AuthorityStack | undefined): ResolvedAuthority | null {
  const zoning = stack?.zoningAuthority;
  if (zoning?.name?.value) return zoning;
  const local = stack?.localUnit;
  if (local?.name?.value) return local;
  return null;
}

/**
 * The accepted governing authority, in the vocabulary the zoning diligence
 * read model speaks. Deliberately free of zoning-claim-store types: this is a
 * restatement of an already-accepted conclusion for display, not a new claim.
 */
export interface AcceptedGoverningAuthority {
  authorityName: string;
  authorityLevel: ZoningAuthorityLevel;
  incorporationStatus: string;
  determination: 'confirmed' | 'probable';
  /** Plain-language statement of who governs and why, for the operator. */
  basis: string;
  sourceName: string;
  sourceUrl: string | null;
  retrievedAt: string;
  mailingCityDiffersFromAuthority: boolean;
  candidateAuthoritiesConsidered: string[];
  determinedAt: string;
}

/**
 * Restate an accepted Land Use zoning authority for the zoning diligence read
 * model. Returns null when nothing has been accepted — silence is never
 * converted into a finding.
 */
export function jurisdictionClaimFromLandUse(input: {
  determination: LandUseDetermination;
  mailingCity?: string | null;
}): AcceptedGoverningAuthority | null {
  const stack = input.determination.authority;
  const authority = governingAuthority(stack);
  if (!authority?.name?.value) return null;

  const authorityName = authority.name.value;
  const level = authorityLevelFor(authority);
  // Only an official-quality land-use value may present as `confirmed`.
  const determination = authority.name.quality === 'verified_official' ? 'confirmed' : 'probable';
  const citation = primaryCitation(authority.name);
  const officialBoundaryEvidence = determination === 'confirmed';

  // Informational only: it never selects the authority, it warns the operator
  // that documents keyed to the mailing city may cite the wrong ordinance.
  const mailingCity = (input.mailingCity ?? '').trim().toLowerCase();
  const mailingCityDiffersFromAuthority = mailingCity.length > 0
    && !authorityName.toLowerCase().includes(mailingCity);

  const excerpt = citation?.excerpt?.trim();
  const basis = [
    `${authorityName} administers zoning for this parcel, per the accepted land-use authority determination`,
    stack?.patternExplanation ? ` (${stack.patternExplanation})` : '',
    '.',
    excerpt ? ` ${excerpt}` : '',
  ].join('');

  return {
    authorityName,
    authorityLevel: level,
    incorporationStatus: incorporationStatusFor(stack, level),
    determination,
    basis,
    sourceName: citation?.label ?? LAND_USE_BRIDGE_SOURCE,
    sourceUrl: citation?.url ?? null,
    retrievedAt: citation?.retrievedAt ?? input.determination.determinedAt,
    mailingCityDiffersFromAuthority,
    candidateAuthoritiesConsidered: [
      stack?.county?.name?.value,
      stack?.localUnit?.name?.value,
    ].filter((name): name is string => !!name && name !== authorityName),
    determinedAt: input.determination.determinedAt,
  };
}

/**
 * The whole bridge for one Deal Card: read the ALREADY-ACCEPTED land-use
 * determination and restate its governing authority. Reads only — it never
 * triggers research, and returns null when nothing has been accepted.
 */
export function acceptedGoverningAuthorityForDeal(input: {
  dealCardId: number;
  mailingCity?: string | null;
}): AcceptedGoverningAuthority | null {
  const record = getLandUseDetermination(input.dealCardId);
  if (!record) return null;
  return jurisdictionClaimFromLandUse({
    determination: record.determination,
    mailingCity: input.mailingCity ?? null,
  });
}
