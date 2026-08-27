#!/usr/bin/env tsx

import path from 'node:path';
import process from 'node:process';

import { readEnvFile } from '../../src/env.js';
import { runBrowserQa, type BrowserQaScenario } from '../../src/landos/browser-qa.js';
import { godsEyeViewBrowserQaScenario } from '../../src/landos/gods-eye-view-browser-qa.js';
import { deal90SmartIntakeQaScenario } from '../../src/landos/deal90-smart-intake-qa.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const next = process.argv[index + 1];
  return next && !next.startsWith('--') ? next : 'true';
}

function genericRouteScenario(route: string): BrowserQaScenario {
  return {
    id: `route-${route}`,
    route,
    async run(qa) {
      await qa.step(`open ${route}`, async () => {
        await qa.goto();
        await qa.waitFor('body');
        const text = (await qa.text('body')).trim();
        qa.check('operator page contains visible text', text.length > 0, `${text.length} visible character(s)`);
        return `opened ${route}`;
      });
      await qa.screenshot('route');
      // hardRefresh compares location.pathname — strip any query string so a
      // route like /dept/acquisitions/v2?deal=89 doesn't false-fail.
      await qa.hardRefresh(route.split('?')[0]);
      await qa.waitFor('body');
      await qa.screenshot('route-after-hard-refresh');
    },
  };
}

async function main(): Promise<number> {
  const scenarioName = flag('scenario');
  const route = flag('route');
  const scenario = scenarioName === 'gods-eye-view'
    ? godsEyeViewBrowserQaScenario
    : scenarioName === 'deal90-smart-intake'
      ? deal90SmartIntakeQaScenario
      : route && route.startsWith('/')
        ? genericRouteScenario(route)
        : null;
  if (!scenario) {
    console.error('Usage: npm run landos:browser:qa -- --scenario gods-eye-view | deal90-smart-intake | --route /local/path');
    return 1;
  }

  const previousCwd = process.cwd();
  process.chdir(ROOT);
  let token = '';
  try { token = readEnvFile(['DASHBOARD_TOKEN']).DASHBOARD_TOKEN ?? ''; }
  finally { process.chdir(previousCwd); }

  const report = await runBrowserQa({
    root: ROOT,
    baseUrl: flag('base-url'),
    token,
    scenario,
  });
  console.log(`Browser QA ${report.scenario}: ${report.outcome}`);
  console.log(`Reason: ${report.reason}`);
  console.log(`Connection: ${report.connectionSource ?? 'none'}${report.browserPid ? ` (PID ${report.browserPid})` : ''}`);
  console.log(`Steps: ${report.steps.filter((step) => step.outcome === 'PASS').length} pass, ${report.steps.filter((step) => step.outcome === 'FAIL').length} fail`);
  console.log(`Diagnostics: ${report.issues.filter((issue) => issue.severity === 'error').length} error, ${report.issues.filter((issue) => issue.severity === 'warning').length} warning`);
  console.log(`Screenshots: ${report.screenshots.length}`);
  console.log(`Evidence: ${report.artifactDir}`);
  return report.outcome === 'PASS' ? 0 : report.outcome === 'BLOCKED' ? 3 : 1;
}

main().then(
  (code) => { process.exitCode = code; },
  (error) => {
    console.error(`landos:browser:qa error: ${(error as Error).message}`);
    process.exitCode = 1;
  },
);
