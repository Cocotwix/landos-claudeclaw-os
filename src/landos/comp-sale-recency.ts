// Sold-comp SEARCH RECENCY discipline — one pure vocabulary, shared by every
// collection lane, the enrichment selector, and the operator surface.
//
// THE DEFECT THIS CLOSES. LandOS was spending real collection and transaction-
// enrichment effort on "Sold" records that turned out to have closed in 2013,
// 2020, 2022 and 2023, and only discovered their age afterwards. Two separate
// causes:
//
//   1. COLLECTION. Some lanes asked their source for a 24-month sold set (or
//      for all history) on the FIRST pass, so ancient sales entered the
//      candidate workflow by default rather than as a deliberate fallback.
//   2. UNDATED "SOLD" CARDS. A LandWatch search card states "Sold" and a price
//      but publishes no sale date at all. Treating that card as a current
//      closed comp because it says "Sold" is exactly how a thirteen-year-old
//      sale looked like current market evidence.
//
// THE RULE, system-wide.
//
//   PASS 1  0–12 months. Every source that exposes a trustworthy sold-period
//           filter is asked for the trailing twelve months FIRST.
//   PASS 2  13–24 months, and ONLY when the recent set is insufficient.
//   STOP    Normal current-FMV discovery never deliberately searches past 24
//           months. Sales older than that stay visible as historical context
//           when they are already retained; they are not sought out.
//
// PRICE IS NEVER A FILTER. No minimum, no maximum, no cap, at any pass, in any
// source. Price is evidence to analyze after retrieval, so nothing in this
// module or in any search builder it governs takes a price bound.
//
// Recency is a fact about the sale date, so it is derived here and nowhere
// else: `unestablished` is its own state and is never reported as "sold before
// the cutoff", which is a different claim about a different record.

import { exactMonthsOld, normalizeSaleDateIso } from './comp-recency-window.js';

/** The only sold-search windows normal current-FMV discovery may use, in order. */
export const SOLD_SEARCH_WINDOW_STEPS = [12, 24] as const;
export type SoldSearchWindowMonths = (typeof SOLD_SEARCH_WINDOW_STEPS)[number];

/** Pass 1. Every sold search that can express a period starts here. */
export const RECENT_SALE_WINDOW_MONTHS = 12;
/** Pass 2, and the hard ceiling on deliberate current-FMV search. */
export const MAX_SOLD_SEARCH_WINDOW_MONTHS = 24;

/**
 * How many credible recent closed sales make the 0–12 month set sufficient, so
 * the 13–24 month pass is a deliberate response to a deficiency rather than a
 * default. Deliberately the same threshold the valuation window itself uses to
 * decide it can stop at 12 months, so collection and valuation cannot disagree
 * about what "enough recent evidence" means.
 */
export { MIN_CREDIBLE_FOR_12_MONTH_WINDOW as SUFFICIENT_RECENT_SOLD_COUNT } from './comp-recency-window.js';
import { MIN_CREDIBLE_FOR_12_MONTH_WINDOW } from './comp-recency-window.js';

/**
 * Recency standing of ONE sale.
 *
 *  recent            0–12 months. Normal current-FMV evidence.
 *  expanded_recency  13–24 months. Admitted only when the recent set is thin.
 *  historical        older than 24 months. Context, never current FMV.
 *  unestablished     the source never published a sale date. NOT the same as
 *                    old, and never treated as either recent or old.
 */
export type SaleRecencyState = 'recent' | 'expanded_recency' | 'historical' | 'unestablished';

export interface SaleRecency {
  state: SaleRecencyState;
  /** Exact whole months since the sale, or null when it is undated. */
  monthsOld: number | null;
  dateIso: string | null;
  /** Short badge text for the operator surface. */
  label: string;
  /** One plain sentence stating what the badge means. */
  detail: string;
  /** May this sale carry weight in the CURRENT fair-market-value decision? */
  currentFmvEligible: boolean;
}

/** "6.2 years" / "19 months" — how an operator reads an age at a glance. */
export function ageLabel(monthsOld: number): string {
  if (monthsOld < 24) return `${monthsOld} month${monthsOld === 1 ? '' : 's'} ago`;
  return `${Math.round((monthsOld / 12) * 10) / 10} years ago`;
}

/**
 * Classify one sale date. Pure: no clock of its own, no database.
 *
 * A sale is `recent` through its exact twelve-month anniversary and
 * `expanded_recency` through its exact twenty-four-month anniversary, using the
 * same calendar-accurate age the valuation window uses, so a record can never
 * be described as one age here and another age three panels away.
 */
export function classifySaleRecency(dateIso: string | null | undefined, nowMs: number): SaleRecency {
  const normalized = normalizeSaleDateIso(dateIso ?? null);
  const monthsOld = exactMonthsOld(normalized, nowMs);
  if (normalized == null || monthsOld == null) {
    return {
      state: 'unestablished',
      monthsOld: null,
      dateIso: null,
      label: 'Sale date not established',
      detail: 'The source published no sale date for this record, so its recency is unverified. It is not current fair-market-value evidence until a date is established.',
      currentFmvEligible: false,
    };
  }
  if (monthsOld <= RECENT_SALE_WINDOW_MONTHS) {
    return {
      state: 'recent',
      monthsOld,
      dateIso: normalized,
      label: 'Recent',
      detail: `Closed ${ageLabel(monthsOld)}, inside the trailing ${RECENT_SALE_WINDOW_MONTHS}-month window. Normal current fair-market-value evidence.`,
      currentFmvEligible: true,
    };
  }
  if (monthsOld <= MAX_SOLD_SEARCH_WINDOW_MONTHS) {
    return {
      state: 'expanded_recency',
      monthsOld,
      dateIso: normalized,
      label: 'Expanded recency',
      detail: `Closed ${ageLabel(monthsOld)}, inside 13–24 months. Used only where the ${RECENT_SALE_WINDOW_MONTHS}-month evidence is insufficient.`,
      currentFmvEligible: true,
    };
  }
  return {
    state: 'historical',
    monthsOld,
    dateIso: normalized,
    label: 'Historical sale — not current FMV',
    detail: `Closed ${ageLabel(monthsOld)}, more than ${MAX_SOLD_SEARCH_WINDOW_MONTHS} months ago. Retained as historical context only; it is not current fair-market-value evidence.`,
    currentFmvEligible: false,
  };
}

/** Is the 0–12 month closed-sale evidence already enough to stop expanding? */
export function recentSoldEvidenceSufficient(recentCredibleCount: number): boolean {
  return recentCredibleCount >= MIN_CREDIBLE_FOR_12_MONTH_WINDOW;
}

export interface SoldSearchExpansion {
  /** The next window to search, or null when normal discovery must stop. */
  nextWindowMonths: SoldSearchWindowMonths | null;
  /** The sentence LandOS states about why it expanded, or why it did not. */
  reason: string;
}

/**
 * The deterministic progressive-expansion decision, stated in one place.
 *
 * Normal discovery runs 0–12 months, decides whether that produced enough
 * credible closed evidence, and expands to 13–24 months ONLY when it did not.
 * There is no third step: a 25-month-or-older search is not a window this
 * function can return, so no lane reading it can drift into an all-history
 * sweep by default.
 */
export function nextSoldSearchWindow(
  completedWindowMonths: SoldSearchWindowMonths | null,
  credibleRecentCount: number,
): SoldSearchExpansion {
  if (completedWindowMonths == null) {
    return {
      nextWindowMonths: RECENT_SALE_WINDOW_MONTHS,
      reason: `Sold-comp discovery opens on the trailing ${RECENT_SALE_WINDOW_MONTHS}-month closed-sale window (no price filter).`,
    };
  }
  if (completedWindowMonths === RECENT_SALE_WINDOW_MONTHS) {
    if (recentSoldEvidenceSufficient(credibleRecentCount)) {
      return {
        nextWindowMonths: null,
        reason: `${credibleRecentCount} qualifying closed sale${credibleRecentCount === 1 ? '' : 's'} inside ${RECENT_SALE_WINDOW_MONTHS} months met the ${MIN_CREDIBLE_FOR_12_MONTH_WINDOW}-sale sufficiency threshold, so no older window was searched.`,
      };
    }
    return {
      nextWindowMonths: MAX_SOLD_SEARCH_WINDOW_MONTHS,
      reason: `${RECENT_SALE_WINDOW_MONTHS}-month search produced ${credibleRecentCount} qualifying closed sale${credibleRecentCount === 1 ? '' : 's'}, below the ${MIN_CREDIBLE_FOR_12_MONTH_WINDOW}-sale sufficiency threshold. Expanded to ${MAX_SOLD_SEARCH_WINDOW_MONTHS} months to obtain additional evidence.`,
    };
  }
  return {
    nextWindowMonths: null,
    reason: `Normal current-FMV discovery stops at ${MAX_SOLD_SEARCH_WINDOW_MONTHS} months. Older sales are not searched for; already-retained ones remain visible as historical context.`,
  };
}
