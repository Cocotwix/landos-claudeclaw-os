# LandOS mission harness

Reference for the parallel-first development harness. Not doctrine: the
canonical contract is `.landos/CODING_SESSION_PROTOCOL.md`.

## What it is for

Tyler describes the outcome he wants. The harness owns the mechanics: the
dependency graph, concurrency, isolation, shared discoveries, integration,
evaluation, diagnostics, repair routing, localhost verification and the
terminal state. Coding models supply reasoning inside that system; they are
interchangeable and are named per lane.

It replaces the serial habit the old dev loop encoded. That loop ran one
builder over the whole task, evaluated it, then ran a *different* builder over
the whole task again. That is failover, not parallel development: four
independent areas cost four serial builder runs.

## Commands

```
npm run landos:build -- <plan.json> [--max-repairs 2] [--allow-dirty] [--no-validate] [--no-browser]
npm run landos:build -- status [missionId]
npm run landos:build -- timeline <missionId>
npm run landos:build -- cleanup <missionId> | --all
npm run landos:build -- accept <missionId> --message "commit subject"
npm run landos:build:watch -- <missionId>     # passive waste report
npm run landos:build:test                      # harness unit tests
node scripts/devloop/plan-doctor.mjs <plan.json>    # lint a plan before spending builder time
node scripts/devloop/mission-report.mjs <missionId> # markdown sprint summary
```

State lives under `.runtime/devloop/<missionId>/` and is gitignored:
`mission.json`, `events.jsonl`, `discoveries.json`, `RESULT`, and per-lane
`prompt.md`, `stdout.txt`, `lane.patch`.

## Phase order

```
preflight -> baseline -> parallel lanes (waves) -> integrate
  -> FOCUSED checks -> targeted repair -> proportional validation
  -> localhost verification -> terminal state
```

Focused checks run before certification so a candidate that is already wrong is
disproved in seconds rather than after a full suite. Validation only ever runs
against a candidate that survived them.

The baseline pass records which focused checks were *already* red before any
lane ran, so a repair brief can say "this one is pre-existing, do not fix it".

## Plan shape

```jsonc
{
  "request": "what Tyler asked for, in his words",
  "operatorOutcome": "what must be true in the running app when this is done",
  "lanes": [
    { "id": "recon", "kind": "recon", "brief": "read-only question" },
    { "id": "api", "kind": "build", "builderId": "codex",
      "dependsOn": ["recon"], "ownedPaths": ["src/landos/x.ts"], "brief": "..." }
  ],
  "focusedChecks":    [{ "id": "unit", "command": "...", "requirement": "..." }],
  "validationChecks": [{ "id": "suite", "command": "...", "requirement": "..." }],
  "browserCheck": { "commands": ["npm run landos:restart"], "url": "http://localhost:3141",
                    "expectText": ["Comparable sales"] }
}
```

`plan-doctor` checks all of this and prints the wave schedule before a single
builder is launched.

## Why the lane rules are what they are

**`ownedPaths` is mandatory on write lanes.** Two lanes that can run at the same
time may not claim the same path. That single rule is what makes concurrent
builders safe, and the validator refuses a plan that breaks it rather than
discovering the corruption at integration. Overlap *is* allowed when one lane
depends on the other, because the scheduler already serialises those.

**Recon lanes are read-only and share the primary tree.** They get a tool list
with no writer, so they need no worktree of their own. This is also why recon
can see uncommitted work that lane worktrees, checked out at HEAD, cannot.

**Write lanes get their own detached worktree.** Isolation is preventive, not
forensic.

**Repair lanes run on the integrated primary tree.** The failure being repaired
exists only in the *combination* of lanes, which no single lane's checkout
contains.

## Shared discoveries

Parallel workers must not become parallel rediscovery machines. A lane emits
one line per finding:

```
DISCOVERY: <kind> <subject> — <one line finding>
DISCOVERY: file src/landos/comps.ts — owns the comp cap calculation in selectComps()
```

`kind` is one of `file`, `symbol`, `test`, `route`, `config`, `shared`. A lane
inherits the discoveries of its **ancestors only**, so a sibling's irrelevant
findings never bloat its prompt. Identical findings collapse.

## Diagnostics and repair

A failed focused check is parsed once, by the process that already ran it, into
the exact test file, test title, assertion, expected versus received, and source
line. That travels to the repair worker in its prompt. A repair worker never
receives only a check name, and never reruns a suite to rediscover a failure the
harness already measured.

An unrecognised failure still carries a bounded raw tail, which is strictly more
than a truncated blob.

## Integration

Each write lane's work is captured as a patch and applied to the primary tree
with `git apply --3way`. Integration refuses only when a file the mission
changed is **already dirty** in the primary tree, because that is the only case
where applying a patch could destroy uncommitted work. Unrelated dirty work is
preserved.

## Terminal states

Every mission ends `PASS`, `FAIL` or `NEEDS_ATTENTION`, written to
`.runtime/devloop/<missionId>/RESULT` and to the process exit code
(`0` / `1` / `3`), so a notifier can read completion without anyone watching the
terminal.

## Closeout

`accept` is the only path that commits, and it refuses any mission whose
terminal state is not `PASS`. It stages **only** the files the mission
integrated, never a broad `git add`, then commits, pushes and verifies
`main == origin/main` with zero dirty paths. It never runs on unaccepted work.

## The watcher

`landos:build:watch` reads a finished mission's own event log and names waste:
serialised graphs, false dependency edges, recon lanes that discovered nothing,
repeated repairs on the same check (the diagnosis was not actionable), lanes
that wrote outside their ownership, and certification that ran against an
already-red candidate. It is passive: it starts nothing, blocks nothing, gates
nothing, and its findings are observations for the next plan, never rules.
