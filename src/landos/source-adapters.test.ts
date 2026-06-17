// Sprint 6A tests: On-Demand Land Data Source Adapter Registry + Market Pulse.
// Pure + deterministic. No DB, no network, no LandPortal/comp calls, no paid
// API, no secrets, no installs, no third-party code.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

import {
  SOURCE_ADAPTERS,
  SOURCE_ADAPTER_IDS,
  ON_DEMAND_SCOPES,
  FORBIDDEN_BULK_SCOPES,
  MARKET_PULSE_SIGNALS,
  OPEN_SOURCE_CANDIDATES,
  getAdapter,
  isOnDemandScope,
  adaptersAreOnDemandOnly,
  buildFallbackLadder,
  landportalFailureFallbackPlan,
  planParcelLookup,
  evaluateGisCutoff,
  gisCutoffRule,
  extractAreaSignals,
  buildLocalAreaContext,
  marketPulseEligibility,
  buildSellerAskContext,
  thirdPartySecuritySummary,
  canInstallOrExecuteCandidate,
  buildSourceAdapterPlan,
} from './source-adapters.js';
import { planLandosIntake } from './intake-planner.js';
import type { LandOSIntake } from './intake-types.js';

const REQUIRED_ADAPTERS = [
  'landportal_exact',
  'county_assessor_exact',
  'county_property_record_exact',
  'county_gis_exact_bounded',
  'exact_public_web_search',
  'socrata_open_data',
  'census_growth',
  'planning_zoning_signal',
  'market_listings_solds',
];

describe('adapter registry', () => {
  it('includes every required adapter', () => {
    for (const id of REQUIRED_ADAPTERS) {
      expect(SOURCE_ADAPTER_IDS.includes(id as never), `missing adapter ${id}`).toBe(true);
      expect(getAdapter(id as never), `getAdapter(${id})`).toBeDefined();
    }
  });

  it('exposes LandPortal first in the parcel fallback ladder', () => {
    const ladder = buildFallbackLadder();
    expect(ladder[0].id).toBe('landportal_exact');
    // assessor/record exact come before GIS; GIS is the last bounded resort.
    const ids = ladder.map((a) => a.id);
    expect(ids.indexOf('county_assessor_exact')).toBeLessThan(ids.indexOf('county_gis_exact_bounded'));
    expect(ids.indexOf('county_property_record_exact')).toBeLessThan(ids.indexOf('county_gis_exact_bounded'));
    expect(ids[ids.length - 1]).toBe('exact_public_web_search');
  });
});

describe('on-demand scope only (not a bulk warehouse/scraper)', () => {
  it('every adapter is on-demand scoped and declares no bulk dataset', () => {
    expect(adaptersAreOnDemandOnly()).toBe(true);
    for (const a of SOURCE_ADAPTERS) {
      expect(a.capability.bulkDataset).toBe(false);
      expect(a.scope.length).toBeGreaterThan(0);
      for (const s of a.scope) expect(isOnDemandScope(s)).toBe(true);
    }
  });

  it('forbidden bulk scopes are not valid on-demand scopes', () => {
    for (const bad of FORBIDDEN_BULK_SCOPES) {
      expect(isOnDemandScope(bad)).toBe(false);
      expect((ON_DEMAND_SCOPES as readonly string[]).includes(bad)).toBe(false);
    }
  });

  it('no adapter uses coordinates for identity or a paid API', () => {
    for (const a of SOURCE_ADAPTERS) {
      expect(a.capability.usesCoordinatesForIdentity).toBe(false);
      expect(a.capability.usesPaidApi).toBe(false);
    }
  });
});

describe('LandPortal failure fallback (bounded, not broad GIS)', () => {
  it('falls back to official assessor/record exact search before any GIS', () => {
    const plan = landportalFailureFallbackPlan();
    expect(plan[0].adapterId).toBe('county_assessor_exact');
    const order = plan.map((p) => p.adapterId);
    expect(order).not.toContain('landportal_exact');
    expect(order.indexOf('county_assessor_exact')).toBeLessThan(order.indexOf('county_gis_exact_bounded'));
    // GIS is bounded + last-resort, never a broad scrape.
    const gis = plan.find((p) => p.adapterId === 'county_gis_exact_bounded')!;
    expect(gis.reason.toLowerCase()).toContain('bounded');
  });

  it('read-only plan never returns a verified attempt', () => {
    const result = planParcelLookup({ scope: 'current_subject_property', text: '123 Oak Rd, Lexington County SC' });
    expect(result.parcelVerified).toBe(false);
    for (const a of result.ladder) expect(a.status).not.toBe('verified' as never);
  });
});

describe('GIS cutoff -> data gap', () => {
  it('login/profile/account/layer/coordinate/ambiguity all cut off to a data gap', () => {
    for (const cond of [
      { requiresLogin: true },
      { requiresProfile: true },
      { requiresAccountCreation: true },
      { manualMapHunting: true },
      { layerToggling: true },
      { coordinateOrProximitySearch: true },
      { ambiguousResults: true },
      { multipleParcels: true },
      { unsupportedSearch: true },
      { exceededTimeout: true },
    ]) {
      const r = evaluateGisCutoff(cond);
      expect(r.cutoff, JSON.stringify(cond)).toBe(true);
      expect(r.outcome).toBe('data_gap');
      expect(r.triggered.length).toBeGreaterThan(0);
    }
  });

  it('a quick direct exact GIS search with an obvious match does not cut off', () => {
    const r = evaluateGisCutoff({});
    expect(r.cutoff).toBe(false);
    expect(r.outcome).toBe('continue');
  });

  it('the cutoff rule prefers assessor/record pages over interactive GIS maps', () => {
    expect(gisCutoffRule().toLowerCase()).toContain('assessor');
    expect(gisCutoffRule().toLowerCase()).toContain('preferred');
  });
});

describe('Market Pulse eligibility (separate from parcel verification)', () => {
  it('city + state is eligible even when the parcel is unverified', () => {
    const mp = marketPulseEligibility(extractAreaSignals('vacant land near Cottageville, SC'));
    expect(mp.eligible).toBe(true);
    expect(mp.separateFromParcelVerification).toBe(true);
    expect(mp.localAreaContextLabel).toBe('Local Area Context, Not Parcel Verified');
  });

  it('county + state is eligible', () => {
    const mp = marketPulseEligibility(extractAreaSignals('what is land doing in Colleton County, SC'));
    expect(mp.eligible).toBe(true);
  });

  it('no city/county + state is not eligible and never invents data', () => {
    const mp = marketPulseEligibility(extractAreaSignals('what should we do with this?'));
    expect(mp.eligible).toBe(false);
    expect(mp.status).toBe('not_available');
  });

  it('is not_connected (honest) when eligible but no approved adapter is wired', () => {
    const mp = marketPulseEligibility({ city: 'Lexington', state: 'SC' });
    expect(mp.status).toBe('not_connected');
    // The signal catalog is declared so future data can flow into strategy/underwriting.
    expect(mp.signalsCatalog).toEqual([...MARKET_PULSE_SIGNALS]);
  });

  it('local area context is allowed without parcel verification', () => {
    const ctx = buildLocalAreaContext({ county: 'Colleton', state: 'SC' });
    expect(ctx.hasCountyState).toBe(true);
    expect(ctx.label).toBe('local_area_context_not_parcel_verified');
  });
});

describe('seller ask is negotiation context, never a valuation basis', () => {
  it('seller ask is labeled seller_stated and cannot drive the offer range', () => {
    const s = buildSellerAskContext(50000);
    expect(s.label).toBe('seller_stated');
    expect(s.usableForOfferRange).toBe(false);
    expect(s.sellerAskUsd).toBe(50000);
    expect(s.note.toLowerCase()).toContain('never anchored to the seller ask');
  });

  it('omits the amount cleanly when none is provided but keeps the rule', () => {
    const s = buildSellerAskContext();
    expect(s.sellerAskUsd).toBeUndefined();
    expect(s.usableForOfferRange).toBe(false);
  });
});

describe('open-source / third-party security (report-only)', () => {
  it('no third-party code is installed, executed, imported, or vendored', () => {
    const t = thirdPartySecuritySummary();
    expect(t.thirdPartyCodeInstalled).toBe(false);
    expect(t.thirdPartyCodeExecuted).toBe(false);
    expect(t.thirdPartyCodeImportedOrVendored).toBe(false);
    expect(t.requiresTylerApprovalAndSecurityReview).toBe(true);
  });

  it('candidates are report-only and require a full security review', () => {
    expect(OPEN_SOURCE_CANDIDATES.length).toBeGreaterThan(0);
    for (const c of OPEN_SOURCE_CANDIDATES) {
      expect(c.installed).toBe(false);
      expect(c.executed).toBe(false);
      expect(c.candidateOnly).toBe(true);
      expect(c.requiresSecurityReview).toBe(true);
    }
    const t = thirdPartySecuritySummary();
    for (const item of ['maintainer_reputation', 'license', 'dependency_tree', 'install_scripts_postinstall_hooks', 'malware_supply_chain_risk']) {
      expect(t.securityReviewItems).toContain(item);
    }
  });

  it('a candidate can never be installed/executed from code, even if approval is claimed', () => {
    expect(canInstallOrExecuteCandidate(OPEN_SOURCE_CANDIDATES[0], true)).toBe(false);
    expect(canInstallOrExecuteCandidate(OPEN_SOURCE_CANDIDATES[0], false)).toBe(false);
  });
});

describe('intake planner integration', () => {
  function intake(text: string, over: Partial<LandOSIntake> = {}): LandOSIntake {
    return { transport: 'dashboard_text', text, ...over };
  }

  it('attaches the source-adapter plan with on-demand scope and the ladder', () => {
    const p = planLandosIntake(intake('APN: 051-012-05, Colleton County, SC'));
    expect(p.sourceAdapter.onDemandScope.bulkDatasetsForbidden).toBe(true);
    expect(p.sourceAdapter.parcelFallbackLadder[0].adapterId).toBe('landportal_exact');
    expect(p.sourceAdapter.thirdPartySecurity.thirdPartyCodeInstalled).toBe(false);
  });

  it('county + state makes Market Pulse eligible while Strategy/Underwriting stay blocked (unverified parcel)', () => {
    const p = planLandosIntake(intake('1234 Filter Plant Rd, Cottageville, SC'));
    expect(p.sourceAdapter.marketPulse.eligible).toBe(true);
    expect(p.sourceAdapter.parcelVerification.parcelVerified).toBe(false);
    // The hard gate from earlier sprints is preserved.
    expect(p.strategy.status).toBe('blocked');
    expect(p.underwriting.status).toBe('blocked');
  });

  it('shows the Local Area Context, Not Parcel Verified label when area is known but parcel is not', () => {
    const p = planLandosIntake(intake('what is land worth around Lexington, SC'));
    expect(p.sourceAdapter.marketPulse.localAreaContextLabel).toBe('Local Area Context, Not Parcel Verified');
  });

  it('seller ask in the plan is seller_stated and not offer-range usable', () => {
    const p = planLandosIntake(intake('APN: 051-012-05, Colleton County, SC'));
    expect(p.sourceAdapter.sellerAsk.label).toBe('seller_stated');
    expect(p.sourceAdapter.sellerAsk.usableForOfferRange).toBe(false);
  });
});

describe('no banned identity-source language in the contract', () => {
  const SRC = fs.readFileSync(fileURLToPath(new URL('./source-adapters.ts', import.meta.url)), 'utf-8');

  it('uses no coordinate/proximity/visual parcel-identity language', () => {
    // Identity must never come from these. (The GIS cutoff may say it STOPS on
    // coordinate/proximity search; these exact identity-source phrases must not
    // appear as a way to identify a parcel.)
    for (const banned of ['geocoder', 'geocode', 'street view', 'satellite', 'map pin', 'nearest parcel', 'road midpoint', 'centroid', 'proximity match', 'zip centroid', 'town centroid']) {
      expect(SRC.toLowerCase().includes(banned), `contract should not contain "${banned}"`).toBe(false);
    }
  });

  it('never calls a paid LandPortal comp tool', () => {
    expect(/lp_comp_report_create\s*\(/.test(SRC)).toBe(false);
    expect(/lp_comp_report_get\s*\(/.test(SRC)).toBe(false);
  });

  it('the composed plan carries no fabricated coordinate pair', () => {
    const p = buildSourceAdapterPlan({ text: '1234 Filter Plant Rd, Cottageville, SC', hasParcelIdentity: true, parcelVerified: false });
    const blob = JSON.stringify(p).toLowerCase();
    expect(/-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+/.test(blob)).toBe(false);
    for (const banned of ['geocode', 'map pin', 'satellite', 'street view']) {
      expect(blob.includes(banned)).toBe(false);
    }
  });
});
