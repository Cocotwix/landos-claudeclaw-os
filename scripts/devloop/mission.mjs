#!/usr/bin/env node
// Mission state for the LandOS parallel-first development harness.
//
// The old dev loop ran one builder, evaluated it, then ran another builder on
// the same whole task. That is failover, not parallel development: four
// independent areas cost four serial builder runs. A mission instead holds a
// small dependency graph of lanes, launches every ready lane at once, and lets
// workers read each other's discoveries instead of rediscovering them.
//
// The harness owns process and state. Builders only reason and edit.
//
// State lives under `.runtime/devloop/<missionId>/` (gitignored), alongside the
// existing run state, and reuses its run-id and containment helpers.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';

import { assertRunId, runsRoot, sha256 } from './run-state.mjs';

export const LANE_KINDS = new Set(['recon', 'build', 'repair']);
export const TERMINAL_STATES = new Set(['PASS', 'FAIL', 'NEEDS_ATTENTION']);

export function missionDir(root, missionId) {
  assertRunId(missionId);
  return path.join(runsRoot(root), missionId);
}
export function laneDir(root, missionId, laneId) {
  return path.join(missionDir(root, missionId), 'lanes', laneId);
}

export function newMissionId(request, now = new Date()) {
  const slug = String(request)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'mission';
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'z').toLowerCase();
  return assertRunId(`m-${slug}-${stamp}`);
}

// ---------------------------------------------------------------- lane graph

/**
 * Validate a plan before anything is launched. Two failures are worth catching
 * here rather than halfway through a parallel run: a dependency cycle, which
 * would deadlock the scheduler, and two concurrently-runnable write lanes that
 * claim the same file, which is how parallel agents corrupt each other's work.
 */
export function validatePlan(plan) {
  const issues = [];
  const lanes = plan?.lanes ?? [];
  if (!Array.isArray(lanes) || lanes.length === 0) issues.push('plan.lanes must list at least one lane');
  if (typeof plan?.request !== 'string' || !plan.request.trim()) issues.push('plan.request must be a non-empty string');

  const ids = new Set();
  for (const lane of lanes) {
    if (!lane?.id || !/^[a-z0-9][a-z0-9-]*$/.test(lane.id)) issues.push(`lane id "${lane?.id}" must be lowercase kebab-case`);
    else if (ids.has(lane.id)) issues.push(`duplicate lane id "${lane.id}"`);
    else ids.add(lane.id);
    if (!LANE_KINDS.has(lane?.kind)) issues.push(`lane "${lane?.id}" has unknown kind "${lane?.kind}"`);
    if (typeof lane?.brief !== 'string' || !lane.brief.trim()) issues.push(`lane "${lane?.id}" needs a brief`);
    if (lane?.kind !== 'recon' && (!Array.isArray(lane?.ownedPaths) || lane.ownedPaths.length === 0)) {
      issues.push(`write lane "${lane?.id}" must declare ownedPaths; that ownership is what makes concurrency safe`);
    }
  }
  let edgesResolve = true;
  for (const lane of lanes) {
    for (const dependency of lane?.dependsOn ?? []) {
      if (!ids.has(dependency)) {
        issues.push(`lane "${lane.id}" depends on unknown lane "${dependency}"`);
        edgesResolve = false;
      }
    }
  }

  // The structural checks run whenever the graph is well-formed enough to walk,
  // not only when everything else already passed. Gating them behind a clean
  // issue list would let one trivial mistake hide a cycle or a write collision,
  // and the operator would fix the trivial one and rerun into the real one.
  if (ids.size === lanes.length && edgesResolve) {
    const cycle = findCycle(lanes);
    if (cycle) issues.push(`dependency cycle: ${cycle.join(' -> ')}`);
    for (const clash of overlappingConcurrentLanes(lanes)) {
      issues.push(
        `lanes "${clash.a}" and "${clash.b}" can run at the same time and both claim ${clash.paths.join(', ')}; ` +
          'give them disjoint paths or make one depend on the other',
      );
    }
  }
  return issues;
}

export function findCycle(lanes) {
  const byId = new Map(lanes.map((lane) => [lane.id, lane]));
  const state = new Map();
  const stack = [];
  let cycle = null;

  const visit = (id) => {
    if (cycle) return;
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') {
      cycle = [...stack.slice(stack.indexOf(id)), id];
      return;
    }
    state.set(id, 'open');
    stack.push(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    stack.pop();
    state.set(id, 'done');
  };
  for (const lane of lanes) visit(lane.id);
  return cycle;
}

/** Every lane that must finish before `laneId` may start, transitively. */
export function ancestorsOf(lanes, laneId, seen = new Set()) {
  const byId = new Map(lanes.map((lane) => [lane.id, lane]));
  for (const dependency of byId.get(laneId)?.dependsOn ?? []) {
    if (seen.has(dependency)) continue;
    seen.add(dependency);
    ancestorsOf(lanes, dependency, seen);
  }
  return seen;
}

// Two write lanes are only dangerous together if neither is an ancestor of the
// other, because otherwise the scheduler already serialises them.
export function overlappingConcurrentLanes(lanes) {
  const writers = lanes.filter((lane) => lane.kind !== 'recon');
  const clashes = [];
  for (let i = 0; i < writers.length; i += 1) {
    for (let j = i + 1; j < writers.length; j += 1) {
      const a = writers[i];
      const b = writers[j];
      if (ancestorsOf(lanes, a.id).has(b.id) || ancestorsOf(lanes, b.id).has(a.id)) continue;
      const paths = (a.ownedPaths ?? []).filter((target) =>
        (b.ownedPaths ?? []).some((other) => target === other || target.startsWith(other) || other.startsWith(target)),
      );
      if (paths.length) clashes.push({ a: a.id, b: b.id, paths });
    }
  }
  return clashes;
}

/** Lanes whose dependencies have all completed and which have not run yet. */
export function readyLanes(mission) {
  const status = new Map(mission.lanes.map((lane) => [lane.id, lane.status]));
  return mission.lanes.filter(
    (lane) => lane.status === 'pending' && (lane.dependsOn ?? []).every((dependency) => status.get(dependency) === 'complete'),
  );
}

/** Longest chain of dependent lanes: the floor on how parallel this plan can be. */
export function criticalPathLength(lanes) {
  const byId = new Map(lanes.map((lane) => [lane.id, lane]));
  const depth = new Map();
  const measure = (id) => {
    if (depth.has(id)) return depth.get(id);
    const dependencies = byId.get(id)?.dependsOn ?? [];
    const value = dependencies.length ? 1 + Math.max(...dependencies.map(measure)) : 1;
    depth.set(id, value);
    return value;
  };
  return lanes.length ? Math.max(...lanes.map((lane) => measure(lane.id))) : 0;
}

// ------------------------------------------------------------------- mission

export function createMission(root, plan, { now = new Date(), missionId = newMissionId(plan?.request ?? 'mission', now) } = {}) {
  const issues = validatePlan(plan);
  if (issues.length) throw new Error(`Invalid mission plan:\n- ${issues.join('\n- ')}`);

  const dir = missionDir(root, missionId);
  if (existsSync(path.join(dir, 'mission.json'))) throw new Error(`Mission ${missionId} already exists.`);
  mkdirSync(path.join(dir, 'lanes'), { recursive: true });

  const mission = {
    missionId,
    createdAt: now.toISOString(),
    request: plan.request,
    operatorOutcome: plan.operatorOutcome ?? plan.request,
    status: 'running',
    terminalState: null,
    baselineHead: plan.baselineHead ?? null,
    lanes: plan.lanes.map((lane) => ({
      id: lane.id,
      kind: lane.kind,
      title: lane.title ?? lane.id,
      brief: lane.brief,
      dependsOn: lane.dependsOn ?? [],
      ownedPaths: lane.ownedPaths ?? [],
      builderId: lane.builderId ?? null,
      tools: lane.tools ?? null,
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      changedPaths: [],
      worktree: null,
      claim: null,
      exitCode: null,
      error: null,
    })),
    // Focused checks disprove the candidate cheaply; validation certifies it.
    // They are separated because running the second before the first passes is
    // the single most expensive habit the old loop had.
    focusedChecks: plan.focusedChecks ?? [],
    validationChecks: plan.validationChecks ?? [],
    browserCheck: plan.browserCheck ?? null,
    integration: null,
    focusedResult: null,
    validationResult: null,
    repairs: [],
    planSha256: sha256(`${JSON.stringify(plan.lanes)}${JSON.stringify(plan.focusedChecks ?? [])}`),
  };
  saveMission(root, mission);
  return mission;
}

export function saveMission(root, mission) {
  const dir = missionDir(root, mission.missionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'mission.json'), `${JSON.stringify(mission, null, 2)}\n`, 'utf8');
  return mission;
}

export function loadMission(root, missionId) {
  const file = path.join(missionDir(root, missionId), 'mission.json');
  if (!existsSync(file)) throw new Error(`No mission "${missionId}" under ${runsRoot(root)}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function listMissions(root) {
  const base = runsRoot(root);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(base, entry.name, 'mission.json')))
    .map((entry) => JSON.parse(readFileSync(path.join(base, entry.name, 'mission.json'), 'utf8')))
    .map((mission) => ({
      missionId: mission.missionId,
      status: mission.status,
      terminalState: mission.terminalState,
      request: mission.request,
      lanes: mission.lanes.length,
      createdAt: mission.createdAt,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function laneById(mission, laneId) {
  const lane = mission.lanes.find((entry) => entry.id === laneId);
  if (!lane) throw new Error(`Mission ${mission.missionId} has no lane "${laneId}"`);
  return lane;
}

export function setTerminalState(root, mission, state, reason) {
  if (!TERMINAL_STATES.has(state)) throw new Error(`Unknown terminal state "${state}"`);
  mission.terminalState = state;
  mission.status = 'closed';
  mission.terminalReason = reason ?? null;
  saveMission(root, mission);
  return mission;
}

// -------------------------------------------------------- shared discoveries
//
// Parallel workers must not become parallel rediscovery machines. A lane writes
// one compact line per thing it learned; later lanes receive those lines in
// their brief instead of rereading the same files. Deliberately a small append
// -only JSON file, not a caching service: the value is in what is written, not
// in the machinery.

export function discoveriesPath(root, missionId) {
  return path.join(missionDir(root, missionId), 'discoveries.json');
}

export function loadDiscoveries(root, missionId) {
  const file = discoveriesPath(root, missionId);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Record one compact observation. `subject` is what it is about (a file,
 * symbol, route or test), `note` is the finding in one line. Identical
 * subject+note pairs collapse, so a lane repeating itself costs nothing.
 */
export function recordDiscovery(root, missionId, { laneId, kind, subject, note, ref = null }) {
  const entries = loadDiscoveries(root, missionId);
  const key = `${kind}::${subject}::${note}`;
  if (entries.some((entry) => `${entry.kind}::${entry.subject}::${entry.note}` === key)) return entries;
  entries.push({
    laneId,
    kind,
    subject,
    note: String(note).slice(0, 400),
    ref,
    at: new Date().toISOString(),
  });
  writeFileSync(discoveriesPath(root, missionId), `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  return entries;
}

/** The discoveries a lane should inherit, rendered for a prompt. */
export function briefingFor(root, mission, lane) {
  const inherited = ancestorsOf(mission.lanes, lane.id);
  const entries = loadDiscoveries(root, mission.missionId).filter(
    (entry) => inherited.has(entry.laneId) || entry.kind === 'shared',
  );
  if (!entries.length) return '';
  const lines = entries.map((entry) => `- [${entry.kind}] ${entry.subject}: ${entry.note}${entry.ref ? ` (${entry.ref})` : ''}`);
  return [
    'ALREADY DISCOVERED BY EARLIER LANES IN THIS MISSION',
    'Treat these as established. Do not re-derive them, and do not reread these files just to confirm them.',
    ...lines,
  ].join('\n');
}

/**
 * Harvest discoveries out of a worker's own report. A worker writes lines like
 *   DISCOVERY: file src/x.ts — owns the comp cap calculation
 * which keeps the contract one line long for the worker and structured here.
 */
export function harvestDiscoveries(root, missionId, laneId, text) {
  const found = [];
  const pattern = /^\s*DISCOVERY:\s*(\S+)\s+(.+?)\s+(?:—|--|-)\s+(.+)$/gm;
  let match = pattern.exec(String(text ?? ''));
  while (match) {
    found.push({ kind: match[1].toLowerCase(), subject: match[2].trim(), note: match[3].trim() });
    match = pattern.exec(String(text ?? ''));
  }
  for (const entry of found) recordDiscovery(root, missionId, { laneId, ...entry });
  return found;
}

// --------------------------------------------------------------- telemetry
//
// Tyler should never again watch "1 shell running" for forty minutes. Every
// phase transition prints one timestamped line and appends one JSONL event.

export function eventsPath(root, missionId) {
  return path.join(missionDir(root, missionId), 'events.jsonl');
}

export function elapsed(startedAt, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function createReporter(root, mission, { write = (line) => console.log(line), now = () => Date.now() } = {}) {
  const startedAt = mission.createdAt;
  return function report(event, detail = {}) {
    const stamp = elapsed(startedAt, now());
    const record = { at: new Date(now()).toISOString(), elapsed: stamp, event, ...detail };
    try {
      mkdirSync(missionDir(root, mission.missionId), { recursive: true });
      appendFileSync(eventsPath(root, mission.missionId), `${JSON.stringify(record)}\n`, 'utf8');
    } catch {
      // Telemetry must never take the mission down.
    }
    write(`${stamp}  ${detail.message ?? event}`);
    return record;
  };
}

export function readEvents(root, missionId) {
  const file = eventsPath(root, missionId);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
