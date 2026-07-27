// Property Intelligence run store — durable parent mission + specialist records.
//
// Persistence rules this store enforces:
//   • A run belongs to exactly ONE Deal Card. Every read and write is keyed by
//     deal_card_id, so a snapshot can never leak onto another card.
//   • Snapshots are versioned per Deal Card with a monotonic sequence. Exactly
//     one row per card is primary — always the newest completed run.
//   • A rerun creates a NEW sequence. Prior snapshots stay readable as history;
//     nothing is overwritten in place, so accepted evidence survives.
//   • Specialist task records live beside the parent run so the operator sees
//     per-specialist status, classified failure, and timing while it runs.
//   • Secrets never enter the store: every payload passes the redactor first.
//
// Additive schema only. No destructive migration.

import { getLandosDb } from './db.js';
import type { PropertyIntelligenceSnapshot, SnapshotSpecialistRecord, SnapshotStatus } from './property-intelligence-snapshot.js';
import type { SpecialistId, SpecialistStatus } from './property-intelligence-specialists.js';
import type { FailureCategory } from '../failure-classification.js';

const SENSITIVE_KEY = /password|secret|token|cookie|credential|authorization|api.?key|verification.?code|recovery.?link/i;
// Only SECRET-bearing query parameters are redacted. A bare `key=` is NOT a
// secret: LandOS's own asset routes use it to name a retained screenshot
// (`/api/landos/inspection/image?cardId=32&key=parcel_page`). Blanket-redacting
// it silently broke every retained image URL in a stored snapshot, so no
// evidence screenshot could load. Secret-shaped key names still redact.
const SENSITIVE_QUERY = /([?&](?:password|secret|token|cookie|credential|authorization|code|api[-_]?key|access[-_]?key|secret[-_]?key|private[-_]?key)=)[^&]*/ig;

export function redactPropertyIntelligence(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string') return value.replace(SENSITIVE_QUERY, '$1[redacted]');
  if (Array.isArray(value)) return value.map((item) => redactPropertyIntelligence(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [childKey, redactPropertyIntelligence(childValue, childKey)]),
    );
  }
  return value;
}

let ensured = false;

/**
 * When THIS process started.
 *
 * A run that began before this process did cannot be executing inside it — the
 * process that owned it is gone. That is a fact, not a heuristic, so such a run
 * is reclaimed immediately instead of waiting out an elapsed-time window. Without
 * it, a restart mid-run leaves the Deal Card refusing new launches ("a mission is
 * already running") for up to half an hour, against a mission nothing is running.
 */
const PROCESS_STARTED_AT = new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString();

function ensureTables(): void {
  if (ensured) return;
  getLandosDb().exec(`
    CREATE TABLE IF NOT EXISTS landos_property_intelligence_run (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL UNIQUE,
      deal_card_id INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      snapshot_json TEXT,
      error TEXT,
      failure_category TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(deal_card_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_landos_pi_run_deal
      ON landos_property_intelligence_run(deal_card_id, sequence DESC);
    CREATE INDEX IF NOT EXISTS idx_landos_pi_run_primary
      ON landos_property_intelligence_run(deal_card_id, is_primary);

    CREATE TABLE IF NOT EXISTS landos_property_intelligence_specialist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      deal_card_id INTEGER NOT NULL,
      specialist_id TEXT NOT NULL,
      label TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      failure_category TEXT,
      failure_message TEXT,
      retryable INTEGER NOT NULL DEFAULT 0,
      evidence_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      completed_at TEXT,
      duration_ms INTEGER,
      result_json TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(run_id, specialist_id)
    );
    CREATE INDEX IF NOT EXISTS idx_landos_pi_specialist_run
      ON landos_property_intelligence_specialist(run_id);
    CREATE INDEX IF NOT EXISTS idx_landos_pi_specialist_deal
      ON landos_property_intelligence_specialist(deal_card_id, updated_at DESC);
  `);
  ensured = true;
}

/** Test seam: force the next call to re-run the additive DDL. */
export function resetPropertyIntelligenceStoreCache(): void {
  ensured = false;
}

export interface PropertyIntelligenceRunRow {
  runId: string;
  dealCardId: number;
  sequence: number;
  status: SnapshotStatus;
  trigger: string;
  isPrimary: boolean;
  startedAt: string;
  completedAt: string | null;
  snapshot: PropertyIntelligenceSnapshot | null;
  error: string | null;
  failureCategory: FailureCategory | null;
  updatedAt: string;
}

export interface SpecialistRow extends SnapshotSpecialistRecord {
  runId: string;
  dealCardId: number;
  /** Structured contribution the synthesis stage reads. Redacted on write. */
  result: unknown;
}

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function runFromRow(row: unknown): PropertyIntelligenceRunRow | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  return {
    runId: String(record.run_id),
    dealCardId: Number(record.deal_card_id),
    sequence: Number(record.sequence),
    status: String(record.status) as SnapshotStatus,
    trigger: String(record.trigger ?? 'operator'),
    isPrimary: Number(record.is_primary) === 1,
    startedAt: String(record.started_at),
    completedAt: record.completed_at == null ? null : String(record.completed_at),
    snapshot: parseJson<PropertyIntelligenceSnapshot>(record.snapshot_json),
    error: record.error == null ? null : String(record.error),
    failureCategory: record.failure_category == null ? null : String(record.failure_category) as FailureCategory,
    updatedAt: String(record.updated_at),
  };
}

function specialistFromRow(row: unknown): SpecialistRow | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  return {
    runId: String(record.run_id),
    dealCardId: Number(record.deal_card_id),
    id: String(record.specialist_id) as SpecialistId,
    label: String(record.label),
    role: String(record.role) as 'required' | 'supporting',
    status: String(record.status) as SpecialistStatus,
    summary: String(record.summary ?? ''),
    failureCategory: record.failure_category == null ? null : String(record.failure_category) as FailureCategory,
    failureMessage: record.failure_message == null ? null : String(record.failure_message),
    retryable: Number(record.retryable) === 1,
    evidenceCount: Number(record.evidence_count ?? 0),
    startedAt: record.started_at == null ? null : String(record.started_at),
    completedAt: record.completed_at == null ? null : String(record.completed_at),
    durationMs: record.duration_ms == null ? null : Number(record.duration_ms),
    result: parseJson<unknown>(record.result_json),
  };
}

export class PropertyIntelligenceStore {
  /** Next sequence number for a Deal Card. Sequences never reuse a value. */
  nextSequence(dealCardId: number): number {
    ensureTables();
    const row = getLandosDb()
      .prepare('SELECT MAX(sequence) AS maxSeq FROM landos_property_intelligence_run WHERE deal_card_id = ?')
      .get(dealCardId) as { maxSeq?: number | null } | undefined;
    return Number(row?.maxSeq ?? 0) + 1;
  }

  /** Open a new parent run. Does NOT touch the current primary snapshot: the
   *  previous result stays visible and authoritative until this one completes. */
  createRun(input: {
    runId: string;
    dealCardId: number;
    trigger: string;
    startedAt: string;
    specialists: SnapshotSpecialistRecord[];
  }): PropertyIntelligenceRunRow {
    if (!Number.isInteger(input.dealCardId) || input.dealCardId < 1) {
      throw new Error('A valid Deal Card is required to start Property Intelligence.');
    }
    ensureTables();
    const db = getLandosDb();
    const now = new Date().toISOString();
    const sequence = this.nextSequence(input.dealCardId);
    db.prepare(`
      INSERT INTO landos_property_intelligence_run
        (run_id, deal_card_id, sequence, status, trigger, is_primary, started_at, completed_at, snapshot_json, error, failure_category, updated_at)
      VALUES (?, ?, ?, 'running', ?, 0, ?, NULL, NULL, NULL, NULL, ?)
    `).run(input.runId, input.dealCardId, sequence, input.trigger, input.startedAt, now);

    const insertSpecialist = db.prepare(`
      INSERT INTO landos_property_intelligence_specialist
        (run_id, deal_card_id, specialist_id, label, role, status, summary, failure_category, failure_message,
         retryable, evidence_count, started_at, completed_at, duration_ms, result_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 0, NULL, NULL, NULL, NULL, ?)
    `);
    const seed = db.transaction((records: SnapshotSpecialistRecord[]) => {
      for (const record of records) {
        insertSpecialist.run(input.runId, input.dealCardId, record.id, record.label, record.role, record.status, record.summary, now);
      }
    });
    seed(input.specialists);

    return {
      runId: input.runId,
      dealCardId: input.dealCardId,
      sequence,
      status: 'running',
      trigger: input.trigger,
      isPrimary: false,
      startedAt: input.startedAt,
      completedAt: null,
      snapshot: null,
      error: null,
      failureCategory: null,
      updatedAt: now,
    };
  }

  updateSpecialist(input: {
    runId: string;
    specialistId: SpecialistId;
    status: SpecialistStatus;
    summary?: string;
    failureCategory?: FailureCategory | null;
    failureMessage?: string | null;
    retryable?: boolean;
    evidenceCount?: number;
    startedAt?: string | null;
    completedAt?: string | null;
    durationMs?: number | null;
    result?: unknown;
  }): void {
    ensureTables();
    const now = new Date().toISOString();
    const resultJson = input.result === undefined
      ? null
      : JSON.stringify(redactPropertyIntelligence(input.result));
    getLandosDb().prepare(`
      UPDATE landos_property_intelligence_specialist SET
        status = ?,
        summary = COALESCE(?, summary),
        failure_category = ?,
        failure_message = ?,
        retryable = ?,
        evidence_count = COALESCE(?, evidence_count),
        started_at = COALESCE(?, started_at),
        completed_at = COALESCE(?, completed_at),
        duration_ms = COALESCE(?, duration_ms),
        result_json = COALESCE(?, result_json),
        updated_at = ?
      WHERE run_id = ? AND specialist_id = ?
    `).run(
      input.status,
      input.summary ?? null,
      input.failureCategory ?? null,
      input.failureMessage ?? null,
      input.retryable ? 1 : 0,
      input.evidenceCount ?? null,
      input.startedAt ?? null,
      input.completedAt ?? null,
      input.durationMs ?? null,
      resultJson,
      now,
      input.runId,
      input.specialistId,
    );
  }

  listSpecialists(runId: string): SpecialistRow[] {
    ensureTables();
    const rows = getLandosDb()
      .prepare('SELECT * FROM landos_property_intelligence_specialist WHERE run_id = ? ORDER BY id ASC')
      .all(runId) as unknown[];
    return rows.map(specialistFromRow).filter((row): row is SpecialistRow => row != null);
  }

  /**
   * Finish a run and, when it produced a usable snapshot, promote it to primary
   * for its Deal Card. Promotion is a single transaction scoped to that card, so
   * no other Deal Card's primary snapshot is touched.
   */
  completeRun(input: {
    runId: string;
    dealCardId: number;
    status: SnapshotStatus;
    completedAt: string;
    snapshot: PropertyIntelligenceSnapshot | null;
    error?: string | null;
    failureCategory?: FailureCategory | null;
  }): void {
    ensureTables();
    const db = getLandosDb();
    const now = new Date().toISOString();
    // A run that produced a snapshot becomes the primary read, even when it
    // completed with gaps: gaps are reported, not hidden behind a stale success.
    const usable = input.snapshot != null && input.status !== 'failed';
    // An OLDER attempt may never override a newer accepted snapshot. Two runs can
    // overlap (a slow one started first, a re-run finished first); without this
    // guard the straggler would demote the newer result simply by finishing last.
    // It is still recorded in full and stays readable as history.
    const newer = usable
      ? (db.prepare(`
          SELECT MAX(sequence) AS seq FROM landos_property_intelligence_run
          WHERE deal_card_id = ? AND run_id <> ? AND snapshot_json IS NOT NULL AND status <> 'failed'
        `).get(input.dealCardId, input.runId) as { seq?: number | null } | undefined)?.seq ?? null
      : null;
    const thisSequence = (db.prepare('SELECT sequence FROM landos_property_intelligence_run WHERE run_id = ?')
      .get(input.runId) as { sequence?: number } | undefined)?.sequence ?? 0;
    const promote = usable && (newer == null || Number(thisSequence) >= Number(newer));
    const snapshotJson = input.snapshot == null
      ? null
      : JSON.stringify(redactPropertyIntelligence({ ...input.snapshot, isPrimary: promote }));

    const apply = db.transaction(() => {
      if (promote) {
        db.prepare('UPDATE landos_property_intelligence_run SET is_primary = 0, updated_at = ? WHERE deal_card_id = ?')
          .run(now, input.dealCardId);
      }
      db.prepare(`
        UPDATE landos_property_intelligence_run SET
          status = ?, completed_at = ?, snapshot_json = ?, error = ?, failure_category = ?, is_primary = ?, updated_at = ?
        WHERE run_id = ? AND deal_card_id = ?
      `).run(
        input.status,
        input.completedAt,
        snapshotJson,
        input.error ?? null,
        input.failureCategory ?? null,
        promote ? 1 : 0,
        now,
        input.runId,
        input.dealCardId,
      );
    });
    apply();
  }

  getRun(runId: string): PropertyIntelligenceRunRow | null {
    ensureTables();
    return runFromRow(getLandosDb().prepare('SELECT * FROM landos_property_intelligence_run WHERE run_id = ?').get(runId));
  }

  /** The snapshot the Deal Card shows. Newest promoted run wins. */
  primaryRun(dealCardId: number): PropertyIntelligenceRunRow | null {
    ensureTables();
    const row = getLandosDb().prepare(`
      SELECT * FROM landos_property_intelligence_run
      WHERE deal_card_id = ? AND is_primary = 1
      ORDER BY sequence DESC LIMIT 1
    `).get(dealCardId);
    return runFromRow(row);
  }

  /** The most recent run of any status — used for live progress. */
  latestRun(dealCardId: number): PropertyIntelligenceRunRow | null {
    ensureTables();
    const row = getLandosDb().prepare(`
      SELECT * FROM landos_property_intelligence_run
      WHERE deal_card_id = ? ORDER BY sequence DESC LIMIT 1
    `).get(dealCardId);
    return runFromRow(row);
  }

  /** A run that is still in flight for this card, if any. */
  activeRun(dealCardId: number): PropertyIntelligenceRunRow | null {
    ensureTables();
    const row = getLandosDb().prepare(`
      SELECT * FROM landos_property_intelligence_run
      WHERE deal_card_id = ? AND status = 'running'
      ORDER BY sequence DESC LIMIT 1
    `).get(dealCardId);
    return runFromRow(row);
  }

  history(dealCardId: number, limit = 10): PropertyIntelligenceRunRow[] {
    ensureTables();
    const rows = getLandosDb().prepare(`
      SELECT * FROM landos_property_intelligence_run
      WHERE deal_card_id = ? ORDER BY sequence DESC LIMIT ?
    `).all(dealCardId, Math.max(1, Math.min(50, limit))) as unknown[];
    return rows.map(runFromRow).filter((row): row is PropertyIntelligenceRunRow => row != null);
  }

  /**
   * Release a run left `running` by a process that died. Restart-safe.
   *
   * Staleness means NOTHING HAS MOVED, not "started a while ago". A run whose
   * specialists are still settling is making progress however long it has been
   * going, and killing it on elapsed time alone would abort a healthy mission
   * mid-flight — this read runs on every operator poll, so it would abort it
   * reliably. A genuinely dead run stops updating its specialists and is still
   * reclaimed on the same window.
   */
  reclaimStaleRuns(olderThanMs = 30 * 60_000, nowMs = Date.now(), processStartedAt = PROCESS_STARTED_AT): number {
    ensureTables();
    const cutoff = new Date(nowMs - olderThanMs).toISOString();
    const result = getLandosDb().prepare(`
      UPDATE landos_property_intelligence_run
      SET status = 'failed',
          error = 'The Property Intelligence mission did not finish before the service restarted. Re-run it to continue.',
          failure_category = 'crash',
          completed_at = ?,
          updated_at = ?
      WHERE status = 'running'
        AND (
          -- Orphaned by a restart: nothing in this process can be running it.
          started_at < ?
          -- Or genuinely stalled: nothing about it has moved inside the window.
          OR (
            started_at < ?
            AND updated_at < ?
            AND NOT EXISTS (
              SELECT 1 FROM landos_property_intelligence_specialist s
              WHERE s.run_id = landos_property_intelligence_run.run_id AND s.updated_at >= ?
            )
          )
        )
    `).run(new Date(nowMs).toISOString(), new Date(nowMs).toISOString(), processStartedAt, cutoff, cutoff, cutoff);
    const changed = Number(result.changes ?? 0);
    if (changed > 0) {
      getLandosDb().prepare(`
        UPDATE landos_property_intelligence_specialist
        SET status = 'failed',
            failure_category = 'crash',
            failure_message = 'Interrupted by a service restart.',
            retryable = 1,
            updated_at = ?
        WHERE status IN ('queued', 'running')
          AND run_id IN (SELECT run_id FROM landos_property_intelligence_run WHERE status = 'failed' AND failure_category = 'crash')
      `).run(new Date(nowMs).toISOString());
    }
    return changed;
  }

  /** Remove every run for a Deal Card. Used only by acceptance cleanup. */
  deleteForDealCard(dealCardId: number): number {
    ensureTables();
    const db = getLandosDb();
    const remove = db.transaction(() => {
      db.prepare('DELETE FROM landos_property_intelligence_specialist WHERE deal_card_id = ?').run(dealCardId);
      return db.prepare('DELETE FROM landos_property_intelligence_run WHERE deal_card_id = ?').run(dealCardId);
    });
    return Number(remove().changes ?? 0);
  }
}
