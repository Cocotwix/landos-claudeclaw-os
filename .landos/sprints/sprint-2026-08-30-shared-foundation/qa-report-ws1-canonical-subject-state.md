# Independent Browser QA — ws1-canonical-subject-state

- Sprint: sprint-2026-08-30-shared-foundation
- QA agent: independent browser-QA (not the builder)
- Date: 2026-08-30
- Runtime: exactly one healthy verified LandOS server (PID 272988, port 3141, HTTP 200) via `npm run landos:status`
- Automated layer: `npm run landos:operator-qa -- --journey acquisitions-deal-card-readonly` → PASS (real_browser, 0 findings); report `.runtime/landos/qa/qa-2026-08-30T21-07-49-421Z/report.json`

Acceptance case: Deal 92 — 333 Cranfill Rd, Harmony, NC (APN 4870-90-2087.000, Iredell County, NC; `landos_property_card` id 82, `verification_status=unverified_lead`, acres 61.132). Contrast case: Deal 90 — 19554 NW 137th Ln, Lake Butler, FL (verified_property).

## Journey results

### 1. Deal Card renders as an established subject — PASS
Opened `http://localhost:3141/dept/acquisitions/v2?deal=92` in a real Chrome tab. The full Deal Card workspace rendered (Overview with valuation strip, visuals, market band, readiness, Deal Brain), not a "no canonical subject" or resolution-trace-only screen.
- visible_assertion: header `333 CRANFILL RD, Harmony, NC 28634 · Owner of record HARRIS RACHEL LEWIS · APN 4870-90-2087.000 · 61.132 AC · IREDELL COUNTY, NC`.
- No surface anywhere on the journey said "no subject", "no canonical subject", or bare "unverified".

### 2. Readiness / run-status present the same established subject — PASS
- API `GET /api/landos/deal-cards/92/research-readiness` property_resolution item: status green/Ready, reason: "Parcel identity established: APN 4870-90-2087.000, Iredell County, NC. Official assessor confirmation is still outstanding." — established with the correct qualification.
- On-page RESEARCH & SYSTEM STATUS (Property tab): visible_assertion: "Research run complete … Property Resolution: RESOLVED · APN 4870-90-2087.000 · 1 source. Subject established for discovery: the supplied APN 4870-90-2087.000 in Iredell County, NC agrees with the authenticated LandPortal parcel panel …".
- Remaining Diligence honestly carries the county-coverage limitation ("Live parcel lookup did not confirm a new match (unavailable)…") without downgrading the subject to no-subject.
- `GET /api/landos/deal-cards/92/resolution`: `subjectResolved:true`, `officiallyVerified:false` — distinct, matching ws1-r1. Overview readiness summary ("11 / 18 Returned") lists only genuinely missing/unresolved lanes (Assessor/Tax, Current Zoning, Public Water, Public Sewer, Well Outlook, Comps Collection); parcel identity is not among them.

### 3. One governing acreage across surfaces — PASS (with one labeled-reference note)
Governing conclusion 61.132 ac (rounded 61.13) appears consistently:
- Header chip: `61.132 AC`
- Visuals panel: `Land + Home · 61.13 AC`
- Parcel scope / TRANSACTION SUBJECT: `APN 4870-90-2087.000 · 61.132 AC`
- SUBJECT panel ACREAGE: `61.13 AC` with expandable Identity provenance: "Acreage basis: assessed · 2 retained source observation(s) · numerically equivalent observations reconciled. LandPortal parcel 177612312."
- `ACREAGE (LISTING-REPORTED) 61.13 AC` and `RETAINED LISTING … 61.13 acres` are explicitly labeled listing-reported reference evidence, numerically equivalent.
- API `governingAcreage: {value: 61.132, kind: "assessed", disputed: false}`.
No two surfaces assert different unlabeled acreages. (61.132 vs 61.13 is display rounding of the same governing number, each with its basis available.)

### 4. Hard refresh persistence — PASS
Ctrl+Shift+R twice on `?deal=92`: identical header (APN 4870-90-2087.000, 61.132 AC, IREDELL COUNTY, NC), same readiness summary, same subject. No data loss.

### 5. Console and network on load/refresh — PASS
- Console: zero errors/exceptions after hard reload (read_console_messages, onlyErrors).
- Network after hard reload: 22 localhost requests, all GET (deal-cards/92, research-readiness, property-resolution, property-intelligence, comp-map, intelligence, smart-intake, etc.), all 200. No POST, no research/run mutation triggered by load or refresh.

### 6. Contrast check deal 90 (officially verified) — PASS
`?deal=90` renders 19554 NW 137th Ln, Lake Butler, FL 32054 · APN 00083A-03400 · 1.5 AC · BRADFORD COUNTY, FL · "Vacant Land - 1.5 AC". API: `subjectResolved:true, officiallyVerified:true`. Subject panel county renders correctly as "Bradford County". No regression.

## Finding (internally fixable, in-scope)

### F1 — Subject panel county renders "Iredell County County" (minor, canonical-state-partial-propagation)
- Where: `?deal=92&page=property`, SUBJECT panel, COUNTY row.
- Repro: open the URL, scroll to the SUBJECT panel below the RETAINED COMPARABLES strip; COUNTY reads `Iredell County County` (DOM-confirmed and screenshot `.runtime/landos/qa/ws1-canonical-subject-state-qa/deal92-subject-panel-county-county.jpg`).
- Expected: `Iredell County` once — the canonical subject state carries `county="Iredell"`, and `web/src/lib/format.ts` `countyLabel()` exists precisely to prevent this doubling (its test asserts `countyLabel('Iredell County County') === 'Iredell County'`).
- Root indication: the property-intelligence identity view returns `county="Iredell County"` (unnormalized) while the resolution endpoint returns `"Iredell"`; `web/src/components/AcquisitionWorkspaceV2PropertyIntelligence.tsx:930` appends `" County"` unconditionally instead of using `countyLabel()`. One consumer therefore carries a differently-normalized county than the Canonical Subject State — a ws1-r2 propagation gap, though identity itself remains correct.
- Severity: minor. Disposition: internally_fixable. Pattern: canonical-state-partial-propagation.

## Deferred out-of-scope observations (not workstream findings; recorded for reproduction)
1. Overview "MARKET — BY ACREAGE BAND" table (deal 92) shows two rows both labeled "All acreage" with materially different figures ($12,428/ac · 3 sales · 0 mo supply vs $50,591/ac · 316 sales · 15.86 mo). Same visible label, different basis, distinction not shown. Matches the reviewed `same-label-different-basis` pattern; market surface, outside ws1.
2. Deal 92 resolution API `governingAcreage.source` says "Iredell County assessor roll" while the Assessor & Tax readiness lane reports no assessor record retrieved; the assessed value came via the LandPortal parcel record. The on-screen provenance only claims "basis: assessed · LandPortal parcel 177612312", so the operator is not misled, but the API source string overstates directness.
3. Deal 90 visuals list `FEMA FLOOD 94.3% · 1.74 ac` on a 1.5 ac parcel (labeled LandPortal reference); pre-existing, outside ws1.
4. Environment note: intermittent CDP `Page.captureScreenshot` timeouts/black frames occurred during capture (retries succeeded); browser-tooling artifact, not an application defect.

## Verdict: FAIL (1 minor internally fixable finding, F1)
All six journey steps otherwise hold: the research-grade subject reads as ESTABLISHED everywhere, subjectResolved is distinct from officiallyVerified, one governing acreage appears with its basis, refresh persists, console is clean, no research reruns on load, and the verified contrast deal shows no regression. After the F1 repair, rerun this exact journey with `--recheck`.

Tabs: opened 1 tab in the Claude group for this inspection; closed 1 (teardown complete).

---

## RECHECK — F1 (2026-08-30, post-repair build + managed restart)

Runtime precondition: `npm run landos:status` — one healthy verified server (PID 273716, port 3141, HTTP 200).

Rerun of the exact failing journey, `?deal=92&page=property`:
1. SUBJECT panel COUNTY row now reads exactly `Iredell County` — once. The doubled `Iredell County County` is gone. Confirmed twice: full page-text dump and post-refresh DOM read (County label ref with row value "Iredell County"). Zero occurrences of the string "County County" anywhere on the page.
2. WS1 outcome intact: subject established (APN 4870-90-2087.000, agrees with authenticated LandPortal panel), governing acreage 61.132 AC in header / 61.13 AC labeled in Subject panel, owner HARRIS RACHEL LEWIS, jurisdiction Harmony / NC / 28634.
3. Hard refresh (ctrl+shift+r): county row persists as `Iredell County`; console shows zero errors/exceptions; network shows 28 /api/ requests, all GET, all 200 — no POSTs, no research runs triggered by load.
4. Regression spot-check `?deal=92&page=overview`: header renders h1 `333 CRANFILL RD, Harmony, NC 28634`, `APN 4870-90-2087.000`, `61.132 AC`, `IREDELL COUNTY, NC` (once). No regression.

Evidence: recorded page-text/DOM read at `.runtime/landos/qa/f1-recheck-county-row-2026-08-30.txt`. Screenshot substituted with a named page-text read because capture would activate the operator's own Chrome (this session's QA tabs open in Tyler's Chrome group); substitution stated per contract, not silently waived.

Deferred observation (out of F1/recheck scope, recorded only): on the deal 92 property page, VISUAL EVIDENCE thumbnails fetch `/api/landos/inspection/image?cardId=82&key=...` (cardId 82, not 92). All returned 200 and the gallery is labeled LandPortal · verified subject; whether card 82's inspection store legitimately backs deal 92 was not adjudicated here.

## Recheck verdict: PASS
F1 repaired; no internally fixable in-scope issue remains on this journey.

Tabs: opened 1 tab in the Claude group for this recheck; closed 1 (teardown complete).
