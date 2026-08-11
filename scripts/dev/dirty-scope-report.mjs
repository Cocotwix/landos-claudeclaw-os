// Dirty-worktree scope report for LandOS development.
//
// Turns the raw text of `git status --short` into a compact breakdown: how many
// distinct paths changed, how those paths split across top-level areas, and
// which of them must never be staged (.env and friends, credentials, keys,
// logs, local runtime and store state).
//
// This module never shells out to git. It only parses text that is handed to
// it, so it is safe to import from tests and other tooling. Importing it has no
// side effects.
//
// Usage as a library:
//   import { summarizeDirtyScope } from './scripts/dev/dirty-scope-report.mjs';
//   const scope = summarizeDirtyScope(statusText);
//
// Usage as a filter:
//   git status --short | node scripts/dev/dirty-scope-report.mjs
//   git status --short | node scripts/dev/dirty-scope-report.mjs --json
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// Status letters git can print in the two porcelain columns, plus the blank
// column it uses when only one side of the index/worktree pair changed.
const STATUS_CHARS = ' MADRCUT?!';

const ROOT_AREA = '(root)';

// Basenames that are secrets on sight.
const PROTECTED_BASENAMES = new Set([
  '.env',
  '.netrc',
  '.npmrc',
  '.pgpass',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
]);

// Extensions that carry credentials, private business state, or noise that is
// never part of a reviewable change.
const PROTECTED_EXTENSIONS = [
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.jks',
  '.keystore',
  '.log',
  '.db',
  '.db-wal',
  '.db-shm',
  '.sqlite',
  '.sqlite3',
];

// Top-level directories that hold local runtime state, private business state,
// or noise. Only the first segment counts, so `src/store/index.ts` stays a
// normal source file.
const PROTECTED_ROOT_DIRECTORIES = new Set(['.runtime', '.venv', 'logs', 'store', 'venv']);

// Directories that are protected wherever they appear in the path.
const PROTECTED_ANY_DIRECTORIES = new Set(['node_modules', 'secrets']);

// Words that mark a file as a secret when they appear as a whole word in the
// basename. Source files are exempt so `token-parser.ts` stays reportable.
const PROTECTED_WORDS = new Set([
  'apikey',
  'credential',
  'credentials',
  'password',
  'passwords',
  'secret',
  'secrets',
  'token',
  'tokens',
]);

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.md',
  '.css',
  '.scss',
  '.html',
]);

// `.env.example` and friends are templates, checked in on purpose.
const ENV_TEMPLATE_SUFFIXES = ['example', 'sample', 'template', 'dist', 'defaults'];

const C_ESCAPES = new Map([
  ['a', 0x07],
  ['b', 0x08],
  ['f', 0x0c],
  ['n', 0x0a],
  ['r', 0x0d],
  ['t', 0x09],
  ['v', 0x0b],
  ['"', 0x22],
  ['\\', 0x5c],
]);

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

/**
 * Summarize the dirty worktree described by `git status --short` output.
 *
 * @param {string} gitStatusShortText Raw `git status --short` text.
 * @returns {{ totalPaths: number, areas: Array<{ area: string, count: number }>, protectedPaths: string[] }}
 */
export function summarizeDirtyScope(gitStatusShortText) {
  const paths = parsePaths(gitStatusShortText);

  const counts = new Map();
  for (const filePath of paths) {
    const area = areaOf(filePath);
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }

  const areas = [...counts.entries()]
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => (b.count - a.count) || compareStrings(a.area, b.area));

  const protectedPaths = paths.filter(isProtectedPath).sort(compareStrings);

  return { totalPaths: paths.length, areas, protectedPaths };
}

/** Distinct changed paths, in first-seen order. */
function parsePaths(gitStatusShortText) {
  if (typeof gitStatusShortText !== 'string' || gitStatusShortText.length === 0) return [];

  const seen = new Set();
  const paths = [];

  for (const rawLine of gitStatusShortText.split(/\r?\n/)) {
    const filePath = parseLine(rawLine);
    if (!filePath || seen.has(filePath)) continue;
    seen.add(filePath);
    paths.push(filePath);
  }

  return paths;
}

/** One status line to one normalised path, or null when the line carries none. */
function parseLine(rawLine) {
  const line = rawLine.replace(/\s+$/, '');
  if (line.trim().length === 0) return null;

  let status = '';
  let rest = line;

  if (line.length > 3 && STATUS_CHARS.includes(line[0]) && STATUS_CHARS.includes(line[1]) && line[2] === ' ') {
    status = line.slice(0, 2).trim();
    rest = line.slice(3);
  } else {
    // Tolerate hand-trimmed input: a single status letter, or a bare path.
    const loose = /^([MADRCUT?!]{1,2})\s+(.*)$/.exec(line);
    if (loose) {
      status = loose[1];
      rest = loose[2];
    } else {
      rest = line.trim();
    }
  }

  rest = rest.trim();
  if (rest.length === 0) return null;

  // Renames and copies read `old -> new`; the new path is the one that changed.
  const arrow = rest.lastIndexOf(' -> ');
  if (arrow !== -1 && (status === '' || status.includes('R') || status.includes('C'))) {
    rest = rest.slice(arrow + 4).trim();
    if (rest.length === 0) return null;
  }

  return normalizePath(unquote(rest));
}

/** Undo git's C-style quoting of paths with unusual bytes. */
function unquote(value) {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value;

  const body = value.slice(1, -1);
  const bytes = [];
  let literal = '';

  const flush = () => {
    if (literal.length === 0) return;
    for (const byte of encoder.encode(literal)) bytes.push(byte);
    literal = '';
  };

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char !== '\\' || i === body.length - 1) {
      literal += char;
      continue;
    }

    const next = body[i + 1];
    if (C_ESCAPES.has(next)) {
      flush();
      bytes.push(C_ESCAPES.get(next));
      i += 1;
      continue;
    }

    const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1, i + 4));
    if (octal) {
      flush();
      bytes.push(parseInt(octal[0], 8) & 0xff);
      i += octal[0].length;
      continue;
    }

    // Unknown escape: keep the escaped character itself.
    literal += next;
    i += 1;
  }

  flush();
  return decoder.decode(Uint8Array.from(bytes));
}

function normalizePath(value) {
  let filePath = value.replace(/\\/g, '/');
  while (filePath.startsWith('./')) filePath = filePath.slice(2);
  filePath = filePath.replace(/\/{2,}/g, '/');
  return filePath;
}

function areaOf(filePath) {
  const slash = filePath.indexOf('/');
  if (slash === -1) return ROOT_AREA;
  const area = filePath.slice(0, slash);
  return area.length === 0 ? ROOT_AREA : area;
}

function isProtectedPath(filePath) {
  const segments = filePath.split('/').filter(Boolean);
  if (segments.length === 0) return false;

  const isDirectory = filePath.endsWith('/');
  if ((segments.length > 1 || isDirectory) && PROTECTED_ROOT_DIRECTORIES.has(segments[0].toLowerCase())) return true;
  for (const segment of segments.slice(0, -1)) {
    if (PROTECTED_ANY_DIRECTORIES.has(segment.toLowerCase())) return true;
  }

  const basename = segments[segments.length - 1].toLowerCase();

  if (PROTECTED_BASENAMES.has(basename)) return true;
  if (isEnvFile(basename)) return true;
  if (PROTECTED_EXTENSIONS.some((extension) => basename.endsWith(extension))) return true;

  const extension = basename.includes('.') ? basename.slice(basename.lastIndexOf('.')) : '';
  if (CODE_EXTENSIONS.has(extension)) return false;

  return basename
    .split(/[^a-z0-9]+/)
    .some((word) => PROTECTED_WORDS.has(word));
}

function isEnvFile(basename) {
  if (basename === '.env') return true;
  if (!basename.startsWith('.env.') && !basename.startsWith('env.') && !basename.endsWith('.env')) return false;

  const parts = basename.split('.').filter(Boolean);
  return !parts.some((part) => ENV_TEMPLATE_SUFFIXES.includes(part));
}

function compareStrings(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function formatReport(scope) {
  const lines = scope.areas.map(({ area, count }) => `${area} ${count}`);
  lines.push(`protected: ${scope.protectedPaths.length}`);
  return lines.join('\n');
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const asJson = process.argv.slice(2).includes('--json');

  // Nothing is being piped in: say how to use it rather than block on a TTY.
  if (process.stdin.isTTY) {
    process.stdout.write('Usage: git status --short | node scripts/dev/dirty-scope-report.mjs [--json]\n');
    return;
  }

  const scope = summarizeDirtyScope(await readStdin());
  process.stdout.write(`${asJson ? JSON.stringify(scope, null, 2) : formatReport(scope)}\n`);
  if (scope.protectedPaths.length > 0) process.exitCode = 1;
}

// Only runs when this file is executed directly, never on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
