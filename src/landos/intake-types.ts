// LandOS Intake / Main Orchestrator — type contracts.
//
// This file is the contract layer for the LandOS extensible intake foundation.
// It is pure types/enums: no runtime behavior, no DB, no network, no secrets.
//
// Design intent (Architecture correction):
//   Duke is NOT a do-it-all agent. Manual dashboard input, dashboard voice
//   transcripts, Telegram text, Telegram voice transcripts, and future CRM
//   leads all enter the SAME LandOS intake path. The main orchestrator
//   classifies the input, plans the right workers/sub-agents, and returns a
//   unified plan. Property-specific score/value/offer/strategy stays blocked
//   until parcel identity is verified. Market data can never verify a parcel.
//
// These contracts are deliberately extensible: a future department or agent is
// added as registry data + capability declarations, NOT by rewriting the
// intake type. See department-registry.ts and model-router.ts for the data and
// the deterministic selectors that consume these types.

// Sprint 6A: the read-only source-adapter / Market Pulse plan is contributed by
// source-adapters.ts. Imported as a type only (erased at compile) so this
// contract layer stays runtime-free and there is no import cycle.
import type { SourceAdapterPlan } from './source-adapters.js';

// ─────────────────────────────────────────────────────────────────────────
// 4 / 5. Transport-agnostic intake
// ─────────────────────────────────────────────────────────────────────────

/** Every supported entry transport. Voice transcripts are first-class inputs:
 *  a dashboard mic transcript or Telegram voice note becomes text + metadata
 *  and enters the same planner. STT is NOT implemented in this sprint. */
export const INTAKE_TRANSPORTS = [
  'dashboard_text',
  'dashboard_voice_transcript',
  'telegram_text',
  'telegram_voice_transcript',
  'crm_lead',
  'manual_api',
] as const;
export type IntakeTransport = (typeof INTAKE_TRANSPORTS)[number];

/** Source of a voice transcript when transport is a *_voice_transcript. */
export type VoiceTranscriptSource = 'dashboard_mic' | 'telegram_voice' | 'none';

/** Verified facts a caller may attach (e.g. a prior Duke run). The planner does
 *  NOT verify parcels itself (read-only, no LP call). It only reads this. */
export interface IntakeVerifiedContext {
  /** True only when a named, sourced parcel verification already exists. */
  parcelVerified?: boolean;
  /** Free-form verified facts already established for this property. */
  verifiedFacts?: Array<{ fact: string; value?: string; source: string }>;
  /** Known card ids if this intake is attached to an existing card. */
  propertyCardId?: number;
  dealCardId?: number;
}

/** The single normalized intake object. Manual, voice, Telegram, and CRM all
 *  become one of these before the planner runs. */
export interface LandOSIntake {
  transport: IntakeTransport;
  /** Normalized text. For voice transports this is the transcript text. */
  text: string;
  /** Present for *_voice_transcript transports. */
  voiceTranscriptSource?: VoiceTranscriptSource;
  /** Optional explicit response-mode request from the caller. */
  requestedResponseMode?: ResponseMode;
  /** Verified context (never fabricated by the planner). */
  context?: IntakeVerifiedContext;
  /** Optional business entity hint (display only; not required). */
  entityHint?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// 15. Input classification
// ─────────────────────────────────────────────────────────────────────────

export const INTAKE_CLASSIFICATIONS = [
  'parcel_level',
  'area_only_market',
  'seller_discovery',
  'crm_lead',
  'forge_repair',
  'forge_build_interview',
  'agent_knowledge_retrieval',
  'war_room',
  'future_department_route',
  'general_chat',
] as const;
export type IntakeClassification = (typeof INTAKE_CLASSIFICATIONS)[number];

/** How strong the parcel identity in the input is. Used to decide whether Duke
 *  parcel verification is planned and whether Strategy/Underwriting are
 *  blocked. Never derived from coordinates/proximity/visuals. */
export const PARCEL_IDENTITY_CLASSES = [
  'apn_county',
  'full_address',
  'owner_county',
  'lp_url',
  'property_id',
  'property_ambiguous', // address-like but missing county/FIPS
  'street_city_state_only', // area-only; no parcel identity
  'none',
] as const;
export type ParcelIdentityClass = (typeof PARCEL_IDENTITY_CLASSES)[number];

export interface IntakeClassificationResult {
  classification: IntakeClassification;
  parcelIdentity: ParcelIdentityClass;
  /** Short human-readable reason, deterministic. */
  reason: string;
  /** Signals matched during classification (for transparency/tests). */
  matched: string[];
}

// ─────────────────────────────────────────────────────────────────────────
// 14. Worker lane statuses
// ─────────────────────────────────────────────────────────────────────────

export type DukeLaneStatus = 'planned' | 'not_applicable' | 'blocked';
export type MarketResearchStatus = 'planned' | 'not_available' | 'pending';
export type StrategyLaneStatus = 'planned' | 'blocked' | 'pending' | 'not_applicable';
export type UnderwritingLaneStatus = 'planned' | 'blocked' | 'pending' | 'not_applicable';
export type AceLaneStatus = 'planned' | 'not_applicable';
export type PersistenceLaneStatus = 'planned' | 'blocked' | 'pending' | 'not_applicable';
export type VoiceLaneStatus = 'requested' | 'not_requested' | 'not_available';
export type ForgeLaneStatus = 'planned' | 'not_applicable';
export type KnowledgeLaneStatus = 'planned' | 'not_available' | 'not_applicable';
export type CollaborationLaneStatus = 'planned' | 'not_applicable' | 'blocked';
export type FutureCapabilityStatus = 'supported' | 'unsupported';
export type ModelRoutingLaneStatus = 'planned' | 'not_applicable' | 'blocked';

/** One worker lane in the dispatch plan. Carries its own status, a reason, and
 *  its intended model routing decision (cost is shown, not necessarily spent). */
export interface WorkerLane<S extends string = string> {
  lane: string;
  status: S;
  reason: string;
  /** Sub-route / worker hint (e.g. Duke route, Ace mode). */
  route?: string;
  /** Intended task route for this lane (task-oriented work prefers the local/
   *  open-source slot; the concrete model is a facts-based suggestion). */
  modelRouting?: ModelRoutingDecision;
}

// ─────────────────────────────────────────────────────────────────────────
// 6. Response modes (voice intent only — no TTS implemented this sprint)
// ─────────────────────────────────────────────────────────────────────────

export type ResponseMode = 'text_only' | 'text_and_voice_summary' | 'voice_briefing_requested';
export type VoiceStatus = 'not_requested' | 'requested' | 'not_available';

export interface ResponseModePlan {
  responseMode: ResponseMode;
  spokenResponseEligible: boolean;
  voiceStatus: VoiceStatus;
  /** Only populated when a safe summary exists; never fabricated. */
  voiceSummaryText?: string;
  /** Adapter status hooks (12). Detected from code/config structure only. */
  sttProviderStatus: 'not_connected' | 'connected';
  ttsProviderStatus: 'not_connected' | 'connected';
  voiceAdapter: 'not_connected' | 'connected';
}

// ─────────────────────────────────────────────────────────────────────────
// 7. Deal card persistence intent
// ─────────────────────────────────────────────────────────────────────────

/** Every persistence target carries a truth label. Failed/unvalidated info can
 *  only be stored as a gap / attempted lookup / seller-stated / needs-
 *  verification item — NEVER as a verified fact without a named source. */
export type PersistenceLabel =
  | 'verified'
  | 'not_verified'
  | 'seller_stated'
  | 'market_context_only'
  | 'needs_verification';

export interface PersistenceTarget {
  key: string;
  label: PersistenceLabel;
  /** Required for label 'verified'; otherwise optional. */
  source?: string;
  timestamp?: string;
  producedBy?: string;
  note?: string;
}

export interface DealCardPersistencePlan {
  dealCardPersistence: 'planned' | 'not_applicable' | 'blocked' | 'pending';
  dealCardId?: number;
  propertyCardId?: number;
  persistenceTargets: PersistenceTarget[];
  /** Hard rule echoed for callers/tests. */
  rule: string;
}

// ─────────────────────────────────────────────────────────────────────────
// 8. Inter-agent collaboration (distinct from War Room)
// ─────────────────────────────────────────────────────────────────────────

export interface InterAgentCollaborationPlan {
  status: CollaborationLaneStatus;
  collaborationParticipants: string[];
  collaborationPurpose: string;
  allowedHandoffs: Array<{ from: string; to: string; passes: string }>;
  /** Small by default to prevent runaway loops. */
  maxRounds: number;
  requiresTylerApproval: boolean;
  /** True: every collaboration must summarize back to Tyler. */
  collaborationSummaryRequired: boolean;
  outputOwner: string;
  blockedReason?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// 9. Strategy ⇄ Underwriting feedback loop
// ─────────────────────────────────────────────────────────────────────────

export const EXIT_STRATEGIES = [
  'quick_flip',
  'subdivide',
  'land_home_package',
  'improved_property_value_add',
  'teardown_land_only',
  'neighbor_sale',
  'owner_finance',
  'pass_no_offer',
] as const;
export type ExitStrategy = (typeof EXIT_STRATEGIES)[number];

export interface StrategyCandidate {
  strategy: ExitStrategy;
  rationale: string;
}

export interface UnderwritingResult {
  strategy: ExitStrategy;
  /** Whether the math supports the strategy. */
  result: 'pass' | 'fail' | 'blocked';
  reason: string;
}

export interface StrategyUnderwritingPlan {
  strategyStatus: StrategyLaneStatus;
  underwritingStatus: UnderwritingLaneStatus;
  strategyCandidates: StrategyCandidate[];
  underwritingResults: UnderwritingResult[];
  rejectedStrategies: Array<{ strategy: ExitStrategy; reasonRejected: string }>;
  finalStrategyStatus: 'recommended' | 'pass_no_offer' | 'blocked' | 'pending';
  /** The winning strategy — never one that failed underwriting. */
  recommendedStrategy?: ExitStrategy;
  /** Facts still required before a responsible recommendation can be made. */
  missingFactsBlockingDecision: string[];
  /** Feedback-loop note describing the Strategy↔Underwriting handshake. */
  feedbackLoopNote: string;
}

// ─────────────────────────────────────────────────────────────────────────
// 10. Agent knowledge / training retrieval (architecture hooks only)
// ─────────────────────────────────────────────────────────────────────────

export const KNOWLEDGE_SOURCE_TYPES = [
  'raw_training_source',
  'transcript_staging',
  'training_candidate',
  'approved_playbook',
  'processed_obsidian',
] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

export interface TrainingCorpusRef {
  /** Lightweight pointer only. Raw media/large files stay in OneDrive/cloud. */
  label: string;
  sourceType: KnowledgeSourceType;
  /** A path/URL reference. Never the file content; never written into repo. */
  ref?: string;
  /** True only after Tyler's curation/approval layer promotes it. */
  approved: boolean;
}

export interface AgentKnowledgeRequest {
  agentId: string;
  query: string;
  /** Which corpora the agent is asking to retrieve from. */
  sourceTypes: KnowledgeSourceType[];
}

export interface AgentKnowledgeResult {
  status: KnowledgeLaneStatus;
  /** Retrieved items, each with source/confidence/timestamp/approval status. */
  items: Array<{
    text: string;
    source: string;
    sourceType: KnowledgeSourceType;
    confidence: number;
    timestamp?: string;
    approved: boolean;
  }>;
  reason: string;
}

export interface AgentKnowledgeRetrievalPlan {
  status: KnowledgeLaneStatus;
  request?: AgentKnowledgeRequest;
  reason: string;
  /** Private-data boundary echoed for callers/tests. */
  privateDataBoundary: string;
}

// ─────────────────────────────────────────────────────────────────────────
// 11. Storage / private-data boundary
// ─────────────────────────────────────────────────────────────────────────

export interface StoragePlan {
  /** Raw media + large training files live in OneDrive/cloud, NOT the repo. */
  rawMediaLocation: 'onedrive_or_cloud';
  /** Repo holds code/schemas/contracts/safe docs only. */
  repoContainsRawTraining: false;
  /** Obsidian holds curated processed knowledge only. */
  obsidianContent: 'curated_processed_only';
  /** Optional/bounded vector cache, off by default. */
  vectorStore: 'optional_bounded_disabled';
  note: string;
}

// ─────────────────────────────────────────────────────────────────────────
// 13. Future agent / department capability declarations
// ─────────────────────────────────────────────────────────────────────────

export type AgentLifecycleStatus = 'operational' | 'shell' | 'planned' | 'retired';

/** What a worker can do — declared, not hard-coded into the planner. */
export interface WorkerCapability {
  id: string;
  label: string;
  /** Input keys the worker requires to run. */
  requiredInputs: string[];
  /** Conditions under which the worker is blocked. */
  blockedConditions: string[];
  canRunAsync: boolean;
  canCollaborate: boolean;
  canWriteDealCard: boolean;
  requiresTylerApprovalForRisk: boolean;
  /** Paid API / external system / CRM mutation / private data access flags. */
  canUsePaidApis: boolean;
  canMutateCrm: boolean;
  canAccessPrivateData: boolean;
  /** Output types and persistence rules. */
  outputTypes: string[];
  modelPolicy: WorkerModelPolicy;
}

export interface AgentCapability extends WorkerCapability {
  /** Web/browsing requirement for this agent's primary job. */
  requiresWebBrowsing: boolean;
}

export interface AgentPermissionProfile {
  agentId: string;
  canWriteDealCard: boolean;
  canMutateCrm: boolean;
  canUsePaidApis: boolean;
  canDeleteFiles: boolean;
  canCommitOrPush: boolean;
  canReadSecrets: boolean; // always false in practice
  requiresApprovalFor: string[];
}

export interface AgentKnowledgeProfile {
  agentId: string;
  corpora: TrainingCorpusRef[];
}

export interface AgentOutputContract {
  agentId: string;
  outputTypes: string[];
  /** Persistence rules per output type. */
  persistenceRules: Array<{ outputType: string; defaultLabel: PersistenceLabel }>;
}

export interface AgentRegistryEntry {
  agentId: string;
  name: string;
  role: string;
  departmentId: string;
  lifecycle: AgentLifecycleStatus;
  capability: AgentCapability;
  permissions: AgentPermissionProfile;
  knowledge?: AgentKnowledgeProfile;
  output?: AgentOutputContract;
  modelPolicy: AgentModelPolicy;
}

export interface IntakeRouteRule {
  /** Classification this rule maps to. */
  classification: IntakeClassification;
  /** Department that owns the classification. */
  departmentId: string;
  /** Whether the rule is dispatch-eligible right now. */
  eligibility: DispatchEligibility;
}

export type DispatchEligibility = 'eligible' | 'shell_only' | 'blocked';

export interface DepartmentCapability {
  departmentId: string;
  /** Whether the department can actually run work now (operational) or is a
   *  registered shell awaiting buildout. */
  operational: boolean;
  capabilities: string[];
}

export interface DepartmentBuildoutInterviewPlan {
  departmentId: string;
  /** Topics Tyler is interviewed on to build the department out later. */
  topics: string[];
}

export interface DepartmentModelPolicy {
  departmentId: string;
  defaultRoute: TaskRoute;
  escalationRoute?: TaskRoute;
  /** Configured default model id: a plain default at the BOTTOM of the
   *  resolution order, not a ranking. Task-oriented departments default to the
   *  local/open-source slot. */
  defaultModelId?: string;
  maxTokenBudget?: number;
}

export interface DepartmentRegistryEntry {
  id: string;
  label: string;
  lifecycle: AgentLifecycleStatus;
  description: string;
  capability: DepartmentCapability;
  agents: AgentRegistryEntry[];
  buildoutInterview: DepartmentBuildoutInterviewPlan;
  modelPolicy: DepartmentModelPolicy;
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Model routing / cost-control policy (neutral, facts-based)
// ─────────────────────────────────────────────────────────────────────────

/** How a task is routed, expressed as objective facts — NOT a quality ladder.
 *  'deterministic_code' means NO LLM is used (parsing/calculation in code).
 *  'task_oriented' vs 'reasoning_oriented' is the KIND of work, never a ranking.
 *  'web_capable' / 'long_context' are capability requirements.
 *  'local_open_source' names the local/open-source slot.
 *  'approval_required' is a gate, not a model. New models slot onto these routes
 *  by registry facts without code rewrites; no route implies a "better" model. */
export const TASK_ROUTES = [
  'deterministic_code',
  'task_oriented',
  'reasoning_oriented',
  'web_capable',
  'long_context',
  'local_open_source',
  'approval_required',
] as const;
export type TaskRoute = (typeof TASK_ROUTES)[number];

/** The KIND of work a task is. Drives the facts-based default suggestion,
 *  never a quality ranking. */
export type TaskOrientation = 'task_oriented' | 'reasoning_oriented';

/** Optional capability/role aliases. Not vendor-locked; resolved from config. */
export const MODEL_ALIASES = [
  'local_open_source',
  'web_research',
  'forge_diagnostics',
] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

export type TokenBudgetClass = 'tiny' | 'small' | 'medium' | 'large' | 'xlarge';

export interface ModelCapabilityRequirement {
  needsWebBrowsing: boolean;
  needsLongContext: boolean;
  /** Deterministic code task: no LLM route needed. */
  deterministic: boolean;
  /** The KIND of cognition the task is, not how "good" a model must be. */
  orientation: TaskOrientation;
}

export interface ModelSelectionReason {
  /** Primary driver of the tier choice. */
  driver: string;
  /** Human-readable explanation. */
  detail: string;
}

export interface ModelEscalationRule {
  allowed: boolean;
  /** Route to move to when a real trigger fires. MUST differ from the base
   *  route (an orientation change, or 'approval_required') — escalation never
   *  no-ops into the same route. */
  toRoute?: TaskRoute;
  /** A reason is REQUIRED whenever escalation is taken. */
  reason?: string;
  requiresTylerApproval: boolean;
}

export interface TokenBudgetPolicy {
  budgetClass: TokenBudgetClass;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

export interface CostBudgetPolicy {
  /** Soft ceiling per task in USD; advisory for the router. */
  maxUsdPerTask?: number;
  /** Whether exceeding the ceiling requires Tyler approval. */
  approvalOverBudget: boolean;
}

export interface ModelUsageEstimate {
  budgetClass: TokenBudgetClass;
  /** Coarse estimate only; never a billed call. */
  estInputTokens?: number;
  estOutputTokens?: number;
}

export interface ModelFallbackPolicy {
  /** Route to fall back to if the chosen route/model is unavailable. */
  fallbackRoute: TaskRoute;
  /** If true and nothing is available, return not_available — never fake it. */
  blockIfUnavailable: boolean;
}

export interface AgentModelPolicy {
  agentId: string;
  defaultRoute: TaskRoute;
  escalation: ModelEscalationRule;
  maxTokenBudget?: number;
  /** Paid API / web requirement gating stays SEPARATE from route selection. */
  paidApiRequiresApproval: boolean;
}

export interface WorkerModelPolicy {
  workerId: string;
  defaultRoute: TaskRoute;
  escalation: ModelEscalationRule;
  /** True when the worker's job is deterministic (prefers code over an LLM). */
  deterministicPreferred: boolean;
}

/** The output of the deterministic model router for a single task. */
export interface ModelRoutingDecision {
  route: TaskRoute;
  alias?: ModelAlias;
  reason: ModelSelectionReason;
  escalation: ModelEscalationRule;
  tokenBudget: TokenBudgetPolicy;
  costBudget: CostBudgetPolicy;
  usageEstimate: ModelUsageEstimate;
  fallback: ModelFallbackPolicy;
  /** Paid API/tool gating stays separate from route selection. */
  paidApiGated: boolean;
  /** If a required model/tool is unavailable: report it, never fake success. */
  availability: 'available' | 'not_available' | 'blocked';
}

export interface ModelRouterPolicy {
  /** Task-oriented work defaults to the local/open-source slot (a cost/privacy/
   *  local-runtime rule, never a quality ranking). */
  preferLocalOpenSourceForTaskOriented: true;
  /** Deterministic tasks never select an LLM route. */
  deterministicUsesCode: true;
  /** Model routing must never override hard safety rules. */
  safetyOverridesRouting: true;
  /** Every suggestion is overridable by the user (sticky). */
  suggestionsOverridable: true;
  routes: readonly TaskRoute[];
  aliases: readonly ModelAlias[];
}

// ─────────────────────────────────────────────────────────────────────────
// Operational DD capability status (3)
// ─────────────────────────────────────────────────────────────────────────

export interface DueDiligenceCapabilityStatus {
  operational: boolean;
  dukeActive: boolean;
  /** Existing guarantees preserved. */
  preserves: string[];
  /** Local market lane honesty. */
  marketResearch: MarketResearchStatus;
  marketResearchReason: string;
}

// ─────────────────────────────────────────────────────────────────────────
// 16. The unified Worker Dispatch Plan returned by the read-only route
// ─────────────────────────────────────────────────────────────────────────

export interface WorkerDispatchPlan {
  intake: LandOSIntake;
  classification: IntakeClassificationResult;

  // Worker lanes (14)
  dukeParcelVerification: WorkerLane<DukeLaneStatus>;
  marketResearch: WorkerLane<MarketResearchStatus>;
  strategy: WorkerLane<StrategyLaneStatus>;
  underwriting: WorkerLane<UnderwritingLaneStatus>;
  aceDiscoveryPrep: WorkerLane<AceLaneStatus>;
  dealCardPersistence: WorkerLane<PersistenceLaneStatus>;
  voiceResponse: WorkerLane<VoiceLaneStatus>;
  forgeRepair: WorkerLane<ForgeLaneStatus>;
  forgeBuildInterview: WorkerLane<ForgeLaneStatus>;
  agentKnowledgeRetrieval: WorkerLane<KnowledgeLaneStatus>;
  interAgentCollaboration: WorkerLane<CollaborationLaneStatus>;
  futureDepartmentCapability: WorkerLane<FutureCapabilityStatus>;
  modelRouting: WorkerLane<ModelRoutingLaneStatus>;

  // Detailed plans
  responseModePlan: ResponseModePlan;
  dealCardPersistencePlan: DealCardPersistencePlan;
  strategyUnderwritingPlan: StrategyUnderwritingPlan;
  interAgentCollaborationPlan: InterAgentCollaborationPlan;
  agentKnowledgeRetrievalPlan: AgentKnowledgeRetrievalPlan;
  storagePlan: StoragePlan;
  dueDiligenceCapability: DueDiligenceCapabilityStatus;

  /** Department registry summary + extensibility plan. */
  departmentRegistrySummary: Array<{ id: string; label: string; lifecycle: AgentLifecycleStatus; operational: boolean }>;
  extensibilityNote: string;

  /** Sprint 6A: read-only source-adapter registry + Market Pulse contract.
   *  Source readiness, on-demand scope, parcel fallback ladder, LandPortal
   *  failure fallback, GIS cutoff rule, Market Pulse eligibility (separate from
   *  parcel verification), seller-ask context, and open-source security status. */
  sourceAdapter: SourceAdapterPlan;

  /** No live agent execution; no DB writes; no fake market data. */
  executionMode: 'read_only_plan';
}
