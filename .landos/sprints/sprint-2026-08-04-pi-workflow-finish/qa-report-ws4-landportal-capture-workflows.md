# Independent Browser QA — ws4-landportal-capture-workflows

- Sprint: sprint-2026-08-04-pi-workflow-finish
- Verdict: PASS
- QA agent: independent browser QA (Claude)
- Date: 2026-08-04
- Live URL: http://localhost:3141/dept/acquisitions/v2?deal=81&section=property-intelligence
- Runtime: single verified healthy managed server (PID 46048, HTTP 200) via npm run landos:status

## Method

Fresh browser tab (not the operator LandPortal Chrome on CDP 9224). Full page walkthrough,
evidence viewer stepped item by item, network requests inspected, API endpoint behavior read
from src/landos/routes.ts (inspection/image handler), DB read-only queries against
store/landos.db (landos_card_activity property_inspection rows for card 71), docs greps,
and a full refresh persistence pass. No server restart (per brief instruction). No data
was created, modified, or deleted.

## Checks

1. DEFAULT 3D VIEW — PASS. Gallery item 4/17 "Default 3D view" opens in the evidence
   viewer as a genuine oblique 3D perspective (terrain foreshortening, receding roads,
   tree side profiles, LandPortal 3D control active) with the complete red subject
   boundary. Not a 2D aerial or contour substitute; clearly distinct from the top-down
   Close Parcel Aerial. Evidence: store/browser-shots/qa-ws4/viewer-default-3d.jpg.

2. SOIL TYPE OVERLAY — PASS. Item 15/17 shows rendered colored soil polygons (distinct
   olive/green units with polygon borders) across and inside the red subject boundary,
   with unit labels WmC, WmB, Sn, AnC all visible at zoom. Not base imagery alone.
   Evidence: store/browser-shots/qa-ws4/viewer-soil-overlay.jpg and
   viewer-soil-overlay-zoom-labels.png. Structured soil units (Williamson silt loam
   6-12% / 2-6%, Ira gravelly loam 3-8% with drainage, farmland class, capability class)
   render in ENVIRONMENTAL & SOILS.

3. BUILDABILITY — PASS. Dedicated item 12/17, category OVERLAY, label "Buildability",
   yellow-toned buildable-area overlay across the parcel with the full red boundary
   visible (not slope/contour/aerial/3D). Structured data shown: Buildability 76.24%
   (~8.7 of 11.46 ac) plus "Dedicated yellow-overlay capture retained".
   Evidence: store/browser-shots/qa-ws4/viewer-buildability.jpg.

4. FIVE STREET VIEWS — PASS. Items 7-11: subject frontage, along road (northeast),
   along road (southwest), across the road, corridor crossing. Each verified in the
   viewer as an actual road-level Google Street View scene (June 2023 imagery, pegman
   scenes, red parcel line overlay where in frame); none is an aerial. Corridor-crossing
   scene matches the recorded observations (two weathered posts with POSTED-style signs,
   cleared gravel/grass strip, no rails). Evidence:
   store/browser-shots/qa-ws4/viewer-street-view-frontage.jpg.

5. STREET VIEW OBSERVATIONS PANEL — PASS. 13 structured observations, every one labeled
   with basis: direct observation / reasonable interpretation / unconfirmed. Corridor
   character: "consistent with a former railroad grade now serving as a cleared corridor,
   not an active railroad" — labeled reasonable interpretation. Corridor use and rights:
   explicitly UNCONFIRMED ("not established by Street View... Ownership and rights
   require records research"). The panel nowhere asserts an active railroad or public
   trail as fact. Evidence: store/browser-shots/qa-ws4/street-view-observations-panel.jpg.

6. NO CROSS-PROPERTY EVIDENCE — PASS. All 18 gallery image requests observed in the
   network log hit /api/landos/inspection/image?cardId=71&key=... (200). DB: all 17
   assets in landos_card_activity property_inspection rows for card 71 store files named
   store/visuals/landportal_71_<key>_<hash>.png with validation bound to cardId 71. The
   route handler additionally 404s any asset whose validation does not bind to the card.
   APN 055689 10.00-1-64.22 shown in header and subject summary throughout.

7. DOCS CONSISTENT — PASS (read-only greps). Both docs/landos/property-intelligence-sop.md
   and config/hermes/landos-profile/skills/landos-landportal/SKILL.md contain: G Maps
   select-and-visually-confirm rule (SOP 194-202 / SKILL 107-109), default 3D rule
   (SOP 216-217 / SKILL 114-115), soil polygon-render rule (SOP 226-234 / SKILL 123-134),
   Show Buildability workflow (SOP 240 / SKILL 141), Street View pegman-on-road rule
   (SOP 253 / SKILL 154-158), misclick recovery rule (SOP 182-190 / SKILL 91-102). The
   Show on Map comparable-page distinction is intact in both (SOP 197, 352, 528 /
   SKILL 110, 191-192).

8. REFRESH PERSISTENCE — PASS. Full reload of the URL re-rendered the identical section:
   all 17 gallery items, observations panel, structured soil and buildability data. No
   server restart performed (per brief).

9. SCREENSHOTS — captured under store/browser-shots/qa-ws4/: gallery-grid-top.jpg,
   gallery-grid-overlays.jpg, viewer-default-3d.jpg, viewer-soil-overlay.jpg,
   viewer-soil-overlay-zoom-labels.png, viewer-buildability.jpg,
   viewer-street-view-frontage.jpg, street-view-observations-panel.jpg.

## Non-blocking observations

- Property Score ledger says "15 accepted captures" while the gallery lists 17 items.
  The score line scopes itself to "parcel boundary and site imagery", which plausibly
  excludes the comps map and one non-site street scene; could not be proven wrong, but
  worth a builder sanity check on the counting basis.
- Gallery thumbnails load sequentially and can sit as dark placeholders for several
  seconds after scroll; all 17 loaded within ~10 s and all requests returned 200.
- The automated journey layer has no ws4-specific journey; baseline
  journey:dashboard-shell-health preflight passed fully, but its headless real_browser
  step timed out (Navigation timeout 45000 ms) while the same URL renders in ~2 s in a
  real browser and its own api_reconcile and screenshot steps passed. Harness timing
  issue, not an app defect (report: .runtime/landos/qa/qa-2026-08-04T15-04-41-255Z/).
- Street View corridor-crossing panorama bubble reads "1501 Onionville Rd" (nearest
  Street View address along the road, east of the subject tip); the capture itself is
  the corridor crossing described in the observations, not another property's evidence.

## Prohibited outcomes check

None occurred: 3D not substituted; soil polygons visibly rendered; buildability present
and dedicated; Street View not skipped; corridor never asserted as railroad/trail fact;
no wrong-property evidence; SOP and skill updated consistently with Show on Map rule intact.
