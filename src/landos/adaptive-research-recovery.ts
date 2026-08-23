// LandOS — adaptive research recovery.
//
// WHY THIS EXISTS. LandOS was too willing to run this sequence:
//
//     deterministic collector → answer not found → UNRESOLVED → stop
//
// A capable acquisitions researcher does not stop there. They try the known
// route first, and when it misses they work out ANOTHER way to reach the
// answer: search the question in plain English, identify which government
// actually holds the record, navigate that site, operate its map, read the
// document, follow the citation, and only then — having genuinely looked —
// report the question unresolved.
//
// This module is that second behaviour, made bounded and governed.
//
// THE SHAPE. Deterministic capabilities remain the FAST PATH and are never
// replaced. Recovery starts only where the fast path missed AND the question
// is worth it:
//
//     QUESTION → deterministic capability → answer? → RETURNED
//                                          ↓ no
//                              materiality check → below threshold? → stop
//                                          ↓ material
//                              Hermes plans the research approach
//                                          ↓
//                        LandOS executes it and retains the evidence
//                                          ↓
//                   RETURNED / PARTIAL / UNRESOLVED / BLOCKED
//
// THE AUTHORITY BOUNDARY. Hermes decides HOW to research — which phrasing to
// search, which government to approach, which layer is relevant, what to read
// next. Hermes never creates a canonical fact. It receives a bounded envelope
// and returns a PLAN; every byte of evidence is acquired and retained by
// LandOS capabilities, under LandOS provenance. That split is enforced here by
// construction: the planner's return type carries no facts, only directions,
// and nothing in this file writes evidence.
//
// NO UNRESTRICTED LOOP. There is deliberately no "keep researching until
// solved". Every recovery request carries an explicit question, a materiality,
// an attempts budget and a stop condition, and the budget is a small finite
// number from `RECOVERY_ATTEMPT_BUDGET`. Recovery cannot re-enter itself.

import { extractJsonObject } from './acquisition-intelligence-contract.js';
import {
  laneMateriality,
  recoveryBudget,
  recoveryEligible,
  type LaneRecoveryState,
  type ResearchLaneOutcome,
  type ResearchMateriality,
} from './research-lane-outcome.js';

/** The bounded subject view a recovery planner is allowed to see. */
export interface RecoverySubject {
  apn: string | null;
  address: string | null;
  municipality: string | null;
  county: string | null;
  state: string | null;
  /** Provenance only. Coordinates never establish parcel identity. */
  coordinates?: { lat: number; lon: number } | null;
}

/**
 * One unresolved question, packaged for a planner.
 *
 * `methodsAlreadyTried` is what stops the planner proposing the route that
 * just failed, which is the single most common way an adaptive researcher
 * wastes a budget.
 */
export interface UnresolvedQuestionEnvelope {
  dealCardId: number;
  laneId: string;
  question: string;
  materiality: ResearchMateriality;
  subject: RecoverySubject;
  /** What LandOS already holds on this question. Never re-derived. */
  existingEvidence: string[];
  methodsAlreadyTried: string[];
  sourceQualityRequirement: string;
  allowedBrowserActions: string[];
  attemptsBudget: number;
}

/** A candidate source the planner wants LandOS to inspect. */
export interface PlannedSource {
  label: string;
  url: string | null;
  /** Why this source would hold the answer. */
  why: string;
  /**
   * Whether this is expected to be the authoritative record.
   *
   * A search result is a NAVIGATION AID. Discovering a page never makes its
   * content a fact: evidence is admitted only when LandOS retrieves it from
   * the source and the caller's reader accepts it.
   */
  expectedAuthority: 'official_primary' | 'reputable_secondary' | 'search_result';
}

export interface RecoveryPlan {
  /** One line: the approach the planner chose. */
  approach: string;
  /** Plain-English searches, as an operator would type them. */
  searchQueries: string[];
  candidateSources: PlannedSource[];
  /** GIS layers worth toggling, chosen for THIS question. Never "all layers". */
  gisLayers: string[];
  /** The planner's own stop condition. */
  stopWhen: string;
}

/** Reasons recovery was not attempted. Each is a different operator story. */
export type RecoverySkipReason =
  | 'answered'
  | 'not_recoverable'
  | 'below_materiality_threshold'
  | 'budget_exhausted';

export interface RecoveryDecision {
  attempt: boolean;
  reason: RecoverySkipReason | 'recover';
  materiality: ResearchMateriality;
  budget: number;
}

/**
 * Whether this lane earns adaptive recovery.
 *
 * Three gates, in order. A returned answer needs nothing. A blocked lane needs
 * access, not more searching. A low-materiality miss is left alone on purpose:
 * the budget exists so a deal-controlling question can use it.
 */
export function decideRecovery(input: {
  laneId: string;
  outcome: ResearchLaneOutcome | null;
  materiality?: ResearchMateriality;
  attemptsUsed?: number;
}): RecoveryDecision {
  const materiality = input.materiality ?? laneMateriality(input.laneId);
  const budget = recoveryBudget(materiality);
  const attemptsUsed = input.attemptsUsed ?? 0;

  if (input.outcome === 'RETURNED') {
    return { attempt: false, reason: 'answered', materiality, budget };
  }
  if (!recoveryEligible(input.outcome)) {
    return { attempt: false, reason: 'not_recoverable', materiality, budget };
  }
  if (budget <= 0) {
    return { attempt: false, reason: 'below_materiality_threshold', materiality, budget };
  }
  if (attemptsUsed >= budget) {
    return { attempt: false, reason: 'budget_exhausted', materiality, budget };
  }
  return { attempt: true, reason: 'recover', materiality, budget };
}

/**
 * The recovery state to record for a lane that is still unanswered.
 *
 * The distinction this preserves is the whole reason the field exists: a
 * deterministic miss is NOT the same thing as a fully researched unknown, and
 * Research Readiness must never present the first as the second.
 */
export function recoveryStateFor(input: {
  outcome: ResearchLaneOutcome | null;
  attemptsUsed: number;
  budget: number;
}): LaneRecoveryState {
  if (input.outcome === 'RETURNED') return 'not_applicable';
  if (input.attemptsUsed <= 0) return 'recovery_not_attempted';
  if (input.attemptsUsed >= input.budget) return 'adaptive_public_research_exhausted';
  return 'recovery_in_progress';
}

/** Build the envelope. Nothing about the subject is inferred here. */
export function buildRecoveryEnvelope(input: {
  dealCardId: number;
  laneId: string;
  question: string;
  subject: RecoverySubject;
  existingEvidence?: readonly string[];
  methodsAlreadyTried?: readonly string[];
  materiality?: ResearchMateriality;
}): UnresolvedQuestionEnvelope {
  const materiality = input.materiality ?? laneMateriality(input.laneId);
  return {
    dealCardId: input.dealCardId,
    laneId: input.laneId,
    question: input.question,
    materiality,
    subject: input.subject,
    existingEvidence: [...(input.existingEvidence ?? [])],
    methodsAlreadyTried: [...(input.methodsAlreadyTried ?? [])],
    sourceQualityRequirement:
      'Prefer the official record that governs this question. A reputable secondary or search result may carry the answer and must be labelled as such.',
    allowedBrowserActions: [
      'open an official page',
      'search an official site by APN or address',
      'inspect the layer list of an official map',
      'toggle a layer relevant to this question',
      'click a mapped feature and read its popup',
      'read a legend',
      'capture a screenshot',
    ],
    attemptsBudget: recoveryBudget(materiality),
  };
}

/**
 * The planner prompt.
 *
 * States the authority boundary in the prompt as well as in the types, because
 * the specialist profiles carry persistent memory and the one thing that must
 * never drift is who owns the facts.
 */
export function renderRecoveryPrompt(envelope: UnresolvedQuestionEnvelope): string {
  const subject = envelope.subject;
  return [
    '=== LANDOS RESEARCH RECOVERY REQUEST ===',
    `Deal Card: #${envelope.dealCardId}`,
    `Lane: ${envelope.laneId}`,
    `Subject APN: ${subject.apn ?? 'unknown'}`,
    `Subject address: ${subject.address ?? 'unknown'}`,
    `Jurisdiction: ${[subject.municipality, subject.county, subject.state].filter(Boolean).join(', ') || 'unknown'}`,
    '',
    `QUESTION TO RESOLVE: ${envelope.question}`,
    `MATERIALITY: ${envelope.materiality}`,
    `ATTEMPTS BUDGET: ${envelope.attemptsBudget}`,
    '',
    'ALREADY TRIED (do not propose these again):',
    ...(envelope.methodsAlreadyTried.length
      ? envelope.methodsAlreadyTried.map((method) => `  - ${method}`)
      : ['  - (nothing recorded)']),
    '',
    'EVIDENCE LANDOS ALREADY HOLDS:',
    ...(envelope.existingEvidence.length
      ? envelope.existingEvidence.map((item) => `  - ${item}`)
      : ['  - (none)']),
    '',
    `SOURCE QUALITY: ${envelope.sourceQualityRequirement}`,
    'BROWSER ACTIONS AVAILABLE TO LANDOS:',
    ...envelope.allowedBrowserActions.map((action) => `  - ${action}`),
    '',
    'YOUR ROLE. Decide HOW to research this. You do not answer the question and',
    'you do not state any fact about this property: you have not seen the sources.',
    'LandOS executes your plan, retrieves the evidence, and remains the sole',
    'authority over what becomes a fact. Choose layers and sources for THIS',
    'question only; do not propose toggling every layer or reading every page.',
    '',
    'Reply with ONLY a JSON object:',
    '{',
    '  "approach": "one line",',
    '  "searchQueries": ["plain-English search, as an operator would type it"],',
    '  "candidateSources": [{"label":"", "url":"", "why":"",',
    '     "expectedAuthority":"official_primary|reputable_secondary|search_result"}],',
    '  "gisLayers": ["layer name relevant to this question"],',
    '  "stopWhen": "the condition that ends this recovery"',
    '}',
    '=== END REQUEST ===',
  ].join('\n');
}

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function authorityOf(value: unknown): PlannedSource['expectedAuthority'] {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'official_primary') return 'official_primary';
  if (raw === 'reputable_secondary') return 'reputable_secondary';
  // Unlabelled discovery is the weakest reading, never the strongest.
  return 'search_result';
}

/**
 * Parse a plan. A malformed reply produces `null` — a failed plan is a failed
 * recovery attempt, never a fabricated one.
 */
export function parseRecoveryPlan(raw: string): RecoveryPlan | null {
  const parsed = extractJsonObject(raw);
  if (!parsed) return null;

  const approach = String(parsed.approach ?? '').trim();
  const sources = Array.isArray(parsed.candidateSources) ? parsed.candidateSources : [];
  const candidateSources: PlannedSource[] = sources
    .slice(0, 8)
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const label = String(row.label ?? '').trim();
      if (!label) return null;
      const url = String(row.url ?? '').trim();
      return {
        label,
        url: url || null,
        why: String(row.why ?? '').trim(),
        expectedAuthority: authorityOf(row.expectedAuthority),
      };
    })
    .filter((row): row is PlannedSource => row !== null);

  const plan: RecoveryPlan = {
    approach,
    searchQueries: stringList(parsed.searchQueries, 6),
    candidateSources,
    gisLayers: stringList(parsed.gisLayers, 6),
    stopWhen: String(parsed.stopWhen ?? '').trim(),
  };

  // A plan with no approach and nothing to do is not a plan.
  if (!plan.approach && !plan.searchQueries.length && !plan.candidateSources.length) return null;
  return plan;
}

/**
 * A discovered source is never a fact.
 *
 * The planner may point LandOS at a page; only retrieval from that page, read
 * by the lane's own evidence reader, produces evidence. This predicate exists
 * so that rule is callable rather than implied.
 */
export function planIsEvidence(): false {
  return false;
}

/** How a plan gets executed. Injected, so recovery is testable without I/O. */
export type RecoveryPlanner = (prompt: string, envelope: UnresolvedQuestionEnvelope) => Promise<string>;

export interface RecoveryAttemptResult {
  laneId: string;
  attempted: boolean;
  reason: RecoveryDecision['reason'];
  materiality: ResearchMateriality;
  budget: number;
  attemptsUsed: number;
  recoveryState: LaneRecoveryState;
  plan: RecoveryPlan | null;
  notes: string[];
}

/**
 * Run ONE bounded recovery planning pass for one lane.
 *
 * Deliberately not a loop and deliberately not recursive: it plans once, for
 * one question, and returns. A caller that wants a second attempt must decide
 * to make one, and `decideRecovery` will refuse once the budget is spent.
 */
export async function planRecovery(input: {
  envelope: UnresolvedQuestionEnvelope;
  outcome: ResearchLaneOutcome | null;
  attemptsUsed?: number;
  planner: RecoveryPlanner;
}): Promise<RecoveryAttemptResult> {
  const attemptsUsed = input.attemptsUsed ?? 0;
  const decision = decideRecovery({
    laneId: input.envelope.laneId,
    outcome: input.outcome,
    materiality: input.envelope.materiality,
    attemptsUsed,
  });
  const notes: string[] = [];

  if (!decision.attempt) {
    return {
      laneId: input.envelope.laneId,
      attempted: false,
      reason: decision.reason,
      materiality: decision.materiality,
      budget: decision.budget,
      attemptsUsed,
      recoveryState: recoveryStateFor({ outcome: input.outcome, attemptsUsed, budget: decision.budget }),
      plan: null,
      notes: [skipNote(decision, input.envelope.laneId)],
    };
  }

  let plan: RecoveryPlan | null = null;
  try {
    plan = parseRecoveryPlan(await input.planner(renderRecoveryPrompt(input.envelope), input.envelope));
    if (!plan) notes.push(`Recovery planning for ${input.envelope.laneId} returned no usable plan.`);
  } catch (error) {
    // A planner outage is a failed attempt, not a failed question.
    notes.push(`Recovery planning for ${input.envelope.laneId} failed: ${(error as Error)?.message ?? 'unknown error'}.`);
  }

  const spent = attemptsUsed + 1;
  return {
    laneId: input.envelope.laneId,
    attempted: true,
    reason: 'recover',
    materiality: decision.materiality,
    budget: decision.budget,
    attemptsUsed: spent,
    recoveryState: recoveryStateFor({ outcome: input.outcome, attemptsUsed: spent, budget: decision.budget }),
    plan,
    notes,
  };
}

function skipNote(decision: RecoveryDecision, laneId: string): string {
  switch (decision.reason) {
    case 'answered':
      return `${laneId} returned an answer; no recovery was needed.`;
    case 'not_recoverable':
      return `${laneId} is not in a state adaptive research can improve; the next action is access, not more searching.`;
    case 'below_materiality_threshold':
      return `${laneId} is ${decision.materiality} materiality, which carries no adaptive research budget.`;
    case 'budget_exhausted':
    default:
      return `${laneId} has spent its ${decision.budget}-attempt adaptive research budget.`;
  }
}
