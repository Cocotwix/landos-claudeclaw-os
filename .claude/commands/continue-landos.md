---
description: "Optional LandOS orientation: load compact memory + live status only"
---

# /continue-landos (v2 — compact)

Normal LandOS work does NOT need this command: `CLAUDE.md` already auto-imports
`.landos/PERMANENT_MEMORY.md` and `.landos/CHECKPOINT.md` into every fresh
session. Use this command only when Tyler explicitly wants an orientation
summary before assigning work.

## Load (this exact set, nothing more)

1. `.landos/PERMANENT_MEMORY.md` (skip if already imported this session)
2. `.landos/CHECKPOINT.md` (skip if already imported this session)
3. `git status --short` and `git log --oneline -5`
4. `npm run landos:status` (bounded; do not start/restart anything)
5. `npm run landos:memory:status` (reports loaded files + estimated tokens)

## Never load

- `.landos/HANDOVER.md`, `.landos/OPERATOR_QA.md`, `.landos/BUSINESS_QA.md`,
  `.landos/KNOWN_LIMITATIONS.md`, or other Layer C history files
- `docs/landos/` sprint reports, playbooks, or the docs directory broadly
- transcripts, prior prompts, generated reports, or browser/MCP output
- `store/landos.db` or any database query
- Chrome/browser sessions

If the current task later needs a specific historical fact, use the task-specific
retrieval command and read only returned excerpts or paths:
`npm run landos:memory:retrieve -- <query>`.

## Report

- Files loaded and their estimated token sizes (from `landos:memory:status`).
- HEAD, dirty-worktree summary, runtime state (PID + URL if running).
- Checkpoint's next recommended priority, flagged STALE if checkpoint HEAD or
  date disagrees with live git state (live state wins).
- Then wait for Tyler.

## Rules

- Orientation-only: no implementation, tests, builds, edits, restarts.
- Ordinary wording ("continue", "current", "existing", "LandOS", "sprint")
  must not trigger this command or any broad historical loading.
- Approval gates and all safety rules in `.landos/PERMANENT_MEMORY.md` apply.
