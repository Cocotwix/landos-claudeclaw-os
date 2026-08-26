import { describe, expect, it } from 'vitest';

import { buildAcquisitionDossier, type PropertyFileSource } from './acquisition-intelligence-dossier.js';

// The dossier is the seam between "what LandOS researched" and "what an analyst
// reasons over". It must be pure, bounded, defensive, and honest about what the
// file does not contain — anything less and a thin property file reads as a
// complete one.

const now = () => new Date('2026-08-18T00:00:00.000Z');

function file(overrides: Partial<PropertyFileSource> = {}): PropertyFileSource {
  return {
    dealCardId: 89,
    propertyCardId: 79,
    now,
    propertyIntelligence: {
      snapshot: {
        identity: {
          state: 'confirmed', displayAddress: 'Map 042 Parcel 123, Fairview, TN 37062',
          apn: '042-123.00-000', county: 'Williamson', state_: 'TN', owner: 'LANDSOUTH LLC',
          acres: 75.91, acreageBasis: 'assessed', hasParcelGeometry: true,
          discoveryBasis: 'Confirmed against the official parcel record.',
        },
      },
      landPortalFacts: {
        acres: 75.91,
        buildability: { pct: '96%', acres: '72.87 ac' },
        terrain: { slopeAvgPct: '11%', slopeUnder10Pct: '48%' },
        environment: { femaFloodZone: 'X', femaCoveragePct: '0%', wetlandsPct: '2%' },
        access: { landLocked: 'No', roadFrontageFt: 50 },
      },
      access: { frontageFt: 22.94, road: 'Fairview Blvd', legalAccess: 'Yes', evidence: { rungs: [], outstanding: [] } },
      landUseIntelligence: {
        currentZoning: { established: false, statement: 'Current zoning is unresolved.', authorityName: 'Fairview', references: [] },
        subdivision: { authorityName: 'Fairview', likelyPathLabel: 'unknown', lotCountStatement: 'Not calculated.', rules: [] },
        backstory: { narrative: 'Four planning matters in 2024.', highlights: ['A 119-lot plan was recommended.'] },
      },
      compsValuation: { summary: { statusLabel: 'Not priceable', workingAcres: 75.91, acceptedCount: 0 }, counts: {} },
      researchStatus: { openQuestions: [{ label: 'What is the current district?' }] },
      canonicalState: { blockers: ['Current zoning unresolved'], missingInformation: ['Recorded access instrument'] },
    },
    marketContext: {
      read: { headline: 'Large acreage moves slowly here.', acreageBandLabel: '50-100 ac' },
      liquidity: { medianDaysOnMarket: 180, sellThroughRate: 12, monthsOfSupply: 40, medianPricePerAcre: 9_500 },
      fastestBand: { acreageBandLabel: '2-5 ac' },
      interpretation: 'Small parcels clear far faster than the subject band.',
    },
    dealCard: { people: [], asking_price: null },
    visuals: [
      { key: 'close_parcel_aerial', label: 'close parcel aerial', purpose: 'Full-boundary close parcel aerial', capturedAt: '2026-08-16T20:23:14.828Z', filePath: 'C:/store/visuals/close.png' },
      { key: 'surrounding_area_aerial', label: 'surrounding area aerial', purpose: 'Surrounding-area aerial', capturedAt: '2026-08-16T20:24:00.000Z', filePath: 'C:/store/visuals/surrounding.png' },
    ],
    ...overrides,
  };
}

describe('what the dossier carries', () => {
  it('reads identity, physical, access, land use, market and visuals from the canonical file', () => {
    const dossier = buildAcquisitionDossier(file());
    expect(dossier.identity).toMatchObject({ confirmed: true, apn: '042-123.00-000', acres: 75.91, acreageBasis: 'assessed' });
    // Percentages AND acres both survive: an operator buys acres.
    expect(dossier.physical).toMatchObject({ buildablePct: '96%', buildableAcres: '72.87 ac', acresUnder10PctSlope: '48%' });
    expect(dossier.landUse.zoningEstablished).toBe(false);
    expect(dossier.market).toMatchObject({ medianDaysOnMarket: 180, fastestBand: '2-5 ac' });
    expect(dossier.visuals.map((visual) => visual.key)).toEqual(['close_parcel_aerial', 'surrounding_area_aerial']);
  });

  it('aligns the live Market producer contract and preserves complete research, Pulse, and actual competitive records', () => {
    const source = file();
    const pi = source.propertyIntelligence as Record<string, any>;
    pi.compsValuation = {
      summary: { statusLabel: 'Priceable', workingAcres: 51.11, acceptedCount: 1 },
      counts: { accepted_closed_sale: 1, active_competition: 1 },
      comps: [
        { key: 'sold-1', category: 'accepted_closed_sale', categoryLabel: 'Accepted sale', classificationReason: 'Same market', address: '1 Sold Rd', statusLabel: 'Sold', transactionKind: 'closed_sale', priceKind: 'sale', price: 510000, acres: 51, pricePerAcre: 10000, dateIso: '2026-01-01', daysOnMarket: 80, source: 'County', origins: ['County'], inValuationSet: true, operatorExcluded: false },
        { key: 'active-1', category: 'active_competition', categoryLabel: 'Active', classificationReason: 'Current competition', address: '2 Active Rd', statusLabel: 'Active', transactionKind: 'active_listing', priceKind: 'list', price: 625000, acres: 50, pricePerAcre: 12500, daysOnMarket: 120, source: 'Listing', sourceUrl: 'https://example.com/active', origins: ['Listing'], inValuationSet: false, operatorExcluded: false, listing: { transactionKind: 'active', price: { amount: 625000 }, marketTime: { cumulativeDays: 120 }, characteristics: { acreage: 50 }, evidence: { sourcePage: 'https://example.com/active', provider: 'Listing', diagnostics: { capturedAtIso: '2026-08-25T05:51:20.679Z', route: 'provider-debug' } } } },
      ],
    };
    const researchRows = ['all', '0-1', '1-2', '2-5', '5-10', '10-20', '20-50', '50-100', '100+'].map((acreageBand, index) => ({
      acreageBand,
      geography: 'county',
      metrics: { salesCount: 10 + index, listingCount: 3 + index, daysOnMarket: 30 + index, sellThroughRate: 70 + index, monthsOfSupply: 5 + index },
    }));
    source.marketContext = {
      read: { headline: 'Producer read survives.', acreageBandLabel: '50-100 ac' },
      liquidity: { medianDaysOnMarket: 180, sellThroughRate: 12, monthsOfSupply: 40, medianPricePerAcre: 9_500 },
      fastestBand: { acreageBandLabel: '2-5 ac' },
      interpretation: 'Producer interpretation.',
      research: { contractVersion: 'market-research-subject-file-v1', countyRows: researchRows, zipRows: [], rows: researchRows },
    };
    source.marketPulse = {
      marketScan: {
        growthSignals: { items: [{ title: 'Neighbor subdivision phase', status: 'under construction', whyItMatters: 'Sub-one-acre homes are being delivered.', distanceMiles: 0.2 }] },
        dataCenterWatch: { items: [] },
      },
    };

    const dossier = buildAcquisitionDossier(source);
    expect(dossier.market.overallMarketRead).toBe('Producer read survives.');
    expect((dossier.market.research as any).rows).toHaveLength(9);
    expect(dossier.market.acreageBands.map((row) => row.label)).toContain('0-1');
    expect(dossier.market.developmentSignals[0]?.name).toBe('Neighbor subdivision phase');
    expect(dossier.comps.acceptedSold[0]).toMatchObject({ key: 'sold-1', price: 510000, acres: 51, inValuationSet: true });
    expect(dossier.comps.activeCompetition[0]).toMatchObject({ key: 'active-1', daysOnMarket: 120, sourceUrl: 'https://example.com/active' });
    expect((dossier.comps.activeCompetition[0]?.listing as any).evidence).toEqual({
      sourcePage: 'https://example.com/active', provider: 'Listing', sourcePages: [], apn: null,
    });
    expect(JSON.stringify(dossier.comps)).not.toContain('capturedAtIso');
    expect(JSON.stringify(dossier.comps)).not.toContain('provider-debug');

    // Read-time provider diagnostics are presentation machinery, not Market
    // evidence. A fresh diagnostic timestamp must not change the dossier.
    (pi.compsValuation.comps[1].listing.evidence.diagnostics as any).capturedAtIso = '2026-08-25T05:51:24.773Z';
    expect(buildAcquisitionDossier(source).comps).toEqual(dossier.comps);
  });

  it('joins already-persisted adopted-code meaning only when it matches the current district', () => {
    const source = file();
    const pi = source.propertyIntelligence as Record<string, any>;
    pi.landUseIntelligence.currentZoning = {
      established: true, districtCode: 'CD-3L', statement: 'Current CD-3L.', authorityName: 'Fairview', references: [],
    };
    pi.zoningStandards = {
      established: true,
      districtCode: 'CD-3L',
      allowedUses: [{ use: 'House', status: 'permitted' }],
      standards: {
        minimumLotSize: 'Not regulated by the district table', density: '2 dwelling units per acre max.',
        lotWidth: '100 ft. min., 150 ft. max.', frontage: '40% min.', setbacks: '40 ft. min.',
        heightOrCoverage: '60% max.', principalUses: ['House: Permitted.'],
        specialConditions: ['Principal building 2 stories max.'],
        sources: [{ url: 'https://fairview.example.gov/code.pdf' }],
      },
      limitations: ['Development-site density applies.'],
    };
    const current = buildAcquisitionDossier(source);
    expect(current.landUse.byRightUses).toEqual(['House (permitted)']);
    expect(current.landUse.dimensionalStandards).toMatchObject({
      minimumLotSize: 'Not regulated by the district table',
      density: '2 dwelling units per acre max.',
      lotWidth: '100 ft. min., 150 ft. max.',
    });

    pi.zoningStandards.districtCode = 'R-20';
    const stale = buildAcquisitionDossier(source);
    expect(stale.landUse.byRightUses).toEqual([]);
    expect(stale.landUse.dimensionalStandards.density).toBeNull();
  });

  it('reports coverage honestly, so a thin file cannot read as a complete one', () => {
    const dossier = buildAcquisitionDossier(file());
    expect(dossier.coverage.present).toContain('Property identity');
    expect(dossier.coverage.absent).toEqual(expect.arrayContaining(['Current zoning', 'Comps', 'Valuation', 'Seller information']));
  });

  it('runs the material-fact reconciliation as part of assembly', () => {
    const dossier = buildAcquisitionDossier(file());
    expect(dossier.conflicts.map((conflict) => conflict.subject)).toContain('frontage');
  });

  it('keeps resolved historical values out of the current conflict set', () => {
    const dossier = buildAcquisitionDossier(file({
      acreageExtent: { decision: { canonicalAcres: 51.11, canonicalSource: 'Current assessor parcel' } },
    }));
    expect(dossier.conflicts.map((conflict) => conflict.subject)).not.toContain('acreage');
    expect(dossier.acreage?.retainedFigures).toEqual([]);
  });

  it('carries the latest official assessor answer — including an honest not-retrieved attempt — with its provenance', () => {
    const retrieved = buildAcquisitionDossier(file({
      assessorTax: {
        status: 'SUCCEEDED',
        facts: {
          recordStatus: 'official_record_retrieved',
          jurisdiction: 'Williamson County, TN',
          assessor: { ownerOfRecord: 'LANDSOUTH LLC', assessedAcres: 75.91, totalAppraisedValue: 402_000 },
          improvements: { structureType: null, yearBuilt: null, buildingSqft: null },
          summary: 'Official record retrieved: land only.',
          sourceAttempts: [],
        },
        evidence: [{ source: 'Williamson County assessor', sourceUrl: null, retrievedAt: '2026-08-21T00:00:00.000Z' }],
        warnings: [],
        timestamps: { startedAt: '2026-08-21T00:00:00.000Z', completedAt: '2026-08-21T00:00:05.000Z' },
      },
    }));
    expect(retrieved.officialAssessorRecord).toMatchObject({
      recordStatus: 'official_record_retrieved',
      ownerOfRecord: 'LANDSOUTH LLC',
      assessedAcres: 75.91,
      source: 'Williamson County assessor',
      summary: 'Official record retrieved: land only.',
    });
    expect(retrieved.coverage.present).toContain('Official assessor record');

    const failed = buildAcquisitionDossier(file({
      assessorTax: {
        status: 'NEEDS_INPUT',
        facts: { recordStatus: 'not_retrieved', summary: 'No assessor or tax record has been retrieved for this subject.', sourceAttempts: [{ source: 'Tennessee Comptroller public parcel layer' }] },
        warnings: ['No official parcel source returned an assessor record.'],
        timestamps: { completedAt: '2026-08-21T00:00:05.000Z' },
      },
    }));
    expect(failed.officialAssessorRecord).toMatchObject({
      recordStatus: 'not_retrieved',
      attemptNote: 'No official parcel source returned an assessor record.',
      source: 'Tennessee Comptroller public parcel layer',
    });
    expect(failed.coverage.absent).toContain('Official assessor record');

    expect(buildAcquisitionDossier(file()).officialAssessorRecord).toBeNull();
  });
});

describe('bounding', () => {
  it('caps long lists and COUNTS what it dropped instead of hiding it', () => {
    const rules = Array.from({ length: 27 }, (_unused, index) => ({
      label: `Rule ${index}`, value: `Value ${index}`, section: `${index}`, sourceUrl: 'https://example.gov/x', confidence: 'confirmed',
    }));
    const source = file();
    (source.propertyIntelligence as Record<string, never>).landUseIntelligence = {
      subdivision: { rules },
    } as never;
    const dossier = buildAcquisitionDossier(source);
    expect(dossier.subdivision.rules.length).toBeLessThan(27);
    expect(dossier.truncation.join(' ')).toMatch(/Subdivision rules: 9 of 27 not carried/);
  });

  it('truncates a very long passage rather than shipping an unbounded dossier', () => {
    const source = file();
    (source.propertyIntelligence as Record<string, never>).landUseIntelligence = {
      backstory: { narrative: 'x'.repeat(5_000) },
    } as never;
    const dossier = buildAcquisitionDossier(source);
    expect(dossier.history.narrative!.length).toBeLessThanOrEqual(1_800);
    expect(dossier.history.narrative!.endsWith('…')).toBe(true);
  });

  it('stays small enough to reason over in one pass', () => {
    expect(JSON.stringify(buildAcquisitionDossier(file())).length).toBeLessThan(60_000);
  });
});

describe('defensiveness', () => {
  it('assembles an empty dossier from an empty property file without throwing', () => {
    const dossier = buildAcquisitionDossier({ dealCardId: 1, now });
    expect(dossier.identity.confirmed).toBe(false);
    expect(dossier.conflicts).toEqual([]);
    expect(dossier.coverage.present).toEqual([]);
    expect(dossier.coverage.absent.length).toBeGreaterThan(5);
  });

  it('tolerates wrong-typed sections the way it tolerates missing ones', () => {
    const dossier = buildAcquisitionDossier({
      dealCardId: 1,
      now,
      propertyIntelligence: { snapshot: 'not an object', landPortalFacts: [1, 2, 3], landUse: 7 } as never,
    });
    expect(dossier.identity.apn).toBeNull();
    expect(dossier.subdivision.rules).toEqual([]);
  });
});

describe('purity', () => {
  it('is a pure function of what it is handed: same input, same dossier', () => {
    const first = buildAcquisitionDossier(file());
    const second = buildAcquisitionDossier(file());
    expect(second).toEqual(first);
  });

  it('does not mutate the property file it was given', () => {
    const source = file();
    const before = JSON.stringify(source);
    buildAcquisitionDossier(source);
    expect(JSON.stringify(source)).toBe(before);
  });
});

// ── Seller evidence assembly ─────────────────────────────────────────────
//
// The seller section is the bounded SELLER EVIDENCE record: assembled from the
// deal's people, the Acquisitions CRM state and the seller-stated fact rows —
// never from a new store. Statements stay SELLER-REPORTED with provenance, and
// chronology survives bounding at both ends.

function sellerFile(overrides: Partial<PropertyFileSource> = {}): PropertyFileSource {
  return file({
    dealCard: {
      people: [
        { name: 'Sam Seller', role: 'seller', authority_status: 'confirmed', primary_contact: true },
        { name: 'Heir Two', role: 'heir', authority_status: 'unknown' },
      ],
      asking_price: 140_000,
    },
    acquisition: {
      stage: 'needs_follow_up',
      profile: {
        name: 'Sam Seller', motivation: 'Relocating for work', timeline: 'Wants to close inside 90 days',
        askingPrice: 'About $140,000', priceFlexibility: 'Some, with a fast close',
        decisionMakers: 'Sam plus a sibling on the deed', sellerStatedFacts: ['The property is raw land'],
        objections: ['Worried about lowball offers'], concerns: [], commitments: ['Will send the deed copy'],
        unknowns: ['Whether the sibling agrees'],
      },
      commLog: [
        { at: '2026-08-15T17:00:00.000Z', type: 'call', channel: 'call', direction: 'outbound', summary: 'Discovery call: motivation and price discussed', outcome: 'Positive', sentiment: 'positive', keyFacts: ['Seller says the tract has never been built on'], createdAt: '2026-08-15T17:30:00.000Z' },
        { at: '2026-08-01T12:00:00.000Z', type: 'text', channel: 'text', direction: 'inbound', summary: 'Seller replied asking who we are', createdAt: '2026-08-01T12:01:00.000Z' },
      ],
      discovery: [{
        rawNotes: 'notes', motivation: 'Relocation', timeline: '90 days', priceExpectation: '$140,000',
        decisionMakers: 'Sam + sibling', sellerClaimedFacts: ['Septic perked in 2019'], objections: [],
        emotionalTone: 'even', urgency: 'moderate', risks: [], followUpItems: ['Confirm deed names'],
        unansweredQuestions: ['Any liens?'], capturedAt: '2026-08-15T18:00:00.000Z',
      }],
    },
    sellerStatedFacts: [
      { kind: 'improvements', value: 'No structures on the land', recordedAt: 1_755_300_000, recordedBy: 'tyler' },
    ],
    ...overrides,
  });
}

describe('seller evidence assembly', () => {
  it('assembles materially richer evidence than name + asking price from the existing sources', () => {
    const seller = buildAcquisitionDossier(sellerFile()).seller;
    expect(seller).toMatchObject({ present: true, name: 'Sam Seller', askingPrice: 140_000, stage: 'needs_follow_up' });
    expect(seller.people).toHaveLength(2);
    expect(seller.people[0]).toMatchObject({ role: 'seller', authorityStatus: 'confirmed', primaryContact: true });
    expect(seller.profile).toMatchObject({ motivation: 'Relocating for work', decisionMakers: 'Sam plus a sibling on the deed' });
    expect(seller.communications).toHaveLength(2);
    expect(seller.discovery).toHaveLength(1);
    expect(seller.evidenceCounts).toEqual({ communications: 2, discoveryExtractions: 1, reportedFacts: 4 });
  });

  it('keeps every seller statement SELLER-REPORTED with its provenance, deduplicated across sources', () => {
    const seller = buildAcquisitionDossier(sellerFile()).seller;
    const bySource = Object.fromEntries(seller.sellerReportedFacts.map((fact) => [fact.statement, fact.source]));
    expect(bySource['improvements: No structures on the land']).toBe('seller_stated_fact record');
    expect(bySource['Septic perked in 2019']).toBe('discovery call');
    expect(bySource['Seller says the tract has never been built on']).toBe('call log');
    expect(bySource['The property is raw land']).toBe('seller profile');
    // Dedup: repeating the same statement in two sources carries it once.
    const duplicated = sellerFile();
    (duplicated.acquisition as { profile: { sellerStatedFacts: string[] } }).profile.sellerStatedFacts.push('Septic perked in 2019');
    const facts = buildAcquisitionDossier(duplicated).seller.sellerReportedFacts;
    expect(facts.filter((fact) => fact.statement === 'Septic perked in 2019')).toHaveLength(1);
  });

  it('carries communications oldest → newest and retains the earliest entries when bounding, so material older statements survive', () => {
    const seller = buildAcquisitionDossier(sellerFile()).seller;
    expect(seller.communications.map((entry) => entry.type)).toEqual(['text', 'call']);

    const many = sellerFile();
    (many.acquisition as { commLog: unknown[] }).commLog = Array.from({ length: 40 }, (_, index) => ({
      at: `2026-07-${String((index % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
      type: 'text', channel: 'text', direction: 'outbound', summary: `Message ${index + 1}`,
      createdAt: `2026-07-${String((index % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
    }));
    (many.acquisition as { commLog: Array<{ at: string; summary: string }> }).commLog.push(
      { at: '2026-06-01T09:00:00.000Z', summary: 'EARLIEST: seller first said they would take $95,000' } as never,
    );
    const bounded = buildAcquisitionDossier(many).seller;
    expect(bounded.communications).toHaveLength(24);
    expect(bounded.communications[0].summary).toContain('EARLIEST');
    expect(bounded.evidenceCounts.communications).toBe(41);
    expect(buildAcquisitionDossier(many).truncation.join(' ')).toMatch(/Seller communications: 17 of 41/);
  });

  it('is deal-scoped by construction: another deal\'s evidence never appears in this dossier', () => {
    const dealA = buildAcquisitionDossier(sellerFile()).seller;
    const dealB = buildAcquisitionDossier(file({ dealCard: { people: [], asking_price: null } })).seller;
    expect(dealB.communications).toEqual([]);
    expect(dealB.sellerReportedFacts).toEqual([]);
    expect(dealA.communications.length).toBeGreaterThan(0);
    const dealBText = JSON.stringify(dealB);
    for (const entry of dealA.communications) expect(dealBText).not.toContain(entry.summary);
  });

  it('reports an honest empty seller record when nothing is persisted, and coverage says so', () => {
    const dossier = buildAcquisitionDossier(file());
    expect(dossier.seller).toMatchObject({ present: false, name: null, askingPrice: null, profile: null });
    expect(dossier.seller.evidenceCounts).toEqual({ communications: 0, discoveryExtractions: 0, reportedFacts: 0 });
    expect(dossier.coverage.absent).toEqual(expect.arrayContaining(['Seller communication record', 'Seller-reported property facts']));
    const withEvidence = buildAcquisitionDossier(sellerFile());
    expect(withEvidence.coverage.present).toEqual(expect.arrayContaining(['Seller information', 'Seller communication record', 'Seller-reported property facts']));
  });
});
