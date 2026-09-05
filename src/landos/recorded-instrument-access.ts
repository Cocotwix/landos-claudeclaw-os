// LandOS — legal-access evidence from a recorded instrument LandOS actually read.
//
// A retrieved deed that itself conveys or reserves an ingress/egress easement
// is verified-legal access evidence: it is an official recorded instrument,
// read from the clerk's image, not a listing remark or a map interpretation.
// Nothing here paraphrases the instrument: the statement carried into the
// access ladder is the retained public-record finding text, verbatim, and only
// when that text itself speaks of ingress, egress, access or a right-of-way.
//
// The result is an ordinary provider result persisted through the canonical
// property research store, so the access read model, the Deal Brain and every
// other consumer reach it through the same seam as every other access item.
// Evidence ids are keyed to the instrument, so a rebuild re-asserts the same
// item rather than writing a duplicate.

import type { CanonicalPropertyInput, NormalizedPropertyEvidence, PropertyProviderResult } from './property-intelligence-contract.js';

export const RECORDED_INSTRUMENT_ACCESS_LANE = 'government_records';
export const RECORDED_INSTRUMENT_ACCESS_PROVIDER = 'recorded_instrument';

const ACCESS_LANGUAGE = /\b(ingress|egress|right[- ]of[- ]way|access easement|easement for access|roadway easement|road easement)\b/i;

const clean = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** One recorded instrument's access statement, exactly as retained. */
export interface RecordedInstrumentAccessFinding {
  instrumentNumber: string | null;
  bookPage: string | null;
  recordingDate: string | null;
  instrumentType: string | null;
  authority: string;
  statement: string;
  sourceUrl: string | null;
  documentUrl: string | null;
  retrievedAt: string | null;
}

/**
 * Findings from retained public-record outcomes whose instrument was retrieved
 * and read (`retrieved_yes`) and whose recorded easement/restriction text
 * speaks of access. An index-only outcome, or one whose text names no access
 * right, contributes nothing: absence of a finding is never a finding.
 */
export function recordedInstrumentAccessFindings(
  outcomes: ReadonlyArray<Record<string, unknown>>,
): RecordedInstrumentAccessFinding[] {
  const out: RecordedInstrumentAccessFinding[] = [];
  for (const row of outcomes) {
    if (!/deed|instrument|easement|title/i.test(String(row.category ?? ''))) continue;
    if (String(row.retrieval_status ?? '') !== 'retrieved_yes') continue;
    const facts = (row.facts && typeof row.facts === 'object' ? row.facts : {}) as Record<string, unknown>;
    if (facts.instrumentRetrieved === false) continue;
    const statement = clean(facts.easementsAndRestrictions) ?? clean(facts.accessEasement) ?? clean(facts.easements);
    if (!statement || !ACCESS_LANGUAGE.test(statement)) continue;
    out.push({
      instrumentNumber: clean(facts.instrumentNumber),
      bookPage: clean(facts.bookPage) ?? clean(facts.recordBookPage),
      recordingDate: clean(facts.recordingDate),
      instrumentType: clean(facts.instrumentType),
      authority: clean(row.authority) ?? 'County recorder',
      statement,
      sourceUrl: clean(row.source_url),
      documentUrl: clean(row.document_url),
      retrievedAt: clean(row.searched_at),
    });
  }
  return out;
}

/**
 * The provider result that carries those findings into the canonical research
 * record as `access_evidence.verified_legal.*` items. Returns null when there
 * is nothing to assert, so callers never persist an empty lane.
 */
export function recordedInstrumentAccessResult(
  input: CanonicalPropertyInput,
  findings: ReadonlyArray<RecordedInstrumentAccessFinding>,
  now: string,
): PropertyProviderResult | null {
  if (!findings.length) return null;
  const evidence: NormalizedPropertyEvidence[] = findings.map((finding) => {
    const key = (finding.instrumentNumber ?? finding.bookPage ?? 'instrument').replace(/[^0-9A-Za-z]+/g, '_');
    const reference = [
      finding.instrumentType,
      finding.bookPage ? `OR Book/Page ${finding.bookPage}` : null,
      finding.instrumentNumber ? `Instrument ${finding.instrumentNumber}` : null,
      finding.recordingDate ? `recorded ${finding.recordingDate}` : null,
    ].filter(Boolean).join(', ');
    return {
      id: `access_evidence.verified_legal.recorded_instrument_${key}`,
      propertyCardId: input.propertyCardId,
      dealCardId: input.dealCardId,
      providerId: RECORDED_INSTRUMENT_ACCESS_PROVIDER,
      field: `access_evidence.verified_legal.recorded_instrument_${key}`,
      value: {
        tier: 'verified_legal',
        source_kind: 'official_record',
        basis: 'recorded_instrument',
        weight: 'confirmed',
        statement: finding.statement,
        source_label: `${finding.authority}${reference ? ` — ${reference}` : ''}`,
        source_url: finding.documentUrl ?? finding.sourceUrl,
        observed_at: finding.recordingDate ?? finding.retrievedAt ?? now,
        instrument_number: finding.instrumentNumber,
        book_page: finding.bookPage,
      },
      subjectClassification: 'verified_subject',
      strength: 'official_record',
      sourceUrl: finding.documentUrl ?? finding.sourceUrl,
      retrievedAt: finding.retrievedAt ?? now,
      confidence: 'high',
      kind: 'fact',
      validation: { valid: true, reasons: [] },
    };
  });
  const runId = `government-records:${input.dealCardId}:${evidence.map((item) => item.id).join('|')}`;
  return {
    contractVersion: 'property-provider-v1',
    runId,
    laneId: RECORDED_INSTRUMENT_ACCESS_LANE,
    providerId: RECORDED_INSTRUMENT_ACCESS_PROVIDER,
    input,
    execution: { attempted: true, startedAt: now, completedAt: now, durationMs: 0, result: { findings } },
    validation: {
      valid: true,
      subjectClassification: 'verified_subject',
      checks: [{ check: 'recorded_instrument_read', passed: true, reason: 'The instrument was retrieved and read from the official record; the access statement is its retained finding text.' }],
      rejectedEvidenceIds: [],
    },
    evidence,
    status: 'verified',
    persistence: { attempted: false, persisted: false, retainedEvidenceCount: 0, rejectedEvidenceCount: 0, reason: null },
    failureReason: null,
  };
}
