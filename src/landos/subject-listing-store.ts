// Durable exact-address listing evidence for one canonical Property Card.
//
// This store never creates a Property Card. The caller must supply the existing
// property/deal identity, and the write is refused unless that exact link exists.
// A provider outage or empty revisit is retained as the latest attempt without
// erasing listing evidence captured by an earlier successful visit.

import { resolveCanonicalIdentity } from './canonical-identity.js';
import { getLandosDb } from './db.js';
import {
  mergeRetainedListingRecords,
  projectExactAddressListingEvidence,
  type ExactAddressListingEvidenceView,
  type ExtractedListingEvidence,
} from './exact-address-web-discovery.js';

export interface SubjectListingDiscoveryResult {
  status: ExactAddressListingEvidenceView['status'];
  queries: string[];
  pages: ExtractedListingEvidence[];
  note: string;
}

export interface PersistedSubjectListingDetail {
  contractVersion: 'subject-listing-v1';
  propertyCardId: number;
  dealCardId: number;
  canonicalAddress: string;
  latestAttempt: {
    status: SubjectListingDiscoveryResult['status'];
    queries: string[];
    note: string;
    completedAtIso: string;
    extractedPageCount: number;
  };
  retainedPages: ExtractedListingEvidence[];
  retainedAtIso: string | null;
  /**
   * How this visit changed the retained set. Optional so payloads written
   * before record-level merging existed still parse and keep their evidence.
   */
  retention?: {
    mergedRecordCount: number;
    newRecordCount: number;
    refreshedRecordCount: number;
    preservedRecordCount: number;
    note: string;
  };
  projection: ExactAddressListingEvidenceView;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface SubjectListingWriteResult {
  attempted: true;
  persisted: boolean;
  propertyCardId: number;
  retainedSourceCount: number;
  newlyStoredSourceCount: number;
  reason: string;
}

let ensuredDb: unknown = null;

function ensureTable(): void {
  const db = getLandosDb();
  if (ensuredDb === db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS landos_subject_listing_detail (
      property_card_id INTEGER PRIMARY KEY,
      deal_card_id INTEGER NOT NULL,
      canonical_address TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(property_card_id) REFERENCES landos_property_card(id),
      FOREIGN KEY(deal_card_id) REFERENCES landos_deal_card(id)
    );
    CREATE INDEX IF NOT EXISTS idx_landos_subject_listing_deal
      ON landos_subject_listing_detail(deal_card_id, updated_at DESC);
  `);
  ensuredDb = db;
}

export function resetSubjectListingStoreCache(): void {
  ensuredDb = null;
}

export function parseSubjectListingDetail(value: string | null | undefined): PersistedSubjectListingDetail | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedSubjectListingDetail;
    if (parsed?.contractVersion !== 'subject-listing-v1') return null;
    if (!Number.isInteger(parsed.propertyCardId) || parsed.propertyCardId <= 0) return null;
    if (!Array.isArray(parsed.retainedPages) || !parsed.latestAttempt || !parsed.projection) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadSubjectListingDetail(propertyCardId: number): PersistedSubjectListingDetail | null {
  ensureTable();
  const row = getLandosDb().prepare(
    'SELECT detail_json FROM landos_subject_listing_detail WHERE property_card_id = ?',
  ).get(propertyCardId) as { detail_json?: string } | undefined;
  const detail = parseSubjectListingDetail(row?.detail_json);
  if (!detail) return null;
  // Every reader gets the same segregation. Only a CONFIRMED canonical identity
  // may quarantine a record; an unconfirmed guess must never discard evidence
  // that could still turn out to be the subject.
  const canonical = resolveCanonicalIdentity(detail.dealCardId);
  return reprojectSubjectListingDetail(detail, canonical.confirmed ? canonical.apn : null);
}

/**
 * Re-project retained listing evidence against the canonical parcel.
 *
 * Retention is separate from interpretation. Rows persisted before the
 * stated-parcel segregation existed still hold the neighbouring record, so the
 * READ path re-derives the projection rather than trusting the stored one; no
 * migration, and no retained evidence is destroyed.
 */
export function reprojectSubjectListingDetail(
  detail: PersistedSubjectListingDetail | null,
  canonicalApn: string | null,
): PersistedSubjectListingDetail | null {
  if (!detail || !canonicalApn) return detail;
  const projection = projectExactAddressListingEvidence({
    status: detail.retainedPages.length ? 'retrieved' : detail.latestAttempt.status,
    queries: detail.latestAttempt.queries,
    pages: detail.retainedPages,
    note: detail.projection.note,
  }, { canonicalApn });
  return projection ? { ...detail, projection } : detail;
}

export function saveSubjectListingDetail(input: {
  propertyCardId: number;
  dealCardId: number;
  canonicalAddress: string;
  completedAtIso: string;
  result: SubjectListingDiscoveryResult;
  /** The CONFIRMED canonical APN, when one exists. Segregates same-address other-parcel records. */
  canonicalApn?: string | null;
}): SubjectListingWriteResult {
  ensureTable();
  const db = getLandosDb();
  const linked = db.prepare(`
    SELECT pc.id
    FROM landos_property_card pc
    JOIN landos_deal_card_property dcp ON dcp.card_id = pc.id
    WHERE pc.id = ? AND dcp.deal_card_id = ?
    LIMIT 1
  `).get(input.propertyCardId, input.dealCardId) as { id: number } | undefined;
  if (!linked) {
    return {
      attempted: true,
      persisted: false,
      propertyCardId: input.propertyCardId,
      retainedSourceCount: 0,
      newlyStoredSourceCount: 0,
      reason: 'canonical property/deal link not found; no subject record was created',
    };
  }

  const prior = loadSubjectListingDetail(input.propertyCardId);
  const newlyStored = input.result.status === 'retrieved' && input.result.pages.length > 0
    ? input.result.pages
    : [];
  // Retention MERGES by canonical record identity. A revisit that only returns
  // the stale duplicate refreshes that one record; every other previously
  // retained record survives as secondary evidence rather than being replaced.
  const merge = mergeRetainedListingRecords(prior?.retainedPages ?? [], newlyStored);
  const retainedPages = merge.pages;
  const retainedAtIso = retainedPages
    .map((page) => page.retrievedAt)
    .filter((value): value is string => !!value)
    .sort()
    .pop()
    ?? (newlyStored.length ? input.completedAtIso : prior?.retainedAtIso ?? null);
  const retentionNote = !newlyStored.length
    ? 'Previously retained listing evidence remains available with its original retrieval time.'
    : merge.preservedRecordCount
      ? `${merge.newRecordCount} new and ${merge.refreshedRecordCount} refreshed record(s) were merged; ${merge.preservedRecordCount} previously retained record(s) were preserved as secondary evidence.`
      : `${merge.newRecordCount} new and ${merge.refreshedRecordCount} refreshed record(s) were merged into the retained subject evidence.`;
  const projection = projectExactAddressListingEvidence({
    status: retainedPages.length ? 'retrieved' : input.result.status,
    queries: input.result.queries,
    pages: retainedPages,
    note: `${input.result.note} ${retentionNote}`.trim(),
  }, { canonicalApn: input.canonicalApn ?? null });
  if (!projection) {
    return {
      attempted: true,
      persisted: false,
      propertyCardId: input.propertyCardId,
      retainedSourceCount: prior?.retainedPages.length ?? 0,
      newlyStoredSourceCount: 0,
      reason: 'listing projection could not be created',
    };
  }

  const createdAtIso = prior?.createdAtIso ?? input.completedAtIso;
  const detail: PersistedSubjectListingDetail = {
    contractVersion: 'subject-listing-v1',
    propertyCardId: input.propertyCardId,
    dealCardId: input.dealCardId,
    canonicalAddress: input.canonicalAddress.trim(),
    latestAttempt: {
      status: input.result.status,
      queries: [...input.result.queries],
      note: input.result.note,
      completedAtIso: input.completedAtIso,
      extractedPageCount: input.result.pages.length,
    },
    retainedPages,
    retainedAtIso,
    retention: {
      mergedRecordCount: retainedPages.length,
      newRecordCount: merge.newRecordCount,
      refreshedRecordCount: merge.refreshedRecordCount,
      preservedRecordCount: merge.preservedRecordCount,
      note: retentionNote,
    },
    projection,
    createdAtIso,
    updatedAtIso: input.completedAtIso,
  };

  db.prepare(`
    INSERT INTO landos_subject_listing_detail (
      property_card_id, deal_card_id, canonical_address, detail_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(property_card_id) DO UPDATE SET
      deal_card_id=excluded.deal_card_id,
      canonical_address=excluded.canonical_address,
      detail_json=excluded.detail_json,
      updated_at=excluded.updated_at
  `).run(
    detail.propertyCardId,
    detail.dealCardId,
    detail.canonicalAddress,
    JSON.stringify(detail),
    detail.createdAtIso,
    detail.updatedAtIso,
  );

  return {
    attempted: true,
    persisted: true,
    propertyCardId: input.propertyCardId,
    retainedSourceCount: retainedPages.length,
    newlyStoredSourceCount: newlyStored.length,
    reason: newlyStored.length
      ? `${newlyStored.length} exact-address listing source(s) persisted for the canonical subject; ${retentionNote}`
      : retainedPages.length
        ? 'latest attempt persisted; previously retained subject listing evidence was preserved'
        : 'exact-address attempt persisted; no subject listing evidence was exposed',
  };
}
