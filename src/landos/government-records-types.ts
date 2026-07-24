export const GOVERNMENT_RECORD_DOMAINS = [
  'deed_ownership',
  'surveys_plats',
  'recorded_encumbrances',
  'property_tax',
  'lien_judgment',
] as const;

export type GovernmentRecordDomain = (typeof GOVERNMENT_RECORD_DOMAINS)[number];

export const GOVERNMENT_RECORD_ASSOCIATIONS = [
  'subject_property_direct',
  'owner_name_possible_match',
  'referenced_in_instrument',
  'not_applicable',
] as const;

export type GovernmentRecordAssociation = (typeof GOVERNMENT_RECORD_ASSOCIATIONS)[number];

export const GOVERNMENT_RECORD_LOCATOR_STATUSES = [
  'record_located',
  'possible_owner_name_match',
  'record_referenced_document_unavailable',
  'no_matching_record_found',
  'official_source_unavailable',
  'official_source_blocked',
  'official_source_authenticated',
  'official_source_paywalled',
  'not_searched',
] as const;

export type GovernmentRecordLocatorStatus = (typeof GOVERNMENT_RECORD_LOCATOR_STATUSES)[number];

export interface NormalizedGovernmentRecordClaim {
  claimKey: string;
  exactWording: string;
  normalizedValue: unknown;
  domain: GovernmentRecordDomain;
  association: GovernmentRecordAssociation;
  locatorStatus: GovernmentRecordLocatorStatus;
  sourceName: string;
  sourceUrl: string | null;
  sourceJurisdiction: string;
  sourceTier: string;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  retrievedAt: string;
  effectiveAt?: string | null;
  instrumentNumber?: string | null;
  bookPage?: string | null;
  parcelReference?: string | null;
  accountReference?: string | null;
  recordingFilingDate?: string | null;
  documentType?: string | null;
  artifactId?: number | null;
  artifactPage?: number | null;
  supersedesEvidenceId?: number | null;
  disputeGroup?: string | null;
}

export interface GovernmentRecordArtifactView {
  id: number;
  domain: GovernmentRecordDomain;
  sourceJurisdiction: string;
  sourceName: string;
  sourceUrl: string | null;
  portalReference: string | null;
  instrumentNumber: string | null;
  bookPage: string | null;
  parcelReference: string | null;
  accountReference: string | null;
  recordingFilingDate: string | null;
  documentType: string;
  pageCount: number;
  captureCount: number;
  artifactHash: string;
  mimeType: string;
  displayName: string;
  retrievedAt: string;
}

export interface GovernmentRecordAnalystInput {
  schemaVersion: 'government-record-normalized-v1';
  artifactSchemaVersion: 'government-record-artifact-v1';
  propertyIdentity: {
    id: number;
    version: number;
    status: string;
    apn: string | null;
    address: string | null;
    county: string | null;
    state: string | null;
    geometryPresent: boolean;
  };
  evidenceVersion: {
    maxEvidenceId: number | null;
    evidenceCount: number;
  };
  leadContacts: string[];
  claims: Array<NormalizedGovernmentRecordClaim & { evidenceId: number }>;
  artifacts: GovernmentRecordArtifactView[];
}

export interface GovernmentRecordEvidenceReference {
  evidenceId: number;
  artifactId: number | null;
  artifactPage: number | null;
  sourceName: string;
  sourceUrl: string | null;
  claimKey: string;
}

export interface GovernmentRecordAnalysis {
  analystEngineVersion: 'government-record-analyst-v1';
  scopeStatement: string;
  recordedOwnershipState: {
    exactVestingLanguage: string[];
    namedOwnershipParties: string[];
    multipleOwners: boolean;
    estateTrustOrEntity: boolean;
    contactOwnerMismatch: boolean;
    contactMismatchEffect: 'research_continues';
  };
  ownershipEvidenceConsistency: 'consistent' | 'conflicting' | 'single_source' | 'missing';
  documentCompleteness: {
    status: 'complete_for_screening' | 'partial' | 'missing';
    retainedArtifactCount: number;
    unavailableReferences: string[];
  };
  surveyPlatAvailability: {
    status: 'retrieved' | 'referenced_not_retrieved' | 'not_located_in_sources_searched' | 'not_searched';
    findings: string[];
  };
  recordedEasementRestrictionFindings: string[];
  titleRiskIndicators: string[];
  taxDelinquencyIndicators: string[];
  lienJudgmentScreeningIndicators: string[];
  materialConflicts: string[];
  missingInstruments: string[];
  propertyResearchQuestions: string[];
  evidenceReferences: GovernmentRecordEvidenceReference[];
  limitations: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface GovernmentRecordCollectorJobView {
  id: number;
  collectorKey: GovernmentRecordDomain;
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'blocked' | 'failed';
  identityVersionId: number;
  attemptCount: number;
  lastError: string | null;
  sourceJurisdiction: string;
  platform: string;
  adapterKey: string;
  cleanupStatus: string | null;
  cleanupError: string | null;
  ownedResourceCount: number;
  openResourceCountAfter: number;
  updatedAt: number;
}

export interface GovernmentRecordSnapshotView {
  id: number;
  dealCardId: number;
  version: number;
  identityVersionId: number;
  priorSnapshotId: number | null;
  inputHash: string;
  evidenceMaxId: number | null;
  completeness: {
    identity: 'complete' | 'needs_resolution';
    domains: Record<GovernmentRecordDomain, 'complete' | 'partial' | 'blocked' | 'missing'>;
    percent: number;
    missing: string[];
  };
  versions: {
    propertyIdentityVersion: number;
    normalizedEvidenceSchema: 'government-record-normalized-v1';
    artifactSchema: 'government-record-artifact-v1';
    analystEngine: 'government-record-analyst-v1';
    snapshotSchema: 'government-record-risk-snapshot-v1';
  };
  analysis: GovernmentRecordAnalysis;
  changeReason: string;
  generatedBy: string;
  createdAt: number;
}

export interface GovernmentRecordReadModel {
  identity: {
    id: number;
    version: number;
    status: string;
    address: string | null;
    county: string | null;
    state: string | null;
    apn: string | null;
  };
  snapshot: GovernmentRecordSnapshotView | null;
  jobs: GovernmentRecordCollectorJobView[];
  artifacts: GovernmentRecordArtifactView[];
  evidenceCount: number;
  corrections: Array<{
    id: number;
    status: string;
    reason: string;
    requestedBy: string;
    approvalId: number;
    priorIdentityVersionId: number;
    replacementIdentityVersionId: number | null;
    declaredInvalidations: string[];
    requestedAt: number;
    appliedAt: number | null;
  }>;
}
