#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  addEvidence,
  controlSnapshot,
  createTask,
  failAttempt,
  generateStateFile,
  initializeControlState,
  listFailures,
  openControlState,
  openControlStateWriter,
  prepareAcceptance,
  reconcileAcceptance,
  renderStateMarkdown,
  resolveControlDatabasePath,
  releaseManagedWorkspace,
  runVerification,
  SCHEMA_VERSION,
  setTaskContract,
  startAttempt,
  startManagedAttempt,
  supersedeAcceptance,
  validateManagedWorkspace,
} from './control-state.mjs';
import { TEST_ONLY } from './builder-adapter.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'landos-control.mjs');
const at = (value) => () => value;

function runGit(dir, ...args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed:\n${result.stderr}`);
  return result.stdout.trim();
}

function tempRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'landos-control-'));
  const managedWorkspaces = new Set();
  runGit(dir, 'init', '-q', '-b', 'main');
  runGit(dir, 'config', 'user.email', 'control@example.com');
  runGit(dir, 'config', 'user.name', 'Control Spine Test');
  mkdirSync(path.join(dir, '.landos'), { recursive: true });
  writeFileSync(path.join(dir, '.landos', 'CODING_SESSION_PROTOCOL.md'), 'canonical policy\n');
  writeFileSync(path.join(dir, '.landos', 'PERMANENT_MEMORY.md'), 'canonical invariants\n');
  writeFileSync(path.join(dir, '.landos', 'capabilities.json'), JSON.stringify({ schema: 1, capabilities: [] }));
  writeFileSync(path.join(dir, '.gitignore'), '*.db\n*.db-wal\n*.db-shm\n.landos/STATE.md\n');
  writeFileSync(path.join(dir, 'implementation.txt'), 'base\n');
  runGit(dir, 'add', '.landos', '.gitignore', 'implementation.txt');
  runGit(dir, 'commit', '-q', '-m', 'base');
  const baseSha = runGit(dir, 'rev-parse', 'HEAD');
  return {
    dir,
    baseSha,
    dbPath: path.join(dir, '.git', 'landos', 'control', 'landos-control.db'),
    managedWorkspaces,
    cleanup: () => {
      for (const workspace of managedWorkspaces) {
        spawnSync('git', ['worktree', 'remove', '--force', workspace], { cwd: dir, encoding: 'utf8', windowsHide: true });
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function startOwnedAttempt(state, repo, input, now) {
  const attemptId = input.id ?? `attempt-${Math.random().toString(16).slice(2)}`;
  const workspacePath = input.workspacePath ?? `${repo.dir}-${attemptId}-workspace`;
  const allocation = startManagedAttempt(state.db, repo.dir, {
    ...input,
    id: attemptId,
    writerId: input.writerId ?? `${input.worker}-${attemptId}`,
    workspacePath,
    branch: input.branch ?? `task/${attemptId}`,
    baseGitSha: input.baseGitSha ?? repo.baseSha,
  }, now);
  repo.managedWorkspaces.add(workspacePath);
  return allocation;
}

async function completeGovernedCandidate(state, repo, attemptId, result) {
  const attempt = state.db.prepare('SELECT * FROM development_attempt WHERE id = ?').get(attemptId);
  const workspace = state.db.prepare(`
    SELECT * FROM managed_workspace WHERE attempt_id = ? AND status = 'ACTIVE'
  `).get(attemptId);
  writeFileSync(path.join(workspace.workspace_path, 'implementation.txt'), `${attemptId} candidate\n`);
  runGit(workspace.workspace_path, 'add', 'implementation.txt');
  runGit(workspace.workspace_path, 'commit', '-q', '-m', `${attemptId} candidate implementation`);
  const candidateSha = runGit(workspace.workspace_path, 'rev-parse', 'HEAD');
  setTaskContract(state.db, repo.dir, {
    taskId: attempt.task_id,
    objective: state.db.prepare('SELECT outcome FROM development_task WHERE id = ?').get(attempt.task_id).outcome,
    nonGoals: ['Do not alter unrelated behavior.'],
    acceptedBaseGitSha: repo.baseSha,
    workingBaseGitSha: attempt.base_git_sha,
    riskPolicy: 'low',
    acceptancePolicy: 'Exact-SHA Integration Gate only.',
    architectureRefs: [],
    invariantRefs: ['.landos/PERMANENT_MEMORY.md'],
    ownedScope: ['implementation.txt'],
    ownedInterfaces: [],
    verificationObligations: ['Focused lifecycle command passes.'],
    verificationPolicyRefs: ['.landos/CODING_SESSION_PROTOCOL.md'],
    runtimeConstraints: [],
    resourceConstraints: [],
    relevantCapabilityIds: [],
    relevantTaskIds: [],
    policyGitSha: attempt.base_git_sha,
  });
  const submitted = await TEST_ONLY.runGovernedExecutionWithProvider(state.db, repo.dir, {
    taskId: attempt.task_id,
    attemptId,
    writerId: workspace.writer_id,
    cwd: workspace.workspace_path,
    provider: 'codex',
  }, async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ result }),
      candidateCommit: candidateSha,
      changedPaths: ['implementation.txt'],
    }));
  assert.equal(submitted.state, 'SUBMITTED');
  return candidateSha;
}

function activeWorkspacePath(state, attemptId) {
  return state.db.prepare(`
    SELECT workspace_path FROM managed_workspace WHERE attempt_id = ? AND status = 'ACTIVE'
  `).get(attemptId).workspace_path;
}

test('separate Git worktrees resolve and operate on one shared canonical database', (t) => {
  const repo = tempRepo();
  const second = `${repo.dir}-second-worktree`;
  t.after(() => {
    rmSync(second, { recursive: true, force: true });
    repo.cleanup();
  });
  runGit(repo.dir, 'worktree', 'add', '-q', '-b', 'second-worktree', second);

  const legacyPath = path.join(repo.dir, '.landos', 'control', 'landos-control.db');
  const legacy = initializeControlState(repo.dir, { dbPath: legacyPath });
  createTask(legacy.db, {
    id: 'shared-control-state',
    title: 'Share canonical state across worktrees',
    outcome: 'Every worktree observes one development-control universe.',
    nextAction: 'Start the shared attempt from another worktree.',
  });
  legacy.close();

  const firstPath = resolveControlDatabasePath(repo.dir);
  const secondPath = resolveControlDatabasePath(second);
  assert.equal(secondPath, firstPath);
  assert.equal(firstPath, repo.dbPath);

  const fromSecond = initializeControlState(second);
  assert.equal(existsSync(firstPath), true);
  assert.equal(existsSync(legacyPath), true);
  assert.equal(existsSync(path.join(second, '.landos', 'control', 'landos-control.db')), false);
  assert.equal(controlSnapshot(fromSecond.db).activeTask.id, 'shared-control-state');
  const allocation = startOwnedAttempt(fromSecond, repo, {
    id: 'shared-attempt',
    taskId: 'shared-control-state',
    worker: 'second-worktree',
    approach: 'Open the shared database through the second worktree.',
    baseGitSha: repo.baseSha,
  });
  assert.equal(allocation.attempt.status, 'IN_PROGRESS');
  fromSecond.close();

  const fromFirst = openControlState(repo.dir);
  assert.equal(fromFirst.file, fromSecond.file);
  assert.equal(
    fromFirst.db.prepare('SELECT worker FROM development_attempt WHERE id = ?').get('shared-attempt').worker,
    'second-worktree',
  );
  fromFirst.close();
});

test('schema version is monotonic and writers require explicit current-client initialization', (t) => {
  const repo = tempRepo();
  const state = initializeControlState(repo.dir);
  t.after(() => { state.close(); repo.cleanup(); });
  assert.equal(state.db.prepare("SELECT value FROM control_meta WHERE key = 'schema_version'").get().value, String(SCHEMA_VERSION));
  assert.throws(
    () => state.db.prepare('UPDATE control_meta SET value = ? WHERE key = \'schema_version\'').run(String(SCHEMA_VERSION - 1)),
    /cannot be downgraded/i,
  );
  assert.equal(state.db.prepare("SELECT value FROM control_meta WHERE key = 'schema_version'").get().value, String(SCHEMA_VERSION));
});

test('managed allocation is the only writable attempt path and validates exact owner identity', (t) => {
  const repo = tempRepo();
  const state = initializeControlState(repo.dir);
  t.after(() => { state.close(); repo.cleanup(); });
  createTask(state.db, { id: 'owned-task', title: 'Owned', outcome: 'One writable workspace.', nextAction: 'Allocate.' });
  createTask(state.db, { id: 'other-task', title: 'Other', outcome: 'Cannot take another workspace.', nextAction: 'Wait.' });

  assert.throws(() => startAttempt(state.db, {
    id: 'unowned-attempt', taskId: 'owned-task', worker: 'codex', approach: 'Bypass workspace ownership.', baseGitSha: repo.baseSha,
  }), /managed workspace allocation/i);
  assert.throws(() => state.db.prepare(`
    INSERT INTO development_attempt(
      id, task_id, worker, primary_writer_id, approach, status, base_git_sha, started_at, updated_at
    ) VALUES ('sql-bypass', 'owned-task', 'codex', 'sql-writer', 'Bypass the allocator.', 'IN_PROGRESS', ?, '2026-08-17T00:00:00.000Z', '2026-08-17T00:00:00.000Z')
  `).run(repo.baseSha), /requires exactly one active managed workspace/i);
  assert.equal(state.db.prepare("SELECT COUNT(*) AS count FROM development_attempt WHERE status = 'IN_PROGRESS'").get().count, 0);

  const allocation = startOwnedAttempt(state, repo, {
    id: 'owned-attempt', taskId: 'owned-task', worker: 'codex', writerId: 'writer-owned',
    approach: 'Allocate a native owned workspace.', baseGitSha: repo.baseSha,
  });
  const { workspace } = allocation;
  assert.equal(allocation.attempt.status, 'IN_PROGRESS');
  assert.equal(workspace.status, 'ACTIVE');
  assert.equal(workspace.writer_id, 'writer-owned');
  assert.throws(() => startOwnedAttempt(state, repo, {
    id: 'same-writer', taskId: 'other-task', worker: 'claude', writerId: 'writer-owned',
    approach: 'Try to reuse an active primary writer.', baseGitSha: repo.baseSha,
  }), /active managed workspace/i);
  const other = startOwnedAttempt(state, repo, {
    id: 'other-attempt', taskId: 'other-task', worker: 'claude', writerId: 'other-writer',
    approach: 'Create a distinct owned workspace for wrong-attempt checks.', baseGitSha: repo.baseSha,
  });

  assert.throws(() => validateManagedWorkspace(state.db, repo.dir, {
    taskId: 'owned-task', attemptId: 'owned-attempt', writerId: 'writer-owned', cwd: repo.dir,
  }), /working directory/i);
  assert.throws(() => validateManagedWorkspace(state.db, repo.dir, {
    taskId: 'other-task', attemptId: 'owned-attempt', writerId: 'writer-owned', cwd: workspace.workspace_path,
  }), /does not belong/i);
  assert.throws(() => validateManagedWorkspace(state.db, repo.dir, {
    taskId: 'owned-task', attemptId: 'other-attempt', writerId: 'other-writer', cwd: other.workspace.workspace_path,
  }), /does not belong/i);
  assert.throws(() => validateManagedWorkspace(state.db, repo.dir, {
    taskId: 'owned-task', attemptId: 'owned-attempt', writerId: 'wrong-writer', cwd: workspace.workspace_path,
  }), /does not own attempt/i);
  assert.equal(validateManagedWorkspace(state.db, repo.dir, {
    taskId: 'owned-task', attemptId: 'owned-attempt', writerId: 'writer-owned', cwd: workspace.workspace_path,
  }).id, workspace.id);

  assert.throws(() => releaseManagedWorkspace(state.db, repo.dir, {
    id: workspace.id, taskId: 'other-task', attemptId: 'owned-attempt', writerId: 'writer-owned',
  }), /does not own/i);
  assert.throws(() => releaseManagedWorkspace(state.db, repo.dir, {
    id: workspace.id, taskId: 'owned-task', attemptId: 'other-attempt', writerId: 'other-writer',
  }), /does not own/i);
  assert.throws(() => releaseManagedWorkspace(state.db, repo.dir, {
    id: workspace.id, taskId: 'owned-task', attemptId: 'owned-attempt', writerId: 'wrong-writer',
  }), /does not own/i);
  assert.throws(() => releaseManagedWorkspace(state.db, repo.dir, {
    id: workspace.id, taskId: 'owned-task', attemptId: 'owned-attempt', writerId: 'writer-owned',
  }), /while its attempt is writable/i);

  failAttempt(state.db, { attemptId: 'owned-attempt', result: 'Finish release proof.' });
  writeFileSync(path.join(workspace.workspace_path, 'primary-dirty.txt'), 'primary writer work\n');
  assert.throws(() => releaseManagedWorkspace(state.db, repo.dir, {
    id: workspace.id, taskId: 'owned-task', attemptId: 'owned-attempt', writerId: 'writer-owned',
  }), /uncommitted work/i);
  assert.equal(existsSync(path.join(workspace.workspace_path, 'primary-dirty.txt')), true);
  rmSync(path.join(workspace.workspace_path, 'primary-dirty.txt'));
  assert.equal(releaseManagedWorkspace(state.db, repo.dir, {
    id: workspace.id, taskId: 'owned-task', attemptId: 'owned-attempt', writerId: 'writer-owned',
  }).status, 'RELEASED');
  repo.managedWorkspaces.delete(workspace.workspace_path);
  assert.equal(existsSync(workspace.workspace_path), false);
  assert.throws(() => releaseManagedWorkspace(state.db, repo.dir, {
    id: workspace.id, taskId: 'owned-task', attemptId: 'owned-attempt', writerId: 'writer-owned',
  }), /not actively owned/i);
});

test('PASS is durable evidence but only the Integration Gate can produce ACCEPTED', async (t) => {
  const repo = tempRepo();
  t.after(repo.cleanup);
  const state = initializeControlState(repo.dir);
  t.after(() => {
    try { state.close(); } catch { /* already closed for fresh-process proof */ }
  });

  createTask(state.db, {
    id: 'slice-1',
    title: 'Prove the control lifecycle',
    outcome: 'A verified candidate is accepted only at its exact main commit.',
    nextAction: 'Start the first attempt.',
  }, at('2026-08-16T20:00:00.000Z'));
  startOwnedAttempt(state, repo, {
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
  const candidateSha = await completeGovernedCandidate(
    state, repo, 'attempt-pass', 'Candidate lifecycle implemented.',
  );

  const verification = await runVerification(state.db, activeWorkspacePath(state, 'attempt-pass'), {
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
  runGit(repo.dir, 'merge', '--ff-only', '-q', candidateSha);
  assert.equal(runGit(repo.dir, 'rev-parse', 'main'), candidateSha);

  const recovered = openControlStateWriter(repo.dir);
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

  const beforeStatus = { bytes: readFileSync(repo.dbPath), stat: statSync(repo.dbPath) };
  const fresh = spawnSync(process.execPath, [SCRIPT, 'status', '--root', repo.dir, '--json'], {
    cwd: repo.dir,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  const reconstructed = JSON.parse(fresh.stdout);
  assert.equal(reconstructed.latestAccepted.accepted_git_sha, candidateSha);
  assert.equal(reconstructed.git.authoritySha, candidateSha);
  const afterStatus = { bytes: readFileSync(repo.dbPath), stat: statSync(repo.dbPath) };
  assert.deepEqual(afterStatus.bytes, beforeStatus.bytes);
  assert.equal(afterStatus.stat.size, beforeStatus.stat.size);
  assert.equal(afterStatus.stat.mtimeMs, beforeStatus.stat.mtimeMs);
});

test('failed verification survives process loss with evidence and a useful next direction', async (t) => {
  const repo = tempRepo();
  t.after(repo.cleanup);
  const state = initializeControlState(repo.dir);

  createTask(state.db, {
    id: 'slice-failure',
    title: 'Retain failed knowledge',
    outcome: 'A future builder can retrieve why the attempt failed.',
    nextAction: 'Try the candidate.',
  }, at('2026-08-16T21:00:00.000Z'));
  startOwnedAttempt(state, repo, {
    id: 'attempt-fail',
    taskId: 'slice-failure',
    worker: 'codex',
    approach: 'Use a candidate with a deliberately failing verification command.',
    baseGitSha: repo.baseSha,
  }, at('2026-08-16T21:01:00.000Z'));
  const candidateSha = await completeGovernedCandidate(
    state, repo, 'attempt-fail', 'Candidate ready for the failure-path proof.',
  );
  const verification = await runVerification(state.db, activeWorkspacePath(state, 'attempt-fail'), {
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
  const state = initializeControlState(repo.dir);
  createTask(state.db, {
    id: 'slice-mismatch',
    title: 'Reject contradictory promotion',
    outcome: 'The gate accepts only its exact pending SHA.',
    nextAction: 'Build candidate.',
  });
  startOwnedAttempt(state, repo, {
    id: 'attempt-mismatch',
    taskId: 'slice-mismatch',
    worker: 'codex',
    approach: 'Prepare one commit, then move main to a different commit.',
    baseGitSha: repo.baseSha,
  });
  const candidateSha = await completeGovernedCandidate(state, repo, 'attempt-mismatch', 'Exact candidate submitted.');
  await runVerification(state.db, activeWorkspacePath(state, 'attempt-mismatch'), {
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

test('an invalidated pending candidate becomes durable failure knowledge before a replacement attempt', async (t) => {
  const repo = tempRepo();
  t.after(repo.cleanup);
  const state = initializeControlState(repo.dir);
  createTask(state.db, {
    id: 'slice-supersession',
    title: 'Replace an invalid pending candidate',
    outcome: 'The invalid candidate remains durable failure knowledge.',
    nextAction: 'Build candidate.',
  });
  startOwnedAttempt(state, repo, {
    id: 'attempt-superseded',
    taskId: 'slice-supersession',
    worker: 'codex',
    approach: 'Prepare a candidate that is invalidated before integration.',
    baseGitSha: repo.baseSha,
  });
  const candidateSha = await completeGovernedCandidate(state, repo, 'attempt-superseded', 'Candidate submitted.');
  await runVerification(state.db, activeWorkspacePath(state, 'attempt-superseded'), {
    attemptId: 'attempt-superseded',
    command: 'node -e "process.exit(0)"',
  });
  prepareAcceptance(state.db, repo.dir, {
    id: 'gate-superseded',
    attemptId: 'attempt-superseded',
  });

  const superseded = supersedeAcceptance(state.db, {
    id: 'gate-superseded',
    reason: 'A pre-promotion invariant invalidated this candidate.',
    nextDirection: 'Create a corrected replacement candidate.',
  });
  assert.equal(superseded.state, 'SUPERSEDED');
  assert.equal(controlSnapshot(state.db).pendingAcceptances.length, 0);
  assert.equal(
    listFailures(state.db, 'slice-supersession')[0].root_cause,
    'A pre-promotion invariant invalidated this candidate.',
  );
  const supersededWorkspace = state.db.prepare(`
    SELECT * FROM managed_workspace WHERE attempt_id = 'attempt-superseded' AND status = 'ACTIVE'
  `).get();
  assert.equal(releaseManagedWorkspace(state.db, repo.dir, {
    id: supersededWorkspace.id,
    taskId: 'slice-supersession',
    attemptId: 'attempt-superseded',
    writerId: supersededWorkspace.writer_id,
  }).status, 'RELEASED');
  repo.managedWorkspaces.delete(supersededWorkspace.workspace_path);
  const replacement = startOwnedAttempt(state, repo, {
    id: 'attempt-replacement',
    taskId: 'slice-supersession',
    worker: 'codex',
    approach: 'Repair the invalidated invariant.',
    baseGitSha: candidateSha,
  });
  assert.equal(replacement.attempt.status, 'IN_PROGRESS');
  const reconciliation = reconcileAcceptance(state.db, repo.dir, { id: 'gate-superseded' });
  assert.equal(reconciliation[0].superseded, true);
  assert.equal(controlSnapshot(state.db).latestAccepted, null);
  state.close();
});
