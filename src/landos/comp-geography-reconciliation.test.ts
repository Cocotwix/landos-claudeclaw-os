import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { upsertPropertyCard } from './property-card.js';
import { addComp, listComps } from './comps.js';
import { reconcileCompGeography } from './comp-geography-reconciliation.js';
import { buildCompsValuationView } from './comps-valuation.js';

/** Subject: a 75.91-acre Fairview TN parcel with a retained centroid. */
function fairviewDeal(): number {
  const cardId = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: 'Map 042 Parcel 123',
    apn: '042-123.00-000',
    county: 'Williamson', state: 'TN', city: 'Fairview', zip: '37062',
    acres: 75.91, lat: 35.9764228598698, lng: -87.1180051138148,
  }).card.id;
  const dealId = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Fairview' }).id;
  linkPropertyToDeal({ dealCardId: dealId, cardId });
  return dealId;
}

/**
 * The public ZCTA centroid service, stubbed. The lane must reach the real
 * service only through this seam, so a test never touches the network.
 */
const ZCTA: Record<string, { lat: number; lng: number }> = {
  '37064': { lat: 35.8896832, lng: -86.9610964 },   // Franklin
  '37046': { lat: 35.7799405, lng: -86.7158575 },   // College Grove
  '37062': { lat: 35.9883192, lng: -87.1348241 },   // Fairview (the subject's own)
};

const stubFetch = (calls: string[] = []) => async (url: string) => {
  calls.push(url);
  const code = decodeURIComponent(url).match(/GEOID='(\d{5})'/)?.[1] ?? '';
  const hit = ZCTA[code];
  return {
    ok: true,
    status: 200,
    json: async () => ({
      features: hit ? [{ attributes: { GEOID: code, CENTLAT: `+${hit.lat}`, CENTLON: `-${Math.abs(hit.lng)}` } }] : [],
    }),
  };
};

beforeEach(() => { _initTestLandosDb(); });

describe('reconcileCompGeography', () => {
  it('keeps retained coordinates and measures the distance they already support', async () => {
    const dealId = fairviewDeal();
    addComp({
      entity: 'TY_LAND_BIZ', dealCardId: dealId, sourceLabel: 'LandPortal',
      addressDesc: 'BRUSH CREEK RD, TN, 37062', county: 'Williamson', state: 'TN',
      price: 900_000, priceKind: 'sale', saleOrListDate: '2026-02-02', acres: 40.2,
      lat: 36.011844635009766, lng: -87.08999633789062,
    });

    const result = await reconcileCompGeography(dealId, {
      fetchImpl: stubFetch(), runAddressGeocode: false,
    });

    const [row] = listComps({ dealCardId: dealId });
    expect(row.lat).toBeCloseTo(36.0118, 3);
    expect(row.geo_precision).toBe('exact');
    expect(row.distance_miles).not.toBeNull();
    expect(row.distance_miles as number).toBeLessThan(6);
    expect(row.geo_tier).toBe('local');
    expect(result.byTier.local).toBe(1);
  });

  it('retains a ZIP-area centroid but states no distance, so the record stays geographically unresolved', async () => {
    const dealId = fairviewDeal();
    addComp({
      entity: 'TY_LAND_BIZ', dealCardId: dealId, sourceLabel: 'LandWatch',
      addressDesc: '0 Giles Hill Rd, College Grove, TN, 37046',
      county: 'Williamson', state: 'TN',
      price: 2_000_000, priceKind: 'sale', saleOrListDate: '2025-06-01', acres: 67,
    });
    // A comp whose ZIP centroid lands INSIDE the subject's own ZIP still may not
    // be promoted to local: the point is an area, not a parcel.
    addComp({
      entity: 'TY_LAND_BIZ', dealCardId: dealId, sourceLabel: 'LandWatch',
      addressDesc: '0 Some Rd, Fairview, TN, 37062',
      county: 'Williamson', state: 'TN',
      price: 500_000, priceKind: 'sale', saleOrListDate: '2025-06-01', acres: 30,
    });

    await reconcileCompGeography(dealId, { fetchImpl: stubFetch(), runAddressGeocode: false });

    const rows = listComps({ dealCardId: dealId }).sort((a, b) => a.id - b.id);
    const collegeGrove = rows.find((r) => r.zip === '37046') as (typeof rows)[number];
    const fairview = rows.find((r) => r.zip === '37062') as (typeof rows)[number];

    expect(collegeGrove.city).toBe('College Grove');
    // A distance may only come from a PARCEL point. Measuring to the middle of
    // a postal area produced a precise-looking mileage that every record in
    // that ZIP shared, which the operator reads as a measured separation from
    // the subject and is not one. With no parcel point the record carries NO
    // distance and is tiered `unresolved` — retained market context, never
    // local evidence.
    expect(collegeGrove.distance_miles).toBeNull();
    expect(collegeGrove.geo_precision).toBe('unresolved');
    expect(collegeGrove.geo_tier).toBe('unresolved');

    expect(fairview.distance_miles).toBeNull();
    expect(fairview.geo_precision).toBe('unresolved');
    // Landing inside the subject's own ZIP still may not be promoted to local.
    expect(fairview.geo_tier).not.toBe('local');
    expect(fairview.geo_tier).toBe('unresolved');

    // The area point NEVER reaches the parcel columns. Those pin the map and
    // drive canonical identity, and every listing in a ZIP shares one centroid.
    // It is still RETAINED (geo_lat), because knowing the postal area is real
    // disclosed evidence — it simply cannot state a distance.
    for (const row of [collegeGrove, fairview]) {
      expect(row.lat).toBeNull();
      expect(row.lng).toBeNull();
      expect(row.geo_lat).not.toBeNull();
    }
  });

  it('never promotes an area point to `exact` on a rerun', async () => {
    const dealId = fairviewDeal();
    addComp({
      entity: 'TY_LAND_BIZ', dealCardId: dealId, sourceLabel: 'LandWatch',
      addressDesc: '0 Giles Hill Rd, College Grove, TN, 37046',
      county: 'Williamson', state: 'TN',
      price: 2_000_000, priceKind: 'sale', saleOrListDate: '2025-06-01', acres: 67,
    });
    await reconcileCompGeography(dealId, { fetchImpl: stubFetch(), runAddressGeocode: false });
    await reconcileCompGeography(dealId, { fetchImpl: stubFetch(), runAddressGeocode: false });
    const [row] = listComps({ dealCardId: dealId });
    // A rerun can never quietly promote an area point into a parcel point.
    expect(row.geo_precision).toBe('unresolved');
    expect(row.lat).toBeNull();
    expect(row.geo_lat).not.toBeNull();
  });

  it('keeps records that share one ZIP centroid as separate comparables', async () => {
    const dealId = fairviewDeal();
    for (const address of [
      '1100 Camwood Way, Franklin, TN, 37064',
      '0 Pinewood Rd, Franklin, TN, 37064',
      'Oscar Green Road, Franklin, TN, 37064',
    ]) {
      addComp({
        entity: 'TY_LAND_BIZ', dealCardId: dealId, sourceLabel: 'LandWatch', addressDesc: address,
        county: 'Williamson', state: 'TN', price: 1_000_000 + address.length, priceKind: 'sale',
        saleOrListDate: '2025-06-01', acres: 70 + address.length / 100,
      });
    }

    await reconcileCompGeography(dealId, { fetchImpl: stubFetch(), runAddressGeocode: false });

    const view = buildCompsValuationView(dealId);
    expect(view!.comps).toHaveLength(3);
    expect(view!.canonicalCompCount).toBe(3);
    // They remain three SEPARATE comparables even though they share one ZIP
    // centroid — the centroid never merges records. None is placed on the map,
    // and none states a distance: a shared area point cannot measure any of
    // them against the subject.
    for (const comp of view!.comps) {
      expect(comp.distanceMiles).toBeNull();
      expect(comp.geography.precision).toBe('unresolved');
      expect(comp.locationResolved).toBe(false);
      expect(comp.lat).toBeNull();
    }
  });

  it('never invents a location when nothing supports one', async () => {
    const dealId = fairviewDeal();
    addComp({
      entity: 'TY_LAND_BIZ', dealCardId: dealId, sourceLabel: 'Redfin',
      addressDesc: 'Somewhere Rd', county: 'Williamson', state: 'TN',
      price: 100_000, priceKind: 'sale', acres: 30,
    });

    const result = await reconcileCompGeography(dealId, { fetchImpl: stubFetch(), runAddressGeocode: false });

    const [row] = listComps({ dealCardId: dealId });
    expect(row.lat).toBeNull();
    expect(row.distance_miles).toBeNull();
    expect(row.geo_tier).toBe('unresolved');
    expect(result.unresolved).toBe(1);
  });

  it('discovers nothing: it visits only the ZCTA service and adds no comparable', async () => {
    const dealId = fairviewDeal();
    addComp({
      entity: 'TY_LAND_BIZ', dealCardId: dealId, sourceLabel: 'LandWatch',
      addressDesc: '1100 Camwood Way, Franklin, TN, 37064', sourceUrl: 'https://www.landwatch.com/x/pid/1',
      county: 'Williamson', state: 'TN', price: 8_415_000, priceKind: 'sale',
      saleOrListDate: '2026-08-12', acres: 75.37,
    });
    const before = listComps({ dealCardId: dealId }).length;

    const calls: string[] = [];
    await reconcileCompGeography(dealId, { fetchImpl: stubFetch(calls), runAddressGeocode: false });

    expect(listComps({ dealCardId: dealId })).toHaveLength(before);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('tigerweb.geo.census.gov');
    expect(calls.some((url) => /landwatch|redfin|zillow|landportal|google|bing/i.test(url))).toBe(false);
  });

  it('caches a ZCTA lookup so a rerun re-queries nothing', async () => {
    const dealId = fairviewDeal();
    addComp({
      entity: 'TY_LAND_BIZ', dealCardId: dealId, sourceLabel: 'LandWatch',
      addressDesc: '0 Pinewood Rd, Franklin, TN, 37064', county: 'Williamson', state: 'TN',
      price: 1_200_000, priceKind: 'sale', saleOrListDate: '2025-01-02', acres: 74,
    });
    const calls: string[] = [];
    await reconcileCompGeography(dealId, { fetchImpl: stubFetch(calls), runAddressGeocode: false });
    await reconcileCompGeography(dealId, { fetchImpl: stubFetch(calls), runAddressGeocode: false });
    expect(calls).toHaveLength(1);
  });

  it('persists geography that survives a fresh projection read (hard refresh)', async () => {
    const dealId = fairviewDeal();
    addComp({
      entity: 'TY_LAND_BIZ', dealCardId: dealId, sourceLabel: 'LandWatch',
      addressDesc: '5929 North Lick Creek Road, Franklin, TN, 37064',
      county: 'Williamson', state: 'TN', price: 3_950_000, priceKind: 'sale',
      saleOrListDate: '2025-01-09', acres: 93.9,
      lat: 35.850256949105, lng: -87.141896502011,
    });

    await reconcileCompGeography(dealId, { fetchImpl: stubFetch(), runAddressGeocode: false });

    // A hard refresh is a brand-new projection over the same persisted rows.
    const view = buildCompsValuationView(dealId);
    const comp = view?.comps.find((c) => c.address?.includes('Lick Creek'));
    expect(comp?.geography.tier).toBe('expanded');
    expect(comp?.geography.city).toBe('Franklin');
    expect(comp?.distanceMiles).not.toBeNull();
    expect(comp?.geography.cardLine).toContain('Expanded market');

    const again = buildCompsValuationView(dealId);
    expect(again?.comps.find((c) => c.address?.includes('Lick Creek'))?.geography.tier).toBe('expanded');
  });

  it('records the reconciliation without deleting or reclassifying any candidate', async () => {
    const dealId = fairviewDeal();
    for (const [address, lat, lng] of [
      ['BRUSH CREEK RD, TN, 37062', 36.0118, -87.0899],
      ['0 Cross Keys Rd, College Grove, TN, 37046', null, null],
      ['Somewhere With No Locality', null, null],
    ] as Array<[string, number | null, number | null]>) {
      addComp({
        entity: 'TY_LAND_BIZ', dealCardId: dealId, sourceLabel: 'LandWatch', addressDesc: address,
        county: 'Williamson', state: 'TN', price: 900_000, priceKind: 'sale',
        saleOrListDate: '2025-05-01', acres: 40,
        ...(lat != null && lng != null ? { lat, lng } : {}),
      });
    }

    const result = await reconcileCompGeography(dealId, { fetchImpl: stubFetch(), runAddressGeocode: false });

    expect(result.examined).toBe(3);
    expect(listComps({ dealCardId: dealId })).toHaveLength(3);
    expect(result.byTier.local + result.byTier.expanded + result.byTier.broader + result.byTier.unresolved).toBe(3);
    const audit = getLandosDb().prepare(
      "SELECT COUNT(*) AS n FROM landos_audit_log WHERE action = 'comp_geography_reconciled'",
    ).get() as { n: number };
    expect(audit.n).toBe(1);
  });
});
