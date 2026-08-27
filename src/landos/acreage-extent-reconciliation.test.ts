// Focused tests — official acreage & parcel-extent reconciliation.
//
// The demonstrated defect class: one property carrying several conflicting
// acreage figures (current official record 51.11 ac, county GIS attribute
// 75.91 ac on a stale layer vintage, historical planning ~75.86 ac, provider
// 75.91 ac) with no rule for which figure describes the CURRENT tax parcel.

import { describe, expect, it, vi } from 'vitest';

import {
  ACREAGE_DEPENDENT_PRODUCTS,
  explainParentExtent,
  reconcileAcreageExtent,
  type AcreageExtentInput,
  type SiblingParcelRecord,
} from './acreage-extent-reconciliation.js';
import { runOfficialAcreageExtentReconciliation, type OfficialAcreageRunDeps } from './official-acreage-run.js';
import type { ResolverSubject } from './universal-property-resolution.js';

const OFFICIAL = {
  acres: 51.11,
  owner: 'LANDSOUTH LLC',
  officialParcelId: '042 12300 000',
  identityMatchesSubject: true,
  source: 'Williamson County Property Assessment Database (inigo.williamson-tn.org)',
  sourceUrl: 'https://inigo.williamson-tn.org/property_search/',
  retrievedAt: '2026-08-21T21:05:51.799Z',
  lastTransferDate: '2024-03-08',
  deedBookPage: '9433/325',
};

const GIS_STALE = {
  reportedAcres: 75.91,
  calculatedAcres: 76.319,
  owner: 'BERG WILLIAM HENRY',
  gisParcelId: '042    12300',
  source: 'Williamson County GIS parcel layer',
  sourceUrl: 'https://arcgis2.williamsoncounty-tn.gov/arcgis/rest/services/IDT/DataPull/MapServer/4',
  retrievedAt: '2026-08-21T22:00:00.000Z',
  featureCount: 1,
};

const SPLIT_SIBLING: SiblingParcelRecord = {
  officialParcelId: '042 12312 000',
  owner: 'BERG JULIE',
  legalAcres: 24.8,
  lastTransferDate: '2025-06-23',
  deedBookPage: '9762/355',
  situsAddress: 'KINGWOOD BLVD',
};

const baseInput = (overrides: Partial<AcreageExtentInput> = {}): AcreageExtentInput => ({
  subjectApn: '042-123.00-000',
  official: OFFICIAL,
  gis: GIS_STALE,
  siblings: [SPLIT_SIBLING],
  provider: { acres: 75.91, source: 'LandPortal parcel record', sourceUrl: 'https://landportal.com/x', retrievedAt: null },
  providerCalculated: { acres: 50.69, source: 'LandPortal geometry calculation', note: 'Provider polygon area.' },
  historical: [{ acres: 75.86, source: 'Historical Kingwood planning record', note: 'Planning-document project acreage.' }],
  priorCanonicalAcres: 75.91,
  ...overrides,
});

describe('reconcileAcreageExtent', () => {
  it('keeps every source value separately provenanced and never deletes conflicting evidence', () => {
    const decision = reconcileAcreageExtent(baseInput());
    const byType = Object.fromEntries(decision.retained.map((r) => [r.valueType, r]));
    expect(byType.official_reported?.valueAcres).toBe(51.11);
    expect(byType.official_reported?.sourceClass).toBe('official_record');
    expect(byType.gis_reported?.valueAcres).toBe(75.91);
    expect(byType.gis_calculated?.valueAcres).toBe(76.319);
    expect(byType.historical_project?.valueAcres).toBe(75.86);
    expect(byType.provider_reported?.valueAcres).toBe(75.91);
    expect(byType.provider_calculated?.valueAcres).toBe(50.69);
    // Distinct classes carry distinct provenance labels.
    expect(byType.gis_reported?.sourceClass).toBe('gis_observation');
    expect(byType.historical_project?.sourceClass).toBe('historical_record');
    expect(byType.provider_reported?.sourceClass).toBe('provider_claim');
  });

  it('never averages: the canonical figure is exactly one input value', () => {
    const decision = reconcileAcreageExtent(baseInput());
    const inputValues = [51.11, 75.91, 76.319, 75.86, 50.69];
    expect(inputValues).toContain(decision.canonicalAcres);
    expect(decision.canonicalAcres).toBe(51.11);
  });

  it('lets the identity-matched current official record outrank provider acreage', () => {
    const decision = reconcileAcreageExtent(baseInput());
    expect(decision.canonicalAcres).toBe(51.11);
    expect(decision.canonicalValueType).toBe('official_reported');
    expect(decision.confidence).toBe('confirmed');
  });

  it('never silently promotes historical project acreage to current parcel acreage', () => {
    const decision = reconcileAcreageExtent(baseInput({ official: null, provider: null, gis: null, siblings: [] }));
    expect(decision.canonicalAcres).toBeNull();
    expect(decision.status).toBe('unresolved');
    expect(decision.retained.find((r) => r.valueType === 'historical_project')?.valueAcres).toBe(75.86);
  });

  it('refuses adoption when the official parcel identity does not match the exact APN', () => {
    const decision = reconcileAcreageExtent(baseInput({
      official: { ...OFFICIAL, officialParcelId: '042 12312 000', identityMatchesSubject: false },
    }));
    expect(decision.canonicalAcres).toBeNull();
    expect(decision.status).toBe('unresolved');
    expect(decision.reasoning.some((line) => line.classification === 'CONFLICT' && /does not match the canonical APN/.test(line.statement))).toBe(true);
  });

  it('explains the historical extent through split-sibling arithmetic (51.11 + 24.80 = 75.91)', () => {
    const decision = reconcileAcreageExtent(baseInput());
    expect(decision.status).toBe('resolved_current_vs_historical_extent');
    expect(decision.extentSiblings.map((s) => s.officialParcelId)).toEqual(['042 12312 000']);
    expect(decision.extentExplanation).toMatch(/51.11 \+ 24.8 = 75.91/);
    expect(decision.extentExplanation).toMatch(/pre-split/i);
  });

  it('keeps GIS calculated area and reported acreage as distinct retained concepts', () => {
    const decision = reconcileAcreageExtent(baseInput());
    const types = decision.retained.map((r) => r.valueType);
    expect(types).toContain('gis_reported');
    expect(types).toContain('gis_calculated');
    const calc = decision.retained.find((r) => r.valueType === 'gis_calculated');
    expect(calc?.valueAcres).not.toBe(decision.retained.find((r) => r.valueType === 'gis_reported')?.valueAcres);
  });

  it('marks a stale GIS vintage when the layer owner disagrees with the owner of record', () => {
    const decision = reconcileAcreageExtent(baseInput());
    expect(decision.retained.find((r) => r.valueType === 'gis_reported')?.vintage).toBe('stale');
    const fresh = reconcileAcreageExtent(baseInput({ gis: { ...GIS_STALE, owner: 'LANDSOUTH LLC', reportedAcres: 51.11, calculatedAcres: 51.4 } }));
    expect(fresh.retained.find((r) => r.valueType === 'gis_reported')?.vintage).not.toBe('stale');
  });

  it('changes the canonical acreage when stronger current official evidence establishes it, and stales acreage-dependent products', () => {
    const decision = reconcileAcreageExtent(baseInput());
    expect(decision.canonicalChanged).toBe(true);
    expect(decision.staleProducts).toEqual([...ACREAGE_DEPENDENT_PRODUCTS]);
    expect(decision.staleProducts).toContain('valuation');
    expect(decision.staleProducts).toContain('buildable_metrics');
  });

  it('marks nothing stale when the official figure confirms the carried canonical', () => {
    const decision = reconcileAcreageExtent(baseInput({
      priorCanonicalAcres: 51.11,
      provider: null,
      gis: null,
      historical: [],
      providerCalculated: null,
    }));
    expect(decision.status).toBe('resolved_current_canonical');
    expect(decision.canonicalChanged).toBe(false);
    expect(decision.staleProducts).toEqual([]);
  });

  it('leaves the discrepancy explicitly unresolved when no sibling arithmetic closes it', () => {
    const decision = reconcileAcreageExtent(baseInput({ siblings: [] }));
    expect(decision.status).toBe('partially_resolved');
    // The CURRENT acreage is still confirmed even when history is unexplained.
    expect(decision.canonicalAcres).toBe(51.11);
    expect(decision.unresolvedQuestions.some((q) => /unexplained/.test(q))).toBe(true);
    expect(decision.extentExplanation).toBeNull();
  });

  it('sibling evidence prevents a false single-parcel conclusion in the extent statement', () => {
    const decision = reconcileAcreageExtent(baseInput());
    expect(decision.parcelExtent).toMatch(/042 12312 000 \(24.8 ac\)/);
    expect(decision.parcelExtent).toMatch(/separately assessed/);
  });
});

describe('explainParentExtent', () => {
  it('closes with one sibling, a pair, or not at all — deterministically', () => {
    const s1 = { ...SPLIT_SIBLING };
    const s2: SiblingParcelRecord = { ...SPLIT_SIBLING, officialParcelId: '042 12310 000', legalAcres: 17 };
    expect(explainParentExtent(75.91, 51.11, [s1, s2], 0.15)?.map((s) => s.officialParcelId)).toEqual(['042 12312 000']);
    expect(explainParentExtent(92.91, 51.11, [s1, s2], 0.15)?.map((s) => s.officialParcelId)).toEqual(['042 12310 000', '042 12312 000']);
    expect(explainParentExtent(99, 51.11, [s1, s2], 0.15)).toBeNull();
    expect(explainParentExtent(51.2, 51.11, [s1, s2], 0.15)).toEqual([]);
  });
});

// ── The bounded run: scoping, boundedness, refusal ─────────────────────────

const SUBJECT: ResolverSubject = {
  dealCardId: 89,
  propertyCardId: 79,
  entity: 'TY_LAND_BIZ',
  address: '0 Kingwood Blvd',
  city: 'Fairview',
  county: 'Williamson',
  state: 'TN',
  zip: '37062',
  apn: '042-123.00-000',
  owner: 'LANDSOUTH LLC',
  acres: 75.91,
  fips: '47187',
  lpPropertyId: '154591092',
  lpUrl: null,
  lat: 35.976,
  lng: -87.118,
  verified: true,
  verificationSource: 'test',
  notations: [],
  rawIntake: null,
};

const ASSESSOR_RESULT = {
  facts: {
    recordStatus: 'official_record_retrieved',
    assessor: { ownerOfRecord: 'LANDSOUTH LLC', apn: '042 12300 000', assessedAcres: 51.11, situsAddress: 'KINGWOOD BLVD' },
    transfer: { lastSaleDate: '2024-03-08', deedBookPage: '9433/325' },
    records: [{ field: 'APN', source: 'Williamson County Property Assessment Database (inigo.williamson-tn.org)', sourceUrl: 'https://inigo.williamson-tn.org/property_search/', retrievedAt: '2026-08-21T21:05:51.799Z' }],
  },
};

const makeDeps = (overrides: Partial<OfficialAcreageRunDeps> = {}): OfficialAcreageRunDeps & {
  queryGis: ReturnType<typeof vi.fn>;
  searchFamily: ReturnType<typeof vi.fn>;
  persist: ReturnType<typeof vi.fn>;
} => {
  const deps = {
    subject: vi.fn((dealCardId: number) => (dealCardId === 89 ? SUBJECT : null)),
    latestCapabilityResult: vi.fn((propertyCardId: number, dealCardId: number, capabilityId: string) =>
      propertyCardId === 79 && dealCardId === 89 && capabilityId === 'assessor-tax' ? ASSESSOR_RESULT : null),
    queryGis: vi.fn(async () => GIS_STALE),
    searchFamily: vi.fn(async () => ({ status: 'ok', note: '1 sibling', siblings: [SPLIT_SIBLING], detailReads: 1, sourceUrl: 'https://inigo.williamson-tn.org/property_search/' })),
    historicalAcreage: vi.fn(() => [{ acres: 75.86, source: 'Retained subject-identity history (version 2)', note: 'historical' }]),
    providerAcreage: vi.fn(() => ({
      provider: { acres: 75.91, source: 'LandPortal parcel record', sourceUrl: 'https://landportal.com/x', retrievedAt: null },
      providerCalc: { acres: 50.69, note: 'Provider polygon area.' },
    })),
    persist: vi.fn((record: unknown) => record),
    ...overrides,
  };
  return deps as never;
};

describe('runOfficialAcreageExtentReconciliation', () => {
  it('performs at most one GIS query and one family search, then persists once', async () => {
    const deps = makeDeps();
    const record = await runOfficialAcreageExtentReconciliation(89, deps);
    expect(deps.queryGis).toHaveBeenCalledTimes(1);
    expect(deps.searchFamily).toHaveBeenCalledTimes(1);
    expect(deps.persist).toHaveBeenCalledTimes(1);
    expect(record.refusalReason).toBeNull();
    expect(record.decision.canonicalAcres).toBe(51.11);
    expect(record.actions.map((a) => a.action)).toEqual([
      'reuse_assessor_record', 'county_gis_parcel_query', 'assessor_parcel_family_search',
    ]);
  });

  it('is deal-scoped: another deal cannot borrow deal 89 acreage evidence', async () => {
    const deps = makeDeps();
    const record = await runOfficialAcreageExtentReconciliation(77, deps);
    expect(record.refusalReason).toMatch(/canonical subject/);
    expect(deps.queryGis).not.toHaveBeenCalled();
    expect(deps.searchFamily).not.toHaveBeenCalled();
    // The evidence lookup is keyed strictly by the deal's own subject card.
    const record89 = await runOfficialAcreageExtentReconciliation(89, deps);
    expect(deps.latestCapabilityResult).toHaveBeenCalledWith(79, 89, 'assessor-tax');
    expect(record89.dealCardId).toBe(89);
  });

  it('refuses without a retained official assessor record instead of launching one', async () => {
    const deps = makeDeps({ latestCapabilityResult: vi.fn(() => null) });
    const record = await runOfficialAcreageExtentReconciliation(89, deps);
    expect(record.refusalReason).toMatch(/never launches one/);
    expect(deps.queryGis).not.toHaveBeenCalled();
  });

  it('still resolves when the GIS query and family search are unavailable', async () => {
    const deps = makeDeps({
      queryGis: vi.fn(async () => { throw new Error('gis down'); }),
      searchFamily: vi.fn(async () => { throw new Error('search down'); }),
    });
    const record = await runOfficialAcreageExtentReconciliation(89, deps);
    expect(record.refusalReason).toBeNull();
    expect(record.decision.canonicalAcres).toBe(51.11);
    // Honest partial resolution: the larger provider figure stays unexplained.
    expect(record.decision.status).toBe('partially_resolved');
    expect(record.actions.find((a) => a.action === 'county_gis_parcel_query')?.outcome).toMatch(/Unavailable/);
  });
});
