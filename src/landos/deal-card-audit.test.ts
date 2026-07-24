import { describe, it, expect } from 'vitest';
import { auditDealCardCoherence } from './deal-card-audit.js';

const cleanReport = {
  exists: true,
  parcelVerified: true,
  reconciliation: { acreage: { primary: '17.93 ac', conflict: false, conflictNote: null }, conflicts: [] },
  valuation: { primary: { value: 100_000, label: 'Sold land comps (4)' }, conflict: false, conflictNote: null },
  compState: { soldCount: 4, anyRetrieved: true, summaryLine: 'Comps: Sold comps 4.', strategyLine: 'Sold comps retrieved (4).' },
  marketComps: { soldCount: 4, activeCount: 2, query: { county: 'Sevier', state: 'AR' } },
  ddFactChecklist: [{ key: 'acres', value: '17.93' }],
  ddSummary: 'Parcel verified with clean facts.',
  marketSummary: 'Supportive comps.',
  strategySummary: 'Quick flip is most viable.',
  mostViableStrategy: 'Quick flip',
  visualContext: { assets: [{ status: 'captured', imageUrl: '/api/landos/visual/image?cardId=15&service=maps_static' }] },
  landportalInspection: { parcelUrl: 'https://landportal.example/parcel/15', assets: [{ url: '/api/landos/inspection/image?cardId=15&key=parcel.png', kind: 'parcel_page' }] },
};
const cleanEs = {
  strongestStrategy: { strategy: 'Quick flip' },
  strategyRanking: [{ strategy: 'Quick flip' }, { strategy: 'Subdivide' }],
};

describe('auditDealCardCoherence — the orchestrator gate', () => {
  it('passes a coherent card (all checks)', () => {
    const a = auditDealCardCoherence({ report: cleanReport, executiveSummary: cleanEs, subjectCardId: 15, subject: { county: 'Sevier', state: 'AR' } });
    expect(a.passed).toBe(true);
    expect(a.checks).toHaveLength(27);
    expect(a.summaryLine).toMatch(/27\/27 consistency checks passed/);
  });

  it('fails single_acreage when two materially different acreages render', () => {
    const a = auditDealCardCoherence({
      report: { ...cleanReport, ddFactChecklist: [{ key: 'acres', value: '17.67' }] },
      executiveSummary: cleanEs, subjectCardId: 15, subject: { state: 'AR' },
    });
    const c = a.checks.find((x) => x.id === 'single_acreage')!;
    expect(c.pass).toBe(false);
    expect(c.detail).toMatch(/two acreages/);
    expect(a.passed).toBe(false);
  });

  it('fails single_valuation when a conflict has no explanation', () => {
    const a = auditDealCardCoherence({
      report: { ...cleanReport, valuation: { primary: { value: 100_000, label: 'x' }, conflict: true, conflictNote: null } },
      executiveSummary: cleanEs, subjectCardId: 15,
    });
    expect(a.checks.find((x) => x.id === 'single_valuation')!.pass).toBe(false);
  });

  it('fails comp_consistency when Strategy claims no comps while retrieved', () => {
    const a = auditDealCardCoherence({
      report: { ...cleanReport, compState: { ...cleanReport.compState, strategyLine: 'No comps retrieved yet — run comp research.' } },
      executiveSummary: cleanEs, subjectCardId: 15,
    });
    expect(a.checks.find((x) => x.id === 'comp_consistency')!.pass).toBe(false);
  });

  it('fails imagery_association when an image belongs to another card', () => {
    const a = auditDealCardCoherence({
      report: { ...cleanReport, visualContext: { assets: [{ status: 'captured', imageUrl: '/api/landos/property-cards/9/visual?kind=satellite' }] } },
      executiveSummary: cleanEs, subjectCardId: 15,
    });
    const c = a.checks.find((x) => x.id === 'imagery_association')!;
    expect(c.pass).toBe(false);
    expect(c.detail).toMatch(/different property card/);
  });

  it('fails strategy_single_story when report and summary disagree', () => {
    const a = auditDealCardCoherence({
      report: { ...cleanReport, mostViableStrategy: 'Subdivide' },
      executiveSummary: cleanEs, subjectCardId: 15,
    });
    expect(a.checks.find((x) => x.id === 'strategy_single_story')!.pass).toBe(false);
  });

  it('fails strategy_single_story when the ranking promotes a different primary', () => {
    const a = auditDealCardCoherence({
      report: cleanReport,
      executiveSummary: {
        strongestStrategy: { strategy: 'Cash Flip' },
        strategyRanking: [{ strategy: 'Subdivide' }, { strategy: 'Cash Flip' }],
      },
      subjectCardId: 15,
    });
    const c = a.checks.find((x) => x.id === 'strategy_single_story')!;
    expect(c.pass).toBe(false);
    expect(c.detail).toMatch(/ranking promotes/);
  });


  it('accepts a safe blocked conclusion when every approved strategy is not viable', () => {
    const a = auditDealCardCoherence({
      report: { ...cleanReport, mostViableStrategy: 'Quick flip (preliminary ? confirm access/title/valuation).' },
      executiveSummary: {
        strongestStrategy: { strategy: 'No acquisition strategy is ready' },
        strategyRanking: [
          { strategy: 'Cash Flip', viability: 'not_viable' },
          { strategy: 'Land-Home Package', viability: 'not_viable' },
        ],
      },
      subjectCardId: 15,
    });
    expect(a.checks.find((x) => x.id === 'strategy_single_story')!.pass).toBe(true);
  });
  it('fails strategy_single_story when Strategy tab/pursuit uses a legacy primary', () => {
    const a = auditDealCardCoherence({
      report: cleanReport,
      executiveSummary: cleanEs,
      pursuit: { recommended: { strategy: 'Subdivide' }, runnerUps: [{ strategy: 'Cash Flip' }] },
      subjectCardId: 15,
    });
    const c = a.checks.find((x) => x.id === 'strategy_single_story')!;
    expect(c.pass).toBe(false);
    expect(c.detail).toMatch(/Strategy tab/);
  });

  it('fails market_geography when comps were pulled for the wrong state', () => {
    const a = auditDealCardCoherence({
      report: { ...cleanReport, marketComps: { ...cleanReport.marketComps, query: { county: 'Sevier', state: 'TN' } } },
      executiveSummary: cleanEs, subjectCardId: 15, subject: { county: 'Sevier', state: 'AR' },
    });
    expect(a.checks.find((x) => x.id === 'market_geography')!.pass).toBe(false);
  });

  it('fails operator_language when developer wording reaches a narrative', () => {
    const a = auditDealCardCoherence({
      report: { ...cleanReport, ddSummary: 'Source field not returned for wetlands.' },
      executiveSummary: cleanEs, subjectCardId: 15,
    });
    expect(a.checks.find((x) => x.id === 'operator_language')!.pass).toBe(false);
  });

  it('treats honest unknowns as passing, never as contradictions', () => {
    const a = auditDealCardCoherence({
      report: { exists: true, reconciliation: { acreage: { primary: null }, conflicts: [] }, valuation: { primary: null, conflict: false, conflictNote: null } },
      subjectCardId: null,
    });
    expect(a.passed).toBe(true);
  });

  it('allows the owner FMV formula from one validated sold comp', () => {
    const a = auditDealCardCoherence({
      report: cleanReport,
      executiveSummary: cleanEs,
      subjectCardId: 15,
      compRegistry: { counts: { validatedSold: 1, validatedActive: 3, rawCandidates: 26, rejected: 15 }, valuationReady: true },
      pursuit: { recommended: null, runnerUps: [], attractiveAcquisition: { low: 60_438, high: 90_657, estMarketValue: 151_095 } },
    });
    const c = a.checks.find((x) => x.id === 'one_comp_pricing_gate')!;
    expect(c.pass).toBe(true);
    expect(c.detail).toMatch(/respect the validated-comp gate/i);
  });

  it('fails comp_counts_validated when compState counts disagree with the registry', () => {
    const a = auditDealCardCoherence({
      report: cleanReport,
      executiveSummary: cleanEs,
      subjectCardId: 15,
      compRegistry: { counts: { validatedSold: 1 }, valuationReady: false },
    });
    const c = a.checks.find((x) => x.id === 'comp_counts_validated')!;
    expect(c.pass).toBe(false);
    expect(c.detail).toMatch(/validated unique registry holds 1/);
  });

  it('fails wetlands_consistency when the record shows wetlands but a tab says none', () => {
    const a = auditDealCardCoherence({
      report: { ...cleanReport, ddFactChecklist: [{ key: 'acres', value: '17.93' }, { key: 'wetlands', value: 'None' }] },
      executiveSummary: cleanEs,
      subjectCardId: 15,
      operatorRecord: { decisionCards: [{ key: 'wetlands', verdict: 'risk', headline: '28.5% mapped (0.999 ac)' }] },
    });
    expect(a.checks.find((x) => x.id === 'wetlands_consistency')!.pass).toBe(false);
  });

  it('fails fema_consistency when accepted flood screening reads unknown elsewhere', () => {
    const a = auditDealCardCoherence({
      report: { ...cleanReport, ddFactChecklist: [{ key: 'femaFloodZone', value: 'Unknown' }] },
      executiveSummary: cleanEs,
      subjectCardId: 15,
      operatorRecord: { decisionCards: [{ key: 'flood', verdict: 'risk', headline: '59% in SFHA (AE)' }] },
    });
    expect(a.checks.find((x) => x.id === 'fema_consistency')!.pass).toBe(false);
  });

  it('fails acreage_conflict_preserved when a conflict is collapsed to one number', () => {
    const a = auditDealCardCoherence({
      report: cleanReport, // reconciliation shows no conflict
      executiveSummary: cleanEs,
      subjectCardId: 15,
      operatorRecord: { identity: { acreageConflict: true } },
    });
    expect(a.checks.find((x) => x.id === 'acreage_conflict_preserved')!.pass).toBe(false);
  });

  it('fails strategy_five_approved on fewer than five or Pass-as-strategy', () => {
    const four = auditDealCardCoherence({
      report: cleanReport, executiveSummary: cleanEs, subjectCardId: 15,
      strategyReadiness: { strategies: [{ strategy: 'Cash Flip' }, { strategy: 'Novation or Double Close' }, { strategy: 'Subdivide or Minor Split' }, { strategy: 'Land-Home Package' }], pricingAllowed: true },
    });
    expect(four.checks.find((x) => x.id === 'strategy_five_approved')!.pass).toBe(false);
    const withPass = auditDealCardCoherence({
      report: cleanReport, executiveSummary: cleanEs, subjectCardId: 15,
      strategyReadiness: { strategies: [{ strategy: 'Cash Flip' }, { strategy: 'Novation or Double Close' }, { strategy: 'Subdivide or Minor Split' }, { strategy: 'Land-Home Package' }, { strategy: 'Pass' }], pricingAllowed: true },
    });
    expect(withPass.checks.find((x) => x.id === 'strategy_five_approved')!.pass).toBe(false);
  });

  it('recognizes Cash Flip as the approved quick-flip strategy', () => {
    const a = auditDealCardCoherence({
      report: cleanReport, executiveSummary: cleanEs, subjectCardId: 15,
      strategyReadiness: { strategies: [
        { strategy: 'Cash Flip' },
        { strategy: 'Novation or Double Close' },
        { strategy: 'Subdivide or Minor Split' },
        { strategy: 'Land-Home Package' },
        { strategy: 'Improvement Then Flip' },
      ], pricingAllowed: false },
    });
    expect(a.checks.find((x) => x.id === 'strategy_five_approved')).toMatchObject({ pass: true });
  });

  it('fails pricing_gate_agreement when the gate is closed but a band or winner shows', () => {
    const a = auditDealCardCoherence({
      report: cleanReport, executiveSummary: cleanEs, subjectCardId: 15,
      strategyReadiness: { strategies: [], pricingAllowed: false },
      pursuit: { recommended: { strategy: 'Cash Flip' }, runnerUps: [], attractiveAcquisition: null },
    });
    expect(a.checks.find((x) => x.id === 'pricing_gate_agreement')!.pass).toBe(false);
  });

  it('fails documents_visible when a deed is claimed but no pages are viewable', () => {
    const a = auditDealCardCoherence({
      report: cleanReport, executiveSummary: cleanEs, subjectCardId: 15,
      deedRetrieved: true,
      documentRegistry: { documentCount: 0, pageCount: 0 },
    });
    expect(a.checks.find((x) => x.id === 'documents_visible')!.pass).toBe(false);
  });

  it('fails land_score_current when a stale score displays against an unavailable reconciled score', () => {
    const a = auditDealCardCoherence({
      report: { ...cleanReport, landScore: { score: 38 } } as never,
      executiveSummary: cleanEs, subjectCardId: 15,
      operatorRecord: { landScore: { available: false, verdict: null, unavailableReason: 'Land Score unavailable because current inputs are conflicted or incomplete.' } },
    });
    expect(a.checks.find((x) => x.id === 'land_score_current')!.pass).toBe(false);
  });

  it('fails blocked_offer_agreement when offer is blocked but a price range shows', () => {
    const a = auditDealCardCoherence({
      report: cleanReport, executiveSummary: cleanEs, subjectCardId: 15,
      operatorRecord: { offerReadiness: { state: 'blocked' } },
      pursuit: { recommended: null, runnerUps: [], attractiveAcquisition: { low: 60_000, high: 90_000 } },
    });
    expect(a.checks.find((x) => x.id === 'blocked_offer_agreement')!.pass).toBe(false);
  });

  it('fails operator_language on unsafe one-observation market language', () => {
    const a = auditDealCardCoherence({
      report: { ...cleanReport, marketSummary: 'Verified land is trading around $20,146/acre here.' },
      executiveSummary: cleanEs, subjectCardId: 15,
    });
    expect(a.checks.find((x) => x.id === 'operator_language')!.pass).toBe(false);
  });
});

// ── Unified readiness agreement (the WS3 disagreement gate) ───────────────────

const blockedFive = ['Cash Flip', 'Novation or Double Close', 'Subdivide or Minor Split', 'Land-Home Package', 'Improvement Then Flip']
  .map((strategy) => ({ strategy, status: 'blocked' }));

const coherentUnified = {
  value: { state: 'conflicted', why: 'Acreage conflicted — pricing gated.' },
  offer: { state: 'researching', why: 'Pricing gate closed; zoning research pending.' },
  contract: { state: 'blocked' },
  valuationContext: { state: 'preliminary' },
  strategyScoreability: { state: 'not_scoreable' },
  strategyActionability: { state: 'blocked' },
  allStrategiesBlocked: true,
  consistencyIssues: [],
};

const coherentOperator = {
  offerReadiness: { state: 'researching' },
  valueReadiness: { state: 'conflicted' },
  pricingGate: { pricingAllowed: false },
};

describe('auditDealCardCoherence — unified readiness disagreement fails the audit', () => {
  const base = {
    report: cleanReport, executiveSummary: cleanEs, subjectCardId: 15,
    strategyReadiness: { strategies: blockedFive, pricingAllowed: false },
    operatorRecord: coherentOperator,
  };

  it('passes when every readiness surface mirrors the shared record', () => {
    const a = auditDealCardCoherence({ ...base, unifiedReadiness: coherentUnified });
    expect(a.checks.find((x) => x.id === 'unified_readiness_agreement')!.pass).toBe(true);
    expect(a.checks.find((x) => x.id === 'readiness_states_reconcile')!.pass).toBe(true);
  });

  it('fails on a seeded value-state disagreement between surfaces', () => {
    const a = auditDealCardCoherence({
      ...base,
      operatorRecord: { ...coherentOperator, valueReadiness: { state: 'ready' } },
      unifiedReadiness: coherentUnified,
    });
    const c = a.checks.find((x) => x.id === 'unified_readiness_agreement')!;
    expect(c.pass).toBe(false);
    expect(c.detail).toMatch(/value readiness disagrees/i);
  });

  it('fails when actionability reads favorable while all five strategies are blocked', () => {
    const a = auditDealCardCoherence({
      ...base,
      unifiedReadiness: { ...coherentUnified, strategyActionability: { state: 'actionable' } },
    });
    expect(a.checks.find((x) => x.id === 'unified_readiness_agreement')!.pass).toBe(false);
  });

  it('fails when scoreability reads scoreable while the gate is closed', () => {
    const a = auditDealCardCoherence({
      ...base,
      unifiedReadiness: { ...coherentUnified, strategyScoreability: { state: 'scoreable' } },
    });
    expect(a.checks.find((x) => x.id === 'unified_readiness_agreement')!.pass).toBe(false);
  });

  it('fails when the composition itself reported consistency issues', () => {
    const a = auditDealCardCoherence({
      ...base,
      unifiedReadiness: { ...coherentUnified, consistencyIssues: ['Value readiness reported "ready" while the shared pricing gate is closed.'] },
    });
    expect(a.checks.find((x) => x.id === 'unified_readiness_agreement')!.pass).toBe(false);
  });

  it('fails when the legacy report offer label outranks the shared record', () => {
    const a = auditDealCardCoherence({
      ...base,
      unifiedReadiness: coherentUnified,
      reportOfferReadiness: 'ready_for_offer',
    });
    const c = a.checks.find((x) => x.id === 'readiness_states_reconcile')!;
    expect(c.pass).toBe(false);
    expect(c.detail).toMatch(/legacy report offer label/i);
  });

  it('fails when a bare median is presented as a defensible valuation basis', () => {
    const a = auditDealCardCoherence({
      ...base,
      compRegistry: { counts: { validatedSold: 55, validatedActive: 0 }, valuationReady: true },
      unifiedReadiness: { ...coherentUnified, valuationContext: { state: 'defensible' } },
    });
    expect(a.checks.find((x) => x.id === 'readiness_states_reconcile')!.pass).toBe(false);
  });

  it('fails when contract readiness outruns offer readiness', () => {
    const a = auditDealCardCoherence({
      ...base,
      unifiedReadiness: { ...coherentUnified, contract: { state: 'needs_confirmation' } },
    });
    const c = a.checks.find((x) => x.id === 'readiness_states_reconcile')!;
    expect(c.pass).toBe(false);
    expect(c.detail).toMatch(/contract/i);
  });

  it('fails when a researching/blocked offer has no explanation', () => {
    const a = auditDealCardCoherence({
      ...base,
      unifiedReadiness: { ...coherentUnified, offer: { state: 'researching', why: '' } },
    });
    expect(a.checks.find((x) => x.id === 'readiness_states_reconcile')!.pass).toBe(false);
  });
});
