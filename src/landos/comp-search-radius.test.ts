// The shared closed-comp search radius rules.
//
// These pin behaviour that two live defects produced. Deal 90 carried a $9,500
// record the county proved belonged to a DIFFERENT parcel and classified as not
// exposed to the open market, and a $380,000 record whose market signal belongs
// to an improved house. Either one, counted, makes thin evidence look
// sufficient. The counting rule is therefore the rule that matters, and it is
// asserted here directly rather than through a valuation.

import { describe, expect, it } from 'vitest';

import {
  CLOSED_COMP_RURAL_EXPANSION_RADIUS_MILES,
  CLOSED_COMP_START_RADIUS_MILES,
  MIN_QUALIFIED_CLOSED_COMPS,
  countQualifiedWithin,
  isQualifiedClosedComp,
  selectClosedCompSearchRadius,
  type RadiusCandidate,
} from './comp-search-radius.js';

const qualified = (over: Partial<RadiusCandidate> = {}): RadiusCandidate => ({
  distanceMiles: 2, priceKind: 'sale', propertyClass: 'vacant_land',
  category: 'accepted_closed_sale', valuationRole: 'direct',
  status: 'market_reference', operatorExcluded: false, valuationSelected: 0,
  nonMarket: false, ...over,
});

describe('rule 1-3: where the closed-comp search starts and when it may expand', () => {
  it('starts at five miles', () => {
    expect(CLOSED_COMP_START_RADIUS_MILES).toBe(5);
    expect(CLOSED_COMP_RURAL_EXPANSION_RADIUS_MILES).toBe(10);
    expect(MIN_QUALIFIED_CLOSED_COMPS).toBe(3);
  });

  it('stays at five when three qualified sales are already inside it', () => {
    const decision = selectClosedCompSearchRadius(
      [qualified({ distanceMiles: 1 }), qualified({ distanceMiles: 3 }), qualified({ distanceMiles: 4.9 })],
      { isRural: true },
    );
    expect(decision.miles).toBe(5);
    expect(decision.expanded).toBe(false);
    expect(decision.qualifiedWithinStart).toBe(3);
    expect(decision.reason).toContain('no expansion was required');
  });

  it('expands to ten for a rural subject short of three qualified sales', () => {
    const decision = selectClosedCompSearchRadius(
      [qualified({ distanceMiles: 3.4 }), qualified({ distanceMiles: 4.3 }),
        qualified({ distanceMiles: 5.3 }), qualified({ distanceMiles: 9.7 })],
      { isRural: true },
    );
    expect(decision.miles).toBe(10);
    expect(decision.expanded).toBe(true);
    expect(decision.qualifiedWithinStart).toBe(2);
    expect(decision.qualifiedWithinSelected).toBe(4);
    expect(decision.reason).toContain('rural');
  });

  it('never expands for a subject that is not rural, even when evidence is short', () => {
    const decision = selectClosedCompSearchRadius(
      [qualified({ distanceMiles: 1 }), qualified({ distanceMiles: 9 })],
      { isRural: false },
    );
    expect(decision.miles).toBe(5);
    expect(decision.expanded).toBe(false);
    expect(decision.reason).toContain('not recorded as rural');
  });

  it('expands only to ten, never further', () => {
    const decision = selectClosedCompSearchRadius([qualified({ distanceMiles: 40 })], { isRural: true });
    expect(decision.miles).toBe(10);
    expect(decision.qualifiedWithinSelected).toBe(0);
  });
});

describe('rule 4: what does not count toward the three', () => {
  const cases: Array<[string, Partial<RadiusCandidate>]> = [
    ['an active listing', { priceKind: 'list', category: 'active_competition' }],
    ['a duplicate folded through the canonical seam', { status: 'rejected' }],
    ['an improved sale', { propertyClass: 'improved' }],
    ['an improved-context record', { category: 'improved_context' }],
    ['a rejected record', { category: 'rejected', status: 'rejected' }],
    ['a context-only record', { category: 'context_only' }],
    ['a record whose location is unresolved', { distanceMiles: null }],
    ['a record held out by the operator', { operatorExcluded: true, valuationSelected: -1 }],
    ['a nonmarket sale', { nonMarket: true }],
    ['historical context', { valuationRole: 'historical_context' }],
    ['broader-market context', { valuationRole: 'geographic_context' }],
    ['a boundary comp', { valuationRole: 'boundary' }],
    ['a sale with no verified date', { valuationRole: 'recency_unverified' }],
  ];
  for (const [label, over] of cases) {
    it(`does not count ${label}`, () => {
      expect(isQualifiedClosedComp(qualified(over))).toBe(false);
    });
  }

  it('counts an ordinary nearby closed vacant-land sale', () => {
    expect(isQualifiedClosedComp(qualified())).toBe(true);
  });

  it('does not let inadmissible records make thin evidence look sufficient', () => {
    // Two real sales inside five miles, padded with five records that must not
    // count. Without rule 4 this reads as seven and never expands.
    const padded = [
      qualified({ distanceMiles: 3.4 }), qualified({ distanceMiles: 4.3 }),
      qualified({ distanceMiles: 1, nonMarket: true }),
      qualified({ distanceMiles: 1, propertyClass: 'improved' }),
      qualified({ distanceMiles: 1, status: 'rejected' }),
      qualified({ distanceMiles: 1, priceKind: 'list', category: 'active_competition' }),
      qualified({ distanceMiles: null }),
    ];
    expect(countQualifiedWithin(padded, CLOSED_COMP_START_RADIUS_MILES)).toBe(2);
    expect(selectClosedCompSearchRadius(padded, { isRural: true }).expanded).toBe(true);
  });
});

describe('rule 5: a nonmarket or wrong-parcel sale is retained, never counted', () => {
  it('excludes a sale proven to belong to another parcel from the count', () => {
    // Comp 1121: the county shows no 2025 transaction on this parcel, and the
    // $9,500 belongs to a different one that it classifies "not exposed to
    // open-market".
    const wrongParcel = qualified({ distanceMiles: 8.9, nonMarket: true, operatorExcluded: true, valuationSelected: -1 });
    expect(isQualifiedClosedComp(wrongParcel)).toBe(false);
    expect(countQualifiedWithin([wrongParcel], CLOSED_COMP_RURAL_EXPANSION_RADIUS_MILES)).toBe(0);
  });

  it('keeps the record itself intact so the lineage survives', () => {
    // The rule is "zero weight", not "delete": the candidate must still be a
    // readable record after being judged.
    const record = qualified({ distanceMiles: 8.9, nonMarket: true });
    isQualifiedClosedComp(record);
    expect(record.distanceMiles).toBe(8.9);
    expect(record.nonMarket).toBe(true);
    expect(record.priceKind).toBe('sale');
  });
});

// The radius is ABSOLUTE. These pin the consequence that matters: when nothing
// qualifies inside it, the answer is "this lane is unavailable", never a value
// assembled from evidence the search was not entitled to reach.
describe('the permitted radius is absolute', () => {
  it('permits ten miles only through the rural expansion, never more', () => {
    const far = [qualified({ distanceMiles: 10.1 }), qualified({ distanceMiles: 14 }), qualified({ distanceMiles: 25 })];
    const decision = selectClosedCompSearchRadius(far, { isRural: true });
    expect(decision.miles).toBe(CLOSED_COMP_RURAL_EXPANSION_RADIUS_MILES);
    expect(countQualifiedWithin(far, decision.miles)).toBe(0);
  });

  it('does not widen the radius just because the market is empty inside it', () => {
    // A thin market is not a licence to reach further: the decision is the same
    // whether there are two qualified sales inside ten miles or none.
    const empty = selectClosedCompSearchRadius([qualified({ distanceMiles: 30 })], { isRural: true });
    const thin = selectClosedCompSearchRadius(
      [qualified({ distanceMiles: 6 }), qualified({ distanceMiles: 30 })], { isRural: true },
    );
    expect(empty.miles).toBe(10);
    expect(thin.miles).toBe(10);
  });

  it('keeps Deal 115 on its ten-mile expansion', () => {
    // Rural, two qualified sales inside five miles, six inside ten.
    const deal115 = [3.4, 4.3, 5.3, 9.6, 9.6, 9.7].map((d) => qualified({ distanceMiles: d }));
    const decision = selectClosedCompSearchRadius(deal115, { isRural: true });
    expect(decision.qualifiedWithinStart).toBe(2);
    expect(decision.expanded).toBe(true);
    expect(decision.miles).toBe(10);
    expect(decision.qualifiedWithinSelected).toBe(6);
  });
});
