// Tests for the Default Duke Report Source Lanes v1. Pure: no network, no
// agent, no tokens, no comp credits.

import { describe, it, expect } from 'vitest';

import {
  buildDukeReportLanes,
  buildCountyDeepDivePlaceholder,
  LANDPORTAL_VERIFICATION_TIMEOUT_MS,
  LANDWATCH_MIN_ACRES,
  LOCAL_AREA_NOT_VERIFIED_LABEL,
  type DukeReportLanesInput,
} from './duke-report-lanes.js';

const baseInput = (over: Partial<DukeReportLanesInput> = {}): DukeReportLanesInput => ({
  landPortal: { status: 'not_verified', verified: false },
  compMode: 'redfin_zillow',
  ...over,
});
const laneOf = (r: ReturnType<typeof buildDukeReportLanes>, id: string) => r.lanes.find(l => l.laneId === id)!;

describe('LandPortal verification ceiling', () => {
  it('is exactly 3 minutes', () => {
    expect(LANDPORTAL_VERIFICATION_TIMEOUT_MS).toBe(3 * 60 * 1000);
  });
});

describe('LandPortal timeout does not collapse the report', () => {
  const r = buildDukeReportLanes(baseInput({
    landPortal: { status: 'timeout', verified: false, reason: 'LandPortal lookup did not respond in time.' },
    localAreaAnchor: 'Clay County, TN',
  }));

  it('LandPortal lane status = timeout', () => {
    expect(laneOf(r, 'landportal_exact_search').status).toBe('timeout');
  });
  it('parcel is not verified and labeled Local Area Context, Not Parcel Verified', () => {
    expect(r.parcelVerified).toBe(false);
    expect(r.unverifiedLabel).toBe(LOCAL_AREA_NOT_VERIFIED_LABEL);
    expect(r.summary).toContain(LOCAL_AREA_NOT_VERIFIED_LABEL);
  });
  it('Local Area Data lane still contributes compact context (not thin)', () => {
    const la = laneOf(r, 'local_area_data');
    expect(la.status).toBe('success');
    expect(la.findings.some(f => /Clay County, TN/.test(f))).toBe(true);
    expect(la.findings).toContain(LOCAL_AREA_NOT_VERIFIED_LABEL);
  });
  it('downstream lanes are blocked, not scored', () => {
    expect(laneOf(r, 'redfin_zillow_comps').status).toBe('blocked');
    expect(laneOf(r, 'landwatch').status).toBe('blocked');
    expect(laneOf(r, 'strategy_offer').status).toBe('blocked');
  });
});

describe('Verification Captain authority is exact-only', () => {
  it('only LandPortal/verification lanes carry parcelVerificationAuthority', () => {
    const r = buildDukeReportLanes(baseInput({ landPortal: { status: 'success', verified: true, identitySummary: 'APN 08-2518, FIPS 37061' }, acres: 10 }));
    const authority = r.lanes.filter(l => l.parcelVerificationAuthority).map(l => l.laneId).sort();
    expect(authority).toEqual(['landportal_exact_search', 'verification_captain']);
    // Market/context lanes can never verify identity.
    for (const id of ['local_area_data', 'redfin_zillow_comps', 'landwatch', 'strategy_offer']) {
      expect(laneOf(r, id).canVerifyParcel).toBe(false);
      expect(laneOf(r, id).verifiedParcelIdentity).toBe(false);
    }
  });

  it('does not verify from local area / redfin / zillow / landwatch even if LandPortal failed', () => {
    const r = buildDukeReportLanes(baseInput({ landPortal: { status: 'not_verified', verified: false }, localAreaAnchor: 'Clay County, TN' }));
    expect(r.parcelVerified).toBe(false);
    expect(laneOf(r, 'verification_captain').verifiedParcelIdentity).toBe(false);
  });
});

describe('Verified parcel enables gated lanes', () => {
  it('Redfin/Zillow comps are eligible (not blocked) once verified', () => {
    const r = buildDukeReportLanes(baseInput({ landPortal: { status: 'success', verified: true }, acres: 10 }));
    expect(laneOf(r, 'redfin_zillow_comps').status).not.toBe('blocked');
    expect(laneOf(r, 'strategy_offer').status).toBe('success');
  });

  it('strategy lane preserves distinct bands + min net profit ($10k / $30k)', () => {
    const r = buildDukeReportLanes(baseInput({ landPortal: { status: 'success', verified: true }, acres: 5 }));
    const s = laneOf(r, 'strategy_offer');
    expect(s.findings.join(' ')).toMatch(/\$10,000/);
    expect(s.findings.join(' ')).toMatch(/\$30,000/);
    expect(s.findings.join(' ')).toMatch(/% of EV/);
  });
});

describe('LandWatch over-50-acre gate', () => {
  it('blocked when parcel unverified', () => {
    expect(laneOf(buildDukeReportLanes(baseInput({ acres: 100 })), 'landwatch').status).toBe('blocked');
  });
  it('skipped when verified acreage is 50 or less', () => {
    const r = buildDukeReportLanes(baseInput({ landPortal: { status: 'success', verified: true }, acres: LANDWATCH_MIN_ACRES }));
    const lw = laneOf(r, 'landwatch');
    expect(lw.status).toBe('skipped');
    expect(lw.blockingReason).toMatch(/threshold not met/i);
  });
  it('eligible (not skipped/blocked) when verified acreage is over 50', () => {
    const r = buildDukeReportLanes(baseInput({ landPortal: { status: 'success', verified: true }, acres: 51 }));
    expect(['not_available', 'success']).toContain(laneOf(r, 'landwatch').status);
  });
});

describe('No comp credits, no verification-by-market-site, no map/coordinate language', () => {
  it('compCreditUsed is false on every lane and overall', () => {
    const r = buildDukeReportLanes(baseInput({ landPortal: { status: 'success', verified: true }, acres: 60 }));
    expect(r.compCreditUsed).toBe(false);
    expect(r.lanes.every(l => l.compCreditUsed === false)).toBe(true);
  });
  it('emits no coordinate/geocoder/proximity/map-pin/visual verification language', () => {
    const variants = [
      buildDukeReportLanes(baseInput({ landPortal: { status: 'timeout', verified: false }, localAreaAnchor: 'Clay County, TN' })),
      buildDukeReportLanes(baseInput({ landPortal: { status: 'success', verified: true }, acres: 80 })),
    ];
    for (const r of variants) {
      expect(/geocod|proximity|nearest parcel|map pin|coordinate|street view|satellite|map bounds/i.test(JSON.stringify(r))).toBe(false);
    }
  });
});

describe('County Deep Dive is on-demand only', () => {
  it('is not one of the default report lanes', () => {
    const r = buildDukeReportLanes(baseInput({ landPortal: { status: 'success', verified: true }, acres: 10 }));
    expect(r.lanes.some(l => l.laneId === 'county_deep_dive')).toBe(false);
  });
  it('placeholder is structured, not run by default, and verifies nothing', () => {
    const dd = buildCountyDeepDivePlaceholder();
    expect(dd.status).toBe('not_available');
    expect(dd.canVerifyParcel).toBe(false);
    expect(dd.nextAction).toMatch(/never run by default/i);
  });
});
