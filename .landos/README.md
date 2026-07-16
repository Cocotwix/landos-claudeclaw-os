# LandOS Operating Memory

LandOS-owned, vendor-neutral memory shared by Claude Code, Codex, and future
build agents. Three layers:

## Layer A — Permanent (auto-loaded)

| File | Purpose | Budget |
|---|---|---|
| `PERMANENT_MEMORY.md` | Durable operating rules + canonical-location map. | ≤ 4 KB |

## Layer B — Current checkpoint (auto-loaded)

| File | Purpose | Budget |
|---|---|---|
| `CHECKPOINT.md` | The one current-state file: recent work, unfinished work, blockers, pending decisions, git/test/runtime status, next priority. **Replaced in place, never appended.** | ≤ 8 KB |

Both are imported by `CLAUDE.md`, so every fresh session gets them without
`/continue-landos` or a continuation preamble.

## Layer C — On-demand history (never auto-loaded)

| File | Purpose |
|---|---|
| `HANDOVER.md` | Historical session closeouts. |
| `OPERATOR_QA.md` | Operator QA ledger (append per QA run). |
| `BUSINESS_QA.md` | Business QA ledger (append per evaluation). |
| `KNOWN_LIMITATIONS.md` | Intentionally unfinished work. |
| `PROJECT_MEMORY.md` | Durable lessons and gotchas (history). |
| `DECISIONS.md` | Durable decisions (history). |
| `CHAT_CONTEXT.md`, `CURRENT_SPRINT.md`, `OPERATING_STATE.md`, `CONTINUITY_PROTOCOL.md` | Legacy files retained as history. |

Search Layer C with Grep/Read for the specific fact you need. Never bulk-load it.

## Rules

- No transcripts, full prompts, full reports, raw logs, browser/MCP output,
  secrets, or tokenized URLs anywhere in this directory.
- Tooling: `npm run landos:memory:status`, `npm run landos:memory:audit`,
  `npm run landos:memory:checkpoint`, and task-specific `npm run landos:memory:retrieve -- <query>`.
- A fresh session needs only the actual work request. "Continue LandOS" style
  preambles are unnecessary and must not trigger bulk history loading.
