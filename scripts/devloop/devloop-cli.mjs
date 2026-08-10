#!/usr/bin/env node
// LandOS Development Improvement Loop — orchestrator CLI.
//
// Development-only. This loop exists to improve how LandOS gets built. It is
// never wired into Property Intelligence, research lanes, or anything an
// operator touches at runtime.
//
// The loop owns the task, the run state, the frozen acceptance criteria, the
// attempt history, the failure diagnoses and the next instructions. Coding
// agents are interchangeable builders it launches. Tyler never copies a prompt
// between sessions: the orchestrator composes the next prompt from persisted
// state and hands it to the next builder itself.
//
//   npm run landos:devloop -- builders
//   npm run landos:devloop -- start scripts/devloop/specs/<spec>.json --max-attempts 3
//   npm run landos:devloop -- resume <runId> --max-attempts 2
//   npm run landos:devloop -- status [runId]
//   npm run landos:devloop -- show <runId>
//   npm run landos:devloop -- lessons

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { BUILDERS, detectBuilder, getBuilder, launchBuilder, listBuilders, probeBuilders } from './builders.mjs';
import { buildAcceptedPatchPackage } from './patch-package.mjs';
import { evaluateAttempt, isLoopArtifact, parseGitStatus } from './evaluator.mjs';
import { applyCorrections, composeInstructions } from './instructions.mjs';
import { deriveCandidateLessons, loadCandidateLessons, recordCandidateLesson } from './lessons.mjs';
import {
  attemptDir,
  createRun,
  listRuns,
  loadRun,
  recordAttempt,
  runDir,
  saveRun,
  specMode,
  writeAttemptArtifact,
} from './run-state.mjs';
import { assertPrimaryUnchanged, createRunWorktree, removeRunWorktree } from './worktree.mjs';

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function gitStatus(root) {
  // --untracked-files=all matters: plain `git status --short` collapses a wholly
  // untracked directory to one `?? dir/` line, which would hide every file a
  // builder wrote or rewrote inside a new directory.
  const result = spawnSync('git', ['status', '--short', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return String(result.stdout ?? '');
}

// An untracked file shows the same `?? path` line whether it was just created
// or rewritten in place, so the status text alone cannot tell what a builder
// changed. The snapshot pairs the dirty path set with a content hash of each
// path, and the diff below compares both.
export function dirtySnapshot(root, statusText) {
  const hashes = {};
  for (const target of parseGitStatus(statusText)) {
    if (isLoopArtifact(target) || target.endsWith('/')) continue;
    const file = path.join(root, target);
    try {
      hashes[target] = createHash('sha1').update(readFileSync(file)).digest('hex');
    } catch {
      hashes[target] = 'unreadable';
    }
  }
  return { statusText, hashes };
}

export function changedSince(before, after) {
  const keys = new Set([...Object.keys(before.hashes ?? {}), ...Object.keys(after.hashes ?? {})]);
  return [...keys]
    .filter((target) => !isLoopArtifact(target))
    .filter((target) => (before.hashes ?? {})[target] !== (after.hashes ?? {})[target])
    .sort();
}

function log(line) {
  console.log(line);
}

function registryFor(spec) {
  return spec?.builders?.length ? spec.builders.map((id) => getBuilder(id)) : BUILDERS;
}

function availableIds(spec) {
  return registryFor(spec).map((builder) => detectBuilder(builder)).filter((probe) => probe.available).map((probe) => probe.id);
}

function reportReadiness(readiness) {
  for (const entry of readiness.builders) {
    log(`  ${entry.id.padEnd(8)} ${entry.available ? 'READY    ' : 'UNAVAILABLE'} ${entry.version ?? entry.detail}`);
  }
  if (!readiness.available.length) {
    throw new Error('No builder CLI is callable on this machine. Install or repair one before starting a run.');
  }
  if (!readiness.switchingPossible) {
    log(
      `  only ${readiness.available[0]} is usable; the run continues with improved instructions on failure, ` +
        'with no builder to switch to',
    );
  }
}

function executeAttempt(root, runId, { timeoutMs } = {}) {
  const { run, criteria } = loadRun(root, runId);
  // Every builder for this run works inside the run's own worktree. The primary
  // worktree is never a builder cwd, so containment is preventive: a builder
  // with unrestricted filesystem access still has nothing of Tyler's to reach.
  const workspace = run.worktree ? path.resolve(root, run.worktree) : null;
  if (!workspace || !existsSync(workspace)) {
    throw new Error(`Run ${runId} has no worktree at ${run.worktree ?? '(unset)'}. Builders never run in the primary worktree.`);
  }
  const pool = availableIds(run);
  if (!pool.length) throw new Error('No builder CLI is available on this machine.');
  const attemptNumber = (run.attempts?.length ?? 0) + 1;
  const builderId = pool.includes(run.nextBuilderId) ? run.nextBuilderId : pool[0];
  const builder = getBuilder(builderId);
  const directory = attemptDir(root, runId, attemptNumber);
  mkdirSync(directory, { recursive: true });

  const promptText = composeInstructions({ run, criteria, attemptNumber, builderId });
  writeAttemptArtifact(root, runId, attemptNumber, 'instructions.md', promptText);

  log(`\n=== run ${runId} | attempt ${attemptNumber} | builder ${builder.label} (${builderId}) ===`);
  log(`workspace: ${path.relative(root, workspace)} (isolated worktree at ${run.worktreeHead?.slice(0, 7)})`);
  const before = dirtySnapshot(workspace, gitStatus(workspace));
  const primaryBefore = dirtySnapshot(root, gitStatus(root));
  const startedAt = new Date().toISOString();
  const builderLaunch = launchBuilder(builder, { cwd: workspace, promptText, attemptDir: directory, timeoutMs });
  writeAttemptArtifact(root, runId, attemptNumber, 'builder-stdout.txt', builderLaunch.stdout);
  writeAttemptArtifact(root, runId, attemptNumber, 'builder-stderr.txt', builderLaunch.stderr);
  const after = dirtySnapshot(workspace, gitStatus(workspace));
  const changedPaths = changedSince(before, after);
  const primaryChanged = changedSince(primaryBefore, dirtySnapshot(root, gitStatus(root)));
  assertPrimaryUnchanged(primaryChanged, { runId, attemptNumber });
  log(
    `builder finished in ${Math.round(builderLaunch.durationMs / 1000)}s, exit ${builderLaunch.exitCode}, ` +
      `claim ${builderLaunch.claim}, changed ${changedPaths.length} path(s) in the run worktree, ` +
      `${primaryChanged.length} in the primary worktree`,
  );

  const { evaluation, diagnosis, corrections, builderSwitch } = evaluateAttempt({
    criteria,
    run,
    builderId,
    builderLaunch,
    attemptNumber,
    availableBuilderIds: pool,
    ctx: {
      // Every check runs against the run worktree, the same tree the builder
      // saw. The evaluator still enforces the task's allowed paths inside it.
      root: workspace,
      attemptDirectory: directory,
      // Containment is measured against the snapshot taken immediately before
      // this attempt, not against run creation. Anything that changed in
      // between belongs to whoever changed it, not to this builder.
      changedPaths,
    },
  });

  for (const check of evaluation.checks) log(`  [${check.pass ? 'pass' : 'FAIL'}] ${check.id}: ${check.detail}`);
  log(`evaluator verdict: ${evaluation.verdict}`);

  const attempt = {
    attemptNumber,
    runId,
    builderId,
    startedAt,
    finishedAt: new Date().toISOString(),
    instructionsSha: null,
    builder: {
      launched: builderLaunch.launched,
      exitCode: builderLaunch.exitCode,
      timedOut: builderLaunch.timedOut,
      durationMs: builderLaunch.durationMs,
      claim: builderLaunch.claim,
      error: builderLaunch.error,
    },
    workspace: path.relative(root, workspace),
    changedPaths,
    primaryWorktreeChangedPaths: primaryChanged,
    evaluation,
    diagnosis,
    corrections,
    builderSwitch,
  };
  recordAttempt(root, run, attempt);

  if (evaluation.verdict === 'PASS') {
    run.status = 'closed';
    run.verdict = 'PASS';
    run.nextBuilderId = builderId;
    log(`ACCEPTED by the independent evaluator on attempt ${attemptNumber} (builder ${builderId}).`);
    const pkg = buildAcceptedPatchPackage(root, { run, criteria, attempt, workspace });
    run.acceptedPatch = {
      directory: path.relative(root, pkg.directory),
      diff: path.relative(root, pkg.diffPath),
      files: pkg.files,
      appliesToPrimary: pkg.apply,
      applied: false,
    };
    saveRun(root, run);
    log(`accepted patch package: ${path.relative(root, pkg.directory)}`);
    log(`  files: ${pkg.files.join(', ') || '(none)'}`);
    log(`  applies to the primary worktree: ${pkg.apply.appliesCleanly ? 'YES' : `NO — ${pkg.apply.detail}`}`);
    log('  not applied. Integration stays an explicit decision.');
    return { run, criteria, attempt, done: true };
  }

  log('\ndiagnosis');
  log(`  GOAL:   ${diagnosis.GOAL}`);
  log(`  PROVEN: ${diagnosis.PROVEN.join(' | ')}`);
  log(`  FAILED: ${diagnosis.FAILED.join(' | ')}`);
  log(`  CAUSE:  ${diagnosis.CAUSE}`);
  log(`  NEXT:   ${diagnosis.NEXT.join(' | ')}`);

  applyCorrections(run, corrections);
  run.nextBuilderId = builderSwitch.to;
  run.verdict = 'FAIL';
  saveRun(root, run);
  log(
    builderSwitch.switch
      ? `builder switch: ${builderId} -> ${builderSwitch.to} [${builderSwitch.rule}] ${builderSwitch.reason}`
      : `builder kept: ${builderId} [${builderSwitch.rule}] ${builderSwitch.reason}`,
  );

  for (const lesson of deriveCandidateLessons(run, criteria)) recordCandidateLesson(root, lesson);
  return { run, criteria, attempt, done: false };
}

function loop(root, runId, maxAttempts, options) {
  let outcome = null;
  for (let index = 0; index < maxAttempts; index += 1) {
    const { run } = loadRun(root, runId);
    if (run.status === 'closed') break;
    outcome = executeAttempt(root, runId, options);
    if (outcome.done) break;
  }
  const { run, criteria } = loadRun(root, runId);
  if (run.status !== 'closed') {
    run.status = 'open';
    saveRun(root, run);
    log(`\nrun ${runId} still FAILING after ${run.attempts.length} attempt(s). Next builder: ${run.nextBuilderId}.`);
    log(`resume with: npm run landos:devloop -- resume ${runId}`);
  }
  return { run, criteria, outcome };
}

function printStatus(root, runId) {
  if (!runId) {
    const runs = listRuns(root);
    if (!runs.length) return log('No dev loop runs yet.');
    for (const entry of runs) {
      log(`${entry.runId}  ${entry.status.padEnd(6)} ${String(entry.verdict ?? '-').padEnd(4)} attempts=${entry.attempts}  ${entry.task}`);
    }
    return undefined;
  }
  const { run } = loadRun(root, runId);
  log(`run ${run.runId} [${run.status}] verdict=${run.verdict ?? '-'}`);
  log(`task: ${run.task}`);
  log(`worktree: ${run.worktree ?? '(removed)'} at ${run.worktreeHead?.slice(0, 7) ?? '-'}`);
  log(`next builder: ${run.nextBuilderId}`);
  for (const attempt of run.attempts) {
    log(
      `  attempt ${attempt.attemptNumber} builder=${attempt.builderId} claim=${attempt.claim} verdict=${attempt.verdict}` +
        (attempt.failedCheckIds.length ? ` failed=[${attempt.failedCheckIds.join(', ')}]` : ''),
    );
  }
  return undefined;
}

function printShow(root, runId) {
  const { run, criteria } = loadRun(root, runId);
  log(JSON.stringify({ run, criteria }, null, 2));
}

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const root = REPOSITORY_ROOT;
  const flag = (name, fallback) => {
    const index = argv.indexOf(name);
    return index === -1 ? fallback : argv[index + 1];
  };

  if (command === 'builders') {
    for (const builder of listBuilders()) {
      const probe = detectBuilder(getBuilder(builder.id));
      log(`${builder.id.padEnd(8)} ${probe.available ? 'available' : 'unavailable'}  ${probe.version ?? probe.detail}`);
      log(`         ${builder.label}: ${builder.notes}`);
    }
    return;
  }

  if (command === 'start') {
    const specPath = argv[1];
    if (!specPath || !existsSync(path.resolve(root, specPath))) {
      console.error('Usage: start <spec.json> [--max-attempts N] [--run-id id]');
      process.exitCode = 2;
      return;
    }
    const spec = JSON.parse(readFileSync(path.resolve(root, specPath), 'utf8'));
    const mode = specMode(spec);
    if (mode === 'selftest' && !argv.includes('--selftest')) {
      console.error(
        `${specPath} is a loop self-test spec, not real LandOS work. Real tasks are the normal mode and need no flag; ` +
          'pass --selftest if you really mean to exercise the loop itself.',
      );
      process.exitCode = 2;
      return;
    }
    const explicitId = flag('--run-id', undefined);
    const { run } = createRun(root, spec, {
      baselineGitStatus: gitStatus(root),
      ...(explicitId ? { runId: explicitId } : {}),
    });
    writeFileSync(path.join(runDir(root, run.runId), 'spec-source.txt'), `${specPath}\n`, 'utf8');

    log(`builder readiness (${mode} mode):`);
    const readiness = probeBuilders(registryFor(spec));
    reportReadiness(readiness);
    run.builderReadiness = readiness;
    run.nextBuilderId = readiness.available.includes(run.startingBuilderId) ? run.startingBuilderId : readiness.available[0];
    if (run.startingBuilderId && run.nextBuilderId !== run.startingBuilderId) {
      log(`  requested starting builder ${run.startingBuilderId} is unavailable; starting with ${run.nextBuilderId}`);
    }

    const worktree = createRunWorktree(root, run.runId, { shareNodeModules: run.shareNodeModules });
    run.worktree = path.relative(root, worktree.path);
    run.worktreeHead = worktree.head;
    run.nodeModulesLinked = worktree.nodeModulesLinked;
    saveRun(root, run);
    log(`created run ${run.runId}`);
    log(`state: ${path.relative(root, runDir(root, run.runId))}`);
    log(`worktree: ${run.worktree} detached at ${worktree.head.slice(0, 7)}${worktree.nodeModulesLinked ? ' (node_modules linked)' : ''}`);
    loop(root, run.runId, Number(flag('--max-attempts', '3')), { timeoutMs: Number(flag('--timeout-ms', '1200000')) });
    return;
  }

  if (command === 'resume') {
    const runId = argv[1];
    if (!runId) {
      console.error('Usage: resume <runId> [--max-attempts N]');
      process.exitCode = 2;
      return;
    }
    loop(root, runId, Number(flag('--max-attempts', '2')), { timeoutMs: Number(flag('--timeout-ms', '1200000')) });
    return;
  }

  if (command === 'status') {
    printStatus(root, argv[1]);
    return;
  }

  if (command === 'show') {
    if (!argv[1]) {
      console.error('Usage: show <runId>');
      process.exitCode = 2;
      return;
    }
    printShow(root, argv[1]);
    return;
  }

  if (command === 'cleanup') {
    const runIds = argv.slice(1).filter((entry) => !entry.startsWith('--'));
    const all = argv.includes('--all');
    if (!runIds.length && !all) {
      console.error("Usage: cleanup <runId>... | cleanup --all   (removes only run worktrees; history is kept)");
      process.exitCode = 2;
      return;
    }
    const targets = all ? listRuns(root).map((entry) => entry.runId) : runIds;
    for (const runId of targets) {
      const { run } = loadRun(root, runId);
      const outcome = removeRunWorktree(root, runId);
      if (outcome.removed) {
        log(`${run.runId}: removed the run worktree${outcome.junctions.length ? ` (unlinked ${outcome.junctions.join(', ')} first)` : ''}`);
        run.worktree = null;
        saveRun(root, run);
      } else {
        log(`${run.runId}: ${outcome.reason}`);
      }
      const kept = ['run.json', 'criteria.json', 'attempts/'];
      if (run.acceptedPatch) kept.push(run.acceptedPatch.directory.split(/[\\/]/).pop() + '/');
      log(`  kept: ${kept.join(', ')} under ${path.relative(root, runDir(root, run.runId))}`);
    }
    log('Primary worktree, primary node_modules, branches, other worktrees and other runs were not touched.');
    return;
  }

  if (command === 'lessons') {
    const store = loadCandidateLessons(root);
    if (!store.lessons.length) return log('No candidate lessons recorded.');
    for (const lesson of store.lessons) {
      log(`[${lesson.status}] ${lesson.pattern} (run ${lesson.runId}, x${lesson.occurrences})`);
      log(`  ${lesson.statement}`);
      log(`  evidence: ${lesson.evidence}`);
    }
    log('\nNothing above is in force. Canonical governance is only ever changed by hand.');
    return;
  }

  console.error('Use builders | start <spec.json> | resume <runId> | status [runId] | show <runId> | cleanup <runId> | lessons');
  process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

export { executeAttempt, loop, REPOSITORY_ROOT };
