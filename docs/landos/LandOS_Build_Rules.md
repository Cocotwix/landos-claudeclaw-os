# LandOS Build Rules

Autonomy policy and safety rules for LandOS, ClaudeClaw-based systems, Codex,
Claude Code, and future build agents.

---

## Core Standard

Default is autonomy after Tyler has explicitly opened an execution sprint.

`/continue-landos` is not an execution trigger. It is an orientation command:
read memory, summarize current state, identify the next recommended task, show
uncommitted changes, then wait for Tyler.

Execution begins only when Tyler explicitly says one of:

- `continue execution`
- `run the next sprint`
- `start the build`
- `implement it`

Agents are expected to continue until the business outcome is complete, not
until the next engineering checkpoint is convenient. Do the work, verify it,
run Operator QA, run Business QA, update memory, and leave the next exact task.

Avoid:

- approval-drip
- micro-prompts
- premature stopping
- "good enough" completion
- engineering-first completion
- stopping after tests when the operator experience is still poor
- asking Tyler to restate information already stored in repo memory

## The Only Approval Gates

Stop and ask Tyler only for:

- secrets
- `.env`
- API keys
- passwords
- paid APIs or credit-consuming endpoints
- external accounts or new external service connections
- money, purchases, subscriptions, billing, ads, or contracts
- destructive deletes, resets, cleans, or irreversible data loss
- `git push`
- production deployments or any deployment

Everything else is approved for autonomous execution inside the requested
mission.

## Autonomous Execution Lane

Proceed without stopping for:

- reading repo files, docs, logs, git status, git log, and git diff
- editing repo-local code/docs/config for the active mission
- creating repo-local memory, QA, command, and reference-artifact scaffolding
- running tests, typecheck, builds, lint, and local verification
- starting/restarting local development servers when needed to verify work
- reading local SQLite state for dashboard verification
- exact-file staging and local commits when the user has asked for a commit
  workflow; never push without approval
- safe package/runtime inspection already present in the repo
- read-only browser/dashboard QA
- configured non-paid providers already part of LandOS, provided they do not
  mutate external systems and do not expose secrets

If work hits a blocker, fix the smallest safe root cause and continue. Do not
stop just to report the first blocker unless it is one of the approval gates.

## Session Completion Standard

A LandOS implementation sprint is not complete until:

1. Engineering QA ran or the reason it could not run is documented.
2. Operator QA ran against the real dashboard when the work has UI or workflow
   impact.
3. Business QA evaluated whether the department/employee creates measurable
   business value.
4. Session memory was updated with what changed, what failed, what remains, and
   the next exact task.

Passing tests is necessary but not sufficient.

## Operator QA

Every implementation sprint must end with Operator QA after engineering QA.

Ask:

> Would Tyler actually use this instead of the existing tool?

If the answer is no, keep improving unless an approval gate or true hard stop is
reached.

Operator QA must inspect the live dashboard or the actual operator surface when
the sprint affects UI/workflow. Record results in `.landos/OPERATOR_QA.md` and
save safe redacted reference artifacts under `docs/reference-ui/` when useful.

## Business QA

Every department must be evaluated as an employee.

Ask:

> Does this employee create measurable business value?

If no, continue working until the business value is clear, or record the blocker
in `.landos/BUSINESS_QA.md`.

## Session Hygiene

Fresh sessions receive LandOS memory automatically: `CLAUDE.md` imports
`.landos/PERMANENT_MEMORY.md` (durable rules) and `.landos/CHECKPOINT.md`
(current state). No `/continue-landos` run or continuation preamble is
required before normal work.

Everything else in `.landos/` and `docs/landos/` is on-demand history: Grep or
Read only the specific section the current task needs. Never bulk-load QA
ledgers, handover history, sprint reports, transcripts, or the database at
session start. Live `git status --short` and `git log --oneline -5` override
memory-file narrative when they disagree.

`/continue-landos` remains available as an optional orientation command; it
loads only the two memory files plus small git/runtime status and reports what
it loaded with estimated token sizes.

Do not ask Tyler to re-explain what is already in memory.

## Agent View Rule

Before editing any agent file, read the current agent config and instruction
file for that agent. Understand what exists before changing it. Preserve role
boundaries and LandOS architecture.

## Secrets and `.env`

Never read, print, write, stage, or commit `.env`.
Never print tokens, JWTs, API keys, credentials, cookies, dashboard tokens,
Gemini keys, LandPortal tokens, or passwords.
If a build step requires a secret, ask Tyler to verify or provide the minimum
needed fact without exposing the value.

## Paid / Money Rules

Never call paid APIs, credit-consuming endpoints, LandPortal comp reports,
LandPortal slope reports, purchases, billing, ad spend, subscriptions, or paid
exports without explicit approval in the current exchange.

Free, configured, read-only providers may be used autonomously when they are
already part of LandOS and do not mutate external systems.

## External Systems

Do not mutate external accounts, CRMs, seller systems, ad accounts, county
systems, cloud services, or production systems without approval.

Read-only browser inspection is allowed when needed for the mission, unless it
would use paid credits or expose credentials.

## Repo and Data Boundaries

The repo is for code, agent personas, MCP/server code, safe config, governance,
session memory, and redacted reference artifacts.

Do not write into the repo:

- secrets or `.env`
- raw private property reports
- unredacted seller records
- real APNs tied to private deals
- private financial figures
- raw training files
- Obsidian work product

Use redacted summaries in repo memory. Keep exact private business data in
`store/landos.db`, the dashboard, Obsidian, or local non-repo storage.

## Git Rules

- Do not `git push` without Tyler approval.
- Do not commit unless the user asked for a commit workflow or approved it in
  the current task.
- Exact-file staging is allowed when preparing an approved local commit.
- Avoid broad staging (`git add .`, `git add -A`) unless the task explicitly
  requires a generated full-file set and the staged list is reviewed before
  commit.
- Never stage `.env`, secrets, logs, generated private reports, property work
  product, or unrelated files.

## Reporting Standard

Final reports must say:

- what changed
- files changed
- tests/builds run
- Operator QA result
- Business QA result
- blockers fixed
- remaining blocker, if any
- next exact task

Do not end with vague optional follow-ups when the next task is known.

