import { describe, it, expect } from 'vitest';
import { reconcileFacts, buildValuationHierarchy, buildCompState, selectBestComps, acreageFactFromBasis, type CompCandidate } from './deal-card-reconciliation.js';
import { buildAcreageBasis } from './acreage-basis.js';

describe('acreageFactFromBasis — reconciled facts consume the canonical basis (WS1 F2/F3 regression)', () => {
  it('surfaces the conflict for a 13% assessed-vs-mapped gap that the old 15% gate missed', () => {
    // 1.32 assessed vs 1.15 mapped = 12.9% — under the retired 15% threshold but a
    // real conflict under the shared 5%/0.1ac materiality.
    const basis = buildAcreageBasis({
      assessed: { value: 1.32, source: 'County assessor record' },
      gisGeometry: { value: 1.15, source: 'County GIS parcel geometry' },
    });
    const fact = acreageFactFromBasis(basis);
    expect(fact).not.toBeNull();
    expect(fact!.conflict).toBe(true);
    expect(fact!.status).toBe('needs_confirmation');
    // Both bases preserved; mapped (GIS) governs the spatial primary.
    expect(fact!.primary).toBe('1.15 ac');
    expect(fact!.alternates.some((a) => a.num === 1.32)).toBe(true);
    expect(fact!.conflictNote).toBeTruthy();
  });
  it('reports reconciled (no conflict) when bases agree', () => {
    const basis = buildAcreageBasis({ assessed: { value: 5.0 }, gisGeometry: { value: 5.02 } });
    const fact = acreageFactFromBasis(basis);
    expect(fact!.conflict).toBe(false);
    expect(fact!.status).toBe('reconciled');
  });
  it('returns null when there is no usable acreage basis', () => {
    expect(acreageFactFromBasis(buildAcreageBasis({}))).toBeNull();
  });
});

describe('reconcileFacts — official/provider outranks visual, conflicts surfaced', () => {
  it('acreage: LandPortal parcel (official) wins over provider + visual, and flags the provider conflict', () => {
    const r = reconcileFacts({
      factSheet: { acres: 17.93, access: { roadFrontageFt: 810 }, environment: { femaFloodZone: 'X', wetlandsPct: '0%' } },
      landFacts: { acres: 17.67, roadFrontageFt: 610 },
      visualObservations: [{ label: 'Frontage', detail: 'approximately 610 ft of road frontage; roughly 17.9 acres' }],
    });
    // Authoritative acreage is the official parcel record, not the provider or visual.
    expect(r.acreage.primary).toBe('17.93 ac');
    expect(r.acreage.primarySource).toBe('LandPortal parcel');
    // Provider disagreement (17.67 vs 17.93) is a real conflict, shown not dropped.
    expect(r.acreage.conflict).toBe(true);
    expect(r.acreage.conflictNote).toMatch(/17\.67/);
    expect(r.acreage.alternates.some((a) => a.value.includes('17.67'))).toBe(true);
  });

  it('road frontage: 610 vs 810 surfaced as a conflict with both sources', () => {
    const r = reconcileFacts({
      factSheet: { acres: 17.93, access: { roadFrontageFt: 810 } },
      landFacts: { roadFrontageFt: 610 },
    });
    expect(r.roadFrontage.primary).toBe('810 ft');
    expect(r.roadFrontage.conflict).toBe(true);
    expect(r.conflicts.some((c) => /frontage/i.test(c))).toBe(true);
  });

  it('visual observation is never promoted above an official fact (labeled signal only)', () => {
    const r = reconcileFacts({
      factSheet: { acres: 5.0 },
      visualObservations: [{ detail: 'about 12 acres visible' }],
    });
    expect(r.acreage.primary).toBe('5 ac');
    expect(r.acreage.primaryTier).toBe('official');
    // The differing visual read is retained as an alternate + soft note, not a hard conflict.
    expect(r.acreage.conflict).toBe(false);
    expect(r.acreage.alternates.some((a) => a.tier === 'visual')).toBe(true);
    expect(r.acreage.conflictNote).toMatch(/visual/i);
  });

  it('flood: live FEMA outranks the LandPortal snapshot zone', () => {
    const r = reconcileFacts({
      factSheet: { environment: { femaFloodZone: 'X' } },
      govDd: { flood: { status: 'live', zone: 'AE' } },
    });
    expect(r.flood.primary).toBe('AE');
    expect(r.flood.primarySource).toMatch(/FEMA/);
    expect(r.flood.conflict).toBe(true); // X vs AE is a categorical disagreement
  });

  it('no data → unknown, no fabrication', () => {
    const r = reconcileFacts({});
    expect(r.acreage.status).toBe('unknown');
    expect(r.acreage.primary).toBeNull();
    expect(r.conflicts).toEqual([]);
  });
});

describe('buildValuationHierarchy — one primary basis, sold outranks asking/county', () => {
  it('sold comps are the primary basis; LP estimate is supporting', () => {
    const v = buildValuationHierarchy({
      acres: 17.93,
      soldComps: { count: 4, medianPpa: 4400, ppaMin: 3500, ppaMax: 5200 },
      lpEstimate: { price: 82000, ppa: 4570 },
    });
    expect(v.primary?.kind).toBe('comp_sold');
    expect(v.supporting[0]?.kind).toBe('lp_estimate');
    expect(v.confidence).toBe('high'); // >= 3 sold comps
    expect(v.valueRange).toEqual({ low: Math.round(3500 * 17.93), high: Math.round(5200 * 17.93), basisId: 'comp_sold' });
  });

  it('detects the $79k vs $191k conflict and flips next action to tighten comps', () => {
    const v = buildValuationHierarchy({
      acres: 20,
      soldComps: { count: 2, medianPpa: 3950, ppaMin: 3000, ppaMax: 5000 }, // ~$79k
      lpEstimate: { price: 191000, ppa: 9550 },                              // ~$191k
    });
    expect(v.primary?.kind).toBe('comp_sold');
    expect(v.conflict).toBe(true);
    expect(v.conflictNote).toMatch(/Valuation conflict detected/);
    expect(v.nextAction).toMatch(/Tighten comps/);
    expect(v.confidence).not.toBe('high');
  });

  it('active/asking never outranks sold; county context is weakest', () => {
    const v = buildValuationHierarchy({
      acres: 10,
      activeComps: { count: 3, avgPpa: 6000 },
      soldComps: { count: 1, medianPpa: 4000, ppaMin: 4000, ppaMax: 4000 },
      countyContext: { ppa: 3000, note: 'countywide' },
    });
    expect(v.primary?.kind).toBe('comp_sold');
    expect(v.supporting.map((s) => s.kind)).toContain('comp_active_asking');
    expect(v.supporting[v.supporting.length - 1].kind).toBe('county_context');
  });

  it('asking-only lead: weak primary, low/medium confidence, no fabricated sold band', () => {
    const v = buildValuationHierarchy({ acres: 5, activeComps: { count: 2, avgPpa: 5000 } });
    expect(v.primary?.kind).toBe('comp_active_asking');
    expect(v.confidence).toBe('low');
  });
  it('keeps a one-sale indication out of the value range and offer path', () => {
    const v = buildValuationHierarchy({
      acres: 7.5,
      soldComps: { count: 1, medianPpa: 20_146, ppaMin: 20_146, ppaMax: 20_146 },
    });
    expect(v.primary?.kind).toBe('comp_sold');
    expect(v.confidence).toBe('low');
    expect(v.valueRange).toBeNull();
    expect(v.nextAction).toMatch(/Preliminary comp indication only/);
  });

});

describe('buildCompState — single object, Strategy agrees with Activity', () => {
  it('Redfin 8 + Zillow 2 retrieved → Strategy does not claim comps are missing', () => {
    const cs = buildCompState({
      status: 'collected',
      soldCount: 6,
      activeCount: 2,
      providerCounts: [{ provider: 'redfin', count: 8 }, { provider: 'zillow', count: 2 }],
      landportalComps: { status: 'retrieved', count: 6 },
    });
    expect(cs.anyRetrieved).toBe(true);
    expect(cs.summaryLine).toMatch(/Sold comps 6/);
    expect(cs.strategyLine).toMatch(/Sold comps retrieved/);
    expect(cs.strategyLine).not.toMatch(/missing/i);
    const zillow = cs.sources.find((s) => s.source === 'zillow')!;
    const redfin = cs.sources.find((s) => s.source === 'redfin')!;
    expect(zillow.status).toBe('retrieved');
    expect(redfin.count).toBe(8);
  });

  it('retrieved-but-no-sold: strategy asks to tighten sold band, not "run comps"', () => {
    const cs = buildCompState({
      status: 'collected',
      soldCount: 0,
      landportalComps: { status: 'retrieved', count: 4 },
    });
    expect(cs.anyRetrieved).toBe(true);
    expect(cs.strategyLine).toMatch(/no closed sold comps/i);
  });

  it('nothing run → honest not-run state', () => {
    const cs = buildCompState({ status: 'not_run' });
    expect(cs.anyRetrieved).toBe(false);
    expect(cs.summaryLine).toMatch(/not run/i);
    expect(cs.strategyLine).toMatch(/run comp research/i);
  });

  it('distinguishes sold vs active/asking vs visible LandPortal vs fallback', () => {
    const cs = buildCompState({ status: 'collected', soldCount: 3, activeCount: 5, valuationRowCount: 2, landportalComps: { status: 'retrieved', count: 1 } });
    expect(cs.soldCount).toBe(3);
    expect(cs.activeCount).toBe(5);
    expect(cs.landportalVisibleCount).toBe(1);
    expect(cs.fallbackCount).toBe(2);
    expect(cs.totalUsable).toBe(6); // sold + lp visible + fallback (NOT asking)
  });
});

describe('selectBestComps — the memo shortlist (best 3-5, not twenty)', () => {
  const iso = (monthsAgo: number) => new Date(Date.now() - monthsAgo * 30.4 * 86400000).toISOString().slice(0, 10);

  it('ranks a same-size recent sold comp above a stale, off-size active listing', () => {
    const cands: CompCandidate[] = [
      { price: 100000, pricePerAcre: 20000, acres: 5, saleDateIso: iso(2), sourceLabel: 'Realie', lane: 'sold' },
      { price: 400000, pricePerAcre: 8000, acres: 50, saleDateIso: iso(30), sourceLabel: 'zillow', lane: 'active' },
    ];
    const r = selectBestComps(5, cands);
    expect(r.comps[0].lane).toBe('sold');
    expect(r.comps[0].acres).toBe(5);
    expect(r.comps[0].confidence).toBe('high');
    expect(r.comps[0].why.toLowerCase()).toMatch(/closed sale|similar size|recent/);
  });

  it('caps the shortlist at five even when many comps exist', () => {
    const cands: CompCandidate[] = Array.from({ length: 12 }, (_, i) => ({
      price: 90000 + i * 1000, pricePerAcre: 18000, acres: 5 + i * 0.1, saleDateIso: iso(3 + i), sourceLabel: 'Realie', lane: 'sold' as const,
    }));
    const r = selectBestComps(5, cands);
    expect(r.comps.length).toBe(5);
    expect(r.consideredCount).toBe(12);
    expect(r.rationale).toMatch(/Top 5 of 12/);
  });

  it('drops improved/residential-class rows and price-less rows from the land shortlist', () => {
    const cands: CompCandidate[] = [
      { price: 250000, pricePerAcre: null, acres: 5, saleDateIso: iso(2), sourceLabel: 'Realie', compClass: 'residential', lane: 'sold' },
      { price: null, pricePerAcre: null, acres: 5, saleDateIso: iso(2), sourceLabel: 'Realie', lane: 'sold' },
      { price: 95000, pricePerAcre: 19000, acres: 5, saleDateIso: iso(2), sourceLabel: 'Realie', compClass: 'vacant_land', lane: 'sold' },
    ];
    const r = selectBestComps(5, cands);
    expect(r.comps.length).toBe(1);
    expect(r.consideredCount).toBe(1);
    expect(r.comps[0].pricePerAcre).toBe(19000);
  });

  it('rewards a known-close-distance comp and surfaces the mileage in the reason', () => {
    const cands: CompCandidate[] = [
      { price: 100000, pricePerAcre: 20000, acres: 5, saleDateIso: iso(4), sourceLabel: 'LandPortal visible', distanceMiles: 2.3, lane: 'landportal' },
      { price: 100000, pricePerAcre: 20000, acres: 5, saleDateIso: iso(4), sourceLabel: 'LandPortal visible', distanceMiles: 22, lane: 'landportal' },
    ];
    const r = selectBestComps(5, cands);
    expect(r.comps[0].distanceMiles).toBe(2.3);
    expect(r.comps[0].why).toMatch(/2\.3 mi away/);
    expect(r.rationale).toMatch(/distance/);
  });

  it('returns an empty, honest shortlist when nothing usable exists', () => {
    const r = selectBestComps(5, []);
    expect(r.comps).toEqual([]);
    expect(r.rationale).toMatch(/No usable comparables/i);
  });
});
