import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestLandosDb, getLandosDb } from './db.js';
import { fixedInitialFilters, getOrCreateMrSnapshot, recordMrMetrics } from './market-research-snapshots.js';
import { ingestMarketSnapshots } from './market-matrix-store.js';
import {
  mrBridgeCountyFips,
  mrBridgeCountyName,
  mrBridgeCountyRows,
  mrBridgeLookup,
} from './market-research-store-bridge.js';
import { resolveMarketMatrix } from './market-matrix-read.js';
import { propertyMarketContextFor } from './property-market-context.js';

const PROVIDER = 'LandPortal Market Research (Drill Deep)';

/** Barry County, MO — a county the Market Matrix table never ingested, exactly
 *  like the ~2,900 counties the quarterly collection covers and it does not. */
function seedMarketResearchOnlyCounty(): void {
  const band = (acreageBand: '20-50' | '5-10' | 'all', metrics: Record<string, number>, zip?: string) => {
    const snapshot = getOrCreateMrSnapshot({
      quarter: '2026-Q3',
      filters: fixedInitialFilters(acreageBand),
      provider: PROVIDER,
      collectedAt: '2026-07-20T07:05:44.423Z',
    });
    recordMrMetrics(snapshot.id, [{
      geography: zip
        ? { level: 'zip', state: 'MO', fips: '29009', zip }
        : { level: 'county', state: 'MO', fips: '29009', name: 'Barry County' },
      metrics,
      provider: PROVIDER,
      sourceRef: 'landportal-drill-deep',
      observedAt: '2026-07-20T07:05:44.423Z',
    }]);
  };
  band('20-50', { salesCount: 18, medianPrice: 239552, medianPricePerAcre: 7834, daysOnMarket: 137.12, sellThroughRate: 62.07, absorptionRate: 38.3, monthsOfSupply: 19.6, population: 35033, populationDensity: 44.29, populationGrowth: 1.11 });
  band('5-10', { salesCount: 41, medianPricePerAcre: 12500, daysOnMarket: 96, sellThroughRate: 71 });
  band('all', { salesCount: 190, medianPricePerAcre: 9100, daysOnMarket: 118, sellThroughRate: 64 });
  band('20-50', { salesCount: 2, medianPricePerAcre: 7832, daysOnMarket: 981, sellThroughRate: 200 }, '65625');
}

describe('market-research-store-bridge', () => {
  beforeEach(() => { _initTestLandosDb(); seedMarketResearchOnlyCounty(); });

  it('reads a retained county band the Market Matrix table never held', () => {
    const row = mrBridgeLookup({ level: 'county', fips: '29009', band: '20-50', side: 'sold' });
    expect(row).not.toBeNull();
    expect(row!.period).toBe('2026-Q3');
    expect(row!.provider).toBe(PROVIDER);
    expect(JSON.parse(row!.metrics_json).medianPricePerAcre).toBe(7834);
  });

  it('never answers the for-sale side, which the collection does not carry', () => {
    expect(mrBridgeLookup({ level: 'county', fips: '29009', band: '20-50', side: 'for_sale' })).toBeNull();
  });

  it('never invents a band the collection did not run', () => {
    expect(mrBridgeLookup({ level: 'county', fips: '29009', band: '50+', side: 'sold' })).toBeNull();
  });

  it('returns nothing for a geography the collection never covered', () => {
    expect(mrBridgeLookup({ level: 'county', fips: '29011', band: '20-50', side: 'sold' })).toBeNull();
  });

  it('lists every retained band for the county, newest snapshot per band', () => {
    const rows = mrBridgeCountyRows('29009');
    expect(rows.map((row) => row.acreage_band).sort()).toEqual(['20-50', '5-10', 'all']);
    expect(rows.every((row) => row.side === 'sold' && row.geo_level === 'county')).toBe(true);
  });

  it('resolves a county FIPS by name where the matrix reference has no row', () => {
    expect(mrBridgeCountyFips('Barry', 'MO')).toBe('29009');
    expect(mrBridgeCountyFips('Barry County', 'MO')).toBe('29009');
    expect(mrBridgeCountyName('29009')).toBe('Barry');
    expect(mrBridgeCountyFips('Barry', 'TN')).toBeNull();
  });
});

describe('the market read over a county only the Market Research collection covers', () => {
  beforeEach(() => { _initTestLandosDb(); seedMarketResearchOnlyCounty(); });

  it('resolves instead of reporting that no record exists', () => {
    const res = resolveMarketMatrix({ state: 'MO', county: 'Barry', acreageBand: '20-50', side: 'sold' });
    expect(res.available).toBe(true);
    expect(res.resolvedKey).toBe('county:29009');
    expect(res.period).toBe('2026-Q3');
    expect(res.facts.pricePerAcre).toBe(7834);
    expect(res.facts.daysOnMarket).toBeCloseTo(137.12, 2);
  });

  it('fills the county, subject-band and fastest-band records and the liquidity read', () => {
    const ctx = propertyMarketContextFor({ county: 'Barry', state: 'MO', zip: null, acres: 40 });
    expect(ctx.geography.fips).toBe('29009');
    expect(ctx.county.available).toBe(true);
    expect(ctx.subjectBand.available).toBe(true);
    expect(ctx.subjectBand.metrics?.medianPricePerAcre).toBe(7834);
    expect(ctx.fastestBand.available).toBe(true);
    expect(ctx.fastestBand.acreageBand).toBe('5-10');
    expect(ctx.read.headline).toMatch(/\$7,834\/acre/);
    expect(ctx.liquidity.summary).toMatch(/18 sold/);
    // The collection is sold-side only: competition stays unmeasured, not zero.
    expect(ctx.liquidity.competition).toBeNull();
  });

  it('still lets an ingested Market Matrix row win its own slot', () => {
    const res = ingestMarketSnapshots([{
      geography: { level: 'county' as const, state: 'MO', fips: '29009', countyName: 'Barry' },
      acreageBand: '20-50', side: 'sold' as const, period: '2026-Q3', confidence: 'high' as const,
      metrics: { salesCount: 18, medianPricePerAcre: 9999 },
      provenance: { provider: 'Matrix ingestion', extractionTimestamp: '2026-08-01T00:00:00Z' },
    }]);
    expect(res.rejected).toBe(0);
    const read = resolveMarketMatrix({ state: 'MO', county: 'Barry', acreageBand: '20-50', side: 'sold' });
    expect(read.facts.pricePerAcre).toBe(9999);
    expect(read.provider).toBe('Matrix ingestion');
  });

  it('never lets an empty ZIP record outrank a county record with real activity', () => {
    // The collection covers every ZIP, so a rural ZIP reliably HAS a row for the
    // subject band — and it is often a row recording nothing. First-key-wins
    // would headline "0 recorded sales" over a county holding real sales.
    const snapshot = getOrCreateMrSnapshot({
      quarter: '2026-Q3', filters: fixedInitialFilters('20-50'), provider: PROVIDER, collectedAt: '2026-07-20T07:05:44.423Z',
    });
    recordMrMetrics(snapshot.id, [{
      geography: { level: 'zip', state: 'MO', fips: '29009', zip: '65747' },
      metrics: { salesCount: 0, sellThroughRate: 0, medianPricePerAcre: null, daysOnMarket: null },
      provider: PROVIDER, sourceRef: 'landportal-drill-deep', observedAt: '2026-07-20T07:05:44.423Z',
    }]);

    const res = resolveMarketMatrix({ state: 'MO', county: 'Barry', zip: '65747', acreageBand: '20-50', side: 'sold' });
    expect(res.resolvedKey).toBe('county:29009');
    expect(res.facts.pricePerAcre).toBe(7834);
  });

  it('still answers from an empty record when nothing carries real activity, and says so', () => {
    getLandosDb().prepare("DELETE FROM landos_mr_metric").run();
    const snapshot = getOrCreateMrSnapshot({
      quarter: '2026-Q3', filters: fixedInitialFilters('20-50'), provider: PROVIDER, collectedAt: '2026-07-20T07:05:44.423Z',
    });
    recordMrMetrics(snapshot.id, [{
      geography: { level: 'zip', state: 'MO', fips: '29009', zip: '65747' },
      metrics: { salesCount: 0, sellThroughRate: 0 },
      provider: PROVIDER, sourceRef: 'landportal-drill-deep', observedAt: '2026-07-20T07:05:44.423Z',
    }]);
    const res = resolveMarketMatrix({ state: 'MO', county: 'Barry', zip: '65747', acreageBand: '20-50', side: 'sold' });
    expect(res.available).toBe(true);
    expect(res.resolvedKey).toBe('zip:65747');
    expect(res.note).toMatch(/recorded no sales activity/i);
  });

  it('reports honestly when neither store covers the county', () => {
    getLandosDb().prepare("DELETE FROM landos_mr_metric").run();
    const res = resolveMarketMatrix({ state: 'MO', county: 'Barry', acreageBand: '20-50', side: 'sold' });
    expect(res.available).toBe(false);
    expect(res.note).toMatch(/No Market Matrix snapshot/);
  });
});
