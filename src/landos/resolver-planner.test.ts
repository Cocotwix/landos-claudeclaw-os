import { describe, it, expect } from 'vitest';
import { planResolver, smallestNextIdentifier } from './resolver-planner.js';

describe('planResolver — strongest exact path from flexible identifiers', () => {
  it('property id + FIPS is the strongest path', () => {
    const p = planResolver({ propertyId: '41578257', fips: '13321', address: '1 X St', city: 'Y', state: 'GA' });
    expect(p.path).toBe('lp_property_id_fips');
    expect(p.args).toMatchObject({ propertyid: '41578257', fips: '13321' });
    expect(p.dependentReleaseAfterResolve).toBe(true);
    expect(p.addressAvailableNow).toBe(false);
  });

  it('APN + county/state outranks a full address (resolver runs first, lanes release after)', () => {
    const p = planResolver({ apn: '00830-054-000', county: 'Worth', state: 'GA', address: '472 West Rd', city: 'Poulan' });
    expect(p.path).toBe('apn_locality');
    expect(p.args).toMatchObject({ apn: '00830-054-000', county: 'Worth', state: 'GA' });
    expect(p.dependentReleaseAfterResolve).toBe(true);
  });

  it('full address + city/state/ZIP -> address path with ZIP passed through (lanes start now)', () => {
    const p = planResolver({ address: '472 West Rd', city: 'Poulan', state: 'GA', zip: '31781' });
    expect(p.path).toBe('address_city_state_zip');
    expect(p.args).toMatchObject({ address: '472 West Rd', city: 'Poulan', state: 'GA', zip: '31781' });
    expect(p.addressAvailableNow).toBe(true);
    expect(p.dependentReleaseAfterResolve).toBe(false);
  });

  it('full address + county/state when no city', () => {
    const p = planResolver({ address: '472 West Rd', county: 'Worth', state: 'GA' });
    expect(p.path).toBe('address_county_state');
  });

  it('owner + city/state and owner + county/state choose the owner paths', () => {
    expect(planResolver({ owner: 'Carroll', city: 'Poulan', state: 'GA' }).path).toBe('owner_city_state');
    expect(planResolver({ owner: 'Carroll', county: 'Worth', state: 'GA' }).path).toBe('owner_county_state');
  });

  it('owner + street address (no locality) chooses owner_address (address available now)', () => {
    const p = planResolver({ owner: 'Carroll', address: '472 West Rd' });
    expect(p.path).toBe('owner_address');
    expect(p.addressAvailableNow).toBe(true);
  });

  it('partial address (no house number) + city/state', () => {
    const p = planResolver({ address: 'West Rd', city: 'Poulan', state: 'GA' });
    expect(p.path).toBe('partial_address_city_state');
  });

  it('no usable identifiers -> none', () => {
    expect(planResolver({ city: 'Poulan' }).path).toBe('none');
    expect(planResolver({}).path).toBe('none');
  });

  it('optional identifiers improve selection (adding county promotes a bare APN to a usable path)', () => {
    expect(planResolver({ apn: '00830-054-000' }).path).toBe('none'); // APN alone is not exact-usable
    expect(planResolver({ apn: '00830-054-000', county: 'Worth', state: 'GA' }).path).toBe('apn_locality');
  });

  it('preserves the original supplied fields', () => {
    const p = planResolver({ address: '472 West Rd', city: 'Poulan', state: 'GA', zip: '31781' });
    expect(p.original).toMatchObject({ address: '472 West Rd', zip: '31781' });
  });
});

describe('smallestNextIdentifier', () => {
  it('prefers the lightest disambiguator (ZIP before owner/APN/county)', () => {
    expect(smallestNextIdentifier({ address: '472 West Rd', city: 'Poulan', state: 'GA' })).toBe('ZIP code');
    expect(smallestNextIdentifier({ address: '472 West Rd', city: 'Poulan', state: 'GA', zip: '31781' })).toBe('owner name');
    expect(smallestNextIdentifier({ address: '472 West Rd', state: 'GA', zip: '31781', owner: 'X' })).toBe('APN (parcel number)');
  });
});

describe('smallestNextIdentifier — APN + county already supplied (Deal 32 regression)', () => {
  it('never demands LandPortal property id + FIPS when county/state + APN exist', () => {
    const answer = smallestNextIdentifier({
      address: 'OLD RIDGE RD, KINGSTON, TN 37763', city: 'KINGSTON', state: 'TN', zip: '37763',
      county: 'Roane County', apn: '073090 04200', owner: 'SACHAN DILEEP S',
    });
    expect(answer).not.toMatch(/property id/i);
    expect(answer).toMatch(/none/i);
    expect(answer).toMatch(/073090 04200/);
    expect(answer).toMatch(/official parcel-source confirmation/i);
  });

  it('asks for the county when only an APN is supplied', () => {
    expect(smallestNextIdentifier({ apn: '073090 04200' })).toBe('county');
  });
});
