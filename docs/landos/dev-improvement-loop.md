# LandOS Development Improvement Loop (V1)

Reference material, not doctrine. `.landos/CODING_SESSION_PROTOCOL.md` still wins.

Development-only. The loop improves how LandOS gets built. It is not wired into
Property Intelligence, research lanes, or any operator-facing runtime path, and
nothing here puts a recursive loop inside a research lane.

## What the loop owns

The loop, not a coding agent, owns the task, the run state, the acceptance
criteria, the attempt history, the failure diagnoses and the next instructions.
CC and Codex are interchangeable builders it launches. Tyler never copies a
prompt between sessions: the orchestrator composes the next prompt from
persisted state and hands it to the next builder itself.

## Modes

Real LandOS work is the normal mode and needs no flag. A spec with
`"mode": "selftest"` exists only to exercise the loop itself and is refused
unless `--selftest` is passed; those specs live under `specs/selftest/`.

## Builder readiness

Readiness is established before attempt 1, never discovered mid-handoff. The
run records each builder's availability and version in `run.json`. An
unavailable builder is marked and skipped, and the run starts on whoever is
available. With one usable builder the loop still works: it diagnoses, improves
the instructions, and hands them back to the same builder, because there is
nobody to switch to. With none, the run refuses to start.

## Accepted patch package

On PASS the run writes `<runDir>/accepted-patch/` containing `accepted.diff`,
`SUMMARY.md` and `package.json`: the task, operator outcome, run id, base
commit, run worktree, criteria hash, exact files changed, per-check validation,
builder readiness, attempt and switch history, and whether `git apply --check`
succeeds against the primary worktree. The loop never applies it; `applied` is
always `false` in the manifest. Integration stays an explicit decision.

## Isolation

Builders never run in the owner's checkout. Each run gets its own detached git
worktree at `.runtime/devloop/<runId>/worktree`, checked out at HEAD, and every
builder for that run — CC, Codex, or any later agent — uses it as its working
directory. Containment is therefore preventive: a builder with unrestricted
filesystem access has none of the owner's uncommitted work within reach. The
evaluator runs its checks in the same worktree and still enforces the task's
`allowedPaths` inside it.

Builder switching accumulates in that one worktree, so attempt 2 builds on
attempt 1 even when a different agent made it.

After every attempt the loop re-checks the primary worktree and aborts the run
if a single git-visible byte changed there. Remove a run's worktree with
`cleanup <runId>`; nothing is removed automatically.

A fresh worktree has no `node_modules` (it is gitignored), so a task whose
acceptance commands need dependencies must set `"shareNodeModules": true` in
its spec. That links the primary install into the worktree, which is a writable
path back into the owner's checkout, so it is off by default.

## Commands

```
npm run landos:devloop -- builders
npm run landos:devloop -- start scripts/devloop/specs/<spec>.json --max-attempts 3
npm run landos:devloop -- resume <runId> --max-attempts 2
npm run landos:devloop -- status [runId]
npm run landos:devloop -- show <runId>
npm run landos:devloop -- cleanup <runId>... | --all
npm run landos:devloop -- lessons
npm run landos:devloop:test
```

`cleanup` removes only that run's own checkout, and only one git actually lists
as a worktree of this repository. Any junction inside it is unlinked before the
delete, never followed. Run history, frozen criteria, evaluator evidence, the
accepted patch package and candidate lessons all stay. It never touches the
primary worktree, the primary `node_modules`, branches, unrelated worktrees or
other runs.

## Files

| File | Role |
|---|---|
| `scripts/devloop/devloop-cli.mjs` | orchestrator: composes the prompt, launches the builder, calls the evaluator, persists, decides whether to continue |
| `scripts/devloop/run-state.mjs` | per-run directory, frozen criteria, hash verification, attempt history, isolation guards |
| `scripts/devloop/builders.mjs` | agent-neutral builder registry and launcher |
| `scripts/devloop/evaluator.mjs` | independent checks, PASS/FAIL, diagnosis, corrections, builder-switch rules |
| `scripts/devloop/instructions.mjs` | one full standalone prompt per attempt |
| `scripts/devloop/worktree.mjs` | per-run git worktree isolation, safe cleanup, and the primary-worktree watchdog |
| `scripts/devloop/patch-package.mjs` | the accepted-patch review package written on PASS |
| `scripts/devloop/lessons.mjs` | candidate lessons, and the guard that stops the loop writing governance |
| `scripts/devloop/specs/` | run specs and evaluator-owned probes |
| `scripts/devloop/devloop.test.mjs` | unit tests for the loop itself |

Run state lives in `.runtime/devloop/<runId>/` (gitignored). Candidate lessons
land in `.landos/devloop/candidate-lessons.json` for review.

## Run spec

```jsonc
{
  "task": "short label",
  "operatorOutcome": "what must become true",
  "allowedPaths": ["scripts/dev/"],      // hard boundary; anything else fails acceptance
  "builders": ["cc", "codex"],           // optional; defaults to every registered builder
  "startingBuilderId": "cc",
  "builderBrief": "what the builder is told (mutable; the loop improves it)",
  "checks": [ /* frozen at run creation; never edited */ ]
}
```

Check kinds: `file-exists`, `file-contains`, `command`, `module-probe`,
`scope-containment`. Every check carries a plain-English `requirement`; that
sentence is what the loop feeds back to the next builder when the check fails,
so write it as the thing that must become true.

`module-probe` checks are evaluator-owned. Author them under
`specs/probes/*.mjs` and reference them with `probeFile`; the source is inlined
into the frozen criteria at run creation, so it is covered by the criteria hash
and a builder cannot weaken it. A probe prints `PROBE_FAIL: <reason>` and exits
non-zero; that reason becomes the diagnosis CAUSE.

## Acceptance

Criteria are written once into `criteria.json` and hashed into `run.json`. Every
load re-verifies the hash, so criteria cannot drift mid-run. The evaluator runs
every check itself. A builder's `ATTEMPT_COMPLETE` is recorded as evidence about
the builder and never decides anything.

On FAIL the evaluator emits `GOAL / PROVEN / FAILED / CAUSE / NEXT` and a
correction block that is appended to the next attempt's prompt.

## Builder switching

The loop switches only when it can name the reason. Rules, in order:

| rule | fires when |
|---|---|
| `launch_failed` | the builder did not launch or exited non-zero |
| `no_changes` | the builder changed no files at all |
| `scope_violation` | the builder wrote outside `allowedPaths` |
| `repeat_failure` | the same check already failed under this builder |
| `overclaimed` | the builder reported `ATTEMPT_COMPLETE` while a criterion is false |
| `keep` | none of the above; the same builder gets the improved instructions |

## Adding a builder

Add one descriptor to `BUILDERS` in `scripts/devloop/builders.mjs`:
`{ id, label, command, version, invoke(ctx), claimFrom(stdout, stderr), notes }`.
Nothing in the run state, the evaluator, the instruction composer or the CLI
changes. `devloop.test.mjs` asserts a third id rotates correctly.

## Limits of V1

- Sequential attempts; no parallel builders, no benchmarking, no scoring.
- Diagnosis is rule-based, not model-written. It reports what was measured.
- Acceptance is command and probe based. A change with an owner-visible surface
  still needs the acceptance tiers in `.landos/CODING_SESSION_PROTOCOL.md`
  section 5; the loop does not replace browser QA or final review.
- Candidate lessons are never promoted automatically.
