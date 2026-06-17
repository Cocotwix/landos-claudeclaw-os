// Unit tests for the standardized Duke Report output contract. Pure: no DB,
// no network, no secrets. Product model: Run Duke Report + comp source
// (Redfin/Zillow default no-credit | LandPortal Comps = explicit 1-credit).

import { describe, it, expect } from 'vitest';

import { buildDukePartialContract, LOCAL_AREA_CONTEXT_LABEL } from './duke-partial.js';

const base = {
  latestReportStatus: null as string | null,
  hasVerifiedProperty: false,
  hasUnverifiedProperty: false,
  risks: [] as string[],
  nextActions: [] as Array<Record<string, unknown>>,
  latestWriteback: null as string | null,
};

describe('buildDukePartialContract — verified', () => {
  const c = buildDukePartialContract({ ...base, hasVerifiedProperty: true, latestReportStatus: 'partial', risks: ['No LP valuation'] });

  it('is a duke_report, default Redfin/Zillow comp source, no comp credit', () => {
    expect(c.reportType).toBe('duke_report');
    expect(c.compMode).toBe('redfin_zillow');
    expect(c.compCreditUsed).toBe(false);
    expect(c.noCompCreditUsed).toBe(true);
    expect(c.compFallbackUsed).toBe(false);
  });

  it('is not blocked and surfaces parcel-specific evaluation + strategy matrix', () => {
    expect(c.verificationStatus).toBe('verified');
    expect(c.blockedReason).toBeNull();
    expect(c.discoveryQuestions).toEqual([]);
    expect(c.evaluationStatus).toBe('insufficient_data'); // verified but no EV/comps yet
    expect(c.evaluationEngine.parcelSpecific).toBe(true);
    expect(c.strategyMatrix.parcelSpecific).toBe(true);
    expect(c.strategyMatrix.strategies.length).toBeGreaterThan(0);
    expect(c.localAreaContext.label).toBe(''); // verified -> no "not parcel verified" label
  });

  it('uses real offer-engine strategies (quick flip, subdivision $30k, land-home, teardown, pass)', () => {
    const ids = c.strategyMatrix.strategies.map((s) => s.id);
    expect(ids).toContain('quick_flip');
    expect(ids).toContain('subdivision_minor_split');
    expect(ids).toContain('land_home_package');
    expect(ids).toContain('teardown_land_only');
    expect(ids).toContain('pass');
    const sub = c.strategyMatrix.strategies.find((s) => s.id === 'subdivision_minor_split')!;
    expect(sub.minNetProfitUsd).toBe(30000);
  });

  it('distinguishes a DOUBLE CLOSE row, not hidden under wholesale/assignment', () => {
    const rows = c.strategyMatrix.strategies;
    const dc = rows.find((s) => s.id === 'double_close');
    const wa = rows.find((s) => s.id === 'wholesale_assignment');
    // Both present and clearly distinct.
    expect(dc).toBeTruthy();
    expect(wa).toBeTruthy();
    expect(dc!.label).toBe('Double close');
    expect(dc!.offerBand).not.toBe(wa!.offerBand);
    // Derivation is explicit, not hidden.
    expect(dc!.sourceStrategyId).toBe('wholesale_assignment');
    expect(dc!.note).toMatch(/double close/i);
    expect(dc!.note).toMatch(/wholesale\/assignment/i);
  });

  it('does not invent an offer number for double close (formula description only)', () => {
    const dc = c.strategyMatrix.strategies.find((s) => s.id === 'double_close')!;
    expect(dc.offerBand).toMatch(/formula-based/i);
    // No fabricated MAO / dollar offer figure in the band.
    expect(/\$\s?\d/.test(dc.offerBand)).toBe(false);
    expect(dc.confirmed).toBe(false);
  });

  it('does not produce offer guidance without EV, and reports no missing formula', () => {
    expect(c.offerReadiness.status).toBe('needs_more_info');
    expect(c.offerReadiness.offerGuidanceAllowed).toBe(false);
    expect(c.offerReadiness.missingFormulaWarning).toBeNull(); // formulas exist in offer-engine
    expect(c.offerGuidance.allowed).toBe(false);
  });
});

describe('buildDukePartialContract — unverified blocks parcel-specific work', () => {
  const c = buildDukePartialContract({ ...base, hasUnverifiedProperty: true });

  it('blocks evaluation, strategy, and offer; allows labeled Local Area Context', () => {
    expect(c.verificationStatus).toBe('unverified');
    expect(c.reportStatus).toBe('blocked');
    expect(c.blockedReason).toMatch(/not fully verified/i);
    expect(c.evaluationStatus).toBe('blocked');
    expect(c.evaluationEngine.parcelSpecific).toBe(false);
    expect(c.strategyMatrix.parcelSpecific).toBe(false);
    expect(c.strategyMatrix.strategies).toEqual([]);
    expect(c.offerReadiness.status).toBe('blocked');
    expect(c.offerReadiness.offerGuidanceAllowed).toBe(false);
    expect(c.offerGuidance.allowed).toBe(false);
    expect(c.discoveryQuestions.length).toBeGreaterThan(0);
    // Local Area Context is allowed but labeled not-parcel-verified.
    expect(c.localAreaContext.allowed).toBe(true);
    expect(c.localAreaContext.label).toBe(LOCAL_AREA_CONTEXT_LABEL);
  });
});

describe('buildDukePartialContract — comp source / credit behavior', () => {
  it('LandPortal Comps with an actual credit spend marks compCreditUsed', () => {
    const c = buildDukePartialContract({ ...base, hasVerifiedProperty: true, latestReportStatus: 'partial', compMode: 'landportal_credit', compCreditUsed: true });
    expect(c.compMode).toBe('landportal_credit');
    expect(c.compCreditUsed).toBe(true);
    expect(c.noCompCreditUsed).toBe(false);
  });

  it('LandPortal Comps selected but no actual spend never fabricates a credit use (no hidden spend)', () => {
    const c = buildDukePartialContract({ ...base, hasVerifiedProperty: true, latestReportStatus: 'partial', compMode: 'landportal_credit' });
    expect(c.compCreditUsed).toBe(false);
    expect(c.noCompCreditUsed).toBe(true);
  });

  it('represents a comp fallback (LP credit unavailable -> Redfin/Zillow)', () => {
    const c = buildDukePartialContract({ ...base, hasVerifiedProperty: true, latestReportStatus: 'partial', compMode: 'landportal_credit', compFallbackUsed: true });
    expect(c.compFallbackUsed).toBe(true);
    expect(c.compCreditUsed).toBe(false);
  });

  it('Redfin/Zillow never uses a comp credit', () => {
    const c = buildDukePartialContract({ ...base, hasVerifiedProperty: true, latestReportStatus: 'partial', compMode: 'redfin_zillow', compCreditUsed: true });
    // Credit can only be used on the landportal_credit path.
    expect(c.compCreditUsed).toBe(false);
    expect(c.noCompCreditUsed).toBe(true);
  });
});

describe('buildDukePartialContract — status mapping + misc', () => {
  it('mixed verification blocks', () => {
    const c = buildDukePartialContract({ ...base, hasVerifiedProperty: true, hasUnverifiedProperty: true, latestReportStatus: 'partial' });
    expect(c.verificationStatus).toBe('mixed');
    expect(c.reportStatus).toBe('blocked');
  });

  it('terminal failures pass through', () => {
    expect(buildDukePartialContract({ ...base, hasVerifiedProperty: true, latestReportStatus: 'failed' }).reportStatus).toBe('failed');
    expect(buildDukePartialContract({ ...base, hasVerifiedProperty: true, latestReportStatus: 'not_generated' }).reportStatus).toBe('not_generated');
  });

  it('nextBestAction prefers a persisted open next action', () => {
    const c = buildDukePartialContract({ ...base, hasVerifiedProperty: true, latestReportStatus: 'partial', nextActions: [{ action: 'Pull county checklist' }] });
    expect(c.nextBestAction).toBe('Pull county checklist');
  });

  it('taskStatus defaults to unknown and passes through', () => {
    expect(buildDukePartialContract({ ...base }).taskStatus).toBe('unknown');
    expect(buildDukePartialContract({ ...base, taskStatus: 'running' }).taskStatus).toBe('running');
  });

  it('never emits coordinate/proximity/geocoder verification language', () => {
    const c = buildDukePartialContract({ ...base, hasUnverifiedProperty: true });
    const blob = JSON.stringify(c);
    expect(/geocod|proximity|nearest parcel|map pin|coordinate|lat\/?lon|centroid/i.test(blob)).toBe(false);
  });
});
