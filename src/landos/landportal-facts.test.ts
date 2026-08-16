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

  it('uses calculated acreage when the stated acreage is a zero placeholder', () => {
    expect(buildParcelFactSheet({ Acres: '0.000', 'Calc Acres': '0.80' }).acres).toBe(0.8);
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

  // Deal 89, live: the internal API answered `water_feature_types` with the
  // SET's Postgres literal of code ids, and the operator panel published
  // "Water Feature {16}".
  it('never publishes a raw code set as the water feature type', () => {
    const sheet = buildParcelFactSheet({ ...REAL_FIELDS, 'Water Feature type(s)': '{16}' });
    expect(sheet.water.type).toBeNull();
    expect(sheet.water.present).toBe(true);
    expect(sheet.water.label).toBe('Yes');
  });

  it('still renders a labelled set, including a multi-value one', () => {
    expect(buildParcelFactSheet({ ...REAL_FIELDS, 'Water Feature type(s)': 'Creek / Stream' }).water.label)
      .toBe('Yes, Creek / Stream');
    expect(buildParcelFactSheet({ ...REAL_FIELDS, 'Water Feature type(s)': '{Creek,Stream}' }).water.label)
      .toBe('Yes, Creek / Stream');
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

// What LandPortal actually supplied must be RETAINED. "Not retained" is a claim
// about LandOS losing evidence, and it may never be made about a field the
// source published. The retention read is what a surface must consult before
// printing it.
describe('LandPortal intelligence is retained, field by field', () => {
  const s = buildParcelFactSheet(REAL_FIELDS);

  it('retains terrain: slope and elevation, with a readable label', () => {
    expect(s.terrain.slopeAvgPct).toBe('10.45%');
    expect(s.terrain.elevationAvg).toBe('18.83 ft');
    expect(s.terrain.elevationMin).toBe('16.96 ft');
    expect(s.terrain.elevationMax).toBe('23.69 ft');
    expect(s.terrain.label).toMatch(/avg slope 10\.45%/);
    expect(s.terrain.label).toMatch(/range 16\.96 ft to 23\.69 ft/);
    expect(s.terrain.label).not.toBe('Needs verification');
  });

  it('retains soils when the panel exposes them, and stays silent when it does not', () => {
    expect(s.soils.label).toBeNull();
    const withSoils = buildParcelFactSheet({
      ...REAL_FIELDS,
      'Soil Type': 'Rubicon sand',
      'Soil Description': '0 to 6 percent slopes, well drained',
    });
    expect(withSoils.soils.type).toBe('Rubicon sand');
    expect(withSoils.soils.label).toBe('Rubicon sand — 0 to 6 percent slopes, well drained');
    expect(withSoils.retention.retained).toContain('soils');
    expect(s.retention.notSupplied).toContain('soils');
  });

  it('keeps improvement evidence separate from buildability', () => {
    // Building SqFt 0.0 on a vacant lot is a reported zero, not buildability.
    expect(s.improvement.buildingSqft).toBe('0.0');
    expect(s.improvement.improved).toBe(false);
    expect(s.improvement.label).toMatch(/No improvement reported/i);
    expect(s.buildability.pct).toBe('28.1%');

    const improved = buildParcelFactSheet({
      ...REAL_FIELDS,
      'Building SqFt': '2,184',
      'Year Built': '1994',
      'Improvement Value': '$212,400.00',
    });
    expect(improved.improvement.improved).toBe(true);
    expect(improved.improvement.label).toMatch(/Improved · 2,184 building sq ft · built 1994/);
    expect(improved.retention.retained).toEqual(
      expect.arrayContaining(['buildingSqft', 'yearBuilt', 'improvementValue']),
    );
  });

  it('retains parcel context (use, zoning, size, subdivision) as one read', () => {
    expect(s.parcelContext.landUse).toBe('Residential-Vacant Land');
    expect(s.parcelContext.zoning).toBe('RS-1');
    expect(s.parcelContext.parcelSqft).toBe('10890');
    expect(s.parcelContext.label).toBe('Residential-Vacant Land · zoned RS-1 · 10890 sq ft');
    expect(buildParcelFactSheet({ ...REAL_FIELDS, Subdivision: 'Lehigh Acres Unit 8' }).parcelContext.subdivision)
      .toBe('Lehigh Acres Unit 8');
  });

  it('reports retention per field, so nothing LandPortal supplied reads as "Not retained"', () => {
    for (const key of [
      'owner', 'apn', 'acres', 'landLocked', 'roadFrontage',
      'buildabilityPct', 'buildabilityAcres', 'slopeAvg',
      'elevationAvg', 'elevationRange',
      'femaFloodZone', 'femaCoverage', 'wetlandsCoverage', 'waterFeature',
      'zoning', 'landUse', 'parcelSqft', 'lastSale', 'assessedValue', 'centroid',
    ]) {
      expect(s.retention.retained).toContain(key);
      expect(s.retention.notSupplied).not.toContain(key);
    }
    // Every canonical field lands on exactly one side of the read.
    const overlap = s.retention.retained.filter((key) => s.retention.notSupplied.includes(key));
    expect(overlap).toEqual([]);
  });

  it('separates "the source did not publish it" from "we failed to keep it"', () => {
    const sparse = buildParcelFactSheet({ 'Parcel ID': 'X', 'Owner Name': 'Y' });
    expect(sparse.retention.retained).toEqual(['owner', 'apn']);
    expect(sparse.retention.notSupplied).toContain('slopeAvg');
    expect(sparse.retention.notSupplied).toContain('wetlandsCoverage');
  });

  it('retains the FEMA answer LandPortal displays even when only the description is exposed', () => {
    const descriptionOnly = buildParcelFactSheet({
      'FEMA Flood Zone Description': 'Area of minimal flood hazard (Zone X)',
    });
    expect(descriptionOnly.environment.femaFloodZoneDescription).toBe('Area of minimal flood hazard (Zone X)');
    expect(descriptionOnly.environment.femaFloodZone).toBe('Area of minimal flood hazard (Zone X)');
    expect(descriptionOnly.retention.retained).toContain('femaFloodZone');
  });

  it('is built from the LandPortal fields alone — no other source can demote it', () => {
    // The fact sheet takes exactly one argument. There is no seam through which
    // an official-GIS outcome could reach it, so a failure there cannot turn
    // retained LandPortal terrain, wetlands or buildability into "Not retained".
    expect(buildParcelFactSheet.length).toBe(1);
    expect(buildParcelFactSheet(REAL_FIELDS).retention).toEqual(s.retention);
  });
});

describe('quarantined terrain stays reportable intelligence', () => {
  const QUARANTINED: Record<string, string> = {
    'Parcel ID': '042-123.00-000',
    Acres: '75.910',
    'Slope Avg': '',
    'Buildability total (%)': '',
    'Buildability area (acres)': '',
    'Slope Avg (provider observation)': '18.65 %',
    'Buildability total (%) (provider observation)': '30.52 %',
    'Buildability area (acres) (provider observation)': '15.49 ac.',
    'Terrain Quarantine Reason': 'Provider reported average slope 18.65%, buildability 30.52%, buildable area 15.49 acres, but the buildable-area arithmetic does not reconcile to parcel acreage.',
  };

  it('reports the provider figure and the reason instead of dropping both', () => {
    const sheet = buildParcelFactSheet(QUARANTINED);
    expect(sheet.terrain.slopeAvgPct).toBeNull();
    expect(sheet.buildability.pct).toBeNull();
    expect(sheet.terrainQuarantine).not.toBeNull();
    expect(sheet.terrainQuarantine!.slopeAvgPct).toBe('18.65%');
    expect(sheet.terrainQuarantine!.buildabilityPct).toBe('30.52%');
    expect(sheet.terrainQuarantine!.buildableAcres).toBe('15.49 ac');
    expect(sheet.terrainQuarantine!.reason).toMatch(/does not reconcile/);
  });

  it('does not report a held figure as a field the source never supplied', () => {
    const sheet = buildParcelFactSheet(QUARANTINED);
    expect(sheet.retention.retained).toContain('slopeAvg');
    expect(sheet.retention.retained).toContain('buildabilityPct');
    expect(sheet.retention.notSupplied).not.toContain('slopeAvg');
  });

  it('carries no quarantine block when nothing was held back', () => {
    expect(buildParcelFactSheet({ 'Parcel ID': 'X', 'Slope Avg': '4 %' }).terrainQuarantine).toBeNull();
  });
});

describe('fields the panel publishes under its own labels', () => {
  it('reads Structure Year Built as the year built', () => {
    expect(buildParcelFactSheet({ 'Structure Year Built': '1968', 'Building SqFt': '1534' }).improvement.yearBuilt).toBe('1968');
  });

  it('derives land under 10% slope from the published bins', () => {
    const sheet = buildParcelFactSheet({
      'Flat Slope (0-.5%)': '0.12 %',
      'Minimal Slope (.5-5%)': '8.58 %',
      'Moderate Slope (5-10%)': '17.20 %',
    });
    expect(sheet.terrain.slopeUnder10Pct).toBe('25.9%');
  });

  it('states no combined under-10% figure when a bin is missing', () => {
    expect(buildParcelFactSheet({ 'Flat Slope (0-.5%)': '0.12 %' }).terrain.slopeUnder10Pct).toBeNull();
  });
});
