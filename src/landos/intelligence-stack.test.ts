import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AcquisitionDossier } from './acquisition-intelligence-dossier.js';
import type { AnalystRunInput, AnalystRunOutput } from './acquisition-analyst.js';
import type { ResearchReadinessManifest } from './research-readiness.js';
import type { DealIntelligenceProduct, SellerIntelligenceProduct } from './intelligence-stack-contract.js';

// The orchestration contract: one coordinated pass, dependency-aware refresh,
// readiness preflight that backfills only red machine gaps once, and Seller
// Intelligence that is honestly Unknown pre-contact without blocking the deal.

const writes: Array<Record<string, unknown>> = [];
const evidenceWrites: Array<Record<string, unknown>> = [];
const current = new Map<string, unknown>();
let dossierAfterEvidence: AcquisitionDossier | null = null;

vi.mock('./derived-intelligence-store.js', () => ({
  appendDerivedEvidence: (input: Record<string, unknown>) => {
    evidenceWrites.push(input);
    if (dossierAfterEvidence) dossier = dossierAfterEvidence;
    const rows = input.rows as unknown[];
    return { evidenceIds: rows.map((_row, index) => 900 + index), duplicates: 0, propertyIdentityVersionId: 1, skippedReason: null };
  },
  writeDerivedSnapshot: (input: Record<string, unknown>) => {
    writes.push(input);
    current.set(`${input.dealCardId}:${input.snapshotType}`, input.payload);
    return { snapshotId: writes.length, reused: false, propertyIdentityVersionId: 1, skippedReason: null };
  },
  readDerivedSnapshot: (dealCardId: number, snapshotType: string) => current.get(`${dealCardId}:${snapshotType}`) ?? null,
  readDerivedSnapshotHistory: () => [],
}));

let guidance: string[] = [];
vi.mock('./deal-brain-guidance.js', () => ({
  activeOperatorGuidance: () => [...guidance],
}));

let dossier: AcquisitionDossier;
vi.mock('./acquisition-intelligence-dossier.js', () => ({
  buildAcquisitionDossier: () => dossier,
}));

const { runIntelligenceStack } = await import('./intelligence-stack.js');

function emptySeller(): AcquisitionDossier['seller'] {
  return {
    present: false, name: null, askingPrice: null, stage: null, people: [], profile: null,
    sellerReportedFacts: [], communications: [], discovery: [],
    evidenceCounts: { communications: 0, discoveryExtractions: 0, reportedFacts: 0 },
  };
}

function baseDossier(): AcquisitionDossier {
  return {
    dossierVersion: '1.0.0',
    dealCardId: 89,
    propertyCardId: 79,
    assembledAt: '2026-08-19T00:00:00.000Z',
    identity: {
      state: null, confirmed: true, displayAddress: 'Map 042 Parcel 123, Fairview, TN', apn: '042-123.00-000',
      county: 'Williamson', city: 'Fairview', stateCode: 'TN', seller: null, owner: 'Owner', acres: 75.91, acreageBasis: 'assessor',
      hasParcelGeometry: true, basis: 'official record',
    },
    acreage: null,
    physical: {
      acres: 75.91, buildablePct: '60%', buildableAcres: '45', slopeAveragePct: '8%', acresUnder10PctSlope: '40',
      elevation: null, femaFloodZone: 'X', femaCoveragePct: null, wetlandsPct: null, wetlandsAcres: null, waterPresent: null,
      soils: null, improvement: null, parcelShapeNote: null,
    },
    access: { established: true, operatorStatement: 'Access established', frontageFt: 400, landLocked: 'No', roadName: 'Road', legalAccessStatement: 'Access established', recordedLegalAccessStatement: null, evidenceReached: [], outstanding: [] },
    landUse: {
      zoningEstablished: false, zoningStatement: null, districtCode: null, confidence: null, authority: null,
      historicalZoningReferences: [], byRightUses: [], manufacturedHousing: [],
      dimensionalStandards: {
        minimumLotSize: null, density: null, lotWidth: null, frontageBuildout: null,
        setbacks: null, heightOrCoverage: null, principalUses: [], specialConditions: [], sourceUrls: [],
      },
      limitations: [],
    },
    subdivision: {
      authority: null, likelyPath: null, likelyPathWhy: null, lotCountStatement: null, minimumLotArea: null,
      minimumLotWidth: null, minimumRoadFrontage: null, flagLots: null, sharedDriveways: null, privateRoads: null,
      newRoadTrigger: null, rules: [],
    },
    history: { narrative: null, highlights: [], openQuestions: [], documents: [], developmentEvents: [], developmentPaths: [] },
    valuation: {
      status: 'not_established', basis: null, workingAcres: 75.91, acceptedCompCount: 0,
      medianPricePerAcre: null, fairMarketValue: null, lpEstimate: null, blockers: [],
    },
    comps: { soldCount: 0, activeCompetitionCount: 0, askingReferenceCount: 3, note: null, acceptedSold: [], directional: [], activeCompetition: [], excluded: [] },
    market: {
      headline: null, acreageBand: '50-100 acres', medianDaysOnMarket: null, sellThroughRate: null,
      monthsOfSupply: null, medianPricePerAcre: null, fastestBand: '5-10 acres', interpretation: null,
      overallMarketRead: null, developmentSignals: [], acreageBands: [], research: null, marketPulse: null,
    },
    utilities: { septicAuthority: null, perLotApproval: null, unresolved: [] },
    officialAssessorRecord: null,
    seller: emptySeller(),
    documents: [],
    visuals: [],
    visualObservations: [],
    conflicts: [],
    openQuestions: [],
    blockers: [],
    missingInformation: [],
    coverage: { present: ['Property identity', 'Access'], absent: ['Current zoning'] },
    truncation: [],
  };
}

function manifest(overrides: Array<{ id: string; status: string; machineBackfillAllowed?: boolean; blocksIntelligence?: boolean }>): ResearchReadinessManifest {
  return {
    contractVersion: 'research-readiness-manifest-v1',
    headline: '10 / 19 ready',
    items: overrides.map((item) => ({
      id: item.id,
      label: item.id.replace(/_/g, ' '),
      status: item.status,
      machineBackfillAllowed: item.machineBackfillAllowed ?? false,
      blocksIntelligence: item.blocksIntelligence ?? false,
    })),
  } as unknown as ResearchReadinessManifest;
}

const LAYERED_REPLY = {
  property: {
    score: 55, read: 'A strong large parcel with real frontage.', strengths: ['400 ft of frontage'],
    constraints: [{ title: 'Zoning unresolved', why: 'not established', severity: 'medium' }],
    potential: ['Possible frontage split'], unknowns: [{ question: 'Current zoning?', why_it_matters: 'yield' }],
    next_actions: [{ action: 'Confirm zoning', why: 'gates yield' }],
  },
  market: {
    score: 50, read: 'A workable market for smaller tracts.', liquidity_read: '50-100 acre parcels move slowly.',
    area_story: 'Growing county.', buyer_pool: 'Rural residential buyers.', best_signals: ['Strong 5-10 acre band'],
    risks: ['Thin comp set'], exit_implications: ['Whole-tract exit is slow'], unknowns: [],
  },
  seller: {
    score: 62, read: 'Motivated but price-anchored.', motivation: 'Relocation', price_expectation: 'About $140,000',
    timeline: '90 days', decision_makers: 'Single owner', objections: ['Price'],
    negotiation_posture: 'Anchor low with evidence.', best_approach: 'Lead with certainty of close.',
    seller_reported_facts: [{ statement: 'Seller says septic perked in 2019', attribution: 'Seller call' }],
    follow_ups: ['Confirm deed names'],
  },
  deal: {
    score: 74,
    deal_read: { headline: 'Promising land, unpriced flip.', judgment: 'Good parcel; economics pending.', confidence: 'Likely' },
    property_story: ['Large parcel with frontage'], market_story: ['Slow band, strong small-lot demand'],
    opportunities: [], constraints: [], visual_observations: [], conflicts: [],
    strategies: [{ strategy: 'Quick flip', fit: 'possible', why_it_fits: 'simple exit' }],
    unknowns: [{ question: 'Supported FMV?', why_it_matters: 'prices everything' }],
    next_actions: [{ action: 'Accept comps', why: 'establish FMV' }],
    best_strategy: { strategy: 'Quick flip', why: 'Simplest realistic path.' },
    additional_upside: [{ title: 'Minor split', why: 'Frontage supports it', worth_it: 'Only if it adds real net' }],
    discovery_call_objective: 'Learn price expectation and timeline.',
    negotiation_posture: 'Evidence-first.',
    reads: { property: 'Good parcel.', market: 'Workable market.', seller: 'Unknown pre-contact.' },
  },
};

function fakeAnalyst(reply: Record<string, unknown> = LAYERED_REPLY) {
  const calls: Array<{ prompt: string }> = [];
  return {
    calls,
    analyst: {
      run: async (input: AnalystRunInput): Promise<AnalystRunOutput> => {
        const prompt = input.judgmentPromptBuilder?.(input.dossier, []) ?? '';
        calls.push({ prompt });
        return {
          raw: JSON.stringify(reply),
          marketExpertReview: 'A complete free expert market review that separates overall market quality from intact and transformed product fit. '.repeat(3)
            + '\nSOURCE LEDGER\n- Fairview planning | https://fairview-tn.org/planning | official_primary | Nearby phase approval.',
          propertyExpertReview: 'A complete free expert property review that understands the land: terrain, frontage, usable acreage continuity, configurations, and the controlling unknowns. '.repeat(3),
          observations: [],
          warnings: [],
          runtime: { engine: 'hermes', agentProfile: 'landos-acquisition-analyst', provider: 'openai-codex', model: 'gpt-5.6-sol', modelSource: 'default', durationMs: 5 },
        };
      },
    },
  };
}

const PRE_CALL_MANIFEST = manifest([
  { id: 'seller_information', status: 'gray' },
  { id: 'current_zoning', status: 'yellow', machineBackfillAllowed: false },
]);

function deps(overrides: Partial<Parameters<typeof runIntelligenceStack>[1]> = {}) {
  const { analyst } = fakeAnalyst();
  return {
    readPropertyFile: () => ({
      dealCardId: 89,
      propertyIntelligence: { snapshot: { operatorAnalysis: { scores: { property: { score: 82 }, market: { score: 76 } } } } },
    }),
    analyst,
    reconcileReadiness: () => PRE_CALL_MANIFEST,
    readPipelineStage: () => 'discovery_ready',
    now: () => new Date('2026-08-19T12:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  writes.length = 0;
  evidenceWrites.length = 0;
  current.clear();
  guidance = [];
  dossier = baseDossier();
  dossierAfterEvidence = null;
});

describe('pre-call intelligence run', () => {
  it('produces all four products in one coordinated pass, with Seller honestly pre-contact and no model call for it', async () => {
    const fake = fakeAnalyst();
    const result = await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: fake.analyst }));

    expect(result.outcome).toBe('produced');
    expect(result.phase).toBe('pre_call');
    expect(fake.calls).toHaveLength(1);
    // Seller is pre-contact: the pass asks only for property, market and deal.
    expect(fake.calls[0].prompt).toContain('top-level keys: "property", "market", "deal".');

    const seller = result.products.seller as SellerIntelligenceProduct;
    expect(seller.state).toBe('pre_contact');
    expect(seller.score).toBeNull();
    expect(seller.read).toMatch(/Unknown — pre-contact/);

    const deal = result.products.deal as DealIntelligenceProduct;
    expect(deal.phase).toBe('pre_call');
    expect(deal.scores.deal).toEqual({ score: null, label: null });
    // Property remains canonical; Market Score is the specialist's broader
    // market assessment, not the legacy intact-product operator score.
    expect(deal.scores.property).toMatchObject({ score: 82, source: 'canonical' });
    expect(deal.scores.market).toMatchObject({ score: 50, source: 'analyst' });
    expect(deal.reads.market).toBe('A workable market for smaller tracts.');
    expect(deal.scores.seller).toEqual({ score: null, state: 'pre_contact' });
    // Deterministic economics carried verbatim: no FMV means honestly pending.
    expect(deal.quickFlip.status).toBe('pending');
    expect(deal.discoveryCallObjective).toMatch(/price expectation/);
    expect(deal.whatChanged).toEqual(['First Deal Intelligence read for this card.']);
    expect(writes.map((write) => write.snapshotType)).toEqual([
      'intelligence_property_v1', 'intelligence_market_v1', 'intelligence_seller_v1', 'acquisition_intelligence_v1',
    ]);
  });

  it('reuses every layer when nothing changed — no analyst call, no writes', async () => {
    const fake = fakeAnalyst();
    await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: fake.analyst }));
    writes.length = 0;
    const second = await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: fake.analyst }));
    expect(second.outcome).toBe('reused');
    expect(fake.calls).toHaveLength(1);
    expect(writes).toHaveLength(0);
  });
  it('persists the full Stage A expert review, structured Market product, and traceable web evidence together', async () => {
    const reply = {
      ...LAYERED_REPLY,
      market: {
        ...LAYERED_REPLY.market,
        overall_market_quality: { grade: 'B', read: 'Healthy broader market.' },
        exit_product_fits: [{ product: 'Intact 51-acre tract', grade: 'D', expected_days: 260, confidence: 'medium', read: 'Thin buyer pool.' }],
        next_actions: [{ action: 'Verify neighboring phase inventory', why: 'Could alter lot absorption.' }],
        web_evidence: [{ query: 'Fairview TN subdivision phase', title: 'Fairview Planning Commission', url: 'https://fairview-tn.org/planning', source_type: 'official_primary', material_claim: 'A nearby residential phase is approved.', evidence_snippet: 'Phase approval', confidence: 'high' }],
      },
    };
    const fake = fakeAnalyst(reply);
    const result = await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: fake.analyst }));
    const market = result.products.market!;
    expect(market.expertReview).toContain('complete free expert market review');
    expect(market.overallMarketQuality.grade).toBe('B');
    expect(market.exitProductFits[0]).toMatchObject({ product: 'Intact 51-acre tract', grade: 'D', expectedDays: 260 });
    expect(market.nextActions[0]?.action).toBe('Verify neighboring phase inventory');
    expect(market.webEvidence[0]).toMatchObject({ url: 'https://fairview-tn.org/planning', retrievedAt: '2026-08-19T12:00:00.000Z' });
    expect(market.webEvidenceIds).toEqual([900]);
    expect(evidenceWrites[0]).toMatchObject({ dealCardId: 89, collectorKey: 'market-intelligence-web' });
    expect((evidenceWrites[0].rows as Array<Record<string, unknown>>)[0]).toMatchObject({
      domain: 'market_intelligence_web', evidenceKind: 'web_market_claim', sourceUrl: 'https://fairview-tn.org/planning', sourceTier: 'official_primary',
    });
  });

  it('persists the full Property Stage A expert review and the plausible configurations from Stage B', async () => {
    const reply = {
      ...LAYERED_REPLY,
      property: {
        ...LAYERED_REPLY.property,
        configurations: [
          { label: 'Intact 51-acre tract', status: 'physically_plausible', prerequisites: [] },
          { label: 'Minor frontage split', status: 'regulatorily_plausible', prerequisites: ['Confirm minimum lot frontage standard'] },
          { label: 'Major subdivision', status: 'unresolved', prerequisites: ['Sewer capacity', 'Road standards'] },
        ],
      },
    };
    const fake = fakeAnalyst(reply);
    const result = await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: fake.analyst }));
    const property = result.products.property!;
    expect(property.expertReview).toContain('complete free expert property review');
    expect(property.configurations).toHaveLength(3);
    expect(property.configurations[1]).toMatchObject({ label: 'Minor frontage split', status: 'regulatorily_plausible' });
    const propertyWrite = writes.find((write) => write.snapshotType === 'intelligence_property_v1')!;
    expect((propertyWrite.completeness as Record<string, number>).expertReview).toBeGreaterThan(200);
    expect((propertyWrite.completeness as Record<string, number>).configurations).toBe(3);
  });

  it('fails honestly when a Property refresh returns no free expert review before extraction', async () => {
    const analyst = {
      run: async (): Promise<AnalystRunOutput> => ({
        raw: JSON.stringify(LAYERED_REPLY),
        marketExpertReview: 'Market review. '.repeat(20) + '\nSOURCE LEDGER\n- NONE',
        observations: [],
        warnings: [],
        runtime: { engine: 'hermes', agentProfile: 'landos-property', provider: 'openai-codex', model: 'gpt-5.6-sol', modelSource: 'default', durationMs: 5 },
      }),
    };
    const result = await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst }));
    expect(result.outcome).toBe('failed');
    expect(result.reason).toContain('Property specialist returned no free expert review');
  });

  it('runs the bounded GEV spatial investigation before Property re-reasons, and rebuilds the evidence package when it lands observations', async () => {
    const investigations: number[] = [];
    const result = await runIntelligenceStack({ dealCardId: 89 }, deps({
      investigateSpatial: async (dealCardId) => {
        investigations.push(dealCardId);
        return { observationCount: 2, warnings: ['GEV note: keyless basemap in use.'] };
      },
    }));
    expect(investigations).toEqual([89]);
    expect(result.outcome).toBe('produced');
    expect(result.warnings).toContain('GEV note: keyless basemap in use.');
  });

  it('degrades a failed GEV spatial investigation to a warning and still produces the Property read', async () => {
    const result = await runIntelligenceStack({ dealCardId: 89 }, deps({
      investigateSpatial: async () => { throw new Error('no browser available'); },
    }));
    expect(result.outcome).toBe('produced');
    expect(result.warnings.some((warning) => warning.includes('spatial investigation did not complete'))).toBe(true);
    expect(result.products.property?.expertReview).toContain('complete free expert property review');
  });

  it('fingerprints the persisted post-search Market file so Stage A evidence cannot make the new read immediately stale', async () => {
    dossierAfterEvidence = {
      ...baseDossier(),
      market: {
        ...baseDossier().market,
        developmentSignals: [{
          name: 'Newly persisted official phase evidence',
          status: 'confirmed',
          likelyEffect: 'Adds competing residential pipeline.',
          distanceMiles: null,
        }],
      },
    };
    const fake = fakeAnalyst();
    const runDeps = deps({ analyst: fake.analyst });
    const first = await runIntelligenceStack({ dealCardId: 89 }, runDeps);
    expect(first.outcome).toBe('produced');

    writes.length = 0;
    const second = await runIntelligenceStack({ dealCardId: 89 }, runDeps);
    expect(second.outcome).toBe('reused');
    expect(fake.calls).toHaveLength(1);
    expect(writes).toHaveLength(0);
  });
});

describe('dependency-aware refresh', () => {
  it('refreshes only Seller and Deal when seller information changes', async () => {
    const first = fakeAnalyst();
    await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: first.analyst }));
    writes.length = 0;

    dossier = { ...baseDossier(), seller: { ...emptySeller(), present: true, name: 'Sam Seller', askingPrice: 140_000 } };
    const sellerManifest = manifest([
      { id: 'seller_information', status: 'green' },
      { id: 'current_zoning', status: 'yellow' },
    ]);
    const second = fakeAnalyst();
    const result = await runIntelligenceStack(
      { dealCardId: 89 },
      deps({ analyst: second.analyst, reconcileReadiness: () => sellerManifest }),
    );

    expect(result.outcome).toBe('produced');
    expect(result.refreshedLayers).toEqual(['seller', 'deal']);
    expect(result.reusedLayers).toEqual(['property', 'market']);
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0].prompt).not.toContain('"property":{"score"');
    expect(second.calls[0].prompt).toContain('"seller":{');
    expect(writes.map((write) => write.snapshotType)).toEqual(['intelligence_seller_v1', 'acquisition_intelligence_v1']);

    const seller = result.products.seller as SellerIntelligenceProduct;
    expect(seller.state).toBe('established');
    expect(seller.score).toBe(62);
    expect(seller.sellerReportedFacts[0]).toMatchObject({ attribution: 'Seller call' });

    const deal = result.products.deal as DealIntelligenceProduct;
    expect(deal.phase).toBe('underwriting');
    expect(deal.whatChanged.join(' ')).toMatch(/seller price of \$140,000 was added/i);
    // A known seller price with no supported FMV is not priceable — never a
    // fabricated pass/fail.
    expect(deal.sellerPriceVerdict.verdict).toBe('not_priceable');
  });

  it('folds new operator guidance into a deal-only refresh without touching property or market', async () => {
    const first = fakeAnalyst();
    await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: first.analyst }));
    writes.length = 0;

    guidance = ['I think the rear road matters.'];
    const second = fakeAnalyst();
    const result = await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: second.analyst }));

    expect(result.refreshedLayers).toEqual(['deal']);
    expect(second.calls[0].prompt).toContain('rear road matters');
    expect(second.calls[0].prompt).toContain('NOT a canonical property fact');
    const deal = result.products.deal as DealIntelligenceProduct;
    expect(deal.guidanceConsidered).toEqual(['I think the rear road matters.']);
    expect(deal.whatChanged.join(' ')).toMatch(/Operator guidance added/);
  });

  it('invalidates Market and Deal when a material retained Market Pulse input changes', async () => {
    const first = fakeAnalyst();
    await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: first.analyst }));
    writes.length = 0;
    dossier = {
      ...baseDossier(),
      market: { ...baseDossier().market, marketPulse: { generatedAt: '2026-08-25', neighboringDevelopment: 'New sub-one-acre phase under construction.' } },
    };
    const second = fakeAnalyst();
    const result = await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: second.analyst }));
    expect(result.refreshedLayers).toEqual(['market', 'deal']);
    expect(result.reusedLayers).toEqual(['property', 'seller']);
  });

  it('a new official assessor answer refreshes Property, then dependent Market and Deal, without rerunning Seller', async () => {
    const first = fakeAnalyst();
    await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: first.analyst }));
    writes.length = 0;

    // The bounded reconciliation just persisted a fresh assessor answer.
    dossier = {
      ...baseDossier(),
      officialAssessorRecord: {
        recordStatus: 'official_record_retrieved', retrievedAt: '2026-08-21T00:00:00.000Z',
        jurisdiction: 'Williamson County, TN', source: 'County assessor', ownerOfRecord: 'Owner',
        assessedAcres: 75.91, totalAppraisedValue: 400_000,
        improvements: null, summary: 'Land only; no current improvement.', attemptNote: null,
      },
    };
    const second = fakeAnalyst();
    const result = await runIntelligenceStack({ dealCardId: 89, layers: ['property'] }, deps({ analyst: second.analyst }));

    expect(result.outcome).toBe('produced');
    expect(result.refreshedLayers).toEqual(['property', 'market', 'deal']);
    expect(result.reusedLayers).toEqual(['seller']);
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0].prompt).toContain('OFFICIAL ASSESSOR RECORD DOCTRINE');
    expect(second.calls[0].prompt).toContain('Land only; no current improvement.');
    expect(writes.map((write) => write.snapshotType)).toEqual(['intelligence_property_v1', 'intelligence_market_v1', 'acquisition_intelligence_v1']);
  });
});

describe('readiness preflight', () => {
  it('backfills only red, machine-owned, intelligence-critical gaps — once — and never touches yellow', async () => {
    const backfilled: string[][] = [];
    const redManifest = manifest([
      { id: 'current_zoning', status: 'red', machineBackfillAllowed: true, blocksIntelligence: true },
      { id: 'subdivision_rules', status: 'yellow', machineBackfillAllowed: false },
      { id: 'seller_information', status: 'gray' },
    ]);
    const fake = fakeAnalyst();
    const result = await runIntelligenceStack({ dealCardId: 89 }, deps({
      analyst: fake.analyst,
      reconcileReadiness: () => redManifest,
      runBackfill: async (itemIds) => { backfilled.push(itemIds); return PRE_CALL_MANIFEST; },
    }));

    expect(backfilled).toEqual([['current_zoning']]);
    expect(result.backfilledItems).toEqual(['current_zoning']);
    expect(result.outcome).toBe('produced');
    // The unresolved yellow travels into the prompt as a named unknown.
    expect(fake.calls[0].prompt).toMatch(/still unresolved/i);
  });

  it('surfaces a model-detected visual/record conflict on the Property AND Deal products, with the bounded verification', async () => {
    const conflicted = {
      ...LAYERED_REPLY,
      property: {
        ...LAYERED_REPLY.property,
        conflicts: [{
          subject: 'Current improvement status',
          record_claim: 'Provider reports a 1,534 sq ft dwelling built 1968.',
          grounded_visual: 'No dwelling is visibly apparent in the retained aerial imagery.',
          interpretation: 'The record may be stale or the structure removed; imagery could also be stale.',
          recommended_verification: 'Current official assessor improvement record.',
        }],
      },
    };
    dossier = {
      ...baseDossier(),
      visualObservations: [{
        key: 'vision_improvements', category: 'improvements',
        observation: 'No dwelling or structure is visible on the parcel.',
        signal: 'concern', confidence: 'medium', sourceImage: 'close parcel aerial',
        model: 'gemini-3-flash-preview', analyzedAt: '2026-08-20T00:00:00.000Z', capturedAt: null,
        pixelGrounded: true,
      }],
    };
    const fake = fakeAnalyst(conflicted);
    const result = await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: fake.analyst }));
    expect(result.outcome).toBe('produced');
    const property = result.products.property!;
    const propertyConflict = property.conflicts.find((c) => /improvement/i.test(c.subject));
    expect(propertyConflict?.statement).toContain('Record claim: Provider reports a 1,534 sq ft dwelling built 1968.');
    expect(propertyConflict?.statement).toContain('Grounded visual observation: No dwelling is visibly apparent');
    expect(propertyConflict?.resolution).toContain('Recommended verification: Current official assessor improvement record.');
    // The Deal product carries it too — the "Conflicting evidence" surface
    // shows it even when the deal layer's own JSON omitted it.
    const deal = result.products.deal as DealIntelligenceProduct;
    expect(deal.conflicts.some((c) => /improvement/i.test(c.subject))).toBe(true);
  });

  it('treats a NEW grounded vision run as new property evidence: the property layer goes stale and re-reasons', async () => {
    const first = fakeAnalyst();
    await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: first.analyst }));
    writes.length = 0;

    dossier = {
      ...baseDossier(),
      visualObservations: [{
        key: 'vision_improvements', category: 'improvements',
        observation: 'No dwelling or structure is visible on the parcel.',
        signal: 'concern', confidence: 'medium', sourceImage: 'close parcel aerial',
        model: 'gemini-3-flash-preview', analyzedAt: '2026-08-20T00:00:00.000Z', capturedAt: null,
        pixelGrounded: true,
      }],
    };
    const second = fakeAnalyst();
    const result = await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: second.analyst }));
    expect(result.refreshedLayers).toContain('property');
  });

  it('runs pre-call Deal Intelligence even when seller information is an expected unknown', async () => {
    const fake = fakeAnalyst();
    const result = await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: fake.analyst }));
    expect(result.outcome).toBe('produced');
    expect((result.products.deal as DealIntelligenceProduct).scores.seller.state).toBe('pre_contact');
  });
});

describe('specialist executor plan on the analyst seam', () => {
  it('passes a per-layer specialist plan alongside the combined prompt, excluding pre-contact seller from the model layers', async () => {
    let plan: AnalystRunInput['specialistPlan'];
    const analyst = {
      run: async (input: AnalystRunInput): Promise<AnalystRunOutput> => {
        plan = input.specialistPlan;
        return {
          raw: JSON.stringify(LAYERED_REPLY),
          marketExpertReview: 'A complete free expert market review that separates overall market quality from intact and transformed product fit. '.repeat(3)
            + '\nSOURCE LEDGER\n- NONE',
          observations: [],
          warnings: [],
          runtime: { engine: 'hermes', agentProfile: 'landos-acquisition-analyst', provider: 'openai-codex', model: 'gpt-5.6-sol', modelSource: 'default', durationMs: 5 },
        };
      },
    };
    await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst }));
    expect(plan?.dealCardId).toBe(89);
    expect(plan?.layers).toEqual(['property', 'market', 'deal']);
    // The bounded layer prompt carries the authoritative envelope with the
    // CURRENT canonical facts and the memory-never-overrides rule.
    const propertyPrompt = plan!.layerPrompt('property', dossier, []);
    expect(propertyPrompt).toContain('LANDOS CURRENT DEAL CONTEXT (AUTHORITATIVE)');
    expect(propertyPrompt).toContain('this context wins');
    expect(propertyPrompt).not.toContain('"valuation"');
    // The chair prompt receives the fresh products, and the deterministic
    // pre-contact seller product rides along as the retained current seller.
    const dealPrompt = plan!.dealPrompt({ property: { read: 'Fresh property read.' } }, dossier, []);
    expect(dealPrompt).toContain('Fresh property read.');
    expect(dealPrompt).toContain('Unknown — pre-contact');
  });

  it('attaches per-layer specialist runtimes to their products when the executor reports them', async () => {
    const layerRuntime = (agentProfile: string) => ({
      engine: 'hermes', agentProfile, provider: 'openai-codex', model: 'gpt-5.6-sol',
      modelSource: 'default' as const, durationMs: 7, transport: 'hermes-cli-oneshot',
    });
    const analyst = {
      run: async (): Promise<AnalystRunOutput> => ({
        raw: JSON.stringify(LAYERED_REPLY),
        marketExpertReview: 'A complete free expert market review that separates overall market quality from intact and transformed product fit. '.repeat(3)
          + '\nSOURCE LEDGER\n- NONE',
        propertyExpertReview: 'A complete free expert property review that understands the land rather than summarizing fields. '.repeat(3),
        observations: [],
        warnings: [],
        runtime: layerRuntime('landos-deal-brain'),
        layerRuntimes: {
          property: layerRuntime('landos-property'),
          market: layerRuntime('landos-market'),
          deal: layerRuntime('landos-deal-brain'),
        },
      }),
    };
    const result = await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst }));
    expect(result.products.property?.runtime.agentProfile).toBe('landos-property');
    expect(result.products.market?.runtime.agentProfile).toBe('landos-market');
    expect(result.products.deal?.runtime.agentProfile).toBe('landos-deal-brain');
    // The deterministic pre-contact seller stays deterministic.
    expect(result.products.seller?.runtime.model).toBe('deterministic');
    const propertyWrite = writes.find((write) => write.snapshotType === 'intelligence_property_v1');
    expect(propertyWrite?.changeReason).toContain('landos-property');
  });

  it('a failed executor pass retains every last good product and fabricates nothing', async () => {
    const first = fakeAnalyst();
    await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: first.analyst }));
    writes.length = 0;

    guidance = ['New guidance to force a refresh.'];
    const failing = { run: async (): Promise<AnalystRunOutput> => { throw new Error('landos-market returned no parsable market layer'); } };
    const result = await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: failing }));
    expect(result.outcome).toBe('failed');
    expect(result.reason).toContain('landos-market returned no parsable market layer');
    expect(writes).toHaveLength(0);
    // The last good products are exactly what remains readable.
    expect(result.products.deal?.dealRead.headline).toBe('Promising land, unpriced flip.');
  });
});

describe('seller evidence reaches the seller layer', () => {
  it('treats a real communication record as seller contact even before the readiness checklist catches up, and carries the seller evidence doctrine into the prompt', async () => {
    dossier = {
      ...baseDossier(),
      seller: {
        ...emptySeller(),
        present: true,
        name: 'Sam Seller',
        stage: 'needs_follow_up',
        communications: [{ at: '2026-08-15T17:00:00.000Z', type: 'call', direction: 'outbound', summary: 'Discovery call', outcome: null, sentiment: null, followUpDate: null }],
        sellerReportedFacts: [{ statement: 'The property is raw land', source: 'seller profile', at: null }],
        evidenceCounts: { communications: 1, discoveryExtractions: 0, reportedFacts: 1 },
      },
    };
    const fake = fakeAnalyst();
    // Readiness still says gray: the persisted communication record wins.
    const result = await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: fake.analyst }));

    expect(result.outcome).toBe('produced');
    const seller = result.products.seller as SellerIntelligenceProduct;
    expect(seller.state).toBe('established');
    // The coordinated pass now asks for the seller layer too.
    expect(fake.calls[0].prompt).toContain('"seller":{');
    // The doctrine rides with the evidence: seller-reported stays seller-reported.
    expect(fake.calls[0].prompt).toContain('SELLER EVIDENCE DOCTRINE');
    expect(fake.calls[0].prompt).toContain('never becomes "no structure exists"');
    // The evidence itself is in the property file the model receives.
    expect(fake.calls[0].prompt).toContain('The property is raw land');
  });

  it('keeps the pre-contact product honest with the new fields empty, and never fabricates contradictions or a next question', async () => {
    const fake = fakeAnalyst();
    const result = await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: fake.analyst }));
    const seller = result.products.seller as SellerIntelligenceProduct;
    expect(seller.state).toBe('pre_contact');
    expect(seller.contradictions).toEqual([]);
    expect(seller.unknowns).toEqual([]);
    expect(seller.nextQuestion).toBeNull();
    // No seller evidence means no seller doctrine block in the prompt.
    expect(fake.calls[0].prompt).not.toContain('SELLER EVIDENCE DOCTRINE');
  });

  it('marks only the seller layer stale when new seller communication lands', async () => {
    const first = fakeAnalyst();
    await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: first.analyst }));
    writes.length = 0;

    dossier = {
      ...baseDossier(),
      seller: {
        ...emptySeller(),
        present: true,
        name: 'Sam Seller',
        communications: [{ at: '2026-08-15T17:00:00.000Z', type: 'call', direction: 'outbound', summary: 'Discovery call', outcome: null, sentiment: null, followUpDate: null }],
        evidenceCounts: { communications: 1, discoveryExtractions: 0, reportedFacts: 0 },
      },
    };
    const second = fakeAnalyst();
    const result = await runIntelligenceStack({ dealCardId: 89 }, deps({ analyst: second.analyst }));
    expect(result.refreshedLayers).toEqual(['seller', 'deal']);
    expect(result.reusedLayers).toEqual(['property', 'market']);
  });
});
