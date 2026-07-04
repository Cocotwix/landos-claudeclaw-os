# LandOS Operating Memory

This directory is LandOS-owned operating memory. It is vendor-neutral and shared
by Codex, Claude Code, ChatGPT Project conversations, and future LandOS build
agents.

## Files

| File | Purpose |
|---|---|
| `../LANDOS_CURRENT_STATE.md` | Canonical current build/business state. |
| `CHAT_CONTEXT.md` | Concise conversation continuity: where Tyler and the AI left off talking. |
| `CURRENT_SPRINT.md` | Current sprint, blocker, next exact task, already attempted work. |
| `PROJECT_MEMORY.md` | Durable lessons, gotchas, and what not to repeat. |
| `DECISIONS.md` | Durable decisions. |
| `OPERATOR_QA.md` | Dashboard/operator-visible QA memory. |
| `BUSINESS_QA.md` | Department-as-employee business value QA memory. |
| `KNOWN_LIMITATIONS.md` | Intentionally unfinished work and whether it blocks use. |
| `HANDOVER.md` | Session closeout details. |
| `CONTINUITY_PROTOCOL.md` | How fresh sessions resume and close LandOS work. |
| `OPERATING_STATE.md` | Legacy operating model details retained during transition. |

## Fresh Session Workflow

User input should be enough as:

`Continue LandOS.`

The agent should load `LANDOS_CURRENT_STATE.md`, `CHAT_CONTEXT.md`, and the
`.landos` memory files before continuing autonomously.
