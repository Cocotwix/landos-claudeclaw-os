// LandOS Land Score — compute Tyler's 100-point rubric from LandPortal attributes.
//
// This is the LAND score (access, wetlands, FEMA flood, slope/buildability,
// value-per-acre, size/marketability) — distinct from property valuation. It
// consumes the normalized, source-labeled LandPortal property data
// (DukePropertyData) and the shared rubric definition (rubric.ts). It is pure +
// deterministic, makes no network call, and reads no secret.
//
// HARD RULE — FAIL LOUD, NEVER INFER:
//   Any rubric factor whose underlying LandPortal field is missing scores 0 for
//   that factor, is added to dataGaps, and raises a loud flag. We never invent,
//   estimate, or interpolate a missing attribute into a score. LandPortal
//   imagery is supporting context only and never feeds identity or scoring.

import { RUBRIC_FACTORS, RUBRIC_MAX_SCORE, RUBRIC_SOURCE, scoreVerdict, type Verdict } from './rubric.js';
import type { DukeLandFacts, DukeValuation, DukeSimilars, DukePropertyData } from './duke-property-data.js';

export interface LandScoreFactor {
  id: string;
  label: string;
  maxPoints: number;
  points: number;
  /** Whether this factor landed in its lowest tier (drives the downgrade rule). */
  lowestTier: boolean;
  /** True when the source field was missing — scored 0, never inferred. */
  dataGap: boolean;
  /** What the score is based on (named field) or why it was deducted. */
  basis: string;
}

export interface LandScoreResult {
  score: number;
  maxScore: number;
  verdict: Verdict;
  factors: LandScoreFactor[];
  /** Source fields LandPortal did not return (scored 0, never inferred). */
  dataGaps: string[];
  /** Loud flags surfaced to the operator. */
  flags: string[];
  rubricSource: string;
  /** Honesty label: scoring quality is reduced when factors are data gaps. */
  confidence: 'full' | 'reduced' | 'severely_reduced';
  note: string;
}

function truthy(v: string | undefined): boolean {
  if (!v) return false;
  return /^(true|yes|y|1)$/i.test(v.trim());
}

// Each scorer returns points + whether it's the factor's lowest tier + basis,
// or null when the source field is missing (=> data gap, 0 points, loud flag).
type FactorScore = { points: number; lowestTier: boolean; basis: string } | null;

function scoreWetlands(lf: DukeLandFacts, max: number): FactorScore {
  const pct = lf.wetlandsPct;
  if (pct === undefined) return null;
  if (pct >= 75) return { points: 0, lowestTier: true, basis: `wetlands ${pct}% (>=75% = 0 points)` };
  if (pct >= 50) return { points: Math.round(max * 0.2), lowestTier: false, basis: `wetlands ${pct}%` };
  if (pct >= 30) return { points: Math.round(max * 0.4), lowestTier: false, basis: `wetlands ${pct}%` };
  if (pct >= 15) return { points: Math.round(max * 0.6), lowestTier: false, basis: `wetlands ${pct}%` };
  if (pct >= 5) return { points: Math.round(max * 0.8), lowestTier: false, basis: `wetlands ${pct}%` };
  return { points: max, lowestTier: false, basis: `wetlands ${pct}%` };
}

function scoreFema(lf: DukeLandFacts, max: number): FactorScore {
  const pct = lf.femaPct;
  if (pct === undefined) return null;
  if (pct >= 75) return { points: 0, lowestTier: true, basis: `FEMA flood ${pct}% (>=75% = 0 points)` };
  if (pct >= 50) return { points: Math.round(max * 0.2), lowestTier: false, basis: `FEMA flood ${pct}%` };
  if (pct >= 30) return { points: Math.round(max * 0.4), lowestTier: false, basis: `FEMA flood ${pct}%` };
  if (pct >= 15) return { points: Math.round(max * 0.6), lowestTier: false, basis: `FEMA flood ${pct}%` };
  if (pct >= 5) return { points: Math.round(max * 0.8), lowestTier: false, basis: `FEMA flood ${pct}%` };
  return { points: max, lowestTier: false, basis: `FEMA flood ${pct}%` };
}

function scoreAccess(lf: DukeLandFacts, max: number): FactorScore {
  // Landlocked or zero frontage = maximum deduction (lowest tier), flag loudly.
  if (truthy(lf.landLocked)) return { points: 0, lowestTier: true, basis: 'landlocked = true (max deduction; may have an easement)' };
  const ft = lf.roadFrontageFt;
  if (ft === undefined) return null;
  if (ft <= 0) return { points: 0, lowestTier: true, basis: 'road frontage 0 ft (max deduction; may have an easement)' };
  if (ft >= 200) return { points: max, lowestTier: false, basis: `road frontage ${ft} ft` };
  if (ft >= 100) return { points: Math.round(max * 0.8), lowestTier: false, basis: `road frontage ${ft} ft` };
  if (ft >= 50) return { points: Math.round(max * 0.6), lowestTier: false, basis: `road frontage ${ft} ft` };
  return { points: Math.round(max * 0.4), lowestTier: false, basis: `road frontage ${ft} ft` };
}

function scoreSize(lf: DukeLandFacts, max: number): FactorScore {
  const ac = lf.acres;
  if (ac === undefined) return null;
  if (ac >= 10) return { points: max, lowestTier: false, basis: `${ac} acres` };
  if (ac >= 5) return { points: Math.round(max * 0.87), lowestTier: false, basis: `${ac} acres` };
  if (ac >= 2) return { points: Math.round(max * 0.73), lowestTier: false, basis: `${ac} acres` };
  if (ac >= 1) return { points: Math.round(max * 0.6), lowestTier: false, basis: `${ac} acres` };
  if (ac >= 0.5) return { points: Math.round(max * 0.33), lowestTier: true, basis: `${ac} acres (under 1 acre: deduct)` };
  return { points: Math.round(max * 0.2), lowestTier: true, basis: `${ac} acres (well under 1 acre)` };
}

function scoreSlope(lf: DukeLandFacts, max: number): FactorScore {
  const pct = lf.buildabilityPct;
  if (pct === undefined) return null;
  if (pct >= 75) return { points: max, lowestTier: false, basis: `buildable ${pct}%` };
  if (pct >= 50) return { points: Math.round(max * 0.8), lowestTier: false, basis: `buildable ${pct}%` };
  if (pct >= 25) return { points: Math.round(max * 0.5), lowestTier: false, basis: `buildable ${pct}%` };
  if (pct > 0) return { points: Math.round(max * 0.3), lowestTier: false, basis: `buildable ${pct}%` };
  return { points: Math.round(max * 0.1), lowestTier: true, basis: 'buildable 0% (structure may occupy buildable area; verify with county)' };
}

function scoreValuationConfidence(val: DukeValuation, sim: DukeSimilars, max: number): FactorScore {
  const hasValuation = val.tlpEstimate !== undefined || val.priceAcreCounty !== undefined || val.tlpPpa !== undefined;
  const count = sim.count ?? 0;
  // No LP valuation at all = maximum deduction, flagged loudly (rubric rule).
  if (!hasValuation && count === 0) {
    return { points: 0, lowestTier: true, basis: 'no LP valuation and no comps: maximum deduction' };
  }
  let pts = 0;
  let basis: string;
  if (count >= 4) { pts = hasValuation ? max : Math.round(max * 0.88); basis = `${count} comps${hasValuation ? ' + LP valuation' : ''}`; }
  else if (count >= 2) { pts = Math.round(max * 0.64); basis = `${count} comps (workable)`; }
  else if (count === 1) { pts = Math.round(max * 0.4); basis = '1 comp (weak)'; }
  else { pts = Math.round(max * 0.48); basis = 'LP valuation present, no individual comps'; }
  return { points: pts, lowestTier: pts <= Math.round(max * 0.4), basis };
}

const FACTOR_MAX: Record<string, number> = Object.fromEntries(RUBRIC_FACTORS.map((f) => [f.id, f.maxPoints]));

/**
 * Compute the 100-point Land Score from normalized LandPortal property data.
 * Pure + deterministic. Missing source fields score 0 and are surfaced as loud
 * data gaps — never inferred. Returns per-factor breakdown, total, verdict
 * (with the 2+-lowest-tier downgrade), data gaps, flags, and a confidence label.
 */
export function computeLandScore(input: {
  landFacts: DukeLandFacts;
  valuation: DukeValuation;
  similars: DukeSimilars;
}): LandScoreResult {
  const { landFacts, valuation, similars } = input;
  const flags: string[] = [];
  const dataGaps: string[] = [];
  const factors: LandScoreFactor[] = [];

  const scorers: Record<string, () => FactorScore> = {
    valuation_confidence: () => scoreValuationConfidence(valuation, similars, FACTOR_MAX.valuation_confidence),
    access: () => scoreAccess(landFacts, FACTOR_MAX.access),
    wetlands: () => scoreWetlands(landFacts, FACTOR_MAX.wetlands),
    fema: () => scoreFema(landFacts, FACTOR_MAX.fema),
    size_usability: () => scoreSize(landFacts, FACTOR_MAX.size_usability),
    slope_buildability: () => scoreSlope(landFacts, FACTOR_MAX.slope_buildability),
  };

  for (const f of RUBRIC_FACTORS) {
    const res = scorers[f.id]();
    if (res === null) {
      // FAIL LOUD: missing source field -> 0 points, data gap, loud flag.
      dataGaps.push(f.id);
      flags.push(`${f.label}: LandPortal returned no value — scored 0 (never inferred). Verify with county.`);
      factors.push({ id: f.id, label: f.label, maxPoints: f.maxPoints, points: 0, lowestTier: true, dataGap: true, basis: 'source field missing (data gap)' });
    } else {
      if (res.lowestTier && res.points === 0) flags.push(`${f.label}: ${res.basis}.`);
      factors.push({ id: f.id, label: f.label, maxPoints: f.maxPoints, points: res.points, lowestTier: res.lowestTier, dataGap: false, basis: res.basis });
    }
  }

  const score = Math.min(RUBRIC_MAX_SCORE, factors.reduce((s, f) => s + f.points, 0));
  const lowestTierCount = factors.filter((f) => f.lowestTier).length;
  const verdict = scoreVerdict(score, lowestTierCount);

  const gapCount = dataGaps.length;
  const confidence: LandScoreResult['confidence'] = gapCount === 0 ? 'full' : gapCount <= 2 ? 'reduced' : 'severely_reduced';

  return {
    score,
    maxScore: RUBRIC_MAX_SCORE,
    verdict,
    factors,
    dataGaps,
    flags,
    rubricSource: RUBRIC_SOURCE,
    confidence,
    note: gapCount > 0
      ? `Land Score computed with ${gapCount} data gap(s); missing factors scored 0, never inferred. Confidence ${confidence}.`
      : 'Land Score computed from complete LandPortal attributes.',
  };
}

/** Convenience: compute the Land Score directly from a normalized DukePropertyData. */
export function computeLandScoreFromPropertyData(data: DukePropertyData): LandScoreResult {
  return computeLandScore({ landFacts: data.landFacts, valuation: data.valuation, similars: data.similars });
}
