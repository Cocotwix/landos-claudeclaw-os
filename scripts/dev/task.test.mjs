import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './task.mjs';

test('legacy task path refuses free-form provider lifecycle input', () => {
  assert.throws(() => parseArgs(['--engine', 'codex', 'make', 'a', 'change']), /only governed flags/i);
  assert.throws(() => parseArgs(['--task', 't']), /delegates only/i);
});

test('legacy flags map exactly to the governed execution contract', () => {
  assert.deepEqual(parseArgs([
    '--task', 't', '--attempt', 'a', '--writer', 'w', '--cwd', 'C:/work',
    '--provider', 'codex', '--context-pack', 'a'.repeat(64),
  ]), {
    taskId: 't', attemptId: 'a', writerId: 'w', cwd: 'C:/work', provider: 'codex',
    contextPackHash: 'a'.repeat(64), model: undefined, sessionId: undefined,
    outputPath: undefined, resume: false, root: undefined,
  });
});

test('legacy task path has no injectable execution or persistence dependency', () => {
  const source = readFileSync(fileURLToPath(new URL('./task.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /deps\s*=|deps\.execute|persistBundle/);
  assert.match(source, /openControlStateWriter/);
  assert.match(source, /runGovernedExecution\(state\.db, root, options\)/);
});
