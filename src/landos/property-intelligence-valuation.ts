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
}

interface CompObservation {
  decision: CompPolicyDecision;
  pricePerAcre: number;
  acres: number;
  price: number;
  dateIso: string | null;
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
  const conditionalIdentity = input.identityState === 'provisional'
    && input.discoveryIdentityUsable === true;

  if (input.identityState !== 'confirmed' && !conditionalIdentity) {
    return notPriceable(
      `Parcel identity is ${input.identityState}, so no value may be attached to this record. A price on an unidentified parcel is a guess.`,
      'Confirm the subject parcel against the official county/state parcel layer, then re-run Property Intelligence.',
      ['Official parcel identity has not been established.'],
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
  const ppas = obs.map((o) => o.pricePerAcre);
  const mid = median(ppas);
  const dispersion = mid > 0 ? (Math.max(...ppas) - Math.min(...ppas)) / mid : 1;
  const widening = bandWidening(obs.length, dispersion);

  let low = obs.length >= 3 ? percentile(ppas, 0.25) : Math.min(...ppas);
  let high = obs.length >= 3 ? percentile(ppas, 0.75) : Math.max(...ppas);
  if (low === high) { low = mid * 0.85; high = mid * 1.15; }
  low *= (1 - widening);
  high *= (1 + widening);

  const adjustments: string[] = [];

  // Size adjustment: smaller parcels sell for more per acre, larger for less.
  // Only applied when the accepted set's median size differs materially.
  const medianCompAcres = median(obs.map((o) => o.acres));
  const sizeRatio = input.subjectAcres / medianCompAcres;
  if (sizeRatio >= 2) {
    const factor = 0.85;
    low *= factor; high *= factor;
    adjustments.push(`Subject is ${sizeRatio.toFixed(1)}x the median accepted comp size (${medianCompAcres.toFixed(2)} ac), so the per-acre band is reduced ${Math.round((1 - factor) * 100)}% for the usual larger-parcel discount.`);
  } else if (sizeRatio <= 0.5) {
    const factor = 1.1;
    low *= factor; high *= factor;
    adjustments.push(`Subject is ${(1 / sizeRatio).toFixed(1)}x smaller than the median accepted comp (${medianCompAcres.toFixed(2)} ac), so the per-acre band is raised ${Math.round((factor - 1) * 100)}% for the usual small-parcel premium.`);
  } else {
    adjustments.push(`Subject acreage (${input.subjectAcres.toFixed(2)} ac) sits within the accepted comp size range, so no size adjustment was applied.`);
  }

  // Constraint adjustment: mapped physical constraints reduce the band.
  if (input.constraints.length > 0) {
    const factor = Math.max(0.7, 1 - 0.08 * input.constraints.length);
    low *= factor; high *= factor;
    adjustments.push(`${input.constraints.length} mapped physical constraint(s) reduce the band ${Math.round((1 - factor) * 100)}%: ${input.constraints.join('; ')}.`);
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
      `Conditional discovery-stage identity: ${input.identityBasis?.trim()
        || 'the supplied parcel identifiers and retained parcel-provider evidence consistently identify one subject, but an official parcel-source match is not available'}.`,
    );
  }
  uncertainty.push(`Band derived from ${obs.length} accepted closed sale${obs.length === 1 ? '' : 's'}; per-acre spread across the set is ${Math.round(dispersion * 100)}% of the median.`);
  if (obs.length < 3) uncertainty.push(`Only ${obs.length} accepted closed sale${obs.length === 1 ? '' : 's'} — below the three needed for a defensible band, so this is a thin-market indication.`);
  if (activeCount === 0) uncertainty.push('No active competition was found, so current absorption is unknown.');
  uncertainty.push('The disposition range is a planning assumption applied to the retail band, not an observed investor sale price.');
  if (input.hardRisks.length) uncertainty.push(`Unresolved risk(s) that could move value: ${input.hardRisks.join('; ')}.`);

  const materialGaps: string[] = [];
  if (conditionalIdentity) {
    materialGaps.push('Official parcel-source coverage remains unavailable; confirm the subject before a binding offer or closing decision.');
  }
  const withoutSource = obs.filter((o) => !o.decision.candidate.sourceUrl);
  if (withoutSource.length) materialGaps.push(`${withoutSource.length} accepted comp(s) have no retrievable source link.`);
  const withoutDate = obs.filter((o) => !o.dateIso);
  if (withoutDate.length) materialGaps.push(`${withoutDate.length} accepted comp(s) have no verified sale date.`);
  if (input.constraints.length === 0) materialGaps.push('No mapped physical constraint was found; a constraint discovered later would move the band down.');

  const evidenceConfidence: SnapshotValuation['confidence'] = obs.length >= 5 && dispersion <= 0.6 && input.hardRisks.length === 0
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
    basis: `${conditionalIdentity ? 'Conditional discovery-stage valuation. ' : ''}${obs.length} accepted vacant-land closed sale${obs.length === 1 ? '' : 's'} (${primaryCount} LandPortal primary, ${supplementCount} marketplace supplement) normalized to price per acre, applied to ${input.subjectAcres.toFixed(2)} governing acres. ${activeCount} active listing${activeCount === 1 ? '' : 's'} tracked separately as competition and excluded from the value basis.`,
    adjustments,
    confidence,
    uncertainty,
    materialGaps,
    notPriceableReason: null,
    nextActionToPrice: null,
  };
}
