# Durable QA record — Lead Workspace foundation (SPRINT COMPLETE)

Sprint `sprint-2026-07-15-lead-workspace-foundation` completed 2026-07-16
(both workstreams accepted; final regression pass; independent final review
pass by the landos-final-reviewer agent). Full evidence chain:
`.landos/sprints/sprint-2026-07-15-lead-workspace-foundation/` (ledger.json,
report.md, qa-report-ws1-independent.md, qa-report-ws2-independent.md with
Recheck / Recheck 2 / Recheck 3 sections). Capability `lead-workspace` frozen
in `.landos/capabilities.json` (regression protection; Tyler usefulness
review pending).

## What independent QA found and the repair loop fixed

WS1 (read model/endpoint) — 4 findings, all closed_retested:
F1 canonical acreage basis vs legacy reconciliation (blocker), F2 Deal Library
silently opening the legacy Deal Card, F3 double-encoded UTF-8, F4
"Resolution: Not run" after a real attempt. Root-cause review recorded for the
recurring `reconciliation-ignores-acreage-conflict` pattern (3rd occurrence).

WS2 (operator UI) — 4 findings, all closed_retested after two repair rounds:
F5 the resolution engine verified a parcel under a nonexistent requested APN
(official-lane APNs now join the wrong-parcel comparison; a requested APN and
requested address resolving to two different parcels is a hard stop), F6 an
implicit intake overwrote accepted identity records on deal 19 (both storage
boundaries now preserve accepted identity; deal 19 restored from QA-captured
payloads, activity-logged), F7 stale snapshot contradicting the verified chip
(historical labeling), F8 comps table hiding validated actives (per-lane caps
plus honest showing line). Round 2 additionally fixed: report verified-status
COLUMNS (what GET actually reads), conflicted intakes routing to their OWN
research record instead of an implicitly-matched verified card, and gated-off
screening runs contributing zero facts to the operator record.

## Verified live (real browser, three independent QA passes + final review)

Deals 19 (verified, disputed acreage), 20 (existing unresolved), 21/22
(brand-new unresolved/resolved fixtures), 23/24 (genuine wrong-parcel
hard-stop fixtures): honest states everywhere, exactly the five approved
strategies (Cash Flip; Novation or Double Close; Subdivide or Minor Split;
Land-Home Package; Improvement Then Flip — renamed system-wide per Tyler's
prompt), normalized $/acre in the workspace comps, API/UI reconciliation,
legacy quarantine with compatible legacy deep links, refresh + managed-restart
persistence, desktop + 412x915. Deal 19 proven byte-identical through a
repeat conflict-shaped intake (the shape that previously poisoned it).

## Pending Tyler decisions

- Usefulness review of the Lead Workspace as the primary operator surface.
- Disposition of QA fixtures deals 21-24 (self-labeled; 23/24 are honest
  conflicted research cards).
- Review of the deal 19 restorations (activity kind
  `accepted_identity_restored`, agent `landos-repair`): everything
  operator-visible restored; original lane-level snapshot detail was not
  recoverable (disclosed).
- Strategy vocabulary rename (Quick Flip -> Cash Flip, Land Home Package ->
  Land-Home Package) was applied system-wide per the sprint prompt.
