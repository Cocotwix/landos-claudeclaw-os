# Independent Browser-QA Brief — ws4-landportal-capture-workflows: LandPortal capture workflows: G Maps rule, default 3D, soil, buildability, Street View

- Sprint: sprint-2026-08-04-pi-workflow-finish
- Live URL: http://localhost:3141/dept/acquisitions/v2?deal=81&section=property-intelligence
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-08-04-pi-workflow-finish\ledger.json
- Persistence checks: refresh=true restart=true

Operator outcome under test: The SOP and live Hermes LandPortal skill require selecting and visually confirming G Maps before applicable map/overlay/Street View work; deal 81 gains a clean default LandPortal 3D capture, a soil capture showing rendered colored soil polygons with structured soil facts, a dedicated yellow buildability capture with structured percentage/acreage when displayed, and Street View captures plus structured observations including a grounded conclusion about the diagonal linear corridor.

## Requirements to disprove
- ws4-r1: SOP and live Hermes LandPortal skill both require selecting and visually confirming G Maps before applicable map, overlay, and Street View workflows, without confusing the comparable Show on Map page.
- ws4-r2: A clean default-framing LandPortal 3D capture is persisted as the primary 3D evidence for deal 81.
- ws4-r3: The soil capture shows rendered colored soil polygons with the subject boundary, and distinct soil units with their structured fields are captured and deduplicated.
- ws4-r4: A dedicated yellow buildability capture with category 'Buildability' and structured percentage/acreage (when displayed) is persisted and surfaced in the PI gallery.
- ws4-r5: Street View is captured and analyzed with structured observations distinguishing observation, interpretation, and unconfirmed conclusion, or its unavailability is recorded; the diagonal corridor is described only per the strongest evidence.

## Required operator journey
1. Open V2 Property Intelligence for deal 81
2. Confirm a default 3D capture is present (not a 2D aerial substitute)
3. Confirm the soil capture visibly contains colored soil polygons across the subject parcel with the boundary visible
4. Confirm a dedicated Buildability capture with the yellow overlay is present
5. Confirm Street View captures and structured observations are present, or an explicit unavailability record
6. Confirm structured soil units and buildability data are visible where displayed
7. Confirm the corridor conclusion reflects the strongest available evidence and no other property's evidence appears
8. Refresh and confirm all captures persist

## Prohibited outcomes
- Must NOT occur: SOP and live skill updated inconsistently or the Show on Map comparable-page rule weakened
- Must NOT occur: 3D capture substituted with 2D aerial or contour
- Must NOT occur: Soil screenshot lacks visible colored polygons inside the parcel
- Must NOT occur: Buildability capture missing, or substituted with slope/contour/aerial/3D evidence
- Must NOT occur: Street View silently skipped without an unavailability record
- Must NOT occur: Corridor called a railroad, trail, or corridor type without supporting evidence
- Must NOT occur: Evidence attributed to the wrong property

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
