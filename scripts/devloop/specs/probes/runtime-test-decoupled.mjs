// Evaluator-owned probe: the repair must be a de-coupling, not a deletion.
// A suite that goes green because its assertion was removed proves nothing.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TARGET = 'scripts/runtime/landos-runtime.test.mjs';

function fail(reason) {
  console.log(`PROBE_FAIL: ${reason}`);
  process.exit(1);
}

let source;
try {
  source = readFileSync(resolve(TARGET), 'utf8');
} catch (error) {
  fail(`could not read ${TARGET} (${error.message})`);
}

if (/claudeclaw-os/i.test(source)) {
  const line = source.split(/\r?\n/).findIndex((entry) => /claudeclaw-os/i.test(entry)) + 1;
  fail(
    `${TARGET} still hard-codes the checkout directory name "claudeclaw-os" at line ${line}. ` +
      'The suite must pass in a checkout with any directory name.',
  );
}

if (!source.includes('LANDOS_RUNTIME_ROOT')) {
  fail(`${TARGET} no longer asserts anything about LANDOS_RUNTIME_ROOT; the coverage was deleted rather than de-coupled`);
}

const assertsRuntimeRoot = source
  .split(/\r?\n/)
  .some((line) => line.includes('LANDOS_RUNTIME_ROOT') && /assert\./.test(line));
if (!assertsRuntimeRoot) {
  fail(`${TARGET} mentions LANDOS_RUNTIME_ROOT but no longer asserts on it`);
}

const testCount = (source.match(/^test\(/gmu) ?? []).length;
if (testCount < 13) fail(`${TARGET} declares ${testCount} tests; it had 13 before this change, so cases were removed`);

console.log(`PROBE_OK decoupled, ${testCount} tests retained`);
