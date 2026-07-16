# Independent Browser QA — ws2-workspace-ui (Acquisitions Lead Workspace UI)

- Sprint: sprint-2026-07-15-lead-workspace-foundation
- QA role: independent landos-browser-qa (not the builder)
- Date: 2026-07-16 (~05:00-06:30Z)
- Live base URL: http://localhost:3141
- Verdict: **FAIL** — 2 blockers, 1 major, 1 minor internally fixable findings
- Browser: real Google Chrome via the approved persistent CDP profile (puppeteer-core,
  same infrastructure as the operator-qa harness).
- Evidence folder: C:/Users/tbutt/claudeclaw-os/.runtime/landos/qa/agent-ws2-20260716T06/
- Runtime: single healthy verified server throughout (PID 159056 at start; PID 183824
  after the restart-persistence step; health 200).

## Honest gaps

- Automated journey layer could not run: preflight "production_build_fresh" fails because
  src/landos/acquisitions-workspace.test.ts (saved 01:03) is newer than dist (01:00). The
  served bundle matches dist (live_frontend_bundle_current passed) and the only newer file
  is test-only, so I proceeded with direct browser QA. A rebuild will clear this.
- The workspace WRONG-PARCEL hard-stop banner (lead-workspace-conflict) and the legacy
  Resolution-view hard stop could NOT be exercised live: the resolution engine never
  recorded identityConflict for either conflict input (that is finding W2-F1, the central
  blocker). The banner code path exists but remains unverified in a real browser.

## Deals used

| Deal | Role |
|---|---|
| 19 | existing verified lead (200 Sid Edens Rd, Pickens SC) — WARNING: mutated by the system during this QA run, see W2-F2 |
| 20 | existing unresolved lead (12345 Sprint Test Rd) |
| 21 | QA fixture, unresolved (created in WS1 QA) |
| 22 | QA fixture, resolved courthouse parcel (created in WS1 QA) |
| 23 | NEW QA fixture created this run for the APN-conflict test ("222 MCDANIEL AVE, PICKENS, SC 29671 APN 4180-07-78-9999") — the record itself demonstrates blocker W2-F1 |

APN-conflict fixture note: the FIRST authorized conflict attempt ("222 MCDANIEL AVE,
PICKENS, SC 29671 APN 5105-00-44-0497") created NO new record — the engine silently
matched existing deal 19 by APN and mutated it (W2-F2). The SECOND attempt (wrong APN
4180-07-78-9999 on the same address) created deal 23 — as a falsely VERIFIED record
instead of a hard stop (W2-F1).

## What was verified working (deal 19 unless noted)

1. Header identity: title, "Verified parcel" chip, APN 5105-00-44-0497, County, State,
   Acreage "1.32 ac (disputed)", Owner, Lifecycle, and the recommended next action —
   all present and matching the payload (ws2-deal19-desktop.png).
2. Blockers & decisions section open by default: 3 blockers + "Decisions only Tyler can
   make" with the acreage-basis decision.
3. Acreage & spatial basis: "DISPUTED" subtitle, amber "Acreage conflict — Tyler decision
   required" panel with decision + explanation, and the basis table with BOTH disputed
   county sources (assessed 1.32 ac Pickens County assessor roll (disputed); gis_geometry
   1.15 ac Pickens County GIS geometry (disputed)) plus valuation/spatial_overlay rows,
   confidence and limitations.
4. Research & evidence status, unified Readiness grid (research/value/strategy/offer/
   contract chips with why + blockers) all render.
5. Market, valuation & comparables: counts line "55 validated sold, 51 validated active
   (unique registry)"; valuation shows NO primary value ("No defensible primary value is
   available.") while pricing is blocked; supporting medians labeled "(screening
   observation, not a confirmed value)"; market matrix with ZIP coverage + staleness.
   Comps table renders normalized $/acre for every rendered row (e.g. $26,079/ac,
   $29,644/ac, $45,946/ac, $13,483/ac) with comparability notes and provider labels
   ("Realtor.com (HomeHarvest) (medium)"). See minor finding W2-F4 on row selection.
6. Strategies: exactly five, NEW canonical names render — Cash Flip; Novation or Double
   Close; Subdivide or Minor Split; Land-Home Package; Improvement Then Flip — each with
   status chip, why, "Blocked by:", and "Required evidence:". "Pricing gate closed — no
   offer or value range may display." amber banner shows while pricingAllowed=false, with
   deduped blockers.
7. Seller & communications (honest empty states), Evidence/documents/visuals with
   "Visual Signal, Not Verified Fact" label + note and working Map / Street View / Earth
   links (Google Maps/Earth URLs), Open work, Activity with relative times ("1d ago").
8. Unresolved leads 20 and 21: honest "Unresolved" chip; APN/County/State/Acreage/Owner
   all "Unavailable"; resolution provenance rendered (confidence 30%, basis text,
   "Still unknown: county, apn, owner, acres, coordinates", "Smallest next identifier:
   owner name"); pricing gate closed; no comps ("No validated comparables…"); no primary
   value; all strategies blocked; the only dollar figure is the area-level market matrix
   ("State match · Price per Acre: $27,008") which is labeled area context, not a property
   value. No fabricated facts.
9. Deal 22: verified fixture renders correctly; acreage no longer disputed in the
   canonical basis (assessed 47.45 vs gis 45.64, disputed=false) and the header honestly
   omits "(disputed)".
10. Library click path: ?section=library → click deal 19 row → Lead Workspace with URL
    ?deal=19; refresh returns to the workspace (ws2-library-after-click.png).
11. Legacy compatibility: /landos?deal=19 still opens the legacy Deal Card;
    deal-card-root absent everywhere in the new flow (all workspace views).
12. Refresh persistence on deals 19/20/21/22/23; restart persistence
    (npm run landos:restart, PID 183824) on deals 19 and 23.
13. Desktop 1440x900 and Galaxy S24 Ultra 412x915: no horizontal page overflow
    (scrollWidth == innerWidth), single-column mobile, primary navigation intact
    (ws2-deal19-mobile-412.png).
14. Scans: zero "undefined"/"NaN"/"[object Object]"/mojibake tokens in the rendered text
    of all inspected deals. API/UI reconciliation on deals 19 and 20: all checked visible
    values match the captured network payloads; no provider payload leakage.

## Findings

### W2-F1 — BLOCKER — Genuine APN conflict produces a falsely VERIFIED record with actionable pricing instead of the WRONG PARCEL hard stop

- Live URL: http://localhost:3141/dept/acquisitions?deal=23
- Repro (exactly what I ran): Acquisitions - New Lead - typed
  "QA FIXTURE APN CONFLICT (independent browser QA, additive test lead, not a real
  seller): 222 MCDANIEL AVE, PICKENS, SC 29671 APN 4180-07-78-9999" - Run Property
  Intelligence. (The address's true APN is 4180-07-78-1710; 4180-07-78-9999 does not
  exist.)
- Expected: identityConflict recorded (requested 4180-07-78-9999 vs resolved
  4180-07-78-1710); "WRONG PARCEL - HARD STOP" banner (lead-workspace-conflict) stating
  both APNs; chip "BLOCKED - WRONG PARCEL"; NOT verified; no property intelligence, Land
  Score, valuation, offer range, actionable strategies or seller brief. The engine's own
  unit test (property-resolution-engine.test.ts line 88) expects exactly this for
  requested-vs-resolved APN mismatch.
- Actual: acquire returned matched:true, parcelVerified:true, confidence 1, created deal
  23. The workspace shows "Verified parcel" with the FABRICATED APN 4180-07-78-9999 in
  the header and identity section, the real courthouse parcel's facts attached (owner
  PICKENS COUNTY OF, 47.45 ac, appraised $569,400), identityConflict null,
  pricingAllowed=true, "$1,396,881 (high confidence)" valuation, and "Cash Flip: viable /
  Novation or Double Close: provisional". Internal contradictions render too: blockers
  say "Valuation not ready: no verified valuation data yet" beside the $1.39M value, and
  the Resolution box says "Verified parcel - No resolution attempt has been recorded for
  this lead." The dishonest record persists across refresh and managed restart.
  The first conflict input (real address + APN of a DIFFERENT existing parcel,
  "222 MCDANIEL AVE ... APN 5105-00-44-0497") also produced no conflict: the engine
  matched the APN to existing deal 19 and reported it verified (see W2-F2) - the
  address/APN contradiction is never checked.
- Evidence: ws2-deal23-fabricated-apn-verified.png, ws2-deal23-valuation-open.png,
  ws2-deal23-conflict-desktop.png/.txt, ws2-deal23-conflict-api.json,
  conflict-fixture-2-intake-typed.png, conflict-fixture-intake-typed.png.
- API/DB: /api/landos/lead-workspace/23 - property.identity.apn "4180-07-78-9999",
  resolutionState "Parcel verified (...SCDOT GIS mirror...)", resolution.identityConflict
  null, strategies.pricingAllowed true; landos_parcel_identity deal 23 state=confirmed
  confidence=1. logs/main.log acquire_run ok matched:true parcelVerified:true.
- Severity: blocker. Suspected subsystem: property resolution engine conflict detection /
  county-GIS lane APN handling (the lane appears to verify using the requested APN
  instead of comparing it with the address-resolved parcel's APN).
- Disposition: internal_fixable. patternKey: apn-conflict-hard-stop-not-triggered.

### W2-F2 — BLOCKER — Conflicting intake silently merged into EXISTING deal 19 and overwrote accepted operator records

- Live URL: http://localhost:3141/dept/acquisitions?deal=19
- Repro: Acquisitions - New Lead - typed "QA FIXTURE APN CONFLICT (...): 222 MCDANIEL
  AVE, PICKENS, SC 29671 APN 5105-00-44-0497" - Run Property Intelligence. (That APN
  belongs to 200 Sid Edens Rd = deal 19; the address is the courthouse.)
- Expected: hard stop (address and APN identify different parcels); at minimum, no
  mutation of the existing deal 19 records without Tyler confirmation.
- Actual: no new record; the engine matched deal 19 by APN, re-ran resolution + browser
  vision against it (log: browser_vision cardId:19 merged 5), reported
  "matched:true parcelVerified:true confidence 1", opened deal 19's workspace - and
  OVERWROTE accepted records: owner "ELROD MELINDA KAY" became truncated
  "ELROD MELINDA K" (ownerRaw too; no ownerWarnings); parcel-identity basis
  "Parcel confirmed by LandPortal Map Search parcel panel (browser read-only)
  (APN 5105-00-44-0497). The second lane did not independently confirm; its status is
  recorded." (confidence 0.9) became "Parcel identity verified by South Carolina
  statewide parcel layer (SCDOT GIS mirror) - Pickens County." (confidence 1.0);
  resolutionState provenance now cites SCDOT instead of the original LandPortal browser
  verification; header County label "Pickens County" became "Pickens". Previously
  accepted operator information changed with no Tyler confirmation and no conflict
  warning. (Original values are recorded here for restoration.)
- Evidence: ws2-deal19-api.json (pre-intake payload: owner "ELROD MELINDA KAY", county
  "Pickens County") vs ws2-deal19-postintake-api.json (owner "ELROD MELINDA K"); DB
  landos_parcel_identity deal 19 updated_at 1784178681 confidence 1 with rewritten basis;
  logs/main.log acquire_lanes / browser_vision / acquire_run entries.
- Severity: blocker. Suspected subsystem: acquire dedupe/merge path (existing-deal match
  by APN re-runs resolution and persists over accepted identity records).
- Disposition: internal_fixable. patternKey: intake-dedupe-overwrites-accepted-identity.

### W2-F3 — MAJOR — Verified lead's Resolution box renders stale snapshot provenance that contradicts the verified chip

- Live URL: http://localhost:3141/dept/acquisitions?deal=19 (pre-existing before the
  intake above; also on deal 23 in a second form)
- Repro: open deal 19 - Identity & resolution - Resolution box.
- Expected: a verified lead's resolution box presents the verification provenance (or
  clearly separates the historical geocode-era snapshot from the current verified state).
- Actual: one box shows chip "Verified parcel" + "confidence 70%" + basis "Parcel not yet
  confirmed - only a geocoded location and/or operator-supplied identifiers support
  it..." + "Credible evidence from 1 source(s) resolves the intended property (confidence
  0.70)." - the stale candidate snapshot rendered under the verified chip; three mutually
  contradictory statements (verified / 70% / not confirmed) in one panel. Deal 23
  variant: "Verified parcel" + "No resolution attempt has been recorded for this lead."
- Evidence: ws2-deal19-resolution-contradiction.png, ws2-deal19-desktop.txt lines 87-93,
  ws2-deal23-fabricated-apn-verified.png.
- Severity: major (LW6 honest distinctions; prohibited false-verified/completeness family).
  Suspected subsystem: lead-workspace read model property.resolution (snapshot
  passthrough without a superseded-by-verification state) + UI Resolution box.
- Disposition: internal_fixable. patternKey: stale-resolution-provenance-contradicts-verified-chip.

### W2-F4 — MINOR — Comps table can never show validated ACTIVE rows and gives no access to the rest of the validated registry

- Live URL: http://localhost:3141/dept/acquisitions?deal=19 (Market, valuation & comparables)
- Repro: open the section; count rows.
- Expected: rendered rows show normalized $/acre (they do), and validated active listings
  are reachable somewhere in the UI (counts line advertises "51 validated active").
- Actual: topComps() concatenates sold-then-active and slices to 8, so with 55 sold no
  active row can ever render; 98 of 106 validated unique registry rows (including the
  spec's example active comp at $186,792/ac, 245 and 301 Railroad St) are present in the
  payload but invisible anywhere in the workspace. Aggregate active context appears only
  as the valuation supporting median line.
- Evidence: ws2-deal19-desktop.txt comps table region (8 sold rows), ws2-deal19-api.json
  (uniqueComps 106, validatedActive 51), web/src/lib/lead-workspace-view.ts topComps().
- Severity: minor. Suspected subsystem: lead-workspace-view topComps row selection.
- Disposition: internal_fixable. patternKey: comps-table-hides-validated-actives.

## Observations (not failed)

- The acreage decision text appears in both "Blockers" and "Decisions only Tyler can
  make" (same wording twice on screen). Semantically it is both; flagging readability.
- Area-level market matrix values render on unresolved leads with "State match" coverage
  labels - labeled honestly, kept.
- The preflight freshness gap (test file newer than dist) should be cleared by a rebuild
  so the automated journey layer can gate the repair.

## Usability judgment

The rebuilt workspace is a genuine operator surface: on deal 19 Tyler can read identity,
the acreage dispute and his required decision, readiness, gated valuation context,
strategy status with required evidence, seller state, visuals and activity without any
raw API reading. The FAIL verdict rests on the resolution-engine conflict blockers
(W2-F1/W2-F2) - which put false-verified records and silent mutations in front of the
operator - plus the stale-provenance contradiction (W2-F3) and the hidden validated
actives (W2-F4).

---

# Recheck 2 — 2026-07-16 (~06:5x-07:2xZ), after WS2 repairs

- Runtime healthy throughout (PID 17948 at start; PID 63752 after the managed restart).
- Same real-browser method (approved persistent Chrome CDP profile).
- Fresh evidence: C:/Users/tbutt/claudeclaw-os/.runtime/landos/qa/agent-ws2-recheck2/
- qa-result deliberately NOT recorded (parent records retests).
- New conflict fixture created this recheck: deal 24.

## Per-finding verdicts

### F5 apn-conflict-hard-stop-not-triggered — FIXED for new intakes (deal 24)

- Fresh authorized fixture: New Lead intake "QA FIXTURE APN CONFLICT RECHECK (...):
  222 MCDANIEL AVE, PICKENS, SC 29671 APN 4180-07-78-8888" returned
  status "apn_conflict", parcelVerified:false, confidence 0.49, identityConflict
  {requested 4180-07-78-8888, resolved 4180-07-78-1710, SCDOT source, resolved context
  names the real parcel}. Deal 24 created as a conflicted research card.
- Workspace: data-testid lead-workspace-conflict present; "WRONG PARCEL — HARD STOP"
  banner names BOTH APNs; resolution chip (testid) reads "BLOCKED - WRONG PARCEL"; APN/
  County/State/Acreage/Owner all "Unavailable" (no fabricated facts); all five strategies
  blocked; pricing gate closed; no valuation (payload primary null); the only dollar
  figure is the labeled ZIP-level market matrix ($21,944/ac area context).
- Legacy /landos?deal=24 Resolution view shows its own hard stop (banner text present).
- Persistence: refresh AND managed restart (npm run landos:restart, PID 63752) both
  return the same conflicted state.
- The address-vs-APN contradiction shape is ALSO detected now (see F6 below): requested
  APN vs address-resolved APN yields identityConflict with the explanation
  'your address "222 MCDANIEL AVE" is ..., while APN 5105-00-44-0497 is 200 SID EDENS RD'.
- Evidence: r2-deal24-hardstop-banner.png, r2-deal24-conflict-desktop.png/.txt,
  r2-deal24-conflict-api.json, r2-legacy-deal24-hardstop.png, r2-legacy-deal24.txt,
  r2-deal24-after-restart-*.png, r2-conflict-intake-typed.png.

### Deal 23 correction — STILL FAILING (partial)

- Present: hard-stop banner with both APNs (9999 vs 1710), chip "BLOCKED - WRONG PARCEL",
  conflict snapshot in the payload, and the correction note in Activity ("QA fixture
  corrected to the honest conflicted state ... disposition (keep/trash) is Tyler's.").
- STILL WRONG: beneath the banner the same page still renders the fabricated-verified
  content: header APN 4180-07-78-9999 with ACREAGE 47.45 ac and OWNER "PICKENS COUNTY
  OF", appraised value $569,400, "2 of 5 strategies can be worked (Cash Flip: viable;
  Novation or Double Close: provisional)", valuation "$1,396,881 (high confidence)", and
  payload strategies.pricingAllowed=true with resolutionState "Parcel verified (...)".
  The banner says no valuation/strategies ran while the page shows them — a direct
  contradiction; the coordinator's claimed "no owner/valuation" state is not what
  renders.
- Evidence: r2-deal23-corrected-desktop.png/.txt (lines 85, 173, 195, 253),
  r2-deal23-corrected-api.json.

### F6 intake-dedupe-overwrites-accepted-identity — STILL FAILING (new regression), restoration mostly verified

- Restoration verified live: owner "ELROD MELINDA KAY", county "Pickens County",
  landos_parcel_identity confirmed 0.9 with the original LandPortal Map Search basis
  (DB + payload + rendered header all agree). Residual: the workspace resolutionState
  still cites "orig: South Carolina statewide parcel layer (SCDOT GIS mirror)" (the
  derived DD/report row updated during the incident was not restored; property card DB
  row itself is restored to the LandPortal source).
- Guard re-run (same dedupe-shaped input, "...222 MCDANIEL AVE ... APN 5105-00-44-0497"):
  identity fields NOT mutated this time (owner/county/APN/acreage/parcel-identity all
  unchanged pre vs post; pricing gate unchanged) and the two-parcel contradiction is now
  detected with an excellent explanation. BUT the conflicted intake attached its
  resolution snapshot to EXISTING deal 19 (landos_resolution_snapshot overwritten at
  1784181331, acquire response dealCardId:19): Tyler's real verified lead now renders
  chip "BLOCKED - WRONG PARCEL" and the WRONG PARCEL hard-stop banner, "Verified parcel"
  no longer appears anywhere on the page, and the state persists across refresh and
  managed restart. A conflicting NEW lead inquiry must not flip an existing verified
  lead's presented status; it should live on its own record.
- Deal 19 needs restoration again: the pre-intake snapshot content is preserved in
  r2-deal19-pre-api.json (property.resolution: attempted, candidate-era basis, 0.7) and
  the earlier ws2-deal19-api.json.
- Evidence: r2-deal19-pre-api.json vs r2-deal19-post-api.json,
  r2-deal19-post-desktop.png/.txt (banner lines 46/60, activity line 405),
  r2-deal19-after-restart-desktop.png, r2-dedupe-guard-intake-typed.png.

### F7 stale-resolution-provenance-contradicts-verified-chip — FIXED

- Deal 19 (captured BEFORE the guard re-run poisoned it): Resolution box shows the
  verified provenance line and the old snapshot under the label "EARLIER RESOLUTION
  ATTEMPT (BEFORE VERIFICATION — HISTORICAL, SUPERSEDED)" with no contradictory
  confidence chip (r2-deal19-pre-desktop.txt lines 87-95).
- Deal 22 (verified, no snapshot): states "Parcel verified (Persisted verified Property
  Card (orig: SCDOT ...))" instead of "No resolution attempt has been recorded"
  (r2-deal22-desktop.txt lines 86-89).

### F8 comps-table-hides-validated-actives — FIXED

- Deal 19 comps table now renders 6 sold + 6 validated ACTIVE rows, every row with
  normalized $/acre, and one row honestly shows "Unavailable" for missing acres/ppa
  (never invented). Honest disclosure line: "Showing 12 of 105 validated records (top
  sold and top active by registry order); the full set stays in the validated registry."
  — matches payload counts (61 sold + 44 active = 105 unique).
- Note: the example comp (245 and 301 Railroad St, $186,792/ac) is not among the top-6
  actives by registry order, so it does not render; selection basis is stated and
  honest. Not treated as a failure.
- Evidence: r2-deal19-pre-desktop.png/.txt (table + Showing line), r2-deal19-pre-api.json.

### Regression sweep — PASS

- Five strategies with the new canonical names on every inspected deal (19, 22, 23, 24);
  deal-card-root absent in all workspace views; refresh persistence on all inspected
  deals; desktop 1440x900 and 412x915 with no horizontal overflow; zero
  undefined/NaN/[object Object]/mojibake tokens across all captures; API/UI
  reconciliation on deal 19: 10/10 checked values match.

## Recheck 2 verdict

F5, F7, F8: FIXED. Deal 23 correction: STILL FAILING (fabricated valuation/strategies/
owner facts still render beneath the hard stop). F6: STILL FAILING via a new regression —
the now-detected conflict is attached to the existing verified deal 19, flipping its
visible status to BLOCKED - WRONG PARCEL (persists across restart); report-level SCDOT
provenance also remains unrestored. Deal 19 requires builder restoration of its
resolution snapshot; original content preserved in the evidence payloads.

---

# Recheck 3 — 2026-07-16 (~13:xx local), after round-2 repairs

- Runtime healthy (PID 93676 at start; PID 85632 after the managed restart). Fresh bundle.
- Same real-browser method. Evidence:
  C:/Users/tbutt/claudeclaw-os/.runtime/landos/qa/agent-ws2-recheck3/
- qa-result deliberately NOT recorded (parent records retests).

## Per-item verdicts

### 1. Deal 19 fully restored — FIXED

- Chip "Verified parcel"; NO conflict banner; header identity intact (APN
  5105-00-44-0497, County "Pickens County", ACREAGE "1.32 ac (disputed)", OWNER
  "ELROD MELINDA KAY").
- resolutionState cites the ORIGINAL LandPortal provenance again: "Parcel verified
  (Persisted verified Property Card (orig: LandPortal Map Search parcel panel (browser
  read-only)), non-credit)" — the SCDOT residual is gone.
- identityConflict null; the F7 historical label renders ("EARLIER RESOLUTION ATTEMPT
  (BEFORE VERIFICATION — HISTORICAL, SUPERSEDED)" over the restored pre-verification
  snapshot, confidence 0.7, historical:true).
- The real accepted acreage-conflict blockers/decision remain (dispute panel + Tyler
  decision + blockers), as required.
- Open work contains ZERO wrong-parcel tasks (6 tasks, none conflict-related). The only
  "WRONG PARCEL" text on the page is a timestamped Activity HISTORY event from the test
  intake plus the restoration note ("Second restoration: ... wrong-parcel next actions
  ... were closed. Lane-level snapshot detail was not recoverable and is empty. Pending
  Tyler review.") — honest audit trail, not current state.
- Verified across refresh AND managed restart (PID 85632): banner absent, LandPortal
  provenance, historical label, acreage panel all present after restart.
- Evidence: r3-deal19-pre-*.png/.txt/.json, r3-deal19-after-restart-*.png/.txt.

### 2. Deal 23 honest conflicted — FIXED

- WRONG PARCEL hard-stop banner naming both APNs (4180-07-78-9999 vs 4180-07-78-1710);
  chip "BLOCKED - WRONG PARCEL"; owner/acres/appraised all null -> "Unavailable";
  valuation primary null and nothing renders ($1,396,881 / $569,400 / 47.45 ac /
  viable / provisional all gone); all five strategies blocked; pricing gate closed;
  resolutionState "unresolved". The only owner-name occurrence is inside the conflict
  explanation (what the source resolved) — legitimate.
- Evidence: r3-deal23-*.png/.txt/.json.

### 3. Deal 24 regression — PASS

- Still honest conflicted: banner with both APNs, chip, identity fields Unavailable,
  pricing closed, valuation null, all strategies blocked, zero bad tokens.
- Evidence: r3-deal24-*.png/.txt/.json.

### 4. Conflict-route regression (the shape that previously poisoned deal 19) — FIXED

- Ran "QA FIXTURE APN CONFLICT ROUTE RECHECK (...): 222 MCDANIEL AVE, PICKENS, SC 29671
  APN 5105-00-44-0497" through the live intake.
- Result: status apn_conflict, parcelVerified:false, routed to deal 24 — the EXISTING
  conflicted research card for that address (allowed by spec: reuse of the previous
  conflicted research card), with the two-parcel explanation (address is 222 MCDANIEL
  AVE while APN 5105-00-44-0497 is 200 SID EDENS RD).
- Deal 19 pre/post payload diff: identity, resolutionState, resolution (incl. snapshot
  content), canonicalAcreage, and pricing gate are BYTE-IDENTICAL; chip stays "Verified
  parcel"; no banner; DB landos_resolution_snapshot.updated_at (1784204467) predates the
  intake (acquire_run at 1784205101) — snapshot untouched. landos_parcel_identity
  unchanged (confirmed, 0.9).
- New/reused conflicted record id: 24.
- Evidence: r3-deal19-pre-api.json vs r3-deal19-post-api.json (diff script),
  r3-route-guard-intake-typed.png, r3-deal19-post-desktop.png/.txt.

### 5. Quick sweep (deal 19) — PASS

- Exactly five strategies with canonical names (Cash Flip; Novation or Double Close;
  Subdivide or Minor Split; Land-Home Package; Improvement Then Flip); deal-card-root
  absent; refresh persistence; 412x915 no horizontal overflow (scrollWidth 412); zero
  undefined/NaN/[object Object]/mojibake tokens on all inspected deals.

## Recheck 3 verdict

All five items verified: deal 19 restored (incl. provenance and snapshot) and immune to
the conflicting-intake shape that previously poisoned it; deals 23 and 24 honest
conflicted; sweep clean. From this independent recheck, no open findings remain from the
WS2 report and its rechecks.
