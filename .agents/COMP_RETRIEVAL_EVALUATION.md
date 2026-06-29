# LandOS DD — Open-Source Comp Retrieval Evaluation

Decision document for reducing/replacing the paid Apify lane, per
`land_comps_and_listings_resources.md`. Every option in that document is
evaluated below with an explicit ACCEPT / REJECT / DEFER and the reason.

Root principle: build a provider-agnostic retrieval + classification engine that
improves every property. Apify is now OPTIONAL, not the default.

## Architecture context

- The comp engine is provider-agnostic: `comp-retrieval.ts` defines `CompProvider`
  + `retrieveComps`; `register-live-providers.ts` is the gated swap point.
- Classification is centralized in `comp-classification.ts` and applied at the
  valuation seam by `comp-valuation-band.ts` (raw-land-only band, acreage filter,
  IQR outlier trim). Any provider's rows are protected the same way.
- Live lane order today: Realie (primary, row-level, authorized) → HomeHarvest
  (open-source land/farm sold + active) → Apify Redfin (optional fallback) →
  Zillow (supplemental active + supplemental sold). All classified at the seam.

## Evaluations

| Tool / Source | Decision | Why |
|---|---|---|
| **HomeHarvest** (Realtor.com) | **ACCEPTED — wired live** | MIT, no API key, nationwide, dedicated `land`/`farm` type, radius search, sold+active, recency window. Verified live: 46–60 land sold + 56–60 land active per acceptance address. Now the primary open-source lane (`providers/homeharvest-comp-provider.ts` + `scripts/homeharvest_bridge.py`). Strongest single Apify replacement. |
| **reteps/redfin** | **DEFER** | MIT, no key, `similar_sold()` / `nearby_homes()` are useful, but Redfin sold is already covered by the existing Apify two-stage provider AND HomeHarvest. Marginal added coverage vs new maintenance. Hold as a future free Redfin lane if Apify is dropped entirely. |
| **ryansherby/RedfinScraper** | **REJECT (for now)** | Bulk ZIP/city collection is aimed at dataset building, not per-subject comp pulls. Our flow is subject-centric (radius around one parcel). Revisit only for batch market-stats jobs. |
| **PropertyWebScraper** | **DEFER** | Multi-portal, self-hostable, REST API. Powerful but requires standing up a separate Astro/Cheerio service (hosting + maintenance). HomeHarvest covers the same Realtor.com data with zero infra. Reconsider if we need Zillow/portal coverage HomeHarvest lacks. |
| **land-com-scraper** | **DEFER → likely ACCEPT for 40+ ac** | Land.com is the national marketplace for farms/ranches/large acreage — exactly the gap HomeHarvest/Redfin are thin on. Strong candidate for the LandWatch/large-acreage slot (already a stubbed provider id). Build when a large-acreage subject needs it. |
| **OpenAVMKit** | **DEFER (valuation modeling, not retrieval)** | AGPL-3.0. Not a comp source — it's a mass-appraisal modeling toolkit (LightGBM/XGBoost/GWR) over data you already have. Our valuation is a transparent raw-land PPA band, deliberately explainable for an operator. OpenAVMKit is a future heavy-valuation option, not a Phase-1 retrieval need. AGPL also warrants a license review before shipping. |
| **USDA NASS Quick Stats API** | **ACCEPT — backlog (next)** | Free (key), authoritative county/state agricultural land $/acre. Ideal benchmark for FARM-class subjects and a sanity check on farm comps. Wire as a free gov benchmark in Market Pulse. |
| **BLM GLO Records** | **REJECT** | Federal land title/patent history (western US). Ownership-history research, not comps or current market value. Out of scope for valuation. |
| **OpenAddresses** | **DEFER (parcel geometry, not comps)** | Free cadastral parcel boundaries — relevant to the Visual Context / parcel-boundary work, NOT comp retrieval. Tracked under the Visual Context / parcel-boundary item, not here. |
| **County ArcGIS REST APIs** | **DEFER (per-county, high effort)** | Free and authoritative, but each county has a distinct endpoint/schema — nationwide coverage is a large per-jurisdiction mapping effort. Best used surgically for parcel geometry + verification, not as the primary comp engine. Some scaffolding exists in `providers/gov-dd-providers.ts`. |
| **RESO Web API** | **REJECT (no credentials)** | The proper MLS standard, but requires IDX/RETS credentials we do not have. If Tyler obtains brokerage MLS access, this becomes the highest-quality lane. Not available today. |
| **SimplyRETS** | **REJECT (needs MLS feed)** | Open-source connector, but the data feed still requires MLS credentials. Same blocker as RESO. |

## Net effect on Apify dependence

- HomeHarvest now supplies open-source nationwide land/farm sold + active rows on
  every DD run (gated off via `LANDOS_HOMEHARVEST=off`; skipped automatically
  under test).
- Apify Redfin is demoted to an OPTIONAL fallback. It is no longer required for
  the comp engine to function; if its actors are unconfigured the engine still
  produces a classified, acreage-filtered band from Realie + HomeHarvest.

## Backlog (in priority order)

1. USDA NASS farm-land $/acre benchmark in Market Pulse (free, authoritative).
2. land-com-scraper for the 40+ acre / rural marketplace slot.
3. reteps/redfin as a free Redfin lane if Apify is fully retired.
4. OpenAddresses + County GIS parcel geometry for Visual Context boundaries.
5. OpenAVMKit only if a heavier, modeled AVM is ever required (AGPL review first).
