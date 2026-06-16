// Unit tests for LandPortal URL identity parsing. Pure functions only -- no
// network, no live LandPortal calls, no paid comp tools. Covers the Chinquapin
// fixture (?property=<base64> form) that previously produced a false negative.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  parseLandPortalUrl,
  normalizeApn,
  lpUrlIdentityToArgs,
  buildLpUrlGapMessage,
  lpResolveForPreflight,
  apnMatchKey,
  addressStrongMatch,
  lpApiVersion,
} from './landportal-client.js';
import { runDukePreflight } from './duke-preflight.js';

// The exact fixture Tyler supplied. property= base64 decodes to
// fips=37061&apn=08-2518-++-++-&ll_uuid=96531155
const CHINQUAPIN_URL =
  'https://landportal.com/?property=Zmlwcz0zNzA2MSZhcG49MDgtMjUxOC0rKy0rKy0mbGxfdXVpZD05NjUzMTE1NQ%3D%3D';

describe('parseLandPortalUrl', () => {
  it('parses the base64 ?property= form (Chinquapin fixture)', () => {
    const r = parseLandPortalUrl(CHINQUAPIN_URL);
    expect(r).toEqual({
      propertyid: null,
      fips: '37061',
      apn: '08-2518-++-++-',
      apnNormalized: '08-2518',
      llUuid: '96531155',
    });
  });

  it('parses the explicit ?propertyid=&fips= form', () => {
    const r = parseLandPortalUrl('https://landportal.com/property?propertyid=12345&fips=37005');
    expect(r).toMatchObject({ propertyid: '12345', fips: '37005' });
  });

  it('parses the /<fips>/<propertyid> path form', () => {
    const r = parseLandPortalUrl('https://landportal.com/37005/987654');
    expect(r).toMatchObject({ fips: '37005', propertyid: '987654' });
  });

  it('returns null when no identifier is present', () => {
    expect(parseLandPortalUrl('https://landportal.com/about')).toBeNull();
    expect(parseLandPortalUrl('not a url')).toBeNull();
  });

  it('never derives coordinates from the URL', () => {
    const r = parseLandPortalUrl(CHINQUAPIN_URL);
    const keys = Object.keys(r ?? {});
    expect(keys.some(k => /lat|lng|lon|coord/i.test(k))).toBe(false);
  });
});

describe('normalizeApn', () => {
  it('drops trailing placeholder (++) and empty segments', () => {
    expect(normalizeApn('08-2518-++-++-')).toBe('08-2518');
  });

  it('leaves a normal APN unchanged', () => {
    expect(normalizeApn('12-345-678')).toBe('12-345-678');
    expect(normalizeApn('08-2518')).toBe('08-2518');
  });

  it('handles empty / nullish input', () => {
    expect(normalizeApn('')).toBeNull();
    expect(normalizeApn(null)).toBeNull();
    expect(normalizeApn(undefined)).toBeNull();
  });
});

describe('lpUrlIdentityToArgs', () => {
  it('routes the Chinquapin parcel to APN + FIPS exact lookup (normalized APN)', () => {
    const parsed = parseLandPortalUrl(CHINQUAPIN_URL)!;
    const args = lpUrlIdentityToArgs(parsed);
    expect(args).toEqual({ apn: '08-2518', fips: '37061' });
  });

  it('does not treat ll_uuid as a LandPortal property ID', () => {
    const parsed = parseLandPortalUrl(CHINQUAPIN_URL)!;
    const args = lpUrlIdentityToArgs(parsed)!;
    expect(args.propertyid).toBeUndefined();
    expect(JSON.stringify(args)).not.toContain('96531155');
  });

  it('prefers exact LP property ID + FIPS when present', () => {
    const parsed = parseLandPortalUrl('https://landportal.com/property?propertyid=12345&fips=37005')!;
    expect(lpUrlIdentityToArgs(parsed)).toEqual({ propertyid: '12345', fips: '37005' });
  });

  it('never produces coordinate or proximity inputs', () => {
    const parsed = parseLandPortalUrl(CHINQUAPIN_URL)!;
    const blob = JSON.stringify(lpUrlIdentityToArgs(parsed));
    expect(/lat|lng|lon|coord|nearest|proximity|geocod|centroid|midpoint/i.test(blob)).toBe(false);
  });
});

describe('buildLpUrlGapMessage', () => {
  it('names the extracted identity instead of re-asking for supplied data', () => {
    const parsed = parseLandPortalUrl(CHINQUAPIN_URL)!;
    const msg = buildLpUrlGapMessage(parsed);
    expect(msg).toContain('FIPS 37061');
    expect(msg).toContain('APN 08-2518');
    expect(msg).toContain('LP UUID 96531155');
    expect(msg.toLowerCase()).toContain('wrapper gap');
    // Holds the parcel-safety line: no scoring/valuation/offer on an unverified parcel.
    expect(msg.toLowerCase()).toContain('not verified');
  });

  it('never suggests coordinates, proximity, or nearest-parcel fallback', () => {
    const parsed = parseLandPortalUrl(CHINQUAPIN_URL)!;
    const msg = buildLpUrlGapMessage(parsed);
    expect(/coordinate|proximity|nearest|geocod|centroid|midpoint|map pin/i.test(msg)).toBe(false);
  });
});

describe('lpResolveForPreflight address-without-FIPS (no network)', () => {
  it('returns ambiguous_fips with an exact-lookup/county message, not a "provide address" re-ask', async () => {
    // No FIPS short-circuits before any fetch, so this needs no token or mock.
    const r = await lpResolveForPreflight(
      { address: '217 Clydeville Ln', city: 'Cottageville', state: 'SC' },
      5_000,
    );
    expect(r.status).toBe('ambiguous_fips');
    expect(r.match_notes).toMatch(/county|fips|exact/i);
    expect(r.match_notes.toLowerCase()).toContain('no scoring, valuation, or offer');
    // Must not tell Tyler to provide an address he already supplied.
    expect(r.match_notes).not.toMatch(/provide.*address|address \+ county/i);
    // Never coordinates/proximity.
    expect(/coordinate|proximity|nearest|geocod|centroid|midpoint|map pin/i.test(r.match_notes)).toBe(false);
  });
});

describe('lpResolveForPreflight LP-URL exact lookup (mocked fetch)', () => {
  const origFetch = global.fetch;
  const hadToken = Object.prototype.hasOwnProperty.call(process.env, 'LP_JWT_TOKEN');
  const origToken = process.env.LP_JWT_TOKEN;

  afterEach(() => {
    global.fetch = origFetch;
    if (hadToken) process.env.LP_JWT_TOKEN = origToken;
    else delete process.env.LP_JWT_TOKEN;
    vi.restoreAllMocks();
  });

  it('Chinquapin URL runs an exact parcelnumb search (query=08-2518, fips=37061) before property-data', async () => {
    process.env.LP_JWT_TOKEN = 'test-token';
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/search')) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({ data: [{ propertyid: '555', fips: '37061', apn: '08-2518' }] }),
        } as Response;
      }
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({
          meta: { requests_left: '9' },
          data: { property: {
            propertyid: '555', apn: '08-2518',
            situsfullstreetaddress: '217 CLYDEVILLE LN',
            situscity: 'COTTAGEVILLE', situsstate: 'SC',
          } },
        }),
      } as Response;
    }) as unknown as typeof fetch;

    const r = await lpResolveForPreflight({ lp_url: CHINQUAPIN_URL }, 10_000);

    expect(calls.length).toBe(2);
    expect(calls[0]).toContain('/search');
    expect(calls[0]).toContain('type=parcelnumb');
    expect(calls[0]).toContain('query=08-2518');
    expect(calls[0]).toContain('fips=37061');
    // property-data is only hit AFTER the exact search resolves a single parcel.
    expect(calls[1]).toContain('/property-data');
    expect(calls[1]).toContain('propertyid=555');
    expect(calls[1]).toContain('fips=37061');
    expect(r.verified).toBe(true);
    expect(r.propertyid).toBe('555');
  });
});

// ── Identity matching (H: fuzzy address, I: APN punctuation) ──────────────────

describe('apnMatchKey / APN normalization (tolerant-but-strict)', () => {
  it('I. tolerates dashes vs spaces vs decimals and ++ placeholders (same core digits)', () => {
    const k = apnMatchKey('08-2518-++-++-');
    expect(k).toBe('082518');
    expect(apnMatchKey('08-2518')).toBe(k);
    expect(apnMatchKey('5149-021-020')).toBe(apnMatchKey('5149 021 020'));
    expect(apnMatchKey('5149.021.020')).toBe(apnMatchKey('5149-021-020'));
  });

  it('I. rejects different or missing core digits', () => {
    expect(apnMatchKey('08-2518')).not.toBe(apnMatchKey('08-2519'));      // different digit
    expect(apnMatchKey('5149-021')).not.toBe(apnMatchKey('5149-021-020')); // missing meaningful digits
    expect(apnMatchKey('08-2518')).not.toBe(apnMatchKey('80-2518'));       // transposed
  });
});

describe('addressStrongMatch (fuzzy but strict)', () => {
  const lp = { street_address: '217 CLYDEVILLE LN', city: 'COTTAGEVILLE', state: 'SC', zip_code: '29435', fips: '37061' };

  it('H. accepts a minor one-char typo when city/state/ZIP align', () => {
    const r = addressStrongMatch({ address: '217 Clideville Ln', city: 'Cottageville', state: 'SC', zip: '29435' }, lp);
    expect(r.match).toBe(true);
  });

  it('H. accepts seller noise like "P Black St" vs "Black St" when context is strong', () => {
    const r = addressStrongMatch(
      { address: 'P Black St', state: 'SC', zip: '29435' },
      { street_address: '123 BLACK ST', state: 'SC', zip_code: '29435' },
    );
    expect(r.match).toBe(true);
  });

  it('H. rejects a genuinely different road', () => {
    const r = addressStrongMatch({ address: '100 Oak Ave', state: 'SC' }, { street_address: '200 Maple St', state: 'SC' });
    expect(r.match).toBe(false);
  });

  it('H. rejects a different house number on the same street', () => {
    const r = addressStrongMatch({ address: '999 Clydeville Ln', state: 'SC', zip: '29435' }, lp);
    expect(r.match).toBe(false);
  });

  it('H. rejects a state mismatch even with the same street', () => {
    const r = addressStrongMatch({ address: '217 Clydeville Ln', state: 'NC', zip: '29435' }, lp);
    expect(r.match).toBe(false);
  });

  // ── Locality guard (Codex fix): fuzzy street alone must never verify ──────
  it('A. rejects a city mismatch even when street/state/ZIP align', () => {
    const r = addressStrongMatch(
      { address: '217 Clydeville Ln', city: 'Cottageville', state: 'SC', zip: '29435' },
      { street_address: '217 CLYDEVILLE LN', city: 'CHARLESTON', state: 'SC', zip_code: '29435' },
    );
    expect(r.match).toBe(false);
    expect(r.reason).toMatch(/city/i);
  });

  it('B. rejects a fuzzy street with no locality context (no city/state/ZIP/FIPS)', () => {
    const r = addressStrongMatch({ address: '217 Clideville Ln' }, { street_address: '217 CLYDEVILLE LN' });
    expect(r.match).toBe(false);
    expect(r.reason).toMatch(/insufficient locality/i);
  });

  it('B. rejects an exact street with no locality context', () => {
    const r = addressStrongMatch({ address: '217 Clydeville Ln' }, { street_address: '217 CLYDEVILLE LN' });
    expect(r.match).toBe(false);
  });

  it('F. rejects a genuinely different road regardless of context', () => {
    const r = addressStrongMatch(
      { address: '100 Oak Ave', city: 'Cottageville', state: 'SC', zip: '29435' },
      { street_address: '100 MAPLE ST', city: 'COTTAGEVILLE', state: 'SC', zip_code: '29435' },
    );
    expect(r.match).toBe(false);
    expect(r.reason).toMatch(/different road/i);
  });

  it('accepts a FIPS-context match even when ZIP differs (same county)', () => {
    const r = addressStrongMatch(
      { address: '217 Clydeville Ln', state: 'SC', zip: '29434', fips: '37061' },
      { street_address: '217 CLYDEVILLE LN', state: 'SC', zip_code: '29435', fips: '37061' },
    );
    expect(r.match).toBe(true);
    expect(r.reason).toMatch(/FIPS/i);
  });

  it('rejects a FIPS mismatch outright', () => {
    const r = addressStrongMatch(
      { address: '217 Clydeville Ln', state: 'SC', zip: '29435', fips: '45019' },
      { street_address: '217 CLYDEVILLE LN', state: 'SC', zip_code: '29435', fips: '37061' },
    );
    expect(r.match).toBe(false);
    expect(r.reason).toMatch(/FIPS/i);
  });
});

// ── v2 adapter (flag-gated, mocked fetch) ─────────────────────────────────────

describe('LandPortal API v2 adapter (LANDPORTAL_API_VERSION=v2)', () => {
  const origFetch = global.fetch;
  const hadToken = Object.prototype.hasOwnProperty.call(process.env, 'LP_JWT_TOKEN');
  const origToken = process.env.LP_JWT_TOKEN;
  const hadVer = Object.prototype.hasOwnProperty.call(process.env, 'LANDPORTAL_API_VERSION');
  const origVer = process.env.LANDPORTAL_API_VERSION;
  const hadV2Token = Object.prototype.hasOwnProperty.call(process.env, 'LANDPORTAL_V2_TOKEN');
  const origV2Token = process.env.LANDPORTAL_V2_TOKEN;
  let calls: string[];
  let authHeaders: string[];

  beforeEach(() => {
    process.env.LANDPORTAL_API_VERSION = 'v2';
    process.env.LP_JWT_TOKEN = 'test-token';
    delete process.env.LANDPORTAL_V2_TOKEN;
    calls = [];
    authHeaders = [];
  });
  afterEach(() => {
    global.fetch = origFetch;
    if (hadToken) process.env.LP_JWT_TOKEN = origToken; else delete process.env.LP_JWT_TOKEN;
    if (hadVer) process.env.LANDPORTAL_API_VERSION = origVer; else delete process.env.LANDPORTAL_API_VERSION;
    if (hadV2Token) process.env.LANDPORTAL_V2_TOKEN = origV2Token; else delete process.env.LANDPORTAL_V2_TOKEN;
    vi.restoreAllMocks();
  });

  function jsonRes(status: number, body: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: `HTTP ${status}`,
      text: async () => JSON.stringify(body),
    } as Response;
  }
  function install(router: (url: string) => Response) {
    global.fetch = vi.fn(async (input: unknown, init?: { headers?: Record<string, string> }) => {
      calls.push(String(input));
      const auth = init?.headers?.Authorization;
      if (auth) authHeaders.push(String(auth));
      return router(String(input));
    }) as unknown as typeof fetch;
  }
  const feature = (props: Record<string, unknown>) => ({ type: 'Feature', geometry: null, properties: props });
  const searchBody = (features: Array<Record<string, unknown>>) =>
    ({ data: { type: 'FeatureCollection', features }, meta: { requests_left: 9 } });
  const detailBody = (props: Record<string, unknown>) =>
    ({ data: { type: 'Feature', geometry: null, bbox: null, properties: props }, meta: { requests_left: 8 } });
  const errBody = (code: string, request_id: string) => ({ error: { code, message: `${code} message`, request_id } });
  const isDetail = (url: string) => /\/v2\/properties\/\d/.test(url);
  const isPoint = (url: string) => /\/v2\/properties\/point/.test(url);

  it('A. APN + FIPS -> /v2/properties?parcelnumb then detail; verifies only on APN/FIPS match', async () => {
    install(url => {
      if (isDetail(url)) return jsonRes(200, detailBody({ property_id: 555, apn: '08-2518', fips: '37061', street_address: '217 CLYDEVILLE LN', city: 'COTTAGEVILLE', state: 'SC', zip_code: '29435', lot_size_acres: 5 }));
      return jsonRes(200, searchBody([feature({ property_id: '555', apn: '08-2518', fips: '37061' })]));
    });
    const r = await lpResolveForPreflight({ apn: '08-2518', fips: '37061' }, 10_000);
    expect(calls[0]).toContain('/v2/properties?');
    expect(calls[0]).toContain('parcelnumb=08-2518');
    expect(calls[0]).toContain('fips=37061');
    expect(calls[0]).not.toContain('/search');
    expect(calls[1]).toContain('/v2/properties/555');
    expect(calls[1]).toContain('fips=37061');
    expect(r.verified).toBe(true);
    expect(r.apn).toBe('08-2518');
    expect(r.propertyid).toBe('555');
  });

  it('A. rejects when detail APN does not match the searched APN', async () => {
    install(url => {
      if (isDetail(url)) return jsonRes(200, detailBody({ property_id: 555, apn: '08-9999', fips: '37061' }));
      return jsonRes(200, searchBody([feature({ property_id: '555', apn: '08-2518', fips: '37061' })]));
    });
    const r = await lpResolveForPreflight({ apn: '08-2518', fips: '37061' }, 10_000);
    expect(r.verified).toBe(false);
    expect(r.match_notes).toMatch(/APN mismatch/i);
  });

  it('B. full address routes to /v2/properties address search (no hard block, no point fallback)', async () => {
    install(url => {
      if (isDetail(url)) return jsonRes(200, detailBody({ property_id: 555, apn: '08-2518', fips: '37061', street_address: '217 CLYDEVILLE LN', city: 'COTTAGEVILLE', state: 'SC', zip_code: '29435' }));
      return jsonRes(200, searchBody([feature({ property_id: '555', apn: '08-2518', fips: '37061', street_address: '217 CLYDEVILLE LN', city: 'COTTAGEVILLE', state: 'SC', zip_code: '29435' })]));
    });
    const outcome = await runDukePreflight('217 Clydeville Ln, Cottageville, SC 29435', ['landportal'], 10_000);
    const searchCall = calls.find(c => c.includes('/v2/properties?'))!;
    expect(searchCall).toContain('address=');
    expect(searchCall).toContain('city=Cottageville');
    expect(searchCall).toContain('state=SC');
    expect(searchCall).toContain('zip=29435');
    expect(calls.some(c => isPoint(c))).toBe(false);
    expect(outcome.type).toBe('verified');
  });

  it('C. encoded LP URL normalizes APN 08-2518 and uses v2 parcelnumb search', async () => {
    install(url => {
      if (isDetail(url)) return jsonRes(200, detailBody({ property_id: 555, apn: '08-2518', fips: '37061', street_address: '217 CLYDEVILLE LN' }));
      return jsonRes(200, searchBody([feature({ property_id: '555', apn: '08-2518', fips: '37061' })]));
    });
    const r = await lpResolveForPreflight({ lp_url: CHINQUAPIN_URL }, 10_000);
    const s = calls.find(c => c.includes('/v2/properties?'))!;
    expect(s).toContain('parcelnumb=08-2518');
    expect(s).toContain('fips=37061');
    expect(r.verified).toBe(true);
    expect(r.apn).toBe('08-2518');
  });

  it('D. multiple matches -> ambiguous gap, no auto-select, no detail fetch', async () => {
    install(() => jsonRes(200, searchBody([
      feature({ property_id: '1', apn: '08-2518', fips: '37061' }),
      feature({ property_id: '2', apn: '08-2518', fips: '37061' }),
    ])));
    const r = await lpResolveForPreflight({ apn: '08-2518', fips: '37061' }, 10_000);
    expect(r.status).toBe('multiple_candidates');
    expect(r.verified).toBe(false);
    expect(r.candidates?.length).toBe(2);
    expect(calls.length).toBe(1);
  });

  it('E. zero results -> unverified exact-lookup miss', async () => {
    install(() => jsonRes(200, searchBody([])));
    const r = await lpResolveForPreflight({ apn: '08-2518', fips: '37061' }, 10_000);
    expect(r.verified).toBe(false);
    expect(r.status).toBe('not_verified');
    expect(r.match_notes).toMatch(/miss|No LandPortal v2 result/i);
    expect(calls.length).toBe(1);
  });

  it('F. 401/403/429 surface safely with request_id and no token leak', async () => {
    const cases: Array<[number, RegExp]> = [
      [401, /authorization failed/i],
      [403, /forbidden/i],
      [429, /rate limit|quota/i],
    ];
    for (const [status, label] of cases) {
      install(() => jsonRes(status, errBody('some_code', 'rid-123')));
      const r = await lpResolveForPreflight({ apn: '08-2518', fips: '37061' }, 10_000);
      expect(r.verified).toBe(false);
      expect(r.match_notes).toMatch(label);
      expect(r.match_notes).toContain('request_id rid-123');
      expect(r.match_notes).not.toContain('test-token');
      expect(r.match_notes).not.toMatch(/Bearer/i);
    }
  });

  it('G. point lookup is candidate-only: confirmed by APN match -> verified', async () => {
    install(() => jsonRes(200, detailBody({ property_id: 777, apn: '08-2518', fips: '37061', street_address: '217 CLYDEVILLE LN', city: 'COTTAGEVILLE', state: 'SC', zip_code: '29435' })));
    const r = await lpResolveForPreflight({ point: { latitude: 34.9, longitude: -77.8 }, apn: '08-2518', fips: '37061' }, 10_000);
    expect(calls[0]).toContain('/v2/properties/point');
    expect(calls[0]).toContain('latitude=34.9');
    expect(r.verified).toBe(true);
    expect(r.match_notes).toMatch(/point lookup CONFIRMED/i);
  });

  it('G. point candidate with APN mismatch is NOT verified (mismatch message)', async () => {
    install(() => jsonRes(200, detailBody({ property_id: 777, apn: '99-9999', fips: '37061', street_address: '1 OTHER RD' })));
    const r = await lpResolveForPreflight({ point: { latitude: 34.9, longitude: -77.8 }, apn: '08-2518', fips: '37061' }, 10_000);
    expect(r.verified).toBe(false);
    expect(r.status).toBe('point_candidate');
    expect(r.match_notes.toLowerCase()).toContain('candidate from point lookup');
    expect(r.match_notes).toMatch(/not verified/i);
  });

  it('G. point candidate with no seller APN/address cannot self-verify', async () => {
    install(() => jsonRes(200, detailBody({ property_id: 777, apn: '08-2518', fips: '37061', street_address: '217 CLYDEVILLE LN' })));
    const r = await lpResolveForPreflight({ point: { latitude: 34.9, longitude: -77.8 } }, 10_000);
    expect(r.verified).toBe(false);
    expect(r.status).toBe('point_candidate');
  });

  it('A. point + APN only (no FIPS/county/state) stays an unverified candidate', async () => {
    // APNs are not globally unique: a coordinate-derived candidate cannot verify
    // from APN alone without confirming county/FIPS context.
    install(() => jsonRes(200, detailBody({ property_id: 777, apn: '08-2518', fips: '37061', street_address: '217 CLYDEVILLE LN' })));
    const r = await lpResolveForPreflight({ point: { latitude: 34.9, longitude: -77.8 }, apn: '08-2518' }, 10_000);
    expect(r.verified).toBe(false);
    expect(r.status).toBe('point_candidate');
    expect(r.match_notes.toLowerCase()).toContain('candidate from point lookup');
    expect(r.match_notes).toMatch(/county\/FIPS context/i);
    expect(r.match_notes).toMatch(/no scoring, valuation, or offer/i);
  });

  it('B. point + APN + matching FIPS can verify', async () => {
    install(() => jsonRes(200, detailBody({ property_id: 777, apn: '08-2518', fips: '37061', street_address: '217 CLYDEVILLE LN' })));
    const r = await lpResolveForPreflight({ point: { latitude: 34.9, longitude: -77.8 }, apn: '08-2518', fips: '37061' }, 10_000);
    expect(r.verified).toBe(true);
    expect(r.match_notes).toMatch(/point lookup CONFIRMED/i);
    expect(r.match_notes).toMatch(/FIPS 37061/);
  });

  it('C. point + APN + FIPS mismatch rejects (different county)', async () => {
    install(() => jsonRes(200, detailBody({ property_id: 777, apn: '08-2518', fips: '45019', street_address: '217 CLYDEVILLE LN' })));
    const r = await lpResolveForPreflight({ point: { latitude: 34.9, longitude: -77.8 }, apn: '08-2518', fips: '37061' }, 10_000);
    expect(r.verified).toBe(false);
    expect(r.status).toBe('point_candidate');
    expect(r.match_notes).toMatch(/FIPS differs/i);
    expect(r.match_notes).toMatch(/no scoring, valuation, or offer/i);
  });

  it('C. point candidate with similar address but NO seller locality stays unverified', async () => {
    // Candidate returns a similar street, but the seller supplied no city/ZIP/
    // FIPS/APN to confirm against -- fuzzy street alone cannot verify.
    install(() => jsonRes(200, detailBody({ property_id: 777, apn: '08-2518', fips: '37061', street_address: '217 CLYDEVILLE LN', city: 'COTTAGEVILLE', state: 'SC', zip_code: '29435' })));
    const r = await lpResolveForPreflight({ point: { latitude: 34.9, longitude: -77.8 }, address: '217 Clideville Ln' }, 10_000);
    expect(r.verified).toBe(false);
    expect(r.status).toBe('point_candidate');
    expect(r.match_notes.toLowerCase()).toContain('candidate from point lookup');
  });

  it('D. point candidate promotes to verified when address + state + ZIP match', async () => {
    install(() => jsonRes(200, detailBody({ property_id: 777, apn: '08-2518', fips: '37061', street_address: '217 CLYDEVILLE LN', city: 'COTTAGEVILLE', state: 'SC', zip_code: '29435' })));
    const r = await lpResolveForPreflight(
      { point: { latitude: 34.9, longitude: -77.8 }, address: '217 Clideville Ln', state: 'SC', zip: '29435' },
      10_000,
    );
    expect(r.verified).toBe(true);
    expect(r.match_notes).toMatch(/point lookup CONFIRMED/i);
  });

  it('A. v2 address search stays unverified when the only match is a city conflict', async () => {
    install(url => {
      if (isDetail(url)) return jsonRes(200, detailBody({ property_id: 555, apn: '08-2518', fips: '37061', street_address: '217 CLYDEVILLE LN', city: 'CHARLESTON', state: 'SC', zip_code: '29435' }));
      return jsonRes(200, searchBody([feature({ property_id: '555', apn: '08-2518', fips: '37061', street_address: '217 CLYDEVILLE LN', city: 'CHARLESTON', state: 'SC', zip_code: '29435' })]));
    });
    const r = await lpResolveForPreflight(
      { address: '217 Clydeville Ln', city: 'Cottageville', state: 'SC', zip: '29435' },
      10_000,
    );
    expect(r.verified).toBe(false);
    // No detail fetch happens because the single search result fails locality.
    expect(calls.some(c => isDetail(c))).toBe(false);
  });

  it('J. no v2 path ever calls a comp/report endpoint', async () => {
    install(url => {
      if (isPoint(url)) return jsonRes(200, detailBody({ property_id: 1, apn: '08-2518', street_address: 'X' }));
      if (isDetail(url)) return jsonRes(200, detailBody({ property_id: 555, apn: '08-2518', fips: '37061', street_address: '217 CLYDEVILLE LN' }));
      return jsonRes(200, searchBody([feature({ property_id: '555', apn: '08-2518', fips: '37061' })]));
    });
    await lpResolveForPreflight({ apn: '08-2518', fips: '37061' }, 10_000);
    await lpResolveForPreflight({ address: '217 Clydeville Ln', city: 'Cottageville', state: 'SC', zip: '29435' }, 10_000);
    await lpResolveForPreflight({ point: { latitude: 1, longitude: 2 }, apn: '08-2518' }, 10_000);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(/report|comp/i.test(c)).toBe(false);
  });

  it('default (flag unset) keeps v1 behavior: no /v2/ calls', async () => {
    delete process.env.LANDPORTAL_API_VERSION;
    install(url => {
      if (url.includes('/search')) return jsonRes(200, { data: [{ propertyid: '555', fips: '37061', apn: '08-2518' }] });
      return jsonRes(200, { meta: { requests_left: '9' }, data: { property: { propertyid: '555', apn: '08-2518', situsfullstreetaddress: '217 CLYDEVILLE LN' } } });
    });
    await lpResolveForPreflight({ apn: '08-2518', fips: '37061' }, 10_000);
    expect(calls.every(c => !c.includes('/v2/'))).toBe(true);
    expect(calls.some(c => c.includes('/search'))).toBe(true);
  });

  // ── Duke dashboard path does not bypass the version selector ────────────────
  it('runDukePreflight (Duke/dashboard path) routes APN+FIPS through the v2 selector', async () => {
    install(url => {
      if (isDetail(url)) return jsonRes(200, detailBody({ property_id: 555, apn: '08-2518', fips: '37061', street_address: '217 CLYDEVILLE LN' }));
      return jsonRes(200, searchBody([feature({ property_id: '555', apn: '08-2518', fips: '37061' })]));
    });
    const outcome = await runDukePreflight('Run DD on APN: 08-2518 fips: 37061', ['landportal', 'filesystem'], 10_000);
    // The dashboard path hit the v2 endpoints (no bypass to v1 /search).
    expect(calls.some(c => c.includes('/v2/properties?') && c.includes('parcelnumb=08-2518') && c.includes('fips=37061'))).toBe(true);
    expect(calls.every(c => !c.includes('/wp-json/'))).toBe(true);
    expect(outcome.type).toBe('verified');
    // Verified preflight excludes the (v1) landportal MCP from the run.
    const v = outcome as Extract<typeof outcome, { type: 'verified' }>;
    expect(v.filteredMcpAllowlist).not.toContain('landportal');
  });

  it('v2 APN/FIPS does not verify when the detail FIPS differs from the requested FIPS', async () => {
    install(url => {
      // Search matches the APN, but the detail record is in a different county.
      if (isDetail(url)) return jsonRes(200, detailBody({ property_id: 555, apn: '08-2518', fips: '45019', street_address: '217 CLYDEVILLE LN' }));
      return jsonRes(200, searchBody([feature({ property_id: '555', apn: '08-2518', fips: '37061' })]));
    });
    const r = await lpResolveForPreflight({ apn: '08-2518', fips: '37061' }, 10_000);
    expect(r.verified).toBe(false);
    expect(r.match_notes).toMatch(/FIPS mismatch/i);
  });

  // ── v2 token override (LANDPORTAL_V2_TOKEN) ─────────────────────────────────
  it('A(token). v2 prefers LANDPORTAL_V2_TOKEN over LP_JWT_TOKEN', async () => {
    process.env.LANDPORTAL_V2_TOKEN = 'v2-opaque-token';
    process.env.LP_JWT_TOKEN = 'v1-jwt-token';
    install(url => {
      if (isDetail(url)) return jsonRes(200, detailBody({ property_id: 555, apn: '08-2518', fips: '37061' }));
      return jsonRes(200, searchBody([feature({ property_id: '555', apn: '08-2518', fips: '37061' })]));
    });
    await lpResolveForPreflight({ apn: '08-2518', fips: '37061' }, 10_000);
    expect(authHeaders.length).toBeGreaterThan(0);
    expect(authHeaders.every(h => h === 'Bearer v2-opaque-token')).toBe(true);
    expect(authHeaders.some(h => h.includes('v1-jwt-token'))).toBe(false);
  });

  it('B(token). v2 falls back to LP_JWT_TOKEN when LANDPORTAL_V2_TOKEN is absent', async () => {
    delete process.env.LANDPORTAL_V2_TOKEN;
    process.env.LP_JWT_TOKEN = 'v1-jwt-token';
    install(url => {
      if (isDetail(url)) return jsonRes(200, detailBody({ property_id: 555, apn: '08-2518', fips: '37061' }));
      return jsonRes(200, searchBody([feature({ property_id: '555', apn: '08-2518', fips: '37061' })]));
    });
    await lpResolveForPreflight({ apn: '08-2518', fips: '37061' }, 10_000);
    expect(authHeaders.length).toBeGreaterThan(0);
    expect(authHeaders.every(h => h === 'Bearer v1-jwt-token')).toBe(true);
  });

  it('D(token). adapter results never leak token, Bearer, or Authorization', async () => {
    process.env.LANDPORTAL_V2_TOKEN = 'v2-opaque-token';
    install(() => jsonRes(401, errBody('unauthorized', 'rid-xyz')));
    const r = await lpResolveForPreflight({ apn: '08-2518', fips: '37061' }, 10_000);
    const blob = JSON.stringify(r);
    // No token values and no echoed Authorization header content.
    expect(blob).not.toContain('v2-opaque-token');
    expect(blob).not.toContain('test-token');
    expect(blob).not.toContain('Bearer ');
    expect(blob).not.toContain('LANDPORTAL_V2_TOKEN');
    expect(blob).not.toContain('LP_JWT_TOKEN');
    // But the safe request_id is still surfaced.
    expect(r.match_notes).toContain('request_id rid-xyz');
  });

  it('E(token). 401 and 403 still surface safe auth/permission messages + request_id', async () => {
    process.env.LANDPORTAL_V2_TOKEN = 'v2-opaque-token';
    for (const [status, label] of [[401, /authorization failed/i], [403, /forbidden/i]] as Array<[number, RegExp]>) {
      install(() => jsonRes(status, errBody('some_code', 'rid-401-403')));
      const r = await lpResolveForPreflight({ apn: '08-2518', fips: '37061' }, 10_000);
      expect(r.verified).toBe(false);
      expect(r.match_notes).toMatch(label);
      expect(r.match_notes).toContain('request_id rid-401-403');
      expect(r.match_notes).not.toContain('v2-opaque-token');
    }
  });
});

describe('v1 token behavior unchanged by v2 override', () => {
  const hadToken = Object.prototype.hasOwnProperty.call(process.env, 'LP_JWT_TOKEN');
  const origToken = process.env.LP_JWT_TOKEN;
  const hadV2Token = Object.prototype.hasOwnProperty.call(process.env, 'LANDPORTAL_V2_TOKEN');
  const origV2Token = process.env.LANDPORTAL_V2_TOKEN;
  const origFetch = global.fetch;

  afterEach(() => {
    global.fetch = origFetch;
    if (hadToken) process.env.LP_JWT_TOKEN = origToken; else delete process.env.LP_JWT_TOKEN;
    if (hadV2Token) process.env.LANDPORTAL_V2_TOKEN = origV2Token; else delete process.env.LANDPORTAL_V2_TOKEN;
    delete process.env.LANDPORTAL_API_VERSION;
    vi.restoreAllMocks();
  });

  it('C(token). v1 path uses LP_JWT_TOKEN and ignores LANDPORTAL_V2_TOKEN', async () => {
    delete process.env.LANDPORTAL_API_VERSION; // v1 default
    process.env.LP_JWT_TOKEN = 'v1-jwt-token';
    process.env.LANDPORTAL_V2_TOKEN = 'v2-opaque-token';
    const authHeaders: string[] = [];
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: unknown, init?: { headers?: Record<string, string> }) => {
      calls.push(String(input));
      const auth = init?.headers?.Authorization;
      if (auth) authHeaders.push(String(auth));
      const url = String(input);
      if (url.includes('/search')) {
        return { ok: true, status: 200, statusText: 'HTTP 200', text: async () => JSON.stringify({ data: [{ propertyid: '555', fips: '37061', apn: '08-2518' }] }) } as Response;
      }
      return { ok: true, status: 200, statusText: 'HTTP 200', text: async () => JSON.stringify({ meta: { requests_left: '9' }, data: { property: { propertyid: '555', apn: '08-2518', situsfullstreetaddress: '217 CLYDEVILLE LN' } } }) } as Response;
    }) as unknown as typeof fetch;

    await lpResolveForPreflight({ apn: '08-2518', fips: '37061' }, 10_000);
    expect(calls.every(c => !c.includes('/v2/'))).toBe(true);
    expect(authHeaders.length).toBeGreaterThan(0);
    expect(authHeaders.every(h => h === 'Bearer v1-jwt-token')).toBe(true);
    expect(authHeaders.some(h => h.includes('v2-opaque-token'))).toBe(false);
  });
});

describe('lpApiVersion selector', () => {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'LANDPORTAL_API_VERSION');
  const orig = process.env.LANDPORTAL_API_VERSION;
  afterEach(() => {
    if (had) process.env.LANDPORTAL_API_VERSION = orig; else delete process.env.LANDPORTAL_API_VERSION;
  });

  it('defaults to v1 when unset', () => {
    delete process.env.LANDPORTAL_API_VERSION;
    expect(lpApiVersion()).toBe('v1');
  });

  it('selects v2 for the explicit opt-in value', () => {
    process.env.LANDPORTAL_API_VERSION = 'v2';
    expect(lpApiVersion()).toBe('v2');
  });

  it('stays on v1 for any non-v2 value (typos / other versions)', () => {
    for (const val of ['v1', 'v3', 'V1', 'foo', '', '2', 'vv2', 'v2x']) {
      process.env.LANDPORTAL_API_VERSION = val;
      expect(lpApiVersion(), `value "${val}"`).toBe('v1');
    }
  });

  it('is case/whitespace tolerant for the explicit opt-in (still a deliberate choice)', () => {
    for (const val of ['v2', 'V2', ' v2 ', 'V2\t']) {
      process.env.LANDPORTAL_API_VERSION = val;
      expect(lpApiVersion(), `value "${val}"`).toBe('v2');
    }
  });
});
