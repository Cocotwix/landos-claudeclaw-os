# LandOS Cross-Session Continuity Protocol

Purpose: give every coding agent and ChatGPT Project conversation the same
LandOS-owned memory loop while supporting the LandOS autonomy standard.

This memory belongs to LandOS as a company. It is vendor-neutral and shared by
Codex, Claude Code, ChatGPT, and future build agents.

## LandOS Memory Files

| File | Role |
|---|---|
| `LANDOS_CURRENT_STATE.md` | Canonical current build/business state. Evolves into executive operating brief over time. |
| `.landos/CHAT_CONTEXT.md` | Concise conversation memory: where Tyler and the AI left off talking. |
| `.landos/CURRENT_SPRINT.md` | Current sprint, blocker, next exact task, already attempted work. |
| `.landos/PROJECT_MEMORY.md` | Durable lessons, gotchas, and what not to repeat. |
| `.landos/DECISIONS.md` | Durable business and architecture decisions. |
| `.landos/OPERATOR_QA.md` | Operator QA runs, failures, blockers, and dashboard-visible acceptance evidence. |
| `.landos/BUSINESS_QA.md` | Department-as-employee business value checks. |
| `.landos/KNOWN_LIMITATIONS.md` | Intentionally unfinished work and whether it blocks current business use. |
| `.landos/HANDOVER.md` | Session closeout details. |
| `docs/reference-ui/` | Redacted screenshots and visual acceptance artifacts. |

## Continue Loop

Use `/continue-landos` at the start of a fresh Claude Code, Codex, or future
build-agent session.

The agent must:

1. Read `LANDOS_CURRENT_STATE.md`.
2. Read `.landos/CHAT_CONTEXT.md`.
3. Read `.landos/CURRENT_SPRINT.md`, `.landos/PROJECT_MEMORY.md`,
   `.landos/DECISIONS.md`, `.landos/OPERATOR_QA.md`,
   `.landos/BUSINESS_QA.md`, and `.landos/KNOWN_LIMITATIONS.md`.
4. Inspect `git status --short` and recent commits.
5. Identify current dashboard/database state from memory and, when needed,
   read-only checks against `store/landos.db`.
6. Review the most recent Operator QA and Business QA entries.
7. Summarize current state, active blockers, the next recommended task, and any
   uncommitted changes.
8. Stop and wait for Tyler.

`/continue-landos` is orientation-only by default. It does not authorize
implementation.

Only begin execution if Tyler explicitly says one of:

- `continue execution`
- `run the next sprint`
- `start the build`
- `implement it`

## Done Loop

Use `/done-landos` when closing a session.

The agent must update:

- `LANDOS_CURRENT_STATE.md`
- `.landos/CHAT_CONTEXT.md`
- `.landos/CURRENT_SPRINT.md`
- `.landos/HANDOVER.md`
- `.landos/OPERATOR_QA.md` when operator-visible QA ran or failed
- `.landos/BUSINESS_QA.md` when a department/employee was evaluated
- `.landos/PROJECT_MEMORY.md` for durable lessons
- `.landos/DECISIONS.md` for durable decisions
- `.landos/KNOWN_LIMITATIONS.md` when unfinished work changes

The handoff must include:

- Last completed work.
- Files changed.
- Tests/builds run.
- Latest commits or note that no commit was made.
- Current dashboard state.
- Failed Operator QA and first unresolved blocker.
- Latest Business QA finding.
- Current conversation topic or unfinished discussion.
- Next exact task.
- Things already attempted.
- What not to repeat.

## Operator QA Loop

Use `/operator-qa` for dashboard-backed acceptance checks.

The agent must record:

- Scenario tested.
- Real dashboard DB/store used.
- Pass/fail by operator-visible section.
- First failure and root cause.
- Whether the blocker is UI wiring, persistence, stale build/server,
  data-source, credential, incomplete integration, or hard stop.
- Reference screenshots/assets, if safe and redacted.

## Business QA Loop

Use `/business-qa` or the Business QA section of `/done-landos` for every
department implementation sprint.

The agent must ask:

> Does this employee create measurable business value?

Record result, evidence, missing business value, first business blocker, and
next exact task in `.landos/BUSINESS_QA.md`.

## ChatGPT Project Continuity

A new ChatGPT Project conversation should require only:

`Continue LandOS.`

The repository should then provide enough state for the new session to
reconstruct the current project, current sprint, current reasoning, and where
Tyler and the AI left off conversationally. The command should orient the
session and wait for Tyler, not auto-start implementation.

Name conversations by sprint or business topic, not "handoff."

Examples:

- Market Intelligence UI QA
- Browser Agent 5-10 Acres
- Governance Memory Reset
- Discovery Report Wiring
- Market Selection Matrix

## Safety Rules

- Do not write secrets, tokens, cookies, credentials, or `.env` contents.
- Do not write property-specific business work product into repo memory.
- Do not store real APNs, seller details, private addresses, or raw parcel
  reports in these docs.
- `docs/reference-ui/` is for UI acceptance artifacts. Redact or crop any
  sensitive property, seller, token, or filesystem information before adding.
- Do not `git push` or deploy without Tyler approval.
- Do not commit unless the current task asks for a commit workflow or Tyler
  approves the commit.

## Starter Kit Ideas Incorporated After Governance Reset

- Persistent handoff memory.
- Continue/start-session command.
- Done/end-session command.
- Active sprint memory.
- Operator QA memory.
- Business QA memory.
- Reference asset tracking.
- Conversation continuity memory.
- Known limitations ledger.
- "What not to repeat" and "already attempted" sections.
- Orientation-first continuation from the stored next task.

## Starter Kit Parts Rejected

- Generic PRD rewrites.
- Auto-push and deployment behavior.
- Blind installation of starter-kit hooks or commands.
- Any workflow that stores secrets or private deal data in repo memory.
- Replacing LandOS source-of-truth docs with starter-kit docs.
