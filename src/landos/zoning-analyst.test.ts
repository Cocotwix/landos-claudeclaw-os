import { describe, expect, it } from 'vitest';

import { analyzeZoning } from './zoning-analyst.js';
import type { NormalizedZoningClaim, ZoningAnalystInput } from './zoning-types.js';

type Claim = NormalizedZoningClaim & { evidenceId: number };

let nextEvidenceId = 1;

function claim(over: Partial<Claim> & Pick<Claim, 'claimKey' | 'domain'>): Claim {
  return {
    evidenceId: nextEvidenceId++,
    exactWording: over.exactWording ?? `${over.claimKey} wording`,
    normalizedValue: null,
    locatorStatus: 'record_located',
    sourceKind: 'official_gis',
    authorityLevel: 'county',
    authorityName: 'Citrus County',
    sourceName: 'Citrus County official GIS',
    sourceUrl: 'https://gis.citrus.example/zoning',
    sourceJurisdiction: 'Citrus County, FL',
    sourceTier: 'official_county_state',
    confidence: 'high',
    retrievedAt: '2026-07-24T12:00:00.000Z',
    ...over,
  };
}

function jurisdictionClaim(determination: 'confirmed' | 'probable' | 'undetermined' = 'confirmed'): Claim {
  return claim({
    claimKey: 'jurisdiction_determination',
    domain: 'jurisdiction_authority',
    sourceKind: 'official_boundary',
    exactWording: 'The parcel is in unincorporated Citrus County per the official boundary layer.',
    normalizedValue: {
      determination,
      incorporationStatus: 'unincorporated_county',
      controllingAuthorityName: 'Citrus County',
      controllingAuthorityLevel: 'county',
      officialBoundaryEvidence: determination !== 'undetermined',
      mailingCityDiffersFromAuthority: false,
      candidateAuthoritiesConsidered: [],
      missingInformation: [],
    },
  });
}

function districtClaim(over: Partial<Claim> = {}): Claim {
  return claim({
    claimKey: 'official_zoning_district_rur',
    domain: 'zoning_district',
    districtCode: 'RUR',
    districtName: 'Rural Residential',
    ...over,
  });
}

function ordinanceClaim(over: Partial<Claim> = {}): Claim {
  return claim({
    claimKey: 'ordinance_document_ldc',
    domain: 'zoning_ordinance',
    sourceKind: 'official_ordinance',
    exactWording: 'Citrus County Land Development Code retrieved from the official source.',
    citation: { ordinanceTitle: 'Citrus County Land Development Code', adoptedOrEffectiveDate: '2025-01-01' },
    ...over,
  });
}

function input(claims: Claim[], over: Partial<ZoningAnalystInput> = {}): ZoningAnalystInput {
  return {
    schemaVersion: 'zoning-normalized-v1',
    artifactSchemaVersion: 'zoning-artifact-v1',
    propertyIdentity: {
      id: 1, version: 1, status: 'confirmed',
      apn: '17E20S36', address: '7868 W Debra Ln', city: 'Homosassa',
      county: 'Citrus', state: 'FL', geometryPresent: true,
    },
    evidenceVersion: { maxEvidenceId: claims.length, evidenceCount: claims.length },
    claims,
    artifacts: [],
    ...over,
  };
}

describe('zoning analyst (pure)', () => {
  it('is deterministic for identical inputs', () => {
    const fixed = input([jurisdictionClaim(), districtClaim(), ordinanceClaim()]);
    expect(JSON.stringify(analyzeZoning(fixed))).toBe(JSON.stringify(analyzeZoning(fixed)));
  });

  it('fabricates nothing from empty evidence', () => {
    const result = analyzeZoning(input([]));
    expect(result.jurisdiction.determination).toBe('undetermined');
    expect(result.baseZoning.status).toBe('undetermined');
    expect(result.baseZoning.districtCode).toBeNull();
    expect(result.usesByRight).toHaveLength(0);
    expect(result.dimensionalStandards).toHaveLength(0);
    expect(result.ordinance.status).toBe('not_identified');
    expect(result.confidence).toBe('low');
  });

  it('5. county and city official sources disagreeing yields a conflicting base district, never a pick', () => {
    const result = analyzeZoning(input([
      jurisdictionClaim(),
      districtClaim(),
      districtClaim({
        claimKey: 'official_zoning_district_r1',
        districtCode: 'R-1',
        districtName: 'City Residential',
        authorityLevel: 'municipality',
        authorityName: 'Crystal River',
        sourceName: 'Crystal River official zoning map',
      }),
    ]));
    expect(result.baseZoning.status).toBe('conflicting');
    expect(result.baseZoning.interpretationAllowed).toBe(false);
    expect(result.materialConflicts.join(' ')).toMatch(/disagree/i);
  });

  it('6. the official zoning map confirms the parcel district when the jurisdiction is confirmed', () => {
    const result = analyzeZoning(input([jurisdictionClaim(), districtClaim(), ordinanceClaim()]));
    expect(result.baseZoning.status).toBe('officially_confirmed');
    expect(result.baseZoning.districtCode).toBe('RUR');
    expect(result.baseZoning.officialMapConfirmed).toBe(true);
    expect(result.baseZoning.interpretationAllowed).toBe(true);
  });

  it('7. a third-party label that differs from the official source is a recorded conflict; the official source controls', () => {
    const result = analyzeZoning(input([
      jurisdictionClaim(),
      districtClaim(),
      districtClaim({
        claimKey: 'third_party_zoning',
        districtCode: 'AG',
        districtName: 'Agricultural (third-party)',
        sourceKind: 'third_party',
        sourceName: 'Marketplace listing data',
        sourceTier: 'marketplace',
      }),
    ]));
    expect(result.baseZoning.districtCode).toBe('RUR');
    expect(result.baseZoning.thirdPartyReportsOnly).toBe(false);
    expect(result.materialConflicts.join(' ')).toMatch(/third-party source reports district AG.*official source reports RUR/i);
  });

  it('a third-party label alone is never official confirmation', () => {
    const result = analyzeZoning(input([
      jurisdictionClaim(),
      districtClaim({ sourceKind: 'third_party', sourceName: 'Listing site', sourceTier: 'marketplace' }),
    ]));
    expect(result.baseZoning.status).toBe('reported_unverified');
    expect(result.baseZoning.thirdPartyReportsOnly).toBe(true);
    expect(result.baseZoning.interpretationAllowed).toBe(false);
    expect(result.missingInformation.join(' ')).toMatch(/official corroboration/i);
  });

  it('8. base district plus an overlay district are both reported with their sources', () => {
    const result = analyzeZoning(input([
      jurisdictionClaim(),
      districtClaim(),
      claim({
        claimKey: 'official_overlay_airport',
        domain: 'zoning_district',
        overlayName: 'Airport Hazard Overlay',
        normalizedValue: { overlayKind: 'airport overlay' },
      }),
      ordinanceClaim(),
    ]));
    expect(result.baseZoning.districtCode).toBe('RUR');
    expect(result.overlays).toHaveLength(1);
    expect(result.overlays[0].name).toBe('Airport Hazard Overlay');
    expect(result.overlays[0].officiallyConfirmed).toBe(true);
    expect(result.risks.join(' ')).toMatch(/airport/i);
  });

  it('9/10. by-right uses carry exact citations and conditional uses stay strictly separated', () => {
    const result = analyzeZoning(input([
      jurisdictionClaim(),
      districtClaim(),
      ordinanceClaim(),
      claim({
        claimKey: 'use_single_family',
        domain: 'permitted_uses',
        sourceKind: 'official_ordinance',
        useName: 'Single-family dwelling',
        useCategory: 'permitted_by_right',
        citation: { ordinanceTitle: 'Citrus County LDC', section: 'Sec. 2100', table: 'Table 2-1' },
      }),
      claim({
        claimKey: 'use_kennel',
        domain: 'permitted_uses',
        sourceKind: 'official_ordinance',
        useName: 'Commercial kennel',
        useCategory: 'conditional_or_special',
        citation: { ordinanceTitle: 'Citrus County LDC', section: 'Sec. 2101' },
      }),
      claim({
        claimKey: 'use_heavy_industry',
        domain: 'permitted_uses',
        sourceKind: 'official_ordinance',
        useName: 'Heavy industry',
        useCategory: 'prohibited',
        citation: { ordinanceTitle: 'Citrus County LDC', section: 'Sec. 2102' },
      }),
    ]));
    expect(result.usesByRight.map((use) => use.useName)).toEqual(['Single-family dwelling']);
    expect(result.usesByRight[0].citation?.section).toBe('Sec. 2100');
    expect(result.conditionalOrSpecialUses.map((use) => use.useName)).toEqual(['Commercial kennel']);
    expect(result.prohibitedUses.map((use) => use.useName)).toEqual(['Heavy industry']);
    // Strict separation: a conditional use never appears in the by-right list.
    expect(result.usesByRight.some((use) => use.category !== 'permitted_by_right')).toBe(false);
    expect(result.conditionalOrSpecialUses.some((use) => use.category !== 'conditional_or_special')).toBe(false);
  });

  it('11. dimensional standards come only from the confirmed district table', () => {
    const result = analyzeZoning(input([
      jurisdictionClaim(),
      districtClaim(),
      ordinanceClaim(),
      claim({
        claimKey: 'std_min_lot',
        domain: 'dimensional_standards',
        sourceKind: 'official_ordinance',
        standardName: 'Minimum lot size',
        exactWording: '1 acre',
        districtCode: 'RUR',
        citation: { ordinanceTitle: 'Citrus County LDC', table: 'Table 2-3' },
      }),
      claim({
        claimKey: 'std_wrong_district',
        domain: 'dimensional_standards',
        sourceKind: 'official_ordinance',
        standardName: 'Minimum lot size',
        exactWording: '10,000 sq ft',
        districtCode: 'R-1',
      }),
    ]));
    expect(result.dimensionalStandards).toHaveLength(1);
    expect(result.dimensionalStandards[0].value).toBe('1 acre');
    expect(result.dimensionalStandards[0].districtCode).toBe('RUR');
    expect(result.materialConflicts.join(' ')).toMatch(/wrong district table/i);
    expect(result.subdivisionAndDevelopmentImplications.join(' ')).toMatch(/Minimum lot size 1 acre/);
  });

  it('12. a district label without a retrievable ordinance blocks interpretation and reports what is missing', () => {
    const result = analyzeZoning(input([
      jurisdictionClaim(),
      districtClaim(),
      claim({
        claimKey: 'ordinance_document_ldc',
        domain: 'zoning_ordinance',
        sourceKind: 'official_ordinance',
        locatorStatus: 'official_source_unavailable',
        citation: { ordinanceTitle: 'Citrus County Land Development Code' },
      }),
      claim({
        claimKey: 'use_single_family',
        domain: 'permitted_uses',
        sourceKind: 'official_ordinance',
        locatorStatus: 'official_source_unavailable',
        useName: 'Single-family dwelling',
        useCategory: 'permitted_by_right',
      }),
    ]));
    expect(result.baseZoning.status).toBe('officially_confirmed');
    expect(result.ordinance.status).toBe('identified_not_retrieved');
    expect(result.baseZoning.interpretationAllowed).toBe(false);
    expect(result.usesByRight).toHaveLength(0);
    expect(result.uncertainUses).toHaveLength(1);
    expect(result.missingInformation.join(' ')).toMatch(/governing zoning ordinance/i);
    expect(result.confidence).toBe('medium');
  });

  it('13/14. registration-required, blocked, and unavailable sources surface as honest limitations', () => {
    const result = analyzeZoning(input([
      jurisdictionClaim(),
      claim({
        claimKey: 'district_lookup',
        domain: 'zoning_district',
        locatorStatus: 'official_source_registration_required',
        sourceName: 'City zoning portal',
      }),
      claim({
        claimKey: 'ordinance_lookup',
        domain: 'zoning_ordinance',
        locatorStatus: 'official_source_blocked',
        sourceName: 'County ordinance library',
      }),
      claim({
        claimKey: 'uses_lookup',
        domain: 'permitted_uses',
        locatorStatus: 'official_source_unavailable',
        sourceName: 'Planning department page',
      }),
    ]));
    expect(result.limitations.join(' ')).toMatch(/City zoning portal required free registration/);
    expect(result.limitations.join(' ')).toMatch(/County ordinance library blocked automated access/);
    expect(result.limitations.join(' ')).toMatch(/Planning department page was unavailable/);
  });

  it('withholds use interpretation entirely while the jurisdiction is unconfirmed', () => {
    const result = analyzeZoning(input([
      jurisdictionClaim('undetermined'),
      districtClaim(),
      ordinanceClaim(),
      claim({
        claimKey: 'use_single_family',
        domain: 'permitted_uses',
        sourceKind: 'official_ordinance',
        useName: 'Single-family dwelling',
        useCategory: 'permitted_by_right',
      }),
    ]));
    expect(result.baseZoning.status).toBe('reported_unverified');
    expect(result.baseZoning.interpretationAllowed).toBe(false);
    expect(result.usesByRight).toHaveLength(0);
    expect(result.uncertainUses).toHaveLength(1);
    expect(result.likelyUsePathsSupportedByZoning).toHaveLength(0);
  });

  it('flags manual-review and dispute-group claims as risks and conflicts', () => {
    const result = analyzeZoning(input([
      jurisdictionClaim(),
      districtClaim({ needsManualReview: true, exactWording: 'Split-zoned parcel needs planner confirmation.' }),
      districtClaim({ claimKey: 'd2', disputeGroup: 'district_conflict_1' }),
    ]));
    expect(result.risks.join(' ')).toMatch(/Manual review needed/);
    expect(result.materialConflicts.join(' ')).toMatch(/district_conflict_1/);
  });

  it('references every claim in evidenceReferences with its source', () => {
    const claims = [jurisdictionClaim(), districtClaim(), ordinanceClaim()];
    const result = analyzeZoning(input(claims));
    expect(result.evidenceReferences).toHaveLength(claims.length);
    expect(new Set(result.evidenceReferences.map((ref) => ref.evidenceId)))
      .toEqual(new Set(claims.map((c) => c.evidenceId)));
  });

  it('reaches high confidence only with confirmed jurisdiction, official district, retrieved ordinance, and by-right uses', () => {
    const full = analyzeZoning(input([
      jurisdictionClaim(),
      districtClaim(),
      ordinanceClaim(),
      claim({
        claimKey: 'use_single_family',
        domain: 'permitted_uses',
        sourceKind: 'official_ordinance',
        useName: 'Single-family dwelling',
        useCategory: 'permitted_by_right',
        citation: { ordinanceTitle: 'LDC', section: 'Sec. 2100' },
      }),
    ]));
    expect(full.confidence).toBe('high');
    expect(full.likelyUsePathsSupportedByZoning.join(' ')).toMatch(/Single-family dwelling/);
    const partial = analyzeZoning(input([jurisdictionClaim(), districtClaim()]));
    expect(partial.confidence).toBe('medium');
  });
});
