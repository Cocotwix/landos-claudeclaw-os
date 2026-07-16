# LandOS System Repair — Acceptance Matrix (2026-07-14)

Sprint: system-wide Deal Card assembly / readiness / comp-accounting / audit repair.
Acceptance example: 200 Sid Edens Rd, Pickens, SC 29671 · APN 5105-00-44-0497 (deal card 19).
Every fix is shared-service; no property-specific production branch exists (verified by grep).

Legend: PASS = verified in the live rendered dashboard + API. BLOCKED = true external dependency.

| # | Requirement | Shared subsystem | Root cause | Implementation | Test proof | Live proof | Result |
|---|---|---|---|---|---|---|---|
| 1 | Header/description acreage never "?" beside numeric calc acreage | operator record + shared parser | `Number("1.15 ac")=NaN` in routes; no shared parser | `fact-format.parseAcresValue` + routes GET; official assessed outranks provider, both preserved | regression suite (acreage parser, operator record) | final_19_overview.png (1.32 ac (mapped 1.15); description 1.15-acre) | PASS |
| 2 | Geography renders correctly (no "County County") | fact-format formatter, all seams | identity-text round-trip re-suffixed county names | `formatCountyLabel`/`sanitizeGeographySuffixes` at market leg, descriptions, clusters, identity text, read-time repair | regression suite (5 tests) | final_19_overview.png header/description | PASS |
| 3 | One pricing gate; Value/Strategy/Offer readiness agree | strategy-readiness `computePricingGate` | 3 independent gates (registry count, strategy record, exec range) | operator record + strategy readiness + valuation projection + exec summary consume one gate | gate tests + audit tests | card 11 shows blocked everywhere; card 19 open everywhere | PASS |
| 4 | Strategy card never "scoreable" while all 5 blocked | operator record decision card | card keyed off registry count only | consumes shared gate | regression test | final_11_overview.png ("All 5 strategies blocked") | PASS |
| 5 | Offer readiness never advances on a range alone | operator record | derived from valuationReady only | states researching/blocked from gate + research completeness | regression test | card 19 "Offer: researching"; Seller tab "Offer discussion: Not ready" | PASS |
| 6 | Incomplete screening never reads "None surfaced" | operator record red-flag card | empty flag list rendered good | 3-state red flags (found / none-within-completed / review-incomplete) | regression + audit test | final_19: "Critical-risk review incomplete"; card 11: "3 flags (review incomplete)" | PASS |
| 7 | FEMA "not screened" never beside "zones/BFE already screened" | operator record FIRM item | claim rendered when flood lane never ran | claim gated on a flood finding; honest "not run" item added | regression test | card 19 Still Unknown panel | PASS |
| 8 | Market summary never denies validated comps | deal-card-projection `refreshMarketSummary` | static persisted sentence | read-time regeneration from registry comp state | regression + audit test | final_19 Market/Overview | PASS |
| 9 | Valuation cites registry counts; range is IQR, not min/max | `valuationFromRegistry` + `registryValuationStats` | persisted lane median (24) beside 55-comp registry; min/max range absurd | valuation recomputed from validated unique sold set; interquartile band | regression + audit `valuation_registry_count` | final_19 "Sold land comps (55)", range $28,048–$46,390 | PASS |
| 10 | Unsupported valuation suppressed with reasons; observations preserved | `applyPricingGate` | none existed | gate-closed → primary/range null, bases kept, blockers stated | regression test | card 11 valuation banner (conflict, pricing blocked) | PASS |
| 11 | Comp accounting reconciles (raw = unique + duplicates + rejected) | comp-registry | already consistent; never displayed | equation verified live; one compState from registry everywhere | skeptical-review check | 118 = 106 + 10 + 2 (card 19) | PASS |
| 12 | "homeharvest" explained; operator-facing provider names + links | comp-providers registry | raw adapter ids rendered | providerDisplayName across best comps, comp state, registry table | regression tests | final_19 comps "Realtor.com (HomeHarvest)" + view links | PASS |
| 13 | Selected comps show distance + method + score components | selectBestComps + `bestCompsFromRegistry` | no distance source; no components | straight-line distance from coords (persisted + geocode cache), honest "not calculated", exposed score components | regression tests | final_19 comps "1.9 mi (straight-line)", score breakdown | PASS |
| 14 | Top-5 = strongest qualified CLOSED sales only, from unique registry | `bestCompsFromRegistry` | lanes (duplicates, active) fed the shortlist | registry validated sold set only; fewer than 5 when fewer defensible | regression tests | final_19 Best Comparables (5 closed sales) | PASS |
| 15 | Clusters not blended; cluster stats gated | comp-registry clusterAnalysis (pre-existing) + IQR band | — | verified live; cluster panel on Market tab | existing tests | final_19_market (Local acreage clusters) | PASS |
| 16 | Consistency audit actually fails on contradictions (was false 17/17) | deal-card-audit (+8 checks) | audit never compared operator record/exec/narratives to shared records | 25 checks; verified to FAIL on the captured pre-fix payload | 45-test regression suite | card 11 renders failed audit prominently; card 19 25/25 | PASS |
| 17 | Report completeness honest (complete_with_gaps ≠ done) | `classifyReportReadiness` | reportStatus conflated generator finish with research completeness | 4-level classification consumed by header badge | regression tests | badge "Research progress report" | PASS |
| 18 | Parcel confirmation auto-continues into full intelligence mission | routes `ensurePublicIntelligenceMission` | mission was operator-triggered only | auto-start hooks at report/run, acquire, parallel resolution; guarded, background, per-lane statuses | build + live missions | cards 11/14/17/19 lanes evidenced | PASS |
| 19 | Missing downstream research run for current verified properties | public-property-intelligence + jurisdiction adapters | no SC statewide/TN-APN adapters; GET URL limits; county flood zero-feature fallacy | SCDOT statewide SC adapter, TN APN matching, TIGERweb national roads fallback, POST queries, NFHL fallback | live lane outputs | 19: 7/8, 11: 6/8, 17: 6/8, 14: 8/8 | PASS |
| 20 | Seller questions property-specific from missing facts | operator record generator + exec summary | static generic list | gap-driven questions with parcel specifics; exec summary consumes them | regression tests | final_19_seller_v2.png (Sid Edens Rd, zoning-gap question) | PASS |
| 21 | Land Score never decision-positive on incomplete research | operator record reconciled score (pre-existing) + projection | legacy PASS verdict replaced at read time | verified live | existing + regression | card 19/11 Land Score honest | PASS |
| 22 | Accepted operator information never changed silently | migration + operator-confirmation rule | — | card fields untouched (verified in DB); official values preserved side-by-side; discrepancies flagged | DB check | cards 11/19 property rows unchanged | PASS |
| 23 | Existing unresolved cards remain safe; new unresolved gated | resolution view (pre-existing) | — | verified live | routes tests | final_20_overview.png (Resolution pending, downstream on hold) | PASS |
| 24 | Full suite, typecheck, build, diff-check | — | — | — | 3209/3209 pass; tsc clean; vite+tsc build clean; git diff --check clean | — | PASS |
| 25 | Zoning lane for Pickens SC / imagery for non-registry counties | county capability registry | county publishes no public zoning/orthophoto ArcGIS layer found | honest `unavailable` with reason; new counties plug in as registry entries | — | card 19 "Zoning: Not screened / has not run" | BLOCKED (external) |
| 26 | Wetlands federal fallback (NWI) | USFWS service | national NWI service outage during sprint ("Service not started") | county-layer lane works (Pickens/Beaufort); federal retryEligible | — | card 11/17 wetlands unavailable w/ reason | BLOCKED (external, transient) |
| 27 | Official parcel adapters for TX/GA/FL/AL/AR | jurisdiction adapters | no tested statewide/public adapter yet for those states | honest 409 + attempted trail; adapters plug into `lookupOfficialParcel` | — | mission blocker recorded | BLOCKED (external until adapters added) |

## Discrepancies awaiting Tyler (operator-confirmation rule — nothing changed silently)

1. **Deal card 11 (Henson Lane, Scott County TN, APN 094-020.08):** official statewide parcel
   record (PARCELID 076 094 02008 000 2026) reports owner EIGHINGER DANIEL B ETUX and 5.12 ac;
   the card's working values are owner LAND JAMES ROBERT and 0.98 ac (LandPortal-era resolution).
   Both preserved; audit deliberately FAILS (displayed vs calculation acreage) and the Overview
   shows the conflict banner. Tyler must confirm the correct parcel/owner before the card's
   accepted values change.
2. **Deal card 19 (200 Sid Edens Rd, Pickens SC, APN 5105-00-44-0497):** official assessor lists
   1.32 assessed acres; LandPortal + GIS geometry report ~1.15 ac. Below the hard-conflict
   threshold; both shown ("1.32 ac (mapped 1.15)"); calculations use the mapped/provider 1.15.
   Tyler should confirm which acreage is accepted for valuation reliance.
