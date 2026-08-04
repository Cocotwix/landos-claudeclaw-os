// Soils & Preliminary Septic Outlook contract: official interpretations
// govern the category; soil names alone never do; no pass/fail claim and no
// fabricated probability or parcel percentage; confidence drops honestly
// when only drainage-class screening exists; the perc test stays required.

import { describe, expect, it } from 'vitest';

import { buildSoilsSepticOutlook, type SoilsSepticScreeningRecord } from './soils-septic-outlook.js';

const ACCEPTED_UNITS = [
  { symbol: null, name: 'Williamson silt loam, 6 to 12 percent slopes', fields: { 'Drainage Class': 'Moderately well drained' } },
  { symbol: null, name: 'Williamson silt loam, 2 to 6 percent slopes', fields: { 'Drainage Class': 'Moderately well drained' } },
  { symbol: null, name: 'Ira gravelly loam, 3 to 8 percent slopes', fields: { 'Drainage Class': 'Moderately well drained' } },
];

const screening = (rating: string): SoilsSepticScreeningRecord => ({
  source: 'USDA NRCS SSURGO (Soil Data Access), NY011',
  sourceUrl: 'https://sdmdataaccess.sc.egov.usda.gov/',
  surveyArea: 'NY011',
  retrievedAt: '2026-08-04T00:00:00.000Z',
  bestTestingAreasNote: 'The gentlest open meadow area.',
  units: ACCEPTED_UNITS.map((unit, index) => ({
    name: unit.name,
    symbol: ['WmC', 'WmB', 'IrB'][index],
    slopeRange: '2–12%',
    drainageClass: 'Moderately well drained',
    hydrologicGroup: 'D',
    waterTableDepthCm: index === 2 ? 54 : 44,
    bedrockDepthCm: null,
    floodingFrequency: 'None',
    pondingFrequency: 'None',
    septicRating: rating,
    limitationReasons: ['Depth to saturated zone'],
    parcelSharePct: null,
  })),
});

describe('category derivation', () => {
  it('rates Low (conventional) when every unit is officially Very limited', () => {
    const outlook = buildSoilsSepticOutlook(ACCEPTED_UNITS, screening('Very limited'))!;
    expect(outlook.category).toBe('low');
    expect(outlook.categoryLabel).toMatch(/Low preliminary likelihood/);
    expect(outlook.conclusion).toMatch(/Very limited/);
    expect(outlook.conclusion).toMatch(/seasonal high water table/i);
    expect(outlook.confidence).toBe('moderate');
  });

  it('rates High when every unit is officially Not limited', () => {
    const outlook = buildSoilsSepticOutlook(ACCEPTED_UNITS, screening('Not limited'))!;
    expect(outlook.category).toBe('high');
  });

  it('falls back to drainage-class screening with LOW confidence without official ratings', () => {
    const outlook = buildSoilsSepticOutlook(ACCEPTED_UNITS, null)!;
    expect(outlook.category).toBe('moderate');
    expect(outlook.confidence).toBe('low');
    expect(outlook.confidenceWhy).toMatch(/No official septic interpretation/);
  });

  it('returns null with no soil data at all', () => {
    expect(buildSoilsSepticOutlook([], null)).toBeNull();
  });
});

describe('honesty constraints', () => {
  it('never states pass/fail or a numeric probability', () => {
    const text = JSON.stringify(buildSoilsSepticOutlook(ACCEPTED_UNITS, screening('Very limited')));
    expect(text).not.toMatch(/\b(will|would) (pass|fail)\b/i);
    expect(text).not.toMatch(/\d+\s?(?:%|percent) (?:chance|probability)/i);
  });

  it('reports unit-level findings and lowers nothing silently when parcel shares are missing', () => {
    const outlook = buildSoilsSepticOutlook(ACCEPTED_UNITS, screening('Very limited'))!;
    expect(outlook.parcelShareNote).toMatch(/parcel percentages are not retained/i);
    expect(outlook.units).toHaveLength(3);
    for (const unit of outlook.units) expect(unit.parcelSharePct).toBeNull();
  });

  it('always requires the perc test / professional evaluation next step', () => {
    for (const record of [screening('Very limited'), null]) {
      const outlook = buildSoilsSepticOutlook(ACCEPTED_UNITS, record)!;
      expect(outlook.nextStep).toMatch(/Perc test or professional soil evaluation/);
    }
  });

  it('surfaces the water-table limitation with real depths, not a name-based guess', () => {
    const outlook = buildSoilsSepticOutlook(ACCEPTED_UNITS, screening('Very limited'))!;
    expect(outlook.limitations.join(' ')).toMatch(/17–21 inches \(44–54 cm\)/);
  });
});
