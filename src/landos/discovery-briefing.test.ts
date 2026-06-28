import { describe, it, expect } from 'vitest';
import { buildDiscoveryBriefing, renderDiscoveryBriefingMarkdown } from './discovery-briefing.js';
import { computeDealCardReadiness } from './deal-card-readiness.js';
import type { DealCardReportView } from './deal-card-report.js';
import { buildDdChecklist, summarizeDdCompleteness } from './dd-checklist.js';
import { buildVisualPropertyContext } from './providers/google-visual.js';
import { summarizeSellerFacts, type SellerStatedFact } from './seller-stated-facts.js';

function report(over: Partial<DealCardReportView> = {}): DealCardReportView {
  const checklist = over.ddFactChecklist ?? buildDdChecklist({}, null);
  return {
    exists: true, dealCardId: 1, reportStatus: 'complete_with_gaps',
    parcelVerificationStatus: 'Parcel verified (Realie.ai, non-credit)', parcelVerified: true,
    ddSummary: '', marketSummary: '', strategySummary: '', mostViableStrategy: 'Quick flip',
    offerReadiness: 'needs_confirmation', sourceTable: [], dataGaps: [], riskFlags: [],
    countyVerificationChecklist: ['Confirm zoning with county'], marketFollowUpChecklist: [], strategyBlockers: [], nextConfirmations: [],
    preCallStrategyNotes: '', ddFactChecklist: checklist, ddCompleteness: summarizeDdCompleteness(checklist),
    visualContext: buildVisualPropertyContext({}, { configured: false }),
    govDd: { flood: { status: 'not_run', zone: null, note: 'x', source: null, timestamp: null } },
    marketComps: { status: 'not_run', soldCount: 0, activeCount: 0, sold: [], active: [], metrics: { soldAvgPrice: null, soldAvgPpa: null, soldMedianPpa: null, activeAvgPrice: null, domMedian: null }, providers: [], source: 'Apify Redfin', timestamp: null, note: 'x' },
    creditUsage: { landportalNonCreditUsed: false, compCreditUsed: false, note: '' },
    generatedAt: 1, updatedBy: 't', ...over,
  };
}

describe('discovery briefing (operator-grade, never fabricated)', () => {
  it('separates known facts, unknowns, and adapts questions to captured seller facts', () => {
    const checklist = buildDdChecklist({ acres: 8.6, zoning: 'A-1' }, 'Realie.ai');
    const r = report({ ddFactChecklist: checklist, ddCompleteness: summarizeDdCompleteness(checklist) });
    const facts: SellerStatedFact[] = [{ kind: 'timeline', value: 'ASAP', recordedAt: 1, recordedBy: 't' }];
    const seller = summarizeSellerFacts(facts);
    const readiness = computeDealCardReadiness(r, { sellerFacts: seller });
    const b = buildDiscoveryBriefing(r, readiness, seller);

    // Known facts include the verified DD facts with source + seller-stated note.
    expect(b.knownFacts.some((f) => /Acreage: 8.6 ac \(Verified · Realie\.ai\)/.test(f))).toBe(true);
    expect(b.knownFacts.some((f) => /Seller-stated timeline/i.test(f))).toBe(true);
    // Question for an already-captured area (timeline) is NOT re-asked; price IS.
    expect(b.questionsToAsk.some((q) => /timeline/i.test(q))).toBe(false);
    expect(b.questionsToAsk.some((q) => /price/i.test(q))).toBe(true);
    // Always asks motivation.
    expect(b.questionsToAsk.some((q) => /motivation/i.test(q))).toBe(true);
    // Follow-up includes the next-best action + county item.
    expect(b.followUpPriorities[0]).toMatch(/Next best action/i);
    expect(b.followUpPriorities.some((f) => /Confirm zoning with county/i.test(f))).toBe(true);
  });

  it('unverified parcel: warns not to present a number; flags identity unknown', () => {
    const r = report({ parcelVerified: false, parcelVerificationStatus: 'Not parcel verified' });
    const readiness = computeDealCardReadiness(r, { sellerFacts: summarizeSellerFacts([]) });
    const b = buildDiscoveryBriefing(r, readiness, summarizeSellerFacts([]));
    expect(b.warnings.some((w) => /do not present any number/i.test(w))).toBe(true);
    expect(b.biggestUnknowns.some((u) => /not verified/i.test(u))).toBe(true);
  });

  it('renders polished markdown sections (no JSON)', () => {
    const r = report();
    const readiness = computeDealCardReadiness(r, { sellerFacts: summarizeSellerFacts([]) });
    const md = renderDiscoveryBriefingMarkdown(buildDiscoveryBriefing(r, readiness, summarizeSellerFacts([]))).join('\n');
    expect(md).toContain('### What we already know');
    expect(md).toContain('### Questions to ask the seller');
    expect(md).not.toMatch(/[{}]/); // no JSON braces
  });
});
