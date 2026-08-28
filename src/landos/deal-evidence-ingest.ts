// LandOS — taking in new evidence on a Deal. Any deal, any time, any caller.
//
// THE ARCHITECTURE THIS FIXES.
//
// Everything that turns an operator-supplied file into deal evidence — classify
// it, decide whether LandOS can read it, read it, store the bytes immutably,
// file the artifact row, hand the candidates to resolution — lived inline in
// the New Lead upload route. It was already keyed by deal id, so the HTTP path
// was deal-scoped; the LOGIC was not callable at all. Anything that wanted to
// add evidence to an existing deal had to go back through the intake screen.
//
// That is the wrong shape, because intake is not the last time evidence arrives.
// A county PDF lands during due diligence. A revised plat arrives before
// closing. A recorded call arrives from the seller. The operator will want to
// hand those to an existing Deal Card and ask what changed, and that must not
// mean reopening or simulating New Lead.
//
// So the ingestion is a function on a deal, and the intake route is one caller
// of it. The rule is: Deal-scoped capability first; a UI is an interface to it.
//
// What this module deliberately is NOT:
//   • It is not a new agent or workflow. It ingests and reports. Deciding what
//     to DO about the evidence stays with the Smart Intake supervisor, which is
//     likewise already deal-scoped and reads what this writes.
//   • It is not a parser suite. `smart-intake-artifact` owns "can I read this",
//     and every format decision lives there, unchanged.
//   • It is not identity. Everything it returns is an unconfirmed intake
//     candidate. `PERMANENT_MEMORY.md` invariants 2-4 are untouched: no upload
//     establishes a parcel.

import path from 'node:path';
import {
  SMART_INTAKE_ARTIFACT_MAX_BYTES,
  classifyIntakeArtifact,
  describeIntakeArtifact,
  extractIntakeArtifact,
  type IntakeArtifactClassification,
} from './smart-intake-artifact.js';
import {
  smartIntakeImageSha256,
  unavailableSmartIntakeImageExtraction,
  validateSmartIntakeImage,
  type SmartIntakeImageExtraction,
  type SmartIntakeImageSourceMethod,
} from './smart-intake-image.js';

/** One file handed to a deal, already read into memory. */
export interface DealEvidenceFile {
  fileName: string;
  /** The browser's declared type, or '' when unknown. */
  mimeType: string;
  bytes: Buffer;
  /** How it arrived. Defaults to 'upload'. */
  sourceMethod?: SmartIntakeImageSourceMethod;
}

/** What LandOS decided one file was, and whether it could read it. */
export interface DealEvidenceRouting {
  fileName: string;
  kind: string;
  mimeType: string;
  interpreter: IntakeArtifactClassification['interpreter'];
  extractionStatus: SmartIntakeImageExtraction['status'];
  /** The operator-facing sentence about this file. */
  summary: string;
}

export interface PreparedDealEvidence {
  fileName: string;
  bytes: Buffer;
  /** Lowercased extension including the dot, or ''. */
  extension: string;
  classification: IntakeArtifactClassification;
  sourceMethod: SmartIntakeImageSourceMethod;
  extraction: SmartIntakeImageExtraction;
  routing: DealEvidenceRouting;
}

/**
 * Thrown for input the operator must fix (an empty file, one over the ceiling,
 * bytes that contradict a declared image type). Distinguished from an
 * interpretation failure, which is never an error: a file LandOS cannot read is
 * still filed, with an honest note saying it was not read.
 */
export class DealEvidenceRejected extends Error {}

/** Files whose extension marks them as a caption/transcript sidecar. */
const TRANSCRIPT_EXTENSIONS = ['.srt', '.vtt'];

/**
 * Classify and read a batch of files for one deal.
 *
 * Every file is accepted and prepared; interpretation is a property of the
 * artifact, never the price of admission. `readEvidence` is injectable so route
 * tests can prepare artifacts without paying for model calls.
 */
export async function prepareDealEvidence(
  files: DealEvidenceFile[],
  options: {
    readEvidence?: (bytes: Buffer, classification: IntakeArtifactClassification) => Promise<SmartIntakeImageExtraction>;
  } = {},
): Promise<PreparedDealEvidence[]> {
  const read = options.readEvidence ?? extractIntakeArtifact;

  const classified = files.map((file) => {
    if (file.bytes.length === 0) throw new DealEvidenceRejected(`${file.fileName} is empty.`);
    if (file.bytes.length > SMART_INTAKE_ARTIFACT_MAX_BYTES) {
      throw new DealEvidenceRejected(`${file.fileName} is larger than the 25 MB Smart Intake limit.`);
    }
    return {
      fileName: file.fileName,
      bytes: file.bytes,
      extension: path.extname(file.fileName).toLowerCase(),
      classification: classifyIntakeArtifact(file.fileName, file.mimeType || ''),
      sourceMethod: file.sourceMethod ?? 'upload',
    };
  });

  // Images keep the signature check they always had: bytes that contradict a
  // declared image type are a real problem worth reporting, not evidence worth
  // filing. Every other format is filed whatever its bytes turn out to be.
  for (const item of classified) {
    if (/^image\//i.test(item.classification.mimeType) && item.classification.interpreter === 'vision') {
      validateSmartIntakeImage(item.bytes, item.classification.mimeType, item.fileName);
    }
  }

  const extractions = await Promise.all(classified.map(async (item) => {
    try {
      return await read(item.bytes, item.classification);
    } catch (error) {
      // A reader that throws must not lose the upload it was reading.
      return unavailableSmartIntakeImageExtraction((error as Error).message, 'retained-only');
    }
  }));

  return classified.map((item, index) => ({
    ...item,
    extraction: extractions[index],
    routing: {
      fileName: item.fileName,
      kind: item.classification.kind,
      mimeType: item.classification.mimeType,
      interpreter: item.classification.interpreter,
      extractionStatus: extractions[index].status,
      summary: describeIntakeArtifact(item.fileName, item.classification, extractions[index]),
    },
  }));
}

/** True when this batch should be retained as a transcript rather than a
 *  general submission. */
export function isTranscriptEvidence(
  prepared: PreparedDealEvidence[],
  declaredSubmissionType: string,
): boolean {
  if (declaredSubmissionType === 'transcript') return true;
  return prepared.length > 0 && TRANSCRIPT_EXTENSIONS.includes(prepared[0].extension);
}

/**
 * The text retained on the submission alongside the operator's own note.
 *
 * Interpreted artifacts already contribute their transcribed text through the
 * artifact rows, so repeating it here would duplicate it. Only the files LandOS
 * could NOT read need a sentence, because otherwise nothing in the text a
 * reader sees would say the file arrived and was not understood.
 */
export function dealEvidenceSubmissionText(
  prepared: PreparedDealEvidence[],
  operatorNote: string,
): string {
  const unread = prepared
    .filter((item) => item.extraction.status === 'unavailable')
    .map((item) => item.routing.summary);
  return [operatorNote, ...unread].filter(Boolean).join('\n\n');
}

/** The artifact records to persist, in the shape the intake store expects. */
export function dealEvidenceArtifacts(
  dealCardId: number,
  prepared: PreparedDealEvidence[],
  saveOriginal: (item: PreparedDealEvidence, docType: string) => { id: number; fileName: string },
  transcript: boolean,
): Array<{
  documentUploadId: number;
  originalFileName: string;
  fileUrl: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  sourceMethod: SmartIntakeImageSourceMethod;
  extraction: SmartIntakeImageExtraction;
}> {
  return prepared.map((item) => {
    const docType = /^image\//i.test(item.classification.mimeType)
      ? 'smart_intake_image_original'
      : transcript ? 'transcript' : 'smart_intake_original';
    const uploaded = saveOriginal(item, docType);
    return {
      documentUploadId: uploaded.id,
      originalFileName: item.fileName,
      fileUrl: `/api/landos/deal-cards/${dealCardId}/documents/upload-file/${encodeURIComponent(uploaded.fileName)}`,
      mimeType: item.classification.mimeType,
      byteSize: item.bytes.length,
      sha256: smartIntakeImageSha256(item.bytes),
      sourceMethod: item.sourceMethod,
      extraction: item.extraction,
    };
  });
}
