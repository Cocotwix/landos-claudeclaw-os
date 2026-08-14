// Narrow Hermes -> LandOS LandPortal import.
//
// Hermes remains a provider handback, not a second property store. This module
// validates one JSON file against an existing subject Property Card, persists
// the normalized evidence through PropertyResearchStore, and projects the
// accepted result through the existing Property Card, inspection, and comp
// registries used by the normal Deal Card read.
//
// Retention is independent of every other source. Each result category persists
// in its own transaction, and nothing here consults the official county GIS
// lane: a failure over there can never stop LandPortal terrain, slope,
// buildability, wetlands, FEMA, soils, water, frontage, acreage, improvement or
// parcel-context evidence from being retained.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { compParcelRegistryKey, sameCompParcel } from './comp-registry-identity.js';
import { listComps, retireForkedCompRow, upsertNormalizedComp, type CompRow } from './comps.js';
import { getLandosDb, type LandosEntity } from './db.js';
import {
  landPortalIdentityFromUrl,
  validateLandPortalSubjectUrl,
} from './landportal-operating-rules.js';
import {
  validateLandPortalVisualEvidence,
  type LandPortalVisualView,
} from './landportal-evidence-validation.js';
import {
  attachCardActivity,
  getPropertyCardRow,
  loadPropertyInspection,
  normalizeAddressKey,
  savePropertyInspection,
  upsertPropertyCard,
  type LandPortalComparableRecord,
  type PropertyCardRow,
} from './property-card.js';
import {
  type CanonicalPropertyInput,
  type NormalizedPropertyEvidence,
  type PropertyProviderResult,
} from './property-intelligence-contract.js';
import { apnEquivalent } from './property-intelligence-snapshot.js';
import { PropertyResearchStore } from './property-research-store.js';
import {
  reconcileAccessEvidence,
  type AccessEvidenceBasis,
  type AccessEvidenceItem,
  type AccessEvidenceSourceKind,
  type AccessEvidenceTier,
  type AccessEvidenceWeight,
} from './access-evidence-ladder.js';
import { assessOverviewFraming, OVERVIEW_CAPTURE_KEY, selectOverviewVisual } from './landportal-overview-capture.js';
import { buildLandPortalCompPersistence, mergeCompDetail } from './landportal-comp-drilldown.js';

type Dict = Record<string, unknown>;

export interface HermesLandPortalComp {
  price: number;
  acres: number;
  apn?: string | null;
  address?: string | null;
  price_per_acre?: number | null;
  sale_date?: string | null;
  source_url?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  lat?: number | null;
  lng?: number | null;
  image_url?: string | null;
  image_source?: string | null;
  detail_url?: string | null;
  drilled_down?: boolean | null;
}

export interface HermesLandPortalAccessEvidence {
  tier: AccessEvidenceTier;
  statement: string;
  source_label: string;
  source_kind: AccessEvidenceSourceKind;
  basis: AccessEvidenceBasis;
  weight: AccessEvidenceWeight;
  source_url?: string | null;
  observed_at?: string | null;
  /** Key of the retained visual artifact this observation was read from. */
  artifact_key?: string | null;
}

export type HermesLandPortalResultCategory = 'subject' | 'comps' | 'visuals';

export interface HermesLandPortalVisualArtifact {
  key: string;
  label: string;
  kind: 'parcel_page' | 'parcel_3d' | 'parcel_boundary' | 'overlay' | 'comparables_map' | 'street_view';
  purpose: string;
  source_path: string;
  timestamp: string;
  requested_view: LandPortalVisualView;
  active_view: LandPortalVisualView;
  boundary_required: boolean;
  boundary_visible: boolean;
  tiles_loaded: boolean;
  camera_scale: 'parcel' | 'context' | 'county' | 'national' | 'unknown';
  clipped: boolean;
  obstructions: string[];
  overlay?: string | null;
  note?: string | null;
  /**
   * Overlay captures only: attests the colored overlay polygons (soil colors,
   * yellow buildability area) had visibly finished rendering across the
   * subject parcel before the screenshot. Soil and buildability captures are
   * rejected without this attestation — base imagery alone is not overlay
   * evidence.
   */
  overlay_rendered?: boolean | null;
}

/** Structured Street View observation with its evidentiary basis. */
export interface HermesStreetViewObservation {
  label: string;
  detail: string;
  basis: 'direct_observation' | 'reasonable_interpretation' | 'unconfirmed';
}

export interface HermesLandPortalSubject {
  subject_url: string;
  subject_verification_status: string;
  subject_verification_note?: string | null;
  address: string;
  county?: string | null;
  municipality?: string | null;
  apn: string;
  owner?: string | null;
  mailing_address?: string | null;
  deeded_acres?: number | null;
  mls_acres?: number | null;
  calculated_acres?: number | null;
  road_frontage_ft?: number | null;
  landlocked_status?: string | null;
  wetlands_pct?: number | null;
  fema_pct?: number | null;
  average_slope_pct?: number | null;
  pct_under_10pct_slope?: number | null;
  pct_under_10pct_slope_note?: string | null;
  buildability_pct?: number | null;
  lp_estimate_total?: number | null;
  lp_estimate_per_acre?: number | null;
  // Clearly labeled sidebar fields captured whenever LandPortal displays them.
  // Displayed values are preserved verbatim (the zoning code is never
  // reinterpreted; the FEMA description is kept complete).
  water_feature_type?: string | null;
  zoning_code?: string | null;
  fema_flood_zone?: string | null;
  fema_flood_zone_description?: string | null;
  // Terrain, soils, improvement and parcel context. Retained whenever LandPortal
  // supplies them; their absence here means the source did not publish them, and
  // is never a consequence of any other source's outcome.
  elevation_avg?: number | string | null;
  elevation_min?: number | string | null;
  elevation_max?: number | string | null;
  soil_type?: string | null;
  soil_description?: string | null;
  building_sqft?: number | string | null;
  year_built?: number | string | null;
  improvement_value?: number | string | null;
  parcel_sqft?: number | string | null;
  land_use_description?: string | null;
  subdivision?: string | null;
  last_sale_price?: number | string | null;
  last_sale_date?: string | null;
  book_number?: number | string | null;
  page_number?: number | string | null;
  assessed_value?: number | string | null;
  buildability_area_acres?: number | null;
  // Street View outcome from the visuals work unit. Unavailability is recorded
  // explicitly, never silently skipped.
  street_view_available?: boolean | null;
  street_view_note?: string | null;
  street_view_observations?: HermesStreetViewObservation[];
  captured_at?: string | null;
  retrieved_at?: string | null;
  canonical_property_identifier?: string | number | null;
  property_id?: string | number | null;
  landportal_property_id?: string | number | null;
  specialist_category?: HermesLandPortalResultCategory;
  completed_categories?: HermesLandPortalResultCategory[];
  visual_artifacts?: HermesLandPortalVisualArtifact[];
  /** Artifacts that failed to parse, dropped individually instead of failing
   *  the whole handback. Reported with the acceptance-stage rejections. */
  visual_artifact_parse_rejections?: Array<{ index: number; reason: string }>;
  access_evidence?: HermesLandPortalAccessEvidence[];
  comps: HermesLandPortalComp[];
}

export interface HermesLandPortalValidationCheck {
  check: 'verified_exact_subject' | 'property_address' | 'apn' | 'canonical_property_identifier' | 'subject_url';
  passed: boolean;
  reason: string;
}

export interface HermesLandPortalImportResult {
  imported: boolean;
  runId: string;
  sourceFile: string;
  sourceUrl: string;
  capturedAt: string;
  captureTimestampSource: 'json' | 'file_mtime';
  propertyCardId: number;
  dealCardId: number;
  validationChecks: HermesLandPortalValidationCheck[];
  importedSubjectFields: string[];
  importedCompCount: number;
  createdCompCount: number;
  duplicateCompCount: number;
  rejectedFields: string[];
  canonicalEvidenceRetained: number;
  completedCategories: HermesLandPortalResultCategory[];
  persistedCategories: HermesLandPortalResultCategory[];
  importedVisualCount: number;
  rejectedVisualCount: number;
  categoryResults: HermesLandPortalCategoryImportResult[];
}

export interface HermesLandPortalCategoryImportResult {
  category: HermesLandPortalResultCategory;
  runId: string;
  imported: boolean;
  persistedAt: string;
  retainedEvidenceCount: number;
  itemCount: number;
  rejectedItemCount: number;
  error: string | null;
}

export interface ImportHermesLandPortalOptions {
  propertyCardId?: number;
  now?: () => string;
  expectedIdentity?: Pick<HermesLandPortalValidatedIdentity, 'address' | 'apn' | 'subjectUrl' | 'propertyId'>;
}

export interface HermesLandPortalValidatedIdentity {
  address: string;
  apn: string;
  subjectUrl: string;
  propertyId: string;
  fips: string | null;
  propertyCardId: number;
  dealCardId: number;
  specialistCategory: HermesLandPortalResultCategory | null;
  completedCategories: HermesLandPortalResultCategory[];
  checks: HermesLandPortalValidationCheck[];
}

type SubjectCard = PropertyCardRow & { deal_card_id: number; role: string };

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const present = (value: unknown): boolean => value != null && (typeof value !== 'string' || value.trim().length > 0);
const compact = (value: unknown): string => text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const compactApn = (value: unknown): string => text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
const money = (value: number): string => `$${Math.round(value).toLocaleString('en-US')}`;
const percent = (value: number): string => `${value.toFixed(2)}%`;
const HERMES_RESULT_CATEGORIES = new Set<HermesLandPortalResultCategory>(['subject', 'comps', 'visuals']);
const HERMES_VISUAL_KINDS = new Set<HermesLandPortalVisualArtifact['kind']>(['parcel_page', 'parcel_3d', 'parcel_boundary', 'overlay', 'comparables_map', 'street_view']);
const HERMES_VISUAL_VIEWS = new Set<LandPortalVisualView>(['parcel_context', 'road_frontage', 'wetlands', 'fema_flood', 'soil', 'contours', 'front_3d', 'rear_3d', 'default_3d', 'buildability', 'street_view', 'comparables_map']);

/**
 * View names LandOS itself asks Hermes for that are not view names.
 *
 * The capture assignment lists `landportal_overview` among the requested
 * visuals, and the overview requirement defines it as "an active parcel_context
 * satellite frame". It is a capture KEY (`OVERVIEW_CAPTURE_KEY`), not a member
 * of the view enum — but LandOS names it in the same breath as real views, so
 * Hermes returns it in `requested_view` exactly as instructed and the handback
 * is then refused for containing it.
 *
 * 5170 Hwy 60 lost its entire visuals batch this way: the rejection landed on
 * `visual_artifacts[0]`, so the wetlands, flood, soil, contour, 3D,
 * buildability and Street View captures were all taken and all discarded.
 *
 * Mapping it to the view it is defined to be resolves the contract without
 * loosening anything: the artifact still faces the overview framing assessment
 * and the full visual-evidence gate below.
 */
const HERMES_VIEW_ALIASES: Record<string, LandPortalVisualView> = {
  landportal_overview: 'parcel_context',
  overview: 'parcel_context',
  soil_overlay: 'soil',
  wetland: 'wetlands',
  flood: 'fema_flood',
  contour: 'contours',
};

/** Resolve a Hermes-supplied view name, accepting the aliases LandOS asks for. */
function canonicalVisualView(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase();
  return HERMES_VIEW_ALIASES[raw] ?? raw;
}
/** Overlay views whose captures must attest visibly rendered overlay polygons. */
const OVERLAY_RENDER_REQUIRED_VIEWS = new Set<LandPortalVisualView>(['soil', 'buildability']);
const STREET_VIEW_BASES = new Set<HermesStreetViewObservation['basis']>(['direct_observation', 'reasonable_interpretation', 'unconfirmed']);
const HERMES_CAMERA_SCALES = new Set<HermesLandPortalVisualArtifact['camera_scale']>(['parcel', 'context', 'county', 'national', 'unknown']);
const ACCESS_TIERS = new Set<AccessEvidenceTier>(['parcel_flag', 'apparent_physical', 'reported_legal', 'verified_legal']);
const ACCESS_SOURCE_KINDS = new Set<AccessEvidenceSourceKind>(['landportal_parcel_flag', 'satellite_imagery', 'street_view', 'listing', 'official_record', 'other']);
const ACCESS_BASES = new Set<AccessEvidenceBasis>(['source_stated', 'direct_observation', 'reasonable_interpretation', 'recorded_instrument']);
const ACCESS_WEIGHTS = new Set<AccessEvidenceWeight>(['confirmed', 'well_supported', 'likely', 'unresolved']);

function visualKindForView(view: LandPortalVisualView): HermesLandPortalVisualArtifact['kind'] {
  if (view === 'comparables_map') return 'comparables_map';
  if (view === 'front_3d' || view === 'rear_3d' || view === 'default_3d') return 'parcel_3d';
  if (view === 'street_view') return 'street_view';
  if (view === 'parcel_context' || view === 'road_frontage') return 'parcel_boundary';
  return 'overlay';
}

function cameraScaleFromZoom(value: unknown): HermesLandPortalVisualArtifact['camera_scale'] | null {
  const match = text(value).match(/\bzoom\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!match) return null;
  const zoom = Number(match[1]);
  if (!Number.isFinite(zoom)) return null;
  if (zoom >= 15) return 'parcel';
  if (zoom >= 10) return 'context';
  if (zoom >= 6) return 'county';
  return 'national';
}

function asDict(value: unknown, label: string): Dict {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`);
  return value as Dict;
}

function requiredText(value: unknown, label: string): string {
  const parsed = text(value);
  if (!parsed) throw new Error(`Hermes JSON is missing required field "${label}".`);
  return parsed;
}

function requiredPositiveNumber(value: unknown, label: string): number {
  const numericText = typeof value === 'string' ? value.trim() : '';
  const safelyFormatted = /^\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(numericText);
  const parsed = finite(value) ?? (safelyFormatted ? Number(numericText.replace(/[$,]/g, '')) : null);
  if (parsed == null || parsed <= 0) throw new Error(`Hermes JSON field "${label}" must be a positive number.`);
  return parsed;
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Hermes JSON field "${label}" must be a boolean.`);
  return value;
}

function enumText<T extends string>(value: unknown, label: string, allowed: Set<T>): T {
  const parsed = requiredText(value, label) as T;
  if (!allowed.has(parsed)) throw new Error(`Hermes JSON field "${label}" has unsupported value "${parsed}".`);
  return parsed;
}

export function parseHermesLandPortalSubject(value: unknown): HermesLandPortalSubject {
  const raw = asDict(value, 'Hermes LandPortal payload');
  const specialistCategory = raw.specialist_category == null
    ? undefined
    : enumText(raw.specialist_category, 'specialist_category', HERMES_RESULT_CATEGORIES);
  if (!Array.isArray(raw.comps)) throw new Error('Hermes JSON field "comps" must be an array.');
  const parsedComps = raw.comps.map((entry, index): HermesLandPortalComp => {
    const comp = asDict(entry, `Hermes comp ${index + 1}`);
    // A LandPortal sidebar sold row legitimately states only a price, an
    // acreage and a date: 9490 Elk Lake Rd's accepted comps are exactly that.
    // Rejecting them here would delete real closed-sale evidence, so the row is
    // retained with a null identity and deduped on price/acres/date instead.
    const apn = text(comp.apn) || null;
    const address = text(comp.address) || null;
    return {
      price: requiredPositiveNumber(comp.price, `comps[${index}].price`),
      acres: requiredPositiveNumber(comp.acres, `comps[${index}].acres`),
      apn,
      address,
      price_per_acre: finite(comp.price_per_acre),
      sale_date: text(comp.sale_date) || null,
      source_url: text(comp.source_url) || null,
      city: text(comp.city) || null,
      state: text(comp.state) || null,
      zip: text(comp.zip) || null,
      lat: finite(comp.lat),
      lng: finite(comp.lng),
      image_url: text(comp.image_url) || null,
      image_source: text(comp.image_source) || null,
      detail_url: text(comp.detail_url) || null,
      drilled_down: typeof comp.drilled_down === 'boolean' ? comp.drilled_down : null,
    };
  });
  const compKeys = new Set<string>();
  const comps = parsedComps.filter((comp) => {
    const key = hermesLandPortalCompKey(comp);
    if (compKeys.has(key)) return false;
    compKeys.add(key);
    return true;
  });
  const completedCategories = raw.completed_categories == null
    ? undefined
    : (() => {
        if (!Array.isArray(raw.completed_categories)) throw new Error('Hermes JSON field "completed_categories" must be an array.');
        const parsed = raw.completed_categories.map((entry, index) => enumText(entry, `completed_categories[${index}]`, HERMES_RESULT_CATEGORIES));
        const unique = [...new Set(parsed)];
        if (specialistCategory && (unique.length !== 1 || unique[0] !== specialistCategory)) {
          throw new Error(`Hermes specialist "${specialistCategory}" must complete only its assigned category.`);
        }
        if (!specialistCategory && !unique.includes('subject')) {
          throw new Error('Hermes progressive snapshots must complete "subject" before later result categories.');
        }
        return unique;
      })();
  if (specialistCategory && !completedCategories) {
    throw new Error(`Hermes specialist "${specialistCategory}" must declare its completed category.`);
  }
  const visualArtifactParseRejections: Array<{ index: number; reason: string }> = [];
  const visualArtifacts = raw.visual_artifacts == null
    ? undefined
    : (() => {
        if (!Array.isArray(raw.visual_artifacts)) throw new Error('Hermes JSON field "visual_artifacts" must be an array.');
        // ── ONE BAD ARTIFACT MUST NOT DESTROY THE BATCH ──────────────────
        // This map used to throw, which aborted the whole handback: a single
        // malformed field in visual_artifacts[0] discarded every other capture
        // in the payload AND the categories alongside it. That has now bitten
        // twice — free-text camera_scale first (see the tolerance below), then
        // an aliased requested_view on 5170 Hwy 60 — so the shape is the
        // defect, not either field.
        //
        // A rejected artifact is dropped with its reason recorded rather than
        // silently swallowed: the acceptance stage further down already works
        // exactly this way, and its `rejected` list is surfaced to the
        // operator. Nothing weaker is admitted; the survivors still face the
        // full visual-evidence gate.
        return raw.visual_artifacts.flatMap((entry, index): HermesLandPortalVisualArtifact[] => {
          try {
            return [parseVisualArtifact(entry, index)];
          } catch (err) {
            visualArtifactParseRejections.push({
              index,
              reason: err instanceof Error ? err.message : String(err),
            });
            return [];
          }
        });
      })();

  function parseVisualArtifact(entry: unknown, index: number): HermesLandPortalVisualArtifact {
          const artifact = asDict(entry, `Hermes visual artifact ${index + 1}`);
          const obstructionNarrative = typeof artifact.obstructions === 'string'
            ? artifact.obstructions.trim()
            : '';
          const explicitlyNonObstructing = !!obstructionNarrative
            && /\b(?:does not|do not)\s+(?:cover|obstruct)\b/i.test(obstructionNarrative);
          const obstructionValues = typeof artifact.obstructions === 'string'
            ? explicitlyNonObstructing ? [] : [artifact.obstructions]
            : artifact.obstructions;
          if (!Array.isArray(obstructionValues) || obstructionValues.some((item) => typeof item !== 'string')) {
            throw new Error(`Hermes JSON field "visual_artifacts[${index}].obstructions" must be a string array.`);
          }
          const requestedView = enumText(canonicalVisualView(artifact.requested_view), `visual_artifacts[${index}].requested_view`, HERMES_VISUAL_VIEWS);
          const rawKind = text(artifact.kind);
          const kind = rawKind === 'screenshot'
            ? visualKindForView(requestedView)
            : enumText(artifact.kind, `visual_artifacts[${index}].kind`, HERMES_VISUAL_KINDS);
          const activeView = rawKind === 'screenshot' && !HERMES_VISUAL_VIEWS.has(canonicalVisualView(artifact.active_view) as LandPortalVisualView)
            ? requestedView
            : enumText(canonicalVisualView(artifact.active_view), `visual_artifacts[${index}].active_view`, HERMES_VISUAL_VIEWS);
          const rawCameraScale = text(artifact.camera_scale) as HermesLandPortalVisualArtifact['camera_scale'];
          // A screenshot artifact whose camera_scale is descriptive free text
          // is not discarded wholesale: when the same handback swears the
          // required parcel boundary is visible, unclipped, with tiles loaded,
          // that proves at-least-context framing (the same attestation the
          // literal enum would carry). Anything weaker stays 'unknown' and is
          // still rejected by the visual evidence gate.
          const framingProven = artifact.boundary_required === true
            && artifact.boundary_visible === true
            && artifact.tiles_loaded === true
            && artifact.clipped === false;
          const cameraScale = HERMES_CAMERA_SCALES.has(rawCameraScale)
            ? rawCameraScale
            : rawKind === 'screenshot'
              ? cameraScaleFromZoom(artifact.camera_scale) ?? (framingProven ? 'context' : 'unknown')
              : null;
          if (!cameraScale) throw new Error(`Hermes JSON field "visual_artifacts[${index}].camera_scale" has unsupported value "${text(artifact.camera_scale)}".`);
          return {
            key: requiredText(artifact.key, `visual_artifacts[${index}].key`),
            label: requiredText(artifact.label, `visual_artifacts[${index}].label`),
            kind,
            purpose: requiredText(artifact.purpose, `visual_artifacts[${index}].purpose`),
            source_path: requiredText(artifact.source_path, `visual_artifacts[${index}].source_path`),
            timestamp: requiredText(artifact.timestamp, `visual_artifacts[${index}].timestamp`),
            requested_view: requestedView,
            active_view: activeView,
            boundary_required: requiredBoolean(artifact.boundary_required, `visual_artifacts[${index}].boundary_required`),
            boundary_visible: requiredBoolean(artifact.boundary_visible, `visual_artifacts[${index}].boundary_visible`),
            tiles_loaded: requiredBoolean(artifact.tiles_loaded, `visual_artifacts[${index}].tiles_loaded`),
            camera_scale: cameraScale,
            clipped: requiredBoolean(artifact.clipped, `visual_artifacts[${index}].clipped`),
            obstructions: obstructionValues.map((item) => item.trim()).filter(Boolean),
            overlay: text(artifact.overlay) || null,
            note: [text(artifact.note), explicitlyNonObstructing ? obstructionNarrative : ''].filter(Boolean).join(' ') || null,
            overlay_rendered: typeof artifact.overlay_rendered === 'boolean' ? artifact.overlay_rendered : null,
          };
  }

  const streetViewObservations = raw.street_view_observations == null
    ? undefined
    : (() => {
        if (!Array.isArray(raw.street_view_observations)) throw new Error('Hermes JSON field "street_view_observations" must be an array.');
        return raw.street_view_observations.map((entry, index): HermesStreetViewObservation => {
          const observation = asDict(entry, `Hermes street view observation ${index + 1}`);
          return {
            label: requiredText(observation.label, `street_view_observations[${index}].label`),
            detail: requiredText(observation.detail, `street_view_observations[${index}].detail`),
            basis: enumText(observation.basis, `street_view_observations[${index}].basis`, STREET_VIEW_BASES),
          };
        });
      })();
  const accessEvidence = raw.access_evidence == null
    ? undefined
    : (() => {
        if (!Array.isArray(raw.access_evidence)) throw new Error('Hermes JSON field "access_evidence" must be an array.');
        return raw.access_evidence.map((entry, index): HermesLandPortalAccessEvidence => {
          const item = asDict(entry, `Hermes access evidence ${index + 1}`);
          return {
            tier: enumText(item.tier, `access_evidence[${index}].tier`, ACCESS_TIERS),
            statement: requiredText(item.statement, `access_evidence[${index}].statement`),
            source_label: requiredText(item.source_label, `access_evidence[${index}].source_label`),
            source_kind: enumText(item.source_kind, `access_evidence[${index}].source_kind`, ACCESS_SOURCE_KINDS),
            basis: enumText(item.basis, `access_evidence[${index}].basis`, ACCESS_BASES),
            weight: enumText(item.weight, `access_evidence[${index}].weight`, ACCESS_WEIGHTS),
            source_url: text(item.source_url) || null,
            observed_at: text(item.observed_at) || null,
            artifact_key: text(item.artifact_key) || null,
          };
        });
      })();
  return {
    ...(raw as unknown as HermesLandPortalSubject),
    subject_url: requiredText(raw.subject_url, 'subject_url'),
    subject_verification_status: requiredText(raw.subject_verification_status, 'subject_verification_status'),
    address: requiredText(raw.address, 'address'),
    apn: requiredText(raw.apn, 'apn'),
    specialist_category: specialistCategory,
    completed_categories: completedCategories,
    visual_artifacts: visualArtifacts,
    // Artifacts dropped at parse time travel with the payload so the acceptance
    // stage can report them alongside its own rejections. A capture that failed
    // to parse is never invisible; it is simply no longer fatal to its siblings.
    visual_artifact_parse_rejections: visualArtifactParseRejections.length
      ? visualArtifactParseRejections
      : undefined,
    street_view_available: typeof raw.street_view_available === 'boolean' ? raw.street_view_available : undefined,
    street_view_note: text(raw.street_view_note) || undefined,
    street_view_observations: streetViewObservations,
    access_evidence: accessEvidence,
    comps,
  };
}

function addressMatches(card: PropertyCardRow, address: string): boolean {
  const incoming = normalizeAddressKey(address);
  const candidates = [
    card.active_input_address,
    [card.active_input_address, card.city, card.state, card.zip].filter(Boolean).join(', '),
  ].map(normalizeAddressKey).filter(Boolean);
  if (!incoming) return false;
  if (candidates.includes(incoming)) return true;

  // Manual New Lead intake can retain a verified street/city/state while the
  // ZIP remains empty. LandPortal commonly includes that ZIP in its situs
  // address. Allow only that trailing five-digit addition; APN and canonical
  // LandPortal identity still have to pass their independent exact checks.
  if (!card.zip && card.city && card.state) {
    const withoutTrailingZip = incoming.replace(/\s+\d{5}(?:\s+\d{4})?$/, '');
    return candidates.includes(withoutTrailingZip);
  }
  return false;
}

function parsedCanonicalPropertyIdentifier(value: unknown): {
  propertyId: string;
  fips: string | null;
  apn: string | null;
} | null {
  const raw = String(value ?? '').trim();
  if (!raw || /^\d+$/.test(raw)) return null;
  if (!raw.includes('=')) return null;
  const params = new URLSearchParams(raw);
  const propertyId = text(params.get('propertyid'));
  const fips = text(params.get('fips'));
  const apn = text(params.get('apn'));
  return propertyId && fips && apn ? { propertyId, fips, apn } : null;
}

function explicitPropertyIds(subject: HermesLandPortalSubject): string[] {
  const canonicalRaw = String(subject.canonical_property_identifier ?? '').trim();
  const canonical = parsedCanonicalPropertyIdentifier(canonicalRaw);
  return [canonical?.propertyId ?? canonicalRaw, subject.property_id, subject.landportal_property_id]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
}

function canonicalIdsForCard(card: PropertyCardRow): string[] {
  const fromUrl = landPortalIdentityFromUrl(card.lp_url)?.propertyId ?? '';
  return [...new Set([card.lp_property_id, fromUrl].map(text).filter(Boolean))];
}

function subjectCards(): SubjectCard[] {
  return getLandosDb().prepare(`
    SELECT p.*, d.deal_card_id, d.role
    FROM landos_property_card p
    JOIN landos_deal_card_property d ON d.card_id = p.id
    WHERE d.role = 'subject'
    ORDER BY p.id ASC, d.id ASC
  `).all() as SubjectCard[];
}

function resolveSubjectCard(subject: HermesLandPortalSubject, requestedId?: number): SubjectCard {
  const cards = subjectCards();
  if (requestedId != null) {
    if (!Number.isInteger(requestedId) || requestedId < 1) throw new Error('propertyCardId must be a positive integer.');
    const selected = cards.find((card) => card.id === requestedId);
    if (!selected) throw new Error(`Property Card ${requestedId} is not an existing subject card.`);
    return selected;
  }
  const urlPropertyId = validateLandPortalSubjectUrl(subject.subject_url).identity?.propertyId ?? null;
  const matches = cards.filter((card) => {
    if (!apnEquivalent(card.apn, subject.apn) || !addressMatches(card, subject.address)) return false;
    const retainedIds = canonicalIdsForCard(card);
    return !urlPropertyId || retainedIds.length === 0 || retainedIds.includes(urlPropertyId);
  });
  if (matches.length === 0) throw new Error('Hermes JSON does not match any existing canonical subject Property Card.');
  if (matches.length > 1) throw new Error('Hermes JSON matches more than one subject Property Card; pass propertyCardId explicitly.');
  return matches[0];
}

function validateSubject(subject: HermesLandPortalSubject, card: SubjectCard): {
  checks: HermesLandPortalValidationCheck[];
  propertyId: string;
  fips: string | null;
} {
  const url = validateLandPortalSubjectUrl(subject.subject_url);
  const urlIdentity = url.identity;
  const retainedIds = canonicalIdsForCard(card);
  const suppliedIds = explicitPropertyIds(subject);
  const suppliedCanonicalIdentity = parsedCanonicalPropertyIdentifier(subject.canonical_property_identifier);
  const propertyId = urlIdentity?.propertyId ?? '';
  const suppliedCanonicalIdentityMatches = !suppliedCanonicalIdentity || (
    suppliedCanonicalIdentity.propertyId === propertyId
    && suppliedCanonicalIdentity.fips === urlIdentity?.fips
    && apnEquivalent(suppliedCanonicalIdentity.apn, subject.apn)
    && apnEquivalent(suppliedCanonicalIdentity.apn, urlIdentity?.apn ?? '')
  );
  const checks: HermesLandPortalValidationCheck[] = [
    {
      check: 'verified_exact_subject',
      passed: subject.subject_verification_status === 'verified_exact_subject',
      reason: subject.subject_verification_status === 'verified_exact_subject'
        ? 'Hermes marked the payload as a verified exact subject.'
        : `Hermes subject status was "${subject.subject_verification_status}".`,
    },
    {
      check: 'property_address',
      passed: addressMatches(card, subject.address),
      reason: addressMatches(card, subject.address)
        ? `Hermes address matches Property Card ${card.id}.`
        : `Hermes address "${subject.address}" does not match Property Card ${card.id} address "${card.active_input_address}".`,
    },
    {
      check: 'apn',
      passed: apnEquivalent(card.apn, subject.apn) && !!urlIdentity?.apn && apnEquivalent(subject.apn, urlIdentity.apn),
      reason: apnEquivalent(card.apn, subject.apn) && !!urlIdentity?.apn && apnEquivalent(subject.apn, urlIdentity.apn)
        ? `Hermes APN and subject-URL APN match retained APN ${card.apn}.`
        : `Hermes APN ${subject.apn}, URL APN ${urlIdentity?.apn ?? 'missing'}, and retained APN ${card.apn || 'missing'} do not agree.`,
    },
    {
      check: 'canonical_property_identifier',
      passed: !!propertyId
        && suppliedIds.every((id) => id === propertyId)
        && suppliedCanonicalIdentityMatches
        && retainedIds.every((id) => id === propertyId),
      reason: !!propertyId
        && suppliedIds.every((id) => id === propertyId)
        && suppliedCanonicalIdentityMatches
        && retainedIds.every((id) => id === propertyId)
        ? `LandPortal property identifier ${propertyId} agrees everywhere it is available.`
        : `LandPortal property identifier mismatch (URL=${propertyId || 'missing'}, JSON=${suppliedIds.join(',') || 'not supplied'}, canonical tuple=${suppliedCanonicalIdentity ? `${suppliedCanonicalIdentity.fips}/${suppliedCanonicalIdentity.apn}/${suppliedCanonicalIdentity.propertyId}` : 'not supplied'}, retained=${retainedIds.join(',') || 'not supplied'}).`,
    },
    {
      check: 'subject_url',
      passed: url.valid,
      reason: url.valid ? 'Exact LandPortal subject URL is structurally valid.' : `LandPortal subject URL rejected: ${url.reason}.`,
    },
  ];
  const failed = checks.filter((check) => !check.passed);
  if (failed.length) throw new Error(`Hermes LandPortal import rejected: ${failed.map((check) => check.reason).join(' ')}`);
  return { checks, propertyId, fips: urlIdentity?.fips ?? null };
}

function captureTimestamp(subject: HermesLandPortalSubject, filePath: string): {
  value: string;
  source: 'json' | 'file_mtime';
} {
  for (const candidate of [subject.captured_at, subject.retrieved_at]) {
    const raw = text(candidate);
    const parsed = Date.parse(raw);
    if (raw && Number.isFinite(parsed)) return { value: new Date(parsed).toISOString(), source: 'json' };
  }
  return { value: fs.statSync(filePath).mtime.toISOString(), source: 'file_mtime' };
}

function canonicalInput(card: SubjectCard, subject: HermesLandPortalSubject, propertyId: string, fips: string | null): CanonicalPropertyInput {
  return {
    propertyCardId: card.id,
    dealCardId: card.deal_card_id,
    normalizedAddress: normalizeAddressKey(card.active_input_address),
    address: card.active_input_address,
    city: card.city || null,
    county: card.county || text(subject.county) || null,
    state: card.state || null,
    zip: card.zip || null,
    apn: card.apn || subject.apn,
    fips: card.fips || fips,
    landPortalPropertyId: card.lp_property_id || propertyId,
  };
}

const SUBJECT_FIELDS: Array<{ key: keyof HermesLandPortalSubject | 'landportal_property_id' | 'fips'; kind: 'fact' | 'estimate' | 'status' }> = [
  { key: 'subject_url', kind: 'fact' },
  { key: 'subject_verification_status', kind: 'status' },
  { key: 'subject_verification_note', kind: 'status' },
  { key: 'address', kind: 'fact' },
  { key: 'county', kind: 'fact' },
  { key: 'municipality', kind: 'fact' },
  { key: 'apn', kind: 'fact' },
  { key: 'landportal_property_id', kind: 'fact' },
  { key: 'fips', kind: 'fact' },
  { key: 'owner', kind: 'fact' },
  { key: 'mailing_address', kind: 'fact' },
  { key: 'deeded_acres', kind: 'fact' },
  { key: 'mls_acres', kind: 'fact' },
  { key: 'calculated_acres', kind: 'fact' },
  { key: 'road_frontage_ft', kind: 'fact' },
  { key: 'landlocked_status', kind: 'fact' },
  { key: 'wetlands_pct', kind: 'fact' },
  { key: 'fema_pct', kind: 'fact' },
  { key: 'average_slope_pct', kind: 'fact' },
  { key: 'pct_under_10pct_slope', kind: 'fact' },
  { key: 'pct_under_10pct_slope_note', kind: 'fact' },
  { key: 'buildability_pct', kind: 'fact' },
  { key: 'lp_estimate_total', kind: 'estimate' },
  { key: 'lp_estimate_per_acre', kind: 'estimate' },
  { key: 'water_feature_type', kind: 'fact' },
  { key: 'zoning_code', kind: 'fact' },
  { key: 'fema_flood_zone', kind: 'fact' },
  { key: 'fema_flood_zone_description', kind: 'fact' },
  { key: 'elevation_avg', kind: 'fact' },
  { key: 'elevation_min', kind: 'fact' },
  { key: 'elevation_max', kind: 'fact' },
  { key: 'soil_type', kind: 'fact' },
  { key: 'soil_description', kind: 'fact' },
  { key: 'building_sqft', kind: 'fact' },
  { key: 'year_built', kind: 'fact' },
  { key: 'improvement_value', kind: 'fact' },
  { key: 'parcel_sqft', kind: 'fact' },
  { key: 'land_use_description', kind: 'fact' },
  { key: 'subdivision', kind: 'fact' },
  { key: 'last_sale_price', kind: 'fact' },
  { key: 'last_sale_date', kind: 'fact' },
  { key: 'book_number', kind: 'fact' },
  { key: 'page_number', kind: 'fact' },
  { key: 'assessed_value', kind: 'fact' },
  { key: 'buildability_area_acres', kind: 'fact' },
];

function subjectEvidence(input: CanonicalPropertyInput, subject: HermesLandPortalSubject, propertyId: string, fips: string | null, retrievedAt: string): {
  evidence: NormalizedPropertyEvidence[];
  importedFields: string[];
  rejectedFields: string[];
} {
  const augmented = { ...subject, landportal_property_id: propertyId, fips } as unknown as Dict;
  const evidence: NormalizedPropertyEvidence[] = [];
  const rejectedFields: string[] = [];
  for (const definition of SUBJECT_FIELDS) {
    const value = augmented[definition.key];
    if (!present(value)) {
      if (Object.prototype.hasOwnProperty.call(augmented, definition.key)) rejectedFields.push(String(definition.key));
      continue;
    }
    evidence.push({
      id: `hermes-landportal:subject:${String(definition.key)}`,
      propertyCardId: input.propertyCardId,
      dealCardId: input.dealCardId,
      providerId: 'hermes_landportal_import',
      field: String(definition.key),
      value,
      subjectClassification: 'verified_subject',
      strength: 'provider_verified',
      sourceUrl: subject.subject_url,
      retrievedAt,
      confidence: 'high',
      kind: definition.kind,
      validation: { valid: true, reasons: [] },
    });
  }
  const accessItems = accessEvidenceItems(subject);
  // Only evidence the ladder RETAINS is persisted. A visual claim it refuses —
  // an interpretation dressed as an apparent route, or imagery asserting a legal
  // right — is recorded as a refused field instead of becoming an access fact,
  // which is how a written description of a scene nobody captured used to become
  // a finding. (`requireVisualArtifact` tightens this further once every worker
  // handback names the artifact it read; see the DISCOVERY note.)
  const accessReconciliation = reconcileAccessEvidence(accessItems);
  const rawAccessEvidence = new Map<AccessEvidenceItem, unknown>();
  accessItems.forEach((item, index) => rawAccessEvidence.set(item, subject.access_evidence?.[index] ?? item));
  for (const { item, reason } of accessReconciliation.rejected) {
    rejectedFields.push(`access_evidence.${item.tier} (${reason})`);
  }
  for (const [index, item] of accessReconciliation.items.entries()) {
    evidence.push({
      id: `hermes-landportal:subject:access-evidence:${index + 1}`,
      propertyCardId: input.propertyCardId,
      dealCardId: input.dealCardId,
      providerId: 'hermes_landportal_import',
      field: `access_evidence.${item.tier}.${index + 1}`,
      value: rawAccessEvidence.get(item) ?? item,
      subjectClassification: 'verified_subject',
      strength: item.basis === 'recorded_instrument' ? 'provider_verified' : 'provider_observed',
      sourceUrl: item.sourceUrl || subject.subject_url,
      retrievedAt: item.observedAt || retrievedAt,
      confidence: item.weight === 'confirmed' ? 'high' : item.weight === 'unresolved' ? 'low' : 'medium',
      kind: 'fact',
      validation: { valid: true, reasons: [] },
    });
  }
  if (accessReconciliation.items.length) {
    evidence.push({
      id: 'hermes-landportal:subject:access-reconciliation',
      propertyCardId: input.propertyCardId,
      dealCardId: input.dealCardId,
      providerId: 'hermes_landportal_import',
      field: 'access_evidence.reconciliation',
      value: accessReconciliation,
      subjectClassification: 'verified_subject',
      strength: accessReconciliation.verifiedLegalAccess ? 'provider_verified' : 'provider_observed',
      sourceUrl: subject.subject_url,
      retrievedAt,
      confidence: accessReconciliation.conclusionWeight === 'confirmed' ? 'high' : 'medium',
      kind: 'fact',
      validation: { valid: true, reasons: [] },
    });
  }
  return { evidence, importedFields: evidence.map((item) => item.field), rejectedFields };
}

function accessEvidenceItems(subject: HermesLandPortalSubject): AccessEvidenceItem[] {
  const items = (subject.access_evidence ?? []).map((item) => ({
    tier: item.tier,
    statement: item.statement,
    sourceLabel: item.source_label,
    sourceKind: item.source_kind,
    basis: item.basis,
    weight: item.weight,
    sourceUrl: item.source_url ?? subject.subject_url,
    observedAt: item.observed_at ?? subject.captured_at ?? subject.retrieved_at ?? null,
    artifactRef: item.artifact_key ?? null,
  }));
  if (/^(?:yes|true|1|land\s*locked|land\s*locked\s*:\s*yes)$/i.test(text(subject.landlocked_status))
    && !items.some((item) => item.tier === 'parcel_flag')) {
    items.unshift({
      tier: 'parcel_flag',
      statement: 'LandPortal flags the parcel as landlocked because it does not directly front a recognized named road.',
      sourceLabel: 'LandPortal parcel panel',
      sourceKind: 'landportal_parcel_flag',
      basis: 'source_stated',
      weight: 'likely',
      sourceUrl: subject.subject_url,
      observedAt: subject.captured_at ?? subject.retrieved_at ?? null,
      artifactRef: null,
    });
  }
  return items;
}

export function hermesLandPortalCompKey(comp: HermesLandPortalComp): string {
  const pieces = [
    compactApn(comp.apn) ? `apn:${compactApn(comp.apn)}` : '',
    compact(comp.address) ? `address:${compact(comp.address)}` : '',
    `price:${comp.price.toFixed(2)}`,
    `acres:${comp.acres.toFixed(4)}`,
    text(comp.sale_date) ? `sale:${text(comp.sale_date).slice(0, 10)}` : '',
  ].filter(Boolean);
  return `hermes-landportal|${pieces.join('|')}`;
}

function sameOptionalText(a: unknown, b: unknown, normalizer: (value: unknown) => string): boolean {
  const left = normalizer(a);
  const right = normalizer(b);
  return !left || !right || left === right;
}

function sameOptionalNumber(a: number | null | undefined, b: number | null | undefined, tolerance: number): boolean {
  return a == null || b == null || Math.abs(a - b) <= tolerance;
}

/**
 * The stored row this incoming comparable UPDATES, or null for a new parcel.
 *
 * Matched on parcel identity, never on the figures. The previous test required
 * price and acreage to agree to within a cent and a ten-thousandth of an acre,
 * so a re-read that disagreed about either — the only case where reconciliation
 * has anything to do — was filed as a separate property. 5170 Hwy 60 ended up
 * holding APN 044 068.01 twice, at $200,000/5.05 ac and $550,000/20.55 ac, and
 * which one priced the subject came down to dedupe ordering downstream.
 *
 * When identity cannot be established the row is left alone: a comparable is
 * never merged into another parcel on a resemblance.
 */
function identityMatchedRows(comp: HermesLandPortalComp, rows: CompRow[], county?: string | null): CompRow[] {
  const incoming = {
    apn: comp.apn ?? null,
    county: county ?? null,
    state: comp.state ?? null,
    sourceUrl: comp.source_url ?? null,
  };
  return rows.filter((row) => sameCompParcel(incoming, {
    apn: row.apn, county: row.county, state: row.state, sourceUrl: row.source_url,
  }));
}

function duplicateRegistryComp(comp: HermesLandPortalComp, rows: CompRow[], county?: string | null): CompRow | null {
  return identityMatchedRows(comp, rows, county)[0] ?? null;
}

function compEvidence(input: CanonicalPropertyInput, subject: HermesLandPortalSubject, retrievedAt: string): NormalizedPropertyEvidence[] {
  return subject.comps.map((comp) => {
    const key = hermesLandPortalCompKey(comp);
    return {
      id: `hermes-landportal:comp:${crypto.createHash('sha256').update(key).digest('hex').slice(0, 20)}`,
      propertyCardId: input.propertyCardId,
      dealCardId: input.dealCardId,
      providerId: 'hermes_landportal_import',
      field: `comparables.landportal.${key}`,
      value: Object.fromEntries(Object.entries(comp).filter(([, value]) => present(value))),
      subjectClassification: 'context_only',
      strength: 'provider_observed',
      sourceUrl: comp.source_url || subject.subject_url,
      retrievedAt,
      confidence: 'high',
      kind: 'comp',
      validation: { valid: true, reasons: [] },
      artifactHash: crypto.createHash('sha256').update(JSON.stringify(comp)).digest('hex'),
      viewUrl: null,
    } satisfies NormalizedPropertyEvidence;
  });
}

interface PreparedHermesVisual {
  artifact: HermesLandPortalVisualArtifact;
  sourcePath: string;
  sha256: string;
  bytes: number;
  validation: ReturnType<typeof validateLandPortalVisualEvidence>;
}

function prepareVisuals(
  subject: HermesLandPortalSubject,
  card: SubjectCard,
  sourceFile: string,
): { accepted: PreparedHermesVisual[]; rejected: Array<{ artifact: HermesLandPortalVisualArtifact; reason: string }> } {
  const artifactRoot = path.dirname(sourceFile);
  const priorHashes = (loadPropertyInspection(card.id)?.assets ?? [])
    .map((asset) => asset.validation?.sha256 ?? null)
    .filter((value): value is string => !!value);
  const accepted: PreparedHermesVisual[] = [];
  const rejected: Array<{ artifact: HermesLandPortalVisualArtifact; reason: string }> = [];
  for (const artifact of subject.visual_artifacts ?? []) {
    const sourcePath = path.resolve(artifactRoot, artifact.source_path);
    const relative = path.relative(artifactRoot, sourcePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      rejected.push({ artifact, reason: 'visual source_path must remain inside the property-specific Hermes output directory' });
      continue;
    }
    if (OVERLAY_RENDER_REQUIRED_VIEWS.has(artifact.requested_view) && artifact.overlay_rendered !== true) {
      rejected.push({ artifact, reason: `${artifact.requested_view} capture does not attest visibly rendered overlay polygons (overlay_rendered must be true); base imagery alone is not overlay evidence` });
      continue;
    }
    if (artifact.key === OVERVIEW_CAPTURE_KEY || artifact.requested_view === 'parcel_context') {
      const overviewVerdict = assessOverviewFraming(artifact);
      if (!overviewVerdict.accepted) {
        rejected.push({ artifact, reason: overviewVerdict.reason });
        continue;
      }
    }
    if (!/\.(?:png|jpe?g|webp)$/i.test(sourcePath) || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      rejected.push({ artifact, reason: 'visual source_path is not a retained PNG, JPEG, or WebP file' });
      continue;
    }
    const file = fs.readFileSync(sourcePath);
    const sha256 = crypto.createHash('sha256').update(file).digest('hex');
    const validation = validateLandPortalVisualEvidence({
      propertyCardId: card.id,
      expectedPropertyCardId: card.id,
      subjectClassification: 'verified_subject',
      requestedView: artifact.requested_view,
      activeView: artifact.active_view,
      boundaryRequired: artifact.boundary_required,
      boundaryVisible: artifact.boundary_visible,
      tilesLoaded: artifact.tiles_loaded,
      bytes: file.byteLength,
      sha256,
      priorSha256s: priorHashes,
      cameraScale: artifact.camera_scale,
      clipped: artifact.clipped,
      obstructions: artifact.obstructions,
    });
    if (validation.status !== 'accepted') {
      rejected.push({ artifact, reason: validation.reasons.join(' ') || 'visual validation rejected the artifact' });
      continue;
    }
    priorHashes.push(sha256);
    accepted.push({ artifact, sourcePath, sha256, bytes: file.byteLength, validation });
  }
  const overviewSelection = selectOverviewVisual(accepted.map((entry, index) => ({ ...entry.artifact, __index: index })));
  if (overviewSelection.accepted && overviewSelection.artifact) {
    const index = Number(overviewSelection.artifact.__index);
    const selected = accepted[index];
    if (selected) {
      accepted[index] = {
        ...selected,
        artifact: {
          ...selected.artifact,
          key: OVERVIEW_CAPTURE_KEY,
          purpose: selected.artifact.purpose || 'Deliberately framed parcel-to-road Overview',
        },
      };
    }
  }
  return { accepted, rejected };
}

function visualEvidence(input: CanonicalPropertyInput, subject: HermesLandPortalSubject, visuals: PreparedHermesVisual[]): NormalizedPropertyEvidence[] {
  return visuals.map(({ artifact, sha256, bytes }) => ({
    id: `hermes-landportal:visual:${sha256}`,
    propertyCardId: input.propertyCardId,
    dealCardId: input.dealCardId,
    providerId: 'hermes_landportal_import',
    field: `visuals.landportal.${artifact.key}`,
    value: { key: artifact.key, label: artifact.label, purpose: artifact.purpose, requestedView: artifact.requested_view, bytes },
    subjectClassification: 'verified_subject',
    strength: 'provider_verified',
    sourceUrl: subject.subject_url,
    retrievedAt: artifact.timestamp,
    confidence: 'high',
    kind: 'visual',
    validation: { valid: true, reasons: [] },
    artifactHash: sha256,
    viewUrl: null,
  }));
}

function providerResult(input: {
  runId: string;
  laneId: 'hermes_landportal_subject' | 'hermes_landportal_comps' | 'hermes_landportal_visuals';
  property: CanonicalPropertyInput;
  subject: HermesLandPortalSubject;
  evidence: NormalizedPropertyEvidence[];
  capturedAt: string;
  persistedAt: string;
  checks: HermesLandPortalValidationCheck[];
}): PropertyProviderResult<HermesLandPortalSubject> {
  const contextLane = input.laneId === 'hermes_landportal_comps';
  return {
    contractVersion: 'property-provider-v1',
    runId: input.runId,
    laneId: input.laneId,
    providerId: 'hermes_landportal_import',
    input: input.property,
    execution: {
      attempted: true,
      startedAt: input.capturedAt,
      completedAt: input.persistedAt,
      durationMs: Math.max(0, Date.parse(input.persistedAt) - Date.parse(input.capturedAt)) || 0,
      result: input.subject,
    },
    validation: {
      valid: true,
      subjectClassification: contextLane ? 'context_only' : 'verified_subject',
      checks: input.checks.map((check) => ({ check: check.check, passed: check.passed, reason: check.reason })),
      rejectedEvidenceIds: [],
    },
    evidence: input.evidence,
    status: contextLane ? 'context_only' : 'verified',
    persistence: { attempted: false, persisted: false, retainedEvidenceCount: 0, rejectedEvidenceCount: 0, reason: null },
    failureReason: null,
  };
}

/** Displayed sidebar value preserved verbatim (numbers keep their shown form). */
const displayed = (value: number | string | null | undefined): string | null =>
  value == null ? null : typeof value === 'number' ? String(value) : text(value) || null;

function inspectionFacts(subject: HermesLandPortalSubject, retained: Record<string, string>): Record<string, string> {
  // Same rule as the evidence path: an Access Evidence fact row can only restate
  // what the ladder retained, so a refused visual claim never reaches one.
  const access = reconcileAccessEvidence(accessEvidenceItems(subject));
  const candidates: Record<string, string | null> = {
    'Owner Name': text(subject.owner) || null,
    'Parcel ID': subject.apn,
    'Parcel Address': subject.address,
    'Parcel Address County': text(subject.county) || null,
    Municipality: text(subject.municipality) || null,
    'Owner Mailing Address': text(subject.mailing_address) || null,
    Acres: finite(subject.deeded_acres) == null ? null : finite(subject.deeded_acres)!.toFixed(3),
    'MLS Acres': finite(subject.mls_acres) == null ? null : String(finite(subject.mls_acres)),
    'Calc Acres': finite(subject.calculated_acres) == null ? null : String(finite(subject.calculated_acres)),
    'Road Frontage': finite(subject.road_frontage_ft) == null ? null : `${finite(subject.road_frontage_ft)} ft`,
    'Land Locked': text(subject.landlocked_status) || null,
    'Wetlands Coverage (%)': finite(subject.wetlands_pct) == null ? null : finite(subject.wetlands_pct)!.toFixed(2),
    'FEMA Coverage (%)': finite(subject.fema_pct) == null ? null : finite(subject.fema_pct)!.toFixed(2),
    'Slope Avg': finite(subject.average_slope_pct) == null ? null : percent(finite(subject.average_slope_pct)!),
    'Slope Under 10% (%)': finite(subject.pct_under_10pct_slope) == null ? null : finite(subject.pct_under_10pct_slope)!.toFixed(2),
    'Slope Under 10% Note': text(subject.pct_under_10pct_slope_note) || null,
    'Buildability total (%)': finite(subject.buildability_pct) == null ? null : percent(finite(subject.buildability_pct)!),
    'Estimate price': finite(subject.lp_estimate_total) == null ? null : money(finite(subject.lp_estimate_total)!),
    'Estimate PPA': finite(subject.lp_estimate_per_acre) == null ? null : money(finite(subject.lp_estimate_per_acre)!),
    // Sidebar fields keep the exact LandPortal label and displayed value.
    // Retained values are never overwritten (the filter below skips any label
    // an earlier or stronger source already established).
    'Buildability area (acres)': finite(subject.buildability_area_acres) == null ? null : String(finite(subject.buildability_area_acres)),
    'Water Feature Type': displayed(subject.water_feature_type),
    'Zoning Code': displayed(subject.zoning_code),
    'FEMA Flood Zone': displayed(subject.fema_flood_zone),
    'FEMA Flood Zone Description': displayed(subject.fema_flood_zone_description),
    // Terrain / soils / improvement / parcel context, under the exact labels the
    // fact sheet reads, so LandPortal-supplied intelligence is retained rather
    // than surfacing as "Not retained".
    'Elevation Avg': displayed(subject.elevation_avg),
    'Elevation Min': displayed(subject.elevation_min),
    'Elevation Max': displayed(subject.elevation_max),
    'Soil Type': displayed(subject.soil_type),
    'Soil Description': displayed(subject.soil_description),
    'Building SqFt': displayed(subject.building_sqft),
    'Year Built': displayed(subject.year_built),
    'Improvement Value': displayed(subject.improvement_value),
    'Parcel SqFt': displayed(subject.parcel_sqft),
    'Parcel Use Description': displayed(subject.land_use_description),
    Subdivision: displayed(subject.subdivision),
    'Last Sale Price': displayed(subject.last_sale_price),
    'Last Sale Date': displayed(subject.last_sale_date),
    'Book Number': displayed(subject.book_number),
    'Page Number': displayed(subject.page_number),
    'Assessed Value': displayed(subject.assessed_value),
    'Access Evidence · Parcel Flag': access.byTier.parcel_flag.length
      ? access.byTier.parcel_flag.map((item) => `${item.statement} — ${item.sourceLabel}`).join(' | ') : null,
    'Access Evidence · Apparent Physical': access.byTier.apparent_physical.length
      ? access.byTier.apparent_physical.map((item) => `${item.statement} — ${item.sourceLabel}`).join(' | ') : null,
    'Access Evidence · Reported Legal': access.byTier.reported_legal.length
      ? access.byTier.reported_legal.map((item) => `${item.statement} — ${item.sourceLabel}`).join(' | ') : null,
    'Access Evidence · Verified Legal': access.byTier.verified_legal.length
      ? access.byTier.verified_legal.map((item) => `${item.statement} — ${item.sourceLabel} (${item.basis.replace(/_/g, ' ')})`).join(' | ') : null,
    'Access Evidence · Operator Conclusion': access.items.length ? access.operatorConclusion : null,
  };
  return Object.fromEntries(Object.entries(candidates).filter(([label, value]) => !present(retained[label]) && present(value))) as Record<string, string>;
}

/** A comparable pair the capture already settled on the parcel's own deed. */
export interface RetainedDeedPair {
  price: number;
  acres: number;
  saleDate: string | null;
  note: string | null;
}

/**
 * Index the retained comparables the capture settled on a parcel deed record,
 * keyed by parcel identity.
 *
 * Only a complete pair is carried: a price without the acreage it was paid over
 * is exactly the half-fact this whole repair exists to prevent.
 */
export function deedPairsByParcel(
  comparables: Array<Partial<LandPortalComparableRecord>>,
  county?: string | null,
): Map<string, RetainedDeedPair> {
  const out = new Map<string, RetainedDeedPair>();
  for (const row of comparables) {
    if (row.pricingBasis !== 'parcel_deed_record') continue;
    if (typeof row.price !== 'number' || typeof row.acres !== 'number' || !(row.acres > 0)) continue;
    const key = compParcelRegistryKey({
      apn: row.apn ?? null,
      county: row.county ?? county ?? null,
      state: row.state ?? null,
      sourceUrl: row.detailUrl ?? row.sourceUrl ?? null,
    });
    if (!key || out.has(key)) continue;
    out.set(key, {
      price: row.price,
      acres: row.acres,
      saleDate: row.saleDate ?? null,
      note: row.pricingBasisNote ?? null,
    });
  }
  return out;
}

function enrichedHermesComp(comp: HermesLandPortalComp, subject: SubjectCard, deed: RetainedDeedPair | null = null) {
  const sidebar = {
    apn: comp.apn,
    // The settled deed pair replaces the handback's listing pair as a UNIT, and
    // the per-acre rate is dropped so it is re-derived from the pair retained
    // rather than carried across a corrected acreage.
    price: deed ? deed.price : comp.price,
    acres: deed ? deed.acres : comp.acres,
    saleDate: deed ? deed.saleDate ?? comp.sale_date : comp.sale_date,
    pricePerAcre: deed ? null : comp.price_per_acre,
    detailUrl: comp.source_url,
  };
  const hasDetailEvidence = comp.drilled_down === true || [
    comp.address, comp.city, comp.state, comp.zip, comp.lat, comp.lng,
    comp.image_url, comp.image_source, comp.detail_url,
  ].some((value) => present(value));
  return mergeCompDetail(sidebar, hasDetailEvidence ? {
    address: comp.address,
    city: comp.city,
    state: comp.state,
    zip: comp.zip,
    apn: comp.apn,
    // The detail surface carries the same listing pair, so the settled deed
    // pair has to win here too or it is reinstated one line later.
    acres: deed ? deed.acres : comp.acres,
    price: deed ? deed.price : comp.price,
    saleDate: deed ? deed.saleDate ?? comp.sale_date : comp.sale_date,
    pricePerAcre: deed ? null : comp.price_per_acre,
    lat: comp.lat,
    lng: comp.lng,
    imageUrl: comp.image_url,
    imageSourceLabel: comp.image_source,
    detailUrl: comp.detail_url,
  } : null, { lat: subject.lat, lng: subject.lng });
}

function projectedComparable(comp: HermesLandPortalComp, duplicate: CompRow | null, subjectUrl: string, capturedAt: string, subject: SubjectCard, deed: RetainedDeedPair | null = null): LandPortalComparableRecord {
  const enriched = enrichedHermesComp(comp, subject, deed);
  const isSale = duplicate?.status === 'verified_sale' || duplicate?.price_kind === 'sale';
  const address = enriched.address || text(duplicate?.address_desc) || null;
  const price = deed ? deed.price : comp.price;
  const acres = deed ? deed.acres : comp.acres;
  // The projection is what the NEXT import reads back, so the settled basis has
  // to be written here too — otherwise the pair survives one cycle and is lost
  // on the following one.
  const saleDate = (deed ? text(deed.saleDate) : '') || text(comp.sale_date) || text(duplicate?.sale_or_list_date) || '';
  return {
    rawText: [address || comp.apn || 'LandPortal comp', money(price), `${acres} ac`].join(' | '),
    sourceUrl: enriched.detailUrl || comp.source_url || subjectUrl,
    surface: enriched.drilledDown ? 'both' : 'sidebar',
    apn: text(comp.apn) || text(duplicate?.apn) || null,
    address,
    saleDate: saleDate || undefined,
    acres,
    price,
    pricingBasis: deed ? 'parcel_deed_record' : null,
    pricingBasisNote: deed?.note ?? null,
    pricePerAcre: price != null && acres != null && acres > 0
      ? price / acres
      : enriched.pricePerAcre ?? duplicate?.price_per_acre ?? null,
    distanceMiles: enriched.locationResolution.distanceMiles,
    status: isSale ? 'sold' : 'unknown',
    saleListIndicator: isSale ? 'sale' : 'unknown',
    improvement: /vacant/i.test(`${duplicate?.property_class ?? ''} ${duplicate?.classification ?? ''}`) ? 'vacant' : 'unknown',
    confidence: 'high',
    statusSource: isSale ? 'detail_surface' : null,
    city: enriched.city,
    state: enriched.state,
    lat: enriched.lat,
    lng: enriched.lng,
    detailUrl: enriched.detailUrl,
    capturedAtIso: capturedAt,
  };
}

/**
 * Validate a specialist handback against the retained subject without writing.
 * The concurrent controller uses this to establish one run-scoped identity
 * before any sibling category reaches the canonical importer.
 */
export function validateHermesLandPortalFileIdentity(
  filePath: string,
  options: Pick<ImportHermesLandPortalOptions, 'propertyCardId'> = {},
): HermesLandPortalValidatedIdentity {
  const sourceFile = path.resolve(filePath);
  let parsed: unknown;
  try { parsed = JSON.parse(fs.readFileSync(sourceFile, 'utf8')); } catch (error) {
    throw new Error(`Hermes LandPortal file is not valid JSON: ${(error as Error).message}`);
  }
  const subject = parseHermesLandPortalSubject(parsed);
  const card = resolveSubjectCard(subject, options.propertyCardId);
  const validation = validateSubject(subject, card);
  return {
    address: subject.address,
    apn: subject.apn,
    subjectUrl: subject.subject_url,
    propertyId: validation.propertyId,
    fips: validation.fips,
    propertyCardId: card.id,
    dealCardId: card.deal_card_id,
    specialistCategory: subject.specialist_category ?? null,
    completedCategories: subject.completed_categories
      ?? (['subject', 'comps', ...((subject.visual_artifacts?.length ?? 0) ? ['visuals' as const] : [])] satisfies HermesLandPortalResultCategory[]),
    checks: validation.checks,
  };
}

export function importHermesLandPortalFile(
  filePath: string,
  options: ImportHermesLandPortalOptions = {},
): HermesLandPortalImportResult {
  const sourceFile = path.resolve(filePath);
  const rawText = fs.readFileSync(sourceFile, 'utf8');
  let parsed: unknown;
  try { parsed = JSON.parse(rawText); } catch (error) {
    throw new Error(`Hermes LandPortal file is not valid JSON: ${(error as Error).message}`);
  }
  const subject = parseHermesLandPortalSubject(parsed);
  const card = resolveSubjectCard(subject, options.propertyCardId);
  const validation = validateSubject(subject, card);
  if (options.expectedIdentity) {
    const expected = options.expectedIdentity;
    const conflicts = [
      normalizeAddressKey(expected.address) === normalizeAddressKey(subject.address) ? null : 'address',
      apnEquivalent(expected.apn, subject.apn) ? null : 'APN',
      expected.propertyId === validation.propertyId ? null : 'LandPortal property identifier',
      expected.subjectUrl === subject.subject_url ? null : 'LandPortal subject URL',
    ].filter((value): value is string => !!value);
    if (conflicts.length) {
      throw new Error(`Hermes specialist identity conflict rejected (${conflicts.join(', ')}).`);
    }
  }
  const captured = captureTimestamp(subject, sourceFile);
  const fileHash = crypto.createHash('sha256').update(rawText).digest('hex');
  const runId = `hermes-landportal-${card.id}-${fileHash.slice(0, 24)}`;
  const property = canonicalInput(card, subject, validation.propertyId, validation.fips);
  const normalizedSubject = subjectEvidence(property, subject, validation.propertyId, validation.fips, captured.value);
  const completedCategories = subject.completed_categories
    ?? (['subject', 'comps', ...((subject.visual_artifacts?.length ?? 0) ? ['visuals' as const] : [])] satisfies HermesLandPortalResultCategory[]);
  const now = options.now ?? (() => new Date().toISOString());
  const categoryResults: HermesLandPortalCategoryImportResult[] = [];
  let createdCompCount = 0;
  let duplicateCompCount = 0;
  let importedVisualCount = 0;
  let rejectedVisualCount = 0;

  const categoryRunId = (category: HermesLandPortalResultCategory, value: unknown): string =>
    `hermes-landportal-${category}-${card.id}-${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)}`;
  const priorCategoryResult = (category: HermesLandPortalResultCategory, categoryId: string): HermesLandPortalCategoryImportResult | null => {
    const row = getLandosDb().prepare(
      'SELECT created_at FROM landos_card_activity WHERE card_id = ? AND kind = ? AND ref = ? LIMIT 1',
    ).get(card.id, `hermes_landportal_${category}_import`, categoryId) as { created_at?: string } | undefined;
    return row ? {
      category,
      runId: categoryId,
      imported: false,
      persistedAt: row.created_at || captured.value,
      retainedEvidenceCount: 0,
      itemCount: category === 'subject' ? normalizedSubject.evidence.length : category === 'comps' ? subject.comps.length : subject.visual_artifacts?.length ?? 0,
      rejectedItemCount: 0,
      error: null,
    } : null;
  };

  if (completedCategories.includes('subject')) {
    const subjectHashInput = Object.fromEntries(Object.entries(subject).filter(([key]) => !['comps', 'visual_artifacts', 'completed_categories'].includes(key)));
    const categoryId = categoryRunId('subject', subjectHashInput);
    const prior = priorCategoryResult('subject', categoryId);
    if (prior) categoryResults.push(prior);
    else {
      const persistedAt = now();
      try {
        const applied = getLandosDb().transaction(() => {
          const persisted = new PropertyResearchStore().persistProviderResult(providerResult({
            runId: categoryId, laneId: 'hermes_landportal_subject', property, subject,
            evidence: normalizedSubject.evidence, capturedAt: captured.value, persistedAt, checks: validation.checks,
          }));
          if (!persisted.persistence.persisted) throw new Error(persisted.persistence.reason || 'Canonical subject persistence rejected the Hermes import.');
          const retainedCard = getPropertyCardRow(card.id)!;
          upsertPropertyCard({
            cardId: retainedCard.id,
            entity: retainedCard.entity as LandosEntity,
            activeInputAddress: retainedCard.active_input_address,
            city: retainedCard.city,
            zip: retainedCard.zip,
            county: retainedCard.county || text(subject.county),
            state: retainedCard.state,
            apn: retainedCard.apn,
            lpPropertyId: retainedCard.lp_property_id || validation.propertyId,
            fips: retainedCard.fips || validation.fips || '',
            lpUrl: subject.subject_url,
            owner: retainedCard.owner || text(subject.owner),
            acres: retainedCard.acres ?? finite(subject.deeded_acres) ?? finite(subject.calculated_acres) ?? undefined,
            verified: true,
            verificationSource: retainedCard.verification_source || 'Hermes validated LandPortal JSON import',
            agentId: 'hermes-landportal-import',
          });
          const retainedInspection = loadPropertyInspection(card.id);
          savePropertyInspection(card.id, {
            parcelUrl: subject.subject_url,
            parcelUrlRecord: {
              url: subject.subject_url,
              source: 'Hermes validated LandPortal incremental subject import',
              capturedAt: captured.value,
              propertyCardId: card.id,
              dealCardId: card.deal_card_id,
              verifiedSubject: true,
              apn: subject.apn,
              fips: validation.fips,
              propertyId: validation.propertyId,
            },
            threeDCapture: retainedInspection?.threeDCapture ?? null,
            comparablesUrl: retainedInspection?.comparablesUrl ?? null,
            comparablesCapturedAt: null,
            parcelFacts: inspectionFacts(subject, retainedInspection?.parcelFacts ?? {}),
            // Access evidence is NOT republished as a visual observation. It
            // carries no image, and looping written access wording back through
            // the visual-observation record is exactly how a described feature
            // became a "seen" one. Access evidence lives on the ladder and in
            // the Access Evidence facts above; visual observations come only
            // from the visuals category, and only with a retained panorama.
            assets: [], overlays: [], visualObservations: [], comparables: [],
            sources: [{ provider: 'LandPortal', stage: 'hermes_subject_import', status: 'used', resultKind: 'retrieved', attemptedAt: captured.value, confidence: 'high', url: subject.subject_url, note: `Exact subject identity for ${subject.address} persisted independently from ${path.basename(sourceFile)}.` }],
            evidence: [{ label: 'Hermes LandPortal verified subject import', status: 'verified', detail: `Exact address, APN, subject URL, and LandPortal property identifier validated for ${subject.address}.`, confidence: 'high', source: 'Hermes validated LandPortal incremental import', url: subject.subject_url }],
          });
          attachCardActivity({ cardId: card.id, agentId: 'hermes-landportal-import', kind: 'hermes_landportal_subject_import', summary: `Persisted verified Hermes LandPortal subject facts for ${subject.address}.`, ref: categoryId });
          return persisted.persistence.retainedEvidenceCount;
        })();
        categoryResults.push({ category: 'subject', runId: categoryId, imported: true, persistedAt, retainedEvidenceCount: applied, itemCount: normalizedSubject.evidence.length, rejectedItemCount: 0, error: null });
      } catch (error) {
        categoryResults.push({ category: 'subject', runId: categoryId, imported: false, persistedAt, retainedEvidenceCount: 0, itemCount: normalizedSubject.evidence.length, rejectedItemCount: normalizedSubject.evidence.length, error: (error as Error).message });
      }
    }
  }

  if (completedCategories.includes('comps')) {
    const categoryId = categoryRunId('comps', { address: subject.address, apn: subject.apn, propertyId: validation.propertyId, comps: subject.comps });
    const prior = priorCategoryResult('comps', categoryId);
    if (prior) {
      duplicateCompCount = subject.comps.length;
      categoryResults.push(prior);
    } else {
      const persistedAt = now();
      try {
        const applied = getLandosDb().transaction(() => {
          const normalizedComps = compEvidence(property, subject, captured.value);
          const existingComps = listComps({ dealCardId: card.deal_card_id, limit: 500 });
          const compCounty = text(subject.county) || card.county;
          const duplicates = subject.comps.map((comp) => duplicateRegistryComp(comp, existingComps, compCounty));
          const persisted = new PropertyResearchStore().persistProviderResult(providerResult({
            runId: categoryId, laneId: 'hermes_landportal_comps', property, subject,
            evidence: normalizedComps, capturedAt: captured.value, persistedAt, checks: validation.checks,
          }));
          if (!persisted.persistence.persisted) throw new Error(persisted.persistence.reason || 'Canonical comp persistence rejected the Hermes import.');
          const retainedInspection = loadPropertyInspection(card.id);
          // ── THE CAPTURE'S DEED PAIR OUTRANKS THE HANDBACK'S LISTING PAIR ──
          //
          // The capture reads each comparable's own parcel record and, where the
          // `similars` feed's area contradicts it, settles the comparable on its
          // recorded deed. The Hermes handback never sees that surface: it
          // reports the feed's figures. Left alone this import overwrites the
          // settled pair with the very listing pair it replaced — which is how
          // APN 044 068.01 kept coming back as $200,000 over 20.55 acres, the
          // figures belonging to the neighbouring parcel 043 042.
          //
          // A retained comparable already settled on `parcel_deed_record`
          // therefore carries its pair forward WHOLE. Nothing else is taken from
          // it, and a comparable the capture never settled is untouched.
          const retainedDeedPairs = deedPairsByParcel(retainedInspection?.comparables ?? [], compCounty);
          const deedPairFor = (comp: HermesLandPortalComp): RetainedDeedPair | null => {
            const key = compParcelRegistryKey({
              apn: comp.apn ?? null, county: compCounty, state: comp.state ?? null, sourceUrl: comp.source_url ?? null,
            });
            return key ? retainedDeedPairs.get(key) ?? null : null;
          };
          savePropertyInspection(card.id, {
            parcelUrl: subject.subject_url,
            parcelUrlRecord: retainedInspection?.parcelUrlRecord ?? null,
            threeDCapture: retainedInspection?.threeDCapture ?? null,
            comparablesUrl: retainedInspection?.comparablesUrl ?? subject.subject_url,
            comparablesCapturedAt: captured.value,
            parcelFacts: {}, assets: [], overlays: [], visualObservations: [],
            comparables: subject.comps.map((comp, index) => projectedComparable(comp, duplicates[index], subject.subject_url, captured.value, card, deedPairFor(comp))),
            sources: [{ provider: 'LandPortal', stage: 'hermes_comps_import', status: 'used', resultKind: 'retrieved', attemptedAt: captured.value, confidence: 'high', url: subject.subject_url, note: `${subject.comps.length} comparable row(s) for ${subject.address} persisted independently after exact-subject validation.` }],
            evidence: [{ label: 'Hermes LandPortal comparable import', status: 'observed', detail: `${subject.comps.length} LandPortal comparable row(s) retained as context-only evidence for ${subject.address}.`, confidence: 'high', source: 'Hermes validated LandPortal incremental import', url: subject.subject_url }],
          });
          let created = 0;
          let retired = 0;
          for (const [index, comp] of subject.comps.entries()) {
            const enriched = enrichedHermesComp(comp, card, deedPairFor(comp));
            const persistence = buildLandPortalCompPersistence(enriched);
            upsertNormalizedComp({
              entity: card.entity as LandosEntity, dealCardId: card.deal_card_id, cardId: card.id,
              sourceLabel: 'LandPortal', canonicalSource: persistence.canonical_source, sourceUrl: persistence.source_url || comp.source_url || subject.subject_url,
              addressDesc: persistence.address_desc ?? undefined, apn: persistence.apn ?? undefined, county: text(subject.county) || card.county,
              city: persistence.city ?? undefined, state: persistence.state ?? undefined, zip: persistence.zip ?? undefined,
              price: persistence.price ?? undefined, priceKind: persistence.price_kind as 'sale' | 'list' | 'unknown', saleOrListDate: persistence.sale_or_list_date ?? undefined, acres: persistence.acres ?? undefined,
              pricePerAcre: persistence.price_per_acre ?? undefined,
              lat: persistence.lat ?? undefined, lng: persistence.lng ?? undefined, distanceMiles: persistence.distance_miles ?? undefined, thumbnailUrl: persistence.thumbnail_url ?? undefined,
              notes: `Hermes-imported LandPortal comparable. ${persistence.notes}`,
              addedBy: 'hermes-landportal-import', status: duplicates[index] ? undefined : 'manual_unverified', propertyClass: 'land', classification: 'landportal_context',
              retrievedAt: captured.value, inclusionReason: `LandPortal comparable retained for exact subject ${subject.address}.`,
              sourceAttributions: [{ provider: 'Hermes / LandPortal', url: persistence.source_url || comp.source_url || subject.subject_url }],
              // Key the registry row on the PARCEL, so the next generation's
              // figures update this row instead of forking a second one. The
              // old key embedded price and acreage, which made a re-read at
              // different figures look like a different property. An
              // unidentifiable comparable keeps the legacy value key rather
              // than being merged into anything on a guess.
              pricingBasis: deedPairFor(comp) ? 'parcel_deed_record' : undefined,
              canonicalKey: duplicates[index]?.canonical_key
                || compParcelRegistryKey({
                  apn: comp.apn ?? null,
                  county: compCounty,
                  state: comp.state ?? null,
                  sourceUrl: persistence.source_url || comp.source_url || null,
                })
                || hermesLandPortalCompKey(comp),
            });
            if (!duplicates[index]) created += 1;
            // Rows the value-keyed registry already forked for this same parcel
            // are retired here. They are marked rejected, never deleted: the
            // superseded figures stay visible in the ledger with the reason, and
            // no operator data is destroyed. Only the row just reconciled above
            // remains eligible to price the subject.
            const survivor = duplicates[index];
            for (const stale of identityMatchedRows(comp, existingComps, compCounty)) {
              if (!survivor || stale.id === survivor.id || stale.status === 'rejected') continue;
              retireForkedCompRow(stale, survivor);
              retired += 1;
            }
          }
          attachCardActivity({ cardId: card.id, agentId: 'hermes-landportal-import', kind: 'hermes_landportal_comps_import', summary: `Persisted ${subject.comps.length} Hermes LandPortal comparable row(s) for ${subject.address}.${retired ? ` Retired ${retired} forked duplicate row(s) for the same parcel.` : ''}`, ref: categoryId });
          return { created, retained: persisted.persistence.retainedEvidenceCount };
        })();
        createdCompCount = applied.created;
        duplicateCompCount = subject.comps.length - applied.created;
        categoryResults.push({ category: 'comps', runId: categoryId, imported: true, persistedAt, retainedEvidenceCount: applied.retained, itemCount: subject.comps.length, rejectedItemCount: 0, error: null });
      } catch (error) {
        categoryResults.push({ category: 'comps', runId: categoryId, imported: false, persistedAt, retainedEvidenceCount: 0, itemCount: subject.comps.length, rejectedItemCount: subject.comps.length, error: (error as Error).message });
      }
    }
  }

  if (completedCategories.includes('visuals')) {
    const artifactRoot = path.dirname(sourceFile);
    const visualIdentity = (subject.visual_artifacts ?? []).map((artifact) => {
      const resolved = path.resolve(artifactRoot, artifact.source_path);
      const relative = path.relative(artifactRoot, resolved);
      const sha256 = relative && !relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()
        ? crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex')
        : null;
      return { ...artifact, sha256 };
    });
    const categoryId = categoryRunId('visuals', { address: subject.address, apn: subject.apn, propertyId: validation.propertyId, artifacts: visualIdentity });
    const prior = priorCategoryResult('visuals', categoryId);
    if (prior) categoryResults.push(prior);
    else {
      const prepared = prepareVisuals(subject, card, sourceFile);
      // Parse-time drops count as rejected visuals too. They are no longer
      // fatal to their siblings, but they must still show up in the count the
      // operator sees rather than vanishing between the two stages.
      const parseRejections = subject.visual_artifact_parse_rejections ?? [];
      rejectedVisualCount = prepared.rejected.length + parseRejections.length;
      const persistedAt = now();
      try {
        const applied = getLandosDb().transaction(() => {
          const evidence = visualEvidence(property, subject, prepared.accepted);
          const persisted = new PropertyResearchStore().persistProviderResult(providerResult({
            runId: categoryId, laneId: 'hermes_landportal_visuals', property, subject,
            evidence, capturedAt: captured.value, persistedAt, checks: validation.checks,
          }));
          if (!persisted.persistence.persisted) throw new Error(persisted.persistence.reason || 'Canonical visual persistence rejected the Hermes import.');
          const retainedInspection = loadPropertyInspection(card.id);
          // Street View outcomes persist as visual observations: structured
          // sightings keep their evidentiary basis, and unavailability is an
          // explicit record rather than a silent skip.
          //
          // ARTIFACT GATE: an observation may only exist where a panorama was
          // actually captured and accepted in this same handback. Without one,
          // the "observation" is a written description of a scene nobody
          // retained — the exact shape the unsupported gated-entrance finding
          // took — so it is refused and the refusal is recorded instead.
          const panoramaRetained = prepared.accepted.some(({ artifact }) =>
            artifact.requested_view === 'street_view' || artifact.kind === 'street_view');
          const claimedObservations = subject.street_view_observations ?? [];
          const streetViewObservations = (panoramaRetained ? claimedObservations : []).map((observation) => ({
            label: observation.label,
            detail: observation.detail,
            confidence: (observation.basis === 'direct_observation' ? 'medium' : 'low') as 'medium' | 'low',
            evidence: `Street View — ${observation.basis.replace(/_/g, ' ')}`,
          }));
          if (!panoramaRetained && claimedObservations.length) {
            streetViewObservations.push({
              label: 'Street View observations not retained',
              detail: `${claimedObservations.length} Street View observation(s) were reported without a retained panorama, so none was kept. A visual finding requires the captured image it was read from.`,
              confidence: 'low',
              evidence: 'Street View artifact gate',
            });
          }
          if (subject.street_view_available === false) {
            streetViewObservations.push({
              label: 'Street View unavailable',
              detail: text(subject.street_view_note) || 'LandPortal Street View was not available for this subject frontage.',
              confidence: 'medium',
              evidence: 'Street View availability check',
            });
          }
          savePropertyInspection(card.id, {
            parcelUrl: subject.subject_url,
            parcelUrlRecord: retainedInspection?.parcelUrlRecord ?? null,
            threeDCapture: retainedInspection?.threeDCapture ?? null,
            comparablesUrl: retainedInspection?.comparablesUrl ?? null,
            comparablesCapturedAt: null,
            parcelFacts: {},
            assets: prepared.accepted.map(({ artifact, sourcePath, validation: visualValidation }) => ({ key: artifact.key, label: artifact.label, kind: artifact.kind, purpose: artifact.purpose, sourcePath, timestamp: artifact.timestamp, overlay: artifact.overlay ?? undefined, note: artifact.note ?? undefined, validation: visualValidation })),
            overlays: [], visualObservations: streetViewObservations, comparables: [],
            sources: [{ provider: 'LandPortal', stage: 'hermes_visuals_import', status: prepared.accepted.length ? 'used' : 'partial', resultKind: prepared.accepted.length ? 'retrieved' : 'attempted_inconclusive', attemptedAt: captured.value, confidence: 'high', url: subject.subject_url, note: `${prepared.accepted.length} verified visual artifact(s) for ${subject.address} persisted independently; ${prepared.rejected.length} rejected.` }],
            evidence: prepared.accepted.map(({ artifact }) => ({ label: artifact.label, status: 'verified', detail: artifact.purpose, confidence: 'high', source: 'Hermes validated LandPortal incremental import', url: subject.subject_url })),
          });
          attachCardActivity({ cardId: card.id, agentId: 'hermes-landportal-import', kind: 'hermes_landportal_visuals_import', summary: `Persisted ${prepared.accepted.length} verified Hermes LandPortal visual artifact(s) for ${subject.address}; rejected ${prepared.rejected.length}.`, ref: categoryId });
          return persisted.persistence.retainedEvidenceCount;
        })();
        importedVisualCount = prepared.accepted.length;
        categoryResults.push({ category: 'visuals', runId: categoryId, imported: true, persistedAt, retainedEvidenceCount: applied, itemCount: prepared.accepted.length, rejectedItemCount: prepared.rejected.length, error: null });
      } catch (error) {
        categoryResults.push({ category: 'visuals', runId: categoryId, imported: false, persistedAt, retainedEvidenceCount: 0, itemCount: prepared.accepted.length, rejectedItemCount: prepared.rejected.length + prepared.accepted.length, error: (error as Error).message });
      }
    }
  }

  const persistedCategories = categoryResults.filter((result) => !result.error).map((result) => result.category);
  return {
    imported: categoryResults.some((result) => result.imported),
    runId,
    sourceFile,
    sourceUrl: subject.subject_url,
    capturedAt: captured.value,
    captureTimestampSource: captured.source,
    propertyCardId: card.id,
    dealCardId: card.deal_card_id,
    validationChecks: validation.checks,
    importedSubjectFields: normalizedSubject.importedFields,
    importedCompCount: completedCategories.includes('comps') ? subject.comps.length : 0,
    createdCompCount,
    duplicateCompCount,
    rejectedFields: normalizedSubject.rejectedFields,
    canonicalEvidenceRetained: categoryResults.reduce((sum, result) => sum + result.retainedEvidenceCount, 0),
    completedCategories,
    persistedCategories,
    importedVisualCount,
    rejectedVisualCount,
    categoryResults,
  };
}
