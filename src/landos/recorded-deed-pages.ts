// County-recorder deed-page intake.
//
// A recorder image is only useful when it stays card-scoped and carries the
// official record URL that the operator actually viewed. This module accepts a
// single image page from the normal owner workflow, writes it to the document
// registry's immutable naming convention, and returns the metadata required to
// create the matching source-evidence row. It never fetches a recorder site,
// creates an account, or fabricates a document.

import fs from 'node:fs';
import path from 'node:path';
import { landosArtifactPath } from './storage-profile.js';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export interface RecordDeedPageInput {
  cardId: number;
  documentId: string;
  pageNumber: number;
  fileName: string;
  mimeType?: string;
  bytes: Buffer;
}

export interface RecordedDeedPage {
  fileName: string;
  storedPath: string;
  pageNumber: number;
  documentId: string;
}

function safeDocumentId(value: string): string {
  return value.trim().replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function imageExtension(fileName: string, mimeType?: string): string {
  const byName = path.extname(path.basename(fileName)).toLowerCase();
  if (IMAGE_EXTENSIONS.has(byName)) return byName;
  const byMime: Record<string, string> = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
  };
  return byMime[(mimeType ?? '').toLowerCase()] ?? '';
}

/** Persist exactly one operator-viewed county-recorder image page. */
export function recordDeedPage(input: RecordDeedPageInput): RecordedDeedPage {
  if (!Number.isInteger(input.cardId) || input.cardId < 1) throw new Error('A valid property card is required.');
  const documentId = safeDocumentId(input.documentId);
  if (!documentId) throw new Error('Recorded document or book/page reference is required.');
  if (!Number.isInteger(input.pageNumber) || input.pageNumber < 1 || input.pageNumber > 999) throw new Error('Page number must be between 1 and 999.');
  const ext = imageExtension(input.fileName, input.mimeType);
  if (!ext) throw new Error('The recorder page must be a PNG, JPEG, or WebP image.');
  if (!input.bytes.length) throw new Error('The recorder page image is empty.');
  if (input.bytes.length > MAX_IMAGE_BYTES) throw new Error('The recorder page image exceeds the 20 MB limit.');

  const fileName = `deed_${input.cardId}_${documentId}_p${input.pageNumber}${ext}`;
  const storedPath = landosArtifactPath('visuals', fileName);
  fs.mkdirSync(path.dirname(storedPath), { recursive: true });
  // A second capture of the same document page replaces only that exact page;
  // it cannot overwrite a different card or document identifier.
  fs.writeFileSync(storedPath, input.bytes, { mode: 0o600 });
  return { fileName, storedPath, pageNumber: input.pageNumber, documentId };
}

