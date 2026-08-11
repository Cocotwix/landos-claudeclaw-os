import { beforeEach, describe, expect, it } from 'vitest';
import { _initTestLandosDb, getLandosDb } from './db.js';
import {
  boundExcerpt,
  buildCitation,
  classifySource,
  dedupeCitations,
  detectRuleConflict,
  findProvisions,
  isGovernmentHost,
  isSecondaryOnlyHost,
  officialCodePublisher,
  reconcilePrimarySources,
  sectionForOffset,
} from './land-use-evidence.js';
import {
  assertEvidenceIntegrity,
  evidencedValue,
  isByRight,
  provisionalValue,
  unresolvedValue,
  useLegalStatusLabel,
  type DimensionalStandard,
  type LegalSourceCitation,
  type ParentTractFramework,
  type SubdivisionPath,
  type UseDetermination,
} from './land-use-types.js';
import {
  classifyAuthorityPattern,
  classifyCountySubdivision,
  classifyIncorporatedPlace,
  resolveAuthorityStack,
  type CensusGeography,
} from './land-use-authority.js';
import {
  classifyOrdinanceTopic,
  codifiedThroughFrom,
  detectCodePublisher,
  matchCodifierClient,
  normalizeJurisdictionKey,
  sectionFromTitle,
  type OrdinanceDocument,
} from './land-use-ordinance.js';
import {
  classifyStructureStatus,
  extractAccessRules,
  extractDimensionalStandards,
  extractLotCap,
  extractParentTract,
  extractPlatAndSurvey,
  extractSepticRules,
  extractSubdivisionPaths,
  extractZoningPresence,
  parseLegalNumber,
  parseMeasurement,
  searchProvisions,
} from './land-use-extract.js';
import {
  buildCarveoutConcepts,
  buildDiscoveryQuestions,
  buildScenarios,
  computeLegalYield,
  computePhysicalYield,
  findStandard,
  standardToAcres,
  statusFor,
} from './land-use-yield.js';
import { classifyRoadFromName, roadNameFromAddress } from './land-use-agency.js';
import { deriveOfficialSiteHosts, hostServesJurisdiction, pageServesState, resolveSubdivisionAuthority, resolveZoningAuthority } from './land-use-local.js';
import { assembleZoning, classificationFromHandoff } from './land-use-run.js';
import { buildLandUseView, emptyLandUseView, toLandUseView, toValueView } from './land-use-view.js';
import { getLandUseDetermination, listLandUseDeterminations, saveLandUseDetermination } from './land-use-store.js';
import {
  deriveStateAgencyHostCandidates,
  deriveStateLegalHostCandidates,
  stateLegalSourceFor,
  stateName,
  verifiesAsStateLegalSource,
  STATE_LEGAL_SOURCES,
} from './state-legal-sources.js';
import { frameworkHasLandDivisionBaseline, frameworkHasPreemption } from './land-use-state-framework.js';
import type { ZoningResearchHandoff } from './gis-platform-types.js';
import type { LandUseDetermination } from './land-use-types.js';

const NOW = '2026-08-07T12:00:00.000Z';

function doc(partial: Partial<OrdinanceDocument> & { text: string }): OrdinanceDocument {
  return {
    title: partial.title ?? 'Chapter 1',
    section: partial.section ?? null,
    text: partial.text,
    url: partial.url ?? 'https://library.municode.com/ga/example_county/codes/code_of_ordinances?nodeId=X',
    topic: partial.topic ?? 'zoning',
  };
}

function primaryCitation(url = 'https://www.example.gov/zoning-ordinance'): LegalSourceCitation {
  return buildCitation({ url, label: 'County zoning ordinance', excerpt: 'text', retrievedAt: NOW, tierHint: 'zoning_ordinance' });
}

/* ═══════════════════ 1. SOURCE AUTHORITY AND EVIDENCE ═══════════════════ */

describe('a secondary source may point at the law and may never state it', () => {
  it('classifies aggregators, mirrors and explainers as discovery-only', () => {
    for (const url of [
      'https://law.justia.com/codes/georgia/2022/title-36/',
      'https://www.zillow.com/homes/warthen-ga',
      'https://zoneomics.com/zoning/washington-county',
      'https://en.wikipedia.org/wiki/Zoning',
      'https://someone.blogspot.com/2020/subdivision-rules',
    ]) {
      expect(classifySource(url, 'zoning rules').tier, url).toBe('secondary_discovery_only');
      expect(isSecondaryOnlyHost(url), url).toBe(true);
    }
  });

  it('refuses to establish a value when only secondary sources back it', () => {
    const secondary = buildCitation({ url: 'https://law.justia.com/codes/georgia/', label: 'Justia mirror', excerpt: 'four lots', retrievedAt: NOW });
    const value = evidencedValue(4, [secondary]);
    expect(value.value).toBeNull();
    expect(value.quality).toBe('unverified');
    expect(value.unresolvedReason).toMatch(/primary source is required/i);
  });

  it('accepts a government host and a code publisher of record as primary', () => {
    expect(isGovernmentHost('https://www.washingtoncountyga.gov/158/Standard-Zoning')).toBe(true);
    expect(officialCodePublisher('https://library.municode.com/ga/washington_county')).toMatch(/Municode/);
    expect(classifySource('https://library.municode.com/ga/washington_county/codes/code_of_ordinances?nodeId=SUBDIVISION', 'Subdivision regulations').tier)
      .toBe('subdivision_ordinance');
  });

  it('rises to multiple-official only when the primaries are genuinely different sources', () => {
    const one = primaryCitation('https://www.example.gov/a');
    const two = primaryCitation('https://www.example.gov/b');
    expect(evidencedValue('1 acre', [one]).quality).toBe('verified_official');
    expect(evidencedValue('1 acre', [one, two]).quality).toBe('verified_multiple_official');
    expect(evidencedValue('1 acre', [one, { ...one }]).quality).toBe('verified_official');
  });

  it('demotes any value that reaches the panel without a primary source behind it', () => {
    const smuggled = { value: '5 acres', quality: 'verified_official' as const, citations: [], unresolvedReason: null, conflict: null };
    const checked = assertEvidenceIntegrity(smuggled);
    expect(checked.value).toBeNull();
    expect(checked.quality).toBe('unverified');
  });

  it('keeps a state legal source registry that only lists hosts a live probe reached', () => {
    expect(STATE_LEGAL_SOURCES.length).toBeGreaterThan(25);
    for (const entry of STATE_LEGAL_SOURCES) {
      expect(entry.reachedLive, entry.state).toBe(true);
      expect(entry.origin, entry.state).toMatch(/^https:\/\//);
      expect(isGovernmentHost(entry.origin), entry.state).toBe(true);
    }
  });
});

/* ═══════════════════════ 2. RULE CONFLICT ═══════════════════════════════ */

describe('two official sources that disagree produce a conflict, never a winner', () => {
  const a = { citation: primaryCitation('https://www.example.gov/code-a'), normalizedValue: '1 acre', says: 'Minimum lot area shall be one acre.', value: '1 acre' };
  const b = { citation: primaryCitation('https://www.example.gov/code-b'), normalizedValue: '2 acres', says: 'Minimum lot area shall be two acres.', value: '2 acres' };

  it('detects disagreement between primary sources', () => {
    const conflict = detectRuleConflict('Minimum lot area', [a, b]);
    expect(conflict).not.toBeNull();
    expect(conflict!.sides).toHaveLength(2);
  });

  it('does not treat a secondary source disagreeing with a primary one as a conflict', () => {
    const secondary = {
      citation: buildCitation({ url: 'https://www.zillow.com/x', label: 'listing', excerpt: 'x', retrievedAt: NOW }),
      normalizedValue: '5 acres', says: 'Five acre minimum.', value: '5 acres',
    };
    expect(detectRuleConflict('Minimum lot area', [a, secondary])).toBeNull();
  });

  it('returns no value at all when primaries conflict', () => {
    const reconciled = reconcilePrimarySources('Minimum lot area', [a, b], 'nothing found');
    expect(reconciled.value).toBeNull();
    expect(reconciled.quality).toBe('conflicting_official');
    expect(reconciled.conflict).not.toBeNull();
  });

  it('agrees cleanly when the primaries state the same thing', () => {
    const reconciled = reconcilePrimarySources('Minimum lot area', [a, { ...a, citation: primaryCitation('https://www.example.gov/code-c') }], 'nothing found');
    expect(reconciled.value).toBe('1 acre');
    expect(reconciled.quality).toBe('verified_multiple_official');
  });
});

/* ═══════════════════════ 3. AUTHORITY RESOLUTION ═══════════════════════ */

describe('the local unit is a government, not a statistical area', () => {
  it('treats a census county division as governing nothing', () => {
    const ccd = classifyCountySubdivision('Warthen CCD');
    expect(ccd.isGovernment).toBe(false);
    expect(classifyCountySubdivision('Sandersville CCD').isGovernment).toBe(false);
  });

  it('treats a township and a town as real minor civil divisions', () => {
    expect(classifyCountySubdivision('Whitewater township')).toMatchObject({ isGovernment: true, unitType: 'township' });
    expect(classifyCountySubdivision('Sterling town')).toMatchObject({ isGovernment: true, unitType: 'town' });
  });

  it('classifies incorporated places by their own unit word', () => {
    expect(classifyIncorporatedPlace('Sandersville city').unitType).toBe('city');
    expect(classifyIncorporatedPlace('Elk Rapids village').unitType).toBe('village');
  });
});

describe('the authority stack is resolved, never assumed from county containment', () => {
  const base = {
    city: null as string | null,
    jurisdictionClues: [],
    gisIncorporatedStatus: null,
    gisLocalGovernment: null,
    gisSourceUrl: null,
    stateFrameworkPresent: false,
    statePreemptionPresent: false,
    now: NOW,
  };

  const geography = (over: Partial<CensusGeography>): CensusGeography => ({
    matchedAddress: '3723 STATE RTE 102, WARTHEN, GA, 31094',
    state: 'Georgia', county: 'Washington County',
    countySubdivision: 'Warthen CCD', incorporatedPlace: null,
    latitude: 33.14, longitude: -82.77,
    sourceUrl: 'https://geocoding.geo.census.gov/geocoder/geographies/address?x=1',
    ...over,
  });

  it('makes the county the local unit when the county subdivision is a CCD', () => {
    const stack = resolveAuthorityStack({ ...base, county: 'Washington County', state: 'GA', geography: geography({}) });
    expect(stack.localUnit.name.value).toBe('Washington County');
    expect(stack.localUnit.unitType).toBe('unincorporated_county');
    expect(stack.localUnit.name.citations[0].excerpt).toMatch(/statistical division rather than a unit of government/i);
    expect(stack.incorporation.value).toBe('unincorporated');
  });

  it('makes a township the local unit when a real minor civil division contains the parcel', () => {
    const stack = resolveAuthorityStack({
      ...base, county: 'Grand Traverse County', state: 'MI',
      geography: geography({ state: 'Michigan', county: 'Grand Traverse County', countySubdivision: 'Whitewater township' }),
    });
    expect(stack.localUnit.name.value).toBe('Whitewater township');
    expect(stack.localUnit.unitType).toBe('township');
  });

  it('makes an incorporated place the local unit and marks the parcel incorporated', () => {
    const stack = resolveAuthorityStack({
      ...base, county: 'Washington County', state: 'GA',
      geography: geography({ incorporatedPlace: 'Sandersville city', countySubdivision: 'Sandersville CCD' }),
    });
    expect(stack.localUnit.name.value).toBe('Sandersville city');
    expect(stack.incorporation.value).toBe('incorporated');
  });

  it('leaves the zoning authority unresolved when nothing established it', () => {
    const stack = resolveAuthorityStack({ ...base, county: 'Washington County', state: 'GA', geography: geography({}) });
    expect(stack.zoningAuthority.name.value).toBeNull();
    expect(stack.zoningAuthority.name.unresolvedReason).toMatch(/not inferred from county containment/i);
    expect(stack.subdivisionAuthority.name.value).toBeNull();
    expect(stack.pattern).toBe('unresolved');
  });

  it('records a verified no-zoning finding as the zoning authority answer', () => {
    const stack = resolveAuthorityStack({
      ...base, county: 'Washington County', state: 'GA', geography: geography({}),
      zoningAuthorityFinding: {
        body: 'Washington County', unitType: 'unincorporated_county',
        citations: [buildCitation({ url: 'https://www.washingtoncountyga.gov/158/Standard-Zoning', label: 'Standard Zoning', excerpt: 'Washington County has no zoning regulations in the unincorporated areas of the county', retrievedAt: NOW })],
        noConventionalZoning: true,
      },
    });
    expect(stack.pattern).toBe('no_zoning_other_controls_apply');
    expect(stack.zoningAuthority.name.value).toMatch(/no conventional zoning/i);
    expect(stack.patternExplanation).toMatch(/Subdivision, access, septic and building rules still do/i);
  });
});

describe('authority patterns A-G are classified from resolved facts', () => {
  const facts = {
    incorporated: 'unincorporated' as const,
    localUnitIsGovernmentBelowCounty: false,
    stateFrameworkPresent: false,
    statePreemptionPresent: false,
    noConventionalZoning: false,
    zoningResolved: true,
    zoningBodyDiffersFromSubdivisionBody: false,
  };

  it('A: a state framework with a sub-county government administering it', () => {
    expect(classifyAuthorityPattern({ ...facts, stateFrameworkPresent: true, localUnitIsGovernmentBelowCounty: true }))
      .toBe('state_framework_local_administration');
  });
  it('B: county control in unincorporated territory', () => {
    expect(classifyAuthorityPattern(facts)).toBe('county_unincorporated_control');
  });
  it('C: municipal zoning', () => {
    expect(classifyAuthorityPattern({ ...facts, incorporated: 'incorporated' })).toBe('municipal_zoning_split_control');
  });
  it('D: state preemption', () => {
    expect(classifyAuthorityPattern({ ...facts, statePreemptionPresent: true })).toBe('state_preemption_present');
  });
  it('F: no conventional zoning outranks everything else', () => {
    expect(classifyAuthorityPattern({ ...facts, noConventionalZoning: true, statePreemptionPresent: true }))
      .toBe('no_zoning_other_controls_apply');
  });
  it('G: overlapping authorities when zoning and subdivision bodies differ', () => {
    expect(classifyAuthorityPattern({ ...facts, zoningBodyDiffersFromSubdivisionBody: true })).toBe('overlapping_authorities');
  });
  it('unresolved when the zoning authority was never established', () => {
    expect(classifyAuthorityPattern({ ...facts, zoningResolved: false })).toBe('unresolved');
  });
});

/* ══════════════════════ 4. STATE FRAMEWORK LOOKUP ══════════════════════ */

describe('state legal sources are verified, not guessed', () => {
  it('derives candidate hosts without naming a state in code', () => {
    const candidates = deriveStateLegalHostCandidates('GA');
    expect(candidates).toContain('www.legis.ga.gov');
    expect(candidates.length).toBeGreaterThan(8);
    expect(deriveStateLegalHostCandidates('')).toEqual([]);
  });

  it('requires a page to name the state AND read as a legislative publication', () => {
    expect(verifiesAsStateLegalSource('GA', 'Georgia General Assembly official code')).toBe(true);
    // A reachable government page for the WRONG state must not verify. The live
    // sweep for this sprint hit exactly this: a formula host answered with
    // another state's legislature.
    expect(verifiesAsStateLegalSource('GA', 'The 194th General Court of the Commonwealth of Massachusetts')).toBe(false);
    // A state capitol commission page names the state but is not the legislature.
    expect(verifiesAsStateLegalSource('MO', 'Missouri State Capitol Commission — building tours')).toBe(false);
  });

  it('knows the registered source for the acceptance states', () => {
    expect(stateLegalSourceFor('GA')?.origin).toBe('https://www.legis.ga.gov');
    expect(stateLegalSourceFor('MI')?.origin).toBe('https://www.legislature.mi.gov');
    // New York's official host answers a plain request with an edge challenge,
    // so the lane must know to use a browser transport rather than read the
    // challenge page as an absent statute.
    expect(stateLegalSourceFor('NY')?.transport).toBe('requires_browser');
    expect(stateName('NY')).toBe('New York');
  });

  it('derives agency host candidates for the other statewide authorities', () => {
    expect(deriveStateAgencyHostCandidates('GA', 'dot')).toContain('www.dot.ga.gov');
    expect(deriveStateAgencyHostCandidates('GA', 'onsite_wastewater').length).toBeGreaterThan(3);
  });

  it('reports whether a located framework carries a baseline or a preemption', () => {
    const citation = buildCitation({ url: 'https://www.legislature.mi.gov/mcl-288', label: 'Land Division Act', excerpt: 'x', retrievedAt: NOW, tierHint: 'state_statute' });
    const framework = {
      state: 'MI', status: 'present' as const,
      provisions: [{ kind: 'land_division_act' as const, summary: 's', citation, materialToSubject: true, materiality: 'm' }],
      localAuthorityRetained: unresolvedValue<string>('x'), sourcesSearched: [], searchedAt: NOW,
    };
    expect(frameworkHasLandDivisionBaseline(framework)).toBe(true);
    expect(frameworkHasPreemption(framework)).toBe(false);
  });
});

/* ═══════════════════ 5. ORDINANCE LOCATION AND READING ═════════════════ */

describe('a county code is never confused with a same-named city code', () => {
  const clients = [{ name: 'Washington' }, { name: 'Washington County' }, { name: 'Whitewater Township' }];

  it('matches a county request to the county client only', () => {
    expect(matchCodifierClient(clients, 'Washington County', 'county')?.name).toBe('Washington County');
    expect(matchCodifierClient(clients, 'Washington', 'county')?.name).toBe('Washington County');
  });

  it('never returns a county client for a municipality request', () => {
    expect(matchCodifierClient(clients, 'Washington', 'municipality')?.name).toBe('Washington');
  });

  it('matches a township request to the township client', () => {
    expect(matchCodifierClient(clients, 'Whitewater township', 'township')?.name).toBe('Whitewater Township');
    expect(matchCodifierClient(clients, 'Whitewater township', 'municipality')).toBeNull();
  });

  it('returns null rather than a near miss', () => {
    expect(matchCodifierClient(clients, 'Cayuga County', 'county')).toBeNull();
    expect(normalizeJurisdictionKey('Washington County')).toBe('washington county');
  });
});

describe('code publishers and chapter topics are recognized generically', () => {
  it('detects the recurring codifiers', () => {
    expect(detectCodePublisher('https://library.municode.com/ga/x')).toBe('municode');
    expect(detectCodePublisher('https://ecode360.com/ST1234')).toBe('ecode360');
    expect(detectCodePublisher('https://codelibrary.amlegal.com/codes/x')).toBe('american_legal');
    expect(detectCodePublisher('https://www.county.gov/subdivision.pdf')).toBe('government_pdf');
  });

  it('classifies chapter headings by subject', () => {
    expect(classifyOrdinanceTopic('Chapter 22 - MANUFACTURED HOUSING')).toBe('manufactured_housing');
    expect(classifyOrdinanceTopic('Chapter 8 - BUILDINGS AND DEVELOPMENT')).toBe('buildings_and_development');
    expect(classifyOrdinanceTopic('Chapter 90 - ZONING')).toBe('zoning');
    expect(classifyOrdinanceTopic('SUBDIVISION REGULATIONS')).toBe('subdivision');
    expect(classifyOrdinanceTopic('Chapter 4 - ALCOHOLIC BEVERAGES')).toBe('general');
  });

  it('reads the codified-through date and the section from a title', () => {
    expect(codifiedThroughFrom('THE CODE\r\nof\r\nWASHINGTON COUNTY, GEORGIA\r\n\r\nCodified through\r\nOrdinance of 2025-03, adopted September 11, 2025.\r\n(Supp. No. 5)'))
      .toMatch(/Codified through Ordinance of 2025-03, adopted September 11, 2025/);
    expect(sectionFromTitle('Sec. 22-19. - Definitions.')).toBe('22-19');
    expect(sectionFromTitle('Chapter 8 - BUILDINGS AND DEVELOPMENT')).toBe('8');
  });

  it('only trusts a government host that actually names the jurisdiction', () => {
    expect(hostServesJurisdiction('https://www.washingtoncountyga.gov/158/Standard-Zoning', 'Washington County', 'GA')).toBe(true);
    expect(hostServesJurisdiction('https://www.cayugacounty.us/', 'Washington County', 'GA')).toBe(false);
    expect(hostServesJurisdiction('https://www.zillow.com/washington-county', 'Washington County', 'GA')).toBe(false);
  });
});

/* ═════════════════════ 6. ZONING vs CLASSIFICATION ═════════════════════ */

describe('an assessment classification is never presented as zoning', () => {
  const handoff = (over: Partial<ZoningResearchHandoff>): ZoningResearchHandoff => ({
    handoffVersion: 1,
    subject: { dealCardId: 81, parcelId: '055689 10.00-1-64.22', address: '1487 Onionville Rd', county: 'Cayuga', state: 'NY', acres: 11.46 },
    officialParcelSourceUrl: 'https://ccgis.cayugacounty.us/arcgis/rest/services/Parcels/MapServer/0',
    platformFamily: 'arcgis', platformVariant: null, geometry: null, jurisdictionClues: [],
    zoningLayer: null, zoningCode: 'AR', zoningDescription: 'Agricultural Residential',
    zoningAuthority: 'assessment_classification', zoningSourceDisclaimer: null,
    planningZoningUrls: [], sourceConfidence: 'high', parcelMatchStatus: 'verified',
    unresolvedIdentityIssue: null, failureStates: [], preparedAt: NOW,
    ...over,
  });

  it('maps the parcel lane classification forward without re-deciding it', () => {
    expect(classificationFromHandoff('official_zoning_layer')).toBe('adopted_zoning');
    expect(classificationFromHandoff('assessment_classification')).toBe('assessment_classification');
    expect(classificationFromHandoff(null)).toBe('unclassified');
  });

  it('keeps deal 81 style AR out of the zoning slot and labels what it is', () => {
    const zoning = assembleZoning({ handoff: handoff({}), zoningAuthorityBody: null, noConventionalZoning: false, noZoningCitations: [], now: NOW });
    expect(zoning.presence).toBe('zoning_unverified');
    expect(zoning.code.value).toBeNull();
    expect(zoning.classificationKind).toBe('assessment_classification');
    // The evidence is retained rather than discarded — it is real, just not zoning.
    expect(zoning.nonZoningClassification).toMatchObject({ code: 'AR', kind: 'assessment_classification' });
  });

  it('accepts a code from a real official zoning layer as adopted zoning', () => {
    const zoning = assembleZoning({
      handoff: handoff({ zoningAuthority: 'official_zoning_layer', zoningCode: 'R-1' }),
      zoningAuthorityBody: 'Sterling town', noConventionalZoning: false, noZoningCitations: [], now: NOW,
    });
    expect(zoning.presence).toBe('zoning_established');
    expect(zoning.code.value).toBe('R-1');
    expect(zoning.code.quality).toBe('verified_official');
    expect(zoning.nonZoningClassification).toBeNull();
  });

  it('reports no conventional zoning without ever promoting a stray code', () => {
    const zoning = assembleZoning({
      handoff: handoff({ zoningCode: 'A1', zoningAuthority: 'assessment_classification' }),
      zoningAuthorityBody: 'Washington County', noConventionalZoning: true, noZoningCitations: [], now: NOW,
    });
    expect(zoning.presence).toBe('no_conventional_zoning');
    expect(zoning.code.value).toBeNull();
    expect(zoning.nonZoningClassification?.code).toBe('A1');
  });
});

describe('no-zoning is an affirmative statement, not a failed search', () => {
  it('recognizes a jurisdiction saying it does not zone', () => {
    const found = extractZoningPresence([doc({
      title: 'Standard Zoning',
      text: 'Washington County has no zoning regulations in the unincorporated areas of the county, view the No Zoning regulations letter. However, there are building regulations regarding areas subject to flooding.',
    })]);
    expect(found.statesNoZoning).toBe(true);
  });

  it('does not read an absent zoning chapter as a statement of no zoning', () => {
    const found = extractZoningPresence([doc({ title: 'Chapter 6 - ANIMALS', text: 'It shall be unlawful to permit livestock to run at large.' })]);
    expect(found.statesNoZoning).toBe(false);
    expect(found.statesZoning).toBe(false);
  });

  it('recognizes a jurisdiction that does zone', () => {
    const found = extractZoningPresence([doc({
      title: 'Chapter 90 - ZONING',
      text: 'The following zoning districts are hereby established for the town: R-1 Residential, A Agricultural, C Commercial.',
    })]);
    expect(found.statesZoning).toBe(true);
  });

  it('resolves the county as not zoning only from its own affirmative statement', () => {
    const finding = resolveZoningAuthority({
      localUnitName: 'Washington County', localUnitType: 'unincorporated_county', localUnitIsGovernment: false,
      countyName: 'Washington County', localUnitDocuments: [], countyDocuments: [],
      siteDocuments: [doc({ title: 'Standard Zoning', url: 'https://www.washingtoncountyga.gov/158/Standard-Zoning', text: 'Washington County has no zoning regulations in the unincorporated areas of the county.' })],
      now: NOW,
    });
    expect(finding?.noConventionalZoning).toBe(true);
    expect(finding?.citations[0].url).toMatch(/washingtoncountyga\.gov/);
  });

  it('prefers the local unit over the county when the local unit is the one that zones', () => {
    const finding = resolveZoningAuthority({
      localUnitName: 'Sterling town', localUnitType: 'town', localUnitIsGovernment: true,
      localUnitDocuments: [doc({ title: 'Zoning', topic: 'zoning', text: 'The following zoning districts are hereby established for the Town of Sterling.' })],
      countyDocuments: [doc({ title: 'County Zoning', topic: 'zoning', text: 'The following zoning districts are hereby established for the county.' })],
      countyName: 'Cayuga County', siteDocuments: [], now: NOW,
    });
    expect(finding?.body).toBe('Sterling town');
    expect(finding?.unitType).toBe('town');
  });

  it('accepts a jurisdiction own zoning apparatus as evidence that it zones', () => {
    // A township's ordinance is routinely a linked PDF while its site plainly
    // shows the apparatus. That answers WHO zones; it must not answer which
    // district applies to the parcel.
    const finding = resolveZoningAuthority({
      localUnitName: 'Whitewater township', localUnitType: 'township', localUnitIsGovernment: true,
      localUnitDocuments: [doc({ title: 'Zoning Administrator', topic: 'zoning', text: 'The Zoning Administrator issues zoning permits and staffs the Zoning Board of Appeals for the township.' })],
      countyDocuments: [], countyName: 'Grand Traverse County', siteDocuments: [], now: NOW,
    });
    expect(finding?.body).toBe('Whitewater township');
    expect(finding?.noConventionalZoning).toBe(false);
  });

  it('never lets zoning apparatus wording override an affirmative no-zoning statement', () => {
    const finding = extractZoningPresence([doc({
      title: 'Standard Zoning',
      text: 'Washington County has no zoning regulations in the unincorporated areas of the county. Contact the zoning department for building permits.',
    })]);
    expect(finding.statesNoZoning).toBe(true);
    expect(finding.statesZoning).toBe(false);
  });

  it('rejects an identically named jurisdiction in another state', () => {
    // Live probe: the township host formula resolved to a same-named township
    // in Ohio, whose page names the township correctly.
    expect(pageServesState('Home | Whitewater Township | Cleves, OH', 'MI')).toBe(false);
    expect(pageServesState('Whitewater Township | Williamsburg, Michigan', 'MI')).toBe(true);
    expect(pageServesState('Whitewater Township, MI 49690', 'MI')).toBe(true);
    // A page that identifies no state is not accepted on that basis alone.
    expect(pageServesState('Whitewater Township', 'MI')).toBe(false);
  });

  it('returns null rather than guessing when nothing established who zones', () => {
    expect(resolveZoningAuthority({
      localUnitName: null, localUnitType: 'unknown', localUnitIsGovernment: false,
      countyName: 'Some County', localUnitDocuments: [], countyDocuments: [], siteDocuments: [], now: NOW,
    })).toBeNull();
  });

  it('finds the subdivision authority in a development chapter that is not titled subdivision', () => {
    const finding = resolveSubdivisionAuthority({
      localUnitName: null, localUnitType: 'unincorporated_county', localUnitIsGovernment: false,
      countyName: 'Washington County', localUnitDocuments: [],
      countyDocuments: [doc({ title: 'Chapter 8 - BUILDINGS AND DEVELOPMENT', topic: 'buildings_and_development', text: 'Any division of land into two or more lots shall require a plat prepared by a registered land surveyor.' })],
      now: NOW,
    });
    expect(finding?.body).toBe('Washington County');
  });
});

/* ═══════════════════ 7. NUMBER AND MEASUREMENT PARSING ═════════════════ */

describe('legal prose numbers are read the way ordinances write them', () => {
  it('prefers the parenthesized digit that drafting convention makes authoritative', () => {
    expect(parseLegalNumber('not more than four (4) lots')).toBe(4);
    expect(parseLegalNumber('four lots')).toBe(4);
    expect(parseLegalNumber('4 lots')).toBe(4);
    expect(parseLegalNumber('no numbers here')).toBeNull();
  });

  it('reads acres, square feet, linear feet and percentages with their units', () => {
    expect(parseMeasurement('minimum lot area of one (1) acre')).toMatchObject({ numeric: 1, unit: 'acres' });
    expect(parseMeasurement('not less than 43,560 square feet')).toMatchObject({ numeric: 43560, unit: 'square_feet' });
    expect(parseMeasurement('a minimum of 100 feet of road frontage')).toMatchObject({ numeric: 100, unit: 'feet' });
    expect(parseMeasurement('lot coverage shall not exceed 35 percent')).toMatchObject({ numeric: 35, unit: 'percent' });
    expect(parseMeasurement('as determined by the health department')).toBeNull();
  });

  it('only reads a lot cap when a limiting word ties a number to lots', () => {
    expect(extractLotCap('a minor subdivision creating not more than four (4) lots')).toBe(4);
    expect(extractLotCap('three or fewer lots')).toBe(3);
    // A bare section number next to the word "lots" is not a cap.
    expect(extractLotCap('See Section 4 for lots and blocks')).toBeNull();
  });
});

/* ══════════════════════ 8. RULE EXTRACTION ═════════════════════════════ */

const SUBDIVISION_TEXT = `
Sec. 8-40. - Definitions.
Minor subdivision means the division of a tract of land into not more than four (4) lots
fronting on an existing public road and requiring no new street, which may be approved
administratively by the county zoning administrator upon submission of a final plat prepared
by a registered land surveyor and recorded in the office of the clerk of superior court.
Major subdivision means any subdivision other than a minor subdivision, which requires
preliminary plat review and approval by the planning commission.
Sec. 8-41. - Standards.
Minimum lot area for lots served by an on-site sewage management system shall be one (1) acre.
Minimum lot width shall be one hundred (100) feet. Each lot shall have a minimum road frontage
of one hundred (100) feet on a public road. Flag lots are prohibited. Private roads shall not be
permitted unless constructed to county standards. Shared driveways serving no more than two lots
may be approved. The creation of a new public street shall require major subdivision review.
Sec. 8-42. - Parent tract.
No parent tract may be divided into more than four lots within any five-year period. The remainder
parcel shall be shown on the plat. Approval by the county health department is required for each
lot before a permit will be issued.
`;

describe('subdivision procedures are extracted with their by-right status', () => {
  const paths = extractSubdivisionPaths([doc({ title: 'Chapter 8', topic: 'subdivision', text: SUBDIVISION_TEXT })], NOW, 'Supp. No. 5');

  it('finds the minor subdivision procedure and its stated cap', () => {
    const minor = paths.find((p) => p.kind === 'minor_subdivision');
    expect(minor).toBeDefined();
    expect(minor!.maximumLots.value).toBe(4);
    expect(minor!.maximumLots.quality).toMatch(/verified/);
  });

  it('treats a procedure with only objective approvals as by right', () => {
    const minor = paths.find((p) => p.kind === 'minor_subdivision')!;
    expect(minor.isByRight).toBe(true);
    expect(minor.objectiveApprovals.join(' ')).toMatch(/plat|survey|record/);
    expect(minor.discretionaryApprovals).toEqual([]);
  });

  it('never treats a major subdivision as by right', () => {
    const major = paths.find((p) => p.kind === 'major_subdivision');
    expect(major?.isByRight).toBe(false);
  });

  it('reads the administrative review path from the ordinance', () => {
    const minor = paths.find((p) => p.kind === 'minor_subdivision')!;
    expect(minor.reviewPath).toMatch(/administrative|combined/);
  });

  it('leaves the cap unresolved when the ordinance states none', () => {
    const [only] = extractSubdivisionPaths([doc({ topic: 'subdivision', text: 'Minor subdivision means a division of land that the administrator may approve.' })], NOW);
    expect(only.maximumLots.value).toBeNull();
    expect(only.maximumLots.unresolvedReason).toMatch(/does not state a lot cap/i);
  });
});

describe('dimensional standards keep both the normalized kind and the ordinance term', () => {
  const standards = extractDimensionalStandards([doc({ title: 'Chapter 8', topic: 'subdivision', text: SUBDIVISION_TEXT })], NOW, 'Supp. No. 5');

  it('extracts lot area, width and road frontage with parsed values', () => {
    expect(findStandard(standards, 'minimum_lot_area')?.numericValue).toBe(1);
    expect(findStandard(standards, 'minimum_lot_area')?.unit).toBe('acres');
    expect(findStandard(standards, 'minimum_lot_width')?.numericValue).toBe(100);
    expect(findStandard(standards, 'minimum_road_frontage')?.numericValue).toBe(100);
  });

  it('flags a standard that carries a condition rather than hiding it', () => {
    const area = findStandard(standards, 'minimum_lot_area')!;
    expect(area.citation.url).toMatch(/municode|gov/);
    expect(area.citation.effectiveDate).toBe('Supp. No. 5');
  });

  it('converts a standard to acres only when the unit is convertible', () => {
    expect(standardToAcres({ numericValue: 43560, unit: 'square_feet' } as DimensionalStandard)).toBeCloseTo(1);
    expect(standardToAcres({ numericValue: 100, unit: 'feet' } as DimensionalStandard)).toBeNull();
    expect(standardToAcres(undefined)).toBeNull();
  });
});

describe('frontage, flag lot, shared drive and private road rules are extracted', () => {
  const rules = extractAccessRules([doc({ title: 'Chapter 8', topic: 'subdivision', text: SUBDIVISION_TEXT })]);
  it('finds each access rule the ordinance states', () => {
    expect(rules.frontage.length).toBeGreaterThan(0);
    expect(rules.flagLots.length).toBeGreaterThan(0);
    expect(rules.sharedDrives.length).toBeGreaterThan(0);
    expect(rules.privateRoads.length).toBeGreaterThan(0);
    expect(rules.newRoadTrigger.length).toBeGreaterThan(0);
    expect(rules.publicRoadRequired.length).toBeGreaterThan(0);
  });
});

describe('parent tract and lookback rules are detected as a blocking dependency', () => {
  it('detects the parent tract rule and its lookback period', () => {
    const extraction = extractParentTract([doc({ topic: 'subdivision', text: SUBDIVISION_TEXT })]);
    expect(extraction.applies).toBe(true);
    expect(extraction.parentDefinitionClause).toMatch(/parent tract/i);
    expect(extraction.remainderClause).toMatch(/remainder/i);
  });

  it('reports no parent tract rule when the ordinance has none', () => {
    const extraction = extractParentTract([doc({ topic: 'subdivision', text: 'Lots shall be at least one acre.' })]);
    expect(extraction.applies).toBe(false);
  });
});

describe('plat, survey and health provisions are extracted', () => {
  const documents = [doc({ topic: 'subdivision', text: SUBDIVISION_TEXT })];
  it('finds survey, plat and recording requirements', () => {
    const platSurvey = extractPlatAndSurvey(documents);
    expect(platSurvey.survey.length).toBeGreaterThan(0);
    expect(platSurvey.finalPlat.length).toBeGreaterThan(0);
    expect(platSurvey.preliminaryPlat.length).toBeGreaterThan(0);
    expect(platSurvey.recording.length).toBeGreaterThan(0);
  });
  it('finds the health-department review requirement', () => {
    const septic = extractSepticRules(documents);
    expect(septic.divisionReview.length + septic.perLotApproval.length).toBeGreaterThan(0);
  });
});

/* ═══════════════════ 9. MANUFACTURED HOUSING STATUS ════════════════════ */

describe('each structure type is judged separately and silence is never permission', () => {
  const ZONED = doc({
    title: 'Chapter 90 - ZONING', topic: 'zoning',
    text: `
      Site-built single-family dwellings are permitted in the A-1 district.
      Modular homes shall be permitted in any district in which a single-family dwelling is permitted.
      Double-wide manufactured homes are permitted provided that the home is placed on a permanent
      foundation, the tongue and axles are removed, skirting is installed, and the minimum lot area
      is one (1) acre. Single-wide manufactured homes shall not be permitted in the A-1 district
      except upon approval of a special use permit by the board of commissioners.
      Replacement of an existing manufactured home is permitted where the home is lawfully nonconforming.
    `,
  });

  it('reads a permission as by right', () => {
    expect(classifyStructureStatus('site_built_single_family', [ZONED], NOW).status).toBe('allowed_by_right');
  });

  it('never treats a modular home and a HUD-code manufactured home as the same category', () => {
    expect(classifyStructureStatus('modular_home', [ZONED], NOW).status).toBe('allowed_by_right');
    expect(classifyStructureStatus('manufactured_single_wide', [ZONED], NOW).status)
      .not.toBe(classifyStructureStatus('modular_home', [ZONED], NOW).status);
  });

  it('separates a by-right-with-conditions permission from an unconditioned one', () => {
    const doubleWide = classifyStructureStatus('manufactured_double_wide', [ZONED], NOW);
    expect(doubleWide.status).toBe('allowed_by_right_with_objective_conditions');
    expect(isByRight(doubleWide.status)).toBe(true);
    const kinds = doubleWide.conditions.map((c) => c.kind);
    expect(kinds).toContain('foundation');
    expect(kinds).toContain('removal_of_transport_gear');
    expect(kinds).toContain('skirting');
  });

  it('never collapses a special use permit into by right', () => {
    const singleWide = classifyStructureStatus('manufactured_single_wide', [ZONED], NOW);
    expect(singleWide.status).toBe('conditional_or_special_approval_required');
    expect(isByRight(singleWide.status)).toBe(false);
    expect(useLegalStatusLabel(singleWide.status)).toMatch(/Special \/ conditional/i);
  });

  it('reads a prohibition before a general permission', () => {
    const prohibited = classifyStructureStatus('manufactured_single_wide', [doc({
      topic: 'zoning',
      text: 'Manufactured homes are permitted in the district. Single-wide manufactured homes shall not be permitted on any lot.',
    })], NOW);
    expect(prohibited.status).toBe('prohibited');
  });

  it('returns unverified when a chapter regulates HOW but never says WHETHER', () => {
    const permitOnly = classifyStructureStatus('manufactured_single_wide', [doc({
      title: 'Chapter 22 - MANUFACTURED HOUSING', topic: 'manufactured_housing',
      text: 'Prior to a single-wide manufactured home being transported into the county, a permit to transport must be obtained from the tax assessor and a decal showing payment of taxes must be obtained.',
    })], NOW);
    expect(permitOnly.status).toBe('unverified');
    expect(permitOnly.reasoning).toMatch(/none states whether it is permitted/i);
  });

  it('returns unverified when nothing addresses the structure type at all', () => {
    const absent = classifyStructureStatus('manufactured_double_wide', [doc({ text: 'Dogs shall be leashed.' })], NOW);
    expect(absent.status).toBe('unverified');
    expect(absent.hits).toEqual([]);
  });

  it('recognizes a lawful-nonconforming replacement allowance', () => {
    const replacement = classifyStructureStatus('pre_hud_mobile_home', [doc({
      topic: 'zoning',
      text: 'A mobile home constructed prior to June 15, 1976 may remain only as a lawfully nonconforming use and shall not be replaced with another such home.',
    })], NOW);
    expect(['lawful_nonconforming_only', 'prohibited']).toContain(replacement.status);
  });
});

/* ═══════════════════════ 10. ACCESS CLASSIFICATION ═════════════════════ */

describe('road classification points at an authority and never at an approval', () => {
  it('recognizes a state route from the subject address', () => {
    expect(roadNameFromAddress('3723 GA Highway 102')).toBe('GA Highway 102');
    expect(classifyRoadFromName('GA Highway 102', 'GA').type).toBe('state_highway');
    expect(classifyRoadFromName('State Route 102', 'GA').type).toBe('state_highway');
    expect(classifyRoadFromName('US Highway 41', 'GA').type).toBe('us_highway');
  });

  it('leaves an ordinary named road unverified rather than guessing', () => {
    expect(classifyRoadFromName('Onionville Rd', 'NY').type).toBe('unverified');
    expect(classifyRoadFromName('Elk Lake Rd', 'MI').type).toBe('unverified');
    expect(classifyRoadFromName(null, 'GA').type).toBe('unverified');
  });

  it('recognizes county routes and private roads', () => {
    expect(classifyRoadFromName('County Road 25', 'AL').type).toBe('county_road');
    expect(classifyRoadFromName('Private Lane', 'MI').type).toBe('private_road');
  });
});

/* ═══════════════════════ 11. LEGAL YIELD ═══════════════════════════════ */

function path(over: Partial<SubdivisionPath> = {}): SubdivisionPath {
  return {
    kind: 'minor_subdivision', originalTerm: 'minor subdivision',
    definition: evidencedValue('def', [primaryCitation()]),
    maximumLots: evidencedValue(4, [primaryCitation()]),
    maximumLotsWithoutNewRoad: unresolvedValue<number>('x'),
    acreageThreshold: unresolvedValue<string>('x'),
    reviewPath: 'administrative_staff_review', isByRight: true,
    discretionaryApprovals: [], objectiveApprovals: ['plat', 'survey'],
    citations: [primaryCitation()],
    ...over,
  };
}

function standard(kind: DimensionalStandard['kind'], numericValue: number, unit: DimensionalStandard['unit']): DimensionalStandard {
  return { kind, originalTerm: kind, statedValue: `${numericValue}`, numericValue, unit, citation: primaryCitation(), qualifier: null };
}

const NO_PARENT_TRACT: ParentTractFramework = {
  applies: unresolvedValue<boolean>('x'), parentTractDefinition: unresolvedValue<string>('x'),
  lookbackPeriod: unresolvedValue<string>('x'), priorDivisionCountRule: unresolvedValue<string>('x'),
  remainderTreatment: unresolvedValue<string>('x'), priorDivisionHistoryRequired: false, requiredVerificationStep: null,
};

describe('a legal maximum is computed only from verified constraints', () => {
  it('applies the smallest governing constraint', () => {
    const yieldResult = computeLegalYield({
      parcelAcres: 14.33, paths: [path()], standards: [standard('minimum_lot_area', 1, 'acres')],
      parentTract: NO_PARENT_TRACT, noConventionalZoning: false, subdivisionAuthorityUnresolved: false,
    });
    // 14.33 acres / 1 acre = 14, capped by the ordinance's own 4-lot limit.
    expect(yieldResult.status).toBe('established');
    expect(yieldResult.maximumLots).toBe(4);
    expect(yieldResult.constraintsApplied.map((c) => c.constraint)).toContain('minor subdivision lot cap');
  });

  it('refuses to produce a number when a required input is missing', () => {
    const yieldResult = computeLegalYield({
      parcelAcres: null, paths: [], standards: [],
      parentTract: NO_PARENT_TRACT, noConventionalZoning: false, subdivisionAuthorityUnresolved: true,
    });
    expect(yieldResult.status).toBe('unresolved');
    expect(yieldResult.maximumLots).toBeNull();
    expect(yieldResult.missingInputs.length).toBeGreaterThan(0);
    expect(yieldResult.reason).toMatch(/will not estimate/i);
  });

  it('stops outright when the parent-tract rule needs a history LandOS does not hold', () => {
    const yieldResult = computeLegalYield({
      parcelAcres: 14.33, paths: [path()], standards: [standard('minimum_lot_area', 1, 'acres')],
      parentTract: { ...NO_PARENT_TRACT, priorDivisionHistoryRequired: true },
      noConventionalZoning: false, subdivisionAuthorityUnresolved: false,
    });
    expect(yieldResult.status).toBe('unresolved');
    expect(yieldResult.maximumLots).toBeNull();
    expect(yieldResult.reason).toMatch(/PRIOR DIVISION HISTORY REQUIRED/);
  });

  it('publishes a provisional number with its gaps named rather than a confident one', () => {
    const yieldResult = computeLegalYield({
      parcelAcres: 14.33, paths: [path()], standards: [],
      parentTract: NO_PARENT_TRACT, noConventionalZoning: false, subdivisionAuthorityUnresolved: false,
    });
    expect(yieldResult.status).toBe('provisional');
    expect(yieldResult.maximumLots).toBe(4);
    expect(yieldResult.missingInputs).toContain('A verified minimum lot area');
  });

  it('does not demand a zoning minimum where no zoning exists', () => {
    const yieldResult = computeLegalYield({
      parcelAcres: 14.33, paths: [], standards: [],
      parentTract: NO_PARENT_TRACT, noConventionalZoning: true, subdivisionAuthorityUnresolved: false,
    });
    expect(yieldResult.missingInputs).not.toContain('A verified minimum lot area');
    expect(yieldResult.reason).toMatch(/No conventional zoning applies/);
  });

  it('ignores a discretionary path when looking for a by-right maximum', () => {
    const yieldResult = computeLegalYield({
      parcelAcres: 40, paths: [path({ kind: 'major_subdivision', isByRight: false, maximumLots: evidencedValue(20, [primaryCitation()]) })],
      standards: [standard('minimum_lot_area', 1, 'acres')],
      parentTract: NO_PARENT_TRACT, noConventionalZoning: false, subdivisionAuthorityUnresolved: false,
    });
    expect(yieldResult.missingInputs).toContain('A division procedure that requires no discretionary entitlement');
  });
});

describe('physical plausibility is screening and is bounded by the legal answer', () => {
  const legal = computeLegalYield({
    parcelAcres: 14.33, paths: [path()], standards: [standard('minimum_lot_area', 1, 'acres')],
    parentTract: NO_PARENT_TRACT, noConventionalZoning: false, subdivisionAuthorityUnresolved: false,
  });

  it('never exceeds the legal maximum', () => {
    const physical = computePhysicalYield({ parcelAcres: 14.33, legal, siteFacts: [], roadFrontageStated: null, minimumFrontage: undefined, limitingFactors: [] });
    expect(physical.plausibleLots).toBe(legal.maximumLots);
    expect(physical.scopeNote).toMatch(/not a survey/i);
  });

  it('publishes nothing when the legal answer is unresolved', () => {
    const unresolvedLegal = computeLegalYield({
      parcelAcres: 14.33, paths: [], standards: [], parentTract: { ...NO_PARENT_TRACT, priorDivisionHistoryRequired: true },
      noConventionalZoning: false, subdivisionAuthorityUnresolved: true,
    });
    const physical = computePhysicalYield({ parcelAcres: 14.33, legal: unresolvedLegal, siteFacts: [], roadFrontageStated: null, minimumFrontage: undefined, limitingFactors: [] });
    expect(physical.status).toBe('unresolved');
    expect(physical.plausibleLots).toBeNull();
  });
});

/* ═══════════════════ 12. CARVEOUT AND SCENARIOS ════════════════════════ */

describe('house carveout concepts are tested, and the seller figure gets no special standing', () => {
  const concepts = buildCarveoutConcepts({
    parcelAcres: 14.33, hasImprovements: true, minimumLotAcres: 1,
    minimumLotStandard: standard('minimum_lot_area', 1, 'acres'),
    siteConstraints: [{ factor: 'Septic location', detail: 'not surveyed', known: false }],
    sellerDiscussedAcres: 4,
  });

  it('tests the seller figure like any other candidate', () => {
    const seller = concepts.find((c) => c.basis === 'seller_discussed');
    expect(seller?.retainedAcres).toBe(4);
    // Seller-discussed acreage that duplicates a standard increment collapses to
    // one concept; either way it is never marked plausible without checks.
    expect(concepts.every((c) => c.checks.length > 0)).toBe(true);
  });

  it('eliminates a configuration that conflicts with a verified minimum', () => {
    const tooSmall = buildCarveoutConcepts({
      parcelAcres: 14.33, hasImprovements: true, minimumLotAcres: 5,
      minimumLotStandard: standard('minimum_lot_area', 5, 'acres'),
      siteConstraints: [], sellerDiscussedAcres: 1,
    }).find((c) => c.retainedAcres === 1);
    expect(tooSmall?.viability).toBe('conflicts_with_known_rule');
    expect(tooSmall?.eliminationReason).toMatch(/smaller than the verified minimum/i);
  });

  it('produces nothing for an unimproved parcel', () => {
    expect(buildCarveoutConcepts({ parcelAcres: 14, hasImprovements: false, minimumLotAcres: 1, minimumLotStandard: undefined, siteConstraints: [], sellerDiscussedAcres: null })).toEqual([]);
  });
});

describe('scenarios carry their legal status and their verification debt downstream', () => {
  const uses: UseDetermination[] = [
    { structureType: 'site_built_single_family', status: 'allowed_by_right', quality: 'verified_official', citations: [primaryCitation()], conditions: [], reasoning: 'r', unresolvedReason: null, statePreemption: null },
    { structureType: 'modular_home', status: 'allowed_by_right', quality: 'verified_official', citations: [primaryCitation()], conditions: [], reasoning: 'r', unresolvedReason: null, statePreemption: null },
    { structureType: 'manufactured_single_wide', status: 'conditional_or_special_approval_required', quality: 'verified_official', citations: [primaryCitation()], conditions: [], reasoning: 'r', unresolvedReason: null, statePreemption: null },
    { structureType: 'manufactured_double_wide', status: 'allowed_by_right_with_objective_conditions', quality: 'verified_official', citations: [primaryCitation()], conditions: [], reasoning: 'r', unresolvedReason: null, statePreemption: null },
  ];
  const legal = computeLegalYield({
    parcelAcres: 14.33, paths: [path()], standards: [standard('minimum_lot_area', 1, 'acres')],
    parentTract: NO_PARENT_TRACT, noConventionalZoning: false, subdivisionAuthorityUnresolved: false,
  });
  const physical = computePhysicalYield({ parcelAcres: 14.33, legal, siteFacts: [], roadFrontageStated: null, minimumFrontage: undefined, limitingFactors: [] });
  const carveouts = buildCarveoutConcepts({
    parcelAcres: 14.33, hasImprovements: true, minimumLotAcres: 1,
    minimumLotStandard: standard('minimum_lot_area', 1, 'acres'), siteConstraints: [], sellerDiscussedAcres: 4,
  });
  const scenarios = buildScenarios({
    parcelAcres: 14.33, hasImprovements: true, legal, physical, carveouts, uses, paths: [path()],
    accessConstraint: 'New access is permit-dependent.', globalVerification: ['Access unverified.'],
  });

  it('always produces the keep-intact scenario, which is always legally clean', () => {
    const intact = scenarios.find((s) => s.name === 'Keep intact');
    expect(intact?.support).toBe('supported_for_comp_research');
    expect(intact?.resultingLotCount).toBe(1);
  });

  it('produces carveout and maximum-division scenarios with lot counts and bands', () => {
    expect(scenarios.some((s) => /carveout/i.test(s.name))).toBe(true);
    const max = scenarios.find((s) => /Maximum by-right/.test(s.name));
    expect(max?.resultingLotCount).toBe(4);
    expect(max?.acreageBands.length).toBeGreaterThan(0);
  });

  it('asks for a manufactured-eligible comp set only where a manufactured home is by right', () => {
    const withDoubleWide = scenarios.flatMap((s) => s.compsResearchRequest.requests).filter((r) => r.propertyKind === 'manufactured_eligible_land');
    expect(withDoubleWide.length).toBeGreaterThan(0);

    const noManufactured = buildScenarios({
      parcelAcres: 14.33, hasImprovements: true, legal, physical, carveouts,
      uses: uses.map((u) => ({ ...u, status: 'prohibited' as const })),
      paths: [path()], accessConstraint: 'x', globalVerification: [],
    });
    expect(noManufactured.flatMap((s) => s.compsResearchRequest.requests).some((r) => r.propertyKind === 'manufactured_eligible_land')).toBe(false);
  });

  it('marks a comps request as not resting on verified law when the legal inputs are incomplete', () => {
    const shaky = computeLegalYield({
      parcelAcres: 14.33, paths: [path()], standards: [],
      parentTract: NO_PARENT_TRACT, noConventionalZoning: false, subdivisionAuthorityUnresolved: false,
    });
    const built = buildScenarios({
      parcelAcres: 14.33, hasImprovements: true, legal: shaky, physical, carveouts, uses, paths: [path()],
      accessConstraint: 'x', globalVerification: [],
    });
    const carve = built.find((s) => /carveout/i.test(s.name));
    expect(carve?.support).toBe('requires_verification');
    expect(carve?.compsResearchRequest.restsOnVerifiedLaw).toBe(false);
  });

  it('carries the by-right status of each structure type into every scenario', () => {
    for (const scenario of scenarios) {
      expect(scenario.manufacturedSingleWideStatus).toBe('conditional_or_special_approval_required');
      expect(scenario.manufacturedDoubleWideStatus).toBe('allowed_by_right_with_objective_conditions');
    }
    expect(statusFor(uses, 'manufactured_single_wide')).toBe('conditional_or_special_approval_required');
  });
});

describe('discovery questions come from real unresolved facts', () => {
  it('asks about division history exactly when the parent-tract rule needs it', () => {
    const withHistory = buildDiscoveryQuestions({
      parentTractHistoryRequired: true, surveyUnknown: false, accessAgreementsUnknown: false,
      drivewayPermitUnknown: false, wellSepticLocationUnknown: false, reserveFieldUnknown: false,
      utilitiesUnknown: false, privateRestrictionsUnknown: false, manufacturedHomePresent: false,
    });
    expect(withHistory).toHaveLength(1);
    expect(withHistory[0].question).toMatch(/ever been split off/i);
    expect(withHistory[0].answerStatus).toBe('seller_reported');
  });

  it('produces nothing when nothing is unresolved', () => {
    expect(buildDiscoveryQuestions({
      parentTractHistoryRequired: false, surveyUnknown: false, accessAgreementsUnknown: false,
      drivewayPermitUnknown: false, wellSepticLocationUnknown: false, reserveFieldUnknown: false,
      utilitiesUnknown: false, privateRestrictionsUnknown: false, manufacturedHomePresent: false,
    })).toEqual([]);
  });
});

/* ═══════════════════════ 13. PROVISION SEARCH ══════════════════════════ */

describe('provisions are quoted verbatim with the section that governs them', () => {
  it('attaches the nearest preceding section heading', () => {
    const text = 'Sec. 8-40. - Definitions. Minor subdivision means four lots. Sec. 8-41. - Standards. Minimum lot area shall be one acre.';
    const hits = findProvisions(text, /minimum lot area/i);
    expect(hits[0].section).toBe('8-41');
    expect(sectionForOffset(text, text.indexOf('Minor subdivision'))).toBe('8-40');
  });

  it('returns no section rather than a wrong one when nothing precedes the match', () => {
    expect(sectionForOffset('Minimum lot area shall be one acre.', 0)).toBeNull();
  });

  it('bounds excerpts so evidence stays inspectable without becoming a dump', () => {
    const long = 'x'.repeat(5000);
    expect(boundExcerpt(long)!.length).toBeLessThanOrEqual(901);
    expect(boundExcerpt('  ')).toBeNull();
  });

  it('scopes a search to the topics that can answer the question', () => {
    const documents = [
      doc({ title: 'Chapter 6 - ANIMALS', topic: 'general', text: 'Minimum lot area for a kennel shall be five acres.' }),
      doc({ title: 'Chapter 8', topic: 'subdivision', text: 'Minimum lot area shall be one acre.' }),
    ];
    const scoped = searchProvisions(documents, /minimum lot area/gi, { topics: ['subdivision'] });
    expect(scoped).toHaveLength(1);
    expect(scoped[0].document.topic).toBe('subdivision');
  });

  it('deduplicates citations while keeping the richest excerpt', () => {
    const thin = buildCitation({ url: 'https://x.gov/a', label: 'A', citation: '8-41', excerpt: 'short', retrievedAt: NOW });
    const rich = buildCitation({ url: 'https://x.gov/a', label: 'A', citation: '8-41', excerpt: 'a much longer excerpt with more of the provision', retrievedAt: NOW });
    const deduped = dedupeCitations([thin, rich]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].excerpt).toMatch(/much longer/);
  });
});

/* ═══════════════════ 14. PERSISTENCE AND ISOLATION ═════════════════════ */

function determination(over: Partial<LandUseDetermination> = {}): LandUseDetermination {
  const empty = unresolvedValue<string>('x');
  const legal = computeLegalYield({
    parcelAcres: 14.33, paths: [path()], standards: [standard('minimum_lot_area', 1, 'acres')],
    parentTract: NO_PARENT_TRACT, noConventionalZoning: false, subdivisionAuthorityUnresolved: false,
  });
  return {
    version: 1,
    subject: { dealCardId: 1, parcelId: '104-014', address: '3723 GA Highway 102', city: 'Warthen', county: 'Washington County', state: 'GA', acres: 14.33, latitude: 33.14, longitude: -82.77, hasImprovements: true, sellerReported: [] },
    authority: resolveAuthorityStack({
      county: 'Washington County', state: 'GA', city: 'Warthen', jurisdictionClues: [],
      gisIncorporatedStatus: null, gisLocalGovernment: null, gisSourceUrl: null, geography: null,
      stateFrameworkPresent: false, statePreemptionPresent: false, now: NOW,
    }),
    stateFramework: { state: 'GA', status: 'not_found', provisions: [], localAuthorityRetained: empty, sourcesSearched: [], searchedAt: NOW },
    zoning: { presence: 'no_conventional_zoning', code: empty, districtName: empty, classificationKind: 'unclassified', governingAuthority: 'Washington County', sourceDisclaimer: null, effectiveDate: null, nonZoningClassification: null },
    uses: [], privateRestrictions: [], dimensionalStandards: [],
    subdivision: {
      governingBody: 'Washington County', ordinanceLabel: null, ordinanceUrl: null, subdivisionDefinition: empty,
      paths: [], parentTract: NO_PARENT_TRACT, minimumLotArea: empty, minimumLotWidth: empty, minimumRoadFrontage: empty,
      flagLots: empty, sharedDriveways: empty, privateRoads: empty, publicRoadFrontageRequired: unresolvedValue<boolean>('x'),
      newRoadTrigger: empty, surveyRequirement: empty, platRequirement: empty, recordingRequirement: empty,
      utilityRequirement: empty, septicRequirement: empty, wellRequirement: empty, stormwaterRequirement: empty,
      fireAccessRequirement: empty, applicationFee: empty, publishedReviewTimeline: empty, stateHighwayAccessImplication: empty,
    },
    access: {
      roadType: unresolvedValue('x'), roadName: 'GA Highway 102', accessAuthority: null, status: 'new_access_unverified',
      drivewayPermitRequired: unresolvedValue<boolean>('x'), newAccessApprovalRequired: unresolvedValue<boolean>('x'),
      spacingStandards: empty, sharedAccessMayBeRequired: unresolvedValue<boolean>('x'),
      subdivisionTriggersReview: unresolvedValue<boolean>('x'), constraintNotes: ['Frontage is not legal access.'],
    },
    septicWell: {
      authority: null, perLotApprovalRequired: unresolvedValue<boolean>('x'), divisionRequiresHealthReview: unresolvedValue<boolean>('x'),
      minimumAcreageForOnsiteSystem: empty, reserveFieldRequirement: empty, existingSepticInfluence: null,
      existingWellInfluence: null, unresolved: [], scopeNote: 'Screening only.',
    },
    precedence: [], legalYield: legal,
    physicalYield: computePhysicalYield({ parcelAcres: 14.33, legal, siteFacts: [], roadFrontageStated: null, minimumFrontage: undefined, limitingFactors: [] }),
    carveouts: [], scenarios: [], discoveryQuestions: [], unresolved: ['Zoning authority unresolved.'],
    failureStates: ['NO_CONVENTIONAL_ZONING_VERIFIED'], sources: [], lanes: [], determinedAt: NOW,
    ...over,
  };
}

describe('determinations persist per deal and never leak across properties', () => {
  beforeEach(() => {
    _initTestLandosDb();
    const db = getLandosDb();
    db.prepare(`INSERT INTO landos_deal_card (id, entity, title) VALUES (1, 'TY_LAND_BIZ', 'GA subject')`).run();
    db.prepare(`INSERT INTO landos_deal_card (id, entity, title) VALUES (2, 'TY_LAND_BIZ', 'MI subject')`).run();
  });

  it('returns the newest determination for the deal it belongs to', () => {
    saveLandUseDetermination(1, determination());
    saveLandUseDetermination(1, determination({ determinedAt: '2026-08-07T13:00:00.000Z' }));
    const current = getLandUseDetermination(1);
    expect(current?.determinedAt).toBe('2026-08-07T13:00:00.000Z');
    expect(listLandUseDeterminations(1)).toHaveLength(2);
  });

  it('never returns one property\'s legal research for another', () => {
    saveLandUseDetermination(1, determination());
    expect(getLandUseDetermination(2)).toBeNull();
    expect(buildLandUseView(2).present).toBe(false);
    expect(buildLandUseView(1).subject.county).toBe('Washington County');
  });

  it('refuses to rewrite a determination an operator has already read', () => {
    const saved = saveLandUseDetermination(1, determination());
    expect(() => getLandosDb().prepare('UPDATE landos_land_use_determination SET state = ? WHERE id = ?').run('MI', saved.id))
      .toThrow(/append-only/);
  });

  it('cascades with the deal card so legal research cannot outlive its property', () => {
    saveLandUseDetermination(1, determination());
    getLandosDb().prepare('PRAGMA foreign_keys = ON').run();
    getLandosDb().prepare('DELETE FROM landos_deal_card WHERE id = 1').run();
    expect(getLandUseDetermination(1)).toBeNull();
  });

  it('indexes the row from the determination itself so the two cannot disagree', () => {
    saveLandUseDetermination(1, determination());
    const row = getLandosDb().prepare('SELECT zoning_presence, authority_pattern, legal_yield_status, legal_yield_max_lots FROM landos_land_use_determination WHERE deal_card_id = 1').get() as Record<string, unknown>;
    expect(row.zoning_presence).toBe('no_conventional_zoning');
    expect(row.legal_yield_status).toBe('established');
    expect(row.legal_yield_max_lots).toBe(4);
  });
});

/* ═══════════════════════ 15. OPERATOR PROJECTION ═══════════════════════ */

describe('the operator panel never renders a blank where a rule belongs', () => {
  it('renders a named unresolved state instead of an empty value', () => {
    const view = toValueView(unresolvedValue<string>('No minimum lot area was located in the adopted law LandOS read.'));
    expect(view.value).toBeNull();
    expect(view.unresolved).toMatch(/No minimum lot area was located/);
    expect(view.qualityLabel).toBe('Unverified');
  });

  it('renders an established value with its confidence and its sources', () => {
    const view = toValueView(evidencedValue('1 acre', [primaryCitation()]));
    expect(view.value).toBe('1 acre');
    expect(view.unresolved).toBeNull();
    expect(view.sources).toHaveLength(1);
    expect(view.sources[0].isPrimary).toBe(true);
  });

  it('surfaces a conflict rather than a chosen side', () => {
    const a = { citation: primaryCitation('https://x.gov/a'), normalizedValue: '1', says: 'one acre', value: '1' };
    const b = { citation: primaryCitation('https://x.gov/b'), normalizedValue: '2', says: 'two acres', value: '2' };
    const view = toValueView(reconcilePrimarySources('Minimum lot area', [a, b], 'x'));
    expect(view.value).toBeNull();
    expect(view.conflict?.sides).toHaveLength(2);
  });

  it('renders booleans as words rather than as raw values', () => {
    expect(toValueView(evidencedValue(true, [primaryCitation()])).value).toBe('Yes');
    expect(toValueView(evidencedValue(false, [primaryCitation()])).value).toBe('No');
  });

  it('shows a non-zoning classification with a plain-language caveat', () => {
    const view = toLandUseView(determination({
      zoning: {
        presence: 'zoning_unverified', code: unresolvedValue<string>('x'), districtName: unresolvedValue<string>('x'),
        classificationKind: 'assessment_classification', governingAuthority: null, sourceDisclaimer: null, effectiveDate: null,
        nonZoningClassification: { code: 'AR', description: 'Agricultural Residential', kind: 'assessment_classification', sourceUrl: 'https://ccgis.cayugacounty.us/x' },
      },
    }));
    expect(view.zoning.nonZoningClassification?.caveat).toMatch(/not adopted zoning/i);
    expect(view.zoning.nonZoningClassification?.kindLabel).toMatch(/not adopted zoning/i);
  });

  it('renders an honest not-researched view for a deal that never ran the lane', () => {
    const empty = emptyLandUseView();
    expect(empty.present).toBe(false);
    expect(empty.governingAuthority.incorporation.unresolved).toBe('Not researched.');
  });

  it('carries the honest states through to the panel', () => {
    const view = toLandUseView(determination());
    expect(view.failureStates.map((f) => f.label)).toContain('No conventional zoning — verified');
    expect(view.whatCouldChangeThis).toContain('Zoning authority unresolved.');
    expect(view.subjectPotential.physical.scopeNote).toMatch(/not a survey/i);
  });
});
