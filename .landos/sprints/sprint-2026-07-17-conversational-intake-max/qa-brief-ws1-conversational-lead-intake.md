# Independent Browser-QA Brief — ws1-conversational-lead-intake: One-box conversational manual lead intake

- Sprint: sprint-2026-07-17-conversational-intake-max
- Live URL: http://localhost:3141/dept/acquisitions?section=new
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-07-17-conversational-intake-max\ledger.json
- Persistence checks: refresh=true restart=true

Operator outcome under test: The owner can paste or dictate one unstructured data dump, submit it once, and immediately receive a Lead Card whose extracted clues and unknowns are visible while research starts automatically.

## Requirements to disprove
- R1-01: New Lead presents one prominent free-form text area with optional microphone input and no required individual CRM fields.
- R1-02: A non-empty data dump always creates a durable Lead Card while preserving the exact raw input and provenance.
- R1-03: LandOS extracts only defensible seller, contact, source, and property clues; absent or uncertain values remain unknown or needs verification.
- R1-04: Lead creation immediately queues the durable property research mission and opens the resulting Lead Workspace.

## Required operator journey
1. Open New Lead
2. Paste one mixed seller/property data dump
3. Submit once
4. Confirm Lead Card opens
5. Confirm extracted clues and queued/running research are visible
6. Refresh and confirm persistence

## Prohibited outcomes
- Must NOT occur: individual CRM fields remain
- Must NOT occur: seller name or parcel clue blocks creation
- Must NOT occur: raw input is lost
- Must NOT occur: fabricated values
- Must NOT occur: research does not start
- Must NOT occur: created card is not opened

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
