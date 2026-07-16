// Shared research-completeness model (system-wide).
//
// Root cause this fixes: research completeness counted a lane as "evidenced" the
// moment a provider produced ANY output, so a card read "7 of 8 lanes evidenced"
// while zoning had not run, road access was only proximity (not contact/legal
// access), FEMA had only a county-layer screen (panel/BFE pending), and the deed
// had not been read. "A provider executed" is not "the business question is
// resolved". This model separates the evidence tiers a land lane can be in and
// counts screened-vs-resolved distinctly, so the card never presents partial
// evidence as completed research.
//
// Pure + deterministic. Consumers map their findings into LaneSignal.

export type EvidenceTier =
  | 'not_attempted' // no provider ran this lane
  | 'attempted'     // a provider ran but returned no usable data
  | 'retrieved'     // a provider retrieved usable data (desktop screen exists)
  | 'partial'       // some evidence exists but the business question is unresolved
  | 'resolved'      // the underwriting/business question for this lane is resolved
  | 'confirmed';    // legal/external confirmation (survey, FIRM, recorded instrument) complete

const TIER_RANK: Record<EvidenceTier, number> = {
  not_attempted: 0,
  attempted: 1,
  retrieved: 2,
  partial: 3,
  resolved: 4,
  confirmed: 5,
};

export interface LaneSignal {
  key: string;
  label: string;
  /** A provider ran this lane. */
  attempted: boolean;
  /** A provider retrieved usable data. */
  dataRetrieved: boolean;
  /**
   * The business/underwriting question for this lane is resolved by the retrieved
   * evidence (e.g. zoning code known; wetland overlay screened; septic outlook
   * derived). Partial signals (road proximity without contact/legal access, a
   * county flood layer without panel/BFE) are NOT business-resolved.
   */
  businessResolved: boolean;
  /** This lane needs a legal/external confirmation beyond desktop screening. */
  externalConfirmationRequired: boolean;
  /** The external/legal confirmation has been completed (recorded instrument, FIRM, survey). */
  externalConfirmed?: boolean;
  /** What remains before this lane is business-resolved (operator-facing). */
  remaining?: string | null;
}

export interface ResearchLane extends LaneSignal {
  tier: EvidenceTier;
}

export interface ResearchCompleteness {
  lanes: ResearchLane[];
  total: number;
  /** Lanes a provider attempted. */
  attempted: number;
  /** Lanes with retrieved data (desktop screen exists) — tier >= retrieved. */
  screened: number;
  /** Lanes whose business question is resolved — tier >= resolved. */
  resolved: number;
  /** Lanes with completed legal/external confirmation — tier == confirmed. */
  confirmed: number;
  /** Lanes not yet screened (no usable data). */
  missing: string[];
  /** Lanes screened but not business-resolved (partial evidence). */
  unresolved: string[];
  /** Lanes business-resolved but still needing external/legal confirmation. */
  awaitingExternalConfirmation: string[];
  /** True only when EVERY lane is at least business-resolved. */
  complete: boolean;
  /**
   * Back-compat: prior code read `withEvidence` as the count of evidenced lanes.
   * It now means business-RESOLVED lanes, so a lane with only partial evidence no
   * longer inflates the "evidenced" count.
   */
  withEvidence: number;
}

export function tierOf(signal: LaneSignal): EvidenceTier {
  if (!signal.attempted) return 'not_attempted';
  if (!signal.dataRetrieved) return 'attempted';
  if (!signal.businessResolved) return 'partial';
  if (signal.externalConfirmationRequired) return signal.externalConfirmed ? 'confirmed' : 'resolved';
  return 'resolved';
}

export function computeResearchCompleteness(signals: LaneSignal[]): ResearchCompleteness {
  const lanes: ResearchLane[] = signals.map((s) => ({ ...s, tier: tierOf(s) }));
  const atLeast = (tier: EvidenceTier) => lanes.filter((l) => TIER_RANK[l.tier] >= TIER_RANK[tier]);
  const screened = atLeast('retrieved');
  const resolved = atLeast('resolved');
  const confirmed = lanes.filter((l) => l.tier === 'confirmed');
  const missing = lanes.filter((l) => TIER_RANK[l.tier] < TIER_RANK.retrieved).map((l) => l.label);
  const unresolved = lanes
    .filter((l) => TIER_RANK[l.tier] >= TIER_RANK.retrieved && TIER_RANK[l.tier] < TIER_RANK.resolved)
    .map((l) => l.label);
  const awaitingExternalConfirmation = lanes
    .filter((l) => l.externalConfirmationRequired && !l.externalConfirmed && TIER_RANK[l.tier] >= TIER_RANK.resolved)
    .map((l) => l.label);
  return {
    lanes,
    total: lanes.length,
    attempted: lanes.filter((l) => l.attempted).length,
    screened: screened.length,
    resolved: resolved.length,
    confirmed: confirmed.length,
    missing,
    unresolved,
    awaitingExternalConfirmation,
    complete: lanes.length > 0 && resolved.length === lanes.length,
    withEvidence: resolved.length,
  };
}

/** Operator-facing one-liner that never presents partial evidence as complete. */
export function researchCompletenessSummary(rc: ResearchCompleteness): string {
  const parts = [`${rc.resolved}/${rc.total} lanes business-resolved`];
  if (rc.screened > rc.resolved) parts.push(`${rc.screened - rc.resolved} more screened but unresolved (${rc.unresolved.join(', ')})`);
  if (rc.missing.length) parts.push(`${rc.missing.length} not yet screened (${rc.missing.join(', ')})`);
  if (rc.awaitingExternalConfirmation.length) parts.push(`awaiting external confirmation: ${rc.awaitingExternalConfirmation.join(', ')}`);
  return `${parts.join('; ')}.`;
}
