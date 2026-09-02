// Stage 5 ENGINE BEHAVIOUR: the Development Path over the local jurisdiction's
// own rules.
//
//   BY-RIGHT LOT     a small lot in an established residential district:
//                    as-is applies, no division path applies, the decisive
//                    verification is the last permit gate.
//   MINOR SPLIT      acreage yields two lots under the local minimum: the
//                    local lot-split definition, threshold, materials and
//                    review body are the path, and cost appears only from the
//                    regulation's own fee.
//   MAJOR / ENTITLE  acreage above the local minor threshold: the major
//                    definition, hearings, engineering, bonding trigger.
//   MUNICIPAL vs     a municipal record keyed to the mailing city against
//   UNINCORPORATED   subject-specific official boundary geometry: the postal
//                    claim is dismissed (visibly), the boundary governs, and a
//                    conflict is raised only when two SUBJECT-SPECIFIC sources
//                    genuinely disagree.
//   MISSING SOURCE   nothing retained: every path is NOT ESTABLISHED, nothing
//                    nationwide is assumed, and the decisive action is to
//                    obtain the jurisdiction's own regulation.

import { describe, expect, it } from 'vitest';

import { buildAcquisitionDossier, type PropertyFileSource } from './acquisition-intelligence-dossier.js';
import type { CanonicalSubjectState } from './canonical-subject-state.js';
import { QUICK_FLIP } from './comps-valuation.js';
import type { ControllingLandUseAuthority } from './controlling-land-use-authority.js';
import type { CurrentZoningDetermination } from './current-zoning-determination.js';
import { AS_IS_COST_ASSUMPTIONS } from './deal-decision-synthesis.js';
import type { PropertyEvidenceSynthesis } from './property-evidence-synthesis.js';
import type { PropertySubdivisionRead } from './subdivision-property-read.js';
import type { SubdivisionRegulations, SubdivisionRule, SubdivisionRuleKey } from './subdivision-regulations.js';
import { buildZoningDevelopmentIntelligence, type ZoningDevelopmentInput } from './zoning-development-intelligence.js';
import type { ZoningStandardsResult } from './zoning-standards-research.js';
import type { ZoningAnalysis } from './zoning-types.js';

const now = () => new Date('2026-09-01T00:00:00.000Z');

// ── Fixtures ───────────────────────────────────────────────────────────────

function file(acres: number, frontageFt = 157.4): PropertyFileSource {
  return {
    dealCardId: 115, propertyCardId: 401, now,
    canonicalIdentity: { status: 'confirmed', confirmed: true },
    propertyIntelligence: {
      snapshot: { identity: { state: 'confirmed', displayAddress: '19554 NW 137th Ln', apn: '00083A03400', county: 'Bradford', city: 'Lake Butler', state_: 'FL', owner: 'HILL EUGENE W', acres, acreageBasis: 'operator_accepted', hasParcelGeometry: true } },
      landPortalFacts: { acres, environment: { femaFloodZone: 'X', wetlandsPct: '50.14%' }, access: { landLocked: 'No', roadFrontageFt: frontageFt } },
      access: { established: true, frontageFt, road: 'NW 137th Lane', evidence: { rungs: [], outstanding: [] } },
      compsValuation: { summary: { statusLabel: 'Not priceable', acceptedCount: 0 }, counts: {} },
    },
    dealCard: { people: [], asking_price: null },
    visuals: [],
  };
}

const subject = (acres: number): CanonicalSubjectState => ({
  dealCardId: 115, propertyCardId: 401, subjectResolved: true, officiallyVerified: true,
  officialVerificationSource: 'Florida DEP statewide property-appraiser parcel layer', status: 'confirmed', source: 'identity_version',
  apn: '00083A03400', apnNormalized: '00083a03400', address: '19554 NW 137th Ln', city: 'Lake Butler', county: 'Bradford', state: 'FL', fips: '12007', zip: '32054',
  subjectVersion: 'iv:137:v2#ac:1.5:operator_accepted', subjectVersionId: 137,
  governingAcreage: { value: acres, kind: 'operator_accepted', source: 'Operator-accepted governing acreage' },
} as unknown as CanonicalSubjectState);

function story(options: { access?: boolean; septic?: boolean; acres: number }): PropertyEvidenceSynthesis {
  const topic = (key: string, label: string, established: boolean, headline: string) => ({
    key, label, status: established ? 'established' : 'partial', headline, claims: [], gap: established ? null : `${label} is not established.`, verificationNeeded: established ? [] : [`Verify ${label.toLowerCase()}.`],
  });
  return {
    contractVersion: '1.0.0', dealCardId: 115, generatedAt: null, inputFingerprint: 'fp-story',
    subject: { apn: '00083A03400', acres: options.acres, acreageBasis: 'Operator-accepted', subjectVersion: 'iv:137:v2#ac:1.5:operator_accepted', county: 'Bradford', state: 'FL', city: 'Lake Butler', address: '19554 NW 137th Ln', zip: '32054', fips: '12007', owner: null, apnDisplayVariants: [], interest: { form: 'whole_parcel', statement: 'Whole parcel.' }, verification: { researchGrade: true, officiallyVerified: true, officialSource: 'FL DEP', statement: '' } },
    relatedBoundaries: [], recordFacts: [],
    diligence: [
      topic('access', 'Access', !!options.access, options.access ? 'Recorded 30 ft easement, OR Book 412 Page 88.' : 'Mapped frontage on NW 137th Lane; no recorded instrument.'),
      topic('well_septic', 'Well and septic', !!options.septic, options.septic ? 'Septic site evaluation on file: suitable.' : 'No septic evaluation is retained.'),
      topic('zoning', 'Zoning and land use', false, 'Zoning is read from the land-use products.'),
    ],
    visualReview: [], separation: { counts: {}, officialLegalFactIds: [], visualObservationIds: [], analyticalHypothesisIds: [], verificationNeedIds: [] },
    story: { headline: '', strengths: [], risks: [], opportunities: [], economicsDrivers: [] }, conflicts: [], duplicatesCollapsed: 0, limitations: [],
    guardrails: options.access ? [] : [{ claimKind: 'Legal access', statement: 'Legal access is not established: mapped frontage is not a recorded instrument.', unlockedBy: 'A recorded easement, plat dedication or deeded access instrument.' }],
    coverage: { present: [], absent: [] },
  } as unknown as PropertyEvidenceSynthesis;
}

const src = (label: string, url: string, quote: string) => ({ label, url, tier: 'official_government_source' as const, quote, retrievedAt: '2026-08-31T00:00:00.000Z' });

function countyAuthority(): ControllingLandUseAuthority {
  const assignment = { name: 'Bradford County', level: 'county' as const, determination: 'confirmed' as const, basis: 'Bradford County is named by an official government source as administering this function.', sources: [src('Bradford County Zoning', 'https://bradfordcountyfl.gov/zoning', 'The Bradford County Zoning Department administers the Land Development Regulations.')], competingClaims: [] };
  return {
    dealCardId: 115, municipality: null, county: 'Bradford', state: 'FL', incorporationStatus: 'unincorporated', incorporationBasis: 'No municipality administers land use for this parcel.',
    zoningAuthority: assignment, subdivisionAuthority: assignment, planningBody: 'Bradford County Planning and Zoning Board',
    geographyEvidence: { locality: null, localityKind: null, county: 'Bradford', countyFips: '12007', state: 'FL', stateFips: '12', sourceLabel: 'U.S. Census Bureau TIGERweb geographic services', neverEstablishesLandUseAuthority: true },
    sources: assignment.sources, conflicts: [], limitations: [], verifiedAt: '2026-08-31T00:00:00.000Z',
  };
}

function municipalAuthority(): ControllingLandUseAuthority {
  const assignment = { name: 'Lake Butler', level: 'municipal' as const, determination: 'confirmed' as const, basis: 'Lake Butler is named by an official government source as administering this function: "Code of Ordinances Community Redevelopment Agency"', sources: [src('Planning and Zoning &#8211; City of Lake Butler', 'https://www.cityoflakebutler.com/planning-and-zoning/', 'Code of Ordinances Community Redevelopment Agency')], competingClaims: [] };
  return {
    dealCardId: 115, municipality: 'Lake Butler', county: 'Bradford', state: 'FL', incorporationStatus: 'incorporated', incorporationBasis: 'An official source names a municipal government as administering land use for this parcel.',
    zoningAuthority: assignment, subdivisionAuthority: assignment, planningBody: null,
    geographyEvidence: { locality: 'Lake Butler', localityKind: 'Incorporated Place', county: 'Bradford', countyFips: null, state: 'FL', stateFips: '12', sourceLabel: 'U.S. Census Bureau TIGERweb geographic services', neverEstablishesLandUseAuthority: true },
    sources: assignment.sources, conflicts: ['An overlay or special planning district is referenced for this jurisdiction: "SECTION 11.3 DESIGNATION OF LANDMARKS, LANDMARK SITES, AND HISTORIC DISTRICTS"'], limitations: [], verifiedAt: '2026-08-31T00:00:00.000Z',
  };
}

const unincorporatedBoundary = (): ZoningAnalysis['jurisdiction'] => ({
  determination: 'probable', incorporationStatus: 'unincorporated_county', controllingAuthorityName: 'Bradford County', controllingAuthorityLevel: 'county',
  officialBoundaryEvidence: true, mailingCityDiffersFromAuthority: true, candidateAuthoritiesConsidered: ['Starke CCD (county subdivision)'],
  basis: 'No official incorporated-place boundary contains the parcel geometry, so the parcel is in the unincorporated county jurisdiction. The mailing city "Lake Butler" differs from the governing authority "Bradford County".',
});

function zoning(established: boolean): CurrentZoningDetermination {
  return {
    dealCardId: 115, established, districtCode: established ? 'RSF-1' : null, districtName: established ? 'Residential Single Family' : null, overlays: [],
    authorityName: 'Bradford County', authorityDetermination: 'confirmed', evidenceKind: established ? 'official_zoning_gis_layer' : null,
    sourceLabel: established ? 'Bradford County zoning GIS layer' : null, sourceUrl: established ? 'https://gis.bradfordcountyfl.gov/zoning' : null,
    parcelMatchBasis: established ? 'Parcel polygon intersected by APN 00083A03400' : null, effectiveOrAsOf: established ? '2025-03-01' : null,
    verifiedAt: '2026-08-31T00:00:00.000Z', confidence: established ? 'confirmed' : 'unresolved', conflicts: [], historicalReferences: [], requestedZoning: [],
    standards: { minimumLotSize: null, density: null, principalUses: [], residentialEligible: null, manufacturedHomeEligible: null, setbacks: null, frontage: null, lotWidth: null, heightOrCoverage: null, specialConditions: [], sources: [] },
    limitations: established ? [] : ['CURRENT zoning is UNRESOLVED. No current, parcel-specific, official source established the district.'], consideredEvidence: [],
  } as unknown as CurrentZoningDetermination;
}

function standards(): ZoningStandardsResult {
  const doc = { label: 'Bradford County Land Development Regulations, Article 4', url: 'https://library.municode.com/fl/bradford_county/codes/ldr', draftOrProposed: false, adoptedOrAsOf: '2024-11-12' };
  return {
    dealCardId: 115, districtCode: 'RSF-1', established: true, contextOnly: false, authorityName: 'Bradford County',
    standards: { minimumLotSize: 'one (1) acre', density: '1 dwelling unit per acre', principalUses: ['Single-family dwelling'], residentialEligible: true, manufacturedHomeEligible: false, setbacks: 'Front 25 ft, side 10 ft, rear 15 ft', frontage: 'one hundred (100) feet', lotWidth: '100 feet', heightOrCoverage: '35 feet', specialConditions: [], sources: [{ label: doc.label, url: doc.url, section: 'Sec. 4.3.2', quote: 'Minimum lot area: one (1) acre; minimum lot width and frontage: one hundred (100) feet.' }] },
    allowedUses: [
      { use: 'Single-family detached dwelling', status: 'permitted', section: 'Sec. 4.3.1', quote: 'Permitted uses: single-family detached dwelling', sourceLabel: doc.label, sourceUrl: doc.url },
      { use: 'Mobile home or manufactured home', status: 'prohibited', section: 'Sec. 4.3.1', quote: 'Prohibited: mobile homes and manufactured homes', sourceLabel: doc.label, sourceUrl: doc.url },
      { use: 'Accessory structures customarily incidental to a dwelling', status: 'permitted', section: 'Sec. 4.3.1', quote: 'Accessory structures', sourceLabel: doc.label, sourceUrl: doc.url },
    ],
    overlays: [], documents: [doc], supersededHistory: [], conflicts: [], limitations: [], retrievedAt: '2026-08-31T00:00:00.000Z', race: null,
  };
}

function rule(key: SubdivisionRuleKey, label: string, value: string, section: string): SubdivisionRule {
  return { key, label, value, quote: value, section, sourceLabel: 'Bradford County Land Development Regulations, Article 6', sourceUrl: 'https://library.municode.com/fl/bradford_county/codes/ldr#art6', authorityName: 'Bradford County', effectiveOrAsOf: '2024-11-12', confidence: 'confirmed', limitations: [] };
}

function regulations(options: { fee?: boolean } = {}): SubdivisionRegulations {
  const minor = rule('minor_subdivision_definition', 'Minor subdivision definition', 'Minor subdivision means the division of a parcel into not more than three (3) lots, each fronting on an existing public road, with no new road required.', 'Sec. 6.2.1');
  const major = rule('major_subdivision_definition', 'Major subdivision definition', 'Major subdivision means any subdivision creating four (4) or more lots or requiring the construction of a new road.', 'Sec. 6.2.2');
  const maxLots = rule('max_lots_before_major_review', 'Maximum lots before major review', 'not more than three (3) lots', 'Sec. 6.2.1');
  const rules: SubdivisionRule[] = [
    minor, major, maxLots,
    rule('survey_requirement', 'Survey requirement', 'A boundary survey signed and sealed by a Florida licensed surveyor.', 'Sec. 6.4.1'),
    rule('plat_requirement', 'Plat requirement', 'A minor plat prepared in accordance with Chapter 177, Florida Statutes.', 'Sec. 6.4.2'),
    rule('access_requirement', 'Access requirement', 'Each lot shall have a minimum of one hundred (100) feet of frontage on an existing public road.', 'Sec. 6.4.3'),
    rule('new_road_standard', 'New road standard', 'Any new road shall be constructed to county paved-road standards.', 'Sec. 6.5.1'),
    rule('stormwater_requirement', 'Stormwater requirement', 'Major subdivisions shall provide a stormwater management plan reviewed by the county engineer.', 'Sec. 6.5.4'),
    rule('road_improvement_requirement', 'Road improvement requirement', 'The developer shall post a surety bond for required improvements prior to final plat.', 'Sec. 6.5.6'),
    rule('administrative_review', 'Staff / administrative review', 'Minor subdivisions are reviewed and approved administratively by the Zoning Department.', 'Sec. 6.3.1'),
    rule('planning_commission_review', 'Planning commission review', 'Major subdivisions require preliminary plat review by the Planning and Zoning Board at a public hearing.', 'Sec. 6.3.2'),
    rule('governing_body_approval', 'Governing-body approval', 'Final plats are approved by the Board of County Commissioners.', 'Sec. 6.3.3'),
    rule('recording_requirement', 'Recording requirement', 'The approved plat shall be recorded in the public records of Bradford County.', 'Sec. 6.4.6'),
    ...(options.fee ? [rule('review_fee', 'Review fee', 'Minor subdivision review fee: $250 plus $25 per lot.', 'Sec. 6.7')] : []),
  ];
  return {
    dealCardId: 115, authorityName: 'Bradford County', authorityDetermination: 'confirmed',
    documents: [{ label: 'Bradford County Land Development Regulations, Article 6', url: 'https://library.municode.com/fl/bradford_county/codes/ldr#art6', tier: 'official_government_source', adoptedOrAsOf: '2024-11-12', draftOrProposed: false, retrievedAt: '2026-08-31T00:00:00.000Z' }],
    rules,
    thresholds: { minorDefinition: minor, majorDefinition: major, administrativeSplitThreshold: null, maxLotsBeforeMajorReview: maxLots, statedMaxMinorLots: 3, basis: 'The regulation defines a minor subdivision as not more than three lots.' },
    reviewSequence: ['Minor plat: administrative review', 'Major: preliminary plat hearing, then final plat'],
    limitations: [], retrievedAt: '2026-08-31T00:00:00.000Z',
  };
}

function read(acres: number, minimumLotAcres: number | null, kind: PropertySubdivisionRead['likelyPath']['kind']): PropertySubdivisionRead {
  const lots = minimumLotAcres ? Math.floor(acres / minimumLotAcres) : null;
  return {
    dealCardId: 115,
    likelyPath: { kind, basis: kind === 'unknown' ? 'unknown' : 'likely', why: kind === 'unknown' ? 'No current subdivision regulation document was retrieved for the controlling authority, so the applicable path is not established.' : `A theoretical ceiling of ${lots} lot(s) against the regulation's minor threshold of 3 places this parcel on the ${kind.replace(/_/g, ' ')} path.` },
    reviewIndication: kind === 'major_subdivision' ? 'major' : kind === 'unknown' ? 'unknown' : 'minor', requiredReviewBody: kind === 'unknown' ? null : kind === 'major_subdivision' ? 'Planning and Zoning Board, then the Board of County Commissioners' : 'Zoning Department (administrative)',
    theoreticalLotCount: { value: lots, status: lots != null ? 'theoretical' : 'unknown', calculation: lots != null ? `${acres} ac ÷ ${minimumLotAcres} ac = ${lots} lot(s), floored` : 'Not calculated: no minimum lot size was established.', approvedYield: false, inputs: { acres, minimumLotAcres, minimumLotSizeStatedAs: minimumLotAcres ? 'one (1) acre' : null }, caveats: [] },
    frontageConstraint: { status: 'unknown', maxLotsByFrontage: null, basis: 'unknown', detail: 'No frontage ceiling computed.' },
    obviousMaximumLotConstraint: { value: lots, from: lots != null ? 'minimum lot size' : 'Nothing established a lot ceiling for this tract.', basis: lots != null ? 'theoretical' : 'unknown' },
    constraints: [{ kind: 'utilities_septic', headline: 'Utility and septic capacity is not established.', detail: 'Per-lot septic feasibility governs.', basis: 'unknown', sources: [] }],
    nextAuthoritativeDiligence: ['Ask the planning department to confirm, in writing, the review path and lot ceiling that would apply to this specific parcel.'],
    limitations: [], generatedAt: '2026-08-31T00:00:00.000Z',
  };
}

function input(overrides: Partial<ZoningDevelopmentInput> & { acres?: number; access?: boolean; septic?: boolean } = {}): ZoningDevelopmentInput {
  const acres = overrides.acres ?? 1.5;
  return {
    dealCardId: 115,
    dossier: buildAcquisitionDossier(file(acres)),
    subject: subject(acres),
    property: story({ access: overrides.access ?? false, septic: overrides.septic ?? false, acres }),
    authority: null, boundary: null, zoning: null, standards: null, regulations: null, subdivisionRead: null,
    ...overrides,
  };
}

const pathOf = (result: ReturnType<typeof buildZoningDevelopmentIntelligence>, kind: string) => result.paths.find((path) => path.kind === kind)!;

// ── 1. A simple by-right lot ───────────────────────────────────────────────

describe('a simple by-right lot in an established district', () => {
  const result = buildZoningDevelopmentIntelligence(input({
    acres: 1.2, access: true, septic: true,
    authority: countyAuthority(), boundary: unincorporatedBoundary(), zoning: zoning(true), standards: standards(), regulations: regulations(), subdivisionRead: read(1.2, 1, 'administrative_split'),
  }));

  it('resolves the governing authority from the retained record with the official boundary agreeing', () => {
    expect(result.authority.zoning.name).toBe('Bradford County');
    expect(result.authority.zoning.level).toBe('county');
    expect(result.authority.zoning.weight).toBe('confirmed');
    expect(result.authority.incorporationStatus).toBe('unincorporated');
    expect(result.authority.conflict).toBeNull();
    expect(result.authority.etjOrPlanningArea.status).toBe('not_established');
    expect(result.authority.sources.some((source) => source.tier === 'official_boundary_geography')).toBe(true);
  });

  it('reads the current district with its source basis and effective date', () => {
    expect(result.zoning.established).toBe(true);
    expect(result.zoning.districtCode).toBe('RSF-1');
    expect(result.zoning.effectiveOrAsOf).toBe('2025-03-01');
    expect(result.zoning.source?.url).toContain('gis.bradfordcountyfl.gov');
    expect(result.zoning.statement).toMatch(/matched to this parcel by Parcel polygon/);
  });

  it('reads the strategy-relevant uses as by right, prohibited, or not established — never allowed by silence', () => {
    const standing = Object.fromEntries(result.uses.map((use) => [use.key, use.standing]));
    expect(standing.single_family_dwelling).toBe('by_right');
    expect(standing.manufactured_home).toBe('prohibited');
    expect(standing.accessory_structure).toBe('by_right');
    expect(standing.agricultural).toBe('not_established');
    expect(result.uses.find((use) => use.key === 'agricultural')!.statement).toMatch(/never as allowed/);
    expect(result.uses.find((use) => use.key === 'single_family_dwelling')!.section).toBe('Sec. 4.3.1');
  });

  it('extracts the dimensional standards each traced to a section', () => {
    const lot = result.standards.find((row) => row.key === 'lot_area')!;
    expect(lot.status).toBe('established');
    expect(lot.value).toBe('one (1) acre');
    expect(lot.source?.section).toBe('Sec. 4.3.2');
    expect(result.standards.find((row) => row.key === 'frontage')!.value).toBe('one hundred (100) feet');
    expect(result.standards.find((row) => row.key === 'road_access')!.value).toMatch(/Access requirement/);
  });

  it('places the parcel on the as-is path and rules both division paths out', () => {
    expect(pathOf(result, 'as_is').applicability).toBe('applies');
    expect(pathOf(result, 'minor_subdivision').applicability).toBe('not_applicable');
    expect(pathOf(result, 'minor_subdivision').applicabilityWhy).toMatch(/fewer than two lots/);
    expect(pathOf(result, 'major_subdivision_entitlement').applicability).toBe('not_applicable');
    expect(result.subjectScreen.theoreticalLotCount.value).toBe(1);
    expect(result.subjectScreen.theoreticalLotCount.approvedYield).toBe(false);
  });

  it('names the smallest decisive verification: with access and septic established, the remaining gate is the wetland share', () => {
    const asIs = pathOf(result, 'as_is');
    expect(asIs.decisiveVerification.action).toMatch(/septic site evaluation|sewer-availability/);
    expect(result.criticalGates.map((gate) => gate.key)).toEqual(['wetlands']);
    // A by-right read is well supported, never "confirmed": only the
    // jurisdiction's written determination confirms an entitlement position.
    expect(result.confidence).toBe('well_supported');
  });
});

// ── 2. A potential minor split ─────────────────────────────────────────────

describe('a potential minor split under the local lot-split definition', () => {
  const build = (fee: boolean) => buildZoningDevelopmentIntelligence(input({
    acres: 2.6, access: true,
    authority: countyAuthority(), boundary: unincorporatedBoundary(), zoning: zoning(true), standards: standards(), regulations: regulations({ fee }), subdivisionRead: read(2.6, 1, 'minor_subdivision'),
  }));

  it('describes the jurisdiction\'s own minor path: label, definition, trigger, threshold, authority, materials, steps', () => {
    const minor = pathOf(build(false), 'minor_subdivision');
    expect(minor.applicability).toBe('may_apply');
    expect(minor.localDefinition?.definition).toMatch(/not more than three \(3\) lots/);
    expect(minor.localDefinition?.section).toBe('Sec. 6.2.1');
    expect(minor.threshold.maxLots).toBe(3);
    expect(minor.authority).toBe('Bradford County');
    expect(minor.reviewBody).toBe('Zoning Department (administrative)');
    expect(minor.materials.map((item) => item.item)).toEqual(expect.arrayContaining(['Survey', 'Plat', 'Recording']));
    expect(minor.requirements.map((row) => row.kind)).toEqual(expect.arrayContaining(['plat', 'survey', 'access', 'road']));
    expect(minor.approvalSteps.join(' ')).toMatch(/administrative/i);
    expect(minor.parcelGates.join(' ')).toMatch(/septic/i);
  });

  it('keeps the major path out when the theoretical count sits inside the local threshold', () => {
    const major = pathOf(build(false), 'major_subdivision_entitlement');
    expect(major.applicability).toBe('not_applicable');
    expect(major.applicabilityWhy).toMatch(/within the 3-lot minor threshold/);
  });

  it('shows cost only when the regulation states it, and time never without a source', () => {
    expect(pathOf(build(false), 'minor_subdivision').costAndTime).toBeNull();
    const withFee = pathOf(build(true), 'minor_subdivision');
    expect(withFee.costAndTime?.estimatedCost).toMatch(/\$250 plus \$25 per lot/);
    expect(withFee.costAndTime?.estimatedTime).toBeNull();
    expect(withFee.costAndTime?.basis).toMatch(/fee only/);
  });

  it('carries an operator-supplied estimate with its provenance', () => {
    const result = buildZoningDevelopmentIntelligence(input({
      acres: 2.6, access: true, authority: countyAuthority(), boundary: unincorporatedBoundary(), zoning: zoning(true), standards: standards(), regulations: regulations(), subdivisionRead: read(2.6, 1, 'minor_subdivision'),
      operatorEstimates: [{ path: 'minor_subdivision', estimatedCost: '$6,500 survey and plat', estimatedTime: '60–90 days', suppliedBy: 'Tyler', suppliedAt: '2026-09-01T00:00:00.000Z' }],
    }));
    expect(pathOf(result, 'minor_subdivision').costAndTime).toEqual({ estimatedCost: '$6,500 survey and plat', estimatedTime: '60–90 days', basis: 'Operator-supplied (Tyler, 2026-09-01).' });
  });

  it('names a pre-application written determination as the decisive step once the numbers are read', () => {
    const minor = pathOf(build(false), 'minor_subdivision');
    expect(minor.decisiveVerification.action).toMatch(/Ask Zoning Department \(administrative\) in writing whether APN 00083A03400 qualifies for Minor subdivision/);
    expect(minor.decisiveVerification.askOf).toBe('Bradford County');
  });
});

// ── 3. A likely major / entitlement opportunity ────────────────────────────

describe('a likely major subdivision or entitlement opportunity', () => {
  const result = buildZoningDevelopmentIntelligence(input({
    acres: 12, access: true,
    authority: countyAuthority(), boundary: unincorporatedBoundary(), zoning: zoning(true), standards: standards(), regulations: regulations(), subdivisionRead: read(12, 1, 'major_subdivision'),
  }));

  it('describes the major path from the local definition: triggers, hearings, engineering, bonding', () => {
    const major = pathOf(result, 'major_subdivision_entitlement');
    expect(major.applicability).toBe('may_apply');
    expect(major.localDefinition?.definition).toMatch(/four \(4\) or more lots or requiring the construction of a new road/);
    expect(major.trigger).toMatch(/More than 3 lot\(s\)/);
    expect(major.trigger).toMatch(/new road/i);
    expect(major.reviewBody).toBe('Planning commission, then the governing body');
    expect(major.requirements.some((row) => row.kind === 'bonding_or_dedication' && /surety bond/.test(row.requirement))).toBe(true);
    expect(major.requirements.some((row) => row.kind === 'environmental' && /stormwater/i.test(row.requirement))).toBe(true);
    expect(major.approvalSteps.join(' ')).toMatch(/public hearing/);
    expect(major.approvalSteps.join(' ')).toMatch(/Board of County Commissioners/);
  });

  it('routes the minor path out and names the pre-application meeting as the decisive step', () => {
    expect(pathOf(result, 'minor_subdivision').applicability).toBe('not_applicable');
    expect(pathOf(result, 'major_subdivision_entitlement').decisiveVerification.action).toMatch(/pre-application meeting with Bradford County planning staff/);
    expect(pathOf(result, 'major_subdivision_entitlement').costAndTime).toBeNull();
    expect(pathOf(result, 'major_subdivision_entitlement').missingInputs.join(' ')).not.toMatch(/Bonding, surety and dedication requirements were not located/);
  });
});

// ── 4. Municipal versus unincorporated ─────────────────────────────────────

const emptyRegulations = (): SubdivisionRegulations => ({ ...regulations(), rules: [], documents: [], thresholds: { minorDefinition: null, majorDefinition: null, administrativeSplitThreshold: null, maxLotsBeforeMajorReview: null, statedMaxMinorLots: null, basis: 'Neither a minor-subdivision definition nor an explicit lot ceiling was extracted.' }, reviewSequence: [] });

/** A municipal record that ACTED ON THIS PARCEL: the government's own packet
 *  naming the subject. Parcel-specific by construction. */
function parcelSpecificMunicipalAuthority(): ControllingLandUseAuthority {
  const base = municipalAuthority();
  const assignment = {
    ...base.zoningAuthority,
    basis: 'Lake Butler exercised this function over THIS parcel in a document it published itself — the strongest available evidence of jurisdiction, and there are 2 such passage(s). Example: "Parcel 00083A03400: Current Zoning RSF-1"',
    sources: [src('City of Lake Butler planning packet', 'https://www.cityoflakebutler.com/packets/2026-06.pdf', 'Parcel 00083A03400: Current Zoning RSF-1; applicant requests a lot split.')],
  };
  return { ...base, zoningAuthority: assignment, subdivisionAuthority: assignment, sources: assignment.sources };
}

const incorporatedBoundary = (): ZoningAnalysis['jurisdiction'] => ({
  ...unincorporatedBoundary(), incorporationStatus: 'incorporated_municipality', controllingAuthorityName: 'Lake Butler', controllingAuthorityLevel: 'municipality',
  mailingCityDiffersFromAuthority: false, basis: 'The official incorporated-place boundary for Lake Butler contains the parcel geometry.',
});

describe('a postal-locality municipal record against subject-specific official boundary evidence (Deal 115)', () => {
  const result = buildZoningDevelopmentIntelligence(input({
    authority: municipalAuthority(), boundary: unincorporatedBoundary(), zoning: zoning(false), regulations: emptyRegulations(), subdivisionRead: read(1.5, null, 'unknown'),
  }));

  it('does not raise a conflict: the jurisdiction-level page keyed to the mailing city cannot place the parcel', () => {
    expect(result.authority.conflict).toBeNull();
    expect(result.authority.zoning.name).toBe('Bradford County');
    expect(result.authority.zoning.level).toBe('county');
    expect(result.authority.zoning.weight).toBe('well_supported');
    expect(result.authority.incorporationStatus).toBe('unincorporated');
    expect(result.authority.municipalityOrTownship).toBeNull();
    expect(result.authority.zoning.basis).toMatch(/keyed to the postal locality/);
    expect(result.authority.postalLocality.city).toBe('Lake Butler');
    expect(result.authority.postalLocality.statement).toMatch(/does not establish municipal, zoning, ETJ or planning authority/);
  });

  it('keeps the dismissed claim visible with its source, date and the reason it does not qualify', () => {
    expect(result.authority.nonQualifyingClaims).toHaveLength(1);
    const claim = result.authority.nonQualifyingClaims[0];
    expect(claim.claim).toBe('Lake Butler administers zoning (municipal)');
    expect(claim.source).toBe('Planning and Zoning – City of Lake Butler');
    expect(claim.url).toContain('cityoflakebutler.com');
    expect(claim.retrievedAt).toBe('2026-08-31T00:00:00.000Z');
    expect(claim.reason).toMatch(/nothing in it reaches APN 00083A03400/);
    expect(claim.reason).toMatch(/keyed to the postal locality "Lake Butler"/);
    expect(result.authority.specialAuthorities[0]).toMatch(/HISTORIC DISTRICTS/);
    expect(result.criticalGates.map((gate) => gate.key)).not.toContain('authority');
    expect(result.criticalGates.map((gate) => gate.key)).toEqual(expect.arrayContaining(['zoning', 'access', 'regulations', 'septic', 'wetlands']));
  });

  it('names the district from the governing county as the decisive step and leaves every path NOT ESTABLISHED', () => {
    expect(pathOf(result, 'as_is').decisiveVerification.action).toMatch(/Obtain the current zoning district for APN 00083A03400 from Bradford County's adopted zoning map/);
    expect(pathOf(result, 'minor_subdivision').decisiveVerification.action).toMatch(/Obtain Bradford County's current subdivision \/ land development regulations/);
    for (const path of result.paths) expect(path.applicability).toBe('not_established');
    expect(pathOf(result, 'minor_subdivision').localDefinition).toBeNull();
    expect(pathOf(result, 'minor_subdivision').threshold.maxLots).toBeNull();
    expect(result.uses.every((use) => use.standing === 'not_established')).toBe(true);
    expect(result.confidence).toBe('unresolved');
  });
});

describe('jurisdiction applicability rules', () => {
  it('a postal city alone cannot create a governing authority, and incorporation is not inferred from the county', () => {
    const result = buildZoningDevelopmentIntelligence(input({ authority: municipalAuthority(), boundary: null, zoning: zoning(false), regulations: emptyRegulations() }));
    expect(result.authority.zoning.name).toBeNull();
    expect(result.authority.zoning.weight).toBe('unresolved');
    expect(result.authority.incorporationStatus).toBe('unverified');
    expect(result.authority.conflict).toBeNull();
    expect(result.authority.nonQualifyingClaims[0].reason).toMatch(/Keyed to the postal locality "Lake Butler"/);
    expect(result.authority.zoning.basis).toMatch(/A mailing city, ZIP or geocoder place name cannot establish who governs/);
    expect(result.criticalGates[0].key).toBe('authority');
    expect(result.criticalGates[0].decisiveVerification).toMatch(/place-boundary check against the parcel geometry|taxing-district field/);
    expect(pathOf(result, 'as_is').decisiveVerification.action).toMatch(/Establish who governs before any code is read/);
  });

  it('the same ZIP crosses a jurisdiction boundary: only subject-specific official boundaries decide', () => {
    const outside = buildZoningDevelopmentIntelligence(input({ authority: municipalAuthority(), boundary: unincorporatedBoundary(), zoning: zoning(false), regulations: emptyRegulations() }));
    const inside = buildZoningDevelopmentIntelligence(input({ authority: municipalAuthority(), boundary: incorporatedBoundary(), zoning: zoning(false), regulations: emptyRegulations() }));
    expect(outside.authority.postalLocality.city).toBe(inside.authority.postalLocality.city);
    expect(outside.authority.zoning).toMatchObject({ name: 'Bradford County', level: 'county' });
    expect(outside.authority.incorporationStatus).toBe('unincorporated');
    expect(inside.authority.zoning).toMatchObject({ name: 'Lake Butler', level: 'municipal', weight: 'confirmed' });
    expect(inside.authority.incorporationStatus).toBe('incorporated');
    expect(inside.authority.municipalityOrTownship).toBe('Lake Butler');
    expect(inside.authority.conflict).toBeNull();
    expect(inside.authority.nonQualifyingClaims).toHaveLength(0);
    expect(inside.authority.zoning.basis).toMatch(/official boundary geometry agrees: the parcel is inside Lake Butler/);
  });

  it('a county page without boundary evidence is carried as the working authority at reduced weight with incorporation unverified', () => {
    const result = buildZoningDevelopmentIntelligence(input({ authority: countyAuthority(), boundary: null, zoning: zoning(true), standards: standards(), regulations: regulations(), subdivisionRead: read(1.5, 1, 'administrative_split') }));
    expect(result.authority.zoning).toMatchObject({ name: 'Bradford County', level: 'county', weight: 'likely' });
    expect(result.authority.incorporationStatus).toBe('unverified');
    expect(result.criticalGates.map((gate) => gate.key)).toContain('incorporation');
  });

  it('a genuine disagreement between two subject-specific official sources stays visible with sources, dates, applicability and the written verification', () => {
    const result = buildZoningDevelopmentIntelligence(input({ authority: parcelSpecificMunicipalAuthority(), boundary: unincorporatedBoundary(), zoning: zoning(false), regulations: emptyRegulations() }));
    expect(result.authority.conflict).not.toBeNull();
    expect(result.authority.conflict!.statement).toMatch(/Lake Butler acted on this parcel in its own document/);
    expect(result.authority.conflict!.statement).toMatch(/Both sources reach this parcel, so the disagreement is genuine/);
    expect(result.authority.conflict!.sides.map((side) => side.applicability)).toEqual(['parcel-specific official document', 'parcel geometry against official boundaries']);
    expect(result.authority.conflict!.sides[0].url).toContain('cityoflakebutler.com/packets');
    expect(result.authority.conflict!.sides[0].retrievedAt).toBe('2026-08-31T00:00:00.000Z');
    expect(result.authority.conflict!.decisiveVerification).toMatch(/zoning verification letter from Bradford County naming APN 00083A03400/);
    expect(result.authority.conflict!.decisiveVerification).toMatch(/Lake Butler planning office/);
    expect(result.authority.zoning).toMatchObject({ name: 'Bradford County', weight: 'likely' });
    expect(result.criticalGates[0].key).toBe('authority');
    expect(pathOf(result, 'as_is').decisiveVerification.action).toBe(result.authority.conflict!.decisiveVerification);
    expect(result.authority.nonQualifyingClaims).toHaveLength(0);
  });

  it('a parcel-specific municipal act establishes the authority without a boundary read', () => {
    const result = buildZoningDevelopmentIntelligence(input({ authority: parcelSpecificMunicipalAuthority(), boundary: null, zoning: zoning(false), regulations: emptyRegulations() }));
    expect(result.authority.zoning).toMatchObject({ name: 'Lake Butler', level: 'municipal', weight: 'confirmed' });
    expect(result.authority.incorporationStatus).toBe('incorporated');
    expect(result.authority.conflict).toBeNull();
  });

  it('persists decoded source labels and excerpts: no HTML entity survives into the payload', () => {
    const result = buildZoningDevelopmentIntelligence(input({ authority: municipalAuthority(), boundary: unincorporatedBoundary(), zoning: zoning(false), regulations: emptyRegulations() }));
    expect(JSON.stringify(result)).not.toMatch(/&#\d+;|&[a-z]+;/i);
    expect(result.authority.nonQualifyingClaims[0].source).toContain('–');
  });
});

// ── 5. Missing authoritative source ────────────────────────────────────────

describe('no authoritative source retained at all', () => {
  const result = buildZoningDevelopmentIntelligence(input());

  it('states the honest absence everywhere and hard-codes nothing nationwide', () => {
    expect(result.authority.zoning.name).toBeNull();
    expect(result.authority.zoning.weight).toBe('unresolved');
    expect(result.zoning.established).toBe(false);
    for (const path of result.paths) {
      expect(path.applicability).toBe('not_established');
      expect(path.localDefinition).toBeNull();
    }
    expect(pathOf(result, 'minor_subdivision').trigger).toMatch(/Not established: the regulation defining it is not retained/);
    expect(pathOf(result, 'minor_subdivision').threshold.maxLots).toBeNull();
    expect(pathOf(result, 'major_subdivision_entitlement').trigger).toMatch(/Not established/);
    expect(JSON.stringify(result.paths)).not.toMatch(/\b(?:five|ten) lots\b/i);
  });

  it('names obtaining the jurisdiction\'s own regulation and district as the decisive actions', () => {
    expect(pathOf(result, 'as_is').decisiveVerification.action).toMatch(/Obtain the current zoning district for APN 00083A03400 from the controlling authority/);
    expect(pathOf(result, 'minor_subdivision').decisiveVerification.action).toMatch(/current subdivision \/ land development regulations/);
    expect(result.criticalGates.map((gate) => gate.key)).toEqual(expect.arrayContaining(['authority', 'zoning', 'regulations']));
    expect(result.unknowns.length).toBeGreaterThan(3);
    expect(result.sourceLineage).toHaveLength(0);
    expect(result.currentness.statement).toMatch(/No retained source carries an effective or as-of date/);
  });
});

// ── Material fingerprint and shared assumptions ────────────────────────────

describe('material fingerprint', () => {
  it('is stable over identical evidence and moves only when a material dimension moves', () => {
    const base = input({ acres: 2.6, access: true, authority: countyAuthority(), boundary: unincorporatedBoundary(), zoning: zoning(true), standards: standards(), regulations: regulations(), subdivisionRead: read(2.6, 1, 'minor_subdivision') });
    const a = buildZoningDevelopmentIntelligence(base);
    const b = buildZoningDevelopmentIntelligence(input({ acres: 2.6, access: true, authority: countyAuthority(), boundary: unincorporatedBoundary(), zoning: zoning(true), standards: standards(), regulations: regulations(), subdivisionRead: read(2.6, 1, 'minor_subdivision') }));
    expect(a.materialFingerprint).toBe(b.materialFingerprint);
    expect(a.generatedAt).toBeNull();
    // A sourced fee is a cost input the operator decides on: it refreshes
    // the read, and the change names the path it landed on and nothing else.
    const fee = buildZoningDevelopmentIntelligence({ ...base, regulations: regulations({ fee: true }) });
    expect(fee.materialFingerprint).not.toBe(a.materialFingerprint);
    expect(fee.materialDimensions.costAndTime).toMatch(/minor_subdivision=Review fee per the regulation/);
    expect(Object.keys(fee.materialDimensions).filter((key) => fee.materialDimensions[key] !== a.materialDimensions[key])).toEqual(['costAndTime']);
    // The district moving is material.
    const moved = buildZoningDevelopmentIntelligence({ ...base, zoning: zoning(false), standards: null });
    expect(moved.materialFingerprint).not.toBe(a.materialFingerprint);
    expect(moved.materialDimensions.district).toBe('not established');
  });

  it('keeps the as-is cost assumptions in the pure synthesis equal to the Comps & Valuation quick-flip assumptions', () => {
    expect(AS_IS_COST_ASSUMPTIONS.sellingCostPct).toBe(QUICK_FLIP.sellingCostPct);
    expect(AS_IS_COST_ASSUMPTIONS.sellerClosingPct).toBe(QUICK_FLIP.sellerClosingPct);
    expect(AS_IS_COST_ASSUMPTIONS.carryingCostPct).toBe(QUICK_FLIP.carryingCostPct);
    expect(AS_IS_COST_ASSUMPTIONS.riskReservePct).toBe(QUICK_FLIP.riskReservePct);
  });
});
