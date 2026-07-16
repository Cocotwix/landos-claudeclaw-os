import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ENTRY,
  ROOT,
  historyAssociation,
  httpProbe,
  logTail,
  metadataAssociation,
  metadataDisposition,
  nextHistory,
  operationLockDisposition,
  processStartMatches,
  quote,
  samePath,
  sanitizeEnvironment,
  startDecision,
} from './landos-runtime.mjs';

test('samePath handles Windows case and separators', () => {
  assert.equal(samePath('C:\\Repo\\dist\\index.js', 'c:/repo/dist/index.js'), true);
  assert.equal(samePath('C:\\Repo\\dist\\index.js', 'C:\\Other\\dist\\index.js'), false);
});

test('process start matching rejects PID reuse', () => {
  assert.equal(processStartMatches('2026-07-12T12:00:00.000Z', '2026-07-12T12:00:03.000Z'), true);
  assert.equal(processStartMatches('2026-07-12T12:00:00.000Z', '2026-07-12T12:01:00.000Z'), false);
});

test('environment sanitizer deduplicates PATH casing and keeps useful entries', () => {
  const result = sanitizeEnvironment('runtime-123', {
    PATH: 'C:\\Tools;C:\\Windows\\System32',
    Path: 'C:\\MoreTools;C:\\Tools',
    SystemRoot: 'C:\\Windows',
    TEMP: 'C:\\Temp',
  });
  assert.deepEqual(Object.keys(result).filter((key) => key.toUpperCase() === 'PATH'), ['Path']);
  assert.match(result.Path, /C:\\Tools/iu);
  assert.match(result.Path, /C:\\MoreTools/iu);
  assert.equal(result.LANDOS_RUNTIME_ID, 'runtime-123');
  assert.equal(result.LANDOS_RUNTIME_ROOT.toLowerCase().endsWith('claudeclaw-os'), true);
});

test('metadata association requires repository-specific executable, entry, root, PID, and start time', () => {
  const start = '2026-07-12T12:00:00.000Z';
  const metadata = {
    schema: 1,
    pid: 42,
    processStartTime: start,
    repoRoot: ROOT,
    entryPoint: ENTRY,
    executable: process.execPath,
  };
  const info = { alive: true, pid: 42, startTime: start };
  assert.equal(metadataAssociation(metadata, info), true);
  assert.equal(metadataAssociation({ ...metadata, entryPoint: 'C:\\other\\dist\\index.js' }, info), false);
  assert.equal(metadataAssociation(metadata, { ...info, startTime: '2026-07-12T12:05:00.000Z' }), false);
});

test('metadata disposition distinguishes stale data from denied inspection', () => {
  const metadata = { schema: 1, pid: 42, processStartTime: '2026-07-12T12:00:00.000Z', repoRoot: ROOT, entryPoint: ENTRY, executable: process.execPath };
  assert.equal(metadataDisposition(metadata, { alive: true, pid: 42, startTime: '2026-07-12T12:10:00.000Z' }), 'stale');
  assert.equal(metadataDisposition(metadata, { alive: false, pid: 42, inspectionFailed: true }), 'unknown');
  assert.equal(metadataDisposition(null, null), 'none');
});

test('history association rejects unrelated executables and legacy unscoped records', () => {
  const start = '2026-07-12T12:00:00.000Z';
  const item = { schema: 1, pid: 42, processStartTime: start, repoRoot: ROOT, entryPoint: ENTRY, executable: process.execPath };
  const info = { alive: true, pid: 42, startTime: start };
  assert.equal(historyAssociation(item, info), true);
  assert.equal(historyAssociation({ ...item, executable: 'C:\\Windows\\notepad.exe' }, info), false);
  assert.equal(historyAssociation({ pid: 42, processStartTime: start }, info), false);
});

test('runtime history is repository-scoped, deduplicated, and capped', () => {
  const existing = Array.from({ length: 25 }, (_, index) => ({ runtimeId: `old-${index}`, pid: index + 1 }));
  const metadata = {
    pid: 99, processStartTime: '2026-07-12T12:00:00.000Z', runtimeId: 'new',
    repoRoot: ROOT, entryPoint: ENTRY, executable: process.execPath, command: 'node', startedAt: '2026-07-12T12:00:01.000Z',
  };
  const result = nextHistory(existing, metadata);
  assert.equal(result.length, 20);
  assert.equal(result.at(-1).runtimeId, 'new');
  assert.equal(result.at(-1).repoRoot, ROOT);
  assert.equal(result.at(-1).schema, 1);
});

test('start decisions prevent duplicates and reject unrelated port owners', () => {
  const base = { inspectionErrors: [], verified: [], unrelatedPortOwners: [], rootProbe: { ok: false } };
  assert.deepEqual(startDecision(base), { action: 'launch' });
  assert.equal(startDecision({ ...base, unrelatedPortOwners: [777] }).action, 'error');
  assert.equal(startDecision({ ...base, inspectionErrors: ['EPERM'] }).action, 'error');
  assert.deepEqual(startDecision({
    ...base,
    rootProbe: { ok: true },
    verified: [{ pid: 42, ownsPort: true, healthVerified: true }],
  }), { action: 'already_running', pid: 42 });
});

test('operation lock recovery fails closed for fresh or uninspectable locks', () => {
  const now = Date.parse('2026-07-12T12:01:00.000Z');
  const current = { pid: 42, createdAt: '2026-07-12T12:00:30.000Z' };
  assert.equal(operationLockDisposition(current, { alive: true }, 30_000, now), 'active');
  assert.equal(operationLockDisposition(current, { alive: false }, 30_000, now), 'recover');
  assert.equal(operationLockDisposition(current, { alive: false, inspectionFailed: true }, 30_000, now), 'blocked_inspection');
  assert.equal(operationLockDisposition(null, { alive: false }, 30_000, now), 'active_unknown');
  assert.equal(operationLockDisposition(null, { alive: false }, 180_000, now), 'recover');
});

test('missing log files are safe and explicit', () => {
  const missing = path.join(os.tmpdir(), `landos-runtime-missing-${crypto.randomUUID()}.log`);
  assert.equal(logTail(missing), '(not created yet)');
});

test('HTTP probes abort within their explicit timeout', async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    const holdOpen = setTimeout(() => reject(new Error('test fetch exceeded safety ceiling')), 1_000);
    signal.addEventListener('abort', () => {
      clearTimeout(holdOpen);
      reject(new Error('aborted by test signal'));
    }, { once: true });
  });
  const started = Date.now();
  const result = await httpProbe('http://127.0.0.1:1', false, { timeoutMs: 25, fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.reason, /aborted/iu);
  assert.ok(Date.now() - started < 500);
});

test('command rendering quotes absolute paths with spaces', () => {
  assert.equal(quote('C:\\Program Files\\nodejs\\node.exe'), '"C:\\Program Files\\nodejs\\node.exe"');
  assert.equal(quote('--flag=value'), '--flag=value');
});
