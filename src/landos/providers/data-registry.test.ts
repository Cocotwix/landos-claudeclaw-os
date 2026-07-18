import { describe, it, expect } from 'vitest';
import { DataProviderRegistry, makeRealieParcelAdapter, REALIE_ENV_KEY } from './data-registry.js';

describe('DataProviderRegistry — parcel abstraction', () => {
  it('defaults to Realie and has no LandPortal runtime adapter', () => {
    const reg = new DataProviderRegistry();
    expect(reg.activeConfig().parcel).toBe('realie');
    expect(reg.parcel().id).toBe('realie');
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
    expect(ids).toEqual(['realie']);
  });
});

describe('Realie.ai adapter — VERIFIED official contract (offline, fixture-based)', () => {
  // The documented `property` response shape (docs.realie.ai, confirmed 2026-06).
  const REALIE_PROPERTY_FIXTURE = {
    property: {
      // Realie returns fipsCounty as the 3-digit COUNTY code (verified live: '321'),
      // and fipsState as the 2-digit state code ('13'). Canonical fips = '13321'.
      parcelId: '123-456-789', fipsCounty: '321', ownerName: 'JANE DOE',
      addressFull: '472 West Rd', city: 'Poulan', state: 'GA', zipCode: '31781',
      acres: 5.2, zoningCode: 'A-1', county: 'Worth', fipsState: '13',
      landArea: 226512, legalDesc: 'LOT 4 BLK B', subdivision: 'PINE ACRES',
    },
  };
  const KEY = { [REALIE_ENV_KEY]: 'secret-key' };
  const FIXED = () => '2026-06-26T00:00:00.000Z';

  it('makes NO call when unconfigured (no key) and never fabricates', async () => {
    let called = false;
    const realie = makeRealieParcelAdapter({ env: {}, now: FIXED, fetchImpl: async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; } });
    const p = await realie.lookup({ apn: '1', county: 'Worth', state: 'GA' }, { timeoutMs: 1000 });
    expect(called).toBe(false);
    expect(p.status).toBe('not_configured');
    expect(p.verified).toBe(false);
  });

  it('parcelId lookup: correct base/path/params, RAW Authorization key (no Bearer), canonical mapping', async () => {
    let seenUrl = ''; let seenAuth: string | undefined;
    const realie = makeRealieParcelAdapter({
      env: KEY, now: FIXED,
      fetchImpl: async (url, init) => { seenUrl = url; seenAuth = init?.headers?.authorization; return { ok: true, status: 200, json: async () => REALIE_PROPERTY_FIXTURE }; },
    });
    // ParcelLookupArgs.apn carries the parcel id for Realie's parcelId endpoint.
    const p = await realie.lookup({ apn: '123-456-789', county: 'Worth', state: 'GA' }, { timeoutMs: 1000 });
    expect(seenUrl).toContain('https://app.realie.ai/api/public/property/parcelId/?');
    expect(seenUrl).toContain('state=GA');
    expect(seenUrl).toContain('county=Worth');
    expect(seenUrl).toContain('parcelId=123-456-789');
    expect(seenAuth).toBe('secret-key');          // raw key
    expect(seenAuth).not.toMatch(/Bearer/i);      // NOT Bearer
    // canonical normalization from property.*
    expect(p.verified).toBe(true);
    expect(p.status).toBe('verified');
    expect(p.apn).toBe('123-456-789');
    expect(p.propertyId).toBe('123-456-789');
    expect(p.fips).toBe('13321');        // canonical 5-digit = fipsState + fipsCounty
    expect(p.fipsState).toBe('13');      // 2-digit part preserved
    expect(p.fipsCounty).toBe('321');    // 3-digit part preserved
    expect(p.owner).toBe('JANE DOE');
    expect(p.situsAddress).toBe('472 West Rd');
    expect(p.city).toBe('Poulan');
    expect(p.county).toBe('Worth');
    expect(p.acres).toBe(5.2);
    expect(p.zoning).toBe('A-1');
    expect(p.landArea).toBe(226512);
    expect(p.legalDesc).toBe('LOT 4 BLK B');
    expect(p.subdivision).toBe('PINE ACRES');
    // provenance preserved
    expect(p.timestamp).toBe('2026-06-26T00:00:00.000Z');
    expect(p.confidence).toBe('high');
    expect(p.matchedIdentifier).toBe('123-456-789');
    expect(p.searchedIdentifier).toContain('parcelId:123-456-789');
  });

  it('address lookup: uses /public/property/address/ with state + address (street line 1)', async () => {
    let seenUrl = '';
    const realie = makeRealieParcelAdapter({
      env: KEY, now: FIXED,
      fetchImpl: async (url) => { seenUrl = url; return { ok: true, status: 200, json: async () => REALIE_PROPERTY_FIXTURE }; },
    });
    const p = await realie.lookup({ address: '472 West Rd', state: 'GA' }, { timeoutMs: 1000 });
    expect(seenUrl).toContain('/public/property/address/?');
    expect(seenUrl).toContain('address=472+West+Rd');
    expect(seenUrl).toContain('state=GA');
    expect(seenUrl).not.toContain('parcelId');
    expect(p.verified).toBe(true);
    expect(p.searchedIdentifier).toContain('address:472 West Rd');
  });

  it('address lookup: normalizes a full address string to STREET LINE 1 only', async () => {
    let seenUrl = '';
    const realie = makeRealieParcelAdapter({
      env: KEY, now: FIXED,
      fetchImpl: async (url) => { seenUrl = url; return { ok: true, status: 200, json: async () => REALIE_PROPERTY_FIXTURE }; },
    });
    const p = await realie.lookup({ address: '472 West Rd, Poulan, GA 31781', state: 'GA' }, { timeoutMs: 1000 });
    expect(seenUrl).toContain('address=472+West+Rd');   // line 1 only
    expect(seenUrl).not.toContain('Poulan');            // city/state/zip dropped from the address param
    expect(seenUrl).not.toContain('31781');
    expect(p.verified).toBe(true);
    expect(p.searchedIdentifier).toBe('address:472 West Rd (GA)');
  });

  it('insufficient identifiers (no parcelId/address) makes NO call — Needs Verification, never coordinates', async () => {
    let called = false;
    const realie = makeRealieParcelAdapter({ env: KEY, now: FIXED, fetchImpl: async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; } });
    const p = await realie.lookup({ state: 'GA' }, { timeoutMs: 1000 });
    expect(called).toBe(false);
    expect(p.verified).toBe(false);
    expect(p.status).toBe('insufficient_identifiers');
  });

  it('404 => no_match (no fabrication); 403 => usage-limit error', async () => {
    const mk = (status: number) => makeRealieParcelAdapter({ env: KEY, now: FIXED, fetchImpl: async () => ({ ok: false, status, json: async () => ({}) }) });
    const nf = await mk(404).lookup({ apn: 'X', county: 'Worth', state: 'GA' }, { timeoutMs: 1000 });
    expect(nf.status).toBe('no_match');
    expect(nf.verified).toBe(false);
    const ul = await mk(403).lookup({ apn: 'X', county: 'Worth', state: 'GA' }, { timeoutMs: 1000 });
    expect(ul.status).toBe('error_403');
  });

  it('empty property payload => no_match, never a fabricated parcel', async () => {
    const realie = makeRealieParcelAdapter({ env: KEY, now: FIXED, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ property: {} }) }) });
    const p = await realie.lookup({ apn: 'X', county: 'Worth', state: 'GA' }, { timeoutMs: 1000 });
    expect(p.status).toBe('no_match');
    expect(p.verified).toBe(false);
  });

  // ── Canonical 5-digit FIPS rule ─────────────────────────────────────────────
  const realieReturning = (property: Record<string, unknown>) =>
    makeRealieParcelAdapter({ env: KEY, now: FIXED, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ property }) }) });

  it('FIPS: concatenates fipsState + fipsCounty into the canonical 5-digit fips', async () => {
    const p = await realieReturning({ parcelId: 'A', fipsState: '13', fipsCounty: '321' })
      .lookup({ apn: 'A', county: 'Worth', state: 'GA' }, { timeoutMs: 1000 });
    expect(p.fips).toBe('13321');
    expect(p.fipsState).toBe('13');
    expect(p.fipsCounty).toBe('321');
  });

  it('FIPS: zero-pads parts so a short county code still yields 5 digits', async () => {
    const p = await realieReturning({ parcelId: 'A', fipsState: '6', fipsCounty: '7' })
      .lookup({ apn: 'A', county: 'X', state: 'CA' }, { timeoutMs: 1000 });
    expect(p.fips).toBe('06007'); // 06 + 007
    expect(p.fipsState).toBe('6');
    expect(p.fipsCounty).toBe('7');
  });

  it('FIPS: with ONLY fipsCounty, does NOT pretend it is full FIPS (canonical fips undefined)', async () => {
    const p = await realieReturning({ parcelId: 'A', fipsCounty: '321' })
      .lookup({ apn: 'A', county: 'Worth', state: 'GA' }, { timeoutMs: 1000 });
    expect(p.fips).toBeNull();        // not derivable -> unknown, never faked
    expect(p.fipsCounty).toBe('321'); // preserved on its own
    expect(p.fipsState ?? null).toBeNull();
  });
});
