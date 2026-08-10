import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getBuilder, listBuilders, nextBuilderId, probeBuilders } from './builders.mjs';
import { changedSince, dirtySnapshot } from './devloop-cli.mjs';
import { composeDiagnosis, decideBuilderSwitch, outOfScopePaths, parseGitStatus, runCheck } from './evaluator.mjs';
import { applyCorrections, composeInstructions } from './instructions.mjs';
import { assertNotDoctrine, deriveCandidateLessons, loadCandidateLessons, recordCandidateLesson } from './lessons.mjs';
import { assertInsideRun, createRun, loadRun, recordAttempt, runDir, specMode, validateSpec } from './run-state.mjs';
import { buildAcceptedPatchPackage } from './patch-package.mjs';
import { assertPrimaryUnchanged, removeRunWorktree, unlinkJunctions, worktreePath } from './worktree.mjs';

function sandbox() {
  return mkdtempSync(path.join(tmpdir(), 'devloop-test-'));
}

const SPEC = {
  task: 'demo task',
  operatorOutcome: 'the demo outcome is visible',
  builderBrief: 'build the demo',
  allowedPaths: ['scripts/dev/'],
  checks: [
    { id: 'exists', kind: 'file-exists', path: 'scripts/dev/demo.mjs', requirement: 'demo.mjs exists' },
    { id: 'contained', kind: 'scope-containment', requirement: 'nothing outside scripts/dev/ changed' },
  ],
};

test('acceptance criteria are frozen at run creation and verified on every load', () => {
  const root = sandbox();
  try {
    const { run } = createRun(root, SPEC, { runId: 'demo-run-one' });
    assert.equal(loadRun(root, 'demo-run-one').criteria.checks.length, 2);

    const criteriaFile = path.join(runDir(root, 'demo-run-one'), 'criteria.json');
    const tampered = JSON.parse(readFileSync(criteriaFile, 'utf8'));
    tampered.checks = tampered.checks.slice(0, 1);
    writeFileSync(criteriaFile, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');

    assert.throws(() => loadRun(root, 'demo-run-one'), /immutable/);
    assert.equal(run.criteriaSha256.length, 64);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a run id cannot be reused and runs cannot write outside their own directory', () => {
  const root = sandbox();
  try {
    createRun(root, SPEC, { runId: 'demo-run-two' });
    assert.throws(() => createRun(root, SPEC, { runId: 'demo-run-two' }), /already exists/);

    createRun(root, SPEC, { runId: 'demo-run-three' });
    assert.notEqual(runDir(root, 'demo-run-two'), runDir(root, 'demo-run-three'));
    assert.throws(() => assertInsideRun(root, 'demo-run-two', runDir(root, 'demo-run-three')), /escaped run/);
    assert.throws(() => assertInsideRun(root, 'demo-run-two', path.join(root, '.landos', 'CHECKPOINT.md')), /escaped run/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the evaluator decides from its own check runs, not from a builder claim', () => {
  const failing = runCheck(
    { id: 'tests', kind: 'command', command: 'node --test nope.test.mjs', requirement: 'tests pass' },
    { root: '.' },
    { exec: () => ({ status: 1, stdout: '', stderr: 'no such file', error: null }) },
  );
  assert.equal(failing.pass, false);
  assert.match(failing.detail, /no such file/);

  const passing = runCheck(
    { id: 'tests', kind: 'command', command: 'node --test ok.test.mjs', requirement: 'tests pass' },
    { root: '.' },
    { exec: () => ({ status: 0, stdout: 'ok', stderr: '', error: null }) },
  );
  assert.equal(passing.pass, true);
});

test('scope containment flags only what the attempt changed outside its allowed paths', () => {
  const changed = ['scripts/dev/new.mjs', '.runtime/devloop/x/run.json', 'package.json'];
  assert.deepEqual(outOfScopePaths(changed, ['scripts/dev/']), ['package.json']);
  assert.deepEqual(outOfScopePaths(changed, ['scripts/dev/', 'package.json']), []);
  assert.deepEqual(outOfScopePaths([], ['scripts/dev/']), []);
  assert.deepEqual([...parseGitStatus('R  old/a.ts -> new/b.ts\n')], ['new/b.ts']);

  const check = runCheck(
    { id: 'contained', kind: 'scope-containment', requirement: 'nothing outside scripts/dev/ changed' },
    { root: '.', allowedPaths: ['scripts/dev/'], changedPaths: ['package.json'] },
  );
  assert.equal(check.pass, false);
  assert.deepEqual(check.outOfScopePaths, ['package.json']);
});

test('an attempt is only charged with the paths it changed itself', () => {
  // The baseline is the snapshot taken immediately before the attempt. A path
  // that appeared between run creation and this attempt, from anyone else, is
  // not the builder's doing. Loop artifacts are never the builder's doing.
  const before = {
    hashes: { 'src/landos/db.ts': 'a', 'docs/landos/note-by-someone-else.md': 'b', 'scripts/dev/existing.mjs': 'c' },
  };
  const after = {
    hashes: {
      'src/landos/db.ts': 'a',
      'docs/landos/note-by-someone-else.md': 'b',
      // rewritten in place: an untracked file keeps the same `?? path` status
      // line, so only the content hash reveals it.
      'scripts/dev/existing.mjs': 'c2',
      'scripts/dev/new.mjs': 'd',
      '.runtime/devloop/run-x/run.json': 'e',
    },
  };
  assert.deepEqual(changedSince(before, after), ['scripts/dev/existing.mjs', 'scripts/dev/new.mjs']);
  assert.deepEqual(changedSince(after, after), []);
});

test('a snapshot hashes the dirty set so an in-place rewrite is visible', () => {
  const root = sandbox();
  try {
    mkdirSync(path.join(root, 'scripts', 'dev'), { recursive: true });
    const file = path.join(root, 'scripts', 'dev', 'x.mjs');
    const status = '?? scripts/dev/x.mjs\n?? .runtime/devloop/ignored.json\n';
    writeFileSync(file, 'first', 'utf8');
    const before = dirtySnapshot(root, status);
    writeFileSync(file, 'second', 'utf8');
    const after = dirtySnapshot(root, status);
    assert.equal(before.statusText, after.statusText);
    assert.deepEqual(changedSince(before, after), ['scripts/dev/x.mjs']);
    assert.equal('.runtime/devloop/ignored.json' in after.hashes, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a run worktree is per-run, and a change to the primary worktree stops the run', () => {
  const root = sandbox();
  try {
    createRun(root, SPEC, { runId: 'demo-run-five' });
    createRun(root, SPEC, { runId: 'demo-run-six' });
    // Isolation is per run: two runs never share a working directory.
    assert.notEqual(worktreePath(root, 'demo-run-five'), worktreePath(root, 'demo-run-six'));
    assert.equal(worktreePath(root, 'demo-run-five'), path.join(runDir(root, 'demo-run-five'), 'worktree'));

    // The guarantee is checked, not assumed.
    assert.equal(assertPrimaryUnchanged([], { runId: 'demo-run-five', attemptNumber: 1 }), true);
    assert.throws(
      () => assertPrimaryUnchanged(['src/landos/db.ts'], { runId: 'demo-run-five', attemptNumber: 1 }),
      /Isolation broken.*src\/landos\/db\.ts/s,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a run records its own worktree and defaults to not sharing node_modules', () => {
  const root = sandbox();
  try {
    const { run } = createRun(root, SPEC, { runId: 'demo-run-seven' });
    assert.equal(run.worktree, null);
    assert.equal(run.shareNodeModules, false);
    const opted = createRun(root, { ...SPEC, shareNodeModules: true }, { runId: 'demo-run-eight' });
    assert.equal(opted.run.shareNodeModules, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the prompt tells a builder it is in an isolated worktree carrying earlier attempts', () => {
  const root = sandbox();
  try {
    const { run, criteria } = createRun(root, SPEC, { runId: 'demo-run-nine' });
    const prompt = composeInstructions({ run, criteria, attemptNumber: 2, builderId: 'codex' });
    assert.match(prompt, /isolated git worktree created for this run/);
    assert.match(prompt, /not the owner's working checkout/);
    assert.match(prompt, /left their work in this same worktree/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a failing evaluation produces a GOAL PROVEN FAILED CAUSE NEXT diagnosis', () => {
  const criteria = { operatorOutcome: 'the demo outcome is visible', checks: SPEC.checks };
  const results = [
    { id: 'exists', kind: 'file-exists', requirement: 'demo.mjs exists', pass: true, detail: 'ok' },
    {
      id: 'broad',
      kind: 'module-probe',
      requirement: 'the broad rule holds',
      pass: false,
      detail: 'PROBE_FAIL: only .env was flagged',
      next: 'Widen the rule.',
    },
  ];
  const diagnosis = composeDiagnosis(criteria, results, { builderLaunch: { launched: true, claim: 'COMPLETE' } });
  assert.deepEqual(Object.keys(diagnosis), ['GOAL', 'PROVEN', 'FAILED', 'CAUSE', 'NEXT']);
  assert.equal(diagnosis.GOAL, 'the demo outcome is visible');
  assert.match(diagnosis.PROVEN.join(' '), /exists/);
  assert.match(diagnosis.FAILED.join(' '), /only \.env was flagged/);
  assert.match(diagnosis.CAUSE, /evaluator's own probe/);
  assert.deepEqual(diagnosis.NEXT, ['Widen the rule.']);
});

test('the loop switches builders only when it can name the reason', () => {
  const run = { attempts: [] };
  const failed = [{ id: 'broad', kind: 'module-probe', pass: false }];
  const rotate = (current) => (current === 'cc' ? 'codex' : 'cc');

  const overclaim = decideBuilderSwitch(
    { run, builderId: 'cc', builderLaunch: { launched: true, claim: 'COMPLETE' }, checkResults: failed, changedPaths: ['scripts/dev/a.mjs'] },
    rotate,
  );
  assert.equal(overclaim.switch, true);
  assert.equal(overclaim.to, 'codex');
  assert.equal(overclaim.rule, 'overclaimed');

  const honest = decideBuilderSwitch(
    { run, builderId: 'cc', builderLaunch: { launched: true, claim: 'BLOCKED' }, checkResults: failed, changedPaths: ['scripts/dev/a.mjs'] },
    rotate,
  );
  assert.equal(honest.switch, false);
  assert.equal(honest.rule, 'keep');

  const soloPool = decideBuilderSwitch(
    { run, builderId: 'cc', builderLaunch: { launched: false, exitCode: 1, claim: 'UNKNOWN' }, checkResults: failed, changedPaths: [] },
    () => 'cc',
  );
  assert.equal(soloPool.switch, false);
  assert.match(soloPool.reason, /no other builder is available/);

  const repeat = decideBuilderSwitch(
    {
      run: { attempts: [{ builderId: 'codex', failedCheckIds: ['broad'] }] },
      builderId: 'codex',
      builderLaunch: { launched: true, claim: 'BLOCKED' },
      checkResults: failed,
      changedPaths: ['scripts/dev/a.mjs'],
    },
    rotate,
  );
  assert.equal(repeat.rule, 'repeat_failure');
  assert.equal(repeat.to, 'cc');
});

test('improved instructions carry the failed criterion into the next standalone prompt', () => {
  const root = sandbox();
  try {
    const { run, criteria } = createRun(root, SPEC, { runId: 'demo-run-four' });
    recordAttempt(root, run, {
      attemptNumber: 1,
      builderId: 'cc',
      startedAt: new Date().toISOString(),
      builder: { claim: 'COMPLETE' },
      evaluation: { verdict: 'FAIL', checks: [{ id: 'exists', pass: false }] },
      builderSwitch: { switch: true },
    });
    applyCorrections(run, {
      afterAttempt: 1,
      byBuilder: 'cc',
      items: [{ checkId: 'exists', requirement: 'demo.mjs exists', observed: 'not created', instruction: 'Create scripts/dev/demo.mjs.' }],
    });

    const prompt = composeInstructions({ run, criteria, attemptNumber: 2, builderId: 'codex' });
    assert.match(prompt, /attempt 2/);
    assert.match(prompt, /Create scripts\/dev\/demo\.mjs\./);
    assert.match(prompt, /attempt 1 by builder `cc` claimed COMPLETE/);
    assert.match(prompt, /An independent evaluator, not you, decides PASS or FAIL\./);
    assert.match(prompt, /ATTEMPT_COMPLETE/);
    // Standalone: the next builder is never told to go read another session.
    assert.doesNotMatch(prompt, /previous session|see the earlier chat/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('candidate lessons are recorded for repeats and never rewrite canonical governance', () => {
  const root = sandbox();
  try {
    for (const doctrine of ['.landos/PERMANENT_MEMORY.md', '.landos/CODING_SESSION_PROTOCOL.md', 'CLAUDE.md', 'AGENTS.md']) {
      assert.throws(() => assertNotDoctrine(doctrine), /never writes canonical governance/);
    }
    assert.throws(() => recordCandidateLesson(root, { runId: 'r', pattern: 'p', proposedTarget: 'CLAUDE.md' }), /never writes/);

    const criteria = { checks: [{ id: 'broad', requirement: 'the broad rule holds' }] };
    const once = { runId: 'r1', attempts: [{ builderId: 'cc', failedCheckIds: ['broad'] }] };
    assert.deepEqual(deriveCandidateLessons(once, criteria), []);

    const twice = {
      runId: 'r1',
      attempts: [
        { builderId: 'cc', failedCheckIds: ['broad'] },
        { builderId: 'codex', failedCheckIds: ['broad'] },
      ],
    };
    const [lesson] = deriveCandidateLessons(twice, criteria);
    assert.match(lesson.statement, /the broad rule holds/);
    recordCandidateLesson(root, lesson);
    const stored = loadCandidateLessons(root).lessons[0];
    assert.equal(stored.status, 'candidate');
    assert.equal(stored.appliedAutomatically, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('real-task mode is the default and a selftest spec must say so', () => {
  const root = sandbox();
  try {
    assert.equal(specMode(SPEC), 'real');
    assert.equal(specMode({ ...SPEC, mode: 'selftest' }), 'selftest');
    assert.deepEqual(validateSpec({ ...SPEC, mode: 'nonsense' }).filter((issue) => issue.includes('mode')).length, 1);
    assert.equal(createRun(root, SPEC, { runId: 'demo-run-ten' }).run.mode, 'real');
    assert.equal(createRun(root, { ...SPEC, mode: 'selftest' }, { runId: 'demo-run-eleven' }).run.mode, 'selftest');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('builder readiness is established up front and one usable builder is enough', () => {
  const registry = [
    { id: 'cc', label: 'Claude Code', command: 'claude', version: ['--version'] },
    { id: 'codex', label: 'OpenAI Codex', command: 'codex', version: ['--version'] },
  ];
  const both = probeBuilders(registry, {
    run: (command) => ({ status: 0, stdout: `${command} 9.9.9`, stderr: '' }),
    now: () => new Date('2026-08-10T00:00:00.000Z'),
  });
  assert.deepEqual(both.available, ['cc', 'codex']);
  assert.equal(both.switchingPossible, true);
  assert.equal(both.builders[0].version, 'claude 9.9.9');
  assert.equal(both.checkedAt, '2026-08-10T00:00:00.000Z');

  const oneDown = probeBuilders(registry, {
    run: (command) => (command === 'codex' ? { status: 1, stdout: '', stderr: 'not found' } : { status: 0, stdout: 'claude 9.9.9', stderr: '' }),
  });
  assert.deepEqual(oneDown.available, ['cc']);
  assert.deepEqual(oneDown.unavailable, ['codex']);
  // Switching is impossible, which is a fact about the fleet, not a failure.
  assert.equal(oneDown.switchingPossible, false);
  const kept = decideBuilderSwitch(
    {
      run: { attempts: [] },
      builderId: 'cc',
      builderLaunch: { launched: true, claim: 'COMPLETE' },
      checkResults: [{ id: 'x', kind: 'command', pass: false }],
      changedPaths: ['scripts/dev/a.mjs'],
    },
    () => 'cc',
  );
  assert.equal(kept.switch, false);
  assert.match(kept.reason, /no other builder is available/);
});

test('a PASS produces a review package that is explicitly not applied', () => {
  const root = sandbox();
  try {
    const { run, criteria } = createRun(root, SPEC, { runId: 'demo-run-twelve' });
    run.worktreeHead = 'abc1234';
    run.worktree = '.runtime/devloop/demo-run-twelve/worktree';
    run.builderReadiness = { builders: [{ id: 'cc', label: 'Claude Code', available: true, version: '2.1.226' }] };
    run.attempts = [{ attemptNumber: 1, builderId: 'cc', claim: 'COMPLETE', verdict: 'PASS', failedCheckIds: [], switched: false }];
    const attempt = {
      attemptNumber: 1,
      builderId: 'cc',
      evaluation: { verdict: 'PASS', checks: [{ id: 'exists', kind: 'file-exists', pass: true, requirement: 'demo.mjs exists', detail: 'ok' }] },
    };
    const calls = [];
    const fakeGit = (command, args) => {
      calls.push(args[0]);
      if (args[0] === 'diff' && args.includes('--name-only')) return { status: 0, stdout: 'scripts/dev/demo.mjs\n', stderr: '' };
      if (args[0] === 'diff') return { status: 0, stdout: '--- a\n+++ b\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    const pkg = buildAcceptedPatchPackage(root, { run, criteria, attempt, workspace: '/tmp/ws' }, { run: fakeGit });

    assert.deepEqual(pkg.files, ['scripts/dev/demo.mjs']);
    assert.equal(pkg.apply.appliesCleanly, true);
    assert.ok(calls.includes('add'), 'untracked work must be registered before diffing');
    const manifest = JSON.parse(readFileSync(path.join(pkg.directory, 'package.json'), 'utf8'));
    assert.equal(manifest.applied, false);
    assert.equal(manifest.baseCommit, 'abc1234');
    assert.equal(manifest.acceptedBuilder, 'cc');
    assert.equal(manifest.criteriaSha256, run.criteriaSha256);
    const summary = readFileSync(path.join(pkg.directory, 'SUMMARY.md'), 'utf8');
    assert.match(summary, /\*\*Not applied\.\*\*/);
    assert.match(summary, /scripts\/dev\/demo\.mjs/);
    assert.equal(readFileSync(pkg.diffPath, 'utf8'), '--- a\n+++ b\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cleanup removes only a run worktree git actually owns, and keeps the evidence', () => {
  const root = sandbox();
  try {
    const { run } = createRun(root, SPEC, { runId: 'demo-run-thirteen' });
    assert.deepEqual(removeRunWorktree(root, 'demo-run-thirteen'), { removed: false, reason: 'no worktree present', junctions: [] });

    // A directory that is not a registered worktree of this repository is never
    // deleted, however much it looks like one.
    mkdirSync(worktreePath(root, 'demo-run-thirteen'), { recursive: true });
    assert.throws(() => removeRunWorktree(root, 'demo-run-thirteen'), /does not list it as a worktree/);
    assert.equal(existsSync(worktreePath(root, 'demo-run-thirteen')), true);

    // Run history survives cleanup by construction: it lives beside the
    // worktree, not inside it.
    assert.equal(existsSync(path.join(runDir(root, run.runId), 'criteria.json')), true);
    assert.deepEqual(unlinkJunctions(worktreePath(root, 'demo-run-thirteen')), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the builder interface is agent-neutral: a third agent joins by registration alone', () => {
  const ids = listBuilders().map((builder) => builder.id);
  assert.deepEqual(ids, ['cc', 'codex']);
  assert.throws(() => getBuilder('deepseek'), /Unknown builder/);

  const withThird = ['cc', 'codex', 'deepseek'];
  assert.equal(nextBuilderId('cc', withThird), 'codex');
  assert.equal(nextBuilderId('codex', withThird), 'deepseek');
  assert.equal(nextBuilderId('deepseek', withThird), 'cc');
  assert.equal(nextBuilderId('cc', ['cc']), 'cc');

  for (const builder of listBuilders()) {
    const descriptor = getBuilder(builder.id);
    assert.equal(typeof descriptor.invoke, 'function');
    assert.equal(typeof descriptor.claimFrom, 'function');
    assert.equal(descriptor.claimFrom('all done ATTEMPT_COMPLETE', ''), 'COMPLETE');
    assert.equal(descriptor.claimFrom('ATTEMPT_BLOCKED missing api', ''), 'BLOCKED');
    assert.equal(descriptor.claimFrom('no claim at all', ''), 'UNKNOWN');
    // A builder that echoes its prompt repeats both tokens; only its own
    // sign-off, which comes last, is the claim.
    const echoedPrompt = 'End with ATTEMPT_COMPLETE, or ATTEMPT_BLOCKED and the reason.\n---\nDone. ATTEMPT_COMPLETE';
    assert.equal(descriptor.claimFrom(echoedPrompt, ''), 'COMPLETE');
  }
});
