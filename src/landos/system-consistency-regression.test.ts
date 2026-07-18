// Regression tests for the 2026-07-14 live operator-inspection failures.
//
// Every test here reproduces a SHARED defect that was visible on a real Deal
// Card (the property is a fixture, never the implementation scope): unknown
// header acreage beside numeric calculation acreage, "County County", a dollar
// target while the pricing gate was closed, "Strategies scoreable" beside five
// blocked strategies, "None surfaced" red flags with zero screening evidence,
// a valuation citing 24 sold comps beside a 55-comp registry, a market summary
// denying comps that were validated, and a false 17/17 audit pass.

import { describe, expect, it } from 'vitest';
import { formatCountyLabel, stripCountySuffix, sanitizeGeographySuffixes, parseAcresValue } from './fact-format.js';
import { buildStrategyReadiness, computePricingGate } from './strategy-readiness.js';
import { providerDisplayName } from './comp-providers.js';
import { buildOperatorPropertyRecord, type OperatorRecordContext } from './operator-property-record.js';
import { auditDealCardCoherence } from './deal-card-audit.js';
import { buildUnifiedReadiness } from './unified-readiness.js';
import { buildExecutiveSummary } from './deal-card-executive-summary.js';
import {
  valuationFromRegistry, applyPricingGate, refreshMarketSummary, refreshStrategySummary,
  bestCompsFromRegistry, classifyReportReadiness, straightLineMiles, registryValuationStats,
} from './deal-card-projection.js';
import { buildCompRegistry, type CompRegistryCandidate } from './comp-registry.js';
import type { DealCardReportView } from './deal-card-report.js';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const verifiedContext: OperatorRecordContext = {
  situsAddress: '100 Fixture Rd, Testville, SC, 29000',
  county: 'Fixture County', // sources sometimes store the suffixed name
  state: 'SC',
  apn: '0000-00-00-0001',
  owner: 'DOE JANE',
  assessedAcres: 1.15,
  coordinates: { lat: 34.99, lng: -82.65 },
  parcelVerified: true,
  verificationSource: 'Persisted verified Property Card',
  compCount: 55,
  valuationReady: true,
  valuationConflict: true, // sold vs asking disagree materially
  thinMarketClusterSupported: false,
  marketPulseAvailable: false,
  visualsCaptured: 0,
  landPortalCaptured: false,
  deedRetrieved: false,
};

function soldCandidate(i: number, over: Partial<CompRegistryCandidate> = {}): CompRegistryCandidate {
  return {
    provider: 'homeharvest', lane: 'sold', addressDesc: `${100 + i} Comp St, Testville, SC 29000`,
    price: 40_000 + i * 1000, priceKind: 'sold', saleOrListDate: '2025-10-01', acres: 1 + i * 0.1,
    pricePerAcre: 38_000, sourceUrl: `https://example.com/${i}`,
    ...over,
  };
}

// ── Geography + acreage parsing ───────────────────────────────────────────────

describe('shared geography formatter', () => {
  it('appends the county suffix exactly once (name without suffix)', () => {
    expect(formatCountyLabel('Pickens')).toBe('Pickens County');
  });
  it('never duplicates the suffix (name already suffixed)', () => {
    expect(formatCountyLabel('Pickens County')).toBe('Pickens County');
    expect(formatCountyLabel('Pickens County County')).toBe('Pickens County');
  });
  it('preserves non-county suffixes', () => {
    expect(formatCountyLabel('Vermilion Parish')).toBe('Vermilion Parish');
  });
  it('strips the suffix for storage/normalization', () => {
    expect(stripCountySuffix('Pickens County')).toBe('Pickens');
    expect(stripCountySuffix('Pickens')).toBe('Pickens');
  });
  it('repairs stale persisted narratives at read time', () => {
    expect(sanitizeGeographySuffixes('Target area: Pickens County County, SC.')).toBe('Target area: Pickens County, SC.');
  });
});

describe('shared acreage parser', () => {
  it('parses the display form the checklist stores ("1.15 ac")', () => {
    expect(parseAcresValue('1.15 ac')).toBe(1.15);
  });
  it('parses plain numbers and comma-grouped strings', () => {
    expect(parseAcresValue(7.5)).toBe(7.5);
    expect(parseAcresValue('1,234.5 acres')).toBe(1234.5);
  });
  it('returns null (never NaN) for junk', () => {
    expect(parseAcresValue('unknown')).toBeNull();
    expect(parseAcresValue(null)).toBeNull();
  });
});

// ── Pricing gate ──────────────────────────────────────────────────────────────

describe('the ONE pricing gate', () => {
  it('closes on a material valuation conflict even with many sold comps', () => {
    const gate = computePricingGate({ parcelVerified: true, validatedSoldComps: 55, valuationReady: true, valuationConflict: true, acreageConflict: false });
    expect(gate.pricingAllowed).toBe(false);
    expect(gate.pricingBlockers.join(' ')).toMatch(/disagree materially/i);
  });
  it('closes on disputed acreage', () => {
    const gate = computePricingGate({ parcelVerified: true, validatedSoldComps: 5, valuationReady: true, valuationConflict: false, acreageConflict: true });
    expect(gate.pricingAllowed).toBe(false);
  });
  it('opens only when every blocker clears', () => {
    const gate = computePricingGate({ parcelVerified: true, validatedSoldComps: 5, valuationReady: true, valuationConflict: false, acreageConflict: false });
    expect(gate.pricingAllowed).toBe(true);
  });
});

// ── Operator record readiness + red flags + display acreage ─────────────────

describe('operator record consumes the shared gate', () => {
  const record = buildOperatorPropertyRecord(null, verifiedContext);

  it('never renders "Strategies scoreable" while the gate is closed', () => {
    const strategyCard = record.decisionCards.find((c) => c.key === 'strategy')!;
    expect(strategyCard.verdict).not.toBe('good');
    expect(strategyCard.headline).toMatch(/blocked/i);
  });

  it('value readiness is conflicted (not ready) while sold vs asking disagree', () => {
    expect(record.valueReadiness.state).toBe('conflicted');
    const valueCard = record.decisionCards.find((c) => c.key === 'value')!;
    expect(valueCard.verdict).not.toBe('good');
    expect(valueCard.headline).toMatch(/conflicted|blocked/i);
  });

  it('offer readiness cannot advance merely because a range exists', () => {
    expect(['researching', 'blocked']).toContain(record.offerReadiness.state);
  });

  it('incomplete screening never reads "None surfaced"', () => {
    const rf = record.decisionCards.find((c) => c.key === 'red_flags')!;
    expect(rf.verdict).toBe('unknown');
    expect(rf.headline).toMatch(/incomplete/i);
    expect(rf.headline).not.toMatch(/^none surfaced$/i);
  });

  it('description carries the numeric acreage and a single county suffix', () => {
    expect(record.description).toContain('1.15-acre');
    expect(record.description).not.toMatch(/County County/);
    expect(record.description).not.toContain('?-acre');
  });

  it('never claims zones/BFE were screened when flood never ran', () => {
    const all = [...record.unknowns, ...record.workStatus.map((w) => `${w.title} ${w.note}`)].join(' ');
    expect(all).not.toMatch(/already screened from the county layer/i);
    expect(all).toMatch(/flood screening has not run/i);
  });

  it('seller questions derive from the property-specific missing facts', () => {
    const joined = record.sellerQuestions.join(' ');
    expect(joined).toMatch(/1\.15 acres/);
    expect(joined).toMatch(/wetland screening has not run/i);
    expect(joined).toMatch(/utility screening has not run/i);
    expect(joined).toMatch(/Fixture Rd/);
  });

  it('research completeness reports the missing lanes', () => {
    expect(record.researchCompleteness.complete).toBe(false);
    expect(record.researchCompleteness.missing).toContain('FEMA flood');
  });
});

// ── Registry-driven valuation + gate suppression ─────────────────────────────

describe('valuation projection from the validated registry', () => {
  const registry = buildCompRegistry(
    { state: 'SC', county: 'Fixture', acres: 1.15 },
    [soldCandidate(1), soldCandidate(2), soldCandidate(3), soldCandidate(4)],
  );

  it('cites the registry count, not a stale lane count', () => {
    const v = valuationFromRegistry(registry, 1.15, null);
    expect(v.primary?.label).toContain(`(${registry.counts.validatedSold})`);
  });

  it('gate closed → primary and range suppressed, observations preserved, reasons stated', () => {
    const v = valuationFromRegistry(registry, 1.15, null);
    const gated = applyPricingGate(v, { pricingAllowed: false, pricingBlockers: ['Valuation sources disagree materially — tighten comps first.'] });
    expect(gated.primary).toBeNull();
    expect(gated.valueRange).toBeNull();
    expect(gated.supporting.length).toBeGreaterThan(0);
    expect(gated.nextAction).toMatch(/pricing blocked/i);
  });

  it('registry stats never mix sold and active $/acre', () => {
    const mixed = buildCompRegistry({ state: 'SC', acres: 1 }, [
      soldCandidate(1),
      { provider: 'zillow', lane: 'active', addressDesc: '900 Ask St, Testville, SC', price: 200_000, priceKind: 'list', acres: 1, pricePerAcre: 200_000 },
    ]);
    const stats = registryValuationStats(mixed);
    expect(stats.soldMedianPpa).toBe(38_000);
    expect(stats.activeAvgPpa).toBe(200_000);
  });
});

// ── Narrative refreshes ──────────────────────────────────────────────────────

describe('narrative currency', () => {
  it('market summary can never deny validated comps', () => {
    const refreshed = refreshMarketSummary({
      county: 'Pickens County', state: 'SC',
      compSummaryLine: 'Validated unique comps: 55 sold, 51 active.',
      anyRetrieved: true,
      persistedSummary: 'Target area: Pickens County County, SC. No approved non-paid market adapter is connected — market findings are entered manually. No comps, solds, actives are computed or invented.',
    });
    expect(refreshed).toContain('55 sold');
    expect(refreshed).not.toMatch(/No approved non-paid market adapter/);
    expect(refreshed).not.toMatch(/County County/);
  });

  it('strategy narrative never promotes a most-viable exit while the gate is closed', () => {
    const refreshed = refreshStrategySummary({
      gate: { pricingAllowed: false, pricingBlockers: ['Valuation sources disagree materially — tighten comps first.'] },
      strategySummaryLine: 'All 5 strategies blocked pending evidence.',
      persistedSummary: 'Strategy candidates: Quick flip, Pass / no offer. Most viable (preliminary): Quick flip.',
      persistedMostViable: 'Quick flip (preliminary — confirm access/title/valuation).',
    });
    expect(refreshed.strategySummary).toMatch(/blocked/i);
    expect(refreshed.strategySummary).not.toMatch(/Most viable \(preliminary\)/);
    expect(refreshed.mostViableStrategy).toBe('No acquisition strategy is ready');
  });
});

// ── Report readiness classification ──────────────────────────────────────────

describe('report readiness', () => {
  it('incomplete research is a research-progress report, never completed underwriting', () => {
    const r = classifyReportReadiness({ parcelVerified: true, researchComplete: false, researchMissing: ['FEMA flood', 'Wetlands'], pricingAllowed: false });
    expect(r.level).toBe('research_progress_report');
    expect(r.why).toMatch(/FEMA flood/);
  });
  it('complete screening without a value basis is preliminary intelligence', () => {
    expect(classifyReportReadiness({ parcelVerified: true, researchComplete: true, researchMissing: [], pricingAllowed: false }).level).toBe('preliminary_intelligence_report');
  });
  it('screening + defensible basis is desktop underwriting, still not decision-ready', () => {
    const r = classifyReportReadiness({ parcelVerified: true, researchComplete: true, researchMissing: [], pricingAllowed: true });
    expect(r.level).toBe('desktop_underwriting_report');
    expect(r.why).toMatch(/title|legal access|survey/i);
  });
});

// ── Best comps from the registry ─────────────────────────────────────────────

describe('registry-driven best comparables', () => {
  it('selects CLOSED sales only and shows operator-facing provider names', () => {
    const registry = buildCompRegistry({ state: 'SC', acres: 1.15 }, [
      soldCandidate(1), soldCandidate(2),
      { provider: 'zillow', lane: 'active', addressDesc: '900 Ask St, Testville, SC', price: 90_000, priceKind: 'list', acres: 1.2 },
    ]);
    const best = bestCompsFromRegistry(registry, 1.15, {
      subjectCoords: { lat: 34.99, lng: -82.65 },
      coordsByAddress: new Map([
        ['101 comp st, testville, sc 29000', { lat: 35.0, lng: -82.65 }],
        ['102 comp st, testville, sc 29000', { lat: 35.01, lng: -82.65 }],
      ]),
    });
    expect(best.comps.length).toBe(2);
    expect(best.comps.every((c) => c.lane === 'sold')).toBe(true);
    expect(best.comps[0].source).toContain('Realtor.com');
    expect(best.comps[0].source).not.toBe('homeharvest');
  });

  it('computes straight-line distance when coordinates are known and excludes the unmeasured row', () => {
    const registry = buildCompRegistry({ state: 'SC', acres: 1.15 }, [soldCandidate(1), soldCandidate(2)]);
    const coords = new Map([[
      '101 comp st, testville, sc 29000'.replace(/\s+/g, ' '), { lat: 35.0, lng: -82.65 },
    ]]);
    const best = bestCompsFromRegistry(registry, 1.15, { subjectCoords: { lat: 34.99, lng: -82.65 }, coordsByAddress: coords });
    expect(best.comps).toHaveLength(1);
    expect(best.comps[0]?.distanceMethod).toBe('straight_line');
    expect(best.policy.exclusions.some((reason) => /distance is not established/i.test(reason))).toBe(true);
    expect(best.rationale).toMatch(/straight-line/i);
  });

  it('score components are exposed for every selected comp', () => {
    const registry = buildCompRegistry({ state: 'SC', acres: 1.15 }, [soldCandidate(1)]);
    const best = bestCompsFromRegistry(registry, 1.15, {
      subjectCoords: { lat: 34.99, lng: -82.65 },
      coordsByAddress: new Map([['101 comp st, testville, sc 29000', { lat: 35.0, lng: -82.65 }]]),
    });
    expect(best.comps[0].scoreComponents).toBeDefined();
    expect(best.comps[0].scoreComponents.laneStrength).toBeGreaterThan(0);
  });
});

describe('straight-line distance', () => {
  it('computes a plausible mileage', () => {
    const d = straightLineMiles({ lat: 34.99, lng: -82.65 }, { lat: 35.0, lng: -82.65 });
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThan(1);
  });
});

// ── Provider identity ────────────────────────────────────────────────────────

describe('comp provider identity', () => {
  it('homeharvest displays as Realtor.com (HomeHarvest), never a bare adapter id', () => {
    expect(providerDisplayName('homeharvest')).toBe('Realtor.com (HomeHarvest)');
  });
  it('unknown adapters still render readably', () => {
    expect(providerDisplayName('someprovider')).toBe('Someprovider');
  });
});

// ── Executive summary gates ──────────────────────────────────────────────────

function reportLike(overrides: Partial<DealCardReportView> = {}): DealCardReportView {
  return {
    exists: true, dealCardId: 1, reportStatus: 'complete_with_gaps',
    parcelVerificationStatus: 'Parcel verified', parcelVerified: true,
    ddSummary: '', marketSummary: 'Target area: Fixture County, SC.', strategySummary: '', mostViableStrategy: '',
    offerReadiness: 'needs_confirmation', sourceTable: [], dataGaps: [], riskFlags: [],
    countyVerificationChecklist: [], marketFollowUpChecklist: [], strategyBlockers: [], nextConfirmations: [],
    preCallStrategyNotes: '',
    ddFactChecklist: [
      { key: 'acres', label: 'Acreage', value: '1.15 ac', status: 'verified', source: 's' },
      { key: 'county', label: 'County', value: 'Fixture County', status: 'verified', source: 's' },
    ] as never,
    ddCompleteness: { verified: 2, total: 2, percentComplete: 100, label: '' } as never,
    visualContext: { assets: [] } as never,
    landportalInspection: null,
    govDd: { flood: { status: 'not_run', zone: null, note: '', source: null, timestamp: null }, wetlands: { status: 'not_run', type: null, note: '', source: null, timestamp: null }, slope: { status: 'not_run', slopeDeg: null, note: '', source: null, timestamp: null } },
    marketComps: {
      status: 'collected', primaryProvider: 'none', providerChain: [], soldCount: 55, activeCount: 51,
      sold: [], active: [], supplementalSold: [], valuation: [],
      metrics: { soldAvgPrice: null, soldAvgPpa: null, soldMedianPpa: 39_737, ppaMin: 26_667, ppaMax: 48_000, activeAvgPrice: null, domMedian: null },
      sparseExplanation: null, providers: [], source: '', timestamp: null, note: '',
    } as never,
    demographics: {} as never, landScore: null,
    reconciliation: { acreage: { field: 'acreage', label: 'Acreage', primary: '1.15 ac', primarySource: 's', primaryTier: 'provider', alternates: [], conflict: false, conflictNote: null, status: 'reconciled' } } as never,
    valuation: { primary: null, supporting: [], confidence: 'low', conflict: true, conflictNote: 'conflict', valueRange: null, nextAction: null },
    compState: {} as never, bestComps: { comps: [], rationale: '', consideredCount: 0, subjectAcres: null },
    creditUsage: { landportalNonCreditUsed: false, compCreditUsed: false, note: '' },
    generatedAt: null, updatedBy: '',
    ...overrides,
  } as DealCardReportView;
}

describe('executive summary respects the shared gates', () => {
  const gates = {
    pricingAllowed: false,
    pricingBlockers: ['Valuation sources disagree materially — tighten comps first.'],
    researchComplete: false,
    researchMissing: ['FEMA flood', 'Wetlands', 'Soils & septic'],
    sellerQuestions: ['Records show about 1.15 acres — does that match your understanding?'],
  };
  const es = buildExecutiveSummary(reportLike(), undefined, null, gates);

  it('publishes no dollar target while the gate is closed', () => {
    expect(es.preliminaryAcquisitionRange.available).toBe(false);
    expect(es.headline).not.toMatch(/\$\s?\d/);
    expect(es.headline).toMatch(/pricing blocked/i);
    expect(es.dealEconomics.available).toBe(false);
  });

  it('never says "no red flags surfaced" while screening is incomplete', () => {
    const joined = es.topRisks.join(' ');
    expect(joined).not.toMatch(/no major red flags surfaced/i);
    expect(joined).toMatch(/critical-risk review incomplete/i);
  });

  it('consumes the property-specific seller questions', () => {
    expect(es.sellerQuestions[0]).toMatch(/1\.15 acres/);
  });
});

// ── The audit must FAIL on the observed live contradictions ─────────────────

describe('consistency audit detects the observed live failures', () => {
  const failingInputs = {
    report: {
      exists: true,
      parcelVerified: true,
      reconciliation: { acreage: { primary: '1.15 ac', conflict: false, conflictNote: null }, conflicts: [] },
      valuation: { primary: { value: 45_698, label: 'Sold land comps (24)', kind: 'comp_sold' }, conflict: true, conflictNote: 'conflict', valueRange: { low: 30_667, high: 55_200 } },
      compState: { soldCount: 55, activeCount: 51, anyRetrieved: true, summaryLine: 'Validated unique comps: 55 sold, 51 active.', strategyLine: 'Validated sold comps retrieved (55).' },
      marketComps: { soldCount: 55, activeCount: 51, query: { county: 'Fixture', state: 'SC' } },
      ddFactChecklist: [{ key: 'acres', value: '1.15 ac' }],
      ddSummary: 'Parcel verified.',
      marketSummary: 'Target area: Fixture County County, SC. No approved non-paid market adapter is connected — market findings are entered manually. No comps, solds, actives, days-on-market, demand, or pricing are computed or invented.',
      strategySummary: 'Strategy candidates: Quick flip.',
      mostViableStrategy: '',
      visualContext: { assets: [] },
      landportalInspection: null,
    },
    executiveSummary: {
      strongestStrategy: { strategy: 'No acquisition strategy is ready' },
      strategyRanking: [
        { strategy: 'Cash Flip', viability: 'not_viable' }, { strategy: 'Novation or Double Close', viability: 'not_viable' },
        { strategy: 'Subdivide or Minor Split', viability: 'not_viable' }, { strategy: 'Land-Home Package', viability: 'not_viable' },
        { strategy: 'Improvement Then Flip', viability: 'not_viable' },
      ],
      headline: '1.15 ac land, Fixture County — target $18,279–$27,419',
      preliminaryAcquisitionRange: { available: true },
    },
    compRegistry: { counts: { validatedSold: 55, validatedActive: 51, rawCandidates: 118, rejected: 2 }, valuationReady: true },
    strategyReadiness: {
      strategies: ['Cash Flip', 'Novation or Double Close', 'Subdivide or Minor Split', 'Land-Home Package', 'Improvement Then Flip'].map((s) => ({ strategy: s, status: 'blocked' })),
      pricingAllowed: false,
    },
    operatorRecord: {
      identity: { acreageConflict: false, assessedAcres: null, mappedAcres: null },
      description: '?-acre parcel, Fixture County County, SC.',
      decisionCards: [
        { key: 'red_flags', verdict: 'good', headline: 'None surfaced' },
        { key: 'strategy', verdict: 'good', headline: 'Strategies scoreable' },
        { key: 'value', verdict: 'good', headline: 'Comp-supported range available' },
      ],
      offerReadiness: { state: 'needs_confirmation' },
      valueReadiness: { state: 'ready' },
      pricingGate: { pricingAllowed: false },
      researchCompleteness: { complete: false, missing: ['FEMA flood', 'Wetlands'] },
      landScore: { available: false, verdict: null, unavailableReason: 'incomplete' },
    },
  } as const;

  const audit = auditDealCardCoherence(failingInputs as never);

  it('is NOT a pass', () => {
    expect(audit.passed).toBe(false);
    expect(audit.summaryLine).not.toMatch(/\d+\/\d+ consistency checks passed\.$/);
  });

  const mustFail = [
    'displayed_acreage_alignment',
    'geography_format',
    'exec_pricing_gate',
    'strategy_card_agreement',
    'red_flags_completeness',
    'valuation_registry_count',
    'market_summary_currency',
    'offer_readiness_gate',
  ];
  for (const id of mustFail) {
    it(`fails ${id}`, () => {
      const check = audit.checks.find((c) => c.id === id)!;
      expect(check, `check ${id} missing`).toBeDefined();
      expect(check.pass).toBe(false);
    });
  }
});

// ── WS3 regression: the readiness contradiction repaired end to end ──────────
// Live defect (fixture: a verified card with ~55 sold comps and a disputed
// acreage): "Strategy Readiness OK" / "Strategies scoreable" rendered while all
// five strategies were blocked, "Value Readiness OK" from a bare computable
// median, and "Offer Readiness researching" with the favorable states beside it.
// The unified readiness record + audit gate make that combination impossible.

describe('WS3 unified readiness — full chain over the operator record', () => {
  const record = buildOperatorPropertyRecord(null, { ...verifiedContext, valuationConflict: false, acreageDisputed: true });
  const strategy = buildStrategyReadiness({
    parcelVerified: true,
    validatedSoldComps: 55,
    valuationReady: true,
    valuationConflict: false,
    prebuiltGate: record.pricingGate,
    acres: record.identity.mappedAcres ?? record.identity.assessedAcres,
    acreageConflict: record.identity.acreageConflict,
    wetlandsPct: null,
    floodSfhaPct: null,
    septicOutlook: record.septicOutlook.outlook,
    accessStatus: record.accessStatus.status,
    legalAccessConfirmed: false,
    zoningKnown: false,
    utilitiesKnown: false,
    improved: false,
    hardRisks: record.risks,
    trustAuthorityUnresolved: false,
    legalAcreageUnresolved: record.identity.acreageConflict,
  });
  const unified = buildUnifiedReadiness({
    parcelVerified: true,
    pricingGate: record.pricingGate,
    research: record.researchCompleteness,
    strategy,
    valueReadiness: record.valueReadiness,
    offerReadiness: record.offerReadiness,
    registryValuationReady: true,
    validatedSoldComps: 55,
    valuationConflict: false,
    acreageConflict: record.identity.acreageConflict,
    legalAccessConfirmed: false,
    titleUnresolved: (record.identity.ownerWarnings?.length ?? 0) > 0,
    deedReviewed: false,
    zoningKnown: false,
    physicalConstraints: [],
  });

  it('the composition is coherent (no internal consistency issues)', () => {
    expect(unified.consistencyIssues).toEqual([]);
  });

  it('value readiness never reads ready from a bare 55-comp median', () => {
    expect(unified.value.state).not.toBe('ready');
    expect(unified.valuationContext.state).not.toBe('defensible');
  });

  it('all-blocked strategies force blocked actionability and non-scoreable scoring', () => {
    if (unified.allStrategiesBlocked) {
      expect(unified.strategyActionability.state).toBe('blocked');
      expect(unified.strategyScoreability.state).toBe('not_scoreable');
    }
  });

  it('the mirrored states agree with the operator record (single source)', () => {
    expect(unified.value.state).toBe(record.valueReadiness.state);
    expect(unified.offer.state).toBe(record.offerReadiness.state);
  });

  it('offer readiness explains itself', () => {
    expect(unified.offer.why.trim().length).toBeGreaterThan(0);
  });

  it('the audit passes the coherent chain and fails a seeded disagreement', () => {
    const base = {
      report: { exists: true, parcelVerified: true },
      subjectCardId: 1,
      strategyReadiness: { strategies: strategy.strategies, pricingAllowed: strategy.pricingAllowed },
      operatorRecord: {
        offerReadiness: record.offerReadiness,
        valueReadiness: record.valueReadiness,
        pricingGate: record.pricingGate,
      },
      compRegistry: { counts: { validatedSold: 55, validatedActive: 0 }, valuationReady: true },
    };
    const coherent = auditDealCardCoherence({ ...base, unifiedReadiness: unified } as never);
    expect(coherent.checks.find((c) => c.id === 'unified_readiness_agreement')!.pass).toBe(true);
    expect(coherent.checks.find((c) => c.id === 'readiness_states_reconcile')!.pass).toBe(true);

    const seeded = auditDealCardCoherence({
      ...base,
      unifiedReadiness: { ...unified, value: { ...unified.value, state: 'ready' } },
    } as never);
    expect(seeded.checks.find((c) => c.id === 'unified_readiness_agreement')!.pass).toBe(false);
    expect(seeded.passed).toBe(false);
  });

  it('the legacy report offer label can never outrank the shared record', () => {
    const audit = auditDealCardCoherence({
      report: { exists: true, parcelVerified: true },
      subjectCardId: 1,
      strategyReadiness: { strategies: strategy.strategies, pricingAllowed: strategy.pricingAllowed },
      unifiedReadiness: unified,
      reportOfferReadiness: 'ready_for_offer',
    } as never);
    expect(audit.checks.find((c) => c.id === 'readiness_states_reconcile')!.pass).toBe(false);
  });
});
