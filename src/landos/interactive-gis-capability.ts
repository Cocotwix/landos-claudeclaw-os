// LandOS — running the interactive GIS session for a Deal Card, and admitting
// what it found as canonical zoning evidence.
//
// This is the seam between the platform-neutral session contract and LandOS's
// own stores. The session decides whether a reading is ADMISSIBLE; this module
// decides what LandOS then DOES with it, which is a different question and is
// deliberately kept on this side of the boundary.
//
// SOURCE REGISTRY, NOT HARDCODED BEHAVIOUR. Which application publishes a
// jurisdiction's official zoning map is a FACT about that jurisdiction, in the
// same way `county-gis-capabilities.ts` already records county service URLs as
// data. It is recorded here as data — an app URL, a web map id, a parcel layer,
// and the date the governing regime took effect — and every jurisdiction runs
// the same code over its own row. Nothing about a specific city is expressed as
// logic, and a jurisdiction with no row is reported honestly rather than
// guessed at.

import { logger } from '../logger.js';
import {
  emptyZoningStandards,
  type CurrentZoningDetermination,
} from './current-zoning-determination.js';
import type { PropertyIdentityVersion } from './property-summary-slice.js';
import type { ZoningCollectorInput } from './zoning-operator.js';
import {
  DEFAULT_GIS_SESSION_STEPS,
  runInteractiveGisSession,
  screenshotProves,
  assessZoningCurrency,
  type GisBrowserExecutor,
  type GisEvidence,
  type GisSessionResult,
  type GisSubject,
} from './interactive-gis-session.js';

/** One jurisdiction's official interactive zoning map, as data. */
export interface MunicipalGisSource {
  municipality: string;
  state: string;
  /** Operator-facing name of the publishing authority. */
  sourceLabel: string;
  /** The application an operator would open. */
  appUrl: string;
  portalUrl: string;
  webMapItemId: string;
  /** The layer whose features carry parcel identity and the district value. */
  parcelLayerUrl: string;
  /**
   * When the zoning regime now in force was adopted.
   *
   * The session compares layer vintage against this. Without it, no layer can
   * establish CURRENT zoning — which is the correct default, not a gap.
   */
  regimeAdoptedAt: string | null;
  /** How the authority describes the district field to the public. */
  districtNoun: string;
}

/**
 * Known official municipal zoning applications.
 *
 * Fairview's row records a real and slightly awkward fact: the city publishes
 * TWO official zoning layers. The long-standing "Fairview Zoning" layer was
 * last edited before the 2 April 2026 Development Code took effect, and the
 * character-district map published for that adoption is the one in force. The
 * registry points at the current one; the session's vintage check is what
 * stops the superseded layer being quoted as current if they are ever swapped.
 */
export const MUNICIPAL_GIS_SOURCES: readonly MunicipalGisSource[] = [
  {
    municipality: 'Fairview',
    state: 'TN',
    sourceLabel: 'City of Fairview official zoning map (Fairview Character Districts - Public)',
    appUrl: 'https://fairviewtn.maps.arcgis.com/apps/mapviewer/index.html?webmap=11d597029c074ceb8aba8a8d0c983e21',
    portalUrl: 'https://fairviewtn.maps.arcgis.com',
    webMapItemId: '11d597029c074ceb8aba8a8d0c983e21',
    parcelLayerUrl: 'https://services6.arcgis.com/sCdesv1knCIWF2x3/arcgis/rest/services/NZM_Test_2/FeatureServer/31',
    regimeAdoptedAt: '2026-04-02T00:00:00.000Z',
    districtNoun: 'Character District',
  },
];

export function findMunicipalGisSource(
  municipality: string | null | undefined,
  state: string | null | undefined,
): MunicipalGisSource | null {
  const city = String(municipality ?? '').trim().toLowerCase();
  const st = String(state ?? '').trim().toUpperCase();
  if (!city || !st) return null;
  return MUNICIPAL_GIS_SOURCES.find(
    (source) => source.municipality.toLowerCase() === city && source.state === st,
  ) ?? null;
}

export interface InteractiveGisZoningResult {
  session: GisSessionResult;
  determination: CurrentZoningDetermination | null;
  /** Screenshots that actually prove the layer they are offered for. */
  provingScreenshots: string[];
  notes: string[];
}

/**
 * Turn an admissible GIS reading into a current-zoning determination.
 *
 * Returns `null` rather than an unestablished determination when the reading
 * cannot carry currency: an unresolved answer already has an owner elsewhere in
 * the stack, and writing a hollow record here would overwrite it with less.
 */
export function determinationFromGisEvidence(input: {
  dealCardId: number;
  evidence: GisEvidence;
  source: MunicipalGisSource;
  now?: () => string;
}): CurrentZoningDetermination | null {
  const { evidence, source } = input;
  const now = input.now ?? (() => new Date().toISOString());

  const currency = assessZoningCurrency({
    layerLastEditedAt: evidence.layerLastEditedAt,
    regimeAdoptedAt: source.regimeAdoptedAt,
  });
  if (!currency.establishesCurrent || !evidence.value) return null;
  if (!evidence.subject.confirmed) return null;

  const limitations: string[] = [
    currency.statement,
    `Read from the ${source.districtNoun.toLowerCase()} layer "${evidence.layerName}" in the authority's own published map application.`,
  ];
  if (!evidence.screenshots.length) {
    limitations.push('No screenshot of the map was retained for this reading.');
  }

  return {
    dealCardId: input.dealCardId,
    established: true,
    districtCode: evidence.value,
    districtName: evidence.legendLabel ?? evidence.value,
    overlays: [],
    authorityName: source.sourceLabel,
    authorityDetermination: 'confirmed',
    // The authority's own parcel-level GIS is the strongest zoning evidence
    // kind the determination model recognises.
    evidenceKind: 'parcel_zoning_gis',
    sourceLabel: source.sourceLabel,
    sourceUrl: evidence.appUrl,
    parcelMatchBasis: evidence.subject.statement,
    effectiveOrAsOf: source.regimeAdoptedAt,
    verifiedAt: now(),
    confidence: 'confirmed',
    conflicts: [],
    historicalReferences: [],
    requestedZoning: [],
    standards: emptyZoningStandards(),
    limitations,
    consideredEvidence: [],
  };
}

/**
 * Retain the map capture as a Deal Card zoning ARTIFACT.
 *
 * The determination alone tells the operator the district; it does not let them
 * look at what the machine looked at. `persistCurrentZoning` writes derived
 * evidence whose `artifact_ref` is structurally null, so a screenshot admitted
 * that way is retained on disk and reachable from nowhere. The zoning-collector
 * store is the one path in this repo where a file, an append-only evidence row
 * and a served route line up, so the capture goes there and becomes something
 * the operator can open.
 *
 * Refuses on an unconfirmed identity, which the collector store enforces too:
 * an artifact filed against the wrong parcel is worse than no artifact.
 */
export function gisZoningCollectorInput(input: {
  identity: PropertyIdentityVersion;
  evidence: GisEvidence;
  source: MunicipalGisSource;
  screenshotPath: string;
}): ZoningCollectorInput | null {
  const { evidence, source } = input;
  if (!evidence.subject.confirmed || !evidence.value) return null;
  if (input.identity.status !== 'confirmed') return null;

  const jurisdiction = `${source.municipality}, ${source.state}`;
  const artifactKey = `gis-zoning-${source.webMapItemId}-${evidence.value}`;

  return {
    identity: input.identity,
    domain: 'zoning_district',
    sourceJurisdiction: jurisdiction,
    platform: 'arcgis',
    adapterKey: 'interactive-gis-session',
    status: 'succeeded',
    outcomeKind: 'completed',
    claims: [{
      claimKey: `current-zoning-district:${evidence.value}`,
      exactWording: `${source.districtNoun} ${evidence.value}`,
      normalizedValue: { districtCode: evidence.value, districtName: evidence.legendLabel ?? evidence.value },
      domain: 'zoning_district',
      locatorStatus: 'record_located',
      sourceKind: 'official_gis',
      authorityLevel: 'municipality',
      authorityName: source.sourceLabel,
      sourceName: `${evidence.appTitle ?? source.sourceLabel} — layer "${evidence.layerName}"`,
      sourceUrl: evidence.appUrl,
      sourceJurisdiction: jurisdiction,
      sourceTier: 'official_government_source',
      confidence: 'high',
      retrievedAt: evidence.retrievedAtIso,
      effectiveAt: source.regimeAdoptedAt,
      districtCode: evidence.value,
      districtName: evidence.legendLabel ?? evidence.value,
      artifactKey,
    }],
    artifacts: [{
      artifactKey,
      domain: 'zoning_district',
      sourceJurisdiction: jurisdiction,
      authorityName: source.sourceLabel,
      sourceName: evidence.appTitle ?? source.sourceLabel,
      sourceUrl: evidence.appUrl,
      districtReference: evidence.value,
      ordinanceEffectiveDate: source.regimeAdoptedAt,
      documentType: 'official_zoning_map_capture',
      mimeType: 'image/png',
      displayName: `${source.municipality} ${source.districtNoun} map — subject parcel with "${evidence.layerName}" and legend.png`,
      retrievedAt: evidence.retrievedAtIso,
      pageCount: 1,
      sourcePath: input.screenshotPath,
    }],
    alternateOfficialSourcesChecked: [],
  };
}

export interface RunInteractiveGisZoningInput {
  subject: GisSubject;
  /** Built by the caller against the governed browser. */
  executor: GisBrowserExecutor;
  source?: MunicipalGisSource | null;
  maxInteractions?: number;
  timeoutMs?: number;
  now?: () => string;
}

/**
 * Run the zoning question for one subject, end to end.
 *
 * Every outcome other than a confirmed, current reading returns a `null`
 * determination and says why. That is the point: an interactive GIS session
 * that could not establish the district must leave the record exactly as it
 * found it.
 */
export async function runInteractiveGisZoning(
  input: RunInteractiveGisZoningInput,
): Promise<InteractiveGisZoningResult> {
  const source = input.source ?? findMunicipalGisSource(input.subject.municipality, input.subject.state);
  if (!source) {
    const note = `No official interactive zoning map is registered for ${input.subject.municipality ?? 'this municipality'}, ${input.subject.state ?? ''}. The interactive GIS route cannot run until one is discovered.`;
    return {
      session: { outcome: 'no_relevant_layer', evidence: null, interactionsUsed: 0, notes: [note] },
      determination: null,
      provingScreenshots: [],
      notes: [note],
    };
  }

  const session = await runInteractiveGisSession({
    subject: input.subject,
    question: 'current_zoning',
    appUrl: source.appUrl,
    sourceLabel: source.sourceLabel,
    regimeAdoptedAt: source.regimeAdoptedAt,
    executor: input.executor,
    maxInteractions: input.maxInteractions ?? DEFAULT_GIS_SESSION_STEPS,
    timeoutMs: input.timeoutMs,
    now: input.now,
  });

  const notes = [...session.notes];
  const evidence = session.evidence;
  const provingScreenshots = evidence
    ? evidence.screenshots.filter((shot) => screenshotProves(shot, evidence.layerName)).map((shot) => shot.path)
    : [];

  if (!evidence) {
    logger.info({ event: 'interactive_gis_zoning_no_evidence', outcome: session.outcome }, 'interactive_gis_zoning_no_evidence');
    return { session, determination: null, provingScreenshots, notes };
  }

  const determination = determinationFromGisEvidence({
    dealCardId: input.subject.dealCardId,
    evidence,
    source,
    now: input.now,
  });
  if (!determination) {
    notes.push('The reading was retained as evidence but does not establish the CURRENT district, so no zoning determination was written.');
  }
  return { session, determination, provingScreenshots, notes };
}
