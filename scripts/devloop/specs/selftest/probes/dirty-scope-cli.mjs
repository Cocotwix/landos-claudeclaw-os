// Evaluator-owned probe for the command-line contract. The operator outcome is
// "pipe git status --short into one helper", so the module has to be usable as
// a CLI with defined exit codes, not only as an import.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const TARGET = resolve('scripts/dev/dirty-scope-report.mjs');

function fail(reason) {
  console.log(`PROBE_FAIL: ${reason}`);
  process.exit(1);
}

function runCli(input) {
  const result = spawnSync(process.execPath, [TARGET], { input, encoding: 'utf8', timeout: 60_000 });
  if (result.error) fail(`could not run "node scripts/dev/dirty-scope-report.mjs" (${result.error.message})`);
  return { status: result.status, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') };
}

const dirtyWithProtected = [' M src/landos/db.ts', '?? .env.local', ' M store/landos.db', ' M package.json'].join('\n');
const dirtyClean = [' M src/landos/db.ts', ' M package.json', '?? docs/landos/notes.md'].join('\n');

const flagged = runCli(dirtyWithProtected);
if (flagged.status !== 1) {
  fail(
    'running the module as a CLI must exit 1 when any protected path is dirty, got exit ' +
      `${flagged.status}. stderr: ${flagged.stderr.trim().slice(0, 200)}`,
  );
}
for (const expected of ['src', 'store', '(root)']) {
  if (!new RegExp(`^\\s*${expected.replace(/[()]/g, '\\$&')}\\s+\\d+\\s*$`, 'm').test(flagged.stdout)) {
    fail(`CLI stdout must contain one "<area> <count>" line per area; no line for "${expected}" in:\n${flagged.stdout}`);
  }
}
if (!/^protected: 2$/m.test(flagged.stdout)) {
  fail(`CLI stdout must end with a "protected: <count>" line; expected "protected: 2" in:\n${flagged.stdout}`);
}

const clean = runCli(dirtyClean);
if (clean.status !== 0) {
  fail(`the CLI must exit 0 when no protected path is dirty, got exit ${clean.status}. stderr: ${clean.stderr.trim().slice(0, 200)}`);
}
if (!/^protected: 0$/m.test(clean.stdout)) {
  fail(`the CLI must still print "protected: 0" when nothing is protected, got:\n${clean.stdout}`);
}

const empty = runCli('');
if (empty.status !== 0) fail(`an empty status on stdin must exit 0, got exit ${empty.status}`);

console.log('PROBE_OK cli contract');
