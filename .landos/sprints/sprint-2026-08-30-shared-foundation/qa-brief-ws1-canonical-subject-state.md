# Independent Browser-QA Brief — ws1-canonical-subject-state: Contract 1: Canonical Subject State

- Sprint: sprint-2026-08-30-shared-foundation
- Live URL: http://localhost:3141/dept/acquisitions/v2?deal=92
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-08-30-shared-foundation\ledger.json
- Persistence checks: refresh=true restart=false

Operator outcome under test: One typed authoritative Subject State (subjectResolved distinct from officiallyVerified, APN, situs, county, state, FIPS, ZIP, owner, governing acreage, provenance/confidence) is consumed by the readiness checklist, dossier, resolution endpoint, intelligence-run identity, and UI, so a research-grade established subject never reads as no subject downstream, and one governing acreage number appears consistently across surfaces.

## Requirements to disprove
- ws1-r1: One typed CanonicalSubjectState with subjectResolved distinct from officiallyVerified is the shared identity answer.
- ws1-r2: Readiness, resolution endpoint, dossier, snapshot identity, and discovery-package consumers consume it instead of re-deciding identity.
- ws1-r3: Governing acreage is a single consistent conclusion across surfaces; survey governs per doctrine.
- ws1-r4: Verified-dead resolution engines/snapshot write paths are removed with proof of no live references.

## Required operator journey
1. Open Acquisition Workspace V2 for a deal whose subject resolved via Property Resolution without official assessor confirmation
2. Confirm the subject panel, research readiness checklist, and resolution state all present the same established subject (no 'no canonical subject' anywhere)
3. Confirm acreage shown in the header, overview, and property intelligence surfaces is the same governing number with its basis
4. Hard refresh and confirm identical subject and acreage
5. Check console for new errors and confirm no research reruns triggered by these reads

## Prohibited outcomes
- Must NOT occur: Any migrated consumer still reports no subject for a resolved research-grade subject
- Must NOT occur: subjectResolved implies officiallyVerified anywhere
- Must NOT occur: Different acreage numbers on different surfaces for the same deal
- Must NOT occur: A live import is deleted or accepted operator data changes

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
- canonical-state-partial-propagation: 5 occurrence(s) (reviewed)
- same-label-different-basis: 5 occurrence(s) (reviewed)
- ws1-legend-soon-swatch-contract: 1 occurrence(s) (single occurrence)
- legacy-css-collides-with-redesigned-markup: 1 occurrence(s) (single occurrence)

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
