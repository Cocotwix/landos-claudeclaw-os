# Independent Browser-QA Brief — zoning-ws3-live: Live acceptance: real jurisdiction + official zoning research on a confirmed deal

- Sprint: sprint-2026-07-24-zoning-land-use
- Live URL: http://localhost:3141
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-07-24-zoning-land-use\ledger.json
- Persistence checks: refresh=true restart=true

Operator outcome under test: On at least one real confirmed Deal Card, an explicit rebuild performs genuine jurisdiction determination and official zoning-map and ordinance retrieval from free official sources, persists a versioned Analyst-backed snapshot with real district, uses, and dimensional standards (honest partials where sources are unavailable), and the Deal Card presents it with refresh and managed-restart persistence, no duplicate evidence, and clean browser resource state.

## Requirements to disprove
- ws3-R1: A real confirmed Deal Card receives a live jurisdiction determination backed by official boundary evidence distinguishing incorporated vs unincorporated authority.
- ws3-R2: The official zoning map/GIS parcel result and the governing ordinance are genuinely retrieved from free official sources with retained artifacts, hashes, URLs, and dates; unavailable sources are reported honestly as partial/unavailable, never fabricated.
- ws3-R3: The persisted snapshot presents base district, overlays, by-right uses, conditional uses, and material dimensional standards with ordinance citations where the ordinance was retrievable.
- ws3-R4: The Deal Card panel shows the live result and survives refresh and managed restart; repeated rebuilds create no duplicate evidence and reuse the snapshot for identical inputs.
- ws3-R5: Browser pages and contexts are closed after success, failure, timeout, and cancellation, with no steady growth of open resources across repeated runs.

## Required operator journey
1. Open http://localhost:3141/landos and open the live acceptance Deal Card
2. Trigger the explicit zoning rebuild control and wait for completion
3. Verify the panel shows the real controlling authority, incorporation status, base district, official source references, and honest per-domain states
4. Reconcile the panel against the GET API and database snapshot rows
5. Refresh the page and confirm identical persisted results
6. Restart the managed runtime (npm run landos:restart) and confirm the snapshot persists
7. Trigger rebuild again and confirm no duplicate evidence rows and the same snapshot version is reused for identical inputs
8. Confirm browser owned-resource records show closed state and no growth across runs

## Prohibited outcomes
- Must NOT occur: Zoning authority inferred from mailing city or county label instead of official boundary evidence
- Must NOT occur: A fabricated district, use list, dimensional standard, or ordinance citation appears
- Must NOT occur: Third-party zoning label presented as official without official corroboration
- Must NOT occur: Duplicate evidence rows after repeated rebuilds
- Must NOT occur: Snapshot lost after refresh or managed restart
- Must NOT occur: Browser pages/contexts left open after runs
- Must NOT occur: A complete result is claimed while an official source was unavailable

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
