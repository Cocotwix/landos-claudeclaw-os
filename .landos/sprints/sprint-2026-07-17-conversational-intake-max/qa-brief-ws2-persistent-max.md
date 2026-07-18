# Independent Browser-QA Brief — ws2-persistent-max: Persistent Max chief-of-staff surface

- Sprint: sprint-2026-07-17-conversational-intake-max
- Live URL: http://localhost:3141/mission
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-07-17-conversational-intake-max\ledger.json
- Persistence checks: refresh=true restart=true

Operator outcome under test: Max is visibly present on every LandOS page with immediate text and microphone controls, receives replies without navigating away, and replaces Jarvis in operator-facing language.

## Requirements to disprove
- R2-01: A persistent Max assistant dock renders in the global application shell on every primary LandOS route.
- R2-02: The dock supports immediate text submission and browser speech-to-text without requiring navigation to the conversation page.
- R2-03: Max replies and progress are visible globally through the existing chat stream and survive route changes.
- R2-04: Operator-facing chief-of-staff labels use Max while compatibility identifiers may remain internal.
- R2-05: Owner-only outbound, no paid action, and no offer or contract sending rules remain enforced.

## Required operator journey
1. Open Mission Control
2. Confirm Max is present
3. Navigate Acquisitions and another department
4. Confirm Max persists
5. Use microphone or text control
6. Confirm response appears without opening a separate page
7. Refresh and restart

## Prohibited outcomes
- Must NOT occur: Max requires navigating to a separate page
- Must NOT occur: assistant disappears between routes
- Must NOT occur: operator UI still calls the chief of staff Jarvis
- Must NOT occur: voice control missing
- Must NOT occur: external outbound boundary changes

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
