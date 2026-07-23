import { describe, expect, it, vi, afterEach } from 'vitest';
import { addressesMateriallyAgree, makeLivePublicIntelligenceAdapters, type OfficialParcel } from './public-property-intelligence-live.js';

describe('official public parcel address reconciliation (unit)', () => {
  it('accepts suffix, capitalization, and one-token official normalization variants', () => {
    expect(addressesMateriallyAgree('171 Davidson Road', '171 DAVIDSON RD')).toBe(true);
    expect(addressesMateriallyAgree('171 Davidson Road', '171 CAMP DAVIDSON RD')).toBe(true);
    expect(addressesMateriallyAgree('171 Camp Davidson Road', '171 CAMP DAVIDSON RD')).toBe(true);
  });

  it('keeps genuine street-number and street-name conflicts blocked', () => {
    expect(addressesMateriallyAgree('171 Davidson Road', '172 CAMP DAVIDSON RD')).toBe(false);
    expect(addressesMateriallyAgree('171 Davidson Road', '171 LAKE SHORE RD')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Shared-architecture resilience: one provider's timeout, HTTP error, or valid
// no-match must never speak for the later applicable strategies. Only the
// caller's own signal stops the run. Beaufort SC is used because that
// jurisdiction genuinely has TWO independent strategies (the county archival
// layer, then the statewide SCDOT mirror) — nothing here is property-specific.

type Handler = (url: string, init?: RequestInit) => Promise<unknown>;

interface Routes {
  beaufort?: Handler;
  scdotRoot?: Handler;
  scdotFields?: Handler;
  scdotQuery?: Handler;
  tn?: Handler;
  flDor?: Handler;
}

const RING = [[[-80.7, 32.4], [-80.7, 32.5], [-80.6, 32.5], [-80.6, 32.4], [-80.7, 32.4]]];
const SC_APN = 'R100 000 00A 0001 0000';
// The shared request helper floors every provider deadline at 1000ms, so a real
// provider-local timeout is exercised at exactly that budget.
const TIMEOUT_MS = 1000;

describe('live public utility provenance', () => {
  it('does not substitute Beaufort GIS evidence for an unsupported Tennessee county', async () => {
    const parcel: OfficialParcel = {
      provider: 'Tennessee Comptroller public parcel layer',
      sourceUrl: 'https://example.test/tn-parcel',
      address: 'TALLEY RD', county: 'Cocke', state: 'TN', apn: '015 027 04512 000 2026',
      owner: 'JOINES TRAVIS', acres: 5.82, coordinates: { lat: 36.02987, lng: -83.11121 },
      geometry: { rings: RING as OfficialParcel['geometry']['rings'] }, datasetDate: '2026', facts: {},
    };
    const adapter = makeLivePublicIntelligenceAdapters(parcel).find((item) => item.task === 'utilities')!;
    const result = await adapter.run({
      rawInput: 'TALLEY RD', county: 'Cocke', state: 'TN', resolvedApn: parcel.apn,
      resolutionStatus: 'confirmed', resolutionExplanation: 'Official match.',
    }, { signal: new AbortController().signal, timeoutMs: 1000, startedAt: new Date().toISOString(), captureMode: 'fixture' });
    expect(result).toMatchObject({ status: 'unavailable', evidence: [] });
    expect(result.failureReason).toMatch(/no tested official county utility/i);
  });
});

const okJson = (body: unknown): Promise<unknown> => Promise.resolve({ ok: true, status: 200, json: async () => body });
const httpError = (status: number): Promise<unknown> => Promise.resolve({ ok: false, status, statusText: 'error', json: async () => ({}) });
const abortError = (): Error => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });

/** A hung provider: settles only when its own deadline (or the caller) aborts
 *  the request — the same AbortError fetch really produces in both cases. */
const hangUntilAborted = (init?: RequestInit): Promise<never> =>
  new Promise((_resolve, reject) => {
    const signal = init?.signal as AbortSignal | null | undefined;
    if (!signal) return;
    if (signal.aborted) { reject(abortError()); return; }
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });

const beaufortFeature = {
  attributes: { PIN_: SC_APN, SitusAddre: '123 MAIN ST', Owner1: 'DOE JANE', Acres: 5 },
  geometry: { rings: RING },
};
const scdotRootBody = { layers: [{ id: 7, name: 'Beaufort' }] };
const scdotFieldsBody = { fields: [{ name: 'PIN' }, { name: 'LOCADD' }, { name: 'NAME1' }, { name: 'ACRES' }] };
const scdotFeature = {
  attributes: { PIN: SC_APN, LOCADD: '123 MAIN ST', NAME1: 'DOE JANE', ACRES: 5 },
  geometry: { rings: RING },
};
const tnFeature = {
  attributes: { PARCELID: '062 059G A 03400 000 2026', ADDRESS: '171 CAMP DAVIDSON RD', COUNTY_NAME: 'Monroe', OWNER: 'DOE JANE', DEEDAC: 5 },
  geometry: { rings: RING },
};
const flFeature = {
  attributes: {
    PARCELNO: '17E20S36      2A0H0 0140', PARCEL_ID: '17E20S36      2A0H0 0140',
    STATE_PAR_ID: 'C19-000-149-6627-9', OWN_NAME: 'HISTORICAL OWNER',
    PHY_ADDR1: '7868 W DEBRA LN', PHY_ADDR2: ' ', PHY_CITY: 'HOMOSASSA', PHY_ZIPCD: 34448,
  },
  geometry: { rings: [[[-82.5631, 28.6971], [-82.5630, 28.6966], [-82.5636, 28.6966], [-82.5637, 28.6971], [-82.5631, 28.6971]]] },
};

const scInput = { address: '123 Main St', county: 'Beaufort', state: 'SC', apn: SC_APN };

const installFetch = (routes: Routes) => {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const handler = ((): Handler | undefined => {
      if (url.includes('gis.beaufortcountysc.gov')) return routes.beaufort;
      if (url.includes('smpesri.scdot.org')) {
        if (/SC_Parcels\/MapServer\?/.test(url)) return routes.scdotRoot;
        if (/SC_Parcels\/MapServer\/\d+\?/.test(url)) return routes.scdotFields;
        return routes.scdotQuery;
      }
      if (url.includes('Tennessee_Property_Boundaries')) return routes.tn;
      if (url.includes('Map_Direct/Boundaries/MapServer/16')) return routes.flDor;
      return undefined;
    })();
    if (!handler) throw new Error(`Test made an unexpected request: ${url}`);
    return handler(url, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const scdotOk = {
  scdotRoot: () => okJson(scdotRootBody),
  scdotFields: () => okJson(scdotFieldsBody),
  scdotQuery: () => okJson({ features: [scdotFeature] }),
};

/** The SCDOT layer/field index is a module-level cache; every test loads a fresh
 *  module so one test's mocked mirror metadata cannot leak into the next. */
const loadLookup = async () => {
  vi.resetModules();
  return (await import('./public-property-intelligence-live.js')).lookupOfficialParcel;
};

describe('lookupOfficialParcel — per-strategy resilience', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('isolates a provider-local timeout and still matches with a later strategy', async () => {
    const fetchMock = installFetch({ beaufort: (_url, init) => hangUntilAborted(init), ...scdotOk });
    const lookup = await loadLookup();
    const controller = new AbortController();

    const result = await lookup(scInput, TIMEOUT_MS, controller.signal);

    expect(result.status).toBe('matched');
    expect(result.parcel?.provider).toContain('South Carolina statewide parcel layer');
    expect(result.cancelled).toBeFalsy();
    // The caller's own signal was never touched by the provider's own deadline.
    expect(controller.signal.aborted).toBe(false);
    expect(result.attempted).toHaveLength(2);
    expect(result.attempted[0]).toMatchObject({ source: 'Beaufort County public archival parcel layer (2024)', status: 'unavailable' });
    expect(result.attempted[0].note).toMatch(/provider-local timeout/i);
    expect(result.attempted[1]).toMatchObject({ status: 'matched' });
    // Beaufort + SCDOT root + SCDOT fields + SCDOT query.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('isolates a provider HTTP error and still matches with a later strategy', async () => {
    installFetch({ beaufort: () => httpError(500), ...scdotOk });
    const lookup = await loadLookup();

    const result = await lookup(scInput, TIMEOUT_MS, new AbortController().signal);

    expect(result.status).toBe('matched');
    expect(result.parcel?.apn).toBe(SC_APN);
    expect(result.attempted).toHaveLength(2);
    expect(result.attempted[0]).toMatchObject({ source: 'Beaufort County public archival parcel layer (2024)', status: 'unavailable' });
    expect(result.attempted[0].note).toContain('HTTP 500');
    expect(result.attempted[1]).toMatchObject({ status: 'matched' });
  });

  it('continues past a valid no-match while a later applicable strategy remains', async () => {
    installFetch({ beaufort: () => okJson({ features: [] }), ...scdotOk });
    const lookup = await loadLookup();

    const result = await lookup(scInput, TIMEOUT_MS, new AbortController().signal);

    expect(result.status).toBe('matched');
    expect(result.parcel?.provider).toContain('South Carolina statewide parcel layer');
    expect(result.attempted).toHaveLength(2);
    expect(result.attempted[0]).toMatchObject({ source: 'Beaufort County public archival parcel layer (2024)', status: 'no_match' });
    expect(result.attempted[1]).toMatchObject({ status: 'matched' });
  });

  it('stops every remaining strategy when the caller aborts mid-flight', async () => {
    const controller = new AbortController();
    const fetchMock = installFetch({
      beaufort: (_url, init) => { controller.abort(); return hangUntilAborted(init); },
      ...scdotOk,
    });
    const lookup = await loadLookup();

    const result = await lookup(scInput, TIMEOUT_MS, controller.signal);

    expect(result.status).toBe('unavailable');
    expect(result.cancelled).toBe(true);
    expect(result.parcel).toBeNull();
    // SCDOT was applicable and was NOT attempted: cancellation, not a no-match.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const last = result.attempted[result.attempted.length - 1];
    expect(last).toMatchObject({ source: 'Official public parcel lookup', status: 'unavailable' });
    expect(last.note).toMatch(/aborted by the caller/i);
    expect(result.attempted.some((a) => a.status === 'no_match')).toBe(false);
  });

  it('attempts nothing when the caller aborts before the first strategy', async () => {
    const fetchMock = installFetch({ beaufort: () => okJson({ features: [beaufortFeature] }), ...scdotOk });
    const lookup = await loadLookup();
    const controller = new AbortController();
    controller.abort();

    const result = await lookup(scInput, TIMEOUT_MS, controller.signal);

    expect(result.cancelled).toBe(true);
    expect(result.status).toBe('unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.attempted).toHaveLength(1);
    expect(result.attempted[0].note).toMatch(/aborted by the caller/i);
  });

  it('returns unavailable with per-strategy diagnostics when every applicable strategy fails', async () => {
    installFetch({
      beaufort: () => httpError(503),
      scdotRoot: () => Promise.reject(new Error('ECONNRESET')),
      scdotFields: () => okJson(scdotFieldsBody),
      scdotQuery: () => okJson({ features: [] }),
    });
    const lookup = await loadLookup();

    const result = await lookup(scInput, TIMEOUT_MS, new AbortController().signal);

    expect(result.status).toBe('unavailable');
    expect(result.parcel).toBeNull();
    expect(result.cancelled).toBeFalsy();
    expect(result.attempted).toHaveLength(3);
    expect(result.attempted[0]).toMatchObject({ source: 'Beaufort County public archival parcel layer (2024)', status: 'unavailable' });
    expect(result.attempted[0].note).toContain('HTTP 503');
    expect(result.attempted[1]).toMatchObject({ source: 'South Carolina statewide parcel layer (SCDOT GIS mirror) — Beaufort', status: 'unavailable' });
    expect(result.attempted[1].note).toContain('ECONNRESET');
    expect(result.attempted[2]).toMatchObject({ source: 'Official public parcel lookup', status: 'unavailable' });
    expect(result.attempted[2].note).toContain('2 of 2');
    expect(result.attempted.every((a) => a.note.trim().length > 0)).toBe(true);
  });

  it('returns no_match when every applicable strategy completes and none matches', async () => {
    installFetch({
      beaufort: () => okJson({ features: [] }),
      scdotRoot: () => okJson(scdotRootBody),
      scdotFields: () => okJson(scdotFieldsBody),
      scdotQuery: () => okJson({ features: [] }),
    });
    const lookup = await loadLookup();

    const result = await lookup(scInput, TIMEOUT_MS, new AbortController().signal);

    expect(result.status).toBe('no_match');
    expect(result.parcel).toBeNull();
    expect(result.attempted).toHaveLength(2);
    expect(result.attempted.every((a) => a.status === 'no_match')).toBe(true);
    // A completed no-match is never reported as an unavailable provider.
    expect(result.attempted.some((a) => a.status === 'unavailable')).toBe(false);
  });
});

describe('lookupOfficialParcel — existing behavior preserved', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('still matches the first strategy and skips the later ones', async () => {
    const fetchMock = installFetch({ beaufort: () => okJson({ features: [beaufortFeature] }), ...scdotOk });
    const lookup = await loadLookup();

    const result = await lookup(scInput, TIMEOUT_MS, new AbortController().signal);

    expect(result.status).toBe('matched');
    expect(result.parcel?.provider).toBe('Beaufort County public archival parcel layer (2024)');
    expect(result.attempted).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still matches a Tennessee parcel by normalized street address', async () => {
    installFetch({ tn: () => okJson({ features: [tnFeature] }) });
    const lookup = await loadLookup();

    const result = await lookup({ address: '171 Camp Davidson Rd', county: 'Monroe', state: 'TN', apn: undefined }, TIMEOUT_MS);

    expect(result.status).toBe('matched');
    expect(result.parcel?.provider).toBe('Tennessee Comptroller public parcel layer');
    expect(result.parcel?.apn).toBe('062 059G A 03400 000 2026');
    expect(result.attempted).toEqual([
      { source: 'Tennessee Comptroller public parcel layer', status: 'matched', note: 'Exact normalized street address matched.' },
    ]);
  });

  it('matches a Florida APN across county formatting while preserving dated ownership as a fact', async () => {
    installFetch({ flDor: () => okJson({ features: [flFeature] }) });
    const lookup = await loadLookup();

    const result = await lookup({
      address: '7868 W Debra Ln', county: 'Citrus', state: 'FL', apn: '17E-20S-36-0000-2A0H0-0140',
    }, TIMEOUT_MS);

    expect(result.status).toBe('matched');
    expect(result.parcel).toMatchObject({
      county: 'Citrus', state: 'FL', apn: '17E20S36      2A0H0 0140', owner: null, datasetDate: '2023',
      coordinates: { lat: expect.any(Number), lng: expect.any(Number) },
    });
    expect(result.parcel?.facts.ownerAtDatasetDate).toBe('HISTORICAL OWNER');
    expect(result.attempted[0].note).toMatch(/exact normalized apn matched/i);
  });

  it('still reports an unadaptered jurisdiction without touching the network', async () => {
    const fetchMock = installFetch({});
    const lookup = await loadLookup();

    const result = await lookup({ address: '1 Main St', county: 'Cass', state: 'ND', apn: '123' }, TIMEOUT_MS);

    expect(result.status).toBe('unavailable');
    expect(result.parcel).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.attempted).toEqual([
      { source: 'Official public parcel lookup', status: 'unavailable', note: 'No tested public parcel adapter is available for this jurisdiction.' },
    ]);
  });
});
