import { describe, it, expect } from 'vitest';
import { distanceMiles, zillowLandUrl, zillowSearchRoutes, zillowZipFilteredUrl, normalizeZillowListings, fetchZillowLandComps, type RawZillowListing, resetZillowChallengeMemory, withSharedZillowSession } from './zillow-land-comps.js';

describe('zillowLandUrl', () => {
  it('builds a public Lots/Land locality URL (geographic, not ZIP)', () => {
    expect(zillowLandUrl('LEHIGH ACRES', 'FL')).toBe('https://www.zillow.com/lehigh-acres-fl/land/');
    expect(zillowLandUrl('Fort Myers', 'fl')).toBe('https://www.zillow.com/fort-myers-fl/land/');
  });

  it('builds a usable parcel route when intake has APN/county/state but no city or ZIP', () => {
    const routes = zillowSearchRoutes({
      address: '1488 Liberty Hwy',
      apn: '4068-00-37-1227',
      county: 'Pickens',
      state: 'SC',
      subjectAcres: 10.3,
    });
    expect(routes.some((route) => route.label === 'Pickens County, SC')).toBe(true);
    expect(routes.some((route) => route.kind === 'parcel')).toBe(true);
    expect(routes[0]?.url).toContain('zillow.com');
  });

  it('builds a coordinate-only sold manufactured-home route with a five-mile map boundary', () => {
    const route = zillowSearchRoutes({
      state: 'SC', lat: 34.8, lng: -82.5, mode: 'sold',
      propertyType: 'manufactured', radiusMiles: 5,
    })[0];
    expect(route?.kind).toBe('coordinates');
    expect(decodeURIComponent(route?.url ?? '')).toContain('"manufactured":{"value":true}');
    expect(decodeURIComponent(route?.url ?? '')).toContain('"land":{"value":false}');
  });
});

describe('normalizeZillowListings', () => {
  const raw: RawZillowListing[] = [
    { address: '5413 Lee ST, LEHIGH ACRES, FL 33971', price: 31000, acres: 0.33, url: 'u1' },
    { address: '1013 Wells AVE, LEHIGH ACRES, FL 33972', price: 24500, acres: 0.5, url: 'u2' },
    { address: '5413 Lee ST, LEHIGH ACRES, FL 33971', price: 31000, acres: 0.33, url: 'u1' }, // dup
    { address: 'Big Ranch Rd, FL', price: 350000, acres: 6, url: 'u3' }, // large + expensive: RETAINED
    { address: null, price: 20000, acres: 0.25, url: 'u4' }, // no address
  ];
  it('normalizes and dedupes by address WITHOUT any price cap or acreage band', () => {
    // BUSINESS RULE: price and acreage never decide whether a candidate is
    // discovered; classification analyzes them after retrieval.
    const out = normalizeZillowListings(raw, 0.25);
    expect(out).toHaveLength(3);
    expect(out[0].address).toContain('5413 Lee ST');
    expect(out[0].pricePerAcre).toBe(Math.round(31000 / 0.33));
    expect(out.some((c) => c.price === 350000 && c.acres === 6)).toBe(true);
    expect(out.every((c) => c.source === 'Zillow')).toBe(true);
  });

  it('keeps every sold manufactured-home row regardless of price', () => {
    // The former $200k floor was a retrieval filter; price questions are now
    // answered analytically from the retained candidates.
    const out = normalizeZillowListings([
      { address: '1 Home Rd, Easley, SC 29640', price: 250_000, acres: 2, url: 'a', status: 'sold', lat: 34.8, lng: -82.5, soldDate: '2025-10-01', homeType: 'MANUFACTURED', yearBuilt: 2021, homeSizeSqft: 1568 },
      { address: '2 Home Rd, Easley, SC 29640', price: 200_000, acres: 2, url: 'b', status: 'sold', lat: 34.81, lng: -82.51 },
    ], null, 'sold', 'manufactured');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ price: 250_000, lat: 34.8, lng: -82.5, soldDate: '2025-10-01', homeType: 'MANUFACTURED', yearBuilt: 2021, homeSizeSqft: 1568 });
    expect(distanceMiles({ lat: 34.8, lng: -82.5 }, { lat: 34.81, lng: -82.51 })).toBeLessThan(5);
  });
});

describe('fetchZillowLandComps (injected, no real browser)', () => {
  const chrome = () => ({ path: 'C:/chrome.exe', checked: [] });
  const rawListings: RawZillowListing[] = [{ address: '1810 Wells AVE, LEHIGH ACRES, FL 33972', price: 29497, acres: 0.5, url: 'z' }];
  function fakeConnect(listings: RawZillowListing[], blocked = false) {
    return async () => ({
      async newPage() {
        return {
          async setViewport() {},
          async goto() {},
          async evaluate(fn: unknown) {
            const src = String(fn);
            if (src.includes('press and hold') || src.includes('captcha')) return blocked as never;
            if (src.includes('property-card')) return { listings, nextData: null } as never;
            return undefined as never;
          },
        };
      },
      async close() {},
    });
  }

  it('returns retrieved comps when the disposable session yields land listings', async () => {
    const r = await fetchZillowLandComps({ city: 'Lehigh Acres', state: 'FL', subjectAcres: 0.25 }, {
      force: true, connect: fakeConnect(rawListings) as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1,
    });
    expect(r.status).toBe('retrieved');
    expect(r.comps).toHaveLength(1);
    expect(r.routeTried).toBe('https://www.zillow.com/lehigh-acres-fl/land/');
  });

  it('rejects Canadian, wrong-state, and unlocatable rows from a misresolved search', async () => {
    const rows: RawZillowListing[] = [
      ...rawListings,
      { address: '327 S 3rd St E, Magrath, AB T0K 1J0 ROYAL', price: 75_000, acres: 0.5, url: 'ca' },
      { address: '20 Wrong Market Rd, Albany, GA 31701', price: 55_000, acres: 0.4, url: 'ga' },
      { address: '4500 64th Ave', price: 65_000, acres: 0.4, url: 'unknown' },
    ];
    const r = await fetchZillowLandComps({ city: 'Lehigh Acres', state: 'FL', subjectAcres: 0.25 }, {
      force: true, connect: fakeConnect(rows) as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1,
    });
    expect(r.comps.map((comp) => comp.address)).toEqual(['1810 Wells AVE, LEHIGH ACRES, FL 33972']);
    expect(r.note).toMatch(/3 row\(s\) screened out \(state\/status\), never on price or acreage/i);
  });

  it('reports blocked (never throws) when anti-bot fires with no listings and the hand-off is not cleared', async () => {
    let handoffs = 0;
    const r = await fetchZillowLandComps({ city: 'Lehigh Acres', state: 'FL', subjectAcres: 0.25 }, {
      force: true, connect: fakeConnect([], true) as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1, indexedSearch: async () => [],
      onChallenge: async () => { handoffs += 1; return false; },
    });
    expect(r.status).toBe('blocked');
    expect(r.comps).toHaveLength(0);
    // One hand-off per lane run, never a retry storm.
    expect(handoffs).toBe(1);
  });

  it('hands the anti-bot check to a human once and re-reads the same route on the cleared session', async () => {
    // The fake session starts blocked; the hand-off simulates the operator
    // clearing the check on that session. The lane itself never touches it.
    const state = { blocked: true };
    const connect = async () => ({
      async newPage() {
        return {
          async setViewport() {},
          async goto() {},
          async evaluate(fn: unknown) {
            const src = String(fn);
            if (src.includes('press and hold') || src.includes('captcha')) return state.blocked as never;
            if (src.includes('property-card')) return { listings: state.blocked ? [] : rawListings, nextData: null } as never;
            return undefined as never;
          },
        };
      },
      async close() {},
    });
    const seen: string[] = [];
    const r = await fetchZillowLandComps({ city: 'Lehigh Acres', state: 'FL', subjectAcres: 0.25 }, {
      force: true, connect: connect as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1,
      onChallenge: async (ctx) => { seen.push(`${ctx.propertyType}:${ctx.board}:${ctx.routeLabel}`); state.blocked = false; return true; },
    });
    expect(seen).toEqual(['land:active:Lehigh Acres, FL']);
    expect(r.status).toBe('retrieved');
    expect(r.comps).toHaveLength(1);
    expect(r.routes.some((route) => /operator cleared it/.test(route.outcome))).toBe(true);
  });

  it('never relabels active or ambiguous sold-board rows as closed sales', async () => {
    const mixed: RawZillowListing[] = [
      { ...rawListings[0], status: 'for sale' },
      { address: '1812 Wells AVE, LEHIGH ACRES, FL 33972', price: 28_000, acres: 0.4, url: 'u', status: null },
      { address: '1814 Wells AVE, LEHIGH ACRES, FL 33972', price: 27_000, acres: 0.45, url: 's', status: 'sold' },
    ];
    const result = await fetchZillowLandComps({ city: 'Lehigh Acres', state: 'FL', subjectAcres: 0.25, mode: 'sold' }, {
      force: true, connect: fakeConnect(mixed) as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1,
    });
    expect(result.comps.map((comp) => comp.address)).toEqual(['1814 Wells AVE, LEHIGH ACRES, FL 33972']);
    expect(result.comps.every((comp) => comp.status === 'sold')).toBe(true);
  });

  it('retains manufactured-home search proof and exclusion reasons', async () => {
    const candidates: RawZillowListing[] = [
      { address: '1 Home Rd, Easley, SC 29640', price: 250_000, acres: 2, url: 'a', status: 'sold', lat: 34.8, lng: -82.5, soldDate: '2025-10-01', homeType: 'MANUFACTURED' },
      { address: '2 Far Rd, Easley, SC 29640', price: 260_000, acres: 2, url: 'b', status: 'sold', lat: 35.0, lng: -82.5, soldDate: '2025-10-01', homeType: 'MANUFACTURED' },
      { address: '3 Old Rd, Easley, SC 29640', price: 270_000, acres: 2, url: 'c', status: 'sold', lat: 34.81, lng: -82.51, soldDate: '2022-01-01', homeType: 'MANUFACTURED' },
      { address: '4 Undated Rd, Easley, SC 29640', price: 280_000, acres: 2, url: 'd', status: 'sold', lat: 34.81, lng: -82.51, soldDate: null, homeType: 'MANUFACTURED' },
    ];
    const result = await fetchZillowLandComps({
      city: 'Easley', county: 'Pickens', state: 'SC',
      lat: 34.8, lng: -82.5, mode: 'sold', propertyType: 'manufactured',
      radiusMiles: 5, dateWindowMonths: 24,
    }, {
      force: true,
      connect: fakeConnect(candidates) as never,
      timeoutMs: 10,
      settleMs: 1,
      scrollSettleMs: 1,
      nowMs: Date.parse('2026-07-01'),
    });
    expect(result.status).toBe('retrieved');
    expect(result.comps).toHaveLength(1);
    expect(result.searchProof).toMatchObject({
      radiusMiles: 5,
      timePeriodMonths: 24,
      sourcesSearched: ['Zillow'],
      candidatesReviewed: 4,
      qualifyingResults: 1,
    });
    expect(result.searchProof?.routesAttempted[0]).toMatch(/within 5 miles/);
    expect(result.searchProof?.exclusionReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'Outside 5-mile radius', count: 1 }),
      expect.objectContaining({ reason: 'Outside 24-month time period', count: 1 }),
      expect.objectContaining({ reason: 'Verified sale date unavailable', count: 1 }),
    ]));
  });

  it('is disabled without a locality (no city/state)', async () => {
    const r = await fetchZillowLandComps({ subjectAcres: 0.25 }, { force: true, connect: (async () => null) as never });
    expect(r.status).toBe('disabled');
  });

  it('uses ZIP then coordinates then city/county locality and retries wrong resolved markets', async () => {
    const input = { lat: 26.61, lng: -81.64, zip: '33971', city: 'Lehigh Acres', county: 'Lee', state: 'FL', subjectAcres: 0.25 };
    expect(zillowSearchRoutes(input).map((route) => route.kind)).toEqual(['zip', 'coordinates', 'locality']);
    let current = '';
    const connect = async () => ({
      async newPage() {
        return {
          async setViewport() {},
          async goto(url: string) { current = url; },
          async evaluate(fn: unknown) {
            const src = String(fn);
            if (src.includes('location.pathname')) return '/lehigh-acres-fl-33971/' as never;
            if (src.includes('press and hold')) return false as never;
            if (src.includes('property-card')) return {
              // Both searchQueryState routes (ZIP + coordinates) resolve to a
              // wrong market in this scenario; the locality route recovers.
              listings: current.includes('searchQueryState')
                ? [{ address: '327 S 3rd St E, Magrath, AB T0K 1J0', price: 75_000, acres: 0.4, url: 'wrong' }]
                : rawListings,
              nextData: null,
            } as never;
            if (src.includes('document.title')) return { url: current, text: current.includes('searchQueryState') ? 'Taber Municipal District AB' : 'Land for sale Lehigh Acres FL' } as never;
            return undefined as never;
          },
        };
      },
      async close() {},
    });
    const result = await fetchZillowLandComps(input, { force: true, connect: connect as never, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1 });
    expect(result.status).toBe('retrieved');
    expect(result.routeTried).toContain('/lehigh-acres-fl/');
    expect(result.note).toMatch(/automatically correcting 2 wrong-geography route/i);
    expect(result.routes.filter((route) => !route.marketVerified)).toHaveLength(2);
  });

  it('derives an operator-style large-acreage ZIP search: lot minimum, houses included, no maximum and no price filter', () => {
    const input = {
      zip: '37062', state: 'TN', city: 'Fairview', county: 'Williamson',
      subjectAcres: 76, mode: 'sold' as const, dateWindowMonths: 12 as const, lotMinAcres: 19,
    };
    const routes = zillowSearchRoutes(input);
    // Step 1: the bare ZIP page, so Zillow resolves the region itself (a
    // searchQueryState without a region is replaced by Zillow's default market).
    expect(routes[0]?.kind).toBe('zip');
    expect(routes[0]?.url).toBe('https://www.zillow.com/homes/37062_rb/');
    // Step 2: operator-style filters applied on the resolved region path.
    const decoded = decodeURIComponent(zillowZipFilteredUrl('/fairview-tn-37062/', input));
    expect(decoded).toContain('https://www.zillow.com/fairview-tn-37062/sold/');
    expect(decoded).toContain(`"lotSize":{"min":${Math.round(19 * 43_560)}}`);
    expect(decoded).toContain('"house":{"value":true}');
    expect(decoded).toContain('"isRecentlySold":{"value":true}');
    expect(decoded).toContain('"doz":{"value":"12m"}');
    expect(decoded).not.toMatch(/lotSize":\{[^}]*max/);
    expect(decoded).not.toMatch(/price/i);
  });
});


describe('one persistent Zillow session across boards', () => {
  const rawListings: RawZillowListing[] = [{ address: '1810 Wells AVE, LEHIGH ACRES, FL 33972', price: 29497, acres: 0.5, url: 'z' }];
  function session(state: { blocked: boolean }) {
    const log = { pages: 0, closed: 0 };
    const handle = {
      async newPage() {
        log.pages += 1;
        return {
          async setViewport() {},
          async goto() {},
          async evaluate(fn: unknown) {
            const src = String(fn);
            if (src.includes('press and hold') || src.includes('captcha')) return state.blocked as never;
            if (src.includes('property-card')) return { listings: state.blocked ? [] : rawListings, nextData: null } as never;
            return undefined as never;
          },
        };
      },
      async close() { log.closed += 1; },
    };
    return { handle, log };
  }
  const input = { city: 'Lehigh Acres', state: 'FL', subjectAcres: 0.25 };
  const fast = { force: true, timeoutMs: 10, settleMs: 1, scrollSettleMs: 1 , indexedSearch: async () => [] };

  it('reuses the supplied session for every board and never closes it', async () => {
    resetZillowChallengeMemory();
    const { handle, log } = session({ blocked: false });
    const sold = await fetchZillowLandComps({ ...input, mode: 'sold' }, { ...fast, session: handle as never });
    const active = await fetchZillowLandComps({ ...input, mode: 'active' }, { ...fast, session: handle as never });
    // The sold board screens rows without a closed status; what matters here is
    // that both boards ran on the one session and neither was blocked.
    expect(['retrieved', 'none']).toContain(sold.status);
    expect(active.status).toBe('retrieved');
    expect(log.pages).toBe(2);
    expect(log.closed).toBe(0);
  });

  it('carries one operator clearance across the remaining boards on the same session', async () => {
    resetZillowChallengeMemory();
    const state = { blocked: true };
    const { handle } = session(state);
    let handoffs = 0;
    const onChallenge = async () => { handoffs += 1; state.blocked = false; return true; };
    const sold = await fetchZillowLandComps({ ...input, mode: 'sold' }, { ...fast, session: handle as never, onChallenge });
    const active = await fetchZillowLandComps({ ...input, mode: 'active' }, { ...fast, session: handle as never, onChallenge });
    expect(['retrieved', 'none']).toContain(sold.status);
    expect(active.status).toBe('retrieved');
    expect(handoffs).toBe(1);
  });

  it('runs sold land, active land and manufactured-home research on ONE session and never closes it', async () => {
    resetZillowChallengeMemory();
    // Each board answers with its own board-appropriate rows, plus one address
    // that appears on BOTH land boards so cross-board deduplication is visible.
    const shared = { address: '1810 Wells AVE, LEHIGH ACRES, FL 33972', price: 29497, acres: 0.5, url: 'z-shared' };
    const boards: Record<string, RawZillowListing[]> = {
      sold: [
        { ...shared, status: 'Sold', soldDate: '2026-04-02' },
        { ...shared, status: 'Sold', soldDate: '2026-04-02' },
        { address: '2200 Palm RD, LEHIGH ACRES, FL 33972', price: 41000, acres: 1.1, url: 'z-sold-2', status: 'Sold', soldDate: '2026-02-11' },
      ],
      active: [
        { ...shared, status: 'For sale' },
        { address: '99 Cypress LN, LEHIGH ACRES, FL 33972', price: 52000, acres: 2, url: 'z-act-2', status: 'For sale' },
      ],
      manufactured: [
        // The manufactured lane proves geography, closed status, coordinates and
        // time period, so a qualifying row must carry all of them.
        { address: '77 Mobile WAY, LEHIGH ACRES, FL 33972', price: 189000, acres: 1, url: 'z-mh-1', status: 'Sold', soldDate: '2026-03-05', homeType: 'MANUFACTURED', lat: 26.6182, lng: -81.6248 },
        { address: '81 Faraway RD, LEHIGH ACRES, FL 33972', price: 150000, acres: 1, url: 'z-mh-2', status: 'Sold', soldDate: '2026-03-06', homeType: 'MANUFACTURED', lat: 27.9, lng: -82.6 },
      ],
    };
    let current: keyof typeof boards = 'sold';
    const log = { pages: 0, closed: 0 };
    const handle = {
      async newPage() {
        log.pages += 1;
        return {
          async setViewport() {},
          async goto() {},
          async evaluate(fn: unknown) {
            const src = String(fn);
            if (src.includes('press and hold') || src.includes('captcha')) return false as never;
            if (src.includes('property-card')) return { listings: boards[current], nextData: null } as never;
            return undefined as never;
          },
        };
      },
      async close() { log.closed += 1; },
    };

    current = 'sold';
    const sold = await fetchZillowLandComps({ ...input, mode: 'sold' }, { ...fast, session: handle as never });
    current = 'active';
    const active = await fetchZillowLandComps({ ...input, mode: 'active' }, { ...fast, session: handle as never });
    current = 'manufactured';
    const manufactured = await fetchZillowLandComps(
      { ...input, mode: 'sold', propertyType: 'manufactured', lat: 26.6182, lng: -81.6248, radiusMiles: 5 },
      { ...fast, session: handle as never },
    );

    // ONE session served all three research types.
    expect(log.pages).toBe(3);
    expect(log.closed).toBe(0);
    expect(sold.status).toBe('retrieved');
    expect(active.status).toBe('retrieved');
    expect(manufactured.status).toBe('retrieved');

    // Deduplication WITHIN a board: the sold board offered the shared address
    // twice and it is retained once.
    expect(sold.comps.filter((c) => /1810 Wells/i.test(c.address ?? '')).length).toBe(1);
    expect(sold.comps.length).toBe(2);

    // Board separation: a sold row never enters the active board and vice
    // versa, so the shared address is carried by each board under its own
    // status rather than duplicated as one record with two meanings.
    expect(sold.comps.every((c) => c.status === 'sold')).toBe(true);
    expect(active.comps.every((c) => c.status !== 'sold')).toBe(true);
    // The manufactured lane offered two closed sales and kept only the one
    // inside the 5-mile radius, recording WHY the other was dropped.
    expect(manufactured.comps.length).toBe(1);
    expect(manufactured.comps[0]?.address).toMatch(/77 Mobile WAY/i);
    expect(manufactured.searchProof?.exclusionReasons ?? []).toContainEqual(
      expect.objectContaining({ reason: expect.stringMatching(/5-mile radius/) }),
    );
  });

  it('one operator clearance resumes sold, active AND manufactured research on the same session', async () => {
    resetZillowChallengeMemory();
    const state = { blocked: true };
    const { handle } = session(state);
    let handoffs = 0;
    const onChallenge = async () => { handoffs += 1; state.blocked = false; return true; };
    const sold = await fetchZillowLandComps({ ...input, mode: 'sold' }, { ...fast, session: handle as never, onChallenge });
    const active = await fetchZillowLandComps({ ...input, mode: 'active' }, { ...fast, session: handle as never, onChallenge });
    const manufactured = await fetchZillowLandComps(
      { ...input, mode: 'sold', propertyType: 'manufactured' },
      { ...fast, session: handle as never, onChallenge },
    );
    // The human cleared the check ONCE; the cleared session carried the
    // clearance into the active and manufactured research without asking again.
    expect(handoffs).toBe(1);
    expect(['retrieved', 'none']).toContain(sold.status);
    expect(active.status).toBe('retrieved');
    expect(['retrieved', 'none']).toContain(manufactured.status);
    resetZillowChallengeMemory();
  });

  it('an unattended challenge is recorded once and the remaining boards are skipped on that session without any wait', async () => {
    resetZillowChallengeMemory();
    const { handle } = session({ blocked: true });
    let handoffs = 0;
    const onChallenge = async () => { handoffs += 1; return false; };
    const sold = await fetchZillowLandComps({ ...input, mode: 'sold' }, { ...fast, session: handle as never, onChallenge });
    const active = await fetchZillowLandComps({ ...input, mode: 'active' }, { ...fast, session: handle as never, onChallenge });
    const manufactured = await fetchZillowLandComps({ ...input, mode: 'sold', propertyType: 'manufactured' }, { ...fast, session: handle as never, onChallenge });
    expect(sold.status).toBe('blocked');
    expect(active.status).toBe('blocked');
    expect(active.note).toMatch(/anti-bot check earlier on this session/);
    expect(manufactured.note).toMatch(/anti-bot check earlier on this session/);
    expect(handoffs).toBe(1);
    resetZillowChallengeMemory();
  });
});


describe('withSharedZillowSession', () => {
  it('opens one session for concurrent lanes, serializes their work on it, and closes it once at the end', async () => {
    let opened = 0; let closed = 0; const order: string[] = [];
    const open = async () => { opened += 1; return { async newPage() { return {} as never; }, async close() { closed += 1; } }; };
    const lane = (name: string, ms: number) => withSharedZillowSession(async (session) => {
      order.push(`${name}:start`);
      expect(session).not.toBeNull();
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${name}:end`);
      return name;
    }, { open });
    const results = await Promise.all([lane('sold', 20), lane('active', 5), lane('manufactured', 5)]);
    expect(results).toEqual(['sold', 'active', 'manufactured']);
    expect(opened).toBe(1);
    expect(closed).toBe(1);
    // Serialized: the next board starts only after the previous one ends.
    expect(order).toEqual(['sold:start', 'sold:end', 'active:start', 'active:end', 'manufactured:start', 'manufactured:end']);
  });
});
