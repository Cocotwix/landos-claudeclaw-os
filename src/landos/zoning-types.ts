// Jurisdiction, Zoning, and Land-Use Intelligence slice: shared contracts.
// Types only — no runtime imports so the Analyst boundary stays pure.

export const ZONING_DOMAINS = [
  'jurisdiction_authority',
  'zoning_district',
  'zoning_ordinance',
  'permitted_uses',
  'dimensional_standards',
] as const;

export type ZoningDomain = (typeof ZONING_DOMAINS)[number];

/** Owner-visible per-domain workflow states for the zoning read model. */
export const ZONING_WORKFLOW_STATES = [
  'queued',
  'running',
  'complete',
  'partial',
  'blocked',
  'unavailable',
  'conflicted',
  'superseded',
  'manual_review_needed',
] as const;

export type ZoningWorkflowState = (typeof ZONING_WORKFLOW_STATES)[number];

export const ZONING_LOCATOR_STATUSES = [
  'record_located',
  'record_referenced_document_unavailable',
  'no_matching_record_found',
  'official_source_unavailable',
  'official_source_blocked',
  'official_source_authenticated',
  'official_source_registration_required',
  'official_source_paywalled',
  'not_searched',
] as const;

export type ZoningLocatorStatus = (typeof ZONING_LOCATOR_STATUSES)[number];

/**
 * Use-permission categories. "Allowed" is never inferred from absence: a use
 * that is not in the reviewed ordinance is `not_located_in_reviewed_ordinance`,
 * and a use whose controlling provision could not be retrieved is
 * `uncertain_provision_unavailable`.
 */
export const USE_PERMISSION_CATEGORIES = [
  'permitted_by_right',
  'conditional_or_special',
  'accessory',
  'prohibited',
  'not_located_in_reviewed_ordinance',
  'uncertain_provision_unavailable',
] as const;

export type UsePermissionCategory = (typeof USE_PERMISSION_CATEGORIES)[number];

export const ZONING_AUTHORITY_LEVELS = [
  'municipality',
  'county',
  'township',
  'special_district',
  'state',
  'unknown',
] as const;

export type ZoningAuthorityLevel = (typeof ZONING_AUTHORITY_LEVELS)[number];

export const INCORPORATION_STATUSES = [
  'incorporated_municipality',
  'unincorporated_county',
  'township_jurisdiction',
  'extraterritorial_jurisdiction',
  'special_planning_area',
  'undetermined',
] as const;

export type IncorporationStatus = (typeof INCORPORATION_STATUSES)[number];

/**
 * How the source relates to official government authority. `third_party`
 * labels are never treated as official confirmation unless independently
 * corroborated by an `official_*` source.
 */
export const ZONING_SOURCE_KINDS = [
  'official_boundary',
  'official_gis',
  'official_ordinance',
  'official_planning_page',
  'official_government_document',
  'third_party',
] as const;

export type ZoningSourceKind = (typeof ZONING_SOURCE_KINDS)[number];

export interface OrdinanceCitation {
  ordinanceTitle?: string | null;
  adoptedOrEffectiveDate?: string | null;
  article?: string | null;
  section?: string | null;
  table?: string | null;
  page?: string | null;
  mapReference?: string | null;
}

export interface NormalizedZoningClaim {
  claimKey: string;
  exactWording: string;
  normalizedValue: unknown;
  domain: ZoningDomain;
  locatorStatus: ZoningLocatorStatus;
  sourceKind: ZoningSourceKind;
  authorityLevel: ZoningAuthorityLevel;
  authorityName?: string | null;
  sourceName: string;
  sourceUrl: string | null;
  sourceJurisdiction: string;
  sourceTier: string;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  retrievedAt: string;
  effectiveAt?: string | null;
  districtCode?: string | null;
  districtName?: string | null;
  overlayName?: string | null;
  useName?: string | null;
  useCategory?: UsePermissionCategory | null;
  standardName?: string | null;
  citation?: OrdinanceCitation | null;
  needsManualReview?: boolean;
  artifactId?: number | null;
  artifactPage?: number | null;
  supersedesEvidenceId?: number | null;
  disputeGroup?: string | null;
}

export interface ZoningArtifactView {
  id: number;
  domain: ZoningDomain;
  sourceJurisdiction: string;
  authorityName: string | null;
  sourceName: string;
  sourceUrl: string | null;
  portalReference: string | null;
  ordinanceTitle: string | null;
  ordinanceEffectiveDate: string | null;
  sectionReference: string | null;
  districtReference: string | null;
  documentType: string;
  pageCount: number;
  captureCount: number;
  artifactHash: string;
  mimeType: string;
  displayName: string;
  retrievedAt: string;
}

export interface ZoningAnalystInput {
  schemaVersion: 'zoning-normalized-v1';
  artifactSchemaVersion: 'zoning-artifact-v1';
  propertyIdentity: {
    id: number;
    version: number;
    status: string;
    apn: string | null;
    address: string | null;
    city: string | null;
    county: string | null;
    state: string | null;
    geometryPresent: boolean;
  };
  evidenceVersion: {
    maxEvidenceId: number | null;
    evidenceCount: number;
  };
  claims: Array<NormalizedZoningClaim & { evidenceId: number }>;
  artifacts: ZoningArtifactView[];
}

export interface ZoningEvidenceReference {
  evidenceId: number;
  artifactId: number | null;
  artifactPage: number | null;
  sourceName: string;
  sourceUrl: string | null;
  claimKey: string;
}

export interface ZoningUseFinding {
  useName: string;
  category: UsePermissionCategory;
  exactWording: string;
  citation: OrdinanceCitation | null;
  sourceName: string;
  sourceUrl: string | null;
  evidenceId: number;
}

export interface DimensionalStandardFinding {
  standardName: string;
  value: string;
  districtCode: string | null;
  citation: OrdinanceCitation | null;
  sourceName: string;
  sourceUrl: string | null;
  evidenceId: number;
}

export interface ZoningAnalysis {
  analystEngineVersion: 'zoning-analyst-v1';
  scopeStatement: string;
  jurisdiction: {
    determination: 'confirmed' | 'probable' | 'undetermined';
    incorporationStatus: IncorporationStatus;
    controllingAuthorityName: string | null;
    controllingAuthorityLevel: ZoningAuthorityLevel;
    officialBoundaryEvidence: boolean;
    mailingCityDiffersFromAuthority: boolean;
    candidateAuthoritiesConsidered: string[];
    basis: string;
  };
  baseZoning: {
    status: 'officially_confirmed' | 'reported_unverified' | 'conflicting' | 'undetermined';
    districtCode: string | null;
    districtName: string | null;
    officialMapConfirmed: boolean;
    thirdPartyReportsOnly: boolean;
    interpretationAllowed: boolean;
    conflicts: string[];
  };
  overlays: Array<{
    name: string;
    kind: string;
    officiallyConfirmed: boolean;
    sourceName: string;
    evidenceId: number;
  }>;
  ordinance: {
    status: 'retrieved' | 'identified_not_retrieved' | 'not_identified';
    title: string | null;
    adoptedOrEffectiveDate: string | null;
    sourceUrl: string | null;
  };
  usesByRight: ZoningUseFinding[];
  conditionalOrSpecialUses: ZoningUseFinding[];
  accessoryUses: ZoningUseFinding[];
  prohibitedUses: ZoningUseFinding[];
  usesNotLocated: ZoningUseFinding[];
  uncertainUses: ZoningUseFinding[];
  dimensionalStandards: DimensionalStandardFinding[];
  subdivisionAndDevelopmentImplications: string[];
  likelyUsePathsSupportedByZoning: string[];
  materialConflicts: string[];
  risks: string[];
  missingInformation: string[];
  followUpQuestions: string[];
  evidenceReferences: ZoningEvidenceReference[];
  limitations: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface ZoningCollectorJobView {
  id: number;
  collectorKey: ZoningDomain;
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

export interface ZoningSnapshotView {
  id: number;
  dealCardId: number;
  version: number;
  identityVersionId: number;
  priorSnapshotId: number | null;
  inputHash: string;
  evidenceMaxId: number | null;
  completeness: {
    identity: 'complete' | 'needs_resolution';
    domains: Record<ZoningDomain, ZoningWorkflowState>;
    percent: number;
    missing: string[];
  };
  versions: {
    propertyIdentityVersion: number;
    normalizedEvidenceSchema: 'zoning-normalized-v1';
    artifactSchema: 'zoning-artifact-v1';
    analystEngine: 'zoning-analyst-v1';
    snapshotSchema: 'zoning-land-use-snapshot-v1';
  };
  analysis: ZoningAnalysis;
  changeReason: string;
  generatedBy: string;
  createdAt: number;
}

export interface ZoningCorrectionView {
  id: number;
  status: string;
  domain: ZoningDomain;
  priorValue: unknown;
  replacementValue: unknown;
  evidenceRefs: string[];
  reason: string;
  requestedBy: string;
  approvalId: number | null;
  declaredInvalidations: string[];
  requestedAt: number;
  appliedAt: number | null;
}

export interface ZoningReadModel {
  identity: {
    id: number;
    version: number;
    status: string;
    address: string | null;
    city: string | null;
    county: string | null;
    state: string | null;
    apn: string | null;
  };
  snapshot: ZoningSnapshotView | null;
  jobs: ZoningCollectorJobView[];
  domainStates: Record<ZoningDomain, ZoningWorkflowState>;
  artifacts: ZoningArtifactView[];
  evidenceCount: number;
  corrections: ZoningCorrectionView[];
}
