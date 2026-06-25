import { describe, it, expect } from 'vitest';
import { DataProviderRegistry, DEFAULT_DATA_SOURCES, makeRealieParcelAdapter, REALIE_ENV_KEY } from './data-registry.js';
import type { LpResolveResult } from '../landportal-client.js';

function fakeResolve(verified: boolean): (args: unknown, t: number) => Promise<LpResolveResult> {
  return async () => ({
    verified, status: verified ? 'verified' : 'multiple_candidates',
    propertyid: verified ? 'PID-1' : null, fips: verified ? '13321' : null, apn: verified ? 'APN-1' : null,
    situs_address: verified ? '472 West Rd' : null, city: verified ? 'Poulan' : null, state: verified ? 'GA' : null,
    owner: verified ? 'OWNER' : null, match_notes: 'fake', candidates: [],
    ...(verified ? { property_summary: { county: 'Worth', lot_size_acres: '5' } as any } : {}),
  });
}

describe('DataProviderRegistry — parcel abstraction', () => {
  it('defaults to the LandPortal adapter (existing integration wrapped, not hard-coded)', () => {
    const reg = new DataProviderRegistry();
    expect(reg.activeConfig().parcel).toBe('landportal');
    expect(reg.parcel().id).toBe('landportal');
  });

  it('LandPortal adapter normalizes the injected resolver result (no live call)', async () => {
    const reg = new DataProviderRegistry(DEFAULT_DATA_SOURCES, { landPortal: { resolve: fakeResolve(true) } });
    const p = await reg.parcel().lookup({ address: '472 West Rd', city: 'Poulan', state: 'GA', zip: '31781' }, { timeoutMs: 1000 });
    expect(p.source).toBe('LandPortal v2');
    expect(p.verified).toBe(true);
    expect(p.apn).toBe('APN-1');
    expect(p.county).toBe('Worth');
    expect(p.acres).toBe(5);
  });

  it('selects the Realie.ai adapter by config; stub makes no live call and never fabricates', async () => {
    const reg = new DataProviderRegistry({ parcel: 'realie' });
    expect(reg.parcel().id).toBe('realie');
    const p = await reg.parcel().lookup({ address: '1 X', city: 'Y', state: 'GA' }, { timeoutMs: 1000 });
    expect(p.verified).toBe(false);
    expect(p.status).toBe('not_configured');
    expect(p.note).toMatch(/no REALIE_API_KEY|not configured/i);
  });

  it('Realie adapter reports configured() by env presence only', () => {
    const realie = makeRealieParcelAdapter();
    expect(realie.configured({})).toBe(false);
    expect(realie.configured({ [REALIE_ENV_KEY]: 'present' })).toBe(true);
  });

  it('exposes all registered parcel providers for diagnostics', () => {
    const ids = new DataProviderRegistry().parcelProviders().map((p) => p.id).sort();
    expect(ids).toEqual(['landportal', 'realie']);
  });
});
