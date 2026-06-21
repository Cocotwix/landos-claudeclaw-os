// LandOS Deal Card — delete-comp-and-rerun.
//
// Each comp on a Deal Card gets an ✕. Removing a comp recomputes the offer lanes
// off the SURVIVING comps only — NO backfill, NO re-search, no invented value.
// The deletion is logged as an override (comps.deleteComp audits it).
//
// The offer math is the existing six-lane engine (offer-engine.computeOfferLanes).
// EV is re-derived from the surviving sold comps (median $/acre x subject acres,
// or median sold price when acreage is unknown). With no usable survivors EV is
// null and the engine fails loud (computed:false) — it never invents an offer.

import { computeOfferLanes, type OfferLanesResult } from './offer-engine.js';
import { deleteComp, listComps, type CompRow } from './comps.js';

/** Median of a numeric list (sorted middle / mean of two middles). null when empty. */
function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 100) / 100;
}

export interface CompSummary {
  /** Count of usable sold comps (price_kind 'sale', positive price). */
  soldCount: number;
  medianSoldPriceUsd: number | null;
  medianPricePerAcreUsd: number | null;
  /** EV re-derived from survivors: $/acre x acres, else median sold price, else null. */
  impliedEvUsd: number | null;
  /** Comp value used for the under-1-acre discipline (median sold price). */
  compValueUsd: number | null;
}

/** Summarize a comp set for offer recomputation. Pure. Uses only verifiable sold
 *  comps (price_kind 'sale' with a positive price); never invents a value. */
export function summarizeComps(comps: CompRow[], subjectAcres?: number | null): CompSummary {
  const sold = comps.filter((c) => c.price_kind === 'sale' && typeof c.price === 'number' && (c.price as number) > 0);
  const prices = sold.map((c) => c.price as number);
  const ppas = sold
    .map((c) => c.price_per_acre)
    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0);

  const medianSoldPriceUsd = median(prices);
  const medianPricePerAcreUsd = median(ppas);

  let impliedEvUsd: number | null = null;
  if (typeof subjectAcres === 'number' && subjectAcres > 0 && medianPricePerAcreUsd !== null) {
    impliedEvUsd = Math.round(medianPricePerAcreUsd * subjectAcres);
  } else if (medianSoldPriceUsd !== null) {
    impliedEvUsd = medianSoldPriceUsd;
  }

  return {
    soldCount: sold.length,
    medianSoldPriceUsd,
    medianPricePerAcreUsd,
    impliedEvUsd,
    compValueUsd: medianSoldPriceUsd,
  };
}

export interface RecomputeContext {
  subjectAcres?: number | null;
  verdict?: 'PURSUE' | 'PURSUE WITH CAUTION' | 'PASS';
  avgDaysOnMarket?: number;
  /** Subdivide gate inputs (passed through to the lane engine). */
  buildablePct?: number;
  wetlandsPct?: number;
  femaPct?: number;
  landlocked?: boolean;
  verifiedManufacturedSalesUsd?: number[];
}

export interface RecomputeResult {
  summary: CompSummary;
  offer: OfferLanesResult;
  survivorCount: number;
}

/** Recompute the offer lanes from a comp set (pure). Re-derives EV + comp stats
 *  from the survivors and runs the six-lane engine. */
export function recomputeOfferFromComps(comps: CompRow[], ctx: RecomputeContext = {}): RecomputeResult {
  const summary = summarizeComps(comps, ctx.subjectAcres);
  const offer = computeOfferLanes({
    expectedValueUsd: summary.impliedEvUsd ?? 0,
    acres: ctx.subjectAcres ?? undefined,
    verdict: ctx.verdict,
    compCount: summary.soldCount,
    avgDaysOnMarket: ctx.avgDaysOnMarket,
    compValueUsd: summary.compValueUsd ?? undefined,
    buildablePct: ctx.buildablePct,
    wetlandsPct: ctx.wetlandsPct,
    femaPct: ctx.femaPct,
    landlocked: ctx.landlocked,
    verifiedManufacturedSalesUsd: ctx.verifiedManufacturedSalesUsd,
  });
  return { summary, offer, survivorCount: comps.length };
}

export interface DeleteAndRecomputeResult extends RecomputeResult {
  deleted: boolean;
}

/**
 * Delete one comp from a Deal Card and recompute the offer off the survivors.
 * DB-backed: removes the row (audited as an override), reloads the remaining
 * comps for the Deal Card, and recomputes. NO backfill, NO re-search. When the
 * comp is not found, deleted:false and the recompute reflects the current set.
 */
export function deleteCompAndRecompute(
  dealCardId: number,
  compId: number,
  ctx: RecomputeContext & { actor?: string; reason?: string } = {},
): DeleteAndRecomputeResult {
  const deleted = deleteComp(compId, { actor: ctx.actor, reason: ctx.reason });
  const survivors = listComps({ dealCardId });
  const recompute = recomputeOfferFromComps(survivors, ctx);
  return { ...recompute, deleted };
}
