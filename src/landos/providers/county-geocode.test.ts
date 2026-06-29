import { describe, it, expect } from 'vitest';
import { deriveCounty } from './county-geocode.js';

// Census onelineaddress geocoder response shape (trimmed). coordinates: x=lng, y=lat.
const censusBody = {
  result: { addressMatches: [{
    coordinates: { x: -84.1023, y: 33.7115 },
    addressComponents: { state: 'GA', zip: '30058' },
    geographies: { Counties: [{ BASENAME: 'DeKalb', STATE: '13', COUNTY: '089' }] },
  }] },
};
const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b });

describe('county-geocode — supporting coords for imagery (never identity)', () => {
  it('returns county/fips AND lat/lng from the Census match', async () => {
    const r = await deriveCounty({ address: '2123 Panola Rd', city: 'Lithonia', state: 'GA' }, { fetchImpl: async () => ok(censusBody) });
    expect(r?.county).toBe('DeKalb');
    expect(r?.fips).toBe('13089');
    expect(r?.lat).toBeCloseTo(33.7115, 3); // y
    expect(r?.lng).toBeCloseTo(-84.1023, 3); // x
  });
  it('null coords when the match has none (still returns county)', async () => {
    const noCoord = { result: { addressMatches: [{ addressComponents: { state: 'GA' }, geographies: { Counties: [{ BASENAME: 'DeKalb', STATE: '13', COUNTY: '089' }] } }] } };
    const r = await deriveCounty({ address: 'x', state: 'GA' }, { fetchImpl: async () => ok(noCoord) });
    expect(r?.county).toBe('DeKalb');
    expect(r?.lat).toBeNull();
    expect(r?.lng).toBeNull();
  });
});
