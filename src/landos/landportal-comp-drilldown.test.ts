import { describe, expect, it } from 'vitest';
import {
  buildLandPortalCompPersistence,
  compVisualForLandPortalComp,
  landPortalEnrichmentCandidates,
  mergeCompDetail,
  planCompDrilldown,
  planLandPortalCompEnrichment,
  reconcileLandPortalCompEnrichment,
  parseLandPortalSimilars,
  reconcileSimilarToRetainedComp,
  landPortalCompLocationUpdate,
  type LandPortalSidebarComp,
} from './landportal-comp-drilldown.js';
import { compDistanceMiles, resolveGeographicTier } from './acreage-router.js';

const sidebar: LandPortalSidebarComp = { propertyId: '123', apn: '01-02', price: 400000, acres: 40, saleDate: '2024-06-02', pricePerAcre: 10000, detailUrl: 'https://app.thelandportal.com/property/123' };

describe('drilldown plan', () => {
  it('returns no work for no comps', () => expect(planCompDrilldown([], {})).toEqual([]));
  it('returns exactly one distinct step per row', () => {
    const steps = planCompDrilldown([sidebar, { ...sidebar }], { fips: '26055' });
    expect(steps).toHaveLength(2); expect(new Set(steps.map((x) => x.compKey)).size).toBe(2);
    expect(steps[0].action).toBe('open_comp_detail'); expect(steps[0].capture.join(' ')).toMatch(/address.*acreage.*image/i);
  });
  it('uses Show on Map when no detail URL exists', () => expect(planCompDrilldown([{ ...sidebar, detailUrl: null }], { fips: '26055' })[0].action).toBe('show_on_map'));
});

describe('detail merge and location', () => {
  it('prefers detail values and records both surface provenance', () => {
    const comp = mergeCompDetail(sidebar, { address: '100 Comp Rd', acres: 41, price: 410000 }, {});
    expect(comp).toMatchObject({ address: '100 Comp Rd', acres: 41, price: 410000, drilledDown: true });
    expect(comp.provenance.join(' ')).toMatch(/detail supplied address/i);
    expect(comp.provenance.join(' ')).toMatch(/detail supplied acres/i);
    expect(comp.provenance.join(' ')).toMatch(/detail supplied price/i);
  });
  it('keeps sidebar values when detail is silent', () => expect(mergeCompDetail(sidebar, {}, {}).price).toBe(400000));
  it('delegates coordinate distance and tier to the acreage router', () => {
    const subject = { lat: 44.822439610896, lng: -85.404821349666 };
    const detail = { lat: 44.9, lng: -85.5 };
    const comp = mergeCompDetail(sidebar, detail, subject);
    const distance = compDistanceMiles(subject, detail);
    expect(comp.locationResolution).toMatchObject({ resolved: true, basis: 'coordinates', distanceMiles: distance, tierId: resolveGeographicTier(distance).id });
    expect(comp.locationResolution.statement).toMatch(/miles/);
  });
  it('keeps unresolved location null with positive reduced weight', () => {
    const comp = mergeCompDetail(sidebar, { address: '100 Comp Rd' }, { lat: 44, lng: -85 });
    expect(comp.locationResolution).toMatchObject({ resolved: false, basis: 'unresolved', distanceMiles: null, tierId: 'distance_unresolved' });
    expect(comp.locationResolution.weightMultiplier).toBeGreaterThan(0);
  });
  it('never invents locality or coordinates', () => expect(mergeCompDetail(sidebar, null, {})).toMatchObject({ address: null, city: null, state: null, zip: null, lat: null, lng: null }));
});

describe('visual and persistence', () => {
  it('labels a real LandPortal CDN image as its listing thumbnail', () => {
    const comp = mergeCompDetail(sidebar, { imageUrl: 'https://images.thelandportal.com/comp.jpg', imageSourceLabel: 'LandPortal' }, {});
    expect(compVisualForLandPortalComp(comp)).toMatchObject({ provenance: 'listing_photo', label: 'LandPortal listing thumbnail', isPhotograph: true });
  });
  it('does not call missing imagery a photograph', () => expect(compVisualForLandPortalComp(mergeCompDetail(sidebar, {}, {}))).toMatchObject({ provenance: 'location_unresolved', isPhotograph: false }));
  it('persists enriched locality, image, and closed sale status', () => {
    const comp = mergeCompDetail(sidebar, { address: '100 Comp Rd', city: 'Town', state: 'MI', zip: '49690', lat: 44.9, lng: -85.5, imageUrl: 'https://images.thelandportal.com/a.jpg' }, { lat: 44.8, lng: -85.4 });
    expect(buildLandPortalCompPersistence(comp)).toMatchObject({ address_desc: '100 Comp Rd', city: 'Town', state: 'MI', zip: '49690', price_kind: 'sale', thumbnail_url: 'https://images.thelandportal.com/a.jpg' });
  });
  it('persists no image and unknown status when neither is stated', () => {
    const result = buildLandPortalCompPersistence(mergeCompDetail({ price: 1, acres: 1 }, null, {}));
    expect(result).toMatchObject({ price_kind: 'unknown', thumbnail_url: null, lat: null, lng: null, distance_miles: null });
  });
});

describe('multi-source LandPortal comp enrichment', () => {
  const comp = mergeCompDetail(sidebar, {
    address: '100 Comp Rd', city: 'Williamsburg', state: 'MI', zip: '49690', apn: '01-02',
    lat: 44.9, lng: -85.5,
  }, {});

  it('plans Zillow, Redfin, Realtor.com and open-web resolution independently', () => {
    const plan = planLandPortalCompEnrichment(comp, { county: 'Grand Traverse', state: 'MI' });
    expect(plan.map((step) => step.provider)).toEqual(['Zillow', 'Redfin', 'Realtor.com', 'Web']);
    expect(plan.every((step) => step.query.includes('100 Comp Rd') && step.requiresOpenedPageReconciliation)).toBe(true);
  });

  it('accepts a strong exact-property match and refuses a conflicting APN', () => {
    const accepted = reconcileLandPortalCompEnrichment(comp, {
      provider: 'Realtor.com', sourceUrl: 'https://www.realtor.com/property/100',
      address: '100 Comp Rd', apn: '01-02', acres: 40,
    });
    const refused = reconcileLandPortalCompEnrichment(comp, {
      provider: 'Zillow', sourceUrl: 'https://www.zillow.com/homedetails/other',
      address: '100 Comp Rd', apn: '99-99', acres: 40,
    });
    expect(accepted.matched).toBe(true);
    expect(refused).toMatchObject({ matched: false, reason: expect.stringMatching(/APN differs/) });
  });

  it('creates additional registry candidates only for reconciled pages', () => {
    const rows = landPortalEnrichmentCandidates(comp, [
      {
        provider: 'Realtor.com', sourceUrl: 'https://www.realtor.com/property/100',
        address: '100 Comp Rd', apn: '01-02', acres: 40, price: 400_000,
        saleDate: '2024-06-02', status: 'sold', thumbnailUrl: 'https://ap.rdcpix.com/hero.webp',
        photoUrls: ['https://ap.rdcpix.com/hero.webp', 'https://ap.rdcpix.com/road.webp'],
      },
      { provider: 'Redfin', sourceUrl: 'https://www.redfin.com/other', address: '999 Other Rd', apn: '99-99' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'Realtor.com', apn: '01-02', priceKind: 'sold' });
    expect(rows[0].photoUrls).toHaveLength(2);
  });

  it('keeps unstated transaction status unconfirmed and structure descriptions out of land valuation', () => {
    const rows = landPortalEnrichmentCandidates(comp, [{
      provider: 'Zillow', sourceUrl: 'https://www.zillow.com/homedetails/100',
      address: '100 Comp Road, Williamsburg, MI 49690', apn: '01-02', acres: 40,
      price: 625_000, status: 'unknown', description: 'Cabin residence with well and septic',
    }]);
    expect(rows[0]).toMatchObject({ lane: 'unknown', priceKind: 'unknown', compClass: 'residential' });
  });
});

// ── Comparable sidebar payload ───────────────────────────────────────────────

const similarRow = {
  apn: '12-004-006-00', fips: '26055', propertyid: 68276727, mls_status: 'sold',
  new_date: '2025-03-21', mls_price: 400000, mls_priceperacre: 10000, area_acres: 40,
  situszip5: '49696', municipality: 'UNION TOWNSHIP',
  situslatitude: 44.67387081966072, situslongitude: -85.4093255027183,
  distance: 10.238725134617095,
};
const subjectPoint = { lat: 44.822439610896, lng: -85.404821349666 };
const retainedRow = { apn: '12-004-006-00', price: 400000, acres: 40, saleOrListDate: '2025-03-21' };

describe('parseLandPortalSimilars', () => {
  it('reads the URL-encoded attribute, a JSON string, and a parsed array alike', () => {
    const json = JSON.stringify([similarRow]);
    for (const input of [encodeURIComponent(json), json, [similarRow]]) {
      const [comp] = parseLandPortalSimilars(input);
      expect(comp.detail).toMatchObject({ lat: 44.67387081966072, lng: -85.4093255027183, zip: '49696', apn: '12-004-006-00' });
      expect(comp.statedDistanceMiles).toBeCloseTo(10.2387, 3);
    }
  });
  it('states what it read, and never invents an address or a city from the municipality', () => {
    const [comp] = parseLandPortalSimilars([similarRow]);
    expect(comp.detail.address).toBeNull();
    expect(comp.detail.city).toBeNull();
    expect(comp.evidenceLine).toMatch(/situs coordinates 44\.673871, -85\.409326/);
    expect(comp.evidenceLine).toMatch(/municipality UNION TOWNSHIP/);
  });
  it('drops a row with no parcel number rather than binding evidence to an unidentified parcel', () => {
    expect(parseLandPortalSimilars([{ ...similarRow, apn: null }])).toEqual([]);
  });
  it('refuses a null-island coordinate as a location', () => {
    const [comp] = parseLandPortalSimilars([{ ...similarRow, situslatitude: 0, situslongitude: 0 }]);
    expect(comp.detail.lat).toBeNull();
    expect(comp.detail.lng).toBeNull();
  });
  it('survives junk input without throwing', () => {
    for (const input of ['', 'not json', '%%%', null, 42, {}]) expect(parseLandPortalSimilars(input)).toEqual([]);
  });
});

describe('reconcileSimilarToRetainedComp', () => {
  const [similar] = parseLandPortalSimilars([similarRow]);
  it('binds on APN plus corroborating record evidence', () => {
    const result = reconcileSimilarToRetainedComp(similar, retainedRow);
    expect(result.matched).toBe(true);
    expect(result.matchedOn).toEqual(['APN', 'acreage', 'price', 'sale date']);
  });
  it('refuses a different parcel outright', () => {
    expect(reconcileSimilarToRetainedComp(similar, { ...retainedRow, apn: '03-104-001-00' }).matched).toBe(false);
  });
  it('refuses a matching APN whose retained transaction disagrees', () => {
    const result = reconcileSimilarToRetainedComp(similar, { ...retainedRow, price: 900000 });
    expect(result.matched).toBe(false);
    expect(result.reason).toMatch(/price differs/);
  });
  it('stays unresolved when the APN matches but nothing corroborates it', () => {
    const result = reconcileSimilarToRetainedComp(similar, { apn: '12-004-006-00' });
    expect(result.matched).toBe(false);
    expect(result.reason).toMatch(/no acreage, price, or sale date/);
  });
  it('refuses when either side has no parcel number', () => {
    expect(reconcileSimilarToRetainedComp(similar, { ...retainedRow, apn: '' }).matched).toBe(false);
  });
});

describe('landPortalCompLocationUpdate', () => {
  const [similar] = parseLandPortalSimilars([similarRow]);
  it('places the comp from LandPortal coordinates and measures distance from the retained subject point', () => {
    const update = landPortalCompLocationUpdate(similar, reconcileSimilarToRetainedComp(similar, retainedRow), subjectPoint)!;
    expect(update.located).toBe(true);
    expect(update.distanceMiles).toBe(compDistanceMiles(subjectPoint, { lat: similarRow.situslatitude, lng: similarRow.situslongitude }));
    expect(update.tierId).toBe(resolveGeographicTier(update.distanceMiles).id);
    expect(update.provenance).toMatch(/Location from LandPortal/);
    expect(update.provenance).toMatch(/nothing was geocoded/);
  });
  it('states the remaining evidence gap even when it is mapped', () => {
    const update = landPortalCompLocationUpdate(similar, reconcileSimilarToRetainedComp(similar, retainedRow), subjectPoint)!;
    expect(update.remainingGap).toMatch(/No street address/);
  });
  it('leaves an uncoordinated parcel unplaced instead of approximating it', () => {
    const [noPoint] = parseLandPortalSimilars([{ ...similarRow, situslatitude: null, situslongitude: null }]);
    const update = landPortalCompLocationUpdate(noPoint, reconcileSimilarToRetainedComp(noPoint, retainedRow), subjectPoint)!;
    expect(update).toMatchObject({ located: false, lat: null, lng: null, distanceMiles: null, tierId: 'distance_unresolved' });
  });
  it('produces nothing at all for an unreconciled row', () => {
    expect(landPortalCompLocationUpdate(similar, reconcileSimilarToRetainedComp(similar, { apn: '99-99-99' }), subjectPoint)).toBeNull();
  });
});
