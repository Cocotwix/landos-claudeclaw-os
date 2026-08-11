# Current Active Task

LandOS fast development harness overhaul. Implementation and its representative
proof are COMPLETE and UNCOMMITTED, awaiting Tyler's review and acceptance. Do
not begin any queued LandOS product feature.

# Exact Operator Outcome

Tyler describes a LandOS outcome; the harness decomposes it, runs independent
lanes concurrently, shares discoveries, integrates, checks cheaply before
certifying, diagnoses failures exactly, verifies the running application, and
ends in a machine-detectable state. Tyler manages LandOS, not the coding agents.

# Current State

- **Generated:** 2026-08-11T02:33Z
- **HEAD at generation:** `7c68925`, equal to origin/main.
- **Worktree:** DIRTY BY DESIGN, 18 paths counted with `--untracked-files=all`,
  every one of them this overhaul, none committed and none staged for commit.
- **Tests:** full suite 6,045 passing / 445 files / 0 failures, the exact
  baseline. Harness suite 24 passing. `tsc --noEmit` clean.
- **Runtime:** RUNNING healthy, restarted twice under harness control,
  http://localhost:3141, HTTP 200.

# Completed and Proven

NEW HARNESS, `npm run landos:build`: `mission.mjs` (lane graph, shared
discoveries, telemetry, terminal state), `mission-exec.mjs` (concurrent
scheduler, worktree isolation, integration, checks), `diagnose.mjs` (exact
failure extraction), `mission-cli.mjs` (phases + closeout), `watcher.mjs`
(passive waste report), `mission.test.mjs` (24 tests).

REUSED, not rebuilt: `builders.mjs` registry, `worktree.mjs`, `run-state.mjs`,
`evaluator.mjs` parsing, git, the managed runtime commands.

KEY PRIMITIVE: `launchBuilderAsync`. `spawnSync` made concurrency impossible;
lanes now overlap. `killTree` was required because a shell-wrapped builder
survived `child.kill()` on Windows and would hang its lane past its timeout.

PROOF SPRINT, 4:16 total: 4 lanes, 2 waves, peak concurrency 2, CC and Codex
building SIMULTANEOUSLY. 21 discoveries shared; both build lanes coded against
`mission.mjs` without reading it, which they could not have done since it is
untracked at HEAD and absent from their worktrees. Integration clean, focused
checks green first pass, validation green. Watcher measured 124s saved by
concurrency (376s of lane work in 251s wall clock).

BROWSER PROOF: managed restart, health, HTTP 200 and two page-text assertions,
terminal state PASS. An earlier run correctly returned NEEDS_ATTENTION on a
wrong expectation, so the gate refuses unmet claims rather than passing.

THREE REAL DEFECTS FOUND BY RUNNING THE REAL THING, all fixed and regression
-covered: `diagnose.mjs` ran its detectors on raw output, so every coloured
reporter run degraded to "unrecognised"; the mission never recorded which
builder actually ran a lane; `mission-report.mjs` rendered wave count as an em
dash because `mission.waves` is a count, not a list. Each hand-written fixture
had hidden the defect that only real output exposed.

DELETED: `seed-worktree.mjs`, whose only purpose was reconstructing a
chronically dirty tree. Clean main made it obsolete.

# Remaining Work

Unchanged deferred product work: house valuation lane; Strategy agent; Pre/Post
Discovery Revaluation; exact-address `persistence.attempted` still false; no Run
Property Intelligence control in the V2 workspace; the two dead
`browser-session.ts` items.

Harness follow-ons, none started: no model-routing table beyond per-lane
`builderId`; no automatic plan authoring from a plain request, so a plan file is
still written by hand; watcher findings are printed, never fed back
automatically; two stale worktrees from old devloop runs remain on disk.

# Exact Next Action

Present the overhaul to Tyler. On acceptance run
`npm run landos:build -- accept <missionId> --message "..."`, or commit the
overhaul directly, then verify main equals origin/main with zero dirty and zero
staged paths. Start nothing else without instruction.

# Relevant Files

`scripts/devloop/{mission,mission-exec,mission-cli,diagnose,watcher,mission.test}.mjs`,
`scripts/devloop/{plans,probes}/`, `scripts/devloop/builders.mjs`,
`scripts/devloop/{plan-doctor,mission-report}.mjs` (built by the proof sprint),
`docs/landos/mission-harness.md`, `package.json`.

# Relevant Records

Baseline `ca21d0c`; checkpoint closeout `7c68925`. Missions
`m-give-the-mission-harness-two-operator-co-20260811t021747z` (PASS) and
`m-prove-the-harness-verifies-the-real-runn-20260811t022903z` (PASS) under
`.runtime/devloop/`.

# Known Blockers

None in the repository. `Bash(git push*)` was removed from
`.claude/settings.local.json` deny rules per instruction; every secret, `.env`
and token deny rule is intact.

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
control and left running. The live database was never touched.

# Verification Required

Met for the harness. Full suite 6,045 passing across 445 files, 0 failures;
harness suite 24 passing; `tsc --noEmit` clean; two missions ended PASS; the
running dashboard was verified after a managed restart. Not run: production
build, and no operator-facing LandOS surface changed, so none was required.

# Completed and Protected

Retain everything previously protected. Plus: concurrency is the default and
failover is not parallelism; two lanes that can run at once must own disjoint
paths, and a plan violating that is refused before launch; recon lanes are
read-only and may share the primary tree, write lanes never may; a repair worker
receives the exact failing file, test title, assertion and expected/received,
never a bare check name; cheap focused checks run before expensive
certification; a completion summary names only the gates that actually ran, so a
mission with no browser check never claims localhost was verified; integration
refuses only when a file it would patch is already dirty, so unrelated
uncommitted work is preserved; a test fixture that a real run contradicts is
replaced with real output, never trusted over it; and accepted work is committed
before the next sprint begins.
