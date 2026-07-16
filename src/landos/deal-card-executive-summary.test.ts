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
  it('ranks only the five approved LandOS strategies with reasons', () => {
    const es = buildExecutiveSummary(verifiedReport());
    expect(es.strategyRanking.length).toBe(5);
    const names = es.strategyRanking.map((s) => s.strategy);
    // The approved primary set excludes Hold, Pass, wholesale, and assignment language.
    expect(names).toEqual(expect.arrayContaining(['Quick Flip', 'Novation or Double Close', 'Subdivide or Minor Split', 'Land Home Package', 'Improvement Then Flip']));
    expect(names.some((n) => /neighbor/i.test(n))).toBe(false);
    expect(es.strategyRanking.every((s) => s.reason && s.risk && s.mustVerify)).toBe(true);
    expect(es.strongestStrategy.strategy).toBe(es.strategyRanking[0].strategy);
  });
  it('uses the report most-viable strategy as the shared primary before score-ranked runner-ups', () => {
    const es = buildExecutiveSummary(verifiedReport({
      marketComps: {
        ...verifiedReport().marketComps,
        soldCount: 0,
        active: [],
        metrics: { soldMedianPpa: null, ppaMin: null, ppaMax: null, soldAvgPrice: null, soldAvgPpa: null, activeAvgPrice: null, domMedian: null },
      } as never,
      mostViableStrategy: 'Quick flip (preliminary — confirm access/title/valuation).',
    }));
    expect(es.strongestStrategy.strategy).toBe('No acquisition strategy is ready');
    expect(es.strategyRanking.every((strategy) => strategy.viability === 'not_viable')).toBe(true);
    expect(es.preliminaryAcquisitionRange.note).toMatch(/insufficient for a reliable value or offer range/i);
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
    // No sold-comp band at all (verified or not) -> no economics, never fabricated.
    const noComps = { ...verifiedReport().marketComps, soldCount: 0, sold: [], metrics: { soldMedianPpa: null, ppaMin: null, ppaMax: null, soldAvgPrice: null, soldAvgPpa: null, activeAvgPrice: null, domMedian: null } } as never;
    const de = buildExecutiveSummary(verifiedReport({ parcelVerified: false, marketComps: noComps })).dealEconomics;
    expect(de.available).toBe(false);
  });

  it('computes a WEAKER local-area range when NOT verified but comps + acreage exist', () => {
    // Pre-discovery-call mandate: unverified leads still get an area $/acre-based
    // range, computed from real comps but capped to low confidence and labeled
    // "local area context, not parcel verified". Never withheld just for being unverified.
    const es = buildExecutiveSummary(verifiedReport({ parcelVerified: false }));
    const r = es.preliminaryAcquisitionRange;
    expect(r.available).toBe(true);
    expect(r.acquisition40).toBe(20000);
    expect(r.confidence).toBe('low');
    expect(r.note.toLowerCase()).toMatch(/not verified|local.area/);
  });
  it('withholds the range when verified but no sold comps (estimate only on evidence)', () => {
    const es = buildExecutiveSummary(verifiedReport({ marketComps: { ...verifiedReport().marketComps, soldCount: 0, metrics: { soldMedianPpa: null, ppaMin: null, ppaMax: null, soldAvgPrice: null, soldAvgPpa: null, activeAvgPrice: null, domMedian: null } } as never }));
    expect(es.preliminaryAcquisitionRange.available).toBe(false);
    expect(es.marketPulse.confidence).toBe('none');
  });
});

describe('Market Pulse completion (absorption, direction, verdict)', () => {
  // Build dated land sold comps: older half cheaper, recent half pricier -> strengthening.
  function withDatedComps(older: number[], recent: number[], active = 10, domMedian = 60): DealCardReportView {
    const mk = (ppa: number, iso: string) => ({ price: ppa * 5, saleDateIso: iso, acres: 5, pricePerAcre: ppa, sourceUrl: 'https://x', sourceLabel: 'homeharvest', compClass: 'vacant_land' });
    const sold = [
      ...older.map((p, i) => mk(p, `2025-0${(i % 8) + 1}-15`)),
      ...recent.map((p, i) => mk(p, `2026-0${(i % 6) + 1}-15`)),
    ];
    const ppas = sold.map((s) => s.pricePerAcre).sort((a, b) => a - b);
    const med = ppas[Math.floor(ppas.length / 2)];
    return verifiedReport({
      marketComps: { status: 'collected', primaryProvider: 'realie', providerChain: [], soldCount: sold.length, activeCount: active, sold, active: new Array(active).fill({}), supplementalSold: [], valuation: [], metrics: { soldAvgPrice: med * 5, soldAvgPpa: med, soldMedianPpa: med, ppaMin: ppas[0], ppaMax: ppas[ppas.length - 1], activeAvgPrice: null, domMedian }, sparseExplanation: null, providers: [], source: 'multi', timestamp: 't', note: '' } as never,
    });
  }

  it('computes months-of-inventory and sell-through', () => {
    const p = buildExecutiveSummary(withDatedComps([5000, 5200, 5400], [5600, 5800, 6000], 12)).marketPulse;
    expect(p.soldCount).toBe(6);
    expect(p.activeCount).toBe(12);
    // monthly rate = 6/12 = 0.5; months of inventory = 12 / 0.5 = 24
    expect(p.monthsOfInventory).toBe(24);
    expect(p.sellThroughPct).toBe(33); // 6 / 18
    expect(p.absorption).toMatch(/months of inventory/i);
  });

  it('detects a STRENGTHENING market when recent per-acre prices rise', () => {
    const p = buildExecutiveSummary(withDatedComps([4000, 4200, 4400], [6000, 6200, 6400], 4, 45)).marketPulse;
    expect(p.direction).toBe('strengthening');
    expect(p.directionPct).toBeGreaterThan(8);
    expect(p.verdict).toMatch(/STRENGTHENING/);
    expect(p.verdict).toMatch(/Why:/);
  });

  it('detects a SOFTENING market when recent per-acre prices fall', () => {
    const p = buildExecutiveSummary(withDatedComps([8000, 8200, 8400], [5000, 5200, 5400], 30, 200)).marketPulse;
    expect(p.direction).toBe('softening');
    expect(p.directionPct).toBeLessThan(-8);
    expect(p.verdict).toMatch(/SOFTENING/);
  });

  it('reports unknown direction with too few dated comps (never guesses)', () => {
    const p = buildExecutiveSummary(withDatedComps([5000], [5200], 5)).marketPulse;
    expect(p.direction).toBe('unknown');
    expect(p.directionPct).toBeNull();
  });

  it('the verdict always answers stronger-or-weaker-and-why', () => {
    const p = buildExecutiveSummary(verifiedReport()).marketPulse;
    expect(p.verdict.length).toBeGreaterThan(0);
  });
});
