// Shared closed-comp search radius policy.
//
// ONE statement of the rules, used everywhere a closed-comp search decides how
// far to reach. Previously the reach was implied by the geographic tier ladder,
// so "how far did we search and why" had no single answer a reader could point
// at, and nothing stopped an inadmissible record from making the evidence look
// sufficient.
//
// The rules, in full:
//
//   1. Start the closed comp search at five miles.
//   2. If the subject is rural and fewer than three QUALIFIED closed comps are
//      available within five miles, expand to ten miles.
//   3. Otherwise remain at five miles.
//   4. Active, duplicate, improved, unresolved, rejected, nonmarket and context
//      records do not count toward the three.
//   5. A sale proven to belong to another parcel, or officially classified as
//      nonmarket, stays RETAINED with zero valuation weight. It is never
//      deleted and never counted.
//
// Rules 4 and 5 are why the count is not simply "closed sales nearby". Deal 90
// carried a $9,500 record that the county proved belonged to a different parcel
// and classified as not exposed to the open market; counting it would have made
// the five-mile evidence look sufficient on a sale that prices nothing.

/** Where every closed-comp search begins. */
export const CLOSED_COMP_START_RADIUS_MILES = 5;
/** The only expansion, and only for a rural subject short of evidence. */
export const CLOSED_COMP_RURAL_EXPANSION_RADIUS_MILES = 10;
/** Qualified closed comps needed inside the start radius to stay there. */
export const MIN_QUALIFIED_CLOSED_COMPS = 3;

/** What a record has to look like to be judged. Deliberately structural so both
 *  the workspace comp and a raw registry row can be passed without adaptation. */
export interface RadiusCandidate {
  distanceMiles?: number | null;
  /** Workspace category, when the caller has classified the record. */
  category?: string | null;
  /** Comparability role within the valuation set, when assigned. */
  valuationRole?: string | null;
  /** Registry status ('rejected', 'market_reference', ...). */
  status?: string | null;
  /** 'sale' for a closed transaction, 'list' for an asking price. */
  priceKind?: string | null;
  /** 'vacant_land' or 'improved'. */
  propertyClass?: string | null;
  /** True when the record is held out of the valuation set for any reason. */
  operatorExcluded?: boolean | null;
  /** -1 when held out, 1 when explicitly included, 0 when neither. */
  valuationSelected?: number | null;
  /** True when the sale is proven to belong to another parcel or is officially
   *  classified as nonmarket (rule 5). */
  nonMarket?: boolean | null;
}

const EXCLUDED_CATEGORIES = new Set([
  'active_competition', 'improved_context', 'rejected', 'context_only',
]);
const EXCLUDED_ROLES = new Set([
  'historical_context', 'geographic_context', 'boundary', 'recency_unverified',
]);

/**
 * Rule 4 and rule 5: does this record count toward the three?
 *
 * A record can be perfectly real, fully retained and still not count. Counting
 * is only about whether the record is admissible closed-sale evidence of what
 * this market pays for comparable vacant land.
 */
export function isQualifiedClosedComp(candidate: RadiusCandidate): boolean {
  // Nonmarket, or proven to belong to another parcel. Retained elsewhere at
  // zero weight; never counted here.
  if (candidate.nonMarket === true) return false;
  // Held out for any reason, including a duplicate folded through the canonical
  // seam and an operator exclusion.
  if (candidate.operatorExcluded === true) return false;
  if (typeof candidate.valuationSelected === 'number' && candidate.valuationSelected < 0) return false;
  if ((candidate.status ?? '') === 'rejected') return false;
  // An asking price is not a transaction.
  if (candidate.priceKind != null && candidate.priceKind !== 'sale') return false;
  // An improved sale carries structure value the land did not.
  if ((candidate.propertyClass ?? '') === 'improved') return false;
  if (candidate.category != null && EXCLUDED_CATEGORIES.has(candidate.category)) return false;
  if (candidate.valuationRole != null && EXCLUDED_ROLES.has(candidate.valuationRole)) return false;
  // Unresolved location. A record LandOS cannot place cannot be counted as
  // being within a radius; it stays retained and visible.
  const distance = candidate.distanceMiles;
  if (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0) return false;
  return true;
}

/** Qualified closed comps strictly inside `miles`. */
export function countQualifiedWithin(candidates: RadiusCandidate[], miles: number): number {
  return candidates.filter((c) => isQualifiedClosedComp(c) && (c.distanceMiles as number) <= miles).length;
}

export interface ClosedCompRadiusDecision {
  /** The radius the search is entitled to use. */
  miles: number;
  /** True only when rule 2 actually fired. */
  expanded: boolean;
  /** Qualified closed comps inside the start radius. */
  qualifiedWithinStart: number;
  /** Qualified closed comps inside the selected radius. */
  qualifiedWithinSelected: number;
  /** Operator-facing sentence stating what happened and why. */
  reason: string;
}

/**
 * Rules 1-3. Pure, so the decision is testable without a market.
 *
 * `isRural` is an INPUT, never inferred here: the expansion is conditioned on a
 * fact about the subject, and a module that guessed it would be asserting
 * something it cannot see.
 */
export function selectClosedCompSearchRadius(
  candidates: RadiusCandidate[],
  opts: { isRural: boolean },
): ClosedCompRadiusDecision {
  const qualifiedWithinStart = countQualifiedWithin(candidates, CLOSED_COMP_START_RADIUS_MILES);
  const short = qualifiedWithinStart < MIN_QUALIFIED_CLOSED_COMPS;
  const expanded = opts.isRural && short;
  const miles = expanded ? CLOSED_COMP_RURAL_EXPANSION_RADIUS_MILES : CLOSED_COMP_START_RADIUS_MILES;
  const qualifiedWithinSelected = expanded ? countQualifiedWithin(candidates, miles) : qualifiedWithinStart;

  const plural = (n: number) => (n === 1 ? 'sale' : 'sales');
  const reason = expanded
    ? `Only ${qualifiedWithinStart} qualified closed ${plural(qualifiedWithinStart)} lie within the ${CLOSED_COMP_START_RADIUS_MILES}-mile start radius, fewer than the ${MIN_QUALIFIED_CLOSED_COMPS} required, and this is a rural subject, so the search expanded to ${CLOSED_COMP_RURAL_EXPANSION_RADIUS_MILES} miles and found ${qualifiedWithinSelected}.`
    : short
      ? `The search stayed at ${CLOSED_COMP_START_RADIUS_MILES} miles with ${qualifiedWithinStart} qualified closed ${plural(qualifiedWithinStart)}. The subject is not recorded as rural, so no expansion is authorised even though fewer than ${MIN_QUALIFIED_CLOSED_COMPS} qualified sales were found.`
      : `${qualifiedWithinStart} qualified closed ${plural(qualifiedWithinStart)} lie within the ${CLOSED_COMP_START_RADIUS_MILES}-mile start radius, so the search stayed there and no expansion was required.`;

  return { miles, expanded, qualifiedWithinStart, qualifiedWithinSelected, reason };
}
