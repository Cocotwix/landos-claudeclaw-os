import { describe, it, expect } from 'vitest';
import {
  buildDiscoveryCallReport,
  buildStrategyEvaluation,
  buildRoughOfferRange,
  type DiscoveryIntake,
} from './discovery-call-report.js';
import type { DealCardReportView } from './deal-card-report.js';
import type { ExecutiveSummary } from './deal-card-executive-summary.js';

// Minimal report/exec-summary stubs carrying only the fields the discovery
// builder reads. Cast keeps the tests focused on discovery logic (the executive
// summary has its own suite).
function report(over: Partial<DealCardReportView>): DealCardReportView {
  return {
    parcelVerified: false,
    parcelVerificationStatus: 'Local Area Context, Not Parcel Verified',
    riskFlags: [],
    govDd: {
      flood: { status: 'not_run', zone: null, note: '', source: null, timestamp: null },
      wetlands: { status: 'not_run', type: null, note: '', source: null, timestamp: null },
      slope: { status: 'not_run', slopeDeg: null, note: '', source: null, timestamp: null },
    },
    ...over,
  } as DealCardReportView;
}

function exec(over: {
  acres?: number | null; median?: number | null; p25?: number | null; p75?: number | null;
  available?: boolean; estMid?: number | null; recRange?: [number, number] | null;
  soldCount?: number; activeCount?: number; domMedian?: number | null; confidence?: any;
}): ExecutiveSummary {
  const median = over.median ?? null;
  return {
    headline: 'x', whatItIs: 'x', whyInteresting: 'x',
    marketPulse: {
      pricePerAcre: { p25: over.p25 ?? null, median, p75: over.p75 ?? null, low: over.p25 ?? null, high: over.p75 ?? null },
      soldCount: over.soldCount ?? 0, activeCount: over.activeCount ?? 0, domMedian: over.domMedian ?? null,
    } as any,
    preliminaryAcquisitionRange: {
      available: over.available ?? false, acres: over.acres ?? null,
      estConservativeValue: over.p25 != null && over.acres ? over.p25 * over.acres : null,
      estMarketRange: over.p25 != null && over.p75 != null && over.acres ? [over.p25 * over.acres, over.p75 * over.acres] : null,
      estMidValue: over.estMid ?? null,
      acquisition40: over.recRange?.[0] ?? null, acquisition60: over.recRange?.[1] ?? null,
      recommendedRange: over.recRange ?? null,
      confidence: over.confidence ?? 'none', assumptions: [], increaseValueIf: ['Access'], decreaseValueIf: ['Flood'], note: 'note',
    } as any,
    strategyRanking: [], strongestStrategy: { strategy: 'x', why: 'x' },
    dealEconomics: {} as any, topRisks: [], sellerQuestions: [], verifyBeforeOffer: [], nextSteps: [], confidence: 'low',
  } as ExecutiveSummary;
}

const intake: DiscoveryIntake = {
  rawInput: '2510 State Highway 153, Winters, TX 79467',
  address: '2510 State Highway 153', city: 'Winters', county: 'Runnels', state: 'TX', zip: '79467', acres: null,
  resolverPathReason: 'Full street address + city/state/ZIP exact lookup.',
};

describe('discovery-call-report — five strategies', () => {
  it('always returns EXACTLY the five approved strategies in order', () => {
    const strategies = buildStrategyEvaluation(report({}), exec({ median: 3500, soldCount: 4 }));
    expect(strategies.map((s) => s.strategy)).toEqual([
      'Quick Flip', 'Novation / Double Close', 'Subdivide', 'Land-Home Package', 'Improvement Then Flip',
    ]);
    for (const s of strategies) {
      expect(['viable', 'maybe', 'not viable']).toContain(s.verdict);
      expect(s.reason.length).toBeGreaterThan(0);
      expect(s.pricingLogic.length).toBeGreaterThan(0);
      expect(s.mainRisk.length).toBeGreaterThan(0);
    }
  });

  it('unknown acreage makes Subdivide a "maybe (needs acreage)", never "not viable"', () => {
    const strategies = buildStrategyEvaluation(report({}), exec({ acres: null, median: 3500, soldCount: 4 }));
    const sub = strategies.find((s) => s.strategy === 'Subdivide')!;
    expect(sub.verdict).toBe('maybe');
    expect(sub.reason.toLowerCase()).toContain('acreage');
  });

  it('small known acreage makes Subdivide not viable', () => {
    const strategies = buildStrategyEvaluation(report({}), exec({ acres: 1, median: 3500, soldCount: 4, available: true, estMid: 3500, recRange: [1400, 2100] }));
    expect(strategies.find((s) => s.strategy === 'Subdivide')!.verdict).toBe('not viable');
  });

  it('wetlands type "None mapped" is NOT a constraint (Improvement Then Flip stays maybe)', () => {
    const r = report({ govDd: {
      flood: { status: 'needs_verification', zone: null, note: '', source: null, timestamp: null },
      wetlands: { status: 'verified', type: 'None mapped', note: '', source: 'x', timestamp: 't' },
      slope: { status: 'verified', slopeDeg: 5.5, note: '', source: 'x', timestamp: 't' },
    } as any });
    const strategies = buildStrategyEvaluation(r, exec({ median: 3500, soldCount: 4 }));
    expect(strategies.find((s) => s.strategy === 'Improvement Then Flip')!.verdict).toBe('maybe');
  });

  it('flood/wetlands push Improvement Then Flip to not viable', () => {
    const r = report({ govDd: {
      flood: { status: 'verified', zone: 'AE', note: '', source: 'x', timestamp: 't' },
      wetlands: { status: 'not_run', type: null, note: '', source: null, timestamp: null },
      slope: { status: 'not_run', slopeDeg: null, note: '', source: null, timestamp: null },
    } as any });
    const strategies = buildStrategyEvaluation(r, exec({ median: 3500, soldCount: 4 }));
    expect(strategies.find((s) => s.strategy === 'Improvement Then Flip')!.verdict).toBe('not viable');
  });
});

describe('discovery-call-report — rough offer range', () => {
  it('per-acre band when a $/acre comp band exists but acreage is unknown', () => {
    const range = buildRoughOfferRange(report({}), exec({ acres: null, median: 4000, soldCount: 3 }));
    expect(range.available).toBe(true);
    expect(range.basis).toBe('area');
    expect(range.marketValue).toBeNull();
    expect(range.perAcreAcquisition).toEqual({ low: 1600, high: 2400 }); // 40-60% of 4000
    expect(range.confidence).toBe('low');
  });

  it('full total value + 40-60% band when acreage + comps exist (verified)', () => {
    const r = report({ parcelVerified: true, parcelVerificationStatus: 'Parcel verified' });
    const range = buildRoughOfferRange(r, exec({ acres: 10, median: 5000, p25: 4000, p75: 6000, available: true, estMid: 50000, recRange: [20000, 30000], confidence: 'medium' }));
    expect(range.available).toBe(true);
    expect(range.basis).toBe('parcel');
    expect(range.marketValue?.mid).toBe(50000);
    expect(range.acquisition).toEqual({ low: 20000, high: 30000 });
  });

  it('falls back to ACTIVE-listing asking $/acre when no sold band exists (weaker context)', () => {
    const r = report({ marketComps: { active: [
      { price: 20000, saleDateIso: '', acres: 5, pricePerAcre: 4000, sourceUrl: '', sourceLabel: 'homeharvest' },
      { price: 30000, saleDateIso: '', acres: 5, pricePerAcre: 6000, sourceUrl: '', sourceLabel: 'homeharvest' },
      { price: 25000, saleDateIso: '', acres: 5, pricePerAcre: 5000, sourceUrl: '', sourceLabel: 'homeharvest' },
    ], sold: [], supplementalSold: [], metrics: {} } as any });
    const range = buildRoughOfferRange(r, exec({ acres: null, median: null }));
    expect(range.available).toBe(true);
    expect(range.basis).toBe('area');
    expect(range.pricePerAcre.mid).toBe(5000); // median asking
    expect(range.perAcreAcquisition).toEqual({ low: 2000, high: 3000 }); // 40-60% of asking
    expect(range.note.toLowerCase()).toContain('asking');
  });

  it('uses comparable-intelligence asking fallback when marketComps sold data is unavailable', () => {
    const r = report({
      parcelVerified: true,
      parcelVerificationStatus: 'Parcel verified',
      ddFactChecklist: [{ key: 'acres', label: 'Acres', value: '0.25 ac', status: 'verified', source: 'LandPortal' }] as any,
      landportalInspection: {
        parcelUrl: 'x',
        comparablesUrl: 'x',
        parcelFacts: { Acres: '0.25', 'Land Use': 'Vacant land' },
        assets: [],
        overlays: [],
        visualObservations: [{ label: 'Vacant land', detail: 'No structures observed.', confidence: 'medium', evidence: 'Satellite' }],
        comparables: [
          { rawText: '$18,000 Acres: 0.25 | APN: A', sourceUrl: 'x', acres: 0.25, price: 18000, pricePerAcre: 72000, status: 'listed', improvement: 'vacant', confidence: 'medium' },
          { rawText: '$16,500 Acres: 0.25 | APN: B', sourceUrl: 'x', acres: 0.25, price: 16500, pricePerAcre: 66000, status: 'listed', improvement: 'vacant', confidence: 'medium' },
        ],
        sources: [],
        evidence: [],
        discoveryQuestions: [],
        missingInformation: [],
      } as any,
      marketComps: { active: [], sold: [], supplementalSold: [], metrics: {} } as any,
    });
    const ci = buildDiscoveryCallReport(r, exec({ acres: 0.25, median: null, available: false, estMid: null, recRange: null }), intake);
    expect(ci.roughOfferRange.available).toBe(true);
    expect(ci.roughOfferRange.pricePerAcre.mid).toBe(69000);
    expect(ci.roughOfferRange.marketValue?.mid).toBe(17250);
    expect(ci.headline).toMatch(/asking-market/i);
  });

  it('insufficient when no comp band at all', () => {
    const range = buildRoughOfferRange(report({}), exec({ acres: null, median: null }));
    expect(range.available).toBe(false);
    expect(range.basis).toBe('insufficient');
  });
});

describe('discovery-call-report — full assembly', () => {
  it('labels an unverified lead as Local Area Context and surfaces smart input', () => {
    const dcr = buildDiscoveryCallReport(report({}), exec({ median: 3500, soldCount: 4 }), intake);
    expect(dcr.parcelVerified).toBe(false);
    expect(dcr.contextLabel).toBe('Local Area Context, Not Parcel Verified');
    expect(dcr.smartInput.resolvedFields.find((f) => f.label === 'City')?.value).toBe('Winters');
    expect(dcr.smartInput.resolvedFields.find((f) => f.label === 'County')?.value).toBe('Runnels County');
    expect(dcr.strategyEvaluation).toHaveLength(5);
    expect(dcr.disclaimer.toLowerCase()).toContain('pre-discovery');
  });
});
