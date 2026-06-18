---
description: "Load LandOS build memory and continue the current sprint"
---

# landos-continue

Read these files before doing anything else:

1. `CLAUDE.md`
2. `.agents/CURRENT_STATE.md`
3. `.agents/CURRENT_SPRINT.md`
4. `.agents/DECISIONS.md`
5. `.agents/HANDOVER.md`
6. `.agents/PROJECT_MEMORY.md`

Then:

- Summarize the current sprint in plain language.
- State the current active priorities.
- Note any blockers or dirty-worktree context.
- Ask for or execute the next scoped instruction.

Rules:

- Do not re-explain the codebase unless asked.
- Do not expand scope beyond the next scoped instruction.
- Do not commit or push.

