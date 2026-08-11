# Independent Browser QA — ws5-visual-buyer-analysis

- Sprint: sprint-2026-08-04-pi-workflow-finish
- Verdict: PASS
- QA agent: independent browser QA (own tab; LandPortal Chrome on CDP 9224 untouched)
- Runtime: single healthy verified server, PID 114440, http://localhost:3141 (landos:status)
- Date: 2026-08-04

## Method
Live inspection in a real Chrome tab of both V2 sections for Deal 81, network-log
verification of client-side navigation, API cross-check of
/api/landos/deal-cards/81/property-intelligence, and pixel-level verification of the
actual retained soil overlay and Street View captures against the analysis text.
No operator data was modified. Server was not restarted (per task instruction).

## Per-check results

1. Overview Visual Buyer Summary — PASS. Panel "VISUAL BUYER SUMMARY / MULTI-VIEW
   VISUAL ANALYSIS" renders three scannable labeled rows: Physical character, Main
   buyer appeal, Top visual concern. Screenshot: overview-visual-buyer-summary.jpg.
2. Grounded corridor language — PASS. The corridor is never asserted as an active
   railroad or public trail. Concern row reads "unresolved ownership and rights (not
   an active railroad by Street View evidence; public-trail status unconfirmed)".
3. Client-side expand control — PASS. "Open the full Visual Buyer Analysis" switched
   to section=property-intelligence with NO document navigation: the network log after
   the click shows only /api/health, one inspection image, and favicon.svg — no HTML
   document, no bundle refetch.
4. One structured analysis, sections A-E — PASS. Single "VISUAL BUYER ANALYSIS"
   block (badge MULTI-VIEW / 12 EVIDENCE CATEGORIES). A: 11 observed features, each
   with cited views. B: 7 buyer-oriented interpretations. C: 9 unresolved diligence
   items. D: advantages, concerns, best-fit, weaker-fit, preliminary impression,
   would-change-value list. E: supporting views, Superseded line reconciling the
   corridor (aerial railroad hypothesis superseded by the June 2023 Street View
   corridor-crossing scene), remaining uncertainties, overall confidence moderate
   with stated reason.
5. No falsifiable fabricated facts — PASS. Acreage 11.46, frontage 693 ft,
   buildability 76.24% (8.7 of 11.46 ac = 76.24% arithmetic check), wetlands 1.28%
   (0.15 ac), flood 2.39% (0.27 ac), slope 9.86%, water feature River all match the
   page facts and the API payload. Soil codes WmC, WmB, Sn, AnC were independently
   verified as labels on the actual retained soil overlay image (WmC inside the
   parcel; Williamson and Ira units come from the cited sidebar facts). The POSTED
   posts, unpaved corridor strip, absence of rails/crossbucks, overhead utility line,
   vegetated frontage without curb cut, and June 2023 image date were verified
   directly in the retained Street View captures (street_view, street_view_5).
6. No prohibited claims — PASS. Regex scan of the full visualBuyerAnalysis and
   streetView payloads plus read-through: no guaranteed buildability, no confirmed
   legal access, no septic approval, no surveyed-boundary claim, no jurisdictional
   wetlands finding. All such items appear only as unresolved diligence.
7. Page structure preserved — PASS. PI still shows the compact COMPARABLE RESEARCH
   summary (counts + "Full comparable work continues in Comps and Valuation") and
   the comparables map; no full comparable cards duplicated inside PI. Overview
   valuation, seller, decision, strategy blocks unchanged.
8. Refresh persistence — PASS. Both sections reloaded from the server: summary and
   full analysis persisted (payload generatedAt 2026-08-04T15:26:09Z, served on
   every reload). No restart performed (excluded by task instruction).
9. API/frontend parity — PASS. propertyIntelligence.visualBuyerAnalysis
   (observedFeatures, buyerInterpretation, unresolvedDiligence, buyerPerspective,
   evidenceReconciliation, overviewSummary) matches the rendered text verbatim.

## Automated journey layer
No ws5-specific journey exists in the operator-qa registry. The generic
refresh-persistence platform journey was run and FAILED on harness grounds only:
every step, including the first navigation, hit Puppeteer protocol/navigation
timeouts and captured a blank headless screenshot, while preflight HTTP checks
passed and the same URLs rendered correctly in the live real browser and via curl
during the same window. Classified as automation-infrastructure (pattern:
journey harness/CDP timeout), not a ws5 application defect. Report:
.runtime/landos/qa/qa-2026-08-04T15-43-07-614Z/report.md.

## Evidence
- store/browser-shots/qa-ws5/overview-visual-buyer-summary.jpg
- store/browser-shots/qa-ws5/pi-analysis-top-a-c.jpg (analysis header, A, C)
- store/browser-shots/qa-ws5/pi-analysis-b-cde-superseded.jpg (B, C/D/E with the
  bolded Superseded reconciliation line)
- API payload inspected: /api/landos/deal-cards/81/property-intelligence (200,
  251 KB); token read privately, never printed.

## Findings
None internally fixable within ws5 scope. One out-of-scope observation recorded
above (headless journey harness timeouts) for the platform owner.
