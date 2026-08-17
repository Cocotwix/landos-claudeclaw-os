import test from 'node:test';
import assert from 'node:assert/strict';
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createTask, initializeControlState, startManagedAttempt } from './control-state.mjs';
import { acquireResource, inspectResources, normalizePhysicalResource, registerPrimaryResource, releaseResource } from './resource-ownership.mjs';

function git(dir, ...args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'landos-resource-'));
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'config', 'user.email', 'control@example.com'); git(dir, 'config', 'user.name', 'Control Spine');
  writeFileSync(path.join(dir, '.gitignore'), '*.db\n*.db-wal\n*.db-shm\n'); writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'base');
  const workspaces = [];
  return { dir, base: git(dir, 'rev-parse', 'HEAD'), workspaces, cleanup() { for (const workspace of workspaces) git(dir, 'worktree', 'remove', '--force', workspace); rmSync(dir, { recursive: true, force: true }); } };
}

function allocate(state, repo, id) {
  createTask(state.db, { id: `task-${id}`, title: id, outcome: `Resource ownership ${id}`, nextAction: 'Acquire governed resource.' });
  const workspacePath = `${repo.dir}-${id}`; repo.workspaces.push(workspacePath);
  return startManagedAttempt(state.db, repo.dir, {
    id: `attempt-${id}`, taskId: `task-${id}`, worker: 'codex', writerId: `writer-${id}`,
    workspaceId: `workspace-${id}`, workspacePath, branch: `task/${id}`, baseGitSha: repo.base, approach: 'Resource fixture.',
  });
}

test('physical identity normalization protects primary resources and safely governs alternatives', (t) => {
  const repo = fixture(); const state = initializeControlState(repo.dir); t.after(() => { state.close(); repo.cleanup(); });
  const first = allocate(state, repo, 'first'); const second = allocate(state, repo, 'second');
  const primary = inspectResources(state.db);
  assert.equal(primary.find((item) => item.resource_id === 'primary-runtime-port-3141').normalized_identity, 'network:tcp:local-host:3141');
  assert.equal(primary.find((item) => item.resource_id === 'primary-browser-cdp-9224').normalized_identity, 'network:tcp:local-host:9224');
  assert.match(primary.find((item) => item.resource_id === 'primary-browser-profile-landos').normalized_identity, /^filesystem:/);
  assert.equal(normalizePhysicalResource({ resourceType: 'runtime-port', endpoint: '3141' }).identity, normalizePhysicalResource({ resourceType: 'port', endpoint: 'http://localhost:3141' }).identity);
  assert.equal(normalizePhysicalResource({ resourceType: 'runtime-port', endpoint: '9224' }).identity, normalizePhysicalResource({ resourceType: 'browser-cdp', endpoint: 'http://localhost:9224' }).identity);
  assert.equal(normalizePhysicalResource({ resourceType: 'endpoint', endpoint: 'http://localhost:43141/' }).identity, normalizePhysicalResource({ resourceType: 'endpoint', endpoint: 'http://127.0.0.1:43141/' }).identity);
  assert.equal(normalizePhysicalResource({ resourceType: 'endpoint', endpoint: 'http://localhost:43141/' }).identity, normalizePhysicalResource({ resourceType: 'runtime', endpoint: 'http://127.0.0.1:43141/' }).identity);
  assert.equal(normalizePhysicalResource({ resourceType: 'database', endpoint: path.join(repo.dir, '.', 'candidate.db') }).identity, normalizePhysicalResource({ resourceType: 'database', endpoint: path.join(repo.dir, 'candidate.db') }).identity);

  assert.throws(() => registerPrimaryResource(state.db, { resourceId: 'primary-runtime-port-3141', resourceType: 'runtime-port', endpoint: '43141' }), /contradictory primary/i);
  assert.throws(() => acquireResource(state.db, { resourceId: 'alternate-port', resourceType: 'runtime-port', endpoint: 'http://localhost:3141', taskId: first.attempt.task_id, attemptId: first.attempt.id }), /protected primary runtime/i);
  assert.throws(() => acquireResource(state.db, { resourceId: 'alternate-cdp', resourceType: 'browser-cdp', endpoint: '9224', taskId: first.attempt.task_id, attemptId: first.attempt.id }), /protected primary runtime/i);
  const profile = primary.find((item) => item.resource_id === 'primary-browser-profile-landos');
  assert.throws(() => acquireResource(state.db, { resourceId: 'alternate-profile', resourceType: 'browser-profile', endpoint: profile.endpoint, taskId: first.attempt.task_id, attemptId: first.attempt.id }), /protected primary runtime/i);

  const candidate = acquireResource(state.db, { resourceId: 'candidate-port', resourceType: 'runtime-port', endpoint: '43141', taskId: first.attempt.task_id, attemptId: first.attempt.id });
  assert.equal(candidate.status, 'ACTIVE');
  assert.throws(() => acquireResource(state.db, { resourceId: 'second-logical-port', resourceType: 'runtime-port', endpoint: 'http://127.0.0.1:43141', taskId: second.attempt.task_id, attemptId: second.attempt.id }), /actively owned/i);
  assert.throws(() => acquireResource(state.db, { resourceId: 'cross-type-port', resourceType: 'browser-cdp', endpoint: 'http://localhost:43141', taskId: second.attempt.task_id, attemptId: second.attempt.id }), /actively owned/i);
  assert.throws(() => releaseResource(state.db, { resourceId: candidate.resource_id, taskId: second.attempt.task_id, attemptId: second.attempt.id }), /does not own/i);
  assert.equal(releaseResource(state.db, { resourceId: candidate.resource_id, taskId: first.attempt.task_id, attemptId: first.attempt.id }).status, 'RELEASED');
  assert.throws(() => releaseResource(state.db, { resourceId: candidate.resource_id, taskId: first.attempt.task_id, attemptId: first.attempt.id }), /not actively acquired/i);
  assert.equal(acquireResource(state.db, { resourceId: 'second-candidate-port', resourceType: 'runtime-port', endpoint: '43141', taskId: second.attempt.task_id, attemptId: second.attempt.id }).status, 'ACTIVE');

  acquireResource(state.db, { resourceId: 'first-runtime-endpoint', resourceType: 'runtime', endpoint: 'http://localhost:43146', taskId: first.attempt.task_id, attemptId: first.attempt.id });
  assert.throws(() => acquireResource(state.db, { resourceId: 'second-endpoint-label', resourceType: 'endpoint', endpoint: 'http://127.0.0.1:43146/', taskId: second.attempt.task_id, attemptId: second.attempt.id }), /actively owned/i);
  releaseResource(state.db, { resourceId: 'first-runtime-endpoint', taskId: first.attempt.task_id, attemptId: first.attempt.id });

  for (const [type, endpoint] of [
    ['endpoint', 'http://localhost:43142/'],
    ['browser-cdp', '9225'],
    ['browser-profile', path.join(repo.dir, 'candidate-browser-profile')],
    ['database', path.join(repo.dir, 'candidate-control.db')],
    ['runtime', 'http://localhost:43143'],
  ]) {
    const resourceId = `first-${type}`;
    acquireResource(state.db, { resourceId, resourceType: type, endpoint, taskId: first.attempt.task_id, attemptId: first.attempt.id });
    assert.throws(() => acquireResource(state.db, { resourceId: `second-${type}`, resourceType: type, endpoint, taskId: second.attempt.task_id, attemptId: second.attempt.id }), /actively owned/i);
    assert.equal(releaseResource(state.db, { resourceId, taskId: first.attempt.task_id, attemptId: first.attempt.id }).status, 'RELEASED');
  }
  assert.ok(state.db.prepare("SELECT COUNT(*) AS count FROM managed_resource_event WHERE outcome = 'FAIL'").get().count >= 7);
});

test('filesystem aliases and future reservations collapse to one physical ownership identity', (t) => {
  const repo = fixture();
  const state = initializeControlState(repo.dir);
  t.after(() => { state.close(); repo.cleanup(); });
  const first = allocate(state, repo, 'alias-first');
  const second = allocate(state, repo, 'alias-second');

  const profileTarget = path.join(repo.dir, 'existing-profile');
  const profileJunction = path.join(repo.dir, 'profile-junction');
  mkdirSync(profileTarget);
  symlinkSync(profileTarget, profileJunction, 'junction');
  const targetProfile = normalizePhysicalResource({ resourceType: 'browser-profile', endpoint: profileTarget });
  const aliasProfile = normalizePhysicalResource({ resourceType: 'browser-profile', endpoint: profileJunction });
  assert.equal(aliasProfile.identity, targetProfile.identity);
  assert.equal(
    normalizePhysicalResource({ resourceType: 'browser-profile', endpoint: profileTarget.toUpperCase() }).identity,
    targetProfile.identity,
  );
  assert.equal(
    normalizePhysicalResource({ resourceType: 'browser-profile', endpoint: path.relative(process.cwd(), profileTarget) }).identity,
    targetProfile.identity,
  );
  assert.equal(
    normalizePhysicalResource({ resourceType: 'browser-profile', endpoint: profileTarget.replace(/\\/g, '/') }).identity,
    targetProfile.identity,
  );
  acquireResource(state.db, { resourceId: 'profile-target', resourceType: 'browser-profile', endpoint: profileTarget, taskId: first.attempt.task_id, attemptId: first.attempt.id });
  assert.throws(
    () => acquireResource(state.db, { resourceId: 'profile-alias', resourceType: 'browser-profile', endpoint: profileJunction, taskId: second.attempt.task_id, attemptId: second.attempt.id }),
    /actively owned/i,
  );

  const dbTarget = path.join(repo.dir, 'governed.db');
  const dbHardLink = path.join(repo.dir, 'governed-hardlink.db');
  writeFileSync(dbTarget, 'fixture database identity\n');
  linkSync(dbTarget, dbHardLink);
  assert.equal(
    normalizePhysicalResource({ resourceType: 'database', endpoint: dbTarget }).identity,
    normalizePhysicalResource({ resourceType: 'database', endpoint: dbHardLink }).identity,
  );
  acquireResource(state.db, { resourceId: 'db-target', resourceType: 'database', endpoint: dbTarget, taskId: first.attempt.task_id, attemptId: first.attempt.id });
  assert.throws(
    () => acquireResource(state.db, { resourceId: 'db-hardlink', resourceType: 'database', endpoint: dbHardLink, taskId: second.attempt.task_id, attemptId: second.attempt.id }),
    /actively owned/i,
  );

  const futureTarget = path.join(profileTarget, 'future', 'control.db');
  const futureAlias = path.join(profileJunction, 'future', 'control.db');
  assert.equal(
    normalizePhysicalResource({ resourceType: 'database', endpoint: futureTarget }).identity,
    normalizePhysicalResource({ resourceType: 'database', endpoint: futureAlias }).identity,
  );
  acquireResource(state.db, { resourceId: 'future-db', resourceType: 'database', endpoint: futureTarget, taskId: first.attempt.task_id, attemptId: first.attempt.id });
  mkdirSync(path.dirname(futureAlias), { recursive: true });
  writeFileSync(futureAlias, 'created after reservation\n');
  assert.throws(
    () => acquireResource(state.db, { resourceId: 'future-db-alias', resourceType: 'database', endpoint: futureAlias, taskId: second.attempt.task_id, attemptId: second.attempt.id }),
    /actively owned/i,
  );
});
