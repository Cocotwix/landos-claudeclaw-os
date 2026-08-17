// LandOS Development Control Spine -- Vertical Slice 1.
//
// This module owns the smallest durable development lifecycle:
// task -> attempt -> evidence -> verification -> pending acceptance ->
// exact Git acceptance, or durable failure knowledge. It is deliberately
// separate from store/landos.db and from provider session/runtime artifacts.

import { createHash, randomUUID } from 'node:crypto';
import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { git, gitStatusText, runCheck, failureEvidence } from '../dev/verify.mjs';

export const CONTROL_DB_PATH = 'landos/control/landos-control.db';
export const LEGACY_CONTROL_DB_PATH = '.landos/control/landos-control.db';
export const STATE_PATH = '.landos/STATE.md';
export const DEFAULT_AUTHORITY_REF = 'main';
export const SCHEMA_VERSION = 9;

export const TASK_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'CANDIDATE',
  'ACCEPTANCE_PENDING',
  'ACCEPTED',
  'FAILED',
  'BLOCKED',
];

export const ATTEMPT_STATUSES = [
  'IN_PROGRESS',
  'CANDIDATE',
  'VERIFIED',
  'ACCEPTANCE_PENDING',
  'ACCEPTED',
  'FAILED',
];

function nowIso(now) {
  return (now ?? (() => new Date().toISOString()))();
}

function required(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function normalizedSha(value, label = 'Git SHA') {
  const sha = required(value, label).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`${label} must be an exact 40-character commit SHA`);
  return sha;
}

export function resolveControlDatabasePath(root, override) {
  if (override) return path.resolve(override);
  const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], root);
  if (commonDir.status !== 0) {
    throw new Error(`cannot resolve the Git common directory for ${path.resolve(root)}`);
  }
  return path.join(path.resolve(commonDir.stdout.trim()), CONTROL_DB_PATH);
}

function registeredWorktrees(root) {
  const result = git(['worktree', 'list', '--porcelain'], root);
  if (result.status !== 0) throw new Error('cannot enumerate registered Git worktrees');
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => path.resolve(line.slice('worktree '.length)));
}

function adoptLegacyDatabase(root, file) {
  if (existsSync(file)) return;
  const legacyFiles = registeredWorktrees(root)
    .map((worktree) => path.join(worktree, LEGACY_CONTROL_DB_PATH))
    .filter((candidate) => existsSync(candidate));
  if (legacyFiles.length > 1) {
    throw new Error(
      `multiple legacy Development Control databases exist; resolve them before continuing: ${legacyFiles.join(', ')}`,
    );
  }
  if (legacyFiles.length === 0) return;
  const source = legacyFiles[0];
  const sidecars = [`${source}-wal`, `${source}-shm`].filter((candidate) => existsSync(candidate));
  if (sidecars.length) {
    throw new Error(
      `legacy Development Control database has live SQLite sidecars; close its writer before adoption: ${sidecars.join(', ')}`,
    );
  }
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    copyFileSync(source, file, fsConstants.COPYFILE_EXCL);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
}

function schemaVersion(db) {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'control_meta'").get();
  if (!table) return null;
  const raw = db.prepare("SELECT value FROM control_meta WHERE key = 'schema_version'").get()?.value;
  if (raw === undefined) return null;
  const version = Number(raw);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(`Development Control DB has invalid schema version ${String(raw)}`);
  }
  return version;
}

function assertSchemaCompatible(db, { allowOlder = false } = {}) {
  const version = schemaVersion(db);
  if (version === null) {
    if (allowOlder) return null;
    throw new Error('Development Control DB is uninitialized; run landos:control init with the current client');
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `Development Control DB schema ${version} is newer than this client supports (${SCHEMA_VERSION}); refusing access without mutation`,
    );
  }
  if (!allowOlder && version < SCHEMA_VERSION) {
    throw new Error(
      `Development Control DB schema ${version} requires explicit upgrade to ${SCHEMA_VERSION}; run landos:control init with the current client`,
    );
  }
  return version;
}

function configureConnection(db, { writable }) {
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (writable) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
  }
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS control_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS development_task (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      outcome TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','IN_PROGRESS','CANDIDATE','ACCEPTANCE_PENDING','ACCEPTED','FAILED','BLOCKED')),
      blocker TEXT,
      next_action TEXT NOT NULL,
      accepted_attempt_id TEXT,
      accepted_git_sha TEXT,
      accepted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (accepted_git_sha IS NULL OR (
        length(accepted_git_sha) = 40 AND accepted_git_sha NOT GLOB '*[^0-9a-f]*'
      )),
      CHECK (
        (status = 'ACCEPTED' AND accepted_attempt_id IS NOT NULL AND accepted_git_sha IS NOT NULL AND accepted_at IS NOT NULL)
        OR status <> 'ACCEPTED'
      )
    );

    CREATE TABLE IF NOT EXISTS development_task_contract (
      task_id TEXT PRIMARY KEY REFERENCES development_task(id),
      objective TEXT NOT NULL,
      non_goals_json TEXT NOT NULL,
      accepted_base_git_sha TEXT NOT NULL,
      working_base_git_sha TEXT NOT NULL,
      risk_policy TEXT NOT NULL,
      acceptance_policy TEXT NOT NULL,
      architecture_refs_json TEXT NOT NULL,
      invariant_refs_json TEXT NOT NULL,
      owned_scope_json TEXT NOT NULL,
      owned_interfaces_json TEXT NOT NULL,
      verification_obligations_json TEXT NOT NULL,
      verification_policy_refs_json TEXT NOT NULL,
      runtime_constraints_json TEXT NOT NULL,
      resource_constraints_json TEXT NOT NULL,
      relevant_capability_ids_json TEXT NOT NULL,
      relevant_task_ids_json TEXT NOT NULL,
      policy_git_sha TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (length(accepted_base_git_sha) = 40 AND accepted_base_git_sha NOT GLOB '*[^0-9a-f]*'),
      CHECK (length(working_base_git_sha) = 40 AND working_base_git_sha NOT GLOB '*[^0-9a-f]*'),
      CHECK (length(policy_git_sha) = 40 AND policy_git_sha NOT GLOB '*[^0-9a-f]*')
    );

    CREATE TABLE IF NOT EXISTS development_decision (
      id TEXT PRIMARY KEY,
      task_id TEXT REFERENCES development_task(id),
      capability_id TEXT,
      summary TEXT NOT NULL,
      rationale TEXT NOT NULL,
      evidence_reference TEXT,
      recorded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS development_attempt (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES development_task(id),
      worker TEXT NOT NULL,
      primary_writer_id TEXT,
      approach TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'IN_PROGRESS'
        CHECK (status IN ('IN_PROGRESS','CANDIDATE','VERIFIED','ACCEPTANCE_PENDING','ACCEPTED','FAILED')),
      base_git_sha TEXT,
      candidate_git_sha TEXT,
      result TEXT,
      root_cause TEXT,
      limitation TEXT,
      next_direction TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL,
      CHECK (base_git_sha IS NULL OR (
        length(base_git_sha) = 40 AND base_git_sha NOT GLOB '*[^0-9a-f]*'
      )),
      CHECK (candidate_git_sha IS NULL OR (
        length(candidate_git_sha) = 40 AND candidate_git_sha NOT GLOB '*[^0-9a-f]*'
      )),
      CHECK (
        status NOT IN ('CANDIDATE','VERIFIED','ACCEPTANCE_PENDING','ACCEPTED')
        OR candidate_git_sha IS NOT NULL
      )
    );

    -- A writable workspace belongs to one exact task/attempt/writer tuple.
    -- Git remains the worktree authority; this table makes that authority
    -- mandatory before the associated attempt may be writable.
    CREATE TABLE IF NOT EXISTS managed_workspace (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES development_task(id),
      attempt_id TEXT NOT NULL REFERENCES development_attempt(id),
      writer_id TEXT NOT NULL,
      workspace_path TEXT NOT NULL UNIQUE,
      branch TEXT NOT NULL,
      base_git_sha TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ACTIVE','RELEASED','STALE')),
      created_at TEXT NOT NULL,
      released_at TEXT,
      CHECK (length(base_git_sha) = 40 AND base_git_sha NOT GLOB '*[^0-9a-f]*'),
      CHECK ((status = 'RELEASED' AND released_at IS NOT NULL) OR status <> 'RELEASED')
    );

    CREATE TABLE IF NOT EXISTS context_pack_delivery (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT REFERENCES development_task(id),
      attempt_id TEXT NOT NULL REFERENCES development_attempt(id),
      workspace_id TEXT REFERENCES managed_workspace(id),
      context_pack_hash TEXT NOT NULL,
      canonical_json TEXT NOT NULL,
      delivered_at TEXT NOT NULL,
      UNIQUE (attempt_id, context_pack_hash),
      CHECK (length(context_pack_hash) = 64 AND context_pack_hash NOT GLOB '*[^0-9a-f]*')
    );

    CREATE TABLE IF NOT EXISTS governed_execution (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES development_task(id),
      attempt_id TEXT NOT NULL REFERENCES development_attempt(id),
      workspace_id TEXT NOT NULL REFERENCES managed_workspace(id),
      writer_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      working_directory TEXT NOT NULL,
      attempted_action TEXT NOT NULL CHECK (attempted_action IN ('run','resume')),
      context_pack_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('RUNNING','PROVIDER_RETURNED','COMPLETED','FAILED')),
      provider_exit_code INTEGER,
      provider_session_id TEXT,
      observed_candidate_git_sha TEXT,
      failure_classification TEXT,
      failure_reason TEXT,
      started_at TEXT NOT NULL,
      provider_returned_at TEXT,
      completed_at TEXT,
      CHECK (length(context_pack_hash) = 64 AND context_pack_hash NOT GLOB '*[^0-9a-f]*'),
      CHECK (observed_candidate_git_sha IS NULL OR (
        length(observed_candidate_git_sha) = 40 AND observed_candidate_git_sha NOT GLOB '*[^0-9a-f]*'
      ))
    );

    CREATE TABLE IF NOT EXISTS submission_bundle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id TEXT REFERENCES governed_execution(id),
      task_id TEXT REFERENCES development_task(id),
      attempt_id TEXT NOT NULL REFERENCES development_attempt(id),
      workspace_id TEXT REFERENCES managed_workspace(id),
      writer_id TEXT,
      provider TEXT NOT NULL,
      model TEXT,
      working_base_git_sha TEXT NOT NULL,
      candidate_git_sha TEXT,
      changed_paths_json TEXT NOT NULL,
      implementation_claims_json TEXT NOT NULL,
      worker_tests_json TEXT NOT NULL,
      worker_test_results_json TEXT NOT NULL,
      limitations_json TEXT NOT NULL,
      evidence_references_json TEXT NOT NULL,
      context_pack_hash TEXT,
      recorded_at TEXT NOT NULL,
      CHECK (length(working_base_git_sha) = 40 AND working_base_git_sha NOT GLOB '*[^0-9a-f]*'),
      CHECK (candidate_git_sha IS NULL OR (length(candidate_git_sha) = 40 AND candidate_git_sha NOT GLOB '*[^0-9a-f]*'))
    );

    -- A pack is a Control Spine delivery, not a provider-provided claim.  The
    -- hash is repeated in the Submission Bundle only after this exact record
    -- exists for the exact governed attempt.
    CREATE TABLE IF NOT EXISTS context_pack_delivery (
      attempt_id TEXT NOT NULL REFERENCES development_attempt(id),
      context_pack_hash TEXT NOT NULL,
      canonical_json TEXT NOT NULL,
      delivered_at TEXT NOT NULL,
      PRIMARY KEY (attempt_id, context_pack_hash),
      CHECK (length(context_pack_hash) = 64 AND context_pack_hash NOT GLOB '*[^0-9a-f]*')
    );

    CREATE TABLE IF NOT EXISTS development_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id TEXT NOT NULL REFERENCES development_attempt(id),
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      artifact_path TEXT,
      command TEXT,
      exit_code INTEGER,
      recorded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS development_verification (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id TEXT NOT NULL REFERENCES development_attempt(id),
      outcome TEXT NOT NULL CHECK (outcome IN ('PASS','FAIL')),
      git_sha TEXT,
      command TEXT NOT NULL,
      summary TEXT NOT NULL,
      evidence_id INTEGER REFERENCES development_evidence(id),
      root_cause TEXT,
      limitation TEXT,
      next_direction TEXT,
      recorded_at TEXT NOT NULL,
      CHECK (
        outcome = 'FAIL' OR (
          git_sha IS NOT NULL AND length(git_sha) = 40 AND git_sha NOT GLOB '*[^0-9a-f]*'
        )
      )
    );

    CREATE TABLE IF NOT EXISTS acceptance_operation (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES development_task(id),
      attempt_id TEXT NOT NULL REFERENCES development_attempt(id),
      candidate_git_sha TEXT NOT NULL,
      authority_ref TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('ACCEPTANCE_PENDING','ACCEPTED')),
      blocker TEXT,
      prepared_at TEXT NOT NULL,
      finalized_at TEXT,
      UNIQUE (attempt_id),
      CHECK (length(candidate_git_sha) = 40 AND candidate_git_sha NOT GLOB '*[^0-9a-f]*'),
      CHECK ((state = 'ACCEPTED' AND finalized_at IS NOT NULL) OR state = 'ACCEPTANCE_PENDING')
    );

    CREATE TABLE IF NOT EXISTS acceptance_supersession (
      operation_id TEXT PRIMARY KEY REFERENCES acceptance_operation(id),
      reason TEXT NOT NULL,
      next_direction TEXT NOT NULL,
      superseded_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_attempt_task ON development_attempt(task_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_decision_task ON development_decision(task_id, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_decision_capability ON development_decision(capability_id, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_evidence_attempt ON development_evidence(attempt_id, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_verification_attempt ON development_verification(attempt_id, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_acceptance_state ON acceptance_operation(state, prepared_at);

    CREATE UNIQUE INDEX IF NOT EXISTS one_active_workspace_per_task
      ON managed_workspace(task_id) WHERE status = 'ACTIVE';
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_workspace_per_attempt
      ON managed_workspace(attempt_id) WHERE status = 'ACTIVE';
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_workspace_per_writer
      ON managed_workspace(writer_id) WHERE status = 'ACTIVE';
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_workspace_per_branch
      ON managed_workspace(branch) WHERE status = 'ACTIVE';
    CREATE INDEX IF NOT EXISTS idx_submission_attempt ON submission_bundle(attempt_id, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_execution_attempt ON governed_execution(attempt_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_context_delivery_attempt ON context_pack_delivery(attempt_id, delivered_at DESC);

    CREATE TRIGGER IF NOT EXISTS task_acceptance_requires_gate
    BEFORE UPDATE OF status ON development_task
    WHEN NEW.status = 'ACCEPTED' AND NOT EXISTS (
      SELECT 1 FROM acceptance_operation operation
      WHERE operation.task_id = NEW.id
        AND operation.attempt_id = NEW.accepted_attempt_id
        AND operation.candidate_git_sha = NEW.accepted_git_sha
        AND operation.state = 'ACCEPTED'
    )
    BEGIN
      SELECT RAISE(ABORT, 'only the Integration Gate may mark a task ACCEPTED');
    END;

    CREATE TRIGGER IF NOT EXISTS attempt_acceptance_requires_gate
    BEFORE UPDATE OF status ON development_attempt
    WHEN NEW.status = 'ACCEPTED' AND NOT EXISTS (
      SELECT 1 FROM acceptance_operation operation
      WHERE operation.attempt_id = NEW.id
        AND operation.candidate_git_sha = NEW.candidate_git_sha
        AND operation.state = 'ACCEPTED'
    )
    BEGIN
      SELECT RAISE(ABORT, 'only the Integration Gate may mark an attempt ACCEPTED');
    END;
  `);

  // Older accepted Slice 1 databases remain readable.  New writable attempts
  // always populate this field; existing historical rows are not rewritten.
  const columns = db.prepare('PRAGMA table_info(development_attempt)').all();
  if (!columns.some((column) => column.name === 'primary_writer_id')) {
    db.exec('ALTER TABLE development_attempt ADD COLUMN primary_writer_id TEXT');
  }
  const deliveryColumns = db.prepare('PRAGMA table_info(context_pack_delivery)').all();
  // Historical Slice 4 variants used either an attempt/hash composite key or
  // a numeric id, but neither variant bound delivery to task and workspace.
  // Retain every historical row while preventing an unbound row from
  // authorizing a new governed execution.
  if (!deliveryColumns.some((column) => column.name === 'task_id')) {
    db.exec('ALTER TABLE context_pack_delivery ADD COLUMN task_id TEXT');
  }
  if (!deliveryColumns.some((column) => column.name === 'workspace_id')) {
    db.exec('ALTER TABLE context_pack_delivery ADD COLUMN workspace_id TEXT');
  }
  const bundleColumns = db.prepare('PRAGMA table_info(submission_bundle)').all();
  for (const [name, definition] of [
    ['execution_id', 'TEXT'],
    ['task_id', 'TEXT'],
    ['workspace_id', 'TEXT'],
    ['writer_id', 'TEXT'],
  ]) {
    if (!bundleColumns.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE submission_bundle ADD COLUMN ${name} ${definition}`);
    }
  }
  // The rejected chain accidentally created this index over attempt_id.  The
  // repaired schema makes writer uniqueness explicit while retaining a second
  // attempt uniqueness index above.
  db.exec('DROP INDEX IF EXISTS one_active_workspace_per_writer');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_workspace_per_writer
      ON managed_workspace(writer_id) WHERE status = 'ACTIVE';
    CREATE UNIQUE INDEX IF NOT EXISTS one_submission_bundle_per_execution
      ON submission_bundle(execution_id) WHERE execution_id IS NOT NULL;

    CREATE TRIGGER IF NOT EXISTS governed_candidate_requires_execution_bundle
    BEFORE UPDATE OF status, candidate_git_sha ON development_attempt
    WHEN NEW.status IN ('CANDIDATE','VERIFIED','ACCEPTANCE_PENDING','ACCEPTED') AND NOT EXISTS (
      SELECT 1
      FROM governed_execution execution
      JOIN submission_bundle bundle ON bundle.execution_id = execution.id
      WHERE execution.attempt_id = NEW.id
        AND execution.task_id = NEW.task_id
        AND execution.state = 'COMPLETED'
        AND execution.observed_candidate_git_sha = NEW.candidate_git_sha
        AND bundle.attempt_id = NEW.id
        AND bundle.task_id = NEW.task_id
        AND bundle.workspace_id = execution.workspace_id
        AND bundle.writer_id = execution.writer_id
        AND bundle.provider = execution.provider
        AND bundle.context_pack_hash = execution.context_pack_hash
        AND bundle.candidate_git_sha = NEW.candidate_git_sha
    )
    BEGIN
      SELECT RAISE(ABORT, 'candidate state requires a completed governed execution and its normalized Submission Bundle');
    END;

    CREATE TRIGGER IF NOT EXISTS governed_candidate_insert_requires_execution_bundle
    BEFORE INSERT ON development_attempt
    WHEN NEW.status IN ('CANDIDATE','VERIFIED','ACCEPTANCE_PENDING','ACCEPTED')
    BEGIN
      SELECT RAISE(ABORT, 'candidate attempt insertion is disabled; candidate state requires a completed governed execution');
    END;

    CREATE TRIGGER IF NOT EXISTS writable_attempt_requires_workspace_insert
    BEFORE INSERT ON development_attempt
    WHEN NEW.status = 'IN_PROGRESS' AND (
      NEW.primary_writer_id IS NULL OR
      (SELECT COUNT(*) FROM managed_workspace workspace
        WHERE workspace.status = 'ACTIVE'
          AND workspace.task_id = NEW.task_id
          AND workspace.attempt_id = NEW.id
          AND workspace.writer_id = NEW.primary_writer_id
          AND workspace.base_git_sha = NEW.base_git_sha) <> 1
    )
    BEGIN
      SELECT RAISE(ABORT, 'writable attempt requires exactly one active managed workspace owned by its primary writer');
    END;

    CREATE TRIGGER IF NOT EXISTS writable_attempt_requires_workspace_update
    BEFORE UPDATE OF status, task_id, primary_writer_id, base_git_sha ON development_attempt
    WHEN NEW.status = 'IN_PROGRESS' AND (
      NEW.primary_writer_id IS NULL OR
      (SELECT COUNT(*) FROM managed_workspace workspace
        WHERE workspace.status = 'ACTIVE'
          AND workspace.task_id = NEW.task_id
          AND workspace.attempt_id = NEW.id
          AND workspace.writer_id = NEW.primary_writer_id
          AND workspace.base_git_sha = NEW.base_git_sha) <> 1
    )
    BEGIN
      SELECT RAISE(ABORT, 'writable attempt requires exactly one active managed workspace owned by its primary writer');
    END;

    CREATE TRIGGER IF NOT EXISTS active_workspace_requires_matching_attempt
    BEFORE INSERT ON managed_workspace
    WHEN NEW.status = 'ACTIVE' AND NOT EXISTS (
      SELECT 1 FROM development_attempt attempt
      WHERE attempt.id = NEW.attempt_id
        AND attempt.task_id = NEW.task_id
        AND attempt.primary_writer_id = NEW.writer_id
        AND attempt.base_git_sha = NEW.base_git_sha
    )
    BEGIN
      SELECT RAISE(ABORT, 'active managed workspace must match its task, attempt, base commit, and primary writer');
    END;

    CREATE TRIGGER IF NOT EXISTS active_workspace_update_requires_matching_attempt
    BEFORE UPDATE OF status, task_id, attempt_id, writer_id, base_git_sha ON managed_workspace
    WHEN NEW.status = 'ACTIVE' AND NOT EXISTS (
      SELECT 1 FROM development_attempt attempt
      WHERE attempt.id = NEW.attempt_id
        AND attempt.task_id = NEW.task_id
        AND attempt.primary_writer_id = NEW.writer_id
        AND attempt.base_git_sha = NEW.base_git_sha
    )
    BEGIN
      SELECT RAISE(ABORT, 'active managed workspace must match its task, attempt, base commit, and primary writer');
    END;

    CREATE TRIGGER IF NOT EXISTS writable_attempt_workspace_release_refused
    BEFORE UPDATE OF status ON managed_workspace
    WHEN OLD.status = 'ACTIVE' AND NEW.status <> 'ACTIVE' AND EXISTS (
      SELECT 1 FROM development_attempt attempt
      WHERE attempt.id = OLD.attempt_id AND attempt.status = 'IN_PROGRESS'
    )
    BEGIN
      SELECT RAISE(ABORT, 'cannot release the active workspace of a writable attempt');
    END;

    CREATE TRIGGER IF NOT EXISTS writable_attempt_workspace_delete_refused
    BEFORE DELETE ON managed_workspace
    WHEN OLD.status = 'ACTIVE' AND EXISTS (
      SELECT 1 FROM development_attempt attempt
      WHERE attempt.id = OLD.attempt_id AND attempt.status = 'IN_PROGRESS'
    )
    BEGIN
      SELECT RAISE(ABORT, 'cannot delete the active workspace of a writable attempt');
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS control_schema_version_monotonic_update
    BEFORE UPDATE OF value ON control_meta
    WHEN OLD.key = 'schema_version'
      AND CAST(NEW.value AS INTEGER) < CAST(OLD.value AS INTEGER)
    BEGIN
      SELECT RAISE(ABORT, 'Development Control DB schema version cannot be downgraded');
    END;

    CREATE TRIGGER IF NOT EXISTS control_schema_version_delete_refused
    BEFORE DELETE ON control_meta
    WHEN OLD.key = 'schema_version'
    BEGIN
      SELECT RAISE(ABORT, 'Development Control DB schema version cannot be deleted');
    END;
  `);

  db.prepare(`
    INSERT INTO control_meta(key, value) VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(SCHEMA_VERSION));
}

function openDatabase(file, { writable }) {
  const db = new Database(file, writable ? undefined : { readonly: true, fileMustExist: true });
  try {
    configureConnection(db, { writable });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function stateHandle(db, file) {
  return { db, file, close: () => db.close() };
}

export function initializeControlState(root, { dbPath } = {}) {
  const file = resolveControlDatabasePath(root, dbPath);
  if (!dbPath) adoptLegacyDatabase(root, file);
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file)) {
    const probe = openDatabase(file, { writable: false });
    try { assertSchemaCompatible(probe, { allowOlder: true }); }
    finally { probe.close(); }
  }
  const db = openDatabase(file, { writable: true });
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      assertSchemaCompatible(db, { allowOlder: true });
      migrate(db);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    assertSchemaCompatible(db);
    return stateHandle(db, file);
  } catch (error) {
    db.close();
    throw error;
  }
}

export function openControlState(root, { dbPath } = {}) {
  const file = resolveControlDatabasePath(root, dbPath);
  const db = openDatabase(file, { writable: false });
  try {
    assertSchemaCompatible(db);
    return stateHandle(db, file);
  } catch (error) {
    db.close();
    throw error;
  }
}

export function openControlStateWriter(root, { dbPath } = {}) {
  const file = resolveControlDatabasePath(root, dbPath);
  if (!existsSync(file)) {
    throw new Error('Development Control DB is uninitialized; run landos:control init with the current client');
  }
  const probe = openDatabase(file, { writable: false });
  try { assertSchemaCompatible(probe); }
  finally { probe.close(); }
  const db = openDatabase(file, { writable: true });
  try {
    assertSchemaCompatible(db);
    return stateHandle(db, file);
  } catch (error) {
    db.close();
    throw error;
  }
}

function taskFor(db, taskId) {
  const task = db.prepare('SELECT * FROM development_task WHERE id = ?').get(taskId);
  if (!task) throw new Error(`unknown development task ${taskId}`);
  return task;
}

function attemptFor(db, attemptId) {
  const attempt = db.prepare('SELECT * FROM development_attempt WHERE id = ?').get(attemptId);
  if (!attempt) throw new Error(`unknown development attempt ${attemptId}`);
  return attempt;
}

export function createTask(db, input, now) {
  const at = nowIso(now);
  const task = {
    id: required(input.id, 'task id'),
    title: required(input.title, 'task title'),
    outcome: required(input.outcome, 'task outcome'),
    nextAction: required(input.nextAction, 'task next action'),
    blocker: input.blocker ? String(input.blocker).trim() : null,
  };
  db.prepare(`
    INSERT INTO development_task(id, title, outcome, status, blocker, next_action, created_at, updated_at)
    VALUES (?, ?, ?, 'OPEN', ?, ?, ?, ?)
  `).run(task.id, task.title, task.outcome, task.blocker, task.nextAction, at, at);
  return taskFor(db, task.id);
}

function uniqueSorted(value, label) {
  return [...new Set(requiredArray(value, label))].sort((left, right) => left.localeCompare(right));
}

function parsedArray(row, name) {
  const value = JSON.parse(row[name]);
  if (!Array.isArray(value)) throw new Error(`canonical task contract field ${name} is malformed`);
  return value;
}

export function setTaskContract(db, root, input, now) {
  const task = taskFor(db, input.taskId);
  if (!['OPEN', 'IN_PROGRESS'].includes(task.status)) {
    throw new Error(`task ${task.id} contract cannot change while ${task.status}`);
  }
  const delivered = db.prepare(`
    SELECT 1
    FROM context_pack_delivery delivery
    JOIN development_attempt attempt ON attempt.id = delivery.attempt_id
    WHERE attempt.task_id = ? LIMIT 1
  `).get(task.id);
  if (delivered) throw new Error(`task ${task.id} contract is immutable after Context Pack delivery`);
  const objective = required(input.objective, 'task contract objective');
  if (objective !== task.outcome) throw new Error('task contract objective must exactly match the canonical task outcome');
  const acceptedBase = resolveCommit(root, required(input.acceptedBaseGitSha, 'accepted base Git SHA'));
  const workingBase = resolveCommit(root, required(input.workingBaseGitSha, 'working base Git SHA'));
  const policyGitSha = resolveCommit(root, required(input.policyGitSha ?? workingBase, 'policy Git SHA'));
  const riskPolicy = required(input.riskPolicy, 'task risk policy');
  if (!['low', 'protected', 'architecture-critical'].includes(riskPolicy)) {
    throw new Error('task risk policy must be low, protected, or architecture-critical');
  }
  const contract = {
    nonGoals: uniqueSorted(input.nonGoals, 'canonical non-goals'),
    architectureRefs: uniqueSorted(input.architectureRefs, 'architecture references'),
    invariantRefs: uniqueSorted(input.invariantRefs, 'invariant references'),
    ownedScope: uniqueSorted(input.ownedScope, 'owned scope'),
    ownedInterfaces: uniqueSorted(input.ownedInterfaces, 'owned interfaces'),
    verificationObligations: uniqueSorted(input.verificationObligations, 'verification obligations'),
    verificationPolicyRefs: uniqueSorted(input.verificationPolicyRefs, 'verification policy references'),
    runtimeConstraints: uniqueSorted(input.runtimeConstraints, 'runtime constraints'),
    resourceConstraints: uniqueSorted(input.resourceConstraints, 'resource constraints'),
    relevantCapabilityIds: uniqueSorted(input.relevantCapabilityIds, 'relevant capability IDs'),
    relevantTaskIds: uniqueSorted(input.relevantTaskIds, 'relevant task IDs'),
  };
  if (contract.verificationObligations.length === 0 || contract.verificationPolicyRefs.length === 0) {
    throw new Error('governed task contract requires verification obligations and verification policy references');
  }
  const activeAttempt = db.prepare(`
    SELECT id, base_git_sha FROM development_attempt
    WHERE task_id = ? AND status = 'IN_PROGRESS'
    ORDER BY started_at DESC LIMIT 1
  `).get(task.id);
  if (activeAttempt && activeAttempt.base_git_sha !== workingBase) {
    throw new Error(`task contract working base ${workingBase} does not match active attempt ${activeAttempt.id}`);
  }
  const at = nowIso(now);
  db.prepare(`
    INSERT INTO development_task_contract(
      task_id, objective, non_goals_json, accepted_base_git_sha, working_base_git_sha,
      risk_policy, acceptance_policy, architecture_refs_json, invariant_refs_json,
      owned_scope_json, owned_interfaces_json, verification_obligations_json,
      verification_policy_refs_json, runtime_constraints_json, resource_constraints_json,
      relevant_capability_ids_json, relevant_task_ids_json, policy_git_sha, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      objective = excluded.objective,
      non_goals_json = excluded.non_goals_json,
      accepted_base_git_sha = excluded.accepted_base_git_sha,
      working_base_git_sha = excluded.working_base_git_sha,
      risk_policy = excluded.risk_policy,
      acceptance_policy = excluded.acceptance_policy,
      architecture_refs_json = excluded.architecture_refs_json,
      invariant_refs_json = excluded.invariant_refs_json,
      owned_scope_json = excluded.owned_scope_json,
      owned_interfaces_json = excluded.owned_interfaces_json,
      verification_obligations_json = excluded.verification_obligations_json,
      verification_policy_refs_json = excluded.verification_policy_refs_json,
      runtime_constraints_json = excluded.runtime_constraints_json,
      resource_constraints_json = excluded.resource_constraints_json,
      relevant_capability_ids_json = excluded.relevant_capability_ids_json,
      relevant_task_ids_json = excluded.relevant_task_ids_json,
      policy_git_sha = excluded.policy_git_sha,
      updated_at = excluded.updated_at
  `).run(
    task.id, objective, JSON.stringify(contract.nonGoals), acceptedBase, workingBase,
    riskPolicy, required(input.acceptancePolicy, 'task acceptance policy'),
    JSON.stringify(contract.architectureRefs), JSON.stringify(contract.invariantRefs),
    JSON.stringify(contract.ownedScope), JSON.stringify(contract.ownedInterfaces),
    JSON.stringify(contract.verificationObligations), JSON.stringify(contract.verificationPolicyRefs),
    JSON.stringify(contract.runtimeConstraints), JSON.stringify(contract.resourceConstraints),
    JSON.stringify(contract.relevantCapabilityIds), JSON.stringify(contract.relevantTaskIds),
    policyGitSha, at, at,
  );
  return canonicalTaskContract(db, task.id);
}

export function canonicalTaskContract(db, taskId) {
  taskFor(db, taskId);
  const row = db.prepare('SELECT * FROM development_task_contract WHERE task_id = ?').get(taskId);
  if (!row) throw new Error(`governed task ${taskId} has no complete canonical task contract`);
  return {
    taskId: row.task_id,
    objective: row.objective,
    nonGoals: parsedArray(row, 'non_goals_json'),
    acceptedBaseGitSha: row.accepted_base_git_sha,
    workingBaseGitSha: row.working_base_git_sha,
    riskPolicy: row.risk_policy,
    acceptancePolicy: row.acceptance_policy,
    architectureRefs: parsedArray(row, 'architecture_refs_json'),
    invariantRefs: parsedArray(row, 'invariant_refs_json'),
    ownedScope: parsedArray(row, 'owned_scope_json'),
    ownedInterfaces: parsedArray(row, 'owned_interfaces_json'),
    verificationObligations: parsedArray(row, 'verification_obligations_json'),
    verificationPolicyRefs: parsedArray(row, 'verification_policy_refs_json'),
    runtimeConstraints: parsedArray(row, 'runtime_constraints_json'),
    resourceConstraints: parsedArray(row, 'resource_constraints_json'),
    relevantCapabilityIds: parsedArray(row, 'relevant_capability_ids_json'),
    relevantTaskIds: parsedArray(row, 'relevant_task_ids_json'),
    policyGitSha: row.policy_git_sha,
  };
}

export function recordDecision(db, input, now) {
  const taskId = input.taskId ? required(input.taskId, 'decision task ID') : null;
  const capabilityId = input.capabilityId ? required(input.capabilityId, 'decision capability ID') : null;
  if (!taskId && !capabilityId) throw new Error('canonical decision requires a task or capability scope');
  if (taskId) taskFor(db, taskId);
  const id = input.id ? required(input.id, 'decision ID') : `decision-${randomUUID()}`;
  db.prepare(`
    INSERT INTO development_decision(id, task_id, capability_id, summary, rationale, evidence_reference, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, taskId, capabilityId,
    required(input.summary, 'decision summary'), required(input.rationale, 'decision rationale'),
    input.evidenceReference ? String(input.evidenceReference).trim() : null,
    nowIso(now),
  );
  return db.prepare('SELECT * FROM development_decision WHERE id = ?').get(id);
}

export function relevantTaskKnowledge(db, contract) {
  const taskIds = [...new Set([contract.taskId, ...contract.relevantTaskIds])].sort();
  const capabilityIds = [...new Set(contract.relevantCapabilityIds)].sort();
  const taskPlaceholders = taskIds.map(() => '?').join(',');
  const failures = db.prepare(`
    SELECT id, task_id, base_git_sha, candidate_git_sha, result, root_cause,
           limitation, next_direction, completed_at
    FROM development_attempt
    WHERE status = 'FAILED' AND task_id IN (${taskPlaceholders})
    ORDER BY completed_at, id
  `).all(...taskIds).map((failure) => ({
    ...failure,
    evidence: db.prepare(`
      SELECT id, kind, summary, artifact_path, command, exit_code, recorded_at
      FROM development_evidence WHERE attempt_id = ? ORDER BY id
    `).all(failure.id),
  }));
  const clauses = [`task_id IN (${taskPlaceholders})`];
  const values = [...taskIds];
  if (capabilityIds.length) {
    clauses.push(`capability_id IN (${capabilityIds.map(() => '?').join(',')})`);
    values.push(...capabilityIds);
  }
  const decisions = db.prepare(`
    SELECT id, task_id, capability_id, summary, rationale, evidence_reference, recorded_at
    FROM development_decision
    WHERE ${clauses.join(' OR ')}
    ORDER BY recorded_at, id
  `).all(...values);
  return { relevance: { taskIds, capabilityIds }, decisions, failures };
}

export function startAttempt(db, input, now) {
  const task = taskFor(db, input.taskId);
  if (task.status === 'ACCEPTED') throw new Error(`task ${task.id} is already ACCEPTED`);
  if (task.status === 'ACCEPTANCE_PENDING') {
    throw new Error(`task ${task.id} has an ACCEPTANCE_PENDING operation; reconcile it before another attempt`);
  }
  // Keep this exported name as an explicit refusal for integrations that used
  // the Slice 1 lifecycle.  A writable attempt may only come from the atomic
  // allocation below, which has a native Git worktree before it becomes live.
  throw new Error('startAttempt cannot create a writable attempt without an atomic managed workspace allocation; use startManagedAttempt');
}

export function canonicalTask(db, taskId) {
  return taskFor(db, taskId);
}

export function canonicalAttempt(db, attemptId) {
  return attemptFor(db, attemptId);
}

function gitWorktrees(root) {
  const result = git(['worktree', 'list', '--porcelain'], root);
  if (result.status !== 0) throw new Error('cannot enumerate registered Git worktrees');
  const records = [];
  let current = null;
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (current) records.push(current);
      current = { path: path.resolve(line.slice('worktree '.length)), branch: null, head: null };
    } else if (current && line.startsWith('HEAD ')) current.head = line.slice(5).trim();
    else if (current && line.startsWith('branch ')) current.branch = line.slice(7).replace(/^refs\/heads\//, '').trim();
  }
  if (current) records.push(current);
  return records;
}

function workspaceFor(db, workspaceId) {
  const workspace = db.prepare('SELECT * FROM managed_workspace WHERE id = ?').get(workspaceId);
  if (!workspace) throw new Error(`unknown managed workspace ${workspaceId}`);
  return workspace;
}

function workspaceIntegrity(root, workspace) {
  const registered = gitWorktrees(root).find((item) => item.path === workspace.workspace_path) ?? null;
  if (workspace.status === 'RELEASED') return { state: 'RELEASED', registered: false, dirty: false };
  if (!existsSync(workspace.workspace_path)) return { state: 'MISSING', registered: !!registered, dirty: false };
  if (!registered) return { state: 'UNREGISTERED', registered: false, dirty: false };
  const dirty = gitStatusText(workspace.workspace_path).trim().length > 0;
  if (registered.branch !== workspace.branch) return { state: 'BRANCH_MISMATCH', registered: true, dirty };
  const baseAncestor = git(['merge-base', '--is-ancestor', workspace.base_git_sha, 'HEAD'], workspace.workspace_path);
  if (baseAncestor.status !== 0) return { state: 'BASE_MISMATCH', registered: true, dirty };
  return { state: 'ACTIVE', registered: true, dirty };
}

function managedWorkspaceInput(root, input) {
  const workspacePath = path.resolve(required(input.workspacePath, 'workspace path'));
  const baseGitSha = resolveCommit(root, required(input.baseGitSha, 'workspace base Git SHA'));
  return {
    id: input.workspaceId ? required(input.workspaceId, 'workspace id') : `workspace-${randomUUID()}`,
    writerId: required(input.writerId, 'primary writer identity'),
    workspacePath,
    branch: required(input.branch, 'task branch'),
    baseGitSha,
  };
}

function assertWorkspaceAvailable(db, root, taskId, attemptId, workspace) {
  if (existsSync(workspace.workspacePath) || gitWorktrees(root).some((item) => item.path === workspace.workspacePath)) {
    throw new Error(`workspace path is already present or registered: ${workspace.workspacePath}`);
  }
  const active = db.prepare(`
    SELECT id FROM managed_workspace
    WHERE status = 'ACTIVE' AND (
      task_id = ? OR attempt_id = ? OR writer_id = ? OR branch = ? OR workspace_path = ?
    ) LIMIT 1
  `).get(taskId, attemptId, workspace.writerId, workspace.branch, workspace.workspacePath);
  if (active) throw new Error(`active managed workspace ${active.id} already owns this task, attempt, writer, branch, or path`);
}

export function startManagedAttempt(db, root, input, now) {
  const task = taskFor(db, input.taskId);
  if (task.status === 'ACCEPTED') throw new Error(`task ${task.id} is already ACCEPTED`);
  if (task.status === 'ACCEPTANCE_PENDING') {
    throw new Error(`task ${task.id} has an ACCEPTANCE_PENDING operation; reconcile it before another attempt`);
  }
  const at = nowIso(now);
  const attemptId = input.id ? required(input.id, 'attempt id') : `attempt-${randomUUID()}`;
  const workspace = managedWorkspaceInput(root, input);
  assertWorkspaceAvailable(db, root, task.id, attemptId, workspace);

  // Git creates the native worktree first.  Until the following database
  // transaction commits there is no writable attempt.  The transaction inserts
  // an internal non-writable row, ownership record, then changes the attempt to
  // IN_PROGRESS; schema triggers prove the final transition has exactly one
  // matching active owner.  A database failure removes only this just-created,
  // clean Git worktree.
  const add = git(['worktree', 'add', '-b', workspace.branch, workspace.workspacePath, workspace.baseGitSha], root);
  if (add.status !== 0) throw new Error(`Git could not create managed workspace: ${add.stderr.trim() || add.stdout.trim()}`);
  try {
    db.transaction(() => {
      db.prepare(`
        INSERT INTO development_attempt(
          id, task_id, worker, primary_writer_id, approach, status, base_git_sha, started_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'FAILED', ?, ?, ?)
      `).run(
        attemptId,
        task.id,
        required(input.worker, 'worker'),
        workspace.writerId,
        required(input.approach, 'attempt approach'),
        workspace.baseGitSha,
        at,
        at,
      );
      db.prepare(`
        INSERT INTO managed_workspace(
          id, task_id, attempt_id, writer_id, workspace_path, branch, base_git_sha, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
      `).run(
        workspace.id, task.id, attemptId, workspace.writerId,
        workspace.workspacePath, workspace.branch, workspace.baseGitSha, at,
      );
      db.prepare(`
        UPDATE development_attempt SET status = 'IN_PROGRESS', updated_at = ? WHERE id = ?
      `).run(at, attemptId);
      db.prepare(`
        UPDATE development_task
        SET status = 'IN_PROGRESS', blocker = NULL, next_action = ?, updated_at = ?
        WHERE id = ?
      `).run(input.nextAction ? required(input.nextAction, 'attempt next action') : 'Complete the attempt and submit a candidate.', at, task.id);
    })();
  } catch (error) {
    const remove = git(['worktree', 'remove', workspace.workspacePath], root);
    if (remove.status !== 0) {
      throw new Error(`managed attempt allocation failed and its untouched workspace could not be removed: ${remove.stderr.trim() || remove.stdout.trim()}`);
    }
    throw error;
  }
  return { attempt: attemptFor(db, attemptId), workspace: workspaceFor(db, workspace.id) };
}

export function inspectManagedWorkspace(db, root, input = {}) {
  const records = input.id
    ? [workspaceFor(db, required(input.id, 'workspace id'))]
    : db.prepare('SELECT * FROM managed_workspace ORDER BY created_at, id').all();
  return records.map((workspace) => ({ ...workspace, integrity: workspaceIntegrity(root, workspace) }));
}

export function validateManagedWorkspace(db, root, input) {
  const taskId = required(input.taskId, 'task id');
  const attemptId = required(input.attemptId, 'attempt id');
  const writerId = required(input.writerId, 'primary writer identity');
  const attempt = attemptFor(db, attemptId);
  if (attempt.task_id !== taskId) throw new Error(`attempt ${attempt.id} does not belong to task ${taskId}`);
  if (attempt.status !== 'IN_PROGRESS') throw new Error(`attempt ${attempt.id} is not writable`);
  if (attempt.primary_writer_id !== writerId) throw new Error(`writer ${writerId} does not own attempt ${attempt.id}`);
  const workspaces = db.prepare(`
    SELECT * FROM managed_workspace
    WHERE task_id = ? AND attempt_id = ? AND writer_id = ? AND status = 'ACTIVE'
    ORDER BY id
  `).all(taskId, attemptId, writerId);
  if (workspaces.length !== 1) {
    throw new Error(`writable attempt ${attempt.id} requires exactly one active managed workspace for its primary writer`);
  }
  const workspace = workspaces[0];
  if (path.resolve(required(input.cwd, 'executing working directory')) !== workspace.workspace_path) {
    throw new Error(`executing working directory does not match managed workspace ${workspace.id}`);
  }
  const integrity = workspaceIntegrity(root, workspace);
  if (integrity.state !== 'ACTIVE') throw new Error(`managed workspace ${workspace.id} is ${integrity.state}`);
  return workspace;
}

export function releaseManagedWorkspace(db, root, input, now) {
  const workspace = workspaceFor(db, required(input.id, 'workspace id'));
  const taskId = required(input.taskId, 'task identity');
  const attemptId = required(input.attemptId, 'attempt identity');
  const writerId = required(input.writerId, 'primary writer identity');
  if (workspace.task_id !== taskId) throw new Error(`task ${taskId} does not own managed workspace ${workspace.id}`);
  if (workspace.attempt_id !== attemptId) throw new Error(`attempt ${attemptId} does not own managed workspace ${workspace.id}`);
  if (workspace.writer_id !== writerId) throw new Error(`writer ${writerId} does not own managed workspace ${workspace.id}`);
  if (workspace.status !== 'ACTIVE') throw new Error(`managed workspace ${workspace.id} is not actively owned`);
  const attempt = attemptFor(db, attemptId);
  if (attempt.primary_writer_id !== writerId) throw new Error(`writer ${writerId} does not own attempt ${attemptId}`);
  if (attempt.status === 'IN_PROGRESS') throw new Error(`cannot release managed workspace ${workspace.id} while its attempt is writable`);
  const integrity = workspaceIntegrity(root, workspace);
  if (integrity.state !== 'ACTIVE') {
    db.prepare("UPDATE managed_workspace SET status = 'STALE' WHERE id = ?").run(workspace.id);
    throw new Error(`managed workspace ${workspace.id} metadata is ${integrity.state}; no files were removed`);
  }
  if (integrity.dirty) throw new Error(`managed workspace ${workspace.id} has uncommitted work; refusing destructive cleanup`);
  const remove = git(['worktree', 'remove', workspace.workspace_path], root);
  if (remove.status !== 0) throw new Error(`Git could not release managed workspace: ${remove.stderr.trim() || remove.stdout.trim()}`);
  db.prepare("UPDATE managed_workspace SET status = 'RELEASED', released_at = ? WHERE id = ?").run(nowIso(now), workspace.id);
  return workspaceFor(db, workspace.id);
}

export function addEvidence(db, input, now) {
  attemptFor(db, input.attemptId);
  const result = db.prepare(`
    INSERT INTO development_evidence(
      attempt_id, kind, summary, artifact_path, command, exit_code, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.attemptId,
    required(input.kind, 'evidence kind'),
    required(input.summary, 'evidence summary'),
    input.path ? String(input.path).trim() : null,
    input.command ? String(input.command).trim() : null,
    input.exitCode === undefined || input.exitCode === null ? null : Number(input.exitCode),
    nowIso(now),
  );
  return db.prepare('SELECT * FROM development_evidence WHERE id = ?').get(result.lastInsertRowid);
}

function requiredArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function contextPackHash(value, label = 'Context Pack hash') {
  const hash = required(value, label).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`${label} must be a 64-character SHA-256 hash`);
  return hash;
}

export function recordContextPackDelivery(db, input, now) {
  const attempt = attemptFor(db, input.attemptId);
  if (attempt.status !== 'IN_PROGRESS') throw new Error(`Context Pack delivery requires writable attempt ${attempt.id}`);
  const workspace = workspaceFor(db, required(input.workspaceId, 'managed workspace ID'));
  if (workspace.task_id !== attempt.task_id || workspace.attempt_id !== attempt.id
      || workspace.writer_id !== attempt.primary_writer_id || workspace.status !== 'ACTIVE') {
    throw new Error(`Context Pack delivery does not match active workspace ownership for attempt ${attempt.id}`);
  }
  const canonicalJson = required(input.canonicalJson, 'canonical Context Pack JSON');
  const hash = createHash('sha256').update(canonicalJson).digest('hex');
  if (input.contextPackHash && contextPackHash(input.contextPackHash) !== hash) {
    throw new Error('caller-supplied Context Pack hash does not match the canonical payload');
  }
  db.prepare(`
    INSERT OR IGNORE INTO context_pack_delivery(
      task_id, attempt_id, workspace_id, context_pack_hash, canonical_json, delivered_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(attempt.task_id, attempt.id, workspace.id, hash, canonicalJson, nowIso(now));
  return db.prepare(`
    SELECT * FROM context_pack_delivery WHERE attempt_id = ? AND context_pack_hash = ?
  `).get(attempt.id, hash);
}

export function deliveredContextPack(db, input) {
  const attemptId = required(input.attemptId, 'attempt ID');
  const workspaceId = required(input.workspaceId, 'managed workspace ID');
  const hash = contextPackHash(input.contextPackHash);
  const delivery = db.prepare(`
    SELECT * FROM context_pack_delivery
    WHERE task_id = ? AND attempt_id = ? AND workspace_id = ? AND context_pack_hash = ?
  `).get(required(input.taskId, 'task ID'), attemptId, workspaceId, hash);
  if (!delivery) throw new Error(`Context Pack ${hash} was not delivered to attempt ${attemptId} in workspace ${workspaceId}`);
  const actualHash = createHash('sha256').update(delivery.canonical_json).digest('hex');
  if (actualHash !== delivery.context_pack_hash) {
    throw new Error(`recorded Context Pack ${delivery.context_pack_hash} has an invalid canonical payload hash`);
  }
  return delivery;
}

export function resolveCommit(root, revision) {
  const result = git(['rev-parse', '--verify', `${revision}^{commit}`], root);
  if (result.status !== 0) throw new Error(`Git revision ${revision} is not an existing commit`);
  return normalizedSha(result.stdout.trim(), `resolved Git revision ${revision}`);
}

export function liveGitFacts(root, authorityRef = DEFAULT_AUTHORITY_REF) {
  const headResult = git(['rev-parse', '--verify', 'HEAD'], root);
  const branchResult = git(['branch', '--show-current'], root);
  const authorityResult = git(['rev-parse', '--verify', `${authorityRef}^{commit}`], root);
  const statusText = gitStatusText(root);
  return {
    head: headResult.status === 0 ? headResult.stdout.trim() : null,
    branch: branchResult.stdout.trim() || '(detached)',
    authorityRef,
    authoritySha: authorityResult.status === 0 ? authorityResult.stdout.trim() : null,
    dirtyPaths: statusText.split(/\r?\n/).filter(Boolean).length,
  };
}

export function submitCandidate(db, root, input, now) {
  const attempt = attemptFor(db, input.attemptId);
  if (attempt.status === 'IN_PROGRESS') {
    failAttempt(db, {
      attemptId: attempt.id,
      kind: 'candidate_submission_bypass_refused',
      result: 'Manual candidate submission was refused by the governed execution boundary.',
      rootCause: 'A candidate requires a completed governed execution and its persisted normalized Submission Bundle.',
      evidence: 'Caller-supplied task, attempt, and Git SHA values have no candidate-submission authority.',
      nextDirection: 'Start a new attempt and use the governed execution operation with an attempt-bound delivered Context Pack.',
    }, now);
  }
  throw new Error('manual candidate submission is disabled; only a completed governed execution may create candidate state');
}

function latestVerification(db, attemptId) {
  return db.prepare(`
    SELECT * FROM development_verification
    WHERE attempt_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(attemptId);
}

export function recordVerification(db, input, now) {
  const attempt = attemptFor(db, input.attemptId);
  if (attempt.status === 'ACCEPTANCE_PENDING' || attempt.status === 'ACCEPTED') {
    throw new Error(`attempt ${attempt.id} is ${attempt.status} and cannot receive another verification result`);
  }
  const outcome = required(input.outcome, 'verification outcome').toUpperCase();
  if (!['PASS', 'FAIL'].includes(outcome)) throw new Error('verification outcome must be PASS or FAIL');
  const gitSha = input.gitSha ? normalizedSha(input.gitSha, 'verified Git SHA') : null;
  if (outcome === 'PASS') {
    if (!attempt.candidate_git_sha) throw new Error('a PASS requires a submitted candidate commit');
    if (gitSha !== attempt.candidate_git_sha) {
      throw new Error(`verification SHA ${gitSha ?? '(missing)'} does not match candidate ${attempt.candidate_git_sha}`);
    }
  }
  const at = nowIso(now);
  const rootCause = input.rootCause ? String(input.rootCause).trim() : null;
  const limitation = input.limitation ? String(input.limitation).trim() : null;
  const nextDirection = input.nextDirection ? String(input.nextDirection).trim() : null;
  const transaction = db.transaction(() => {
    const evidence = addEvidence(db, {
      attemptId: attempt.id,
      kind: 'verification_result',
      summary: required(input.summary, 'verification summary'),
      path: input.path,
      command: required(input.command, 'verification command'),
      exitCode: input.exitCode,
    }, () => at);
    db.prepare(`
      INSERT INTO development_verification(
        attempt_id, outcome, git_sha, command, summary, evidence_id,
        root_cause, limitation, next_direction, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      attempt.id,
      outcome,
      outcome === 'PASS' ? gitSha : (gitSha ?? attempt.candidate_git_sha),
      required(input.command, 'verification command'),
      required(input.summary, 'verification summary'),
      evidence.id,
      rootCause,
      limitation,
      nextDirection,
      at,
    );
    if (outcome === 'PASS') {
      db.prepare(`
        UPDATE development_attempt
        SET status = 'VERIFIED', root_cause = NULL, limitation = ?, next_direction = ?, updated_at = ?
        WHERE id = ?
      `).run(limitation, nextDirection, at, attempt.id);
      db.prepare(`
        UPDATE development_task
        SET status = 'CANDIDATE', blocker = NULL,
            next_action = 'Integration Gate: prepare acceptance, promote the candidate to main, then reconcile.',
            updated_at = ?
        WHERE id = ?
      `).run(at, attempt.task_id);
    } else {
      db.prepare(`
        UPDATE development_attempt
        SET status = 'FAILED', result = ?, root_cause = ?, limitation = ?, next_direction = ?, completed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(required(input.summary, 'verification summary'), rootCause, limitation, nextDirection, at, at, attempt.id);
      db.prepare(`
        UPDATE development_task
        SET status = 'FAILED', blocker = ?, next_action = ?, updated_at = ?
        WHERE id = ?
      `).run(
        rootCause ?? limitation ?? required(input.summary, 'verification summary'),
        nextDirection ?? 'Start a new attempt using the durable failure evidence.',
        at,
        attempt.task_id,
      );
    }
  });
  transaction();
  return latestVerification(db, attempt.id);
}

export function failAttempt(db, input, now) {
  const attempt = attemptFor(db, input.attemptId);
  if (attempt.status === 'ACCEPTED') throw new Error(`attempt ${attempt.id} is already ACCEPTED`);
  if (attempt.status === 'ACCEPTANCE_PENDING') {
    throw new Error(`attempt ${attempt.id} is ACCEPTANCE_PENDING and may only be reconciled by the Integration Gate`);
  }
  const at = nowIso(now);
  const result = required(input.result, 'failure result');
  const rootCause = input.rootCause ? String(input.rootCause).trim() : null;
  const limitation = input.limitation ? String(input.limitation).trim() : null;
  const nextDirection = input.nextDirection ? String(input.nextDirection).trim() : null;
  const transaction = db.transaction(() => {
    addEvidence(db, {
      attemptId: attempt.id,
      kind: input.kind ?? 'candidate_failure',
      summary: input.evidence ?? result,
      path: input.path,
    }, () => at);
    db.prepare(`
      UPDATE development_attempt
      SET status = 'FAILED', result = ?, root_cause = ?, limitation = ?, next_direction = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(result, rootCause, limitation, nextDirection, at, at, attempt.id);
    db.prepare(`
      UPDATE development_task
      SET status = 'FAILED', blocker = ?, next_action = ?, updated_at = ?
      WHERE id = ?
    `).run(rootCause ?? limitation ?? result, nextDirection ?? 'Start a new attempt using the durable failure evidence.', at, attempt.task_id);
  });
  transaction();
  return attemptFor(db, attempt.id);
}

export async function runVerification(db, root, input, now) {
  const attempt = attemptFor(db, input.attemptId);
  if (!attempt.candidate_git_sha) throw new Error('submit a candidate commit before verification');
  const facts = liveGitFacts(root);
  if (facts.head !== attempt.candidate_git_sha) {
    throw new Error(`verification must run at candidate ${attempt.candidate_git_sha}; live HEAD is ${facts.head ?? 'missing'}`);
  }
  if (facts.dirtyPaths !== 0) throw new Error('verification requires a clean working tree so evidence is Git-specific');

  const check = await runCheck({ id: 'control-spine-verification', command: required(input.command, 'verification command') }, root);
  const diagnosis = check.ok ? null : failureEvidence([check])[0];
  const summary = input.summary
    ? required(input.summary, 'verification summary')
    : check.ok
      ? `PASS: ${check.command}`
      : diagnosis?.text ?? `FAIL: ${check.command}`;
  return recordVerification(db, {
    attemptId: attempt.id,
    outcome: check.ok ? 'PASS' : 'FAIL',
    gitSha: attempt.candidate_git_sha,
    command: check.command,
    summary,
    exitCode: check.exitCode,
    rootCause: input.rootCause ?? (check.ok ? null : diagnosis?.text),
    limitation: input.limitation,
    nextDirection: input.nextDirection,
  }, now);
}

export function prepareAcceptance(db, root, input, now) {
  const attempt = attemptFor(db, input.attemptId);
  const task = taskFor(db, attempt.task_id);
  if (task.status === 'ACCEPTED') {
    const existing = db.prepare('SELECT * FROM acceptance_operation WHERE attempt_id = ?').get(attempt.id);
    if (existing?.state === 'ACCEPTED') return existing;
    throw new Error(`task ${task.id} is already ACCEPTED by another attempt`);
  }
  if (!attempt.candidate_git_sha) throw new Error('acceptance requires a submitted candidate commit');
  resolveCommit(root, attempt.candidate_git_sha);
  const verification = latestVerification(db, attempt.id);
  if (!verification || verification.outcome !== 'PASS' || verification.git_sha !== attempt.candidate_git_sha) {
    throw new Error('Integration Gate requires a PASS tied to the exact candidate commit');
  }
  const existing = db.prepare('SELECT * FROM acceptance_operation WHERE attempt_id = ?').get(attempt.id);
  if (existing) {
    if (supersessionFor(db, existing.id)) {
      throw new Error(`candidate for attempt ${attempt.id} was superseded; start a replacement attempt`);
    }
    return existing;
  }
  const taskPending = db.prepare(`
    SELECT operation.id FROM acceptance_operation operation
    LEFT JOIN acceptance_supersession supersession ON supersession.operation_id = operation.id
    WHERE operation.task_id = ? AND operation.state = 'ACCEPTANCE_PENDING'
      AND supersession.operation_id IS NULL
  `).get(task.id);
  if (taskPending) throw new Error(`task ${task.id} already has pending acceptance ${taskPending.id}`);
  const at = nowIso(now);
  const id = input.id ? required(input.id, 'acceptance id') : `acceptance-${randomUUID()}`;
  const authorityRef = input.authorityRef ? required(input.authorityRef, 'authority ref') : DEFAULT_AUTHORITY_REF;
  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO acceptance_operation(
        id, task_id, attempt_id, candidate_git_sha, authority_ref, state, prepared_at
      ) VALUES (?, ?, ?, ?, ?, 'ACCEPTANCE_PENDING', ?)
    `).run(id, task.id, attempt.id, attempt.candidate_git_sha, authorityRef, at);
    db.prepare(`
      UPDATE development_attempt SET status = 'ACCEPTANCE_PENDING', updated_at = ? WHERE id = ?
    `).run(at, attempt.id);
    db.prepare(`
      UPDATE development_task
      SET status = 'ACCEPTANCE_PENDING', blocker = ?,
          next_action = ?, updated_at = ?
      WHERE id = ?
    `).run(
      `Waiting for ${authorityRef} to resolve to ${attempt.candidate_git_sha}.`,
      `Promote ${attempt.candidate_git_sha} to ${authorityRef}, then run Integration Gate reconciliation.`,
      at,
      task.id,
    );
  });
  transaction();
  return db.prepare('SELECT * FROM acceptance_operation WHERE id = ?').get(id);
}

function acceptanceFor(db, acceptanceId) {
  const operation = db.prepare('SELECT * FROM acceptance_operation WHERE id = ?').get(acceptanceId);
  if (!operation) throw new Error(`unknown acceptance operation ${acceptanceId}`);
  return operation;
}

function supersessionFor(db, acceptanceId) {
  return db.prepare('SELECT * FROM acceptance_supersession WHERE operation_id = ?').get(acceptanceId) ?? null;
}

export function supersedeAcceptance(db, input, now) {
  const operation = acceptanceFor(db, input.id);
  if (operation.state === 'ACCEPTED') throw new Error(`acceptance operation ${operation.id} is already ACCEPTED`);
  const existing = supersessionFor(db, operation.id);
  if (existing) return { ...operation, ...existing, state: 'SUPERSEDED' };
  const reason = required(input.reason, 'supersession reason');
  const nextDirection = input.nextDirection
    ? required(input.nextDirection, 'supersession next direction')
    : 'Start a new attempt using the durable supersession evidence.';
  const at = nowIso(now);
  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO acceptance_supersession(operation_id, reason, next_direction, superseded_at)
      VALUES (?, ?, ?, ?)
    `).run(operation.id, reason, nextDirection, at);
    db.prepare('UPDATE acceptance_operation SET blocker = ? WHERE id = ?').run(reason, operation.id);
    addEvidence(db, {
      attemptId: operation.attempt_id,
      kind: 'acceptance_superseded',
      summary: reason,
    }, () => at);
    db.prepare(`
      UPDATE development_attempt
      SET status = 'FAILED', result = ?, root_cause = ?, limitation = ?, next_direction = ?,
          completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run('Candidate was superseded before integration.', reason, reason, nextDirection, at, at, operation.attempt_id);
    db.prepare(`
      UPDATE development_task
      SET status = 'FAILED', blocker = ?, next_action = ?, updated_at = ?
      WHERE id = ?
    `).run(reason, nextDirection, at, operation.task_id);
  });
  transaction();
  return { ...acceptanceFor(db, operation.id), ...supersessionFor(db, operation.id), state: 'SUPERSEDED' };
}

export function reconcileAcceptance(db, root, input = {}, now) {
  const pending = input.id
    ? [acceptanceFor(db, input.id)]
    : db.prepare(`
        SELECT * FROM acceptance_operation
        WHERE state = 'ACCEPTANCE_PENDING'
          AND NOT EXISTS (
            SELECT 1 FROM acceptance_supersession
            WHERE acceptance_supersession.operation_id = acceptance_operation.id
          )
        ORDER BY prepared_at, id
      `).all();
  const results = [];
  for (const original of pending) {
    const supersession = supersessionFor(db, original.id);
    if (supersession) {
      results.push({
        ...original,
        ...supersession,
        state: 'SUPERSEDED',
        reconciled: false,
        superseded: true,
        blockers: [],
      });
      continue;
    }
    if (original.state === 'ACCEPTED') {
      results.push({ ...original, reconciled: true, blockers: [] });
      continue;
    }
    const operation = acceptanceFor(db, original.id);
    const attempt = attemptFor(db, operation.attempt_id);
    const verification = latestVerification(db, attempt.id);
    const facts = liveGitFacts(root, operation.authority_ref);
    const blockers = [];
    if (!facts.authoritySha) blockers.push(`authority ref ${operation.authority_ref} does not resolve to a commit`);
    else if (facts.authoritySha !== operation.candidate_git_sha) {
      blockers.push(`${operation.authority_ref} is ${facts.authoritySha}; expected ${operation.candidate_git_sha}`);
    }
    if (!verification || verification.outcome !== 'PASS' || verification.git_sha !== operation.candidate_git_sha) {
      blockers.push('the latest verification is not a PASS for the exact pending candidate');
    }
    if (blockers.length) {
      const blocker = blockers.join(' ');
      const at = nowIso(now);
      const transaction = db.transaction(() => {
        db.prepare('UPDATE acceptance_operation SET blocker = ? WHERE id = ?').run(blocker, operation.id);
        db.prepare(`
          UPDATE development_task SET blocker = ?, next_action = ?, updated_at = ? WHERE id = ?
        `).run(blocker, `Resolve the pending Integration Gate mismatch, then reconcile ${operation.id}.`, at, operation.task_id);
      });
      transaction();
      results.push({ ...acceptanceFor(db, operation.id), reconciled: false, blockers });
      continue;
    }

    const at = nowIso(now);
    const finalize = db.transaction(() => {
      db.prepare(`
        UPDATE acceptance_operation
        SET state = 'ACCEPTED', blocker = NULL, finalized_at = ?
        WHERE id = ? AND state = 'ACCEPTANCE_PENDING'
      `).run(at, operation.id);
      db.prepare(`
        UPDATE development_attempt
        SET status = 'ACCEPTED', completed_at = COALESCE(completed_at, ?), updated_at = ?
        WHERE id = ?
      `).run(at, at, operation.attempt_id);
      db.prepare(`
        UPDATE development_task
        SET status = 'ACCEPTED', blocker = NULL,
            next_action = 'Await the next accepted development task.',
            accepted_attempt_id = ?, accepted_git_sha = ?, accepted_at = ?, updated_at = ?
        WHERE id = ?
      `).run(operation.attempt_id, operation.candidate_git_sha, at, at, operation.task_id);
    });
    finalize();
    results.push({ ...acceptanceFor(db, operation.id), reconciled: true, blockers: [] });
  }
  return results;
}

export function controlSnapshot(db) {
  const activeTask = db.prepare(`
    SELECT * FROM development_task
    WHERE status <> 'ACCEPTED'
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get() ?? null;
  const latestAccepted = db.prepare(`
    SELECT task.*, attempt.result AS attempt_result
    FROM development_task task
    JOIN development_attempt attempt ON attempt.id = task.accepted_attempt_id
    WHERE task.status = 'ACCEPTED'
    ORDER BY task.accepted_at DESC, task.id DESC
    LIMIT 1
  `).get() ?? null;
  const latestFailure = db.prepare(`
    SELECT attempt.*, task.title AS task_title
    FROM development_attempt attempt
    JOIN development_task task ON task.id = attempt.task_id
    WHERE attempt.status = 'FAILED'
      AND (? IS NULL OR attempt.task_id = ?)
    ORDER BY attempt.completed_at DESC, attempt.id DESC
    LIMIT 1
  `).get(activeTask?.id ?? null, activeTask?.id ?? null) ?? db.prepare(`
    SELECT attempt.*, task.title AS task_title
    FROM development_attempt attempt
    JOIN development_task task ON task.id = attempt.task_id
    WHERE attempt.status = 'FAILED'
    ORDER BY attempt.completed_at DESC, attempt.id DESC
    LIMIT 1
  `).get() ?? null;
  const pending = db.prepare(`
    SELECT operation.*, task.title AS task_title
    FROM acceptance_operation operation
    JOIN development_task task ON task.id = operation.task_id
    WHERE operation.state = 'ACCEPTANCE_PENDING'
      AND NOT EXISTS (
        SELECT 1 FROM acceptance_supersession
        WHERE acceptance_supersession.operation_id = operation.id
      )
    ORDER BY operation.prepared_at, operation.id
  `).all();
  return { activeTask, latestAccepted, latestFailure, pendingAcceptances: pending };
}

function oneLine(value, fallback = 'none') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

export function renderStateMarkdown(db, root, { authorityRef = DEFAULT_AUTHORITY_REF } = {}) {
  const state = controlSnapshot(db);
  const gitFacts = liveGitFacts(root, authorityRef);
  const acceptedSha = state.latestAccepted?.accepted_git_sha ?? null;
  const blockers = [];
  for (const operation of state.pendingAcceptances) {
    blockers.push(operation.blocker || `Acceptance ${operation.id} is pending promotion to ${operation.authority_ref}.`);
  }
  if (state.activeTask?.blocker && !blockers.includes(state.activeTask.blocker)) blockers.push(state.activeTask.blocker);
  if (acceptedSha && gitFacts.authoritySha) {
    const ancestry = git(['merge-base', '--is-ancestor', acceptedSha, gitFacts.authoritySha], root);
    if (ancestry.status !== 0) blockers.push(`Accepted commit ${acceptedSha} is not an ancestor of ${authorityRef}.`);
  }

  const lines = [
    '# LandOS Development State',
    '',
    '> Generated from the Git-common Development Control database plus live Git. Do not edit this file as project truth.',
    '',
    '## Git authority',
    '',
    `- Authority ref: \`${authorityRef}\``,
    `- Accepted Git HEAD: ${acceptedSha ? `\`${acceptedSha}\`` : 'none recorded'}`,
    `- Live ${authorityRef}: ${gitFacts.authoritySha ? `\`${gitFacts.authoritySha}\`` : 'unresolved'}`,
    `- Worktree HEAD: ${gitFacts.head ? `\`${gitFacts.head}\`` : 'unresolved'} on \`${gitFacts.branch}\``,
    `- Worktree state: ${gitFacts.dirtyPaths === 0 ? 'clean' : `${gitFacts.dirtyPaths} modified/untracked path(s)`}`,
    '',
    '## Current task',
    '',
    state.activeTask
      ? `- \`${state.activeTask.id}\` [${state.activeTask.status}] ${oneLine(state.activeTask.title)}`
      : '- none',
    state.activeTask ? `- Outcome: ${oneLine(state.activeTask.outcome)}` : '- Outcome: none',
    '',
    '## Latest accepted work',
    '',
    state.latestAccepted
      ? `- \`${state.latestAccepted.id}\` accepted at ${state.latestAccepted.accepted_at} as \`${state.latestAccepted.accepted_git_sha}\``
      : '- none recorded by the Control Spine',
    state.latestAccepted ? `- Result: ${oneLine(state.latestAccepted.attempt_result)}` : '- Result: none',
    '',
    '## Latest relevant failed attempt',
    '',
    state.latestFailure
      ? `- \`${state.latestFailure.id}\` for \`${state.latestFailure.task_id}\`: ${oneLine(state.latestFailure.result)}`
      : '- none',
    state.latestFailure ? `- Root cause: ${oneLine(state.latestFailure.root_cause, 'not established')}` : '- Root cause: none',
    state.latestFailure ? `- Limitation: ${oneLine(state.latestFailure.limitation, 'none recorded')}` : '- Limitation: none',
    state.latestFailure ? `- Useful next direction: ${oneLine(state.latestFailure.next_direction, 'none recorded')}` : '- Useful next direction: none',
    '',
    '## Blockers',
    '',
    ...(blockers.length ? blockers.map((blocker) => `- ${oneLine(blocker)}`) : ['- none']),
    '',
    '## Next action',
    '',
    `- ${oneLine(state.activeTask?.next_action, 'Await the next canonical development task.')}`,
    '',
  ];
  return lines.join('\n');
}

export function generateStateFile(db, root, options = {}) {
  const file = path.join(path.resolve(root), STATE_PATH);
  const content = renderStateMarkdown(db, root, options);
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file) && readFileSync(file, 'utf8') === content) {
    return { path: STATE_PATH, changed: false, content };
  }
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, file);
  return { path: STATE_PATH, changed: true, content };
}

export function listFailures(db, taskId = null) {
  return db.prepare(`
    SELECT attempt.*, task.title AS task_title,
      (SELECT json_group_array(json_object(
        'id', evidence.id,
        'kind', evidence.kind,
        'summary', evidence.summary,
        'path', evidence.artifact_path,
        'command', evidence.command,
        'exitCode', evidence.exit_code
      )) FROM development_evidence evidence WHERE evidence.attempt_id = attempt.id) AS evidence_json
    FROM development_attempt attempt
    JOIN development_task task ON task.id = attempt.task_id
    WHERE attempt.status = 'FAILED' AND (? IS NULL OR attempt.task_id = ?)
    ORDER BY attempt.completed_at DESC, attempt.id DESC
  `).all(taskId, taskId).map((row) => ({ ...row, evidence: JSON.parse(row.evidence_json ?? '[]') }));
}
