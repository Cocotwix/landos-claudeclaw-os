# Independent Browser-QA Brief — demo-ws1: Dashboard shell operator journey under the staged lifecycle

- Sprint: sprint-2026-07-15-lifecycle-demo
- Live URL: http://localhost:3141/landos
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-07-15-lifecycle-demo\ledger.json
- Persistence checks: refresh=true restart=false

Operator outcome under test: Tyler can open the live LandOS dashboard at http://localhost:3141 and the workspace shell, deal-cards API, and visible content agree with each other and survive a browser refresh.

## Requirements to disprove
- demo-ws1-R1: The live dashboard shell renders in a real browser at http://localhost:3141/landos.
- demo-ws1-R2: The deal-cards API responds 200 and is consistent with the visible workspace.
- demo-ws1-R3: The workspace survives a browser refresh with no visible data loss.
- demo-ws1-R4: A deliberately failing assertion produces a structured finding, a repair record, and a passing retest of the same journey.

## Required operator journey
1. Open http://localhost:3141/landos in a real browser
2. Confirm the workspace shell renders with visible LandOS content
3. Reconcile the deal-cards API response with the visible page
4. Capture a screenshot
5. Reload the browser and confirm the workspace persists

## Prohibited outcomes
- Must NOT occur: Dashboard shell fails to render in a real browser
- Must NOT occur: Deal-cards API disagrees with the visible page
- Must NOT occur: Workspace content disappears after refresh
- Must NOT occur: Any operator record is created, modified, or deleted by QA

## Accepted operator facts (must not be contradicted)
- none supplied

## Known historical failure patterns
- none recorded

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
