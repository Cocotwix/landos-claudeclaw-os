import { describe, expect, it } from 'vitest';
import { buildDocumentRegistry, deedPageFilesForCard, findingPageNumbers, isServableDocumentPage, type DocumentEvidenceRow } from './document-registry.js';

const FILES = [
  'deed_14_1997O31519_p1.png', 'deed_14_1997O31519_p3.png', 'deed_14_1997O31519_p2.png',
  'deed_14_1997O31519_p4.png', 'deed_14_1997O31519_p5.png', 'deed_14_1997O31519_p6.png',
  'deed_14_1997O31519_p7.png',
  'deed_9_OTHERDOC_p1.png',
  'landportal_1_comparables_map_abc.png',
];

function row(fact: string, note: string, sourceUrl = 'https://county.publicsearch.us/doc/295344936'): DocumentEvidenceRow {
  return { fact, note, sourceUrl, sourceType: 'official_county', dateAccessed: '2026-07-13' };
}

const ROWS: DocumentEvidenceRow[] = [
  row('Vesting deed', 'DEED TO TRUSTEES, Doc 1997O31519, Book O/967, Page 1165, recorded 8/20/1997 (7 pages)'),
  row('Deed grantor/grantee', 'Grantor to trustees of a family trust; successors named.'),
  row('Legal description (deed)', 'Subject parcel = Attachment A Parcel II: Lot 4 of Mulberry Hill Plantation, St. Helena Island'),
  row('Prior deed reference', 'Same property conveyed in Deed Book 18, Page 330 (title-chain root not yet read)'),
  row('Recorded easements (deed scan)', 'No express easement, right-of-way, utility, reservation, restriction, or covenant language found in this deed.'),
  row('Trustee succession (deed)', 'Original trustees succeeded by two named successor trustees.'),
];

describe('document registry — deed pages', () => {
  it('groups and orders card-scoped page files, ignoring other cards and non-deed files', () => {
    const byDoc = deedPageFilesForCard(14, FILES);
    expect([...byDoc.keys()]).toEqual(['1997O31519']);
    expect(byDoc.get('1997O31519')!.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('parses exact single-page and page-range citations', () => {
    expect(findingPageNumbers('Cited page: 4.')).toEqual([4]);
    expect(findingPageNumbers('Cited pages: 1-7.')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(findingPageNumbers('Recorded in Book O/967, Page 1165. Cited pages: 1-7.')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(findingPageNumbers('Prior deed Page 330. Cited page: 4.')).toEqual([4]);
  });


  it('builds one registered document with pages, findings, source link, and legal limitation', () => {
    const reg = buildDocumentRegistry({ cardId: 14, evidenceRows: ROWS, visualFileNames: FILES, acreageConflict: true });
    expect(reg.documents).toHaveLength(1);
    const doc = reg.documents[0];
    expect(doc.category).toBe('deed');
    expect(doc.pageCount).toBe(7);
    expect(doc.officialUrl).toContain('publicsearch');
    expect(doc.findings.length).toBeGreaterThanOrEqual(4);
    expect(doc.reviewState).toBe('reviewed');
    expect(doc.legalLimitation).toMatch(/not a title search/i);
  });

  it('registers a referenced deed with zero pages when evidence exists but no images', () => {
    const reg = buildDocumentRegistry({ cardId: 14, evidenceRows: ROWS, visualFileNames: [] });
    expect(reg.documents).toHaveLength(1);
    expect(reg.documents[0].pageCount).toBe(0);
    expect(reg.documents[0].reviewState).toBe('pending_review');
  });
});

describe('document registry — research tasks (generic, evidence-derived)', () => {
  it('derives prior-deed, plat, trustee, easement, and tax tasks from evidence', () => {
    const reg = buildDocumentRegistry({ cardId: 14, evidenceRows: ROWS, visualFileNames: FILES, acreageConflict: true });
    const titles = reg.researchTasks.map((t) => t.title).join(' | ');
    expect(titles).toMatch(/prior deed \(Deed Book 18, Page 330\)/i);
    expect(titles).toMatch(/recorded plat/i);
    expect(titles).toMatch(/trustee\/successor instruments/i);
    expect(titles).toMatch(/easements\/encumbrances/i);
    expect(titles).toMatch(/tax record/i);
  });

  it('assigns research to LandOS, and only payment/decision items to Tyler', () => {
    const reg = buildDocumentRegistry({ cardId: 14, evidenceRows: ROWS, visualFileNames: FILES, acreageConflict: true });
    const tylerTasks = reg.researchTasks.filter((t) => t.owner === 'tyler');
    expect(tylerTasks).toHaveLength(1);
    expect(tylerTasks[0].title).toMatch(/survey/i);
    expect(reg.researchTasks.filter((t) => t.owner === 'landos').every((t) => t.state === 'open')).toBe(true);
  });

  it('omits plat task when no lot reference and no acreage conflict', () => {
    const noLot = ROWS.filter((r) => !/legal description/i.test(r.fact));
    const reg = buildDocumentRegistry({ cardId: 14, evidenceRows: noLot, visualFileNames: FILES, acreageConflict: false });
    expect(reg.researchTasks.map((t) => t.title).join(' ')).not.toMatch(/plat/i);
  });

  it('does not claim a deed was read when the card has no recorded documents', () => {
    const reg = buildDocumentRegistry({ cardId: 31, evidenceRows: [], visualFileNames: [] });
    const task = reg.researchTasks.find((row) => /easements\/encumbrances/i.test(row.title));
    expect(reg.summaryLine).toMatch(/no recorded documents retrieved/i);
    expect(task?.why).toMatch(/no deed .* has been retrieved/i);
    expect(task?.why).not.toMatch(/one deed has been read/i);
  });
});

describe('document registry - operator uploads', () => {
  it('retains the card-scoped upload basename and MIME type for owner-facing open and preview controls', () => {
    const reg = buildDocumentRegistry({
      cardId: 14,
      evidenceRows: [],
      visualFileNames: [],
      uploads: [{
        id: 7,
        category: 'other',
        title: 'property-context.png',
        docType: 'smart_intake_original',
        fileName: '123_property-context.png',
        mimeType: 'image/png',
        documentDate: null,
        uploadedAt: '2026-07-22 20:23:03',
        note: 'Original smart-intake submission retained on the Deal Card.',
      }],
    });
    expect(reg.documents[0]).toMatchObject({
      uploaded: true,
      uploadedFileName: '123_property-context.png',
      mimeType: 'image/png',
    });
  });
});

describe('document page serving guard', () => {
  it('only serves card-scoped deed page files', () => {
    expect(isServableDocumentPage(14, 'deed_14_1997O31519_p1.png')).toBe(true);
    expect(isServableDocumentPage(14, 'deed_9_OTHERDOC_p1.png')).toBe(false);
    expect(isServableDocumentPage(14, '../.env')).toBe(false);
    expect(isServableDocumentPage(14, 'deed_14_x_p1.png/../../secret')).toBe(false);
    expect(isServableDocumentPage(14, 'landportal_1_comparables_map_abc.png')).toBe(false);
  });
});
