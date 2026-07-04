import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestLandosDb } from './db.js';
import { makeFixtureMarketProvider, fixtureToPayloads } from './market-browser-provider.js';
import { MARKET_SNAPSHOT_FIXTURE } from './fixtures/market-snapshot-fixture.js';
import {
  ingestMarketSnapshots, runMarketQuery, runMarketQueryWithExplanation, getMatrixCoverage,
  saveMarketQuery, listMarketQueries, getMarketQueryById, deleteMarketQuery,
  getHeatmapData, getCountyDrilldown, listReviewQueue,
} from './market-matrix-store.js';
import { defaultMarketQuery } from './market-matrix.js';

async function ingestFixture() {
  const extraction = await makeFixtureMarketProvider().extract();
  return ingestMarketSnapshots(extraction.snapshots);
}

describe('Market Matrix store', () => {
  beforeEach(() => { _initTestLandosDb(); });

  it('ingests the fixture through the pipeline (all accepted) and reports coverage', async () => {
    const res = await ingestFixture();
    expect(res.rejected).toBe(0);
    expect(res.accepted).toBe(fixtureToPayloads(MARKET_SNAPSHOT_FIXTURE).length);
    const cov = getMatrixCoverage();
    expect(cov.countyWithDataCount).toBe(7); // 7 distinct county FIPS
    expect(cov.periods).toContain('2026-Q2');
    expect(cov.periods).toContain('2026-Q1');
  });

  it('rejects invalid records into the review queue (never silently repaired)', () => {
    const res = ingestMarketSnapshots([
      { geography: { level: 'county', state: 'GA' }, acreageBand: '2-5', side: 'sold', period: '2026-Q2', confidence: 'high', metrics: {}, provenance: { provider: 'p', extractionTimestamp: '2026-07-01T00:00:00Z' } },
    ]);
    expect(res.accepted).toBe(0);
    expect(res.rejected).toBe(1);
    const q = listReviewQueue('open');
    expect(q).toHaveLength(1);
    expect(q[0].errors.join(' ')).toMatch(/FIPS/);
  });

  it('runs a MarketQuery and reports missing-data counties as excluded (not dropped, not zero)', async () => {
    await ingestFixture();
    const q = { ...defaultMarketQuery(), scope: { states: ['GA'] }, sort: { metric: 'medianPricePerAcre' as const, direction: 'asc' as const } };
    const res = runMarketQuery(q);
    // Richmond (28500) is the lowest GA PPA and ranks first.
    expect(res.results[0].countyName).toBe('Richmond');
    // GA reference counties with no snapshot appear in exclusion reporting.
    expect(res.excludedCount).toBeGreaterThan(0);
    const bartow = res.excluded.find((e) => e.fips === '13015'); // Bartow: seeded ref, no data
    expect(bartow).toBeTruthy();
    expect(bartow?.reasons.join(' ')).toMatch(/Median \$\/acre/);
    expect(res.analyzedCount).toBe(res.includedCount + res.excludedCount);
  });

  it('produces an explanation that matches the deterministic results', async () => {
    await ingestFixture();
    const { result, explanation } = runMarketQueryWithExplanation({ ...defaultMarketQuery(), scope: { states: ['TN'] }, sort: { metric: 'populationGrowth', direction: 'desc' } });
    expect(explanation.perCounty.map((p) => p.fips)).toEqual(result.results.map((r) => r.fips));
  });

  it('saves MarketQueries that survive reload and can be deleted', async () => {
    await ingestFixture();
    const query = { ...defaultMarketQuery(), name: 'Tyler Buy Box', scope: { states: ['SC', 'TN'] } };
    const id = saveMarketQuery({ name: 'Tyler Buy Box', description: 'test', query });
    const listed = listMarketQueries();
    expect(listed.find((s) => s.id === id)?.query.scope.states).toEqual(['SC', 'TN']);
    expect(getMarketQueryById(id)?.name).toBe('Tyler Buy Box');
    expect(deleteMarketQuery(id)).toBe(true);
    expect(listMarketQueries().find((s) => s.id === id)).toBeUndefined();
  });

  it('renders heatmap cells with grey (null) for counties without data', async () => {
    await ingestFixture();
    const heat = getHeatmapData({ state: 'GA', metric: 'medianPricePerAcre', side: 'sold', acreageBand: '2-5' });
    const dekalb = heat.cells.find((c) => c.fips === '13089');
    const cobb = heat.cells.find((c) => c.fips === '13067'); // seeded ref, no data
    expect(dekalb?.value).toBe(121500);
    expect(cobb?.hasData).toBe(false);
    expect(cobb?.value).toBeNull(); // grey = Unknown, never zero
    expect(heat.knownCount).toBeGreaterThan(0);
    expect(heat.unknownCount).toBeGreaterThan(0);
  });

  it('drills into a county with full quarterly history', async () => {
    await ingestFixture();
    const d = getCountyDrilldown('13089');
    expect(d?.countyName).toBe('DeKalb');
    expect(d?.periods).toContain('2026-Q1');
    expect(d?.periods).toContain('2026-Q2');
    expect((d?.snapshots.length ?? 0)).toBeGreaterThanOrEqual(2);
  });
});
