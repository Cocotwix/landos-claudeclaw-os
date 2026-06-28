import { describe, it, expect } from 'vitest';
import { fetchZillowComps, DEFAULT_ZILLOW_ACTOR, ZILLOW_ACTOR_ENV } from './zillow-comps.js';

const KEY = { APIFY_TOKEN: 't' };
const ok = (rows: unknown) => ({ ok: true, status: 200, json: async () => rows });
// Shape mirrors the live validated maxcopell/zillow-zip-search rows.
const rows = [
  { statusType: 'FOR_SALE', unformattedPrice: 135000, detailUrl: 'https://zillow.com/a', addressCity: 'Fayetteville', addressState: 'NC', addressZipcode: '28301', hdpData: { homeInfo: { homeType: 'SINGLE_FAMILY', daysOnZillow: 12, lotAreaValue: 43560, lotAreaUnit: 'sqft' } } },
  { statusType: 'RECENTLY_SOLD', unformattedPrice: 90000, detailUrl: 'https://zillow.com/b', addressCity: 'Fayetteville', addressState: 'NC', hdpData: { homeInfo: { homeType: 'LOT', dateSold: 1735689600000, lotAreaValue: 2, lotAreaUnit: 'acres' } } },
  { statusType: 'FOR_SALE', unformattedPrice: 0, detailUrl: 'https://zillow.com/c', hdpData: { homeInfo: {} } }, // skipped (no price)
];

describe('Zillow provider readiness — honest status labeling (root-cause fix)', () => {
  it('HTTP 403/402 (actor not authorized) => not_authorized, NOT not_configured (token is present)', async () => {
    for (const code of [402, 403]) {
      const r = await fetchZillowComps('30058', { env: KEY, fetchImpl: async () => ({ ok: false, status: code, json: async () => [] }) });
      expect(r.status).toBe('not_authorized');
      expect(r.note).toMatch(/not authorized/i);
      expect(r.note).toMatch(/token OK|subscrib|authoriz/i); // makes clear the token is fine
    }
  });
  it('missing Apify token => not_configured (distinct from not_authorized)', async () => {
    const r = await fetchZillowComps('30058', { env: {}, fetchImpl: async () => ok([]) });
    expect(r.status).toBe('not_configured');
  });
  it('missing/!5-digit ZIP => no_results (never not_configured)', async () => {
    expect((await fetchZillowComps('', { env: KEY })).status).toBe('no_results');
    expect((await fetchZillowComps('abc', { env: KEY })).status).toBe('no_results');
  });
  it('other non-OK HTTP => error (not mislabeled)', async () => {
    const r = await fetchZillowComps('30058', { env: KEY, fetchImpl: async () => ({ ok: false, status: 500, json: async () => [] }) });
    expect(r.status).toBe('error');
  });
});

describe('Zillow supplemental comps (validated contract, configurable actor)', () => {
  it('separates active vs sold, maps price/acres/ppa/url, skips priceless rows', async () => {
    const r = await fetchZillowComps('28301', { env: KEY, now: () => 't', fetchImpl: async () => ok(rows) });
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
    expect(s.status).toBe('sold');
    expect(s.acres).toBe(2); // acres unit kept
    expect(s.saleOrListDateIso).toBe('2025-01-01');
  });
  it('actor id is configurable via env (default otherwise)', async () => {
    let calledActor = '';
    await fetchZillowComps('28301', { env: { ...KEY, [ZILLOW_ACTOR_ENV]: 'someuser/custom-zillow' }, fetchImpl: async (url) => { calledActor = url; return ok([]); } });
    expect(calledActor).toContain('someuser~custom-zillow');
    let defUrl = '';
    await fetchZillowComps('28301', { env: KEY, fetchImpl: async (url) => { defUrl = url; return ok([]); } });
    expect(defUrl).toContain(DEFAULT_ZILLOW_ACTOR.replace('/', '~'));
  });
  it('no token => not_configured; no zip => no_results', async () => {
    expect((await fetchZillowComps('28301', { env: {} })).status).toBe('not_configured');
    expect((await fetchZillowComps('', { env: KEY })).status).toBe('no_results');
  });
});
