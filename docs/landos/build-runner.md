# LandOS build runner

A thin mechanical execution layer. The coding agent is the brain; this is the
wiring. Four files, ~1,280 lines total.

    scripts/devloop/build.mjs        the runner: plan, run, check, repair
    scripts/devloop/builders.mjs     provider-neutral worker registry
    scripts/devloop/diagnose.mjs     exact vitest/tsc failure extraction
    scripts/devloop/build.test.mjs   unit tests
    scripts/devloop/fixtures/        bounded proof fixtures, not product code

## Use

    npm run landos:build -- "<what you want>"        plan lanes, run, test, repair
    npm run landos:build -- --file spec.md           request read from a file
    npm run landos:build -- --solo "<small change>"  no planning pass, straight to code
    npm run landos:build -- --lanes graph.json       hand-written lane graph
    npm run landos:build -- resume <id>              rerun only what is not done
    npm run landos:build -- status [id]
    npm run landos:build -- watch [id]

    --serve          restart the managed runtime and check localhost when checks pass
    --detach         run independently of this shell; follow it with watch
    --check "<cmd>"  add a check beyond the derived ones (repeatable)
    --concurrency N  default 6        --max-repairs N  default 6
    --builder <id>   pin a provider   --paths a,b     owned paths for --solo

Pick the shape by size: `--solo` for a small change (time to first edit is a
few seconds), the default planner for anything with genuinely independent
parts, `--lanes` when you already know the split.

## How it works

1. **Request** goes to `.runtime/devloop/<id>/request.md`. It is never copied
   into a prompt; workers are told where it is and read what they need.
2. **Split**, only when asked for. One planner call returns a minimal task
   graph — id, title, brief, paths, deps — and nothing else. Lane path sets
   must be disjoint; the runner rejects a graph where they are not.
3. **Run** on the primary tree, dependency-driven. A lane starts the instant
   its dependencies are done. There are no worktrees, no patches, and no
   integration phase: a finished lane's edits are already where they belong.
4. **Check** what actually changed. Changed test files run under vitest;
   changed TypeScript pulls in `tsc --noEmit` and any sibling test.
5. **Repair** until the failure signature stops moving. The exact failure —
   file, test title, expected, received, line — travels with the repair brief.

Workers get a shell and are told to run the tests covering what they changed
before finishing. A worker that cannot verify its own work turns every mistake
into the outer loop's problem.

State lives in `.runtime/devloop/<id>/` (gitignored): `mission.json`,
`events.jsonl`, `request.md`, `notes.md`, and per-lane prompt and output.

## Boundaries

The runner never commits, pushes, stages, or resets. It reads `.env` never.
Workers are told their owned paths and anything they change outside them is
reported as a stray at the end. Unrelated dirty work in the tree is preserved:
the change delta is content-hashed, not read off git status codes.

## Adding a provider

One descriptor in `BUILDERS` in `builders.mjs`: `id`, `label`, `command`,
`version` argv, `invoke(ctx) -> {args, stdin}`, and `claimFrom`. Nothing else
in the runner changes. A provider that goes down costs the next lane's builder
choice, never a rebuild.

## Fixtures

`scripts/devloop/fixtures/` holds throwaway modules used to prove the runner
without spending a product sprint. They are excluded from the product vitest
config and imported by nothing.

    npx vitest run --config scripts/devloop/fixtures/vitest.config.mjs

## Why it is shaped this way

Reconstructed from the 9490 Elk Lake Rd sprint, which took 2h54m of harness
time. Authoring cost 16m24s before a line of code. Every lane prompt was
70-93KB. Worktree and patch integration produced the "empty diff", "git status
exit 128" and "exit 3221225794" failures that lost an entire 36-minute wave.
A two-repair budget ended the mission three times, and each restart needed a
human, costing ~56 minutes of dead air. All of that is gone rather than fixed.
