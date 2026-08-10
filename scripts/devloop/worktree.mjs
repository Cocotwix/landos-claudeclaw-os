#!/usr/bin/env node
// Per-run git worktree isolation for the LandOS Development Improvement Loop.
//
// Builders sometimes need unrestricted filesystem access to be useful, and one
// of them (Codex on this machine) has no working OS sandbox. So containment is
// preventive rather than forensic: every run gets its own detached git worktree
// checked out at HEAD, and every builder for that run works only inside it.
// Tyler's primary worktree, with all its uncommitted work, is never the cwd of
// any builder.
//
// This is ordinary `git worktree`, nothing more. The run worktree lives under
// the run's own state directory, which is gitignored, so it is invisible to the
// primary tree's status.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { runDir } from './run-state.mjs';

export function worktreePath(root, runId) {
  return path.join(runDir(root, runId), 'worktree');
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return {
    status: result.status ?? null,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? result.error?.message ?? ''),
  };
}

export function currentHead(root) {
  const result = git(root, ['rev-parse', 'HEAD']);
  if (result.status !== 0) throw new Error(`Could not read HEAD: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

// Dependencies are gitignored, so a fresh worktree has no node_modules and any
// acceptance command that needs one would fail. A run may opt into sharing the
// primary install through a link. It is off by default: a link is a writable
// path back into the primary checkout, and the whole point of this module is
// not to hand builders one of those unless the task actually needs it.
export function linkNodeModules(root, target) {
  const source = path.join(root, 'node_modules');
  const destination = path.join(target, 'node_modules');
  if (!existsSync(source) || existsSync(destination)) return false;
  const command =
    process.platform === 'win32'
      ? spawnSync('cmd', ['/d', '/s', '/c', 'mklink', '/J', destination, source], { encoding: 'utf8' })
      : spawnSync('ln', ['-s', source, destination], { encoding: 'utf8' });
  return (command.status ?? 1) === 0;
}

export function createRunWorktree(root, runId, { shareNodeModules = false } = {}) {
  const target = worktreePath(root, runId);
  if (existsSync(target)) throw new Error(`Run worktree already exists: ${target}`);
  mkdirSync(path.dirname(target), { recursive: true });
  const head = currentHead(root);
  const result = git(root, ['worktree', 'add', '--detach', target, head]);
  if (result.status !== 0) throw new Error(`git worktree add failed: ${result.stderr.trim()}`);
  const linked = shareNodeModules ? linkNodeModules(root, target) : false;
  return { path: target, head, nodeModulesLinked: linked };
}

// A junction or symlink must be unlinked, never recursed into. `node_modules`
// inside a run worktree can be a junction to the primary install, and a
// recursive delete that followed it would destroy the owner's dependencies.
export function unlinkJunctions(target) {
  const removed = [];
  if (!existsSync(target)) return removed;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (!entry.isSymbolicLink()) continue;
    const link = path.join(target, entry.name);
    // rmdir on Windows and unlink on POSIX both remove the link itself.
    const result =
      process.platform === 'win32'
        ? spawnSync('cmd', ['/d', '/s', '/c', 'rmdir', link], { encoding: 'utf8' })
        : spawnSync('rm', [link], { encoding: 'utf8' });
    if ((result.status ?? 1) === 0) removed.push(entry.name);
    else throw new Error(`Refusing to remove ${target}: could not unlink ${entry.name} (${result.stderr?.trim()})`);
  }
  return removed;
}

// Cleanup removes one run's disposable checkout and nothing else. Run history,
// frozen criteria, evaluator evidence, the accepted patch package and candidate
// lessons all stay where they are.
export function removeRunWorktree(root, runId) {
  const target = worktreePath(root, runId);
  const base = path.resolve(runDir(root, runId));
  const resolved = path.resolve(target);
  const repository = path.resolve(root);

  if (resolved === repository) throw new Error('Refusing to remove the primary LandOS worktree.');
  const relative = path.relative(base, resolved);
  if (relative !== 'worktree') throw new Error(`Refusing to remove ${resolved}: it is not run ${runId}'s own worktree.`);
  if (!existsSync(resolved)) return { removed: false, reason: 'no worktree present', junctions: [] };

  const registered = git(root, ['worktree', 'list', '--porcelain']).stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => path.resolve(line.slice('worktree '.length).trim()));
  if (!registered.includes(resolved)) {
    throw new Error(`Refusing to remove ${resolved}: git does not list it as a worktree of this repository.`);
  }

  const junctions = unlinkJunctions(resolved);
  const result = git(root, ['worktree', 'remove', '--force', resolved]);
  if (result.status !== 0) {
    // Only ever a last resort, and only after every link has been unlinked, so
    // the delete cannot escape the run directory.
    if (unlinkJunctions(resolved).length !== 0) throw new Error(`Refusing to force-delete ${resolved}: links remain.`);
    rmSync(resolved, { recursive: true, force: true });
    git(root, ['worktree', 'prune']);
  }
  return { removed: true, junctions, path: resolved };
}

// The isolation guarantee, checked rather than assumed. The primary worktree
// must not change while an attempt is in flight. The guard cannot tell who
// changed it, only that the isolation proof no longer holds for this attempt,
// so it stops rather than reporting a result it cannot stand behind.
export function assertPrimaryUnchanged(changedPaths, { runId, attemptNumber }) {
  if (!changedPaths?.length) return true;
  throw new Error(
    `Isolation broken during attempt ${attemptNumber} of run ${runId}: the primary worktree changed ` +
      `(${changedPaths.join(', ')}). A builder must only ever write inside the run worktree, and nothing else ` +
      'may edit the primary worktree while an attempt is running. Stopping the run; rerun it once the tree is quiet.',
  );
}
