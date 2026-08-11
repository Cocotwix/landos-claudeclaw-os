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

export interface OfficialParcelGisView {
  /** False when the lane has never run for this deal. */
  present: boolean;
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

/** An empty view, so the panel renders an honest "not run" state rather than blanks. */
export function emptyOfficialParcelGisView(): OfficialParcelGisView {
  return {
    present: false,
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

  return {
    present: true,
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
    unresolvedFields: result.unresolvedFields,
    planningLinks: result.officialPlanningLinks.slice(0, 6),
    retrievedAt: result.retrievedAt,
    access,
  };
}

/**
 * The panel's data for one deal. SELECT-only and scoped by deal id, so no other
 * property's evidence can reach this surface.
 */
export function buildOfficialParcelGisView(dealCardId: number): OfficialParcelGisView {
  const record = getOfficialParcelGis(dealCardId);
  if (!record) return emptyOfficialParcelGisView();
  // Access is shared platform knowledge, looked up by the answering HOST. The
  // deal id never reaches the access tables, so one property's research can
  // never surface another's account state.
  const source = record.result.sourceServiceUrl ?? record.result.sourceUrl ?? null;
  return toOfficialParcelGisView(record, buildPublicRecordAccessView(source));
}
