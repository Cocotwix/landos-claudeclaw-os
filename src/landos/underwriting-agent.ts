// LandOS Underwriting Agent (uw_bot) — post-discovery offer approver (scaffold).
//
// This is the ONLY agent that approves an offer to a seller, and it runs AFTER the
// discovery call — never before. It synthesizes the verified Deal Card (DD facts +
// comps + pre-call offer math) with the discovery-call summary and any new
// disclosures into a final approved offer range + strategy + talking points.
//
// SCAFFOLD: deterministic, no model call. It enforces the gates (parcel must be
// verified; insufficient evidence -> needs deeper DD, never a fabricated offer)
// and produces the decision record shape. Deep Tier-3 reasoning is wired in a
// later pass. Output is a property-specific artifact -> attaches to the Deal Card
// and persists under underwriting/{apn}/ in the knowledge layer.

export type UnderwritingStatus = 'approved' | 'needs_deeper_dd' | 'blocked_unverified';

export interface UnderwritingInput {
  /** Parcel identity (APN or LandPortal id) — required to attach to a Deal Card. */
  apn?: string | null;
  parcelVerified: boolean;
  /** Pre-call Expected Value from the DD report, if computed. */
  expectedValueUsd?: number | null;
  /** Pre-call strategy lanes the DD report produced (labels only here). */
  strategyLanes?: Array<{ id: string; label: string; offerLowUsd: number | null; offerHighUsd: number | null; applicable: boolean }>;
  /** Discovery-call summary text (post-call). Absent => cannot underwrite yet. */
  discoveryCallSummary?: string | null;
  /** New facts the seller disclosed on the call (may change the picture). */
  newDisclosures?: string[];
}

export interface UnderwritingDecision {
  status: UnderwritingStatus;
  apn: string | null;
  /** Final approved offer range — ONLY present when status === 'approved'. */
  approvedOfferLowUsd: number | null;
  approvedOfferHighUsd: number | null;
  recommendedStrategy: string | null;
  talkingPoints: string[];
  reasons: string[];
  /** Always attaches to the Deal Card (property-specific) when an apn exists. */
  attachesToDealCard: boolean;
  /** Knowledge-layer key for the persisted decision record. */
  knowledgeKey: string | null;
  executionMode: 'underwriting_scaffold';
}

/**
 * Run the post-discovery underwriting decision. Deterministic scaffold. Gates:
 *  - unverified parcel        -> blocked (no score/value/offer).
 *  - no discovery-call summary -> needs deeper DD (underwriting is POST-call).
 *  - no usable EV/lanes        -> needs deeper DD (never invents an offer).
 * Otherwise approves a final range derived from the DD lanes (the deep Tier-3
 * judgment layer replaces this body in a later pass).
 */
export function runUnderwriting(input: UnderwritingInput): UnderwritingDecision {
  const apn = (input.apn && input.apn.trim()) || null;
  const base = {
    apn,
    approvedOfferLowUsd: null as number | null,
    approvedOfferHighUsd: null as number | null,
    recommendedStrategy: null as string | null,
    talkingPoints: [] as string[],
    attachesToDealCard: !!apn,
    knowledgeKey: apn ? `underwriting/${apn}/uw_decision.json` : null,
    executionMode: 'underwriting_scaffold' as const,
  };

  if (!input.parcelVerified) {
    return { ...base, status: 'blocked_unverified', reasons: ['Parcel identity not verified — underwriting cannot score, value, or approve an offer.'] };
  }
  if (!input.discoveryCallSummary || !input.discoveryCallSummary.trim()) {
    return { ...base, status: 'needs_deeper_dd', reasons: ['No discovery-call summary present. Underwriting is post-call; complete the discovery call (and any deeper DD) first.'] };
  }
  const applicable = (input.strategyLanes ?? []).filter((l) => l.applicable && l.offerHighUsd != null);
  if (!input.expectedValueUsd || applicable.length === 0) {
    return { ...base, status: 'needs_deeper_dd', reasons: ['Insufficient verified evidence (no Expected Value / no applicable strategy lane). Run deeper DD; never approve a fabricated offer.'] };
  }

  // Approve from the best applicable lane (highest offer ceiling). Deterministic.
  const best = applicable.reduce((a, b) => ((b.offerHighUsd ?? 0) > (a.offerHighUsd ?? 0) ? b : a));
  const disclosureNote = (input.newDisclosures ?? []).length
    ? `New disclosures considered: ${(input.newDisclosures ?? []).join('; ')}.`
    : 'No new disclosures changed the picture.';
  return {
    ...base,
    status: 'approved',
    approvedOfferLowUsd: best.offerLowUsd,
    approvedOfferHighUsd: best.offerHighUsd,
    recommendedStrategy: best.label,
    talkingPoints: [
      `Lead with the ${best.label} strategy.`,
      `Approved range $${(best.offerLowUsd ?? 0).toLocaleString()}–$${(best.offerHighUsd ?? 0).toLocaleString()} (post-discovery).`,
      'If the seller resists, anchor to the DD facts surfaced on the Deal Card before adjusting.',
    ],
    reasons: [`Verified parcel + discovery summary + applicable lane present. ${disclosureNote}`],
  };
}
