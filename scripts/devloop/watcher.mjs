#!/usr/bin/env node
// Passive waste watcher for the LandOS mission harness.
//
// It consumes the mission's own event log after the fact. It starts nothing,
// blocks nothing, gates nothing and rewrites nothing: its only job is to make
// recurring waste visible, so the next plan is shorter rather than the next
// process being longer.
//
//   node scripts/devloop/watcher.mjs <missionId>

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { loadDiscoveries, loadMission, readEvents } from './mission.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const SERIAL_LANE_THRESHOLD_MS = 60_000;

/** Findings are observations with evidence, never rules. */
export function analyse(mission, events, discoveries) {
  const findings = [];
  const lanes = mission.lanes ?? [];
  const laneDurations = lanes.filter((lane) => lane.durationMs).map((lane) => lane.durationMs);
  const totalLaneMs = laneDurations.reduce((sum, value) => sum + value, 0);

  // Did parallelism actually buy wall-clock, or did we just launch agents?
  const waveEvents = events.filter((event) => event.event === 'wave.start');
  const peak = mission.peakConcurrency ?? Math.max(0, ...waveEvents.map((event) => event.concurrency ?? 0));
  if (peak <= 1 && lanes.length > 1) {
    findings.push({
      kind: 'no-parallelism',
      detail: `${lanes.length} lanes ran but peak concurrency was ${peak}: the dependency graph serialised everything. Check whether those dependsOn edges are real.`,
    });
  }
  if (totalLaneMs && waveEvents.length) {
    const wallClock = laneWallClock(events);
    if (wallClock > 0) {
      const saved = totalLaneMs - wallClock;
      findings.push({
        kind: 'parallel-saving',
        detail:
          `lane work summed to ${Math.round(totalLaneMs / 1000)}s but occupied ${Math.round(wallClock / 1000)}s of wall clock ` +
          `(${saved > 0 ? `${Math.round(saved / 1000)}s saved by concurrency` : 'no saving'}).`,
      });
    }
  }

  // A lane that everyone waits on and that nobody depended on is a false edge.
  for (const lane of lanes) {
    const dependents = lanes.filter((entry) => (entry.dependsOn ?? []).includes(lane.id));
    if (dependents.length && lane.durationMs > SERIAL_LANE_THRESHOLD_MS) {
      findings.push({
        kind: 'serial-wait',
        detail: `${dependents.length} lane(s) waited ${Math.round(lane.durationMs / 1000)}s for "${lane.id}" (${dependents.map((entry) => entry.id).join(', ')}). If they did not truly need its output, drop the edge.`,
      });
    }
  }

  // Recon that told nobody anything is pure cost.
  for (const lane of lanes.filter((entry) => entry.kind === 'recon')) {
    if (!lane.discoveryCount) {
      findings.push({ kind: 'useless-recon', detail: `recon lane "${lane.id}" produced no discoveries; it spent time and taught nothing.` });
    }
  }
  if (discoveries.length) {
    findings.push({
      kind: 'shared-context',
      detail: `${discoveries.length} discovery(ies) were shared between lanes instead of being rediscovered.`,
    });
  }

  // Repeated repair on the same check means the diagnosis was not actionable.
  const repairChecks = (mission.repairs ?? []).map((repair) => repair.checkId);
  for (const checkId of new Set(repairChecks)) {
    const count = repairChecks.filter((entry) => entry === checkId).length;
    if (count > 1) {
      findings.push({
        kind: 'repeated-repair',
        detail: `check "${checkId}" required ${count} repair attempts: the first diagnosis was not actionable enough. Improve what the evaluator extracts for this check kind.`,
      });
    }
  }

  // Out-of-scope writes mean the path ownership in the plan was wrong.
  for (const lane of lanes) {
    if (lane.outOfScopePaths?.length) {
      findings.push({
        kind: 'scope-miss',
        detail: `lane "${lane.id}" wrote outside its ownedPaths (${lane.outOfScopePaths.join(', ')}); the plan's ownership was wrong or the brief was ambiguous.`,
      });
    }
  }

  // Certification that ran against a candidate that was already wrong.
  const focusedFail = events.some((event) => event.event === 'focused.result' && event.pass === false);
  const validationRan = events.some((event) => event.event === 'validation.start');
  if (focusedFail && validationRan && !(mission.repairs ?? []).length) {
    findings.push({ kind: 'wasted-certification', detail: 'expensive validation ran while a focused check was red.' });
  }

  const failedLanes = lanes.filter((lane) => lane.status === 'failed' || lane.status === 'blocked');
  for (const lane of failedLanes) {
    findings.push({ kind: 'lane-failure', detail: `lane "${lane.id}" ended ${lane.status}: ${lane.error ?? `claim ${lane.claim}`}` });
  }

  return findings;
}

function laneWallClock(events) {
  const starts = events.filter((event) => event.event === 'lane.start');
  const ends = events.filter((event) => event.event === 'lane.finish');
  if (!starts.length || !ends.length) return 0;
  const first = Math.min(...starts.map((event) => new Date(event.at).getTime()));
  const last = Math.max(...ends.map((event) => new Date(event.at).getTime()));
  return last - first;
}

function main() {
  const missionId = process.argv[2];
  if (!missionId) {
    console.error('Usage: node scripts/devloop/watcher.mjs <missionId>');
    process.exitCode = 2;
    return;
  }
  const mission = loadMission(ROOT, missionId);
  const findings = analyse(mission, readEvents(ROOT, missionId), loadDiscoveries(ROOT, missionId));
  console.log(`waste watcher — mission ${missionId} (${mission.terminalState ?? mission.status})`);
  if (!findings.length) {
    console.log('  no waste patterns detected');
    return;
  }
  for (const finding of findings) console.log(`  [${finding.kind}] ${finding.detail}`);
  console.log('\nNothing above is in force. These are observations for the next plan, not rules.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
