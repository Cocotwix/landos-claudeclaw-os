# Current Active Task
None in progress. The subdivision-regulation retrieval repair is complete, verified, committed and pushed to `main` at `b79d224`. Await Tyler's direction; do not begin another sprint.

# Exact Operator Outcome
Once LandOS establishes the controlling subdivision authority, the same jurisdiction's official subdivision-regulation set is found, retained and reused, so rerunning research on `Map 042 Parcel 123, Fairview, Tennessee` returns the same rules every time, including the minor/major threshold, and the 119-lot history reads consistently as major subdivision.

# Current State


<!-- DERIVED:START -->
- **Generated:** 2026-08-16T08:47:32.170Z
- **HEAD at generation:** `b79d224`
- **Worktree:** DIRTY; 11 modified/untracked paths at refresh time. Preserve unrelated changes.
- **Latest tests:** PASS on the focused suites at 2026-08-16T05:51:26.0000000Z; 272 focused across seven suites: subdivision-regulation-retention 12 (new), property-backstory-zoning-subdivision 50, land-use-source-racing 39, ordinance-text 14, land-use 114, landos 22 (schema), jurisdiction-and-pdf-identity 21. No full-suite run, by instruction.
- **Latest typecheck:** PASS at 2026-08-16T05:45:00.0000000Z; tsc --noEmit reports zero errors.
- **Latest production build:** PASS on both halves at 2026-08-16T05:44:00.0000000Z; vite build and tsc both clean; dist rebuilt and the managed runtime restarted onto it.
- **Managed runtime:** RUNNING and healthy on port 3141, HTTP 200, rebuilt and restarted at 2026-08-16T05:47:00.0000000Z; PID 35976; http://localhost:3141.
- **Prior tracked sprint:** sprint-2026-08-04-pi-workflow-finish (complete); it is not the Current Active Task.
- **Sprint ledger:** .landos/sprints/sprint-2026-08-04-pi-workflow-finish/ledger.json; proof report .landos/sprints/sprint-2026-08-04-pi-workflow-finish/report.md; frozen capabilities: 3 (.landos/capabilities.json).
<!-- DERIVED:END -->
# Completed and Proven
Retrieval of one jurisdiction's regulations was a lottery: four live runs on Fairview returned Articles 1+4, then Article 2, then Article 1 alone, then nothing. Three causes, each repaired at its root.

1. **The set is completed, not sampled.** Subdivision regulations are published as a numbered series. Once any part is read and confirmed as the government's own, the rest is walked from that government's own URL pattern in bounded rounds. Search order stops deciding which articles the operator sees.
2. **The set is retained against the government.** `landos_regulation_document` records every document actually opened and read as a jurisdiction's own, keyed by authority name, level and state, so the next run fetches it directly. A run that reaches less than the last one keeps what was established: a rule is carried forward only when its source document was NOT re-read, and each carried rule says so.
3. **What is opened, and what wins, are both defined.** Web-discovery ranking matched `planning`, `codes` and `.pdf`, so four planning packets outranked the town's own regulations and a live run ended with no rules at all; it now ranks on the document naming itself as regulations. Rules merge in a defined order (adopted before proposed, official before secondary, then series order), so a rule stated in two articles is always cited to the same one. Two articles of one set no longer report as a conflict.

Live result: five consecutive retrievals, four through the production capability and the fifth through the operator's Re-run research button, all returned the same 26 rules from the same 10 official documents, `statedMaxMinorLots` 2 from Article II's own definition, and `major subdivision` for the 119-lot record. Deal Card 89 shows it.

# Remaining Work
1. `minimum_lot_size` is still not extracted from Fairview's regulations, so the theoretical lot count reports UNKNOWN. Correct behaviour of the numeric-rule guard, but the rule is in Article IV and worth re-reading.
2. Some section citations read as page footers (`Article 1 - Page`) because `SECTION_NEAR` matches the running footer of a PDF. Cosmetic but visible on the card.
3. Fairview publishes Article 8 at two paths (`/content/` and `/wp-content/`), so the retained set holds one duplicate and pays one extra fetch per run.
4. Fairview publishes no queryable zoning layer, so current zoning stays UNRESOLVED. Correct, not a defect.
5. No lane establishes road frontage from an official source, so the frontage ceiling stays UNKNOWN.

# Exact Next Action
Stop and await Tyler's direction. Nothing is half-built and nothing is blocked. If he picks up Remaining Work item 1, start by re-reading Article IV's lot-size wording against the numeric-rule guard in `ordinance-text.ts`.

# Relevant Files
New: `src/landos/regulation-document-store.ts`, `src/landos/subdivision-regulation-retention.test.ts`. Modified: `src/landos/subdivision-regulations.ts` (series completion, retained lane, ordered merge, carry-forward, ranking), `src/landos/post-resolution-capabilities.ts` (retention wiring), `src/landos/land-use-intelligence-store.ts` (`readSubdivisionRegulationsHistory`), `src/landos/db.ts` (`landos_regulation_document`), `src/landos/official-site-store.ts` (`jurisdictionKey` exported).

# Relevant Records
Fairview: opportunity 88 / deal card 89 / property card 79. APN `042-123.00-000` (county form `042 123.00`), FIPS `47187`, Williamson County TN, LANDSOUTH LLC, 75.91 ac, LandPortal id `154591092`. Regulations: `FAIRVIEW-SUBDIVISION-REGULATIONS.pdf` plus Articles 1-9 on `fairview-tn.org`; Article 1 calls itself PROPOSED and is used only where no adopted article states the rule. Workspace: `/dept/acquisitions/v2?deal=89`.

# Known Blockers
None. No approval gate is pending and no external blocker is open.

# Do Not Inspect or Modify
The pre-existing uncommitted browser-pairing files `src/dashboard.ts`, `src/dashboard.contract.test.ts`, `web/src/pages/BrowserConnect.tsx`, and the untracked paths `.landos/tasks/`, `.omp/`, `scripts/omp/`, `scripts/landos/comp-lane-probe.mjs`, `scripts/landportal/capture-comp-locations.mjs`. Do not stage, revert or clean any of them. Also leave `.env`, secrets, the operator's Chrome and live Codex processes alone.

# Runtime State
Managed runtime running and healthy on 3141, rebuilt and restarted onto this change. The dedicated LandOS automation browser is up on `127.0.0.1:9224` with three pages its own lane cleanup preserved. The one browser tab this session opened was closed. No paid API was called.

# Verification Required
Re-verify only on a change to the regulation series walk, the retained set, the rule merge order, or the web-discovery ranking: rerun `subdivision-regulation-retention`, `property-backstory-zoning-subdivision`, `land-use-source-racing`, `ordinance-text`, `land-use`, `landos`, `jurisdiction-and-pdf-identity`, then exercise Deal 89 in the browser.

# Completed and Protected
Universal Property Resolution, LandPortal subject re-aim, official document intelligence, the 9490 Elk Lake Rd valuation behaviour, the 5170 Hwy 60 identity, and the three-workspace lead UI are unchanged. Property Backstory, controlling land-use authority and the land-use projection still reach the operator. Current zoning is untouched and still honestly UNRESOLVED. Invariants 2-4 hold: retention decides which documents are OPENED, never what is true; every document is re-tiered and re-extracted every run; nothing here moves canonical identity.
