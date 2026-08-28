#!/usr/bin/env node
// Windows console-window regression coverage for the builder launch layer.
//
// A sprint used to pop a blank terminal window on Windows and steal focus. The
// cause was not a missing windowsHide: it was the cmd.exe wrapper that
// shell: true puts between the runner and the builder. windowsHide hides the
// wrapper's own window, but a console builder underneath it materializes the
// wrapper's console anyway, and Windows 11 hands that materialized console to
// the default terminal. Launching the builder image directly is what removes
// the window, so these tests pin the launch shape, not just the flag.

import assert from 'node:assert/strict';
import test from 'node:test';

import { BUILDERS, detectBuilder, getBuilder, launchWorker, resolveLaunch } from './builders.mjs';

// Built rather than written literally: a Windows path in a source literal is
// one escaping mistake away from silently testing nothing.
const SEP = String.fromCharCode(92);
const w = (...parts) => parts.join(SEP);

const onWindows = (present, pathValue = w('C:', 'bin')) => ({
  platform: 'win32',
  env: { PATH: pathValue },
  exists: (candidate) => present.includes(candidate),
});

const stubChild = () => ({
  stdout: { on() {} },
  stderr: { on() {} },
  stdin: { end() {} },
  on(event, handler) { if (event === 'close') setImmediate(() => handler(0)); },
  pid: 1,
});

test('a builder shipping a real executable is launched without a shell', () => {
  const launch = resolveLaunch('codex', onWindows([w('C:', 'bin', 'codex.exe')]));
  assert.equal(launch.shell, false, 'the wrapper console is what opened the window');
  assert.equal(launch.command, w('C:', 'bin', 'codex.exe'));
});

test('a builder that only ships a shim keeps its shell rather than failing to launch', () => {
  // claude is installed by npm as claude.cmd only, and a .cmd cannot be
  // executed directly. Launching at all beats the cosmetic win.
  const launch = resolveLaunch('claude', onWindows([w('C:', 'bin', 'claude.cmd')]));
  assert.equal(launch.shell, true);
  assert.equal(launch.command, 'claude');
});

test('the first PATH directory holding a real executable wins', () => {
  const launch = resolveLaunch('codex', {
    platform: 'win32',
    env: { PATH: [w('C:', 'a'), w('C:', 'b')].join(';') },
    exists: (candidate) => candidate === w('C:', 'b', 'codex.exe'),
  });
  assert.equal(launch.command, w('C:', 'b', 'codex.exe'));
  assert.equal(launch.shell, false);
});

test('non-Windows platforms never take a shell', () => {
  assert.deepEqual(resolveLaunch('codex', { platform: 'linux' }), { command: 'codex', shell: false });
});

test('launching a worker opens no window and does not shell when it need not', async () => {
  const seen = [];
  await launchWorker(
    getBuilder('codex'),
    { cwd: w('C:', 'repo'), promptText: 'x', attemptDir: w('C:', 'repo', 'attempt') },
    {
      resolveFn: () => ({ command: w('C:', 'bin', 'codex.exe'), shell: false }),
      spawnFn: (command, args, options) => { seen.push({ command, args, options }); return stubChild(); },
    },
  );

  assert.equal(seen.length, 1);
  assert.equal(seen[0].command, w('C:', 'bin', 'codex.exe'));
  assert.equal(seen[0].options.shell, false);
  assert.equal(seen[0].options.windowsHide, true, 'still hidden for the shim fallback path');
  // Raw, because without a shell Node quotes each argument itself and a
  // pre-quoted path would reach codex with literal quote characters in it.
  assert.ok(seen[0].args.includes(w('C:', 'repo')), 'cwd is passed raw, not shell-quoted');
});

test('the shim fallback still shell-quotes its arguments', async () => {
  const seen = [];
  const spaced = w('C:', 'Program Files', 'repo');
  await launchWorker(
    getBuilder('codex'),
    { cwd: spaced, promptText: 'x', attemptDir: w('C:', 'a b') },
    {
      resolveFn: () => ({ command: 'codex', shell: true }),
      spawnFn: (command, args, options) => { seen.push({ command, args, options }); return stubChild(); },
    },
  );
  assert.equal(seen[0].options.shell, true);
  assert.ok(
    seen[0].args.includes(`"${spaced}"`),
    'a shell launch joins argv into one string, so spaces must stay quoted',
  );
});

test('probing a builder for availability cannot open a window either', () => {
  const calls = [];
  const codex = BUILDERS.find((builder) => builder.id === 'codex');
  detectBuilder(codex, {
    resolveFn: () => ({ command: w('C:', 'bin', 'codex.exe'), shell: false }),
    run: (command, args, options) => { calls.push({ command, options }); return { status: 0 }; },
  });
  assert.equal(calls[0].command, w('C:', 'bin', 'codex.exe'));
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
});
