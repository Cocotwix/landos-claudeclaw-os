# Independent Browser QA — ws3-evidence-viewer (Same-page evidence viewer)

- Sprint: sprint-2026-08-04-pi-workflow-finish
- Live URL: http://localhost:3141/dept/acquisitions/v2?deal=81&section=property-intelligence
- QA agent: independent browser QA (Chrome MCP, tab 494893567, desktop 1512x795)
- Runtime: verified single healthy managed server (PID 55708, port 3141, HTTP 200)
- Date: 2026-08-04

## Verdict: PASS

All five requirements verified against the live dashboard. No internally fixable
operator-facing defect found. Two hardening observations recorded below (neither
reproducible at human input speed or affecting the operator outcome).

## Checks performed (live browser, real clicks)

1. ws3-r1 Same-page viewer, aspect, size — PASS
   - Clicked Close parcel aerial, Wetlands overlay, and the Comparables map
     panel image (Show on Map). Each opened a role=dialog lightbox in the same
     page. URL never changed; tab count never changed (no new tab); the full
     workspace remained mounted behind the modal (verified via page text while
     the dialog was open).
   - Fit view renders the full-size retained image at natural aspect
     (920x890 natural -> 741x712 displayed, ratio 1.034 vs 1.041), occupying
     ~90% of viewport height. Evidence: viewer-open-fit.jpg.
2. ws3-r2 Zoom / reset / pan / wheel — PASS
   - Toolbar zoom-in enlarged the image stepwise (evidence:
     viewer-zoomed-in.jpg); toolbar zoom-out returned to fit; reset-to-fit
     restored the exact fit view after zoom+pan; keyboard = / - zoom verified.
   - Click-drag while zoomed panned the image (content visibly translated with
     the drag; evidence: viewer-toolbar-zoomed.jpg shows the panned state).
   - Wheel zoom: the MCP scroll action performs scripted document scrolling,
     not trusted wheel events, so it cannot exercise the onWheel handler.
     Verified by code inspection (element-level non-passive wheel listener on
     the stage calling zoomIn/zoomOut with preventDefault,
     AcquisitionWorkspaceV2PropertyIntelligence.tsx lines 533-536/556) plus
     live verification of the identical zoom functions via buttons and keys.
3. ws3-r3 Prev/next + metadata — PASS
   - Toolbar next from 10/10 wrapped to 1/10 (Close parcel aerial); prev
     wrapped back to 10/10 (comparables map). ArrowRight moved Wetlands 6/10 ->
     FEMA flood 7/10; ArrowLeft moved back. Metadata bar updates each time:
     category tag (SCREENSHOT / OVERLAY), caption, source
     ("LandPortal direct action runner" + source link to the verified
     LandPortal subject URL fips 36011 / APN 055689 10.00-1-64.22 / 89525293),
     and position n/10.
4. ws3-r4 Close / Escape / focus — PASS
   - X control closed the dialog; Escape closed it; open-then-immediate-Escape
     (no intervening click) closed it, proving keyboard events land inside the
     dialog on open. After every close the PI section was unchanged and still
     on the same URL. No navigation, no new tab at any point.
5. ws3-r5 No new image library — PASS
   - package.json has no lightbox/zoom/pan/image library; the component imports
     only preact/hooks, lucide-preact icons, and the existing api lib.
6. Refresh persistence — PASS
   - Reloaded the PI URL twice during the session; the viewer opened and
     functioned identically after each reload (evidence: viewer-open-fit.jpg
     captured post-refresh).
7. No console errors — PASS
   - Console tracking active across two page loads and all viewer
     interactions: zero errors or exceptions.
8. Regression spot-checks — PASS
   - Scores strip (Property 74 Strong / Market 57 Moderate / Seller Pending),
     zoning fact panel (01 - NOT Z, official zoning pending), and market
     context labeled "LANDOS MARKET RESEARCH - NOT LANDPORTAL" all render
     unchanged alongside the new viewer.

## Automated journey layer

No journey exists for this workstream; ran dashboard-shell-health as the shell
sanity layer. Preflight fully PASS (fresh production build, single healthy
runtime, live bundle current, APIs 200). The browser step of that run timed
out (Navigation timeout / CDP protocolTimeout) while this QA session was
concurrently driving the same Chrome over CDP; the same pages loaded in 1-3 s
throughout manual QA and the deal-cards API check inside the journey passed,
so the timeout is attributed to CDP contention, not the application.
Report: .runtime/landos/qa/qa-2026-08-04T07-23-33-205Z/report.md

## Hardening observations (not operator-facing, no verdict impact)

1. Rapid-arrow race: two synthetic ArrowLeft keydowns dispatched <5 ms apart
   advanced only one position (the window keydown listener is detached and
   re-attached per index change in a useEffect, so a keypress landing between
   render and effect flush is handled by the stale closure). Human-speed
   presses and key-repeat (>=33 ms apart) navigate correctly; reproduced only
   with sub-human synthetic input. Suggested hardening: drive navigation from
   a ref or functional state update instead of re-registering the listener.
2. Body scroll is not locked while the modal is open; wheel over the metadata
   bar or toolbar (outside the stage) can scroll the page behind the fixed
   overlay. Invisible while the modal is open; at worst the page is at a
   different scroll position after close.

## Environment notes

Intermittent CDP Page.captureScreenshot timeouts left a device-metrics
override on the tab (viewport reported 1008x530), which made some interim
captures look magnified/cropped. Verified by read_page viewport reporting and
by clean captures after reload; the application layout was correct throughout.

## Evidence

- store/browser-shots/qa-ws3/viewer-open-fit.jpg (viewer at fit after refresh, metadata bar + controls visible)
- store/browser-shots/qa-ws3/viewer-zoomed-in.jpg (after two toolbar zoom-in steps)
- store/browser-shots/qa-ws3/viewer-metadata-controls.jpg (first open, toolbar + close + metadata bar + 1/10)
- store/browser-shots/qa-ws3/viewer-toolbar-zoomed.jpg (zoomed + panned state)
