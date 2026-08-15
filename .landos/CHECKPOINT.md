# Current Active Task
Property Backstory, controlling land-use authority, current zoning, allowed uses and subdivision intelligence, with SOURCE RACING as the retrieval doctrine. Committed and pushed on `sprint/property-backstory-zoning-subdivision`. NOT merged to `main`. Await Tyler's direction; do not begin another sprint.

# Exact Operator Outcome
After one confirmed parcel, every land-use question races retained evidence, indexed web search, direct GIS/API and official documents concurrently, browser held as escalation; the first sufficiently authoritative answer releases and slower lanes corroborate. Fairview: authority Confirmed from retained evidence in ~11ms with no network call, current zoning honestly UNRESOLVED with the 2024 packet refused as current, adopted subdivision regulations with sections, and `minor review at 3 lots or fewer vs 119 indicated → major subdivision`.

# Current State

<!-- DERIVED:START -->
- **Generated:** 2026-08-15T17:20:44.447Z
- **HEAD at generation:** `a53b25b`
- **Worktree:** DIRTY; 26 modified/untracked paths at refresh time. Preserve unrelated changes.
- **Latest tests:** PASS on the focused and adjacent suites at 2026-08-15T13:08:45.0000000Z; Land-use suites 103/103 (14 ordinance-text, 39 source-racing, 50 backstory/zoning/subdivision). Adjacent suites 76/76 (Universal Property Resolution, Fairview sparse-input, LandPortal re-aim, document intelligence, mission). The last full-suite run, at 07:58 before the source-racing closeout, was 409 files / 5752 pass against a stash-measured baseline of 408 / 5702 on the same HEAD: zero new failures. No full run since, by instruction.
- **Latest typecheck:** FAIL only on the pre-existing retained-comp break at 2026-08-15T13:08:45.0000000Z; With the committed comps-valuation.ts splice bypassed locally, tsc reports zero errors in any new or modified file; the 4 remaining errors are the known comps-valuation.ts and comps.ts breakage on main.
- **Latest production build:** WEB PASS, SERVER FAIL on the same pre-existing break at 2026-08-15T07:57:00.0000000Z; vite build clean in 10.6s. The tsc server half stops on the same comps-valuation.ts splice, unchanged by this sprint. Not re-run after the source-racing closeout, which touched no web asset.
- **Managed runtime:** NOT EXERCISED; no server, no browser, no CDP, no port 3141 traffic at 2026-08-15T13:10:00.0000000Z; PID 0; not started.
- **Prior tracked sprint:** sprint-2026-08-04-pi-workflow-finish (complete); it is not the Current Active Task.
- **Sprint ledger:** .landos/sprints/sprint-2026-08-04-pi-workflow-finish/ledger.json; proof report .landos/sprints/sprint-2026-08-04-pi-workflow-finish/report.md; frozen capabilities: 3 (.landos/capabilities.json).
<!-- DERIVED:END -->

- `land-use-source-race.ts` is the retrieval engine: lanes run concurrently, a gate decides sufficiency, losers corroborate or raise a conflict, re-aim is bounded, browser is an `escalation` lane. Retained lanes get a one-tick fast path, so a question storage answers costs no network call.
- Four subsystems race on it: authority, current zoning, allowed uses/standards, subdivision rules. Each carries a `race` record naming every method attempted, the winner, and what was still running at release.
- Allowed uses and dimensional standards are NEW; the prior pass declared an `ordinanceText` dependency no caller supplied, so those fields were always null.
- `ordinance-text.ts` answers "where does a rule end" and "which district's block is this": flattens PDF wrapping, completes a value to its sentence end, refuses contents lines and unmeasured passages.
- New `supporting` lanes `property_backstory` and `subdivision_feasibility`; nothing `dependsOn` either. `zoning_land_use` is upgraded in place.
- Persistence reuses the two existing tables via `derived-intelligence-store.ts`; no new table. GEOGRAPHY IS NOT AUTHORITY, and history can never establish current zoning: both enforced in code.

# Completed and Proven
- Focused suites 103/103: 14 ordinance-text, 39 source-racing, 50 backstory/zoning/subdivision. Adjacent 76/76 (Universal Property Resolution, Fairview sparse-input, LandPortal re-aim, document intelligence, mission).
- Six live-run defects are now permanent regressions: a 2024 packet establishing current zoning; a packet mined as subdivision regs; a zoning ordinance accepted as subdivision regs; `"street frontage"` released as a frontage standard; a contents line released as a road rule; a cross-reference released as a minimum lot size.
- Live Fairview passes end to end, keyless and browserless; durability proven by clearing in-process caches and re-reading from SQLite.

# Remaining Work
1. Some non-numeric subdivision rules return thin prose fragments (`public_private_road_rule`). Verbatim and sourced, so not wrong, but not a useful statement of the rule. A normative-verb gate would sharpen it at the cost of more unknowns.
2. Allowed-use/standards retrieval depends on keyless search surfacing the city's zoning ordinance, which varies run to run. The truncation and passage-selection fixes are unit-proven; the standards path was not re-confirmed live.
3. Fairview publishes no queryable zoning layer or parcel-level lookup, so current zoning stays UNRESOLVED; the race records every route attempted.
4. No lane establishes road frontage, so the frontage ceiling is always UNKNOWN and lands on the diligence list.

BLOCKING AND PRE-EXISTING ON `main`, untouched: `comps.ts` imports `./comp-location-reconciliation.js`, never committed, and `comps-valuation.ts` carries a `subjectIdentity` fragment spliced into a comment at lines 2070-2075 (`1b699d8`). That missing import makes 55 test files fail to load.

# Exact Next Action
Stop. Branch pushed, unmerged. Await Tyler's decision on merging to `main` and on Remaining Work item 1.

# Relevant Files
All under `src/landos/`. Engine: `src/landos/land-use-source-race.ts`, `land-use-lanes.ts`, `land-use-source-authority.ts`, `ordinance-text.ts`. Research: `property-backstory{,-run,-store}.ts`, `controlling-land-use-authority.ts`, `current-zoning-determination.ts`, `zoning-standards-research.ts`, `zoning-layer-discovery.ts`, `subdivision-regulations.ts`, `subdivision-property-read.ts`. Persist/handoff: `derived-intelligence-store.ts`, `land-use-intelligence-store.ts`, `pre-call-intelligence-handoff.ts`, `post-resolution-capabilities.ts`. Modified: `deal-intelligence-mission.ts`, `property-intelligence-specialists.ts`, `routes.ts`. Tests: `ordinance-text`, `land-use-source-racing`, `property-backstory-zoning-subdivision`, `fairview-post-resolution.live` (gated on `LANDOS_LIVE_SEARCH=1`).

# Relevant Records
Fairview: `Map 042 Parcel 123`, Williamson County TN, APN `042 123.00`, LANDSOUTH LLC, 75.86 ac, Kingwood Subdivision. Snapshots `*_v1`: property_backstory, land_use_authority, current_zoning, zoning_standards, subdivision_regulations, subdivision_property_read. Route: `GET /api/landos/deal-cards/:id/pre-call-intelligence`.

# Known Blockers
The pre-existing retained-comp break blocks a green `tsc --noEmit` and the `tsc` half of `npm run build` on `main`. It blocks nothing in this sprint.

# Do Not Inspect or Modify
The primary worktree `claudeclaw-os` and its dirty paths, the stash `landos-duke-overarchitecture-hold`, `.env`, secrets, `claudeclaw-os-latest`, live Codex processes, operator Chrome. Do not repair retained-comp code here.

# Runtime State
Not exercised: no managed start/stop/restart/health, no port 3141 or 3142 traffic, no browser, no CDP, no paid API. The live acceptance ran the production code paths directly.

# Verification Required
None. Re-verify only after the retained-comp break is repaired: rerun `tsc --noEmit` and the full suite; expect the 55 load failures to clear.

# Completed and Protected
Universal Property Resolution, LandPortal subject re-aim, official document intelligence, the 9490 Elk Lake Rd valuation behaviour, the 5170 Hwy 60 identity and the three-workspace lead UI are unchanged. Invariants 2-4 hold: nothing here moves canonical identity, and every retained finding was anchored to the subject parcel first.
