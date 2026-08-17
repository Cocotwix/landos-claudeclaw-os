// The only provider boundary for governed coding execution. Provider wire
// formats stop here; canonical state is task/attempt/workspace based.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { ENGINES } from '../dev/providers.mjs';
import { gitStatusText } from '../dev/verify.mjs';
import {
  addEvidence,
  canonicalAttempt,
  canonicalTask,
  failAttempt,
  persistCanonicalVerificationPlan,
  resolveCommit,
  validateManagedWorkspace,
} from './control-state.mjs';
import { deliverCanonicalContextPack, renderContextPack } from './context-pack.mjs';

function required(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}
function list(value, label, fallback = []) {
  if (value === undefined || value === null) return fallback;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item) => String(item).trim()).filter(Boolean);
}
function json(text, label) {
  let value;
  try { value = JSON.parse(String(text ?? '').trim()); }
  catch { throw new Error(`${label} is not valid JSON`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value;
}
function codexEvent(text) {
  for (const line of String(text ?? '').split(/\r?\n/).reverse()) {
    if (!line.trim()) continue;
    try {
      const value = json(line, 'Codex completion event');
      if (Object.keys(value).length) return value;
    } catch {
      // Codex emits non-JSON progress lines; only a final structured event is authoritative.
    }
  }
  throw new Error('Codex completion did not contain a structured final event');
}

function promptFor(request) {
  return [
    `LandOS task: ${request.taskId}`,
    `Attempt: ${request.attemptId}`,
    `Workspace: ${request.workspacePath}`,
    `Working base: ${request.workingBaseCommit}`,
    `Context Pack SHA-256: ${request.contextPackHash}`,
    `Objective: ${request.objective}`,
    '',
    request.contextPackText,
    '',
    'Return implementation claims only. LandOS persists a submission bundle and independently controls verification and acceptance.',
  ].join('\n');
}

export const BUILDER_ADAPTERS = Object.freeze({
  claude: {
    id: 'claude',
    launch(request, options) {
      const plan = options.resume ? ENGINES.claude.resume(options) : ENGINES.claude.start(options);
      if (!plan) throw new Error('Claude resume requires its captured session');
      return { command: ENGINES.claude.command, args: plan.args, cwd: request.workspacePath, stdin: promptFor(request) };
    },
    parse(raw) {
      const value = json(raw.stdout, 'Claude completion');
      return { model: value.model ?? null, sessionId: value.session_id ?? value.sessionId ?? null, claims: value.claims ?? value.changed_paths ?? [], message: value.result ?? null };
    },
  },
  codex: {
    id: 'codex',
    launch(request, options) {
      const plan = options.resume ? ENGINES.codex.resume({ ...options, lastMessageFile: options.outputPath }) : ENGINES.codex.start({ ...options, cwd: request.workspacePath, lastMessageFile: options.outputPath });
      if (!plan) throw new Error('Codex resume requires its captured session');
      return { command: ENGINES.codex.command, args: plan.args, cwd: request.workspacePath, stdin: promptFor(request) };
    },
    parse(raw) {
      const value = codexEvent(raw.stdout);
      return { model: value.model ?? null, sessionId: value.thread_id ?? value.session_id ?? null, claims: value.changed_paths ?? value.claims ?? [], message: value.result ?? value.text ?? null };
    },
  },
  grok: {
    id: 'grok',
    launch(request, options) {
      return { command: 'grok', args: ['build', '--workspace', request.workspacePath, '--non-interactive', '--json', ...(options.model ? ['--model', options.model] : [])], cwd: request.workspacePath, stdin: promptFor(request) };
    },
    parse(raw) {
      const value = json(raw.stdout, 'Grok completion');
      return { model: value.model ?? null, sessionId: value.session_id ?? null, claims: value.changedPaths ?? value.claims ?? [], message: value.result ?? value.output ?? null };
    },
  },
});

export function builderAdapter(provider) {
  const adapter = BUILDER_ADAPTERS[String(provider ?? '').trim().toLowerCase()];
  if (!adapter) throw new Error(`unknown builder provider "${provider ?? ''}"`);
  return adapter;
}

export function normalizeRawCompletion(provider, raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('provider completion must be an object');
  const parsed = builderAdapter(provider).parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('provider adapter returned a malformed completion');
  const claims = list(parsed.claims, 'provider completion claims');
  const implementationClaims = list(
    raw.implementationClaims,
    'provider implementation claims',
    parsed.message ? [String(parsed.message).trim()].filter(Boolean) : claims,
  );
  if (implementationClaims.length === 0) throw new Error('provider completion requires at least one implementation claim');
  const completion = {
    model: parsed.model ? String(parsed.model) : null,
    sessionId: parsed.sessionId ? String(parsed.sessionId) : null,
    changedPaths: list(raw.changedPaths, 'provider changed paths', claims),
    implementationClaims,
    workerTests: list(raw.workerTests, 'provider worker tests'),
    workerTestResults: list(raw.workerTestResults, 'provider worker test results'),
    knownLimitations: list(raw.knownLimitations, 'provider known limitations'),
    evidenceReferences: list(raw.evidenceReferences, 'provider evidence references'),
    candidateCommit: raw.candidateCommit ?? null,
  };
  if (completion.candidateCommit !== null && typeof completion.candidateCommit !== 'string') {
    throw new Error('provider candidate commit claim must be a string when present');
  }
  return completion;
}

export function runProviderPlan(plan) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(plan.command, plan.args, { cwd: plan.cwd, windowsHide: true, shell: false }); }
    catch (error) { resolve({ exitCode: null, error: String(error?.message ?? error), stdout: '', stderr: '' }); return; }
    let stdout = ''; let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ exitCode: null, error: String(error.message), stdout, stderr }));
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
    child.stdin?.end(plan.stdin);
  });
}

function exactProviderSha(value) {
  const sha = String(value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw Object.assign(new Error('provider candidate commit claim is not an exact 40-character SHA'), {
      classification: 'invalid_candidate_sha',
    });
  }
  return sha;
}

function failPreflight(db, attempt, input, error) {
  const reason = error instanceof Error ? error.message : String(error);
  const failed = failAttempt(db, {
    attemptId: attempt.id,
    kind: 'governed_execution_preflight_failure',
    result: 'Governed provider execution was refused before launch.',
    rootCause: reason,
    evidence: `Attempted provider action ${input.resume ? 'resume' : 'run'} was refused: ${reason}`,
    nextDirection: 'Start a new attempt with exact workspace ownership and an attempt-bound delivered Context Pack.',
  });
  return { state: 'FAILED', attempt: failed, provider: String(input.provider ?? ''), classification: 'preflight_validation_failure' };
}

function executionFor(db, executionId) {
  const execution = db.prepare('SELECT * FROM governed_execution WHERE id = ?').get(executionId);
  if (!execution) throw new Error(`unknown governed execution ${executionId}`);
  return execution;
}

function beginExecution(db, { task, attempt, workspace, delivery, writerId, provider, model, resume }) {
  const id = `execution-${randomUUID()}`;
  db.prepare(`
    INSERT INTO governed_execution(
      id, task_id, attempt_id, workspace_id, writer_id, provider, model,
      working_directory, attempted_action, context_pack_hash, state, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING', ?)
  `).run(
    id, task.id, attempt.id, workspace.id, writerId, provider,
    model ? String(model).trim() : null,
    workspace.workspace_path, resume ? 'resume' : 'run', delivery.context_pack_hash,
    new Date().toISOString(),
  );
  return executionFor(db, id);
}

function recordProviderReturn(db, executionId, exitCode) {
  const execution = executionFor(db, executionId);
  if (execution.state !== 'RUNNING') throw new Error(`governed execution ${execution.id} is already ${execution.state}`);
  db.prepare(`
    UPDATE governed_execution
    SET state = 'PROVIDER_RETURNED', provider_exit_code = ?, provider_returned_at = ?
    WHERE id = ?
  `).run(exitCode === null || exitCode === undefined ? null : Number(exitCode), new Date().toISOString(), execution.id);
  return executionFor(db, execution.id);
}

function failExecution(db, executionId, input) {
  const execution = executionFor(db, executionId);
  const attempt = canonicalAttempt(db, execution.attempt_id);
  const at = new Date().toISOString();
  const classification = required(input.classification, 'failure classification');
  const reason = required(input.reason, 'failure reason');
  db.transaction(() => {
    addEvidence(db, {
      attemptId: attempt.id,
      kind: 'governed_execution_failure',
      summary: `${classification}: ${reason}`,
      command: input.attemptedAction ?? execution.attempted_action,
      exitCode: input.exitCode,
    }, () => at);
    db.prepare(`
      UPDATE governed_execution
      SET state = 'FAILED', failure_classification = ?, failure_reason = ?, completed_at = ?
      WHERE id = ?
    `).run(classification, reason, at, execution.id);
    db.prepare(`
      UPDATE development_attempt
      SET status = 'FAILED', result = ?, root_cause = ?, limitation = ?, next_direction = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      `Governed execution ${execution.id} failed.`, reason,
      input.limitation ? String(input.limitation).trim() : null,
      input.nextDirection ? String(input.nextDirection).trim() : 'Start a new governed attempt from the durable failure evidence.',
      at, at, attempt.id,
    );
    db.prepare(`
      UPDATE development_task SET status = 'FAILED', blocker = ?, next_action = ?, updated_at = ? WHERE id = ?
    `).run(
      reason,
      input.nextDirection ? String(input.nextDirection).trim() : 'Start a new governed attempt from the durable failure evidence.',
      at, attempt.task_id,
    );
  })();
  return { execution: executionFor(db, execution.id), attempt: canonicalAttempt(db, attempt.id) };
}

function persistSubmission(db, { execution, task, attempt, workspace, delivery, completion, candidateGitSha }) {
  const current = executionFor(db, execution.id);
  if (current.state !== 'PROVIDER_RETURNED') {
    throw new Error(`Submission Bundle requires provider-returned governed execution ${current.id}`);
  }
  const claims = list(completion.implementationClaims, 'submission implementation claims');
  if (claims.length === 0) throw new Error('Submission Bundle requires at least one normalized implementation claim');
  const at = new Date().toISOString();
  let bundleId;
  db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO submission_bundle(
        execution_id, task_id, attempt_id, workspace_id, writer_id,
        provider, model, working_base_git_sha, candidate_git_sha,
        changed_paths_json, implementation_claims_json, worker_tests_json,
        worker_test_results_json, limitations_json, evidence_references_json,
        context_pack_hash, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      current.id, task.id, attempt.id, workspace.id, workspace.writer_id,
      current.provider, completion.model, attempt.base_git_sha, candidateGitSha,
      JSON.stringify(list(completion.changedPaths, 'submission changed paths')),
      JSON.stringify(claims),
      JSON.stringify(list(completion.workerTests, 'submission worker tests')),
      JSON.stringify(list(completion.workerTestResults, 'submission worker test results')),
      JSON.stringify(list(completion.knownLimitations, 'submission limitations')),
      JSON.stringify(list(completion.evidenceReferences, 'submission evidence references')),
      delivery.context_pack_hash, at,
    );
    bundleId = result.lastInsertRowid;
    db.prepare(`
      UPDATE governed_execution
      SET state = 'COMPLETED', model = COALESCE(?, model), provider_session_id = ?,
          observed_candidate_git_sha = ?, completed_at = ?
      WHERE id = ?
    `).run(completion.model, completion.sessionId, candidateGitSha, at, current.id);
    persistCanonicalVerificationPlan(db, workspace.workspace_path, {
      attemptId: attempt.id,
      candidateGitSha,
      submissionBundleId: bundleId,
    }, () => at);
    db.prepare(`
      UPDATE development_attempt
      SET status = 'CANDIDATE', candidate_git_sha = ?, result = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      candidateGitSha,
      `Governed ${current.provider} execution produced candidate ${candidateGitSha}.`,
      at, at, attempt.id,
    );
    db.prepare(`
      UPDATE development_task
      SET status = 'CANDIDATE', blocker = NULL,
          next_action = 'Run deterministic verification against the exact candidate commit.', updated_at = ?
      WHERE id = ?
    `).run(at, task.id);
  })();
  return {
    bundle: db.prepare('SELECT * FROM submission_bundle WHERE id = ?').get(bundleId),
    execution: executionFor(db, current.id),
    attempt: canonicalAttempt(db, attempt.id),
  };
}

function canonicalSubmissionPostconditions(db, { task, attempt, workspace, delivery, execution, candidateGitSha }) {
  const currentTask = canonicalTask(db, task.id);
  const currentAttempt = canonicalAttempt(db, attempt.id);
  const currentWorkspace = db.prepare('SELECT * FROM managed_workspace WHERE id = ?').get(workspace.id);
  const currentDelivery = db.prepare(`
    SELECT * FROM context_pack_delivery
    WHERE task_id = ? AND attempt_id = ? AND workspace_id = ? AND context_pack_hash = ?
  `).get(task.id, attempt.id, workspace.id, delivery.context_pack_hash);
  const currentExecution = executionFor(db, execution.id);
  const bundles = db.prepare('SELECT * FROM submission_bundle WHERE execution_id = ? ORDER BY id').all(execution.id);
  const bundle = bundles[0];
  const valid = currentTask.id === task.id
    && currentWorkspace?.task_id === task.id
    && currentWorkspace?.attempt_id === attempt.id
    && currentWorkspace?.writer_id === workspace.writer_id
    && currentWorkspace?.status === 'ACTIVE'
    && currentAttempt.task_id === task.id
    && currentAttempt.primary_writer_id === workspace.writer_id
    && currentAttempt.status === 'CANDIDATE'
    && currentAttempt.candidate_git_sha === candidateGitSha
    && !!currentDelivery
    && currentExecution.task_id === task.id
    && currentExecution.attempt_id === attempt.id
    && currentExecution.workspace_id === workspace.id
    && currentExecution.writer_id === workspace.writer_id
    && currentExecution.context_pack_hash === delivery.context_pack_hash
    && currentExecution.state === 'COMPLETED'
    && currentExecution.observed_candidate_git_sha === candidateGitSha
    && bundles.length === 1
    && bundle.task_id === task.id
    && bundle.attempt_id === attempt.id
    && bundle.workspace_id === workspace.id
    && bundle.writer_id === workspace.writer_id
    && bundle.execution_id === execution.id
    && bundle.context_pack_hash === delivery.context_pack_hash
    && bundle.candidate_git_sha === candidateGitSha;
  if (!valid) {
    throw Object.assign(new Error('canonical governed-execution postconditions are missing or contradictory'), {
      classification: 'canonical_postcondition_failure',
    });
  }
  return { bundle, execution: currentExecution, attempt: currentAttempt };
}

async function executeGoverned(db, root, input, runProvider) {
  const attempt = canonicalAttempt(db, required(input.attemptId, 'attempt ID'));
  let task;
  let workspace;
  let adapter;
  let delivery;
  let pack;
  try {
    task = canonicalTask(db, required(input.taskId, 'task ID'));
    if (attempt.task_id !== task.id) throw new Error(`attempt ${attempt.id} does not belong to task ${task.id}`);
    workspace = validateManagedWorkspace(db, root, {
      taskId: task.id, attemptId: attempt.id, writerId: required(input.writerId, 'primary writer identity'),
      cwd: path.resolve(required(input.cwd, 'executing working directory')),
    });
    adapter = builderAdapter(input.provider);
    ({ pack, delivery } = deliverCanonicalContextPack(db, root, { attemptId: attempt.id }));
    if (input.contextPackHash
        && String(input.contextPackHash).trim().toLowerCase() !== delivery.context_pack_hash) {
      throw new Error(`caller Context Pack hash does not match the canonical delivery for attempt ${attempt.id}`);
    }
  } catch (error) {
    return failPreflight(db, attempt, input, error);
  }

  const execution = beginExecution(db, {
    task, attempt, workspace, delivery, writerId: input.writerId,
    provider: adapter.id, model: input.model, resume: !!input.resume,
  });
  const request = {
    taskId: task.id,
    attemptId: attempt.id,
    workspacePath: workspace.workspace_path,
    workingBaseCommit: attempt.base_git_sha,
    objective: task.outcome,
    contextPackHash: delivery.context_pack_hash,
    contextPackText: renderContextPack(pack),
  };
  let raw;
  try {
    const plan = adapter.launch(request, {
      model: input.model,
      sessionId: input.sessionId,
      resume: !!input.resume,
      outputPath: input.outputPath,
    });
    raw = await runProvider(plan);
  } catch (error) {
    const failure = failExecution(db, execution.id, {
      classification: 'provider_launch_or_transport_failure',
      reason: error instanceof Error ? error.message : String(error),
      attemptedAction: execution.attempted_action,
    });
    return { state: 'FAILED', provider: adapter.id, ...failure };
  }

  try {
    recordProviderReturn(db, execution.id, raw?.exitCode);
    if (!raw || typeof raw !== 'object' || raw.error || raw.timedOut || raw.exitCode !== 0) {
      throw Object.assign(new Error(raw?.error ?? raw?.stderr ?? `provider exit code ${raw?.exitCode ?? '(missing)'}`), {
        classification: 'provider_terminal_failure',
        limitation: raw?.timedOut ? 'Provider execution timed out.' : null,
      });
    }
    const completion = normalizeRawCompletion(adapter.id, raw);
    if (raw.contextPackHash
        && String(raw.contextPackHash).trim().toLowerCase() !== delivery.context_pack_hash) {
      throw Object.assign(new Error(`provider Context Pack hash does not match the canonical delivery for attempt ${attempt.id}`), {
        classification: 'context_pack_hash_mismatch',
      });
    }
    validateManagedWorkspace(db, root, {
      taskId: task.id, attemptId: attempt.id, writerId: input.writerId, cwd: workspace.workspace_path,
    });
    if (gitStatusText(workspace.workspace_path).trim()) {
      throw Object.assign(new Error('managed workspace contains uncommitted provider changes; no candidate commit can be observed'), {
        classification: 'candidate_validation_failure',
      });
    }
    const observedCandidate = resolveCommit(workspace.workspace_path, 'HEAD');
    if (completion.candidateCommit && exactProviderSha(completion.candidateCommit) !== observedCandidate) {
      throw Object.assign(new Error(`provider candidate claim does not match observed managed-workspace HEAD ${observedCandidate}`), {
        classification: 'candidate_sha_mismatch',
      });
    }
    completion.model ??= input.model ? String(input.model).trim() : null;
    persistSubmission(db, {
      execution, task, attempt, workspace, delivery, completion, candidateGitSha: observedCandidate,
    });
    const persisted = canonicalSubmissionPostconditions(db, {
      task, attempt, workspace, delivery, execution, candidateGitSha: observedCandidate,
    });
    return { state: 'SUBMITTED', provider: adapter.id, ...persisted, sessionId: completion.sessionId };
  } catch (error) {
    const failure = failExecution(db, execution.id, {
      classification: error?.classification ?? 'post_provider_validation_failure',
      reason: error instanceof Error ? error.message : String(error),
      limitation: error?.limitation,
      attemptedAction: execution.attempted_action,
      exitCode: raw?.exitCode,
      nextDirection: 'Start a new governed attempt using the durable provider-return failure evidence.',
    });
    return { state: 'FAILED', provider: adapter.id, ...failure };
  }
}

export async function runGovernedExecution(db, root, input, ...unsupportedDependencies) {
  if (unsupportedDependencies.length) {
    const attempt = canonicalAttempt(db, required(input.attemptId, 'attempt ID'));
    return failPreflight(db, attempt, input, new Error(
      'governed execution dependency injection is disabled; production owns provider launch and canonical Submission Bundle persistence',
    ));
  }
  return executeGoverned(db, root, input, runProviderPlan);
}

// Tests may replace only provider transport. Canonical normalization,
// persistence, state transitions, and postcondition checks remain production
// code and cannot be injected or skipped.
export const TEST_ONLY = Object.freeze({
  runGovernedExecutionWithProvider(db, root, input, runProvider) {
    if (typeof runProvider !== 'function') throw new Error('test provider runner must be a function');
    return executeGoverned(db, root, input, runProvider);
  },
});
