#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  addEvidence,
  controlSnapshot,
  createTask,
  generateStateFile,
  listFailures,
  openControlState,
  prepareAcceptance,
  reconcileAcceptance,
  renderStateMarkdown,
  runVerification,
  startAttempt,
  submitCandidate,
} from './control-state.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'landos-control.mjs');
const at = (value) => () => value;

function runGit(dir, ...args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed:\n${result.stderr}`);
  return result.stdout.trim();
}

function tempRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'landos-control-'));
  runGit(dir, 'init', '-q', '-b', 'main');
  runGit(dir, 'config', 'user.email', 'control@example.com');
  runGit(dir, 'config', 'user.name', 'Control Spine Test');
  writeFileSync(path.join(dir, '.gitignore'), '*.db\n*.db-wal\n*.db-shm\n.landos/STATE.md\n');
  writeFileSync(path.join(dir, 'implementation.txt'), 'base\n');
  runGit(dir, 'add', '.gitignore', 'implementation.txt');
  runGit(dir, 'commit', '-q', '-m', 'base');
  const baseSha = runGit(dir, 'rev-parse', 'HEAD');
  return {
    dir,
    baseSha,
    dbPath: path.join(dir, '.landos', 'control', 'landos-control.db'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function makeCandidate(repo) {
  runGit(repo.dir, 'checkout', '-q', '-b', 'candidate');
  writeFileSync(path.join(repo.dir, 'implementation.txt'), 'candidate\n');
  runGit(repo.dir, 'add', 'implementation.txt');
  runGit(repo.dir, 'commit', '-q', '-m', 'candidate implementation');
  return runGit(repo.dir, 'rev-parse', 'HEAD');
}

test('PASS is durable evidence but only the Integration Gate can produce ACCEPTED', async (t) => {
  const repo = tempRepo();
  t.after(repo.cleanup);
  const candidateSha = makeCandidate(repo);
  const state = openControlState(repo.dir);
  t.after(() => {
    try { state.close(); } catch { /* already closed for fresh-process proof */ }
  });

  createTask(state.db, {
    id: 'slice-1',
    title: 'Prove the control lifecycle',
    outcome: 'A verified candidate is accepted only at its exact main commit.',
    nextAction: 'Start the first attempt.',
  }, at('2026-08-16T20:00:00.000Z'));
  startAttempt(state.db, {
    id: 'attempt-pass',
    taskId: 'slice-1',
    worker: 'codex',
    approach: 'Build the smallest SQLite-backed lifecycle.',
    baseGitSha: repo.baseSha,
  }, at('2026-08-16T20:01:00.000Z'));
  addEvidence(state.db, {
    attemptId: 'attempt-pass',
    kind: 'implementation_note',
    summary: 'Candidate contains the complete vertical slice.',
    path: 'implementation.txt',
  }, at('2026-08-16T20:02:00.000Z'));
  submitCandidate(state.db, repo.dir, {
    attemptId: 'attempt-pass',
    gitSha: candidateSha,
    result: 'Candidate lifecycle implemented.',
  }, at('2026-08-16T20:03:00.000Z'));

  const verification = await runVerification(state.db, repo.dir, {
    attemptId: 'attempt-pass',
    command: 'node -e "process.exit(0)"',
    summary: 'Focused candidate verification passed.',
  }, at('2026-08-16T20:04:00.000Z'));
  assert.equal(verification.outcome, 'PASS');
  assert.equal(controlSnapshot(state.db).activeTask.status, 'CANDIDATE');
  assert.equal(controlSnapshot(state.db).latestAccepted, null);

  assert.throws(() => state.db.prepare(`
    UPDATE development_task
    SET status = 'ACCEPTED', accepted_attempt_id = ?, accepted_git_sha = ?, accepted_at = ?
    WHERE id = ?
  `).run('attempt-pass', candidateSha, '2026-08-16T20:05:00.000Z', 'slice-1'), /only the Integration Gate/i);

  const operation = prepareAcceptance(state.db, repo.dir, {
    id: 'gate-pass',
    attemptId: 'attempt-pass',
  }, at('2026-08-16T20:05:00.000Z'));
  assert.equal(operation.state, 'ACCEPTANCE_PENDING');
  assert.throws(() => startAttempt(state.db, {
    id: 'attempt-too-soon',
    taskId: 'slice-1',
    worker: 'codex',
    approach: 'This must wait for gate reconciliation.',
  }), /reconcile it before another attempt/i);

  const beforePromotion = reconcileAcceptance(state.db, repo.dir, { id: operation.id }, at('2026-08-16T20:06:00.000Z'));
  assert.equal(beforePromotion[0].reconciled, false);
  assert.match(beforePromotion[0].blocker, /main is/);
  assert.equal(controlSnapshot(state.db).activeTask.status, 'ACCEPTANCE_PENDING');

  // Simulate process loss in the exact pending window. Git promotion happens
  // while the original control process is gone.
  state.close();
  runGit(repo.dir, 'checkout', '-q', 'main');
  runGit(repo.dir, 'merge', '--ff-only', '-q', 'candidate');
  assert.equal(runGit(repo.dir, 'rev-parse', 'main'), candidateSha);

  const recovered = openControlState(repo.dir);
  const reconciled = reconcileAcceptance(recovered.db, repo.dir, { id: operation.id }, at('2026-08-16T20:07:00.000Z'));
  assert.equal(reconciled[0].reconciled, true);
  assert.equal(reconciled[0].state, 'ACCEPTED');
  const snapshot = controlSnapshot(recovered.db);
  assert.equal(snapshot.activeTask, null);
  assert.equal(snapshot.latestAccepted.accepted_git_sha, candidateSha);
  assert.equal(snapshot.latestAccepted.accepted_attempt_id, 'attempt-pass');

  const once = renderStateMarkdown(recovered.db, repo.dir);
  const twice = renderStateMarkdown(recovered.db, repo.dir);
  assert.equal(twice, once);
  assert.match(once, new RegExp(candidateSha));
  assert.match(once, /Current task[\s\S]*- none/);
  assert.match(once, /Blockers[\s\S]*- none/);
  assert.equal(generateStateFile(recovered.db, repo.dir).changed, true);
  assert.equal(generateStateFile(recovered.db, repo.dir).changed, false);
  assert.equal(readFileSync(path.join(repo.dir, '.landos', 'STATE.md'), 'utf8'), once);
  recovered.close();

  const fresh = spawnSync(process.execPath, [SCRIPT, 'status', '--root', repo.dir, '--json'], {
    cwd: repo.dir,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  const reconstructed = JSON.parse(fresh.stdout);
  assert.equal(reconstructed.latestAccepted.accepted_git_sha, candidateSha);
  assert.equal(reconstructed.git.authoritySha, candidateSha);
});

test('failed verification survives process loss with evidence and a useful next direction', async (t) => {
  const repo = tempRepo();
  t.after(repo.cleanup);
  const candidateSha = makeCandidate(repo);
  const state = openControlState(repo.dir);

  createTask(state.db, {
    id: 'slice-failure',
    title: 'Retain failed knowledge',
    outcome: 'A future builder can retrieve why the attempt failed.',
    nextAction: 'Try the candidate.',
  }, at('2026-08-16T21:00:00.000Z'));
  startAttempt(state.db, {
    id: 'attempt-fail',
    taskId: 'slice-failure',
    worker: 'codex',
    approach: 'Use a candidate with a deliberately failing verification command.',
    baseGitSha: repo.baseSha,
  }, at('2026-08-16T21:01:00.000Z'));
  submitCandidate(state.db, repo.dir, {
    attemptId: 'attempt-fail',
    gitSha: candidateSha,
    result: 'Candidate ready for the failure-path proof.',
  }, at('2026-08-16T21:02:00.000Z'));
  const verification = await runVerification(state.db, repo.dir, {
    attemptId: 'attempt-fail',
    command: 'node -e "process.exit(9)"',
    rootCause: 'The candidate violates the focused verification invariant.',
    limitation: 'Exit code 9 prevents promotion.',
    nextDirection: 'Repair the invariant and start a new attempt from this evidence.',
  }, at('2026-08-16T21:03:00.000Z'));
  assert.equal(verification.outcome, 'FAIL');
  state.close();

  const recovered = openControlState(repo.dir);
  const failures = listFailures(recovered.db, 'slice-failure');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].approach, 'Use a candidate with a deliberately failing verification command.');
  assert.equal(failures[0].root_cause, 'The candidate violates the focused verification invariant.');
  assert.equal(failures[0].limitation, 'Exit code 9 prevents promotion.');
  assert.equal(failures[0].next_direction, 'Repair the invariant and start a new attempt from this evidence.');
  assert.equal(failures[0].evidence.length, 1);
  assert.equal(failures[0].evidence[0].kind, 'verification_result');
  assert.equal(failures[0].evidence[0].exitCode, 9);
  const markdown = renderStateMarkdown(recovered.db, repo.dir);
  assert.match(markdown, /Latest relevant failed attempt/);
  assert.match(markdown, /Repair the invariant and start a new attempt/);
  recovered.close();
});

test('a pending acceptance never follows main to a different commit', async (t) => {
  const repo = tempRepo();
  t.after(repo.cleanup);
  const candidateSha = makeCandidate(repo);
  const state = openControlState(repo.dir);
  createTask(state.db, {
    id: 'slice-mismatch',
    title: 'Reject contradictory promotion',
    outcome: 'The gate accepts only its exact pending SHA.',
    nextAction: 'Build candidate.',
  });
  startAttempt(state.db, {
    id: 'attempt-mismatch',
    taskId: 'slice-mismatch',
    worker: 'codex',
    approach: 'Prepare one commit, then move main to a different commit.',
    baseGitSha: repo.baseSha,
  });
  submitCandidate(state.db, repo.dir, {
    attemptId: 'attempt-mismatch',
    gitSha: candidateSha,
    result: 'Exact candidate submitted.',
  });
  await runVerification(state.db, repo.dir, {
    attemptId: 'attempt-mismatch',
    command: 'node -e "process.exit(0)"',
  });
  const operation = prepareAcceptance(state.db, repo.dir, {
    id: 'gate-mismatch',
    attemptId: 'attempt-mismatch',
  });

  runGit(repo.dir, 'checkout', '-q', 'main');
  writeFileSync(path.join(repo.dir, 'different.txt'), 'different main commit\n');
  runGit(repo.dir, 'add', 'different.txt');
  runGit(repo.dir, 'commit', '-q', '-m', 'different integration');
  const differentSha = runGit(repo.dir, 'rev-parse', 'main');
  assert.notEqual(differentSha, candidateSha);

  const result = reconcileAcceptance(state.db, repo.dir, { id: operation.id });
  assert.equal(result[0].reconciled, false);
  assert.match(result[0].blocker, new RegExp(`main is ${differentSha}`));
  assert.equal(controlSnapshot(state.db).latestAccepted, null);
  assert.equal(controlSnapshot(state.db).activeTask.status, 'ACCEPTANCE_PENDING');
  state.close();
});
