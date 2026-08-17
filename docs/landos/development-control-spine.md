# LandOS Development Control Spine

Repaired Slice 2 adds a mandatory managed-workspace boundary to the local,
SQLite-backed authority for development tasks, attempts, evidence,
verification, failure knowledge, governed coding-provider execution, and exact
Git acceptance. It does not replace `store/landos.db` or alter the business
runtime.

Final repaired Slice 3 makes the provider-neutral execution operation the only
candidate-submission path. It validates canonical task, attempt, primary
writer, actual managed cwd, and an attempt-bound Context Pack delivery before
launch or resume. A governed execution row is recorded before the provider is
called. Claude, Codex, and Grok raw completion formats are normalized only
behind their adapters; LandOS observes the clean managed-workspace HEAD itself,
persists exactly one execution-bound Submission Bundle, and only then creates
candidate state. Every provider terminal or post-return validation failure is
durable and ends the writable attempt. Provider prose, including an `ACCEPTED`
claim, never changes acceptance state. The legacy `scripts/dev/task.mjs`
entrypoint delegates only to this operation and refuses its former free-form
lifecycle.

Final repaired Slice 4 makes the Canonical Context Pack complete and mandatory.
The canonical task contract persists objective, explicit non-goals, accepted
and working bases, risk and acceptance policy, architecture/invariant
references, owned scope/interfaces, verification obligations, constraints, and
scoped relevance identities before generation. Generation accepts only an
attempt id, retrieves its exact managed workspace, queries only the named
relevant decisions/failures/evidence, and reads policy, architecture, and the
capability registry from the contract's exact Git commit. The execution HEAD is
read from the validated managed workspace, never the invoking worktree. Stable
serialization and hashing create one attempt/workspace-bound delivery that is
rendered to the provider and referenced by the normalized Submission Bundle.
Caller facts, mutable unrelated worktrees, arbitrary hashes, and another
attempt's delivery cannot alter or substitute the pack.

Repaired Slice 5 atomically derives every governed candidate's versioned plan
from its canonical task contract and risk policy, persisted normalized
Submission Bundle, internally observed base-to-candidate Git range, and the
capability registry at the task's exact policy commit. Worker path and test
claims remain review inputs only. Plans move from `DRAFT` to `SEALED`; their
exact live mandatory identities and structural bindings become immutable.
Executable obligations can receive results only when the Control Spine runs
their command. Explicit `MANUAL_REVIEW` obligations have no executable command
or resource and require a named reviewer plus review evidence. Every result is
bound to the task, attempt, candidate SHA, plan, obligation, policy version,
mechanism, and durable evidence. Database views and triggers derive eligibility
from live sealed rows and refuse direct verified, acceptance, plan-deletion,
result-fabrication, and acceptance-operation bypasses. Development-control paths are architecture-critical.
The Acquisition Workspace V2 baseline covers Property Intelligence, Comps and
Valuation, Land Use and official GIS, run-status, map/details, visible styles,
and routes/contracts at their current component seams.

Repaired Slice 6 normalizes ports, endpoints, CDP endpoints, browser profiles,
databases, and runtimes to physical identities before ownership is granted.
Network identity is TCP plus normalized host scope and port. Existing
filesystem identity uses the real target and stable device/file identity, so a
junction or hard link cannot create a second owner. A not-yet-created path is
reserved by the physical identity of its nearest real existing parent plus the
case-normalized intended child path; active reservations are re-resolved after
creation so an alias cannot take ownership during that transition.
Port 3141, CDP 9224, and the dedicated LandOS browser profile are represented
as protected primary resources. Candidate resources can be acquired, inspected,
and released only against their canonical task and attempt. A verification
obligation that requires a runtime or browser resource acquires it through that
same boundary; acquire/release events bind task, attempt, plan, obligation,
candidate SHA, and physical identity. Conflict evidence blocks the obligation
durably, and no resource-bearing result is eligible without both events.

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
npm run landos:control -- verification run --attempt attempt-id --obligation obligation-id
npm run landos:control -- verification review --attempt attempt-id --obligation manual-obligation-id --outcome PASS --reviewer reviewer-id --review-evidence evidence-reference --summary "Review result"
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
cannot lower a newer shared database version. The DB is filesystem read-only at
rest; explicit current-client bootstrap/writer handles temporarily unlock it
and restore the lock on close. This makes archived clients fail before their
migrations can change schema or resource rows. DELETE journaling keeps status
reads from creating WAL/SHM sidecars.

`local-replay` is an explicit deterministic governed executor. It runs as a
real child process and can report only claims; candidate identity is still the
internally observed clean managed-workspace HEAD, and every sealed verification
and Integration Gate rule remains mandatory. It exists for honest deterministic
replay without creating a migration-only acceptance path.

`verification run` requires a clean worktree at the submitted candidate commit
and executes the sealed obligation itself, so its result is Git-specific. The
manual review command rejects executable and resource-bearing obligations; no
generic result-recording command exists.

Failed verification and `attempt fail` both persist the attempted approach,
result, available root cause or limitation, evidence, and useful next
direction. Retrieve them with:

```powershell
npm run landos:control -- failures --task task-id --json
```

Every mutating command refreshes `.landos/STATE.md`. Running `state generate`
again without changing canonical state or Git produces identical bytes.
