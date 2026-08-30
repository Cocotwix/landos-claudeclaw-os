# Independent Browser QA — ws2-declared-prerequisites

- Sprint: sprint-2026-08-30-shared-foundation
- QA agent: independent LandOS browser-QA (not the builder)
- Date: 2026-08-30
- Verdict: FAIL (one internally fixable in-scope finding; core claim otherwise demonstrated live)

## Runtime and method
- `npm run landos:status`: exactly one healthy verified server (PID 264168, port 3141, HTTP 200).
- Automated journey layer: no journey exists for this workstream; nearest read-only journey
  `acquisitions-deal-card-readonly` refused at preflight on `production_build_fresh`
  (source mtimes 17:46 vs build 17:43). Verified the skew is cosmetic: the modified files'
  compiled outputs in `dist/landos/` contain the ws2 logic (`unmetPrerequisites`,
  `waiting_prerequisite`, declared `CAPABILITY_PREREQUISITES`); the post-build edits are
  type/comment-only and erase at compile. Proceeded to manual inspection.
- Live inspection in a real browser tab (operator Chrome, Claude tab group): deal 93
  Overview + Property pages, deal 92 Overview, hard refresh (ctrl+shift+r), network and
  console reads. API read through the SPA's own pairing-session cookie (token never
  printed, never placed in a URL); business DB not touched.

## What was proven live (deal 93 — county-known lead, parcel deliberately unresolvable)
- Real manifest, no error wall: workspace renders fully; readiness strip shows
  "2 / 18 Returned" with per-item chips. No 409, no "no canonical subject" wall.
  On-screen: "Property identity resolution pending — research is still confirming this
  parcel."
- Market items evaluable and green from retained county data: API `market_statistics` and
  `area_market_context` are status green, `unmetPrerequisites: []`,
  reason "Measured market statistics on file: Iredell County (2–5 acres) (Current (2026-Q3))" /
  "Area context measured for Iredell County, NC." Visible operator surface: "MARKET — BY
  ACREAGE BAND · How land actually moves here · Iredell County, NC" with real figures
  (5–10 acres $18,684/ac · 113 d DOM · 103%; All acreage $50,591/ac · 316 recorded sales).
  County market intelligence is not skipped for lack of a parcel (ws2-r2/ws2-r3 outcome).
- Seller item expected-unknown: gray, "Expected unknown", not counted against readiness.
- Parcel items wait on their own prerequisite: every parcel-scoped item carries
  `prerequisites:["parcel"]`, `unmetPrerequisites:["parcel"]`, `machineBackfillAllowed:false`;
  `backfillCandidates` = ["property_resolution"] only; coverage entries for all 15
  parcel-scoped ids are `action:"waiting_prerequisite"` — never blocked/error at the
  coverage layer. Group header names the true gate ("Blocked by Property Resolution").
  Deal Read panel honestly states: "Parcel identity is not confirmed for this Deal Card,
  so there is no established subject to read."
- No research mutation on read: with network tracking armed, hard refresh of
  /dept/acquisitions/v2?deal=93 produced 16 API requests, all GET, none to
  research/run/backfill endpoints. Console: zero errors/exceptions.
- Refresh persistence: after hard refresh the identical manifest re-rendered
  ("2 / 18 Returned", same six red chips, same reasons).

## Contrast (deal 92 — established subject)
- Readiness strip "11 / 18 Returned · 11 returned 2 partial 2 unresolved 3 blocked
  1 not required"; parcel items have real attempted statuses ("Assessor & Tax ran and no
  assessor or tax record was retrieved", "Zoning research ran and did not establish a
  district", public water/sewer checked against official sources, comps ran and returned
  no acceptable closed sale). API: every item `unmetPrerequisites: []`;
  `backfillCandidates` = assessor_tax, comps_collection, valuation; zero
  waiting_prerequisite coverage entries. Market items unchanged (green). No regression.
  Console clean.

## Findings
1. FAIL (internally fixable, in-scope, ws2-r2, pattern same-label-different-basis,
   severity medium): the operator-facing completeness projection labels the 14
   waiting-on-subject items "blocked". Overview tally chip reads "14 BLOCKED" on deal 93,
   and `manifest.operatorCompleteness.items[].outcome` is `'blocked'` for each item whose
   only impediment is the unmet parcel prerequisite.
   `projectOperatorResearchCompleteness` (src/landos/research-readiness.ts — a file this
   workstream modified) maps red → 'blocked' without consulting `unmetPrerequisites`,
   contradicting the workstream's own waiting_prerequisite semantics on the one aggregate
   number the operator actually reads. Per-item chips/tooltips say "Missing — <honest
   reason>" and are acceptable; the aggregate label is not.
   Evidence: .runtime/landos/qa/ws2-declared-prerequisites-qa/deal93-readiness-tallies-14blocked.jpg
2. Deferred (low, ws2-r4 adjacent): direct per-panel capability endpoints
   (POST /api/landos/deal-cards/:id/assessor-tax etc.) gate only on subject-card
   existence, not declared prerequisites; deal 93 holds an unverified_lead subject card,
   so the enabled "Run Assessor & Tax" button on page=property would reach the capability
   despite the readiness manifest declaring the parcel prerequisite unmet. Not exercised
   (read-only QA; fixture must not be resolved). Orchestrator/readiness — the surfaces the
   requirement names — do consult the declarations, so deferred, not failing.
3. Minor observations (recorded, not failing): (a) waiting items still carry
   `nextAction` "Run Assessor & Tax." / "Run Zoning & Subdivision." even though they are
   declared unattemptable — the honest next action is subject establishment; (b) deal 93
   access/road_frontage reasons say "The parcel record was read…" though no parcel record
   was retained; (c) operator-qa journey preflight `production_build_fresh` refuses on a
   cosmetic mtime skew, blocking the automated journey layer for this sprint.

## Prohibited outcomes — none occurred
- Manifest did not 409 wholesale; parcel research did not run from a read; market
  intelligence was not skipped by a parcel dependency; deal 92 readiness unchanged.

## Evidence files
- .runtime/landos/qa/ws2-declared-prerequisites-qa/deal93-overview-top.jpg
- .runtime/landos/qa/ws2-declared-prerequisites-qa/deal93-readiness-market-postrefresh.jpg
- .runtime/landos/qa/ws2-declared-prerequisites-qa/deal93-readiness-tallies-14blocked.jpg
- .runtime/landos/qa/ws2-declared-prerequisites-qa/deal92-readiness-contrast.jpg

## Tabs
- Opened 1 tab (Claude tab group in the operator's Chrome); closed 1 after teardown.

## Recheck — F2 repair (2026-08-30, second pass)

- Runtime: `npm run landos:status` — one healthy verified server (PID 267924, port 3141, HTTP 200).
- Rerun of the failing journey, same method (real browser tab in the Claude group, API read
  through the SPA session, no business-data mutation).

### Deal 93 (county-known, parcel unresolvable) — F2 assertion
- Readiness strip now reads: heading "2 / 18 Returned"; tally chips
  "2 RETURNED · 0 PARTIAL · 2 UNRESOLVED · 1 BLOCKED · 13 WAITING ON SUBJECT · 1 NOT REQUIRED".
  The former "14 BLOCKED" chip is gone.
- API `operatorCompleteness` agrees exactly: `{returned:2, partial:0, unresolved:2, blocked:1,
  waiting:13, notRequired:1, headline:"2 / 18 Returned"}`. Every unattemptable item
  (`unmetPrerequisites:["parcel"]`) has outcome `waiting` and nextAction
  "Waiting on an established subject parcel." The sole `blocked` item is `property_resolution`,
  which is genuinely attemptable (no unmet prerequisites, backfill candidate, nextAction
  "Run Property Resolution.") — the acceptable residual the recheck brief allows.
- The two `unresolved` items (Access, Road Frontage) were actually attempted (LandPortal ran,
  technicalSuccess true) and are not labeled blocked/failed/error; their nextAction also says
  waiting on the subject. Consistent, not a mislabel.
- No regression: market items still green with real Iredell figures ($18,684/ac 5–10 acres,
  $50,591/ac all acreage, 316 recorded sales); seller still "Expected unknown"/not_required.
- Hard refresh (ctrl+shift+r): identical tallies persist. Console: zero errors/exceptions.
  Network on full page load: 25 requests, all GET, all 200 — no research or model runs triggered.

### Deal 92 contrast (established subject APN 4870-90-2087.000)
- Strip: "11 / 18 Returned" with "11 RETURNED · 2 PARTIAL · 2 UNRESOLVED · 3 BLOCKED ·
  1 NOT REQUIRED" — no waiting chip at all. API: `waiting:0`; the 3 blocked items
  (Assessor/Tax, Comps Collection, Valuation) all genuinely ran and exhausted their sources
  with the subject established. Meaning unchanged; no waiting mislabels.

### Evidence
- `.runtime/landos/qa/ws2-declared-prerequisites-qa/recheck-deal93-13waiting-1blocked.jpg`
- `.runtime/landos/qa/ws2-declared-prerequisites-qa/recheck-deal92-0waiting-3blocked.jpg`
- Ledger evidence E13 (browser_journey).

### F3 (route-level capability gate)
- Recorded DEFERRED per instruction; not retested this pass.

### Recheck verdict
- F2: PASS. No internally fixable in-scope issue remains. Workstream verdict: PASS.
