#!/usr/bin/env node
// The independent evaluator for the LandOS Development Improvement Loop.
//
// The builder never decides acceptance. This module re-reads the run's frozen
// criteria, runs every check itself, and returns PASS only when all of them
// pass. A builder that reports ATTEMPT_COMPLETE while a check fails is recorded
// as having over-claimed, which is one of the clear reasons to hand the task to
// a different builder.
//
// On FAIL it produces a short structured diagnosis (GOAL, PROVEN, FAILED,
// CAUSE, NEXT), the corrections that improve the next builder's instructions,
// and the builder-switch decision. Diagnosis is rule-based and deterministic:
// V1 spends no model call to explain a failure it already measured.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Loop-owned artifacts are never counted as builder changes.
export const LOOP_ARTIFACT_PREFIXES = ['.runtime/', '.landos/devloop/'];

const DEFAULT_CHECK_TIMEOUT_MS = 10 * 60 * 1000;

function defaultExec(command, { cwd, timeoutMs }) {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    timeout: timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    status: result.status ?? null,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    error: result.error ? String(result.error.message) : null,
  };
}

export function parseGitStatus(text) {
  const paths = new Set();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let body = line.slice(3).trim();
    const arrow = body.indexOf(' -> ');
    if (arrow !== -1) body = body.slice(arrow + 4).trim();
    if (body.startsWith('"') && body.endsWith('"')) body = body.slice(1, -1);
    paths.add(body.replace(/\\/g, '/'));
  }
  return paths;
}

export function isLoopArtifact(target) {
  return LOOP_ARTIFACT_PREFIXES.some((prefix) => target.startsWith(prefix));
}

// Paths the attempt actually touched, minus the ones it was allowed to touch.
export function outOfScopePaths(changedPaths, allowedPaths) {
  const allowed = allowedPaths.map((entry) => entry.split('\\').join('/'));
  return [...(changedPaths ?? [])]
    .filter((target) => !isLoopArtifact(target))
    .filter((target) => !allowed.some((prefix) => target === prefix || target.startsWith(prefix)))
    .sort();
}

function truncate(text, limit = 900) {
  const trimmed = String(text ?? '').trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}\n...[truncated]` : trimmed;
}

export function runCheck(check, ctx, deps = {}) {
  const exec = deps.exec ?? defaultExec;
  const root = ctx.root;
  const base = { id: check.id, kind: check.kind, requirement: check.requirement };

  if (check.kind === 'file-exists') {
    const target = path.join(root, check.path);
    const pass = (deps.exists ?? existsSync)(target);
    return { ...base, pass, detail: pass ? `${check.path} exists` : `${check.path} does not exist` };
  }

  if (check.kind === 'file-contains') {
    const target = path.join(root, check.path);
    if (!(deps.exists ?? existsSync)(target)) {
      return { ...base, pass: false, detail: `${check.path} does not exist` };
    }
    const text = (deps.read ?? ((file) => readFileSync(file, 'utf8')))(target);
    const pattern = new RegExp(check.pattern, check.flags ?? '');
    const pass = pattern.test(text);
    return { ...base, pass, detail: pass ? `${check.path} matches /${check.pattern}/` : `${check.path} does not match /${check.pattern}/` };
  }

  if (check.kind === 'command') {
    const result = exec(check.command, { cwd: root, timeoutMs: check.timeoutMs });
    const expected = check.expectExitCode ?? 0;
    const pass = result.status === expected;
    return {
      ...base,
      pass,
      command: check.command,
      exitCode: result.status,
      detail: pass ? `exit ${result.status}` : truncate(`exit ${result.status}\n${result.stderr || result.stdout || result.error || ''}`),
    };
  }

  if (check.kind === 'module-probe') {
    // The probe belongs to the evaluator, not to the builder. It is written
    // fresh from the frozen criteria on every evaluation, so a builder cannot
    // weaken it by editing a test file it owns.
    const probeDir = path.join(ctx.attemptDirectory, 'evaluator');
    mkdirSync(probeDir, { recursive: true });
    const probePath = path.join(probeDir, `probe-${check.id}.mjs`);
    writeFileSync(probePath, check.probe, 'utf8');
    const result = exec(`node ${JSON.stringify(probePath)}`, { cwd: root, timeoutMs: check.timeoutMs });
    const pass = result.status === 0;
    const failLine = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).find((line) => line.includes('PROBE_FAIL'));
    return {
      ...base,
      pass,
      probePath,
      exitCode: result.status,
      detail: pass ? 'independent probe passed' : truncate(failLine ?? `${result.stderr || result.stdout || result.error || 'probe failed'}`),
    };
  }

  if (check.kind === 'scope-containment') {
    const strays = outOfScopePaths(ctx.changedPaths ?? [], ctx.allowedPaths);
    const pass = strays.length === 0;
    return {
      ...base,
      pass,
      outOfScopePaths: strays,
      detail: pass ? 'no changes outside the allowed paths' : `changed outside the allowed paths: ${strays.join(', ')}`,
    };
  }

  return { ...base, pass: false, detail: `unknown check kind "${check.kind}"` };
}

export function runChecks(criteria, ctx, deps = {}) {
  return criteria.checks.map((check) => runCheck(check, { ...ctx, allowedPaths: criteria.allowedPaths }, deps));
}

function causeFor(check) {
  switch (check.kind) {
    case 'file-exists':
      return `a required file was never created (${check.detail})`;
    case 'file-contains':
      return `a required file is missing required content (${check.detail})`;
    case 'command':
      return `a command the builder must leave green is red: ${check.command} -> ${check.detail}`;
    case 'module-probe':
      return `the implementation does not satisfy the evaluator's own probe: ${check.detail}`;
    case 'scope-containment':
      return `the builder wrote outside the allowed paths: ${check.detail}`;
    default:
      return check.detail;
  }
}

export function composeDiagnosis(criteria, checkResults, { builderLaunch } = {}) {
  const passed = checkResults.filter((check) => check.pass);
  const failed = checkResults.filter((check) => !check.pass);
  const launchProblem = builderLaunch && !builderLaunch.launched;
  return {
    GOAL: criteria.operatorOutcome,
    PROVEN: passed.length ? passed.map((check) => `${check.id}: ${check.requirement}`) : ['nothing yet'],
    FAILED: failed.map((check) => `${check.id}: ${check.requirement} — ${check.detail}`),
    CAUSE: launchProblem
      ? `the builder did not complete a launch (exit ${builderLaunch.exitCode}${builderLaunch.timedOut ? ', timed out' : ''})`
      : failed.length
        ? causeFor(failed[0])
        : 'no failing check',
    NEXT: failed.map((check) => check.next ?? `Satisfy: ${check.requirement}`),
  };
}

export function buildCorrections(checkResults, attemptNumber, builderId) {
  const failed = checkResults.filter((check) => !check.pass);
  if (!failed.length) return null;
  return {
    afterAttempt: attemptNumber,
    byBuilder: builderId,
    items: failed.map((check) => ({
      checkId: check.id,
      requirement: check.requirement,
      observed: check.detail,
      instruction: check.next ?? `The independent evaluator requires this and it is not yet true: ${check.requirement}`,
    })),
  };
}

// Builder switching. The evaluator only switches when it can name the reason.
export const SWITCH_RULES = [
  {
    id: 'launch_failed',
    applies: ({ builderLaunch }) => builderLaunch && !builderLaunch.launched,
    reason: ({ builderId, builderLaunch }) =>
      `builder ${builderId} failed to launch or exited non-zero (exit ${builderLaunch.exitCode}${builderLaunch.timedOut ? ', timed out' : ''})`,
  },
  {
    id: 'no_changes',
    applies: ({ changedPaths }) => Array.isArray(changedPaths) && changedPaths.length === 0,
    reason: ({ builderId }) => `builder ${builderId} produced no file changes at all`,
  },
  {
    id: 'scope_violation',
    applies: ({ checkResults }) => checkResults.some((check) => check.kind === 'scope-containment' && !check.pass),
    reason: ({ builderId }) => `builder ${builderId} wrote outside the allowed paths`,
  },
  {
    id: 'repeat_failure',
    applies: ({ run, builderId, checkResults }) => {
      const failing = new Set(checkResults.filter((check) => !check.pass).map((check) => check.id));
      return run.attempts.some(
        (prior) => prior.builderId === builderId && (prior.failedCheckIds ?? []).some((id) => failing.has(id)),
      );
    },
    reason: ({ builderId }) => `the same acceptance check already failed under builder ${builderId} on an earlier attempt`,
  },
  {
    id: 'overclaimed',
    applies: ({ builderLaunch, checkResults }) =>
      builderLaunch?.claim === 'COMPLETE' && checkResults.some((check) => !check.pass),
    reason: ({ builderId, checkResults }) =>
      `builder ${builderId} reported ATTEMPT_COMPLETE but independent evaluation failed ` +
      `${checkResults.filter((check) => !check.pass).map((check) => check.id).join(', ')}`,
  },
];

export function decideBuilderSwitch(context, nextIdFor) {
  for (const rule of SWITCH_RULES) {
    if (!rule.applies(context)) continue;
    const to = nextIdFor(context.builderId);
    if (!to || to === context.builderId) {
      return { switch: false, to: context.builderId, rule: rule.id, reason: `${rule.reason(context)}; no other builder is available` };
    }
    return { switch: true, to, rule: rule.id, reason: rule.reason(context) };
  }
  return {
    switch: false,
    to: context.builderId,
    rule: 'keep',
    reason: `no clear reason another builder is better suited; ${context.builderId} keeps the improved instructions`,
  };
}

export function evaluateAttempt({ criteria, run, builderId, builderLaunch, attemptNumber, ctx, availableBuilderIds = [] }, deps = {}) {
  const checkResults = runChecks(criteria, ctx, deps);
  const verdict = checkResults.every((check) => check.pass) ? 'PASS' : 'FAIL';
  const changedPaths = ctx.changedPaths ?? null;
  const evaluation = {
    verdict,
    evaluatedAt: (deps.now ?? (() => new Date()))().toISOString(),
    criteriaSha256: run.criteriaSha256,
    builderClaim: builderLaunch?.claim ?? 'UNKNOWN',
    checks: checkResults,
  };
  if (verdict === 'PASS') {
    return { evaluation, diagnosis: null, corrections: null, builderSwitch: { switch: false, to: builderId, rule: 'passed', reason: 'accepted' } };
  }
  const context = { run, builderId, builderLaunch, checkResults, changedPaths };
  const pool = availableBuilderIds.length ? availableBuilderIds : [builderId];
  const builderSwitch = decideBuilderSwitch(context, (current) => {
    const index = pool.indexOf(current);
    return index === -1 ? pool[0] : pool[(index + 1) % pool.length];
  });
  return {
    evaluation,
    diagnosis: composeDiagnosis(criteria, checkResults, { builderLaunch }),
    corrections: buildCorrections(checkResults, attemptNumber, builderId),
    builderSwitch,
  };
}
