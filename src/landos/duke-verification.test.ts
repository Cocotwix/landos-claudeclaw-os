// Sprint 6B/6C tests: Duke Execution Bridge (verification result mapping).
// Pure + deterministic. No network/agent/DB: preflight outcomes are mocked.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

import {
  buildDukeVerificationResult,
  resolveDukeVerificationInput,
  beginDukeAction,
  runDukeVerification,
  mapResolveToVerification,
} from './duke-verification-bridge.js';
import type { DukePreflightOutcome } from './duke-preflight.js';
import type { LpResolveArgs, LpResolveResult } from './landportal-client.js';

const FULL_ADDRESS = '731 Filter Plant Dr, Fayetteville, NC 28301';

function lpResult(over: Partial<LpResolveResult>): LpResolveResult {
  return {
    verified: false, status: 'not_verified', propertyid: null, fips: null,
    apn: null, situs_address: null, owner: null, match_notes: '', candidates: [],
    ...over,
  };
}
/** A resolver mock that records the args it was called with. No network. */
function mockResolve(result: LpResolveResult): { fn: (a: LpResolveArgs, t: number) => Promise<LpResolveResult>; calls: LpResolveArgs[] } {
  const calls: LpResolveArgs[] = [];
  return { fn: async (a) => { calls.push(a); return result; }, calls };
}

function verifiedOutcome(payload: Record<string, unknown>): DukePreflightOutcome {
  const block = [
    '[DUKE PREFLIGHT -- parcel verified by LandOS gateway before runAgent]',
    'lp_resolve_property returned verified:true.',
    'The LandPortal MCP server has been excluded from this run.',
    '',
    JSON.stringify(payload, null, 2),
    '[END DUKE PREFLIGHT]',
  ].join('\n');
  return { type: 'verified', parcelBlock: block, filteredMcpAllowlist: [] };
}

const VERIFIED_PAYLOAD = {
  verified: true,
  status: 'verified',
  propertyid: '12345',
  fips: '45029',
  apn: '051-012-05',
  situs_address: '1234 Filter Plant Rd',
  city: 'Cottageville',
  state: 'SC',
  owner: 'Cheryl Sann',
  match_notes: 'Exact APN match in Colleton County.',
  lot_size_acres: '5.2',
  property_summary: 'Vacant land.',
};

describe('verified parcel result', () => {
  it('represents verified only with named source + identity fields', () => {
    const r = buildDukeVerificationResult(verifiedOutcome(VERIFIED_PAYLOAD), 'APN: 051-012-05, Colleton County, SC');
    expect(r.status).toBe('parcel_verified');
    expect(r.parcelVerified).toBe(true);
    expect(r.verificationSource).toBe('LandPortal exact lookup');
    expect(r.identity?.apn).toBe('051-012-05');
    expect(r.identity?.situsAddress).toBe('1234 Filter Plant Rd');
    expect(r.identity?.owner).toBe('Cheryl Sann');
    expect(r.identity?.acres).toBe(5.2);
    expect(r.sourceAttempts[0].truthLabel).toBe('verified_fact');
    expect(r.strategyUnderwritingBlocked).toBe(false);
  });

  it('does NOT treat a verified outcome with no identity fields as verified', () => {
    const r = buildDukeVerificationResult(verifiedOutcome({ verified: true, status: 'verified' }), 'somewhere');
    expect(r.parcelVerified).toBe(false);
    expect(r.status).not.toBe('parcel_verified');
    expect(r.strategyUnderwritingBlocked).toBe(true);
  });
});

describe('unverified / blocked results keep Strategy + Underwriting blocked', () => {
  it('blocked not_verified -> unverified, attempted_lookup, blocked', () => {
    const pre: DukePreflightOutcome = { type: 'blocked', message: 'Parcel not verified -- no scoring, valuation, or offer.', reason: 'not_verified' };
    const r = buildDukeVerificationResult(pre, 'somewhere unknown');
    expect(r.parcelVerified).toBe(false);
    expect(r.status).toBe('unverified');
    expect(r.sourceAttempts[0].status).toBe('not_verified');
    expect(r.sourceAttempts[0].truthLabel).toBe('attempted_lookup');
    expect(r.strategyUnderwritingBlocked).toBe(true);
  });

  it('blocked lp_timeout -> timeout attempt + data gap', () => {
    const pre: DukePreflightOutcome = { type: 'blocked', message: 'LandPortal lookup did not respond in time.', reason: 'lp_timeout' };
    const r = buildDukeVerificationResult(pre, '1234 Filter Plant Rd, Cottageville, SC');
    expect(r.sourceAttempts[0].status).toBe('timeout');
    expect(r.dataGaps).toContain('landportal_lookup_timeout');
  });

  it('city/county + state with no verified parcel shows Local Area Context label + eligible Market Pulse', () => {
    const pre: DukePreflightOutcome = { type: 'blocked', message: 'Parcel not verified.', reason: 'not_verified' };
    const r = buildDukeVerificationResult(pre, '1234 Filter Plant Rd, Cottageville, SC');
    expect(r.status).toBe('local_area_context_not_parcel_verified');
    expect(r.localAreaContextLabel).toBe('Local Area Context, Not Parcel Verified');
    expect(r.marketPulseEligible).toBe(true);
    expect(r.strategyUnderwritingBlocked).toBe(true);
  });
});

describe('skip / no identity', () => {
  it('no parcel identifier -> skipped_no_identity (verification never started)', () => {
    const r = buildDukeVerificationResult({ type: 'skip' }, 'what should we do with this?');
    expect(r.status).toBe('skipped_no_identity');
    expect(r.parcelVerified).toBe(false);
    expect(r.dataGaps).toContain('no_parcel_identifier_in_input');
  });

  it('a coordinate-pair input is never verified and yields no identity', () => {
    // Coordinates can never identify a parcel; preflight skips, the bridge stays
    // unverified with no identity fields.
    const r = buildDukeVerificationResult({ type: 'skip' }, '34.0522, -118.2437');
    expect(r.parcelVerified).toBe(false);
    expect(r.identity).toBeUndefined();
    expect(r.strategyUnderwritingBlocked).toBe(true);
  });
});

describe('full address is a valid parcel identifier (no_parcel_identifier regression)', () => {
  it('a full street address attempts the LandPortal lookup and is NOT "no identifier"', async () => {
    // ambiguous_fips = address parsed, LandPortal needs county/FIPS. This must
    // NOT degrade to no_parcel_identifier_in_input.
    const m = mockResolve(lpResult({ status: 'ambiguous_fips', match_notes: 'needs county/FIPS' }));
    const r = await runDukeVerification(FULL_ADDRESS, { resolve: m.fn, timeoutMs: 1000 });
    expect(m.calls.length).toBe(1); // the lookup was attempted, not skipped
    expect(m.calls[0].address).toBe('731 Filter Plant Dr');
    expect(r.dataGaps).not.toContain('no_parcel_identifier_in_input');
    expect(r.dataGaps).toContain('needs_county_or_fips');
    expect(r.sourceAttempts[0].status).not.toBe('skipped');
    expect(r.parcelVerified).toBe(false);
    expect(r.strategyUnderwritingBlocked).toBe(true);
    // Fayetteville, NC is a known local area.
    expect(r.localAreaContextLabel).toBe('Local Area Context, Not Parcel Verified');
    expect(r.marketPulseEligible).toBe(true);
  });

  it('a verified resolve returns parcel_verified with named identity fields + normalized property data', async () => {
    const m = mockResolve(lpResult({
      verified: true, status: 'verified', propertyid: '12345', fips: '37051',
      apn: '0440-12-3456', situs_address: '731 Filter Plant Dr', city: 'Fayetteville', state: 'NC', owner: 'Jane Doe',
      property_summary: { propertyid: '12345', apn: '0440-12-3456', lot_size_acres: '3.4', county: 'Cumberland', road_frontage_ft: '150', buildability_pct: '80', market_total: '50000' } as never,
      match_notes: 'exact match',
    }));
    const r = await runDukeVerification(FULL_ADDRESS, { resolve: m.fn, timeoutMs: 1000 });
    expect(r.parcelVerified).toBe(true);
    expect(r.status).toBe('parcel_verified');
    expect(r.identity?.apn).toBe('0440-12-3456');
    expect(r.identity?.acres).toBe(3.4);
    expect(r.verificationSource).toBe('LandPortal exact lookup');
    expect(r.strategyUnderwritingBlocked).toBe(false);
    // Rich property data is normalized and surfaced.
    expect(r.propertyData?.sourceName).toBe('LandPortal');
    expect(r.propertyData?.identity.propertyId).toBe('12345');
    expect(r.propertyData?.landFacts.acres).toBe(3.4);
    expect(r.propertyData?.landFacts.roadFrontageFt).toBe(150);
    expect(r.propertyData?.valuation.marketTotal).toBe(50000);
  });

  it('a lookup timeout is reported as a timeout attempt, not "no identifier"', async () => {
    const m = mockResolve(lpResult({ status: 'lookup_timeout', match_notes: 'aborted' }));
    const r = await runDukeVerification(FULL_ADDRESS, { resolve: m.fn, timeoutMs: 1 });
    expect(r.sourceAttempts[0].status).toBe('timeout');
    expect(r.dataGaps).toContain('landportal_lookup_timeout');
    expect(r.dataGaps).not.toContain('no_parcel_identifier_in_input');
  });

  it('an unavailable LandPortal (resolver throws) is attempted, not "no identifier"', async () => {
    const r = await runDukeVerification(FULL_ADDRESS, { resolve: async () => { throw new Error('not configured'); }, timeoutMs: 1000 });
    expect(r.dataGaps).toContain('landportal_unavailable');
    expect(r.dataGaps).not.toContain('no_parcel_identifier_in_input');
    expect(r.parcelVerified).toBe(false);
    // Never leak a token/secret in the surfaced reason.
    expect(r.sourceAttempts[0].reason.toLowerCase()).not.toContain('token');
  });

  it('an address missing county/FIPS (no full parse) still counts as an identifier input', async () => {
    // extractPropertyArgs returns null but it looks like a property -> attempted,
    // needs county/FIPS, NOT "no identifier". Resolver is never called.
    const m = mockResolve(lpResult({}));
    const r = await runDukeVerification('57 Church Road', { resolve: m.fn, timeoutMs: 1000 });
    expect(m.calls.length).toBe(0);
    expect(r.dataGaps).toContain('needs_county_or_fips');
    expect(r.dataGaps).not.toContain('no_parcel_identifier_in_input');
  });

  it('truly empty / non-property input is the only "no identifier" case', async () => {
    const m = mockResolve(lpResult({}));
    const r = await runDukeVerification('what should we do with this?', { resolve: m.fn, timeoutMs: 1000 });
    expect(m.calls.length).toBe(0);
    expect(r.dataGaps).toContain('no_parcel_identifier_in_input');
    expect(r.status).toBe('skipped_no_identity');
  });

  it('mapResolveToVerification never marks an empty-identity verified result as verified', () => {
    const r = mapResolveToVerification({
      text: FULL_ADDRESS, hasIdentifierInput: true,
      resolve: lpResult({ verified: true, status: 'verified' }), unavailable: false,
    });
    expect(r.parcelVerified).toBe(false);
  });
});

describe('beginDukeAction — click registers synchronously before async work', () => {
  it('a click is always registered, and advances to requesting when there is input', () => {
    const r = beginDukeAction('731 Filter Plant Dr, Fayetteville, NC 28301', '');
    expect(r.clicked).toBe(true);
    expect(r.willRequest).toBe(true);
    expect(r.stage).toBe('requesting');
    expect(r.input).toBe('731 Filter Plant Dr, Fayetteville, NC 28301');
  });

  it('a click with no input still registers (clicked) but does not request', () => {
    const r = beginDukeAction('', '   ');
    expect(r.clicked).toBe(true);
    expect(r.willRequest).toBe(false);
    expect(r.stage).toBe('empty_input');
    expect(r.error).toBeTypeOf('string');
  });

  it('uses the plan text over a half-typed textarea', () => {
    const r = beginDukeAction('APN: 1-2-3, X County, NC', 'half typed');
    expect(r.input).toBe('APN: 1-2-3, X County, NC');
  });
});

describe('Duke verification input resolver (the "button does nothing" regression)', () => {
  it('uses the text that produced the displayed plan, not the live textarea', () => {
    const r = resolveDukeVerificationInput('APN: 051-012-05, Colleton County, SC', 'half-typed new query');
    expect(r.error).toBeUndefined();
    expect(r.input).toBe('APN: 051-012-05, Colleton County, SC');
  });

  it('falls back to the live textarea when there is no plan text yet', () => {
    const r = resolveDukeVerificationInput('', '123 Oak Rd, Lexington County SC');
    expect(r.input).toBe('123 Oak Rd, Lexington County SC');
    expect(r.error).toBeUndefined();
  });

  it('never silently no-ops: empty input returns an explicit error', () => {
    const r = resolveDukeVerificationInput('', '   ');
    expect(r.input).toBe('');
    expect(r.error).toBeTypeOf('string');
    expect(r.error).toMatch(/Run an intake plan first/i);
  });
});

describe('no banned identity-source language / no comp tools', () => {
  const SRC = fs.readFileSync(fileURLToPath(new URL('./duke-verification-bridge.ts', import.meta.url)), 'utf-8');
  it('introduces no geocoder/coordinate-pin/proximity-match parcel-identity language', () => {
    for (const banned of ['geocoder', 'geocode', 'map pin', 'satellite', 'street view', 'nearest parcel', 'road midpoint', 'centroid', 'proximity match']) {
      expect(SRC.toLowerCase().includes(banned), banned).toBe(false);
    }
  });
  it('never calls a paid LandPortal comp tool', () => {
    expect(/lp_comp_report_create\s*\(/.test(SRC)).toBe(false);
    expect(/lp_comp_report_get\s*\(/.test(SRC)).toBe(false);
  });
});
