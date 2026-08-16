import { describe, expect, it, vi, afterEach } from 'vitest';
import { addressesMateriallyAgree, governmentFactsFromPublicRecordOutcomes, makeLivePublicIntelligenceAdapters, makePracticalDiscoveryScreeningAdapters, makePracticalSubjectAttemptAdapters, tennesseeApnLookupClauses, tennesseeOwnerNamesReconcile, type OfficialParcel } from './public-property-intelligence-live.js';

describe('practical subject government attempts', () => {
  it('projects a newly persisted official recorder result into the current Deal Card read', () => {
    const facts = governmentFactsFromPublicRecordOutcomes([{
      id: 19,
      retrieval_status: 'retrieved_yes',
      authority: 'Pickens County Register of Deeds',
      title: 'Recorded deed 202518326',
      searched_at: '2026-07-29T14:54:40.939Z',
      source_url: 'https://www.pickensscrod.us/AcclaimWeb/Details/',
      document_url: 'https://www.pickensscrod.us/AcclaimWeb/Image/DocumentImage1/1433732',
      facts: {
        apn: '4165-00-51-3961',
        instrumentNumber: '202518326',
        recordBookPage: '2895/123',
        consideration: '$490,000.00',
      },
    }, {
      id: 20,
      retrieval_status: 'retrieved_no',
      authority: 'Attempt only',
      facts: { apn: 'must not render' },
    }]);
    expect(facts.map((fact) => [fact.label, fact.value])).toEqual([
      ['Parcel number (APN)', '4165-00-51-3961'],
      ['Instrument number', '202518326'],
      ['Recorded book / page', '2895/123'],
      ['Recorded consideration', '$490,000.00'],
    ]);
    expect(facts.every((fact) =>
      fact.grade === 'confirmed_fact'
      && fact.sourceUrl?.includes('/Image/DocumentImage1/1433732'))).toBe(true);
  });

  it('projects tax, improvement and manufactured-home ownership fields with operator labels', () => {
    const facts = governmentFactsFromPublicRecordOutcomes([{
      id: 21,
      retrieval_status: 'retrieved_yes',
      authority: 'White County Tax Commissioner',
      searched_at: '2026-08-15T12:00:00.000Z',
      source_url: 'https://tax.whitecountyga.gov/property/021033002',
      facts: {
        taxAmount: '$912.08', taxYear: '2026', taxStanding: 'Current / no delinquency shown by the public tax record',
        structureType: 'Mobile home', yearBuilt: '1998', buildingSqft: '1,680 sq ft',
        manufacturedHomeAssessmentStatus: 'Separate tax/account record', manufacturedHomeAccount: 'MH-009184',
        manufacturedHomeOwnershipMatch: 'Different owner — home: HOME OWNER LLC; land: LAND OWNER LLC',
      },
    }]);
    expect(facts.map((fact) => fact.label)).toEqual(expect.arrayContaining([
      'Current property-tax amount', 'Property-tax year', 'Property-tax standing',
      'Improvement / structure type', 'Year built', 'Building square footage',
      'Manufactured-home assessment status', 'Manufactured-home tax/account number',
      'Manufactured-home owner compared with land owner',
    ]));
    expect(facts.every((fact) => fact.source === 'White County Tax Commissioner')).toBe(true);
  });

  it('carries a real failed browser attempt into the county lane instead of reporting not attempted', async () => {
    const [adapter] = makePracticalSubjectAttemptAdapters([{
      source: 'Example County Assessor property search',
      url: 'https://county.example.test/search',
      status: 'error',
      note: 'Interactive public search returned an error after the attempt.',
      attemptedAt: '2026-07-28T12:00:00.000Z',
    }]);
    expect(adapter?.task).toBe('county_records');
    const result = await adapter!.run({
      rawInput: '100 Main St, Kingston, TN 37763',
      normalizedAddress: '100 Main St, Kingston, TN 37763',
      county: 'Roane',
      state: 'TN',
      zip: '37763',
      resolutionStatus: 'unresolved',
      discoveryUsable: true,
      resolutionExplanation: 'Exact marketplace parcel identity established for discovery.',
    }, {
      startedAt: '2026-07-28T12:00:00.000Z',
      captureMode: 'live',
      timeoutMs: 5_000,
      signal: new AbortController().signal,
    });
    expect(result.status).toBe('unavailable');
    expect(result.finding?.summary).toMatch(/error/i);
    expect(result.evidence).toHaveLength(1);
  });

  it('carries separately sourced browser facts into the canonical county finding', async () => {
    const [adapter] = makePracticalSubjectAttemptAdapters([{
      source: 'Pickens County Assessor',
      url: 'https://pickens.example.test/assessor',
      status: 'retrieved',
      note: 'Official parcel record retrieved.',
      attemptedAt: '2026-07-28T12:00:00.000Z',
    }, {
      source: 'Pickens County Register of Deeds',
      url: 'https://pickens.example.test/deeds',
      status: 'useful_indication',
      note: 'Recorder destination reached; deed reference retained.',
      attemptedAt: '2026-07-28T12:01:00.000Z',
    }], [{
      field: 'Owner of record',
      value: 'JEANETTE S WINCHESTER REVOCABLE TRUST',
      source: 'Pickens County Assessor',
      url: 'https://pickens.example.test/assessor',
      classification: 'official_record',
    }, {
      field: 'Deed book/page',
      value: 'Book 100, Page 200',
      source: 'Pickens County Register of Deeds',
      url: 'https://pickens.example.test/deeds',
      classification: 'recorded_instrument',
    }]);
    const result = await adapter!.run({
      rawInput: '3573 Moorefield Memorial Hwy',
      county: 'Pickens',
      state: 'SC',
      resolvedApn: '4183-00-45-1068',
      resolutionStatus: 'confirmed',
      resolutionExplanation: 'Confirmed.',
    }, {
      startedAt: '2026-07-28T12:00:00.000Z',
      captureMode: 'live',
      timeoutMs: 5_000,
      signal: new AbortController().signal,
    });
    expect(result.status).toBe('succeeded');
    expect(result.finding?.kind).toBe('county_records');
    if (result.finding?.kind === 'county_records') {
      expect(result.finding.facts).toHaveLength(2);
      expect(result.finding.facts[1].classification).toBe('recorded_instrument');
    }
    expect(result.evidence.map((item) => item.sourceName)).toEqual([
      'Pickens County Assessor',
      'Pickens County Register of Deeds',
    ]);
  });
});

describe('discovery-grade public-core screening', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('checks the official Pickens utility page without claiming address-level service', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '<html><body>Water and Sewer service. Outside City rates.</body></html>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    )));
    const [adapter] = makePracticalDiscoveryScreeningAdapters({ county: 'Pickens', state: 'SC' });
    expect(adapter.task).toBe('utilities');
    const result = await adapter.run({
      rawInput: '3573 Moorefield Memorial Hwy',
      county: 'Pickens',
      state: 'SC',
      resolutionStatus: 'provisional',
      discoveryUsable: true,
      resolutionExplanation: 'Exact LandPortal subject.',
    }, {
      startedAt: '2026-07-28T12:00:00.000Z',
      captureMode: 'live',
      timeoutMs: 5_000,
      signal: new AbortController().signal,
    });
    expect(result.status).toBe('succeeded');
    expect(result.evidence[0].sourceName).toBe('City of Pickens Utilities');
    if (result.finding?.kind === 'utilities') {
      expect(result.finding.publicWater).toBe('unknown');
      expect(result.finding.publicSewer).toBe('unknown');
      expect(result.finding.summary).toMatch(/address-level availability response/i);
    }
  });

  it('runs a USDA subject-point soil screen and labels the septic outlook preliminary', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        Table: [['mukey', 'musym', 'muname'], ['123', 'CeD', 'Cecil sandy clay loam']],
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        Table: [
          ['mukey', 'compname', 'comppct_r', 'drainagecl', 'hydgrp', 'slope_l', 'slope_h', 'interphrc', 'rulename'],
          ['123', 'Cecil', '85', 'well drained', 'B', '6', '15', 'Very limited', 'Slope'],
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const [adapter] = makePracticalDiscoveryScreeningAdapters({
      county: 'Pickens',
      state: 'SC',
      coordinates: { lat: 34.85, lng: -82.7 },
      soilOverlay: {
        status: 'not_found',
        note: 'No soil toggle was available in the LandPortal workspace.',
        sourceUrl: 'https://landportal.example.test/parcel',
      },
    });
    expect(adapter.task).toBe('soils_septic');
    const result = await adapter.run({
      rawInput: '3573 Moorefield Memorial Hwy',
      county: 'Pickens',
      state: 'SC',
      resolutionStatus: 'provisional',
      discoveryUsable: true,
      resolutionExplanation: 'Exact LandPortal subject.',
    }, {
      startedAt: '2026-07-28T12:00:00.000Z',
      captureMode: 'live',
      timeoutMs: 5_000,
      signal: new AbortController().signal,
    });
    expect(result.status).toBe('succeeded');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    if (result.finding?.kind === 'soils_septic') {
      expect(result.finding.summary).toMatch(/more challenging/i);
      expect(result.finding.limitation).toMatch(/one accepted subject coordinate/i);
    }
    expect(result.evidence.map((item) => item.sourceName)).toEqual(expect.arrayContaining([
      'USDA NRCS Soil Data Access / SSURGO subject-point screen',
      'LandPortal soil overlay',
    ]));
  });
});

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
  it('identifies practical Pickens provider candidates without claiming parcel service', async () => {
    const parcel: OfficialParcel = {
      provider: 'South Carolina statewide parcel layer',
      sourceUrl: 'https://example.test/sc-parcel',
      address: '200 SID EDENS RD', county: 'Pickens', state: 'SC', apn: '5105-00-44-0497',
      owner: 'OWNER', acres: 1.15, coordinates: { lat: 34.9942, lng: -82.6561 },
      geometry: { rings: RING as OfficialParcel['geometry']['rings'] }, datasetDate: '2026', facts: {},
    };
    const adapter = makeLivePublicIntelligenceAdapters(parcel).find((item) => item.task === 'utilities')!;
    const result = await adapter.run({
      rawInput: parcel.address, county: parcel.county, state: parcel.state, resolvedApn: parcel.apn,
      resolutionStatus: 'confirmed', resolutionExplanation: 'Official match.',
    }, { signal: new AbortController().signal, timeoutMs: 1000, startedAt: new Date().toISOString(), captureMode: 'fixture' });
    expect(result).toMatchObject({
      status: 'succeeded',
      finding: { kind: 'utilities', publicWater: 'unknown', publicSewer: 'unknown', electric: 'likely' },
    });
    expect(result.finding?.kind === 'utilities' ? result.finding.serviceProviders : []).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'City of Pickens Water & Wastewater' }),
      expect.objectContaining({ provider: expect.stringMatching(/Blue Ridge.*Duke Energy/i) }),
    ]));
    expect(result.finding?.summary).toMatch(/remains unknown/i);
  });

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
    expect(result).toMatchObject({
      status: 'partial',
      finding: {
        kind: 'utilities',
        publicWater: 'unknown',
        publicSewer: 'unknown',
        wellLikelyRequired: null,
        septicLikelyRequired: null,
      },
    });
    expect(result.evidence).toHaveLength(1);
    expect(result.finding?.summary).toMatch(/does not mean service is unavailable/i);
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

  it('reports an ArcGIS token requirement as a verified source limitation instead of a false no-match', async () => {
    installFetch({
      beaufort: () => okJson({ features: [] }),
      scdotRoot: () => okJson({ error: { code: 499, message: 'Token Required' } }),
    });
    const lookup = await loadLookup();

    const result = await lookup(scInput, TIMEOUT_MS, new AbortController().signal);

    expect(result.status).toBe('unavailable');
    expect(result.parcel).toBeNull();
    expect(result.attempted[0]).toMatchObject({ status: 'no_match' });
    expect(result.attempted[1]?.status).toBe('unavailable');
    expect(result.attempted[1]?.source).toMatch(/South Carolina statewide parcel layer.*Beaufort/i);
    expect(result.attempted[1].note).toMatch(/ArcGIS 499: authentication required/i);
    expect(result.attempted[1].note).not.toMatch(/publishes no layer/i);
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
      { source: 'Tennessee Comptroller public parcel layer', status: 'matched', note: 'Exact normalized street address matched one county parcel.' },
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

describe('Tennessee multi-path parcel lookup keys (pure)', () => {
  it('generates jurisdiction-appropriate APN clauses for a Regrid-format GISLINK APN', () => {
    const clauses = tennesseeApnLookupClauses('073090 04200');
    const wheres = clauses.map((clause) => clause.where);
    expect(wheres.some((where) => where.includes("PARCELID = '073090 04200'"))).toBe(true);
    expect(wheres.some((where) => where.includes("GISLINK LIKE '073090%04200%'"))).toBe(true);
    expect(wheres.some((where) => where.includes("CMAP = '090' AND PARCEL = '042.00'"))).toBe(true);
    expect(clauses.length).toBeLessThanOrEqual(8);
  });

  it('includes operator-supplied alternates without changing the underlying candidate', () => {
    const clauses = tennesseeApnLookupClauses('073090 04200', ['07309004200']);
    expect(clauses.some((clause) => clause.where.includes("PARCELID = '07309004200'"))).toBe(true);
  });

  // Live acceptance finding (Phase 3, new-intake condition): the TN layer PADS
  // PARCELID ("015 027    04512 000 2026") while an operator paste collapses the
  // run to a single space. Exact equality alone silently failed to resolve a
  // real parcel and the lead sat provisional with no visible reason.
  it('matches a padded PARCELID through a whitespace-insensitive ordered pattern', () => {
    const clauses = tennesseeApnLookupClauses('015 027 04512 000 2026');
    const wheres = clauses.map((clause) => clause.where);
    expect(wheres.some((where) => where === "PARCELID LIKE '015%027%04512%000%2026'")).toBe(true);
    expect(clauses.length).toBeLessThanOrEqual(8);
  });

  it('keeps the ordered-group pattern segment-ordered so it cannot match a different parcel', () => {
    const clauses = tennesseeApnLookupClauses('015 027 04512 000 2026');
    const pattern = clauses.find((clause) => clause.where.startsWith('PARCELID LIKE'))!.where;
    // Segment order is preserved and the pattern is anchored at both ends, so a
    // parcel with the same digits in a different order can never satisfy it.
    expect(pattern).toBe("PARCELID LIKE '015%027%04512%000%2026'");
    expect(pattern.endsWith("2026'")).toBe(true);
  });

  it('reconciles conservative owner-name variants in both directions', () => {
    expect(tennesseeOwnerNamesReconcile('SACHAN DILEEP S', 'SACHAN DILEEP S')).toBe(true);
    expect(tennesseeOwnerNamesReconcile('SACHAN DILEEP S', 'SACHAN DILEEP')).toBe(true);
    expect(tennesseeOwnerNamesReconcile('SACHAN DILEEP S', 'DILEEP S SACHAN')).toBe(true);
    expect(tennesseeOwnerNamesReconcile('SACHAN DILEEP S', 'SACHAN DILEEP ETUX')).toBe(true);
    expect(tennesseeOwnerNamesReconcile('SACHAN DILEEP S', 'SMITH JOHN')).toBe(false);
    expect(tennesseeOwnerNamesReconcile('SACHAN DILEEP S', 'SACHAN RAVI')).toBe(false);
  });
});
