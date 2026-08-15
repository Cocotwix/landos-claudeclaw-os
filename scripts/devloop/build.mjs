#!/usr/bin/env node
// The LandOS build runner. One thin mechanical execution layer.
//
// It does four things and nothing else:
//   1. splits a request into independent lanes, only when independence exists
//   2. runs those lanes concurrently against the primary tree, dependency-driven
//   3. runs the tests the change actually touched and hands back exact failures
//   4. repairs until the failure signature stops moving
//
// What it deliberately does NOT do, because the 9490 sprint measured each one
// costing more than it returned:
//   - a 10-minute reconnaissance pass before any code is written
//   - a 6-minute planning pass that rewrites an operator spec into a 91KB plan
//   - inlining the operator request and 200 shared discoveries into every
//     worker prompt (9490 lane prompts were 70-93KB each; these are ~2KB)
//   - per-lane git worktrees, patch extraction, and an integration phase
//     (source of every "empty diff", "git status exit 128" and "exit
//     3221225794" failure in 9490, and of six replayed integrations)
//   - wave barriers that idle finished lanes until their slowest peer lands
//   - a repair budget that terminates the mission and needs a human to resume
//
// Workers are the brain. This file is the wiring.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_TIMEOUT_MS,
  READONLY_TOOLS,
  WORKER_TOOLS,
  availableBuilderIds,
  getBuilder,
  launchWorker,
  nextBuilderId,
} from './builders.mjs';
import { diagnoseFailure, formatDiagnosis } from './diagnose.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const RUNS = path.join(ROOT, '.runtime', 'devloop');
const DEFAULT_CONCURRENCY = 6;
const DEFAULT_MAX_REPAIRS = 6;
const PLAN_TIMEOUT_MS = 5 * 60 * 1000;

// --------------------------------------------------------------- primitives

const runDir = (id) => path.join(RUNS, id);
const sha = (text) => createHash('sha256').update(String(text)).digest('hex').slice(0, 16);

function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'z').toLowerCase();
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function sh(command, { cwd = ROOT, timeout = 15 * 60 * 1000 } = {}) {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    exitCode: result.status ?? null,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    error: result.error ? String(result.error.message) : null,
  };
}

// ------------------------------------------------------------------- events

function makeReporter(mission) {
  const file = path.join(runDir(mission.id), 'events.jsonl');
  const started = new Date(mission.createdAt).getTime();
  return (event, message) => {
    const seconds = Math.round((Date.now() - started) / 1000);
    const elapsed = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    const line = { at: new Date().toISOString(), elapsed, event, message };
    appendFileSync(file, `${JSON.stringify(line)}\n`, 'utf8');
    process.stdout.write(`[${elapsed}] ${message}\n`);
  };
}

function save(mission) {
  writeFileSync(path.join(runDir(mission.id), 'mission.json'), `${JSON.stringify(mission, null, 2)}\n`, 'utf8');
}

// ------------------------------------------------------------ tree tracking
//
// Lanes edit the primary tree directly. Ownership is disjoint by construction,
// so concurrency is safe and there is nothing to integrate afterwards: a
// finished lane's work is already where it belongs. That is what makes
// "completed work stays completed" true without any bookkeeping at all.

// Content hashes, not git status codes. A file that was already dirty before
// the run keeps its status code when a lane edits it, so comparing codes
// silently reports "0 files changed" for exactly the case the protocol cares
// most about: unrelated work in progress sharing the tree.
function treeSnapshot() {
  const result = sh('git status --porcelain=v1 --untracked-files=all', { timeout: 120_000 });
  if (result.exitCode !== 0) return null;
  const paths = [];
  for (const line of result.output.split(/\r?\n/)) {
    if (line.length < 4) continue;
    paths.push(line.slice(3).trim().replace(/^"|"$/g, '').split('\\').join('/'));
  }
  return hashOwned(paths);
}

function expandPaths(patterns) {
  const files = [];
  for (const entry of patterns) {
    const absolute = path.join(ROOT, entry);
    if (!existsSync(absolute)) continue;
    if (statSync(absolute).isDirectory()) {
      const walk = (dir, rel) => {
        for (const name of readdirSync(dir)) {
          if (name === 'node_modules' || name === '.git') continue;
          const next = path.join(dir, name);
          if (statSync(next).isDirectory()) walk(next, `${rel}/${name}`);
          else files.push(`${rel}/${name}`);
        }
      };
      walk(absolute, entry.replace(/\/$/, ''));
    } else files.push(entry);
  }
  return files;
}

function hashOwned(patterns) {
  const map = new Map();
  for (const file of expandPaths(patterns)) {
    try {
      map.set(file, sha(readFileSync(path.join(ROOT, file))));
    } catch {
      // Unreadable right now is the same as absent for delta purposes.
    }
  }
  return map;
}

function changedBetween(before, after) {
  const changed = new Set();
  for (const [file, hash] of after) if (before.get(file) !== hash) changed.add(file);
  for (const file of before.keys()) if (!after.has(file)) changed.add(file);
  return [...changed].sort();
}

function withinOwned(file, owned) {
  return owned.some((entry) => {
    const prefix = entry.replace(/\/$/, '');
    return file === prefix || file.startsWith(`${prefix}/`);
  });
}

// ------------------------------------------------------------------ prompts
//
// A lane prompt is a job ticket, not a briefing pack. The operator's own words
// stay on disk and the worker reads the part it needs; shipping 21KB of spec
// and 81KB of other lanes' findings into every prompt bought nothing in 9490
// except tokens and latency.

function lanePrompt(mission, lane) {
  const requestFile = path.relative(ROOT, path.join(runDir(mission.id), 'request.md')).split('\\').join('/');
  const notesFile = path.relative(ROOT, path.join(runDir(mission.id), 'notes.md')).split('\\').join('/');
  const hasNotes = existsSync(path.join(runDir(mission.id), 'notes.md'));

  return [
    `You are one worker on a LandOS change. Other workers may be editing other files right now.`,
    '',
    `YOUR JOB: ${lane.title}`,
    lane.brief,
    '',
    'FILES YOU OWN (create/edit only these):',
    ...lane.paths.map((entry) => `  ${entry}`),
    '',
    `The operator's full request is at ${requestFile}. Read the parts relevant to your job.`,
    hasNotes ? `Findings other workers left for you are at ${notesFile}. Read it if useful.` : '',
    '',
    'You are in the real repository working tree. Other uncommitted work exists here and is not yours:',
    'do not touch files outside your list, and never run git commands that stage, commit, reset, clean or revert.',
    '',
    'You have a shell. Use it. Before you finish, run the tests covering what you changed',
    '(`npx vitest run <file>`) and `npx tsc --noEmit` if you touched types. Fix what you broke.',
    'Do not run the full suite, the production build, or the dev server: that is the runner\'s job.',
    '',
    'Do not read or print .env, secrets or credentials.',
    '',
    'If you learn something another worker would otherwise have to rediscover, append one line to',
    `${notesFile} in the form: NOTE: <file or symbol> — <one line finding>`,
    '',
    'End your final message with exactly WORK_COMPLETE or WORK_BLOCKED plus the one blocking reason.',
  ]
    .filter((part) => part !== '')
    .join('\n');
}

function repairPrompt(mission, diagnosis, attempt) {
  return [
    `You are a repair worker on a LandOS change. Repair attempt ${attempt}.`,
    'A check has already failed and been diagnosed exactly. Do not rediscover it. Fix it.',
    '',
    `CHECK: ${diagnosis.checkId}`,
    diagnosis.command ? `COMMAND: ${diagnosis.command}` : '',
    `EXIT: ${diagnosis.exitCode}`,
    '',
    'EXACT FAILURES:',
    formatDiagnosis(diagnosis),
    '',
    diagnosis.failures?.some((failure) => failure.preExisting)
      ? 'Failures marked [pre-existing on baseline] were already red before this change. Do NOT touch those.'
      : '',
    '',
    'RAW OUTPUT TAIL (context only):',
    diagnosis.rawTail,
    '',
    'You are in the real repository working tree. Make the smallest change that makes the check pass',
    'without weakening it. Never delete, skip or weaken a test to make it pass; repair the code it tests.',
    '',
    `Rerun the exact failing command yourself to confirm before you finish: ${diagnosis.command ?? 'the check above'}`,
    '',
    'End your final message with exactly WORK_COMPLETE or WORK_BLOCKED.',
  ]
    .filter((part) => part !== '')
    .join('\n');
}

// -------------------------------------------------------------------- lanes

async function runLane(mission, lane, report, builders) {
  const dir = path.join(runDir(mission.id), 'lanes', lane.id);
  mkdirSync(dir, { recursive: true });

  const before = hashOwned(lane.paths);
  const prompt = lanePrompt(mission, lane);
  writeFileSync(path.join(dir, 'prompt.md'), prompt, 'utf8');

  lane.status = 'running';
  lane.startedAt = new Date().toISOString();
  lane.promptBytes = Buffer.byteLength(prompt);
  save(mission);
  report('lane.start', `lane ${lane.id} started (${lane.builderId}, ${lane.promptBytes}B prompt)`);

  const result = await launchWorker(getBuilder(lane.builderId), {
    cwd: ROOT,
    promptText: prompt,
    attemptDir: dir,
    tools: lane.readOnly ? READONLY_TOOLS : WORKER_TOOLS,
    timeoutMs: mission.laneTimeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  writeFileSync(path.join(dir, 'stdout.txt'), result.stdout ?? '', 'utf8');
  if (result.stderr) writeFileSync(path.join(dir, 'stderr.txt'), result.stderr, 'utf8');

  const changed = changedBetween(before, hashOwned(lane.paths));
  lane.changed = changed;
  lane.claim = result.claim;
  lane.durationMs = result.durationMs;
  lane.timedOut = result.timedOut;
  lane.finishedAt = new Date().toISOString();

  // A lane that edited something did useful work even if its sign-off token
  // never made it out of a flaky provider stream. 9490 threw away four lanes'
  // real output because the harness trusted the token over the tree.
  const produced = changed.length > 0;
  lane.status = produced || result.claim === 'COMPLETE' ? 'done' : 'failed';
  if (lane.status === 'failed') lane.error = result.error ?? `claim ${result.claim}, no files changed`;
  save(mission);

  report(
    lane.status === 'done' ? 'lane.done' : 'lane.failed',
    `lane ${lane.id} ${lane.status} in ${Math.round(result.durationMs / 1000)}s ` +
      `(claim ${result.claim}, ${changed.length} file(s) changed)`,
  );

  // Provider trouble is a builder choice for the next lane, never a rebuild.
  if (lane.status === 'failed' && builders.length > 1) {
    mission.nextBuilder = nextBuilderId(lane.builderId, builders);
  }
  return lane;
}

// Dependency-driven, not wave-driven. A lane starts the instant its
// dependencies are done. In 9490 the wave barrier left one lane running alone
// for 15m18s while three finished peers sat idle behind it.
async function runLanes(mission, report, builders) {
  const byId = new Map(mission.lanes.map((lane) => [lane.id, lane]));
  const running = new Map();
  const limit = mission.concurrency ?? DEFAULT_CONCURRENCY;
  let peak = 0;

  const ready = () =>
    mission.lanes.filter(
      (lane) =>
        lane.status === 'pending' &&
        !running.has(lane.id) &&
        (lane.deps ?? []).every((dep) => byId.get(dep)?.status === 'done'),
    );

  const blocked = () =>
    mission.lanes.filter(
      (lane) => lane.status === 'pending' && (lane.deps ?? []).some((dep) => byId.get(dep)?.status === 'failed'),
    );

  for (;;) {
    for (const lane of blocked()) {
      lane.status = 'failed';
      lane.error = `dependency failed: ${(lane.deps ?? []).filter((dep) => byId.get(dep)?.status === 'failed').join(', ')}`;
      report('lane.failed', `lane ${lane.id} ${lane.error}`);
    }

    while (running.size < limit) {
      const next = ready()[0];
      if (!next) break;
      next.builderId = next.builderId ?? mission.nextBuilder ?? builders[0];
      running.set(next.id, runLane(mission, next, report, builders).finally(() => running.delete(next.id)));
      peak = Math.max(peak, running.size);
    }

    if (!running.size) break;
    await Promise.race(running.values());
  }

  mission.peakConcurrency = peak;
  save(mission);
  return peak;
}

// -------------------------------------------------------------------- checks
//
// Derived from what actually changed, not declared up front. 9490 ran a fixed
// set of 7 focused checks 14 times over: 791 check-seconds, most of them on
// files no lane had touched.

function deriveChecks(changed, extra = []) {
  const tests = new Set();
  let typescript = false;

  for (const file of changed) {
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) tests.add(file);
    else if (/\.[cm]?tsx?$/.test(file)) {
      typescript = true;
      const sibling = file.replace(/\.([cm]?tsx?)$/, '.test.$1');
      if (existsSync(path.join(ROOT, sibling))) tests.add(sibling);
    }
  }

  const checks = [];
  if (tests.size) {
    checks.push({ id: 'tests', command: `npx vitest run ${[...tests].map((file) => `"${file}"`).join(' ')}` });
  }
  if (typescript || tests.size) checks.push({ id: 'typecheck', command: 'npx tsc --noEmit' });
  for (const [index, command] of extra.entries()) checks.push({ id: `check-${index + 1}`, command });
  return checks;
}

function runChecks(checks) {
  return Promise.all(
    checks.map(async (check) => {
      const startedAt = Date.now();
      const result = sh(check.command);
      return { ...check, ...result, durationMs: Date.now() - startedAt, pass: result.exitCode === 0 };
    }),
  );
}

// The repair loop terminates on lack of progress, not on an arbitrary budget.
// In 9490 a budget of 2 ended the mission three separate times, and each
// restart cost a human noticing plus 5-16 minutes of dead air.
async function repairUntilStable(mission, checks, report, builders) {
  let attempt = 0;
  let lastSignature = null;
  let repeats = 0;

  for (;;) {
    const results = await runChecks(checks);
    mission.checkResults = results.map(({ output, ...rest }) => rest);
    save(mission);
    for (const result of results) {
      report('check.result', `  [${result.pass ? 'pass' : 'FAIL'}] ${result.id} (${Math.round(result.durationMs / 1000)}s)`);
    }

    const failed = results.find((result) => !result.pass);
    if (!failed) {
      report('checks.pass', `checks pass${attempt ? ` after ${attempt} repair(s)` : ''}`);
      return true;
    }

    const diagnosis = diagnoseFailure(failed, failed.output, { baselineFailures: mission.baselineFailures ?? [] });
    const signature = sha(diagnosis.failures.map((f) => `${f.file}::${f.title}`).join('|') || diagnosis.rawTail);
    repeats = signature === lastSignature ? repeats + 1 : 0;
    lastSignature = signature;

    if (repeats >= 2) {
      report('repair.stalled', `repair stalled: identical failure after ${attempt} attempt(s) — stopping`);
      mission.blocker = formatDiagnosis(diagnosis);
      return false;
    }
    if (attempt >= (mission.maxRepairs ?? DEFAULT_MAX_REPAIRS)) {
      report('repair.capped', `repair cap ${mission.maxRepairs ?? DEFAULT_MAX_REPAIRS} reached`);
      mission.blocker = formatDiagnosis(diagnosis);
      return false;
    }

    attempt += 1;
    report('repair.diagnose', `FAIL ${failed.id}:\n${formatDiagnosis(diagnosis)}`);

    // A vitest failure names the *test* file, and a repair worker is forbidden
    // to weaken a test. Scoping it to the failure's own file would leave it
    // nothing legal to edit. The honest scope is the code this change touched,
    // plus wherever the failure was reported.
    const repairPaths = [
      ...new Set([
        ...mission.lanes.flatMap((entry) => entry.paths ?? []),
        ...diagnosis.candidateFiles,
        ...diagnosis.candidateFiles.map((file) => file.replace(/\.(test|spec)\.([cm]?[jt]sx?)$/, '.$2')),
      ]),
    ];

    const lane = {
      id: `repair-${attempt}`,
      title: `repair ${failed.id}`,
      brief: '',
      paths: repairPaths.length ? repairPaths : ['src', 'web/src', 'scripts'],
      deps: [],
      status: 'pending',
      builderId: mission.nextBuilder ?? builders[0],
    };
    mission.lanes.push(lane);
    mission.repairs = attempt;
    save(mission);

    const dir = path.join(runDir(mission.id), 'lanes', lane.id);
    mkdirSync(dir, { recursive: true });
    const prompt = repairPrompt(mission, diagnosis, attempt);
    writeFileSync(path.join(dir, 'prompt.md'), prompt, 'utf8');
    lane.promptBytes = Buffer.byteLength(prompt);
    lane.status = 'running';
    lane.startedAt = new Date().toISOString();
    save(mission);
    report('repair.launch', `repair ${attempt} launched (${lane.builderId}, ${lane.promptBytes}B prompt)`);

    const before = hashOwned(lane.paths);
    const result = await launchWorker(getBuilder(lane.builderId), {
      cwd: ROOT,
      promptText: prompt,
      attemptDir: dir,
      tools: WORKER_TOOLS,
      timeoutMs: mission.laneTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    writeFileSync(path.join(dir, 'stdout.txt'), result.stdout ?? '', 'utf8');

    lane.changed = changedBetween(before, hashOwned(lane.paths));
    lane.claim = result.claim;
    lane.durationMs = result.durationMs;
    lane.finishedAt = new Date().toISOString();
    lane.status = lane.changed.length ? 'done' : 'failed';
    save(mission);
    report(
      'repair.done',
      `repair ${attempt} ${lane.status} in ${Math.round(result.durationMs / 1000)}s (${lane.changed.length} file(s))`,
    );

    if (lane.status === 'failed' && builders.length > 1) {
      mission.nextBuilder = nextBuilderId(lane.builderId, builders);
    }
  }
}

// ------------------------------------------------------------------ planning
//
// Only a task graph. The operator already wrote the specification; rewriting it
// into a bigger specification cost 9490 six minutes and produced a 91KB plan
// nobody read. `--solo` skips this entirely, which is the right shape for a
// small change: time to first edit becomes a few seconds.

const PLAN_SCHEMA = `{"lanes":[{"id":"kebab-id","title":"one line","brief":"what to build, 2-5 sentences","paths":["src/x.ts"],"deps":[]}]}`;

async function planLanes(mission, report, builders) {
  const requestFile = path.relative(ROOT, path.join(runDir(mission.id), 'request.md')).split('\\').join('/');
  const outFile = path.join(runDir(mission.id), 'lanes.json');
  const outRel = path.relative(ROOT, outFile).split('\\').join('/');

  const prompt = [
    'Split a LandOS change into the minimum number of independently buildable jobs.',
    '',
    `The request is at ${requestFile}. Read it, then inspect the repository enough to name real files.`,
    '',
    'RULES:',
    '- Return ONE lane unless there is genuinely independent work. One lane is the common answer.',
    '- Never exceed 6 lanes. Do not manufacture parallelism.',
    '- Lane path sets MUST be disjoint: two lanes never list the same file. Workers edit the real tree concurrently.',
    '- Use deps only when a lane truly cannot start until another finishes. Prefer no deps.',
    '- paths must be real repository paths (files, or a directory the lane owns outright).',
    '- brief is what to build, not how the harness works. The worker reads the full request itself.',
    '',
    `Write ONLY this JSON to ${outRel} and nothing else anywhere:`,
    PLAN_SCHEMA,
    '',
    'Then end your final message with WORK_COMPLETE.',
  ].join('\n');

  const dir = path.join(runDir(mission.id), 'plan');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'prompt.md'), prompt, 'utf8');
  report('plan.start', `planning lanes (${builders[0]}, ${Buffer.byteLength(prompt)}B prompt)`);

  const startedAt = Date.now();
  await launchWorker(getBuilder(builders[0]), {
    cwd: ROOT,
    promptText: prompt,
    attemptDir: dir,
    tools: WORKER_TOOLS,
    timeoutMs: PLAN_TIMEOUT_MS,
  });

  const parsed = readJson(outFile);
  const lanes = Array.isArray(parsed?.lanes) ? parsed.lanes : null;
  report('plan.done', `planning took ${Math.round((Date.now() - startedAt) / 1000)}s → ${lanes?.length ?? 0} lane(s)`);
  return lanes;
}

function validateLanes(lanes) {
  const seen = new Map();
  for (const lane of lanes) {
    if (!lane.id || !Array.isArray(lane.paths) || !lane.paths.length) throw new Error(`lane "${lane.id}" has no paths`);
    for (const entry of lane.paths) {
      const owner = seen.get(entry);
      if (owner) throw new Error(`path "${entry}" claimed by both ${owner} and ${lane.id}; lane paths must be disjoint`);
      seen.set(entry, lane.id);
    }
  }
  const ids = new Set(lanes.map((lane) => lane.id));
  for (const lane of lanes) {
    for (const dep of lane.deps ?? []) if (!ids.has(dep)) throw new Error(`lane ${lane.id} depends on unknown ${dep}`);
  }
  return lanes;
}

// ------------------------------------------------------------------ commands

async function start(request, options) {
  const id = `${slug(request.split('\n')[0]) || 'change'}-${stamp()}`;
  mkdirSync(path.join(runDir(id), 'lanes'), { recursive: true });
  writeFileSync(path.join(runDir(id), 'request.md'), request, 'utf8');

  const mission = {
    id,
    createdAt: new Date().toISOString(),
    status: 'running',
    concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
    maxRepairs: options.maxRepairs ?? DEFAULT_MAX_REPAIRS,
    laneTimeoutMs: options.laneTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    lanes: [],
  };
  save(mission);
  const report = makeReporter(mission);

  const builders = options.builder ? [options.builder] : availableBuilderIds();
  if (!builders.length) throw new Error('no coding agent is available on PATH');
  mission.builders = builders;
  report('start', `${id} — builders: ${builders.join(', ')}`);

  const treeBefore = treeSnapshot();

  let lanes;
  if (options.lanesFile) {
    lanes = readJson(path.resolve(options.lanesFile))?.lanes;
    report('plan.given', `using lane graph from ${options.lanesFile}: ${lanes?.length ?? 0} lane(s)`);
  } else if (options.solo) {
    lanes = [{ id: 'work', title: 'implement the request', brief: 'Implement the request in full.', paths: options.paths ?? ['src', 'web/src', 'scripts'], deps: [] }];
    report('plan.solo', 'solo mode: no planning pass, one worker straight to the code');
  } else {
    lanes = await planLanes(mission, report, builders);
  }
  if (!lanes?.length) throw new Error('no lanes to run');

  mission.lanes = validateLanes(lanes).map((lane) => ({ ...lane, deps: lane.deps ?? [], status: 'pending' }));
  save(mission);

  await runLanes(mission, report, builders);

  const treeAfter = treeSnapshot();
  // Per-lane hashes are exact for owned paths; the tree delta additionally
  // catches anything that appeared outside them. Neither alone is complete.
  const changed = [
    ...new Set([
      ...mission.lanes.flatMap((lane) => lane.changed ?? []),
      ...(treeBefore && treeAfter ? changedBetween(treeBefore, treeAfter) : []),
    ]),
  ].sort();
  const owned = mission.lanes.flatMap((lane) => lane.paths ?? []);
  const strays = changed.filter((file) => !withinOwned(file, owned));
  mission.changed = changed;
  mission.strays = strays;
  save(mission);
  report('lanes.settled', `${mission.lanes.filter((l) => l.status === 'done').length}/${mission.lanes.length} lane(s) done, ${changed.length} file(s) changed, peak concurrency ${mission.peakConcurrency}`);
  if (strays.length) report('strays', `WARNING: ${strays.length} file(s) changed outside any lane's paths: ${strays.slice(0, 10).join(', ')}`);

  const checks = deriveChecks(changed, options.checks ?? []);
  if (!checks.length) {
    report('checks.none', 'no code changed that any check covers');
  } else {
    report('checks.start', `running ${checks.length} derived check(s): ${checks.map((c) => c.id).join(', ')}`);
    const ok = await repairUntilStable(mission, checks, report, builders);
    if (!ok) {
      mission.status = 'blocked';
      save(mission);
      report('end', 'BLOCKED — checks still failing; see mission.blocker');
      return mission;
    }
  }

  if (options.serve) {
    report('serve.start', 'restarting the managed runtime');
    for (const command of ['npm run landos:restart', 'npm run landos:health']) {
      const result = sh(command, { timeout: 5 * 60 * 1000 });
      report('serve', `  [${result.exitCode === 0 ? 'ok' : 'FAIL'}] ${command} (exit ${result.exitCode})`);
      if (result.exitCode !== 0) {
        mission.status = 'blocked';
        mission.blocker = `${command} exited ${result.exitCode}`;
        save(mission);
        report('end', 'BLOCKED — runtime did not come up');
        return mission;
      }
    }
    // HTTP reachability only. Asserting rendered text against a Preact SPA's
    // raw HTML is what marked the 9490 mission NEEDS_ATTENTION on a product
    // that was in fact working. Rendered acceptance belongs in a browser.
    const probe = sh(`node -e "fetch('http://localhost:3141/dept/acquisitions').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`, { timeout: 60_000 });
    report('serve', `  [${probe.exitCode === 0 ? 'ok' : 'FAIL'}] http://localhost:3141 reachable`);
  }

  mission.status = 'ready';
  mission.finishedAt = new Date().toISOString();
  save(mission);
  const minutes = ((Date.now() - new Date(mission.createdAt).getTime()) / 60000).toFixed(1);
  report('end', `READY for review in ${minutes}m — ${mission.changed.length} file(s) changed, ${mission.repairs ?? 0} repair(s). Nothing committed.`);
  return mission;
}

// Resume is mechanical: lanes already done are already in the tree, so there is
// nothing to replay and nothing to reconstruct.
async function resume(id, options) {
  const mission = readJson(path.join(runDir(id), 'mission.json'));
  if (!mission) throw new Error(`no mission ${id}`);
  const report = makeReporter(mission);
  const builders = options.builder ? [options.builder] : availableBuilderIds();

  const pending = mission.lanes.filter((lane) => lane.status !== 'done');
  for (const lane of pending) lane.status = 'pending';
  report('resume', `resuming ${id}: ${mission.lanes.length - pending.length} lane(s) already done, ${pending.length} to run`);
  mission.status = 'running';
  save(mission);

  await runLanes(mission, report, builders);
  const changed = [...new Set(mission.lanes.flatMap((lane) => lane.changed ?? []))];
  const checks = deriveChecks(changed, options.checks ?? []);
  if (checks.length) await repairUntilStable(mission, checks, report, builders);
  mission.status = 'ready';
  save(mission);
  report('end', 'resume complete');
  return mission;
}

function latestMission() {
  if (!existsSync(RUNS)) return null;
  const entries = readdirSync(RUNS)
    .map((name) => ({ name, file: path.join(RUNS, name, 'mission.json') }))
    .filter((entry) => existsSync(entry.file))
    .sort((a, b) => statSync(b.file).mtimeMs - statSync(a.file).mtimeMs);
  return entries[0]?.name ?? null;
}

function status(id) {
  const target = id ?? latestMission();
  if (!target) return console.log('no missions yet');
  const mission = readJson(path.join(runDir(target), 'mission.json'));
  if (!mission) return console.log(`no mission ${target}`);
  const elapsed = ((new Date(mission.finishedAt ?? Date.now()).getTime() - new Date(mission.createdAt).getTime()) / 60000).toFixed(1);
  console.log(`${mission.id}  ${mission.status}  ${elapsed}m  peak x${mission.peakConcurrency ?? 0}  repairs ${mission.repairs ?? 0}`);
  for (const lane of mission.lanes) {
    const seconds = lane.durationMs ? `${Math.round(lane.durationMs / 1000)}s` : '';
    console.log(`  ${(lane.status ?? '?').padEnd(8)} ${lane.id.padEnd(28)} ${seconds.padStart(6)}  ${lane.promptBytes ?? 0}B  ${(lane.changed ?? []).length} file(s)`);
  }
  if (mission.strays?.length) console.log(`  strays: ${mission.strays.join(', ')}`);
  if (mission.blocker) console.log(`\nBLOCKER:\n${mission.blocker}`);
}

// Follow the event log the run is already writing. No polling monitor inside
// the harness, and watching costs the build nothing.
function watch(id) {
  const target = id ?? latestMission();
  const file = path.join(runDir(target), 'events.jsonl');
  let offset = 0;
  const pump = () => {
    if (!existsSync(file)) return;
    const text = readFileSync(file, 'utf8');
    for (const line of text.slice(offset).split('\n')) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        process.stdout.write(`[${event.elapsed}] ${event.message}\n`);
        if (event.event === 'end') process.exit(0);
      } catch {
        // partial line; picked up next tick
      }
    }
    offset = text.length;
  };
  pump();
  setInterval(pump, 1000);
}

// --------------------------------------------------------------------- main

function parseArgs(argv) {
  const options = { checks: [] };
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--solo') options.solo = true;
    else if (arg === '--serve') options.serve = true;
    else if (arg === '--detach') options.detach = true;
    else if (arg === '--file') options.file = argv[++index];
    else if (arg === '--lanes') options.lanesFile = argv[++index];
    else if (arg === '--builder') options.builder = argv[++index];
    else if (arg === '--check') options.checks.push(argv[++index]);
    else if (arg === '--paths') options.paths = argv[++index].split(',');
    else if (arg === '--concurrency') options.concurrency = Number(argv[++index]);
    else if (arg === '--max-repairs') options.maxRepairs = Number(argv[++index]);
    else if (arg === '--lane-timeout') options.laneTimeoutMs = Number(argv[++index]) * 60_000;
    else rest.push(arg);
  }
  return { options, rest };
}

const USAGE = `LandOS build runner

  npm run landos:build -- "<what you want>"        plan lanes, run them, test, repair
  npm run landos:build -- --file spec.md           same, request read from a file
  npm run landos:build -- --solo "<small change>"  skip planning, one worker, straight to code
  npm run landos:build -- --lanes graph.json       hand-written lane graph, no planning pass
  npm run landos:build -- resume <id>              rerun only what is not done
  npm run landos:build -- status [id]
  npm run landos:build -- watch [id]

  --serve          restart the managed runtime and check localhost when checks pass
  --detach         run independently of this shell; follow it with watch
  --check "<cmd>"  add a check beyond the derived ones (repeatable)
  --concurrency N  default ${DEFAULT_CONCURRENCY}      --max-repairs N  default ${DEFAULT_MAX_REPAIRS}
  --builder <id>   pin a provider   --paths a,b   owned paths for --solo
`;

async function main() {
  const { options, rest } = parseArgs(process.argv.slice(2));
  const [command, ...args] = rest;

  if (command === 'status') return status(args[0]);
  if (command === 'watch') return watch(args[0]);
  if (command === 'resume') return void (await resume(args[0], options));
  if (!command && !options.file && !options.lanesFile) return void process.stdout.write(USAGE);

  const request = options.file
    ? readFileSync(path.resolve(options.file), 'utf8')
    : rest.join(' ') || (options.lanesFile ? `Lane graph supplied directly from ${options.lanesFile}.` : '');
  if (!request.trim()) return void process.stdout.write(USAGE);

  // Long builds must outlive the shell that started them. A wrapper timeout is
  // not a reason to reconstruct anything.
  if (options.detach) {
    const argv = process.argv.slice(2).filter((arg) => arg !== '--detach');
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...argv], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    process.stdout.write(`detached as pid ${child.pid}. follow with: npm run landos:build -- watch\n`);
    return;
  }

  const mission = await start(request, options);
  process.exitCode = mission.status === 'ready' ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}

export { deriveChecks, changedBetween, hashOwned, validateLanes, withinOwned, lanePrompt, slug };
