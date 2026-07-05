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
import { getDealCardReport, runDealCardReport, buildIdentityText, buildPersistedResolver } from './deal-card-report.js';
import { getDealCard } from './deal-card.js';
import { upsertCardFromDukeRun, getPropertyCardRow } from './property-card.js';
import { linkPropertyToDeal } from './deal-card.js';
import type { LpPropertySummary, LpResolveArgs, LpResolveResult } from './landportal-client.js';

beforeEach(() => {
  _initTestLandosDb();
});

it('buildIdentityText includes the street address so address-only leads can verify (regression)', () => {
  const dealId = createDealCard({ entity: 'TY_LAND_BIZ', title: 'addr lead', leadType: 'test' }).id;
  const { card } = upsertCardFromDukeRun({ entity: 'TY_LAND_BIZ', activeInputAddress: '731 Filter Plant Dr, Fayetteville, NC 28301', city: 'Fayetteville', state: 'NC', verified: false, summary: 'x' });
  linkPropertyToDeal({ dealCardId: dealId, cardId: card.id, role: 'subject' });
  const deal = getDealCard(dealId)!;
  const text = buildIdentityText(deal as never, getDealCardDd(dealId) as never);
  expect(text).toContain('731 Filter Plant Dr');
  expect(text).toMatch(/NC/);
});

describe('coordinate persistence — a reopened verified parcel keeps its enrichment pipeline', () => {
  it('persists verified-parcel coordinates on verify and restores them via the persisted resolver', async () => {
    const { card } = upsertCardFromDukeRun({
      entity: 'TY_LAND_BIZ', activeInputAddress: '2123 Panola Rd, Lithonia, GA',
      apn: '16-001-00-001', county: 'DeKalb', state: 'GA', fips: '13089',
      lat: 33.712, lng: -84.155, verified: true, verificationSource: 'Realie.ai (non-credit)',
    });
    const stored = getPropertyCardRow(card.id)!;
    expect(stored.lat).toBe(33.712);
    expect(stored.lng).toBe(-84.155);
    // Reopen path: the persisted resolver must rebuild property_summary.lat/lng so
    // verification.coordinates is non-null and Realie/Zillow/imagery lanes run.
    const resolve = buildPersistedResolver(stored as unknown as Record<string, unknown>);
    const res = await resolve({} as never, 1000);
    expect(res.verified).toBe(true);
    expect(res.property_summary?.lat).toBe('33.712');
    expect(res.property_summary?.lng).toBe('-84.155');
  });

  it('a coordinate-less re-verify never wipes persisted coordinates (COALESCE)', () => {
    const { card } = upsertCardFromDukeRun({
      entity: 'TY_LAND_BIZ', activeInputAddress: '1 Test Rd', apn: 'A1', county: 'C', state: 'GA', fips: '13089',
      lat: 1.5, lng: 2.5, verified: true, verificationSource: 'Realie',
    });
    // A later run on the same card WITHOUT coordinates must preserve them.
    upsertCardFromDukeRun({
      entity: 'TY_LAND_BIZ', activeInputAddress: '1 Test Rd', apn: 'A1', county: 'C', state: 'GA', fips: '13089',
      cardId: card.id, verified: true, verificationSource: 'Realie',
    });
    const stored = getPropertyCardRow(card.id)!;
    expect(stored.lat).toBe(1.5);
    expect(stored.lng).toBe(2.5);
  });

  it('an unverified card with no coordinates leaves the summary coordinate-free (no fabrication)', async () => {
    const { card } = upsertCardFromDukeRun({ entity: 'TY_LAND_BIZ', activeInputAddress: '9 Nowhere Rd', verified: false });
    const stored = getPropertyCardRow(card.id)!;
    expect(stored.lat).toBeNull();
    const res = await buildPersistedResolver(stored as unknown as Record<string, unknown>)({} as never, 1000);
    expect(res.property_summary?.lat ?? '').toBe('');
  });
});

it('rerun of a parcel with a space-APN + address re-verifies (no stale unverified contradiction)', async () => {
  // REGRESSION for the 2123 Panola verification-state contradiction: a previously
  // verified parcel carries a space-APN in DD ("16 038 07 001") and an address on
  // the linked card. On rerun, buildIdentityText -> extractPropertyArgs must yield
  // the CLEAN apn so the resolver verifies — not a corrupt merged value that flips
  // the report to unverified while the card still shows verified facts.
  const dealId = createDealCard({ entity: 'TY_LAND_BIZ', title: 'space-apn rerun', leadType: 'test' }).id;
  const { card } = upsertCardFromDukeRun({ entity: 'TY_LAND_BIZ', activeInputAddress: '2123 Panola Road, Lithonia GA', city: 'Lithonia', state: 'GA', verified: false, summary: 'x' });
  linkPropertyToDeal({ dealCardId: dealId, cardId: card.id, role: 'subject' });
  upsertDealCardDd(dealId, { apn: '16 038 07 001', county: 'DeKalb', state: 'GA' });
  // Resolver verifies ONLY for the clean APN; a corrupt merged "...2123" would NOT match.
  const resolve = async (args: LpResolveArgs): Promise<LpResolveResult> => {
    const ok = (args.apn ?? '').trim() === '16 038 07 001';
    if (!ok) return { verified: false, status: 'not_verified', propertyid: null, fips: '13089', apn: null, situs_address: null, owner: null, match_notes: `unmatched apn=[${args.apn}]`, candidates: [] };
    return { verified: true, status: 'verified', propertyid: '7', fips: '13089', apn: '16 038 07 001', situs_address: '2123 PANOLA RD', city: 'LITHONIA', state: 'GA', owner: 'X', match_notes: 'exact parcelId match', candidates: [], property_summary: { ...VERIFIED_SUMMARY, propertyid: '7', apn: '16 038 07 001', situs_address: '2123 PANOLA RD', city: 'LITHONIA', state: 'GA', county: 'DeKalb' } };
  };
  const r = (await runDealCardReport(dealId, { resolve, timeoutMs: 1000, reverify: true }))!.report;
  expect(r.parcelVerified).toBe(true); // clean apn -> verified, no contradiction
  expect(r.parcelVerificationStatus).not.toMatch(/not parcel verified|local area context/i);
  // persisted + reloaded stays consistent
  expect(getDealCardReport(dealId).parcelVerified).toBe(true);
});

it('a verified report upgrades the subject card to verified_property + advances kanban (identity != DD completeness)', async () => {
  const dealId = createDealCard({ entity: 'TY_LAND_BIZ', title: 'verify upgrade', leadType: 'test' }).id;
  const { card } = upsertCardFromDukeRun({ entity: 'TY_LAND_BIZ', activeInputAddress: '999 Test Rd, Clay, NC', city: '', county: 'Clay', state: 'NC', verified: false, summary: 'x' });
  linkPropertyToDeal({ dealCardId: dealId, cardId: card.id, role: 'subject' });
  upsertDealCardDd(dealId, { apn: '12-345-678', county: 'Clay', state: 'NC' });
  const cardOf = (id: number) => getDealCard(id)!.propertyCards![0]! as { verification_status: string; kanban_status: string };
  expect(cardOf(dealId).verification_status).toBe('unverified_lead'); // before
  const r = (await runDealCardReport(dealId, { resolve: verifiedResolve, timeoutMs: 1000, reverify: true }))!.report;
  expect(r.parcelVerified).toBe(true);
  const after = cardOf(dealId);
  expect(after.verification_status).toBe('verified_property'); // identity propagated to the card
  expect(after.kanban_status).not.toBe('needs_parcel_verification'); // no longer "needs verification"
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

it('activates FEMA flood (live contract) in the persisted report when the verified parcel has coordinates', async () => {
  const id = createDealCard({ entity: 'TY_LAND_BIZ', title: 'flood deal', leadType: 'test' }).id;
  const { card } = upsertCardFromDukeRun({ entity: 'TY_LAND_BIZ', activeInputAddress: '472 West Rd, Poulan, GA 31781', state: 'GA', verified: false, summary: 'x' });
  linkPropertyToDeal({ dealCardId: id, cardId: card.id, role: 'subject' });
  const resolveWithGeo = async (): Promise<LpResolveResult> => ({
    verified: true, status: 'verified', propertyid: '1', fips: '13321', apn: '00830-054-000',
    situs_address: '472 WEST RD', city: 'POULAN', state: 'GA', owner: 'CARROLL, MARGARET R',
    match_notes: 'ok', candidates: [],
    property_summary: { ...VERIFIED_SUMMARY, situs_address: '472 WEST RD', lat: '31.498296', lng: '-83.772086' },
  });
  // Injected gov-DD fetches — offline, mimic the verified contracts.
  const femaFetch = async () => ({ ok: true, status: 200, json: async () => ({ features: [{ attributes: { FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F' } }] }) });
  const nwiFetch = async () => ({ ok: true, status: 200, json: async () => ({ features: [] }) }); // upland: no wetland
  const usgsFetch = async () => ({ ok: true, status: 200, json: async () => ({ value: '108.6' }) }); // flat
  const r = (await runDealCardReport(id, { resolve: resolveWithGeo, timeoutMs: 1000, reverify: true, femaFetch, nwiFetch, usgsFetch }))!.report;
  expect(r.parcelVerified).toBe(true);
  expect(r.govDd.flood.status).toBe('verified');
  expect(r.govDd.flood.zone).toBe('X');
  expect(r.govDd.wetlands.status).toBe('verified');
  expect(r.govDd.wetlands.type).toBe('None mapped');
  expect(r.govDd.slope.status).toBe('verified');
  expect(r.govDd.slope.slopeDeg).toBe(0); // flat cross
  // persisted + reloads
  const reloaded = getDealCardReport(id);
  expect(reloaded.govDd.flood.zone).toBe('X');
  expect(reloaded.govDd.slope.status).toBe('verified');
});

it('auto-captures Google visuals once + reuses them, and persists Apify comps + metrics (items 1+2)', async () => {
  const id = createDealCard({ entity: 'TY_LAND_BIZ', title: 'enrich deal', leadType: 'test' }).id;
  const { card } = upsertCardFromDukeRun({ entity: 'TY_LAND_BIZ', activeInputAddress: '472 West Rd, Poulan, GA 31781', state: 'GA', verified: false, summary: 'x' });
  linkPropertyToDeal({ dealCardId: id, cardId: card.id, role: 'subject' });
  const resolveWithGeo = async (): Promise<LpResolveResult> => ({
    verified: true, status: 'verified', propertyid: '1', fips: '13321', apn: '00830-054-000',
    situs_address: '472 WEST RD', city: 'POULAN', state: 'GA', owner: 'CARROLL, MARGARET R', match_notes: 'ok', candidates: [],
    property_summary: { ...VERIFIED_SUMMARY, situs_address: '472 WEST RD', lat: '31.498296', lng: '-83.772086' },
  });
  let captureCalls = 0;
  const captureVisuals = async () => { captureCalls++; return { captured: true, reason: 'ok', assets: { maps_static: { storedPath: '/x.png', timestamp: 't' }, street_view_static: { storedPath: '/y.png', timestamp: 't' } } }; };
  const retrieveCompsImpl = async () => ({
    status: 'collected' as const, primaryProvider: 'realie' as const, providerChain: ['realie:collected'], soldCount: 2, activeCount: 0,
    sold: [{ price: 50000, saleDateIso: '2025-01-01', acres: 8, pricePerAcre: 6250, sourceUrl: '', sourceLabel: 'realie' }, { price: 70000, saleDateIso: '2025-02-01', acres: 10, pricePerAcre: 7000, sourceUrl: '', sourceLabel: 'realie' }],
    active: [], supplementalSold: [], valuation: [], metrics: { soldAvgPrice: 60000, soldAvgPpa: 6625, soldMedianPpa: 6625, ppaMin: 6250, ppaMax: 7000, activeAvgPrice: null, domMedian: null }, sparseExplanation: null,
    providers: [{ providerId: 'realie', status: 'connected', kept: 2 }], source: 'Realie premium comparables', timestamp: 't', note: '2 sold comps',
  });
  const femaFetch = async () => ({ ok: true, status: 200, json: async () => ({ features: [{ attributes: { FLD_ZONE: 'X', SFHA_TF: 'F' } }] }) });
  const nwiFetch = async () => ({ ok: true, status: 200, json: async () => ({ features: [] }) });
  const usgsFetch = async () => ({ ok: true, status: 200, json: async () => ({ value: '108.6' }) });
  const opts = { resolve: resolveWithGeo, timeoutMs: 1000, reverify: true, googleVisualConfigured: true, captureVisuals, retrieveCompsImpl, femaFetch, nwiFetch, usgsFetch };

  const r1 = (await runDealCardReport(id, opts))!.report;
  expect(r1.parcelVerified).toBe(true);
  expect(captureCalls).toBe(1);
  expect(r1.visualContext.assets.some((a) => a.status === 'captured')).toBe(true);
  expect(r1.marketComps.status).toBe('collected');
  expect(r1.marketComps.soldCount).toBe(2);
  expect(r1.marketComps.metrics.soldAvgPrice).toBe(60000);
  // persisted + reloads
  const reloaded = getDealCardReport(id);
  expect(reloaded.marketComps.soldCount).toBe(2);
  // reuse: a second run does NOT capture again
  await runDealCardReport(id, opts);
  expect(captureCalls).toBe(1);
});

it('separates Realie sold / Zillow active / Zillow supplemental sold; active never drives the band; persists + reloads', async () => {
  const id = createDealCard({ entity: 'TY_LAND_BIZ', title: 'comps sep', leadType: 'test' }).id;
  const { card } = upsertCardFromDukeRun({ entity: 'TY_LAND_BIZ', activeInputAddress: '472 West Rd, Poulan, GA 31781', state: 'GA', verified: false, summary: 'x' });
  linkPropertyToDeal({ dealCardId: id, cardId: card.id, role: 'subject' });
  const resolveWithGeo = async (): Promise<LpResolveResult> => ({
    verified: true, status: 'verified', propertyid: '1', fips: '13321', apn: 'A', situs_address: '472 WEST RD', city: 'POULAN', state: 'GA', owner: 'X', match_notes: 'ok', candidates: [],
    property_summary: { ...VERIFIED_SUMMARY, situs_address: '472 WEST RD', lat: '31.498296', lng: '-83.772086' },
  });
  // Realie sold (band drivers) + Zillow active (asking) + Zillow supplemental sold (home-centric, must NOT enter the band).
  const retrieveCompsImpl = async () => ({
    status: 'collected' as const, primaryProvider: 'realie' as const, providerChain: ['realie:collected', 'zillow:collected'], soldCount: 2, activeCount: 1,
    sold: [{ price: 50000, saleDateIso: '2025-01-01', acres: 8, pricePerAcre: 6250, sourceUrl: '', sourceLabel: 'realie' }, { price: 70000, saleDateIso: '2025-02-01', acres: 10, pricePerAcre: 7000, sourceUrl: '', sourceLabel: 'realie' }],
    active: [{ price: 999999, saleDateIso: '', acres: 0.1, pricePerAcre: 9999990, sourceUrl: 'https://zillow.com/x', sourceLabel: 'zillow', addressDesc: 'Poulan, GA' }],
    supplementalSold: [{ price: 800000, saleDateIso: '2025-03-01', acres: 0.2, pricePerAcre: 4000000, sourceUrl: 'https://zillow.com/y', sourceLabel: 'zillow' }],
    valuation: [], metrics: { soldAvgPrice: 60000, soldAvgPpa: 6625, soldMedianPpa: 6625, ppaMin: 6250, ppaMax: 7000, activeAvgPrice: 999999, domMedian: 14 }, sparseExplanation: null,
    providers: [{ providerId: 'realie', status: 'connected', kept: 2 }, { providerId: 'zillow', status: 'connected', kept: 2 }], source: 'Realie + Zillow', timestamp: 't', note: 'ok',
  });
  await runDealCardReport(id, { resolve: resolveWithGeo, timeoutMs: 1000, reverify: true, retrieveCompsImpl, femaFetch: async () => ({ ok: true, status: 200, json: async () => ({ features: [] }) }), nwiFetch: async () => ({ ok: true, status: 200, json: async () => ({ features: [] }) }), usgsFetch: async () => ({ ok: true, status: 200, json: async () => ({ value: '100' }) }) });
  // reload from persistence
  const r = getDealCardReport(id).marketComps;
  expect(r.sold.every((c) => c.sourceLabel === 'realie')).toBe(true);          // Realie sold separate
  expect(r.active.length).toBe(1); expect(r.active[0].sourceLabel).toBe('zillow'); // Zillow active separate
  expect(r.supplementalSold.length).toBe(1); expect(r.supplementalSold[0].sourceLabel).toBe('zillow'); // supplemental separate
  // band derived from Realie sold ONLY — the $9.99M/ac active + $4M/ac supplemental must not pollute it
  expect(r.metrics.ppaMax).toBe(7000);
  expect(r.providers.map((p) => p.providerId).sort()).toEqual(['realie', 'zillow']); // provider readiness
});

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

    // Land Score is computed INLINE from the same verified property data (never a
    // separate re-resolve) and persists through reload.
    expect(r.landScore).not.toBeNull();
    expect(r.landScore!.factors.length).toBeGreaterThan(0);
    expect(r.landScore!.maxScore).toBeGreaterThan(0);

    // Reload safety: the persisted report matches.
    const reloaded = getDealCardReport(id);
    expect(reloaded.exists).toBe(true);
    expect(reloaded.parcelVerified).toBe(true);
    expect(reloaded.reportStatus).toBe(r.reportStatus);
    expect(reloaded.landScore).not.toBeNull();
    expect(reloaded.landScore!.score).toBe(r.landScore!.score);
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

describe('Deal Card report — full DD fact checklist (mirrors Discovery Report)', () => {
  it('lists every standard DD field with Verified value+source or explicit Needs Verification', async () => {
    const id = newDeal();
    seedIdentity(id);
    const zonedResolve = async (): Promise<LpResolveResult> => ({
      verified: true, status: 'verified', propertyid: '999', fips: '37043', apn: '12-345-678',
      situs_address: '123 Main St', city: 'Sparta', state: 'NC', owner: 'GENERIC OWNER',
      match_notes: 'verified', source: 'Realie.ai', zoning: 'A-1', candidates: [],
      property_summary: { ...VERIFIED_SUMMARY, situs_address: '123 Main St' },
    });
    const r = (await runDealCardReport(id, { resolve: zonedResolve, timeoutMs: 1000 }))!.report;
    const byLabel = (l: string) => r.ddFactChecklist.find((x) => x.label === l)!;
    expect(r.ddFactChecklist.length).toBeGreaterThan(10);
    // acreage verified from property_summary (10 ac), source carried
    expect(byLabel('Acreage')).toMatchObject({ status: 'verified', source: 'Realie.ai' });
    expect(byLabel('Zoning')).toMatchObject({ status: 'verified', value: 'A-1' });
    // utilities have no connected source -> Needs Verification
    expect(byLabel('Power')).toMatchObject({ status: 'needs_verification', noConnectedSource: true });
  });

  it('marks the whole checklist Needs Verification when the parcel is not verified', async () => {
    const id = newDeal();
    seedIdentity(id);
    const r = (await runDealCardReport(id, { resolve: notVerifiedResolve, timeoutMs: 1000 }))!.report;
    expect(r.ddFactChecklist.length).toBeGreaterThan(10);
    expect(r.ddFactChecklist.every((x) => x.status === 'needs_verification')).toBe(true);
    expect(r.ddCompleteness.verified).toBe(0);
    expect(r.ddCompleteness.percentComplete).toBe(0);
  });

  it('reports DD completeness consistent with the checklist (verified count)', async () => {
    const id = newDeal();
    seedIdentity(id);
    const zonedResolve = async (): Promise<LpResolveResult> => ({
      verified: true, status: 'verified', propertyid: '999', fips: '37043', apn: '12-345-678',
      situs_address: '123 Main St', city: 'Sparta', state: 'NC', owner: 'GENERIC OWNER',
      match_notes: 'verified', source: 'Realie.ai', zoning: 'A-1', candidates: [],
      property_summary: { ...VERIFIED_SUMMARY, situs_address: '123 Main St' },
    });
    const r = (await runDealCardReport(id, { resolve: zonedResolve, timeoutMs: 1000 }))!.report;
    const verifiedCount = r.ddFactChecklist.filter((x) => x.status === 'verified').length;
    expect(r.ddCompleteness.verified).toBe(verifiedCount);
    expect(r.ddCompleteness.total).toBe(r.ddFactChecklist.length);
    expect(r.ddCompleteness.percentComplete).toBeGreaterThan(0);
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
