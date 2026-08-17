# LandOS Development Control Spine

Repaired Slice 2 adds a mandatory managed-workspace boundary to the local,
SQLite-backed authority for development tasks, attempts, evidence,
verification, failure knowledge, and exact Git acceptance. It does not replace
`store/landos.db`, run coding providers, or alter the business runtime.

## Authority and files

- Git `main` is the default accepted-source authority.
- `<Git common dir>/landos/control/landos-control.db` is canonical
  development-control state. Every registered worktree resolves this same
  physical file through `git rev-parse --git-common-dir`; no worktree owns a
  separate control-state universe.
- On first use after this change, exactly one legacy worktree-local database is
  copied into the shared location without deleting the legacy copy. Multiple
  legacy databases or live SQLite sidecars stop adoption rather than silently
  choosing state.
- `.landos/STATE.md` is regenerated from that database plus live Git. It is
  ignored because it is a projection, not manually maintained truth.
- `.landos/CHECKPOINT.md` is a static compatibility pointer to generated
  `STATE.md`. `.landos/verification-results.json` is non-authoritative
  compatibility history; neither can establish verification or acceptance.
- `.runtime/dev/` and `.runtime/devloop/` remain worker traces. Useful results
  must be recorded in the Control Spine to become durable project knowledge.

## Managed writable workspaces

`attempt start` is the only writable-attempt allocation operation. It creates a
native Git worktree, records the exact task, attempt, primary writer, branch,
and base, then makes the attempt `IN_PROGRESS` in one database transaction.
Database triggers reject a writable attempt unless exactly one active workspace
matches all of those facts. A task, attempt, primary writer, branch, or path
cannot be active in more than one workspace. Executing code must validate its
actual working directory against that exact record before it may write.

Git creates and removes worktrees. Inspection reports missing, unregistered,
branch-mismatched, and base-mismatched metadata without deleting anything.
Release requires the workspace ID plus the owning task, attempt, and primary
writer; knowing a workspace ID alone is not authority. It refuses a still
writable attempt and delegates to `git worktree remove` only when the managed
worktree is clean. Dirty primary-writer work is refused and remains untouched.

## Minimal lifecycle

```text
task -> attempt -> evidence -> candidate commit -> PASS/FAIL
                                                |
                                                v
                                   ACCEPTANCE_PENDING
                                                |
                              exact candidate promoted to main
                                                |
                                                v
                                            ACCEPTED
```

A PASS makes a candidate eligible; it never marks work done. The Integration
Gate is the only code path and database transition allowed to write
`ACCEPTED`. The accepted task stores the full 40-character commit SHA.

Acceptance is intentionally two-phase. `integration-gate prepare` persists
the exact verified candidate as `ACCEPTANCE_PENDING` before Git promotion.
After promotion, `integration-gate reconcile` resolves `main` again. It accepts
only when `main` equals the pending SHA exactly. A crash before reconciliation
therefore leaves a visible, idempotently recoverable pending operation. If
`main` points anywhere else, the operation stays pending with a blocker.

If a pre-promotion check invalidates a pending candidate, `integration-gate
supersede` durably records the reason as failed attempt knowledge before a
replacement attempt begins. A superseded operation can never reconcile to
`ACCEPTED`.

## Commands

```powershell
npm run landos:control -- init
npm run landos:control -- task create --id task-id --title "Title" --outcome "Outcome" --next-action "Start the attempt."
npm run landos:control -- attempt start --task task-id --id attempt-id --worker codex --writer codex-task-id --path C:\\work\\task-id --branch task/task-id --base <full-sha> --approach "Smallest implementation."
npm run landos:control -- workspace inspect --id workspace-id
npm run landos:control -- workspace release --id workspace-id --task task-id --attempt attempt-id --writer codex-task-id
npm run landos:control -- evidence add --attempt attempt-id --kind implementation_note --summary "What changed"
npm run landos:control -- candidate submit --attempt attempt-id --commit <full-sha> --result "Candidate result"
npm run landos:control -- verification run --attempt attempt-id --command "npm run landos:control:test"
npm run landos:control -- integration-gate prepare --attempt attempt-id
# promote that exact commit to main through the normal local Git integration
npm run landos:control -- integration-gate reconcile
npm run landos:control -- integration-gate supersede --id <gate-id> --reason "Why the pending candidate is invalid"
npm run landos:control -- state generate
```

`init` is the only operation that creates or upgrades schema state and
registers current-client bootstrap metadata. Mutation commands require an
already-current schema. `status`, inspection, failures, and `state generate`
open the shared database read-only; they never migrate, register resources, or
rewrite canonical rows. The schema-version row is monotonic, so an older client
cannot lower a newer shared database version.

`verification run` requires a clean worktree at the submitted candidate commit,
so its PASS is Git-specific. Existing deterministic worker checks may also be
recorded with `verification record`, but they must name the same full candidate
SHA before the gate will accept them.

Failed verification and `attempt fail` both persist the attempted approach,
result, available root cause or limitation, evidence, and useful next
direction. Retrieve them with:

```powershell
npm run landos:control -- failures --task task-id --json
```

Every mutating command refreshes `.landos/STATE.md`. Running `state generate`
again without changing canonical state or Git produces identical bytes.
