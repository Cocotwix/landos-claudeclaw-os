import { describe, it, expect } from 'vitest';
import { deriveIdentityTier, inferPropertyType, buildPreCallIntelligence, type ParcelFacts, type PreCallSourceSignals } from './pre-call-intelligence.js';

const sig = (o: Partial<PreCallSourceSignals> = {}): PreCallSourceSignals => ({ identityVerified: false, visualsCaptured: 0, compsCount: 0, marketPulse: false, browserEvidenceCount: 0, ...o });

describe('identity tier', () => {
  it('verified + locality ok => Verified Parcel', () => {
    expect(deriveIdentityTier({ verified: true, localityOk: true })).toBe('verified_parcel');
  });
  it('verified but locality downgraded => Candidate Parcel', () => {
    expect(deriveIdentityTier({ verified: true, localityOk: false })).toBe('candidate_parcel');
  });
  it('unverified vacant "0" address => Area-Only Context', () => {
    expect(deriveIdentityTier({ verified: false, inputAddress: '0 Fredonia Mountain Rd' })).toBe('area_only_context');
  });
  it('unverified but real street address => Candidate Parcel', () => {
    expect(deriveIdentityTier({ verified: false, inputAddress: '220 W White Rd' })).toBe('candidate_parcel');
  });
});

describe('property type inference', () => {
  it('large vacant ag acreage', () => {
    const r = inferPropertyType({ verified: true, acres: 40, zoning: 'A-1', inputAddress: '0 Fredonia Mountain Rd' });
    expect(r.vacantOrImproved).toBe('vacant');
    expect(r.context).toBe('acreage');
    expect(r.propertyType).toMatch(/acreage/i);
    expect(r.viableExits.some((e) => /subdiv/i.test(e))).toBe(true);
  });
  it('infill vacant lot', () => {
    const r = inferPropertyType({ verified: true, acres: 0.3, zoning: 'R-3', landUse: 'vacant residential', inputAddress: '0 1st Ave' });
    expect(r.context).toBe('infill');
    expect(r.vacantOrImproved).toBe('vacant');
    expect(r.likelyBuyer).toMatch(/builder|end-buyer/i);
  });
  it('a building footprint overrides a "0/vacant-looking" address => improved', () => {
    const r = inferPropertyType({ verified: true, acres: 8.6, buildingAreaSqft: 1512, yearBuilt: 1992, residential: true, inputAddress: '472 West Rd' });
    expect(r.vacantOrImproved).toBe('improved');
    expect(r.propertyType).toMatch(/improved/i);
  });

  it('insufficient data is honest, not fabricated', () => {
    const r = inferPropertyType({ verified: false });
    expect(r.propertyType).toMatch(/undetermined/i);
    expect(r.vacantOrImproved).toBe('unknown');
  });
  it('government owner raises a process risk', () => {
    const r = inferPropertyType({ verified: true, acres: 1, owner: 'MACON-BIBB COUNTY', inputAddress: '0 X Rd' });
    expect(r.risks.some((x) => /government|agency/i.test(x))).toBe(true);
  });
});

describe('pre-call intelligence readiness', () => {
  it('verified + comps + visuals => high, identity verified listed', () => {
    const r = buildPreCallIntelligence({ verified: true, localityOk: true }, sig({ identityVerified: true, compsCount: 5, visualsCaptured: 2, marketPulse: true }));
    expect(r.status).toBe('high');
    expect(r.identityTier).toBe('verified_parcel');
    expect(r.verified.some((v) => /identity/i.test(v))).toBe(true);
  });
  it('area-only, nothing retrieved => needs_verification, unknowns listed', () => {
    const r = buildPreCallIntelligence({ verified: false, inputAddress: '0 Green Rd' }, sig());
    expect(r.status).toBe('needs_verification');
    expect(r.identityTier).toBe('area_only_context');
    expect(r.unknown.length).toBeGreaterThan(0);
  });
  it('flood verified contributes to retrieved + verified', () => {
    const r = buildPreCallIntelligence({ verified: true, localityOk: true }, sig({ identityVerified: true, flood: 'verified', compsCount: 1 }));
    expect(r.verified.some((v) => /flood/i.test(v))).toBe(true);
  });
});
