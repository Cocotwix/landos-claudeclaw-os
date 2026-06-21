import { describe, it, expect } from 'vitest';
import { runPropertyAnalysis, type PropertyAnalysisDeps, type ProviderCall } from './property-analysis.js';
import type { LpResolveResult, LpPropertySummary } from './landportal-client.js';
import type { CompProvider, RetrievedComp } from './comp-retrieval.js';

const POULAN = '472 West Rd, Poulan, GA 31781';
const NOW = '2026-06-21T00:00:00.000Z';

function summary(over: Partial<LpPropertySummary> = {}): LpPropertySummary {
  return {
    propertyid: 'PID-1', apn: 'APN-1', situs_address: '472 West Rd', city: 'Poulan', state: 'GA', zip: '31781',
    county: 'Worth', owner: 'OWNER ON RECORD', land_use: 'Vacant', lot_size_acres: '5', calc_acres: '5',
    lot_size_sqft: '217800', road_frontage_ft: '', land_locked: '', near_water: '', wetlands_pct: '',
    fema_pct: '', buildability_pct: '', buildability_acres: '', slope_avg_deg: '', elevation_avg_ft: '',
    building_area_sqft: '', assessed_total: '', assessed_land: '', market_total: '', market_land: '',
    tlp_estimate: '', tlp_ppa: '', price_acre_county: '', lat: '31.50', lng: '-83.78', municipality: '',
    mailing_address: '', mailing_city: '', mailing_state: '', similars_count: '0', similars_ppa_min: '',
    similars_ppa_max: '', similars_ppa_median: '', similars_most_recent_year: '', similar_sales: [],
    ...over,
  };
}

function verifiedResolve(): LpResolveResult {
  return {
    verified: true, status: 'verified', propertyid: 'PID-1', fips: '13321', apn: 'APN-1',
    situs_address: '472 West Rd', city: 'Poulan', state: 'GA', owner: 'OWNER ON RECORD',
    match_notes: 'Exact address match (v2).', property_summary: summary(), candidates: [],
  };
}

function ambiguousResolve(): LpResolveResult {
  return {
    verified: false, status: 'ambiguous_fips', propertyid: null, fips: null, apn: null,
    situs_address: null, owner: null, match_notes: 'needs county/FIPS', candidates: [],
  };
}

/** A fake redfin provider returning given sold comps (price = historical sold). */
function fakeRedfin(comps: RetrievedComp[]): CompProvider {
  return {
    id: 'redfin', label: 'Redfin', supportsAddress: true, supportsApnOnly: false,
    async retrieve() { return { providerId: 'redfin', status: 'connected', comps, needsVerification: [], note: `${comps.length} comp(s)` }; },
  };
}

const SOLD_COMPS: RetrievedComp[] = [
  { price: 240_000, saleDateIso: '2026-03-01T00:00:00.000Z', acres: 5, pricePerAcre: 48_000, sourceUrl: 'https://www.redfin.com/GA/a', sourceLabel: 'redfin' },
  { price: 260_000, saleDateIso: '2026-04-01T00:00:00.000Z', acres: 5, pricePerAcre: 52_000, sourceUrl: 'https://www.redfin.com/GA/b', sourceLabel: 'redfin' },
];

function baseDeps(over: Partial<PropertyAnalysisDeps> = {}): PropertyAnalysisDeps {
  return {
    nowIso: NOW,
    apiVersion: () => 'v2',
    resolve: async () => verifiedResolve(),
    compsReadiness: async () => ({ capability: 'comps', ready: true, missing: [], reason: 'ready', usesStub: false }),
    buildCompRegistry: async (onSpend) => {
      onSpend({ source: 'Apify tri_angle/redfin-search', kind: 'search', rows: 3, spendUsd: 0 });
      onSpend({ source: 'Apify tri_angle/redfin-detail', kind: 'detail', rows: 2, spendUsd: 0 });
      return { registry: [fakeRedfin(SOLD_COMPS)], compsLive: true, reason: 'live' };
    },
    logCost: () => {},
    ...over,
  };
}

describe('runPropertyAnalysis — verified happy path', () => {
  it('verifies via v2, runs comps after readiness, derives EV from sold comps, upserts a Deal Card', async () => {
    let upserted = false;
    const r = await runPropertyAnalysis(POULAN, { entity: 'TY_LAND_BIZ' }, baseDeps({
      upsertDealCard: () => { upserted = true; return { dealCardId: 7, propertyCardId: 3 }; },
    }));
    expect(r.verified).toBe('Verified');
    expect(r.parcelVerification.lpApiVersion).toBe('v2');
    expect(r.ddFacts).not.toBeNull();
    expect(r.redfinComps.ran).toBe(true);
    expect(r.redfinComps.comps).toHaveLength(2);
    // EV from MEDIAN sold $/acre x acres (50,000 x 5), not list/AVM.
    expect(r.underwriting.expectedValueUsd).toBe(250_000);
    expect(r.underwriting.evBasis).toMatch(/sold \$\/acre/);
    expect(r.strategyMatrix.length).toBeGreaterThan(0);
    expect(upserted).toBe(true);
    expect(r.dealCard.created).toBe(true);
    expect(r.statuses).toContain('Complete');
  });

  it('uses the historical sold price, never list/AVM (EV reflects sold comps)', async () => {
    const r = await runPropertyAnalysis(POULAN, {}, baseDeps());
    // Sold comps drive EV; there is no list/AVM substitution anywhere in the chain.
    expect(r.underwriting.expectedValueUsd).toBe(250_000);
  });
});

describe('runPropertyAnalysis — unverified parcel', () => {
  it('produces Local Area Context, runs NO comps, creates NO verified Deal Card, blocks offer', async () => {
    let upserted = false;
    const r = await runPropertyAnalysis(POULAN, { entity: 'TY_LAND_BIZ' }, baseDeps({
      resolve: async () => ambiguousResolve(),
      upsertDealCard: () => { upserted = true; return { dealCardId: 1, propertyCardId: 1 }; },
    }));
    expect(r.verified).toBe('Not Verified');
    expect(r.parcelVerification.status).toMatch(/local_area_context|unverified/);
    expect(r.redfinComps.ran).toBe(false);
    expect(r.providerCalls.filter((c) => /Apify/.test(c.source))).toHaveLength(0); // comps never ran
    expect(upserted).toBe(false);
    expect(r.dealCard.created).toBe(false);
    expect(r.offerReadiness).toBe('Blocked');
    expect(r.statuses).toContain('Parcel identity not verified');
  });

  it('comps do NOT run before verified identity (no comp provider calls, $0)', async () => {
    const calls: ProviderCall[] = [];
    const r = await runPropertyAnalysis(POULAN, {}, baseDeps({
      resolve: async () => ambiguousResolve(),
      buildCompRegistry: async (onSpend) => { onSpend({ source: 'Apify', kind: 'search', rows: 1, spendUsd: 1 }); return { registry: [fakeRedfin(SOLD_COMPS)], compsLive: true, reason: 'x' }; },
      logCost: (o) => calls.push({ source: o.category, kind: 'log', rows: 0, spendUsd: o.amountUsd }),
    }));
    expect(r.redfinComps.ran).toBe(false);
    expect(r.actualSpendUsd).toBe(0);
    // buildCompRegistry must not have been invoked at all (no apify cost logged).
    expect(calls.some((c) => c.source === 'apify_comp_actor')).toBe(false);
  });
});

describe('runPropertyAnalysis — Live Comps readiness failure', () => {
  it('verified but not ready -> zero comp provider calls and $0 spend', async () => {
    const r = await runPropertyAnalysis(POULAN, {}, baseDeps({
      compsReadiness: async () => ({ capability: 'comps', ready: false, missing: ['APIFY_TOKEN'], reason: 'comp retrieval DISABLED: missing APIFY_TOKEN', usesStub: true }),
    }));
    expect(r.verified).toBe('Verified');
    expect(r.redfinComps.ran).toBe(false);
    expect(r.redfinComps.terminalState).toBe('Live Comps not ready');
    expect(r.providerCalls.filter((c) => /Apify/.test(c.source))).toHaveLength(0);
    expect(r.actualSpendUsd).toBe(0);
  });
});

describe('runPropertyAnalysis — strategy/underwriting gating', () => {
  it('verified but no usable comps and no TLP -> Valuation not ready, offer Blocked, no strategy matrix', async () => {
    const r = await runPropertyAnalysis(POULAN, {}, baseDeps({
      buildCompRegistry: async () => ({ registry: [fakeRedfin([])], compsLive: true, reason: 'live' }),
    }));
    expect(r.verified).toBe('Verified');
    expect(r.underwriting.expectedValueUsd).toBeNull();
    expect(r.offerReadiness).toBe('Blocked');
    expect(r.strategyMatrix).toHaveLength(0);
    expect(r.statuses).toContain('Valuation not ready');
    expect(r.redfinComps.terminalState).toBe('No usable comps returned');
  });
});

describe('runPropertyAnalysis — honesty + safety invariants', () => {
  it('parcel identity uses named-source fields, never coordinates', async () => {
    const r = await runPropertyAnalysis(POULAN, {}, baseDeps());
    expect(r.parcelVerification.identity?.apn).toBe('APN-1');
    const idJson = JSON.stringify(r.parcelVerification.identity);
    expect(idJson).not.toMatch(/"lat"|"lng"|latitude|longitude/);
  });

  it('Market Pulse signals each carry source/timestamp/confidence and label unavailable honestly', async () => {
    const r = await runPropertyAnalysis(POULAN, {}, baseDeps());
    const mkRows = r.sourceTable.filter((s) => s.category.startsWith('market:'));
    expect(mkRows.length).toBeGreaterThan(0);
    for (const row of mkRows) {
      expect(row.timestamp).toBeTruthy();
      expect(['reported', 'unavailable']).toContain(row.confidence);
    }
    // At least one category is honestly unavailable (no fabricated market numbers).
    expect(mkRows.some((row) => row.confidence === 'unavailable')).toBe(true);
  });

  it('no secret/token-like values appear in the structured result', async () => {
    const r = await runPropertyAnalysis(POULAN, {}, baseDeps());
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/Bearer\s|authorization|APIFY_TOKEN|LP_JWT_TOKEN|DASHBOARD_TOKEN/i);
  });

  it('honors the provider-call ceiling defensively', async () => {
    const r = await runPropertyAnalysis(POULAN, {}, baseDeps({
      buildCompRegistry: async (onSpend) => {
        for (let i = 0; i < 40; i++) onSpend({ source: 'Apify', kind: 'search', rows: 0, spendUsd: 0 });
        return { registry: [fakeRedfin(SOLD_COMPS)], compsLive: true, reason: 'x' };
      },
    }));
    // Ceiling tripped -> comps lane aborted honestly, no fabricated comps.
    expect(r.redfinComps.comps).toHaveLength(0);
  });
});
