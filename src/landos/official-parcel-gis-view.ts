// LandOS — operator projection for OFFICIAL PARCEL & GIS (PART 18).
//
// A compact evidence panel, not a data dump. The operator needs to know which
// official source answered, whether the parcel really is theirs, what the
// source said about who governs it, and what is genuinely missing. They do not
// need service metadata, request counts, layer inventories or raw JSON — those
// stay in the evidence record where a later investigation can find them.
//
// Everything unavailable is stated as unavailable. A blank is never left to be
// read as a zero, and an assessment code is never left to be read as zoning.

import {
  type GisDetectionConfidence,
  type GisFailureState,
  type OfficialParcelGisResult,
  type ParcelMatchStatus,
  type ZoningAuthorityKind,
  failureStateLabel,
  platformFamilyLabel,
} from './gis-platform-types.js';
import { getOfficialParcelGis, type OfficialParcelGisRecord } from './gis-platform-knowledge.js';
import {
  buildPublicRecordAccessView,
  emptyPublicRecordAccessView,
  type PublicRecordAccessView,
} from './public-record-access-view.js';

/** Concise headline states. The unresolved wording is fixed on purpose. */
export const OFFICIAL_PARCEL_SOURCE_UNRESOLVED = 'Official county parcel source — not resolved' as const;
export const OFFICIAL_PARCEL_SOURCE_NOT_RUN = 'Official county parcel source — not researched' as const;

export type OfficialParcelResolution = 'resolved' | 'not_resolved' | 'not_run';

export interface OfficialParcelGisAction {
  kind: 'retry' | 'details';
  label: string;
  available: boolean;
}

export interface OfficialParcelGisView {
  /** False when the lane has never run for this deal. */
  present: boolean;
  /**
   * Whether the official source actually answered. When it did not, the panel
   * renders ONE concise line plus retry/details and NOTHING else: the subject
   * summary already carries owner, APN and acreage from LandPortal, and
   * repeating them here as "unavailable" is a second, emptier subject card.
   */
  resolution: OfficialParcelResolution;
  /** The one line an operator reads when the source did not resolve. */
  statusHeadline: string;
  /** One concise sentence naming what happened. Never a diagnostics dump. */
  statusDetail: string;
  /**
   * True only when this source itself retained parcel identity. A renderer must
   * not show identity rows when it is false — the failure of this source says
   * nothing about the LandPortal intelligence retained elsewhere.
   */
  identityRetained: boolean;
  /** Retry / details affordances for the unresolved state. */
  actions: OfficialParcelGisAction[];
  provider: string;
  providerVariant: string | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
  parcelMatch: ParcelMatchStatus;
  parcelMatchLabel: string;
  /** Present only for a conflict, and states exactly what disagreed. */
  conflictDetails: string[];
  parcelId: string | null;
  parcelAddress: string | null;
  owner: string | null;
  acres: number | null;
  jurisdictionClues: Array<{ level: string; name: string; statement: string }>;
  localGovernment: string | null;
  zoningStatus: 'found' | 'not_found' | 'unresolved';
  zoningCode: string | null;
  zoningDescription: string | null;
  zoningAuthority: ZoningAuthorityKind | null;
  /** Operator-readable warning when a value is an assessment code, not zoning. */
  zoningCaveat: string | null;
  zoningLayerName: string | null;
  geometryStatus: 'retained' | 'unavailable';
  geometryVertexCount: number | null;
  geometryCentroid: { lat: number; lng: number } | null;
  retrievalMethod: string;
  retrievalMethodLabel: string;
  confidence: GisDetectionConfidence;
  /** Named honest states, already humanized. */
  failureStates: Array<{ code: GisFailureState; label: string }>;
  unresolvedFields: string[];
  planningLinks: Array<{ label: string; url: string }>;
  retrievedAt: string | null;
  /**
   * Whether this source can be read automatically, and what the operator must
   * do if not. Carries no credential, handle, username or email — see
   * `assertNoCredentialExposure`.
   */
  access: PublicRecordAccessView;
}

function matchLabel(status: ParcelMatchStatus): string {
  switch (status) {
    case 'verified': return 'Verified';
    case 'provisional': return 'Provisional';
    case 'conflict': return 'Conflict';
    case 'not_found': return 'Not found';
  }
}

function methodLabel(method: OfficialParcelGisResult['retrievalMethod']): string {
  switch (method) {
    case 'structured_service': return 'Structured service';
    case 'embedded_page_data': return 'Embedded page data';
    case 'rendered_dom': return 'Rendered page';
    case 'background_browser': return 'Background browser';
    case 'interactive_map': return 'Interactive map';
  }
}

/**
 * The caveat an operator must see when a "zoning" value is really an
 * assessment classification. Stated in plain language rather than left to the
 * reader to infer from a field name.
 */
function zoningCaveatFor(result: OfficialParcelGisResult): string | null {
  if (!result.zoning) return null;
  if (result.zoning.authority === 'official_zoning_layer') return null;
  const base = result.zoning.authority === 'assessment_classification'
    ? 'This is an assessment classification, not adopted zoning. It must not be treated as what may lawfully be built.'
    : 'LandOS could not confirm whether this is adopted zoning or an assessment classification.';
  return result.zoning.sourceDisclaimer ? `${base} Source states: “${result.zoning.sourceDisclaimer}”` : base;
}

/**
 * Identity fields the SUBJECT SUMMARY already answers. When the official source
 * does not resolve, these never reappear here as "unavailable" rows.
 */
const SUBJECT_IDENTITY_FIELD = /^(?:owner|parcel_?id|apn|acres|acreage|parcel_?address|address)$/i;

/** An empty view, so the panel renders an honest "not run" state rather than blanks. */
export function emptyOfficialParcelGisView(): OfficialParcelGisView {
  return {
    present: false,
    resolution: 'not_run',
    statusHeadline: OFFICIAL_PARCEL_SOURCE_NOT_RUN,
    statusDetail: 'The official county parcel lane has not been run for this property yet.',
    identityRetained: false,
    actions: [
      { kind: 'retry', label: 'Run official parcel source', available: true },
      { kind: 'details', label: 'Details', available: false },
    ],
    provider: 'Not researched',
    providerVariant: null,
    sourceUrl: null,
    sourceLabel: null,
    parcelMatch: 'not_found',
    parcelMatchLabel: 'Not researched',
    conflictDetails: [],
    parcelId: null,
    parcelAddress: null,
    owner: null,
    acres: null,
    jurisdictionClues: [],
    localGovernment: null,
    zoningStatus: 'unresolved',
    zoningCode: null,
    zoningDescription: null,
    zoningAuthority: null,
    zoningCaveat: null,
    zoningLayerName: null,
    geometryStatus: 'unavailable',
    geometryVertexCount: null,
    geometryCentroid: null,
    retrievalMethod: 'structured_service',
    retrievalMethodLabel: 'Not run',
    confidence: 'none',
    failureStates: [],
    unresolvedFields: [],
    planningLinks: [],
    retrievedAt: null,
    access: emptyPublicRecordAccessView(),
  };
}

export function toOfficialParcelGisView(
  record: OfficialParcelGisRecord,
  access: PublicRecordAccessView = emptyPublicRecordAccessView(),
): OfficialParcelGisView {
  const result = record.result;

  const conflictDetails = result.parcelMatchStatus === 'conflict'
    ? (result.reconciliation?.checks ?? [])
        .filter((check) => check.material && check.outcome === 'mismatch')
        .map((check) => `${check.dimension}: LandOS has ${check.expected ?? '(blank)'}; the official source has ${check.observed ?? '(blank)'}.`)
    : [];

  const zoningStatus: OfficialParcelGisView['zoningStatus'] =
    result.zoning ? 'found'
      : result.failureStates.includes('ZONING_LAYER_NOT_FOUND') ? 'not_found'
        : 'unresolved';

  // Did this source itself answer? Nothing else about the property depends on
  // the answer — LandPortal terrain, buildability, environmental and parcel
  // intelligence are retained on their own path and are unaffected by a failure
  // here.
  const identityRetained = !!(result.parcelId || result.owner || result.acres != null || result.parcelAddress || result.geometry);
  const resolution: OfficialParcelResolution = identityRetained ? 'resolved' : 'not_resolved';
  const failureLabels = result.failureStates.map((code) => failureStateLabel(code));
  const statusDetail = identityRetained
    ? `${platformFamilyLabel(result.sourcePlatform)} answered for ${result.sourceJurisdiction ?? 'this jurisdiction'}.`
    : failureLabels.length
      ? `${failureLabels[0]}${failureLabels.length > 1 ? ` (+${failureLabels.length - 1} more)` : ''}. The subject summary is unaffected — it is carried by the retained parcel evidence, not by this source.`
      : 'The official parcel source returned no parcel record. The subject summary is unaffected — it is carried by the retained parcel evidence, not by this source.';

  return {
    present: true,
    resolution,
    statusHeadline: identityRetained
      ? `${platformFamilyLabel(result.sourcePlatform)} — ${matchLabel(result.parcelMatchStatus).toLowerCase()}`
      : OFFICIAL_PARCEL_SOURCE_UNRESOLVED,
    statusDetail,
    identityRetained,
    actions: [
      { kind: 'retry', label: identityRetained ? 'Re-run official parcel source' : 'Retry', available: true },
      { kind: 'details', label: 'Details', available: failureLabels.length > 0 || result.unresolvedFields.length > 0 || !!result.sourceUrl },
    ],
    provider: platformFamilyLabel(result.sourcePlatform),
    providerVariant: result.sourcePlatformVariant?.replace(/_/g, ' ') ?? null,
    sourceUrl: result.sourceUrl || null,
    sourceLabel: result.sourceJurisdiction ?? null,
    parcelMatch: result.parcelMatchStatus,
    parcelMatchLabel: matchLabel(result.parcelMatchStatus),
    conflictDetails,
    parcelId: result.parcelId,
    parcelAddress: result.parcelAddress,
    owner: result.owner,
    acres: result.acres,
    jurisdictionClues: result.jurisdictionClues.map((clue) => ({
      level: clue.level.replace(/_/g, ' '),
      name: clue.name,
      statement: clue.statement,
    })),
    localGovernment: result.localGovernment,
    zoningStatus,
    zoningCode: result.zoning?.code ?? null,
    zoningDescription: result.zoning?.description ?? null,
    zoningAuthority: result.zoning?.authority ?? null,
    zoningCaveat: zoningCaveatFor(result),
    zoningLayerName: result.zoningLayer?.layerName ?? null,
    geometryStatus: result.geometry ? 'retained' : 'unavailable',
    geometryVertexCount: result.geometry?.vertexCount ?? null,
    geometryCentroid: result.geometry?.centroid ?? null,
    retrievalMethod: result.retrievalMethod,
    retrievalMethodLabel: methodLabel(result.retrievalMethod),
    confidence: result.retrievalConfidence,
    failureStates: result.failureStates.map((code) => ({ code, label: failureStateLabel(code) })),
    // An unresolved source must not hand a renderer Owner/APN/Acreage to print
    // as "unavailable": that is the duplicate, mostly-empty subject card. The
    // concise headline plus retry/details is the whole unresolved state.
    unresolvedFields: identityRetained
      ? result.unresolvedFields
      : result.unresolvedFields.filter((field) => !SUBJECT_IDENTITY_FIELD.test(field.trim().replace(/\s+/g, '_'))),
    planningLinks: result.officialPlanningLinks.slice(0, 6),
    retrievedAt: result.retrievedAt,
    access,
  };
}

/**
 * The panel's data for one deal. SELECT-only and scoped by deal id, so no other
 * property's evidence can reach this surface.
 */
export function buildOfficialParcelGisView(
  dealCardId: number,
  /**
   * What the official-records lane actually reported on the latest run, when it
   * ran without producing a parcel record. A lane that queried the state parcel
   * layer under five APN patterns and a street search, and matched none of
   * them, HAS BEEN RESEARCHED — reporting it as "not researched" hides real
   * work, tells the operator the wrong next action, and invites a rerun that
   * will fail the same way. The distinction is the same one the comparable
   * lanes already draw between "not run" and "ran, no results".
   */
  attempt?: { ran: boolean; detail: string | null } | null,
): OfficialParcelGisView {
  const record = getOfficialParcelGis(dealCardId);
  if (!record) {
    const view = emptyOfficialParcelGisView();
    if (!attempt?.ran) return view;
    return {
      ...view,
      resolution: 'not_resolved',
      statusHeadline: OFFICIAL_PARCEL_SOURCE_UNRESOLVED,
      statusDetail: attempt.detail
        ? `The official county parcel lane ran and matched no parcel. ${attempt.detail}`
        : 'The official county parcel lane ran and matched no parcel for this property.',
      provider: 'Official county sources — searched, no match',
      parcelMatchLabel: 'Searched, no match',
    };
  }
  // Access is shared platform knowledge, looked up by the answering HOST. The
  // deal id never reaches the access tables, so one property's research can
  // never surface another's account state.
  const source = record.result.sourceServiceUrl ?? record.result.sourceUrl ?? null;
  return toOfficialParcelGisView(record, buildPublicRecordAccessView(source));
}
