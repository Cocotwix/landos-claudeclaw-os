// LandOS — Market Matrix browser-extraction fixture (loadable, typed).
//
// This is the authoritative, code-loadable copy of the captured browser
// extraction in market-snapshot-fixture.json (the raw artifact). It is a .ts
// module so it compiles into dist/ and loads uniformly under tsx, node, and
// vitest without a JSON copy step. Keep it in sync with the .json artifact.
//
// It is used for development, tests, and dashboard verification, and it flows
// through the IDENTICAL ingestion pipeline (validate → store) as live browser
// extraction. Values are representative, not live market data.

export interface MarketFixtureRow {
  fips: string;
  county: string;
  state: string;
  acreageBand: string;
  side: string;
  period: string;
  confidence: string;
  metrics: Record<string, number>;
}

export interface MarketFixture {
  provider: string;
  agentRunId: string;
  extractionTimestamp: string;
  sourceRef: string;
  note: string;
  rows: MarketFixtureRow[];
}

export const MARKET_SNAPSHOT_FIXTURE: MarketFixture = {
  provider: 'browser_agent:landportal',
  agentRunId: 'fixture-2026Q2-001',
  extractionTimestamp: '2026-07-01T14:32:00Z',
  sourceRef: 'LandPortal Market Research workspace (browser extraction fixture, 6 counties)',
  note: 'Captured browser-extraction fixture used for development, tests, and dashboard verification. Flows through the identical ingestion pipeline as live extraction. Values are representative, not live market data.',
  rows: [
    { fips: '13089', county: 'DeKalb', state: 'GA', acreageBand: '2-5', side: 'sold', period: '2026-Q1', confidence: 'high',
      metrics: { salesCount: 38, listingCount: 64, medianPrice: 331000, medianPricePerAcre: 118000, daysOnMarket: 84, sellThroughRate: 37, absorptionRate: 12, monthsOfSupply: 6.4, population: 762000, populationDensity: 2710, populationGrowth: 2.9, salesDensity: 0.14 } },
    { fips: '13089', county: 'DeKalb', state: 'GA', acreageBand: '2-5', side: 'sold', period: '2026-Q2', confidence: 'high',
      metrics: { salesCount: 42, listingCount: 60, medianPrice: 345000, medianPricePerAcre: 121500, daysOnMarket: 78, sellThroughRate: 41, absorptionRate: 14, monthsOfSupply: 5.7, population: 764300, populationDensity: 2718, populationGrowth: 3.1, salesDensity: 0.15 } },
    { fips: '13089', county: 'DeKalb', state: 'GA', acreageBand: '2-5', side: 'for_sale', period: '2026-Q2', confidence: 'medium',
      metrics: { listingCount: 60, medianPrice: 379000, medianPricePerAcre: 134000, daysOnMarket: 71 } },
    { fips: '13121', county: 'Fulton', state: 'GA', acreageBand: '2-5', side: 'sold', period: '2026-Q2', confidence: 'high',
      metrics: { salesCount: 55, listingCount: 88, medianPrice: 512000, medianPricePerAcre: 205000, daysOnMarket: 66, sellThroughRate: 38, absorptionRate: 13, monthsOfSupply: 6.9, population: 1074000, populationDensity: 1990, populationGrowth: 2.4, salesDensity: 0.12 } },
    { fips: '13245', county: 'Richmond', state: 'GA', acreageBand: '2-5', side: 'sold', period: '2026-Q2', confidence: 'medium',
      metrics: { salesCount: 21, listingCount: 34, medianPrice: 96000, medianPricePerAcre: 28500, daysOnMarket: 103, sellThroughRate: 38, absorptionRate: 9, monthsOfSupply: 8.1, population: 207000, populationDensity: 640, salesDensity: 0.09 } },
    { fips: '45007', county: 'Anderson', state: 'SC', acreageBand: '2-5', side: 'sold', period: '2026-Q2', confidence: 'high',
      metrics: { salesCount: 47, listingCount: 51, medianPrice: 118000, medianPricePerAcre: 34000, daysOnMarket: 58, sellThroughRate: 48, absorptionRate: 18, monthsOfSupply: 4.3, population: 213000, populationDensity: 300, populationGrowth: 4.6, salesDensity: 0.22 } },
    { fips: '45007', county: 'Anderson', state: 'SC', acreageBand: '2-5', side: 'for_sale', period: '2026-Q2', confidence: 'medium',
      metrics: { listingCount: 51, medianPrice: 129000, medianPricePerAcre: 37500, daysOnMarket: 49 } },
    { fips: '45045', county: 'Greenville', state: 'SC', acreageBand: '2-5', side: 'sold', period: '2026-Q2', confidence: 'high',
      metrics: { salesCount: 63, listingCount: 72, medianPrice: 165000, medianPricePerAcre: 52000, daysOnMarket: 44, sellThroughRate: 53, absorptionRate: 21, monthsOfSupply: 3.4, population: 555000, populationDensity: 640, populationGrowth: 5.8, salesDensity: 0.24 } },
    { fips: '47149', county: 'Rutherford', state: 'TN', acreageBand: '2-5', side: 'sold', period: '2026-Q2', confidence: 'high',
      metrics: { salesCount: 58, listingCount: 49, medianPrice: 189000, medianPricePerAcre: 61000, daysOnMarket: 39, sellThroughRate: 61, absorptionRate: 24, monthsOfSupply: 2.5, population: 375000, populationDensity: 590, populationGrowth: 7.9, salesDensity: 0.31 } },
    { fips: '47187', county: 'Williamson', state: 'TN', acreageBand: '2-5', side: 'sold', period: '2026-Q2', confidence: 'high',
      metrics: { salesCount: 44, listingCount: 40, medianPrice: 398000, medianPricePerAcre: 132000, daysOnMarket: 41, sellThroughRate: 55, absorptionRate: 20, monthsOfSupply: 3.1, population: 268000, populationDensity: 430, populationGrowth: 8.4, salesDensity: 0.28 } },
  ],
};
