import { describe, expect, it } from 'vitest';
import {
  OWNER_STRATEGY_NAMES,
  buildDealCardOwnerAnalysis,
  buildOwnerGrades,
  buildOwnerStrategies,
  buildLandPortalCompValuation,
  buildSoldCompValuation,
  loadOwnerMarketResearch,
  type MarketMetricLookup,
} from './deal-card-owner-analysis.js';
import { buildCompRegistry, type CompRegistryCandidate } from './comp-registry.js';

const metrics = (overrides: Record<string, number | null>) => JSON.stringify({
  salesCount: null, listingCount: null, medianPrice: null, medianPricePerAcre: null,
  daysOnMarket: null, sellThroughRate: null, absorptionRate: null, monthsOfSupply: null,
  population: null, populationDensity: null, populationGrowth: null, salesDensity: null,
  ...overrides,
});

const deal30Lookup: MarketMetricLookup = ({ level, fips, county, zip, band }) => {
  if (band !== '5-10') return null;
  if (level === 'county' && (fips === '47029' || county === 'Cocke')) return {
    quarter: '2026-Q3', provider: 'LandPortal Market Research (Drill Deep)', source_ref: 'https://landportal.com/market-research/',
    level, fips, zip: '', name: 'Cocke County',
    metrics_json: metrics({ salesCount: 40, medianPrice: 96048, medianPricePerAcre: 14982, daysOnMarket: 84.05, sellThroughRate: 57.97, absorptionRate: 36.7, monthsOfSupply: 20.99, population: 36813, populationDensity: 83.1, populationGrowth: 2.55 }),
  };
  if (level === 'zip' && zip === '37843') return {
    quarter: '2026-Q3', provider: 'LandPortal Market Research (Drill Deep)', source_ref: 'https://landportal.com/market-research/',
    level, fips: '47029', zip, name: 'ZIP 37843',
    metrics_json: metrics({ salesCount: 8, medianPrice: 79008, medianPricePerAcre: 14976, daysOnMarket: 256.13, sellThroughRate: 133.33, absorptionRate: 57.14, monthsOfSupply: 9.13, population: 4426, populationDensity: 85.12, populationGrowth: 3.77 }),
  };
  return null;
};

function candidate(i: number, kind: 'sold' | 'active' = 'sold', compClass = 'vacant_land'): CompRegistryCandidate {
  return {
    provider: `source-${i}`, lane: kind, priceKind: kind, compClass,
    addressDesc: `${i} Test Rd, Newport, TN 37843`, state: 'TN', price: 60000 + i * 10000,
    acres: 5 + i, pricePerAcre: null, saleOrListDate: kind === 'sold' ? `2025-0${i}-15` : null,
    sourceUrl: `https://example.com/${i}`,
  };
}

describe('Deal Card owner analysis', () => {
  it('uses up to five LandPortal comps and exact price-per-acre arithmetic', () => {
    const rows = [
      { apn: '022', acres: 6, price: 50_000, status: 'listed' },
      { apn: '048', acres: 5.77, price: 49_000, status: 'listed' },
      { apn: '032', acres: 5, price: 46_500, status: 'listed' },
      { apn: '015', acres: 5.46, price: 49_900, status: 'listed' },
      { apn: '033', acres: 4.69, price: 37_500, status: 'listed' },
      { apn: 'far', acres: 25, price: 300_000, status: 'listed' },
    ];
    const value = buildLandPortalCompValuation(rows, 5.82);
    expect(value.comps).toHaveLength(5);
    expect(value.comps.some((row) => row.address.includes('far'))).toBe(false);
    expect(value.averagePricePerAcre).toBe(8652);
    expect(value.roughFairMarketValue).toBe(50355);
    expect(value.acquisitionBand).toEqual({ low: 20142, high: 30213 });
  });
  it('selects the 5-10 acre band for 5.82 acres and resolves Deal 30 county and ZIP independently', () => {
    const seen: string[] = [];
    const market = loadOwnerMarketResearch({ state: 'TN', county: 'Cocke County', zip: '37843', acres: 5.82 }, (input) => {
      seen.push(`${input.level}:${input.level === 'county' ? input.fips || input.county : input.zip}`);
      return deal30Lookup(input);
    });
    expect(market.band).toBe('5-10');
    expect(seen).toEqual(['county:Cocke', 'zip:37843']);
    expect(market.county?.metrics.salesCount).toBe(40);
    expect(market.zip?.metrics.salesCount).toBe(8);
    expect(market.county?.metrics.medianPricePerAcre).toBe(14982);
    expect(market.zip?.metrics.medianPricePerAcre).toBe(14976);
  });

  it('never substitutes county data when the ZIP row is missing', () => {
    const market = loadOwnerMarketResearch({ state: 'TN', county: 'Cocke County', zip: '37843', acres: 5.82 }, (input) => input.level === 'county' ? deal30Lookup(input) : null);
    expect(market.county?.area).toBe('Cocke County, TN');
    expect(market.zip).toBeNull();
    expect(market.pulse.join(' ')).toMatch(/other local geography is unavailable/i);
  });

  it('returns exactly five named grades and uses Pending when facts are unavailable', () => {
    const market = loadOwnerMarketResearch({ state: 'TN', county: 'Cocke', fips: '47029', zip: '37843', acres: 5.82 }, deal30Lookup);
    const grades = buildOwnerGrades({ report: { landportalInspection: null, reconciliation: {} as never, govDd: { flood: {} as never, wetlands: {} as never, slope: {} as never } }, operatorRecord: null, market });
    expect(grades.map((grade) => grade.name)).toEqual(['Access', 'Flood', 'Wetlands', 'Terrain & Usability', 'Market Support']);
    expect(grades).toHaveLength(5);
    expect(grades.filter((grade) => grade.name !== 'Market Support').every((grade) => grade.grade === 'Pending')).toBe(true);
  });

  it('shows accepted sold-comp division math and uses the closest available 1-5 sold comps', () => {
    const ready = buildCompRegistry({ state: 'TN', acres: 5.82 }, [candidate(1), candidate(2), candidate(3)]);
    const value = buildSoldCompValuation(ready, 5.82);
    expect(value.available).toBe(true);
    expect(value.comps).toHaveLength(3);
    expect(value.comps[0].pricePerAcre).toBe(Math.round(value.comps[0].salePrice / value.comps[0].acres));
    expect(value.roughFairMarketValue).toBe(Math.round(value.averagePricePerAcre! * 5.82));
    expect(value.acquisitionBand).toEqual({ low: Math.round(value.roughFairMarketValue! * 0.4), high: Math.round(value.roughFairMarketValue! * 0.6) });
    const oneComp = buildSoldCompValuation(buildCompRegistry({ state: 'TN', acres: 5.82 }, [candidate(1)]), 5.82);
    expect(oneComp.available).toBe(true);
    expect(oneComp.comps).toHaveLength(1);
    expect(oneComp.averagePricePerAcre).toBe(Math.round(oneComp.comps[0].salePrice / oneComp.comps[0].acres));
    expect(buildSoldCompValuation(buildCompRegistry({ state: 'TN', acres: 5.82 }, []), 5.82).available).toBe(false);
  });

  it('uses exactly the ranked five-comp shortlist and arithmetic-average sold PPA', () => {
    const registry = buildCompRegistry({ state: 'TN', acres: 5.82 }, Array.from({ length: 6 }, (_, index) => candidate(index + 1)));
    const shortlist = {
      comps: registry.validatedSold.slice(0, 5).map((comp, index) => ({
        price: comp.primary.price,
        pricePerAcre: comp.primary.pricePerAcre,
        acres: comp.acres,
        saleDateIso: comp.primary.dateIso,
        distanceMiles: index + 1,
        source: comp.providersDisplay.join(' + '),
        sourceUrl: comp.primary.sourceUrls[0] ?? null,
        addressDesc: comp.address,
        lane: 'sold',
        confidence: 'high',
        why: 'Ranked by size and location',
        score: 90 - index,
        scoreComponents: { acreageSimilarity: 40, recency: 20, laneStrength: 25, distance: 5 },
        distanceMethod: 'straight_line',
      })),
    } as never;
    const value = buildSoldCompValuation(registry, 5.82, shortlist);
    const expectedAverage = Math.round(value.comps.reduce((sum, comp) => sum + Math.round(comp.salePrice / comp.acres), 0) / 5);
    expect(value.comps).toHaveLength(5);
    expect(value.averagePricePerAcre).toBe(expectedAverage);
    expect(value.roughFairMarketValue).toBe(Math.round(expectedAverage * 5.82));
  });

  it('reuses reconciled wetland coverage when the current run object is unavailable', () => {
    const market = loadOwnerMarketResearch({ state: 'TN', county: 'Cocke', fips: '47029', zip: '37843', acres: 5.82 }, deal30Lookup);
    const grades = buildOwnerGrades({
      report: {
        landportalInspection: null,
        reconciliation: { wetlands: { primary: 'Mapped wetlands: 2.79% coverage', primarySource: 'LandPortal parcel research' } } as never,
        govDd: { flood: {} as never, wetlands: {} as never, slope: {} as never },
      },
      operatorRecord: null,
      market,
    });
    expect(grades.find((grade) => grade.name === 'Wetlands')).toMatchObject({ grade: 'A-' });
    expect(grades.find((grade) => grade.name === 'Wetlands')?.explanation).toMatch(/2\.79%/);
    expect(grades.find((grade) => grade.name === 'Wetlands')?.sourceNote).toMatch(/LandPortal parcel research/);
    expect(grades.find((grade) => grade.name === 'Wetlands')?.sourceNote).not.toMatch(/USFWS/);
  });

  it('treats an accepted no-wetlands-mapped result as zero coverage rather than missing data', () => {
    const market = loadOwnerMarketResearch({ state: 'TN', county: 'Cocke', fips: '47029', zip: '37843', acres: 5.82 }, deal30Lookup);
    const grades = buildOwnerGrades({
      report: {
        landportalInspection: null,
        reconciliation: { wetlands: { primary: 'None mapped', primarySource: 'NWI (live)' } } as never,
        govDd: { flood: {} as never, wetlands: {} as never, slope: {} as never },
      },
      operatorRecord: null,
      market,
    });
    expect(grades.find((grade) => grade.name === 'Wetlands')).toMatchObject({ grade: 'A', sourceNote: 'NWI (live)' });
  });

  it('keeps asking and improved/manufactured-home rows out of vacant-land valuation', () => {
    const rows = [candidate(1), candidate(2), candidate(3), candidate(4, 'active'), candidate(5, 'sold', 'manufactured')];
    const registry = buildCompRegistry({ state: 'TN', acres: 5.82 }, rows);
    const value = buildSoldCompValuation(registry, 5.82);
    expect(value.comps).toHaveLength(3);
    expect(value.comps.every((row) => !/4 Test|5 Test/.test(row.address))).toBe(true);
    expect(value.note).toMatch(/asking references and improved or manufactured-home sales are not used/i);
  });

  it('emits exactly the five approved substantive strategies without prohibited internal wording', () => {
    const report = { landportalInspection: { factSheet: { acres: 5.82, access: { roadFrontageFt: 218.27 } } } } as never;
    const registry = buildCompRegistry({ state: 'TN', acres: 5.82 }, []);
    const result = buildDealCardOwnerAnalysis({ report, registry, operatorRecord: null, geography: { state: 'TN', county: 'Cocke', fips: '47029', zip: '37843', acres: 5.82 }, marketLookup: deal30Lookup });
    expect(result.strategies.map((row) => row.strategy)).toEqual(OWNER_STRATEGY_NAMES);
    expect(result.strategies).toHaveLength(5);
    expect(JSON.stringify(result)).not.toMatch(/orchestrat|provider attempt|readiness|contract machinery|comp registry|ingestion|debug/i);
  });

  it('describes measured gentle terrain instead of hard-coding a steep site', () => {
    const market = loadOwnerMarketResearch({ state: 'TN', county: 'Cocke', fips: '47029', zip: '37843', acres: 5.82 }, deal30Lookup);
    const valuation = buildLandPortalCompValuation([{ acres: 5.82, price: 50_000 }], 5.82);
    const result = buildOwnerStrategies({
      report: { landportalInspection: { factSheet: { acres: 5.82, access: { roadFrontageFt: 218.27 } } } } as never,
      operatorRecord: null,
      publicRun: { tasks: [{ task: 'slope_topography', finding: { meanSlopePct: 0.9 } }] } as never,
      market,
      valuation,
    });
    expect(result.strategies[0].why).toMatch(/generally gentle terrain/i);
    expect(result.strategies[0].why).not.toMatch(/steep site|steep terrain/i);
  });

  it('updates all five strategies from persisted subdivision and manufactured-home evidence without changing valuation doctrine', () => {
    const market = loadOwnerMarketResearch({ state: 'TN', county: 'Cocke', fips: '47029', zip: '37843', acres: 5.82 }, deal30Lookup);
    const valuation = buildLandPortalCompValuation([
      { acres: 5, price: 46_500 }, { acres: 5.46, price: 49_900 }, { acres: 5.77, price: 49_000 }, { acres: 6, price: 50_000 }, { acres: 4.69, price: 37_500 },
    ], 5.82);
    const result = buildOwnerStrategies({
      report: { landportalInspection: { factSheet: { acres: 5.82, access: { roadFrontageFt: 218.27 } } } } as never,
      operatorRecord: null, market, valuation,
      publicRecords: [{
        category: 'planning_zoning_subdivision', retrieval_status: 'retrieved_yes', facts: {
          subdivision_rules: 'Planning approval, survey/plat, access, septic, utilities, and exact zoning must be confirmed.',
          practical_lot_yield: 'A two-lot planning case is the practical starting hypothesis; no lot count is approved.',
          manufactured_home_conclusion: 'A-1 permits individual mobile homes, but exact subject zoning and permits remain unconfirmed.',
        },
      }],
    });
    expect(result.strategies.map((row) => row.strategy)).toEqual(OWNER_STRATEGY_NAMES);
    expect(result.strategies).toHaveLength(5);
    expect(result.strategies[0].suitability).toBe('Strong fit');
    expect(result.strategies[2]).toMatchObject({ suitability: 'Conditional' });
    expect(result.strategies[2].why).toMatch(/two-lot planning case/i);
    expect(result.strategies[2].mainRisk).toMatch(/survey\/plat/i);
    expect(result.strategies[3].why).toMatch(/A-1 permits individual mobile homes/i);
    expect(valuation.roughFairMarketValue).toBe(50_355);
    expect(valuation.acquisitionBand).toEqual({ low: 20_142, high: 30_213 });
  });
});
