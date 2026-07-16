import { describe, expect, it } from 'vitest';
import { buildUnifiedReadiness, type UnifiedReadinessInputs } from './unified-readiness.js';
import { buildStrategyReadiness, computePricingGate, type StrategyReadinessInputs } from './strategy-readiness.js';
import { computeResearchCompleteness, type LaneSignal } from './research-completeness.js';

// ── Fixtures (never hardcoded to one property) ───────────────────────────────

function lanes(over: Partial<Record<string, boolean>> = {}): LaneSignal[] {
  const resolved = (key: string, label: string, businessResolved: boolean): LaneSignal => ({
    key, label, attempted: true, dataRetrieved: true, businessResolved, externalConfirmationRequired: false,
  });
  return [
    resolved('county', 'Official county records', true),
    resolved('wetlands', 'Wetlands', true),
    resolved('flood', 'FEMA flood', over.floodResolved ?? false),
    resolved('soils', 'Soils & septic', true),
    resolved('access', 'Road proximity & access', over.accessResolved ?? false),
    resolved('zoning', 'Zoning & land use', over.zoningResolved ?? false),
  ];
}

function strategyInputs(over: Partial<StrategyReadinessInputs>): StrategyReadinessInputs {
  return {
    parcelVerified: true,
    validatedSoldComps: 5,
    valuationReady: true,
    valuationConflict: false,
    acres: 1.15,
    acreageConflict: true,
    wetlandsPct: 0,
    floodSfhaPct: 0,
    septicOutlook: 'mixed',
    accessStatus: 'public_road_proximity',
    legalAccessConfirmed: false,
    zoningKnown: false,
    utilitiesKnown: true,
    improved: false,
    hardRisks: [],
    legalAcreageUnresolved: true,
    ...over,
  };
}

/** The WS3 acceptance shape: many sold comps (median computable) but the shared
 *  gate is CLOSED by a disputed acreage — all five strategies blocked, research
 *  incomplete, offer researching. */
function blockedInputs(over: Partial<UnifiedReadinessInputs> = {}): UnifiedReadinessInputs {
  const gate = computePricingGate({ parcelVerified: true, validatedSoldComps: 55, valuationReady: true, valuationConflict: false, acreageConflict: true });
  const strategy = buildStrategyReadiness(strategyInputs({ validatedSoldComps: 55, prebuiltGate: gate }));
  return {
    parcelVerified: true,
    pricingGate: gate,
    research: computeResearchCompleteness(lanes()),
    strategy,
    valueReadiness: { state: 'conflicted', why: 'Acreage is conflicted (assessed vs mapped) — the value basis is unstable until a survey or recorded plat resolves it.' },
    offerReadiness: { state: 'researching', why: 'Pricing gate closed: acreage conflicted. Research also incomplete (zoning pending).' },
    registryValuationReady: true,
    validatedSoldComps: 55,
    valuationConflict: false,
    acreageConflict: true,
    legalAccessConfirmed: false,
    titleUnresolved: true,
    deedReviewed: false,
    zoningKnown: false,
    physicalConstraints: [],
    ...over,
  };
}

/** A fully open shape: gate open, research complete, no conflicts. */
function openInputs(over: Partial<UnifiedReadinessInputs> = {}): UnifiedReadinessInputs {
  const gate = computePricingGate({ parcelVerified: true, validatedSoldComps: 6, valuationReady: true, valuationConflict: false, acreageConflict: false });
  const strategy = buildStrategyReadiness(strategyInputs({ acreageConflict: false, legalAcreageUnresolved: false, zoningKnown: true, prebuiltGate: gate }));
  return {
    parcelVerified: true,
    pricingGate: gate,
    research: computeResearchCompleteness(lanes({ floodResolved: true, accessResolved: true, zoningResolved: true })),
    strategy,
    valueReadiness: { state: 'ready', why: 'The shared pricing gate is open — a comp-supported range exists on the Market tab.' },
    offerReadiness: { state: 'needs_confirmation', why: 'A range exists and screening is complete; title, access, survey, and septic confirmations gate an offer.' },
    registryValuationReady: true,
    validatedSoldComps: 6,
    valuationConflict: false,
    acreageConflict: false,
    legalAccessConfirmed: false,
    titleUnresolved: false,
    deedReviewed: true,
    zoningKnown: true,
    physicalConstraints: [],
    ...over,
  };
}

// ── The known WS3 contradiction, repaired ────────────────────────────────────

describe('unified readiness — all strategies blocked can never read OK', () => {
  it('actionability is blocked and never favorable while all five strategies are blocked', () => {
    const u = buildUnifiedReadiness(blockedInputs());
    expect(u.allStrategiesBlocked).toBe(true);
    expect(u.strategyActionability.state).toBe('blocked');
    expect(u.strategyActionability.tone).not.toBe('good');
    expect(u.strategyActionability.stateLabel).toMatch(/blocked/i);
    expect(u.strategyActionability.why).toMatch(/all 5 approved strategies are blocked/i);
  });

  it('scoreability is not scoreable while the gate is closed', () => {
    const u = buildUnifiedReadiness(blockedInputs());
    expect(u.strategyScoreability.state).toBe('not_scoreable');
    expect(u.strategyScoreability.tone).not.toBe('good');
  });

  it('screening may remain AVAILABLE while actionability is blocked (the honest split)', () => {
    const u = buildUnifiedReadiness(blockedInputs());
    expect(u.strategyScreening.state).toBe('available');
    expect(u.strategyActionability.state).toBe('blocked');
  });

  it('clamps + flags an impossible scoreable-while-all-blocked composition', () => {
    const inputs = blockedInputs();
    // Seed the impossible favorable state: an open gate record alongside a
    // strategy record where every strategy is blocked.
    const u = buildUnifiedReadiness({ ...inputs, pricingGate: { pricingAllowed: true, pricingBlockers: [] } });
    expect(u.strategyScoreability.state).toBe('not_scoreable');
    expect(u.consistencyIssues.length).toBeGreaterThan(0);
  });
});

describe('unified readiness — a bare median never makes value ready', () => {
  it('value stays conflicted/not-ready with 55 comps while the gate is closed', () => {
    const u = buildUnifiedReadiness(blockedInputs());
    expect(u.value.state).not.toBe('ready');
    expect(u.valuationContext.state).toBe('preliminary');
    expect(u.valuationContext.why).toMatch(/preliminary context only/i);
  });

  it('clamps + flags a value=ready state seeded against a closed gate', () => {
    const u = buildUnifiedReadiness(blockedInputs({ valueReadiness: { state: 'ready', why: 'seeded disagreement' } }));
    expect(u.value.state).not.toBe('ready');
    expect(u.consistencyIssues.join(' ')).toMatch(/value readiness/i);
  });

  it('clamps + flags an offer=ready state seeded against a closed gate', () => {
    const u = buildUnifiedReadiness(blockedInputs({ offerReadiness: { state: 'ready', why: 'seeded disagreement' } }));
    expect(['researching', 'blocked']).toContain(u.offer.state);
    expect(u.consistencyIssues.join(' ')).toMatch(/offer readiness/i);
  });
});

describe('unified readiness — explanations and materiality', () => {
  it('every dimension carries a non-empty why', () => {
    for (const u of [buildUnifiedReadiness(blockedInputs()), buildUnifiedReadiness(openInputs())]) {
      for (const d of u.dimensions) {
        expect(d.why.trim().length, `${d.key} why`).toBeGreaterThan(0);
      }
    }
  });

  it('offer readiness explains why it is researching', () => {
    const u = buildUnifiedReadiness(blockedInputs());
    expect(u.offer.state).toBe('researching');
    expect(u.offer.why).toMatch(/pricing gate closed|incomplete/i);
  });

  it('zoning, acreage basis, access, title, and research materially lower readiness and are listed', () => {
    const u = buildUnifiedReadiness(blockedInputs());
    const factors = u.materiality.map((m) => m.factor);
    expect(factors).toContain('zoning');
    expect(factors).toContain('acreage_basis');
    expect(factors).toContain('access');
    expect(factors).toContain('title');
    expect(factors).toContain('research');
  });

  it('physical constraints and comp incoherence appear as materiality factors', () => {
    const u = buildUnifiedReadiness(blockedInputs({
      physicalConstraints: ['FEMA Flood: 59% in SFHA.'],
      valuationConflict: true,
    }));
    expect(u.materiality.some((m) => m.factor === 'physical')).toBe(true);
    expect(u.materiality.some((m) => m.factor === 'comp_coherence')).toBe(true);
  });
});

describe('unified readiness — contract is separate from offer', () => {
  it('contract stays blocked while recorded-instrument facts are unresolved even when the offer advances', () => {
    const u = buildUnifiedReadiness(openInputs({ deedReviewed: false, titleUnresolved: true }));
    expect(u.offer.state).toBe('needs_confirmation');
    expect(u.contract.state).toBe('blocked');
    expect(u.contract.why).toMatch(/separate from offer readiness/i);
    expect(u.contract.blockers.join(' ')).toMatch(/deed|title/i);
  });

  it('contract never outruns the offer: researching offer keeps contract blocked', () => {
    const u = buildUnifiedReadiness(blockedInputs());
    expect(u.contract.state).toBe('blocked');
    expect(u.contract.blockers.join(' ')).toMatch(/cannot precede an offer decision/i);
  });

  it('contract reaches needs_confirmation only when instruments and offer gates clear', () => {
    const u = buildUnifiedReadiness(openInputs({ legalAccessConfirmed: true, acreageConflict: false }));
    expect(u.contract.state).toBe('needs_confirmation');
  });
});

describe('unified readiness — summary reconciles every dimension', () => {
  it('the summary line names every sub-state', () => {
    const u = buildUnifiedReadiness(blockedInputs());
    expect(u.summaryLine).toMatch(/research \d+\/\d+/i);
    expect(u.summaryLine).toMatch(/value/i);
    expect(u.summaryLine).toMatch(/scoreability/i);
    expect(u.summaryLine).toMatch(/actionability/i);
    expect(u.summaryLine).toMatch(/offer/i);
    expect(u.summaryLine).toMatch(/contract/i);
  });

  it('a coherent composition reports zero consistency issues', () => {
    expect(buildUnifiedReadiness(blockedInputs()).consistencyIssues).toEqual([]);
    expect(buildUnifiedReadiness(openInputs()).consistencyIssues).toEqual([]);
  });
});
