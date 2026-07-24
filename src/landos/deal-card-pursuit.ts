// Deal Card pursuit decision — the Strategy tab's one question.
//
// Strategy answers exactly one thing: "Should I pursue this opportunity, and at
// what acquisition price does it become attractive?" It replaces the old
// "Can I buy this property?" framing (identity is a gate, not a strategy) and it
// never repeats parcel facts, imagery, or the valuation panel — it CONSUMES the
// reconciled valuation and comp state so the answer always agrees with the rest
// of the card.
//
// Pure + deterministic. No I/O, no provider calls, no fabrication: when there is
// no source-backed value the answer is honestly "insufficient data", never an
// invented price.

export type PursuitAnswer = 'pursue' | 'pursue_with_caution' | 'hold' | 'insufficient_data';

export interface PursuitStrategy {
  strategy: string;
  why: string;
  suitability: string;
}

export interface AttractiveAcquisition {
  /** 40% of the primary preliminary value — the attractive entry. */
  low: number;
  /** 60% of the primary preliminary value — the upper bound of attractive. */
  high: number;
  /** The valuation basis the band is computed from (always the ONE primary). */
  basisLabel: string;
  estMarketValue: number;
  note: string;
}

export interface PursuitDecision {
  question: 'Should I pursue this opportunity?';
  answer: PursuitAnswer;
  /** The one-sentence operator read. */
  answerLine: string;
  /** The price at which this becomes attractive (40-60% of the primary value). */
  attractiveAcquisition: AttractiveAcquisition | null;
  /** Seller-asking context relative to the attractive band (context only). */
  askingContext: string | null;
  /** Plain reasons behind the answer. */
  reasons: string[];
  recommended: PursuitStrategy | null;
  runnerUps: PursuitStrategy[];
  majorBlockers: string[];
  remainingVerification: string[];
}

export interface PursuitInputs {
  parcelVerified: boolean;
  /** The ONE reconciled valuation (deal-card-reconciliation). */
  valuation?: {
    primary: { value: number | null; ppa: number | null; label: string; kind: string } | null;
    confidence: 'low' | 'medium' | 'high';
    conflict: boolean;
    conflictNote: string | null;
  } | null;
  /** The ONE comp state (deal-card-reconciliation). */
  compState?: { soldCount: number; anyRetrieved: boolean; strategyLine: string } | null;
  riskFlags?: string[] | null;
  blockers?: string[] | null;
  verifyBeforeOffer?: string[] | null;
  /** Ranked strategies from the executive summary / discovery report. */
  strategyRanking?: Array<{ strategy: string; viability?: string; verdict?: string; reason: string; risk?: string; mustVerify?: string; mainRisk?: string }> | null;
  strongestStrategy?: { strategy: string; why: string } | null;
  /** Seller asking (negotiation context only — never an offer basis). */
  askingPrice?: number | null;
  /** The shared pricing gate (strategy-readiness). When false, NO attractive
   *  band, winner, or runner-up may be shown — one comp is never a market. */
  pricingAllowed?: boolean;
  pricingBlockers?: string[] | null;
}

const NEIGHBOR = /neighbor/i;
const HARD_RISK = /landlocked|no legal access|title (issue|cloud|problem)|lien|contamination|dispute/i;

function dedupe(xs: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const x of xs) {
    const v = (x ?? '').trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * Decide whether the opportunity is worth pursuing and where it becomes
 * attractive. The attractive band is 40-60% of the ONE primary preliminary
 * value — the same 40-60% acquisition doctrine the discovery range uses — so
 * Strategy and the Seller Call Brief can never quote different math.
 */
export function buildPursuitDecision(inputs: PursuitInputs): PursuitDecision {
  const val = inputs.valuation ?? null;
  const primaryValue = val?.primary?.value ?? null;
  const reasons: string[] = [];

  // The shared pricing gate. Default CLOSED unless the caller proves the value
  // basis is defensible (validated multi-comp band, no conflict, confirmed
  // parcel, resolved acreage). A single sale or a thin basis never produces an
  // attractive band, a winner, or a runner-up.
  const pricingAllowed = inputs.pricingAllowed === true;

  // Attractive acquisition band from the ONE primary valuation — only when the
  // pricing gate is open.
  let attractive: AttractiveAcquisition | null = null;
  if (pricingAllowed && val?.primary && primaryValue != null && primaryValue > 0) {
    attractive = {
      low: Math.round(primaryValue * 0.4),
      high: Math.round(primaryValue * 0.6),
      basisLabel: val.primary.label,
      estMarketValue: Math.round(primaryValue),
      note: `40-60% of the ~$${Math.round(primaryValue).toLocaleString('en-US')} preliminary value (${val.primary.label}). Pre-call guidance, not an offer.`,
    };
  }

  // Asking context (context only, never an offer basis).
  let askingContext: string | null = null;
  const asking = typeof inputs.askingPrice === 'number' && inputs.askingPrice > 0 ? inputs.askingPrice : null;
  if (asking != null && attractive) {
    const rel = asking < attractive.low ? 'below' : asking <= attractive.high ? 'within' : 'above';
    askingContext = `Seller asking $${asking.toLocaleString('en-US')} — ${rel} the attractive band. Negotiation context only.`;
  } else if (asking != null) {
    askingContext = `Seller asking $${asking.toLocaleString('en-US')} — no source-backed value yet to compare it against.`;
  }

  // Strategy recommendation from the ranking (neighbor-sale excluded — not an
  // acquisition strategy).
  const ranked = (inputs.strategyRanking ?? [])
    .filter((s) => s.strategy && !NEIGHBOR.test(s.strategy))
    .map((s) => ({
      strategy: s.strategy,
      why: s.reason || '',
      suitability: (s.viability ?? s.verdict ?? '').toString(),
    }));
  const strongest = inputs.strongestStrategy && !NEIGHBOR.test(inputs.strongestStrategy.strategy) ? inputs.strongestStrategy : null;
  let recommended: PursuitStrategy | null = null;
  if (strongest) {
    const match = ranked.find((r) => r.strategy === strongest.strategy);
    recommended = { strategy: strongest.strategy, why: strongest.why, suitability: match?.suitability ?? '' };
  } else if (ranked.length) {
    const viable = ranked.find((r) => /viable|strong/i.test(r.suitability)) ?? ranked[0];
    recommended = viable;
  }
  let runnerUps = ranked.filter((r) => r.strategy !== recommended?.strategy).slice(0, 3);
  // No winner / runner-up promotion until the evidence supports pricing — the
  // useful decision while blocked is "continue research", not a ranked pick.
  if (!pricingAllowed) {
    recommended = null;
    runnerUps = [];
  }

  // Blockers must not contradict the decision this panel just made: once a
  // primary valuation exists, "valuation not ready" style blockers are stale
  // narrative from a stricter stage and are dropped, not shown alongside a
  // computed attractive band.
  const staleWhenValued = /valuation not ready|no verified valuation|before a preliminary strategy review/i;
  const rawBlockers = (inputs.blockers ?? []).filter((b) => !(attractive && staleWhenValued.test(b)));
  const majorBlockers = dedupe([...rawBlockers, ...(inputs.riskFlags ?? []).filter((r) => HARD_RISK.test(r))]).slice(0, 6);
  // A verification item must name WHAT needs verifying — a bare "Needs
  // confirmation." (no subject) is legacy noise, never an operator task.
  const remainingVerification = dedupe(
    (inputs.verifyBeforeOffer ?? []).filter((v) => v && v.trim() && !/^needs confirmation\.?$/i.test(v.trim())),
  ).slice(0, 8);

  // ── The answer ──────────────────────────────────────────────────────────
  let answer: PursuitAnswer;
  let answerLine: string;
  const hardRisk = (inputs.riskFlags ?? []).find((r) => HARD_RISK.test(r)) ?? null;

  if (!inputs.parcelVerified) {
    answer = 'insufficient_data';
    answerLine = 'Not decidable yet — the parcel is not confirmed. Resolve identity first; strategy math on an unconfirmed parcel is not trustworthy.';
    reasons.push('Parcel identity is not confirmed by a named source.');
  } else if (!attractive) {
    answer = 'insufficient_data';
    const blockers = (inputs.pricingBlockers ?? []).filter(Boolean);
    answerLine = blockers.length
      ? `Not priceable yet — ${blockers[0]} Continue research; no acquisition number exists until the value basis is defensible.`
      : 'Not decidable yet — no source-backed preliminary value exists, so there is no price at which this is measurably attractive.';
    for (const b of blockers) reasons.push(b);
    if (!blockers.length) reasons.push('No valuation basis (sold comps, LandPortal estimate, or assessed value) is available yet.');
    if (inputs.compState && !inputs.compState.anyRetrieved) reasons.push('No comps retrieved yet across any source.');
  } else if (hardRisk) {
    answer = 'hold';
    answerLine = `Hold — a deal-killer-class risk is open (${hardRisk}). Resolve it before pricing; the attractive band below only applies if it clears.`;
    reasons.push(`Open hard risk: ${hardRisk}.`);
  } else if (val?.conflict) {
    answer = 'pursue_with_caution';
    answerLine = `Pursue with caution — value sources disagree, so the attractive band is provisional. Tighten comps before quoting numbers to the seller.`;
    reasons.push(val.conflictNote ?? 'Valuation sources disagree materially.');
  } else if (val?.primary?.kind === 'landportal_comps' && (val.confidence === 'high' || val.confidence === 'medium')) {
    answer = 'pursue';
    answerLine = `Pursue — a LandPortal-comp value exists. This becomes attractive at $${attractive.low.toLocaleString('en-US')}–$${attractive.high.toLocaleString('en-US')} (40-60% of value).`;
    reasons.push(`Primary FMV uses ${val.primary.label}; other provider comps remain visible as context.`);
  } else {
    answer = 'pursue_with_caution';
    answerLine = `Pursue with caution — the value basis is ${val?.primary?.label ?? 'preliminary'} (${val?.confidence} confidence), not a sold-comp band. Attractive at $${attractive.low.toLocaleString('en-US')}–$${attractive.high.toLocaleString('en-US')} if the value holds.`;
    reasons.push(`Value basis: ${val?.primary?.label} (confidence ${val?.confidence}).`);
    if ((inputs.compState?.soldCount ?? 0) === 0) reasons.push('No closed sold comps in the band yet — value can move once real sales are in.');
  }

  if (recommended && answer !== 'insufficient_data') {
    reasons.push(`Best exit: ${recommended.strategy}${recommended.why ? ` — ${recommended.why}` : ''}`);
  }

  return {
    question: 'Should I pursue this opportunity?',
    answer,
    answerLine,
    attractiveAcquisition: attractive,
    askingContext,
    reasons: dedupe(reasons).slice(0, 6),
    recommended,
    runnerUps,
    majorBlockers,
    remainingVerification,
  };
}
