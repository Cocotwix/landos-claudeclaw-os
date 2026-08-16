// LandOS — the REGULATION DOCUMENT SET a government publishes, learned once.
//
// A jurisdiction's adopted subdivision regulations are a property of the
// GOVERNMENT, not of a Deal Card: Fairview publishes the same nine articles
// whichever parcel is being researched. Discovery of them, however, went
// through a keyless web search, and a search returns a different slice of the
// same set every time it runs. Live runs on one parcel returned Articles 1+4,
// then Article 2, then Article 1 alone, then nothing — four different answers
// to a question whose answer had not changed.
//
// So the set is retained here, keyed by the government that adopted it, and the
// next run fetches those URLs directly instead of asking a search engine to
// find them again. That is the whole purpose of this table: discover once,
// verify, reuse, and never let the ordering of a result page decide which rules
// the operator sees.
//
// Only a document that was actually OPENED and read as this jurisdiction's own
// regulations is written. A URL that failed is not recorded as an absence: a
// document that could not be reached today is not a document that does not
// exist, and recording it as one would suppress the next attempt.
//
// Public routing metadata only. No property data, no seller data, no secrets.

import { getLandosDb, landosAudit } from './db.js';
import { jurisdictionKey } from './official-site-store.js';
import type { LandUseAuthorityLevel } from './controlling-land-use-authority.js';

/** The kinds of regulation set LandOS retains. One today, named explicitly. */
export type RegulationDocumentKind = 'subdivision_regulations';

/** The government whose set this is. Its NAME, never the parcel's city. */
export interface RegulationJurisdiction {
  /** The controlling authority's own name, e.g. "Fairview". */
  authorityName: string;
  level: LandUseAuthorityLevel;
  state: string;
}

export interface RetainedRegulationDocument {
  url: string;
  label: string;
  adoptedOrAsOf: string | null;
  draftOrProposed: boolean;
  /** How many rules this document yielded when it was last read. */
  ruleCount: number;
  lastVerifiedAt: number;
}

interface Row {
  url: string;
  label: string;
  adopted_or_as_of: string | null;
  draft_or_proposed: number;
  rule_count: number;
  last_verified_at: number;
}

/**
 * A county and a city inside it share a name constantly, and they adopt
 * DIFFERENT subdivision regulations. Keeping them in separate buckets is what
 * stops a county rule set from being served as a town's own.
 */
function unitBucket(level: LandUseAuthorityLevel): string {
  return level === 'county' ? 'county' : level === 'state' ? 'state' : 'local';
}

function keyFor(jurisdiction: RegulationJurisdiction): { state: string; key: string; bucket: string } | null {
  const key = jurisdictionKey(jurisdiction.authorityName ?? '');
  const state = (jurisdiction.state ?? '').trim().toUpperCase();
  if (!key || !state) return null;
  return { state, key, bucket: unitBucket(jurisdiction.level) };
}

/**
 * The retained set, in a STABLE order.
 *
 * Ordered by URL rather than by insertion, because a set read back in a
 * different order is a set that merges its rules in a different order, which is
 * the same non-determinism this table exists to remove.
 */
export function readRegulationDocuments(
  jurisdiction: RegulationJurisdiction,
  kind: RegulationDocumentKind = 'subdivision_regulations',
): RetainedRegulationDocument[] {
  const target = keyFor(jurisdiction);
  if (!target) return [];
  const rows = getLandosDb().prepare(`
    SELECT url, label, adopted_or_as_of, draft_or_proposed, rule_count, last_verified_at
    FROM landos_regulation_document
    WHERE state = ? AND jurisdiction_key = ? AND unit_type = ? AND doc_kind = ?
    ORDER BY url
  `).all(target.state, target.key, target.bucket, kind) as Row[];
  return rows.filter((row) => row.url).map((row) => ({
    url: row.url,
    label: row.label,
    adoptedOrAsOf: row.adopted_or_as_of,
    draftOrProposed: row.draft_or_proposed === 1,
    ruleCount: row.rule_count,
    lastVerifiedAt: row.last_verified_at,
  }));
}

export interface SaveRegulationDocumentInput {
  url: string;
  label: string;
  adoptedOrAsOf?: string | null;
  draftOrProposed?: boolean;
  ruleCount?: number;
}

/**
 * Record the documents this run actually read as the jurisdiction's own.
 *
 * An upsert, so a re-read refreshes the label, the adoption date and the
 * verification time without ever removing a part of the set that a later run
 * happened not to reach.
 */
export function saveRegulationDocuments(
  jurisdiction: RegulationJurisdiction,
  documents: readonly SaveRegulationDocumentInput[],
  kind: RegulationDocumentKind = 'subdivision_regulations',
  actor = 'land-use',
): number {
  const target = keyFor(jurisdiction);
  if (!target) return 0;
  const rows = documents.filter((document) => /^https?:\/\//i.test(document.url ?? ''));
  if (!rows.length) return 0;

  const db = getLandosDb();
  const insert = db.prepare(`
    INSERT INTO landos_regulation_document (
      state, jurisdiction_key, unit_type, jurisdiction, doc_kind,
      url, label, adopted_or_as_of, draft_or_proposed, rule_count, last_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(state, jurisdiction_key, unit_type, doc_kind, url) DO UPDATE SET
      jurisdiction=excluded.jurisdiction, label=excluded.label,
      adopted_or_as_of=excluded.adopted_or_as_of,
      draft_or_proposed=excluded.draft_or_proposed,
      rule_count=excluded.rule_count,
      last_verified_at=excluded.last_verified_at
  `);
  const now = Math.floor(Date.now() / 1000);
  const write = db.transaction((batch: readonly SaveRegulationDocumentInput[]) => {
    for (const document of batch) {
      insert.run(
        target.state, target.key, target.bucket, jurisdiction.authorityName, kind,
        document.url, (document.label || document.url).slice(0, 300),
        document.adoptedOrAsOf ?? null,
        document.draftOrProposed ? 1 : 0,
        Math.max(0, document.ruleCount ?? 0),
        now,
      );
    }
  });
  write(rows);
  landosAudit(
    actor,
    'regulation_document_set_learned',
    `${jurisdiction.authorityName}, ${target.state}: ${rows.length} ${kind.replace(/_/g, ' ')} document(s)`,
    { refTable: 'landos_regulation_document' },
  );
  return rows.length;
}
