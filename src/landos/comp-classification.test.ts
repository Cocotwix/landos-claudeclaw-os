import { describe, it, expect } from 'vitest';
import {
  classifyComp,
  splitCompsByClass,
  isRawLandClass,
  NOMINAL_SALE_FLOOR_USD,
  type CompClassificationInput,
} from './comp-classification.js';

describe('classifyComp — improved-structure detection (the contamination guard)', () => {
  it('treats a parcel with a year built as residential, not raw land', () => {
    const c = classifyComp({ yearBuilt: 1998, acres: 1 });
    expect(c.class).toBe('residential');
    expect(c.isRawLand).toBe(false);
    expect(c.confidence).toBe('high');
    expect(c.signals.join(' ')).toContain('yearBuilt 1998');
  });

  it('treats a parcel with building area as residential', () => {
    const c = classifyComp({ buildingAreaSqft: 1800 });
    expect(c.class).toBe('residential');
    expect(c.isRawLand).toBe(false);
  });

  it('sub-types an improved parcel as manufactured when the text says so', () => {
    const c = classifyComp({ yearBuilt: 2005, descriptionText: 'Charming double wide mobile home on the lot' });
    expect(c.class).toBe('manufactured');
    expect(c.isRawLand).toBe(false);
  });

  it('sub-types an improved parcel as commercial when the use code says so', () => {
    const c = classifyComp({ buildingAreaSqft: 9000, useCode: 'Commercial - Warehouse' });
    expect(c.class).toBe('commercial');
    expect(c.isRawLand).toBe(false);
  });

  it('does NOT treat yearBuilt 0 / pre-1900 noise as improved', () => {
    expect(classifyComp({ yearBuilt: 0, redfinPropertyTypeCode: 8 }).class).toBe('vacant_land');
    expect(classifyComp({ yearBuilt: 1850 }).class).toBe('unknown');
  });
});

describe('classifyComp — provider type codes and type text', () => {
  it('classifies Redfin propertyType 8 as vacant land (raw land)', () => {
    const c = classifyComp({ redfinPropertyTypeCode: 8 });
    expect(c.class).toBe('vacant_land');
    expect(c.isRawLand).toBe(true);
    expect(c.confidence).toBe('high');
  });

  it('classifies Redfin propertyType 6 as residential (excluded)', () => {
    const c = classifyComp({ redfinPropertyTypeCode: 6 });
    expect(c.class).toBe('residential');
    expect(c.isRawLand).toBe(false);
  });

  it('does not guess from an unknown Redfin code', () => {
    const c = classifyComp({ redfinPropertyTypeCode: 99 });
    expect(c.class).toBe('unknown');
  });

  it('classifies HomeHarvest property_type "land" as vacant land', () => {
    expect(classifyComp({ propertyTypeText: 'land' }).class).toBe('vacant_land');
  });

  it('classifies HomeHarvest property_type "farm" as farm (raw land)', () => {
    const c = classifyComp({ propertyTypeText: 'farm' });
    expect(c.class).toBe('farm');
    expect(c.isRawLand).toBe(true);
  });

  it('classifies HomeHarvest "single_family" as residential', () => {
    expect(classifyComp({ propertyTypeText: 'single_family' }).class).toBe('residential');
  });
});

describe('classifyComp — use code and description fallbacks', () => {
  it('classifies a Realie "Vacant" use code as vacant land (medium confidence)', () => {
    const c = classifyComp({ useCode: 'Vacant Residential Land' });
    expect(c.class).toBe('vacant_land');
    expect(c.confidence).toBe('medium');
  });

  it('classifies an agricultural use code as farm', () => {
    expect(classifyComp({ useCode: 'Agricultural - Cropland' }).class).toBe('farm');
  });

  it('falls back to description keywords at low confidence', () => {
    const c = classifyComp({ descriptionText: 'Beautiful buildable lot, raw land, cleared and ready' });
    expect(c.class).toBe('vacant_land');
    expect(c.confidence).toBe('low');
  });

  it('manufactured keyword in description beats generic residential', () => {
    expect(classifyComp({ descriptionText: 'mobile home with 3 bedroom 2 bathroom' }).class).toBe('manufactured');
  });
});

describe('classifyComp — exclude and unknown', () => {
  it('excludes a nominal / non-market transfer', () => {
    const c = classifyComp({ soldPrice: NOMINAL_SALE_FLOOR_USD - 1 });
    expect(c.class).toBe('exclude');
    expect(c.isRawLand).toBe(false);
  });

  it('returns unknown (not raw land) when there is no reliable signal', () => {
    const c = classifyComp({ soldPrice: 50000, acres: 5 });
    expect(c.class).toBe('unknown');
    expect(c.isRawLand).toBe(false);
    expect(c.confidence).toBe('low');
  });
});

describe('splitCompsByClass — the valuation seam', () => {
  interface Row { id: number; year?: number | null; code?: number | null; price?: number }
  const toInput = (r: Row): CompClassificationInput => ({ yearBuilt: r.year ?? null, redfinPropertyTypeCode: r.code ?? null, soldPrice: r.price });

  it('keeps only raw-land comps in the valuation set, excludes the rest with reasons', () => {
    const rows: Row[] = [
      { id: 1, code: 8 },            // vacant land -> raw land
      { id: 2, year: 2001 },         // residential -> excluded
      { id: 3, code: 8, year: 2010 },// improved beats code -> residential excluded
      { id: 4, code: 99 },           // unknown -> excluded (conservative)
    ];
    const { rawLand, excluded } = splitCompsByClass(rows, toInput);
    expect(rawLand.map((r) => r.comp.id)).toEqual([1]);
    expect(excluded.map((r) => r.comp.id).sort()).toEqual([2, 3, 4]);
    for (const e of excluded) expect(e.classification.reason.length).toBeGreaterThan(0);
  });

  it('a residential sale can never enter the raw-land set (the 2123 Panola failure mode)', () => {
    const rows: Row[] = [
      { id: 1, code: 8 },
      { id: 2, year: 1999, price: 450000 }, // a $450k house — must NOT drive the land band
    ];
    const { rawLand } = splitCompsByClass(rows, toInput);
    expect(rawLand).toHaveLength(1);
    expect(rawLand[0].comp.id).toBe(1);
  });
});

describe('isRawLandClass', () => {
  it('only vacant_land and farm are raw land', () => {
    expect(isRawLandClass('vacant_land')).toBe(true);
    expect(isRawLandClass('farm')).toBe(true);
    for (const c of ['residential', 'manufactured', 'commercial', 'unknown', 'exclude'] as const) {
      expect(isRawLandClass(c)).toBe(false);
    }
  });
});
