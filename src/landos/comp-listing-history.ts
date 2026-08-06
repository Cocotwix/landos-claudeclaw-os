// Comparable listing history and honest market time.
//
// The defect this fixes: LandOS showed whatever "days on market" number the
// provider happened to print. That number is the CURRENT listing episode only.
// A seller who withdraws a stale listing for a week and relists it resets the
// portal counter to 0 while the parcel has actually been sitting unsold for
// months. Taking that number at face value makes a tired listing look fresh,
// which is exactly backwards for an acquisition decision.
//
// So this module keeps BOTH numbers and never conflates them:
//
//   • Provider DOM          — the current episode, exactly as the source printed
//                             it. Never edited, never "corrected".
//   • LandOS cumulative DOM — the calendar span of the continuous marketing
//                             cycle, from the earliest credible listing date in
//                             that cycle through the sold date (closed) or today
//                             (active), with short withdrawal gaps stitched.
//
// Stitching is evidence-gated. Two episodes are one marketing effort ONLY when
// the gap is short AND nothing indicates a genuinely new cycle (an intervening
// closed sale, an ownership change, a material acreage change, a parcel split or
// assemblage, a major improvement). When the evidence cannot settle it, the
// result says "Relist stitching uncertain" and the episodes are NOT silently
// merged. When the source exposes only the current episode, cumulative DOM is
// reported as unavailable rather than guessed.
//
// All date math is exact calendar math on ISO dates. No 30.44-day months, no
// "approximately nine months ago" rounding feeding a number.

/** One dated event the source actually documented. Labels are preserved verbatim. */
export type CompListingEventKind =
  | 'listed'
  | 'price_change'
  | 'withdrawn'
  | 'relisted'
  | 'pending'
  | 'back_on_market'
  | 'sold'
  | 'active';

export interface CompListingEvent {
  /** Exact calendar date, YYYY-MM-DD. */
  dateIso: string;
  kind: CompListingEventKind;
  /** Price attached to the event when the source stated one. */
  price: number | null;
  /** The source's own wording, preserved so LandOS never rewrites the record. */
  label: string;
  /** Which retained page supplied this event. */
  source: string;
}

/** Events that OPEN a marketing episode. */
const OPENING: ReadonlySet<CompListingEventKind> = new Set(['listed', 'relisted']);
/** Events that CLOSE a marketing episode (the parcel leaves the market). */
const CLOSING: ReadonlySet<CompListingEventKind> = new Set(['withdrawn', 'sold']);

export interface CompListingEpisode {
  startIso: string;
  /** Null while the episode is still running (an active listing). */
  endIso: string | null;
  /** Why the episode ended, from the source's own event. */
  endKind: 'withdrawn' | 'sold' | null;
  events: CompListingEvent[];
  /** Days from this episode's start to its end (or to today while running). */
  days: number | null;
  /** List price this episode opened at, when stated. */
  openingPrice: number | null;
}

/** A continuous marketing cycle: one or more episodes stitched by short gaps. */
export interface CompMarketingCycle {
  startIso: string;
  endIso: string | null;
  episodes: CompListingEpisode[];
  /** Gaps that were stitched INTO this cycle, with their exact length. */
  stitchedGaps: Array<{ fromIso: string; toIso: string; days: number }>;
}

export type ListingHistoryCompleteness =
  /** Every episode boundary the record needs is documented. */
  | 'full'
  /** Some dated events exist but at least one boundary is missing. */
  | 'partial'
  /** The source exposes only the current listing episode. */
  | 'current_episode_only'
  /** No dated listing events at all. */
  | 'none';

/** Evidence that decides whether two episodes belong to the same marketing effort. */
export interface RelistEvidence {
  /** A closed sale documented BETWEEN the two episodes. Blocks stitching. */
  interveningSale?: boolean;
  /** Documented ownership change between the episodes. Blocks stitching. */
  ownershipChanged?: boolean;
  /** Material acreage change, parcel split, or assemblage. Blocks stitching. */
  acreageChanged?: boolean;
  /** Documented major improvement between the episodes. Blocks stitching. */
  majorImprovement?: boolean;
  /** True when the record genuinely cannot establish the above either way. */
  uncertain?: boolean;
}

export interface ComputeMarketTimeInput {
  events: CompListingEvent[];
  /** 'closed' ends the clock on the sold date; 'active' runs it through today. */
  transactionKind: 'closed' | 'active';
  /** Verified sold date for a closed comp (YYYY-MM-DD). */
  soldDateIso?: string | null;
  /** Today, as an exact ISO date. Injected so the math is deterministic. */
  todayIso: string;
  /** Whatever current-episode DOM the provider printed, preserved untouched. */
  providerDaysOnMarket?: number | null;
  /** Evidence gate for stitching. Absent means "nothing contradicts stitching". */
  relistEvidence?: RelistEvidence;
  /** Maximum withdrawal gap that may be stitched, in days. */
  maxStitchGapDays?: number;
}

export interface CompMarketTime {
  transactionKind: 'closed' | 'active';
  /** Earliest credible listing date in the CONTINUOUS cycle that ends the record. */
  originalListingDateIso: string | null;
  originalListPrice: number | null;
  /** Calendar span of that continuous cycle, gaps included. Null when unknown. */
  cumulativeDays: number | null;
  /** Days actually exposed to the market (stitched gaps subtracted). */
  marketedDays: number | null;
  /** Current / final episode length. */
  currentEpisodeDays: number | null;
  /** Provider's own current-episode figure, preserved exactly as supplied. */
  providerDaysOnMarket: number | null;
  episodeCount: number;
  episodes: CompListingEpisode[];
  stitchedGaps: Array<{ fromIso: string; toIso: string; days: number }>;
  /** Total days the parcel sat off-market inside the stitched cycle. */
  withdrawnDays: number;
  /** True when episodes were merged; the UI must say so. */
  relistStitched: boolean;
  /** True when the evidence could not settle stitching. Never merged silently. */
  stitchUncertain: boolean;
  /** Documented price reductions inside the cycle. */
  priceReductions: Array<{ dateIso: string; from: number | null; to: number; drop: number | null }>;
  completeness: ListingHistoryCompleteness;
  /** Whether an active listing is genuinely new or a cosmetic refresh. */
  freshness: 'genuinely_new' | 'cosmetically_refreshed' | 'long_running' | 'unknown';
  /** Operator-facing sentences. Every claim here is backed by the events above. */
  lines: string[];
}

const DAY_MS = 86_400_000;

/** Exact calendar days between two ISO dates. Null when either is unparseable. */
export function daysBetween(fromIso: string | null | undefined, toIso: string | null | undefined): number | null {
  const a = parseIsoDate(fromIso);
  const b = parseIsoDate(toIso);
  if (a == null || b == null) return null;
  return Math.round((b - a) / DAY_MS);
}

function parseIsoDate(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t : null;
}

/** Sort events by exact date; stable within a date so source order is kept. */
export function sortListingEvents(events: CompListingEvent[]): CompListingEvent[] {
  return [...events]
    .filter((e) => parseIsoDate(e.dateIso) != null)
    .map((e, i) => ({ e, i, t: parseIsoDate(e.dateIso)! }))
    .sort((a, b) => (a.t - b.t) || (a.i - b.i))
    .map((x) => x.e);
}

/**
 * Split a dated event list into marketing episodes.
 *
 * An episode opens on a `listed` / `relisted` event and closes on a `withdrawn`
 * or `sold` event. `pending` and `back_on_market` stay INSIDE an episode: a
 * pending contract is not an off-market withdrawal, and treating it as one would
 * invent a relist the source never documented.
 */
export function splitListingEpisodes(events: CompListingEvent[], todayIso: string): CompListingEpisode[] {
  const sorted = sortListingEvents(events);
  const episodes: CompListingEpisode[] = [];
  let current: CompListingEpisode | null = null;

  for (const event of sorted) {
    if (OPENING.has(event.kind)) {
      if (current) episodes.push(current);
      current = {
        startIso: event.dateIso,
        endIso: null,
        endKind: null,
        events: [event],
        days: null,
        openingPrice: event.price,
      };
      continue;
    }
    if (!current) {
      // A closing or in-episode event with no documented opening. The record is
      // partial; the event is retained but cannot anchor an episode start.
      if (CLOSING.has(event.kind)) {
        episodes.push({
          startIso: event.dateIso,
          endIso: event.dateIso,
          endKind: event.kind === 'sold' ? 'sold' : 'withdrawn',
          events: [event],
          days: 0,
          openingPrice: null,
        });
      }
      continue;
    }
    current.events.push(event);
    if (CLOSING.has(event.kind)) {
      current.endIso = event.dateIso;
      current.endKind = event.kind === 'sold' ? 'sold' : 'withdrawn';
      episodes.push(current);
      current = null;
    }
  }
  if (current) episodes.push(current);

  for (const ep of episodes) {
    ep.days = daysBetween(ep.startIso, ep.endIso ?? todayIso);
  }
  return episodes;
}

/** Does the evidence permit treating two adjacent episodes as one cycle? */
function stitchable(gapDays: number, maxGapDays: number, evidence: RelistEvidence | undefined): 'yes' | 'no' | 'uncertain' {
  if (gapDays > maxGapDays) return 'no';
  if (gapDays < 0) return 'no';
  const e = evidence ?? {};
  if (e.interveningSale || e.ownershipChanged || e.acreageChanged || e.majorImprovement) return 'no';
  if (e.uncertain) return 'uncertain';
  return 'yes';
}

/**
 * Compute honest market time for one comparable.
 *
 * The clock ends on the verified sold date for a closed comp and on today for an
 * active one. It starts at the beginning of the CONTINUOUS cycle that reaches
 * that end — earlier episodes separated by a long gap belong to a different
 * marketing effort and are left out of the cumulative figure (they stay visible
 * in the timeline).
 */
export function computeCompMarketTime(input: ComputeMarketTimeInput): CompMarketTime {
  const maxGap = input.maxStitchGapDays ?? 30;
  const todayIso = input.todayIso;
  const providerDom = typeof input.providerDaysOnMarket === 'number' && Number.isFinite(input.providerDaysOnMarket)
    ? input.providerDaysOnMarket
    : null;
  const episodes = splitListingEpisodes(input.events, todayIso);
  const endIso = input.transactionKind === 'closed' ? (input.soldDateIso ?? null) : todayIso;

  const empty: CompMarketTime = {
    transactionKind: input.transactionKind,
    originalListingDateIso: null,
    originalListPrice: null,
    cumulativeDays: null,
    marketedDays: null,
    currentEpisodeDays: providerDom,
    providerDaysOnMarket: providerDom,
    episodeCount: 0,
    episodes: [],
    stitchedGaps: [],
    withdrawnDays: 0,
    relistStitched: false,
    stitchUncertain: false,
    priceReductions: [],
    completeness: providerDom != null ? 'current_episode_only' : 'none',
    freshness: 'unknown',
    lines: providerDom != null
      ? [`Cumulative DOM unavailable. The source exposes only the current listing episode (${providerDom} days).`]
      : ['Cumulative DOM unavailable. The source did not expose a dated listing history for this record.'],
  };
  if (episodes.length === 0) return empty;

  // Walk backwards from the last episode, stitching short gaps, until the
  // evidence says a gap starts a different marketing effort.
  const cycle: CompListingEpisode[] = [episodes[episodes.length - 1]];
  const stitchedGaps: Array<{ fromIso: string; toIso: string; days: number }> = [];
  let stitchUncertain = false;
  for (let i = episodes.length - 2; i >= 0; i -= 1) {
    const earlier = episodes[i];
    const later = cycle[0];
    const gapDays = daysBetween(earlier.endIso, later.startIso);
    if (gapDays == null) break;
    const verdict = stitchable(gapDays, maxGap, input.relistEvidence);
    if (verdict === 'no') break;
    if (verdict === 'uncertain') { stitchUncertain = true; break; }
    if (earlier.endKind === 'sold') break; // an intervening closed sale ends the cycle
    stitchedGaps.unshift({ fromIso: earlier.endIso ?? earlier.startIso, toIso: later.startIso, days: gapDays });
    cycle.unshift(earlier);
  }

  const first = cycle[0];
  const last = cycle[cycle.length - 1];
  const originalListingDateIso = first.startIso;
  const originalListPrice = first.openingPrice ?? firstStatedPrice(first.events);
  const cycleEndIso = endIso ?? last.endIso ?? todayIso;
  const cumulativeDays = daysBetween(originalListingDateIso, cycleEndIso);
  const withdrawnDays = stitchedGaps.reduce((sum, g) => sum + g.days, 0);
  const marketedDays = cumulativeDays == null ? null : Math.max(0, cumulativeDays - withdrawnDays);
  const currentEpisodeDays = daysBetween(last.startIso, last.endIso ?? cycleEndIso);

  const priceReductions = collectPriceReductions(cycle);

  const completeness: ListingHistoryCompleteness = (() => {
    if (input.transactionKind === 'closed' && !cycle.some((ep) => ep.endKind === 'sold') && !input.soldDateIso) return 'partial';
    if (episodes.length === 1 && episodes[0].events.length <= 1) return 'partial';
    return 'full';
  })();

  const freshness: CompMarketTime['freshness'] = (() => {
    if (input.transactionKind !== 'active') return 'unknown';
    if (cycle.length > 1) return 'cosmetically_refreshed';
    if (cumulativeDays == null) return 'unknown';
    return cumulativeDays > 180 ? 'long_running' : 'genuinely_new';
  })();

  const lines: string[] = [];
  if (input.transactionKind === 'closed') {
    lines.push(
      cumulativeDays != null
        ? `Listed ${originalListingDateIso} and sold ${cycleEndIso}: ${cumulativeDays} cumulative days on market across ${cycle.length} listing episode${cycle.length === 1 ? '' : 's'}.`
        : `Listed ${originalListingDateIso}; the sold date is not documented, so cumulative days on market cannot be calculated.`,
    );
  } else {
    lines.push(
      cumulativeDays != null
        ? `Listed ${originalListingDateIso} and still active on ${cycleEndIso}: ${cumulativeDays} cumulative active market days across ${cycle.length} listing episode${cycle.length === 1 ? '' : 's'}.`
        : `Listed ${originalListingDateIso}; cumulative active market days cannot be calculated from the documented events.`,
    );
  }
  if (stitchedGaps.length > 0) {
    const detail = stitchedGaps.map((g) => `${g.days} day${g.days === 1 ? '' : 's'} (${g.fromIso} → ${g.toIso})`).join(', ');
    lines.push(`Listing was withdrawn and relisted without an intervening sale: ${detail}. The episodes are treated as one continuous marketing effort.`);
  }
  if (providerDom != null && cumulativeDays != null && providerDom < cumulativeDays) {
    lines.push(`Provider DOM: ${providerDom} days. LandOS cumulative DOM: ${cumulativeDays} days. The provider counter reflects only the current listing episode.`);
  }
  if (stitchUncertain) {
    lines.push('Relist stitching uncertain. An earlier listing episode exists but the evidence does not establish whether it was the same marketing effort, so it is not merged into the cumulative figure.');
  }
  if (completeness !== 'full') {
    lines.push('Listing history is incomplete: at least one episode boundary is not documented by the retained source.');
  }

  return {
    transactionKind: input.transactionKind,
    originalListingDateIso,
    originalListPrice,
    cumulativeDays,
    marketedDays,
    currentEpisodeDays,
    providerDaysOnMarket: providerDom,
    episodeCount: cycle.length,
    episodes,
    stitchedGaps,
    withdrawnDays,
    relistStitched: stitchedGaps.length > 0,
    stitchUncertain,
    priceReductions,
    completeness,
    freshness,
    lines,
  };
}

function firstStatedPrice(events: CompListingEvent[]): number | null {
  for (const e of events) if (typeof e.price === 'number' && e.price > 0) return e.price;
  return null;
}

function collectPriceReductions(cycle: CompListingEpisode[]): CompMarketTime['priceReductions'] {
  const out: CompMarketTime['priceReductions'] = [];
  let running: number | null = null;
  for (const ep of cycle) {
    for (const e of ep.events) {
      if (typeof e.price !== 'number' || !(e.price > 0)) continue;
      if (e.kind === 'price_change' && running != null && e.price < running) {
        out.push({ dateIso: e.dateIso, from: running, to: e.price, drop: Math.round(running - e.price) });
      }
      if (e.kind !== 'sold') running = e.price;
    }
  }
  return out;
}
