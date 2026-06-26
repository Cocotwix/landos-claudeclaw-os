import { describe, it, expect, vi } from 'vitest';
import {
  resolveParcelIdentity,
  resolveParcelIdentityResult,
  activeParcelProvider,
  DEFAULT_PRIMARY_PARCEL_PROVIDER,
  type LpResolveArgs,
  type LpResolveResult,
} from './parcel-capability.js';
import type { NormalizedParcel } from './providers/data-registry.js';

const lpOk = (over: Partial<LpResolveResult> = {}): LpResolveResult => ({
  verified: true, status: 'verified', propertyid: 'PID-1', fips: '13321', apn: 'LP-APN',
  situs_address: '1 Main', city: 'Poulan', state: 'GA', owner: 'OWNER', match_notes: 'landportal ok', candidates: [], ...over,
});
const realieParcel = (over: Partial<NormalizedParcel> = {}): NormalizedParcel => ({
  verified: false, source: 'Realie.ai', status: 'matched_needs_verification', apn: 'REALIE-APN',
  fips: '13321', propertyId: 'R-1', situsAddress: '1 Main', city: 'Poulan', county: 'Worth', state: 'GA',
  owner: 'OWNER', acres: 5, note: 'realie match', ...over,
});

describe('parcel-identity capability — provider selection', () => {
  it('intended primary default is Realie', () => {
    expect(DEFAULT_PRIMARY_PARCEL_PROVIDER).toBe('realie');
    expect(activeParcelProvider({} as NodeJS.ProcessEnv)).toBe('realie');
    expect(activeParcelProvider({ LANDOS_PARCEL_PROVIDER: 'landportal' } as any)).toBe('landportal');
  });

  it('uses Realie when it is the active provider AND configured (no fallback)', async () => {
    const realieLookup = vi.fn(async () => realieParcel());
    const out = await resolveParcelIdentity({ address: '1 Main', state: 'GA' }, 1000, {
      activeProvider: 'realie', configured: { realie: true }, realieLookup,
    });
    expect(out.provenance.provider).toBe('realie');
    expect(out.provenance.fellBack).toBe(false);
    expect(out.result.apn).toBe('REALIE-APN');
    expect(realieLookup).toHaveBeenCalledOnce();
  });

  it('forwards EXACT identifiers only — never coordinates/point to identify a parcel', async () => {
    let received: any;
    const realieLookup = vi.fn(async (a: any) => { received = a; return realieParcel(); });
    await resolveParcelIdentity(
      { address: '1 Main', state: 'GA', point: { latitude: 34.9, longitude: -77.8 } } as unknown as LpResolveArgs,
      1000,
      { activeProvider: 'realie', configured: { realie: true }, realieLookup },
    );
    expect(received).toBeDefined();
    expect(JSON.stringify(received)).not.toMatch(/latitude|longitude|point/i);
    expect(received.address).toBe('1 Main');
  });

  it('falls back to a CONFIGURED provider and reports it (never a silent substitution)', async () => {
    const landPortalResolve = vi.fn(async () => lpOk());
    const realieLookup = vi.fn(async () => realieParcel());
    const out = await resolveParcelIdentity({ apn: 'X', fips: '13321' }, 1000, {
      activeProvider: 'realie',
      configured: { realie: false, landportal: true },
      landPortalResolve, realieLookup,
    });
    expect(out.provenance.provider).toBe('landportal');
    expect(out.provenance.fellBack).toBe(true);
    expect(out.provenance.reason).toMatch(/not a silent substitution/i);
    expect(out.provenance.attempted).toEqual([
      { provider: 'realie', outcome: 'unavailable' },
      { provider: 'landportal', outcome: 'used' },
    ]);
    expect(realieLookup).not.toHaveBeenCalled();
    expect(landPortalResolve).toHaveBeenCalledOnce();
    expect(out.result.apn).toBe('LP-APN');
  });

  it('returns Needs Verification (no fabrication) when no provider is configured', async () => {
    const out = await resolveParcelIdentity({ apn: 'X', fips: '1' }, 1000, {
      configured: { realie: false, landportal: false, county_records_browser: false },
    });
    expect(out.provenance.provider).toBe('none');
    expect(out.result.verified).toBe(false);
    expect(out.result.status).toBe('not_verified');
    expect(out.result.match_notes).toMatch(/Needs Verification/i);
  });

  it('county_records_browser placeholder is never available yet (stays a fallback only)', async () => {
    const out = await resolveParcelIdentity({ apn: 'X', fips: '1' }, 1000, {
      activeProvider: 'county_records_browser',
      configured: { realie: false, landportal: false }, // county uses real (false) check
    });
    expect(out.provenance.provider).toBe('none');
  });

  it('resolveParcelIdentityResult returns just the canonical result', async () => {
    const r = await resolveParcelIdentityResult({ apn: 'X', fips: '13321' }, 1000, {
      activeProvider: 'landportal', configured: { landportal: true }, landPortalResolve: async () => lpOk(),
    });
    expect(r.verified).toBe(true);
    expect(r.apn).toBe('LP-APN');
  });
});
