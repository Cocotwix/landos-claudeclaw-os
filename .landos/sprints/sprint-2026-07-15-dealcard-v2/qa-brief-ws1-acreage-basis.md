# Independent Browser-QA Brief — ws1-acreage-basis: Canonical acreage and spatial basis

- Sprint: sprint-2026-07-15-dealcard-v2
- Live URL: http://localhost:3141
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-07-15-dealcard-v2\ledger.json
- Persistence checks: refresh=true restart=false

Operator outcome under test: Every Deal Card reconciles assessed/deeded/surveyed/GIS/provider/operator-accepted/valuation/overlay acreage with source, confidence, dispute and permitted-use metadata; the UI explains assessed-vs-mapped differences; overlays use the geometry actually queried; valuation discloses its basis; a material unresolved basis raises a reconciliation issue and Tyler decision; no gated calc silently uses an unresolved acreage.

## Requirements to disprove
- ws1-r1: The UI explains why assessed and mapped acreage differ.
- ws1-r2: Overlay acreage uses the actual geometry queried.
- ws1-r3: Valuation discloses exactly which acreage basis it uses.
- ws1-r4: A material unresolved acreage basis triggers a reconciliation issue and Tyler decision when appropriate.
- ws1-r5: No calculation silently uses an acreage the header treats as unresolved.
- ws1-r6: Flood, wetlands, soils, slope, non-wetland area, comps, valuation, maps, reports, and strategy math identify the correct acreage basis.
- ws1-r7: A consistency check fails when an overlay area exceeds its queried geometry without a documented explanation.
- ws1-r8: An accepted acreage is not changed without Tyler's confirmation.

## Required operator journey
1. Open the verified Deal Card at http://localhost:3141
2. Read the acreage header on Overview and confirm it distinguishes assessed vs mapped and explains the difference
3. Open Due Diligence and confirm each overlay states which acreage basis it used and that overlay area does not exceed queried geometry
4. Confirm the valuation states the acreage basis it used
5. Confirm a material unresolved acreage basis surfaces a reconciliation issue and a Tyler decision item
6. Refresh the page and confirm all acreage statements persist

## Prohibited outcomes
- Must NOT occur: Header shows a single acreage without explaining assessed-vs-mapped difference
- Must NOT occur: An overlay reports an acreage basis it did not query, or area exceeds queried geometry with no explanation
- Must NOT occur: Valuation does not disclose its acreage basis
- Must NOT occur: Material acreage discrepancy with no reconciliation issue or Tyler decision
- Must NOT occur: A gated calculation uses an acreage the header treats as unresolved
- Must NOT occur: An accepted acreage is changed without Tyler confirmation

## Accepted operator facts (must not be contradicted)
- none supplied

## Known historical failure patterns
- frontend-missing-value: 1 occurrence(s) (single occurrence)

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
