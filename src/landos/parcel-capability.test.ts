import { describe, it, expect, vi } from 'vitest';
import {
  resolveParcelIdentity,
  resolveParcelIdentityResult,
  activeParcelProvider,
  DEFAULT_PRIMARY_PARCEL_PROVIDER,
  type LpResolveArgs,
} from './parcel-capability.js';
import type { NormalizedParcel } from './providers/data-registry.js';
import { makeRealieParcelAdapter, REALIE_ENV_KEY } from './providers/data-registry.js';
import { mapResolveToVerification } from './duke-verification-bridge.js';

const realieParcel = (over: Partial<NormalizedParcel> = {}): NormalizedParcel => ({
  verified: false, source: 'Realie.ai', status: 'matched_needs_verification', apn: 'REALIE-APN',
  fips: '13321', propertyId: 'R-1', situsAddress: '1 Main', city: 'Poulan', county: 'Worth', state: 'GA',
  owner: 'OWNER', acres: 5, note: 'realie match', ...over,
});

describe('parcel-identity capability — provider selection', () => {
  it('intended primary default is Realie', () => {
    expect(DEFAULT_PRIMARY_PARCEL_PROVIDER).toBe('realie');
    expect(activeParcelProvider({} as NodeJS.ProcessEnv)).toBe('realie');
    expect(activeParcelProvider({ LANDOS_PARCEL_PROVIDER: 'landportal' } as any)).toBe('realie');
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

  it('never selects LandPortal as a structured fallback', async () => {
    const realieLookup = vi.fn(async () => realieParcel());
    const out = await resolveParcelIdentity({ apn: 'X', fips: '13321' }, 1000, {
      activeProvider: 'realie',
      configured: { realie: false, county_records_browser: false },
      realieLookup,
    });
    expect(out.provenance.provider).toBe('none');
    expect(out.provenance.attempted).toEqual([
      { provider: 'realie', outcome: 'unavailable' },
      { provider: 'county_records_browser', outcome: 'unavailable' },
    ]);
    expect(realieLookup).not.toHaveBeenCalled();
  });

  it('returns Needs Verification (no fabrication) when no provider is configured', async () => {
    const out = await resolveParcelIdentity({ apn: 'X', fips: '1' }, 1000, {
      configured: { realie: false, county_records_browser: false },
    });
    expect(out.provenance.provider).toBe('none');
    expect(out.result.verified).toBe(false);
    expect(out.result.status).toBe('not_verified');
    expect(out.result.match_notes).toMatch(/Needs Verification/i);
  });

  it('county_records_browser placeholder is never available yet (stays a fallback only)', async () => {
    const out = await resolveParcelIdentity({ apn: 'X', fips: '1' }, 1000, {
      activeProvider: 'county_records_browser',
      configured: { realie: false }, // county uses real (false) check
    });
    expect(out.provenance.provider).toBe('none');
  });

  it('resolveParcelIdentityResult returns just the canonical Realie result', async () => {
    const r = await resolveParcelIdentityResult({ apn: 'X', fips: '13321' }, 1000, {
      activeProvider: 'realie', configured: { realie: true }, realieLookup: async () => realieParcel({ verified: true }),
    });
    expect(r.verified).toBe(true);
    expect(r.apn).toBe('REALIE-APN');
  });

  // End-to-end: the REAL Realie adapter (fixture fetch, no live call) flowing
  // through the capability → canonical verified result. Locks the Lead→DD parcel
  // verification chain incl. 5-digit FIPS and provider provenance.
  it('real Realie adapter through the capability yields a verified canonical parcel (5-digit FIPS)', async () => {
    const REALIE_FIXTURE = {
      property: {
        parcelId: '00830-054-000', fipsCounty: '321', fipsState: '13', ownerName: 'CARROLL, MARGARET R',
        addressFull: '472 WEST RD, POULAN, GA 31781', city: 'POULAN', state: 'GA', zipCode: '31781',
        acres: 8.6, county: 'WORTH', zoningCode: 'A-1', landArea: 374616, legalDesc: 'LANDLOT:291 DIST:7 RESIDENCE',
      },
    };
    const realieLookup = makeRealieParcelAdapter({
      env: { [REALIE_ENV_KEY]: 'k' }, now: () => '2026-06-26T00:00:00Z',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => REALIE_FIXTURE }),
    }).lookup;
    const out = await resolveParcelIdentity(
      { address: '472 West Rd, Poulan, GA 31781', state: 'GA', county: 'Worth' },
      20000,
      { activeProvider: 'realie', configured: { realie: true }, realieLookup },
    );
    expect(out.provenance.provider).toBe('realie');
    expect(out.provenance.fellBack).toBe(false);
    expect(out.result.verified).toBe(true);
    expect(out.result.status).toBe('verified');
    expect(out.result.apn).toBe('00830-054-000');
    expect(out.result.fips).toBe('13321'); // canonical 5-digit flows through the capability
    expect(out.result.owner).toBe('CARROLL, MARGARET R');
    expect(out.result.zoning).toBe('A-1'); // canonical zoning (Realie zoningCode) flows through
    // A verified Realie result now carries a property_summary so DD facts flow.
    expect(out.result.property_summary).toBeDefined();
    expect(out.result.property_summary?.lot_size_acres).toBe('8.6');

    // End-to-end: the verification bridge builds normalized DD property data
    // (verified) — NOT the "Local Area Context, Not Parcel Verified" fallback.
    const v = mapResolveToVerification({ text: '472 West Rd, Worth County, GA', hasIdentifierInput: true, resolve: out.result, unavailable: false });
    expect(v.parcelVerified).toBe(true);
    expect(v.status).toBe('parcel_verified');
    expect(v.propertyData).toBeDefined();
    expect(v.propertyData?.landFacts.acres).toBe(8.6);
    expect(v.propertyData?.landFacts.zoning).toBe('A-1');
    expect(v.verificationSource).toBe('Realie.ai');
  });
});
