import { describe, it, expect } from 'vitest';
import { assessDualExit, MANUFACTURED_MARKET_GATE_USD, BY_RIGHT_PROXY_RADIUS_MILES } from './dual-exit-valuation.js';
import type { DetailComp } from './providers/apify-comp-provider.js';

const SUBJECT = { lat: 39.66, lng: -89.65 };

function ownedManufactured(over: Partial<DetailComp> = {}): DetailComp {
  return {
    sourceUrl: 'https://www.redfin.com/x',
    sourceLabel: 'redfin',
    soldPriceUsd: 250_000,
    soldDateIso: '2026-01-01T00:00:00.000Z',
    listPriceUsd: null,
    acres: 1,
    lotSizeSqft: 43_560,
    apn: '1',
    county: 'X',
    state: 'IL',
    latitude: SUBJECT.lat, // 0mi away by default (within proxy radius)
    longitude: SUBJECT.lng,
    daysOnMarket: 40,
    propertyTypeCode: 6,
    descriptionText: 'owned land',
    verifyTags: [],
    ...over,
  };
}

describe('assessDualExit', () => {
  it('both gates pass: market >= $200k AND a nearby owned-land manufactured sale', () => {
    const r = assessDualExit({
      subjectCentroid: SUBJECT,
      vacantLandCompCount: 3,
      manufacturedOwnedLandComps: [ownedManufactured({ soldPriceUsd: 250_000 })],
    });
    expect(r.landHome.marketGatePassed).toBe(true);
    expect(r.landHome.zoningByRightProxy).toBe(true);
    expect(r.landHome.viable).toBe(true);
    expect(r.vacantLand.viable).toBe(true);
    expect(r.recommendedExits).toContain('land_home_package');
    expect(r.recommendedExits).toContain('vacant_land');
  });

  it('market gate fails when no owned-land manufactured sale reaches $200k', () => {
    const r = assessDualExit({
      subjectCentroid: SUBJECT,
      vacantLandCompCount: 1,
      manufacturedOwnedLandComps: [ownedManufactured({ soldPriceUsd: 150_000 })],
    });
    expect(r.landHome.marketGatePassed).toBe(false);
    expect(r.landHome.viable).toBe(false);
    expect(r.landHome.reasons.join(' ')).toMatch(/Market gate NOT met/);
    expect(MANUFACTURED_MARKET_GATE_USD).toBe(200_000);
  });

  it('zoning proxy fails (verify zoning) when nearest owned-land manufactured sale is beyond 2mi', () => {
    const farComp = ownedManufactured({ soldPriceUsd: 250_000, latitude: SUBJECT.lat + 0.1, longitude: SUBJECT.lng }); // ~6.9mi
    const r = assessDualExit({ subjectCentroid: SUBJECT, vacantLandCompCount: 0, manufacturedOwnedLandComps: [farComp] });
    expect(r.landHome.marketGatePassed).toBe(true);
    expect(r.landHome.zoningByRightProxy).toBe(false);
    expect(r.landHome.viable).toBe(false);
    expect(r.landHome.reasons.join(' ')).toMatch(/verify zoning/);
    expect((r.landHome.nearestManufacturedMiles ?? 0)).toBeGreaterThan(BY_RIGHT_PROXY_RADIUS_MILES);
  });

  it('no subject centroid -> zoning proxy cannot be checked -> verify zoning, not viable', () => {
    const r = assessDualExit({ vacantLandCompCount: 2, manufacturedOwnedLandComps: [ownedManufactured()] });
    expect(r.landHome.zoningByRightProxy).toBe(false);
    expect(r.landHome.reasons.join(' ')).toMatch(/verify zoning/);
  });

  it('no owned-land manufactured comps -> land-home exit unsupported (none invented)', () => {
    const r = assessDualExit({ subjectCentroid: SUBJECT, vacantLandCompCount: 0, manufacturedOwnedLandComps: [] });
    expect(r.landHome.viable).toBe(false);
    expect(r.landHome.topManufacturedSaleUsd).toBeNull();
    expect(r.recommendedExits).toHaveLength(0);
    expect(r.notes.join(' ')).toMatch(/Neither exit/);
  });
});
