# Independent Browser-QA Brief — ws1-workspace-contract: Canonical Lead Workspace read model and endpoint

- Sprint: sprint-2026-07-15-lead-workspace-foundation
- Live URL: http://localhost:3141/dept/acquisitions?deal=20
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-07-15-lead-workspace-foundation\ledger.json
- Persistence checks: refresh=true restart=true

Operator outcome under test: A single read-only, versioned workspace payload composes existing records without recalculating WS1-WS3 conclusions.

## Requirements to disprove
- LW1: One versioned Lead Workspace read model composes existing records and canonical shared services.
- LW2: Department outputs preserve provenance, freshness, confidence, completeness, blockers, dependencies, and recommended actions.
- LW3: WS1 acreage, WS2 evidence/research, and WS3 readiness/five strategies are consumed, not recomputed.

## Required operator journey
1. Open workspace API for an existing record and verify canonical states are represented honestly.

## Prohibited outcomes
- Must NOT occur: workspace computes acreage/readiness/evidence/strategy independently
- Must NOT occur: provider payload leaks into UI contract

## Accepted operator facts (must not be contradicted)
- none supplied

## Known historical failure patterns
- frontend-missing-value: 2 occurrence(s) (reviewed)
- overlay-uses-wrong-acreage-basis: 3 occurrence(s) (reviewed)
- reconciliation-ignores-acreage-conflict: 2 occurrence(s) (reviewed)
- access-unknown-road-called-private: 2 occurrence(s) (reviewed)
- report-download-bypasses-unified-readiness: 1 occurrence(s) (single occurrence)
- market-pulse-favorable-valuation-language: 1 occurrence(s) (single occurrence)
- operator-gap-label-empty-subject: 1 occurrence(s) (single occurrence)
- duplicate-blocker-lines: 1 occurrence(s) (single occurrence)
- report-comps-bypass-unique-registry: 1 occurrence(s) (single occurrence)

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
