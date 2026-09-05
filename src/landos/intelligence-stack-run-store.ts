// Durable authority for coordinated Intelligence Stack runs.
//
// The in-memory AbortController is only a transport convenience. This table is
// the source of truth for whether a run may still publish evidence or a current
// intelligence read. Cancelling, superseding, timing out, or restarting first
// revokes authority here; every guarded writer checks this row in the same DB
// transaction as its write.

import { getLandosDb } from './db.js';
import { finishRunProgress, type IntelligenceRunProgress } from './intelligence-run-progress.js';
import { ANALYST_JUDGMENT_TIMEOUT_MS } from './acquisition-analyst.js';

export type IntelligenceStackRunStatus = 'running' | 'complete' | 'failed' | 'cancelled' | 'superseded';

export interface IntelligenceStackRunRecord {
  runId: string;
  dealCardId: number;
  sequence: number;
  status: IntelligenceStackRunStatus;
  authoritative: boolean;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  progress: IntelligenceRunProgress;
  error: string | null;
  cancelRequested: boolean;
}

let ensuredDb: unknown = null;
const PROCESS_STARTED_AT = new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString();

/** Idle cutoff for reclaiming a run. Derived from the longest single
 *  specialist call so a slow but healthy run is never mistaken for an
 *  abandoned one, with slack for the surrounding stage work. */
export const ABANDONED_RUN_IDLE_MS = ANALYST_JUDGMENT_TIMEOUT_MS + 10 * 60_000;

/**
 * May THIS process revoke Intelligence runs as ownerless?
 *
 * The no-owner rule compares a run's `started_at` with this process's start
 * time, which is only meaningful in the process that owns the runs: the
 * managed runtime (launched with `--landos-runtime-id=`). Any other process
 * that registers the routes against the operating store — a test runner, a
 * QA gate, a script — would fail every live run the runtime is still working
 * on, and the runtime's late decision and Development Path writes were then
 * rejected as "no longer authoritative". An isolated QA store or a test
 * database holds nothing the runtime owns, so those are free to reclaim.
 */
export function processOwnsIntelligenceRuns(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (argv.some((arg) => arg.startsWith('--landos-runtime-id='))) return true;
  if (env.LANDOS_STORAGE_MODE === 'qa') return true;
  return env.NODE_ENV === 'test';
}

function ensureTable(): void {
  const db = getLandosDb();
  if (ensuredDb === db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS landos_intelligence_stack_run (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL UNIQUE,
      deal_card_id INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      status TEXT NOT NULL,
      authoritative INTEGER NOT NULL DEFAULT 1,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      progress_json TEXT NOT NULL,
      error TEXT,
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      UNIQUE(deal_card_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_landos_intel_stack_run_deal
      ON landos_intelligence_stack_run(deal_card_id, sequence DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_landos_intel_stack_one_authoritative
      ON landos_intelligence_stack_run(deal_card_id)
      WHERE authoritative = 1;
  `);
  ensuredDb = db;
}

function parseProgress(value: unknown): IntelligenceRunProgress | null {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value) as IntelligenceRunProgress; } catch { return null; }
}

function fromRow(row: unknown): IntelligenceStackRunRecord | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const progress = parseProgress(record.progress_json);
  if (!progress) return null;
  return {
    runId: String(record.run_id),
    dealCardId: Number(record.deal_card_id),
    sequence: Number(record.sequence),
    status: String(record.status) as IntelligenceStackRunStatus,
    authoritative: Number(record.authoritative) === 1,
    startedAt: String(record.started_at),
    updatedAt: String(record.updated_at),
    completedAt: record.completed_at == null ? null : String(record.completed_at),
    progress,
    error: record.error == null ? null : String(record.error),
    cancelRequested: Number(record.cancel_requested) === 1,
  };
}

export class IntelligenceStackRunStore {
  create(input: { runId: string; dealCardId: number; startedAt: string; progress: IntelligenceRunProgress }): IntelligenceStackRunRecord {
    ensureTable();
    const db = getLandosDb();
    const now = new Date().toISOString();
    const sequence = Number((db.prepare(
      'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM landos_intelligence_stack_run WHERE deal_card_id=?',
    ).get(input.dealCardId) as { sequence: number }).sequence);
    const create = db.transaction(() => {
      db.prepare(`
        UPDATE landos_intelligence_stack_run
        SET status='superseded', authoritative=0, completed_at=?, updated_at=?,
            error=COALESCE(error, 'Superseded by a newer Intelligence run.')
        WHERE deal_card_id=? AND authoritative=1
      `).run(now, now, input.dealCardId);
      db.prepare(`
        INSERT INTO landos_intelligence_stack_run
          (run_id, deal_card_id, sequence, status, authoritative, started_at, updated_at, progress_json)
        VALUES (?, ?, ?, 'running', 1, ?, ?, ?)
      `).run(input.runId, input.dealCardId, sequence, input.startedAt, now, JSON.stringify(input.progress));
    });
    create();
    return this.get(input.runId)!;
  }

  get(runId: string): IntelligenceStackRunRecord | null {
    ensureTable();
    return fromRow(getLandosDb().prepare('SELECT * FROM landos_intelligence_stack_run WHERE run_id=?').get(runId));
  }

  latest(dealCardId: number): IntelligenceStackRunRecord | null {
    ensureTable();
    return fromRow(getLandosDb().prepare(
      'SELECT * FROM landos_intelligence_stack_run WHERE deal_card_id=? ORDER BY sequence DESC LIMIT 1',
    ).get(dealCardId));
  }

  active(dealCardId: number): IntelligenceStackRunRecord | null {
    ensureTable();
    return fromRow(getLandosDb().prepare(`
      SELECT * FROM landos_intelligence_stack_run
      WHERE deal_card_id=? AND status='running' AND authoritative=1
      ORDER BY sequence DESC LIMIT 1
    `).get(dealCardId));
  }

  isAuthoritative(runId: string, dealCardId?: number): boolean {
    ensureTable();
    const row = getLandosDb().prepare(`
      SELECT 1 AS ok FROM landos_intelligence_stack_run
      WHERE run_id=? AND status='running' AND authoritative=1
        AND (? IS NULL OR deal_card_id=?)
    `).get(runId, dealCardId ?? null, dealCardId ?? null) as { ok: number } | undefined;
    return row?.ok === 1;
  }

  updateProgress(runId: string, dealCardId: number, progress: IntelligenceRunProgress): boolean {
    ensureTable();
    const result = getLandosDb().prepare(`
      UPDATE landos_intelligence_stack_run SET progress_json=?, updated_at=?
      WHERE run_id=? AND deal_card_id=? AND status='running' AND authoritative=1
    `).run(JSON.stringify(progress), new Date().toISOString(), runId, dealCardId);
    return Number(result.changes) === 1;
  }

  finish(input: {
    runId: string;
    dealCardId: number;
    status: 'complete' | 'failed';
    progress: IntelligenceRunProgress;
    error?: string | null;
  }): boolean {
    ensureTable();
    const now = new Date().toISOString();
    const result = getLandosDb().prepare(`
      UPDATE landos_intelligence_stack_run
      SET status=?, authoritative=0, completed_at=?, updated_at=?, progress_json=?, error=?
      WHERE run_id=? AND deal_card_id=? AND status='running' AND authoritative=1
    `).run(input.status, now, now, JSON.stringify(input.progress), input.error ?? null, input.runId, input.dealCardId);
    return Number(result.changes) === 1;
  }

  cancel(runId: string, dealCardId: number, progress: IntelligenceRunProgress, reason = 'Stopped by Operator.'): boolean {
    ensureTable();
    const now = new Date().toISOString();
    const result = getLandosDb().prepare(`
      UPDATE landos_intelligence_stack_run
      SET status='cancelled', authoritative=0, cancel_requested=1,
          completed_at=?, updated_at=?, progress_json=?, error=?
      WHERE run_id=? AND deal_card_id=? AND status='running' AND authoritative=1
    `).run(now, now, JSON.stringify(progress), reason, runId, dealCardId);
    return Number(result.changes) === 1;
  }

  /**
   * Revoke work no process can still own, or work that stopped moving.
   *
   * THE IDLE CUTOFF MUST EXCEED THE LONGEST UNIT OF WORK IT SUPERVISES. A run
   * only touches `updated_at` when a STAGE changes, and one specialist call is
   * allowed up to `ANALYST_JUDGMENT_TIMEOUT_MS` (20 minutes). With a 20-minute
   * cutoff a perfectly healthy run sitting inside a single slow market review
   * was reclaimed as ownerless and told to re-run — which is what happened to
   * controlled QA Card 128, whose decision artifact could then never be
   * produced. The cutoff is now derived from that timeout with slack, so the
   * two can never silently drift back into a race.
   *
   * The genuine no-owner signal is unchanged: a run whose `started_at` precedes
   * this process cannot be owned by it, whatever its heartbeat says.
   */
  reclaimAbandoned(olderThanMs = ABANDONED_RUN_IDLE_MS, nowMs = Date.now(), processStartedAt = PROCESS_STARTED_AT): number {
    ensureTable();
    const now = new Date(nowMs).toISOString();
    const cutoff = new Date(nowMs - olderThanMs).toISOString();
    const result = getLandosDb().prepare(`
      UPDATE landos_intelligence_stack_run
      SET status='failed', authoritative=0, completed_at=?, updated_at=?,
          error='The Intelligence run no longer has an active owner. Re-run it to continue.'
      WHERE status='running' AND authoritative=1
        AND (started_at < ? OR updated_at < ?)
    `).run(now, now, processStartedAt, cutoff);
    const changed = Number(result.changes);
    if (changed > 0) {
      const rows = getLandosDb().prepare(`
        SELECT run_id, progress_json, error FROM landos_intelligence_stack_run
        WHERE status='failed' AND updated_at=?
      `).all(now) as Array<{ run_id: string; progress_json: string; error: string }>;
      const update = getLandosDb().prepare('UPDATE landos_intelligence_stack_run SET progress_json=? WHERE run_id=?');
      const settle = getLandosDb().transaction(() => {
        for (const row of rows) {
          const progress = parseProgress(row.progress_json);
          if (progress?.status === 'running') {
            update.run(JSON.stringify(finishRunProgress(progress, { error: row.error }, now)), row.run_id);
          }
        }
      });
      settle();
    }
    return changed;
  }

  deleteForDealCard(dealCardId: number): number {
    ensureTable();
    return Number(getLandosDb().prepare('DELETE FROM landos_intelligence_stack_run WHERE deal_card_id=?').run(dealCardId).changes);
  }
}

/** Transaction-local guard used by evidence and current-read writers. */
export function authoritativeIntelligenceRunSql(): string {
  ensureTable();
  return `EXISTS (
    SELECT 1 FROM landos_intelligence_stack_run r
    WHERE r.run_id=? AND r.deal_card_id=? AND r.status='running' AND r.authoritative=1
  )`;
}

export function resetIntelligenceStackRunStoreCache(): void { ensuredDb = null; }
