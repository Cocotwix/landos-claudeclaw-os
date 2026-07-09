import { describe, it, expect } from 'vitest';
import {
  parseAcreageText,
  parsePriceText,
  parseListingStatus,
  zillowStatusType,
  normalizeComps,
  parseZillowStructured,
  parseLandPortalCompRows,
  type ExtractedComp,
} from './comp-extraction.js';

describe('parseAcreageText', () => {
  it('parses whole, fractional, and abbreviated acres', () => {
    expect(parseAcreageText('5.12 acres')).toBe(5.12);
    expect(parseAcreageText('5 acres lot')).toBe(5);
    expect(parseAcreageText('0.5 acre')).toBe(0.5);
    expect(parseAcreageText('10 ac')).toBe(10);
  });
  it('converts a square-foot lot to acres', () => {
    expect(parseAcreageText('9,583 sqft lot')).toBe(0.22);
    expect(parseAcreageText('43,560 sq ft lot')).toBe(1);
  });
  it('never mistakes a ZIP or bare number for acreage', () => {
    expect(parseAcreageText('Lehigh Acres, FL 33971')).toBeNull();
    expect(parseAcreageText('$45,000')).toBeNull();
    expect(parseAcreageText('')).toBeNull();
  });
});

describe('parsePriceText / parseListingStatus / zillowStatusType', () => {
  it('parses a dollar amount', () => {
    expect(parsePriceText('$45,000')).toBe(45000);
    expect(parsePriceText('$1,250,000')).toBe(1250000);
    expect(parsePriceText('no price')).toBeNull();
  });
  it('classifies listing status from text', () => {
    expect(parseListingStatus('Sold on 1/2/2024')).toBe('sold');
    expect(parseListingStatus('Pending')).toBe('pending');
    expect(parseListingStatus('For sale · vacant land')).toBe('active');
    expect(parseListingStatus('vacant land')).toBe('unknown');
  });
  it('maps Zillow structured status types', () => {
    expect(zillowStatusType('FOR_SALE')).toBe('active');
    expect(zillowStatusType('RECENTLY_SOLD')).toBe('sold');
    expect(zillowStatusType('PENDING')).toBe('pending');
    expect(zillowStatusType(undefined)).toBe('unknown');
  });
});

describe('normalizeComps', () => {
  const base = (o: Partial<ExtractedComp>): ExtractedComp => ({ address: null, price: 20000, acres: 0.3, pricePerAcre: null, status: 'active', date: null, url: null, source: 'Zillow', ...o });
  it('bands by acreage, sanity-checks price, dedupes, computes price/acre', () => {
    const rows = [
      base({ address: 'A', price: 30000, acres: 0.3 }),
      base({ address: 'A', price: 30000, acres: 0.3 }), // dup
      base({ address: 'B', price: 500000, acres: 0.3 }), // price too high
      base({ address: 'C', price: 30000, acres: 9 }),    // out of band
    ];
    const out = normalizeComps(rows, 0.3);
    expect(out).toHaveLength(1);
    expect(out[0].address).toBe('A');
    expect(out[0].pricePerAcre).toBe(100000);
  });
});

describe('parseZillowStructured (__NEXT_DATA__)', () => {
  const nextData = JSON.stringify({
    props: { pageProps: { searchPageState: { cat1: { searchResults: { listResults: [
      { unformattedPrice: 25000, address: '5413 Lee St, Lehigh Acres, FL 33971', detailUrl: '/homedetails/x/123_zpid/', statusType: 'FOR_SALE', hdpData: { homeInfo: { lotAreaValue: 0.33, lotAreaUnit: 'acres' } } },
      { price: '$30,000', address: '1013 Wells Ave, Lehigh Acres, FL', detailUrl: 'https://www.zillow.com/homedetails/y', statusType: 'RECENTLY_SOLD', hdpData: { homeInfo: { lotAreaValue: 10890, lotAreaUnit: 'sqft' } } },
      { unformattedPrice: 500000, address: 'Big Ranch Rd', statusType: 'FOR_SALE', hdpData: { homeInfo: { lotAreaValue: 50, lotAreaUnit: 'acres' } } },
    ] } } } } },
  });
  it('extracts in-band land comps with status, acres, price/acre, and absolute URLs', () => {
    const comps = parseZillowStructured(nextData, 0.3);
    expect(comps).toHaveLength(2); // the 50-acre / $500k row is filtered
    const lee = comps.find((c) => c.address?.startsWith('5413 Lee'))!;
    expect(lee.status).toBe('active');
    expect(lee.acres).toBe(0.33);
    expect(lee.pricePerAcre).toBe(Math.round(25000 / 0.33));
    expect(lee.url).toBe('https://www.zillow.com/homedetails/x/123_zpid/'); // relative → absolute
    const wells = comps.find((c) => c.address?.startsWith('1013 Wells'))!;
    expect(wells.status).toBe('sold');
    expect(wells.acres).toBe(0.25); // 10890 sqft → 0.25 ac
  });
  it('returns [] on malformed JSON, never throws', () => {
    expect(parseZillowStructured('{not json', 0.3)).toEqual([]);
    expect(parseZillowStructured('{}', 0.3)).toEqual([]);
  });
});

describe('parseLandPortalCompRows (free visible similar sales)', () => {
  it('structures visible sold comp rows without any paid action', () => {
    const rows = ['$45,000 Acres: 5.12', '$12,000 Acres: 3.0'];
    const comps = parseLandPortalCompRows(rows, 5);
    expect(comps.length).toBe(2);
    expect(comps[0].source).toBe('LandPortal');
    expect(comps[0].status).toBe('sold');
    expect(comps[0].pricePerAcre).toBe(Math.round(45000 / 5.12));
  });

  it('keeps curated rural comps that a small-lot band would wrongly drop', () => {
    // Subject is small (0.98 ac) but LandPortal shows large curated similar sales.
    const rows = ['$189,500 Acres: 7.67', '$200,000 Acres: 8.82'];
    const comps = parseLandPortalCompRows(rows, 0.98);
    expect(comps.length).toBe(2); // NOT dropped by the Zillow/Redfin small-lot band
    expect(comps.map((c) => c.pricePerAcre)).toEqual([Math.round(189500 / 7.67), Math.round(200000 / 8.82)]);
  });
  it('handles empty/garbage safely', () => {
    expect(parseLandPortalCompRows(null, 5)).toEqual([]);
    expect(parseLandPortalCompRows(['no price here'], 5)).toEqual([]);
  });
});
