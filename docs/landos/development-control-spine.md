# LandOS Development Control Spine

Vertical Slice 1 is one local, SQLite-backed authority for development tasks,
attempts, evidence, verification, failure knowledge, and exact Git acceptance.
It does not replace `store/landos.db`, run coding providers, manage worktrees,
or alter the business runtime.

## Authority and files

- Git `main` is the default accepted-source authority.
- `.landos/control/landos-control.db` is canonical development-control state.
  It is local and ignored by the repository's existing database policy.
- `.landos/STATE.md` is regenerated from that database plus live Git. It is
  ignored because it is a projection, not manually maintained truth.
- `.runtime/dev/` and `.runtime/devloop/` remain worker traces. Useful results
  must be recorded in the Control Spine to become durable project knowledge.

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

## Commands

```powershell
npm run landos:control -- init
npm run landos:control -- task create --id task-id --title "Title" --outcome "Outcome" --next-action "Start the attempt."
npm run landos:control -- attempt start --task task-id --id attempt-id --worker codex --approach "Smallest implementation."
npm run landos:control -- evidence add --attempt attempt-id --kind implementation_note --summary "What changed"
npm run landos:control -- candidate submit --attempt attempt-id --commit <full-sha> --result "Candidate result"
npm run landos:control -- verification run --attempt attempt-id --command "npm run landos:control:test"
npm run landos:control -- integration-gate prepare --attempt attempt-id
# promote that exact commit to main through the normal local Git integration
npm run landos:control -- integration-gate reconcile
npm run landos:control -- state generate
```

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
