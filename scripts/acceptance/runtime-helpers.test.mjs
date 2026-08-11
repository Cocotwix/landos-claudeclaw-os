import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  createAcceptanceRunDirectory,
  loopbackBaseUrl,
  resolveApprovedAuth,
  safeUrlPath,
  sanitizeConsoleText,
} from './runtime-helpers.mjs';

test('console and network capture helpers redact secrets and remove URL queries', () => {
  assert.equal(sanitizeConsoleText('Authorization: Bearer abc.def.ghi token=private'), 'Authorization: [REDACTED] token=[REDACTED]');
  assert.equal(safeUrlPath('http://localhost:3141/api/example?token=secret#fragment'), '/api/example');
});

test('live base URLs are restricted to credential-free loopback HTTP', () => {
  assert.equal(loopbackBaseUrl('http://localhost:3141/api?x=1'), 'http://localhost:3141');
  assert.throws(() => loopbackBaseUrl('https://example.com'), /loopback/);
  assert.throws(() => loopbackBaseUrl('http://user:pass@localhost:3141'), /credential-free/);
});

test('single-use visual-ready connect URL is accepted without persisting storage state', async () => {
  const auth = await resolveApprovedAuth({
    repositoryRoot: resolve('.'),
    mode: 'live',
    environment: { LANDOS_ACCEPTANCE_CONNECT_URL: 'http://127.0.0.1:3141/connect?visualReady=1&returnTo=%2Fdept%2Facquisitions' },
  });
  assert.equal(auth.method, 'single-use-visual-ready');
  assert.equal(auth.imported, false);
  assert.equal(auth.storageState, undefined);
});

test('auth state requires approval and must be external to the repository', async () => {
  const repositoryRoot = resolve('.');
  await assert.rejects(
    resolveApprovedAuth({ repositoryRoot, mode: 'live', environment: { LANDOS_ACCEPTANCE_AUTH_STATE: join(repositoryRoot, 'state.json'), LANDOS_ACCEPTANCE_AUTH_STATE_APPROVED: '1' } }),
    /outside the repository/,
  );
  await assert.rejects(
    resolveApprovedAuth({ repositoryRoot, mode: 'live', environment: { LANDOS_ACCEPTANCE_AUTH_STATE: 'C:\\tmp\\state.json' } }),
    /requires LANDOS_ACCEPTANCE_AUTH_STATE_APPROVED=1/,
  );
});

test('run directories are bounded children of .landos/acceptance', async () => {
  const root = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(join(tmpdir(), 'landos-run-directory-')));
  try {
    await mkdir(join(root, '.landos', 'acceptance'), { recursive: true });
    const target = join(root, '.landos', 'acceptance', 'explicit-run');
    assert.equal(await createAcceptanceRunDirectory(root, 'sprint', target), target);
    await assert.rejects(createAcceptanceRunDirectory(root, 'sprint', join(root, 'outside')), /must be a new child/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('external approved storage state is validated without copying or reporting its path', async () => {
  const root = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(join(tmpdir(), 'landos-auth-state-')));
  try {
    const repositoryRoot = join(root, 'repo');
    const state = join(root, 'approved-state.json');
    await mkdir(repositoryRoot);
    await writeFile(state, '{"cookies":[],"origins":[]}');
    const auth = await resolveApprovedAuth({ repositoryRoot, mode: 'live', environment: { LANDOS_ACCEPTANCE_AUTH_STATE: state, LANDOS_ACCEPTANCE_AUTH_STATE_APPROVED: '1' } });
    assert.equal(auth.imported, true);
    assert.equal(auth.method, 'approved-external-storage-state');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
