import type {
  DimensionalStandardFinding,
  NormalizedZoningClaim,
  OrdinanceCitation,
  UsePermissionCategory,
  ZoningAnalysis,
  ZoningAnalystInput,
  ZoningDomain,
  ZoningUseFinding,
} from './zoning-types.js';

/**
 * Analyst brain boundary: deterministic and side-effect free. This module has
 * no browser, network, database, filesystem, scheduling, approval, or UI
 * access, and never fabricates a jurisdiction, district, overlay, use,
 * dimensional standard, or ordinance citation that is not present in its
 * normalized input claims.
 */

type AnalystClaim = NormalizedZoningClaim & { evidenceId: number };

const OFFICIAL_SOURCE_KINDS = new Set([
  'official_boundary',
  'official_gis',
  'official_ordinance',
  'official_planning_page',
  'official_government_document',
]);

const text = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const unique = (values: string[]): string[] => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

function claimsFor(input: ZoningAnalystInput, domain: ZoningDomain): AnalystClaim[] {
  return input.claims.filter((claim) => claim.domain === domain);
}

function isOfficial(claim: AnalystClaim): boolean {
  return OFFICIAL_SOURCE_KINDS.has(claim.sourceKind);
}

function useFinding(claim: AnalystClaim, category: UsePermissionCategory): ZoningUseFinding {
  return {
    useName: claim.useName ?? claim.claimKey,
    category,
    exactWording: claim.exactWording,
    citation: claim.citation ?? null,
    sourceName: claim.sourceName,
    sourceUrl: claim.sourceUrl,
    evidenceId: claim.evidenceId,
  };
}

function citationLabel(citation: OrdinanceCitation | null | undefined): string {
  if (!citation) return '';
  return [citation.ordinanceTitle, citation.article, citation.section, citation.table, citation.page]
    .filter(Boolean).join(' ');
}

export function analyzeZoning(input: ZoningAnalystInput): ZoningAnalysis {
  const jurisdictionClaims = claimsFor(input, 'jurisdiction_authority');
  const districtClaims = claimsFor(input, 'zoning_district');
  const ordinanceClaims = claimsFor(input, 'zoning_ordinance');
  const useClaims = claimsFor(input, 'permitted_uses');
  const dimensionalClaims = claimsFor(input, 'dimensional_standards');
  const all = input.claims;

  const missingInformation: string[] = [];
  const followUpQuestions: string[] = [];
  const materialConflicts: string[] = [];
  const risks: string[] = [];

  // ── Jurisdiction ────────────────────────────────────────────────────────
  const determinationClaim = jurisdictionClaims.find((claim) => claim.claimKey === 'jurisdiction_determination');
  const detValue = (determinationClaim?.normalizedValue ?? {}) as Record<string, unknown>;
  const jurisdiction: ZoningAnalysis['jurisdiction'] = {
    determination: detValue.determination === 'confirmed' ? 'confirmed'
      : detValue.determination === 'probable' ? 'probable' : 'undetermined',
    incorporationStatus: ([
      'incorporated_municipality', 'unincorporated_county', 'township_jurisdiction',
      'extraterritorial_jurisdiction', 'special_planning_area', 'undetermined',
    ] as const).find((status) => status === detValue.incorporationStatus) ?? 'undetermined',
    controllingAuthorityName: typeof detValue.controllingAuthorityName === 'string' ? detValue.controllingAuthorityName : null,
    controllingAuthorityLevel: ([
      'municipality', 'county', 'township', 'special_district', 'state', 'unknown',
    ] as const).find((level) => level === detValue.controllingAuthorityLevel) ?? 'unknown',
    officialBoundaryEvidence: detValue.officialBoundaryEvidence === true,
    mailingCityDiffersFromAuthority: detValue.mailingCityDiffersFromAuthority === true,
    candidateAuthoritiesConsidered: Array.isArray(detValue.candidateAuthoritiesConsidered)
      ? detValue.candidateAuthoritiesConsidered.map(text).filter(Boolean) : [],
    basis: determinationClaim?.exactWording ?? 'No jurisdiction determination has been collected.',
  };
  if (Array.isArray(detValue.missingInformation)) {
    missingInformation.push(...detValue.missingInformation.map(text).filter(Boolean));
  }
  if (jurisdiction.determination === 'undetermined') {
    missingInformation.push('An official boundary determination of the governing planning/zoning authority.');
    followUpQuestions.push('Which government actually administers planning and zoning over this exact parcel, per an official boundary or planning source?');
  }
  if (jurisdiction.mailingCityDiffersFromAuthority) {
    risks.push(`The mailing city differs from the governing zoning authority (${jurisdiction.controllingAuthorityName ?? 'undetermined'}); documents keyed to the mailing city may cite the wrong ordinance.`);
  }

  // ── Base district and overlays ──────────────────────────────────────────
  const locatedDistrictClaims = districtClaims.filter((claim) =>
    claim.locatorStatus === 'record_located' && (claim.districtCode || claim.districtName) && !claim.overlayName);
  const allOfficialDistrictClaims = locatedDistrictClaims.filter(isOfficial);
  // Operator-confirmed corrections beat weaker automation: when a correction
  // claim exists it controls the base district, and earlier automated claims
  // become auditable history rather than live conflicts.
  const correctionDistrictClaims = allOfficialDistrictClaims
    .filter((claim) => claim.sourceTier === 'operator_confirmed_correction');
  const officialDistrictClaims = correctionDistrictClaims.length
    ? [correctionDistrictClaims[correctionDistrictClaims.length - 1]]
    : allOfficialDistrictClaims;
  const thirdPartyDistrictClaims = locatedDistrictClaims.filter((claim) => claim.sourceKind === 'third_party');
  const officialCodes = unique(officialDistrictClaims.map((claim) => claim.districtCode ?? claim.districtName ?? ''));
  const thirdPartyCodes = unique(thirdPartyDistrictClaims.map((claim) => claim.districtCode ?? claim.districtName ?? ''));
  const disputed = districtClaims.some((claim) => claim.disputeGroup);

  let baseStatus: ZoningAnalysis['baseZoning']['status'];
  if (officialCodes.length > 1 || disputed) {
    baseStatus = 'conflicting';
    materialConflicts.push(`Official zoning sources disagree on the base district (${officialCodes.join(' vs ') || 'disputed evidence group'}). The controlling authority's own parcel-level result governs; the conflict must be resolved before interpretation.`);
  } else if (officialCodes.length === 1) {
    baseStatus = jurisdiction.determination === 'confirmed' ? 'officially_confirmed' : 'reported_unverified';
    if (jurisdiction.determination !== 'confirmed') {
      missingInformation.push('Confirmation of the governing jurisdiction before the official district label can be interpreted.');
    }
  } else if (thirdPartyCodes.length > 0) {
    baseStatus = 'reported_unverified';
    missingInformation.push(`Official corroboration of the third-party zoning label ${thirdPartyCodes.join(', ')} from the controlling authority's zoning map or ordinance.`);
    followUpQuestions.push('Does the controlling authority\'s official zoning map or parcel lookup confirm the third-party district label?');
  } else {
    baseStatus = 'undetermined';
    missingInformation.push('An official parcel-level zoning district result from the controlling authority.');
  }
  if (thirdPartyCodes.length > 0 && officialCodes.length > 0
    && !thirdPartyCodes.every((code) => officialCodes.includes(code))) {
    materialConflicts.push(`A third-party source reports district ${thirdPartyCodes.join(', ')} while the official source reports ${officialCodes.join(', ')}; the official source controls.`);
  }

  const primaryDistrictClaim = officialDistrictClaims[0] ?? thirdPartyDistrictClaims[0] ?? null;
  const baseZoning: ZoningAnalysis['baseZoning'] = {
    status: baseStatus,
    districtCode: primaryDistrictClaim?.districtCode ?? null,
    districtName: primaryDistrictClaim?.districtName ?? null,
    officialMapConfirmed: officialDistrictClaims.some((claim) => claim.sourceKind === 'official_gis'),
    thirdPartyReportsOnly: officialDistrictClaims.length === 0 && thirdPartyDistrictClaims.length > 0,
    interpretationAllowed: false,
    conflicts: materialConflicts.filter((conflict) => /district/.test(conflict)),
  };

  const overlays: ZoningAnalysis['overlays'] = districtClaims
    .filter((claim) => claim.overlayName && claim.locatorStatus === 'record_located')
    .map((claim) => ({
      name: claim.overlayName!,
      kind: text((claim.normalizedValue as Record<string, unknown> | null)?.overlayKind) || 'overlay_district',
      officiallyConfirmed: isOfficial(claim),
      sourceName: claim.sourceName,
      evidenceId: claim.evidenceId,
    }));
  for (const overlay of overlays) {
    if (/flood/i.test(`${overlay.name} ${overlay.kind}`)) risks.push(`Floodplain-related overlay "${overlay.name}" applies; development standards and insurance implications must come from the overlay provisions.`);
    else if (/airport/i.test(`${overlay.name} ${overlay.kind}`)) risks.push(`Airport-related overlay "${overlay.name}" applies; height and use limits may be stricter than the base district.`);
    else if (/historic/i.test(`${overlay.name} ${overlay.kind}`)) risks.push(`Historic overlay "${overlay.name}" applies; exterior changes and new construction may need additional review.`);
    else risks.push(`Overlay district "${overlay.name}" modifies the base district; its provisions must be read alongside the base district.`);
  }

  // ── Ordinance ───────────────────────────────────────────────────────────
  const retrievedOrdinance = ordinanceClaims.find((claim) =>
    claim.locatorStatus === 'record_located' && isOfficial(claim));
  const identifiedOrdinance = ordinanceClaims.find((claim) =>
    claim.locatorStatus !== 'not_searched' && (claim.citation?.ordinanceTitle || claim.normalizedValue));
  const ordinance: ZoningAnalysis['ordinance'] = retrievedOrdinance
    ? {
        status: 'retrieved',
        title: retrievedOrdinance.citation?.ordinanceTitle ?? text(retrievedOrdinance.normalizedValue) ?? null,
        adoptedOrEffectiveDate: retrievedOrdinance.citation?.adoptedOrEffectiveDate ?? retrievedOrdinance.effectiveAt ?? null,
        sourceUrl: retrievedOrdinance.sourceUrl,
      }
    : identifiedOrdinance
      ? {
          status: 'identified_not_retrieved',
          title: identifiedOrdinance.citation?.ordinanceTitle ?? text(identifiedOrdinance.normalizedValue) ?? null,
          adoptedOrEffectiveDate: identifiedOrdinance.citation?.adoptedOrEffectiveDate ?? null,
          sourceUrl: identifiedOrdinance.sourceUrl,
        }
      : { status: 'not_identified', title: null, adoptedOrEffectiveDate: null, sourceUrl: null };
  if (ordinance.status !== 'retrieved') {
    missingInformation.push('The governing zoning ordinance text (district use provisions and dimensional tables).');
    followUpQuestions.push(ordinance.status === 'identified_not_retrieved'
      ? `Can the identified ordinance "${ordinance.title ?? 'unknown title'}" be retrieved from a free official source?`
      : 'Which ordinance or land development code governs this parcel, and where is its official text published?');
  }

  // District labels are interpreted ONLY once the jurisdiction is confirmed
  // and the governing ordinance was actually retrieved from an official source.
  const interpretationAllowed = jurisdiction.determination === 'confirmed'
    && (baseZoning.status === 'officially_confirmed')
    && ordinance.status === 'retrieved';
  baseZoning.interpretationAllowed = interpretationAllowed;
  if (!interpretationAllowed && (baseZoning.districtCode || baseZoning.districtName)) {
    missingInformation.push(`District label "${baseZoning.districtCode ?? baseZoning.districtName}" is not interpreted: interpretation requires a confirmed jurisdiction, an officially confirmed district, and the retrieved governing ordinance.`);
  }

  // ── Uses ────────────────────────────────────────────────────────────────
  // Use permissions come only from official ordinance-grade sources; every
  // other use claim is reported as uncertain rather than upgraded. Claims are
  // never moved between categories.
  const usesByRight: ZoningUseFinding[] = [];
  const conditionalOrSpecialUses: ZoningUseFinding[] = [];
  const accessoryUses: ZoningUseFinding[] = [];
  const prohibitedUses: ZoningUseFinding[] = [];
  const usesNotLocated: ZoningUseFinding[] = [];
  const uncertainUses: ZoningUseFinding[] = [];
  for (const claim of useClaims) {
    const category = claim.useCategory ?? 'uncertain_provision_unavailable';
    const ordinanceGrade = claim.sourceKind === 'official_ordinance' || claim.sourceKind === 'official_government_document';
    if (!interpretationAllowed || !ordinanceGrade || claim.locatorStatus !== 'record_located') {
      if (category === 'not_located_in_reviewed_ordinance') usesNotLocated.push(useFinding(claim, category));
      else uncertainUses.push(useFinding(claim, 'uncertain_provision_unavailable'));
      continue;
    }
    switch (category) {
      case 'permitted_by_right': usesByRight.push(useFinding(claim, category)); break;
      case 'conditional_or_special': conditionalOrSpecialUses.push(useFinding(claim, category)); break;
      case 'accessory': accessoryUses.push(useFinding(claim, category)); break;
      case 'prohibited': prohibitedUses.push(useFinding(claim, category)); break;
      case 'not_located_in_reviewed_ordinance': usesNotLocated.push(useFinding(claim, category)); break;
      default: uncertainUses.push(useFinding(claim, 'uncertain_provision_unavailable'));
    }
  }
  if (interpretationAllowed && usesByRight.length === 0) {
    missingInformation.push('The by-right use list for the confirmed district from the retrieved ordinance.');
  }
  if (!interpretationAllowed && useClaims.length > 0) {
    missingInformation.push('Use permissions are withheld from interpretation until the jurisdiction, district, and ordinance are all officially confirmed.');
  }

  // ── Dimensional standards ───────────────────────────────────────────────
  const dimensionalStandards: DimensionalStandardFinding[] = [];
  for (const claim of dimensionalClaims) {
    const ordinanceGrade = claim.sourceKind === 'official_ordinance' || claim.sourceKind === 'official_government_document';
    if (!interpretationAllowed || !ordinanceGrade || claim.locatorStatus !== 'record_located' || !claim.standardName) continue;
    if (claim.districtCode && baseZoning.districtCode && claim.districtCode !== baseZoning.districtCode) {
      materialConflicts.push(`A dimensional standard was extracted for district ${claim.districtCode}, but the confirmed base district is ${baseZoning.districtCode}; the standard is excluded as coming from the wrong district table.`);
      continue;
    }
    dimensionalStandards.push({
      standardName: claim.standardName,
      value: claim.exactWording || text(claim.normalizedValue),
      districtCode: claim.districtCode ?? baseZoning.districtCode,
      citation: claim.citation ?? null,
      sourceName: claim.sourceName,
      sourceUrl: claim.sourceUrl,
      evidenceId: claim.evidenceId,
    });
  }
  if (interpretationAllowed && dimensionalStandards.length === 0) {
    missingInformation.push('The dimensional/development standards table for the confirmed district.');
  }

  // ── Implications ────────────────────────────────────────────────────────
  const subdivisionAndDevelopmentImplications: string[] = [];
  const minLot = dimensionalStandards.find((standard) => /min(imum)?\s*lot\s*(size|area)/i.test(standard.standardName));
  if (minLot) {
    subdivisionAndDevelopmentImplications.push(`Minimum lot size ${minLot.value}${citationLabel(minLot.citation) ? ` (${citationLabel(minLot.citation)})` : ''} controls how many lots a subdivision could yield; a survey-based yield check is required before relying on a lot count.`);
  }
  const frontage = dimensionalStandards.find((standard) => /frontage|lot width/i.test(standard.standardName));
  if (frontage) {
    subdivisionAndDevelopmentImplications.push(`Road frontage / lot width standard ${frontage.value} applies to each new lot.`);
  }
  const manufactured = [...usesByRight, ...conditionalOrSpecialUses, ...prohibitedUses]
    .find((use) => /manufactured|mobile home/i.test(use.useName));
  if (manufactured) {
    subdivisionAndDevelopmentImplications.push(`Manufactured housing is ${manufactured.category === 'permitted_by_right' ? 'permitted by right' : manufactured.category === 'conditional_or_special' ? 'a conditional/special use' : 'prohibited'} in this district${citationLabel(manufactured.citation) ? ` (${citationLabel(manufactured.citation)})` : ''}.`);
  }

  const likelyUsePathsSupportedByZoning = interpretationAllowed
    ? usesByRight.slice(0, 6).map((use) => `${use.useName} — permitted by right${citationLabel(use.citation) ? ` (${citationLabel(use.citation)})` : ''}.`)
    : [];

  // ── Limitations / confidence ────────────────────────────────────────────
  const limitations = unique([
    'This is zoning and land-use screening from official public sources, not a zoning verification letter, entitlement opinion, or legal advice.',
    'A use not listed in the reviewed ordinance provisions is reported as not located, never as allowed.',
    ...all.filter((claim) => claim.locatorStatus === 'official_source_unavailable').map((claim) => `${claim.sourceName} was unavailable when searched.`),
    ...all.filter((claim) => claim.locatorStatus === 'official_source_blocked').map((claim) => `${claim.sourceName} blocked automated access.`),
    ...all.filter((claim) => claim.locatorStatus === 'official_source_authenticated').map((claim) => `${claim.sourceName} required authenticated access.`),
    ...all.filter((claim) => claim.locatorStatus === 'official_source_registration_required').map((claim) => `${claim.sourceName} required free registration that has not yet been completed.`),
    ...all.filter((claim) => claim.locatorStatus === 'official_source_paywalled').map((claim) => `${claim.sourceName} required payment; no payment was made.`),
  ]);
  for (const claim of all) {
    if (claim.needsManualReview) {
      risks.push(`Manual review needed: ${claim.exactWording || claim.claimKey}`);
    }
    if (claim.disputeGroup) {
      materialConflicts.push(`Conflicting evidence group: ${claim.disputeGroup}`);
    }
  }

  const confidence: ZoningAnalysis['confidence'] =
    interpretationAllowed && usesByRight.length > 0 && materialConflicts.length === 0 ? 'high'
      : jurisdiction.determination === 'confirmed' && (baseZoning.status === 'officially_confirmed' || baseZoning.status === 'conflicting') ? 'medium'
        : 'low';

  return {
    analystEngineVersion: 'zoning-analyst-v1',
    scopeStatement: 'Jurisdiction, zoning, and land-use screening anchored to the confirmed subject parcel and geometry; seller, lead, or owner-name mismatches never gate this research, and no permission is inferred from silence in the ordinance.',
    jurisdiction,
    baseZoning,
    overlays,
    ordinance,
    usesByRight,
    conditionalOrSpecialUses,
    accessoryUses,
    prohibitedUses,
    usesNotLocated,
    uncertainUses,
    dimensionalStandards,
    subdivisionAndDevelopmentImplications,
    likelyUsePathsSupportedByZoning,
    materialConflicts: unique(materialConflicts),
    risks: unique(risks),
    missingInformation: unique(missingInformation),
    followUpQuestions: unique(followUpQuestions),
    evidenceReferences: all.map((claim) => ({
      evidenceId: claim.evidenceId,
      artifactId: claim.artifactId ?? null,
      artifactPage: claim.artifactPage ?? null,
      sourceName: claim.sourceName,
      sourceUrl: claim.sourceUrl,
      claimKey: claim.claimKey,
    })),
    limitations,
    confidence,
  };
}
