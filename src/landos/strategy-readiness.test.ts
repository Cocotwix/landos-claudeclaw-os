import { describe, expect, it } from 'vitest';
import { APPROVED_STRATEGIES, buildStrategyReadiness, type StrategyReadinessInputs } from './strategy-readiness.js';

function inputs(over: Partial<StrategyReadinessInputs>): StrategyReadinessInputs {
  return {
    parcelVerified: true,
    validatedSoldComps: 1,
    valuationReady: false,
    valuationConflict: false,
    acres: 3.51,
    acreageConflict: true,
    wetlandsPct: 28.5,
    floodSfhaPct: 59.1,
    septicOutlook: 'poor',
    accessStatus: 'public_road_proximity',
    legalAccessConfirmed: false,
    zoningKnown: true,
    utilitiesKnown: false,
    improved: false,
    hardRisks: [],
    ...over,
  };
}

describe('strategy readiness — five approved strategies only', () => {
  it('always returns exactly the five approved strategies', () => {
    const r = buildStrategyReadiness(inputs({}));
    expect(r.strategies.map((s) => s.strategy)).toEqual([...APPROVED_STRATEGIES]);
    expect(r.strategies.map((s) => s.strategy)).not.toContain('Pass');
    expect(r.strategies.map((s) => s.strategy)).not.toContain('Hold');
  });

  it('blocks everything when the parcel is unverified', () => {
    const r = buildStrategyReadiness(inputs({ parcelVerified: false }));
    expect(r.strategies.every((s) => s.status === 'blocked')).toBe(true);
    expect(r.pricingAllowed).toBe(false);
    expect(r.decision).toBe('continue_research');
  });
});

describe('strategy readiness — pricing gate', () => {
  it('one usable sold comp opens the owner FMV formula when parcel and acreage are stable', () => {
    const r = buildStrategyReadiness(inputs({ validatedSoldComps: 1, valuationReady: true, acreageConflict: false }));
    expect(r.pricingAllowed).toBe(true);
    expect(r.pricingBlockers).toHaveLength(0);
  });

  it('acreage conflict blocks pricing even with a comp band', () => {
    const r = buildStrategyReadiness(inputs({ validatedSoldComps: 4, valuationReady: true, acreageConflict: true }));
    expect(r.pricingAllowed).toBe(false);
    expect(r.pricingBlockers.join(' ')).toMatch(/acreage is conflicted/i);
  });

  it('allows pricing with a validated multi-comp basis, resolved acreage, no conflict', () => {
    const r = buildStrategyReadiness(inputs({ validatedSoldComps: 4, valuationReady: true, acreageConflict: false }));
    expect(r.pricingAllowed).toBe(true);
    expect(r.pricingBlockers).toHaveLength(0);
    expect(r.decision).toBe('tyler_review');
  });

  it('asking or automated-value disagreement never blocks sold-comp pricing', () => {
    const r = buildStrategyReadiness(inputs({ validatedSoldComps: 4, valuationReady: true, acreageConflict: false, valuationConflict: true }));
    expect(r.pricingAllowed).toBe(true);
  });
});

describe('strategy readiness — property-specific blockers', () => {
  it('subdivide is blocked by unresolved acreage and poor septic, with required evidence listed', () => {
    const r = buildStrategyReadiness(inputs({}));
    const sub = r.strategies.find((s) => s.strategy === 'Subdivide or Minor Split')!;
    expect(sub.status).toBe('blocked');
    expect(sub.blockers.join(' ')).toMatch(/acreage unresolved/i);
    expect(sub.blockers.join(' ')).toMatch(/septic/i);
    expect(sub.requiredEvidence.join(' ')).toMatch(/survey\/plat/i);
  });

  it('land home package is blocked by poor septic + majority SFHA', () => {
    const r = buildStrategyReadiness(inputs({}));
    const lhp = r.strategies.find((s) => s.strategy === 'Land-Home Package')!;
    expect(lhp.status).toBe('blocked');
    expect(lhp.blockers.join(' ')).toMatch(/septic outlook poor/i);
    expect(lhp.blockers.join(' ')).toMatch(/flood hazard area/i);
  });

  it('hard risk routes the decision to Tyler review', () => {
    const r = buildStrategyReadiness(inputs({ hardRisks: ['Parcel appears landlocked — no legal access'] }));
    expect(r.decision).toBe('tyler_review');
    expect(r.decisionWhy).toMatch(/landlocked/i);
  });

  it('quick flip becomes weak (not viable-promoted) under heavy wetlands even when priced', () => {
    const r = buildStrategyReadiness(inputs({ validatedSoldComps: 4, valuationReady: true, acreageConflict: false, wetlandsPct: 40 }));
    const qf = r.strategies.find((s) => s.strategy === 'Cash Flip')!;
    expect(qf.status).toBe('weak');
  });
});
