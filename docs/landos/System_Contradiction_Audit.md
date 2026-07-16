# LandOS System Contradiction Audit — Deal Card Assembly (2026-07-14)

Live operator inspection of a verified acceptance card exposed contradictions that
are all SHARED-SERVICE defects, not property defects. Each entry: displayed
statement, competing statement, record supplying each value, shared root cause,
and the shared repair. No fix below is property-specific.

## C1 — Header/description acreage "? ac" while calculations use a numeric acreage

- Displayed: `operatorRecord.description` = "?-acre parcel …", identity
  `assessedAcres: null`, `mappedAcres: null`.
- Competing: `reconciliation.acreage.primary` = numeric; comp scoring, valuation,
  exec-summary headline all use the numeric acreage.
- Records: `landos_deal_card_report.report_json` (ddFactChecklist row `acres`
  value "1.15 ac") vs `routes.ts` GET report — `assessedAcres: Number(fact('acres')) || null`
  (`Number("1.15 ac")` = NaN → null).
- Root cause: no shared acreage parser/canonical accessor; each consumer parses
  its own way and one fails silently.
- Repair: shared `parseAcresValue()` + operator record consumes the reconciled
  acreage record; audit check fails whenever displayed and calculation acreage
  diverge.

## C2 — "Pickens County County"

- Displayed: `operatorRecord.description`, persisted `market_summary`
  ("Target area: X County County").
- Root cause: `buildIdentityText()` pushes "<county> County" into the identity
  text; the parser stores the SUFFIXED string as the county NAME; every
  downstream formatter appends " County" again (market leg, description,
  cluster geography). Geographic type and name are not separated.
- Repair: shared `formatCountyLabel()` / `stripCountySuffix()` applied at every
  seam + read-time sanitation of stale persisted strings + tests both ways.

## C3 — Executive review "17/17 consistency checks passed" on a contradictory card

- Root cause: `deal-card-audit.ts` never compares operator-record display values,
  executive-summary pricing, strategy decision card, red-flag completeness,
  market summary currency, or valuation basis counts against the shared records.
- Repair: new audit checks (displayed-acreage alignment, geography format,
  pricing-gate agreement incl. executive summary, strategy-card agreement,
  red-flag completeness, valuation-basis count vs registry, market-summary
  currency, offer-readiness blockers). Verified to FAIL against the captured
  pre-fix live payload.

## C4 — Value Readiness "OK"/"ready" + preliminary valuation + range while pricing gate closed

- Displayed: value decision card `good` ("Comp-supported range available"),
  `valueReadiness.state='ready'`, `report.valuation.primary` + `valueRange`,
  exec summary headline "target $18k–$27k", `preliminaryAcquisitionRange.available=true, confidence high`.
- Competing: `strategyReadiness.pricingAllowed=false` ("Valuation sources
  disagree materially — tighten comps first"); pursuit "Not priceable yet".
- Root cause: three independent gates: comp-registry `valuationReady`
  (count-only), strategy-readiness pricing gate (count + conflict + acreage),
  and exec-summary range builder (count-only). Consumers pick different gates.
- Repair: ONE `computePricingGate()` shared by strategy-readiness, operator
  record, valuation projection, and executive summary. Gate closed → valuation
  primary/range suppressed (observations preserved), no $ anywhere, honest
  "pricing blocked" reasons.

## C5 — Strategy Readiness "Strategies scoreable" while all 5 strategies blocked

- Displayed: strategy decision card verdict `good`, headline "Strategies scoreable".
- Competing: shared strategy-readiness record: all five blocked.
- Root cause: the decision card keys off registry `valuationReady` instead of
  the shared record's pricing gate.
- Repair: decision card + value card + offer readiness consume the shared gate.

## C6 — Offer status "needs confirmation" while most research has not run

- Root cause: `offerReadiness` in the operator record derives ONLY from
  `valuationReady`; it ignores research completeness and the pricing gate.
- Repair: offer readiness states (researching / pricing evidence insufficient /
  material facts unresolved / needs operator confirmation / ready) derived from
  the shared gate + research completeness.

## C7 — Critical Red Flags "None surfaced" while screening has not run

- Root cause: the red-flag decision card renders `good`/"None surfaced" whenever
  the reconciled flag list is empty, regardless of whether any screen ran.
- Repair: distinct states — found / none-within-completed-screening /
  critical-risk-review-incomplete. "None surfaced" only when every core lane has
  accepted evidence.

## C8 — FEMA "not screened" alongside "zones/BFE already screened from the county layer"

- Root cause: `operator-property-record.ts` FIRM-panel work item + unknowns text
  claims zones/BFE screened whenever `flood.panelNumber` is missing — including
  when the flood lane never ran (`flood == null`).
- Repair: the claim renders only when a flood finding exists; otherwise the
  work item is the honest "flood screening has not run yet".

## C9 — Market summary claims "no comps computed / no market adapter connected" while 55 validated comps exist

- Root cause: `buildMarketLeg()` writes a static sentence at report-build time;
  the read path later projects registry counts without refreshing the narrative.
- Repair: read-time market summary regeneration from the registry-driven comp
  state; audit check for the contradiction.

## C10 — Valuation basis "Sold land comps (24)" vs comp state "55 sold"

- Root cause: persisted valuation hierarchy is not recomputed against the
  validated unique registry at read time; the registry projection only replaced
  the counts, not the valuation stats.
- Repair: valuation recomputed from the registry's validated sold/active sets on
  read; audit check that the basis count matches the registry.

## C11 — Downstream intelligence never runs after parcel confirmation

- Records: `landos_public_intelligence_run` holds ONE row (one deal card) —
  every other verified card has zero screening lanes despite the full
  11-lane public-intelligence orchestrator existing.
- Root cause: nothing starts the mission after confirmation; the POST
  `/public-intelligence/run` route is operator-triggered only.
- Repair: parcel confirmation (report/run + acquire) auto-starts the public
  intelligence mission when no current run exists; per-stage status remains
  visible; provider failures stay isolated. Backfill runs for existing verified
  cards through the same shared path (free approved sources only).

## C12 — "homeharvest" as an operator-facing provider label; comps without distance

- Facts: `homeharvest` is the open-source HomeHarvest scraper lane pulling
  Realtor.com listing/sold data (MIT, keyless; see
  `providers/homeharvest-comp-provider.ts`). Not a paid provider.
- Root cause: internal adapter ids are rendered raw; comp candidates carry no
  coordinates so distance is never computed and "closest" language is unsupported.
- Repair: shared provider display-name map (adapter id → operator name + source
  attribution); distance computed from subject coordinates where comp
  coordinates exist, otherwise explicitly "distance not calculated"; ranked
  comps expose their score components.

## C13 — Generic seller questions

- Root cause: executive summary ships a hard-coded 5-question list; the operator
  record's property-aware generator only activates on findings that exist, and
  nothing runs pre-screening gap-driven questions.
- Repair: shared question generator derives from the property's actual missing
  facts (acreage source, access, survey/deed, flood, septic, utilities, zoning,
  structures, prior offers, price/motivation/timeline/decision-makers);
  executive summary consumes the shared list.

## C14 — `complete_with_gaps` presented as a completed report

- Root cause: report status conflates "the report generator finished" with
  "research is complete"; no report-readiness classification exists.
- Repair: report readiness classification (research progress / preliminary
  intelligence / desktop underwriting / decision ready) derived from research
  completeness + the pricing gate; UI labels the report accordingly.

Every repair lands in shared services with regression tests; the acceptance
property is used only as the reproduction/acceptance case.
