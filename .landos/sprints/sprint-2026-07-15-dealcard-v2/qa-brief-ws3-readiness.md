# Independent Browser-QA Brief — ws3-readiness: Unified readiness and strategy status

- Sprint: sprint-2026-07-15-dealcard-v2
- Live URL: http://localhost:3141
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-07-15-dealcard-v2\ledger.json
- Persistence checks: refresh=true restart=false

Operator outcome under test: One shared readiness record drives Overview, Market, Strategy, Seller, Reports, RAG, and Executive review; strategy readiness cannot read OK while all strategies are blocked; value readiness is not high merely because a median exists; offer readiness explains why it is researching/blocked; the consistency audit fails on any status disagreement.

## Requirements to disprove
- ws3-r1: If all five strategies are blocked, Strategy Readiness cannot display OK or actionable.
- ws3-r2: The UI may say strategy screening is available while actionability is blocked.
- ws3-r3: Value Readiness cannot be high or fully ready merely because a median can be calculated.
- ws3-r4: Zoning, acreage basis, access, title, and physical constraints affect confidence and readiness per materiality.
- ws3-r5: Offer readiness clearly explains why it remains researching or blocked.
- ws3-r6: All tabs and reports consume the same readiness result.
- ws3-r7: The consistency audit fails when visible statuses disagree.

## Required operator journey
1. Open the verified Deal Card Overview and read Strategy/Value/Offer readiness
2. Confirm Strategy Readiness is not OK/actionable while all five strategies are blocked
3. Open the Strategy tab and confirm screening-available vs actionability-blocked is expressed coherently
4. Confirm Value Readiness is not high merely because a median can be computed
5. Confirm Offer Readiness explains why it is researching/blocked
6. Open Market, Seller, Reports and confirm they show the same readiness result
7. Refresh and confirm readiness persists

## Prohibited outcomes
- Must NOT occur: Strategy Readiness OK while all strategies blocked
- Must NOT occur: Value Readiness high solely from a computable median
- Must NOT occur: Offer Readiness with no explanation
- Must NOT occur: Two tabs/reports showing different readiness for the same card
- Must NOT occur: Consistency audit passes despite disagreeing statuses

## Accepted operator facts (must not be contradicted)
- none supplied

## Known historical failure patterns
- frontend-missing-value: 1 occurrence(s) (single occurrence)
- overlay-uses-wrong-acreage-basis: 3 occurrence(s) (reviewed)
- reconciliation-ignores-acreage-conflict: 2 occurrence(s) (reviewed)
- access-unknown-road-called-private: 2 occurrence(s) (reviewed)

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
