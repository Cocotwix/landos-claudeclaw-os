# LandOS Current Checkpoint

<!-- DERIVED:START -->
- **Generated:** 2026-07-26T00:51:57.954Z
- **HEAD at generation:** `2c750d3`
- **Worktree:** DIRTY; 20 modified/untracked paths at refresh time. Preserve unrelated changes.
- **Latest tests:** PASS at 2026-07-25T16:49:28-04:00; 331 files, 4266 tests, 0 failures (vitest run, full suite).
- **Latest typecheck:** PASS at 2026-07-25T16:45:40-04:00; tsc --noEmit (server) clean; frontend web/tsconfig.json stays pre-existing-red, see Known limitations.
- **Latest production build:** PASS at 2026-07-25T16:45:55-04:00; vite build + tsc passed; Vite emitted only the existing large-chunk advisory.
- **Managed runtime:** RUNNING healthy at 2026-07-25T16:46:20-04:00; PID 67292; http://localhost:3141.
- **Active sprint:** sprint-2026-07-24-zoning-land-use (complete); 3/3 accepted, 0 QA-passed; current workstream none in flight; 0 open QA findings.
- **Sprint ledger:** .landos/sprints/sprint-2026-07-24-zoning-land-use/ledger.json; proof report .landos/sprints/sprint-2026-07-24-zoning-land-use/report.md; frozen capabilities: 3 (.landos/capabilities.json).
<!-- DERIVED:END -->

Live repository, database, runtime and owner-visible behavior
override anything written here. Detail lives under `docs/landos/`. Do not push
without Tyler's go-ahead.

## Current objective and state

Reliability and command-path hardening is COMPLETE and UNCOMMITTED on `main`
(base `2c750d3`). No business behavior changed; Property Intelligence, Deal
Cards, LandPortal, browser intelligence, personas and orchestration are
untouched. Upstream v1.7.1 (`ff3d20f`, `31187ea`, `hive-cli.ts`) was a read-only
reference; nothing merged or cherry-picked. Detail:
`docs/landos/Reliability_Command_Path_Phase_2026-07-25.md`.

1. SQLite root cause: `claimNextMissionTask` used a DEFERRED transaction, so its
   read snapshot had to UPGRADE on the UPDATE. SQLite refuses that with
   `SQLITE_BUSY_SNAPSHOT` at once, ignoring `busy_timeout` (measured 0 ms with
   5000 ms set): claims threw every tick, and completions losing the race
   stranded finished tasks in `running` and discarded output. Scheduled tasks
   had a second hole: a plain read then `markTaskRunning()`.
2. Repair: claim runs `txn.immediate()` plus a one-running-per-agent guard; new
   `claimScheduledTask()` puts `status = 'active'` inside the UPDATE so only the
   caller whose UPDATE changed a row executes; bounded `withBusyRetry`
   (4 attempts, 40/80/160 ms, busy-only, rethrows the original) wraps
   claim/complete/cancel/reset. SQLite retained, no destructive migration.
3. Classification root cause: `classifyError` matched `exited with code 1`
   BEFORE the message text, so an expired provider login was recorded as
   `subprocess_crash` and retried. `src/failure-classification.ts` now reads
   provider meaning FIRST, exit code only as fallback; 14 categories, all output
   through `redactString`. Persisted as `mission_tasks.failure_category` and
   `scheduled_tasks.last_failure_category` (additive nullable columns applied
   live on restart); surfaced on Mission Control, Scheduled and both CLIs.
4. `src/hive-cli.ts` (`npm run landos:hive`): store-aware via config.ts, never
   cwd or a hardcoded path; `--store` override; reads path/status/agents/
   missions/task/failures/scheduled/hive with `--json`; one append-only writer
   (`log`); exit codes 0/1/2/3; never reads a token.
5. `src/mission-cli-args.ts`: strict parser running BEFORE `initDatabase()`, so
   a rejected command line never opens the store. Rejects unknown long/short
   flags, misspellings, missing/repeated values, bad `--status`/`--priority`,
   excess positionals and unknown commands; `--` still allows a dash-leading
   prompt. No CLI framework added. 149 new cases in 6 new files.

## Prior committed work to preserve

Phase 2 security hardening (`1b4f320`, pushed): War Room loopback-by-default
bind, the single pino log-redaction chokepoint, raw-value exfiltration scanning,
a fail-closed migration guard, 3 pins + 5 overrides (npm audit 26 -> 19,
protobufjs CRITICAL RCE gone), `.gitignore` env-backup coverage, closed
dashboard CORS allowlist. The 19 remaining advisories are deliberate and each
needs a semver-MAJOR upgrade.

The LandPortal + Deal Card recovery sprint (`0fccf8b`) repaired the BROWSER AND
DEAL CARD FOUNDATION only: mandatory visual checkpoints, jurisdiction filters
read back off the page, owner ranking for surname-first and rural road-only
situs, a screenshot-quality contract as the only route into the evidence set,
operator-owned page preservation, canonical identity propagation with reads
never writing, read-only Deal Card tabs, and duplicate protection across
submissions, artifacts, candidates, identity versions and resources.

## Accepted property proof to preserve

- Deal 32 (Roane County, TN): identity `confirmed` (1.0) on the official
  Tennessee Comptroller parcel layer. APN `073090 04200` (GISLINK ordered-group
  match, Roane-filtered), owner `SACHAN DILEEP S`, situs `OLD RIDGE RD`, 12.28
  deeded acres, coordinates + source URL. One submission, one artifact (PNG
  2,949,777 bytes, SHA-256
  `df2e1d2c898c9726daca94fbdb0db600ced3a59339a4ca9d012fdbb850ea09f3`), nine
  candidates, no duplicates through restart. Card 32 verified from the official
  record, never screenshot text. Tests pin the wrong-road rejection (no Ridge
  Trail Road) and the Davidson-county APN collision refusal.

- Deal 31 verified control (identity/snapshot v1, 100%, nine immutable evidence
  items) and Deal 10 unresolved control (imagery/comps/valuation/strategy
  withheld) both persist through restart.
- Deal 14 government record snapshot v5: identity v1, 60% screened, medium
  confidence; deed/ownership complete, other lanes partial; seven retained pages
  for instrument 1997O31519 with SHA-256 + official source.

## Exclusions

Never stage `.claude`, `.kilo`, debug scripts, `tmp_query*`,
`verify-deal30.mjs` or `scripts/tmp-*`; unrelated artifacts stay uncommitted.

## Required invariants

1. One accepted property identity version is current.
2. Candidate and confirmed states cannot coexist in the owner read model.
3. Accepted facts link to evidence and the researched identity version.
4. Operator corrections beat weaker automation.
5. GET requests perform no provider work or reconciliation writes.
6. Collector failures are isolated and restart-resumable.
7. Unresolved identity cannot show parcel-specific imagery, ranked comps, FMV or
   actionable strategy.
8. Screenshot text/geometry never establishes official identity or boundaries.
9. Lead/seller/wholesaler identity need not match screenshot owner.

## Known limitations and next action

- Property Intelligence end to end, LandPortal comps, government records and
  full Deal Card research are NOT finished.
- Redaction covers `logger.*` and the failure classifier. Raw `console.*` in
  CLI paths bypasses the chokepoint by design.
- Frontend `web/tsconfig.json` is not green, no npm script: 92 pre-existing
  errors. The authoritative path (`vite build && tsc`) passes.
- Reliability phase IS visually verified: Mission Control cards + history and
  Scheduled card + list views, live at 1280/1440/1600/1707 wide. That check
  found and fixed a real defect (list view showed only `last_status`, so auth
  and provider_unavailable looked identical), pinned by
  `failure-category-ui.test.ts`. Phase 2 stays visually unverified.
- The screenshot contract judges parcel identity, boundary visibility, tile
  load, byte size and obstruction, not zoom framing.
- LandPortal's collapsed parcel panel shows no county, state or coordinates;
  `readScope` reads select2 and native selects, so a bespoke dropdown
  downgrades filter checks to unverified.
- `/overlay/aerial` returns an honest 502 for Roane (no county aerial overlay
  configured); it surfaces once a parcel is confirmed.
- Deal 30 still needs a valid authenticated LandPortal 2D replacement image.
- Professional deed/title/lien, tax, zoning, access, septic, utility and split
  verification remain required before relying on those conclusions.
- Next: the reliability phase awaits Tyler's commit review. Nothing committed,
  nothing pushed.
