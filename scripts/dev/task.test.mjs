#!/usr/bin/env node
// Unit tests for the direct-builder run. The engine and the verifier are both
// injected, so these cover the flow itself: one builder, deterministic verdict,
// at most one repair continuation, and honest timing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parseArgs, parsePacket, buildPrompt, buildRepairPrompt, runTask, formatSummary } from './task.mjs';

function tempRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'landos-task-'));
  const run = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  run('init', '-q');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  writeFileSync(path.join(dir, 'kept.txt'), 'baseline\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'base');
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const verdict = (passed, extra = {}) => ({
  paths: ['src/landos/acreage.ts'],
  checks: [{ id: 'typecheck', command: 'npx tsc --noEmit', exitCode: passed ? 0 : 2, ok: passed, durationMs: 1200 }],
  failures: passed ? [] : [{ id: 'typecheck', command: 'npx tsc --noEmit', exitCode: 2, text: 'src/landos/acreage.ts:3:1 TS2345: bad', diagnosis: { rawTail: 'raw tail' } }],
  passed,
  checksDerived: true,
  scopeExceptions: [],
  protectedPaths: [],
  secretMutations: [],
  routes: [],
  ...extra,
});

function fakeEngine(results) {
  const calls = [];
  const queue = [...results];
  return {
    calls,
    run: async (engine, options) => {
      calls.push({ phase: options.phase, prompt: options.prompt, sessionId: options.sessionId });
      return { exitCode: 0, durationMs: 100, stdout: '', stderr: '', sessionId: 'session-1', model: 'test-model', ...(queue.shift() ?? {}) };
    },
  };
}

test('parseArgs takes the engine explicitly and keeps the free text as the task', () => {
  const options = parseArgs(['--engine', 'codex', '--model', 'gpt-x', '--check', 'npm test', 'make', 'it', 'work']);
  assert.equal(options.engine, 'codex');
  assert.equal(options.model, 'gpt-x');
  assert.deepEqual(options.extraChecks, ['npm test']);
  assert.equal(options.taskText, 'make it work');
  assert.equal(options.repair, true);
});

test('parseArgs rejects an unknown option instead of guessing', () => {
  assert.throws(() => parseArgs(['--engine', 'claude', '--lanes', '4']), /Unknown option "--lanes"/);
});

test('a bare request needs no packet structure at all', () => {
  const packet = parsePacket('Make the acreage badge show its source county.');
  assert.equal(packet.outcome, 'Make the acreage badge show its source county.');
  assert.deepEqual(packet.scope, []);
  assert.deepEqual(packet.verify, []);
});

test('a packet contributes scope and required checks', () => {
  const packet = parsePacket(
    ['# Outcome', 'Badge shows county.', '', '# Scope', '- src/landos/**', '- web/src/pages/**', '', '# Verify', '- npm run landos:knowledge:check', ''].join('\n'),
  );
  assert.equal(packet.outcome, 'Badge shows county.');
  assert.deepEqual(packet.scope, ['src/landos/**', 'web/src/pages/**']);
  assert.deepEqual(packet.verify, ['npm run landos:knowledge:check']);
});

test('the builder prompt stays small and points at the durable context', () => {
  const prompt = buildPrompt(parsePacket('Fix the acreage badge.'), { packetPath: null });
  assert.match(prompt, /\.landos\/DEVELOPMENT_CONTEXT\.md/);
  assert.match(prompt, /Fix the acreage badge\./);
  assert.ok(Buffer.byteLength(prompt, 'utf8') < 2000, `prompt was ${Buffer.byteLength(prompt, 'utf8')} bytes`);
});

test('the repair prompt carries the exact failure and forbids weakening tests', () => {
  const prompt = buildRepairPrompt(verdict(false).failures, ['docs/notes.md']);
  assert.match(prompt, /npx tsc --noEmit/);
  assert.match(prompt, /TS2345/);
  assert.match(prompt, /docs\/notes\.md/);
  assert.match(prompt, /Do not weaken, skip, or delete a test/);
});

test('a passing run calls the builder once and reports verified', async () => {
  const repo = tempRepo();
  try {
    const engine = fakeEngine([{}]);
    const summary = await runTask(
      { engine: 'claude', cwd: repo.dir, taskText: 'do the thing', extraChecks: [], repair: true, timeoutMs: 1000 },
      { runEngine: engine.run, verify: async () => verdict(true) },
    );

    assert.equal(summary.state, 'verified');
    assert.equal(engine.calls.length, 1);
    assert.equal(engine.calls[0].phase, 'start');
    assert.equal(summary.repairUsed, false);
    assert.equal(summary.model, 'test-model');
    assert.ok(existsSync(path.join(repo.dir, summary.artifacts, 'result.json')));
  } finally {
    repo.cleanup();
  }
});

test('a failing run gets exactly one repair continuation in the same session', async () => {
  const repo = tempRepo();
  try {
    const engine = fakeEngine([{}, {}]);
    let pass = 0;
    const summary = await runTask(
      { engine: 'claude', cwd: repo.dir, taskText: 'do the thing', extraChecks: [], repair: true, timeoutMs: 1000 },
      { runEngine: engine.run, verify: async () => verdict(++pass > 1) },
    );

    assert.equal(summary.state, 'verified');
    assert.equal(summary.repairUsed, true);
    assert.deepEqual(engine.calls.map((call) => call.phase), ['start', 'resume']);
    // The repair continues the builder's own session rather than starting fresh.
    assert.equal(engine.calls[1].sessionId, 'session-1');
    assert.match(engine.calls[1].prompt, /did not pass independent verification/);
  } finally {
    repo.cleanup();
  }
});

test('a second failure stops with the evidence instead of trying again', async () => {
  const repo = tempRepo();
  try {
    const engine = fakeEngine([{}, {}]);
    const summary = await runTask(
      { engine: 'claude', cwd: repo.dir, taskText: 'do the thing', extraChecks: [], repair: true, timeoutMs: 1000 },
      { runEngine: engine.run, verify: async () => verdict(false) },
    );

    assert.equal(summary.state, 'failed');
    assert.equal(engine.calls.length, 2);
    assert.equal(summary.failures[0].command, 'npx tsc --noEmit');
    assert.match(formatSummary(summary), /FAIL {2}npx tsc --noEmit/);
  } finally {
    repo.cleanup();
  }
});

test('--no-repair stops at the first verdict', async () => {
  const repo = tempRepo();
  try {
    const engine = fakeEngine([{}]);
    const summary = await runTask(
      { engine: 'claude', cwd: repo.dir, taskText: 'do the thing', extraChecks: [], repair: false, timeoutMs: 1000 },
      { runEngine: engine.run, verify: async () => verdict(false) },
    );
    assert.equal(summary.state, 'failed');
    assert.equal(engine.calls.length, 1);
  } finally {
    repo.cleanup();
  }
});

test('an engine that cannot resume reports it rather than starting a second builder', async () => {
  const repo = tempRepo();
  try {
    const engine = fakeEngine([{ sessionId: null }, { unsupported: true, reason: 'no session id captured' }]);
    const summary = await runTask(
      { engine: 'codex', cwd: repo.dir, taskText: 'do the thing', extraChecks: [], repair: true, timeoutMs: 1000 },
      { runEngine: engine.run, verify: async () => verdict(false) },
    );
    assert.equal(summary.state, 'failed');
    assert.equal(summary.repairUsed, false);
    assert.equal(summary.repairUnsupported, 'no session id captured');
  } finally {
    repo.cleanup();
  }
});

test('a change with no derivable check is reported as unverified, never as verified', async () => {
  const repo = tempRepo();
  try {
    const engine = fakeEngine([{}]);
    const summary = await runTask(
      { engine: 'claude', cwd: repo.dir, taskText: 'edit a doc', extraChecks: [], repair: true, timeoutMs: 1000 },
      { runEngine: engine.run, verify: async () => verdict(true, { checks: [], checksDerived: false, paths: ['docs/x.md'] }) },
    );
    assert.equal(summary.state, 'unverified');
    assert.match(formatSummary(summary), /checks: none derived/);
  } finally {
    repo.cleanup();
  }
});

test('a mutated secret file blocks the run, skips the repair, and leaks nothing', async () => {
  const repo = tempRepo();
  try {
    const engine = fakeEngine([{}, {}]);
    const summary = await runTask(
      { engine: 'claude', cwd: repo.dir, taskText: 'do the thing', extraChecks: [], repair: true, timeoutMs: 1000 },
      {
        runEngine: engine.run,
        // Every derived check passed; only the secret guard objects.
        verify: async () => verdict(true, { passed: false, secretMutations: [{ path: '.env', change: 'modified' }] }),
      },
    );

    assert.equal(summary.state, 'blocked');
    // The builder that just wrote to .env does not get another turn.
    assert.equal(engine.calls.length, 1);
    assert.equal(summary.repairUsed, false);
    assert.deepEqual(summary.secretMutations, [{ path: '.env', change: 'modified' }]);
    assert.equal(summary.timing.msToVerifiedGreen, null);

    const text = formatSummary(summary);
    assert.match(text, /BLOCKED: a protected secret file was mutated/);
    assert.match(text, /\.env {2}modified/);
    assert.match(text, /Contents are deliberately not shown/);

    const events = readFileSync(path.join(repo.dir, summary.artifacts, 'trace.jsonl'), 'utf8');
    assert.match(events, /"type":"secret\.violation"/);
    assert.ok(!events.includes('repair.start'));
  } finally {
    repo.cleanup();
  }
});

test('a builder that really writes to .env is blocked by the real verification path', async () => {
  const repo = tempRepo();
  try {
    writeFileSync(path.join(repo.dir, '.env'), 'FIXTURE_ALPHA=placeholder\n');
    const calls = [];
    // Nothing is stubbed below the engine: this runs the real snapshot, the real
    // secret guard, and the real verify().
    const summary = await runTask(
      { engine: 'claude', cwd: repo.dir, taskText: 'do the thing', extraChecks: [], repair: true, timeoutMs: 1000 },
      {
        runEngine: async (engine, options) => {
          calls.push(options.phase);
          writeFileSync(path.join(repo.dir, 'notes.md'), 'ordinary work\n');
          writeFileSync(path.join(repo.dir, '.env'), 'FIXTURE_ALPHA=rewritten-by-the-builder\n');
          return { exitCode: 0, durationMs: 10, stdout: '', stderr: '', sessionId: 'session-1', model: 'test-model' };
        },
      },
    );

    assert.equal(summary.state, 'blocked');
    assert.deepEqual(calls, ['start']);
    assert.deepEqual(summary.secretMutations, [{ path: '.env', change: 'modified' }]);
    // The secret path stays out of the ordinary change set entirely.
    assert.deepEqual(summary.changedPaths, ['notes.md']);

    const written = readFileSync(path.join(repo.dir, summary.artifacts, 'result.json'), 'utf8');
    assert.ok(!written.includes('rewritten-by-the-builder'));
    assert.ok(!written.includes('FIXTURE_ALPHA'));
    assert.ok(!formatSummary(summary).includes('rewritten-by-the-builder'));
  } finally {
    repo.cleanup();
  }
});

test('timing and a machine-readable trace are recorded for every run', async () => {
  const repo = tempRepo();
  try {
    const engine = fakeEngine([{}]);
    const summary = await runTask(
      { engine: 'claude', cwd: repo.dir, taskText: 'do the thing', extraChecks: [], repair: true, timeoutMs: 1000 },
      { runEngine: engine.run, verify: async () => verdict(true) },
    );

    assert.ok(summary.timing.msToBuilderComplete >= 0);
    assert.ok(summary.timing.msToVerifiedGreen >= 0);
    assert.equal(typeof summary.timing.msFinalVerification, 'number');

    const events = readFileSync(path.join(repo.dir, summary.artifacts, 'trace.jsonl'), 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    const types = events.map((event) => event.type);
    assert.deepEqual(types.filter((type) => type === 'run.start').length, 1);
    assert.ok(types.includes('builder.start'));
    assert.ok(types.includes('check.end'));
    assert.ok(types.includes('run.end'));
    assert.equal(events[0].engine, 'claude');
  } finally {
    repo.cleanup();
  }
});

test('scope exceptions and protected paths surface in the result', async () => {
  const repo = tempRepo();
  try {
    const engine = fakeEngine([{}]);
    const summary = await runTask(
      { engine: 'claude', cwd: repo.dir, taskText: 'do the thing', extraChecks: [], repair: true, timeoutMs: 1000 },
      {
        runEngine: engine.run,
        verify: async () => verdict(true, { scopeExceptions: ['package.json'], protectedPaths: ['.env'] }),
      },
    );
    const text = formatSummary(summary);
    assert.match(text, /scope exceptions: package\.json/);
    assert.match(text, /PROTECTED PATHS TOUCHED: \.env/);
  } finally {
    repo.cleanup();
  }
});
