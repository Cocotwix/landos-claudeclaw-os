// Standardized Duke Partial output contract.
//
// Pure shaping over data ALREADY persisted on a Deal Card (report status,
// verification mix, open risks, next actions, latest writeback). It invents no
// values, makes no network calls, and persists nothing. It exists so the
// dashboard renders a consistent, safe Partial view and so a "Run Duke Partial"
// action has a single output shape.
//
// Hard rules reflected here:
//   - Duke Partial is the default and never spends a comp credit.
//   - A Full Report (comps/valuation) is only available with explicit approval.
//   - If parcel identity is not fully verified, the Partial is BLOCKED before
//     valuation/offer/strategy and surfaces discovery questions instead.
//   - No coordinate/proximity/geocoder identification anywhere.

export type PartialReportStatus =
  | 'partial'
  | 'delivered'
  | 'failed'
  | 'not_generated'
  | 'blocked'
  | 'none';

export type PartialVerificationStatus = 'verified' | 'unverified' | 'mixed' | 'none';

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
}

export interface DukePartialContract {
  reportStatus: PartialReportStatus;
  verificationStatus: PartialVerificationStatus;
  parcelVerificationSummary: string;
  /** Deal-level verified facts are surfaced per property card; empty here. */
  verifiedFacts: string[];
  /** Anomaly/risk flags surfaced by the run (deal-level aggregation). */
  anomalyFlags: string[];
  openRisks: string[];
  blockedReason: string | null;
  nextBestAction: string | null;
  discoveryQuestions: string[];
  /** Partial never spends a comp credit. */
  noCompCreditUsed: boolean;
  compCreditUsed: boolean;
  fullReportNote: string;
}

export const FULL_REPORT_NOTE =
  'Duke Partial is the default no-comp pass. A Full Report (comps/valuation) runs only with your explicit comp-credit approval.';

// Generic, non-fabricated prompts for confirming parcel identity. These are
// verification asks (not property-specific claims) — safe for any unverified
// parcel. No coordinate/proximity language.
export const IDENTITY_DISCOVERY_QUESTIONS: readonly string[] = [
  'What is the APN (parcel number)?',
  'Which county and state (or 5-digit FIPS) is the parcel in?',
  'Is there a LandPortal property ID or exact situs address to confirm a single parcel?',
];

function firstAction(nextActions: Array<Record<string, unknown>>): string | null {
  for (const n of nextActions ?? []) {
    const a = (n as { action?: unknown }).action;
    if (typeof a === 'string' && a.trim()) return a.trim();
  }
  return null;
}

/** Build the standardized Duke Partial contract from persisted deal-card data. */
export function buildDukePartialContract(input: DukePartialContractInput): DukePartialContract {
  const risks = (input.risks ?? []).filter((r): r is string => typeof r === 'string' && r.trim().length > 0);

  const verificationStatus: PartialVerificationStatus =
    input.hasVerifiedProperty && input.hasUnverifiedProperty ? 'mixed'
    : input.hasVerifiedProperty ? 'verified'
    : input.hasUnverifiedProperty ? 'unverified'
    : 'none';

  // Anything short of fully verified blocks valuation/offer/strategy.
  const blocked = verificationStatus !== 'verified';

  const latest = input.latestReportStatus;
  let reportStatus: PartialReportStatus;
  if (latest === 'failed' || latest === 'not_generated') reportStatus = latest;
  else if (blocked) reportStatus = 'blocked';
  else if (latest === 'partial' || latest === 'delivered') reportStatus = latest;
  else reportStatus = 'none';

  // Only a delivered (Full) report could have spent a comp credit.
  const compCreditUsed = reportStatus === 'delivered';

  const parcelVerificationSummary =
    verificationStatus === 'verified' ? 'Parcel identity verified.'
    : verificationStatus === 'mixed' ? 'Some linked parcels are verified and some are not.'
    : verificationStatus === 'unverified' ? 'Parcel identity not verified.'
    : 'No linked parcel yet.';

  const blockedReason = blocked
    ? 'Parcel identity not fully verified. No scoring, valuation, comps, offer, or strategy until APN + county/state/FIPS (or LandPortal property ID + FIPS) confirms a single parcel.'
    : null;

  const discoveryQuestions = blocked ? [...IDENTITY_DISCOVERY_QUESTIONS] : [];

  const persistedNext = firstAction(input.nextActions);
  const nextBestAction = persistedNext ?? (blocked ? discoveryQuestions[0] ?? null : null);

  return {
    reportStatus,
    verificationStatus,
    parcelVerificationSummary,
    verifiedFacts: [],
    anomalyFlags: risks,
    openRisks: risks,
    blockedReason,
    nextBestAction,
    discoveryQuestions,
    noCompCreditUsed: !compCreditUsed,
    compCreditUsed,
    fullReportNote: FULL_REPORT_NOTE,
  };
}
