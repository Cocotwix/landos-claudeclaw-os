# Current Active Task
None. The integration cleanup pass is complete, verified live on Deal Card 89, committed and pushed to `main` at `672a267`. Await Tyler's direction.

# Exact Operator Outcome
Rerunning `Map 042 Parcel 123, Fairview, Tennessee` gives one clean canonical property: the pipeline row and Deal Card name the parcel instead of "Unresolved parcel, Fairview, TN"; the list shows the ten documents Fairview publishes, not thirteen with three duplicates; `Section 6 - 108` is no longer printed `§ Section 6 - 108`; and retained document intelligence a run already paid for reaches the lanes that read it. Three consecutive reruns gave the identical read.

# Current State

<!-- DERIVED:START -->
- **Generated:** 2026-08-16T17:06:00.000Z
- **HEAD at generation:** `672a267`
- **Worktree:** DIRTY; 10 modified/untracked paths at refresh. Preserve unrelated changes.
- **Latest tests:** PASS at 2026-08-16T16:50:00Z; 569 focused across 28 suites, 21 new. No full-suite run, by instruction.
- **Latest typecheck:** PASS at 2026-08-16T16:49:00Z; tsc --noEmit zero errors.
- **Latest production build:** PASS at 2026-08-16T16:48:00Z; vite and tsc clean; dist rebuilt and the runtime restarted onto it.
- **Managed runtime:** RUNNING and healthy on port 3141, HTTP 200; PID 62020; http://localhost:3141.
- **Prior tracked sprint:** sprint-2026-08-04-pi-workflow-finish (complete); not the Current Active Task.
- **Sprint ledger:** .landos/sprints/sprint-2026-08-04-pi-workflow-finish/ledger.json; frozen capabilities 3.
<!-- DERIVED:END -->

# Completed and Proven
Four defects, four shared roots, proven live on Deal Card 89.

**1. A document is one document however a site spells its address.** Everything asked "have I got this URL", so Fairview serving its regulations at both `/content/` and `/wp-content/` gave two of each: extra fetches, duplicate rows, thirteen documents where ten are published. `document-url-identity.ts` is the single answer — scheme and `www.` dropped, `/wp-content/` read as `/content/`, path case and query kept. Used by the within-run merge, the series walk, the retained set, the carried-rule lookup, the store's read and write, and the backstory already-mined check. Where both spellings arrive the lower-sorting address wins, so the link never depends on search order. Live: 10 documents, 27 rules, `learned=10 offered=10`.

**2. A citation prints its marker once.** Six surfaces each prefixed `§ ` to a verbatim citation. `sectionCitationLabel` in `web/src/lib/format.ts` adds it only when the citation carries no marker of its own. Live: `§ 2 - 101.201`, `Section 6 - 108`.

**3. An identity names its card.** The title was rebuilt only by the manual owner-reconciliation route, so a resolved parcel kept its intake label everywhere else. `nameCardFromCanonicalIdentity` in `canonical-identity.ts` runs wherever an identity is established or reconciled. A NAME IS NOT A VERIFICATION CLAIM: a research-grade CANDIDATE names its card too, because "Unresolved parcel" is untrue of a parcel resolved to an APN, while how strongly it is held stays in the identity panel. Disputed, rejected, archived and unresolved name nothing, and it writes only over a LandOS stand-in label.

**4. Document mining lands before the lanes that read it.** The resolver mined already-downloaded PDFs fire-and-forget and nothing awaited it, while the parcel-identity handback releases the backstory, land-use and subdivision lanes — each of which opens by asking the document store what LandOS holds. On a fresh card the two raced, so one first run could give two different cards. The handback now waits, bounded at 15s (`DOCUMENT_ENRICHMENT_HANDOFF_MS`). Zero overruns logged.

The subdivision read that had degraded to "Likely path: not established" on the 14:36 run — the run that also wrote the duplicate `/wp-content/` rows — is restored and identical on all three reruns: `major_subdivision`, review body `Fairview planning commission (1 - 107.102)`, 119 lots against the 2-lot threshold.

# Remaining Work
1. Three stale `/wp-content/` rows remain in `landos_regulation_document` from the 14:36 run. Invisible: the read collapses them and prefers the address that carried the rules. Deleting needs approval and buys nothing.
2. Cards resolved before this pass keep an intake label until something re-runs on them. Deal 89 is fixed; no broader backfill was built.
3. Fairview publishes no queryable zoning layer, so current zoning stays UNRESOLVED. Correct, not a defect.
4. No lane establishes road frontage officially, so the frontage ceiling stays UNKNOWN.

Not defects, do not re-chase. `§ 4.102.1201` is verbatim: adopted Article 4 prints that heading, dot and all, verified against the PDF. Deal 89's canonical identity is `candidate`, not confirmed, because no official county record has confirmed it — invariant 2 working. Vitest writes into `logs/main.log` as `deal1`; pre-existing, so filter by `dealCardId`.

# Exact Next Action
Await Tyler's direction. Nothing is half-built or blocked. Do not begin another sprint.

# Relevant Files
New: `src/landos/document-url-identity.ts` (+ test). Changed, under `src/landos/` unless shown: `subdivision-regulations.ts`, `regulation-document-store.ts`, `post-resolution-capabilities.ts`, `property-backstory-run.ts`, `canonical-identity.ts`, `property-summary-legacy-adapter.ts`, `subject-identity-reconciliation.ts`, `property-intelligence-live.ts`, `web/src/lib/format.ts`, `web/src/components/AcquisitionWorkspaceV2LandUse.tsx`. Tests extended: matching `.test.ts` files.

# Relevant Records
Fairview: opportunity 88 / deal card 89 / property card 79, now titled `Map 042 Parcel 123, Fairview, TN`. APN `042-123.00-000` (county form `042 123.00`), FIPS `47187`, Williamson County TN, LANDSOUTH LLC, 75.91 ac, LandPortal id `154591092`. Regulations: `FAIRVIEW-SUBDIVISION-REGULATIONS.pdf` plus Articles 1-9 on `fairview-tn.org`; Article 1 says PROPOSED and is used only where no adopted article states the rule. `/dept/acquisitions/v2?deal=89&section=property-market`.

# Known Blockers
None. No approval gate pending, no external blocker open.

# Do Not Inspect or Modify
`src/dashboard.ts`, `src/dashboard.contract.test.ts` and `web/src/pages/BrowserConnect.tsx` are pre-existing uncommitted BROWSER-PAIRING work, deliberately left dirty. They survived this sprint untouched and unstaged and must keep surviving: never stage, revert, clean or "tidy" them. Same for untracked `.landos/tasks/`, `.omp/`, `scripts/omp/`, `scripts/landos/comp-lane-probe.mjs`, `scripts/landportal/capture-comp-locations.mjs`. Leave `.env`, secrets, the operator's Chrome and live Codex processes alone.

# Runtime State
Running and healthy on 3141, rebuilt and restarted onto this change. The one browser tab this session opened was closed. No paid API called. Code pushed at `672a267`; only the pairing files and untracked paths stay dirty.

# Verification Required
Re-verify on a change to `documentUrlIdentity` or any call site, to `sectionCitationLabel`, to `nameCardFromCanonicalIdentity` or its seams, or to the enrichment handoff wait — and, unchanged, to the shared section parser, the lot-area vocabulary, the delegation rule, the series walk, the retained set or the merge order. Rerun the suites named in Relevant Files plus `ordinance-text`, `land-use-source-racing`, `land-use`, `landos`, `jurisdiction-and-pdf-identity`, then rerun Deal 89 and read the pipeline row and Subdivision rules & feasibility.

# Completed and Protected
Universal Property Resolution, LandPortal subject re-aim, official document intelligence, the 9490 Elk Lake Rd valuation behaviour, the 5170 Hwy 60 identity, and the three-workspace lead UI are unchanged. Property Backstory, controlling land-use authority and the land-use projection still reach the operator. Reproducible regulation retrieval, the delegated-lot-area read, the section a rule is cited to, and now one entry per published document, one marker per citation, and a card named by its identity, are protected. Corollary to invariants 2-4: a title names which property a card is about, never how strongly its identity is held. No sprint ledger: one workstream.
