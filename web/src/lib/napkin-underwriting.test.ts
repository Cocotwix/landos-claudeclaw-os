import { describe, expect, it } from 'vitest';

import {
  buildAcquisitionNapkin, buildStrategyNapkins, computeNapkinEconomics, strategyIdentity,
} from './napkin-underwriting';

const SUPPORTED_SUMMARY = {
  fmv: { low: 2_800_000, central: 3_084_000, high: 3_400_000 },
  acquisitionLevels: { pct40: 1_233_500, pct50: 1_542_000, pct60: 1_850_500 },
  status: 'supported' as const,
  statusLabel: 'Supported',
  basisLabel: 'Accepted comparable sales',
};

describe('acquisition napkin', () => {
  it('consumes the canonical supported FMV and its persisted 40/50/60 levels', () => {
    const n = buildAcquisitionNapkin(
      SUPPORTED_SUMMARY, { technicalMaxOffer: 1_400_000, technicalMaxPctOfFmv: 45.4 }, 1_650_000,
      null, { cashMao: 1_400_000, bindingConstraint: 'minimum_net' },
    )!;
    expect(n.supportedFmv).toBe(3_084_000);
    expect(n.fmvBasisLabel).toBe('Accepted comparable sales');
    expect(n.band).toEqual(SUPPORTED_SUMMARY.acquisitionLevels);
    expect(n.bandSource).toBe('persisted_acquisition_levels');
    expect(n.sellerAsk).toBe(1_650_000);
    expect(n.currentCeiling).toBe(1_400_000);
    expect(n.currentCeilingSource).toMatch(/Quick-flip cash MAO.*minimum-net constraint binds/);
    expect(n.askSpreadToFmv).toBe(3_084_000 - 1_650_000);
    expect(Math.round(n.askPctOfFmv!)).toBe(54);
  });

  it('derives 40/50/60 deterministically only when levels are not persisted', () => {
    const n = buildAcquisitionNapkin({ ...SUPPORTED_SUMMARY, fmv: { low: null, central: 300_000, high: null }, acquisitionLevels: null }, null, null)!;
    expect(n.band).toEqual({ pct40: 120_000, pct50: 150_000, pct60: 180_000 });
    expect(n.bandSource).toBe('derived_from_supported_fmv');
  });

  it('preserves unknowns: no ask and no canonical ceiling stay null, never zero', () => {
    const n = buildAcquisitionNapkin(SUPPORTED_SUMMARY, null, null)!;
    expect(n.sellerAsk).toBeNull();
    expect(n.currentCeiling).toBeNull();
    expect(n.askSpreadToFmv).toBeNull();
  });

  it('Deal-89 shape: cash MAO is the canonical ceiling; the cost-stack technical maximum stays a distinct labeled concept', () => {
    const n = buildAcquisitionNapkin(
      SUPPORTED_SUMMARY,
      { technicalMaxOffer: 1_989_000, technicalMaxPctOfFmv: 64 },
      null,
      { hardCeiling: 1_989_000, ceilingBasis: 'technical_above_band' },
      { cashMao: 1_850_500, bindingConstraint: 'sixty_pct_of_fmv' },
    )!;
    expect(n.currentCeiling).toBe(1_850_500);
    expect(n.currentCeilingSource).toMatch(/Quick-flip cash MAO \(60% of FMV\) — 60%-of-FMV doctrine cap binds/);
    expect(n.technicalCeiling).toBe(1_989_000);
    expect(n.technicalCeilingNote).toMatch(/pre-doctrine.*not the current supported ceiling/);
  });

  it('does not surface a separate technical ceiling when it equals the canonical one', () => {
    const n = buildAcquisitionNapkin(
      SUPPORTED_SUMMARY,
      { technicalMaxOffer: 1_850_500, technicalMaxPctOfFmv: 60 },
      null,
      { hardCeiling: 1_850_500, ceilingBasis: 'technical_inside_band' },
      { cashMao: 1_850_500, bindingConstraint: 'sixty_pct_of_fmv' },
    )!;
    expect(n.currentCeiling).toBe(1_850_500);
    expect(n.technicalCeiling).toBeNull();
  });

  it('returns null with no canonical FMV instead of inventing one', () => {
    expect(buildAcquisitionNapkin({ ...SUPPORTED_SUMMARY, fmv: null }, null, 100_000)).toBeNull();
    expect(buildAcquisitionNapkin(null, null, 100_000)).toBeNull();
  });
});

describe('deterministic napkin economics', () => {
  it('computes product-count × exit-value ranges conservatively', () => {
    const r = computeNapkinEconomics({
      purchaseBasis: { value: 1_500_000, kind: 'assumption', source: 'mid band' },
      productCount: { low: 8, base: 10, high: 12, kind: 'assumption', source: 'sketch' },
      exitValuePerProduct: { low: 225_000, base: 250_000, high: 275_000, kind: 'assumption', source: 'sketch' },
      majorCosts: { low: 300_000, base: 400_000, high: 500_000, kind: 'assumption', source: 'sketch' },
      holdSellingAllowance: { value: 200_000, kind: 'assumption', source: 'allowance' },
    });
    expect(r.economics).toBe('complete');
    expect(r.roughGrossRevenue).toMatchObject({ low: 1_800_000, base: 2_500_000, high: 3_300_000 });
    expect(r.roughTotalInvestment).toMatchObject({ low: 2_000_000, base: 2_100_000, high: 2_200_000 });
    // low profit pairs low revenue with high investment
    expect(r.roughNetProfit).toMatchObject({ low: -400_000, base: 400_000, high: 1_300_000 });
    expect(Math.round(r.roughRoiPct!.base)).toBe(19);
  });

  it('an unknown major-cost input never becomes zero: economics are INCOMPLETE', () => {
    const r = computeNapkinEconomics({
      purchaseBasis: { value: 1_500_000, kind: 'assumption', source: 'mid band' },
      grossRevenue: { base: 3_000_000, kind: 'supported_fact', source: 'fmv' },
      holdSellingAllowance: { value: 200_000, kind: 'market_supported', source: 'stack' },
    });
    expect(r.economics).toBe('incomplete');
    expect(r.roughNetProfit).toBeNull();
    expect(r.incompleteReason).toMatch(/Major costs unknown/);
  });

  it('an unknown hold/sell allowance also blocks profit rather than zero-filling', () => {
    const r = computeNapkinEconomics({
      purchaseBasis: { value: 1_500_000, kind: 'assumption', source: 'mid band' },
      grossRevenue: { base: 3_000_000, kind: 'supported_fact', source: 'fmv' },
      noMajorCostsSupported: true,
      holdSellingAllowance: null,
    });
    expect(r.economics).toBe('incomplete');
    expect(r.incompleteReason).toMatch(/allowance unknown/i);
  });

  it('is deterministic', () => {
    const inputs = {
      purchaseBasis: { value: 1_000_000, kind: 'assumption' as const, source: 'b' },
      grossRevenue: { base: 2_000_000, kind: 'supported_fact' as const, source: 'f' },
      noMajorCostsSupported: true,
      holdSellingAllowance: { value: 150_000, kind: 'market_supported' as const, source: 's' },
    };
    expect(computeNapkinEconomics(inputs)).toEqual(computeNapkinEconomics(inputs));
  });
});

describe('strategy napkins', () => {
  const quickFlip = {
    technicalMaxOffer: 1_400_000, technicalMaxPctOfFmv: 45.4,
    totalNonAcquisitionCosts: 520_000, expectedMarketingDays: 120,
  };

  it('builds an as-is resale napkin from canonical FMV + the canonical cash-MAO ceiling', () => {
    const [s] = buildStrategyNapkins({
      summary: SUPPORTED_SUMMARY, quickFlip, strategies: [],
      screenEconomics: { cashMao: 1_400_000, bindingConstraint: 'minimum_net' },
    });
    expect(s.id).toBe('as-is-resale');
    expect(s.economics).toBe('complete');
    expect(s.purchaseBasis).toMatchObject({ value: 1_400_000, kind: 'market_supported' });
    expect(s.roughGrossRevenue).toMatchObject({ base: 3_084_000, kind: 'supported_fact' });
    expect(s.roughNetProfit!.base).toBe(3_084_000 - (1_400_000 + 520_000));
    expect(s.napkinSketch).toBe(false);
  });

  it('marks transformation strategies as napkin sketches with INCOMPLETE economics — never fabricated yield', () => {
    const scenarios = buildStrategyNapkins({
      summary: SUPPORTED_SUMMARY, quickFlip,
      strategies: [{
        strategy: 'Subdivision', applicability: 'conditional',
        valueCreationPath: 'Split into estate-sized lots',
        blockers: ['Yield unconfirmed'], nextVerificationStep: 'Confirm currently supportable lot yield with county',
        timeline: '18-30 months',
      }],
    });
    const sub = scenarios.find((s) => s.id === 'lane-subdivision')!;
    expect(sub.napkinSketch).toBe(true);
    expect(sub.economics).toBe('incomplete');
    expect(sub.roughProductCount).toBeNull(); // no historic lot count promoted to current yield
    expect(sub.roughNetProfit).toBeNull();
    expect(sub.incompleteReason).toMatch(/worth further investigation.*incomplete until/i);
    expect(sub.controllingUnknowns.join(' ')).toMatch(/lot yield/i);
  });

  it('only creates scenarios the lane assessed as viable/conditional — no generic menu', () => {
    const scenarios = buildStrategyNapkins({
      summary: SUPPORTED_SUMMARY, quickFlip,
      strategies: [
        { strategy: 'Land-home package', applicability: 'blocked' },
        { strategy: 'Assemblage', applicability: 'not_applicable' },
      ],
    });
    expect(scenarios.map((s) => s.id)).toEqual(['as-is-resale']);
  });

  it('with no FMV and no lane strategies, produces nothing rather than inventing scenarios', () => {
    expect(buildStrategyNapkins({ summary: null, quickFlip: null, strategies: null })).toEqual([]);
  });
});

describe('deal-brain strategy projection', () => {
  const quickFlip = {
    technicalMaxOffer: 1_850_500, technicalMaxPctOfFmv: 60,
    totalNonAcquisitionCosts: 520_000, expectedMarketingDays: 300,
  };
  const DEAL_89_BRAIN = [
    {
      strategy: 'Patient intact acquisition and resale', fit: 'possible',
      whyItFits: 'Simplest product supported without an assumed lot yield.',
      valueCreation: 'Buy at a basis compensating for long resale exposure.',
      whatWeakensIt: 'Grade D liquidity and no seller price.',
      whatToConfirm: 'Seller price and terms, legal Kingwood Boulevard access.',
    },
    {
      strategy: 'Two-lot partition followed by resale', fit: 'possible',
      whyItFits: 'Simplest realistic product transformation.',
      valueCreation: 'Create two independently serviceable acreage products.',
      whatWeakensIt: 'Only one 22.94–50-foot road throat.',
      whatToConfirm: 'Survey-based lot geometry and recorded access rights.',
    },
    { strategy: 'Single estate homesite or land-home product', fit: 'weak' },
    { strategy: 'Major subdivision or entitlement', fit: 'rejected', whatToConfirm: 'Former 119 lots covered a different assemblage.' },
    { strategy: 'Base quick flip within 150 days', fit: 'rejected' },
  ];

  it('projects only supported fits: possible/strong project, weak and rejected never do', () => {
    const scenarios = buildStrategyNapkins({
      summary: SUPPORTED_SUMMARY, quickFlip, strategies: [],
      screenEconomics: { cashMao: 1_850_500, bindingConstraint: 'sixty_pct_of_fmv' },
      dealBrainStrategies: DEAL_89_BRAIN,
    });
    const ids = scenarios.map((s) => s.id);
    expect(ids).toContain('as-is-resale');
    expect(ids).toContain('brain-split-partition');
    expect(ids.some((i) => /land-home|major-subdivision|novation|quick/.test(i))).toBe(false);
    expect(scenarios).toHaveLength(2);
  });

  it('deduplicates by semantic identity: the intact deal-brain strategy enriches the as-is napkin instead of duplicating it', () => {
    const scenarios = buildStrategyNapkins({
      summary: SUPPORTED_SUMMARY, quickFlip, strategies: [],
      screenEconomics: { cashMao: 1_850_500, bindingConstraint: 'sixty_pct_of_fmv' },
      dealBrainStrategies: DEAL_89_BRAIN,
      bestCurrentStrategy: { strategy: 'Pursue only a deeply discounted acquisition for patient intact resale.', why: null },
    });
    const intact = scenarios.filter((s) => /intact|as[- ]is/i.test(`${s.id} ${s.label}`));
    expect(intact).toHaveLength(1);
    expect(intact[0].id).toBe('as-is-resale');
    expect(intact[0].economics).toBe('complete'); // acquisition napkin economics untouched
    expect(intact[0].provenance.join(' ')).toMatch(/Deal Brain strategy assessment.*fit possible/);
    expect(intact[0].provenance).toContain('Deal Brain best current strategy');
    expect(intact[0].killConditions.join(' ')).toMatch(/Grade D liquidity/);
  });

  it('keeps the projected two-lot partition an incomplete napkin sketch with no fabricated economics', () => {
    const scenarios = buildStrategyNapkins({
      summary: SUPPORTED_SUMMARY, quickFlip, strategies: [], dealBrainStrategies: DEAL_89_BRAIN,
    });
    const split = scenarios.find((s) => s.id === 'brain-split-partition')!;
    expect(split.napkinSketch).toBe(true);
    expect(split.economics).toBe('incomplete');
    expect(split.purchaseBasis.value).toBeNull();
    expect(split.roughProductCount).toBeNull(); // no lot count invented — historic 119-lot plan never becomes yield
    expect(split.roughGrossRevenue).toBeNull();
    expect(split.roughNetProfit).toBeNull();
    expect(split.controllingUnknowns.join(' ')).toMatch(/Survey-based lot geometry/);
    expect(split.killConditions.join(' ')).toMatch(/road throat/);
  });

  it('collapses duplicate concepts across lane and deal-brain sources deterministically', () => {
    const scenarios = buildStrategyNapkins({
      summary: SUPPORTED_SUMMARY, quickFlip,
      strategies: [{ strategy: 'Simple Split', applicability: 'conditional', valueCreationPath: 'Split into two lots' }],
      dealBrainStrategies: DEAL_89_BRAIN,
    });
    const splits = scenarios.filter((s) => strategyIdentity(s.label) === 'split-partition');
    expect(splits).toHaveLength(1);
    expect(splits[0].id).toBe('lane-simple-split'); // richer existing scenario kept, enriched
    expect(splits[0].provenance.join(' ')).toMatch(/Deal Brain strategy assessment/);
  });

  it('is deterministic and read-only over its inputs shape', () => {
    const inputs = {
      summary: SUPPORTED_SUMMARY, quickFlip, strategies: [] as never[],
      dealBrainStrategies: DEAL_89_BRAIN,
    };
    expect(buildStrategyNapkins(inputs)).toEqual(buildStrategyNapkins(inputs));
  });
});
