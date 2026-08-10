#!/usr/bin/env node
// Accepted-patch packaging for the LandOS Development Improvement Loop.
//
// When the independent evaluator returns PASS, the run produces a review
// package: the diff, what it is, what proved it, and whether it would land
// cleanly. The loop never applies it. Integration stays a decision Tyler makes
// after reading this.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { runDir } from './run-state.mjs';

export function packageDir(root, runId) {
  return path.join(runDir(root, runId), 'accepted-patch');
}

function git(cwd, args, deps = {}) {
  const run = deps.run ?? spawnSync;
  const result = run('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return {
    status: result.status ?? null,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? result.error?.message ?? ''),
  };
}

// Untracked files are part of the accepted work, so they are registered as
// intent-to-add first. This touches only the run worktree's own index, which is
// disposable; the primary index is a separate file and is never opened.
export function collectDiff(workspace, deps = {}) {
  git(workspace, ['add', '--intent-to-add', '--all'], deps);
  const diff = git(workspace, ['diff', '--'], deps);
  const names = git(workspace, ['diff', '--name-only'], deps);
  return {
    diff: diff.stdout,
    files: names.stdout.split(/\r?\n/).filter(Boolean),
  };
}

export function checkAppliesToPrimary(root, diffPath, deps = {}) {
  const result = git(root, ['apply', '--check', diffPath], deps);
  return {
    appliesCleanly: result.status === 0,
    detail: result.status === 0 ? 'git apply --check succeeded against the primary worktree' : result.stderr.trim(),
  };
}

function summaryMarkdown({ run, criteria, attempt, files, apply, diffPath }) {
  const checks = (attempt.evaluation?.checks ?? [])
    .map((check) => `| ${check.id} | ${check.pass ? 'pass' : 'FAIL'} | ${String(check.detail).replace(/\n/g, ' ').slice(0, 160)} |`)
    .join('\n');
  const attempts = (run.attempts ?? [])
    .map(
      (entry) =>
        `| ${entry.attemptNumber} | ${entry.builderId} | ${entry.claim} | ${entry.verdict} | ` +
        `${entry.failedCheckIds?.length ? entry.failedCheckIds.join(', ') : '-'} | ${entry.switched ? 'yes' : 'no'} |`,
    )
    .join('\n');
  const readiness = (run.builderReadiness?.builders ?? [])
    .map((entry) => `- ${entry.id} (${entry.label}): ${entry.available ? `available, ${entry.version}` : `unavailable, ${entry.detail}`}`)
    .join('\n');

  return `# Accepted patch — ${run.runId}

**Not applied.** This is a review package. Integration is a separate, explicit decision.

## Task

${run.task}

## Operator outcome

${criteria.operatorOutcome}

## Result

- Verdict: **${attempt.evaluation?.verdict}**, decided by the independent evaluator
- Accepted on attempt ${attempt.attemptNumber}, builder \`${attempt.builderId}\`
- Mode: ${run.mode}
- Base commit: \`${run.worktreeHead}\`
- Run worktree: \`${run.worktree}\`
- Criteria sha256: \`${run.criteriaSha256}\`

## Files changed

${files.length ? files.map((file) => `- \`${file}\``).join('\n') : '- (none)'}

## Validation

| check | result | detail |
| --- | --- | --- |
${checks}

## Builder readiness at run start

${readiness || '- (not recorded)'}

## Attempt history

| # | builder | builder claim | evaluator verdict | failed checks | switched after |
| --- | --- | --- | --- | --- | --- |
${attempts}

## Applies to the primary worktree

- ${apply.appliesCleanly ? 'YES' : 'NO'} — ${apply.detail}
- Patch: \`${diffPath}\`

To apply after review, from the repository root:

    git apply "${diffPath}"
`;
}

export function buildAcceptedPatchPackage(root, { run, criteria, attempt, workspace }, deps = {}) {
  const directory = packageDir(root, run.runId);
  mkdirSync(directory, { recursive: true });

  const { diff, files } = collectDiff(workspace, deps);
  const diffPath = path.join(directory, 'accepted.diff');
  writeFileSync(diffPath, diff, 'utf8');

  const apply = checkAppliesToPrimary(root, diffPath, deps);
  const manifest = {
    runId: run.runId,
    mode: run.mode,
    task: run.task,
    operatorOutcome: criteria.operatorOutcome,
    verdict: attempt.evaluation?.verdict ?? null,
    acceptedOnAttempt: attempt.attemptNumber,
    acceptedBuilder: attempt.builderId,
    baseCommit: run.worktreeHead,
    runWorktree: run.worktree,
    criteriaSha256: run.criteriaSha256,
    allowedPaths: criteria.allowedPaths,
    filesChanged: files,
    validation: (attempt.evaluation?.checks ?? []).map((check) => ({
      id: check.id,
      kind: check.kind,
      pass: check.pass,
      requirement: check.requirement,
      detail: check.detail,
    })),
    builderReadiness: run.builderReadiness,
    attempts: run.attempts,
    appliesToPrimary: apply,
    applied: false,
    diff: path.relative(root, diffPath),
  };
  writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeFileSync(
    path.join(directory, 'SUMMARY.md'),
    summaryMarkdown({ run, criteria, attempt, files, apply, diffPath }),
    'utf8',
  );

  return { directory, diffPath, files, apply, manifest };
}
