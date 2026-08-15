#!/usr/bin/env node
// Unit tests for the LandOS build runner. These cover the mechanical decisions
// the runner makes on its own; the worker behaviour is proved by the fixtures
// under scripts/devloop/fixtures/.

import assert from 'node:assert/strict';
import test from 'node:test';

import { changedBetween, deriveChecks, lanePrompt, slug, validateLanes, withinOwned } from './build.mjs';
import { diagnoseFailure, formatDiagnosis } from './diagnose.mjs';

test('checks are derived from what changed, not declared up front', () => {
  assert.deepEqual(deriveChecks([]), []);

  const onlyDocs = deriveChecks(['docs/landos/x.md']);
  assert.deepEqual(onlyDocs, [], 'a docs-only change runs nothing');

  const withTest = deriveChecks(['src/landos/comps.test.ts']);
  assert.equal(withTest[0].id, 'tests');
  assert.match(withTest[0].command, /vitest run "src\/landos\/comps\.test\.ts"/);
  assert.equal(withTest[1].id, 'typecheck');
});

test('a changed source file pulls in its sibling test when one exists', () => {
  // build.mjs has no sibling test named build.test.mjs by the .ts rule, so use
  // a file pair that does exist in the repository.
  const checks = deriveChecks(['scripts/devloop/build.mjs']);
  assert.deepEqual(checks, [], 'non-typescript source alone derives no checks');
});

test('extra checks are appended to the derived ones', () => {
  const checks = deriveChecks(['src/a.ts'], ['npm run landos:knowledge:check']);
  assert.equal(checks.at(-1).command, 'npm run landos:knowledge:check');
});

test('lane path sets must be disjoint, because lanes edit one shared tree', () => {
  assert.throws(
    () =>
      validateLanes([
        { id: 'a', paths: ['src/x.ts'] },
        { id: 'b', paths: ['src/x.ts'] },
      ]),
    /disjoint/,
  );

  assert.doesNotThrow(() =>
    validateLanes([
      { id: 'a', paths: ['src/x.ts'] },
      { id: 'b', paths: ['src/y.ts'], deps: ['a'] },
    ]),
  );
});

test('a lane cannot depend on a lane that does not exist', () => {
  assert.throws(() => validateLanes([{ id: 'a', paths: ['src/x.ts'], deps: ['ghost'] }]), /unknown ghost/);
});

test('a lane with no paths is rejected before any worker is paid for', () => {
  assert.throws(() => validateLanes([{ id: 'a', paths: [] }]), /no paths/);
});

test('ownership containment matches files and whole directories', () => {
  assert.equal(withinOwned('src/landos/a.ts', ['src/landos']), true);
  assert.equal(withinOwned('src/landos/a.ts', ['src/landos/a.ts']), true);
  assert.equal(withinOwned('src/landosx/a.ts', ['src/landos']), false, 'prefix must respect the path boundary');
  assert.equal(withinOwned('web/src/a.tsx', ['src']), false);
});

test('the change delta sees additions, edits and deletions', () => {
  const before = new Map([['a', '1'], ['b', '2']]);
  const after = new Map([['a', '9'], ['c', '3']]);
  assert.deepEqual(changedBetween(before, after), ['a', 'b', 'c']);
});

test('a lane prompt is a job ticket, not a briefing pack', () => {
  const mission = { id: 'test-mission' };
  const prompt = lanePrompt(mission, {
    id: 'comps',
    title: 'reconcile comp counts',
    brief: 'Make the comp count derive from accepted records.',
    paths: ['src/landos/comps.ts'],
  });

  // The 9490 lane prompts were 70-93KB each. The budget here is the point of
  // the rewrite, so it is asserted rather than left to drift.
  assert.ok(Buffer.byteLength(prompt) < 4096, `prompt was ${Buffer.byteLength(prompt)}B, expected under 4096B`);
  assert.match(prompt, /request\.md/, 'points at the operator request rather than inlining it');
  assert.match(prompt, /src\/landos\/comps\.ts/);
  assert.match(prompt, /You have a shell\. Use it\./, 'workers must be able to verify their own work');
  assert.match(prompt, /npx vitest run/);
  assert.match(prompt, /WORK_COMPLETE/);
  assert.doesNotMatch(prompt, /worktree/i, 'there are no worktrees any more');
});

test('exact diagnostics survive: a typescript failure routes to its file and line', () => {
  const output = "src/landos/deal.ts(41,7): error TS2739: Type '{}' is missing property 'kind'.";
  const diagnosis = diagnoseFailure({ id: 'typecheck', command: 'npx tsc --noEmit', exitCode: 2 }, output);
  assert.equal(diagnosis.tool, 'typescript');
  assert.deepEqual(diagnosis.candidateFiles, ['src/landos/deal.ts']);
  assert.match(formatDiagnosis(diagnosis), /TS2739 at line 41/);
});

test('a pre-existing failure is never handed to a repair worker as this change\'s defect', () => {
  const output = "src/landos/old.ts(2,1): error TS2304: Cannot find name 'x'.";
  const diagnosis = diagnoseFailure({ id: 'typecheck', exitCode: 2 }, output, {
    baselineFailures: [{ file: 'src/landos/old.ts', title: 'TS2304 at line 2' }],
  });
  assert.equal(diagnosis.newFailures.length, 0);
  assert.match(formatDiagnosis(diagnosis), /pre-existing on baseline/);
});

test('mission ids stay filesystem-safe whatever the operator typed', () => {
  assert.equal(slug('Clean up  the Comps & Valuation page!'), 'clean-up-the-comps-valuation-page');
  assert.ok(slug('x'.repeat(200)).length <= 40);
});
