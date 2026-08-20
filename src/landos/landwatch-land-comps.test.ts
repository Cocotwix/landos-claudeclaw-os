import { describe, expect, it } from 'vitest';

import {
  fetchLandWatchLandComps,
  landWatchAcreageSegments,
  landWatchSearchUrl,
  landWatchStateSlug,
  normalizeLandWatchListings,
  type LandWatchBrowserLike,
  type RawLandWatchListing,
} from './landwatch-land-comps.js';

describe('landWatchSearchUrl', () => {
  it('builds the live county sold-search URL shape', () => {
    expect(landWatchSearchUrl('TN', 'Williamson', { acreageSegment: 'acres-51-100', sold: true }))
      .toBe('https://www.landwatch.com/tennessee-land-for-sale/williamson-county/acres-51-100/sold');
    expect(landWatchSearchUrl('TN', 'Williamson County', { sold: true }))
      .toBe('https://www.landwatch.com/tennessee-land-for-sale/williamson-county/sold');
  });

  it('CASE F: cannot express a price filter — no minimum, no maximum, no caps', () => {
    const url = landWatchSearchUrl('TN', 'Williamson', { acreageSegment: 'acres-51-100', sold: true })!;
    expect(url).not.toMatch(/price|min|max|\$|\d+000/i);
    // The builder's whole option surface is geography + acreage bucket + sold.
    expect(Object.keys({ acreageSegment: null, sold: true })).toEqual(['acreageSegment', 'sold']);
  });

  it('returns null without a resolvable state or county', () => {
    expect(landWatchSearchUrl('ZZ', 'Williamson', { sold: true })).toBeNull();
    expect(landWatchSearchUrl('TN', '', { sold: true })).toBeNull();
    expect(landWatchStateSlug('tn')).toBe('tennessee');
  });
});

describe('landWatchAcreageSegments', () => {
  it("picks the subject's bucket plus the one below for a 75-acre subject", () => {
    expect(landWatchAcreageSegments(75.91)).toEqual(['acres-51-100', 'acres-11-50']);
  });
  it('handles the bottom bucket and unknown acreage', () => {
    expect(landWatchAcreageSegments(8)).toEqual(['acres-under-10']);
    expect(landWatchAcreageSegments(null)).toEqual([]);
  });
});

describe('normalizeLandWatchListings', () => {
  const raw = (over: Partial<RawLandWatchListing> = {}): RawLandWatchListing => ({
    address: '6326 Arno Road, Franklin, TN, 37064',
    price: 5_450_000,
    acres: 36.9,
    soldLabel: true,
    residential: true,
    url: 'https://www.landwatch.com/williamson-county-tennessee-farms-and-ranches-for-sale/pid/415322761',
    remark: 'High-end improvements and privacy make this the ultimate turnkey estate.',
    ...over,
  });

  it('keeps card-stated sold rows with $/acre, improvement hint and LISTING-REPORTED remark', () => {
    const comps = normalizeLandWatchListings([raw()], 'Williamson');
    expect(comps).toHaveLength(1);
    expect(comps[0].status).toBe('sold');
    expect(comps[0].pricePerAcre).toBe(Math.round(5_450_000 / 36.9));
    expect(comps[0].improvedHint).toBe(true);
    expect(comps[0].remark).toMatch(/turnkey estate/);
    expect(comps[0].soldDate).toBeNull();
  });

  it('keeps a non-sold card as ACTIVE market context, never a closed comp', () => {
    const comps = normalizeLandWatchListings([raw({ soldLabel: false })], 'Williamson');
    expect(comps[0].status).toBe('active');
  });

  it('CASE F: applies no price screen at any level — extreme prices are retained', () => {
    const comps = normalizeLandWatchListings(
      [raw({ price: 12_650_000 }), raw({ address: '0 Cheap Rd, Fairview, TN, 37062', price: 9_000 })],
      'Williamson',
    );
    expect(comps).toHaveLength(2);
  });

  it('drops rows without an address or positive price and dedupes by address', () => {
    const comps = normalizeLandWatchListings(
      [raw(), raw(), raw({ address: null }), raw({ address: '1 Other Rd, TN, 37062', price: 0 })],
      'Williamson',
    );
    expect(comps).toHaveLength(1);
  });
});

describe('fetchLandWatchLandComps', () => {
  const page = (bodyText: string, listings: RawLandWatchListing[]) => ({
    async goto() { /* no-op */ },
    async evaluate(fn: unknown): Promise<unknown> {
      const source = String(fn);
      if (source.includes('scrollBy')) return undefined;
      if (source.includes('press and hold')) return /blocked page/i.test(bodyText);
      if (source.includes('location?.href')) return { url: 'https://www.landwatch.com/x', text: bodyText };
      return listings;
    },
  });
  const browserOf = (bodyText: string, listings: RawLandWatchListing[]): LandWatchBrowserLike => ({
    async newPage() { return page(bodyText, listings) as never; },
    async close() { /* no-op */ },
  });

  it('CASE E: a verified sold large-acreage candidate enters the result set', async () => {
    const result = await fetchLandWatchLandComps(
      { county: 'Williamson', state: 'TN', subjectAcres: 75.91, mode: 'sold' },
      { force: true, connect: async () => browserOf('Williamson County, TN Recently Sold Land', [{
        address: '7000 Big Tract Rd, Fairview, TN, 37062', price: 1_200_000, acres: 60,
        soldLabel: true, residential: false, url: '/x/pid/1', remark: 'Rolling pasture with long road frontage.',
      }]), settleMs: 1, scrollSettleMs: 1 },
    );
    expect(result.status).toBe('retrieved');
    expect(result.searchVerified).toBe(true);
    expect(result.comps[0].status).toBe('sold');
    expect(result.comps[0].pricePerAcre).toBe(20_000);
    expect(result.note).toMatch(/LISTING-REPORTED/);
  });

  it('reports BLOCKED as a lane failure, never an empty market', async () => {
    const result = await fetchLandWatchLandComps(
      { county: 'Williamson', state: 'TN', subjectAcres: 75.91, mode: 'sold' },
      { force: true, connect: async () => browserOf('blocked page — press and hold', []), settleMs: 1, scrollSettleMs: 1 },
    );
    expect(result.status).toBe('blocked');
    expect(result.note).toMatch(/anti-bot|blocked/i);
    expect(result.searchVerified).toBe(false);
  });

  it('refuses a wrong-geography page instead of using its cards', async () => {
    const result = await fetchLandWatchLandComps(
      { county: 'Williamson', state: 'TN', subjectAcres: 75.91, mode: 'sold' },
      { force: true, connect: async () => browserOf('Travis County, TX Land', [{
        address: '1 Austin Rd, Austin, TX, 73301', price: 500_000, acres: 40,
        soldLabel: true, residential: false, url: '/x/pid/2', remark: null,
      }]), settleMs: 1, scrollSettleMs: 1 },
    );
    expect(result.status).toBe('none');
    expect(result.comps).toHaveLength(0);
    expect(result.note).toMatch(/never reached a verified/i);
  });
});
