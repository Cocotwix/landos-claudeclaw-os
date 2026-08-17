import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createTask,
  failAttempt,
  initializeControlState,
  openControlStateWriter,
  recordContextPackDelivery,
  recordDecision,
  setTaskContract,
  startManagedAttempt,
} from './control-state.mjs';
import { TEST_ONLY } from './builder-adapter.mjs';
import { createCanonicalContextPack, deliverCanonicalContextPack, renderContextPack } from './context-pack.mjs';

function git(dir, ...args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'landos-context-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'control@example.com');
  git(dir, 'config', 'user.name', 'Control Spine');
  mkdirSync(path.join(dir, '.landos'), { recursive: true });
  mkdirSync(path.join(dir, 'docs'), { recursive: true });
  writeFileSync(path.join(dir, '.landos', 'CODING_SESSION_PROTOCOL.md'), 'exact canonical policy\n');
  writeFileSync(path.join(dir, '.landos', 'PERMANENT_MEMORY.md'), 'exact permanent invariants\n');
  writeFileSync(path.join(dir, 'docs', 'architecture.md'), 'exact architecture contract\n');
  writeFileSync(path.join(dir, '.landos', 'capabilities.json'), JSON.stringify({
    schema: 1,
    capabilities: [{
      id: 'fixture-capability',
      name: 'Fixture Capability',
      sharedInvariants: ['Preserve the fixture invariant.'],
      sharedDependencyPaths: ['src/fixture'],
      verificationCommands: ['node --test fixture.test.mjs'],
      verificationObligations: ['fixture journey'],
      governedResources: ['tcp-port:3141'],
      acceptancePolicy: { required: true },
      riskPolicy: 'protected',
      knownLimitations: ['Fixture limitation.'],
    }],
  }, null, 2));
  writeFileSync(path.join(dir, '.gitignore'), '*.db\n*.db-wal\n*.db-shm\n');
  writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  return {
    dir,
    base: git(dir, 'rev-parse', 'HEAD'),
    workspaces: [],
    extraWorktrees: [],
    cleanup() {
      for (const workspace of [...this.workspaces, ...this.extraWorktrees]) {
        spawnSync('git', ['worktree', 'remove', '--force', workspace], { cwd: dir, encoding: 'utf8', windowsHide: true });
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function allocate(state, repo, id, { withContract = true, relevantTaskIds = [] } = {}) {
  createTask(state.db, {
    id: `task-${id}`,
    title: `Task ${id}`,
    outcome: `Canonical contract ${id}`,
    nextAction: 'Execute the exact contract.',
  });
  const workspacePath = `${repo.dir}-${id}`;
  repo.workspaces.push(workspacePath);
  const allocation = startManagedAttempt(state.db, repo.dir, {
    id: `attempt-${id}`,
    taskId: `task-${id}`,
    worker: 'codex',
    writerId: `writer-${id}`,
    workspaceId: `workspace-${id}`,
    workspacePath,
    branch: `task/${id}`,
    baseGitSha: repo.base,
    approach: 'Canonical Context Pack fixture.',
  });
  if (withContract) {
    allocation.contract = setTaskContract(state.db, repo.dir, {
      taskId: allocation.attempt.task_id,
      objective: `Canonical contract ${id}`,
      nonGoals: ['Do not change business runtime behavior.', 'Do not trust caller-supplied context facts.'],
      acceptedBaseGitSha: repo.base,
      workingBaseGitSha: repo.base,
      riskPolicy: 'protected',
      acceptancePolicy: 'Every canonical verification obligation must pass for the exact candidate.',
      architectureRefs: ['docs/architecture.md'],
      invariantRefs: ['.landos/PERMANENT_MEMORY.md'],
      ownedScope: ['src/fixture'],
      ownedInterfaces: ['src/fixture/api.ts'],
      verificationObligations: ['Run the focused canonical Context Pack proof.'],
      verificationPolicyRefs: ['.landos/CODING_SESSION_PROTOCOL.md'],
      runtimeConstraints: ['No runtime restart.'],
      resourceConstraints: ['Protect tcp-port:3141.'],
      relevantCapabilityIds: ['fixture-capability'],
      relevantTaskIds,
      policyGitSha: repo.base,
    });
  }
  return allocation;
}

test('fresh processes reconstruct complete scoped context from canonical state and exact commits', async (t) => {
  const repo = fixture();
  let state = initializeControlState(repo.dir);
  t.after(() => { try { state.close(); } catch { /* already closed */ } repo.cleanup(); });

  const prior = allocate(state, repo, 'prior', { withContract: false });
  failAttempt(state.db, {
    attemptId: prior.attempt.id,
    result: 'Prior governed repair was superseded.',
    rootCause: 'The prior Context Pack omitted canonical non-goals.',
    limitation: 'The provider lacked complete task context.',
    evidence: 'Independent review finding CP-1.',
    nextDirection: 'Generate context from a complete canonical contract.',
  });
  const current = allocate(state, repo, 'current', { relevantTaskIds: [prior.attempt.task_id] });
  recordDecision(state.db, {
    id: 'decision-current-context',
    taskId: current.attempt.task_id,
    capabilityId: 'fixture-capability',
    summary: 'Exact Git objects carry canonical repository policy.',
    rationale: 'Mutable invoking worktrees cannot be canonical context authority.',
    evidenceReference: 'review:CP-5',
  });

  const one = createCanonicalContextPack(state.db, repo.dir, { attemptId: current.attempt.id });
  assert.deepEqual(one.taskContract.nonGoals, [
    'Do not change business runtime behavior.',
    'Do not trust caller-supplied context facts.',
  ]);
  assert.equal(one.git.executionHeadGitSha, git(current.workspace.workspace_path, 'rev-parse', 'HEAD'));
  assert.equal(one.relevantKnowledge.decisions[0].id, 'decision-current-context');
  assert.equal(one.relevantKnowledge.failures[0].id, prior.attempt.id);
  assert.match(one.relevantKnowledge.failures[0].root_cause, /omitted canonical non-goals/i);
  assert.equal(one.capabilityPolicy.capabilities[0].verificationCommands[0], 'node --test fixture.test.mjs');
  assert.equal(one.capabilityPolicy.capabilities[0].governedResources[0], 'tcp-port:3141');
  assert.ok(one.repositorySources.every((source) => source.gitSha === repo.base));
  assert.match(one.repositorySources.find((source) => source.path === 'docs/architecture.md').content, /exact architecture contract/);
  assert.match(renderContextPack(one), new RegExp(`Context-Pack-SHA256: ${one.hash}`));

  const callerChanged = createCanonicalContextPack(state.db, repo.dir, {
    attemptId: current.attempt.id,
    nonGoals: ['caller lie'],
    architectureFacts: ['caller lie'],
    workspacePath: repo.dir,
    capabilityFacts: [{ id: 'caller-lie' }],
  });
  assert.equal(callerChanged.hash, one.hash);

  writeFileSync(path.join(repo.dir, '.landos', 'CODING_SESSION_PROTOCOL.md'), 'mutable invoking-worktree lie\n');
  writeFileSync(path.join(repo.dir, '.landos', 'capabilities.json'), JSON.stringify({ capabilities: [] }));
  const afterMutableEdit = createCanonicalContextPack(state.db, repo.dir, { attemptId: current.attempt.id });
  assert.equal(afterMutableEdit.hash, one.hash);

  const otherRoot = `${repo.dir}-invoker`;
  repo.extraWorktrees.push(otherRoot);
  git(repo.dir, 'worktree', 'add', '-q', '-b', 'other-invoker', otherRoot, repo.base);
  writeFileSync(path.join(otherRoot, 'invoker.txt'), 'different invoking HEAD\n');
  git(otherRoot, 'add', 'invoker.txt');
  git(otherRoot, 'commit', '-q', '-m', 'different invoker head');
  const fromOtherWorktree = createCanonicalContextPack(state.db, otherRoot, { attemptId: current.attempt.id });
  assert.equal(fromOtherWorktree.hash, one.hash);
  assert.notEqual(git(otherRoot, 'rev-parse', 'HEAD'), one.git.executionHeadGitSha);

  state.close();
  state = openControlStateWriter(otherRoot);
  const fresh = createCanonicalContextPack(state.db, otherRoot, { attemptId: current.attempt.id });
  assert.equal(fresh.canonicalJson, one.canonicalJson);
  assert.equal(fresh.hash, one.hash);

  const delivered = deliverCanonicalContextPack(state.db, otherRoot, { attemptId: current.attempt.id });
  assert.equal(delivered.delivery.attempt_id, current.attempt.id);
  assert.equal(delivered.delivery.workspace_id, current.workspace.id);
  assert.equal(delivered.delivery.context_pack_hash, one.hash);

  let providerPlan;
  const submitted = await TEST_ONLY.runGovernedExecutionWithProvider(state.db, otherRoot, {
    taskId: current.attempt.task_id,
    attemptId: current.attempt.id,
    writerId: current.workspace.writer_id,
    cwd: current.workspace.workspace_path,
    provider: 'codex',
  }, async (plan) => {
      providerPlan = plan;
      return { exitCode: 0, stdout: JSON.stringify({ result: 'Canonical context consumed.' }) };
  });
  assert.equal(submitted.state, 'SUBMITTED');
  assert.match(providerPlan.stdin, new RegExp(one.hash));
  assert.match(providerPlan.stdin, /Do not trust caller-supplied context facts/);
  assert.equal(submitted.bundle.context_pack_hash, delivered.delivery.context_pack_hash);
});

test('arbitrary and another-attempt Context Pack hashes are refused and incomplete contracts cannot execute', async (t) => {
  const repo = fixture();
  const state = initializeControlState(repo.dir);
  t.after(() => { state.close(); repo.cleanup(); });
  const first = allocate(state, repo, 'first');
  const second = allocate(state, repo, 'second');
  const firstDelivery = deliverCanonicalContextPack(state.db, repo.dir, { attemptId: first.attempt.id });

  assert.throws(() => recordContextPackDelivery(state.db, {
    attemptId: second.attempt.id,
    workspaceId: second.workspace.id,
    canonicalJson: '{}',
    contextPackHash: '0'.repeat(64),
  }), /does not match the canonical payload/i);

  let launched = false;
  const crossAttempt = await TEST_ONLY.runGovernedExecutionWithProvider(state.db, repo.dir, {
    taskId: second.attempt.task_id,
    attemptId: second.attempt.id,
    writerId: second.workspace.writer_id,
    cwd: second.workspace.workspace_path,
    provider: 'codex',
    contextPackHash: firstDelivery.delivery.context_pack_hash,
  }, async () => { launched = true; return { exitCode: 0 }; });
  assert.equal(crossAttempt.state, 'FAILED');
  assert.equal(launched, false);
  assert.match(crossAttempt.attempt.root_cause, /does not match the canonical delivery/i);

  const incomplete = allocate(state, repo, 'incomplete', { withContract: false });
  assert.throws(
    () => createCanonicalContextPack(state.db, repo.dir, { attemptId: incomplete.attempt.id }),
    /no complete canonical task contract/i,
  );
  const refused = await TEST_ONLY.runGovernedExecutionWithProvider(state.db, repo.dir, {
    taskId: incomplete.attempt.task_id,
    attemptId: incomplete.attempt.id,
    writerId: incomplete.workspace.writer_id,
    cwd: incomplete.workspace.workspace_path,
    provider: 'codex',
  }, async () => { launched = true; return { exitCode: 0 }; });
  assert.equal(refused.state, 'FAILED');
  assert.match(refused.attempt.root_cause, /no complete canonical task contract/i);
});
