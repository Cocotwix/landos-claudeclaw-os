// LandOS — Government GIS / parcel PLATFORM vocabulary and normalized contract.
//
// This module is deliberately PLATFORM-first, never county-first. Nothing here
// names a county, and no adapter may add one. A county is a deployment of a
// platform family; the reusable product is the family knowledge plus the
// normalized result contract every adapter must satisfy.
//
// It carries no network code and no persistence so both the pure detector and
// the live adapters can share one vocabulary without importing a runtime.

import type {
  AccessRequirement,
  PublicRecordAccessCapability,
  RegistrationAvailability,
} from './public-record-access-types.js';

/* ────────────────────────── platform families ────────────────────────── */

/**
 * Recurring platform families behind U.S. county / township / city parcel,
 * assessor, planning and GIS sites. A family earns a slot here only when it
 * recurs across independent jurisdictions with a shared technical architecture.
 * Everything else is `unknown` and routes to the generic fallback.
 */
export const GIS_PLATFORM_FAMILIES = [
  /** Esri stack: ArcGIS Online, ArcGIS Enterprise, Experience Builder, Web AppBuilder, raw REST. */
  'arcgis',
  /** VertiGIS / Geocortex — a distinct frontend that sits ON TOP of ArcGIS services. */
  'geocortex',
  /** Schneider Geospatial: Beacon and qPublic. */
  'schneider_beacon_qpublic',
  /** Tyler Technologies public property access (iasWorld / Eagle / public-access web apps). */
  'tyler',
  /** Vision Government Solutions (vgsi.com) — dominant in the Northeast. */
  'vision_government_solutions',
  /** SDG "Image Mate Online" (sdgnys.com) — dominant across New York State. */
  'sdg_image_mate',
  /** MapGeo (Applied Geographics / Sanborn) — a first-party JSON API, not a tile viewer. */
  'mapgeo',
  /** State-run statewide parcel/GIS programs that publish an official service. */
  'statewide_gis_program',
  /** Open-geo stacks fronting official data: WMS / WFS / GeoServer / MapServer / vector tiles. */
  'ogc_open_geo',
  /** Recognizably official but not a recurring vendor product. */
  'custom_government_portal',
  /** Nothing reached the evidence bar. */
  'unknown',
] as const;
export type GisPlatformFamily = (typeof GIS_PLATFORM_FAMILIES)[number];

/**
 * Deployment shape within a family. Free-form by design: a family adapter must
 * keep working when a vendor ships a variant LandOS has not seen, so the
 * variant is descriptive evidence, never a routing key on its own.
 */
export type GisPlatformVariant = string;

export const GIS_DETECTION_CONFIDENCES = ['high', 'medium', 'low', 'none'] as const;
export type GisDetectionConfidence = (typeof GIS_DETECTION_CONFIDENCES)[number];

/* ────────────────────────── detection evidence ───────────────────────── */

/**
 * The kinds of technical signal a classification may rest on. Appearance and
 * branding alone are explicitly the weakest kinds and can never carry a
 * high-confidence verdict by themselves (see `gis-platform-fingerprint.ts`).
 */
export const GIS_DETECTION_SIGNALS = [
  'hostname',
  'url_path',
  'script_src',
  'html_marker',
  'page_metadata',
  'network_resource',
  'service_endpoint',
  'embedded_config',
  'vendor_branding',
] as const;
export type GisDetectionSignal = (typeof GIS_DETECTION_SIGNALS)[number];

export interface GisDetectionEvidence {
  signal: GisDetectionSignal;
  /** The family this observation supports. */
  family: GisPlatformFamily;
  /** Variant the observation supports, when the signal is variant-specific. */
  variant?: GisPlatformVariant;
  /** Short human-readable statement of what was observed. Never a secret. */
  detail: string;
  /** The literal observed token, truncated. Kept for reproducibility. */
  observed: string;
  /** Relative strength of this single observation. */
  weight: number;
}

/** A structured data service found behind a page, before any adapter runs. */
export interface DiscoveredService {
  kind:
    | 'arcgis_server_root'
    | 'arcgis_map_server'
    | 'arcgis_feature_server'
    | 'arcgis_image_server'
    | 'arcgis_geocode_server'
    | 'arcgis_geometry_server'
    | 'arcgis_portal_item'
    | 'wms'
    | 'wfs'
    | 'geojson'
    | 'vector_tile'
    | 'json_api'
    | 'download';
  url: string;
  /** Why LandOS believes this URL is that kind of service. */
  evidence: string;
}

export interface PlatformFingerprint {
  family: GisPlatformFamily;
  variant: GisPlatformVariant | null;
  confidence: GisDetectionConfidence;
  evidence: GisDetectionEvidence[];
  /** Structured services visible from the probe, before adapter-level discovery. */
  structuredServices: DiscoveredService[];
  /** Adapter LandOS should route to. `generic_fallback` when no family adapter fits. */
  recommendedAdapter: GisAdapterId;
  /** The URL the fingerprint describes. */
  sourceUrl: string;
  /** Runner-up families, so a wrong first guess is visible rather than hidden. */
  alternates: Array<{ family: GisPlatformFamily; score: number }>;
}

export const GIS_ADAPTER_IDS = [
  'arcgis',
  'schneider_beacon_qpublic',
  'tyler',
  'vision_government_solutions',
  'sdg_image_mate',
  'generic_fallback',
] as const;
export type GisAdapterId = (typeof GIS_ADAPTER_IDS)[number];

/* ─────────────────────── normalized search input ─────────────────────── */

/**
 * PART 9 — one normalized input for every adapter. An adapter picks the
 * strongest method the deployment actually exposes; it never downgrades to a
 * weaker method while a stronger one is available and supported.
 */
export interface NormalizedParcelSearchInput {
  /** Full street address as the operator knows it. */
  address?: string;
  city?: string;
  /** Two-letter state, normalized upstream. */
  state?: string;
  zip?: string;
  county?: string;
  /** APN / parcel id / PIN / tax id, exactly as the county prints it. */
  apn?: string;
  owner?: string;
  /** Only used when already known; never derived to establish identity. */
  latitude?: number;
  longitude?: number;
  /** Acreage LandOS already holds, used for reconciliation only. */
  knownAcres?: number;
}

export const GIS_SEARCH_METHODS = ['apn', 'address', 'owner', 'coordinate'] as const;
export type GisSearchMethod = (typeof GIS_SEARCH_METHODS)[number];

/** Preference order. Exact identifiers beat text beats geometry. */
export const GIS_SEARCH_METHOD_PREFERENCE: readonly GisSearchMethod[] = ['apn', 'address', 'owner', 'coordinate'];

/* ───────────────────────── jurisdiction clues ────────────────────────── */

/**
 * PART 12 — evidence about who governs the parcel. This sprint records clues;
 * it does not decide legal authority. The next sprint reconciles them.
 */
export const JURISDICTION_LEVELS = [
  'state',
  'county',
  'county_subdivision',
  'city',
  'town',
  'township',
  'village',
  'borough',
  'parish',
  'municipality',
  'unincorporated_county',
  'planning_jurisdiction',
  'county_district',
  'school_district',
] as const;
export type JurisdictionLevel = (typeof JURISDICTION_LEVELS)[number];

export interface JurisdictionClue {
  level: JurisdictionLevel;
  /** The name the official source reported. */
  name: string;
  /** Which official source reported it. */
  sourceUrl: string;
  /** The attribute/field the value came from, so it can be re-read. */
  sourceField: string;
  /** Verbatim statement of what the source says, for the next sprint. */
  statement: string;
}

/* ───────────────────────── zoning layer discovery ────────────────────── */

/**
 * PART 11 — whether the platform EXPOSES zoning, not what the zoning means.
 * No ordinance is read, no rule is interpreted, no yield is computed here.
 */
export interface ZoningLayerDescriptor {
  /** Operator-readable layer name as published by the source. */
  layerName: string;
  /** Layer id within its service, when the platform has one. */
  layerId: string | null;
  /** Service URL the layer belongs to. */
  serviceUrl: string;
  /** Jurisdiction the layer covers, when the source states it. */
  jurisdiction: string | null;
  /** Field holding the zoning code, when identified. */
  codeField: string | null;
  /** Field holding the zoning description, when identified. */
  descriptionField: string | null;
  /** How the layer relates to the subject parcel. */
  geometryRelationship: 'contains_subject' | 'intersects_subject' | 'parcel_attribute' | 'not_evaluated' | 'no_intersection';
}

/**
 * What KIND of zoning value was found. This distinction is not cosmetic and it
 * is the easiest thing in this whole system to get dangerously wrong.
 *
 * Assessors routinely store a land-classification code on the parcel record and
 * label the field "zoning". It is not zoning: it drives assessment, not what
 * may lawfully be built. Several county GIS services say so explicitly in their
 * own service description. Presenting such a code as legal zoning would put a
 * false entitlement conclusion in front of an operator, so LandOS labels the
 * two apart and lets neither pass for the other.
 */
export const ZONING_AUTHORITY_KINDS = [
  /** A dedicated official zoning layer published by the zoning authority. */
  'official_zoning_layer',
  /** A classification stored on the assessment record. NOT legal zoning. */
  'assessment_classification',
  /** Found, but LandOS cannot tell which of the two it is. */
  'unclassified',
] as const;
export type ZoningAuthorityKind = (typeof ZONING_AUTHORITY_KINDS)[number];

export interface ZoningAttributeFinding {
  /** Zoning code exactly as the official source publishes it. */
  code: string | null;
  description: string | null;
  layer: ZoningLayerDescriptor;
  /** Whether this is legal zoning or an assessment code. Never assumed. */
  authority: ZoningAuthorityKind;
  /** The source's own caveat, verbatim, when it published one. */
  sourceDisclaimer: string | null;
  /** Always false in this sprint. Interpretation belongs to the next sprint. */
  interpreted: false;
}

/* ─────────────────────────── failure states ──────────────────────────── */

/**
 * PART 20 — explicit honest states. A field is never populated because a
 * provider "normally" supplies it.
 */
export const GIS_FAILURE_STATES = [
  'PLATFORM_UNKNOWN',
  'STRUCTURED_SERVICE_NOT_FOUND',
  'PARCEL_NOT_FOUND',
  'PARCEL_IDENTITY_CONFLICT',
  'GEOMETRY_UNAVAILABLE',
  'ZONING_LAYER_NOT_FOUND',
  'ZONING_ATTRIBUTE_UNAVAILABLE',
  'INTERACTIVE_GIS_ROUTE_DEFERRED',
  'OFFICIAL_SOURCE_UNAVAILABLE',
  // Discovery outcomes. Distinct from OFFICIAL_SOURCE_UNAVAILABLE, which means
  // a KNOWN source would not answer; these describe not knowing which source
  // to use in the first place.
  'OFFICIAL_GIS_SOURCE_NOT_FOUND',
  'MULTIPLE_OFFICIAL_CANDIDATES_NEEDS_RECONCILIATION',
  'OFFICIAL_SOURCE_FOUND_PLATFORM_UNKNOWN',
] as const;
export type GisFailureState = (typeof GIS_FAILURE_STATES)[number];

/** Per-field honesty. A deployment that simply does not publish a field is not a failure. */
export const GIS_FIELD_STATES = ['supported', 'not_exposed_by_deployment', 'unresolved'] as const;
export type GisFieldState = (typeof GIS_FIELD_STATES)[number];

/* ───────────────────── normalized adapter output ─────────────────────── */

export const PARCEL_MATCH_STATUSES = ['verified', 'provisional', 'conflict', 'not_found'] as const;
export type ParcelMatchStatus = (typeof PARCEL_MATCH_STATUSES)[number];

export const GIS_RETRIEVAL_METHODS = [
  'structured_service',
  'embedded_page_data',
  'rendered_dom',
  'background_browser',
  'interactive_map',
] as const;
export type GisRetrievalMethod = (typeof GIS_RETRIEVAL_METHODS)[number];

/** Ring geometry in WGS84 longitude/latitude, matching `parcel-spatial.ts`. */
export type ParcelRings = Array<Array<[number, number]>>;

export interface ParcelGeometryResult {
  rings: ParcelRings;
  /** Always 4326 by the time it leaves an adapter. */
  spatialReference: 4326;
  /** Centroid of the shell ring, computed locally. */
  centroid: { lat: number; lng: number } | null;
  /** Acreage the SOURCE published, never a LandOS estimate. */
  sourceAcres: number | null;
  vertexCount: number;
}

export interface DiscoveredMapLayer {
  name: string;
  url: string;
  /** LandOS's classification of what the layer is for. */
  role: 'parcel' | 'zoning' | 'address' | 'boundary' | 'overlay' | 'imagery' | 'other';
  queryable: boolean;
}

/**
 * PART 10 — the single result shape every adapter returns. Optional fields are
 * genuinely optional: an adapter states `not_exposed_by_deployment` rather than
 * inventing a value that the vendor usually provides.
 */
export interface OfficialParcelGisResult {
  sourcePlatform: GisPlatformFamily;
  sourcePlatformVariant: GisPlatformVariant | null;
  /** County / municipality the source itself serves. */
  sourceJurisdiction: string | null;
  /** Operator-clickable official URL. */
  sourceUrl: string;
  /** Machine-readable service actually queried, when one was. */
  sourceServiceUrl: string | null;
  searchMethod: GisSearchMethod | null;
  parcelMatchStatus: ParcelMatchStatus;
  parcelId: string | null;
  parcelAddress: string | null;
  owner: string | null;
  /** Acreage as published by the official source. */
  acres: number | null;
  geometry: ParcelGeometryResult | null;
  /** Present only when the source states it; never inferred from absence. */
  incorporatedStatus: 'incorporated' | 'unincorporated' | null;
  localGovernment: string | null;
  jurisdictionClues: JurisdictionClue[];
  zoning: ZoningAttributeFinding | null;
  zoningLayer: ZoningLayerDescriptor | null;
  availableLayers: DiscoveredMapLayer[];
  /** Official planning / zoning pages found while retrieving. */
  officialPlanningLinks: Array<{ label: string; url: string }>;
  retrievalMethod: GisRetrievalMethod;
  retrievalConfidence: GisDetectionConfidence;
  /** Named states, never a silent blank. */
  failureStates: GisFailureState[];
  /** Field name -> why it is missing. Only for fields LandOS attempted. */
  fieldStates: Record<string, GisFieldState>;
  unresolvedFields: string[];
  /** Pointer to the retained raw evidence record; never the raw payload itself. */
  rawEvidenceRef: string | null;
  /** Candidate reconciliation detail, when a search returned more than one. */
  reconciliation: ParcelReconciliationReport | null;
  retrievedAt: string;
}

/* ─────────────────────── candidate reconciliation ────────────────────── */

export interface ParcelCandidate {
  parcelId: string | null;
  /**
   * Other identifiers the SAME official record publishes for this parcel:
   * secondary key fields, and the primary key composed with a jurisdiction
   * code the record also carries. Counties routinely print one spelling and
   * store another, so comparing only the primary field reports a conflict on a
   * parcel the source has actually matched correctly. Every entry here comes
   * from the record itself — nothing is invented to force agreement.
   */
  alternateIds?: string[];
  address: string | null;
  owner: string | null;
  acres: number | null;
  county: string | null;
  state: string | null;
  latitude?: number;
  longitude?: number;
  /** Adapter-specific handle used to fetch the full record. */
  handle: string;
}

export const RECONCILIATION_DIMENSIONS = ['apn', 'address', 'owner', 'acreage', 'county', 'state', 'coordinate'] as const;
export type ReconciliationDimension = (typeof RECONCILIATION_DIMENSIONS)[number];

export interface ReconciliationCheck {
  dimension: ReconciliationDimension;
  outcome: 'match' | 'mismatch' | 'not_comparable';
  expected: string | null;
  observed: string | null;
  /** A mismatch on a material dimension forces a conflict, not a soft warning. */
  material: boolean;
}

export interface ParcelReconciliationReport {
  candidatesConsidered: number;
  /** Index of the accepted candidate, or null when none was accepted. */
  acceptedIndex: number | null;
  checks: ReconciliationCheck[];
  status: ParcelMatchStatus;
  /** Plain statement of why the status is what it is. */
  reason: string;
}

/* ───────────────────────── next-sprint handoff ───────────────────────── */

/**
 * PART 19 — everything the Nationwide Verified Land Use, Zoning & By-Right
 * Subdivision sprint needs, and nothing it must re-derive. No legal conclusion
 * is drawn here.
 */
export interface ZoningResearchHandoff {
  handoffVersion: 1;
  subject: {
    dealCardId: number;
    parcelId: string | null;
    address: string | null;
    county: string | null;
    state: string | null;
    acres: number | null;
  };
  officialParcelSourceUrl: string | null;
  platformFamily: GisPlatformFamily;
  platformVariant: GisPlatformVariant | null;
  geometry: ParcelGeometryResult | null;
  jurisdictionClues: JurisdictionClue[];
  zoningLayer: ZoningLayerDescriptor | null;
  zoningCode: string | null;
  zoningDescription: string | null;
  /** Whether `zoningCode` is legal zoning or an assessment classification. */
  zoningAuthority: ZoningAuthorityKind | null;
  /** The source's own caveat about that value, verbatim. */
  zoningSourceDisclaimer: string | null;
  planningZoningUrls: Array<{ label: string; url: string }>;
  sourceConfidence: GisDetectionConfidence;
  parcelMatchStatus: ParcelMatchStatus;
  /** Populated when identity could not be settled; the next sprint must stop on it. */
  unresolvedIdentityIssue: string | null;
  failureStates: GisFailureState[];
  preparedAt: string;
  /**
   * PART 20 — whether the answering source can be read automatically.
   *
   * The nationwide zoning/subdivision sprint reads this before it decides to
   * continue on its own: a source behind a free login it already holds is fine,
   * one behind a paid wall is not, and one awaiting email verification is a
   * "come back later", not a failure. Null when access was never observed.
   */
  access?: PublicRecordAccessHandoff | null;
}

export interface PublicRecordAccessHandoff {
  requirement: AccessRequirement;
  registration: RegistrationAvailability;
  capabilities: PublicRecordAccessCapability[];
  /** True only when an ACTIVE account is on file within its own scope. */
  accountAvailable: boolean;
  /** A free login can still front paid documents. Searching is not ordering. */
  paidRecordsObserved: boolean;
  observedAt: string | null;
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

export function isGisPlatformFamily(value: string): value is GisPlatformFamily {
  return (GIS_PLATFORM_FAMILIES as readonly string[]).includes(value);
}

/** Operator-facing label. Keeps vendor names out of component code. */
export function platformFamilyLabel(family: GisPlatformFamily): string {
  switch (family) {
    case 'arcgis': return 'Esri ArcGIS';
    case 'geocortex': return 'VertiGIS / Geocortex (over ArcGIS)';
    case 'schneider_beacon_qpublic': return 'Schneider Beacon / qPublic';
    case 'tyler': return 'Tyler Technologies';
    case 'vision_government_solutions': return 'Vision Government Solutions';
    case 'sdg_image_mate': return 'SDG Image Mate Online';
    case 'mapgeo': return 'MapGeo';
    case 'statewide_gis_program': return 'Statewide GIS program';
    case 'ogc_open_geo': return 'Open geospatial services (WMS/WFS)';
    case 'custom_government_portal': return 'Custom government portal';
    case 'unknown': return 'Unknown';
  }
}

export function failureStateLabel(state: GisFailureState): string {
  switch (state) {
    case 'PLATFORM_UNKNOWN': return 'Platform unknown';
    case 'STRUCTURED_SERVICE_NOT_FOUND': return 'Structured service not found';
    case 'PARCEL_NOT_FOUND': return 'Parcel not found';
    case 'PARCEL_IDENTITY_CONFLICT': return 'Parcel identity conflict';
    case 'GEOMETRY_UNAVAILABLE': return 'Geometry unavailable';
    case 'ZONING_LAYER_NOT_FOUND': return 'Zoning layer not found';
    case 'ZONING_ATTRIBUTE_UNAVAILABLE': return 'Zoning attribute unavailable';
    case 'INTERACTIVE_GIS_ROUTE_DEFERRED': return 'Interactive GIS route deferred';
    case 'OFFICIAL_SOURCE_UNAVAILABLE': return 'Official source unavailable';
    case 'OFFICIAL_GIS_SOURCE_NOT_FOUND': return 'Official GIS source not found';
    case 'MULTIPLE_OFFICIAL_CANDIDATES_NEEDS_RECONCILIATION': return 'Multiple official candidates — needs reconciliation';
    case 'OFFICIAL_SOURCE_FOUND_PLATFORM_UNKNOWN': return 'Official source found — platform unknown';
  }
}

/**
 * Strongest search method this input can actually drive, given what the
 * deployment supports. Returns null when the input cannot drive any supported
 * method — the caller must then report, not guess.
 */
export function strongestSearchMethod(
  input: NormalizedParcelSearchInput,
  supported: readonly GisSearchMethod[],
): GisSearchMethod | null {
  for (const method of GIS_SEARCH_METHOD_PREFERENCE) {
    if (!supported.includes(method)) continue;
    if (method === 'apn' && input.apn?.trim()) return 'apn';
    if (method === 'address' && input.address?.trim()) return 'address';
    if (method === 'owner' && input.owner?.trim()) return 'owner';
    if (method === 'coordinate' && typeof input.latitude === 'number' && typeof input.longitude === 'number') return 'coordinate';
  }
  return null;
}

/** Centroid of the shell ring. Local math only; never a source claim. */
export function ringsCentroid(rings: ParcelRings): { lat: number; lng: number } | null {
  const shell = rings[0];
  if (!shell?.length) return null;
  let sumLng = 0;
  let sumLat = 0;
  for (const [lng, lat] of shell) { sumLng += lng; sumLat += lat; }
  return {
    lng: Math.round((sumLng / shell.length) * 1e6) / 1e6,
    lat: Math.round((sumLat / shell.length) * 1e6) / 1e6,
  };
}

/** An empty result carrying only the honest states. Adapters build on this. */
export function emptyParcelGisResult(
  overrides: Partial<OfficialParcelGisResult> & Pick<OfficialParcelGisResult, 'sourcePlatform' | 'sourceUrl' | 'retrievedAt'>,
): OfficialParcelGisResult {
  return {
    sourcePlatformVariant: null,
    sourceJurisdiction: null,
    sourceServiceUrl: null,
    searchMethod: null,
    parcelMatchStatus: 'not_found',
    parcelId: null,
    parcelAddress: null,
    owner: null,
    acres: null,
    geometry: null,
    incorporatedStatus: null,
    localGovernment: null,
    jurisdictionClues: [],
    zoning: null,
    zoningLayer: null,
    availableLayers: [],
    officialPlanningLinks: [],
    retrievalMethod: 'structured_service',
    retrievalConfidence: 'none',
    failureStates: [],
    fieldStates: {},
    unresolvedFields: [],
    rawEvidenceRef: null,
    reconciliation: null,
    ...overrides,
  };
}
