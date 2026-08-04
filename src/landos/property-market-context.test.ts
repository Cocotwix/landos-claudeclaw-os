import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestLandosDb, getLandosDb } from './db.js';
import { ingestMarketSnapshots } from './market-matrix-store.js';
import { propertyMarketContextFor } from './property-market-context.js';

function seedCayuga() {
  // The live reference row carries the "County" suffix (ingestion-sourced);
  // mirror that so name resolution is proven against real data shape.
  getLandosDb().prepare('INSERT OR IGNORE INTO landos_market_county_ref (fips, state, county_name) VALUES (?, ?, ?)')
    .run('36011', 'NY', 'Cayuga County');
  const provenance = { provider: 'LandOS Market Research (test)', extractionTimestamp: '2026-07-15T00:00:00Z' };
  const county = (acreageBand: string, metrics: Record<string, number>) => ({
    geography: { level: 'county' as const, state: 'NY', fips: '36011', countyName: 'Cayuga' },
    acreageBand, side: 'sold' as const, period: '2026-Q3', confidence: 'high' as const, metrics, provenance,
  });
  const res = ingestMarketSnapshots([
    county('all', { salesCount: 106, listingCount: 81, daysOnMarket: 98, sellThroughRate: 130.9, absorptionRate: 56.7, monthsOfSupply: 9.3, medianPrice: 65000, medianPricePerAcre: 12503, population: 76248, populationGrowth: 1.2 }),
    county('10-20', { salesCount: 11, listingCount: 5, daysOnMarket: 94, sellThroughRate: 220, absorptionRate: 68.75, monthsOfSupply: 5.53, medianPrice: 87500, medianPricePerAcre: 7643 }),
    county('20-50', { salesCount: 17, listingCount: 4, daysOnMarket: 57, sellThroughRate: 425, absorptionRate: 80.95, monthsOfSupply: 2.86, medianPrice: 105000, medianPricePerAcre: 3735 }),
    {
      geography: { level: 'zip' as const, state: 'NY', fips: '36011', countyName: 'Cayuga', zip: '13156' },
      acreageBand: 'all', side: 'sold' as const, period: '2026-Q3', confidence: 'medium' as const,
      metrics: { salesCount: 10, listingCount: 8, daysOnMarket: 55, sellThroughRate: 125, absorptionRate: 55.56, monthsOfSupply: 9.73, medianPrice: 48024, medianPricePerAcre: 5995, population: 2156, populationGrowth: 9.83 },
      provenance,
    },
  ]);
  expect(res.rejected).toBe(0);
}

describe('propertyMarketContextFor (SOP 10B read-time join)', () => {
  beforeEach(() => { _initTestLandosDb(); seedCayuga(); });

  const subject = { county: 'Cayuga', state: 'NY', zip: '13156', acres: 11.46 };

  it('joins county, ZIP, subject band, and fastest band from the Market Research store', () => {
    const ctx = propertyMarketContextFor(subject);
    expect(ctx.source).toBe('LandOS Market Research');
    expect(ctx.geography).toMatchObject({ fips: '36011', state: 'NY', zip: '13156', subjectBand: '10-20' });

    expect(ctx.county.available).toBe(true);
    expect(ctx.county.metrics).toMatchObject({ soldCount: 106, activeCount: 81, medianDaysOnMarket: 98, sellThroughRate: 130.9, monthsOfSupply: 9.3, medianPricePerAcre: 12503, population: 76248, populationGrowth: 1.2 });
    expect(ctx.county.period).toBe('2026-Q3');
    expect(ctx.county.snapshotDate).toBe('2026-07-15T00:00:00Z');

    expect(ctx.zip.available).toBe(true);
    expect(ctx.zip.metrics).toMatchObject({ soldCount: 10, activeCount: 8, medianDaysOnMarket: 55, sellThroughRate: 125, medianPricePerAcre: 5995 });

    expect(ctx.subjectBand.available).toBe(true);
    expect(ctx.subjectBand.acreageBand).toBe('10-20');
    expect(ctx.subjectBand.metrics).toMatchObject({ soldCount: 11, sellThroughRate: 220, medianDaysOnMarket: 94 });

    expect(ctx.fastestBand.available).toBe(true);
    expect(ctx.fastestBand.acreageBand).toBe('20-50');
    expect(ctx.fastestBand.metrics).toMatchObject({ sellThroughRate: 425, soldCount: 17, medianDaysOnMarket: 57 });

    expect(ctx.interpretation).toContain('220%');
    expect(ctx.interpretation).toContain('20');
  });

  it('reports a missing ZIP honestly instead of substituting another geography', () => {
    const ctx = propertyMarketContextFor({ ...subject, zip: '99999' });
    expect(ctx.zip.available).toBe(false);
    expect(ctx.zip.metrics).toBeNull();
    expect(ctx.zip.note).toContain('99999');
    // County records are unaffected.
    expect(ctx.county.available).toBe(true);
  });

  it('reports a missing subject band honestly instead of substituting another band', () => {
    const ctx = propertyMarketContextFor({ ...subject, acres: 60 });
    expect(ctx.geography.subjectBand).toBe('50+');
    expect(ctx.subjectBand.available).toBe(false);
    expect(ctx.subjectBand.metrics).toBeNull();
    // The fastest band is still reported from real retained data.
    expect(ctx.fastestBand.acreageBand).toBe('20-50');
  });

  it('handles an unresolvable county without fabricating records', () => {
    const ctx = propertyMarketContextFor({ county: 'Nowhere', state: 'NY', zip: null, acres: 11.46 });
    expect(ctx.county.available).toBe(false);
    expect(ctx.subjectBand.available).toBe(false);
    expect(ctx.fastestBand.available).toBe(false);
    expect(ctx.zip.available).toBe(false);
    expect(ctx.interpretation).toContain('unproven');
  });
});
