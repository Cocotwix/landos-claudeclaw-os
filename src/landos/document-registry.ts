// Document Asset Registry — ONE registry of recorded/official documents per card.
//
// Deed and recorded-document research must surface the ACTUAL county-sourced
// page images with findings linked to evidence, never internal file paths or
// synthetic previews. This module builds the registry from (a) persisted card
// source-evidence rows and (b) county-sourced page images on disk
// (store/visuals/deed_<cardId>_<docNo>_p<N>.png), and derives the open
// document-research tasks generically from what the evidence says is missing.
//
// Pure + deterministic: the caller injects the evidence rows and the file list.

export interface DocumentEvidenceRow {
  fact: string;
  sourceUrl: string;
  sourceType: string;
  dateAccessed: string;
  note: string;
}

export interface DocumentPageRef {
  pageNumber: number;
  /** Repo-relative artifact filename (served by the document-page route). */
  file: string;
}

export interface RegisteredDocument {
  id: string;
  category: 'deed' | 'plat' | 'survey' | 'tax_record' | 'title' | 'contract' | 'disclosure' | 'permit' | 'other';
  title: string;
  /** e.g. "DEED TO TRUSTEES", "Recorded plat" */
  docType: string;
  source: string;
  officialUrl: string | null;
  pages: DocumentPageRef[];
  pageCount: number;
  captureDate: string | null;
  documentDate: string | null;
  reviewState: 'reviewed' | 'pending_review';
  ocrState: 'scanned_for_findings' | 'not_processed';
  /** Extraction confidence for the findings scan (screening-read, not certified OCR). */
  extractionConfidence: 'high' | 'medium' | 'low' | null;
  findings: Array<{ label: string; detail: string; sourceUrl: string | null; pageNumber: number | null; pageNumbers: number[] }>;
  legalLimitation: string;
  superseded: boolean;
  /** True for operator-uploaded local artifacts (vs county-sourced captures). */
  uploaded?: boolean;
}

export interface UploadedDocumentRow {
  id: number;
  category: RegisteredDocument['category'];
  title: string;
  docType: string;
  fileName: string;
  mimeType: string;
  documentDate: string | null;
  uploadedAt: string;
  note: string | null;
}

export interface DocumentResearchTask {
  title: string;
  why: string;
  owner: 'landos' | 'tyler';
  state: 'open' | 'blocked_needs_payment' | 'blocked_needs_human';
}

export interface DocumentRegistry {
  documents: RegisteredDocument[];
  researchTasks: DocumentResearchTask[];
  summaryLine: string;
}

const DEED_FILE_RE = /^deed_(\d+)_([A-Za-z0-9-]+)_p(\d+)\.(png|jpg|jpeg|webp)$/;

/** Filter + order the county-sourced deed page files that belong to a card. */
export function deedPageFilesForCard(cardId: number, fileNames: string[]): Map<string, DocumentPageRef[]> {
  const byDoc = new Map<string, DocumentPageRef[]>();
  for (const name of fileNames) {
    const m = name.match(DEED_FILE_RE);
    if (!m || Number(m[1]) !== cardId) continue;
    const docNo = m[2];
    const pages = byDoc.get(docNo) ?? [];
    pages.push({ pageNumber: Number(m[3]), file: name });
    byDoc.set(docNo, pages);
  }
  for (const pages of byDoc.values()) pages.sort((a, b) => a.pageNumber - b.pageNumber);
  return byDoc;
}

function firstMatchRow(rows: DocumentEvidenceRow[], re: RegExp): DocumentEvidenceRow | null {
  // Fact labels are authoritative; notes only match when no fact-label row does
  // (a note that merely MENTIONS "vesting deed" must not become the document).
  return rows.find((r) => re.test(r.fact)) ?? rows.find((r) => re.test(r.note)) ?? null;
}

const LEGAL_LIMITATION =
  'Retrieved from the public recorder search and scanned page-by-page. This is not a title search or title opinion; prior instruments, later instruments, and unrecorded interests are not covered.';

/** Pull an exact page citation ("page 3", "p. 3", "pg 3") out of a finding note. */
export function findingPageNumber(text: string): number | null {
  return findingPageNumbers(text)[0] ?? null;
}

/** Parse exact single-page or page-range citations. */
export function findingPageNumbers(text: string): number[] {
  // Explicit LandOS citations take precedence over recorder references such as
  // "Book O/967, Page 1165" that can appear earlier in the same finding.
  const cited = text.match(/\bcited\s+pages?\s*:?\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?/i)
    ?? text.match(/\bpages?\s*:?\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?/i);
  if (cited) {
    const first = Number(cited[1]);
    const last = cited[2] ? Number(cited[2]) : first;
    if (last >= first && last - first <= 100) return Array.from({ length: last - first + 1 }, (_v, i) => first + i);
  }
  const out: number[] = [];
  for (const match of text.matchAll(/\b(?:page|pg\.?|p\.)\s*(\d{1,3})\b/gi)) out.push(Number(match[1]));
  return [...new Set(out)];
}

/**
 * Qualify document conclusions that a single instrument cannot prove:
 *  - successor-trustee status is never "confirmed" from the vesting deed alone;
 *  - a beneficiary-vote provision governs what its text says (amendment) —
 *    it is not evidence of sale authority unless the document says so;
 *  - "no easement found" is limited to this one instrument.
 */
export function qualifyDocumentFinding(label: string, detail: string): string {
  let out = detail;
  if (/successor|trustee/i.test(label + detail) && !/unresolved|not (?:yet )?confirmed|cannot be confirmed/i.test(detail)) {
    out += ' Current/successor trustee status cannot be confirmed from this 1997 instrument alone — later recorded instruments or trust documents are required.';
  }
  if (/75\s*%|three[- ]quarters|beneficiar/i.test(label + detail) && /amend/i.test(detail) && !/sale authority|authority to sell/i.test(detail)) {
    out += ' As written this provision concerns amendment; it is not evidence of sale authority unless the document text says it also governs sales.';
  }
  if (/no (?:express )?easement/i.test(label + detail) && !/this (?:one )?(?:instrument|document|deed)/i.test(detail)) {
    out += ' This limitation applies only to this one instrument — prior deeds, plats, and later recordings can still carry easements.';
  }
  return out;
}

export function buildDocumentRegistry(input: {
  cardId: number;
  evidenceRows: DocumentEvidenceRow[];
  /** Basenames present in the visuals store (deed_<cardId>_… page images). */
  visualFileNames: string[];
  acreageConflict?: boolean;
  /** Operator-uploaded local documents (contracts, surveys, plats, …). */
  uploads?: UploadedDocumentRow[];
}): DocumentRegistry {
  const rows = input.evidenceRows;
  const docs: RegisteredDocument[] = [];
  const byDoc = deedPageFilesForCard(input.cardId, input.visualFileNames);

  const vesting = firstMatchRow(rows, /vesting deed/i);
  // Internal storage paths never render in the primary UI — the page viewer
  // owns page access; technical paths live in Activity/collapsed detail.
  const stripInternalPaths = (text: string) => text
    .replace(/\s*\|?\s*Page screenshots?:\s*\S*store[\\/][^\s.]*(?:\.\w+)?\.?/gi, '')
    .replace(/\s*\bstore[\\/]visuals[\\/]\S+/gi, '')
    .trim();
  const deedFindings = rows
    .filter((r) => /deed|easement|trustee|legal description/i.test(r.fact))
    .map((r) => {
      const pageNumbers = findingPageNumbers(`${r.fact} ${r.note}`);
      return {
        label: r.fact,
        detail: stripInternalPaths(qualifyDocumentFinding(r.fact, r.note)),
        sourceUrl: r.sourceUrl || null,
        pageNumber: pageNumbers[0] ?? null,
        pageNumbers,
      };
    });

  // One registered document per captured recorder doc number.
  for (const [docNo, pages] of byDoc) {
    const documentDate = (vesting?.note.match(/recorded\s+([0-9/]+)/i)?.[1]) ?? null;
    docs.push({
      id: `deed:${docNo}`,
      category: 'deed',
      title: vesting ? vesting.note.split(',')[0] : `Recorded document ${docNo}`,
      docType: vesting?.note.match(/^([A-Z][A-Z ]+[A-Z])/)?.[1] ?? 'Recorded deed',
      source: 'County recorder (public search)',
      officialUrl: vesting?.sourceUrl || rows.find((r) => r.sourceUrl)?.sourceUrl || null,
      pages,
      pageCount: pages.length,
      captureDate: vesting?.dateAccessed || null,
      documentDate,
      reviewState: deedFindings.length ? 'reviewed' : 'pending_review',
      ocrState: deedFindings.length ? 'scanned_for_findings' : 'not_processed',
      extractionConfidence: deedFindings.length ? 'medium' : null,
      findings: deedFindings,
      legalLimitation: LEGAL_LIMITATION,
      superseded: false,
    });
  }

  // Evidence about a deed with no captured pages still registers (pending pages).
  if (!docs.length && vesting) {
    docs.push({
      id: 'deed:referenced',
      category: 'deed',
      title: vesting.note.split(',')[0],
      docType: 'Recorded deed',
      source: 'County recorder (public search)',
      officialUrl: vesting.sourceUrl || null,
      pages: [],
      pageCount: 0,
      captureDate: vesting.dateAccessed || null,
      documentDate: null,
      reviewState: 'pending_review',
      ocrState: 'not_processed',
      extractionConfidence: null,
      findings: deedFindings,
      legalLimitation: LEGAL_LIMITATION,
      superseded: false,
    });
  }

  // Operator-uploaded local documents (contracts, surveys, plats, title
  // commitments, disclosures, perc tests, permits, delineations, elevation
  // certificates, utility/zoning letters, closing documents).
  for (const up of input.uploads ?? []) {
    docs.push({
      id: `upload:${up.id}`,
      category: up.category,
      title: up.title,
      docType: up.docType,
      source: 'Operator upload (local artifact)',
      officialUrl: null,
      pages: [],
      pageCount: 0,
      captureDate: up.uploadedAt,
      documentDate: up.documentDate,
      reviewState: 'pending_review',
      ocrState: 'not_processed',
      extractionConfidence: null,
      findings: up.note ? [{ label: 'Operator note', detail: up.note, sourceUrl: null, pageNumber: null, pageNumbers: [] }] : [],
      legalLimitation: 'Operator-provided local artifact — provenance is the operator, not an official source, until verified.',
      superseded: false,
      uploaded: true,
    });
  }

  // ── Open research tasks, derived generically from the evidence itself ──────
  const researchTasks: DocumentResearchTask[] = [];
  const priorDeed = firstMatchRow(rows, /prior deed/i);
  if (priorDeed) {
    const ref = priorDeed.note.match(/deed book\s+([\w]+),?\s*page\s*(\w+)/i);
    researchTasks.push({
      title: `Retrieve prior deed${ref ? ` (Deed Book ${ref[1]}, Page ${ref[2]})` : ''}`,
      why: 'The title chain references an earlier conveyance that has not been read; it can carry easements or restrictions the later deed does not repeat.',
      owner: 'landos',
      state: 'open',
    });
  }
  const legalDesc = firstMatchRow(rows, /legal description/i);
  const lotRef = legalDesc?.note.match(/lot\s+\w+\s+of\s+([^,.;]+)/i) ?? null;
  if (lotRef || input.acreageConflict) {
    researchTasks.push({
      title: `Locate the recorded plat${lotRef ? ` for ${lotRef[0]}` : ''}`,
      why: input.acreageConflict
        ? 'The assessed vs mapped acreage conflict can only be resolved by the recorded plat or a survey — the plat controls the legal boundary.'
        : 'The legal description references a platted lot; the plat shows boundaries, access, and any platted easements.',
      owner: 'landos',
      state: 'open',
    });
  }
  if (firstMatchRow(rows, /trustee succession|trustee/i)) {
    researchTasks.push({
      title: 'Retrieve later trustee/successor instruments',
      why: 'Trust ownership with named successors — current signing authority requires the later recorded instruments (successor trustee appointments, death certificates, or court orders).',
      owner: 'landos',
      state: 'open',
    });
  }
  researchTasks.push({
    title: 'Search later recorded instruments for easements/encumbrances',
    why: 'Only one deed has been read; easements, rights-of-way, or utility grants recorded after it would not appear in it.',
    owner: 'landos',
    state: 'open',
  });
  researchTasks.push({
    title: 'Pull the current county tax record',
    why: 'Confirms current owner of record, mailing address, tax status, and any delinquency affecting a purchase.',
    owner: 'landos',
    state: 'open',
  });
  if (input.acreageConflict) {
    researchTasks.push({
      title: 'Order a boundary survey (if pursuing)',
      why: 'A survey is the only definitive resolution of the acreage conflict; it requires payment and a business decision.',
      owner: 'tyler',
      state: 'blocked_needs_human',
    });
  }

  const totalPages = docs.reduce((n, d) => n + d.pageCount, 0);
  const summaryLine = docs.length
    ? `${docs.length} recorded document${docs.length === 1 ? '' : 's'} on file (${totalPages} county-sourced page${totalPages === 1 ? '' : 's'}), ${researchTasks.filter((t) => t.state === 'open').length} open document-research task(s).`
    : 'No recorded documents retrieved yet.';

  return { documents: docs, researchTasks, summaryLine };
}

/** Validate a requested page filename: card-scoped, no traversal, deed pattern only. */
export function isServableDocumentPage(cardId: number, file: string): boolean {
  const m = file.match(DEED_FILE_RE);
  return !!m && Number(m[1]) === cardId && !file.includes('/') && !file.includes('\\') && !file.includes('..');
}
