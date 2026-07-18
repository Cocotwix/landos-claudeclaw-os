import { describe, it, expect } from 'vitest';
import { parseRedfinCityPath, redfinLandFilterUrl, normalizeRedfinListings, fetchRedfinLandComps, type RawRedfinListing } from './redfin-land-comps.js';

describe('redfin URL + path helpers', () => {
  it('parses the /city/{id}/{ST}/{Name} path from search-suggestion hrefs', () => {
    const hrefs = 'https://www.redfin.com/school/1/FL/x https://www.redfin.com/city/23728/FL/Lehigh-Acres https://www.redfin.com/neighborhood/2/FL/y';
    expect(parseRedfinCityPath(hrefs)).toBe('/city/23728/FL/Lehigh-Acres');
    expect(parseRedfinCityPath('no city here')).toBeNull();
  });
  it('builds the Lots/Land filter URL', () => {
    expect(redfinLandFilterUrl('/city/23728/FL/Lehigh-Acres')).toBe('https://www.redfin.com/city/23728/FL/Lehigh-Acres/filter/property-type=land');
    expect(redfinLandFilterUrl('/city/23728/FL/Lehigh-Acres', { sold: true })).toBe('https://www.redfin.com/city/23728/FL/Lehigh-Acres/filter/property-type=land,include=sold');
  });
});

describe('normalizeRedfinListings', () => {
  const raw: RawRedfinListing[] = [
    { address: '900 Somewhere St, LEHIGH ACRES, FL 33971', price: 22000, acres: 0.28, sqftLot: null, residential: false, url: 'r1' },
    { address: '901 Home Ave, LEHIGH ACRES, FL 33972', price: 240000, acres: 0.25, sqftLot: null, residential: true, url: 'r2' }, // residential home → dropped
    { address: '902 Lot Rd, LEHIGH ACRES, FL 33971', price: 20000, acres: null, sqftLot: 10890, residential: false, url: 'r3' }, // sqft→acres
    { address: '903 Big Ranch, FL 33999', price: 350000, acres: 6, sqftLot: null, residential: false, url: 'r4' }, // out of band + price
    { address: '900 Somewhere St, LEHIGH ACRES, FL 33971', price: 22000, acres: 0.28, sqftLot: null, residential: false, url: 'r1' }, // dup
  ];
  it('drops residential homes, converts sqft lot to acres, filters band, dedupes', () => {
    const out = normalizeRedfinListings(raw, 0.25);
    expect(out.map((c) => c.address)).toEqual(['900 Somewhere St, LEHIGH ACRES, FL 33971', '902 Lot Rd, LEHIGH ACRES, FL 33971']);
    expect(out[1].acres).toBeCloseTo(0.25, 2); // 10890 / 43560
    expect(out.every((c) => c.source === 'Redfin')).toBe(true);
  });
});

describe('fetchRedfinLandComps (injected, no real browser)', () => {
  const chrome = () => ({ path: 'C:/chrome.exe', checked: [] });
  const HREFS = 'https://www.redfin.com/city/23728/FL/Lehigh-Acres https://www.redfin.com/neighborhood/1/FL/x';
  const listings: RawRedfinListing[] = [{ address: '900 Somewhere St, LEHIGH ACRES, FL 33971', price: 22000, acres: 0.28, sqftLot: null, residential: false, url: 'r1' }];
  function fakeConnect(hrefs: string, list: RawRedfinListing[], blocked = false) {
    return async () => ({
      async newPage() {
        return {
          async setViewport() {},
          async goto() {},
          async evaluate(fn: unknown) {
            const src = String(fn);
            if (src.includes('scrollBy')) return undefined as never;
            if (src.includes('search-box-input')) return true as never;            // FOCUS_AND_SET_SEARCH
            if (src.includes('press and hold')) return blocked as never;           // IS_BLOCKED
            if (src.includes('HomeCardContainer')) return list as never;           // EXTRACT_REDFIN
            if (src.includes('/city/')) return hrefs as never;                     // READ_SUGGESTION_HREFS
            return undefined as never;
          },
        };
      },
      async close() {},
    });
  }

  it('retrieves land comps via the search box → resolved city → land page', async () => {
    const r = await fetchRedfinLandComps({ city: 'Lehigh Acres', state: 'FL', subjectAcres: 0.25 }, {
      force: true, resolveChrome: chrome, spawn: () => ({ kill() {} }), connect: fakeConnect(HREFS, listings) as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1,
    });
    expect(r.status).toBe('retrieved');
    expect(r.comps).toHaveLength(1);
    expect(r.routeTried).toBe('https://www.redfin.com/city/23728/FL/Lehigh-Acres/filter/property-type=land');
  });

  it('uses the public sold-land filter and marks otherwise-ambiguous rows sold', async () => {
    const r = await fetchRedfinLandComps({ city: 'Lehigh Acres', state: 'FL', subjectAcres: 0.25, mode: 'sold' }, {
      force: true, resolveChrome: chrome, spawn: () => ({ kill() {} }), connect: fakeConnect(HREFS, listings) as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1,
    });
    expect(r.filtersUsed).toContain('include=sold');
    expect(r.routeTried).toContain('include=sold');
    expect(r.comps[0]?.status).toBe('sold');
  });

  it('reports none when the search dropdown surfaces no city page', async () => {
    const r = await fetchRedfinLandComps({ city: 'Nowhere', state: 'FL', subjectAcres: 0.25 }, {
      force: true, resolveChrome: chrome, spawn: () => ({ kill() {} }), connect: fakeConnect('no city here', listings) as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1,
    });
    expect(r.status).toBe('none');
  });

  it('reports blocked (never throws) when anti-bot fires with no listings', async () => {
    const r = await fetchRedfinLandComps({ city: 'Lehigh Acres', state: 'FL', subjectAcres: 0.25 }, {
      force: true, resolveChrome: chrome, spawn: () => ({ kill() {} }), connect: fakeConnect(HREFS, [], true) as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1,
    });
    expect(r.status).toBe('blocked');
  });

  it('is disabled without a locality', async () => {
    const r = await fetchRedfinLandComps({ subjectAcres: 0.25 }, { force: true, resolveChrome: chrome, connect: (async () => null) as never });
    expect(r.status).toBe('disabled');
  });
});
