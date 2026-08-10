#!/usr/bin/env node
// Persisted, per-run state for the LandOS Development Improvement Loop.
//
// The loop owns the task. Every run gets its own run id and its own directory
// under `.runtime/devloop/<runId>/`, so two runs can never read or write each
// other's task, criteria, attempts or instructions.
//
// The acceptance criteria are written once at run creation and are then
// immutable: their bytes are hashed into run.json, and every load re-verifies
// the hash. A builder that edits the criteria file, or a later loop revision
// that tries to soften them, fails the load instead of quietly passing.
//
// This module touches no .env, no database, and no network.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const DEVLOOP_STATE_DIR = path.join('.runtime', 'devloop');
export const CANDIDATE_LESSONS_PATH = path.join('.landos', 'devloop', 'candidate-lessons.json');

export const CHECK_KINDS = new Set(['file-exists', 'file-contains', 'command', 'module-probe', 'scope-containment']);

export function runsRoot(root) {
  return path.join(root, DEVLOOP_STATE_DIR);
}
export function runDir(root, runId) {
  assertRunId(runId);
  return path.join(runsRoot(root), runId);
}
export function attemptDir(root, runId, attemptNumber) {
  return path.join(runDir(root, runId), 'attempts', `attempt-${String(attemptNumber).padStart(2, '0')}`);
}

export function assertRunId(runId) {
  if (typeof runId !== 'string' || !/^[a-z0-9][a-z0-9-]{2,79}$/.test(runId)) {
    throw new Error(`Invalid run id "${runId}". Use lowercase letters, digits and hyphens.`);
  }
  return runId;
}

// Any path the loop writes must stay inside the run's own directory. This is
// the isolation guarantee, enforced rather than assumed.
export function assertInsideRun(root, runId, target) {
  const base = path.resolve(runDir(root, runId));
  const resolved = path.resolve(target);
  const rel = path.relative(base, resolved);
  if (rel !== '' && (rel.startsWith('..') || path.isAbsolute(rel))) {
    throw new Error(`Path escaped run ${runId}: ${target}`);
  }
  return resolved;
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function newRunId(taskSlug, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'z');
  return assertRunId(`${slugify(taskSlug) || 'devloop'}-${stamp.toLowerCase()}`);
}

export function validateSpec(spec) {
  const issues = [];
  const requiredText = ['task', 'operatorOutcome', 'builderBrief'];
  for (const field of requiredText) {
    if (typeof spec?.[field] !== 'string' || !spec[field].trim()) issues.push(`spec.${field} must be a non-empty string`);
  }
  if (!Array.isArray(spec?.allowedPaths) || spec.allowedPaths.length === 0) {
    issues.push('spec.allowedPaths must list at least one repository-relative path prefix');
  }
  if (!Array.isArray(spec?.checks) || spec.checks.length === 0) {
    issues.push('spec.checks must list at least one acceptance check');
  } else {
    const seen = new Set();
    for (const check of spec.checks) {
      if (!check?.id) issues.push('every check needs an id');
      else if (seen.has(check.id)) issues.push(`duplicate check id "${check.id}"`);
      else seen.add(check.id);
      if (!CHECK_KINDS.has(check?.kind)) issues.push(`check "${check?.id}" has unknown kind "${check?.kind}"`);
      if (typeof check?.requirement !== 'string' || !check.requirement.trim()) {
        issues.push(`check "${check?.id}" needs a plain-English requirement; it is what the loop feeds back on FAIL`);
      }
      if (check?.kind === 'module-probe' && !check.probe && !check.probeFile) {
        issues.push(`check "${check.id}" is a module-probe and needs probe source or probeFile`);
      }
    }
  }
  if (spec?.builders && !Array.isArray(spec.builders)) issues.push('spec.builders must be an array of builder ids when present');
  if (spec?.mode !== undefined && !SPEC_MODES.has(spec.mode)) {
    issues.push(`spec.mode must be one of ${[...SPEC_MODES].join(', ')} when present`);
  }
  return issues;
}

// Real LandOS work is the normal mode and needs no flag. A selftest spec exists
// only to exercise the loop itself, so it has to be asked for explicitly and is
// labelled everywhere it appears.
export const SPEC_MODES = new Set(['real', 'selftest']);
export function specMode(spec) {
  return spec?.mode ?? 'real';
}

export function createRun(root, spec, { now = new Date(), runId = newRunId(spec?.task ?? 'devloop', now), baselineGitStatus = '' } = {}) {
  const issues = validateSpec(spec);
  if (issues.length) throw new Error(`Invalid dev loop spec:\n- ${issues.join('\n- ')}`);

  const dir = runDir(root, runId);
  if (existsSync(path.join(dir, 'criteria.json'))) {
    throw new Error(`Run ${runId} already exists; acceptance criteria are immutable and are never rewritten.`);
  }
  mkdirSync(path.join(dir, 'attempts'), { recursive: true });

  const criteria = {
    runId,
    frozenAt: now.toISOString(),
    task: spec.task,
    operatorOutcome: spec.operatorOutcome,
    allowedPaths: [...spec.allowedPaths],
    // Probes may be authored as separate files for readability, but they are
    // inlined here so the frozen criteria are self-contained and the hash
    // covers the probe source itself.
    checks: spec.checks.map((check) => {
      if (check.kind !== 'module-probe' || !check.probeFile) return { ...check };
      const { probeFile, ...rest } = check;
      return { ...rest, probe: readFileSync(path.resolve(root, probeFile), 'utf8'), probeSource: probeFile };
    }),
  };
  const criteriaText = `${JSON.stringify(criteria, null, 2)}\n`;
  writeFileSync(path.join(dir, 'criteria.json'), criteriaText, 'utf8');

  const run = {
    runId,
    createdAt: now.toISOString(),
    status: 'open',
    mode: specMode(spec),
    task: spec.task,
    operatorOutcome: spec.operatorOutcome,
    criteriaSha256: sha256(criteriaText),
    builders: spec.builders ?? null,
    startingBuilderId: spec.startingBuilderId ?? null,
    nextBuilderId: spec.startingBuilderId ?? null,
    // The builder brief is mutable on purpose: improving it is the loop's job.
    // The criteria above are not.
    currentBrief: spec.builderBrief,
    corrections: [],
    attempts: [],
    baselineGitStatus,
    // Builders never run in the primary worktree. These are filled in by the
    // orchestrator right after creation, once the run's own worktree exists.
    worktree: null,
    worktreeHead: null,
    shareNodeModules: spec.shareNodeModules === true,
    // Filled in by the orchestrator before attempt 1.
    builderReadiness: null,
    acceptedPatch: null,
    verdict: null,
  };
  saveRun(root, run);
  return { run, criteria };
}

export function saveRun(root, run) {
  const dir = runDir(root, run.runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  return run;
}

export function loadRun(root, runId) {
  const dir = runDir(root, runId);
  const runFile = path.join(dir, 'run.json');
  const criteriaFile = path.join(dir, 'criteria.json');
  if (!existsSync(runFile) || !existsSync(criteriaFile)) throw new Error(`No dev loop run "${runId}" under ${runsRoot(root)}`);
  const run = JSON.parse(readFileSync(runFile, 'utf8'));
  const criteriaText = readFileSync(criteriaFile, 'utf8');
  if (run.runId !== runId) throw new Error(`Run state is cross-contaminated: ${runFile} declares runId "${run.runId}"`);
  assertCriteriaIntact(run, criteriaText);
  return { run, criteria: JSON.parse(criteriaText) };
}

export function assertCriteriaIntact(run, criteriaText) {
  const actual = sha256(criteriaText);
  if (actual !== run.criteriaSha256) {
    throw new Error(
      `Acceptance criteria for run ${run.runId} changed after the run was created ` +
        `(expected ${run.criteriaSha256.slice(0, 12)}, found ${actual.slice(0, 12)}). ` +
        'Criteria are immutable; start a new run instead.',
    );
  }
  return true;
}

export function recordAttempt(root, run, attempt) {
  const dir = attemptDir(root, run.runId, attempt.attemptNumber);
  assertInsideRun(root, run.runId, dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'attempt.json'), `${JSON.stringify(attempt, null, 2)}\n`, 'utf8');
  run.attempts = run.attempts.filter((entry) => entry.attemptNumber !== attempt.attemptNumber);
  run.attempts.push({
    attemptNumber: attempt.attemptNumber,
    builderId: attempt.builderId,
    startedAt: attempt.startedAt,
    claim: attempt.builder?.claim ?? 'UNKNOWN',
    verdict: attempt.evaluation?.verdict ?? 'ERROR',
    failedCheckIds: (attempt.evaluation?.checks ?? []).filter((check) => !check.pass).map((check) => check.id),
    switched: attempt.builderSwitch?.switch ?? false,
  });
  run.attempts.sort((a, b) => a.attemptNumber - b.attemptNumber);
  saveRun(root, run);
  return dir;
}

export function writeAttemptArtifact(root, runId, attemptNumber, name, contents) {
  const dir = attemptDir(root, runId, attemptNumber);
  const target = assertInsideRun(root, runId, path.join(dir, name));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents, 'utf8');
  return target;
}

export function listRuns(root) {
  const base = runsRoot(root);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(base, entry.name, 'run.json')))
    .map((entry) => {
      const run = JSON.parse(readFileSync(path.join(base, entry.name, 'run.json'), 'utf8'));
      return {
        runId: run.runId,
        status: run.status,
        verdict: run.verdict,
        task: run.task,
        attempts: run.attempts.length,
        createdAt: run.createdAt,
      };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
