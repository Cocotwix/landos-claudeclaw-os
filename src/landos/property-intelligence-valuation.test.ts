import { describe, expect, it } from 'vitest';
import { applyCompSourcePolicy } from './comp-source-policy.js';
import { buildPropertyIntelligenceValuation, type ValuationInput } from './property-intelligence-valuation.js';
import { buildPropertyIntelligenceStrategies, type StrategySynthesisInput } from './property-intelligence-strategy.js';
import { APPROVED_STRATEGIES } from './strategy-readiness.js';
import type { CompRegistryCandidate, SubjectMarket } from './comp-registry.js';
import type { SnapshotDueDiligenceItem } from './property-intelligence-snapshot.js';

const SUBJECT: SubjectMarket = { state: 'TN', county: 'Roane', acres: 12 };

function comp(i: number, overrides: Partial<CompRegistryCandidate> = {}): CompRegistryCandidate {
  return {
    provider: 'LandPortal visible',
    lane: 'sold',
    addressDesc: `${i} Ridge Rd, Kingston, TN 37763`,
    state: 'TN',
    price: 50_000 + i * 2_000,
    priceKind: 'sold',
    saleOrListDate: '2025-05-01',
    acres: 10,
    sourceUrl: `https://landportal.test/${i}`,
    compClass: 'vacant_land',
    ...overrides,
  } as CompRegistryCandidate;
}

function policyFor(candidates: CompRegistryCandidate[]) {
  return applyCompSourcePolicy(SUBJECT, candidates);
}

function valuationInput(overrides: Partial<ValuationInput> = {}): ValuationInput {
  return {
    identityState: 'confirmed',
    subjectAcres: 12,
    acreageConflict: false,
    policy: policyFor([comp(1), comp(2), comp(3), comp(4), comp(5)]),
    constraints: [],
    hardRisks: [],
    ...overrides,
  };
}

describe('buildPropertyIntelligenceValuation — refusals', () => {
  it('refuses to price an unconfirmed parcel', () => {
    const result = buildPropertyIntelligenceValuation(valuationInput({ identityState: 'unresolved' }));
    expect(result.priceable).toBe(false);
    expect(result.range).toBeNull();
    expect(result.confidence).toBe('none');
    expect(result.notPriceableReason).toMatch(/Parcel identity is unresolved/);
    expect(result.nextActionToPrice).toMatch(/Confirm the subject parcel/);
  });

  it('refuses to price with no accepted closed sale', () => {
    const result = buildPropertyIntelligenceValuation(valuationInput({ policy: policyFor([comp(1, { provider: 'Realie' })]) }));
    expect(result.priceable).toBe(false);
    expect(result.notPriceableReason).toMatch(/no value basis exists yet|No accepted vacant-land closed sale/);
    expect(result.nextActionToPrice).toBeTruthy();
  });

  it('refuses to price when accepted comps carry no acreage', () => {
    const result = buildPropertyIntelligenceValuation(valuationInput({ policy: policyFor([comp(1, { acres: null })]) }));
    expect(result.priceable).toBe(false);
    expect(result.notPriceableReason).toMatch(/no usable acreage|price-per-acre basis/i);
  });

  it('refuses to price when the subject acreage is unknown', () => {
    const result = buildPropertyIntelligenceValuation(valuationInput({ subjectAcres: null }));
    expect(result.priceable).toBe(false);
    expect(result.notPriceableReason).toMatch(/subject acreage is not established/);
  });

  it('refuses to price through an unresolved acreage conflict', () => {
    const result = buildPropertyIntelligenceValuation(valuationInput({ acreageConflict: true }));
    expect(result.priceable).toBe(false);
    expect(result.notPriceableReason).toMatch(/acreage bases disagree/);
    expect(result.nextActionToPrice).toMatch(/Resolve the governing acreage basis/);
  });
});

describe('buildPropertyIntelligenceValuation — priced conclusions', () => {
  it('produces a range, never a single number', () => {
    const result = buildPropertyIntelligenceValuation(valuationInput());
    expect(result.priceable).toBe(true);
    expect(result.range!.high).toBeGreaterThan(result.range!.low);
    expect(result.pricePerAcreRange!.high).toBeGreaterThan(result.pricePerAcreRange!.low);
    expect(result.likelyRetail!.high).toBeGreaterThanOrEqual(result.likelyRetail!.low);
    expect(result.dispositionRange!.high).toBeLessThan(result.likelyRetail!.high);
  });

  it('normalizes by acreage and states the basis', () => {
    const result = buildPropertyIntelligenceValuation(valuationInput());
    expect(result.basis).toMatch(/normalized to price per acre/);
    expect(result.basis).toMatch(/12\.00 governing acres/);
  });

  it('applies a larger-parcel discount when the subject dwarfs the comps', () => {
    const small = policyFor([1, 2, 3, 4, 5].map((i) => comp(i, { acres: 2, price: 20_000 })));
    const result = buildPropertyIntelligenceValuation(valuationInput({ policy: small, subjectAcres: 20 }));
    expect(result.adjustments.join(' ')).toMatch(/larger-parcel discount/);
  });

  it('applies a small-parcel premium when the subject is much smaller', () => {
    const large = policyFor([1, 2, 3, 4, 5].map((i) => comp(i, { acres: 40, price: 200_000 })));
    const result = buildPropertyIntelligenceValuation(valuationInput({ policy: large, subjectAcres: 5 }));
    expect(result.adjustments.join(' ')).toMatch(/small-parcel premium/);
  });

  it('discounts the band for mapped physical constraints', () => {
    const clean = buildPropertyIntelligenceValuation(valuationInput());
    const constrained = buildPropertyIntelligenceValuation(valuationInput({ constraints: ['62% of the parcel is mapped wetland'] }));
    expect(constrained.range!.high).toBeLessThan(clean.range!.high);
    expect(constrained.adjustments.join(' ')).toMatch(/mapped physical constraint/);
  });

  it('drops confidence and flags thinness on a one-comp set', () => {
    const result = buildPropertyIntelligenceValuation(valuationInput({ policy: policyFor([comp(1)]) }));
    expect(result.priceable).toBe(true);
    expect(result.confidence).toBe('low');
    expect(result.uncertainty.join(' ')).toMatch(/below the three needed for a defensible band/);
  });

  it('labels the disposition range as a planning assumption', () => {
    const result = buildPropertyIntelligenceValuation(valuationInput());
    expect(result.uncertainty.join(' ')).toMatch(/planning assumption applied to the retail band/);
  });

  it('excludes active listings from the value basis', () => {
    const withActive = policyFor([
      comp(1), comp(2), comp(3),
      comp(9, { provider: 'Zillow', lane: 'active', priceKind: 'list', price: 500_000 }),
    ]);
    const result = buildPropertyIntelligenceValuation(valuationInput({ policy: withActive }));
    expect(result.basis).toMatch(/tracked separately as competition and excluded from the value basis/);
    // A half-million asking price must not drag the band up.
    expect(result.pricePerAcreRange!.high).toBeLessThan(20_000);
  });
});

// ── Strategy ────────────────────────────────────────────────────────────────

const DD_CLEAN: SnapshotDueDiligenceItem[] = [
  { key: 'flood', label: 'Floodplain', verdict: 'good', headline: 'No mapped SFHA overlap.', grade: 'likely_indication', detail: null, sourceUrl: null, missing: [] },
  { key: 'wetlands', label: 'Wetlands', verdict: 'good', headline: 'No mapped NWI wetland.', grade: 'likely_indication', detail: null, sourceUrl: null, missing: [] },
  { key: 'septic', label: 'Soils and septic', verdict: 'good', headline: 'Favorable septic outlook.', grade: 'likely_indication', detail: null, sourceUrl: null, missing: [] },
  { key: 'access', label: 'Access', verdict: 'good', headline: 'Mapped public road contact.', grade: 'likely_indication', detail: null, sourceUrl: null, missing: [] },
];

function strategyInput(overrides: Partial<StrategySynthesisInput> = {}): StrategySynthesisInput {
  return {
    identityState: 'confirmed',
    subjectAcres: 12,
    valuation: buildPropertyIntelligenceValuation(valuationInput()),
    dueDiligence: DD_CLEAN,
    zoning: 'A-1 Agricultural',
    zoningKnown: true,
    utilitiesKnown: true,
    utilitiesSummary: 'Electric at the road; no public water.',
    accessStatus: 'public_road_proximity',
    landHomeCompCount: 3,
    acceptedSoldCount: 5,
    activeListingCount: 4,
    missionBlockers: [],
    ...overrides,
  };
}

describe('buildPropertyIntelligenceStrategies', () => {
  it('emits exactly the five approved strategies in order and never wholesaling', () => {
    const { strategies } = buildPropertyIntelligenceStrategies(strategyInput());
    expect(strategies.map((s) => s.strategy)).toEqual([
      'Quick Flip',
      'Novation or Double Close',
      'Subdivide or Minor Split',
      'Land-Home Package',
      'Improvement Then Flip',
    ]);
    expect(APPROVED_STRATEGIES).toHaveLength(5);
    expect(strategies.some((s) => /wholesal/i.test(s.strategy))).toBe(false);
  });

  it('gives every strategy the full decision fields', () => {
    const { strategies } = buildPropertyIntelligenceStrategies(strategyInput());
    for (const strategy of strategies) {
      expect(strategy.applicability).toBeTruthy();
      expect(strategy.effort.length).toBeGreaterThan(5);
      expect(strategy.timeline.length).toBeGreaterThan(5);
      expect(strategy.valueCreationPath.length).toBeGreaterThan(10);
      expect(strategy.risk.length).toBeGreaterThan(10);
      expect(strategy.nextVerificationStep.length).toBeGreaterThan(10);
      expect(Array.isArray(strategy.supportingFacts)).toBe(true);
      expect(Array.isArray(strategy.blockers)).toBe(true);
    }
  });

  it('produces one recommendation, not five narratives', () => {
    const { recommendation } = buildPropertyIntelligenceStrategies(strategyInput());
    expect(recommendation.preferredStrategy).toBeTruthy();
    expect(APPROVED_STRATEGIES).toContain(recommendation.preferredStrategy as never);
    expect(recommendation.posture).toBe('pursue');
    expect(recommendation.why.length).toBeGreaterThan(10);
    expect(recommendation.shouldPursue).toBe('yes');
    expect(recommendation.worth?.workingValue).toBeGreaterThan(0);
    expect(recommendation.targetBuyRange?.low).toBeGreaterThan(0);
    expect(recommendation.bestExit).toBe('Quick Flip');
    expect(recommendation.dealKillers).toEqual([]);
    expect(recommendation.nextConfirmations?.length).toBeGreaterThan(0);
    expect(recommendation.juiceWorthSqueeze?.answer).toBe('yes');
  });

  it('recommends nothing and holds when identity is unresolved', () => {
    const { strategies, recommendation } = buildPropertyIntelligenceStrategies(strategyInput({
      identityState: 'unresolved',
      valuation: buildPropertyIntelligenceValuation(valuationInput({ identityState: 'unresolved' })),
    }));
    expect(recommendation.preferredStrategy).toBeNull();
    expect(recommendation.posture).toBe('hold');
    expect(strategies.every((s) => s.applicability === 'blocked' || s.applicability === 'not_applicable')).toBe(true);
  });

  it('recommends nothing when the property is not priceable', () => {
    const { recommendation } = buildPropertyIntelligenceStrategies(strategyInput({
      valuation: buildPropertyIntelligenceValuation(valuationInput({ policy: policyFor([]) })),
    }));
    expect(recommendation.preferredStrategy).toBeNull();
    expect(recommendation.posture).toBe('hold');
    expect(recommendation.why).toMatch(/without a value basis/);
    expect(recommendation.shouldPursue).toBe('undetermined');
    expect(recommendation.worth).toBeNull();
    expect(recommendation.targetBuyRange).toBeNull();
    expect(recommendation.bestExit).toBeNull();
    expect(recommendation.juiceWorthSqueeze?.answer).toBe('undetermined');
  });

  it('rules out a split on a parcel too small for it', () => {
    const { strategies } = buildPropertyIntelligenceStrategies(strategyInput({ subjectAcres: 1.2 }));
    const split = strategies.find((s) => s.strategy === 'Subdivide or Minor Split')!;
    expect(split.applicability).toBe('not_applicable');
  });

  it('blocks the Land-Home lane when septic is a risk', () => {
    const { strategies } = buildPropertyIntelligenceStrategies(strategyInput({
      dueDiligence: DD_CLEAN.map((d) => d.key === 'septic'
        ? { ...d, verdict: 'risk' as const, headline: 'Severe septic limitation across the mapped soils.' }
        : d),
    }));
    const landHome = strategies.find((s) => s.strategy === 'Land-Home Package')!;
    expect(landHome.applicability).toBe('blocked');
    expect(landHome.blockers.join(' ')).toMatch(/Septic suitability is a risk/);
  });

  it('moves to renegotiate when hard risks are mapped', () => {
    const { recommendation } = buildPropertyIntelligenceStrategies(strategyInput({
      dueDiligence: DD_CLEAN.map((d) => ({ ...d, verdict: 'risk' as const, headline: `${d.label} risk` })),
    }));
    expect(recommendation.posture).toBe('renegotiate');
    expect(recommendation.postureWhy).toMatch(/should move the acquisition price/);
  });

  it('names what would change the recommendation', () => {
    const { recommendation } = buildPropertyIntelligenceStrategies(strategyInput());
    expect(recommendation.whatWouldChangeIt.length).toBeGreaterThan(0);
  });
});
