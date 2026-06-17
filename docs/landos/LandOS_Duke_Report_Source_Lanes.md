# LandOS — Default Duke Report Source Lanes v1

How the default Duke dashboard report is produced: a lean, token-efficient set
of **source lanes** with a single **Verification Captain**. A slow LandPortal
call (up to a 3-minute ceiling) never collapses the report into a thin failure.

Implemented in `src/landos/duke-report-lanes.ts` (pure orchestration), consumed
by `src/landos/duke-report-runner.ts`. No network/agent/tokens/comp credits in
the lane layer itself.

---

## Lanes (default report)

1. **LandPortal Exact Search** — *verification authority.* Exact APN / owner +
   county-state / owner + FIPS / APN + county-state-FIPS / address. **Up to a
   3-minute ceiling** (`LANDPORTAL_VERIFICATION_TIMEOUT_MS`). Timeout → lane
   status `timeout` (never a whole-report collapse). Uses the strengthened
   APN/owner exact-search fallback; no coordinates/proximity/point/geocoder.
2. **Local Area Data** — quick, compact, **non-verifying** market snapshot. When
   unverified it leads with the label **"Local Area Context, Not Parcel
   Verified"** and emits a compact snapshot: area name, annual growth (typed +
   sourced, or `unavailable`), active land listing count + source, sold land
   (last 6 months) count + source, a plain-English market read, a market source
   status (`success | partial | not_available`), and the next action to verify
   identity. It fetches nothing on its own and never invents a count — missing
   data is labeled `unavailable from current default sources`, not guessed. Not a
   deep county-government lane.

   **Land-count source order** (`MARKET_COUNT_SOURCE_PRIORITY`,
   `selectPreferredMarketCount`): Redfin → Zillow → local MLS public search →
   county/local public listing portal → Realtor.com land search → LandWatch
   market listings → `unavailable`. Counts are land-specific only (never home
   sales presented as land), every count carries its source, fallback sources are
   labeled as themselves (never relabeled Redfin/Zillow), and a blended count is
   shown only when explicitly marked with all sources listed. These counts are
   market context only when the parcel is unverified — none can verify identity.
3. **Verification Captain** — final decision. Consumes **only** the LandPortal
   lane (and, when implemented, official county/assessor/GIS exact records).
   Never verifies from local area / Redfin / Zillow / LandWatch / visuals / map
   pins / coordinates. Sets `parcelVerified` and blocks comps/score/valuation/
   offer/strategy when unverified.
4. **Redfin/Zillow Comps** — market context, **only after** verification. Cannot
   verify identity. No LP comp credits. Unimplemented source → `not_available`
   with a next action (no fake comps).
5. **LandWatch** — large-acreage market context, **only after** verification AND
   verified acreage **over 50 acres** (`LANDWATCH_MIN_ACRES`). ≤ 50 ac →
   `skipped`. Cannot verify identity or override official acreage/APN/owner.
6. **Strategy / Offer** — score/strategy/valuation/offer, **only after**
   verification. Preserves distinct strategy bands and minimum net profit rules
   ($10,000 baseline; $30,000 subdivision). A concrete offer needs Expected
   Value from a comp source.

---

## Source authority

| Lane | Can verify parcel identity? |
|---|---|
| LandPortal Exact Search | **Yes** (exact only) |
| Verification Captain | **Yes** (decides; consumes exact sources only) |
| Official county/assessor/GIS exact records (future) | Yes (exact APN/address/owner only) |
| Local Area Data | No |
| Redfin/Zillow | No |
| LandWatch | No |
| Visuals / map pins / coordinates / Street View / satellite | **Never** |

If identity is not verified the report stays **"Local Area Context, Not Parcel
Verified"** and produces no score/value/comp/offer/strategy.

---

## County Deep Dive (on-demand, second layer)

Run **only when Tyler asks** — never part of the default report. Covers assessor,
tax, GIS, planning/zoning, health/septic, roads/public works, utilities,
permits, HOA/POA, and the title/legal checklist (`COUNTY_DEEP_DIVE_CHECKLIST`).

---

## Lane result contract

Each lane returns: `laneId`, `laneName`, `status`
(`success | blocked | timeout | not_available | skipped | failed`), `sourceType`
(`landportal | local_area | verification | redfin_zillow | landwatch | strategy`),
`canVerifyParcel`, `parcelVerificationAuthority`, `verifiedParcelIdentity`,
`findings`, `warnings`, `blockingReason`, `nextAction`, `durationMs?`, and
`compCreditUsed` (false by default).

---

## Future expansion path

The lane orchestrator is synchronous and pure today. It is the seam for a future
**async / sub-agent** expansion: each lane could become an independently queued
task (mission-style) whose result re-enters this same contract, with the
Verification Captain still the single exact-only authority and comps/strategy
still gated on verification. No async queue or sub-agent fan-out is built in v1.
