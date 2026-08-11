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
  // A mission may be resumed by a different local account (for example the
  // Codex desktop sandbox) than the account that created its worktrees. Trust
  // only the exact cwd for this invocation; never mutate global git config.
  const result = spawnSync('git', ['-c', `safe.directory=${path.resolve(cwd)}`, ...args], { cwd, encoding: 'utf8', maxBuffer });
  const status = result.status ?? null;
  return {
    // Three outcomes, never two. A git read that FAILED and a git read that
    // legitimately returned nothing produce the same empty stdout, and every
    // caller here used to collapse them into "nothing changed". That is how a
    // sprint's lanes were reported as "0 file(s) changed" and dropped as
    // "empty diff" while their worktrees held thousands of lines of real work.
    // `ok` is the distinction; callers must consult it before trusting stdout.
    ok: status === 0 && !result.error,
    status,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? result.error?.message ?? ''),
  };
}

/** A git read that could not be performed. Never silently degrades to "empty". */
export class GitReadError extends Error {
  constructor(what, cwd, result) {
    super(`${what} failed in ${cwd} (exit ${result.status}): ${result.stderr.trim() || 'no stderr'}`);
    this.name = 'GitReadError';
    this.what = what;
    this.cwd = cwd;
    this.status = result.status;
    this.stderr = result.stderr;
  }
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
  // A worktree that already exists is a RESUMED lane, and it must still be
  // measured. Omitting `measure` here made runLane take its `: []` branch, so a
  // resumed lane reported zero changed paths and zero out-of-scope paths no
  // matter what it did — the measurement was not wrong, it never ran.
  if (existsSync(target)) return { path: target, isolated: true, measure: true, reused: true };
  mkdirSync(path.dirname(target), { recursive: true });
  const head = mission.baselineHead ?? git(root, ['rev-parse', 'HEAD']).stdout.trim();
  const result = git(root, ['worktree', 'add', '--detach', target, head]);
  if (result.status !== 0) throw new Error(`git worktree add failed for lane ${lane.id}: ${result.stderr.trim()}`);
  return { path: target, isolated: true, measure: true };
}

/**
 * What a lane changed, measured against its own clean starting checkout.
 *
 * Throws rather than returning [] when git cannot be read. An unreadable
 * worktree is not an empty one, and the caller must be forced to say which it
 * saw: reporting "0 file(s) changed" for work the harness merely failed to
 * measure is worse than reporting nothing at all, because it reads as a fact.
 */
export function laneChangedPaths(workspace) {
  const result = git(workspace, ['status', '--short', '--untracked-files=all']);
  if (!result.ok) throw new GitReadError('git status', workspace, result);
  return [...parseGitStatus(result.stdout)].filter((target) => !target.endsWith('/')).sort();
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
  const result = git(root, ['status', '--short', '--untracked-files=all']);
  if (!result.ok) throw new GitReadError('git status', root, result);
  const dirty = [...parseGitStatus(result.stdout)].filter(
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
  // A failed before-picture must not take the whole mission down, but it must
  // also not silently become "no baseline". Falling back to null here would
  // make the lane measure the whole tree's dirt as its own; recording the
  // failure instead lets the delta read below report UNREADABLE honestly.
  let before = null;
  let beforeError = null;
  if (workspace.measure && !workspace.isolated) {
    try {
      before = snapshotTree(workspace.path);
    } catch (error) {
      if (!(error instanceof GitReadError)) throw error;
      beforeError = error;
    }
  }
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

  // Measuring the lane's delta can itself fail. When it does, the honest record
  // is "unknown", never []. `changedPaths: null` is what downstream integration
  // reads to know it must re-derive the delta from the worktree instead of
  // concluding the lane changed nothing.
  let changed = [];
  let readError = beforeError;
  if (workspace.measure && !readError) {
    try {
      changed = before ? changedSince(workspace.path, before) : laneChangedPaths(workspace.path);
    } catch (error) {
      if (!(error instanceof GitReadError)) throw error;
      readError = error;
    }
  }
  const strays = workspace.measure && !readError ? outOfScope(changed, lane.ownedPaths) : [];

  lane.finishedAt = new Date().toISOString();
  lane.durationMs = launch.durationMs;
  lane.exitCode = launch.exitCode;
  lane.claim = launch.claim;
  lane.error = launch.error;
  lane.changedPaths = readError ? null : changed;
  lane.changedPathsRead = workspace.measure ? (readError ? 'failed' : 'ok') : 'not-measured';
  lane.changedPathsError = readError
    ? { what: readError.what, status: readError.status, stderr: readError.stderr.slice(0, 4000) }
    : null;
  lane.workspaceReused = workspace.reused === true;
  lane.outOfScopePaths = strays;
  lane.discoveryCount = discoveries.length;
  // A recon lane that produced no discovery taught nobody anything, which is a
  // failure of the lane even though the process exited cleanly.
  // A lane whose delta could not be read is never "complete": its scope cannot
  // be checked, so promoting it would integrate unreviewed paths. It is also
  // never "changed nothing" — integration re-derives it from the worktree.
  lane.timedOut = launch.timedOut === true;
  lane.status =
    launch.launched && !readError && !strays.length && (lane.kind !== 'recon' || discoveries.length > 0)
      ? 'complete'
      : 'failed';
  if (readError && !lane.error) lane.error = `changed-path read failed: ${readError.message}`;
  saveMission(root, mission);

  const deltaText = readError
    ? `changed paths UNREADABLE (${readError.what} exit ${readError.status})`
    : `${changed.length} file(s) changed`;
  report?.('lane.finish', {
    message:
      `lane ${lane.id} ${lane.status} in ${Math.round(launch.durationMs / 1000)}s ` +
      `(claim ${launch.claim}${launch.timedOut ? ', TIMED OUT' : ''}, ${deltaText}, ${discoveries.length} discovery(ies))` +
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
  const primaryStatus = git(root, ['status', '--short', '--untracked-files=all']);
  if (!primaryStatus.ok) {
    return {
      integrated: false,
      reason:
        `cannot read the primary worktree's status, so it is unknown whether applying lane patches would overwrite ` +
        `uncommitted work (git status exit ${primaryStatus.status}): ${primaryStatus.stderr.trim() || 'no stderr'}`,
      lanes: [],
      files: [],
    };
  }
  const primaryDirty = new Set(parseGitStatus(primaryStatus.stdout));
  // A mission can be resumed after integration when a focused, validation or
  // browser check fails. Those patches are already present on the primary tree
  // and are intentionally dirty. Replaying them would collide with the
  // mission's own work, so retain the prior integration record and apply only
  // lanes that have not yet been integrated.
  const priorApplied = new Map(
    (mission.integration?.lanes ?? [])
      .filter((entry) => entry.applied)
      .map((entry) => [entry.laneId, entry]),
  );
  const primaryWorkspaceApplied = mission.lanes
    .filter((lane) => lane.kind !== 'recon' && lane.status === 'complete' && lane.workspace === 'primary')
    .map((lane) => ({
      laneId: lane.id,
      applied: true,
      reason: null,
      files: lane.changedPaths ?? [],
      alreadyApplied: true,
    }));
  const candidates = mission.lanes.filter(
    (lane) => lane.kind !== 'recon' && lane.status === 'complete' && lane.workspace !== 'primary' && !priorApplied.has(lane.id),
  );
  const incoming = candidates
    .flatMap((lane) => lane.changedPaths ?? []);
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

  const results = [
    ...[...priorApplied.values()].map((entry) => ({ ...entry, alreadyApplied: true })),
    ...primaryWorkspaceApplied.filter((entry) => !priorApplied.has(entry.laneId)),
  ];
  const applied = results.flatMap((entry) => entry.files ?? []);
  for (const lane of candidates) {
    // `changedPaths: null` means the measurement failed, NOT that the lane was
    // idle. Only an empty array is evidence of an idle lane.
    if (Array.isArray(lane.changedPaths) && !lane.changedPaths.length) {
      results.push({ laneId: lane.id, applied: false, reason: 'lane changed nothing', files: [] });
      continue;
    }
    const workspace = path.resolve(root, lane.worktree);
    // Staging inside the disposable lane worktree is what makes new files show
    // up in the diff at all; the worktree is thrown away afterwards.
    //
    // Both of these reads used to be trusted blindly. `git add -A`'s result was
    // discarded outright, and a failed `git diff` returns the same empty stdout
    // as a clean tree — so any failure here was reported as "empty diff" and the
    // lane's work was silently thrown away. Check both.
    const staged = git(workspace, ['add', '-A']);
    if (!staged.ok) {
      const detail = `git add -A failed (exit ${staged.status}): ${staged.stderr.trim() || 'no stderr'}`;
      results.push({
        laneId: lane.id, applied: false, reason: `stage failed — ${detail}`, files: [],
        readFailure: true, status: staged.status, stderr: staged.stderr.slice(0, 4000),
      });
      report?.('integration.readfail', { message: `integration READ FAILURE on lane ${lane.id}: ${detail}`, laneId: lane.id });
      continue;
    }
    const diffResult = git(workspace, ['diff', '--cached', '--binary']);
    if (!diffResult.ok) {
      const detail = `git diff --cached failed (exit ${diffResult.status}): ${diffResult.stderr.trim() || 'no stderr'}`;
      results.push({
        laneId: lane.id, applied: false, reason: `diff read failed — ${detail}`, files: [],
        readFailure: true, status: diffResult.status, stderr: diffResult.stderr.slice(0, 4000),
      });
      report?.('integration.readfail', { message: `integration READ FAILURE on lane ${lane.id}: ${detail}`, laneId: lane.id });
      continue;
    }
    const diff = diffResult.stdout;
    if (!diff.trim()) {
      // Genuinely empty: the read succeeded and there was nothing staged.
      results.push({ laneId: lane.id, applied: false, reason: 'empty diff', files: [] });
      continue;
    }
    // The staged diff is the authority on which files this lane touched. When
    // the lane's own measurement failed, this recovers the file list rather
    // than reporting the lane as having changed nothing.
    const named = git(workspace, ['diff', '--cached', '--name-only']);
    const laneFiles = named.ok
      ? named.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).sort()
      : (lane.changedPaths ?? []);
    if (!Array.isArray(lane.changedPaths) || !lane.changedPaths.length) {
      lane.changedPaths = laneFiles;
      lane.changedPathsRecoveredFrom = 'integration diff';
    }

    const patchFile = path.join(laneDir(root, mission.missionId, lane.id), 'lane.patch');
    writeFileSync(patchFile, diff, 'utf8');

    const apply = git(root, ['apply', '--3way', '--whitespace=nowarn', patchFile]);
    if (apply.status !== 0) {
      results.push({ laneId: lane.id, applied: false, reason: `patch did not apply: ${apply.stderr.trim()}`, files: laneFiles });
      report?.('integration.conflict', { message: `integration CONFLICT on lane ${lane.id}: ${apply.stderr.trim()}`, laneId: lane.id });
      continue;
    }
    applied.push(...laneFiles);
    results.push({ laneId: lane.id, applied: true, reason: null, files: laneFiles });
    report?.('integration.lane', { message: `integrated lane ${lane.id}: ${laneFiles.length} file(s)`, laneId: lane.id });
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
