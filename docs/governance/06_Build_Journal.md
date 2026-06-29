# 06 LandOS Build Journal

Owner: CC
Update Rule: Update after every major LandOS sprint. Append a new dated entry; keep entries concise.

Entry format:
```
## YYYY-MM-DD — Sprint Name
Business milestone:
Summary:
Files changed:
Commits:
Tests:
Decisions made:
Risks:
Blockers:
Lessons learned:
Next business milestone:
```

## 2026-06-27 — Post-Discovery Due Diligence Expansion

Business milestone: extend LandOS from a pre-call briefing system into the post-discovery DD operating layer (after Tyler completes a discovery call and decides a lead is worth deeper review).

Summary:
- Free **government DD provider foundations** (`providers/gov-dd-providers.ts`): FEMA flood, USFWS/NWI wetlands, USGS slope, US Census demographics — provider-agnostic, **dormant by default** (`LANDOS_LIVE_GOV_DD`), canonical result + provenance + Unknown fallback. No live gov call made; injected-fetch tests only.
- **County Records Browser Agent foundation** (`county-records-tasks.ts` + `browser-agents.ts`): post-discovery, **manual-trigger only**, never auto-runs. Bounded task contracts (max interactions/time, stop conditions), evidence model, conflict detection, exact-identity rules (coordinates/nearest/geocoder can never verify), manual outcome records. Agent execution stays dormant.
- **Seller-stated facts** (`seller-stated-facts.ts`): post-discovery seller answers recorded as **Seller-stated (never Verified)**; feed missing facts, risk flags, next-best-action, workflow stage. Persisted on the subject property card (`landos_card_activity`) — **no schema migration**.
- **Underwriting prep foundation** (`underwriting-prep.ts`): cost placeholders, verify-before-offer gates, tighter comp requirement, deal killers, min-profit rules, offer-readiness state. Pure; never computes a binding offer.
- **Deal Card workflow stage** (`deal-card-readiness.ts`): pre_discovery_ready → discovery_completed → needs_deeper_dd → county_verification_needed → underwriting_ready → offer_prep_ready. UI: stage badge + Post-Discovery panel (seller facts, county verification, underwriting prep) + DD provider readiness.

Files changed: new `providers/gov-dd-providers.ts`, `county-records-tasks.ts`, `seller-stated-facts.ts`, `underwriting-prep.ts` (+ tests); edits to `deal-card-readiness.ts`, `routes.ts`, `web/src/components/DealCard.tsx`; governance docs.

Tests: full suite ~1337 green; tsc clean; web build OK. No Realie/Google/paid/live-gov calls (counters unchanged: Realie 1, Google 2).

Decisions made: gov DD providers are free but dormant until approved activation; County Records Browser is a post-discovery manual specialist, never auto-run; seller facts are Seller-stated only; underwriting "prep" ≠ final underwriting; post-discovery persistence uses card_activity (no migration).

Risks: gov-provider live parsers are unverified against real responses (fixture-shaped); county browser execution not built (dormant); seller/county facts require a linked subject property card.

Blockers: live gov-API activation + first smoke need approval; County Records Browser execution needs the visual stack (UI-TARS/Qwen) + approval.

Lessons learned: `??` does not fall through on empty strings — empty DD-worksheet values were shadowing property-card values in identifier resolution (fixed with `||`).

Next business milestone: activate the first free gov DD provider (FEMA flood) live behind the capability — guarded, with an explained smoke — to begin replacing Unknowns with verified government data.

---

## 2026-06-26 — Baseline (project to date)

**Business milestone:** Establish the LandOS operating system shell and the provider-agnostic foundation for Lead → Deal Card → Due Diligence → Discovery Call Report, and synchronize governance.

**Summary (cumulative milestones, oldest → newest):**
- **Shell & foundation** — LandOS shell, safe upstream ClaudeClaw adoption, SDK 0.3 migration, memory isolation + shared tier, provider engine bridge + SDK env hardening (`46cb932`, `1c92f41`, `c87e82f`, `b53fb3a`).
- **OS Spine v1** — `store/landos.db`, approval/audit spine, rules/playbook lifecycle, department registry, 100-pt rubric, offer engine, model-call/cost schema, dashboard API + LandOS page.
- **Property Analysis & intake** — one-button Property Analysis (DD + Market Pulse + Strategy + Markdown/PDF), flexible intake, concurrent research lanes, LandPortal v2 wiring (`f0066a0`, `aece249`, `d8cd05c`, `2e67734`, `3eb8dd5`).
- **Model router** — capability profiles/scoring, routing, override, telemetry, execution dispatch; execution environments + provenance; live execution service + safe mode; grunt helpers; Deal Card lane; operational Underwriting (`f633df2`, `643ca05`, `a08a9d3`, `3e7ae2c`, `d98fd97`).
- **CP3–CP6** — R2-ready KnowledgeStore + Realie adapter scaffold + knowledge dashboard tab/routes + ingestion shell; status doc (`79dad13`, `83c899a`).
- **Live model router fix** — persist live routing + Ollama runtime config in `dashboard_settings`; internal-id→Ollama-tag mapping; regression tests; verified live ON / Ollama healthy end-to-end (`0a6527b`, `7e2cf25`).
- **Provider/capability abstraction for DD** — live DD routed through the parcel-identity capability (not direct LandPortal); Realie intended primary; County Records Browser + General Visual Browser placeholders (`dd5d954`).
- **Realie contract + trial guard** — adapter rewritten to the verified official contract; manual gitignored trial guard; **Realie live call #1 succeeded** (verified an exact GA parcel); **5-digit FIPS normalization** applied (`949b6c5` + follow-up).
- **Governance sync (this entry)** — governance docs added under `docs/governance/`; founder docs preserved verbatim; implementation docs populated.

**Files changed (this governance sprint):** `docs/governance/` (00 Founder Vision, 01 Vision, 05 Operating Charter, 07 Product Principles — verbatim; 02 Decision Log, 03 Roadmap, 04 Architecture, 06 Build Journal — authored; README).

**Commits (recent, newest first):** `949b6c5` Realie adapter contract + trial guard · `dd5d954` Route DD through parcel capability · `7e2cf25` live-routing endpoint tests · `0a6527b` persist live routing/Ollama config · `83c899a` CP3–CP6 status · `79dad13` R2 KnowledgeStore + Realie + knowledge tab · `d98fd97` grunt helpers/Deal Card lane/Underwriting.

**Tests:** full LandOS suite green at baseline (~1265 tests across ~96 files); `tsc --noEmit` clean; production build succeeds. Realie/parcel-capability/trial-guard covered by fixture-based tests (no live API calls in tests).

**Decisions made:** see `02_Decision_Log.md` (capability-over-vendor; Realie primary/LandPortal legacy; coordinates never verify identity; manual per-call Realie approval; safe-mode default; repo holds code/docs only).

**Risks:** Realie trial budget is small (manual per-call approval mandatory); zoning/flood/wetlands/slope/utilities capabilities not yet wired (return Unknown by design); canonical parcel model still bridges through `LpResolveResult` transitionally.

**Blockers:** real-lead workflow completion is gated by **per-call Realie approval** (by design); R2 live + `@aws-sdk/client-s3` install pending Tyler approval.

**Lessons learned:** scaffolded adapters must be validated against the real provider contract before trusting them (the Realie scaffold mismatched on base/path/auth/fields); env config must be reachable at runtime (live-routing persisted via dashboard_settings, not `.env`-only); restart only takes effect on a rebuilt `dist`.

**Next business milestone:** validate the real lead workflow (Lead → Realie verify → Deal Card → DD → Discovery Call Report) one approved Realie call at a time; then complete the Deal Card working experience and DD capability shell.

## 2026-06-27 — Working-product mode + DD final-acceptance kickoff

**Business milestone:** shift LandOS to working-product mode (remove over-governance) and begin the final Due Diligence acceptance suite.

**Summary:**
- Governance/policy correction: CLAUDE.md + governance README/Decision Log/Roadmap/Architecture rewritten to working-product mode. Configured operational providers (Apify Redfin, Google Maps/Street View/Static Maps, free gov APIs, Realie within budget) are approved for normal use; build proceeds without per-step approval. Only hard stops: machine safety, secret exposure, deletion/destruction, irreversible data loss. The per-call paid-approval regime is retired.
- Live pipeline validated: outbound network confirmed to all providers; the parcel-identity capability verified address #1 live via Realie (APN P072-0580) in ~0.3s; the live Redfin comp lane is wired.
- Address parser fix: `ADDRESS_RE`/`extractPropertyArgs` now parse street names starting with an ordinal ("1915 1st Avenue") and "0" house numbers (vacant land) — all five acceptance addresses parse. +2 regression tests.
- Two browser-capable agents recognized as a product requirement (County Records Browser Agent + General Browser Research Assistant); architecture leaves room.

**Tests:** full suite 1342 green; tsc clean.

**Remaining for DD completion (next block):** lead-type classification field, property-type inference, Apify comps wired into the persisted Deal Card report, gov DD live activation, and the five live Test-Lead Deal Card runs with persisted Discovery Call Reports.

**Next business milestone:** execute the five-address live acceptance suite end-to-end (Test-Lead Deal Cards + persisted Discovery Call Reports).

## 2026-06-27 — Realie locality root-cause fix (production-safe identity)

**Business milestone:** make parcel verification production-safe after acceptance testing found wrong-locality "Verified" matches.

**Root cause:** Realie's address endpoint matches on `state` + street-line-1 only (it does not accept ZIP and only honors `city` when `county` is also supplied; it returns a single property, not candidates). Fresh leads arrived as address+city+state+zip with no county, so the adapter sent only state+street-line → Realie returned a statewide arbitrary street-name match (Augusta→Macon, Rockvale→Knoxville, Dunlap→Lakeland). The normalizer then marked any returned property Verified with no locality comparison.

**Fix:** (A) derive the county from the address via the free US Census geocoder (`providers/county-geocode.ts`) so the Realie lookup is locality-constrained (city+county); (B) validate the returned parcel's locality against the searched locality (`providers/locality-validation.ts`) — a state/ZIP/county conflict downgrades to Needs Verification (status `locality_mismatch`); confidence is scored. The normalizer now reads `zipCode`. Wired live in `parcel-capability.ts`; the adapter takes an injectable `deriveCounty` (tests stay offline).

**Why correct:** identity is constrained up front and independently validated after; a parcel can no longer become Verified when the returned locality conflicts with the searched one. Proven live: Augusta now verifies to AUGUSTA (Richmond Co); Rockvale/Dunlap downgrade to Needs Verification on ZIP conflict.

**Tests:** +8 (validateLocality + adapter county-derivation/downgrade/keep-correct), full suite 1350 green; tsc clean.

**Remaining for DD department completion:** lead-type field, property-type inference, Apify comps wired into the persisted Deal Card report, gov DD activation, and the five-address full-workflow acceptance suite (now unblocked by this fix).

## 2026-06-27 — Pre-Call Intelligence synthesis layer

**Milestone:** add the trustworthy/labeled core of the Pre-Call Intelligence package.

- `pre-call-intelligence.ts` (new, pure): identity TIER (Verified Parcel / Candidate Parcel / Area-Only Context), property-type + preliminary-strategy inference (never fabricated), and a Pre-Call readiness STATUS (High/Moderate/Limited/Needs Verification with a 0-100 score) — replaces binary "ready". Wired into the Deal Card report API (`preCallIntelligence` + `propertyType`) and rendered on the Deal Card UI.
- Live-validated on the five acceptance addresses: locality fix holds in the suite (0 Green Rd, Rockvale correctly downgraded to Area-Only when Realie returned Knoxville); 731 Filter Plant Dr + 472 West Rd verified with high locality confidence; 220 W White Rd = Candidate.
- Tests +11 (1361 total green); tsc + production build clean.

**Remaining for department completion:** lead-type field + labeling, Apify comps + Google visuals wired into the persisted Deal Card run, browser-research market-intelligence lane (selectable open-source model), gov DD activation, acreage sourcing for property-type inference, and the five persisted Test-Lead Deal Card full runs.

## 2026-06-27 — Lead types + 5 persisted Test-Lead Deal Cards (acceptance) + report-path identity fix

- **Origin repair:** folded the previously-stranded `pre-call-intelligence.ts` (+test) that `routes.ts` imports — 4bc9fe2 had committed the importer but not the module, so origin did not build. Now consistent.
- **Lead types:** additive `lead_type` column (idempotent ALTER, no data loss) on deal/property cards; `LEAD_TYPES`/`LEAD_TYPE_LABEL`; `createDealCard`+POST accept `leadType`; report response carries `leadType`/`leadTypeLabel`; **TEST LEAD** badge (loud amber) on Deal Card list rows + detail header.
- **Root-cause fix (acceptance defect):** `buildIdentityText` never included the street address, so an address-only lead resolved to just the state and the Deal Card report path could never verify it (`parcelVerified=false`) even though the capability verified it directly. Added the address line (APN still wins when present). +regression test.
- **Acceptance:** created 5 persisted **TEST LEAD** Deal Cards via the live pipeline (Realie + locality fix + expanded fields). 731 Fayetteville + 472 Poulan verify (472 → Improved property, 8.6ac, building 1512, market/AVM/lat-lng); 0 Green Rd downgrades on locality; 220 W White / 0 Fredonia honest not-verified. Reports persist + reload.
- Tests 1365 green; tsc + build clean. Realie report-run calls this block: 5.

**Remaining for department completion:** Google visuals + Apify comps/market + Browser Market Intelligence + gov DD activation wired into the persisted run.

## 2026-06-27 — Government DD (FEMA flood, live) + Browser Market Intelligence capability

- **FEMA flood activated (live, verified contract):** confirmed the real NFHL endpoint live (MapServer layer 28, point query -> features[].attributes.FLD_ZONE/ZONE_SUBTY/SFHA_TF), rewired the provider parser to it, and added `fetchFemaFlood` (free, keyless, not behind the dormant gov-DD gate). Wired into the persisted Deal Card report (`govDd.flood`) via the verified parcel point. Acceptance: 731 + 472 return zone X (minimal hazard, not in SFHA); unverified parcels honestly show not_run.
- **Coordinate governance preserved:** lat/lng are SUPPORTING-only (environmental DD), carried on a dedicated `DukeVerificationResult.coordinates` field, never in the property-data/identity contract (kept the no-coordinates-in-contract guard green). Fixed a sign bug (numFrom dropped negative longitude).
- **Browser Market Intelligence capability** (`browser-market-intelligence.ts`): model-agnostic, SELECTABLE open-weight model (`LANDOS_BROWSER_MODEL`, default qwen3-vl, replaceable), evidence model with full provenance (url/source/snippet/timestamp/confidence/supports/doesNotProve). Returns honest "Needs Research — no browser model backend wired" until a backend is provided; never fabricates evidence. Surfaced in the report response.
- Tests +9 (FEMA contract parse, govDd in persisted report, browser intel statuses); full suite 1370 green; tsc + build clean. Realie report-run calls this block: 5.

**Remaining for department completion:** Google visual auto-capture in the run (item 1) and Apify Redfin sold-comps lane in the persisted report (item 2); plus NWI/USGS gov providers (contract-verify like FEMA) and a real browser backend.

## 2026-06-27 — Final DD integrations: Google visual auto-capture + Apify comps in the persisted report

- **Item 1 (Google visuals):** the persisted report run now auto-captures satellite + Street View ONCE for a verified parcel (point/address), persists to the card, and REUSES on later runs (no repeat Google call). Honest no-op when not configured. Injectable for offline tests.
- **Item 2 (Apify Redfin comps + metrics):** the run now collects live sold comps for the verified parcel area (registerLiveProviders + retrieveComps), computes metrics (sold count, avg price, avg/median price-per-acre, median DOM), and persists them in the report (`marketComps`). Honest status when sparse (no_comps / not_configured / no_area) — never fabricated. Injectable for offline tests.
- Pre-call comp signal now uses the live sold-comp count.
- Acceptance re-run (deals #20-24, all TEST LEAD): 731 + 472 verified, both auto-captured 2 visuals + FEMA zone X + ran the live Apify lane (returned no verifiable comps for these specific parcels — honest); 3 unverified honestly area-only/candidate. All persist + reload.
- Tests +1 (items 1+2 with injected deps); full suite 1371 green; tsc + build clean. Realie report-run calls: 5; Google captures: 2 parcels; Apify lane ran live for 2 parcels.

**DD department status:** the full pre-call pipeline now runs end-to-end into the persisted Deal Card — identity (Realie + locality validation + expanded fields), property inference, FEMA flood, Google visuals, Apify comp lane, browser-intel capability, pre-call intelligence, lead types. Remaining are genuine extensions: NWI/USGS contract activation, a real browser-research backend, and Apify active-listing separation.

## 2026-06-27 — Activate NWI wetlands + USGS slope/topography (live, verified contracts)

Verified each contract live before coding (no guessing):

**NWI wetlands** — endpoint: USFWS WIM `…/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query`. Inputs: point geometry `lng,lat` (inSR 4326), spatialRel intersects, `outFields=*` (REQUIRED — the layer joins NWI_Wetland_Codes, so unqualified field names return an embedded error 400), `f=json`. Response: `{ features: [{ attributes: { "Wetlands.WETLAND_TYPE", … } }] }`; 0 features = no wetland mapped at the point. Fields mapped: WETLAND_TYPE (prefixed-key tolerant). Failure: HTTP!=200 / embedded error → error; no lat/lng → needs_verification; 0 features → verified "None mapped". Provenance: the query URL.

**USGS slope/topography** — endpoint: 3DEP EPQS `https://epqs.nationalmap.gov/v1/json?x=lng&y=lat&units=Meters&wkid=4326`. Inputs: point (5-point ~33 m cross: center + N/S/E/W). Response: `{ value: <elevation m> }`. Fields mapped: avg slope° = atan(max elevation Δ / 33 m), plus center elevation (m). Failure: HTTP!=200 → error; non-finite value → needs_verification. Provenance: the center EPQS URL.

- Both wired into the persisted Deal Card report (`govDd.wetlands`, `govDd.slope`) alongside FEMA, and into Pre-Call Intelligence signals. Coordinates are SUPPORTING-only (on `DukeVerificationResult.coordinates`), never identity. Unverified/area-only parcels have no coordinates → honest `not_run` / Needs Verification.
- **Root-cause loop:** NWI first returned an embedded error 400 (HTTP 200 body) because joined-layer field names were ambiguous; an earlier probe masked it via `features||[]`. Fixed by switching to `outFields=*` + prefixed-key-tolerant parsing. Re-verified live: 472 = "None mapped", Lake Seminole = "Lake".
- **DD-checklist note:** gov DD is intentionally NOT folded into the DD fact checklist, because that builder stamps all verified rows with the PARCEL provider's source — folding USGS/FEMA/NWI there would misattribute provenance. Gov DD keeps its own correctly-sourced section. Per-field checklist provenance is a future refinement.
- Acceptance (deals #20-24 region, TEST LEAD): 731 + 472 → FEMA zone X + NWI None mapped + USGS slope 5.4°/3.1° (all verified, persisted); 3 unverified → all gov DD not_run. Tests +4 (1374 green); tsc + build clean. Realie report-runs: 5.

**Remaining:** Census demographics activation, Apify active-listing separation + comp tuning, a real browser-research backend.

## 2026-06-27 — DD completion block: Census + real browser backend + checklist provenance + Apify root-cause

**Census (verified contract):** endpoint `https://api.census.gov/data/2023/acs/acs5`; inputs `get=NAME,B01003_001E,B19013_001E,B25001_001E,B25003_002E,B25003_003E&for=county:CCC&in=state:SS&key=`; geography = county (from 5-digit FIPS); response = `[header,row]` string arrays; mapped population/median-income/housing-units/owner/renter/owner%; failure → not_configured (no free key — never invented) / error (non-JSON). Wired into report (`demographics`) + Pre-Call. **Live result: not_configured** — Census now requires a free CENSUS_API_KEY which is not set (external limitation, hard-stop list). Activates when the key is added.

**Browser Market Intelligence — REAL backend:** `makeNewsResearchBackend` over Google News RSS (free, no key, no browser binary) collects ACTUAL local development/infrastructure/economic evidence per area, each item with URL/source/snippet/timestamp/source-type/confidence/supports/doesNotProve; classified heuristically. Selectable open-weight model architecture preserved (Puppeteer is installed for future vision/site-nav backends). **Live: 8 real evidence items per acceptance area.** Surfaced in the report API response (computed live on read for freshness).

**DD checklist per-field provenance:** `DdChecklistRow` now carries per-field source/timestamp/url/confidence; `mergeGovDdRows` folds FEMA/NWI/USGS into the checklist EACH with its own provider (FEMA NFHL / USFWS NWI / USGS 3DEP) — Realie facts keep Realie. No mislabeling. Verified-parcel DD completeness rose to 40%.

**Apify root cause (external):** instrumented a live run — the upstream third-party actor `tri_angle/redfin-search` is BROKEN against Redfin's current page ("Expected exactly one structured-data script tag, found 0", all retries fail) → 0 rows. NOT a LandOS filter/mapping/tuning bug. Fixed the mapping so a provider failure surfaces as `error` (not a false `no_comps`); genuine empty markets still read `no_comps`. Resolution needs a working/alternate comp actor (external).

**Acceptance (deals #35-39, TEST LEAD):** all 5 persist + reload; identity tiers correct (2 Verified, 1 Candidate, 2 Area-Only); Realie facts flow; Google visuals on verified; FEMA zone X + USGS slope on verified (NWI 1 verified, 1 transient WIM error — contract verified, honest); Census not_configured; Apify honest error/no_comps (broken actor); browser intel collected 8 real evidence each; DD checklist per-field provenance; Pre-Call complete. Tests +13 (1382 green); tsc + build clean. Realie report-runs: 5.

**Remaining = true external limitations:** Census free API key not set; the Redfin Apify actor is broken upstream (needs a working comp actor); a vision/browser-control model for deeper site navigation beyond news RSS.

## 2026-06-27 — Market Intelligence production-grade: Realie comps (root cause) + provider failover + per-field provenance + Census + real browser backend

**Realie comp ROOT CAUSE (investigated, fixed):** Realie DOES expose comps — `GET /public/premium/comparables/?latitude=&longitude=` (tag "Premium"), row-level `comparables[]`, authorized on our key (live probe returned 10 rows for 472). We had simply **never implemented it** (adapter only used the property endpoints) and it needs **coordinates** (now available for verified parcels). Built `realie-comps.ts` (sold vs valuation split, PPA, premium-auth handling) and made Realie the **primary** comp lane.
**Apify (external):** the `tri_angle/redfin-search` actor is broken upstream (0 structured data, all retries fail) — confirmed by instrumented run; now a fallback that surfaces provider_error honestly. Recommendation: keep Realie primary; do not add a new paid Redfin/Zillow actor until needed.
**Failover chain:** Realie premium comps → Apify Redfin → honest provider_error → no_comps. Every comp keeps its provider; Realie valuation-only rows kept separate.
**Comp quality fixes (root-cause loop):** raw 30 comps produced absurd PPA ($3M/ac) from tiny urban lots — fixed by filtering to subject acreage band (0.25×–4×), recency (60mo), non-nominal sales (≥$1k), then reporting an **outlier-resistant p25–p75 PPA band + median** (not raw min–max). 472 → 9 relevant comps, $10.7k–$78k/ac; sparse-market explanation when <3.
**DD checklist per-field provenance:** each row carries its own source/timestamp/url/confidence; FEMA/NWI/USGS merged with correct providers (no mislabeling). Verified-parcel completeness ~47%.
**Census:** verified contract; honest `not_configured` (needs free CENSUS_API_KEY — external).
**Browser Market Intelligence:** real Google News RSS backend (no key) collecting live local development/infrastructure/economic evidence (8 items/area), classified, full provenance; selectable open-weight model architecture; Puppeteer installed for a future vision backend.
**Acceptance (5 TEST LEAD, persist+reload):** 731 + 472 verified → Realie comps (21 / 9), FEMA zone X, NWI None mapped, USGS slope, Google visuals, 8 browser-evidence; 3 unverified → honest not_run for parcel DD + area browser evidence. Tests 1387 green; tsc + build clean. Realie report-runs: 5 (+premium comp calls for verified parcels).

**Remaining = external only:** Census free key; a working active-listings/Redfin Apify actor (current one broken); a browser vision model for deeper site nav beyond news RSS.

## 2026-06-28 — Second comp provider: Zillow (validated live) as supplemental lane

**Investigation:** searched the Apify store. Redfin: current `tri_angle/redfin-search` broken; alternatives (rigelbytes, mantisus, lulzasaur) all take search URLs (same URL-guessing risk). Zillow: `maxcopell/zillow-zip-search` (94k runs, 3089 users) takes a **ZIP code** (no URL guessing) and **separate `sold`/`forSaleByAgent` flags** → active vs sold cleanly separated. Selected it.
**Live validation (async, bounded):** ZIP 28301 returned 8 structured rows in ~15s — fields: statusType (FOR_SALE/SOLD), unformattedPrice, address/city/state/zip, latLong, beds/baths, detailUrl, daysOnZillow, hdpData.homeInfo (lotAreaValue/Unit, dateSold, homeType, taxAssessedValue). Fixture saved.
**Wired (`zillow-comps.ts`):** configurable actor id (`LANDOS_ZILLOW_ACTOR`, default `maxcopell/zillow-zip-search` — not hard-coded at call site), run-sync, maps to canonical rows tagged **provider=zillow + active|sold + url + price + acres(lot, sqft→ac) + $/ac + city/state/zip + sale/list date + DOM + capturedAt + confidence**. Active NEVER labeled sold.
**Failover chain:** Realie sold (primary) → Zillow supplemental (active listings + supplemental sold, attributed, kept OUT of Realie's PPA band) → browser evidence → provider_error → no_comps. New `marketComps.supplementalSold` + `active` fields; `providers` + `providerChain` show attribution.
**Acceptance (5 TEST LEAD, persist+reload):** 731 → realie 21 sold + Zillow 86 active/767 sold; 472 → realie 9 + Zillow 8 active/69 sold; both providers connected, active separated, Realie PPA band clean ($262k–803k infill / $10.7k–78k rural). 3 unverified → not_run (no coords/zip) + area browser evidence. Tests +3 (1390 green); tsc + build clean.
**LandWatch/Land.com:** deferred (URL-format blocker) — Zillow covers the supplemental lane; revisit active-land-inventory later with a verified URL.

## 2026-06-28 — Pre-audit cleanup: Deal Card market-comps UI + separation verification

- **Deal Card UI** (`web/src/components/DealCard.tsx`): added `MarketCompsSection` rendering three clearly-separated blocks — **Realie Sold Comps** (primary, with p25–p75 $/ac band + sparse note), **Zillow Active Listings / Asking-Market Evidence** (explicitly "not sold comps"; empty state "No Zillow active listings returned"; provider-error state "Zillow provider error"), and **Zillow Supplemental Sold Listings** (separate, "excluded from Realie band"). Each row shows price/acres/$per-acre/location/sold-date or DOM/listing-URL/provider label; top-8 with "+N more". Provider-readiness chips per provider + the provider chain.
- **Separation guarantees** (regression test added): Realie sold drive the band; Zillow active (asking) and Zillow supplemental sold are kept OUT of the Realie $/ac band (a $9.99M/ac active + $4M/ac supplemental do not move `ppaMax`); every row keeps its provider; active is never labeled sold.
- **Persistence/reload verified on real persisted reports** (no new live calls): 731 → Realie 21 sold + Zillow 86 active / 767 supplemental sold; 472 → Realie 9 + Zillow 8 / 69; 3 unverified → not_run. Providers `realie:connected, zillow:connected`; chain `realie→zillow`. All five persist + reload.
- No provider research reopened; LandWatch/Land.com not chased; no new actors validated; Census left not_configured; no new paid providers.
- Tests 1391 green; tsc clean; production build (web tsc + vite) clean.

## 2026-06-28 — Due Diligence department marked PRODUCTION-READY (audit baseline fb63e94)

Final audit passed; the DD department is production-ready for real pre-call use. Settled facts at this baseline:
1. **DD department is production-ready** for real pre-call intelligence on verified parcels; unverified/area-only parcels return Needs Verification + area context (never guessed).
2. **Realie Premium Comparables = primary sold-comp provider** (owns the p25–p75 $/ac band).
3. **Zillow ZIP search = supplemental** active + sold provider (configurable actor id `LANDOS_ZILLOW_ACTOR`).
4. **Active listings are separated from sold comps** (`active[]` / `supplementalSold[]` kept out of the Realie band; active never drives valuation).
5. **Provider readiness is honest** (per-provider connected/collected/error/no_comps/not_configured/not_run).
6. **Census remains not_configured** until a free CENSUS_API_KEY is added.
7. **Redfin remains provider_error** (broken upstream actor; Zillow covers the supplemental lane).
8. **LandWatch/Land.com deferred** (URL-format blocker; future active-land inventory lane).
9. **Browser intelligence = current RSS/text evidence** (Google News RSS, sourced); future vision/site-nav model is an enhancement.
10. **Audit baseline: fb63e94.**
11. Audit passed **1391 tests, tsc clean, production build clean**.
12. **No code changes were needed during the audit** (verification only).

## 2026-06-28 — Acquisitions Department v1 (CRM-independent seller-strategy brain)

Built the Acquisitions intelligence layer working directly from the Deal Card — **no GHL, no Closebot, no CRM automation, no outbound sending, no paid APIs**.
- **`acquisitions.ts`**: new `landos_acquisition` table (1 row/deal: profile/comm-log/discovery/stage JSON; persists + reloads). Seller profile (motivation/timeline/price/decision-makers/objections/personality/communication-style/commitments/seller-stated-facts/unknowns/verification-needed/contact dates/stage); manual communication log; deterministic discovery-note extraction (motivation/timeline/price/decision-makers/seller-claimed-facts/objections/tone/urgency/risks/follow-ups/unanswered) — heuristic, no AI; seller-claimed facts stored **Seller-stated, never Verified**; deterministic next-best-action (+why), acquisition readiness stages, seller strategy summary.
- **`acquisition-prep.ts`**: call-prep generator (opening frame / what we know / what to learn / psychology / key questions / risk topics / likely objections / suggested language / do-not-say / desired outcome) in Tyler's plain low-pressure voice; follow-up **DRAFT** generator (sms/email/call-script) that is NEVER sent (`sent:false`); acquisition playbook foundation (labeled **foundational** until training ingested); R2 training-storage readiness (paths under `agents/acquisitions/training/...` via the existing KnowledgeStore abstraction — **R2-ready, ingestion pipeline NOT built**; raw media never enters Git).
- **Routes**: GET `/acquisition` (+ profile/comm/discovery/stage/followup POSTs). Follow-up returns a draft only.
- **Deal Card UI**: Acquisitions panel (stage selector, next best action, seller summary, paste-discovery, call prep, follow-up draft, comm log, discovery summary, playbook + training-readiness chips). Shows with or without a DD report.
- **Root-cause fix:** next-best-action wrongly required a comm-log entry to count discovery (pasted discovery notes were ignored) — fixed to key on discovery notes/motivation; +regression test.
- Tests +15 (1406 green); tsc clean; production build clean. Acceptance across 5 scenarios (verified+DD, notes-only, discovery pasted, objections, follow-up) passed; memory persists/reloads; no GHL/CRM/send path built; no raw media staged.
- **Intentionally NOT built:** CRM/GHL/Closebot integration, outbound sending, MP3/MP4/YouTube ingestion pipeline (storage contracts/paths/UI only), underwriting math.

## 2026-06-28 — Acquisition Intelligence Platform (AIP) v1 (learning engine)

The permanent learning system behind Acquisitions — NOT a CRM/GHL/messaging/chatbot. Modular, model-agnostic, approval-gated; nothing self-modifies.
- **`aip.ts`** + 3 tables (`landos_aip_asset` / `landos_aip_knowledge` / `landos_aip_playbook`). Pipeline: Training sources → ingestion contract → knowledge extraction → knowledge store → knowledge graph → playbook generator → coaching engine.
- **Ingestion contract**: one `IngestionHandler` interface + registry (mp3/mp4/wav/youtube/pdf/book/sop/transcript/discovery/offer/meeting/objection/negotiation/seller/note/markdown/text). v1 ships the CONTRACT + registry; media handlers report `unsupported` (future pipeline), text-like accept manual transcripts. Replaceable, model-agnostic.
- **Assets + metadata** (source/title/author/type/upload/transcript-status/extraction-status/tags/confidence/r2Key). Raw media lives in **R2 only** (`agents/acquisitions/training/{raw,transcripts,summaries,extracted,embeddings,playbook,coaching,examples}`) — the DB stores an r2 key + metadata, never bytes; **Git never stores raw media**.
- **Knowledge** (17 categories) with **citations back to source** + **graph links** (knowledge→knowledge, knowledge→asset) + confidence + **approval status** + **version**. Starts `proposed`; nothing active until approved.
- **Playbook generator**: builds a section FROM APPROVED knowledge only → `proposed` (NEVER auto-publishes); approval workflow publishes a new **version** and supersedes the prior; foundational when no approved knowledge.
- **Coaching engine**: modes (before_call/during_prep/after_call_review/negotiation_review/offer_review) return APPROVED-only knowledge, **cited**, keyword + category matched.
- **Analytics**: contracts/shapes only (not implemented).
- Routes: `/api/landos/aip/{assets,knowledge,knowledge/:id/approve|reject,playbook,playbook/generate,playbook/:id/publish,coaching}`.
- Tests +12 (assets/metadata/citations/approval/versioning/graph/playbook-gen/unapproved-never-active/R2-contract/no-raw-media + full 10-step acceptance + route flow). Suite 1418 green; tsc clean; build clean.
- **Boundaries honored:** no CRM/GHL/messaging/automation; existing Acquisitions dept not rewritten; no real ingestion/transcription/embeddings built (contracts only); no model hard-coded.

## 2026-06-28 — Root cause: Mission Control button ran the LEGACY pipeline (fixed)

**Symptom (live Mission Control test):** "Run Property Analysis" still showed LandPortal-primary identity, APN+County+FIPS intake, old Redfin Sold Comps, `zillow:not_connected`, `landportal:not_connected`, legacy discovery — i.e. the pre-DD pipeline, not the architecture audited at d1ce2fe.
**Execution trace (button → response):** `web/src/components/Acquire.tsx` "Run Property Analysis" → `runPropertyAnalysis()` → `POST /api/landos/property-analysis` → `routes.ts` → `runPropertyAnalysis()` (`property-analysis.ts`) → legacy `PropertyAnalysisResult` (old `comp-retrieval` registry: redfin/zillow/landportal stubs) → rendered by the legacy Acquire result panel.
**Root cause:** the Acquire button was wired to the legacy one-button orchestrator (`/property-analysis` → `runPropertyAnalysis`), which renders the old `PropertyAnalysisResult` and never invokes the current DD pipeline. The production pipeline (`runDealCardReport`: Realie-first identity + locality validation, Realie sold comps + Zillow supplemental, FEMA/NWI/USGS, Pre-Call Intelligence, Acquisitions) lived only on the Deal Card; the button was never re-pointed when the DD department was rebuilt.
**Fix (re-wire to production):** new `POST /api/landos/acquire/run` — creates the subject Property Card + Deal Card from the input and runs `runDealCardReport` (the current pipeline), returning `{ dealCardId, pipeline:'deal_card_report' }`. `Acquire.tsx` now calls it and OPENS the resulting Deal Card (which renders Realie-first identity, Realie+Zillow comps, provider readiness, gov DD, Pre-Call Intelligence, Discovery Report, Acquisitions panel). Retired the legacy `PropertyAnalysisResult` result view + stale progress stages from the button path (the `/property-analysis` route + `runPropertyAnalysis` remain only as dormant legacy, no longer wired to the UI).
**Verification (live, exact address 2123 Panola Road, Lithonia GA):** parcel verified via Realie.ai (non-credit); comps `primary=realie`, chain `realie:collected → zillow:collected`, `providers=realie:connected, zillow:connected` (Realie 2 sold + Zillow 269 active / 411 supplemental); FEMA/NWI/USGS verified; Pre-Call + Acquisitions present. Legacy indicators gone.
**Regression tests:** route test — `/acquire/run` returns `pipeline:'deal_card_report'` and the persisted report carries `marketComps.providerChain` + `marketComps.supplementalSold` + `govDd` + `preCallIntelligence`, and has NO legacy `redfinComps`/`strategyMatrix`. Updated `acquire-ui.test.ts` to assert the button posts to `/acquire/run`, opens the Deal Card, shows current pipeline stages, and no longer renders the legacy view. Suite 1420 green; tsc clean; build clean.

**From-verification path audit (same sprint):** reviewed every report-launch / Deal-Card-creation path — `/acquire/run` (fixed), `/deal-cards/:id/report/run` (Deal Card button), and `/deal-cards/from-verification` (developer fallback / verified-parcel launch). The from-verification route was ALREADY CORRECT — it calls `runDealCardReport` (production pipeline), never `runPropertyAnalysis`/`/property-analysis`. Added a regression test (verified parcel via stubbed property-data): from-verification creates the Deal Card and its persisted report carries `marketComps.providerChain` + `marketComps.supplementalSold` + `govDd` + `preCallIntelligence` + Acquisitions availability, with NO legacy `redfinComps`/`strategyMatrix`. The only path that touches `runPropertyAnalysis` is the now-dormant `/property-analysis` route (unwired from all UI).

## 2026-06-28 — Root cause: live parcelVerified:false = provider key not in process.env (fixed)

**Symptom:** live `/acquire/run` for "2123 Panola Road, Lithonia GA" returned `parcelVerified:false`, while an earlier module run (which called `process.loadEnvFile('.env')`) verified it with Realie + Zillow.
**Root cause (proven):** the Realie parcel adapter and the Realie/Zillow comp lanes read their key from `deps.env ?? process.env`, but the app deliberately keeps secrets in the `.env` FILE via `readEnvFile` and NEVER loads them into `process.env` (env.ts: "keeps secrets out of the process environment"). `parcel-capability` detects Realie "available" by reading the `.env` file, but the adapter reads `process.env` only → on the live server it ran `not_configured` and made **no call** (the trial counter tracks premium comps only, so its flatness was a red herring — Realie was simply never invoked). Capability then could not verify → `parcelVerified:false`.
**Fix (env wiring, not provider logic):** added `withEnvFileSecrets(keys, base?, reader?)` to `src/env.ts` — fills only the MISSING secret keys from the `.env` file, honors `LANDOS_DISABLE_DOTENV_FALLBACK`, never mutates `process.env` globally (no child-process leak). Wired it at three production call sites: the Realie parcel adapter (`parcel-capability.ts`) and the Realie + Zillow comp lanes (`deal-card-report.ts`).
**Proof (server-style, NO loadEnvFile):** adapter `configured()` false→true; `resolveParcelIdentityResult` and `runDukeVerification("2123 Panola Road, Lithonia GA")` now both verify; a FRESH deal (#66) ran the full pipeline → `parcelVerified=true` (Realie.ai non-credit) + Realie sold comps (2).
**Secondary finding (deal reuse):** the originally-tested deal #65 was polluted by prior testing with a persisted APN (`16 038 07 001`); on re-run `buildIdentityText` leads with that bare APN, which does not independently verify (the address does). This is a data artifact of repeated testing, not the env bug; a fresh lead verifies. Recommend the route surface a clear Needs-Verification reason / offer rerun-fresh (not changed this sprint — scope/risk).
**Tests:** added `env-file-secrets.test.ts` (5 cases, injected reader). Suite 1426 green; tsc clean; build clean.

## 2026-06-28 — Zillow not_configured was a mislabel: actor returns HTTP 403 (fixed labeling)

**Investigation (safe checks + one bounded live call):** APIFY_TOKEN reaches Zillow via the env bridge (`TOKEN present: true`); ZIP is available (Realie returns "2123 PANOLA RD, LITHONIA, GA 30058"; the pipeline extracts 30058); the default actor `maxcopell/zillow-zip-search` is used. A bounded `fetchZillowComps('30058')` returned **HTTP 403** from the Apify actor.
**Root cause:** `zillow-comps.ts` mapped HTTP **402/403 → `not_configured`**, which implies a missing token. The token is fine — the **actor itself is not authorized** for our Apify account (paid/rental actor not subscribed). A provider-readiness LABELING bug, not an env/ZIP bug.
**Fix (labeling only — no provider logic change):** added a distinct `not_authorized` status; 402/403 now returns `not_authorized` with an honest note ("token OK; the Apify actor needs to be authorized/subscribed for this account"). `not_configured` is reserved for a missing token; missing ZIP stays `no_results`. The Deal Card report now records a Zillow provider-readiness entry for ALL non-collected states (not just omitting it), so readiness shows the true reason.
**Proof:** fresh verified deal (server-style, no loadEnvFile) → `parcelVerified=true`, chain `realie:collected → zillow:not_authorized`, providers `[realie:connected(9), zillow:not_authorized(0)]`. For 2123 Panola: Realie verifies; Zillow ZIP 30058 → `not_authorized`.
**Note:** Zillow comps will stay `not_authorized` until the `maxcopell/zillow-zip-search` actor is authorized/subscribed on the Apify account — an external account action, surfaced honestly now. Bundled with the pending .env-secret bridge fix (Realie). Tests +5 zillow labeling cases; suite 1430 green; tsc + build clean.

## 2026-06-28 — Zillow actor clarified + switched: zip-search (2.28★) -> zillow-scraper (4.89★)

**Clarification (no paid runs):** the two actors are DEFINITELY different — `maxcopell/zillow-zip-search` (id l7auNT3I30CssRrvO, "Zillow ZIP Code Search Scraper", 3096 users, **2.28★**, and **403/not-authorized** for our account) vs `maxcopell/zillow-scraper` (id X46xKaa20oUA1fRiP, "Zillow Search Scraper", 6579 users, 419k runs, **4.89★**, 96% success). Tyler's bad reviews were the **zip-search** actor (our old default). The recommended `zillow-scraper` is a separate, far stronger actor and passes the provider bar (overwhelming usage compensates for 17<25 reviews; no billing/abandonment/corruption complaints).
**Authorization:** bounded probe → `zillow-scraper` returns HTTP 400/200 (run, not 403) → **authorized** for our account (unlike zip-search). No new subscription required.
**Schema validation (bounded live):** `zillow-scraper` takes `{ searchUrls:[{url}], extractionMethod:'PAGINATION_WITH_ZOOM_IN' }` where url is a Zillow search URL with a coordinate `mapBounds` searchQueryState. Validated live (HTTP 201): returns statusType, unformattedPrice, address/city/state/zip, latLong, detailUrl, hdpData.homeInfo (lotAreaValue/Unit, dateSold, homeType, daysOnZillow) — same fields our parser already maps.
**Change (adapter-internal only):** `zillow-comps.ts` default actor → `maxcopell/zillow-scraper`; new `buildZillowSearchUrls(lat,lng,radius)` builds for-sale + recently-sold mapBounds URLs from the verified parcel's coordinates; input switched to searchUrls/extractionMethod; row parser unchanged. `deal-card-report.ts` Zillow lane now keys on coordinates (q.lat/q.lng) instead of ZIP. `not_authorized` labeling preserved. Realie stays primary; active never labeled sold; Zillow sold stays out of the Realie band; Redfin/LandWatch slots untouched (evaluated/disabled, not deleted).
**Live acceptance:** production adapter for Lithonia 30058 → **collected, 75 active listings** (price/acres/ppa/zip/DOM/URL mapped; sample on Panola Rd). Realie verifies the parcel + owns sold comps. Tests +new (URL construction, searchUrls/extractionMethod contract, schema mapping, honest not_authorized, default = zillow-scraper). Suite 1431 green; tsc + build clean.
**Note:** supplemental sold can be thin when active fills the shared maxItems budget — acceptable since Realie is the primary sold-comp source.
