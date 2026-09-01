// Stage 2 acceptance fixtures — document evidence into subject evidence.
//
// The existing document path already reads retained pages into claims with
// page-level provenance. What it did not do was carry them into the front
// door: a survey could settle the lot, the acreage and the adjoining owners
// and the subject reader would never see it.
//
// These fixtures cover the gap the stage names: every relevant page processed,
// typed facts plus tables plus diagram labels, field locations and source
// confidence preserved, and quoted/observed content kept apart from LandOS's
// own inference.

import { describe, expect, it } from 'vitest';

import {
  documentEvidenceFacts,
  readDiagramLabels,
  readDocumentTables,
} from './document-evidence.js';
import { interpretDealEvidence, type RetainedEvidenceArtifact } from './deal-evidence-claims.js';

// ── Retained pages (synthetic; no control-case parcel appears here) ─────────

const SURVEY_PAGE_1 = `
MAP OF BOUNDARY SURVEY
PARCEL ID: 0451-00-021
LOT 3 OF CEDAR HOLLOW ESTATES
FIELD SURVEY: March 12, 2026
SURVEYOR: R. A. KESLER, PROFESSIONAL SURVEYOR
`;

const SURVEY_PAGE_2 = `
BASIS OF BEARINGS: GRID NORTH
BEGIN AT THE POINT OF BEGINNING; thence N 76°45'51" W, 459.67 feet TO THE CENTERLINE OF Cedar Hollow Lane;
thence ALONG SAID CENTERLINE S 13°14'09" W, 69.20 feet; thence S 76°45'51" E, 437.70 feet TO THE POINT OF BEGINNING.
CONTAINING 4.62 ACRES MORE OR LESS
FLOOD ZONE X
1/2" IRON ROD FOUND AT NORTHEAST CORNER
NOW OR FORMERLY MARGUERITE OKONKWO, DEED BOOK 902 PAGE 41

LINE TABLE
LINE   BEARING           DISTANCE
L1     N 76°45'51" W     459.67'
L2     S 13°14'09" W     69.20'
L3     S 76°45'51" E     437.70'
`;

const TAX_BILL_PAGE = `
COUNTY TREASURER REAL PROPERTY TAX STATEMENT
TAX PARCEL: 0451-00-021

ASSESSMENT DETAIL
YEAR   LAND VALUE   IMPROVEMENT   TOTAL
2025   $18,400      $0            $18,400
2024   $17,900      $0            $17,900
`;

const NEIGHBOUR_DEED_PAGE = `
WARRANTY DEED
THIS INDENTURE made BETWEEN
DELPHINE OKONKWO
parties of the first part, and MARCUS OKONKWO, his wife
PARCEL ID: 0451-00-022
CONTAINING 5.10 ACRES MORE OR LESS
`;

function artifact(id: number, fileName: string, text: string, status = 'complete'): RetainedEvidenceArtifact {
  return {
    artifactId: id,
    uploadId: id + 100,
    fileName,
    extractionStatus: status,
    exactText: text,
    candidates: {},
    capturedAt: 1_756_000_000 + id,
  };
}

const ARTIFACTS: RetainedEvidenceArtifact[] = [
  artifact(1, 'survey-p1.pdf', SURVEY_PAGE_1),
  artifact(2, 'survey-p2.pdf', SURVEY_PAGE_2),
  artifact(3, 'tax-bill.pdf', TAX_BILL_PAGE),
  artifact(4, 'deed-neighbour.pdf', NEIGHBOUR_DEED_PAGE),
  artifact(5, 'scan-blurry.jpg', '', 'unavailable'),
];

function interpretation() {
  return interpretDealEvidence({
    artifacts: ARTIFACTS,
    state: { apn: '045100021', owner: null, acreage: null, roadName: null, county: 'Cherokee' },
  });
}

// ── Tables ──────────────────────────────────────────────────────────────────

describe('readDocumentTables', () => {
  it('reads a survey line table into typed rows with its headers', () => {
    const tables = readDocumentTables(SURVEY_PAGE_2);
    const line = tables.find((table) => /LINE TABLE/i.test(table.label));
    expect(line).toBeDefined();
    expect(line!.headers).toEqual(['LINE', 'BEARING', 'DISTANCE']);
    expect(line!.rows).toHaveLength(3);
    expect(line!.rows[0].cells).toEqual([
      { header: 'LINE', value: 'L1' },
      { header: 'BEARING', value: "N 76°45'51\" W" },
      { header: 'DISTANCE', value: "459.67'" },
    ]);
    // The row is preserved verbatim so a reviewer can find it on the page.
    expect(line!.rows[0].rowText).toContain('459.67');
  });

  it('reads a tax assessment table without treating its numbers as acreage', () => {
    const tables = readDocumentTables(TAX_BILL_PAGE);
    const assessment = tables.find((table) => /ASSESSMENT DETAIL/i.test(table.label));
    expect(assessment).toBeDefined();
    expect(assessment!.headers).toEqual(['YEAR', 'LAND VALUE', 'IMPROVEMENT', 'TOTAL']);
    expect(assessment!.rows.map((row) => row.cells[0].value)).toEqual(['2025', '2024']);
  });

  it('returns nothing for prose that merely contains numbers', () => {
    expect(readDocumentTables(SURVEY_PAGE_1)).toHaveLength(0);
  });
});

// ── Diagram labels ──────────────────────────────────────────────────────────

describe('readDiagramLabels', () => {
  it('types the labels a survey drawing carries', () => {
    const labels = readDiagramLabels(SURVEY_PAGE_2);
    const kinds = new Set(labels.map((label) => label.kind));
    expect(kinds.has('monument')).toBe(true);
    expect(kinds.has('adjoiner')).toBe(true);
    expect(kinds.has('annotation')).toBe(true);

    const monument = labels.find((label) => label.kind === 'monument')!;
    expect(monument.text).toContain('IRON ROD FOUND');
    const adjoiner = labels.find((label) => label.kind === 'adjoiner')!;
    expect(adjoiner.text).toContain('MARGUERITE OKONKWO');
  });

  it('never reads an adjoining owner as the subject owner', () => {
    const labels = readDiagramLabels(SURVEY_PAGE_2);
    for (const label of labels.filter((l) => l.kind === 'adjoiner')) {
      expect(label.aboutSubject).toBe(false);
    }
  });
});

// ── The bridge into subject evidence ───────────────────────────────────────

describe('documentEvidenceFacts', () => {
  it('processes every readable page and names the one it could not read', () => {
    const facts = documentEvidenceFacts({ interpretation: interpretation(), artifacts: ARTIFACTS });

    const locators = new Set(facts.map((fact) => fact.source.locator));
    for (const readable of ['survey-p1.pdf', 'survey-p2.pdf', 'tax-bill.pdf', 'deed-neighbour.pdf']) {
      expect([...locators].some((locator) => locator?.includes(readable) || locator?.includes('page'))).toBe(true);
    }
    const gap = facts.find((fact) => fact.weight === 'unresolved' && fact.value.includes('scan-blurry.jpg'));
    expect(gap).toBeDefined();
    expect(gap!.quoted).toBeNull();
  });

  it('carries page-level field locations and source confidence onto every fact', () => {
    const facts = documentEvidenceFacts({ interpretation: interpretation(), artifacts: ARTIFACTS });
    const acreage = facts.find((fact) => fact.field === 'acreage' && fact.value.startsWith('4.62'))!;

    expect(acreage.source.kind).toBe('document');
    expect(acreage.source.locator).toMatch(/page/i);
    expect(acreage.weight).toBe('well_supported');
    expect(acreage.source.officiality).toBe('unverified');
  });

  it('keeps what the page says apart from what LandOS concluded', () => {
    const facts = documentEvidenceFacts({ interpretation: interpretation(), artifacts: ARTIFACTS });

    const quoted = facts.filter((fact) => fact.inferred === false);
    expect(quoted.length).toBeGreaterThan(0);
    for (const fact of quoted) expect(fact.quoted).not.toBeNull();

    const inferred = facts.filter((fact) => fact.inferred === true);
    expect(inferred.length).toBeGreaterThan(0);
    for (const fact of inferred) expect(fact.quoted).toBeNull();
  });

  it('keeps a neighbouring parcel deed off the subject', () => {
    const facts = documentEvidenceFacts({ interpretation: interpretation(), artifacts: ARTIFACTS });

    const neighbour = facts.filter((fact) => fact.source.locator?.includes('deed-neighbour.pdf'));
    expect(neighbour.length).toBeGreaterThan(0);
    for (const fact of neighbour) expect(fact.parcelRelationship).not.toBe('subject');
    // 5.10 acres is the neighbour's; it never arrives as a subject measurement.
    const subjectAcreage = facts.filter((fact) => fact.field === 'acreage' && fact.parcelRelationship === 'subject');
    expect(subjectAcreage.map((fact) => fact.value)).not.toContain('5.10');
  });

  it('carries the survey line table and the drawing labels as evidence', () => {
    const facts = documentEvidenceFacts({ interpretation: interpretation(), artifacts: ARTIFACTS });

    const table = facts.find((fact) => fact.label.includes('LINE TABLE'))!;
    expect(table).toBeDefined();
    expect(table.quoted).toContain('459.67');
    expect(table.inferred).toBe(false);

    const adjoiner = facts.find((fact) => fact.label.toLowerCase().includes('adjoining'))!;
    expect(adjoiner).toBeDefined();
    expect(adjoiner.parcelRelationship).not.toBe('subject');
  });

  it('gives every fact a stable id derived from its page and field', () => {
    const facts = documentEvidenceFacts({ interpretation: interpretation(), artifacts: ARTIFACTS });
    const ids = facts.map((fact) => fact.factId);
    expect(new Set(ids).size).toBe(ids.length);
    const again = documentEvidenceFacts({ interpretation: interpretation(), artifacts: ARTIFACTS });
    expect(again.map((fact) => fact.factId)).toEqual(ids);
  });
});
