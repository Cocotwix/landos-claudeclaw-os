// Evaluator-owned probe. The full never-stage rule, which is broader than any
// single example. This is the criterion the loop feeds back to the next builder
// when an attempt only handles part of it.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const SAMPLE = [
  ' M src/landos/db.ts',
  '?? .env.local',
  ' M store/landos.db',
  '?? logs/main.log',
  ' M scripts/dev/dirty-scope-report.mjs',
  '?? docs/landos/notes.md',
  ' M package.json',
  '?? tmp/session.sqlite3',
].join('\n');

const MUST_BE_PROTECTED = ['.env.local', 'logs/main.log', 'store/landos.db', 'tmp/session.sqlite3'];
const MUST_NOT_BE_PROTECTED = ['src/landos/db.ts', 'docs/landos/notes.md', 'package.json', 'scripts/dev/dirty-scope-report.mjs'];

function fail(reason) {
  console.log(`PROBE_FAIL: ${reason}`);
  process.exit(1);
}

const target = resolve('scripts/dev/dirty-scope-report.mjs');
let mod;
try {
  mod = await import(pathToFileURL(target).href);
} catch (error) {
  fail(`could not import scripts/dev/dirty-scope-report.mjs (${error.message})`);
}
if (typeof mod.summarizeDirtyScope !== 'function') {
  fail('scripts/dev/dirty-scope-report.mjs does not export a function named summarizeDirtyScope');
}

const report = mod.summarizeDirtyScope(SAMPLE);
const protectedPaths = Array.isArray(report?.protectedPaths) ? report.protectedPaths : null;
if (!protectedPaths) fail('report.protectedPaths must be an array');

const missing = MUST_BE_PROTECTED.filter((entry) => !protectedPaths.includes(entry));
if (missing.length) {
  fail(
    `protectedPaths must flag every never-stage class, not only .env. Missing: ${missing.join(', ')}. ` +
      'The rule is: any .env* path, anything under store/, anything under logs/ or ending in .log, ' +
      'and any database file ending in .db, .sqlite or .sqlite3.',
  );
}

const wrong = MUST_NOT_BE_PROTECTED.filter((entry) => protectedPaths.includes(entry));
if (wrong.length) fail(`protectedPaths flagged ordinary source paths: ${wrong.join(', ')}`);

const sorted = [...protectedPaths].sort();
if (JSON.stringify(sorted) !== JSON.stringify(protectedPaths)) {
  fail(`protectedPaths must be sorted ascending, got ${JSON.stringify(protectedPaths)}`);
}

const other = mod.summarizeDirtyScope([' M .env', '?? logs/nested/deep.log', ' M store/backups/x.db-wal'].join('\n'));
const otherMissing = ['.env', 'logs/nested/deep.log', 'store/backups/x.db-wal'].filter(
  (entry) => !other?.protectedPaths?.includes(entry),
);
if (otherMissing.length) fail(`the never-stage rule must apply at any depth. Missing: ${otherMissing.join(', ')}`);

console.log('PROBE_OK protected paths');
