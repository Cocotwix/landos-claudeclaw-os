# Independent Browser-QA Brief — ws1-single-card-operator-board: One-card-per-opportunity board and recoverable operator deletion

- Sprint: sprint-2026-07-17-operator-useful-leads
- Live URL: http://localhost:3141
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-07-17-operator-useful-leads\ledger.json
- Persistence checks: refresh=true restart=true

Operator outcome under test: The Acquisitions board is a comprehensible Kanban board where each opportunity appears once, card-level blockers do not create duplicate lanes, Lead-to-Deal is a state change, and the owner can trash and restore an unwanted card.

## Requirements to disprove
- R1-01: Each opportunity has exactly one active Kanban card; parcel verification, research state, and discovery gaps are visible card-level status, not duplicate board placement.
- R1-02: The board uses owner-comprehensible operating stages and a Lead becoming a Deal remains the same canonical opportunity.
- R1-03: The owner can move a lead to recoverable Trash and restore it; ordinary deletion does not destroy related operating evidence.
- R1-04: Address/APN duplicate candidates are surfaced for review while distinct parcels are never silently merged.

## Required operator journey
1. Open the operating Acquisitions board
2. Confirm a known opportunity appears in exactly one active lane
3. Create an isolated QA lead and confirm it appears once
4. Move it through a lifecycle transition without duplication
5. Trash it from the card
6. Confirm it leaves active lanes
7. Restore it from Trash
8. Refresh and restart and confirm persistence

## Prohibited outcomes
- Must NOT occur: one opportunity renders in multiple active lanes
- Must NOT occur: parcel verification creates a separate board card
- Must NOT occur: a card is permanently lost by ordinary delete
- Must NOT occur: trash/restore fails after restart
- Must NOT occur: operator cannot identify the next business stage

## Accepted operator facts (must not be contradicted)
- none supplied

## Known historical failure patterns
- frontend-missing-value: 3 occurrence(s) (reviewed)
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
- refresh-data-loss: 1 occurrence(s) (single occurrence)
- restart-assertion-races-async-render: 1 occurrence(s) (single occurrence)
- restart-permission-boundary: 1 occurrence(s) (single occurrence)

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
