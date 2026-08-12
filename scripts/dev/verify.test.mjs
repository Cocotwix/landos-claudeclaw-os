#!/usr/bin/env node
// Unit tests for the deterministic verification layer. Nothing here launches a
// coding agent: these cover change detection, check derivation, scope, and the
// evidence that travels back on failure.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  statusPaths,
  snapshotTree,
  changedPaths,
  deriveChecks,
  scopeExceptions,
  protectedTouched,
  routesForPaths,
  failureEvidence,
  globToRegExp,
  vitestIncludeGlobs,
  verify,
} from './verify.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function tempRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'landos-verify-'));
  const run = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  run('init', '-q');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  writeFileSync(path.join(dir, 'kept.txt'), 'baseline\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'base');
  return { dir, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('statusPaths reads porcelain output including renames and quoting', () => {
  const text = [' M package.json', 'D  scripts/old.mjs', '?? scripts/dev/new.mjs', 'R  a.ts -> b.ts', '"weird path.ts"'].join('\n');
  assert.deepEqual(statusPaths(text), ['package.json', 'scripts/old.mjs', 'scripts/dev/new.mjs', 'b.ts', 'weird path.ts']);
});

test('an edit to an already-dirty file is detected, and untouched dirty work is not reported', () => {
  const repo = tempRepo();
  try {
    // Pre-existing unrelated dirty work, exactly like the real tree.
    writeFileSync(path.join(repo.dir, 'kept.txt'), 'someone elses work\n');
    writeFileSync(path.join(repo.dir, 'untracked.md'), 'also theirs\n');
    const before = snapshotTree(repo.dir);

    writeFileSync(path.join(repo.dir, 'kept.txt'), 'someone elses work\nplus the builders line\n');
    writeFileSync(path.join(repo.dir, 'brand-new.mjs'), 'export const x = 1;\n');
    const after = snapshotTree(repo.dir);

    assert.deepEqual(changedPaths(before, after), ['brand-new.mjs', 'kept.txt']);
    assert.ok(!changedPaths(before, after).includes('untracked.md'));
  } finally {
    repo.cleanup();
  }
});

test("the run's own artifacts under .runtime are never counted as the builder's change", () => {
  const repo = tempRepo();
  try {
    const before = snapshotTree(repo.dir);
    mkdirSync(path.join(repo.dir, '.runtime/dev/t-1'), { recursive: true });
    writeFileSync(path.join(repo.dir, '.runtime/dev/t-1/trace.jsonl'), '{"type":"run.start"}\n');
    writeFileSync(path.join(repo.dir, 'real-change.mjs'), 'export const x = 1;\n');

    assert.deepEqual(changedPaths(before, snapshotTree(repo.dir)), ['real-change.mjs']);
  } finally {
    repo.cleanup();
  }
});

test('an untouched tree produces no changed paths', () => {
  const repo = tempRepo();
  try {
    const before = snapshotTree(repo.dir);
    assert.deepEqual(changedPaths(before, snapshotTree(repo.dir)), []);
  } finally {
    repo.cleanup();
  }
});

test('checks are derived from what actually changed', () => {
  const repo = tempRepo();
  try {
    mkdirSync(path.join(repo.dir, 'src/landos'), { recursive: true });
    mkdirSync(path.join(repo.dir, 'scripts/dev'), { recursive: true });
    writeFileSync(path.join(repo.dir, 'src/landos/acreage.ts'), '');
    writeFileSync(path.join(repo.dir, 'src/landos/acreage.test.ts'), '');
    writeFileSync(path.join(repo.dir, 'scripts/dev/tool.mjs'), '');
    writeFileSync(path.join(repo.dir, 'scripts/dev/tool.test.mjs'), '');

    const checks = deriveChecks(
      ['src/landos/acreage.ts', 'src/landos/acreage.test.ts', 'scripts/dev/tool.mjs'],
      { cwd: repo.dir },
    );
    const byId = Object.fromEntries(checks.map((check) => [check.id, check.command]));

    assert.equal(byId['vitest-changed-suites'], 'npx vitest run src/landos/acreage.test.ts');
    assert.equal(byId['vitest-related'], 'npx vitest related --run src/landos/acreage.ts');
    assert.equal(byId.typecheck, 'npx tsc --noEmit');
    // The changed .mjs has a sibling suite, so that suite is the check.
    assert.equal(byId['node-test'], 'node --test scripts/dev/tool.test.mjs');
  } finally {
    repo.cleanup();
  }
});

test('the collected suites come from the project vitest config, not a restatement', () => {
  assert.deepEqual(vitestIncludeGlobs(REPO_ROOT), ['src/**/*.test.ts', 'web/src/**/*.test.ts']);

  const repo = tempRepo();
  try {
    // No config: the known project include is the fallback, so derivation never
    // silently widens to every test file.
    assert.deepEqual(vitestIncludeGlobs(repo.dir), ['src/**/*.test.ts', 'web/src/**/*.test.ts']);
    writeFileSync(
      path.join(repo.dir, 'vitest.config.ts'),
      "export default { test: { include: ['src/**/*.spec.ts'], setupFiles: ['src/setup.ts'] } };\n",
    );
    assert.deepEqual(vitestIncludeGlobs(repo.dir), ['src/**/*.spec.ts']);
  } finally {
    repo.cleanup();
  }
});

test('a changed test file vitest cannot collect is never handed to vitest', () => {
  const repo = tempRepo();
  try {
    mkdirSync(path.join(repo.dir, 'web/src/pages'), { recursive: true });
    writeFileSync(path.join(repo.dir, 'web/src/pages/Thing.tsx'), '');
    writeFileSync(path.join(repo.dir, 'web/src/pages/Thing.test.tsx'), '');

    const byId = Object.fromEntries(
      deriveChecks(['web/src/pages/Thing.tsx', 'web/src/pages/Thing.test.tsx'], { cwd: repo.dir }).map(
        (check) => [check.id, check.command],
      ),
    );

    // `npx vitest run Thing.test.tsx` would match no collected file and exit
    // non-zero, reporting a failure that does not exist.
    assert.equal(byId['vitest-changed-suites'], undefined);
    assert.equal(byId['vitest-related'], 'npx vitest related --run web/src/pages/Thing.tsx');
    assert.ok(!(byId['vitest-related'] ?? '').includes('Thing.test.tsx'));
    // It is still real TypeScript, so it still has to typecheck.
    assert.equal(byId.typecheck, 'npx tsc --noEmit');
  } finally {
    repo.cleanup();
  }
});

test('a change with nothing to check derives nothing rather than inventing a pass', () => {
  const repo = tempRepo();
  try {
    writeFileSync(path.join(repo.dir, 'notes.md'), 'text');
    assert.deepEqual(deriveChecks(['notes.md'], { cwd: repo.dir }), []);
  } finally {
    repo.cleanup();
  }
});

test('requested checks from the packet are run verbatim and last', () => {
  const checks = deriveChecks([], { cwd: REPO_ROOT, extra: ['npm run landos:memory:audit'] });
  assert.deepEqual(checks, [{ id: 'requested-1', command: 'npm run landos:memory:audit' }]);
});

test('scope exceptions are reported only when scope was declared', () => {
  const paths = ['src/landos/a.ts', 'web/src/pages/Acquisitions.tsx', 'package.json'];
  assert.deepEqual(scopeExceptions(paths, []), []);
  assert.deepEqual(scopeExceptions(paths, ['src/landos/**']), ['web/src/pages/Acquisitions.tsx', 'package.json']);
  assert.deepEqual(scopeExceptions(paths, ['src/**', 'web/src/**', 'package.json']), []);
});

test('globToRegExp keeps * inside one segment and ** across segments', () => {
  assert.ok(globToRegExp('src/*.ts').test('src/a.ts'));
  assert.ok(!globToRegExp('src/*.ts').test('src/landos/a.ts'));
  assert.ok(globToRegExp('src/**/*.ts').test('src/landos/deep/a.ts'));
  assert.ok(globToRegExp('src/**').test('src/landos/a.ts'));
});

test('secrets, local runtime state, and private business data are flagged', () => {
  assert.deepEqual(protectedTouched(['src/landos/a.ts', '.env', 'store/landos.db', 'logs/main.log']).sort(), [
    '.env',
    'logs/main.log',
    'store/landos.db',
  ]);
  assert.deepEqual(protectedTouched(['src/landos/token-parser.ts']), []);
});

test('a changed dashboard page resolves to its real operator route', () => {
  assert.deepEqual(routesForPaths(['web/src/pages/Acquisitions.tsx'], REPO_ROOT), ['/dept/acquisitions']);
  assert.deepEqual(routesForPaths(['src/landos/acreage.ts'], REPO_ROOT), []);
});

test('failure evidence carries the file, test title, and the expected/received pair', () => {
  const output = [
    ' FAIL  src/landos/acreage.test.ts > rounds acreage to two places',
    'AssertionError: expected 10.13 to be 10.12',
    '- Expected',
    '+ Received',
    '',
    '- 10.12',
    '+ 10.13',
    '',
    ' ❯ src/landos/acreage.test.ts:14:22',
    'Tests  1 failed | 3 passed',
  ].join('\n');

  const [evidence] = failureEvidence([
    { id: 'vitest-related', command: 'npx vitest related --run src/landos/acreage.ts', exitCode: 1, ok: false, output },
  ]);

  assert.equal(evidence.diagnosis.failures[0].file, 'src/landos/acreage.test.ts');
  assert.equal(evidence.diagnosis.failures[0].title, 'rounds acreage to two places');
  assert.equal(evidence.diagnosis.failures[0].expected, '10.12');
  assert.equal(evidence.diagnosis.failures[0].received, '10.13');
  assert.match(evidence.text, /acreage\.test\.ts:14:22/);
});

test('a mutated secret file fails verification outright, with no contents in the result', async () => {
  const repo = tempRepo();
  try {
    writeFileSync(path.join(repo.dir, '.env'), 'ALPHA=one\n');
    const before = snapshotTree(repo.dir);
    writeFileSync(path.join(repo.dir, '.env'), 'ALPHA=two-and-very-secret\n');

    const result = await verify(before, snapshotTree(repo.dir), { cwd: repo.dir });

    // Nothing else changed and no check could fail, yet the run does not pass.
    assert.deepEqual(result.paths, []);
    assert.deepEqual(result.failures, []);
    assert.equal(result.passed, false);
    assert.deepEqual(result.secretMutations, [{ path: '.env', change: 'modified' }]);
    assert.ok(!JSON.stringify(result).includes('two-and-very-secret'));
    assert.ok(!JSON.stringify(result).includes('ALPHA'));
  } finally {
    repo.cleanup();
  }
});

test('an untouched secret file leaves verification free to pass', async () => {
  const repo = tempRepo();
  try {
    writeFileSync(path.join(repo.dir, '.env'), 'ALPHA=one\n');
    const before = snapshotTree(repo.dir);
    writeFileSync(path.join(repo.dir, 'notes.md'), 'ordinary work\n');

    const result = await verify(before, snapshotTree(repo.dir), { cwd: repo.dir });
    assert.deepEqual(result.secretMutations, []);
    assert.equal(result.passed, true);
  } finally {
    repo.cleanup();
  }
});

test('passing checks produce no failure evidence', () => {
  assert.deepEqual(failureEvidence([{ id: 'typecheck', command: 'npx tsc --noEmit', exitCode: 0, ok: true, output: '' }]), []);
});
