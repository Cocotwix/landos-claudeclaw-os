import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { LocalFsKnowledgeStore } from './knowledge-store.js';
import { evaluateCounty, loadScorecard, scoreCounty, COUNTY_METRIC_KEYS, type MetricsComputer } from './market-research.js';

function tmpStore() {
  return new LocalFsKnowledgeStore({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'landos-mkt-')) });
}

describe('Market Research — County Scorecard (7-metric)', () => {
  it('declares the seven county metrics', () => {
    expect(COUNTY_METRIC_KEYS).toHaveLength(7);
    expect(COUNTY_METRIC_KEYS).toEqual(expect.arrayContaining([
      'avgPricePerAcreUsd', 'populationDensityPerSqMi', 'daysOnMarket', 'absorptionRatePct',
      'salesDensity3yr', 'forSaleCount90d', 'sellThroughRatePct',
    ]));
  });

  it('default compute is honest "unavailable" — never fabricated — and persists the scorecard', async () => {
    const store = tmpStore();
    const entry = await evaluateCounty('Worth', 'GA', { store, nowIso: '2026-06-24T00:00:00.000Z' }, '13321');
    expect(entry.score).toBeNull(); // <3 metrics available -> not scored
    for (const k of COUNTY_METRIC_KEYS) expect(entry.metricSources[k].confidence).toBe('unavailable');
    const card = await loadScorecard(store);
    expect(card.counties).toHaveLength(1);
    expect(card.counties[0].county).toBe('Worth');
  });

  it('scores from AVAILABLE metrics only (>=3 required)', () => {
    expect(scoreCounty({ avgPricePerAcreUsd: null, populationDensityPerSqMi: null, daysOnMarket: null, absorptionRatePct: null, salesDensity3yr: null, forSaleCount90d: null, sellThroughRatePct: null })).toBeNull();
    const s = scoreCounty({ avgPricePerAcreUsd: 5000, populationDensityPerSqMi: 100, daysOnMarket: 60, absorptionRatePct: 60, salesDensity3yr: 500, forSaleCount90d: 20, sellThroughRatePct: 60 });
    expect(s).toBe(100);
  });

  it('uses connected sources when provided and upserts (no duplicate county rows)', async () => {
    const store = tmpStore();
    const computer: MetricsComputer = async () => ({
      metrics: { avgPricePerAcreUsd: 4000, populationDensityPerSqMi: 90, daysOnMarket: 70, absorptionRatePct: 55, salesDensity3yr: 450, forSaleCount90d: 30, sellThroughRatePct: 52 },
      metricSources: Object.fromEntries(COUNTY_METRIC_KEYS.map((k) => [k, { source: 'apify_landwatch', confidence: 'reported' as const }])) as any,
    });
    await evaluateCounty('Worth', 'GA', { store, computeMetrics: computer });
    await evaluateCounty('Worth', 'GA', { store, computeMetrics: computer }); // re-run
    const card = await loadScorecard(store);
    expect(card.counties).toHaveLength(1); // upsert, not append
    expect(card.counties[0].score).toBe(100);
  });
});
