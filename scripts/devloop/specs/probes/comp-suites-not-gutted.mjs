// Evaluator-owned probe: the existing comp suites are updated, never gutted.
//
// This repair changes acreage bands the current suites assert on, so the builder
// legitimately edits those tests. It may not delete coverage to make the build
// green, and the new router needs its own suite.
import { readFileSync } from 'node:fs';
import path from 'node:path';

function fail(reason) {
  console.log(`PROBE_FAIL: ${reason}`);
  process.exit(1);
}

const MINIMUMS = {
  'src/landos/comp-recency-window.test.ts': 21,
  'src/landos/comparable-intelligence.test.ts': 9,
  'src/landos/deal-intelligence-comps.test.ts': 36,
  'src/landos/comps-valuation.test.ts': 26,
  // The router is new behaviour and carries its own coverage.
  'src/landos/acreage-router.test.ts': 10,
};

for (const [file, minimum] of Object.entries(MINIMUMS)) {
  let text;
  try {
    text = readFileSync(path.join(process.cwd(), file), 'utf8');
  } catch (error) {
    fail(`${file} is missing (${error.message}) — existing coverage may not be deleted, and the router needs its own suite`);
  }
  const declared = (text.match(/^\s*(it|test)(\.\w+)?\s*\(/gm) ?? []).length;
  if (declared < minimum) {
    fail(`${file} declares ${declared} tests, below the required ${minimum}. Update the assertions to the new acreage routing; do not delete coverage.`);
  }
  if (/\b(it|test|describe)\.(skip|todo)\s*\(/.test(text)) {
    fail(`${file} contains a skipped or todo test. Repair the assertion instead of skipping it.`);
  }
}

// The router's own suite must actually exercise the 9490 shape, not just the API.
const routerSuite = readFileSync(path.join(process.cwd(), 'src/landos/acreage-router.test.ts'), 'utf8');
for (const needle of ['60', '39.94', '85.32']) {
  if (!routerSuite.includes(needle)) {
    fail(`src/landos/acreage-router.test.ts never mentions ${needle} — the router suite must cover the 60-acre subject with its real 39.94 and 85.32 acre sold land records`);
  }
}

console.log('PROBE_OK comp suites updated, not gutted');
