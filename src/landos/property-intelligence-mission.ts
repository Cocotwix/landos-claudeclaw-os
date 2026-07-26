// The Property Intelligence parent mission.
//
// ONE operator action starts ONE mission. The mission dispatches its
// specialists in dependency waves, records each one's live status, classified
// failure and timing, then joins every contribution into a single snapshot that
// is written back to the canonical Deal Card.
//
// Behaviour this module guarantees:
//   • A second launch while a mission is in flight returns the SAME run. The
//     operator can never accidentally start two missions on one Deal Card.
//   • A specialist failure never makes the mission look complete. The failure is
//     classified, retained, and named in the final synthesis.
//   • Specialists that need a confirmed parcel are SKIPPED (not failed) on an
//     unresolved parcel, with the skip reason surfaced.
//   • Valuation and strategy are computed from the accepted evidence only; a
//     missing comp lane produces an honest refusal, never a fabricated number.
//   • The previous snapshot stays primary until this run produces a new one.
//
// The collectors are injected so this orchestration is testable without a
// browser, a provider, or a network call.

import { classifyExecution, type FailureCategory } from '../failure-classification.js';
import { applyCompSourcePolicy, type CompSourcePolicyResult } from './comp-source-policy.js';
import { buildPropertyIntelligenceStrategies } from './property-intelligence-strategy.js';
import { buildPropertyIntelligenceValuation } from './property-intelligence-valuation.js';
import { PropertyIntelligenceStore } from './property-intelligence-store.js';
import {
  initialSpecialistRecords,
  joinPropertyIntelligence,
  type PropertyIntelligenceSnapshot,
  type SnapshotComp,
  type SnapshotComps,
  type SnapshotDueDiligenceItem,
  type SnapshotEvidenceItem,
  type SnapshotFact,
  type SnapshotIdentity,
  type SnapshotRejectedComp,
  type SnapshotSpecialistRecord,
} from './property-intelligence-snapshot.js';
import {
  PROPERTY_INTELLIGENCE_SPECIALISTS,
  specialistDefinition,
  specialistWaves,
  type SpecialistId,
  type SpecialistStatus,
} from './property-intelligence-specialists.js';
import type { CompRegistryCandidate, SubjectMarket } from './comp-registry.js';

// ── Specialist contributions ────────────────────────────────────────────────

export interface SpecialistOutcome<T> {
  status: 'completed' | 'partial' | 'blocked';
  summary: string;
  data: T | null;
  evidence?: SnapshotEvidenceItem[];
}

export interface IdentityContribution {
  identity: SnapshotIdentity;
  facts: SnapshotFact[];
  subjectMarket: SubjectMarket;
  subjectAcres: number | null;
  acreageConflict: boolean;
}

export interface GovernmentRecordsContribution {
  records: SnapshotFact[];
}

export interface ZoningContribution {
  zoning: string | null;
  zoningKnown: boolean;
  items: SnapshotDueDiligenceItem[];
  facts: SnapshotFact[];
}

export interface EnvironmentalContribution {
  items: SnapshotDueDiligenceItem[];
  /** Mapped physical constraints that move value. */
  constraints: string[];
}

export interface AccessUtilitiesContribution {
  items: SnapshotDueDiligenceItem[];
  accessStatus: 'public_road_proximity' | 'private_road_only' | 'no_mapped_contact' | 'unknown';
  utilitiesKnown: boolean;
  utilitiesSummary: string | null;
}

export interface ComparablesContribution {
  candidates: CompRegistryCandidate[];
  duplicatesMerged: number;
}

export interface MarketContribution {
  facts: SnapshotFact[];
  summary: string;
}

export interface EvidenceContribution {
  evidence: SnapshotEvidenceItem[];
}

export interface MissionContext {
  dealCardId: number;
  runId: string;
  /** Populated once the identity specialist has run. */
  identity: IdentityContribution | null;
  /** Contributions available to later waves. */
  comparables: ComparablesContribution | null;
}

export interface PropertyIntelligenceCollectors {
  parcel_identity(ctx: MissionContext): Promise<SpecialistOutcome<IdentityContribution>>;
  government_records(ctx: MissionContext): Promise<SpecialistOutcome<GovernmentRecordsContribution>>;
  zoning_land_use(ctx: MissionContext): Promise<SpecialistOutcome<ZoningContribution>>;
  environmental_terrain(ctx: MissionContext): Promise<SpecialistOutcome<EnvironmentalContribution>>;
  access_utilities(ctx: MissionContext): Promise<SpecialistOutcome<AccessUtilitiesContribution>>;
  comparables(ctx: MissionContext): Promise<SpecialistOutcome<ComparablesContribution>>;
  market_intelligence(ctx: MissionContext): Promise<SpecialistOutcome<MarketContribution>>;
  evidence_visuals(ctx: MissionContext): Promise<SpecialistOutcome<EvidenceContribution>>;
}

export interface MissionOptions {
  dealCardId: number;
  trigger?: string;
  collectors: PropertyIntelligenceCollectors;
  store?: PropertyIntelligenceStore;
  now?: () => string;
  clockMs?: () => number;
  /** Overrides every specialist timeout. Used by tests. */
  timeoutMsOverride?: number;
  runIdFactory?: () => string;
  /** Called after every specialist state change so a caller can push progress. */
  onProgress?: (record: SnapshotSpecialistRecord) => void;
}

export interface MissionLaunch {
  runId: string;
  dealCardId: number;
  sequence: number;
  /** True when an in-flight mission already existed and was returned instead. */
  alreadyRunning: boolean;
}

const UNRESOLVED_IDENTITY: SnapshotIdentity = {
  state: 'unresolved',
  normalizedAddress: null,
  county: null,
  state_: null,
  apn: null,
  apnVariants: [],
  owner: null,
  ownerMailing: null,
  situs: null,
  acres: null,
  acreageBasis: null,
  coordinates: null,
  hasParcelGeometry: false,
  sourceConfidence: 'none',
  conflicts: [],
  explanation: 'The parcel identity specialist did not return a usable identity.',
};

function timeoutAfter(ms: number): { promise: Promise<never>; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    handle = setTimeout(() => {
      const error = new Error(`Specialist exceeded its ${Math.round(ms / 1000)}s time budget.`);
      (error as Error & { __timedOut?: boolean }).__timedOut = true;
      reject(error);
    }, ms);
  });
  return { promise, cancel: () => clearTimeout(handle!) };
}

function classifyFailure(error: unknown): { category: FailureCategory; message: string; retryable: boolean } {
  const timedOut = !!(error as { __timedOut?: boolean } | null)?.__timedOut;
  const outcome = classifyExecution({
    timedOut,
    error,
    stderr: error instanceof Error ? error.message : String(error),
  });
  return { category: outcome.category, message: outcome.message, retryable: outcome.retryable };
}

/** Build the comps section from the accepted policy result. */
export function compsSection(policy: CompSourcePolicyResult, duplicatesMerged: number): SnapshotComps {
  const toComp = (decision: CompSourcePolicyResult['acceptedSold'][number], lane: 'sold' | 'active'): SnapshotComp => {
    const candidate = decision.candidate;
    const acres = typeof candidate.acres === 'number' ? candidate.acres : null;
    const price = typeof candidate.price === 'number' ? candidate.price : null;
    const ppa = typeof candidate.pricePerAcre === 'number'
      ? candidate.pricePerAcre
      : price != null && acres != null && acres > 0 ? Math.round(price / acres) : null;
    const similarities: string[] = [];
    const differences: string[] = [];
    if (acres != null) similarities.push(`${acres.toFixed(2)} ac`);
    if (candidate.distanceMiles != null) similarities.push(`${candidate.distanceMiles.toFixed(1)} mi from the subject`);
    if (!candidate.sourceUrl) differences.push('No retrievable source link on the row.');
    if (!candidate.saleOrListDate) differences.push('No verified transaction date.');
    if (acres == null) differences.push('No acreage on the row.');
    return {
      key: `${decision.family}:${candidate.addressDesc ?? candidate.sourceUrl ?? Math.random().toString(36).slice(2)}`,
      address: candidate.addressDesc ?? null,
      lane,
      source: candidate.provider,
      sourceUrl: candidate.sourceUrl ?? null,
      status: lane === 'sold' ? 'Closed sale' : 'Active listing',
      dateIso: candidate.saleOrListDate ?? null,
      price,
      acres,
      pricePerAcre: ppa,
      distanceMiles: candidate.distanceMiles ?? null,
      whyUseful: decision.reason,
      similarities,
      differences,
    };
  };

  // Every excluded candidate is listed, whichever lane it came from. Filtering
  // context-only rows to the sold lane made an excluded ACTIVE row vanish from
  // the operator's view entirely — the row was neither accepted nor visibly
  // rejected, which reads as the source having returned nothing.
  const shownActive = new Set(policy.acceptedActive);
  const rejected: SnapshotRejectedComp[] = [
    ...policy.rejected,
    ...policy.decisions.filter((d) => d.role === 'context_only' && !shownActive.has(d)),
  ].map((decision) => ({
    address: decision.candidate.addressDesc ?? null,
    source: decision.candidate.provider,
    price: typeof decision.candidate.price === 'number' ? decision.candidate.price : null,
    reason: decision.reason,
  }));

  return {
    policyExplanation: policy.plan.explanation,
    landPortalUsable: policy.plan.landPortalUsable,
    landPortalRowsSeen: policy.plan.landPortalRowsSeen,
    caps: policy.plan.caps,
    sold: policy.acceptedSold.map((d) => toComp(d, 'sold')),
    active: policy.acceptedActive.map((d) => toComp(d, 'active')),
    landHomeOnly: policy.landHomeOnly.map((d) => toComp(d, d.lane)),
    rejected,
    duplicatesMerged,
    summaryLine: policy.summaryLine,
  };
}

/**
 * Launch the parent Property Intelligence mission. Resolves as soon as the run
 * record exists; the specialists continue in the background so the operator can
 * watch progress. Await `completion` when a caller needs the finished snapshot.
 */
export function launchPropertyIntelligenceMission(options: MissionOptions): {
  launch: MissionLaunch;
  completion: Promise<PropertyIntelligenceSnapshot | null>;
} {
  const store = options.store ?? new PropertyIntelligenceStore();
  const now = options.now ?? (() => new Date().toISOString());

  store.reclaimStaleRuns();
  const active = store.activeRun(options.dealCardId);
  if (active) {
    return {
      launch: { runId: active.runId, dealCardId: options.dealCardId, sequence: active.sequence, alreadyRunning: true },
      completion: Promise.resolve(null),
    };
  }

  const runId = (options.runIdFactory ?? defaultRunId)();
  const startedAt = now();
  const created = store.createRun({
    runId,
    dealCardId: options.dealCardId,
    trigger: options.trigger ?? 'operator',
    startedAt,
    specialists: initialSpecialistRecords(),
  });

  const completion = executeMission({ ...options, store, now }, runId, startedAt)
    .catch((error) => {
      const failure = classifyFailure(error);
      store.completeRun({
        runId,
        dealCardId: options.dealCardId,
        status: 'failed',
        completedAt: now(),
        snapshot: null,
        error: failure.message,
        failureCategory: failure.category,
      });
      return null;
    });

  return {
    launch: { runId, dealCardId: options.dealCardId, sequence: created.sequence, alreadyRunning: false },
    completion,
  };
}

function defaultRunId(): string {
  return `pi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function executeMission(
  options: MissionOptions & { store: PropertyIntelligenceStore; now: () => string },
  runId: string,
  startedAt: string,
): Promise<PropertyIntelligenceSnapshot> {
  const { store, now } = options;
  const clockMs = options.clockMs ?? (() => Date.now());

  const records = new Map<SpecialistId, SnapshotSpecialistRecord>(
    initialSpecialistRecords().map((record) => [record.id, record]),
  );

  const context: MissionContext = {
    dealCardId: options.dealCardId,
    runId,
    identity: null,
    comparables: null,
  };

  const evidence: SnapshotEvidenceItem[] = [];
  const facts: SnapshotFact[] = [];
  const governmentRecords: SnapshotFact[] = [];
  const dueDiligence: SnapshotDueDiligenceItem[] = [];
  // Held in a mutable record because these are assigned inside concurrent wave
  // callbacks; plain `let` bindings would be narrowed to null by control flow.
  const collected: {
    zoning: ZoningContribution | null;
    environmental: EnvironmentalContribution | null;
    accessUtilities: AccessUtilitiesContribution | null;
    comparables: ComparablesContribution | null;
  } = { zoning: null, environmental: null, accessUtilities: null, comparables: null };
  const extraBlockers: string[] = [];

  const write = (record: SnapshotSpecialistRecord): void => {
    records.set(record.id, record);
    store.updateSpecialist({
      runId,
      specialistId: record.id,
      status: record.status,
      summary: record.summary,
      failureCategory: record.failureCategory,
      failureMessage: record.failureMessage,
      retryable: record.retryable,
      evidenceCount: record.evidenceCount,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      durationMs: record.durationMs,
    });
    options.onProgress?.(record);
  };

  const settle = (
    id: SpecialistId,
    status: SpecialistStatus,
    summary: string,
    extras: Partial<SnapshotSpecialistRecord> = {},
  ): void => {
    const previous = records.get(id)!;
    write({ ...previous, ...extras, status, summary, completedAt: extras.completedAt ?? now() });
  };

  const runCollector = async <T>(
    id: SpecialistId,
    collector: (ctx: MissionContext) => Promise<SpecialistOutcome<T>>,
  ): Promise<SpecialistOutcome<T> | null> => {
    const definition = specialistDefinition(id);
    const previous = records.get(id)!;
    const startMs = clockMs();
    write({ ...previous, status: 'running', startedAt: now(), summary: definition.purpose });

    if (definition.requiresConfirmedIdentity && context.identity?.identity.state !== 'confirmed') {
      const state = context.identity?.identity.state ?? 'unresolved';
      settle(id, 'skipped', `Skipped because parcel identity is ${state}. This lane produces parcel-specific findings that would be unsupported without a confirmed parcel.`, {
        durationMs: clockMs() - startMs,
      });
      return null;
    }

    const budget = options.timeoutMsOverride ?? definition.timeoutMs;
    const timer = timeoutAfter(budget);
    try {
      const outcome = await Promise.race([collector(context), timer.promise]);
      const items = outcome.evidence ?? [];
      evidence.push(...items);
      settle(id, outcome.status, outcome.summary, {
        durationMs: clockMs() - startMs,
        evidenceCount: items.length,
        failureCategory: null,
        failureMessage: null,
        retryable: false,
      });
      return outcome;
    } catch (error) {
      const failure = classifyFailure(error);
      settle(id, 'failed', failure.message, {
        durationMs: clockMs() - startMs,
        failureCategory: failure.category,
        failureMessage: failure.message,
        retryable: failure.retryable,
      });
      return null;
    } finally {
      timer.cancel();
    }
  };

  const waves = specialistWaves();
  for (const wave of waves) {
    await Promise.all(wave.map(async (id) => {
      switch (id) {
        case 'parcel_identity': {
          const outcome = await runCollector(id, options.collectors.parcel_identity);
          if (outcome?.data) {
            context.identity = outcome.data;
            facts.push(...outcome.data.facts);
          }
          return;
        }
        case 'government_records': {
          const outcome = await runCollector(id, options.collectors.government_records);
          if (outcome?.data) governmentRecords.push(...outcome.data.records);
          return;
        }
        case 'zoning_land_use': {
          const outcome = await runCollector(id, options.collectors.zoning_land_use);
          if (outcome?.data) {
            collected.zoning = outcome.data;
            dueDiligence.push(...outcome.data.items);
            facts.push(...outcome.data.facts);
          }
          return;
        }
        case 'environmental_terrain': {
          const outcome = await runCollector(id, options.collectors.environmental_terrain);
          if (outcome?.data) {
            collected.environmental = outcome.data;
            dueDiligence.push(...outcome.data.items);
          }
          return;
        }
        case 'access_utilities': {
          const outcome = await runCollector(id, options.collectors.access_utilities);
          if (outcome?.data) {
            collected.accessUtilities = outcome.data;
            dueDiligence.push(...outcome.data.items);
          }
          return;
        }
        case 'comparables': {
          const outcome = await runCollector(id, options.collectors.comparables);
          if (outcome?.data) {
            collected.comparables = outcome.data;
            context.comparables = outcome.data;
          }
          return;
        }
        case 'market_intelligence': {
          const outcome = await runCollector(id, options.collectors.market_intelligence);
          if (outcome?.data) facts.push(...outcome.data.facts);
          return;
        }
        case 'evidence_visuals': {
          await runCollector(id, options.collectors.evidence_visuals);
          return;
        }
        case 'valuation_strategy':
        case 'synthesis_review':
          // Deterministic synthesis stages run after the collector waves.
          return;
        default:
          return;
      }
    }));
  }

  // ── Valuation + strategy (deterministic synthesis over what was collected) ──
  const identity = context.identity?.identity ?? UNRESOLVED_IDENTITY;
  const subjectMarket: SubjectMarket = context.identity?.subjectMarket ?? {};
  const policy = applyCompSourcePolicy(subjectMarket, collected.comparables?.candidates ?? []);

  const valuationStart = clockMs();
  write({ ...records.get('valuation_strategy')!, status: 'running', startedAt: now() });
  const valuation = buildPropertyIntelligenceValuation({
    identityState: identity.state,
    subjectAcres: context.identity?.subjectAcres ?? null,
    acreageConflict: context.identity?.acreageConflict ?? false,
    policy,
    constraints: collected.environmental?.constraints ?? [],
    hardRisks: dueDiligence.filter((item) => item.verdict === 'risk').map((item) => `${item.label}: ${item.headline}`),
  });
  const { strategies, recommendation } = buildPropertyIntelligenceStrategies({
    identityState: identity.state,
    subjectAcres: context.identity?.subjectAcres ?? null,
    valuation,
    dueDiligence,
    zoning: collected.zoning?.zoning ?? null,
    zoningKnown: collected.zoning?.zoningKnown ?? false,
    utilitiesKnown: collected.accessUtilities?.utilitiesKnown ?? false,
    utilitiesSummary: collected.accessUtilities?.utilitiesSummary ?? null,
    accessStatus: collected.accessUtilities?.accessStatus ?? 'unknown',
    landHomeCompCount: policy.landHomeOnly.length,
    acceptedSoldCount: policy.acceptedSold.length,
    activeListingCount: policy.acceptedActive.length,
    missionBlockers: extraBlockers,
  });
  settle(
    'valuation_strategy',
    valuation.priceable ? 'completed' : 'partial',
    valuation.priceable
      ? `Value band $${valuation.range!.low.toLocaleString()}–$${valuation.range!.high.toLocaleString()} (${valuation.confidence} confidence); recommended path: ${recommendation.preferredStrategy ?? 'none yet'}.`
      : `Not priceable: ${valuation.notPriceableReason}`,
    { durationMs: clockMs() - valuationStart },
  );

  // ── Synthesis + quality review ────────────────────────────────────────────
  // The reviewer settles FIRST, because the joined snapshot must carry the
  // reviewer's own final state. A join taken while the reviewer is still
  // running would report the whole mission as running.
  const synthesisStart = clockMs();
  write({ ...records.get('synthesis_review')!, status: 'running', startedAt: now() });
  const missingRequired = PROPERTY_INTELLIGENCE_SPECIALISTS
    .filter((definition) => definition.role === 'required' && definition.id !== 'synthesis_review')
    .map((definition) => records.get(definition.id)!)
    .filter((record) => record.status !== 'completed' && record.status !== 'partial');
  settle(
    'synthesis_review',
    missingRequired.length === 0 ? 'completed' : 'partial',
    missingRequired.length === 0
      ? `Joined every specialist result into one snapshot with no missing required contribution.`
      : `Joined the available results; ${missingRequired.length} required contribution(s) are missing: ${missingRequired.map((r) => r.label).join(', ')}.`,
    { durationMs: clockMs() - synthesisStart, evidenceCount: evidence.length },
  );

  const completedAt = now();
  const finalSpecialists = PROPERTY_INTELLIGENCE_SPECIALISTS.map((definition) => records.get(definition.id)!);
  const finalSnapshot = joinPropertyIntelligence({
    dealCardId: options.dealCardId,
    runId,
    sequence: store.getRun(runId)?.sequence ?? 1,
    startedAt,
    completedAt,
    identity,
    facts,
    governmentRecords,
    dueDiligence,
    comps: compsSection(policy, collected.comparables?.duplicatesMerged ?? 0),
    valuation,
    strategies,
    recommendation,
    evidence,
    specialists: finalSpecialists,
    extraBlockers,
  });

  store.completeRun({
    runId,
    dealCardId: options.dealCardId,
    status: finalSnapshot.status,
    completedAt,
    snapshot: finalSnapshot,
  });

  return finalSnapshot;
}

/** Convenience for callers that want the finished snapshot (tests, CLI). */
export async function runPropertyIntelligenceMission(options: MissionOptions): Promise<PropertyIntelligenceSnapshot | null> {
  const { completion } = launchPropertyIntelligenceMission(options);
  return completion;
}
