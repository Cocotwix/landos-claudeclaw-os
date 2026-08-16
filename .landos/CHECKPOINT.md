# Current Active Task
None in progress. The minimum-lot-size / delegated-lot-area repair is complete, verified, committed and pushed to `main` at `7a4029c`. Await Tyler's direction; do not begin another sprint.

# Exact Operator Outcome
Rerunning research on `Map 042 Parcel 123, Fairview, Tennessee` returns the same official subdivision-regulation set every time, and the lot-area standard reads honestly. Fairview's adopted regulations state no numeric minimum lot size: they delegate lot area to the zoning ordinance, the card says so and cites it, and the theoretical lot count stays unresolved until the current zoning district is established rather than being guessed.

# Current State

<!-- DERIVED:START -->
- **Generated:** 2026-08-16T10:12:40.385Z
- **HEAD at generation:** `7a4029c`
- **Worktree:** DIRTY; 11 modified/untracked paths at refresh time. Preserve unrelated changes.
- **Latest tests:** PASS on the focused suites at 2026-08-16T08:58:00.0000000Z; 279 focused across seven suites: property-backstory-zoning-subdivision 57 (7 new), subdivision-regulation-retention 12, land-use-source-racing 39, ordinance-text 14, land-use 114, landos 22 (schema), jurisdiction-and-pdf-identity 21. No full-suite run, by instruction.
- **Latest typecheck:** PASS at 2026-08-16T09:00:00.0000000Z; tsc --noEmit reports zero errors.
- **Latest production build:** PASS on both halves at 2026-08-16T09:02:00.0000000Z; vite build and tsc both clean; dist rebuilt and the managed runtime restarted onto it.
- **Managed runtime:** RUNNING and healthy on port 3141, HTTP 200, rebuilt and restarted at 2026-08-16T09:03:00.0000000Z; PID 115864; http://localhost:3141.
- **Prior tracked sprint:** sprint-2026-08-04-pi-workflow-finish (complete); it is not the Current Active Task.
- **Sprint ledger:** .landos/sprints/sprint-2026-08-04-pi-workflow-finish/ledger.json; proof report .landos/sprints/sprint-2026-08-04-pi-workflow-finish/report.md; frozen capabilities: 3 (.landos/capabilities.json).
<!-- DERIVED:END -->

# Completed and Proven
Two repairs, one root each, both proven live on Deal Card 89.

1. **Retrieval is reproducible.** The series is walked from the government's own URL pattern, retained against the government in `landos_regulation_document`, and merged in a defined order (adopted before proposed, official before secondary, then series order). Five consecutive retrievals returned the same 26 rules from the same 10 official documents, `statedMaxMinorLots` 2, `major subdivision` for the 119-lot record.
2. **A lot-area standard is read however the regulations state it.** The extractor knew exactly one way to say "minimum lot size". It now reads the registers ordinances actually use, each alternative requiring an AREA unit so a frontage or lot-width measurement cannot enter, still behind the numeric guard. A standard the regulations DELEGATE is retained as its own key, `minimum_lot_size_deferred_to`, and can never be read as a number.

Fairview states no lot-area figure anywhere in its adopted set; all ten documents were fetched and swept. Article IV 4-110.2 says "Lot area shall comply with the minimum standards of the Zoning Ordinance". The card now carries that as its own rule, names it as the reason the count is unresolved, quotes it, cites the document, and puts obtaining the district's minimum from the zoning ordinance on diligence. A stated minimum always outranks a delegation. All 26 prior rules stayed byte-identical in value, section and source; exactly one rule was added.

# Remaining Work
1. Section citations are wrong where a document prints a bare numbered heading (`4-110.2 Lot Dimensions`): `SECTION_NEAR` requires the keyword, so it falls back to the last `Section N` before it, which is a cross-reference. It also matches PDF running footers (`Article 1 - Page`). Visible on the card; deliberately kept out of the delegation's calculation and diligence text, which cite the document only.
2. Fairview publishes Articles 2 and 8 at both `/content/` and `/wp-content/`, so the retained set holds two duplicates and pays two extra fetches per run. Discovery variance, not caused by the lot-area work.
3. Fairview publishes no queryable zoning layer, so current zoning stays UNRESOLVED. Correct, not a defect, and it is now exactly what the lot count waits on.
4. No lane establishes road frontage from an official source, so the frontage ceiling stays UNKNOWN.

Not outstanding: failed-run / current-snapshot divergence. `readDerivedSnapshotHistory` returns only `superseded` rows, oldest first, deliberately excluding the current snapshot, and a failed run never demotes it. Checked at this HEAD; do not re-derive.

# Exact Next Action
Stop and await Tyler's direction. Nothing is half-built and nothing is blocked.

# Relevant Files
This repair: `src/landos/subdivision-regulations.ts` (lot-area vocabulary, `minimum_lot_size_deferred_to`), `src/landos/subdivision-property-read.ts` (delegation consumed as the stated reason plus diligence), `src/landos/property-backstory-zoning-subdivision.test.ts` (7 new). Retrieval lane, unchanged this time: `regulation-document-store.ts`, `post-resolution-capabilities.ts`, `land-use-intelligence-store.ts`.

# Relevant Records
Fairview: opportunity 88 / deal card 89 / property card 79. APN `042-123.00-000` (county form `042 123.00`), FIPS `47187`, Williamson County TN, LANDSOUTH LLC, 75.91 ac, LandPortal id `154591092`. Regulations: `FAIRVIEW-SUBDIVISION-REGULATIONS.pdf` plus Articles 1-9 on `fairview-tn.org`; Article 1 calls itself PROPOSED and is used only where no adopted article states the rule. Workspace: `/dept/acquisitions/v2?deal=89`.

# Known Blockers
None. No approval gate is pending and no external blocker is open.

# Do Not Inspect or Modify
`src/dashboard.ts`, `src/dashboard.contract.test.ts` and `web/src/pages/BrowserConnect.tsx` are pre-existing uncommitted BROWSER-PAIRING work, separate from everything above and deliberately left dirty. They survived this sprint untouched and unstaged and must keep surviving: do not stage, revert, clean or "tidy" them. Same for the untracked paths `.landos/tasks/`, `.omp/`, `scripts/omp/`, `scripts/landos/comp-lane-probe.mjs`, `scripts/landportal/capture-comp-locations.mjs`. Also leave `.env`, secrets, the operator's Chrome and live Codex processes alone.

# Runtime State
Managed runtime running and healthy on 3141, rebuilt and restarted onto this change. The dedicated LandOS automation browser is up on `127.0.0.1:9224`. The one browser tab this session used was closed. No paid API was called.

# Verification Required
Re-verify only on a change to the lot-area vocabulary, the delegation rule, the regulation series walk, the retained set, the rule merge order, or the web-discovery ranking: rerun `property-backstory-zoning-subdivision`, `subdivision-regulation-retention`, `land-use-source-racing`, `ordinance-text`, `land-use`, `landos`, `jurisdiction-and-pdf-identity`, then exercise Deal 89 in the browser.

# Completed and Protected
Universal Property Resolution, LandPortal subject re-aim, official document intelligence, the 9490 Elk Lake Rd valuation behaviour, the 5170 Hwy 60 identity, and the three-workspace lead UI are unchanged. Property Backstory, controlling land-use authority and the land-use projection still reach the operator. Reproducible regulation retrieval and the delegated-lot-area read are both proven and protected. Invariants 2-4 hold: retention decides which documents are OPENED, never what is true; a delegation names where a standard lives, never what it is; nothing here moves canonical identity.
