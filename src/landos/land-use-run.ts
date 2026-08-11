// LandOS — the NATIONWIDE land use, zoning and by-right subdivision ORCHESTRATOR.
//
// One entry point per property. It consumes the parcel/GIS handoff rather than
// redoing it, resolves the authority stack, runs the independent research lanes
// concurrently, and assembles one determination in which every legal value
// carries its source and its confidence.
//
// Lane concurrency is not a performance flourish. A county ordinance site that
// takes forty seconds must not delay the state statute lane or the access lane,
// because those answer completely different questions and a slow one should
// cost coverage in its own area only.
//
// The assembly step is where the doctrine is enforced for real: the zoning
// determination refuses to promote an assessment classification, the use
// determinations refuse to read silence as permission, and the yield refuses to
// produce a number from an input it does not have.

import { latestOfficialParcelGis } from './official-parcel-gis-run.js';
import { defaultGovFetchText, type GovFetchText } from './gis-transport.js';
import { createBackgroundBrowserFetchText, withBrowserFallback } from './gov-browser-transport.js';
import { resolveAuthorityStack, resolveCensusGeography, type CensusGeography } from './land-use-authority.js';
import { researchLocalLandUse, type LocalResearchResult, type OfficialSiteCache } from './land-use-local.js';
import { landosOfficialSiteCache } from './official-site-store.js';
import { researchAccess, researchSepticAuthority } from './land-use-agency.js';
import {
  frameworkHasLandDivisionBaseline,
  frameworkHasPreemption,
  resolveStateFramework,
} from './land-use-state-framework.js';
import {
  classifyStructureStatus,
  excerptValue,
  extractAccessRules,
  extractDimensionalStandards,
  extractParentTract,
  extractPlatAndSurvey,
  extractSepticRules,
  extractSubdivisionPaths,
  valueFromHits,
} from './land-use-extract.js';
import { buildCitation, dedupeCitations } from './land-use-evidence.js';
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
import { saveLandUseDetermination } from './land-use-store.js';
import { stateCodeFromName } from './state-legal-sources.js';
import type { OrdinanceDocument } from './land-use-ordinance.js';
import {
  COUNTY_SUBDIVISION_FALLBACK_BLOCKER,
  COUNTY_SUBDIVISION_FALLBACK_LABEL,
  MANUFACTURED_STRUCTURE_TYPES,
  STRUCTURE_TYPES,
  evidencedValue,
  unresolvedValue,
  type ClassificationKind,
  type CountySubdivisionFallback,
  type DimensionalStandard,
  type EvidencedValue,
  type GovernmentUnitType,
  type SubdivisionPath,
  type LandUseDetermination,
  type LandUseFailureState,
  type LandUseSubject,
  type LaneOutcome,
  type LegalSourceCitation,
  type ParentTractFramework,
  type PrivateRestrictionFinding,
  type RulePrecedenceRecord,
  type StructureType,
  type SubdivisionFramework,
  type UseDetermination,
  type ZoningDetermination,
  type ZoningPresence,
} from './land-use-types.js';
import type { ZoningAuthorityKind, ZoningResearchHandoff } from './gis-platform-types.js';
import { logger } from '../logger.js';

/* ─────────────────────────────── inputs ──────────────────────────────── */

export interface LandUseRunSubject {
  dealCardId: number;
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  acres: number | null;
  apn: string | null;
  latitude: number | null;
  longitude: number | null;
  hasImprovements: boolean;
  /** Seller statements, retained AS seller statements and never as verification. */
  sellerReported: string[];
  /** An acreage the seller has discussed for a retained house lot, if any. */
  sellerDiscussedCarveoutAcres: number | null;
  hasExistingWell: boolean;
  hasExistingSeptic: boolean;
  /**
   * The operator's own recorded lead text. Used ONLY as an identity hint for
   * the federal geography lookup when the property record carries no
   * structured city or state; it never becomes a legal conclusion.
   */
  addressHint?: string | null;
}

export interface LandUseRunDeps {
  fetchText?: GovFetchText;
  now?: () => string;
  /** Disabled in tests so nothing reaches a search engine or a government host. */
  allowWebSearch?: boolean;
  /** Injected in tests so the handoff is supplied rather than read from the db. */
  handoff?: ZoningResearchHandoff | null;
  /** Injected in tests so geography is supplied rather than looked up. */
  geography?: CensusGeography | null;
  maxRequestsPerLane?: number;
  /** Injected in tests so nothing is written to the operating database. */
  persist?: boolean;
  /**
   * The learned official-site cache. Defaults to the LandOS store, and is
   * disabled with the rest of persistence in tests.
   */
  siteCache?: OfficialSiteCache | null;
}

export interface LandUseRun {
  determination: LandUseDetermination;
  lanes: LaneOutcome[];
}

/* ────────────────────── zoning determination assembly ────────────────── */

/**
 * Map the parcel lane's own classification of a code value onto this engine's
 * vocabulary.
 *
 * The parcel lane already refuses to call an assessment code "zoning"; this
 * carries that refusal forward rather than re-deciding it. Deal 81 is the
 * standing example: its GIS publishes "AR" in a field an operator would read
 * as zoning, and it is an assessment classification.
 */
export function classificationFromHandoff(authority: ZoningAuthorityKind | null): ClassificationKind {
  switch (authority) {
    case 'official_zoning_layer': return 'adopted_zoning';
    case 'assessment_classification': return 'assessment_classification';
    case 'unclassified': return 'unclassified';
    default: return 'unclassified';
  }
}

export interface ZoningAssemblyInput {
  handoff: ZoningResearchHandoff | null;
  zoningAuthorityBody: string | null;
  noConventionalZoning: boolean;
  noZoningCitations: readonly LegalSourceCitation[];
  now: string;
}

/**
 * Build the zoning determination.
 *
 * The ordering here is the safety property. A verified statement of no zoning
 * wins outright. An adopted-zoning value from an official zoning layer is
 * accepted. ANY other code value is retained and labelled as what it actually
 * is, and the district itself stays unverified — because a classification that
 * is not adopted zoning cannot answer what may lawfully be built, and showing
 * it in the zoning slot would let an operator read it as if it could.
 */
export function assembleZoning(input: ZoningAssemblyInput): ZoningDetermination {
  const { handoff, now } = input;
  const kind = classificationFromHandoff(handoff?.zoningAuthority ?? null);
  const code = handoff?.zoningCode ?? null;

  if (input.noConventionalZoning) {
    return {
      presence: 'no_conventional_zoning',
      code: unresolvedValue<string>('This jurisdiction does not zone, so no zoning district applies to the parcel.'),
      districtName: unresolvedValue<string>('No zoning district exists to name.'),
      classificationKind: kind === 'adopted_zoning' ? 'unclassified' : kind,
      governingAuthority: input.zoningAuthorityBody,
      sourceDisclaimer: handoff?.zoningSourceDisclaimer ?? null,
      effectiveDate: null,
      nonZoningClassification: code
        ? {
            code,
            description: handoff?.zoningDescription ?? null,
            kind: kind === 'adopted_zoning' ? 'unclassified' : kind,
            sourceUrl: handoff?.officialParcelSourceUrl ?? null,
          }
        : null,
    };
  }

  if (code && kind === 'adopted_zoning') {
    const citation = buildCitation({
      url: handoff?.zoningLayer?.serviceUrl ?? handoff?.officialParcelSourceUrl ?? 'urn:landos:official-parcel-source',
      label: handoff?.zoningLayer?.layerName ?? 'Official zoning layer',
      excerpt: `The official zoning layer assigns this parcel the code ${code}${handoff?.zoningDescription ? ` (${handoff.zoningDescription})` : ''}.`,
      format: 'json_api',
      tierHint: 'zoning_map',
      retrievedAt: now,
    });
    return {
      presence: 'zoning_established',
      code: evidencedValue(code, [citation]),
      districtName: handoff?.zoningDescription
        ? evidencedValue(handoff.zoningDescription, [citation])
        : unresolvedValue<string>('The zoning layer published a code without a district name.'),
      classificationKind: 'adopted_zoning',
      governingAuthority: input.zoningAuthorityBody,
      sourceDisclaimer: handoff?.zoningSourceDisclaimer ?? null,
      effectiveDate: null,
      nonZoningClassification: null,
    };
  }

  // A code exists but is not adopted zoning, or its kind was never established.
  return {
    presence: 'zoning_unverified',
    code: unresolvedValue<string>(
      code
        ? 'A code value is published for this parcel, but it is not established as adopted zoning, so it is not presented as the zoning district.'
        : 'No zoning district was established for this parcel.',
    ),
    districtName: unresolvedValue<string>('No adopted zoning district was established for this parcel.'),
    classificationKind: kind,
    governingAuthority: input.zoningAuthorityBody,
    sourceDisclaimer: handoff?.zoningSourceDisclaimer ?? null,
    effectiveDate: null,
    nonZoningClassification: code
      ? { code, description: handoff?.zoningDescription ?? null, kind, sourceUrl: handoff?.officialParcelSourceUrl ?? null }
      : null,
  };
}

/* ────────────────────────── the run ──────────────────────────────────── */

function buildTransport(deps: LandUseRunDeps): GovFetchText {
  if (deps.fetchText) return deps.fetchText;
  return withBrowserFallback(defaultGovFetchText, createBackgroundBrowserFetchText());
}

async function timedLane<T>(
  lane: LaneOutcome['lane'],
  work: () => Promise<T>,
  describe: (value: T) => { status: LaneOutcome['status']; detail: string; sourcesRead: number },
  fallback: T,
): Promise<{ value: T; outcome: LaneOutcome }> {
  const started = Date.now();
  try {
    const value = await work();
    const described = describe(value);
    return { value, outcome: { lane, ...described, durationMs: Date.now() - started } };
  } catch (error) {
    return {
      value: fallback,
      outcome: {
        lane,
        status: 'unreachable',
        detail: `The lane failed: ${(error as Error)?.message ?? 'unknown error'}.`,
        sourcesRead: 0,
        durationMs: Date.now() - started,
      },
    };
  }
}

/**
 * Run the whole land-use lane for one property and persist the determination.
 *
 * Every exit path returns a complete determination. A run that establishes
 * nothing still names what it could not establish, because an operator reading
 * a blank panel cannot tell "no rule" from "no research".
 */
/* ─────────────────── subdivision framework assembly ──────────────────── */

export interface SubdivisionAssemblyInput {
  documents: readonly OrdinanceDocument[];
  /** The body that approves land division, when one was actually established. */
  governingBody: string | null;
  ordinanceLabel: string | null;
  ordinanceUrl: string | null;
  dimensionalStandards: DimensionalStandard[];
  determinedAt: string;
  effectiveDate: string | null;
  stateHighwayAccessImplication: EvidencedValue<string>;
}

/**
 * Assemble one land-division rule set from adopted law LandOS actually read.
 *
 * Shared by the local lane and by the county fallback so both run the SAME
 * parsers and produce the SAME shape. A second copy of this would be a second
 * set of rules with its own drift; there is one.
 */
export function assembleSubdivisionFramework(input: SubdivisionAssemblyInput): {
  paths: SubdivisionPath[];
  parentTract: ParentTractFramework;
  subdivision: SubdivisionFramework;
} {
  const { documents, determinedAt, effectiveDate, dimensionalStandards } = input;
  const paths = extractSubdivisionPaths(documents, determinedAt, effectiveDate);
  const accessRules = extractAccessRules(documents);
  const platSurvey = extractPlatAndSurvey(documents);
  const septicRules = extractSepticRules(documents);
  const parentTractExtraction = extractParentTract(documents);

  const parentTract: ParentTractFramework = {
    applies: parentTractExtraction.applies
      ? valueFromHits(parentTractExtraction.hits, true, determinedAt, 'No parent-tract rule was located.')
      : unresolvedValue<boolean>('No parent-tract or prior-division rule was located in the adopted law LandOS read.'),
    parentTractDefinition: parentTractExtraction.parentDefinitionClause
      ? excerptValue(parentTractExtraction.hits, determinedAt, 'Not located.')
      : unresolvedValue<string>('No definition of a parent tract was located.'),
    lookbackPeriod: parentTractExtraction.lookbackClause
      ? excerptValue(parentTractExtraction.hits.filter((hit) => hit.match.excerpt === parentTractExtraction.lookbackClause), determinedAt, 'Not located.')
      : unresolvedValue<string>('No lookback period was located.'),
    priorDivisionCountRule: parentTractExtraction.applies
      ? excerptValue(parentTractExtraction.hits, determinedAt, 'Not located.')
      : unresolvedValue<string>('No rule counting prior divisions was located.'),
    remainderTreatment: parentTractExtraction.remainderClause
      ? excerptValue(parentTractExtraction.hits.filter((hit) => hit.match.excerpt === parentTractExtraction.remainderClause), determinedAt, 'Not located.')
      : unresolvedValue<string>('No remainder-parcel treatment was located.'),
    priorDivisionHistoryRequired: parentTractExtraction.applies,
    requiredVerificationStep: parentTractExtraction.applies
      ? 'Obtain the parcel\'s division history from the county deed records, and confirm how many divisions have already been taken from the parent tract.'
      : null,
  };

  const subdivision: SubdivisionFramework = {
    governingBody: input.governingBody,
    ordinanceLabel: input.ordinanceLabel,
    ordinanceUrl: input.ordinanceUrl,
    subdivisionDefinition: excerptValue(
      [],
      determinedAt,
      'No definition of subdivision was located in the adopted law LandOS read.',
    ),
    paths,
    parentTract,
    minimumLotArea: dimensionalStandardValue(dimensionalStandards, 'minimum_lot_area'),
    minimumLotWidth: dimensionalStandardValue(dimensionalStandards, 'minimum_lot_width'),
    minimumRoadFrontage: dimensionalStandardValue(dimensionalStandards, 'minimum_road_frontage'),
    flagLots: excerptValue(accessRules.flagLots, determinedAt, 'No flag-lot rule was located in the adopted law LandOS read.'),
    sharedDriveways: excerptValue(accessRules.sharedDrives, determinedAt, 'No shared-driveway rule was located.'),
    privateRoads: excerptValue(accessRules.privateRoads, determinedAt, 'No private-road rule was located.'),
    publicRoadFrontageRequired: accessRules.publicRoadRequired.length
      ? valueFromHits(accessRules.publicRoadRequired, true, determinedAt, 'Not located.')
      : unresolvedValue<boolean>('Whether frontage must be on a public road was not located.'),
    newRoadTrigger: excerptValue(accessRules.newRoadTrigger, determinedAt, 'No trigger for a new road was located.'),
    surveyRequirement: excerptValue(platSurvey.survey, determinedAt, 'No survey requirement was located.'),
    platRequirement: excerptValue([...platSurvey.finalPlat, ...platSurvey.preliminaryPlat], determinedAt, 'No plat requirement was located.'),
    recordingRequirement: excerptValue(platSurvey.recording, determinedAt, 'No recording requirement was located.'),
    utilityRequirement: unresolvedValue<string>('No utility requirement for new lots was located.'),
    septicRequirement: excerptValue(septicRules.perLotApproval, determinedAt, 'No septic requirement for new lots was located in the adopted local law.'),
    wellRequirement: excerptValue(septicRules.wellRules, determinedAt, 'No well requirement was located.'),
    stormwaterRequirement: unresolvedValue<string>('No stormwater requirement material to this subject was located.'),
    fireAccessRequirement: unresolvedValue<string>('No fire-access requirement material to this subject was located.'),
    applicationFee: excerptValue(platSurvey.fees, determinedAt, 'No application fee was published in the text LandOS read.'),
    publishedReviewTimeline: excerptValue(platSurvey.timeline, determinedAt, 'No published review timeline was located.'),
    stateHighwayAccessImplication: input.stateHighwayAccessImplication,
  };

  return { paths, parentTract, subdivision };
}

/* ──────────────────── mandatory county fallback rules ────────────────── */

export interface CountyFallbackInput {
  county: string | null;
  state: string | null;
  /** The unit the local lane already researched, so it is not re-read. */
  localUnitName: string | null;
  localUnitType: GovernmentUnitType;
  localResult: LocalResearchResult;
  determinedAt: string;
  stateHighwayAccessImplication: EvidencedValue<string>;
}

function isCountyUnit(unitType: GovernmentUnitType): boolean {
  return unitType === 'county' || unitType === 'unincorporated_county' || unitType === 'parish';
}

/**
 * Retrieve the subject county's own minor-subdivision / land-division rules
 * when the controlling local jurisdiction could not be confirmed.
 *
 * This is a FALLBACK, never a jurisdiction finding. It reuses the same local
 * research lane and the same parsers pointed at the county, so nothing new is
 * invented and no second rule engine exists. The county is not asserted to
 * control: the label and the blocker travel with the result, and the attempt
 * trail records which authorities were checked.
 *
 * Returns null only when there is no county to research — an honest nothing is
 * better than a fabricated rule set.
 */
export async function researchCountySubdivisionFallback(
  input: CountyFallbackInput,
  deps: { fetchText?: GovFetchText; allowWebSearch?: boolean; maxRequests?: number; siteCache?: OfficialSiteCache | null } = {},
): Promise<CountySubdivisionFallback | null> {
  const county = (input.county ?? '').trim();
  if (!county || !input.state) return null;
  // "Grand Traverse County County" is how a doubled suffix reaches an operator.
  const countyLabel = /\bcounty$|\bparish$/i.test(county) ? county : `${county} County`;

  const attempts: string[] = [];
  if (input.localUnitName && !isCountyUnit(input.localUnitType)) {
    attempts.push(
      `${input.localUnitName} (${input.localUnitType.replace(/_/g, ' ')}): `
      + `${input.localResult.officialSites.length} official site(s) verified, `
      + `${input.localResult.codeSources.length} adopted code source(s) reached, `
      + `${input.localResult.documents.length} provision(s) read — no body that approves land division was established.`,
    );
  }
  for (const note of input.localResult.notes.slice(0, 4)) attempts.push(note);
  for (const blocked of input.localResult.paidAccessBlocked) {
    attempts.push(`${blocked.url}: payment demanded, so the source was not read (${blocked.detail}).`);
  }

  // When the unit already researched IS the county, do not read it twice. Its
  // documents are the county's documents.
  const countyResult = isCountyUnit(input.localUnitType)
    ? input.localResult
    : await researchLocalLandUse(
      {
        county,
        state: input.state,
        localUnitName: county,
        localUnitType: 'county',
        knownPlanningUrls: [],
        now: input.determinedAt,
      },
      deps,
    );

  attempts.push(
    `${countyLabel} fallback: ${countyResult.officialSites.length} official site(s) verified, `
    + `${countyResult.codeSources.length} adopted code source(s) reached, `
    + `${countyResult.documents.length} provision(s) read.`,
  );

  const effectiveDate = countyResult.codeSources[0]?.codifiedThrough ?? null;
  const dimensionalStandards = extractDimensionalStandards(countyResult.documents, input.determinedAt, effectiveDate);
  const { subdivision } = assembleSubdivisionFramework({
    documents: countyResult.documents,
    // The county is NOT asserted to be the governing body. Only a confirmed
    // authority may occupy that field, and this fallback exists because none is.
    governingBody: null,
    ordinanceLabel: countyResult.codeSources[0]?.jurisdictionLabel ?? null,
    ordinanceUrl: countyResult.codeSources[0]?.url ?? null,
    dimensionalStandards,
    determinedAt: input.determinedAt,
    effectiveDate,
    stateHighwayAccessImplication: input.stateHighwayAccessImplication,
  });

  const provisionCitations = dedupeCitations([
    ...subdivision.paths.flatMap((path) => path.citations),
    ...dimensionalStandards.map((standard) => standard.citation),
  ]);
  const retrievedProvisions = subdivision.paths.length > 0 || dimensionalStandards.length > 0;

  // The operator must be able to open WHAT WAS READ even when the county
  // publishes no land-division provision of its own. Without this the panel
  // reports a county fallback with nothing behind it, which is the same dead
  // end the fallback exists to prevent.
  const sourcesRead = dedupeCitations(countyResult.documents.slice(0, 4).map((document) => buildCitation({
    url: document.url,
    label: document.title,
    citation: document.section,
    excerpt: document.text.slice(0, 600),
    format: 'html',
    tierHint: 'planning_department',
    retrievedAt: input.determinedAt,
  })));
  const sources = retrievedProvisions ? provisionCitations : dedupeCitations([...provisionCitations, ...sourcesRead]);

  // Three honest states, and they are not interchangeable: rules retrieved, a
  // verified county source that publishes none, and a county that could not be
  // read at all. The middle one used to be reported as the first.
  const summary = retrievedProvisions
    ? `${countyLabel}'s own published land-division rules are shown here because the body that actually approves land division for this parcel is not confirmed. Confirm the controlling jurisdiction before relying on any of it.`
    : countyResult.documents.length
      ? `${countyLabel}'s own official source was located and read, and it publishes no county minor-subdivision or land-division requirement of its own. What it does publish is cited here. The body that actually approves land division for this parcel is still not confirmed.`
      : `${countyLabel}'s published land-division rules could not be read either, so no usable minor-subdivision requirement is available for this subject yet.`;

  return {
    label: COUNTY_SUBDIVISION_FALLBACK_LABEL,
    blocker: COUNTY_SUBDIVISION_FALLBACK_BLOCKER,
    county,
    state: input.state,
    framework: subdivision,
    authorityAttempts: attempts,
    sources,
    summary,
    retrievedAt: input.determinedAt,
  };
}

export async function runLandUseResearch(
  subject: LandUseRunSubject,
  deps: LandUseRunDeps = {},
): Promise<LandUseRun> {
  const now = deps.now ?? (() => new Date().toISOString());
  const determinedAt = now();
  const fetchText = buildTransport(deps);
  const allowWebSearch = deps.allowWebSearch;
  const maxRequests = deps.maxRequestsPerLane ?? 6;
  // Learned once, reused for every later property in the same government. A run
  // that is not persisting anything does not learn anything either.
  const siteCache = deps.siteCache !== undefined
    ? deps.siteCache
    : deps.persist === false ? null : landosOfficialSiteCache();

  const handoff = deps.handoff !== undefined
    ? deps.handoff
    : latestOfficialParcelGis(subject.dealCardId)?.handoff ?? null;

  /* Identity. The handoff's official values outrank the intake record. */
  const county = handoff?.subject.county ?? subject.county;
  const recordState = (handoff?.subject.state ?? subject.state ?? '').trim().toUpperCase() || null;
  const acres = handoff?.subject.acres ?? subject.acres;
  const address = handoff?.subject.address ?? subject.address;

  /* Geography first: the local lane cannot start until it knows whether a
     sub-county government contains the parcel. */
  const geography = deps.geography !== undefined
    ? deps.geography
    : await resolveCensusGeography(
        {
          address, city: subject.city, state: recordState,
          latitude: subject.latitude, longitude: subject.longitude,
          oneLine: subject.addressHint
            ?? (address && subject.city ? `${address}, ${subject.city}${recordState ? `, ${recordState}` : ''}` : null),
        },
        { fetchText },
      );

  /**
   * The state the LANES run against.
   *
   * A federal geography answer outranks a blank property record, and that is
   * what lets the engine work from property identity alone. Without it, a lead
   * whose structured state was never filled in resolves federally and then
   * reaches no state-level lane at all — the research silently does nothing and
   * reports it as "not run", which reads to an operator like "nothing applies".
   */
  const state = recordState ?? stateCodeFromName(geography?.state);

  const provisionalAuthority = resolveAuthorityStack({
    county, state, city: subject.city,
    jurisdictionClues: handoff?.jurisdictionClues ?? [],
    gisIncorporatedStatus: null,
    gisLocalGovernment: null,
    gisSourceUrl: handoff?.officialParcelSourceUrl ?? null,
    geography,
    stateFrameworkPresent: false,
    statePreemptionPresent: false,
    now: determinedAt,
  });

  /* Independent lanes, concurrently. One slow ordinance site must not stall
     the statute lane or the access lane. */
  const [stateLane, localLane, accessLane, septicLane] = await Promise.all([
    timedLane(
      'state_framework',
      () => state
        ? resolveStateFramework(state, {
            fetchText, allowWebSearch, now,
            maxDocuments: Math.max(maxRequests, 16),
            // The lane cannot pick the right body of law without knowing what
            // kind of local government contains the parcel.
            localUnitHint: provisionalAuthority.localUnit.unitType === 'unincorporated_county'
              ? 'county'
              : provisionalAuthority.localUnit.unitType,
          })
        : Promise.resolve(null),
      (value) => value
        ? {
            status: value.status === 'present' ? 'complete' as const : value.status === 'not_found' ? 'complete' as const : 'no_source_found' as const,
            detail: value.status === 'present'
              ? `${value.provisions.length} statewide provision(s) located.`
              : value.status === 'not_found'
                ? 'The state\'s official publication was read and contained no matching statewide provision.'
                : 'The state\'s official legal publication could not be reached.',
            sourcesRead: value.sourcesSearched.filter((entry) => entry.outcome === 'read').length,
          }
        : { status: 'not_run' as const, detail: 'No state was established for this subject.', sourcesRead: 0 },
      null,
    ),
    timedLane(
      'local_zoning_ordinance',
      () => researchLocalLandUse(
        {
          // The federally-resolved county name outranks the intake record. An
          // intake that says "Washington" and a Census answer of "Washington
          // County" are the same county, and the official name is the one that
          // must reach an operator and a codifier directory lookup.
          county: geography?.county ?? county,
          state,
          localUnitName: provisionalAuthority.localUnit.name.value,
          localUnitType: provisionalAuthority.localUnit.unitType,
          knownPlanningUrls: handoff?.planningZoningUrls ?? [],
          now: determinedAt,
        },
        { fetchText, allowWebSearch, maxRequests, siteCache },
      ),
      (value) => !value
        ? { status: 'not_run' as const, detail: 'The local research lane did not run.', sourcesRead: 0 }
        : {
            status: value.paidAccessBlocked.length ? 'blocked_paid' as const
              : value.documents.length ? 'complete' as const
                : 'no_source_found' as const,
            detail: value.documents.length
              ? `${value.documents.length} provision(s) read from ${value.codeSources.length} adopted code source(s) and ${value.officialSites.length} official site(s).`
              : 'No adopted local law was located for this jurisdiction.',
            sourcesRead: value.documents.length,
          },
      null,
    ),
    timedLane(
      'dot_access',
      () => researchAccess(
        { address, state, county, hasImprovements: subject.hasImprovements, now: determinedAt },
        { fetchText, allowWebSearch, maxRequests: 4 },
      ),
      (value) => !value
        ? { status: 'not_run' as const, detail: 'The access lane did not run.', sourcesRead: 0 }
        : {
            status: value.accessAuthority ? 'complete' as const : 'partial' as const,
            detail: value.accessAuthority
              ? `Access authority established: ${value.accessAuthority.name.value}.`
              : `Road classified as ${value.roadType.value ?? 'unverified'}; no access authority document was read.`,
            sourcesRead: value.accessAuthority ? 1 : 0,
          },
      null,
    ),
    timedLane(
      'septic_health',
      () => researchSepticAuthority(
        { county, state, hasExistingSeptic: subject.hasExistingSeptic, hasExistingWell: subject.hasExistingWell, now: determinedAt },
        { fetchText, allowWebSearch, maxRequests: 4 },
      ),
      (value) => !value
        ? { status: 'not_run' as const, detail: 'The septic lane did not run.', sourcesRead: 0 }
        : {
            status: value.authority ? 'complete' as const : 'no_source_found' as const,
            detail: value.authority ? 'Onsite wastewater authority established.' : 'No onsite wastewater authority was established.',
            sourcesRead: value.authority ? 1 : 0,
          },
      null,
    ),
  ]);

  const stateFramework = stateLane.value ?? {
    state: state ?? '',
    status: 'unverified' as const,
    provisions: [],
    localAuthorityRetained: unresolvedValue<string>('No state was established, so the statewide framework was not researched.'),
    sourcesSearched: [],
    searchedAt: determinedAt,
  };
  const local: LocalResearchResult = localLane.value ?? {
    codeSources: [], documents: [], zoningAuthority: null, subdivisionAuthority: null,
    officialSites: [], notes: ['The local research lane did not run.'], unreadable: [], paidAccessBlocked: [],
  };
  const access = accessLane.value ?? await researchAccess(
    { address, state, county, hasImprovements: subject.hasImprovements, now: determinedAt },
    { fetchText, allowWebSearch: false },
  );
  const septicWell = septicLane.value ?? await researchSepticAuthority(
    { county, state, hasExistingSeptic: subject.hasExistingSeptic, hasExistingWell: subject.hasExistingWell, now: determinedAt },
    { fetchText, allowWebSearch: false },
  );

  /* Re-resolve the authority stack now that the lanes have answered. */
  const authority = resolveAuthorityStack({
    county, state, city: subject.city,
    jurisdictionClues: handoff?.jurisdictionClues ?? [],
    gisIncorporatedStatus: null,
    gisLocalGovernment: null,
    gisSourceUrl: handoff?.officialParcelSourceUrl ?? null,
    geography,
    zoningAuthorityFinding: local.zoningAuthority,
    subdivisionAuthorityFinding: local.subdivisionAuthority,
    septicAuthorityFinding: septicWell.authority
      ? { body: String(septicWell.authority.name.value ?? ''), citations: septicWell.authority.name.citations, url: septicWell.authority.officialUrl }
      : null,
    roadAuthorityFinding: access.accessAuthority
      ? { body: String(access.accessAuthority.name.value ?? ''), citations: access.accessAuthority.name.citations, url: access.accessAuthority.officialUrl }
      : null,
    stateFrameworkPresent: frameworkHasLandDivisionBaseline(stateFramework),
    statePreemptionPresent: frameworkHasPreemption(stateFramework),
    now: determinedAt,
  });

  const noConventionalZoning = local.zoningAuthority?.noConventionalZoning ?? false;
  const effectiveDate = local.codeSources[0]?.codifiedThrough ?? null;

  const zoning = assembleZoning({
    handoff,
    zoningAuthorityBody: local.zoningAuthority?.body ?? null,
    noConventionalZoning,
    noZoningCitations: local.zoningAuthority?.citations ?? [],
    now: determinedAt,
  });

  /* Uses. Every structure type is evaluated separately against the retrieved
     law, including the ones the ordinance never mentions. */
  const statePreemption = stateFramework.provisions.find((provision) => provision.kind === 'manufactured_housing_preemption') ?? null;
  const uses: UseDetermination[] = STRUCTURE_TYPES.map((structureType) => {
    const finding = classifyStructureStatus(structureType, local.documents, determinedAt, effectiveDate);
    const citations = dedupeCitations(finding.hits.map((hit) => buildCitation({
      url: hit.document.url, label: hit.document.title, citation: hit.match.section,
      excerpt: hit.match.excerpt, format: 'html', tierHint: 'zoning_ordinance',
      effectiveDate, retrievedAt: determinedAt,
    })));
    const isManufactured = MANUFACTURED_STRUCTURE_TYPES.includes(structureType);
    return {
      structureType,
      status: finding.status,
      quality: finding.status === 'unverified' ? 'unverified'
        : citations.length > 1 ? 'verified_multiple_official' : 'verified_official',
      citations,
      conditions: finding.conditions,
      reasoning: noConventionalZoning && finding.status === 'unverified'
        ? 'No conventional zoning applies here, so no zoning district permits or prohibits this structure type. Building, health and access rules still apply and are reported separately.'
        : finding.reasoning,
      unresolvedReason: finding.status === 'unverified'
        ? (noConventionalZoning
            ? 'No zoning determines this. Confirm building-permit and onsite-sewage requirements with the county before relying on it.'
            : 'No provision establishing the legal status of this structure type was located in the adopted law LandOS read.')
        : null,
      statePreemption: isManufactured
        ? statePreemption
          ? {
              effect: 'local_regulation_limited_to_objective_standards' as const,
              statement: statePreemption.summary,
              citations: [statePreemption.citation],
              interaction: 'A state provision limiting local exclusion of manufactured homes was located. It must be read together with the local rule, and it may restrict what the local unit can lawfully prohibit.',
            }
          : {
              effect: 'no_state_provision_found' as const,
              statement: 'No state provision limiting local regulation of manufactured homes was located.',
              citations: [],
              interaction: 'No state limit was established, so the local rule was not treated as constrained by one. Absence of a located provision is not proof that none exists.',
            }
        : null,
    };
  });

  /* Dimensional standards and the subdivision framework. */
  const dimensionalStandards = extractDimensionalStandards(local.documents, determinedAt, effectiveDate);
  const assembled = assembleSubdivisionFramework({
    documents: local.documents,
    governingBody: local.subdivisionAuthority?.body ?? null,
    ordinanceLabel: local.codeSources[0]?.jurisdictionLabel ?? null,
    ordinanceUrl: local.codeSources[0]?.url ?? null,
    dimensionalStandards,
    determinedAt,
    effectiveDate,
    stateHighwayAccessImplication: access.status === 'new_access_permit_dependent'
      ? evidencedValue(
          'A new access point onto the state-maintained route requires a permit from the highway authority, so any division that needs one is permit-dependent.',
          access.drivewayPermitRequired.citations,
        )
      : unresolvedValue<string>('No state-highway access implication for a division was established.'),
  });
  const { paths, parentTract, subdivision } = assembled;

  /* MANDATORY COUNTY FALLBACK.
     The engine must make a genuine effort at the real authority first — it just
     did, across the local unit's own site and its adopted code. What it must
     never do is hand an operator only "unknown". When no body that approves
     land division was established, the county's own current minor-subdivision /
     land-division rules are retrieved so there is something usable on the page,
     under a label that says plainly it is not controlling. */
  const countySubdivisionFallback = local.subdivisionAuthority
    ? null
    : await researchCountySubdivisionFallback(
      {
        county: geography?.county ?? county,
        state,
        localUnitName: provisionalAuthority.localUnit.name.value,
        localUnitType: provisionalAuthority.localUnit.unitType,
        localResult: local,
        determinedAt,
        stateHighwayAccessImplication: assembled.subdivision.stateHighwayAccessImplication,
      },
      { fetchText, allowWebSearch, maxRequests, siteCache },
    );

  /* Precedence. */
  const precedence = buildPrecedence({
    stateFramework, subdivision, authority, statePreemptionPresent: frameworkHasPreemption(stateFramework),
  });

  /* Yield and scenarios. */
  const minimumLotAcres = standardToAcres(findStandard(dimensionalStandards, 'minimum_lot_area'));
  const legalYield = computeLegalYield({
    parcelAcres: acres,
    paths,
    standards: dimensionalStandards,
    parentTract,
    noConventionalZoning,
    subdivisionAuthorityUnresolved: !local.subdivisionAuthority,
  });

  const siteFacts: Array<{ factor: string; observation: string; source: string }> = [];
  if (subject.hasImprovements) siteFacts.push({ factor: 'Improvements', observation: 'The parcel carries existing improvements.', source: 'LandOS property record' });
  if (subject.hasExistingWell) siteFacts.push({ factor: 'Well', observation: 'A well is reported on the property.', source: 'seller reported' });
  if (subject.hasExistingSeptic) siteFacts.push({ factor: 'Septic', observation: 'A septic system is reported on the property.', source: 'seller reported' });
  if (handoff?.geometry) {
    siteFacts.push({
      factor: 'Parcel geometry',
      observation: `Official parcel geometry retained (${handoff.geometry.vertexCount} vertices).`,
      source: handoff.officialParcelSourceUrl ?? 'official parcel source',
    });
  }

  const physicalYield = computePhysicalYield({
    parcelAcres: acres,
    legal: legalYield,
    siteFacts,
    roadFrontageStated: null,
    minimumFrontage: findStandard(dimensionalStandards, 'minimum_road_frontage'),
    limitingFactors: [
      ...(access.status !== 'existing_access_verified' ? ['Access for any additional lot is not verified.'] : []),
      ...(septicWell.authority ? [] : ['The onsite wastewater authority is unresolved, so per-lot septic feasibility is unscreened.']),
    ],
  });

  const carveouts = buildCarveoutConcepts({
    parcelAcres: acres,
    hasImprovements: subject.hasImprovements,
    minimumLotAcres,
    minimumLotStandard: findStandard(dimensionalStandards, 'minimum_lot_area'),
    siteConstraints: [
      ...(subject.hasExistingSeptic ? [{ factor: 'Septic location', detail: 'The septic system and its replacement area are not located on a survey.', known: false }] : []),
      ...(subject.hasExistingWell ? [{ factor: 'Well location', detail: 'The well location and its separation distances are not surveyed.', known: false }] : []),
      { factor: 'Parcel geometry', detail: 'No survey establishes where a retained lot boundary could physically go.', known: false },
    ],
    sellerDiscussedAcres: subject.sellerDiscussedCarveoutAcres,
  });

  const globalVerification = [
    ...(legalYield.status !== 'established' ? [legalYield.reason] : []),
    ...access.constraintNotes.slice(0, 2),
    ...septicWell.unresolved.slice(0, 2),
  ];

  const scenarios = buildScenarios({
    parcelAcres: acres,
    hasImprovements: subject.hasImprovements,
    legal: legalYield,
    physical: physicalYield,
    carveouts,
    uses,
    paths,
    accessConstraint: access.constraintNotes[0] ?? 'Access constraints were not established.',
    globalVerification,
  });

  const discoveryQuestions = buildDiscoveryQuestions({
    parentTractHistoryRequired: parentTract.priorDivisionHistoryRequired,
    surveyUnknown: true,
    accessAgreementsUnknown: true,
    drivewayPermitUnknown: subject.hasImprovements,
    wellSepticLocationUnknown: subject.hasExistingWell || subject.hasExistingSeptic,
    reserveFieldUnknown: subject.hasExistingSeptic,
    utilitiesUnknown: true,
    privateRestrictionsUnknown: true,
    manufacturedHomePresent: false,
  });

  /* Honest states. */
  const failureStates = collectFailureStates({
    zoning, authority, legalYield, parentTract, subdivision, access, septicWell,
    stateFrameworkStatus: stateFramework.status,
    uses,
    unreadable: local.unreadable,
    paidBlocked: local.paidAccessBlocked,
    noSourceFound: local.documents.length === 0,
  });

  const unresolved = collectUnresolved({ zoning, authority, subdivision, legalYield, access, septicWell, uses, stateFramework, countySubdivisionFallback });

  const sources = dedupeCitations([
    ...stateFramework.provisions.map((provision) => provision.citation),
    ...(authority.zoningAuthority.name.citations ?? []),
    ...(authority.subdivisionAuthority.name.citations ?? []),
    ...uses.flatMap((use) => use.citations),
    ...dimensionalStandards.map((standard) => standard.citation),
    ...paths.flatMap((path) => path.citations),
    ...(access.accessAuthority?.name.citations ?? []),
    ...(septicWell.authority?.name.citations ?? []),
  ]);

  const privateRestrictions: PrivateRestrictionFinding[] = [{
    status: 'not_researched',
    kind: 'unknown',
    statement: 'Deed restrictions, covenants and HOA rules are private and are not zoning. This sprint did not research them, and their absence here is not evidence that none exist.',
    sourceUrl: null,
  }];

  const landUseSubject: LandUseSubject = {
    dealCardId: subject.dealCardId,
    parcelId: handoff?.subject.parcelId ?? subject.apn,
    address: geography?.matchedAddress ?? address,
    city: subject.city,
    // The federally-resolved county, for the same reason the lanes use it: a
    // record with a blank county still has one, and the operator has to see it.
    county: geography?.county ?? county,
    state,
    acres,
    latitude: geography?.latitude ?? subject.latitude,
    longitude: geography?.longitude ?? subject.longitude,
    hasImprovements: subject.hasImprovements,
    sellerReported: subject.sellerReported,
  };

  const lanes = [stateLane.outcome, localLane.outcome, accessLane.outcome, septicLane.outcome];

  const determination: LandUseDetermination = {
    version: 1,
    subject: landUseSubject,
    authority,
    stateFramework,
    zoning,
    uses,
    privateRestrictions,
    dimensionalStandards,
    subdivision,
    countySubdivisionFallback,
    access,
    septicWell,
    precedence,
    legalYield,
    physicalYield,
    carveouts,
    scenarios,
    discoveryQuestions,
    unresolved,
    failureStates,
    sources,
    lanes,
    determinedAt,
  };

  if (deps.persist !== false) {
    try {
      saveLandUseDetermination(subject.dealCardId, determination);
    } catch (error) {
      logger.warn({ event: 'land_use_persist_failed', dealCardId: subject.dealCardId, msg: (error as Error).message }, 'land_use_persist_failed');
    }
  }

  logger.info({
    event: 'land_use_run',
    dealCardId: subject.dealCardId,
    zoning: zoning.presence,
    pattern: authority.pattern,
    legalYield: legalYield.status,
    failures: failureStates.length,
  }, 'land_use_run');

  return { determination, lanes };
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

function dimensionalStandardValue(standards: readonly import('./land-use-types.js').DimensionalStandard[], kind: import('./land-use-types.js').DimensionalStandardKind) {
  const standard = findStandard(standards, kind);
  if (!standard) {
    return unresolvedValue<string>(`No ${kind.replace(/_/g, ' ')} was located in the adopted law LandOS read.`);
  }
  return evidencedValue(standard.statedValue, [standard.citation]);
}

function buildPrecedence(input: {
  stateFramework: LandUseDetermination['stateFramework'];
  subdivision: SubdivisionFramework;
  authority: LandUseDetermination['authority'];
  statePreemptionPresent: boolean;
}): RulePrecedenceRecord[] {
  const records: RulePrecedenceRecord[] = [];

  for (const provision of input.stateFramework.provisions) {
    records.push({
      authorityLevel: 'state',
      governingBody: input.authority.state.name.value ?? input.stateFramework.state,
      ruleType: provision.kind === 'manufactured_housing_preemption' ? 'preemption'
        : provision.kind === 'zoning_enabling_act' ? 'zoning_district'
          : 'land_division',
      citation: provision.citation.citation,
      effectiveDate: provision.citation.effectiveDate,
      stateIsBaseline: provision.kind !== 'manufactured_housing_preemption',
      localSupplementsState: true,
      localMoreRestrictiveWhereAuthorized: provision.kind !== 'manufactured_housing_preemption',
      statePreemptionRelevant: provision.kind === 'manufactured_housing_preemption',
      unresolvedConflict: null,
    });
  }

  if (input.subdivision.governingBody) {
    records.push({
      authorityLevel: input.authority.subdivisionAuthority.unitType === 'county' ? 'county' : 'local',
      governingBody: input.subdivision.governingBody,
      ruleType: 'subdivision_procedure',
      citation: input.subdivision.ordinanceLabel,
      effectiveDate: null,
      stateIsBaseline: input.stateFramework.status === 'present',
      localSupplementsState: input.stateFramework.status === 'present',
      localMoreRestrictiveWhereAuthorized: true,
      statePreemptionRelevant: input.statePreemptionPresent,
      unresolvedConflict: null,
    });
  }

  return records;
}

function collectFailureStates(input: {
  zoning: ZoningDetermination;
  authority: LandUseDetermination['authority'];
  legalYield: LandUseDetermination['legalYield'];
  parentTract: ParentTractFramework;
  subdivision: SubdivisionFramework;
  access: LandUseDetermination['access'];
  septicWell: LandUseDetermination['septicWell'];
  stateFrameworkStatus: LandUseDetermination['stateFramework']['status'];
  uses: readonly UseDetermination[];
  unreadable: ReadonlyArray<{ url: string; reason: string }>;
  paidBlocked: ReadonlyArray<{ url: string; detail: string }>;
  noSourceFound: boolean;
}): LandUseFailureState[] {
  const states = new Set<LandUseFailureState>();

  if (input.zoning.presence === 'no_conventional_zoning') states.add('NO_CONVENTIONAL_ZONING_VERIFIED');
  if (input.zoning.presence === 'zoning_unverified') states.add('ZONING_DISTRICT_UNVERIFIED');
  if (input.authority.zoningAuthority.name.value == null) states.add('ZONING_AUTHORITY_UNRESOLVED');
  if (input.authority.subdivisionAuthority.name.value == null) states.add('SUBDIVISION_AUTHORITY_UNRESOLVED');
  if (input.stateFrameworkStatus === 'not_found') states.add('STATE_FRAMEWORK_NOT_FOUND');
  if (!input.subdivision.paths.some((path) => path.maximumLots.value != null)) states.add('MINOR_SUBDIVISION_THRESHOLD_UNVERIFIED');
  if (input.parentTract.priorDivisionHistoryRequired) states.add('PRIOR_DIVISION_HISTORY_REQUIRED');
  if (statusFor(input.uses, 'manufactured_single_wide') === 'unverified') states.add('MANUFACTURED_SINGLE_WIDE_STATUS_UNVERIFIED');
  if (statusFor(input.uses, 'manufactured_double_wide') === 'unverified') states.add('MANUFACTURED_DOUBLE_WIDE_STATUS_UNVERIFIED');
  if (!input.septicWell.authority) states.add('SEPTIC_AUTHORITY_UNRESOLVED');
  if (input.access.drivewayPermitRequired.value === true) states.add('STATE_HIGHWAY_ACCESS_PERMIT_REQUIRED');
  if (input.legalYield.status === 'unresolved') states.add('LEGAL_MAXIMUM_UNRESOLVED');
  if (input.unreadable.length) states.add('ORDINANCE_DOCUMENT_UNREADABLE');
  if (input.paidBlocked.length) states.add('PAID_ACCESS_REQUIRES_OPERATOR_APPROVAL');
  if (input.noSourceFound) states.add('ORDINANCE_SOURCE_NOT_FOUND');

  // A conflict anywhere is escalated, because a silently chosen side is the
  // one outcome this engine must never produce.
  const conflicted = [
    input.subdivision.minimumLotArea, input.subdivision.minimumRoadFrontage,
    input.subdivision.minimumLotWidth, input.zoning.code,
  ].some((value) => value.quality === 'conflicting_official');
  if (conflicted) states.add('RULE_CONFLICT_REQUIRES_VERIFICATION');

  return [...states];
}

function collectUnresolved(input: {
  zoning: ZoningDetermination;
  authority: LandUseDetermination['authority'];
  subdivision: SubdivisionFramework;
  legalYield: LandUseDetermination['legalYield'];
  access: LandUseDetermination['access'];
  septicWell: LandUseDetermination['septicWell'];
  uses: readonly UseDetermination[];
  stateFramework: LandUseDetermination['stateFramework'];
  countySubdivisionFallback: CountySubdivisionFallback | null;
}): string[] {
  const unresolved: string[] = [];
  const push = (value: string | null | undefined) => { if (value && !unresolved.includes(value)) unresolved.push(value); };

  // The fallback never closes the jurisdiction question; it only stops the page
  // from reading "unknown". The blocker leads the list for as long as it is in
  // use, so nothing downstream can mistake county rules for controlling rules.
  if (input.countySubdivisionFallback) {
    push(`${COUNTY_SUBDIVISION_FALLBACK_BLOCKER}. ${input.countySubdivisionFallback.summary}`);
  }
  push(input.authority.zoningAuthority.name.unresolvedReason);
  push(input.authority.subdivisionAuthority.name.unresolvedReason);
  push(input.zoning.code.unresolvedReason);
  push(input.stateFramework.localAuthorityRetained.unresolvedReason);
  push(input.subdivision.minimumLotArea.unresolvedReason);
  push(input.subdivision.minimumRoadFrontage.unresolvedReason);
  push(input.subdivision.flagLots.unresolvedReason);
  push(input.subdivision.privateRoads.unresolvedReason);
  push(input.subdivision.parentTract.applies.unresolvedReason);
  if (input.legalYield.status !== 'established') push(input.legalYield.reason);
  for (const note of input.access.constraintNotes) push(note);
  for (const note of input.septicWell.unresolved) push(note);
  for (const use of input.uses) {
    if (use.status === 'unverified' && use.unresolvedReason) {
      push(`${use.structureType.replace(/_/g, ' ')}: ${use.unresolvedReason}`);
    }
  }
  return unresolved;
}

export type { CensusGeography };
