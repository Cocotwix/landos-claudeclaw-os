// LandOS Property Intelligence Contract — canonical, system-wide.
//
// This file is the permanent machine-readable standard. Every research worker
// (API adapter, deterministic adapter, Kilo, Codex, Claude Code, Browser Use,
// Hermes, or future agent) MUST consume this contract or the shared services
// that implement it. An individual agent must never independently redefine
// what "complete research" means.

export type ResearchStageId =
  | 'parcel_identity'
  | 'deed_ownership'
  | 'official_gis'
  | 'assessor_tax'
  | 'county_records'
  | 'wetlands'
  | 'fema_flood'
  | 'slope_topography'
  | 'soils_septic'
  | 'road_frontage_access'
  | 'utilities'
  | 'zoning_landuse'
  | 'imagery'
  | 'marketplace_comps'
  | 'land_portal'
  | 'valuation_synthesis';

export type ResearchStageRole = 'required' | 'conditional' | 'optional';
export type ResearchProviderRequirementLevel = 'required' | 'optional' | 'conditional';
export type CompletionState = 'complete' | 'partial' | 'blocked' | 'no_result' | 'not_applicable' | 'not_attempted';

/**
 * The provider-facing result vocabulary.  This is deliberately smaller than
 * the orchestration vocabulary: an adapter either verified subject evidence,
 * returned explicitly labelled context, did not apply, was unavailable, or
 * failed.  Merely attempting an action is never a successful provider result.
 */
export type PropertyProviderStatus =
  | 'verified'
  | 'context_only'
  | 'not_applicable'
  | 'unavailable'
  // A lane that exceeded its own budget. Distinct from `failed`: the provider
  // did not answer wrongly, it did not answer in time, which is an operational
  // state the operator can act on (retry, widen the budget) rather than a
  // defect in the evidence. Recording it as `failed` hid every hang.
  | 'timed_out'
  // The provider refused or challenged the request (access control, CAPTCHA,
  // rate limit). LandOS never circumvents these; it records the state and the
  // rest of the workflow continues without this lane.
  | 'blocked'
  | 'failed';

/**
 * Did this lane end without producing a usable handback?
 *
 * `timed_out` and `blocked` were previously folded into `failed`, so every
 * consumer that asked `status === 'failed'` silently stopped seeing them the
 * moment they became distinct — and a hung LandPortal capture quietly lost the
 * "continues independently" explanation the operator reads. Splitting the
 * vocabulary is only safe if the consumers ask this question instead.
 */
export function isProviderLaneError(status: PropertyProviderStatus): boolean {
  return status === 'failed' || status === 'timed_out' || status === 'blocked';
}

export type PropertySubjectClassification = 'verified_subject' | 'context_only' | 'no_match';

export type PropertyEvidenceStrength =
  | 'operator_accepted'
  | 'official_record'
  | 'provider_verified'
  | 'provider_observed'
  | 'context_only';

export interface CanonicalPropertyInput {
  /** Stable technical scope. A provider may never change it. */
  propertyCardId: number;
  dealCardId: number;
  /** Normalized address is retained even after APN/property IDs become known. */
  normalizedAddress: string;
  address: string;
  city: string | null;
  county: string | null;
  state: string | null;
  zip: string | null;
  apn: string | null;
  fips: string | null;
  landPortalPropertyId: string | null;
}

export interface NormalizedPropertyEvidence {
  id: string;
  propertyCardId: number;
  dealCardId: number;
  providerId: string;
  field: string;
  value: unknown;
  subjectClassification: PropertySubjectClassification;
  strength: PropertyEvidenceStrength;
  sourceUrl: string | null;
  retrievedAt: string;
  confidence: 'high' | 'medium' | 'low';
  kind: 'fact' | 'visual' | 'comp' | 'estimate' | 'status';
  validation: {
    valid: boolean;
    reasons: string[];
  };
  artifactHash?: string | null;
  viewUrl?: string | null;
}

export interface PropertyProviderValidationResult {
  valid: boolean;
  subjectClassification: PropertySubjectClassification;
  checks: Array<{ check: string; passed: boolean; reason: string }>;
  rejectedEvidenceIds: string[];
}

export interface PropertyProviderPersistenceResult {
  attempted: boolean;
  persisted: boolean;
  retainedEvidenceCount: number;
  rejectedEvidenceCount: number;
  reason: string | null;
}

/** Common deterministic adapter handback used by every provider lane. */
export interface PropertyProviderResult<TExecution = unknown> {
  contractVersion: 'property-provider-v1';
  runId: string;
  laneId: string;
  providerId: string;
  input: CanonicalPropertyInput;
  execution: {
    attempted: boolean;
    startedAt: string;
    completedAt: string;
    durationMs: number;
    result: TExecution | null;
  };
  validation: PropertyProviderValidationResult;
  evidence: NormalizedPropertyEvidence[];
  status: PropertyProviderStatus;
  persistence: PropertyProviderPersistenceResult;
  failureReason: string | null;
}

export interface PropertyProviderAdapter<TExecution = unknown> {
  laneId: string;
  providerId: string;
  execute(input: CanonicalPropertyInput): Promise<TExecution>;
  validate(input: CanonicalPropertyInput, execution: TExecution): PropertyProviderValidationResult;
  normalize(
    input: CanonicalPropertyInput,
    execution: TExecution,
    validation: PropertyProviderValidationResult,
  ): NormalizedPropertyEvidence[];
  status(
    input: CanonicalPropertyInput,
    execution: TExecution,
    validation: PropertyProviderValidationResult,
    evidence: NormalizedPropertyEvidence[],
  ): PropertyProviderStatus;
}

function providerFailureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Marker so a timeout is recorded as `timed_out`, never as a generic failure. */
class ProviderTimeoutError extends Error {
  readonly timedOut = true;
  constructor(timeoutMs: number) { super(`Provider lane timed out after ${timeoutMs} ms.`); }
}

/** A provider refusal/challenge (access control, CAPTCHA, rate limit). */
const BLOCKED_PATTERNS = /\b(?:captcha|403|401 unauthorized|429|rate limit|access denied|forbidden|blocked by|bot detection|challenge)\b/i;

function isTimeout(error: unknown): boolean {
  return (error as { timedOut?: boolean } | null)?.timedOut === true
    || (error as { name?: string } | null)?.name === 'TimeoutError';
}

/**
 * DEFAULT LANE BUDGET.
 *
 * Every provider lane must reach a terminal state. Lanes that passed no
 * `timeoutMs` previously got `return promise` — an unbounded await — and a
 * single hung authenticated LandPortal read then stalled the comparables
 * outcome, the coverage cycle, the execution-lock release and, with `wait:true`,
 * the HTTP response itself. An explicit budget is now the floor, not an opt-in.
 *
 * The value deliberately MATCHES the comparables mission-child budget in
 * `deal-intelligence-mission.ts`. The same lane run through the mission graph
 * has always been abandoned at 15 minutes; the focused rerun path bypasses the
 * graph, so it inherited no bound at all. Matching that number bounds the hang
 * without shortening any lane that already succeeds under governance — the
 * focused path simply stops being able to outlive the governed one.
 */
export const DEFAULT_PROVIDER_LANE_TIMEOUT_MS = 900_000;

async function settleProviderWithin<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  const budget = timeoutMs && timeoutMs > 0 ? timeoutMs : DEFAULT_PROVIDER_LANE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ProviderTimeoutError(budget)), budget);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Execute one provider deterministically and always return the full adapter
 * contract. Throws are converted to `failed`; they never masquerade as an empty
 * success and never prevent an independent lane from settling.
 */
export async function executePropertyProvider<TExecution>(input: {
  runId: string;
  property: CanonicalPropertyInput;
  adapter: PropertyProviderAdapter<TExecution>;
  now?: () => string;
  clockMs?: () => number;
  timeoutMs?: number;
}): Promise<PropertyProviderResult<TExecution>> {
  const now = input.now ?? (() => new Date().toISOString());
  const clockMs = input.clockMs ?? (() => Date.now());
  const startedAt = now();
  const startedMs = clockMs();
  try {
    const execution = await settleProviderWithin(input.adapter.execute(input.property), input.timeoutMs);
    const validation = input.adapter.validate(input.property, execution);
    const normalized = input.adapter.normalize(input.property, execution, validation);
    const evidence = normalized.filter((item) => item.validation.valid);
    const status = input.adapter.status(input.property, execution, validation, evidence);
    return {
      contractVersion: 'property-provider-v1',
      runId: input.runId,
      laneId: input.adapter.laneId,
      providerId: input.adapter.providerId,
      input: input.property,
      execution: {
        attempted: true,
        startedAt,
        completedAt: now(),
        durationMs: Math.max(0, clockMs() - startedMs),
        result: execution,
      },
      validation,
      evidence,
      status: validation.valid ? status : 'failed',
      persistence: {
        attempted: false,
        persisted: false,
        retainedEvidenceCount: 0,
        rejectedEvidenceCount: normalized.length - evidence.length,
        reason: null,
      },
      failureReason: validation.valid ? null : validation.checks.filter((check) => !check.passed).map((check) => check.reason).join(' ') || 'Provider validation failed.',
    };
  } catch (error) {
    const completedAt = now();
    const reason = providerFailureReason(error);
    return {
      contractVersion: 'property-provider-v1',
      runId: input.runId,
      laneId: input.adapter.laneId,
      providerId: input.adapter.providerId,
      input: input.property,
      execution: {
        attempted: true,
        startedAt,
        completedAt,
        durationMs: Math.max(0, clockMs() - startedMs),
        result: null,
      },
      validation: {
        valid: false,
        subjectClassification: 'no_match',
        checks: [{ check: 'execution_completed', passed: false, reason }],
        rejectedEvidenceIds: [],
      },
      evidence: [],
      // An honest terminal state. A lane that ran out of budget or was refused
      // by the provider is neither a verified answer nor a defect in LandOS;
      // collapsing all three into `failed` is what made every hang look like a
      // provider bug and hid the unbounded await underneath.
      status: isTimeout(error) ? 'timed_out' : BLOCKED_PATTERNS.test(reason) ? 'blocked' : 'failed',
      persistence: {
        attempted: false,
        persisted: false,
        retainedEvidenceCount: 0,
        rejectedEvidenceCount: 0,
        reason: null,
      },
      failureReason: reason,
    };
  }
}

export function validatePropertyProviderResult(result: PropertyProviderResult): string[] {
  const violations: string[] = [];
  if (result.contractVersion !== 'property-provider-v1') violations.push('unsupported provider contract version');
  if (!Number.isInteger(result.input.propertyCardId) || result.input.propertyCardId < 1) violations.push('invalid property card scope');
  if (!Number.isInteger(result.input.dealCardId) || result.input.dealCardId < 1) violations.push('invalid deal card scope');
  if (!result.execution.attempted && (result.status === 'verified' || result.status === 'context_only')) {
    violations.push('an unattempted action cannot be a successful result');
  }
  if (result.status === 'verified' && result.validation.subjectClassification !== 'verified_subject') {
    violations.push('verified status requires verified_subject classification');
  }
  for (const item of result.evidence) {
    if (item.propertyCardId !== result.input.propertyCardId || item.dealCardId !== result.input.dealCardId) {
      violations.push(`evidence ${item.id} belongs to a different property scope`);
    }
    if (!item.validation.valid) violations.push(`rejected evidence ${item.id} cannot enter normalized evidence`);
    if (item.subjectClassification === 'no_match') violations.push(`no-match evidence ${item.id} cannot enter normalized evidence`);
  }
  return violations;
}

export type CompletionPredicate =
  | { kind: 'always' }
  | { kind: 'resolution_status_in'; values: Array<'confirmed' | 'provisional' | 'conflicted' | 'unresolved'> }
  | {
      kind: 'task_status_in';
      values: Array<'succeeded' | 'partial' | 'unavailable' | 'blocked' | 'failed' | 'timed_out' | 'skipped_identity_gate'>;
      requireEvidence?: boolean;
      findingKind?: 'county_records' | 'wetlands' | 'fema_flood' | 'soils_septic' | 'slope_topography' | 'road_frontage' | 'utilities' | 'zoning_landuse' | 'imagery' | 'marketplace_confirmation' | 'land_portal';
    };

export interface ResearchProviderRequirement {
  providerId: string;
  level: ResearchProviderRequirementLevel;
  sourceAttempts: string[];
}

export interface CompletionRule {
  state: CompletionState;
  label: string;
  when: CompletionPredicate;
  operatorMessage: string;
  blocksDownstream: boolean;
}

export interface EscalationRule {
  trigger: string;
  action: 'retry' | 'fallback_provider' | 'browser_agent' | 'operator_review' | 'mark_blocked' | 'expand_search';
  maxAttempts: number;
}

export interface ConflictHandlingRule {
  preserveAllCandidates: boolean;
  reconcileByEvidenceStrength: boolean;
  operatorDisputeVisible: boolean;
  consolidatedSearchAllowed: boolean;
  dualBasisSearchTrigger: string;
}

export interface OperatorMessages {
  notAttempted: string;
  inProgress: string;
  complete: string;
  partial: string;
  blocked: string;
  noResult: string;
  notApplicable: string;
  missingItem: string;
}

export interface EvidenceRequirement {
  minEvidenceItems: number;
  requiredFields: string[];
  acceptableSourceTiers: string[];
  sourceUrlRequired: boolean;
  captureRequired: boolean;
}

export interface StageFastPath {
  enabled: boolean;
  fastProviders: string[];
  minimumOutput: string[];
}

export interface LearningRequirement {
  persistWorkflow: boolean;
  captureFields: string[];
}

export interface ResearchStage {
  id: ResearchStageId;
  label: string;
  legacyTaskKind?: string;
  role: ResearchStageRole;
  dependsOn: ResearchStageId[];
  blocking: boolean;
  timeoutMs: number;
  providers: ResearchProviderRequirement[];
  requiredOutputs: string[];
  evidenceRequirements: EvidenceRequirement;
  completionRules: CompletionRule[];
  escalationRules: EscalationRule[];
  conflictHandling: ConflictHandlingRule;
  operatorMessages: OperatorMessages;
  fastPath: StageFastPath;
  learning: LearningRequirement;
  condition?: string;
}

export interface PropertyIntelligenceContract {
  version: string;
  stages: ResearchStage[];
  parallelPolicy: {
    maxConcurrency: number;
    concurrentBatches: ResearchStageId[][];
    maxRunMs: number;
    firstResultTargetMs: number;
  };
  evidencePolicy: {
    sourceUrlRequired: boolean;
    timestampRequired: boolean;
    confidenceRequired: boolean;
    captureModeRequired: boolean;
  };
  storagePolicy: {
    persistRun: boolean;
    persistEvidence: boolean;
    persistConflicts: boolean;
    persistLearning: boolean;
  };
}

export function evaluateCompletionPredicate(predicate: CompletionPredicate, context: Record<string, unknown>): boolean {
  if (predicate.kind === 'always') return true;
  if (predicate.kind === 'resolution_status_in') {
    return predicate.values.includes(context.resolutionStatus as never);
  }
  if (!predicate.values.includes(context.status as never)) return false;
  if (predicate.requireEvidence) {
    const evidence = Array.isArray(context.evidence) ? context.evidence : [];
    if (evidence.length === 0) return false;
  }
  if (predicate.findingKind) {
    const finding = context.finding as Record<string, unknown> | null | undefined;
    if (!finding || finding.kind !== predicate.findingKind) return false;
  }
  return true;
}

export function evaluateStageCompletion(stage: ResearchStage, output: unknown): CompletionState {
  const ctx = (output ?? {}) as Record<string, unknown>;
  for (const rule of stage.completionRules) {
    if (evaluateCompletionPredicate(rule.when, ctx)) {
      return rule.state;
    }
  }
  return 'no_result';
}

function valueAtPath(record: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, segment) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[segment];
  }, record);
}

function hasRequiredValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export const PROPERTY_INTELLIGENCE_CONTRACT: PropertyIntelligenceContract = {
  version: '1.0.0',
  stages: [
    {
      id: 'parcel_identity',
      label: 'Parcel identity',
      role: 'required',
      dependsOn: [],
      blocking: true,
      timeoutMs: 60_000,
      providers: [{ providerId: 'parcel-resolution-engine', level: 'required', sourceAttempts: ['realie', 'county_records_browser', 'land_portal'] }],
      requiredOutputs: ['resolvedApn', 'resolutionStatus', 'normalizedAddress'],
      evidenceRequirements: { minEvidenceItems: 1, requiredFields: ['sourceUrl'], acceptableSourceTiers: ['approved_parcel_provider', 'official_county_state'], sourceUrlRequired: true, captureRequired: true },
      completionRules: [
        { state: 'complete', label: 'Identity confirmed', when: { kind: 'resolution_status_in', values: ['confirmed'] }, operatorMessage: 'Parcel identity is confirmed; property intelligence may proceed.', blocksDownstream: false },
        { state: 'blocked', label: 'Identity blocked', when: { kind: 'resolution_status_in', values: ['conflicted', 'unresolved'] }, operatorMessage: 'Parcel evidence conflicts or is unresolved. Resolve identity before downstream research.', blocksDownstream: true },
        { state: 'partial', label: 'Identity provisional', when: { kind: 'resolution_status_in', values: ['provisional'] }, operatorMessage: 'Parcel identity is provisional; downstream research may proceed with caution.', blocksDownstream: false },
      ],
      escalationRules: [{ trigger: 'identity_conflict', action: 'operator_review', maxAttempts: 2 }],
      conflictHandling: { preserveAllCandidates: true, reconcileByEvidenceStrength: true, operatorDisputeVisible: true, consolidatedSearchAllowed: true, dualBasisSearchTrigger: 'apn_hard_conflict' },
      operatorMessages: { notAttempted: 'Parcel identity has not been evaluated.', inProgress: 'Resolving parcel identity...', complete: 'Parcel identity confirmed.', partial: 'Parcel identity is provisional.', blocked: 'Parcel identity is blocked.', noResult: 'No parcel identity result.', notApplicable: 'N/A', missingItem: 'Missing parcel identity evidence.' },
      fastPath: { enabled: true, fastProviders: ['realie'], minimumOutput: ['resolvedApn', 'normalizedAddress'] },
      learning: { persistWorkflow: true, captureFields: ['resolvedApn', 'resolutionStatus', 'resolutionExplanation'] },
    },
    {
      id: 'county_records',
      label: 'Official county records',
      legacyTaskKind: 'county_records',
      role: 'required',
      dependsOn: ['parcel_identity'],
      blocking: false,
      timeoutMs: 30_000,
      providers: [{ providerId: 'official_parcel_record_full_v2', level: 'required', sourceAttempts: ['county_gis', 'assessor_portal'] }],
      requiredOutputs: ['facts', 'accessState'],
      evidenceRequirements: { minEvidenceItems: 1, requiredFields: ['sourceUrl', 'sourceName'], acceptableSourceTiers: ['official_county_state', 'recorded_or_approved_legal'], sourceUrlRequired: true, captureRequired: true },
      completionRules: [
        { state: 'complete', label: 'Records retrieved', when: { kind: 'task_status_in', values: ['succeeded'], requireEvidence: true }, operatorMessage: 'Official county records retrieved.', blocksDownstream: false },
        { state: 'partial', label: 'Partial records', when: { kind: 'task_status_in', values: ['partial'], requireEvidence: true }, operatorMessage: 'Some county facts were retrieved but the record is incomplete.', blocksDownstream: false },
        { state: 'blocked', label: 'Records blocked', when: { kind: 'task_status_in', values: ['blocked'] }, operatorMessage: 'County records access is blocked.', blocksDownstream: false },
        { state: 'no_result', label: 'No records', when: { kind: 'task_status_in', values: ['unavailable', 'failed', 'timed_out'] }, operatorMessage: 'County records could not be retrieved.', blocksDownstream: false },
      ],
      escalationRules: [{ trigger: 'records_unavailable', action: 'fallback_provider', maxAttempts: 2 }],
      conflictHandling: { preserveAllCandidates: true, reconcileByEvidenceStrength: true, operatorDisputeVisible: true, consolidatedSearchAllowed: false, dualBasisSearchTrigger: 'acreage_conflict' },
      operatorMessages: { notAttempted: 'County records have not been retrieved.', inProgress: 'Retrieving official county records...', complete: 'Official county records retrieved.', partial: 'Partial county records retrieved.', blocked: 'County records access is blocked.', noResult: 'No county records available.', notApplicable: 'N/A', missingItem: 'Missing county record evidence.' },
      fastPath: { enabled: true, fastProviders: ['official_parcel_record_full_v2'], minimumOutput: ['facts', 'accessState'] },
      learning: { persistWorkflow: true, captureFields: ['facts', 'accessState', 'summary'] },
    },
    {
      id: 'wetlands',
      label: 'Wetlands screening',
      legacyTaskKind: 'wetlands',
      role: 'required',
      dependsOn: ['parcel_identity'],
      blocking: false,
      timeoutMs: 45_000,
      providers: [{ providerId: 'county_wetlands_exact_overlap_v1', level: 'required', sourceAttempts: ['county_gis'] }, { providerId: 'usfws_nwi_grid_overlay_v3', level: 'conditional', sourceAttempts: ['usfws_nwi'] }],
      requiredOutputs: ['finding', 'evidence'],
      evidenceRequirements: { minEvidenceItems: 1, requiredFields: ['sourceUrl'], acceptableSourceTiers: ['official_county_state', 'authoritative_federal'], sourceUrlRequired: true, captureRequired: true },
      completionRules: [
        { state: 'complete', label: 'Wetlands screened', when: { kind: 'task_status_in', values: ['succeeded'], findingKind: 'wetlands' }, operatorMessage: 'Wetlands screening completed.', blocksDownstream: false },
        { state: 'partial', label: 'Partial wetlands data', when: { kind: 'task_status_in', values: ['partial'] }, operatorMessage: 'Wetlands data is partial.', blocksDownstream: false },
        { state: 'no_result', label: 'No wetlands data', when: { kind: 'task_status_in', values: ['unavailable', 'failed', 'timed_out'] }, operatorMessage: 'Wetlands screening could not be completed.', blocksDownstream: false },
      ],
      escalationRules: [{ trigger: 'wetlands_timeout', action: 'fallback_provider', maxAttempts: 2 }],
      conflictHandling: { preserveAllCandidates: true, reconcileByEvidenceStrength: true, operatorDisputeVisible: true, consolidatedSearchAllowed: true, dualBasisSearchTrigger: 'wetland_boundary_conflict' },
      operatorMessages: { notAttempted: 'Wetlands screening has not been run.', inProgress: 'Running wetlands screening...', complete: 'Wetlands screening completed.', partial: 'Wetlands data is partial.', blocked: 'Wetlands screening is blocked.', noResult: 'No wetlands data available.', notApplicable: 'N/A', missingItem: 'Missing wetlands evidence.' },
      fastPath: { enabled: true, fastProviders: ['county_wetlands_exact_overlap_v1', 'usfws_nwi_grid_overlay_v3'], minimumOutput: ['finding.intersects', 'evidence'] },
      learning: { persistWorkflow: true, captureFields: ['finding', 'evidence'] },
    },
    {
      id: 'fema_flood',
      label: 'FEMA flood screening',
      legacyTaskKind: 'fema_flood',
      role: 'required',
      dependsOn: ['parcel_identity'],
      blocking: false,
      timeoutMs: 45_000,
      providers: [{ providerId: 'county_flood_exact_overlap_v1', level: 'required', sourceAttempts: ['county_gis'] }, { providerId: 'fema_nfhl_grid_overlay_v2', level: 'conditional', sourceAttempts: ['fema_nfhl'] }],
      requiredOutputs: ['finding', 'evidence'],
      evidenceRequirements: { minEvidenceItems: 1, requiredFields: ['sourceUrl'], acceptableSourceTiers: ['official_county_state', 'authoritative_federal'], sourceUrlRequired: true, captureRequired: true },
      completionRules: [
        { state: 'complete', label: 'Flood screened', when: { kind: 'task_status_in', values: ['succeeded'], findingKind: 'fema_flood' }, operatorMessage: 'FEMA flood screening completed.', blocksDownstream: false },
        { state: 'partial', label: 'Partial flood data', when: { kind: 'task_status_in', values: ['partial'] }, operatorMessage: 'Flood data is partial.', blocksDownstream: false },
        { state: 'no_result', label: 'No flood data', when: { kind: 'task_status_in', values: ['unavailable', 'failed', 'timed_out'] }, operatorMessage: 'FEMA flood screening could not be completed.', blocksDownstream: false },
      ],
      escalationRules: [{ trigger: 'flood_timeout', action: 'fallback_provider', maxAttempts: 2 }],
      conflictHandling: { preserveAllCandidates: true, reconcileByEvidenceStrength: true, operatorDisputeVisible: true, consolidatedSearchAllowed: true, dualBasisSearchTrigger: 'flood_zone_conflict' },
      operatorMessages: { notAttempted: 'FEMA flood screening has not been run.', inProgress: 'Running FEMA flood screening...', complete: 'FEMA flood screening completed.', partial: 'Flood data is partial.', blocked: 'FEMA flood screening is blocked.', noResult: 'No flood data available.', notApplicable: 'N/A', missingItem: 'Missing flood evidence.' },
      fastPath: { enabled: true, fastProviders: ['county_flood_exact_overlap_v1', 'fema_nfhl_grid_overlay_v2'], minimumOutput: ['finding.zones', 'evidence'] },
      learning: { persistWorkflow: true, captureFields: ['finding', 'evidence'] },
    },
    {
      id: 'soils_septic',
      label: 'Soils and septic screening',
      legacyTaskKind: 'soils_septic',
      role: 'required',
      dependsOn: ['parcel_identity'],
      blocking: false,
      timeoutMs: 45_000,
      providers: [{ providerId: 'usda_ssurgo_sda_wkt_v2', level: 'required', sourceAttempts: ['usda_sda'] }],
      requiredOutputs: ['finding', 'evidence'],
      evidenceRequirements: { minEvidenceItems: 1, requiredFields: ['sourceUrl'], acceptableSourceTiers: ['authoritative_federal'], sourceUrlRequired: true, captureRequired: true },
      completionRules: [
        { state: 'complete', label: 'Soils screened', when: { kind: 'task_status_in', values: ['succeeded'], findingKind: 'soils_septic' }, operatorMessage: 'Soils and septic screening completed.', blocksDownstream: false },
        { state: 'partial', label: 'Partial soils data', when: { kind: 'task_status_in', values: ['partial'] }, operatorMessage: 'Soils data is partial.', blocksDownstream: false },
        { state: 'no_result', label: 'No soils data', when: { kind: 'task_status_in', values: ['unavailable', 'failed', 'timed_out'] }, operatorMessage: 'Soils screening could not be completed.', blocksDownstream: false },
      ],
      escalationRules: [{ trigger: 'soils_timeout', action: 'retry', maxAttempts: 2 }],
      conflictHandling: { preserveAllCandidates: true, reconcileByEvidenceStrength: true, operatorDisputeVisible: true, consolidatedSearchAllowed: false, dualBasisSearchTrigger: 'soil_survey_conflict' },
      operatorMessages: { notAttempted: 'Soils screening has not been run.', inProgress: 'Running soils screening...', complete: 'Soils screening completed.', partial: 'Soils data is partial.', blocked: 'Soils screening is blocked.', noResult: 'No soils data available.', notApplicable: 'N/A', missingItem: 'Missing soils evidence.' },
      fastPath: { enabled: true, fastProviders: ['usda_ssurgo_sda_wkt_v2'], minimumOutput: ['finding.mapUnits', 'evidence'] },
      learning: { persistWorkflow: true, captureFields: ['finding', 'evidence'] },
    },
    {
      id: 'slope_topography',
      label: 'Slope and topography',
      legacyTaskKind: 'slope_topography',
      role: 'required',
      dependsOn: ['parcel_identity'],
      blocking: false,
      timeoutMs: 90_000,
      providers: [{ providerId: 'usgs_3dep_epqs_parcel_grid_v2', level: 'required', sourceAttempts: ['usgs_3dep'] }],
      requiredOutputs: ['finding', 'evidence'],
      evidenceRequirements: { minEvidenceItems: 1, requiredFields: ['sourceUrl'], acceptableSourceTiers: ['authoritative_federal'], sourceUrlRequired: true, captureRequired: true },
      completionRules: [
        { state: 'complete', label: 'Slope screened', when: { kind: 'task_status_in', values: ['succeeded'], findingKind: 'slope_topography' }, operatorMessage: 'Slope and topography screening completed.', blocksDownstream: false },
        { state: 'partial', label: 'Partial slope data', when: { kind: 'task_status_in', values: ['partial'] }, operatorMessage: 'Slope data is partial.', blocksDownstream: false },
        { state: 'no_result', label: 'No slope data', when: { kind: 'task_status_in', values: ['unavailable', 'failed', 'timed_out'] }, operatorMessage: 'Slope screening could not be completed.', blocksDownstream: false },
      ],
      escalationRules: [{ trigger: 'slope_timeout', action: 'retry', maxAttempts: 2 }],
      conflictHandling: { preserveAllCandidates: true, reconcileByEvidenceStrength: true, operatorDisputeVisible: true, consolidatedSearchAllowed: false, dualBasisSearchTrigger: 'elevation_conflict' },
      operatorMessages: { notAttempted: 'Slope screening has not been run.', inProgress: 'Running slope screening...', complete: 'Slope screening completed.', partial: 'Slope data is partial.', blocked: 'Slope screening is blocked.', noResult: 'No slope data available.', notApplicable: 'N/A', missingItem: 'Missing slope evidence.' },
      fastPath: { enabled: true, fastProviders: ['usgs_3dep_epqs_parcel_grid_v2'], minimumOutput: ['finding.bands', 'evidence'] },
      learning: { persistWorkflow: true, captureFields: ['finding', 'evidence'] },
    },
    {
      id: 'road_frontage_access',
      label: 'Road frontage and access',
      legacyTaskKind: 'road_frontage',
      role: 'required',
      dependsOn: ['parcel_identity'],
      blocking: false,
      timeoutMs: 40_000,
      providers: [{ providerId: 'county_road_frontage_geometry_v2', level: 'required', sourceAttempts: ['county_gis'] }, { providerId: 'tigerweb_road_proximity_v1', level: 'conditional', sourceAttempts: ['census_tigerweb'] }],
      requiredOutputs: ['finding', 'evidence'],
      evidenceRequirements: { minEvidenceItems: 1, requiredFields: ['sourceUrl'], acceptableSourceTiers: ['official_county_state', 'authoritative_federal'], sourceUrlRequired: true, captureRequired: true },
      completionRules: [
        { state: 'complete', label: 'Road access screened', when: { kind: 'task_status_in', values: ['succeeded'], findingKind: 'road_frontage' }, operatorMessage: 'Road frontage and access screening completed.', blocksDownstream: false },
        { state: 'partial', label: 'Partial road data', when: { kind: 'task_status_in', values: ['partial'] }, operatorMessage: 'Road access data is partial.', blocksDownstream: false },
        { state: 'no_result', label: 'No road data', when: { kind: 'task_status_in', values: ['unavailable', 'failed', 'timed_out'] }, operatorMessage: 'Road access screening could not be completed.', blocksDownstream: false },
      ],
      escalationRules: [{ trigger: 'road_timeout', action: 'fallback_provider', maxAttempts: 2 }],
      conflictHandling: { preserveAllCandidates: true, reconcileByEvidenceStrength: true, operatorDisputeVisible: true, consolidatedSearchAllowed: true, dualBasisSearchTrigger: 'frontage_conflict' },
      operatorMessages: { notAttempted: 'Road access screening has not been run.', inProgress: 'Running road access screening...', complete: 'Road access screening completed.', partial: 'Road access data is partial.', blocked: 'Road access screening is blocked.', noResult: 'No road access data available.', notApplicable: 'N/A', missingItem: 'Missing road access evidence.' },
      fastPath: { enabled: true, fastProviders: ['county_road_frontage_geometry_v2', 'tigerweb_road_proximity_v1'], minimumOutput: ['finding.adjoiningRoads', 'evidence'] },
      learning: { persistWorkflow: true, captureFields: ['finding', 'evidence'] },
    },
    {
      id: 'utilities',
      label: 'Utilities',
      legacyTaskKind: 'utilities',
      role: 'required',
      dependsOn: ['parcel_identity'],
      blocking: false,
      timeoutMs: 30_000,
      providers: [{ providerId: 'utility_screening_v1', level: 'required', sourceAttempts: ['county_gis', 'utility_authority'] }],
      requiredOutputs: ['finding', 'evidence'],
      evidenceRequirements: { minEvidenceItems: 1, requiredFields: ['sourceUrl'], acceptableSourceTiers: ['official_county_state', 'authoritative_federal'], sourceUrlRequired: true, captureRequired: true },
      completionRules: [
        { state: 'complete', label: 'Utilities screened', when: { kind: 'task_status_in', values: ['succeeded'], findingKind: 'utilities' }, operatorMessage: 'Utilities screening completed.', blocksDownstream: false },
        { state: 'partial', label: 'Partial utilities data', when: { kind: 'task_status_in', values: ['partial'] }, operatorMessage: 'Utilities data is partial.', blocksDownstream: false },
        { state: 'no_result', label: 'No utilities data', when: { kind: 'task_status_in', values: ['unavailable', 'failed', 'timed_out'] }, operatorMessage: 'Utilities screening could not be completed.', blocksDownstream: false },
      ],
      escalationRules: [{ trigger: 'utilities_timeout', action: 'browser_agent', maxAttempts: 1 }],
      conflictHandling: { preserveAllCandidates: true, reconcileByEvidenceStrength: true, operatorDisputeVisible: true, consolidatedSearchAllowed: false, dualBasisSearchTrigger: 'utility_conflict' },
      operatorMessages: { notAttempted: 'Utilities screening has not been run.', inProgress: 'Running utilities screening...', complete: 'Utilities screening completed.', partial: 'Utilities data is partial.', blocked: 'Utilities screening is blocked.', noResult: 'No utilities data available.', notApplicable: 'N/A', missingItem: 'Missing utilities evidence.' },
      fastPath: { enabled: true, fastProviders: ['utility_screening_v1'], minimumOutput: ['finding.publicWater', 'evidence'] },
      learning: { persistWorkflow: true, captureFields: ['finding', 'evidence'] },
    },
    {
      id: 'zoning_landuse',
      label: 'Zoning and land use',
      legacyTaskKind: 'zoning_landuse',
      role: 'required',
      dependsOn: ['parcel_identity'],
      blocking: false,
      timeoutMs: 40_000,
      providers: [{ providerId: 'county_zoning_flu_overlay_v1', level: 'required', sourceAttempts: ['county_gis'] }],
      requiredOutputs: ['finding', 'evidence'],
      evidenceRequirements: { minEvidenceItems: 1, requiredFields: ['sourceUrl'], acceptableSourceTiers: ['official_county_state'], sourceUrlRequired: true, captureRequired: true },
      completionRules: [
        { state: 'complete', label: 'Zoning screened', when: { kind: 'task_status_in', values: ['succeeded'], findingKind: 'zoning_landuse' }, operatorMessage: 'Zoning and land use screening completed.', blocksDownstream: false },
        { state: 'partial', label: 'Partial zoning data', when: { kind: 'task_status_in', values: ['partial'] }, operatorMessage: 'Zoning data is partial.', blocksDownstream: false },
        { state: 'no_result', label: 'No zoning data', when: { kind: 'task_status_in', values: ['unavailable', 'failed', 'timed_out'] }, operatorMessage: 'Zoning screening could not be completed.', blocksDownstream: false },
      ],
      escalationRules: [{ trigger: 'zoning_timeout', action: 'fallback_provider', maxAttempts: 2 }],
      conflictHandling: { preserveAllCandidates: true, reconcileByEvidenceStrength: true, operatorDisputeVisible: true, consolidatedSearchAllowed: false, dualBasisSearchTrigger: 'zoning_conflict' },
      operatorMessages: { notAttempted: 'Zoning screening has not been run.', inProgress: 'Running zoning screening...', complete: 'Zoning screening completed.', partial: 'Zoning data is partial.', blocked: 'Zoning screening is blocked.', noResult: 'No zoning data available.', notApplicable: 'N/A', missingItem: 'Missing zoning evidence.' },
      fastPath: { enabled: true, fastProviders: ['county_zoning_flu_overlay_v1'], minimumOutput: ['finding.zoningCode', 'evidence'] },
      learning: { persistWorkflow: true, captureFields: ['finding', 'evidence'] },
    },
    {
      id: 'imagery',
      label: 'Aerial imagery',
      legacyTaskKind: 'imagery',
      role: 'required',
      dependsOn: ['parcel_identity'],
      blocking: false,
      timeoutMs: 20_000,
      providers: [{ providerId: 'county_orthophoto_v2', level: 'required', sourceAttempts: ['county_gis'] }],
      requiredOutputs: ['finding', 'evidence'],
      evidenceRequirements: { minEvidenceItems: 1, requiredFields: ['sourceUrl'], acceptableSourceTiers: ['official_county_state', 'authoritative_federal'], sourceUrlRequired: true, captureRequired: true },
      completionRules: [
        { state: 'complete', label: 'Imagery available', when: { kind: 'task_status_in', values: ['succeeded'], findingKind: 'imagery' }, operatorMessage: 'Aerial imagery is available.', blocksDownstream: false },
        { state: 'no_result', label: 'No imagery', when: { kind: 'task_status_in', values: ['unavailable', 'failed', 'timed_out'] }, operatorMessage: 'Aerial imagery could not be retrieved.', blocksDownstream: false },
      ],
      escalationRules: [{ trigger: 'imagery_timeout', action: 'mark_blocked', maxAttempts: 1 }],
      conflictHandling: { preserveAllCandidates: true, reconcileByEvidenceStrength: true, operatorDisputeVisible: false, consolidatedSearchAllowed: false, dualBasisSearchTrigger: 'imagery_conflict' },
      operatorMessages: { notAttempted: 'Imagery has not been retrieved.', inProgress: 'Retrieving aerial imagery...', complete: 'Aerial imagery is available.', partial: 'Imagery is partial.', blocked: 'Imagery retrieval is blocked.', noResult: 'No imagery available.', notApplicable: 'N/A', missingItem: 'Missing imagery evidence.' },
      fastPath: { enabled: true, fastProviders: ['county_orthophoto_v2'], minimumOutput: ['finding.imagerySource', 'evidence'] },
      learning: { persistWorkflow: true, captureFields: ['finding', 'evidence'] },
    },
    {
      id: 'marketplace_comps',
      label: 'Marketplace confirmation',
      legacyTaskKind: 'marketplace_confirmation',
      role: 'optional',
      dependsOn: ['parcel_identity'],
      blocking: false,
      timeoutMs: 30_000,
      providers: [{ providerId: 'marketplace_public_browser_status_v1', level: 'optional', sourceAttempts: ['zillow', 'redfin', 'realtor', 'realie'] }],
      requiredOutputs: ['finding'],
      evidenceRequirements: { minEvidenceItems: 0, requiredFields: [], acceptableSourceTiers: ['marketplace', 'land_portal'], sourceUrlRequired: false, captureRequired: false },
      completionRules: [
        { state: 'complete', label: 'Marketplace checked', when: { kind: 'task_status_in', values: ['succeeded'] }, operatorMessage: 'Marketplace confirmation completed.', blocksDownstream: false },
        { state: 'no_result', label: 'No marketplace data', when: { kind: 'task_status_in', values: ['unavailable', 'failed', 'timed_out'] }, operatorMessage: 'Marketplace research returned no usable data.', blocksDownstream: false },
      ],
      escalationRules: [{ trigger: 'marketplace_unavailable', action: 'mark_blocked', maxAttempts: 1 }],
      conflictHandling: { preserveAllCandidates: true, reconcileByEvidenceStrength: true, operatorDisputeVisible: false, consolidatedSearchAllowed: false, dualBasisSearchTrigger: 'listing_conflict' },
      operatorMessages: { notAttempted: 'Marketplace confirmation has not been run.', inProgress: 'Running marketplace confirmation...', complete: 'Marketplace confirmation completed.', partial: 'Marketplace data is partial.', blocked: 'Marketplace confirmation is blocked.', noResult: 'No marketplace data available.', notApplicable: 'N/A', missingItem: 'Missing marketplace evidence.' },
      fastPath: { enabled: false, fastProviders: [], minimumOutput: [] },
      learning: { persistWorkflow: true, captureFields: ['finding', 'evidence'] },
    },
    {
      id: 'land_portal',
      label: 'Land Portal cross-check',
      legacyTaskKind: 'land_portal',
      role: 'optional',
      dependsOn: ['parcel_identity'],
      blocking: false,
      timeoutMs: 30_000,
      providers: [{ providerId: 'landportal_optional_status_v1', level: 'optional', sourceAttempts: ['land_portal'] }],
      requiredOutputs: ['finding'],
      evidenceRequirements: { minEvidenceItems: 0, requiredFields: [], acceptableSourceTiers: ['land_portal'], sourceUrlRequired: false, captureRequired: false },
      completionRules: [
        { state: 'complete', label: 'Land Portal checked', when: { kind: 'task_status_in', values: ['succeeded'] }, operatorMessage: 'Land Portal cross-check completed.', blocksDownstream: false },
        { state: 'no_result', label: 'No Land Portal data', when: { kind: 'task_status_in', values: ['unavailable', 'failed', 'timed_out'] }, operatorMessage: 'Land Portal cross-check returned no usable data.', blocksDownstream: false },
      ],
      escalationRules: [{ trigger: 'landportal_unavailable', action: 'mark_blocked', maxAttempts: 1 }],
      conflictHandling: { preserveAllCandidates: true, reconcileByEvidenceStrength: true, operatorDisputeVisible: false, consolidatedSearchAllowed: false, dualBasisSearchTrigger: 'portal_conflict' },
      operatorMessages: { notAttempted: 'Land Portal cross-check has not been run.', inProgress: 'Running Land Portal cross-check...', complete: 'Land Portal cross-check completed.', partial: 'Land Portal data is partial.', blocked: 'Land Portal cross-check is blocked.', noResult: 'No Land Portal data available.', notApplicable: 'N/A', missingItem: 'Missing Land Portal evidence.' },
      fastPath: { enabled: false, fastProviders: [], minimumOutput: [] },
      learning: { persistWorkflow: true, captureFields: ['finding', 'evidence'] },
    },
    {
      id: 'valuation_synthesis',
      label: 'Valuation synthesis',
      role: 'conditional',
      dependsOn: ['county_records', 'marketplace_comps'],
      blocking: false,
      timeoutMs: 0,
      providers: [],
      requiredOutputs: [],
      evidenceRequirements: { minEvidenceItems: 0, requiredFields: [], acceptableSourceTiers: [], sourceUrlRequired: false, captureRequired: false },
      completionRules: [
        { state: 'complete', label: 'Synthesized', when: { kind: 'always' }, operatorMessage: 'Valuation synthesis is complete.', blocksDownstream: false },
      ],
      escalationRules: [],
      conflictHandling: { preserveAllCandidates: true, reconcileByEvidenceStrength: true, operatorDisputeVisible: true, consolidatedSearchAllowed: true, dualBasisSearchTrigger: 'valuation_conflict' },
      operatorMessages: { notAttempted: 'Valuation synthesis has not been run.', inProgress: 'Synthesizing valuation...', complete: 'Valuation synthesis is complete.', partial: 'Valuation synthesis is partial.', blocked: 'Valuation synthesis is blocked.', noResult: 'No valuation synthesis available.', notApplicable: 'N/A', missingItem: 'Missing valuation synthesis.' },
      fastPath: { enabled: false, fastProviders: [], minimumOutput: [] },
      learning: { persistWorkflow: false, captureFields: [] },
    },
  ],
  parallelPolicy: {
    maxConcurrency: 8,
    concurrentBatches: [
      ['parcel_identity'],
      ['county_records', 'wetlands', 'fema_flood', 'soils_septic', 'slope_topography', 'road_frontage_access', 'utilities', 'zoning_landuse', 'imagery', 'marketplace_comps', 'land_portal'],
      ['valuation_synthesis'],
    ],
    maxRunMs: 600_000,
    firstResultTargetMs: 120_000,
  },
  evidencePolicy: {
    sourceUrlRequired: true,
    timestampRequired: true,
    confidenceRequired: true,
    captureModeRequired: true,
  },
  storagePolicy: {
    persistRun: true,
    persistEvidence: true,
    persistConflicts: true,
    persistLearning: true,
  },
};

export function validateStageOutput(
  stage: ResearchStage,
  output: unknown,
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  if (output == null) {
    violations.push(`${stage.label}: output is null/undefined`);
    return { valid: false, violations };
  }
  const record = output as Record<string, unknown>;
  if (stage.role === 'required' && (record.status == null || record.status === 'skipped_identity_gate' || record.status === 'unavailable')) {
    violations.push(`${stage.label}: required stage was not attempted`);
  }
  const evidence = Array.isArray(record.evidence) ? record.evidence : [];
  for (const path of stage.requiredOutputs) {
    const direct = valueAtPath(record, path);
    const finding = record.finding && typeof record.finding === 'object'
      ? valueAtPath(record.finding as Record<string, unknown>, path)
      : undefined;
    if (!hasRequiredValue(direct) && !hasRequiredValue(finding)) {
      violations.push(`${stage.label}: missing required output "${path}"`);
    }
  }
  if (stage.evidenceRequirements.minEvidenceItems > 0 && evidence.length < stage.evidenceRequirements.minEvidenceItems) {
    violations.push(`${stage.label}: expected at least ${stage.evidenceRequirements.minEvidenceItems} evidence items, got ${evidence.length}`);
  }
  for (const field of stage.evidenceRequirements.requiredFields) {
    const hasField = evidence.some((e: unknown) => {
      const item = e as Record<string, unknown>;
      return item[field] != null && String(item[field]).trim().length > 0;
    });
    if (!hasField) {
      violations.push(`${stage.label}: missing required evidence field "${field}"`);
    }
  }
  if (stage.evidenceRequirements.sourceUrlRequired) {
    const missingUrl = evidence.filter((e: unknown) => {
      const item = e as Record<string, unknown>;
      return !item.sourceUrl || String(item.sourceUrl).trim().length === 0;
    });
    if (missingUrl.length > 0) {
      violations.push(`${stage.label}: ${missingUrl.length} evidence item(s) missing sourceUrl`);
    }
  }
  if (stage.evidenceRequirements.acceptableSourceTiers.length > 0) {
    const unacceptable = evidence.filter((e: unknown) => {
      const item = e as Record<string, unknown>;
      return !stage.evidenceRequirements.acceptableSourceTiers.includes(String(item.sourceTier ?? ''));
    });
    if (unacceptable.length > 0) {
      violations.push(`${stage.label}: ${unacceptable.length} evidence item(s) use an unacceptable source tier`);
    }
  }
  if (stage.evidenceRequirements.captureRequired) {
    const incomplete = evidence.filter((e: unknown) => {
      const item = e as Record<string, unknown>;
      return !hasRequiredValue(item.captureMode) || !hasRequiredValue(item.retrievedAt) || !hasRequiredValue(item.confidence);
    });
    if (incomplete.length > 0) {
      violations.push(`${stage.label}: ${incomplete.length} evidence item(s) lack capture/timestamp/confidence provenance`);
    }
  }
  return { valid: violations.length === 0, violations };
}
