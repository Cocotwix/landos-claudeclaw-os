#!/usr/bin/env node
// LandOS direct development: one task, one builder, one deterministic verdict.
//
//   node scripts/dev/task.mjs --engine claude "make the acreage badge show the
//                                              source county"
//   node scripts/dev/task.mjs --engine codex --packet .landos/tasks/my-task.md
//
// The builder owns the critical path. Everything here exists to give it context,
// to find out exactly what it changed, to run the checks that change earns, and
// to say how long each part took. There is no planner, no scheduler, no lane
// graph, and no second agent. The engine is named on the command line; nothing
// probes, ranks, or fails over between providers.
//
// If final verification rejects a change, the same builder context gets the
// exact failure once. If it fails again, the run stops with the evidence.

import { spawnSync } from 'node:child_process';
import { mkdirSync, appendFileSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { getEngine, ENGINE_IDS, runEngine, DEFAULT_TIMEOUT_MS } from './providers.mjs';
import { snapshotTree, changeSignature, verify, headCommit } from './verify.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTEXT_FILE = '.landos/DEVELOPMENT_CONTEXT.md';
const DASHBOARD_URL = 'http://localhost:3141';

export function parseArgs(argv) {
  const options = {
    engine: null,
    model: null,
    packetFile: null,
    taskText: null,
    cwd: REPO_ROOT,
    extraChecks: [],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    repair: true,
  };
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => argv[(index += 1)];
    if (arg === '--engine' || arg === '-e') options.engine = take();
    else if (arg === '--model' || arg === '-m') options.model = take();
    else if (arg === '--packet' || arg === '-f') options.packetFile = take();
    else if (arg === '--cwd') options.cwd = path.resolve(take());
    else if (arg === '--check') options.extraChecks.push(take());
    else if (arg === '--timeout') options.timeoutMs = Number(take()) * 60_000;
    else if (arg === '--no-repair') options.repair = false;
    else if (arg.startsWith('-')) throw new Error(`Unknown option "${arg}"`);
    else rest.push(arg);
  }
  if (rest.length) options.taskText = rest.join(' ');
  return options;
}

/** The packet format is `.landos/task-packet.template.md`. Every field is optional but Outcome. */
export function parsePacket(text) {
  const sections = {};
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    const heading = /^#{1,2}\s+(Outcome|Acceptance|Scope|Surface|Verify)\s*$/i.exec(line);
    if (heading) {
      current = heading[1].toLowerCase();
      sections[current] = [];
    } else if (current) {
      sections[current].push(line);
    }
  }
  const block = (name) => (sections[name] ?? []).join('\n').trim();
  const list = (name) =>
    block(name)
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean);

  return {
    outcome: block('outcome') || String(text).trim(),
    acceptance: block('acceptance'),
    scope: list('scope'),
    surface: block('surface'),
    verify: list('verify'),
    raw: String(text).trim(),
  };
}

export function buildPrompt(packet, { packetPath }) {
  return [
    'You are the builder for one LandOS development task.',
    '',
    `Read \`${CONTEXT_FILE}\` first: it is the durable context for this repository.`,
    '`.landos/CODING_SESSION_PROTOCOL.md` and `.landos/PERMANENT_MEMORY.md` govern',
    'anything it does not cover.',
    '',
    packetPath ? `The task packet is at \`${packetPath}\`.` : 'The task:',
    '',
    packet.raw,
    '',
    'Work the way you normally would: inspect, edit, run the tests covering what',
    'you changed, diagnose, fix, retest. Own the whole change across whatever files',
    'it legitimately needs.',
    '',
    'Do not stage, commit, push, stash, reset, or revert anything, and preserve the',
    'unrelated work already in the tree. `.env` and other secret files are read only:',
    'never create, edit, delete, or print one, and never read the whole file. To find',
    'out whether a variable is set, run `node scripts/dev/env-guard.mjs status <NAME>`.',
    '',
    'When you believe the task is done, stop.',
    'An independent deterministic check decides whether it actually is, so no',
    'completion claim is needed or read.',
  ].join('\n');
}

export function buildRepairPrompt(failures, scopeExceptions) {
  const lines = [
    'That change did not pass independent verification of the working tree.',
    '',
    'Exact failures:',
    '',
  ];
  for (const failure of failures) {
    lines.push(`$ ${failure.command}`, `exit ${failure.exitCode}`, failure.text, '');
    if (failure.diagnosis?.rawTail) lines.push(failure.diagnosis.rawTail, '');
  }
  if (scopeExceptions?.length) {
    lines.push(`Changed outside the declared scope: ${scopeExceptions.join(', ')}`, '');
  }
  lines.push(
    'Fix the cause in the same working tree. Do not weaken, skip, or delete a test',
    'to make it pass, and do not widen scope. Run the failing command yourself to',
    'confirm it is green before you stop.',
  );
  return lines.join('\n');
}

function trace(runDir, event) {
  appendFileSync(path.join(runDir, 'trace.jsonl'), `${JSON.stringify(event)}\n`);
}

/**
 * Best-effort time-to-first-edit. Polls the cheap signals only: the status text
 * and the size/mtime of the paths that were already dirty. It never blocks the
 * builder and it never touches a file.
 */
function watchForFirstEdit(cwd, before, onEdit, intervalMs = 1000) {
  const baseline = new Map();
  for (const relativePath of Object.keys(before.files ?? {})) {
    try {
      const stats = statSync(path.join(cwd, relativePath));
      baseline.set(relativePath, `${stats.size}:${stats.mtimeMs}`);
    } catch {
      baseline.set(relativePath, 'missing');
    }
  }
  const baselineSignature = [...baseline.keys()].sort().join('\n');
  const timer = setInterval(() => {
    if (changeSignature(cwd).join('\n') !== baselineSignature) return onEdit();
    for (const [relativePath, mark] of baseline) {
      let current = 'missing';
      try {
        const stats = statSync(path.join(cwd, relativePath));
        current = `${stats.size}:${stats.mtimeMs}`;
      } catch {
        // stays 'missing'
      }
      if (current !== mark) return onEdit();
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

// UI work is only reviewable if the runtime the operator uses is actually up.
// This is the canonical health command, never an improvised restart.
function healthCheck(cwd) {
  const probe = spawnSync('npm', ['run', 'landos:health', '--silent'], {
    cwd,
    encoding: 'utf8',
    shell: true,
    windowsHide: true,
    timeout: 60_000,
  });
  const output = `${probe.stdout ?? ''}${probe.stderr ?? ''}`.trim();
  return { ok: probe.status === 0, output: output.split(/\r?\n/).slice(0, 6).join('\n') };
}

export async function runTask(options, deps = {}) {
  const { runEngine: run = runEngine, verify: verifyFn = verify, now = () => Date.now() } = deps;
  const engine = getEngine(options.engine);
  const cwd = options.cwd;

  const packetText = options.packetFile
    ? readFileSync(path.resolve(cwd, options.packetFile), 'utf8')
    : options.taskText;
  if (!packetText) throw new Error('Nothing to build: pass a task string or --packet <file>.');
  const packet = parsePacket(packetText);

  const runId = `t-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 6)}`;
  const runDir = path.join(cwd, '.runtime', 'dev', runId);
  mkdirSync(runDir, { recursive: true });

  const startedAt = now();
  const base = headCommit(cwd);
  const before = snapshotTree(cwd);
  writeFileSync(path.join(runDir, 'packet.md'), packet.raw);
  writeFileSync(path.join(runDir, 'before-status.txt'), before.statusText);

  const record = (type, fields = {}) =>
    trace(runDir, { t: now() - startedAt, ts: new Date().toISOString(), type, ...fields });

  record('run.start', { runId, engine: engine.id, model: options.model ?? null, base, cwd });

  let firstEditMs = null;
  const stopWatching = watchForFirstEdit(cwd, before, () => {
    if (firstEditMs !== null) return;
    firstEditMs = now() - startedAt;
    record('edit.first', { ms: firstEditMs });
  });

  const sessionId = randomUUID();
  const prompt = buildPrompt(packet, { packetPath: options.packetFile ?? null });
  writeFileSync(path.join(runDir, 'prompt.md'), prompt);

  record('builder.start', { phase: 'start' });
  let first;
  try {
    first = await run(engine, {
      cwd,
      prompt,
      sessionId,
      model: options.model,
      runDir,
      phase: 'start',
      timeoutMs: options.timeoutMs,
    });
  } finally {
    // The poller must stop even if the builder throws, or the run leaves a
    // timer behind for the rest of the process's life.
    stopWatching();
  }
  writeFileSync(path.join(runDir, 'start-stdout.log'), first.stdout ?? '');
  writeFileSync(path.join(runDir, 'start-stderr.log'), first.stderr ?? '');
  const builderMs = now() - startedAt;
  record('builder.end', {
    phase: 'start',
    exitCode: first.exitCode,
    timedOut: !!first.timedOut,
    durationMs: first.durationMs,
    model: first.model ?? null,
  });

  const scope = packet.scope;
  const verifyStart = now();
  record('verify.start', { pass: 1 });
  let result = await verifyFn(before, snapshotTree(cwd), { cwd, scope, extra: [...packet.verify, ...options.extraChecks] });
  let verifyMs = now() - verifyStart;
  for (const check of result.checks) record('check.end', { pass: 1, id: check.id, command: check.command, exitCode: check.exitCode, durationMs: check.durationMs });
  record('verify.end', { pass: 1, passed: result.passed, durationMs: verifyMs, changed: result.paths.length });

  for (const mutation of result.secretMutations ?? []) {
    record('secret.violation', { path: mutation.path, change: mutation.change });
  }

  let repairUsed = false;
  let repairUnsupported = null;
  // A run that touched a secret file stops here. Handing the builder another
  // turn would be asking the thing that just wrote to `.env` to write again.
  const secretsIntact = !(result.secretMutations ?? []).length;
  if (!result.passed && options.repair && secretsIntact) {
    repairUsed = true;
    record('repair.start', {});
    const repair = await run(engine, {
      cwd,
      prompt: buildRepairPrompt(result.failures, result.scopeExceptions),
      sessionId: first.sessionId ?? sessionId,
      model: options.model,
      runDir,
      phase: 'resume',
      timeoutMs: options.timeoutMs,
    });
    writeFileSync(path.join(runDir, 'resume-stdout.log'), repair.stdout ?? '');
    if (repair.unsupported) {
      repairUnsupported = repair.reason;
      repairUsed = false;
      record('repair.skipped', { reason: repair.reason });
    } else {
      record('repair.end', { exitCode: repair.exitCode, durationMs: repair.durationMs });
      const secondStart = now();
      record('verify.start', { pass: 2 });
      result = await verifyFn(before, snapshotTree(cwd), { cwd, scope, extra: [...packet.verify, ...options.extraChecks] });
      verifyMs = now() - secondStart;
      for (const check of result.checks) record('check.end', { pass: 2, id: check.id, command: check.command, exitCode: check.exitCode, durationMs: check.durationMs });
      record('verify.end', { pass: 2, passed: result.passed, durationMs: verifyMs });
    }
  }

  const ui = result.routes.length || result.paths.some((p) => p.startsWith('web/src/')) ? healthCheck(cwd) : null;
  const totalMs = now() - startedAt;
  const secretsMutated = (result.secretMutations ?? []).length > 0;
  const state = secretsMutated ? 'blocked' : result.passed ? (result.checksDerived ? 'verified' : 'unverified') : 'failed';

  const summary = {
    runId,
    state,
    engine: engine.id,
    model: first.model ?? options.model ?? null,
    outcome: packet.outcome,
    base,
    cwd,
    changedPaths: result.paths,
    checks: result.checks.map(({ id, command, exitCode, ok, durationMs }) => ({ id, command, exitCode, ok, durationMs })),
    failures: result.failures.map((failure) => ({ command: failure.command, exitCode: failure.exitCode, text: failure.text })),
    scopeExceptions: result.scopeExceptions,
    protectedPaths: result.protectedPaths,
    // Path and kind of change only. Never a fingerprint, a value, or a diff.
    secretMutations: (result.secretMutations ?? []).map(({ path: file, change }) => ({ path: file, change })),
    routes: result.routes.map((route) => `${DASHBOARD_URL}${route}`),
    runtimeHealthy: ui ? ui.ok : null,
    repairUsed,
    repairUnsupported,
    builderExitCode: first.exitCode,
    builderTimedOut: !!first.timedOut,
    timing: {
      startedAt: new Date(startedAt).toISOString(),
      msToFirstEdit: firstEditMs,
      msToBuilderComplete: builderMs,
      msFinalVerification: verifyMs,
      msToVerifiedGreen: result.passed ? totalMs : null,
      msTotal: totalMs,
      msWrapperOverhead: totalMs - (first.durationMs ?? 0) - verifyMs,
    },
    artifacts: path.relative(cwd, runDir).replace(/\\/g, '/'),
  };

  record('run.end', { state, totalMs, repairUsed });
  writeFileSync(path.join(runDir, 'result.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

export function formatSummary(summary) {
  const seconds = (ms) => (ms === null || ms === undefined ? 'n/a' : `${(ms / 1000).toFixed(1)}s`);
  const lines = [
    `${summary.state.toUpperCase()}  ${summary.runId}  engine=${summary.engine}${summary.model ? ` model=${summary.model}` : ''}`,
    '',
    `outcome: ${summary.outcome.split(/\r?\n/)[0]}`,
    `changed: ${summary.changedPaths.length} path(s)`,
    ...summary.changedPaths.slice(0, 25).map((p) => `  ${p}`),
    ...(summary.changedPaths.length > 25 ? [`  ... ${summary.changedPaths.length - 25} more`] : []),
  ];

  if (summary.secretMutations?.length) {
    lines.push(
      '',
      'BLOCKED: a protected secret file was mutated by this run.',
      ...summary.secretMutations.map((mutation) => `  ${mutation.path}  ${mutation.change}`),
      '  Secret files are read only. Contents are deliberately not shown; restore the',
      '  file yourself and re-check what else this run may have touched.',
    );
  }

  lines.push('', summary.checks.length ? 'checks:' : 'checks: none derived from the change');
  for (const check of summary.checks) {
    lines.push(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.command}  (${seconds(check.durationMs)})`);
  }
  for (const failure of summary.failures) {
    lines.push('', `failure: ${failure.command} (exit ${failure.exitCode})`, ...failure.text.split(/\r?\n/).slice(0, 12).map((l) => `  ${l}`));
  }
  if (summary.scopeExceptions.length) lines.push('', `scope exceptions: ${summary.scopeExceptions.join(', ')}`);
  if (summary.protectedPaths.length) lines.push('', `PROTECTED PATHS TOUCHED: ${summary.protectedPaths.join(', ')}`);
  if (summary.repairUnsupported) lines.push('', `repair skipped: ${summary.repairUnsupported}`);
  if (summary.routes.length) lines.push('', `review: ${summary.routes.join(' ')}  (runtime healthy: ${summary.runtimeHealthy})`);
  else if (summary.runtimeHealthy !== null) lines.push('', `runtime healthy: ${summary.runtimeHealthy} (${DASHBOARD_URL})`);

  lines.push(
    '',
    `timing: first edit ${seconds(summary.timing.msToFirstEdit)} | builder ${seconds(summary.timing.msToBuilderComplete)} | verify ${seconds(summary.timing.msFinalVerification)} | total ${seconds(summary.timing.msTotal)} | repair ${summary.repairUsed ? 'yes' : 'no'}`,
    `base: ${summary.base} (nothing staged or committed; revert with git checkout -- <path>)`,
    `trace: ${summary.artifacts}/trace.jsonl`,
  );
  return lines.join('\n');
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  if (!options.engine) {
    process.stderr.write(
      `Usage: node scripts/dev/task.mjs --engine <${ENGINE_IDS.join('|')}> [--model m] [--packet file] [--check "cmd"] ["task"]\n` +
        'The engine is always chosen explicitly.\n',
    );
    process.exitCode = 2;
    return;
  }
  const summary = await runTask(options);
  process.stdout.write(`${formatSummary(summary)}\n`);
  process.exitCode = summary.state === 'verified' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
