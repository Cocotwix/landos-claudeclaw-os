// LandOS — every operator-supplied file is intake evidence, whatever it is.
//
// THE DEFECT THIS REPAIRS.
//
// Smart Intake had exactly one artifact path: PNG/JPEG/WEBP. An image became an
// immutable `landos_intake_artifact` row, went through vision extraction, and
// reached the model. Anything else — a PDF survey, a plat, a DOCX purchase
// agreement, a spreadsheet of comps, a voice memo — fell into a second, weaker
// branch that saved a document upload and wrote a sentence of prose about it.
// It was never filed as an artifact, so it had no interpretation status, no
// provenance row, and nothing downstream could see that it existed as evidence.
// The operator handed LandOS the strongest thing they had and it landed in a
// place no reader looks.
//
// So the artifact record comes first and is universal, and interpretation is a
// property OF the artifact rather than the price of admission. Every file is
// accepted, hashed, persisted, and filed. Then LandOS asks a separate question:
// can I read this one? Images and PDFs go to the existing multimodal model.
// Text-shaped files are read directly, no model call. Everything else is
// retained with `unavailable` and an honest sentence saying so.
//
// What this module deliberately is NOT:
//   • It is not a parser suite. It writes no bespoke reader for DOCX, XLSX, or
//     any other container format. Where the existing model/tool stack reads a
//     format, it is used; where it does not, that is reported, not faked.
//   • It is not an executor. An artifact is bytes to preserve and, at most,
//     describe. Scripts, executables, and macro-bearing containers are stored
//     and never run — `interpreter: 'none'` is the only outcome available to
//     them, by classification, not by hoping the model declines.
//   • It is not identity. Everything it returns is an unconfirmed intake
//     candidate. `PERMANENT_MEMORY.md` invariants 2-4 are untouched: no
//     extraction here establishes a parcel.

import {
  SMART_INTAKE_IMAGE_MIME_TYPES,
  extractSmartIntakeImage,
  normalizeSmartIntakeImageExtraction,
  unavailableSmartIntakeImageExtraction,
  type SmartIntakeImageExtraction,
  type SmartIntakeImageMimeType,
  type SmartIntakeVisionAnalyzer,
} from './smart-intake-image.js';
import { generateVisionContent, parseJsonResponse } from '../gemini.js';

/** 25 MB. Larger than the image ceiling because documents legitimately are. */
export const SMART_INTAKE_ARTIFACT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * How LandOS can read this artifact, if at all.
 *
 * `vision`   — the multimodal model reads the bytes directly (image, PDF).
 * `media`    — audio/video, sent to the same multimodal model. Wired, and it
 *              degrades to `unavailable` with the real error when the model
 *              cannot take the format, which is the honest outcome either way.
 * `text`     — decodable as UTF-8 text; read verbatim with no model call.
 * `none`     — retained only. LandOS has no reader for it yet, and says so.
 */
export type IntakeArtifactInterpreter = 'vision' | 'media' | 'text' | 'none';

export interface IntakeArtifactClassification {
  /** The MIME type LandOS will record, inferred from the browser type or the
   *  extension. Never empty — an unknown type is `application/octet-stream`. */
  mimeType: string;
  interpreter: IntakeArtifactInterpreter;
  /** Plain-English label of what the artifact appears to be. */
  kind: string;
  /** What LandOS will and will not do with it, in the operator's language. */
  note: string;
}

const EXTENSION_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  heic: 'image/heic', svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values',
  json: 'application/json', xml: 'text/xml', html: 'text/html', htm: 'text/html',
  srt: 'text/plain', vtt: 'text/vtt', log: 'text/plain', rtf: 'application/rtf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  dwg: 'image/vnd.dwg', dxf: 'image/vnd.dxf',
  kml: 'application/vnd.google-earth.kml+xml', kmz: 'application/vnd.google-earth.kmz',
  zip: 'application/zip',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg',
  aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus', amr: 'audio/amr',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', avi: 'video/x-msvideo',
  mkv: 'video/x-matroska', m4v: 'video/mp4',
};

/** Formats that are, or can carry, executable content. Retained, never read. */
const ACTIVE_CONTENT = /\.(?:exe|dll|com|bat|cmd|ps1|sh|bash|zsh|scr|msi|app|jar|apk|vbs|js|mjs|cjs|py|rb|pl|php|docm|xlsm|pptm|dotm|xltm)$/i;

export function intakeArtifactExtension(fileName: string): string {
  return fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
}

/** The MIME types the multimodal model is given bytes for directly. */
const VISION_MIME = /^(?:image\/(?:png|jpeg|webp|heic|gif)|application\/pdf)$/i;

/**
 * Decide what an operator-supplied file appears to be and how it can be read.
 *
 * Classification is deliberately from the declared type and the filename, never
 * from executing or deeply inspecting the bytes. It runs before anything is
 * opened, and it never rejects: the worst answer available is "retained, not
 * read, here is why".
 */
export function classifyIntakeArtifact(
  fileName: string,
  declaredMime: string,
): IntakeArtifactClassification {
  const ext = intakeArtifactExtension(fileName);
  const declared = (declaredMime || '').toLowerCase().split(';')[0].trim();
  const normalizedDeclared = declared === 'image/jpg' ? 'image/jpeg' : declared;
  const mimeType = normalizedDeclared || EXTENSION_MIME[ext] || 'application/octet-stream';

  if (ACTIVE_CONTENT.test(fileName)) {
    return {
      mimeType, interpreter: 'none', kind: 'Active content',
      note: 'This file can carry executable content, so it is stored as evidence and never opened or run. Tell me what is in it and that becomes part of the deal.',
    };
  }
  if (VISION_MIME.test(mimeType)) {
    const isPdf = mimeType === 'application/pdf';
    return {
      mimeType, interpreter: 'vision',
      kind: isPdf ? 'PDF document' : 'Image / screenshot',
      note: isPdf
        ? 'Read as a document by the multimodal model. Anything it reads is an unconfirmed intake candidate until a source verifies it.'
        : 'Read as an image by the multimodal model. What it transcribes is an unconfirmed intake candidate, and a map outline is never parcel geometry.',
    };
  }
  if (/^audio\//i.test(mimeType) || /^video\//i.test(mimeType)) {
    return {
      mimeType, interpreter: 'media',
      kind: /^audio\//i.test(mimeType) ? 'Audio' : 'Video',
      note: 'Sent to the multimodal model for transcription/description. If the model cannot take this format, the file is still kept and I will say plainly that it was not read.',
    };
  }
  if (/^text\//i.test(mimeType) || mimeType === 'application/json' || mimeType === 'application/rtf') {
    return {
      mimeType, interpreter: 'text',
      kind: ext === 'csv' || ext === 'tsv' ? 'Spreadsheet export (delimited text)' : 'Text document',
      note: 'Read directly as text and retained verbatim. No model call is needed to see its contents.',
    };
  }
  const officeKind = /wordprocessingml|msword/i.test(mimeType) ? 'Word document'
    : /spreadsheetml|ms-excel/i.test(mimeType) ? 'Spreadsheet'
      : /presentationml|powerpoint/i.test(mimeType) ? 'Presentation'
        : /google-earth/i.test(mimeType) ? 'Map / KML data'
          : /vnd\.dwg|vnd\.dxf/i.test(mimeType) ? 'CAD drawing (survey/plat)'
            : '';
  return {
    mimeType, interpreter: 'none',
    kind: officeKind || 'File',
    note: officeKind
      ? `Kept on the deal as ${officeKind.toLowerCase()} evidence. LandOS has no reader for this format yet, so its contents were not interpreted — export it as PDF, CSV, or text and I will read it, or tell me what it says.`
      : 'Kept on the deal as operator-supplied evidence. LandOS has no reader for this format yet, so its contents were not interpreted. Tell me what is in it and that becomes part of the deal.',
  };
}

const DOCUMENT_PROMPT = `Inspect this operator-supplied land-deal document as intake evidence.
Return JSON only. Transcribe the useful property-related text exactly in "exactText", preserving meaningful line breaks.
Return normalized candidate strings under "candidates" for any clearly stated fields:
owner, address, road, city, state, zip, county, apn, acreage, latitude, longitude, sourcePlatform.
Return other clearly labeled parcel, survey, plat, legal, or transaction facts as [{"label":"...","value":"..."}].
List uncertain field names in "uncertainFields", absent useful fields in "missingFields", and short honest caveats in "notes".
Set status to "complete" only when the useful content is readable without material uncertainty; otherwise "partial".
Do not infer or fabricate values. Every returned field is an unconfirmed intake candidate, not an official fact.`;

const MEDIA_PROMPT = `Transcribe and summarize this operator-supplied recording as land-deal intake evidence.
Return JSON only. Put the transcription (or, for video with no speech, an exact description of readable on-screen text) in "exactText".
Return normalized candidate strings under "candidates" for any clearly stated fields:
owner, address, road, city, state, zip, county, apn, acreage, latitude, longitude, sourcePlatform.
Return other clearly stated facts as [{"label":"...","value":"..."}].
List uncertain field names in "uncertainFields" and short honest caveats in "notes".
Do not infer or fabricate values. Everything a seller says is seller-stated, not verified.`;

/** Decode text bytes without inventing content when the file is not UTF-8. */
export function decodeIntakeArtifactText(bytes: Buffer): string | null {
  const text = bytes.toString('utf8');
  // A lone replacement character means the bytes were not the text we assumed.
  if (text.includes('�')) return null;
  return text;
}

/**
 * Read an artifact as far as the existing capability stack allows.
 *
 * Always resolves. A model failure, an unsupported format, or an undecodable
 * file all produce an `unavailable` extraction carrying the real reason, which
 * the operator sees, rather than an exception that loses the upload.
 */
export async function extractIntakeArtifact(
  bytes: Buffer,
  classification: IntakeArtifactClassification,
  options: {
    visionAnalyzer?: SmartIntakeVisionAnalyzer;
    model?: string;
  } = {},
): Promise<SmartIntakeImageExtraction> {
  const model = options.model
    || process.env.SMART_INTAKE_VISION_MODEL
    || process.env.GEMINI_VISION_MODEL
    || 'gemini-3-flash-preview';

  if (classification.interpreter === 'none') {
    return unavailableSmartIntakeImageExtraction(classification.note, 'retained-only');
  }

  if (classification.interpreter === 'text') {
    const text = decodeIntakeArtifactText(bytes);
    if (text === null) {
      return unavailableSmartIntakeImageExtraction(
        'The file is declared as text but its bytes are not readable text, so it is retained without interpretation.',
        'retained-only',
      );
    }
    return normalizeSmartIntakeImageExtraction(
      { exactText: text, status: 'complete', notes: [classification.note] },
      'direct-text-read',
    );
  }

  // Images keep the existing, proven vision path exactly as it was.
  if (classification.interpreter === 'vision'
      && (SMART_INTAKE_IMAGE_MIME_TYPES as readonly string[]).includes(classification.mimeType)) {
    try {
      return await extractSmartIntakeImage(
        bytes,
        classification.mimeType as SmartIntakeImageMimeType,
        options.visionAnalyzer,
        model,
      );
    } catch (error) {
      return unavailableSmartIntakeImageExtraction((error as Error).message, model);
    }
  }

  const prompt = classification.interpreter === 'media' ? MEDIA_PROMPT : DOCUMENT_PROMPT;
  try {
    const analyze = options.visionAnalyzer
      ?? (async (askedPrompt: string, media: { data: string; mimeType: string }, selectedModel: string) => {
        const response = await generateVisionContent(
          askedPrompt,
          [{ data: media.data, mimeType: media.mimeType }],
          selectedModel,
        );
        return parseJsonResponse<Record<string, unknown>>(response) ?? {};
      });
    const raw = await analyze(
      prompt,
      { data: bytes.toString('base64'), mimeType: classification.mimeType as SmartIntakeImageMimeType },
      model,
    );
    return normalizeSmartIntakeImageExtraction(raw, model);
  } catch (error) {
    // The honest outcome: kept, not read, and the actual reason it was not.
    return unavailableSmartIntakeImageExtraction(
      `${classification.kind} was retained but not interpreted: ${(error as Error).message}`,
      model,
    );
  }
}

/**
 * The operator-facing sentence for one artifact once it has been read (or not).
 * The conversation says what LandOS actually got, never that it understood
 * something it did not.
 */
export function describeIntakeArtifact(
  fileName: string,
  classification: IntakeArtifactClassification,
  extraction: SmartIntakeImageExtraction,
): string {
  const candidates = Object.entries(extraction.candidates)
    .map(([key, value]) => `${key}: ${value}`)
    .slice(0, 6);
  if (extraction.status === 'unavailable') {
    return `${fileName} — ${classification.kind}. Kept as intake evidence; contents not interpreted. ${extraction.notes[0] ?? classification.note}`;
  }
  const readLength = extraction.exactText.length;
  const found = candidates.length ? ` Read from it: ${candidates.join(', ')}.` : '';
  return `${fileName} — ${classification.kind}. Interpreted (${extraction.status}), ${readLength.toLocaleString('en-US')} characters of text retained.${found} These are unconfirmed intake candidates until verified.`;
}
