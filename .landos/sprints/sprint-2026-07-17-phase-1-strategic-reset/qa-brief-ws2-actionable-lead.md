# Independent Browser-QA Brief — ws2-actionable-lead: Unified actionable Lead Card and reconciled executive counts

- Sprint: sprint-2026-07-17-phase-1-strategic-reset
- Live URL: http://localhost:3141/dept/acquisitions?section=new
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-07-17-phase-1-strategic-reset\ledger.json
- Persistence checks: refresh=true restart=true

Operator outcome under test: Manual intake immediately creates one durable actionable Lead Card, automatically starts progressive research, and the same opportunity drives Acquisitions, Mission Control, Jarvis explanations, and Lead-to-Deal promotion.

## Requirements to disprove
- P1-01: Manual lead entry creates one durable Lead Card immediately and automatically starts research.
- P1-03: Mission Control, Acquisitions, Jarvis explanations, and database counts derive from the same opportunity records and reconcile.
- P1-04: The Lead Card progressively updates, remains actionable, and never blocks a discovery call because research is incomplete.
- P1-06: County/public/property research progress and provider failures are visible, actionable, and recoverable.
- P1-12: The owner can promote the same opportunity from Lead to Deal and the pursued card receives a subtle visible highlight.

## Required operator journey
1. Enter a synthetic manual lead
2. Open its Lead Card immediately
3. Observe progressive research state and actions
4. Reconcile all executive counts and drilldowns
5. Disposition and pursue opportunities
6. Verify pursued glow
7. refresh and managed restart

## Prohibited outcomes
- Must NOT occur: duplicate competing opportunity created
- Must NOT occur: read-only card
- Must NOT occur: research does not start
- Must NOT occur: counts disagree
- Must NOT occur: pursuit copies a record
- Must NOT occur: incomplete research blocks a discovery call

## Accepted operator facts (must not be contradicted)
- none supplied

## Known historical failure patterns
- frontend-missing-value: 2 occurrence(s) (reviewed)
- overlay-uses-wrong-acreage-basis: 3 occurrence(s) (reviewed)
- reconciliation-ignores-acreage-conflict: 3 occurrence(s) (reviewed)
- access-unknown-road-called-private: 2 occurrence(s) (reviewed)
- report-download-bypasses-unified-readiness: 1 occurrence(s) (single occurrence)
- market-pulse-favorable-valuation-language: 1 occurrence(s) (single occurrence)
- operator-gap-label-empty-subject: 1 occurrence(s) (single occurrence)
- duplicate-blocker-lines: 1 occurrence(s) (single occurrence)
- report-comps-bypass-unique-registry: 1 occurrence(s) (single occurrence)
- legacy-deal-card-silent-fallback: 1 occurrence(s) (single occurrence)
- ui-text-double-encoded-utf8: 1 occurrence(s) (single occurrence)
- resolution-state-label-not-run-after-attempt: 1 occurrence(s) (single occurrence)
- apn-conflict-hard-stop-not-triggered: 1 occurrence(s) (single occurrence)
- intake-dedupe-overwrites-accepted-identity: 1 occurrence(s) (single occurrence)
- stale-resolution-provenance-contradicts-verified-chip: 1 occurrence(s) (single occurrence)
- comps-table-hides-validated-actives: 1 occurrence(s) (single occurrence)
- functional-role-label-mismatch: 1 occurrence(s) (single occurrence)

## Mandate
- Actively attempt to prove the implementation wrong; never repeat the builder's conclusions.
- Open the actual running localhost dashboard in a real browser.
- Navigate the full affected workflow; click every relevant control and open every affected tab.
- Exercise relevant forms, maps, filters, tables, links, and actions.
- Compare visible frontend output with API responses and, when appropriate, database records.
- Compare visible output with accepted operator facts.
- Refresh the browser and verify persistence; when restart persistence is required, restart via npm run landos:restart and reopen the workflow.
- Capture fresh screenshots and exact reproduction steps for every failure.
- Judge business meaning and operator usability, not merely whether pages load.
- Return a non-passing result whenever an internally fixable issue remains.
- After repairs, run the exact same journey again.
