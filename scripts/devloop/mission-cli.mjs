#!/usr/bin/env node
// LandOS parallel-first development harness — operator CLI.
//
//   npm run landos:mission:run -- <plan.json> [--max-repairs 2] [--no-validate]
//   npm run landos:mission:run -- status [missionId]
//   npm run landos:mission:run -- show <missionId>
//   npm run landos:mission:run -- cleanup <missionId> | --all
//   npm run landos:mission:run -- accept <missionId> --message "..."
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

import { probeBuilders, BUILDERS } from './builders.mjs';
import { formatDiagnosis } from './diagnose.mjs';
import {
  createMission,
  createReporter,
  criticalPathLength,
  laneById,
  listMissions,
  loadDiscoveries,
  loadMission,
  missionDir,
  readEvents,
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
  if (!checks?.length) return [];
  report('baseline', { message: `baseline: recording pre-existing failures for ${checks.length} focused check(s)` });
  const { results } = await runCommandChecks(ROOT, checks, { report: null, label: 'baseline' });
  const failures = [];
  for (const result of results) {
    if (result.pass) continue;
    const diagnosis = diagnoseFirstFailure([result]);
    failures.push(...(diagnosis?.failures ?? []));
  }
  report('baseline.done', {
    message: `baseline: ${failures.length} pre-existing failure(s) recorded${
      failures.length ? ` — ${[...new Set(failures.map((f) => f.file))].join(', ')}` : ''
    }`,
  });
  return failures;
}

// ----------------------------------------------------------------------- run

async function runMission(planPath, argv) {
  const plan = JSON.parse(readFileSync(path.resolve(ROOT, planPath), 'utf8'));
  const issues = validatePlan(plan);
  if (issues.length) {
    console.error(`Invalid mission plan:\n- ${issues.join('\n- ')}`);
    process.exitCode = 2;
    return;
  }

  const maxRepairs = Number(flag(argv, '--max-repairs', '2'));
  const skipValidation = argv.includes('--no-validate');
  const skipBrowser = argv.includes('--no-browser');

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

  const baselineFailures = await captureBaseline(mission.focusedChecks, report);
  mission.baselineFailures = baselineFailures;
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
    const diagnosis = diagnoseFirstFailure(focused.results, { baselineFailures });
    repairs += 1;
    report('repair.diagnose', {
      message:
        `FOCUSED FAIL — exact diagnosis:\n${formatDiagnosis(diagnosis)
          .split('\n')
          .map((line) => `        ${line}`)
          .join('\n')}`,
    });

    const target = diagnosis.candidateFiles.length ? diagnosis.candidateFiles : integration.files;
    const repairLane = {
      id: `repair-${repairs}`,
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
    mission.repairs.push({ attempt: repairs, checkId: diagnosis.checkId, diagnosis });
    saveMission(ROOT, mission);

    report('repair.launch', {
      message: `targeted repair ${repairs}/${maxRepairs} launched on ${diagnosis.candidateFiles.join(', ') || 'the integrated files'} (repair worker receives the exact assertion, not a rerun)`,
    });

    const lane = laneById(mission, repairLane.id);
    await runLane(ROOT, mission, lane, {
      report,
      promptText: composeRepairPrompt(ROOT, mission, lane, diagnosis),
    });
    saveMission(ROOT, mission);

    focused = await runCommandChecks(ROOT, mission.focusedChecks, { report, label: 'focused' });
    mission.focusedResult = focused;
    saveMission(ROOT, mission);
  }

  if (!focused.pass) {
    const diagnosis = diagnoseFirstFailure(focused.results, { baselineFailures });
    finish(mission, report, 'FAIL', `focused checks still failing after ${repairs} repair(s): ${formatDiagnosis(diagnosis)}`);
    return;
  }
  report('focused.pass', { message: `focused checks PASS${repairs ? ` after ${repairs} targeted repair(s)` : ''}` });

  // ---- proportional validation, only now that a viable candidate exists
  if (!skipValidation && mission.validationChecks.length) {
    const validation = await runCommandChecks(ROOT, mission.validationChecks, { report, label: 'validation' });
    mission.validationResult = validation;
    saveMission(ROOT, mission);
    if (!validation.pass) {
      const diagnosis = diagnoseFirstFailure(validation.results, { baselineFailures });
      finish(mission, report, 'FAIL', `validation failed: ${formatDiagnosis(diagnosis)}`);
      return;
    }
    report('validation.pass', { message: 'validation PASS' });
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

// ---------------------------------------------------------------------- main

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === 'help') {
    console.log('Use: <plan.json> | status [missionId] | timeline <missionId> | show <missionId> | cleanup <missionId>|--all | accept <missionId> --message "..."');
    return;
  }
  if (command === 'status') return printStatus(argv[1]);
  if (command === 'timeline') return printTimeline(argv[1]);
  if (command === 'show') return console.log(JSON.stringify(loadMission(ROOT, argv[1]), null, 2));
  if (command === 'cleanup') return cleanup(argv);
  if (command === 'accept') return acceptMission(argv[1], argv);

  if (!existsSync(path.resolve(ROOT, command))) {
    console.error(`No such plan file: ${command}`);
    process.exitCode = 2;
    return;
  }
  return runMission(command, argv);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}

export { runMission, preflight, ROOT };
