import { describe, expect, it } from 'vitest';

import {
  buildJurisdictionClaims,
  determineJurisdiction,
  type BoundaryFinding,
} from './zoning-jurisdiction.js';

const PLACES_LAYER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4';

function outsidePlaces(): BoundaryFinding {
  return {
    kind: 'incorporated_place',
    unitName: null,
    containsParcel: 'outside',
    queried: true,
    sourceKind: 'official_boundary',
    sourceName: 'US Census TIGERweb Incorporated Places (current)',
    sourceUrl: PLACES_LAYER,
    exactWording: 'The official layer returned no incorporated place feature containing the parcel geometry.',
  };
}

function insidePlace(name: string): BoundaryFinding {
  return {
    kind: 'incorporated_place',
    unitName: name,
    containsParcel: 'inside',
    queried: true,
    sourceKind: 'official_boundary',
    sourceName: 'US Census TIGERweb Incorporated Places (current)',
    sourceUrl: PLACES_LAYER,
    exactWording: `The parcel geometry intersects the official boundary of ${name}.`,
    functionalStatus: 'A',
  };
}

const baseParcel = { county: 'Roane', state: 'TN', mailingCity: 'KINGSTON', geometryPresent: true };

describe('jurisdiction determination (official boundary evidence only)', () => {
  it('1. confirmed parcel in an unincorporated county jurisdiction', () => {
    const result = determineJurisdiction({
      parcel: baseParcel,
      findings: [outsidePlaces()],
      authorityConfigs: [{ authorityName: 'Roane County', level: 'county', administersZoning: 'yes' }],
    });
    expect(result.incorporationStatus).toBe('unincorporated_county');
    expect(result.controllingAuthorityName).toBe('Roane County');
    expect(result.controllingAuthorityLevel).toBe('county');
    expect(result.determination).toBe('confirmed');
    expect(result.officialBoundaryEvidence).toBe(true);
  });

  it('2. confirmed parcel inside an incorporated municipality', () => {
    const result = determineJurisdiction({
      parcel: { ...baseParcel, mailingCity: 'Kingston' },
      findings: [insidePlace('Kingston')],
      authorityConfigs: [{ authorityName: 'Kingston', level: 'municipality', administersZoning: 'yes' }],
    });
    expect(result.incorporationStatus).toBe('incorporated_municipality');
    expect(result.controllingAuthorityName).toBe('Kingston');
    expect(result.controllingAuthorityLevel).toBe('municipality');
    expect(result.determination).toBe('confirmed');
    expect(result.mailingCityDiffersFromAuthority).toBe(false);
  });

  it('3. township-controlled zoning replaces the county default only with configured township authority', () => {
    const township: BoundaryFinding = {
      kind: 'county_subdivision',
      unitName: 'Bloomfield Township',
      containsParcel: 'inside',
      queried: true,
      sourceKind: 'official_boundary',
      sourceName: 'US Census TIGERweb County Subdivisions (current)',
      sourceUrl: PLACES_LAYER,
      exactWording: 'The parcel geometry intersects the official boundary of Bloomfield Township.',
      functionalStatus: 'A',
    };
    const configured = determineJurisdiction({
      parcel: { county: 'Oakland', state: 'MI', mailingCity: 'Bloomfield Hills', geometryPresent: true },
      findings: [outsidePlaces(), township],
      authorityConfigs: [{ authorityName: 'Bloomfield Township', level: 'township', administersZoning: 'yes' }],
    });
    expect(configured.incorporationStatus).toBe('township_jurisdiction');
    expect(configured.controllingAuthorityName).toBe('Bloomfield Township');
    expect(configured.controllingAuthorityLevel).toBe('township');

    const unconfigured = determineJurisdiction({
      parcel: { county: 'Oakland', state: 'MI', mailingCity: 'Bloomfield Hills', geometryPresent: true },
      findings: [outsidePlaces(), township],
      authorityConfigs: [],
    });
    expect(unconfigured.incorporationStatus).toBe('unincorporated_county');
    expect(unconfigured.determination).toBe('probable');
    expect(unconfigured.missingInformation.join(' ')).toMatch(/Bloomfield Township/);
  });

  it('4. mailing city differing from the actual authority is flagged but never used for the determination', () => {
    const result = determineJurisdiction({
      parcel: baseParcel, // mailing city KINGSTON
      findings: [outsidePlaces()],
      authorityConfigs: [{ authorityName: 'Roane County', level: 'county', administersZoning: 'yes' }],
    });
    expect(result.controllingAuthorityName).toBe('Roane County');
    expect(result.mailingCityDiffersFromAuthority).toBe(true);
    expect(result.basis).toMatch(/mailing city "KINGSTON" differs/i);
    expect(result.basis).toMatch(/was not used in this determination/i);
  });

  it('never infers a jurisdiction when no official boundary source could be queried', () => {
    const result = determineJurisdiction({
      parcel: baseParcel,
      findings: [{
        ...outsidePlaces(),
        containsParcel: 'unknown',
        queried: false,
        exactWording: 'The boundary layer could not be queried.',
      }],
    });
    expect(result.determination).toBe('undetermined');
    expect(result.incorporationStatus).toBe('undetermined');
    expect(result.controllingAuthorityName).toBeNull();
    expect(result.officialBoundaryEvidence).toBe(false);
    expect(result.basis).toMatch(/undetermined rather than inferred from the address label/i);
  });

  it('requires parcel geometry before determining anything', () => {
    const result = determineJurisdiction({
      parcel: { ...baseParcel, geometryPresent: false },
      findings: [outsidePlaces()],
    });
    expect(result.determination).toBe('undetermined');
    expect(result.missingInformation.join(' ')).toMatch(/geometry/i);
  });

  it('routes a non-zoning municipality back to the county program', () => {
    const result = determineJurisdiction({
      parcel: { ...baseParcel, mailingCity: 'Tinyville' },
      findings: [insidePlace('Tinyville')],
      authorityConfigs: [
        { authorityName: 'Tinyville', level: 'municipality', administersZoning: 'no', note: 'no municipal zoning ordinance adopted' },
        { authorityName: 'Roane County', level: 'county', administersZoning: 'yes' },
      ],
    });
    expect(result.incorporationStatus).toBe('incorporated_municipality');
    expect(result.controllingAuthorityName).toBe('Roane County');
    expect(result.controllingAuthorityLevel).toBe('county');
  });

  it('recognizes official extraterritorial jurisdiction evidence', () => {
    const etj: BoundaryFinding = {
      kind: 'extraterritorial_jurisdiction',
      unitName: 'Cary',
      containsParcel: 'inside',
      queried: true,
      sourceKind: 'official_boundary',
      sourceName: 'Town of Cary official ETJ layer',
      sourceUrl: 'https://maps.example.gov/etj',
      exactWording: 'The parcel lies inside the official Cary ETJ boundary.',
    };
    const result = determineJurisdiction({
      parcel: { county: 'Wake', state: 'NC', mailingCity: 'Apex', geometryPresent: true },
      findings: [outsidePlaces(), etj],
      authorityConfigs: [{ authorityName: 'Cary', level: 'municipality', administersZoning: 'yes' }],
    });
    expect(result.incorporationStatus).toBe('extraterritorial_jurisdiction');
    expect(result.controllingAuthorityName).toBe('Cary');
  });

  it('emits auditable claims with the official source URLs and the determination payload', () => {
    const findings = [outsidePlaces()];
    const determination = determineJurisdiction({
      parcel: baseParcel,
      findings,
      authorityConfigs: [{ authorityName: 'Roane County', level: 'county', administersZoning: 'yes' }],
    });
    const claims = buildJurisdictionClaims({
      determination,
      findings,
      sourceJurisdiction: 'Roane County, TN',
      retrievedAt: '2026-07-24T12:00:00.000Z',
    });
    expect(claims.length).toBe(2);
    expect(claims[0].sourceUrl).toBe(PLACES_LAYER);
    expect(claims[0].domain).toBe('jurisdiction_authority');
    const det = claims.find((claim) => claim.claimKey === 'jurisdiction_determination')!;
    expect((det.normalizedValue as Record<string, unknown>).incorporationStatus).toBe('unincorporated_county');
    expect(det.sourceKind).toBe('official_boundary');
  });
});
