// LandOS — Research Readiness Manifest (pure, deterministic).
//
// ONE checklist per Deal Card answering, for every research item LandOS should
// have on a property:
//
//   Was it expected?  Did it run?  Did the run technically succeed?
//   Did it return USABLE evidence?  Is that evidence current?
//   Is it honestly unresolved despite a proper attempt?
//   Can LandOS retry it automatically, or does a human have to?
//
// The rule this module exists to enforce: "THE WORKFLOW RAN" is not the same
// fact as "WE GOT A USABLE ANSWER", and the manifest tracks them separately. A
// zoning lane that searched every official source correctly and still could not
// establish the district RAN SUCCESSFULLY and produced NO usable answer. That is
// not a failure to retry, and it is not a result to build on. It is its own
// state, and it must never loop.
//
// Nothing here asks a language model for a status. Every value is derived from a
// deterministic probe of retained LandOS state (research-readiness-reconcile.ts
// builds those probes; this module decides what they mean).
//
// Pure + deterministic. No I/O, no clock of its own — the caller passes `now`.

/**
 * The five operator states.
 *
 *   green  — ran and returned enough usable evidence for downstream intelligence
 *   yellow — a proper attempt ran and honestly established no firm answer
 *   red    — never ran, failed, or produced nothing usable for a recoverable reason
 *   blue   — usable evidence exists but is stale enough to want a refresh
 *   gray   — expected unknown, human follow-up, or not applicable to this property
 */
import type { KnowledgeResearchPlanCounts } from './knowledge-contract.js';
import type { CapabilityPrerequisite, CapabilityPrerequisiteClause } from './capability-contract.js';
import type { ResearchResultState } from './research-lane-outcome.js';

export type ResearchReadinessStatus = 'green' | 'yellow' | 'red' | 'blue' | 'gray';

/** Which future intelligence layer consumes this item. */
export type ResearchReadinessGroup = 'property' | 'market' | 'seller';

/** Who obtains this item's data. Only a registered capability may be backfilled. */
export interface ResearchReadinessOwner {
  kind: 'capability' | 'operator_surface' | 'human';
  /** A registered LandOS capability id. Present only when kind is 'capability'. */
  capabilityId: string | null;
  label: string;
}

export interface ResearchReadinessItemDefinition {
  id: string;
  label: string;
  group: ResearchReadinessGroup;
  /** The business question the item answers, for the expanded operator view. */
  question: string;
  owner: ResearchReadinessOwner;
  /**
   * May targeted backfill invoke this item's owner automatically?
   *
   * True ONLY where a registered capability owns the item. An item whose data
   * comes from an operator surface or a human is reported honestly and left
   * alone: V1 never invents a second research implementation to close it.
   */
  machineBackfill: boolean;
  /**
   * LandOS does not expect to answer this by machine at all (seller contact,
   * perc test, survey-grade frontage, recorded title review). These stay gray
   * until real evidence arrives and NEVER trigger automated research.
   */
  humanExpected: boolean;
  /**
   * Days after which usable evidence is treated as stale (blue). `null` means
   * the item does not go stale on a timer in V1 — only market-sensitive items
   * carry a window, because only they actually age.
   */
  freshnessDays: number | null;
  /**
   * A red machine gap here BLOCKS the group's future intelligence layer.
   * A yellow unresolved input never blocks: the intelligence layer is required
   * to reason with honest unknowns.
   */
  intelligenceCritical: boolean;
  /**
   * Minimum subject context THIS item requires (see CapabilityPrerequisite).
   * Absent means the item is parcel-scoped (the historical default); an item
   * that needs only county/ZIP or nothing declares so and is never invalidated
   * by a missing exact parcel.
   */
  prerequisites?: CapabilityPrerequisiteClause[];
}

/** The declared prerequisites of one checklist item, defaulted honestly:
 *  undeclared items are parcel-scoped research. */
export function researchItemPrerequisites(definition: ResearchReadinessItemDefinition): CapabilityPrerequisiteClause[] {
  return definition.prerequisites ?? ['parcel'];
}

/**
 * The V1 checklist.
 *
 * Adding an item later is a one-entry change here plus one probe in the
 * reconciler; nothing else in the system needs to know the list grew.
 */
export const RESEARCH_READINESS_ITEMS: readonly ResearchReadinessItemDefinition[] = [
  // ── Property / site ──────────────────────────────────────────────────────
  {
    id: 'property_resolution',
    label: 'Property Resolution',
    group: 'property',
    question: 'Which exact parcel is this, and is its identity confirmed?',
    owner: { kind: 'capability', capabilityId: 'property-resolution', label: 'Property Resolution' },
    machineBackfill: true,
    humanExpected: false,
    freshnessDays: null,
    intelligenceCritical: true,
    // Resolution ESTABLISHES the subject; it requires nothing but raw input.
    prerequisites: [],
  },
  {
    id: 'landportal_research',
    label: 'LandPortal Research',
    group: 'property',
    question: 'What does the LandPortal parcel record hold for this subject?',
    owner: { kind: 'capability', capabilityId: 'landportal-research', label: 'LandPortal Research' },
    machineBackfill: true,
    humanExpected: false,
    freshnessDays: null,
    intelligenceCritical: true,
  },
  {
    id: 'assessor_tax',
    label: 'Assessor / Tax',
    group: 'property',
    question: 'What do the assessor roll and the tax collector say about this parcel?',
    owner: { kind: 'capability', capabilityId: 'assessor-tax', label: 'Assessor & Tax' },
    machineBackfill: true,
    humanExpected: false,
    freshnessDays: null,
    intelligenceCritical: true,
  },
  {
    id: 'official_parcel_record',
    label: 'Official parcel record',
    group: 'property',
    question: 'Has an official government parcel or GIS record been retrieved for this parcel?',
    owner: { kind: 'operator_surface', capabilityId: null, label: 'Official Parcel & GIS' },
    machineBackfill: false,
    humanExpected: false,
    freshnessDays: null,
    intelligenceCritical: false,
  },
  {
    id: 'current_zoning',
    label: 'Current Zoning',
    group: 'property',
    question: 'What zoning district governs this parcel today?',
    owner: { kind: 'capability', capabilityId: 'zoning-subdivision', label: 'Zoning & Subdivision' },
    machineBackfill: true,
    humanExpected: false,
    freshnessDays: null,
    intelligenceCritical: true,
  },
  {
    id: 'subdivision_rules',
    label: 'Subdivision Rules',
    group: 'property',
    question: 'What land-division rules apply here, and what is achievable by right?',
    owner: { kind: 'capability', capabilityId: 'zoning-subdivision', label: 'Zoning & Subdivision' },
    machineBackfill: true,
    humanExpected: false,
    freshnessDays: null,
    intelligenceCritical: true,
  },
  {
    id: 'property_development_history',
    label: 'Development History',
    group: 'property',
    question: 'What has already been sought, approved, denied or abandoned on this parcel?',
    owner: {
      kind: 'capability',
      capabilityId: 'property-development-history',
      label: 'Property Development History',
    },
    machineBackfill: true,
    humanExpected: false,
    freshnessDays: null,
    intelligenceCritical: false,
  },
  {
    id: 'visual_evidence',
    label: 'Visual Evidence',
    group: 'property',
    question: 'Do parcel-associated visuals exist for this property?',
    owner: { kind: 'operator_surface', capabilityId: null, label: 'Visual capture' },
    machineBackfill: false,
    humanExpected: false,
    freshnessDays: null,
    intelligenceCritical: false,
  },
  // Access and frontage are SEPARATE facts, answered by different evidence at
  // different stages. A parcel can plainly front a recognized road — access
  // established at discovery — while the exact frontage figure is still
  // disputed between retained sources; and a parcel reached by a recorded
  // easement can have access with little or no direct public-road frontage.
  // One label over both would have to lie about one of them.
  {
    id: 'access',
    label: 'Access',
    group: 'property',
    question: 'Does this property have an established way in at the acquisition-screening stage?',
    owner: { kind: 'capability', capabilityId: 'landportal-research', label: 'LandPortal Research' },
    machineBackfill: true,
    humanExpected: false,
    freshnessDays: null,
    intelligenceCritical: false,
  },
  {
    id: 'road_frontage',
    label: 'Road Frontage',
    group: 'property',
    question: 'How much road frontage does the subject have?',
    owner: { kind: 'capability', capabilityId: 'landportal-research', label: 'LandPortal Research' },
    machineBackfill: true,
    humanExpected: false,
    freshnessDays: null,
    intelligenceCritical: false,
  },
  // Public service and its onsite fallback, four separate questions. Water and
  // sewer are independently screenable and routinely disagree; the well and
  // septic outlooks exist ONLY as the fallback when the matching public service
  // is not established, and are screens, never determinations.
  {
    id: 'public_water',
    label: 'Public Water',
    group: 'property',
    question: 'Does public water appear available to or immediately serving this subject?',
    owner: { kind: 'capability', capabilityId: 'utility-service-screen', label: 'Utility Service Screen' },
    machineBackfill: true,
    humanExpected: false,
    freshnessDays: null,
    intelligenceCritical: false,
  },
  {
    id: 'public_sewer',
    label: 'Public Sewer',
    group: 'property',
    question: 'Does public sewer appear available to or immediately serving this subject?',
    owner: { kind: 'capability', capabilityId: 'utility-service-screen', label: 'Utility Service Screen' },
    machineBackfill: true,
    humanExpected: false,
    freshnessDays: null,
    intelligenceCritical: false,
  },
  {
    id: 'well_outlook',
    label: 'Well Outlook',
    group: 'property',
    question: 'Where public water is not established, does a private well look easy, moderate, or difficult here?',
    owner: { kind: 'capability', capabilityId: 'utility-service-screen', label: 'Utility Service Screen' },
    machineBackfill: true,
    humanExpected: false,
    freshnessDays: null,
    intelligenceCritical: false,
  },
  {
    id: 'septic_outlook',
    label: 'Septic Outlook',
    group: 'property',
    question: 'Where public sewer is not established, how promising does septic look on the retained subject soils?',
    owner: { kind: 'capability', capabilityId: 'utility-service-screen', label: 'Utility Service Screen' },
    machineBackfill: true,
    humanExpected: false,
    freshnessDays: null,
    intelligenceCritical: false,
  },

  // ── Value / market ───────────────────────────────────────────────────────
  {
    id: 'comps_collection',
    label: 'Comps Collection',
    group: 'market',
    question: 'Are there acceptable closed sales to value this parcel against?',
    owner: { kind: 'capability', capabilityId: 'comps-valuation', label: 'Comps & Valuation' },
    machineBackfill: true,
    humanExpected: false,
    freshnessDays: 180,
    intelligenceCritical: true,
  },
  {
    id: 'valuation',
    label: 'Valuation',
    group: 'market',
    question: 'What is this parcel worth on the retained comparable evidence?',
    owner: { kind: 'capability', capabilityId: 'comps-valuation', label: 'Comps & Valuation' },
    machineBackfill: true,
    humanExpected: false,
    freshnessDays: 180,
    intelligenceCritical: true,
  },
  {
    id: 'market_statistics',
    label: 'Market Statistics',
    group: 'market',
    question: 'What is the current measured market for this area and acreage band?',
    owner: { kind: 'operator_surface', capabilityId: null, label: 'Market Matrix / Market Research' },
    machineBackfill: false,
    humanExpected: false,
    freshnessDays: 120,
    intelligenceCritical: true,
    // Market geography: county (macro) OR ZIP (local pocket) suffices; never
    // frozen by exact-parcel resolution.
    prerequisites: [['county', 'zip']],
  },
  {
    id: 'area_market_context',
    label: 'Area Market Context',
    group: 'market',
    question: 'How does the surrounding county and region behave for land like this?',
    owner: { kind: 'operator_surface', capabilityId: null, label: 'Market Pulse' },
    machineBackfill: false,
    humanExpected: false,
    freshnessDays: 120,
    intelligenceCritical: false,
    prerequisites: [['county', 'zip']],
  },

  // ── Deal / seller ────────────────────────────────────────────────────────
  {
    id: 'seller_information',
    label: 'Seller Information',
    group: 'seller',
    question: 'Who is selling, what is their authority, and what have they stated?',
    owner: { kind: 'human', capabilityId: null, label: 'Seller discovery' },
    machineBackfill: false,
    humanExpected: true,
    freshnessDays: null,
    intelligenceCritical: false,
    // Seller work depends on the seller, not the parcel.
    prerequisites: [],
  },
];

const ITEM_BY_ID = new Map(RESEARCH_READINESS_ITEMS.map((item) => [item.id, item]));

export function researchReadinessItem(itemId: string): ResearchReadinessItemDefinition | null {
  return ITEM_BY_ID.get(itemId) ?? null;
}

/**
 * One deterministic reading of retained LandOS state for one checklist item.
 *
 * The reconciler fills this in from what already exists. It never runs research
 * to answer these questions.
 */
export interface ResearchReadinessProbe {
  itemId: string;
  /** False when the item genuinely does not apply to this property. Default true. */
  applicable?: boolean;
  /** A run of the owning capability or workflow is on record. */
  attempted: boolean;
  /** The recorded run completed without a system-level failure. */
  technicalSuccess: boolean;
  /** The run left behind evidence downstream intelligence can actually use. */
  usableEvidence: boolean;
  /**
   * The attempt was proper and complete, and the answer is honestly not
   * established. Distinguishes an unresolved result (yellow, never retried
   * automatically) from a run that produced nothing for a recoverable reason
   * such as an unavailable lane (red, a backfill candidate).
   */
  unresolved?: boolean;
  /** A usable but incomplete return, distinct from a fully unresolved answer. */
  partial?: boolean;
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
  /** Concise operator-facing explanation of the state. */
  reason: string;
  /** Concise operator-facing next action. Omitted when nothing is needed. */
  nextAction?: string | null;
  /** Shared jurisdiction knowledge plan when this checklist item consumes it. */
  knowledgePlan?: KnowledgeResearchPlanCounts | null;
}

export interface ResearchReadinessManifestItem {
  id: string;
  label: string;
  group: ResearchReadinessGroup;
  question: string;
  status: ResearchReadinessStatus;
  statusLabel: string;
  /** The capability or surface that owns this item's data. */
  owner: ResearchReadinessOwner;
  /** True only for a red/blue item a registered capability can close automatically. */
  machineBackfillAllowed: boolean;
  attempted: boolean;
  technicalSuccess: boolean;
  usableEvidence: boolean;
  partial: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  reason: string;
  nextAction: string | null;
  /** A red machine gap on an intelligence-critical item. */
  blocksIntelligence: boolean;
  knowledgePlan: KnowledgeResearchPlanCounts | null;
  /** The item's declared minimum context (defaulted: parcel-scoped). */
  prerequisites: CapabilityPrerequisiteClause[];
  /** Declared prerequisites the current subject does not yet satisfy. A
   *  non-empty list means "waiting on subject context", which is neither
   *  BLOCKED (source exhausted) nor a failure — the item simply cannot be
   *  attempted yet, and it must never invalidate items that CAN. */
  unmetPrerequisites: CapabilityPrerequisite[];
}

export interface ResearchReadinessGroupState {
  group: ResearchReadinessGroup | 'deal';
  label: string;
  /** No blocking machine gap remains — the future intelligence layer may run. */
  ready: boolean;
  readyCount: number;
  total: number;
  /** Red, machine-owned, intelligence-critical: real gaps LandOS can still close. */
  blockingMachineGaps: string[];
  /** Yellow: a proper attempt established no answer. Intelligence reasons around these. */
  knownUnresolvedInputs: string[];
  /** Gray: expected unknown, human follow-up, or not applicable. */
  expectedUnknowns: string[];
  /** Blue: usable but aged. */
  staleInputs: string[];
}

export interface ResearchReadinessCounts {
  total: number;
  ready: number;
  needsMachineAttention: number;
  unresolved: number;
  stale: number;
  expectedUnknown: number;
}

export interface ResearchReadinessManifest {
  contractVersion: 'research-readiness-manifest-v1';
  dealCardId: number;
  propertyCardId: number | null;
  generatedAt: string;
  items: ResearchReadinessManifestItem[];
  counts: ResearchReadinessCounts;
  /** "8 / 15 ready" — the compact strip's headline. */
  headline: string;
  groups: {
    property: ResearchReadinessGroupState;
    market: ResearchReadinessGroupState;
    seller: ResearchReadinessGroupState;
    deal: ResearchReadinessGroupState;
  };
  /** Item ids a targeted backfill would run right now, stale items excluded. */
  backfillCandidates: string[];
  /** One operator-facing projection over the internal workflow accounting. */
  operatorCompleteness: OperatorResearchCompleteness;
}

export type OperatorResearchOutcome = 'returned' | 'partial' | 'unresolved' | 'blocked' | 'waiting' | 'not_required';

export interface OperatorResearchCompleteness {
  returned: number;
  denominator: number;
  partial: number;
  unresolved: number;
  blocked: number;
  /** Items whose own declared subject context (parcel, county, …) is not
   *  available yet. Waiting is not blocked: no source refused anything. */
  waiting: number;
  notRequired: number;
  headline: string;
  items: Array<{ id: string; label: string; outcome: OperatorResearchOutcome; resultState: ResearchResultState; reason: string }>;
}

export function projectOperatorResearchCompleteness(items: ResearchReadinessManifestItem[]): OperatorResearchCompleteness {
  const projected = items.map((item) => {
    const outcome: OperatorResearchOutcome = item.status === 'gray' ? 'not_required'
      // A red item whose only impediment is its own unmet subject prerequisite
      // is WAITING, not blocked: nothing external refused an answer, and the
      // aggregate the operator reads must not claim it did.
      : item.status === 'red' ? (item.unmetPrerequisites.length > 0 ? 'waiting' : 'blocked')
        : item.status === 'blue' || item.partial ? 'partial'
          : item.status === 'yellow' ? 'unresolved'
            : 'returned';
    const resultState: ResearchResultState = outcome === 'returned' ? 'RETURNED'
      : outcome === 'not_required' ? 'NOT_APPLICABLE'
        : outcome === 'waiting' ? 'NOT_RUN'
          : outcome === 'partial' || outcome === 'unresolved' ? 'PARTIAL'
            : item.attempted && !item.machineBackfillAllowed ? 'NEEDS_OPERATOR_ACTION'
              : 'BLOCKED';
    return { id: item.id, label: item.label, outcome, resultState, reason: item.reason };
  });
  const count = (outcome: OperatorResearchOutcome) => projected.filter((item) => item.outcome === outcome).length;
  const returned = count('returned');
  const notRequired = count('not_required');
  const denominator = projected.length - notRequired;
  return {
    returned,
    denominator,
    partial: count('partial'),
    unresolved: count('unresolved'),
    blocked: count('blocked'),
    waiting: count('waiting'),
    notRequired,
    headline: `${returned} / ${denominator} Returned`,
    items: projected,
  };
}

const STATUS_LABEL: Record<ResearchReadinessStatus, string> = {
  green: 'Ready',
  yellow: 'Unresolved',
  red: 'Missing',
  blue: 'Stale',
  gray: 'Expected unknown',
};

export function researchReadinessStatusLabel(status: ResearchReadinessStatus): string {
  return STATUS_LABEL[status];
}

const GROUP_LABEL: Record<ResearchReadinessGroup | 'deal', string> = {
  property: 'Property readiness',
  market: 'Market readiness',
  seller: 'Seller readiness',
  deal: 'Deal readiness',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function isStale(definition: ResearchReadinessItemDefinition, lastSuccessAt: string | null, nowMs: number): boolean {
  if (definition.freshnessDays == null || !lastSuccessAt) return false;
  const at = Date.parse(lastSuccessAt);
  if (!Number.isFinite(at)) return false;
  return nowMs - at > definition.freshnessDays * DAY_MS;
}

/**
 * The whole status system, in one place.
 *
 * Order matters. Usable evidence wins before anything else, because an item that
 * HAS an answer is ready whatever its run history looked like; a human item
 * without evidence is an expected unknown, never a failure; and the two ways of
 * having no answer — a proper attempt that resolved nothing, and a run that
 * never happened or broke — are kept apart at the bottom.
 */
export function deriveResearchReadinessStatus(
  definition: ResearchReadinessItemDefinition,
  probe: ResearchReadinessProbe,
  nowMs: number,
): ResearchReadinessStatus {
  if (probe.applicable === false) return 'gray';
  if (probe.knowledgePlan?.expected) {
    if (probe.knowledgePlan.blockedConflict > 0) return 'yellow';
    if (probe.knowledgePlan.researchNew > 0) return 'red';
    if (probe.knowledgePlan.refresh > 0) return 'blue';
    if (probe.knowledgePlan.reuse === probe.knowledgePlan.expected) return 'green';
  }
  if (probe.usableEvidence) {
    return isStale(definition, probe.lastSuccessAt ?? null, nowMs) ? 'blue' : 'green';
  }
  if (definition.humanExpected) return 'gray';
  if (!probe.attempted) return 'red';
  if (!probe.technicalSuccess) return 'red';
  return probe.unresolved ? 'yellow' : 'red';
}

function defaultReason(
  definition: ResearchReadinessItemDefinition,
  status: ResearchReadinessStatus,
): string {
  switch (status) {
    case 'green':
      return `${definition.label} returned usable evidence.`;
    case 'blue':
      return `${definition.label} has a usable result, but it is older than this item's ${definition.freshnessDays}-day window.`;
    case 'yellow':
      return `${definition.label} ran properly and did not establish a firm answer.`;
    case 'gray':
      return definition.humanExpected
        ? `${definition.label} is an expected unknown until a human supplies it.`
        : `${definition.label} does not apply to this property.`;
    default:
      return `${definition.label} has not produced a usable result.`;
  }
}

function defaultNextAction(
  definition: ResearchReadinessItemDefinition,
  status: ResearchReadinessStatus,
): string | null {
  if (status === 'green') return null;
  if (status === 'gray') {
    return definition.humanExpected
      ? `Capture ${definition.label.toLowerCase()} from the operator or the seller.`
      : null;
  }
  if (status === 'yellow') {
    // Never "retry": a proper attempt already ran. The operator may still
    // choose to, so name the control rather than implying the door is shut.
    return definition.owner.kind === 'operator_surface'
      ? `A further automated attempt is not expected to change this. Use the ${definition.owner.label} control to try again deliberately.`
      : `A further automated attempt is not expected to change this. Resolve ${definition.label.toLowerCase()} through the human or external route.`;
  }
  return definition.machineBackfill
    ? `Run ${definition.owner.label}.`
    : `Use the ${definition.owner.label} control — no registered capability owns this item.`;
}

function groupState(
  group: ResearchReadinessGroup | 'deal',
  items: ResearchReadinessManifestItem[],
): ResearchReadinessGroupState {
  const blockingMachineGaps = items.filter((item) => item.blocksIntelligence).map((item) => item.label);
  return {
    group,
    label: GROUP_LABEL[group],
    ready: blockingMachineGaps.length === 0,
    readyCount: items.filter((item) => item.status === 'green').length,
    total: items.length,
    blockingMachineGaps,
    knownUnresolvedInputs: items.filter((item) => item.status === 'yellow').map((item) => item.label),
    expectedUnknowns: items.filter((item) => item.status === 'gray').map((item) => item.label),
    staleInputs: items.filter((item) => item.status === 'blue').map((item) => item.label),
  };
}

export interface ResearchReadinessManifestInput {
  dealCardId: number;
  propertyCardId: number | null;
  probes: ResearchReadinessProbe[];
  /** ISO timestamp the manifest is generated at. */
  now: string;
  /**
   * Evaluates an item's declared prerequisite clauses against the current
   * canonical subject state (supplied by the reconciler, which owns I/O).
   * Absent = every prerequisite treated as met (legacy callers/tests).
   */
  unmetPrerequisitesFor?: (clauses: readonly CapabilityPrerequisiteClause[]) => CapabilityPrerequisite[];
}

/**
 * Build the manifest. Every checklist item appears exactly once, whether or not
 * the caller supplied a probe for it — a missing probe is an item that has never
 * run, which is a real red, not an omission.
 */
export function buildResearchReadinessManifest(input: ResearchReadinessManifestInput): ResearchReadinessManifest {
  const nowMs = Date.parse(input.now);
  const byId = new Map(input.probes.map((probe) => [probe.itemId, probe]));

  const items: ResearchReadinessManifestItem[] = RESEARCH_READINESS_ITEMS.map((definition) => {
    const probe: ResearchReadinessProbe = byId.get(definition.id) ?? {
      itemId: definition.id,
      attempted: false,
      technicalSuccess: false,
      usableEvidence: false,
      reason: `${definition.label} has no recorded attempt on this Deal Card.`,
    };

    const status = deriveResearchReadinessStatus(definition, probe, nowMs);
    // Ownership, not colour. This flag answers "does a registered capability
    // own this requirement", and the status gate that decides whether to start
    // work lives in the backfill request itself, which already distinguishes
    // red from blue-needs-stale from yellow-needs-unresolved. Folding colour in
    // here made a PARTIAL item report that nothing owns it, so the coverage
    // controller read every partial lane as unattemptable and its documented
    // second-route retry could never fire.
    const prerequisites = researchItemPrerequisites(definition);
    const unmetPrerequisites = input.unmetPrerequisitesFor?.(prerequisites) ?? [];
    // An item whose declared subject context is not yet available genuinely
    // cannot be attempted — that is a prerequisite fact, not a status colour,
    // so folding it here does not repeat the 375dd73 ownership/colour mistake.
    const machineBackfillAllowed = definition.machineBackfill && unmetPrerequisites.length === 0;
    const reason = probe.reason?.trim() || defaultReason(definition, status);
    // An unattemptable item must not carry an actionable instruction ("Run
    // Assessor & Tax.") it cannot honor yet — say what it is waiting for.
    const nextAction = status !== 'green' && unmetPrerequisites.length > 0
      ? `Waiting on ${unmetPrerequisites.map((p) => p === 'parcel' ? 'an established subject parcel' : p.replace(/_/g, ' ')).join(' and ')}.`
      : probe.nextAction?.trim() || defaultNextAction(definition, status);
    return {
      id: definition.id,
      label: definition.label,
      group: definition.group,
      question: definition.question,
      status,
      statusLabel: STATUS_LABEL[status],
      owner: definition.owner,
      machineBackfillAllowed,
      attempted: probe.attempted,
      technicalSuccess: probe.technicalSuccess,
      usableEvidence: probe.usableEvidence,
      partial: probe.partial === true,
      lastAttemptAt: probe.lastAttemptAt ?? null,
      lastSuccessAt: probe.lastSuccessAt ?? null,
      reason,
      nextAction: nextAction ?? null,
      // A gap only BLOCKS when it is red, critical, and a machine could close
      // it. A yellow unresolved input is a known unknown the intelligence layer
      // must reason with, never a blocker.
      blocksIntelligence: status === 'red' && definition.intelligenceCritical && definition.machineBackfill
        && unmetPrerequisites.length === 0,
      knowledgePlan: probe.knowledgePlan ?? null,
      prerequisites,
      unmetPrerequisites,
    };
  });

  const counts: ResearchReadinessCounts = {
    total: items.length,
    ready: items.filter((item) => item.status === 'green').length,
    needsMachineAttention: items.filter((item) => item.status === 'red').length,
    unresolved: items.filter((item) => item.status === 'yellow').length,
    stale: items.filter((item) => item.status === 'blue').length,
    expectedUnknown: items.filter((item) => item.status === 'gray').length,
  };

  const inGroup = (group: ResearchReadinessGroup) => items.filter((item) => item.group === group);
  const operatorCompleteness = projectOperatorResearchCompleteness(items);
  return {
    contractVersion: 'research-readiness-manifest-v1',
    dealCardId: input.dealCardId,
    propertyCardId: input.propertyCardId,
    generatedAt: input.now,
    items,
    counts,
    headline: `${counts.ready} / ${counts.total} ready`,
    groups: {
      property: groupState('property', inGroup('property')),
      market: groupState('market', inGroup('market')),
      seller: groupState('seller', inGroup('seller')),
      deal: groupState('deal', items),
    },
    backfillCandidates: items
      .filter((item) => item.status === 'red' && item.machineBackfillAllowed)
      .map((item) => item.id),
    operatorCompleteness,
  };
}

// ── Targeted backfill selection ──────────────────────────────────────────────

export interface BackfillSelectionRequest {
  /**
   * Run only these items. When omitted, every eligible red item is selected.
   * A named item is still refused when its status forbids a rerun.
   */
  itemIds?: string[];
  /** Also refresh blue (stale) items. Off by default: stale is not missing. */
  includeStale?: boolean;
  /**
   * Also re-attempt yellow (unresolved/PARTIAL) items.
   *
   * Off by default, and deliberately NOT implied by naming an item: an
   * automatic cycle must never loop on a lane that already ran and honestly
   * established nothing. An explicit operator Re-run Research is different —
   * a zoning search that opened the LDR PDF but never established the district
   * is an unfinished question, not a permanent verdict, and it gets ONE more
   * bounded attempt (still one invocation per owning capability) so a different
   * existing route can try. Exhausting those settles honestly at PARTIAL.
   */
  includeUnresolved?: boolean;
}

/** One capability invocation the backfill will make, and the items it serves. */
export interface BackfillTarget {
  capabilityId: string;
  itemIds: string[];
  labels: string[];
  reason: string;
}

export interface BackfillSkip {
  itemId: string;
  label: string;
  status: ResearchReadinessStatus;
  reason: string;
}

export interface BackfillSelection {
  targets: BackfillTarget[];
  skipped: BackfillSkip[];
}

const SKIP_REASON: Record<ResearchReadinessStatus, string> = {
  green: 'Usable evidence already exists. Targeted backfill never reruns a ready item.',
  yellow: 'A proper attempt already ran and honestly established no answer. Targeted backfill never loops on an unresolved result.',
  gray: 'Expected unknown or human follow-up. Targeted backfill never starts automated research here.',
  blue: 'Usable but stale. Refresh it explicitly — stale is not missing.',
  red: 'No registered capability owns this item, so it cannot be closed automatically.',
};

/**
 * Choose what a targeted backfill will actually invoke.
 *
 * Bounded by construction: only red machine-owned items (plus blue ones when
 * explicitly asked for), one invocation per owning capability however many
 * checklist items that capability serves.
 */
export function selectResearchBackfill(
  manifest: ResearchReadinessManifest,
  request: BackfillSelectionRequest = {},
): BackfillSelection {
  const requested = request.itemIds?.length ? new Set(request.itemIds) : null;
  const targets = new Map<string, BackfillTarget>();
  const skipped: BackfillSkip[] = [];

  for (const item of manifest.items) {
    if (requested && !requested.has(item.id)) continue;
    const explicit = !!requested;
    const eligible = item.machineBackfillAllowed
      && (item.status === 'red'
        || (item.status === 'blue' && (request.includeStale === true || explicit))
        || (item.status === 'yellow' && request.includeUnresolved === true));
    if (!eligible) {
      // An item that WOULD be a backfill candidate on status alone, but that no
      // registered capability owns, is refused for that reason — not for its
      // colour. Saying "refresh it explicitly" about an item nothing can
      // refresh is the kind of half-true the manifest exists to prevent.
      const unowned = (item.status === 'red' || item.status === 'blue') && !item.machineBackfillAllowed;
      skipped.push({
        itemId: item.id,
        label: item.label,
        status: item.status,
        reason: unowned ? SKIP_REASON.red : SKIP_REASON[item.status],
      });
      continue;
    }
    const capabilityId = item.owner.capabilityId;
    if (!capabilityId) {
      skipped.push({ itemId: item.id, label: item.label, status: item.status, reason: SKIP_REASON.red });
      continue;
    }
    const existing = targets.get(capabilityId);
    if (existing) {
      existing.itemIds.push(item.id);
      existing.labels.push(item.label);
      existing.reason = `${existing.labels.join(' and ')} need ${item.owner.label}.`;
      continue;
    }
    targets.set(capabilityId, {
      capabilityId,
      itemIds: [item.id],
      labels: [item.label],
      reason: `${item.label} needs ${item.owner.label}.`,
    });
  }

  return { targets: [...targets.values()], skipped };
}
