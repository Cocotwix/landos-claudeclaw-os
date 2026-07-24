import { describe, it, expect } from 'vitest';
import { zillowLandUrl, zillowSearchRoutes, normalizeZillowListings, fetchZillowLandComps, type RawZillowListing } from './zillow-land-comps.js';

describe('zillowLandUrl', () => {
  it('builds a public Lots/Land locality URL (geographic, not ZIP)', () => {
    expect(zillowLandUrl('LEHIGH ACRES', 'FL')).toBe('https://www.zillow.com/lehigh-acres-fl/land/');
    expect(zillowLandUrl('Fort Myers', 'fl')).toBe('https://www.zillow.com/fort-myers-fl/land/');
  });
});

describe('normalizeZillowListings', () => {
  const raw: RawZillowListing[] = [
    { address: '5413 Lee ST, LEHIGH ACRES, FL 33971', price: 31000, acres: 0.33, url: 'u1' },
    { address: '1013 Wells AVE, LEHIGH ACRES, FL 33972', price: 24500, acres: 0.5, url: 'u2' },
    { address: '5413 Lee ST, LEHIGH ACRES, FL 33971', price: 31000, acres: 0.33, url: 'u1' }, // dup
    { address: 'Big Ranch Rd, FL', price: 350000, acres: 6, url: 'u3' }, // out of price + acre band
    { address: null, price: 20000, acres: 0.25, url: 'u4' }, // no address
  ];
  it('normalizes, filters to acreage band, sanitizes price, dedupes by address', () => {
    const out = normalizeZillowListings(raw, 0.25);
    expect(out).toHaveLength(2);
    expect(out[0].address).toContain('5413 Lee ST');
    expect(out[0].pricePerAcre).toBe(Math.round(31000 / 0.33));
    expect(out.every((c) => c.source === 'Zillow')).toBe(true);
  });
});

describe('fetchZillowLandComps (injected, no real browser)', () => {
  const chrome = () => ({ path: 'C:/chrome.exe', checked: [] });
  const rawListings: RawZillowListing[] = [{ address: '1810 Wells AVE, LEHIGH ACRES, FL 33972', price: 29497, acres: 0.5, url: 'z' }];
  function fakeConnect(listings: RawZillowListing[], blocked = false) {
    return async () => ({
      async newPage() {
        return {
          async setViewport() {},
          async goto() {},
          async evaluate(fn: unknown) {
            const src = String(fn);
            if (src.includes('press and hold') || src.includes('captcha')) return blocked as never;
            if (src.includes('property-card')) return { listings, nextData: null } as never;
            return undefined as never;
          },
        };
      },
      async close() {},
    });
  }

  it('returns retrieved comps when the disposable session yields land listings', async () => {
    const r = await fetchZillowLandComps({ city: 'Lehigh Acres', state: 'FL', subjectAcres: 0.25 }, {
      force: true, resolveChrome: chrome, spawn: () => ({ kill() {} }), connect: fakeConnect(rawListings) as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1,
    });
    expect(r.status).toBe('retrieved');
    expect(r.comps).toHaveLength(1);
    expect(r.routeTried).toBe('https://www.zillow.com/lehigh-acres-fl/land/');
  });

  it('rejects Canadian, wrong-state, and unlocatable rows from a misresolved search', async () => {
    const rows: RawZillowListing[] = [
      ...rawListings,
      { address: '327 S 3rd St E, Magrath, AB T0K 1J0 ROYAL', price: 75_000, acres: 0.5, url: 'ca' },
      { address: '20 Wrong Market Rd, Albany, GA 31701', price: 55_000, acres: 0.4, url: 'ga' },
      { address: '4500 64th Ave', price: 65_000, acres: 0.4, url: 'unknown' },
    ];
    const r = await fetchZillowLandComps({ city: 'Lehigh Acres', state: 'FL', subjectAcres: 0.25 }, {
      force: true, resolveChrome: chrome, spawn: () => ({ kill() {} }), connect: fakeConnect(rows) as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1,
    });
    expect(r.comps.map((comp) => comp.address)).toEqual(['1810 Wells AVE, LEHIGH ACRES, FL 33972']);
    expect(r.note).toMatch(/rejected 3 row/i);
  });

  it('reports blocked (never throws) when anti-bot fires with no listings', async () => {
    const r = await fetchZillowLandComps({ city: 'Lehigh Acres', state: 'FL', subjectAcres: 0.25 }, {
      force: true, resolveChrome: chrome, spawn: () => ({ kill() {} }), connect: fakeConnect([], true) as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1,
    });
    expect(r.status).toBe('blocked');
    expect(r.comps).toHaveLength(0);
  });

  it('is disabled without a locality (no city/state)', async () => {
    const r = await fetchZillowLandComps({ subjectAcres: 0.25 }, { force: true, resolveChrome: chrome, connect: (async () => null) as never });
    expect(r.status).toBe('disabled');
  });

  it('uses coordinates then city/county locality and retries a wrong resolved market', async () => {
    const input = { lat: 26.61, lng: -81.64, zip: '33971', city: 'Lehigh Acres', county: 'Lee', state: 'FL', subjectAcres: 0.25 };
    expect(zillowSearchRoutes(input).map((route) => route.kind)).toEqual(['coordinates', 'locality']);
    let current = '';
    const connect = async () => ({
      async newPage() {
        return {
          async setViewport() {},
          async goto(url: string) { current = url; },
          async evaluate(fn: unknown) {
            const src = String(fn);
            if (src.includes('press and hold')) return false as never;
            if (src.includes('property-card')) return {
              listings: current.includes('/homes/for_sale/')
                ? [{ address: '327 S 3rd St E, Magrath, AB T0K 1J0', price: 75_000, acres: 0.4, url: 'wrong' }]
                : rawListings,
              nextData: null,
            } as never;
            if (src.includes('document.title')) return { url: current, text: current.includes('/33971/') ? 'Land for sale ZIP 33971 FL' : 'Taber Municipal District AB' } as never;
            return undefined as never;
          },
        };
      },
      async close() {},
    });
    const result = await fetchZillowLandComps(input, { force: true, resolveChrome: chrome, spawn: () => ({ kill() {} }), connect: connect as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1 });
    expect(result.status).toBe('retrieved');
    expect(result.routeTried).toContain('/lehigh-acres-fl/');
    expect(result.note).toMatch(/automatically correcting 1 wrong-geography route/i);
  });
});
