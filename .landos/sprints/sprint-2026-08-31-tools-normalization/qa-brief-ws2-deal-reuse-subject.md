# Independent Browser-QA Brief — ws2-deal-reuse-subject: Existing-Deal subject reuse and cross-caller consistency

- Sprint: sprint-2026-08-31-tools-normalization
- Live URL: http://localhost:3141/tools
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-08-31-tools-normalization\ledger.json
- Persistence checks: refresh=true restart=false

Operator outcome under test: The operator selects an existing accepted Deal in Tools and runs research capabilities against it; the run consumes the same canonical Subject State the Deal Card mission uses, never reinterprets property identity, and the same capability implementation serves both callers.

## Requirements to disprove
- ws2-r1: Tools property capabilities can run against an existing Deal's canonical Subject State via deal selection, without reinterpreting identity.
- ws2-r2: For at least one capability, automatic Deal Card invocation and manual Tools invocation demonstrably share the same implementation, prerequisite contract, and evidence/result semantics.

## Required operator journey
1. Open Tools and select an existing accepted Deal as the research subject
2. Run one property capability (e.g. Assessor & Tax or Zoning) against the selected Deal
3. Verify the result names the same canonical subject identity (APN/county) the Deal Card shows, with no re-resolution of identity
4. Verify the run appears with caller type distinct from a raw standalone run and honest result states
5. Hard refresh and confirm the selection and result state survive without unintended reruns

## Prohibited outcomes
- Must NOT occur: A Tools run against a selected Deal re-resolves or reinterprets property identity
- Must NOT occur: A standalone Tools run silently mutates a Deal Card
- Must NOT occur: A duplicate Tools-specific capability or evidence pipeline is introduced

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
