import { describe, it, expect } from 'vitest';
import { buildParcelFactSheet } from './landportal-facts.js';

// Ground-truth LandPortal parcel fields captured live for
// 3401 62nd St W, Lehigh Acres FL (APN 02-44-26-L4-08070.0100).
const REAL_FIELDS: Record<string, string> = {
  'Owner Name': 'CMM INVEST SERVICE LLC',
  'Parcel ID': '02-44-26-L4-08070.0100',
  'Parcel Address': '3401 62ND ST W',
  'Acres': '0.250',
  'MLS Acres': '0.25',
  'Calc Acres': '0.25',
  'Building SqFt': '0.0',
  'Parcel SqFt': '10890',
  'Land Locked': 'No',
  'Road Frontage': '69.93 ft',
  'Water Feature': 'Yes',
  'Water Feature type(s)': 'Canal',
  'Parcel Address City': 'LEHIGH ACRES',
  'Parcel Address State': 'FL',
  'Parcel Address County': 'Lee County',
  'Legal Description': 'LEHIGH ACRES UNIT 8 BLK 70 PB 15 PG 59 LOT 10',
  'Estimate price': '$17,482',
  'Estimate PPA': '$69,929',
  'Parcel Use Description': 'Residential-Vacant Land',
  'FEMA Flood Zone': 'Not in a flood hazard area',
  'Wetlands Coverage (%)': '0',
  'FEMA Coverage (%)': '0',
  'Zoning Code': 'RS-1',
  'Buildability total (%)': '28.10 %',
  'Buildability area (acres)': '0.07 ac.',
  'Slope Avg': '10.45 %',
  'Elevation Avg': '18.83 ft',
  'Elevation Min': '16.96 ft',
  'Elevation Max': '23.69 ft',
  'Last Sale Price': '16000',
  'Last Sale Date': '04-18-2023',
  'Assessed Value': '$14,181.00',
  'Total Market Value': '$16,150.00',
  'Tax Amount': '$442.34',
  'Centroid Latitude': '26.67358211578318',
  'Centroid Longitude': '-81.68747205666358',
};

describe('buildParcelFactSheet', () => {
  const s = buildParcelFactSheet(REAL_FIELDS);

  it('maps core identity + acreage', () => {
    expect(s.apn).toBe('02-44-26-L4-08070.0100');
    expect(s.owner).toBe('CMM INVEST SERVICE LLC');
    expect(s.acres).toBe(0.25);
  });

  it('interprets access (never raw "No")', () => {
    expect(s.access.label).toBe('Road frontage present, not landlocked. Legal access likely, verify if needed.');
    expect(s.access.roadFrontageFt).toBeCloseTo(69.93, 2);
  });

  it('maps real buildability, not Building SqFt', () => {
    expect(s.buildability.pct).toBe('28.1%');
    expect(s.buildability.acres).toBe('0.07 ac');
  });

  it('shows extracted flood/wetlands values, not "overlay captured"', () => {
    expect(s.environment.femaFloodZone).toBe('Not in a flood hazard area');
    expect(s.environment.wetlandsPct).toBe('0%');
    expect(s.environment.femaCoveragePct).toBe('0%');
  });

  it('maps zoning, land use, water feature', () => {
    const byKey = Object.fromEntries(s.snapshot.map((r) => [r.key, r.value]));
    expect(byKey.zoning).toBe('RS-1');
    expect(byKey.landUse).toBe('Residential-Vacant Land');
    expect(s.water.label).toBe('Yes, Canal');
  });

  it('maps last sale, assessed, market value, tax', () => {
    expect(s.valuation.lastSalePrice).toBe(16000);
    expect(s.valuation.lastSalePriceLabel).toBe('$16,000');
    expect(s.valuation.lastSaleDate).toBe('04-18-2023');
    expect(s.valuation.assessedValue).toBe('$14,181.00');
    expect(s.valuation.totalMarketValue).toBe('$16,150.00');
    expect(s.valuation.taxAmount).toBe('$442.34');
  });

  it('captures centroid for enrichment', () => {
    expect(s.centroid.lat).toBeCloseTo(26.6736, 3);
    expect(s.centroid.lng).toBeCloseTo(-81.6875, 3);
  });

  it('NEVER surfaces Legal Description in the visible snapshot', () => {
    expect(s.snapshot.some((r) => /legal description/i.test(r.label))).toBe(false);
    expect(s.legalDescription).toContain('LEHIGH ACRES UNIT 8');
  });

  it('asks the canal drainage question but NOT wetland delineation (0% wetlands, no flood)', () => {
    expect(s.sellerQuestions.some((q) => /canal.*drainage easement/i.test(q))).toBe(true);
    expect(s.sellerQuestions.some((q) => /wetland delineation/i.test(q))).toBe(false);
    expect(s.sellerQuestions.some((q) => /utilities are available at the road/i.test(q))).toBe(true);
  });

  it('marks unexposed fields needs_verification without fabricating', () => {
    const sparse = buildParcelFactSheet({ 'Parcel ID': 'X', 'Owner Name': 'Y' });
    const zoning = sparse.snapshot.find((r) => r.key === 'zoning');
    expect(zoning?.status).toBe('needs_verification');
    expect(zoning?.value).toBe('Needs verification');
  });
});
