# Independent Browser-QA Brief — ws4-transcript-acceptance: Transcript reconciliation and complete Phase 1 acceptance

- Sprint: sprint-2026-07-17-phase-1-strategic-reset
- Live URL: http://localhost:3141/dept/acquisitions
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-07-17-phase-1-strategic-reset\ledger.json
- Persistence checks: refresh=true restart=true

Operator outcome under test: A human can paste or upload a transcript, Jarvis and the Acquisitions Agent reconcile it into durable shared memory and work, and the entire five-lead/day workflow survives refresh, restart, recovery, and independent live review.

## Requirements to disprove
- P1-10: Transcript paste and transcript-file upload both preserve an immutable original and work from the Lead Card.
- P1-11: Jarvis and the Acquisitions Agent reconciliation produces a concise summary, seller statements separate from verified facts, named parties, explainable motivation, asking price/timeline/property statements, contradictions, deeper-research tasks, follow-up, and one allowed next action.
- P1-13: The complete Phase 1 state survives hard refresh and managed restart.
- P1-14: A five-lead/day synthetic simulation passes entirely in isolated QA storage.
- P1-15: One real lead can complete the entire workflow live without using real records as QA fixtures.
- P1-17: The workflow is ready for and receives the owner's usefulness judgment after independent combined live verification.

## Required operator journey
1. Paste transcript
2. Upload transcript file
3. Inspect original and reconciliation outputs
4. open created tasks and owner decision
5. run five-lead simulation
6. hard refresh
7. managed restart
8. combined cross-surface reconciliation

## Prohibited outcomes
- Must NOT occur: original transcript mutates
- Must NOT occur: seller statements become verified facts
- Must NOT occur: missing motivation evidence
- Must NOT occur: no contradictions/tasks/follow-up/next action
- Must NOT occur: state lost on refresh or restart
- Must NOT occur: QA writes operating data

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
