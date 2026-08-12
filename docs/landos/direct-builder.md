# LandOS direct builder

One task, one capable coding agent, one deterministic verdict.

    scripts/dev/task.mjs        the run: context, builder, verification, repair, result
    scripts/dev/providers.mjs   explicit engine selection (claude, codex)
    scripts/dev/verify.mjs      change detection and deterministic checks
    scripts/dev/env-guard.mjs   secret-file immutability and named-variable reads
    .landos/DEVELOPMENT_CONTEXT.md   the durable context the builder reads
    .landos/task-packet.template.md  the task packet format

## Use

    node scripts/dev/task.mjs --engine claude "make the acreage badge name its source county"
    node scripts/dev/task.mjs --engine codex --packet .landos/tasks/badge.md

    --engine claude|codex   required; nothing probes or chooses for you
    --model <name>          pass a specific model to that engine
    --packet <file>         a task packet instead of a one-line request
    --check "<cmd>"         a check beyond the derived ones (repeatable)
    --no-repair             stop at the first verdict
    --timeout <minutes>     builder turn limit, default 20
    --cwd <dir>             run against another repository

Exit code is 0 only when deterministic checks actually passed.

## Flow

1. **Snapshot.** Content-hash every path git already reports as dirty, and
   record HEAD. The tree is usually dirty with unrelated work; hashing is what
   lets the run tell the builder's edits from everyone else's without touching
   anything.
2. **Builder.** One engine, named on the command line, gets a short prompt: read
   `.landos/DEVELOPMENT_CONTEXT.md`, here is the task, work normally. It
   inspects, edits, runs tests, diagnoses, and retests as much as it wants. No
   planner rewrites the request first, and no second agent is involved.
3. **Verify.** Snapshot again, diff the snapshots, and derive checks from what
   actually changed: `vitest run` for changed suites, `vitest related --run` for
   changed sources, `tsc --noEmit` when any TypeScript moved, `node --test` for
   changed `scripts/**` modules and their siblings, plus anything the packet's
   `# Verify` section demands. Independent checks run concurrently. A change
   with nothing to check is reported `unverified`, never `verified`.
4. **Repair, once.** If a check fails, the exact failure — command, exit code,
   file, test title, expected versus received, line — goes back to the *same*
   builder session (`claude --resume`, `codex exec resume`). Verify again. A
   second failure stops the run with the evidence.
5. **Result.** One compact summary: state, changed paths, every check with its
   exit code and duration, failure evidence, scope exceptions, the operator
   route for UI work, timing, and the base commit to roll back to.

Nothing is ever staged, committed, pushed, or reverted. No model is asked
whether the work succeeded, and the builder's own completion claim is neither
required nor read.

## Secret files

`.env` and other secret or credential files are immutable. Every snapshot
fingerprints them, and any content change between the two snapshots ends the run
as `blocked`: no green, no repair continuation, and no builder turn handed to
whatever just wrote to them. The report names the file and whether it was
created, modified, or deleted, and stops there. Contents, diffs, and even the
fingerprints stay inside the process, because reporting the change in detail
would be the leak.

Secret files never enter the ordinary change set either, so a secret path cannot
reach a diff, a scope report, or a repair prompt. This matters because `.env` is
gitignored: `git status` never mentions it, and the change-detection snapshot on
its own could never have noticed it being rewritten.

To find out whether a variable is configured, ask about it by name:

    node scripts/dev/env-guard.mjs status <NAME>        configured | not configured
    node scripts/dev/env-guard.mjs run <NAME> -- <cmd>  run <cmd> with that one
                                                        variable in its environment

Neither prints a value. `run` passes it to the child process and nowhere else.
There is no command that dumps the file, and none should be added.

## Task packets

A precise request goes straight to the builder as a string. Use a packet when
the task earns structure: copy `.landos/task-packet.template.md` and fill in
only the sections that add something. `# Scope` globs turn any change outside
them into a reported scope exception; `# Verify` commands become required
checks.

## Evidence

Every run writes `.runtime/dev/<run-id>/` (gitignored): `packet.md`,
`prompt.md`, the builder's stdout, `trace.jsonl`, and `result.json`. The trace
records engine, model, time to first repository edit, builder duration, each
check with its duration, whether the repair continuation was needed, and the
total. That is the measurement this whole approach exists to produce.

## Deliberately absent

No planner, scheduler, lane graph, worker pool, provider routing, retry
framework, or parallel builders. Parallel work is a separate decision that
waits on direct-builder benchmarks; if it ever happens, independent writers get
isolated git worktrees and an explicit integration review, not concurrent
writes to one tree.
