import { describe, expect, it } from 'vitest';
import { applyCompSourcePolicy } from './comp-source-policy.js';
import { buildPropertyIntelligenceValuation, type ValuationInput } from './property-intelligence-valuation.js';
import {
  buildPropertyIntelligenceStrategies,
  buildSubdivisionEconomics,
  type StrategySynthesisInput,
  type SubdivisionEvidenceInput,
} from './property-intelligence-strategy.js';
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
    expect(result.nextActionToPrice).toMatch(/Resolve the missing or conflicting subject identifiers/);
  });

  it('allows a low-confidence conditional valuation for a consistent discovery-stage identity', () => {
    const result = buildPropertyIntelligenceValuation(valuationInput({
      identityState: 'provisional',
      discoveryIdentityUsable: true,
      identityBasis: 'operator-supplied APN, county and state agree with the retained LandPortal subject page',
    }));
    expect(result.priceable).toBe(true);
    expect(result.range).not.toBeNull();
    expect(result.confidence).toBe('low');
    expect(result.basis).toMatch(/Working discovery estimate from the retained parcel match/);
    expect(result.uncertainty.join(' ')).toMatch(/operator-supplied APN.*LandPortal subject page/);
    expect(result.materialGaps.join(' ')).not.toMatch(/county|second match/i);
  });

  it('does not let a discovery handoff override unresolved or conflicted identity', () => {
    for (const identityState of ['unresolved', 'conflicted'] as const) {
      const result = buildPropertyIntelligenceValuation(valuationInput({
        identityState,
        discoveryIdentityUsable: true,
      }));
      expect(result.priceable).toBe(false);
      expect(result.confidence).toBe('none');
    }
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

  it('uses visible acreage weights instead of a fixed larger-parcel deduction', () => {
    const small = policyFor([1, 2, 3, 4, 5].map((i) => comp(i, { acres: 2, price: 20_000 })));
    const result = buildPropertyIntelligenceValuation(valuationInput({ policy: small, subjectAcres: 20 }));
    expect(result.adjustments.join(' ')).toMatch(/Acreage weighting applied rather than a fixed size deduction/);
    expect(result.primaryBasis).toMatch(/Weights:/);
  });

  it('uses visible acreage weights instead of a fixed small-parcel premium', () => {
    const large = policyFor([1, 2, 3, 4, 5].map((i) => comp(i, { acres: 40, price: 200_000 })));
    const result = buildPropertyIntelligenceValuation(valuationInput({ policy: large, subjectAcres: 5 }));
    expect(result.adjustments.join(' ')).toMatch(/Acreage weighting applied rather than a fixed size deduction/);
  });

  it('keeps qualitative or questionable terrain constraints neutral', () => {
    const clean = buildPropertyIntelligenceValuation(valuationInput());
    const constrained = buildPropertyIntelligenceValuation(valuationInput({ constraints: ['62% of the parcel is mapped wetland'] }));
    const questionable = buildPropertyIntelligenceValuation(valuationInput({
      valueAdjustments: [{
        label: 'Terrain/buildability',
        percent: -16,
        evidence: 'unverified slope and buildability calculation',
        reliability: 'questionable',
      }],
    }));
    expect(constrained.range).toEqual(clean.range);
    expect(constrained.adjustments.join(' ')).toMatch(/No automatic deduction/);
    expect(questionable.range).toEqual(clean.range);
    expect(questionable.adjustments.join(' ')).toMatch(/no numeric adjustment applied because the input is questionable/);
  });

  it('applies an explicit supported adjustment and explains the evidence', () => {
    const clean = buildPropertyIntelligenceValuation(valuationInput());
    const adjusted = buildPropertyIntelligenceValuation(valuationInput({
      valueAdjustments: [{
        label: 'Documented access burden',
        percent: -7.5,
        evidence: 'subject has a recorded shared-access burden absent from the accepted sales',
        reliability: 'verified',
      }],
    }));
    expect(adjusted.range!.high).toBeLessThan(clean.range!.high);
    expect(adjusted.adjustments.join(' ')).toMatch(/-7\.5% supported by subject has a recorded shared-access burden/);
  });

  it('quarantines unsupported slope/buildability hard-risk text from value and confidence', () => {
    const clean = buildPropertyIntelligenceValuation(valuationInput());
    const quarantined = buildPropertyIntelligenceValuation(valuationInput({
      hardRisks: ['Unsupported steep-slope and buildability percentage from an unverified parcel calculation.'],
    }));
    expect(quarantined.range).toEqual(clean.range);
    expect(quarantined.workingValue).toBe(clean.workingValue);
    expect(quarantined.confidence).toBe(clean.confidence);
    expect(quarantined.uncertainty.join(' ')).not.toMatch(/Unsupported steep-slope/i);
    expect(quarantined.adjustments.join(' ')).toMatch(/quarantined from value and confidence/i);
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

function subdivisionEvidence(overrides: Partial<SubdivisionEvidenceInput> = {}): SubdivisionEvidenceInput {
  return {
    governingJurisdiction: 'Pickens County, SC',
    minimumLotSize: '1 acre',
    minimumFrontage: '50 feet',
    minorSubdivisionThreshold: '5 lots',
    flagLotRules: 'Flag lots allowed subject to access stem standards.',
    sharedAccessRules: 'Shared access requires a recorded maintenance agreement.',
    privateRoadStandards: 'County private-road section applies above five lots.',
    legalMultiLotAccess: true,
    physicalMultiLotAccess: true,
    observedRoadNeckFeet: 52,
    concepts: [{
      name: 'Four-lot minor split',
      lotSizesAcres: [12, 12, 12, 16],
      accessConfiguration: 'Recorded shared drive through the existing road neck.',
      geometryBasis: 'Four conceptual envelopes fit the reviewed parcel shape outside mapped drainage.',
      ordinancePath: 'Minor subdivision review.',
      marketBand: '10-20 acres',
      grossValue: { low: 720_000, high: 840_000 },
      costs: [
        { category: 'acquisition', label: 'Acquisition', low: 250_000, high: 275_000, basis: 'Negotiation range.' },
        { category: 'survey_engineering', label: 'Survey and engineering', low: 18_000, high: 28_000, basis: 'Four-lot concept allowance.' },
        { category: 'plat_approval', label: 'Plat and approval', low: 4_000, high: 8_000, basis: 'Minor-plat allowance.' },
        { category: 'soil_testing', label: 'Soil testing', low: 8_000, high: 14_000, basis: 'Per-lot testing allowance.' },
        { category: 'access_road', label: 'Access and road', low: 45_000, high: 90_000, basis: 'Shared-drive concept allowance.' },
        { category: 'utilities', label: 'Utilities', low: 20_000, high: 50_000, basis: 'Service-extension allowance.' },
        { category: 'holding', label: 'Holding', low: 24_000, high: 42_000, basis: '12-18 month carry.' },
        { category: 'sales_marketing', label: 'Sales and marketing', low: 43_000, high: 50_000, basis: 'Brokerage and closing allowance.' },
        { category: 'contingency', label: 'Contingency', low: 35_000, high: 55_000, basis: 'Project uncertainty allowance.' },
      ],
      timeline: '12–18 months',
      mainRisk: 'The road neck may not satisfy shared-access standards after engineering review.',
    }],
    ...overrides,
  };
}

describe('buildPropertyIntelligenceStrategies', () => {
  it('treats subdivision as an access/rule-gated hypothesis and Quick Flip fallback', () => {
    const result = buildSubdivisionEconomics(subdivisionEvidence({
      legalMultiLotAccess: null,
      physicalMultiLotAccess: null,
    }));
    expect(result.status).toBe('hypothesis');
    expect(result.highestUpsideHypothesis).toBe('Subdivision');
    expect(result.immediateGatingIssue).toMatch(/legally and physically serve multiple lots/);
    expect(result.fallbackStrategy).toBe('Quick Flip');
    expect(result.ruleAndAccessGaps.join(' ')).toMatch(/Legal multi-lot access.*Physical multi-lot access/);
  });

  it('states net profit only when acquisition and every project-cost category are modeled', () => {
    const complete = buildSubdivisionEconomics(subdivisionEvidence());
    expect(complete.status).toBe('viable');
    expect(complete.concepts[0].fullyModeled).toBe(true);
    expect(complete.concepts[0].estimatedNetProfit).not.toBeNull();

    const incompleteInput = subdivisionEvidence();
    incompleteInput.concepts = [{
      ...incompleteInput.concepts[0],
      costs: incompleteInput.concepts[0].costs.filter((cost) => cost.category !== 'contingency'),
    }];
    const incomplete = buildSubdivisionEconomics(incompleteInput);
    expect(incomplete.concepts[0].estimatedNetProfit).toBeNull();
    expect(incomplete.concepts[0].missingCostCategories).toContain('contingency');
  });

  it('makes the split applicable only when rules, multi-lot access and full costs clear', () => {
    const { strategies, recommendation } = buildPropertyIntelligenceStrategies(strategyInput({
      subjectAcres: 52,
      subdivisionEvidence: subdivisionEvidence(),
    }));
    const split = strategies.find((strategy) => strategy.strategy === 'Subdivide or Minor Split') as typeof strategies[number] & {
      subdivisionEconomics: ReturnType<typeof buildSubdivisionEconomics>;
    };
    expect(split.applicability).toBe('applicable');
    expect(split.supportingFacts.join(' ')).toMatch(/Highest-upside hypothesis: subdivision/);
    expect(split.supportingFacts.join(' ')).toMatch(/modeled net profit/);
    expect(split.subdivisionEconomics.concepts[0].estimatedNetProfit).not.toBeNull();
    expect(recommendation.preferredStrategy).toBe('Subdivide or Minor Split');
    expect(recommendation.whatWouldChangeIt.join(' ')).toMatch(/Quick Flip would become preferred/);
  });

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

  it('ranks the five strategies conditionally when provisional identity is usable for discovery', () => {
    const valuation = buildPropertyIntelligenceValuation(valuationInput({
      identityState: 'provisional',
      discoveryIdentityUsable: true,
      identityBasis: 'supplied APN/county/state agree with LandPortal',
    }));
    const { strategies, recommendation } = buildPropertyIntelligenceStrategies(strategyInput({
      identityState: 'provisional',
      discoveryIdentityUsable: true,
      identityBasis: 'supplied APN/county/state agree with LandPortal',
      valuation,
    }));
    expect(strategies).toHaveLength(5);
    expect(strategies.some((strategy) => strategy.blockers.some((blocker) => /identity is provisional/i.test(blocker)))).toBe(false);
    expect(strategies.every((strategy) => strategy.applicability !== 'applicable')).toBe(true);
    expect(recommendation.preferredStrategy).toBeTruthy();
    expect(APPROVED_STRATEGIES).toContain(recommendation.preferredStrategy as never);
    expect(recommendation.posture).toBe('renegotiate');
    expect(recommendation.postureWhy).toMatch(/retained discovery-stage parcel match/);
    expect(recommendation.whatWouldChangeIt.join(' ')).toMatch(/Title, acreage and access diligence/);
    expect(recommendation.worth?.workingValue).toBeGreaterThan(0);
    expect(recommendation.targetBuyRange?.low).toBeGreaterThan(0);
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
