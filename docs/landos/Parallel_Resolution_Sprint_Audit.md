# LandOS Parallel Resolution Sprint — System Audit & Acceptance Matrix

Architecture-level record only. No property-specific work product lives here (the
per-property migration inventory is written to the gitignored `store/` tree).

## Phase 1 — System state at sprint start (reconstructed from disk)

- **Runtime:** healthy on `http://localhost:3141`; canonical `landos:*` scripts manage it.
- **Records:** 18 property cards / 18 deal cards. 9 verified across 8 states; the rest
  unresolved leads. `171 Camp Davidson Road` (Monroe TN) verified & active; the erroneous
  `171 Davidson Road` archived + quarantined via `landos_property_correction_link`; the
  instruction-consistency safeguard active (contradiction rows recorded).
- **Worktree finding:** the tree was mid-pivot from *browser/LandPortal-first* intake to
  **Public-First Property Intelligence**. `acquire/run` had its browser auto-start and
  LandPortal auto-auth **deliberately disabled** (`{status:'disabled'}` /
  `optional_not_requested`), while the public-first stack (`lookupOfficialParcel`,
  `runPublicPropertyIntelligence`, `CountyCapabilityRegistry`, government accounts,
  credential vault) was built but wired only to **separate manual endpoints** — never into
  the autonomous intake continuation.

### Shared root cause

A new lead geocodes, writes human-facing "go check NETR/Assessor" next-actions, and
**parks** — no autonomous fall-through to parcel-level sources. The two parcel-evidence
lanes (official public, LandPortal) were neither parallel nor both wired: `officialParcel`
ran sequentially inside `resolveProperty`; `landPortalBrowser` was `undefined`. A
jurisdiction without a structured adapter had no path forward.

## Direction (operator-selected)

**Parallel Public + LandPortal property intelligence, with parallel multi-provider comp
intelligence.** Official public sources and LandPortal are *parallel primary* lanes (not
sequential primary/fallback); comps run across all approved providers as one unified
parallel workflow.

## Shared components delivered this session

| Component | File | Nature |
| --- | --- | --- |
| Parallel resolution orchestrator | `src/landos/parallel-resolution.ts` | Pure: runs Lane A + Lane B concurrently (`Promise.all`), reconciles APN/owner/acres/county/state/coords into one verdict + visible reconciliation issues, enforces the wrong-parcel APN hard stop. |
| Live lane adapters | `src/landos/parallel-resolution-lanes.ts` | Maps existing `lookupOfficialParcel` (Lane A) and an existing read-only LandPortal `BrowserService` (Lane B) into neutral `LaneOutcome`s; unavailable adapter / unauthenticated session → honest `unavailable`, never a throw or a fabricated confirm. |
| Live endpoint | `POST /api/landos/deal-cards/:id/parallel-resolve` (`routes.ts`) | System-wide (keyed by card id, no property-specific branch). Runs both lanes, records lanes + reconciliation on the card, promotes an **unresolved** lead to confirmed when safe, and — per the operator-confirmation rule — never overwrites an already-accepted APN (records a contradiction + asks Tyler instead). |

## Acceptance matrix (this session)

| # | Requirement | Shared subsystem | Status | Verification |
| --- | --- | --- | --- | --- |
| 1 | Two parcel lanes run concurrently, neither blocks the other | parallel-resolution | **PASS** | Unit test: fast lane finishes first though called second; thrown lane captured, other lane still confirms. |
| 2 | Reconcile APN/owner/acres/county/coords into one verdict | parallel-resolution | **PASS** | Unit tests: APN/county/acreage/coordinate conflicts flagged; harmless APN/acreage variance tolerated. |
| 3 | Missing adapter is not a dead end | lane adapters | **PASS** | Live: card 19 (Pickens SC, no adapter) → official `unavailable`, recorded, not parked-silent. |
| 4 | Wrong-parcel APN hard stop | parallel-resolution | **PASS** | Unit test: requested vs resolved APN mismatch blocks confirmation + downstream. |
| 5 | Single exact parcel-level source confirms; geocode does not | parallel-resolution | **PASS** | Unit tests: single confirmed lane → `single_lane` confirm; candidate/geocode-only → not confirmed. |
| 6 | Operator-confirmation rule: never silently overwrite accepted info | endpoint | **PASS** | Live: card 17 (verified) → `alreadyVerified`, `promoted:false`, accepted record untouched; contradiction path asks Tyler. |
| 7 | Every attempt recorded on the card (auditable) | endpoint / Activity | **PASS** | Live: `parcel_resolution` activity rows written for cards 19 & 17. |
| 8 | No regressions to the verified fleet or suite | whole repo | **PASS** | Full suite 3144/3144 green; typecheck 0; production build clean; runtime restarted healthy. |
| 9 | Lane B (LandPortal) live authentication | browser-session | **BLOCKED** | Chrome session live on CDP 9222, credentials configured, but LandPortal auto-login fails: *"login form not found (email/username field missing) — the login UI may have changed."* Site UI change; requires a login-selector repair. |
| 10 | Live parcel confirmation of a brand-new address (200 Sid Edens) | both lanes | **BLOCKED** | Depends on #9 (LandPortal) or a Pickens County official adapter; both lanes honestly `unavailable` this session. Recorded, not fabricated. |

## Session 2 (2026-07-14, same day) — sprint completion

### LandPortal authentication repaired (fleet-wide, `browser-session.ts`)
Root cause chain, discovered by live DOM inspection (never guessed selectors):
1. The login form (`#login-user`/`#login-pwd`) hides in a modal behind the nav "Log in"
   trigger → shared `LP_OPEN_LOGIN` step clicks it and retries.
2. The modal needs ~3.5 s to render and the popup-dismisser was clicking the modal's own
   Close button → longer settle, no dismiss inside the modal.
3. The submit control is `<a class="btn-login">` (an anchor, not a button) → scoped
   ancestor search including anchors, before any document-wide fallback.
Plus: a 10-min authenticated fast-path (no per-mission reload of the heavy app SPA),
`protocolTimeout: 60s` on CDP connect, and 4 new regression tests (13 total in the file).
**Live: `phase: authenticated` from env credentials, fleet-wide.**

### Parallel resolution wired into autonomous intake (`acquire/run`)
Both unconfirmed branches (research-card and matched-but-unconfirmed) now run the two
parallel lanes via shared `runParallelParcelResolution` + `applyParallelResolution`
(same code as the manual endpoint), serialized through an in-process gate (two live
missions on one working tab collide — observed and fixed). On confirmation the FULL
downstream report runs automatically. Hard per-lane time budget added (a hung browser
workflow can never hold the verdict or an operator request hostage).

### Parallel multi-provider comps + unified registry + embedded map
- `comp-orchestrator.ts`: concurrent provider execution w/ per-provider budget + audit;
  the single PPA rule (Sold/Asking/Pending Asking PPA, never fabricated); straight-line
  distance; non-selected classification (nothing silently discarded). 10 tests.
- `deal-card-report.ts`: Zillow + Redfin captures now FETCH in parallel; persistence
  stays provider-ordered (dedupe invariant preserved).
- `comp-map.ts` + `GET /deal-cards/:id/comp-map`: final deduplicated registry payload —
  subject, markers w/ labeled PPA + provider links + selection scores + exclusion
  reasons; coordinates from provider rows + shared `landos_geocode_cache` (bounded free
  Census fill, misses cached). 5 tests.
- `web/src/lib/slippy.ts` + `web/src/components/landos/CompMap.tsx`: dependency-free
  interactive slippy map (free OSM tiles + attribution), subject diamond, status-coloured
  markers, selected ring, filters, zoom/pan/fit/expand, cluster badges, marker detail
  card, sortable comp table. Embedded in the Deal Card Market tab.
- `selectBestComps` now exposes its transparent 0-100 selection score.

### Migration
All 18 current Deal Cards reconciled through the shared model-v2 architecture: 16
reconciled (idempotency verified by an immediate second run — all "no changes"), 2
correctly preserved untouched (trashed card; quarantined 171 Davidson Road duplicate).
De Queen picked up 8 real comp-status fixes. Seller/CRM untouched by construction.
Report: `store/landos-reports/migration-report-2026-07-14.md` (by full address + APN).
County-name normalization ("Pickens County County" caught in live QA) fixed in the lane
and as an idempotent data migration.

## Final acceptance matrix

| # | Requirement | Status | Proof |
| --- | --- | --- | --- |
| 1 | LandPortal auth working fleet-wide | **PASS** | ensure-auth live: `authenticated`; 13 unit tests; root cause chain above. |
| 2 | Official + LandPortal lanes run in parallel | **PASS** | Unit (concurrency, timeout, error isolation) + live card 19 lanes trace. |
| 3 | Lane failure never stops the other lane | **PASS** | Unit tests + live: official `unavailable` while LandPortal confirmed. |
| 4 | Brand-new raw address resolves + continues downstream | **PASS** | **200 Sid Edens Rd, Pickens SC 29671 → APN 5105-00-44-0497, owner ELROD MELINDA KAY, 1.15 ac**, confirmed via Lane B, promoted, report ran automatically (58 sold + 60 active collected → 55/51 unique, top-5 selected, Land Score 17). |
| 5 | Brand-new genuinely unresolved lead exhausts paths, parks honestly | **PASS** | Safe test lead "12345 Sprint Test Rd, Pickens SC" → research card (deal 20), parallel lanes attempted + recorded, identity `unresolved`, no fabricated downstream, no premature ask. |
| 6 | Existing verified properties render via current shared architecture | **PASS** | 171 Camp Davidson Rd TN (APN 062 059G A 03400 000 2026): report + comp-map (66 sold/51 active, 5 selected) + CRM endpoint; 2510 State Hwy 153 TX (APN R000020383): comp-map honest empty state. |
| 7 | Existing unresolved property stays safely unresolved | **PASS** | 999 Model Validation Test Ln (Beaufort SC): identity `unresolved` w/ exact geocoder-not-parcel basis; `parcelVerified:false`. |
| 8 | Operator-confirmation rule (never overwrite accepted info) | **PASS** | Shared `applyParallelResolution` contradiction path + live card 17 `promoted:false`, accepted APN untouched; instruction-consistency records + 171 Davidson quarantine intact. |
| 9 | Wrong-parcel APN hard stop | **PASS** | Unit tests (requested-vs-resolved mismatch blocks confirm + downstream). |
| 10 | Unified registry: property + transaction dedupe, provider provenance | **PASS** | Live card 19: 10 duplicates merged, providers attached; unit tests. |
| 11 | Sold / active / pending kept separate; no blending | **PASS** | Registry lanes + labeled PPA; Market Pulse uses sold band only (live QA). |
| 12 | Labeled PPA, never fabricated | **PASS** | Unit tests (null on missing/zero/invalid) + live table "$/ac (Sold PPA)". |
| 13 | Top-5 transparent selection, no weak fill, exclusions visible | **PASS** | Live: "Top 5 of 55… (5 closed sales)" w/ scores 73-87 + why; non-selected rows show classification + reason. |
| 14 | Interactive embedded comp map (subject marker, filters, clusters, detail cards, provider links, attribution, fit/expand) | **PASS** | Live QA screenshot `store/operator-qa-parallel-sprint/deal19-compmap.png`; 52/108 plottable (bounded geocode cache fills per load); "N lack coordinates" banner (never fabricated). |
| 15 | Raw LandPortal Show-on-Map preserved separately from the final map | **PASS** | Shared `captureLandPortalVisuals` (clicks the real Show-on-Map control): `landportal_1_comparables_map_*.png` in the visual registry; the embedded map is labeled `final deduplicated registry`. |
| 16 | Zillow/Redfin/Realie collected where available, parallel, failure-isolated | **PASS** | Parallel fetch shipped + live card 19 activity: Zillow/Redfin ran and honestly recorded "no city/state locality" while realie+homeharvest supplied 106 raw candidates. |
| 17 | Every current Deal Card migrated, idempotent, seller/CRM preserved | **PASS** | Migration report: 16 reconciled/idempotent, 2 preserved skips. |
| 18 | No property-specific production branch | **PASS** | Repo grep over new modules + routes: no address/APN/card-id literals (one JSDoc example string only). |
| 19 | Tests / typecheck / build / diff-check / runtime | **PASS** | 3164/3164 (252 files); tsc 0; vite+tsc build clean; `git diff --check` clean; runtime healthy, one managed process. |
| 20 | Live browser QA | **PASS** | In-app extension unavailable → approved CDP fallback used (per runbook); screenshots in `store/operator-qa-parallel-sprint/`. |

Known non-blocking observations (recorded, not hidden): card 19 header shows acreage as
"needs confirmation" (LandPortal browser-read acreage is deliberately not official-grade —
conservative by design); LandPortal visible comp rows were not re-read during card 19's
report because verification was reused from the persisted card (capability proven on other
cards); the automation Chrome accumulated ~95 targets over weeks and had to be restarted
once (graceful CDP `Browser.close`) — tab lifecycle hygiene is a good future hardening item.
