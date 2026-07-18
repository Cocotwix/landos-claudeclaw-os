# Independent Browser-QA Brief — ws3-discovery-package: Best-available discovery research package

- Sprint: sprint-2026-07-17-phase-1-strategic-reset
- Live URL: http://localhost:3141/dept/acquisitions
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-07-17-phase-1-strategic-reset\ledger.json
- Persistence checks: refresh=true restart=true

Operator outcome under test: Every Lead Card exposes one evidence-backed current discovery report and PDF with parcel, visual, comp, market, scoring, strategy, gap, confidence, and call-prep information even when identity or providers remain unresolved.

## Requirements to disprove
- P1-05: A real authenticated LandPortal browser session extracts visible parcel facts, visible comps, the free Show on Map screenshot, and relevant visual evidence without API dependence or paid action.
- P1-07: Comparable selection enforces sold-driven value, active/pending context, up to five, 3/5/10-mile expansion, 12/18/24-month limits, county-wide disclosure, and provider deduplication.
- P1-08: One current report drives the Lead Card and PDF and includes identity, visuals, land characteristics, deed findings, Market Pulse, explainable Land Score, preliminary value and 40-60 percent offer range, two strategies, gaps, sources, confidence, and call questions.
- P1-09: An incomplete or unresolved property still produces a useful seller-focused call brief while unsupported parcel conclusions, confident valuation, offer preparation, and automatic pursuit remain blocked.

## Required operator journey
1. Run authenticated read-only LandPortal visible extraction
2. Capture parcel facts, visible comps, free Show on Map, and visuals
3. Open complete resolved report and PDF
4. Open unresolved report and confirm useful identity questions
5. verify no paid/API action

## Prohibited outcomes
- Must NOT occur: API/MCP request
- Must NOT occur: paid report or credit use
- Must NOT occur: active/pending drives value
- Must NOT occur: sale older than 24 months
- Must NOT occur: unsupported property conclusion
- Must NOT occur: separate contradictory report projections
- Must NOT occur: missing research blocks call prep

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
