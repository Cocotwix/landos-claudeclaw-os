import { describe, it, expect } from 'vitest';
import { buildLandPpaBand, MIN_RAW_LAND_FOR_BAND, type BandComp } from './comp-valuation-band.js';

const land = (ppa: number, price = ppa * 5): BandComp => ({ pricePerAcre: ppa, price, redfinPropertyTypeCode: 8 });
const house = (ppa: number, price = ppa * 5): BandComp => ({ pricePerAcre: ppa, price, yearBuilt: 2000 });
const unknown = (ppa: number, price = ppa * 5): BandComp => ({ pricePerAcre: ppa, price });

describe('buildLandPpaBand — residential contamination guard (engine-wide)', () => {
  it('a residential sale never enters the band even when its PPA is huge', () => {
    const comps = [land(5000), land(6000), land(7000), house(400000)];
    const r = buildLandPpaBand(comps);
    expect(r.rawLand).toHaveLength(3);
    expect(r.excluded.map((e) => e.classification.class)).toContain('residential');
    expect(r.metrics.ppaMax).toBe(7000); // the $400k/ac house is gone
    expect(r.metrics.soldMedianPpa).toBe(6000);
    expect(r.unknownFallbackUsed).toBe(false);
  });

  it('the 2123 Panola failure mode: improved house sales cannot inflate the band', () => {
    // 3 land comps ~ $4-6k/ac; 3 houses on small lots at $200k+/ac.
    const comps = [land(4000), land(5000), land(6000), house(250000), house(300000), house(220000)];
    const r = buildLandPpaBand(comps);
    expect(r.metrics.ppaMax).toBeLessThanOrEqual(6000);
    expect(r.counts.residential).toBe(3);
    expect(r.counts.vacant_land).toBe(3);
  });
});

describe('buildLandPpaBand — sparse-market unknown fallback', () => {
  it('uses unknown-type comps when raw land is below the minimum, and flags it', () => {
    const comps = [land(5000), unknown(5500), unknown(6000)]; // only 1 raw land
    expect(MIN_RAW_LAND_FOR_BAND).toBe(3);
    const r = buildLandPpaBand(comps);
    expect(r.unknownFallbackUsed).toBe(true);
    expect(r.bandComps).toHaveLength(3);
    expect(r.note).toMatch(/verify type before pricing/i);
  });

  it('does NOT fall back to unknown when raw land meets the minimum', () => {
    const comps = [land(5000), land(5500), land(6000), unknown(99999)];
    const r = buildLandPpaBand(comps);
    expect(r.unknownFallbackUsed).toBe(false);
    expect(r.bandComps).toHaveLength(3);
    expect(r.metrics.ppaMax).toBe(6000); // the unknown $99,999/ac never enters
  });

  it('still never folds in residential during the fallback', () => {
    const comps = [land(5000), unknown(5500), house(500000)];
    const r = buildLandPpaBand(comps);
    expect(r.unknownFallbackUsed).toBe(true);
    expect(r.bandComps.every((c) => c.classification.class !== 'residential')).toBe(true);
  });
});

describe('buildLandPpaBand — empty + all-excluded', () => {
  it('produces a null band and an honest note when nothing is raw land', () => {
    const r = buildLandPpaBand([house(200000), house(250000)]);
    expect(r.metrics.soldMedianPpa).toBeNull();
    expect(r.bandComps).toHaveLength(0);
    expect(r.note).toMatch(/no raw-land sold comps/i);
  });

  it('handles an empty comp set', () => {
    const r = buildLandPpaBand([]);
    expect(r.metrics).toEqual({ soldAvgPrice: null, soldAvgPpa: null, soldMedianPpa: null, ppaMin: null, ppaMax: null });
  });
});

describe('buildLandPpaBand — counts + percentiles', () => {
  it('reports per-class counts', () => {
    const comps = [land(5000), { pricePerAcre: 4000, propertyTypeText: 'farm' } as BandComp, house(300000)];
    const r = buildLandPpaBand(comps);
    expect(r.counts.vacant_land).toBe(1);
    expect(r.counts.farm).toBe(1);
    expect(r.counts.residential).toBe(1);
    expect(r.rawLand).toHaveLength(2); // farm + vacant_land
  });
});
