# Lead Workspace Re-baseline — 2026-07-24

Tyler-directed correction of the capability registry and protected golden
journeys after the accepted recovery merge (PR #2, commit `1755c8f`, merged as
`4cc64c2`) intentionally replaced the legacy Lead Workspace with the canonical
Deal Card on every Acquisitions entry path. Identified as OBS-1 in the zoning
sprint independent final review
(`.runtime/landos/qa/zoning-final-review-2026-07-24/report.md`).

This is a registry, test-baseline, and documentation correction only. No
application behavior changed. `web/src/components/LeadWorkspace.tsx` remains in
the tree but is orphaned (imported nowhere); its removal is a separate Tyler
decision. The legacy `/api/landos/lead-workspace/:id` read model still responds
for compatibility but drives no UI.

## Root cause

The frozen capability registry (`.landos/capabilities.json`) and four protected
golden journeys still asserted retired Lead Workspace DOM
(`lead-workspace-root`, `lead-workspace-strategy`, `research-mission-status`,
`discovery-package*`, and workspace-specific wording) after the product
direction moved to the canonical Deal Card. The journeys failed on correct,
approved behavior.

## Journey disposition

| Legacy journey | Disposition | Current coverage |
|---|---|---|
| `lead-workspace-acquisitions-readonly` | **Replaced** by `acquisitions-deal-card-readonly` | Acquisitions deep link and Deal Library click path land on `deal-card-root` (exactly once); retired `lead-workspace-root` forbidden; deal-cards API reconcile; mojibake forbidden; refresh persistence; 412x915 mobile viewport. |
| `genuine-apn-conflict` | **Re-targeted** (one wording step) | Same journey; the identifier-contrast step now accepts the canonical Deal Card's honest wording "not the requested parcel" (kept: "different parcel", "does not match"). All conflict hard-stop assertions unchanged. |
| `phase1-verified-research-mission` | **Replaced** by `research-quarantine-honesty` | Quarantined mission visible on the canonical Deal Card (`deal-card-research-progress`), disclosed as "Research needs parcel confirmation"; "No parcel evidence was promoted" (rejected evidence excluded and says so); explicit `deal-card-research-retry` control; never presented as complete; API reconcile; refresh AND managed-restart persistence. |
| `phase1-unresolved-discovery-package` | **Replaced** by `unresolved-lead-truthful-card` | Unresolved lead's canonical Deal Card is truthful: "No versioned Property Summary exists yet" (no fabricated report), "Not yet confirmed" facts, Smart Intake control available (call path not blocked), prior false-ready/unsupported-ranking claims forbidden, paid/outbound actions forbidden; refresh AND managed-restart persistence. |

**Retired outright (assertions with no current equivalent, documented rather
than faked):**

- The "exactly five approved strategies" (`lead-workspace-strategy` count 5)
  assertion belonged to the retired `/api/landos/lead-workspace` read-model UI.
  Strategy presentation on the canonical Deal Card (Strategy tab, five strategy
  evaluations, pursuit analysis) is owned by the Deal Card sprints; no current
  journey asserts a fixed strategy count.
- The Lead Workspace discovery-package panel assertions (PDF control, Market
  Pulse/Land Score sections, two strategy hypotheses, comp-gating panel) —
  that panel no longer exists. The underlying honesty outcomes (no false
  readiness, withholding until thresholds, no unsupported rankings) are covered
  by `unresolved-lead-truthful-card`, `existing-unresolved-property`, and the
  Deal 10 withholding controls.
- The inverted quarantine assertion "deal-card-root never renders in the
  workspace path" — the Deal Card IS now the canonical path; the assertion is
  reversed in `acquisitions-deal-card-readonly` (`lead-workspace-root`
  forbidden).

## Registry changes

- Capability `lead-workspace` re-baselined as `acquisitions-deal-card`
  (golden journeys `acquisitions-deal-card-readonly`, `genuine-apn-conflict`);
  invariants/browser assertions rewritten for the canonical Deal Card; shared
  dependency paths now track `DealCard.tsx`/`Acquisitions.tsx` instead of the
  orphaned workspace files; Tyler acceptance recorded for the re-baseline.
- Capability `phase1-research-before-discovery`: golden journeys updated to
  `phase1-shell-free-navigation` (unchanged), `research-quarantine-honesty`,
  `unresolved-lead-truthful-card`; browser assertions re-worded to the
  canonical Deal Card surfaces; backend invariants unchanged (they remain true).
- Reopen checks recorded via
  `landos:sprint capability check-reopen <id> --reason approved_enhancement
  --approved-by Tyler` for both capabilities ("Reopen justified.").

## Identified but deferred (not registry-protected, not modified)

These journeys also reference retired Lead Workspace DOM but are sprint-scoped
acceptance journeys, not frozen-registry protections. Rewriting them without a
live (partly mutation-approved) verification session would fabricate coverage:

- `ws1-operator-opportunity-board`, `ws2-investigative-intake-mission`,
  `ws3-visible-discovery-package` (sprint-2026-07-17-operator-useful-leads
  acceptance journeys; capabilities never frozen).
- `phase1-manual-lead-promotion`, `phase1-transcript-reconciliation`
  (mutating, refused by default; need their own mutation-approved re-baseline).

Both deferrals are recorded as known limitations on the affected capability
entries.

## Verification (this session)

- Focused tests: see final report (operator-qa-runner + journey validation).
- Live verified-browser runs of `acquisitions-deal-card-readonly`,
  `genuine-apn-conflict`, `research-quarantine-honesty`,
  `unresolved-lead-truthful-card`, plus unchanged `phase1-shell-free-navigation`.
