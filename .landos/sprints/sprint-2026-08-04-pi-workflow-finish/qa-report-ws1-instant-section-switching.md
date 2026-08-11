# Independent Browser QA — ws1-instant-section-switching

Verdict: PASS (independent landos-browser-qa agent, 2026-08-04, real Chrome on
http://localhost:3141, PID 37108, desktop width).

## What was attempted (adversarial)

15 total section switches, isolated network captures, history navigation, hard
refreshes on both section URLs, API cross-checks, console-error monitoring.

## Results

1. Overview loads real Deal 81 data (1487 Onionville Rd, APN 055689
   10.00-1-64.22, owner STERLING TRAIL TAMERS INC, 11.46 AC). PASS.
2. 13 rail-click switches after clearing the network log: ZERO requests to
   /api/landos/deal-cards/81 or its property-intelligence / acquisition /
   activity / browseruse subresources; zero document/bundle loads. Only
   inspection gallery images (cached after 3 bursts), favicon, periodic
   /api/health polls. PASS.
3. Every post-click screenshot showed the target section fully rendered; no
   blank state, spinner, or loading animation during switches. PASS.
4. All requests GET-only; no POST/PUT/DELETE, no research endpoints. PASS.
5. URL toggles ?section=property-intelligence correctly on all 15 switches;
   back/forward restore sections without reload or record fetches. PASS.
6. Hard refresh on the PI URL fetched each canonical endpoint exactly once and
   rendered the full PI section; same for Overview. Freshness preserved. PASS.
   (True staleness-after-mutation untestable read-only; once-per-load canonical
   fetch is the strongest read-only evidence.)
7. Nothing else broke: scores strip (74/57/Pending) on both sections, Overview
   hero with full red boundary, PI subject summary + soils note + 10-item
   gallery + "LANDOS MARKET RESEARCH — NOT LANDPORTAL" pill + comparable
   research + missing diligence. API cross-check: all probed UI values exist in
   the /property-intelligence and /browseruse payloads. Console: zero errors.

## Screenshots

- store/browser-shots/qa-ws1/ws1-pi-top-after-refresh.jpg
- store/browser-shots/qa-ws1/ws1-pi-evidence-gallery.jpg
- store/browser-shots/qa-ws1/ws1-pi-market-context-label.jpg
- store/browser-shots/qa-ws1/ws1-overview-top-after-refresh.jpg
- store/browser-shots/qa-ws1/ws1-overview-hero.jpg

## Environment observations (not findings)

- CDP screenshot timeouts twice; a browser-side page-zoom shift reflowed the
  tab to ~1000px CSS width — the workspace reflowed gracefully and switching
  behavior stayed correct. Not a LandOS defect.
- The dashboard token never appeared in any log or capture.
