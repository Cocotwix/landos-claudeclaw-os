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
