// Property Intelligence valuation — a defensible range or an honest refusal.
//
// The only inputs that may price a parcel are the closed sales the comp source
// policy accepted. Active listings are competition, never a value basis.
//
// This module refuses to price rather than guess. An unresolved/conflicted
// subject (or a provisional subject without an explicit consistent discovery
// handoff), no accepted closed sale, or missing comp acreage returns
// priceable=false with the exact missing evidence and next action. A consistent
// provisional identity may support only a disclosed, low-confidence range.
//
// Pure + deterministic. No I/O.

import type { CompPolicyDecision, CompSourcePolicyResult } from './comp-source-policy.js';
import type { IdentityState, SnapshotValuation } from './property-intelligence-snapshot.js';

export interface ValuationInput {
  identityState: IdentityState;
  /**
   * True only when discovery-stage identity evidence consistently points to
   * one subject (for example: supplied APN/county/state plus an exact
   * LandPortal subject match) even though an official parcel source was not
   * available. Conflicted and unresolved identities remain blocked.
   */
  discoveryIdentityUsable?: boolean;
  /** Plain, non-secret disclosure of the evidence supporting that handoff. */
  identityBasis?: string | null;
  /** Governing subject acreage; null when the acreage basis is unresolved. */
  subjectAcres: number | null;
  /** True when assessed/mapped/deeded acreage disagree materially. */
  acreageConflict: boolean;
  policy: CompSourcePolicyResult;
  /** Material physical constraints that move value (wetlands, flood, access). */
  constraints: string[];
  /** Risks severe enough to withhold a confident conclusion. */
  hardRisks: string[];
  /** Numeric subject adjustments must be explicit and evidence-qualified. */
  valueAdjustments?: ValuationAdjustmentInput[];
}

export interface ValuationAdjustmentInput {
  label: string;
  /** Signed percentage: -10 is a deduction; +5 is a premium. */
  percent: number;
  evidence: string;
  reliability: 'verified' | 'supported' | 'questionable';
  alreadyReflectedInComps?: boolean;
}

interface CompObservation {
  decision: CompPolicyDecision;
  pricePerAcre: number;
  acres: number;
  price: number;
  dateIso: string | null;
  weight: number;
}

function observations(decisions: CompPolicyDecision[]): CompObservation[] {
  const out: CompObservation[] = [];
  for (const decision of decisions) {
    const acres = typeof decision.candidate.acres === 'number' ? decision.candidate.acres : null;
    const price = typeof decision.candidate.price === 'number' ? decision.candidate.price : null;
    const declaredPpa = typeof decision.candidate.pricePerAcre === 'number' ? decision.candidate.pricePerAcre : null;
    if (acres == null || acres <= 0) continue;
    const derivedPpa = price != null && price > 0 ? price / acres : declaredPpa;
    if (derivedPpa == null || !Number.isFinite(derivedPpa) || derivedPpa <= 0) continue;
    out.push({
      decision,
      pricePerAcre: derivedPpa,
      acres,
      price: price ?? derivedPpa * acres,
      dateIso: decision.candidate.saleOrListDate ?? null,
      weight: 1,
    });
  }
  return out;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function weightedPercentile(observations: CompObservation[], p: number): number {
  const sorted = [...observations].sort((a, b) => a.pricePerAcre - b.pricePerAcre);
  const total = sorted.reduce((sum, item) => sum + item.weight, 0);
  const target = total * p;
  let cumulative = 0;
  for (const item of sorted) {
    cumulative += item.weight;
    if (cumulative >= target) return item.pricePerAcre;
  }
  return sorted[sorted.length - 1].pricePerAcre;
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function moneyStep(value: number): number {
  if (value >= 250_000) return 5_000;
  if (value >= 50_000) return 1_000;
  if (value >= 10_000) return 500;
  return 100;
}

/** A wider band is honest when the observation set is thin or dispersed. */
function bandWidening(count: number, dispersion: number): number {
  const thinness = count >= 5 ? 0 : count >= 3 ? 0.05 : 0.12;
  const spread = Math.min(0.2, Math.max(0, dispersion - 0.35) * 0.5);
  return thinness + spread;
}

const NOT_PRICEABLE_BASE: Omit<SnapshotValuation, 'notPriceableReason' | 'nextActionToPrice' | 'materialGaps' | 'uncertainty' | 'basis'> = {
  priceable: false,
  range: null,
  pricePerAcreRange: null,
  likelyRetail: null,
  dispositionRange: null,
  adjustments: [],
  confidence: 'none',
};

function notPriceable(reason: string, nextAction: string, gaps: string[], basis: string): SnapshotValuation {
  return {
    ...NOT_PRICEABLE_BASE,
    basis,
    uncertainty: [reason],
    materialGaps: gaps,
    notPriceableReason: reason,
    nextActionToPrice: nextAction,
  };
}

/**
 * Build the value conclusion.
 *
 * Returns a range with an explicit basis, adjustments, confidence and gaps when
 * the evidence supports it; otherwise returns an explicit refusal naming the
 * missing evidence and the next action.
 */
export function buildPropertyIntelligenceValuation(input: ValuationInput): SnapshotValuation {
  const accepted = input.policy.acceptedSold;
  const activeCount = input.policy.acceptedActive.length;
  const unsupportedPhysical = (value: string) =>
    /\bterrain|slope|buildab|usable acreage|septic|perc|soil\b/i.test(value)
    && /\bunsupported|unverified|questionable|not established|insufficient evidence|single (?:point|map unit)|point sample|preliminary only|cannot be relied|missing\b/i.test(value);
  const supportedHardRisks = input.hardRisks.filter((risk) => !unsupportedPhysical(risk));
  const quarantinedHardRisks = input.hardRisks.filter(unsupportedPhysical);
  const conditionalIdentity = input.identityState === 'provisional'
    && input.discoveryIdentityUsable === true;

  if (input.identityState !== 'confirmed' && !conditionalIdentity) {
    return notPriceable(
      `Parcel identity is ${input.identityState}, so no value may be attached to this record. A price on an unidentified parcel is a guess.`,
      'Resolve the missing or conflicting subject identifiers, then re-run Property Intelligence.',
      ['The subject identity is missing or conflicted.'],
      'No value basis — parcel identity is not confirmed.',
    );
  }

  if (accepted.length === 0) {
    return notPriceable(
      input.policy.valuationBlockers[0]
        ?? 'No accepted vacant-land closed sale exists, so there is no basis for a value conclusion.',
      input.policy.plan.landPortalUsable
        ? 'Widen the LandPortal comparable search area or acreage band and re-run Property Intelligence.'
        : 'LandPortal produced no usable vacant-land comps. Re-run Property Intelligence to search Zillow and Redfin more widely, or supply a known local closed sale.',
      ['No accepted vacant-land closed sale.'],
      `No value basis. ${input.policy.plan.explanation}`,
    );
  }

  const obs = observations(accepted);
  if (obs.length === 0) {
    return notPriceable(
      'Accepted closed sales carry no usable acreage, so a price-per-acre basis cannot be computed.',
      'Retrieve acreage for the accepted closed sales (county record or listing detail) and re-run Property Intelligence.',
      ['Accepted closed sales are missing acreage.'],
      `${accepted.length} accepted closed sale(s) with no acreage.`,
    );
  }

  if (input.subjectAcres == null || input.subjectAcres <= 0) {
    return notPriceable(
      'The subject acreage is not established, so a per-acre band cannot be converted into a parcel value.',
      'Establish the governing acreage from the deed, plat or official parcel record, then re-run Property Intelligence.',
      ['Subject acreage is unresolved.'],
      `${obs.length} accepted closed sale(s) priced per acre, but the subject acreage is unknown.`,
    );
  }

  if (input.acreageConflict) {
    return notPriceable(
      'The acreage bases disagree materially (assessed, mapped, deeded), so any parcel value would inherit that unresolved conflict.',
      'Resolve the governing acreage basis (survey, plat or deed) before pricing; the comp band is retained and will apply once acreage is settled.',
      ['Acreage basis conflict is unresolved.'],
      `${obs.length} accepted closed sale(s) available, held back by the acreage conflict.`,
    );
  }

  // ── Price-per-acre band ────────────────────────────────────────────────────
  const weightedObs = obs.map((observation) => {
    const ratio = Math.max(observation.acres / input.subjectAcres!, input.subjectAcres! / observation.acres);
    const acreageMatch = 1 / ratio;
    const traceability = (observation.dateIso ? 0.25 : 0.1)
      + (observation.decision.candidate.sourceUrl ? 0.25 : 0.1);
    return { ...observation, weight: Math.max(0.2, Math.min(1, acreageMatch * 0.5 + traceability)) };
  });
  const ppas = weightedObs.map((o) => o.pricePerAcre);
  const mid = weightedPercentile(weightedObs, 0.5);
  const dispersion = mid > 0 ? (Math.max(...ppas) - Math.min(...ppas)) / mid : 1;
  const widening = bandWidening(obs.length, dispersion);

  let low = obs.length >= 3 ? weightedPercentile(weightedObs, 0.25) : Math.min(...ppas);
  let high = obs.length >= 3 ? weightedPercentile(weightedObs, 0.75) : Math.max(...ppas);
  if (low === high) { low = mid * 0.85; high = mid * 1.15; }
  low *= (1 - widening);
  high *= (1 + widening);

  const adjustments: string[] = [];

  // Acreage is already visible in each observation's weight. Do not stack an
  // unexplained fixed parcel-size deduction on top of acreage-selected sales.
  const medianCompAcres = median(obs.map((o) => o.acres));
  const sizeRatio = input.subjectAcres / medianCompAcres;
  adjustments.push(
    `Acreage weighting applied rather than a fixed size deduction: subject ${input.subjectAcres.toFixed(2)} ac versus ${medianCompAcres.toFixed(2)} ac median accepted comp (${sizeRatio.toFixed(2)}x).`,
  );

  let evidenceFactor = 1;
  for (const adjustment of input.valueAdjustments ?? []) {
    const usable = adjustment.reliability !== 'questionable'
      && adjustment.alreadyReflectedInComps !== true
      && Number.isFinite(adjustment.percent)
      && Math.abs(adjustment.percent) <= 30
      && adjustment.evidence.trim().length > 0;
    if (!usable) {
      adjustments.push(`${adjustment.label}: no numeric adjustment applied because ${
        adjustment.alreadyReflectedInComps
          ? 'the accepted comps already reflect the condition'
          : adjustment.reliability === 'questionable'
            ? 'the input is questionable'
            : 'the percentage or evidence is not supportable'
      }.`);
      continue;
    }
    evidenceFactor *= 1 + adjustment.percent / 100;
    adjustments.push(`${adjustment.label}: ${adjustment.percent > 0 ? '+' : ''}${adjustment.percent.toFixed(1)}% supported by ${adjustment.evidence}`);
  }
  evidenceFactor = Math.max(0.7, Math.min(1.3, evidenceFactor));
  low *= evidenceFactor;
  high *= evidenceFactor;

  if (input.constraints.length > 0) {
    adjustments.push(
      `No automatic deduction was applied for qualitative constraint text (${input.constraints.join('; ')}). A numeric change requires a reliable subject-versus-comp difference and an explicit percentage; questionable terrain, slope, buildability or septic inputs remain neutral.`,
    );
  }
  if (quarantinedHardRisks.length > 0) {
    adjustments.push(
      `Unsupported physical risk text was quarantined from value and confidence (${quarantinedHardRisks.join('; ')}).`,
    );
  }

  const ppaLow = Math.max(1, roundTo(low, moneyStep(low)));
  const ppaHigh = Math.max(ppaLow + moneyStep(high), roundTo(high, moneyStep(high)));

  const valueLow = roundTo(ppaLow * input.subjectAcres, moneyStep(ppaLow * input.subjectAcres));
  const valueHigh = roundTo(ppaHigh * input.subjectAcres, moneyStep(ppaHigh * input.subjectAcres));

  // Likely retail: what a normal listed sale should achieve — the upper half of
  // the band, because a retail sale is a marketed transaction with time.
  const retailLow = roundTo(valueLow + (valueHigh - valueLow) * 0.4, moneyStep(valueHigh));
  const retailHigh = valueHigh;
  // Realistic disposition: an investor exit that must close quickly. Stated as
  // a planning assumption derived from the retail band, never as a comp fact.
  const dispositionLow = roundTo(retailLow * 0.6, moneyStep(retailLow));
  const dispositionHigh = roundTo(retailHigh * 0.8, moneyStep(retailHigh));

  const uncertainty: string[] = [];
  if (conditionalIdentity) {
    uncertainty.push(
      `Working subject match: ${input.identityBasis?.trim()
        || 'the retained parcel evidence consistently identifies one discovery-stage subject'}.`,
    );
  }
  uncertainty.push(`Band derived from ${obs.length} accepted closed sale${obs.length === 1 ? '' : 's'}; per-acre spread across the set is ${Math.round(dispersion * 100)}% of the median.`);
  if (obs.length < 3) uncertainty.push(`Only ${obs.length} accepted closed sale${obs.length === 1 ? '' : 's'} — below the three needed for a defensible band, so this is a thin-market indication.`);
  if (activeCount === 0) uncertainty.push('No active competition was found, so current absorption is unknown.');
  uncertainty.push('The disposition range is a planning assumption applied to the retail band, not an observed investor sale price.');
  if (supportedHardRisks.length) uncertainty.push(`Unresolved risk(s) that could move value: ${supportedHardRisks.join('; ')}.`);

  const materialGaps: string[] = [];
  const withoutSource = obs.filter((o) => !o.decision.candidate.sourceUrl);
  if (withoutSource.length) materialGaps.push(`${withoutSource.length} accepted comp(s) have no retrievable source link.`);
  const withoutDate = obs.filter((o) => !o.dateIso);
  if (withoutDate.length) materialGaps.push(`${withoutDate.length} accepted comp(s) have no verified sale date.`);
  if (input.constraints.length === 0) materialGaps.push('No quantified subject-versus-comp physical adjustment was supported.');

  const evidenceConfidence: SnapshotValuation['confidence'] = obs.length >= 5 && dispersion <= 0.6 && supportedHardRisks.length === 0
    ? 'high'
    : obs.length >= 3 && dispersion <= 1.2
      ? 'medium'
      : 'low';
  // Discovery-stage identity is enough for a conditional underwriting range,
  // but never enough for medium/high parcel-specific confidence.
  const confidence: SnapshotValuation['confidence'] = conditionalIdentity ? 'low' : evidenceConfidence;

  const primaryCount = accepted.filter((d) => d.role === 'primary').length;
  const supplementCount = accepted.filter((d) => d.role === 'supplement').length;

  return {
    priceable: true,
    range: { low: valueLow, high: valueHigh },
    pricePerAcreRange: { low: ppaLow, high: ppaHigh },
    likelyRetail: { low: retailLow, high: retailHigh },
    dispositionRange: { low: dispositionLow, high: dispositionHigh },
    basis: `${conditionalIdentity ? 'Working discovery estimate from the retained parcel match. ' : ''}${obs.length} accepted vacant-land closed sale${obs.length === 1 ? '' : 's'} (${primaryCount} LandPortal primary, ${supplementCount} marketplace supplement) normalized to price per acre, applied to ${input.subjectAcres.toFixed(2)} governing acres. ${activeCount} active listing${activeCount === 1 ? '' : 's'} tracked separately as competition and excluded from the value basis.`,
    primaryBasis: `Raw comp indication $${Math.round(Math.min(...ppas)).toLocaleString()}–$${Math.round(Math.max(...ppas)).toLocaleString()}/acre. Weights: ${weightedObs.map((item) => `${item.decision.candidate.addressDesc ?? item.decision.candidate.provider} ${Math.round(item.weight * 100)}/100`).join('; ')}.`,
    workingValue: roundTo(mid * evidenceFactor * input.subjectAcres, moneyStep(mid * evidenceFactor * input.subjectAcres)),
    adjustments,
    confidence,
    uncertainty,
    materialGaps,
    notPriceableReason: null,
    nextActionToPrice: null,
  };
}
