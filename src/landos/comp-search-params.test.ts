import { describe, it, expect } from 'vitest';
import {
  planCompSearch,
  crowFliesMiles,
  viewportFor,
  radiusLadder,
  matchesIdentity,
  identityKey,
  AREA_LEVEL_TAG,
  RADIUS_CEILING_MILES,
  TIER_A_START_RADIUS_MILES,
  TIER_B_START_RADIUS_MILES,
} from './comp-search-params.js';

describe('crowFliesMiles', () => {
  it('is zero for the same point and positive + symmetric otherwise', () => {
    const a = { lat: 39.66, lng: -89.65 };
    const b = { lat: 39.70, lng: -89.60 };
    expect(crowFliesMiles(a, a)).toBe(0);
    expect(crowFliesMiles(a, b)).toBeGreaterThan(0);
    expect(crowFliesMiles(a, b)).toBeCloseTo(crowFliesMiles(b, a), 5);
  });

  it('approximates ~69mi for one degree of latitude', () => {
    const d = crowFliesMiles({ lat: 39, lng: -89 }, { lat: 40, lng: -89 });
    expect(d).toBeGreaterThan(68);
    expect(d).toBeLessThan(70);
  });
});

describe('viewportFor', () => {
  it('brackets the centroid (north>south, east>west)', () => {
    const vp = viewportFor({ lat: 39.66, lng: -89.65 }, 2);
    expect(vp.north).toBeGreaterThan(vp.south);
    expect(vp.east).toBeGreaterThan(vp.west);
  });
});

describe('radiusLadder', () => {
  it('caps at the 10mi ceiling and starts at the given radius', () => {
    expect(radiusLadder(2)).toEqual([2, 5, 10]);
    expect(radiusLadder(5)).toEqual([5, 10]);
    expect(radiusLadder(10)).toEqual([10]);
    expect(radiusLadder(2).every((r) => r <= RADIUS_CEILING_MILES)).toBe(true);
  });
});

describe('matchesIdentity — APN+county, never coordinates', () => {
  it('matches identical APN (+county/state) and rejects mismatches', () => {
    expect(matchesIdentity({ apn: '123', county: 'X', state: 'IL' }, { apn: '123', county: 'X', state: 'IL' })).toBe(true);
    expect(matchesIdentity({ apn: '123', county: 'X' }, { apn: '999', county: 'X' })).toBe(false);
  });
  it('cannot assert identity without an APN (never falls back to coords)', () => {
    expect(matchesIdentity({ county: 'X', state: 'IL' }, { county: 'X', state: 'IL' })).toBe(false);
    expect(identityKey({ apn: '', county: 'X' })).toContain('|x|');
  });
});

describe('planCompSearch — density-adaptive', () => {
  it('no trusted centroid -> no plan, loud reason, never invents a location', () => {
    const plan = planCompSearch({ apn: '123', county: 'X', state: 'IL' });
    expect(plan.centroid).toBeNull();
    expect(plan.steps).toEqual([]);
    expect(plan.reason).toMatch(/never invented/);
  });

  it('Tier A: parcel pinned, tight start radius, full 2->5->10 ladder, no area-level caveat', () => {
    const plan = planCompSearch({ apn: '123' }, { centroid: { lat: 39.66, lng: -89.65 }, tier: 'A' });
    expect(plan.tier).toBe('A');
    expect(plan.areaLevel).toBe(false);
    expect(plan.radiusMiles).toBe(TIER_A_START_RADIUS_MILES);
    expect(plan.steps.map((s) => s.radiusMiles)).toEqual([2, 5, 10]);
    expect(plan.tierLabel).not.toBe(AREA_LEVEL_TAG);
  });

  it('Tier B: area-level, wider start radius, carries the area-level caveat', () => {
    const plan = planCompSearch({ county: 'X', state: 'IL', centroid: { lat: 39.66, lng: -89.65 }, centroidTier: 'B' });
    expect(plan.tier).toBe('B');
    expect(plan.areaLevel).toBe(true);
    expect(plan.radiusMiles).toBe(TIER_B_START_RADIUS_MILES);
    expect(plan.steps.map((s) => s.radiusMiles)).toEqual([5, 10]);
    expect(plan.tierLabel).toBe(AREA_LEVEL_TAG);
  });

  it('carries identity (APN+county+state) but never coordinates as identity', () => {
    const plan = planCompSearch({ apn: '123', county: 'X', state: 'IL', centroid: { lat: 1, lng: 2 }, centroidTier: 'A' });
    expect(plan.identity).toEqual({ apn: '123', county: 'X', state: 'IL' });
  });
});
