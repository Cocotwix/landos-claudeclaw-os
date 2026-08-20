import { describe, expect, it } from 'vitest';

import {
  BOUNDARY_CONTEXT_PLAN,
} from './parcel-visual-framing.js';
import {
  broadenLandPortalMapSearch,
  candidateParcelUrl,
  candidatesFromListRows,
  classifyMapSearchCandidates,
  isoFromCardDate,
  landPortalCompSearchValuation,
  parseMapSearchCardText,
  planLandPortalMapSearch,
  type LandPortalMapSearchRow,
} from './landportal-map-search.js';
import {
  detailFromRecord,
  sameUnderlyingSale,
} from './landportal-comp-search-capability.js';
import type { LandPortalRecordRead } from './landportal-property-characteristics-capability.js';

// The three REAL result cards the live 2026-08-19 Fairview proof returned from
// LandPortal's new top-bar map search (Sold, 1 year, Type Land, 20 ac min).
const FAIRVIEW_ROWS: LandPortalMapSearchRow[] = [
  {
    attrs: {
      'data-propertyid': '125022222', 'data-fips': '47187', 'data-apn': '021-068.03-000',
      'data-mlsuuid': '87884639', 'data-situslatitude': '35.9919052', 'data-situslongitude': '-87.1582260',
      'data-property-address': 'DICE LAMPLEY RD', 'data-property-city': 'COUNCE', 'data-property-state': 'TN', 'data-property-zip': '38326',
    },
    text: '$625,000 Sold DICE LAMPLEY RD, TN, 38326 1.5 Bath 2,410 SqFt 49,658 SqFt lot 24.18 MLS acres 05-15-2026 Fondaw Herchell S',
  },
  {
    attrs: {
      'data-propertyid': '125022791', 'data-fips': '47187', 'data-apn': '022-094.00-000',
      'data-mlsuuid': '87857624', 'data-situslatitude': '36.0118446', 'data-situslongitude': '-87.0899963',
      'data-property-address': 'BRUSH CREEK RD', 'data-property-city': 'N/A', 'data-property-state': 'TN', 'data-property-zip': '37062',
    },
    text: '$900,000 Sold BRUSH CREEK RD, TN, 37062 76,230 SqFt lot 40.20 MLS acres 02-02-2026 Padre Pio Prop Llc',
  },
  {
    attrs: {
      'data-propertyid': '125031744', 'data-fips': '47187', 'data-apn': '046-050.00-000',
      'data-mlsuuid': '194044269', 'data-situslatitude': '35.9479179', 'data-situslongitude': '-87.1509323',
      'data-property-address': '7348 OVERBY RD', 'data-property-city': 'FAIRVIEW', 'data-property-state': 'TN', 'data-property-zip': '37062',
    },
    text: '$2,500,000 Sold 7348 OVERBY RD, TN, 37062 1 Bath 2,704 SqFt 1,903,572 SqFt lot 52.18 MLS acres 12-22-2025 A-1 Home Builders Inc',
  },
];

const FAIRVIEW = { subjectAcres: 75.91, subjectApn: '042-123.00-000', subjectLat: 35.9764229, subjectLng: -87.1180051 };

describe('planLandPortalMapSearch', () => {
  it('routes a ~76-acre subject to a 20-acre-minimum, no-maximum sold pass', () => {
    const plan = planLandPortalMapSearch(75.91, 'sold_land');
    expect(plan.status).toBe('sold');
    expect(plan.periodDays).toBe(365);
    expect(plan.lotSizeMinValue).toBe('20');
    expect(plan.lotSizeMaxValue).toBeNull();
    expect(plan.typeSelectors).toEqual(['input#mls_land']);
  });

  it('routes a 6-acre subject to a tighter discrete band', () => {
    const plan = planLandPortalMapSearch(6, 'sold_land');
    expect(plan.lotSizeMinValue).toBe('2');
    expect(plan.lotSizeMaxValue).toBe('20');
  });

  it('never constrains Days on Market for the active pass', () => {
    const plan = planLandPortalMapSearch(75.91, 'active_land');
    expect(plan.status).toBe('for_sale');
    expect(plan.periodDays).toBeNull();
  });

  it('never constrains lot size for the mobile/manufactured lane', () => {
    const plan = planLandPortalMapSearch(75.91, 'sold_mobile');
    expect(plan.lotSizeMinValue).toBeNull();
    expect(plan.lotSizeMaxValue).toBeNull();
    expect(plan.typeSelectors).toEqual(['input#mls_mobile']);
  });
});

describe('broadenLandPortalMapSearch', () => {
  it('broadens exactly once: one rung down, no max, wider sold window', () => {
    const plan = planLandPortalMapSearch(75.91, 'sold_land');
    const wider = broadenLandPortalMapSearch(plan);
    expect(wider?.lotSizeMinValue).toBe('10');
    expect(wider?.lotSizeMaxValue).toBeNull();
    expect(wider?.periodDays).toBe(730);
    expect(wider && broadenLandPortalMapSearch(wider)).toBeNull();
  });
});

describe('parseMapSearchCardText', () => {
  it('separates building SqFt from lot SqFt on an improved card', () => {
    const parsed = parseMapSearchCardText(FAIRVIEW_ROWS[2].text);
    expect(parsed.price).toBe(2_500_000);
    expect(parsed.status).toBe('sold');
    expect(parsed.buildingSqft).toBe(2_704);
    expect(parsed.lotSqft).toBe(1_903_572);
    expect(parsed.mlsAcres).toBe(52.18);
    expect(parsed.baths).toBe(1);
    expect(parsed.saleDate).toBe('2025-12-22');
    expect(parsed.soldBy).toBe('A-1 Home Builders Inc');
  });

  it('reads a vacant card with no building figure', () => {
    const parsed = parseMapSearchCardText(FAIRVIEW_ROWS[1].text);
    expect(parsed.buildingSqft).toBeNull();
    expect(parsed.mlsAcres).toBe(40.2);
    expect(parsed.saleDate).toBe('2026-02-02');
  });

  it('normalizes card dates to ISO', () => {
    expect(isoFromCardDate('05-15-2026')).toBe('2026-05-15');
    expect(isoFromCardDate('not a date')).toBeNull();
  });
});

describe('candidatesFromListRows', () => {
  it('builds structured candidates with identity, price-per-acre and dedupe', () => {
    const candidates = candidatesFromListRows([...FAIRVIEW_ROWS, FAIRVIEW_ROWS[1]], FAIRVIEW.subjectApn);
    expect(candidates).toHaveLength(3);
    const brushCreek = candidates.find((row) => row.apn === '022-094.00-000');
    expect(brushCreek?.pricePerAcre).toBeCloseTo(900_000 / 40.2, 0);
    expect(brushCreek?.city).toBeNull(); // 'N/A' is not a value
  });

  it('excludes the subject parcel itself', () => {
    const subjectRow: LandPortalMapSearchRow = {
      attrs: { 'data-apn': '042-123.00-000', 'data-propertyid': '154591092', 'data-fips': '47187' },
      text: '$1 Sold KINGWOOD BLVD, TN, 37062 75.91 MLS acres 01-01-2026 Subject',
    };
    const candidates = candidatesFromListRows([subjectRow], FAIRVIEW.subjectApn);
    expect(candidates).toHaveLength(0);
  });

  it('rebuilds the comp\'s own canonical parcel URL from the identity triple', () => {
    const candidates = candidatesFromListRows(FAIRVIEW_ROWS, FAIRVIEW.subjectApn);
    const url = candidateParcelUrl(candidates[1]);
    expect(url).toMatch(/^https:\/\/landportal\.com\/\?property=/);
  });
});

describe('classifyMapSearchCandidates', () => {
  const classified = classifyMapSearchCandidates(FAIRVIEW, candidatesFromListRows(FAIRVIEW_ROWS, FAIRVIEW.subjectApn));

  it('accepts the in-pool vacant sold sale as CORE', () => {
    const brushCreek = classified.find((row) => row.candidate.apn === '022-094.00-000');
    expect(brushCreek?.tier).toBe('core');
    expect(brushCreek?.distanceMiles).toBeGreaterThan(0);
  });

  it('keeps an acreage-relevant improved sale as DIRECTIONAL — improved, out of the vacant-land median', () => {
    const overby = classified.find((row) => row.candidate.apn === '046-050.00-000');
    expect(overby?.tier).toBe('directional');
    expect(overby?.improved).toBe(true);
    expect(overby?.reason).toMatch(/improved sale/i);
    expect(overby?.reason).toMatch(/never enters the clean vacant-land median/i);
  });

  it('classifies an improvement signal without square footage the same way', () => {
    const hinted = classifyMapSearchCandidates(FAIRVIEW, [
      { ...classified.find((row) => row.candidate.apn === '046-050.00-000')!.candidate, buildingSqft: null, improvedHint: true },
    ]);
    expect(hinted[0].tier).toBe('directional');
    expect(hinted[0].improved).toBe(true);
  });

  it('still excludes an improved sale whose acreage is far outside the comparability span', () => {
    const tinyImproved = classifyMapSearchCandidates(FAIRVIEW, [
      { ...classified.find((row) => row.candidate.apn === '046-050.00-000')!.candidate, mlsAcres: 1.01, lotSqft: null },
    ]);
    expect(tinyImproved[0].tier).toBe('excluded');
    expect(tinyImproved[0].reason).toMatch(/improved and far outside/i);
  });

  it('keeps a below-pool improved sale as DIRECTIONAL — improved', () => {
    // DICE LAMPLEY carries 2,410 SqFt of structure on 24.18 ac: visible
    // directional evidence, never part of the clean vacant-land median.
    const dice = classified.find((row) => row.candidate.apn === '021-068.03-000');
    expect(dice?.tier).toBe('directional');
    expect(dice?.improved).toBe(true);
    const vacantVersion = classifyMapSearchCandidates(FAIRVIEW, [
      { ...classified.find((row) => row.candidate.apn === '021-068.03-000')!.candidate, buildingSqft: null },
    ]);
    expect(vacantVersion[0].tier).toBe('directional');
    expect(vacantVersion[0].improved).toBeFalsy();
    expect(vacantVersion[0].reason).toMatch(/outside the .*pool/i);
  });

  it('never lets an active listing into the FMV classification', () => {
    const active = classifyMapSearchCandidates(FAIRVIEW, [
      { ...classified[0].candidate, status: 'for_sale' as const },
    ]);
    expect(active[0].tier).toBe('excluded');
    expect(active[0].reason).toMatch(/competition context/i);
  });
});

describe('landPortalCompSearchValuation', () => {
  const core = (ppa: number) => ({
    candidate: candidatesFromListRows([FAIRVIEW_ROWS[1]], null)[0],
    tier: 'core' as const,
    reason: 'test',
    acresUsed: 40,
    pricePerAcre: ppa,
    distanceMiles: null,
  });

  it('states median accepted sold $/acre × subject acreage with two or more cores', () => {
    const valuation = landPortalCompSearchValuation(75.91, [core(20_000), core(24_000)]);
    expect(valuation.medianSoldPricePerAcre).toBe(22_000);
    expect(valuation.landValueIndication).toBe(Math.round(22_000 * 75.91));
    expect(valuation.confidence).toBe('indicative');
  });

  it('refuses a single-sale median with the reason stated', () => {
    const valuation = landPortalCompSearchValuation(75.91, [core(22_000)]);
    expect(valuation.landValueIndication).toBeNull();
    expect(valuation.caveats[0]).toMatch(/single closed/i);
  });

  it('states honesty caveats when core sales lack coordinates or sale dates', () => {
    const undatedRemote = (ppa: number) => {
      const base = core(ppa);
      return { ...base, distanceMiles: null, candidate: { ...base.candidate, saleDate: null } };
    };
    const valuation = landPortalCompSearchValuation(75.91, [undatedRemote(20_000), undatedRemote(30_000), core(25_000)]);
    expect(valuation.landValueIndication).not.toBeNull();
    expect(valuation.caveats.join(' ')).toMatch(/not distance-verified/i);
    expect(valuation.caveats.join(' ')).toMatch(/no sale date/i);
  });

  it('reports the core $/acre range and counts improved directional evidence outside the median', () => {
    const improved = { ...core(60_000), tier: 'directional' as const, improved: true };
    const valuation = landPortalCompSearchValuation(75.91, [core(15_000), core(25_000), core(20_000), improved]);
    expect(valuation.medianSoldPricePerAcre).toBe(20_000); // improved 60k/ac never blends in
    expect(valuation.coreSoldPricePerAcreLow).toBe(15_000);
    expect(valuation.coreSoldPricePerAcreHigh).toBe(25_000);
    expect(valuation.improvedDirectionalCount).toBe(1);
    expect(valuation.directionalCount).toBe(1);
    expect(valuation.caveats.join(' ')).toMatch(/improved sale\(s\) retained as Directional/i);
  });
});

describe('cross-source dedupe and candidate detail', () => {
  it('recognizes one underlying sale across sources', () => {
    const a = { address: 'BRUSH CREEK RD, TN, 37062', lat: 36.01184, lng: -87.08999, price: 900_000, saleDate: '2026-02-02' };
    expect(sameUnderlyingSale(a, { address: 'Brush Creek Rd TN 37062', lat: null, lng: null, price: null, saleDate: null })).toBe(true);
    expect(sameUnderlyingSale(a, { address: null, lat: 36.0119, lng: -87.0901, price: null, saleDate: null })).toBe(true);
    // Live 2026-08-20 miss: LandPortal "BRUSH CREEK RD" vs Redfin's no-number
    // "0 Brush Creek Rd, Fairview, TN 37062" at the same price = one sale.
    expect(sameUnderlyingSale(
      { address: 'BRUSH CREEK RD', lat: null, lng: null, price: 900_000, saleDate: '2026-02-02' },
      { address: '0 Brush Creek Rd, Fairview, TN 37062', lat: null, lng: null, price: 900_000, saleDate: null },
    )).toBe(true);
    // Same numbered street address across sources = same property.
    expect(sameUnderlyingSale(
      { address: '7348 OVERBY RD', lat: null, lng: null, price: 2_500_000, saleDate: '2025-12-22' },
      { address: '7348 Overby Rd, Fairview, TN 37062', lat: null, lng: null, price: 2_500_000, saleDate: null },
    )).toBe(true);
    // Different numbers on the same road are different properties.
    expect(sameUnderlyingSale(
      { address: '1 Ivey Rd, Fairview, TN 37062', lat: null, lng: null, price: 405_000, saleDate: null },
      { address: '2 Ivey Rd, Fairview, TN 37062', lat: null, lng: null, price: 395_000, saleDate: null },
    )).toBe(false);
    // Two no-number listings on the same road only merge on a price match.
    expect(sameUnderlyingSale(
      { address: '0 Old Cox Pike, Fairview, TN 37062', lat: null, lng: null, price: 650_000, saleDate: null },
      { address: 'OLD COX PIKE', lat: null, lng: null, price: 365_000, saleDate: null },
    )).toBe(false);
    expect(sameUnderlyingSale(a, { address: null, lat: null, lng: null, price: 900_000, saleDate: '2026-02-15' })).toBe(true);
    expect(sameUnderlyingSale(a, { address: 'OVERBY RD', lat: 35.9479, lng: -87.1509, price: 2_500_000, saleDate: '2025-12-22' })).toBe(false);
  });

  it('projects the listing story and flags listing-vs-parcel acreage divergence', () => {
    // The REAL Brush Creek enrichment read: MLS 40.20 ac over a 1.75 ac deeded parcel.
    const read: LandPortalRecordRead = {
      url: 'https://landportal.com/?property=x',
      authenticated: true,
      panelReady: true,
      apn: '022-094.00-000',
      fields: { 'Parcel ID': '022-094.00-000', Acres: '1.750', 'Road Frontage': '298.42 ft' },
      mlsFields: {
        'MLS Description': 'Williamson County private acreage on Brush Creek Rd! 40.2 acres.',
        'Listing Status': 'Sold', 'MLS ID': '2807185', 'Days on Market': '318',
        'Last Sold Date': '02-02-2026', 'Lot Size Acres': '40.20', 'Building SqFt': '0',
      },
      listingLinks: [{ text: 'View on Redfin', href: 'https://www.redfin.com/TN/Fairview/Brush-Creek-Rd-37062/home/87857624' }],
      redfinUrl: 'https://www.redfin.com/TN/Fairview/Brush-Creek-Rd-37062/home/87857624',
      apiFactCount: 3,
      dismissedOverlays: 0,
      capturedAtIso: '2026-08-19T00:00:00.000Z',
    };
    const detail = detailFromRecord(read, 'https://landportal.com/?property=x');
    expect(detail.redfinUrl).toMatch(/redfin\.com/);
    expect(detail.mlsDescription).toMatch(/private acreage/);
    expect(detail.daysOnMarket).toBe(318);
    expect(detail.acreageDivergence).toMatch(/LISTING-REPORTED 40\.2 ac vs deeded parcel 1\.75 ac/);
  });
});

describe('BOUNDARY_CONTEXT_PLAN', () => {
  it('attempts ZIP, city and county with progressively wider cameras', () => {
    expect(BOUNDARY_CONTEXT_PLAN.map((planned) => planned.label)).toEqual([
      'zip_boundary_context', 'city_boundary_context', 'county_boundary_context',
    ]);
    const steps = BOUNDARY_CONTEXT_PLAN.map((planned) => planned.zoomOutSteps);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    expect(BOUNDARY_CONTEXT_PLAN.every((planned) => planned.candidates.length >= 1)).toBe(true);
  });
});
