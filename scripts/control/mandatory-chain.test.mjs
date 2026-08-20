import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runGovernedExecution, TEST_ONLY } from './builder-adapter.mjs';
import { deliverCanonicalContextPack } from './context-pack.mjs';
import {
  createTask,
  failAttempt,
  initializeControlState,
  inspectionVerificationPlan,
  prepareAcceptance,
  reconcileAcceptance,
  recordManualReview,
  runVerification,
  setTaskContract,
  startAttempt,
  startManagedAttempt,
  submitCandidate,
  supersedeAcceptance,
  validateManagedWorkspace,
} from './control-state.mjs';
import { acquireResource, inspectResources } from './resource-ownership.mjs';
import { parseArgs as parseLegacyTaskArgs } from '../dev/task.mjs';

function git(dir, ...args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed:\n${result.stderr}`);
  return result.stdout.trim();
}

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'landos-mandatory-chain-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'control@example.com');
  git(dir, 'config', 'user.name', 'Control Spine');
  mkdirSync(path.join(dir, '.landos'), { recursive: true });
  mkdirSync(path.join(dir, 'web/src/pages'), { recursive: true });
  writeFileSync(path.join(dir, '.landos', 'CODING_SESSION_PROTOCOL.md'), 'canonical policy\n');
  writeFileSync(path.join(dir, '.landos', 'PERMANENT_MEMORY.md'), 'canonical invariants\n');
  writeFileSync(path.join(dir, '.landos', 'capabilities.json'), JSON.stringify({ capabilities: [{
    id: 'mandatory-v2',
    name: 'Mandatory V2 fixture',
    invariant: 'Protected fixture changes are independently verified.',
    riskPolicy: 'protected',
    acceptancePolicy: 'All mandatory results pass.',
    sharedDependencyPaths: ['web/src/pages/AcquisitionWorkspaceV2.tsx'],
    verificationCommands: ['node -e "process.exit(0)"'],
    verificationResources: [{ resourceId: 'candidate-verification-port', resourceType: 'runtime-port', endpoint: '43144' }],
  }] }));
  writeFileSync(path.join(dir, '.gitignore'), '*.db\n*.db-wal\n*.db-shm\n.landos/STATE.md\n');
  writeFileSync(path.join(dir, 'web/src/pages/AcquisitionWorkspaceV2.tsx'), 'base\n');
  writeFileSync(path.join(dir, 'ordinary.txt'), 'base\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  const workspaces = [];
  return {
    dir,
    base: git(dir, 'rev-parse', 'HEAD'),
    workspaces,
    cleanup() {
      for (const workspace of workspaces) spawnSync('git', ['worktree', 'remove', '--force', workspace], { cwd: dir, windowsHide: true });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

let sequence = 0;
function allocate(state, repo, label, { contract = true, riskPolicy = 'protected' } = {}) {
  sequence += 1;
  const suffix = `${label}-${sequence}`;
  const taskId = `task-${suffix}`;
  const attemptId = `attempt-${suffix}`;
  const workspacePath = `${repo.dir}-${suffix}`;
  createTask(state.db, { id: taskId, title: label, outcome: `Govern ${label}`, nextAction: 'Allocate.' });
  const allocation = startManagedAttempt(state.db, repo.dir, {
    id: attemptId, taskId, worker: 'codex', writerId: `writer-${suffix}`,
    workspaceId: `workspace-${suffix}`, workspacePath, branch: `task/${suffix}`,
    baseGitSha: repo.base, approach: `Mandatory-chain ${label} fixture.`,
  });
  repo.workspaces.push(workspacePath);
  if (contract) setTaskContract(state.db, repo.dir, {
    taskId, objective: `Govern ${label}`, nonGoals: ['Do not trust provider authority.'],
    acceptedBaseGitSha: repo.base, workingBaseGitSha: repo.base, riskPolicy,
    acceptancePolicy: 'Exact candidate and all mandatory results only.',
    architectureRefs: [], invariantRefs: ['.landos/PERMANENT_MEMORY.md'],
    ownedScope: ['web/src/pages/AcquisitionWorkspaceV2.tsx'], ownedInterfaces: [],
    verificationObligations: ['Execute the exact canonical plan.'],
    verificationPolicyRefs: ['.landos/CODING_SESSION_PROTOCOL.md'],
    runtimeConstraints: [], resourceConstraints: ['Use governed candidate resources.'],
    relevantCapabilityIds: ['mandatory-v2'], relevantTaskIds: [], policyGitSha: repo.base,
  });
  return { ...allocation, taskId, attemptId, workspacePath };
}

async function candidate(state, repo, label, options = {}) {
  const allocation = allocate(state, repo, label, options);
  const pathname = options.pathname ?? 'web/src/pages/AcquisitionWorkspaceV2.tsx';
  writeFileSync(path.join(allocation.workspacePath, pathname), `${label} candidate\n`);
  git(allocation.workspacePath, 'add', pathname);
  git(allocation.workspacePath, 'commit', '-q', '-m', `${label} candidate`);
  const candidateSha = git(allocation.workspacePath, 'rev-parse', 'HEAD');
  const executionInput = {
    taskId: allocation.taskId, attemptId: allocation.attemptId,
    writerId: allocation.workspace.writer_id, cwd: allocation.workspacePath,
    provider: options.production ? 'local-replay' : 'codex',
    contextPackHash: options.contextPackHash,
  };
  const result = options.production
    ? await runGovernedExecution(state.db, repo.dir, executionInput)
    : await TEST_ONLY.runGovernedExecutionWithProvider(state.db, repo.dir, executionInput, async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ thread_id: `${label}-thread`, result: options.providerResult ?? 'ACCEPTED' }),
      candidateCommit: options.claimedCandidate ?? candidateSha,
      changedPaths: options.changedPaths ?? ['worker-forged-path.ts'],
      workerTests: ['provider says every test passed'],
      workerTestResults: ['PASS claimed by provider'],
    }));
  return {
    ...allocation,
    candidateSha,
    result,
    plan: result.state === 'SUBMITTED' ? inspectionVerificationPlan(state.db, allocation.attemptId) : null,
  };
}

const BROWSER_ACCEPTANCE_EVIDENCE = 'surface=http://localhost:3141/fixture; expected=fixture change visible; '
  + 'refresh=PASS still visible; console=no new errors; reruns=none observed; screenshot=docs/landos/evidence/fixture.png';

async function passPlan(state, item) {
  let latest;
  for (const obligation of item.plan.obligations) {
    if (obligation.obligation_type === 'MANUAL_REVIEW') {
      latest = recordManualReview(state.db, {
        attemptId: item.attemptId, obligationId: obligation.id, outcome: 'PASS',
        reviewer: 'mandatory-reviewer',
        reviewEvidence: obligation.kind === 'browser_visual_acceptance'
          ? BROWSER_ACCEPTANCE_EVIDENCE
          : `mandatory-review:${obligation.kind}`,
        summary: `Independent evaluator passed ${obligation.kind}.`,
      });
    } else {
      latest = await runVerification(state.db, item.workspacePath, {
        attemptId: item.attemptId, obligationId: obligation.id,
      });
    }
  }
  return latest;
}

test('a fresh governed fixture persists the complete mandatory chain and reaches only verification eligibility', async (t) => {
  const repo = fixture();
  const state = initializeControlState(repo.dir);
  t.after(() => { state.close(); repo.cleanup(); });

  const item = await candidate(state, repo, 'positive-chain', { production: true });
  assert.equal(item.result.state, 'SUBMITTED');
  assert.equal(item.result.attempt.status, 'CANDIDATE');
  assert.equal(item.result.bundle.candidate_git_sha, item.candidateSha);
  assert.equal(item.plan.actual_changed_paths.includes('worker-forged-path.ts'), false);
  assert.deepEqual(item.plan.actual_changed_paths, ['web/src/pages/AcquisitionWorkspaceV2.tsx']);
  assert.deepEqual(item.plan.touched_capabilities, ['mandatory-v2']);
  assert.ok(item.plan.mandatory_obligation_count > 0);
  assert.equal(state.db.prepare('SELECT COUNT(*) AS count FROM context_pack_delivery WHERE attempt_id = ?').get(item.attemptId).count, 1);
  assert.equal(state.db.prepare('SELECT COUNT(*) AS count FROM governed_execution WHERE attempt_id = ? AND state = ?').get(item.attemptId, 'COMPLETED').count, 1);
  assert.equal(state.db.prepare('SELECT COUNT(*) AS count FROM submission_bundle WHERE attempt_id = ?').get(item.attemptId).count, 1);
  assert.equal(state.db.prepare('SELECT COUNT(*) AS count FROM verification_obligation_result WHERE attempt_id = ?').get(item.attemptId).count, 0);
  assert.equal(state.db.prepare('SELECT accepted_git_sha FROM development_task WHERE id = ?').get(item.taskId).accepted_git_sha, null);

  await passPlan(state, item);
  assert.equal(state.db.prepare('SELECT status FROM development_attempt WHERE id = ?').get(item.attemptId).status, 'VERIFIED');
  assert.equal(
    state.db.prepare('SELECT COUNT(*) AS count FROM verification_obligation_result WHERE attempt_id = ? AND outcome = ?').get(item.attemptId, 'PASS').count,
    item.plan.mandatory_obligation_count,
  );
  const resource = inspectResources(state.db).find((entry) => entry.resource_id.includes('candidate-verification-port'));
  assert.equal(resource.status, 'RELEASED');
  assert.equal(state.db.prepare("SELECT COUNT(*) AS count FROM managed_resource_event WHERE attempt_id = ? AND action = 'ACQUIRE' AND outcome = 'PASS'").get(item.attemptId).count, 1);
  assert.equal(state.db.prepare("SELECT COUNT(*) AS count FROM managed_resource_event WHERE attempt_id = ? AND action = 'RELEASE' AND outcome = 'PASS'").get(item.attemptId).count, 1);
  const eligible = prepareAcceptance(state.db, repo.dir, { id: 'positive-chain-eligibility', attemptId: item.attemptId });
  assert.equal(eligible.state, 'ACCEPTANCE_PENDING');
  assert.equal(state.db.prepare('SELECT accepted_git_sha FROM development_task WHERE id = ?').get(item.taskId).accepted_git_sha, null);
});

test('the core mandatory bypass fixture mechanically refuses its direct production-path attacks', async (t) => {
  const repo = fixture();
  const state = initializeControlState(repo.dir);
  t.after(() => { state.close(); repo.cleanup(); });

  createTask(state.db, { id: 'unmanaged-task', title: 'Unmanaged', outcome: 'Refuse unmanaged', nextAction: 'Refuse.' });
  assert.throws(() => startAttempt(state.db, {
    id: 'unmanaged-attempt', taskId: 'unmanaged-task', worker: 'codex', approach: 'Bypass.', baseGitSha: repo.base,
  }), /managed workspace allocation/i); // 1

  const owner = allocate(state, repo, 'owner-check');
  const other = allocate(state, repo, 'other-owner-check');
  assert.throws(() => validateManagedWorkspace(state.db, repo.dir, {
    taskId: other.taskId, attemptId: owner.attemptId, writerId: owner.workspace.writer_id, cwd: owner.workspacePath,
  }), /does not belong/i); // 3
  assert.throws(() => validateManagedWorkspace(state.db, repo.dir, {
    taskId: other.taskId, attemptId: other.attemptId, writerId: other.workspace.writer_id, cwd: owner.workspacePath,
  }), /working directory/i); // 4
  assert.throws(() => validateManagedWorkspace(state.db, repo.dir, {
    taskId: owner.taskId, attemptId: owner.attemptId, writerId: 'wrong-writer', cwd: owner.workspacePath,
  }), /does not own/i); // 5

  const wrongCwd = allocate(state, repo, 'wrong-cwd');
  const wrongCwdResult = await TEST_ONLY.runGovernedExecutionWithProvider(state.db, repo.dir, {
    taskId: wrongCwd.taskId, attemptId: wrongCwd.attemptId, writerId: wrongCwd.workspace.writer_id,
    cwd: repo.dir, provider: 'codex',
  }, async () => { throw new Error('must not launch'); });
  assert.equal(wrongCwdResult.state, 'FAILED'); // 2
  assert.equal(state.db.prepare('SELECT COUNT(*) AS count FROM development_evidence WHERE attempt_id = ?').get(wrongCwd.attemptId).count, 1);

  const noDelivery = allocate(state, repo, 'no-delivery');
  assert.throws(() => state.db.prepare(`
    INSERT INTO governed_execution(
      id, task_id, attempt_id, workspace_id, writer_id, provider, working_directory,
      attempted_action, context_pack_hash, state, started_at
    ) VALUES ('execution-no-delivery', ?, ?, ?, ?, 'codex', ?, 'run', ?, 'RUNNING', ?)
  `).run(
    noDelivery.taskId, noDelivery.attemptId, noDelivery.workspace.id, noDelivery.workspace.writer_id,
    noDelivery.workspacePath, '0'.repeat(64), new Date().toISOString(),
  ), /delivered Context Pack/i); // 6

  const manual = allocate(state, repo, 'manual-submit');
  assert.throws(() => submitCandidate(state.db, repo.dir, {
    attemptId: manual.attemptId, gitSha: repo.base, result: 'Manual candidate.',
  }), /manual candidate submission is disabled/i); // 7
  assert.equal(state.db.prepare('SELECT status FROM development_attempt WHERE id = ?').get(manual.attemptId).status, 'FAILED');

  const noBundle = allocate(state, repo, 'no-bundle');
  assert.throws(() => state.db.prepare("UPDATE development_attempt SET status = 'CANDIDATE', candidate_git_sha = ? WHERE id = ?").run(repo.base, noBundle.attemptId), /canonical verification plan|Submission Bundle/i); // 8

  const mismatched = await candidate(state, repo, 'mismatched-sha', { claimedCandidate: '0'.repeat(40) });
  assert.equal(mismatched.result.state, 'FAILED');
  assert.equal(mismatched.result.execution.failure_classification, 'candidate_sha_mismatch'); // 9

  const source = await candidate(state, repo, 'source-pack');
  assert.equal(source.result.state, 'SUBMITTED');
  assert.equal(JSON.parse(source.result.bundle.changed_paths_json)[0], 'worker-forged-path.ts');
  assert.deepEqual(source.plan.actual_changed_paths, ['web/src/pages/AcquisitionWorkspaceV2.tsx']); // 13
  assert.equal(state.db.prepare('SELECT accepted_git_sha FROM development_task WHERE id = ?').get(source.taskId).accepted_git_sha, null); // 20

  const arbitrary = allocate(state, repo, 'arbitrary-pack');
  const arbitraryResult = await TEST_ONLY.runGovernedExecutionWithProvider(state.db, repo.dir, {
    taskId: arbitrary.taskId, attemptId: arbitrary.attemptId, writerId: arbitrary.workspace.writer_id,
    cwd: arbitrary.workspacePath, provider: 'codex', contextPackHash: 'f'.repeat(64),
  }, async () => { throw new Error('must not launch'); });
  assert.equal(arbitraryResult.state, 'FAILED'); // 10

  const crossPack = allocate(state, repo, 'cross-pack');
  const crossResult = await TEST_ONLY.runGovernedExecutionWithProvider(state.db, repo.dir, {
    taskId: crossPack.taskId, attemptId: crossPack.attemptId, writerId: crossPack.workspace.writer_id,
    cwd: crossPack.workspacePath, provider: 'codex', contextPackHash: source.result.bundle.context_pack_hash,
  }, async () => { throw new Error('must not launch'); });
  assert.equal(crossResult.state, 'FAILED'); // 11

  const incomplete = allocate(state, repo, 'incomplete-pack', { contract: false });
  const incompleteResult = await TEST_ONLY.runGovernedExecutionWithProvider(state.db, repo.dir, {
    taskId: incomplete.taskId, attemptId: incomplete.attemptId, writerId: incomplete.workspace.writer_id,
    cwd: incomplete.workspacePath, provider: 'codex',
  }, async () => { throw new Error('must not launch'); });
  assert.equal(incompleteResult.state, 'FAILED'); // 12
  assert.match(state.db.prepare('SELECT root_cause FROM development_attempt WHERE id = ?').get(incomplete.attemptId).root_cause, /task contract/i);

  const noPlan = await candidate(state, repo, 'no-plan');
  assert.throws(() => state.db.prepare('DELETE FROM verification_obligation WHERE attempt_id = ?').run(noPlan.attemptId), /cannot be deleted/i);
  assert.throws(() => state.db.prepare('DELETE FROM verification_plan WHERE attempt_id = ?').run(noPlan.attemptId), /cannot be deleted/i);
  const executable = noPlan.plan.obligations.find((item) => item.obligation_type === 'EXECUTABLE');
  assert.throws(() => recordManualReview(state.db, {
    attemptId: noPlan.attemptId, obligationId: executable.id, outcome: 'PASS',
    reviewer: 'caller', reviewEvidence: 'generic-pass', summary: 'Generic PASS.',
  }), /cannot satisfy EXECUTABLE/i); // 14

  const zeroPlan = await candidate(state, repo, 'zero-obligations');
  assert.throws(() => state.db.prepare('UPDATE verification_plan SET mandatory_obligation_count = 0 WHERE attempt_id = ?').run(zeroPlan.attemptId), /immutable/i);
  assert.throws(() => state.db.prepare("UPDATE development_attempt SET status = 'VERIFIED' WHERE id = ?").run(zeroPlan.attemptId), /verified attempt/i); // 15

  const missingResult = await candidate(state, repo, 'missing-result');
  assert.throws(() => prepareAcceptance(state.db, repo.dir, { attemptId: missingResult.attemptId }), /VERIFIED candidate/i); // 16

  const failedResult = await candidate(state, repo, 'failed-result');
  const review = failedResult.plan.obligations.find((item) => item.kind === 'submission_evidence_review');
  recordManualReview(state.db, {
    attemptId: failedResult.attemptId, obligationId: review.id, outcome: 'FAIL',
    reviewer: 'mandatory-reviewer', reviewEvidence: 'mandatory-review:failed',
    summary: 'Independent evidence review failed.', rootCause: 'Provider claims were insufficient.',
  });
  assert.equal(state.db.prepare('SELECT status FROM development_attempt WHERE id = ?').get(failedResult.attemptId).status, 'FAILED'); // 17

  assert.throws(() => acquireResource(state.db, {
    resourceId: 'alternate-primary-port', resourceType: 'port', endpoint: 'http://localhost:3141',
    taskId: source.taskId, attemptId: source.attemptId,
  }), /protected primary runtime/i); // 18

  assert.throws(() => parseLegacyTaskArgs(['--engine', 'codex', 'make', 'a', 'change']), /only governed flags/i);
  const legacySource = readFileSync(new URL('../dev/task.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(legacySource, /deps\.execute|persistBundle/);
  assert.match(legacySource, /runGovernedExecution\(state\.db, root, options\)/); // 19

  failAttempt(state.db, { attemptId: source.attemptId, result: 'Archived historical candidate.', rootCause: 'Independent review rejection.' });
  assert.throws(() => prepareAcceptance(state.db, repo.dir, { attemptId: source.attemptId }), /FAILED/i); // 21

  const superseded = await candidate(state, repo, 'superseded-candidate');
  await passPlan(state, superseded);
  const operation = prepareAcceptance(state.db, repo.dir, { id: 'superseded-operation', attemptId: superseded.attemptId });
  supersedeAcceptance(state.db, { id: operation.id, reason: 'Independent review superseded it.', nextDirection: 'Use replacement.' });
  assert.throws(() => prepareAcceptance(state.db, repo.dir, { attemptId: superseded.attemptId }), /FAILED|superseded/i);
  assert.equal(reconcileAcceptance(state.db, repo.dir, { id: operation.id })[0].state, 'SUPERSEDED'); // 22

  const completedWithoutBundle = allocate(state, repo, 'completed-without-bundle');
  const { delivery } = deliverCanonicalContextPack(state.db, repo.dir, { attemptId: completedWithoutBundle.attemptId });
  state.db.prepare(`
    INSERT INTO governed_execution(
      id, task_id, attempt_id, workspace_id, writer_id, provider, working_directory,
      attempted_action, context_pack_hash, state, started_at, observed_candidate_git_sha
    ) VALUES ('execution-without-bundle', ?, ?, ?, ?, 'codex', ?, 'run', ?, 'PROVIDER_RETURNED', ?, ?)
  `).run(
    completedWithoutBundle.taskId, completedWithoutBundle.attemptId, completedWithoutBundle.workspace.id,
    completedWithoutBundle.workspace.writer_id, completedWithoutBundle.workspacePath,
    delivery.context_pack_hash, new Date().toISOString(), repo.base,
  );
  assert.throws(() => state.db.prepare("UPDATE governed_execution SET state = 'COMPLETED' WHERE id = 'execution-without-bundle'").run(), /Submission Bundle/i); // 8, execution-level proof
});

const ADVERSARIAL_MATRIX = Object.freeze([
  ['writable attempt without managed workspace', 'mandatory-chain.test.mjs'],
  ['wrong cwd', 'mandatory-chain.test.mjs'],
  ['wrong task', 'mandatory-chain.test.mjs'],
  ['wrong attempt', 'mandatory-chain.test.mjs'],
  ['wrong writer', 'mandatory-chain.test.mjs'],
  ['provider execution without delivered Context Pack', 'mandatory-chain.test.mjs'],
  ['candidate submission without governed execution', 'mandatory-chain.test.mjs'],
  ['candidate submission without Submission Bundle', 'mandatory-chain.test.mjs'],
  ['no-op persistence injection', 'builder-adapter.test.mjs'],
  ['candidate SHA mismatch', 'builder-adapter.test.mjs'],
  ['post-provider normalization exception', 'builder-adapter.test.mjs'],
  ['post-provider candidate validation exception', 'builder-adapter.test.mjs'],
  ['arbitrary Context Pack hash', 'context-pack.test.mjs'],
  ['cross-attempt Context Pack hash', 'context-pack.test.mjs'],
  ['incomplete Context Pack', 'context-pack.test.mjs'],
  ['caller alters canonical non-goals', 'context-pack.test.mjs'],
  ['caller alters canonical architecture facts', 'context-pack.test.mjs'],
  ['caller alters workspace identity', 'context-pack.test.mjs'],
  ['fake changed paths', 'verification-plan.test.mjs'],
  ['generic PASS without plan', 'verification-plan.test.mjs'],
  ['manual PASS for executable obligation', 'verification-plan.test.mjs'],
  ['manual PASS for resource-bearing obligation', 'verification-plan.test.mjs'],
  ['plan with zero mandatory obligations', 'verification-plan.test.mjs'],
  ['delete required obligation rows after sealing', 'verification-plan.test.mjs'],
  ['stored count and live obligation count disagreement', 'verification-plan.test.mjs'],
  ['missing mandatory result', 'verification-plan.test.mjs'],
  ['failed mandatory result', 'verification-plan.test.mjs'],
  ['direct VERIFIED transition with incomplete plan', 'verification-plan.test.mjs'],
  ['direct ACCEPTANCE_PENDING transition with incomplete plan', 'verification-plan.test.mjs'],
  ['direct ACCEPTED transition with incomplete plan', 'verification-plan.test.mjs'],
  ['acceptance-operation insert bypass', 'verification-plan.test.mjs'],
  ['acceptance-operation update bypass', 'verification-plan.test.mjs'],
  ['reconciliation bypass', 'verification-plan.test.mjs'],
  ['provider-reported tests without gate execution', 'mandatory-chain.test.mjs'],
  ['legacy task-runner bypass', 'public-surface.test.mjs'],
  ['provider prose claiming ACCEPTED', 'builder-adapter.test.mjs'],
  ['archived original candidate promotion', 'mandatory-chain.test.mjs'],
  ['superseded candidate promotion', 'mandatory-chain.test.mjs'],
  ['V2 live stylesheet incorrectly classified low risk', 'verification-plan.test.mjs'],
  ['real scripts/dev/task.mjs incorrectly classified low risk', 'verification-plan.test.mjs'],
  ['package.json Control Spine script change incorrectly classified low risk', 'verification-plan.test.mjs'],
  ['alternate logical ID for same TCP port', 'resource-ownership.test.mjs'],
  ['alternate logical ID for same CDP endpoint', 'resource-ownership.test.mjs'],
  ['junction alias for browser profile', 'resource-ownership.test.mjs'],
  ['hard-link alias for governed DB', 'resource-ownership.test.mjs'],
  ['old client schema downgrade', 'schema-version.test.mjs'],
  ['old client status mutating newer DB', 'schema-version.test.mjs'],
  ['current status mutating canonical DB', 'schema-version.test.mjs'],
  ['protected runtime acquisition without governance', 'resource-ownership.test.mjs'],
  ['resource-required result without resource events', 'verification-plan.test.mjs'],
  ['public mutation surface introduced without inventory', 'public-surface.test.mjs'],
]);

test('the permanent adversarial matrix accounts for every required bypass and every public mutation surface', () => {
  assert.equal(ADVERSARIAL_MATRIX.length, 51);
  assert.equal(new Set(ADVERSARIAL_MATRIX.map(([name]) => name)).size, ADVERSARIAL_MATRIX.length);
  for (const [, owner] of ADVERSARIAL_MATRIX) {
    const source = readFileSync(new URL(owner, import.meta.url), 'utf8');
    assert.match(source, /test\(/, owner);
  }
});
