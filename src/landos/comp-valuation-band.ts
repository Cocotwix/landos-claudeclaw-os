// LandOS vacant-land price-per-acre band — pure, deterministic, provider-agnostic.
//
// This is the single chokepoint where sold comps become a valuation band. It runs
// EVERY sold comp (from any provider) through the comp-classification engine and
// builds the per-acre band from RAW LAND only:
//
//   • The band is computed from raw-land comps (vacant_land | farm).
//   • Positively-identified non-land (residential | manufactured | commercial)
//     and nominal transfers (exclude) are NEVER in the band — surfaced with a
//     reason instead. This is the engine-wide fix for residential contamination.
//   • UNKNOWN comps (no negative signal, no positive land proof) are used ONLY as
//     a sparse-market fallback when raw-land comps are thin (< MIN), and the
//     fallback is loudly flagged ("type unverified — verify before pricing").
//
// Outlier-resistant percentiles (p25 / median / p75) protect against the few
// anomalies that survive classification. Nothing is ever fabricated.

import {
  classifyComp,
  type CompClass,
  type CompClassification,
  type CompClassificationInput,
} from './comp-classification.js';

/** A sold comp carrying its price-per-acre plus whatever classification signals
 *  the source provided. Structurally compatible with MarketCompView. */
export type BandComp = CompClassificationInput & {
  price?: number | null;
  pricePerAcre: number | null;
};

/** Minimum positively-classified raw-land comps before we trust the band without
 *  falling back to unknown-type comps. */
export const MIN_RAW_LAND_FOR_BAND = 3;

/** Default acreage band: comps from 0.25x to 4x the subject acreage are
 *  comparable; a 0.1-ac infill lot vs a 5-ac parcel is not (and its per-acre
 *  price is meaningless for the subject). */
export const ACRE_BAND_LOW = 0.25;
export const ACRE_BAND_HIGH = 4;
/** Minimum band comps before the IQR high-outlier trim runs (so a genuinely
 *  small set is never distorted). */
export const MIN_FOR_OUTLIER_TRIM = 4;

export interface BandOptions {
  /** Subject acreage. When > 0, comps outside the acreage band are excluded so a
   *  tiny urban lot's huge per-acre price cannot drive a rural parcel's band. */
  subjectAcres?: number | null;
  acreBandLow?: number;
  acreBandHigh?: number;
  /** Trim extreme high price-per-acre outliers (IQR). Default true. */
  trimHighOutliers?: boolean;
}

export interface BandMetrics {
  soldAvgPrice: number | null;
  soldAvgPpa: number | null;
  soldMedianPpa: number | null;
  ppaMin: number | null; // p25
  ppaMax: number | null; // p75
}

export interface ClassifiedComp<T> {
  comp: T;
  classification: CompClassification;
}

export interface LandBandResult<T> {
  metrics: BandMetrics;
  /** Comps that actually drove the band (raw-land, plus unknowns iff fallback). */
  bandComps: ClassifiedComp<T>[];
  /** Positively-classified raw-land comps (vacant_land | farm). */
  rawLand: ClassifiedComp<T>[];
  /** Non-land + nominal comps kept for transparency, never in the band. */
  excluded: ClassifiedComp<T>[];
  /** Land comps dropped because their acreage is outside the subject's band. */
  excludedAcreage: ClassifiedComp<T>[];
  /** Land comps dropped as extreme high price-per-acre outliers (IQR). */
  excludedOutlier: ClassifiedComp<T>[];
  /** Unknown-type comps (used only when fallback was needed). */
  unknown: ClassifiedComp<T>[];
  /** True when unknown-type comps were folded in due to thin raw-land data. */
  unknownFallbackUsed: boolean;
  /** Per-class counts for the UI / note. */
  counts: Record<CompClass, number>;
  /** Loud, honest one-line summary of what drove the band and what was excluded. */
  note: string;
}

const avg = (ns: number[]): number | null => (ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : null);
const median = (ns: number[]): number | null => {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const percentile = (sorted: number[], q: number): number | null =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;

const ppaOf = <T extends BandComp>(c: ClassifiedComp<T>): number | null => c.comp.pricePerAcre ?? null;
const priceOf = <T extends BandComp>(c: ClassifiedComp<T>): number | null =>
  typeof c.comp.price === 'number' ? c.comp.price : null;

function emptyCounts(): Record<CompClass, number> {
  return { vacant_land: 0, farm: 0, residential: 0, manufactured: 0, commercial: 0, unknown: 0, exclude: 0 };
}

function metricsFrom<T extends BandComp>(comps: ClassifiedComp<T>[]): BandMetrics {
  const ppas = comps.map(ppaOf).filter((p): p is number => typeof p === 'number' && p > 0).sort((a, b) => a - b);
  const prices = comps.map(priceOf).filter((p): p is number => typeof p === 'number' && p > 0);
  return {
    soldAvgPrice: avg(prices),
    soldAvgPpa: avg(ppas),
    soldMedianPpa: median(ppas),
    ppaMin: percentile(ppas, 0.25),
    ppaMax: percentile(ppas, 0.75),
  };
}

/**
 * Build the vacant-land PPA band from a set of sold comps. Pure. The caller maps
 * each comp to the classification signals it has (yearBuilt, propertyTypeCode,
 * useCode, etc.). Residential/manufactured/commercial/nominal sales can never
 * enter the band; unknowns only as a flagged sparse fallback.
 */
export function buildLandPpaBand<T extends BandComp>(
  comps: T[],
  toInput?: (comp: T) => CompClassificationInput,
  options: BandOptions = {},
): LandBandResult<T> {
  const classified: ClassifiedComp<T>[] = comps.map((comp) => ({
    comp,
    classification: classifyComp(toInput ? toInput(comp) : comp),
  }));

  const counts = emptyCounts();
  for (const c of classified) counts[c.classification.class]++;

  const rawLand = classified.filter((c) => c.classification.isRawLand);
  const unknown = classified.filter((c) => c.classification.class === 'unknown');
  const excluded = classified.filter(
    (c) => !c.classification.isRawLand && c.classification.class !== 'unknown',
  );

  // Raw land drives the band. When raw land is too thin, fold in unknown-type
  // comps (no negative signal) so a sparse market still gets a band — flagged.
  let candidate = rawLand;
  let unknownFallbackUsed = false;
  if (rawLand.length < MIN_RAW_LAND_FOR_BAND && unknown.length > 0) {
    candidate = [...rawLand, ...unknown];
    unknownFallbackUsed = true;
  }

  // ── Acreage-band filter: a comp must be within 0.25x–4x the subject acreage.
  //    A 0.1-ac infill lot's per-acre price is meaningless for a 5-ac parcel. ──
  const subjectAcres = typeof options.subjectAcres === 'number' && options.subjectAcres > 0 ? options.subjectAcres : null;
  const lo = subjectAcres ? subjectAcres * (options.acreBandLow ?? ACRE_BAND_LOW) : null;
  const hi = subjectAcres ? subjectAcres * (options.acreBandHigh ?? ACRE_BAND_HIGH) : null;
  const excludedAcreage: ClassifiedComp<T>[] = [];
  if (lo != null && hi != null) {
    const inBand: ClassifiedComp<T>[] = [];
    for (const c of candidate) {
      const a = c.comp.acres ?? null;
      if (a != null && a > 0 && (a < lo || a > hi)) excludedAcreage.push(c);
      else inBand.push(c);
    }
    candidate = inBand;
  }

  // ── IQR high-outlier trim: drop extreme high per-acre sales that survive
  //    classification (tiny lots, anomalies) so they don't inflate the band. ──
  const excludedOutlier: ClassifiedComp<T>[] = [];
  if ((options.trimHighOutliers ?? true) && candidate.length >= MIN_FOR_OUTLIER_TRIM) {
    const ppas = candidate.map(ppaOf).filter((p): p is number => typeof p === 'number' && p > 0).sort((a, b) => a - b);
    if (ppas.length >= MIN_FOR_OUTLIER_TRIM) {
      const p75 = percentile(ppas, 0.75) ?? 0;
      const p25 = percentile(ppas, 0.25) ?? 0;
      const hiCut = p75 + 1.5 * (p75 - p25);
      if (hiCut > 0) {
        const kept: ClassifiedComp<T>[] = [];
        for (const c of candidate) {
          if ((ppaOf(c) ?? 0) > hiCut) excludedOutlier.push(c);
          else kept.push(c);
        }
        candidate = kept;
      }
    }
  }

  const bandComps = candidate;
  const metrics = metricsFrom(bandComps);

  const parts: string[] = [];
  parts.push(
    bandComps.length > 0
      ? `Land band from ${bandComps.length} comp(s)${unknownFallbackUsed ? ' (incl. unverified-type)' : ''}.`
      : 'No raw-land sold comps to price a band (none invented).',
  );
  const nonLand = counts.residential + counts.manufactured + counts.commercial + counts.exclude;
  if (nonLand > 0) {
    const bits = [
      counts.residential ? `${counts.residential} residential` : '',
      counts.manufactured ? `${counts.manufactured} manufactured` : '',
      counts.commercial ? `${counts.commercial} commercial` : '',
      counts.exclude ? `${counts.exclude} nominal/non-market` : '',
    ].filter(Boolean);
    parts.push(`Excluded as non-land: ${bits.join(', ')}.`);
  }
  if (excludedAcreage.length > 0) parts.push(`${excludedAcreage.length} comp(s) outside the subject acreage band (${(options.acreBandLow ?? ACRE_BAND_LOW)}x–${(options.acreBandHigh ?? ACRE_BAND_HIGH)}x).`);
  if (excludedOutlier.length > 0) parts.push(`${excludedOutlier.length} extreme price-per-acre outlier(s) trimmed (IQR).`);
  if (unknownFallbackUsed) parts.push('Thin raw-land data: unverified-type comps folded in — verify type before pricing.');

  return { metrics, bandComps, rawLand, excluded, excludedAcreage, excludedOutlier, unknown, unknownFallbackUsed, counts, note: parts.join(' ') };
}
