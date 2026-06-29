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
  let bandComps = rawLand;
  let unknownFallbackUsed = false;
  if (rawLand.length < MIN_RAW_LAND_FOR_BAND && unknown.length > 0) {
    bandComps = [...rawLand, ...unknown];
    unknownFallbackUsed = true;
  }

  const metrics = metricsFrom(bandComps);

  const parts: string[] = [];
  parts.push(
    bandComps.length > 0
      ? `Land band from ${rawLand.length} raw-land${unknownFallbackUsed ? ` + ${unknown.length} unverified-type` : ''} sold comp(s).`
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
    parts.push(`Excluded from the band: ${bits.join(', ')} (kept for transparency, never priced as land).`);
  }
  if (unknownFallbackUsed) parts.push('Thin raw-land data: unverified-type comps folded in — verify type before pricing.');

  return { metrics, bandComps, rawLand, excluded, unknown, unknownFallbackUsed, counts, note: parts.join(' ') };
}
