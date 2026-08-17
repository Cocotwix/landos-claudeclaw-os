// LandOS Development Control Spine -- Vertical Slice 1.
//
// This module owns the smallest durable development lifecycle:
// task -> attempt -> evidence -> verification -> pending acceptance ->
// exact Git acceptance, or durable failure knowledge. It is deliberately
// separate from store/landos.db and from provider session/runtime artifacts.

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { git, gitStatusText, runCheck, failureEvidence } from '../dev/verify.mjs';

export const CONTROL_DB_PATH = '.landos/control/landos-control.db';
export const STATE_PATH = '.landos/STATE.md';
export const DEFAULT_AUTHORITY_REF = 'main';
export const SCHEMA_VERSION = 1;

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

function databasePath(root, override) {
  return override ? path.resolve(override) : path.join(path.resolve(root), CONTROL_DB_PATH);
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

    CREATE TABLE IF NOT EXISTS development_attempt (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES development_task(id),
      worker TEXT NOT NULL,
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

    CREATE INDEX IF NOT EXISTS idx_attempt_task ON development_attempt(task_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_evidence_attempt ON development_evidence(attempt_id, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_verification_attempt ON development_verification(attempt_id, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_acceptance_state ON acceptance_operation(state, prepared_at);

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

  db.prepare(`
    INSERT INTO control_meta(key, value) VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(SCHEMA_VERSION));
}

export function openControlState(root, { dbPath, readonly = false } = {}) {
  const file = databasePath(root, dbPath);
  if (!readonly) mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file, readonly ? { readonly: true, fileMustExist: true } : undefined);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (!readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    migrate(db);
  }
  return { db, file, close: () => db.close() };
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

export function startAttempt(db, input, now) {
  const task = taskFor(db, input.taskId);
  if (task.status === 'ACCEPTED') throw new Error(`task ${task.id} is already ACCEPTED`);
  if (task.status === 'ACCEPTANCE_PENDING') {
    throw new Error(`task ${task.id} has an ACCEPTANCE_PENDING operation; reconcile it before another attempt`);
  }
  const at = nowIso(now);
  const attemptId = input.id ? required(input.id, 'attempt id') : `attempt-${randomUUID()}`;
  const baseSha = input.baseGitSha ? normalizedSha(input.baseGitSha, 'base Git SHA') : null;
  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO development_attempt(
        id, task_id, worker, approach, status, base_git_sha, started_at, updated_at
      ) VALUES (?, ?, ?, ?, 'IN_PROGRESS', ?, ?, ?)
    `).run(
      attemptId,
      task.id,
      required(input.worker, 'worker'),
      required(input.approach, 'attempt approach'),
      baseSha,
      at,
      at,
    );
    db.prepare(`
      UPDATE development_task
      SET status = 'IN_PROGRESS', blocker = NULL, next_action = ?, updated_at = ?
      WHERE id = ?
    `).run(input.nextAction ? required(input.nextAction, 'attempt next action') : 'Complete the attempt and submit a candidate.', at, task.id);
  });
  transaction();
  return attemptFor(db, attemptId);
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
  if (attempt.status === 'ACCEPTED') throw new Error(`attempt ${attempt.id} is already ACCEPTED`);
  if (attempt.status === 'ACCEPTANCE_PENDING') {
    throw new Error(`attempt ${attempt.id} is ACCEPTANCE_PENDING and may only be reconciled by the Integration Gate`);
  }
  const sha = resolveCommit(root, input.gitSha);
  const at = nowIso(now);
  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE development_attempt
      SET status = 'CANDIDATE', candidate_git_sha = ?, result = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(sha, required(input.result, 'candidate result'), at, at, attempt.id);
    db.prepare(`
      UPDATE development_task
      SET status = 'CANDIDATE', blocker = NULL,
          next_action = 'Run deterministic verification against the exact candidate commit.', updated_at = ?
      WHERE id = ?
    `).run(at, attempt.task_id);
  });
  transaction();
  return attemptFor(db, attempt.id);
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
  if (existing) return existing;
  const taskPending = db.prepare(`
    SELECT id FROM acceptance_operation
    WHERE task_id = ? AND state = 'ACCEPTANCE_PENDING'
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

export function reconcileAcceptance(db, root, input = {}, now) {
  const pending = input.id
    ? [acceptanceFor(db, input.id)]
    : db.prepare(`
        SELECT * FROM acceptance_operation
        WHERE state = 'ACCEPTANCE_PENDING'
        ORDER BY prepared_at, id
      `).all();
  const results = [];
  for (const original of pending) {
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
    '> Generated from `.landos/control/landos-control.db` plus live Git. Do not edit this file as project truth.',
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
