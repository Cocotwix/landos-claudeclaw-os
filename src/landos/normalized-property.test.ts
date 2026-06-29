import { describe, it, expect } from 'vitest';
import {
  emptyNormalizedProperty, mergeNormalized, deriveConfidence, missingFields,
  corroboratingIdentityLanes, patchFromDukeVerification, patchFromCensus,
} from './normalized-property.js';
import type { DukeVerificationResult } from './duke-verification-bridge.js';

const TS = '2026-06-29T00:00:00.000Z';

describe('normalized property object', () => {
  it('starts empty with all practical fields missing', () => {
    const p = emptyNormalizedProperty();
    expect(p.parcelVerified).toBe(false);
    expect(p.confidence).toBe(0);
    expect(p.missing).toContain('address');
    expect(p.missing).toContain('coordinates');
  });

  it('merges a patch, records sourced evidence, and recomputes missing/confidence', () => {
    const p = emptyNormalizedProperty();
    mergeNormalized(p, 'address_suggest', 'Photon', { address: '388 Gilstrap Rd', state: 'GA', county: 'White', coordinates: { lat: 34.5, lng: -83.7 } }, { timestamp: TS, confidence: 0.8 });
    expect(p.address).toBe('388 Gilstrap Rd');
    expect(p.county).toBe('White');
    expect(p.coordinates).toEqual({ lat: 34.5, lng: -83.7 });
    expect(p.sources).toContain('Photon');
    expect(p.evidence.find((e) => e.field === 'address')?.source).toBe('Photon');
    expect(p.missing).not.toContain('address');
    expect(p.confidence).toBeGreaterThan(0);
  });

  it('does not let a weaker lane overwrite verified identity', () => {
    const p = emptyNormalizedProperty();
    mergeNormalized(p, 'realie_landportal', 'Realie.ai', { address: '388 Gilstrap Rd', apn: 'A1', parcelVerified: true, verificationSource: 'Realie.ai' }, { timestamp: TS, confidence: 0.95 });
    mergeNormalized(p, 'address_suggest', 'Photon', { address: 'WRONG ADDRESS', apn: 'B2' }, { timestamp: TS, confidence: 0.5 });
    expect(p.address).toBe('388 Gilstrap Rd');
    expect(p.apn).toBe('A1');
    expect(p.parcelVerified).toBe(true);
  });

  it('rejects out-of-range / zero coordinates (supporting only, never garbage)', () => {
    const p = emptyNormalizedProperty();
    mergeNormalized(p, 'census_geocode', 'US Census geocoder', { coordinates: { lat: 0, lng: 0 } }, { timestamp: TS });
    expect(p.coordinates).toBeUndefined();
    mergeNormalized(p, 'census_geocode', 'US Census geocoder', { coordinates: { lat: 999, lng: -83 } }, { timestamp: TS });
    expect(p.coordinates).toBeUndefined();
  });

  it('counts independent identity lanes for corroboration', () => {
    const p = emptyNormalizedProperty();
    mergeNormalized(p, 'address_suggest', 'Photon', { address: '1 Main St' }, { timestamp: TS });
    mergeNormalized(p, 'homeharvest', 'HomeHarvest', { address: '1 Main St' }, { timestamp: TS });
    mergeNormalized(p, 'census_geocode', 'US Census geocoder', { county: 'Clarke' }, { timestamp: TS }); // not identity
    const lanes = corroboratingIdentityLanes(p);
    expect(lanes).toContain('address_suggest');
    expect(lanes).toContain('homeharvest');
    expect(lanes).not.toContain('census_geocode');
  });

  it('verified parcel yields high confidence; unverified rises with corroboration', () => {
    const verifiedP = emptyNormalizedProperty();
    mergeNormalized(verifiedP, 'realie_landportal', 'Realie.ai', { address: '1 Main', apn: 'A1', parcelVerified: true, verificationSource: 'Realie.ai' }, { timestamp: TS });
    expect(deriveConfidence(verifiedP)).toBeGreaterThanOrEqual(0.9);

    const weak = emptyNormalizedProperty();
    mergeNormalized(weak, 'address_suggest', 'Photon', { address: '1 Main', state: 'GA', county: 'Clarke' }, { timestamp: TS });
    expect(deriveConfidence(weak)).toBeGreaterThan(0);
    expect(deriveConfidence(weak)).toBeLessThan(0.9);
  });

  it('builds a patch from a verified Duke result (only lane that sets parcelVerified)', () => {
    const v: DukeVerificationResult = {
      status: 'parcel_verified', parcelVerified: true, verificationSource: 'Realie.ai',
      identity: { situsAddress: '5 Pine', city: 'Cleveland', state: 'GA', county: 'White', apn: 'Z9', acres: 3 },
      coordinates: { lat: 34.5, lng: -83.7 }, sourceAttempts: [], dataGaps: [], marketPulseEligible: true,
      strategyUnderwritingBlocked: false, summary: '', executionMode: 'duke_verification_read_only',
    };
    const patch = patchFromDukeVerification(v);
    expect(patch.parcelVerified).toBe(true);
    expect(patch.apn).toBe('Z9');
    expect(patch.county).toBe('White');
  });

  it('builds a patch from census derivation (never parcelVerified)', () => {
    const patch = patchFromCensus({ county: 'White', state: 'GA', zip: '30528', fips: '13311', lat: 34.5, lng: -83.7 });
    expect(patch.county).toBe('White');
    expect(patch.fips).toBe('13311');
    expect(patch.parcelVerified).toBeUndefined();
  });

  it('missingFields reflects what is still unknown', () => {
    const p = emptyNormalizedProperty();
    mergeNormalized(p, 'address_suggest', 'Photon', { address: '1 Main', state: 'GA' }, { timestamp: TS });
    const missing = missingFields(p);
    expect(missing).not.toContain('address');
    expect(missing).not.toContain('state');
    expect(missing).toContain('apn');
    expect(missing).toContain('owner');
  });
});
