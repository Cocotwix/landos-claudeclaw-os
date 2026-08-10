// Evaluator-owned probe. The repair is one counting rule; the rest of the
// durable-memory module's public surface must be untouched.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function fail(reason) {
  console.log(`PROBE_FAIL: ${reason}`);
  process.exit(1);
}

const target = path.resolve('scripts/memory/landos-memory.mjs');
let mod;
try {
  mod = await import(pathToFileURL(target).href);
} catch (error) {
  fail(`could not import scripts/memory/landos-memory.mjs (${error.message})`);
}

for (const name of [
  'BUDGETS',
  'PERMANENT_MEMORY_PATH',
  'CHECKPOINT_PATH',
  'VERIFICATION_PATH',
  'FORBIDDEN_PATTERNS',
  'estimateTokens',
  'gitShortHead',
  'gitDirtyCount',
  'buildStatus',
  'buildAudit',
  'refreshCheckpoint',
]) {
  if (!(name in mod)) fail(`scripts/memory/landos-memory.mjs no longer exports ${name}`);
}

const budgets = mod.BUDGETS;
const expected = { permanentMaxBytes: 4096, checkpointMaxBytes: 8192, autoTargetTokens: 10000, autoMaxTokens: 20000 };
for (const [key, value] of Object.entries(expected)) {
  if (budgets?.[key] !== value) fail(`BUDGETS.${key} changed from ${value} to ${JSON.stringify(budgets?.[key])}`);
}
if (mod.CHECKPOINT_PATH !== '.landos/CHECKPOINT.md') fail(`CHECKPOINT_PATH changed to ${mod.CHECKPOINT_PATH}`);
if (mod.PERMANENT_MEMORY_PATH !== '.landos/PERMANENT_MEMORY.md') fail(`PERMANENT_MEMORY_PATH changed to ${mod.PERMANENT_MEMORY_PATH}`);
if (mod.estimateTokens('abcd') !== 1) fail(`estimateTokens('abcd') should be 1, got ${mod.estimateTokens('abcd')}`);

const head = mod.gitShortHead(process.cwd());
if (typeof head !== 'string' || !/^[0-9a-f]{7,40}$/.test(head)) fail(`gitShortHead returned ${JSON.stringify(head)} for this checkout`);

console.log('PROBE_OK memory module surface stable');
