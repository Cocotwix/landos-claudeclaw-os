// Land Score consumes APPROVED PROVIDER DATA (2026-07-04 product correction).
// LandPortal-returned road frontage, wetlands, FEMA, buildability, acreage, and
// valuation must be SCORED, not treated as data gaps just because they did not
// come from a county website. A value no approved provider gave stays a true gap.
import { describe, it, expect } from 'vitest';
import { landFactsForScore } from './deal-card-report.js';
import { computeLandScore } from './land-score.js';
import { buildParcelFactSheet } from './landportal-facts.js';

// A full LandPortal parcel read (mirrors the real Newberry SC card #5 fields).
const FULL_LP_FIELDS: Record<string, string> = {
  'Parcel ID': '397-1-1-106',
  Acres: '1.031',
  'Land Locked': 'No',
  'Road Frontage': '166.37 ft',
  'FEMA Flood Zone': 'Not in a flood hazard area',
  'FEMA Coverage (%)': '0',
  'Wetlands Coverage (%)': '0',
  'Buildability total (%)': '95.04',
  'Buildability area (acres)': '0.94',
  'Estimate price': '$12,602',
  'Estimate PPA': '$12,223',
  'Total Market Value': '$84,400.00',
};

describe('Land Score consumes approved provider (LandPortal) data', () => {
  it('scores LandPortal road frontage / wetlands / FEMA / buildability / acreage instead of gapping them', () => {
    const factSheet = buildParcelFactSheet(FULL_LP_FIELDS);
    // No verified propertyData (as with a persisted browser-verified parcel) — the
    // fact sheet is the only approved-provider source. It must still be used.
    const score = computeLandScore(landFactsForScore(undefined, factSheet));

    const byId = Object.fromEntries(score.factors.map((f) => [f.id, f]));
    expect(byId.access.dataGap).toBe(false);
    expect(byId.wetlands.dataGap).toBe(false);
    expect(byId.fema.dataGap).toBe(false);
    expect(byId.slope_buildability.dataGap).toBe(false);
    expect(byId.size_usability.dataGap).toBe(false);
    // Clean parcel → a real, high score with full confidence (not a data-limited 9).
    expect(score.confidence).toBe('full');
    expect(score.score).toBeGreaterThan(60);
    expect(score.dataGaps.length).toBe(0);
  });

  it('leaves a TRUE gap when no approved provider returned the field (never fabricated)', () => {
    // A thin LandPortal read (mirrors Winters TX card #1): access + acreage only.
    const thin = buildParcelFactSheet({ Acres: '128.55', 'Land Locked': 'No', 'Road Frontage': '392.17 ft' });
    const score = computeLandScore(landFactsForScore(undefined, thin));
    const byId = Object.fromEntries(score.factors.map((f) => [f.id, f]));
    expect(byId.access.dataGap).toBe(false);       // provider gave it → scored
    expect(byId.size_usability.dataGap).toBe(false);
    expect(byId.fema.dataGap).toBe(true);          // no provider value → honest gap
    expect(byId.slope_buildability.dataGap).toBe(true);
  });

  it('gov-DD cross-check fills FEMA/wetlands only for a verified "outside the hazard" reading', () => {
    const thin = buildParcelFactSheet({ Acres: '5', 'Road Frontage': '150 ft' });
    const govDd = {
      flood: { status: 'verified', zone: 'Zone X (area of minimal flood hazard)', note: '', source: null, timestamp: null },
      wetlands: { status: 'verified', type: 'None mapped', note: '', source: null, timestamp: null },
      slope: { status: 'not_run', slopeDeg: null, note: '', source: null, timestamp: null },
    };
    const score = computeLandScore(landFactsForScore(undefined, thin, govDd));
    const byId = Object.fromEntries(score.factors.map((f) => [f.id, f]));
    expect(byId.fema.dataGap).toBe(false);      // FEMA verified outside hazard → 0%
    expect(byId.wetlands.dataGap).toBe(false);  // NWI verified none mapped → 0%
  });
});

// USGS 3DEP slope (degrees) → Buildability factor, cross-checked with LandPortal.
function slopeGovDd(slopeDeg: number | null, status = 'verified') {
  return {
    flood: { status: 'not_run', zone: null, note: '', source: null, timestamp: null },
    wetlands: { status: 'not_run', type: null, note: '', source: null, timestamp: null },
    slope: { status, slopeDeg, note: '', source: null, timestamp: null },
  };
}

describe('USGS slope wired into Buildability', () => {
  it('USGS slope FILLS buildability when LandPortal did not return it (no artificial gap)', () => {
    const thin = buildParcelFactSheet({ Acres: '10', 'Road Frontage': '200 ft' }); // no Buildability field
    const inputs = landFactsForScore(undefined, thin, slopeGovDd(5.5)); // 5.5° ≈ 9.6% → workable → 70
    const score = computeLandScore(inputs);
    const bf = score.factors.find((f) => f.id === 'slope_buildability')!;
    expect(bf.dataGap).toBe(false);
    expect(inputs.buildability?.pct).toBe(70);
    expect(inputs.buildability?.conflict).toBe(false);
    expect(inputs.buildability?.basis).toMatch(/USGS/i);
    expect(bf.points).toBeGreaterThan(0);
  });

  it('slope thresholds: <5% best, 5–10% workable, 10–15% reduced, ≥15% concern', () => {
    const fs = (deg: number) => landFactsForScore(undefined, buildParcelFactSheet({ Acres: '5' }), slopeGovDd(deg)).buildability?.pct;
    expect(fs(1)).toBe(90);    // ~1.7% slope → strong
    expect(fs(5.5)).toBe(70);  // ~9.6% slope → workable
    expect(fs(6.5)).toBe(40);  // ~11.4% slope → reduced
    expect(fs(12)).toBe(15);   // ~21% slope → major concern
  });

  it('LandPortal + USGS AGREE → no conflict, both named (stronger confidence)', () => {
    const full = buildParcelFactSheet({ Acres: '1', 'Buildability total (%)': '92' });
    const inputs = landFactsForScore(undefined, full, slopeGovDd(1)); // ~1.7% → USGS 90, LP 92 → aligned
    expect(inputs.buildability?.pct).toBe(92);           // scored on LandPortal
    expect(inputs.buildability?.conflict).toBe(false);
    expect(inputs.buildability?.basis).toMatch(/LandPortal.*USGS.*aligned/i);
  });

  it('LandPortal + USGS MATERIALLY DISAGREE → conflict surfaced, scored on LandPortal (never ignored)', () => {
    const full = buildParcelFactSheet({ Acres: '1', 'Buildability total (%)': '95' });
    const inputs = landFactsForScore(undefined, full, slopeGovDd(6.5)); // ~11.4% → USGS 40 vs LP 95
    expect(inputs.buildability?.pct).toBe(95);            // LandPortal not ignored
    expect(inputs.buildability?.conflict).toBe(true);
    expect(inputs.buildability?.basis).toMatch(/disagree/i);
  });

  it('no slope + no LandPortal buildability → honest gap (not fabricated)', () => {
    const thin = buildParcelFactSheet({ Acres: '5' });
    const inputs = landFactsForScore(undefined, thin, slopeGovDd(null, 'needs_verification'));
    expect(inputs.buildability).toBeNull();
    const bf = computeLandScore(inputs).factors.find((f) => f.id === 'slope_buildability')!;
    expect(bf.dataGap).toBe(true);
  });
});
