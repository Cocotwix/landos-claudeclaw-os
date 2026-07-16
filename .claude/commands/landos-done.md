---
description: "Compatibility alias for /done-landos"
---

# landos-done

Compatibility alias: prefer `/done-landos` (v2 — compact).

Follow `.claude/commands/done-landos.md` exactly. Closeout refreshes
`.landos/CHECKPOINT.md` in place (never append), appends concise
`.landos/OPERATOR_QA.md` / `.landos/BUSINESS_QA.md` entries only when that QA
ran, optionally appends a short `.landos/HANDOVER.md` history entry, then runs
`npm run landos:memory:audit`. Do not claim completion until engineering QA,
Operator QA, Business QA, and memory updates are handled or an approval gate
blocks progress. Do not push or deploy.
