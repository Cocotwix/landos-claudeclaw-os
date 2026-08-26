import { describe, expect, it } from 'vitest';
import { matchLandosProperty, gevGeocode } from './geocode.js';

// Mirrors the real alias shape: one row per known address form of a card —
// active input (often a map/parcel label), deal title (carries locality), and
// the assessor situs street (often bare, no house number, for vacant land).
const CARDS = [
  { id: 79, active_input_address: 'Map 042 Parcel 123', lat: 35.982, lng: -87.126 },
  { id: 79, active_input_address: 'Map 042 Parcel 123, Fairview, TN', lat: 35.982, lng: -87.126 },
  { id: 79, active_input_address: 'KINGWOOD BLVD', lat: 35.982, lng: -87.126 },
  { id: 12, active_input_address: '1454 Onionville Rd, Sterling, NY 13156', lat: 43.33, lng: -76.65 },
  { id: 5, active_input_address: 'No coords parcel', lat: null, lng: null },
];

describe('GEV keyless geocode', () => {
  it('resolves a known LandOS vacant-land subject by street segment', () => {
    expect(matchLandosProperty('0 Kingwood Blvd, Fairview, TN 37062', CARDS)?.id).toBe(79);
    expect(matchLandosProperty('0 Kingwood Blvd', CARDS)?.id).toBe(79);
    expect(matchLandosProperty('0 kingwood blvd, fairview tn', CARDS)?.id).toBe(79);
  });

  it('rejects a contradicting city/state and never matches a card without coordinates', () => {
    expect(matchLandosProperty('0 Kingwood Blvd, Nashville, TN', CARDS)).toBeNull();
    expect(matchLandosProperty('No coords parcel', CARDS)).toBeNull();
    expect(matchLandosProperty('Fairview, TN', CARDS)).toBeNull(); // a place, not a subject street
  });

  it('orders the LandOS canonical subject ahead of external geocoder results', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify([
      { lat: '36.0', lon: '-87.0', display_name: 'Kingwood Boulevard, Somewhere Else', type: 'road', boundingbox: ['35.9', '36.1', '-87.1', '-86.9'] },
    ]), { status: 200 })) as unknown as typeof fetch;
    const result = await gevGeocode('0 Kingwood Blvd, Fairview, TN 37062', { fetchImpl, propertyRows: () => CARDS });
    expect(result.candidates[0]).toMatchObject({ source: 'landos', propertyCardId: expect.any(Number) });
    expect(result.candidates[0].label).toContain('LandOS subject');
    expect(result.candidates.some((candidate) => candidate.source === 'nominatim')).toBe(true);
  });

  it('returns ordinary external geocoding for a normal place and honest empties', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify([
      { lat: '35.9829', lon: '-87.1214', display_name: 'Fairview, Williamson County, Tennessee', type: 'town', boundingbox: ['35.93', '36.02', '-87.2', '-87.05'] },
    ]), { status: 200 })) as unknown as typeof fetch;
    const found = await gevGeocode('Fairview, TN', { fetchImpl, propertyRows: () => CARDS });
    expect(found.candidates[0]).toMatchObject({ source: 'nominatim', lat: 35.9829 });
    expect(found.candidates[0].boundingBox).toHaveLength(4);

    const emptyFetch = (async () => new Response('[]', { status: 200 })) as unknown as typeof fetch;
    const empty = await gevGeocode('zzzz nowhere at all', { fetchImpl: emptyFetch, propertyRows: () => CARDS });
    expect(empty.candidates).toEqual([]);
    expect((await gevGeocode('   ', { fetchImpl: emptyFetch, propertyRows: () => CARDS })).candidates).toEqual([]);
  });

  it('degrades a failed external geocoder to LandOS-only results, never a throw', async () => {
    const failingFetch = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    const result = await gevGeocode('0 Kingwood Blvd, Fairview, TN', { fetchImpl: failingFetch, propertyRows: () => CARDS });
    expect(result.candidates.every((candidate) => candidate.source === 'landos')).toBe(true);
  });
});
