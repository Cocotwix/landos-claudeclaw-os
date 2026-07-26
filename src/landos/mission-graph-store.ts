// Durable parent/child mission persistence for the native mission graph.
//
// Persistence rules this store enforces:
//   • A mission belongs to exactly ONE scope row (scope + scope_id). Every read
//     and write is keyed by it, so one Deal Card's mission can never leak onto
//     another card.
//   • Missions are versioned per scope with a monotonic sequence. A re-run
//     creates a NEW sequence; prior missions stay readable. Nothing is
//     overwritten in place, so accepted results survive.
//   • A child is CLAIMED atomically before it runs. Two workers can never run
//     the same child, and the claim is what makes children independent.
//   • A parent may only be completed once every child has settled. The store
//     refuses to record a completion while a child is still queued or running.
//   • Secrets never enter the store: every handback passes the redactor first.
//
// Additive schema only. No destructive migration.

import { getLandosDb } from './db.js';
import { redactPropertyIntelligence } from './property-intelligence-store.js';
import {
  isTerminalMissionChildStatus,
  type MissionChildSpec,
  type MissionChildState,
  type MissionChildStatus,
  type MissionJoin,
  type MissionStatus,
} from './mission-graph.js';

let ensured = false;

function ensureTables(): void {
  if (ensured) return;
  getLandosDb().exec(`
    CREATE TABLE IF NOT EXISTS landos_mission (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      scope TEXT NOT NULL,
      scope_id INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      outcome TEXT,
      join_json TEXT,
      error TEXT,
      failure_category TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(kind, scope, scope_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_landos_mission_scope
      ON landos_mission(kind, scope, scope_id, sequence DESC);
    CREATE INDEX IF NOT EXISTS idx_landos_mission_status
      ON landos_mission(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS landos_mission_child (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      scope_id INTEGER NOT NULL,
      child_key TEXT NOT NULL,
      label TEXT NOT NULL,
      purpose TEXT NOT NULL,
      role TEXT NOT NULL,
      depends_on TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      failure_category TEXT,
      failure_message TEXT,
      retryable INTEGER NOT NULL DEFAULT 0,
      result_json TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      completed_at TEXT,
      duration_ms INTEGER,
      updated_at TEXT NOT NULL,
      UNIQUE(mission_id, child_key)
    );
    CREATE INDEX IF NOT EXISTS idx_landos_mission_child_mission
      ON landos_mission_child(mission_id);
    CREATE INDEX IF NOT EXISTS idx_landos_mission_child_scope
      ON landos_mission_child(scope, scope_id, updated_at DESC);
  `);
  ensured = true;
}

/** Test seam: force the next call to re-run the additive DDL. */
export function resetMissionGraphStoreCache(): void {
  ensured = false;
}

export interface MissionRow {
  missionId: string;
  kind: string;
  scope: string;
  scopeId: number;
  sequence: number;
  status: MissionStatus;
  trigger: string;
  outcome: string | null;
  join: MissionJoin | null;
  error: string | null;
  failureCategory: string | null;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
}

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function missionFromRow(row: unknown): MissionRow | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  return {
    missionId: String(record.mission_id),
    kind: String(record.kind),
    scope: String(record.scope),
    scopeId: Number(record.scope_id),
    sequence: Number(record.sequence),
    status: String(record.status) as MissionStatus,
    trigger: String(record.trigger),
    outcome: record.outcome == null ? null : String(record.outcome),
    join: parseJson<MissionJoin>(record.join_json),
    error: record.error == null ? null : String(record.error),
    failureCategory: record.failure_category == null ? null : String(record.failure_category),
    startedAt: String(record.started_at),
    completedAt: record.completed_at == null ? null : String(record.completed_at),
    updatedAt: String(record.updated_at),
  };
}

function childFromRow(row: unknown): MissionChildState | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  return {
    key: String(record.child_key),
    label: String(record.label),
    purpose: String(record.purpose),
    role: String(record.role) === 'supporting' ? 'supporting' : 'required',
    dependsOn: parseJson<string[]>(record.depends_on) ?? [],
    status: String(record.status) as MissionChildStatus,
    summary: String(record.summary ?? ''),
    failureCategory: record.failure_category == null ? null : String(record.failure_category),
    failureMessage: record.failure_message == null ? null : String(record.failure_message),
    retryable: Number(record.retryable) === 1,
    result: parseJson<unknown>(record.result_json),
    startedAt: record.started_at == null ? null : String(record.started_at),
    completedAt: record.completed_at == null ? null : String(record.completed_at),
    durationMs: record.duration_ms == null ? null : Number(record.duration_ms),
    attempt: Number(record.attempt ?? 0),
  };
}

export class MissionGraphStore {
  constructor() {
    ensureTables();
  }

  private get db() {
    ensureTables();
    return getLandosDb();
  }

  /**
   * Create the parent mission and every child row in ONE transaction, so a
   * mission can never exist with a partial set of children.
   */
  createMission(input: {
    missionId: string;
    kind: string;
    scope: string;
    scopeId: number;
    trigger: string;
    startedAt: string;
    children: MissionChildSpec[];
  }): { sequence: number } {
    const db = this.db;
    const create = db.transaction(() => {
      const previous = db
        .prepare('SELECT MAX(sequence) AS seq FROM landos_mission WHERE kind = ? AND scope = ? AND scope_id = ?')
        .get(input.kind, input.scope, input.scopeId) as { seq: number | null } | undefined;
      const sequence = (previous?.seq ?? 0) + 1;

      db.prepare(
        `INSERT INTO landos_mission (mission_id, kind, scope, scope_id, sequence, status, trigger, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
      ).run(input.missionId, input.kind, input.scope, input.scopeId, sequence, input.trigger, input.startedAt, input.startedAt);

      const insertChild = db.prepare(
        `INSERT INTO landos_mission_child
           (mission_id, scope, scope_id, child_key, label, purpose, role, depends_on, status, summary, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
      );
      for (const spec of input.children) {
        insertChild.run(
          input.missionId,
          input.scope,
          input.scopeId,
          spec.key,
          spec.label,
          spec.purpose,
          spec.role,
          JSON.stringify(spec.dependsOn),
          spec.purpose,
          input.startedAt,
        );
      }
      return { sequence };
    });
    return create.immediate();
  }

  getMission(missionId: string): MissionRow | null {
    return missionFromRow(this.db.prepare('SELECT * FROM landos_mission WHERE mission_id = ?').get(missionId));
  }

  /** The in-flight mission for this scope, if one exists. */
  activeMission(kind: string, scope: string, scopeId: number): MissionRow | null {
    return missionFromRow(
      this.db
        .prepare(
          `SELECT * FROM landos_mission
           WHERE kind = ? AND scope = ? AND scope_id = ? AND status = 'running'
           ORDER BY sequence DESC LIMIT 1`,
        )
        .get(kind, scope, scopeId),
    );
  }

  latestMission(kind: string, scope: string, scopeId: number): MissionRow | null {
    return missionFromRow(
      this.db
        .prepare(
          `SELECT * FROM landos_mission
           WHERE kind = ? AND scope = ? AND scope_id = ?
           ORDER BY sequence DESC LIMIT 1`,
        )
        .get(kind, scope, scopeId),
    );
  }

  listMissions(kind: string, scope: string, scopeId: number, limit = 10): MissionRow[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM landos_mission
           WHERE kind = ? AND scope = ? AND scope_id = ?
           ORDER BY sequence DESC LIMIT ?`,
        )
        .all(kind, scope, scopeId, limit) as unknown[]
    )
      .map(missionFromRow)
      .filter((row): row is MissionRow => !!row);
  }

  listChildren(missionId: string): MissionChildState[] {
    return (
      this.db
        .prepare('SELECT * FROM landos_mission_child WHERE mission_id = ? ORDER BY id ASC')
        .all(missionId) as unknown[]
    )
      .map(childFromRow)
      .filter((row): row is MissionChildState => !!row);
  }

  /**
   * Atomically claim a queued child for execution.
   *
   * Returns false when the child is not claimable — it is already running, has
   * already settled, or does not exist. This is what lets children run
   * independently without two workers duplicating one lane.
   *
   * BEGIN IMMEDIATE (not DEFERRED) for the same reason claimNextMissionTask
   * uses it: a read lock that must upgrade to a write lock fails SQLITE_BUSY
   * immediately and does not honor busy_timeout.
   */
  claimChild(missionId: string, childKey: string, startedAt: string): boolean {
    const db = this.db;
    const claim = db.transaction(() => {
      const result = db
        .prepare(
          `UPDATE landos_mission_child
           SET status = 'running', started_at = ?, attempt = attempt + 1, updated_at = ?
           WHERE mission_id = ? AND child_key = ? AND status = 'queued'`,
        )
        .run(startedAt, startedAt, missionId, childKey);
      return result.changes > 0;
    });
    return claim.immediate();
  }

  /** Record a child's terminal state and its structured handback. */
  settleChild(input: {
    missionId: string;
    childKey: string;
    status: MissionChildStatus;
    summary: string;
    result?: unknown;
    failureCategory?: string | null;
    failureMessage?: string | null;
    retryable?: boolean;
    completedAt: string;
    durationMs?: number | null;
  }): void {
    const resultJson =
      input.result === undefined || input.result === null
        ? null
        : JSON.stringify(redactPropertyIntelligence(input.result));
    this.db
      .prepare(
        `UPDATE landos_mission_child
         SET status = ?, summary = ?, result_json = ?, failure_category = ?, failure_message = ?,
             retryable = ?, completed_at = ?, duration_ms = ?, updated_at = ?
         WHERE mission_id = ? AND child_key = ?`,
      )
      .run(
        input.status,
        input.summary,
        resultJson,
        input.failureCategory ?? null,
        input.failureMessage ?? null,
        input.retryable ? 1 : 0,
        input.completedAt,
        input.durationMs ?? null,
        input.completedAt,
        input.missionId,
        input.childKey,
      );
  }

  /**
   * Complete the parent mission.
   *
   * REFUSED while any child is still queued or running. The join is the only
   * thing that may declare a mission finished, and it may only do so once every
   * child has reached a terminal state.
   */
  completeMission(input: {
    missionId: string;
    status: MissionStatus;
    outcome: string;
    join: MissionJoin;
    completedAt: string;
    error?: string | null;
    failureCategory?: string | null;
  }): { completed: boolean; reason?: string } {
    const outstanding = this.listChildren(input.missionId).filter(
      (child) => !isTerminalMissionChildStatus(child.status),
    );
    if (outstanding.length > 0) {
      return {
        completed: false,
        reason: `Cannot complete: ${outstanding.map((child) => `${child.label} (${child.status})`).join(', ')} still outstanding.`,
      };
    }
    this.db
      .prepare(
        `UPDATE landos_mission
         SET status = ?, outcome = ?, join_json = ?, error = ?, failure_category = ?, completed_at = ?, updated_at = ?
         WHERE mission_id = ?`,
      )
      .run(
        input.status,
        input.outcome,
        JSON.stringify(redactPropertyIntelligence(input.join)),
        input.error ?? null,
        input.failureCategory ?? null,
        input.completedAt,
        input.completedAt,
        input.missionId,
      );
    return { completed: true };
  }

  /**
   * Abandon a parent mission that could not be joined at all (the orchestration
   * itself threw). Every non-terminal child is settled as failed first, so the
   * mission never leaves a child stranded in `running`.
   */
  abandonMission(input: {
    missionId: string;
    error: string;
    failureCategory: string | null;
    completedAt: string;
    join: MissionJoin | null;
    outcome: string;
  }): void {
    const db = this.db;
    db.prepare(
      `UPDATE landos_mission_child
       SET status = 'failed', failure_category = COALESCE(failure_category, ?), failure_message = COALESCE(failure_message, ?),
           summary = ?, completed_at = ?, updated_at = ?
       WHERE mission_id = ? AND status IN ('queued', 'running')`,
    ).run(
      input.failureCategory,
      input.error,
      'The parent mission failed before this child could settle.',
      input.completedAt,
      input.completedAt,
      input.missionId,
    );
    db.prepare(
      `UPDATE landos_mission
       SET status = 'failed', outcome = ?, join_json = ?, error = ?, failure_category = ?, completed_at = ?, updated_at = ?
       WHERE mission_id = ?`,
    ).run(
      input.outcome,
      input.join ? JSON.stringify(redactPropertyIntelligence(input.join)) : null,
      input.error,
      input.failureCategory,
      input.completedAt,
      input.completedAt,
      input.missionId,
    );
  }

  /**
   * Restart recovery. A mission left `running` by a process that died is not
   * resumable in place, so it is closed honestly as failed rather than shown to
   * the operator as though it were still making progress.
   */
  reclaimStaleMissions(olderThanMs = 30 * 60 * 1000, nowMs = Date.now()): number {
    const cutoff = new Date(nowMs - olderThanMs).toISOString();
    const db = this.db;
    const stale = db
      .prepare(`SELECT mission_id FROM landos_mission WHERE status = 'running' AND updated_at < ?`)
      .all(cutoff) as Array<{ mission_id: string }>;
    if (stale.length === 0) return 0;
    const completedAt = new Date(nowMs).toISOString();
    for (const row of stale) {
      this.abandonMission({
        missionId: row.mission_id,
        error: 'The mission was interrupted before it finished and cannot be resumed in place.',
        failureCategory: 'interrupted',
        completedAt,
        join: null,
        outcome: 'Interrupted: this mission did not finish and no result was joined. Re-run it to produce a result.',
      });
    }
    return stale.length;
  }
}
