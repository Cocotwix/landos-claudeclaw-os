// Deal Intelligence assembly — the Operator stage of Phase 5 Item 20.
//
// When the required child missions settle, the OPERATOR assembles the exact
// input package the Analyst will evaluate. That is all this module does.
//
// It is deliberately the narrowest stage in the pipeline:
//   • It does NOT collect. Every value here was already handed back by a child.
//   • It does NOT analyse. It forms no conclusion, no value, no posture.
//   • It does NOT persist or present.
//
// Keeping it separate is the point of the phase: collection, orchestration,
// assembly, analysis, persistence and presentation each evolve on their own,
// instead of returning to one oversized report function that did all six.
//
// The one judgement it does make is an honesty rule: a lane that did not
// contribute is recorded as a NAMED gap on the package. The Analyst is never
// handed a package that looks complete when it is not, and a gap always says
// which specialist owned the lane and why the contribution is missing.
//
// Pure. No database, no clock, no I/O.

import type {
  ComparablesHandback,
  EnvironmentalHandback,
  EvidenceHandback,
  GovernmentRecordsHandback,
  MarketPulseHandback,
  StrategyHandback,
  SubjectResearchHandback,
  UtilitiesAccessHandback,
  ValuationHandback,
  ZoningHandback,
} from './deal-intelligence-mission.js';
import type { MissionChildState, MissionJoin } from './mission-graph.js';
import type {
  SnapshotComps,
  SnapshotDueDiligenceItem,
  SnapshotEvidenceItem,
  SnapshotFact,
  SnapshotIdentity,
  SnapshotRecommendation,
  SnapshotSpecialistRecord,
  SnapshotStrategy,
  SnapshotValuation,
} from './property-intelligence-snapshot.js';
import type { SpecialistId, SpecialistStatus } from './property-intelligence-specialists.js';

/** Identity used when the subject-research lane delivered nothing at all. */
export const UNRESOLVED_ASSEMBLY_IDENTITY: SnapshotIdentity = {
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
  explanation: 'The parcel and LandPortal subject-research lane did not contribute a usable identity, so the subject parcel is not identified and nothing parcel-specific is asserted.',
};

/** The comps section used when no valuation lane contributed one. */
export const EMPTY_COMPS: SnapshotComps = {
  policyExplanation: 'No comparable set was assembled, because the valuation lane did not contribute a comp policy result.',
  landPortalUsable: false,
  landPortalRowsSeen: 0,
  caps: { zillow: 0, redfin: 0 },
  sold: [],
  active: [],
  landHomeOnly: [],
  rejected: [],
  duplicatesMerged: 0,
  summaryLine: 'No comparable evidence is available from this run.',
};

/** The valuation used when the valuation lane did not contribute. */
export const UNPRICED_VALUATION: SnapshotValuation = {
  priceable: false,
  range: null,
  pricePerAcreRange: null,
  likelyRetail: null,
  dispositionRange: null,
  basis: 'No value basis exists: the valuation lane did not contribute a result to this run.',
  adjustments: [],
  confidence: 'none',
  uncertainty: [],
  materialGaps: [],
  notPriceableReason: 'The valuation lane did not contribute a result, so no value is stated for this parcel.',
  nextActionToPrice: 'Re-run Property Intelligence so the valuation lane can complete.',
};

export const NO_RECOMMENDATION: SnapshotRecommendation = {
  preferredStrategy: null,
  why: 'The five-strategy lane did not contribute, so no acquisition path is recommended from this run.',
  whatWouldChangeIt: ['A completed strategy lane on a finished valuation.'],
  posture: 'undetermined',
  postureWhy: 'No posture is asserted while the strategy evaluation is missing.',
};

/** A lane that did not contribute, in the operator's words. */
export interface AssemblyGap {
  key: string;
  label: string;
  role: 'required' | 'supporting';
  status: string;
  acceptanceState: string;
  agentName: string;
  group: string;
  reason: string;
}

/** The exact input package the Analyst evaluates. Nothing more, nothing less. */
export interface DealIntelligenceInputPackage {
  dealCardId: number;
  missionId: string;
  identity: SnapshotIdentity;
  facts: SnapshotFact[];
  governmentRecords: SnapshotFact[];
  dueDiligence: SnapshotDueDiligenceItem[];
  comps: SnapshotComps;
  valuation: SnapshotValuation;
  strategies: SnapshotStrategy[];
  recommendation: SnapshotRecommendation;
  evidence: SnapshotEvidenceItem[];
  specialists: SnapshotSpecialistRecord[];
  /** Every lane that did not contribute, required or supporting. */
  gaps: AssemblyGap[];
  /** The subset the parent must treat as a real gap. */
  requiredGaps: AssemblyGap[];
  /** Mission-level statements the Analyst must carry into the snapshot. */
  missionOutcome: string;
  missionStatus: MissionJoin['status'];
  /** Set only when the mission itself could not deliver a coherent package. */
  packageBlockers: string[];
  /** Counts the Analyst uses without re-deriving them. */
  counts: {
    childrenTotal: number;
    contributed: number;
    accepted: number;
    incomplete: number;
  };
}

const CONTRIBUTED: readonly string[] = ['completed', 'partial'];

function toGap(child: MissionChildState): AssemblyGap {
  const acceptanceState = child.acceptance?.state ?? 'not_evaluated';
  const reason =
    child.status === 'rejected' && child.acceptance?.reason
      ? child.acceptance.reason
      : child.failureMessage ?? child.summary ?? `Ended as ${child.status} with no stated reason.`;
  return {
    key: child.key,
    label: child.label,
    role: child.role,
    status: child.status,
    acceptanceState,
    agentName: child.identity.agentName,
    group: child.identity.group,
    reason,
  };
}

/**
 * Every child becomes a specialist record on the snapshot, contributing or not.
 *
 * A lane that failed, was rejected, blocked or skipped keeps its row. Dropping
 * it would make the snapshot read as though the mission had fewer lanes than it
 * actually dispatched, which is exactly how a gap disappears.
 */
export function assemblySpecialistRecords(children: MissionChildState[]): SnapshotSpecialistRecord[] {
  return children.map((child) => ({
    id: child.key as SpecialistId,
    label: child.label,
    role: child.role,
    // `rejected` and `cancelled` have no snapshot equivalent; both mean the lane
    // delivered nothing usable, so they are surfaced as `failed` with the
    // acceptance reason carried in the message rather than being softened.
    status: mapChildStatus(child.status),
    startedAt: child.startedAt,
    completedAt: child.completedAt,
    durationMs: child.durationMs,
    summary: child.summary,
    failureCategory: (child.failureCategory as SnapshotSpecialistRecord['failureCategory']) ?? null,
    failureMessage:
      child.status === 'rejected'
        ? child.acceptance?.reason ?? child.failureMessage
        : child.failureMessage,
    retryable: child.retryable,
    evidenceCount: evidenceCountOf(child),
  }));
}

export function mapChildStatus(status: MissionChildState['status']): SpecialistStatus {
  switch (status) {
    case 'completed': return 'completed';
    case 'partial': return 'partial';
    case 'blocked': return 'blocked';
    case 'skipped': return 'skipped';
    case 'running': return 'running';
    case 'queued': return 'queued';
    default: return 'failed';
  }
}

function evidenceCountOf(child: MissionChildState): number {
  const result = child.result as { evidence?: unknown[]; evidenceCount?: number } | null;
  if (!result || typeof result !== 'object') return 0;
  if (typeof result.evidenceCount === 'number') return result.evidenceCount;
  return Array.isArray(result.evidence) ? result.evidence.length : 0;
}

function slot<T>(join: MissionJoin, key: string): T | null {
  const value = join.contributions?.[key];
  return value && typeof value === 'object' ? (value as T) : null;
}

/**
 * Assemble the Analyst's input package from a joined parent mission.
 *
 * Contributions are read by CHILD KEY (not by slot) because the child key is
 * what the gap list, the specialist rows and the mission panel all name; reading
 * one thing by two different identifiers is how a contribution and its gap end
 * up disagreeing.
 */
export function assembleDealIntelligencePackage(input: {
  dealCardId: number;
  missionId: string;
  join: MissionJoin;
  children: MissionChildState[];
}): DealIntelligenceInputPackage {
  const { join, children } = input;

  const subject = slot<SubjectResearchHandback>(join, 'parcel_identity');
  const government = slot<GovernmentRecordsHandback>(join, 'government_records');
  const zoning = slot<ZoningHandback>(join, 'zoning_land_use');
  const environmental = slot<EnvironmentalHandback>(join, 'environmental_terrain');
  const access = slot<UtilitiesAccessHandback>(join, 'access_utilities');
  const comparables = slot<ComparablesHandback>(join, 'comparables');
  const market = slot<MarketPulseHandback>(join, 'market_intelligence');
  const evidenceLane = slot<EvidenceHandback>(join, 'evidence_visuals');
  const valuationLane = slot<ValuationHandback>(join, 'valuation');
  const strategyLane = slot<StrategyHandback>(join, 'strategy');

  // Facts arrive from more than one lane. They are concatenated in read order —
  // subject identity first, then zoning, then market — so the operator sees the
  // parcel before the market it sits in.
  const facts: SnapshotFact[] = [
    ...(subject?.facts ?? []),
    ...(zoning?.facts ?? []),
    ...(market?.facts ?? []),
  ];

  const dueDiligence: SnapshotDueDiligenceItem[] = [
    ...(zoning?.items ?? []),
    ...(environmental?.items ?? []),
    ...(access?.items ?? []),
  ];

  const evidence: SnapshotEvidenceItem[] = [
    ...(evidenceLane?.evidence ?? []),
    ...(government?.evidence ?? []),
  ];

  const nonContributing = children.filter((child) => !CONTRIBUTED.includes(child.status));
  const gaps = nonContributing.map(toGap);

  const packageBlockers: string[] = [];
  if (!subject) {
    packageBlockers.push(
      'The parcel and LandPortal subject-research lane did not contribute, so this package carries no identified subject parcel and no parcel-specific conclusion may be drawn from it.',
    );
  }
  if (!valuationLane) {
    packageBlockers.push('The valuation lane did not contribute, so this package carries no value conclusion.');
  }
  if (comparables && comparables.governmentVerificationPerformed !== false) {
    // Defence in depth. Acceptance already refuses this handback; if one ever
    // reached assembly, the package says so rather than quietly using it.
    packageBlockers.push(
      'The comparable lane reported government-record verification on comparable properties, which is out of scope for discovery-stage comps. Its result is carried as unverified and is not treated as validated comp evidence.',
    );
  }

  return {
    dealCardId: input.dealCardId,
    missionId: input.missionId,
    identity: subject?.identity ?? UNRESOLVED_ASSEMBLY_IDENTITY,
    facts,
    governmentRecords: government?.records ?? [],
    dueDiligence,
    comps: valuationLane?.comps ?? EMPTY_COMPS,
    valuation: valuationLane?.valuation ?? UNPRICED_VALUATION,
    strategies: strategyLane?.strategies ?? [],
    recommendation: strategyLane?.recommendation ?? NO_RECOMMENDATION,
    evidence,
    specialists: assemblySpecialistRecords(children),
    gaps,
    requiredGaps: gaps.filter((gap) => gap.role === 'required'),
    missionOutcome: join.outcome,
    missionStatus: join.status,
    packageBlockers,
    counts: {
      childrenTotal: children.length,
      contributed: join.contributed?.length ?? 0,
      accepted: join.accepted?.length ?? 0,
      incomplete: join.incomplete?.length ?? 0,
    },
  };
}
