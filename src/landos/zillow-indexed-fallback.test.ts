import { describe, expect, it } from 'vitest';
import { fetchZillowLandComps, parseZillowRecordText, resetZillowChallengeMemory } from './zillow-land-comps.js';

// A challenged local Zillow board is a transport outcome. The lane records it
// and continues at once through the indexed transport: no wait, no operator
// hand-off, no notification, no retry of the challenge.
describe('a challenged local Zillow board continues at once through the indexed transport', () => {
  const RECORD_URL = 'https://www.zillow.com/homedetails/19414-NW-135th-Ln-Lake-Butler-FL-32054/60166965_zpid/';
  const hit = { title: '19414 NW 135th Ln, Lake Butler, FL 32054 | Zillow', url: RECORD_URL, snippet: 'Sold on 04/15/2026 for $239,900. This 1860 square feet Mobile / Manufactured home has 3 bedrooms and 2 bathrooms on a 1 acre lot.' };
  const RECORD_PAGE = {
    blocked: false, title: '19414 NW 135TH Lane, Lake Butler, FL 32054 | Zillow',
    text: 'Closed\nSee all 37 photos\n$239,900\n19414 NW 135TH Lane, Lake Butler, FL 32054\n3\nbeds\n2\nbaths\n1,860\nsqft\nMobile Home\nBuilt in 2002\n1 Acres Lot\nPrice history\n4/15/2026\nSold\n$239,900',
    lat: 30.0041, lng: -82.2735, remarks: 'Large 3 bedroom 2 bath doublewide mobile home on one acre.',
  };
  /** A session whose board is challenged but whose property-record page opens (or not). */
  function challengedBoardSession(recordPage: typeof RECORD_PAGE | { blocked: true }) {
    const visited: string[] = [];
    let onRecord = false;
    return {
      visited,
      async newPage() {
        return {
          async setViewport() {},
          async goto(url: string) { visited.push(url); onRecord = /homedetails/.test(url); },
          async evaluate(fn: unknown) {
            const src = String(fn);
            if (src.includes('remarksEl')) return (onRecord ? recordPage : { blocked: true, title: '', text: '', lat: null, lng: null, remarks: null }) as never;
            if (src.includes('press and hold') || src.includes('captcha')) return true as never;
            if (src.includes('property-card')) return { listings: [], nextData: null } as never;
            return undefined as never;
          },
        };
      },
      async close() {},
    };
  }

  it('reads the facts a Zillow record page states in its own words', () => {
    expect(parseZillowRecordText(RECORD_PAGE)).toEqual({
      address: '19414 NW 135TH Lane, Lake Butler, FL 32054', price: 239_900, status: 'sold', soldDate: '2026-04-15', acres: 1,
      beds: 3, baths: 2, homeSizeSqft: 1860, yearBuilt: 2002, homeType: 'Mobile Home',
    });
  });

  it('records the challenge, runs the plain-English search, opens the discovered Zillow record once, and keeps its actual URL with no wait and no hand-off', async () => {
    resetZillowChallengeMemory();
    const session = challengedBoardSession(RECORD_PAGE);
    const queries: string[] = [];
    const started = Date.now();
    const r = await fetchZillowLandComps({ address: '19554 NW 137th Ln', city: 'Lake Butler', state: 'FL', zip: '32054', lat: 30.0015, lng: -82.2721, mode: 'sold', propertyType: 'manufactured', radiusMiles: 5, dateWindowMonths: 24, localities: ['NW 137th Ln'] }, {
      force: true, session: session as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1,
      indexedSearch: async (query) => { queries.push(query); return [hit]; },
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(r.status).toBe('retrieved');
    expect(r.comps).toHaveLength(1);
    expect(r.comps[0]).toMatchObject({ url: RECORD_URL, status: 'sold', price: 239_900, soldDate: '2026-04-15', acres: 1, lat: 30.0041, lng: -82.2735, lineage: 'page', homeType: 'Mobile Home', yearBuilt: 2002, homeSizeSqft: 1860 });
    expect(r.comps[0].description).toMatch(/doublewide/);
    expect(queries.some((q) => /NW 137th Ln/.test(q))).toBe(true);
    expect(r.routes.some((route) => route.blocked)).toBe(true);
    expect(r.routes.find((route) => route.label === 'indexed search')?.qualifying).toBe(1);
    // The record page was opened exactly once; the challenged board was never re-requested.
    expect(session.visited.filter((url) => url === RECORD_URL)).toHaveLength(1);
    expect(r.searchProof?.routesAttempted.some((line) => /indexed search/.test(line))).toBe(true);
  });

  it('keeps the index facts and the actual URL when the record page is challenged too, and dedups a repeated hit', async () => {
    resetZillowChallengeMemory();
    const r = await fetchZillowLandComps({ city: 'Lake Butler', state: 'FL', zip: '32054', mode: 'sold', propertyType: 'manufactured', lat: 30.0015, lng: -82.2721 }, {
      force: true, session: challengedBoardSession({ blocked: true }) as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1,
      indexedSearch: async () => [hit, { ...hit, url: `${RECORD_URL}?x=1` }],
    });
    expect(r.status).toBe('retrieved');
    expect(r.comps).toHaveLength(1);
    expect(r.comps[0]).toMatchObject({ url: RECORD_URL, lineage: 'indexed_search', status: 'sold', price: 239_900, soldDate: '2026-04-15' });
  });

  it('keeps a sold land record on the land board and never a manufactured one', async () => {
    resetZillowChallengeMemory();
    const land = { title: '0 NW County Road 235, Lake Butler, FL 32054 | Zillow', url: 'https://www.zillow.com/homedetails/NW-County-Road-235-Lake-Butler-FL-32054/104075893_zpid/', snippet: 'Lot / Land sold on 07/31/2026 for $132,000. 33 acres.' };
    const r = await fetchZillowLandComps({ city: 'Lake Butler', state: 'FL', zip: '32054', mode: 'sold' }, {
      force: true, session: challengedBoardSession({ blocked: true }) as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1,
      indexedSearch: async () => [hit, land],
    });
    expect(r.comps.map((c) => c.url)).toEqual([land.url]);
    expect(r.comps[0]).toMatchObject({ status: 'sold', price: 132_000, acres: 33, soldDate: '2026-07-31', homeType: 'Lot / Land' });
  });

  it('reports blocked, not "none", when the indexed transport is unavailable too', async () => {
    resetZillowChallengeMemory();
    const r = await fetchZillowLandComps({ city: 'Lake Butler', state: 'FL', zip: '32054', mode: 'sold' }, {
      force: true, session: challengedBoardSession({ blocked: true }) as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1,
      indexedSearch: async () => { throw new Error('search transport down'); },
    });
    expect(r.status).toBe('blocked');
    expect(r.note).toMatch(/indexed-search transport was unavailable/);
  });

  it('has no operator notification, window surfacing, or challenge wait in the module at all', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('./zillow-land-comps.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/notify\.sh|notifyOperator|defaultZillowChallengeHandoff|setWindowOnScreen|execFile/);
  });
});
