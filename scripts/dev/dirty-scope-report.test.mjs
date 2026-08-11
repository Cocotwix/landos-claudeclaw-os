// Tests for the dirty-worktree scope report.
//
//   node --test scripts/dev/dirty-scope-report.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { summarizeDirtyScope } from './dirty-scope-report.mjs';

test('counts distinct changed paths and ignores blank lines', () => {
  const scope = summarizeDirtyScope([
    ' M src/dashboard.ts',
    '',
    '?? scripts/dev/dirty-scope-report.mjs',
    '   ',
    'A  package.json',
  ].join('\n'));

  assert.equal(scope.totalPaths, 3);
});

test('empty and non-string input yields an empty report', () => {
  for (const input of ['', '\n\n', null, undefined, 42]) {
    assert.deepEqual(summarizeDirtyScope(input), { totalPaths: 0, areas: [], protectedPaths: [] });
  }
});

test('groups paths by top-level directory, root files under (root)', () => {
  const scope = summarizeDirtyScope([
    ' M src/db.ts',
    ' M src/landos/deal-card.ts',
    ' M CLAUDE.md',
    '?? scripts/dev/dirty-scope-report.mjs',
  ].join('\n'));

  assert.deepEqual(scope.areas, [
    { area: 'src', count: 2 },
    { area: '(root)', count: 1 },
    { area: 'scripts', count: 1 },
  ]);
});

test('areas sort by count descending, then area name ascending', () => {
  const scope = summarizeDirtyScope([
    ' M zeta/a.ts',
    ' M zeta/b.ts',
    ' M alpha/a.ts',
    ' M alpha/b.ts',
    ' M mid/a.ts',
    ' M mid/b.ts',
    ' M mid/c.ts',
    ' M beta/a.ts',
  ].join('\n'));

  assert.deepEqual(scope.areas, [
    { area: 'mid', count: 3 },
    { area: 'alpha', count: 2 },
    { area: 'zeta', count: 2 },
    { area: 'beta', count: 1 },
  ]);
  assert.equal(scope.totalPaths, 8);
});

test('handles the porcelain status prefixes git actually prints', () => {
  const scope = summarizeDirtyScope([
    ' M src/a.ts',
    'M  src/b.ts',
    'MM src/c.ts',
    'A  src/d.ts',
    ' D src/e.ts',
    'AM src/f.ts',
    'UU src/g.ts',
    '?? src/h.ts',
    '!! src/i.ts',
  ].join('\n'));

  assert.equal(scope.totalPaths, 9);
  assert.deepEqual(scope.areas, [{ area: 'src', count: 9 }]);
});

test('rename and copy lines report the new path only', () => {
  const scope = summarizeDirtyScope([
    'R  scripts/old-name.mjs -> scripts/dev/new-name.mjs',
    'C  src/a.ts -> src/b.ts',
  ].join('\n'));

  assert.equal(scope.totalPaths, 2);
  assert.deepEqual(scope.areas, [
    { area: 'scripts', count: 1 },
    { area: 'src', count: 1 },
  ]);
  assert.deepEqual(
    summarizeDirtyScope('R  a/old.ts -> b/new.ts').areas,
    [{ area: 'b', count: 1 }],
  );
});

test('an arrow inside an untracked filename is not treated as a rename', () => {
  const scope = summarizeDirtyScope('?? notes/a -> b.txt');
  assert.deepEqual(scope.areas, [{ area: 'notes', count: 1 }]);
  assert.equal(scope.totalPaths, 1);
});

test('unquotes quoted paths, including escapes and octal bytes', () => {
  const scope = summarizeDirtyScope([
    ' M "src/with space/file.ts"',
    '?? "docs/caf\\303\\251.md"',
    'R  "src/old file.ts" -> "src/landos/new file.ts"',
  ].join('\n'));

  assert.equal(scope.totalPaths, 3);
  assert.deepEqual(scope.areas, [
    { area: 'src', count: 2 },
    { area: 'docs', count: 1 },
  ]);
  assert.deepEqual(
    summarizeDirtyScope('?? "docs/caf\\303\\251.md"').protectedPaths,
    [],
  );
});

test('normalises backslashes to forward slashes', () => {
  const scope = summarizeDirtyScope([
    ' M src\\landos\\db.ts',
    '?? scripts\\dev\\dirty-scope-report.mjs',
  ].join('\n'));

  assert.deepEqual(scope.areas, [
    { area: 'scripts', count: 1 },
    { area: 'src', count: 1 },
  ]);
});

test('deduplicates paths that appear on more than one status line', () => {
  const scope = summarizeDirtyScope([
    'M  src/a.ts',
    ' M src/a.ts',
    ' M src\\a.ts',
  ].join('\n'));

  assert.equal(scope.totalPaths, 1);
  assert.deepEqual(scope.areas, [{ area: 'src', count: 1 }]);
});

test('flags paths that must never be staged, sorted ascending', () => {
  const scope = summarizeDirtyScope([
    ' M src/dashboard.ts',
    ' M .env',
    '?? .env.local',
    '?? store/landos.db',
    '?? logs/main.log',
    '?? config/credentials.json',
    '?? certs/server.pem',
  ].join('\n'));

  assert.deepEqual(scope.protectedPaths, [
    '.env',
    '.env.local',
    'certs/server.pem',
    'config/credentials.json',
    'logs/main.log',
    'store/landos.db',
  ]);
  assert.equal(scope.totalPaths, 7);
});

test('protected paths are also counted in totals and areas', () => {
  const scope = summarizeDirtyScope([' M .env', ' M src/a.ts'].join('\n'));

  assert.equal(scope.totalPaths, 2);
  assert.deepEqual(scope.areas, [
    { area: '(root)', count: 1 },
    { area: 'src', count: 1 },
  ]);
  assert.deepEqual(scope.protectedPaths, ['.env']);
});

test('ordinary source files are not flagged as protected', () => {
  const scope = summarizeDirtyScope([
    ' M src/landos/db.ts',
    ' M src/store/index.ts',
    ' M src/landos/token-parser.ts',
    ' M .env.example',
    ' M docs/landos/secrets-policy.md',
    ' M package.json',
  ].join('\n'));

  assert.deepEqual(scope.protectedPaths, []);
});

test('a repository-root path with no directory lands in (root)', () => {
  const scope = summarizeDirtyScope('?? notes.md');
  assert.deepEqual(scope.areas, [{ area: '(root)', count: 1 }]);
  assert.deepEqual(scope.protectedPaths, []);
});

test('returns a plain shape with exactly the documented keys', () => {
  const scope = summarizeDirtyScope(' M src/a.ts');
  assert.deepEqual(Object.keys(scope).sort(), ['areas', 'protectedPaths', 'totalPaths']);
  assert.equal(typeof scope.totalPaths, 'number');
  assert.ok(Array.isArray(scope.areas));
  assert.ok(Array.isArray(scope.protectedPaths));
  assert.deepEqual(Object.keys(scope.areas[0]).sort(), ['area', 'count']);
});

test('importing the module has no side effects', async () => {
  const module = await import('./dirty-scope-report.mjs');
  assert.equal(typeof module.summarizeDirtyScope, 'function');
  assert.equal(module.summarizeDirtyScope.length, 1);
});

test('CLI prints area counts and exits zero when no protected path is dirty', () => {
  const result = runCli([
    ' M src/a.ts',
    ' M src/b.ts',
    '?? package.json',
  ].join('\n'));

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, ['src 2', '(root) 1', 'protected: 0', ''].join('\n'));
});

test('CLI reports protected count and exits one when a protected path is dirty', () => {
  const result = runCli([
    ' M .env',
    '?? logs/main.log',
    ' M src/a.ts',
  ].join('\n'));

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, [
    '(root) 1',
    'logs 1',
    'src 1',
    'protected: 2',
    '',
  ].join('\n'));
});

function runCli(input) {
  return spawnSync(process.execPath, [fileURLToPath(new URL('./dirty-scope-report.mjs', import.meta.url))], {
    input,
    encoding: 'utf8',
  });
}
