import { describe, it, expect } from 'vitest';
import { fetchCensusDemographics } from './census-demographics.js';

describe('census demographics (verified contract, honest not_configured)', () => {
  it('no key => not_configured (never invents a key or data)', async () => {
    const r = await fetchCensusDemographics('13321', { env: {} });
    expect(r.status).toBe('not_configured');
    expect(r.population).toBeNull();
    expect(r.fips).toBe('13321');
  });
  it('no FIPS => no_geography', async () => {
    expect((await fetchCensusDemographics('', { env: { CENSUS_API_KEY: 'k' } })).status).toBe('no_geography');
  });
  it('with key + injected fetch parses ACS county row', async () => {
    const body = JSON.stringify([
      ['NAME', 'B01003_001E', 'B19013_001E', 'B25001_001E', 'B25003_002E', 'B25003_003E', 'state', 'county'],
      ['Worth County, Georgia', '20500', '46000', '9200', '5800', '1900', '13', '321'],
    ]);
    const r = await fetchCensusDemographics('13321', { env: { CENSUS_API_KEY: 'k' }, fetchImpl: async () => ({ ok: true, status: 200, text: async () => body }), now: () => 't' });
    expect(r.status).toBe('verified');
    expect(r.population).toBe(20500);
    expect(r.medianHouseholdIncome).toBe(46000);
    expect(r.housingUnits).toBe(9200);
    expect(r.ownerOccupied).toBe(5800);
    expect(r.ownerPct).toBe(75); // 5800/(5800+1900)
    expect(r.county).toMatch(/Worth/);
  });
  it('non-JSON (quota/key issue) => error, no fabrication', async () => {
    const r = await fetchCensusDemographics('13321', { env: { CENSUS_API_KEY: 'k' }, fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html>Missing Key</html>' }) });
    expect(r.status).toBe('error');
    expect(r.population).toBeNull();
  });
});
