# Independent Browser-QA Brief — ws1-market-capabilities: Geography-only market capabilities in Tools

- Sprint: sprint-2026-08-31-tools-normalization
- Live URL: http://localhost:3141/tools
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-08-31-tools-normalization\ledger.json
- Persistence checks: refresh=true restart=false

Operator outcome under test: The operator opens Tools and runs County Market Research, ZIP Market Research, and Market Pulse with geography alone (county+state or ZIP), receiving real retained/official market data without any parcel, lead, or Deal Card, and without any new market engine being built.

## Requirements to disprove
- ws1-r1: County Market Research, ZIP Market Research, and Market Pulse are registered capabilities with county/zip prerequisites and are invocable from Tools with geography alone.
- ws1-r2: Market tool results come from the existing engines through the shared capability result contract, with honest data-gap reporting and no fabricated numbers.

## Required operator journey
1. Open the Tools department at http://localhost:3141
2. Run Market Pulse for a county+state with no parcel or lead input
3. Run County Market Research for the same county and ZIP Market Research for a ZIP with retained data
4. Verify real values or honest data-gap statements render, with sources, and that no parcel prerequisite is demanded
5. Hard refresh and confirm the page returns cleanly with no unintended expensive reruns and no new console errors

## Prohibited outcomes
- Must NOT occur: A market tool demands a parcel or creates a lead
- Must NOT occur: A new market engine or second registry is created
- Must NOT occur: Fabricated market numbers appear where data is absent
- Must NOT occur: Market capability results bypass the shared capability result contract

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
