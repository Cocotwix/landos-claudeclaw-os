#!/usr/bin/env node
// LandOS mission harness — plan doctor.
//
// Development-only. Checks a mission plan before any builder time is spent on
// it: the plan's own validation issues, and the wave schedule the harness would
// actually run it as. Reads the plan file and nothing else. It never creates a
// mission, never touches run state, and never launches a builder.
//
// Exit code 2 means do not launch this plan; exit code 0 means it is launchable
// and the schedule printed is what it would produce.
//
//   node scripts/devloop/plan-doctor.mjs <plan.json>

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { criticalPathLength, readyLanes, validatePlan } from './mission.mjs';

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function log(line) {
  console.log(line);
}

// The harness has no exported wave function: `runLanes` derives each wave inline
// by calling `readyLanes` and completing what comes back. The doctor has to
// simulate the same loop against a throwaway mission so the schedule it prints
// is the one the harness would run, not a second opinion about dependencies.
function waveSchedule(lanes) {
  const simulated = {
    lanes: lanes.map((lane) => ({ ...lane, status: 'pending', dependsOn: lane.dependsOn ?? [] })),
  };
  const waves = [];
  for (;;) {
    const ready = readyLanes(simulated);
    if (!ready.length) break;
    waves.push(ready.map((lane) => lane.id));
    for (const lane of ready) lane.status = 'complete';
  }
  return waves;
}

function main() {
  const planArg = process.argv[2];
  if (!planArg) {
    console.error('Usage: node scripts/devloop/plan-doctor.mjs <plan.json>');
    process.exitCode = 2;
    return;
  }

  const planPath = path.resolve(REPOSITORY_ROOT, planArg);
  if (!existsSync(planPath)) {
    console.error(`Usage: node scripts/devloop/plan-doctor.mjs <plan.json>   (no such plan file: ${planArg})`);
    process.exitCode = 2;
    return;
  }

  let plan;
  try {
    plan = JSON.parse(readFileSync(planPath, 'utf8'));
  } catch (error) {
    console.error(`${planArg} is not valid JSON: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  // The issue list is the report this tool exists to produce, so it goes to
  // stdout with the summary; only the usage failures above are stderr.
  const issues = validatePlan(plan);
  if (issues.length) {
    log(`${planArg} is not launchable, ${issues.length} issue${issues.length === 1 ? '' : 's'}:`);
    for (const issue of issues) log(`  ${issue}`);
    process.exitCode = 2;
    return;
  }

  const lanes = plan.lanes;
  const waves = waveSchedule(lanes);
  const peak = waves.reduce((widest, wave) => Math.max(widest, wave.length), 0);

  log(`plan: ${planArg}`);
  log(`request: ${plan.request}`);
  log(`lanes: ${lanes.length}`);
  log(`critical path: ${criticalPathLength(lanes)}`);
  log(`waves: ${waves.length}`);
  for (const [index, wave] of waves.entries()) {
    log(`wave ${index + 1}: ${wave.join(', ')}`);
  }
  log(`peak concurrency: ${peak}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

export { waveSchedule, REPOSITORY_ROOT };
