# Independent Browser-QA Brief — ws2-sidebar-facts: Missing LandPortal sidebar facts captured and projected

- Sprint: sprint-2026-08-04-pi-workflow-finish
- Live URL: http://localhost:3141/dept/acquisitions/v2?deal=81&section=property-intelligence
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-08-04-pi-workflow-finish\ledger.json
- Persistence checks: refresh=true restart=true

Operator outcome under test: Water Feature Type (River), Zoning Code (exactly '01 - NOT Z'), the full FEMA flood-zone description, Last Sale Price 16500, Last Sale Date 10-07-2005, Book 1234, Page 75, and Assessed Value $56,700.00 are captured from LandPortal whenever displayed, persisted through the canonical property-fact path with LandPortal as discovery-stage source, and visible in the correct V2 Property Intelligence sections for deal 81.

## Requirements to disprove
- ws2-r1: All eight listed sidebar values are captured whenever LandPortal displays them, with exact labels and displayed values preserved.
- ws2-r2: Zoning code is stored exactly as '01 - NOT Z' and displayed as LandPortal discovery-stage data.
- ws2-r3: The complete FEMA description is preserved and shown in the environmental/FEMA section.
- ws2-r4: Sale info appears in the sale-and-deed-history section and assessed value in the value-and-assessment section; money/date normalization also preserves displayed source values.
- ws2-r5: Facts persist through the existing canonical property-fact path with LandPortal as discovery-stage source; no new store or table; stronger official records are never overwritten.

## Required operator journey
1. Open V2 Property Intelligence for deal 81
2. Confirm Water Feature Type: River appears in property facts or environmental summary
3. Confirm Zoning Code shows exactly '01 - NOT Z' and is marked as LandPortal discovery-stage data
4. Confirm the complete FEMA flood-zone description appears in the environmental/FEMA section
5. Confirm Last Sale Price, Last Sale Date, Book Number, Page Number appear in the sale and deed-history section
6. Confirm Assessed Value $56,700.00 appears in the value and assessment section
7. Refresh and confirm all values persist

## Prohibited outcomes
- Must NOT occur: Any listed field missing from capture, persistence, or the V2 PI display
- Must NOT occur: Zoning code reinterpreted or altered from '01 - NOT Z'
- Must NOT occur: FEMA description truncated
- Must NOT occur: A new property store or sidebar-data table is created
- Must NOT occur: A stronger official record is overwritten
- Must NOT occur: LandPortal not recorded as the discovery-stage source

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
- cdp-attach-foreign-browser-endpoint: 1 occurrence(s) (single occurrence)
- browser-pages-leak-across-runs: 1 occurrence(s) (single occurrence)
- artifact-metadata-page-count-wrong: 1 occurrence(s) (single occurrence)
- overlay-empty-state-not-affirmed: 1 occurrence(s) (single occurrence)
- journey-expect-text-css-transform-mismatch: 1 occurrence(s) (single occurrence)
- foreign-browser-token-tab-residue: 1 occurrence(s) (single occurrence)

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
