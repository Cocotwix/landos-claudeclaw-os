# Independent Browser-QA Brief — ws3-visible-discovery-package: Visible evidence-backed discovery-call package

- Sprint: sprint-2026-07-17-operator-useful-leads
- Live URL: http://localhost:3141
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-07-17-operator-useful-leads\ledger.json
- Persistence checks: refresh=true restart=true

Operator outcome under test: When research succeeds, the owner can open one obvious discovery-call package on the Lead Card and visually inspect parcel maps, comps, deed, property facts, market pulse, and honest strategy readiness. When research is incomplete, the package plainly shows what was attempted and what is still needed.

## Requirements to disprove
- R3-01: The Lead Card exposes one obvious pre-discovery report entry point and visibly renders current parcel-associated evidence instead of opaque links or count-only claims.
- R3-02: The report shows actual research artifacts where available: parcel/satellite/street/terrain/comps-map visuals, selected sold comp cards, county facts, and a deed document or an explicit retrieval gap.
- R3-03: Deed review visibly identifies record owners and preliminary easement/restriction findings with attributable document provenance; it does not substitute for title/legal advice.
- R3-04: Land characteristics, Market Pulse, valuation, offer range, Land Score, and exit strategies are displayed only when their evidence thresholds are met; otherwise the card states the exact gaps and safe next research action.
- R3-05: Final browser verification is performed against the managed operating localhost app, including opening a Lead Card and its report, not only backend output or isolated simulation.

## Required operator journey
1. Open a resolved isolated QA lead and the operating-style 200 Sid Edens card
2. Open the discovery package
3. Visually inspect embedded satellite/street/parcel/comps-map evidence
4. Inspect selected sold comp cards and disclosures
5. Open the deed artifact and preliminary review
6. Inspect market pulse and strategy readiness
7. Confirm incomplete research does not show unsupported value or strategy conclusions
8. Download or open report output
9. Refresh and restart and repeat the visual check

## Prohibited outcomes
- Must NOT occur: evidence is only an invisible backend link
- Must NOT occur: deed is claimed reviewed without an artifact or explicit unavailable state
- Must NOT occur: active/pending comps drive valuation
- Must NOT occur: pricing gates contradict displayed ranges
- Must NOT occur: strategies are generic or blocked without actionable missing evidence
- Must NOT occur: report is hard to find
- Must NOT occur: QA passes without opening the live report

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
