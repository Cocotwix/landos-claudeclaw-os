# Independent Browser QA Report — ws2-sidebar-facts

Verdict: PASS
QA agent: independent LandOS browser-QA (Claude)
Date: 2026-08-04
Live URL: http://localhost:3141/dept/acquisitions/v2?deal=81&section=property-intelligence
Runtime: managed LandOS RUNNING healthy, PID 123108, single verified server (npm run landos:status)
Automated journey layer: no journey exists for this workstream in the operator-qa registry
(`npm run landos:operator-qa -- --list` has no sidebar-facts journey); the full manual browser
journey below was executed instead.

## Checks

1. Water Feature Type — PASS. Environmental & Soils shows "Water feature: River — LandPortal sidebar".
2. Zoning Code — PASS. Zoning & Land Use panel carries a "LANDPORTAL · DISCOVERY STAGE" chip;
   "Zoning code: 01 - NOT Z" (exact); "Official zoning: Not confirmed — official record pending";
   caption "Displayed LandPortal sidebar value, stored verbatim. Discovery-stage data only; it is
   not an official zoning determination." Property Score still applies "-2 zoning (unknown)" and
   Missing Diligence still lists Zoning, so the sidebar value is not treated as official.
3. FEMA description — PASS, complete word-for-word: "Area of minimal flood hazard, usually
   depicted on FIRMs as above the 500-year flood level. BFEs are not determined." (verified in UI
   text extraction, zoom screenshot, API value, and DB record).
4. Sale & Deed History — PASS. "Last sale price: $16,500 · displayed "16500""; "Last sale date:
   10-07-2005"; "Book number: 1234"; "Page number: 75"; note that the recorded deed remains the
   stronger source. Displayed source value preserved alongside normalization.
5. Value & Assessment — PASS. "Assessed value: $56,700.00" with note that county assessment rolls
   remain the stronger official source.
6. API cross-check — PASS. GET /api/landos/deal-cards/81/property-intelligence (token taken from
   .env privately, never printed) returns all eight lp_sidebar_* facts with exact values, source
   "LandPortal authenticated parcel sidebar — discovery stage", grade likely_indication, verified
   subject sourceUrl, retrievedAt 2026-08-04T06:47:05Z.
7. No new store/endpoint — PASS. Page network traffic uses only existing endpoints
   (deal-cards/81, /property-intelligence, /acquisition, /activity, /browseruse,
   inspection/image cardId=71). lp_sidebar facts are projected inside the existing
   property-intelligence snapshot handler (src/landos/routes.ts ~7611-7643). sqlite_master has no
   sidebar-named table.
8. DB persistence — PASS. store/landos.db landos_property_research_record (property_card_id 71,
   deal_card_id 81, updated 2026-08-04T06:48:22Z) record_json.facts holds water_feature_type
   "River", zoning_code "01 - NOT Z", fema_flood_zone_description (full), last_sale_price "16500",
   last_sale_date "10-07-2005", book_number "1234", page_number "75", assessed_value "$56,700.00",
   provider hermes_landportal_import, plus matching evidence rows. Read-only queries only.
9. No cross-property data — PASS. All gallery images request cardId=71; subject summary shows
   APN 055689 10.00-1-64.22 / LandPortal 89525293.
10. Existing content intact — PASS. Scores strip (74 Strong / 57 Moderate / Seller Pending),
    subject summary, 10-item evidence gallery, market context labeled
    "LANDOS MARKET RESEARCH — NOT LANDPORTAL", comparable research, missing diligence all render.
11. Missing diligence — PASS. "Water features" no longer listed; the UI only adds it when
    lp_sidebar_water_feature_type is absent (AcquisitionWorkspaceV2 gap logic).
12. Refresh persistence — PASS. Ctrl+Shift+R (cache-bypassing hard reload) re-fetched the API and
    every value re-rendered identically.
13. Restart persistence — verified by canonical-read evidence per QA instruction (server not
    restarted by QA): values originate from the persisted research record served by the API on
    every load, not client state; the same record is durable in store/landos.db.

## Evidence screenshots

- store/browser-shots/qa-ws2/qa-ws2-pi-overview-top.jpg (PI top: scores strip, header)
- store/browser-shots/qa-ws2/qa-ws2-environmental-water-fema.jpg (Environmental & Soils + zoning/sale panels)
- store/browser-shots/qa-ws2/qa-ws2-environmental-fema-zoom.png (zoom: water feature + full FEMA description)
- store/browser-shots/qa-ws2/qa-ws2-zoning-sale-value-panels.jpg (Zoning / Sale & Deed / Value & Assessment with discovery-stage chips)

## Notes

- Two transient CDP screenshot timeouts occurred during capture (renderer busy); page content and
  subsequent captures were normal. Not an application defect.
- No internally fixable issues remain for this workstream's requirements.
