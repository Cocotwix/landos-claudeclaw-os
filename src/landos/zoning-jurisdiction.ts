// Jurisdiction resolution for the zoning slice. Deterministic, dependency-free
// logic that turns OFFICIAL boundary evidence into a governing-authority
// determination. Mailing city, ZIP, nearest city, county label, and address
// text are never determination inputs — only official boundary findings tied
// to the confirmed parcel geometry are.

import type {
  IncorporationStatus,
  NormalizedZoningClaim,
  ZoningAuthorityLevel,
  ZoningSourceKind,
} from './zoning-types.js';

/** One official boundary query result anchored to the parcel geometry. */
export interface BoundaryFinding {
  kind:
    | 'incorporated_place'
    | 'county_subdivision'
    | 'municipal_boundary'
    | 'extraterritorial_jurisdiction'
    | 'special_planning_area';
  /** Name of the government unit the layer feature describes (e.g. "Kingston"). */
  unitName: string | null;
  /** Whether the parcel geometry is inside this unit's official boundary. */
  containsParcel: 'inside' | 'outside' | 'partial' | 'unknown';
  /** True when the layer query itself completed against an official source. */
  queried: boolean;
  sourceKind: ZoningSourceKind;
  sourceName: string;
  sourceUrl: string | null;
  exactWording: string;
  /** Census functional status (e.g. "A" = active government) when available. */
  functionalStatus?: string | null;
}

/**
 * Who actually administers planning/zoning for a government unit. This is
 * jurisdiction-specific configuration: an incorporated town may have no zoning
 * ordinance, and some counties are unzoned. `unknown` keeps the determination
 * honest instead of guessing.
 */
export interface AuthorityZoningConfig {
  authorityName: string;
  level: ZoningAuthorityLevel;
  administersZoning: 'yes' | 'no' | 'unknown';
  note?: string;
}

export interface JurisdictionDeterminationInput {
  parcel: {
    county: string | null;
    state: string | null;
    /** Mailing/postal city from the address label — informational ONLY. */
    mailingCity: string | null;
    geometryPresent: boolean;
  };
  findings: BoundaryFinding[];
  /** Jurisdiction-specific zoning-administration configuration, when known. */
  authorityConfigs?: AuthorityZoningConfig[];
}

export interface JurisdictionDetermination {
  determination: 'confirmed' | 'probable' | 'undetermined';
  incorporationStatus: IncorporationStatus;
  controllingAuthorityName: string | null;
  controllingAuthorityLevel: ZoningAuthorityLevel;
  officialBoundaryEvidence: boolean;
  mailingCityDiffersFromAuthority: boolean;
  candidateAuthoritiesConsidered: string[];
  basis: string;
  missingInformation: string[];
}

const OFFICIAL_KINDS: ZoningSourceKind[] = [
  'official_boundary',
  'official_gis',
  'official_planning_page',
  'official_government_document',
];

function normalizeName(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findConfig(
  configs: AuthorityZoningConfig[],
  name: string | null,
  level: ZoningAuthorityLevel,
): AuthorityZoningConfig | null {
  if (!name) return null;
  return configs.find((config) => config.level === level && normalizeName(config.authorityName) === normalizeName(name))
    ?? null;
}

/**
 * Determine the governing planning/zoning jurisdiction from official boundary
 * evidence. The parcel's mailing city and county label are never used to pick
 * the authority; they only feed the informational mismatch flag.
 */
export function determineJurisdiction(input: JurisdictionDeterminationInput): JurisdictionDetermination {
  const configs = input.authorityConfigs ?? [];
  const official = input.findings.filter((finding) => OFFICIAL_KINDS.includes(finding.sourceKind));
  const candidates = [...new Set(input.findings
    .filter((finding) => finding.unitName)
    .map((finding) => `${finding.unitName} (${finding.kind.replace(/_/g, ' ')})`))];
  const missing: string[] = [];

  if (!input.parcel.geometryPresent) {
    return {
      determination: 'undetermined',
      incorporationStatus: 'undetermined',
      controllingAuthorityName: null,
      controllingAuthorityLevel: 'unknown',
      officialBoundaryEvidence: false,
      mailingCityDiffersFromAuthority: false,
      candidateAuthoritiesConsidered: candidates,
      basis: 'No confirmed parcel geometry is available, so the governing jurisdiction cannot be determined from official boundaries.',
      missingInformation: ['Confirmed parcel coordinates or polygon geometry.'],
    };
  }

  const placeQueries = official.filter((finding) =>
    finding.kind === 'incorporated_place' || finding.kind === 'municipal_boundary');
  const placeQueryRan = placeQueries.some((finding) => finding.queried);
  const insidePlaces = placeQueries.filter((finding) => finding.containsParcel === 'inside' && finding.unitName);
  const partialPlaces = placeQueries.filter((finding) => finding.containsParcel === 'partial' && finding.unitName);
  const townships = official.filter((finding) => finding.kind === 'county_subdivision'
    && (finding.containsParcel === 'inside' || finding.containsParcel === 'partial')
    && finding.unitName);
  const etjFindings = official.filter((finding) => finding.kind === 'extraterritorial_jurisdiction'
    && finding.containsParcel === 'inside' && finding.unitName);
  const specialAreas = official.filter((finding) => finding.kind === 'special_planning_area'
    && (finding.containsParcel === 'inside' || finding.containsParcel === 'partial')
    && finding.unitName);

  const countyName = input.parcel.county
    ? `${input.parcel.county.replace(/\s+county$/i, '')} County`
    : null;

  if (!placeQueryRan) {
    missing.push('An official incorporated-place or municipal boundary query for the parcel geometry.');
    return {
      determination: 'undetermined',
      incorporationStatus: 'undetermined',
      controllingAuthorityName: null,
      controllingAuthorityLevel: 'unknown',
      officialBoundaryEvidence: false,
      mailingCityDiffersFromAuthority: false,
      candidateAuthoritiesConsidered: candidates,
      basis: 'No official municipal-boundary source could be queried for the parcel geometry; the governing jurisdiction is intentionally left undetermined rather than inferred from the address label.',
      missingInformation: missing,
    };
  }

  let incorporationStatus: IncorporationStatus;
  let authorityName: string | null;
  let authorityLevel: ZoningAuthorityLevel;
  let determination: 'confirmed' | 'probable' = 'confirmed';
  const basisParts: string[] = [];

  if (insidePlaces.length > 0) {
    const place = insidePlaces[0];
    incorporationStatus = 'incorporated_municipality';
    authorityName = place.unitName;
    authorityLevel = 'municipality';
    basisParts.push(`The parcel geometry falls inside the official boundary of ${place.unitName} per ${place.sourceName}.`);
    if (insidePlaces.length > 1) {
      determination = 'probable';
      basisParts.push(`Multiple boundary features matched (${insidePlaces.map((f) => f.unitName).join(', ')}); manual confirmation of the controlling municipality is required.`);
      missing.push('Resolution of the overlapping municipal boundary features.');
    }
  } else if (partialPlaces.length > 0) {
    const place = partialPlaces[0];
    incorporationStatus = 'incorporated_municipality';
    authorityName = place.unitName;
    authorityLevel = 'municipality';
    determination = 'probable';
    basisParts.push(`The parcel geometry partially intersects the official boundary of ${place.unitName} per ${place.sourceName}; a split-jurisdiction parcel needs manual confirmation.`);
    missing.push('Confirmation of which side of the municipal boundary controls the buildable area.');
  } else {
    incorporationStatus = 'unincorporated_county';
    authorityName = countyName;
    authorityLevel = 'county';
    basisParts.push('No official incorporated-place boundary contains the parcel geometry, so the parcel is in the unincorporated county jurisdiction.');
  }

  // Township-controlled zoning replaces the county default only when the
  // township is configured as the zoning administrator.
  if (incorporationStatus === 'unincorporated_county' && townships.length > 0) {
    const township = townships[0];
    const townshipConfig = findConfig(configs, township.unitName, 'township');
    if (townshipConfig?.administersZoning === 'yes') {
      incorporationStatus = 'township_jurisdiction';
      authorityName = township.unitName;
      authorityLevel = 'township';
      basisParts.push(`${township.unitName} administers zoning for this area per jurisdiction configuration, based on ${township.sourceName}.`);
    } else if (townshipConfig?.administersZoning === 'unknown' || (!townshipConfig && township.functionalStatus === 'A')) {
      determination = 'probable';
      basisParts.push(`The parcel lies in ${township.unitName} (official county subdivision); whether that unit administers zoning is not yet confirmed.`);
      missing.push(`Whether ${township.unitName} administers planning/zoning or defers to the county.`);
    }
  }

  // ETJ evidence narrows an unincorporated determination.
  if (incorporationStatus === 'unincorporated_county' && etjFindings.length > 0) {
    const etj = etjFindings[0];
    incorporationStatus = 'extraterritorial_jurisdiction';
    authorityName = etj.unitName;
    authorityLevel = 'municipality';
    basisParts.push(`The parcel lies inside the official extraterritorial jurisdiction of ${etj.unitName} per ${etj.sourceName}.`);
  }

  if (specialAreas.length > 0) {
    basisParts.push(`Special planning area evidence: ${specialAreas.map((f) => f.unitName).join(', ')}.`);
  }

  // Apply the zoning-administration configuration for the selected authority.
  const config = findConfig(configs, authorityName, authorityLevel)
    ?? (authorityLevel === 'county' ? findConfig(configs, countyName, 'county') : null);
  if (config?.administersZoning === 'no') {
    if (authorityLevel === 'municipality') {
      basisParts.push(`${authorityName} does not administer its own zoning per jurisdiction configuration${config.note ? ` (${config.note})` : ''}; the county program applies.`);
      authorityName = countyName;
      authorityLevel = 'county';
    } else {
      basisParts.push(`${authorityName} has no zoning program per jurisdiction configuration${config.note ? ` (${config.note})` : ''}.`);
      missing.push('The state or regional land-use controls that apply where no local zoning program exists.');
      determination = 'probable';
    }
  } else if (!config) {
    missing.push(`Official confirmation that ${authorityName ?? 'the selected authority'} administers zoning for this parcel (planning department or ordinance source).`);
    determination = 'probable';
  }

  const mailingCityDiffersFromAuthority = Boolean(
    input.parcel.mailingCity
    && authorityName
    && normalizeName(input.parcel.mailingCity) !== normalizeName(authorityName.replace(/\s+county$/i, ''))
  );
  if (mailingCityDiffersFromAuthority) {
    basisParts.push(`The mailing city "${input.parcel.mailingCity}" differs from the governing authority "${authorityName}"; the mailing label was not used in this determination.`);
  }

  return {
    determination,
    incorporationStatus,
    controllingAuthorityName: authorityName,
    controllingAuthorityLevel: authorityLevel,
    officialBoundaryEvidence: true,
    mailingCityDiffersFromAuthority,
    candidateAuthoritiesConsidered: candidates,
    basis: basisParts.join(' '),
    missingInformation: missing,
  };
}

/**
 * Convert boundary findings + the determination into normalized zoning claims
 * for the jurisdiction_authority domain. Every claim keeps the official
 * source URL and exact wording so the evidence chain stays auditable.
 */
export function buildJurisdictionClaims(input: {
  determination: JurisdictionDetermination;
  findings: BoundaryFinding[];
  sourceJurisdiction: string;
  retrievedAt: string;
}): Array<Omit<NormalizedZoningClaim, 'artifactId'> & { artifactKey?: string | null }> {
  const det = input.determination;
  const claims: Array<Omit<NormalizedZoningClaim, 'artifactId'> & { artifactKey?: string | null }> = [];
  for (const finding of input.findings) {
    claims.push({
      claimKey: `boundary_${finding.kind}_${normalizeName(finding.unitName ?? 'none').replace(/[^a-z0-9]+/g, '_') || 'query'}`,
      exactWording: finding.exactWording,
      normalizedValue: {
        kind: finding.kind,
        unitName: finding.unitName,
        containsParcel: finding.containsParcel,
        functionalStatus: finding.functionalStatus ?? null,
      },
      domain: 'jurisdiction_authority',
      locatorStatus: finding.queried ? 'record_located' : 'official_source_unavailable',
      sourceKind: finding.sourceKind,
      authorityLevel: finding.kind === 'county_subdivision' ? 'township'
        : finding.kind === 'incorporated_place' || finding.kind === 'municipal_boundary' || finding.kind === 'extraterritorial_jurisdiction' ? 'municipality'
          : 'special_district',
      authorityName: finding.unitName,
      sourceName: finding.sourceName,
      sourceUrl: finding.sourceUrl,
      sourceJurisdiction: input.sourceJurisdiction,
      sourceTier: 'official_boundary',
      confidence: finding.queried ? 'high' : 'unknown',
      retrievedAt: input.retrievedAt,
    });
  }
  claims.push({
    claimKey: 'jurisdiction_determination',
    exactWording: det.basis,
    normalizedValue: {
      determination: det.determination,
      incorporationStatus: det.incorporationStatus,
      controllingAuthorityName: det.controllingAuthorityName,
      controllingAuthorityLevel: det.controllingAuthorityLevel,
      officialBoundaryEvidence: det.officialBoundaryEvidence,
      mailingCityDiffersFromAuthority: det.mailingCityDiffersFromAuthority,
      candidateAuthoritiesConsidered: det.candidateAuthoritiesConsidered,
      missingInformation: det.missingInformation,
    },
    domain: 'jurisdiction_authority',
    locatorStatus: det.officialBoundaryEvidence ? 'record_located' : 'official_source_unavailable',
    sourceKind: 'official_boundary',
    authorityLevel: det.controllingAuthorityLevel,
    authorityName: det.controllingAuthorityName,
    sourceName: 'Jurisdiction determination from official boundary evidence',
    sourceUrl: null,
    sourceJurisdiction: input.sourceJurisdiction,
    sourceTier: 'official_boundary',
    confidence: det.determination === 'confirmed' ? 'high' : det.determination === 'probable' ? 'medium' : 'unknown',
    retrievedAt: input.retrievedAt,
  });
  return claims;
}
