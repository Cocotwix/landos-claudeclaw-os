#!/usr/bin/env node
// Secret-file immutability and least-privilege reads.
//
// Every fixture below uses obviously fake values in a throwaway directory. No
// test reads, writes, or asserts against the real repository `.env`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isSecretPath, secretFiles, secretState, secretMutations, readNamedVariable, isConfigured } from './env-guard.mjs';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'env-guard.mjs');

function sandbox() {
  const dir = mkdtempSync(path.join(tmpdir(), 'landos-secrets-'));
  writeFileSync(path.join(dir, '.env'), 'ALPHA=one\nBETA="two"\n# comment\nEMPTY=\n');
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('secret files are recognised, templates and ordinary source are not', () => {
  for (const secret of ['.env', '.env.local', '.env.production', 'server.pem', 'client.key', 'id_ed25519', '.netrc', 'secrets/anything.json']) {
    assert.equal(isSecretPath(secret), true, `${secret} should be a secret`);
  }
  for (const ordinary of ['.env.example', '.env.template', 'src/landos/env.ts', 'src/env.test.ts', 'docs/keys.md']) {
    assert.equal(isSecretPath(ordinary), false, `${ordinary} should not be a secret`);
  }
});

test('the secret scan finds root and secrets/ files', () => {
  const box = sandbox();
  try {
    writeFileSync(path.join(box.dir, '.env.example'), 'ALPHA=\n');
    mkdirSync(path.join(box.dir, 'secrets'));
    writeFileSync(path.join(box.dir, 'secrets/service.json'), '{}');
    assert.deepEqual(secretFiles(box.dir), ['.env', 'secrets/service.json']);
  } finally {
    box.cleanup();
  }
});

test('rewriting a secret file is a mutation', () => {
  const box = sandbox();
  try {
    const before = secretState(box.dir);
    writeFileSync(path.join(box.dir, '.env'), 'ALPHA=changed\n');
    assert.deepEqual(secretMutations(before, secretState(box.dir)), [{ path: '.env', change: 'modified' }]);
  } finally {
    box.cleanup();
  }
});

test('deleting and creating a secret file are both mutations', () => {
  const box = sandbox();
  try {
    const before = secretState(box.dir);
    unlinkSync(path.join(box.dir, '.env'));
    writeFileSync(path.join(box.dir, '.env.local'), 'GAMMA=three\n');
    assert.deepEqual(secretMutations(before, secretState(box.dir)), [
      { path: '.env', change: 'deleted' },
      { path: '.env.local', change: 'created' },
    ]);
  } finally {
    box.cleanup();
  }
});

test('reading a secret file is not a mutation', () => {
  const box = sandbox();
  try {
    const before = secretState(box.dir);
    // Access time moves; content does not. The invariant is content.
    readFileSync(path.join(box.dir, '.env'), 'utf8');
    readNamedVariable(box.dir, 'ALPHA');
    isConfigured(box.dir, 'BETA');
    assert.deepEqual(secretMutations(before, secretState(box.dir)), []);
  } finally {
    box.cleanup();
  }
});

test('a mutation report carries the path and the kind of change, and nothing else', () => {
  const box = sandbox();
  try {
    const before = secretState(box.dir);
    writeFileSync(path.join(box.dir, '.env'), 'ALPHA=super-secret-value\n');
    const [mutation] = secretMutations(before, secretState(box.dir));
    assert.deepEqual(Object.keys(mutation).sort(), ['change', 'path']);
    assert.ok(!JSON.stringify(mutation).includes('super-secret-value'));
    // Not even the fingerprint escapes.
    assert.ok(!JSON.stringify(mutation).includes(before['.env']));
  } finally {
    box.cleanup();
  }
});

test('one named variable is returned, never the whole file', () => {
  const box = sandbox();
  try {
    assert.equal(readNamedVariable(box.dir, 'ALPHA'), 'one');
    assert.equal(readNamedVariable(box.dir, 'BETA'), 'two');
    assert.equal(readNamedVariable(box.dir, 'EMPTY'), null);
    assert.equal(readNamedVariable(box.dir, 'ABSENT'), null);
    assert.equal(isConfigured(box.dir, 'ALPHA'), true);
    assert.equal(isConfigured(box.dir, 'ABSENT'), false);
  } finally {
    box.cleanup();
  }
});

test('the last definition wins, as dotenv does', () => {
  const box = sandbox();
  try {
    writeFileSync(path.join(box.dir, '.env'), 'ALPHA=first\nexport ALPHA=second\n');
    assert.equal(readNamedVariable(box.dir, 'ALPHA'), 'second');
  } finally {
    box.cleanup();
  }
});

test('status answers with a word and never the value', () => {
  const box = sandbox();
  try {
    const present = spawnSync(process.execPath, [CLI, 'status', 'ALPHA'], { cwd: box.dir, encoding: 'utf8' });
    assert.equal(present.status, 0);
    assert.match(present.stdout, /ALPHA: configured/);
    assert.ok(!`${present.stdout}${present.stderr}`.includes('one'));

    const absent = spawnSync(process.execPath, [CLI, 'status', 'ABSENT'], { cwd: box.dir, encoding: 'utf8' });
    assert.equal(absent.status, 1);
    assert.match(absent.stdout, /ABSENT: not configured/);
  } finally {
    box.cleanup();
  }
});

test('run hands one variable to the child process and prints nothing itself', () => {
  const box = sandbox();
  try {
    writeFileSync(
      path.join(box.dir, 'child.mjs'),
      'process.stdout.write(`${process.env.ALPHA === "one"}:${process.env.BETA ?? "unset"}`);\n',
    );
    const result = spawnSync(process.execPath, [CLI, 'run', 'ALPHA', '--', process.execPath, 'child.mjs'], {
      cwd: box.dir,
      encoding: 'utf8',
    });
    // The child saw ALPHA. It did not receive BETA, and the wrapper printed no value.
    assert.equal(result.stdout.trim(), 'true:unset');
    assert.ok(!result.stderr.includes('one'));
  } finally {
    box.cleanup();
  }
});

test('the CLI refuses to do anything without a named variable', () => {
  const box = sandbox();
  try {
    const bare = spawnSync(process.execPath, [CLI], { cwd: box.dir, encoding: 'utf8' });
    assert.equal(bare.status, 2);
    assert.match(bare.stderr, /read only/);
    // The usage text must not tempt anyone into dumping the file.
    assert.ok(!/cat |printenv|process\.env\b\s*\)/.test(bare.stderr));
  } finally {
    box.cleanup();
  }
});
