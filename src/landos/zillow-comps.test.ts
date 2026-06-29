import { describe, it, expect } from 'vitest';
import { fetchZillowComps, buildZillowSearchUrls, DEFAULT_ZILLOW_ACTOR, ZILLOW_ACTOR_ENV } from './zillow-comps.js';

const KEY = { APIFY_TOKEN: 't' };
const CO = { lat: 33.71, lng: -84.1, zip: '30058' }; // Lithonia GA area
const ok = (rows: unknown) => ({ ok: true, status: 200, json: async () => rows });
// Shape mirrors live maxcopell/zillow-scraper rows (same fields as the prior actor).
const rows = [
  { statusType: 'FOR_SALE', unformattedPrice: 135000, detailUrl: 'https://zillow.com/a', addressCity: 'Lithonia', addressState: 'GA', addressZipcode: '30058', latLong: { latitude: 33.7, longitude: -84.1 }, hdpData: { homeInfo: { homeType: 'SINGLE_FAMILY', daysOnZillow: 12, lotAreaValue: 43560, lotAreaUnit: 'sqft' } } },
  { statusType: 'RECENTLY_SOLD', unformattedPrice: 90000, detailUrl: 'https://zillow.com/b', addressCity: 'Lithonia', addressState: 'GA', hdpData: { homeInfo: { homeType: 'LOT', dateSold: 1735689600000, lotAreaValue: 2, lotAreaUnit: 'acres' } } },
  { statusType: 'FOR_SALE', unformattedPrice: 0, detailUrl: 'https://zillow.com/c', hdpData: { homeInfo: {} } }, // skipped (no price)
];

describe('Zillow search URL construction (maxcopell/zillow-scraper contract)', () => {
  it('builds for-sale + recently-sold mapBounds searchQueryState URLs from coordinates', () => {
    const u = buildZillowSearchUrls(33.71, -84.1, 5);
    expect(u.active).toContain('/homes/for_sale/?searchQueryState=');
    expect(u.sold).toContain('/homes/recently_sold/?searchQueryState=');
    const sqs = JSON.parse(decodeURIComponent(u.sold.split('searchQueryState=')[1]));
    expect(sqs.mapBounds).toMatchObject({ west: expect.any(Number), east: expect.any(Number), south: expect.any(Number), north: expect.any(Number) });
    expect(sqs.filterState.rs.value).toBe(true); // recently-sold filter
  });
});

describe('Zillow provider readiness — honest status labeling', () => {
  it('HTTP 403/402 (actor not authorized) => not_authorized, NOT not_configured (token is present)', async () => {
    for (const code of [402, 403]) {
      const r = await fetchZillowComps(CO, { env: KEY, fetchImpl: async () => ({ ok: false, status: code, json: async () => [] }) });
      expect(r.status).toBe('not_authorized');
      expect(r.note).toMatch(/not authorized/i);
      expect(r.note).toMatch(/token OK|subscrib|authoriz/i);
    }
  });
  it('missing Apify token => not_configured (distinct from not_authorized)', async () => {
    expect((await fetchZillowComps(CO, { env: {}, fetchImpl: async () => ok([]) })).status).toBe('not_configured');
  });
  it('missing coordinates => no_results (never not_configured)', async () => {
    expect((await fetchZillowComps({ zip: '30058' }, { env: KEY })).status).toBe('no_results');
    expect((await fetchZillowComps({}, { env: KEY })).status).toBe('no_results');
  });
  it('other non-OK HTTP => error (not mislabeled)', async () => {
    expect((await fetchZillowComps(CO, { env: KEY, fetchImpl: async () => ({ ok: false, status: 500, json: async () => [] }) })).status).toBe('error');
  });
});

describe('Zillow supplemental comps (validated schema mapping, configurable actor)', () => {
  it('separates active vs sold, maps price/acres/ppa/url/date, skips priceless rows', async () => {
    const r = await fetchZillowComps(CO, { env: KEY, now: () => 't', fetchImpl: async () => ok(rows) });
    expect(r.status).toBe('collected');
    expect(r.active).toHaveLength(1);
    expect(r.sold).toHaveLength(1);
    const a = r.active[0];
    expect(a.status).toBe('active');
    expect(a.price).toBe(135000);
    expect(a.acres).toBe(1); // 43560 sqft -> 1 acre
    expect(a.pricePerAcre).toBe(135000);
    expect(a.sourceUrl).toBe('https://zillow.com/a');
    expect(a.daysOnMarket).toBe(12);
    const s = r.sold[0];
    expect(s.status).toBe('sold'); // active never labeled sold
    expect(s.acres).toBe(2);
    expect(s.saleOrListDateIso).toBe('2025-01-01');
  });
  it('actor id is configurable via env; default is maxcopell/zillow-scraper', async () => {
    let calledActor = '';
    await fetchZillowComps(CO, { env: { ...KEY, [ZILLOW_ACTOR_ENV]: 'someuser/custom-zillow' }, fetchImpl: async (url) => { calledActor = url; return ok([]); } });
    expect(calledActor).toContain('someuser~custom-zillow');
    let defUrl = '';
    await fetchZillowComps(CO, { env: KEY, fetchImpl: async (url) => { defUrl = url; return ok([]); } });
    expect(defUrl).toContain(DEFAULT_ZILLOW_ACTOR.replace('/', '~'));
    expect(DEFAULT_ZILLOW_ACTOR).toBe('maxcopell/zillow-scraper'); // NOT the bad zip-search actor
  });
  it('sends searchUrls + extractionMethod to the actor (new contract)', async () => {
    let body = '';
    await fetchZillowComps(CO, { env: KEY, fetchImpl: async (_u, init) => { body = init.body; return ok([]); } });
    const parsed = JSON.parse(body);
    expect(parsed.searchUrls).toHaveLength(2); // for-sale + recently-sold
    expect(parsed.extractionMethod).toBe('PAGINATION_WITH_ZOOM_IN');
  });
});
