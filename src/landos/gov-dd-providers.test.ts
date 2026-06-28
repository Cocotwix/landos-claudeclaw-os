import { describe, it, expect } from 'vitest';
import { femaFloodProvider, nwiWetlandsProvider, usgsSlopeProvider, fetchNwiWetlands, fetchUsgsSlope, govDdProvidersStatus, GOV_DD_LIVE_ENV, GOV_DD_PROVIDERS, type GovFetch } from './providers/gov-dd-providers.js';

const FIXED = () => '2026-06-27T00:00:00Z';

describe('NWI wetlands + USGS slope (verified contracts, injected fetch)', () => {
  const ON = { [GOV_DD_LIVE_ENV]: '1' };
  it('NWI: 0 features => verified None mapped; features => wetland type', async () => {
    const none = await nwiWetlandsProvider.fetchFact({ lat: 31.5, lng: -83.7 }, { env: ON, now: FIXED, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ features: [] }) }) });
    expect(none.status).toBe('verified');
    expect(none.value).toBe('None mapped');
    const wet = await nwiWetlandsProvider.fetchFact({ lat: 30.7, lng: -82.3 }, { env: ON, now: FIXED, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ features: [{ attributes: { WETLAND_TYPE: 'Freshwater Forested/Shrub Wetland' } }] }) }) });
    expect(wet.value).toMatch(/Forested/);
  });
  it('USGS: derives slope from a 5-point elevation cross', async () => {
    const vals = ['100', '100', '100', '116.5', '100']; let i = 0;
    const r = await usgsSlopeProvider.fetchFact({ lat: 35, lng: -84 }, { env: ON, now: FIXED, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ value: vals[i++] }) }) });
    expect(r.status).toBe('verified');
    expect(typeof r.value).toBe('number');
    expect(r.value as number).toBeGreaterThan(0); // 16.5m drop over 33m -> ~26.5deg
  });
  it('free helpers run without the dormant gate', async () => {
    const w = await fetchNwiWetlands(1, 2, { now: FIXED, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ features: [] }) }) });
    expect(w.status).toBe('verified');
    const s = await fetchUsgsSlope(1, 2, { now: FIXED, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ value: '50' }) }) });
    expect(s.status).toBe('verified');
  });
});

describe('gov DD providers (dormant by default, no live call)', () => {
  it('all four free providers exist (flood/wetlands/slope/demographics)', () => {
    expect(GOV_DD_PROVIDERS.map((p) => p.capability).sort()).toEqual(['demographics', 'flood', 'slope', 'wetlands']);
  });

  it('dormant by default: returns Unknown/unavailable and makes NO call', async () => {
    let called = false;
    const fetchImpl: GovFetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({ features: [{ attributes: { FLD_ZONE: 'AE', SFHA_TF: 'T' } }] }) }; };
    const r = await femaFloodProvider.fetchFact({ lat: 31.5, lng: -83.7 }, { env: {}, fetchImpl, now: FIXED });
    expect(called).toBe(false);
    expect(r.status).toBe('unavailable');
    expect(r.value).toBeNull();
  });

  it('when activated + fetch injected, parses the verified NFHL contract (no real network)', async () => {
    const fetchImpl: GovFetch = async () => ({ ok: true, status: 200, json: async () => ({ features: [{ attributes: { FLD_ZONE: 'AE', ZONE_SUBTY: '', SFHA_TF: 'T' } }] }) });
    const r = await femaFloodProvider.fetchFact({ lat: 31.5, lng: -83.7 }, { env: { [GOV_DD_LIVE_ENV]: '1' }, fetchImpl, now: FIXED });
    expect(r.status).toBe('verified');
    expect(r.value).toBe('AE');
    expect(r.sourceUrl).toContain('fema');
    expect(r.note).toMatch(/Special Flood Hazard Area/i);
    expect(r.confidence).toBe('high');
  });

  it('activated but no value -> needs_verification (never fabricated)', async () => {
    const fetchImpl: GovFetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
    const r = await femaFloodProvider.fetchFact({ lat: 1, lng: 2 }, { env: { [GOV_DD_LIVE_ENV]: '1' }, fetchImpl, now: FIXED });
    expect(r.status).toBe('needs_verification');
    expect(r.value).toBeNull();
  });

  it('status is presence-only and free; dormant unless enabled', () => {
    expect(govDdProvidersStatus({}).liveEnabled).toBe(false);
    const on = govDdProvidersStatus({ [GOV_DD_LIVE_ENV]: '1' });
    expect(on.liveEnabled).toBe(true);
    expect(on.providers.every((p) => p.cost === 'free')).toBe(true);
  });
});
