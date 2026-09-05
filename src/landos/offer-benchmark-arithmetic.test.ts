// The displayed offer benchmarks must BE the percentages they are labelled as.
//
// They were rounded to the nearest $500, so at a $56,000 Combined LandOS FMV the
// operator read "40%" beside $22,500 when 40% is $22,400, and "60%" beside
// $33,500 when 60% is $33,600. A number labelled as a percentage of the
// governing value has to equal that percentage.

import { describe, expect, it } from 'vitest';

import { computeValuationPackage } from './comps-valuation-package.js';

function packageFor(landPortal: number | null, nonLandPortalSales: Array<{ price: number; acres: number }>) {
  return computeValuationPackage({
    subjectAcres: 1.5,
    landPortalEstimate: landPortal == null ? null : { price: landPortal, perAcre: landPortal / 1.5, source: 'LandPortal parcel panel' },
    comps: [],
    nonLandPortalCleaned: {
      adoptedFmv: nonLandPortalSales.length
        ? Math.round(nonLandPortalSales.reduce((sum, s) => sum + s.price / s.acres, 0) / nonLandPortalSales.length * 1.5)
        : null,
      confidence: 'moderate',
    } as never,
    allLanesCleaned: { adoptedFmv: null, confidence: 'unavailable' } as never,
    marketFallback: null,
    askingPrice: null,
    subjectImproved: false,
    producedAt: '2026-09-04T00:00:00.000Z',
  } as never);
}

describe('40% and 60% are exact percentages of the displayed Combined FMV', () => {
  it('states 40% and 60% of the governing value, not a rounded approximation', () => {
    const pkg = packageFor(35_903, [{ price: 76_500, acres: 1.5 }]);
    const fmv = pkg.combinedFmv.value!;
    expect(pkg.offer40).toBe(Math.round(fmv * 0.4));
    expect(pkg.offer60).toBe(Math.round(fmv * 0.6));
  });

  it('never rounds a stated percentage to the nearest $500', () => {
    // $56,000 is the case that exposed it: 40% is $22,400 and 60% is $33,600,
    // both of which a $500 rounding would move.
    const pkg = packageFor(35_903, [{ price: 76_500, acres: 1.5 }]);
    if (pkg.combinedFmv.value === 56_000) {
      expect(pkg.offer40).toBe(22_400);
      expect(pkg.offer60).toBe(33_600);
    }
    // Whatever the FMV, the benchmarks are exact.
    const fmv = pkg.combinedFmv.value!;
    expect(pkg.offer40! % 500 === 0 && pkg.offer60! % 500 === 0 && fmv % 1250 !== 0).toBe(false);
  });

  it('exposes no 50% value at all', () => {
    const pkg = packageFor(35_903, [{ price: 76_500, acres: 1.5 }]);
    expect(Object.prototype.hasOwnProperty.call(pkg, 'offer50')).toBe(false);
    expect(JSON.stringify(pkg)).not.toMatch(/offer50|"pct50"/);
  });

  it('leaves both benchmarks null when no value is supported', () => {
    const pkg = packageFor(null, []);
    expect(pkg.combinedFmv.value).toBeNull();
    expect(pkg.offer40).toBeNull();
    expect(pkg.offer60).toBeNull();
  });
});
