# Independent Browser-QA Brief — ws2-workspace-ui: Responsive Acquisitions Lead Workspace

- Sprint: sprint-2026-07-15-lead-workspace-foundation
- Live URL: http://localhost:3141/dept/acquisitions?deal=19
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-07-15-lead-workspace-foundation\ledger.json
- Persistence checks: refresh=true restart=true

Operator outcome under test: Tyler opens a lead from Acquisitions and gets one coherent progressive-disclosure workspace.

## Requirements to disprove
- LW4: The live workspace presents identity, seller, canonical acreage, research, market/value, five strategies, evidence, activity, blockers and next action.
- LW5: The Acquisitions path uses the new workspace while existing legacy deep links remain compatible.
- LW6: Desktop and narrow mobile views are usable with honest unknown, stale, unresolved and blocked distinctions.

## Required operator journey
1. Open an existing lead from pipeline
2. inspect canonical summary
3. open deeper evidence/activity
4. refresh and return
5. repeat at mobile width

## Prohibited outcomes
- Must NOT occur: legacy Deal Card tab aggregation feeds new UI
- Must NOT occur: false verified/completeness states
- Must NOT occur: mobile primary navigation breaks

## Accepted operator facts (must not be contradicted)
- none supplied

## Known historical failure patterns
- frontend-missing-value: 2 occurrence(s) (reviewed)
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
