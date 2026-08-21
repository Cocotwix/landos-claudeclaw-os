// Geography as VALUATION discipline, exercised through the real projection.
//
// The question these tests hold down is not "can LandOS measure a distance" —
// `comp-geography.test.ts` covers that. It is whether the surface the operator
// reads actually distinguishes local subject-market evidence from broader
// county / premium-submarket context, expands outward only when it has to, and
// never loses a candidate on the way.

import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { upsertPropertyCard } from './property-card.js';
import { addComp } from './comps.js';
import { buildCompsValuationView } from './comps-valuation.js';

/** The subject: 75.91 acres in Fairview TN 37062, with a retained centroid. */
const SUBJECT = { lat: 35.9764228598698, lng: -87.1180051138148 };

function fairviewDeal(): number {
  const cardId = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: 'Map 042 Parcel 123',
    apn: '042-123.00-000',
    county: 'Williamson', state: 'TN', city: 'Fairview', zip: '37062',
    acres: 75.91, lat: SUBJECT.lat, lng: SUBJECT.lng,
  }).card.id;
  const dealId = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Fairview' }).id;
  linkPropertyToDeal({ dealCardId: dealId, cardId });
  return dealId;
}

/** A closed vacant-land sale inside the subject's acreage band and window. */
function sale(dealId: number, opts: {
  address: string;
  price: number;
  acres?: number;
  lat?: number | null;
  lng?: number | null;
  precision?: 'exact' | 'approximate';
  dateIso?: string;
}) {
  return addComp({
    entity: 'TY_LAND_BIZ', dealCardId: dealId, sourceLabel: 'LandWatch',
    addressDesc: opts.address, county: 'Williamson', state: 'TN',
    price: opts.price, priceKind: 'sale',
    saleOrListDate: opts.dateIso ?? '2026-02-02',
    acres: opts.acres ?? 70,
    propertyClass: 'vacant_land',
    ...(opts.lat != null && opts.lng != null ? { lat: opts.lat, lng: opts.lng } : {}),
  });
}

/** Mark a persisted row's geographic precision the way the lane would. */
function markPrecision(compId: number, precision: 'exact' | 'approximate'): void {
  getLandosDb().prepare('UPDATE landos_comp SET geo_precision = ? WHERE id = ?').run(precision, compId);
}

// Points chosen so their real haversine distance from the subject lands each
// record in a known tier. Nothing here is a Fairview-specific rule; the same
// distances would tier the same way for any subject.
const NEAR_FAIRVIEW = [
  { lat: 36.0118446, lng: -87.0899963 },   // ~2.9 mi, same ZIP submarket
  { lat: 35.9479179, lng: -87.1509323 },   // ~2.7 mi, same ZIP submarket
  { lat: 35.9926258, lng: -87.1336720 },   // ~1.4 mi, same ZIP submarket
];
const FRANKLIN_EXACT = { lat: 35.8502569, lng: -87.1418965 };  // ~8.8 mi, different submarket
const COLLEGE_GROVE_CENTROID = { lat: 35.7799405, lng: -86.7158575 }; // ~26 mi

beforeEach(() => { _initTestLandosDb(); });

describe('geographic discipline over the strict valuation set', () => {
  it('prices the subject on local evidence alone when local evidence is sufficient', () => {
    const dealId = fairviewDeal();
    NEAR_FAIRVIEW.forEach((point, index) => {
      sale(dealId, { address: `${100 + index} Local Rd, Fairview, TN, 37062`, price: 900_000, ...point });
    });
    sale(dealId, { address: '5929 North Lick Creek Road, Franklin, TN, 37064', price: 3_950_000, acres: 93.9, ...FRANKLIN_EXACT });
    const collegeGrove = sale(dealId, { address: '0 Giles Hill Rd, College Grove, TN, 37046', price: 3_250_000, acres: 34, ...COLLEGE_GROVE_CENTROID });
    markPrecision(collegeGrove.id, 'approximate');

    const view = buildCompsValuationView(dealId);
    expect(view).not.toBeNull();
    const geography = view!.geography.selection;

    expect(geography.tiersIncluded).toEqual(['local']);
    expect(geography.reliesOnBroaderGeography).toBe(false);
    expect(geography.compositionLabel).toContain('3 local');
    expect(view!.cleaned.geography?.disclosure).toContain('no geographic expansion was needed');

    // The Franklin and College Grove sales are NOT deleted — they stay retained
    // with their geography named, carrying no strict FMV weight.
    const franklin = view!.comps.find((c) => c.address?.includes('Lick Creek'));
    const grove = view!.comps.find((c) => c.address?.includes('Giles Hill'));
    expect(franklin?.inValuationSet).toBe(false);
    expect(franklin?.geography.tier).toBe('expanded');
    expect(grove?.inValuationSet).toBe(false);
    expect(grove?.geography.tier).toBe('broader');
    expect(grove?.zeroWeightReason).toContain('retained market context');
    expect(view!.comps).toHaveLength(5);
  });

  it('expands outward, and says so, only when the closer tier cannot price the subject', () => {
    const dealId = fairviewDeal();
    sale(dealId, { address: '100 Local Rd, Fairview, TN, 37062', price: 900_000, ...NEAR_FAIRVIEW[0] });
    sale(dealId, { address: '5929 North Lick Creek Road, Franklin, TN, 37064', price: 3_950_000, acres: 93.9, ...FRANKLIN_EXACT });
    sale(dealId, { address: 'Oscar Green Road, Franklin, TN, 37064', price: 4_500_000, acres: 84.83, lat: 35.8600000, lng: -87.1500000 });

    const view = buildCompsValuationView(dealId);
    const geography = view!.geography.selection;

    expect(geography.tiersIncluded).toEqual(['local', 'expanded']);
    expect(geography.expandedBeyondLocal).toBe(true);
    expect(geography.reliesOnBroaderGeography).toBe(false);
    expect(geography.disclosure).toContain('below the 3 needed');
    expect(view!.comps.filter((c) => c.inValuationSet)).toHaveLength(3);
  });

  it('admits broader-market geography only as a last resort, discloses it, and reduces confidence', () => {
    const dealId = fairviewDeal();
    // Two College Grove / premium-submarket sales and nothing local at all.
    const a = sale(dealId, { address: '0 Giles Hill Rd, College Grove, TN, 37046', price: 3_250_000, acres: 34, ...COLLEGE_GROVE_CENTROID });
    const b = sale(dealId, { address: '0 Cross Keys Rd, College Grove, TN, 37046', price: 2_100_000, acres: 78, lat: 35.7810000, lng: -86.7200000 });
    markPrecision(a.id, 'approximate');
    markPrecision(b.id, 'approximate');

    const view = buildCompsValuationView(dealId);
    const geography = view!.geography.selection;

    expect(geography.tiersIncluded).toContain('broader');
    expect(geography.reliesOnBroaderGeography).toBe(true);
    expect(view!.cleaned.confidence).toBe('low');
    expect(view!.cleaned.reconciliationLines.join(' ')).toContain('relies materially on geography outside');
    // The value is still stated — a thin local market is not an empty market.
    expect(view!.cleaned.adoptedFmv).not.toBeNull();
  });

  it('never lets a location-unresolved sale act like a local comp while resolved evidence exists', () => {
    const dealId = fairviewDeal();
    NEAR_FAIRVIEW.forEach((point, index) => {
      sale(dealId, { address: `${200 + index} Local Rd, Fairview, TN, 37062`, price: 900_000, ...point });
    });
    sale(dealId, { address: 'Somewhere With No Locality', price: 6_000_000 });

    const view = buildCompsValuationView(dealId);
    const unplaced = view!.comps.find((c) => c.address === 'Somewhere With No Locality');

    expect(unplaced).toBeDefined();
    expect(unplaced!.geography.tier).toBe('unresolved');
    expect(unplaced!.distanceMiles).toBeNull();
    expect(unplaced!.inValuationSet).toBe(false);
    expect(unplaced!.valuationRole).toBe('geographic_context');
    expect(view!.geography.selection.admitted.unresolved).toBe(0);
  });

  it('does not treat same-county membership as local comparability', () => {
    const dealId = fairviewDeal();
    sale(dealId, { address: '0 Giles Hill Rd, College Grove, TN, 37046', price: 3_250_000, acres: 34, ...COLLEGE_GROVE_CENTROID });

    const view = buildCompsValuationView(dealId);
    const grove = view!.comps.find((c) => c.address?.includes('Giles Hill'));

    expect(grove?.county).toBe('Williamson');
    expect(grove?.geography.sameCounty).toBe(true);
    expect(grove?.geography.tier).toBe('broader');
    expect(grove?.geography.tierReason).toContain('not local comparability');
  });

  it('keeps the retained candidate universe intact whatever geography decides', () => {
    const dealId = fairviewDeal();
    sale(dealId, { address: '100 Local Rd, Fairview, TN, 37062', price: 900_000, ...NEAR_FAIRVIEW[0] });
    sale(dealId, { address: '0 Giles Hill Rd, College Grove, TN, 37046', price: 3_250_000, acres: 34, ...COLLEGE_GROVE_CENTROID });
    sale(dealId, { address: 'Somewhere With No Locality', price: 6_000_000 });

    const view = buildCompsValuationView(dealId);
    expect(view!.comps).toHaveLength(3);
    expect(view!.canonicalCompCount).toBe(3);
    // Every record carries a geography, resolved or honestly unresolved.
    expect(view!.comps.every((c) => !!c.geography.tierLabel)).toBe(true);
    const tiers = view!.geography.retainedByTier;
    expect(tiers.local + tiers.expanded + tiers.broader + tiers.unresolved).toBe(3);
  });

  it('carries geography through a fresh projection read, unchanged', () => {
    const dealId = fairviewDeal();
    sale(dealId, { address: '5929 North Lick Creek Road, Franklin, TN, 37064', price: 3_950_000, acres: 93.9, ...FRANKLIN_EXACT });

    const first = buildCompsValuationView(dealId)!.comps[0].geography;
    const second = buildCompsValuationView(dealId)!.comps[0].geography;
    expect(second).toEqual(first);
    expect(second.city).toBe('Franklin');
    expect(second.cardLine).toContain('Expanded market');
  });
});
