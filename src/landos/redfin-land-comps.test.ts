import { describe, it, expect } from 'vitest';
import { parseRedfinCityPath, redfinLandFilterUrl, redfinSearchQueries, normalizeRedfinListings, fetchRedfinLandComps, parseRedfinListingDetail, verifyRedfinResolvedGeography, type RawRedfinListing } from './redfin-land-comps.js';

describe('redfin URL + path helpers', () => {
  it('parses the /city/{id}/{ST}/{Name} path from search-suggestion hrefs', () => {
    const hrefs = 'https://www.redfin.com/school/1/FL/x https://www.redfin.com/city/23728/FL/Lehigh-Acres https://www.redfin.com/neighborhood/2/FL/y';
    expect(parseRedfinCityPath(hrefs)).toBe('/city/23728/FL/Lehigh-Acres');
    expect(parseRedfinCityPath('no city here')).toBeNull();
  });
  it('builds the Lots/Land filter URL', () => {
    expect(redfinLandFilterUrl('/city/23728/FL/Lehigh-Acres')).toBe('https://www.redfin.com/city/23728/FL/Lehigh-Acres/filter/property-type=land');
    expect(redfinLandFilterUrl('/city/23728/FL/Lehigh-Acres', { sold: true })).toBe('https://www.redfin.com/city/23728/FL/Lehigh-Acres/filter/property-type=land,include=sold-1yr');
    expect(redfinLandFilterUrl('/city/23728/FL/Lehigh-Acres', { sold: true, dateWindowMonths: 24 })).toContain('include=sold-2yr');
  });

  it('builds a usable parcel query when intake has APN/county/state but no city or ZIP', () => {
    const queries = redfinSearchQueries({
      address: '1488 Liberty Hwy',
      apn: '4068-00-37-1227',
      county: 'Pickens',
      state: 'SC',
      subjectAcres: 10.3,
    });
    expect(queries.some((query) => query.query === 'Pickens County, SC')).toBe(true);
    expect(queries.some((query) => query.kind === 'parcel')).toBe(true);
    expect(queries.find((query) => query.kind === 'parcel')?.query).toContain('4068-00-37-1227');
  });
});

describe('normalizeRedfinListings', () => {
  const raw: RawRedfinListing[] = [
    { address: '900 Somewhere St, LEHIGH ACRES, FL 33971', price: 22000, acres: 0.28, sqftLot: null, residential: false, url: 'r1' },
    { address: '901 Home Ave, LEHIGH ACRES, FL 33972', price: 240000, acres: 0.25, sqftLot: null, residential: true, url: 'r2' }, // residential home → RETAINED, tagged
    { address: '902 Lot Rd, LEHIGH ACRES, FL 33971', price: 20000, acres: null, sqftLot: 10890, residential: false, url: 'r3' }, // sqft→acres
    { address: '903 Big Ranch, FL 33999', price: 350000, acres: 6, sqftLot: null, residential: false, url: 'r4' }, // large + expensive: RETAINED
    { address: '900 Somewhere St, LEHIGH ACRES, FL 33971', price: 22000, acres: 0.28, sqftLot: null, residential: false, url: 'r1' }, // dup
  ];
  it('retains and tags improved sales, converts sqft lot to acres, dedupes — no price or acreage filter', () => {
    // BUSINESS RULES: an improved (beds/baths) card is retained as tagged
    // market evidence, and price/acreage never gate candidate entry.
    const out = normalizeRedfinListings(raw, 0.25);
    expect(out.map((c) => c.address)).toEqual([
      '900 Somewhere St, LEHIGH ACRES, FL 33971',
      '901 Home Ave, LEHIGH ACRES, FL 33972',
      '902 Lot Rd, LEHIGH ACRES, FL 33971',
      '903 Big Ranch, FL 33999',
    ]);
    expect(out[1].homeType).toContain('Residential');
    expect(out[2].acres).toBeCloseTo(0.25, 2); // 10890 / 43560
    expect(out[0].homeType ?? null).toBeNull();
    expect(out.every((c) => c.source === 'Redfin')).toBe(true);
  });

  it('accepts a stated sold row without an explicit date, keeping the date when present', () => {
    // A sold candidate must still STATE it is sold, but a missing printed date
    // no longer erases it — that requirement manufactured false zero results.
    const out = normalizeRedfinListings([
      { address: '1 Verified Land Rd, Central, SC 29630', price: 500000, acres: 48.25, sqftLot: null, residential: false, url: 'r1', status: 'Sold on May 2, 2025', thumbnailUrl: 'https://img.test/land.jpg' },
      { address: '415 Silver Creek Rd, Central, SC 29630', price: 1500000, acres: 120, sqftLot: null, residential: false, url: 'r2', status: 'Sold' },
      { address: '2 Ambiguous Rd, Central, SC 29630', price: 400000, acres: 30, sqftLot: null, residential: false, url: 'r3', status: null },
    ], 52.84, 'sold');
    expect(out.map((c) => c.address)).toEqual([
      '1 Verified Land Rd, Central, SC 29630',
      '415 Silver Creek Rd, Central, SC 29630',
    ]);
    expect(out[0]).toMatchObject({
      soldDate: '2025-05-02',
      thumbnailUrl: 'https://img.test/land.jpg',
    });
    expect(out[1].soldDate ?? null).toBeNull();
  });
});

describe('fetchRedfinLandComps (injected, no real browser)', () => {
  const chrome = () => ({ path: 'C:/chrome.exe', checked: [] });
  const HREFS = 'https://www.redfin.com/city/23728/FL/Lehigh-Acres https://www.redfin.com/neighborhood/1/FL/x';
  const listings: RawRedfinListing[] = [{ address: '900 Somewhere St, LEHIGH ACRES, FL 33971', price: 22000, acres: 0.28, sqftLot: null, residential: false, url: 'r1' }];
  function fakeConnect(hrefs: string, list: RawRedfinListing[], blocked = false) {
    return async () => ({
      async newPage() {
        return {
          async setViewport() {},
          async goto() {},
          async evaluate(fn: unknown) {
            const src = String(fn);
            if (src.includes('scrollBy')) return undefined as never;
            if (src.includes('search-box-input')) return true as never;            // FOCUS_AND_SET_SEARCH
            if (src.includes('press and hold')) return blocked as never;           // IS_BLOCKED
            if (src.includes('HomeCardContainer')) return list as never;           // EXTRACT_REDFIN
            if (src.includes('/city/')) return hrefs as never;                     // READ_SUGGESTION_HREFS
            return undefined as never;
          },
        };
      },
      async close() {},
    });
  }

  it('retrieves land comps via the search box → resolved city → land page', async () => {
    const r = await fetchRedfinLandComps({ city: 'Lehigh Acres', state: 'FL', subjectAcres: 0.25 }, {
      force: true, connect: fakeConnect(HREFS, listings) as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1,
    });
    expect(r.status).toBe('retrieved');
    expect(r.comps).toHaveLength(1);
    expect(r.routeTried).toBe('https://www.redfin.com/city/23728/FL/Lehigh-Acres/filter/property-type=land');
  });

  it('lets a verified sold-only board carry an unlabelled row, and retains the board as lineage', () => {
    // Redfin renders the "SOLD <date>" banner outside the leaf card element on
    // part of a board, so real closed sales arrive with no status text. The
    // board's own `include=sold-<window>` filter is what makes them sold, and
    // that board and filter are retained on the record so the inference is
    // auditable. The sale DATE is never inferred.
    return fetchRedfinLandComps({ city: 'Lehigh Acres', state: 'FL', subjectAcres: 0.25, mode: 'sold' }, {
      force: true, connect: fakeConnect(HREFS, listings) as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1,
    }).then((r) => {
      expect(r.filtersUsed).toContain('include=sold');
      expect(r.routeTried).toContain('include=sold');
      expect(r.comps).toHaveLength(1);
      expect(r.comps[0].status).toBe('sold');
      expect(r.comps[0].statusFromBoardFilter).toBe(true);
      expect(r.comps[0].soldDate ?? null).toBeNull();
      expect(r.comps[0].soldBoardUrl).toContain('include=sold-');
      expect(r.comps[0].soldBoardFilter).toContain('include=sold');
      expect(r.note).toContain('printed no status banner');
    });
  });

  it('never lets a mixed or unverified board confer sold status', () => {
    // The same unlabelled row, judged without a verified sold-only board, says
    // nothing about having closed and must not become a transaction.
    expect(normalizeRedfinListings(listings, 0.25, 'sold')).toHaveLength(0);
    expect(normalizeRedfinListings(listings, 0.25, 'sold', 'land', { soldBoardVerified: false })).toHaveLength(0);
    const onVerified = normalizeRedfinListings(listings, 0.25, 'sold', 'land', {
      soldBoardVerified: true, boardUrl: 'https://www.redfin.com/zipcode/33971/filter/property-type=land,include=sold-1yr', boardFilter: 'property-type=land, include=sold',
    });
    expect(onVerified).toHaveLength(1);
    expect(onVerified[0].statusFromBoardFilter).toBe(true);
  });

  it('accepts a sold-board row only when the row itself states sold', async () => {
    const soldListings = listings.map((listing) => ({ ...listing, status: 'Sold on May 2, 2025' }));
    const r = await fetchRedfinLandComps({ city: 'Lehigh Acres', state: 'FL', subjectAcres: 0.25, mode: 'sold' }, {
      force: true, connect: fakeConnect(HREFS, soldListings) as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1,
    });
    expect(r.comps).toHaveLength(1);
    expect(r.comps[0].status).toBe('sold');
    expect(r.comps[0].soldDate).toBe('2025-05-02');
  });

  it('reports none when the search dropdown surfaces no city page', async () => {
    const r = await fetchRedfinLandComps({ city: 'Nowhere', state: 'FL', subjectAcres: 0.25 }, {
      force: true, connect: fakeConnect('no city here', listings) as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1,
    });
    expect(r.status).toBe('none');
  });

  it('reports blocked (never throws) when anti-bot fires with no listings', async () => {
    const r = await fetchRedfinLandComps({ city: 'Lehigh Acres', state: 'FL', subjectAcres: 0.25 }, {
      force: true, connect: fakeConnect(HREFS, [], true) as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1,
    });
    expect(r.status).toBe('blocked');
  });

  it('is disabled without a locality', async () => {
    const r = await fetchRedfinLandComps({ subjectAcres: 0.25 }, { force: true, connect: (async () => null) as never });
    expect(r.status).toBe('disabled');
  });

  it('rejects a same-state coordinate resolution in Chattanooga for a Newport subject', () => {
    const input = { lat: 36.0298, lng: -83.1112, zip: '37843', city: 'Newport', county: 'Cocke', state: 'TN' };
    const query = redfinSearchQueries(input)[0];
    expect(verifyRedfinResolvedGeography(input, query, '/city/3641/TN/Chattanooga', { text: 'Chattanooga TN 37411' }, [
      { address: '4217 Ohls Ave, Chattanooga, TN 37410', price: 57000, acres: null, sqftLot: null, residential: false, url: null },
    ]).valid).toBe(false);
  });

  it('retries from a wrong coordinate resolution to a verified subject-locality path', async () => {
    const input = { lat: 26.61, lng: -81.64, zip: '33971', city: 'Lehigh Acres', county: 'Lee', state: 'FL', subjectAcres: 0.25 };
    expect(redfinSearchQueries(input).map((query) => query.kind)).toEqual(['coordinates', 'locality', 'zip', 'county']);
    let query = '';
    let current = '';
    const connect = async () => ({
      async newPage() {
        return {
          async setViewport() {},
          async goto(url: string) { current = url; },
          async evaluate(fn: unknown, arg?: unknown) {
            const src = String(fn);
            if (src.includes('scrollBy')) return undefined as never;
            if (src.includes('search-box-input')) { query = String(arg ?? ''); return true as never; }
            if (src.includes('press and hold')) return false as never;
            if (src.includes('HomeCardContainer')) return (current.includes('/zipcode/33971/') ? listings : []) as never;
            if (src.includes('/city/')) return (query.includes('Lehigh Acres') ? 'https://www.redfin.com/zipcode/33971' : 'https://www.redfin.com/city/1/AB/Taber') as never;
            if (src.includes('document.title')) return { url: current, text: current } as never;
            return undefined as never;
          },
        };
      },
      async close() {},
    });
    const result = await fetchRedfinLandComps(input, { force: true, connect: connect as never, timeoutMs: 10, settleMs: 1, suggestionSettleMs: 1, scrollSettleMs: 1 });
    expect(result.status).toBe('retrieved');
    expect(result.routeTried).toContain('/zipcode/33971/');
    // The lane now reads EVERY route and accumulates, rather than returning on
    // the first productive one, so it corrects and discloses every route that
    // resolved to the wrong geography: here the coordinate, ZIP and county
    // routes all resolved outside FL and only the locality route was this
    // subject's market. The disclosure is made on both exit paths.
    expect(result.note).toMatch(/automatically correcting 3 wrong-geography route\(s\)/i);
  });
});

describe('place-path resolution refuses a same-state page that is not the subject market', () => {
  const subject = { city: 'Williamsburg', county: 'Grand Traverse', state: 'MI', zip: '49690', subjectAcres: 60 };

  it('offers a bare ZIP and a bare county route, which are the ones Redfin can answer', () => {
    const kinds = redfinSearchQueries(subject).map((query) => query.kind);
    expect(kinds).toContain('zip');
    expect(kinds).toContain('county');
    expect(redfinSearchQueries(subject).find((query) => query.kind === 'zip')?.query).toBe('49690');
  });

  it('never resolves a Grand Traverse subject onto Redfin\'s Detroit home-page link', async () => {
    // Exactly the hrefs Redfin's home page carries in its popular-cities widget.
    const homepageWidget = 'https://www.redfin.com/city/5665/MI/Detroit/newest-listings https://www.redfin.com/city/4664/OH/Columbus/newest-listings';
    const connect = async () => ({
      async newPage() {
        return {
          async setViewport() {},
          async goto() {},
          async evaluate(fn: unknown) {
            const src = String(fn);
            if (src.includes('scrollBy')) return undefined as never;
            if (src.includes('search-box-input')) return true as never;
            if (src.includes('press and hold')) return false as never;
            if (src.includes('HomeCardContainer')) return [] as never;
            if (src.includes('/city/')) return homepageWidget as never;
            return undefined as never;
          },
        };
      },
      async close() {},
    });
    const result = await fetchRedfinLandComps(subject, { force: true, connect: connect as never, timeoutMs: 10, settleMs: 1, suggestionSettleMs: 1, scrollSettleMs: 1 });
    expect(result.status).toBe('none');
    expect(result.searchVerified).toBe(false);
    expect(result.routes.every((route) => !route.url.includes('Detroit'))).toBe(true);
    expect(result.note).toMatch(/never reached a verified land-search page/);
  });

  it('resolves the subject ZIP page the autocomplete does offer, and reports the search verified', async () => {
    const dropdown = 'https://www.redfin.com/zipcode/49690 https://www.redfin.com/city/5665/MI/Detroit/newest-listings';
    let current = '';
    const connect = async () => ({
      async newPage() {
        return {
          async setViewport() {},
          async goto(url: string) { current = url; },
          async evaluate(fn: unknown) {
            const src = String(fn);
            if (src.includes('scrollBy')) return undefined as never;
            if (src.includes('search-box-input')) return true as never;
            if (src.includes('press and hold')) return false as never;
            if (src.includes('HomeCardContainer')) return [] as never;
            if (src.includes('/city/')) return dropdown as never;
            if (src.includes('document.title')) return { url: current, text: 'Williamsburg MI 49690 land for sale' } as never;
            return undefined as never;
          },
        };
      },
      async close() {},
    });
    const result = await fetchRedfinLandComps(subject, { force: true, connect: connect as never, timeoutMs: 10, settleMs: 1, suggestionSettleMs: 1, scrollSettleMs: 1 });
    expect(result.status).toBe('none');
    expect(result.searchVerified).toBe(true);
    expect(result.routes.some((route) => route.url.includes('/zipcode/49690/filter/property-type=land'))).toBe(true);
    expect(result.note).toMatch(/published no active candidate/);
  });
});

describe('parseRedfinListingDetail', () => {
  it('captures the improved story from a real home page above the widgets', () => {
    const detail = parseRedfinListingDetail('https://www.redfin.com/x', {
      remarks: 'Stunning custom estate on rolling acreage with public water available and 600 ft of road frontage.',
      bodyText: '4 beds 3.5 baths 4,345 Sq Ft 31 acres lot Year Built: 1998 Property Type: Single Family Residential public water available at the road Nearby homes similar to this one 2,100 Sq Ft 3 beds',
      historyRows: ['Mar 14, 2026 Sold $2,950,000', 'Oct 2, 2025 Listed $3,200,000'],
    });
    expect(detail.buildingSqft).toBe(4_345);
    expect(detail.yearBuilt).toBe(1998);
    expect(detail.lotAcres).toBe(31);
    expect(detail.utilityStatements.join(' ')).toMatch(/public water/i);
    expect(detail.priorEvents).toHaveLength(2);
    expect(detail.priorEvents[0]).toEqual({ date: 'Mar 14, 2026', event: 'Sold', price: 2_950_000 });
  });

  it('never reads a widget home\'s square footage as the subject\'s structure', () => {
    // Live 2026-08-20 failure: vacant land pages "showed" 2,100 Sq Ft that
    // belonged to a Nearby homes card. Vacant pages have no positive bed/bath
    // count above the widgets, so no structure may be read at all.
    const detail = parseRedfinListingDetail('https://www.redfin.com/x', {
      remarks: 'Beautiful 40 acre wooded tract.',
      bodyText: '— beds — baths — Sq Ft 40.2 acres lot Land Nearby homes similar to this one 2,100 Sq Ft 3 beds 2 baths',
      historyRows: [],
    });
    expect(detail.buildingSqft).toBeNull();
    expect(detail.lotAcres).toBe(40.2);
  });
});
