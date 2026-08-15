// LandOS — DISCOVERED CONTEXT from an official document LandOS already has.
//
// The identity path reads a 700-character window around the parcel notation,
// answers "is this the property?", and releases. That is deliberately narrow and
// it must stay narrow: the subject must not wait on document analysis.
//
// But once the bytes are downloaded and the text layer decoded, throwing the
// rest away is pure waste. The winning Fairview packet states the parcel's
// current and requested zoning in the very sentence that identified it, and a
// later sprint would otherwise re-fetch and re-parse the same PDF to read it.
//
// So this module mines the document LandOS ALREADY HAS, after the subject has
// been released, and it is separated from identity by a hard rule:
//
//     IdentityEvidence   may participate in subject resolution.
//     DiscoveredContext  may NEVER change subject identity. It is a finding
//                        ABOUT a property that has already been identified.
//
// Nothing here is synthesized. Each finding is a category, the raw sentence it
// came from, and where it came from. Interpretation belongs to the Property
// Backstory sprint; this only refuses to lose what is already on disk.

import {
  parcelNotationMatchesIdentifier,
  textMentionsParcelNotation,
  type ParcelNotation,
} from './parcel-notation.js';
import type { OfficialPdfDocument } from './official-pdf-identity.js';

export const DISCOVERED_CONTEXT_CATEGORIES = [
  'current_zoning',
  'requested_zoning',
  'rezoning',
  'subdivision_or_development_proposal',
  'lot_count_or_density',
  'project_name',
  'governing_body_action',
  'applicant_or_representative',
  'engineering_or_study',
  'infrastructure',
  'utilities_sewer_water',
  'road_improvement',
  'access',
  'topography_or_grading',
  'wetlands_floodplain_stream',
  'open_space',
  'acreage_or_parcel_change',
] as const;
export type DiscoveredContextCategory = (typeof DISCOVERED_CONTEXT_CATEGORIES)[number];

export interface DiscoveredContextFinding {
  category: DiscoveredContextCategory;
  /** The value as the document states it, verbatim where one is stated. */
  value: string | null;
  /** The sentence/passage this was read from, unedited. */
  context: string;
  sourceUrl: string;
  /** 1-based, approximate: content-stream order, not a parsed page tree. */
  page: number | null;
  pageBasis: 'approximate_content_stream_order';
  sourceClassification: 'official_government_document';
  retrievedAt: string;
  /** Which subject anchor tied this passage to the resolved property. */
  matchedBy: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface DiscoveredContextResult {
  dealCardId: number | null;
  sourceUrl: string;
  retrievedAt: string;
  /** False for an image-only document; the limitation is preserved, not hidden. */
  textLayer: boolean;
  pagesScanned: number;
  /** Passages that named the subject and carried something material. */
  findings: DiscoveredContextFinding[];
  /** Passages about a DIFFERENT parcel that were deliberately not mined. */
  skippedForOtherParcel: number;
  note: string;
}

/**
 * Everything the resolver learned that can tie a passage to THIS property.
 *
 * Assembled from the resolved subject, so the miner never has to guess which
 * property a document section is about.
 */
export interface SubjectAnchors {
  notations: readonly ParcelNotation[];
  apn?: string | null;
  owner?: string | null;
  projectName?: string | null;
  address?: string | null;
  city?: string | null;
}

interface CategoryRule {
  category: DiscoveredContextCategory;
  pattern: RegExp;
  /** Captures the stated value when the wording carries one. */
  value?: RegExp;
}

const RULES: CategoryRule[] = [
  { category: 'current_zoning', pattern: /\bcurrent\s+zoning\b/i, value: /\bcurrent\s+zoning\s*[:\-]?\s*([A-Za-z0-9\- ]{1,40}?)(?=\s*[.;,]|\s+Requested|\s*$)/i },
  { category: 'requested_zoning', pattern: /\brequested\s+zoning\b/i, value: /\brequested\s+zoning\s*[:\-]?\s*([A-Za-z0-9\- ]{1,40}?)(?=\s*[.;,]|\s+Property|\s*$)/i },
  { category: 'rezoning', pattern: /\brezon(?:e|ing|ed)\b|\bzoning\s+(?:amendment|change|map\s+amendment)\b/i },
  { category: 'subdivision_or_development_proposal', pattern: /\b(?:master\s+development\s+plan|preliminary\s+plat|final\s+plat|site\s+plan|subdivision\s+(?:plat|application|plan)|planned\s+(?:unit\s+)?development)\b/i },
  { category: 'lot_count_or_density', pattern: /\b\d{1,4}\s*(?:single[- ]family\s+)?lots?\b|\bdensity\b|\bunits?\s+per\s+acre\b/i, value: /\b(\d{1,4}\s*(?:single[- ]family\s+)?lots?)\b/i },
  { category: 'project_name', pattern: /\b[A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-]+){0,3}\s+(?:Subdivision|Estates|Farms|Plat|Addition)\b/, value: /\b([A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-]+){0,3}\s+(?:Subdivision|Estates|Farms|Plat|Addition))\b/ },
  { category: 'governing_body_action', pattern: /\b(?:approved|denied|deferred|tabled|recommend(?:ed|ation)?|continued|withdrawn|adopted|passed)\b/i, value: /\b(approved|denied|deferred|tabled|recommended|recommendation|continued|withdrawn|adopted|passed)\b/i },
  // The VALUE must look like a party, not the rest of the sentence. A live run
  // captured "had 2 options when this was submitted" as an applicant, which is
  // presenting prose as a fact. A name starts with a capital and carries no
  // narrative verb.
  { category: 'applicant_or_representative', pattern: /\bapplicant\b|\brepresent(?:ative|ing)\b|\bon\s+behalf\s+of\b/i, value: /\bapplicant\s*(?:is|was)?\s*[:\-]?\s*((?!had\b|was\b|is\b|were\b)[A-Z][A-Za-z0-9'’.,&\- ]{2,58}?)(?=\s*(?:[.;\n]|,\s+(?:who|which)|$))/ },
  { category: 'engineering_or_study', pattern: /\bengineer(?:ing|'?s)?\b|\btraffic\s+(?:study|impact)\b|\bsurvey(?:or)?\b|\bgeotechnical\b|\bsoils?\s+(?:report|study)\b/i },
  { category: 'infrastructure', pattern: /\binfrastructure\b|\bdetention\b|\bstorm\s*water\b|\bdrainage\b/i },
  { category: 'utilities_sewer_water', pattern: /\bsewer\b|\bwater\s+(?:line|service|main|utility)\b|\bseptic\b|\butilit(?:y|ies)\b/i },
  { category: 'road_improvement', pattern: /\broad\s+improvement\b|\bright[- ]of[- ]way\b|\bpaving\b|\bturn\s+lane\b|\bcurb\s+and\s+gutter\b/i },
  { category: 'access', pattern: /\baccess\s+(?:point|easement|drive|road|concern)\b|\bingress\b|\begress\b|\bdriveway\b/i },
  { category: 'topography_or_grading', pattern: /\btopograph(?:y|ic)\b|\bgrading\b|\bslope[sd]?\b|\bcut\s+and\s+fill\b/i },
  { category: 'wetlands_floodplain_stream', pattern: /\bwetlands?\b|\bfloodplain\b|\bflood\s+zone\b|\bstream\b|\bblue\s*line\b/i },
  { category: 'open_space', pattern: /\bopen\s+space\b|\bgreen\s*way\b|\bcommon\s+area\b/i },
  { category: 'acreage_or_parcel_change', pattern: /\b\d{1,5}(?:\.\d{1,3})?\s*(?:\+\/-\s*)?acres?\b|\bparcel\s+split\b|\blot\s+line\s+adjustment\b|\bcombin(?:e|ed|ation)\b/i, value: /\b(\d{1,5}(?:\.\d{1,3})?\s*(?:\+\/-\s*)?acres?)\b/i },
];

/** A map/parcel statement belonging to SOME parcel, used to detect a foreign one. */
const ANY_MAP_PARCEL = /\bmap\s*[:#]?\s*([0-9]{1,4}[A-Za-z]?)\b[\s,]*(?:group\s*[:#]?\s*[0-9A-Za-z]{1,3}\b[\s,]*)?(?:parcel|lot)\s*[:#]?\s*([0-9]{1,5}(?:\.[0-9]{1,3})?[A-Za-z]?)\b/gi;

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Sentences, in order. */
function sentencesOf(page: string): string[] {
  return page
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])|\n{2,}/)
    .map(clean)
    .filter((sentence) => sentence.length >= 8 && sentence.length <= 1_200);
}

export interface DocumentSegment {
  sentences: string[];
  /** True when this run of sentences is about the subject property. */
  aboutSubject: boolean;
  /** True when it states some OTHER parcel's map/parcel. */
  aboutAnotherParcel: boolean;
  matchedBy: string | null;
}

/**
 * Group a page into the agenda items it actually contains.
 *
 * A minute book states the parcel once and then discusses it for a paragraph:
 * "Map: 42, Parcel: 123.00." and "Current Zoning: R-20 POD." are separate
 * sentences, and anchoring sentence-by-sentence would keep the first and throw
 * the second away. A segment runs until the document names a DIFFERENT parcel,
 * which is exactly where one agenda item ends and the next begins.
 */
export function segmentsOf(page: string, anchors: SubjectAnchors): DocumentSegment[] {
  const segments: DocumentSegment[] = [];
  let current: DocumentSegment = { sentences: [], aboutSubject: false, aboutAnotherParcel: false, matchedBy: null };
  const close = (): void => {
    if (current.sentences.length) segments.push(current);
    current = { sentences: [], aboutSubject: false, aboutAnotherParcel: false, matchedBy: null };
  };
  for (const sentence of sentencesOf(page)) {
    if (passageIsAboutAnotherParcel(sentence, anchors)) {
      close();
      current.sentences.push(sentence);
      current.aboutAnotherParcel = true;
      close();
      continue;
    }
    const anchor = subjectAnchorIn(sentence, anchors);
    if (anchor) {
      current.aboutSubject = true;
      current.matchedBy = current.matchedBy ?? anchor;
    }
    current.sentences.push(sentence);
  }
  close();
  return segments;
}

/** Which anchor, if any, ties this passage to the resolved subject? */
export function subjectAnchorIn(passage: string, anchors: SubjectAnchors): string | null {
  for (const notation of anchors.notations) {
    if (textMentionsParcelNotation(notation, passage)) return `parcel notation ${notation.raw}`;
  }
  const compact = passage.replace(/[^0-9A-Za-z]/g, '').toLowerCase();
  if (anchors.apn) {
    const apn = anchors.apn.replace(/[^0-9A-Za-z]/g, '').toLowerCase();
    if (apn.length >= 5 && compact.includes(apn)) return `parcel identifier ${anchors.apn}`;
  }
  for (const [label, value] of [['project', anchors.projectName], ['owner', anchors.owner], ['address', anchors.address]] as const) {
    const needle = String(value ?? '').trim();
    if (needle.length < 4) continue;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    if (new RegExp(escaped, 'i').test(passage)) return `${label} ${needle}`;
  }
  return null;
}

/**
 * Does this passage belong to a DIFFERENT parcel?
 *
 * A planning packet works through several properties in a row. A passage that
 * states a map/parcel which is not this lead's is another owner's business and
 * is skipped, not mined.
 */
export function passageIsAboutAnotherParcel(passage: string, anchors: SubjectAnchors): boolean {
  ANY_MAP_PARCEL.lastIndex = 0;
  const stated = [...passage.matchAll(ANY_MAP_PARCEL)];
  if (!stated.length) return false;
  return stated.every((match) => {
    const identifier = `${match[1]} ${match[2]}`;
    const mine = anchors.notations.some((notation) => parcelNotationMatchesIdentifier(notation, identifier));
    if (mine) return false;
    if (!anchors.apn) return true;
    const compact = (value: string): string => value.replace(/[^0-9A-Za-z]/g, '').toLowerCase();
    return !compact(anchors.apn).startsWith(compact(identifier).slice(0, 5));
  });
}

export interface MineDocumentContextInput {
  document: OfficialPdfDocument;
  anchors: SubjectAnchors;
  dealCardId?: number | null;
  /** Bound the work; a packet is hundreds of passages, not thousands. */
  maxFindings?: number;
  now?: () => string;
}

/**
 * Mine every materially relevant SUBJECT-SPECIFIC passage from a document
 * LandOS already holds.
 *
 * Purely additive: it reads, it never writes, and nothing it produces is
 * allowed anywhere near parcel identity.
 */
export function mineDocumentContext(input: MineDocumentContextInput): DiscoveredContextResult {
  const now = (input.now ?? (() => new Date().toISOString()))();
  const maxFindings = Math.max(1, input.maxFindings ?? 60);
  const findings: DiscoveredContextFinding[] = [];
  const seen = new Set<string>();
  let skippedForOtherParcel = 0;

  if (!input.document.textLayer) {
    return {
      dealCardId: input.dealCardId ?? null,
      sourceUrl: input.document.url,
      retrievedAt: input.document.fetchedAt,
      textLayer: false,
      pagesScanned: 0,
      findings: [],
      skippedForOtherParcel: 0,
      note: 'This official document carries no text layer — it is an image-only scan. Nothing was read from it, and no optical recognition was attempted.',
    };
  }

  input.document.pages.forEach((page, index) => {
    for (const segment of segmentsOf(page, input.anchors)) {
      if (segment.aboutAnotherParcel) { skippedForOtherParcel += segment.sentences.length; continue; }
      if (!segment.aboutSubject) continue;
      const matchedBy = segment.matchedBy ?? 'subject segment';
      for (const passage of segment.sentences) {
      if (findings.length >= maxFindings) return;
      for (const rule of RULES) {
        if (findings.length >= maxFindings) return;
        if (!rule.pattern.test(passage)) continue;
        const valueMatch = rule.value ? rule.value.exec(passage) : null;
        const candidate = valueMatch ? clean(valueMatch[1] ?? '') || null : null;
        // A captured value that reads as narrative is not a fact. Better to
        // retain the category with no stated value than to publish prose as one.
        const value = candidate && /\b(had|was|were|will|would|when|this|that|there)\b/i.test(candidate)
          ? null
          : candidate;
        // Cite the wording the finding actually came from. A minute book page
        // can be one unbroken run of text, and quoting the whole page as the
        // "context" for a zoning value is provenance in name only.
        const at = valueMatch?.index ?? passage.search(rule.pattern);
        const context = at >= 0 && passage.length > 320
          ? clean(passage.slice(Math.max(0, at - 140), at + 180))
          : passage.slice(0, 600);
        const key = `${rule.category}|${value ?? ''}|${context.slice(0, 80)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          category: rule.category,
          value,
          context,
          sourceUrl: input.document.url,
          page: index + 1,
          pageBasis: 'approximate_content_stream_order',
          sourceClassification: 'official_government_document',
          retrievedAt: input.document.fetchedAt,
          matchedBy,
          // A stated value read from an official document is strong; a category
          // matched only by topic wording is weaker and says so.
          confidence: value ? 'high' : 'medium',
        });
      }
      }
    }
  });

  return {
    dealCardId: input.dealCardId ?? null,
    sourceUrl: input.document.url,
    retrievedAt: input.document.fetchedAt,
    textLayer: true,
    pagesScanned: input.document.pages.length,
    findings,
    skippedForOtherParcel,
    note: findings.length
      ? `${findings.length} subject-specific finding(s) retained from an official document already fetched for identity.`
        + `${skippedForOtherParcel ? ` ${skippedForOtherParcel} passage(s) about another parcel were skipped.` : ''}`
      : 'The document was read in full and carried nothing further about this parcel.',
  };
}

// ── Retention ───────────────────────────────────────────────────────────────
//
// Deliberately in-process and additive. Persisting discovered context is the
// Property Backstory sprint's decision, and inventing a table for it here would
// be the database redesign this sprint is told not to do.

const CONTEXT_BY_DEAL = new Map<number, DiscoveredContextResult[]>();

export function retainDiscoveredContext(dealCardId: number, result: DiscoveredContextResult): void {
  const existing = CONTEXT_BY_DEAL.get(dealCardId) ?? [];
  const withoutSameSource = existing.filter((row) => row.sourceUrl !== result.sourceUrl);
  CONTEXT_BY_DEAL.set(dealCardId, [...withoutSameSource, result]);
}

export function discoveredContextFor(dealCardId: number): DiscoveredContextResult[] {
  return CONTEXT_BY_DEAL.get(dealCardId) ?? [];
}

export function clearDiscoveredContext(dealCardId?: number): void {
  if (dealCardId == null) CONTEXT_BY_DEAL.clear();
  else CONTEXT_BY_DEAL.delete(dealCardId);
}
