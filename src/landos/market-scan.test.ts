import { describe, it, expect } from 'vitest';
import {
  assessLandRelevance,
  buildDataCenterWatch,
  buildMarketSignalScan,
  buildPracticalMarketMatrix,
  practicalAcreageBand,
  runMarketScan,
  DATA_CENTER_QUERY,
  type ScanFinding,
} from './market-scan.js';

describe('practical acreage-band market matrix', () => {
  it('uses all seven practical acreage bands', () => {
    expect([53, 25, 12, 7, 3, 1.5, 0.5, -1].map(practicalAcreageBand))
      .toEqual(['50+', '20-50', '10-20', '5-10', '2-5', '1-2', '0-1', null]);
  });

  it('computes market pulse metrics and bulk-versus-split arbitrage from actual rows', () => {
    const rows = [
      { status: 'sold' as const, acres: 52, price: 520_000, dateIso: '2025-02-01', daysOnMarket: 210 },
      { status: 'sold' as const, acres: 60, price: 570_000, dateIso: '2025-08-01', daysOnMarket: 180 },
      { status: 'active' as const, acres: 55, price: 610_000, dateIso: '2026-01-01', daysOnMarket: 120 },
      { status: 'sold' as const, acres: 12, price: 180_000, dateIso: '2025-01-01', daysOnMarket: 75 },
      { status: 'sold' as const, acres: 14, price: 224_000, dateIso: '2025-05-01', daysOnMarket: 68 },
      { status: 'sold' as const, acres: 10, price: 170_000, dateIso: '2025-10-01', daysOnMarket: 60 },
      { status: 'sold' as const, acres: 11, price: 198_000, dateIso: '2026-02-01', daysOnMarket: 55 },
      { status: 'active' as const, acres: 13, price: 240_000, dateIso: '2026-06-01', daysOnMarket: 45 },
    ];
    const matrix = buildPracticalMarketMatrix({
      observations: rows,
      subjectAcres: 52,
      lookbackMonths: 24,
      nowIso: '2026-07-01',
    });
    expect(matrix.bands.map((band) => band.band)).toEqual(['50+', '20-50', '10-20', '5-10', '2-5', '1-2', '0-1']);
    const bulk = matrix.bands[0];
    expect(bulk).toMatchObject({ soldVolume: 2, activeInventory: 1 });
    expect(bulk.sellThroughRate).toBeCloseTo(66.7, 1);
    expect(bulk.absorptionPerMonth).toBeCloseTo(0.08, 2);
    expect(bulk.monthsOfSupply).toBe(12);
    expect(matrix.arbitrage.status).toBe('supported');
    expect(matrix.arbitrage.bestSmallerBand).toBe('10-20');
    expect(matrix.arbitrage.premiumPercent).toBeGreaterThan(50);
    expect(matrix.bulkTractRead).toMatch(/likely resale/);
    expect(matrix.bestMovingBands).toContain('10-20');
  });

  it('keeps unsupported metrics null instead of inventing zero activity', () => {
    const matrix = buildPracticalMarketMatrix({ observations: [], subjectAcres: 53, nowIso: '2026-07-01' });
    expect(matrix.bands[0]).toMatchObject({
      soldVolume: 0,
      activeInventory: 0,
      medianPricePerAcre: null,
      medianDaysOnMarket: null,
      sellThroughRate: null,
      absorptionRate: null,
      absorptionPerMonth: null,
      monthsOfSupply: null,
      confidence: 'none',
      snapshotPeriod: null,
    });
    expect(matrix.arbitrage.status).toBe('insufficient');
  });

  it('projects internal county Market Research first with period, confidence, coverage and demographics', () => {
    const snapshot = (
      band: '50+' | '20-50' | '10-20' | '5-10' | '2-5',
      side: 'sold' | 'for_sale',
      metrics: Record<string, number>,
      period = '2026-Q2',
    ) => ({
      band,
      side,
      period,
      metrics,
      confidence: 'high' as const,
      provider: 'browser_agent:landportal',
      sourceRef: `https://example.test/${band}/${side}`,
      extractionTimestamp: '2026-07-01T12:00:00.000Z',
      coverage: `Pickens County ${side} land ${band} acres`,
    });
    const matrix = buildPracticalMarketMatrix({
      observations: [{ status: 'sold', acres: 53, price: 530_000 }],
      subjectAcres: 53,
      internalCountySnapshots: [
        snapshot('50+', 'sold', {
          salesCount: 8, medianPrice: 505_000, medianPricePerAcre: 9_800,
          daysOnMarket: 210, sellThroughRate: 36, absorptionRate: 22,
          monthsOfSupply: 18, population: 132_000, populationDensity: 112,
          populationGrowth: 2.6,
        }),
        snapshot('50+', 'for_sale', { listingCount: 12 }),
        snapshot('10-20', 'sold', {
          salesCount: 24, medianPrice: 195_000, medianPricePerAcre: 16_500,
          daysOnMarket: 62, sellThroughRate: 72, absorptionRate: 64,
          monthsOfSupply: 4.2, population: 132_000, populationDensity: 112,
          populationGrowth: 2.6,
        }),
        snapshot('10-20', 'for_sale', { listingCount: 7 }),
      ],
      nowIso: '2026-07-01',
    });

    expect(matrix.bands[0]).toMatchObject({
      soldVolume: 8,
      activeInventory: 12,
      medianSalePrice: 505_000,
      medianPricePerAcre: 9_800,
      medianDaysOnMarket: 210,
      sellThroughRate: 36,
      absorptionRate: 22,
      absorptionPerMonth: null,
      monthsOfSupply: 18,
      population: 132_000,
      populationDensity: 112,
      populationGrowth: 2.6,
      snapshotPeriod: '2026-Q2',
      confidence: 'high',
      source: 'browser_agent:landportal',
    });
    expect(matrix.bands[0].coverage).toMatch(/Pickens County/);
    expect(matrix.bestMovingBands[0]).toBe('10-20');
    expect(matrix.arbitrage).toMatchObject({
      status: 'supported',
      bestSmallerBand: '10-20',
    });
  });
});

describe('assessLandRelevance — every shown item must matter for buying land', () => {
  it('keeps land-demand drivers with a why-it-matters answer', () => {
    const cases: Array<[string, string]> = [
      ['County population growth hits 8% over five years', 'population_growth'],
      ['New 400-lot subdivision breaks ground near De Queen', 'subdivision'],
      ['Tyson announces manufacturing plant expansion', 'manufacturing'],
      ['Rural water line extension project funded for the east county', 'water_expansion'],
      ['Highway 71 widening project enters construction', 'highway_project'],
      ['Planning board approves rezoning for mixed-use', 'rezoning'],
      ['Hyperscale data center proposed on 900 acres', 'data_center'],
    ];
    for (const [text, category] of cases) {
      const r = assessLandRelevance(text);
      expect(r.relevant, text).toBe(true);
      expect(r.category, text).toBe(category);
      expect(r.whyItMatters, text).toBeTruthy();
    }
  });

  it('drops irrelevant local news — nothing without a land answer is shown', () => {
    for (const text of [
      'High school football team wins state championship',
      'Local restaurant celebrates 25th anniversary',
      'City council debates library hours',
    ]) {
      expect(assessLandRelevance(text).relevant, text).toBe(false);
    }
  });
});

describe('buildDataCenterWatch — 2025+ existence check, never an investigation', () => {
  const area = { county: 'Sevier', state: 'AR' };

  it('is honestly not_run when no search happened', () => {
    const w = buildDataCenterWatch({ ...area, findings: null });
    expect(w.status).toBe('not_run');
    expect(w.items).toEqual([]);
  });

  it('is unavailable (not fabricated) when the search source failed', () => {
    const w = buildDataCenterWatch({ ...area, findings: null, searchFailed: true });
    expect(w.status).toBe('unavailable');
  });

  it('reports none_found as a real answer when nothing matches', () => {
    const w = buildDataCenterWatch({ ...area, findings: [{ title: 'County fair announced', summary: 'Rides and food.', year: 2025 }] });
    expect(w.status).toBe('none_found');
    expect(w.summary).toMatch(/real answer/i);
  });

  it('classifies found activity and explains why it matters', () => {
    const findings: ScanFinding[] = [
      { title: 'Hyperscale data center approved in the county', summary: 'Rezoning approved for a 1,200-acre campus.', url: 'https://example.com/a', year: 2025 },
      { title: 'Residents voice opposition to data center water use', summary: 'Public hearing drew protest.', url: 'https://example.com/b', year: 2026 },
    ];
    const w = buildDataCenterWatch({ ...area, findings });
    expect(w.status).toBe('found');
    expect(w.items).toHaveLength(2);
    expect(w.items[0].status).toBe('approved');
    expect(w.items[1].status).toBe('community_opposition');
    for (const i of w.items) expect(i.whyItMatters).toBeTruthy();
    expect(w.summary).toMatch(/Data-center \/ AI-campus activity found/);
    expect(w.note).toMatch(/Existence check only/);
  });

  it('excludes pre-2025 findings (2025 and newer only)', () => {
    const w = buildDataCenterWatch({ ...area, findings: [{ title: 'Data center proposed', summary: 'Old news.', year: 2023 }] });
    expect(w.status).toBe('none_found');
  });
});

describe('buildMarketSignalScan — relevance filter with a dropped count', () => {
  it('keeps only land-relevant items and counts the dropped ones', () => {
    const s = buildMarketSignalScan({
      county: 'Sevier', state: 'AR',
      findings: [
        { title: 'New subdivision platted', summary: '60 lots on the west side.', year: 2025 },
        { title: 'Football team wins', summary: 'Great game.', year: 2025 },
      ],
    });
    expect(s.status).toBe('found');
    expect(s.items).toHaveLength(1);
    expect(s.items[0].category).toBe('subdivision');
    expect(s.items[0].whyItMatters).toBeTruthy();
    expect(s.droppedIrrelevant).toBe(1);
  });
});

describe('runMarketScan — bounded, honest live wrapper', () => {
  it('degrades to not_run with no configured search source', async () => {
    const r = await runMarketScan({
      county: 'Sevier',
      state: 'AR',
      search: null,
      subjectAcres: 53,
      marketObservations: [{ status: 'sold', acres: 55, price: 440_000, dateIso: '2026-01-01' }],
      nowIso: '2026-07-01',
    });
    expect(r.dataCenterWatch.status).toBe('not_run');
    expect(r.growthSignals.status).toBe('not_run');
    expect(r.acreageMatrix?.subjectBand).toBe('50+');
    expect(r.acreageMatrix?.bands[0].medianPricePerAcre).toBe(8_000);
  });

  it('runs exactly two bounded queries and survives one failing', async () => {
    const queries: string[] = [];
    const search = async (q: string): Promise<ScanFinding[]> => {
      queries.push(q);
      if (queries.length === 1) return [{ title: 'Data center under construction nearby', summary: 'Construction has begun.', year: 2025 }];
      throw new Error('search quota');
    };
    const r = await runMarketScan({ county: 'Sevier', state: 'AR', search });
    expect(queries).toHaveLength(2);
    expect(queries[0]).toBe(DATA_CENTER_QUERY('Sevier, AR'));
    expect(r.dataCenterWatch.status).toBe('found');
    expect(r.dataCenterWatch.items[0].status).toBe('under_construction');
    expect(r.growthSignals.status).toBe('unavailable');
  });
});
