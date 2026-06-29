import { describe, it, expect } from 'vitest';
import {
  suggestAddresses, photonProvider, censusSuggestProvider, SuggestCache, MIN_SUGGEST_CHARS,
  type SuggestFetch,
} from './address-suggest.js';

function fetchReturning(body: unknown, ok = true): SuggestFetch {
  return async () => ({ ok, status: ok ? 200 : 500, json: async () => body });
}

const PHOTON_GILSTRAP = {
  features: [{
    geometry: { coordinates: [-83.76, 34.59] },
    properties: { housenumber: '388', street: 'Gilstrap Road', city: 'Cleveland', state: 'Georgia', postcode: '30528', county: 'White County', countrycode: 'US' },
  }],
};

const CENSUS_GILSTRAP = {
  result: { addressMatches: [{
    matchedAddress: '388 GILSTRAP RD, CLEVELAND, GA, 30528',
    addressComponents: { city: 'CLEVELAND', state: 'GA', zip: '30528' },
    coordinates: { x: -83.76, y: 34.59 },
    geographies: { Counties: [{ BASENAME: 'White' }] },
  }] },
};

describe('smart address search', () => {
  it('returns nothing below min characters (raw text still submittable)', async () => {
    const r = await suggestAddresses('38', { fetchImpl: fetchReturning(PHOTON_GILSTRAP), cache: new SuggestCache() });
    expect(r.suggestions).toHaveLength(0);
    expect(r.note).toMatch(new RegExp(`${MIN_SUGGEST_CHARS}`));
  });

  it('photon provider normalizes a US address suggestion', async () => {
    const out = await photonProvider().suggest('388 Gil', { limit: 5, fetchImpl: fetchReturning(PHOTON_GILSTRAP) });
    expect(out[0].label).toContain('388 Gilstrap Road');
    expect(out[0].state).toBe('GA');
    expect(out[0].county).toBe('White');
    expect(out[0].coordinates).toEqual({ lat: 34.59, lng: -83.76 });
  });

  it('census provider normalizes a US address suggestion with county', async () => {
    const out = await censusSuggestProvider().suggest('388 Gilstrap Rd Cleveland GA', { limit: 5, fetchImpl: fetchReturning(CENSUS_GILSTRAP) });
    expect(out[0].state).toBe('GA');
    expect(out[0].county).toBe('White');
    expect(out[0].zip).toBe('30528');
  });

  it('falls through to the next provider when the first returns nothing', async () => {
    const empty = photonProvider();
    const emptyFetch: SuggestFetch = async (url) =>
      url.includes('photon') ? { ok: true, status: 200, json: async () => ({ features: [] }) } : { ok: true, status: 200, json: async () => CENSUS_GILSTRAP };
    const r = await suggestAddresses('388 Gilstrap Rd Cleveland GA', {
      providers: [empty, censusSuggestProvider()], fetchImpl: emptyFetch, cache: new SuggestCache(),
    });
    expect(r.source).toMatch(/Census/);
    expect(r.suggestions[0].county).toBe('White');
  });

  it('caches results so repeated keystrokes do not refetch', async () => {
    const cache = new SuggestCache();
    let calls = 0;
    const counting: SuggestFetch = async () => { calls += 1; return { ok: true, status: 200, json: async () => PHOTON_GILSTRAP }; };
    await suggestAddresses('388 Gilstrap', { fetchImpl: counting, cache });
    const second = await suggestAddresses('388 Gilstrap', { fetchImpl: counting, cache });
    expect(calls).toBe(1);
    expect(second.cached).toBe(true);
  });

  it('returns an honest empty result (not an error) when all providers fail', async () => {
    const r = await suggestAddresses('zzz nowhere', { fetchImpl: fetchReturning({}, false), cache: new SuggestCache() });
    expect(r.suggestions).toHaveLength(0);
    expect(r.source).toBe('none');
    expect(r.note).toMatch(/submit the address as typed/i);
  });
});
