# Sprint Report: Conversational lead intake and persistent Max

- Sprint: `sprint-2026-07-17-conversational-intake-max`
- Created: 2026-07-17T17:31:32.733Z
- Sprint status: complete [E:E4][E:E11][E:E12][E:E15][E:E17][E:E18][E:E4][E:E8][E:E15][E:E17]
- Final combined regression: pass at 2026-07-17T18:14:39.535Z [E:E4][E:E11][E:E12][E:E15][E:E17][E:E18]
- Independent final review: pass at 2026-07-17T18:14:40.305Z [E:E4][E:E8][E:E15][E:E17]

Every status below is derived from ledger evidence, not builder narrative.

## ws1-conversational-lead-intake: One-box conversational manual lead intake [E:E4]

- Classification: **Accepted** [E:E4]
- Status: accepted
- Operator outcome: The owner can paste or dictate one unstructured data dump, submit it once, and immediately receive a Lead Card whose extracted clues and unknowns are visible while research starts automatically.
- Depends on: none
- Browser QA: pass at 2026-07-17T17:58:52.184Z (.runtime/landos/qa/qa-2026-07-17T17-58-11-623Z/report.md) [E:E4]
- Findings: 0 total, 0 unresolved
- Repairs: 0

### Requirements

- [x] R1-01: New Lead presents one prominent free-form text area with optional microphone input and no required individual CRM fields. — evidence: [E:E1][E:E4] test: Focused conversational intake, route, research-constraint, and UI regression passed (89 tests across the focused runs). (src/landos/conversational-lead-intake.test.ts); browser_qa: Independent real-browser QA passed the conversational dump, exact source visibility, research controls, promotion, refresh persistence, and reconciled metrics in isolated QA storage. (.runtime/landos/qa/qa-2026-07-17T17-58-11-623Z/report.md)
- [x] R1-02: A non-empty data dump always creates a durable Lead Card while preserving the exact raw input and provenance. — evidence: [E:E1][E:E4] test: Focused conversational intake, route, research-constraint, and UI regression passed (89 tests across the focused runs). (src/landos/conversational-lead-intake.test.ts); browser_qa: Independent real-browser QA passed the conversational dump, exact source visibility, research controls, promotion, refresh persistence, and reconciled metrics in isolated QA storage. (.runtime/landos/qa/qa-2026-07-17T17-58-11-623Z/report.md)
- [x] R1-03: LandOS extracts only defensible seller, contact, source, and property clues; absent or uncertain values remain unknown or needs verification. — evidence: [E:E1][E:E4] test: Focused conversational intake, route, research-constraint, and UI regression passed (89 tests across the focused runs). (src/landos/conversational-lead-intake.test.ts); browser_qa: Independent real-browser QA passed the conversational dump, exact source visibility, research controls, promotion, refresh persistence, and reconciled metrics in isolated QA storage. (.runtime/landos/qa/qa-2026-07-17T17-58-11-623Z/report.md)
- [x] R1-04: Lead creation immediately queues the durable property research mission and opens the resulting Lead Workspace. — evidence: [E:E1][E:E3][E:E4] test: Focused conversational intake, route, research-constraint, and UI regression passed (89 tests across the focused runs). (src/landos/conversational-lead-intake.test.ts); runtime: Managed LandOS runtime healthy after production rebuild and canonical restart: HTTP 200, PID 1752. (http://localhost:3141/dept/acquisitions?section=new); browser_qa: Independent real-browser QA passed the conversational dump, exact source visibility, research controls, promotion, refresh persistence, and reconciled metrics in isolated QA storage. (.runtime/landos/qa/qa-2026-07-17T17-58-11-623Z/report.md)

## ws2-persistent-max: Persistent Max chief-of-staff surface [E:E14][E:E15][E:E16]

- Classification: **Accepted** [E:E14][E:E15][E:E16]
- Status: accepted
- Operator outcome: Max is visibly present on every LandOS page with immediate text and microphone controls, receives replies without navigating away, and replaces Jarvis in operator-facing language.
- Depends on: ws1-conversational-lead-intake [E:E4]
- Browser QA: pass at 2026-07-17T18:11:00.133Z (.runtime/landos/qa/qa-2026-07-17T18-09-58-347Z/report.md) [E:E14][E:E15][E:E16]
- Findings: 0 total, 0 unresolved
- Repairs: 0

### Requirements

- [x] R2-01: A persistent Max assistant dock renders in the global application shell on every primary LandOS route. — evidence: [E:E11][E:E14][E:E15][E:E17] test_result: Max UI, navigation naming, owner-only egress, transcript safety, and acquisition regression passed (40 focused tests). (src/landos/max-dock-ui.test.ts); browser_journey: Real-browser navigation confirmed Max on Mission Control, Acquisitions, and the full Max conversation page. (.runtime/landos/qa/qa-2026-07-17T18-09-58-347Z/report.md); independent_browser_qa: Independent real-browser Max journey passed with zero findings. (.runtime/landos/qa/qa-2026-07-17T18-09-58-347Z/report.md); restart_persistence: After canonical stop/start into operating mode, the independent real-browser Max journey passed again with PID 202952. (.runtime/landos/qa/qa-2026-07-17T18-12-34-583Z/report.md)
- [x] R2-02: The dock supports immediate text submission and browser speech-to-text without requiring navigation to the conversation page. — evidence: [E:E11][E:E14] test_result: Max UI, navigation naming, owner-only egress, transcript safety, and acquisition regression passed (40 focused tests). (src/landos/max-dock-ui.test.ts); browser_journey: Real-browser navigation confirmed Max on Mission Control, Acquisitions, and the full Max conversation page. (.runtime/landos/qa/qa-2026-07-17T18-09-58-347Z/report.md)
- [x] R2-03: Max replies and progress are visible globally through the existing chat stream and survive route changes. — evidence: [E:E11][E:E12][E:E14] test_result: Max UI, navigation naming, owner-only egress, transcript safety, and acquisition regression passed (40 focused tests). (src/landos/max-dock-ui.test.ts); api_evidence: Route and operator-runner integration regression passed (93 tests), preserving existing chat and safety APIs. (src/landos/routes.test.ts); browser_journey: Real-browser navigation confirmed Max on Mission Control, Acquisitions, and the full Max conversation page. (.runtime/landos/qa/qa-2026-07-17T18-09-58-347Z/report.md)
- [x] R2-04: Operator-facing chief-of-staff labels use Max while compatibility identifiers may remain internal. — evidence: [E:E11][E:E14] test_result: Max UI, navigation naming, owner-only egress, transcript safety, and acquisition regression passed (40 focused tests). (src/landos/max-dock-ui.test.ts); browser_journey: Real-browser navigation confirmed Max on Mission Control, Acquisitions, and the full Max conversation page. (.runtime/landos/qa/qa-2026-07-17T18-09-58-347Z/report.md)
- [x] R2-05: Owner-only outbound, no paid action, and no offer or contract sending rules remain enforced. — evidence: [E:E11][E:E12][E:E18] test_result: Max UI, navigation naming, owner-only egress, transcript safety, and acquisition regression passed (40 focused tests). (src/landos/max-dock-ui.test.ts); api_evidence: Route and operator-runner integration regression passed (93 tests), preserving existing chat and safety APIs. (src/landos/routes.test.ts); final_regression: Complete repository Vitest regression exited successfully after both workstreams; focused acquisition, Max, safety, and route suites were included. (package.json)
