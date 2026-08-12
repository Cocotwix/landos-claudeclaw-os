# Current Active Task

None in progress. The direct-builder fast path is accepted, committed, and pushed at `23aa8bb`; the next task is a real LandOS product sprint chosen by Tyler and run through that path.

# Exact Operator Outcome

Ordinary LandOS development is one short task handed to one capable coding agent that starts immediately, iterates on its own, and returns a deterministically verified change Tyler can review in minutes.

# Current State

- `main` and `origin/main` are both `23aa8bb`, "feat(landos): add the direct-builder development fast path". Committed and pushed this session; the working tree is dirty with unaccepted evidence described below.

<!-- DERIVED:START -->
- **Generated:** 2026-08-12T04:40:00.000Z
- **HEAD at generation:** `23aa8bb`
- **Worktree:** DIRTY; 79 modified/untracked paths at refresh time. Preserve unrelated changes.
- **Latest tests:** PASS at 2026-08-12T04:30:00.0000000Z; 44 direct-builder tests via npm run landos:task:test, plus memory-bootstrap and gitignore-policy (66 tests); 0 failures.
- **Latest typecheck:** PASS at 2026-08-12T03:40:00.0000000Z; tsc --noEmit clean on the working tree.
- **Latest production build:** not rerun this session; no product surface changed.
- **Managed runtime:** RUNNING healthy at 2026-08-12T04:30:00.0000000Z; PID 167648; http://localhost:3141.
- **Prior tracked sprint:** sprint-2026-08-04-pi-workflow-finish (complete); it is not the Current Active Task.
<!-- DERIVED:END -->
- The accepted development path is one directly selected capable builder that owns the whole change. `npm run landos:task -- --engine claude|codex "<task>"`, or `--packet <file>` for a structured task card.
- Provider choice is explicit at the invocation boundary. Claude Code and Codex are both wired and both proven end to end, including the repair continuation.
- Deliberately absent, and not to be reintroduced without evidence: mandatory planner, scheduler, lane graph, worker pool, automatic provider routing or failover, and autonomous retry systems.
- Accepted mechanics: deterministic verification derived from what actually changed, JSONL timing, exactly one post-verification repair in the same builder session, durable context in `.landos/DEVELOPMENT_CONTEXT.md`, targeted named-variable `.env` access, and hard secret-file immutability.
- Success is decided by exit codes. No model judges completion and no sign-off token is read.
- The old large harness and the later simplified runner both failed the real-world speed objective. Neither is the accepted development architecture.
- The runner experiment stays preserved locally as dirty and staged evidence: 46 staged deletions under `scripts/devloop/`, modified `builders.mjs` and `package.json`, and untracked `build.mjs`, `build.test.mjs`, `fixtures/`, `docs/landos/build-runner.md`, and the runner trace. It is not accepted product state and must never be folded into future work silently.
- The stash `landos-duke-overarchitecture-hold` remains intact and untouched.

# Completed and Proven

- Four real end-to-end runs across both engines. Live LandOS code with Claude Code: verified in 147.6s, first edit 66.8s. Isolated fixtures: Claude Code repair path 48.0s, Codex 45.0s, Codex repair path 61.3s. Both repair runs failed pass one, took the exact evidence back into the same session, and passed pass two.
- Wrapper overhead is about 0.3s per run: 122ms startup snapshot, 80ms per verification pass beyond the checks themselves.
- Secret immutability proven with real files: a builder that rewrites `.env` is blocked, gets no repair turn, and neither the value nor the variable name reaches the result, trace, or summary. A run with `.env` present and untouched still verifies.
- 44 direct-builder tests, 32 memory-bootstrap tests, `tsc --noEmit` clean, `landos:memory:audit` PASS.
- Localhost confirmed unbroken after the change: `/dept/acquisitions` and `/board` render real lead data, no console errors, runtime never restarted.

# Remaining Work

1. Run a real LandOS product sprint through the direct-builder path and record its measurements.
2. Judge that run on time to first edit, time to verified green, acceptance quality, and how much human correction was needed.
3. Leave parallel builders alone until measured wall-clock evidence justifies isolated git worktrees plus integration review for genuinely independent work.

# Exact Next Action

Take one real LandOS product task from Tyler and run it through `npm run landos:task -- --engine claude "<task>"`. Do not expand the development system further unless benchmark evidence demonstrates a specific deficiency.

# Relevant Files

- `scripts/dev/task.mjs`, `scripts/dev/verify.mjs`, `scripts/dev/providers.mjs`, `scripts/dev/env-guard.mjs`, and their `.test.mjs` siblings
- `.landos/DEVELOPMENT_CONTEXT.md`, `.landos/task-packet.template.md`, `docs/landos/direct-builder.md`, `AGENTS.md`, `package.json`

# Relevant Records

- Accepted commit `23aa8bb`, 12 files, 2,168 insertions, pushed to `origin/main`.
- Run artifacts live in `.runtime/dev/<run-id>/`: `trace.jsonl`, `result.json`, `prompt.md`, builder logs. Gitignored.
- Michigan has zero `landos_market_snapshot` rows; never fabricate Michigan Market Research coverage.

# Known Blockers

None.

# Do Not Inspect or Modify

`.env` and equivalent credential files are permanently read only: never create, modify, replace, delete, rename, stage, or commit one, and never read one whole. Use `node scripts/dev/env-guard.mjs status <NAME>` or `run <NAME> -- <cmd>` when a named variable is genuinely required. Do not commit, stage, or discard the preserved runner experiment, do not touch the stash, and do not expose secrets or private records. Do not rebuild the deleted orchestration layers.

# Runtime State

Managed runtime running and healthy at `http://localhost:3141`, PID 167648. Leave it running. Confirm through canonical runtime commands before browser QA.

# Verification Required

Tier 1 plus real builder runs: focused tests, typecheck, four measured end-to-end executions across both engines, and a localhost read confirming the operator application still renders. No product surface changed, so no production build or browser QA was required.

# Completed and Protected

Retain all previously protected product behavior, including honest Michigan market coverage and the rule that tests, build, health, or HTTP never substitute for rendered operator acceptance. Newly protected: secret files are immutable and a mutation blocks the run without exposing contents; whole-file secret exposure is prohibited and only named-variable access is allowed; completion is decided by deterministic exit codes rather than a model's claim; the builder engine is always chosen explicitly; a rejected change gets exactly one same-session repair and then stops with evidence; unrelated dirty work is preserved because the change delta is content-hashed; the runner's own artifacts are never counted as a builder's change. Protections naming lanes, worktrees, patch integration, or repair-id bookkeeping are retired with the mechanisms they described.
