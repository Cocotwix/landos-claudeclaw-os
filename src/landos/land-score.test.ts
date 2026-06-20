import { describe, it, expect } from 'vitest';
import { computeLandScore } from './land-score.js';
import type { DukeLandFacts, DukeValuation, DukeSimilars } from './duke-property-data.js';

const fullFacts: DukeLandFacts = {
  acres: 12, roadFrontageFt: 250, landLocked: 'false', wetlandsPct: 2, femaPct: 1, buildabilityPct: 90, slopeAvgDeg: 3,
};
const fullVal: DukeValuation = { tlpEstimate: 80_000, priceAcreCounty: 6_000, tlpPpa: 6_500 };
const fullSim: DukeSimilars = { count: 5, mostRecentYear: '2025' };

describe('computeLandScore', () => {
  it('scores a strong parcel high with full confidence', () => {
    const r = computeLandScore({ landFacts: fullFacts, valuation: fullVal, similars: fullSim });
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.verdict).toBe('PURSUE');
    expect(r.confidence).toBe('full');
    expect(r.dataGaps).toHaveLength(0);
    expect(r.factors).toHaveLength(6);
  });

  it('FAILS LOUD on a missing field — scores 0 and flags, never inferred', () => {
    const facts = { ...fullFacts };
    delete facts.wetlandsPct;
    const r = computeLandScore({ landFacts: facts, valuation: fullVal, similars: fullSim });
    expect(r.dataGaps).toContain('wetlands');
    const wet = r.factors.find((f) => f.id === 'wetlands')!;
    expect(wet.points).toBe(0);
    expect(wet.dataGap).toBe(true);
    expect(r.flags.join(' ')).toMatch(/never inferred/i);
    expect(r.confidence).not.toBe('full');
  });

  it('landlocked access scores 0 for the access factor and flags loudly', () => {
    const r = computeLandScore({ landFacts: { ...fullFacts, landLocked: 'true' }, valuation: fullVal, similars: fullSim });
    const access = r.factors.find((f) => f.id === 'access')!;
    expect(access.points).toBe(0);
    expect(access.lowestTier).toBe(true);
  });

  it('no LP valuation and no comps is the maximum valuation-confidence deduction', () => {
    const r = computeLandScore({ landFacts: fullFacts, valuation: {}, similars: { count: 0 } });
    const v = r.factors.find((f) => f.id === 'valuation_confidence')!;
    expect(v.points).toBe(0);
  });

  it('75%+ wetlands zeroes the wetlands factor', () => {
    const r = computeLandScore({ landFacts: { ...fullFacts, wetlandsPct: 80 }, valuation: fullVal, similars: fullSim });
    expect(r.factors.find((f) => f.id === 'wetlands')!.points).toBe(0);
  });

  it('two or more lowest-tier factors downgrade the verdict', () => {
    // landlocked (access=0, lowest) + 80% FEMA (lowest) => downgrade applies
    const r = computeLandScore({
      landFacts: { ...fullFacts, landLocked: 'true', femaPct: 80 },
      valuation: fullVal,
      similars: fullSim,
    });
    const lowest = r.factors.filter((f) => f.lowestTier).length;
    expect(lowest).toBeGreaterThanOrEqual(2);
  });
});
