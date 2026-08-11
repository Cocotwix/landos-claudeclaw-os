#!/usr/bin/env node
// Seed a dev-loop run worktree with the primary worktree's UNCOMMITTED state.
//
// The loop creates its run worktree detached at HEAD. That is correct isolation,
// but LandOS's real state is routinely far ahead of HEAD: nothing is committed
// without Tyler's authorization, so a builder working from HEAD would repair
// code the operator no longer runs and produce a patch that will not apply.
//
// This makes the run worktree an exact working copy of the primary: every file
// git tracks plus every untracked, non-ignored file, copied byte for byte, and
// anything the primary has deleted removed there too. Copying the tracked files
// as well as the dirty ones matters — a fresh checkout normalizes line endings,
// so a diff-only copy still leaves hundreds of files differing from the tree
// Tyler actually runs.
//
// It never touches the primary, never commits, and never copies anything git
// ignores, so .env, secrets, store/*.db, logs and .runtime stay where they are.
//
// Run it BETWEEN run creation and the first attempt:
//   npm run landos:devloop -- start <spec> --max-attempts 0
//   node scripts/devloop/seed-worktree.mjs <runId>
//   npm run landos:devloop -- resume <runId> --max-attempts 3
//
// Containment is unaffected: the evaluator measures changed paths against the
// snapshot taken immediately before each attempt, so seeded files belong to the
// seeder, not to the builder.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { loadRun } from './run-state.mjs';
import { parseGitStatus } from './evaluator.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function gitStatus(root) {
  const result = spawnSync('git', ['status', '--short', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`git status failed in ${root}: ${result.stderr}`);
  return String(result.stdout ?? '');
}

/** Paths the primary has deleted, so the worktree must delete them too. */
function deletedPaths(statusText) {
  return statusText
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .filter((line) => /^( D|D |DD|AD)/.test(line))
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

const runId = process.argv[2];
if (!runId) {
  console.error('Usage: node scripts/devloop/seed-worktree.mjs <runId>');
  process.exit(2);
}

const { run } = loadRun(ROOT, runId);
const workspace = run.worktree ? path.resolve(ROOT, run.worktree) : null;
if (!workspace || !existsSync(workspace)) {
  console.error(`Run ${runId} has no worktree at ${run.worktree ?? '(unset)'}.`);
  process.exit(2);
}
if (path.resolve(workspace) === path.resolve(ROOT)) {
  console.error('Refusing to seed: the resolved workspace is the primary worktree.');
  process.exit(2);
}
if (run.attempts?.length) {
  console.error(`Refusing to seed: run ${runId} already has ${run.attempts.length} attempt(s). Seed before attempt 1.`);
  process.exit(2);
}

function gitList(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${root}: ${result.stderr}`);
  return String(result.stdout ?? '').split(/\r?\n/).filter(Boolean).map((line) => line.replace(/^"|"$/g, ''));
}

const statusText = gitStatus(ROOT);
const deleted = new Set(deletedPaths(statusText));
const candidates = [...new Set([
  // Everything git tracks, so the copy is exact rather than diff-only.
  ...gitList(ROOT, ['ls-files']),
  // Plus every untracked file git does not ignore. Ignored paths (.env, secrets,
  // store/*.db, logs, .runtime) are deliberately left behind.
  ...gitList(ROOT, ['ls-files', '--others', '--exclude-standard']),
  ...parseGitStatus(statusText),
])].filter((target) => !target.endsWith('/'));

let copied = 0;
let removed = 0;
let skipped = 0;

for (const target of candidates) {
  const source = path.join(ROOT, target);
  const destination = path.join(workspace, target);

  if (deleted.has(target) || !existsSync(source)) {
    if (existsSync(destination)) {
      rmSync(destination, { force: true });
      removed += 1;
    }
    continue;
  }
  let info;
  try {
    info = statSync(source);
  } catch {
    skipped += 1;
    continue;
  }
  if (!info.isFile()) { skipped += 1; continue; }

  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  copied += 1;
}

console.log(`seeded ${path.relative(ROOT, workspace)} from the primary worktree`);
console.log(`  copied ${copied} file(s) — an exact working copy, tracked and untracked`);
console.log(`  removed ${removed} path(s) the primary has deleted`);
if (skipped) console.log(`  skipped ${skipped} non-file entr(y/ies)`);
console.log('  the primary worktree was not modified');
