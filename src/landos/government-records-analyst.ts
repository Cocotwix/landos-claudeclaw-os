import type {
  GovernmentRecordAnalysis,
  GovernmentRecordAnalystInput,
  GovernmentRecordDomain,
  NormalizedGovernmentRecordClaim,
} from './government-records-types.js';

const text = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

function claimsFor(input: GovernmentRecordAnalystInput, domain: GovernmentRecordDomain) {
  return input.claims.filter((claim) => claim.domain === domain);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function ownershipPartyList(claim: NormalizedGovernmentRecordClaim): string[] {
  const value = claim.normalizedValue;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const parties = record.parties ?? record.owners ?? record.owner_names ?? record.named_parties;
    if (Array.isArray(parties)) return parties.map(text).filter(Boolean);
  }
  return /owner|grantee|party/i.test(claim.claimKey) && typeof value === 'string' && value.trim()
    ? [value.trim()]
    : [];
}

/**
 * Analyst brain boundary: deterministic and side-effect free. This module has
 * no browser, network, database, filesystem, scheduling, approval, or UI access.
 */
export function analyzeGovernmentRecords(input: GovernmentRecordAnalystInput): GovernmentRecordAnalysis {
  const deed = claimsFor(input, 'deed_ownership');
  const surveys = claimsFor(input, 'surveys_plats');
  const encumbrances = claimsFor(input, 'recorded_encumbrances');
  const taxes = claimsFor(input, 'property_tax');
  const liens = claimsFor(input, 'lien_judgment');
  const all = input.claims;

  const vesting = unique(deed
    .filter((claim) => /vesting|grantee|ownership/i.test(claim.claimKey))
    .map((claim) => claim.exactWording || text(claim.normalizedValue)));
  const owners = unique(deed
    .filter((claim) => /owner|grantee|vesting|party/i.test(claim.claimKey))
    .flatMap(ownershipPartyList));
  const normalizedContacts = input.leadContacts.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const normalizedOwners = owners.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const contactOwnerMismatch = normalizedContacts.length > 0
    && normalizedOwners.length > 0
    && !normalizedContacts.some((contact) => normalizedOwners.some((owner) => contact === owner || owner.includes(contact) || contact.includes(owner)));

  const ownershipClaims = deed.filter((claim) => /owner|grantee|vesting/i.test(claim.claimKey));
  const ownershipValues = unique(ownershipClaims.map((claim) => text(claim.normalizedValue)));
  const ownershipConflictGroups = unique(deed.map((claim) => claim.disputeGroup ?? '').filter(Boolean));
  const ownershipProvenance = unique(ownershipClaims.map((claim) => [
    claim.sourceName,
    claim.instrumentNumber ?? '',
    claim.bookPage ?? '',
    claim.sourceUrl ?? '',
  ].join('|')));
  const ownershipEvidenceConsistency: GovernmentRecordAnalysis['ownershipEvidenceConsistency'] =
    ownershipClaims.length === 0 ? 'missing'
      : ownershipConflictGroups.length > 0 ? 'conflicting'
        : ownershipProvenance.length === 1 ? 'single_source'
          : ownershipValues.length > 1 ? 'conflicting' : 'consistent';

  const unavailable = unique(all
    .filter((claim) => claim.locatorStatus === 'record_referenced_document_unavailable'
      || claim.locatorStatus === 'official_source_paywalled'
      || claim.locatorStatus === 'official_source_blocked'
      || claim.locatorStatus === 'official_source_unavailable')
    .map((claim) => claim.instrumentNumber || claim.bookPage || claim.exactWording || claim.claimKey));
  const searchedDomains = new Set(all.filter((claim) => claim.locatorStatus !== 'not_searched').map((claim) => claim.domain));
  const documentCompleteness: GovernmentRecordAnalysis['documentCompleteness'] = {
    status: input.artifacts.length > 0 && unavailable.length === 0 && searchedDomains.size === 5
      ? 'complete_for_screening'
      : input.artifacts.length > 0 || searchedDomains.size > 0 ? 'partial' : 'missing',
    retainedArtifactCount: input.artifacts.length,
    unavailableReferences: unavailable,
  };

  const retrievedSurvey = surveys.some((claim) => claim.locatorStatus === 'record_located' && claim.artifactId != null);
  const referencedSurvey = surveys.some((claim) => claim.locatorStatus === 'record_referenced_document_unavailable'
    || claim.association === 'referenced_in_instrument');
  const surveySearched = surveys.some((claim) => claim.locatorStatus !== 'not_searched');
  const surveyPlatAvailability: GovernmentRecordAnalysis['surveyPlatAvailability'] = {
    status: retrievedSurvey ? 'retrieved'
      : referencedSurvey ? 'referenced_not_retrieved'
        : surveySearched ? 'not_located_in_sources_searched' : 'not_searched',
    findings: surveys.map((claim) => claim.exactWording || text(claim.normalizedValue)).filter(Boolean),
  };

  const directEncumbrances = encumbrances
    .filter((claim) => claim.locatorStatus === 'record_located')
    .map((claim) => claim.exactWording || text(claim.normalizedValue));
  const positiveEncumbrances = directEncumbrances.filter((finding) =>
    !/^\s*(?:no|none)\b/i.test(finding)
    && !/\bno matching\b|\bnot located\b|\bnot found\b/i.test(finding));
  const taxIndicators = taxes
    .filter((claim) => /delinquen|balance|penalt|tax sale|redemption|assessment|separate.*account/i.test(`${claim.claimKey} ${claim.exactWording} ${text(claim.normalizedValue)}`))
    .map((claim) => claim.exactWording || `${claim.claimKey}: ${text(claim.normalizedValue)}`);
  const lienIndicators = liens
    .filter((claim) => claim.locatorStatus === 'record_located' || claim.locatorStatus === 'possible_owner_name_match')
    .map((claim) => {
      const prefix = claim.association === 'owner_name_possible_match'
        ? 'Possible owner-name match requiring human confirmation'
        : 'Direct subject-property record';
      return `${prefix}: ${claim.exactWording || `${claim.claimKey}: ${text(claim.normalizedValue)}`}`;
    });
  const titleRiskIndicators = unique([
    ...positiveEncumbrances,
    ...liens.filter((claim) => claim.association === 'subject_property_direct').map((claim) => claim.exactWording),
    ...deed.filter((claim) => /estate|deceased|trust|heir|entity|conflict/i.test(`${claim.claimKey} ${claim.exactWording}`)).map((claim) => claim.exactWording),
  ]);
  const materialConflicts = unique([
    ...(ownershipEvidenceConsistency === 'conflicting' ? ['Recorded ownership evidence contains differing owner or vesting statements.'] : []),
    ...all.filter((claim) => claim.disputeGroup).map((claim) => `Conflicting evidence group: ${claim.disputeGroup}`),
  ]);
  const missingInstruments = unique(all
    .filter((claim) => claim.locatorStatus === 'record_referenced_document_unavailable'
      || claim.locatorStatus === 'official_source_paywalled')
    .map((claim) => claim.instrumentNumber || claim.bookPage || claim.documentType || claim.claimKey));
  const propertyResearchQuestions = unique([
    ...(ownershipEvidenceConsistency === 'conflicting' ? ['Which recorded instrument controls the current vesting, and was a later corrective or transfer instrument recorded?'] : []),
    ...(surveyPlatAvailability.status === 'referenced_not_retrieved'
      ? ['Can the cited survey or plat be obtained from a free official source or supplied by the owner?']
      : surveyPlatAvailability.status !== 'retrieved'
        ? ['Which official recorder, survey, and plat indexes remain to be searched for the subject parcel and its legal description?']
        : []),
    ...(positiveEncumbrances.length === 0 ? ['Which recorder indexes and prior deed references should be searched for easements, restrictions, rights-of-way, and road-maintenance instruments?'] : []),
    ...(taxes.length === 0 ? ['What are the current and delinquent balances, special assessments, sale status, and redemption status for every official tax account?'] : []),
    ...(liens.length === 0 ? ['Which parcel-indexed and owner-name-indexed official lien and judgment sources remain to be screened?'] : []),
  ]);
  const limitations = unique([
    'This is public-record risk screening, not a legal title opinion, title commitment, or completed title examination.',
    'A record not located in the official sources searched is not proof that no survey, lien, restriction, easement, or judgment exists.',
    ...all.filter((claim) => claim.locatorStatus === 'official_source_unavailable').map((claim) => `${claim.sourceName} was unavailable when searched.`),
    ...all.filter((claim) => claim.locatorStatus === 'official_source_blocked').map((claim) => `${claim.sourceName} blocked automated access.`),
    ...all.filter((claim) => claim.locatorStatus === 'official_source_authenticated').map((claim) => `${claim.sourceName} required authenticated access.`),
    ...all.filter((claim) => claim.locatorStatus === 'official_source_paywalled').map((claim) => `${claim.sourceName} required payment; no payment was made.`),
  ]);
  const directLocated = all.filter((claim) => claim.locatorStatus === 'record_located').length;
  const confidence: GovernmentRecordAnalysis['confidence'] =
    directLocated >= 3 && input.artifacts.length > 0 && materialConflicts.length === 0
      && documentCompleteness.status === 'complete_for_screening' ? 'high'
      : directLocated > 0 || searchedDomains.size >= 3 ? 'medium' : 'low';

  return {
    analystEngineVersion: 'government-record-analyst-v1',
    scopeStatement: 'Public-record risk screening anchored to the confirmed subject property; seller authority is outside this analysis and contact/owner mismatch never gates research.',
    recordedOwnershipState: {
      exactVestingLanguage: vesting,
      namedOwnershipParties: owners,
      multipleOwners: owners.length > 1,
      estateTrustOrEntity: owners.some((owner) => /estate|trust|trustee|llc|inc|corp|company|heirs?/i.test(owner))
        || vesting.some((value) => /estate|trust|trustee|llc|inc|corp|company|heirs?/i.test(value)),
      contactOwnerMismatch,
      contactMismatchEffect: 'research_continues',
    },
    ownershipEvidenceConsistency,
    documentCompleteness,
    surveyPlatAvailability,
    recordedEasementRestrictionFindings: unique(directEncumbrances),
    titleRiskIndicators,
    taxDelinquencyIndicators: unique(taxIndicators),
    lienJudgmentScreeningIndicators: unique(lienIndicators),
    materialConflicts,
    missingInstruments,
    propertyResearchQuestions,
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
