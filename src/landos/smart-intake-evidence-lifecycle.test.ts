// Smart Intake evidence: what it accepts, and when it may be erased.
//
// Two rules meet here and both have to hold at once. Operator-supplied evidence
// on a LIVE deal is immutable — nothing may quietly rewrite or drop what the
// operator handed over. But an explicit permanent delete of a TRASHED deal has
// to be able to erase that deal's whole evidence graph, or a temporary deal can
// never actually be removed. The original triggers enforced only the first, by
// aborting every DELETE unconditionally, which made permanent deletion
// structurally impossible for any deal Smart Intake had ever touched.

import { deflateRawSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard, getDealCardRow, hardDeleteDealCard, softDeleteDealCard } from './deal-card.js';
import { listIntakeLinks, recordIntakeLinks } from './intake-links.js';
import { classifyIntakeArtifact, extractIntakeArtifact } from './smart-intake-artifact.js';
import { prepareDealEvidence } from './deal-evidence-ingest.js';
import { readOoxmlText } from './ooxml-text.js';

beforeEach(() => { _initTestLandosDb(); });

const mkDeal = (title: string) => createDealCard({ entity: 'TY_LAND_BIZ', title }).id;

/** Build a real (minimal) ZIP archive so the reader is exercised against the
 *  actual container format rather than a stub. */
function zip(entries: Array<{ name: string; content: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.content, 'utf8');
    const deflated = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, deflated);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + deflated.length;
  }
  const localBytes = Buffer.concat(locals);
  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(localBytes.length, 16);
  return Buffer.concat([localBytes, centralBytes, eocd]);
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const docx = () => zip([{
  name: 'word/document.xml',
  content: '<w:document><w:body><w:p><w:r><w:t>Purchase agreement for APN 00083-A-03400</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>Acreage stated as 1.5 &amp; access via county road</w:t></w:r></w:p></w:body></w:document>',
}]);

const xlsx = () => zip([
  { name: 'xl/sharedStrings.xml', content: '<sst><si><t>Comp address</t></si><si><t>Sale price</t></si></sst>' },
  { name: 'xl/worksheets/sheet1.xml', content: '<worksheet><row><c><v>112 Fairview Rd</v></c><c><v>48500</v></c></row></worksheet>' },
]);

describe('Office documents are read, not merely shelved', () => {
  it('recovers text from a DOCX container', () => {
    const read = readOoxmlText(docx());
    expect(read?.text).toContain('APN 00083-A-03400');
    // The XML entity is decoded, not left as source.
    expect(read?.text).toContain('1.5 & access');
    expect(read?.parts).toContain('word/document.xml');
  });

  it('recovers labels AND cells from an XLSX container', () => {
    const read = readOoxmlText(xlsx());
    expect(read?.text).toContain('Comp address');
    expect(read?.text).toContain('112 Fairview Rd');
    // Cells on one row stay on one row rather than collapsing together.
    expect(read?.text).toMatch(/112 Fairview Rd\t48500/);
  });

  it('classifies DOCX/XLSX to the container reader, and macro variants to none', () => {
    expect(classifyIntakeArtifact('agreement.docx', DOCX_MIME).interpreter).toBe('ooxml');
    expect(classifyIntakeArtifact('comps.xlsx', XLSX_MIME).interpreter).toBe('ooxml');
    // Macro-bearing containers are active content: retained, never opened.
    expect(classifyIntakeArtifact('comps.xlsm', XLSX_MIME).interpreter).toBe('none');
  });

  it('extracts a DOCX through the artifact path with no model call', async () => {
    const classification = classifyIntakeArtifact('agreement.docx', DOCX_MIME);
    const extraction = await extractIntakeArtifact(docx(), classification);
    expect(extraction.status).toBe('complete');
    expect(extraction.exactText).toContain('Purchase agreement');
  });

  it('keeps an unreadable container as evidence instead of failing the upload', async () => {
    const classification = classifyIntakeArtifact('corrupt.docx', DOCX_MIME);
    const extraction = await extractIntakeArtifact(Buffer.from('not a zip at all'), classification);
    expect(extraction.status).toBe('unavailable');
    expect(extraction.notes.join(' ')).toMatch(/kept exactly as supplied/i);
  });
});

describe('Deal-scoped ingestion is callable without the New Lead screen', () => {
  it('prepares mixed evidence for any deal, reading what it can and retaining the rest', async () => {
    const prepared = await prepareDealEvidence([
      { fileName: 'agreement.docx', mimeType: DOCX_MIME, bytes: docx() },
      { fileName: 'notes.txt', mimeType: 'text/plain', bytes: Buffer.from('Seller wants 60k') },
      { fileName: 'survey.dwg', mimeType: '', bytes: Buffer.from('CAD bytes') },
    ]);
    expect(prepared.map((item) => item.routing.extractionStatus))
      .toEqual(['complete', 'complete', 'unavailable']);
    // The one LandOS could not read still arrives as evidence, and says so.
    expect(prepared[2].routing.summary).toMatch(/not interpreted/i);
    expect(prepared[2].routing.kind).toBe('CAD drawing (survey/plat)');
  });

  it('rejects only what the operator must fix, never an unreadable format', async () => {
    await expect(prepareDealEvidence([{ fileName: 'empty.pdf', mimeType: 'application/pdf', bytes: Buffer.alloc(0) }]))
      .rejects.toThrow(/empty/i);
  });
});

describe('Smart Intake evidence immutability and permanent deletion', () => {
  const seedEvidence = (dealCardId: number, url: string) => {
    const db = getLandosDb();
    recordIntakeLinks({ dealCardId, urls: [url], source: 'test' });
    db.prepare(`INSERT INTO landos_intake_submission (deal_card_id, submission_type, source, original_text)
      VALUES (?, 'general', 'test', 'operator text')`).run(dealCardId);
    const submissionId = (db.prepare('SELECT id FROM landos_intake_submission WHERE deal_card_id = ? ORDER BY id DESC')
      .get(dealCardId) as { id: number }).id;
    db.prepare(`INSERT INTO landos_intake_artifact
      (submission_id, deal_card_id, original_file_name, mime_type, byte_size, sha256, source_method)
      VALUES (?, ?, 'survey.pdf', 'application/pdf', 10, ?, 'upload')`)
      .run(submissionId, dealCardId, `sha-${dealCardId}`);
    db.prepare(`INSERT INTO landos_intake_fact (submission_id, deal_card_id, section, fact_key, value)
      VALUES (?, ?, 'Property Facts', 'acreage', '1.5')`).run(submissionId, dealCardId);
  };

  it('refuses to erase evidence while the deal is LIVE', () => {
    const id = mkDeal('Live deal');
    seedEvidence(id, 'https://landportal.com/map/live');
    const db = getLandosDb();
    expect(() => db.prepare('DELETE FROM landos_intake_link WHERE deal_card_id = ?').run(id))
      .toThrow(/immutable/i);
    expect(() => db.prepare('DELETE FROM landos_intake_artifact WHERE deal_card_id = ?').run(id))
      .toThrow(/immutable/i);
    expect(listIntakeLinks(id).length).toBe(1);
  });

  it('permanently deletes a trashed deal together with its whole Smart Intake evidence graph', () => {
    const doomed = mkDeal('Temporary acceptance deal');
    const keep = mkDeal('Unrelated deal');
    seedEvidence(doomed, 'https://landportal.com/map/doomed');
    seedEvidence(keep, 'https://landportal.com/map/keep');

    // Live deals cannot be purged at all — Trash first.
    expect(hardDeleteDealCard(doomed)).toBe(false);
    softDeleteDealCard(doomed);
    expect(hardDeleteDealCard(doomed)).toBe(true);

    const db = getLandosDb();
    const count = (table: string, dealCardId: number) => Number((db.prepare(
      `SELECT COUNT(*) AS n FROM ${table} WHERE deal_card_id = ?`,
    ).get(dealCardId) as { n: number }).n);
    for (const table of ['landos_intake_link', 'landos_intake_artifact', 'landos_intake_submission', 'landos_intake_fact']) {
      expect(count(table, doomed)).toBe(0);
    }
    expect(getDealCardRow(doomed)).toBeUndefined();

    // A record merely LINKED to the deal through a differently-named column is
    // unlinked rather than deleted, and no dangling reference survives — the
    // exact failure that made the purge abort at commit.
    expect(Number((db.prepare(
      'SELECT COUNT(*) AS n FROM landos_opportunity WHERE legacy_deal_card_id = ?',
    ).get(doomed) as { n: number }).n)).toBe(0);

    // The other deal's evidence is untouched, and still immutable.
    for (const table of ['landos_intake_link', 'landos_intake_artifact', 'landos_intake_submission', 'landos_intake_fact']) {
      expect(count(table, keep)).toBe(1);
    }
    expect(() => db.prepare('DELETE FROM landos_intake_artifact WHERE deal_card_id = ?').run(keep))
      .toThrow(/immutable/i);
  });
});
