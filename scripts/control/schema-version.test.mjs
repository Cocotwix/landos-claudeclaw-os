import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTask, initializeControlState, SCHEMA_VERSION } from './control-state.mjs';

const CURRENT_CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'landos-control.mjs');
const OLD_CLIENT_COMMIT = '8f4f431b794ddd4dfd361995cfffdf82a36bb7b9';

function runGit(dir, ...args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function fixtureRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'landos-schema-version-'));
  runGit(dir, 'init', '-q', '-b', 'main');
  runGit(dir, 'config', 'user.email', 'control@example.com');
  runGit(dir, 'config', 'user.name', 'Control Spine');
  writeFileSync(path.join(dir, '.gitignore'), '*.db\n*.db-wal\n*.db-shm\n.landos/STATE.md\n');
  writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  runGit(dir, 'add', '.');
  runGit(dir, 'commit', '-q', '-m', 'base');
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function fileSnapshot(file) {
  const files = [file, `${file}-wal`, `${file}-shm`].filter((candidate) => existsSync(candidate));
  return files.map((candidate) => {
    const bytes = readFileSync(candidate);
    const stats = statSync(candidate);
    return {
      path: path.basename(candidate),
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  });
}

function archivedOldClient(root) {
  mkdirSync(path.join(root, '.runtime'), { recursive: true });
  const fixtureRoot = mkdtempSync(path.join(root, '.runtime', 'old-control-client-'));
  const files = [
    'scripts/control/landos-control.mjs',
    'scripts/control/control-state.mjs',
    'scripts/control/builder-adapter.mjs',
    'scripts/control/context-pack.mjs',
    'scripts/control/verification-plan.mjs',
    'scripts/control/resource-ownership.mjs',
    'scripts/dev/providers.mjs',
    'scripts/dev/verify.mjs',
    'scripts/dev/dirty-scope-report.mjs',
    'scripts/dev/env-guard.mjs',
    'scripts/devloop/diagnose.mjs',
  ];
  for (const relative of files) {
    const result = spawnSync('git', ['show', `${OLD_CLIENT_COMMIT}:${relative}`], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0, `cannot reconstruct ${relative}: ${result.stderr}`);
    const output = path.join(fixtureRoot, relative);
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, result.stdout);
  }
  writeFileSync(path.join(fixtureRoot, 'package.json'), JSON.stringify({ type: 'module' }));
  const controlSource = readFileSync(path.join(fixtureRoot, 'scripts/control/control-state.mjs'), 'utf8');
  assert.match(controlSource, /SCHEMA_VERSION = 7/);
  return {
    cli: path.join(fixtureRoot, 'scripts/control/landos-control.mjs'),
    cleanup: () => rmSync(fixtureRoot, { recursive: true, force: true }),
  };
}

test('current status is byte-pure and the archived schema-7 client cannot downgrade the current shared DB', (t) => {
  const repo = fixtureRepo();
  const currentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const old = archivedOldClient(currentRoot);
  t.after(() => { old.cleanup(); repo.cleanup(); });

  const state = initializeControlState(repo.dir);
  createTask(state.db, {
    id: 'schema-safety',
    title: 'Schema safety',
    outcome: 'Old clients cannot mutate current control state.',
    nextAction: 'Run compatibility proof.',
  });
  const dbPath = state.file;
  assert.equal(state.db.prepare("SELECT value FROM control_meta WHERE key = 'schema_version'").get().value, String(SCHEMA_VERSION));
  state.close();

  const beforeCurrentStatus = fileSnapshot(dbPath);
  const current = spawnSync(process.execPath, [CURRENT_CLI, 'status', '--root', repo.dir, '--db', dbPath, '--json'], {
    cwd: repo.dir,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(current.status, 0, current.stderr);
  assert.deepEqual(fileSnapshot(dbPath), beforeCurrentStatus);

  const beforeOld = fileSnapshot(dbPath);
  const refused = spawnSync(process.execPath, [old.cli, 'status', '--root', repo.dir, '--db', dbPath, '--json'], {
    cwd: repo.dir,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /readonly|read-only|schema version cannot be downgraded|newer than this client/i);
  assert.deepEqual(fileSnapshot(dbPath), beforeOld);

  const after = initializeControlState(repo.dir, { dbPath });
  assert.equal(after.db.prepare("SELECT value FROM control_meta WHERE key = 'schema_version'").get().value, String(SCHEMA_VERSION));
  assert.equal(after.db.pragma('integrity_check', { simple: true }), 'ok');
  after.close();
});
