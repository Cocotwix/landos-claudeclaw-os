// Comparable acreage band + sale-recency window selection.
//
// One pure, deterministic chokepoint deciding WHICH closed vacant-land sales may
// influence the cleaned fair market value. Two independent gates:
//
//   1. ACREAGE BAND — a sale outside the subject's band never influences the
//      cleaned FMV. It stays visible as context; only an explicit operator
//      restore can bring it back.
//   2. SALE-RECENCY HIERARCHY — LandOS prefers the most recent sufficiently
//      supported set and stops expanding as soon as one exists:
//
//        12 months  → used outright when at least 5 credible sales qualify.
//                     Older records are NOT added to pad the sample or to
//                     smooth the range.
//        24 months  → only when fewer than 5 qualify inside 12 months.
//                     Stops here whenever at least 3 credible sales qualify.
//        30 months  → only when 2 or fewer credible sales survive validation
//                     inside 24 months. Months 25–30 enter as clearly labeled
//                     SUPPLEMENTAL HISTORICAL records at reduced weight, and
//                     drop back out automatically once 3 credible sales exist
//                     inside 24 months.
//
// Sales older than 30 months are historical context with ZERO valuation weight —
// they never touch the cleaned average, cleaned median, weighted indication,
// adopted FMV, the 40/50/60 levels, the technical maximum, or the final range.
//
// Dates are compared on the ACTUAL sale date against an exact calendar
// anniversary, never on a rounded "24 months ago" label: a sale stays eligible
// through its exact anniversary date and becomes older immediately afterwards.

import { inAcreagePool, routeAcreage, routedAcreageSimilarity } from './acreage-router.js';

/** Recency steps, in the order LandOS is permitted to try them. */
export const RECENCY_WINDOW_STEPS = [12, 24, 30] as const;
export type RecencyWindowMonths = (typeof RECENCY_WINDOW_STEPS)[number];

/** At least this many credible sales inside 12 months keeps the window at 12. */
export const MIN_CREDIBLE_FOR_12_MONTH_WINDOW = 5;
/** At least this many credible sales inside 24 months forbids the 30-month step. */
export const MIN_CREDIBLE_FOR_24_MONTH_WINDOW = 3;

export interface AcreageBand {
  min: number;
  max: number;
  /** Plain-language statement of the band actually applied. */
  label: string;
}

/**
 * Valuation acreage band for a subject parcel.
 *
 * Rural acreage classes trade as classes: a small-acreage buyer, a mid-acreage
 * buyer, and a large-tract buyer are different markets, so the band is drawn
 * from the subject's class rather than from a flat multiplier that would widen
 * absurdly on large tracts. An 11.46-acre subject sits in the 5-to-25-acre class
 * and therefore prices off 5-to-20-acre sales.
 */
export function valuationAcreageBand(subjectAcres: number | null): AcreageBand | null {
  const route = routeAcreage(subjectAcres);
  return route ? { ...route.pool } : null;
}

export function inAcreageBand(acres: number | null, band: AcreageBand | null): boolean {
  if (band == null) return true; // no subject acreage established: the band cannot gate anything
  return acres != null && Number.isFinite(acres) && acres >= band.min && acres <= band.max;
}

/**
 * Continuous acreage-similarity score in [0,1] inside the band: 1 at the exact
 * subject acreage, falling linearly to 0 at whichever band edge is farther away.
 * A sale near 11.46 acres therefore outweighs a 5-acre or 20-acre sale when the
 * other factors are comparable. Outside the band the score is 0.
 */
export function acreageSimilarity(acres: number | null, subjectAcres: number | null, band: AcreageBand | null): number {
  const route = routeAcreage(subjectAcres);
  if (route == null || band == null || !inAcreagePool(acres, route)) return 0;
  return routedAcreageSimilarity(acres, route);
}

/** Calendar-accurate month subtraction, clamped to the end of a short month. */
export function subtractMonthsUtc(from: Date, months: number): Date {
  const target = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - months, 1));
  const lastDayOfTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(from.getUTCDate(), lastDayOfTarget));
  return target;
}

/** Exact anniversary cutoff (YYYY-MM-DD) for an N-month window ending now. */
export function windowCutoffIso(nowMs: number, months: number): string {
  return subtractMonthsUtc(new Date(nowMs), months).toISOString().slice(0, 10);
}

/** A real calendar date, so "2025-02-30" or month 13 never becomes a comp date. */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1000 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

/**
 * Normalize a provider sale date to YYYY-MM-DD, or null when the value states
 * no usable calendar date.
 *
 * THIS IS THE DEFECT THIS FUNCTION EXISTS TO CLOSE. The window test below used
 * to accept the ISO shape ALONE and treat every other form as undated, which is
 * indistinguishable from "sold before the cutoff": on 5170 Hwy 60 two closed
 * sales dated 06-16-2025 and 06-04-2026 — 13 and 2 months old — were pushed to
 * historical context at zero valuation weight against a 24-month cutoff of
 * 2024-08-14, because "06-16-2025" compares below "2024-08-14" as a STRING. The
 * same rows reported an age of 13 and 2 months at the same time, since that
 * path parsed them correctly. Normalizing here makes every cutoff, window and
 * age comparison read one shape.
 *
 * Month-first is the providers' convention. A leading component that cannot be
 * a month is read as the day, which is a fact about the string rather than a
 * guess; anything still ambiguous or unparseable returns null and stays undated
 * rather than being dated by assumption.
 */
export function normalizeSaleDateIso(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(raw);
  if (iso) {
    const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    return isRealCalendarDate(year, month, day) ? `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` : null;
  }
  const numeric = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(raw);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const year = Number(numeric[3]);
    const [month, day] = first <= 12 ? [first, second] : [second, first];
    return isRealCalendarDate(year, month, day) ? `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` : null;
  }
  return null;
}

/**
 * Does the ACTUAL sale date fall inside an N-month window ending now?
 * A sale remains eligible through its exact anniversary date and becomes older
 * than the window immediately afterwards. Undated sales are never eligible —
 * LandOS cannot date-qualify a sale it has no date for.
 */
export function withinExactMonths(dateIso: string | null, nowMs: number, months: number): boolean {
  const day = normalizeSaleDateIso(dateIso);
  if (!day) return false;
  return day >= windowCutoffIso(nowMs, months);
}

/** Exact whole-month age of a sale, or null when it is undated. */
export function exactMonthsOld(dateIso: string | null, nowMs: number): number | null {
  const day = normalizeSaleDateIso(dateIso);
  if (!day) return null;
  const t = Date.parse(day);
  if (!Number.isFinite(t)) return null;
  const now = new Date(nowMs);
  const then = new Date(t);
  let months = (now.getUTCFullYear() - then.getUTCFullYear()) * 12 + (now.getUTCMonth() - then.getUTCMonth());
  if (now.getUTCDate() < then.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/** Minimal shape the window selector needs from a candidate closed sale. */
export interface RecencyCandidate {
  key: string;
  dateIso: string | null;
  acres: number | null;
  /** False for records a validation step already disqualified (improved, non-arm's-length, open concern, operator-excluded). */
  credible: boolean;
}

export type RecencyBucket =
  | 'primary'                 // inside the selected window, full recency standing
  | 'supplemental_historical' // months 25–30, admitted only because 24 months was insufficient
  | 'historical_context'      // outside the selected window — zero valuation weight
  | 'out_of_band'             // outside the acreage band — zero valuation weight
  | 'not_credible';           // failed validation before the window was applied

export interface RecencyWindowSelection {
  /** The window LandOS actually selected. */
  selectedMonths: RecencyWindowMonths;
  /** Exact anniversary cutoff date applied (YYYY-MM-DD). */
  cutoffIso: string;
  acreageBand: AcreageBand | null;
  /** Credible in-band sales inside 12 / 24 / 30 months (cumulative counts). */
  credibleWithin12: number;
  credibleWithin24: number;
  credibleWithin30: number;
  /** Sales the selected window ADDED beyond the 12-month core. */
  addedFrom13To24: number;
  /** Sales admitted from months 25–30 as supplemental historical records. */
  addedFrom25To30: number;
  /** Credible in-band sales pushed out of the valuation set by the window. */
  movedToHistoricalContext: number;
  /** Credible sales rejected purely on acreage. */
  outOfAcreageBand: number;
  /** Final valuation-set size (primary + supplemental historical). */
  valuationSetCount: number;
  bucketByKey: Record<string, RecencyBucket>;
  /** One operator-readable sentence per decision made. */
  explanation: string[];
}

/**
 * Select the valuation window. Pure: no database, no clock of its own, no
 * mutation of the candidates.
 */
export function selectRecencyWindow(
  candidates: RecencyCandidate[],
  subjectAcres: number | null,
  nowMs: number,
): RecencyWindowSelection {
  const band = valuationAcreageBand(subjectAcres);
  const credibleInBand = candidates.filter((c) => c.credible && inAcreageBand(c.acres, band));
  const outOfAcreageBand = candidates.filter((c) => c.credible && !inAcreageBand(c.acres, band)).length;

  const within = (months: number) => credibleInBand.filter((c) => withinExactMonths(c.dateIso, nowMs, months));
  const credibleWithin12 = within(12).length;
  const credibleWithin24 = within(24).length;
  const credibleWithin30 = within(30).length;

  const explanation: string[] = [];
  let selectedMonths: RecencyWindowMonths;

  if (credibleWithin12 >= MIN_CREDIBLE_FOR_12_MONTH_WINDOW) {
    selectedMonths = 12;
    explanation.push(
      `${credibleWithin12} credible closed vacant-land sales inside ${band?.label ?? 'the acreage band'} sold within the last 12 months — at or above the ${MIN_CREDIBLE_FOR_12_MONTH_WINDOW}-sale threshold, so the valuation uses the 12-month set outright.`,
      'Older sales were NOT added to enlarge the sample or to widen the value range; they stay visible as historical context at zero valuation weight.',
    );
  } else if (credibleWithin24 >= MIN_CREDIBLE_FOR_24_MONTH_WINDOW) {
    selectedMonths = 24;
    explanation.push(
      `Only ${credibleWithin12} credible closed sale${credibleWithin12 === 1 ? '' : 's'} sold within 12 months — below the ${MIN_CREDIBLE_FOR_12_MONTH_WINDOW}-sale threshold — so the sale-date window expanded to 24 months.`,
      `${credibleWithin24} credible sales qualify inside 24 months, at or above the ${MIN_CREDIBLE_FOR_24_MONTH_WINDOW}-sale threshold, so the window stops at 24 months and no supplemental 25-to-30-month record is admitted.`,
      'The 0-to-12-month sales keep materially greater weight than the 13-to-24-month sales.',
    );
  } else {
    selectedMonths = 30;
    explanation.push(
      `Only ${credibleWithin12} credible closed sale${credibleWithin12 === 1 ? '' : 's'} sold within 12 months and only ${credibleWithin24} within 24 months — 2 or fewer survived validation inside 24 months — so the window expanded exceptionally to 30 months.`,
      `${Math.max(0, credibleWithin30 - credibleWithin24)} record${credibleWithin30 - credibleWithin24 === 1 ? '' : 's'} from months 25–30 entered as SUPPLEMENTAL HISTORICAL comps at substantially reduced weight, admitted only because the 24-month set was insufficient. They leave the valuation set automatically once 3 credible sales exist inside 24 months.`,
    );
  }

  const cutoffIso = windowCutoffIso(nowMs, selectedMonths);
  const bucketByKey: Record<string, RecencyBucket> = {};
  let addedFrom13To24 = 0;
  let addedFrom25To30 = 0;
  let movedToHistoricalContext = 0;
  let valuationSetCount = 0;

  for (const c of candidates) {
    if (!c.credible) { bucketByKey[c.key] = 'not_credible'; continue; }
    if (!inAcreageBand(c.acres, band)) { bucketByKey[c.key] = 'out_of_band'; continue; }
    const in12 = withinExactMonths(c.dateIso, nowMs, 12);
    const in24 = withinExactMonths(c.dateIso, nowMs, 24);
    const in30 = withinExactMonths(c.dateIso, nowMs, 30);
    if (selectedMonths === 12) {
      if (in12) { bucketByKey[c.key] = 'primary'; valuationSetCount++; }
      else { bucketByKey[c.key] = 'historical_context'; movedToHistoricalContext++; }
    } else if (selectedMonths === 24) {
      if (in24) {
        bucketByKey[c.key] = 'primary';
        valuationSetCount++;
        if (!in12) addedFrom13To24++;
      } else { bucketByKey[c.key] = 'historical_context'; movedToHistoricalContext++; }
    } else {
      if (in24) {
        bucketByKey[c.key] = 'primary';
        valuationSetCount++;
        if (!in12) addedFrom13To24++;
      } else if (in30) {
        bucketByKey[c.key] = 'supplemental_historical';
        valuationSetCount++;
        addedFrom25To30++;
      } else { bucketByKey[c.key] = 'historical_context'; movedToHistoricalContext++; }
    }
  }

  if (movedToHistoricalContext > 0) {
    explanation.push(
      `${movedToHistoricalContext} credible closed sale${movedToHistoricalContext === 1 ? '' : 's'} sold before ${cutoffIso} carr${movedToHistoricalContext === 1 ? 'ies' : 'y'} zero valuation weight: excluded from the cleaned average, cleaned median, weighted indication, adopted FMV, the 40/50/60 levels, the technical maximum, and the final range.`,
    );
  }
  if (outOfAcreageBand > 0 && band) {
    explanation.push(
      `${outOfAcreageBand} credible closed sale${outOfAcreageBand === 1 ? '' : 's'} fall outside the ${band.label} band and cannot influence the cleaned FMV unless explicitly restored.`,
    );
  }

  return {
    selectedMonths,
    cutoffIso,
    acreageBand: band,
    credibleWithin12,
    credibleWithin24,
    credibleWithin30,
    addedFrom13To24,
    addedFrom25To30,
    movedToHistoricalContext,
    outOfAcreageBand,
    valuationSetCount,
    bucketByKey,
    explanation,
  };
}
