import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createTask,
  initializeControlState,
  listFailures,
  recordContextPackDelivery,
  startManagedAttempt,
  submitCandidate,
} from './control-state.mjs';
import { runGovernedExecution, TEST_ONLY } from './builder-adapter.mjs';

function git(dir, ...args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'landos-execution-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'x@y.z');
  git(dir, 'config', 'user.name', 'x');
  writeFileSync(path.join(dir, '.gitignore'), '*.db\n');
  writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  return {
    dir,
    base: git(dir, 'rev-parse', 'HEAD'),
    workspaces: [],
    cleanup() {
      for (const item of this.workspaces) {
        if (spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: dir, encoding: 'utf8' }).stdout.includes(item)) {
          git(dir, 'worktree', 'remove', '--force', item);
        }
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function allocate(state, repo, id, { deliver = true } = {}) {
  createTask(state.db, { id: `task-${id}`, title: id, outcome: `Canonical ${id} objective`, nextAction: 'Execute.' });
  const workspacePath = `${repo.dir}-${id}`;
  repo.workspaces.push(workspacePath);
  const allocation = startManagedAttempt(state.db, repo.dir, {
    id: `attempt-${id}`,
    taskId: `task-${id}`,
    worker: 'builder',
    writerId: `writer-${id}`,
    workspaceId: `workspace-${id}`,
    workspacePath,
    branch: `task/${id}`,
    baseGitSha: repo.base,
    approach: 'Governed execution fixture.',
  });
  if (deliver) {
    allocation.delivery = recordContextPackDelivery(state.db, {
      attemptId: allocation.attempt.id,
      workspaceId: allocation.workspace.id,
      canonicalJson: JSON.stringify({ taskId: allocation.attempt.task_id, attemptId: allocation.attempt.id }),
    });
  }
  return allocation;
}

function request(allocation, provider = 'codex') {
  return {
    taskId: allocation.attempt.task_id,
    attemptId: allocation.attempt.id,
    writerId: allocation.workspace.writer_id,
    cwd: allocation.workspace.workspace_path,
    provider,
    contextPackHash: allocation.delivery.context_pack_hash,
  };
}

function runFixture(db, root, input, runProvider) {
  return TEST_ONLY.runGovernedExecutionWithProvider(db, root, input, runProvider);
}

test('Claude, Codex, and Grok executions persist one bound bundle and internally observed candidate SHA', async (t) => {
  const repo = fixture();
  const state = initializeControlState(repo.dir);
  t.after(() => { state.close(); repo.cleanup(); });
  const raws = {
    claude: { exitCode: 0, stdout: JSON.stringify({ session_id: 'claude-session', model: 'claude-fixture', result: 'Claude claim' }), changedPaths: ['a.ts'] },
    codex: { exitCode: 0, stdout: `${JSON.stringify({ thread_id: 'codex-thread', model: 'codex-fixture', changed_paths: ['b.ts'], result: 'Codex claim' })}\n` },
    grok: { exitCode: 0, stdout: JSON.stringify({ session_id: 'grok-session', model: 'grok-fixture', output: 'Grok claim', changedPaths: ['c.ts'] }) },
  };
  for (const provider of Object.keys(raws)) {
    const allocation = allocate(state, repo, provider);
    const result = await runFixture(
      state.db,
      repo.dir,
      request(allocation, provider),
      async () => raws[provider],
    );
    assert.equal(result.state, 'SUBMITTED');
    assert.equal(result.bundle.provider, provider);
    assert.equal(result.bundle.attempt_id, allocation.attempt.id);
    assert.equal(result.bundle.execution_id, result.execution.id);
    assert.equal(result.bundle.context_pack_hash, allocation.delivery.context_pack_hash);
    assert.equal(result.bundle.candidate_git_sha, git(allocation.workspace.workspace_path, 'rev-parse', 'HEAD'));
    assert.equal(result.attempt.status, 'CANDIDATE');
  }
  assert.equal(state.db.prepare('SELECT COUNT(*) AS count FROM governed_execution WHERE state = ?').get('COMPLETED').count, 3);
  assert.equal(state.db.prepare('SELECT COUNT(*) AS count FROM submission_bundle WHERE execution_id IS NOT NULL').get().count, 3);
});

test('manual candidate submission and candidate state without a bundle are mechanically refused', (t) => {
  const repo = fixture();
  const state = initializeControlState(repo.dir);
  t.after(() => { state.close(); repo.cleanup(); });

  const manual = allocate(state, repo, 'manual');
  assert.throws(() => submitCandidate(state.db, repo.dir, {
    attemptId: manual.attempt.id,
    gitSha: repo.base,
    result: 'caller claim',
  }), /manual candidate submission is disabled/i);
  assert.equal(state.db.prepare('SELECT status FROM development_attempt WHERE id = ?').get(manual.attempt.id).status, 'FAILED');
  assert.equal(state.db.prepare('SELECT COUNT(*) AS count FROM governed_execution WHERE attempt_id = ?').get(manual.attempt.id).count, 0);
  assert.equal(state.db.prepare('SELECT COUNT(*) AS count FROM submission_bundle WHERE attempt_id = ?').get(manual.attempt.id).count, 0);

  const noBundle = allocate(state, repo, 'no-bundle');
  assert.throws(() => state.db.prepare(`
    UPDATE development_attempt SET status = 'CANDIDATE', candidate_git_sha = ? WHERE id = ?
  `).run(repo.base, noBundle.attempt.id), /requires a completed governed execution.*Submission Bundle/i);
  assert.equal(state.db.prepare('SELECT status FROM development_attempt WHERE id = ?').get(noBundle.attempt.id).status, 'IN_PROGRESS');
  assert.throws(() => submitCandidate(state.db, repo.dir, {
    attemptId: noBundle.attempt.id,
    gitSha: repo.base,
    result: 'no-bundle bypass',
  }), /manual candidate submission is disabled/i);
  assert.equal(state.db.prepare('SELECT status FROM development_attempt WHERE id = ?').get(noBundle.attempt.id).status, 'FAILED');
  assert.match(listFailures(state.db, noBundle.attempt.task_id)[0].root_cause, /persisted normalized Submission Bundle/i);
});

test('wrong workspace and missing Context Pack fail durably before provider launch', async (t) => {
  const repo = fixture();
  const state = initializeControlState(repo.dir);
  t.after(() => { state.close(); repo.cleanup(); });
  let launched = false;

  const wrongWorkspace = allocate(state, repo, 'wrong-workspace');
  const wrong = await runFixture(state.db, repo.dir, {
    ...request(wrongWorkspace),
    cwd: repo.dir,
  }, async () => { launched = true; return { exitCode: 0 }; });
  assert.equal(wrong.state, 'FAILED');
  assert.equal(launched, false);
  assert.match(listFailures(state.db, wrongWorkspace.attempt.task_id)[0].root_cause, /working directory/i);

  const missingPack = allocate(state, repo, 'missing-pack', { deliver: false });
  const missing = await runFixture(state.db, repo.dir, {
    taskId: missingPack.attempt.task_id,
    attemptId: missingPack.attempt.id,
    writerId: missingPack.workspace.writer_id,
    cwd: missingPack.workspace.workspace_path,
    provider: 'codex',
    contextPackHash: '0'.repeat(64),
  }, async () => { launched = true; return { exitCode: 0 }; });
  assert.equal(missing.state, 'FAILED');
  assert.equal(launched, false);
  assert.match(listFailures(state.db, missingPack.attempt.task_id)[0].root_cause, /was not delivered/i);
});

test('every provider-return normalization, validation, mismatch, and persistence failure is durable', async (t) => {
  const repo = fixture();
  const state = initializeControlState(repo.dir);
  t.after(() => { state.close(); repo.cleanup(); });

  const cases = [
    {
      id: 'normalization',
      raw: async () => ({ exitCode: 0, stdout: 'not-json' }),
      classification: 'post_provider_validation_failure',
      reason: /structured final event/i,
    },
    {
      id: 'mismatch',
      raw: async () => ({ exitCode: 0, stdout: JSON.stringify({ result: 'claim' }), candidateCommit: 'f'.repeat(40) }),
      classification: 'candidate_sha_mismatch',
      reason: /does not match observed/i,
    },
    {
      id: 'malformed-bundle',
      raw: async () => ({ exitCode: 0, stdout: JSON.stringify({ result: 'claim' }), implementationClaims: 'not-an-array' }),
      classification: 'post_provider_validation_failure',
      reason: /must be an array/i,
    },
    {
      id: 'candidate-validation',
      raw: async (allocation) => {
        writeFileSync(path.join(allocation.workspace.workspace_path, 'dirty.txt'), 'uncommitted\n');
        return { exitCode: 0, stdout: JSON.stringify({ result: 'claim' }) };
      },
      classification: 'candidate_validation_failure',
      reason: /uncommitted provider changes/i,
    },
  ];

  for (const item of cases) {
    const allocation = allocate(state, repo, item.id);
    const result = await runFixture(state.db, repo.dir, request(allocation), async () => item.raw(allocation));
    assert.equal(result.state, 'FAILED');
    assert.equal(result.execution.state, 'FAILED');
    assert.equal(result.execution.failure_classification, item.classification);
    assert.match(result.attempt.root_cause, item.reason);
    assert.equal(result.attempt.status, 'FAILED');
  }

  const persistence = allocate(state, repo, 'persistence');
  state.db.exec(`
    CREATE TRIGGER fixture_bundle_persistence_refused
    BEFORE INSERT ON submission_bundle
    BEGIN SELECT RAISE(ABORT, 'fixture bundle persistence refused'); END;
  `);
  const failedPersistence = await runFixture(
    state.db,
    repo.dir,
    request(persistence),
    async () => ({ exitCode: 0, stdout: JSON.stringify({ result: 'claim' }) }),
  );
  state.db.exec('DROP TRIGGER fixture_bundle_persistence_refused');
  assert.equal(failedPersistence.state, 'FAILED');
  assert.match(failedPersistence.attempt.root_cause, /bundle persistence refused/i);
  assert.equal(state.db.prepare('SELECT COUNT(*) AS count FROM submission_bundle WHERE attempt_id = ?').get(persistence.attempt.id).count, 0);

  const noOp = allocate(state, repo, 'no-op-persistence-injection');
  let injectedProviderLaunched = false;
  const refusedInjection = await runGovernedExecution(state.db, repo.dir, request(noOp), {
    runProvider: async () => { injectedProviderLaunched = true; return { exitCode: 0 }; },
    persistBundle: () => undefined,
  });
  assert.equal(refusedInjection.state, 'FAILED');
  assert.equal(injectedProviderLaunched, false);
  assert.match(refusedInjection.attempt.root_cause, /dependency injection is disabled/i);
  assert.equal(state.db.prepare('SELECT COUNT(*) AS count FROM submission_bundle WHERE attempt_id = ?').get(noOp.attempt.id).count, 0);

  const postcondition = allocate(state, repo, 'postcondition');
  state.db.exec(`
    CREATE TRIGGER fixture_remove_bundle_after_candidate
    AFTER UPDATE OF status ON development_attempt
    WHEN NEW.id = '${postcondition.attempt.id}' AND NEW.status = 'CANDIDATE'
    BEGIN DELETE FROM submission_bundle WHERE attempt_id = NEW.id; END;
  `);
  const failedPostcondition = await runFixture(
    state.db,
    repo.dir,
    request(postcondition),
    async () => ({ exitCode: 0, stdout: JSON.stringify({ result: 'claim' }) }),
  );
  state.db.exec('DROP TRIGGER fixture_remove_bundle_after_candidate');
  assert.equal(failedPostcondition.state, 'FAILED');
  assert.equal(failedPostcondition.execution.failure_classification, 'canonical_postcondition_failure');
  assert.equal(failedPostcondition.attempt.status, 'FAILED');
  assert.equal(state.db.prepare('SELECT COUNT(*) AS count FROM submission_bundle WHERE attempt_id = ?').get(postcondition.attempt.id).count, 0);
});

test('provider terminal failure is durable and provider ACCEPTED prose has no authority', async (t) => {
  const repo = fixture();
  const state = initializeControlState(repo.dir);
  t.after(() => { state.close(); repo.cleanup(); });

  const terminal = allocate(state, repo, 'terminal');
  const failed = await runFixture(state.db, repo.dir, request(terminal, 'grok'), async () => ({ exitCode: 7, stderr: 'fixture failure' }));
  assert.equal(failed.state, 'FAILED');
  assert.match(listFailures(state.db, terminal.attempt.task_id)[0].root_cause, /fixture failure/);

  const accepted = allocate(state, repo, 'accepted-claim');
  const submitted = await runFixture(state.db, repo.dir, request(accepted, 'claude'), async () => ({ exitCode: 0, stdout: JSON.stringify({ result: 'ACCEPTED' }), accepted: true }));
  assert.equal(submitted.state, 'SUBMITTED');
  assert.equal(submitted.attempt.status, 'CANDIDATE');
  assert.equal(state.db.prepare('SELECT accepted_git_sha FROM development_task WHERE id = ?').get(accepted.attempt.task_id).accepted_git_sha, null);
});
