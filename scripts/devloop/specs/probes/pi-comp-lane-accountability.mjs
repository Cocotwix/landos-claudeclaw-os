// Evaluator-owned probe: multi-source comp lane accountability.
//
// The 9490 screen ends up with five LandPortal sold land comps and eleven
// Zillow house listings correctly filed as improved context. What the operator
// cannot tell is whether Redfin and Realtor.com ran, found nothing, failed,
// were filtered, or were never consumed at all.
//
// Every one of those five outcomes is a DIFFERENT statement and they must not
// be conflated. Above all: a lane that never ran must never be reported as
// zero results. A fabricated zero is a false claim about a source that was
// never asked.
//
// LandPortal succeeding is also never a reason to stop asking the others.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const url = (rel) => JSON.stringify(pathToFileURL(path.join(root, rel)).href);

const script = `
import {
  ACCOUNTABLE_COMP_LANES,
  buildCompLaneAccountability,
  compLanePlan,
} from ${url('src/landos/comp-lane-accountability.ts')};
import { applyCompSourcePolicy } from ${url('src/landos/comp-source-policy.ts')};

function fail(reason: string): never { console.log('PROBE_FAIL: ' + reason); process.exit(1); }
function ok(cond: unknown, reason: string) { if (!cond) fail(reason); }

// ── 1. All four lanes are always accounted for ─────────────────────────────
for (const lane of ['landportal', 'zillow', 'redfin', 'realtor']) {
  ok(ACCOUNTABLE_COMP_LANES.includes(lane as never), 'lane "' + lane + '" must be an accountable comp lane, got ' + JSON.stringify(ACCOUNTABLE_COMP_LANES));
}

const partial = buildCompLaneAccountability([
  { lane: 'landportal', attempted: true, candidates: 5, retained: 5 },
]);
ok(partial.lanes.length === ACCOUNTABLE_COMP_LANES.length,
  'every accountable lane must appear in the outcome even when nothing was supplied for it, got ' + partial.lanes.length);
const laneOf = (id: string) => partial.lanes.find((entry: { lane: string }) => entry.lane === id)!;

// ── 2. NOT RUN is never reported as a zero ─────────────────────────────────
for (const id of ['zillow', 'redfin', 'realtor']) {
  const entry = laneOf(id);
  ok(entry.status === 'not_run', 'lane "' + id + '" was never attempted, so its status must be not_run, got "' + String(entry.status) + '"');
  ok(entry.candidates === null, 'a lane that never ran must report candidates null, NOT 0 — a fabricated zero is a false claim; got ' + String(entry.candidates));
  ok(entry.retained === null, 'a lane that never ran must report retained null, not 0; got ' + String(entry.retained));
  ok(!/\\b0\\b/.test(String(entry.operatorLine)),
    'the operator line for an unrun lane must not state a zero count, got ' + JSON.stringify(entry.operatorLine));
  ok(/not run|never ran|was not searched|did not run/i.test(String(entry.operatorLine)),
    'the operator line must say plainly that the lane did not run, got ' + JSON.stringify(entry.operatorLine));
}
ok(partial.everyLaneAccountedFor === false, 'with three lanes unrun, everyLaneAccountedFor must be false');
ok(partial.unrunLanes.length === 3, 'unrunLanes must name the three lanes that never ran, got ' + JSON.stringify(partial.unrunLanes));

// ── 3. The five outcomes are distinguished ─────────────────────────────────
const full = buildCompLaneAccountability([
  { lane: 'landportal', attempted: true, candidates: 5, retained: 5, retainedAs: 'closed vacant-land sales' },
  { lane: 'zillow', attempted: true, candidates: 11, retained: 0, filteredReasons: ['improved property routed to improved context'] },
  { lane: 'redfin', attempted: true, candidates: 0, retained: 0 },
  { lane: 'realtor', attempted: true, failureReason: 'the realtor.com request returned HTTP 403' },
]);
const f = (id: string) => full.lanes.find((entry: { lane: string }) => entry.lane === id)!;

ok(f('landportal').status === 'retained', 'LandPortal retained five sales, so status must be retained, got "' + String(f('landportal').status) + '"');
ok(/5/.test(String(f('landportal').operatorLine)), 'the LandPortal line must state the retained count, got ' + JSON.stringify(f('landportal').operatorLine));

ok(f('zillow').status === 'ran_results_filtered',
  'Zillow ran, returned eleven candidates and retained none as vacant-land comps: that is ran_results_filtered, got "' + String(f('zillow').status) + '"');
ok(f('zillow').candidates === 11, 'the eleven Zillow candidates must stay visible, got ' + String(f('zillow').candidates));
ok(/improved/i.test(String(f('zillow').operatorLine) + String(f('zillow').detail ?? '')),
  'the Zillow line must name why its candidates were filtered, got ' + JSON.stringify(f('zillow').operatorLine));

ok(f('redfin').status === 'ran_no_results',
  'Redfin was searched and genuinely returned nothing: that is ran_no_results, not not_run, got "' + String(f('redfin').status) + '"');
ok(f('redfin').candidates === 0, 'a lane that really ran may state a real zero, got ' + String(f('redfin').candidates));
ok(/search|ran|queried/i.test(String(f('redfin').operatorLine)), 'the Redfin line must confirm the search actually happened, got ' + JSON.stringify(f('redfin').operatorLine));

ok(f('realtor').status === 'failed', 'a retrieval error is failed, not zero results, got "' + String(f('realtor').status) + '"');
ok(f('realtor').candidates === null, 'a failed retrieval knows no candidate count, so it must be null, got ' + String(f('realtor').candidates));
ok(/403|fail/i.test(String(f('realtor').operatorLine) + String(f('realtor').detail ?? '')),
  'the Realtor.com line must carry the actual failure, got ' + JSON.stringify(f('realtor').operatorLine));
ok(full.everyLaneAccountedFor === true, 'all four lanes were attempted, so everyLaneAccountedFor must be true');
ok(typeof full.summaryLine === 'string' && full.summaryLine.trim().length >= 40, 'a readable summary line across the lanes is required');

const blocked = buildCompLaneAccountability([{ lane: 'redfin', attempted: true, blockedReason: 'anti-bot challenge on the results page' }]);
ok(blocked.lanes.find((e: { lane: string }) => e.lane === 'redfin')!.status === 'blocked', 'a blocked retrieval must be distinguished from a failure and from zero results');
const disabled = buildCompLaneAccountability([{ lane: 'realtor', attempted: false, disabledReason: 'the HomeHarvest / Realtor.com aggregator family is disabled for the current comparable workflow' }]);
const disabledEntry = disabled.lanes.find((e: { lane: string }) => e.lane === 'realtor')!;
ok(disabledEntry.status === 'disabled_by_policy', 'a policy-disabled lane must be stated as such, not as zero results, got "' + String(disabledEntry.status) + '"');
ok(/disabled/i.test(String(disabledEntry.operatorLine)), 'the operator must be told the lane is disabled by policy, got ' + JSON.stringify(disabledEntry.operatorLine));

// Every status carries a readable operator line.
for (const entry of [...partial.lanes, ...full.lanes]) {
  ok(typeof entry.operatorLine === 'string' && entry.operatorLine.trim().length >= 20,
    'lane "' + entry.lane + '" must carry a readable operator line, got ' + JSON.stringify(entry.operatorLine));
  ok(typeof entry.label === 'string' && entry.label.trim().length > 0, 'lane "' + entry.lane + '" must carry a display label');
}

// ── 4. LandPortal succeeding never suppresses the other lanes ──────────────
const plan = compLanePlan({ landPortalUsableCount: 5 });
ok(Array.isArray(plan.mustRun), 'compLanePlan must return the lanes that must still run');
for (const id of ['zillow', 'redfin', 'realtor']) {
  ok(plan.mustRun.includes(id as never),
    'LandPortal returning five usable comps must NOT stop LandOS asking ' + id + '; got mustRun=' + JSON.stringify(plan.mustRun));
}
ok(plan.mustRun.length === ACCOUNTABLE_COMP_LANES.length || plan.mustRun.length === ACCOUNTABLE_COMP_LANES.length - 1,
  'the plan must cover the accountable lanes, got ' + JSON.stringify(plan.mustRun));
ok(typeof plan.reason === 'string' && plan.reason.trim().length >= 30, 'the plan must explain why the other lanes still run');
ok(compLanePlan({ landPortalUsableCount: 0 }).mustRun.length >= 3, 'with no LandPortal comps every supplement lane obviously still runs');

// ── 5. The comp source policy exposes lane accountability ──────────────────
const SUBJECT = { state: 'MI', county: 'Grand Traverse', locality: 'Williamsburg', acres: 60 };
const candidate = (over: Record<string, unknown>) => ({
  provider: 'LandPortal', lane: 'sold', addressDesc: null, price: 400000, acres: 40,
  pricePerAcre: 10000, priceKind: 'sold', saleOrListDate: '2025-03-21', state: 'MI', ...over,
});
const candidates = [
  candidate({}), candidate({ acres: 85.32, price: 1100000, pricePerAcre: 12892.64 }),
  candidate({ acres: 39.94, price: 390000, pricePerAcre: 9764.65 }),
];

const withAttempts = applyCompSourcePolicy(SUBJECT as never, candidates as never, [
  { lane: 'landportal', attempted: true, candidates: 3, retained: 3 },
  { lane: 'zillow', attempted: true, candidates: 11, retained: 0, filteredReasons: ['improved property'] },
  { lane: 'redfin', attempted: true, candidates: 0, retained: 0 },
] as never);
ok(withAttempts.laneAccountability, 'applyCompSourcePolicy must expose laneAccountability on its result');
const policyLane = (id: string) => withAttempts.laneAccountability.lanes.find((e: { lane: string }) => e.lane === id)!;
ok(policyLane('landportal').status === 'retained', 'the policy result must report the LandPortal lane as retained');
ok(policyLane('redfin').status === 'ran_no_results', 'the policy result must report a genuinely empty Redfin search as ran_no_results');
ok(policyLane('realtor').status === 'not_run', 'Realtor.com was not supplied as an attempt, so it must be not_run, got "' + String(policyLane('realtor').status) + '"');

// Without lane attempts, absence of candidates is NOT evidence a search happened.
const noAttempts = applyCompSourcePolicy(SUBJECT as never, candidates as never);
ok(noAttempts.laneAccountability, 'laneAccountability must be present even when no lane attempts are supplied');
for (const id of ['zillow', 'redfin', 'realtor']) {
  const entry = noAttempts.laneAccountability.lanes.find((e: { lane: string }) => e.lane === id)!;
  ok(entry.status === 'not_run',
    'with no lane attempt recorded, "' + id + '" must be not_run — having no candidates is NOT proof a search ran; got "' + String(entry.status) + '"');
  ok(entry.candidates === null, 'an unrecorded lane must not manufacture a zero candidate count');
}

console.log('PROBE_OK comp lane accountability');
`;

const dir = mkdtempSync(path.join(os.tmpdir(), 'landos-probe-'));
const file = path.join(dir, 'probe.mts');
writeFileSync(file, script, 'utf8');

const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const run = spawnSync(process.execPath, [tsx, file], { cwd: root, encoding: 'utf8', timeout: 240000 });
const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
process.stdout.write(out);
if (run.status !== 0 && !out.includes('PROBE_FAIL')) {
  console.log(`PROBE_FAIL: comp lane accountability probe could not run (exit ${run.status}): ${String(run.stderr ?? run.error ?? '').slice(0, 700)}`);
}
process.exit(run.status === 0 ? 0 : 1);
