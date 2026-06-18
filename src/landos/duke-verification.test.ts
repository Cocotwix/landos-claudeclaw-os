// Sprint 6B/6C tests: Duke Execution Bridge (verification result mapping).
// Pure + deterministic. No network/agent/DB: preflight outcomes are mocked.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { buildDukeVerificationResult, resolveDukeVerificationInput } from './duke-verification-bridge.js';
import type { DukePreflightOutcome } from './duke-preflight.js';

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
