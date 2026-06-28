import { describe, it, expect } from 'vitest';
import { computeDealCardReadiness } from './deal-card-readiness.js';
import type { DealCardReportView } from './deal-card-report.js';
import { buildDdChecklist, summarizeDdCompleteness } from './dd-checklist.js';
import { buildVisualPropertyContext } from './providers/google-visual.js';

function fakeReport(over: Partial<DealCardReportView> = {}): DealCardReportView {
  const checklist = over.ddFactChecklist ?? buildDdChecklist({}, null);
  return {
    exists: true,
    dealCardId: 1,
    reportStatus: 'complete_with_gaps',
    parcelVerificationStatus: 'Not parcel verified',
    parcelVerified: false,
    ddSummary: '', marketSummary: '', strategySummary: '', mostViableStrategy: '',
    offerReadiness: 'blocked',
    sourceTable: [{ source: 'X', kind: 'parcel_exact', status: 'attempted_not_verified', detail: '', compCreditUsed: false }],
    dataGaps: [], riskFlags: [], countyVerificationChecklist: [], marketFollowUpChecklist: [],
    strategyBlockers: [], nextConfirmations: [], preCallStrategyNotes: '',
    ddFactChecklist: checklist,
    ddCompleteness: summarizeDdCompleteness(checklist),
    visualContext: buildVisualPropertyContext({}, { configured: false }),
    govDd: { flood: { status: 'not_run', zone: null, note: 'x', source: null, timestamp: null } },
    creditUsage: { landportalNonCreditUsed: false, compCreditUsed: false, note: '' },
    generatedAt: 1000,
    updatedBy: 't',
    ...over,
  };
}

describe('computeDealCardReadiness', () => {
  it('not-run report -> discovery state not_generated', () => {
    const r = computeDealCardReadiness(fakeReport({ exists: false, reportStatus: 'not_run' }));
    expect(r.discoveryReportState).toBe('not_generated');
  });

  it('failed/blocked report -> needs_rerun', () => {
    expect(computeDealCardReadiness(fakeReport({ reportStatus: 'failed' })).discoveryReportState).toBe('needs_rerun');
    expect(computeDealCardReadiness(fakeReport({ reportStatus: 'blocked' })).discoveryReportState).toBe('needs_rerun');
  });

  it('deal changed after the report -> stale', () => {
    const r = computeDealCardReadiness(fakeReport({ generatedAt: 1000 }), { dealUpdatedAt: 2000 });
    expect(r.discoveryReportState).toBe('stale');
  });

  it('unverified parcel -> next action is verify parcel; missing facts listed', () => {
    const r = computeDealCardReadiness(fakeReport({ parcelVerified: false }));
    expect(r.nextBestAction.action).toBe('needs_parcel_verification');
    expect(r.topMissingDdFacts.length).toBeGreaterThan(0);
    expect(r.providerProvenance.parcelVerified).toBe(false);
  });

  it('verified with DD facts + market gap -> next action is market/comps', () => {
    const checklist = buildDdChecklist({ acres: 8.6, zoning: 'A-1' }, 'Realie.ai');
    const r = computeDealCardReadiness(fakeReport({
      parcelVerified: true,
      ddFactChecklist: checklist,
      ddCompleteness: summarizeDdCompleteness(checklist),
      marketSummary: 'Target area not yet defined (need city/county + state).',
    }));
    expect(r.nextBestAction.action).toBe('needs_market_comps');
    expect(r.ddCompleteness.verified).toBe(2);
  });

  it('verified, market ok, no visuals -> next action is visual capture', () => {
    const checklist = buildDdChecklist({ acres: 8.6 }, 'Realie.ai');
    const r = computeDealCardReadiness(fakeReport({
      parcelVerified: true,
      ddFactChecklist: checklist,
      ddCompleteness: summarizeDdCompleteness(checklist),
      marketSummary: 'Target area: Worth County, GA.',
      dataGaps: [],
    }));
    expect(r.nextBestAction.action).toBe('needs_visual_capture');
    expect(r.visualsCaptured).toBe(0);
  });

  it('workflow stage: pre_discovery until verified + discovery captured', () => {
    // unverified -> pre_discovery
    expect(computeDealCardReadiness(fakeReport({ parcelVerified: false })).workflowStage).toBe('pre_discovery_ready');
    // verified but no seller facts -> still pre_discovery (call not done)
    const checklist = buildDdChecklist({ acres: 8.6 }, 'Realie.ai');
    const verified = fakeReport({ parcelVerified: true, ddFactChecklist: checklist, ddCompleteness: summarizeDdCompleteness(checklist), countyVerificationChecklist: [] });
    expect(computeDealCardReadiness(verified).workflowStage).toBe('pre_discovery_ready');
  });

  it('workflow stage: discovery captured -> county_verification_needed / needs_deeper_dd / underwriting_ready', () => {
    const sellerCaptured = { count: 1, kinds: ['access' as const], riskFlags: ['Seller-stated access — confirm.'], discoveryCaptured: true };
    // county checklist outstanding -> county_verification_needed
    const withCounty = fakeReport({ parcelVerified: true, countyVerificationChecklist: ['Confirm zoning'] });
    expect(computeDealCardReadiness(withCounty, { sellerFacts: sellerCaptured }).workflowStage).toBe('county_verification_needed');
    // county done but DD facts still missing -> needs_deeper_dd
    const missing = fakeReport({ parcelVerified: true, countyVerificationChecklist: [] }); // empty checklist has gaps (no facts)
    expect(computeDealCardReadiness(missing, { sellerFacts: sellerCaptured, hasCountyVerification: true }).workflowStage).toBe('needs_deeper_dd');
    // all facts present + county done -> underwriting_ready; seller risk merged into top risks
    const full = buildDdChecklist({ acres: 8.6, zoning: 'A-1', landUse: 'x', roadFrontageFt: 100, landLocked: 'false', nearWater: 'no', wetlandsPct: 0, femaPct: 0, slopeAvgDeg: 2, buildabilityPct: 90, buildableAcres: 8, buildingAreaSqft: 0 }, 'Realie.ai');
    const ready = fakeReport({ parcelVerified: true, ddFactChecklist: full, ddCompleteness: summarizeDdCompleteness(full), countyVerificationChecklist: [] });
    const rr = computeDealCardReadiness(ready, { sellerFacts: sellerCaptured, hasCountyVerification: true });
    expect(rr.workflowStage).toBe('underwriting_ready');
    expect(rr.sellerFactCount).toBe(1);
    expect(rr.topRiskFlags.some((f) => /Seller-stated/i.test(f))).toBe(true);
  });

  it('everything satisfied -> ready_for_discovery_call', () => {
    const checklist = buildDdChecklist({ acres: 8.6 }, 'Realie.ai');
    const visualContext = buildVisualPropertyContext({ address: '1 Main', state: 'GA' }, { configured: true, captured: { maps_static: { storedPath: '/x.png', url: '/api/landos/visual/image?cardId=1&service=maps_static' } } });
    const r = computeDealCardReadiness(fakeReport({
      parcelVerified: true,
      ddFactChecklist: checklist,
      ddCompleteness: summarizeDdCompleteness(checklist),
      marketSummary: 'Target area: Worth County, GA.',
      dataGaps: [],
      countyVerificationChecklist: [],
      visualContext,
    }));
    expect(r.nextBestAction.action).toBe('ready_for_discovery_call');
    expect(r.visualsCaptured).toBe(1);
  });
});
