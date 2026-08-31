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
  it('uses a passed SPA parcel checkpoint when the provider leaves the browser on its root URL', () => {
    const decision = reconcileDiscoveryIdentity({
      subject: { address: 'Parcel 023.003-02', city: 'Birchwood', county: 'Hamilton', state: 'TN', apn: '023.003-02' },
      landPortal: {
        parcelUrl: 'https://landportal.com/',
        verifiedSubject: true,
        verifiedSubjectApn: '023 003.02',
        verifiedSubjectCounty: 'Hamilton',
        verifiedSubjectState: 'TN',
        sourceLabel: 'LandPortal authenticated parcel panel',
        parcelFacts: {
          'Parcel ID': '023 003.02',
          'Parcel Address': '5170 HIGHWAY 60',
          'Owner Name': 'CAMERON NATHANIEL JOSEPH',
          Acres: '40.500',
        },
      },
      official: { status: 'unavailable', note: 'No official county source answered.' },
    });

    expect(decision).toMatchObject({
      state: 'provisional',
      discoveryUsable: true,
      patch: { apn: '023 003.02', county: 'Hamilton', state: 'TN', owner: 'CAMERON NATHANIEL JOSEPH', acres: 40.5 },
      visualSourceUrl: 'https://landportal.com/',
    });
    expect(decision.discoveryBasis).toMatch(/verified search scope/i);
  });

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
    expect(decision.discoveryBasis).toMatch(/subject established for discovery/i);
    expect(decision.discoveryBasis).toMatch(/full analysis proceeds/i);
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

  it('uses a parcel-level LandPortal address match when a fresh lead supplied no APN or county', () => {
    const decision = reconcileDiscoveryIdentity({
      subject: {
        address: '105 Right Fork Rd',
        state: 'SC',
      },
      landPortal: {
        parcelUrl: 'https://landportal.com/?property=opaque-record-key',
        assetCount: 6,
        sourceLabel: 'LandPortal authenticated parcel panel',
        parcelFacts: {
          'Owner Name': 'BELOUSOV RENTALS LLC',
          'Parcel ID': '4184-00-92-4261',
          'Parcel Address': '105 RIGHT FORK RD',
          Acres: '14.700',
          'Parcel Address City': 'PICKENS',
          'Parcel Address Zip Code': '29671',
          'Parcel Address State': 'SC',
          'Parcel Address County': 'Pickens County',
        },
      },
      official: {
        status: 'unavailable',
        source: 'Pickens County official parcel sources',
        note: 'County GIS and assessor sources were attempted but did not return a structured match.',
      },
    });

    expect(decision).toMatchObject({
      state: 'provisional',
      discoveryUsable: true,
      confidence: 'medium',
      patch: {
        address: '105 RIGHT FORK RD',
        county: 'Pickens County',
        state: 'SC',
        apn: '4184-00-92-4261',
        owner: 'BELOUSOV RENTALS LLC',
        acres: 14.7,
      },
    });
    expect(decision.discoveryBasis).toMatch(/supplied address 105 Right Fork Rd/i);
    expect(decision.discoveryBasis).toMatch(/4184-00-92-4261/i);
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
    // A search page promotes NO parcel-level evidence: no visual source, no
    // parcel identity, no confidence. Discovery-stage research may still
    // continue against the operator's own address — that is the address lane,
    // not marketplace evidence, and it is what keeps a complete street address
    // from dead-ending on an unverified identifier.
    expect(decision.visualSourceUrl).toBeNull();
    expect(decision.confidence).toBe('low');
    expect(decision.patch.apn).toBe(LIBERTY_SUBJECT.apn);
    expect(decision.discoveryBasis).toMatch(/no official parcel identity is claimed/i);
  });

  it('continues marketplace discovery for an address/state lead after a LandPortal no-match', () => {
    const decision = reconcileDiscoveryIdentity({
      subject: {
        address: '240 Golden View Lane',
        city: 'Hampshire',
        state: 'TN',
      },
      landPortal: {
        parcelUrl: 'https://landportal.com/map-search',
        parcelFacts: {},
      },
      official: {
        status: 'no_match',
        source: 'Tennessee public parcel sources',
        note: 'No exact parcel record was returned for the supplied address.',
      },
    });

    expect(decision).toMatchObject({
      state: 'provisional',
      discoveryUsable: true,
      confidence: 'low',
    });
    expect(decision.discoveryBasis).toMatch(/market research/i);
    expect(decision.discoveryBasis).toMatch(/no official parcel identity/i);
    expect(decision.discoverySources).toContain('Operator address/state discovery fallback');
  });

  it('keeps an unverified retained LandPortal page as context instead of subject identity', () => {
    const decision = reconcileDiscoveryIdentity({
      subject: { address: '240 Golden View Lane', state: 'TN' },
      landPortal: {
        parcelUrl: 'https://landportal.com/?property=opaque-record-key',
        verifiedSubject: false,
        parcelFacts: {
          'Parcel ID': '015 00407',
          'Parcel Address': '240 GOLDEN VIEW LN',
          'Parcel Address County': 'Lewis County',
          'Parcel Address State': 'TN',
          Acres: '20.278',
          'Road Frontage': '211.69 ft',
          'Slope Avg': '28.88 %',
          'Estimate PPA': '$8,800',
          'Estimate price': '$178,464',
        },
      },
      official: { status: 'no_match', source: 'Tennessee parcel sources', note: 'No exact parcel match.' },
    });

    expect(decision.discoveryUsable).toBe(true);
    expect(decision.patch).toEqual({ address: '240 Golden View Lane', state: 'TN' });
    expect(decision.retainedLandPortalFacts).toEqual({ 'Estimate PPA': '$8,800', 'Estimate price': '$178,464' });
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

// ── Jurisdiction carried by the parcel URL, not the parcel panel ────────────
//
// Deal 83 / 9490 Elk Lake Rd. The authenticated panel publishes APN, owner,
// acreage and situs address but NO county and NO state. The gate required both,
// so it rejected its own verified match for want of a jurisdiction the URL it
// was reading already encoded — and every jurisdiction-bound lane was told "no
// exact parcel-level source agreed on its APN and jurisdiction".

const ELK_LAKE_LANDPORTAL = {
  parcelUrl:
    'https://landportal.com/?property=Zmlwcz0yNjA1NSZhcG49MTMtMTE2LTAxNS0wMSZwcm9wZXJ0eWlkPTE1ODA3MjU4NA%3D%3D',
  assetCount: 0,
  sourceLabel: 'LandPortal authenticated parcel panel',
  parcelFacts: {
    'Owner Name': 'WELLS MICHAEL C',
    'Parcel ID': '13-116-015-01',
    'Parcel Address': '9490 ELK LAKE RD',
    Acres: '60.000',
    'Calc Acres': '59.67',
    'Building SqFt': '1701',
    'Land Locked': 'Yes',
  },
};

describe('jurisdiction from the canonical parcel URL', () => {
  it('establishes an address-only lead whose panel prints no county or state', () => {
    const decision = reconcileDiscoveryIdentity({
      subject: { address: '9490 Elk Lake Rd' },
      landPortal: ELK_LAKE_LANDPORTAL,
      official: { status: 'unavailable', note: 'No official county source answered.' },
    });

    expect(decision.state).toBe('provisional');
    expect(decision.discoveryUsable).toBe(true);
    expect(decision.patch.apn).toBe('13-116-015-01');
    // The county is cited by its federal code, never invented as a name.
    expect(decision.discoveryBasis).toContain('26055');
    expect(decision.discoveryBasis).not.toContain('undefined');
  });

  it('matches a rerun subject by its retained county FIPS and APN', () => {
    const decision = reconcileDiscoveryIdentity({
      subject: {
        address: '9490 Elk Lake Rd',
        city: 'Williamsburg',
        county: 'Grand Traverse',
        state: 'MI',
        zip: '49690',
        apn: '13-116-015-01',
        fips: '26055',
        acres: 60,
      },
      landPortal: ELK_LAKE_LANDPORTAL,
      official: { status: 'unavailable', note: 'No official county source answered.' },
    });

    expect(decision.state).toBe('provisional');
    expect(decision.discoveryUsable).toBe(true);
    expect(decision.patch.county).toBe('Grand Traverse');
    expect(decision.patch.state).toBe('MI');
  });

  it('does not match when the retained FIPS names a different county', () => {
    const decision = reconcileDiscoveryIdentity({
      subject: {
        address: '9490 Elk Lake Rd',
        county: 'Fulton',
        state: 'IN',
        apn: '13-116-015-01',
        fips: '18049',
      },
      landPortal: ELK_LAKE_LANDPORTAL,
      official: { status: 'unavailable', note: 'No official county source answered.' },
    });

    expect(decision.discoveryUsable).toBe(false);
  });

  it('still refuses a parcel URL that carries no canonical key', () => {
    const decision = reconcileDiscoveryIdentity({
      subject: { address: '9490 Elk Lake Rd' },
      landPortal: { ...ELK_LAKE_LANDPORTAL, parcelUrl: 'https://landportal.com/?property=opaque-record-key' },
      official: { status: 'unavailable', note: 'No official county source answered.' },
    });

    expect(decision.discoveryUsable).toBe(false);
  });
});
