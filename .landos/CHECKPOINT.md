# LandOS Current Checkpoint

<!-- DERIVED:START -->
- **Generated:** 2026-07-27T05:53:03.121Z
- **HEAD at generation:** `7b94d81`
- **Worktree:** DIRTY; 21 modified/untracked paths at refresh time. Preserve unrelated changes.
- **Latest tests:** PASS at 2026-07-26T21:30:07-04:00; 351 files, 4605 tests, 0 failures (full vitest run).
- **Latest typecheck:** PASS at 2026-07-26T21:31:40-04:00; server clean; frontend pre-existing-red at 92 TS6133, none in a changed file.
- **Latest production build:** PASS at 2026-07-26T21:27:30-04:00; vite build + tsc; only the existing large-chunk advisory.
- **Managed runtime:** RUNNING healthy at 2026-07-26T21:34:00-04:00; PID 85780; http://localhost:3141.
- **Active sprint:** sprint-2026-07-24-zoning-land-use (complete); 3/3 accepted, 0 QA-passed; current workstream none in flight; 0 open QA findings.
- **Sprint ledger:** .landos/sprints/sprint-2026-07-24-zoning-land-use/ledger.json; proof report .landos/sprints/sprint-2026-07-24-zoning-land-use/report.md; frozen capabilities: 3 (.landos/capabilities.json).
<!-- DERIVED:END -->

Live repository, runtime and owner-visible behavior override anything written here.
Detail: `docs/landos/`. Do not push without go-ahead.

## State

Phase 5 is PARTIAL and must NOT be marked complete. Items 18, 19 and 20 are COMPLETE
and committed locally as a verified partial increment (NOT pushed). Item 21 is PARTIAL:
15 of its 16 golden-path requirements are satisfied; the outstanding one is a supported
Deal 32 valuation. Phase 5 completes only when Deal 32 is rerun successfully WITH that
valuation. Phase 6 is untouched and is the next approved phase.

Run Property Intelligence now creates ONE parent mission (`deal_intelligence`, 11
children) on the Phase 4 graph; its join is assembled by the Operator, evaluated by
the Analyst and persisted as ONE versioned snapshot (v3) the Deal Card reads.

An unauthorized Phase 4 gov-records build was removed from `main` and NEVER pushed.
Preserved LOCALLY ONLY on rescue branches at `f1641a2`:
`rescue/unauthorized-phase4-with-intake`, `rescue/fresh-lead-intake-fix`. Never delete
or push them.

## Phase 4 mission graph (Items 14-17, published)

Detail: `docs/landos/phase4-items-15-17.md`. Tables `landos_mission` +
`landos_mission_child`: additive DDL, scoped by scope+scope_id; re-runs keep prior
missions readable. Durable parent + child rows up front, atomic child claim (BEGIN
IMMEDIATE), join only once every child is terminal. A child declares group,
assignedRole, agentKey (validated against AGENT_ROSTER) and contributionSlot, written
WITH the row. `mission-acceptance.ts` decides pass/fail, never process exit.

Phase 5 additions: `awaits` (ordering WITHOUT skip), per-child dispatch instead of a
wave barrier, and restart-orphan reclamation keyed on process start.

## Acceptance evidence

- **Phase 5, Chrome.** Deal 32 (Roane) run #25 and Deal 54 (Anderson, created fresh
  through New Lead intake) both JOINED 11/11, identity CONFIRMED on the TN Comptroller
  layer. The Deal Card reads the current snapshot and shows its parent mission id.
  Comps 1 sold / 48 and 54 active; neither priceable (see the Item 21 gap). Browser
  cleanup recorded on the snapshot. Survived refresh AND managed restart, cards stayed
  isolated. Deal 54 proved lead identity SEPARATE from owner of record: lead Marcus
  Ellery (test contact), owner STARDUST RIDGE LLC. Do NOT delete Deal 54.
- Failed runs #18-#21 are retained as history and NEVER demoted the good snapshot.
- **Phase 4, Chrome.** Deal 52 JOINED 3/3; Deal 47 JOINED WITH GAPS naming its blocked
  child; Deal 53 fresh intake JOINED 3/3. Do NOT delete Deal 53.

## Prior committed work to preserve

Pushed, still required; detail in git and `docs/landos/`. `f1beeff` lead identity
SEPARATE from owner of record. `179cd12` Phase 3 ten-specialist mission; LandPortal
sidebar + Show-on-Map is the PRIMARY comp lane through approved LandOS Chrome (CDP in
`.env`; foreign Edge rejected). `e9ce958` immediate-transaction claiming. `1b4f320`
War Room loopback bind, pino redaction chokepoint, fail-closed migration guard, closed
CORS allowlist.

## Accepted property proof to preserve

- Deal 32 (Roane TN): identity `confirmed` on the official TN Comptroller layer. APN
  `073090 04200`, owner `SACHAN DILEEP S`, situs `OLD RIDGE RD`, 12.28 acres, coords +
  source URL. One artifact (PNG 2,949,777 bytes, SHA-256 `df2e1d2c...ea09f3`). APN
  reconciliation PROVEN equivalent: the layer returns ONE Roane parcel for both
  spellings; the state prefixes county NUMBER 073 onto county-local `090 04200`.
- Deal 31 verified (snapshot v1, nine evidence items), Deal 10 unresolved, Deal 14
  gov-record snapshot v5 (instrument 1997O31519). All persist through restart.

## Exclusions

Never stage `.claude`, `.kilo`, debug scripts, `tmp_query*`, `scripts/_*` or
`verify-deal30.mjs`. Operational scripts go in `scripts/sprint/`.

## Required invariants

1. One accepted identity version is current; candidate and confirmed cannot coexist.
2. Accepted facts link to evidence and the researched identity version; operator
   corrections beat weaker automation.
3. GET performs no provider work or reconciliation writes; collector failures are
   isolated and restart-resumable.
4. Unresolved identity cannot show parcel-specific imagery, comps, FMV or strategy.
5. Screenshot text/geometry never establishes official identity; the lead contact is
   never written into owner of record.
6. A missing specialist result is always visible; completeness is never claimed over a
   failed, blocked or skipped contribution.
7. APN formatting never creates a false conflict; a complete APN reaches the card
   unaltered; transaction type is never inferred from a price.
8. A parent never completes while a child is non-terminal, and never reports success
   over a failed, blocked, skipped, rejected or outstanding child.
9. A child passes only on its ACCEPTANCE verdict, never on process exit. A
   deterministic lane never names a provider or implies spend; Hermes is never required.
10. Phase 5: a missing or slow lane never cancels a conclusion that does not consume
    it, and no government record is pulled for a comparable property.

## Known limitations and next action

- **Item 21 gap — the one blocker to completing Phase 5:** no genuinely closed, in-band
  land comp currently carries usable acreage through the approved workflow. Probed live
  on Kingston/Roane: every approved sold row inside the 6.14-30.7ac band has no lot size
  at source, and every sold row that DOES carry acreage is a 0.32-1.0ac residential lot.
  Deal 32 run #25 produced 1 sold / 48 active and no value band. Closing this needs lot
  size read from the Redfin DETAIL page = Phase 6 comp extraction.
- Phase 6 defects logged while probing: the sold board is never requested from either
  provider; Zillow's sold mode RELABELS active rows as sold (unreachable today — never
  enable without fixing); a Redfin row with unknown acreage bypasses the acreage band.
  Detail: `docs/landos/phase5-items-18-21.md`.
- Comparables `awaits` the projection refresh: both drive the ONE Chrome tab.
- The New Lead parser stored "9.4 acres of vacant land on Hardin Valley Rd" as an
  address (Deal 52). PRE-EXISTING; deliberately NOT fixed in Phase 4 or 5.
- Children run in-process; no external worker is wired. Every representative lane is
  deterministic, so `model_routed` is proven by tests with injected clients, not a paid
  live model call. `extractApnCandidates` misses a letter-led APN (`R1234-567A`).
- No zoning/future-land-use/utility adapter for Roane, Anderson or Fayette; per-county
  source config is the largest open gap. Laurel County KY has no tested parcel source.
- Phase 2 visually unverified; `/overlay/aerial` 502s for Roane. Raw `console.*` in CLI
  paths bypasses the redactor. 19 npm audit findings need MAJOR bumps. Professional
  deed/title/lien, tax, zoning, access, septic and utility checks remain required.
- Next: Phase 6 (comp rebuild) — it owns the Item 21 valuation gap above.
