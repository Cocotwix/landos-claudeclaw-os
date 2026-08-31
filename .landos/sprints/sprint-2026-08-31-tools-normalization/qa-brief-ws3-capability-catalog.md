# Independent Browser-QA Brief — ws3-capability-catalog: Prerequisite-aware operator capability catalog

- Sprint: sprint-2026-08-31-tools-normalization
- Live URL: http://localhost:3141/tools
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-08-31-tools-normalization\ledger.json
- Persistence checks: refresh=true restart=true

Operator outcome under test: The operator sees a simple catalog in Tools, driven by the actual capability registry, showing each manually invocable capability's name, what it does, what input it needs, and whether it can run now; missing prerequisites are communicated plainly instead of blanket-disabling tools.

## Requirements to disprove
- ws3-r1: The Tools catalog is driven by the single existing capability registry with a tiny metadata extension, and matches GET /api/landos/capabilities exactly.
- ws3-r2: Missing prerequisites are communicated plainly per capability, and Cases A, B, and D pass on the live Tools surface.

## Required operator journey
1. Open Tools and view the capability catalog
2. Verify every registered manually-invocable capability appears with operator-facing name, description, and required input, and that the list matches GET /api/landos/capabilities
3. Attempt a capability with a genuinely missing prerequisite and verify a plain missing-prerequisite message, not a crash or developer schema error
4. Run Case A (resolve a property, then LandPortal research), Case B (assessor/zoning official research), and Case D (comps with returned-vs-accepted separation) from the live catalog surface
5. Hard refresh and confirm the catalog and last results render cleanly with no new console errors

## Prohibited outcomes
- Must NOT occur: A second registry or duplicate manifest source is created
- Must NOT occur: The catalog invents capabilities not in the registry or hides registered manually-invocable ones
- Must NOT occur: Prerequisite gating blanket-disables tools when a subject is resolvable
- Must NOT occur: The Tools page is visually redesigned beyond functional normalization

## Accepted operator facts (must not be contradicted)
- none supplied

## Known historical failure patterns
- frontend-missing-value: 3 occurrence(s) (reviewed)
- overlay-uses-wrong-acreage-basis: 3 occurrence(s) (reviewed)
- reconciliation-ignores-acreage-conflict: 3 occurrence(s) (reviewed)
- access-unknown-road-called-private: 2 occurrence(s) (reviewed)
- report-download-bypasses-unified-readiness: 1 occurrence(s) (single occurrence)
- market-pulse-favorable-valuation-language: 1 occurrence(s) (single occurrence)
- operator-gap-label-empty-subject: 2 occurrence(s) (reviewed)
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
- canonical-state-partial-propagation: 8 occurrence(s) (reviewed)
- same-label-different-basis: 7 occurrence(s) (reviewed)
- ws1-legend-soon-swatch-contract: 1 occurrence(s) (single occurrence)
- legacy-css-collides-with-redesigned-markup: 1 occurrence(s) (single occurrence)
- market-tool-raw-fetch-error-surfaced: 1 occurrence(s) (single occurrence)

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
