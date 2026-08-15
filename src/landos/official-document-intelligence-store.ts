// LandOS — DURABLE official-document intelligence.
//
// Findings mined from an official document, and the detailed summary composed
// from them, are written to the evidence model LandOS already has. No new
// table, no second persistence architecture:
//
//   granular findings  →  landos_property_evidence_item
//                         domain 'official_document', collector 'official_document_context'
//                         append-only by trigger; UNIQUE(idempotency_key) is the dedup
//
//   detailed summary   →  landos_deal_intelligence_snapshot
//                         snapshot_type 'official_document_summary_v1:<documentKey>'
//                         UNIQUE(deal_card_id, input_hash) is the dedup;
//                         one `current` row per document, priors superseded
//
// Why these two and not something new: the evidence table already carries every
// field a finding needs — deal card, identity version, category, raw and
// normalized value, source name and URL, source tier, verification status,
// confidence, collector, retrieval time, an artifact reference and a unique
// idempotency key — and it is append-only, which is exactly the retention rule
// evidence should have. The snapshot table already models "one current derived
// read per deal per type, superseded rather than overwritten, deduplicated by
// input hash", which is exactly what a document summary is. `domain` and
// `snapshot_type` are free text, so both are reached without touching db.ts.
//
// Nothing here can move canonical identity. It writes to the evidence and
// snapshot tables only; the property card and the identity version are read,
// never written.

import { createHash } from 'node:crypto';

import { getLandosDb, landosAudit } from './db.js';
import { readCurrentPropertyIdentity } from './property-summary-slice.js';
import type { DiscoveredContextFinding, DiscoveredContextResult } from './official-document-context.js';
import type { OfficialDocumentSummary } from './official-document-summary.js';

export const OFFICIAL_DOCUMENT_DOMAIN = 'official_document';
export const OFFICIAL_DOCUMENT_COLLECTOR = 'official_document_context';
export const OFFICIAL_DOCUMENT_SUMMARY_TYPE = 'official_document_summary_v1';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const stableJson = (value: unknown): string => JSON.stringify(value ?? null);

/** Stable identity for a source document, independent of its content. */
export function documentKeyFor(sourceUrl: string): string {
  return sha256(sourceUrl.trim().toLowerCase()).slice(0, 16);
}

/** Content identity. A changed document produces a different key and a new
 *  retrieval, rather than silently overwriting what was read before. */
export function documentContentHash(text: string): string {
  return sha256(text).slice(0, 32);
}

export interface PersistedDocumentFinding {
  evidenceId: number;
  dealCardId: number;
  propertyIdentityVersionId: number;
  category: string;
  value: string | null;
  context: string;
  sourceUrl: string | null;
  sourceTitle: string;
  page: number | null;
  pageBasis: string;
  sourceClassification: string;
  matchedBy: string;
  confidence: string;
  documentKey: string;
  contentHash: string;
  retrievedAt: string;
  minedAt: string | null;
}

export interface PersistDocumentIntelligenceInput {
  dealCardId: number;
  context: DiscoveredContextResult;
  summary: OfficialDocumentSummary;
  documentText: string;
  sourceTitle?: string | null;
  actor?: string;
  minedAt?: string;
}

export interface PersistDocumentIntelligenceResult {
  persisted: boolean;
  propertyIdentityVersionId: number | null;
  documentKey: string;
  contentHash: string;
  evidenceIds: number[];
  /** Findings that were already stored from an earlier pass over this document. */
  duplicateFindings: number;
  summarySnapshotId: number | null;
  summaryReused: boolean;
  skippedReason: string | null;
}

/**
 * Write the findings and the summary durably.
 *
 * Requires a current property identity version, because evidence in LandOS is
 * always evidence ABOUT an identified property — that FK is the thing that
 * stops a finding from floating free of the parcel it describes. Without one,
 * nothing is written and the reason is returned rather than swallowed.
 */
export function persistDocumentIntelligence(input: PersistDocumentIntelligenceInput): PersistDocumentIntelligenceResult {
  const documentKey = documentKeyFor(input.context.sourceUrl);
  const contentHash = documentContentHash(input.documentText);
  const identity = readCurrentPropertyIdentity(input.dealCardId);
  const base: PersistDocumentIntelligenceResult = {
    persisted: false,
    propertyIdentityVersionId: identity?.id ?? null,
    documentKey,
    contentHash,
    evidenceIds: [],
    duplicateFindings: 0,
    summarySnapshotId: null,
    summaryReused: false,
    skippedReason: null,
  };
  if (!identity) {
    return { ...base, skippedReason: 'No current property identity version exists for this Deal Card, so document evidence has nothing to attach to.' };
  }

  const db = getLandosDb();
  const actor = input.actor ?? OFFICIAL_DOCUMENT_COLLECTOR;
  const minedAt = input.minedAt ?? new Date().toISOString();
  const sourceTitle = (input.sourceTitle ?? input.summary.sourceTitle ?? input.context.sourceUrl).slice(0, 300);
  const evidenceIds: number[] = [];
  let duplicates = 0;

  const insertFinding = db.prepare(`
    INSERT OR IGNORE INTO landos_property_evidence_item (
      deal_card_id, property_identity_version_id, domain, evidence_kind, fact_key,
      raw_value_json, normalized_value_json, source_name, source_url, source_tier,
      verification_status, confidence, collector_key, retrieved_at, effective_at,
      artifact_ref, idempotency_key
    ) VALUES (?, ?, ?, 'document_finding', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findExisting = db.prepare('SELECT id FROM landos_property_evidence_item WHERE idempotency_key=?');

  const writeFindings = db.transaction((findings: DiscoveredContextFinding[]) => {
    for (const finding of findings) {
      // Dedup key: same document CONTENT, same category, same value, same page,
      // same anchor. A re-run over an unchanged document writes nothing; a
      // genuinely changed document has a different contentHash and appends.
      const idempotencyKey = `${OFFICIAL_DOCUMENT_DOMAIN}:${identity.id}:${contentHash}:${finding.category}:${finding.page ?? 'na'}:${sha256(`${finding.value ?? ''}|${finding.context}`).slice(0, 16)}`;
      const outcome = insertFinding.run(
        input.dealCardId,
        identity.id,
        OFFICIAL_DOCUMENT_DOMAIN,
        finding.category,
        stableJson({ value: finding.value, context: finding.context, matchedBy: finding.matchedBy }),
        stableJson({
          category: finding.category,
          value: finding.value,
          page: finding.page,
          pageBasis: finding.pageBasis,
          matchedBy: finding.matchedBy,
          documentKey,
          contentHash,
          minedAt,
        }),
        sourceTitle,
        finding.sourceUrl,
        finding.sourceClassification,
        // A document finding is retained evidence about an identified property.
        // It is never a verification of that property's identity.
        'retained_not_identity_verifying',
        finding.confidence,
        OFFICIAL_DOCUMENT_COLLECTOR,
        finding.retrievedAt,
        minedAt,
        `${documentKey}:${contentHash}:p${finding.page ?? 0}`,
        idempotencyKey,
      );
      if (outcome.changes > 0) {
        evidenceIds.push(outcome.lastInsertRowid as number);
      } else {
        duplicates += 1;
        const existing = findExisting.get(idempotencyKey) as { id: number } | undefined;
        if (existing) evidenceIds.push(existing.id);
      }
    }
  });
  writeFindings(input.context.findings);

  // ── The summary snapshot ─────────────────────────────────────────────────
  const snapshotType = `${OFFICIAL_DOCUMENT_SUMMARY_TYPE}:${documentKey}`;
  const summaryRecord: OfficialDocumentSummary = {
    ...input.summary,
    dealCardId: input.dealCardId,
    propertyIdentityVersionId: identity.id,
    evidenceRefs: evidenceIds,
  };
  const inputHash = sha256(stableJson({
    identityVersionId: identity.id,
    documentKey,
    contentHash,
    detailedSummary: summaryRecord.detailedSummary,
    keyFindings: summaryRecord.keyFindings,
  }));

  const existingSnapshot = db.prepare(
    'SELECT id FROM landos_deal_intelligence_snapshot WHERE deal_card_id=? AND input_hash=?',
  ).get(input.dealCardId, inputHash) as { id: number } | undefined;

  let summarySnapshotId: number;
  let summaryReused = false;
  if (existingSnapshot) {
    summarySnapshotId = existingSnapshot.id;
    summaryReused = true;
  } else {
    summarySnapshotId = db.transaction(() => {
      const prior = db.prepare(`
        SELECT id FROM landos_deal_intelligence_snapshot
        WHERE deal_card_id=? AND snapshot_type=? AND status='current' LIMIT 1
      `).get(input.dealCardId, snapshotType) as { id: number } | undefined;
      const nextVersion = (db.prepare(`
        SELECT COALESCE(MAX(version), 0) + 1 AS version FROM landos_deal_intelligence_snapshot WHERE deal_card_id=?
      `).get(input.dealCardId) as { version: number }).version;
      if (prior) db.prepare("UPDATE landos_deal_intelligence_snapshot SET status='superseded' WHERE id=?").run(prior.id);
      const result = db.prepare(`
        INSERT INTO landos_deal_intelligence_snapshot (
          deal_card_id, version, property_identity_version_id, prior_snapshot_id,
          snapshot_type, status, input_hash, evidence_max_id, completeness_json,
          summary_json, change_reason, generated_by
        ) VALUES (?, ?, ?, ?, ?, 'current', ?, ?, ?, ?, ?, ?)
      `).run(
        input.dealCardId,
        nextVersion,
        identity.id,
        prior?.id ?? null,
        snapshotType,
        inputHash,
        evidenceIds.length ? Math.max(...evidenceIds) : null,
        stableJson({
          findingCount: summaryRecord.keyFindings.length,
          pagesReferenced: summaryRecord.pagesReferenced,
          textLayer: input.context.textLayer,
          pagesScanned: input.context.pagesScanned,
          skippedForOtherParcel: input.context.skippedForOtherParcel,
          limitations: summaryRecord.limitations,
        }),
        stableJson(summaryRecord),
        prior
          ? `The source document changed; a new detailed summary supersedes the prior one for ${summaryRecord.sourceUrl}.`
          : `Detailed subject-specific summary composed from ${summaryRecord.keyFindings.length} retained finding(s) in ${summaryRecord.sourceUrl}.`,
        actor,
      );
      return result.lastInsertRowid as number;
    })();
    landosAudit(actor, 'official_document_summary_persisted', `deal ${input.dealCardId}: ${summaryRecord.sourceUrl}`, {
      refTable: 'landos_deal_intelligence_snapshot',
      refId: summarySnapshotId,
    });
  }

  return {
    ...base,
    persisted: true,
    propertyIdentityVersionId: identity.id,
    evidenceIds,
    duplicateFindings: duplicates,
    summarySnapshotId,
    summaryReused,
  };
}

// ── Reading it back, without the document ──────────────────────────────────

interface EvidenceRow {
  id: number;
  deal_card_id: number;
  property_identity_version_id: number;
  fact_key: string | null;
  raw_value_json: string;
  normalized_value_json: string;
  source_name: string;
  source_url: string | null;
  source_tier: string;
  confidence: string;
  retrieved_at: string;
  effective_at: string | null;
}

function findingFromRow(row: EvidenceRow): PersistedDocumentFinding {
  const raw = JSON.parse(row.raw_value_json || 'null') as { value?: string | null; context?: string; matchedBy?: string } | null;
  const normalized = JSON.parse(row.normalized_value_json || 'null') as {
    page?: number | null; pageBasis?: string; documentKey?: string; contentHash?: string; minedAt?: string;
  } | null;
  return {
    evidenceId: row.id,
    dealCardId: row.deal_card_id,
    propertyIdentityVersionId: row.property_identity_version_id,
    category: row.fact_key ?? 'unknown',
    value: raw?.value ?? null,
    context: raw?.context ?? '',
    sourceUrl: row.source_url,
    sourceTitle: row.source_name,
    page: normalized?.page ?? null,
    pageBasis: normalized?.pageBasis ?? 'approximate_content_stream_order',
    sourceClassification: row.source_tier,
    matchedBy: raw?.matchedBy ?? '',
    confidence: row.confidence,
    documentKey: normalized?.documentKey ?? '',
    contentHash: normalized?.contentHash ?? '',
    retrievedAt: row.retrieved_at,
    minedAt: row.effective_at,
  };
}

export interface DocumentIntelligenceReadModel {
  dealCardId: number;
  findings: PersistedDocumentFinding[];
  summaries: OfficialDocumentSummary[];
  /** Documents LandOS holds intelligence for, without holding the bytes. */
  documents: Array<{ documentKey: string; sourceUrl: string; sourceTitle: string | null; findingCount: number; retrievedAt: string }>;
}

/**
 * Everything LandOS knows from official documents about this Deal Card.
 *
 * A pure SELECT. No network, no filesystem, no PDF — a later session, a
 * restarted process, or a downstream system reads this and never touches the
 * original source again.
 */
export function readDocumentIntelligence(dealCardId: number): DocumentIntelligenceReadModel {
  const db = getLandosDb();
  const rows = db.prepare(`
    SELECT id, deal_card_id, property_identity_version_id, fact_key, raw_value_json, normalized_value_json,
           source_name, source_url, source_tier, confidence, retrieved_at, effective_at
    FROM landos_property_evidence_item
    WHERE deal_card_id=? AND domain=? AND collector_key=?
    ORDER BY id
  `).all(dealCardId, OFFICIAL_DOCUMENT_DOMAIN, OFFICIAL_DOCUMENT_COLLECTOR) as EvidenceRow[];
  const findings = rows.map(findingFromRow);

  const summaryRows = db.prepare(`
    SELECT summary_json FROM landos_deal_intelligence_snapshot
    WHERE deal_card_id=? AND snapshot_type LIKE ? AND status='current'
    ORDER BY version
  `).all(dealCardId, `${OFFICIAL_DOCUMENT_SUMMARY_TYPE}:%`) as Array<{ summary_json: string }>;
  const summaries = summaryRows
    .map((row) => { try { return JSON.parse(row.summary_json) as OfficialDocumentSummary; } catch { return null; } })
    .filter((row): row is OfficialDocumentSummary => !!row);

  const documents = new Map<string, { documentKey: string; sourceUrl: string; sourceTitle: string | null; findingCount: number; retrievedAt: string }>();
  for (const finding of findings) {
    const key = finding.documentKey || finding.sourceUrl || '';
    const existing = documents.get(key);
    if (existing) existing.findingCount += 1;
    else documents.set(key, { documentKey: finding.documentKey, sourceUrl: finding.sourceUrl ?? '', sourceTitle: finding.sourceTitle, findingCount: 1, retrievedAt: finding.retrievedAt });
  }

  return { dealCardId, findings, summaries, documents: [...documents.values()] };
}

/** Superseded summaries, retained as history. */
export function readDocumentSummaryHistory(dealCardId: number): OfficialDocumentSummary[] {
  const rows = getLandosDb().prepare(`
    SELECT summary_json FROM landos_deal_intelligence_snapshot
    WHERE deal_card_id=? AND snapshot_type LIKE ? AND status='superseded'
    ORDER BY version
  `).all(dealCardId, `${OFFICIAL_DOCUMENT_SUMMARY_TYPE}:%`) as Array<{ summary_json: string }>;
  return rows
    .map((row) => { try { return JSON.parse(row.summary_json) as OfficialDocumentSummary; } catch { return null; } })
    .filter((row): row is OfficialDocumentSummary => !!row);
}
