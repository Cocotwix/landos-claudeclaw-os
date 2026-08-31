import { describe, expect, it } from 'vitest';
import { mergePropertyInspections, type PropertyInspectionRecord } from './property-card.js';

const empty = (): PropertyInspectionRecord => ({
  parcelUrl: null, comparablesUrl: null, parcelFacts: {}, assets: [], overlays: [], visualObservations: [], comparables: [], sources: [], evidence: [], discoveryQuestions: [], missingInformation: [],
});

describe('mergePropertyInspections', () => {
  it('retains a verified SPA search record while keeping its root URL non-canonical', () => {
    const searched: PropertyInspectionRecord = {
      ...empty(),
      parcelUrl: 'https://landportal.com/',
      parcelUrlRecord: {
        url: 'https://landportal.com/',
        source: 'provider:landportal_search_result_verified_on_screen',
        capturedAt: '2026-08-31T00:00:00.000Z',
        propertyCardId: 91,
        dealCardId: 109,
        verifiedSubject: true,
        apn: '023 003.02',
        fips: null,
        propertyId: null,
        verifiedCounty: 'Hamilton',
        verifiedState: 'TN',
      },
      parcelFacts: { 'Parcel ID': '023 003.02', 'Parcel Address': '5170 HIGHWAY 60', Acres: '40.500' },
    };

    const merged = mergePropertyInspections([searched]);
    expect(merged?.parcelUrlRecord).toEqual(searched.parcelUrlRecord);
    expect(merged?.parcelUrlRecord?.fips).toBeNull();
    expect(merged?.parcelUrlRecord?.propertyId).toBeNull();
  });

  it('lets a newly scoped checkpoint supersede the same older APN-only search record', () => {
    const older: PropertyInspectionRecord = {
      ...empty(),
      parcelUrl: 'https://landportal.com/',
      parcelUrlRecord: {
        url: 'https://landportal.com/', source: 'provider:landportal_search_result_verified_on_screen',
        capturedAt: '2026-08-30T23:00:00.000Z', propertyCardId: 91, dealCardId: 109,
        verifiedSubject: true, apn: '023 003.02', fips: null, propertyId: null,
      },
      parcelFacts: { 'Parcel ID': '023 003.02' },
    };
    const scoped: PropertyInspectionRecord = {
      ...older,
      parcelUrlRecord: {
        ...older.parcelUrlRecord!, capturedAt: '2026-08-31T00:00:00.000Z',
        verifiedCounty: 'Hamilton', verifiedState: 'TN',
      },
    };

    const merged = mergePropertyInspections([older, scoped]);
    expect(merged?.parcelUrlRecord).toMatchObject({ verifiedCounty: 'Hamilton', verifiedState: 'TN' });
  });

  it('retains a rich LandPortal capture when a later county gap-fill has no visuals or comps', () => {
    const rich: PropertyInspectionRecord = {
      ...empty(),
      parcelUrl: 'https://app.landportal.com/property/30',
      comparablesUrl: 'https://app.landportal.com/property/30/comps',
      parcelFacts: { APN: '027 04512', Owner: 'JOINES TRAVIS' },
      assets: [{ key: 'comparables_map', label: 'Comp map', kind: 'comparables_map', purpose: 'market context', storedPath: 'visual.png', timestamp: '2026-07-20T00:00:00Z' }],
      comparables: [{ rawText: '$45,000 5.5 acres', sourceUrl: 'https://app.landportal.com/property/30/comps', address: 'Talley Rd', acres: 5.5, price: 45_000, status: 'listed', improvement: 'vacant', confidence: 'medium' }],
    };
    const countyOnly: PropertyInspectionRecord = { ...empty(), parcelUrl: 'https://county.gov/assessor', parcelFacts: { 'Official Market Value': '$54,600' } };
    const merged = mergePropertyInspections([rich, countyOnly]);
    expect(merged?.parcelUrl).toBe(rich.parcelUrl);
    expect(merged?.assets).toHaveLength(1);
    expect(merged?.comparables).toHaveLength(1);
    expect(merged?.parcelFacts).toMatchObject({ APN: '027 04512', 'Official Market Value': '$54,600' });
  });
});
