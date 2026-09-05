import { describe, expect, it } from 'vitest';
import {
  computeValuationPackage,
  hasLandPortalOrigin,
  hasNonLandPortalOrigin,
  LANDWATCH_ADDITIVE_MIN_ACRES,
  type ValuationPackageInput,
} from './comps-valuation-package.js';
import type { CleanedValuation, WorkspaceComp } from './comps-valuation.js';
import { shouldRunLandWatchFallback } from './landportal-comp-search-capability.js';
import { selectCompProviders, type CompProvider } from './comp-retrieval.js';
import { compSourceFamily } from './comp-source-policy.js';
import { landHomePostureFor } from './deal-decision-synthesis.js';

function comp(overrides: Partial<WorkspaceComp> & { key: string }): WorkspaceComp {
  return {
    compId: null,
    category: 'accepted_closed_sale',
    categoryLabel: 'Accepted closed sale',
    classificationReason: 'fixture',
    eligibleForValuation: true,
    selectedForValuation: true,
    selectionMode: 'auto',
    operatorExcluded: false,
    exclusionReason: null,
    source: 'Redfin',
    sourceUrl: null,
    origins: ['Redfin'],
    fromLandPortalSidebar: false,
    fromLandPortalShowOnMap: false,
    mergeStatus: null,
    address: null,
    apn: null,
    county: null,
    state: null,
    distanceMiles: 3,
    geography: {
      tier: 'local', tierLabel: 'Local', tierShortLabel: 'Local', tierReason: 'fixture', precision: 'exact',
      distanceMiles: 3, city: null, zip: null, sameSubmarket: true, sameCounty: true, source: null, cardLine: '', weightMultiplier: 1,
    },
    outsideInitialRadius: false,
    lat: null,
    lng: null,
    locationResolved: true,
    locationSource: null,
    locationMethod: 'none',
    locationResolvedAtIso: null,
    locationAddress: null,
    locationUnresolvedReason: null,
    statusLabel: 'Sold',
    priceKind: 'sale',
    price: 30000,
    acres: 1.5,
    pricePerAcre: 20000,
    dateIso: '2026-03-01',
    daysOnMarket: null,
    soldBy: null,
    buildingSqft: null,
    propertyClass: 'land',
    thumbnailUrl: null,
    visual: { provenance: 'map_fallback' } as unknown as WorkspaceComp['visual'],
    acresDeltaFromSubject: 0,
    recencyMonths: 6,
    monthsOld: 6,
    primaryComparability: null,
    keyDifference: null,
    missingFields: [],
    saleVerification: 'verified' as WorkspaceComp['saleVerification'],
    valuationRole: 'direct',
    inValuationSet: true,
    valuationWeight: 1,
    zeroWeightReason: null,
    radiusStage: 'initial_10',
    exclusionActor: null,
    transactionKind: 'closed_sale' as WorkspaceComp['transactionKind'],
    listing: null,
    ...overrides,
  };
}

function cleaned(adoptedFmv: number | null, confidence: CleanedValuation['confidence'] = 'moderate', count = 3): CleanedValuation {
  return {
    cleanedCount: count, directCount: count, supportingCount: 0, supplementalHistoricalCount: 0, boundaryCount: 0,
    historicalContextCount: 0, geographicContextCount: 0, geography: null, excludedCount: 0,
    cleanedAvgPpa: null, cleanedMedianPpa: null, avgIndication: null, medianIndication: null,
    weightedPpa: null, weightedIndication: null, lowObservedPpa: null, highObservedPpa: null,
    lowObservedIndication: null, highObservedIndication: null, activeCompetition: null,
    adoptedFmv, retailRangeLow: null, retailRangeHigh: null, confidence, reconciliationLines: [],
    directEvidenceSufficient: adoptedFmv != null, insufficiencyWarning: null,
  };
}

const base = (over: Partial<ValuationPackageInput> = {}): ValuationPackageInput => ({
  subjectAcres: 1.5,
  landPortalEstimate: { price: 40000, source: 'LandPortal parcel panel' },
  comps: [
    comp({ key: 'lp1', source: 'LandPortal', origins: ['LandPortal'], fromLandPortalSidebar: true }),
    comp({ key: 'rf1' }),
    comp({ key: 'zl1', source: 'Zillow', origins: ['Zillow'] }),
    comp({ key: 'merged', source: 'LandPortal + Redfin', origins: ['LandPortal', 'Redfin'], fromLandPortalShowOnMap: true }),
  ],
  nonLandPortalCleaned: cleaned(30000),
  allLanesCleaned: cleaned(32000),
  marketFallback: { pricePerAcre: 28008, label: 'the retained 1–2 acre sold-market median' },
  askingPrice: 25000,
  subjectImproved: false,
  ...over,
});

describe('valuation package: three FMV views and the 40/60 benchmarks', () => {
  it('extracts LandPortal FMV directly and averages it with the Non-LandPortal FMV', () => {
    const pkg = computeValuationPackage(base());
    expect(pkg.landPortalFmv.value).toBe(40000);
    expect(pkg.landPortalFmv.compCount).toBe(2);
    expect(pkg.nonLandPortalFmv.value).toBe(30000);
    expect(pkg.nonLandPortalFmv.compCount).toBe(3);
    expect(pkg.nonLandPortalFmv.sources).toEqual(['Redfin', 'Zillow']);
    expect(pkg.combinedFmv.method).toBe('average');
    expect(pkg.combinedFmv.value).toBe(35000);
    expect(pkg.offer40).toBe(14000);
    expect(pkg.offer60).toBe(21000);
    expect(pkg).not.toHaveProperty('offer50');
    expect(pkg.askingPrice).toBe(25000);
  });

  it('falls back to the single lane when only one FMV component exists and lowers confidence', () => {
    const lpOnly = computeValuationPackage(base({ nonLandPortalCleaned: cleaned(null, 'unavailable', 0), comps: [comp({ key: 'lp1', source: 'LandPortal', origins: ['LandPortal'], fromLandPortalSidebar: true })] }));
    expect(lpOnly.combinedFmv.method).toBe('landportal_only');
    expect(lpOnly.combinedFmv.value).toBe(40000);
    const exact = computeValuationPackage(base({ landPortalEstimate: { price: 35317, perAcre: 23545, source: 'LandPortal parcel panel' }, nonLandPortalCleaned: cleaned(null, 'unavailable', 0), comps: [] }));
    expect(exact.combinedFmv.value).toBe(35317);
    expect(lpOnly.combinedFmv.confidence).toBe('low');
    expect(lpOnly.nonLandPortalFmv.value).toBeNull();

    const nonLpOnly = computeValuationPackage(base({ landPortalEstimate: null, nonLandPortalCleaned: cleaned(30000, 'high') }));
    expect(nonLpOnly.landPortalFmv.value).toBeNull();
    expect(nonLpOnly.landPortalFmv.limitation).toMatch(/did not publish/);
    expect(nonLpOnly.combinedFmv.method).toBe('non_landportal_only');
    expect(nonLpOnly.combinedFmv.value).toBe(30000);
    expect(nonLpOnly.combinedFmv.confidence).toBe('moderate');
  });

  it('refuses a LandPortal estimate whose own per-acre figure implies a different acreage than the accepted subject', () => {
    const pkg = computeValuationPackage(base({ subjectAcres: 51.11, landPortalEstimate: { price: 56_866_911, perAcre: 749_135, source: 'LandPortal parcel panel' } }));
    expect(pkg.landPortalFmv.value).toBeNull();
    expect(pkg.landPortalFmv.limitation).toMatch(/implies about 75\.9 acres/);
    expect(pkg.combinedFmv.method).toBe('non_landportal_only');
    expect(pkg.combinedFmv.value).toBe(30000);
  });

  it('is never blank after valuation when any price-bearing evidence exists, and is one number', () => {
    const thin = computeValuationPackage(base({
      landPortalEstimate: null,
      comps: [],
      nonLandPortalCleaned: cleaned(null, 'unavailable', 0),
      allLanesCleaned: cleaned(null, 'unavailable', 0),
    }));
    expect(thin.combinedFmv.method).toBe('closest_evidence');
    expect(thin.combinedFmv.value).toBe(42000);
    expect(typeof thin.combinedFmv.value).toBe('number');
    expect(thin.combinedFmv.confidence).toBe('low');
    // EXACT percentages of the displayed Combined LandOS FMV ($42,000), not
    // rounded to $500: an opening offer that is not actually 40% of the stated
    // value misstates both the offer and the percentage.
    expect(thin.offer40).toBe(16800);
    expect(thin.offer60).toBe(25200);
  });

  it('uses a single non-LandPortal closed sale at low confidence rather than leaving the lane empty', () => {
    const pkg = computeValuationPackage(base({
      comps: [comp({ key: 'rf1', price: 45000, acres: 1.5 })],
      nonLandPortalCleaned: cleaned(null, 'unavailable', 1),
    }));
    expect(pkg.nonLandPortalFmv.value).toBe(45000);
    expect(pkg.nonLandPortalFmv.confidence).toBe('low');
    expect(pkg.combinedFmv.value).toBe(42500);
  });

  it('keeps active listings out of FMV and summarizes up to five competitors', () => {
    const actives = Array.from({ length: 7 }, (_, i) => comp({
      key: `a${i}`, category: 'active_competition', priceKind: 'list', price: 60000, pricePerAcre: 40000, distanceMiles: i + 1, daysOnMarket: i === 0 ? 400 : 30,
      inValuationSet: false, valuationRole: null,
    }));
    const pkg = computeValuationPackage(base({ comps: [...base().comps, ...actives] }));
    expect(pkg.activeCompetition.count).toBe(5);
    expect(pkg.activeCompetition.compKeys).toEqual(['a0', 'a1', 'a2', 'a3', 'a4']);
    expect(pkg.activeCompetition.summary).toMatch(/do not set FMV/);
    expect(pkg.combinedFmv.value).toBe(35000);
  });

  it('produces one concise collective comparison even without visuals or remarks', () => {
    const pkg = computeValuationPackage(base());
    expect(pkg.collectiveComparison.posture).toBe('similar');
    expect(pkg.collectiveComparison.basis).toBe('facts_only');
    expect(pkg.collectiveComparison.compCount).toBe(4);
    expect(pkg.collectiveComparison.reasons.some((r) => /sale price, acreage, location, recency/.test(r))).toBe(true);
  });

  it('recognizes merged provider records as both LandPortal and non-LandPortal evidence, once', () => {
    const merged = comp({ key: 'm', source: 'LandPortal + Redfin', origins: ['LandPortal', 'Redfin'] });
    expect(hasLandPortalOrigin(merged)).toBe(true);
    expect(hasNonLandPortalOrigin(merged)).toBe(true);
    const pkg = computeValuationPackage(base({ comps: [merged] }));
    expect(pkg.landPortalFmv.compKeys).toEqual(['m']);
    expect(pkg.nonLandPortalFmv.compKeys).toEqual(['m']);
  });
});

describe('LandWatch is additive at 20+ acres, never the sole source', () => {
  const registry: CompProvider[] = ['redfin', 'zillow', 'landwatch', 'landportal'].map((id) => ({
    id: id as CompProvider['id'], label: id, search: async () => [],
  } as unknown as CompProvider));

  it('flags applicability at the 20-acre threshold only', () => {
    expect(LANDWATCH_ADDITIVE_MIN_ACRES).toBe(20);
    expect(computeValuationPackage(base({ subjectAcres: 19.9 })).landWatch.applicable).toBe(false);
    expect(computeValuationPackage(base({ subjectAcres: 20 })).landWatch.applicable).toBe(true);
    expect(shouldRunLandWatchFallback(19.9, [])).toBe(false);
    expect(shouldRunLandWatchFallback(20, [])).toBe(true);
    // Strong LandPortal evidence no longer suppresses the lane.
    const strong = Array.from({ length: 6 }, () => ({ tier: 'core', improved: false })) as unknown as Parameters<typeof shouldRunLandWatchFallback>[1];
    expect(shouldRunLandWatchFallback(25, strong)).toBe(true);
  });

  it('keeps every other applicable provider in the set beside LandWatch', () => {
    const large = selectCompProviders({ acres: 25 } as Parameters<typeof selectCompProviders>[0], registry).map((p) => p.id);
    expect(large).toEqual(['redfin', 'zillow', 'landwatch', 'landportal']);
    const small = selectCompProviders({ acres: 5 } as Parameters<typeof selectCompProviders>[0], registry).map((p) => p.id);
    expect(small).toEqual(['redfin', 'zillow', 'landportal']);
  });

  it('classifies LandWatch as its own source family', () => {
    expect(compSourceFamily('LandWatch')).toBe('landwatch');
    expect(compSourceFamily('Redfin')).toBe('redfin');
  });
});


const remarks = (text: string, photos = 1): WorkspaceComp['listing'] => ({
  description: { source: { text } },
  photos: { count: photos },
} as unknown as WorkspaceComp['listing']);

describe('collective comparison uses retained subject facts, visuals and remarks', () => {
  const facts = { buildableAcres: 1.04, buildabilityPct: 56, slopeAvgPct: 6.6, slopeUnder10Pct: 80, wetlandsPct: 5, femaCoveragePct: 0, waterPresent: true, roadFrontageFt: 320, landLocked: false };

  it('reads slightly more desirable when the subject is flatter with frontage and water the sales lack', () => {
    const pkg = computeValuationPackage(base({ subjectFacts: facts, comps: [comp({ key: 'a', listing: remarks('Wooded, steep ravine at the rear, wetland pockets.') }), comp({ key: 'b', listing: remarks('Flood zone AE across most of the lot.') })] }));
    expect(pkg.collectiveComparison.posture).toBe('more_desirable');
    expect(pkg.collectiveComparison.basis).toBe('visuals_and_remarks');
    expect(pkg.collectiveComparison.reasons.some((r) => /Flatter, usable terrain/.test(r))).toBe(true);
  });

  it('reads somewhat less desirable when the sales are cleared waterfront and the subject is wet and land-locked', () => {
    const wet = { ...facts, wetlandsPct: 55, waterPresent: false, roadFrontageFt: 0, landLocked: true, slopeAvgPct: 18, buildabilityPct: 20 };
    const pkg = computeValuationPackage(base({ subjectFacts: wet, comps: [comp({ key: 'a', listing: remarks('Cleared pasture, ready to build, power at the road.') }), comp({ key: 'b', listing: remarks('Lakefront lot, cleared, well installed.') })] }));
    expect(pkg.collectiveComparison.posture).toBe('less_desirable');
    expect(pkg.collectiveComparison.reasons.some((r) => /wetlands cover 55%/.test(r))).toBe(true);
  });

  it('stays generally similar when the facts and remarks show no material difference', () => {
    const plain = { ...facts, waterPresent: false, roadFrontageFt: 90, slopeAvgPct: 9, buildabilityPct: 45 };
    const pkg = computeValuationPackage(base({ subjectFacts: plain, comps: [comp({ key: 'a', listing: remarks('Quiet wooded acreage near town.') })] }));
    expect(pkg.collectiveComparison.posture).toBe('similar');
  });

  it('falls back to facts only and states the limitation when visuals and remarks are missing', () => {
    const pkg = computeValuationPackage(base({ subjectFacts: null }));
    expect(pkg.collectiveComparison.posture).toBe('similar');
    expect(pkg.collectiveComparison.basis).toBe('facts_only');
    expect(pkg.collectiveComparison.reasons.some((r) => /No listing photos or remarks/.test(r))).toBe(true);
    expect(pkg.collectiveComparison.reasons.some((r) => /No retained subject terrain read/.test(r))).toBe(true);
  });
});

describe('preliminary Land Home Package screen', () => {
  const facts = { buildableAcres: 1.04, buildabilityPct: 56, slopeAvgPct: 6.6, slopeUnder10Pct: 80, wetlandsPct: 5, femaCoveragePct: 0, waterPresent: false, roadFrontageFt: 320, landLocked: false };
  const mh = (key: string, price: number, over: Partial<WorkspaceComp> = {}) => comp({
    key, category: 'improved_context', source: 'Zillow manufactured-home sold', origins: ['Zillow manufactured-home sold'],
    classificationReason: 'residential/improved property class: manufactured', propertyClass: 'improved', price, pricePerAcre: null,
    inValuationSet: false, valuationRole: null, distanceMiles: 2.5, ...over,
  });

  it('triggers on 0.50 usable acre under 10% slope plus one sold manufactured home above $200,000 within five miles, excluding parks', () => {
    const pkg = computeValuationPackage(base({ subjectFacts: facts, manufacturedSearch: { status: 'retrieved', note: 'Zillow: retrieved (2 sold). Redfin: retrieved (1 sold). Realtor.com: none (0 sold).' }, comps: [
      ...base().comps,
      mh('m1', 245_000), mh('m2', 150_000), mh('m3', 300_000, { distanceMiles: 9 }),
      mh('park', 260_000, { listing: remarks('Lot rent $450/mo in Sunny Acres mobile home park.') }),
      mh('act', 275_000, { priceKind: 'list' }),
    ] }));
    const lh = pkg.landHomePackage;
    expect(lh.physical.met).toBe(true);
    expect(lh.market.met).toBe(true);
    expect(lh.market.qualifyingSaleCount).toBe(1);
    expect(lh.soldCompKeys).toEqual(['m1', 'm2']);
    expect(lh.market.searchComplete).toBe(true);
    expect(lh.activeCompKeys).toEqual(['act']);
    expect(lh.excludedCount).toBe(1);
    expect(lh.triggered).toBe(true);
    // Manufactured evidence never reaches the vacant-land FMV.
    expect(pkg.combinedFmv.value).toBe(35000);
    expect(landHomePostureFor(lhToDossier(lh), 'not_established').posture).toBe('WORTH EXPLORING');
    expect(landHomePostureFor(lhToDossier(lh), 'conditional').posture).toBe('WORTH EXPLORING');
    expect(landHomePostureFor(lhToDossier(lh), 'by_right').posture).toBe('WORTH EXPLORING');
    expect(landHomePostureFor(lhToDossier(lh), 'prohibited').posture).toBe('NOT VIABLE');
  });

  it('is MARGINAL when the market signal exists but the terrain read is missing, NOT VIABLE when the terrain fails, unscreened with no sale', () => {
    const market = computeValuationPackage(base({ subjectFacts: null, comps: [mh('m1', 245_000)] })).landHomePackage;
    expect(landHomePostureFor(lhToDossier(market), 'not_established').posture).toBe('MARGINAL');
    const steep = computeValuationPackage(base({ subjectFacts: { ...facts, buildableAcres: 0.2, slopeAvgPct: 14, slopeUnder10Pct: 20 }, comps: [mh('m1', 245_000)] })).landHomePackage;
    expect(landHomePostureFor(lhToDossier(steep), 'by_right').posture).toBe('NOT VIABLE');
    const none = computeValuationPackage(base({ subjectFacts: facts, comps: [] })).landHomePackage;
    expect(landHomePostureFor(lhToDossier(none), 'not_established').posture).toBeNull();
    const cheap = computeValuationPackage(base({ subjectFacts: facts, manufacturedSearch: { status: 'retrieved', note: 'Zillow: retrieved (1 sold). Redfin: none. Realtor.com: none.' }, comps: [mh('m1', 150_000)] })).landHomePackage;
    expect(landHomePostureFor(lhToDossier(cheap), 'not_established').posture).toBe('NOT VIABLE');
    // A sale with an unresolved distance never counts as "within five miles",
    // and a partially blocked search stays UNSCREENED rather than NOT VIABLE.
    const unlocated = computeValuationPackage(base({ subjectFacts: facts, manufacturedSearch: { status: 'retrieved', note: 'Zillow: blocked (0 sold). Redfin: retrieved (1 sold). Realtor.com: none (0 sold).' }, comps: [mh('far', 730_000, { distanceMiles: null })] })).landHomePackage;
    expect(unlocated.market.met).toBe(false);
    expect(unlocated.market.searchComplete).toBe(false);
    expect(landHomePostureFor(lhToDossier(unlocated), 'not_established').posture).toBeNull();
  });
});

function lhToDossier(lh: ReturnType<typeof computeValuationPackage>['landHomePackage']) {
  return {
    physicalMet: lh.physical.met, usableAcres: lh.physical.usableAcres, physicalNote: lh.physical.note,
    marketMet: lh.market.met, qualifyingSaleCount: lh.market.qualifyingSaleCount, topSalePrice: lh.market.topSalePrice, marketNote: lh.market.note, searchComplete: lh.market.searchComplete,
    soldCompCount: lh.soldCompKeys.length, activeCompCount: lh.activeCompKeys.length, excludedCount: lh.excludedCount, triggered: lh.triggered,
  };
}

describe('one qualifying provider decides the manufactured-home market screen', () => {
  const facts = { buildableAcres: 1.04, buildabilityPct: 56, slopeAvgPct: 6.6, slopeUnder10Pct: 84, wetlandsPct: 5, femaCoveragePct: 0, waterPresent: false, roadFrontageFt: 320, landLocked: false };
  const sale = (key: string, source: string, price: number, over: Partial<WorkspaceComp> = {}) => comp({
    key, category: 'improved_context', source: `${source} manufactured-home sold`, origins: [`${source} manufactured-home sold`],
    classificationReason: 'residential/improved property class: manufactured', propertyClass: 'improved', price, pricePerAcre: null,
    inValuationSet: false, valuationRole: null, distanceMiles: 0.1, ...over,
  });
  const blockedNote = 'Zillow: blocked (0 sold). Redfin: retrieved (2 sold). Realtor.com: blocked (0 sold). 2 unique manufactured-home sale(s) within the five-mile screen after address dedup.';

  it('is WORTH EXPLORING on one credible Redfin sale above $200,000 within five miles while Zillow is challenged and Realtor.com is HTTP 429', () => {
    const pkg = computeValuationPackage(base({ subjectFacts: facts, manufacturedSearch: { status: 'retrieved', note: blockedNote }, comps: [
      ...base().comps,
      sale('redfin-19517', 'Redfin', 290_000),
      // An indexed Zillow record without a resolved distance or sale date stays context: never promoted, never suppressing.
      sale('zillow-19487', 'Zillow', 185_000, { distanceMiles: null }),
    ] }));
    const lh = pkg.landHomePackage;
    expect(lh.physical.met).toBe(true);
    expect(lh.market.met).toBe(true);
    expect(lh.market.qualifyingSaleCount).toBe(1);
    expect(lh.market.topSalePrice).toBe(290_000);
    expect(lh.market.searchComplete).toBe(false);
    expect(lh.soldCompKeys).toEqual(['redfin-19517']);
    expect(lh.market.note).toMatch(/Zillow: blocked/);
    expect(lh.market.note).toMatch(/Realtor\.com: blocked/);
    expect(landHomePostureFor(lhToDossier(lh), 'not_established').posture).toBe('WORTH EXPLORING');
    // The manufactured sales never reach the vacant-land package.
    expect(pkg.combinedFmv.value).toBe(35000);
    expect(pkg.nonLandPortalFmv.compKeys).not.toContain('redfin-19517');
    expect(pkg.nonLandPortalFmv.compKeys).not.toContain('zillow-19487');
  });

  it('never promotes an incomplete indexed record on its own and stays unscreened, not NOT VIABLE, while a source is blocked', () => {
    const pkg = computeValuationPackage(base({ subjectFacts: facts, manufacturedSearch: { status: 'retrieved', note: blockedNote }, comps: [
      ...base().comps,
      sale('zillow-19487', 'Zillow', 185_000, { distanceMiles: null }),
    ] }));
    expect(pkg.landHomePackage.market.met).toBe(false);
    expect(landHomePostureFor(lhToDossier(pkg.landHomePackage), 'not_established').posture).toBeNull();
  });
});

describe('WORTH EXPLORING wording comes from retained facts', () => {
  const facts = { buildableAcres: 1.04, buildabilityPct: 56, slopeAvgPct: 6.6, slopeUnder10Pct: 84, wetlandsPct: 5, femaCoveragePct: 0, waterPresent: false, roadFrontageFt: 320, landLocked: false };
  const sale = (key: string, address: string, price: number, over: Partial<WorkspaceComp> = {}) => comp({
    key, address, category: 'improved_context', source: 'Redfin manufactured-home sold', origins: ['Redfin manufactured-home sold'],
    classificationReason: 'residential/improved property class: manufactured', propertyClass: 'improved', price, pricePerAcre: null,
    inValuationSet: false, valuationRole: null, distanceMiles: 0.2, ...over,
  });

  it('names the same-street sale with its acreage and the subject\'s retained subdivision, and points the next verification at home, well and septic placement', () => {
    const pkg = computeValuationPackage(base({
      subjectFacts: facts, subjectStreet: 'NW 137th Ln', subjectSubdivision: 'RIVER OAK PLANTATION S/D',
      manufacturedSearch: { status: 'retrieved', note: 'Zillow: blocked (0 sold). Redfin: retrieved (2 sold). Realtor.com: blocked (0 sold).' },
      comps: [
        ...base().comps,
        sale('r1', '19517 NW 137th Ln, Lake Butler, FL 32054', 290_000, { acres: 1.5, dateIso: '2025-08-06', distanceMiles: 0.1 }),
        sale('r2', '19414 NW 135th Ln, Lake Butler, FL 32054', 239_900, { acres: 1, dateIso: '2026-04-15', distanceMiles: 0.22 }),
      ],
    }));
    const brief = pkg.landHomePackage.market.brief;
    expect(brief).toMatch(/Recent manufactured homes above \$200,000 sold within about five miles of the subject's River Oak Plantation location/);
    expect(brief).toMatch(/including a same-street 1\.5-acre sale on NW 137th Ln at \$290,000 \(2025-08-06\)/);
    const posture = landHomePostureFor({ ...lhToDossier(pkg.landHomePackage), marketBrief: brief }, 'not_established');
    expect(posture.posture).toBe('WORTH EXPLORING');
    expect(posture.why).toMatch(/^Recent manufactured homes above \$200,000/);
    expect(posture.why).toMatch(/Physical screen passed \(about 1\.04 usable acres\)/);
    expect(posture.nextVerification).toMatch(/^Confirm practical placement of a manufactured home, well and septic within the usable portion of the acquisition parcel/);
    expect(posture.nextVerification).toMatch(/verify from the adopted code/);
  });

  it('stays generic when no qualifying sale sits on the subject street and no subdivision is retained', () => {
    const pkg = computeValuationPackage(base({ subjectFacts: facts, manufacturedSearch: { status: 'retrieved', note: 'Zillow: retrieved (1 sold). Redfin: retrieved (1 sold). Realtor.com: none (0 sold).' }, comps: [...base().comps, sale('r2', '19414 NW 135th Ln, Lake Butler, FL 32054', 239_900)] }));
    expect(pkg.landHomePackage.market.brief).toBe('Recent manufactured homes above $200,000 sold within about five miles (1 qualifying, top $239,900).');
    expect(computeValuationPackage(base({ subjectFacts: facts, comps: [] })).landHomePackage.market.brief).toBeNull();
  });
});
