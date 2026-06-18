// Tests: LandPortal property_summary -> Duke dashboard property-data contract.
import { describe, it, expect } from 'vitest';
import { normalizeFromLpSummary } from './duke-property-data.js';
import type { LpPropertySummary } from './landportal-client.js';

function summary(over: Partial<LpPropertySummary> = {}): LpPropertySummary {
  const base: LpPropertySummary = {
    propertyid: '173393466', apn: '076-022.02', situs_address: '123 Smoke Rd', city: 'Manchester', state: 'TN',
    zip: '37355', county: 'Coffee', owner: 'Smoke Owner LLC', land_use: 'Vacant Residential',
    lot_size_acres: '12.5', calc_acres: '12.5', lot_size_sqft: '544500', road_frontage_ft: '210',
    land_locked: 'false', near_water: 'false', wetlands_pct: '3', fema_pct: '0', buildability_pct: '88',
    buildability_acres: '11', slope_avg_deg: '4', elevation_avg_ft: '1050', building_area_sqft: '0',
    assessed_total: '42000', assessed_land: '42000', market_total: '60000', market_land: '60000',
    tlp_estimate: '75000', tlp_ppa: '6000', price_acre_county: '5800', lat: '35.0', lng: '-86.0',
    municipality: '', mailing_address: 'PO Box 1', mailing_city: 'Manchester', mailing_state: 'TN',
    similars_count: '4', similars_ppa_min: '4000', similars_ppa_max: '9000', similars_ppa_median: '6000',
    similars_most_recent_year: '2024',
  };
  return { ...base, ...over };
}

describe('normalizeFromLpSummary', () => {
  it('maps identity, land facts, valuation, and similars from the source', () => {
    const d = normalizeFromLpSummary(summary(), { fips: '47031', nowIso: '2026-06-17T00:00:00.000Z' });
    expect(d.sourceName).toBe('LandPortal');
    expect(d.generatedAt).toBe('2026-06-17T00:00:00.000Z');
    expect(d.identity.propertyId).toBe('173393466');
    expect(d.identity.fips).toBe('47031');
    expect(d.identity.apn).toBe('076-022.02');
    expect(d.identity.county).toBe('Coffee');
    expect(d.identity.owner).toBe('Smoke Owner LLC');
    expect(d.identity.mailingAddress).toBe('PO Box 1, Manchester, TN');
    expect(d.landFacts.acres).toBe(12.5);
    expect(d.landFacts.roadFrontageFt).toBe(210);
    expect(d.landFacts.buildabilityPct).toBe(88);
    expect(d.landFacts.wetlandsPct).toBe(3);
    expect(d.valuation.marketTotal).toBe(60000);
    expect(d.valuation.tlpPpa).toBe(6000);
    expect(d.similars.count).toBe(4);
    expect(d.similars.ppaMedian).toBe(6000);
    expect(d.truthLabel).toBe('verified_fact');
  });

  it('lists missing fields as data gaps and never fabricates them', () => {
    const d = normalizeFromLpSummary(
      summary({ owner: '', road_frontage_ft: '', tlp_estimate: '', similars_count: '0' }),
      { fips: '47031' },
    );
    expect(d.identity.owner).toBeUndefined();
    expect(d.dataGaps).toContain('owner');
    expect(d.dataGaps).toContain('roadFrontageFt');
    expect(d.dataGaps).toContain('tlpEstimate');
    expect(d.dataGaps).toContain('similars');
  });

  it('never surfaces coordinates (lat/lng) in the contract', () => {
    const blob = JSON.stringify(normalizeFromLpSummary(summary(), { fips: '47031' }));
    expect(blob.includes('35.0')).toBe(false);
    expect(blob.includes('-86.0')).toBe(false);
    expect(blob.toLowerCase()).not.toContain('"lat"');
    expect(blob.toLowerCase()).not.toContain('"lng"');
  });
});
