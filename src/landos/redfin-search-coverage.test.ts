// Redfin search coverage across routes — source contract.
//
// The defect this pins: the lane returned on the FIRST route that produced any
// candidate, so a narrow road or locality board could end the search while the
// county board — the one that actually lists the market's sold land — was never
// opened. Verified public sales inside the subject's acreage range were visible
// on Redfin and never became candidates, and the non-LandPortal lane then looked
// far thinner than the market really was.
//
// Asserted against the source because the behaviour lives inside one long
// browser loop whose faithful emulation would pin the stub, not the lane. The
// live acceptance run is what proves the records are actually retrieved; this
// keeps the decision from silently reverting.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { recentSoldEvidenceSufficient } from './comp-sale-recency.js';
import {
  REDFIN_CARD_ADDRESS_NO_CITY_PATTERN, REDFIN_CARD_ADDRESS_PATTERN, REDFIN_MAX_BOARD_PAGES, redfinAddressIsPlausible, redfinCandidateIdentity,
  normalizeRedfinListings, redfinListingIdFromUrl, redfinSearchQueries, redfinStatedHomeCount,
} from './redfin-land-comps.js';

const SRC = fs.readFileSync(path.join(process.cwd(), 'src/landos/redfin-land-comps.ts'), 'utf8');

describe('the Redfin lane searches every route until the evidence is sufficient', () => {
  it('accumulates candidates across routes instead of returning on the first productive one', () => {
    // The accumulator and its address-level deduplication.
    expect(SRC).toMatch(/const accumulated: RedfinLandComp\[\] = \[\];/);
    expect(SRC).toMatch(/const seenAccumulated = new Set<string>\(\);/);
    expect(SRC).toMatch(/const collect = \(rows: RedfinLandComp\[\]\): number =>/);
    // The stop condition is sufficiency, not "produced anything at all".
    expect(SRC).toMatch(/if \(!recentSoldEvidenceSufficient\([\s\S]{0,80}\)\) continue;/);
    // And whatever was gathered still answers once the routes are exhausted.
    expect(SRC).toMatch(/if \(accumulated\.length\) \{/);
  });

  it('always tries the next board page rather than gating on a parsed home count', () => {
    // A board stating 45 sold parcels contributed only the ~15 its first page
    // rendered, because the stated count could not be read and pagination was
    // gated on it. The loop is bounded and stops on the first page that yields
    // no fresh address, so trying the next page is cheap and cannot run away.
    expect(REDFIN_MAX_BOARD_PAGES).toBeGreaterThanOrEqual(2);
    expect(SRC).toMatch(/redfinBoardPageUrl\(landUrl, pageNo\)/);
    expect(SRC).toMatch(/statedTotal == null \|\| allRaw\.length < statedTotal/);
    expect(SRC).toMatch(/if \(!fresh\.length\) break;/);
  });

  it('reads the stated home count even when Redfin glues it to the heading', () => {
    // innerText renders "...homes for sale & real estate45 homes", so a leading
    // word boundary never matches and the count read as absent.
    expect(redfinStatedHomeCount('32054, FL homes for sale & real estate45 homes')).toBe(45);
    expect(redfinStatedHomeCount('Bradford County, FL homes for sale93 homes')).toBe(93);
    expect(redfinStatedHomeCount('no count here')).toBeNull();
  });

  it('builds a county board route for a subject that already has a city', () => {
    // The county board is the one that lists the market's sold land. A subject
    // with a city must still reach it: that is exactly the route the old
    // first-success return skipped past.
    const queries = redfinSearchQueries({
      city: 'Lake Butler', county: 'Bradford', state: 'FL', zip: '32054',
      subjectAcres: 1.5, mode: 'sold',
    } as never);
    expect(queries.some((q) => q.kind === 'county')).toBe(true);
    expect(queries.some((q) => q.kind === 'zip')).toBe(true);
    expect(queries.some((q) => q.kind === 'locality')).toBe(true);
  });

  it('treats one retained sale as insufficient to end the search', () => {
    // One sale cannot price a subject, so the lane must keep looking.
    expect(recentSoldEvidenceSufficient(1)).toBe(false);
    expect(recentSoldEvidenceSufficient(2)).toBe(false);
  });
});

describe('candidate identity never merges two separate parcels', () => {
  const lotA = {
    address: 'TBD SW 52nd Ter, Lake Butler, FL 32054', acres: 1.16, price: 39_900,
    soldDate: '2026-07-17', url: 'https://www.redfin.com/FL/Lake-Butler/TBD-SW-52nd-Ter-32054/home/201372496',
  };
  const lotB = {
    address: 'TBD SW 52nd Ter, Lake Butler, FL 32054', acres: 2.10, price: 44_500,
    soldDate: '2026-05-02', url: 'https://www.redfin.com/FL/Lake-Butler/TBD-SW-52nd-Ter-32054/home/199111222',
  };

  it('keeps adjacent lots sharing one road or a TBD address separate', () => {
    // Address alone would collapse these into one record and lose a real
    // arms-length transaction. Vacant land is routinely listed without a street
    // number, so this is the ordinary case, not an edge case.
    expect(redfinCandidateIdentity(lotA)).not.toBe(redfinCandidateIdentity(lotB));
  });

  it('prefers the provider record id over every weaker signal', () => {
    expect(redfinListingIdFromUrl(lotA.url)).toBe('201372496');
    expect(redfinCandidateIdentity(lotA)).toBe('redfin:201372496');
    // The same record reached by a differently-cased URL is still one record.
    expect(redfinCandidateIdentity({ ...lotA, url: lotA.url.toUpperCase() })).toBe('redfin:201372496');
    // A changed address on the same record id does not create a second record.
    expect(redfinCandidateIdentity({ ...lotA, address: 'SW 52nd Terrace' })).toBe('redfin:201372496');
  });

  it('falls back through parcel id, url and coordinates before any address compare', () => {
    expect(redfinCandidateIdentity({ ...lotA, url: null, apn: '00083-A-034' })).toBe('apn:00083A034');
    expect(redfinCandidateIdentity({ ...lotA, url: 'https://example.com/x', apn: null })).toBe('url:https://example.com/x');
    expect(redfinCandidateIdentity({ address: 'TBD Rd', url: null, lat: 30.0653, lng: -82.5086 }))
      .toBe('pt:30.06530,-82.50860');
  });

  it('only merges on a compound match when nothing stronger exists', () => {
    const bare = { address: 'TBD SW 52nd Ter', acres: 1.16, price: 39_900, soldDate: '2026-07-17' };
    expect(redfinCandidateIdentity(bare)).toBe(redfinCandidateIdentity({ ...bare }));
    // Any one of acreage, price or date differing keeps them separate.
    expect(redfinCandidateIdentity({ ...bare, acres: 2.1 })).not.toBe(redfinCandidateIdentity(bare));
    expect(redfinCandidateIdentity({ ...bare, price: 44_500 })).not.toBe(redfinCandidateIdentity(bare));
    expect(redfinCandidateIdentity({ ...bare, soldDate: '2026-05-02' })).not.toBe(redfinCandidateIdentity(bare));
  });

  it('scrolls a lazily rendered board until it stops producing cards', () => {
    // Redfin paints ~15 cards and mounts the rest only as the viewport travels.
    // A fixed four-scroll pass read the first fifteen and treated a 45-home
    // board as exhausted, so real sales below the fold were never extracted.
    expect(SRC).toMatch(/async function scrollBoardUntilSettled\(/);
    // The list is VIRTUALISED: off-screen cards are unmounted, so rows must be
    // absorbed on every pass. Reading the DOM once at the end returns only the
    // ~15 cards mounted at that moment, however far the page was scrolled.
    expect(SRC).toMatch(/const byIdentity = new Map<string, RawRedfinListing>\(\);/);
    expect(SRC).toMatch(/const absorb = async \(\): Promise<void> =>/);
    expect(SRC).toMatch(/stable = byIdentity\.size > before \? 0 : stable \+ 1;/);
    expect(SRC).toMatch(/if \(stable >= 2\) break;/);
    // Accumulation is keyed by canonical identity, never by address.
    expect(SRC).toMatch(/const key = redfinCandidateIdentity\(row as never\);/);
    // The fixed-pass loops are gone from both the first board read and paging.
    expect(SRC).not.toMatch(/for \(let i = 0; i < 4; i\+\+\) \{ try \{ await page\.evaluate\('window\.scrollBy/);
  });

  it('records a board as partial when the page bound is hit with fresh candidates still arriving', () => {
    expect(SRC).toMatch(/boardTruncated = true;/);
    expect(SRC).toMatch(/PARTIAL: fresh candidates were still appearing/);
  });
});

describe('vacant land addresses without a street number are still cards', () => {
  const match = (text: string) => REDFIN_CARD_ADDRESS_PATTERN.test(text);

  it('recognises unnumbered and lot-placeholder land addresses', () => {
    // These are the ordinary shapes for vacant land. Requiring a leading street
    // number discarded them before any scroll, page or dedupe could matter.
    expect(match('TBD SW 52nd Ter, Lake Butler, FL 32054')).toBe(true);
    expect(match('SW 107th Ave, Lake Butler, FL 32054')).toBe(true);
    expect(match('Lot 9 SW 39th Dr, Lake Butler, FL 32054')).toBe(true);
    expect(match('Turkey Ridge Rd, Lake Butler, FL 32054')).toBe(true);
  });

  it('still recognises the numbered addresses it always did', () => {
    expect(match('0 County Rd 241, Lake Butler, FL 32054')).toBe(true);
    expect(match('9535 NW 147th Ter, Lake Butler, FL 32054')).toBe(true);
    expect(match('00 SW County RD 239, Lake Butler, FL 32054')).toBe(true);
  });

  it('does not match ordinary card copy that carries no address tail', () => {
    expect(match('Last sold price')).toBe(false);
    expect(match('3.01 acres (lot)')).toBe(false);
    expect(match('ABOUT THIS HOME Beautiful 3 acre property')).toBe(false);
  });

  const noCity = (text: string) => REDFIN_CARD_ADDRESS_NO_CITY_PATTERN.test(text);

  it('recognises the city-less address Redfin prints for an unresolved locality', () => {
    // Redfin renders these as `/FL/Unknown/...`; a $50,000 1.67-acre sale on the
    // same street as a selected comp was lost purely to the missing city.
    expect(match('Lot 7 SW 39th Dr, FL 32054')).toBe(false);
    expect(noCity('Lot 7 SW 39th Dr, FL 32054')).toBe(true);
    expect(noCity('71st Way, FL 32054')).toBe(true);
    expect(noCity('TBD SW 99th Ave, FL 32054')).toBe(true);
    expect(noCity('115th Ct, FL 32054')).toBe(true);
  });

  it('never turns a bare city into a street address', () => {
    // "Property in Lake Butler, FL 32054" has no street at all. Matching it
    // would manufacture an address, and every downstream identity, distance and
    // parcel check would then be about a place rather than a parcel.
    expect(noCity('Lake Butler, FL 32054')).toBe(false);
    expect(noCity('Homes for Sale, FL 32054')).toBe(false);
  });

  it('never lets card measurements become a street address', () => {
    // A city-only card prints "1,008 sq ftLake Butler, FL 32054". The digit
    // guard accepts "008 sq ft" as a street number, so the measurement words
    // are what disqualify it.
    expect(noCity('008 sq ftLake Butler, FL 32054')).toBe(true);
    expect(redfinAddressIsPlausible('008 sq ftLake Butler, FL 32054')).toBe(false);
    expect(redfinAddressIsPlausible('1,293 sq ftNW 9th Ave, Lake Butler, FL 32054')).toBe(false);
    expect(redfinAddressIsPlausible('2.50 acres (lot), FL 32054')).toBe(false);
    // and real land addresses are untouched
    expect(redfinAddressIsPlausible('SW 107th Ave, Lake Butler, FL 32054')).toBe(true);
    expect(redfinAddressIsPlausible('Lot 7 SW 39th Dr, FL 32054')).toBe(true);
    expect(redfinAddressIsPlausible('TBD SW 52nd Ter, Lake Butler, FL 32054')).toBe(true);
    expect(redfinAddressIsPlausible('')).toBe(false);
  });

  it('keeps the exported patterns identical to the ones inlined in the extractor', () => {
    // The extractor is serialised into the page and cannot reference module
    // scope, so the literal is duplicated on purpose; this stops them drifting.
    const inlined = SRC.match(/const addrM = addrText\.match\((\/.*?\/)\)/);
    expect(inlined).toBeTruthy();
    expect(inlined![1]).toBe(REDFIN_CARD_ADDRESS_PATTERN.toString());
    expect(SRC).toContain(REDFIN_CARD_ADDRESS_NO_CITY_PATTERN.toString());
  });
});

// A sold board that renders its "SOLD <date>" banner outside the leaf card
// element left those cards with no status text at all. Requiring a sold
// candidate to STATE it is sold then discarded real closed sales for a
// rendering detail — on the live 45-home ZIP 32054 board it dropped 8 of 33
// extracted records, including SW 107th Ave, a 2.50-acre sale inside the
// subject's own acreage band.
const VERIFIED_BOARD = {
  soldBoardVerified: true,
  boardUrl: 'https://www.redfin.com/zipcode/32054/filter/property-type=land,include=sold-1yr',
  boardFilter: 'property-type=land, include=sold',
};

describe('an unlabelled card on a sold-only board is a sold record', () => {
  const raw = (over: Record<string, unknown>) => ({
    price: 30_000, acres: 2.5, sqftLot: null, residential: false,
    address: 'SW 107th Ave, Lake Butler, FL 32054',
    url: 'https://www.redfin.com/FL/Lake-Butler/SW-107th-Ave-32054/home/142696514',
    status: null, thumbnailUrl: null, ...over,
  }) as never;

  it('keeps a card that prints no status banner, and says the board carried it', () => {
    const [comp] = normalizeRedfinListings([raw({})], 1.5, 'sold', 'land', VERIFIED_BOARD);
    expect(comp).toBeDefined();
    expect(comp.status).toBe('sold');
    expect(comp.statusFromBoardFilter).toBe(true);
  });

  it('never invents a sale date for one: the date still has to be read', () => {
    const [comp] = normalizeRedfinListings([raw({})], 1.5, 'sold', 'land', VERIFIED_BOARD);
    expect(comp.soldDate).toBeNull();
  });

  it('still excludes a card whose own label contradicts the sold filter', () => {
    expect(normalizeRedfinListings([raw({ status: 'For sale' })], 1.5, 'sold', 'land', VERIFIED_BOARD)).toHaveLength(0);
    expect(normalizeRedfinListings([raw({ status: 'Coming soon' })], 1.5, 'sold', 'land', VERIFIED_BOARD)).toHaveLength(0);
  });

  it('carries the published card coordinate through to the comparable', () => {
    // The card's JSON-LD `geo` is the provider's coordinate for the record. It
    // was being dropped, which forced a second detail read per record and left
    // records whose detail read published no single point unlocated for good:
    // undistanceable, unrankable and absent from the map.
    const [comp] = normalizeRedfinListings([raw({ lat: 30.0251, lng: -82.3379 })], 1.5, 'sold', 'land', VERIFIED_BOARD);
    expect(comp.lat).toBe(30.0251);
    expect(comp.lng).toBe(-82.3379);
  });

  it('leaves a card with no usable point unlocated rather than guessing one', () => {
    const [none] = normalizeRedfinListings([raw({})], 1.5, 'sold', 'land', VERIFIED_BOARD);
    expect(none.lat).toBeNull();
    expect(none.lng).toBeNull();
    const [zero] = normalizeRedfinListings([raw({ lat: 0, lng: 0 })], 1.5, 'sold', 'land', VERIFIED_BOARD);
    expect(zero.lat).toBeNull();
  });

  it('marks a card that stated its own sold banner as card-sourced, not inherited', () => {
    const [comp] = normalizeRedfinListings([raw({ status: 'Sold on Apr 30, 2026' })], 1.5, 'sold', 'land', VERIFIED_BOARD);
    expect(comp.status).toBe('sold');
    expect(comp.statusFromBoardFilter).toBe(false);
    expect(comp.soldDate).toBe('2026-04-30');
  });

  it('does not turn an unlabelled card into a sold record on an active board', () => {
    const [comp] = normalizeRedfinListings([raw({})], 1.5, 'active');
    expect(comp.status).toBe('active');
    expect(comp.statusFromBoardFilter).toBeFalsy();
  });
});

// Inheritance is confined to a board LandOS actually verified as sold-only.
describe('a mixed or unverified board never confers sold status', () => {
  const unlabelled = {
    price: 30_000, acres: 2.5, sqftLot: null, residential: false,
    address: 'SW 107th Ave, Lake Butler, FL 32054',
    url: 'https://www.redfin.com/FL/Lake-Butler/SW-107th-Ave-32054/home/142696514',
    status: null, thumbnailUrl: null,
  } as never;

  it('drops an unlabelled row when no board is stated at all', () => {
    expect(normalizeRedfinListings([unlabelled], 1.5, 'sold')).toHaveLength(0);
  });

  it('drops it on a board explicitly not verified as sold-only', () => {
    expect(normalizeRedfinListings([unlabelled], 1.5, 'sold', 'land', { soldBoardVerified: false })).toHaveLength(0);
  });

  it('retains the board and filter as lineage when it does inherit', () => {
    const [comp] = normalizeRedfinListings([unlabelled], 1.5, 'sold', 'land', VERIFIED_BOARD);
    expect(comp.statusFromBoardFilter).toBe(true);
    expect(comp.soldBoardUrl).toBe(VERIFIED_BOARD.boardUrl);
    expect(comp.soldBoardFilter).toBe(VERIFIED_BOARD.boardFilter);
    expect(comp.soldDate ?? null).toBeNull();
  });
});
