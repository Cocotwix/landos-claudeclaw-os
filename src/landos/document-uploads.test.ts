import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb } from './db.js';
import {
  listDocumentUploads,
  removeDocumentUpload,
  saveDocumentUpload,
  servableUploadPath,
  updateDocumentUpload,
} from './document-uploads.js';

let createdPath: string | null = null;

beforeEach(() => {
  _initTestLandosDb();
  createdPath = null;
});

afterEach(() => {
  if (createdPath && fs.existsSync(createdPath)) fs.unlinkSync(createdPath);
});

describe('operator document uploads', () => {
  it('supports card-scoped metadata edits and recoverable removal', () => {
    const upload = saveDocumentUpload({
      dealCardId: 91001,
      category: 'survey',
      title: 'Original survey',
      fileName: 'operator-upload-test.txt',
      mimeType: 'text/plain',
      bytes: Buffer.from('test artifact'),
    });
    createdPath = servableUploadPath(91001, upload.fileName);
    expect(createdPath).toBeTruthy();
    expect(updateDocumentUpload(91001, upload.id, {
      title: 'Boundary survey',
      category: 'plat',
      note: 'Renamed by operator',
    })).toMatchObject({
      id: upload.id,
      title: 'Boundary survey',
      category: 'plat',
      note: 'Renamed by operator',
    });
    expect(updateDocumentUpload(91002, upload.id, { title: 'Wrong card' })).toBeNull();
    expect(removeDocumentUpload(91001, upload.id)?.id).toBe(upload.id);
    expect(listDocumentUploads(91001)).toHaveLength(0);
    expect(createdPath && fs.existsSync(createdPath)).toBe(true);
  });
});
