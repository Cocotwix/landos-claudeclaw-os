#!/usr/bin/env node
// LandOS parallel-first development harness — operator CLI, and the one front
// door every coding agent uses.
//
//   npm run landos:build -- "make the comps section easier to read"
//   npm run landos:build -- --file sprint-spec.md          (a pasted specification)
//   npm run landos:build -- "..." --author-only            (stop at a valid mission)
//   npm run landos:build -- <plan.json> [--max-repairs 2] [--no-validate]
//   npm run landos:build -- status [missionId]
//   npm run landos:build -- show <missionId>
//   npm run landos:build -- cleanup <missionId> | --all
//   npm run landos:build -- accept <missionId> --message "..."
//
// The first two forms are the point: Claude Code, Codex and a bare terminal all
// reach the same authoring and the same executor. There is no provider-specific
// planning path and no provider-specific mission format.
//
// The phase order is the point:
//
//   preflight -> parallel lanes -> integrate -> FOCUSED checks
//     -> targeted repair (exact diagnostics, no blind rebuild)
//     -> proportional validation -> localhost/browser verification
//     -> machine-detectable terminal state
//
// Focused checks come before certification so a candidate that is already wrong
// is disproved in seconds instead of after a full suite. Validation only ever
// runs against a candidate that survived them.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { authorMission } from './author.mjs';
import { probeBuilders, BUILDERS } from './builders.mjs';
import { diagnoseFailure, formatDiagnosis, tail } from './diagnose.mjs';
import {
  AUTHORING_LANE_ID,
  createMission,
  createReporter,
  criticalPathLength,
  laneById,
  listMissions,
  loadDiscoveries,
  loadMission,
  missionDir,
  readEvents,
  recordDiscovery,
  saveMission,
  setTerminalState,
  validatePlan,
} from './mission.mjs';
import {
  composeRepairPrompt,
  diagnoseFirstFailure,
  execAsync,
  git,
  integrate,
  runCommandChecks,
  runLane,
  runLanes,
} from './mission-exec.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function flag(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

// ------------------------------------------------------------------ preflight

async function preflight(report) {
  const dirty = git(ROOT, ['status', '--short', '--untracked-files=all']).stdout
    .split(/\r?\n/)
    .filter((line) => line.trim());
  const head = git(ROOT, ['rev-parse', 'HEAD']).stdout.trim();
  const branch = git(ROOT, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();

  report('preflight', {
    message: `preflight: branch ${branch} at ${head.slice(0, 7)}, ${dirty.length} dirty path(s)`,
    dirty: dirty.length,
    head,
  });

  const readiness = probeBuilders(BUILDERS);
  report('preflight.builders', {
    message: `preflight: builders ready — ${readiness.available.join(', ') || 'NONE'}${
      readiness.unavailable.length ? ` (unavailable: ${readiness.unavailable.join(', ')})` : ''
    }`,
  });
  return { dirty, head, branch, readiness };
}

// A focused check that is already red before any lane runs is not this
// mission's defect. Recording the baseline is what lets the repair brief say
// "this one is pre-existing, do not fix it".
async function captureBaseline(checks, report) {
  if (!checks?.length) return { failures: [], redChecks: [] };
  report('baseline', { message: `baseline: recording pre-existing failures for ${checks.length} focused check(s)` });
  const { results } = await runCommandChecks(ROOT, checks, { report: null, label: 'baseline' });
  const failures = [];
  const redChecks = [];
  for (const result of results) {
    if (result.pass) continue;
    const diagnosis = diagnoseFirstFailure([result]);
    const parsed = diagnosis?.failures ?? [];
    failures.push(...parsed);
    // "Red at baseline" and "red at baseline with parseable per-test failures"
    // are different facts, and conflating them is a real defect this harness
    // hit: a check whose COMMAND cannot execute (vitest aimed at a node:test
    // file) exits non-zero with no per-test detail, contributed nothing to
    // `failures`, and so read as a clean baseline. The identical failure after
    // integration then looked like the builder's, and consumed the entire
    // repair budget on code that was never broken. The check-level record below
    // is what makes the distinction survive.
    redChecks.push({
      id: result.id,
      command: result.command ?? null,
      exitCode: result.exitCode ?? null,
      parsedFailures: parsed.length,
      detail: parsed.length ? null : tail(result.output, 12),
      // The signature is what separates the two very different reasons a focused
      // check is red before any lane runs. A check written for behaviour this
      // mission is meant to CREATE is red now and green later, and its output
      // changes the moment a lane touches it: that one must still be repaired.
      // A check that cannot execute at all fails identically forever, no matter
      // what any builder writes: repairing that one is pure waste.
      signature: failureSignature(result.output),
    });
  }
  report('baseline.done', {
    message: redChecks.length
      ? `baseline: ${redChecks.length} check(s) ALREADY RED before any lane ran — ${redChecks
          .map((entry) =>
            entry.parsedFailures
              ? `${entry.id} (${entry.parsedFailures} pre-existing failure(s))`
              : `${entry.id} (exit ${entry.exitCode}, no per-test detail available)`,
          )
          .join('; ')}`
      : 'baseline: clean, 0 check(s) red before any lane ran',
  });
  return { failures, redChecks };
}

/**
 * A stable fingerprint of how a check failed, used only to ask one question:
 * did anything the lanes wrote change this failure at all? Volatile detail —
 * timings, paths, digits — is stripped, so "same failure" means the same shape,
 * not the same bytes.
 */
export function failureSignature(output) {
  return tail(output, 20)
    .replace(/\d+/g, '#')
    .replace(/[A-Za-z]:[\\/][^\s]+/g, 'PATH')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

/**
 * The first failing check this mission is actually answerable for.
 *
 * "Red at baseline" alone is NOT a reason to skip a repair. A focused check
 * written for behaviour the mission is meant to create is red at baseline by
 * design, and making it green is the entire job. What is never worth the budget
 * is a check that fails IDENTICALLY to baseline — nothing any lane wrote moved
 * it, which is the signature of a check that cannot execute rather than code
 * that is wrong. Only that case is treated as unrepairable, and a genuine
 * failure behind it is always preferred over both.
 */
function firstActionableFailure(results, { baselineFailures, baselineRed }) {
  const failed = results.filter((result) => !result.pass);
  if (!failed.length) return null;
  for (const result of failed) {
    const diagnosis = diagnoseFailure(result, result.output, { baselineFailures });
    if (!unrepairable(result, diagnosis, baselineRed)) return { diagnosis, preExistingOnly: false };
  }
  return { diagnosis: diagnoseFailure(failed[0], failed[0].output, { baselineFailures }), preExistingOnly: true };
}

function unrepairable(result, diagnosis, baselineRed) {
  const baseline = baselineRed.get(result.id);
  if (!baseline) return false;
  if (diagnosis.newFailures.length) return false;
  return failureSignature(result.output) === baseline.signature;
}

function preExistingReason(diagnosis, redChecks) {
  const entry = redChecks.find((record) => record.id === diagnosis.checkId);
  const evidence = entry?.parsedFailures
    ? `${entry.parsedFailures} failure(s) were already present at baseline`
    : `it exited ${entry?.exitCode} at baseline with no per-test detail`;
  return (
    `focused check "${diagnosis.checkId}" fails EXACTLY as it did before any lane ran, so nothing the builders ` +
    `wrote moved it and no repair was attempted or budget spent: ${evidence}. That is the signature of a check ` +
    `that cannot execute rather than code that is wrong. Fix the check itself, then rerun.` +
    (entry?.command ? ` Baseline command: ${entry.command}` : '')
  );
}

function indented(text) {
  return String(text)
    .split('\n')
    .map((line) => `        ${line}`)
    .join('\n');
}

/**
 * Launch one targeted repair from an exact diagnosis. Shared by the focused and
 * the validation phases so a late failure gets the same precise treatment as an
 * early one: the worker receives the assertion, never a bare check name.
 */
async function runTargetedRepair(mission, report, { diagnosis, integration, argv, attempt, maxRepairs, phase }) {
  const target = diagnosis.candidateFiles.length ? diagnosis.candidateFiles : integration.files;
  const repairNumber = mission.lanes.reduce((highest, lane) => {
    const match = /^repair-(\d+)$/.exec(lane.id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0) + 1;
  const repairLane = {
    id: `repair-${repairNumber}`,
    kind: 'repair',
    title: `repair ${diagnosis.checkId}`,
    brief: 'Repair the exact failure below.',
    dependsOn: [],
    // The repair works on the integrated primary tree, so it may touch the
    // files the failure actually named plus everything the mission changed.
    ownedPaths: [...new Set([...target, ...integration.files])],
    builderId: flag(argv, '--repair-builder', 'cc'),
    // Repairs run on the integrated primary tree: the failure only exists in
    // the combination of lanes, so an isolated per-lane checkout cannot see it.
    workspace: 'primary',
    status: 'pending',
    changedPaths: [],
    diagnosis,
  };
  mission.lanes.push(repairLane);
  mission.repairs.push({ attempt, checkId: diagnosis.checkId, phase, diagnosis });
  saveMission(ROOT, mission);

  report('repair.launch', {
    message:
      `targeted repair ${attempt}/${maxRepairs} launched from the ${phase} failure on ` +
      `${diagnosis.candidateFiles.join(', ') || 'the integrated files'} (repair worker receives the exact assertion, not a rerun)`,
  });

  const lane = laneById(mission, repairLane.id);
  await runLane(ROOT, mission, lane, { report, promptText: composeRepairPrompt(ROOT, mission, lane, diagnosis) });
  saveMission(ROOT, mission);
  return lane;
}

// ----------------------------------------------------------------------- run

async function runMission(planPath, argv) {
  return runPlan(JSON.parse(readFileSync(path.resolve(ROOT, planPath), 'utf8')), argv);
}

async function runPlan(plan, argv, { discoveries = [] } = {}) {
  const issues = validatePlan(plan);
  if (issues.length) {
    console.error(`Invalid mission plan:\n- ${issues.join('\n- ')}`);
    process.exitCode = 2;
    return;
  }

  const bootReport = createReporter(ROOT, { missionId: 'boot', createdAt: new Date().toISOString() }, {
    write: (line) => console.log(line),
  });
  const state = await preflight(bootReport);

  if (state.dirty.length && !argv.includes('--allow-dirty')) {
    console.error(
      `\nRefusing to start: the primary worktree has ${state.dirty.length} dirty path(s).\n` +
        'Clean main is the normal starting point for a sprint.\n' +
        'Commit or revert first, or pass --allow-dirty to proceed: unrelated dirty work is preserved, and\n' +
        'integration will still refuse if any file this mission changes is already modified.',
    );
    process.exitCode = 2;
    return;
  }
  if (!state.readiness.available.length) {
    console.error('\nRefusing to start: no builder CLI is callable on this machine.');
    process.exitCode = 2;
    return;
  }

  const mission = createMission(ROOT, { ...plan, baselineHead: state.head });
  const report = createReporter(ROOT, mission);

  // Everything authoring learned is seeded before any lane starts, so the build
  // lanes inherit it instead of paying for the same reconnaissance again.
  for (const entry of discoveries) {
    recordDiscovery(ROOT, mission.missionId, {
      laneId: AUTHORING_LANE_ID,
      kind: entry.kind,
      subject: entry.subject,
      note: entry.note,
      ref: entry.from ? `authoring/${entry.from}` : null,
    });
  }
  if (discoveries.length) {
    report('mission.seed', { message: `seeded ${discoveries.length} discovery(ies) from authoring; every lane inherits them` });
  }

  const writeLanes = mission.lanes.filter((lane) => lane.kind !== 'recon');
  report('mission.start', {
    message:
      `sprint started: ${mission.missionId}\n` +
      `        request: ${mission.request}\n` +
      `        graph: ${mission.lanes.length} lane(s) (${mission.lanes.length - writeLanes.length} recon, ${writeLanes.length} write), ` +
      `critical path ${criticalPathLength(mission.lanes)} deep`,
  });
  for (const lane of mission.lanes) {
    report('mission.lane', {
      message: `        lane ${lane.id} [${lane.kind}] builder=${lane.builderId ?? 'cc'} deps=[${(lane.dependsOn ?? []).join(', ') || 'none'}] owns=[${(lane.ownedPaths ?? []).join(', ') || 'read-only'}]`,
    });
  }

  return executeMission(mission, argv, report);
}

/**
 * Everything after the lane graph exists: baseline, lanes, integration, focused
 * checks, targeted repair, validation and localhost verification.
 *
 * Factored out of runPlan so a mission whose plan was already authored and
 * VALIDATED can be re-entered without paying for authoring again. Re-authoring
 * a 20k-character specification to rerun four blocked lanes is pure waste, and
 * the second authoring would not even produce the same plan.
 */
async function executeMission(mission, argv, report) {
  const maxRepairs = Number(flag(argv, '--max-repairs', '2'));
  const skipValidation = argv.includes('--no-validate');
  const skipBrowser = argv.includes('--no-browser');
  const writeLanes = mission.lanes.filter((lane) => lane.kind !== 'recon');

  const hasIntegratedWork = (mission.integration?.lanes ?? []).some((entry) => entry.applied);
  const canReuseBaseline = hasIntegratedWork && Array.isArray(mission.baselineRedChecks) && Array.isArray(mission.baselineFailures);
  const baseline = canReuseBaseline
    ? { failures: mission.baselineFailures, redChecks: mission.baselineRedChecks }
    : await captureBaseline(mission.focusedChecks, report);
  if (canReuseBaseline) {
    report('baseline.resume', {
      message: `baseline: retained the original pre-integration result (${baseline.redChecks.length} check(s) red)`,
    });
  }
  const baselineFailures = baseline.failures;
  const baselineRed = new Map(baseline.redChecks.map((entry) => [entry.id, entry]));
  mission.baselineFailures = baselineFailures;
  mission.baselineRedChecks = baseline.redChecks;
  saveMission(ROOT, mission);

  // ---- parallel lanes
  const { peakConcurrency, waves } = await runLanes(ROOT, mission, { report });
  report('lanes.done', {
    message: `all lanes settled: ${waves} wave(s), peak useful concurrency ${peakConcurrency}, ` +
      `${mission.lanes.filter((lane) => lane.status === 'complete').length}/${mission.lanes.length} complete`,
    peakConcurrency,
  });
  mission.peakConcurrency = peakConcurrency;
  mission.waves = waves;
  saveMission(ROOT, mission);

  const failedLanes = mission.lanes.filter((lane) => lane.status !== 'complete');
  if (failedLanes.length) {
    for (const lane of failedLanes) {
      report('lane.failed', { message: `  lane ${lane.id}: ${lane.status} — ${lane.error ?? `claim ${lane.claim}`}` });
    }
    if (!writeLanes.some((lane) => lane.status === 'complete')) {
      finish(mission, report, 'NEEDS_ATTENTION', 'no write lane completed; nothing to integrate');
      return;
    }
  }

  // ---- integration
  report('integration.start', { message: 'integrating lane work onto the clean primary tree' });
  const integration = integrate(ROOT, mission, { report });
  if (!integration.integrated) {
    const reason = integration.reason ?? integration.lanes.filter((entry) => !entry.applied).map((entry) => `${entry.laneId}: ${entry.reason}`).join('; ');
    finish(mission, report, 'NEEDS_ATTENTION', `integration failed — ${reason}`);
    return;
  }
  report('integration.done', { message: `integrated ${integration.files.length} file(s) from ${integration.lanes.filter((e) => e.applied).length} lane(s)` });

  // ---- focused checks, then targeted repair
  let focused = await runCommandChecks(ROOT, mission.focusedChecks, { report, label: 'focused' });
  mission.focusedResult = focused;
  saveMission(ROOT, mission);

  let repairs = 0;
  while (!focused.pass && repairs < maxRepairs) {
    const actionable = firstActionableFailure(focused.results, { baselineFailures, baselineRed });
    if (actionable.preExistingOnly) {
      finish(mission, report, 'NEEDS_ATTENTION', preExistingReason(actionable.diagnosis, baseline.redChecks));
      return;
    }
    const { diagnosis } = actionable;
    repairs += 1;
    report('repair.diagnose', { message: `FOCUSED FAIL — exact diagnosis:\n${indented(formatDiagnosis(diagnosis))}` });

    await runTargetedRepair(mission, report, {
      diagnosis,
      integration,
      argv,
      attempt: repairs,
      maxRepairs,
      phase: 'focused',
    });

    focused = await runCommandChecks(ROOT, mission.focusedChecks, { report, label: 'focused' });
    mission.focusedResult = focused;
    saveMission(ROOT, mission);
  }

  if (!focused.pass) {
    const actionable = firstActionableFailure(focused.results, { baselineFailures, baselineRed });
    if (actionable.preExistingOnly) {
      finish(mission, report, 'NEEDS_ATTENTION', preExistingReason(actionable.diagnosis, baseline.redChecks));
      return;
    }
    finish(
      mission,
      report,
      'FAIL',
      `focused checks still failing after ${repairs} repair(s): ${formatDiagnosis(actionable.diagnosis)}`,
    );
    return;
  }
  report('focused.pass', { message: `focused checks PASS${repairs ? ` after ${repairs} targeted repair(s)` : ''}` });

  // ---- proportional validation, only now that a viable candidate exists
  if (!skipValidation && mission.validationChecks.length) {
    let validation = await runCommandChecks(ROOT, mission.validationChecks, { report, label: 'validation' });
    mission.validationResult = validation;
    saveMission(ROOT, mission);

    // A validation failure is not automatically the end of the mission. It
    // carries an exact diagnosis exactly like a focused one, and the repair
    // budget is usually not spent. Terminating here threw away candidates that
    // were one targeted edit from correct — which is precisely what happened
    // when a lane rewrote an npm test script into something Node could not
    // resolve. The check is not weakened; it simply gets the same repair the
    // cheap checks already got, and must then pass on its own terms.
    while (!validation.pass && repairs < maxRepairs) {
      const actionable = firstActionableFailure(validation.results, { baselineFailures, baselineRed });
      if (actionable.preExistingOnly) {
        finish(mission, report, 'NEEDS_ATTENTION', preExistingReason(actionable.diagnosis, baseline.redChecks));
        return;
      }
      const { diagnosis } = actionable;
      repairs += 1;
      report('repair.diagnose', { message: `VALIDATION FAIL — exact diagnosis:\n${indented(formatDiagnosis(diagnosis))}` });

      await runTargetedRepair(mission, report, {
        diagnosis,
        integration,
        argv,
        attempt: repairs,
        maxRepairs,
        phase: 'validation',
      });

      // Cheap checks first. A validation repair must never buy final
      // certification by breaking something the focused checks already proved.
      focused = await runCommandChecks(ROOT, mission.focusedChecks, { report, label: 'focused' });
      mission.focusedResult = focused;
      saveMission(ROOT, mission);
      if (!focused.pass) {
        const regressed = firstActionableFailure(focused.results, { baselineFailures, baselineRed });
        finish(
          mission,
          report,
          'FAIL',
          `the validation repair regressed a focused check: ${formatDiagnosis(regressed.diagnosis)}`,
        );
        return;
      }

      validation = await runCommandChecks(ROOT, mission.validationChecks, { report, label: 'validation' });
      mission.validationResult = validation;
      saveMission(ROOT, mission);
    }

    if (!validation.pass) {
      const actionable = firstActionableFailure(validation.results, { baselineFailures, baselineRed });
      finish(
        mission,
        report,
        'FAIL',
        `validation still failing after ${repairs} repair(s): ${formatDiagnosis(actionable.diagnosis)}`,
      );
      return;
    }
    report('validation.pass', { message: `validation PASS${repairs ? ` after ${repairs} targeted repair(s)` : ''}` });
  } else {
    report('validation.skip', { message: 'validation skipped' });
  }

  // ---- the real application
  // The summary must name only the gates that actually ran. A mission with no
  // browser check has not verified localhost, and must never say it did.
  const proven = ['focused checks'];
  if (!skipValidation && mission.validationChecks.length) proven.push('validation');

  if (!skipBrowser && mission.browserCheck) {
    const browser = await runBrowserCheck(mission, report);
    mission.browserResult = browser;
    saveMission(ROOT, mission);
    if (!browser.pass) {
      finish(mission, report, 'NEEDS_ATTENTION', `localhost verification failed: ${browser.detail}`);
      return;
    }
    proven.push('localhost verification');
  } else {
    report('browser.none', {
      message: mission.browserCheck
        ? 'localhost verification SKIPPED by --no-browser: this candidate is not operator-verified'
        : 'no browserCheck in this plan: nothing operator-facing was verified in the running application',
    });
  }

  finish(mission, report, 'PASS', `${proven.join(' and ')} passed`);
}

// The operator-facing finish line: the running application, not a green suite.
async function runBrowserCheck(mission, report) {
  const check = mission.browserCheck;
  report('browser.start', { message: 'restarting the managed runtime and verifying the real localhost workflow' });

  for (const command of check.commands ?? []) {
    const outcome = await execAsync(command, { cwd: ROOT, timeoutMs: check.timeoutMs ?? 5 * 60 * 1000 });
    report('browser.command', {
      message: `  [${outcome.status === 0 ? 'ok' : 'FAIL'}] ${command} (exit ${outcome.status})`,
    });
    if (outcome.status !== 0) {
      return { pass: false, detail: `${command} exited ${outcome.status}: ${(outcome.stderr || outcome.stdout).slice(-600)}` };
    }
  }

  if (check.url) {
    const outcome = await execAsync(
      `curl -s -o - -w "\\n__STATUS__%{http_code}" ${JSON.stringify(check.url)}`,
      { cwd: ROOT, timeoutMs: 60_000 },
    );
    const status = /__STATUS__(\d{3})/.exec(outcome.stdout)?.[1];
    if (status !== '200') {
      return { pass: false, detail: `${check.url} returned HTTP ${status ?? 'no response'}` };
    }
    report('browser.http', { message: `  [ok] ${check.url} -> HTTP 200` });

    for (const expected of check.expectText ?? []) {
      if (!outcome.stdout.includes(expected)) {
        return { pass: false, detail: `${check.url} did not contain expected text ${JSON.stringify(expected)}` };
      }
      report('browser.text', { message: `  [ok] page contains ${JSON.stringify(expected)}` });
    }
  }
  return { pass: true, detail: 'localhost verified' };
}

function finish(mission, report, state, reason) {
  setTerminalState(ROOT, mission, state, reason);
  report('mission.end', { message: `TERMINAL STATE: ${state} — ${reason}`, terminalState: state });
  writeFileSync(
    path.join(missionDir(ROOT, mission.missionId), 'RESULT'),
    `${state}\n${reason}\n`,
    'utf8',
  );
  console.log(`\n=== ${state} ===`);
  console.log(reason);
  console.log(`mission state: ${path.relative(ROOT, missionDir(ROOT, mission.missionId))}`);
  process.exitCode = state === 'PASS' ? 0 : state === 'FAIL' ? 1 : 3;
}

// -------------------------------------------------------------------- reports

function printStatus(missionId) {
  if (!missionId) {
    const missions = listMissions(ROOT);
    if (!missions.length) return console.log('No missions yet.');
    for (const entry of missions) {
      console.log(
        `${entry.missionId}  ${String(entry.terminalState ?? entry.status).padEnd(16)} lanes=${entry.lanes}  ${entry.request.slice(0, 60)}`,
      );
    }
    return undefined;
  }
  const mission = loadMission(ROOT, missionId);
  console.log(`mission ${mission.missionId} [${mission.status}] ${mission.terminalState ?? ''}`);
  console.log(`request: ${mission.request}`);
  console.log(`peak concurrency: ${mission.peakConcurrency ?? '-'} across ${mission.waves ?? '-'} wave(s)`);
  for (const lane of mission.lanes) {
    console.log(
      `  ${lane.id.padEnd(22)} ${lane.status.padEnd(9)} ${lane.kind.padEnd(6)} ` +
        `${lane.durationMs ? `${Math.round(lane.durationMs / 1000)}s`.padStart(6) : '     -'} ` +
        `${lane.changedPaths.length} file(s)`,
    );
  }
  const discoveries = loadDiscoveries(ROOT, missionId);
  console.log(`discoveries shared between lanes: ${discoveries.length}`);
  for (const entry of discoveries) console.log(`  [${entry.kind}] ${entry.subject}: ${entry.note}`);
  return undefined;
}

function printTimeline(missionId) {
  for (const event of readEvents(ROOT, missionId)) {
    console.log(`${event.elapsed}  ${event.message ?? event.event}`);
  }
}

// Closeout only ever runs after Tyler has accepted the work. It never pushes
// unaccepted work, and it never decides acceptance for itself.
async function acceptMission(missionId, argv) {
  const mission = loadMission(ROOT, missionId);
  if (mission.terminalState !== 'PASS') {
    console.error(`Refusing to close out ${missionId}: terminal state is ${mission.terminalState ?? 'unset'}, not PASS.`);
    process.exitCode = 2;
    return;
  }
  const message = flag(argv, '--message', null);
  if (!message) {
    console.error('Usage: accept <missionId> --message "commit subject"');
    process.exitCode = 2;
    return;
  }
  const files = mission.integration?.files ?? [];
  if (!files.length) {
    console.error('Nothing to commit: the mission integrated no files.');
    process.exitCode = 2;
    return;
  }
  // Narrow staging on purpose: only the files this mission integrated, never a
  // broad `git add`, so unrelated work can never be swept into the commit.
  const add = git(ROOT, ['add', '--', ...files]);
  if (add.status !== 0) {
    console.error(`git add failed: ${add.stderr}`);
    process.exitCode = 1;
    return;
  }
  const commit = git(ROOT, ['commit', '-m', message]);
  console.log(commit.stdout || commit.stderr);
  if (commit.status !== 0) {
    process.exitCode = 1;
    return;
  }
  const push = git(ROOT, ['push', 'origin', 'HEAD']);
  console.log(push.stdout || push.stderr);
  if (push.status !== 0) {
    console.error('push failed; the commit is local. Push manually once resolved.');
    process.exitCode = 1;
    return;
  }
  const head = git(ROOT, ['rev-parse', 'HEAD']).stdout.trim();
  git(ROOT, ['fetch', 'origin', 'main']);
  const remote = git(ROOT, ['rev-parse', 'origin/main']).stdout.trim();
  const dirty = git(ROOT, ['status', '--short', '--untracked-files=all']).stdout.split(/\r?\n/).filter((line) => line.trim());
  console.log(`main = ${head.slice(0, 7)}, origin/main = ${remote.slice(0, 7)}, dirty paths = ${dirty.length}`);
  console.log(head === remote && dirty.length === 0 ? 'closeout verified: clean main' : 'closeout INCOMPLETE');
}

function cleanup(argv) {
  const all = argv.includes('--all');
  const targets = all ? listMissions(ROOT).map((entry) => entry.missionId) : argv.slice(1).filter((entry) => !entry.startsWith('--'));
  for (const missionId of targets) {
    const mission = loadMission(ROOT, missionId);
    for (const lane of mission.lanes) {
      if (!lane.worktree) continue;
      const target = path.resolve(ROOT, lane.worktree);
      const result = git(ROOT, ['worktree', 'remove', '--force', target]);
      if (result.status !== 0 && existsSync(target)) rmSync(target, { recursive: true, force: true });
      lane.worktree = null;
    }
    git(ROOT, ['worktree', 'prune']);
    saveMission(ROOT, mission);
    console.log(`${missionId}: lane worktrees removed; mission.json, events.jsonl, discoveries.json and lane patches kept`);
  }
}

// ------------------------------------------------------------- the front door
//
// Everything above executes a mission. This is how one comes to exist without
// Tyler writing it. The request arrives as ordinary language, from whichever
// coding agent Tyler happened to be talking to, or from a bare terminal. The
// harness authors the mission and launches it in the same breath.

const FLAGS_WITH_VALUES = new Set(['--file', '--max-repairs', '--repair-builder', '--author-builder', '--recon']);

/** The request itself: positional words, a file, or stdin for a pasted spec. */
function requestFromArgv(argv) {
  const file = flag(argv, '--file', null);
  if (file) return readFileSync(path.resolve(ROOT, file), 'utf8').trim();
  if (argv.includes('--stdin')) return readFileSync(0, 'utf8').trim();

  const words = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value.startsWith('--')) {
      if (FLAGS_WITH_VALUES.has(value)) index += 1;
      continue;
    }
    words.push(value);
  }
  return words.join(' ').trim();
}

// The authoring trail, printed for transparency. It is never an approval gate:
// the launch below does not wait for anyone to read it.
function printAuthoringSummary(record) {
  console.log('');
  console.log('--- generated mission ---------------------------------------------');
  console.log(`mode:             ${record.mode}`);
  console.log(`operator outcome: ${record.operatorOutcome}`);
  for (const [index, criterion] of (record.acceptanceCriteria ?? []).entries()) {
    console.log(`  acceptance ${index + 1}:   ${criterion}`);
  }
  console.log(`lanes:            ${record.graph.length}`);
  for (const lane of record.graph) {
    console.log(
      `  ${lane.id.padEnd(22)} ${lane.kind.padEnd(6)} builder=${(lane.builderId ?? 'cc').padEnd(6)} ` +
        `deps=[${lane.dependsOn.join(', ') || 'none'}] owns=[${lane.ownedPaths.join(', ') || 'read-only'}]`,
    );
  }
  console.log(`focused checks:   ${record.focusedChecks.join(', ') || 'none'}`);
  console.log(`validation:       ${record.validationChecks.join(', ') || 'none'}`);
  console.log(`browser check:    ${record.browserCheck ? `${record.browserCheck.commands.join(' && ')} -> ${record.browserCheck.url}` : 'none'}`);
  console.log(`author attempts:  ${record.authorAttempts}, ${record.autoRepairs.length} auto-repair(s), ${record.autoCompletions.length} auto-completion(s)`);
  console.log(
    `timing:           recon ${Math.round(record.timings.reconMs / 1000)}s + author ${Math.round(record.timings.authorMs / 1000)}s ` +
      `= ${Math.round(record.timings.totalMs / 1000)}s to a valid mission`,
  );
  console.log(`trail:            ${record.planPath}`);
  console.log('-------------------------------------------------------------------');
  console.log('');
}

async function authorAndRun(argv) {
  const request = requestFromArgv(argv);
  if (!request) {
    console.error('Nothing to build. Say what you want LandOS to do:\n  npm run landos:build -- "make the comps section easier to read"');
    process.exitCode = 2;
    return;
  }

  const requestReceivedAt = Date.now();
  const report = createReporter(ROOT, { missionId: 'boot', createdAt: new Date().toISOString() });

  let authored;
  try {
    authored = await authorMission({
      root: ROOT,
      request,
      workerId: flag(argv, '--author-builder', null),
      reconCount: Number(flag(argv, '--recon', '3')),
      report,
    });
  } catch (error) {
    console.error(`\n=== AUTHORING FAILED ===\n${error.message}`);
    if (error.authoringDir) console.error(`authoring trail: ${path.relative(ROOT, error.authoringDir)}`);
    process.exitCode = 2;
    return;
  }

  printAuthoringSummary(authored.record);

  if (argv.includes('--author-only')) {
    console.log(`--author-only: stopping at a validated mission. Plan written to ${path.relative(ROOT, authored.planPath)}`);
    console.log(`Launch it with: npm run landos:build -- ${path.relative(ROOT, authored.planPath).split('\\').join('/')}`);
    return;
  }

  console.log(`launching the parallel build ${Math.round((Date.now() - requestReceivedAt) / 1000)}s after the request was received`);
  return runPlan(authored.plan, argv, { discoveries: authored.discoveries });
}

/**
 * Re-enter a mission that already has a validated plan.
 *
 * A lane that completed keeps its work: its worktree is intact and is reused
 * through the corrected integration path. Every lane that failed or was blocked
 * by a failure goes back to pending so the scheduler runs it again, reusing its
 * existing worktree so a rerun continues from whatever it had already written
 * rather than starting from an empty checkout.
 *
 * This is the missing continuation of the existing orchestrator, not a second
 * one: it runs the same lanes, the same integration, the same checks.
 */
function prepareMissionForResume(mission) {
  const abandonedRepairs = mission.lanes.filter((lane) => lane.kind === 'repair' && lane.status !== 'complete');
  if (abandonedRepairs.length) {
    // A repair lane is an ephemeral response to one exact check result, not a
    // node in the authored dependency graph. Replaying a quota-failed repair on
    // resume would run stale diagnostics in parallel with the real unfinished
    // lanes. Its prompt/output remain on disk and in events as evidence.
    mission.lanes = mission.lanes.filter((lane) => !abandonedRepairs.includes(lane));
  }

  const retried = [];
  const kept = [];
  for (const lane of mission.lanes) {
    if (lane.status === 'complete') { kept.push(lane.id); continue; }
    if (lane.status === 'failed' || lane.status === 'blocked' || lane.status === 'pending' || lane.status === 'running') {
      lane.status = 'pending';
      lane.error = null;
      retried.push(lane.id);
    }
  }
  mission.terminalState = null;
  mission.terminalReason = null;
  return { retried, kept, abandonedRepairs };
}

async function resumeMission(missionId, argv) {
  const mission = loadMission(ROOT, missionId);
  if (!mission) {
    console.error(`No mission ${missionId}. Use: npm run landos:build -- status`);
    process.exitCode = 2;
    return;
  }
  const report = createReporter(ROOT, mission);
  const state = await preflight(report);
  if (state.dirty.length && !argv.includes('--allow-dirty')) {
    console.error(`\nRefusing to resume: the primary worktree has ${state.dirty.length} dirty path(s).`);
    process.exitCode = 2;
    return;
  }

  const { retried, kept, abandonedRepairs } = prepareMissionForResume(mission);
  saveMission(ROOT, mission);
  report('mission.resume', {
    message:
      `resuming ${mission.missionId}\n` +
      `        keeping complete: ${kept.join(', ') || 'none'}\n` +
      `        re-running: ${retried.join(', ') || 'none'}` +
      (abandonedRepairs.length ? `\n        preserving but not replaying failed repair output: ${abandonedRepairs.map((lane) => lane.id).join(', ')}` : ''),
  });
  return executeMission(mission, argv, report);
}

// ---------------------------------------------------------------------- main

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === 'help') {
    console.log('Use one of:');
    console.log('  "<what you want LandOS to do>"        author a mission automatically and run it');
    console.log('  --file <spec.md>                      the same, from a written specification');
    console.log('  --stdin                               the same, from piped input');
    console.log('  ... --author-only                     stop at a validated mission, do not launch');
    console.log('  <plan.json>                           run a hand-written mission plan');
    console.log('  resume <missionId>                    re-run a validated mission\'s unfinished lanes');
    console.log('  status [missionId] | timeline <missionId> | show <missionId>');
    console.log('  cleanup <missionId>|--all | accept <missionId> --message "..."');
    return;
  }
  if (command === 'status') return printStatus(argv[1]);
  if (command === 'timeline') return printTimeline(argv[1]);
  if (command === 'show') return console.log(JSON.stringify(loadMission(ROOT, argv[1]), null, 2));
  if (command === 'cleanup') return cleanup(argv);
  if (command === 'resume') return resumeMission(argv[1], argv);
  if (command === 'accept') return acceptMission(argv[1], argv);

  // A path that exists is a hand-written plan; anything else is a request in
  // ordinary language. Both enter the same downstream lifecycle.
  if (!command.startsWith('--') && existsSync(path.resolve(ROOT, command)) && command.endsWith('.json')) {
    return runMission(command, argv);
  }
  return authorAndRun(argv);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}

export {
  runMission,
  runPlan,
  authorAndRun,
  requestFromArgv,
  preflight,
  captureBaseline,
  firstActionableFailure,
  preExistingReason,
  prepareMissionForResume,
  ROOT,
};
