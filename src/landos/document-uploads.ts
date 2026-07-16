// Manual local document uploads for a Deal Card — contracts, surveys, plats,
// title commitments, seller disclosures, perc tests, septic permits, wetland
// delineations, elevation certificates, utility letters, zoning letters,
// closing documents.
//
// Files land in store/documents/card_<dealCardId>/ (gitignored store dir) and
// register in landos_document_upload so the shared Document Registry lists
// them with category/type/source/date/review state. Local artifacts only —
// nothing is sent anywhere.

import fs from 'node:fs';
import path from 'node:path';
import { getLandosDb } from './db.js';
import type { RegisteredDocument, UploadedDocumentRow } from './document-registry.js';

export const UPLOAD_CATEGORIES: Array<{ value: RegisteredDocument['category']; label: string }> = [
  { value: 'contract', label: 'Contract / purchase agreement' },
  { value: 'survey', label: 'Survey' },
  { value: 'plat', label: 'Plat' },
  { value: 'title', label: 'Title commitment / title document' },
  { value: 'disclosure', label: 'Seller disclosure' },
  { value: 'permit', label: 'Permit / approval (septic, building)' },
  { value: 'other', label: 'Other (perc test, delineation, elevation certificate, utility/zoning letter, closing doc)' },
];

const ALLOWED_EXT = /\.(pdf|png|jpg|jpeg|webp|tif|tiff|txt|md|doc|docx|xls|xlsx)$/i;
const MAX_BYTES = 40 * 1024 * 1024;

function ensureTable(): void {
  getLandosDb().exec(`
    CREATE TABLE IF NOT EXISTS landos_document_upload (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_card_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      document_date TEXT,
      note TEXT,
      superseded INTEGER NOT NULL DEFAULT 0,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_document_upload_card ON landos_document_upload(deal_card_id);
  `);
}

function uploadDir(dealCardId: number): string {
  return path.join(process.cwd(), 'store', 'documents', `card_${dealCardId}`);
}

function safeBaseName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\- ]+/g, '_').trim();
  return base || 'upload';
}

export interface SaveUploadInput {
  dealCardId: number;
  category: RegisteredDocument['category'];
  title: string;
  docType?: string;
  fileName: string;
  mimeType?: string;
  bytes: Buffer;
  documentDate?: string | null;
  note?: string | null;
}

export function saveDocumentUpload(input: SaveUploadInput): UploadedDocumentRow {
  ensureTable();
  if (!Number.isInteger(input.dealCardId) || input.dealCardId < 1) throw new Error('A valid Deal Card is required.');
  const base = safeBaseName(input.fileName);
  if (!ALLOWED_EXT.test(base)) throw new Error('Unsupported file type. Allowed: pdf, images, txt/md, doc(x), xls(x).');
  if (!input.bytes.length) throw new Error('The uploaded file is empty.');
  if (input.bytes.length > MAX_BYTES) throw new Error('File exceeds the 40 MB upload limit.');
  const dir = uploadDir(input.dealCardId);
  fs.mkdirSync(dir, { recursive: true });
  // Collision-safe: prefix with a timestamp so re-uploads never overwrite.
  const stored = `${Date.now()}_${base}`;
  fs.writeFileSync(path.join(dir, stored), input.bytes);
  const res = getLandosDb().prepare(`
    INSERT INTO landos_document_upload (deal_card_id, category, title, doc_type, file_name, mime_type, byte_size, document_date, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.dealCardId, input.category, input.title.trim() || base, (input.docType ?? '').trim() || 'Operator upload',
    stored, input.mimeType ?? 'application/octet-stream', input.bytes.length, input.documentDate ?? null, input.note ?? null,
  );
  return listDocumentUploads(input.dealCardId).find((r) => r.id === Number(res.lastInsertRowid))!;
}

export function listDocumentUploads(dealCardId: number): UploadedDocumentRow[] {
  ensureTable();
  const rows = getLandosDb().prepare('SELECT * FROM landos_document_upload WHERE deal_card_id = ? AND superseded = 0 ORDER BY uploaded_at DESC').all(dealCardId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    category: String(r.category) as UploadedDocumentRow['category'],
    title: String(r.title),
    docType: String(r.doc_type),
    fileName: String(r.file_name),
    mimeType: String(r.mime_type),
    documentDate: r.document_date == null ? null : String(r.document_date),
    uploadedAt: String(r.uploaded_at),
    note: r.note == null ? null : String(r.note),
  }));
}

/** Resolve a servable uploaded file path — card-scoped, traversal-safe. */
export function servableUploadPath(dealCardId: number, fileName: string): string | null {
  if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) return null;
  ensureTable();
  const row = getLandosDb().prepare('SELECT file_name, mime_type FROM landos_document_upload WHERE deal_card_id = ? AND file_name = ?').get(dealCardId, fileName) as { file_name: string } | undefined;
  if (!row) return null;
  const abs = path.join(uploadDir(dealCardId), row.file_name);
  return fs.existsSync(abs) ? abs : null;
}
