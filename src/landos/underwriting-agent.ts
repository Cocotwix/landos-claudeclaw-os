// LandOS Underwriting Agent (uw_bot) — operational post-discovery offer approver.
//
// The ONLY agent that approves an offer to a seller, and ONLY after the discovery
// call. It synthesizes the VERIFIED Deal Card (DD facts + comps + pre-call offer
// math) with the discovery-call summary, seller notes, known constraints, and the
// strategy lanes into a final approved offer range + strategy + risks + talking
// points, and emits a Deal Card event (underwriting_snapshot).
//
// HARD RULES enforced here:
//  - Deterministic approver — NO model call approves an offer (a local model can
//    never approve; high-stakes reasoning, if ever added, stays Claude/Tier-3).
//  - No score/value/offer on an unverified parcel.
//  - Never fabricates facts; missing facts are LABELED missing, not invented.
//  - No legal/zoning certainty — those always land in requiredVerification.

import type { ConfirmedParcel } from './parcel-identity.js';

export type UnderwritingStatus = 'approved' | 'needs_deeper_dd' | 'blocked_unverified';

export interface UnderwritingStrategyLane {
  id: string;
  label: string;
  offerLowUsd: number | null;
  offerHighUsd: number | null;
  applicable: boolean;
}

export interface UnderwritingInput {
  apn?: string | null;
  parcelVerified: boolean;
  expectedValueUsd?: number | null;
  strategyLanes?: UnderwritingStrategyLane[];
  discoveryCallSummary?: string | null;
  newDisclosures?: string[];
  sellerNotes?: string | null;
  knownConstraints?: string[];
  /** Whether comps / market facts are already attached to the Deal Card. */
  compsAttached?: boolean;
  marketFactsAttached?: boolean;
}

export interface DealCardEventPayload {
  eventType: 'underwriting_snapshot';
  summary: string;
  /** Non-authoritative structured snapshot for attachment to the Deal Card. */
  detail: Record<string, unknown>;
}

export interface UnderwritingDecision {
  status: UnderwritingStatus;
  apn: string | null;
  approvedOfferLowUsd: number | null;
  approvedOfferHighUsd: number | null;
  /** Max offer ceiling (highest applicable lane high), when approved. */
  maxOfferUsd: number | null;
  recommendedStrategy: string | null;
  secondaryStrategy: string | null;
  talkingPoints: string[];
  risks: string[];
  dealKillers: string[];
  requiredVerification: string[];
  missingFacts: string[];
  reasons: string[];
  attachesToDealCard: boolean;
  knowledgeKey: string | null;
  /** Provenance of the approval — always the deterministic gate, never a model. */
  approvedBy: 'deterministic_gate';
  dealCardEvent: DealCardEventPayload | null;
  executionMode: 'underwriting_operational';
}

const DEAL_KILLER_PATTERNS = [/no (legal )?access/i, /landlock/i, /wetland/i, /flood(way|plain)?/i, /\blien\b/i, /encroach/i, /contaminat/i, /clouded title/i];
const VERIFY_PATTERNS = [/zoning/i, /legal/i, /easement/i, /access/i, /title/i, /flood/i, /wetland/i, /survey/i, /utilit/i, /septic/i, /\bperc\b/i, /setback/i];

function classifyConstraint(c: string): { risk: boolean; dealKiller: boolean; verify: boolean } {
  return {
    dealKiller: DEAL_KILLER_PATTERNS.some((re) => re.test(c)),
    verify: VERIFY_PATTERNS.some((re) => re.test(c)),
    risk: true,
  };
}

/**
 * Run the operational post-discovery underwriting decision. Deterministic. Gates:
 *  unverified -> blocked; no discovery summary or insufficient evidence ->
 *  needs_deeper_dd (never a fabricated offer). Otherwise approves from the
 *  applicable strategy lanes and produces the full decision record + event.
 */
/** Underwriting input with the parcel-verified flag removed — it comes from the
 *  ConfirmedParcel capability, never a caller-supplied boolean. */
export type ConfirmedUnderwritingInput = Omit<UnderwritingInput, 'parcelVerified'>;

// ── Department entry points (ConfirmedParcel capability gate) ────────────────
// Underwriting is the ONLY agent that approves an offer, so it runs ONLY from a
// ConfirmedParcel. The gate replaces the "no score/value/offer on an unverified
// parcel" runtime check with a type the compiler enforces.

/**
 * Gated offer approval. Requires a ConfirmedParcel — confirmed parcel identity is
 * the precondition for any scoring/valuation/offer. There is no other way to run
 * underwriting on a verified parcel.
 */
export function underwriteConfirmedParcel(_parcel: ConfirmedParcel, input: ConfirmedUnderwritingInput): UnderwritingDecision {
  return runUnderwriting({ ...input, parcelVerified: true });
}

/** Candidate-safe: underwriting is blocked until the parcel is confirmed. */
export function blockedUnderwriting(input: ConfirmedUnderwritingInput): UnderwritingDecision {
  return runUnderwriting({ ...input, parcelVerified: false });
}

export function runUnderwriting(input: UnderwritingInput): UnderwritingDecision {
  const apn = (input.apn && input.apn.trim()) || null;
  const missingFacts: string[] = [];
  if (!input.expectedValueUsd) missingFacts.push('expected value (DD)');
  if (!input.compsAttached) missingFacts.push('comparable sales');
  if (!input.marketFactsAttached) missingFacts.push('market metrics');

  const base = {
    apn,
    approvedOfferLowUsd: null as number | null,
    approvedOfferHighUsd: null as number | null,
    maxOfferUsd: null as number | null,
    recommendedStrategy: null as string | null,
    secondaryStrategy: null as string | null,
    talkingPoints: [] as string[],
    risks: [] as string[],
    dealKillers: [] as string[],
    requiredVerification: [] as string[],
    missingFacts,
    attachesToDealCard: !!apn,
    knowledgeKey: apn ? `underwriting/${apn}/uw_decision.json` : null,
    approvedBy: 'deterministic_gate' as const,
    dealCardEvent: null as DealCardEventPayload | null,
    executionMode: 'underwriting_operational' as const,
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

  // Rank applicable lanes by offer ceiling: primary = highest, secondary = next.
  const ranked = [...applicable].sort((a, b) => (b.offerHighUsd ?? 0) - (a.offerHighUsd ?? 0));
  const primary = ranked[0];
  const secondary = ranked[1] ?? null;
  const maxOfferUsd = primary.offerHighUsd ?? null;

  // Risks / deal killers / required verification (deterministic, from constraints).
  const risks: string[] = [];
  const dealKillers: string[] = [];
  const requiredVerification = new Set<string>(['Confirm legal access, zoning, and clean title before close (not assumed verified).']);
  for (const c of input.knownConstraints ?? []) {
    const cls = classifyConstraint(c);
    if (cls.dealKiller) dealKillers.push(c); else if (cls.risk) risks.push(c);
    if (cls.verify) requiredVerification.add(`Verify: ${c}`);
  }
  for (const f of missingFacts) requiredVerification.add(`Obtain ${f} before finalizing.`);

  const status: UnderwritingStatus = dealKillers.length ? 'needs_deeper_dd' : 'approved';
  if (status === 'needs_deeper_dd') {
    return { ...base, status, risks, dealKillers, requiredVerification: [...requiredVerification],
      reasons: [`Potential deal killer(s) present: ${dealKillers.join('; ')}. Resolve via deeper DD before approving an offer.`] };
  }

  const disclosureNote = (input.newDisclosures ?? []).length ? `New disclosures considered: ${(input.newDisclosures ?? []).join('; ')}.` : 'No new disclosures changed the picture.';
  const talkingPoints = [
    `Lead with the ${primary.label} strategy.`,
    `Approved range $${(primary.offerLowUsd ?? 0).toLocaleString()}–$${(primary.offerHighUsd ?? 0).toLocaleString()} (post-discovery); do not exceed $${(maxOfferUsd ?? 0).toLocaleString()}.`,
    secondary ? `Fallback: ${secondary.label}.` : 'No secondary strategy available.',
    'Anchor to the DD facts on the Deal Card before adjusting; flag any unverified item as contingent.',
  ];
  const decision: UnderwritingDecision = {
    ...base, status: 'approved',
    approvedOfferLowUsd: primary.offerLowUsd, approvedOfferHighUsd: primary.offerHighUsd, maxOfferUsd,
    recommendedStrategy: primary.label, secondaryStrategy: secondary?.label ?? null,
    talkingPoints, risks, dealKillers, requiredVerification: [...requiredVerification],
    reasons: [`Verified parcel + discovery summary + applicable lane present. ${disclosureNote}`],
  };
  decision.dealCardEvent = {
    eventType: 'underwriting_snapshot',
    summary: `Underwriting approved: ${primary.label}, $${(primary.offerLowUsd ?? 0).toLocaleString()}–$${(primary.offerHighUsd ?? 0).toLocaleString()} (max $${(maxOfferUsd ?? 0).toLocaleString()}). ${missingFacts.length ? 'Missing: ' + missingFacts.join(', ') + '.' : ''}`.trim(),
    detail: {
      recommendedStrategy: decision.recommendedStrategy, secondaryStrategy: decision.secondaryStrategy,
      approvedOfferLowUsd: decision.approvedOfferLowUsd, approvedOfferHighUsd: decision.approvedOfferHighUsd, maxOfferUsd,
      risks, dealKillers, requiredVerification: decision.requiredVerification, missingFacts, approvedBy: 'deterministic_gate',
    },
  };
  return decision;
}
