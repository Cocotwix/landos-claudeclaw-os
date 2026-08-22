// LandOS reusable company-knowledge contract.
//
// Evidence says what a source said. Knowledge is the bounded, accepted,
// reusable proposition compiled from that evidence. Parcel/deal state remains
// elsewhere. Keeping all three explicit is the safety boundary of this slice.

export const KNOWLEDGE_DOMAINS = ['jurisdiction', 'property_pattern', 'market'] as const;
export type KnowledgeDomain = (typeof KNOWLEDGE_DOMAINS)[number];

export const KNOWLEDGE_TYPES = ['factual', 'reconciled', 'procedural', 'pattern', 'market'] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

export const KNOWLEDGE_SCOPE_KINDS = [
  'global', 'state', 'jurisdiction', 'market', 'submarket', 'property', 'deal', 'seller', 'contact',
] as const;
export type KnowledgeScopeKind = (typeof KNOWLEDGE_SCOPE_KINDS)[number];

export const KNOWLEDGE_STATUSES = [
  'candidate', 'active', 'conflicting', 'unresolved', 'superseded', 'rejected',
] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export type KnowledgeConfidence = 'confirmed' | 'well_supported' | 'likely' | 'unresolved';
export type KnowledgeSensitivity = 'public' | 'internal' | 'deal_private' | 'seller_private';
export type KnowledgeFreshnessPolicy = 'jurisdiction_procedure' | 'source_locator';
export type KnowledgeReadState = 'CURRENT' | 'STALE' | 'CONFLICTING' | 'UNRESOLVED' | 'SUPERSEDED';

export type KnowledgeEvidenceNamespace =
  | 'property_evidence'
  | 'capability_evidence'
  | 'regulation_document'
  | 'official_site'
  | 'record_artifact'
  | 'market_metric'
  | 'seller_fact';

export interface KnowledgeSupportInput {
  evidenceNamespace: KnowledgeEvidenceNamespace;
  evidenceRef: string;
  role?: 'supports' | 'conflicts' | 'supersedes';
}

export interface KnowledgeCandidateInput {
  domain: KnowledgeDomain;
  knowledgeType: KnowledgeType;
  scopeKind: KnowledgeScopeKind;
  scopeKey: string;
  subjectKey: string;
  statement: string;
  value: unknown;
  sourceAuthority: string;
  confidence: KnowledgeConfidence;
  sensitivity: KnowledgeSensitivity;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  retrievedAt: string;
  lastVerifiedAt: string;
  freshnessPolicy: KnowledgeFreshnessPolicy;
  supports: KnowledgeSupportInput[];
  compilerVersion: string;
  createdBy: string;
  acceptanceReason: string;
}

export interface LandosKnowledgeRecord {
  id: string;
  domain: KnowledgeDomain;
  knowledgeType: KnowledgeType;
  scopeKind: KnowledgeScopeKind;
  scopeKey: string;
  subjectKey: string;
  statement: string;
  value: unknown;
  sourceAuthority: string;
  confidence: KnowledgeConfidence;
  status: KnowledgeStatus;
  sensitivity: KnowledgeSensitivity;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  retrievedAt: string;
  lastVerifiedAt: string;
  freshnessPolicy: KnowledgeFreshnessPolicy;
  freshUntil: string | null;
  supersedesKnowledgeId: string | null;
  disputeGroup: string | null;
  contentHash: string;
  compilerVersion: string;
  createdBy: string;
  acceptanceReason: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSourceAction {
  evidenceNamespace: KnowledgeEvidenceNamespace;
  evidenceRef: string;
  role: 'supports' | 'conflicts' | 'supersedes';
  label: string;
  url: string | null;
  retrievedAt: string | null;
  /** True when the retained evidence row no longer matches the accepted support fingerprint. */
  fingerprintDrifted: boolean;
  /** False when the support row was removed or no longer passes its deterministic admission rule. */
  supportStillAccepted: boolean;
}

export interface KnowledgeReadItem {
  record: LandosKnowledgeRecord;
  state: KnowledgeReadState;
  sources: KnowledgeSourceAction[];
}

export interface KnowledgeReadCounts {
  current: number;
  stale: number;
  conflicting: number;
  unresolved: number;
  superseded: number;
}

export interface KnowledgeReadBundle {
  scopeKind: KnowledgeScopeKind;
  scopeKey: string;
  subjectPrefix: string | null;
  items: KnowledgeReadItem[];
  counts: KnowledgeReadCounts;
  retrievedInMs: number;
  modelCalls: 0;
  researchRuns: 0;
}

export const KNOWLEDGE_PLAN_DECISIONS = [
  'REUSE', 'REFRESH', 'RESEARCH_NEW', 'BLOCKED_CONFLICT',
] as const;
export type KnowledgePlanDecision = (typeof KNOWLEDGE_PLAN_DECISIONS)[number];

export interface ExpectedKnowledgeSubject {
  subjectKey: string;
  label: string;
  providerLane: string;
}

export interface KnowledgeSubjectPlan {
  subjectKey: string;
  label: string;
  decision: KnowledgePlanDecision;
  reason: string;
  knowledgeRecordIds: string[];
  evidenceRefs: string[];
  freshnessState: KnowledgeReadState | 'MISSING' | 'DRIFTED';
  researchAllowed: boolean;
  providerLaneIfNeeded: string | null;
}

export interface KnowledgeResearchPlanCounts {
  expected: number;
  reuse: number;
  refresh: number;
  researchNew: number;
  blockedConflict: number;
}

export interface KnowledgeResearchPlan {
  scopeKey: string;
  subjects: KnowledgeSubjectPlan[];
  counts: KnowledgeResearchPlanCounts;
  researchEligibleSubjectKeys: string[];
  providerLanesEligible: string[];
  providerLanesSkipped: string[];
  constructedInMs: number;
  modelCalls: 0;
}

export type KnowledgeWriteOutcome = 'accepted' | 'reverified' | 'conflicting' | 'superseded' | 'rejected';

export interface KnowledgeWriteResult {
  outcome: KnowledgeWriteOutcome;
  knowledgeId: string | null;
  replacedKnowledgeId: string | null;
  reason: string;
}
