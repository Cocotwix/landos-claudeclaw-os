// Unit tests for LandPortal URL identity parsing. Pure functions only -- no
// network, no live LandPortal calls, no paid comp tools. Covers the Chinquapin
// fixture (?property=<base64> form) that previously produced a false negative.

import { describe, expect, it } from 'vitest';

import {
  parseLandPortalUrl,
  normalizeApn,
  lpUrlIdentityToArgs,
  buildLpUrlGapMessage,
} from './landportal-client.js';

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
