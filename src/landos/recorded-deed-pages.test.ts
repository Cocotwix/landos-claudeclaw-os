import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { recordDeedPage } from './recorded-deed-pages.js';

const roots: string[] = [];
const originalStorageMode = process.env.LANDOS_STORAGE_MODE;
const originalQaRoot = process.env.LANDOS_QA_ROOT;

afterEach(() => {
  if (originalStorageMode === undefined) delete process.env.LANDOS_STORAGE_MODE;
  else process.env.LANDOS_STORAGE_MODE = originalStorageMode;
  if (originalQaRoot === undefined) delete process.env.LANDOS_QA_ROOT;
  else process.env.LANDOS_QA_ROOT = originalQaRoot;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('recorded recorder deed page intake', () => {
  it('stores a card-scoped recorder image using the document registry convention', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-deed-page-'));
    roots.push(root);
    process.env.LANDOS_STORAGE_MODE = 'qa';
    process.env.LANDOS_QA_ROOT = root;
    const page = recordDeedPage({
      cardId: 25, documentId: 'Book 795 Page 429', pageNumber: 1,
      fileName: 'county-page.PNG', mimeType: 'image/png', bytes: Buffer.from([137, 80, 78, 71]),
    });
    expect(page.fileName).toBe('deed_25_Book-795-Page-429_p1.png');
    expect(fs.existsSync(page.storedPath)).toBe(true);
  });

  it('rejects non-image recorder uploads', () => {
    expect(() => recordDeedPage({ cardId: 25, documentId: '795-429', pageNumber: 1, fileName: 'deed.pdf', bytes: Buffer.from('pdf') }))
      .toThrow(/PNG, JPEG, or WebP/i);
  });
});
