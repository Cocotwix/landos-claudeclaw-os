import { describe, expect, it } from 'vitest';
import {
  fetchRealtorLandComps,
  indexedRecordsToRealtorComps,
  realtorHomeTypeLabel,
  verifyRealtorMarket,
  type RealtorBrowserLike,
} from './realtor-land-comps.js';

// Realtor.com answered the managed browser with an HTTP 429 holding page
// ("This is taking longer than usual … unblockrequest@realtor.com") that
// renders no cards. The old lane verified that page as the subject's market
// from the ZIP in the URL and reported "none": a transport failure recorded
// as an empty market. These tests pin the repaired shared path.
describe('Realtor.com holding page is a transport outcome, never an empty market', () => {
  const RECORD_URL = 'https://www.realtor.com/realestateandhomes-detail/19517-NW-137th-Ln_Lake-Butler_FL_32054_M60739-96887';
  const hit = { title: '19517 NW 137th Ln, Lake Butler, FL 32054 | realtor.com', url: RECORD_URL, snippet: 'a 4 bed, 2 bath, 2,280 Sq. Ft. mobile home sold for $290,000 on Aug 6, 2025. Lot size 1.5 acres. Built in 1998.' };
  const HOLDING_PAGE = 'This is taking longer than usual\n\nPlease refresh the page to try again\n\nRefresh page\n\nIf this issue persists, please copy the Request_ID below and contact unblockrequest@realtor.com.';
  function holdingBrowser(status: number, visited: string[] = []): RealtorBrowserLike {
    return {
      async newPage() {
        return {
          async goto(url: string) { visited.push(url); return { status: () => status }; },
          async evaluate<T>(fn: (() => T) | string): Promise<T> {
            const text = String(fn);
            if (text.includes('taking longer than usual')) return /taking longer than usual/i.test(HOLDING_PAGE) as T;
            if (text.includes('property-card')) return [] as T;
            return '' as T;
          },
        };
      },
      async close() {},
    };
  }

  it('recognises the HTTP 429 holding page, never verifies the market from the URL, and continues at once through the indexed transport keeping the actual record URL', async () => {
    const queries: string[] = [];
    const visited: string[] = [];
    const started = Date.now();
    const result = await fetchRealtorLandComps(
      { address: '19554 NW 137th Ln', city: 'Lake Butler', state: 'FL', zip: '32054', county: 'Bradford', mode: 'sold', propertyType: 'manufactured', localities: ['NW 137th Ln'] },
      { force: true, connect: async () => holdingBrowser(429, visited), settleMs: 0, indexedSearch: async (query) => { queries.push(query); return [hit]; } },
    );
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.status).toBe('retrieved');
    expect(result.comps).toHaveLength(1);
    expect(result.comps[0]).toMatchObject({ url: RECORD_URL, status: 'sold', price: 290_000, soldDate: '2025-08-06', acres: 1.5, beds: 4, baths: 2, homeSizeSqft: 2280, yearBuilt: 1998, lineage: 'indexed_search', propertyClass: 'improved' });
    expect(result.comps[0].homeType).toMatch(/mobile/i);
    expect(result.routes[0]).toMatchObject({ blocked: true, marketVerified: false, cardsFound: 0 });
    expect(result.routes[0].outcome).toMatch(/HTTP 429/);
    expect(result.note).not.toMatch(/verified as this subject's market/);
    expect(queries.some((q) => /mobile home sold/.test(q))).toBe(true);
    // One challenged route, then straight to the indexed transport: no retry of the challenge.
    expect(visited).toHaveLength(1);
  });

  it('reports blocked, not "none", when the indexed transport is unavailable', async () => {
    const result = await fetchRealtorLandComps(
      { city: 'Lake Butler', state: 'FL', zip: '32054', mode: 'sold', propertyType: 'manufactured' },
      { force: true, connect: async () => holdingBrowser(429), settleMs: 0, indexedSearch: async () => { throw new Error('down'); } },
    );
    expect(result.status).toBe('blocked');
    expect(result.note).toMatch(/indexed-search transport was unavailable/);
  });

  it('never proves a market from the search URL alone', () => {
    expect(verifyRealtorMarket({ city: 'Lake Butler', state: 'FL', zip: '32054', mode: 'sold' }, '', []).valid).toBe(false);
  });

  it('recognises Mobile, Mobile Home, Manufactured Home, Manufactured Housing and Double Wide labels', () => {
    for (const label of ['Mobile', 'Mobile Home', 'Manufactured Home', 'Manufactured Housing', 'Double Wide']) {
      expect(realtorHomeTypeLabel(`Property type: ${label}`, true)).toMatch(new RegExp(label, 'i'));
    }
    expect(realtorHomeTypeLabel('3 bed 2 bath single family', true)).toBe('residential');
    expect(realtorHomeTypeLabel('1.5 acres lot', false)).toBeNull();
  });

  it('keeps manufactured records out of the land board and land records out of the manufactured board', () => {
    const base = { marketplace: 'realtor' as const, query: 'q', lineage: 'indexed_search' as const, retrievedAt: 'now', beds: null, baths: null, homeSizeSqft: null, yearBuilt: null };
    const records = [
      { ...base, url: RECORD_URL, title: hit.title, snippet: hit.snippet, address: '19517 NW 137th Ln, Lake Butler, FL 32054', price: 290_000, status: 'sold' as const, soldDate: '2025-08-06', acres: 1.5, beds: 4, baths: 2, homeSizeSqft: 2280, yearBuilt: 1998, homeType: 'manufactured' as const },
      { ...base, url: `${RECORD_URL}-lot`, title: 'lot', snippet: 'lot', address: '0 NW 95th Ave, Lake Butler, FL 32054', price: 31_500, status: 'sold' as const, soldDate: null, acres: 1, homeType: 'land' as const },
    ];
    expect(indexedRecordsToRealtorComps(records, { state: 'FL', mode: 'sold', propertyType: 'manufactured' }).map((c) => c.address)).toEqual(['19517 NW 137th Ln, Lake Butler, FL 32054']);
    expect(indexedRecordsToRealtorComps(records, { state: 'FL', mode: 'sold', propertyType: 'land' }).map((c) => c.address)).toEqual(['0 NW 95th Ave, Lake Butler, FL 32054']);
  });
});
