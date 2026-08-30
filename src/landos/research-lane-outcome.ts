// LandOS — research LANE OUTCOME semantics.
//
// WHY THIS EXISTS. The operator read "12 of 12 lanes reported by this research
// run" while three of those lanes had answered nothing and one was externally
// blocked. That sentence measured TOOL EXECUTIONS and presented them as
// ANSWERS. A lane that ran and produced no usable answer is not a lane that
// reported; counting it as one is the single most misleading thing a research
// surface can do, because it retires the operator's attention from exactly the
// questions that are still open.
//
// The repair is a vocabulary, not a label change. A lane settles into one of
// five outcomes, and only one of them is an answer:
//
//   RETURNED      a usable, evidence-backed answer was produced
//   PARTIAL       useful evidence, but a material portion is still unresolved
//   UNRESOLVED    no usable answer after the research attempts actually made
//   BLOCKED       a real external wall stopped the work (login, payment, outage)
//   NOT_REQUIRED  the lane does not materially apply to this subject
//
// The operator completion metric is `X of Y required lanes returned`. PARTIAL
// stays visibly partial and never silently counts as fully returned; UNRESOLVED
// and BLOCKED never count as returned at all. Diagnostics may still say all
// twelve lanes executed — that is a different, internal question.
//
// Pure. No I/O. The lane roster, the store and the surfaces supply the data;
// this file is the contract that decides what the data MEANS.

import type { SpecialistStatus } from './property-intelligence-specialists.js';

/** Shared Foundation result vocabulary. Invocation, answer, applicability,
 * operator intervention, and execution failure stay separate facts. */
export type ResearchResultState =
  | 'RETURNED'
  | 'PARTIAL'
  | 'NOT_RUN'
  | 'BLOCKED'
  | 'NOT_APPLICABLE'
  | 'NEEDS_OPERATOR_ACTION'
  | 'FAILED';

export interface ResearchResultInput extends LaneOutcomeInput {
  attempted?: boolean;
  applicable?: boolean;
  needsOperatorAction?: boolean;
}

export function researchResultState(input: ResearchResultInput): ResearchResultState {
  if (input.applicable === false || input.status === 'skipped') return 'NOT_APPLICABLE';
  if (input.needsOperatorAction) return 'NEEDS_OPERATOR_ACTION';
  if (input.status === 'queued' || input.status === 'running' || input.attempted === false) return 'NOT_RUN';
  if (input.status === 'blocked') return 'BLOCKED';
  if (input.status === 'failed') return 'FAILED';
  if (input.status === 'partial' || input.answered === false || input.failureCategory) return 'PARTIAL';
  return 'RETURNED';
}

/** The five terminal meanings a research lane can carry. */
export type ResearchLaneOutcome =
  | 'RETURNED'
  | 'PARTIAL'
  | 'UNRESOLVED'
  | 'BLOCKED'
  | 'NOT_REQUIRED';

/**
 * How much research effort a question deserves when the deterministic path
 * misses. Materiality bounds adaptive recovery so a low-value unknown can
 * never open a rabbit hole, and a deal-controlling unknown is never abandoned
 * after one failed collector.
 */
export type ResearchMateriality = 'low' | 'medium' | 'high';

/**
 * Whether adaptive recovery has actually been tried for an unresolved lane.
 *
 * This distinction is the difference between "a collector missed" and "we
 * genuinely looked and the public record does not answer it". Research
 * Readiness must never present the first as the second.
 */
export type LaneRecoveryState =
  /** The lane answered; recovery was never needed. */
  | 'not_applicable'
  /** Deterministic collection missed and no adaptive research has run yet. */
  | 'recovery_not_attempted'
  /** A bounded adaptive recovery is running now. */
  | 'recovery_in_progress'
  /** Adaptive public research ran to its budget and still found no answer. */
  | 'adaptive_public_research_exhausted';

/** What a lane must tell us before its outcome can be decided. */
export interface LaneOutcomeInput {
  status: SpecialistStatus;
  /** Present when the lane recorded a failure category against itself. */
  failureCategory?: string | null;
  /**
   * Explicit answer signal. `false` means the lane ran to completion and still
   * produced nothing the operator can use — a completed lane is NOT an
   * answered lane, and RETURNED requires an answer. Left undefined, a clean
   * `completed` lane is taken at its word.
   */
  answered?: boolean;
}

/**
 * A lane that has not settled yet has no outcome. `null` is deliberate: it
 * keeps queued/running lanes out of every count instead of quietly landing
 * them in one.
 */
export function laneOutcome(input: LaneOutcomeInput): ResearchLaneOutcome | null {
  switch (input.status) {
    case 'queued':
    case 'running':
      return null;
    // A skipped lane was judged not to apply to this subject. That is an
    // honest "no question here", never a missing answer.
    case 'skipped':
      return 'NOT_REQUIRED';
    // A real external wall. Distinct from UNRESOLVED because the next action
    // is different: unblocking access, not more searching.
    case 'blocked':
      return 'BLOCKED';
    // The lane broke or delivered nothing usable.
    case 'failed':
      return 'UNRESOLVED';
    case 'partial':
      return 'PARTIAL';
    case 'completed':
      // RETURNED is the only outcome that asserts an answer exists, so it is
      // the only one that has to earn it. A lane that completed while
      // explicitly reporting no usable answer is UNRESOLVED, and one that
      // completed while still carrying a failure against itself is PARTIAL.
      if (input.answered === false) return 'UNRESOLVED';
      if (input.failureCategory) return 'PARTIAL';
      return 'RETURNED';
    default:
      return null;
  }
}

/** Only RETURNED is an answer. Nothing else may be counted as one. */
export function isReturned(outcome: ResearchLaneOutcome | null): boolean {
  return outcome === 'RETURNED';
}

/**
 * A lane that counts toward the operator's denominator. NOT_REQUIRED lanes are
 * excluded — asking the operator to close a question that does not apply is
 * noise, not diligence.
 */
export function countsAsRequired(outcome: ResearchLaneOutcome | null): boolean {
  return outcome !== null && outcome !== 'NOT_REQUIRED';
}

export interface ResearchLaneTally {
  returned: number;
  partial: number;
  unresolved: number;
  blocked: number;
  notRequired: number;
  /** Settled lanes that materially apply — the denominator the operator reads. */
  requiredTotal: number;
  /** Lanes still queued or running; never folded into any outcome count. */
  pending: number;
  /** Every lane the run declared, answered or not. Diagnostics only. */
  laneTotal: number;
  /** The one completion sentence a surface may show. */
  headline: string;
  /** The outcome split, so the missing lanes are named rather than implied. */
  breakdown: string;
}

/**
 * Count outcomes for the operator.
 *
 * The invariant this function exists to hold: `returned` counts RETURNED and
 * nothing else. No caller can produce a completion number that includes an
 * unresolved or blocked lane, because no such number is computed here.
 */
export function tallyResearchLanes(lanes: readonly LaneOutcomeInput[]): ResearchLaneTally {
  let returned = 0;
  let partial = 0;
  let unresolved = 0;
  let blocked = 0;
  let notRequired = 0;
  let pending = 0;

  for (const lane of lanes) {
    switch (laneOutcome(lane)) {
      case 'RETURNED': returned += 1; break;
      case 'PARTIAL': partial += 1; break;
      case 'UNRESOLVED': unresolved += 1; break;
      case 'BLOCKED': blocked += 1; break;
      case 'NOT_REQUIRED': notRequired += 1; break;
      default: pending += 1; break;
    }
  }

  const requiredTotal = returned + partial + unresolved + blocked;
  const headline = `${returned} of ${requiredTotal} required lanes returned`;
  const parts = [`Returned: ${returned}`];
  if (partial) parts.push(`Partial: ${partial}`);
  if (unresolved) parts.push(`Unresolved: ${unresolved}`);
  if (blocked) parts.push(`Blocked: ${blocked}`);
  if (notRequired) parts.push(`Not required: ${notRequired}`);

  return {
    returned,
    partial,
    unresolved,
    blocked,
    notRequired,
    requiredTotal,
    pending,
    laneTotal: lanes.length,
    headline,
    breakdown: parts.join(' · '),
  };
}

/**
 * Lane materiality for the Deal Intelligence roster.
 *
 * HIGH is reserved for deal-controlling questions — the ones that decide
 * whether a parcel can be bought, financed, subdivided or served. They earn
 * adaptive recovery. LOW questions do not, precisely so they cannot consume a
 * session that a HIGH question needed.
 */
export const LANE_MATERIALITY: Readonly<Record<string, ResearchMateriality>> = {
  // Identity gates everything downstream; nothing is worth more.
  parcel_identity: 'high',
  // The recorded instruments that carry title, legal access and encumbrances.
  government_records: 'high',
  // What may be built, and therefore what the parcel is worth.
  zoning_land_use: 'high',
  // Public water and sewer decide whether density is achievable at all.
  access_utilities: 'high',
  // Whether the subdivision path the value depends on actually exists.
  subdivision_feasibility: 'high',
  environmental_terrain: 'medium',
  comparables: 'medium',
  valuation: 'medium',
  strategy: 'medium',
  property_backstory: 'medium',
  market_intelligence: 'low',
  evidence_visuals: 'low',
};

export function laneMateriality(laneId: string): ResearchMateriality {
  return LANE_MATERIALITY[laneId] ?? 'medium';
}

/**
 * The bounded recovery budget per materiality — the mechanism that makes
 * "figure out another way" finite. There is no "keep researching until
 * solved" setting, by construction: every level returns a fixed, small number.
 */
export const RECOVERY_ATTEMPT_BUDGET: Readonly<Record<ResearchMateriality, number>> = {
  // Deterministic plus one cheap fallback, then the answer stands unresolved.
  low: 0,
  // One adaptive browser workflow.
  medium: 1,
  // Source discovery, an official browser workflow, and one alternate official
  // source. Then it stops and escalates rather than looping.
  high: 3,
};

export function recoveryBudget(materiality: ResearchMateriality): number {
  return RECOVERY_ATTEMPT_BUDGET[materiality];
}

/** Whether a settled outcome is one adaptive recovery could still improve. */
export function recoveryEligible(outcome: ResearchLaneOutcome | null): boolean {
  return outcome === 'UNRESOLVED' || outcome === 'PARTIAL';
}
