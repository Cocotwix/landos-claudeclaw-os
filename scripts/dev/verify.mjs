#!/usr/bin/env node
// Deterministic verification for LandOS direct development.
//
// Two jobs: know exactly what changed, and decide whether it holds up by
// running commands. No model is asked whether the work succeeded, and no
// sign-off token from the builder is read. If a check exits non-zero, the run
// failed, and the exact failure travels back verbatim.
//
// The tree is routinely dirty with unrelated work. Change detection therefore
// content-hashes the paths git already reports and compares snapshots, rather
// than reading status letters: a builder editing a file that was already dirty
// is still detected, and nothing anyone else was working on is disturbed.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// Already-correct, side-effect-free utilities from the accepted baseline.
import { diagnoseFailure, formatDiagnosis } from '../devloop/diagnose.mjs';
import { summarizeDirtyScope } from './dirty-scope-report.mjs';
import { secretState, secretMutations, isSecretPath } from './env-guard.mjs';

const HASH_SIZE_LIMIT = 8 * 1024 * 1024;

export function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status };
}

/** `--untracked-files=all` so new files are listed individually, not as a directory. */
export function gitStatusText(cwd) {
  return git(['status', '--porcelain', '--untracked-files=all'], cwd).stdout;
}

export function headCommit(cwd) {
  return git(['rev-parse', '--short', 'HEAD'], cwd).stdout.trim() || null;
}

export function statusPaths(statusText) {
  const paths = [];
  for (const line of String(statusText).split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let rest = line.length > 3 && line[2] === ' ' ? line.slice(3) : line.trim();
    const arrow = rest.lastIndexOf(' -> ');
    if (arrow !== -1) rest = rest.slice(arrow + 4);
    rest = rest.trim().replace(/^"|"$/g, '').replace(/\\/g, '/');
    if (rest && !paths.includes(rest)) paths.push(rest);
  }
  return paths;
}

function fingerprint(cwd, relativePath) {
  const absolute = path.join(cwd, relativePath);
  try {
    const stats = statSync(absolute);
    if (!stats.isFile()) return null;
    if (stats.size > HASH_SIZE_LIMIT) return `size:${stats.size}:${stats.mtimeMs}`;
    return createHash('sha256').update(readFileSync(absolute)).digest('hex');
  } catch {
    return null;
  }
}

// The run writes its own trace, prompt, and logs under .runtime/. That is this
// tool's output, never the builder's change, and counting it would put the
// runner's own files into the diff, the scope exceptions, and the protected-path
// warning. LandOS gitignores .runtime/ so it stayed invisible until this ran
// against a repository that does not.
const NEVER_A_CHANGE = ['.runtime/'];

// A secret file is never an ordinary changed path. It is governed by the secret
// guard alone, so its name cannot reach a diff, a scope report, or a repair
// prompt, and nothing gets reported about it twice. LandOS gitignores `.env`, so
// this only shows up in a repository that does not.
function isOrdinaryChange(relativePath, ignore) {
  return !ignore.some((prefix) => relativePath.startsWith(prefix)) && !isSecretPath(relativePath);
}

/**
 * Capture enough of the tree to tell later what this run changed. Secret files
 * are fingerprinted separately: they are gitignored, so `git status` never
 * mentions them and `files` alone could never notice one being rewritten.
 */
export function snapshotTree(cwd, { statusText = gitStatusText(cwd), ignore = NEVER_A_CHANGE } = {}) {
  const files = {};
  for (const relativePath of statusPaths(statusText)) {
    if (!isOrdinaryChange(relativePath, ignore)) continue;
    files[relativePath] = fingerprint(cwd, relativePath);
  }
  return { at: Date.now(), head: headCommit(cwd), statusText, files, secrets: secretState(cwd) };
}

/** The set of paths currently considered part of a change, ignoring run artifacts. */
export function changeSignature(cwd, ignore = NEVER_A_CHANGE) {
  return statusPaths(gitStatusText(cwd))
    .filter((relativePath) => isOrdinaryChange(relativePath, ignore))
    .sort();
}

/** Paths whose content differs between two snapshots, in sorted order. */
export function changedPaths(before, after) {
  const seen = new Set([...Object.keys(before.files ?? {}), ...Object.keys(after.files ?? {})]);
  const changed = [];
  for (const relativePath of seen) {
    if ((before.files ?? {})[relativePath] !== (after.files ?? {})[relativePath]) changed.push(relativePath);
  }
  return changed.sort();
}

export function globToRegExp(glob) {
  let pattern = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*') {
      if (glob[index + 1] === '*') {
        pattern += '.*';
        index += 1;
        if (glob[index + 1] === '/') index += 1;
      } else {
        pattern += '[^/]*';
      }
    } else if (char === '?') pattern += '[^/]';
    else pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${pattern}$`);
}

/** Changed paths that fall outside the declared scope. Empty when none declared. */
export function scopeExceptions(paths, allowGlobs = []) {
  if (!allowGlobs.length) return [];
  const matchers = allowGlobs.map(globToRegExp);
  return paths.filter((candidate) => !matchers.some((matcher) => matcher.test(candidate)));
}

/** Secrets, credentials, local runtime state, and private business data. */
export function protectedTouched(paths) {
  return summarizeDirtyScope(paths.map((candidate) => `?? ${candidate}`).join('\n')).protectedPaths;
}

const VITEST_COLLECTED = /^(src|web\/src)\/.*\.tsx?$/;
const TEST_FILE = /\.test\.tsx?$/;
const VITEST_INCLUDE_FALLBACK = ['src/**/*.test.ts', 'web/src/**/*.test.ts'];

/**
 * The suites vitest will actually collect, read from the project's own config
 * rather than restated here. A test file outside `include` (a `.test.tsx`, say)
 * would make `vitest run <file>` match nothing and exit non-zero, reporting a
 * failure that does not exist.
 */
export function vitestIncludeGlobs(cwd = process.cwd()) {
  const configFile = ['vitest.config.ts', 'vitest.config.mjs', 'vitest.config.js']
    .map((name) => path.join(cwd, name))
    .find((candidate) => existsSync(candidate));
  if (!configFile) return VITEST_INCLUDE_FALLBACK;

  const declared = readFileSync(configFile, 'utf8').match(/\binclude\s*:\s*\[([^\]]*)\]/);
  const globs = declared ? [...declared[1].matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]) : [];
  return globs.length ? globs : VITEST_INCLUDE_FALLBACK;
}

/**
 * Decide which deterministic checks the change actually earns, using the
 * mechanisms already in the repository: vitest's own module graph for related
 * suites, project-wide tsc, and node --test for scripts.
 */
export function deriveChecks(paths, { cwd = process.cwd(), extra = [] } = {}) {
  const checks = [];
  const live = paths.filter((candidate) => existsSync(path.join(cwd, candidate)));

  const collects = vitestIncludeGlobs(cwd).map(globToRegExp);
  // A test file vitest cannot collect is neither a suite to run nor a source to
  // trace: `vitest related` on it would find nothing either. Typecheck still
  // covers it below.
  const changedSuites = live.filter((candidate) => collects.some((matcher) => matcher.test(candidate)));
  const changedSources = live.filter(
    (candidate) => VITEST_COLLECTED.test(candidate) && !TEST_FILE.test(candidate),
  );

  if (changedSuites.length) {
    checks.push({ id: 'vitest-changed-suites', command: `npx vitest run ${changedSuites.join(' ')}` });
  }
  if (changedSources.length) {
    checks.push({ id: 'vitest-related', command: `npx vitest related --run ${changedSources.join(' ')}` });
  }
  if (live.some((candidate) => /\.tsx?$/.test(candidate))) {
    checks.push({ id: 'typecheck', command: 'npx tsc --noEmit' });
  }

  const nodeSuites = new Set(live.filter((candidate) => candidate.endsWith('.test.mjs')));
  for (const candidate of live) {
    if (!candidate.endsWith('.mjs') || candidate.endsWith('.test.mjs')) continue;
    const sibling = candidate.replace(/\.mjs$/, '.test.mjs');
    if (existsSync(path.join(cwd, sibling))) nodeSuites.add(sibling);
  }
  if (nodeSuites.size) {
    checks.push({ id: 'node-test', command: `node --test ${[...nodeSuites].sort().join(' ')}` });
  }

  for (const [index, command] of extra.entries()) {
    checks.push({ id: `requested-${index + 1}`, command });
  }
  return checks;
}

export function runCheck(check, cwd, { spawnFn = spawn } = {}) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawnFn(check.command, { cwd, shell: true, windowsHide: true });
    let output = '';
    const append = (chunk) => {
      if (output.length < 2 * 1024 * 1024) output += chunk.toString();
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', (error) => {
      resolve({ ...check, exitCode: null, ok: false, durationMs: Date.now() - startedAt, output: String(error) });
    });
    child.on('close', (exitCode) => {
      resolve({ ...check, exitCode, ok: exitCode === 0, durationMs: Date.now() - startedAt, output });
    });
  });
}

/** Checks are independent processes, so elapsed time is the slowest one. */
export function runChecks(checks, cwd, deps = {}) {
  return Promise.all(checks.map((check) => runCheck(check, cwd, deps)));
}

/** Exact, structured failure evidence for the one repair continuation. */
export function failureEvidence(results) {
  return results
    .filter((result) => !result.ok)
    .map((result) => {
      const diagnosis = diagnoseFailure(
        { id: result.id, kind: 'command', command: result.command, exitCode: result.exitCode },
        result.output,
      );
      return { id: result.id, command: result.command, exitCode: result.exitCode, diagnosis, text: formatDiagnosis(diagnosis) };
    });
}

/** Operator routes a changed dashboard page is reachable at, for UI review. */
export function routesForPaths(paths, cwd) {
  const appFile = path.join(cwd, 'web/src/App.tsx');
  const pages = paths
    .filter((candidate) => candidate.startsWith('web/src/pages/'))
    .map((candidate) => path.basename(candidate).replace(/\.tsx?$/, ''));
  if (!pages.length || !existsSync(appFile)) return [];

  const app = readFileSync(appFile, 'utf8');
  const routes = new Set();
  for (const match of app.matchAll(/<Route\s+path="([^"]+)"[^>]*>([\s\S]*?)<\/Route>/g)) {
    if (pages.some((page) => new RegExp(`\\b${page}\\b`).test(match[2]))) routes.add(match[1]);
  }
  return [...routes].sort();
}

/**
 * Full verification pass over one snapshot pair.
 *
 * A mutated secret file fails the run outright: no check result, no repair, and
 * no green. The report names the file and the kind of change and stops there,
 * because saying what changed inside `.env` would be the leak itself.
 */
export async function verify(before, after, { cwd, scope = [], extra = [] } = {}) {
  const paths = changedPaths(before, after);
  const secrets = secretMutations(before.secrets, after.secrets);
  const checks = deriveChecks(paths, { cwd, extra });
  const results = await runChecks(checks, cwd);
  const failures = failureEvidence(results);
  return {
    paths,
    checks: results,
    failures,
    secretMutations: secrets,
    passed: failures.length === 0 && secrets.length === 0,
    checksDerived: checks.length > 0,
    scopeExceptions: scopeExceptions(paths, scope),
    protectedPaths: protectedTouched(paths),
    routes: routesForPaths(paths, cwd),
  };
}
