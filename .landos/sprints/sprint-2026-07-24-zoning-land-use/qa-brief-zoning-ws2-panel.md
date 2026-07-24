# Independent Browser-QA Brief — zoning-ws2-panel: Deal Card Zoning & Land Use panel

- Sprint: sprint-2026-07-24-zoning-land-use
- Live URL: http://localhost:3141
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-07-24-zoning-land-use\ledger.json
- Persistence checks: refresh=true restart=false

Operator outcome under test: Tyler opens a confirmed Deal Card and sees a readable persisted Zoning & Land Use panel showing controlling authority, incorporated status, base district, overlays, official sources, uses by right, conditional uses, key dimensional standards, development implications, risks, missing evidence, last researched date, and snapshot version, with an explicit rebuild control and honest empty state.

## Requirements to disprove
- ws2-R1: The Deal Card shows a persisted Zoning & Land Use panel with authority, incorporation status, base district, overlays, official sources, by-right uses, conditional uses, dimensional standards, implications, risks, missing evidence, last researched date, and snapshot version.
- ws2-R2: Opening/refreshing the Deal Card performs no zoning research; rebuild is an explicit operator button issuing the POST command.
- ws2-R3: By-right and conditional/special uses are visually separated and never conflated.
- ws2-R4: UI source cannot import collector or Analyst modules (source-scan regression).

## Required operator journey
1. Open http://localhost:3141/landos and open confirmed Deal Card 32
2. Locate the Zoning & Land Use panel and confirm it shows an honest not-yet-researched state without triggering research
3. Reconcile the panel contents against GET /api/landos/deal-cards/32/zoning-land-use
4. Refresh the page and confirm the panel state persists and no zoning jobs were created by loading

## Prohibited outcomes
- Must NOT occur: Panel load triggers zoning research or writes
- Must NOT occur: Conditional uses displayed merged with or labeled as by-right uses
- Must NOT occur: Panel fabricates values not present in the persisted snapshot
- Must NOT occur: Existing Deal Card sections regress

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
- ws1-qa-card-count-contract: 1 occurrence(s) (single occurrence)
- ws1-qa-lane-selector-contract: 1 occurrence(s) (single occurrence)
- managed-restart-access-denied: 1 occurrence(s) (single occurrence)

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
