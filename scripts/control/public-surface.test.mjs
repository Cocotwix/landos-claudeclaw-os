import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = (relative) => readFileSync(path.resolve(relative), 'utf8');

function exportedFunctions(relative) {
  return [...source(relative).matchAll(/^export (?:async )?function ([A-Za-z0-9_]+)/gm)]
    .map((match) => match[1]);
}

const MUTATION_PREFIX = /^(?:initialize|openControlStateWriter|create|set|record|start|release|add|persist|submit|fail|runVerification|prepare|supersede|reconcile|deliver|register|ensure|acquire|runGovernedExecution|runTask)/;

const EXPECTED_MUTATION_EXPORTS = Object.freeze({
  'scripts/control/control-state.mjs': [
    'initializeControlState',
    'openControlStateWriter',
    'createTask',
    'setTaskContract',
    'recordDecision',
    'startAttempt',
    'startManagedAttempt',
    'releaseManagedWorkspace',
    'addEvidence',
    'recordContextPackDelivery',
    'persistCanonicalVerificationPlan',
    'submitCandidate',
    'recordManualReview',
    'failAttempt',
    'runVerification',
    'prepareAcceptance',
    'supersedeAcceptance',
    'reconcileAcceptance',
  ],
  'scripts/control/context-pack.mjs': ['deliverCanonicalContextPack'],
  'scripts/control/resource-ownership.mjs': [
    'registerPrimaryResource',
    'ensureProtectedPrimaryResources',
    'acquireResource',
    'releaseResource',
  ],
  'scripts/control/builder-adapter.mjs': ['runGovernedExecution'],
  'scripts/dev/task.mjs': ['runTask'],
});

test('every exported mutation surface is explicitly inventoried', () => {
  for (const [relative, expected] of Object.entries(EXPECTED_MUTATION_EXPORTS)) {
    const actual = exportedFunctions(relative)
      .filter((name) => MUTATION_PREFIX.test(name) && !['deliveredContextPack', 'createCanonicalContextPack'].includes(name))
      .sort();
    assert.deepEqual(actual, [...expected].sort(), relative);
  }
});

test('production execution and the legacy runner expose no persistence or executor injection seam', () => {
  const builder = source('scripts/control/builder-adapter.mjs');
  const legacy = source('scripts/dev/task.mjs');
  assert.doesNotMatch(builder, /persistBundle/);
  assert.match(builder, /unsupportedDependencies\.length/);
  assert.doesNotMatch(legacy, /deps\s*=|deps\.execute|persistBundle/);
  assert.match(legacy, /runGovernedExecution\(state\.db, root, options\)/);
});

test('read-only CLI commands are centrally classified and the generic verification recorder is absent', () => {
  const cli = source('scripts/control/landos-control.mjs');
  for (const expression of [
    "group === 'status'",
    "group === 'failures'",
    "group === 'state'",
    "group === 'verification' && action === 'plan'",
    "group === 'resource' && (action === 'inspect' || action === undefined)",
    "group === 'workspace' && (action === 'inspect' || action === undefined)",
  ]) assert.ok(cli.includes(expression), expression);
  assert.doesNotMatch(cli, /verification' && action === 'record'/);
  assert.doesNotMatch(source('scripts/control/control-state.mjs'), /^export function recordVerification\b/m);
});
