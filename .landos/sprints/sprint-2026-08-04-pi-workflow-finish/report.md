# Sprint Report: Finish the operator-facing V2 Property Intelligence workflow (Deal 81)

- Sprint: `sprint-2026-08-04-pi-workflow-finish`
- Created: 2026-08-04T06:09:01.846Z
- Sprint status: active
- Final combined regression: pass at 2026-08-04T15:59:04.298Z [E:E44]
- Independent final review: not run

Every status below is derived from ledger evidence, not builder narrative.

## ws1-instant-section-switching: Instant V2 Overview/Property Intelligence section switching [E:E5]

- Classification: **Independently verified** [E:E5]
- Status: final_regression_pending
- Operator outcome: Switching between V2 Overview and Property Intelligence for deal 81 feels immediate; the property record is loaded once and reused across sections; no research reruns, no stale data, no long loading animation; URL navigation and browser history keep working.
- Depends on: none
- Browser QA: pass at 2026-08-04T06:36:03.290Z (.landos/sprints/sprint-2026-08-04-pi-workflow-finish/qa-report-ws1-instant-section-switching.md) [E:E5]
- Findings: 0 total, 0 unresolved
- Repairs: 0

### Requirements

- [x] ws1-r1: Overview <-> Property Intelligence switching is perceptually immediate in the live localhost workflow. — evidence: [E:E2][E:E5] browser_journey: Builder + independent QA drove 15+ switches at http://localhost:3141/dept/acquisitions/v2?deal=81: instant client-side switches, URL toggles, back/forward OK (http://localhost:3141/dept/acquisitions/v2?deal=81); independent_browser_qa: landos-browser-qa independent PASS: zero record refetches across 13 switches, GET-only, history correct, refresh fresh, console clean (.landos/sprints/sprint-2026-08-04-pi-workflow-finish/qa-report-ws1-instant-section-switching.md)
- [x] ws1-r2: The full property record is not unnecessarily refetched or rebuilt on every section change. — evidence: [E:E1][E:E5] test_result: vitest focused: workspace-v2-nav (4) + workspace-v2-section-switching contract (6) pass; integration: deal-card-tabs, property-intelligence.routes, deal-operator-analysis.contract, property-market-context 44/44 pass; independent_browser_qa: landos-browser-qa independent PASS: zero record refetches across 13 switches, GET-only, history correct, refresh fresh, console clean (.landos/sprints/sprint-2026-08-04-pi-workflow-finish/qa-report-ws1-instant-section-switching.md)
- [x] ws1-r3: Tab switching never reruns research. — evidence: [E:E1][E:E5] test_result: vitest focused: workspace-v2-nav (4) + workspace-v2-section-switching contract (6) pass; integration: deal-card-tabs, property-intelligence.routes, deal-operator-analysis.contract, property-market-context 44/44 pass; independent_browser_qa: landos-browser-qa independent PASS: zero record refetches across 13 switches, GET-only, history correct, refresh fresh, console clean (.landos/sprints/sprint-2026-08-04-pi-workflow-finish/qa-report-ws1-instant-section-switching.md)
- [x] ws1-r4: Canonical-read freshness is preserved; no stale data is introduced. — evidence: [E:E4][E:E5] refresh_persistence: Hard refresh on both section URLs re-reads canonical data once and renders correct section content (store/browser-shots/qa-ws1/ws1-overview-top-after-refresh.jpg); independent_browser_qa: landos-browser-qa independent PASS: zero record refetches across 13 switches, GET-only, history correct, refresh fresh, console clean (.landos/sprints/sprint-2026-08-04-pi-workflow-finish/qa-report-ws1-instant-section-switching.md)
- [x] ws1-r5: URL navigation and browser history keep working for both sections. — evidence: [E:E2][E:E5] browser_journey: Builder + independent QA drove 15+ switches at http://localhost:3141/dept/acquisitions/v2?deal=81: instant client-side switches, URL toggles, back/forward OK (http://localhost:3141/dept/acquisitions/v2?deal=81); independent_browser_qa: landos-browser-qa independent PASS: zero record refetches across 13 switches, GET-only, history correct, refresh fresh, console clean (.landos/sprints/sprint-2026-08-04-pi-workflow-finish/qa-report-ws1-instant-section-switching.md)

## ws2-sidebar-facts: Missing LandPortal sidebar facts captured and projected [E:E6][E:E7][E:E8][E:E9]

- Classification: **Independently verified** [E:E6][E:E7][E:E8][E:E9]
- Status: final_regression_pending
- Operator outcome: Water Feature Type (River), Zoning Code (exactly '01 - NOT Z'), the full FEMA flood-zone description, Last Sale Price 16500, Last Sale Date 10-07-2005, Book 1234, Page 75, and Assessed Value $56,700.00 are captured from LandPortal whenever displayed, persisted through the canonical property-fact path with LandPortal as discovery-stage source, and visible in the correct V2 Property Intelligence sections for deal 81.
- Depends on: ws1-instant-section-switching [E:E5]
- Browser QA: pass at 2026-08-04T07:10:35.247Z (.landos/sprints/sprint-2026-08-04-pi-workflow-finish/qa-report-ws2-sidebar-facts.md) [E:E6][E:E7][E:E8][E:E9]
- Findings: 0 total, 0 unresolved
- Repairs: 0

### Requirements

- [x] ws2-r1: All eight listed sidebar values are captured whenever LandPortal displays them, with exact labels and displayed values preserved. — evidence: [E:E10][E:E11][E:E13] test_result: vitest sidebar-facts 9 of 9 plus integration suites 53 of 53 pass; api_evidence: Deal 81 canonical read returns the eight sidebar facts verbatim; browser_journey: Builder and independent QA walked the live PI section: all eight values in correct sections, zoning verbatim with discovery-stage labeling, FEMA description complete
- [x] ws2-r2: Zoning code is stored exactly as '01 - NOT Z' and displayed as LandPortal discovery-stage data. — evidence: [E:E10][E:E13] test_result: vitest sidebar-facts 9 of 9 plus integration suites 53 of 53 pass; browser_journey: Builder and independent QA walked the live PI section: all eight values in correct sections, zoning verbatim with discovery-stage labeling, FEMA description complete
- [x] ws2-r3: The complete FEMA description is preserved and shown in the environmental/FEMA section. — evidence: [E:E10][E:E13] test_result: vitest sidebar-facts 9 of 9 plus integration suites 53 of 53 pass; browser_journey: Builder and independent QA walked the live PI section: all eight values in correct sections, zoning verbatim with discovery-stage labeling, FEMA description complete
- [x] ws2-r4: Sale info appears in the sale-and-deed-history section and assessed value in the value-and-assessment section; money/date normalization also preserves displayed source values. — evidence: [E:E10][E:E13] test_result: vitest sidebar-facts 9 of 9 plus integration suites 53 of 53 pass; browser_journey: Builder and independent QA walked the live PI section: all eight values in correct sections, zoning verbatim with discovery-stage labeling, FEMA description complete
- [x] ws2-r5: Facts persist through the existing canonical property-fact path with LandPortal as discovery-stage source; no new store or table; stronger official records are never overwritten. — evidence: [E:E10][E:E11][E:E12] test_result: vitest sidebar-facts 9 of 9 plus integration suites 53 of 53 pass; api_evidence: Deal 81 canonical read returns the eight sidebar facts verbatim; restart_persistence: Facts imported before the managed restart and rendered identically after restart with health 200, served from the durable canonical research record

## ws3-evidence-viewer: Same-page evidence viewer with zoom and pan [E:E18][E:E19][E:E20][E:E21][E:E22]

- Classification: **Independently verified** [E:E18][E:E19][E:E20][E:E21][E:E22]
- Status: final_regression_pending
- Operator outcome: Clicking any Property Intelligence evidence image opens a large same-page lightbox filling most of the viewport with correct aspect ratio, the largest useful image, zoom in/out/reset, drag panning, wheel zoom, previous/next navigation, category/caption/source labels, an obvious close control, and Escape close, without leaving the workspace or opening a new tab.
- Depends on: ws1-instant-section-switching [E:E5]
- Browser QA: pass at 2026-08-04T07:44:48.489Z (.landos/sprints/sprint-2026-08-04-pi-workflow-finish/qa-report-ws3-evidence-viewer.md) [E:E18][E:E19][E:E20][E:E21][E:E22]
- Findings: 0 total, 0 unresolved
- Repairs: 0

### Requirements

- [x] ws3-r1: Evidence images open in a large same-page viewer occupying most of the viewport, preserving aspect ratio, showing the largest useful retained image. — evidence: [E:E18][E:E24] screenshot: Viewer at fit after refresh with metadata bar and controls (store/browser-shots/qa-ws3/viewer-open-fit.jpg); browser_journey: Builder and independent QA drove the live viewer: same-page open, zoom pan reset, prev next wrap, metadata, close and Escape, no navigation or new tab
- [x] ws3-r2: Zoom in, zoom out, reset-to-fit, drag panning while zoomed, and wheel zoom work. — evidence: [E:E19][E:E24] screenshot: Viewer zoomed in two steps via toolbar zoom control (store/browser-shots/qa-ws3/viewer-zoomed-in.jpg); browser_journey: Builder and independent QA drove the live viewer: same-page open, zoom pan reset, prev next wrap, metadata, close and Escape, no navigation or new tab
- [x] ws3-r3: Previous/next navigation works and shows image category, caption, and source when available. — evidence: [E:E20][E:E24] screenshot: First open showing toolbar close control metadata bar and 1 of 10 position (store/browser-shots/qa-ws3/viewer-metadata-controls.jpg); browser_journey: Builder and independent QA drove the live viewer: same-page open, zoom pan reset, prev next wrap, metadata, close and Escape, no navigation or new tab
- [x] ws3-r4: The viewer closes via an obvious control and Escape, never navigates away or opens a new tab, and keeps keyboard/focus behavior usable. — evidence: [E:E22][E:E24] independent_browser_qa: Independent live Chrome QA of same-page viewer zoom pan navigation metadata close and escape with no URL change and no new tab (.landos/sprints/sprint-2026-08-04-pi-workflow-finish/qa-report-ws3-evidence-viewer.md); browser_journey: Builder and independent QA drove the live viewer: same-page open, zoom pan reset, prev next wrap, metadata, close and Escape, no navigation or new tab
- [x] ws3-r5: No new image library dependency is added unless the existing frontend cannot reasonably support the interaction. — evidence: [E:E22][E:E23] independent_browser_qa: Independent live Chrome QA of same-page viewer zoom pan navigation metadata close and escape with no URL change and no new tab (.landos/sprints/sprint-2026-08-04-pi-workflow-finish/qa-report-ws3-evidence-viewer.md); test_result: vitest workspace-v2-evidence-viewer 8 of 8 pass after keydown-ref and scroll-lock hardening

## ws4-landportal-capture-workflows: LandPortal capture workflows: G Maps rule, default 3D, soil, buildability, Street View [E:E25][E:E26][E:E27][E:E28][E:E29][E:E30][E:E31]

- Classification: **Independently verified** [E:E25][E:E26][E:E27][E:E28][E:E29][E:E30][E:E31]
- Status: final_regression_pending
- Operator outcome: The SOP and live Hermes LandPortal skill require selecting and visually confirming G Maps before applicable map/overlay/Street View work; deal 81 gains a clean default LandPortal 3D capture, a soil capture showing rendered colored soil polygons with structured soil facts, a dedicated yellow buildability capture with structured percentage/acreage when displayed, and Street View captures plus structured observations including a grounded conclusion about the diagonal linear corridor.
- Depends on: ws2-sidebar-facts [E:E6][E:E7][E:E8][E:E9]
- Browser QA: pass at 2026-08-04T15:17:33.199Z (.landos/sprints/sprint-2026-08-04-pi-workflow-finish/qa-report-ws4-landportal-capture-workflows.md) [E:E25][E:E26][E:E27][E:E28][E:E29][E:E30][E:E31]
- Findings: 0 total, 0 unresolved
- Repairs: 0

### Requirements

- [x] ws4-r1: SOP and live Hermes LandPortal skill both require selecting and visually confirming G Maps before applicable map, overlay, and Street View workflows, without confusing the comparable Show on Map page. — evidence: [E:E32][E:E33] test_result: vitest capture-workflows 14 of 14 plus integration suites 72 of 72 pass; browser_journey: Builder personally verified every capture image and the live gallery; independent QA drove the viewer through all 17 items and the observations panel
- [x] ws4-r2: A clean default-framing LandPortal 3D capture is persisted as the primary 3D evidence for deal 81. — evidence: [E:E33][E:E32] browser_journey: Builder personally verified every capture image and the live gallery; independent QA drove the viewer through all 17 items and the observations panel; test_result: vitest capture-workflows 14 of 14 plus integration suites 72 of 72 pass
- [x] ws4-r3: The soil capture shows rendered colored soil polygons with the subject boundary, and distinct soil units with their structured fields are captured and deduplicated. — evidence: [E:E33][E:E32] browser_journey: Builder personally verified every capture image and the live gallery; independent QA drove the viewer through all 17 items and the observations panel; test_result: vitest capture-workflows 14 of 14 plus integration suites 72 of 72 pass
- [x] ws4-r4: A dedicated yellow buildability capture with category 'Buildability' and structured percentage/acreage (when displayed) is persisted and surfaced in the PI gallery. — evidence: [E:E33][E:E32] browser_journey: Builder personally verified every capture image and the live gallery; independent QA drove the viewer through all 17 items and the observations panel; test_result: vitest capture-workflows 14 of 14 plus integration suites 72 of 72 pass
- [x] ws4-r5: Street View is captured and analyzed with structured observations distinguishing observation, interpretation, and unconfirmed conclusion, or its unavailability is recorded; the diagonal corridor is described only per the strongest evidence. — evidence: [E:E33][E:E34] browser_journey: Builder personally verified every capture image and the live gallery; independent QA drove the viewer through all 17 items and the observations panel; restart_persistence: Captures imported before the managed restart to PID 101524 and rendered identically after it; refresh persistence re-verified by independent QA

## ws5-visual-buyer-analysis: Multi-view Visual Buyer Analysis, Overview summary, and PI placement [E:E35][E:E36][E:E37][E:E38][E:E39][E:E40]

- Classification: **Independently verified** [E:E35][E:E36][E:E37][E:E38][E:E39][E:E40]
- Status: final_regression_pending
- Operator outcome: Deal 81 shows one structured multi-view Visual Buyer Analysis (sections A-E) grounded in the combined accepted visual evidence in Property Intelligence, and a concise grounded Visual Buyer Summary on Overview with a control opening the full analysis; no fabricated facts, no legal conclusions, no superseded interpretation left visible.
- Depends on: ws4-landportal-capture-workflows [E:E25][E:E26][E:E27][E:E28][E:E29][E:E30][E:E31]
- Browser QA: pass at 2026-08-04T15:49:08.087Z (.landos/sprints/sprint-2026-08-04-pi-workflow-finish/qa-report-ws5-visual-buyer-analysis.md) [E:E35][E:E36][E:E37][E:E38][E:E39][E:E40]
- Findings: 0 total, 0 unresolved
- Repairs: 0

### Requirements

- [x] ws5-r1: One structured Visual Buyer Analysis with sections A-E, grounded in the combined multi-view evidence, is visible in V2 Property Intelligence. — evidence: [E:E41][E:E42] test_result: vitest visual-buyer-analysis 11 of 11 plus integration suites 74 of 74 pass; browser_journey: Builder and independent QA drove both live sections: summary rows, instant expand control, sections A through E with the superseded corridor reconciliation, numbers cross-checked against page facts
- [x] ws5-r2: A concise grounded Visual Buyer Summary appears on V2 Overview with a control opening the full analysis. — evidence: [E:E42] browser_journey: Builder and independent QA drove both live sections: summary rows, instant expand control, sections A through E with the superseded corridor reconciliation, numbers cross-checked against page facts
- [x] ws5-r3: Conflicting visual evidence is reconciled; stronger evidence supersedes and no superseded interpretation remains visible. — evidence: [E:E41][E:E42] test_result: vitest visual-buyer-analysis 11 of 11 plus integration suites 74 of 74 pass; browser_journey: Builder and independent QA drove both live sections: summary rows, instant expand control, sections A through E with the superseded corridor reconciliation, numbers cross-checked against page facts
- [x] ws5-r4: No fabricated facts, legal conclusions, or guaranteed buildability/legal-access/septic/boundary/wetlands claims appear. — evidence: [E:E41][E:E42] test_result: vitest visual-buyer-analysis 11 of 11 plus integration suites 74 of 74 pass; browser_journey: Builder and independent QA drove both live sections: summary rows, instant expand control, sections A through E with the superseded corridor reconciliation, numbers cross-checked against page facts
- [x] ws5-r5: Existing page structure and visual system are preserved; compact comparable summary retained; no full comparable cards duplicated in PI. — evidence: [E:E42] browser_journey: Builder and independent QA drove both live sections: summary rows, instant expand control, sections A through E with the superseded corridor reconciliation, numbers cross-checked against page facts
