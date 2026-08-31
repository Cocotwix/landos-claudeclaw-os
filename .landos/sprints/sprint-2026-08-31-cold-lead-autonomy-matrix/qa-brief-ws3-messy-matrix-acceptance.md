# Independent Browser-QA Brief — ws3-messy-matrix-acceptance: Messy intake and final autonomy matrix acceptance

- Sprint: sprint-2026-08-31-cold-lead-autonomy-matrix
- Live URL: http://localhost:3141/dept/acquisitions/v2?deal=113
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-08-31-cold-lead-autonomy-matrix\ledger.json
- Persistence checks: refresh=true restart=true

Operator outcome under test: A realistic imperfect seller-style submission is combined autonomously into a stable working subject when reasonably resolvable, and the full five-case matrix communicates honest completeness, gaps, and genuine operator action on the normal Deal Card.

## Requirements to disprove
- ws3-r1: A fresh difficult but reasonably resolvable seller-style intake combines its clues autonomously and reaches one stable working subject or asks at most one genuinely decision-changing clarification.
- ws3-r2: Across all five leads deterministic routes run first, bounded recovery runs only when justified, and no developer action is used to turn a failed case into a pass.
- ws3-r3: Every meaningful fact and artifact used by readiness or intelligence is admitted with source, run, subject scope, and honest confidence.
- ws3-r4: Readiness and all four intelligence layers remain current after evidence changes and persist through hard refresh and managed restart without rerunning settled research.
- ws3-r5: The visible Deal Card clearly communicates the established subject, property facts, market, comp/valuation status, intelligence, unresolved gaps, and only genuine operator action without exposing orchestration internals.

## Required operator journey
1. Submit realistic imperfect seller-style intake through New Lead
2. Make no manual corrections and observe bounded autonomous resolution and research
3. Inspect the final Deal Card and any action-needed message as an operator
4. Reinspect representative successful cases after hard refresh and managed restart
5. Confirm no new console errors or unintended expensive reruns
6. Produce the five-case autonomy, readiness, recovery, intelligence, and performance matrix

## Prohibited outcomes
- Must NOT occur: A reasonably resolvable messy lead enters an interview loop or needs developer repair
- Must NOT occur: A valid recovery route remains when LandOS reports blocked
- Must NOT occur: Missing zoning, comps, or valuation is guessed to make the card look complete
- Must NOT occur: The normal Deal Card exposes internals instead of a clear operational story
- Must NOT occur: Any successful case requires refresh or restart to continue processing

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
- legacy-deal-card-silent-fallback: 2 occurrence(s) (reviewed)
- ui-text-double-encoded-utf8: 2 occurrence(s) (reviewed)
- resolution-state-label-not-run-after-attempt: 1 occurrence(s) (single occurrence)
- apn-conflict-hard-stop-not-triggered: 1 occurrence(s) (single occurrence)
- intake-dedupe-overwrites-accepted-identity: 1 occurrence(s) (single occurrence)
- stale-resolution-provenance-contradicts-verified-chip: 1 occurrence(s) (single occurrence)
- comps-table-hides-validated-actives: 1 occurrence(s) (single occurrence)
- functional-role-label-mismatch: 1 occurrence(s) (single occurrence)
- refresh-data-loss: 1 occurrence(s) (single occurrence)
- restart-assertion-races-async-render: 1 occurrence(s) (single occurrence)
- restart-permission-boundary: 1 occurrence(s) (single occurrence)
- ws1-qa-card-count-contract: 1 occurrence(s) (single occurrence)
- ws1-qa-lane-selector-contract: 1 occurrence(s) (single occurrence)
- managed-restart-access-denied: 1 occurrence(s) (single occurrence)
- cdp-attach-foreign-browser-endpoint: 1 occurrence(s) (single occurrence)
- browser-pages-leak-across-runs: 1 occurrence(s) (single occurrence)
- artifact-metadata-page-count-wrong: 1 occurrence(s) (single occurrence)
- overlay-empty-state-not-affirmed: 1 occurrence(s) (single occurrence)
- journey-expect-text-css-transform-mismatch: 1 occurrence(s) (single occurrence)
- foreign-browser-token-tab-residue: 1 occurrence(s) (single occurrence)
- canonical-state-partial-propagation: 7 occurrence(s) (reviewed)
- same-label-different-basis: 6 occurrence(s) (reviewed)
- ws1-legend-soon-swatch-contract: 1 occurrence(s) (single occurrence)
- legacy-css-collides-with-redesigned-markup: 1 occurrence(s) (single occurrence)

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
