# Current Active Task

Close-out of the 9490 Elk Lake Rd sprint: the four operator defects the live
acceptance exposed were fixed in four lanes, the retained exact-address listing
evidence is now surfaced in Property Intelligence, and everything was reverified
live. Nothing committed or pushed. Awaiting Tyler's review.

# Exact Operator Outcome

On deal 83 the operator sees an improved subject named as improved, a land-only
value with whole-property pending, LandPortal rows labelled source-stated rather
than verified while still pricing the subject, the retained Zillow/Realtor/Redfin
listing evidence with provenance, and comp counts, statuses and lane summaries
that agree with each other.

# Current State

- **Generated:** 2026-08-10T23:35:00Z
- **HEAD at generation:** `d539e10`. 0 staged, 0 unpushed.
- **Worktree:** DIRTY, 411 uncommitted paths. Preserve unrelated changes.
- **Build:** PASS (vite + tsc), only pre-existing chunk-size warnings.
- **Runtime:** RUNNING healthy, PID 155904, http://localhost:3141, HTTP 200.
- **Dedicated LandOS Chrome:** running, CDP 9224, owned.

# Completed and Proven

LANE 1 — improved-subject presentation. `readSubjectImprovement` wires the
previously unused `inferSubjectPropertyType` to the subject and returns the
caption noun, valuation scope and whole-property status. LIVE: "60-acre improved
parcel ... carrying approx. 1,701 sqft of improvements"; "LAND-ONLY INDICATION —
IMPROVEMENTS NOT VALUED $625,500"; "WHOLE-PROPERTY VALUE Pending" on Overview
and Comps; ladder reads "of land value" / "adopted cleaned LAND value". The word
"vacant parcel" no longer appears for this subject. House valuation NOT built.

LANE 2 — LandPortal comp semantics. New `source_stated_sale` basis and
`CompSaleVerification`. A row promoted to a sale only because the provider
printed a date is carried as source-stated: full weight, provenance kept, never
called verified. LIVE: badge "SOURCE-STATED SALE", price "SOURCE-STATED SALE
PRICE — NOT INDEPENDENTLY VERIFIED", header "PROVISIONAL VALUATION BASED ON 5
SOURCE-STATED VACANT-LAND SALES (NOT INDEPENDENTLY VERIFIED)", confidence forced
LOW in the summary and the cleaned valuation. All five comps stay in the
decision set. "VERIFIED SOLD PRICE" is gone from deal 83.

LANE 3 — exact-address transport. No node fetch remains. Result anchors come
from `driver.readLinks` on the static search endpoint (the proven county-records
path), with the background-browser transport plus `extractLinks` as fallback;
listing pages are read in that same browser; the lane runs inside
`withOwnedPages`. PROVEN LIVE on run 43: `retrieved`, 3 pages — the 9490 Zillow,
Realtor.com and Redfin detail pages, the last carrying `house`, 2,000 sqft, 60
acres. No page contains easement language, so reported legal access stays empty.

LANE 4 — count/status reconciliation. `mergeComps` unioned comp arrays across
runs but inherited `summaryLine` and `conclusion` from the incoming run alone;
both are now re-derived from the merged rows via `compSummaryLine`. The Market
Score noun follows the comps registry via `soldAllSourceStated`. LIVE: tiles
"4 asking" sit beside "4 asking-market reference(s)" and `asking_indication`;
Market Score reads "5 selected source-stated sale(s)".

LANE 5 — retained listing evidence surfaced. `projectExactAddressListingEvidence`
projects the latest attempt that retained pages; the route serves it as
`exactAddressListings`; a block inside the EXISTING Property Intelligence
section renders it. No new page, no parallel UI, no new research. LIVE:
"Subject read: Retained listing evidence describes an improved property of
approx. 2,000 sqft on 60 acres (house). Listing-reported, not an assessor
record."; zillow.com, realtor.com and redfin.com each with URL, facts and
provenance date; per-source wording stating the page published no legal-access
or easement language, so reported legal access stays unresolved from it;
bounded excerpts for page-sized wording; and a confidence line.

REGRESSION HELD: acreage router 21–150 ac with 5 comps pricing the subject, 0
outside band; improved context 16, decision set 5, no improved row in the
vacant-land set; Overview LandPortal image 1600x1000 after refresh; the
four-tier access ladder unchanged with its reported-legal tier still empty.

# Remaining Work

Not built, deferred: the house valuation lane that would turn the land-only
figure into a whole-property value; Strategy agent; Pre/Post Discovery
Revaluation. The exact-address lane's `persistence.attempted` is still false, so
its evidence lives on the run record and is projected at read time rather than
entering the canonical evidence store. There is still no Run Property
Intelligence control in the V2 workspace; only legacy `/legacy/deal/:id` has one.

# Exact Next Action

Report to Tyler and wait. Do not commit or push, and do not start the house
valuation lane or any Remaining Work item without his instruction.

# Relevant Files

- `src/landos/comps-valuation.ts`, `comp-transaction-price.ts`,
  `comp-listing-projection.ts`
- `src/landos/property-intelligence-snapshot.ts`, `deal-operator-analysis.ts`
- `src/landos/routes.ts`, `discovery-access-presentation.ts`,
  `exact-address-web-discovery.ts`
- `web/src/pages/AcquisitionWorkspaceV2.tsx` and
  `web/src/components/AcquisitionWorkspaceV2{PropertyIntelligence,CompsValuation}.tsx`,
  `CompRecordIdentity.tsx`

# Relevant Records

Live run `di_msntkf8z_2vsoyp` (deal 83, sequence 43). Its exact-address lane
attempt in `landos_property_research_lane_attempt` holds the three retrieved
listing URLs and their facts, and is what the new panel projects.
`landos_landportal_capture` is still empty: the Overview image remains the
retained `parcel_context` inspection asset, not a new capture.

# Known Blockers

`src/landos/memory-bootstrap.test.ts` has 3 pre-existing failures asserting
wording the consolidated contract no longer contains; unrelated, deferred.
`landos:memory:checkpoint` refuses to write (generator output exceeds the 8192
ceiling), so this file was written directly under the ceiling.
The `landos` Hermes profile still has `image_gen`, `bfl` and `tts` enabled from
a prior session; they can incur cost and await Tyler's decision.

# Do Not Inspect or Modify

Do not expose `.env` or secrets, print either dashboard token, run destructive
SQL, discard the dirty worktree, or delete
`store/backups/landos-pre-rescue-2026-08-03.db`. Deny rules `Bash(git push*)`,
`Bash(rm *)`, `Bash(git clean*)` are intact. Never disable TLS verification.
Do not create a second Chrome profile: LandOS uses the one dedicated automation
Chrome on CDP 9224.

# Runtime State

Rebuilt and restarted through `npm run landos:restart`; healthy on
http://localhost:3141, PID 155904, HTTP 200. Dedicated LandOS Chrome on CDP 9224.

# Verification Required

Tier 3, met. Final focused sweep: 169 tests across 11 files PASS (the earlier
four-lane sweep was 269 across 15). `tsc --noEmit` clean; production build
clean; managed restart healthy; the primary agent personally exercised Overview,
Property Intelligence and Comps & Valuation live after a hard refresh. Nothing
was committed or pushed at any point.

# Completed and Protected

Retain everything previously protected, plus: a vacant-land comp set is never
presented as a whole-property value on an improved subject — it is a land-only
indication and the whole-property value is reported pending; a comp row whose
closed status was inferred from a printed date is labelled source-stated, keeps
full participation and provenance, and is never shown as a verified sale or
rated above low confidence; merged comp counts, the summary sentence and the
priceability verdict are always re-derived together; exact-address discovery
reads engines and listing pages through the dedicated LandOS browser, never a
bare fetch; retained listing evidence is shown per provider with URL, facts and
provenance, states plainly when a page published no access wording, and stays at
listing-reported confidence, never a verified government or recorded fact.
