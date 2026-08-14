// Acreage band + sale-recency window selection.
//
// Contract: LandOS prefers the most recent sufficiently supported comparable
// set and stops expanding the moment one exists. It never pads the sample with
// older sales, never smooths the range with them, and never lets a sale outside
// the subject's acreage band or older than the selected window influence value.
// Dates are compared against exact calendar anniversaries, not rounded labels.

import { describe, expect, it } from 'vitest';

import {
  selectRecencyWindow,
  valuationAcreageBand,
  inAcreageBand,
  acreageSimilarity,
  withinExactMonths,
  windowCutoffIso,
  exactMonthsOld,
  normalizeSaleDateIso,
  subtractMonthsUtc,
  MIN_CREDIBLE_FOR_12_MONTH_WINDOW,
  MIN_CREDIBLE_FOR_24_MONTH_WINDOW,
  type RecencyCandidate,
} from './comp-recency-window.js';

const NOW = Date.parse('2026-08-06T12:00:00Z');
const SUBJECT_ACRES = 11.46; // 1487 Onionville Rd working acreage

/** Build a candidate that is credible unless told otherwise. */
const sale = (key: string, dateIso: string | null, acres: number | null, credible = true): RecencyCandidate =>
  ({ key, dateIso, acres, credible });

/** N credible in-band sales spread across a month offset from today. */
function salesAtMonths(months: number[], acres = 11): RecencyCandidate[] {
  return months.map((m, i) => {
    const d = subtractMonthsUtc(new Date(NOW), m);
    d.setUTCDate(d.getUTCDate() + 2); // safely inside the month boundary
    return sale(`s${m}-${i}`, d.toISOString().slice(0, 10), acres);
  });
}

describe('valuation acreage band', () => {
  it('delegates the 11.46-acre subject to the shared mid-acreage route', () => {
    const band = valuationAcreageBand(SUBJECT_ACRES)!;
    expect(band.min).toBe(5.73);
    expect(band.max).toBe(22.92);
    expect(band.label).toBe('5.73–22.92 acres');
  });

  it('admits sales at the band edges and rejects sales outside it', () => {
    const band = valuationAcreageBand(SUBJECT_ACRES);
    expect(inAcreageBand(5.73, band)).toBe(true);
    expect(inAcreageBand(22.92, band)).toBe(true);
    expect(inAcreageBand(11.46, band)).toBe(true);
    expect(inAcreageBand(5.72, band)).toBe(false);
    expect(inAcreageBand(22.93, band)).toBe(false);
    expect(inAcreageBand(null, band)).toBe(false);
  });

  it('weights acreage similarity continuously, peaking at the subject acreage', () => {
    const band = valuationAcreageBand(SUBJECT_ACRES);
    const atSubject = acreageSimilarity(11.46, SUBJECT_ACRES, band);
    const near = acreageSimilarity(11, SUBJECT_ACRES, band);
    const low = acreageSimilarity(6, SUBJECT_ACRES, band);
    const high = acreageSimilarity(20, SUBJECT_ACRES, band);
    expect(atSubject).toBe(1);
    // A sale near 11.46 acres outweighs a 5-acre or a 20-acre sale.
    expect(near).toBeGreaterThan(low);
    expect(near).toBeGreaterThan(high);
    expect(low).toBeGreaterThan(0);
    // Outside the band the similarity is zero, never a small positive nudge.
    expect(acreageSimilarity(23, SUBJECT_ACRES, band)).toBe(0);
  });

  it('uses the shared regime route instead of local class assumptions', () => {
    expect(valuationAcreageBand(1)).toMatchObject({ min: 0.6, max: 1.75 });
    expect(valuationAcreageBand(3)).toMatchObject({ min: 1.5, max: 6 });
    expect(valuationAcreageBand(40)).toMatchObject({ min: 14, max: 100 });
    expect(valuationAcreageBand(null)).toBeNull();
    expect(valuationAcreageBand(0)).toBeNull();
  });
});

describe('exact sale-date handling', () => {
  it('keeps a sale eligible through its exact anniversary and drops it the next day', () => {
    const cutoff24 = windowCutoffIso(NOW, 24);
    expect(cutoff24).toBe('2024-08-06');
    // On the exact anniversary: still inside the window.
    expect(withinExactMonths('2024-08-06', NOW, 24)).toBe(true);
    // One day older: outside, immediately.
    expect(withinExactMonths('2024-08-05', NOW, 24)).toBe(false);
  });

  it('uses the real date rather than a rounded "24 months ago" label', () => {
    // 2024-08-05 rounds to "24 months ago" on a 30.44-day approximation but is
    // genuinely older than the exact 24-month anniversary.
    expect(exactMonthsOld('2024-08-05', NOW)).toBe(24);
    expect(withinExactMonths('2024-08-05', NOW, 24)).toBe(false);
  });

  it('never date-qualifies an undated or malformed sale', () => {
    expect(withinExactMonths(null, NOW, 12)).toBe(false);
    expect(withinExactMonths('', NOW, 12)).toBe(false);
    expect(withinExactMonths('not-a-date', NOW, 12)).toBe(false);
    expect(exactMonthsOld(null, NOW)).toBeNull();
  });

  it('clamps month subtraction to the end of a short month', () => {
    const from = new Date(Date.UTC(2026, 2, 31)); // 31 March
    expect(subtractMonthsUtc(from, 1).toISOString().slice(0, 10)).toBe('2026-02-28');
  });
});

describe('step 1 — the 12-month window', () => {
  it('uses the 12-month set outright once five credible sales qualify', () => {
    const result = selectRecencyWindow(salesAtMonths([1, 3, 5, 8, 11]), SUBJECT_ACRES, NOW);
    expect(result.selectedMonths).toBe(12);
    expect(result.credibleWithin12).toBe(MIN_CREDIBLE_FOR_12_MONTH_WINDOW);
    expect(result.valuationSetCount).toBe(5);
    expect(result.addedFrom13To24).toBe(0);
    expect(result.addedFrom25To30).toBe(0);
  });

  it('refuses to add 13-to-24-month sales to enlarge a sufficient 12-month set', () => {
    const candidates = [...salesAtMonths([1, 3, 5, 8, 11]), ...salesAtMonths([14, 20, 23])];
    const result = selectRecencyWindow(candidates, SUBJECT_ACRES, NOW);
    expect(result.selectedMonths).toBe(12);
    expect(result.credibleWithin24).toBe(8);
    // The extra three are visible history, never valuation evidence.
    expect(result.valuationSetCount).toBe(5);
    expect(result.movedToHistoricalContext).toBe(3);
    expect(result.explanation.join(' ')).toContain('NOT added to enlarge the sample');
  });

  it('gives every out-of-window sale zero valuation weight, including 30-plus-month sales', () => {
    const candidates = [...salesAtMonths([1, 2, 4, 6, 9]), ...salesAtMonths([31, 40, 55])];
    const result = selectRecencyWindow(candidates, SUBJECT_ACRES, NOW);
    expect(result.selectedMonths).toBe(12);
    for (const c of candidates.slice(5)) {
      expect(result.bucketByKey[c.key]).toBe('historical_context');
    }
    expect(result.explanation.join(' ')).toContain('zero valuation weight');
  });
});

describe('step 2 — expansion to 24 months', () => {
  it('expands only when fewer than five credible sales sold within 12 months', () => {
    const candidates = [...salesAtMonths([2, 7, 10]), ...salesAtMonths([15, 19, 22])];
    const result = selectRecencyWindow(candidates, SUBJECT_ACRES, NOW);
    expect(result.credibleWithin12).toBe(3);
    expect(result.selectedMonths).toBe(24);
    expect(result.addedFrom13To24).toBe(3);
    expect(result.valuationSetCount).toBe(6);
  });

  it('stops at 24 months whenever three or more credible sales qualify there', () => {
    const candidates = [...salesAtMonths([4]), ...salesAtMonths([16, 21]), ...salesAtMonths([27, 29])];
    const result = selectRecencyWindow(candidates, SUBJECT_ACRES, NOW);
    expect(result.credibleWithin24).toBe(3);
    expect(result.credibleWithin24).toBeGreaterThanOrEqual(MIN_CREDIBLE_FOR_24_MONTH_WINDOW);
    expect(result.selectedMonths).toBe(24);
    // No 25-to-30-month record may be admitted while 24 months is sufficient.
    expect(result.addedFrom25To30).toBe(0);
    expect(result.explanation.join(' ')).toContain('no supplemental 25-to-30-month record is admitted');
  });
});

describe('step 3 — the exceptional 30-month expansion', () => {
  it('expands to 30 months only when two or fewer credible sales survive inside 24 months', () => {
    const candidates = [...salesAtMonths([5]), ...salesAtMonths([18]), ...salesAtMonths([26, 29])];
    const result = selectRecencyWindow(candidates, SUBJECT_ACRES, NOW);
    expect(result.credibleWithin24).toBe(2);
    expect(result.selectedMonths).toBe(30);
    expect(result.addedFrom25To30).toBe(2);
    expect(result.valuationSetCount).toBe(4);
  });

  it('labels months 25-30 as supplemental historical, admitted because 24 months was thin', () => {
    const candidates = [...salesAtMonths([5]), ...salesAtMonths([26])];
    const result = selectRecencyWindow(candidates, SUBJECT_ACRES, NOW);
    expect(result.selectedMonths).toBe(30);
    expect(result.bucketByKey[candidates[1].key]).toBe('supplemental_historical');
    expect(result.explanation.join(' ')).toContain('SUPPLEMENTAL HISTORICAL');
    expect(result.explanation.join(' ')).toContain('only because the 24-month set was insufficient');
  });

  it('drops the supplemental records automatically once three credible 24-month sales exist', () => {
    const thin = [...salesAtMonths([5]), ...salesAtMonths([18]), ...salesAtMonths([26])];
    expect(selectRecencyWindow(thin, SUBJECT_ACRES, NOW).selectedMonths).toBe(30);
    // A third credible 24-month sale appears: the 30-month step is withdrawn.
    const recovered = [...thin, ...salesAtMonths([21])];
    const result = selectRecencyWindow(recovered, SUBJECT_ACRES, NOW);
    expect(result.selectedMonths).toBe(24);
    expect(result.addedFrom25To30).toBe(0);
    expect(result.bucketByKey[thin[2].key]).toBe('historical_context');
  });

  it('never reaches past 30 months however thin the evidence is', () => {
    const result = selectRecencyWindow(salesAtMonths([35, 48]), SUBJECT_ACRES, NOW);
    expect(result.selectedMonths).toBe(30);
    expect(result.valuationSetCount).toBe(0);
    expect(result.movedToHistoricalContext).toBe(2);
  });
});

describe('the acreage band gates independently of the window', () => {
  it('keeps a recent out-of-band sale out of the valuation set', () => {
    const inBand = salesAtMonths([1, 3, 5, 8, 11]);
    const tooBig = sale('big', '2026-07-01', 45);
    const tooSmall = sale('small', '2026-07-01', 2);
    const result = selectRecencyWindow([...inBand, tooBig, tooSmall], SUBJECT_ACRES, NOW);
    expect(result.outOfAcreageBand).toBe(2);
    expect(result.bucketByKey.big).toBe('out_of_band');
    expect(result.bucketByKey.small).toBe('out_of_band');
    expect(result.valuationSetCount).toBe(5);
    expect(result.explanation.join(' ')).toContain('cannot influence the cleaned FMV unless explicitly restored');
  });

  it('does not count an out-of-band sale toward any window threshold', () => {
    // Five recent sales, but four of them are outside the band: the 12-month
    // threshold is not met and the window must expand.
    const candidates = [
      sale('a', '2026-07-01', 11),
      sale('b', '2026-06-01', 40),
      sale('c', '2026-05-01', 41),
      sale('d', '2026-04-01', 42),
      sale('e', '2026-03-01', 43),
      ...salesAtMonths([15, 18, 21]),
    ];
    const result = selectRecencyWindow(candidates, SUBJECT_ACRES, NOW);
    expect(result.credibleWithin12).toBe(1);
    expect(result.selectedMonths).toBe(24);
  });

  it('never gates on acreage when the subject acreage is unknown', () => {
    const result = selectRecencyWindow(salesAtMonths([1, 3, 5, 8, 11], 40), null, NOW);
    expect(result.acreageBand).toBeNull();
    expect(result.outOfAcreageBand).toBe(0);
    expect(result.valuationSetCount).toBe(5);
  });
});

describe('records that failed validation never reach the window', () => {
  it('keeps a non-credible record out of every count and bucket', () => {
    const candidates = [...salesAtMonths([1, 3, 5, 8]), sale('bad', '2026-07-01', 11, false)];
    const result = selectRecencyWindow(candidates, SUBJECT_ACRES, NOW);
    expect(result.bucketByKey.bad).toBe('not_credible');
    expect(result.credibleWithin12).toBe(4);
    // Four credible sales is below the threshold, so the window expands.
    expect(result.selectedMonths).not.toBe(12);
  });
});

// The recency gate used to accept the ISO shape ALONE. Every other form was
// treated as undated, which is indistinguishable from "sold before the cutoff":
// on 5170 Hwy 60 two closed sales dated 06-16-2025 and 06-04-2026 — 13 and 2
// months old — were pushed to historical context at zero valuation weight
// against a 24-month cutoff of 2024-08-14, because "06-16-2025" compares below
// "2024-08-14" as a STRING while the age path read the same value correctly.
describe('provider sale dates are normalized before any cutoff comparison', () => {
  it('reads month-first provider dates as the same day as their ISO form', () => {
    expect(normalizeSaleDateIso('06-16-2025')).toBe('2025-06-16');
    expect(normalizeSaleDateIso('6/4/2026')).toBe('2026-06-04');
    expect(normalizeSaleDateIso('2024-06-14')).toBe('2024-06-14');
    expect(normalizeSaleDateIso('2025-4-9')).toBe('2025-04-09');
    expect(normalizeSaleDateIso('2025-12-09T00:00:00Z')).toBe('2025-12-09');
  });

  it('reads a leading component that cannot be a month as the day', () => {
    expect(normalizeSaleDateIso('16-06-2025')).toBe('2025-06-16');
  });

  it('stays undated rather than inventing a date it cannot read', () => {
    for (const value of [null, '', 'unknown', 'June 2025', '13-13-2025', '2025-02-30', '06-16-25']) {
      expect(normalizeSaleDateIso(value)).toBeNull();
    }
  });

  it('keeps a month-first sale inside the window its own age puts it in', () => {
    // 2026-06-04 is 2 months before NOW; 2025-06-16 is 13 months before it.
    expect(withinExactMonths('06-04-2026', NOW, 12)).toBe(true);
    expect(withinExactMonths('06-16-2025', NOW, 24)).toBe(true);
    expect(withinExactMonths('06-16-2025', NOW, 12)).toBe(false);
    expect(exactMonthsOld('06-04-2026', NOW)).toBe(2);
    expect(exactMonthsOld('06-16-2025', NOW)).toBe(13);
  });

  it('does not push a recent month-first sale into historical context', () => {
    const candidates = [
      sale('iso-1', '2026-07-01', 11),
      sale('iso-2', '2026-05-02', 11),
      sale('us-recent', '06-04-2026', 11),
      sale('us-13mo', '06-16-2025', 11),
      sale('genuinely-old', '2024-06-14', 11),
    ];
    const result = selectRecencyWindow(candidates, SUBJECT_ACRES, NOW);
    expect(result.bucketByKey['us-recent']).toBe('primary');
    expect(result.bucketByKey['us-13mo']).toBe('primary');
    // A sale that really is older than the window still loses its weight.
    expect(result.bucketByKey['genuinely-old']).toBe('historical_context');
    expect(result.movedToHistoricalContext).toBe(1);
  });
});
