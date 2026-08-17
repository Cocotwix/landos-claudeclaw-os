# Current Active Task
Build only Vertical Slice 1 of the thin LandOS Development Control Spine in the isolated `build/control-spine` worktree. The pre-promotion worktree invariant repair is implemented; its replacement candidate must remain `ACCEPTANCE_PENDING` until that exact commit reaches Git `main`.

# Exact Operator Outcome
A fresh process in any registered Git worktree can reconstruct the same canonical development task through attempt, evidence, candidate verification, durable failure or exact-Git acceptance, crash-safe pending reconciliation, and reproducible `.landos/STATE.md`, without provider session memory or `store/landos.db`.

# Current State


<!-- DERIVED:START -->
- **Generated:** 2026-08-17T04:10:14.327Z
- **HEAD at generation:** `d2ab777`
- **Worktree:** DIRTY; 9 modified/untracked paths at refresh time. Preserve unrelated changes.
- **Latest tests:** PASS on focused control and reused-helper suites at 2026-08-17T04:07:54.000Z; 5 Control Spine tests, 44 existing landos:task/deterministic verification/secret-guard tests, and 63 memory/checkpoint/sprint governance tests pass.
- **Latest typecheck:** PASS at 2026-08-17T04:08:00.000Z; tsc --noEmit completed with zero errors.
- **Latest production build:** PASS at 2026-08-17T04:08:00.000Z; vite build and tsc completed; only the existing large-chunk advisory was emitted.
- **Managed runtime:** not recorded; inspect with npm run landos:status.
- **Prior tracked sprint:** sprint-2026-08-04-pi-workflow-finish (complete); it is not the Current Active Task.
- **Sprint ledger:** .landos/sprints/sprint-2026-08-04-pi-workflow-finish/ledger.json; proof report .landos/sprints/sprint-2026-08-04-pi-workflow-finish/report.md; frozen capabilities: 3 (.landos/capabilities.json).
<!-- DERIVED:END -->
The canonical local record is now the one SQLite file under Git's common directory: `landos/control/landos-control.db`. The previous candidate `d2ab777ea01599c34776291fa1a01cac07398aae` and gate are durably superseded failure knowledge because they used worktree-relative authority. Task `control-spine-vs1`, active attempt `codex-control-spine-shared-db`, records the bounded repair; regenerate `.landos/STATE.md` for live values. No business/runtime database or product behavior changed.

# Completed and Proven
1. `scripts/control/control-state.mjs` owns the schema and lifecycle for task, attempt, evidence, verification, failure knowledge, pending acceptance, exact accepted SHA, retrieval, and generated state.
2. `scripts/control/landos-control.mjs` exposes the one canonical CLI. PASS leaves a candidate non-accepted. Database triggers reject direct task or attempt `ACCEPTED` writes.
3. Integration Gate preparation persists `ACCEPTANCE_PENDING` before Git promotion. Reconciliation accepts only when its authority ref resolves to the exact verified 40-character candidate SHA.
4. Crash recovery passed in a temp Git repository: the control process closed after prepare, `main` was fast-forwarded while it was gone, and a fresh process reconciled the same pending operation idempotently.
5. Contradiction safety passed: when `main` resolved to a different commit, reconciliation retained `ACCEPTANCE_PENDING`, recorded the exact mismatch blocker, and created no accepted record.
6. Durable failure passed: a failing candidate reopened after process loss with task, approach, result, root cause, limitation, verification evidence, exit code, and useful next direction.
7. `.landos/STATE.md` is generated atomically from SQLite plus live Git, ignored as a projection, and produced identical bytes on consecutive unchanged generations.
8. Existing deterministic Git/check execution from `scripts/dev/verify.mjs` is reused. Existing sprint recurrence, evidence, capability, memory, task, build, and runtime systems were inspected but not duplicated or broadly replaced.
9. Every registered worktree resolves `<Git common dir>/landos/control/landos-control.db`; first use safely adopts exactly one legacy worktree database and refuses ambiguous legacy universes or live SQLite sidecars.
10. A real two-worktree regression proves both paths resolve the same physical file, state created through one worktree is visible through the other, and the second worktree does not create its own database.
11. A pre-promotion candidate can be durably superseded into failed attempt knowledge, cannot later reconcile, and permits a corrected replacement attempt.

# Remaining Work
1. Integration must promote the exact replacement candidate from `.landos/STATE.md` to `main`; the isolated worktree must not modify the protected original working tree. A later gate reconcile will then be able to produce real `ACCEPTED`.
2. Slice 2 may connect worker adapters or broader orchestration. It must not add those concerns to this slice.

# Exact Next Action
After the invariant repair is committed and recorded, review the exact replacement candidate shown in `.landos/STATE.md`, promote that same SHA to Git `main`, then run `npm run landos:control -- integration-gate reconcile`. Do not claim `ACCEPTED` before that reconciliation.

# Relevant Files
`scripts/control/control-state.mjs`, `scripts/control/landos-control.mjs`, `scripts/control/control-state.test.mjs`, `docs/landos/development-control-spine.md`, `package.json`, `.gitignore`, `AGENTS.md`, `CLAUDE.md`, `.landos/CODING_SESSION_PROTOCOL.md`, `.landos/PERMANENT_MEMORY.md`, `.landos/DEVELOPMENT_CONTEXT.md`, `.landos/verification-results.json`, `.landos/CHECKPOINT.md`.

# Relevant Records
Canonical local DB: `<Git common dir>/landos/control/landos-control.db` (currently `C:\Users\tbutt\claudeclaw-os\.git\landos\control\landos-control.db`). Active task: `control-spine-vs1`. Superseded attempt: `codex-control-spine-vs1`. Active attempt: `codex-control-spine-shared-db`. Generated projection: `.landos/STATE.md`. Business DB: untouched and separate.

# Known Blockers
No implementation blocker. Real acceptance is correctly blocked until the exact replacement candidate is promoted to Git `main`; modifying the original working tree remains out of scope.

# Do Not Inspect or Modify
Do not read or edit `.env` or credentials. Do not modify the `C:\Users\tbutt\claudeclaw-os` working tree or `C:\Users\tbutt\claudeclaw-os-latest`; the shared Development Control file under the common Git metadata is the intentional exception. Do not alter `store/landos.db`, business runtime behavior, provider adapters, capabilities, property workflows, or UI. Do not build Slice 2.

# Runtime State
Tier 1 internal tooling change. Read-only status showed this isolated worktree has no managed-runtime association and reports STOPPED; port 3141 is owned by an unrelated process returning HTTP 200. It was not restarted or used for acceptance, and business data was not touched.

# Verification Required
Run `npm run landos:control:test`, `npm run landos:task:test`, focused memory/sprint governance tests, `npm run typecheck`, `npm run build`, `git diff --check`, three-worktree resolver reads, two unchanged state generations, and a fresh-process `landos:control status --json`. Inspect final Git status and candidate SHA.

# Completed and Protected
Previously protected product capabilities remain unchanged. For this slice, protect these invariants after exact-main acceptance: only Integration Gate writes `ACCEPTED`; acceptance stores the exact full commit; PASS and FAIL persist; pending promotion is recoverable, supersedable, and mismatch-safe; generated STATE is never source truth; one Git-common Development Control database serves every worktree and remains separate from business/runtime data.
