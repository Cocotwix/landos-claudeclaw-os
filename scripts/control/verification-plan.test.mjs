import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { TEST_ONLY } from './builder-adapter.mjs';
import {
  createTask,
  failAttempt,
  initializeControlState,
  inspectionVerificationPlan,
  listFailures,
  persistCanonicalVerificationPlan,
  prepareAcceptance,
  reconcileAcceptance,
  recordManualReview,
  runVerification,
  setTaskContract,
  startManagedAttempt,
  supersedeAcceptance,
} from './control-state.mjs';

function git(dir, ...args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed:\n${result.stderr}`);
  return result.stdout.trim();
}

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'landos-verification-plan-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'control@example.com');
  git(dir, 'config', 'user.name', 'Control Spine');
  mkdirSync(path.join(dir, '.landos'), { recursive: true });
  mkdirSync(path.join(dir, 'web/src/pages'), { recursive: true });
  mkdirSync(path.join(dir, 'web/src/styles'), { recursive: true });
  mkdirSync(path.join(dir, 'scripts/control'), { recursive: true });
  mkdirSync(path.join(dir, 'scripts/dev'), { recursive: true });
  writeFileSync(path.join(dir, '.landos', 'CODING_SESSION_PROTOCOL.md'), 'canonical policy\n');
  writeFileSync(path.join(dir, '.landos', 'PERMANENT_MEMORY.md'), 'canonical invariants\n');
  writeFileSync(path.join(dir, '.landos', 'capabilities.json'), JSON.stringify({ capabilities: [{
    id: 'acquisition-workspace-v2-fixture',
    name: 'Acquisition Workspace V2 fixture',
    sharedDependencyPaths: ['web/src/pages/AcquisitionWorkspaceV2.tsx', 'web/src/styles/workspace-v2*.css'],
    verificationCommands: ['node -e "process.exit(0)"'],
    verificationResources: ['browser:fixture'],
  }] }));
  writeFileSync(path.join(dir, '.gitignore'), '*.db\n*.db-wal\n*.db-shm\n.landos/STATE.md\n');
  writeFileSync(path.join(dir, 'web/src/pages/AcquisitionWorkspaceV2.tsx'), 'base\n');
  writeFileSync(path.join(dir, 'web/src/styles/workspace-v2-lead-design.css'), '.base {}\n');
  writeFileSync(path.join(dir, 'scripts/control/sample.mjs'), 'export const sample = true;\n');
  writeFileSync(path.join(dir, 'scripts/dev/task.mjs'), 'export const task = true;\n');
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { 'landos:task': 'node scripts/dev/task.mjs', 'landos:control': 'node scripts/control/sample.mjs' } }, null, 2));
  writeFileSync(path.join(dir, 'low-risk.txt'), 'base\n');
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
async function governedCandidate(state, repo, {
  pathname = 'low-risk.txt',
  contents = 'candidate\n',
  riskPolicy = 'low',
  providerChangedPaths = ['forged-worker-path.ts'],
  workerTests = ['provider says tests pass'],
} = {}) {
  sequence += 1;
  const suffix = `fixture-${sequence}`;
  const taskId = `task-${suffix}`;
  const attemptId = `attempt-${suffix}`;
  const workspacePath = `${repo.dir}-${suffix}`;
  createTask(state.db, { id: taskId, title: suffix, outcome: `Verify ${suffix}`, nextAction: 'Allocate.' });
  const allocation = startManagedAttempt(state.db, repo.dir, {
    id: attemptId, taskId, worker: 'codex', writerId: `writer-${suffix}`,
    workspaceId: `workspace-${suffix}`, workspacePath, branch: `task/${suffix}`,
    baseGitSha: repo.base, approach: 'Governed verification fixture.',
  });
  repo.workspaces.push(workspacePath);
  setTaskContract(state.db, repo.dir, {
    taskId, objective: `Verify ${suffix}`, nonGoals: ['Do not trust worker path claims.'],
    acceptedBaseGitSha: repo.base, workingBaseGitSha: repo.base, riskPolicy,
    acceptancePolicy: 'Exact-SHA Integration Gate only.', architectureRefs: [],
    invariantRefs: ['.landos/PERMANENT_MEMORY.md'], ownedScope: [pathname], ownedInterfaces: [],
    verificationObligations: ['Internally execute the canonical plan.'],
    verificationPolicyRefs: ['.landos/CODING_SESSION_PROTOCOL.md'], runtimeConstraints: [],
    resourceConstraints: [], relevantCapabilityIds: [], relevantTaskIds: [], policyGitSha: repo.base,
  });
  writeFileSync(path.join(workspacePath, pathname), contents);
  git(workspacePath, 'add', pathname);
  git(workspacePath, 'commit', '-q', '-m', `${suffix} candidate`);
  const candidateSha = git(workspacePath, 'rev-parse', 'HEAD');
  const submitted = await TEST_ONLY.runGovernedExecutionWithProvider(state.db, repo.dir, {
    taskId, attemptId, writerId: allocation.workspace.writer_id,
    cwd: workspacePath, provider: 'codex',
  }, async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ result: 'Provider implementation claim only.' }),
      candidateCommit: candidateSha,
      changedPaths: providerChangedPaths,
      workerTests,
      workerTestResults: ['PASS claimed by provider'],
      evidenceReferences: ['provider-session:fixture'],
    }));
  assert.equal(submitted.state, 'SUBMITTED');
  return { ...allocation, taskId, attemptId, workspacePath, candidateSha, plan: inspectionVerificationPlan(state.db, attemptId) };
}

async function passPlan(state, candidate) {
  let latest;
  for (const obligation of candidate.plan.obligations) {
    if (obligation.kind === 'canonical_input_review' || obligation.kind === 'submission_evidence_review') {
      latest = recordManualReview(state.db, {
        attemptId: candidate.attemptId,
        obligationId: obligation.id,
        outcome: 'PASS',
        reviewer: 'fixture-reviewer',
        reviewEvidence: `fixture-review:${obligation.kind}`,
        summary: `Independent gate review passed for ${obligation.kind}.`,
      });
    } else {
      latest = await runVerification(state.db, candidate.workspacePath, {
        attemptId: candidate.attemptId,
        obligationId: obligation.id,
      });
    }
  }
  return latest;
}

test('canonical inputs, exact Git diff, risk policy, and exact-commit capability policy drive planning', async (t) => {
  const repo = fixture();
  const state = initializeControlState(repo.dir);
  t.after(() => { state.close(); repo.cleanup(); });

  const low = await governedCandidate(state, repo);
  assert.deepEqual(low.plan.actual_changed_paths, ['low-risk.txt']);
  assert.equal(low.plan.risk, 'low');
  assert.equal(low.plan.mandatory_obligation_count, 3);
  assert.deepEqual(low.plan.planning_inputs.submissionBundle.changedPaths, ['forged-worker-path.ts']);
  assert.ok(low.plan.planning_inputs.taskContract.nonGoals.includes('Do not trust worker path claims.'));
  assert.equal(low.plan.actual_changed_paths.includes('forged-worker-path.ts'), false);
  for (const obligation of low.plan.obligations.filter((item) => item.obligation_type === 'MANUAL_REVIEW')) {
    assert.equal(obligation.command, null);
    assert.deepEqual(obligation.resources, []);
  }

  // Mutating the invoking worktree after the policy commit cannot alter the
  // capability map used by a later managed attempt.
  writeFileSync(path.join(repo.dir, '.landos', 'capabilities.json'), JSON.stringify({ capabilities: [] }));
  const protectedCandidate = await governedCandidate(state, repo, {
    pathname: 'web/src/pages/AcquisitionWorkspaceV2.tsx', contents: 'protected\n',
  });
  assert.equal(protectedCandidate.plan.risk, 'protected');
  assert.deepEqual(protectedCandidate.plan.touched_capabilities, ['acquisition-workspace-v2-fixture']);
  assert.ok(protectedCandidate.plan.obligations.some((item) => item.kind === 'capability'));
  assert.deepEqual(
    protectedCandidate.plan.obligations.find((item) => item.kind === 'capability').resources,
    ['browser:fixture'],
  );
  rmSync(path.join(repo.dir, '.landos', 'capabilities.json'));
  git(repo.dir, 'restore', '.landos/capabilities.json');

  const architecture = await governedCandidate(state, repo, {
    pathname: 'scripts/control/sample.mjs', contents: 'export const sample = false;\n', riskPolicy: 'low',
  });
  assert.equal(architecture.plan.risk, 'architecture-critical');
  assert.ok(architecture.plan.obligations.some((item) => item.command === 'npm run landos:control:test'));
  assert.ok(architecture.plan.obligations.some((item) => item.command === 'npm run typecheck'));

  const liveStylesheet = await governedCandidate(state, repo, {
    pathname: 'web/src/styles/workspace-v2-lead-design.css', contents: '.protected {}\n', riskPolicy: 'low',
  });
  assert.equal(liveStylesheet.plan.risk, 'protected');
  assert.deepEqual(liveStylesheet.plan.touched_capabilities, ['acquisition-workspace-v2-fixture']);

  for (const [pathname, contents] of [
    ['scripts/dev/task.mjs', 'export const task = false;\n'],
    ['package.json', JSON.stringify({ scripts: { 'landos:task': 'node scripts/dev/task.mjs', 'landos:control': 'node scripts/control/sample.mjs --strict' } }, null, 2)],
  ]) {
    const controlEntrypoint = await governedCandidate(state, repo, { pathname, contents, riskPolicy: 'low' });
    assert.equal(controlEntrypoint.plan.risk, 'architecture-critical', pathname);
    assert.ok(controlEntrypoint.plan.obligations.some((item) => item.command === 'npm run landos:control:test'), pathname);
  }
});

test('sealed-plan mutation, generic PASS, incomplete, failed, and provider-only evidence cannot verify', async (t) => {
  const repo = fixture();
  const state = initializeControlState(repo.dir);
  t.after(() => { state.close(); repo.cleanup(); });

  const sealed = await governedCandidate(state, repo);
  assert.equal(sealed.plan.lifecycle_state, 'SEALED');
  assert.throws(
    () => state.db.prepare('DELETE FROM verification_obligation WHERE attempt_id = ?').run(sealed.attemptId),
    /cannot be deleted/i,
  );
  assert.throws(
    () => state.db.prepare('DELETE FROM verification_plan WHERE attempt_id = ?').run(sealed.attemptId),
    /cannot be deleted/i,
  );
  assert.throws(
    () => state.db.prepare('UPDATE verification_plan SET mandatory_obligation_count = 0 WHERE attempt_id = ?').run(sealed.attemptId),
    /immutable/i,
  );
  const executable = sealed.plan.obligations.find((item) => item.obligation_type === 'EXECUTABLE');
  assert.throws(() => recordManualReview(state.db, {
    attemptId: sealed.attemptId,
    obligationId: executable.id,
    outcome: 'PASS',
    reviewer: 'caller',
    reviewEvidence: 'caller-claim',
    summary: 'Generic PASS.',
  }), /cannot satisfy EXECUTABLE/i);
  const manual = sealed.plan.obligations.find((item) => item.obligation_type === 'MANUAL_REVIEW');
  await assert.rejects(
    runVerification(state.db, sealed.workspacePath, { attemptId: sealed.attemptId, obligationId: manual.id }),
    /accepts only executable obligations/i,
  );
  assert.throws(
    () => state.db.prepare("UPDATE development_attempt SET status = 'VERIFIED' WHERE id = ?").run(sealed.attemptId),
    /governed PASS|verified attempt/i,
  );
  assert.throws(
    () => state.db.prepare("UPDATE development_attempt SET status = 'ACCEPTANCE_PENDING' WHERE id = ?").run(sealed.attemptId),
    /acceptance state/i,
  );
  assert.throws(
    () => state.db.prepare("UPDATE development_attempt SET status = 'ACCEPTED' WHERE id = ?").run(sealed.attemptId),
    /Integration Gate|acceptance/i,
  );
  assert.throws(() => state.db.prepare(`
    INSERT INTO acceptance_operation(
      id, task_id, attempt_id, candidate_git_sha, authority_ref, state, prepared_at
    ) VALUES ('direct-incomplete', ?, ?, ?, 'main', 'ACCEPTANCE_PENDING', '2026-08-17T00:00:00.000Z')
  `).run(sealed.taskId, sealed.attemptId, sealed.candidateSha), /Integration Gate/i);

  const incomplete = await governedCandidate(state, repo);
  const first = incomplete.plan.obligations.find((item) => item.obligation_type === 'EXECUTABLE');
  await runVerification(state.db, incomplete.workspacePath, { attemptId: incomplete.attemptId, obligationId: first.id });
  assert.equal(state.db.prepare('SELECT status FROM development_attempt WHERE id = ?').get(incomplete.attemptId).status, 'CANDIDATE');
  assert.throws(() => prepareAcceptance(state.db, repo.dir, { attemptId: incomplete.attemptId }), /VERIFIED candidate/i);
  assert.equal(
    state.db.prepare('SELECT COUNT(*) AS count FROM verification_obligation WHERE attempt_id = ? AND status = ?').get(incomplete.attemptId, 'PENDING').count > 0,
    true,
  );

  const failed = await governedCandidate(state, repo);
  const failedObligation = failed.plan.obligations.find((item) => item.kind === 'submission_evidence_review');
  recordManualReview(state.db, {
    attemptId: failed.attemptId, obligationId: failedObligation.id, outcome: 'FAIL',
    reviewer: 'fixture-reviewer', reviewEvidence: 'fixture-review:insufficient',
    summary: 'Provider evidence was insufficient.', rootCause: 'Provider claims were not independently supported.',
    nextDirection: 'Repair and create a new governed attempt.',
  });
  assert.equal(state.db.prepare('SELECT status FROM development_attempt WHERE id = ?').get(failed.attemptId).status, 'FAILED');
  assert.match(listFailures(state.db, failed.taskId)[0].root_cause, /not independently supported/i);

  const providerOnly = await governedCandidate(state, repo, { workerTests: ['all tests PASS'] });
  assert.ok(providerOnly.plan.planning_inputs.submissionBundle.workerTests.includes('all tests PASS'));
  assert.equal(state.db.prepare('SELECT status FROM development_attempt WHERE id = ?').get(providerOnly.attemptId).status, 'CANDIDATE');
  assert.equal(state.db.prepare('SELECT COUNT(*) AS count FROM verification_obligation WHERE attempt_id = ? AND status = ?').get(providerOnly.attemptId, 'PASS').count, 0);
});

test('complete durable results verify and immutable results support only exact gate acceptance', async (t) => {
  const repo = fixture();
  const state = initializeControlState(repo.dir);
  t.after(() => { state.close(); repo.cleanup(); });

  const eligible = await governedCandidate(state, repo, {
    pathname: 'web/src/pages/AcquisitionWorkspaceV2.tsx', contents: 'eligible protected\n',
  });
  await passPlan(state, eligible);
  assert.equal(state.db.prepare('SELECT status FROM development_attempt WHERE id = ?').get(eligible.attemptId).status, 'VERIFIED');
  const resultCount = state.db.prepare(`
    SELECT COUNT(*) AS count FROM verification_obligation_result
    WHERE task_id = ? AND attempt_id = ? AND candidate_git_sha = ?
      AND verification_plan_id = ? AND policy_version = ?
  `).get(eligible.taskId, eligible.attemptId, eligible.candidateSha, eligible.plan.id, eligible.plan.policy_version).count;
  assert.equal(resultCount, eligible.plan.mandatory_obligation_count);

  const operation = prepareAcceptance(state.db, repo.dir, { id: `gate-${eligible.attemptId}`, attemptId: eligible.attemptId });
  assert.equal(operation.state, 'ACCEPTANCE_PENDING');
  assert.throws(
    () => state.db.prepare('UPDATE acceptance_operation SET candidate_git_sha = ? WHERE id = ?').run(repo.base, operation.id),
    /operation update requires/i,
  );
  assert.throws(
    () => state.db.prepare('DELETE FROM verification_obligation_result WHERE obligation_id = ?').run(eligible.plan.obligations[0].id),
    /cannot be deleted/i,
  );
  assert.throws(
    () => state.db.prepare("UPDATE verification_obligation_result SET outcome = 'FAIL' WHERE obligation_id = ?").run(eligible.plan.obligations[0].id),
    /immutable/i,
  );
  git(repo.dir, 'merge', '--ff-only', '-q', eligible.candidateSha);
  const reconciled = reconcileAcceptance(state.db, repo.dir, { id: operation.id });
  assert.equal(reconciled[0].reconciled, true);
  assert.equal(reconciled[0].state, 'ACCEPTED');

  const archived = await governedCandidate(state, repo);
  failAttempt(state.db, { attemptId: archived.attemptId, result: 'Archived failed candidate.', rootCause: 'Independent review rejection.' });
  assert.throws(() => prepareAcceptance(state.db, repo.dir, { attemptId: archived.attemptId }), /FAILED/i);

  const superseded = await governedCandidate(state, repo);
  await passPlan(state, superseded);
  const supersededOperation = prepareAcceptance(state.db, repo.dir, { id: `gate-${superseded.attemptId}`, attemptId: superseded.attemptId });
  supersedeAcceptance(state.db, { id: supersededOperation.id, reason: 'Independent review superseded candidate.', nextDirection: 'Use replacement candidate.' });
  assert.throws(() => prepareAcceptance(state.db, repo.dir, { attemptId: superseded.attemptId }), /FAILED|superseded/i);
});

test('planning refuses a missing Submission Bundle and malformed bundle state', (t) => {
  const repo = fixture();
  const state = initializeControlState(repo.dir);
  t.after(() => { state.close(); repo.cleanup(); });
  const taskId = 'task-missing-bundle';
  createTask(state.db, { id: taskId, title: taskId, outcome: 'Refuse missing bundle', nextAction: 'Allocate.' });
  const workspacePath = `${repo.dir}-missing-bundle`;
  const allocation = startManagedAttempt(state.db, repo.dir, {
    id: 'attempt-missing-bundle', taskId, worker: 'codex', writerId: 'writer-missing-bundle',
    workspaceId: 'workspace-missing-bundle', workspacePath, branch: 'task/missing-bundle',
    baseGitSha: repo.base, approach: 'Negative planning fixture.',
  });
  repo.workspaces.push(workspacePath);
  const contractInput = {
    taskId, objective: 'Refuse missing bundle', nonGoals: ['No bypass.'], acceptedBaseGitSha: repo.base,
    workingBaseGitSha: repo.base, riskPolicy: 'low', acceptancePolicy: 'Exact candidate only.',
    architectureRefs: [], invariantRefs: ['.landos/PERMANENT_MEMORY.md'], ownedScope: ['low-risk.txt'],
    ownedInterfaces: [], verificationObligations: ['At least one check.'],
    verificationPolicyRefs: ['.landos/CODING_SESSION_PROTOCOL.md'], runtimeConstraints: [], resourceConstraints: [],
    relevantCapabilityIds: [], relevantTaskIds: [], policyGitSha: repo.base,
  };
  assert.throws(() => setTaskContract(state.db, repo.dir, { ...contractInput, riskPolicy: undefined }), /risk policy/i);
  setTaskContract(state.db, repo.dir, contractInput);
  writeFileSync(path.join(workspacePath, 'low-risk.txt'), 'missing bundle candidate\n');
  git(workspacePath, 'add', 'low-risk.txt'); git(workspacePath, 'commit', '-q', '-m', 'candidate');
  assert.throws(() => persistCanonicalVerificationPlan(state.db, workspacePath, {
    attemptId: allocation.attempt.id, candidateGitSha: git(workspacePath, 'rev-parse', 'HEAD'), submissionBundleId: 999999,
  }), /persisted normalized Submission Bundle/i);
});
