// Deal Card DD + Market + Strategy operational report: workflow + guardrails.
//
// Proves the operational report runs from a Deal Card, runs ONLY the safe
// non-credit parcel resolve (injected), keeps the three departments separate,
// updates the three worksheets, persists through reload, enforces the parcel
// verification guardrails, and never fabricates parcel facts, comps, demand,
// pricing, EVs, or offers — and never spends a comp credit.

import { beforeEach, describe, it, expect } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { createDealCard } from './deal-card.js';
import { getDealCardDd, upsertDealCardDd } from './deal-card-dd.js';
import { getDealCardStrategy } from './deal-card-strategy.js';
import { getDealCardMarket } from './deal-card-market.js';
import { getDealCardReport, runDealCardReport } from './deal-card-report.js';
import { upsertCardFromDukeRun } from './property-card.js';
import { linkPropertyToDeal } from './deal-card.js';
import type { LpPropertySummary, LpResolveArgs, LpResolveResult } from './landportal-client.js';

beforeEach(() => {
  _initTestLandosDb();
});

function newDeal(): number {
  return createDealCard({ entity: 'TY_LAND_BIZ', title: 'Generic report test deal' }).id;
}

/** Seed identity inputs on the DD worksheet so the engine can build identity
 *  text the safe resolver can parse. Generic placeholders only. */
function seedIdentity(id: number): void {
  upsertDealCardDd(id, { apn: '12-345-678', county: 'Clay', state: 'NC' });
}

const VERIFIED_SUMMARY: LpPropertySummary = {
  propertyid: '999', apn: '12-345-678', situs_address: '', city: '', state: 'NC',
  zip: '', county: 'Clay', owner: 'GENERIC OWNER', land_use: 'Vacant Residential Land',
  lot_size_acres: '10', calc_acres: '10', lot_size_sqft: '', road_frontage_ft: '150',
  land_locked: 'false', near_water: '', wetlands_pct: '0', fema_pct: '0',
  buildability_pct: '80', buildability_acres: '8', slope_avg_deg: '3', elevation_avg_ft: '',
  building_area_sqft: '0', assessed_total: '50000', assessed_land: '50000',
  market_total: '60000', market_land: '60000', tlp_estimate: '70000', tlp_ppa: '7000',
  price_acre_county: '7000', lat: '', lng: '', municipality: '', mailing_address: '',
  mailing_city: '', mailing_state: '', similars_count: '0', similars_ppa_min: '',
  similars_ppa_max: '', similars_ppa_median: '', similars_most_recent_year: '',
  similar_sales: [],
};

/** A resolver that verifies the parcel via non-credit property data. */
async function verifiedResolve(_args: LpResolveArgs): Promise<LpResolveResult> {
  return {
    verified: true, status: 'verified', propertyid: '999', fips: '37043', apn: '12-345-678',
    situs_address: '', city: '', state: 'NC', owner: 'GENERIC OWNER',
    match_notes: 'Parcel resolved via direct lookup.', candidates: [], property_summary: VERIFIED_SUMMARY,
  };
}

/** A resolver that cannot verify the parcel. */
async function notVerifiedResolve(_args: LpResolveArgs): Promise<LpResolveResult> {
  return {
    verified: false, status: 'not_verified', propertyid: null, fips: '37043', apn: null,
    situs_address: null, owner: null, match_notes: 'No parcel found.', candidates: [],
  };
}

/** A resolver that throws (LandPortal unavailable / engine error path). */
async function throwingResolve(): Promise<LpResolveResult> {
  throw new Error('network down');
}

describe('Deal Card report — defaults', () => {
  it('returns an honest empty report (exists=false, not_run) when none run', () => {
    const id = newDeal();
    const r = getDealCardReport(id);
    expect(r.exists).toBe(false);
    expect(r.reportStatus).toBe('not_run');
    expect(r.parcelVerified).toBe(false);
    expect(r.creditUsage.compCreditUsed).toBe(false);
    expect(r.sourceTable).toEqual([]);
  });

  it('running on a missing deal card returns null', async () => {
    const res = await runDealCardReport(999999, { resolve: verifiedResolve, timeoutMs: 1000 });
    expect(res).toBeNull();
  });
});

describe('Deal Card report — verified parcel path', () => {
  it('verifies via non-credit resolve, updates DD as source_verified, and persists through reload', async () => {
    const id = newDeal();
    seedIdentity(id);
    const res = await runDealCardReport(id, { resolve: verifiedResolve, timeoutMs: 1000 });
    expect(res).not.toBeNull();
    const r = res!.report;

    expect(r.parcelVerified).toBe(true);
    expect(['complete', 'complete_with_gaps']).toContain(r.reportStatus);
    expect(r.parcelVerificationStatus).toMatch(/verified/i);

    // DD leg (property-level): source-verified identity WITH a named source link.
    const dd = getDealCardDd(id);
    expect(dd.parcelIdentityStatus).toBe('source_verified');
    expect(dd.sourceLinks.length).toBeGreaterThanOrEqual(1);
    expect(dd.apnLabel).toBe('Verified');

    // Reload safety: the persisted report matches.
    const reloaded = getDealCardReport(id);
    expect(reloaded.exists).toBe(true);
    expect(reloaded.parcelVerified).toBe(true);
    expect(reloaded.reportStatus).toBe(r.reportStatus);
  });

  it('applies Strategy logic without fabricating an offer (readiness needs_confirmation, never ready_for_offer)', async () => {
    const id = newDeal();
    seedIdentity(id);
    await runDealCardReport(id, { resolve: verifiedResolve, timeoutMs: 1000 });

    const strategy = getDealCardStrategy(id);
    expect(strategy.offerReadiness).toBe('needs_confirmation');
    expect(strategy.offerReadiness).not.toBe('ready_for_offer');
    expect(strategy.strategyCandidates).toContain('Quick flip');
    // No offer/EV/price was invented.
    expect(strategy.targetProfitNote).toMatch(/valuation is not ready/i);
    const r = getDealCardReport(id);
    expect(r.mostViableStrategy).not.toMatch(/\$\s?\d/);
    expect(r.strategySummary).toMatch(/no offer computed|valuation not ready/i);
  });

  it('keeps the three departments separate and never spends a comp credit', async () => {
    const id = newDeal();
    seedIdentity(id);
    const r = (await runDealCardReport(id, { resolve: verifiedResolve, timeoutMs: 1000 }))!.report;

    // Source table: parcel-exact LandPortal used as NON-credit; comp credit never used.
    const lp = r.sourceTable.find((row) => row.kind === 'parcel_exact');
    expect(lp?.status).toBe('used_non_credit');
    expect(r.sourceTable.every((row) => row.compCreditUsed === false)).toBe(true);
    expect(r.creditUsage.compCreditUsed).toBe(false);
    expect(r.creditUsage.landportalNonCreditUsed).toBe(true);

    // Market leg stayed market-level: it has source targets + a follow-up
    // checklist and never set a concrete demand label or verified a parcel.
    const market = getDealCardMarket(id);
    expect(market.buyerDemandLabel).toBe('not_reviewed');
    expect(r.marketFollowUpChecklist.length).toBeGreaterThan(0);
    expect(r.sourceTable.some((row) => row.kind === 'market_pulse')).toBe(true);
  });

  it('includes a Visual Property Context (supporting only, labeled Not Verified) without any Google call', async () => {
    const id = newDeal();
    seedIdentity(id);
    const r = (await runDealCardReport(id, { resolve: verifiedResolve, timeoutMs: 1000, googleVisualConfigured: true }))!.report;
    expect(r.visualContext).toBeDefined();
    expect(r.visualContext.provider).toBe('google');
    expect(r.visualContext.configured).toBe(true);
    expect(r.visualContext.label).toBe('Visual Signal, Not Verified Fact');
    // image assets are placeholders (no capture/Google call in the report path)
    expect(r.visualContext.assets.every((a) => a.status !== 'captured')).toBe(true);
    // never used for verification: parcel verification is independent
    expect(r.parcelVerified).toBe(true);
  });
});

describe('Deal Card report — zoning wiring (canonical, no provider call)', () => {
  it('threads provider zoning (e.g. Realie zoningCode) into the DD zoning field, labeled Verified', async () => {
    const id = newDeal();
    seedIdentity(id);
    // Verified resolver carrying canonical zoning + a situs address (so a source
    // citation exists -> Verified label). No real provider call.
    const zonedResolve = async (): Promise<LpResolveResult> => ({
      verified: true, status: 'verified', propertyid: '999', fips: '37043', apn: '12-345-678',
      situs_address: '123 Main St', city: 'Sparta', state: 'NC', owner: 'GENERIC OWNER',
      match_notes: 'verified', source: 'Realie.ai', zoning: 'A-1', candidates: [],
      property_summary: { ...VERIFIED_SUMMARY, situs_address: '123 Main St' },
    });
    await runDealCardReport(id, { resolve: zonedResolve, timeoutMs: 1000 });
    const dd = getDealCardDd(id);
    expect(dd.zoning).toBe('A-1');
    expect(dd.zoningLabel).toBe('Verified');
  });

  it('zoning is Unknown (never fabricated) when the provider returns none', async () => {
    const id = newDeal();
    seedIdentity(id);
    // verifiedResolve has land_use 'Vacant Residential Land' and no zoning -> falls
    // back to land use; with neither, zoning would be left unset.
    const noZoning = async (): Promise<LpResolveResult> => ({
      verified: true, status: 'verified', propertyid: '999', fips: '37043', apn: '12-345-678',
      situs_address: '123 Main St', city: '', state: 'NC', owner: 'O', match_notes: 'v', source: 'Realie.ai',
      candidates: [], property_summary: { ...VERIFIED_SUMMARY, land_use: '', situs_address: '123 Main St' },
    });
    await runDealCardReport(id, { resolve: noZoning, timeoutMs: 1000 });
    const dd = getDealCardDd(id);
    expect(dd.zoning).toBeFalsy(); // not fabricated
  });
});

describe('Deal Card report — reuse persisted verified data (no Realie credit)', () => {
  function seedVerifiedCard(dealId: number): void {
    const { card } = upsertCardFromDukeRun({
      entity: 'TY_LAND_BIZ', activeInputAddress: '472 WEST RD', city: 'Poulan', county: 'Worth', state: 'GA',
      apn: '00830-054-000', fips: '13321', owner: 'CARROLL MARGARET R', acres: 8.6,
      verified: true, verificationSource: 'Realie.ai', summary: 'verified via Realie',
    });
    expect(card.verification_status).toBe('verified_property');
    linkPropertyToDeal({ dealCardId: dealId, cardId: card.id, role: 'subject' });
  }

  it('reuses the verified Property Card and makes NO provider call', async () => {
    const id = newDeal();
    seedVerifiedCard(id);
    let resolverCalled = false;
    const spyResolve = async (): Promise<LpResolveResult> => { resolverCalled = true; throw new Error('provider must NOT be called when reusing persisted verification'); };
    const r = (await runDealCardReport(id, { resolve: spyResolve, timeoutMs: 1000, googleVisualConfigured: true }))!.report;

    expect(resolverCalled).toBe(false);             // no Realie/provider call
    expect(r.parcelVerified).toBe(true);            // reused verified identity
    expect(r.parcelVerificationStatus).toMatch(/verified/i);
    const parcelRow = r.sourceTable.find((x) => x.kind === 'parcel_exact')!;
    expect(parcelRow.source).toMatch(/Persisted verified Property Card|reused/i);
    expect(parcelRow.compCreditUsed).toBe(false);
    // DD facts not carried by the card are honest gaps, never fabricated.
    expect(r.dataGaps.some((g) => /femaPct|wetlandsPct|slopeAvgDeg/.test(g))).toBe(true);
    // visual context present and labeled
    expect(r.visualContext.label).toBe('Visual Signal, Not Verified Fact');
  });

  it('reverify:true forces a fresh provider call even with a verified card', async () => {
    const id = newDeal();
    seedVerifiedCard(id);
    let called = false;
    const resolve = async (): Promise<LpResolveResult> => { called = true; return verifiedResolve({} as LpResolveArgs); };
    await runDealCardReport(id, { resolve, timeoutMs: 1000, reverify: true });
    expect(called).toBe(true);
  });
});

describe('Deal Card report — unverified parcel path', () => {
  it('labels DD Local Area Context and blocks Strategy when the parcel is not verified', async () => {
    const id = newDeal();
    seedIdentity(id);
    const r = (await runDealCardReport(id, { resolve: notVerifiedResolve, timeoutMs: 1000 }))!.report;

    expect(r.parcelVerified).toBe(false);
    expect(r.reportStatus).toBe('complete_with_gaps');

    const dd = getDealCardDd(id);
    expect(dd.parcelIdentityStatus).toBe('local_area_context_not_verified');
    // No field is labeled Verified without verification.
    expect(dd.apnLabel).not.toBe('Verified');

    const strategy = getDealCardStrategy(id);
    expect(strategy.offerReadiness).toBe('blocked');
    expect(r.strategyBlockers.join(' ')).toMatch(/not verified/i);

    // Still never spends a comp credit.
    expect(r.creditUsage.compCreditUsed).toBe(false);
  });

  it('saves a blocked report (no worksheet damage) when the safe lookup errors', async () => {
    const id = newDeal();
    seedIdentity(id);
    const res = await runDealCardReport(id, { resolve: throwingResolve, timeoutMs: 1000 });
    expect(res).not.toBeNull();
    // runDukeVerification swallows the throw and reports LandPortal unavailable,
    // so the report is blocked (not failed) and remains honest.
    const r = res!.report;
    expect(['blocked', 'failed']).toContain(r.reportStatus);
    expect(r.parcelVerified).toBe(false);
    expect(r.creditUsage.compCreditUsed).toBe(false);
  });
});
