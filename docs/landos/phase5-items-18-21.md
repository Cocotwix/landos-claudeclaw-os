# Phase 5 — Items 18 to 21: Deal Intelligence as one parent mission

Phase 4 built the native mission graph and proved it with a small read-only
fan-out. Phase 5 puts the REAL Property Intelligence workflow on it.

> **Status: PARTIAL. Phase 5 is NOT complete.**
>
> | Item | Status |
> |---|---|
> | 18 — one parent mission behind the visible control | **Complete** |
> | 19 — specialist child missions dispatched and ordered | **Complete** |
> | 20 — one versioned Deal Intelligence Snapshot | **Complete** |
> | 21 — Deal 32 golden path | **Partial: 15 of 16 requirements satisfied** |
>
> The one outstanding requirement is a **supported Deal 32 valuation**. The exact
> gap: no genuinely closed, in-band land comp currently carries usable acreage
> through the approved workflow (see the completion-review section below).
> Closing it requires the later **Phase 6 comp-extraction** work.
>
> **Phase 5 must not be marked complete until Deal 32 is rerun successfully with a
> supported valuation.**

## Item 18 — the visible control creates one parent mission

**What was there before.** Three separate paths claimed the name "Run Property
Intelligence":

| Surface | Called | What it did |
|---|---|---|
| Deal Card Overview button (`runReport`) | `POST /deal-cards/:id/report/run` | `runDealCardReport` — a 2,638-line report function, wrapped in a ~200-line route handler that also ran the property inspection, browser vision, the canonical public-intelligence orchestration, the coherence audit and a repair re-run. Collection, orchestration, analysis, persistence and presentation in one path. |
| `PropertyIntelligenceLaunch` button | `POST /deal-cards/:id/property-intelligence/run` | `launchPropertyIntelligenceMission` — a *second*, separate specialist wave engine, not on the Phase 4 mission graph. |
| `MissionGraphPanel` button | `POST /deal-cards/:id/mission-graph/run` | The Phase 4 three-child proof fan-out, read-only. |

So the mission graph existed but the real workflow did not run on it.

**What Phase 5 does.** The visible control now launches ONE parent mission on the
Phase 4 graph. `runDealCardReport` is **not deleted and not rebuilt** — it is
extracted into `runDealCardReportWorkflow` and reused as the subject-research
child's capability. The legacy `/report/run` route still calls the same
function, so nothing that already depended on it regresses.

```
Run Property Intelligence
  → POST /deal-cards/:id/property-intelligence/run
  → launchDealIntelligenceMission            (deal-intelligence-run.ts)
      → launchFanOutMission                  (Phase 4 runner, unchanged)
          → 10 specialist child missions
      → assembleDealIntelligencePackage      (Operator — assembly.ts)
      → analyseDealIntelligence              (Analyst  — analysis.ts)
      → PropertyIntelligenceStore.completeRun(Operator — persistence)
  → Deal Card reads the current snapshot
```

The parent mission id and the snapshot run id are the **same id**, so either
surface locates the other without a lookup table.

## Item 19 — the specialist children

| Child | Role | Requires | Waits for | Specialist | Slot |
|---|---|---|---|---|---|
| `parcel_identity` — Parcel and LandPortal subject research | required | — | — | Property Research Agent | identity |
| `government_records` — subject property ONLY | required | parcel_identity | — | Property Research Agent | government_records |
| `zoning_land_use` | required | parcel_identity | — | Property Research Agent | zoning |
| `environmental_terrain` | required | parcel_identity | — | Property Research Agent | environmental |
| `access_utilities` | required | parcel_identity | — | Property Research Agent | access_utilities |
| `comparables` — LandPortal, Zillow, Redfin | required | parcel_identity | — | Property Research Agent | comparables |
| `market_intelligence` — Market Pulse + Market Matrix | supporting | parcel_identity | — | Market Research Agent | market |
| `evidence_visuals` | required | parcel_identity | — | Property Research Agent | evidence |
| `valuation` | required | parcel_identity | comparables, environmental, zoning, access | Underwriting Agent | valuation |
| `strategy` — five approved strategies | required | valuation | every research lane | Land Investing Research Agent | strategy |

### `awaits` — why a missing lane does not put the deal on hold

Phase 5 requires that missing information "affect only the conclusion or strategy
it materially impacts" and "not automatically block valuation, downgrade the
entire recommendation, or place the whole deal on hold."

The Phase 4 runner skips a child when a `dependsOn` parent did not contribute.
That is right for a lane a child genuinely cannot work without, and wrong for a
lane that merely informs it. So `MissionChildSpec` gained `awaits`:

- `dependsOn` — ordering **and** skip. Used only where the child truly cannot run.
- `awaits` — ordering **only**. An awaited lane that failed, blocked or was
  rejected does not skip the child; whatever DID land is still passed through
  `upstream`, and the gap is disclosed on the conclusion it affects.

Concretely: a blocked zoning lane orders valuation after itself, but valuation
still runs and still prices. Strategy still evaluates all five approved
strategies and states which inputs were missing. Proven end to end in
`deal-intelligence-run.test.ts` → *"one blocked research lane does NOT cancel
valuation or strategy"*.

### Government records are subject-only, and comps are never government-verified

Both are enforced by acceptance contracts, not by convention:

- `government_records` declares `appliesTo: 'subject_property'`; any other value
  is a REQUIRED-check failure and the handback is rejected.
- `comparables` declares `governmentVerificationPerformed: false` and its source
  list. A `true` flag, or a source matching assessor / recorder / deed / parcel
  layer / comptroller / county record / GIS / tax roll, REJECTS the lane. A
  rejected lane contributes nothing, and the parent says so.

An empty comp set is `incomplete`, never rejected — a source that was reached and
honestly returned nothing has still delivered a result.

## Item 20 — one current snapshot, versioned

Five stages, each able to change without returning to the oversized report path:

| Stage | Module | Purity |
|---|---|---|
| Collection | `property-intelligence-live.ts` (**reused unchanged**) + `runDealCardReportWorkflow` | I/O |
| Orchestration | `mission-graph-runner.ts` (Phase 4, unchanged) | I/O |
| Assembly (Operator) | `deal-intelligence-assembly.ts` | pure |
| Analysis (Analyst) | `deal-intelligence-analysis.ts` | pure |
| Persistence (Operator) | `PropertyIntelligenceStore` | I/O |
| Presentation | `PropertyIntelligencePanel.tsx` | view only |

**History and precedence.** Every run gets a new monotonic sequence per Deal
Card. Nothing is overwritten in place.

- A run is promoted to current only when it produced a snapshot AND the subject
  identity was actually established by that run. A downstream lane that failed,
  blocked or was rejected does not make the run unusable — its gap is named and
  the newest honest read still becomes current.
- An **older** attempt can never override a newer one, even if it finishes last
  (two runs can overlap; the straggler would otherwise demote the newer result
  purely by finishing second).
- A failed run never demotes the current snapshot. Its snapshot is still stored,
  so the operator can open the failed attempt as history.

**Staleness means nothing has moved.** `reclaimStaleRuns` previously keyed on
`started_at` alone. Because the reclaimer is consulted on every operator poll,
that would reliably abort a healthy long-running mission mid-flight — the
subject-research lane legitimately runs for many minutes. It now requires that
neither the run nor any of its specialists has been touched inside the window.

## Item 21 — the golden path

Proof and limitations are recorded in `.landos/CHECKPOINT.md`. The five approved
strategies are bound to `APPROVED_STRATEGIES` in `strategy-readiness.ts` rather
than re-declared, so Phase 5 cannot drift from, add to, or remove from them.

**Naming note.** The roadmap calls the first strategy "Quick Flip"; LandOS's
canonical name for that same strategy is **"Cash Flip"**. Renaming it is a
system-wide change with no Phase 5 purpose, so the canonical name stands.

## Browser cleanup

`closeSurplusSessionPages()` closes pages the workflow opened, never the browser
and never the operator's first tab or the shared working tab. The result is
recorded ON the snapshot (`browserCleanup`) and shown on the Deal Card, because
"the workflow cleaned up after itself" is an operator-visible outcome rather than
a log line — and a cleanup that could not run must be visible, not assumed.

## Item 21 valuation: why Deal 32 is not priceable (completion review)

Deal 32 does **not** satisfy Item 21's "supported valuation". This was investigated
against the approved sources only (LandPortal, Zillow, Redfin) and the conclusion is
an evidence gap, not a defect in the Phase 5 pipeline.

What the approved boards actually hold for the subject market (Kingston / Roane, TN),
probed directly:

| Board | Result |
|---|---|
| Redfin sold, 12 months | 8 real closed land sales. Six carry acreage — all **0.32–1.0 ac**. Two carry none. |
| Redfin sold, 24 months, subject band | 7 closed sales ($40k–$119k). **Every one has no lot size on the card.** |
| Redfin, county-only geography | `disabled` — the search needs a city, ZIP or coordinates; county alone is not a route. |
| Zillow, subject band | 1 row, 9.01 ac, $85,000 — but see the defect below. |

The subject is 12.28 ac, so the acreage band is 6.14–30.7 ac. Every sold row that
carries acreage is a sub-acre residential lot: at $28k–$156k per acre those are not
comparable to a 12-acre tract, and using them would not be a valuation. Every sold row
in the subject's size range is missing lot size at the source.

**The gap is precisely this:** no row is both (a) genuinely closed and (b) carrying
usable acreage in the subject's band. Closing it needs lot size read from the Redfin
listing DETAIL page rather than the results card — a comp-extraction change, which is
Phase 6's remit.

Two defects were found while establishing this, and both are recorded for Phase 6:

1. **The sold board is never requested.** `fetchZillowLandComps` and
   `fetchRedfinLandComps` both accept `mode: 'sold'`, and Redfin's real sold filter
   (`include=sold-1yr` / `-2yr`) works. The Property Intelligence lane calls neither
   with a mode, so it browses only the ACTIVE board and salvages rows whose card text
   happens to read "sold". That is why Deal 32 surfaced exactly one closed sale.
2. **Zillow has no genuine sold board.** `zillow-land-comps.ts` uses the SAME URL for
   both modes and then relabels every row: `if (input.mode === 'sold') ... comp.status
   = 'sold'`. Requesting Zillow's sold mode would present ACTIVE listings as closed
   sales — fabricated transaction status. Nothing currently passes `mode` to Zillow, so
   the path is unreachable today; it must not be enabled without fixing the relabel.

A two-board correction for both providers was written and reverted during this review:
it surfaced real Redfin closed sales but still produced no priceable row, and it would
have activated defect 2. Phase 5 behaviour is therefore unchanged.

Also noted: in `normalizeRedfinListings`, a row with unknown acreage BYPASSES the
acreage band (`if (acres != null && ...)`). Such rows reach the valuation described as
"in-band" when they are simply unclassified — which is how an acreage-less row became
Deal 32's only accepted comp.

## Scope held

Not started, deliberately: the Phase 6 comp rebuild, Phase 7 agent expansions,
Phase 8 market selection, Phase 9 valuation redesign, Phase 10 Deal Card
overhaul, Jarvis. Not added: government research on comps, comp transaction
verification, fourteen-domain completeness grading, decision-readiness gates,
automatic posture downgrades from incomplete records, post-contract standards at
discovery stage, new strategy types. The known Hardin Valley intake parser issue
was left untouched.
