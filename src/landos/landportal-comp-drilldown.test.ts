import { describe, expect, it } from 'vitest';
import { buildLandPortalCompPersistence, compVisualForLandPortalComp, mergeCompDetail, planCompDrilldown, type LandPortalSidebarComp } from './landportal-comp-drilldown.js';
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
