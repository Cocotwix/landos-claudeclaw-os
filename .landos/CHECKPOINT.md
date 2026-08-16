# Current Active Task
None in progress. The section-citation repair is complete, verified, committed and pushed to `main` at `57b7d9f`. Await Tyler's direction; do not begin another sprint.

# Exact Operator Outcome
Every subdivision rule on `Map 042 Parcel 123, Fairview, Tennessee` cites the section it is actually printed under. The delegated lot-area rule reads `§ 4 - 110.2`, the heading above it, instead of `4-102.2`, a cross-reference about critical lots printed in the sentence before it. No rule cites a PDF running footer. A citation an operator clicks through to now lands on the rule they were reading.

# Current State

<!-- DERIVED:START -->
- **Generated:** 2026-08-16T15:56:56.042Z
- **HEAD at generation:** `57b7d9f`
- **Worktree:** DIRTY; 11 modified/untracked paths at refresh time. Preserve unrelated changes.
- **Latest tests:** PASS on the focused suites at 2026-08-16T15:47:00.0000000Z; 287 focused across seven suites: property-backstory-zoning-subdivision 57 (2 new), subdivision-regulation-retention 12, land-use-source-racing 39, ordinance-text 22 (8 new), land-use 114, landos 22 (schema), jurisdiction-and-pdf-identity 21. No full-suite run, by instruction.
- **Latest typecheck:** PASS at 2026-08-16T15:47:00.0000000Z; tsc --noEmit reports zero errors.
- **Latest production build:** PASS on both halves at 2026-08-16T15:36:00.0000000Z; vite build and tsc both clean; dist rebuilt and the managed runtime restarted onto it.
- **Managed runtime:** RUNNING and healthy on port 3141, HTTP 200, rebuilt and restarted at 2026-08-16T15:37:00.0000000Z; PID 59228; http://localhost:3141.
- **Prior tracked sprint:** sprint-2026-08-04-pi-workflow-finish (complete); it is not the Current Active Task.
- **Sprint ledger:** .landos/sprints/sprint-2026-08-04-pi-workflow-finish/ledger.json; proof report .landos/sprints/sprint-2026-08-04-pi-workflow-finish/report.md; frozen capabilities: 3 (.landos/capabilities.json).
<!-- DERIVED:END -->

# Completed and Proven
One repair, one root, proven live on Deal Card 89.

**A citation is the heading a rule is printed under.** Three extractors each carried a copy of one regex plus "take the last section reference before the passage", which reads a document as if the only way to print a section is to write the word. The copies are now one shared parser in `ordinance-text.ts`: it finds every candidate, classifies each as a HEADING introducing a passage or a reference inside a sentence, and prefers the nearest heading. A reference is used only where no heading is in range, never in preference to one.

Three failure modes closed, system-wide, no jurisdiction hardcoded:

1. **Bare numbered headings read as headings.** `4-110.2 Lot Dimensions` carries no keyword. Without one, a number is a citation only when it is a heading, so a quantity, a date or a list ordinal can never become one.
2. **Running footers cannot become citations.** Each component after the first is digits or a one/two letter suffix, which keeps `Page` out of the number, and a candidate followed by `Page` or `of N` is dropped.
3. **Digits split by the PDF text layer are rejoined.** Fairview prints `2-101.203`; the text layer renders `2 - 10 1.203` and it was cited as `1.203`. Found by reading the adopted PDF during acceptance, not from a fixture. Spacing around separators stays as printed.

On the live card: the delegation cites `4 - 110.2`; all five footer citations are gone; eight rules that carried no section now carry one; `easement_or_access_requirement` no longer cites Tennessee Code `13-4-308` as a Fairview section. Changed citations were spot-verified against the PDF. The protected read is unchanged: 27 rules, `statedMaxMinorLots` 2, lot count still unresolved with the delegation quoted as its reason.

# Remaining Work
1. Fairview publishes Articles 2 and 8 at both `/content/` and `/wp-content/`, so the retained set holds duplicates and pays extra fetches per run. Discovery variance, deferred by instruction; not caused by the citation work. The set moved 12 to 13 documents on the acceptance run, same cause.
2. Cosmetic: the card prefixes `§ ` to the verbatim citation, so a document that prints the keyword shows `§ Section 6 - 108`. Pre-existing, deferred by instruction; the keyword form is an accepted test expectation.
3. Fairview publishes no queryable zoning layer, so current zoning stays UNRESOLVED. Correct, not a defect, and it is what the lot count waits on.
4. No lane establishes road frontage from an official source, so the frontage ceiling stays UNKNOWN.

Not outstanding: failed-run / current-snapshot divergence. `readDerivedSnapshotHistory` returns only `superseded` rows, oldest first, deliberately excluding the current snapshot, and a failed run never demotes it. Do not re-derive.

# Exact Next Action
Stop and await Tyler's direction. Nothing is half-built and nothing is blocked.

# Relevant Files
This repair: `src/landos/ordinance-text.ts` (the shared parser: `sectionCitationBefore`, `sectionCitationIn`), `src/landos/ordinance-text.test.ts` (8 new), `src/landos/subdivision-regulations.ts` and `src/landos/zoning-standards-research.ts` (duplicate parsers deleted, both call the shared one), `src/landos/property-backstory-zoning-subdivision.test.ts` (2 new). Unchanged this time: `subdivision-property-read.ts`, `regulation-document-store.ts`, `post-resolution-capabilities.ts`, `land-use-intelligence-store.ts`.

# Relevant Records
Fairview: opportunity 88 / deal card 89 / property card 79. APN `042-123.00-000` (county form `042 123.00`), FIPS `47187`, Williamson County TN, LANDSOUTH LLC, 75.91 ac, LandPortal id `154591092`. Regulations: `FAIRVIEW-SUBDIVISION-REGULATIONS.pdf` plus Articles 1-9 on `fairview-tn.org`; Article 1 calls itself PROPOSED and is used only where no adopted article states the rule. Workspace: `/dept/acquisitions/v2?deal=89&section=property-market`.

# Known Blockers
None. No approval gate is pending and no external blocker is open.

# Do Not Inspect or Modify
`src/dashboard.ts`, `src/dashboard.contract.test.ts` and `web/src/pages/BrowserConnect.tsx` are pre-existing uncommitted BROWSER-PAIRING work, separate from everything above and deliberately left dirty. They survived this sprint untouched and unstaged and must keep surviving: do not stage, revert, clean or "tidy" them. Same for the untracked paths `.landos/tasks/`, `.omp/`, `scripts/omp/`, `scripts/landos/comp-lane-probe.mjs`, `scripts/landportal/capture-comp-locations.mjs`. Also leave `.env`, secrets, the operator's Chrome and live Codex processes alone.

# Runtime State
Managed runtime running and healthy on 3141, rebuilt and restarted onto this change. The dedicated LandOS automation browser is up on `127.0.0.1:9224`. The one browser tab this session opened was closed. No paid API was called.

# Verification Required
Re-verify only on a change to the shared section parser, its heading / cross-reference classification, the footer guard, the split-digit rejoin, or a call site of `sectionCitationBefore` / `sectionCitationIn` — and, unchanged, to the lot-area vocabulary, the delegation rule, the series walk, the retained set, the merge order or the web-discovery ranking. Rerun `ordinance-text`, `property-backstory-zoning-subdivision`, `subdivision-regulation-retention`, `land-use-source-racing`, `land-use`, `landos`, `jurisdiction-and-pdf-identity`, then read the citations on Deal 89's Subdivision rules & feasibility in the browser.

# Completed and Protected
Universal Property Resolution, LandPortal subject re-aim, official document intelligence, the 9490 Elk Lake Rd valuation behaviour, the 5170 Hwy 60 identity, and the three-workspace lead UI are unchanged. Property Backstory, controlling land-use authority and the land-use projection still reach the operator. Reproducible regulation retrieval, the delegated-lot-area read, and now the section a rule is cited to, are proven and protected. Invariants 2-4 hold: retention decides which documents are OPENED, never what is true; a delegation names where a standard lives, never what it is; a citation names where a rule is printed, never what it says.
