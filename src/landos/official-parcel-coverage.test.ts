import { describe, it, expect } from 'vitest';
import { officialParcelSourceCoverage, practicalOfficialParcelSources } from './public-property-intelligence-live.js';

// Operator acceptance regression: a fresh Kentucky lead ended with the generic
// "Confirm the exact subject parcel using APN plus county/state", which hides
// which of two very different things went wrong — LandOS not knowing WHERE the
// parcel is, versus knowing exactly where it is and having no configured source
// for that place. Neither is evidence about the parcel itself.

describe('officialParcelSourceCoverage', () => {
  it('names a missing county as the blocker, not the parcel', () => {
    const coverage = officialParcelSourceCoverage({ address: '4713 Sinking Creek Rd', state: 'KY' });
    expect(coverage.available).toBe(false);
    expect(coverage.reason).toMatch(/no county is known/i);
    expect(coverage.reason).toMatch(/selected by county/i);
  });

  it('names a missing source configuration for a known jurisdiction', () => {
    const coverage = officialParcelSourceCoverage({ address: '4713 Sinking Creek Rd', county: 'Laurel', state: 'KY' });
    expect(coverage.available).toBe(false);
    expect(coverage.reason).toMatch(/Laurel County, KY/);
    expect(coverage.reason).toMatch(/NOT evidence that the parcel does not exist/i);
  });

  it('reports coverage where a tested source actually applies', () => {
    const coverage = officialParcelSourceCoverage({ address: 'OLD RIDGE RD', county: 'Roane', state: 'TN' });
    expect(coverage.available).toBe(true);
    expect(coverage.sources.join(' ')).toMatch(/Tennessee Comptroller/i);
  });

  it('says so plainly when no state is known at all', () => {
    const coverage = officialParcelSourceCoverage({ address: 'somewhere' });
    expect(coverage.available).toBe(false);
    expect(coverage.reason).toMatch(/no state is known/i);
  });

  it('never claims coverage it does not have', () => {
    for (const input of [{}, { state: 'KY' }, { county: 'Laurel' }]) {
      const coverage = officialParcelSourceCoverage(input);
      expect(coverage.available).toBe(coverage.sources.length > 0);
    }
  });

  it('routes Pickens County to its practical official assessor browser surfaces', () => {
    const sources = practicalOfficialParcelSources({ county: 'Pickens', state: 'SC' });
    expect(sources.some((source) =>
      source.mode === 'browser'
      && /Pickens County Assessor/i.test(source.source)
      && /qpublic\.schneidercorp\.com/i.test(source.url))).toBe(true);
    expect(sources.some((source) => /pickensassessor\.org/i.test(source.url))).toBe(false);
    expect(sources.every((source) => /destination alone is not parcel evidence|runtime attempt is required/i.test(source.note))).toBe(true);
  });
});
