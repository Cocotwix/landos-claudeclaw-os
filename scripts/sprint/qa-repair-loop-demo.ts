#!/usr/bin/env tsx
// Repair-loop demonstration fixture: runs the canonical dashboard-shell
// journey in the REAL browser with one intentionally impossible assertion
// appended (a sentinel string that never appears on the dashboard). This
// proves the browser-QA layer reports honest structured failures and feeds
// the builder repair loop, without touching any operator data. The "repair"
// for the resulting finding is the removal of this controlled fixture from
// the journey, verified by rerunning the same journey without it.
//
// Usage: tsx scripts/sprint/qa-repair-loop-demo.ts <findings-output.json>

import fs from 'fs';
import path from 'path';
import process from 'process';
import { readEnvFile } from '../../src/env.js';
import { getJourney, type GoldenJourney } from '../../src/landos/sprint-system/journeys.js';
import { runJourney } from '../../src/landos/sprint-system/operator-qa-runner.js';
import { realBrowserFactory } from '../../src/landos/sprint-system/qa-browser.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SENTINEL = 'QA-DEMO-SENTINEL-8271';

async function main(): Promise<number> {
  const outFile = process.argv[2];
  if (!outFile) {
    console.error('usage: qa-repair-loop-demo.ts <findings-output.json>');
    return 2;
  }
  const base = getJourney('dashboard-shell-health');
  const journey: GoldenJourney = {
    ...base,
    id: 'dashboard-shell-health-controlled-failure',
    name: `${base.name} (controlled failing assertion)`,
    operatorSteps: [
      ...base.operatorSteps,
      {
        kind: 'expect_text',
        anyOf: [SENTINEL],
        description: `CONTROLLED FIXTURE: expect sentinel "${SENTINEL}" which is intentionally absent`,
      },
    ],
  };
  const previousCwd = process.cwd();
  process.chdir(ROOT);
  let token = '';
  try {
    token = readEnvFile(['DASHBOARD_TOKEN']).DASHBOARD_TOKEN ?? '';
  } finally {
    process.chdir(previousCwd);
  }
  const result = await runJourney(
    journey,
    { root: ROOT, token: async () => token, browserFactory: realBrowserFactory({ headed: true }) },
    { runId: `repair-loop-demo-${Date.now()}` },
  );
  console.log(`Outcome: ${result.outcome} (mode: ${result.mode})`);
  for (const step of result.steps) {
    console.log(`  [${step.status}] ${step.kind}: ${step.detail}`);
  }
  for (const shot of result.screenshots) console.log(`  screenshot: ${shot}`);
  fs.writeFileSync(outFile, `${JSON.stringify(result.findings, null, 2)}\n`, 'utf8');
  console.log(`Findings written: ${outFile} (${result.findings.length})`);
  const demonstrated = result.mode === 'real_browser'
    && result.outcome === 'fail'
    && result.findings.length === 1
    && result.steps.filter((s) => s.status === 'fail').length === 1;
  console.log(demonstrated
    ? 'Controlled failure demonstrated: only the sentinel assertion failed, in a real browser.'
    : 'UNEXPECTED: the controlled failure did not behave as designed; inspect the steps above.');
  return demonstrated ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`demo error: ${(err as Error).message}`);
    process.exitCode = 1;
  },
);
