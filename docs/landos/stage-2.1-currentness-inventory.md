# Stage 2.1 — currentness inventory (fourteen families)

Read-only trace. No derived content was regenerated, no historical text rewritten,
no product change made.

## The shared correlation column

`writeDerivedSnapshot()` (`src/landos/derived-intelligence-store.ts:208`) stamps
`property_identity_version_id` on **every** derived row, read from
`readCurrentPropertyIdentity(dealCardId)`, and **refuses to write at all** when no
identity version exists. So no derived family can persist uncorrelated — the
"uncorrelated" case is structurally unreachable at the write side.

`readDerivedSnapshot()` (line 301) selects `status='current'` and does **not**
compare that column. Currentness is therefore enforced per-family at the read
route, not by the store. That is what this trace checks.

Persistence for all fourteen families: `landos_deal_intelligence_snapshot`
(business DB `store/landos.db`), one `status='current'` row per type per deal,
predecessors retained as `status='superseded'`.

## Mechanism A — explicit subject-version gate

`gateSnapshotToCurrentSubject()` (`property-intelligence-snapshot.ts:1033`)
compares the payload's `subjectVersion` against
`canonicalSubjectProjection().subjectVersion`. Stale ⇒ `strategies` emptied,
`recommendation.preferredStrategy`/`why`/`whatWouldChangeIt`/`postureWhy` cleared,
`shouldPursue` forced to `undetermined`, original moved to a `historical` bucket.
Pinned by `subject-official-record.test.ts` (current / older / uncorrelated).

## Mechanism B — identity-bearing input fingerprint

The Intelligence Stack hashes `dossier.identity` into each layer's input
fingerprint (`intelligence-stack.ts:137` property, `:170` market, and the seller
and deal layers alike). A changed subject changes the fingerprint, and the read
model reports the layer in `stale: Record<IntelligenceLayerId, boolean>`
(`:379`, `:478`). Surfaces render the stale flag rather than the conclusion.

## The fourteen families

| # | Family | Writer | Read route | Currentness | Surfaces | Verdict |
|---|---|---|---|---|---|---|
| 1 | `intelligence_property_v1` | Intelligence Stack property layer | `intelligence-stack.ts` + `routes.ts:7862` | A **and** B | Overview, Property, Strategy | Contained |
| 2 | `subject_understanding_v1` | `subject-understanding-capability.ts` | `routes.ts:5712` `isCurrentForSubject` | Explicit `ranAgainstSubjectVersion` | Property (panel) | Contained; evidence only, consumers read the promoted subject via `canonicalSubjectProjection()` |
| 3 | `acreage_extent_v1` | acreage basis | shared acreage basis | Superseded measurements carried as labelled history (`supersededAcreage`) | Overview, Property | Contained |
| 4 | `intelligence_market_v1` | Market layer | `intelligence-stack.ts:355` | B | Market, Comps and Valuation | Contained |
| 5 | `intelligence_seller_v1` | Seller layer | `intelligence-stack.ts:371` | B | Overview, Strategy | Contained |
| 6 | `acquisition_intelligence_v1` (= `DEAL_INTELLIGENCE_PRODUCT_TYPE`) | Deal Brain chair | `intelligence-stack.ts:372`, `routes.ts:2753`, `acquisition-intelligence-store.ts:71` | B | Overview, Deal Brain | Contained |
| 7 | `property_backstory_v1` | `property-backstory-store.ts` | `:72` (history at `:77`) | No gate at the store; narrative only | Property | Historical/narrative — carries no strategy, risk, blocker, valuation or Operator Action field |
| 8 | `intelligence_reconciliation_v1` | `intelligence-capability-reconcile.ts` | `routes.ts:11493` | No gate; it is bookkeeping about reconciliation, not a conclusion | Overview | Non-driving |
| 9 | `current_zoning_v1` | `current-zoning-determination.ts` | `land-use-intelligence-store.ts:374` | **None at the store** | Strategy and Underwriting | **Unproven — see gap** |
| 10 | `zoning_standards_v1` | same | `:378` | **None at the store** | Strategy and Underwriting | **Unproven** |
| 11 | `land_use_authority_v1` | same | `:370` | **None at the store** | Strategy and Underwriting | **Unproven** |
| 12 | `subdivision_regulations_v1` | `jurisdiction-knowledge.ts` | `:382` | **None at the store**; partial staleness via `acreage-dependent-refresh.ts` | Strategy and Underwriting | **Unproven** |
| 13 | `subdivision_property_read_v1` | same | `:386` | `acreage-dependent-refresh.ts:366` stales it on an acreage decision change | Strategy and Underwriting | Partially contained; subject-version case **unproven** |
| 14 | `government_record_risk_v1` / `zoning_land_use_v1` (present in the live DB, same land-use lane) | land-use lane | `land-use-view.ts` | **None traced** | Strategy, risk | **Unproven** |

## Remaining gap — stated, not claimed contained

Families 9–14 (the land-use / zoning lane) persist **with** the identity-version
correlation column but their store-level readers apply no subject-version
comparison, and `acreage-dependent-refresh` covers an acreage change rather than a
subject change. Within the timebox I did **not** prove either that a zoning read
correlated to an older identity version can reach a current strategy, risk,
blocker or Operator Action output, or that it cannot.

I am not claiming containment for these six. The smallest next action is a
read-only trace of `land-use-view.ts` and the Strategy/Underwriting route to
determine whether the land-use read is rendered inside a historical section or
feeds a current conclusion. If it feeds a current conclusion, the smallest
correction is to apply the existing `isCurrentForSubject` comparison at that one
read route — reusing the mechanism, not adding one.

Families 1–8 are contained on the evidence above.
