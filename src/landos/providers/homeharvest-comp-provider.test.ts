import { describe, it, expect } from 'vitest';
import {
  fetchHomeHarvestComps,
  buildLocation,
  type HomeHarvestRunner,
  type HomeHarvestRow,
  type HomeHarvestBridgeResponse,
} from './homeharvest-comp-provider.js';

function runnerWith(rows: HomeHarvestRow[], status: HomeHarvestBridgeResponse['status'] = 'collected', error: string | null = null): HomeHarvestRunner {
  return { async run() { return { status, rows, count: rows.length, error }; } };
}

const soldLand = (over: Partial<HomeHarvestRow> = {}): HomeHarvestRow => ({
  property_url: 'https://www.realtor.com/x', style: 'LAND', status: 'SOLD', listing_type: 'sold',
  sold_price: 60000, last_sold_date: '2026-05-01 00:00:00', lot_sqft: 87120 /* 2 ac */, year_built: null, ...over,
});
const activeLand = (over: Partial<HomeHarvestRow> = {}): HomeHarvestRow => ({
  property_url: 'https://www.realtor.com/a', style: 'LAND', status: 'FOR_SALE', listing_type: 'for_sale',
  list_price: 75000, list_date: '2026-06-01 00:00:00', lot_sqft: 87120, ...over,
});

const NOW_MS = Date.parse('2026-06-29T00:00:00Z');
const deps = { nowMs: NOW_MS, now: () => '2026-06-29T00:00:00Z' };

describe('buildLocation', () => {
  it('builds a full-address location enabling radius', () => {
    const r = buildLocation({ address: '166 Thamon Rd', city: 'Shelby', state: 'NC', zip: '28150' });
    expect(r?.hasAddress).toBe(true);
    expect(r?.location).toContain('166 Thamon Rd');
  });
  it('falls back to City, ST and ZIP', () => {
    expect(buildLocation({ city: 'Shelby', state: 'NC' })?.hasAddress).toBe(false);
    expect(buildLocation({ zip: '28150' })?.location).toBe('28150');
  });
  it('returns null with nothing usable', () => {
    expect(buildLocation({})).toBeNull();
  });
});

describe('fetchHomeHarvestComps — retrieval + classification', () => {
  it('returns raw-land sold + active and computes price-per-acre', async () => {
    const r = await fetchHomeHarvestComps({ address: '166 Thamon Rd', city: 'Shelby', state: 'NC' }, { ...deps, runner: runnerWith([soldLand(), activeLand()]) });
    expect(r.status).toBe('collected');
    expect(r.sold).toHaveLength(1);
    expect(r.active).toHaveLength(1);
    expect(r.sold[0].pricePerAcre).toBe(30000); // 60000 / 2 ac
    expect(r.sold[0].compClass).toBe('vacant_land');
    expect(r.sold[0].saleDateIso).toBe('2026-05-01');
  });

  it('classifies FARM style as raw land (farm)', async () => {
    const r = await fetchHomeHarvestComps({ city: 'Shelby', state: 'NC' }, { ...deps, runner: runnerWith([soldLand({ style: 'FARM' })]) });
    expect(r.sold[0].compClass).toBe('farm');
  });

  it('excludes a LAND-style listing that actually has a manufactured home (year built)', async () => {
    const contaminated = soldLand({ year_built: 2005, sqft: 924, text: 'Includes a 924 sq ft manufactured home on the lot' });
    const r = await fetchHomeHarvestComps({ city: 'Shelby', state: 'NC' }, { ...deps, runner: runnerWith([soldLand(), contaminated]) });
    expect(r.sold).toHaveLength(1);          // the clean land comp only
    expect(r.excludedNonLand).toBe(1);        // the improved one excluded
  });

  it('drops rows without a usable price or source URL (never invented)', async () => {
    const rows = [soldLand({ sold_price: null, last_sold_price: null }), soldLand({ property_url: null })];
    const r = await fetchHomeHarvestComps({ city: 'Shelby', state: 'NC' }, { ...deps, runner: runnerWith(rows) });
    expect(r.sold).toHaveLength(0);
    expect(r.status).toBe('no_comps');
  });

  it('applies a defensive recency guard on sold comps', async () => {
    const stale = soldLand({ last_sold_date: '2023-01-01 00:00:00' });
    const r = await fetchHomeHarvestComps({ city: 'Shelby', state: 'NC' }, { ...deps, runner: runnerWith([stale]) });
    expect(r.sold).toHaveLength(0);
  });
});

describe('fetchHomeHarvestComps — honest statuses', () => {
  it('reports no_area when there is no location', async () => {
    const r = await fetchHomeHarvestComps({}, { ...deps, runner: runnerWith([]) });
    expect(r.status).toBe('no_area');
  });

  it('reports not_available when the library is missing', async () => {
    const r = await fetchHomeHarvestComps({ city: 'Shelby', state: 'NC' }, { ...deps, runner: runnerWith([], 'error', 'homeharvest not importable: No module named homeharvest') });
    expect(r.status).toBe('not_available');
  });

  it('reports error and never throws when the bridge errors', async () => {
    const r = await fetchHomeHarvestComps({ city: 'Shelby', state: 'NC' }, { ...deps, runner: { async run() { throw new Error('boom'); } } });
    expect(r.status).toBe('error');
    expect(r.note).toMatch(/boom/);
  });
});
