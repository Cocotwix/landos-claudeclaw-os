// Tests: Duke first-pass analysis (flags + strategy readiness, no fake offers).
import { describe, it, expect } from 'vitest';
import { buildDukeAnalysis, analyzeConfirmedParcelStrategy, blockedStrategyAnalysis } from './duke-analysis.js';
import { confirmParcel } from './parcel-identity.js';
import type { DukePropertyData } from './duke-property-data.js';

function pd(over: Partial<DukePropertyData['landFacts']> = {}, valOver: Partial<DukePropertyData['valuation']> = {}): DukePropertyData {
  return {
    sourceName: 'LandPortal',
    generatedAt: '2026-06-17T00:00:00.000Z',
    identity: { propertyId: '1', fips: '47031', apn: 'x', county: 'Coffee', state: 'TN' },
    landFacts: { acres: 12.5, roadFrontageFt: 210, landLocked: 'false', buildabilityPct: 85, wetlandsPct: 2, femaPct: 0, slopeAvgDeg: 4, ...over },
    valuation: { marketTotal: 60000, tlpEstimate: 75000, ...valOver },
    similars: { count: 3 },
    similarSales: [],
    similarRowsAvailable: false,
    dataGaps: [],
    truthLabel: 'verified_fact',
    note: 'test',
  };
}

describe('Strategy department gate (ConfirmedParcel)', () => {
  const confirmed = confirmParcel({
    dealCardId: 1, subjectCardId: 2, state: 'confirmed', basis: 'named source',
    confidence: 0.95, evidenceRefs: [], confirmedAt: 1, confirmedBy: 'acquire', updatedAt: 1,
  })!;

  it('analyzeConfirmedParcelStrategy unlocks full analysis with a token + data', () => {
    const a = analyzeConfirmedParcelStrategy(confirmed, { propertyData: pd() });
    expect(a.parcelVerified).toBe(true);
    expect(a.strategyStatus).toBe('ready_for_preliminary_review');
    expect(a.strategyCandidates.length).toBeGreaterThan(0);
  });

  it('blockedStrategyAnalysis (candidate) blocks strategy/underwriting', () => {
    const a = blockedStrategyAnalysis(['need county']);
    expect(a.strategyStatus).toBe('blocked_unverified_parcel');
    expect(a.strategyCandidates.length).toBe(0);
    expect(a.dataGaps).toContain('need county');
  });

  it('COMPILE GATE: strategy analysis cannot be unlocked without a ConfirmedParcel', () => {
    // @ts-expect-error a raw object is not a ConfirmedParcel — the brand blocks it.
    analyzeConfirmedParcelStrategy({ dealCardId: 1 }, { propertyData: pd() });
    expect(true).toBe(true);
  });
});

describe('buildDukeAnalysis', () => {
  it('blocks strategy when the parcel is unverified', () => {
    const a = buildDukeAnalysis({ parcelVerified: false });
    expect(a.strategyStatus).toBe('blocked_unverified_parcel');
    expect(a.strategyCandidates.length).toBe(0);
  });

  it('verified data with core facts is ready for preliminary review with candidates', () => {
    const a = buildDukeAnalysis({ parcelVerified: true, propertyData: pd() });
    expect(a.strategyStatus).toBe('ready_for_preliminary_review');
    expect(a.greenFlags.some((g) => /buildability/i.test(g))).toBe(true);
    expect(a.strategyCandidates.some((c) => c.strategy === 'pass_no_offer')).toBe(true);
    expect(a.strategyCandidates.some((c) => c.strategy === 'subdivide')).toBe(true);
  });

  it('raises red flags for landlocked / flood / steep slope', () => {
    const a = buildDukeAnalysis({ parcelVerified: true, propertyData: pd({ landLocked: 'true', femaPct: 40, slopeAvgDeg: 20 }) });
    expect(a.redFlags.some((r) => /landlocked/i.test(r))).toBe(true);
    expect(a.redFlags.some((r) => /fema|flood/i.test(r))).toBe(true);
    expect(a.redFlags.some((r) => /slope/i.test(r))).toBe(true);
  });

  it('offers improved-property + teardown candidates when structures exist', () => {
    const a = buildDukeAnalysis({ parcelVerified: true, propertyData: pd({ buildingAreaSqft: 1400 }) });
    expect(a.strategyCandidates.some((c) => c.strategy === 'improved_property_value_add')).toBe(true);
    expect(a.strategyCandidates.some((c) => c.strategy === 'teardown_land_only')).toBe(true);
  });

  it('never invents an offer; references the formula source and the $10k baseline', () => {
    const a = buildDukeAnalysis({ parcelVerified: true, propertyData: pd() });
    expect(a.offerReadiness.formulaSource).toBe('offer-engine');
    expect(a.offerReadiness.status).not.toBe('offer_formula_source_missing');
    expect(a.offerReadiness.minNetProfitBaselineUsd).toBe(10000);
    // No fabricated offer dollar range in the analysis output.
    expect(/offer(LowUsd|HighUsd)/.test(JSON.stringify(a))).toBe(false);
  });

  it('needs verified valuation before offer math when valuation is absent', () => {
    const a = buildDukeAnalysis({ parcelVerified: true, propertyData: pd({}, { marketTotal: undefined, tlpEstimate: undefined, assessedTotal: undefined }) });
    expect(a.offerReadiness.status).toBe('needs_verified_valuation');
  });
});
