import { describe, expect, it } from 'vitest';
import { reconcileDiscoveryIdentity } from './discovery-identity.js';

const LIBERTY_SUBJECT = {
  address: '1488 Liberty Hwy',
  city: 'Six Mile',
  county: 'Pickens',
  state: 'SC',
  zip: '29682',
  apn: '4068-00-37-1227',
  acres: 10.3,
};

const LIBERTY_LANDPORTAL = {
  parcelUrl: 'https://landportal.com/?property=opaque-record-key',
  assetCount: 6,
  sourceLabel: 'LandPortal authenticated parcel panel',
  parcelFacts: {
    'Owner Name': 'DURHAM BENJAMIN D',
    'Parcel ID': '4068-00-37-1227',
    'Parcel Address': '1488 LIBERTY HWY',
    Acres: '10.300',
    'Calc Acres': '9.60',
    'Parcel Address City': 'SIX MILE',
    'Parcel Address Zip Code': '29682',
    'Parcel Address State': 'SC',
    'Parcel Address County': 'Pickens County',
    'Legal Description': 'N/SIDE SIX MILE RD PLAT 63/189B',
    'Parcel Use Description': 'Residential-Vacant Land',
    'Road Frontage': '617.46 ft',
    'FEMA Flood Zone': 'Not in a flood hazard area',
    'Wetlands Coverage (%)': '0',
    'Centroid Latitude': '34.808827490936395',
    'Centroid Longitude': '-82.78866453817558',
    // Account/UI noise must not enter retained subject evidence.
    Premium: 'Platinum',
    Monthly: 'Annual',
  },
};

describe('discovery-stage subject identity', () => {
  it('uses exact operator APN/jurisdiction plus the authenticated LandPortal parcel panel when the official source is unavailable', () => {
    const decision = reconcileDiscoveryIdentity({
      subject: LIBERTY_SUBJECT,
      landPortal: LIBERTY_LANDPORTAL,
      official: {
        status: 'unavailable',
        source: 'Pickens County Assessor property search',
        note: 'The public assessor portal was attempted in the browser but did not return a machine-readable official parcel record.',
      },
    });

    expect(decision).toMatchObject({
      state: 'provisional',
      discoveryUsable: true,
      confidence: 'medium',
      patch: {
        address: '1488 LIBERTY HWY',
        city: 'SIX MILE',
        county: 'Pickens County',
        state: 'SC',
        zip: '29682',
        apn: '4068-00-37-1227',
        owner: 'DURHAM BENJAMIN D',
        acres: 10.3,
      },
      visualAssetCount: 6,
    });
    expect(decision.discoveryBasis).toMatch(/discovery-stage subject established/i);
    expect(decision.discoveryBasis).toMatch(/not closing-grade proof/i);
    expect(decision.discoverySources).toEqual(expect.arrayContaining([
      'Operator-supplied subject',
      'LandPortal authenticated parcel panel',
      'Pickens County Assessor property search',
    ]));
    expect(decision.limitations.join(' ')).toMatch(/public assessor portal was attempted/i);
    expect(decision.evidence.some((row) =>
      row.field === 'owner'
      && row.value === 'DURHAM BENJAMIN D'
      && row.classification === 'marketplace_parcel_panel')).toBe(true);
    expect(decision.retainedLandPortalFacts['Legal Description']).toBe('N/SIDE SIX MILE RD PLAT 63/189B');
    expect(decision.retainedLandPortalFacts['Road Frontage']).toBe('617.46 ft');
    expect(decision.retainedLandPortalFacts.Premium).toBeUndefined();
    expect(decision.visualSourceUrl).toContain('landportal.com');
  });

  it('keeps a genuine LandPortal APN mismatch as a hard conflict', () => {
    const decision = reconcileDiscoveryIdentity({
      subject: LIBERTY_SUBJECT,
      landPortal: {
        ...LIBERTY_LANDPORTAL,
        parcelFacts: { ...LIBERTY_LANDPORTAL.parcelFacts, 'Parcel ID': '4068-00-37-9999' },
      },
      official: { status: 'unavailable', source: 'Pickens County Assessor property search' },
    });

    expect(decision.state).toBe('conflicted');
    expect(decision.discoveryUsable).toBe(false);
    expect(decision.conflicts.join(' ')).toMatch(/LandPortal APN does not match/i);
  });

  it('does not treat a search page or sparse marketplace payload as parcel-level evidence', () => {
    const decision = reconcileDiscoveryIdentity({
      subject: LIBERTY_SUBJECT,
      landPortal: {
        parcelUrl: 'https://landportal.com/map-search',
        parcelFacts: { 'Parcel ID': LIBERTY_SUBJECT.apn },
      },
      official: { status: 'unavailable', source: 'Pickens County Assessor property search' },
    });

    expect(decision.state).toBe('provisional');
    expect(decision.discoveryUsable).toBe(false);
    expect(decision.visualSourceUrl).toBeNull();
  });

  it('promotes an exact official parcel match to high-confidence confirmation while retaining LandPortal facts', () => {
    const decision = reconcileDiscoveryIdentity({
      subject: LIBERTY_SUBJECT,
      landPortal: LIBERTY_LANDPORTAL,
      official: {
        status: 'matched',
        source: 'Pickens County official assessor parcel record',
        sourceUrl: 'https://official.example/parcel',
        parcel: {
          address: '1488 LIBERTY HWY',
          county: 'Pickens',
          state: 'SC',
          apn: '4068-00-37-1227',
          owner: 'DURHAM BENJAMIN D',
          acres: 10.3,
        },
      },
    });

    expect(decision.state).toBe('confirmed');
    expect(decision.discoveryUsable).toBe(true);
    expect(decision.confidence).toBe('high');
    expect(decision.evidence.some((row) => row.classification === 'official_record')).toBe(true);
    expect(decision.evidence.some((row) => row.classification === 'marketplace_parcel_panel')).toBe(true);
  });
});
