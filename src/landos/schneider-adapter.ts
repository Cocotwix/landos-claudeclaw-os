// LandOS — Schneider Geospatial (Beacon / qPublic) family ADAPTER (PART 5).
//
// One vendor-operated multi-tenant application serving hundreds of county
// deployments through a single URL grammar. That is what makes a generic
// adapter correct here: the jurisdiction is a parameter, not a code path.
//
// Two published artefacts do the work that would otherwise be per-county code:
//
//   1. A nationwide deployment directory, so LandOS resolves county+state to
//      the right application and its search page without scraping.
//   2. A per-page application config object carrying the tab manifest, the
//      search capabilities the deployment actually offers, and a templated
//      parcel deep link — published by the application itself.
//
// What does NOT generalise is the rendered field vocabulary: sections and
// labels follow state law and the local CAMA vendor. So extraction is
// structural (read whatever label/value pairs exist) and every field is
// reported as supported, not-exposed, or unresolved rather than assumed.

import {
  type GovFetchText,
  type LabeledValue,
  TH_TD_ROW,
  defaultGovFetchText,
  extractLabeledPairs,
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

export const SCHNEIDER_HOSTS = ['beacon.schneidercorp.com', 'qpublic.schneidercorp.com'] as const;
/** Both hostnames serve the same multi-tenant application. */
export const SCHNEIDER_PRIMARY_HOST = 'beacon.schneidercorp.com';
export const SCHNEIDER_DIRECTORY_PATH = '/api/globalsearch/framework';

/** Page kinds in the application's own vocabulary. */
export const SCHNEIDER_PAGE_TYPES = { map: 1, search: 2, results: 3, report: 4 } as const;

/* ────────────────────────── URL + config parsing ─────────────────────── */

export interface SchneiderApplicationUrl {
  host: string;
  appId: number | null;
  layerId: number | null;
  pageId: number | null;
  pageTypeId: number | null;
  keyValue: string | null;
}

export function parseSchneiderUrl(url: string): SchneiderApplicationUrl | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (!/schneidercorp\.com$|qpublic\.net$/i.test(parsed.hostname)) return null;
  const num = (key: string): number | null => {
    const raw = parsed.searchParams.get(key);
    const value = raw == null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  return {
    host: parsed.hostname,
    appId: num('AppID') ?? num('AppId') ?? num('appid'),
    layerId: num('LayerID') ?? num('LayerId'),
    pageId: num('PageID') ?? num('PageId'),
    pageTypeId: num('PageTypeID') ?? num('PageTypeId'),
    keyValue: parsed.searchParams.get('KeyValue'),
  };
}

export interface SchneiderMapConfig {
  appId: number | null;
  layerId: number | null;
  tabs: Array<{ name: string; pageId: number; pageTypeId: number }>;
  /** Which search modes this deployment actually publishes. */
  search: { name: boolean; address: boolean; parcelId: boolean; alternateId: boolean };
  /** Deep-link template published by the application, with `{0}` for the key. */
  defaultReportUrlTemplate: string | null;
}

/**
 * Read the application's own config object out of a rendered page.
 *
 * This is the single most valuable thing on a Schneider page: it removes every
 * reason to guess page identifiers or construct a deep link by hand, and it
 * states which search modes exist rather than letting LandOS assume all three.
 */
export function parseSchneiderMapConfig(html: string): SchneiderMapConfig | null {
  const match = /\bmapConfig\s*=\s*(\{[\s\S]*?\})\s*;/.exec(html);
  if (!match) return null;
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(match[1]) as Record<string, unknown>; } catch { return null; }

  const tabsRaw = Array.isArray(raw.Tabs) ? (raw.Tabs as Array<Record<string, unknown>>) : [];
  const searchRaw = (raw.Search ?? {}) as Record<string, unknown>;
  const template = typeof raw.DefaultReportUrl === 'string' ? raw.DefaultReportUrl : null;

  return {
    appId: typeof raw.AppId === 'number' ? raw.AppId : null,
    layerId: typeof raw.LayerId === 'number' ? raw.LayerId : null,
    tabs: tabsRaw
      .filter((tab) => typeof tab.PageId === 'number' && typeof tab.PageTypeId === 'number')
      .map((tab) => ({ name: String(tab.Name ?? ''), pageId: Number(tab.PageId), pageTypeId: Number(tab.PageTypeId) })),
    search: {
      name: searchRaw.Name === true,
      address: searchRaw.Address === true,
      parcelId: searchRaw.ParcelId === true,
      alternateId: searchRaw.AlternateId === true,
    },
    defaultReportUrlTemplate: template,
  };
}

/** Fill the application's own deep-link template with a parcel key. */
export function buildSchneiderReportUrl(config: SchneiderMapConfig, keyValue: string, host = SCHNEIDER_PRIMARY_HOST): string | null {
  if (!config.defaultReportUrlTemplate) return null;
  const path = config.defaultReportUrlTemplate.replace('{0}', encodeURIComponent(keyValue));
  try { return new URL(path, `https://${host}`).toString(); } catch { return null; }
}

/* ─────────────────────── nationwide deployment directory ─────────────── */

export interface SchneiderDeployment {
  appId: number;
  displayName: string;
  state: string;
  /** Search page for the deployment, from the directory's quickstart entries. */
  searchUrl: string | null;
  mapUrl: string | null;
}

interface DirectoryPayload {
  States?: Array<{ Name?: string; Apps?: Array<{ ID?: number; DisplayName?: string; Name?: string }> }>;
  Quickstart?: Record<string, Array<{ Description?: string; URL?: string }>>;
}

/**
 * Turn the vendor directory into deployments LandOS can select from. This is
 * PLATFORM knowledge: it is identical for every property and is cached once,
 * never per deal.
 */
export function parseSchneiderDirectory(payload: unknown): SchneiderDeployment[] {
  const data = payload as DirectoryPayload;
  const quickstart = data?.Quickstart ?? {};
  const out: SchneiderDeployment[] = [];
  for (const state of data?.States ?? []) {
    for (const app of state.Apps ?? []) {
      if (typeof app.ID !== 'number') continue;
      const entries = quickstart[String(app.ID)] ?? [];
      const pick = (pattern: RegExp): string | null => {
        const hit = entries.find((entry) => pattern.test(String(entry.Description ?? '')));
        if (!hit?.URL) return null;
        try { return new URL(hit.URL, `https://${SCHNEIDER_PRIMARY_HOST}/`).toString(); } catch { return null; }
      };
      out.push({
        appId: app.ID,
        displayName: String(app.DisplayName ?? app.Name ?? ''),
        state: String(state.Name ?? ''),
        searchUrl: pick(/search/i),
        mapUrl: pick(/map/i),
      });
    }
  }
  return out;
}

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AR: 'Arkansas', CO: 'Colorado', CT: 'Connecticut', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii',
  IA: 'Iowa', IL: 'Illinois', IN: 'Indiana', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', MI: 'Michigan',
  MN: 'Minnesota', MO: 'Missouri', ND: 'North Dakota', NE: 'Nebraska', NC: 'North Carolina', NY: 'New York',
  OH: 'Ohio', OK: 'Oklahoma', PA: 'Pennsylvania', SC: 'South Carolina', SD: 'South Dakota', VA: 'Virginia',
  WI: 'Wisconsin', WV: 'West Virginia', WY: 'Wyoming',
};

/** Find the deployment serving a county. Match is on the vendor's own label. */
export function findSchneiderDeployment(
  deployments: readonly SchneiderDeployment[],
  county: string | undefined,
  state: string | undefined,
): SchneiderDeployment | null {
  const countyToken = (county ?? '').trim().replace(/\s*county\s*$/i, '').toLowerCase();
  if (!countyToken) return null;
  const stateCode = (state ?? '').trim().toUpperCase();
  const stateName = STATE_NAMES[stateCode] ?? stateCode;
  const inState = deployments.filter((d) => !stateName || d.state.toLowerCase() === stateName.toLowerCase());
  const pool = inState.length ? inState : deployments;
  return pool.find((d) => d.displayName.toLowerCase().startsWith(`${countyToken} county`))
    ?? pool.find((d) => d.displayName.toLowerCase().includes(countyToken))
    ?? null;
}

/* ───────────────────────── report page extraction ────────────────────── */

export interface SchneiderReport {
  pairs: LabeledValue[];
  /** Section titles the deployment publishes, in order. */
  sections: string[];
  title: string;
}

/** Read a parcel report structurally, without assuming any label vocabulary. */
export function parseSchneiderReport(html: string): SchneiderReport {
  const pairs = extractLabeledPairs(html, new RegExp(TH_TD_ROW.source, 'gi'));
  const sections: string[] = [];
  for (const match of html.matchAll(/<div[^>]*class="[^"]*module-header[^"]*"[^>]*>[\s\S]*?<h2[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h2>/gi)) {
    const label = htmlToText(match[1] ?? '');
    if (label) sections.push(label);
  }
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return { pairs, sections, title: htmlToText(titleMatch?.[1] ?? '') };
}

/** Label patterns for the few fields LandOS needs. Everything else stays raw. */
const LABELS = {
  parcelId: [/^parcel\s*(id|number|#)?$/i, /^pin$/i, /^tax\s*id$/i, /^property\s*(id|number)$/i, /^alternate\s*id$/i],
  address: [/^(situs|property|physical|location)\s*address$/i, /^address$/i, /^location$/i],
  owner: [/^owner(s|\s*name)?$/i, /^primary\s*owner$/i, /^taxpayer$/i],
  acres: [/^(deeded\s*)?acres?$/i, /^acreage$/i, /^land\s*area$/i, /^calculated\s*acres$/i],
  zoning: [/^zoning$/i, /^zone$/i, /^zoning\s*(code|district|class)$/i],
  municipality: [/^(municipality|township|city|town|district|tax\s*district)$/i],
  legal: [/^legal\s*description$/i],
  county: [/^county$/i],
} as const;

function acresFrom(value: string | null): number | null {
  if (!value) return null;
  const match = /([\d,]+(?:\.\d+)?)/.exec(value.replace(/,/g, ''));
  const num = match ? Number(match[1]) : NaN;
  return Number.isFinite(num) ? num : null;
}

/* ──────────────────────────── the adapter ────────────────────────────── */

export interface SchneiderAdapterInput {
  search: NormalizedParcelSearchInput;
  fingerprint: PlatformFingerprint;
  /** A known application URL for the jurisdiction, when one is already held. */
  applicationUrl?: string | null;
}

export interface SchneiderAdapterDeps {
  /** Must be a browser-class transport; a plain server fetch is refused by the edge. */
  fetchText?: GovFetchText;
  ladder?: EscalationLadder;
  now?: () => string;
  /** Injected so the nationwide directory is fetched once, not per property. */
  loadDirectory?: () => Promise<SchneiderDeployment[]>;
}

/**
 * Resolve the deployment, open the parcel report through the application's own
 * deep link, and normalize what it publishes.
 *
 * Geometry is deliberately absent: this family serves attribute pages over its
 * own tile stack and does not publish parcel polygons. That is reported as
 * `not_exposed_by_deployment`, and the parcel-geometry lane falls back to the
 * county's separate GIS rather than pretending otherwise.
 */
export async function runSchneiderAdapter(
  input: SchneiderAdapterInput,
  deps: SchneiderAdapterDeps = {},
): Promise<OfficialParcelGisResult> {
  const fetchText = deps.fetchText ?? defaultGovFetchText;
  const ladder = deps.ladder ?? new EscalationLadder();
  const now = deps.now ?? (() => new Date().toISOString());
  const failureStates: GisFailureState[] = [];
  const fieldStates: Record<string, GisFieldState> = {
    // Stated up front, because it is a property of the family and not a
    // retrieval failure for this particular parcel.
    geometry: 'not_exposed_by_deployment',
  };

  const base = emptyParcelGisResult({
    sourcePlatform: 'schneider_beacon_qpublic',
    sourcePlatformVariant: input.fingerprint.variant,
    sourceUrl: input.applicationUrl ?? input.fingerprint.sourceUrl,
    retrievedAt: now(),
    retrievalMethod: 'embedded_page_data',
    fieldStates,
  });

  ladder.beginStage('known_adapter');

  // 1. Resolve which deployment serves this county.
  let applicationUrl = input.applicationUrl ?? null;
  if (!applicationUrl && deps.loadDirectory) {
    try {
      const deployments = await deps.loadDirectory();
      const deployment = findSchneiderDeployment(deployments, input.search.county, input.search.state);
      applicationUrl = deployment?.searchUrl ?? deployment?.mapUrl ?? null;
      if (deployment) base.sourceJurisdiction = deployment.displayName;
    } catch {
      // Directory unavailable is not fatal when an application URL was supplied.
    }
  }
  if (!applicationUrl) {
    ladder.endStage('known_adapter', 'no_result', 'No Schneider deployment could be resolved for this county.');
    return { ...base, failureStates: ['OFFICIAL_SOURCE_UNAVAILABLE'], retrievalConfidence: 'none', unresolvedFields: ['parcelId', 'zoning'] };
  }

  // 2. Read the application page to obtain its own config.
  ladder.noteRequest();
  const appPage = await fetchText(applicationUrl);
  if (appPage.blocked) {
    ladder.endStage('known_adapter', 'failed', 'The deployment edge refused the transport; a browser-class session is required.');
    return {
      ...base,
      sourceUrl: applicationUrl,
      failureStates: ['OFFICIAL_SOURCE_UNAVAILABLE'],
      retrievalConfidence: 'none',
      unresolvedFields: ['parcelId', 'parcelAddress', 'owner', 'acres', 'zoning'],
    };
  }

  const config = parseSchneiderMapConfig(appPage.body);
  if (!config) {
    ladder.endStage('known_adapter', 'failed', 'The deployment page published no application config.');
    return { ...base, sourceUrl: applicationUrl, failureStates: ['STRUCTURED_SERVICE_NOT_FOUND'], retrievalConfidence: 'low', unresolvedFields: ['parcelId'] };
  }

  // 3. A parcel key plus the published template is a cold, session-free deep
  //    link. Without a key, this family's search is a stateful form post that
  //    the escalation ladder handles as browser interaction, not here.
  const apn = input.search.apn?.trim();
  if (!apn) {
    ladder.endStage('known_adapter', 'no_result', 'No parcel identifier available, and this deployment publishes no key-free deep link.');
    return {
      ...base,
      sourceUrl: applicationUrl,
      failureStates: ['PARCEL_NOT_FOUND'],
      retrievalConfidence: 'none',
      fieldStates: { ...fieldStates, parcelId: 'unresolved' },
      unresolvedFields: ['parcelId'],
    };
  }
  if (!config.search.parcelId) {
    ladder.endStage('known_adapter', 'no_result', 'This deployment publishes no parcel-identifier search.');
    return {
      ...base,
      sourceUrl: applicationUrl,
      failureStates: ['PARCEL_NOT_FOUND'],
      retrievalConfidence: 'none',
      fieldStates: { ...fieldStates, parcelId: 'not_exposed_by_deployment' },
      unresolvedFields: ['parcelId'],
    };
  }

  const reportUrl = buildSchneiderReportUrl(config, apn, new URL(applicationUrl).hostname);
  if (!reportUrl) {
    ladder.endStage('known_adapter', 'no_result', 'This deployment publishes no parcel deep-link template.');
    return { ...base, sourceUrl: applicationUrl, failureStates: ['PARCEL_NOT_FOUND'], retrievalConfidence: 'none', unresolvedFields: ['parcelId'] };
  }

  ladder.noteRequest();
  const reportPage = await fetchText(reportUrl);
  if (reportPage.blocked) {
    ladder.endStage('known_adapter', 'failed', 'The deployment edge refused the parcel report request.');
    return { ...base, sourceUrl: reportUrl, failureStates: ['OFFICIAL_SOURCE_UNAVAILABLE'], retrievalConfidence: 'none', unresolvedFields: ['parcelId'] };
  }

  // 4. Normalize whatever the report published.
  const report = parseSchneiderReport(reportPage.body);
  const candidate: ParcelCandidate = {
    parcelId: findLabeledValue(report.pairs, LABELS.parcelId),
    address: findLabeledValue(report.pairs, LABELS.address),
    owner: findLabeledValue(report.pairs, LABELS.owner),
    acres: acresFrom(findLabeledValue(report.pairs, LABELS.acres)),
    // County and state are left null unless the REPORT states them. Copying
    // them from the subject would make them agree with the subject by
    // construction, and a candidate could then "corroborate" itself.
    county: findLabeledValue(report.pairs, LABELS.county),
    state: null,
    handle: apn,
  };

  const reconciliation = reconcileParcelCandidates(input.search, [candidate], { searchWasExact: true });
  if (reconciliation.acceptedIndex == null) {
    ladder.endStage('known_adapter', 'failed', reconciliation.reason);
    return {
      ...base,
      sourceUrl: reportUrl,
      searchMethod: 'apn',
      parcelMatchStatus: reconciliation.status,
      reconciliation,
      failureStates: [reconciliation.status === 'conflict' ? 'PARCEL_IDENTITY_CONFLICT' : 'PARCEL_NOT_FOUND'],
      retrievalConfidence: 'none',
      unresolvedFields: ['parcelId'],
    };
  }

  const zoningValue = findLabeledValue(report.pairs, LABELS.zoning);
  const municipality = findLabeledValue(report.pairs, LABELS.municipality);
  const unresolved: string[] = [];
  for (const [field, value] of [['parcelId', candidate.parcelId], ['parcelAddress', candidate.address], ['owner', candidate.owner], ['acres', candidate.acres]] as const) {
    fieldStates[field] = value == null ? 'unresolved' : 'supported';
    if (value == null) unresolved.push(field);
  }
  if (!zoningValue) {
    failureStates.push('ZONING_ATTRIBUTE_UNAVAILABLE');
    fieldStates.zoning = 'not_exposed_by_deployment';
    unresolved.push('zoning');
  } else {
    fieldStates.zoning = 'supported';
  }
  failureStates.push('GEOMETRY_UNAVAILABLE');

  ladder.endStage('known_adapter', 'succeeded', `Read the parcel report through the deployment's own deep link; ${report.sections.length} section(s) published.`);

  return {
    ...base,
    sourceUrl: reportUrl,
    sourceServiceUrl: null,
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
          sourceUrl: reportUrl,
          sourceField: 'report label',
          statement: `Official parcel report lists municipality/district = ${municipality}.`,
        }]
      : [],
    zoning: zoningValue
      ? {
          code: zoningValue,
          description: null,
          layer: {
            layerName: 'Parcel report zoning field',
            layerId: null,
            serviceUrl: reportUrl,
            jurisdiction: municipality,
            codeField: 'Zoning',
            descriptionField: null,
            geometryRelationship: 'parcel_attribute',
          },
          // Read from an assessment report field. Assessment portals commonly
          // print a land classification under a "Zoning" heading, so this is
          // labeled as a classification until an adopted zoning source
          // confirms it. It is never presented as legal zoning.
          authority: 'assessment_classification',
          sourceDisclaimer:
            'Read from a field on the county assessment report, which is an assessment classification rather than confirmed adopted zoning.',
          interpreted: false,
        }
      : null,
    zoningLayer: null,
    availableLayers: [],
    officialPlanningLinks: [],
    retrievalMethod: 'rendered_dom',
    retrievalConfidence: reconciliation.status === 'verified' ? 'high' : 'medium',
    failureStates,
    fieldStates,
    unresolvedFields: [...new Set(unresolved)],
    reconciliation,
  };
}
