#!/usr/bin/env node
// Secret files are immutable to the direct builder, and secrets are read one
// named variable at a time.
//
// Two jobs, both deliberately small:
//
// 1. Fingerprint the repository's secret files before and after a builder run.
//    Any content change is a hard verification failure. `.env` is gitignored,
//    so it never appears in `git status` and the change-detection snapshot could
//    never see it: this is the only thing that can.
//
// 2. Answer "is this variable configured?" without putting a secret anywhere.
//    Nothing here ever prints a value, returns a parsed `.env`, writes one into
//    a trace, or hands one to an agent. The file is read inside this process to
//    answer a question about one named key, and the answer is a word.
//
//    node scripts/dev/env-guard.mjs status <NAME>        -> configured | not configured
//    node scripts/dev/env-guard.mjs run <NAME> -- <cmd>  -> runs cmd with that one
//                                                         variable in its env
//
// Fingerprints are sha256 and are compared in memory only. They are never
// printed, written to disk, or included in a result, because reporting a
// mutation must never expose what changed.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const SECRET_BASENAMES = new Set(['.netrc', '.npmrc', '.pgpass', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519']);
const SECRET_EXTENSIONS = ['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore'];
// `.env.example` and friends are checked-in templates, not secrets.
const ENV_TEMPLATE_SUFFIXES = new Set(['example', 'sample', 'template', 'dist', 'defaults']);
// Directories scanned in full, beyond the repository root.
const SECRET_DIRECTORIES = ['secrets'];

export function isSecretPath(relativePath) {
  const segments = String(relativePath).replace(/\\/g, '/').split('/').filter(Boolean);
  if (!segments.length) return false;
  if (segments.slice(0, -1).some((segment) => SECRET_DIRECTORIES.includes(segment.toLowerCase()))) return true;

  const basename = segments[segments.length - 1].toLowerCase();
  if (SECRET_BASENAMES.has(basename)) return true;
  if (SECRET_EXTENSIONS.some((extension) => basename.endsWith(extension))) return true;
  return isEnvFile(basename);
}

// Only `.env`, `.env.<something>`, and `<something>.env` count. Matching a bare
// `env.` prefix as well would classify `env.ts` and `env.test.ts` as secrets and
// freeze ordinary source.
function isEnvFile(basename) {
  if (basename === '.env') return true;
  if (!basename.startsWith('.env.') && !basename.endsWith('.env')) return false;
  return !basename.split('.').filter(Boolean).some((part) => ENV_TEMPLATE_SUFFIXES.has(part));
}

/** Secret files that exist right now: a shallow scan of the root plus `secrets/`. */
export function secretFiles(cwd) {
  const found = [];
  const scan = (relativeDirectory) => {
    const absolute = relativeDirectory ? path.join(cwd, relativeDirectory) : cwd;
    let entries;
    try {
      entries = readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (isSecretPath(relativePath)) found.push(relativePath);
    }
  };
  scan('');
  for (const directory of SECRET_DIRECTORIES) if (existsSync(path.join(cwd, directory))) scan(directory);
  return found.sort();
}

/**
 * Content fingerprints for every secret file, keyed by path. Reading a file
 * changes its access time and nothing else, so this observation is not itself
 * a mutation.
 */
export function secretState(cwd) {
  const state = {};
  for (const relativePath of secretFiles(cwd)) {
    try {
      const absolute = path.join(cwd, relativePath);
      state[relativePath] = `${statSync(absolute).size}:${createHash('sha256').update(readFileSync(absolute)).digest('hex')}`;
    } catch {
      state[relativePath] = 'unreadable';
    }
  }
  return state;
}

/**
 * Secret files whose content changed. The result carries the path and the kind
 * of change only: never a fingerprint, never a value, never a diff.
 */
export function secretMutations(before = {}, after = {}) {
  const mutations = [];
  for (const relativePath of new Set([...Object.keys(before), ...Object.keys(after)]).values()) {
    const had = Object.hasOwn(before, relativePath);
    const has = Object.hasOwn(after, relativePath);
    if (had && !has) mutations.push({ path: relativePath, change: 'deleted' });
    else if (!had && has) mutations.push({ path: relativePath, change: 'created' });
    else if (before[relativePath] !== after[relativePath]) mutations.push({ path: relativePath, change: 'modified' });
  }
  return mutations.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// --- least-privilege reads -------------------------------------------------

/**
 * The value of one named variable, or null. Only the requested key is ever
 * returned; the rest of the file is parsed and dropped. Callers that only need
 * to know whether it is set must use `isConfigured` instead.
 */
export function readNamedVariable(cwd, name, { file = '.env' } = {}) {
  if (typeof process.env[name] === 'string' && process.env[name] !== '') return process.env[name];
  const absolute = path.join(cwd, file);
  if (!existsSync(absolute)) return null;

  let value = null;
  for (const rawLine of readFileSync(absolute, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || match[1] !== name) continue;
    let candidate = match[2].trim();
    const quoted =
      (candidate.startsWith('"') && candidate.endsWith('"')) || (candidate.startsWith("'") && candidate.endsWith("'"));
    if (quoted && candidate.length >= 2) candidate = candidate.slice(1, -1);
    value = candidate; // last definition wins, as dotenv does
  }
  return value === '' ? null : value;
}

/** Whether one named variable is set, without the value going anywhere. */
export function isConfigured(cwd, name, options) {
  return readNamedVariable(cwd, name, options) !== null;
}

function shellQuote(argument) {
  return /[\s"]/.test(argument) ? `"${argument.replace(/"/g, '\\"')}"` : argument;
}

function main(argv) {
  const [command, name, ...rest] = argv;
  const cwd = process.cwd();

  if (command === 'status' && name) {
    const configured = isConfigured(cwd, name);
    process.stdout.write(`${name}: ${configured ? 'configured' : 'not configured'}\n`);
    process.exitCode = configured ? 0 : 1;
    return;
  }

  if (command === 'run' && name) {
    const separator = rest.indexOf('--');
    const argumentList = separator === -1 ? rest : rest.slice(separator + 1);
    if (!argumentList.length) {
      process.stderr.write('Usage: node scripts/dev/env-guard.mjs run <NAME> -- <command...>\n');
      process.exitCode = 2;
      return;
    }
    const value = readNamedVariable(cwd, name);
    if (value === null) {
      process.stderr.write(`${name}: not configured\n`);
      process.exitCode = 1;
      return;
    }
    // The value reaches the child process and nothing else: not stdout, not a
    // log, not an argument list.
    //
    // The command goes through a shell so `npm`, `npx`, and other Windows shims
    // resolve, which means the whole line has to be quoted here: with an args
    // array, Node quotes the arguments but not the executable, and any path
    // containing a space silently becomes two words.
    const result = spawnSync(argumentList.map(shellQuote).join(' '), {
      cwd,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, [name]: value },
    });
    process.exitCode = result.status ?? 1;
    return;
  }

  process.stderr.write(
    [
      'Secret files are read only. Never open, print, copy, or edit them.',
      '',
      '  node scripts/dev/env-guard.mjs status <NAME>       configured | not configured',
      '  node scripts/dev/env-guard.mjs run <NAME> -- <cmd> run <cmd> with that one variable',
      '',
    ].join('\n'),
  );
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
