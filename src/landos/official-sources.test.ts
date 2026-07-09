// Tests for the official-source research card. Pure: no live network, no
// tokens, no comp credits.

import { describe, expect, it } from 'vitest';

import { buildOfficialSources } from './official-sources.js';

describe('buildOfficialSources', () => {
  it('surfaces a safe official property-record link and explicit county data gaps', () => {
    const card = buildOfficialSources({ county: 'Coffee', state: 'TN', parcelVerified: true });
    expect(card.parcelVerified).toBe(true);
    expect(card.area.descriptor).toBe('Coffee County, TN');

    const assessor = card.sources.find((s) => s.id === 'county_assessor');
    expect(assessor?.status).toBe('source_available');
    expect(assessor?.sourceUrl).toMatch(/comptroller\.tn\.gov/);

    const sales = card.sources.find((s) => s.id === 'county_sales_records');
    const gis = card.sources.find((s) => s.id === 'county_gis');
    const planning = card.sources.find((s) => s.id === 'county_planning');
    const compPlan = card.sources.find((s) => s.id === 'comprehensive_plan');
    const permits = card.sources.find((s) => s.id === 'permits_subdivision');

    expect(sales?.status).toBe('data_gap');
    expect(sales?.approvalNeeded).toMatch(/Coffee County, TN register of deeds \/ sales records URL/);
    expect(gis?.status).toBe('data_gap');
    expect(planning?.status).toBe('data_gap');
    expect(compPlan?.status).toBe('data_gap');
    expect(permits?.status).toBe('data_gap');
    expect(gis?.approvalNeeded).toMatch(/Coffee County, TN GIS URL/);
    expect(card.note).toMatch(/data gap/i);
  });

  it('does not fabricate county-specific URLs when only the state portal is known', () => {
    const card = buildOfficialSources({ county: 'Coffee', state: 'TN', parcelVerified: false });
    const countyGap = card.sources.find((s) => s.id === 'county_gis');
    expect(countyGap?.status).toBe('data_gap');
    expect(countyGap?.sourceUrl).toBeUndefined();
  });
});
