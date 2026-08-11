import { describe, expect, it } from 'vitest';
import {
  fetchRealtorLandComps,
  normalizeRealtorListings,
  realtorCompsToCandidates,
  realtorSearchRoutes,
  type RealtorBrowserLike,
  type RawRealtorListing,
} from './realtor-land-comps.js';

describe('Realtor.com land comps', () => {
  it('builds independent address, parcel and geography routes for sold research', () => {
    const routes = realtorSearchRoutes({
      address: '9490 Elk Lake Rd', city: 'Williamsburg', state: 'MI', zip: '49690',
      county: 'Grand Traverse', apn: '28-01-001-001-00', mode: 'sold',
    });
    expect(routes.map((route) => route.kind)).toEqual(expect.arrayContaining(['address', 'parcel', 'zip', 'locality', 'county']));
    expect(routes.every((route) => route.url.startsWith('https://www.realtor.com/'))).toBe(true);
    expect(routes.some((route) => /show-recently-sold/.test(route.url))).toBe(true);
  });

  it('requires the card itself to state a dated sold event', () => {
    const base: RawRealtorListing = {
      address: '100 Forest Rd, Williamsburg, MI 49690', price: 180_000, acres: 55,
      url: 'https://www.realtor.com/realestateandhomes-detail/100-Forest-Rd',
      status: 'Sold on Jul 1, 2025', soldDate: 'Jul 1, 2025',
    };
    const rows = normalizeRealtorListings([
      base,
      { ...base, address: '200 Forest Rd, Williamsburg, MI 49690', status: 'Off market', soldDate: null },
    ], 60, 'sold');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'Realtor.com', status: 'sold', soldDate: '2025-07-01', propertyClass: 'vacant_land' });
  });

  it('retains ordered listing photos and marks improved property as context data', () => {
    const rows = normalizeRealtorListings([{
      address: '300 Forest Rd, Williamsburg, MI 49690', price: 625_000, acres: 60,
      url: 'https://www.realtor.com/realestateandhomes-detail/300-Forest-Rd',
      status: 'For sale', description: 'Three bedroom home on wooded acreage', homeType: 'single family',
      homeSizeSqft: 1_800, beds: 3, baths: 2, utilities: ['Well', 'Septic'], accessClues: ['Gravel access'], features: ['Wooded'],
      thumbnailUrl: 'https://ap.rdcpix.com/hero.webp',
      photoUrls: ['https://ap.rdcpix.com/hero.webp', 'https://ap.rdcpix.com/drive.webp'],
    }], 60, 'active');
    expect(rows[0]).toMatchObject({
      propertyClass: 'improved', homeSizeSqft: 1_800, beds: 3, baths: 2,
      utilities: ['Well', 'Septic'], accessClues: ['Gravel access'], features: ['Wooded'],
    });
    expect(rows[0].photoUrls).toEqual(['https://ap.rdcpix.com/hero.webp', 'https://ap.rdcpix.com/drive.webp']);
    expect(realtorCompsToCandidates(rows)[0]).toMatchObject({
      provider: 'Realtor.com', lane: 'active', priceKind: 'list', compClass: 'residential',
      thumbnailUrl: 'https://ap.rdcpix.com/hero.webp',
    });
  });

  it('reports a blocked lane without fabricating a zero-result search', async () => {
    const browser: RealtorBrowserLike = {
      async newPage() {
        return {
          async goto() {},
          async evaluate<T>(fn: (() => T) | string): Promise<T> {
            const text = String(fn);
            return (text.includes('captcha') ? true : []) as T;
          },
        };
      },
      async close() {},
    };
    const result = await fetchRealtorLandComps(
      { city: 'Williamsburg', state: 'MI', mode: 'sold' },
      { force: true, connect: async () => browser, settleMs: 0 },
    );
    expect(result.status).toBe('blocked');
    expect(result.comps).toEqual([]);
    expect(result.note).toMatch(/blocked/i);
  });
});
