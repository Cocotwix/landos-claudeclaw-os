import { describe, it, expect } from 'vitest';
import { buildPursuitDecision } from './deal-card-pursuit.js';

const soldValuation = {
  primary: { value: 100_000, ppa: 5_000, label: 'Sold land comps (4)', kind: 'comp_sold' },
  confidence: 'high' as const,
  conflict: false,
  conflictNote: null,
};

describe('buildPursuitDecision — the one Strategy question', () => {
  it('answers PURSUE with a 40-60% attractive band on a sold-comp-backed value', () => {
    const d = buildPursuitDecision({
      parcelVerified: true,
      valuation: soldValuation,
      compState: { soldCount: 4, anyRetrieved: true, strategyLine: 'Sold comps retrieved (4).' },
      strategyRanking: [
        { strategy: 'Quick flip', viability: 'viable', reason: 'clean access + supportive band' },
        { strategy: 'Subdivide', viability: 'maybe', reason: 'depends on county minimums' },
      ],
      strongestStrategy: { strategy: 'Quick flip', why: 'clean access + supportive band' },
      pricingAllowed: true,
    });
    expect(d.question).toBe('Should I pursue this opportunity?');
    expect(d.answer).toBe('pursue');
    expect(d.attractiveAcquisition).toMatchObject({ low: 40_000, high: 60_000, estMarketValue: 100_000 });
    expect(d.answerLine).toMatch(/\$40,000–\$60,000/);
    expect(d.recommended?.strategy).toBe('Quick flip');
    expect(d.runnerUps.map((r) => r.strategy)).toEqual(['Subdivide']);
  });

  it('is honestly insufficient_data with no valuation basis — never an invented price', () => {
    const d = buildPursuitDecision({
      parcelVerified: true,
      valuation: { primary: null, confidence: 'low', conflict: false, conflictNote: null },
      compState: { soldCount: 0, anyRetrieved: false, strategyLine: 'No comps retrieved yet.' },
    });
    expect(d.answer).toBe('insufficient_data');
    expect(d.attractiveAcquisition).toBeNull();
    expect(d.answerLine).toMatch(/no source-backed/i);
  });

  it('is insufficient_data when the parcel is not verified (identity gates strategy)', () => {
    const d = buildPursuitDecision({ parcelVerified: false, valuation: soldValuation, compState: { soldCount: 4, anyRetrieved: true, strategyLine: '' } });
    expect(d.answer).toBe('insufficient_data');
    expect(d.answerLine).toMatch(/parcel is not confirmed/i);
  });

  it('HOLDs on a deal-killer-class risk (landlocked / title / lien)', () => {
    const d = buildPursuitDecision({
      parcelVerified: true,
      valuation: soldValuation,
      compState: { soldCount: 4, anyRetrieved: true, strategyLine: '' },
      riskFlags: ['Parcel appears landlocked with no legal access'],
      pricingAllowed: true,
    });
    expect(d.answer).toBe('hold');
    expect(d.majorBlockers.some((b) => /landlocked/i.test(b))).toBe(true);
  });

  it('downgrades to pursue_with_caution on a valuation conflict', () => {
    const d = buildPursuitDecision({
      parcelVerified: true,
      valuation: { ...soldValuation, conflict: true, conflictNote: 'Sold comps imply $100k but assessed implies $30k.' },
      compState: { soldCount: 4, anyRetrieved: true, strategyLine: '' },
      pricingAllowed: true,
    });
    expect(d.answer).toBe('pursue_with_caution');
    expect(d.reasons.join(' ')).toMatch(/disagree|conflict|imply/i);
  });

  it('pursue_with_caution when the value basis is not sold comps', () => {
    const d = buildPursuitDecision({
      parcelVerified: true,
      valuation: { primary: { value: 80_000, ppa: null, label: 'LandPortal estimate', kind: 'lp_estimate' }, confidence: 'medium', conflict: false, conflictNote: null },
      compState: { soldCount: 0, anyRetrieved: true, strategyLine: '' },
      pricingAllowed: true,
    });
    expect(d.answer).toBe('pursue_with_caution');
    expect(d.attractiveAcquisition).toMatchObject({ low: 32_000, high: 48_000 });
  });

  it('places the seller asking relative to the attractive band (context only)', () => {
    const within = buildPursuitDecision({ parcelVerified: true, valuation: soldValuation, compState: { soldCount: 4, anyRetrieved: true, strategyLine: '' }, askingPrice: 50_000, pricingAllowed: true });
    expect(within.askingContext).toMatch(/within the attractive band/);
    const above = buildPursuitDecision({ parcelVerified: true, valuation: soldValuation, compState: { soldCount: 4, anyRetrieved: true, strategyLine: '' }, askingPrice: 90_000, pricingAllowed: true });
    expect(above.askingContext).toMatch(/above the attractive band/);
    expect(above.askingContext).toMatch(/context only/i);
  });

  it('excludes neighbor-sale from recommended/runner-up strategies', () => {
    const d = buildPursuitDecision({
      parcelVerified: true,
      valuation: soldValuation,
      compState: { soldCount: 1, anyRetrieved: true, strategyLine: '' },
      strategyRanking: [
        { strategy: 'Sell to neighbor', viability: 'viable', reason: 'adjacent owner' },
        { strategy: 'Quick flip', viability: 'maybe', reason: 'band support' },
      ],
      pricingAllowed: true,
    });
    expect(d.recommended?.strategy).toBe('Quick flip');
    expect(d.runnerUps.every((r) => !/neighbor/i.test(r.strategy))).toBe(true);
  });

  it('one sold comp NEVER produces an attractive band, winner, or runner-up (pricing gate closed)', () => {
    const d = buildPursuitDecision({
      parcelVerified: true,
      valuation: { primary: { value: 151_095, ppa: 20_146, label: 'Sold land comps (1)', kind: 'comp_sold' }, confidence: 'low', conflict: false, conflictNote: null },
      compState: { soldCount: 1, anyRetrieved: true, strategyLine: '' },
      strategyRanking: [{ strategy: 'Cash Flip', viability: 'not_viable', reason: 'blocked' }],
      strongestStrategy: { strategy: 'Cash Flip', why: 'blocked' },
      pricingAllowed: false,
      pricingBlockers: ['Only 1 validated unique sold comp — one observation is not a market; at least 3 are needed.'],
    });
    expect(d.answer).toBe('insufficient_data');
    expect(d.attractiveAcquisition).toBeNull();
    expect(d.recommended).toBeNull();
    expect(d.runnerUps).toHaveLength(0);
    expect(d.answerLine).not.toMatch(/\$\d/);
    expect(d.answerLine).toMatch(/one observation is not a market/i);
    expect(d.answerLine).not.toMatch(/pursue with caution/i);
  });

  it('pricing gate defaults CLOSED when the caller does not pass it', () => {
    const d = buildPursuitDecision({ parcelVerified: true, valuation: soldValuation, compState: { soldCount: 4, anyRetrieved: true, strategyLine: '' } });
    expect(d.attractiveAcquisition).toBeNull();
    expect(d.answer).toBe('insufficient_data');
  });

  it('never uses the old "Can I buy this property?" framing', () => {
    const d = buildPursuitDecision({ parcelVerified: true, valuation: soldValuation, compState: { soldCount: 2, anyRetrieved: true, strategyLine: '' }, pricingAllowed: true });
    expect(JSON.stringify(d)).not.toMatch(/can i buy/i);
  });
});
