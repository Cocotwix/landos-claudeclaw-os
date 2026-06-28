import { describe, it, expect } from 'vitest';
import { buildUnderwritingPrep } from './underwriting-prep.js';
import type { DealCardReportView } from './deal-card-report.js';
import { buildDdChecklist, summarizeDdCompleteness } from './dd-checklist.js';
import { buildVisualPropertyContext } from './providers/google-visual.js';
import { summarizeSellerFacts } from './seller-stated-facts.js';

function report(over: Partial<DealCardReportView> = {}): DealCardReportView {
  const checklist = buildDdChecklist({}, null);
  return {
    exists: true, dealCardId: 1, reportStatus: 'complete_with_gaps',
    parcelVerificationStatus: '', parcelVerified: false,
    ddSummary: '', marketSummary: '', strategySummary: '', mostViableStrategy: 'Quick flip',
    offerReadiness: 'needs_confirmation', sourceTable: [], dataGaps: [], riskFlags: [],
    countyVerificationChecklist: [], marketFollowUpChecklist: [], strategyBlockers: [], nextConfirmations: [],
    preCallStrategyNotes: '', ddFactChecklist: checklist, ddCompleteness: summarizeDdCompleteness(checklist),
    visualContext: buildVisualPropertyContext({}, { configured: false }),
    govDd: { flood: { status: 'not_run', zone: null, note: 'x', source: null, timestamp: null }, wetlands: { status: 'not_run', type: null, note: 'x', source: null, timestamp: null }, slope: { status: 'not_run', slopeDeg: null, note: 'x', source: null, timestamp: null } },
    marketComps: { status: 'not_run', soldCount: 0, activeCount: 0, sold: [], active: [], metrics: { soldAvgPrice: null, soldAvgPpa: null, soldMedianPpa: null, activeAvgPrice: null, domMedian: null }, providers: [], source: 'Apify Redfin', timestamp: null, note: 'x' },
    creditUsage: { landportalNonCreditUsed: false, compCreditUsed: false, note: '' },
    generatedAt: 1, updatedBy: 't', ...over,
  };
}
const noSeller = summarizeSellerFacts([]);

describe('post-discovery underwriting prep (placeholders + gates, no offer)', () => {
  it('blocked when parcel not verified', () => {
    const p = buildUnderwritingPrep(report({ parcelVerified: false }), noSeller);
    expect(p.state).toBe('blocked');
  });

  it('needs_comps when verified but valuation not ready', () => {
    const p = buildUnderwritingPrep(report({ parcelVerified: true, strategySummary: 'valuation not ready, no offer computed' }), noSeller);
    expect(p.state).toBe('needs_comps');
  });

  it('needs_verification when comps ok but county items outstanding', () => {
    const p = buildUnderwritingPrep(report({ parcelVerified: true, strategySummary: 'comps in hand', offerReadiness: 'needs_confirmation', countyVerificationChecklist: ['Confirm zoning with county'] }), noSeller);
    expect(p.state).toBe('needs_verification');
    expect(p.verificationRequiredBeforeOffer.length).toBeGreaterThan(0);
  });

  it('ready_for_offer_prep when verified, comps ok, nothing outstanding', () => {
    const p = buildUnderwritingPrep(report({ parcelVerified: true, strategySummary: 'comps in hand', offerReadiness: 'needs_confirmation', countyVerificationChecklist: [] }), noSeller);
    expect(p.state).toBe('ready_for_offer_prep');
  });

  it('always exposes cost placeholders + minimum profit rules (never amounts/offers)', () => {
    const p = buildUnderwritingPrep(report({ parcelVerified: true }), noSeller);
    expect(p.costPlaceholders.hard.length).toBeGreaterThan(0);
    expect(p.costPlaceholders.soft.length).toBeGreaterThan(0);
    expect(p.minimumProfitRules.join(' ')).toMatch(/minimum net profit/i);
    expect(p.tighterCompRequirement).toMatch(/sold comps/i);
  });
});
