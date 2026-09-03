import { describe, expect, it } from 'vitest';
import { enrichManufacturedHomeRows, firstCoordinates, selectManufacturedHomeRows, subjectStreetLocalities, type ManufacturedHomeRow } from './manufactured-home-enrichment.js';
import { parseRedfinRecordFacts } from './redfin-land-comps.js';

describe('manufactured-home evidence enrichment', () => {
  it('derives the subject street as an operator would type it', () => {
    expect(subjectStreetLocalities('19554 NW 137th Ln')).toEqual(['NW 137th Ln']);
    expect(subjectStreetLocalities('19554 NW 137th Ln, Lake Butler, FL 32054')).toEqual(['NW 137th Ln']);
    expect(subjectStreetLocalities('Parcel 023.003-02')).toEqual([]);
    expect(subjectStreetLocalities(null)).toEqual([]);
  });

  it('resolves lane coordinates from the freshest usable read, never from a zero pair', () => {
    expect(firstCoordinates([{ lat: null, lng: null }, { lat: 0, lng: 0 }, { lat: 30.0015, lng: -82.2721 }])).toEqual({ lat: 30.0015, lng: -82.2721 });
    expect(firstCoordinates([null, { lat: undefined, lng: undefined }])).toBeNull();
  });

  it('reads coordinates, the last closed sale, beds/baths, APN and home type off a Redfin record page', () => {
    const html = [
      '<meta name="description" content="4 beds, 2 baths, 2280 sq. ft. mobile/manufactured home located at 19517 NW 137th Ln, Lake Butler, FL 32054 sold for $290,000 on Aug 6, 2025.">',
      '{"geo":{"latitude":30.0007747,"longitude":-82.2707754},"yearBuilt":1998,"numberOfBedrooms":4,"numberOfBathroomsTotal":2}',
      '\\"lastSoldPrice\\":290000,\\"lastSoldDate\\":1754463600000,\\"lotSize\\":65340,\\"fips\\":\\"12007\\",\\"apn\\":\\"00083A02900\\"',
    ].join('\n');
    expect(parseRedfinRecordFacts(html)).toEqual({
      lat: 30.0007747, lng: -82.2707754, lastSoldPrice: 290_000, lastSoldDate: '2025-08-06', beds: 4, baths: 2, apn: '00083A02900', homeTypeLabel: 'mobile/manufactured home', lotAcres: 1.5,
    });
  });

  it('recovers location and sale date from the record page, falls back to the geocode cache, restates distance, and stays bounded', async () => {
    const rows: ManufacturedHomeRow[] = [
      { source: 'Redfin', address: '19517 NW 137th Ln, Lake Butler, FL 32054', url: 'https://www.redfin.com/FL/Lake-Butler/19517-NW-137th-Ln-32054/home/119640639', price: 290_000, saleDate: null, lat: null, lng: null },
      { source: 'Realtor.com', address: '19414 NW 135th Ln, Lake Butler, FL 32054', url: 'https://www.realtor.com/realestateandhomes-detail/x', price: 239_900, saleDate: '2026-04-15', lat: null, lng: null },
      { source: 'Zillow', address: 'Already located', url: null, price: 1, saleDate: '2026-01-01', lat: 30.1, lng: -82.3 },
    ];
    const detailCalls: string[] = [];
    const geocoded: string[] = [];
    const result = await enrichManufacturedHomeRows(rows, { lat: 30.0015, lng: -82.2721 }, {
      readRedfinDetail: async (url) => { detailCalls.push(url); return { status: 'retrieved', record: { lat: 30.0007747, lng: -82.2707754, lastSoldPrice: 290_000, lastSoldDate: '2025-08-06', beds: 4, baths: 2, apn: '00083A02900', homeTypeLabel: 'mobile/manufactured home', lotAcres: 1.5 } }; },
      geocode: async (addresses) => { geocoded.push(...addresses); },
      readGeocode: (address) => (/19414/.test(address) ? { lat: 30.0041, lng: -82.2735, provider: 'census' } : null),
    });
    // Phase 1 locates the whole board through the geocode cache; phase 2 reads
    // the record page only for rows the screen can use that still lack a
    // closed date or a provider-exact point.
    expect(geocoded).toEqual(['19517 NW 137th Ln, Lake Butler, FL 32054', '19414 NW 135th Ln, Lake Butler, FL 32054']);
    expect(detailCalls).toEqual([rows[0].url]);
    expect(result).toEqual({ attempted: 1, located: 2, dated: 1 });
    expect(rows[0]).toMatchObject({ lat: 30.0007747, lng: -82.2707754, saleDate: '2025-08-06', beds: 4, apn: '00083A02900', homeType: 'mobile/manufactured home' });
    expect(rows[0].enrichment).toEqual(['coordinates: Redfin record page', 'sale date: Redfin record page', 'acreage: Redfin record page']);
    expect(rows[0].acres).toBe(1.5);
    expect(rows[1]).toMatchObject({ lat: 30.0041, lng: -82.2735 });
    for (const row of rows) expect(typeof row.distanceMiles).toBe('number');
    expect(rows[0].distanceMiles as number).toBeLessThan(0.2);
  });

  it('retains located sales inside the radius nearest first plus a few stamped-incomplete records, never the whole board', () => {
    const rows: ManufacturedHomeRow[] = [
      { address: 'near', price: 290_000, saleDate: '2025-08-06', lat: 1, lng: 1, distanceMiles: 0.1 },
      { address: 'far', price: 355_000, saleDate: '2025-01-01', lat: 1, lng: 1, distanceMiles: 11.4 },
      { address: 'mid', price: 239_900, saleDate: '2026-04-15', lat: 1, lng: 1, distanceMiles: 0.22 },
      ...Array.from({ length: 8 }, (_, i) => ({ address: `unlocated ${i}`, price: 100_000 + i, saleDate: null, lat: null, lng: null, distanceMiles: null })),
    ];
    const selection = selectManufacturedHomeRows(rows, { radiusMiles: 5, maxWithinRadius: 10, maxIncomplete: 5 });
    expect(selection).toMatchObject({ withinRadius: 2, beyondRadius: 1, incomplete: 8, notRetained: 4 });
    expect(selection.retained.map((row) => row.address)).toEqual(['near', 'mid', 'unlocated 0', 'unlocated 1', 'unlocated 2', 'unlocated 3', 'unlocated 4']);
    expect(selection.retained[0].incomplete).toBeUndefined();
    expect(selection.retained[2].incomplete).toEqual(['coordinates', 'saleDate']);
  });
});

describe('record-page reads and incomplete retention favour the subject street and ZIP', () => {
  it('reads a same-street row the geocode cannot place before rows elsewhere in the county, and retains it first among incomplete rows', async () => {
    const rows: ManufacturedHomeRow[] = [
      { address: '2763 Mortimer Way, Starke, FL 32091', url: 'https://www.redfin.com/FL/Starke/a/home/1', price: 355_000, saleDate: null, lat: null, lng: null },
      { address: '9282 SW 148th Pl, Lake Butler, FL 32054', url: 'https://www.redfin.com/FL/Lake-Butler/b/home/2', price: 275_000, saleDate: null, lat: null, lng: null },
      { address: '19517 NW 137th Ln, Lake Butler, FL 32054', url: 'https://www.redfin.com/FL/Lake-Butler/c/home/3', price: 290_000, saleDate: null, lat: null, lng: null },
    ];
    const detailCalls: string[] = [];
    await enrichManufacturedHomeRows(rows, { lat: 30.0015, lng: -82.2721, street: 'NW 137th Ln', zip: '32054' }, {
      readRedfinDetail: async (url) => { detailCalls.push(url); return { status: 'blocked', record: undefined }; },
      geocode: async () => {}, readGeocode: () => null, max: 2,
    });
    expect(detailCalls).toEqual(['https://www.redfin.com/FL/Lake-Butler/c/home/3', 'https://www.redfin.com/FL/Lake-Butler/b/home/2']);
    const selection = selectManufacturedHomeRows(rows, { maxIncomplete: 1, subject: { street: 'NW 137th Ln', zip: '32054' } });
    expect(selection.retained.map((row) => row.address)).toEqual(['19517 NW 137th Ln, Lake Butler, FL 32054']);
  });
});
