// WS3 browser-QA regression coverage (findings F8–F11).
//
// F8  report-download-bypasses-unified-readiness — the downloadable report must
//     render the SHARED strategy/readiness records, never the legacy discovery
//     ranking's favorable "High Potential" labels or a promoted primary while
//     the pricing gate is closed.
// F9  frontend-missing-value (recurrence #2) — the executive summary (with the
//     shared readiness line) must render on record-bearing Overviews; a value
//     wired into a branch that never renders is a missing value.
// F10 market-pulse-favorable-valuation-language — a computable median is never
//     described as "the valuation basis".
// F11 operator-gap-label-empty-subject — a verification item always names WHAT
//     needs confirming; duplicate same-fact blockers collapse to one wording.

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { propertyIntelligenceMarkdown } from './routes.js';
import { operatorGapLabel, operatorizePersistedGap } from './deal-card-report.js';
import { buildPursuitDecision } from './deal-card-pursuit.js';
import { buildStrategyReadiness, computePricingGate } from './strategy-readiness.js';
import { buildUnifiedReadiness } from './unified-readiness.js';
import { computeResearchCompleteness } from './research-completeness.js';

const DEAL_CARD_SRC = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/DealCard.tsx', import.meta.url)),
  'utf-8',
);
const ROUTES_SRC = fs.readFileSync(
  fileURLToPath(new URL('./routes.ts', import.meta.url)),
  'utf-8',
);

// ── Shared blocked-card fixture (never scoped to one property) ────────────────

const gate = computePricingGate({ parcelVerified: true, validatedSoldComps: 55, valuationReady: true, valuationConflict: false, acreageConflict: true });
const strategy = buildStrategyReadiness({
  parcelVerified: true, validatedSoldComps: 55, valuationReady: true, valuationConflict: false,
  prebuiltGate: gate, acres: 1.15, acreageConflict: true, wetlandsPct: null, floodSfhaPct: null,
  septicOutlook: 'mixed', accessStatus: 'public_road_proximity', legalAccessConfirmed: false,
  zoningKnown: false, utilitiesKnown: true, improved: false, hardRisks: [], legalAcreageUnresolved: true,
});
const unified = buildUnifiedReadiness({
  parcelVerified: true, pricingGate: gate,
  research: computeResearchCompleteness([
    { key: 'county', label: 'Official county records', attempted: true, dataRetrieved: true, businessResolved: true, externalConfirmationRequired: false },
    { key: 'zoning', label: 'Zoning & land use', attempted: false, dataRetrieved: false, businessResolved: false, externalConfirmationRequired: false },
  ]),
  strategy,
  valueReadiness: { state: 'conflicted', why: 'Acreage is conflicted — the value basis is unstable until a survey resolves it.' },
  offerReadiness: { state: 'researching', why: 'Pricing gate closed; zoning research pending.' },
  registryValuationReady: true, validatedSoldComps: 55, valuationConflict: false, acreageConflict: true,
  legalAccessConfirmed: false, titleUnresolved: false, deedReviewed: false, zoningKnown: false, physicalConstraints: [],
});

// ── F8: the download renders the shared records ───────────────────────────────

describe('F8 — downloadable report consumes the shared strategy/readiness records', () => {
  const report = {
    dealCardId: 1, exists: true, parcelVerified: true,
    reportStatus: 'complete', parcelVerificationStatus: 'verified',
    ddSummary: 'Screening summary.', marketSummary: 'Market summary.',
    strategySummary: 'Strategy summary.', mostViableStrategy: '',
    ddFactChecklist: [], riskFlags: [], landScore: null,
    visualContext: { assets: [] }, landportalInspection: null, govDd: null,
  } as never;
  const executiveSummary = {
    headline: 'Verified parcel — pricing blocked, research continuing',
    marketPulse: { interpretation: 'Market context.' },
  } as never;

  const md = propertyIntelligenceMarkdown({ deal: { title: 'Fixture Deal' }, report, executiveSummary, unifiedReadiness: unified, strategyReadiness: strategy });

  it('renders every strategy with its SHARED blocked status, never a favorable legacy label', () => {
    for (const s of strategy.strategies) {
      expect(md).toContain(`- ${s.strategy}: blocked.`);
    }
    expect(md).not.toMatch(/High Potential/i);
    expect(md).not.toMatch(/Room to acquire below value/i);
  });

  it('never promotes a primary strategy while the pricing gate is closed', () => {
    expect(md).toMatch(/Primary strategy: none — the pricing gate is closed/);
  });

  it('carries the shared readiness record with every dimension and its why', () => {
    expect(md).toContain('## Readiness (shared record)');
    expect(md).toContain(unified.summaryLine);
    for (const d of unified.dimensions) expect(md).toContain(`- ${d.label}: ${d.stateLabel}.`);
    expect(md).toMatch(/Material facts lowering readiness:/);
  });

  it('the download route runs the same canonical projection as the live GET', () => {
    // Both consumers call the ONE projection helper.
    const calls = ROUTES_SRC.match(/projectCanonicalReport\(\{ id, deal, report, publicRun/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    // The markdown builder receives the shared records.
    expect(ROUTES_SRC).toMatch(/unifiedReadiness: projection\.canonical\.unifiedReadiness,\s*\n\s*strategyReadiness: projection\.canonical\.strategyReadiness,/);
  });
});

// ── F9: the executive summary renders on record-bearing Overviews ─────────────

describe('F9 — executive summary is visible without internal readiness surfaces', () => {
  it('the record branch of OverviewTab renders OverviewSummary', () => {
    const branchStart = DEAL_CARD_SRC.indexOf('if (record) {');
    expect(branchStart).toBeGreaterThan(-1);
    const branch = DEAL_CARD_SRC.slice(branchStart, branchStart + 2000);
    expect(branch).toContain('<OverviewSummary es={es} report={report} />');
  });

  it('OverviewSummary does not expose the shared readiness summary line', () => {
    expect(DEAL_CARD_SRC).not.toMatch(/es\.readiness\s*&&/);
    expect(DEAL_CARD_SRC).not.toMatch(/\{es\.readiness\.summaryLine\}/);
  });

  it('the unified readiness strip is absent from owner-facing surfaces', () => {
    const strips = DEAL_CARD_SRC.match(/<UnifiedReadinessStrip/g) ?? [];
    expect(strips).toHaveLength(0);
  });
});

// ── F10: market pulse never calls a median "the valuation basis" ──────────────

describe('F10 — market-pulse language never presents a computable median as a valuation basis', () => {
  it('the favorable phrasing is gone and the qualified phrasing is present', () => {
    expect(ROUTES_SRC).not.toContain('— the valuation basis)');
    expect(ROUTES_SRC).not.toContain('the same basis as the preliminary valuation');
    expect(ROUTES_SRC).toContain('market context only');
    expect(ROUTES_SRC).toContain('never by a computable median alone');
  });

  it('feeds the pulse only canonical validated sold observations, never raw report context rows', () => {
    expect(ROUTES_SRC).toContain('pulseRegistry.validatedSold.map');
    expect(ROUTES_SRC).toContain('bandCount = pulseRegistry.counts.validatedSold');
    expect(ROUTES_SRC).not.toContain('bandCount = persistedReport.marketComps?.soldCount');
  });
});

// ── F11: gap labels always name a subject; duplicates collapse ────────────────

describe('F11 — verification items always name what needs confirming', () => {
  it('an empty field yields an empty label (dropped by callers), never a dangling bullet', () => {
    expect(operatorGapLabel('')).toBe('');
    expect(operatorGapLabel('   ')).toBe('');
  });

  it('an unrecognized field keeps the field as the subject', () => {
    expect(operatorGapLabel('easementReview')).toMatch(/ownership|easementReview/i);
    expect(operatorGapLabel('somethingNovel')).toBe('Needs confirmation: somethingNovel.');
  });

  it('operatorizePersistedGap never emits a bare "Needs confirmation."', () => {
    expect(operatorizePersistedGap('')).toBe('');
    // Persisted legacy subject-less sentences are dropped at read time.
    expect(operatorizePersistedGap('Needs confirmation.')).toBe('');
    expect(operatorizePersistedGap('needs confirmation')).toBe('');
  });

  it('pursuit remaining verification filters legacy subject-less items', () => {
    const p = buildPursuitDecision({
      parcelVerified: true, valuation: null, compState: null, riskFlags: [], blockers: [],
      verifyBeforeOffer: ['Needs confirmation.', '', 'Needs zoning confirmation.'],
      strategyRanking: null, strongestStrategy: null, askingPrice: null,
      pricingAllowed: false, pricingBlockers: ['gate closed'],
    } as never);
    expect(p.remainingVerification).toContain('Needs zoning confirmation.');
    expect(p.remainingVerification).not.toContain('Needs confirmation.');
    expect(p.remainingVerification).not.toContain('');
  });

  it('the Confirm-before-offer panel collapses duplicate same-fact blocker wordings', () => {
    const panelsSrc = fs.readFileSync(fileURLToPath(new URL('../../web/src/components/DealCardPanels.tsx', import.meta.url)), 'utf-8');
    expect(panelsSrc).toMatch(/One fact, one bullet/);
    expect(panelsSrc).toMatch(/keep = matched\.reduce/);
  });
});

// ── F12: the SHARED strategy record never carries the same fact twice ─────────

describe('F12 — shared strategy record carries one wording per fact (dedupe at the record)', () => {
  it('Subdivide blockers name the legal-acreage fact exactly once under an acreage conflict', () => {
    const subdivide = strategy.strategies.find((s) => s.strategy === 'Subdivide or Minor Split')!;
    const acreageBlockers = subdivide.blockers.filter((b) => /legal acreage/i.test(b));
    expect(acreageBlockers).toHaveLength(1);
  });

  it('no strategy in the record repeats an identical blocker string', () => {
    for (const s of strategy.strategies) {
      expect(new Set(s.blockers).size, `${s.strategy} blockers`).toBe(s.blockers.length);
    }
  });
});

// ── F13: the download's Comparable Sales section uses the unique registry ─────

describe('F13 — downloadable Comparable Sales lists each unique property exactly once', () => {
  const registry = {
    uniqueComps: [
      { key: 'a', address: '216 Fixture Way, Testville, SC', apn: null, acres: 1.4, providers: ['HomeHarvest', 'Zillow'], primary: { kind: 'sold', price: 36_000, pricePerAcre: 25_962, dateIso: '2025-08-01', providers: ['HomeHarvest'] } },
      { key: 'b', address: '400 Sample Rd, Testville, SC', apn: null, acres: 2.1, providers: ['Realie'], primary: { kind: 'active', price: 52_000, pricePerAcre: 24_762, dateIso: null, providers: ['Realie'] } },
    ],
    counts: { validatedSold: 1, validatedActive: 1, duplicatesMerged: 3, rejected: 2 },
  } as never;
  const report = {
    dealCardId: 1, exists: true, parcelVerified: true,
    reportStatus: 'complete', parcelVerificationStatus: 'verified',
    ddSummary: 'x', marketSummary: 'x', strategySummary: 'x', mostViableStrategy: '',
    ddFactChecklist: [], riskFlags: [], landScore: null, visualContext: { assets: [] },
    // Legacy inspection list with the SAME sale twice — must not be rendered.
    landportalInspection: { comparables: [
      { status: 'sold', address: '216 Fixture Way, Testville, SC', pricePerAcre: 25_962 },
      { status: 'sold', address: '216 Fixture Way, Testville, SC', pricePerAcre: 25_962 },
    ] }, govDd: null,
  } as never;
  const md = propertyIntelligenceMarkdown({
    deal: { title: 'Fixture Deal' }, report,
    executiveSummary: { headline: 'x', marketPulse: { interpretation: 'x' } } as never,
    unifiedReadiness: unified, strategyReadiness: strategy, compRegistry: registry,
  });

  it('each unique property appears exactly once', () => {
    expect(md.match(/216 Fixture Way/g)).toHaveLength(1);
    expect(md.match(/400 Sample Rd/g)).toHaveLength(1);
  });

  it('states the registry counts including duplicates merged', () => {
    expect(md).toContain('Validated unique: 1 sold, 1 active (3 duplicate provider row(s) merged, 2 rejected).');
  });

  it('the download route passes the registry to the markdown builder', () => {
    const src = fs.readFileSync(fileURLToPath(new URL('./routes.ts', import.meta.url)), 'utf-8');
    expect(src).toMatch(/compRegistry: projection\.canonical\.compRegistry,/);
  });
});
