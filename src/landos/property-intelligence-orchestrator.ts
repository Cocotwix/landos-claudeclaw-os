// Property Intelligence Research Orchestrator
//
// This module implements the shared parallel research orchestration defined
// by the Property Intelligence Contract. After parcel identity is confirmed,
// it dispatches independent research branches concurrently rather than
// running the entire process sequentially.
//
// Every research worker (API adapter, deterministic adapter, Kilo, Codex,
// Claude Code, Browser Use, Hermes, or future agent) must use this orchestrator
// or an equivalent that produces the same contract-compliant output.

import { evaluatePublicIntelligenceGate, runPublicPropertyIntelligence, type PublicIntelligenceSubject, type PublicIntelligenceRun, type PublicIntelligenceAdapter } from './public-property-intelligence.js';
import { PROPERTY_INTELLIGENCE_CONTRACT, evaluateStageCompletion, type CompletionState, type PropertyIntelligenceContract, type ResearchStageId } from './property-intelligence-contract.js';
import type { SubjectMarket, CompRegistry } from './comp-registry.js';
import { runCompProvidersParallel, type CompProviderJob, type CompProviderRun } from './comp-orchestrator.js';

export type OrchestratorStatus = 'idle' | 'running' | 'complete' | 'complete_with_gaps' | 'blocked_identity' | 'failed';

export interface OrchestratorStageRecord {
  stageId: ResearchStageId;
  label: string;
  role: 'required' | 'conditional' | 'optional';
  completionState: CompletionState;
  operatorMessage: string;
  providerOutcomes: Array<{
    providerId: string;
    status: string;
    attemptCount: number;
    evidenceCount: number;
    candidateCount?: number;
    note: string;
  }>;
  evidenceCount: number;
  violations: string[];
}

export interface OrchestratorRun {
  status: OrchestratorStatus;
  contractVersion: string;
  propertyIntelligence: PublicIntelligenceRun | null;
  compRuns: CompProviderRun[];
  registry: CompRegistry | null;
  compReconciliation: {
    rejected: CompRegistry['rejected'];
    duplicateMerges: CompRegistry['duplicateMerges'];
    valuationBlockers: string[];
  } | null;
  stages: OrchestratorStageRecord[];
  validation: { valid: boolean; violations: string[] };
  firstUsefulResultMs: number | null;
  deadlineMs: number;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  nonBlockingGaps: string[];
  downstreamAllowed: boolean;
  /** Official GIS parcel ring retained for read-only owner map projection. */
  subjectGeometry?: { rings: number[][][] } | null;
}

export interface OrchestratorOptions {
  subject: PublicIntelligenceSubject;
  adapters: PublicIntelligenceAdapter[];
  compJobs: CompProviderJob[];
  /** Provider outcomes already produced by the report pipeline. These are
   * retained for audit/provenance and are never re-run by this orchestrator. */
  retainedCompRuns?: CompProviderRun[];
  captureMode?: 'live' | 'fixture' | 'manual';
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
  now?: () => string;
  clockMs?: () => number;
  subjectMarket?: SubjectMarket;
  /** Canonical persisted/report registry to retain when this invocation does not
   * launch a new comp provider. New provider candidates still build a fresh
   * registry; callers must never replace newer candidates with this seed. */
  seedRegistry?: CompRegistry | null;
}

const DEFAULT_ORCHESTRATOR_TIMEOUT_MS = 600_000;
const FIRST_RESULT_TARGET_MS = 120_000;

function retainedSubjectGeometry(value: unknown): { rings: number[][][] } | null {
  if (!value || typeof value !== 'object') return null;
  const rings = (value as { rings?: unknown }).rings;
  if (!Array.isArray(rings)) return null;
  const clean = rings.map((ring) => Array.isArray(ring)
    ? ring.filter((point): point is number[] => Array.isArray(point)
      && point.length >= 2
      && Number.isFinite(Number(point[0]))
      && Number.isFinite(Number(point[1])))
        .map((point) => [Number(point[0]), Number(point[1])])
    : []).filter((ring) => ring.length >= 3);
  return clean.length ? { rings: clean } : null;
}

function stageMessage(stageId: ResearchStageId, state: CompletionState): string {
  const stage = PROPERTY_INTELLIGENCE_CONTRACT.stages.find((item) => item.id === stageId)!;
  if (state === 'complete') return stage.operatorMessages.complete;
  if (state === 'partial') return stage.operatorMessages.partial;
  if (state === 'blocked') return stage.operatorMessages.blocked;
  if (state === 'no_result') return stage.operatorMessages.noResult;
  if (state === 'not_applicable') return stage.operatorMessages.notApplicable;
  return stage.operatorMessages.notAttempted;
}

function buildStageRecords(subject: PublicIntelligenceSubject, publicRun: PublicIntelligenceRun, compRuns: CompProviderRun[], registry: CompRegistry | null): OrchestratorStageRecord[] {
  return PROPERTY_INTELLIGENCE_CONTRACT.stages.map((stage): OrchestratorStageRecord => {
    if (stage.id === 'parcel_identity') {
      const completionState = evaluateStageCompletion(stage, { resolutionStatus: subject.resolutionStatus });
      return {
        stageId: stage.id, label: stage.label, role: stage.role, completionState,
        operatorMessage: stageMessage(stage.id, completionState),
        providerOutcomes: [{ providerId: 'parcel-resolution-engine', status: subject.resolutionStatus, attemptCount: 1, evidenceCount: 0, note: subject.resolutionExplanation }],
        evidenceCount: 0, violations: [],
      };
    }
    if (stage.id === 'marketplace_comps') {
      const providerOutcomes = compRuns.length > 0 ? compRuns.map((run) => ({
        providerId: run.provider, status: run.status, attemptCount: 1,
        evidenceCount: run.candidates.filter((item) => !!item.sourceUrl).length,
        candidateCount: run.candidates.length, note: run.note,
      })) : (registry?.providerCoverage ?? []).map((coverage) => ({
        providerId: coverage.provider,
        status: coverage.validated > 0 ? 'succeeded' : coverage.candidates > 0 ? 'no_result' : 'not_attempted',
        attemptCount: 0,
        evidenceCount: coverage.validated,
        candidateCount: coverage.candidates,
        note: `${coverage.validated} validated of ${coverage.candidates} retained candidate(s); ${coverage.rejected} rejected.`,
      }));
      const successes = compRuns.filter((run) => run.status === 'succeeded');
      const candidateCount = compRuns.reduce((sum, run) => sum + run.candidates.length, 0);
      const completionState: CompletionState = compRuns.length === 0
        ? !registry || registry.counts.rawCandidates === 0 ? 'not_attempted' : registry.counts.validatedSold + registry.counts.validatedActive > 0 ? 'complete' : 'no_result'
        : candidateCount > 0 ? (compRuns.every((run) => run.status === 'succeeded' || run.status === 'no_result' || run.status === 'unavailable' || run.status === 'blocked') ? 'complete' : 'partial')
          : successes.length > 0 || compRuns.some((run) => run.status === 'no_result') ? 'no_result'
            : compRuns.every((run) => run.status === 'blocked') ? 'blocked' : 'partial';
      const violations = compRuns.length === 0 && !registry ? ['No comp provider outcomes or canonical registry were produced.'] : [];
      return { stageId: stage.id, label: stage.label, role: stage.role, completionState, operatorMessage: stageMessage(stage.id, completionState), providerOutcomes, evidenceCount: providerOutcomes.reduce((sum, item) => sum + item.evidenceCount, 0), violations };
    }
    if (stage.id === 'valuation_synthesis') {
      const completionState: CompletionState = !registry ? 'not_attempted' : registry.valuationReady ? 'complete' : registry.counts.validatedSold > 0 ? 'partial' : 'no_result';
      return {
        stageId: stage.id, label: stage.label, role: stage.role, completionState,
        operatorMessage: registry?.valuationBlockers.join(' ') || stageMessage(stage.id, completionState),
        providerOutcomes: [], evidenceCount: registry?.counts.validatedSold ?? 0,
        violations: registry?.valuationBlockers ?? [],
      };
    }
    const task = publicRun.tasks.find((item) => item.task === stage.legacyTaskKind);
    if (!task) {
      return { stageId: stage.id, label: stage.label, role: stage.role, completionState: 'not_attempted', operatorMessage: stage.operatorMessages.notAttempted, providerOutcomes: [], evidenceCount: 0, violations: [`${stage.label}: no canonical task record exists.`] };
    }
    return {
      stageId: stage.id, label: stage.label, role: stage.role,
      completionState: task.completionState ?? (task.status === 'succeeded' ? 'complete' : task.status === 'blocked' ? 'blocked' : task.status === 'skipped_identity_gate' ? 'not_attempted' : 'no_result'),
      operatorMessage: task.operatorMessage ?? task.failureReason ?? stage.operatorMessages.noResult,
      providerOutcomes: task.providerOutcomes ?? [],
      evidenceCount: task.evidence.length,
      violations: task.contractViolations ?? [],
    };
  });
}

export async function runPropertyIntelligenceOrchestrator(
  options: OrchestratorOptions,
): Promise<OrchestratorRun> {
  const now = options.now ?? (() => new Date().toISOString());
  const clockMs = options.clockMs ?? (() => Date.now());
  const startedAt = now();
  const startMs = clockMs();

  const nonBlockingGaps: string[] = [];
  let propertyIntelligence: PublicIntelligenceRun | null = null;
  let compRuns: CompProviderRun[] = [];
  let registry: CompRegistry | null = null;
  let stages: OrchestratorStageRecord[] = [];
  let status: OrchestratorStatus = 'running';

  try {
    const gate = evaluatePublicIntelligenceGate(options.subject);
    const publicPromise = runPublicPropertyIntelligence(options.subject, {
      adapters: options.adapters,
      captureMode: options.captureMode ?? 'live',
      defaultTimeoutMs: options.defaultTimeoutMs,
      maxTimeoutMs: options.maxTimeoutMs,
      now,
      clockMs,
    });
    if (!gate.allowed) {
      propertyIntelligence = await publicPromise;
      status = 'blocked_identity';
      // The identity gate prevents new provider or valuation work, but report
      // lanes may already have completed before this canonical reconciliation.
      // Retain those outcomes and their seeded registry as auditable market
      // context instead of erasing them from the owner record. They never open
      // valuation or downstream work while identity remains blocked.
      compRuns = options.retainedCompRuns ?? [];
      registry = compRuns.length > 0 ? options.seedRegistry ?? null : null;
      stages = buildStageRecords(options.subject, propertyIntelligence, compRuns, registry).map((stage) =>
        stage.stageId === 'valuation_synthesis' && registry
          ? {
              ...stage,
              completionState: 'blocked' as const,
              operatorMessage: 'Parcel identity is not confirmed. Retained comp evidence remains market context only and cannot support valuation.',
              violations: [...stage.violations, 'Parcel identity must be confirmed before valuation synthesis.'],
            }
          : stage,
      );
      const blockedRun: OrchestratorRun = {
        status, contractVersion: PROPERTY_INTELLIGENCE_CONTRACT.version, propertyIntelligence,
        compRuns, registry,
        compReconciliation: registry ? {
          rejected: registry.rejected,
          duplicateMerges: registry.duplicateMerges,
          valuationBlockers: [...registry.valuationBlockers, 'Parcel identity must be confirmed before valuation synthesis.'],
        } : null,
        stages,
        validation: { valid: true, violations: [] }, firstUsefulResultMs: null,
        deadlineMs: PROPERTY_INTELLIGENCE_CONTRACT.parallelPolicy.maxRunMs,
        startedAt, completedAt: now(), durationMs: clockMs() - startMs,
        nonBlockingGaps, downstreamAllowed: false,
        subjectGeometry: retainedSubjectGeometry(options.subject.parcelGeometry),
      };
      blockedRun.validation = validateOrchestratorOutput(PROPERTY_INTELLIGENCE_CONTRACT, blockedRun);
      return blockedRun;
    }

    const compPromise = runCompProvidersParallel(options.compJobs, {
      perProviderTimeoutMs: Math.min(options.defaultTimeoutMs ?? 180_000, PROPERTY_INTELLIGENCE_CONTRACT.parallelPolicy.maxRunMs),
      now: clockMs,
    });
    const [publicResult, freshCompRuns] = await Promise.all([publicPromise, compPromise]);
    propertyIntelligence = publicResult;
    const freshProviders = new Set(freshCompRuns.map((run) => run.provider.trim().toLowerCase()));
    compRuns = [
      ...(options.retainedCompRuns ?? []).filter((run) => !freshProviders.has(run.provider.trim().toLowerCase())),
      ...freshCompRuns,
    ];

    // Only freshly executed jobs supply new candidates. Retained outcomes are
    // an audit of the report lanes whose candidates are already represented by
    // seedRegistry; rebuilding from a provider subset would silently drop rows.
    const allCandidates = freshCompRuns.flatMap((run) => run.candidates);
    if (options.subjectMarket && allCandidates.length > 0) {
      const { buildCompRegistry } = await import('./comp-registry.js');
      registry = buildCompRegistry(options.subjectMarket, allCandidates);
    } else if (options.seedRegistry) {
      registry = options.seedRegistry;
    }
    stages = buildStageRecords(options.subject, propertyIntelligence, compRuns, registry);
    const requiredGaps = stages.filter((stage) => stage.role === 'required' && stage.completionState !== 'complete');
    nonBlockingGaps.push(...requiredGaps.map((stage) => stage.stageId));
    status = requiredGaps.length > 0 ? 'complete_with_gaps' : 'complete';
    const usefulDurations = [
      ...propertyIntelligence.tasks.filter((task) => task.completionState === 'complete' || task.completionState === 'partial').map((task) => task.durationMs),
      ...compRuns.filter((run) => run.status === 'succeeded' && run.candidates.length > 0).map((run) => run.elapsedMs),
    ];
    const result: OrchestratorRun = {
      status, contractVersion: PROPERTY_INTELLIGENCE_CONTRACT.version,
      propertyIntelligence, compRuns, registry,
      compReconciliation: registry ? {
        rejected: registry.rejected,
        duplicateMerges: registry.duplicateMerges,
        valuationBlockers: registry.valuationBlockers,
      } : null,
      stages,
      validation: { valid: true, violations: [] },
      firstUsefulResultMs: usefulDurations.length ? Math.min(...usefulDurations) : null,
      deadlineMs: PROPERTY_INTELLIGENCE_CONTRACT.parallelPolicy.maxRunMs,
      startedAt, completedAt: now(), durationMs: clockMs() - startMs,
      nonBlockingGaps, downstreamAllowed: propertyIntelligence.downstreamAllowed,
      subjectGeometry: retainedSubjectGeometry(options.subject.parcelGeometry),
    };
    result.validation = validateOrchestratorOutput(PROPERTY_INTELLIGENCE_CONTRACT, result);
    if (!result.validation.valid && result.status === 'complete') result.status = 'complete_with_gaps';
    return result;
  } catch (error) {
    return {
      status: 'failed',
      contractVersion: PROPERTY_INTELLIGENCE_CONTRACT.version,
      propertyIntelligence,
      compRuns,
      registry,
      compReconciliation: registry ? {
        rejected: registry.rejected,
        duplicateMerges: registry.duplicateMerges,
        valuationBlockers: registry.valuationBlockers,
      } : null,
      stages,
      validation: { valid: false, violations: [`Orchestrator failed: ${error instanceof Error ? error.message : String(error)}`] },
      firstUsefulResultMs: null,
      deadlineMs: DEFAULT_ORCHESTRATOR_TIMEOUT_MS,
      startedAt,
      completedAt: now(),
      durationMs: clockMs() - startMs,
      nonBlockingGaps: nonBlockingGaps.length ? nonBlockingGaps : [`Orchestrator failed: ${error instanceof Error ? error.message : String(error)}`],
      downstreamAllowed: false,
      subjectGeometry: retainedSubjectGeometry(options.subject.parcelGeometry),
    };
  }
}

export function validateOrchestratorOutput(
  contract: PropertyIntelligenceContract,
  run: OrchestratorRun,
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  for (const stage of run.stages) {
    if (stage.role === 'required' && stage.completionState !== 'complete' && run.status !== 'blocked_identity') {
      violations.push(`${stage.label}: ${stage.completionState}`);
    }
    violations.push(...stage.violations);
  }
  if (contract.storagePolicy.persistRun && !run.completedAt) {
    violations.push('Completed orchestrator run is missing completedAt.');
  }
  if (run.firstUsefulResultMs != null && run.firstUsefulResultMs > contract.parallelPolicy.firstResultTargetMs) {
    violations.push(`First useful result exceeded ${Math.round(contract.parallelPolicy.firstResultTargetMs / 1000)} seconds.`);
  }

  return { valid: violations.length === 0, violations };
}
