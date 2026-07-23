// LandOS public-first property intelligence contract and orchestrator.
//
// This module begins only after parcel identity is confirmed. It owns no route,
// UI, database, browser, or network code: every provider is injected. That keeps
// the identity gate, task isolation, time limits, evidence provenance, and
// precedence rules deterministic and reusable by the Deal Card workflow.
//
// This module consumes the canonical Property Intelligence Contract
// (src/landos/property-intelligence-contract.ts). Every adapter output is
// validated against the contract before persistence.

import { PROPERTY_INTELLIGENCE_CONTRACT, evaluateStageCompletion, validateStageOutput, type CompletionState, type PropertyIntelligenceContract, type ResearchStage } from './property-intelligence-contract.js';

export const PUBLIC_INTELLIGENCE_TASKS = [
  'wetlands',
  'fema_flood',
  'soils_septic',
  'slope_topography',
  'road_frontage',
  'zoning_landuse',
  'utilities',
  'imagery',
  'county_records',
  'marketplace_confirmation',
  'land_portal',
] as const;

export type PublicIntelligenceTaskKind = (typeof PUBLIC_INTELLIGENCE_TASKS)[number];
export type IntelligenceConfidence = 'high' | 'medium' | 'low' | 'none';
export type ResolutionStatus = 'confirmed' | 'provisional' | 'conflicted' | 'unresolved';
export type CaptureMode = 'live' | 'fixture' | 'manual';

export const PUBLIC_INTELLIGENCE_TASK_LABELS: Record<PublicIntelligenceTaskKind, string> = {
  wetlands: 'Wetlands',
  fema_flood: 'FEMA flood',
  soils_septic: 'Soils and septic screening',
  slope_topography: 'Slope and topography',
  road_frontage: 'Road proximity and access context',
  zoning_landuse: 'Zoning and land use',
  utilities: 'Utilities',
  imagery: 'Aerial imagery',
  county_records: 'Official county records',
  marketplace_confirmation: 'Marketplace confirmation',
  land_portal: 'Land Portal cross-check',
};

export const PUBLIC_INTELLIGENCE_DEFAULT_TIMEOUT_MS = 30_000;
export const PUBLIC_INTELLIGENCE_MAX_TIMEOUT_MS = 120_000;

export const SCREENING_DISCLAIMERS = {
  wetlands: 'Desktop screening only. National Wetlands Inventory mapping is not a jurisdictional wetland determination.',
  femaFlood: 'Desktop flood screening only. Confirm effective mapping, elevations, and insurance requirements with FEMA and the local floodplain administrator.',
  soilsSeptic: 'Desktop soil screening only. This does not predict a passing perc test or replace onsite evaluation and health-department approval.',
  slope: 'Desktop terrain screening only. Elevation-model results do not replace a boundary or topographic survey.',
  frontage: 'Centerline-proximity screening only. It is not a frontage measurement, not proof of parcel–road contact, and not proof of physical or legal access.',
  imagery: 'Imagery is supporting context only and never verifies parcel identity, legal access, boundaries, or current site conditions.',
} as const;

/** Public intelligence cannot run merely because an address geocoded. */
export interface PublicIntelligenceSubject {
  rawInput: string;
  normalizedAddress?: string;
  county?: string;
  state?: string;
  zip?: string;
  requestedApn?: string;
  requestedApnAlternates?: string[];
  resolvedApn?: string;
  resolutionStatus: ResolutionStatus;
  resolutionExplanation: string;
  parcelGeometry?: unknown;
  coordinates?: { lat: number; lng: number };
  assessedAcres?: number;
}

export interface ParcelIntelligenceGate {
  allowed: boolean;
  blocking: true;
  reasonCode:
    | 'parcel_confirmed'
    | 'apn_hard_conflict'
    | 'requested_apn_not_resolved'
    | 'parcel_identity_conflicted'
    | 'parcel_not_confirmed';
  explanation: string;
}

/** APNs are compared by identity, not punctuation or display formatting. */
export function normalizeParcelIdentifier(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function evaluatePublicIntelligenceGate(subject: PublicIntelligenceSubject): ParcelIntelligenceGate {
  const requestedRaw = [subject.requestedApn, ...(subject.requestedApnAlternates ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const requested = requestedRaw.map(normalizeParcelIdentifier).filter((value) => value.length >= 4);
  const resolved = normalizeParcelIdentifier(subject.resolvedApn);

  if (subject.resolutionStatus === 'conflicted') {
    return {
      allowed: false,
      blocking: true,
      reasonCode: 'parcel_identity_conflicted',
      explanation: subject.resolutionExplanation || 'Parcel evidence conflicts. Resolve identity before property intelligence runs.',
    };
  }
  if (requested.length > 0 && !resolved) {
    return {
      allowed: false,
      blocking: true,
      reasonCode: 'requested_apn_not_resolved',
      explanation: `The requested APN ${requestedRaw[0]} has not been confirmed by a parcel source. Property intelligence remains in Resolution.`,
    };
  }
  if (requested.length > 0 && !requested.includes(resolved)) {
    return {
      allowed: false,
      blocking: true,
      reasonCode: 'apn_hard_conflict',
      explanation: `The requested APN ${requestedRaw[0]} conflicts with resolved APN ${subject.resolvedApn}. No downstream property intelligence may run.`,
    };
  }
  if (subject.resolutionStatus !== 'confirmed') {
    return {
      allowed: false,
      blocking: true,
      reasonCode: 'parcel_not_confirmed',
      explanation: subject.resolutionExplanation || 'The candidate parcel is not sufficiently confirmed for property intelligence.',
    };
  }
  return {
    allowed: true,
    blocking: true,
    reasonCode: 'parcel_confirmed',
    explanation: subject.resolutionExplanation || 'Parcel identity is confirmed.',
  };
}

export type PublicSourceTier =
  | 'recorded_or_approved_legal'
  | 'official_county_state'
  | 'authoritative_federal'
  | 'approved_parcel_provider'
  | 'marketplace'
  | 'land_portal'
  | 'operator_statement'
  | 'unknown';

export type VerificationClassification =
  | 'recorded_instrument'
  | 'approved_onsite_determination'
  | 'jurisdictional_determination'
  | 'official_record'
  | 'screening'
  | 'supporting_context';

export interface PublicEvidence {
  evidenceId: string;
  sourceName: string;
  sourceUrl?: string;
  sourceTier: PublicSourceTier;
  verification: VerificationClassification;
  retrievedAt: string;
  datasetDate?: string;
  confidence: IntelligenceConfidence;
  supports: string[];
  limitation?: string;
  captureMode: CaptureMode;
  /** False for fixture evidence and for malformed live evidence. */
  decisionUsable?: boolean;
}

export interface WetlandArea {
  classification: string;
  approximateAcres: number;
  parcelPercentage: number;
}

export interface WetlandsFinding {
  kind: 'wetlands';
  intersects: boolean | null;
  areas: WetlandArea[];
  approximateTotalAcres: number | null;
  approximateParcelPercentage: number | null;
  accessOrDevelopmentEffect?: string;
  overlapState?: 'no_feature' | 'boundary_touch' | 'trace_overlap' | 'measurable_overlap' | 'calculation_failed' | 'area_unavailable';
  calculationMethod?: string;
  geometryConfidence?: IntelligenceConfidence;
  evidenceMapRef?: string;
  datasetName: string;
  datasetDate?: string;
  summary: string;
  whyItMatters: string;
  limitation: string;
  classification: 'screening' | 'jurisdictional_determination';
}

export interface FloodZoneArea {
  zone: string;
  approximateAcres: number;
  parcelPercentage: number;
  specialFloodHazardArea?: boolean;
}

export interface FemaFloodFinding {
  kind: 'fema_flood';
  zones: FloodZoneArea[];
  accessOrDevelopmentEffect?: string;
  mapStatus: 'mapped' | 'not_mapped' | 'coverage_unknown';
  evidenceMapRef?: string;
  panelNumber?: string | null;
  effectiveDate?: string | null;
  baseFloodElevation?: string | null;
  mappedAccessAffected?: boolean | null;
  mappedUsableAreaAffected?: boolean | null;
  summary: string;
  whyItMatters: string;
  limitation: string;
  classification: 'screening' | 'official_determination';
}

export type SepticLimitation = 'not_limited' | 'somewhat_limited' | 'very_limited' | 'unknown';

export interface SoilComponent {
  name: string;
  percentage?: number;
  septicLimitation: SepticLimitation;
  limitingFactors: string[];
  seasonalSaturationDepthIn?: number | null;
  restrictiveLayerDepthIn?: number | null;
  drainageClass?: string;
  hydrologicSoilGroup?: string;
  slopeRangePct?: [number, number];
  saturatedHydraulicConductivity?: string;
}

export interface SoilMapUnit {
  symbol: string;
  name: string;
  approximateAcres?: number;
  parcelPercentage?: number;
  components: SoilComponent[];
}

export interface SoilsSepticFinding {
  kind: 'soils_septic';
  mapUnits: SoilMapUnit[];
  apparentInvestigationAreas?: string;
  datasetName: string;
  datasetDate?: string;
  summary: string;
  whyItMatters: string;
  limitation: string;
  classification: 'screening' | 'approved_onsite_determination';
}

export const SLOPE_BANDS = ['0_to_5', '5_to_10', '10_to_15', '15_to_25', 'above_25'] as const;
export type SlopeBand = (typeof SLOPE_BANDS)[number];

export interface SlopeBandArea {
  band: SlopeBand;
  approximateAcres: number;
  parcelPercentage: number;
}

export interface SlopeFinding {
  kind: 'slope_topography';
  minimumElevationFt: number | null;
  maximumElevationFt: number | null;
  totalReliefFt: number | null;
  meanSlopePct: number | null;
  medianSlopePct: number | null;
  maximumSlopePct: number | null;
  bands: SlopeBandArea[];
  largestApparentLowSlopeAreaAcres?: number;
  slopeNearAccessOrImprovements?: string;
  mapRef?: string;
  elevationResolution?: string;
  summary: string;
  whyItMatters: string;
  limitation: string;
  classification: 'screening' | 'surveyed';
}

export type RoadStatus = 'public' | 'private' | 'unknown';
export interface AdjoiningRoad {
  name: string;
  status: RoadStatus;
  approximateMappedFrontageFt?: number;
  apparentRightOfWayContact: boolean | null;
}

export interface FrontageFinding {
  kind: 'road_frontage';
  adjoiningRoads: AdjoiningRoad[];
  approximateMappedFrontageFt: number | null;
  measurementMethod: string;
  nearbyRoads?: Array<{ name: string; proximityNote: string }>;
  legalAccessStatus?: 'confirmed' | 'unconfirmed' | 'unknown';
  geometrySource: string;
  accessConcerns: string[];
  summary: string;
  whyItMatters: string;
  limitation: string;
  classification: 'screening' | 'recorded_or_surveyed';
}

export interface ZoningLandUseFinding {
  kind: 'zoning_landuse';
  zoningCode: string | null;
  zoningName: string | null;
  overlayDistricts: string[];
  futureLandUse: string | null;
  existingLandUse: string | null;
  jurisdiction: string;
  minimumLotSize?: string | null;
  allowedUsesNote?: string | null;
  subdivisionNote?: string | null;
  sourceLayerUrls: string[];
  summary: string;
  whyItMatters: string;
  limitation: string;
  classification: 'screening' | 'official_record';
}

export type UtilityAvailability = 'mapped_available' | 'likely' | 'unlikely' | 'unknown';

export interface UtilitiesFinding {
  kind: 'utilities';
  publicWater: UtilityAvailability;
  publicSewer: UtilityAvailability;
  electric: UtilityAvailability;
  wellLikelyRequired: boolean | null;
  septicLikelyRequired: boolean | null;
  serviceProviders: Array<{ service: string; provider: string; contact?: string; basis: string }>;
  researchAttempted: string[];
  summary: string;
  whyItMatters: string;
  limitation: string;
  classification: 'screening';
}

export interface ImageryFinding {
  kind: 'imagery';
  parcelOutlineShown: boolean;
  imagerySource: string;
  acquisitionDate?: string;
  resolution?: string;
  visibleFeatures: string[];
  evidenceRef?: string;
  summary: string;
  parcelBoundaryEvidence?: string;
  visualAssociation?: 'nearby_imagery' | 'parcel_extent' | 'parcel_boundary_verified';
  whyItMatters: string;
  limitation: string;
  classification: 'supporting_context';
}

export interface CountyFact {
  field: string;
  value: string | number;
  sourceEvidenceId: string;
  classification: 'official_record' | 'recorded_instrument';
}

export interface CountyRecordsFinding {
  kind: 'county_records';
  jurisdiction: string;
  facts: CountyFact[];
  accessState: 'public' | 'managed_account' | 'account_created' | 'verification_pending' | 'human_action_required' | 'unavailable';
  summary: string;
  whyItMatters: string;
  limitation: string;
  classification: 'official_record';
}

export interface MarketplaceFinding {
  kind: 'marketplace_confirmation';
  researchRan: boolean;
  sitesAttempted: string[];
  addressOrListingMatches: Array<{ site: string; sourceUrl: string; matchSummary: string }>;
  summary: string;
  whyItMatters: string;
  limitation: string;
  classification: 'supporting_context';
  identityUse: 'supporting_only';
}

export interface LandPortalFinding {
  kind: 'land_portal';
  available: boolean;
  crossChecks: Array<{ field: string; value: string | number; agreesWithPreferredEvidence: boolean | null }>;
  screenshotRefs: string[];
  highResolutionImageryRefs: string[];
  summary: string;
  whyItMatters: string;
  limitation: string;
  classification: 'supporting_context';
  identityUse: 'cross_check_only';
}

export type PublicIntelligenceFinding =
  | WetlandsFinding
  | FemaFloodFinding
  | SoilsSepticFinding
  | SlopeFinding
  | FrontageFinding
  | ZoningLandUseFinding
  | UtilitiesFinding
  | ImageryFinding
  | CountyRecordsFinding
  | MarketplaceFinding
  | LandPortalFinding;

export type AdapterResultStatus = 'succeeded' | 'partial' | 'unavailable' | 'blocked';

export interface PublicIntelligenceAdapterResult {
  status: AdapterResultStatus;
  finding?: PublicIntelligenceFinding;
  evidence: PublicEvidence[];
  confidence: IntelligenceConfidence;
  failureReason?: string;
  retryEligible: boolean;
}

export interface PublicIntelligenceAdapter {
  task: PublicIntelligenceTaskKind;
  /** Technical identifier retained for diagnostics, not operator narration. */
  adapterId: string;
  timeoutMs?: number;
  run(
    subject: PublicIntelligenceSubject,
    context: { signal: AbortSignal; timeoutMs: number; startedAt: string; captureMode: CaptureMode },
  ): Promise<PublicIntelligenceAdapterResult>;
}

export type PublicTaskStatus =
  | 'succeeded'
  | 'partial'
  | 'unavailable'
  | 'blocked'
  | 'failed'
  | 'timed_out'
  | 'skipped_identity_gate';

export interface PublicIntelligenceTaskRecord {
  task: PublicIntelligenceTaskKind;
  label: string;
  role: 'public_core' | 'official_records' | 'supporting_confirmation' | 'optional_cross_check';
  status: PublicTaskStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  timeoutMs: number;
  finding?: PublicIntelligenceFinding;
  evidence: PublicEvidence[];
  failureReason?: string;
  retryEligible: boolean;
  confidence: IntelligenceConfidence;
  completionState?: CompletionState;
  operatorMessage?: string;
  contractViolations?: string[];
  attempts?: number;
  providerOutcomes?: Array<{
    providerId: string;
    status: PublicTaskStatus | 'not_applicable';
    attemptCount: number;
    evidenceCount: number;
    note: string;
  }>;
  /** Once identity passes, every provider task is isolated and non-blocking. */
  blocking: false;
  diagnostics: { adapterId?: string };
}

export interface PublicIntelligenceRun {
  status: 'complete' | 'complete_with_gaps' | 'blocked_identity';
  downstreamAllowed: boolean;
  gate: ParcelIntelligenceGate;
  captureMode: CaptureMode;
  tasks: PublicIntelligenceTaskRecord[];
  nonBlockingGaps: PublicIntelligenceTaskKind[];
  startedAt: string;
  completedAt: string;
}

export interface PublicIntelligenceRunOptions {
  adapters: PublicIntelligenceAdapter[];
  captureMode?: CaptureMode;
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
  now?: () => string;
  clockMs?: () => number;
}

function roleFor(task: PublicIntelligenceTaskKind): PublicIntelligenceTaskRecord['role'] {
  if (task === 'county_records') return 'official_records';
  if (task === 'marketplace_confirmation') return 'supporting_confirmation';
  if (task === 'land_portal') return 'optional_cross_check';
  return 'public_core';
}

function boundTimeout(requested: number | undefined, fallback: number, maximum: number): number {
  const finite = typeof requested === 'number' && Number.isFinite(requested) ? requested : fallback;
  return Math.min(Math.max(1, Math.round(finite)), Math.max(1, Math.round(maximum)));
}

function emptyContractFields(): Pick<PublicIntelligenceTaskRecord, 'completionState' | 'operatorMessage' | 'contractViolations' | 'attempts' | 'providerOutcomes'> {
  return { completionState: 'not_attempted', operatorMessage: '', contractViolations: [], attempts: 1, providerOutcomes: [] };
}

class PublicTaskTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms.`);
    this.name = 'PublicTaskTimeoutError';
  }
}

function normalizeEvidence(evidence: PublicEvidence[], runMode: CaptureMode): PublicEvidence[] {
  return evidence.map((item) => {
    const captureMode = runMode === 'fixture' ? 'fixture' : item.captureMode;
    const hasReference = !!(item.sourceUrl?.trim() || item.evidenceId.trim());
    const decisionUsable =
      runMode !== 'fixture' &&
      captureMode !== 'fixture' &&
      hasReference &&
      item.sourceTier !== 'unknown';
    return { ...item, captureMode, decisionUsable };
  });
}

async function runOneTask(
  task: PublicIntelligenceTaskKind,
  adapter: PublicIntelligenceAdapter | undefined,
  subject: PublicIntelligenceSubject,
  options: Required<Pick<PublicIntelligenceRunOptions, 'captureMode' | 'defaultTimeoutMs' | 'maxTimeoutMs' | 'now' | 'clockMs'>>,
): Promise<PublicIntelligenceTaskRecord> {
  const startedAt = options.now();
  const startMs = options.clockMs();
  const timeoutMs = boundTimeout(adapter?.timeoutMs, options.defaultTimeoutMs, options.maxTimeoutMs);
  const base = {
    task,
    label: PUBLIC_INTELLIGENCE_TASK_LABELS[task],
    role: roleFor(task),
    startedAt,
    timeoutMs,
    blocking: false as const,
    diagnostics: { adapterId: adapter?.adapterId },
  };

  if (!adapter) {
    return {
      ...base,
      status: 'unavailable',
      completedAt: options.now(),
      durationMs: Math.max(0, options.clockMs() - startMs),
      evidence: [],
      failureReason: `${PUBLIC_INTELLIGENCE_TASK_LABELS[task]} is not connected.`,
      retryEligible: true,
      confidence: 'none',
      ...emptyContractFields(),
    };
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new PublicTaskTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    const output = await Promise.race([
      Promise.resolve().then(() => adapter.run(subject, {
        signal: controller.signal,
        timeoutMs,
        startedAt,
        captureMode: options.captureMode,
      })),
      timeout,
    ]);
    const evidence = normalizeEvidence(output.evidence ?? [], options.captureMode);
    const kindMismatch = output.finding && output.finding.kind !== task;
    if (kindMismatch) {
      return {
        ...base,
        status: 'failed',
        completedAt: options.now(),
        durationMs: Math.max(0, options.clockMs() - startMs),
        evidence,
        failureReason: `Adapter returned ${output.finding?.kind} for ${task}.`,
        retryEligible: false,
        confidence: 'none',
        ...emptyContractFields(),
      };
    }
    const noEvidence = output.status === 'succeeded' && evidence.length === 0;
    const fixtureInLiveRun = options.captureMode === 'live' && evidence.some((item) => item.captureMode === 'fixture');
    const status: PublicTaskStatus = noEvidence || fixtureInLiveRun ? 'partial' : output.status;
    const failureReason = noEvidence
      ? 'A result was returned without source evidence and was downgraded to partial.'
      : fixtureInLiveRun
        ? 'Fixture evidence cannot be presented as live evidence.'
        : output.failureReason;
    return {
      ...base,
      status,
      completedAt: options.now(),
      durationMs: Math.max(0, options.clockMs() - startMs),
      finding: output.finding,
      evidence,
      failureReason,
      retryEligible: noEvidence || fixtureInLiveRun ? true : output.retryEligible,
      confidence: noEvidence || fixtureInLiveRun ? 'low' : output.confidence,
      ...emptyContractFields(),
    };
  } catch (error: unknown) {
    const timedOut = error instanceof PublicTaskTimeoutError;
    return {
      ...base,
      status: timedOut ? 'timed_out' : 'failed',
      completedAt: options.now(),
      durationMs: Math.max(0, options.clockMs() - startMs),
      evidence: [],
      failureReason: timedOut ? error.message : ((error as Error)?.message || String(error)),
      retryEligible: true,
      confidence: 'none',
      ...emptyContractFields(),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function skippedTask(
  task: PublicIntelligenceTaskKind,
  gate: ParcelIntelligenceGate,
  now: () => string,
  timeoutMs: number,
): PublicIntelligenceTaskRecord {
  const at = now();
  return {
    task,
    label: PUBLIC_INTELLIGENCE_TASK_LABELS[task],
    role: roleFor(task),
    status: 'skipped_identity_gate',
    startedAt: at,
    completedAt: at,
    durationMs: 0,
    timeoutMs,
    evidence: [],
    failureReason: gate.explanation,
    retryEligible: false,
    confidence: 'none',
    blocking: false,
    diagnostics: {},
    ...emptyContractFields(),
  };
}

function operatorMessageFor(stage: ResearchStage, state: CompletionState): string {
  if (state === 'complete') return stage.operatorMessages.complete;
  if (state === 'partial') return stage.operatorMessages.partial;
  if (state === 'blocked') return stage.operatorMessages.blocked;
  if (state === 'no_result') return stage.operatorMessages.noResult;
  if (state === 'not_applicable') return stage.operatorMessages.notApplicable;
  return stage.operatorMessages.notAttempted;
}

function applyContract(task: PublicIntelligenceTaskRecord, attempts: number): PublicIntelligenceTaskRecord {
  const stage = PROPERTY_INTELLIGENCE_CONTRACT.stages.find((item) => item.legacyTaskKind === task.task);
  if (!stage) return { ...task, attempts };
  const context = { status: task.status, finding: task.finding, evidence: task.evidence };
  const validation = validateStageOutput(stage, context);
  let completionState = task.status === 'skipped_identity_gate'
    ? 'not_attempted' as const
    : evaluateStageCompletion(stage, context);
  if (!validation.valid && completionState === 'complete') completionState = 'partial';
  const adapterId = task.diagnostics.adapterId ?? stage.providers[0]?.providerId ?? 'unconnected';
  const providerOutcomes: PublicIntelligenceTaskRecord['providerOutcomes'] = [{
    providerId: adapterId,
    status: task.status,
    attemptCount: attempts,
    evidenceCount: task.evidence.length,
    note: task.failureReason ?? task.finding?.summary ?? operatorMessageFor(stage, completionState),
  }];
  for (const requirement of stage.providers) {
    if (requirement.providerId === adapterId) continue;
    providerOutcomes.push({
      providerId: requirement.providerId,
      status: 'not_applicable',
      attemptCount: 0,
      evidenceCount: 0,
      note: 'Alternative provider was not selected for this run.',
    });
  }
  return {
    ...task,
    completionState,
    operatorMessage: operatorMessageFor(stage, completionState),
    contractViolations: validation.violations,
    attempts,
    providerOutcomes,
  };
}

async function runTaskWithContract(
  task: PublicIntelligenceTaskKind,
  adapter: PublicIntelligenceAdapter | undefined,
  subject: PublicIntelligenceSubject,
  options: Required<Pick<PublicIntelligenceRunOptions, 'captureMode' | 'defaultTimeoutMs' | 'maxTimeoutMs' | 'now' | 'clockMs'>>,
): Promise<PublicIntelligenceTaskRecord> {
  const stage = PROPERTY_INTELLIGENCE_CONTRACT.stages.find((item) => item.legacyTaskKind === task);
  const boundedAdapter = adapter && stage
    ? { ...adapter, timeoutMs: Math.min(adapter.timeoutMs ?? stage.timeoutMs, stage.timeoutMs) }
    : adapter;
  const retryRule = stage?.escalationRules.find((rule) => rule.action === 'retry');
  const maxAttempts = Math.max(1, retryRule?.maxAttempts ?? 1);
  let attempt = 1;
  let record = await runOneTask(task, boundedAdapter, subject, options);
  while (attempt < maxAttempts && record.retryEligible && (record.status === 'failed' || record.status === 'timed_out')) {
    attempt += 1;
    record = await runOneTask(task, boundedAdapter, subject, options);
  }
  return applyContract(record, attempt);
}

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      output[current] = await fn(items[current]);
    }
  });
  await Promise.all(workers);
  return output;
}

/**
 * Run every connected task concurrently after one parcel-identity decision.
 * Provider failure, timeout, optional authentication, or CAPTCHA never cancels
 * another task. The stable nine-task result makes incomplete research visible.
 */
export async function runPublicPropertyIntelligence(
  subject: PublicIntelligenceSubject,
  input: PublicIntelligenceRunOptions,
): Promise<PublicIntelligenceRun> {
  const now = input.now ?? (() => new Date().toISOString());
  const clockMs = input.clockMs ?? (() => Date.now());
  const captureMode = input.captureMode ?? 'live';
  const defaultTimeoutMs = boundTimeout(input.defaultTimeoutMs, PUBLIC_INTELLIGENCE_DEFAULT_TIMEOUT_MS, input.maxTimeoutMs ?? PUBLIC_INTELLIGENCE_MAX_TIMEOUT_MS);
  const maxTimeoutMs = Math.max(1, input.maxTimeoutMs ?? PUBLIC_INTELLIGENCE_MAX_TIMEOUT_MS);
  const startedAt = now();
  const gate = evaluatePublicIntelligenceGate(subject);
  if (!gate.allowed) {
    return {
      status: 'blocked_identity',
      downstreamAllowed: false,
      gate,
      captureMode,
      tasks: PUBLIC_INTELLIGENCE_TASKS.map((task) => applyContract(skippedTask(task, gate, now, defaultTimeoutMs), 0)),
      nonBlockingGaps: [],
      startedAt,
      completedAt: now(),
    };
  }

  const byTask = new Map<PublicIntelligenceTaskKind, PublicIntelligenceAdapter>();
  for (const adapter of input.adapters) {
    if (!byTask.has(adapter.task)) byTask.set(adapter.task, adapter);
  }
  const options = { captureMode, defaultTimeoutMs, maxTimeoutMs, now, clockMs };
  const tasks = await mapWithConcurrency(
    PUBLIC_INTELLIGENCE_TASKS,
    PROPERTY_INTELLIGENCE_CONTRACT.parallelPolicy.maxConcurrency,
    (task) => runTaskWithContract(task, byTask.get(task), subject, options),
  );
  const nonBlockingGaps = tasks
    .filter((task) => task.status !== 'succeeded')
    .map((task) => task.task);
  const run: PublicIntelligenceRun = {
    status: nonBlockingGaps.length === 0 ? 'complete' : 'complete_with_gaps',
    downstreamAllowed: true,
    gate,
    captureMode,
    tasks,
    nonBlockingGaps,
    startedAt,
    completedAt: now(),
  };
  return run;
}

const SOURCE_TIER_RANK: Record<PublicSourceTier, number> = {
  recorded_or_approved_legal: 700,
  official_county_state: 600,
  authoritative_federal: 500,
  approved_parcel_provider: 400,
  marketplace: 300,
  land_portal: 250,
  operator_statement: 100,
  unknown: 0,
};

const VERIFICATION_RANK: Record<VerificationClassification, number> = {
  recorded_instrument: 700,
  approved_onsite_determination: 700,
  jurisdictional_determination: 700,
  official_record: 600,
  screening: 300,
  supporting_context: 100,
};

const CONFIDENCE_RANK: Record<IntelligenceConfidence, number> = { high: 3, medium: 2, low: 1, none: 0 };

export function compareEvidenceStrength(left: PublicEvidence, right: PublicEvidence): number {
  const verification = VERIFICATION_RANK[left.verification] - VERIFICATION_RANK[right.verification];
  if (verification !== 0) return Math.sign(verification);
  const tier = SOURCE_TIER_RANK[left.sourceTier] - SOURCE_TIER_RANK[right.sourceTier];
  if (tier !== 0) return Math.sign(tier);
  return Math.sign(CONFIDENCE_RANK[left.confidence] - CONFIDENCE_RANK[right.confidence]);
}

export interface EvidenceBackedFact {
  field: string;
  value: string | number | boolean;
  evidence: PublicEvidence;
  humanOverride?: boolean;
  overrideReason?: string;
}

export interface FactReconciliation {
  current: EvidenceBackedFact;
  status: 'agreed' | 'replaced_with_stronger' | 'kept_stronger' | 'conflicted' | 'human_override_preserved';
  conflictingCandidates: EvidenceBackedFact[];
  explanation: string;
}

function sameFactValue(left: EvidenceBackedFact['value'], right: EvidenceBackedFact['value']): boolean {
  if (typeof left === 'number' && typeof right === 'number') return Math.abs(left - right) < 1e-9;
  return String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
}

/** Preserve stronger evidence and every material conflict; never silently overwrite. */
export function reconcileEvidenceFact(current: EvidenceBackedFact, incoming: EvidenceBackedFact): FactReconciliation {
  if (current.field !== incoming.field) throw new Error('Only facts for the same field can be reconciled.');
  const agrees = sameFactValue(current.value, incoming.value);
  if (current.humanOverride) {
    return {
      current,
      status: 'human_override_preserved',
      conflictingCandidates: agrees ? [] : [incoming],
      explanation: `The human override remains in place${current.overrideReason ? ` (${current.overrideReason})` : ''}; new evidence was retained for review.`,
    };
  }
  const strength = compareEvidenceStrength(incoming.evidence, current.evidence);
  if (agrees) {
    return {
      current: strength > 0 ? incoming : current,
      status: 'agreed',
      conflictingCandidates: [],
      explanation: 'The sources agree; the stronger source is retained as the current fact.',
    };
  }
  if (strength > 0) {
    return {
      current: incoming,
      status: 'replaced_with_stronger',
      conflictingCandidates: [current],
      explanation: 'The stronger evidence became current; the displaced value remains recorded as a conflict.',
    };
  }
  if (strength < 0) {
    return {
      current,
      status: 'kept_stronger',
      conflictingCandidates: [incoming],
      explanation: 'The existing stronger evidence remains current; the weaker value is retained as a conflict.',
    };
  }
  return {
    current,
    status: 'conflicted',
    conflictingCandidates: [incoming],
    explanation: 'Equally ranked sources disagree. The current value is preserved pending operator or authoritative resolution.',
  };
}

export function canonicalizeSsurgosepticRating(value: string | null | undefined): SepticLimitation {
  const normalized = (value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'not_limited' || normalized === 'slight') return 'not_limited';
  if (normalized === 'somewhat_limited' || normalized === 'moderate') return 'somewhat_limited';
  if (normalized === 'very_limited' || normalized === 'severe') return 'very_limited';
  return 'unknown';
}

export function slopeBandFor(slopePercent: number): SlopeBand {
  if (slopePercent < 5) return '0_to_5';
  if (slopePercent < 10) return '5_to_10';
  if (slopePercent < 15) return '10_to_15';
  if (slopePercent < 25) return '15_to_25';
  return 'above_25';
}

/** Aggregate already-clipped DEM cells; geometry work remains in the adapter. */
export function summarizeSlopeBands(cells: Array<{ slopePercent: number; areaAcres: number }>): SlopeBandArea[] {
  const totals = new Map<SlopeBand, number>(SLOPE_BANDS.map((band) => [band, 0]));
  for (const cell of cells) {
    if (!Number.isFinite(cell.slopePercent) || !Number.isFinite(cell.areaAcres) || cell.areaAcres <= 0) continue;
    const band = slopeBandFor(Math.max(0, cell.slopePercent));
    totals.set(band, (totals.get(band) ?? 0) + cell.areaAcres);
  }
  const total = [...totals.values()].reduce((sum, area) => sum + area, 0);
  return SLOPE_BANDS.map((band) => {
    const approximateAcres = Math.round((totals.get(band) ?? 0) * 1000) / 1000;
    return {
      band,
      approximateAcres,
      parcelPercentage: total > 0 ? Math.round((approximateAcres / total) * 10_000) / 100 : 0,
    };
  });
}
