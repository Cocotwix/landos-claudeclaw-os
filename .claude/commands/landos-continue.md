---
description: "Compatibility alias for /continue-landos"
---

# landos-continue

Compatibility alias: prefer `/continue-landos` (v2 — compact).

Follow `.claude/commands/continue-landos.md` exactly. Load only
`.landos/PERMANENT_MEMORY.md`, `.landos/CHECKPOINT.md`, small git status/log,
and `npm run landos:status`; report loaded files + estimated tokens; then wait
for Tyler. Never bulk-load history files, QA ledgers, `docs/landos/` reports,
transcripts, or the database. Do not push or deploy.
