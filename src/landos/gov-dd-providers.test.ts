import { describe, it, expect } from 'vitest';
import { femaFloodProvider, govDdProvidersStatus, GOV_DD_LIVE_ENV, GOV_DD_PROVIDERS, type GovFetch } from './providers/gov-dd-providers.js';

const FIXED = () => '2026-06-27T00:00:00Z';

describe('gov DD providers (dormant by default, no live call)', () => {
  it('all four free providers exist (flood/wetlands/slope/demographics)', () => {
    expect(GOV_DD_PROVIDERS.map((p) => p.capability).sort()).toEqual(['demographics', 'flood', 'slope', 'wetlands']);
  });

  it('dormant by default: returns Unknown/unavailable and makes NO call', async () => {
    let called = false;
    const fetchImpl: GovFetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({ floodZone: 'AE' }) }; };
    const r = await femaFloodProvider.fetchFact({ lat: 31.5, lng: -83.7 }, { env: {}, fetchImpl, now: FIXED });
    expect(called).toBe(false);
    expect(r.status).toBe('unavailable');
    expect(r.value).toBeNull();
  });

  it('when activated + fetch injected, parses a verified value (no real network)', async () => {
    const fetchImpl: GovFetch = async () => ({ ok: true, status: 200, json: async () => ({ floodZone: 'AE' }) });
    const r = await femaFloodProvider.fetchFact({ lat: 31.5, lng: -83.7 }, { env: { [GOV_DD_LIVE_ENV]: '1' }, fetchImpl, now: FIXED });
    expect(r.status).toBe('verified');
    expect(r.value).toBe('AE');
    expect(r.sourceUrl).toContain('fema');
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
