import { describe, expect, it } from 'vitest';
import {
  discoverMarketplaceRecords,
  isMarketplaceRecordUrl,
  marketplaceDiscoveryQueries,
  MANUFACTURED_LABEL,
  parseIndexedRecordFacts,
} from './marketplace-indexed-discovery.js';

// Snippets shaped like the ones the governed keyless search returned live on
// 2026-09-02 for the Lake Butler, FL 32054 market (no property is hard-coded
// into application logic; these are test fixtures).
const ZILLOW_HIT = {
  title: '19414 NW 135th Ln, Lake Butler, FL 32054 | MLS #GC526344 | Zillow',
  url: 'https://www.zillow.com/homedetails/19414-NW-135th-Ln-Lake-Butler-FL-32054/60166965_zpid/',
  snippet: 'Sold on 04/15/2026 for $239,900. This 1860 square feet Mobile / Manufactured home has 3 bedrooms and 2 bathrooms. Built in 2002 on a 1 acre lot. It is located at 19414 NW 135th Ln, Lake Butler, FL.',
};
const REALTOR_HIT = {
  title: '19517 NW 137th Ln, Lake Butler, FL 32054 | realtor.com®',
  url: 'https://www.realtor.com/realestateandhomes-detail/19517-NW-137th-Ln_Lake-Butler_FL_32054_M60739-96887',
  snippet: 'View 32 photos for 19517 NW 137th Ln, Lake Butler, FL 32054, a 4 bed, 2 bath, 2,280 Sq. Ft. mobile home sold for $290,000 on Aug 6, 2025. Lot size 1.5 acres. Built in 1998.',
};

describe('indexed marketplace discovery (the transport after a challenged local browser)', () => {
  it('keeps only the provider\'s own property records, never boards, mirrors or other providers', () => {
    expect(isMarketplaceRecordUrl('zillow', ZILLOW_HIT.url)).toBe(true);
    expect(isMarketplaceRecordUrl('zillow', 'https://www.zillow.com/lake-butler-fl/sold/')).toBe(false);
    expect(isMarketplaceRecordUrl('zillow', 'https://www.trulia.com/home/19414-nw-135th-ln-lake-butler-fl-32054-60166965')).toBe(false);
    expect(isMarketplaceRecordUrl('realtor', REALTOR_HIT.url)).toBe(true);
    expect(isMarketplaceRecordUrl('realtor', 'https://www.realtor.com/realestateandhomes-search/Lake-Butler_FL/type-mobile/show-recently-sold')).toBe(false);
  });

  it('reads the facts the index publishes about a Zillow manufactured-home sale, including the actual record URL lineage', () => {
    const facts = parseIndexedRecordFacts(ZILLOW_HIT.title, ZILLOW_HIT.snippet);
    expect(facts.address).toBe('19414 NW 135th Ln, Lake Butler, FL 32054');
    expect(facts.status).toBe('sold');
    expect(facts.soldDate).toBe('2026-04-15');
    expect(facts.price).toBe(239_900);
    expect(facts.beds).toBe(3);
    expect(facts.baths).toBe(2);
    expect(facts.homeSizeSqft).toBe(1860);
    expect(facts.acres).toBe(1);
    expect(facts.yearBuilt).toBe(2002);
    expect(facts.homeType).toBe('manufactured');
  });

  it('reads a Realtor.com mobile-home sale with a written month date and a lot in acres', () => {
    const facts = parseIndexedRecordFacts(REALTOR_HIT.title, REALTOR_HIT.snippet);
    expect(facts.address).toBe('19517 NW 137th Ln, Lake Butler, FL 32054');
    expect(facts.status).toBe('sold');
    expect(facts.soldDate).toBe('2025-08-06');
    expect(facts.price).toBe(290_000);
    expect(facts.acres).toBe(1.5);
    expect(facts.homeSizeSqft).toBe(2280);
    expect(facts.homeType).toBe('manufactured');
  });

  it('recognises every provider label for manufactured housing', () => {
    for (const label of ['Mobile', 'Mobile Home', 'Manufactured Home', 'Manufactured Housing', 'Double Wide', 'double-wide', 'Mobile / Manufactured']) {
      expect(MANUFACTURED_LABEL.test(label)).toBe(true);
    }
    expect(MANUFACTURED_LABEL.test('Single Family Residence')).toBe(false);
    expect(MANUFACTURED_LABEL.test('Lot / Land')).toBe(false);
  });

  it('does not invent a sale from a listing snippet or a price from a query', () => {
    const facts = parseIndexedRecordFacts('0 NW 95th Ave, Lake Butler, FL 32054 | Zillow', '1 acre lot for sale in Lake Butler. Lot / Land.');
    expect(facts.status).toBe('active');
    expect(facts.price).toBeNull();
    expect(facts.soldDate).toBeNull();
    expect(facts.homeType).toBe('land');
  });

  it('asks the plain-English questions an operator would type, aimed at the subject street', () => {
    const queries = marketplaceDiscoveryQueries({ marketplace: 'zillow', board: 'sold', propertyType: 'manufactured', city: 'Lake Butler', state: 'FL', zip: '32054', localities: ['NW 137th Ln'] });
    expect(queries).toContain('zillow Lake Butler FL 32054 mobile home sold');
    expect(queries.some((query) => /NW 137th Ln/.test(query))).toBe(true);
    expect(marketplaceDiscoveryQueries({ marketplace: 'realtor', board: 'sold', propertyType: 'land' })).toEqual([]);
  });

  it('runs the governed search, dedups the same record across queries, and reports an unavailable transport as zero queries run', async () => {
    const calls: string[] = [];
    const search = async (query: string) => { calls.push(query); return [ZILLOW_HIT, { ...ZILLOW_HIT, url: `${ZILLOW_HIT.url}?utm=1` }, REALTOR_HIT]; };
    const found = await discoverMarketplaceRecords('zillow', ['q1', 'q2'], { search, nowIso: '2026-09-02T00:00:00.000Z' });
    expect(calls).toEqual(['q1', 'q2']);
    expect(found.records).toHaveLength(1);
    expect(found.records[0]).toMatchObject({ marketplace: 'zillow', url: ZILLOW_HIT.url, lineage: 'indexed_search', status: 'sold', price: 239_900 });
    const unavailable = await discoverMarketplaceRecords('zillow', ['q1'], { search: async () => { throw new Error('no transport'); } });
    expect(unavailable).toMatchObject({ records: [], queriesRun: 0 });
  });
});
