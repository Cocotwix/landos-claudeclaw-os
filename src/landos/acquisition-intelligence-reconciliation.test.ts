import { describe, expect, it } from 'vitest';

import { reconcileMaterialFacts } from './acquisition-intelligence-reconciliation.js';

// Reconciliation exists to stop ONE failure: an intelligence layer that reads
// two values for a material fact, prints one, and lets an operator size a deal
// on it. Every case here is that failure, or its absence.

const bySubject = (conflicts: ReturnType<typeof reconcileMaterialFacts>, subject: string) =>
  conflicts.find((conflict) => conflict.subject === subject);

describe('frontage', () => {
  it('carries BOTH retained frontage values and refuses to establish one', () => {
    const conflicts = reconcileMaterialFacts({
      propertyIntelligence: {
        access: { frontageFt: 22.94 },
        landPortalFacts: { access: { roadFrontageFt: 50 } },
      },
    });
    const frontage = bySubject(conflicts, 'frontage');
    expect(frontage).toBeTruthy();
    expect(frontage!.resolution).toBe('unresolved');
    expect(frontage!.statement).toContain('22.94');
    expect(frontage!.statement).toContain('50');
    expect(frontage!.statement).toMatch(/not established/i);
    expect(frontage!.values.map((value) => value.source)).toEqual(
      expect.arrayContaining(['LandOS access read', 'LandPortal parcel record']),
    );
    // The operator has to know what relying on either number would break.
    expect(frontage!.decisionAtRisk).toMatch(/subdivision yield/i);
  });

  it('does not manufacture a conflict from a rounding difference', () => {
    const conflicts = reconcileMaterialFacts({
      propertyIntelligence: {
        access: { frontageFt: 50 },
        landPortalFacts: { access: { roadFrontageFt: 50.4 } },
      },
    });
    expect(bySubject(conflicts, 'frontage')).toBeUndefined();
  });

  it('reports nothing when only one source measured frontage', () => {
    const conflicts = reconcileMaterialFacts({
      propertyIntelligence: { access: { frontageFt: 22.94 }, landPortalFacts: {} },
    });
    expect(bySubject(conflicts, 'frontage')).toBeUndefined();
  });
});

describe('acreage', () => {
  it('uses the retained official acreage/extent reconciliation over historical provider acreage', () => {
    const conflicts = reconcileMaterialFacts({
      acreageExtent: {
        decision: { canonicalAcres: 51.11, canonicalSource: 'Current assessor parcel' },
      },
      propertyIntelligence: {
        snapshot: { identity: { acres: 51.11, acreageBasis: 'canonical acreage reconciliation' } },
        landPortalFacts: { acres: 75.91 },
      },
    });
    const acreage = bySubject(conflicts, 'acreage');
    expect(acreage?.resolution).toBe('resolved');
    expect(acreage?.reason).toMatch(/current parcel/i);
    expect(acreage?.reason).toContain('51.11');
  });

  it('resolves to the official GIS record when one exists, and says which rule did it', () => {
    const conflicts = reconcileMaterialFacts({
      propertyIntelligence: {
        snapshot: { identity: { acres: 75.91, acreageBasis: 'assessed' } },
        landPortalFacts: { acres: 75.86 },
        officialParcelGis: { acres: 74.2 },
      },
    });
    const acreage = bySubject(conflicts, 'acreage');
    expect(acreage).toBeTruthy();
    expect(acreage!.resolution).toBe('resolved');
    expect(acreage!.reason).toMatch(/official county GIS/i);
    expect(acreage!.reason).toContain('74.2');
  });

  it('stays unresolved when no source outranks the others', () => {
    const conflicts = reconcileMaterialFacts({
      propertyIntelligence: {
        snapshot: { identity: { acres: 75.91, acreageBasis: 'assessed' } },
        landPortalFacts: { acres: 68 },
      },
    });
    const acreage = bySubject(conflicts, 'acreage');
    expect(acreage?.resolution).toBe('unresolved');
    expect(acreage!.values).toHaveLength(2);
  });
});

describe('access', () => {
  it('does not make later recorded-instrument diligence compete with established screening access', () => {
    const conflicts = reconcileMaterialFacts({
      propertyIntelligence: {
        landPortalFacts: { access: { landLocked: 'No' } },
        access: { established: true, legalAccess: 'Established at acquisition screening', evidence: { verifiedLegalAccess: false, reportedLegalAccess: false } },
      },
    });
    const access = bySubject(conflicts, 'access');
    expect(access).toBeUndefined();
  });

  it('reports no access conflict once legal access is verified', () => {
    const conflicts = reconcileMaterialFacts({
      propertyIntelligence: {
        landPortalFacts: { access: { landLocked: 'No' } },
        access: { legalAccess: 'Yes', evidence: { verifiedLegalAccess: true } },
      },
    });
    expect(bySubject(conflicts, 'access')).toBeUndefined();
  });
});

describe('zoning', () => {
  it('refuses to let a historical or requested district read as the current one', () => {
    const conflicts = reconcileMaterialFacts({
      propertyIntelligence: {
        landUseIntelligence: {
          currentZoning: {
            established: false,
            references: [
              { kindLabel: 'Stated as current at the time', value: 'R - 20 POD', asOf: 'December 10, 2024' },
              { kindLabel: 'Requested', value: 'RS - 15', asOf: 'December 10, 2024' },
            ],
          },
        },
      },
    });
    const zoning = bySubject(conflicts, 'zoning');
    expect(zoning).toBeTruthy();
    expect(zoning!.resolution).toBe('resolved');
    expect(zoning!.reason).toMatch(/never the current district/i);
    expect(zoning!.statement).toContain('R - 20 POD');
    expect(zoning!.decisionAtRisk).toMatch(/by-right|subdivision yield/i);
  });

  it('says nothing once current zoning is established', () => {
    const conflicts = reconcileMaterialFacts({
      propertyIntelligence: {
        landUseIntelligence: {
          currentZoning: { established: true, districtCode: 'RS-15', references: [{ kindLabel: 'Current', value: 'RS-15' }] },
        },
      },
    });
    expect(bySubject(conflicts, 'zoning')).toBeUndefined();
  });
});

describe('jurisdiction, improvements, valuation and identity', () => {
  it('does not manufacture split administration from two labels for the same municipality', () => {
    const conflicts = reconcileMaterialFacts({
      propertyIntelligence: {
        landUseIntelligence: {
          currentZoning: { authorityName: 'City of Fairview official zoning map (Fairview Character Districts - Public)' },
          subdivision: { authorityName: 'Fairview' },
        },
      },
    });
    expect(bySubject(conflicts, 'jurisdiction')).toBeUndefined();
  });

  it('surfaces split zoning/subdivision administration as normal but consequential', () => {
    const conflicts = reconcileMaterialFacts({
      propertyIntelligence: {
        landUseIntelligence: {
          currentZoning: { authorityName: 'Fairview' },
          subdivision: { authorityName: 'Williamson County' },
        },
      },
    });
    const jurisdiction = bySubject(conflicts, 'jurisdiction');
    expect(jurisdiction?.resolution).toBe('resolved');
    expect(jurisdiction!.reason).toMatch(/Both rule sets apply/i);
  });

  it('keeps the LandPortal estimate an indication rather than the working value', () => {
    const conflicts = reconcileMaterialFacts({
      propertyIntelligence: { compsValuation: { summary: { fmv: 400_000 }, lpEstimate: { price: 700_000 } } },
    });
    const valuation = bySubject(conflicts, 'valuation');
    expect(valuation?.resolution).toBe('resolved');
    expect(valuation!.reason).toMatch(/indication only/i);
  });

  it('treats an identity conflict as a hard gate rather than a footnote', () => {
    const conflicts = reconcileMaterialFacts({
      propertyIntelligence: {
        snapshot: { identity: { conflicts: [{ statement: 'The requested APN and the resolved APN differ.' }] } },
        officialParcelGis: { parcelMatch: 'conflict', parcelMatchLabel: 'GIS parcel does not match the subject APN' },
      },
    });
    const identity = conflicts.filter((conflict) => conflict.subject === 'identity');
    expect(identity).toHaveLength(2);
    for (const conflict of identity) expect(conflict.resolution).toBe('unresolved');
  });

  it('reports an improvement disagreement between the parcel record and the valuation scope', () => {
    const conflicts = reconcileMaterialFacts({
      propertyIntelligence: {
        landPortalFacts: { improvement: { improved: true } },
        compsValuation: { subjectImprovement: { improved: false } },
      },
    });
    expect(bySubject(conflicts, 'improvements')?.resolution).toBe('unresolved');
  });
});

describe('an empty or unresearched property file', () => {
  it('produces no conflicts rather than crashing or inventing them', () => {
    expect(reconcileMaterialFacts({})).toEqual([]);
    expect(reconcileMaterialFacts({ propertyIntelligence: null })).toEqual([]);
    expect(reconcileMaterialFacts({ propertyIntelligence: { snapshot: {}, landPortalFacts: {} } })).toEqual([]);
  });
});
