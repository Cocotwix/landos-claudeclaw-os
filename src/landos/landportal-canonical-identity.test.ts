// LandPortal canonical parcel identity — the jurisdiction the URL already carries.
//
// Acceptance case: deal 83 / 9490 Elk Lake Rd. The authenticated parcel panel
// publishes APN, owner, acreage and situs address but NO county and NO state.
// The discovery gate requires both, so it rejected its own verified match for
// missing exactly the field the parcel URL it was reading already encoded.

import { describe, expect, it } from 'vitest';
import {
  bareCountyName,
  countyNamesAgree,
  decodeLandPortalCanonicalIdentity,
  stateFromCountyFips,
  stateNamesAgree,
  uspsFromStateName,
} from './landportal-canonical-identity.js';

const ELK_LAKE_URL =
  'https://landportal.com/?property=Zmlwcz0yNjA1NSZhcG49MTMtMTE2LTAxNS0wMSZwcm9wZXJ0eWlkPTE1ODA3MjU4NA%3D%3D';

describe('decodeLandPortalCanonicalIdentity', () => {
  it('recovers county FIPS, APN and property id from the retained parcel URL', () => {
    expect(decodeLandPortalCanonicalIdentity(ELK_LAKE_URL)).toEqual({
      fips: '26055',
      apn: '13-116-015-01',
      propertyId: '158072584',
      state: 'MI',
      stateFips: '26',
      countyFips: '055',
    });
  });

  it('accepts a bare token and an already-decoded query string', () => {
    const fromToken = decodeLandPortalCanonicalIdentity(
      'Zmlwcz0yNjA1NSZhcG49MTMtMTE2LTAxNS0wMSZwcm9wZXJ0eWlkPTE1ODA3MjU4NA==',
    );
    const fromQuery = decodeLandPortalCanonicalIdentity('fips=26055&apn=13-116-015-01&propertyid=158072584');
    expect(fromToken?.fips).toBe('26055');
    expect(fromQuery?.apn).toBe('13-116-015-01');
    expect(fromQuery?.state).toBe('MI');
  });

  it('identifies nothing from a partial or non-parcel URL', () => {
    expect(decodeLandPortalCanonicalIdentity('https://landportal.com/')).toBeNull();
    expect(decodeLandPortalCanonicalIdentity('fips=26055&apn=13-116-015-01')).toBeNull();
    expect(decodeLandPortalCanonicalIdentity('')).toBeNull();
    expect(decodeLandPortalCanonicalIdentity(null)).toBeNull();
  });

  it('rejects a malformed FIPS rather than padding it into a real county', () => {
    expect(decodeLandPortalCanonicalIdentity('fips=abc&apn=1&propertyid=2')).toBeNull();
    expect(decodeLandPortalCanonicalIdentity('fips=260551234&apn=1&propertyid=2')).toBeNull();
  });

  it('leaves the state null for a FIPS prefix that is not an assigned state', () => {
    const decoded = decodeLandPortalCanonicalIdentity('fips=99055&apn=1&propertyid=2');
    expect(decoded?.fips).toBe('99055');
    expect(decoded?.state).toBeNull();
  });
});

describe('stateFromCountyFips', () => {
  it('maps the state half of a county FIPS deterministically', () => {
    expect(stateFromCountyFips('26055')).toBe('MI');
    expect(stateFromCountyFips('13303')).toBe('GA');
    expect(stateFromCountyFips('36011')).toBe('NY');
  });

  it('refuses anything that is not a 5-digit county code', () => {
    expect(stateFromCountyFips('26')).toBeNull();
    expect(stateFromCountyFips('')).toBeNull();
    expect(stateFromCountyFips(null)).toBeNull();
  });
});

describe('name normalisation', () => {
  it('stores a county the way a property card does', () => {
    expect(bareCountyName('Grand Traverse County')).toBe('Grand Traverse');
    expect(bareCountyName('Washington County')).toBe('Washington');
    expect(bareCountyName('East Baton Rouge Parish')).toBe('East Baton Rouge');
    expect(bareCountyName('Prince of Wales-Hyder Census Area')).toBe('Prince of Wales-Hyder');
  });

  it('never empties a name that is only a suffix', () => {
    expect(bareCountyName('County')).toBe('County');
  });

  it('agrees across suffix and punctuation differences only', () => {
    expect(countyNamesAgree('Grand Traverse', 'Grand Traverse County')).toBe(true);
    expect(countyNamesAgree('St. Clair', 'St Clair County')).toBe(true);
    expect(countyNamesAgree('Grand Traverse', 'Traverse')).toBe(false);
    expect(countyNamesAgree('', 'Grand Traverse')).toBe(false);
  });

  it('agrees across spelled and abbreviated states', () => {
    expect(stateNamesAgree('Michigan', 'MI')).toBe(true);
    expect(stateNamesAgree('MI', 'MI')).toBe(true);
    expect(stateNamesAgree('Michigan', 'IN')).toBe(false);
    expect(stateNamesAgree('', 'MI')).toBe(false);
  });

  it('resolves USPS abbreviations from spelled names', () => {
    expect(uspsFromStateName('Michigan')).toBe('MI');
    expect(uspsFromStateName('New York')).toBe('NY');
    expect(uspsFromStateName('MI')).toBe('MI');
    expect(uspsFromStateName('Nowhere')).toBeNull();
    expect(uspsFromStateName('ZZ')).toBeNull();
  });
});
