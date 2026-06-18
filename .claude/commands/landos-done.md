---
description: "Close out a LandOS build session with memory updates"
---

# landos-done

Use this when the current LandOS work session is ready to close.

## Required output

1. Summarize what changed.
2. List files changed.
3. List tests run.
4. List live verification, if any.
5. Summarize any blockers or follow-up items.

## Memory updates

- Update `.agents/HANDOVER.md`.
- Update `.agents/CURRENT_STATE.md` only if the architecture or operating model changed.
- Update `.agents/PROJECT_MEMORY.md` only for durable lessons, decisions, or gotchas.
- Update `.agents/DECISIONS.md` only for durable decisions.

## Rules

- Do not commit or push unless Tyler explicitly approves.
- Do not broaden the scope into a new feature sprint.
- Do not write secrets, tokens, credentials, or private data.

