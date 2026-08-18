import { beforeEach, describe, expect, it } from 'vitest';

import type { CapabilityResult } from './capability-contract.js';
import { invokeRuntimeCapability, listRuntimeCapabilities } from './capability-registry.js';
import {
  COMPS_VALUATION_CAPABILITY,
  COMPS_VALUATION_CAPABILITY_ID,
  type CompsValuationFacts,
} from './comps-valuation-capability.js';
import type { CompsValuationView, WorkspaceComp } from './comps-valuation.js';
import { _initTestLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { upsertPropertyCard } from './property-card.js';

beforeEach(() => { _initTestLandosDb(); });

/** A canonical subject the way Property Resolution leaves it on a Deal Card. */
function canonicalSubject(overrides: { apn?: string | null; verified?: boolean; acres?: number | null; address?: string } = {}) {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Highway 60' });
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: overrides.address ?? '5170 Highway 60, Hamilton County TN',
    apn: overrides.apn === undefined ? '105-016.00-000' : overrides.apn ?? undefined,
    county: 'Hamilton',
    state: 'TN',
    acres: overrides.acres === undefined ? 21.5 : overrides.acres ?? undefined,
    verified: overrides.verified ?? true,
    verificationSource: 'Hamilton County Property Assessor',
  });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
  return { deal, card };
}

function comp(overrides: Partial<WorkspaceComp> = {}): WorkspaceComp {
  return {
    compId: 1, key: 'comp-1', category: 'accepted_closed_sale',
    categoryLabel: 'Closed vacant-land sale — in valuation set',
    classificationReason: 'Closed vacant-land sale inside the acreage band and sale window.',
    eligibleForValuation: true, selectedForValuation: true, selectionMode: 'auto',
    operatorExcluded: false, exclusionReason: null,
    source: 'LandPortal visible', sourceUrl: 'https://landportal.com/comp/1', origins: ['LandPortal visible'],
    fromLandPortalSidebar: true, fromLandPortalShowOnMap: false, mergeStatus: null,
    address: '4900 Highway 60, Hamilton County, TN', apn: '105-014.00-000', county: 'Hamilton', state: 'TN',
    distanceMiles: 2.1, outsideInitialRadius: false, lat: 35.3, lng: -85.1,
    locationResolved: true, locationSource: 'LandPortal map point', locationMethod: 'provider_map_point',
    locationResolvedAtIso: '2026-08-01T00:00:00.000Z', locationAddress: null, locationUnresolvedReason: null,
    statusLabel: 'Sold', priceKind: 'sale', price: 180_000, acres: 20, pricePerAcre: 9_000,
    dateIso: '2026-02-11', daysOnMarket: null, soldBy: null, buildingSqft: null, propertyClass: 'land',
    thumbnailUrl: null, visual: { kind: 'none', url: null, provenance: 'No visual retained.' } as never,
    acresDeltaFromSubject: -1.5, recencyMonths: 6, monthsOld: 6,
    primaryComparability: 'Same corridor, comparable acreage.', keyDifference: '1.5 acres smaller',
    missingFields: [], saleVerification: 'source_stated' as never,
    valuationRole: 'direct', inValuationSet: true, valuationWeight: 0.92, zeroWeightReason: null,
    radiusStage: 'initial_10', exclusionActor: null, transactionKind: 'closed' as never, listing: null,
    ...overrides,
  } as WorkspaceComp;
}

/** The projection the existing accepted implementation already produces. */
function view(overrides: {
  acres?: number | null;
  adoptedFmv?: number | null;
  houseValue?: number | null;
  wholePropertyValue?: number | null;
  comps?: WorkspaceComp[];
  unresolved?: number;
} = {}): CompsValuationView {
  const comps = overrides.comps ?? [comp(), comp({
    compId: 2, key: 'comp-2', category: 'active_competition', categoryLabel: 'Active vacant-land competition',
    priceKind: 'list', price: 240_000, pricePerAcre: 11_000, inValuationSet: false, valuationRole: null,
    valuationWeight: null, source: 'Zillow', origins: ['Zillow'], sourceUrl: 'https://zillow.com/comp/2',
    fromLandPortalSidebar: false,
  })];
  return {
    dealCardId: 7,
    propertyCardId: 3,
    subject: {
      address: '5170 Highway 60, Hamilton County, TN', apn: '105-016.00-000',
      acres: overrides.acres === undefined ? 21.5 : overrides.acres,
      county: 'Hamilton', state: 'TN', lat: 35.31, lng: -85.11, locationSource: 'Assessor centroid',
    },
    subjectImprovement: {
      improved: true, type: 'existing_residence', buildingSqft: 1_800,
      evidence: 'Retained parcel evidence records approx. 1,800 sqft of improvements.',
      captionNoun: 'improved parcel', valuationScope: 'whole_property',
      valuationScopeLabel: 'Estimated whole-property value with improvement overlay',
      wholePropertyPending: false, wholePropertyNote: 'Whole-property estimate adds the land value to the overlay.',
    },
    summary: {
      workingAcres: overrides.acres === undefined ? 21.5 : overrides.acres,
      acceptedCount: comps.filter((c) => c.inValuationSet).length,
      medianPricePerAcre: 9_000,
      ppaBand: { low: 8_000, median: 9_000, high: 10_000 },
      fmv: { low: 170_000, central: overrides.adoptedFmv === undefined ? 193_500 : overrides.adoptedFmv ?? 0, high: 215_000 },
      acquisitionLevels: { pct40: 77_500, pct50: 96_500, pct60: 116_000 },
      acquisitionLockedReason: null,
      status: 'supported', statusLabel: 'Supported valuation',
      basisLabel: 'Supported valuation based on 1 closed vacant-land sale',
      statusReason: 'One qualifying closed sale inside the acreage band and sale window.',
      confidence: 'moderate', confidenceFactors: ['Single direct sale.'],
      radius: {
        initialMiles: 10, usedMiles: 10, expanded: false, withinInitial: 1, withinExpansion: 0,
        beyondExpansion: 0, unresolved: overrides.unresolved ?? 0, note: 'Inside the initial radius.',
      },
      distanceRange: { minMiles: 2.1, maxMiles: 2.1 },
    },
    comps,
    counts: {
      accepted_closed_sale: 1, candidate_closed_sale: 0, active_competition: 1, asking_reference: 0,
      improved_context: 0, rejected: 0, context_only: 0, total: comps.length,
    },
    canonicalCompCount: comps.length,
    duplicatesMerged: 2,
    mapCounts: {
      retained: comps.length, mapped: comps.length - (overrides.unresolved ?? 0),
      unresolved: overrides.unresolved ?? 0, byCategory: {} as never,
    },
    improvementValuation: {
      subjectBuildingSqft: 1_800, qualifyingSoldCompCount: 2, qualifyingComps: [],
      medianSoldPricePerSqft: 148, redfinZip: '37343', redfinMedianSoldPricePerSqft: 152,
      redfinSourceUrl: 'https://www.redfin.com/zipcode/37343/housing-market', redfinSourceRetrievedAt: '2026-08-10',
      largeAcreageCompCount: 1,
      estimatedSubjectImprovementValue: overrides.houseValue === undefined ? 273_600 : overrides.houseValue,
      wholePropertyValue: overrides.wholePropertyValue === undefined ? 467_100 : overrides.wholePropertyValue,
      residentialOverlayApplies: true, overlaySkippedReason: null,
    },
    landPortal: { sidebarCount: 1, showOnMapCount: 0, mergedUniqueCount: 1 },
    lpEstimate: null,
    marketLeads: [],
    explanation: { used: [], excluded: [], medianNote: null, neededEvidence: [], strongestEvidence: null, weakestEvidence: null },
    cleaned: {
      cleanedCount: 1, directCount: 1, supportingCount: 0, supplementalHistoricalCount: 0, boundaryCount: 0,
      historicalContextCount: 0, excludedCount: 0, cleanedAvgPpa: 9_000, cleanedMedianPpa: 9_000,
      avgIndication: 193_500, medianIndication: 193_500, weightedPpa: 9_000, weightedIndication: 193_500,
      lowObservedPpa: 9_000, highObservedPpa: 9_000, lowObservedIndication: 193_500, highObservedIndication: 193_500,
      activeCompetition: null,
      adoptedFmv: overrides.adoptedFmv === undefined ? 193_500 : overrides.adoptedFmv,
      retailRangeLow: 180_000, retailRangeHigh: 210_000, confidence: 'moderate',
      reconciliationLines: ['Weighted indication adopted.'], directEvidenceSufficient: true, insufficiencyWarning: null,
    },
    quickFlip: null,
    negotiation: null,
    marketContext: {} as never,
    valuationWindow: {
      selectedMonths: 24, cutoffIso: '2024-08-18', acreageBand: { label: '10 to 40 acres' } as never,
      credibleWithin12: 1, credibleWithin24: 1, credibleWithin30: 1, addedFrom13To24: 0, addedFrom25To30: 0,
      movedToHistoricalContext: 0, outOfAcreageBand: 0, valuationSetCount: 1, bucketByKey: {},
      explanation: ['24-month window selected.'],
    },
    visualCounts: {} as never,
  } as CompsValuationView;
}

const facts = (result: CapabilityResult): CompsValuationFacts => result.facts as CompsValuationFacts;

describe('Comps & Valuation Capability', () => {
  it('is registered on the runtime capability registry', () => {
    expect(listRuntimeCapabilities().map((capability) => capability.id)).toContain(COMPS_VALUATION_CAPABILITY_ID);
    expect(COMPS_VALUATION_CAPABILITY.metadata.name).toBe('Comps & Valuation');
  });

  it('projects the existing valuation for the Deal Card canonical subject with its comp provenance', async () => {
    const { deal, card } = canonicalSubject();
    const asked: number[] = [];
    const result = await invokeRuntimeCapability({
      capabilityId: COMPS_VALUATION_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
    }, { loadCompsValuation: (dealCardId) => { asked.push(dealCardId); return view(); } });

    expect(result.status).toBe('SUCCEEDED');
    expect(result.subjectResolution).toBe('RESOLVED');
    expect(result.canonicalSubject).toMatchObject({ kind: 'property', propertyCardId: card.id, dealCardId: deal.id, temporary: false });
    // The capability reads the canonical Deal Card's own projection.
    expect(asked).toEqual([deal.id]);

    const projected = facts(result);
    expect(projected.lane).toBe('retained_valuation');
    expect(projected.executed).toBe(true);
    expect(projected.outcome).toBe('valuation_returned');
    expect(projected.valuation?.landValue).toBe(193_500);
    expect(projected.valuation?.medianPricePerAcre).toBe(9_000);
    expect(projected.valuation?.acquisitionLevels).toEqual({ pct40: 77_500, pct50: 96_500, pct60: 116_000 });
    expect(projected.valuation?.windowLabel).toContain('24-month sale window');
    expect(projected.comps.canonicalCount).toBe(2);
    expect(projected.comps.valuationSetCount).toBe(1);
    expect(projected.comps.activeCount).toBe(1);
    expect(projected.comps.duplicatesMerged).toBe(2);

    // Provenance travels with each comparable, and every provider behind the
    // retained evidence is named.
    const sold = projected.comps.selected.find((row) => row.key === 'comp-1')!;
    expect(sold).toMatchObject({
      source: 'LandPortal visible', sourceUrl: 'https://landportal.com/comp/1',
      price: 180_000, acres: 20, pricePerAcre: 9_000, valuationRole: 'direct', inValuationSet: true,
    });
    expect(result.evidence.map((item) => item.source)).toContain('LandPortal visible');
    expect(result.evidence.map((item) => item.source)).toContain('Zillow');
    expect(projected.sourceAttempts.map((attempt) => attempt.source)).toEqual(
      expect.arrayContaining(['LandPortal visible', 'Zillow']),
    );
  });

  it('splits Land Value, House Value and Whole Property Value only above one acre', async () => {
    const { deal, card } = canonicalSubject();
    const run = async (acres: number | null) => facts(await invokeRuntimeCapability({
      capabilityId: COMPS_VALUATION_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
    }, { loadCompsValuation: () => view({ acres }) }));

    const large = await run(21.5);
    expect(large.split.applies).toBe(true);
    expect(large.split.landValue).toBe(193_500);
    expect(large.split.houseValue).toBe(273_600);
    expect(large.split.wholePropertyValue).toBe(467_100);
    expect(large.split.why).toContain('more than one acre');

    // At an acre or less the parcel carries ONE value: the three components are
    // not split out, and the House and Whole Property figures are not reported.
    for (const acres of [1, 0.4]) {
      const small = await run(acres);
      expect(small.split.applies).toBe(false);
      expect(small.split.landValue).toBe(193_500);
      expect(small.split.houseValue).toBeNull();
      expect(small.split.wholePropertyValue).toBeNull();
      expect(small.split.why).toContain('one acre or less');
    }

    // Unknown acreage is not a split either, and says why.
    const noAcreage = canonicalSubject({ acres: null, address: '0 Ooltewah Ringgold Rd, Hamilton County TN', apn: '150-002.00-000' });
    const unknown = facts(await invokeRuntimeCapability({
      capabilityId: COMPS_VALUATION_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${noAcreage.deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: noAcreage.card.id, dealCardId: noAcreage.deal.id },
      mode: 'refresh',
    }, { loadCompsValuation: () => view({ acres: null }) }));
    expect(unknown.split.applies).toBe(false);
    expect(unknown.split.wholePropertyValue).toBeNull();
    expect(unknown.split.why).toContain('not established');
  });

  it('reports weak comp evidence honestly instead of producing a valuation', async () => {
    const { deal, card } = canonicalSubject();
    const result = await invokeRuntimeCapability({
      capabilityId: COMPS_VALUATION_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
    }, {
      loadCompsValuation: () => {
        const empty = view({ adoptedFmv: null, comps: [], unresolved: 0 });
        empty.summary.fmv = null;
        empty.cleaned.cleanedCount = 0;
        empty.cleaned.directCount = 0;
        empty.summary.statusReason = 'No qualifying closed vacant-land sale is retained for this subject.';
        return empty;
      },
    });

    expect(result.status).toBe('NEEDS_INPUT');
    const projected = facts(result);
    expect(projected.outcome).toBe('not_available');
    expect(projected.valuation?.landValue).toBeNull();
    expect(result.missingInformation.join(' ')).toContain('adopted land value');
    expect(result.missingInformation.join(' ')).toContain('closed vacant-land sale');
    expect(projected.summary).toContain('No land value is established');
  });

  it('discloses unresolved comparable locations rather than placing them', async () => {
    const { deal, card } = canonicalSubject();
    const result = await invokeRuntimeCapability({
      capabilityId: COMPS_VALUATION_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
    }, { loadCompsValuation: () => view({ unresolved: 1 }) });

    expect(facts(result).comps.unresolvedLocations).toBe(1);
    expect(result.missingInformation.join(' ')).toContain('unresolved');
  });

  it('runs no comping until Property Resolution establishes one parcel for raw Tools input', async () => {
    const result = await invokeRuntimeCapability({
      capabilityId: COMPS_VALUATION_CAPABILITY_ID,
      caller: { type: 'tools', ref: 'tools:comps-valuation' },
      subject: { kind: 'raw_property', entity: 'TY_LAND_BIZ', rawInput: 'the big field off highway 60' },
    }, {
      resolveSubject: async () => ({
        invocationId: 'cap_test', capability: { id: 'property-resolution', name: 'Property Resolution', contractVersion: '1.0', description: '' },
        status: 'NEEDS_INPUT', subjectResolution: 'AMBIGUOUS', canonicalSubject: null,
        facts: {}, evidence: [], warnings: ['Two credible parcels remain.'],
        missingInformation: ['A county or an APN'],
        timestamps: { startedAt: '', completedAt: '' },
        execution: { mode: 'reuse', durationMs: 1, reused: false },
      }),
      loadCompsValuation: () => { throw new Error('the valuation must not be read before the subject is resolved'); },
    });

    expect(result.status).toBe('NEEDS_INPUT');
    expect(result.subjectResolution).toBe('AMBIGUOUS');
    expect(facts(result).executed).toBe(false);
    expect(result.missingInformation).toContain('A county or an APN');
  });

  it('creates nothing for a Tools subject LandOS holds no Deal Card for', async () => {
    const result = await invokeRuntimeCapability({
      capabilityId: COMPS_VALUATION_CAPABILITY_ID,
      caller: { type: 'tools', ref: 'tools:comps-valuation' },
      subject: { kind: 'raw_property', entity: 'TY_LAND_BIZ', rawInput: '5170 Highway 60, Hamilton County TN' },
    }, {
      resolveSubject: async () => ({
        invocationId: 'cap_test', capability: { id: 'property-resolution', name: 'Property Resolution', contractVersion: '1.0', description: '' },
        status: 'SUCCEEDED', subjectResolution: 'RESOLVED',
        canonicalSubject: { kind: 'research_session', id: 'rs_1', temporary: true },
        facts: { canonicalIdentity: { address: '5170 Highway 60', apn: '105-016.00-000', county: 'Hamilton', state: 'TN', acres: 21.5 } },
        evidence: [{ source: 'Hamilton County Property Assessor', retrievedAt: '2026-08-18T00:00:00.000Z' }],
        warnings: [], missingInformation: [],
        timestamps: { startedAt: '', completedAt: '' },
        execution: { mode: 'reuse', durationMs: 1, reused: false },
      }),
    });

    // A one-off Tools run is research: no Deal Card, no Property Card, no lead.
    expect(result.status).toBe('NEEDS_INPUT');
    expect(result.canonicalSubject).toMatchObject({ kind: 'research_session', temporary: true });
    expect(facts(result).executed).toBe(false);
    expect(result.warnings.join(' ')).toContain('Nothing was created.');
    expect(result.missingInformation.join(' ')).toContain('Retained comparable evidence');
  });

  it('runs the existing comparable-collection lane for New Lead', async () => {
    const { deal, card } = canonicalSubject();
    let ran = 0;
    const result = await invokeRuntimeCapability({
      capabilityId: COMPS_VALUATION_CAPABILITY_ID,
      caller: { type: 'new_lead', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
      parameters: { lane: 'comp_collection' },
    }, {
      runCompCollection: async (input) => {
        ran += 1;
        expect(input).toEqual({ propertyCardId: card.id, dealCardId: deal.id });
        return {
          candidateCount: 21, duplicatesMerged: 3,
          sources: ['LandPortal visible', 'Zillow', 'Redfin'],
          summary: '21 comparable candidate(s) collected from 3 approved marketplace(s).',
          sourceAttempts: [{ source: 'Comparable collection lane', status: 'completed', note: '21 collected.' }],
        };
      },
    });

    expect(ran).toBe(1);
    expect(result.status).toBe('SUCCEEDED');
    const projected = facts(result);
    expect(projected.lane).toBe('comp_collection');
    expect(projected.collection?.candidateCount).toBe(21);
    expect(projected.collection?.sources).toContain('Redfin');
  });

  it('runs the existing New Lead valuation computation and keeps a not-priceable answer honest', async () => {
    const { deal, card } = canonicalSubject();
    const result = await invokeRuntimeCapability({
      capabilityId: COMPS_VALUATION_CAPABILITY_ID,
      caller: { type: 'new_lead', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
      parameters: { lane: 'mission_valuation' },
    }, {
      runMissionValuation: async () => ({
        priceable: false, rangeLow: null, rangeHigh: null, confidence: 'unavailable',
        notPriceableReason: 'No accepted closed vacant-land sale survived the source policy.',
        acceptedSoldCount: 0, activeListingCount: 4, landHomeCompCount: 0,
        summary: 'Not priceable: no accepted closed vacant-land sale survived the source policy.',
      }),
    });

    expect(result.status).toBe('NEEDS_INPUT');
    const projected = facts(result);
    expect(projected.lane).toBe('mission_valuation');
    expect(projected.missionValuation?.priceable).toBe(false);
    expect(result.missingInformation.join(' ')).toContain('No accepted closed vacant-land sale');
  });

  it('refuses caller-supplied comparable or valuation assertions', () => {
    const base = {
      capabilityId: COMPS_VALUATION_CAPABILITY_ID,
      caller: { type: 'tools' as const },
      subject: { kind: 'canonical_property' as const, entity: 'TY_LAND_BIZ' as const, propertyCardId: 1 },
    };
    expect(() => COMPS_VALUATION_CAPABILITY.validate({ ...base, parameters: { landValue: 250_000 } }))
      .toThrow(/does not accept caller-supplied/);
    expect(() => COMPS_VALUATION_CAPABILITY.validate({ ...base, parameters: { lane: 'invented_lane' } }))
      .toThrow(/unknown Comps & Valuation lane/);
    expect(() => COMPS_VALUATION_CAPABILITY.validate({ ...base, context: { assume: { comps: [{ price: 1 }] } } }))
      .toThrow(/cannot contain caller-supplied comparable or valuation assertions/);
    expect(() => COMPS_VALUATION_CAPABILITY.validate({ ...base, parameters: { lane: 'retained_valuation' } })).not.toThrow();
  });

  it('never adopts a different parcel than the Deal Card canonical subject', async () => {
    const { deal } = canonicalSubject();
    const other = canonicalSubject({ address: '0 Snow Hill Rd, Hamilton County TN', apn: '141-020.00-000' });
    await expect(invokeRuntimeCapability({
      capabilityId: COMPS_VALUATION_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: other.card.id, dealCardId: deal.id },
      mode: 'refresh',
    }, { loadCompsValuation: () => view() })).resolves.toMatchObject({ status: 'FAILED' });
  });
});
