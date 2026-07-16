# Sprint Report: Staged lifecycle demonstration: dashboard shell journey

- Sprint: `sprint-2026-07-15-lifecycle-demo`
- Created: 2026-07-15T05:18:11.034Z
- Sprint status: complete
- Final combined regression: pass at 2026-07-15T05:32:01.921Z [E:E10][E:E11]
- Independent final review: pass at 2026-07-15T05:32:09.510Z [E:E11]

Every status below is derived from ledger evidence, not builder narrative.

## demo-ws1: Dashboard shell operator journey under the staged lifecycle

- Classification: **Accepted** [E:E9]
- Status: accepted
- Operator outcome: Tyler can open the live LandOS dashboard at http://localhost:3141 and the workspace shell, deal-cards API, and visible content agree with each other and survive a browser refresh.
- Depends on: none
- Browser QA: pass at 2026-07-15T05:23:17.357Z (.runtime/landos/qa/qa-2026-07-15T05-20-48-872Z/report.md) [E:E9]
- Findings: 1 total, 0 unresolved
- Repairs: 1

### Requirements

- [x] demo-ws1-R1: The live dashboard shell renders in a real browser at http://localhost:3141/landos. — evidence: [E:E5][E:E6][E:E7] browser_journey: retest run qa-2026-07-15T05-20-48-872Z: dashboard-shell-health PASS in real browser, preflight 6/6 (.runtime/landos/qa/qa-2026-07-15T05-20-48-872Z/report.json); screenshot: live dashboard shell screenshot from retest run (.runtime/landos/qa/qa-2026-07-15T05-20-48-872Z/dashboard-shell-health/dashboard-shell.png); live_url: exact live dashboard URL (http://localhost:3141/landos)
- [x] demo-ws1-R2: The deal-cards API responds 200 and is consistent with the visible workspace. — evidence: [E:E5] browser_journey: retest run qa-2026-07-15T05-20-48-872Z: dashboard-shell-health PASS in real browser, preflight 6/6 (.runtime/landos/qa/qa-2026-07-15T05-20-48-872Z/report.json)
- [x] demo-ws1-R3: The workspace survives a browser refresh with no visible data loss. — evidence: [E:E8] refresh_persistence: refresh-persistence journey PASS in real browser (run qa-2026-07-15T05-22-42-197Z): deal card content persisted across reload (.runtime/landos/qa/qa-2026-07-15T05-22-42-197Z/report.json)
- [x] demo-ws1-R4: A deliberately failing assertion produces a structured finding, a repair record, and a passing retest of the same journey. — evidence: [E:E5][E:E9] browser_journey: retest run qa-2026-07-15T05-20-48-872Z: dashboard-shell-health PASS in real browser, preflight 6/6 (.runtime/landos/qa/qa-2026-07-15T05-20-48-872Z/report.json); independent_browser_qa: independent QA recheck: same journey rerun after repair, PASS in real browser with fresh screenshots (.runtime/landos/qa/qa-2026-07-15T05-20-48-872Z/report.md)

### Findings

> F1 [major] (closed_retested, internally_fixable): CONTROLLED FIXTURE: expect sentinel "QA-DEMO-SENTINEL-8271" which is intentionally absent vs none of [QA-DEMO-SENTINEL-8271] visible on the live page — pattern `frontend-missing-value`
