# Independent Browser-QA Brief — ws2-investigative-intake-mission: Investigative lead intake and multi-path parcel resolution

- Sprint: sprint-2026-07-17-operator-useful-leads
- Live URL: http://localhost:3141
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-07-17-operator-useful-leads\ledger.json
- Persistence checks: refresh=true restart=true

Operator outcome under test: A partial free-form lead dump launches an observable research mission that intelligently resolves parcel identity through formatted APN variants and multiple browser/public search paths rather than stopping after one provider fails.

## Requirements to disprove
- R2-01: A non-empty free-form lead dump launches an observable, durable investigative mission, not only a task record or generic queue entry.
- R2-02: Parcel search preserves seller input and tests safe county-aware APN/address formatting variants before declaring no match.
- R2-03: LandPortal browser research is a preferred enrichment path when useful but a no-match or UI failure triggers other permitted search paths rather than ending research.
- R2-04: The Lead Card visibly reports attempted paths, evidence, conflicts, confidence, unresolved identity, and safe next action.
- R2-05: No LandPortal API, MCP wrapper, paid action, seller contact, offer, or contract action is used.

## Required operator journey
1. Open New Lead
2. Paste an address/APN/county partial data dump
3. Submit once
4. Confirm the original is visible
5. Confirm candidate identity and research attempt states are visible
6. Confirm LandPortal is one attempt rather than a terminal gate
7. Confirm a no-match produces explicit next research paths rather than a false completion
8. Refresh and restart and confirm the mission state persists

## Prohibited outcomes
- Must NOT occur: raw intake is lost
- Must NOT occur: provider no-match ends research
- Must NOT occur: APN digits are changed
- Must NOT occur: wrong parcel becomes canonical
- Must NOT occur: research is only an in-memory task
- Must NOT occur: LandPortal API/MCP is invoked
- Must NOT occur: a provider claim is shown without visible attempt/provenance

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
