# LandOS Operator QA Ledger

Purpose: preserve dashboard-visible acceptance results across Claude Code and
Codex sessions. Keep this concise and safe for the repo.

Do not store secrets, tokens, raw parcel reports, real seller details, APNs, or
private property work product here. When a real property is used, refer to it as
the current operator acceptance property and keep identifiers in
`store/landos.db` or local non-repo artifacts.

Operator QA is mandatory at the end of every implementation sprint after
engineering QA. Passing tests is never enough.

Ask:

> Would Tyler actually use this instead of the existing tool?

If no, continue improving unless an approval gate blocks progress.

## Current Operator QA Status

| Date | Scenario | Result | First Remaining Blocker | Next Exact Fix |
|---|---|---|---|---|
| 2026-07-04 | Dashboard-backed Property Card acceptance for the current operator acceptance property | Failing in real UI | Verified card existed in storage, but Tyler saw duplicate cards, stale Duke/LandPortal credit UI, and missing inspection/discovery sections in Property Board | Finish dashboard-visible Property Card workspace wiring, suppress weak duplicate, render persisted inspection/comps/market/discovery output, then rebuild/restart/verify real dashboard |

## QA Entry Template

```markdown
### YYYY-MM-DD - <scenario>

- Dashboard DB/store:
- Build/server checked:
- Browser route checked:
- Result:
- Operator-visible sections:
  - Property Snapshot:
  - Inspection facts:
  - Visuals/screenshots:
  - Overlay results:
  - Comparable Intelligence:
  - Market Intelligence:
  - Discovery Call Intelligence:
  - Acquisition strategies:
  - Seller questions:
- First failure:
- Root cause:
- Classification: UI wiring | persistence | stale build/server | data-source | credential | incomplete integration | hard stop
- Files changed:
- Tests/builds:
- Reference artifacts:
- Next exact task:
- What not to repeat:
```
