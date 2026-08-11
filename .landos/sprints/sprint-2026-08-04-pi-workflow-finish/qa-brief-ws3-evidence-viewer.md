# Independent Browser-QA Brief — ws3-evidence-viewer: Same-page evidence viewer with zoom and pan

- Sprint: sprint-2026-08-04-pi-workflow-finish
- Live URL: http://localhost:3141/dept/acquisitions/v2?deal=81&section=property-intelligence
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-08-04-pi-workflow-finish\ledger.json
- Persistence checks: refresh=true restart=false

Operator outcome under test: Clicking any Property Intelligence evidence image opens a large same-page lightbox filling most of the viewport with correct aspect ratio, the largest useful image, zoom in/out/reset, drag panning, wheel zoom, previous/next navigation, category/caption/source labels, an obvious close control, and Escape close, without leaving the workspace or opening a new tab.

## Requirements to disprove
- ws3-r1: Evidence images open in a large same-page viewer occupying most of the viewport, preserving aspect ratio, showing the largest useful retained image.
- ws3-r2: Zoom in, zoom out, reset-to-fit, drag panning while zoomed, and wheel zoom work.
- ws3-r3: Previous/next navigation works and shows image category, caption, and source when available.
- ws3-r4: The viewer closes via an obvious control and Escape, never navigates away or opens a new tab, and keeps keyboard/focus behavior usable.
- ws3-r5: No new image library dependency is added unless the existing frontend cannot reasonably support the interaction.

## Required operator journey
1. Open V2 Property Intelligence for deal 81
2. Click an evidence thumbnail and confirm a large same-page viewer opens (no navigation, no new tab)
3. Confirm the image keeps its aspect ratio and fills most of the viewport
4. Zoom in, zoom out, reset to fit; drag to pan while zoomed; wheel zoom
5. Navigate previous and next through several images and confirm category/caption/source update
6. Close with the close control, reopen, close with Escape
7. Confirm the workspace behind is unchanged and still on the PI section

## Prohibited outcomes
- Must NOT occur: Clicking evidence still opens another page or tab
- Must NOT occur: Zoom, reset, pan, prev/next, close, or Escape does not work
- Must NOT occur: Aspect ratio distorted or only a small image shown
- Must NOT occur: Category/caption/source missing when available
- Must NOT occur: A new image library is added without demonstrated necessity

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
