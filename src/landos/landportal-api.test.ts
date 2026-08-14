// LandPortal direct-retrieval mapping.
//
// The point of these tests is that the API is a LIKE-FOR-LIKE substitution for
// the panel scrape: it must emit the exact labels the evidence model already
// reads, and comparables in the exact shape the comp pipeline already parses.
// Every label asserted here was taken from a real retained inspection for
// 5170 Hwy 60, Birchwood TN.

import { describe, expect, it } from 'vitest';

import {
  landPortalCompCardsFromApi,
  landPortalCompDetailsFromApi,
  landPortalFactsFromApi,
  landPortalParcelUrl,
  landPortalSimilarsFrom,
} from './landportal-api.js';
import { parseComparableCard } from './landportal-browser.js';

/** The subject payload as LandPortal returns it, trimmed to what LandOS uses. */
const PROPERTIES: Record<string, unknown> = {
  apn: '023 003.02',
  fips: '47065',
  propertyid: 172954755,
  ownername1full: 'CAMERON NATHANIEL JOSEPH',
  owner1firstname: 'NATHANIEL',
  owner1lastname: 'CAMERON',
  situsfullstreetaddress: '5170 HIGHWAY 60',
  situscity: 'BIRCHWOOD',
  situsstate: 'TN',
  situszip5: '37308',
  situscounty: 'Hamilton County',
  lotsizeacres: 40.5,
  calc_acres: 42.92,
  lotsizesqft: 1764180,
  sumbuildingsqft: 1880,
  land_locked: false,
  road_frontage: 258.87,
  water_feature_is: true,
  water_feature_types: 'Creek / Stream',
  zoning: 'A',
  wetlands_cover_percentage: 3.57,
  fema_cover_percentage: 0,
  flfemafloodzone: 'Not in a flood hazard area',
  buildability_total_perc: 79.4,
  buildability_area: 34.15,
  slope_average: 8.74,
  situslatitude: '35.37346015078474',
  situslongitude: '-85.00249687920704',
  tlp_estimate: 386314,
  tlp_ppa: 9538,
};

describe('LandPortal direct retrieval — subject facts', () => {
  it('emits the exact parcel-panel labels the evidence model already reads', () => {
    const facts = landPortalFactsFromApi(PROPERTIES);
    expect(facts['Owner Name']).toBe('CAMERON NATHANIEL JOSEPH');
    expect(facts['Parcel ID']).toBe('023 003.02');
    expect(facts['Parcel Address']).toBe('5170 HIGHWAY 60');
    expect(facts['Parcel Address County']).toBe('Hamilton County');
    expect(facts.Acres).toBe('40.500');
    expect(facts['Calc Acres']).toBe('42.92');
    expect(facts['Building SqFt']).toBe('1880');
    expect(facts['Zoning Code']).toBe('A');
  });

  it('carries the screening values the SOP gates on', () => {
    const facts = landPortalFactsFromApi(PROPERTIES);
    // These four are exactly what the wetlands/FEMA/slope/access lanes read.
    expect(facts['Wetlands Coverage (%)']).toBe('3.57');
    expect(facts['FEMA Flood Zone']).toBe('Not in a flood hazard area');
    expect(facts['Slope Avg']).toBe('8.74 %');
    expect(facts['Road Frontage']).toBe('258.87 ft');
    // A boolean false must read as the operator-facing "No", never blank.
    expect(facts['Land Locked']).toBe('No');
    expect(facts['Buildability total (%)']).toBe('79.40 %');
  });

  it('never emits a key for a value LandPortal did not supply', () => {
    const facts = landPortalFactsFromApi({ apn: '023 003.02' });
    expect(facts['Parcel ID']).toBe('023 003.02');
    expect('Owner Name' in facts).toBe(false);
    expect('Slope Avg' in facts).toBe(false);
    expect('Road Frontage' in facts).toBe(false);
  });
});

describe('LandPortal direct retrieval — comparables', () => {
  // `similars` arrives JSON-encoded, exactly as the live payload carries it.
  const SIMILARS = JSON.stringify([
    {
      apn: '020     092.01', fips: '47065', propertyid: 122865009, mls_propertyid: 163253122,
      mls_price: 320000, mls_status: 'sold', area_acres: 35.91985766758494,
      new_date: '2026-05-08', distance: 6.083479125494308,
      situslatitude: 35.37136318427829, situslongitude: -85.11044570071465,
      mls_priceperacre: 8908.721269482554, vacant: true, bldg_count: 0,
      municipality: 'COUNTY NORTH', situszip5: '37373',
    },
    { apn: '', fips: '47065', mls_price: 1, area_acres: 1 },
  ]);

  it('parses the JSON-encoded similars member', () => {
    expect(landPortalSimilarsFrom({ similars: SIMILARS })).toHaveLength(2);
    expect(landPortalSimilarsFrom({ similars: '[' })).toEqual([]);
    expect(landPortalSimilarsFrom({})).toEqual([]);
  });

  it('produces cards the existing comp parser reads unchanged', () => {
    const cards = landPortalCompCardsFromApi(landPortalSimilarsFrom({ similars: SIMILARS }));
    // The identity-less second row is dropped rather than guessed at.
    expect(cards).toHaveLength(1);
    const parsed = parseComparableCard(cards[0], 'https://landportal.com/');
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('sold');
    expect(parsed!.price).toBe(320000);
    expect(parsed!.acres).toBeCloseTo(35.92, 2);
    // LandPortal's own internal spacing collapses without joining the halves.
    expect(parsed!.apn).toBe('020 092.01');
  });

  it('supplies the comp coordinates the scrape never obtained', () => {
    // Every comp previously rendered "location unresolved (never guessed)"
    // because the sidebar row states no position. The API row does.
    const details = landPortalCompDetailsFromApi(landPortalSimilarsFrom({ similars: SIMILARS }));
    expect(details).toHaveLength(1);
    const parsed = JSON.parse(details[0]) as { apn: string; sourceUrl: string; facts: Record<string, string> };
    expect(parsed.facts['Centroid Latitude']).toBe('35.37136318427829');
    expect(parsed.facts['Centroid Longitude']).toBe('-85.11044570071465');
    expect(parsed.facts.Acres).toBe('35.920');
    expect(parsed.facts['Last Sale Price']).toBe('$320,000');
    expect(parsed.facts['Last Sale Date']).toBe('2026-05-08');
    // The rebuilt URL must be the comp's own canonical parcel page.
    expect(parsed.sourceUrl).toBe(landPortalParcelUrl({ fips: '47065', apn: '020 092.01', propertyId: '122865009' }));
  });

  it('rebuilds a canonical parcel URL that decodes back to its identity', () => {
    const url = landPortalParcelUrl({ fips: '47065', apn: '023 003.02', propertyId: 172954755 });
    const token = /property=(.+)$/.exec(url)![1];
    expect(Buffer.from(token, 'base64').toString('utf8')).toBe('fips=47065&apn=023+003.02&propertyid=172954755');
  });
});
