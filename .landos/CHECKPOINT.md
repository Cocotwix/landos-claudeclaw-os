# Current Active Task
None. The completeness repair and the tax-status wiring are built, rerun on Deal 89, verified live, and committed in the commit carrying this checkpoint. Await Tyler's direction.

# Exact Operator Outcome
Deal 89 carries the intelligence its runs already paid for: terrain 18.65% slope / 30.52% buildable (15.49 ac) instead of a review sentence; 21 unique comps from all four lanes, 14 placed, sidebar and Show-on-Map counted separately (3 + 6 -> 6); assessment, tax, improvements, LP Estimate, the Kingwood 119-lot backstory, five exit strategies, the acreage-band read and a data center at 11.6 mi on the Overview; and a government-record lane that reaches the Official Tax Office and states payment status or the exact office and blocker.

# Current State

- **Generated:** 2026-08-16T19:40Z. **HEAD at generation:** `822ce15`, the commit this was built on.
- **Worktree:** DIRTY. Only the pairing files and untracked paths below stay dirty after this commit.
- **Tests:** 106 pass across the tax-status seams; earlier sweep 5755 pass / 4 fail across 420 suites, all 4 proven pre-existing by stashing this sprint's files. **Typecheck** PASS. **Build** PASS.
- **Runtime:** healthy on 3141, HTTP 200. **Deal 89:** snapshot sequence 12, complete.

# Completed and Proven
Six shared roots. Each was intelligence already collected, then lost before the operator.

**1. Quarantine withholds a number from decisions; it never deletes it.** The terrain review overwrote every Slope*/Buildability* VALUE with its own sentence. The decision slot is now emptied, the observation kept under `<field> (provider observation)`, which no decision reader looks up, and the reason under `Terrain Quarantine Reason`, exposed as `terrainQuarantine`.

**2. Buildable area reconciles against ANY published acreage basis.** The check used ASSESSED acreage only; LandPortal runs its model over its own `Calc Acres` (15.49/50.69 = 30.56% vs a stated 30.52%). Correct terrain was quarantined and destroyed on every parcel whose acreages differ. `acreageBasesFor` offers all four bases.

**3. A comparable generation is PER SURFACE, and is read at that surface.** Sidebar and Show-on-Map are written minutes apart by different writers; one global capture stamp let the last writer delete the other's rows from every read (89 captured 6, served 3). Each surface now keeps its own newest generation, a completed capture pins only its own surfaces, a ZERO-result capture still supersedes everything. The Hermes handback is the only writer reaching `landos_comp` and it drops `surface`, so the projection reads the retained comparables directly, with provenance.

**4. The retained centroid and ZIP reach the card, and a run places its own comparables.** Card 79 held `zip = ''` and null coordinates while the parcel record held both, so 18 of 21 comparables were unplaceable, no radius band applied, and the ZIP and data-center reads had no point to work from. `savePropertyInspection` promotes both, fill-only; the projection reads the centroid before any geocode. ENRICHMENT ONLY — invariants 2-4 unchanged. Location resolution, previously operator-only, now runs after a usable join.

**5. Panels read the canonical record, and a lane that ran says so.** Property & diligence read only the snapshot's `lp_sidebar_*` subset (2 keys on a real card), not the `landPortalFacts` sheet the API already projected, so seven retained parcel fields read "Not supplied". The sheet answers first; `Structure Year Built` is read; under-10% slope comes from the bins. New Overview sections: Public record, Exit strategy, acreage-band table. `officialParcelGis` reports "searched, no match" with its attempts.

**6. The office that COLLECTS the tax is scheduled, funded, and reported.** An assessor levies; the trustee / treasurer / tax collector takes payment and alone publishes standing. The extraction existed and never ran: deep-record mode re-resolved `recorder` and `planning` when the cached county map lacked them but never `tax`, and LandPortal consumed the whole 120s budget, so the county lane logged "queued for the next run" every run. `tax` is now a required department and 45s is reserved for that lane, capped at a third of the budget, only when it will run. `tax-status-research.ts` names the office by state, carries ONE `deriveTaxStanding` rule shared with the browser extraction, and reports standing, amount owed, unpaid years, penalties and tax-sale status — or the sources attempted and the blocker, separating "reached and published nothing" from "never reached". Standing is never inferred. Live: Official Assessor and Official Tax Office both reached.

# Remaining Work
1. Three failures proven to predate this sprint: `deal-intelligence-run` (child status), `research-status` (expects `incompleteArea.label`, never present), `memory-bootstrap` (at its cap).
2. Williamson TN publishes no online payment status; the reached tax office exposed no such field. Realtor.com searched 8 verified routes and published no qualifying comp. Neither is a defect.
3. Three Show-on-Map comparables carry APN, price and acreage but no address or date, so they cannot be geocoded. Shown as asking references, missing fields disclosed. Elevation differs between captures; not chased.

# Exact Next Action
Await Tyler's direction. Do not begin a sprint.

# Relevant Files
New: `tax-status-research.ts` (+test), `comparable-surface-generation.test.ts`. `src/landos/`: `property-inspection.ts` (+test), `landportal-facts.ts` (+test), `property-card.ts`, `comps-valuation.ts`, `deal-intelligence-run.ts`, `official-parcel-gis-view.ts`, `county-records-browser.ts`, `public-property-intelligence-live.ts`, `routes.ts`. `web/src/`: three AcquisitionWorkspaceV2 files, `workspace-v2-lead-design.css`.

# Relevant Records
Fairview: opportunity 88 / deal card 89 / property card 79, `Map 042 Parcel 123, Fairview, TN`. APN `042-123.00-000`, FIPS `47187`, Williamson TN, LANDSOUTH LLC, 75.91 ac, LP id `154591092`, ZIP 37062. `/dept/acquisitions/v2?deal=89`.

# Known Blockers
None

# Do Not Inspect or Modify
`src/dashboard.ts`, `src/dashboard.contract.test.ts`, `web/src/pages/BrowserConnect.tsx` are pre-existing uncommitted BROWSER-PAIRING work, deliberately dirty. Never stage, revert, clean or tidy them. Same for untracked `.landos/tasks/`, `.omp/`, `scripts/omp/`, `scripts/landos/comp-lane-probe.mjs`, `scripts/landportal/capture-comp-locations.mjs`. Leave `.env`, secrets, the operator's Chrome and live Codex alone.

# Runtime State
Healthy on 3141, restarted onto this change. Tabs closed, probe scripts removed, no paid API called.

# Verification Required
Re-verify on a change to the terrain quarantine, `acreageBasesFor`, `currentComparables`, the retained-comparable read or surface counters, `retainedParcelCentroid` / `promoteRetainedParcelEnrichment`, the post-run location pass, the `landPortalFacts` prop, `deriveTaxStanding`, `requiredDepartmentTypes`, or the official-records reserve — and, unchanged, the prior-sprint seams: `documentUrlIdentity`, `sectionCitationLabel`, `nameCardFromCanonicalIdentity`, the enrichment handoff, the section parser, the lot-area vocabulary, the delegation rule, the series walk, the merge order. Rerun the suites in Relevant Files plus `landportal-comp-card-detail`, `property-intelligence-presentation-ui`, `routes`; read Deal 89's three sections.

# Completed and Protected
Unchanged and protected: Universal Property Resolution, LandPortal subject re-aim, official document intelligence, the 9490 Elk Lake Rd valuation, the 5170 Hwy 60 identity, the three-workspace lead UI, Property Backstory, controlling land-use authority, the land-use projection, reproducible regulation retrieval, the delegated-lot-area read, the cited section, one entry per document, one marker per citation, a card named by its identity. Newly protected: a quarantine retains its observation; buildability reconciles against any published basis; a comparable generation is per surface; centroid and ZIP reach the card as enrichment only; a run places its own comparables; panels read the canonical fact sheet; the collecting office is scheduled, funded, reported.
