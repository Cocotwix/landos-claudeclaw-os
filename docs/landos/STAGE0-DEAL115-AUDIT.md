# Stage 0 — Read-only audit: Deal 115 subject/market divergence + Market Data Context

Read-only. No code, config, DB, UI, provider or skill changes. No research reruns,
no Deal Brain invocation, no external calls. Evidence is live repository source at
`main` (7737ac7) plus SELECT-only reads of `store/landos.db` and the managed
runtime status.

Control case: Deal Card **115**, `/dept/acquisitions/v2?deal=115`,
19554 NW 137th Ln, Lake Butler, FL 32054, APN `00083A03400`, Bradford County FL
(FIPS 12007), ZIP 32054.

---

## 1. Data-flow diagram (as built)

```
RAW LEAD  landos_deal_card.seller_notes  (verbatim, preserved)
   |
   +-> landos_deal_card_property -> landos_property_card #96
   |      apn, county, state, city, zip, lat/lng, verification_status
   |      acres = NULL                                   <-- (A)
   |
   +-> landos_property_identity_version v1 candidate -> v2 confirmed
   |      apn, address, geometry_json, basis, confidence
   |      acreage = NULL on BOTH versions                <-- (A)
   |
   +-> POST /property-intelligence/run  (operator button, routes.ts:12781)
          |
          +-> collectors -> landos_property_evidence_item (37 rows)
          |     assessor_gis / "GIS mapped acreage"      = 1.846  official_county_state
          |     assessor_gis / "Parcel-record acreage"   = 1.5    provider_record
          |     assessor_gis / "LandPortal calculated acreage" = 1.84
          |
          +-> landos_card_activity kind=property_inspection (card 96)
          |     parcelFacts.Acres = "1.500", parcelFacts["Calc Acres"] = "1.84"
          |
          +-> landos_public_intelligence_run #273  status=complete_with_gaps
          |     payload keys: status,downstreamAllowed,gate,captureMode,
          |                   tasks,nonBlockingGaps
          |     NO countyRecords finding                 <-- (B)
          |
          +-> landos_deal_intelligence_snapshot x9 (zoning, backstory, summary...)
          +-> landos_property_intelligence_specialist x12

TWO READ FAMILIES DIVERGE HERE
   |
   |-- EVIDENCE PROJECTION  (header)
   |     GET /deal-cards/115/evidence/interpretation -> evidenceRead.acreage.workingAcres
   |     GET .../property-intelligence -> propertyIntelligence.evidenceAcreage
   |     AcquisitionWorkspaceV2.tsx:836-841  =>  header shows 1.5 AC
   |
   `-- CANONICAL PROJECTION  (Property / Strategy / Market / Valuation / Comps)
         property-intelligence-live.ts:1405 operatorRecordFor()
           assessedAcres = num(property.acres)                  -> NULL   (A)
           mappedAcres   = factNumber(countyRecords,'GIS mapped acreage') -> NULL (B)
           providerAcres = parcelFacts.Acres, gated on hasVerifiedLandPortalSubject
         operator-property-record.ts:563 buildAcreageBasis({...all null...})
         acreage-basis.ts:219 governingAcreageOf() -> { value: null }
         canonical-subject-state.ts:119 governingAcreageFor() -> null
           => "The subject acreage is not established"

MARKET
   routes.ts:4675 marketContextFor(deal)
     acres = (typeof pc.acres === 'number' && pc.acres > 0) ? pc.acres : null   -> NULL
   property-market-context.ts:546 propertyMarketContextFor()
     subjectBandKey = null -> subjectBand.available = false
     fastestBand    = max(sellThroughRate) over county bands -> 10-20 (131.25%)
   AcquisitionWorkspaceV2PropertyIntelligence.tsx:586-590
     [subjectBand, fastestBand].filter(available).map((r, index) =>
        index === 0 ? 'Subject band' : 'Most liquid band')
     => fastestBand becomes index 0 and is LABELLED "Subject band: 10-20 acres"
```

---

## 2. Answers to the Stage 0 questions

### Q1/Q2 — Who holds and who writes subject facts

| Fact | Store | Writer | Consumers |
|---|---|---|---|
| APN, address, county, state, zip, lat/lng | `landos_property_card` | `property-card.ts:448`, `lead-card-intake.ts:381` | header, `marketContextFor`, `operatorRecordFor`, comps |
| Versioned identity + geometry + provenance | `landos_property_identity_version` | `createPropertyIdentityVersion` (property-resolution-engine, public-property-intelligence, `official-acreage-run.ts:280`) | `canonical-identity.ts`, `canonical-subject-state.ts` |
| **acres** on the card | `landos_property_card.acres` | **one writer only**: `official-acreage-run.ts:276`, and only when `decision.status` is `resolved_current_canonical` / `resolved_current_vs_historical_extent` **and** `decision.canonicalChanged` | everything canonical |
| Typed acreage evidence | `landos_property_evidence_item` (domain `assessor_gis`) | collectors `assessor_gis`, `landportal_parcel_panel` | evidence projection / header only |
| Provider parcel facts | `landos_card_activity` kind `property_inspection` (JSON `ref`) | LandPortal capture | `loadPropertyInspection` (`property-card.ts:1411`) |
| Screening findings | `landos_public_intelligence_run.payload_json` | public-intelligence orchestrator | `buildOperatorPropertyRecord` |
| Governing acreage conclusion | derived, not stored | `acreage-basis.ts:229 buildAcreageBasis` -> `:219 governingAcreageOf` | Property, Strategy, Valuation, Subdivision, Market |

Write order for Deal 115: card + identity v1 (intake/preflight) -> evidence items +
inspection activity + public-intelligence run -> identity v2 confirmed -> nine
derived snapshots. **Acreage is never written back to the card or the identity
version**, because the only writer (`official-acreage-run`) is reachable only from
an operator-triggered acreage-extent reconciliation (`POST /acreage-extent/reconcile`,
`routes.ts:11648`) that has never run for this deal — there is no acreage-extent
record for 115.

### Q3 — Header 1.5 AC vs "acreage not established"

Two competing precedence chains, both live:

- **Header** — `AcquisitionWorkspaceV2.tsx:836-841`:
  `acreageDecision.canonicalAcres ?? evidenceRead.acreage.workingAcres ??
  firstPaintAcreage.workingAcres ?? id.acres ?? propertyCards[0].acres`.
  The first is absent (no reconciliation), so it lands on the **evidence-item
  projection**, which holds `Parcel-record acreage = 1.5`. Header prints 1.5 AC.
- **Everything canonical** — `operatorRecordFor` (`property-intelligence-live.ts:1427-1430`)
  feeds `buildAcreageBasis` from three inputs, all null here: `property.acres`
  (NULL), the run's `countyRecords['GIS mapped acreage']` (the run payload has no
  `countyRecords` key at all), and `parcelFacts.Acres` gated behind
  `hasVerifiedLandPortalSubject`. `governingAcreageOf` returns `{value: null}`,
  and these strings render verbatim: `property-intelligence-valuation.ts:198`
  ("Not priceable: The subject acreage is not established"),
  `subdivision-property-read.ts:197`, `land-use-yield.ts:238`,
  `comps-valuation-capability.ts:281`.

Persisted proof (`landos_property_intelligence_specialist`, deal 115):
`valuation` = partial, "Not priceable: The subject acreage is not established";
`strategy` = partial, "no path is applicable yet (posture: hold) … The subject
acreage is not established."

**Root cause:** two generations of evidence storage. New collectors write typed
rows to `landos_property_evidence_item`; the canonical acreage builder still reads
only the legacy `PublicIntelligenceRun` findings shape plus `property_card.acres`.
Nothing promotes evidence-store acreage into the canonical subject record.

### Q4 — Market shows a 10–20-acre band for a 1.5-acre subject

Four stacked causes; the last is decisive.

1. `marketContextFor` (`routes.ts:4697`) reads acreage **only** from `pc.acres` —
   the NULL column — never from the evidence projection the header uses. So
   `acres = null`.
2. With `acres = null`, `propertyMarketContextFor` sets `subjectBandKey = null`
   and `subjectBand.available = false` (`property-market-context.ts:588-595`) —
   correct, honest behaviour.
3. `fastestBand` is computed independently (`:597-602`) as the county band with
   the highest sell-through. Bradford County bands (via the MR bridge):
   0-1 70.37 / 1-2 71.43 / 2-5 83.33 / 5-10 52 / **10-20 131.25** / 20-50 36.36 /
   50-100 0 / 100+ 100. So `fastestBand = 10–20 acres`.
4. **The defect:** `AcquisitionWorkspaceV2PropertyIntelligence.tsx:586-590`
   builds `[market.subjectBand, market.fastestBand]`, **filters out unavailable
   records, then labels by array index**. With `subjectBand` filtered away,
   `fastestBand` lands at index 0 and renders under the heading **"Subject band"**
   showing **"10–20 acres"**. Nothing upstream claims the subject is 10–20 acres;
   the label is an index artefact.

Secondary latent trap, not the cause here: `acreageBandForAcres`
(`market-matrix-read.ts:373-380`) maps **any** acreage below 5 — and `null` — to
`2-5`. A 1.5-acre subject is therefore requested against the 2-5 band even though
`landos_mr_metric` holds a real `1-2` record for both the county and the ZIP.
`acreageBandsForAcres(1.5)` appends `1-2` as a secondary so the resolver can still
reach it, but the requested band and its operator label stay wrong.

### Q5 — Triggers, and why nothing settles

| Outcome | Trigger | Automatic? |
|---|---|---|
| Research collection | `POST /deal-cards/:id/property-intelligence/run` (`routes.ts:12781`), from `AcquisitionWorkspaceV2RunStatus.tsx:215` | operator button |
| Acreage reconciliation | `POST /acreage-extent/reconcile` (`routes.ts:11648`) | operator button |
| Property/Market/Seller/Deal products | `POST /intelligence/run` (`routes.ts:11416`) -> `runIntelligenceStack` (`intelligence-stack.ts:635`) | operator button |
| Chained cycle | `runResearchCoverageCycle` -> reconcile -> backfill -> `cascade: runIntelligenceStack` (`routes.ts:12652`) | **exists**, and did run for 115 |
| Deal Brain | `POST /deal-brain` **requires an operator `message`** (`routes.ts:11804`); `/deal-brain/refresh` only refreshes an already-retained synthesis | manual only |

Deal 115's chained coverage run (`run_id = coverage_115_mthit0r3`) started
2026-08-31T17:36:49Z and **failed at its first stage** (`preparing`) with
`"The Intelligence run no longer has an active owner. Re-run it to continue."`
That string comes from `intelligence-stack-run-store.ts:186 reclaimAbandoned`,
whose predicate is `status='running' AND authoritative=1 AND (started_at <
PROCESS_STARTED_AT OR updated_at < cutoff)` — i.e. **any managed restart
terminally fails an in-flight Intelligence run**, with no resume path.

Result: `landos_deal_intelligence_snapshot` holds nine *research* snapshots but
**zero** `property_intelligence_v1` / `market_intelligence_v1` /
`seller_intelligence_v1` / `deal_intelligence_v1` products;
`landos_deal_brain_guidance` is empty; `landos_deal_card_market` and
`landos_deal_card_strategy` are empty. Research completing is not wired to an
operator outcome, and the cascade that would do it is fragile and, on this deal,
dead.

### Q6 — Reusable capabilities (all present, all working)

Subject interpretation: `smart-intake.ts`, `intake-planner.ts`,
`conversational-lead-intake.ts`, `property-resolution-engine.ts`,
`universal-property-resolution.ts`, `canonical-identity.ts`,
`canonical-subject-state.ts`, `apn-identity.ts`.
Documents/survey: `document-uploads.ts`, `document-registry.ts`,
`official-document-intelligence.ts`, `pdf-text.ts`, `survey-boundary-segments.ts`.
Visual: `visual-intelligence.ts`, `imagery-capture.ts`,
`google-visual-capture.ts`, `visual-buyer-analysis.ts`, `parcel-visual-framing.ts`.
Records: `government-records-adapters.ts`, `county-assessor-search.ts`,
`arcgis-adapter.ts`, `official-parcel-gis-run.ts`, `public-record-access.ts`,
`assessor-tax-capability.ts`.
Market: `market-matrix-read.ts`, `market-matrix-store.ts`,
`market-research-store-bridge.ts`, `property-market-context.ts`, `market-pulse.ts`.
Zoning/subdivision: `zoning-subdivision-capability.ts`, `land-use-*`,
`subdivision-regulations.ts`, `current-zoning-determination.ts`,
`jurisdiction-resolution.ts`.
Valuation: `comps-valuation.ts`, `comp-orchestrator.ts`, `dual-exit-valuation.ts`,
`quick-flip-screen.ts`.
Seller: `seller-stated-facts.ts`, `seller-communication-evidence.ts`,
`discovery-call-report.ts`, `pre-call-intelligence.ts`.
Synthesis: `intelligence-stack.ts`, `acquisition-analyst.ts`,
`deal-brain-guidance.ts`, `acquisition-intelligence-dossier.ts`.
Nothing new is needed for Stage 1.

### Q7 — Smallest safe path to one authoritative subject

Promote acreage into the canonical record where it is already proven, and collapse
the two divergent read chains. See section 5.

---

## 3. Market Data Context reference

Two stores, one bridge.

| | `landos_market_snapshot` (Market Matrix) | `landos_mr_*` (Market Research collection) |
|---|---|---|
| Rows | 937 | `mr_metric` 318,729 across `mr_geography` 35,684 |
| Grain | `snapshot_key = geo_level:key\|band\|side\|period` (UNIQUE) | `mr_metric(snapshot_id, geography_id)` |
| Geography keys | county FIPS / state / ZIP columns | `mr_geography.geo_key` = `county:FIPS` / `state:XX` / `zip:NNNNN`; 3,138 county + 51 state + 32,495 ZIP |
| Coverage | GA 159 counties, SC 46, AL 3, TN 2, NC 1, NY 1; ZIP GA 71 / SC 384 / NY 28; **state rows: SC and GA only** | **national**, all bands |
| Bands held | `2-5` (705 rows) nearly everywhere; the full nine-band set exists for **NY only** | all nine bands per geography (snapshots 3–11) |
| Precedence | Matrix wins its `(period, side, band)` slot; the bridge fills only gaps (`market-matrix-store.ts:466-468`) | fallback source |

**Florida coverage in the Matrix table is zero** — no FL state row, no FL county
row, no FL ZIP row. Every Bradford / 32054 number on Deal 115 reaches the UI
through `mrBridge*` off `landos_mr_metric`.

**Acreage bands.** `ACREAGE_BANDS = all, 0-1, 1-2, 2-5, 5-10, 10-20, 20-50,
50-100, 100+, 50+` (`market-matrix.ts:78`). Spans in `ACREAGE_BAND_SPAN`
(`market-matrix-read.ts:384`) are `[min, max)`; `50+` / `100+` deliberately
overlap `50-100` / `100+`. `acreageBandForAcres` (`:373`): `<= 0` or `null` ->
`2-5`; `< 5` -> `2-5`; `< 10` -> `5-10`; `< 20` -> `10-20`; `< 50` -> `20-50`;
else `50+`. **Edge trap: `0-1` and `1-2` are unreachable as a primary band**, so
every sub-2-acre subject requests `2-5`. `acreageBandsForAcres` (`:403`) repairs
containment by appending genuinely containing bands narrowest-first
(`1.5 -> ['2-5','1-2']`). **UI disclosure gap:** when no containing band matches,
`property-market-context.ts:590-595` writes an honest "no unrelated band was
substituted" note, but the workspace panel never renders it — unavailable records
are dropped entirely (see Q4.4).

**Resolution rungs** (`market-matrix-read.ts:304-360`), narrowest first:
ZIP by band -> county by band -> county `all` -> ZIP `all` -> state -> thinnest
retained row -> unavailable. A rung is accepted only if `carriesRealActivity`
(`:283`): `salesCount > 0` **and** at least one of `medianPricePerAcre`,
`medianPrice`, `daysOnMarket`, `salesCount` is non-null. Rejected rows are kept in
`thin[]`; the narrowest is returned last with an explicit "recorded no sales
activity in the period" note.

**Metrics** (`metrics_json` and `mr_metric.metrics_json`, identical shape):
`salesCount, listingCount, medianPrice, medianPricePerAcre, daysOnMarket,
sellThroughRate, absorptionRate, monthsOfSupply, population, populationDensity,
populationGrowth, salesDensity`. All are provider-computed by LandPortal Market
Research (Drill Deep); LandOS does not recompute them. `sellThroughRate` is
sold ÷ listed and **legitimately exceeds 100%** on thin inventory (Bradford 10-20
= 131.25%, Cayuga NY = 130.86%); such rows carry an explanatory `flags_json`
entry rather than being rejected.

**Filters and lineage.** `mr_snapshot.filters_json` is fixed at
`{status: sold, propertyType: land, lookbackMonths: 12, acreageBand: <band>}` —
**vacant land only, sold side, trailing 12 months**. `side='for_sale'` exists in
the matrix table but holds only 2 rows, so `buildMarketLiquidity` has essentially
no competition data outside those. Periods: matrix 2026-Q1..Q3; collection 2026-Q3
(with 2026-Q1/Q2 stubs of 1 and 7 rows). `collected_at` spans 2026-07-01 ..
2026-07-20; `mr_metric.observed_at` is per-geography.

**Known quality caveats.**
1. All eleven `mr_snapshot` rows are `status='collecting'` — none was ever marked
   complete. The bridge reads them anyway; nothing distinguishes a finished
   collection from an abandoned one.
2. `landos_mr_zip_county` (44,977 rows) is the ZIP -> FIPS map; a ZIP spanning
   counties resolves to a single FIPS.
3. ZIP rows frequently carry `salesCount: 0` alongside **non-null medians**
   (32054 `2-5`: 0 sales, median $55,896) — a wider-window or stale median beside
   a zero count. `carriesRealActivity` correctly rejects these, but any consumer
   reading `metrics_json` directly will print a price for a market with no sales.
4. Staleness is derived from `period` vs `currentPeriod()`, not from `collected_at`.
5. No dedupe / outlier / cancelled / expired filter is applied at read time; the
   only quality gate is `landos_market_review_queue` at ingest.

---

## 4. Root-cause hypotheses, ranked, with evidence

**H1 (confirmed).** Acreage is proven in `landos_property_evidence_item` and in
the inspection `parcelFacts`, but is never promoted to `property_card.acres` or
`property_identity_version.acreage`, because the sole writer
(`official-acreage-run.ts:276`) is reachable only from an operator-triggered
acreage-extent reconciliation. Evidence: both acreage columns NULL; three acreage
evidence rows present; no acreage-extent record for 115.

**H2 (confirmed).** `operatorRecordFor` builds the canonical acreage basis from
the legacy `PublicIntelligenceRun` findings shape, but run #273's payload is the
newer task/gate shape with no `countyRecords` key, so `mappedAcres` is null even
though `GIS mapped acreage = 1.846` (official) sits in the evidence store.

**H3 (confirmed).** `marketContextFor` (`routes.ts:4697`) reads acreage only from
`pc.acres`, bypassing every other acreage source in the system.

**H4 (confirmed).** `AcquisitionWorkspaceV2PropertyIntelligence.tsx:586-590`
labels band cards by post-filter array index, so an unavailable subject band
silently promotes the fastest-selling band into the "Subject band" slot.

**H5 (confirmed).** `acreageBandForAcres` maps every acreage below 5 acres, and
`null`, to `2-5`, making `0-1` and `1-2` unreachable as a primary request despite
full national data for both.

**H6 (confirmed).** `reclaimAbandoned` terminally fails any Intelligence Stack run
in flight across a managed restart, with no resume — which is why Deal 115 has
research snapshots but no intelligence products and no Deal Brain.

---

## 5. Smallest Stage 1 change list (proposed, not authorized)

1. **One acreage promotion path.** Extend the existing evidence -> canonical
   promotion so a confirmed acreage evidence row writes `property_card.acres`
   plus `property_identity_version.acreage` through the existing
   `createPropertyIdentityVersion` path, using the existing `buildAcreageBasis`
   precedence (operator > survey > deed > assessed > GIS > provider). No new
   store, no new engine. Files: `official-acreage-run.ts`,
   `property-intelligence-live.ts`, `canonical-subject-state.ts`.
2. **Teach `buildOperatorPropertyRecord` the current evidence shape.** Feed
   `assessed` / `gisGeometry` / `provider` from `landos_property_evidence_item`
   when the legacy `countyRecords` finding is absent.
   File: `property-intelligence-live.ts:1420-1431`.
3. **One acreage read for Market.** `marketContextFor` takes acreage from the
   canonical subject state (`governingAcreage.value`) instead of `pc.acres`.
   File: `routes.ts:4675-4699`.
4. **Label band cards by role, not index.** Render `subjectBand` and `fastestBand`
   as named slots; when `subjectBand` is unavailable, show its existing honest
   note instead of promoting another band.
   File: `AcquisitionWorkspaceV2PropertyIntelligence.tsx:583-601`.
5. **Make sub-2-acre bands reachable.** `acreageBandForAcres` returns `1-2` for
   `1 <= acres < 2` and `0-1` for `acres < 1`; keep `null -> 2-5` as the
   documented default and keep `acreageBandsForAcres` containment ordering.
   File: `market-matrix-read.ts:373-380`.
6. **Header stops being a second precedence chain.** Once (1)–(3) land, collapse
   `AcquisitionWorkspaceV2.tsx:836-841` to the canonical governing acreage, with
   the evidence projection retained only as a labelled "working figure, not yet
   adopted".

Deferred, recorded not built: Intelligence-run resume across a managed restart
(H6); automatic Deal Brain production; Market Matrix Florida ingestion.

---

## 6. Proposed acceptance fixture

`deal115-subject-acreage-contract` — a fixture Deal Card carrying APN
`00083A03400`, Bradford County FL, ZIP 32054, an evidence-store acreage triple
(1.5 parcel-record / 1.84 provider / 1.846 official GIS), a NULL
`property_card.acres`, and a Market Research county band set whose fastest-selling
band is 10-20. It asserts, in one test:

1. `canonicalSubjectState(115).governingAcreage.value` is a single named number
   with its basis stated.
2. The header acreage and `propertyIntelligenceValuation`'s subject acreage are
   the same number.
3. `propertyMarketContextFor` returns `subjectBand.acreageBand === '1-2'` and
   `fastestBand.acreageBand === '10-20'` as distinct records.
4. The workspace band panel renders "Subject band — 1–2 acres" and
   "Most liquid band — 10–20 acres"; when `subjectBand` is unavailable it renders
   that record's unavailability note rather than promoting `fastestBand`.
5. Strategy and Valuation no longer emit "The subject acreage is not established".

Browser visual acceptance does not apply to Stage 0: nothing was built, so there
is no changed operator-visible behaviour to verify. It applies in full to Stage 1.
