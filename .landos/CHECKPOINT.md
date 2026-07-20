# LandOS Current Checkpoint

<!-- DERIVED:START -->
- **Generated:** 2026-07-20T14:19:39.217Z
- **HEAD at generation:** `ee94d14`
- **Worktree:** DIRTY; 51 modified/untracked paths at refresh time. Preserve unrelated changes.
- **Latest tests:** PASS at 2026-07-15T23:20:46-04:00; 264 files, 3391 tests, 0 failures (vitest run, full suite).
- **Latest typecheck:** PASS at 2026-07-15T23:14:00-04:00; tsc --noEmit.
- **Latest production build:** PASS at 2026-07-15T23:21:30-04:00; Vite production bundle and server TypeScript build; managed runtime restarted on the fresh bundle.
- **Managed runtime:** RUNNING healthy at 2026-07-15T23:32:00-04:00; PID 122616; http://localhost:3141.
- **Active sprint:** sprint-2026-07-17-operator-useful-leads (complete); 3/3 accepted, 0 QA-passed; current workstream none in flight; 0 open QA findings.
- **Sprint ledger:** .landos/sprints/sprint-2026-07-17-operator-useful-leads/ledger.json; proof report .landos/sprints/sprint-2026-07-17-operator-useful-leads/report.md; frozen capabilities: 3 (.landos/capabilities.json).
<!-- DERIVED:END -->

## Market Research verify-and-complete sweep — COMPLETE (2026-07-19d)

Sticky Drill Deep header shipped. JSON-payload sweep re-verified 50/50 states
→ 30,425 ZIPs (+541 recovered, incl. 119 counties wrongly marked done) and
declared ZIP counts on all 3,138 counties. Cross-county ZIP membership built
(landos_mr_zip_county + union rendering in listMrRows + payload-proof
zipShortfalls): Denver/Muscogee "missing" ZIPs were under neighbor parents,
not absent. FE-vs-backend: 6,070 rows / 72,840 cells over US + all 50 county
tables + all 157 GA ZIP tables + 2 per other state → 0 mismatches.

## Market Research multi-band expansion (2026-07-19e) — controlling task list

Owner request: finish cross-county ZIP membership; add bands <1, 1-2, 2-5
(done), 5-10, 10-20, 20-50, 50+, all-acreage nationally; FIRST find the
fastest reusable extraction (no full browser sweep per band; consider work
outside the LandOS server); keep dashboard responsive; verify; NO commit/push.

- [x] Evidence probed: dropdown = All/0-1/1-2/2-5/5-10/10-20/20-50/50-100/100+
  (no native 50+ — both halves collected); every admin-ajax request carries
  the band in filters.acre_range; requests are uniform units (states /
  counties-per-state / zips-per-(state,county)); DB already WAL.
- [x] Architecture built + tested (25 passing): out-of-server worker
  `dist/landos/mr-band-collect-cli.js <band>`
  (market-research-band-collector.ts) opens its own tab in the authenticated
  Chrome, captures the page's OWN band-filtered request as the verbatim
  filter template, replays the site's drill-deep data calls in-page (same
  session, read-only, throttled + 3× retry), retains via shared store fns
  (metrics, add-only fills, NULL-only counts, memberships → cross-county fix
  completes as a side effect). Resumable per-unit ledger
  landos_mr_band_unit ('empty' = real provider absence). ACREAGE_BANDS +
  DRILL_DEEP_ACREAGE extended; overview lists all bands (UI shows retained
  only); getCollectionStatus derives running from ledger freshness.
- [x] Bands COLLECTED COMPLETE (0 failed units; 51 states / 3,138 counties /
  ~32.4k ZIPs each): 0-1, 1-2, 5-10, 10-20, 20-50, 50-100 (+2-5 earlier).
  Provider-empty units recorded honestly (54-55/band).
- [x] Multi-band FE-vs-API verification PASSED: 8 bands × (US + GA counties +
  2 GA cross-county ZIP tables) = 1,792 rows / 21,504 cells, **0 mismatches**;
  band selector lists exactly the retained bands; Stephens 13257 renders 4
  ZIPs incl. cross-county 30577 (owned by 13011). Screenshots
  store/browser-shots/mr-band-verify/. Dashboard during/after collection:
  / 41ms, overview 96ms.
- [x] ALL 9 BANDS COMPLETE 2026-07-20 14:10Z. A LandPortal maintenance window
  (~09:45Z, "under construction") had left 100+ partial and `all` unstarted;
  the durable watcher `scripts/mr-band-autoretry.mjs` (detached, backoff,
  per-unit resume, log logs/mr-band-autoretry.log + status
  store/mr-band-autoretry.json) rode it out and finished both. Maintenance had
  also logged the session out — re-auth via the approved
  POST /api/landos/browser/ensure-auth (env credential, never displayed).
  FINAL per band (each): 51 states, 3,138 counties, ~32.4k ZIPs, **0 failed
  units**; totals 28,242 county rows + 290,020 ZIP rows across bands.
- [x] Final multi-band FE verification: 9 bands, 2,016 rendered rows, 24,192
  cells, **0 mismatches** (store/browser-shots/mr-band-verify/). Runtime
  healthy; dashboard responsive throughout. NOT committed or pushed.

## Market Research gap fill — COMPLETE (2026-07-19)

241 missing values extracted ADD-ONLY (each with a landos_mr_correction audit
entry; retained values never modified — live trailing-window numbers drift).
Remaining blanks (23,676 geographies, 21,987 zero-sales) verified as “-” on
LandPortal itself. Machinery: `fillMissingMrMetrics`, `computeMrGaps`,
`collectMarketGapFill`, POST /api/landos/market-research/fill-gaps.

## Market Research workspace — COMPLETE (2026-07-19)

Capability at `/dept/market-research`: Heat Map + Drill Deep over immutable
quarterly snapshots (`landos_mr_*`), API `/api/landos/market-research/*`,
shared snapshot/band/metric/selection state, ZCTA + albers TopoJSON at
`/geo/*`. Bands appear only with real retained data. Tab-return bug fixed
(rejected topo fetches cached forever → permanent spinner;
`web/src/lib/topo-loader.ts` retries). Collector hardened + regression-tested
(interactive-leaf clicks, VISIBLE-grid checks, patient retries for provider
render storms, child-row-presence expand/collapse, chunked writes, resumable
runs). Acceptance witnessed in visible Chrome (store/browser-shots/).

Ops notes: `npm run landos:restart` kills the CDP Chrome child (relaunch via
POST /api/landos/browser/start). Temp `scripts/tmp-mr-*.mjs` (no secrets) are
sandbox-undeletable; safe to remove. Pre-existing full-suite failures NOT from
these builds: memory-budget tests, Property Board test vs dirty uncommitted
work, comp-map selection-gate expectation.

## Lead Card system-wide build (carried, compacted 2026-07-19)

- [ ] Card 25 (272 McAlister Rd, Kingstree SC): owner-confirmed identity
  `45-177-182` / WRAGG JESSICA MARIE / Book 795 Page 429 persisted + protected.
  Missing: deed image (Williamsburg recorder needs an authenticated county
  session — external blocker) and a qualified sold-comp valuation set.
  HomeHarvest comp-coordinate repair built; owner-visible check pending.
- [ ] Card 28 (585 Marksmen Ct, Fayetteville GA): complete except deed image
  (GSCCCA images are paid-only — prohibited) and qualified valuation set.
- [ ] Automatic free official lien/judgment search per verified card (true "no
  liens found" only after a completed official no-match search).
- [ ] County-record retention of source/reference/status/image beside the deed
  gallery on every card; shared recorder capability (free-only accounts,
  DPAPI credential reuse, real page capture — adapter exists, no county
  exercised end to end); deed-page gallery on every card (Card 14 works).
- [ ] Backfill every real Lead Card (owner/deed, parcel, imagery, terrain,
  feasibility, qualified comps, market evidence); remove owner-facing
  diagnostics; exercise all owner actions per card.

## Phase 1 finalization (carried)

- [x] Scope audit; full regression + build repaired and passed 2026-07-18.
- [ ] Validate storage isolation / LandPortal replacement (QA data never shown
  as operating leads).
- [ ] Full owner walkthrough (Mission Control, acquisitions, Lead Workspace,
  intake, county research, discovery package, transcripts, Max, browser
  research); then stage/commit/push with Tyler's authorization.

## Pending Tyler decisions

- None. No paid accounts/charges, secret changes, QA leads, or silent APN
  merges. Commit/push requires explicit authorization.

## Next recommended system-wide priority

- Finish bands 100+/all when LandPortal exits maintenance; then resume Lead
  Card completion (qualified comps + recorder images) and backfill.
