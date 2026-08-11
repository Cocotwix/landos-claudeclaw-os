// Comps & Valuation workspace: classification, LandPortal surface origins,
// automatic provisional valuation, operator refinement, proximity-first
// ranking, and distance calculation.
//
// Contract under test: at least two credible closed vacant-land sales
// AUTOMATICALLY form the provisional valuation set (no manual Include gate);
// operator exclusions (with retained reasons) and restorations refine the set
// and recalculate immediately; fewer than two credible closed sales returns
// the valuation to insufficient-evidence status; asking references, actives,
// improved context, and rejected rows are preserved and displayed but can
// never enter FMV; distance is one consistent haversine calculation and
// unresolved locations are never guessed.

import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { upsertPropertyCard } from './property-card.js';
import { addComp, getComp } from './comps.js';
import {
  buildCompsValuationView,
  computeCompsValuation,
  detectImprovedProperty,
  readSubjectImprovement,
  reconcileNegotiation,
  setCompValuationSelection,
  haversineMiles,
  type WorkspaceComp,
} from './comps-valuation.js';
import { PropertyResearchStore } from './property-research-store.js';

const NOW = Date.parse('2026-08-04T12:00:00Z');

const SUBJECT_POINT = { lat: 43.33, lng: -76.65 };
const CLINTON_POINT = { lat: 43.0423195, lng: -76.5755962 };
const EAST_ST_POINT = { lat: 43.047844, lng: -76.5558735 };

describe('improved-property detection', () => {
  it('finds residential, structure-size, and house-text signals with named evidence', () => {
    expect(detectImprovedProperty({ propertyClass: 'residential' })).toMatchObject({ improved: true, evidence: expect.stringMatching(/property class/i) });
    expect(detectImprovedProperty({ buildingSqft: 1000 })).toMatchObject({ improved: true, evidence: expect.stringMatching(/1,000 sqft/i) });
    expect(detectImprovedProperty({ descriptionText: 'Three bedroom, two bathroom home' })).toMatchObject({ improved: true, evidence: expect.stringMatching(/bedroom/i) });
  });

  it('does not invent improvement for land or vacant-land inputs', () => {
    expect(detectImprovedProperty({})).toEqual({ improved: false, evidence: null });
    expect(detectImprovedProperty({ propertyClass: 'land' })).toEqual({ improved: false, evidence: null });
    expect(detectImprovedProperty({ classification: 'active vacant land', notes: 'undeveloped acreage' }))
      .toEqual({ improved: false, evidence: null });
  });

  // Zillow rows arrive with their card fragments concatenated, so the structure
  // keyword is glued to the fragment before it and a word boundary cannot see
  // it. These are the real strings that put eleven house listings under active
  // vacant-land competition on 9490 Elk Lake Rd.
  it('sees the structure keyword in concatenated marketplace text', () => {
    for (const addressDesc of [
      '208 sqftHouse for sale10892 Lakeshore Rd, Elk Rapids, MI 49629',
      '757 sqftHouse for sale8739 Skegemog Point Rd, Williamsburg, MI 49690',
      '1,240 sqftTownhouse for sale12 Example Ct, Traverse City, MI 49686',
    ]) {
      expect(detectImprovedProperty({ addressDesc })).toMatchObject({ improved: true });
    }
    expect(detectImprovedProperty({ notes: '3 bdHouse for sale on 5 acres' })).toMatchObject({ improved: true });
  });

  it('still reads concatenated vacant-land text as vacant land', () => {
    expect(detectImprovedProperty({ addressDesc: '40 acresLot / Land for sale0 Vacant Ridge Rd, Williamsburg, MI 49690' }))
      .toEqual({ improved: false, evidence: null });
    expect(detectImprovedProperty({ addressDesc: '5.2 acresLand for saleTBD Elk Lake Rd, Williamsburg, MI 49690' }))
      .toEqual({ improved: false, evidence: null });
  });
});

function seedSubject(opts: { withCoords?: boolean } = {}): { dealCardId: number; cardId: number } {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Comps & Valuation subject' });
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: '1487 Onionville Rd',
    county: 'Cayuga',
    state: 'NY',
    apn: '055689 10.00-1-64.22',
    acres: 11.46,
    verified: true,
    verificationSource: 'test',
    agentId: 'test',
    ...(opts.withCoords ? SUBJECT_POINT : {}),
  } as Parameters<typeof upsertPropertyCard>[0]);
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' } as Parameters<typeof linkPropertyToDeal>[0]);
  return { dealCardId: deal.id, cardId: card.id };
}

const MERGED_ATTRIBUTIONS = [
  { provider: 'Hermes / LandPortal', url: null },
  { provider: 'LandPortal sidebar', url: null },
  { provider: 'LandPortal Show on Map', url: 'https://landportal.com/NY/Weedsport/Clinton-Rd-13166/home/73216983' },
];

function seedClosedSale(ids: { dealCardId: number; cardId: number }, over: Partial<Parameters<typeof addComp>[0]> = {}) {
  return addComp({
    entity: 'TY_LAND_BIZ',
    dealCardId: ids.dealCardId,
    cardId: ids.cardId,
    sourceLabel: 'LandPortal',
    sourceUrl: 'https://landportal.com/NY/Weedsport/Clinton-Rd-13166/home/73216983',
    addressDesc: 'Clinton Rd, WEEDSPORT, NY 13166',
    apn: '052289 77.00-2-27.113',
    county: 'Cayuga',
    state: 'NY',
    price: 129000,
    priceKind: 'sale',
    saleOrListDate: '2026-03-10',
    acres: 16.88,
    notes: 'Merged LandPortal sidebar + Show on Map records (deduplicated by APN/price/acres). Sold by hamilton joseph.',
    addedBy: 'test',
    propertyClass: 'land',
    sourceAttributions: MERGED_ATTRIBUTIONS,
    ...over,
  });
}

function seedEastSt(ids: { dealCardId: number; cardId: number }, over: Partial<Parameters<typeof addComp>[0]> = {}) {
  return seedClosedSale(ids, {
    addressDesc: '0 East St, WEEDSPORT, NY 13166', apn: '052201 83.10-1-2.1',
    sourceUrl: 'https://landportal.com/NY/Weedsport/East-St-13166/home/73218454',
    price: 57500, acres: 6.5, saleOrListDate: '2024-11-14',
    notes: 'Merged LandPortal sidebar + Show on Map records (deduplicated by APN/price/acres). Sold by dubar dakota.',
    ...over,
  });
}

beforeEach(() => {
  _initTestLandosDb();
});

describe('workspace classification', () => {
  it('reads an existing dated LandPortal unknown-kind row as its source-stated sale', () => {
    const ids = seedSubject();
    seedClosedSale(ids, {
      priceKind: 'unknown',
      saleOrListDate: '2026-02-12',
      notes: 'Hermes-imported LandPortal comparable from the retained source row.',
    });
    const comp = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!.comps[0];
    expect(comp.category).toBe('accepted_closed_sale');
    expect(comp.priceKind).toBe('sale');
    expect(comp.classificationReason).toMatch(/LandPortal stated the sale date 2026-02-12/i);
  });

  it('auto-selects a credible closed vacant-land sale but stays insufficient below two sales', () => {
    const ids = seedSubject();
    seedClosedSale(ids);
    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    expect(view.comps).toHaveLength(1);
    const comp = view.comps[0];
    expect(comp.category).toBe('accepted_closed_sale');
    expect(comp.eligibleForValuation).toBe(true);
    expect(comp.selectedForValuation).toBe(true);
    expect(comp.selectionMode).toBe('auto');
    expect(comp.classificationReason).toContain('completed sale');
    expect(comp.soldBy).toBe('hamilton joseph');
    // One credible sale is not enough: the valuation returns to insufficient.
    expect(view.summary.status).toBe('insufficient');
    expect(view.summary.acceptedCount).toBe(1);
    expect(view.summary.fmv).toBeNull();
    expect(view.summary.acquisitionLevels).toBeNull();
    expect(view.summary.statusReason).toContain('At least two');
  });

  it('classifies an improved-property sale as context and refuses to let it into valuation', () => {
    const ids = seedSubject();
    const comp = seedClosedSale(ids, {
      addressDesc: '14974 Juniper Hill Rd, STERLING, NY 13156',
      apn: '055689 6.00-1-10.4',
      price: 160000,
      acres: 14.6,
      propertyClass: 'improved',
      notes: 'Sold by gugino john t. Building 1,836 SqFt on parcel (improved property context, not vacant-land sale evidence).',
    });
    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    expect(view.comps[0].category).toBe('improved_context');
    expect(view.comps[0].buildingSqft).toBe(1836);
    expect(view.comps[0].eligibleForValuation).toBe(false);
    const result = setCompValuationSelection({ dealCardId: ids.dealCardId, compId: comp.id, action: 'include' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Improved-property context');
  });

  it('classifies an ACTIVE improved listing as improved-property context, never active vacant-land competition', () => {
    const ids = seedSubject();
    seedClosedSale(ids, {
      addressDesc: '15196 State Route 104, Martville, NY 13111',
      apn: '999900001111',
      sourceLabel: 'Redfin',
      sourceUrl: 'https://www.redfin.com/NY/Martville/15196-State-Route-104-13111/home/73205599',
      price: 55000, acres: 7.1,
      priceKind: 'list',
      listingDate: '2026-06-01',
      propertyClass: 'improved',
      notes: 'Source confirms a residential improvement on the parcel.',
    });
    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    const comp = view.comps[0];
    expect(comp.category).toBe('improved_context');
    expect(comp.statusLabel).toBe('Active listing (improved)');
    expect(comp.eligibleForValuation).toBe(false);
    expect(comp.classificationReason).toContain('never enters the vacant-land sold-price median');
  });

  it('keeps asking references and rejected rows out of eligibility while preserving their reasons', () => {
    const ids = seedSubject();
    const asking = seedClosedSale(ids, { priceKind: 'list', addressDesc: 'Asking Ref Rd', apn: '111122223333' });
    seedClosedSale(ids, {
      status: 'rejected', addressDesc: 'Wrong Market Ln', apn: '999988887777',
      inclusionReason: 'Wrong state for the subject market.',
    });
    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    const byAddress = (a: string) => view.comps.find((row) => row.address === a)!;
    expect(byAddress('Asking Ref Rd').category).toBe('asking_reference');
    expect(byAddress('Wrong Market Ln').category).toBe('rejected');
    expect(byAddress('Wrong Market Ln').classificationReason).toContain('Wrong state');
    const include = setCompValuationSelection({ dealCardId: ids.dealCardId, compId: asking.id, action: 'include' });
    expect(include.ok).toBe(false);
  });

  it('retains LandPortal sidebar + Show on Map origins and merge status from the canonical record', () => {
    const ids = seedSubject();
    seedClosedSale(ids);
    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    const comp = view.comps[0];
    expect(comp.fromLandPortalSidebar).toBe(true);
    expect(comp.fromLandPortalShowOnMap).toBe(true);
    expect(comp.mergeStatus).toContain('Merged LandPortal sidebar + Show on Map');
    expect(view.landPortal.sidebarCount).toBe(1);
    expect(view.landPortal.showOnMapCount).toBe(1);
    expect(view.landPortal.mergedUniqueCount).toBe(1);
  });

  it('surfaces research-evidence actives (e.g. Redfin) without double-counting persisted rows', () => {
    const ids = seedSubject();
    seedClosedSale(ids);
    new PropertyResearchStore().loadForProperty(ids.cardId); // ensure tables
    getLandosDb().prepare(
      `INSERT INTO landos_property_research_record (property_card_id, deal_card_id, canonical_key, record_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(ids.cardId, ids.dealCardId, `property-card:${ids.cardId}`, JSON.stringify({
      contractVersion: 'canonical-property-research-v1',
      propertyCardId: ids.cardId,
      dealCardId: ids.dealCardId,
      canonicalKey: `property-card:${ids.cardId}`,
      identity: {},
      facts: {},
      evidence: [
        {
          id: 'redfin:https://www.redfin.com/NY/Sterling/14710-Lake-St',
          providerId: 'redfin', field: 'comparables.redfin.0', kind: 'comp',
          value: { address: '14710 Lake St, Sterling, NY 13156', price: 199900, acres: null, url: 'https://www.redfin.com/NY/Sterling/14710-Lake-St', status: 'active' },
          sourceUrl: 'https://www.redfin.com/NY/Sterling/14710-Lake-St',
          strength: 'provider_observed', subjectClassification: 'context_only', retrievedAt: '2026-08-03T17:03:55.195Z',
        },
        {
          // Same APN from a richer provider must merge, not become another comp.
          id: 'zillow:comp:dupe',
          providerId: 'zillow', field: 'comparables.zillow.x', kind: 'comp',
          value: {
            price: 129000, acres: 16.88, apn: '052289 77.00-2-27.113', status: 'sold',
            propertyType: 'single family', homeSizeSqft: 1800, description: 'Improved residence on acreage',
            url: 'https://www.zillow.com/homedetails/Clinton-Rd/73216983',
          },
          sourceUrl: 'https://www.zillow.com/homedetails/Clinton-Rd/73216983',
          strength: 'provider_observed', subjectClassification: 'context_only', retrievedAt: '2026-08-03T22:47:18.904Z',
        },
      ],
      lanes: {}, rejectedEvidence: [], createdAt: '2026-08-03', updatedAt: '2026-08-03',
    }), '2026-08-03', '2026-08-03');
    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    expect(view.counts.total).toBe(2);
    expect(view.canonicalCompCount).toBe(view.counts.total);
    expect(view.duplicatesMerged).toBeGreaterThanOrEqual(1);
    const reconciledImproved = view.comps.find((row) => row.apn === '052289 77.00-2-27.113')!;
    expect(reconciledImproved.category).toBe('improved_context');
    expect(reconciledImproved.inValuationSet).toBe(false);
    expect(reconciledImproved.source).toMatch(/LandPortal.*Zillow|Zillow.*LandPortal/);
    const active = view.comps.find((row) => row.category === 'active_competition')!;
    expect(active.source).toBe('Redfin');
    expect(active.eligibleForValuation).toBe(false);
    expect(active.price).toBe(199900);
    expect(active.acres).toBeNull();
    // Unresolved location: no coordinates, no distance, never guessed.
    expect(active.locationResolved).toBe(false);
    expect(active.lat).toBeNull();
    expect(active.distanceMiles).toBeNull();
  });
});

describe('automatic provisional valuation and operator refinement', () => {
  it('two credible closed sales automatically form the provisional valuation set with no manual Include', () => {
    const ids = seedSubject();
    seedClosedSale(ids);
    seedEastSt(ids);

    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    expect(view.summary.acceptedCount).toBe(2);
    expect(view.summary.status).toBe('provisional');
    expect(view.summary.basisLabel).toBe('Provisional valuation based on 2 closed vacant-land sales');
    // The median stays visible as a cross-check but no longer prices the
    // subject alone: median of 129000/16.88 = 7642.18 and 57500/6.5 = 8846.15.
    expect(view.summary.medianPricePerAcre).toBe(8244);
    expect(view.summary.ppaBand).toEqual({ low: 7642, median: 8244, high: 8846 });
    expect(view.cleaned.medianIndication).toBe(94500); // 8244.17 × 11.46
    expect(view.cleaned.avgIndication).toBe(94500);
    // The central value and the 40/50/60 levels derive from the ADOPTED cleaned
    // FMV (weighted direct comps lead, reconciled with median and average).
    expect(view.cleaned.adoptedFmv).toBe(93500);
    expect(view.summary.fmv?.central).toBe(view.cleaned.adoptedFmv);
    expect(view.summary.fmv?.low).toBe(87500);
    expect(view.summary.fmv?.high).toBe(101500);
    expect(view.summary.acquisitionLevels).toEqual({ pct40: 37500, pct50: 47000, pct60: 56000 });
    // Both sales entered automatically; no operator include was recorded.
    for (const comp of view.comps) {
      expect(comp.selectedForValuation).toBe(true);
      expect(comp.selectionMode).toBe('auto');
    }
    expect(view.summary.confidence === 'low' || view.summary.confidence === 'moderate').toBe(true);
  });

  it('exclude preserves the reason and returns the valuation to insufficient below two sales; restore recovers the auto set', () => {
    const ids = seedSubject();
    seedClosedSale(ids);
    const second = seedEastSt(ids);

    const excluded = setCompValuationSelection({
      dealCardId: ids.dealCardId, compId: second.id, action: 'exclude', reason: 'Half the subject acreage; too small to anchor value.',
    });
    expect(excluded.ok).toBe(true);
    let view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    expect(view.summary.acceptedCount).toBe(1);
    expect(view.summary.status).toBe('insufficient');
    expect(view.summary.medianPricePerAcre).toBeNull();
    expect(view.summary.acquisitionLevels).toBeNull();
    const excludedComp = view.comps.find((row) => row.compId === second.id)!;
    expect(excludedComp.category).toBe('candidate_closed_sale');
    expect(excludedComp.operatorExcluded).toBe(true);
    expect(excludedComp.exclusionReason).toContain('too small');

    expect(setCompValuationSelection({ dealCardId: ids.dealCardId, compId: second.id, action: 'restore' }).ok).toBe(true);
    view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    expect(view.summary.acceptedCount).toBe(2);
    expect(view.summary.status).toBe('provisional');
    expect(view.summary.medianPricePerAcre).toBe(8244);
    // Restore returns the row to the automatic provisional default (persisted).
    expect(getComp(second.id)!.valuation_selected).toBe(0);
    expect(view.comps.find((row) => row.compId === second.id)!.selectionMode).toBe('auto');
  });

  it('reaches supported status with three credible sales and explains the median', () => {
    const ids = seedSubject();
    seedClosedSale(ids);
    seedClosedSale(ids, { addressDesc: 'B Rd', apn: '222233334444', sourceUrl: 'https://landportal.com/b', price: 57500, acres: 6.5, saleOrListDate: '2024-11-14' });
    seedClosedSale(ids, { addressDesc: 'C Rd', apn: '333344445555', sourceUrl: 'https://landportal.com/c', price: 96000, acres: 12, saleOrListDate: '2025-09-01' });
    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    expect(view.summary.status).toBe('supported');
    // PPAs: 7642.18, 8846.15, 8000 → median 8000, still shown as a cross-check.
    expect(view.summary.medianPricePerAcre).toBe(8000);
    expect(view.cleaned.medianIndication).toBe(round500(8000 * 11.46));
    // The adopted cleaned FMV governs the central value, not the median alone.
    expect(view.cleaned.adoptedFmv).not.toBeNull();
    expect(view.summary.fmv?.central).toBe(view.cleaned.adoptedFmv);
    expect(view.explanation.medianNote).toContain('Median of 3');
    expect(view.explanation.used).toHaveLength(3);
    expect(view.summary.confidence === 'moderate' || view.summary.confidence === 'high').toBe(true);
    expect(view.summary.confidenceFactors.length).toBeGreaterThan(1);
  });

  it('with zero credible sales the valuation is honestly insufficient and levels stay locked', () => {
    const ids = seedSubject();
    seedClosedSale(ids, { priceKind: 'list' });
    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    expect(view.summary.status).toBe('insufficient');
    expect(view.summary.statusLabel).toBe('Insufficient closed-sale evidence');
    expect(view.summary.fmv).toBeNull();
    expect(view.summary.medianPricePerAcre).toBeNull();
    expect(view.summary.acquisitionLevels).toBeNull();
    expect(view.summary.acquisitionLockedReason).toContain('remain locked');
    expect(view.summary.confidence).toBe('unavailable');
    expect(view.explanation.neededEvidence.join(' ')).toContain('closed vacant-land sale');
  });

  it('computeCompsValuation never derives value from a listing price kind', () => {
    const asking: WorkspaceComp[] = []; // accepted set is empty by construction
    const { summary } = computeCompsValuation(asking, 11.46, NOW);
    expect(summary.status).toBe('insufficient');
    expect(summary.fmv).toBeNull();
  });

  it('rejects selection actions for comps on a different deal', () => {
    const ids = seedSubject();
    const other = seedSubject();
    const comp = seedClosedSale(ids);
    const result = setCompValuationSelection({ dealCardId: other.dealCardId, compId: comp.id, action: 'include' });
    expect(result.ok).toBe(false);
  });
});

describe('proximity-first distance and radius disclosure', () => {
  it('computes one consistent haversine distance from the subject to every resolved record', () => {
    const ids = seedSubject({ withCoords: true });
    seedClosedSale(ids, CLINTON_POINT);
    seedEastSt(ids, EAST_ST_POINT);
    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    expect(view.subject.lat).toBe(SUBJECT_POINT.lat);
    const clinton = view.comps.find((c) => c.address?.includes('Clinton'))!;
    const eastSt = view.comps.find((c) => c.address?.includes('East St'))!;
    expect(clinton.distanceMiles).toBe(haversineMiles(SUBJECT_POINT, CLINTON_POINT));
    expect(eastSt.distanceMiles).toBe(haversineMiles(SUBJECT_POINT, EAST_ST_POINT));
    expect(clinton.locationResolved).toBe(true);
    expect(clinton.locationMethod).toBe('provider_map_point');
    expect(clinton.outsideInitialRadius).toBe(true);
    expect(view.summary.distanceRange).not.toBeNull();
    expect(view.summary.distanceRange!.maxMiles).toBeGreaterThan(view.summary.distanceRange!.minMiles - 0.001);
  });

  it('discloses the expanded search band when no credible sale lies inside the initial 10 miles', () => {
    const ids = seedSubject({ withCoords: true });
    seedClosedSale(ids, CLINTON_POINT);
    seedEastSt(ids, EAST_ST_POINT);
    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    expect(view.summary.radius.initialMiles).toBe(10);
    expect(view.summary.radius.expanded).toBe(true);
    expect(view.summary.radius.usedMiles).toBeGreaterThanOrEqual(20);
    expect(view.summary.radius.note).toContain('expanded');
    expect(view.summary.radius.note).toContain('never excluded by a county line');
  });

  it('stays inside the initial radius when the supporting sales are within 10 miles', () => {
    const ids = seedSubject({ withCoords: true });
    seedClosedSale(ids, { lat: 43.40, lng: -76.65 });
    seedEastSt(ids, { lat: 43.26, lng: -76.63 });
    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    expect(view.summary.radius.usedMiles).toBe(10);
    expect(view.summary.radius.expanded).toBe(false);
    for (const comp of view.comps) expect(comp.outsideInitialRadius).toBe(false);
  });

  it('a nearby out-of-county closed sale stays in the set: county never disqualifies', () => {
    const ids = seedSubject({ withCoords: true });
    seedClosedSale(ids, CLINTON_POINT);
    seedEastSt(ids, { ...EAST_ST_POINT, county: 'Onondaga', addressDesc: 'River Rd, Jordan, NY 13080', apn: '888877776666', sourceUrl: 'https://www.zillow.com/homedetails/River-Rd-Jordan-NY-13080/450366450_zpid/' });
    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    const outOfCounty = view.comps.find((c) => c.county === 'Onondaga')!;
    expect(outOfCounty.category).toBe('accepted_closed_sale');
    expect(outOfCounty.selectedForValuation).toBe(true);
    expect(view.summary.acceptedCount).toBe(2);
    expect(view.summary.confidenceFactors.join(' ')).toContain('county');
    expect(outOfCounty.keyDifference).toContain('Onondaga');
  });

  it('an unresolved location shows no distance and the record is never placed at a guessed point', () => {
    const ids = seedSubject({ withCoords: true });
    seedClosedSale(ids); // no coordinates, no geocode cache entry
    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    const comp = view.comps[0];
    expect(comp.locationResolved).toBe(false);
    expect(comp.lat).toBeNull();
    expect(comp.lng).toBeNull();
    expect(comp.distanceMiles).toBeNull();
    expect(comp.outsideInitialRadius).toBeNull();
  });

  it('falls back to the retained geocode cache for a persisted comp without provider coordinates', () => {
    const ids = seedSubject({ withCoords: true });
    seedClosedSale(ids); // no provider coords
    getLandosDb().prepare(
      `INSERT INTO landos_geocode_cache (address_key, lat, lng, provider, created_at) VALUES (?, ?, ?, 'us_census', strftime('%s','now'))`,
    ).run('clinton rd, weedsport, ny 13166', CLINTON_POINT.lat, CLINTON_POINT.lng);
    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    const comp = view.comps[0];
    expect(comp.locationResolved).toBe(true);
    expect(comp.locationMethod).toBe('address_geocode');
    expect(comp.locationSource).toContain('US Census');
    expect(comp.distanceMiles).toBe(haversineMiles(SUBJECT_POINT, CLINTON_POINT));
  });
});

describe('radius counts, comparability tiers, and the technical quick-flip ceiling', () => {
  it('never claims an expansion when two or more credible sales lie inside the initial radius', () => {
    const ids = seedSubject({ withCoords: true });
    // Three sales, all comfortably inside 10 miles of the subject.
    seedClosedSale(ids, { lat: 43.30, lng: -76.64 });
    seedEastSt(ids, { lat: 43.26, lng: -76.63 });
    seedClosedSale(ids, {
      addressDesc: 'Near Rd', apn: '444455556666', sourceUrl: 'https://landportal.com/near',
      price: 60000, acres: 10, saleOrListDate: '2026-02-01', lat: 43.36, lng: -76.62,
    });

    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    const radius = view.summary.radius;
    expect(radius.withinInitial).toBe(3);
    expect(radius.withinExpansion).toBe(0);
    expect(radius.expanded).toBe(false);
    // The narrative must match the evidence, not infer expansion from the
    // farthest record.
    expect(radius.note).toContain('no expansion was required');
    expect(radius.note).not.toContain('Fewer than two');
    expect(radius.note).not.toContain('Only 3');
    // The confidence factor repeats the same counted rings.
    expect(view.summary.confidenceFactors.join(' ')).toContain('inside the initial 10-mile radius');
  });

  it('counts each ring separately when farther sales corroborate a sufficient initial set', () => {
    const ids = seedSubject({ withCoords: true });
    seedClosedSale(ids, { lat: 43.30, lng: -76.64 });   // ~2 mi
    seedEastSt(ids, { lat: 43.26, lng: -76.63 });       // ~5 mi
    seedClosedSale(ids, {                                // ~14 mi: expansion ring
      addressDesc: 'Ring Rd', apn: '555566667777', sourceUrl: 'https://landportal.com/ring',
      price: 70000, acres: 12, saleOrListDate: '2025-12-01', lat: 43.13, lng: -76.60,
    });

    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    const radius = view.summary.radius;
    expect(radius.withinInitial).toBe(2);
    expect(radius.withinExpansion).toBe(1);
    expect(radius.expanded).toBe(false);
    expect(radius.note).toContain('additional corroboration, not because the initial radius came up short');
  });

  it('separates direct, supporting, boundary, and out-of-window sales instead of one flat pile', () => {
    const ids = seedSubject({ withCoords: true });
    // Direct: inside the 10-mile radius and inside the selected window.
    seedClosedSale(ids, {
      addressDesc: 'Direct Rd', apn: '111122223333', sourceUrl: 'https://landportal.com/direct',
      price: 55000, acres: 10, saleOrListDate: '2026-05-01', lat: 43.30, lng: -76.64,
    });
    // Supporting: in the window and the band, but out in the 10-to-20-mile ring.
    seedClosedSale(ids, {
      addressDesc: 'Support Rd', apn: '222233334444', sourceUrl: 'https://landportal.com/support',
      price: 60000, acres: 12, saleOrListDate: '2026-04-01', lat: 43.13, lng: -76.60,
    });
    // Boundary: in the window, but previously retained beyond the 20-mile
    // search boundary — a documented locational difference.
    seedClosedSale(ids, {
      addressDesc: 'Boundary Rd', apn: '333344445555', sourceUrl: 'https://landportal.com/boundary',
      price: 40000, acres: 14, saleOrListDate: '2026-03-01', ...CLINTON_POINT,
    });
    // Historical context: well past 30 months, so it can never price anything.
    seedClosedSale(ids, {
      addressDesc: 'Old Rd', apn: '444455556666', sourceUrl: 'https://landportal.com/old',
      price: 40000, acres: 14, saleOrListDate: '2023-01-01', lat: 43.20, lng: -76.60,
    });

    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    const comp = (addr: string) => view.comps.find((c) => c.address?.startsWith(addr))!;
    expect(comp('Direct Rd').valuationRole).toBe('direct');
    expect(comp('Support Rd').valuationRole).toBe('supporting');
    expect(comp('Boundary Rd').valuationRole).toBe('supporting');
    expect(comp('Old Rd').valuationRole).toBe('historical_context');
    expect(view.cleaned.directCount).toBe(1);
    expect(view.cleaned.supportingCount).toBe(2);
    expect(view.cleaned.boundaryCount).toBe(0);
    expect(view.cleaned.historicalContextCount).toBe(1);

    // The three in-window sales price the subject; the 30-plus-month sale does
    // not, and the beyond-20 supporting sale carries reduced tier weight.
    expect(view.cleaned.cleanedCount).toBe(3);
    expect(comp('Old Rd').inValuationSet).toBe(false);
    expect(comp('Old Rd').valuationWeight).toBeNull();
    expect(comp('Boundary Rd').valuationWeight!).toBeLessThan(comp('Direct Rd').valuationWeight!);

    // Every resolved record also discloses which search stage covers it.
    expect(comp('Direct Rd').radiusStage).toBe('initial_10');
    expect(comp('Boundary Rd').radiusStage).toBe('beyond_20');
  });

  it('reconciles the cleaned FMV from average, median, and weighted indications', () => {
    const ids = seedSubject({ withCoords: true });
    seedClosedSale(ids, { lat: 43.30, lng: -76.64 });
    seedEastSt(ids, { lat: 43.26, lng: -76.63 });

    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    const cleaned = view.cleaned;
    expect(cleaned.cleanedAvgPpa).not.toBeNull();
    expect(cleaned.cleanedMedianPpa).not.toBeNull();
    expect(cleaned.weightedPpa).not.toBeNull();
    expect(cleaned.avgIndication).not.toBeNull();
    expect(cleaned.medianIndication).not.toBeNull();
    expect(cleaned.weightedIndication).not.toBeNull();
    expect(cleaned.lowObservedIndication).not.toBeNull();
    expect(cleaned.highObservedIndication).not.toBeNull();
    expect(cleaned.adoptedFmv).not.toBeNull();
    // The adopted value is a reconciliation, never the bare median.
    const lines = cleaned.reconciliationLines.join(' ');
    expect(lines).toContain('Cleaned average supports');
    expect(lines).toContain('Cleaned median supports');
    expect(lines).toContain('Weighted direct comps support');
    expect(lines).toContain('Adopted cleaned FMV is');
    // Every displayed acquisition level derives from the adopted value.
    expect(view.summary.fmv!.central).toBe(cleaned.adoptedFmv);
    expect(view.summary.acquisitionLevels!.pct40).toBe(round500(cleaned.adoptedFmv! * 0.4));
    expect(view.summary.acquisitionLevels!.pct60).toBe(round500(cleaned.adoptedFmv! * 0.6));
  });

  it('derives the technical quick-flip ceiling and reconciles it against the 40/50/60 band', () => {
    const ids = seedSubject({ withCoords: true });
    seedClosedSale(ids, { lat: 43.30, lng: -76.64 });
    seedEastSt(ids, { lat: 43.26, lng: -76.63 });

    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    const qf = view.quickFlip!;
    const neg = view.negotiation!;
    expect(qf.expectedSalePrice).toBe(view.cleaned.adoptedFmv);
    // Sale price minus every cost bucket minus required profit = the ceiling.
    const costs = qf.sellingCosts + qf.sellerClosingCosts + qf.carryingCosts
      + qf.financingCosts + qf.improvementCosts + qf.riskReserve;
    expect(qf.totalNonAcquisitionCosts).toBe(costs);
    expect(qf.technicalMaxOffer).toBe(round500(qf.expectedSalePrice - costs - qf.requiredProfit));
    expect(qf.technicalMaxPctOfFmv).toBe(Math.round((qf.technicalMaxOffer / qf.expectedSalePrice) * 100));
    // Cost percentages are labeled assumptions, never verified property facts.
    expect(qf.assumptions.some((a) => a.basis === 'landos_operating_assumption')).toBe(true);
    expect(qf.confidenceNote).toContain('operator revisable');
    // The reconciliation states where the technical ceiling falls.
    expect(['technical_inside_band', 'technical_above_band', 'technical_below_band']).toContain(neg.ceilingBasis);
    expect(neg.standardBand.pct40).toBe(view.summary.acquisitionLevels!.pct40);
    expect(neg.hardCeiling).toBe(qf.technicalMaxOffer);
    expect(neg.remainingAssumptions.length).toBeGreaterThan(0);

    const landBasis = reconcileNegotiation(view.cleaned, qf, view.summary.acquisitionLevels, 'land_basis')!;
    expect(landBasis).toMatchObject({
      referenceScope: 'land_basis',
      openingLabel: 'Land-basis opening reference',
      targetLabel: 'Land-basis target reference',
      ceilingLabel: 'Land-basis ceiling reference',
    });
    expect(landBasis.lines.join(' ')).toMatch(/not completed whole-property offer recommendations/i);
  });

  it('attributes a LandOS exclusion to LandOS and the operator exclusion to the operator', () => {
    const ids = seedSubject({ withCoords: true });
    seedClosedSale(ids, { lat: 43.30, lng: -76.64 });
    const byLandos = seedEastSt(ids, { lat: 43.26, lng: -76.63 });
    const byTyler = seedClosedSale(ids, {
      addressDesc: 'Tyler Rd', apn: '666677778888', sourceUrl: 'https://landportal.com/tyler',
      price: 50000, acres: 9, saleOrListDate: '2026-01-01', lat: 43.34, lng: -76.66,
    });

    setCompValuationSelection({
      dealCardId: ids.dealCardId, compId: byLandos.id, action: 'exclude',
      reason: 'Documented waterfront frontage not shared by the subject.',
      actor: 'landos/comps-valuation-sprint',
    });
    setCompValuationSelection({
      dealCardId: ids.dealCardId, compId: byTyler.id, action: 'exclude',
      reason: 'Operator judgement.', actor: 'tyler/manual',
    });

    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    const landosRow = view.comps.find((c) => c.compId === byLandos.id)!;
    const tylerRow = view.comps.find((c) => c.compId === byTyler.id)!;
    expect(landosRow.exclusionActor).toBe('landos');
    expect(landosRow.classificationReason).toContain('Excluded from the valuation set by LandOS');
    expect(landosRow.classificationReason).toContain('restorable');
    expect(tylerRow.exclusionActor).toBe('operator');
    expect(tylerRow.classificationReason).toContain('Excluded from valuation by the operator');
    // Both remain restorable evidence, never deleted.
    expect(landosRow.category).toBe('candidate_closed_sale');
    expect(tylerRow.category).toBe('candidate_closed_sale');
  });

  it('holds an unproven concern as reduced-confidence context instead of asserting a defect', () => {
    const ids = seedSubject({ withCoords: true });
    seedClosedSale(ids, { lat: 43.30, lng: -76.64 });
    seedEastSt(ids, { lat: 43.26, lng: -76.63 });
    const suspect = seedClosedSale(ids, {
      addressDesc: 'Suspect Rd', apn: '777788889999', sourceUrl: 'https://landportal.com/suspect',
      price: 17000, acres: 8.5, saleOrListDate: '2025-07-30', lat: 43.28, lng: -76.60,
      classification: 'unverified_concern_context',
      inclusionReason: 'Wetland suitability is an open question, but no soil survey or delineation has been retrieved to prove it',
    });

    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    const row = view.comps.find((c) => c.compId === suspect.id)!;
    // Retained and inspectable, out of the cleaned value, and honest that the
    // concern is unproven — never excluded on inference.
    expect(row.category).toBe('context_only');
    expect(row.operatorExcluded).toBe(false);
    expect(row.eligibleForValuation).toBe(false);
    expect(row.classificationReason).toContain('open question');
    expect(row.classificationReason).toContain('rather than asserting a defect');
    expect(view.cleaned.cleanedCount).toBe(2);
  });

  it('reconciles retained versus mapped counts for every category', () => {
    const ids = seedSubject({ withCoords: true });
    seedClosedSale(ids, { lat: 43.30, lng: -76.64 });
    seedEastSt(ids); // no coordinates: retained but unplotted

    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    const mc = view.mapCounts;
    expect(mc.retained).toBe(view.counts.total);
    expect(mc.mapped + mc.unresolved).toBe(mc.retained);
    // Per category the same identity must hold, so the map legend and the
    // evidence registry can only differ by the disclosed unresolved records.
    let retainedSum = 0;
    for (const [category, row] of Object.entries(mc.byCategory)) {
      expect(row.mapped + row.unresolved).toBe(row.retained);
      expect(row.retained).toBe(view.counts[category as keyof typeof view.counts] ?? 0);
      retainedSum += row.retained;
    }
    expect(retainedSum).toBe(mc.retained);
    expect(mc.unresolved).toBe(1);
  });
});

function round500(n: number): number {
  return Math.round(n / 500) * 500;
}

describe('subject improvement scope (land comps price land, never a whole property)', () => {
  const inspection = (facts: Record<string, string>, observations: Array<{ label: string; detail: string }> = []) => ({
    parcelUrl: 'https://landportal.example/parcel/1',
    comparablesUrl: null,
    parcelFacts: facts,
    assets: [],
    overlays: [],
    visualObservations: observations.map((o) => ({ ...o, confidence: 'medium', evidence: 'Parcel panel' })),
    comparables: [],
    sources: [],
  }) as unknown as Parameters<typeof readSubjectImprovement>[0];

  it('names an improved subject and forces a land-only scope with whole-property pending', () => {
    const read = readSubjectImprovement(inspection(
      { 'Building SqFt': '1701', Acres: '60' },
      [{ label: 'Existing improvement', detail: 'Parcel page shows approx. 1,701 sqft of improvements.' }],
    ));
    expect(read.improved).toBe(true);
    expect(read.buildingSqft).toBe(1701);
    expect(read.captionNoun).toBe('improved parcel');
    expect(read.captionNoun).not.toMatch(/vacant/i);
    expect(read.valuationScope).toBe('land_only');
    expect(read.valuationScopeLabel).toMatch(/land-only/i);
    expect(read.valuationScopeLabel).not.toMatch(/fair market value/i);
    expect(read.wholePropertyPending).toBe(true);
    expect(read.wholePropertyNote).toMatch(/PENDING/);
    expect(read.wholePropertyNote).toMatch(/1,701 sqft/);
  });

  it('leaves a genuinely vacant subject on the whole-property scope', () => {
    const read = readSubjectImprovement(inspection({ 'Building SqFt': '0', 'Improvement Value': '0', Acres: '40' }));
    expect(read.improved).toBe(false);
    expect(read.captionNoun).toBe('vacant parcel');
    expect(read.valuationScope).toBe('whole_property');
    expect(read.valuationScopeLabel).toBe('Preliminary fair market value');
    expect(read.wholePropertyPending).toBe(false);
    expect(read.wholePropertyNote).toBeNull();
  });

  it('does not invent improvements when nothing is retained', () => {
    const read = readSubjectImprovement(null);
    expect(read.improved).toBe(false);
    expect(read.wholePropertyPending).toBe(false);
  });
});
