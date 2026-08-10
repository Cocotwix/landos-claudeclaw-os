// Evaluator-owned probe. It belongs to the frozen acceptance criteria and is
// re-written from them on every evaluation, so a builder cannot weaken it.
// Checks the export, the return shape, and the area grouping order.
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
if (!report || typeof report !== 'object') fail('summarizeDirtyScope did not return an object');
if (report.totalPaths !== 8) fail(`totalPaths should be 8 for the sample, got ${JSON.stringify(report.totalPaths)}`);
if (!Array.isArray(report.areas)) fail('report.areas must be an array');
if (!Array.isArray(report.protectedPaths)) fail('report.protectedPaths must be an array');

const expectedAreas = [
  { area: '(root)', count: 2 },
  { area: 'docs', count: 1 },
  { area: 'logs', count: 1 },
  { area: 'scripts', count: 1 },
  { area: 'src', count: 1 },
  { area: 'store', count: 1 },
  { area: 'tmp', count: 1 },
];
const actualAreas = report.areas.map((entry) => ({ area: entry?.area, count: entry?.count }));
if (JSON.stringify(actualAreas) !== JSON.stringify(expectedAreas)) {
  fail(
    'areas must group by top-level path segment, use "(root)" for root-level files, and sort by count descending then area ascending. ' +
      `expected ${JSON.stringify(expectedAreas)}, got ${JSON.stringify(actualAreas)}`,
  );
}

const empty = mod.summarizeDirtyScope('');
if (!empty || empty.totalPaths !== 0 || empty.areas.length !== 0 || empty.protectedPaths.length !== 0) {
  fail(`a clean tree must report totalPaths 0 with empty areas and protectedPaths, got ${JSON.stringify(empty)}`);
}

console.log('PROBE_OK shape and grouping');
