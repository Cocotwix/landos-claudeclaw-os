# Independent Browser QA — ws1-workspace-contract (Lead Workspace read model)

- Sprint: sprint-2026-07-15-lead-workspace-foundation
- QA role: independent landos-browser-qa (not the builder)
- Date: 2026-07-16 (~04:00-05:30Z)
- Live base URL: http://localhost:3141
- Verdict: **FAIL** — 1 blocker, 1 major, 2 minor internally fixable findings
- Browser: real Google Chrome via the approved persistent CDP profile (puppeteer-core over
  http://127.0.0.1:9222 — the same infrastructure the operator-qa harness uses; the Claude
  Chrome extension was not connected in this session). Every check ran against the live
  rendered dashboard in that real browser; screenshots captured fresh.
- Evidence folder: C:/Users/tbutt/claudeclaw-os/.runtime/landos/qa/agent-ws1-20260716T04/

## Runtime + automated layer

- Managed runtime status check: exactly one healthy verified server (PID 133996
  pre-restart, PID 102100 after the restart-persistence check). HTTP 200, bundle current.
- Automated journey layer (operator-qa, journey lead-workspace-acquisitions-readonly):
  PASS (real_browser, 0 findings). Report:
  .runtime/landos/qa/qa-2026-07-16T03-58-26-924Z/report.json.
  My independent inspection goes beyond the harness and found issues the journey
  does not cover.

## Deals used

| Deal | Role | State |
|---|---|---|
| 19 | existing verified lead (200 Sid Edens Rd, Pickens SC; APN 5105-00-44-0497) | parcel confirmed |
| 20 | existing unresolved lead (12345 Sprint Test Rd, Pickens SC) | unresolved (geocode-only) |
| 21 | NEW QA fixture, designed not to resolve ("00000 Nonexistent Qa Fixture Rd, Pickens, SC 29671") | created via dashboard intake this run; research card, unresolved, confidence 0.3 |
| 22 | NEW QA fixture, resolves ("222 McDaniel Ave, Pickens, SC 29671" — Pickens County courthouse, owner PICKENS COUNTY OF) | created via dashboard intake this run; parcel confirmed via SC statewide parcel layer (SCDOT GIS mirror), APN 4180-07-78-1710 |

Fixture note for Tyler: deals 21 and 22 are additive QA fixtures created this run under
your explicit authorization. Deal 21's title is self-labeling. Deal 22's "QA FIXTURE"
label was supplied in the intake conversation text but the stored deal title is just the
resolved address; the label survives in the application log (acquire_input event) and this
report. Nothing was deleted or modified (QA is read-only toward operator data); removal of
the fixtures is your call.

## Journey steps actually run (all in the real browser)

1. Verified lead (deal 19) — /dept/acquisitions?deal=19: lead-workspace-root rendered;
   deal-card-root ABSENT; header shows title, Lifecycle new, Resolution "Parcel verified
   (Persisted verified Property Card (orig: LandPortal Map Search parcel panel (browser
   read-only)), non-credit)", APN 5105-00-44-0497 — all match the API payload and DB
   (landos_parcel_identity state=confirmed). All eight disclosures opened and read.
   Evidence: deal19-verified-desktop.png/.txt, deal19-verified-api.json.
2. Exactly five strategies (deals 19, 20, 21, 22) — exactly 5 lead-workspace-strategy
   items on every deal: Quick Flip, Novation or Double Close, Subdivide or Minor Split,
   Land Home Package, Improvement Then Flip — no others. This is exactly the canonical
   accepted WS3 list (src/landos/strategy-readiness.ts APPROVED_STRATEGIES). NOTE: the QA
   tasking phrased the first strategy as "Cash Flip"; the accepted canonical name is
   "Quick Flip". The workspace consumed the canonical list verbatim, which is the LW3
   contract; flagging the naming difference for Tyler only.
3. Unresolved lead (deal 20) — honest: APN "Unavailable", identity fields null, acreage
   status "unknown", 0 comps, valuation null, all 5 strategies blocked,
   pricingAllowed=false with explicit blockers ("Parcel identity is not confirmed…").
   No fabricated owner/parcel/acreage/comp/value facts. Evidence:
   deal20-unresolved-*.png/.txt/.json. See minor finding F4 on the "Resolution: Not run"
   wording.
4. New fixture that stays unresolved (deal 21) — created through the real intake UI
   (New Lead, typed text, then the Run Property Intelligence button). Server: acquire_run
   matched:false, researchCard:true, confidence 0.3. Workspace honest exactly like deal 20
   (no fabricated intelligence, everything blocked, 0 comps). Survives refresh. Evidence:
   fixtureB-intake-typed.png, deal21-qa-fixture-unresolvable-*.png/.txt/.json.
5. New fixture that resolves (deal 22) — created through the same intake UI; resolution
   confirmed via free public sources (US Census geocoder + SC statewide parcel layer);
   the intake flow opened the LEAD WORKSPACE directly (wsRoot present, legacy absent).
   Honest verified state; survives refresh and restart. Evidence: fixtureA-intake-typed.png,
   fixtureA-intake-after-run.png, deal22-qa-fixture-resolved-*.png/.txt/.json.
6. Refresh persistence — browser reload on deals 19, 20, 21, 22: the same Lead Workspace
   re-rendered with identical header/data every time (*-after-refresh.png).
7. Restart persistence — managed runtime restart (healthy, PID 102100), then reloaded
   deals 19 and 22: identical workspace and data (deal19-after-restart-*,
   deal22-after-restart-*; deal 19 payload byte-length identical before/after restart).
8. Desktop layout (1440x900) — usable; two-column disclosure grid; no horizontal overflow
   (scrollWidth == innerWidth == 1440).
9. Galaxy S24 Ultra width (412x915) — workspace root and all content render single-column,
   wrap correctly, no horizontal overflow (scrollWidth == 412). Evidence:
   deal19-verified-mobile-412.png, deal22-qa-fixture-resolved-mobile-412.png.
10. API/UI reconciliation — captured the exact /api/landos/lead-workspace/(id) response
    the page fetched (network layer) for all four deals and compared against rendered
    text: title, resolution state, APN, owner, readiness summary line, strategy summary,
    valuation PPA, comp counts — all agree, zero mismatches. No raw provider payloads in
    the contract (scanned for raw/html/base64/cookie/provider-response keys: none; comps
    carry named providers + source URLs only, e.g. "Realtor.com (HomeHarvest)").
    departmentOutputs carry the full LW2 envelope (provenance, observedAt, confidence,
    completeness, blockers, dependencies, recommendedActions) for all three departments.
11. Legacy quarantine (testid check) — deal-card-root absent whenever the Lead Workspace
    was open (all deals, all widths, after refresh and restart). BUT see finding F2: the
    Deal Library row-click path silently opens the legacy Deal Card instead.
12. Console — no console errors/warnings or page errors while loading deal 19's workspace.
13. Read model contract (code + live) — GET /api/landos/lead-workspace/:id is a read-only
    composition (src/landos/routes.ts ~2626, src/landos/lead-workspace.ts); it does not
    invoke browser/provider lanes and consumes the canonical projection. Contract v1.0 in
    payload and on screen. EXCEPT the acreage-basis wiring — finding F1.

## Findings

### F1 — BLOCKER — Workspace "Acreage basis" shows the legacy reconciliation, not the canonical WS1 acreage basis (LW3 violation + on-screen contradiction)

- Live URL: http://localhost:3141/dept/acquisitions?deal=19
- Repro: open the URL, expand "Canonical acreage, research & readiness".
- Expected: the canonical shared acreage basis (accepted WS1 service): assessed 1.32 ac vs
  mapped 1.15 ac, disputed=true, not operator-accepted, Tyler decision required —
  consistent with "Identity & resolution", readiness ("value conflicted") and the pricing
  blocker ("Acreage is conflicted (assessed vs mapped)") shown on the SAME page.
- Actual: the "Acreage basis" block renders primary "1.15 ac", primarySource
  "Provider verification", primaryTier "provider", conflict false, status "reconciled"
  — conflict-free, "reconciled", and a wrong source tier ("Provider verification" when the
  real bases are Pickens County assessor roll / county GIS, confidence "official"). Same
  wrong object on deal 22 (source shown as "Provider verification" instead of the SC
  statewide parcel layer).
- Root cause (verified in source): buildLeadWorkspace reads
  input.operatorRecord.acreageBasis, which does not exist at the top level (the canonical
  basis lives at operatorRecord.identity.acreageBasis), so the
  "?? input.report.reconciliation" fallback silently substitutes the legacy
  field-reconciliation record. src/landos/lead-workspace.ts line 48.
- Evidence: deal19-acreage-basis-contradiction.png (both states visible),
  deal19-verified-api.json (property.canonicalAcreage.acreage vs
  property.identity.acreageBasis), deal19-verified-desktop.txt lines ~159-171 vs ~121-122
  and blocker lines.
- Severity: blocker — a canonically conflicted acreage is presented as reconciled and
  conflict-free on the new primary surface; matches the reviewed recurring patterns
  reconciliation-ignores-acreage-conflict / overlay-uses-wrong-acreage-basis.
- Disposition: internal_fixable. patternKey: reconciliation-ignores-acreage-conflict.

### F2 — MAJOR — Deal Library row click silently opens the legacy Deal Card, not the Lead Workspace (quarantine gap)

- Live URL: http://localhost:3141/dept/acquisitions?section=library
- Repro: open Acquisitions, open Deal Library, click any deal row (tested
  "200 Sid Edens Rd" #19).
- Expected: the same Lead Workspace that ?deal=19 opens (no silent fallback to the legacy
  Deal Card).
- Actual: the full legacy Deal Card opens (deal-card-root, "Deal Card model v2" badge,
  Overview/Property/DD/Market/Strategy/Visuals/Seller/Documents/Activity tabs, Edit and
  Delete controls). Deep link ?deal=19 opens the Lead Workspace; library click opens the
  legacy card: the same deal shows two different surfaces depending on entry path, and
  the legacy card states the acreage CONFLICT more honestly than the workspace (see F1),
  so the two paths contradict each other.
- Cause: web/src/pages/Acquisitions.tsx line 90 renders the legacy DealCard component for
  the library list; row clicks are handled inside the legacy component and never route
  through openDeal/LeadWorkspace.
- Evidence: libtest-library-list.png, libtest-library-after-click.png.
- Severity: major. Disposition: internal_fixable. patternKey: legacy-deal-card-silent-fallback.

### F3 — MINOR — Mojibake in the workspace header ("LEAD WORKSPACE Â· V1.0")

- Every Lead Workspace header renders "Â·" instead of a clean middle dot (double-encoded
  UTF-8 in the source: bytes C3 82 C2 B7 in web/src/components/LeadWorkspace.tsx, header
  line ~68). Visible in all screenshots at all widths.
- Severity: minor. Disposition: internal_fixable. patternKey: ui-text-double-encoded-utf8.

### F4 — MINOR — "Resolution: Not run" on leads whose resolution ran and recorded "unresolved"

- Deals 20 and 21: landos_resolution_snapshot / landos_parcel_identity record state
  "unresolved" with an explanatory basis (geocode-only, confidence 0.3), but the workspace
  header says "Resolution: Not run" and does not surface the recorded resolution attempt
  or its basis. Honest in that it never claims verified, but it tells the operator no
  attempt happened when one did, and drops recorded provenance (LW2).
- Evidence: deal20-unresolved-desktop.png/.txt, deal21-qa-fixture-unresolvable-desktop.png.
- Severity: minor. Disposition: internal_fixable.
  patternKey: resolution-state-label-not-run-after-attempt.

## Observations (not failed, flagged for Tyler)

- Strategy naming: canonical accepted list says "Quick Flip"; this QA tasking said
  "Cash Flip". Workspace consumed the canonical list exactly (correct per LW3).
- Deal 22 (county courthouse fixture) has pricingAllowed=true and a value range
  ($860,079-$1,647,559) with research 0/8 resolved — that is the accepted WS3 pricing-gate
  semantics consumed verbatim (gate = validated sold set + confirmed parcel + no
  conflict), not a WS1 recomputation; noting the business meaning for review.
- The UI renders most sections as raw JSON dumps; departmentOutputs, offerAndNegotiation,
  freshness are in the API but not rendered. Deferred to ws2-workspace-ui (visual polish
  out of WS1 scope); no dishonesty found in what IS rendered.

## What passed

Verified/unresolved/new-resolved/new-unresolved honest states (subject to F1/F4 wording),
exactly five canonical strategies everywhere, no fabricated intelligence on unresolved
leads, refresh + restart persistence, desktop and 412px layouts, API/UI reconciliation
with zero mismatches, no provider payload leakage, LW2 envelope present in
departmentOutputs, quarantine testid check while workspace open, no console errors.

---

# Recheck — 2026-07-16 (~05:0x Z), after builder repairs

- Runtime: exactly one healthy verified server, new PID 159068, HTTP 200, fresh bundle.
- Same real-browser method (approved persistent Chrome CDP profile, puppeteer-core).
- Fresh evidence: C:/Users/tbutt/claudeclaw-os/.runtime/landos/qa/agent-ws1-recheck-20260716T05/
- Ledger deliberately NOT touched by this recheck (parent session records retests).

## Per-finding verdicts

### F1 (blocker, reconciliation-ignores-acreage-conflict) — FIXED

- /dept/acquisitions?deal=19 "Acreage basis" now renders the canonical WS1 basis:
  entries assessed 1.32 ac (Pickens County assessor roll, official, disputed:true),
  gis_geometry 1.15 ac (Pickens County GIS geometry, official, disputed:true),
  valuation + spatial_overlay entries, disputed=true, tylerDecisionRequired=true, and the
  full decision text ("Acreage basis unresolved: … survey or recorded plat …") —
  consistent with the identity record and the pricing blockers on the same page.
- Network payload: property.canonicalAcreage deep-equals property.identity.acreageBasis
  (verified programmatically on the captured payload). The legacy record is gone:
  zero occurrences of "Provider verification" or "reconciled" in the block and zero in
  the entire rendered page text.
- Deal 22 spot-check: basis now official county sources (Pickens County assessor roll
  47.45 ac / Pickens County GIS geometry 45.64 ac), deep-equals identity basis, no
  "Provider verification".
- Evidence: recheck-deal19-desktop.png/.txt (block at text lines ~159+),
  recheck-deal19-api.json, recheck-deal22-desktop.png/.txt, recheck-deal22-api.json.

### F2 (major, legacy-deal-card-silent-fallback) — FIXED

- /dept/acquisitions?section=library → clicked the "200 Sid Edens Rd" (#19) row: the
  LEAD WORKSPACE opened (lead-workspace-root present exactly once, deal-card-root
  ABSENT), and the URL now carries ?deal=19 after the click
  (/dept/acquisitions?token=…&deal=19).
- Browser refresh from that state returns to the same Lead Workspace (root once, legacy
  absent, identical header).
- Evidence: recheck-library-list.png, recheck-library-after-click.png,
  recheck-library-after-click-reload.png.

### F3 (minor, ui-text-double-encoded-utf8) — FIXED

- Header now renders "LEAD WORKSPACE · V1.0" with a clean middle dot (visually confirmed
  in the zoomed screenshot). Zero mojibake sequences ("Â", "â€") in the full rendered
  page text of deals 19, 20, and 22. Source file no longer contains the double-encoded
  bytes; the loading-state text now uses an explicit clean ellipsis (I could not catch
  the transient loading state on screen — it resolves too fast on localhost — so the
  loading-text check is source-level plus zero mojibake in every rendered capture).
- Evidence: recheck-deal19-header-zoom.png, recheck-deal19-desktop.png.

### F4 (minor, resolution-state-label-not-run-after-attempt) — FIXED

- Deals 20 and 21 headers now read "Resolution: unresolved" (matches the recorded
  attempt state; no more "Not run").
- Network payload now carries the recorded resolution provenance at property.resolution:
  {attempted:true, state:"unresolved", confidence:0.3, basis:"Parcel not yet confirmed —
  only a geocoded location …"} on both deals — matching landos_resolution_snapshot /
  landos_parcel_identity. Neither deal claims verified anywhere.
- Note (ws2 scope, not a failure): the provenance object is in the payload but the basis
  text is not yet rendered in the workspace UI; the header state itself is honest.
- Evidence: recheck-deal20-desktop.png/.txt, recheck-deal20-api.json,
  recheck-deal21-qa-... captures, recheck-deal21-api.json.

## Core journey regression re-run (deal 19)

- lead-workspace-root present exactly once; deal-card-root absent.
- Exactly 5 canonical strategies (Quick Flip, Novation or Double Close, Subdivide or
  Minor Split, Land Home Package, Improvement Then Flip).
- Refresh persistence: same workspace and data after reload.
- Desktop 1440x900 and Galaxy S24 Ultra 412x915: no horizontal overflow
  (scrollWidth == innerWidth at both widths), content usable.
- API/UI still reconcile (title, resolution, APN, readiness line present verbatim).
- No regression observed. Deals 20, 21, 22 re-inspected with the same assertions — all hold.

## Recheck verdict

All four findings FIXED; no regression found in the core journey. From this independent
recheck the workstream has no remaining open findings from my original report.
