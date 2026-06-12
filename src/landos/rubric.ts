// LandOS 100-point vacant land scoring rubric — machine-readable encoding.
//
// Source of truth: landos-agents/duke-due-diligence/CLAUDE.md, Section 7.
// This is Tyler's ACTIVE rubric (not a draft). This module encodes it as
// config so dashboard modules and future workflows can share one definition.
// Any change here must stay in sync with Duke's CLAUDE.md and be approved
// by Tyler.

export interface RubricFactor {
  id: string;
  label: string;
  maxPoints: number;
  notes: string;
}

export const RUBRIC_SOURCE = 'landos-agents/duke-due-diligence/CLAUDE.md Section 7';
export const RUBRIC_STATUS = 'approved' as const;

export const RUBRIC_FACTORS: readonly RubricFactor[] = [
  { id: 'valuation_confidence', label: 'Valuation Confidence', maxPoints: 25, notes: 'Comp quality, quantity, distance, valuation transparency' },
  { id: 'access',               label: 'Access',               maxPoints: 20, notes: 'Road frontage, legal access indicators, landlocked status' },
  { id: 'wetlands',             label: 'Wetlands',             maxPoints: 15, notes: 'Percentage of parcel in wetlands' },
  { id: 'fema',                 label: 'FEMA',                 maxPoints: 15, notes: 'Percentage of parcel in flood zone' },
  { id: 'size_usability',       label: 'Size / Usability',     maxPoints: 15, notes: 'Acreage, shape, usable area' },
  { id: 'slope_buildability',   label: 'Slope / Buildability', maxPoints: 10, notes: 'Terrain grade, slope, buildable area' },
];

export const RUBRIC_MAX_SCORE = 100;

export type Verdict = 'PURSUE' | 'PURSUE WITH CAUTION' | 'PASS';

export const VERDICT_TIERS = [
  { min: 75, max: 100, verdict: 'PURSUE' as Verdict },
  { min: 50, max: 74, verdict: 'PURSUE WITH CAUTION' as Verdict },
  { min: 0, max: 49, verdict: 'PASS' as Verdict },
] as const;

/** Mountain Market Modifier: slope thresholds may shift up by 10% in
 *  Appalachia/Ozarks/similar terrain. Must be flagged when active. */
export const MOUNTAIN_MARKET_SLOPE_SHIFT_PCT = 10;

/**
 * Compute the verdict for a total score, applying the Tier-Downgrade
 * Override: if 2 or more factors land in their lowest tier, the verdict
 * drops one level regardless of total score.
 */
export function scoreVerdict(totalScore: number, lowestTierFactorCount = 0): Verdict {
  const capped = Math.max(0, Math.min(RUBRIC_MAX_SCORE, totalScore));
  let verdict: Verdict = 'PASS';
  for (const tier of VERDICT_TIERS) {
    if (capped >= tier.min && capped <= tier.max) {
      verdict = tier.verdict;
      break;
    }
  }
  if (lowestTierFactorCount >= 2) {
    if (verdict === 'PURSUE') return 'PURSUE WITH CAUTION';
    if (verdict === 'PURSUE WITH CAUTION') return 'PASS';
  }
  return verdict;
}
