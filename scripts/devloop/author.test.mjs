#!/usr/bin/env node
// Tests for automatic mission authoring — the LandOS front door.
//
// These cover the parts that must be right without a builder in the loop: how a
// request is classified, how a plan is extracted from a worker's prose, and the
// mechanical repairs that stop Tyler ever being handed generated JSON to fix.
// The one end-to-end test drives authorMission with a stubbed launcher, so the
// pipeline is exercised without spending builder time.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  authorMission,
  composeAuthorPrompt,
  composeReconPrompt,
  extractPlan,
  harvestReconDiscoveries,
  isDetailedSpec,
  lintAuthoredPlan,
  repairCheckCommand,
  repairPlan,
} from './author.mjs';
import { validatePlan } from './mission.mjs';

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), 'landos-author-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ------------------------------------------------------------ classification

test('a one-line request is a short request, a pasted specification is not', () => {
  assert.equal(isDetailedSpec('clean up the comps section and make the map easier to understand'), false);
  assert.equal(isDetailedSpec(['# Sprint', '', 'Scope:', '- a', '- b', '', 'Acceptance:', '- c'].join('\n')), true);
  assert.equal(isDetailedSpec('x'.repeat(500)), true);
});

// ---------------------------------------------------------------- extraction

test('the plan is read out of the last fenced json block, ignoring prose around it', () => {
  const reply = [
    'Here is my reasoning about the repository.',
    '```json',
    '{"request":"first draft","lanes":[{"id":"a","kind":"recon","brief":"b"}]}',
    '```',
    'On reflection the graph should be:',
    '```json',
    '{"request":"final","lanes":[{"id":"b","kind":"recon","brief":"b"}]}',
    '```',
    'ATTEMPT_COMPLETE',
  ].join('\n');
  assert.equal(extractPlan(reply).request, 'final');
});

test('an unfenced plan is still recovered, and prose with no plan yields null', () => {
  assert.equal(extractPlan('sure: {"request":"r","lanes":[{"id":"a","kind":"recon","brief":"b"}]} done').request, 'r');
  assert.equal(extractPlan('I could not work out the architecture. ATTEMPT_BLOCKED'), null);
  assert.equal(extractPlan('```json\n{"notAPlan":true}\n```'), null);
});

// ------------------------------------------------------------------- repairs

test('lane ids are slugged and every edge pointing at the old id follows', () => {
  const { plan, repairs } = repairPlan({
    request: 'r',
    lanes: [
      { id: 'Recon Lane', kind: 'recon', brief: 'look' },
      { id: 'build', kind: 'build', brief: 'do', ownedPaths: ['src/a.ts'], dependsOn: ['Recon Lane'] },
    ],
  });
  assert.equal(plan.lanes[0].id, 'recon-lane');
  assert.deepEqual(plan.lanes[1].dependsOn, ['recon-lane']);
  assert.equal(validatePlan(plan).length, 0);
  assert.ok(repairs.some((line) => line.includes('recon-lane')));
});

test('a duplicate lane id is made unique instead of colliding', () => {
  const { plan } = repairPlan({
    request: 'r',
    lanes: [
      { id: 'build', kind: 'build', brief: 'one', ownedPaths: ['src/a.ts'] },
      { id: 'build', kind: 'build', brief: 'two', ownedPaths: ['src/b.ts'] },
    ],
  });
  assert.deepEqual(plan.lanes.map((lane) => lane.id), ['build', 'build-2']);
  assert.equal(validatePlan(plan).length, 0);
});

test('an edge to a lane that does not exist is dropped, not fatal', () => {
  const { plan, repairs } = repairPlan({
    request: 'r',
    lanes: [{ id: 'build', kind: 'build', brief: 'do', ownedPaths: ['src/a.ts'], dependsOn: ['ghost'] }],
  });
  assert.deepEqual(plan.lanes[0].dependsOn, []);
  assert.ok(repairs.some((line) => line.includes('ghost')));
  assert.equal(validatePlan(plan).length, 0);
});

test('a dependency cycle is broken so the scheduler cannot deadlock', () => {
  const { plan, repairs } = repairPlan({
    request: 'r',
    lanes: [
      { id: 'a', kind: 'build', brief: 'a', ownedPaths: ['src/a.ts'], dependsOn: ['b'] },
      { id: 'b', kind: 'build', brief: 'b', ownedPaths: ['src/b.ts'], dependsOn: ['a'] },
    ],
  });
  assert.equal(validatePlan(plan).length, 0);
  assert.ok(repairs.some((line) => line.includes('cycle')));
});

test('two concurrent lanes claiming the same file are serialised, not deleted', () => {
  const { plan, repairs } = repairPlan({
    request: 'r',
    lanes: [
      { id: 'a', kind: 'build', brief: 'a', ownedPaths: ['src/shared.ts'] },
      { id: 'b', kind: 'build', brief: 'b', ownedPaths: ['src/shared.ts'] },
    ],
  });
  assert.equal(plan.lanes.length, 2, 'no lane may be discarded to resolve a collision');
  assert.deepEqual(plan.lanes[1].dependsOn, ['a']);
  assert.equal(validatePlan(plan).length, 0);
  assert.ok(repairs.some((line) => line.includes('waits for')));
});

test('a recon lane that claimed write paths loses them, and a kindless lane is inferred', () => {
  const { plan } = repairPlan({
    request: 'r',
    lanes: [
      { id: 'recon', kind: 'recon', brief: 'look', ownedPaths: ['src/a.ts'] },
      { id: 'build', brief: 'do', ownedPaths: ['src\\b.ts'] },
      { id: 'look-more', brief: 'read only' },
    ],
  });
  assert.deepEqual(plan.lanes[0].ownedPaths, []);
  assert.equal(plan.lanes[1].kind, 'build');
  assert.deepEqual(plan.lanes[1].ownedPaths, ['src/b.ts'], 'windows separators are normalised for git');
  assert.equal(plan.lanes[2].kind, 'recon');
  assert.equal(validatePlan(plan).length, 0);
});

test('repairPlan does not mutate the plan it was given', () => {
  const original = { request: 'r', lanes: [{ id: 'A', kind: 'build', brief: 'x', ownedPaths: ['src/a.ts'] }] };
  repairPlan(original);
  assert.equal(original.lanes[0].id, 'A');
});

// ---------------------------------------------------------------------- lint

test('a plan with no focused check gets one, so a wrong candidate can be disproved cheaply', () => {
  const { plan, notes } = lintAuthoredPlan({
    request: 'r',
    operatorOutcome: 'o',
    lanes: [{ id: 'a', kind: 'build', brief: 'x', ownedPaths: ['src/a.ts'] }],
  });
  assert.equal(plan.focusedChecks.length, 1);
  assert.match(plan.focusedChecks[0].command, /typecheck/);
  assert.deepEqual(plan.acceptanceCriteria, ['o']);
  assert.equal(notes.length, 2);
});

test('an operator-facing plan with no browser check gets a real localhost assertion', () => {
  const { plan, notes } = lintAuthoredPlan({
    request: 'r',
    operatorOutcome: 'o',
    acceptanceCriteria: ['o'],
    focusedChecks: [{ id: 'unit', command: 'echo', requirement: 'r' }],
    lanes: [{ id: 'ui', kind: 'build', brief: 'x', ownedPaths: ['src/web/Comps.tsx'] }],
  });
  assert.deepEqual(plan.browserCheck.commands, ['npm run landos:restart']);
  assert.match(plan.browserCheck.url, /^http:\/\/localhost:/);
  assert.ok(notes.some((note) => note.includes('browserCheck')));
});

// This is the defect a real authored mission actually hit: Codex wrote
// `npx vitest run scripts/devloop/mission.test.mjs`, which exits 1 with "No test
// files found" whatever the code does, so the harness spent both repair attempts
// on a check that could never pass and the mission ended FAIL.
test('a check pointing vitest at a file vitest cannot collect is rewritten to node --test', () => {
  assert.deepEqual(repairCheckCommand('npx vitest run scripts/devloop/mission.test.mjs').command, 'node --test scripts/devloop/mission.test.mjs');
  assert.match(repairCheckCommand('npx vitest run scripts/devloop/mission.test.mjs').note, /cannot run/);
  assert.equal(repairCheckCommand('npx vitest run scripts/devloop/a.test.mjs scripts/devloop/b.test.mjs').command, 'node --test scripts/devloop/a.test.mjs scripts/devloop/b.test.mjs');
});

test('a check vitest genuinely can run is left exactly as authored', () => {
  for (const command of [
    'npx vitest run src/landos/comps.test.ts',
    'npx vitest run web/src/lib/format.test.ts',
    'npm test',
    'npm run typecheck',
    'node --test scripts/devloop/mission.test.mjs',
    'npm run landos:build:test',
  ]) {
    const repaired = repairCheckCommand(command);
    assert.equal(repaired.command, command, command);
    assert.equal(repaired.note, null, command);
  }
});

test('a check mixing both runners is left for the operator rather than half-fixed', () => {
  const command = 'npx vitest run src/landos/comps.test.ts scripts/devloop/mission.test.mjs';
  assert.equal(repairCheckCommand(command).command, command);
  assert.equal(repairCheckCommand(command).note, null);
});

test('lintAuthoredPlan repairs an unrunnable check in both check groups', () => {
  const { plan, notes } = lintAuthoredPlan({
    request: 'r',
    operatorOutcome: 'o',
    acceptanceCriteria: ['o'],
    focusedChecks: [{ id: 'harness', command: 'npx vitest run scripts/devloop/mission.test.mjs', requirement: 'r' }],
    validationChecks: [{ id: 'harness-full', command: 'npx vitest run scripts/devloop/devloop.test.mjs', requirement: 'r' }],
    lanes: [{ id: 'a', kind: 'build', brief: 'x', ownedPaths: ['scripts/devloop/plan-doctor.mjs'] }],
  });
  assert.equal(plan.focusedChecks[0].command, 'node --test scripts/devloop/mission.test.mjs');
  assert.equal(plan.validationChecks[0].command, 'node --test scripts/devloop/devloop.test.mjs');
  assert.equal(notes.length, 2);
});

test('the author is told the two runners are not interchangeable', () => {
  const prompt = composeAuthorPrompt({ request: 'x', detailed: false, builderIds: ['cc'] });
  assert.match(prompt, /TWO TEST RUNNERS/);
  assert.match(prompt, /node --test scripts\/devloop/);
  assert.match(prompt, /No test files found/);
});

test('a backend-only plan is not given a browser check it does not need', () => {
  const { plan } = lintAuthoredPlan({
    request: 'r',
    operatorOutcome: 'o',
    acceptanceCriteria: ['o'],
    focusedChecks: [{ id: 'unit', command: 'echo', requirement: 'r' }],
    lanes: [{ id: 'api', kind: 'build', brief: 'x', ownedPaths: ['src/landos/comps.ts'] }],
  });
  assert.equal(plan.browserCheck, undefined);
});

// --------------------------------------------------------------- discoveries

test('DISCOVERY lines from every recon worker are harvested once each', () => {
  const entries = harvestReconDiscoveries([
    { id: 'surface', text: 'DISCOVERY: file src/web/Comps.tsx — renders the comps table\nnoise\nDISCOVERY: route /deals/:id — the page' },
    { id: 'server', text: 'DISCOVERY: file src/web/Comps.tsx — renders the comps table\nDISCOVERY: symbol selectComps — caps the set' },
  ]);
  assert.equal(entries.length, 3, 'the duplicate across two workers collapses');
  assert.deepEqual(entries[0], { kind: 'file', subject: 'src/web/Comps.tsx', note: 'renders the comps table', from: 'surface' });
  assert.ok(entries.some((entry) => entry.kind === 'symbol' && entry.from === 'server'));
});

// ------------------------------------------------------------------- prompts

test('a detailed specification is marked authoritative and a short request is not', () => {
  const spec = composeAuthorPrompt({ request: 'x', detailed: true, builderIds: ['cc', 'codex'] });
  assert.match(spec, /AUTHORITATIVE/);
  assert.match(spec, /Do NOT summarise/);
  assert.match(spec, /AVAILABLE BUILDERS: cc, codex/);

  const short = composeAuthorPrompt({ request: 'x', detailed: false, builderIds: ['cc'] });
  assert.match(short, /Do not ask questions\. Decide\./);
  assert.doesNotMatch(short, /AUTHORITATIVE/);
});

test('a rejected plan is re-asked with the exact validator issues, never handed to the operator', () => {
  const prompt = composeAuthorPrompt({
    request: 'x',
    detailed: false,
    issues: ['write lane "ui" must declare ownedPaths'],
    previousPlan: { request: 'x', lanes: [] },
  });
  assert.match(prompt, /REJECTED BY THE VALIDATOR/);
  assert.match(prompt, /must declare ownedPaths/);
});

test('a recon worker is told it cannot write and must name real paths', () => {
  const prompt = composeReconPrompt('x', 'which files own it?');
  assert.match(prompt, /READ-ONLY/);
  assert.match(prompt, /DISCOVERY: <kind> <subject>/);
  assert.match(prompt, /A guessed path is worse than/);
});

// ------------------------------------------------------------------ pipeline

test('authorMission runs recon concurrently, then authors and validates a launchable plan', async () => {
  const { dir, cleanup } = scratch();
  try {
    let inFlight = 0;
    let peak = 0;
    const calls = [];

    const launch = async (builder, options) => {
      calls.push(options.promptText);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;

      const recon = /YOUR QUESTION:/.test(options.promptText);
      const stdout = recon
        ? 'DISCOVERY: file src/web/Comps.tsx — renders the comps table\nATTEMPT_COMPLETE'
        : [
            '```json',
            JSON.stringify({
              request: 'ignored, the harness overwrites this',
              operatorOutcome: 'the comps table is readable',
              acceptanceCriteria: ['the comps table is readable'],
              lanes: [
                { id: 'UI Lane', kind: 'build', brief: 'edit the table', ownedPaths: ['src/web/Comps.tsx'], dependsOn: ['ghost'] },
                { id: 'api', kind: 'build', brief: 'edit the selector', ownedPaths: ['src/landos/comps.ts'] },
              ],
              focusedChecks: [{ id: 'comps', command: 'npx vitest run src/landos/comps.test.ts', requirement: 'comps tests pass' }],
            }),
            '```',
            'ATTEMPT_COMPLETE',
          ].join('\n');
      return { builderId: builder.id, launched: true, exitCode: 0, durationMs: 10, stdout, stderr: '', finalMessage: null, claim: 'COMPLETE', error: null };
    };

    const { plan, planPath, record, discoveries } = await authorMission({
      root: dir,
      request: 'make the comps table easier to read',
      launch,
      registry: [{ id: 'cc', label: 'Claude Code', command: 'node', version: ['--version'], invoke: () => ({ args: [] }), claimFrom: () => 'COMPLETE' }],
    });

    assert.equal(peak, 3, 'the three reconnaissance questions must run at once, not in sequence');
    assert.equal(calls.length, 4, 'three recon workers plus one author');
    assert.equal(validatePlan(plan).length, 0);
    assert.equal(plan.request, 'make the comps table easier to read', 'the operator request is preserved verbatim');
    assert.equal(plan.lanes[0].id, 'ui-lane', 'authoring mistakes are repaired, not returned');
    assert.deepEqual(plan.lanes[0].dependsOn, []);
    assert.ok(plan.browserCheck, 'an operator-facing plan is given a localhost assertion');
    assert.equal(discoveries.length, 1);
    assert.equal(record.authorAttempts, 1);
    assert.equal(record.mode, 'short-request');
    assert.ok(record.timings.totalMs >= 0);

    const written = JSON.parse(readFileSync(planPath, 'utf8'));
    assert.equal(written.authoring.authoringId, record.authoringId);
  } finally {
    cleanup();
  }
});

test('authorMission re-asks the author automatically when the first plan is unlaunchable', async () => {
  const { dir, cleanup } = scratch();
  try {
    let authorCalls = 0;
    const launch = async (builder, options) => {
      const recon = /YOUR QUESTION:/.test(options.promptText);
      let stdout = 'DISCOVERY: file src/a.ts — owns it\nATTEMPT_COMPLETE';
      if (!recon) {
        authorCalls += 1;
        const body =
          authorCalls === 1
            ? { request: 'r', lanes: [{ id: 'ui', kind: 'build', brief: 'do it' }] } // no ownedPaths: unfixable mechanically
            : { request: 'r', operatorOutcome: 'o', lanes: [{ id: 'ui', kind: 'build', brief: 'do it', ownedPaths: ['src/a.ts'] }] };
        stdout = ['```json', JSON.stringify(body), '```'].join('\n');
      }
      return { builderId: 'cc', launched: true, exitCode: 0, durationMs: 1, stdout, stderr: '', finalMessage: null, claim: 'COMPLETE', error: null };
    };

    const { plan, record } = await authorMission({
      root: dir,
      request: 'do a thing',
      reconCount: 1,
      launch,
      registry: [{ id: 'cc', label: 'Claude Code', command: 'node', version: ['--version'], invoke: () => ({ args: [] }), claimFrom: () => 'COMPLETE' }],
    });

    assert.equal(authorCalls, 2, 'the validator issues go back to the author, never to the operator');
    assert.equal(record.authorAttempts, 2);
    assert.equal(validatePlan(plan).length, 0);
  } finally {
    cleanup();
  }
});

test('authoring fails loudly rather than launching an invalid mission', async () => {
  const { dir, cleanup } = scratch();
  try {
    const launch = async (builder, options) => ({
      builderId: 'cc',
      launched: true,
      exitCode: 0,
      durationMs: 1,
      stdout: /YOUR QUESTION:/.test(options.promptText) ? 'DISCOVERY: file a — b' : 'I have no idea. ATTEMPT_BLOCKED',
      stderr: '',
      finalMessage: null,
      claim: 'BLOCKED',
      error: null,
    });
    await assert.rejects(
      authorMission({
        root: dir,
        request: 'do a thing',
        reconCount: 1,
        launch,
        registry: [{ id: 'cc', label: 'Claude Code', command: 'node', version: ['--version'], invoke: () => ({ args: [] }), claimFrom: () => 'BLOCKED' }],
      }),
      /Mission authoring failed after 2 attempt/,
    );
  } finally {
    cleanup();
  }
});
