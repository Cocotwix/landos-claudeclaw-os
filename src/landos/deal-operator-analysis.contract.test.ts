import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  buildDealOperatorAnalysis,
  emptyDealOperatorContext,
  runWholeCardOperatorAnalyst,
  type DealOperatorContext,
} from './deal-operator-analysis.js';
import {
  EMPTY_COMPS,
  UNPRICED_VALUATION,
  type DealIntelligenceInputPackage,
} from './deal-intelligence-assembly.js';
import { APPROVED_STRATEGIES } from './strategy-readiness.js';
import { buildCanonicalDealState } from './deal-card-reconciliation.js';
import type { SnapshotIdentity } from './property-intelligence-snapshot.js';

const GENERATED_AT = '2026-07-28T12:00:00.000Z';

const IDENTITY: SnapshotIdentity = {
  state: 'confirmed',
  discoveryUsable: true,
  discoveryBasis: 'LandPortal parcel match',
  discoverySources: ['LandPortal'],
  normalizedAddress: '1488 LIBERTY HWY',
  county: 'Pickens',
  state_: 'SC',
  apn: '4068-00-37-1227',
  apnVariants: ['4068-00-37-1227'],
  owner: 'SAMPLE OWNER',
  ownerMailing: null,
  situs: '1488 LIBERTY HWY',
  acres: 10.3,
  acreageBasis: 'parcel record',
  coordinates: { lat: 34.87, lng: -82.71 },
  hasParcelGeometry: true,
  sourceConfidence: 'high',
  conflicts: [],
  explanation: 'Credible parcel-level sources agree.',
};

function packageFor(overrides: Partial<DealIntelligenceInputPackage> = {}): DealIntelligenceInputPackage {
  return {
    dealCardId: 58,
    missionId: 'deal-58-run-4',
    identity: IDENTITY,
    facts: [],
    marketIntelligence: null,
    governmentRecords: [],
    dueDiligence: [],
    comps: EMPTY_COMPS,
    valuation: UNPRICED_VALUATION,
    strategies: [],
    recommendation: {
      preferredStrategy: null,
      why: 'Continue practical discovery.',
      whatWouldChangeIt: [],
      posture: 'undetermined',
      postureWhy: 'Current evidence is incomplete.',
    },
    evidence: [],
    specialists: [],
    gaps: [],
    requiredGaps: [],
    missionOutcome: 'Current evidence joined into one package.',
    missionStatus: 'joined',
    packageBlockers: [],
    counts: { childrenTotal: 10, contributed: 10, accepted: 10, incomplete: 0 },
    ...overrides,
  };
}

function sellerContext(): DealOperatorContext {
  return {
    ...emptyDealOperatorContext(),
    seller: {
      ...emptyDealOperatorContext().seller,
      name: 'Seller Sample',
      phone: '555-0100',
      askingPrice: 55_000,
      timeline: 'This month',
      flexibility: 'Open to a reasonable cash offer',
      decisionAuthority: 'Sole decision maker',
      notes: ['Inherited land and motivated to sell this month; price is negotiable.'],
      communications: [{ kind: 'call', at: GENERATED_AT, summary: 'Discussed price and timing.' }],
    },
    researchAttempts: [{
      key: 'county_assessor',
      label: 'County assessor',
      category: 'government_record',
      source: 'Pickens County',
      url: 'https://example.test/assessor',
      attemptCount: 1,
      status: 'retrieved',
      result: 'Parcel record retrieved.',
      artifactIds: ['record:assessor'],
      attemptedAt: GENERATED_AT,
    }],
  };
}

describe('DealOperatorAnalysis contract', () => {
  it('always produces exactly three independent, explainable scores', () => {
    const analysis = buildDealOperatorAnalysis({
      pkg: packageFor(),
      context: sellerContext(),
      generatedAt: GENERATED_AT,
    });

    expect(Object.keys(analysis.scores)).toEqual(['property', 'market', 'seller']);
    expect(analysis).not.toHaveProperty('score');
    expect(analysis).not.toHaveProperty('dealScore');
    for (const score of Object.values(analysis.scores)) {
      expect(score.score).toBeGreaterThanOrEqual(0);
      expect(score.score).toBeLessThanOrEqual(100);
      expect(['Excellent', 'Strong', 'Moderate', 'Weak', 'Very weak']).toContain(score.rating);
      expect(score.explanation).not.toHaveLength(0);
      expect(Array.isArray(score.strongestPositiveFactors)).toBe(true);
      expect(Array.isArray(score.mainDeductions)).toBe(true);
      expect(Array.isArray(score.materiallyChangeWith)).toBe(true);
      expect(Array.isArray(score.evidenceKeys)).toBe(true);
    }
    expect(analysis.scores.property.score).not.toBe(analysis.scores.market.score);
    expect(analysis.scores.seller.evidenceKeys).toEqual(
      expect.arrayContaining(['seller:name', 'seller:contact', 'seller:notes']),
    );
  });

  it('reports the canonical Comps & Valuation closed-sale count in the market score', () => {
    // The snapshot comp lane applies a provider allowlist and a never-downgrade
    // guard, so its counts can lag the canonical registry. When the canonical
    // counts are supplied they govern, so Market score and Comps & Valuation
    // can never show different numbers of selected closed sales.
    const withoutCanonical = buildDealOperatorAnalysis({
      pkg: packageFor(),
      context: sellerContext(),
      generatedAt: GENERATED_AT,
    });
    expect(withoutCanonical.scores.market.mainDeductions.join(' '))
      .toContain('No selected closed sale');

    const withCanonical = buildDealOperatorAnalysis({
      pkg: packageFor(),
      context: sellerContext(),
      generatedAt: GENERATED_AT,
      canonicalCompCounts: { sold: 18, active: 4 },
    });
    const factors = withCanonical.scores.market.strongestPositiveFactors.join(' ');
    expect(factors).toContain('18 selected closed sale(s)');
    expect(withCanonical.scores.market.mainDeductions.join(' '))
      .not.toContain('No selected closed sale');
    expect(withCanonical.scores.market.materiallyChangeWith.join(' '))
      .toContain('canonical Comps & Valuation registry counts');
    // A richer canonical set must not score below the empty snapshot read.
    expect(withCanonical.scores.market.score!).toBeGreaterThan(withoutCanonical.scores.market.score!);
  });

  it('ranks all and only the five approved strategies with one unique rank each', () => {
    const analysis = buildDealOperatorAnalysis({
      pkg: packageFor(),
      context: sellerContext(),
      generatedAt: GENERATED_AT,
    });

    expect(analysis.rankedStrategies).toHaveLength(5);
    expect(analysis.rankedStrategies.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(analysis.rankedStrategies.map((row) => row.strategy))).toEqual(
      new Set(APPROVED_STRATEGIES),
    );
    expect(analysis.rankedStrategies[0].financialScenarios).toEqual(analysis.values.scenarios);
    expect(analysis.rankedStrategies.slice(1).every((row) => row.financialScenarios.length === 0)).toBe(true);
  });

  it('keeps Seller Score Pending when no substantive seller evidence exists', () => {
    const analysis = buildDealOperatorAnalysis({
      pkg: packageFor(),
      context: emptyDealOperatorContext(),
      generatedAt: GENERATED_AT,
    });

    expect(analysis.scores.seller).toMatchObject({
      score: null,
      rating: 'Pending',
    });
    expect(analysis.scores.seller.explanation).toMatch(/Not enough information/i);
    expect(analysis.scores.seller.mainDeductions).toEqual([]);
  });

  it('keeps strategy selection pending when valuation has no usable closed-comp basis', () => {
    const analysis = buildDealOperatorAnalysis({
      pkg: packageFor(),
      context: sellerContext(),
      generatedAt: GENERATED_AT,
    });

    expect(analysis.rankedStrategies).toHaveLength(5);
    expect(analysis.overall.bestCurrentStrategy).toBeNull();
    expect(analysis.overall.recommendation).toMatch(/pending valuation evidence/i);
    expect(analysis.values.expectedMarketValue).toBeNull();
    expect(analysis.values.openingPosition).toBeNull();
  });

  it('does not treat a property-research intake note or explicit missing contact as seller evidence', () => {
    const context = emptyDealOperatorContext();
    context.seller.notes = [
      'Potential land lead at 6940 Highway 11. APN 4165-00-51-3961. Approximately 53 acres. No seller contact details are known yet. Please verify the property identity and research the deal.',
    ];
    const analysis = buildDealOperatorAnalysis({
      pkg: packageFor(),
      context,
      generatedAt: GENERATED_AT,
    });

    expect(analysis.scores.seller).toMatchObject({
      score: null,
      rating: 'Pending',
    });
  });

  it('treats 64 acres as subdivision-first without inventing lot counts from acreage alone', () => {
    const comp = (key: string, acres: number, ppa: number) => ({
      key,
      address: `${key} Comp Rd`,
      lane: 'sold' as const,
      source: 'Zillow',
      sourceUrl: `https://example.test/${key}`,
      status: 'Closed sale',
      dateIso: '2026-01-15',
      price: acres * ppa,
      acres,
      pricePerAcre: ppa,
      distanceMiles: 4,
      whyUseful: 'Recent local acreage-band sale.',
      similarities: [`${acres} ac`],
      differences: [],
    });
    const priced = {
      priceable: true,
      range: { low: 500_000, high: 675_000 },
      pricePerAcreRange: { low: 7_800, high: 10_500 },
      likelyRetail: { low: 545_000, high: 675_000 },
      dispositionRange: { low: 350_000, high: 465_000 },
      basis: 'Five accepted closed sales.',
      adjustments: [],
      confidence: 'medium' as const,
      uncertainty: [],
      materialGaps: [],
      notPriceableReason: null,
      nextActionToPrice: null,
      workingValue: 545_000,
    };
    const analysis = buildDealOperatorAnalysis({
      pkg: packageFor({
        identity: { ...IDENTITY, normalizedAddress: '3573 MOOREFIELD MEMORIAL HWY', acres: 64 },
        facts: [{
          key: 'road_frontage_ft',
          label: 'Road frontage',
          value: 'Approximately 1,299 ft',
          grade: 'likely_indication',
          source: 'LandPortal',
          sourceUrl: null,
          retrievedAt: GENERATED_AT,
          note: null,
        }],
        comps: {
          ...EMPTY_COMPS,
          sold: [
            comp('bulk-1', 64, 8_500),
            comp('ten-1', 12, 18_000),
            comp('ten-2', 15, 19_000),
            comp('five-1', 6, 24_000),
            comp('five-2', 8, 22_000),
          ],
        },
        valuation: priced,
        recommendation: {
          preferredStrategy: 'Quick Flip',
          why: 'The whole-tract value is supported.',
          whatWouldChangeIt: [],
          posture: 'renegotiate',
          postureWhy: 'Price matters.',
        },
      }),
      context: emptyDealOperatorContext(),
      generatedAt: GENERATED_AT,
    });

    expect(analysis.subdivision).toMatchObject({
      status: 'Worth investigating',
      automaticFirstLook: true,
      observedFrontageFeet: 1299,
      simplestPracticalLotCount: null,
    });
    expect(analysis.subdivision.scenarios).toEqual([]);
    expect(analysis.subdivision.nextChecks.join(' ')).toMatch(/geometry.*frontage.*access.*soils.*ordinance-backed concept/i);
    expect(analysis.overall.bestCurrentStrategy).toBe('Subdivide or Minor Split');
    expect(analysis.overall.recommendation).toMatch(/highest-upside hypothesis: subdivision/i);
    expect(analysis.overall.recommendation).toMatch(/Quick Flip is the practical fallback/i);
    expect(analysis.seller.discoveryCallQuestions).toEqual(expect.arrayContaining([
      expect.stringMatching(/subdivision/i),
      expect.stringMatching(/multiple road entrances/i),
      expect.stringMatching(/public water/i),
      expect.stringMatching(/soil or perc/i),
    ]));
    expect(analysis.values).toMatchObject({
      openingPosition: expect.any(Number),
      practicalMaximumAcquisitionPrice: expect.any(Number),
      walkAwayLevel: expect.any(Number),
      offerBasis: 'whole_tract_resale_only',
      subdivisionUpsideIncluded: false,
    });
    expect(analysis.values.explanation).toMatch(/whole-tract resale case only.*No subdivision upside/i);
  });

  it('keeps large-acreage subdivision first but gates lot count and plausibility on a narrow road connection', () => {
    const analysis = buildDealOperatorAnalysis({
      pkg: packageFor({
        identity: { ...IDENTITY, normalizedAddress: '6940 HIGHWAY 11', acres: 53 },
        facts: [{
          key: 'road_frontage_ft',
          label: 'Road frontage',
          value: 'Approximately 50.26 ft',
          grade: 'unresolved_question',
          source: 'LandPortal',
          sourceUrl: null,
          retrievedAt: GENERATED_AT,
          note: 'Visual review shows a narrow access connection; the earlier broad frontage indication is conflicted.',
        }],
      }),
      context: emptyDealOperatorContext(),
      generatedAt: GENERATED_AT,
    });

    expect(analysis.subdivision).toMatchObject({
      automaticFirstLook: true,
      status: 'Worth investigating',
      observedFrontageFeet: 50.26,
      simplestPracticalLotCount: null,
    });
    expect(analysis.subdivision.scenarios.every((scenario) => scenario.feasibility !== 'Plausible')).toBe(true);
    expect(analysis.subdivision.signalExplanation).toMatch(/narrow road connection is the immediate gating issue/i);
    expect(analysis.subdivision.mainRisks).toEqual(expect.arrayContaining([
      expect.stringMatching(/legally or physically support multiple lots/i),
    ]));
    expect(analysis.overall.recommendation).toMatch(/pending valuation evidence/i);
  });

  it('projects all internal county bands, marketplace attempts and manufactured-home execution proof', () => {
    const context = emptyDealOperatorContext();
    context.marketScan = {
      acreageMatrix: {
        bands: [
          {
            band: '50+', soldVolume: 8, activeInventory: 12, medianSalePrice: 505_000,
            medianPricePerAcre: 9_800, medianDaysOnMarket: 210, sellThroughRate: 36,
            absorptionRate: 22, absorptionPerMonth: null, monthsOfSupply: 18,
            population: 132_000, populationDensity: 112, populationGrowth: 2.6,
            priceTrend: { direction: 'flat', percent: 1.2 }, likelyResaleTime: '7–9 months',
            movementRank: 4, snapshotPeriod: '2026-Q2', confidence: 'high',
            coverage: 'Pickens County sold and for-sale land', source: 'LandOS Market Research',
          },
          {
            band: '10-20', soldVolume: 24, activeInventory: 7, medianSalePrice: 195_000,
            medianPricePerAcre: 16_500, medianDaysOnMarket: 62, sellThroughRate: 72,
            absorptionRate: 64, absorptionPerMonth: null, monthsOfSupply: 4.2,
            population: 132_000, populationDensity: 112, populationGrowth: 2.6,
            priceTrend: { direction: 'up', percent: 6.4 }, likelyResaleTime: '2–4 months',
            movementRank: 1, snapshotPeriod: '2026-Q2', confidence: 'high',
            coverage: 'Pickens County sold and for-sale land', source: 'LandOS Market Research',
          },
        ],
      },
    };
    context.researchAttempts = [{
      key: 'redfin_land_comps',
      label: 'Redfin land comps',
      category: 'comparable_search',
      source: 'Redfin',
      url: 'https://www.redfin.com/',
      attemptCount: 3,
      status: 'not_found',
      result: 'Redfin was searched across subject and county routes; no qualifying row was retained.',
      artifactIds: [],
      attemptedAt: GENERATED_AT,
    }];
    const zillowActive = {
      key: 'z-active',
      address: '100 Market Rd',
      lane: 'active' as const,
      source: 'Zillow',
      providerAttributions: ['Zillow'],
      sourceUrl: 'https://www.zillow.com/example',
      status: 'Active',
      dateIso: '2026-06-01',
      price: 610_000,
      acres: 55,
      pricePerAcre: 11_091,
      distanceMiles: 8,
      whyUseful: 'Current bulk competition.',
      similarities: ['Same bulk band'],
      differences: [],
    };
    const analysis = buildDealOperatorAnalysis({
      pkg: packageFor({
        identity: { ...IDENTITY, acres: 53 },
        comps: {
          ...EMPTY_COMPS,
          active: [zillowActive],
          rejected: [{
            address: '200 Redfin Rd',
            source: 'Redfin',
            price: 400_000,
            reason: 'Outside the practical acreage range.',
          }],
          landHomeSearchProof: {
            status: 'completed',
            radiusMiles: 5,
            timePeriodMonths: 36,
            sourcesSearched: ['Zillow'],
            routesAttempted: ['coordinate-radius sold manufactured'],
            candidatesReviewed: 9,
            qualifyingResults: 0,
            exclusionReasons: [{ reason: 'Below $200,000', count: 6 }, { reason: 'Outside five miles', count: 3 }],
          },
        },
      }),
      context,
      generatedAt: GENERATED_AT,
    });

    expect(analysis.market.acreageBands).toHaveLength(7);
    expect(analysis.market.acreageBands[0]).toMatchObject({
      soldCount: 8,
      activeCount: 12,
      medianSoldPricePerAcre: 9_800,
      absorptionRate: 22,
      population: 132_000,
      snapshotPeriod: '2026-Q2',
      confidence: 'high',
    });
    expect(analysis.market.bestMovingAcreageBands[0]).toMatch(/10-20 acres.*#1 movement/i);
    expect(analysis.market.expectedBulkMarketingTime).toBe('7–9 months');
    expect(analysis.market.expectedSmallerLotMarketingTime).toBe('2–4 months');
    expect(analysis.comps.marketplaceSearchProof).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'Zillow', status: 'retained', activeRetained: 1 }),
      expect.objectContaining({ source: 'Redfin', status: 'attempted_no_qualifying_result' }),
    ]));
    expect(analysis.comps.manufacturedHomeLane).toMatchObject({
      status: 'completed',
      searchPeriodMonths: 36,
      sourcesSearched: ['Zillow'],
      candidatesReviewed: 9,
      qualifyingSales: 0,
    });
    expect(analysis.comps.manufacturedHomeLane.conclusion).toMatch(/completed.*reviewed 9 candidate/i);
  });

  it('quarantines unsupported slope/buildability text from the Property Score and main risks', () => {
    const unsupported = {
      key: 'terrain',
      label: 'Terrain and buildability',
      verdict: 'risk' as const,
      headline: 'Unsupported steep-slope and buildability calculation.',
      grade: 'unresolved_question' as const,
      detail: 'The percentage was not verified against the correct parcel geometry.',
      sourceUrl: null,
      missing: ['Reliable parcel-wide slope coverage'],
    };
    const clean = buildDealOperatorAnalysis({
      pkg: packageFor(),
      context: emptyDealOperatorContext(),
      generatedAt: GENERATED_AT,
    });
    const quarantined = buildDealOperatorAnalysis({
      pkg: packageFor({ dueDiligence: [unsupported] }),
      context: emptyDealOperatorContext(),
      generatedAt: GENERATED_AT,
    });
    expect(quarantined.scores.property.score).toBe(clean.scores.property.score);
    expect(quarantined.scores.property.mainDeductions).toEqual([]);
    expect(quarantined.overall.mainRisks.join(' ')).not.toMatch(/Unsupported steep-slope/i);
    expect(quarantined.scores.property.materiallyChangeWith.join(' ')).toMatch(/replace the unsupported physical conclusion/i);
  });

  it('retains research attempts and reports what new evidence changed', () => {
    const previous = buildDealOperatorAnalysis({
      pkg: packageFor(),
      context: emptyDealOperatorContext(),
      generatedAt: '2026-07-27T12:00:00.000Z',
    });
    const evidence = {
      id: 'record:assessor',
      kind: 'record' as const,
      label: 'Assessor parcel record',
      sourceType: 'county assessor',
      sourceUrl: 'https://example.test/assessor',
      viewUrl: null,
      retrievedAt: GENERATED_AT,
      confidence: 'high' as const,
      supports: 'identity and acreage',
      sha256: null,
      bytes: null,
    };
    const analysis = buildDealOperatorAnalysis({
      pkg: packageFor({ evidence: [evidence] }),
      context: sellerContext(),
      previousSnapshot: {
        operatorAnalysis: previous,
        evidence: [],
      } as never,
      generatedAt: GENERATED_AT,
    });

    expect(analysis.researchAttempts).toEqual(sellerContext().researchAttempts);
    expect(analysis.changeNotes.join(' ')).toContain('1 new retained evidence item');
    expect(analysis.changeNotes.join(' ')).toContain('Assessor parcel record');
  });

  it('keeps the last answered data-center screen until replacement input has an answer', () => {
    const completedContext = emptyDealOperatorContext();
    completedContext.marketScan = {
      dataCenterWatch: {
        status: 'none_found',
        summary: 'The completed 20-mile subject screen found no qualifying data-center activity.',
        verdict: 'No qualifying data-center activity was found within 20 miles.',
        routesAttempted: ['web_search', 'browser_map'],
        items: [],
      },
    };
    const completed = buildDealOperatorAnalysis({
      pkg: packageFor(),
      context: completedContext,
      generatedAt: '2026-07-27T12:00:00.000Z',
    });

    const interrupted = buildDealOperatorAnalysis({
      pkg: packageFor(),
      context: emptyDealOperatorContext(),
      previousSnapshot: { operatorAnalysis: completed, evidence: [] } as never,
      generatedAt: GENERATED_AT,
    });
    expect(interrupted.market.dataCenters).toEqual(completed.market.dataCenters);
    expect(interrupted.market.dataCenters.status).toBe('none_found');

    const replacementContext = emptyDealOperatorContext();
    replacementContext.marketScan = {
      dataCenterWatch: {
        status: 'found',
        summary: 'A newer completed screen found one qualifying project.',
        verdict: 'One qualifying project was found within 20 miles.',
        routesAttempted: ['official_search'],
        items: [{ title: 'New campus', status: 'approved' }],
      },
    };
    const replaced = buildDealOperatorAnalysis({
      pkg: packageFor(),
      context: replacementContext,
      previousSnapshot: { operatorAnalysis: completed, evidence: [] } as never,
      generatedAt: GENERATED_AT,
    });
    expect(replaced.market.dataCenters.status).toBe('found');
    expect(replaced.market.dataCenters.summary).toContain('newer completed screen');
  });
});

describe('whole-card multimodal Analyst normalization', () => {
  let imageDir = '';
  let imagePath = '';

  beforeAll(() => {
    imageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-operator-analysis-'));
    imagePath = path.join(imageDir, 'parcel.png');
    // The image pre-filter intentionally rejects tiny captures. Content decoding
    // belongs to the provider, so deterministic bytes are sufficient here.
    fs.writeFileSync(imagePath, Buffer.alloc(9_000, 1));
  });

  afterAll(() => {
    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    if (fs.existsSync(imageDir)) fs.rmdirSync(imageDir);
  });

  it('clamps scores, derives ratings, validates strategy and grounds visual observations', async () => {
    const generate = vi.fn(async () => JSON.stringify({
      propertyScore: {
        score: 140,
        rating: 'invented',
        explanation: 'Visible road context improves the property read.',
        strongestPositiveFactors: ['Road context visible'],
        mainDeductions: [],
        materiallyChangeWith: ['Survey'],
        evidenceKeys: ['visual:Parcel aerial'],
      },
      marketScore: { score: -3, explanation: 'Thin market evidence.' },
      sellerScore: { score: 72.4, explanation: 'Motivated and contactable seller.' },
      posture: 'renegotiate',
      recommendation: 'Pursue only inside the current acquisition range.',
      bestStrategy: 'not an approved strategy',
      visualSummary: 'The parcel and adjoining road were reviewed.',
      visualObservations: [
        {
          category: 'road_frontage',
          observation: 'A road adjoins the subject boundary.',
          signal: 'positive',
          confidence: 'medium',
          sourceImage: 'Parcel aerial',
        },
        {
          category: 'terrain_slope',
          observation: 'Unsupported image reference.',
          signal: 'concern',
          confidence: 'high',
          sourceImage: 'Missing image',
        },
      ],
    }));

    const analysis = await runWholeCardOperatorAnalyst({
      pkg: packageFor(),
      context: sellerContext(),
      generatedAt: GENERATED_AT,
      images: [{ label: 'Parcel aerial', kind: 'satellite', path: imagePath }],
      generate,
      model: 'test-multimodal-model',
    });

    expect(generate).toHaveBeenCalledOnce();
    expect(analysis.analyst.mode).toBe('multimodal_llm_assisted');
    expect(analysis.analyst.model).toBe('test-multimodal-model');
    expect(analysis.analyst.reviewedImages).toEqual(['Parcel aerial']);
    expect(analysis.scores.property).toMatchObject({ score: 100, rating: 'Excellent' });
    expect(analysis.scores.market).toMatchObject({ score: 0, rating: 'Very weak' });
    expect(analysis.scores.seller).toMatchObject({ score: 72, rating: 'Strong' });
    expect(analysis.overall.bestCurrentStrategy).not.toBe('not an approved strategy');
    expect(analysis.overall.recommendation).toMatch(/pending valuation evidence/i);
    expect(analysis.evidenceNotes.join(' ')).toContain('Parcel aerial: A road adjoins');
    expect(analysis.evidenceNotes.join(' ')).not.toContain('Unsupported image reference');
  });

  it('rejects soil-component slope claims from property and market scores', async () => {
    const pkg = packageFor({
      dueDiligence: [{
        key: 'terrain',
        label: 'Terrain and buildability',
        verdict: 'unknown',
        headline: 'Needs visual verification — provider terrain output is quarantined from decision calculations.',
        detail: 'LandPortal terrain model retained for discovery sizing; field verification is still required.',
        grade: 'likely_indication',
        sourceUrl: null,
        missing: [],
      }],
    });
    const context = sellerContext();
    const fallback = buildDealOperatorAnalysis({ pkg, context, generatedAt: GENERATED_AT });
    const analysis = await runWholeCardOperatorAnalyst({
      pkg,
      context,
      generatedAt: GENERATED_AT,
      images: [{ label: 'Parcel aerial', kind: 'satellite', path: imagePath }],
      generate: async () => JSON.stringify({
        propertyScore: {
          score: 42,
          explanation: 'The tract has extreme topographic constraints and 40-70% slopes.',
          mainDeductions: ['High infrastructure cost caused by the 40-70% slopes.'],
          materiallyChangeWith: ['Verify parcel-wide terrain with a measured survey.'],
        },
        marketScore: {
          score: 58,
          explanation: 'Demand is moderate, but the subject parcel has extreme terrain.',
        },
        mainRisks: [
          'High infrastructure cost due to 40-70% slopes.',
          'The current seller position leaves a thin whole-tract margin.',
        ],
      }),
      model: 'test-multimodal-model',
    });

    expect(analysis.scores.property).toEqual(fallback.scores.property);
    expect(analysis.scores.market).toEqual(fallback.scores.market);
    expect(analysis.overall.mainRisks.join(' ')).not.toMatch(/40-70%|extreme topograph/i);
    expect(analysis.overall.mainRisks.join(' ')).toContain('thin whole-tract margin');
  });

  it('rejects recommendation prose that introduces a sixth, unranked strategy', async () => {
    const analysis = await runWholeCardOperatorAnalyst({
      pkg: packageFor(),
      context: sellerContext(),
      generatedAt: GENERATED_AT,
      images: [{ label: 'Parcel aerial', kind: 'satellite', path: imagePath }],
      generate: async () => JSON.stringify({
        bestStrategy: 'Quick Flip',
        recommendation: 'Quick Flip is useful, but Buy and Hold is the prime strategy.',
        marketScore: { score: 68, explanation: 'Usable but measured demand.' },
      }),
      model: 'test-multimodal-model',
    });

    expect(analysis.overall.bestCurrentStrategy).toBeNull();
    expect(analysis.overall.recommendation).toMatch(/pending valuation evidence/i);
    expect(analysis.overall.recommendation).not.toMatch(/Buy and Hold/i);
    expect(analysis.market.strength).toBe('Moderate');
    expect(analysis.market.strength).toBe(analysis.scores.market.rating);
  });

  it('falls back to deterministic synthesis when the multimodal provider fails', async () => {
    const pkg = packageFor();
    const context = sellerContext();
    const expected = buildDealOperatorAnalysis({ pkg, context, generatedAt: GENERATED_AT });

    const actual = await runWholeCardOperatorAnalyst({
      pkg,
      context,
      generatedAt: GENERATED_AT,
      images: [{ label: 'Parcel aerial', kind: 'satellite', path: imagePath }],
      generate: async () => { throw new Error('provider unavailable'); },
      model: 'test-multimodal-model',
    });

    expect(actual).toEqual(expected);
    expect(actual.analyst.mode).toBe('evidence_synthesis');
  });

  it('retains the last successful image review when the exact image set is unchanged', async () => {
    const pkg = packageFor();
    const context = sellerContext();
    const prior = await runWholeCardOperatorAnalyst({
      pkg,
      context,
      generatedAt: GENERATED_AT,
      images: [{ label: 'Parcel aerial', kind: 'satellite', path: imagePath }],
      generate: async () => JSON.stringify({
        bestStrategy: 'Quick Flip',
        recommendation: 'Lead with Quick Flip inside the current target range.',
        visualSummary: 'The subject boundary and adjoining road were reviewed.',
        visualObservations: [{
          category: 'road_frontage',
          observation: 'The retained aerial shows road context along the parcel.',
          signal: 'positive',
          confidence: 'medium',
          sourceImage: 'Parcel aerial',
        }],
      }),
      model: 'test-multimodal-model',
    });
    expect(prior.analyst.mode).toBe('multimodal_llm_assisted');

    const refreshed = await runWholeCardOperatorAnalyst({
      pkg,
      context,
      previousVisualSnapshot: {
        operatorAnalysis: prior,
        evidence: [],
      } as never,
      generatedAt: '2026-07-28T13:00:00.000Z',
      images: [{ label: 'Parcel aerial', kind: 'satellite', path: imagePath }],
      generate: async () => { throw new Error('provider unavailable'); },
      model: 'test-multimodal-model',
    });

    expect(refreshed.analyst.mode).toBe('multimodal_llm_assisted');
    expect(refreshed.analyst.reviewedImages).toEqual(['Parcel aerial']);
    expect(refreshed.analyst.visualSummary).toContain('adjoining road');
    expect(refreshed.analyst.groundingNote).toMatch(/most recent successful multimodal review/i);
  });
});

// ── ONE canonical current state governs the Overview ─────────────────────────
//
// The Overview is where stale comp/valuation contradictions were generated. It
// must now MIRROR the canonical state: it may not count comps for itself, may
// not resurrect a conclusion the accepted records superseded, and may not print
// a land-basis figure as though it were a completed whole-property value.

describe('canonical current state governs the operator analysis', () => {
  const PRICED_LAND = {
    priceable: true,
    range: { low: 500_000, high: 675_000 },
    pricePerAcreRange: { low: 7_800, high: 10_500 },
    likelyRetail: { low: 545_000, high: 675_000 },
    dispositionRange: { low: 350_000, high: 465_000 },
    basis: 'Five accepted closed sales.',
    adjustments: [],
    confidence: 'medium' as const,
    uncertainty: [],
    materialGaps: [],
    notPriceableReason: null,
    nextActionToPrice: null,
    workingValue: 545_000,
  };

  /** 9490-style: materially improved subject, land priced, improvements not. */
  const improvedSubjectState = () => buildCanonicalDealState({
    comps: {
      sold: Array.from({ length: 5 }, (_, index) => ({
        key: `sold-${index}`, address: `${index} Comp Rd`, lane: 'sold' as const, source: 'LandPortal',
        providerAttributions: ['LandPortal', 'Zillow'], sourceUrl: null, status: 'Source-stated sale',
        dateIso: '2026-01-15', price: 400_000, acres: 40, pricePerAcre: 10_000, distanceMiles: 4,
        whyUseful: 'Acreage-band sale.', similarities: [], differences: [],
      })),
      active: [],
      askingReferences: [],
      totalCollected: 9,
      duplicatesMerged: 4,
    },
    valuation: PRICED_LAND,
    subject: { improved: true, improvementBasis: 'house and outbuildings', improvementsValued: false },
    ownerSeller: { ownerOfRecord: 'WELLS MICHAEL C', ownerVerified: true, sellerName: null, sellerIntakeCollected: false },
    rawBlockers: ['No usable comp survived the acreage-band filter.', 'Recorded legal access is not established.'],
    rawMissingInformation: ['Another closed sale is still required before pricing.', 'Surveyed frontage'],
  });

  it('reads its comp counts from the canonical state instead of counting again', () => {
    const canonical = improvedSubjectState();
    expect(canonical.comps.sold).toBe(5);
    expect(canonical.comps.duplicatesMerged).toBe(4);
    // One physical property = one comp; a corroborating marketplace is a SOURCE.
    expect(canonical.comps.sources).toEqual(['LandPortal', 'Zillow']);

    const analysis = buildDealOperatorAnalysis({
      pkg: packageFor({ valuation: PRICED_LAND }),
      context: emptyDealOperatorContext(),
      generatedAt: GENERATED_AT,
      canonical,
    });
    expect(analysis.canonicalState).toBe(canonical);
    expect(analysis.scores.market.strongestPositiveFactors.join(' '))
      .toContain('5 selected source-stated sale(s)');
    expect(analysis.scores.market.materiallyChangeWith.join(' '))
      .toMatch(/canonical Comps & Valuation registry counts/);
  });

  it('drops the superseded comp conclusions from risks and open questions', () => {
    const canonical = improvedSubjectState();
    expect(canonical.supersededStatements.map((entry) => entry.statement)).toEqual([
      'No usable comp survived the acreage-band filter.',
      'Another closed sale is still required before pricing.',
    ]);

    const analysis = buildDealOperatorAnalysis({
      pkg: packageFor({ valuation: PRICED_LAND }),
      context: emptyDealOperatorContext(),
      generatedAt: GENERATED_AT,
      canonical,
    });
    const surface = JSON.stringify(analysis.overall);
    expect(surface).not.toMatch(/No usable comp survived/);
    expect(surface).not.toMatch(/Another closed sale is still required/);
    // Genuine, unsuperseded blockers still lead.
    expect(analysis.overall.mainRisks).toContain('Recorded legal access is not established.');
  });

  it('labels every acquisition figure as a LAND-BASIS reference on an improved subject', () => {
    const canonical = improvedSubjectState();
    const analysis = buildDealOperatorAnalysis({
      pkg: packageFor({ valuation: PRICED_LAND }),
      context: emptyDealOperatorContext(),
      generatedAt: GENERATED_AT,
      canonical,
    });

    expect(analysis.values.figureKind).toBe('land_basis_reference');
    expect(analysis.values.figureLabel).toMatch(/not a whole-property offer recommendation/i);
    expect(analysis.values.wholePropertyValue.state).toBe('pending');
    expect(analysis.values.wholePropertyValue.why).toMatch(/materially improved/i);
    expect(analysis.values.expectedMarketValue!.label).toBe('Land-basis expected market value');
    expect(analysis.values.targetAcquisitionRange!.label).toBe('Land-basis target acquisition range');
    expect(analysis.values.explanation).toMatch(/must not be read as a completed whole-property value/i);
    expect(analysis.overall.recommendation).toMatch(/Whole-property value remains pending/);
  });

  it('a vacant priceable subject keeps the plain whole-property labels', () => {
    const analysis = buildDealOperatorAnalysis({
      pkg: packageFor({ valuation: PRICED_LAND }),
      context: emptyDealOperatorContext(),
      generatedAt: GENERATED_AT,
      subjectImprovement: { improved: false },
    });
    expect(analysis.values.figureKind).toBe('whole_property_recommendation');
    expect(analysis.values.expectedMarketValue!.label).toBe('Expected market value');
    expect(analysis.values.wholePropertyValue.state).toBe('established');
  });

  it('defaults to a land-basis reference rather than assuming whole-property', () => {
    const analysis = buildDealOperatorAnalysis({
      pkg: packageFor(),
      context: emptyDealOperatorContext(),
      generatedAt: GENERATED_AT,
    });
    // Unpriced and unimproved: no completed whole-property value may be implied.
    expect(analysis.values.figureKind).toBe('land_basis_reference');
    expect(analysis.values.wholePropertyValue.state).toBe('pending');
    expect(analysis.canonicalState).toBeNull();
  });

  it('keeps "Seller: Not collected" valid beside a known owner of record', () => {
    const canonical = improvedSubjectState();
    expect(canonical.ownerSeller.ownerOfRecord).toBe('WELLS MICHAEL C');
    expect(canonical.ownerSeller.sellerName).toBeNull();
    expect(canonical.ownerSeller.sellerCollected).toBe(false);
    expect(canonical.ownerSeller.sellerLabel).toBe('Not collected');
    expect(canonical.ownerSeller.distinctionNote).toMatch(/not a confirmed seller or lead/i);
  });
});
