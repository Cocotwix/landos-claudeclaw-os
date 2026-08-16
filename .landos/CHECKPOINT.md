# Current Active Task
None in progress. The Fairview acceptance repair set is committed and pushed to `main` at `5816a5e`. Await Tyler's direction; do not begin another sprint.

# Exact Operator Outcome
One operator-facing Deal Card for `Map 042 Parcel 123, Fairview, Tennessee` created through the normal New Lead intake, resolved to the correct parcel, and carrying its promoted land-use intelligence in the workspace. Rerunning research on it promotes cleanly instead of being discarded.

# Current State

- **Generated:** 2026-08-16T05:14:12.000Z
- **HEAD at generation:** `5816a5e`
- **Worktree:** DIRTY; 9 paths, all pre-existing and none owned by this work.
- **Latest tests:** PASS. 216 focused across the six affected suites: `jurisdiction-and-pdf-identity` 21, `property-intelligence-snapshot` 32, `apn-punctuation` 21, `landportal-facts` 21, `landportal-api` 7, `land-use` 114. Earlier in the session `land-use-source-racing` 39, `ordinance-text` 14, `property-backstory-zoning-subdivision` 50, `universal-property-resolution` 17, `due-diligence-merge` 6, `phase5-apn-subject-variants` 6, `hermes-landportal-sidebar-facts` 15, `land-score-provider-data` 8. No full-suite run this session, by instruction.
- **Latest typecheck:** PASS. `tsc --noEmit` reports zero errors. The retained-comp break named in earlier checkpoints is gone from `main`.
- **Latest production build:** PASS on both halves (`vite build` and `tsc`).
- **Web typecheck:** 65 pre-existing errors across unrelated files; none in any file this session touched. `vite build` does not typecheck, so this blocks nothing.
- **Managed runtime:** RUNNING and healthy on port 3141, HTTP 200, rebuilt and restarted after the commit so it matches HEAD.
- **The dirty paths:** `src/dashboard.ts`, `src/dashboard.contract.test.ts` and `web/src/pages/BrowserConnect.tsx` are PRE-EXISTING UNCOMMITTED BROWSER-PAIRING WORK, are not part of `main`, and were deliberately excluded from `5816a5e`. Untracked: `.landos/tasks/retained-comp-reconciliation.md`, `.omp/extensions/landos-session-stop.ts`, `scripts/omp/session-stop-guard.mjs`, `scripts/omp/session-stop-guard.test.mjs`, `scripts/landos/comp-lane-probe.mjs`, `scripts/landportal/capture-comp-locations.mjs`.

# Completed and Proven
Four defects found by running Fairview through the real workflow, each repaired at its shared root and proven on the live Deal Card.

1. **Municipal sources are recognised.** The officiality verdict is county/state scoped, so a city on a non-`.gov` domain scored "unverified" and its own planning packets were never opened. A host corroborated as the locality's own government domain now clears the gate. `hostCorroboratesLocality` was tightened in the same change: off a government TLD the label must read as the jurisdiction and nothing else, so `fairview-tn` passes and `fairview-tn-realty` does not.
2. **Reruns promote.** `042 123.00` and `042-123.00-000` are one parcel; the promotion guard read them as two and discarded whole runs. `apnEquivalent` drops trailing all-zero sub-parcel segments only, so `042 123.00 001` still differs from its parent.
3. **Promoted land-use intelligence reaches the operator.** The source-racing lanes never write a `land_use_determination` row, so the panel said "run land-use research" while holding a confirmed authority. A read-only projection now renders authority, current zoning, backstory and subdivision rules in the existing panel.
4. **No code ids shown as values.** The LandPortal internal API returns set-valued fields as a Postgres literal of internal ids; `{16}` reached the operator. One shared rule joins labels and drops an all-numeric set at ingest, at the fact-sheet read, and at the sidebar-fact route projection.

Live result on the Deal Card: authority Confirmed for Fairview zoning and subdivision from the city's own packet; Property Backstory carrying the four dated Kingwood Subdivision matters including the 119-lot master development plan; current zoning honestly UNRESOLVED with its historical districts labelled as history; water feature showing a clean not-supplied state.

# Remaining Work
1. **Subdivision document retrieval varies run to run.** Keyless search surfaced Fairview Articles 1+4 (18 rules), then Article 2 (thresholds, and the "2 lots or fewer vs 119 indicated → major subdivision" call), then Article 1 alone (5 rules), then nothing. The 119-lot major-subdivision conclusion is therefore not reliably reproducible on the card. Deferred by instruction.
2. **A failed run's snapshots are stored `current` but never rendered.** Run 205 wrote nine snapshots marked `current` while the workspace kept rendering its unpromoted predecessor, so storage and display disagreed about what is current. Deferred by instruction.
3. Fairview publishes no queryable zoning layer, so current zoning stays UNRESOLVED. Correct behaviour, not a defect.
4. No lane establishes road frontage from an official source, so the frontage ceiling stays UNKNOWN.

# Exact Next Action
Stop and await Tyler's direction. Nothing is half-built and nothing is blocked. If he picks up Remaining Work item 1, start by making the subdivision-article retrieval deterministic rather than search-order dependent.

# Relevant Files
Repairs: `src/landos/official-pdf-identity.ts`, `src/landos/property-intelligence-snapshot.ts`, `src/landos/land-use-view.ts`, `src/landos/landportal-api.ts`, `src/landos/landportal-facts.ts`, `src/landos/routes.ts`. Panel: `web/src/components/AcquisitionWorkspaceV2LandUse.tsx`, `web/src/components/AcquisitionWorkspaceV2PropertyIntelligence.tsx`, `web/src/pages/AcquisitionWorkspaceV2.tsx`. Tests: `src/landos/jurisdiction-and-pdf-identity.test.ts`, `src/landos/property-intelligence-snapshot.test.ts`, `src/landos/landportal-facts.test.ts`.

# Relevant Records
Fairview: opportunity 88 / deal card 89 / property card 79. APN `042-123.00-000` (county form `042 123.00`), FIPS `47187`, Williamson County TN, LANDSOUTH LLC, 75.91 ac, LandPortal id `154591092`. Source document: the City of Fairview planning commission packet on `fairview-tn.org`. Workspace: `/dept/acquisitions/v2?deal=89`. Deals 87 and 88 carried the same water-feature code set and are also corrected.

# Known Blockers
None. No approval gate is pending and no external blocker is open.

# Do Not Inspect or Modify
The three pairing-owned files named in Current State, and the five untracked paths. Do not stage, revert, build on, or "clean up" any of them. Also leave `.env`, secrets, the operator's Chrome, and live Codex processes alone.

# Runtime State
Managed runtime running and healthy on 3141 after a post-commit rebuild and restart. The dedicated LandOS automation browser is up on `127.0.0.1:9224` holding a small number of LandPortal pages its own lane cleanup preserved. No paid API was called this session.

# Verification Required
None outstanding. Re-verify only on a change to parcel-identity equivalence, the officiality gate, or the land-use projection: rerun the six focused suites named in Current State and exercise Deal 89 in the browser.

# Completed and Protected
Universal Property Resolution, LandPortal subject re-aim, official document intelligence, the 9490 Elk Lake Rd valuation behaviour, the 5170 Hwy 60 identity, and the three-workspace lead UI are unchanged. Property Backstory, controlling land-use authority, current zoning and subdivision intelligence are on `main` and now reach the operator surface. Invariants 2-4 hold: the APN change widens equivalence only for one rendering of one parcel and can never merge two parcels, and no generated summary moves canonical identity.
