# Phase 3 — Property Intelligence end to end (2026-07-26)

Base HEAD `e9ce958`. Nothing committed, nothing pushed.

## What the operator can now do

From a Deal Card, **Run Property Intelligence** starts ONE parent mission. Ten
specialists run in dependency waves; their live status, classified failure and
timing are visible while it works; and their results are joined into ONE snapshot
written back to that Deal Card. The snapshot drives Overview, Property, Due
Diligence, Market, Strategy, Visuals and Documents — so no two tabs can tell
different stories.

The launch control also appears on an UNRESOLVED card's resolution view, because
Property Intelligence is what resolves a parcel. On an unresolved card the
snapshot withholds every parcel-specific conclusion and shows only identity
state, blockers and next actions.

## Modules added

| Module | Role |
| --- | --- |
| `comp-source-policy.ts` | LandPortal primary; Zillow/Redfin capped 2/2 (LandPortal usable) or 5/5 (LandPortal empty); Realie + HomeHarvest excluded from vacant-land FMV; improved/manufactured held for Land-Home only; sold vs active separated; a stated reason on every accept and reject |
| `property-intelligence-specialists.ts` | The ten-specialist catalog, dependencies, roles, timeouts, execution waves |
| `property-intelligence-snapshot.ts` | The joined snapshot shape, evidence grades, APN normalization/equivalence, and the join that computes status, confidence, blockers, missing information and next actions strictly from what specialists returned |
| `property-intelligence-store.ts` | Additive SQLite tables for the parent run and specialist rows; monotonic per-card sequence; exactly one primary snapshot per card; restart reclaim; redaction on write |
| `property-intelligence-valuation.ts` | Acreage-normalized band with size and constraint adjustments, retail and disposition ranges, confidence, uncertainty, gaps — or an explicit refusal naming the missing evidence and the next action |
| `property-intelligence-strategy.ts` | The five approved strategies with applicability/facts/blockers/effort/timeline/value path/risk/next step, plus exactly one recommendation and posture |
| `property-intelligence-mission.ts` | The parent mission: wave dispatch, per-specialist timeout and failure classification, identity-gated skips, the join, and the completion write |
| `property-intelligence-live.ts` | Live collectors adapting the existing parcel, government-record, zoning, public-screening, comp, market, evidence and visual subsystems |
| `web/src/components/PropertyIntelligencePanel.tsx` | Launch, live progress, and the seven tab surfaces |

## API

- `GET  /api/landos/deal-cards/:id/property-intelligence` — snapshot + run + specialists + history. SELECT-only.
- `GET  /api/landos/deal-cards/:id/property-intelligence/progress` — progress-only poll.
- `POST /api/landos/deal-cards/:id/property-intelligence/run` — launches the parent mission and returns immediately. A second launch while one is in flight returns the SAME run.

## Defects the live acceptance run found and fixed

These were found by running the workflow, not by reading code.

1. **Trailing sentence punctuation captured into the APN.** An operator paste
   ending `Parcel: 015 027 04512 000 2026.` stored the period. Official parcel
   layers match exactly, so the lookup silently failed and the lead sat
   provisional with no visible reason. Fixed at both capture points
   (`intake-normalize.ts`, `duke-preflight.ts`). Regression: `apn-punctuation.test.ts`.
2. **Padded PARCELID defeated exact equality.** The Tennessee layer pads
   PARCELID (`015 027    04512 000 2026`) while an intake collapses the run to a
   single space. Added a segment-ordered, whitespace-insensitive `PARCELID LIKE`
   clause. Regression in `public-property-intelligence-live.test.ts`.
3. **The identity guard rejected a correct official match.** GISLINK is a PREFIX
   of the fuller PARCELID, so the supplied APN digits CONTAIN the matched
   parcel's GISLINK digits. The guard only checked the suffix relation. Now
   checks mutual containment across both indexes.
4. **A 25s official-parcel timeout on a 30-60s provider.** The run reported an
   UNRESOLVED parcel that was in fact resolvable — an honest message about the
   wrong thing. Raised to 60s, still well inside the 180s specialist budget.
5. **Realie exclusion reason was not the load-bearing one.** 30 rows read
   "property type could not be established" when the operator needed "Realie
   comparables cannot price vacant land". Both are now stated.
6. **Retained intake evidence was invisible.** Deal 32's accepted intake
   screenshot existed but no Property Intelligence surface showed it. The
   evidence collector now reads the immutable `landos_intake_artifact` rows
   append-only and surfaces them.
7. **No Property Intelligence surface on an unresolved card.** The resolution
   gate replaced the whole Deal Card, so the operator could neither launch the
   workflow nor see why the parcel was unresolved. The launch control and the
   snapshot now render there too.

## Acceptance results

Full per-condition snapshots: `phase3-acceptance-snapshots-2026-07-26.json`.

| Condition | Card | Result |
| --- | --- | --- |
| Existing verified | Deal 32 | `complete`, 10/10 settled, honest not-priceable refusal |
| Existing unresolved | Deal 10 | `blocked_identity`, parcel-specific lanes skipped |
| New intake, resolves | temporary (purged) | `complete`, identity confirmed, band $67k-$113k, one recommendation |
| New intake, unresolved | temporary (purged) | `blocked_identity`, confidence none |

### Deal 32 before and after

Before: parcel confirmation contradictions, stale LandPortal traces, missing
deed and zoning evidence, no accepted comps, no defensible valuation, no
retained LandPortal visuals, weak strategy conclusions.

After: identity confirmed against the official layer with the source named; 30
Realie rows excluded from FMV each with a stated reason; one accepted Redfin
closed land sale; an explicit not-priceable refusal (the accepted sale carries no
acreage) with the exact next action; government-record and zoning gaps named
rather than implied complete; the original intake screenshot surfaced and
serving (SHA-256 `df2e1d2c...`, 2,949,777 bytes, HTTP 200) with its accepted
evidence untouched; five strategies evaluated with a stated hold posture.

Deal 32 is still not priceable. That is the correct answer for the evidence in
hand, and the snapshot says exactly what would change it.

## Known limitations

- LandPortal visible comps were not read for either acceptance parcel, so the
  primary comp lane is exercised only by unit tests, not by a live LandPortal
  page read. The policy branch for "LandPortal empty" is what ran live.
- Government records reached 50% completeness with 0 retained artifacts on both
  live cards; deed, tax, survey and lien retrieval remain unfinished work.
- Zoning could not be established from the official sources searched on either
  live parcel.
- Valuation confidence was `low` on the resolvable case because only one comp
  survived the policy. That is honest, not a defect, but it is thin.
- The maximized browser window would not resize below 1699 CSS px, so 1280 /
  1440 / 1600 were verified by container constraint rather than a true viewport
  resize. Media-query breakpoint switching at those widths was therefore not
  exercised.
