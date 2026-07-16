---
description: "Close a LandOS session: refresh the compact checkpoint + QA ledgers"
---

# /done-landos (v2 — compact)

Close the current LandOS work session. A session is not complete until
engineering QA, Operator QA, Business QA, and memory updates are handled or a
true approval gate blocks completion.

## 1. Verify

- `git status --short` and `git log --oneline -5`.
- Summarize tests/builds run and results.
- Summarize Operator QA / Business QA if they ran.

## 2. Refresh the checkpoint (replace, never append)

Run `npm run landos:memory:checkpoint` to replace derived git, verification, and managed-runtime metadata in `.landos/CHECKPOINT.md`. Update its compact business sections only from live files and current acceptance evidence. It must contain:

- Generated date, HEAD hash at generation, dirty-worktree warning.
- Latest test/build status (with date), runtime status (with timestamp).
- Recently completed work (short bullets, link to detailed reports in
  `docs/landos/` — never paste report contents).
- Current unfinished work, blockers, pending Tyler decisions.
- Relevant changed areas and the next recommended priority.

Keep it ≤ 8 KB. Exclude: full prompts, full reports, transcripts, raw logs,
browser/MCP output, secrets, tokenized URLs, property identifiers.

## 3. Append history only where it belongs

- `.landos/OPERATOR_QA.md`: one concise entry, only if operator QA ran.
- `.landos/BUSINESS_QA.md`: one concise entry, only if a department was
  evaluated.
- `.landos/HANDOVER.md`: optional short closeout entry (history file; never
  auto-loaded).

## 4. Audit

Run `npm run landos:memory:audit`. Fix any budget, duplicate, staleness, or
excluded-content violations before ending the session.

## Rules

- Do not push, deploy, or commit without Tyler approval.
- Do not write secrets, tokens, `.env` contents, or private property data.
- Do not stop early when the blocker is safely fixable.
