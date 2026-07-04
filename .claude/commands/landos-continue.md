---
description: "Compatibility alias for /continue-landos"
---

# landos-continue

Compatibility alias: prefer `/continue-landos`.

Follow `.claude/commands/continue-landos.md`.

Key rules:

- Load `LANDOS_CURRENT_STATE.md`, `.landos/CHAT_CONTEXT.md`, and shared LandOS
  operating memory before work.
- Report current dashboard state, Operator QA, Business QA, active blockers,
  next exact task, already attempted work, and what not to repeat.
- Continue autonomously unless an approval gate is reached.
- Do not push or deploy.
