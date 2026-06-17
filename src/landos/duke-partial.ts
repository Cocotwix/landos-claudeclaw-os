// Standardized Duke Report output contract (product name: "Duke Report").
//
// Pure shaping over data ALREADY persisted on a Deal Card (report status,
// verification mix, open risks, next actions, latest writeback) plus the
// run-time comp-source selection. It invents no values, makes no network calls,
// performs no underwriting math, and persists nothing.
//
// Product model (replaces the old "Partial vs Full" framing):
//   Run Duke Report → choose a comp source:
//     - Redfin/Zillow  = default, NO LandPortal comp credit
//     - LandPortal Comps = explicit approval to spend ONE LP comp credit (only
//       when Tyler selects it for that run)
//   If the LP comp credit path is unavailable/exhausted/blocked/fails, Duke
//   falls back to Redfin/Zillow/manual and labels the comp source/quality.
//
// Hard rules reflected here:
//   - Parcel-specific evaluation/strategy/offer ONLY after verified identity.
//   - Local Area Context is allowed before verification but is labeled
//     "Local Area Context, Not Parcel Verified" and is never parcel facts.
//   - Offer guidance is never fabricated: it uses the real LandOS offer-engine
//     strategy bands, and a concrete MAO requires a verified parcel + Expected
//     Value from the selected comp source. No invented MAO / ranges.
//   - No coordinate/proximity/geocoder identification anywhere.
//   - The dashboard never spends a comp credit; selecting "LandPortal Comps"
//     only records the approval intent for that run.

import {
  STRATEGIES,
  GLOBAL_MIN_NET_PROFIT_USD,
  SUBDIVISION_MIN_NET_PROFIT_USD,
} from './offer-engine.js';

export type CompMode = 'redfin_zillow' | 'landportal_credit' | 'manual' | 'none';

export type PartialReportStatus =
  | 'partial'      // back-compat: a non-comp Duke Report ran
  | 'delivered'    // back-compat: a Full/delivered report
  | 'failed'
  | 'not_generated'
  | 'blocked'
  | 'none';

export type PartialVerificationStatus = 'verified' | 'unverified' | 'mixed' | 'none';
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'unknown';
export type EvaluationStatus = 'blocked' | 'ready' | 'insufficient_data';
export type OfferReadinessStatus = 'ready' | 'blocked' | 'needs_more_info';

export interface DukePartialContractInput {
  /** Persisted latest Duke report status from the deal card, or null. */
  latestReportStatus: string | null;
  hasVerifiedProperty: boolean;
  hasUnverifiedProperty: boolean;
  /** Aggregated open risks across linked properties. */
  risks: string[];
  /** Open next actions across linked properties (objects with an `action`). */
  nextActions: Array<Record<string, unknown>>;
  /** Latest Duke writeback summary, or null. */
  latestWriteback: string | null;
  /** Comp source selected for the run (default Redfin/Zillow, no credit). */
  compMode?: CompMode;
  /** Lifecycle status of the queued run task, if known. */
  taskStatus?: TaskStatus;
  /** True only when the LP comp credit path actually spent a credit this run. */
  compCreditUsed?: boolean;
  /** True when LP comp credit was selected but fell back to Redfin/Zillow/manual. */
  compFallbackUsed?: boolean;
}

export interface StrategyMatrixRow {
  id: string;
  /** Offer-engine strategy this row is derived from. Equals `id` for direct
   *  rows; for `double_close` it is `wholesale_assignment` (see note). */
  sourceStrategyId: string;
  label: string;
  /** Offer band ("40-60% of EV"), or "formula-based" / "unconfirmed". */
  offerBand: string;
  minNetProfitUsd: number;
  confirmed: boolean;
  /** Source/derivation note, surfaced so a derived row is never hidden. */
  note: string;
}

export interface DukePartialContract {
  reportType: 'duke_report';
  compMode: CompMode;
  reportStatus: PartialReportStatus;
  taskStatus: TaskStatus;
  verificationStatus: PartialVerificationStatus;
  parcelVerificationSummary: string;
  localAreaContext: { allowed: boolean; label: string; note: string };
  /** Deal-level verified facts are surfaced per property card; empty here. */
  verifiedFacts: string[];
  dueDiligenceSummary: string;
  anomalyFlags: string[];
  openRisks: string[];
  evaluationStatus: EvaluationStatus;
  evaluationEngine: {
    parcelSpecific: boolean;
    usableFacts: string[];
    missingFacts: string[];
    compSource: CompMode;
    compLimitation: string;
    confidenceLabel: string;
    note: string;
  };
  strategyMatrix: {
    parcelSpecific: boolean;
    note: string;
    strategies: StrategyMatrixRow[];
  };
  offerReadiness: {
    status: OfferReadinessStatus;
    reason: string;
    offerGuidanceAllowed: boolean;
    compSource: CompMode;
    missingFormulaWarning: string | null;
  };
  offerGuidance: {
    allowed: boolean;
    note: string;
    strategyBandsSource: string;
  };
  blockedReason: string | null;
  discoveryQuestions: string[];
  nextBestAction: string | null;
  compCreditUsed: boolean;
  compFallbackUsed: boolean;
  compSourceNote: string;
  /** Back-compat convenience: Partial never spends a comp credit. */
  noCompCreditUsed: boolean;
}

export const COMP_SOURCE_NOTE =
  'Redfin/Zillow is the default comp source and uses no LandPortal comp credit. ' +
  '"LandPortal Comps" spends one LP comp credit and only when you select it for that run. ' +
  'If the LP comp credit is unavailable, exhausted, blocked, or fails, Duke falls back to Redfin/Zillow/manual and labels the comp source.';

export const LOCAL_AREA_CONTEXT_LABEL = 'Local Area Context, Not Parcel Verified';

// Generic, non-fabricated prompts for confirming parcel identity. Verification
// asks (not property-specific claims) — safe for any unverified parcel.
export const IDENTITY_DISCOVERY_QUESTIONS: readonly string[] = [
  'What is the APN (parcel number)?',
  'Which county and state (or 5-digit FIPS) is the parcel in?',
  'Is there a LandPortal property ID or exact situs address to confirm a single parcel?',
];

// Real LandOS strategy params from the offer engine — never invented here.
// Real LandOS strategy params from the offer engine — never invented here.
const STRATEGY_MATRIX_ROWS: StrategyMatrixRow[] = (() => {
  const rows: StrategyMatrixRow[] = STRATEGIES.map((s) => ({
    id: s.id,
    sourceStrategyId: s.id,
    label: s.label,
    offerBand:
      s.offerPctLowOfEv != null && s.offerPctHighOfEv != null
        ? `${s.offerPctLowOfEv}-${s.offerPctHighOfEv}% of EV`
        : (s.confirmed ? 'no offer' : 'formula-based / unconfirmed'),
    minNetProfitUsd: s.minNetProfitUsd,
    confirmed: s.confirmed,
    note: s.notes,
  }));

  // Explicit DOUBLE CLOSE row. The offer engine has no dedicated `double_close`
  // strategy id yet; in current LandOS rules double close is the closest economic
  // cousin of wholesale/assignment, plus the Duke persona rule "DOUBLE CLOSE:
  // EV-low minus the minimum net profit". We surface it as its OWN row (distinct
  // from wholesale/assignment) with explicit source attribution — never hidden
  // under wholesale_assignment, and no offer number is computed here.
  const wholesale = STRATEGIES.find((s) => s.id === 'wholesale_assignment');
  const doubleClose: StrategyMatrixRow = {
    id: 'double_close',
    sourceStrategyId: 'wholesale_assignment',
    label: 'Double close',
    offerBand: 'formula-based (EV-low minus minimum net profit)',
    minNetProfitUsd: wholesale?.minNetProfitUsd ?? GLOBAL_MIN_NET_PROFIT_USD,
    confirmed: false,
    note:
      `Derived from current LandOS wholesale/assignment economics + the Duke persona DOUBLE CLOSE rule ` +
      `(EV-low minus the $${GLOBAL_MIN_NET_PROFIT_USD.toLocaleString('en-US')} minimum net profit). ` +
      `No dedicated offer-engine double_close formula yet; shown distinct from wholesale/assignment.`,
  };
  const idx = rows.findIndex((r) => r.id === 'wholesale_assignment');
  if (idx >= 0) rows.splice(idx + 1, 0, doubleClose);
  else rows.push(doubleClose);
  return rows;
})();

function firstAction(nextActions: Array<Record<string, unknown>>): string | null {
  for (const n of nextActions ?? []) {
    const a = (n as { action?: unknown }).action;
    if (typeof a === 'string' && a.trim()) return a.trim();
  }
  return null;
}

/** Build the standardized Duke Report contract from persisted deal-card data
 *  plus the run-time comp selection. */
export function buildDukePartialContract(input: DukePartialContractInput): DukePartialContract {
  const risks = (input.risks ?? []).filter((r): r is string => typeof r === 'string' && r.trim().length > 0);
  const compMode: CompMode = input.compMode ?? 'redfin_zillow';
  const taskStatus: TaskStatus = input.taskStatus ?? 'unknown';
  const compCreditUsed = compMode === 'landportal_credit' && input.compCreditUsed === true;
  const compFallbackUsed = input.compFallbackUsed === true;

  const verificationStatus: PartialVerificationStatus =
    input.hasVerifiedProperty && input.hasUnverifiedProperty ? 'mixed'
    : input.hasVerifiedProperty ? 'verified'
    : input.hasUnverifiedProperty ? 'unverified'
    : 'none';

  // Anything short of fully verified blocks parcel-specific evaluation/offer.
  const verified = verificationStatus === 'verified';
  const blocked = !verified;

  const latest = input.latestReportStatus;
  let reportStatus: PartialReportStatus;
  if (latest === 'failed' || latest === 'not_generated') reportStatus = latest;
  else if (blocked) reportStatus = 'blocked';
  else if (latest === 'partial' || latest === 'delivered') reportStatus = latest;
  else reportStatus = 'none';

  const parcelVerificationSummary =
    verificationStatus === 'verified' ? 'Parcel identity verified.'
    : verificationStatus === 'mixed' ? 'Some linked parcels are verified and some are not.'
    : verificationStatus === 'unverified' ? 'Parcel identity not verified.'
    : 'No linked parcel yet.';

  const blockedReason = blocked
    ? 'Parcel identity not fully verified. No parcel-specific scoring, valuation, comps, offer, or strategy until APN + county/state/FIPS (or LandPortal property ID + FIPS) confirms a single parcel.'
    : null;

  const discoveryQuestions = blocked ? [...IDENTITY_DISCOVERY_QUESTIONS] : [];

  // Local Area Context is always allowed; it is only LABELED non-parcel-verified
  // when identity is not verified, and is never treated as parcel facts.
  const localAreaContext = {
    allowed: true,
    label: verified ? '' : LOCAL_AREA_CONTEXT_LABEL,
    note: verified
      ? 'Area/market context supplements verified parcel facts.'
      : 'Area/market context only. Not the subject parcel; not parcel-specific facts, valuation, or offer guidance.',
  };

  // Evaluation engine is parcel-specific ONLY when verified.
  const evaluationStatus: EvaluationStatus = blocked ? 'blocked' : 'insufficient_data';
  const evaluationEngine = {
    parcelSpecific: verified,
    usableFacts: [] as string[],
    missingFacts: verified
      ? ['Expected Value from the selected comp source', 'verified comps ($/acre)']
      : ['verified parcel identity'],
    compSource: compMode,
    compLimitation:
      compMode === 'redfin_zillow' ? 'Redfin/Zillow market comps (no LP comp credit).'
      : compMode === 'landportal_credit' ? 'LandPortal comp report (one comp credit) when selected for the run.'
      : compMode === 'manual' ? 'Manual market comps.'
      : 'No comp source selected.',
    confidenceLabel: verified ? 'insufficient data (no EV computed yet)' : 'blocked (parcel not verified)',
    note: verified
      ? 'Verified parcel. Run with a comp source to compute Expected Value before scoring/valuation.'
      : 'Blocked until parcel identity is verified. Local Area Context only.',
  };

  // Strategy matrix is parcel-specific ONLY when verified. Rows come from the
  // real LandOS offer engine; bands are never invented here.
  const strategyMatrix = {
    parcelSpecific: verified,
    note: verified
      ? `LandOS offer-engine strategies. Min net profit baseline $${GLOBAL_MIN_NET_PROFIT_USD.toLocaleString('en-US')}; subdivision min $${SUBDIVISION_MIN_NET_PROFIT_USD.toLocaleString('en-US')}. Specific offer requires Expected Value from the selected comp source.`
      : 'Blocked until parcel identity is verified.',
    strategies: verified ? STRATEGY_MATRIX_ROWS : [],
  };

  // Offer readiness. Formulas EXIST (offer-engine), so there is no missing-formula
  // warning; a concrete offer still needs a verified parcel + EV from comps.
  const offerReadiness = blocked
    ? {
        status: 'blocked' as OfferReadinessStatus,
        reason: 'Parcel identity not verified — no offer guidance.',
        offerGuidanceAllowed: false,
        compSource: compMode,
        missingFormulaWarning: null,
      }
    : {
        status: 'needs_more_info' as OfferReadinessStatus,
        reason: 'Verified parcel. Expected Value from the selected comp source is required before an offer band can be produced.',
        offerGuidanceAllowed: false,
        compSource: compMode,
        missingFormulaWarning: null,
      };

  const offerGuidance = {
    allowed: offerReadiness.offerGuidanceAllowed, // false until verified + EV
    note: blocked
      ? 'No offer guidance: parcel not verified.'
      : 'Offer bands use the existing LandOS offer-engine strategy percentages of Expected Value. A concrete offer is produced only after EV is computed from the selected comp source — no MAO/range is shown without it.',
    strategyBandsSource: 'src/landos/offer-engine.ts (STRATEGIES)',
  };

  const persistedNext = firstAction(input.nextActions);
  const nextBestAction = persistedNext ?? (blocked
    ? discoveryQuestions[0] ?? null
    : 'Run a comp source (Redfin/Zillow default, or LandPortal Comps) to compute Expected Value.');

  const dueDiligenceSummary = (input.latestWriteback ?? '').trim() ||
    (verified ? 'Parcel verified; due-diligence facts pending a comp/EV pass.' : 'Parcel not verified; due diligence blocked before valuation/offer.');

  return {
    reportType: 'duke_report',
    compMode,
    reportStatus,
    taskStatus,
    verificationStatus,
    parcelVerificationSummary,
    localAreaContext,
    verifiedFacts: [],
    dueDiligenceSummary,
    anomalyFlags: risks,
    openRisks: risks,
    evaluationStatus,
    evaluationEngine,
    strategyMatrix,
    offerReadiness,
    offerGuidance,
    blockedReason,
    discoveryQuestions,
    nextBestAction,
    compCreditUsed,
    compFallbackUsed,
    compSourceNote: COMP_SOURCE_NOTE,
    noCompCreditUsed: !compCreditUsed,
  };
}
