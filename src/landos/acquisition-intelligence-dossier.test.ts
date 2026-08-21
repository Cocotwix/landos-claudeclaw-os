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

  it('reports coverage honestly, so a thin file cannot read as a complete one', () => {
    const dossier = buildAcquisitionDossier(file());
    expect(dossier.coverage.present).toContain('Property identity');
    expect(dossier.coverage.absent).toEqual(expect.arrayContaining(['Current zoning', 'Comps', 'Valuation', 'Seller information']));
  });

  it('runs the material-fact reconciliation as part of assembly', () => {
    const dossier = buildAcquisitionDossier(file());
    expect(dossier.conflicts.map((conflict) => conflict.subject)).toContain('frontage');
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
