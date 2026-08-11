#!/usr/bin/env node
// Execution for the LandOS parallel-first development harness.
//
// Three things happen here that the serial loop could not do:
//
//   1. Every lane whose dependencies are met launches at once, so four
//      independent areas cost roughly one lane's wall-clock, not four.
//   2. Write lanes work in their own detached worktree and own disjoint paths,
//      so concurrent builders cannot corrupt each other. Read-only recon lanes
//      need no worktree at all and share the primary tree.
//   3. Lane results are integrated onto a CLEAN primary tree by patch, which is
//      only possible because clean main is now the normal starting point. That
//      is what let the dirty-tree seeding machinery be deleted outright.
//
// Checks are split: cheap focused checks run first and can disprove a candidate
// in seconds; expensive certification only ever runs against a candidate that
// already survived them.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CC_READONLY_TOOLS, getBuilder, killTree, launchBuilderAsync } from './builders.mjs';
import { diagnoseFailure, formatDiagnosis } from './diagnose.mjs';
import { briefingFor, harvestDiscoveries, laneDir, readyLanes, saveMission } from './mission.mjs';
import { parseGitStatus } from './evaluator.mjs';
import { sha256 } from './run-state.mjs';

const DEFAULT_LANE_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_CHECK_TIMEOUT_MS = 15 * 60 * 1000;

function git(cwd, args, { maxBuffer = 64 * 1024 * 1024 } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer });
  return {
    status: result.status ?? null,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? result.error?.message ?? ''),
  };
}

/** Run a shell command without blocking the event loop, so checks can overlap. */
export function execAsync(command, { cwd, timeoutMs = DEFAULT_CHECK_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const cap = 32 * 1024 * 1024;

    child.stdout?.on('data', (chunk) => {
      if (stdout.length < cap) stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < cap) stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    const done = (status, error) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut, durationMs: Date.now() - startedAt, error: error ?? null });
    };
    child.on('error', (error) => done(null, String(error?.message ?? error)));
    child.on('close', (code) => done(code));
  });
}

// ------------------------------------------------------------------ workspace

export function prepareLaneWorkspace(root, mission, lane) {
  // A recon lane only reads. Giving it the primary tree costs nothing, avoids a
  // worktree per question, and is safe because its tool list has no writer.
  if (lane.kind === 'recon') return { path: root, isolated: false, measure: false };

  // A repair lane is the one writer that must NOT be isolated: the failure it
  // is repairing exists only in the integrated combination of lanes, which no
  // single lane's checkout contains. It works on the integrated primary tree,
  // which is safe because that tree was clean before integration and every
  // change is reversible with git checkout.
  if (lane.workspace === 'primary') return { path: root, isolated: false, measure: true };

  const target = path.join(laneDir(root, mission.missionId, lane.id), 'worktree');
  if (existsSync(target)) return { path: target, isolated: true };
  mkdirSync(path.dirname(target), { recursive: true });
  const head = mission.baselineHead ?? git(root, ['rev-parse', 'HEAD']).stdout.trim();
  const result = git(root, ['worktree', 'add', '--detach', target, head]);
  if (result.status !== 0) throw new Error(`git worktree add failed for lane ${lane.id}: ${result.stderr.trim()}`);
  return { path: target, isolated: true, measure: true };
}

/** What a lane changed, measured against its own clean starting checkout. */
export function laneChangedPaths(workspace) {
  const status = git(workspace, ['status', '--short', '--untracked-files=all']).stdout;
  return [...parseGitStatus(status)].filter((target) => !target.endsWith('/')).sort();
}

/**
 * A content fingerprint of every dirty path in a tree.
 *
 * An isolated lane starts from a clean checkout, so `git status` alone is an
 * exact record of what it did. A repair lane does not: it works on the primary
 * tree, which legitimately carries unrelated uncommitted work, and asking git
 * for the dirty set there answers "what is dirty" when the question is "what did
 * THIS lane change". That is how a repair got blamed for six files it never
 * opened. Comparing fingerprints before and after answers the real question.
 */
export function snapshotTree(root) {
  const snapshot = new Map();
  const dirty = [...parseGitStatus(git(root, ['status', '--short', '--untracked-files=all']).stdout)].filter(
    (target) => !target.endsWith('/'),
  );
  for (const file of dirty) {
    const full = path.join(root, file);
    snapshot.set(file, existsSync(full) ? sha256(readFileSync(full)) : null);
  }
  return snapshot;
}

/** Paths whose content differs from the snapshot: this lane's own delta. */
export function changedSince(root, snapshot) {
  const now = snapshotTree(root);
  const changed = [];
  for (const [file, digest] of now) {
    if (!snapshot.has(file) || snapshot.get(file) !== digest) changed.push(file);
  }
  // A path that was dirty before and is clean now was reverted by this lane,
  // which is just as much its doing as an edit.
  for (const file of snapshot.keys()) if (!now.has(file)) changed.push(file);
  return [...new Set(changed)].sort();
}

export function outOfScope(changedPaths, ownedPaths) {
  const owned = ownedPaths.map((entry) => entry.split('\\').join('/'));
  return changedPaths.filter((target) => !owned.some((prefix) => target === prefix || target.startsWith(prefix))).sort();
}

// -------------------------------------------------------------------- prompts

export function composeLanePrompt(root, mission, lane) {
  const briefing = briefingFor(root, mission, lane);
  const isRecon = lane.kind === 'recon';

  return [
    `You are one lane of a parallel LandOS development mission. Other lanes are running RIGHT NOW alongside you.`,
    '',
    `MISSION REQUEST (what the operator asked for):`,
    mission.request,
    '',
    `OPERATOR OUTCOME (what must be true when the whole mission is done):`,
    mission.operatorOutcome,
    '',
    // An authored mission carries the criteria acceptance is decided on. A lane
    // that cannot see them builds to the brief and misses the point of it.
    mission.acceptanceCriteria?.length
      ? `ACCEPTANCE CRITERIA for the whole mission:\n${mission.acceptanceCriteria.map((entry) => `  - ${entry}`).join('\n')}\n`
      : '',
    `YOUR LANE: ${lane.id} — ${lane.title}`,
    lane.brief,
    '',
    briefing ? `${briefing}\n` : '',
    isRecon
      ? [
          'YOU ARE A READ-ONLY RECONNAISSANCE LANE. You have no write tools. Do not attempt to edit anything.',
          'Your entire output is what you learned. Report it as DISCOVERY lines, one per finding:',
          '',
          '  DISCOVERY: <kind> <subject> — <one line finding>',
          '',
          'kind is one of file, symbol, test, route, config, shared.',
          'Example: DISCOVERY: file src/landos/comps.ts — owns the comp cap calculation in selectComps()',
          'Example: DISCOVERY: test src/landos/comps.test.ts — covers cap behaviour, 4 cases',
          '',
          'Be specific and compact. Name exact files, exact exported symbols, exact line ranges where useful.',
          'Later lanes will act on your findings WITHOUT rereading these files, so precision matters more than volume.',
        ].join('\n')
      : [
          'YOU MAY ONLY EDIT THESE PATHS:',
          ...lane.ownedPaths.map((entry) => `  ${entry}`),
          '',
          'Another lane owns every other path and is editing it concurrently. Writing outside your paths will be',
          'rejected at integration and your work will be discarded. If your lane genuinely cannot be completed',
          'inside these paths, stop and say so rather than reaching outside them.',
          '',
          'You are working in an isolated checkout of the repository. Read what you need, make the change, and stop.',
          'Do not run tests or builds: the harness runs them itself and will hand you exact failures if any appear.',
          '',
          'Report anything a later lane would otherwise have to rediscover, as DISCOVERY lines:',
          '  DISCOVERY: <kind> <subject> — <one line finding>',
        ].join('\n'),
    '',
    'When you are finished, end your final message with exactly one of:',
    '  ATTEMPT_COMPLETE   — you did the work this lane asked for',
    '  ATTEMPT_BLOCKED    — you could not, and you have explained precisely why',
  ]
    .filter((part) => part !== '')
    .join('\n');
}

export function composeRepairPrompt(root, mission, lane, diagnosis) {
  return [
    'You are a targeted REPAIR lane in a parallel LandOS development mission.',
    'A focused check has already failed and the harness has already diagnosed it exactly.',
    'Do not rediscover this failure. Repair it.',
    '',
    `MISSION REQUEST:`,
    mission.request,
    '',
    'EXACT FAILURE, as measured by the harness:',
    `  check:       ${diagnosis.checkId}`,
    diagnosis.command ? `  command:     ${diagnosis.command}` : '',
    `  exit code:   ${diagnosis.exitCode}`,
    diagnosis.requirement ? `  requirement: ${diagnosis.requirement}` : '',
    '',
    formatDiagnosis(diagnosis),
    '',
    diagnosis.newFailures?.length
      ? `These ${diagnosis.newFailures.length} failure(s) are NEW in this mission and are the ones to fix.`
      : 'No failure was flagged as new against the baseline; treat every failure above as in scope.',
    diagnosis.failures?.some((failure) => failure.preExisting)
      ? 'Failures marked [pre-existing on baseline] were already red before this mission. Do NOT "fix" those.'
      : '',
    '',
    'RAW OUTPUT TAIL (context only, the structured facts above are authoritative):',
    diagnosis.rawTail,
    '',
    'YOU MAY ONLY EDIT THESE PATHS:',
    ...lane.ownedPaths.map((entry) => `  ${entry}`),
    '',
    'Make the smallest change that makes the failing check pass without weakening it.',
    'Never delete, skip, or weaken a test to make it pass. Repair the code it is testing.',
    '',
    'End your final message with ATTEMPT_COMPLETE or ATTEMPT_BLOCKED.',
  ]
    .filter((part) => part !== '')
    .join('\n');
}

// ----------------------------------------------------------------- lane run

export async function runLane(root, mission, lane, { report, timeoutMs = DEFAULT_LANE_TIMEOUT_MS, promptText } = {}) {
  const directory = laneDir(root, mission.missionId, lane.id);
  mkdirSync(directory, { recursive: true });
  const workspace = prepareLaneWorkspace(root, mission, lane);
  // Only a shared (non-isolated) workspace needs a before-picture; an isolated
  // checkout is clean by construction, so its git status IS the delta.
  const before = workspace.measure && !workspace.isolated ? snapshotTree(workspace.path) : null;
  const builder = getBuilder(lane.builderId ?? 'cc');
  const prompt = promptText ?? composeLanePrompt(root, mission, lane);
  writeFileSync(path.join(directory, 'prompt.md'), prompt, 'utf8');

  lane.status = 'running';
  // Record the builder that actually ran, not the one the plan happened to
  // name. A plan usually leaves builderId unset and takes the default, and a
  // report that cannot attribute a lane to a model cannot answer "which model
  // is good at what", which is the whole point of recording it.
  lane.builderId = builder.id;
  lane.startedAt = new Date().toISOString();
  lane.worktree = workspace.isolated ? path.relative(root, workspace.path) : null;
  saveMission(root, mission);
  report?.('lane.start', {
    message: `lane ${lane.id} started (${lane.kind}, builder ${builder.id}${workspace.isolated ? ', isolated worktree' : ', read-only on primary'})`,
    laneId: lane.id,
  });

  const launch = await launchBuilderAsync(builder, {
    cwd: workspace.path,
    promptText: prompt,
    attemptDir: directory,
    tools: lane.tools ?? (lane.kind === 'recon' ? CC_READONLY_TOOLS : undefined),
    timeoutMs,
  });

  writeFileSync(path.join(directory, 'stdout.txt'), launch.stdout, 'utf8');
  writeFileSync(path.join(directory, 'stderr.txt'), launch.stderr, 'utf8');

  const report_text = launch.finalMessage ?? launch.stdout;
  const discoveries = harvestDiscoveries(root, mission.missionId, lane.id, report_text);

  const changed = workspace.measure
    ? before
      ? changedSince(workspace.path, before)
      : laneChangedPaths(workspace.path)
    : [];
  const strays = workspace.measure ? outOfScope(changed, lane.ownedPaths) : [];

  lane.finishedAt = new Date().toISOString();
  lane.durationMs = launch.durationMs;
  lane.exitCode = launch.exitCode;
  lane.claim = launch.claim;
  lane.error = launch.error;
  lane.changedPaths = changed;
  lane.outOfScopePaths = strays;
  lane.discoveryCount = discoveries.length;
  // A recon lane that produced no discovery taught nobody anything, which is a
  // failure of the lane even though the process exited cleanly.
  lane.status =
    launch.launched && !strays.length && (lane.kind !== 'recon' || discoveries.length > 0) ? 'complete' : 'failed';
  saveMission(root, mission);

  report?.('lane.finish', {
    message:
      `lane ${lane.id} ${lane.status} in ${Math.round(launch.durationMs / 1000)}s ` +
      `(claim ${launch.claim}, ${changed.length} file(s) changed, ${discoveries.length} discovery(ies))` +
      (strays.length ? ` OUT OF SCOPE: ${strays.join(', ')}` : ''),
    laneId: lane.id,
    durationMs: launch.durationMs,
  });

  return lane;
}

/**
 * Run every lane, launching all currently-ready lanes concurrently. Returns the
 * peak number of lanes in flight at once, which is the honest measure of
 * whether the plan was actually parallel.
 */
export async function runLanes(root, mission, { report, timeoutMs } = {}) {
  let peakConcurrency = 0;
  let waves = 0;

  for (;;) {
    const ready = readyLanes(mission);
    if (!ready.length) break;
    waves += 1;
    peakConcurrency = Math.max(peakConcurrency, ready.length);
    report?.('wave.start', {
      message: `wave ${waves}: launching ${ready.length} lane(s) concurrently — ${ready.map((lane) => lane.id).join(', ')}`,
      lanes: ready.map((lane) => lane.id),
      concurrency: ready.length,
    });

    await Promise.all(ready.map((lane) => runLane(root, mission, lane, { report, timeoutMs })));

    // A failed lane can never satisfy a dependency, so anything waiting on it is
    // unreachable. Marking it now stops the scheduler spinning and tells the
    // operator exactly which work did not happen and why.
    const failed = new Set(mission.lanes.filter((lane) => lane.status === 'failed').map((lane) => lane.id));
    if (failed.size) {
      for (const lane of mission.lanes) {
        if (lane.status !== 'pending') continue;
        const blockedBy = (lane.dependsOn ?? []).filter((dependency) => failed.has(dependency));
        if (blockedBy.length) {
          lane.status = 'blocked';
          lane.error = `blocked by failed lane(s): ${blockedBy.join(', ')}`;
        }
      }
      saveMission(root, mission);
    }
  }

  return { peakConcurrency, waves };
}

// ---------------------------------------------------------------- integration

/**
 * Collect each write lane's work as a patch and apply it to the primary tree.
 *
 * The primary is expected clean. That is the whole simplification clean main
 * bought: there is no dirty state to preserve, so integration is a plain patch
 * application and is trivially reversible with `git checkout`.
 */
export function integrate(root, mission, { report } = {}) {
  // Clean main is the normal starting point, but "totally clean" is the wrong
  // guard: it would refuse a tree whose only dirty paths are unrelated work the
  // contract requires be preserved. The property that actually matters is that
  // nothing this integration patches is already modified, because that is the
  // only case where applying a lane patch could destroy someone else's edit.
  const primaryDirty = new Set(parseGitStatus(git(root, ['status', '--short', '--untracked-files=all']).stdout));
  const incoming = mission.lanes
    .filter((lane) => lane.kind !== 'recon' && lane.status === 'complete')
    .flatMap((lane) => lane.changedPaths);
  const collisions = [...new Set(incoming.filter((target) => primaryDirty.has(target)))].sort();
  if (collisions.length) {
    return {
      integrated: false,
      reason:
        `${collisions.length} file(s) this mission changed are already dirty in the primary worktree, so applying the ` +
        `lane patches would overwrite uncommitted work: ${collisions.join(', ')}. Commit or revert those first.`,
      lanes: [],
      files: [],
    };
  }

  const results = [];
  const applied = [];
  for (const lane of mission.lanes.filter((entry) => entry.kind !== 'recon' && entry.status === 'complete')) {
    if (!lane.changedPaths.length) {
      results.push({ laneId: lane.id, applied: false, reason: 'lane changed nothing', files: [] });
      continue;
    }
    const workspace = path.resolve(root, lane.worktree);
    // Staging inside the disposable lane worktree is what makes new files show
    // up in the diff at all; the worktree is thrown away afterwards.
    git(workspace, ['add', '-A']);
    const diff = git(workspace, ['diff', '--cached', '--binary']).stdout;
    if (!diff.trim()) {
      results.push({ laneId: lane.id, applied: false, reason: 'empty diff', files: [] });
      continue;
    }
    const patchFile = path.join(laneDir(root, mission.missionId, lane.id), 'lane.patch');
    writeFileSync(patchFile, diff, 'utf8');

    const apply = git(root, ['apply', '--3way', '--whitespace=nowarn', patchFile]);
    if (apply.status !== 0) {
      results.push({ laneId: lane.id, applied: false, reason: `patch did not apply: ${apply.stderr.trim()}`, files: lane.changedPaths });
      report?.('integration.conflict', { message: `integration CONFLICT on lane ${lane.id}: ${apply.stderr.trim()}`, laneId: lane.id });
      continue;
    }
    applied.push(...lane.changedPaths);
    results.push({ laneId: lane.id, applied: true, reason: null, files: lane.changedPaths });
    report?.('integration.lane', { message: `integrated lane ${lane.id}: ${lane.changedPaths.length} file(s)`, laneId: lane.id });
  }

  const outcome = {
    integrated: results.every((entry) => entry.applied || entry.reason === 'lane changed nothing'),
    reason: null,
    lanes: results,
    files: [...new Set(applied)].sort(),
  };
  mission.integration = outcome;
  saveMission(root, mission);
  return outcome;
}

/**
 * Undo an integration, touching only the files the integration itself wrote.
 * Never `checkout -- .` or a broad clean: unrelated uncommitted work must
 * survive a failed mission untouched.
 */
export function revertIntegration(root, files) {
  if (!files?.length) return;
  const tracked = [];
  const untracked = [];
  for (const file of files) {
    const known = git(root, ['ls-files', '--error-unmatch', '--', file]).status === 0;
    if (known) tracked.push(file);
    else if (existsSync(path.join(root, file))) untracked.push(file);
  }
  if (tracked.length) git(root, ['checkout', '--', ...tracked]);
  for (const file of untracked) rmSync(path.join(root, file), { force: true });
}

// --------------------------------------------------------------------- checks

/**
 * Run a set of command checks. Independent checks run concurrently: nothing is
 * gained by waiting for typecheck before starting the focused unit tests.
 */
export async function runCommandChecks(root, checks, { report, label = 'check' } = {}) {
  if (!checks?.length) return { pass: true, results: [] };
  report?.(`${label}.start`, { message: `${label}: running ${checks.length} check(s) concurrently` });

  const results = await Promise.all(
    checks.map(async (check) => {
      const outcome = await execAsync(check.command, { cwd: root, timeoutMs: check.timeoutMs });
      const expected = check.expectExitCode ?? 0;
      const pass = outcome.status === expected;
      return {
        id: check.id,
        kind: 'command',
        requirement: check.requirement ?? check.command,
        command: check.command,
        exitCode: outcome.status,
        durationMs: outcome.durationMs,
        pass,
        detail: pass ? `exit ${outcome.status}` : `exit ${outcome.status}${outcome.timedOut ? ' (timed out)' : ''}`,
        output: pass ? '' : `${outcome.stdout}\n${outcome.stderr}`,
      };
    }),
  );

  for (const result of results) {
    report?.(`${label}.result`, {
      message: `  [${result.pass ? 'pass' : 'FAIL'}] ${result.id} (${Math.round(result.durationMs / 1000)}s): ${result.detail}`,
      checkId: result.id,
      pass: result.pass,
    });
  }
  return { pass: results.every((result) => result.pass), results };
}

/** Turn the first failing check into an exact, self-contained repair brief. */
export function diagnoseFirstFailure(checkResults, { baselineFailures = [] } = {}) {
  const failed = checkResults.find((result) => !result.pass);
  if (!failed) return null;
  return diagnoseFailure(failed, failed.output, { baselineFailures });
}

export { git };
