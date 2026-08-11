# Independent Browser-QA Brief — ws1-instant-section-switching: Instant V2 Overview/Property Intelligence section switching

- Sprint: sprint-2026-08-04-pi-workflow-finish
- Live URL: http://localhost:3141/dept/acquisitions/v2?deal=81
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-08-04-pi-workflow-finish\ledger.json
- Persistence checks: refresh=true restart=false

Operator outcome under test: Switching between V2 Overview and Property Intelligence for deal 81 feels immediate; the property record is loaded once and reused across sections; no research reruns, no stale data, no long loading animation; URL navigation and browser history keep working.

## Requirements to disprove
- ws1-r1: Overview <-> Property Intelligence switching is perceptually immediate in the live localhost workflow.
- ws1-r2: The full property record is not unnecessarily refetched or rebuilt on every section change.
- ws1-r3: Tab switching never reruns research.
- ws1-r4: Canonical-read freshness is preserved; no stale data is introduced.
- ws1-r5: URL navigation and browser history keep working for both sections.

## Required operator journey
1. Open http://localhost:3141/dept/acquisitions/v2?deal=81
2. Switch to Property Intelligence and back to Overview at least 6 times
3. Confirm each switch renders perceptually immediately (content visible well under a second after first load)
4. Confirm via network requests that tab switches do not refetch the full property record or trigger research reruns
5. Use browser back/forward and confirm section navigation still works
6. Refresh on each section and confirm correct content persists

## Prohibited outcomes
- Must NOT occur: A section switch still takes multiple seconds or refetches the full property record every time
- Must NOT occur: Tab switching triggers research reruns
- Must NOT occur: Stale data is shown after underlying data changes
- Must NOT occur: URL or history navigation breaks
- Must NOT occur: The delay is hidden behind a long loading animation instead of removed

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
