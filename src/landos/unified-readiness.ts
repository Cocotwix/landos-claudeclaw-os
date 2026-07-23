// Unified readiness — ONE shared readiness record for every operator surface.
//
// Root cause this fixes: readiness lived in several unrelated fields (the
// operator record's Value/Offer states, the strategy record's five statuses,
// the comp registry's count gate, a hardcoded frontend contract row, and a
// legacy per-report offer label), so surfaces could tell different stories:
// "Strategy Readiness OK" / "Strategies scoreable" while all five strategies
// were blocked, "Valuation ready" from a bare median while pricing was gated,
// and an offer state that never explained why it was researching.
//
// This module composes the records the canonical assembly already builds
// (pricing gate, strategy-readiness record, research completeness, operator
// value/offer states) into ONE record with explicitly named sub-states:
//
//   1. research            — completeness of the core screening lanes
//   2. valuationContext    — none / preliminary / defensible evidence context
//   3. value               — value readiness (mirrors the operator record)
//   4. strategyScreening   — may strategies be screened against evidence?
//   5. strategyScoreability— may strategies be scored (pricing gate open)?
//   6. strategyActionability — how many strategies are actually actionable?
//   7. offer               — offer readiness (mirrors the operator record)
//   8. contract            — contract readiness (separate from offer)
//
// Every tab, report, executive summary, and RAG doc consumes THIS record.
// It never invents facts, never recomputes a gate two ways, and clamps any
// impossible favorable state into an explicit consistency issue instead of
// rendering it.
//
// Pure + deterministic. No I/O.

import type { PricingGate, StrategyReadinessRecord } from './strategy-readiness.js';
import type { ResearchCompleteness } from './research-completeness.js';

export type ReadinessTone = 'good' | 'caution' | 'risk' | 'unknown';

export interface ReadinessDimension {
  key:
    | 'research'
    | 'valuation_context'
    | 'value'
    | 'strategy_screening'
    | 'strategy_scoreability'
    | 'strategy_actionability'
    | 'offer'
    | 'contract';
  label: string;
  /** Machine state (dimension-specific vocabulary). */
  state: string;
  /** Operator-facing state label. */
  stateLabel: string;
  tone: ReadinessTone;
  /** WHY the dimension is in this state — always present, never empty. */
  why: string;
  blockers: string[];
}

export interface MaterialityFactor {
  factor: 'zoning' | 'acreage_basis' | 'access' | 'title' | 'physical' | 'comp_coherence' | 'research';
  status: 'resolved' | 'unresolved' | 'conflicted';
  effect: string;
}

export interface UnifiedReadinessRecord {
  research: ReadinessDimension;
  valuationContext: ReadinessDimension;
  value: ReadinessDimension;
  strategyScreening: ReadinessDimension;
  strategyScoreability: ReadinessDimension;
  strategyActionability: ReadinessDimension;
  offer: ReadinessDimension;
  contract: ReadinessDimension;
  /** Ordered render list (same objects as the named fields). */
  dimensions: ReadinessDimension[];
  /** Material facts that lowered readiness, with their effect. */
  materiality: MaterialityFactor[];
  blockedStrategyCount: number;
  strategyTotal: number;
  allStrategiesBlocked: boolean;
  /** One line reconciling every dimension — safe for reports and RAG. */
  summaryLine: string;
  /** Internal consistency violations found while composing (audit fails on any). */
  consistencyIssues: string[];
}

export interface UnifiedReadinessInputs {
  parcelVerified: boolean;
  pricingGate: PricingGate;
  research: ResearchCompleteness;
  strategy: StrategyReadinessRecord;
  /** The operator record's value/offer states — mirrored, never recomputed. */
  valueReadiness: { state: 'ready' | 'thin_evidence' | 'not_ready' | 'conflicted'; why: string };
  offerReadiness: { state: 'ready' | 'needs_confirmation' | 'blocked' | 'researching'; why: string };
  /** Registry count gate (≥3 validated unique sold comps) — context only, never a value verdict. */
  registryValuationReady: boolean;
  validatedSoldComps: number;
  valuationConflict: boolean;
  acreageConflict: boolean;
  /** Recorded-instrument facts that gate a contract. */
  legalAccessConfirmed: boolean;
  titleUnresolved: boolean;
  deedReviewed: boolean;
  zoningKnown: boolean;
  /** Material physical constraints already reconciled (wetlands/flood/septic/slope). */
  physicalConstraints: string[];
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const labelOf = (state: string) => cap(state.replace(/_/g, ' '));

function dim(
  key: ReadinessDimension['key'],
  label: string,
  state: string,
  tone: ReadinessTone,
  why: string,
  blockers: string[] = [],
  stateLabel?: string,
): ReadinessDimension {
  return { key, label, state, stateLabel: stateLabel ?? labelOf(state), tone, why, blockers };
}

export function buildUnifiedReadiness(i: UnifiedReadinessInputs): UnifiedReadinessRecord {
  const issues: string[] = [];
  const gateOpen = i.pricingGate.pricingAllowed;

  // ── Materiality: zoning / acreage basis / access / title / physical / comps ──
  const materiality: MaterialityFactor[] = [];
  if (!i.zoningKnown) materiality.push({ factor: 'zoning', status: 'unresolved', effect: 'Zoning is unretrieved — permitted use, minimum lot size, and subdivision potential cannot inform value or strategy yet.' });
  if (i.acreageConflict) materiality.push({ factor: 'acreage_basis', status: 'conflicted', effect: 'The acreage basis is disputed (assessed vs mapped) — the value basis is unstable and pricing stays gated until a survey or recorded plat resolves it.' });
  if (!i.legalAccessConfirmed) materiality.push({ factor: 'access', status: 'unresolved', effect: 'Parcel–road contact and legal access are unresolved — offer and contract readiness stay conservative until recorded instruments confirm access.' });
  if (i.titleUnresolved) materiality.push({ factor: 'title', status: 'unresolved', effect: 'Ownership/title questions (trust authority or malformed owner record) are unresolved — contract readiness is blocked until the instruments are read.' });
  for (const constraint of i.physicalConstraints) {
    materiality.push({ factor: 'physical', status: 'unresolved', effect: constraint });
  }
  if (i.valuationConflict) materiality.push({ factor: 'comp_coherence', status: 'conflicted', effect: 'Valuation evidence is materially conflicted — a blended median would be misleading, so value readiness cannot be high.' });
  if (!i.research.complete) materiality.push({ factor: 'research', status: 'unresolved', effect: `Research is incomplete (${i.research.resolved}/${i.research.total} lanes business-resolved) — readiness states remain researching until the open lanes resolve.` });

  // ── 1. Research completeness ────────────────────────────────────────────────
  const research = (() => {
    const parts: string[] = [`${i.research.resolved} of ${i.research.total} core screening lanes are business-resolved.`];
    if (i.research.unresolved.length) parts.push(`Screened but unresolved (partial evidence only): ${i.research.unresolved.join(', ')}.`);
    if (i.research.missing.length) parts.push(`Not screened yet: ${i.research.missing.join(', ')}.`);
    if (i.research.awaitingExternalConfirmation.length) parts.push(`Awaiting external/legal confirmation: ${i.research.awaitingExternalConfirmation.join(', ')}.`);
    const state = i.research.complete ? 'complete' : i.research.attempted > 0 ? 'in_progress' : 'not_started';
    return dim('research', 'Research completeness', state, i.research.complete ? 'good' : i.research.attempted > 0 ? 'caution' : 'unknown', parts.join(' '), [...i.research.unresolved, ...i.research.missing]);
  })();

  // ── 2. Preliminary vs defensible valuation context ─────────────────────────
  const valuationContext = (() => {
    if (gateOpen) {
      return dim('valuation_context', 'Valuation context', 'defensible', 'good', 'A defensible value basis exists: the shared pricing gate is open over the usable LandPortal comp set. Other provider comps remain visible as context.');
    }
    if (i.validatedSoldComps > 0 || i.registryValuationReady) {
      const median = i.registryValuationReady
        ? 'Enough validated sold comps exist to compute a median, but a computable median is PRELIMINARY CONTEXT ONLY — it does not open pricing while material conflicts or research gaps remain.'
        : `${i.validatedSoldComps} validated sold observation(s) provide preliminary context only — below a defensible basis.`;
      return dim('valuation_context', 'Valuation context', 'preliminary', 'caution', `${median} ${i.pricingGate.pricingBlockers.join(' ')}`.trim(), [...i.pricingGate.pricingBlockers]);
    }
    return dim('valuation_context', 'Valuation context', 'none', 'unknown', 'No validated sold observations yet — no valuation context exists.', [...i.pricingGate.pricingBlockers]);
  })();

  // ── 3. Value readiness (mirrors the operator record; clamped to the gate) ──
  const value = (() => {
    let state = i.valueReadiness.state as string;
    let why = i.valueReadiness.why;
    if (!gateOpen && state === 'ready') {
      issues.push('Value readiness reported "ready" while the shared pricing gate is closed — clamped to the gate.');
      state = i.valuationConflict || i.acreageConflict ? 'conflicted' : 'not_ready';
      why = `Pricing gate closed: ${i.pricingGate.pricingBlockers.join(' ')}`;
    }
    const tone: ReadinessTone = state === 'ready' ? 'good' : state === 'conflicted' ? 'risk' : 'caution';
    return dim('value', 'Value readiness', state, tone, why, gateOpen ? [] : [...i.pricingGate.pricingBlockers]);
  })();

  // ── 4./5./6. Strategy: screening vs scoreability vs actionability ──────────
  const strategyTotal = i.strategy.strategies.length;
  const blockedStrategyCount = i.strategy.strategies.filter((s) => s.status === 'blocked').length;
  const allStrategiesBlocked = strategyTotal > 0 && blockedStrategyCount === strategyTotal;

  const strategyScreening = i.parcelVerified
    ? dim('strategy_screening', 'Strategy screening', 'available', 'good',
        'Strategy screening is available: each of the five approved strategies is evaluated against the current desktop evidence, and each names its blockers and required evidence.')
    : dim('strategy_screening', 'Strategy screening', 'unavailable', 'unknown',
        'Strategy screening is unavailable — the parcel identity is not confirmed, so no strategy can be evaluated.', ['Parcel identity unconfirmed']);

  const strategyScoreability = gateOpen
    ? dim('strategy_scoreability', 'Strategy scoreability', 'scoreable', 'good',
        'Strategies can be scored: a defensible value basis exists to score exits against.')
    : dim('strategy_scoreability', 'Strategy scoreability', 'not_scoreable', 'caution',
        `Strategies cannot be scored yet — no defensible value basis. ${i.pricingGate.pricingBlockers.join(' ')}`,
        [...i.pricingGate.pricingBlockers]);

  const strategyActionability = (() => {
    const strategyBlockers = [...new Set(i.strategy.strategies.flatMap((s) => s.blockers))];
    if (allStrategiesBlocked) {
      return dim('strategy_actionability', 'Strategy actionability', 'blocked', 'caution',
        `All ${strategyTotal} approved strategies are blocked pending evidence — none is actionable. Screening remains available, but no strategy may be pursued, promoted, or priced. ${i.strategy.pricingBlockers.join(' ')}`.trim(),
        strategyBlockers, `All ${strategyTotal} blocked`);
    }
    const actionable = strategyTotal - blockedStrategyCount;
    if (blockedStrategyCount > 0) {
      return dim('strategy_actionability', 'Strategy actionability', 'partially_actionable', 'caution',
        `${actionable} of ${strategyTotal} strategies can be worked (${i.strategy.strategies.filter((s) => s.status !== 'blocked').map((s) => `${s.strategy}: ${s.status.replace('_', ' ')}`).join('; ')}); ${blockedStrategyCount} remain blocked.`,
        strategyBlockers, `${actionable} of ${strategyTotal} workable`);
    }
    return dim('strategy_actionability', 'Strategy actionability', 'actionable', 'good',
      `All ${strategyTotal} approved strategies can be worked: ${i.strategy.strategies.map((s) => `${s.strategy}: ${s.status.replace('_', ' ')}`).join('; ')}.`, []);
  })();

  // Invariant (the WS3 contradiction): all five blocked can NEVER coexist with a
  // favorable scoreability/actionability read.
  if (allStrategiesBlocked && strategyScoreability.state === 'scoreable') {
    issues.push('Strategy scoreability reported "scoreable" while all strategies are blocked — inconsistent gate/strategy records.');
    strategyScoreability.state = 'not_scoreable';
    strategyScoreability.stateLabel = labelOf('not_scoreable');
    strategyScoreability.tone = 'caution';
    strategyScoreability.why = `Strategies cannot be scored: all ${strategyTotal} approved strategies are blocked pending evidence.`;
  }

  // ── 7. Offer readiness (mirrors the operator record; clamped to the gate) ──
  const offer = (() => {
    let state = i.offerReadiness.state as string;
    let why = i.offerReadiness.why;
    if (!gateOpen && (state === 'ready' || state === 'needs_confirmation')) {
      issues.push(`Offer readiness reported "${state}" while the shared pricing gate is closed — clamped to the gate.`);
      state = i.research.complete ? 'blocked' : 'researching';
      why = `Pricing gate closed: ${i.pricingGate.pricingBlockers.join(' ')}`;
    }
    if (!why.trim()) {
      why = state === 'ready' ? 'Every offer gate is open.' : 'No explanation was recorded — treat as researching until the blockers are enumerated.';
      if (state !== 'ready') issues.push('Offer readiness carried no explanation — a readiness state must always say why.');
    }
    const tone: ReadinessTone = state === 'ready' ? 'good' : state === 'blocked' ? 'risk' : state === 'needs_confirmation' ? 'caution' : 'unknown';
    return dim('offer', 'Offer readiness', state, tone, why, gateOpen ? [] : [...i.pricingGate.pricingBlockers]);
  })();

  // ── 8. Contract readiness — SEPARATE from offer readiness ──────────────────
  const contract = (() => {
    const blockers: string[] = [];
    if (!i.legalAccessConfirmed) blockers.push('Legal access unconfirmed (recorded instruments control).');
    if (i.titleUnresolved) blockers.push('Title/ownership authority unresolved (trust instruments and title chain required).');
    if (i.acreageConflict) blockers.push('Legal acreage disputed — a survey or recorded plat must resolve the size before contract terms.');
    if (!i.deedReviewed) blockers.push('The recorded deed and any easements have not been reviewed.');
    if (offer.state !== 'ready' && offer.state !== 'needs_confirmation') blockers.push(`Offer readiness is still ${offer.state.replace(/_/g, ' ')} — a contract cannot precede an offer decision.`);
    if (blockers.length) {
      return dim('contract', 'Contract readiness', 'blocked', offer.state === 'ready' ? 'caution' : 'risk',
        `Contract readiness is separate from offer readiness and remains blocked: ${blockers.join(' ')}`, blockers);
    }
    return dim('contract', 'Contract readiness', 'needs_confirmation', 'caution',
      'Offer gates are open and no recorded-instrument blocker remains on file; final title commitment and signature authority still require confirmation at contract time.');
  })();

  const dimensions = [research, valuationContext, value, strategyScreening, strategyScoreability, strategyActionability, offer, contract];

  const summaryLine = `Readiness: research ${i.research.resolved}/${i.research.total} resolved; valuation context ${valuationContext.state.replace(/_/g, ' ')}; value ${value.state.replace(/_/g, ' ')}; strategy screening ${strategyScreening.state}; scoreability ${strategyScoreability.state.replace(/_/g, ' ')}; actionability ${strategyActionability.stateLabel.toLowerCase()}; offer ${offer.state.replace(/_/g, ' ')}; contract ${contract.state.replace(/_/g, ' ')}.`;

  return {
    research,
    valuationContext,
    value,
    strategyScreening,
    strategyScoreability,
    strategyActionability,
    offer,
    contract,
    dimensions,
    materiality,
    blockedStrategyCount,
    strategyTotal,
    allStrategiesBlocked,
    summaryLine,
    consistencyIssues: issues,
  };
}
