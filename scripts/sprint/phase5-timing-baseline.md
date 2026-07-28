# Phase 5 mission timing — BEFORE baseline (Agent 4)

- **Captured:** 2026-07-27 (read-only queries against `store/landos.db`,
  tables `landos_mission` / `landos_mission_child`).
- **Scope:** the most recent completed `deal_intelligence` missions.
  All timestamps UTC. Durations from the stored `duration_ms` / ISO columns.
- **Graph note:** every run below executed under the OLD ordering, where the
  `comparables` child was serialized behind `deal_card_projection`
  (both drove the one shared Chrome tab). The stored `depends_on` column shows
  only `parcel_identity` because `awaits` is not persisted per row; the
  serialization is visible in the start/end timestamps: in every run,
  comparables STARTS 1–2 ms after deal_card_projection COMPLETES.

## Headline runs

### Deal 32, mission sequence 11 (mission `di_ms3eajqb_wqjut3`, the latest joined run)

Parent: started 15:42:00.806, completed 15:57:03.155 — **total wall clock 902.3 s (15 m 02 s)**, status `joined` (11/11).

| child | start (rel) | end (rel) | duration | status | overlaps with |
|---|---|---|---|---|---|
| parcel_identity | +0.03 s | +6.15 s | 6,122 ms | completed | (root; nothing else running) |
| deal_card_projection | +6.15 s | +630.8 s | 624,643 ms | completed | gov/zoning/env/access/market/evidence (they all end <1 s in) |
| government_records | +6.16 s | +6.33 s | 183 ms | partial | projection + other quick lanes |
| zoning_land_use | +6.18 s | +6.34 s | 186 ms | partial | same |
| environmental_terrain | +6.19 s | +6.33 s | 183 ms | completed | same |
| access_utilities | +6.20 s | +6.34 s | 184 ms | partial | same |
| market_intelligence | +6.21 s | +6.42 s | 268 ms | completed | same |
| evidence_visuals | +6.25 s | +6.34 s | 183 ms | completed | same |
| comparables | +630.8 s | +902.3 s | 271,534 ms | partial | **nothing — strictly serial after projection (+1 ms gap)** |
| valuation | +902.3 s | +902.3 s | 12 ms | completed | strictly after comparables (+5 ms gap) |
| strategy | +902.3 s | +902.3 s | 2 ms | completed | strictly after valuation |

- Time from parent start to parcel_identity completion: **6.15 s**
- Time to first contributed child: **6.15 s** (parcel_identity)
- Time to first market-facing content (market_intelligence): **6.4 s**; to comparables content: **902.3 s** (99.99 % into the run)
- **Critical path (observed, fully serial):** parcel_identity (6.1 s) → deal_card_projection (624.6 s) → comparables (271.5 s) → valuation (0.012 s) → strategy (0.002 s) = ~902.3 s = 100 % of wall clock.
- **Pure serialization cost of comparables-behind-projection: 271.5 s (30.1 % of the run).** Concurrent projection+comparables would give ≈ 630.8 s.
- Post-change expected time-to-valuation: ≈ 6.1 + 271.5 ≈ 278 s instead of 902 s.

### Deal 54, mission sequence 1 (mission `di_ms2sq4cb_bxh5s6`, fresh-intake acceptance run)

Parent: started 05:38:15.804, completed 05:50:53.407 — **total 757.6 s (12 m 38 s)**, status `joined` (11/11).

| child | duration | status | note |
|---|---|---|---|
| parcel_identity | 80,708 ms | completed | root; 0 → 80.7 s |
| deal_card_projection | 504,164 ms | completed | 80.7 s → 584.9 s |
| six quick lanes (gov/zoning/env/access/market/evidence) | 20–333 ms | partial/completed | all overlap projection at ~80.7 s |
| comparables | 172,720 ms | partial | starts 584.9 s, **+1 ms after projection end — serial** |
| valuation | 2 ms | partial | +2 ms after comparables end |
| strategy | 2 ms | partial | after valuation |

- Time-to-identity: **80.7 s**. Critical path identity → projection → comparables ≈ 757.6 s (100 % of wall clock).
- Serialization cost: **172.7 s (22.8 %)**; concurrent would give ≈ 584.9 s.

## All recent joined Deal 32 runs (same serial pattern in every one)

| seq | total | identity | projection | comparables | comps start gap after projection end | serialization cost (comps/total) |
|---|---|---|---|---|---|---|
| 11 | 902.3 s | 6.1 s | 624.6 s | 271.5 s | +1 ms | 30.1 % |
| 10 | 627.5 s | 2.4 s | 574.9 s | 50.2 s | +2 ms | 8.0 % |
| 9 | 888.8 s | 29.2 s | 598.3 s | 261.3 s | +1 ms | 29.4 % |
| 8 | 780.7 s | 2.5 s | 587.6 s | 190.6 s | +1 ms | 24.4 % |
| 7 | 708.7 s | 9.1 s | 559.3 s | 140.3 s | +0 ms | 19.8 % |
| 6 | 759.9 s | 20.0 s | 599.1 s | 140.7 s | +1 ms | 18.5 % |
| Deal 54 #1 | 757.6 s | 80.7 s | 504.2 s | 172.7 s | +1 ms | 22.8 % |

**Mean serialization cost across these 7 joined runs: ~175 s (~2.9 min) per run, ~21.9 % of wall clock.**
Every run's wall clock equals identity + projection + comparables + (valuation/strategy, ~ms) to within scheduling noise — the mission is 100 % serial along that chain today.

## What the sprint should change (expected AFTER shape)

1. comparables starts at identity-settle (~+6 s), overlapping projection → total ≈ identity + max(projection, comparables + valuation + strategy).
2. valuation (awaits comparables + constraint lanes, NOT projection) settles mid-run instead of at the end → time-to-first-valuation drops ~60–70 %.
3. The six quick lanes already overlap correctly; no change expected there.

Measurement tool for the AFTER capture: `node scripts/sprint/phase5-mission-timing.mjs --latest` (or `<dealCardId>`), read-only.
