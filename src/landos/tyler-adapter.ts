// LandOS — Tyler iasWorld Public Access family ADAPTER (PART 4).
//
// Deliberately narrower than the ArcGIS and Schneider adapters, and the reason
// is worth stating because it is the whole point of a platform-first design:
//
//   The application CHROME is uniform nationwide — the same search endpoint,
//   the same record-page cell classes, the same script set. So detection and
//   record parsing generalise, and both live here.
//
//   The CONFIGURATION on top of it is local. Whether a cold parcel deep link is
//   permitted, whether a disclaimer gate must be accepted first, and what the
//   record-page vocabulary is are all per-deployment. A single extractor that
//   assumed any of those would be a per-county script wearing a generic name.
//
// So this adapter does three honest things: recognise the family, parse a
// record page when one can be reached, and otherwise record the official source
// and hand the geometry lane to the county GIS — which is where the polygons
// actually live, since this product ships no map of its own.

import {
  type GovFetchText,
  DATALET_ROW,
  defaultGovFetchText,
  extractLabeledPairs,
  extractLinks,
  findLabeledValue,
  htmlToText,
} from './gis-transport.js';
import { EscalationLadder } from './gis-escalation.js';
import { reconcileParcelCandidates } from './gis-identity-reconcile.js';
import {
  type GisFailureState,
  type GisFieldState,
  type NormalizedParcelSearchInput,
  type OfficialParcelGisResult,
  type ParcelCandidate,
  type PlatformFingerprint,
  emptyParcelGisResult,
} from './gis-platform-types.js';

/** Path fragments that identify the product regardless of the app root prefix. */
export const IASWORLD_SEARCH_PATH = /\/search\/commonsearch\.aspx/i;
export const IASWORLD_RECORD_PATH = /\/datalets?\/datalet\.aspx/i;
export const IASWORLD_DISCLAIMER_PATH = /\/search\/disclaimer\.aspx/i;
/** Sent instead of a record when a deployment refuses a cold deep link. */
export const IASWORLD_ACCESS_ERROR = /\/main\/accesserror\.aspx/i;

/**
 * The application root varies (`/`, `/PT/`, `/_web/`, `/PublicAccess/`), so
 * LandOS derives it from an observed URL rather than assuming one.
 */
export function iasWorldAppRoot(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = /^(.*?)\/(search|datalets?)\//i.exec(parsed.pathname);
    if (!match) return null;
    return new URL(`${match[1]}/`, parsed.origin).toString();
  } catch { return null; }
}

/** Cold record deep link. Permitted on some deployments and refused on others. */
export function iasWorldRecordUrl(appRoot: string, parcelId: string, mode = 'profileall'): string {
  const params = new URLSearchParams({ mode, UseSearch: 'no', pin: parcelId });
  return new URL(`Datalets/Datalet.aspx?${params}`, appRoot).toString();
}

export interface IasWorldRecord {
  /** Label/value pairs read from the record grid, vocabulary unmodified. */
  pairs: Array<{ label: string; value: string }>;
  /** The record header line, which carries the parcel id on every deployment. */
  header: string;
  /** Tabs the deployment publishes. Local configuration, discovered not assumed. */
  tabs: string[];
  /** Outbound links, which is where this product puts its GIS. */
  links: Array<{ label: string; url: string }>;
}

export function parseIasWorldRecord(html: string, baseUrl: string): IasWorldRecord {
  const pairs = extractLabeledPairs(html, new RegExp(DATALET_ROW.source, 'gi'));
  const headerMatch = /<tr[^>]*class="[^"]*DataletHeader(Top|Bottom)[^"]*"[^>]*>([\s\S]*?)<\/tr>/i.exec(html);
  const tabs: string[] = [];
  for (const match of html.matchAll(/class="[^"]*(?:SideBarTabs|BannerSubTabs)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = htmlToText(match[1] ?? '');
    if (label && !tabs.includes(label)) tabs.push(label);
  }
  return {
    pairs,
    header: htmlToText(headerMatch?.[2] ?? ''),
    tabs,
    links: extractLinks(html, baseUrl),
  };
}

const LABELS = {
  parcelId: [/^parcel\s*(number|id|#)?$/i, /^parid$/i, /^property\s*(number|id)$/i, /^alternate\s*id$/i],
  address: [/^(parcel|property|site|situs|location)\s*address$/i, /^address$/i, /^location$/i],
  owner: [/^(parcel\s*)?owner(s)?$/i, /^owner\s*name$/i, /^taxpayer$/i],
  acres: [/^acres?$/i, /^acreage$/i, /^land\s*(area|size)$/i],
  municipality: [/^(municipality|tax\s*district|taxing\s*district|township|city|district)$/i],
  propertyClass: [/^(property\s*)?class$/i, /^land\s*use$/i],
  county: [/^county$/i],
} as const;

/** Links a record page publishes that point at a real mapping system. */
export function extractGisHandoffLinks(record: IasWorldRecord): Array<{ label: string; url: string }> {
  return record.links.filter((link) =>
    /gis|map|navigator|arcgis|parcelviewer/i.test(link.url) || /\b(gis|map)\b/i.test(link.label));
}

export interface TylerAdapterInput {
  search: NormalizedParcelSearchInput;
  fingerprint: PlatformFingerprint;
  /** Any observed URL on the deployment; the app root is derived from it. */
  observedUrl: string;
}

export interface TylerAdapterDeps {
  fetchText?: GovFetchText;
  ladder?: EscalationLadder;
  now?: () => string;
}

function acresFrom(value: string | null): number | null {
  if (!value) return null;
  const match = /([\d,]+(?:\.\d+)?)/.exec(value.replace(/,/g, ''));
  const num = match ? Number(match[1]) : NaN;
  return Number.isFinite(num) ? num : null;
}

/**
 * Attempt the cold record deep link, and report honestly when the deployment
 * refuses it. A refusal is a configuration fact about that deployment, not a
 * statement that the parcel does not exist — so it is never reported as
 * PARCEL_NOT_FOUND.
 */
export async function runTylerAdapter(
  input: TylerAdapterInput,
  deps: TylerAdapterDeps = {},
): Promise<OfficialParcelGisResult> {
  const fetchText = deps.fetchText ?? defaultGovFetchText;
  const ladder = deps.ladder ?? new EscalationLadder();
  const now = deps.now ?? (() => new Date().toISOString());
  const failureStates: GisFailureState[] = [];
  const fieldStates: Record<string, GisFieldState> = {
    // A property of the product, not of this parcel: iasWorld carries no map.
    geometry: 'not_exposed_by_deployment',
    zoning: 'not_exposed_by_deployment',
  };

  const base = emptyParcelGisResult({
    sourcePlatform: 'tyler',
    sourcePlatformVariant: input.fingerprint.variant ?? 'iasworld_public_access',
    sourceUrl: input.observedUrl,
    retrievedAt: now(),
    retrievalMethod: 'rendered_dom',
    fieldStates,
  });

  ladder.beginStage('known_adapter');
  const appRoot = iasWorldAppRoot(input.observedUrl);
  const apn = input.search.apn?.trim();

  if (!appRoot || !apn) {
    ladder.endStage('known_adapter', 'no_result',
      !appRoot ? 'Could not derive the application root from the observed URL.' : 'No parcel identifier available for a record lookup.');
    return {
      ...base,
      failureStates: ['PARCEL_NOT_FOUND'],
      retrievalConfidence: 'none',
      unresolvedFields: ['parcelId', 'geometry', 'zoning'],
    };
  }

  const recordUrl = iasWorldRecordUrl(appRoot, apn);
  ladder.noteRequest();
  const page = await fetchText(recordUrl);

  const refusedDeepLink = IASWORLD_ACCESS_ERROR.test(page.url) || /don't have access to requested page/i.test(page.body);
  if (page.blocked || refusedDeepLink) {
    // The stateful route (disclaimer, then a form search, then a session-scoped
    // record link) is browser work and belongs to the escalation ladder, not
    // to a cold HTTP adapter. Say so rather than looping here.
    ladder.endStage('known_adapter', 'failed',
      refusedDeepLink
        ? 'This deployment refuses cold record deep links; the stateful search route is required.'
        : 'The deployment edge refused the transport.');
    return {
      ...base,
      sourceUrl: recordUrl,
      failureStates: refusedDeepLink ? ['INTERACTIVE_GIS_ROUTE_DEFERRED'] : ['OFFICIAL_SOURCE_UNAVAILABLE'],
      retrievalConfidence: 'none',
      unresolvedFields: ['parcelId', 'parcelAddress', 'owner', 'acres', 'geometry', 'zoning'],
    };
  }

  const record = parseIasWorldRecord(page.body, page.url);
  if (!record.pairs.length) {
    ladder.endStage('known_adapter', 'no_result', 'The record page published no readable data grid.');
    return { ...base, sourceUrl: recordUrl, failureStates: ['PARCEL_NOT_FOUND'], retrievalConfidence: 'none', unresolvedFields: ['parcelId'] };
  }

  // The record header carries the parcel id on every deployment, but the label
  // in front of it is local vocabulary: some print "PARID", others "Parcel
  // Number". Keying on one of them would silently lose the identifier — and
  // with it the whole match — on the other.
  const headerParcelId = /(?:PARID|Parcel\s*(?:Number|ID))\s*:\s*([^\s|<]+)/i.exec(record.header)?.[1] ?? null;
  const candidate: ParcelCandidate = {
    parcelId: findLabeledValue(record.pairs, LABELS.parcelId) ?? headerParcelId,
    address: findLabeledValue(record.pairs, LABELS.address),
    owner: findLabeledValue(record.pairs, LABELS.owner),
    acres: acresFrom(findLabeledValue(record.pairs, LABELS.acres)),
    // Never copied from the subject: a self-agreeing dimension is not evidence.
    county: findLabeledValue(record.pairs, LABELS.county),
    state: null,
    handle: apn,
  };

  const reconciliation = reconcileParcelCandidates(input.search, [candidate], { searchWasExact: true });
  if (reconciliation.acceptedIndex == null) {
    ladder.endStage('known_adapter', 'failed', reconciliation.reason);
    return {
      ...base,
      sourceUrl: recordUrl,
      searchMethod: 'apn',
      parcelMatchStatus: reconciliation.status,
      reconciliation,
      failureStates: [reconciliation.status === 'conflict' ? 'PARCEL_IDENTITY_CONFLICT' : 'PARCEL_NOT_FOUND'],
      retrievalConfidence: 'none',
      unresolvedFields: ['parcelId'],
    };
  }

  const municipality = findLabeledValue(record.pairs, LABELS.municipality);
  const unresolved: string[] = ['geometry', 'zoning'];
  for (const [field, value] of [['parcelId', candidate.parcelId], ['parcelAddress', candidate.address], ['owner', candidate.owner], ['acres', candidate.acres]] as const) {
    fieldStates[field] = value == null ? 'unresolved' : 'supported';
    if (value == null) unresolved.push(field);
  }
  failureStates.push('GEOMETRY_UNAVAILABLE', 'ZONING_LAYER_NOT_FOUND');

  ladder.endStage('known_adapter', 'succeeded', `Read the record page; ${record.pairs.length} field(s) and ${record.tabs.length} tab(s) published.`);

  return {
    ...base,
    sourceUrl: recordUrl,
    searchMethod: 'apn',
    parcelMatchStatus: reconciliation.status,
    parcelId: candidate.parcelId,
    parcelAddress: candidate.address,
    owner: candidate.owner,
    acres: candidate.acres,
    geometry: null,
    localGovernment: municipality,
    jurisdictionClues: municipality
      ? [{
          level: 'municipality',
          name: municipality,
          sourceUrl: recordUrl,
          sourceField: 'record label',
          statement: `Official assessment record lists district/municipality = ${municipality}.`,
        }]
      : [],
    zoning: null,
    zoningLayer: null,
    availableLayers: [],
    // The product's own outbound GIS links are the correct next hop for
    // geometry, so they are carried forward rather than discarded.
    officialPlanningLinks: extractGisHandoffLinks(record).slice(0, 5),
    retrievalMethod: 'rendered_dom',
    retrievalConfidence: reconciliation.status === 'verified' ? 'high' : 'medium',
    failureStates,
    fieldStates,
    unresolvedFields: [...new Set(unresolved)],
    reconciliation,
  };
}
