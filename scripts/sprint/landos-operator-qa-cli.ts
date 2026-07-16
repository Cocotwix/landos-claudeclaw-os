#!/usr/bin/env tsx
// LandOS Operator-QA CLI — automated operator acceptance against the real
// local dashboard. Localhost only by default; never a paid browser service.
//
// Usage (npm run landos:operator-qa -- ...):
//   --journey <id>          run one golden journey
//   --capability <name>     run one capability suite
//   --department <name>     run one department suite
//   --all                   run the complete operator regression suite (default)
//   --list                  list golden journeys
//   --allow-mutations       permit journeys that create QA fixture records
//   --base-url <url>        override (localhost only)
//   --sprint <id>           tag the report with a sprint id
//
// Exit codes: 0 = all pass; 1 = failure/error/preflight failure;
// 3 = honest gaps (fixture unavailable / manual step / mutation refused).

import path from 'path';
import process from 'process';
import { readEnvFile } from '../../src/env.js';
import { GOLDEN_JOURNEYS } from '../../src/landos/sprint-system/journeys.js';
import {
  runOperatorQa,
  type SuiteScope,
} from '../../src/landos/sprint-system/operator-qa-runner.js';
import { realBrowserFactory } from '../../src/landos/sprint-system/qa-browser.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const next = process.argv[index + 1];
  return next && !next.startsWith('--') ? next : 'true';
}

async function main(): Promise<number> {
  if (flag('list')) {
    for (const journey of GOLDEN_JOURNEYS) {
      console.log(`${journey.id} [${journey.capability}/${journey.department}]${journey.mutating ? ' (mutating)' : ''} — ${journey.name}`);
    }
    return 0;
  }
  const scope: SuiteScope = {
    journeyId: flag('journey'),
    capability: flag('capability'),
    department: flag('department'),
    all: Boolean(flag('all')),
  };
  const previousCwd = process.cwd();
  process.chdir(ROOT); // readEnvFile resolves .env relative to cwd
  let token = '';
  try {
    token = readEnvFile(['DASHBOARD_TOKEN']).DASHBOARD_TOKEN ?? '';
  } finally {
    process.chdir(previousCwd);
  }
  const report = await runOperatorQa(scope, {
    root: ROOT,
    baseUrl: flag('base-url') ?? undefined,
    token: async () => token,
    browserFactory: realBrowserFactory({ headed: true }),
    allowMutations: Boolean(flag('allow-mutations')),
  });
  console.log(`Operator QA ${report.scope}: preflight ${report.preflightOk ? 'PASS' : 'FAIL'}`);
  for (const check of report.preflight) {
    console.log(`  [${check.ok ? 'x' : ' '}] ${check.name}: ${check.detail}`);
  }
  for (const journey of report.journeys) {
    console.log(`  ${journey.journeyId}: ${journey.outcome.toUpperCase()} (${journey.mode}, ${journey.findings.length} finding(s))`);
  }
  console.log(`Summary: ${report.summary.pass} pass, ${report.summary.fail} fail, ${report.summary.error} error, ${report.summary.fixtureUnavailable} fixture-unavailable, ${report.summary.manualRequired} manual, ${report.summary.mutationRefused} mutation-refused`);
  console.log(`Report: ${report.reportJsonPath}`);
  console.log(`Report (markdown): ${report.reportMarkdownPath}`);
  return report.exitCode;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`landos:operator-qa error: ${(err as Error).message}`);
    process.exitCode = 1;
  },
);
