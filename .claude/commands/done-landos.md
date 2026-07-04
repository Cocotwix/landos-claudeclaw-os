---
description: "Close a LandOS session and update shared operating memory"
---

# /done-landos

Use this when the current LandOS work session is ready to close. A session is
not complete until engineering QA, Operator QA, Business QA, and memory updates
are handled or a true approval gate blocks completion.

## Required Checks

- Inspect `git status --short`.
- Inspect recent commits with `git log --oneline -5`.
- Summarize tests/builds run and whether they passed.
- Summarize Operator QA.
- Summarize Business QA.
- If dashboard behavior was part of the sprint, summarize real dashboard/server
  verification and the relevant `store/landos.db` state without recording
  private property identifiers.

## Update Memory

Update these files as needed:

1. `LANDOS_CURRENT_STATE.md` - always update current objective, milestone,
   dashboard status, blocker, and next exact deliverable.
2. `.landos/CHAT_CONTEXT.md` - always update current conversation topic,
   conclusions, unfinished discussions, and next conversation topic.
3. `.landos/CURRENT_SPRINT.md` - update sprint status, attempted work, blocker,
   and next exact task.
4. `.landos/HANDOVER.md` - update session closeout details.
5. `.landos/OPERATOR_QA.md` - update when operator-visible QA was run or failed.
6. `.landos/BUSINESS_QA.md` - update when a department/employee was evaluated.
7. `.landos/PROJECT_MEMORY.md` - update durable gotchas, root causes, and what
   not to repeat.
8. `.landos/DECISIONS.md` - update durable decisions.
9. `.landos/KNOWN_LIMITATIONS.md` - update intentionally unfinished work.

## Handoff Must Include

- Last completed work
- Files changed
- Tests/builds run
- Latest commits or "no commit made"
- Current dashboard state
- Failed Operator QA and active blockers
- Latest Business QA finding
- Reference UI artifacts added, if any
- Conversation context updates
- Things already attempted
- Next exact task
- What not to repeat

## Rules

- Do not push or deploy without Tyler approval.
- Do not commit unless the task asks for a commit workflow or Tyler approves the
  commit.
- Do not write secrets, credentials, tokens, cookies, `.env` contents, or raw
  private property data.
- Do not stop early when the blocker is safely fixable.
