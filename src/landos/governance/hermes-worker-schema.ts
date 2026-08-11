import { z } from 'zod';

import { normalizeAddressMatchKey } from '../address-normalize.js';
import {
  landPortalIdentityFromUrl,
  validateLandPortalSubjectUrl,
} from '../landportal-operating-rules.js';
import {
  apnEquivalent,
  normalizeApn,
} from '../property-intelligence-snapshot.js';

export const HERMES_WORKER_CATEGORIES = ['subject', 'comps', 'visuals'] as const;
export type HermesWorkerCategory = typeof HERMES_WORKER_CATEGORIES[number];

const boundedText = (label: string, max = 2_000) => z.string()
  .trim()
  .min(1, `${label} is required.`)
  .max(max, `${label} exceeds ${max} characters.`);
const optionalText = (label: string, max = 2_000) => boundedText(label, max).nullable();
const isoTimestamp = z.string().datetime({ offset: true });
const propertyIdValue = z.union([
  z.string().trim().min(1).max(512),
  z.number().int().positive().safe(),
]);
const nullablePropertyIdValue = propertyIdValue.nullable();
const percentage = z.number().finite().min(0).max(100).nullable();
const nullableNonNegativeNumber = z.number().finite().nonnegative().nullable();
const nullablePositiveNumber = z.number().finite().positive().nullable();

const APN_DISPLAY_PATTERN = /^[A-Za-z0-9]+(?:[ .\/-][A-Za-z0-9]+)*$/;
const SAFE_ARTIFACT_PATH = /^(?![A-Za-z]:)(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[A-Za-z0-9._\-/\\ ]+\.(?:png|jpe?g|webp)$/i;
const SAFE_EVIDENCE_KEY = /^[a-z0-9][a-z0-9._-]{0,127}$/;

function validApnDisplay(value: string): boolean {
  const compact = value.replace(/[^A-Za-z0-9]/g, '');
  return APN_DISPLAY_PATTERN.test(value)
    && /\d/.test(compact)
    && compact.length >= 4
    && compact.length <= 48;
}

const apnDisplay = boundedText('APN', 96).refine(validApnDisplay, {
  message: 'APN has an unsupported or malformed format.',
});

const httpsUrl = boundedText('source URL', 2_048).superRefine((value, context) => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    context.addIssue({ code: 'custom', message: 'source URL is malformed.' });
    return;
  }
  if (parsed.protocol !== 'https:') {
    context.addIssue({ code: 'custom', message: 'source URL must use HTTPS.' });
  }
  if (parsed.username || parsed.password) {
    context.addIssue({ code: 'custom', message: 'source URL must not contain credentials.' });
  }
});

const landPortalSourceUrl = httpsUrl.superRefine((value, context) => {
  let host = '';
  try { host = new URL(value).hostname.toLowerCase(); } catch { return; }
  if (host !== 'landportal.com' && host !== 'www.landportal.com') {
    context.addIssue({ code: 'custom', message: 'LandPortal evidence URL has the wrong host.' });
  }
});

const saleDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'sale_date must be YYYY-MM-DD.').superRefine((value, context) => {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    context.addIssue({ code: 'custom', message: 'sale_date is not a real calendar date.' });
  }
});

const HermesCompSchema = z.strictObject({
  evidence_type: z.literal('comparable').optional(),
  price: z.number().finite().positive('price must be greater than 0.'),
  acres: z.number().finite().positive('acres must be greater than 0.'),
  apn: apnDisplay.nullable().optional(),
  address: optionalText('comp address', 500).optional(),
  price_per_acre: z.number().finite().positive().nullable().optional(),
  sale_date: saleDate.nullable().optional(),
  source_url: landPortalSourceUrl.nullable().optional(),
}).superRefine((comp, context) => {
  if (!comp.apn && !comp.address) {
    context.addIssue({ code: 'custom', message: 'Comparable requires APN or address identity.' });
  }
  if (comp.price_per_acre != null) {
    const derived = comp.price / comp.acres;
    const tolerance = Math.max(1, derived * 0.01);
    if (Math.abs(comp.price_per_acre - derived) > tolerance) {
      context.addIssue({ code: 'custom', path: ['price_per_acre'], message: 'Comparable price_per_acre conflicts with price divided by acres.' });
    }
  }
});

const VISUAL_KINDS = ['parcel_page', 'parcel_3d', 'parcel_boundary', 'overlay', 'comparables_map'] as const;
const VISUAL_VIEWS = ['parcel_context', 'road_frontage', 'wetlands', 'fema_flood', 'soil', 'contours', 'front_3d', 'rear_3d', 'comparables_map'] as const;
const CAMERA_SCALES = ['parcel', 'context', 'county', 'national', 'unknown'] as const;

const expectedVisualKind = (view: typeof VISUAL_VIEWS[number]): typeof VISUAL_KINDS[number] => {
  if (view === 'comparables_map') return 'comparables_map';
  if (view === 'front_3d' || view === 'rear_3d') return 'parcel_3d';
  if (view === 'parcel_context' || view === 'road_frontage') return 'parcel_boundary';
  return 'overlay';
};

const HermesVisualSchema = z.strictObject({
  evidence_type: z.literal('visual_artifact').optional(),
  key: z.string().regex(SAFE_EVIDENCE_KEY, 'visual key must be a safe bounded identifier.'),
  label: boundedText('visual label', 300),
  kind: z.enum(VISUAL_KINDS),
  purpose: boundedText('visual purpose', 1_000),
  source_path: z.string().trim().max(512).regex(SAFE_ARTIFACT_PATH, 'visual source_path must be a safe relative image path.'),
  timestamp: isoTimestamp,
  requested_view: z.enum(VISUAL_VIEWS),
  active_view: z.enum(VISUAL_VIEWS),
  boundary_required: z.boolean(),
  boundary_visible: z.boolean(),
  tiles_loaded: z.boolean(),
  camera_scale: z.enum(CAMERA_SCALES),
  clipped: z.boolean(),
  obstructions: z.array(boundedText('visual obstruction', 500)).max(20),
  overlay: optionalText('visual overlay', 300).optional(),
  note: optionalText('visual note', 2_000).optional(),
}).superRefine((visual, context) => {
  if (visual.active_view !== visual.requested_view) {
    context.addIssue({ code: 'custom', path: ['active_view'], message: 'visual active_view must match requested_view.' });
  }
  const requiredKind = expectedVisualKind(visual.requested_view);
  if (visual.kind !== requiredKind) {
    context.addIssue({ code: 'custom', path: ['kind'], message: `visual kind must be ${requiredKind} for ${visual.requested_view}.` });
  }
  if (visual.boundary_required && !visual.boundary_visible) {
    context.addIssue({ code: 'custom', path: ['boundary_visible'], message: 'required parcel boundary is not visible.' });
  }
  if (!visual.tiles_loaded) {
    context.addIssue({ code: 'custom', path: ['tiles_loaded'], message: 'visual tiles must be loaded.' });
  }
  if (visual.clipped) {
    context.addIssue({ code: 'custom', path: ['clipped'], message: 'clipped visual evidence is not admissible.' });
  }
  if (visual.camera_scale === 'unknown') {
    context.addIssue({ code: 'custom', path: ['camera_scale'], message: 'visual camera scale must be known.' });
  }
});

const category = z.enum(HERMES_WORKER_CATEGORIES);
const baseRoutingShape = {
  evidence_type: z.literal('property_subject').optional(),
  subject_verification_note: boundedText('subject verification note', 4_000),
  address: boundedText('subject address', 500),
  apn: apnDisplay,
  property_card_id: z.number().int().positive().safe(),
  canonical_property_identifier: propertyIdValue,
  specialist_category: category,
  completed_categories: z.array(category).max(3),
  captured_at: isoTimestamp,
  comps: z.array(HermesCompSchema).max(500),
  visual_artifacts: z.array(HermesVisualSchema).max(100),
} as const;

const VerifiedHermesWorkerOutputSchema = z.strictObject({
  ...baseRoutingShape,
  subject_verification_status: z.literal('verified_exact_subject'),
  subject_url: boundedText('subject URL', 2_048),
  county: optionalText('county', 300),
  municipality: optionalText('municipality', 300),
  owner: optionalText('owner', 500),
  mailing_address: optionalText('mailing address', 500),
  deeded_acres: nullablePositiveNumber,
  mls_acres: nullablePositiveNumber,
  calculated_acres: nullablePositiveNumber,
  road_frontage_ft: nullableNonNegativeNumber,
  landlocked_status: optionalText('landlocked status', 200),
  wetlands_pct: percentage,
  fema_pct: percentage,
  average_slope_pct: percentage,
  pct_under_10pct_slope: percentage,
  pct_under_10pct_slope_note: optionalText('slope note', 2_000),
  buildability_pct: percentage,
  lp_estimate_total: nullableNonNegativeNumber,
  lp_estimate_per_acre: nullableNonNegativeNumber,
  property_id: nullablePropertyIdValue,
  landportal_property_id: nullablePropertyIdValue,
  retrieved_at: isoTimestamp.nullable().optional(),
});

const NonImportableHermesWorkerOutputSchema = z.strictObject({
  ...baseRoutingShape,
  subject_verification_status: z.enum(['context_only', 'no_match', 'failed']),
});

export const HermesWorkerOutputSchema = z.union([
  VerifiedHermesWorkerOutputSchema,
  NonImportableHermesWorkerOutputSchema,
]);

export type HermesWorkerOutput = z.infer<typeof HermesWorkerOutputSchema>;
export type VerifiedHermesWorkerOutput = z.infer<typeof VerifiedHermesWorkerOutputSchema>;

export interface HermesExpectedIdentity {
  address: string;
  apn: string;
  propertyId: string | number;
  propertyCardId: number;
  subjectUrl?: string | null;
}

export interface HermesCanonicalIdentity {
  address: string;
  normalizedAddress: string;
  apn: string;
  normalizedApn: string;
  propertyId: string;
  propertyCardId: number;
  subjectUrl: string | null;
  fips: string | null;
}

export interface ValidatedHermesWorkerOutput<T extends HermesWorkerOutput = HermesWorkerOutput> {
  output: T;
  canonicalIdentity: HermesCanonicalIdentity;
}

export class HermesWorkerBoundaryError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Hermes worker output rejected at LandOS boundary: ${issues.join(' ')}`);
    this.name = 'HermesWorkerBoundaryError';
    this.issues = issues;
  }
}

interface ParsedPropertyIdentifier {
  propertyId: string;
  fips: string | null;
  apn: string | null;
}

function parsePropertyIdentifier(value: string | number | null | undefined): ParsedPropertyIdentifier | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0
      ? { propertyId: String(value), fips: null, apn: null }
      : null;
  }
  const raw = String(value ?? '').trim();
  if (/^[1-9]\d{3,19}$/.test(raw)) return { propertyId: raw, fips: null, apn: null };
  if (!raw.includes('=')) return null;
  const params = new URLSearchParams(raw);
  const allowedKeys = new Set(['propertyid', 'fips', 'apn']);
  const keys = [...params.keys()].map((key) => key.toLowerCase());
  if (keys.some((key) => !allowedKeys.has(key)) || new Set(keys).size !== keys.length) return null;
  const propertyId = params.get('propertyid')?.trim() ?? '';
  const fips = params.get('fips')?.trim() ?? '';
  const apn = params.get('apn')?.trim() ?? '';
  if (!/^[1-9]\d{3,19}$/.test(propertyId) || !/^\d{5}$/.test(fips) || !validApnDisplay(apn)) return null;
  return { propertyId, fips, apn };
}

function compIdentityKey(comp: z.infer<typeof HermesCompSchema>): string {
  const apn = comp.apn ? normalizeApn(comp.apn) : '';
  const address = comp.address ? normalizeAddressMatchKey(comp.address) : '';
  return [apn, address, comp.price, comp.acres, comp.sale_date ?? ''].join('|');
}

function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : 'payload';
    return `${path}: ${issue.message}`;
  });
}

function parseWorkerSchema(value: unknown) {
  const status = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).subject_verification_status
    : undefined;
  if (status === 'verified_exact_subject') return VerifiedHermesWorkerOutputSchema.safeParse(value);
  if (status === 'context_only' || status === 'no_match' || status === 'failed') {
    return NonImportableHermesWorkerOutputSchema.safeParse(value);
  }
  return HermesWorkerOutputSchema.safeParse(value);
}

function validateCategoryPayload(output: HermesWorkerOutput, issues: string[]): void {
  if (output.subject_verification_status !== 'verified_exact_subject') {
    if (output.completed_categories.length !== 0) issues.push('Non-importable output must not claim completed categories.');
    if (output.comps.length !== 0) issues.push('Non-importable output must not contain comparables.');
    if (output.visual_artifacts.length !== 0) issues.push('Non-importable output must not contain visual evidence.');
    return;
  }
  if (output.completed_categories.length !== 1 || output.completed_categories[0] !== output.specialist_category) {
    issues.push(`Specialist ${output.specialist_category} must complete only its assigned category.`);
  }
  if (output.specialist_category !== 'comps' && output.comps.length !== 0) {
    issues.push(`Specialist ${output.specialist_category} must return comps as an empty array.`);
  }
  if (output.specialist_category !== 'visuals' && output.visual_artifacts.length !== 0) {
    issues.push(`Specialist ${output.specialist_category} must return visual_artifacts as an empty array.`);
  }
  if (output.specialist_category === 'visuals' && output.visual_artifacts.length === 0) {
    issues.push('Visual specialist must return at least one verified visual artifact.');
  }
  const compKeys = output.comps.map(compIdentityKey);
  if (new Set(compKeys).size !== compKeys.length) issues.push('Duplicate comparable records are not admissible.');
  const visualKeys = output.visual_artifacts.map((visual) => visual.key);
  if (new Set(visualKeys).size !== visualKeys.length) issues.push('Duplicate visual artifact keys are not admissible.');
  const visualPaths = output.visual_artifacts.map((visual) => visual.source_path.toLowerCase().replace(/\\/g, '/'));
  if (new Set(visualPaths).size !== visualPaths.length) issues.push('Duplicate visual artifact paths are not admissible.');
}

function reconcileVerifiedIdentity(
  output: VerifiedHermesWorkerOutput,
  expected: HermesExpectedIdentity,
  issues: string[],
): HermesCanonicalIdentity {
  const expectedAddress = normalizeAddressMatchKey(expected.address);
  const outputAddress = normalizeAddressMatchKey(output.address);
  if (!expectedAddress || outputAddress !== expectedAddress) {
    issues.push(`Property address mismatch: expected "${expected.address}" but received "${output.address}".`);
  }
  if (!validApnDisplay(expected.apn)) issues.push('Expected canonical APN is malformed.');
  if (!apnEquivalent(expected.apn, output.apn)) {
    issues.push(`APN mismatch: expected "${expected.apn}" but received "${output.apn}".`);
  }
  if (output.property_card_id !== expected.propertyCardId) {
    issues.push(`Property Card identity mismatch: expected ${expected.propertyCardId} but received ${output.property_card_id}.`);
  }

  const expectedProperty = parsePropertyIdentifier(expected.propertyId);
  if (!expectedProperty) issues.push('Expected canonical LandPortal property identifier is malformed.');
  const urlValidation = validateLandPortalSubjectUrl(output.subject_url);
  if (!urlValidation.valid || !urlValidation.identity) {
    issues.push(`Subject URL is malformed or not an exact LandPortal parcel URL (${urlValidation.reason}).`);
  }
  const urlIdentity = landPortalIdentityFromUrl(output.subject_url);
  const supplied = [
    ['canonical_property_identifier', output.canonical_property_identifier],
    ['property_id', output.property_id],
    ['landportal_property_id', output.landportal_property_id],
  ] as const;
  const parsedSupplied: Array<[string, ParsedPropertyIdentifier]> = [];
  for (const [label, raw] of supplied) {
    if (raw == null) continue;
    const parsed = parsePropertyIdentifier(raw);
    if (!parsed) issues.push(`${label} is malformed.`);
    else parsedSupplied.push([label, parsed]);
  }
  if (parsedSupplied.length === 0) issues.push('At least one explicit LandPortal property identifier is required.');

  const targetPropertyId = expectedProperty?.propertyId ?? '';
  if (urlIdentity?.propertyId !== targetPropertyId) {
    issues.push(`Subject URL property identifier mismatch: expected ${targetPropertyId || 'valid canonical id'} but received ${urlIdentity?.propertyId ?? 'missing'}.`);
  }
  if (!urlIdentity?.apn || !apnEquivalent(output.apn, urlIdentity.apn)) {
    issues.push('Subject URL APN does not match the worker APN.');
  }
  for (const [label, parsed] of parsedSupplied) {
    if (parsed.propertyId !== targetPropertyId) issues.push(`${label} does not match canonical property identifier ${targetPropertyId}.`);
    if (parsed.apn && !apnEquivalent(parsed.apn, output.apn)) issues.push(`${label} APN does not match the worker APN.`);
    if (parsed.fips && urlIdentity?.fips && parsed.fips !== urlIdentity.fips) issues.push(`${label} FIPS does not match the subject URL.`);
  }
  if (expected.subjectUrl) {
    const expectedUrl = landPortalIdentityFromUrl(expected.subjectUrl);
    if (!expectedUrl
      || expectedUrl.propertyId !== urlIdentity?.propertyId
      || expectedUrl.fips !== urlIdentity?.fips
      || !apnEquivalent(expectedUrl.apn, urlIdentity?.apn)) {
      issues.push('Subject URL identifies a different canonical property than the expected subject URL.');
    }
  }

  return {
    address: expected.address.trim(),
    normalizedAddress: expectedAddress,
    apn: expected.apn.trim(),
    normalizedApn: normalizeApn(expected.apn),
    propertyId: targetPropertyId,
    propertyCardId: expected.propertyCardId,
    subjectUrl: urlValidation.valid ? urlValidation.canonicalUrl : null,
    fips: urlIdentity?.fips ?? null,
  };
}

function reconcileNonImportableIdentity(
  output: Exclude<HermesWorkerOutput, VerifiedHermesWorkerOutput>,
  expected: HermesExpectedIdentity,
  issues: string[],
): HermesCanonicalIdentity {
  const expectedAddress = normalizeAddressMatchKey(expected.address);
  if (normalizeAddressMatchKey(output.address) !== expectedAddress) issues.push('Non-importable output address does not match its assignment.');
  if (!apnEquivalent(output.apn, expected.apn)) issues.push('Non-importable output APN does not match its assignment.');
  if (output.property_card_id !== expected.propertyCardId) issues.push('Non-importable output Property Card does not match its assignment.');
  const expectedProperty = parsePropertyIdentifier(expected.propertyId);
  const outputProperty = parsePropertyIdentifier(output.canonical_property_identifier);
  if (!expectedProperty || !outputProperty || expectedProperty.propertyId !== outputProperty.propertyId) {
    issues.push('Non-importable output property identifier does not match its assignment.');
  }
  return {
    address: expected.address.trim(),
    normalizedAddress: expectedAddress,
    apn: expected.apn.trim(),
    normalizedApn: normalizeApn(expected.apn),
    propertyId: expectedProperty?.propertyId ?? '',
    propertyCardId: expected.propertyCardId,
    subjectUrl: null,
    fips: expectedProperty?.fips ?? null,
  };
}

/**
 * Parse untrusted model JSON and reconcile every identity field to the
 * assignment held by LandOS. No model-side JSON mode can replace this check.
 */
export function validateHermesWorkerOutput(
  value: unknown,
  expected: HermesExpectedIdentity,
): ValidatedHermesWorkerOutput {
  const parsed = parseWorkerSchema(value);
  if (!parsed.success) throw new HermesWorkerBoundaryError(formatZodIssues(parsed.error));
  const issues: string[] = [];
  validateCategoryPayload(parsed.data, issues);
  const canonicalIdentity = parsed.data.subject_verification_status === 'verified_exact_subject'
    ? reconcileVerifiedIdentity(parsed.data, expected, issues)
    : reconcileNonImportableIdentity(parsed.data, expected, issues);
  if (issues.length) throw new HermesWorkerBoundaryError(issues);
  return { output: parsed.data, canonicalIdentity };
}

/** JSON Schema for Hermes-side constrained generation; LandOS validation above remains authoritative. */
export const HERMES_WORKER_OUTPUT_JSON_SCHEMA = z.toJSONSchema(HermesWorkerOutputSchema, {
  target: 'draft-2020-12',
  unrepresentable: 'throw',
});
