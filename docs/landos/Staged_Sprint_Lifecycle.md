# LandOS Staged Sprint Lifecycle (optional supporting process)

This is optional bookkeeping and QA infrastructure. It may be used when it
materially helps deliver or protect an owner-visible business outcome. It is
not the authority for scope, sequencing, effort, acceptance, or completion;
`AGENTS.md` and the personally verified live operator outcome outrank it.
Repository tooling (`npm run landos:sprint`, `npm run landos:operator-qa`)
must never displace implementation, force the wrong work order, consume the
majority of a session, or convert internal gate success into a completion
claim.

The live operator experience is the final acceptance standard. Tests, build
success, API correctness, and HTTP 200 alone never establish completion.

## Optional lifecycle

When this process is useful, a substantial LandOS prompt may run through:

1. Prompt intake → requirement ledger creation
   (`npm run landos:sprint -- create --file <plan.json>`). The plan converts
   the prompt into explicit workstreams; the original prompt is preserved
   verbatim in the ledger and must not be silently narrowed.
2. Implement Workstream 1 only (`start <wsId>`). The orchestrator refuses to
   start a later workstream while an earlier required one is failed,
   repairing, or unverified, and refuses parallel in-flight workstreams.
3. Record phases in order (`phase <wsId> <phase> pass|fail --detail ...`):
   implementation → targeted_tests → integration_tests → typecheck →
   production_build → runtime_verification. Runtime verification means the
   managed runtime commands only (`npm run landos:status|health`).
4. Independent browser QA (`qa-brief`, then the landos-browser-qa agent, then
   `qa-result`). The QA role is distinct from the builder, receives no builder
   completion narrative, drives the real localhost dashboard, captures
   screenshots, reconciles frontend against API/database and accepted facts,
   and verifies refresh (and where required managed-restart) persistence.
5. Repair loop: every finding returns to the builder (`repair`), requires
   named regression coverage, and closes ONLY through a retest of the same
   journey (`retest`). Builders cannot dismiss visible failures because tests
   pass, narrow a system-wide failure to one acceptance property, rewrite QA
   findings, or relabel internally fixable defects as external blockers.
6. Workstream acceptance (`accept <wsId>`) — refused while: tests fail, the
   production build is stale, the managed server is unhealthy, browser QA has
   not run or has unresolved findings, required screenshots/evidence are
   missing, required persistence is untested, frontend and backend evidence
   conflict, any ledger requirement is unverified, or an internally fixable
   failure is labeled external.
7. Repeat for every workstream.
8. Final combined regression (`final-regression`) and independent final review
   (`final-review`, landos-final-reviewer agent). The sprint cannot complete
   until the final reviewer passes it (`complete`).
9. Checkpoint the accepted capability (`capability freeze`), then refresh the
   compact checkpoint (`npm run landos:memory:checkpoint`).

## Proof-backed completion claims

Agents cannot claim implemented / working / verified / passed / complete /
live / migrated / fixed without linked ledger evidence (`[E:<id>]`).
`npm run landos:sprint -- claims-lint` detects unsupported claims; a narrative
statement without proof remains unverified. Final reports distinguish:
implemented-but-not-QA-verified, QA-failed, repaired-awaiting-retest,
independently-verified, truly-externally-blocked, accepted.

## Recurrence gate

When the same failure pattern (stable kebab-case patternKey) occurs twice, the
ledger tooling requires a root-cause review (`recurrence review`) covering:
pattern, prior occurrences, shared root cause, why tests missed it, why
browser QA missed it, missing invariant, missing acceptance journey, shared
repair, new regression test, new browser assertion, affected capabilities,
and whether an accepted capability must reopen. Acceptance is refused while a
triggered review is outstanding.

## Accepted-capability freeze

Frozen capabilities (`.landos/capabilities.json`) retain golden journeys,
regression fixtures, invariants, browser assertions, proof artifacts,
acceptance date/version, known limitations, and deliberate external blockers.
Work touching their shared dependency paths must rerun the protected journeys
(`capability touched --paths ...`). Reopening requires a verified regression,
an explicitly approved enhancement, or a shared dependency change requiring
revalidation — never a casual redesign.

## Operator QA command

`npm run landos:operator-qa -- --journey <id> | --capability <c> |
--department <d> | --all [--allow-mutations]`. Verifies: current production
build, exactly one managed server, HTTP+health, live frontend bundle matches
dist/web, real browser navigation of the dashboard, required visible values
and interactions, API/frontend reconciliation, refresh persistence, managed
restart persistence where required. Structured JSON+markdown reports and
screenshots land under `.runtime/landos/qa/<runId>/`. Nonzero exit on failure;
exit 3 flags honest gaps (fixture unavailable / manual step / mutation
refused). Reports always distinguish real browser execution from simulation.
Localhost only; no paid browser services; managed runtime commands only.

## Storage map

- Ledger + reports + QA briefs: `.landos/sprints/<sprintId>/`
- Active sprint pointer: `.landos/sprints/current.json`
- Recurrence registry: `.landos/qa/recurrence.json`
- Frozen capabilities: `.landos/capabilities.json`
- Binary QA evidence (screenshots, run reports): `.runtime/landos/qa/` —
  referenced from the ledger by path, never copied into memory files.
