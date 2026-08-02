// Narrow Hermes -> LandOS LandPortal import.
//
// Hermes remains a provider handback, not a second property store. This module
// validates one JSON file against an existing subject Property Card, persists
// the normalized evidence through PropertyResearchStore, and projects the
// accepted result through the existing Property Card, inspection, and comp
// registries used by the normal Deal Card read.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { listComps, upsertNormalizedComp, type CompRow } from './comps.js';
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

type Dict = Record<string, unknown>;

export interface HermesLandPortalComp {
  price: number;
  acres: number;
  apn?: string | null;
  address?: string | null;
  price_per_acre?: number | null;
  sale_date?: string | null;
  source_url?: string | null;
}

export type HermesLandPortalResultCategory = 'subject' | 'comps' | 'visuals';

export interface HermesLandPortalVisualArtifact {
  key: string;
  label: string;
  kind: 'parcel_page' | 'parcel_3d' | 'parcel_boundary' | 'overlay' | 'comparables_map';
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
  captured_at?: string | null;
  retrieved_at?: string | null;
  canonical_property_identifier?: string | number | null;
  property_id?: string | number | null;
  landportal_property_id?: string | number | null;
  completed_categories?: HermesLandPortalResultCategory[];
  visual_artifacts?: HermesLandPortalVisualArtifact[];
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
const HERMES_VISUAL_KINDS = new Set<HermesLandPortalVisualArtifact['kind']>(['parcel_page', 'parcel_3d', 'parcel_boundary', 'overlay', 'comparables_map']);
const HERMES_VISUAL_VIEWS = new Set<LandPortalVisualView>(['parcel_context', 'road_frontage', 'wetlands', 'fema_flood', 'soil', 'contours', 'front_3d', 'rear_3d', 'comparables_map']);
const HERMES_CAMERA_SCALES = new Set<HermesLandPortalVisualArtifact['camera_scale']>(['parcel', 'context', 'county', 'national', 'unknown']);

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
  const parsed = finite(value);
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
  if (!Array.isArray(raw.comps)) throw new Error('Hermes JSON field "comps" must be an array.');
  const comps = raw.comps.map((entry, index): HermesLandPortalComp => {
    const comp = asDict(entry, `Hermes comp ${index + 1}`);
    const apn = text(comp.apn) || null;
    const address = text(comp.address) || null;
    if (!apn && !address) throw new Error(`Hermes comp ${index + 1} requires APN or address identity.`);
    return {
      price: requiredPositiveNumber(comp.price, `comps[${index}].price`),
      acres: requiredPositiveNumber(comp.acres, `comps[${index}].acres`),
      apn,
      address,
      price_per_acre: finite(comp.price_per_acre),
      sale_date: text(comp.sale_date) || null,
      source_url: text(comp.source_url) || null,
    };
  });
  const completedCategories = raw.completed_categories == null
    ? undefined
    : (() => {
        if (!Array.isArray(raw.completed_categories)) throw new Error('Hermes JSON field "completed_categories" must be an array.');
        const parsed = raw.completed_categories.map((entry, index) => enumText(entry, `completed_categories[${index}]`, HERMES_RESULT_CATEGORIES));
        if (!parsed.includes('subject')) throw new Error('Hermes exact-subject snapshots must complete "subject" before later result categories.');
        return [...new Set(parsed)];
      })();
  const visualArtifacts = raw.visual_artifacts == null
    ? undefined
    : (() => {
        if (!Array.isArray(raw.visual_artifacts)) throw new Error('Hermes JSON field "visual_artifacts" must be an array.');
        return raw.visual_artifacts.map((entry, index): HermesLandPortalVisualArtifact => {
          const artifact = asDict(entry, `Hermes visual artifact ${index + 1}`);
          if (!Array.isArray(artifact.obstructions) || artifact.obstructions.some((item) => typeof item !== 'string')) {
            throw new Error(`Hermes JSON field "visual_artifacts[${index}].obstructions" must be a string array.`);
          }
          return {
            key: requiredText(artifact.key, `visual_artifacts[${index}].key`),
            label: requiredText(artifact.label, `visual_artifacts[${index}].label`),
            kind: enumText(artifact.kind, `visual_artifacts[${index}].kind`, HERMES_VISUAL_KINDS),
            purpose: requiredText(artifact.purpose, `visual_artifacts[${index}].purpose`),
            source_path: requiredText(artifact.source_path, `visual_artifacts[${index}].source_path`),
            timestamp: requiredText(artifact.timestamp, `visual_artifacts[${index}].timestamp`),
            requested_view: enumText(artifact.requested_view, `visual_artifacts[${index}].requested_view`, HERMES_VISUAL_VIEWS),
            active_view: enumText(artifact.active_view, `visual_artifacts[${index}].active_view`, HERMES_VISUAL_VIEWS),
            boundary_required: requiredBoolean(artifact.boundary_required, `visual_artifacts[${index}].boundary_required`),
            boundary_visible: requiredBoolean(artifact.boundary_visible, `visual_artifacts[${index}].boundary_visible`),
            tiles_loaded: requiredBoolean(artifact.tiles_loaded, `visual_artifacts[${index}].tiles_loaded`),
            camera_scale: enumText(artifact.camera_scale, `visual_artifacts[${index}].camera_scale`, HERMES_CAMERA_SCALES),
            clipped: requiredBoolean(artifact.clipped, `visual_artifacts[${index}].clipped`),
            obstructions: artifact.obstructions.map((item) => item.trim()).filter(Boolean),
            overlay: text(artifact.overlay) || null,
            note: text(artifact.note) || null,
          };
        });
      })();
  return {
    ...(raw as unknown as HermesLandPortalSubject),
    subject_url: requiredText(raw.subject_url, 'subject_url'),
    subject_verification_status: requiredText(raw.subject_verification_status, 'subject_verification_status'),
    address: requiredText(raw.address, 'address'),
    apn: requiredText(raw.apn, 'apn'),
    completed_categories: completedCategories,
    visual_artifacts: visualArtifacts,
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

function explicitPropertyIds(subject: HermesLandPortalSubject): string[] {
  return [subject.canonical_property_identifier, subject.property_id, subject.landportal_property_id]
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
  const propertyId = urlIdentity?.propertyId ?? '';
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
        && retainedIds.every((id) => id === propertyId),
      reason: !!propertyId && suppliedIds.every((id) => id === propertyId) && retainedIds.every((id) => id === propertyId)
        ? `LandPortal property identifier ${propertyId} agrees everywhere it is available.`
        : `LandPortal property identifier mismatch (URL=${propertyId || 'missing'}, JSON=${suppliedIds.join(',') || 'not supplied'}, retained=${retainedIds.join(',') || 'not supplied'}).`,
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
  return { evidence, importedFields: evidence.map((item) => item.field), rejectedFields };
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

function duplicateRegistryComp(comp: HermesLandPortalComp, rows: CompRow[]): CompRow | null {
  return rows.find((row) => {
    const hasSharedIdentity = (!!compactApn(comp.apn) && compactApn(comp.apn) === compactApn(row.apn))
      || (!!compact(comp.address) && compact(comp.address) === compact(row.address_desc));
    if (!hasSharedIdentity) return false;
    return sameOptionalText(comp.apn, row.apn, compactApn)
      && sameOptionalText(comp.address, row.address_desc, compact)
      && sameOptionalNumber(comp.price, row.price, 0.01)
      && sameOptionalNumber(comp.acres, row.acres, 0.0001)
      && sameOptionalText(comp.sale_date, row.sale_or_list_date, (value) => text(value).slice(0, 10));
  }) ?? null;
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

function inspectionFacts(subject: HermesLandPortalSubject, retained: Record<string, string>): Record<string, string> {
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
  };
  return Object.fromEntries(Object.entries(candidates).filter(([label, value]) => !present(retained[label]) && present(value))) as Record<string, string>;
}

function projectedComparable(comp: HermesLandPortalComp, duplicate: CompRow | null, subjectUrl: string, capturedAt: string): LandPortalComparableRecord {
  const isSale = duplicate?.status === 'verified_sale' || duplicate?.price_kind === 'sale';
  const address = text(comp.address) || text(duplicate?.address_desc) || null;
  const saleDate = text(comp.sale_date) || text(duplicate?.sale_or_list_date) || '';
  return {
    rawText: [address || comp.apn || 'LandPortal comp', money(comp.price), `${comp.acres} ac`].join(' | '),
    sourceUrl: comp.source_url || subjectUrl,
    surface: 'sidebar',
    apn: text(comp.apn) || text(duplicate?.apn) || null,
    address,
    saleDate: saleDate || undefined,
    acres: comp.acres,
    price: comp.price,
    pricePerAcre: finite(comp.price_per_acre) ?? duplicate?.price_per_acre ?? null,
    status: isSale ? 'sold' : 'unknown',
    saleListIndicator: isSale ? 'sale' : 'unknown',
    improvement: /vacant/i.test(`${duplicate?.property_class ?? ''} ${duplicate?.classification ?? ''}`) ? 'vacant' : 'unknown',
    confidence: 'high',
    statusSource: isSale ? 'detail_surface' : null,
    capturedAtIso: capturedAt,
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
          const duplicates = subject.comps.map((comp) => duplicateRegistryComp(comp, existingComps));
          const persisted = new PropertyResearchStore().persistProviderResult(providerResult({
            runId: categoryId, laneId: 'hermes_landportal_comps', property, subject,
            evidence: normalizedComps, capturedAt: captured.value, persistedAt, checks: validation.checks,
          }));
          if (!persisted.persistence.persisted) throw new Error(persisted.persistence.reason || 'Canonical comp persistence rejected the Hermes import.');
          const retainedInspection = loadPropertyInspection(card.id);
          savePropertyInspection(card.id, {
            parcelUrl: subject.subject_url,
            parcelUrlRecord: retainedInspection?.parcelUrlRecord ?? null,
            threeDCapture: retainedInspection?.threeDCapture ?? null,
            comparablesUrl: retainedInspection?.comparablesUrl ?? subject.subject_url,
            comparablesCapturedAt: captured.value,
            parcelFacts: {}, assets: [], overlays: [], visualObservations: [],
            comparables: subject.comps.map((comp, index) => projectedComparable(comp, duplicates[index], subject.subject_url, captured.value)),
            sources: [{ provider: 'LandPortal', stage: 'hermes_comps_import', status: 'used', resultKind: 'retrieved', attemptedAt: captured.value, confidence: 'high', url: subject.subject_url, note: `${subject.comps.length} comparable row(s) for ${subject.address} persisted independently after exact-subject validation.` }],
            evidence: [{ label: 'Hermes LandPortal comparable import', status: 'observed', detail: `${subject.comps.length} LandPortal comparable row(s) retained as context-only evidence for ${subject.address}.`, confidence: 'high', source: 'Hermes validated LandPortal incremental import', url: subject.subject_url }],
          });
          let created = 0;
          for (const [index, comp] of subject.comps.entries()) {
            if (duplicates[index]) continue;
            upsertNormalizedComp({
              entity: card.entity as LandosEntity, dealCardId: card.deal_card_id, cardId: card.id,
              sourceLabel: 'LandPortal', canonicalSource: 'Hermes / LandPortal', sourceUrl: comp.source_url || subject.subject_url,
              addressDesc: text(comp.address), apn: text(comp.apn), county: text(subject.county) || card.county, state: card.state,
              price: comp.price, priceKind: 'unknown', saleOrListDate: text(comp.sale_date), acres: comp.acres,
              pricePerAcre: finite(comp.price_per_acre) ?? undefined,
              notes: 'Hermes-imported LandPortal comparable; context-only unless transaction status/date is independently retained.',
              addedBy: 'hermes-landportal-import', status: 'manual_unverified', propertyClass: 'land', classification: 'landportal_context',
              retrievedAt: captured.value, inclusionReason: `LandPortal comparable retained for exact subject ${subject.address}.`,
              sourceAttributions: [{ provider: 'Hermes / LandPortal', url: comp.source_url || subject.subject_url }],
              canonicalKey: hermesLandPortalCompKey(comp),
            });
            created += 1;
          }
          attachCardActivity({ cardId: card.id, agentId: 'hermes-landportal-import', kind: 'hermes_landportal_comps_import', summary: `Persisted ${subject.comps.length} Hermes LandPortal comparable row(s) for ${subject.address}.`, ref: categoryId });
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
      rejectedVisualCount = prepared.rejected.length;
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
          savePropertyInspection(card.id, {
            parcelUrl: subject.subject_url,
            parcelUrlRecord: retainedInspection?.parcelUrlRecord ?? null,
            threeDCapture: retainedInspection?.threeDCapture ?? null,
            comparablesUrl: retainedInspection?.comparablesUrl ?? null,
            comparablesCapturedAt: null,
            parcelFacts: {},
            assets: prepared.accepted.map(({ artifact, sourcePath, validation: visualValidation }) => ({ key: artifact.key, label: artifact.label, kind: artifact.kind, purpose: artifact.purpose, sourcePath, timestamp: artifact.timestamp, overlay: artifact.overlay ?? undefined, note: artifact.note ?? undefined, validation: visualValidation })),
            overlays: [], visualObservations: [], comparables: [],
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
