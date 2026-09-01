// LandOS — DOCUMENT EVIDENCE: retained pages, carried into the front door.
//
// The document path already reads a survey, deed, plat, tax bill or zoning
// letter into claims that each carry the exact page they came from. What it did
// not do was hand that reading to Subject Understanding, so a survey could
// settle the lot, the acreage, the flood zone and the adjoining owners while
// the subject reader saw none of it.
//
// This module is that bridge, and it is deliberately NOT a second document
// engine:
//
//   • It fetches nothing, re-uploads nothing, re-reads no bytes and makes no
//     model call. Every input is a page LandOS already interpreted.
//   • `interpretDealEvidence` remains the one claim reader. This adds the two
//     things a land document carries that prose extraction misses — its TABLES
//     and its DRAWING LABELS — over the same retained text.
//   • It never decides identity. Facts leave here labelled with the parcel they
//     concern; an adjoining owner read off a survey drawing is evidence about
//     THAT parcel, and it is typed that way at the source.
//
// The separation this preserves matters more than any single field: `quoted`
// is what the page says, `inferred` is what LandOS concluded from it, and a
// page LandOS could not read produces an explicit gap rather than silence.

import type {
  DealEvidenceInterpretation,
  EvidenceClaim,
  EvidenceClaimField,
  RetainedEvidenceArtifact,
} from './deal-evidence-claims.js';
import type {
  SubjectEvidenceFact,
  SubjectEvidenceField,
  SubjectEvidenceWeight,
} from './subject-understanding.js';

// ── Tables ──────────────────────────────────────────────────────────────────

export interface DocumentTableCell {
  header: string;
  value: string;
}

export interface DocumentTableRow {
  cells: DocumentTableCell[];
  /** The row exactly as it appears, so a reviewer can find it on the page. */
  rowText: string;
}

export interface DocumentTable {
  /** The table's own title line, verbatim. */
  label: string;
  headers: string[];
  rows: DocumentTableRow[];
  /** Title, header and rows, verbatim, as the quotable block. */
  text: string;
}

/** A title line: a land document names its tables, and the name is how the
 *  operator finds them again. A block with no title is prose. */
const TABLE_TITLE = /^[A-Z0-9][A-Z0-9 &/'()-]*\b(?:TABLE|DETAIL|SCHEDULE|SUMMARY|BREAKDOWN)\b[A-Z0-9 &/'()-]*$/;

function columns(line: string): string[] {
  return line.trim().split(/\s{2,}/).map((cell) => cell.trim()).filter((cell) => cell !== '');
}

/**
 * Read the titled, column-aligned blocks a land document carries.
 *
 * Deliberately strict: a title line, then a header row of two or more columns,
 * then rows of exactly that many columns. Prose that happens to contain numbers
 * produces nothing, which is the point — a tax statement's assessed values must
 * never be read as an acreage.
 */
export function readDocumentTables(text: string): DocumentTable[] {
  const lines = text.split(/\r?\n/);
  const tables: DocumentTable[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const title = lines[index].trim();
    if (!TABLE_TITLE.test(title) || columns(title).length > 1) continue;

    let cursor = index + 1;
    while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1;
    const headers = cursor < lines.length ? columns(lines[cursor]) : [];
    if (headers.length < 2) continue;

    const rows: DocumentTableRow[] = [];
    const block = [title, lines[cursor].trim()];
    for (let row = cursor + 1; row < lines.length; row += 1) {
      const cells = columns(lines[row]);
      if (cells.length !== headers.length) break;
      rows.push({
        cells: headers.map((header, position) => ({ header, value: cells[position] })),
        rowText: lines[row].trim(),
      });
      block.push(lines[row].trim());
    }
    if (!rows.length) continue;
    tables.push({ label: title, headers, rows, text: block.join('\n') });
    index = cursor + rows.length;
  }
  return tables;
}

// ── Drawing labels ──────────────────────────────────────────────────────────

export type DiagramLabelKind = 'monument' | 'adjoiner' | 'annotation' | 'bearing_call';

export interface DiagramLabel {
  /** The label exactly as the drawing carries it. */
  text: string;
  kind: DiagramLabelKind;
  /**
   * Whether the label describes the surveyed parcel itself.
   *
   * An adjoiner block names the NEIGHBOUR. Reading it as the subject's owner is
   * invariant 4 in its most tempting form — the name is right there on the
   * subject's own survey — so the answer is fixed at the source, not left to a
   * downstream consumer to remember.
   */
  aboutSubject: boolean;
}

const ADJOINER = /\bnow\s+or\s+formerly\b|\bN\/F\b/i;
const MONUMENT = /\b(?:iron\s+(?:rod|pin)|rebar|concrete\s+monument|pk\s+nail|capped\s+(?:rod|pin)|axle|stone\s+corner)\b/i;
const ANNOTATION = /\bflood\s+zone\b|\bnot\s+to\s+scale\b|\bscale\s*[:=]|\bbasis\s+of\s+bearings\b|\bzoned?\s*[:=]/i;
const BEARING_CALL = /[NS]\s*\d{1,3}°\d{1,2}'\d{1,2}"\s*[EW]/;

/** Read the labels a survey or plat drawing carries, typed by what they are. */
export function readDiagramLabels(text: string): DiagramLabel[] {
  const labels: DiagramLabel[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || seen.has(line)) continue;
    // Most specific first: an adjoiner block routinely carries a bearing and a
    // monument, and typing it by the bearing would file the neighbour's name
    // as the subject's own geometry.
    const kind: DiagramLabelKind | null = ADJOINER.test(line) ? 'adjoiner'
      : MONUMENT.test(line) ? 'monument'
        : ANNOTATION.test(line) ? 'annotation'
          : BEARING_CALL.test(line) ? 'bearing_call'
            : null;
    if (!kind) continue;
    seen.add(line);
    labels.push({ text: line, kind, aboutSubject: kind !== 'adjoiner' });
  }
  return labels;
}

// ── The bridge ──────────────────────────────────────────────────────────────

const FIELD_MAP: Record<EvidenceClaimField, SubjectEvidenceField> = {
  apn: 'apn',
  owner: 'owner',
  grantor: 'other',
  grantee: 'other',
  legalDescription: 'legal_description',
  recording: 'other',
  acreage: 'acreage',
  dimension: 'other',
  roadFrontage: 'other',
  roadName: 'other',
  adjoiningParcel: 'other',
  surveyBoundary: 'other',
  surveyDate: 'other',
  parcelSplit: 'other',
  floodZone: 'other',
  easement: 'other',
  other: 'other',
};

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

function locatorFor(claim: EvidenceClaim): string {
  return `${claim.provenance.pageLabel} (${claim.provenance.fileName})`;
}

function isoFrom(capturedAt: number): string {
  return new Date(capturedAt * 1000).toISOString();
}

/**
 * Everything the retained documents establish, in the shape Subject
 * Understanding consumes.
 *
 * PURE. Claims first, then LandOS's own reconciled conclusions, then the tables
 * and drawing labels, then the pages that could not be read. Claims lead
 * deliberately: a page's own words outrank a figure LandOS derived from them,
 * and a consumer taking the first match for a field should get the quotation.
 */
export function documentEvidenceFacts(input: {
  interpretation: DealEvidenceInterpretation;
  artifacts: readonly RetainedEvidenceArtifact[];
}): SubjectEvidenceFact[] {
  const facts: SubjectEvidenceFact[] = [];
  const byArtifact = new Map(input.artifacts.map((artifact) => [artifact.artifactId, artifact]));

  // 1. What the pages say.
  for (const claim of input.interpretation.claims) {
    facts.push({
      factId: `doc:${claim.provenance.artifactId}:${claim.field}:${slug(claim.value)}`,
      field: FIELD_MAP[claim.field],
      label: claim.label,
      value: claim.value,
      quoted: claim.excerpt.trim() === '' ? claim.value : claim.excerpt,
      inferred: false,
      source: {
        kind: 'document',
        label: claim.provenance.groupLabel,
        url: null,
        locator: locatorFor(claim),
        retrievedAt: isoFrom(claim.provenance.capturedAt),
        officiality: 'unverified',
      },
      weight: claim.weight,
      parcelRelationship: claim.parcelRelationship,
    });
  }

  // 2. What LandOS concluded from them. Never quoted: no page states this.
  const acreage = input.interpretation.acreage;
  if (acreage?.workingAcres != null) {
    facts.push({
      factId: 'doc:derived:working-acreage',
      field: 'acreage',
      label: `Working acreage from the retained documents (${acreage.workingBasis ?? 'document-stated'})`,
      value: String(acreage.workingAcres),
      quoted: null,
      inferred: true,
      source: {
        kind: 'document',
        label: 'LandOS document reconciliation',
        url: null,
        locator: acreage.entries[0]?.source ?? null,
        retrievedAt: null,
        officiality: 'unverified',
      },
      weight: 'likely',
      parcelRelationship: 'subject',
    });
  }

  // 3. Tables and drawing labels, read over the same retained text.
  const relationshipOf = new Map<number, EvidenceClaim['parcelRelationship']>();
  for (const claim of input.interpretation.claims) {
    relationshipOf.set(claim.provenance.artifactId, claim.parcelRelationship);
  }
  const pageOf = new Map<number, string>();
  for (const claim of input.interpretation.claims) pageOf.set(claim.provenance.artifactId, locatorFor(claim));

  for (const artifact of input.artifacts) {
    if (!artifact.exactText.trim()) continue;
    const relationship = relationshipOf.get(artifact.artifactId) ?? 'unresolved_relationship';
    const locator = pageOf.get(artifact.artifactId) ?? artifact.fileName;
    const weight: SubjectEvidenceWeight = artifact.extractionStatus === 'complete' ? 'well_supported' : 'likely';
    const retrievedAt = isoFrom(artifact.capturedAt);

    for (const table of readDocumentTables(artifact.exactText)) {
      facts.push({
        factId: `doc:${artifact.artifactId}:table:${slug(table.label)}`,
        field: 'other',
        label: `Table on the page: ${table.label}`,
        value: `${table.rows.length} row(s) under ${table.headers.join(' / ')}`,
        quoted: table.text,
        inferred: false,
        source: { kind: 'document', label: table.label, url: null, locator, retrievedAt, officiality: 'unverified' },
        weight,
        parcelRelationship: relationship,
      });
    }

    for (const label of readDiagramLabels(artifact.exactText)) {
      // Bearing calls already reach the subject as boundary segments with their
      // roles attached; re-emitting them here would be the same course twice,
      // once without the role that makes it mean anything.
      if (label.kind === 'bearing_call') continue;
      facts.push({
        factId: `doc:${artifact.artifactId}:label:${slug(label.text)}`,
        field: 'other',
        label: label.kind === 'adjoiner'
          ? 'Adjoining owner named on the drawing'
          : label.kind === 'monument'
            ? 'Boundary monument shown on the drawing'
            : 'Drawing annotation',
        value: label.text,
        quoted: label.text,
        inferred: false,
        source: { kind: 'document', label: 'Drawing label', url: null, locator, retrievedAt, officiality: 'unverified' },
        weight,
        // An adjoiner block is about the NEIGHBOUR, whatever page it sits on.
        parcelRelationship: label.aboutSubject ? relationship : 'related_parcel',
      });
    }
  }

  // 4. Pages LandOS could not read: named, never silently absent.
  for (const gap of input.interpretation.unreadable) {
    const artifact = byArtifact.get(gap.artifactId);
    facts.push({
      factId: `doc:${gap.artifactId}:gap`,
      field: 'other',
      label: 'Retained page that could not be interpreted',
      value: `${gap.fileName}: ${gap.reason}`,
      quoted: null,
      inferred: true,
      source: {
        kind: 'document',
        label: 'Retained, not interpreted',
        url: null,
        locator: `Retained, not interpreted (${gap.fileName})`,
        retrievedAt: artifact ? isoFrom(artifact.capturedAt) : null,
        officiality: 'unverified',
      },
      weight: 'unresolved',
      parcelRelationship: 'unresolved_relationship',
    });
  }

  return facts;
}
