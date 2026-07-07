import { describe, it, expect } from 'vitest';
import { buildMarketPulseRead, buildGrowthRead, fetchMarketPulseRead, fetchConfirmedParcelMarketPulse, fetchAreaMarketContext, type GrowthRead } from './market-pulse-read.js';
import { confirmParcel } from './parcel-identity.js';

const NOW = '2026-07-02T00:00:00.000Z';
const measuredGrowth: GrowthRead = {
  status: 'measured', direction: 'growing', populationRecent: 11000, populationPrior: 10000,
  pctChange: 10, years: [2018, 2023], source: 'https://data.census.gov', note: 'up 10%',
};

describe('buildGrowthRead', () => {
  it('measures direction from two population snapshots', () => {
    const g = buildGrowthRead({ recent: { year: 2023, population: 10800, status: 'verified' }, prior: { year: 2018, population: 10000, status: 'verified' }, area: 'Runnels County, TX', sourceUrl: 'x', hasGeography: true });
    expect(g.status).toBe('measured');
    expect(g.direction).toBe('growing');
    expect(g.pctChange).toBe(8);
  });
  it('reads a decline', () => {
    const g = buildGrowthRead({ recent: { year: 2023, population: 9400, status: 'verified' }, prior: { year: 2018, population: 10000, status: 'verified' }, area: 'X', sourceUrl: 'x', hasGeography: true });
    expect(g.direction).toBe('declining');
  });
  it('is honest when the census key is not configured', () => {
    const g = buildGrowthRead({ recent: { year: 2023, population: null, status: 'not_configured' }, area: 'X', sourceUrl: 'https://data.census.gov', hasGeography: true });
    expect(g.status).toBe('not_configured');
    expect(g.direction).toBe('unknown');
    expect(g.source).toContain('census.gov');
  });
  it('reports no_geography without a FIPS', () => {
    expect(buildGrowthRead({ area: 'X', sourceUrl: 'x', hasGeography: false }).status).toBe('no_geography');
  });
});

describe('buildMarketPulseRead', () => {
  it('derives county price-per-acre from comps and reads it in plain English', () => {
    const mp = buildMarketPulseRead({
      county: 'Runnels', state: 'TX', parcelVerified: false, growth: measuredGrowth, nowIso: NOW,
      comps: [{ pricePerAcre: 3000 }, { price: 200000, acres: 50 }, { pricePerAcre: 5000 }],
    });
    expect(mp.eligible).toBe(true);
    expect(mp.countyPricePerAcre.status).toBe('measured');
    expect(mp.countyPricePerAcre.medianPpa).toBe(4000); // median of 3000,4000,5000
    expect(mp.plainEnglish).toContain('growing');
    expect(mp.plainEnglish).toContain('/acre');
    expect(mp.label).toBe('Local Area Context, Not Parcel Verified');
  });

  it('reports a data gap when there are no usable comps', () => {
    const mp = buildMarketPulseRead({ county: 'Runnels', state: 'TX', parcelVerified: false, growth: measuredGrowth, nowIso: NOW, comps: [] });
    expect(mp.countyPricePerAcre.status).toBe('data_gap');
    expect(mp.plainEnglish).toContain('not established yet');
  });

  it('adds a ZIP price-per-acre only when the ZIP has enough comps', () => {
    const comps = [{ pricePerAcre: 4000, zip: '79567' }, { pricePerAcre: 4200, zip: '79567' }, { pricePerAcre: 3800, zip: '79567' }, { pricePerAcre: 9000, zip: '00000' }];
    const mp = buildMarketPulseRead({ county: 'Runnels', state: 'TX', zip: '79567', parcelVerified: false, growth: measuredGrowth, nowIso: NOW, comps });
    expect(mp.zipPricePerAcre?.status).toBe('measured');
    expect(mp.zipPricePerAcre?.sampleSize).toBe(3);
  });

  it('is not eligible without city/county + state', () => {
    const mp = buildMarketPulseRead({ parcelVerified: false, growth: buildGrowthRead({ area: '—', sourceUrl: 'x', hasGeography: false }), nowIso: NOW });
    expect(mp.eligible).toBe(false);
    expect(mp.plainEnglish).toContain('Not enough location');
  });
});

describe('fetchMarketPulseRead (live wrapper, injected census)', () => {
  it('measures growth from two ACS vintages via injected fetch', async () => {
    // Injected fetch returns population per requested year (2023 higher than 2018).
    const fetchImpl = async (url: string) => {
      const year = url.match(/data\/(\d{4})\//)?.[1];
      const pop = year === '2023' ? '11500' : '10000';
      return { ok: true, status: 200, text: async () => JSON.stringify([['NAME', 'B01003_001E', 'B19013_001E', 'B25001_001E', 'B25003_002E', 'B25003_003E', 'state', 'county'], [`Runnels County, Texas`, pop, '52000', '5000', '3000', '1500', '48', '399']]) };
    };
    const mp = await fetchMarketPulseRead(
      { county: 'Runnels', state: 'TX', fips: '48399', parcelVerified: false, comps: [{ pricePerAcre: 4000 }] },
      { census: { env: { CENSUS_API_KEY: 'test-key' }, fetchImpl } },
    );
    expect(mp.growth.status).toBe('measured');
    expect(mp.growth.direction).toBe('growing');
    expect(mp.growth.populationRecent).toBe(11500);
    expect(mp.growth.populationPrior).toBe(10000);
    expect(mp.countyPricePerAcre.medianPpa).toBe(4000);
  });

  it('degrades honestly when the census key is absent', async () => {
    const mp = await fetchMarketPulseRead(
      { county: 'Runnels', state: 'TX', fips: '48399', parcelVerified: false, comps: [] },
      { census: { env: {} } },
    );
    expect(mp.growth.status).toBe('not_configured');
    expect(mp.growth.source).toContain('census.gov');
  });
});

describe('Market Pulse department gate (ConfirmedParcel)', () => {
  const confirmed = confirmParcel({
    dealCardId: 1, subjectCardId: 2, state: 'confirmed', basis: 'named source',
    confidence: 0.95, evidenceRefs: ['Realie/LandPortal'], confirmedAt: 1, confirmedBy: 'acquire', updatedAt: 1,
  })!;

  it('fetchConfirmedParcelMarketPulse yields a Parcel Verified read (identity confirmed)', async () => {
    const mp = await fetchConfirmedParcelMarketPulse(confirmed, { county: 'Runnels', state: 'TX', comps: [{ pricePerAcre: 4000 }], nowIso: NOW });
    expect(mp.parcelVerified).toBe(true);
    expect(mp.label).toBe('Parcel Verified');
    expect(mp.disclaimer).toBe(''); // no unverified disclaimer on a confirmed parcel
    expect(mp.countyPricePerAcre.medianPpa).toBe(4000);
  });

  it('fetchAreaMarketContext (candidate mode) is always Not Parcel Verified', async () => {
    const mp = await fetchAreaMarketContext({ county: 'Runnels', state: 'TX', comps: [{ pricePerAcre: 4000 }], nowIso: NOW });
    expect(mp.parcelVerified).toBe(false);
    expect(mp.label).toBe('Local Area Context, Not Parcel Verified');
    expect(mp.disclaimer).toContain('does not verify the parcel');
    // Area context is still usable for a candidate (county $/acre present, unattributed).
    expect(mp.countyPricePerAcre.medianPpa).toBe(4000);
  });

  it('COMPILE GATE: the parcel-verified pulse cannot be produced without a ConfirmedParcel', async () => {
    // @ts-expect-error a raw object is not a ConfirmedParcel — the brand blocks it,
    // so the "Parcel Verified" pulse is unreachable without passing the gate.
    await fetchConfirmedParcelMarketPulse({ dealCardId: 1 }, { county: 'Runnels', state: 'TX' });
    expect(true).toBe(true);
  });
});
