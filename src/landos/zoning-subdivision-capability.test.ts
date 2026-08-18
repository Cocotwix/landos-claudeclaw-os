import { beforeEach, describe, expect, it } from 'vitest';

import type { CapabilityResult, JsonObject } from './capability-contract.js';
import { invokeRuntimeCapability, listRuntimeCapabilities } from './capability-registry.js';
import type { ControllingLandUseAuthority } from './controlling-land-use-authority.js';
import type { CurrentZoningDetermination } from './current-zoning-determination.js';
import { _initTestLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import type { EvidencedValue, LandUseDetermination, LegalSourceCitation } from './land-use-types.js';
import { upsertPropertyCard } from './property-card.js';
import type { SubdivisionRegulations } from './subdivision-regulations.js';
import type { PropertySubdivisionRead } from './subdivision-property-read.js';
import {
  ZONING_SUBDIVISION_CAPABILITY,
  ZONING_SUBDIVISION_CAPABILITY_ID,
  type LandUseResearchOutcome,
  type ZoningSubdivisionFacts,
  type ZoningSubdivisionRuntime,
} from './zoning-subdivision-capability.js';

beforeEach(() => { _initTestLandosDb(); });

const NOW = '2026-08-18T12:00:00.000Z';

/** A canonical subject the way Property Resolution leaves it on a Deal Card. */
function canonicalSubject(overrides: { apn?: string; acres?: number; address?: string; title?: string } = {}) {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: overrides.title ?? 'Map 042 Parcel 123' });
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: overrides.address ?? 'Map 042 Parcel 123, Fairview, TN',
    apn: overrides.apn ?? '042 123.00',
    county: 'Williamson',
    state: 'TN',
    acres: overrides.acres ?? 61.5,
    verified: true,
    verificationSource: 'Williamson County Property Assessor',
  });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
  return { deal, card };
}

function citation(url: string, label: string, section: string | null = null): LegalSourceCitation {
  return {
    tier: 'primary_law' as LegalSourceCitation['tier'],
    label,
    url,
    publisher: 'City of Fairview, Tennessee',
    citation: section,
    excerpt: 'Each lot shall contain not less than one (1) acre.',
    format: 'html' as LegalSourceCitation['format'],
    effectiveDate: '2023-06-01',
    retrievedAt: NOW,
  };
}

function evidenced<T>(value: T | null, citations: LegalSourceCitation[] = [], unresolvedReason: string | null = null): EvidencedValue<T> {
  return {
    value,
    quality: value == null ? 'unverified' : 'verified_official',
    citations,
    unresolvedReason: value == null ? unresolvedReason ?? 'Not established.' : null,
    conflict: null,
  } as EvidencedValue<T>;
}

const ORDINANCE_URL = 'https://www.fairview-tn.org/subdivision-regulations.pdf';
const ZONING_MAP_URL = 'https://gis.williamsoncounty-tn.gov/zoning/042-123';

/**
 * The nationwide engine's own retained determination.
 *
 * `legalYield` is supplied directly rather than recomputed here: the capability
 * must READ the deterministic result, and a test that recomputed it would not
 * prove that.
 */
function determination(overrides: {
  legalYield?: LandUseDetermination['legalYield'];
  zoningCode?: string | null;
  nonZoning?: LandUseDetermination['zoning']['nonZoningClassification'];
  minimumLotArea?: string | null;
  uses?: LandUseDetermination['uses'];
  extraDimensionalStandards?: LandUseDetermination['dimensionalStandards'];
} = {}): LandUseDetermination {
  const empty = evidenced<string>(null);
  return {
    version: 1,
    subject: {
      dealCardId: 1, parcelId: '042 123.00', address: 'Map 042 Parcel 123', city: 'Fairview',
      county: 'Williamson County', state: 'TN', acres: 61.5, latitude: 35.98, longitude: -87.12,
      hasImprovements: false, sellerReported: [],
    } as LandUseDetermination['subject'],
    authority: {
      state: { role: 'state', name: evidenced('Tennessee'), unitType: 'state', relationship: null, officialUrl: null },
      county: { role: 'county', name: evidenced('Williamson County'), unitType: 'county', relationship: null, officialUrl: null },
      localUnit: { role: 'local_unit', name: evidenced('City of Fairview'), unitType: 'city', relationship: null, officialUrl: null },
      incorporation: evidenced('incorporated'),
      zoningAuthority: { role: 'zoning', name: evidenced('City of Fairview'), unitType: 'city', relationship: 'The parcel lies inside the city limits.', officialUrl: 'https://www.fairview-tn.org/planning' },
      subdivisionAuthority: { role: 'subdivision', name: evidenced('City of Fairview'), unitType: 'city', relationship: null, officialUrl: null },
      septicHealthAuthority: { role: 'septic', name: empty, unitType: 'county', relationship: null, officialUrl: null },
      roadAccessAuthority: { role: 'road', name: empty, unitType: 'city', relationship: null, officialUrl: null },
      otherAuthorities: [],
      pattern: 'incorporated_city_zones_and_subdivides',
      patternExplanation: 'The city exercises both zoning and subdivision authority.',
    } as unknown as LandUseDetermination['authority'],
    stateFramework: { state: 'TN', status: 'not_found', provisions: [], localAuthorityRetained: empty, sourcesSearched: [], searchedAt: NOW } as LandUseDetermination['stateFramework'],
    zoning: {
      presence: 'zoning_established',
      code: overrides.zoningCode === undefined
        ? evidenced('R-20 POD', [citation(ZONING_MAP_URL, 'Fairview zoning map')])
        : evidenced(overrides.zoningCode, [citation(ZONING_MAP_URL, 'Fairview zoning map')]),
      districtName: evidenced('Low Density Residential, Planned Overlay District'),
      classificationKind: 'adopted_zoning',
      governingAuthority: 'City of Fairview',
      sourceDisclaimer: null,
      effectiveDate: null,
      nonZoningClassification: overrides.nonZoning ?? null,
    } as LandUseDetermination['zoning'],
    uses: overrides.uses ?? [],
    privateRestrictions: [],
    dimensionalStandards: [{
      kind: 'minimum_lot_area',
      originalTerm: 'Minimum lot area',
      statedValue: '1 acre',
      numericValue: 1,
      unit: 'acres',
      citation: citation(ORDINANCE_URL, 'Fairview Zoning Ordinance', 'Sec. 14-402'),
      qualifier: 'where public sewer is unavailable',
    }, ...(overrides.extraDimensionalStandards ?? [])] as LandUseDetermination['dimensionalStandards'],
    subdivision: {
      governingBody: 'City of Fairview',
      ordinanceLabel: 'Fairview Subdivision Regulations',
      ordinanceUrl: ORDINANCE_URL,
      subdivisionDefinition: empty,
      paths: [],
      parentTract: { applies: evidenced<boolean>(false), parentTractDefinition: empty, lookbackPeriod: empty, priorDivisionCountRule: empty, remainderTreatment: empty, priorDivisionHistoryRequired: false, requiredVerificationStep: null },
      minimumLotArea: overrides.minimumLotArea === undefined
        ? evidenced('one (1) acre', [citation(ORDINANCE_URL, 'Fairview Subdivision Regulations', 'Art. IV Sec. 4.2')])
        : evidenced(overrides.minimumLotArea, [citation(ORDINANCE_URL, 'Fairview Subdivision Regulations', 'Art. IV Sec. 4.2')]),
      minimumLotWidth: empty,
      minimumRoadFrontage: evidenced('150 feet', [citation(ORDINANCE_URL, 'Fairview Subdivision Regulations', 'Art. IV Sec. 4.3')]),
      flagLots: empty, sharedDriveways: empty, privateRoads: empty,
      publicRoadFrontageRequired: evidenced<boolean>(true, [citation(ORDINANCE_URL, 'Fairview Subdivision Regulations', 'Art. IV Sec. 4.3')]),
      newRoadTrigger: empty, surveyRequirement: empty, platRequirement: empty, recordingRequirement: empty,
      utilityRequirement: empty, septicRequirement: empty, wellRequirement: empty, stormwaterRequirement: empty,
      fireAccessRequirement: empty, applicationFee: empty, publishedReviewTimeline: empty, stateHighwayAccessImplication: empty,
    } as unknown as LandUseDetermination['subdivision'],
    access: {} as LandUseDetermination['access'],
    septicWell: {} as LandUseDetermination['septicWell'],
    precedence: [],
    legalYield: overrides.legalYield ?? {
      status: 'established',
      maximumLots: 61,
      path: 'minor_subdivision',
      constraintsApplied: [{ constraint: 'Minimum lot area', value: '1 acre', source: ORDINANCE_URL }],
      missingInputs: [],
      reason: '61.5 acres at a one-acre minimum lot size supports 61 lots.',
    },
    physicalYield: {} as LandUseDetermination['physicalYield'],
    carveouts: [], scenarios: [], discoveryQuestions: [],
    unresolved: [],
    failureStates: [],
    sources: [citation(ORDINANCE_URL, 'Fairview Subdivision Regulations', 'Art. IV Sec. 4.2')],
    lanes: [],
    determinedAt: NOW,
  };
}

function authority(overrides: { determination?: string; name?: string | null } = {}): ControllingLandUseAuthority {
  const assignment = {
    name: overrides.name === undefined ? 'City of Fairview' : overrides.name,
    level: 'municipality',
    determination: overrides.determination ?? 'confirmed',
    basis: 'The city charter states the municipality administers zoning and subdivision inside the corporate limits.',
    sources: [{ label: 'Fairview Municipal Code', url: 'https://library.municode.com/tn/fairview', tier: 'official_government_source', quote: 'The Planning Commission shall approve all plats.', retrievedAt: NOW }],
    competingClaims: [],
  };
  return {
    dealCardId: 1,
    municipality: 'Fairview',
    county: 'Williamson County',
    state: 'TN',
    incorporationStatus: 'incorporated',
    incorporationBasis: 'Census place boundary.',
    zoningAuthority: assignment,
    subdivisionAuthority: assignment,
    planningBody: 'Fairview Municipal Planning Commission',
    geographyEvidence: null,
    sources: [],
    conflicts: [],
    limitations: [],
    verifiedAt: NOW,
  } as unknown as ControllingLandUseAuthority;
}

function zoning(overrides: Partial<CurrentZoningDetermination> = {}): CurrentZoningDetermination {
  return {
    dealCardId: 1,
    established: true,
    districtCode: 'R-20 POD',
    districtName: 'Low Density Residential, Planned Overlay District',
    overlays: [],
    authorityName: 'City of Fairview',
    authorityDetermination: 'confirmed',
    evidenceKind: 'official_zoning_gis',
    sourceLabel: 'Williamson County zoning viewer',
    sourceUrl: ZONING_MAP_URL,
    parcelMatchBasis: 'Matched on parcel 042 123.00.',
    effectiveOrAsOf: '2026-01-01',
    verifiedAt: NOW,
    confidence: 'confirmed',
    conflicts: [],
    historicalReferences: [],
    requestedZoning: [],
    standards: {} as CurrentZoningDetermination['standards'],
    limitations: [],
    consideredEvidence: [],
    ...overrides,
  } as CurrentZoningDetermination;
}

function regulations(): SubdivisionRegulations {
  return {
    dealCardId: 1,
    authorityName: 'City of Fairview',
    authorityDetermination: 'confirmed',
    documents: [{
      label: 'Fairview Subdivision Regulations',
      url: ORDINANCE_URL,
      tier: 'official_government_source',
      adoptedOrAsOf: '2023-06-01',
      draftOrProposed: false,
      retrievedAt: NOW,
    }],
    rules: [{
      key: 'minimum_lot_size',
      label: 'Minimum lot size',
      value: 'one (1) acre',
      quote: 'Each lot shall contain not less than one (1) acre.',
      section: 'Art. IV Sec. 4.2',
      sourceLabel: 'Fairview Subdivision Regulations',
      sourceUrl: ORDINANCE_URL,
      authorityName: 'City of Fairview',
      effectiveOrAsOf: '2023-06-01',
      confidence: 'confirmed',
      limitations: [],
    }],
    thresholds: {} as SubdivisionRegulations['thresholds'],
    reviewSequence: [],
    limitations: [],
    retrievedAt: NOW,
  } as SubdivisionRegulations;
}

function subdivisionRead(overrides: { path?: string; caveats?: string[]; theoretical?: number | null } = {}): PropertySubdivisionRead {
  return {
    dealCardId: 1,
    likelyPath: { kind: (overrides.path ?? 'minor_subdivision') as PropertySubdivisionRead['likelyPath']['kind'], basis: 'likely', why: 'The lot count exceeds the administrative-split threshold.' },
    reviewIndication: 'minor',
    requiredReviewBody: 'Fairview Municipal Planning Commission',
    theoreticalLotCount: {
      value: overrides.theoretical === undefined ? 61 : overrides.theoretical,
      status: 'theoretical',
      calculation: '61.5 acres / 1 acre minimum = 61 lots',
      approvedYield: false,
      inputs: { acres: 61.5, minimumLotAcres: 1, minimumLotSizeStatedAs: 'one (1) acre' },
      caveats: overrides.caveats ?? [],
    },
    frontageConstraint: { status: 'unknown', maxLotsByFrontage: null, basis: 'unknown', detail: 'Road frontage has not been measured.' },
    obviousMaximumLotConstraint: { value: 61, from: 'Minimum lot size', basis: 'theoretical' },
    constraints: [],
    nextAuthoritativeDiligence: ['Measure the road frontage.'],
    limitations: [],
    generatedAt: NOW,
  } as PropertySubdivisionRead;
}

/** One use determination, the shape the nationwide engine's PART 5/6 evaluation produces. */
function use(overrides: Partial<LandUseDetermination['uses'][number]> & { structureType: LandUseDetermination['uses'][number]['structureType'] }): LandUseDetermination['uses'][number] {
  return {
    status: 'unverified',
    quality: 'unverified',
    citations: [],
    conditions: [],
    reasoning: 'No provision addressing this structure type was located in the adopted law LandOS read.',
    unresolvedReason: 'No provision establishing the legal status of this structure type was located in the adopted law LandOS read.',
    statePreemption: null,
    ...overrides,
  };
}

/** Runtime readers, all injected so a unit test needs no research run. */
function retained(overrides: Partial<ZoningSubdivisionRuntime> = {}): ZoningSubdivisionRuntime {
  return {
    readDetermination: () => ({ determination: determination(), determinedAt: NOW }),
    readAuthority: () => authority(),
    readZoning: () => zoning(),
    readRegulations: () => regulations(),
    readSubdivisionRead: () => subdivisionRead(),
    readJurisdictionDocuments: () => [],
    ...overrides,
  };
}

const facts = (result: CapabilityResult): ZoningSubdivisionFacts => result.facts as ZoningSubdivisionFacts;

async function run(
  deal: { id: number },
  card: { id: number },
  runtime: ZoningSubdivisionRuntime,
  parameters: JsonObject = {},
): Promise<CapabilityResult> {
  return invokeRuntimeCapability({
    capabilityId: ZONING_SUBDIVISION_CAPABILITY_ID,
    caller: { type: 'deal_card', ref: `deal:${deal.id}` },
    subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
    mode: 'refresh',
    parameters,
  }, runtime);
}

describe('Zoning & Subdivision Capability', () => {
  it('is registered on the runtime capability registry as its own business capability', () => {
    const ids = listRuntimeCapabilities().map((capability) => capability.id);
    expect(ids).toContain(ZONING_SUBDIVISION_CAPABILITY_ID);
    // And it is NOT the property-history capability: two separate registrations.
    expect(ids).toContain('property-development-history');
    expect(ZONING_SUBDIVISION_CAPABILITY.metadata.name).toBe('Zoning & Subdivision');
  });

  it('returns the jurisdiction rule package and its official sources for the canonical subject', async () => {
    const { deal, card } = canonicalSubject();
    const asked: number[] = [];
    const result = await run(deal, card, retained({
      readDetermination: (dealCardId) => { asked.push(dealCardId); return { determination: determination(), determinedAt: NOW }; },
    }));

    expect(result.status).toBe('SUCCEEDED');
    expect(result.subjectResolution).toBe('RESOLVED');
    expect(result.canonicalSubject).toMatchObject({ propertyCardId: card.id, dealCardId: deal.id, temporary: false });
    expect(asked).toEqual([deal.id]);

    const projected = facts(result);
    expect(projected.lane).toBe('retained_rules');
    expect(projected.outcome).toBe('rules_returned');
    expect(projected.jurisdiction.municipality).toBe('Fairview');
    expect(projected.jurisdiction.authorities.map((row) => row.role)).toEqual(['Zoning', 'Subdivision']);
    expect(projected.zoning.established).toBe(true);
    expect(projected.zoning.districtCode).toBe('R-20 POD');

    // Every rule is jurisdiction-scoped and keeps the section and URL that
    // carried it, so the operator never has to find the document again.
    const minimum = projected.rules.package.find((rule) => rule.key === 'minimum_lot_size')!;
    expect(minimum).toMatchObject({
      value: 'one (1) acre', section: 'Art. IV Sec. 4.2', sourceUrl: ORDINANCE_URL, scope: 'jurisdiction',
    });
    expect(projected.rules.package.find((rule) => rule.key === 'minimum_road_frontage')?.value).toBe('150 feet');
    expect(projected.rules.package.find((rule) => rule.key === 'dimensional_minimum_lot_area')?.value)
      .toContain('where public sewer is unavailable');

    // Authoritative URLs survive onto the result AND onto durable evidence.
    expect(projected.sources.map((source) => source.url)).toEqual(expect.arrayContaining([ORDINANCE_URL, ZONING_MAP_URL]));
    expect(result.evidence.map((item) => item.sourceUrl)).toEqual(expect.arrayContaining([ORDINANCE_URL, ZONING_MAP_URL]));
  });

  it('applies the rules deterministically rather than guessing the by-right lot count', async () => {
    const { deal, card } = canonicalSubject();

    // Established yield → SUPPORTED, and the number is the one the accepted
    // deterministic computation produced, with the constraints it applied.
    const supported = facts(await run(deal, card, retained()));
    expect(supported.subdivisionByRight.status).toBe('SUPPORTED');
    expect(supported.subdivisionByRight.maximumLots).toBe(61);
    expect(supported.subdivisionByRight.constraintsApplied).toEqual([
      { constraint: 'Minimum lot area', value: '1 acre', source: ORDINANCE_URL },
    ]);
    expect(supported.subdivisionByRight.calculation).toBe('61.5 acres / 1 acre minimum = 61 lots');
    // Arithmetic over an ordinance is never an entitlement.
    expect(supported.subdivisionByRight.approvedYield).toBe(false);

    // A provisional yield still carries the ADOPTED by-right lot cap. The
    // property read's ceiling is area-and-frontage arithmetic that knows
    // nothing about that cap, so it must never override it: an ordinance
    // capping a minor subdivision at 4 lots governs a 61-lot area ceiling.
    const conditional = facts(await run(deal, card, retained({
      readDetermination: () => ({
        determination: determination({
          legalYield: {
            status: 'provisional', maximumLots: 4, path: 'minor_subdivision',
            constraintsApplied: [{ constraint: 'Minor Subdivision lot cap', value: '4 lots', source: ORDINANCE_URL }],
            missingInputs: ['A verified minimum lot area'],
            reason: 'Legal maximum is provisional: computed from the constraints that are verified, while 1 required input(s) remain unresolved.',
          },
        }),
        determinedAt: NOW,
      }),
      // The read offers a 61-lot area ceiling beside it.
      readSubdivisionRead: () => subdivisionRead(),
    })));
    expect(conditional.subdivisionByRight.status).toBe('CONDITIONAL');
    expect(conditional.subdivisionByRight.maximumLots).toBe(4);
    expect(conditional.subdivisionByRight.constraintsApplied).toEqual([
      { constraint: 'Minor Subdivision lot cap', value: '4 lots', source: ORDINANCE_URL },
    ]);
    expect(conditional.subdivisionByRight.missingInputs).toContain('A verified minimum lot area');

    const insufficient = facts(await run(deal, card, retained({
      readDetermination: () => ({
        determination: determination({
          legalYield: {
            status: 'unresolved', maximumLots: null, path: null,
            constraintsApplied: [], missingInputs: ['A minimum lot size from the adopted subdivision regulations'],
            reason: 'The minimum lot size is not established.',
          },
        }),
        determinedAt: NOW,
      }),
      readSubdivisionRead: () => subdivisionRead({ theoretical: null }),
    })));
    expect(insufficient.subdivisionByRight.status).toBe('INSUFFICIENT_INFORMATION');
    expect(insufficient.subdivisionByRight.maximumLots).toBeNull();
    expect(insufficient.subdivisionByRight.missingInputs)
      .toContain('A minimum lot size from the adopted subdivision regulations');

    // A major subdivision is a discretionary path, so "by right" is answered
    // as NOT APPLICABLE and no lot count is reported beside it.
    const major = facts(await run(deal, card, retained({
      readSubdivisionRead: () => subdivisionRead({ path: 'major_subdivision' }),
    })));
    expect(major.subdivisionByRight.status).toBe('NOT_APPLICABLE');
    expect(major.subdivisionByRight.maximumLots).toBeNull();
    expect(major.subdivisionByRight.reason).toContain('discretionary review path');
  });

  it('scopes the rule package to the jurisdiction so another parcel in the same government reuses it', async () => {
    const first = canonicalSubject();
    const second = canonicalSubject({ apn: '042 145.00', address: 'Map 042 Parcel 145, Fairview, TN', title: 'Map 042 Parcel 145' });

    const retainedDocuments = [{ url: ORDINANCE_URL, label: 'Fairview Subdivision Regulations' }];
    const askedFor: Array<{ authorityName: string; level: string; state: string }> = [];
    const runtime = retained({
      readJurisdictionDocuments: (jurisdiction) => {
        askedFor.push({ authorityName: jurisdiction.authorityName, level: String(jurisdiction.level), state: jurisdiction.state });
        return retainedDocuments;
      },
    });

    const a = facts(await run(first.deal, first.card, runtime));
    const b = facts(await run(second.deal, second.card, runtime));

    // One key, one government — not one per parcel.
    expect(a.jurisdiction.rulePackageKey).toBe('tn:municipality:city of fairview');
    expect(b.jurisdiction.rulePackageKey).toBe(a.jurisdiction.rulePackageKey);
    expect(a.jurisdiction.rulePackageReused).toBe(true);
    expect(b.jurisdiction.rulePackageReused).toBe(true);
    expect(askedFor).toEqual([
      { authorityName: 'City of Fairview', level: 'municipality', state: 'TN' },
      { authorityName: 'City of Fairview', level: 'municipality', state: 'TN' },
    ]);

    // An unresolved or ambiguous authority names no government, so no package
    // key is issued and nothing can be filed against the wrong jurisdiction.
    const unresolved = facts(await run(first.deal, first.card, retained({
      readAuthority: () => authority({ determination: 'unresolved', name: null }),
    })));
    expect(unresolved.jurisdiction.rulePackageKey).toBeNull();
    expect(unresolved.jurisdiction.rulePackageReused).toBe(false);
  });

  it('runs the live research lane to locate the authoritative source when the rules are not already trusted', async () => {
    const { deal, card } = canonicalSubject();
    let researched = 0;
    let ruleSource: (() => { determination: LandUseDetermination; determinedAt: string } | null) = () => null;

    const runtime: ZoningSubdivisionRuntime = {
      // Storage carries nothing until the research lane has run: this is the
      // web-search → official-source → structured-rule path.
      readDetermination: () => ruleSource(),
      readAuthority: () => null,
      readZoning: () => null,
      readRegulations: () => null,
      readSubdivisionRead: () => null,
      readJurisdictionDocuments: () => [],
      runLandUseResearch: async (input): Promise<LandUseResearchOutcome> => {
        researched += 1;
        expect(input).toEqual({ propertyCardId: card.id, dealCardId: deal.id });
        ruleSource = () => ({ determination: determination(), determinedAt: NOW });
        return {
          ran: true,
          lanes: [{ lane: 'local_ordinance', status: 'complete', durationMs: 900 }],
          summary: 'Land-use research located the adopted subdivision regulations.',
        };
      },
    };

    const beforeResearch = facts(await run(deal, card, runtime, { lane: 'retained_rules', runId: 'a' }));
    expect(beforeResearch.outcome).toBe('not_available');
    expect(beforeResearch.rules.count).toBe(0);
    expect(researched).toBe(0);

    const afterResearch = facts(await run(deal, card, runtime, { lane: 'research', runId: 'b' }));
    expect(researched).toBe(1);
    expect(afterResearch.research?.ran).toBe(true);
    expect(afterResearch.outcome).toBe('rules_returned');
    expect(afterResearch.rules.package.find((rule) => rule.key === 'minimum_lot_size')?.sourceUrl).toBe(ORDINANCE_URL);
    expect(afterResearch.subdivisionByRight.status).toBe('SUPPORTED');
  });

  it('labels a classification that is not adopted zoning and never promotes a historical district', async () => {
    const { deal, card } = canonicalSubject();
    const projected = facts(await run(deal, card, retained({
      readDetermination: () => ({
        determination: determination({
          zoningCode: null,
          nonZoning: { code: 'AR', description: 'Agricultural / Residential assessment class', kind: 'assessment_classification', sourceUrl: 'https://gis.example.gov/parcel' },
        }),
        determinedAt: NOW,
      }),
      readZoning: () => zoning({
        established: false,
        districtCode: null,
        limitations: ['No adopted zoning map was located for this parcel.'],
        historicalReferences: [{
          kind: 'requested', value: 'SR (Suburban Residential)', asOf: '2024-12-10',
          sourceUrl: 'https://www.fairview-tn.org/planning/packet-2024-12.pdf', page: 4,
          quote: 'The applicant requests rezoning to SR.', neverEstablishesCurrentZoning: true,
        }],
      }),
    })));

    expect(projected.zoning.established).toBe(false);
    expect(projected.zoning.districtCode).toBeNull();
    expect(projected.zoning.nonZoningClassification).toMatchObject({ code: 'AR' });
    // The requested district is retained, labelled, and never the current one.
    expect(projected.zoning.historicalReferences).toHaveLength(1);
    expect(projected.zoning.historicalReferences[0]).toMatchObject({
      kind: 'requested', value: 'SR (Suburban Residential)', neverEstablishesCurrentZoning: true,
    });
    expect(projected.zoning.districtCode).not.toBe('SR (Suburban Residential)');
  });

  it('creates no lead, Deal Card or Property Card for a Tools subject LandOS does not hold', async () => {
    const result = await invokeRuntimeCapability({
      capabilityId: ZONING_SUBDIVISION_CAPABILITY_ID,
      caller: { type: 'tools', ref: 'tools:zoning-subdivision' },
      subject: { kind: 'raw_property', entity: 'TY_LAND_BIZ', rawInput: '412 Nowhere Road, Elsewhere County' },
      mode: 'refresh',
    }, {
      resolveSubject: async () => ({
        invocationId: 'stub',
        capability: { id: 'property-resolution', name: 'Property Resolution', contractVersion: '1.0', description: '' },
        status: 'SUCCEEDED',
        subjectResolution: 'RESOLVED',
        canonicalSubject: { kind: 'research_session', id: 'session-1', temporary: true },
        facts: { canonicalIdentity: { address: '412 Nowhere Road', county: 'Elsewhere', state: 'TN' } },
        evidence: [],
        warnings: [],
        missingInformation: [],
        timestamps: { startedAt: NOW, completedAt: NOW },
        execution: { mode: 'refresh', durationMs: 1, reused: false },
      }),
    });

    expect(result.status).toBe('NEEDS_INPUT');
    expect(result.warnings.join(' ')).toContain('Nothing was created.');
    expect(facts(result).outcome).toBe('not_available');
  });

  it('refuses caller-supplied zoning or subdivision assertions', () => {
    expect(() => ZONING_SUBDIVISION_CAPABILITY.validate({
      capabilityId: ZONING_SUBDIVISION_CAPABILITY_ID,
      caller: { type: 'tools' },
      subject: { kind: 'raw_property', entity: 'TY_LAND_BIZ', rawInput: 'x' },
      context: { zoning: 'R-20' },
    })).toThrow(/caller-supplied zoning or subdivision assertions/);

    expect(() => ZONING_SUBDIVISION_CAPABILITY.validate({
      capabilityId: ZONING_SUBDIVISION_CAPABILITY_ID,
      caller: { type: 'tools' },
      subject: { kind: 'raw_property', entity: 'TY_LAND_BIZ', rawInput: 'x' },
      parameters: { maximumLots: 40 },
    })).toThrow(/does not accept caller-supplied maximumLots/);
  });

  it('reports manufactured-home eligibility from the SAME zoning review, preserving the code\'s own terminology', async () => {
    const { deal, card } = canonicalSubject();

    // Nothing established for any manufactured/modular type: the honest
    // fallback, not a blocker.
    const unestablished = facts(await run(deal, card, retained()));
    expect(unestablished.manufacturedHousing.established).toBe(false);
    expect(unestablished.manufacturedHousing.overallStatement)
      .toBe('Manufactured-home eligibility was not established from the initial zoning review. Confirm with Planning/Zoning if this strategy becomes relevant.');
    expect(unestablished.manufacturedHousing.byType).toEqual([]);

    // A code that distinguishes single-wide (conditional) from double-wide
    // (by right, with objective conditions) is reported per type, never
    // collapsed into one answer.
    const mixed = facts(await run(deal, card, retained({
      readDetermination: () => ({
        determination: determination({
          uses: [
            use({
              structureType: 'manufactured_single_wide',
              status: 'conditional_or_special_approval_required',
              quality: 'verified_official',
              citations: [citation(ORDINANCE_URL, 'Fairview Zoning Ordinance', 'Sec. 14-508')],
              reasoning: 'Single-wide manufactured homes require special-use approval outside a manufactured-home park.',
              unresolvedReason: null,
            }),
            use({
              structureType: 'manufactured_double_wide',
              status: 'allowed_by_right_with_objective_conditions',
              quality: 'verified_official',
              citations: [citation(ORDINANCE_URL, 'Fairview Zoning Ordinance', 'Sec. 14-509')],
              reasoning: 'Double-wide manufactured homes are permitted subject to the objective standards below.',
              unresolvedReason: null,
              conditions: [{
                kind: 'permanent_affixation',
                requirement: 'Must be affixed to a permanent foundation.',
                citation: citation(ORDINANCE_URL, 'Fairview Zoning Ordinance', 'Sec. 14-509(a)'),
              }, {
                kind: 'hud_label',
                requirement: 'Must carry a HUD certification label.',
                citation: citation(ORDINANCE_URL, 'Fairview Zoning Ordinance', 'Sec. 14-509(b)'),
              }],
            }),
            use({ structureType: 'pre_hud_mobile_home', status: 'prohibited', quality: 'verified_official', citations: [citation(ORDINANCE_URL, 'Fairview Zoning Ordinance', 'Sec. 14-510')], reasoning: 'Pre-HUD mobile homes are prohibited.', unresolvedReason: null }),
          ],
        }),
        determinedAt: NOW,
      }),
    })));

    expect(mixed.manufacturedHousing.established).toBe(true);
    // Statuses differ across types, so there is no single overall status —
    // only the honest per-type breakdown.
    expect(mixed.manufacturedHousing.overallStatus).toBeNull();
    expect(mixed.manufacturedHousing.overallStatement).toContain('varies by type');
    const byType = mixed.manufacturedHousing.byType;
    expect(byType.find((row) => row.structureType === 'manufactured_single_wide')?.statusLabel).toBe('Special / conditional approval required');
    expect(byType.find((row) => row.structureType === 'manufactured_double_wide')?.statusLabel).toBe('Allowed by right with objective conditions');
    expect(byType.find((row) => row.structureType === 'pre_hud_mobile_home')?.statusLabel).toBe('Prohibited');
    // Terminology is preserved: single-wide, double-wide and pre-HUD mobile
    // home are three distinct rows, never merged into one "manufactured home".
    expect(byType.map((row) => row.structureType)).toEqual([
      'manufactured_single_wide', 'manufactured_double_wide', 'pre_hud_mobile_home',
    ]);
    const doubleWide = byType.find((row) => row.structureType === 'manufactured_double_wide')!;
    expect(doubleWide.conditions.map((c) => c.kind)).toEqual(['permanent_affixation', 'hud_label']);
    expect(doubleWide.conditions[0].requirement).toBe('Must be affixed to a permanent foundation.');
  });

  it('screens existing road frontage FIRST and raises private-road/private-drive only as secondary upside', async () => {
    const { deal, card } = canonicalSubject();
    const frontageStandard = {
      kind: 'minimum_road_frontage', originalTerm: 'Minimum road frontage', statedValue: '150 feet',
      numericValue: 150, unit: 'feet',
      citation: citation(ORDINANCE_URL, 'Fairview Subdivision Regulations', 'Art. IV Sec. 4.3'),
    } as LandUseDetermination['dimensionalStandards'][number];

    // Existing frontage (480 ft ÷ 150 ft minimum = 3 direct-frontage lots)
    // supports fewer lots than the apparent by-right maximum (61): frontage
    // IS the limiting factor here.
    const limiting = facts(await run(deal, card, retained({
      readDetermination: () => ({ determination: determination({ extraDimensionalStandards: [frontageStandard] }), determinedAt: NOW }),
      readSubjectFrontage: () => ({ valueFt: 480, source: 'LandPortal parcel record' }),
    })));
    expect(limiting.frontageScreening).toMatchObject({
      status: 'evaluated', subjectFrontageFt: 480, minimumFrontageFt: 150, directFrontageLots: 3, legalMaximumLots: 61, frontageIsLimiting: true,
    });
    expect(limiting.privateRoadScreening.applicable).toBe(true);

    // Existing frontage supports MORE lots than the legal maximum: frontage is
    // not the limiting factor, and no private-road section is raised.
    const supportive = facts(await run(deal, card, retained({
      readDetermination: () => ({ determination: determination({ extraDimensionalStandards: [frontageStandard] }), determinedAt: NOW }),
      readSubjectFrontage: () => ({ valueFt: 12000, source: 'LandPortal parcel record' }),
    })));
    expect(supportive.frontageScreening).toMatchObject({ directFrontageLots: 80, legalMaximumLots: 61, frontageIsLimiting: false });
    expect(supportive.privateRoadScreening.applicable).toBe(false);
    expect(supportive.privateRoadScreening.rules).toEqual([]);

    // Frontage IS the limiting factor, and the subdivision framework carries a
    // private-roads rule: it is surfaced as secondary upside.
    const withPrivateRoadRule = facts(await run(deal, card, retained({
      readDetermination: () => {
        const det = determination({ extraDimensionalStandards: [frontageStandard] });
        det.subdivision.privateRoads = evidenced(
          'Permitted to serve up to 4 lots with an approved maintenance agreement',
          [citation(ORDINANCE_URL, 'Fairview Subdivision Regulations', 'Art. IV Sec. 4.9')],
        );
        return { determination: det, determinedAt: NOW };
      },
      readSubjectFrontage: () => ({ valueFt: 480, source: 'LandPortal parcel record' }),
    })));
    expect(withPrivateRoadRule.privateRoadScreening.applicable).toBe(true);
    expect(withPrivateRoadRule.privateRoadScreening.rules.map((rule) => rule.key)).toContain('private_roads');
    expect(withPrivateRoadRule.privateRoadScreening.statement).toContain('private or shared access');

    // Frontage IS the limiting factor but no private-road provision was
    // readily established: the bounded county follow-up, not a search.
    const noPrivateRoadRule = facts(await run(deal, card, retained({
      readDetermination: () => ({ determination: determination({ extraDimensionalStandards: [frontageStandard] }), determinedAt: NOW }),
      readSubjectFrontage: () => ({ valueFt: 480, source: 'LandPortal parcel record' }),
    })));
    expect(noPrivateRoadRule.privateRoadScreening.rules).toEqual([]);
    expect(noPrivateRoadRule.privateRoadScreening.statement).toContain('Confirm with Planning/Zoning only if pursuing the higher-yield concept');

    // Minimum frontage not established: an honest abstention, not a guess.
    const unscreened = facts(await run(deal, card, retained({
      readSubjectFrontage: () => ({ valueFt: 480, source: 'LandPortal parcel record' }),
    })));
    expect(unscreened.frontageScreening.status).toBe('insufficient_information');
    expect(unscreened.frontageScreening.directFrontageLots).toBeNull();
    expect(unscreened.privateRoadScreening.applicable).toBe(false);
  });

  it('reports what current zoning allows and its material restrictions from the SAME uses determination', async () => {
    const { deal, card } = canonicalSubject();
    const projected = facts(await run(deal, card, retained({
      readDetermination: () => ({
        determination: determination({
          uses: [
            use({
              structureType: 'site_built_single_family', status: 'allowed_by_right', quality: 'verified_official',
              citations: [citation(ORDINANCE_URL, 'Fairview Zoning Ordinance', 'Sec. 14-401')],
              reasoning: 'Single-family detached dwellings are a permitted principal use in this district.', unresolvedReason: null,
            }),
            use({
              structureType: 'multifamily', status: 'prohibited', quality: 'verified_official',
              citations: [citation(ORDINANCE_URL, 'Fairview Zoning Ordinance', 'Sec. 14-403')],
              reasoning: 'Multifamily dwellings are not a permitted use in this district.', unresolvedReason: null,
            }),
            // Manufactured homes are excluded from this section — they get their own.
            use({ structureType: 'manufactured_single_wide', status: 'prohibited', quality: 'verified_official', citations: [citation(ORDINANCE_URL, 'x')], reasoning: 'Prohibited outside a manufactured-home park.', unresolvedReason: null }),
          ],
        }),
        determinedAt: NOW,
      }),
    })));

    expect(projected.zoningAllowances).toEqual([
      { label: 'Site-built single-family home', detail: 'Single-family detached dwellings are a permitted principal use in this district.', sourceUrl: ORDINANCE_URL },
    ]);
    expect(projected.zoningRestrictions).toEqual([
      { label: 'Multifamily', detail: 'Prohibited — Multifamily dwellings are not a permitted use in this district.', sourceUrl: ORDINANCE_URL },
    ]);
    // Manufactured homes never appear in the generic allow/restrict lists.
    expect(projected.zoningAllowances.some((row) => row.label.includes('Manufactured'))).toBe(false);
    expect(projected.zoningRestrictions.some((row) => row.label.includes('Manufactured'))).toBe(false);
  });
});
