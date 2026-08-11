import { describe, expect, it } from 'vitest';

import {
  GEOGRAPHIC_TIERS,
  buildAcreageMarketContext,
  compDistanceMiles,
  describeGeographicExpansion,
  inAcreagePool,
  resolveGeographicTier,
  routeAcreage,
  routedAcreageSimilarity,
} from './acreage-router.js';

// The five real LandPortal sold land records LandOS already holds for the
// 60-acre acceptance subject at 9490 Elk Lake Rd, Williamsburg MI 49690.
// None of them carries coordinates or an address; every one states a sale date.
const ELK_LAKE_SUBJECT_ACRES = 60;
const ELK_LAKE_SOLD_RECORDS = [
  { acres: 40, price: 400_000, dateIso: '2025-03-21' },
  { acres: 85.32, price: 1_100_000, dateIso: '2026-02-12' },
  { acres: 40, price: 400_000, dateIso: '2025-03-21' },
  { acres: 40, price: 375_000, dateIso: '2025-02-04' },
  { acres: 39.94, price: 390_000, dateIso: '2025-04-04' },
] as const;

const ELK_LAKE_COORDS = { lat: 44.822439610896, lng: -85.404821349666 };

const ALL_REGIME_SUBJECTS = [1, 5, 20, 60, 500];

describe('improved acreage router regimes', () => {
  it('routes the real 60-acre Elk Lake subject into a broad large-acreage pool', () => {
    const route = routeAcreage(ELK_LAKE_SUBJECT_ACRES)!;
    expect(route.subjectAcres).toBe(60);
    expect(route.regime).toBe('large');
    expect(route.tightAcreageMatching).toBe(false);
    expect(route.pool.max / route.pool.min).toBeGreaterThanOrEqual(3);
    expect(route.pool.min).toBeLessThanOrEqual(60 * 0.35);
    expect(route.pool.max).toBeGreaterThanOrEqual(60 * 2.5);
  });

  it('admits the real 39.94, 40 and 85.32 acre LandPortal sold records', () => {
    const route = routeAcreage(ELK_LAKE_SUBJECT_ACRES)!;
    for (const record of ELK_LAKE_SOLD_RECORDS) {
      expect(inAcreagePool(record.acres, route)).toBe(true);
    }
    // 39.94 acres used to be discarded by six hundredths of an acre against the
    // old {min:40,max:160} band; it now sits inside the preferred window too.
    expect(route.preferred.min).toBeLessThanOrEqual(39.94);
    expect(route.preferred.max).toBeGreaterThanOrEqual(85.32);
    // No route means no acreage filtering, not an invented exclusion.
    expect(inAcreagePool(40, null)).toBe(true);
  });

  it('classifies every regime boundary by the operator rule', () => {
    expect(routeAcreage(1.99)!.regime).toBe('micro');
    expect(routeAcreage(2)!.regime).toBe('small');
    expect(routeAcreage(9.99)!.regime).toBe('small');
    expect(routeAcreage(10)!.regime).toBe('mid');
    expect(routeAcreage(29.99)!.regime).toBe('mid');
    expect(routeAcreage(30)!.regime).toBe('large');
    expect(routeAcreage(100)!.regime).toBe('large');
    expect(routeAcreage(100.01)!.regime).toBe('very_large');
    expect(routeAcreage(640)!.regime).toBe('very_large');
  });

  it('keeps tight acreage matching only for micro, small and mid subjects', () => {
    expect(routeAcreage(1)!.tightAcreageMatching).toBe(true);
    expect(routeAcreage(5)!.tightAcreageMatching).toBe(true);
    expect(routeAcreage(20)!.tightAcreageMatching).toBe(true);
    expect(routeAcreage(60)!.tightAcreageMatching).toBe(false);
    expect(routeAcreage(500)!.tightAcreageMatching).toBe(false);
  });

  it('keeps a small subject tighter than a large one and still excludes a 40-acre sale', () => {
    const small = routeAcreage(3)!;
    const large = routeAcreage(60)!;
    expect(small.tightAcreageMatching).toBe(true);
    expect(inAcreagePool(40, small)).toBe(false);
    expect(small.pool.max / small.pool.min).toBeLessThan(large.pool.max / large.pool.min);
  });

  it('keeps the preferred window inside the participation pool for every regime', () => {
    for (const subjectAcres of ALL_REGIME_SUBJECTS) {
      const route = routeAcreage(subjectAcres)!;
      expect(route.preferred.min).toBeGreaterThanOrEqual(route.pool.min);
      expect(route.preferred.max).toBeLessThanOrEqual(route.pool.max);
      expect(route.preferred.min).toBeLessThanOrEqual(subjectAcres);
      expect(route.preferred.max).toBeGreaterThanOrEqual(subjectAcres);
    }
  });

  it('gives every regime an operator-readable rationale, label and ranking emphasis', () => {
    for (const subjectAcres of ALL_REGIME_SUBJECTS) {
      const route = routeAcreage(subjectAcres)!;
      expect(route.rationale.length).toBeGreaterThanOrEqual(40);
      expect(route.regimeLabel.length).toBeGreaterThan(0);
      expect(route.pool.label).toContain('acres');
      expect(route.rankingEmphasis.length).toBeGreaterThan(0);
      for (const emphasis of route.rankingEmphasis) {
        expect(emphasis.length).toBeGreaterThan(0);
      }
    }
  });

  it('never invents a route for missing, zero, negative or non-finite acreage', () => {
    for (const value of [null, undefined, 0, -1, -60, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(routeAcreage(value)).toBeNull();
    }
  });
});

describe('routed acreage similarity', () => {
  it('scores an exact acreage match at 1', () => {
    const route = routeAcreage(ELK_LAKE_SUBJECT_ACRES)!;
    expect(routedAcreageSimilarity(60, route)).toBe(1);
  });

  it('gives every in-pool acreage strictly positive weight, including 39.94 and 85.32', () => {
    const route = routeAcreage(ELK_LAKE_SUBJECT_ACRES)!;
    for (const acres of [39.94, 40, 85.32, route.pool.min, route.pool.max]) {
      expect(routedAcreageSimilarity(acres, route)).toBeGreaterThan(0);
      expect(routedAcreageSimilarity(acres, route)).toBeLessThanOrEqual(1);
    }
  });

  it('ranks closer acreage above farther acreage for the 60-acre subject', () => {
    const route = routeAcreage(ELK_LAKE_SUBJECT_ACRES)!;
    expect(routedAcreageSimilarity(55, route)).toBeGreaterThan(routedAcreageSimilarity(40, route));
    expect(routedAcreageSimilarity(40, route)).toBeGreaterThan(routedAcreageSimilarity(25, route));
    expect(routedAcreageSimilarity(85.32, route)).toBeGreaterThan(routedAcreageSimilarity(120, route));
    expect(routedAcreageSimilarity(60, route)).toBeGreaterThan(routedAcreageSimilarity(55, route));
  });

  it('returns zero outside the pool, with no route, and with no acreage', () => {
    const route = routeAcreage(ELK_LAKE_SUBJECT_ACRES)!;
    expect(routedAcreageSimilarity(route.pool.min - 0.01, route)).toBe(0);
    expect(routedAcreageSimilarity(route.pool.max + 0.01, route)).toBe(0);
    expect(routedAcreageSimilarity(40, null)).toBe(0);
    expect(routedAcreageSimilarity(null, route)).toBe(0);
    expect(routedAcreageSimilarity(undefined, route)).toBe(0);
  });
});

describe('geographic tiers', () => {
  it('retains every tier and marks only the local tier as unexpanded', () => {
    expect(GEOGRAPHIC_TIERS.every((tier) => tier.retained)).toBe(true);
    expect(GEOGRAPHIC_TIERS.filter((tier) => !tier.expanded).map((tier) => tier.id)).toEqual(['local_10']);
    for (const tier of GEOGRAPHIC_TIERS) {
      expect(tier.label.length).toBeGreaterThan(0);
      expect(tier.rationale.length).toBeGreaterThan(0);
    }
  });

  it('starts geographic weight at 1 locally and never increases it outward', () => {
    expect(GEOGRAPHIC_TIERS[0].id).toBe('local_10');
    expect(GEOGRAPHIC_TIERS[0].weightMultiplier).toBe(1);
    for (const tier of GEOGRAPHIC_TIERS) {
      expect(tier.weightMultiplier).toBeGreaterThan(0);
      expect(tier.weightMultiplier).toBeLessThanOrEqual(1);
    }
    for (let index = 1; index < GEOGRAPHIC_TIERS.length; index += 1) {
      expect(GEOGRAPHIC_TIERS[index].weightMultiplier)
        .toBeLessThanOrEqual(GEOGRAPHIC_TIERS[index - 1].weightMultiplier);
    }
  });

  it('resolves each distance, including every tier boundary, into its tier', () => {
    expect(resolveGeographicTier(0).id).toBe('local_10');
    expect(resolveGeographicTier(9).id).toBe('local_10');
    expect(resolveGeographicTier(10).id).toBe('local_10');
    expect(resolveGeographicTier(10.1).id).toBe('near_20');
    expect(resolveGeographicTier(20).id).toBe('near_20');
    // Past the old hard 20-mile cutoff the evidence is retained, not deleted.
    expect(resolveGeographicTier(20.1).id).toBe('regional_35');
    expect(resolveGeographicTier(35).id).toBe('regional_35');
    expect(resolveGeographicTier(35.1).id).toBe('extended_50');
    expect(resolveGeographicTier(50).id).toBe('extended_50');
    expect(resolveGeographicTier(50.1).id).toBe('county_market');
    expect(resolveGeographicTier(500).id).toBe('county_market');
    expect(resolveGeographicTier(21).retained).toBe(true);
    expect(resolveGeographicTier(500).retained).toBe(true);
  });

  it('resolves an unavailable distance to a retained unresolved tier that says so', () => {
    for (const value of [null, undefined, Number.NaN, -1]) {
      expect(resolveGeographicTier(value).id).toBe('distance_unresolved');
    }
    const unresolved = resolveGeographicTier(null);
    expect(unresolved.retained).toBe(true);
    expect(unresolved.weightMultiplier).toBeLessThan(1);
    expect(unresolved.weightMultiplier).toBeGreaterThan(0);
    expect(unresolved.label).toMatch(/unresolved|unavailable/i);
    expect(unresolved.rationale).toMatch(/could not be resolved/i);
  });
});

describe('comp distance', () => {
  it('computes straight-line miles between real coordinates', () => {
    expect(compDistanceMiles(ELK_LAKE_COORDS, ELK_LAKE_COORDS)).toBe(0);
    const miles = compDistanceMiles(ELK_LAKE_COORDS, { lat: 44.9, lng: -85.3 })!;
    expect(miles).toBeGreaterThan(7);
    expect(miles).toBeLessThan(8);
    expect(resolveGeographicTier(miles).id).toBe('local_10');
  });

  it('never invents a distance when either side lacks finite valid coordinates', () => {
    expect(compDistanceMiles(ELK_LAKE_COORDS, { lat: null, lng: null })).toBeNull();
    expect(compDistanceMiles(ELK_LAKE_COORDS, { lat: 44.9, lng: null })).toBeNull();
    expect(compDistanceMiles(ELK_LAKE_COORDS, {})).toBeNull();
    expect(compDistanceMiles(null, ELK_LAKE_COORDS)).toBeNull();
    expect(compDistanceMiles(undefined, undefined)).toBeNull();
    expect(compDistanceMiles(ELK_LAKE_COORDS, { lat: Number.NaN, lng: -85.3 })).toBeNull();
    expect(compDistanceMiles(ELK_LAKE_COORDS, { lat: 91, lng: -85.3 })).toBeNull();
    expect(compDistanceMiles(ELK_LAKE_COORDS, { lat: 44.9, lng: 181 })).toBeNull();
  });
});

describe('geographic expansion narrative', () => {
  it('names every tier used and explains the expansion in miles', () => {
    const explanation = describeGeographicExpansion({
      route: routeAcreage(ELK_LAKE_SUBJECT_ACRES),
      tiersUsed: ['local_10', 'regional_35', 'distance_unresolved'],
      usableCount: 4,
    });
    expect(explanation.length).toBeGreaterThanOrEqual(40);
    expect(explanation).toContain('miles');
    expect(explanation).toContain(resolveGeographicTier(2).label);
    expect(explanation).toContain(resolveGeographicTier(25).label);
    expect(explanation).toContain(resolveGeographicTier(null).label);
    expect(explanation).toMatch(/expanded beyond the local 10 miles/i);
  });

  it('states plainly when the usable evidence never left the local tier', () => {
    const explanation = describeGeographicExpansion({
      route: routeAcreage(ELK_LAKE_SUBJECT_ACRES),
      tiersUsed: ['local_10'],
      usableCount: 3,
    });
    expect(explanation.length).toBeGreaterThanOrEqual(40);
    expect(explanation).toContain('miles');
    expect(explanation).toContain(resolveGeographicTier(2).label);
    expect(explanation).not.toMatch(/expanded beyond the local 10 miles/i);
  });

  it('says acreage was unavailable rather than inventing a route', () => {
    const explanation = describeGeographicExpansion({
      route: null,
      tiersUsed: ['local_10'],
      usableCount: 1,
    });
    expect(explanation.length).toBeGreaterThanOrEqual(40);
    expect(explanation).toContain('miles');
    expect(explanation).toMatch(/acreage was unavailable/i);
  });
});

describe('acreage market context', () => {
  it('builds the price-per-acre band from the five real Elk Lake sold records', () => {
    const route = routeAcreage(ELK_LAKE_SUBJECT_ACRES);
    const context = buildAcreageMarketContext({
      route,
      comps: ELK_LAKE_SOLD_RECORDS.map((record) => ({
        acres: record.acres,
        pricePerAcre: record.price / record.acres,
        distanceMiles: null,
      })),
    })!;
    expect(context.subjectAcres).toBe(60);
    expect(context.route.regime).toBe('large');
    // All five real records price the subject; today LandOS priced it from none.
    expect(context.usableCount).toBe(5);
    expect(context.pricePerAcre!.low).toBeCloseTo(9_375, 2);
    expect(context.pricePerAcre!.mid).toBeCloseTo(10_000, 2);
    expect(context.pricePerAcre!.high).toBeCloseTo(12_892.64, 2);
  });

  it('tags the tiers used, including comps whose location could not be resolved', () => {
    const context = buildAcreageMarketContext({
      route: routeAcreage(ELK_LAKE_SUBJECT_ACRES),
      comps: [
        { acres: 40, pricePerAcre: 10_000, distanceMiles: null },
        { acres: 85.32, pricePerAcre: 12_892.64, distanceMiles: 26 },
        { acres: 40, pricePerAcre: 9_375, distanceMiles: 12 },
        { acres: 39.94, pricePerAcre: 9_764.65, distanceMiles: 8 },
      ],
    })!;
    expect(context.usableCount).toBe(4);
    expect(context.pricePerAcre).toEqual({ low: 9_375, mid: 9_882.325, high: 12_892.64 });
    expect(context.tiersUsed).toEqual(['local_10', 'near_20', 'regional_35', 'distance_unresolved']);
    expect(context.expansionExplanation).toMatch(/expanded beyond the local 10 miles/i);
  });

  it('excludes out-of-pool and unpriced rows from the band', () => {
    const context = buildAcreageMarketContext({
      route: routeAcreage(ELK_LAKE_SUBJECT_ACRES),
      comps: [
        { acres: 40, pricePerAcre: 10_000, distanceMiles: null },
        { acres: 200, pricePerAcre: 5_000, distanceMiles: 2 },
        { acres: 40, pricePerAcre: null, distanceMiles: 3 },
      ],
    })!;
    expect(context.usableCount).toBe(1);
    expect(context.pricePerAcre).toEqual({ low: 10_000, mid: 10_000, high: 10_000 });
    expect(context.tiersUsed).toEqual(['distance_unresolved']);
  });

  it('reports no band rather than inventing one, and no context without a route', () => {
    const empty = buildAcreageMarketContext({ route: routeAcreage(ELK_LAKE_SUBJECT_ACRES), comps: [] })!;
    expect(empty.usableCount).toBe(0);
    expect(empty.pricePerAcre).toBeNull();
    expect(empty.tiersUsed).toEqual([]);
    expect(buildAcreageMarketContext({ route: null, comps: [] })).toBeNull();
    expect(buildAcreageMarketContext({ route: routeAcreage(0), comps: [] })).toBeNull();
  });
});
