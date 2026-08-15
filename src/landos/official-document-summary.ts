// LandOS — the DETAILED SUBJECT-SPECIFIC document summary.
//
// Not a summary of a PDF. A summary of what one official document tells LandOS
// about ONE property, so that the Backstory, zoning, subdivision, strategy and
// pre-call systems can read it instead of re-reading a 26-page planning packet.
//
// Three rules shape it, and all three are about not lying:
//
//   1. GROUNDED. Every sentence is composed from findings that were actually
//      extracted from that source. Nothing is inferred, reconciled against
//      another document, or quietly corrected. There is no model in this path —
//      it is a deterministic composer over retained evidence.
//   2. DISTINCTIONS SURVIVE. "Current zoning" and "requested zoning" are
//      different facts and are never merged. Proposed is never reported as
//      approved. When a document states two different values for the same thing,
//      BOTH are reported with their pages rather than one being chosen.
//   3. IT CANNOT MOVE IDENTITY. The summary is derived from discovered context,
//      which is derived from an already-identified property. There is no path
//      from here back into the property card, and none is provided.

import type { DiscoveredContextFinding, DiscoveredContextResult } from './official-document-context.js';

export interface OfficialDocumentSubject {
  apn?: string | null;
  owner?: string | null;
  projectName?: string | null;
  acreage?: number | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  parcelNotation?: string | null;
}

export interface OfficialDocumentSummaryKeyFinding {
  category: DiscoveredContextFinding['category'];
  value: string | null;
  page: number | null;
  confidence: DiscoveredContextFinding['confidence'];
}

export interface OfficialDocumentSummary {
  documentKey: string;
  dealCardId: number | null;
  propertyIdentityVersionId: number | null;
  sourceUrl: string;
  sourceTitle: string | null;
  sourceClassification: 'official_government_document';
  documentType: string | null;
  documentDate: string | null;
  retrievedAt: string;
  summaryGeneratedAt: string;
  /** The prose. Composed only from `keyFindings`. */
  detailedSummary: string;
  keyFindings: OfficialDocumentSummaryKeyFinding[];
  /** Ids of the durable evidence rows this summary rests on. */
  evidenceRefs: number[];
  pagesReferenced: number[];
  confidence: 'high' | 'medium' | 'low';
  limitations: string[];
  subject: OfficialDocumentSubject;
}

const TITLE_CASE = (value: string): string => value.replace(/\b\w/g, (letter) => letter.toUpperCase());

/**
 * A phrase that survives a PDF text layer's letter spacing.
 *
 * Real planning packets emit headings as "P lanning C ommission" — the glyphs
 * are positioned individually and the extractor sees the spaces. A plain phrase
 * match silently fails on exactly the documents this is for.
 */
function spacedPattern(phrase: string): string {
  return phrase.split('').map((character) => (character === ' ' ? '\\s+' : `${character}\\s?`)).join('');
}

const GOVERNING_BODIES = [
  'planning commission',
  'board of mayor and aldermen',
  'board of commissioners',
  'board of zoning appeals',
  'city council',
  'county commission',
];
const DOCUMENT_KINDS = ['minutes', 'agenda', 'packet', 'staff report', 'resolution', 'application', 'notice'];

/** The document's own description of itself, when it states one. */
export function readDocumentType(text: string): string | null {
  const head = text.slice(0, 6_000).replace(/\s+/g, ' ');
  const first = (phrases: string[]): string | null => {
    for (const phrase of phrases) {
      if (new RegExp(spacedPattern(phrase), 'i').test(head)) return TITLE_CASE(phrase);
    }
    return null;
  };
  const body = first(GOVERNING_BODIES);
  const kind = first(DOCUMENT_KINDS);
  if (!body && !kind) return null;
  return [body, kind].filter(Boolean).join(' ');
}

/** "a"/"an", so the summary reads like a sentence a person wrote. */
function article(noun: string): string {
  return /^[aeiou]/i.test(noun) ? 'an' : 'a';
}

/** The meeting/application date the document prints, when it prints one. */
export function readDocumentDate(text: string): string | null {
  const head = text.slice(0, 4_000).replace(/\s+/g, ' ');
  // Planning packets frequently letter-space their headings ("202 5"), so the
  // year is matched tolerantly and normalized. A date that cannot be read stays
  // null rather than being guessed at.
  const match = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s*(\d{1,2})\s*,?\s*(\d\s?\d\s?\d\s?\d)\b/i.exec(head);
  if (!match) return null;
  const year = match[3].replace(/\s+/g, '');
  if (!/^(19|20)\d{2}$/.test(year)) return null;
  return `${TITLE_CASE(match[1].toLowerCase())} ${Number(match[2])}, ${year}`;
}

const CATEGORY_PROSE: Partial<Record<DiscoveredContextFinding['category'], string>> = {
  engineering_or_study: 'engineering work or studies',
  infrastructure: 'infrastructure',
  utilities_sewer_water: 'sewer, water or utility service',
  road_improvement: 'road improvements',
  access: 'access',
  topography_or_grading: 'topography or grading',
  wetlands_floodplain_stream: 'wetlands, floodplain or streams',
  open_space: 'open space',
};

/** Distinct stated values for a category, in page order, never collapsed. */
function statedValues(findings: DiscoveredContextFinding[], category: DiscoveredContextFinding['category']): Array<{ value: string; pages: number[] }> {
  const byValue = new Map<string, number[]>();
  for (const finding of findings) {
    if (finding.category !== category || !finding.value) continue;
    const pages = byValue.get(finding.value) ?? [];
    if (finding.page != null && !pages.includes(finding.page)) pages.push(finding.page);
    byValue.set(finding.value, pages);
  }
  return [...byValue.entries()].map(([value, pages]) => ({ value, pages: pages.sort((a, b) => a - b) }));
}

function citation(pages: number[]): string {
  if (!pages.length) return '';
  return pages.length === 1 ? ` (p. ${pages[0]})` : ` (pp. ${pages.join(', ')})`;
}

/** "A" / "A and B" / "A, B and C", so multiple stated values stay visible. */
function list(values: string[]): string {
  if (values.length <= 1) return values[0] ?? '';
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

function present(findings: DiscoveredContextFinding[], category: DiscoveredContextFinding['category']): DiscoveredContextFinding[] {
  return findings.filter((finding) => finding.category === category);
}

function pagesOf(findings: DiscoveredContextFinding[]): number[] {
  return [...new Set(findings.map((finding) => finding.page).filter((page): page is number => page != null))].sort((a, b) => a - b);
}

export interface ComposeDocumentSummaryInput {
  context: DiscoveredContextResult;
  subject: OfficialDocumentSubject;
  documentKey: string;
  documentText: string;
  sourceTitle?: string | null;
  propertyIdentityVersionId?: number | null;
  evidenceRefs?: number[];
  now?: () => string;
}

/**
 * Compose the detailed subject-specific summary from retained findings.
 *
 * Deterministic and source-bound: given the same findings it produces the same
 * prose, and it can state nothing the findings do not contain.
 */
export function composeOfficialDocumentSummary(input: ComposeDocumentSummaryInput): OfficialDocumentSummary {
  const now = (input.now ?? (() => new Date().toISOString()))();
  const findings = input.context.findings;
  const documentType = readDocumentType(input.documentText);
  const documentDate = readDocumentDate(input.documentText);
  const sentences: string[] = [];
  const limitations: string[] = [];

  // ── What this document is ────────────────────────────────────────────────
  const opening = [
    documentType ? `This is ${article(documentType)} ${documentType.toLowerCase()}` : 'This is an official government document',
    documentDate ? ` dated ${documentDate}` : '',
    '.',
  ].join('');
  sentences.push(opening);

  // ── Which property it is about ───────────────────────────────────────────
  const projectValues = statedValues(findings, 'project_name');
  const identityParts: string[] = [];
  if (projectValues.length) identityParts.push(`the ${list(projectValues.map((row) => row.value))}`);
  if (input.subject.parcelNotation) identityParts.push(`the parcel the lead names as ${input.subject.parcelNotation}`);
  else if (input.subject.apn) identityParts.push(`parcel ${input.subject.apn}`);
  if (identityParts.length) {
    sentences.push(`It concerns ${list(identityParts)}${input.subject.apn && input.subject.parcelNotation ? `, carried by LandOS as ${input.subject.apn}` : ''}${
      input.subject.city || input.subject.county ? ` in ${[input.subject.city, input.subject.county ? `${input.subject.county} County` : null, input.subject.state].filter(Boolean).join(', ')}` : ''
    }.`);
  }
  if (input.subject.owner) sentences.push(`The document names the property owner as ${input.subject.owner}.`);

  // ── Acreage, with every stated value preserved ───────────────────────────
  const acreage = statedValues(findings, 'acreage_or_parcel_change');
  if (acreage.length === 1) {
    sentences.push(`It states the acreage as ${acreage[0].value}${citation(acreage[0].pages)}.`);
  } else if (acreage.length > 1) {
    sentences.push(
      `It states more than one acreage figure — ${list(acreage.map((row) => `${row.value}${citation(row.pages)}`))}. `
      + 'Both are reported as the document states them; LandOS has not reconciled them.',
    );
    limitations.push('The document states more than one acreage figure for this property; they are preserved unreconciled.');
  }

  // ── Zoning: current and requested are DIFFERENT facts ────────────────────
  const current = statedValues(findings, 'current_zoning');
  const requested = statedValues(findings, 'requested_zoning');
  if (current.length) {
    sentences.push(`The zoning in effect according to this document is ${list(current.map((row) => `${row.value}${citation(row.pages)}`))}.`);
    if (current.length > 1) limitations.push('The document states more than one current zoning value; all are preserved.');
  }
  if (requested.length) {
    sentences.push(
      `A change to ${list(requested.map((row) => `${row.value}${citation(row.pages)}`))} was REQUESTED. `
      + 'That is a request recorded in this document, not an approved zoning.',
    );
  }
  if (present(findings, 'rezoning').length && !requested.length) {
    sentences.push(`The document discusses rezoning${citation(pagesOf(present(findings, 'rezoning')))} without stating a requested district.`);
  }

  // ── The development proposal ─────────────────────────────────────────────
  const proposal = present(findings, 'subdivision_or_development_proposal');
  const density = statedValues(findings, 'lot_count_or_density');
  if (proposal.length) {
    sentences.push(`A subdivision or development proposal for this property is before the body${citation(pagesOf(proposal))}.`);
  }
  if (density.length) {
    sentences.push(
      `The proposal is described with ${list(density.map((row) => `${row.value}${citation(row.pages)}`))}. `
      + 'These are proposed figures as stated in this document.',
    );
    if (density.length > 1) limitations.push('The document states more than one lot-count/density figure; all are preserved rather than collapsed.');
  }
  const applicant = statedValues(findings, 'applicant_or_representative');
  if (applicant.length) sentences.push(`The applicant or representative is given as ${list(applicant.map((row) => `${row.value}${citation(row.pages)}`))}.`);

  // ── What the body actually did ───────────────────────────────────────────
  const actions = statedValues(findings, 'governing_body_action');
  if (actions.length) {
    sentences.push(
      `Recorded action wording includes ${list(actions.map((row) => `"${row.value}"${citation(row.pages)}`))}. `
      + 'LandOS records the wording; it does not decide from this document alone whether the matter is finally approved.',
    );
    limitations.push('Governing-body action wording is retained verbatim; final disposition is not concluded from this document alone.');
  }

  // ── Site, engineering and constraints ────────────────────────────────────
  const siteTopics = (Object.keys(CATEGORY_PROSE) as Array<DiscoveredContextFinding['category']>)
    .map((category) => ({ category, hits: present(findings, category) }))
    .filter((row) => row.hits.length);
  if (siteTopics.length) {
    sentences.push(
      `The document discusses ${list(siteTopics.map((row) => `${CATEGORY_PROSE[row.category]}${citation(pagesOf(row.hits))}`))} `
      + 'in connection with this property.',
    );
  }

  if (!findings.length) {
    sentences.push('It names this property but states nothing further about it.');
  }
  if (input.context.skippedForOtherParcel > 0) {
    sentences.push(
      `${input.context.skippedForOtherParcel} passage(s) in this document concern other parcels and were deliberately excluded.`,
    );
  }
  if (!input.context.textLayer) {
    limitations.push('The document has no text layer; nothing could be read from it and no optical recognition was attempted.');
  }

  const keyFindings: OfficialDocumentSummaryKeyFinding[] = findings.map((finding) => ({
    category: finding.category,
    value: finding.value,
    page: finding.page,
    confidence: finding.confidence,
  }));
  const highConfidence = findings.filter((finding) => finding.confidence === 'high').length;

  return {
    documentKey: input.documentKey,
    dealCardId: input.context.dealCardId,
    propertyIdentityVersionId: input.propertyIdentityVersionId ?? null,
    sourceUrl: input.context.sourceUrl,
    sourceTitle: input.sourceTitle ?? null,
    sourceClassification: 'official_government_document',
    documentType,
    documentDate,
    retrievedAt: input.context.retrievedAt,
    summaryGeneratedAt: now,
    detailedSummary: sentences.join(' '),
    keyFindings,
    evidenceRefs: input.evidenceRefs ?? [],
    pagesReferenced: pagesOf(findings),
    confidence: !input.context.textLayer ? 'low' : highConfidence >= 3 ? 'high' : findings.length ? 'medium' : 'low',
    limitations,
    subject: input.subject,
  };
}
