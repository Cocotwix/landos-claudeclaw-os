import { describe, expect, it } from 'vitest';

import type { CapabilityInvocationRequest, CapabilityResult } from './capability-contract.js';
import {
  LANDPORTAL_PROPERTY_CHARACTERISTICS_CAPABILITY,
  type LandPortalRecordRead,
} from './landportal-property-characteristics-capability.js';
import { LANDPORTAL_VISUAL_CAPTURE_CAPABILITY } from './landportal-visual-capture-capability.js';
import {
  LANDPORTAL_COMP_SEARCH_CAPABILITY,
  shouldRunLandWatchFallback,
  usableSoldEvidenceCount,
  type LandPortalMapSearchRun,
  type SecondarySearchResult,
} from './landportal-comp-search-capability.js';
import type { ClassifiedLandPortalComp } from './landportal-map-search.js';

const ENV = { invocationId: 'cap_test', researchSessionId: null, startedAt: '2026-08-19T00:00:00.000Z' };

const FAIRVIEW_IDENTITY = {
  address: 'Map 042 Parcel 123', city: 'Fairview', county: 'Williamson', state: 'TN', zip: '37062',
  apn: '042-123.00-000', owner: 'LANDSOUTH LLC', acres: 75.91, fips: '47187', lpPropertyId: '154591092',
};

const resolveSubject = async (): Promise<CapabilityResult> => ({
  invocationId: 'cap_res',
  capability: { id: 'property-resolution', version: '1.0' },
  status: 'SUCCEEDED',
  subjectResolution: 'RESOLVED',
  canonicalSubject: null,
  facts: { canonicalIdentity: FAIRVIEW_IDENTITY },
  evidence: [],
  warnings: [],
  missingInformation: [],
  timestamps: { startedAt: ENV.startedAt, completedAt: ENV.startedAt },
  execution: { mode: 'reuse', durationMs: 1, reused: false },
} as unknown as CapabilityResult);

const rawRequest = (capabilityId: string): CapabilityInvocationRequest => ({
  capabilityId,
  caller: { type: 'tools', ref: 'test' },
  subject: { kind: 'raw_property', entity: 'TY_LAND_BIZ', rawInput: 'Map 042 Parcel 123, Fairview, Tennessee' },
});

const recordRead = (overrides: Partial<LandPortalRecordRead> = {}): LandPortalRecordRead => ({
  url: 'https://landportal.com/?property=x',
  authenticated: true,
  panelReady: true,
  apn: '042-123.00-000',
  fields: { 'Parcel ID': '042-123.00-000', Acres: '75.910', 'Road Frontage': '50.00 ft', 'Land Locked': 'No' },
  mlsFields: {},
  listingLinks: [],
  redfinUrl: null,
  apiFactCount: 4,
  dismissedOverlays: 1,
  capturedAtIso: ENV.startedAt,
  ...overrides,
});

describe('LandPortal Property Characteristics capability', () => {
  it('extracts and reports the subject record on its own authenticated run', async () => {
    const outcome = await LANDPORTAL_PROPERTY_CHARACTERISTICS_CAPABILITY.execute(
      rawRequest('landportal-property-characteristics'),
      { resolveSubject, readRecord: async () => recordRead() },
      ENV,
    );
    expect(outcome.status).toBe('SUCCEEDED');
    expect(outcome.facts.outcome).toBe('record_extracted');
    expect(outcome.facts.factCount).toBe(4);
    expect(outcome.facts.dismissedOverlays).toBe(1);
    expect(outcome.facts.summary).toMatch(/Comp-search mode was never entered/);
  });

  it('refuses to adopt facts from a different parcel', async () => {
    const outcome = await LANDPORTAL_PROPERTY_CHARACTERISTICS_CAPABILITY.execute(
      rawRequest('landportal-property-characteristics'),
      { resolveSubject, readRecord: async () => recordRead({ apn: '046-050.00-000', fields: { 'Parcel ID': '046-050.00-000' } }) },
      ENV,
    );
    expect(outcome.status).toBe('NEEDS_INPUT');
    expect(outcome.subjectResolution).toBe('AMBIGUOUS');
    expect(outcome.facts.outcome).toBe('subject_mismatch');
    expect(outcome.facts.facts).toEqual({});
  });

  it('rejects caller-supplied fact assertions', () => {
    expect(() => LANDPORTAL_PROPERTY_CHARACTERISTICS_CAPABILITY.validate({
      ...rawRequest('landportal-property-characteristics'),
      context: { comparables: [{ price: 1 }] },
    })).toThrow(/assertions/);
  });
});

describe('LandPortal Visual Capture capability', () => {
  it('reports captured frames and honest boundary availability', async () => {
    const outcome = await LANDPORTAL_VISUAL_CAPTURE_CAPABILITY.execute(
      rawRequest('landportal-visual-capture'),
      {
        resolveSubject,
        captureVisuals: async () => ({
          fields: { 'Parcel ID': '042-123.00-000' },
          visualShots: [
            { label: 'clean_parcel_aerial', path: '/tmp/a.png', kind: 'parcel_page' as const, purpose: 'aerial' },
            { label: 'surrounding_area_aerial', path: '/tmp/b.png', kind: 'parcel_page' as const, purpose: 'context' },
            { label: 'zip_boundary_context', path: '/tmp/z.png', kind: 'overlay' as const, purpose: 'zip', overlay: 'ZIP code boundary' },
            { label: 'city_boundary_context', path: '/tmp/c.png', kind: 'overlay' as const, purpose: 'city', overlay: 'City / municipal boundary' },
          ],
          overlayMisses: [{ overlay: 'County boundary', reason: 'LandPortal exposes no toggle for this boundary in the current workspace.' }],
          capturedAtIso: ENV.startedAt,
        }),
      },
      ENV,
    );
    expect(outcome.status).toBe('SUCCEEDED');
    const boundaries = outcome.facts.boundaryContexts as Array<{ label: string; status: string; reason: string | null }>;
    expect(boundaries.find((row) => row.label === 'zip_boundary_context')?.status).toBe('captured');
    expect(boundaries.find((row) => row.label === 'city_boundary_context')?.status).toBe('captured');
    const county = boundaries.find((row) => row.label === 'county_boundary_context');
    expect(county?.status).toBe('unavailable');
    expect(county?.reason).toMatch(/no toggle/);
  });
});

describe('LandPortal Comp Search capability', () => {
  const soldRun: LandPortalMapSearchRun = {
    authenticated: true,
    panelApn: '042-123.00-000',
    applied: true,
    pills: 'Address Sold, 1 yea… x Price 20 acres x Type (1) x Filters',
    zoomStepsUsed: 5,
    noPropertiesFound: false,
    resultCount: 3,
    rows: [
      {
        attrs: {
          'data-propertyid': '125022791', 'data-fips': '47187', 'data-apn': '022-094.00-000',
          'data-situslatitude': '36.0118446', 'data-situslongitude': '-87.0899963',
          'data-property-address': 'BRUSH CREEK RD', 'data-property-state': 'TN', 'data-property-zip': '37062',
        },
        text: '$900,000 Sold BRUSH CREEK RD, TN, 37062 76,230 SqFt lot 40.20 MLS acres 02-02-2026 Padre Pio Prop Llc',
      },
      {
        attrs: {
          'data-propertyid': '125031744', 'data-fips': '47187', 'data-apn': '046-050.00-000',
          'data-property-address': '7348 OVERBY RD', 'data-property-state': 'TN', 'data-property-zip': '37062',
        },
        text: '$2,500,000 Sold 7348 OVERBY RD, TN, 37062 1 Bath 2,704 SqFt 1,903,572 SqFt lot 52.18 MLS acres 12-22-2025 A-1 Home Builders Inc',
      },
    ],
    mapShotPath: '/tmp/map.png',
    listShotPath: '/tmp/list.png',
    dismissedOverlays: 0,
    capturedAtIso: ENV.startedAt,
  };
  const activeRun: LandPortalMapSearchRun = {
    ...soldRun,
    rows: [{
      attrs: { 'data-propertyid': '125099999', 'data-fips': '47187', 'data-apn': '030-001.00-000', 'data-property-address': 'HWY 96', 'data-property-state': 'TN', 'data-property-zip': '37062' },
      text: '$1,200,000 For Sale HWY 96, TN, 37062 45.00 MLS acres',
    }],
    resultCount: 1,
  };

  it('runs sold + active passes, enriches, cross-checks Zillow and classifies', async () => {
    const searches: string[] = [];
    const zillow: SecondarySearchResult = {
      status: 'retrieved',
      note: 'Zillow sold search retrieved 2 rows.',
      comps: [
        // Duplicate of the Brush Creek sale (same price + month) → one comp.
        { address: 'Brush Creek Rd, Fairview, TN 37062', price: 900_000, acres: 40.2, status: 'sold', url: 'https://www.zillow.com/x', soldDate: '2026-02-02' },
        // A fresh in-pool vacant sale LandPortal missed.
        { address: '100 New Rd, Fairview, TN 37062', price: 1_050_000, acres: 35, status: 'sold', url: 'https://www.zillow.com/y', soldDate: '2026-04-01' },
      ],
    };
    const outcome = await LANDPORTAL_COMP_SEARCH_CAPABILITY.execute(
      rawRequest('landportal-comp-search'),
      {
        resolveSubject,
        runMapSearch: async (_url, plan) => {
          searches.push(plan.lane);
          return plan.status === 'sold' ? soldRun : activeRun;
        },
        readCompRecord: async () => recordRead({
          apn: '022-094.00-000',
          fields: { 'Parcel ID': '022-094.00-000', Acres: '1.750' },
          mlsFields: { 'MLS Description': 'Private acreage.', 'Lot Size Acres': '40.20', 'Building SqFt': '0' },
          redfinUrl: 'https://www.redfin.com/TN/Fairview/Brush-Creek-Rd-37062/home/87857624',
          listingLinks: [{ text: 'View on Redfin', href: 'https://www.redfin.com/TN/Fairview/Brush-Creek-Rd-37062/home/87857624' }],
        }),
        zillowSearch: async () => zillow,
        // Two accepted sold comps is thin, so the Realtor fallback IS invoked
        // here; a failing fallback is recorded, never fatal.
        realtorSearch: async () => { throw new Error('realtor route unavailable'); },
      },
      ENV,
    );
    expect(outcome.status).toBe('SUCCEEDED');
    expect(searches).toEqual(['sold_land', 'active_land']);
    const facts = outcome.facts;
    expect(facts.activeCandidateCount).toBe(1);
    const classified = facts.classified as Array<{ apn: string | null; tier: string; sources: string[]; redfinUrl: string | null; address: string | null }>;
    const brushCreek = classified.find((row) => row.apn === '022-094.00-000');
    expect(brushCreek?.tier).toBe('core');
    expect(brushCreek?.redfinUrl).toMatch(/redfin\.com/);
    expect(brushCreek?.sources).toContain('redfin');
    expect(brushCreek?.sources).toContain('zillow'); // the duplicate merged into ONE comp
    const freshZillow = classified.find((row) => row.address?.includes('100 New Rd'));
    expect(freshZillow?.tier).toBe('core');
    // The improved 52-acre Overby sale stays VISIBLE directional evidence —
    // never in the vacant-land median, never silently dropped.
    const overby = classified.find((row) => row.apn === '046-050.00-000') as { tier: string; improved: boolean; reason: string } | undefined;
    expect(overby?.tier).toBe('directional');
    expect(overby?.improved).toBe(true);
    expect(overby?.reason).toMatch(/improved sale/i);
    const valuation = facts.valuation as { coreCount: number; medianSoldPricePerAcre: number | null; landValueIndication: number | null };
    expect(valuation.coreCount).toBe(2);
    expect(valuation.landValueIndication).not.toBeNull();
    const diagnostics = facts.diagnostics as Array<{ source: string; searchAttempted: boolean; candidatesDiscovered: number; notes: string[] }>;
    const realtor = diagnostics.find((row) => row.source === 'realtor');
    expect(realtor?.searchAttempted).toBe(true);
    expect(realtor?.notes.join(' ')).toMatch(/fallback flow failed: realtor route unavailable/);
    const redfin = diagnostics.find((row) => row.source === 'redfin');
    // Brush Creek AND the (now directional-improved, still enriched) Overby
    // sale each exposed an exact Redfin link.
    expect(redfin?.candidatesDiscovered).toBe(2);
    expect((facts.readiness as { grade: string }).grade).toBe('green');
  });

  const acceptedComp = (over: Partial<ClassifiedLandPortalComp> = {}): ClassifiedLandPortalComp => ({
    candidate: {
      source: 'landportal_map_search', propertyId: 'p', fips: '47187', apn: 'x', mlsUuid: null, mlsUrl: null,
      address: 'X RD', city: null, state: 'TN', zip: '37062', lat: null, lng: null, price: 900_000,
      status: 'sold', mlsAcres: 40, lotSqft: null, buildingSqft: null, baths: null, saleDate: '2026-01-01',
      soldBy: null, pricePerAcre: 22_500, rawText: 'x',
    },
    tier: 'core', reason: 'test', acresUsed: 40, pricePerAcre: 22_500, distanceMiles: null,
    ...over,
  });

  describe('LandWatch large-acreage gate (additive at 20+ acres)', () => {
    it('CASE A: a sub-20-acre subject never adds LandWatch, however thin the evidence', () => {
      expect(shouldRunLandWatchFallback(19.9, [])).toBe(false);
      expect(shouldRunLandWatchFallback(19.9, [acceptedComp()])).toBe(false);
      expect(shouldRunLandWatchFallback(20, [])).toBe(true);
    });

    it('CASE B: a 50-acre subject with a strong primary sold set still adds LandWatch (additive, not a fallback)', () => {
      const strong = [acceptedComp(), acceptedComp(), acceptedComp()];
      expect(usableSoldEvidenceCount(strong)).toBe(3);
      expect(shouldRunLandWatchFallback(50, strong)).toBe(true);
    });

    it('CASE C: a 50-acre subject with a thin primary sold set triggers LandWatch', () => {
      expect(shouldRunLandWatchFallback(50, [acceptedComp()])).toBe(true);
    });

    it('a set that cannot state a median is thin, however many directional rows it has', () => {
      // Live Fairview shape: 1 core + 4 vacant directional = no statable
      // median = low confidence, so the 30+ acre fallback runs.
      const fairviewShape = [
        acceptedComp(),
        acceptedComp({ tier: 'directional' }), acceptedComp({ tier: 'directional' }),
        acceptedComp({ tier: 'directional' }), acceptedComp({ tier: 'directional' }),
      ];
      expect(shouldRunLandWatchFallback(75.91, fairviewShape)).toBe(true);
    });

    it('improved directional evidence never makes a thin set look sufficient', () => {
      const improvedHeavy = [acceptedComp(), acceptedComp({ tier: 'directional', improved: true }), acceptedComp({ tier: 'directional', improved: true })];
      expect(usableSoldEvidenceCount(improvedHeavy)).toBe(1);
      expect(shouldRunLandWatchFallback(50, improvedHeavy)).toBe(true);
    });
  });

  it('CASES C/D/E live in the flow: thin evidence invokes LandWatch; sold rows enter the universe, actives stay context', async () => {
    let landwatchInvoked = 0;
    const outcome = await LANDPORTAL_COMP_SEARCH_CAPABILITY.execute(
      rawRequest('landportal-comp-search'),
      {
        resolveSubject,
        // Only the one Brush Creek core sale comes back from LandPortal.
        runMapSearch: async (_url, plan) => (plan.status === 'sold'
          ? { ...soldRun, rows: [soldRun.rows[0]], resultCount: 1 }
          : { ...activeRun, rows: [] }),
        landwatchSearch: async (): Promise<SecondarySearchResult> => {
          landwatchInvoked += 1;
          return {
            status: 'retrieved',
            note: 'LandWatch verified Williamson County, TN: 2 candidate(s).',
            comps: [
              { address: '7000 Big Tract Rd, Fairview, TN, 37062', price: 1_200_000, acres: 60, status: 'sold', url: 'https://www.landwatch.com/x/pid/1', remark: 'Rolling pasture, long county-road frontage.' },
              // CASE D: an active LandWatch listing is market context only.
              { address: '0 Active Ln, Fairview, TN, 37062', price: 2_000_000, acres: 55, status: 'for_sale', url: 'https://www.landwatch.com/x/pid/2' },
            ],
          };
        },
      },
      ENV,
    );
    expect(outcome.status).toBe('SUCCEEDED');
    expect(landwatchInvoked).toBe(1);
    const classified = outcome.facts.classified as Array<{ source: string; address: string | null; tier: string; reason: string }>;
    const landwatchSold = classified.find((row) => row.source === 'landwatch');
    expect(landwatchSold?.address).toMatch(/Big Tract/);
    expect(landwatchSold?.tier).toBe('core');
    // The active listing never entered the sold candidate universe.
    expect(classified.find((row) => row.address?.includes('Active Ln'))).toBeUndefined();
    const diagnostics = outcome.facts.diagnostics as Array<{ source: string; searchAttempted: boolean; candidatesDiscovered: number; notes: string[] }>;
    const landwatchDiag = diagnostics.find((row) => row.source === 'landwatch');
    expect(landwatchDiag?.searchAttempted).toBe(true);
    expect(landwatchDiag?.candidatesDiscovered).toBe(1);
    expect(landwatchDiag?.notes.join(' ')).toMatch(/LandWatch added/i);
    expect(landwatchDiag?.notes.join(' ')).toMatch(/market context only/i);
    const valuation = outcome.facts.valuation as { coreCount: number; landValueIndication: number | null };
    expect(valuation.coreCount).toBe(2);
    expect(valuation.landValueIndication).not.toBeNull();
  });

  it('CASE B in the flow: sufficient primary evidence still adds LandWatch beside the other lanes', async () => {
    let landwatchInvoked = 0;
    const strongZillow: SecondarySearchResult = {
      status: 'retrieved',
      note: 'Zillow sold search retrieved 3 rows.',
      comps: [
        { address: '1 Strong Rd, Fairview, TN 37062', price: 800_000, acres: 40, status: 'sold', url: 'https://www.zillow.com/1' },
        { address: '2 Strong Rd, Fairview, TN 37062', price: 900_000, acres: 45, status: 'sold', url: 'https://www.zillow.com/2' },
      ],
    };
    const outcome = await LANDPORTAL_COMP_SEARCH_CAPABILITY.execute(
      rawRequest('landportal-comp-search'),
      {
        resolveSubject,
        runMapSearch: async (_url, plan) => (plan.status === 'sold'
          ? { ...soldRun, rows: [soldRun.rows[0]], resultCount: 1 }
          : { ...activeRun, rows: [] }),
        zillowSearch: async () => strongZillow,
        landwatchSearch: async (): Promise<SecondarySearchResult> => {
          landwatchInvoked += 1;
          return { status: 'retrieved', note: 'LandWatch ran additively', comps: [] };
        },
      },
      ENV,
    );
    expect(outcome.status).toBe('SUCCEEDED');
    // Additive: LandWatch runs once and the strong Zillow evidence stays in the set.
    expect(landwatchInvoked).toBe(1);
    const diagnostics = outcome.facts.diagnostics as Array<{ source: string; notes: string[] }>;
    expect(diagnostics.find((row) => row.source === 'landwatch')?.notes.join(' ')).toMatch(/LandWatch added/i);
    expect(diagnostics.find((row) => row.source === 'zillow')).toBeTruthy();
  });

  it('reports a collection failure as RED, never as market absence', async () => {
    const outcome = await LANDPORTAL_COMP_SEARCH_CAPABILITY.execute(
      rawRequest('landportal-comp-search'),
      {
        resolveSubject,
        runMapSearch: async () => ({ ...soldRun, applied: false, rows: [], resultCount: null, noPropertiesFound: null }),
      },
      ENV,
    );
    expect(outcome.status).toBe('SUCCEEDED');
    const readiness = outcome.facts.readiness as { grade: string; reason: string };
    expect(readiness.grade).toBe('red');
    expect(readiness.reason).toMatch(/collection failure/);
  });
});
