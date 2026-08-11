# Current Active Task

None. The parallel-first development harness and the Windows lock-contention fix
are both accepted, committed and pushed. Awaiting Tyler's instruction, which is
expected to be automatic plain-English mission authoring. Do not begin it, and
do not begin a queued product feature, without that instruction.

# Exact Operator Outcome

Tyler describes a LandOS outcome and the harness decomposes it, runs independent
lanes concurrently, shares discoveries, integrates, checks cheaply before
certifying, diagnoses failures exactly, verifies the running application, and
ends in a machine-detectable state. Tyler manages LandOS, not the coding agents.

# Current State

- **Generated:** 2026-08-11T03:25Z
- **HEAD at generation:** `a0c1ec3`, equal to origin/main.
- **Worktree:** clean. 0 dirty paths, 0 staged files.
- **Tests:** full suite 6,048 passing across 445 files, 0 failures, verified by
  three consecutive runs. Harness suite 28 passing; legacy devloop suite 18.
- **Typecheck:** `tsc --noEmit` clean.
- **Runtime:** RUNNING healthy, PID 161196, http://localhost:3141, HTTP 200.
- **Worktrees:** the primary is the only one.

# Completed and Proven

HARNESS — `d8c74d2`, 16 files, +2913/-249. `npm run landos:build`.
`mission.mjs` (lane graph, shared discoveries, telemetry, terminal state),
`mission-exec.mjs` (concurrent scheduler, worktree isolation, integration,
checks), `diagnose.mjs` (exact failure extraction), `mission-cli.mjs` (phases
and closeout), `watcher.mjs` (passive waste report), plus `plan-doctor.mjs` and
`mission-report.mjs`, which a mission built and which carry their own tests.
Reused rather than rebuilt: the `builders.mjs` registry, `worktree.mjs`,
`run-state.mjs`, `evaluator.mjs`, git and the managed-runtime commands.

`launchBuilderAsync` was the missing primitive: `spawnSync` blocked the event
loop, so concurrency was impossible by construction. `killTree` came with it,
because a shell-wrapped builder survives `child.kill()` on Windows.

PROOF — a 4-lane sprint finished in 4:16 wall clock: 2 waves, peak concurrency
2, CC and Codex building simultaneously rather than as failover. 21 discoveries
were shared, and both build lanes coded correctly against `mission.mjs` without
reading it, which they could not have done, since it was untracked at HEAD and
therefore absent from their worktrees. Integration was clean, focused checks
passed first time, validation passed. The watcher measured 124s saved by
concurrency. A second mission restarted the managed runtime and asserted against
the live dashboard; an earlier run correctly returned NEEDS_ATTENTION on an
unmet expectation, so the gate refuses claims it cannot support.

Three real defects surfaced only by running the real thing, all fixed and
covered: `diagnose.mjs` ran its detectors on raw output, so every coloured run
degraded to "unrecognised"; the mission never recorded which builder actually
ran a lane; `mission-report` rendered wave count as an em dash because
`mission.waves` is a count. Each hand-written fixture had hidden the defect.

Deleted `seed-worktree.mjs`, whose only purpose was reconstructing a chronically
dirty tree. Clean main made it obsolete.

LOCK FIX — `a0c1ec3`. `mcp-bridge.test.ts` failed two full-suite runs in four
and passed in isolation. `withJournalLock` retried only on `EEXIST`, but a lock
unlinked while a handle is open is delete-pending on Windows and opening it
returns `EPERM`. That is the window between one holder's `close()` and its
`unlink()`, so ordinary contention was rethrown as a fault. A race harness
confirmed it: 57 `EPERM` events produced 57 hard failures under the old
predicate and none under the new one. `EPERM` and `EACCES` now wait like
`EEXIST`; a real fault still surfaces, bounded by the existing 5s deadline and
carrying its code. Nothing was skipped or weakened; three regression tests were
added, one racing twelve concurrent holders.

# Remaining Work

THE MAJOR HARNESS GAP: automatic plain-English mission authoring. Tyler still
hand-writes a plan file. The front door should take a plain-English outcome,
inspect LandOS itself, write its own mission and dependency graph, and launch
the parallel build. `plan-doctor` already lints a plan; nothing yet authors one.

Lesser harness follow-ons: no model-routing table beyond per-lane `builderId`;
watcher findings are printed, never fed back automatically.

Unchanged deferred product work: house valuation lane; Strategy agent; Pre/Post
Discovery Revaluation; the exact-address lane's `persistence.attempted` still
false; no Run Property Intelligence control in the V2 workspace; the two dead
`browser-session.ts` items.

# Exact Next Action

Wait for Tyler's instruction on automatic plain-English mission authoring. Start
nothing without it.

# Relevant Files

`scripts/devloop/{mission,mission-exec,mission-cli,diagnose,watcher}.mjs` and
`mission.test.mjs`; `scripts/devloop/{plan-doctor,mission-report}.mjs`;
`scripts/devloop/{plans,probes}/`; `docs/landos/mission-harness.md`;
`src/landos/governance/mcp-bridge.ts`.

# Relevant Records

Harness `d8c74d2`; lock fix `a0c1ec3`; prior accepted baseline `ca21d0c`.
Mission state under `.runtime/devloop/` is gitignored and disposable.

# Known Blockers

None in the repository. `Bash(git push*)` was removed from
`.claude/settings.local.json` deny rules; that file is gitignored, so the change
is local only. Every `.env`, secret and token deny rule is intact.

Unchanged: deployed `~/.hermes` has drifted from committed templates and
`hermes:governed:check` fails all five profiles; `image_gen`, `bfl` and `tts`
remain enabled and can incur cost; deal 83's Decision Summary still contradicts
the valuation above it; `landos:memory:checkpoint` still exceeds its 8192-byte
ceiling, so this file was written directly under it.

# Do Not Inspect or Modify

Do not expose `.env` or secrets, print either dashboard token, run destructive
SQL, or delete `store/backups/landos-pre-rescue-2026-08-03.db`. Deny rules
`Bash(rm *)` and `Bash(git clean*)` are intact. Never disable TLS verification.
Do not create a second Chrome profile: CDP 9224 only. Do not regenerate the
committed acceptance fixture or drop its `.gitattributes`.

# Runtime State

Healthy on http://localhost:3141, PID 161196, HTTP 200, restarted under harness
control during the proof and left running. The live database was never touched.

# Verification Required

Met. Full suite 6,048 passing across 445 files with 0 failures, confirmed by
three consecutive runs; `tsc --noEmit` clean; harness suite 28 passing; two
missions ended PASS; the running dashboard was verified after a managed restart.
Both commits verified equal to origin/main after `git fetch`. Not run: the
production build, since no operator-facing surface changed.

# Completed and Protected

Retain everything previously protected. Plus: concurrency is the default and
failover is not parallelism; two lanes that can run at once must own disjoint
paths, and a plan violating that is refused before launch; recon lanes are
read-only and may share the primary tree, write lanes never may; a repair worker
receives the exact failing file, test title, assertion and expected/received,
never a bare check name; cheap focused checks run before expensive
certification; a completion summary names only the gates that actually ran;
integration refuses only when a file it would patch is already dirty, so
unrelated uncommitted work is preserved; a test fixture that a real run
contradicts is replaced with real output, never trusted over it; a lock error
meaning "someone else holds it" is contention on every platform, never a fault;
and accepted work is committed and pushed before the next sprint begins.
