# Reliability and command-path hardening — 2026-07-25

Detail record for the LandOS reliability phase. The compact checkpoint links
here rather than carrying this narrative. Live repository, database, runtime and
owner-visible behavior override anything written here.

Base: `main` at `2c750d3` (synchronized with `origin/main`). Nothing committed
or pushed by this phase.

Upstream ClaudeClaw v1.7.1 was used as a read-only behavioral reference only.
No merge, rebase, cherry-pick or file replacement. Commits consulted:

- `ff3d20f` — "fix(scheduler): end SQLITE_BUSY starvation + normalize CLI
  invocation (Closes #155)". Supplied the diagnosis of the DEFERRED lock
  upgrade, the `BEGIN IMMEDIATE` remedy, the bounded `withBusyRetry` shape, and
  the one-running-per-agent claim guard.
- `31187ea` — "fix(mission-cli): reject unknown --flags instead of swallowing
  them (#162)". Supplied the problem statement. The LandOS implementation is a
  full strict parser, not the upstream leftover-token guard.
- `src/hive-cli.ts` @ `006ea9a` — supplied the store-resolution rationale
  (config.ts is the only reader that can honor a `.env`-relocated store) and the
  `path` / `read` / `log` command shape.

## 1. SQLite contention

**Root cause.** `claimNextMissionTask` ran a DEFERRED transaction: the SELECT
took a read snapshot and the UPDATE had to upgrade to a write lock. SQLite
refuses a stale-snapshot upgrade with `SQLITE_BUSY_SNAPSHOT` *immediately* and
does not consult `busy_timeout` (waiting could deadlock). Measured directly:
the upgrade failed in 0 ms with `busy_timeout = 5000` set. Under overlapping
writes the poller threw every tick and the agent's queue stalled; a completion
write that lost the same race left a finished task in `running` with no
`completed_at` and its output discarded.

A second, independent hole: scheduled tasks were claimed non-atomically —
`getDueTasks()` (a plain read) followed by `markTaskRunning()`. Two schedulers
reading the same snapshot both fired the same task.

**Repair.**

- `claimNextMissionTask` runs `txn.immediate()` (BEGIN IMMEDIATE), taking the
  write lock up front where `busy_timeout` applies, plus a one-running-per-agent
  guard so the store never shows two `running` rows for one agent.
- New `claimScheduledTask(id, nextRun)` puts the `status = 'active'` predicate
  inside the UPDATE, so read and write are one statement. Only the caller whose
  UPDATE reports `changes > 0` executes. `scheduler.ts` now claims through it.
- `withBusyRetry` (exported from `db.ts`): bounded, 4 attempts, 40/80/160 ms
  `Atomics.wait` backoff, retries only busy errors, and rethrows the original
  error so a permanent failure stays actionable. Applied to the claim, complete,
  cancel, mark-running, update-after-run and stuck-reset writes.
- `_initTestDatabase(dbPath?)` accepts a file path so contention is testable at
  all; `_closeTestDatabase()` releases handles.

No architecture change, no destructive migration, SQLite retained.

## 2. Failure classification

**Root cause.** `classifyError` matched `exited with code 1` BEFORE it inspected
the message text. The Claude Code SDK reports an expired login as exactly that —
a non-zero exit whose stderr carries the auth error — so a credential problem was
recorded as `subprocess_crash`, presented to the operator as an application
defect, and (because the crash branch is retryable) retried three times against
a credential that could never succeed.

**Repair.** New `src/failure-classification.ts` owns the decision. Precedence:
explicit cancellation → explicit timeout → spawn errno → provider meaning in
message/stderr → signal or unexplained non-zero exit → clean exit with unusable
output → success. Provider meaning above exit code is the whole fix.

Categories: `success`, `invalid_output`, `auth`, `credentials_missing`, `quota`,
`rate_limit`, `provider_unavailable`, `network`, `launch_failure`, `crash`,
`timeout`, `cancelled`, `context_exhausted`, `unknown`.

`errors.ts` keeps its ClaudeClaw recovery policy (retry / new chat / switch
model) but now takes its category from the shared classifier, and carries the
structured `outcome` on `AgentError`. `launch_failure` is non-retryable: a
missing binary will still be missing next attempt.

Every string that leaves the classifier passes through `redactString`
(`log-redact.ts`), and detail is redacted before truncation so a key cannot
survive as a partial value. Detail is capped at 500 chars.

Persisted as `mission_tasks.failure_category` and
`scheduled_tasks.last_failure_category` (additive nullable columns via the
existing `addColumnIfMissing` path). Surfaced on the dashboard Mission Control
and Scheduled pages, in `mission-cli list|result`, and in `hive-cli failures`.

## 3. Hive CLI

`src/hive-cli.ts`, wired as `npm run landos:hive`. Resolves the store through
`config.ts` (`CLAUDECLAW_STORE_DIR` env → `.env` → `<repo>/store`), never from
`process.cwd()` or a hardcoded path. `--store <dir>` overrides by setting
`CLAUDECLAW_STORE_DIR` before a dynamic `import('./config.js')`.

Read commands: `path`, `status`, `agents`, `missions`, `task <id>`, `failures`,
`scheduled`, `hive`. Filters `--agent`, `--status`, `--created-by`, `--limit`.
`--json` on every read command. One explicit append-only writer: `log`.
Exit codes: 0 success, 1 usage, 2 not found, 3 store/runtime error.

`agents` reads through `getAgentCapabilities` (name + description) rather than
`loadAgentConfig`, which would also carry the agent's bot token.

`mission_tasks` has no parent/child column; `created_by` is the only origin
relationship that exists, and the CLI reports it as the originator.

## 4. Mission CLI strict parsing

`src/mission-cli-args.ts` is a pure parser that runs BEFORE `initDatabase()`, so
a rejected command line never opens the store. Rejects unknown long flags,
unknown short flags, misspelled flags (with a Levenshtein suggestion), missing
flag values, repeated flags, unsupported `--status` values, non-integer
`--priority`, excess positionals, and unknown commands. `--` ends option parsing
so a dash-leading prompt is still expressible. The hand-rolled argv style is
unchanged; no CLI framework was introduced.

## Tests added

| File | Cases |
| --- | --- |
| `src/db-concurrency.test.ts` | 19 |
| `src/failure-classification.test.ts` | 44 |
| `src/mission-cli-args.test.ts` | 33 |
| `src/mission-cli.test.ts` | 9 |
| `src/hive-cli.test.ts` | 36 |

Full suite after: 330 files, 4258 tests, 0 failures (from 325 / 4117).

## Verification gap

No visual browser verification: the Chrome extension was not connected, so the
owner-facing proof was scripted HTTP against the running process
(`/api/mission/tasks` served `failure_category: "cancelled"` end to end) plus a
grep of the built bundle. The rendering itself has not been seen in a browser.
