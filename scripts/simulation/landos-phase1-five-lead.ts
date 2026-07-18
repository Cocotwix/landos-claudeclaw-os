#!/usr/bin/env tsx
import path from 'node:path';
import process from 'node:process';

import { readEnvFile } from '../../src/env.js';
import { runFiveLeadSimulation } from '../../src/landos/phase1-five-lead-simulation.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

async function main(): Promise<void> {
  const previous = process.cwd();
  process.chdir(ROOT);
  let token = '';
  try { token = process.env.DASHBOARD_TOKEN ?? readEnvFile(['DASHBOARD_TOKEN']).DASHBOARD_TOKEN ?? ''; }
  finally { process.chdir(previous); }
  const report = await runFiveLeadSimulation({ token, baseUrl: flag('base-url'), projectRoot: ROOT });
  console.log(`Phase 1 five-lead simulation: ${report.outcome.toUpperCase()}`);
  console.log(`Unique opportunities: ${report.leads.length}/5`);
  console.log(`Operating DB unchanged: ${report.operatingDatabase.unchanged}`);
  console.log(`Report: ${report.reportJsonPath}`);
  console.log(`Report (markdown): ${report.reportMarkdownPath}`);
  if (report.outcome !== 'pass') process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`landos:phase1:simulate error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
