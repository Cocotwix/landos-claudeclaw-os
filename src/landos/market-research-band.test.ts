// Multi-band collector — unit tests for the pure/store parts: request body
// building, filter-template parsing, the resumable unit ledger, and band-
// isolated retention with membership + structural counts.
import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestLandosDb } from './db.js';
import {
  buildUnitBody, filtersFromRequestBody, statesUnit, countiesUnit, zipsUnit,
  markUnit, unitStatus, bandUnitSummary, retainItems,
} from './market-research-band-collector.js';
import { fixedInitialFilters, getOrCreateMrSnapshot, listMrRows } from './market-research-snapshots.js';
import { MR_PROVIDER } from './market-research-collector.js';
import { DRILL_DEEP_ACREAGE } from './browser-playbook-landportal-market.js';

beforeEach(() => { _initTestLandosDb(); });

describe('band request building', () => {
  const FILTERS = '{"acre_range":"5-10","acre_range_min":null,"acre_range_max":null,"status":"sold","date":"365","all_data":false}';

  it('builds the page-identical form body per unit level', () => {
    expect(buildUnitBody(FILTERS, statesUnit())).toBe(
      `action=tlp_data_market_search&method=get_drill_deep&level=states&state=&county=&filters=${encodeURIComponent(FILTERS)}`);
    expect(buildUnitBody(FILTERS, countiesUnit('GA'))).toContain('level=counties&state=GA&county=&');
    expect(buildUnitBody(FILTERS, zipsUnit('GA', 'Ben Hill'))).toContain('level=zips&state=GA&county=Ben%20Hill&');
  });

  it('recovers the verbatim filters JSON from a captured request body', () => {
    const body = buildUnitBody(FILTERS, statesUnit());
    expect(filtersFromRequestBody(body)).toBe(FILTERS);
    expect(filtersFromRequestBody('action=x&level=states')).toBeNull();
  });

  it('every owner-requested band has a native supported option except composite 50+', () => {
    for (const band of ['all', '0-1', '1-2', '2-5', '5-10', '10-20', '20-50', '50-100', '100+'] as const) {
      expect(DRILL_DEEP_ACREAGE[band].supported, band).toBe(true);
      expect(DRILL_DEEP_ACREAGE[band].optionMatch, band).toBeTruthy();
    }
    expect(DRILL_DEEP_ACREAGE['50+'].supported).toBe(false);
  });
});

describe('unit ledger (resumable)', () => {
  it('marks and upgrades unit status idempotently per snapshot', () => {
    const snap = getOrCreateMrSnapshot({ quarter: '2026-Q3', filters: fixedInitialFilters('5-10'), provider: MR_PROVIDER });
    expect(unitStatus(snap.id, 'counties:GA')).toBeNull();
    markUnit(snap.id, 'counties:GA', 'failed', 0);
    expect(unitStatus(snap.id, 'counties:GA')).toBe('failed');
    markUnit(snap.id, 'counties:GA', 'retained', 159);
    expect(unitStatus(snap.id, 'counties:GA')).toBe('retained');
    markUnit(snap.id, 'zips:GA:Appling', 'empty', 0);
    expect(bandUnitSummary(snap.id)).toEqual({ retained: 1, empty: 1, failed: 0 });
    // Another band's snapshot has its own ledger.
    const other = getOrCreateMrSnapshot({ quarter: '2026-Q3', filters: fixedInitialFilters('10-20'), provider: MR_PROVIDER });
    expect(unitStatus(other.id, 'counties:GA')).toBeNull();
  });
});

describe('band retention', () => {
  it('retains payload items into the band snapshot with membership + counts', () => {
    const snap = getOrCreateMrSnapshot({ quarter: '2026-Q3', filters: fixedInitialFilters('5-10'), provider: MR_PROVIDER });
    const ret = retainItems(snap, [
      { state: 'GA', fips: 13001, county: 'Appling', zips: 2, properties: 4, median_price: 51000, median_ppa: 9000, avg_dom: 88, sell_rate: 80, month_of_supply: 9, absorption: 40, population: 18493, population_density: 36.1, population_growth: -0.1 },
      { state: 'GA', fips: '13001', county: 'Appling', zip: '31513', city_name: 'BAXLEY', properties: 3, median_price: 52000, median_ppa: 9100, avg_dom: 70, sell_rate: 75, month_of_supply: 8, absorption: 42, population: 9000, population_density: 40, population_growth: 0.5 },
    ], '2026-07-19T22:00:00.000Z');
    expect(ret.items).toBe(2);
    expect(ret.written).toBe(2);
    expect(ret.memberships).toBe(1);
    const counties = listMrRows(snap.id, 'county', 'state:GA');
    expect(counties).toHaveLength(1);
    expect(counties[0].zipCount).toBe(2);
    expect(listMrRows(snap.id, 'zip', 'county:13001').map((r) => r.zip)).toEqual(['31513']);
    // Band isolation: the 2-5 snapshot (different filter key) sees nothing.
    const bandB = getOrCreateMrSnapshot({ quarter: '2026-Q3', filters: fixedInitialFilters('2-5'), provider: MR_PROVIDER });
    expect(listMrRows(bandB.id, 'county', 'state:GA')).toHaveLength(0);
  });
});
