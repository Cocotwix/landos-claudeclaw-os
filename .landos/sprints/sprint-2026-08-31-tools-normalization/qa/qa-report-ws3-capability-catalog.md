# Independent Browser QA — ws3-capability-catalog — PASS

Sprint: sprint-2026-08-31-tools-normalization
Surface: http://localhost:3141/tools (operator Chrome, own tab)
Runtime: verified single healthy managed server before and after `npm run landos:restart`.
Note: no dedicated operator-qa journey exists for the Tools catalog; closest is dashboard-shell-health. Inspection was performed manually per the brief.

## ws3-r1 — registry-driven catalog (PASS)
- GET /api/landos/capabilities returns 14 entries; 12 with operator.manualInvocation=true
  (Property Resolution, Assessor & Tax, LandPortal Research, LandPortal Property
  Characteristics, LandPortal Visual Capture, LandPortal Comp Search, Comps & Valuation,
  Zoning & Subdivision, Property Development History, County Market Research,
  ZIP Market Research, Market Pulse) and 2 non-manual (Utility Service Screen,
  Acquisition Intelligence). Each entry carries the operator manifest
  (manualInvocation, runsWithoutDeal, writesAuthoritativeEvidence, inputHint, skill, recovery).
- The visible Capability Catalog lists exactly those 12 manual capabilities with
  operator names, descriptions, plain prerequisite sentences ("Needs a resolvable
  property (or an existing Deal).", "Needs a county.", "Needs a ZIP.",
  "Nothing — raw input is enough."), input hints, WRITES EVIDENCE and SKILL badges,
  and recovery lines where present. Non-manual capabilities appear only in the line
  "Runs automatically inside Deal Cards (not manually invocable here): Utility Service
  Screen · Acquisition Intelligence". No invented or hidden capability.
- Network log on load: GET /api/landos/capabilities 200 + GET /api/landos/deal-cards 200;
  no invoke POSTs fired on load. web/src/pages/Tools.tsx renders catalog from that GET
  (setCatalog(response.capabilities)); no duplicate registry found in the frontend.

## ws3-r2 — plain prerequisite messaging + Cases A/B/D (PASS)
- Market Pulse with input "28115": POST market-pulse/invoke 400 rendered as the plain
  red message "A county (with state) or county FIPS is required." No raw HTTP/dev error.
- Empty raw input + no Deal: property tool buttons are inert/disabled; clicking
  Run Assessor & Tax fired no request and nothing crashed. With Deal 113 selected the
  buttons enable (no blanket-disable when a subject is resolvable).
- Case A (Deal 113, LandPortal Research): honest multiple-candidates outcome —
  "LandPortal returned multiple_candidates for this subject; no parcel record was
  retrieved in this run." / "10 LandPortal v2 parcels matched APN 023 003.02. Parcel not
  verified -- specify APN, FIPS, or property ID. No scoring, valuation, or offer." All
  fields "Not established"; retained evidence counted (14 parcel facts); no fabrication.
- Case B (Assessor & Tax, Deal 113): "No record retrieved", every field "Not
  established", attempted official sources listed ("Tennessee Comptroller public parcel
  layer — unavailable; Official public parcel lookup — unavailable"). Deterministic-first,
  reused persisted result, no guessed values.
- Case D (Comps & Valuation, Deal 113): returned-vs-accepted separation shown —
  "72 canonical record(s), 0 pricing this subject, 33 active competitor(s), 42 placed";
  valuation set "0 closed sale(s), 0 direct"; Land/House/Whole Property Value and $/acre
  all "Not established"; Confidence "unavailable"; comps labeled active competition with
  list prices and $/ac; no invented FMV.

## Persistence
- Hard refresh (ctrl+shift+r): catalog re-renders from GET /api/landos/capabilities,
  Deal selection persisted, console clean, no capability invocations fired on load.
  Result panels are transient by design (page states results live in a temporary
  research session); re-running reuses the persisted result server-side.
- Managed restart (npm run landos:restart, new PID 270324, HTTP 200): /tools reopened,
  catalog and the non-manual line render, console clean.

## Adversarial
- Read-only DB counts identical before/after all runs: landos_opportunity 33,
  landos_deal_card 31, landos_property/deal/lead/seller 0, capability_invocation 483,
  capability_evidence 1432. No new deal/property/lead rows created.
- No Tools-specific duplicate registry; catalog request observed in the network log.

## Deferred (out of scope, non-blocking)
- None proven. Observation only: Tools result panels do not re-render after refresh;
  this is the page's declared temporary-research-session behavior, predates ws3, and
  results are recoverable in one click via reused persisted results.

Tabs: opened 1 (tab 494897956), closed 1. A pre-existing /tools tab (494897949) in the
group predated this session and was left untouched.
