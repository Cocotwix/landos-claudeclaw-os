import { describe, it, expect } from 'vitest';
import { buildExecutiveSummary } from './deal-card-executive-summary.js';
import type { DealCardReportView } from './deal-card-report.js';

// Minimal verified-report fixture with a real Realie comp band + verified facts.
function verifiedReport(over: Partial<DealCardReportView> = {}): DealCardReportView {
  return {
    exists: true, dealCardId: 1, reportStatus: 'complete', parcelVerificationStatus: 'Parcel verified (Realie.ai, non-credit)',
    parcelVerified: true, ddSummary: 'Parcel verified via Realie.ai.', marketSummary: 'Target area: DEKALB County, GA.',
    strategySummary: 'preliminary', mostViableStrategy: 'Quick flip (preliminary)', offerReadiness: 'needs_confirmation' as never,
    sourceTable: [], dataGaps: ['Local buyer demand not reviewed yet.'], riskFlags: [], countyVerificationChecklist: ['Confirm road access at county GIS'],
    marketFollowUpChecklist: [], strategyBlockers: [], nextConfirmations: [], preCallStrategyNotes: '',
    ddFactChecklist: [
      { key: 'acres', label: 'Acreage', value: '5 ac', status: 'verified', source: 'Realie', url: null, timestamp: null, confidence: 'high' },
      { key: 'landUse', label: 'Land use', value: 'Vacant Residential', status: 'verified', source: 'Realie', url: null, timestamp: null, confidence: 'high' },
      { key: 'county', label: 'County', value: 'DeKalb', status: 'verified', source: 'Realie', url: null, timestamp: null, confidence: 'high' },
    ] as never,
    ddCompleteness: { total: 15, verified: 7, needsVerification: 8, percentComplete: 47, label: '7 of 15 DD fields verified (47%)' } as never,
    visualContext: undefined as never,
    marketComps: { status: 'collected', primaryProvider: 'realie', providerChain: ['realie:collected'], soldCount: 6, activeCount: 80, sold: [], active: new Array(80).fill({}), supplementalSold: [], valuation: [], metrics: { soldAvgPrice: 50000, soldAvgPpa: 10000, soldMedianPpa: 10000, ppaMin: 8000, ppaMax: 13000, activeAvgPrice: null, domMedian: 45 }, sparseExplanation: null, providers: [{ providerId: 'realie', status: 'connected', kept: 6 }], source: 'Realie', timestamp: 't', note: '' } as never,
    govDd: { flood: { status: 'verified', zone: 'X', source: 'u', timestamp: 't' }, wetlands: { status: 'verified', type: null, source: 'u', timestamp: 't' }, slope: { status: 'verified', slopeDeg: 4, source: 'u', timestamp: 't' } } as never,
    generatedAt: 1, updatedBy: 'test',
    ...over,
  } as DealCardReportView;
}

describe('Executive Summary synthesis (operator-ready pre-call brief)', () => {
  it('computes a preliminary acquisition range (40–60%) from verified comps + acreage', () => {
    const es = buildExecutiveSummary(verifiedReport());
    const r = es.preliminaryAcquisitionRange;
    expect(r.available).toBe(true);
    expect(r.acres).toBe(5);
    expect(r.estMidValue).toBe(50000); // 10000/ac * 5 ac
    expect(r.acquisition40).toBe(20000); // 40%
    expect(r.acquisition60).toBe(30000); // 60%
    expect(r.recommendedRange).toEqual([20000, 30000]);
    expect(r.assumptions.join(' ')).toMatch(/not an approved offer|pre-call/i); // labeled, not final
    expect(r.increaseValueIf.length).toBeGreaterThan(0);
    expect(r.decreaseValueIf.length).toBeGreaterThan(0);
  });
  it('Market Pulse synthesizes counts + band + interpretation (no placeholder)', () => {
    const p = buildExecutiveSummary(verifiedReport()).marketPulse;
    expect(p.realieSoldCount).toBe(6);
    expect(p.zillowActiveCount).toBe(80);
    expect(p.pricePerAcre.median).toBe(10000);
    expect(p.confidence).toBe('high'); // >=5 sold
    expect(p.interpretation).toMatch(/per acre|\/acre/i);
  });
  it('headline + what-it-is reflect verified identity (identity != DD completeness)', () => {
    const es = buildExecutiveSummary(verifiedReport());
    expect(es.whatItIs).toMatch(/verified via Realie/i);
    expect(es.whatItIs).toMatch(/47%/); // DD incompleteness surfaced separately, not blocking
    expect(es.sellerQuestions.length).toBeGreaterThanOrEqual(4);
    expect(es.confidence).toBe('high');
  });
  it('ranks 8 property-specific strategies with reasons, and picks the top as strongest', () => {
    const es = buildExecutiveSummary(verifiedReport());
    expect(es.strategyRanking.length).toBe(8);
    expect(es.strategyRanking.every((s) => s.reason && s.risk && s.mustVerify)).toBe(true);
    // ranked by score descending
    for (let i = 1; i < es.strategyRanking.length; i++) expect(es.strategyRanking[i - 1].score).toBeGreaterThanOrEqual(es.strategyRanking[i].score);
    expect(es.strongestStrategy.strategy).toBe(es.strategyRanking[0].strategy);
    // vacant land -> improved-property resale is not viable
    expect(es.strategyRanking.find((s) => /improved-property/i.test(s.strategy))!.viability).toBe('not_viable');
  });
  it('populates preliminary Deal Economics (value low/mid/high + gross spread) when comps exist', () => {
    const de = buildExecutiveSummary(verifiedReport()).dealEconomics;
    expect(de.available).toBe(true);
    expect(de.estValueMid).toBe(50000);
    expect(de.acquisitionRange).toEqual([20000, 30000]);
    expect(de.roughSpread).toEqual([20000, 30000]); // mid(50k) - acq band(30k..20k)
    expect(de.missingCostItems.length).toBeGreaterThan(3);
    expect(de.whyUnderwritingLater).toMatch(/post-discovery|final underwriting/i);
  });
  it('Deal Economics is honestly unavailable when no comps', () => {
    const de = buildExecutiveSummary(verifiedReport({ parcelVerified: false })).dealEconomics;
    expect(de.available).toBe(false);
  });

  it('withholds the range honestly when NOT verified (no fabrication)', () => {
    const es = buildExecutiveSummary(verifiedReport({ parcelVerified: false }));
    expect(es.preliminaryAcquisitionRange.available).toBe(false);
    expect(es.headline).toMatch(/needs verification/i);
  });
  it('withholds the range when verified but no sold comps (estimate only on evidence)', () => {
    const es = buildExecutiveSummary(verifiedReport({ marketComps: { ...verifiedReport().marketComps, soldCount: 0, metrics: { soldMedianPpa: null, ppaMin: null, ppaMax: null, soldAvgPrice: null, soldAvgPpa: null, activeAvgPrice: null, domMedian: null } } as never }));
    expect(es.preliminaryAcquisitionRange.available).toBe(false);
    expect(es.marketPulse.confidence).toBe('none');
  });
});
