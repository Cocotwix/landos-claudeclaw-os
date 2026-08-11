Continue LandOS from the current repository state.

The current clean functional baseline is already committed and pushed:

41c40c1976cf53729f13ace655c6b110bf504ea0

Preserve every existing tracked and untracked change.

Do not reset, revert, clean, discard, overwrite, broadly reformat, commit, or push.

Treat .env as read only.

Do not expose or hardcode passwords, API keys, tokens, cookies, credentials, authentication state, or environment values.

Do not modify anything outside the LandOS repository, the approved authenticated browser profile, and the normal local LandOS runtime.

Do not work on governance, memory or protocol revamps, MCPs, registries, profiles, Max, the War Room, other departments, or future architecture.

Do not redesign the Acquisition Workspace V2.

Keep the current V2 visual system and current Overview and Property Intelligence structure.

This sprint has one purpose:

Finish the current operator-facing Property Intelligence workflow so it is fast, complete, visually inspectable, and capable of producing a grounded buyer-oriented visual analysis.

Use the existing subject:

1487 Onionville Rd, Sterling, NY 13156
APN: 055689 10.00-1-64.22
LandPortal property ID: 89525293

Do not create another lead.

Do not rerun unrelated providers.

Use the existing Hermes v0.20 LandPortal workflow and the existing authoritative SOP:

docs/landos/property-intelligence-sop.md

PART 1: INSTANT V2 SECTION SWITCHING

Current defect:

Switching between Overview and Property Intelligence takes multiple seconds.

Required result:

1. Switching between Overview and Property Intelligence must feel immediate.
2. Do not refetch or rebuild the full property record unnecessarily on every section change.
3. Load the active property data once and reuse it across V2 sections where practical.
4. Prefetch or cache the Property Intelligence data when the Overview loads if that is the narrowest correct solution.
5. Preserve current canonical-read behavior and freshness.
6. Do not introduce stale data.
7. Do not rerun research when the operator changes tabs.
8. Do not hide the delay behind an unnecessary long loading animation.
9. Keep URL navigation and browser history working correctly.
10. Verify repeated switching in the real localhost workflow.

PART 2: MISSING LANDPORTAL SIDEBAR FACTS

The following clearly labeled LandPortal sidebar fields were visible but were not extracted into LandOS:

Water Feature Type:
River

Zoning Code:
01 - NOT Z

FEMA Flood Zone Description:
Area of minimal flood hazard, usually depicted on FIRMs as above the 500-year flood level. BFEs are not determined.

Sale Info:
Last Sale Price: 16500
Last Sale Date: 10-07-2005
Book Number: 1234
Page Number: 75

Value Overview:
Assessed Value: $56,700.00

Update the existing Hermes subject-fact extraction and import path so these fields are captured whenever LandPortal displays them.

Requirements:

1. Preserve the exact LandPortal label and displayed value.
2. Do not reinterpret the zoning code.
3. Store the zoning code exactly as:
   01 - NOT Z
4. Preserve the complete FEMA description.
5. Normalize monetary and date fields only where LandOS already has an established normalized field, while also preserving the displayed source value.
6. Do not overwrite stronger official records if another source later exists.
7. Record LandPortal as the discovery-stage source.
8. Persist through the existing canonical property-fact path.
9. Project the fields into V2 Property Intelligence.
10. Do not create a new property store or sidebar-data table.

Display placement:

Water Feature Type:
Property facts or environmental summary

Zoning Code:
Zoning and land-use section, clearly marked as LandPortal discovery-stage data

FEMA Flood Zone Description:
Environmental and FEMA section

Last Sale Price, Last Sale Date, Book Number, and Page Number:
Sale and deed-history section

Assessed Value:
Value and assessment section

PART 3: SAME-PAGE EVIDENCE VIEWER

Current defect:

Clicking a Property Intelligence screenshot opens it on a separate page or tab.

Replace this with an in-page evidence viewer.

Required behavior:

1. Clicking an evidence image opens a large modal or lightbox on the same page.
2. The viewer should occupy most of the available browser viewport.
3. Preserve the image aspect ratio.
4. Show the largest useful version of the retained image.
5. Support zoom in.
6. Support zoom out.
7. Support reset to fit.
8. Support click-and-drag or pointer panning while zoomed.
9. Support mouse-wheel or trackpad zoom when practical.
10. Support previous-image navigation.
11. Support next-image navigation.
12. Show image category.
13. Show image caption or short description.
14. Show source when available.
15. Close with an obvious close control.
16. Close with Escape.
17. Do not navigate away from the Acquisition Workspace.
18. Do not open a new browser tab.
19. Keep keyboard and focus behavior usable.
20. Do not add a new image library dependency unless the existing frontend cannot reasonably support the interaction.

PART 4: G MAPS BASE-MAP RULE

Update the authoritative SOP and live Hermes LandPortal skill consistently.

When the LandPortal base-map and overlay controls are used:

1. Select G Maps before performing the applicable map, overlay, or Street View workflows.
2. Confirm G Maps is visibly selected.
3. Do not assume it is already selected.
4. Do not confuse the separate comparable Show on Map page with the base-map controls.
5. Preserve the existing rule that Show on Map is a separate comparable page.

PART 5: DEFAULT 3D CAPTURE

For the required LandPortal 3D capture:

1. Click the LandPortal 3D control.
2. Wait for the default 3D view to finish rendering.
3. Use the initial default LandPortal 3D framing as the approved capture.
4. Do not unnecessarily rotate, tilt, zoom, or reposition the camera.
5. Only adjust the view if the default framing fails to show the correct subject parcel meaningfully.
6. Close obstructing controls before capture.
7. Confirm the subject parcel remains visible.
8. Capture the clean default 3D view.
9. Persist it as the primary 3D evidence.
10. Do not substitute a 2D aerial or contour screenshot for the 3D capture.

PART 6: SOIL OVERLAY RENDERING

Current defect:

The soil screenshot was captured before the colored soil polygons fully rendered.

Correct the workflow:

1. Select G Maps when applicable.
2. Enable the Soil Type overlay.
3. Wait for the colored soil polygons to render across the subject parcel.
4. Do not rely only on a short fixed delay.
5. Confirm visible color differentiation exists inside the parcel.
6. Confirm the correct subject parcel remains selected.
7. Close the overlay-selection panel.
8. Click representative areas inside the parcel.
9. Read the soil popup.
10. Repeat until each distinct soil unit is identified.
11. Deduplicate repeated soil units.
12. Capture the structured popup fields.
13. Capture the screenshot only after the colored polygons are visibly present.
14. The clean screenshot must show the colored soil regions and the subject boundary.
15. Do not accept a screenshot that shows only the base imagery without soil colors.
16. Preserve Map Unit Name, Drainage Class, Farmland Classification, Capability Class non-irrigated, and other displayed material fields.

PART 7: BUILDABILITY VIEW

In the LandPortal sidebar, locate the section titled:

Slope Analysis

To the right of that section, click:

Show Buildability

Required workflow:

1. Click Show Buildability.
2. Wait until LandPortal highlights the buildable area on the subject parcel in the yellow-toned overlay.
3. Do not capture immediately.
4. Confirm the yellow buildability overlay has fully rendered.
5. Confirm the correct subject parcel is still selected.
6. Confirm the full parcel boundary is visible.
7. Confirm the highlighted buildable area is clearly visible.
8. Close or collapse the sidebar when needed for a clean capture.
9. Close any obstructing popup, tooltip, menu, or overlay-selection panel.
10. Capture a clean buildability screenshot.
11. Persist the screenshot with the category:
    Buildability
12. Persist the structured buildability percentage and acreage when displayed.
13. Surface the screenshot in the V2 Property Intelligence evidence gallery.
14. Do not substitute slope, contour, aerial, or 3D evidence for the dedicated buildability capture.

PART 8: STREET VIEW WORKFLOW

When Street View is available:

1. Confirm G Maps is selected.
2. Open Street View through the existing LandPortal map workflow.
3. Confirm the Street View scene corresponds to the correct subject frontage or immediate subject context.
4. Confirm the subject property boundary is visible in red when LandPortal provides that overlay.
5. Capture an initial subject-facing view.
6. Rotate through a full visual scan of the surrounding area.
7. Inspect left, right, across the road, and toward the parcel.
8. Use the Street View navigation arrows to move along the subject frontage where practical.
9. Inspect the length of the visible property border rather than stopping at one static view.
10. Capture the most useful frontage and surrounding-context views.
11. Record whether Street View is unavailable rather than silently skipping it.

Hermes must describe visible observations such as:

1. Road surface and apparent condition
2. Road width and shoulder
3. Apparent entrances or driveways
4. Grade from the roadway into the parcel
5. Ditches, culverts, fencing, gates, or barriers
6. Neighboring structures and land uses
7. Vegetation and privacy
8. Utility poles or visible utility context
9. Trails, paths, rail lines, utility corridors, drainage corridors, or other linear features
10. Water features
11. Signs, public-trail markers, or other identifying clues
12. Any visible issue affecting access or buyer appeal

Distinguish:

1. Direct visual observation
2. Reasonable interpretation
3. Unconfirmed conclusion

Do not call a feature a railroad, public trail, private road, utility corridor, or legal access route unless the evidence supports that conclusion.

When Street View helps resolve an earlier satellite interpretation, preserve the stronger reconciled conclusion.

For this property, specifically inspect the diagonal linear feature visible in the aerial imagery and determine whether Street View supports it being a trail or path rather than an active railroad.

Do not force a conclusion when Street View cannot confirm it.

PART 9: MULTI-VIEW VISUAL PROPERTY ANALYSIS

Use Hermes vision capabilities to analyze the property from the combined accepted visual evidence.

Inputs should include, where available:

1. Clean default satellite view
2. Close road-frontage view
3. Full-parcel aerial
4. Wider context
5. Default 3D view
6. Street View captures
7. Wetlands overlay
8. FEMA overlay
9. Soil overlay
10. Contours
11. Buildability view
12. Water-feature context
13. Accepted structured subject facts

Do not base the final conclusion on one aerial image alone.

Reconcile conflicting visual evidence.

Produce one structured Visual Buyer Analysis with these sections:

A. Directly observed property features

Examples:

1. Open areas
2. Wooded areas
3. Road frontage
4. Apparent entrances
5. Water features
6. Structures
7. Trails or linear corridors
8. Terrain
9. Neighboring development
10. Privacy

B. Buyer-oriented interpretation

Examples:

1. Likely buyer appeal
2. Potential homesite appeal
3. Recreational appeal
4. Small-farm or hobby-property fit
5. Privacy
6. Access considerations
7. Apparent usable area
8. Possible constraints

C. Unresolved diligence

Examples:

1. Legal access
2. Surveyed frontage
3. Boundary confirmation
4. Ownership or rights involving trails or corridors
5. Utility availability
6. Septic feasibility
7. Zoning and subdivision rights
8. Structure status
9. Jurisdictional wetlands
10. Official flood determination

D. Potential buyer perspective

Include:

1. Strongest property advantages
2. Most important concerns
3. Best-fit buyer types
4. Weaker-fit buyer types
5. Preliminary investment impression
6. What would materially affect value or strategy

E. Confidence and evidence reconciliation

Include:

1. Which views support the conclusion
2. Which conclusions were changed by Street View or stronger evidence
3. Which conclusions remain uncertain
4. Confidence level for the overall visual analysis

Do not fabricate facts.

Do not make legal conclusions.

Do not state guaranteed buildability, legal access, septic approval, surveyed boundaries, or jurisdictional wetlands findings.

PART 10: OVERVIEW VISUAL SUMMARY

Add a concise Visual Buyer Summary to the V2 Overview.

The Overview version should:

1. Be grounded in the multi-view visual analysis.
2. Be concise enough to scan before a discovery call.
3. Summarize the property’s physical character.
4. State the main buyer appeal.
5. State the most important visual concern or unresolved issue.
6. Avoid long technical prose.
7. Include a control to open or expand the full Visual Buyer Analysis in Property Intelligence.
8. Update when stronger evidence changes the conclusion.
9. Do not continue showing a superseded interpretation.

PART 11: PROPERTY INTELLIGENCE PLACEMENT

In V2 Property Intelligence, visibly add:

1. Water Feature Type
2. Zoning Code
3. FEMA Flood Zone Description
4. Last Sale Price
5. Last Sale Date
6. Book Number
7. Page Number
8. Assessed Value
9. Buildability screenshot
10. Street View screenshots when available
11. Street View observations
12. Full Visual Buyer Analysis
13. Improved soil screenshot
14. Approved default 3D screenshot

Keep the existing page structure and current visual system.

Do not redesign the page.

Do not duplicate all full comparable cards inside Property Intelligence.

Keep the current compact comparable summary and comparable map.

The complete comparable records remain for the future Comps & Valuation tab.

PART 12: OPERATOR VERIFICATION

After implementation:

1. Open the V2 Overview.
2. Switch repeatedly between Overview and Property Intelligence.
3. Confirm switching is perceptually immediate.
4. Confirm no research reruns occur during tab switching.
5. Confirm the new Visual Buyer Summary appears on Overview.
6. Confirm the summary is grounded and does not call the trail a railroad without support.
7. Open Property Intelligence.
8. Confirm all missing sidebar facts are visible.
9. Confirm the evidence viewer opens on the same page.
10. Confirm zoom in, zoom out, reset, pan, previous, next, and close work.
11. Confirm the default 3D view is retained.
12. Confirm the soil screenshot shows colored soil polygons.
13. Confirm the dedicated yellow buildability overlay screenshot is visible.
14. Confirm Street View captures and observations are visible when available.
15. Confirm the full Visual Buyer Analysis is visible.
16. Confirm no other property’s evidence appears.
17. Refresh and reinspect.
18. Run the normal managed restart.
19. Reopen and reinspect both pages.
20. Capture full-page screenshots of Overview and Property Intelligence after restart.
21. Capture one screenshot of the expanded evidence viewer.
22. Capture one screenshot of the soil evidence.
23. Capture one screenshot of the buildability evidence.
24. Capture one screenshot of Street View when available.

VERIFICATION

Run only:

1. Focused tests for V2 section-loading behavior
2. Focused subject-fact extraction and import tests
3. Focused evidence viewer tests
4. Focused 3D, soil, buildability, G Maps, and Street View workflow tests
5. Focused Visual Buyer Analysis tests
6. Typecheck
7. Server build
8. Web build
9. Managed restart
10. Root health
11. API health
12. Real localhost operator inspection
13. Refresh proof
14. Restart proof
15. Targeted diff check
16. Secret scan

Do not perform a broad repository audit.

Do not work on unrelated dirty files.

Do not commit or push.

STOP CONDITION

Stop when:

1. Overview and Property Intelligence switch immediately.
2. All listed LandPortal sidebar facts are captured and visible.
3. Evidence images expand on the same page.
4. The viewer supports zoom and pan.
5. The default LandPortal 3D view is captured.
6. The soil screenshot visibly contains colored soil polygons.
7. G Maps is selected for applicable workflows.
8. The dedicated yellow buildability view is captured and visible.
9. Street View is captured and analyzed when available.
10. The diagonal corridor is described only according to the strongest available evidence.
11. The multi-view Visual Buyer Analysis is visible in Property Intelligence.
12. A concise version appears in Overview.
13. Everything survives refresh and restart.
14. Required screenshots are captured.

FINAL REPORT

Report only:

1. Root cause of the V2 tab-switching delay
2. Tab-switch performance result
3. Missing sidebar facts captured
4. 3D capture result
5. Soil rendering result
6. Buildability capture result
7. Street View availability and navigation completed
8. Street View observations
9. Corridor or trail conclusion and supporting evidence
10. Visual Buyer Analysis summary
11. Files changed
12. Overview screenshot path
13. Property Intelligence screenshot path
14. Expanded evidence-viewer screenshot path
15. Soil screenshot path
16. Buildability screenshot path
17. Street View screenshot paths
18. Refresh proof
19. Restart proof
20. Any remaining concrete blocker

Do not commit or push.
