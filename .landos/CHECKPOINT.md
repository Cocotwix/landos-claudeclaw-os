# LandOS Current Checkpoint

<!-- DERIVED:START -->
- **Generated:** 2026-07-27T02:09:28.461Z
- **HEAD at generation:** `58673e0`
- **Worktree:** DIRTY; 23 modified/untracked paths at refresh time. Preserve unrelated changes.
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

Phase 4 Items 14-17 are COMPLETE. Item 14 is PUBLISHED at `fde34e1`; Items 15-17 are
committed LOCALLY and NOT pushed. Phase 5 has NOT started; it is the next approved
phase. No build is in flight.

An unauthorized Phase 4 gov-records build was removed from `main` and NEVER pushed.
Preserved LOCALLY ONLY on rescue branches at `f1641a2`:
`rescue/unauthorized-phase4-with-intake`, `rescue/fresh-lead-intake-fix`. Never delete
or push them.

## Phase 4 mission graph (Items 14-17)

Design detail: `docs/landos/phase4-items-15-17.md`; invariants 13-16 are the enforced
rules. Tables `landos_mission` + `landos_mission_child`: additive DDL, scoped by
scope+scope_id; re-runs keep prior missions readable.

- **14** durable parent + child rows up front, dependency-wave fan-out, atomic child
  claim (BEGIN IMMEDIATE), join only once every child is terminal. Proof mission
  `property_intelligence_fanout`: required parcel_identity, then required deal_context
  + supporting market_coverage, read-only.
- **15** a child declares group, assignedRole, agentKey (validated against
  AGENT_ROSTER) and contributionSlot; specialist facts resolve from the roster and are
  written WITH the child row, so they show before the lane runs.
- **16** `mission-acceptance.ts`, reusable + pure: executor reports, contract decides.
- **17** `upstream/main` (`0774082`) is already an ancestor of HEAD, so NO upstream fix
  was missing; the gap was that missions could not reach the existing router. Bridge
  only, safe mode preserved. Hermes OPTIONAL (absent = not installed); codex/opencode
  are `agent_session`, not mission-routable.

## Mission acceptance evidence

- Item 14 in Chrome: Deal 52 (Knox) JOINED 3/3; Deal 47 (Roane) JOINED WITH GAPS naming
  its blocked child. Both survived refresh and restart, no contamination.
- Items 15-17 in Chrome: fresh New Lead intake for 3129 Old Walland Highway, Walland TN
  37886, Blount County (Deal 53; Blount absent beforehand). Mission #1 JOINED 3/3,
  1 accepted + 2 incomplete, 3/3 routed, every lane deterministic. Each child showed
  parent, group, role, roster specialist, slot, provider and acceptance, including while
  QUEUED. Survived refresh and managed restart; Deals 47/52/53 isolated. Do NOT delete
  Deal 53.
- Legacy Item 14 rows render with declared identity and honest `not_evaluated` /
  `0 accepted`; no verdict was fabricated.

## Prior committed work to preserve

Pushed, still required; full detail in git and `docs/landos/`. `f1beeff` lead identity
SEPARATE from owner of record; complete APNs survive intake. `179cd12` Phase 3
ten-specialist mission; LandPortal sidebar + Show-on-Map is the PRIMARY comp lane
through approved LandOS Chrome (CDP in `.env`; foreign Edge rejected). `e9ce958`
immediate-transaction claiming. `1b4f320` War Room loopback bind, pino redaction
chokepoint, fail-closed migration guard, closed CORS allowlist; 19 npm audit findings
need MAJOR bumps.

## Accepted property proof to preserve

- Deal 32 (Roane TN): identity `confirmed` on the official TN Comptroller layer. APN
  `073090 04200`, owner `SACHAN DILEEP S`, situs `OLD RIDGE RD`, 12.28 deeded acres,
  coords + source URL. One artifact (PNG 2,949,777 bytes, SHA-256 `df2e1d2c...ea09f3`),
  nine candidates.
- Deal 32 APN reconciliation PROVEN equivalent, canonical unchanged: the TN layer
  returns ONE Roane parcel for both spellings; the state prefixes county NUMBER 073
  onto county-local `090 04200`. Both retained.
- Deal 31 verified (snapshot v1, nine evidence items), Deal 10 unresolved, Deal 14
  gov-record snapshot v5 (instrument 1997O31519). All persist through restart.

## Exclusions

Never stage `.claude`, `.kilo`, debug scripts, `tmp_query*` or `verify-deal30.mjs`.
Throwaway scripts use `scripts/_*` (gitignored); operational ones `scripts/sprint/`.

## Required invariants

1. One accepted property identity version is current.
2. Candidate and confirmed states cannot coexist in the owner read model.
3. Accepted facts link to evidence and the researched identity version.
4. Operator corrections beat weaker automation.
5. GET requests perform no provider work or reconciliation writes.
6. Collector failures are isolated and restart-resumable.
7. Unresolved identity cannot show parcel-specific imagery, comps, FMV or strategy.
8. Screenshot text/geometry never establishes official identity or boundaries;
   lead/seller identity need not match the screenshot owner.
9. A missing specialist result is always visible; completeness is never claimed over
   a failed, blocked or skipped contribution.
10. APN formatting differences never create a false parcel conflict; transaction type
    is never inferred from a price.
11. The seller/lead contact is never written into owner of record.
12. A complete APN reaches the card unaltered; a truncated parcel number is a
    DIFFERENT parcel, not a partial one.
13. A parent never completes while a child is non-terminal, and never reports success
    over a failed, blocked, skipped, rejected or outstanding child.
14. A child passes only on its ACCEPTANCE verdict, never on process exit; an
    unevaluated result is never presented as accepted.
15. A deterministic lane never names a provider or implies spend; Hermes is never
    required natively.
16. Every read path returns the full MissionJoin shape, incl. a legacy stored join.

## Known limitations and next action

- The New Lead parser stored "9.4 acres of vacant land on Hardin Valley Rd" as an
  address (Deal 52). PRE-EXISTING; deliberately NOT fixed in Phase 4.
- Children run in-process in the parent's wave loop. No external worker is wired;
  Phase 4 does not require one.
- Every representative lane is deterministic, so `model_routed` execution is proven by
  focused tests with injected clients, NOT a paid live model call; Phase 4 needs none.
- `extractApnCandidates` misses a letter-led APN (`R1234-567A`), so `apnVariants` is
  empty for that shape; the stored APN is still complete. Deal 32 needs transaction type
  or acreage on the accepted sale to be priceable.
- No zoning, future-land-use or utility adapter is wired for Roane or Fayette;
  per-county source config is the largest open gap. Laurel County KY has no tested
  parcel source.
- Phase 2 stays visually unverified; `/overlay/aerial` returns an honest 502 for Roane.
  Raw `console.*` in CLI paths bypasses the redactor.
- Professional deed/title/lien, tax, zoning, access, septic and utility checks remain
  required.
- Next: publish Phase 4 on Tyler's go, then Phase 5.
