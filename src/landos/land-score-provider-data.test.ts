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
