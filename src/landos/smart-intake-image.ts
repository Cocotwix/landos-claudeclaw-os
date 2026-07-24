import { createHash } from 'node:crypto';

import { generateVisionContent, parseJsonResponse } from '../gemini.js';

export const SMART_INTAKE_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type SmartIntakeImageMimeType = (typeof SMART_INTAKE_IMAGE_MIME_TYPES)[number];
export type SmartIntakeImageSourceMethod = 'clipboard' | 'upload' | 'drop';
export type SmartIntakeExtractionStatus = 'complete' | 'partial' | 'unavailable';

export const SMART_INTAKE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export const SMART_INTAKE_CANDIDATE_KEYS = [
  'owner',
  'address',
  'road',
  'city',
  'state',
  'zip',
  'county',
  'apn',
  'acreage',
  'latitude',
  'longitude',
  'sourcePlatform',
] as const;

export type SmartIntakeCandidateKey = (typeof SMART_INTAKE_CANDIDATE_KEYS)[number];

export interface SmartIntakeImageExtraction {
  status: SmartIntakeExtractionStatus;
  exactText: string;
  candidates: Partial<Record<SmartIntakeCandidateKey, string>>;
  otherFacts: Array<{ label: string; value: string }>;
  uncertainFields: string[];
  missingFields: string[];
  notes: string[];
  model: string;
}

export type SmartIntakeVisionAnalyzer = (
  prompt: string,
  image: { data: string; mimeType: SmartIntakeImageMimeType },
  model: string,
) => Promise<unknown>;

function compact(value: unknown, max = 2_000): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function exact(value: unknown, max = 100_000): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => compact(item, 500)).filter(Boolean))];
}

export function normalizeSmartIntakeImageExtraction(
  value: unknown,
  model = 'unknown',
): SmartIntakeImageExtraction {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawCandidates = source.candidates && typeof source.candidates === 'object'
    ? source.candidates as Record<string, unknown>
    : source;
  const candidates: Partial<Record<SmartIntakeCandidateKey, string>> = {};
  for (const key of SMART_INTAKE_CANDIDATE_KEYS) {
    const normalized = compact(rawCandidates[key], 1_000);
    if (normalized) candidates[key] = normalized;
  }
  const otherFacts = Array.isArray(source.otherFacts)
    ? source.otherFacts.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      const label = compact(row.label, 200);
      const factValue = compact(row.value, 1_000);
      return label && factValue ? [{ label, value: factValue }] : [];
    })
    : [];
  const uncertainFields = stringList(source.uncertainFields);
  const missingFields = stringList(source.missingFields);
  const exactText = exact(source.exactText);
  const requestedStatus = compact(source.status).toLowerCase();
  const status: SmartIntakeExtractionStatus = requestedStatus === 'complete' && uncertainFields.length === 0
    ? 'complete'
    : exactText || Object.keys(candidates).length > 0 || otherFacts.length > 0
      ? 'partial'
      : 'unavailable';
  return {
    status,
    exactText,
    candidates,
    otherFacts,
    uncertainFields,
    missingFields,
    notes: stringList(source.notes),
    model,
  };
}

export function unavailableSmartIntakeImageExtraction(
  note: string,
  model = 'unknown',
): SmartIntakeImageExtraction {
  return {
    status: 'unavailable',
    exactText: '',
    candidates: {},
    otherFacts: [],
    uncertainFields: [],
    missingFields: [...SMART_INTAKE_CANDIDATE_KEYS],
    notes: [compact(note, 500) || 'Image extraction was unavailable.'],
    model,
  };
}

function hasPngSignature(bytes: Buffer): boolean {
  return bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}

function hasJpegSignature(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function hasWebpSignature(bytes: Buffer): boolean {
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}

export function validateSmartIntakeImage(
  bytes: Buffer,
  mimeType: string,
  fileName = '',
): SmartIntakeImageMimeType {
  if (!bytes.length) throw new Error('The image is empty.');
  if (bytes.length > SMART_INTAKE_IMAGE_MAX_BYTES) {
    throw new Error('Image is larger than the 10 MB Smart Intake limit.');
  }
  const normalizedMime = mimeType.toLowerCase() === 'image/jpg' ? 'image/jpeg' : mimeType.toLowerCase();
  if (!SMART_INTAKE_IMAGE_MIME_TYPES.includes(normalizedMime as SmartIntakeImageMimeType)) {
    throw new Error('Unsupported image type. Smart Intake accepts PNG, JPG/JPEG, and WEBP.');
  }
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const extensionMatches = normalizedMime === 'image/png' ? extension === '' || extension === 'png'
    : normalizedMime === 'image/jpeg' ? extension === '' || extension === 'jpg' || extension === 'jpeg'
      : extension === '' || extension === 'webp';
  if (!extensionMatches) throw new Error('The image filename does not match its declared file type.');
  const signatureMatches = normalizedMime === 'image/png' ? hasPngSignature(bytes)
    : normalizedMime === 'image/jpeg' ? hasJpegSignature(bytes)
      : hasWebpSignature(bytes);
  if (!signatureMatches) throw new Error('The image contents do not match the declared file type.');
  return normalizedMime as SmartIntakeImageMimeType;
}

export function smartIntakeImageSha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const VISION_PROMPT = `Inspect this operator-supplied property screenshot as intake evidence.
Return JSON only. Transcribe all visible property-related text exactly, preserving meaningful line breaks in "exactText".
Return normalized candidate strings under "candidates" for any clearly visible fields:
owner, address, road, city, state, zip, county, apn, acreage, latitude, longitude, sourcePlatform.
Return other clearly labeled parcel facts as [{"label":"...","value":"..."}].
List uncertain field names in "uncertainFields", absent useful fields in "missingFields", and short honest caveats in "notes".
Set status to "complete" only when the useful visible text is readable without material uncertainty; otherwise "partial".
Do not infer or fabricate values. A map outline is visual evidence only, never confirmed parcel geometry.
Every returned field is an unconfirmed intake candidate, not an official fact.`;

export async function extractSmartIntakeImage(
  bytes: Buffer,
  mimeType: SmartIntakeImageMimeType,
  analyzer?: SmartIntakeVisionAnalyzer,
  model = process.env.SMART_INTAKE_VISION_MODEL || process.env.GEMINI_VISION_MODEL || 'gemini-3-flash-preview',
): Promise<SmartIntakeImageExtraction> {
  const analyze = analyzer ?? (async (prompt, image, selectedModel) => {
    const response = await generateVisionContent(prompt, [image], selectedModel);
    return parseJsonResponse<Record<string, unknown>>(response) ?? {};
  });
  const raw = await analyze(VISION_PROMPT, { data: bytes.toString('base64'), mimeType }, model);
  return normalizeSmartIntakeImageExtraction(raw, model);
}
