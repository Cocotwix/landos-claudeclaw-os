import { beforeEach, describe, it, expect } from 'vitest';
import { _initTestLandosDb } from './db.js';
import { createDealCard } from './deal-card.js';
import { listComps } from './comps.js';
import {
  retrieveComps,
  selectCompProviders,
  filterComps,
  isWithinRecencyWindow,
  defaultCompRegistry,
  makeStubCompProvider,
  saveRetrievedComps,
  LANDPORTAL_DAILY_COMP_CAP,
  type CompProvider,
  type RetrievedComp,
} from './comp-retrieval.js';

const LOOKUP = '2026-06-19T00:00:00.000Z';

beforeEach(() => {
  _initTestLandosDb();
});

describe('recency window', () => {
  it('accepts sales within 12 months and rejects older/future', () => {
    expect(isWithinRecencyWindow('2025-12-01T00:00:00Z', LOOKUP)).toBe(true);
    expect(isWithinRecencyWindow('2025-01-01T00:00:00Z', LOOKUP)).toBe(false); // > 12 mo
    expect(isWithinRecencyWindow('2026-12-01T00:00:00Z', LOOKUP)).toBe(false); // future
  });
});

describe('provider selection', () => {
  it('always selects Redfin + Zillow, never Trulia', () => {
    const ids = selectCompProviders({}, defaultCompRegistry()).map((p) => p.id);
    expect(ids).toContain('redfin');
    expect(ids).toContain('zillow');
    expect(ids).not.toContain('trulia' as never);
  });

  it('adds LandWatch only at 40+ acres', () => {
    expect(selectCompProviders({ acres: 39 }, defaultCompRegistry()).map((p) => p.id)).not.toContain('landwatch');
    expect(selectCompProviders({ acres: 41 }, defaultCompRegistry()).map((p) => p.id)).toContain('landwatch');
  });

  it('drops LandPortal once the daily comp cap is hit', () => {
    const under = selectCompProviders({}, defaultCompRegistry(), { landportalCompsUsedToday: LANDPORTAL_DAILY_COMP_CAP - 1 });
    expect(under.map((p) => p.id)).toContain('landportal');
    const over = selectCompProviders({}, defaultCompRegistry(), { landportalCompsUsedToday: LANDPORTAL_DAILY_COMP_CAP });
    expect(over.map((p) => p.id)).not.toContain('landportal');
  });
});

describe('filterComps', () => {
  const good: RetrievedComp = { price: 50_000, saleDateIso: '2026-01-01T00:00:00Z', acres: 10, pricePerAcre: null, sourceUrl: 'https://redfin.com/x', sourceLabel: 'redfin' };
  it('drops comps with no URL, stale, or wildly off-target acreage with reasons', () => {
    const comps: RetrievedComp[] = [
      good,
      { ...good, sourceUrl: '' },
      { ...good, saleDateIso: '2024-01-01T00:00:00Z' },
      { ...good, acres: 200 },
    ];
    const { kept, excluded } = filterComps(comps, { acres: 10 }, LOOKUP);
    expect(kept).toHaveLength(1);
    expect(excluded).toHaveLength(3);
    expect(excluded.map((e) => e.reason).join(' ')).toMatch(/source URL|outside the rolling|off-target/i);
  });

  it('computes price-per-acre when missing', () => {
    const { kept } = filterComps([good], { acres: 10 }, LOOKUP);
    expect(kept[0].pricePerAcre).toBe(5_000);
  });
});

describe('retrieveComps orchestration', () => {
  it('FAILS LOUD with stubs: no comps, never invented', async () => {
    const res = await retrieveComps({ address: '123 Main St', acres: 10, lookupDateIso: LOOKUP });
    expect(res.hasComps).toBe(false);
    expect(res.comps).toHaveLength(0);
    expect(res.note).toMatch(/not invented/i);
    expect(res.providers.every((p) => p.status === 'not_connected')).toBe(true);
  });

  it('APN-only (no address) returns graceful no_comps from address-centric sources', async () => {
    const res = await retrieveComps({ apn: '123-45', county: 'X', state: 'SC', acres: 5, lookupDateIso: LOOKUP });
    const redfin = res.providers.find((p) => p.providerId === 'redfin')!;
    expect(redfin.status).toBe('no_comps');
  });

  it('keeps verifiable comps from a live provider and filters the rest', async () => {
    const liveRedfin: CompProvider = {
      id: 'redfin', label: 'Redfin', supportsAddress: true, supportsApnOnly: false,
      async retrieve() {
        return {
          providerId: 'redfin', status: 'connected', note: 'ok',
          comps: [
            { price: 60_000, saleDateIso: '2026-02-01T00:00:00Z', acres: 9, pricePerAcre: null, sourceUrl: 'https://redfin.com/a', sourceLabel: 'redfin' },
            { price: 99_000, saleDateIso: '2020-01-01T00:00:00Z', acres: 9, pricePerAcre: null, sourceUrl: 'https://redfin.com/b', sourceLabel: 'redfin' }, // stale
          ],
        };
      },
    };
    const registry = [liveRedfin, makeStubCompProvider('zillow', 'Zillow')];
    const res = await retrieveComps({ address: '1 A St', acres: 10, lookupDateIso: LOOKUP }, { registry });
    expect(res.hasComps).toBe(true);
    expect(res.comps).toHaveLength(1);
    expect(res.comps[0].sourceUrl).toMatch(/^https?:\/\//);
    expect(res.excluded.length).toBeGreaterThanOrEqual(1);
  });

  it('respects the overall budget cap (marks later sources partial)', async () => {
    const slow: CompProvider = {
      id: 'redfin', label: 'Redfin', supportsAddress: true, supportsApnOnly: false,
      async retrieve() { return { providerId: 'redfin', status: 'connected', comps: [], note: 'ok' }; },
    };
    let t = 0;
    const res = await retrieveComps(
      { address: '1 A St', acres: 10, lookupDateIso: LOOKUP },
      { registry: [slow, makeStubCompProvider('zillow', 'Zillow')], overallCapMs: 10, now: () => (t += 100) },
    );
    expect(res.partial).toBe(true);
  });
});

describe('saveRetrievedComps', () => {
  it('persists only URL-bearing comps onto the deal card', () => {
    const deal = createDealCard({ entity: 'LAND_ALLY', title: 'T' });
    const comps: RetrievedComp[] = [
      { price: 50_000, saleDateIso: '2026-01-01T00:00:00Z', acres: 10, pricePerAcre: 5000, sourceUrl: 'https://redfin.com/x', sourceLabel: 'redfin' },
      { price: 60_000, saleDateIso: '2026-01-01T00:00:00Z', acres: 10, pricePerAcre: 6000, sourceUrl: '', sourceLabel: 'zillow' },
    ];
    const n = saveRetrievedComps('LAND_ALLY', deal.id, comps);
    expect(n).toBe(1);
    expect(listComps({ dealCardId: deal.id })).toHaveLength(1);
  });
});
