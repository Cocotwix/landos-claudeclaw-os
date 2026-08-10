// Evaluator-owned probe. Builds a throwaway git repository in the OS temp
// directory (never inside the run worktree) and checks that gitDirtyCount
// counts the files inside an untracked directory rather than the directory.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function fail(reason) {
  console.log(`PROBE_FAIL: ${reason}`);
  process.exit(1);
}

const target = path.resolve('scripts/memory/landos-memory.mjs');
let mod;
try {
  mod = await import(pathToFileURL(target).href);
} catch (error) {
  fail(`could not import scripts/memory/landos-memory.mjs (${error.message})`);
}
if (typeof mod.gitDirtyCount !== 'function') fail('scripts/memory/landos-memory.mjs no longer exports gitDirtyCount');

const sandbox = mkdtempSync(path.join(tmpdir(), 'landos-dirty-count-'));
function git(args) {
  const result = spawnSync('git', ['-C', sandbox, ...args], { encoding: 'utf8' });
  if (result.status !== 0) fail(`probe setup failed: git ${args.join(' ')} -> ${result.stderr?.trim()}`);
}

try {
  git(['init']);
  writeFileSync(path.join(sandbox, 'tracked.txt'), 'one\n', 'utf8');
  git(['add', 'tracked.txt']);
  git(['-c', 'user.email=probe@landos.local', '-c', 'user.name=probe', 'commit', '-m', 'base']);

  // One modified tracked file, plus a wholly untracked directory holding three
  // files. `git status --short` collapses that directory to a single `?? dir/`
  // line, which is the defect.
  writeFileSync(path.join(sandbox, 'tracked.txt'), 'two\n', 'utf8');
  mkdirSync(path.join(sandbox, 'newdir'), { recursive: true });
  for (const name of ['a.txt', 'b.txt', 'c.txt']) writeFileSync(path.join(sandbox, 'newdir', name), 'x\n', 'utf8');

  const counted = mod.gitDirtyCount(sandbox);
  if (counted !== 4) {
    fail(
      `gitDirtyCount reported ${counted} for 1 modified tracked file plus 3 files in an untracked directory; ` +
        'it must report 4. A wholly untracked directory is collapsed by `git status --short` into one entry, ' +
        'so the count understates how much uncommitted work is at risk.',
    );
  }

  // Deeper nesting must expand too, not just the first level.
  mkdirSync(path.join(sandbox, 'newdir', 'deeper'), { recursive: true });
  writeFileSync(path.join(sandbox, 'newdir', 'deeper', 'd.txt'), 'x\n', 'utf8');
  const nested = mod.gitDirtyCount(sandbox);
  if (nested !== 5) fail(`after adding one nested file gitDirtyCount reported ${nested}, expected 5`);

  // Existing contract: a path that is not a repository still reports null.
  const outside = mkdtempSync(path.join(tmpdir(), 'landos-not-a-repo-'));
  try {
    if (mod.gitDirtyCount(outside) !== null) fail('gitDirtyCount must still return null outside a git repository');
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }

  console.log('PROBE_OK dirty count expands untracked directories');
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
