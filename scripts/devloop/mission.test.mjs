#!/usr/bin/env node
// Tests for the LandOS parallel-first mission harness.
//
// These cover the properties the harness is built to guarantee: the plan
// validator refuses graphs that would deadlock or let two concurrent writers
// corrupt each other, the scheduler actually launches independent lanes at the
// same time, discoveries reach the lanes that depend on them and nobody else,
// and a failure arrives at a repair worker as an exact assertion rather than a
// check name.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

import {
  ancestorsOf,
  briefingFor,
  createMission,
  createReporter,
  criticalPathLength,
  findCycle,
  harvestDiscoveries,
  loadDiscoveries,
  loadMission,
  overlappingConcurrentLanes,
  readyLanes,
  recordDiscovery,
  saveMission,
  setTerminalState,
  validatePlan,
} from './mission.mjs';
import { diagnoseFailure, formatDiagnosis, parseTypescript, parseVitest } from './diagnose.mjs';
import { launchBuilderAsync } from './builders.mjs';
import {
  GitReadError,
  changedSince,
  integrate,
  laneChangedPaths,
  outOfScope,
  prepareLaneWorkspace,
  snapshotTree,
} from './mission-exec.mjs';
import {
  captureBaseline,
  failureSignature,
  firstActionableFailure,
  preExistingReason,
  prepareMissionForResume,
} from './mission-cli.mjs';
import { analyse } from './watcher.mjs';

function sandbox() {
  const dir = mkdtempSync(path.join(tmpdir(), 'landos-mission-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const PLAN = {
  request: 'make the comps section easier to use',
  operatorOutcome: 'the operator can read the comps table without horizontal scrolling',
  lanes: [
    { id: 'recon', kind: 'recon', brief: 'find the comps component' },
    { id: 'ui', kind: 'build', brief: 'fix the table', dependsOn: ['recon'], ownedPaths: ['src/web/comps.tsx'] },
    { id: 'api', kind: 'build', brief: 'widen the payload', dependsOn: ['recon'], ownedPaths: ['src/landos/comps.ts'] },
  ],
  focusedChecks: [{ id: 'comps-unit', command: 'echo ok', requirement: 'comps unit tests pass' }],
};

// ------------------------------------------------------------ plan validation

test('a valid plan passes validation', () => {
  assert.deepEqual(validatePlan(PLAN), []);
});

test('a write lane must declare the paths it owns, because that ownership is what makes concurrency safe', () => {
  const issues = validatePlan({
    ...PLAN,
    lanes: [{ id: 'ui', kind: 'build', brief: 'fix', ownedPaths: [] }],
  });
  assert.ok(issues.some((issue) => issue.includes('must declare ownedPaths')));
});

test('two lanes that can run concurrently may not claim the same path', () => {
  const issues = validatePlan({
    ...PLAN,
    lanes: [
      { id: 'a', kind: 'build', brief: 'x', ownedPaths: ['src/landos/comps.ts'] },
      { id: 'b', kind: 'build', brief: 'y', ownedPaths: ['src/landos/comps.ts'] },
    ],
  });
  assert.ok(issues.some((issue) => issue.includes('can run at the same time and both claim')));
});

test('overlap is allowed when one lane depends on the other, because the scheduler serialises them', () => {
  const lanes = [
    { id: 'a', kind: 'build', brief: 'x', ownedPaths: ['src/landos/comps.ts'], dependsOn: [] },
    { id: 'b', kind: 'build', brief: 'y', ownedPaths: ['src/landos/comps.ts'], dependsOn: ['a'] },
  ];
  assert.deepEqual(overlappingConcurrentLanes(lanes), []);
  assert.deepEqual(validatePlan({ ...PLAN, lanes }), []);
});

test('a nested path counts as an overlap, not just an exact match', () => {
  const clashes = overlappingConcurrentLanes([
    { id: 'a', kind: 'build', ownedPaths: ['src/landos/'], dependsOn: [] },
    { id: 'b', kind: 'build', ownedPaths: ['src/landos/comps.ts'], dependsOn: [] },
  ]);
  assert.equal(clashes.length, 1);
});

test('a dependency cycle is refused rather than deadlocking the scheduler', () => {
  const lanes = [
    { id: 'a', kind: 'build', brief: 'x', ownedPaths: ['a'], dependsOn: ['b'] },
    { id: 'b', kind: 'build', brief: 'y', ownedPaths: ['b'], dependsOn: ['a'] },
  ];
  assert.ok(findCycle(lanes));
  assert.ok(validatePlan({ ...PLAN, lanes }).some((issue) => issue.includes('dependency cycle')));
});

test('an unknown dependency is refused', () => {
  const issues = validatePlan({
    ...PLAN,
    lanes: [{ id: 'a', kind: 'build', brief: 'x', ownedPaths: ['a'], dependsOn: ['ghost'] }],
  });
  assert.ok(issues.some((issue) => issue.includes('unknown lane "ghost"')));
});

// ---------------------------------------------------------------- scheduling

test('independent lanes become ready together, so they can launch concurrently', () => {
  const { dir, cleanup } = sandbox();
  try {
    const mission = createMission(dir, PLAN);
    assert.deepEqual(readyLanes(mission).map((lane) => lane.id), ['recon']);

    mission.lanes.find((lane) => lane.id === 'recon').status = 'complete';
    const ready = readyLanes(mission).map((lane) => lane.id);
    assert.deepEqual(ready.sort(), ['api', 'ui'], 'both dependants must be ready in the same wave');
  } finally {
    cleanup();
  }
});

test('critical path length is the floor on how serial a plan must be', () => {
  assert.equal(criticalPathLength(PLAN.lanes), 2);
  assert.equal(criticalPathLength([{ id: 'a', dependsOn: [] }, { id: 'b', dependsOn: [] }]), 1);
});

test('ancestors are transitive', () => {
  const lanes = [
    { id: 'a', dependsOn: [] },
    { id: 'b', dependsOn: ['a'] },
    { id: 'c', dependsOn: ['b'] },
  ];
  assert.deepEqual([...ancestorsOf(lanes, 'c')].sort(), ['a', 'b']);
});

// -------------------------------------------------------------- discoveries

test('a lane inherits discoveries from its ancestors and not from unrelated lanes', () => {
  const { dir, cleanup } = sandbox();
  try {
    const mission = createMission(dir, PLAN);
    recordDiscovery(dir, mission.missionId, {
      laneId: 'recon',
      kind: 'file',
      subject: 'src/web/comps.tsx',
      note: 'renders the comps table',
    });
    recordDiscovery(dir, mission.missionId, {
      laneId: 'ui',
      kind: 'file',
      subject: 'src/web/theme.ts',
      note: 'unrelated sibling finding',
    });

    const uiBrief = briefingFor(dir, mission, mission.lanes.find((lane) => lane.id === 'ui'));
    assert.match(uiBrief, /renders the comps table/, 'ui depends on recon, so it inherits recon findings');

    const apiBrief = briefingFor(dir, mission, mission.lanes.find((lane) => lane.id === 'api'));
    assert.match(apiBrief, /renders the comps table/);
    assert.doesNotMatch(apiBrief, /unrelated sibling finding/, 'api does not depend on ui and must not inherit its findings');
  } finally {
    cleanup();
  }
});

test('identical discoveries collapse, so a repeating lane costs nothing', () => {
  const { dir, cleanup } = sandbox();
  try {
    const mission = createMission(dir, PLAN);
    const entry = { laneId: 'recon', kind: 'file', subject: 'a.ts', note: 'same' };
    recordDiscovery(dir, mission.missionId, entry);
    recordDiscovery(dir, mission.missionId, entry);
    assert.equal(loadDiscoveries(dir, mission.missionId).length, 1);
  } finally {
    cleanup();
  }
});

test('discoveries are harvested out of a worker report', () => {
  const { dir, cleanup } = sandbox();
  try {
    const mission = createMission(dir, PLAN);
    const found = harvestDiscoveries(
      dir,
      mission.missionId,
      'recon',
      [
        'Some preamble the model wrote.',
        'DISCOVERY: file src/landos/comps.ts — owns the comp cap calculation in selectComps()',
        'DISCOVERY: test src/landos/comps.test.ts — covers cap behaviour, 4 cases',
        'Trailing prose.',
      ].join('\n'),
    );
    assert.equal(found.length, 2);
    assert.equal(found[0].kind, 'file');
    assert.equal(found[0].subject, 'src/landos/comps.ts');
    assert.match(found[0].note, /selectComps/);
    assert.equal(loadDiscoveries(dir, mission.missionId).length, 2);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------- diagnostics

const VITEST_OUTPUT = `
 FAIL  src/landos/comps.test.ts > selectComps > caps the comp count at five
AssertionError: expected 6 to be 5 // Object.is equality

- Expected
+ Received

- 5
+ 6

 ❯ src/landos/comps.test.ts:77:24

 Test Files  1 failed | 44 passed (45)
      Tests  1 failed | 6044 passed (6045)
`;

test('a vitest failure yields the exact file, title, assertion and expected/received', () => {
  const parsed = parseVitest(VITEST_OUTPUT);
  assert.equal(parsed.failures.length, 1);
  const [failure] = parsed.failures;
  assert.equal(failure.file, 'src/landos/comps.test.ts');
  assert.equal(failure.title, 'selectComps > caps the comp count at five');
  assert.match(failure.assertion, /expected 6 to be 5/);
  assert.equal(failure.expected, '5');
  assert.equal(failure.received, '6');
  assert.equal(failure.at, 'src/landos/comps.test.ts:77:24');
  assert.equal(parsed.failedCount, 1);
  assert.equal(parsed.passedCount, 6044);
});

// Verbatim vitest output, colour codes and all. The hand-written fixture above
// is not enough: every real run is coloured, and reading the raw text rather
// than the stripped text is precisely how the parser silently degraded to
// "unrecognised" on the only input that ever actually reaches it.
const E = '';
const VITEST_ANSI_OUTPUT = [
  `${E}[31m${E}[7m${E}[1m FAIL ${E}[22m${E}[27m${E}[39m ${E}[36mdemo.test.ts${E}[39m ${E}[2m>${E}[22m selectComps ${E}[2m>${E}[22m caps the comp count at five`,
  `${E}[31mAssertionError${E}[39m: expected 6 to be 5 // Object.is equality`,
  '',
  `${E}[32m- Expected${E}[39m`,
  `${E}[31m+ Received${E}[39m`,
  '',
  `${E}[32m- 5${E}[39m`,
  `${E}[31m+ 6${E}[39m`,
  '',
  `${E}[36m ${E}[2m❯${E}[22m demo.test.ts:${E}[2m9:55${E}[22m${E}[39m`,
  `${E}[2m Test Files ${E}[22m ${E}[1m${E}[31m1 failed${E}[39m${E}[22m${E}[90m (1)${E}[39m`,
  `${E}[2m      Tests ${E}[22m ${E}[1m${E}[31m1 failed${E}[39m${E}[22m${E}[90m (1)${E}[39m`,
].join('\n');

test('a real ANSI-coloured vitest failure is parsed, not degraded to unrecognised', () => {
  const diagnosis = diagnoseFailure({ id: 'comps-unit', exitCode: 1 }, VITEST_ANSI_OUTPUT);
  assert.equal(diagnosis.tool, 'vitest', 'coloured output must still be recognised as vitest');
  assert.equal(diagnosis.failures.length, 1);
  assert.equal(diagnosis.failures[0].file, 'demo.test.ts');
  assert.equal(diagnosis.failures[0].title, 'selectComps > caps the comp count at five');
  assert.match(diagnosis.failures[0].assertion, /expected 6 to be 5/);
  assert.equal(diagnosis.failures[0].at, 'demo.test.ts:9:55');
  assert.deepEqual(diagnosis.candidateFiles, ['demo.test.ts']);
});

test('a typescript error yields file, code and message', () => {
  const parsed = parseTypescript("src/landos/comps.ts(12,5): error TS2345: Argument of type 'string' is not assignable.");
  assert.equal(parsed.failures.length, 1);
  assert.equal(parsed.failures[0].file, 'src/landos/comps.ts');
  assert.match(parsed.failures[0].assertion, /not assignable/);
  assert.equal(parsed.failures[0].at, 'src/landos/comps.ts:12:5');
});

test('a repair brief separates new failures from ones that were already red on the baseline', () => {
  const check = { id: 'comps-unit', kind: 'command', command: 'npm test', exitCode: 1, requirement: 'comps tests pass' };
  const diagnosis = diagnoseFailure(check, VITEST_OUTPUT, {
    baselineFailures: [{ file: 'src/landos/comps.test.ts', title: 'selectComps > caps the comp count at five' }],
  });
  assert.equal(diagnosis.failures[0].preExisting, true);
  assert.equal(diagnosis.newFailures.length, 0);
  assert.match(formatDiagnosis(diagnosis), /pre-existing on baseline/);

  const fresh = diagnoseFailure(check, VITEST_OUTPUT);
  assert.equal(fresh.newFailures.length, 1);
  assert.deepEqual(fresh.candidateFiles, ['src/landos/comps.test.ts']);
});

test('an unrecognised failure still carries a usable tail rather than a bare check name', () => {
  const diagnosis = diagnoseFailure({ id: 'mystery', exitCode: 1 }, 'something went sideways\nline two');
  assert.equal(diagnosis.failures.length, 0);
  assert.match(diagnosis.rawTail, /something went sideways/);
  assert.match(formatDiagnosis(diagnosis), /no structured failure parsed/);
});

// --------------------------------------------------------------- containment

test('a lane writing outside the paths it owns is detected', () => {
  assert.deepEqual(outOfScope(['src/web/comps.tsx', 'src/landos/secret.ts'], ['src/web/']), ['src/landos/secret.ts']);
  assert.deepEqual(outOfScope(['src/web/comps.tsx'], ['src/web/']), []);
});

// ---------------------------------------------------------- concurrent launch

// The builder descriptors name bare commands on PATH ("claude", "codex"), but
// this stub is an absolute node path, and shell:true does not quote it. Quoting
// here keeps the stub honest: without it both processes die in ~40ms and the
// concurrency assertion below would pass for entirely the wrong reason.
// Plain quotes, not JSON.stringify: the latter escapes the backslashes in a
// Windows path and the shell then cannot resolve it.
const NODE = `"${process.execPath}"`;

// claimFrom reads the child's real stdout, so a stub that never ran cannot
// satisfy this test.
const claimFromOutput = (stdout) => (String(stdout).includes('ATTEMPT_COMPLETE') ? 'COMPLETE' : 'UNKNOWN');

// Concurrency proven by a barrier rather than by a stopwatch.
//
// The previous version launched two 300ms processes and asserted the pair
// finished in under 550ms. That measures the machine as much as the code: under
// load it failed while `launchBuilderAsync` was perfectly correct, which is the
// worst kind of test — it cries wolf about the one property it exists to guard.
//
// Here neither child can finish until BOTH have been spawned. A serial
// implementation would still be awaiting the first child's close when the
// second was due to start, so the second spawn never happens and the barrier
// never opens. Concurrency is therefore the only way this test can complete at
// all, and no amount of machine load can change that.
test('launchBuilderAsync really is concurrent: both workers are in flight at once', async () => {
  const { EventEmitter } = await import('node:events');
  const spawned = [];
  let openBarrier;
  const barrier = new Promise((resolve) => {
    openBarrier = resolve;
  });

  const spawnFn = () => {
    const child = new EventEmitter();
    child.pid = 4000 + spawned.length;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end() {} };
    spawned.push(child);
    if (spawned.length === 2) openBarrier();
    barrier.then(() => {
      child.stdout.emit('data', Buffer.from('ATTEMPT_COMPLETE'));
      child.emit('close', 0);
    });
    return child;
  };

  const builder = {
    id: 'stub',
    command: 'stub',
    claimFrom: claimFromOutput,
    invoke: () => ({ args: [], stdin: '' }),
  };

  const results = await Promise.all([
    launchBuilderAsync(builder, { cwd: '.', promptText: 'a', attemptDir: '.' }, { spawnFn }),
    launchBuilderAsync(builder, { cwd: '.', promptText: 'b', attemptDir: '.' }, { spawnFn }),
  ]);

  assert.equal(spawned.length, 2, 'both builders must be in flight before either may finish');
  for (const result of results) {
    assert.equal(result.launched, true);
    assert.equal(result.claim, 'COMPLETE', 'the claim must come from the child stdout the launcher actually read');
  }
});

test('a builder that overruns its timeout is reported as timed out, not hung forever', async () => {
  const { dir, cleanup } = sandbox();
  try {
    const builder = {
      id: 'stub',
      command: NODE,
      claimFrom: claimFromOutput,
      invoke: () => ({ args: ['-e', '"setTimeout(()=>{},60000)"'], stdin: '' }),
    };
    const startedAt = Date.now();
    const result = await launchBuilderAsync(builder, { cwd: dir, promptText: 'x', attemptDir: dir, timeoutMs: 400 });
    assert.equal(result.timedOut, true, `expected a timeout, got exit ${result.exitCode}: ${result.stderr}`);
    assert.equal(result.launched, false);
    assert.ok(Date.now() - startedAt < 10_000, 'the timeout must actually terminate the child, not wait for it');
  } finally {
    cleanup();
  }
});

// ------------------------------------------------------- state and telemetry

test('mission state round-trips and carries a machine-detectable terminal state', () => {
  const { dir, cleanup } = sandbox();
  try {
    const mission = createMission(dir, PLAN);
    assert.equal(mission.status, 'running');
    assert.equal(mission.terminalState, null);
    setTerminalState(dir, mission, 'PASS', 'everything green');
    const reloaded = loadMission(dir, mission.missionId);
    assert.equal(reloaded.terminalState, 'PASS');
    assert.equal(reloaded.status, 'closed');
    assert.throws(() => setTerminalState(dir, mission, 'MAYBE', 'x'), /Unknown terminal state/);
  } finally {
    cleanup();
  }
});

test('telemetry writes one timestamped line and one event per phase', () => {
  const { dir, cleanup } = sandbox();
  try {
    const mission = createMission(dir, PLAN);
    const lines = [];
    const report = createReporter(dir, mission, { write: (line) => lines.push(line) });
    report('lane.start', { message: 'lane ui started' });
    assert.match(lines[0], /^\d\d:\d\d {2}lane ui started$/);
  } finally {
    cleanup();
  }
});

// ------------------------------------------------- the two harness CLI tools
//
// plan-doctor and mission-report were built by a mission rather than by hand.
// That is not a reason to commit them without coverage: accepted behaviour is
// protected behaviour, and the one-off plan whose focused checks first proved
// them is not a permanent test.

test('plan-doctor accepts a valid plan and prints the wave schedule it would run', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/devloop/plan-doctor.mjs', 'scripts/devloop/plans/example-good.json'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /wave 1: recon/);
  assert.match(result.stdout, /wave 2: backend, frontend|wave 2: frontend, backend/);
  assert.match(result.stdout, /peak concurrency: 2/);
});

test('plan-doctor refuses an invalid plan with exit 2 and names every structural issue', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/devloop/plan-doctor.mjs', 'scripts/devloop/plans/example-bad.json'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 2);
  const text = `${result.stdout}${result.stderr}`;
  assert.match(text, /ownedPaths/, 'the missing-ownership issue must be reported');
  assert.match(text, /dependency cycle/, 'the cycle must be reported in the same pass, not hidden behind the first issue');
});

test('plan-doctor exits 2 rather than throwing when the plan file is missing', () => {
  const result = spawnSync(process.execPath, ['scripts/devloop/plan-doctor.mjs', 'no/such/plan.json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
});

test('mission-report renders a usable summary for a passing and a failing mission', () => {
  const result = spawnSync(process.execPath, ['scripts/devloop/probes/mission-report-probe.mjs'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

// ------------------------------------------------------------------ watcher

test('the watcher names the waste rather than just counting agents', () => {
  const mission = {
    lanes: [
      { id: 'a', kind: 'recon', status: 'complete', durationMs: 1000, discoveryCount: 0, changedPaths: [] },
      { id: 'b', kind: 'build', status: 'complete', durationMs: 1000, changedPaths: [], outOfScopePaths: ['x.ts'] },
    ],
    peakConcurrency: 1,
    repairs: [{ checkId: 'unit' }, { checkId: 'unit' }],
  };
  const findings = analyse(mission, [], []);
  const kinds = findings.map((finding) => finding.kind);
  assert.ok(kinds.includes('no-parallelism'));
  assert.ok(kinds.includes('useless-recon'));
  assert.ok(kinds.includes('repeated-repair'));
  assert.ok(kinds.includes('scope-miss'));
});

// ------------------------------------------------- pre-existing baseline red
//
// A real mission ended FAIL because of the gap these cover. Its focused check
// was `npx vitest run scripts/devloop/mission.test.mjs` — a command that cannot
// execute, because vitest does not collect `scripts/**`. It exited 1 with no
// per-test detail, so the old baseline recorded ZERO pre-existing failures, the
// identical failure after integration was charged to the builder, and both
// repair attempts were spent on code that was never broken.

test('a baseline check that fails with no per-test detail is recorded as red, not as clean', async () => {
  const { redChecks, failures } = await captureBaseline(
    [{ id: 'unrunnable', command: 'node -e "console.log(\'No test files found, exiting with code 1\')" && exit 1', requirement: 'r' }],
    () => {},
  );
  assert.equal(failures.length, 0, 'there is genuinely no parseable per-test failure');
  assert.equal(redChecks.length, 1, 'but the check itself was red before any lane ran');
  assert.equal(redChecks[0].id, 'unrunnable');
  assert.equal(redChecks[0].parsedFailures, 0);
  assert.ok(redChecks[0].detail, 'the raw evidence is kept so the operator can see why');
});

test('a clean baseline records no red checks', async () => {
  const { redChecks, failures } = await captureBaseline([{ id: 'fine', command: 'exit 0', requirement: 'r' }], () => {});
  assert.deepEqual(redChecks, []);
  assert.deepEqual(failures, []);
});

test('a check that fails identically to baseline is never handed to a repair worker', () => {
  const output = 'No test files found, exiting with code 1';
  const baselineRed = new Map([['unrunnable', { id: 'unrunnable', exitCode: 1, parsedFailures: 0, signature: failureSignature(output) }]]);
  const results = [{ id: 'unrunnable', kind: 'command', pass: false, exitCode: 1, output }];
  const actionable = firstActionableFailure(results, { baselineFailures: [], baselineRed });
  assert.equal(actionable.preExistingOnly, true, 'nothing any lane wrote moved it, so repairing it is waste');
  assert.match(preExistingReason(actionable.diagnosis, [{ id: 'unrunnable', exitCode: 1, parsedFailures: 0 }]), /EXACTLY as it did before/);
});

// The distinction that matters: a focused check written for behaviour the
// mission is meant to CREATE is red at baseline by design. Turning it green is
// the entire job, so it must still be repaired. Only a check nothing can move
// is abandoned.
test('a check red at baseline for behaviour the mission must build is still repaired', () => {
  const baselineOutput = "Cannot find module 'scripts/knowledge/query.test.mjs'";
  const baselineRed = new Map([['query-unit', { id: 'query-unit', exitCode: 1, parsedFailures: 0, signature: failureSignature(baselineOutput) }]]);
  const results = [
    { id: 'query-unit', kind: 'command', pass: false, exitCode: 1, output: 'tests 3\nfail 1\nnot ok 2 - suggests the closest topics' },
  ];
  const actionable = firstActionableFailure(results, { baselineFailures: [], baselineRed });
  assert.equal(actionable.preExistingOnly, false, 'the lane moved the failure, so a repair worker can finish it');
});

test('the same unparseable failure is repaired normally when the baseline was clean', () => {
  const results = [{ id: 'unrunnable', kind: 'command', pass: false, exitCode: 1, output: 'No test files found, exiting with code 1' }];
  const actionable = firstActionableFailure(results, { baselineFailures: [], baselineRed: new Map() });
  assert.equal(actionable.preExistingOnly, false, 'a genuinely new failure is still the builder to answer for');
});

test('a real new failure behind an unrepairable one is what the repair worker receives', () => {
  const stale = 'No test files found, exiting with code 1';
  const baselineRed = new Map([['stale', { id: 'stale', exitCode: 1, parsedFailures: 0, signature: failureSignature(stale) }]]);
  const results = [
    { id: 'stale', kind: 'command', pass: false, exitCode: 1, output: stale },
    {
      id: 'real',
      kind: 'command',
      pass: false,
      exitCode: 1,
      output: ' FAIL  src/landos/comps.test.ts > caps the set\n    AssertionError: expected 3 to be 2\n',
    },
  ];
  const actionable = firstActionableFailure(results, { baselineFailures: [], baselineRed });
  assert.equal(actionable.preExistingOnly, false);
  assert.equal(actionable.diagnosis.checkId, 'real', 'the stuck check must not mask the genuine one');
  assert.equal(actionable.diagnosis.newFailures.length, 1);
});

test('the failure signature ignores volatile detail but not the failure itself', () => {
  assert.equal(failureSignature('done in 41ms'), failureSignature('done in 907ms'));
  assert.notEqual(failureSignature('No test files found'), failureSignature('not ok 2 - suggests the closest topics'));
});

// ------------------------------------------------- repair-lane scope accuracy
//
// A repair lane works on the primary tree, which legitimately carries unrelated
// uncommitted work. Measuring "what is dirty" there answered the wrong question
// and blamed one repair for six files it never opened.

test('a shared-workspace lane reports only the files it actually changed', () => {
  const { dir, cleanup } = sandbox();
  try {
    spawnSync('git', ['init'], { cwd: dir });
    writeFileSync(path.join(dir, 'unrelated.txt'), 'pre-existing uncommitted work\n');
    writeFileSync(path.join(dir, 'touched.txt'), 'before\n');

    const before = snapshotTree(dir);
    assert.equal(before.size, 2, 'both files are dirty before the lane runs');

    writeFileSync(path.join(dir, 'touched.txt'), 'after\n');
    writeFileSync(path.join(dir, 'created.txt'), 'new\n');

    assert.deepEqual(
      changedSince(dir, before),
      ['created.txt', 'touched.txt'],
      'unrelated.txt was dirty throughout and is not this lane’s doing',
    );
  } finally {
    cleanup();
  }
});

test('a shared-workspace lane that changes nothing reports nothing', () => {
  const { dir, cleanup } = sandbox();
  try {
    spawnSync('git', ['init'], { cwd: dir });
    writeFileSync(path.join(dir, 'unrelated.txt'), 'pre-existing\n');
    const before = snapshotTree(dir);
    assert.deepEqual(changedSince(dir, before), [], 'a no-op repair must not inherit the tree’s dirt');
  } finally {
    cleanup();
  }
});

// ------------------------------------------- unreadable is not empty
//
// The defect these cover cost a whole sprint. Every git read below used to be
// consumed as `.stdout` alone, so a read that FAILED and a read that returned
// nothing were the same value. Six lanes that had written thousands of lines
// were reported as "0 file(s) changed" and "empty diff", and their work was
// discarded as though they had been idle. The rule is now: a failed read is
// never evidence of absence.

test('laneChangedPaths throws rather than reporting zero changes when git cannot be read', () => {
  const { dir, cleanup } = sandbox();
  try {
    // Not a git repository: `git status` exits non-zero and prints nothing to
    // stdout — precisely the shape that used to read as "the lane changed
    // nothing".
    assert.throws(() => laneChangedPaths(dir), GitReadError, 'an unreadable worktree must not look idle');
  } finally {
    cleanup();
  }
});

test('snapshotTree throws rather than returning an empty baseline when git cannot be read', () => {
  const { dir, cleanup } = sandbox();
  try {
    assert.throws(() => snapshotTree(dir), GitReadError);
  } finally {
    cleanup();
  }
});

test('a genuinely clean worktree still reports zero changes, so the fix does not cry wolf', () => {
  const { dir, cleanup } = sandbox();
  try {
    spawnSync('git', ['init'], { cwd: dir });
    assert.deepEqual(laneChangedPaths(dir), [], 'a real, readable, clean tree is legitimately empty');
  } finally {
    cleanup();
  }
});

test('a resumed lane whose worktree already exists is still measured', () => {
  const { dir, cleanup } = sandbox();
  try {
    const mission = { missionId: 'm-resume', lanes: [] };
    const laneId = 'resumed';
    const target = path.join(dir, '.runtime', 'devloop', 'm-resume', 'lanes', laneId, 'worktree');
    mkdirSync(target, { recursive: true });
    const workspace = prepareLaneWorkspace(dir, mission, { id: laneId, kind: 'build' });
    assert.equal(workspace.isolated, true);
    assert.equal(
      workspace.measure,
      true,
      'an existing worktree used to come back without `measure`, so runLane took its `: []` branch and the ' +
        'resumed lane reported zero changed paths and zero out-of-scope paths no matter what it did',
    );
    assert.equal(workspace.reused, true);
  } finally {
    cleanup();
  }
});

test('integration reports a read failure instead of calling an unreadable lane empty', () => {
  const { dir, cleanup } = sandbox();
  try {
    spawnSync('git', ['init'], { cwd: dir });
    writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
    spawnSync('git', ['add', '-A'], { cwd: dir });
    spawnSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-m', 'seed'], { cwd: dir });

    // A complete lane whose worktree cannot be read at all — the directory is
    // gone, so git cannot even start. Previously this produced "empty diff" and
    // the lane's work was discarded as though it had been idle. (A directory
    // merely lacking its own .git would NOT do: nested inside this repo, git
    // walks up and succeeds.)
    const strandedWorktree = path.join(dir, 'vanished-worktree');
    const mission = {
      missionId: 'm-readfail',
      lanes: [
        {
          id: 'stranded',
          kind: 'build',
          status: 'complete',
          changedPaths: ['src/thing.ts'],
          ownedPaths: ['src/thing.ts'],
          worktree: path.relative(dir, strandedWorktree),
        },
      ],
    };
    const outcome = integrate(dir, mission, { report: null });
    const entry = outcome.lanes.find((lane) => lane.laneId === 'stranded');
    assert.equal(outcome.integrated, false);
    assert.equal(entry.readFailure, true, 'a failed read must be labelled a read failure');
    assert.notEqual(entry.reason, 'empty diff', 'a read failure must never be reported as an empty diff');
    assert.match(entry.reason, /failed/i);
    assert.ok(entry.stderr, 'the diagnostic evidence must be preserved, not swallowed');
    // git that could not start at all has no exit status; the reason it could
    // not start is in stderr, and that is the evidence that must survive.
    assert.ok(entry.status === null || typeof entry.status === 'number');
    assert.ok('status' in entry, 'the exit status must be recorded even when it is null');
  } finally {
    cleanup();
  }
});

test('integration recovers a lane whose own change measurement failed', () => {
  const { dir, cleanup } = sandbox();
  try {
    spawnSync('git', ['init'], { cwd: dir });
    writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
    spawnSync('git', ['add', '-A'], { cwd: dir });
    spawnSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-m', 'seed'], { cwd: dir });
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();

    const worktree = path.join(dir, 'lane-worktree');
    spawnSync('git', ['worktree', 'add', '--detach', worktree, head], { cwd: dir });
    writeFileSync(path.join(worktree, 'seed.txt'), 'lane rewrote this\n');
    writeFileSync(path.join(worktree, 'brand-new.ts'), 'export const added = true;\n');

    const mission = {
      missionId: 'm-recover',
      lanes: [
        {
          id: 'unmeasured',
          kind: 'build',
          status: 'complete',
          // null, not []: the lane's own measurement failed. This must NOT be
          // read as "the lane changed nothing".
          changedPaths: null,
          changedPathsRead: 'failed',
          ownedPaths: ['seed.txt', 'brand-new.ts'],
          worktree: path.relative(dir, worktree),
        },
      ],
    };
    mkdirSync(path.join(dir, '.runtime', 'devloop', 'm-recover', 'lanes', 'unmeasured'), { recursive: true });

    const outcome = integrate(dir, mission, { report: null });
    const entry = outcome.lanes.find((lane) => lane.laneId === 'unmeasured');
    assert.equal(entry.applied, true, 'work whose measurement failed must still integrate');
    assert.deepEqual(entry.files, ['brand-new.ts', 'seed.txt'], 'the file list is recovered from the staged diff');
    assert.equal(
      readFileSync(path.join(dir, 'brand-new.ts'), 'utf8').trim(),
      'export const added = true;',
      'the recovered patch actually reached the primary tree',
    );
  } finally {
    cleanup();
  }
});

test('a lane that truly changed nothing is still reported as changing nothing', () => {
  const { dir, cleanup } = sandbox();
  try {
    spawnSync('git', ['init'], { cwd: dir });
    writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
    spawnSync('git', ['add', '-A'], { cwd: dir });
    spawnSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-m', 'seed'], { cwd: dir });
    const mission = {
      missionId: 'm-idle',
      lanes: [{ id: 'idle', kind: 'build', status: 'complete', changedPaths: [], ownedPaths: ['x.ts'], worktree: '.' }],
    };
    const outcome = integrate(dir, mission, { report: null });
    assert.equal(outcome.lanes[0].reason, 'lane changed nothing');
    assert.equal(outcome.integrated, true, 'an idle lane is not a failure');
  } finally {
    cleanup();
  }
});

test('post-integration resume keeps applied patches and integrates only newly completed lanes', () => {
  const { dir, cleanup } = sandbox();
  try {
    spawnSync('git', ['init'], { cwd: dir });
    writeFileSync(path.join(dir, 'already.txt'), 'before\n');
    spawnSync('git', ['add', '-A'], { cwd: dir });
    spawnSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-m', 'seed'], { cwd: dir });
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();

    writeFileSync(path.join(dir, 'already.txt'), 'integrated earlier\n');
    spawnSync('git', ['add', 'already.txt'], { cwd: dir });

    const worktree = path.join(dir, 'new-lane-worktree');
    spawnSync('git', ['worktree', 'add', '--detach', worktree, head], { cwd: dir });
    writeFileSync(path.join(worktree, 'new.txt'), 'new lane\n');
    mkdirSync(path.join(dir, '.runtime', 'devloop', 'm-resumed', 'lanes', 'new-lane'), { recursive: true });

    const mission = {
      missionId: 'm-resumed',
      lanes: [
        { id: 'already', kind: 'build', status: 'complete', changedPaths: ['already.txt'], worktree: '.' },
        { id: 'new-lane', kind: 'build', status: 'complete', changedPaths: ['new.txt'], worktree: path.relative(dir, worktree) },
      ],
      integration: {
        integrated: true,
        lanes: [{ laneId: 'already', applied: true, reason: null, files: ['already.txt'] }],
        files: ['already.txt'],
      },
    };

    const outcome = integrate(dir, mission, { report: null });
    assert.equal(outcome.integrated, true);
    assert.equal(outcome.lanes.find((entry) => entry.laneId === 'already').alreadyApplied, true);
    assert.equal(readFileSync(path.join(dir, 'already.txt'), 'utf8'), 'integrated earlier\n');
    assert.equal(readFileSync(path.join(dir, 'new.txt'), 'utf8').replace(/\r\n/g, '\n'), 'new lane\n');
    assert.deepEqual(outcome.files, ['already.txt', 'new.txt']);
  } finally {
    cleanup();
  }
});

test('resume retries authored unfinished lanes without replaying failed repair workers', () => {
  const mission = {
    terminalState: 'FAIL',
    terminalReason: 'repair provider quota',
    lanes: [
      { id: 'done', kind: 'build', status: 'complete' },
      { id: 'unfinished', kind: 'build', status: 'failed', error: 'quota' },
      { id: 'repair-1', kind: 'repair', status: 'failed', error: 'quota' },
    ],
  };
  const result = prepareMissionForResume(mission);
  assert.deepEqual(mission.lanes.map((lane) => lane.id), ['done', 'unfinished']);
  assert.equal(mission.lanes[1].status, 'pending');
  assert.equal(mission.lanes[1].error, null);
  assert.deepEqual(result.kept, ['done']);
  assert.deepEqual(result.retried, ['unfinished']);
  assert.deepEqual(result.abandonedRepairs.map((lane) => lane.id), ['repair-1']);
  assert.equal(mission.terminalState, null);
});

test('integration treats completed primary-workspace repairs as already applied', () => {
  const { dir, cleanup } = sandbox();
  try {
    spawnSync('git', ['init'], { cwd: dir });
    writeFileSync(path.join(dir, 'fixed.ts'), 'before\n');
    spawnSync('git', ['add', '-A'], { cwd: dir });
    spawnSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-m', 'seed'], { cwd: dir });
    writeFileSync(path.join(dir, 'fixed.ts'), 'repaired on primary\n');

    const mission = {
      missionId: 'm-primary-repair',
      lanes: [
        {
          id: 'repair-2',
          kind: 'repair',
          status: 'complete',
          workspace: 'primary',
          changedPaths: ['fixed.ts'],
          worktree: '.',
        },
      ],
    };
    const outcome = integrate(dir, mission, { report: null });
    assert.equal(outcome.integrated, true);
    assert.equal(outcome.lanes[0].alreadyApplied, true);
    assert.equal(readFileSync(path.join(dir, 'fixed.ts'), 'utf8'), 'repaired on primary\n');
  } finally {
    cleanup();
  }
});
