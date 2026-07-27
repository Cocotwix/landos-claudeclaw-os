# LandOS Current Checkpoint

<!-- DERIVED:START -->
- **Generated:** 2026-07-26T19:20:00.000Z
- **HEAD at generation:** `fde34e1`
- **Worktree:** CLEAN; 0 modified/untracked paths.
- **Latest tests:** PASS 2026-07-26; 348 files, 4539 tests; Item 14 focused 62/62.
- **Latest typecheck:** PASS 2026-07-26; tsc --noEmit (server) clean; frontend pre-existing-red at 92 errors, none in changed files.
- **Latest production build:** PASS 2026-07-26; vite build + tsc; only the large-chunk advisory.
- **Managed runtime:** RUNNING healthy 2026-07-26; PID 45316; localhost:3141.
- **Active sprint:** sprint-2026-07-24-zoning-land-use (complete); 3/3 accepted; 0 open QA findings.
- **Sprint ledger:** .landos/sprints/sprint-2026-07-24-zoning-land-use/ledger.json; frozen capabilities: 3 (.landos/capabilities.json).
<!-- DERIVED:END -->

Live repository, database, runtime and owner-visible behavior
override anything written here. Detail: `docs/landos/`. Do not push without go-ahead.

## Current objective and state

No build is in flight. `main` and `origin/main` are SYNCHRONIZED at `fde34e1`, the
tree is clean, and Phase 4 Item 14 is COMPLETE and PUBLISHED. Items 15-17 and
Phase 5 have NOT started.

An unauthorized Phase 4 gov-records build was removed from `main` and NEVER
pushed; nothing survives (gov-record comp research and transaction verification,
fourteen-domain grading, decision-readiness gates, recommendation downgrades,
post-contract proof in discovery, twelve-lane gov-record expansion, gov-record Deal
Card presentation). Preserved LOCALLY ONLY on two rescue branches at `f1641a2`:
`rescue/unauthorized-phase4-with-intake` and `rescue/fresh-lead-intake-fix`.
Not pushed; do not delete.

## Item 14 shipped in `fde34e1` (pushed)

ONE parent mission creates durable child rows up front, fans them out in dependency
waves, waits for every required child to reach a terminal state, then joins their
structured handbacks. Tables `landos_mission` + `landos_mission_child`: additive DDL
only, scoped by scope+scope_id, monotonic sequence per scope; re-runs keep prior
missions readable. A child is CLAIMED atomically (BEGIN IMMEDIATE) so two workers
cannot run one lane, and `completeMission` REFUSES to write while any child is
queued or running.

Failed, blocked, skipped, timed-out and outstanding children each produce a
DIFFERENT explicit parent outcome and are named in it; a skipped child is a
consequence, so the parent reports the ROOT cause. An interrupted mission is closed
honestly, never shown as progress.

Proof mission `property_intelligence_fanout`: parcel_identity (required) →
deal_context (required) + market_coverage (supporting). Read-only; writes nothing
outside the two mission tables. Chrome: Deal 52 (fresh Knox lead) JOINED 3/3; Deal
47 (Roane) JOINED WITH GAPS naming the blocked child; both persisted through refresh
and managed restart, no cross-Deal contamination. The ten-specialist Property
Intelligence mission still works, untouched.

## Prior committed work to preserve

Pushed, still required; detail in git and `docs/landos/`. `f1beeff`: lead identity
SEPARATE from owner of record; one address match key; property-first Deal Card
titles; complete APNs survive New Lead intake. `179cd12` Phase 3: parent mission +
ten specialists in waves, joined snapshots, rerun-safe persistence; LandPortal
sidebar + Show-on-Map is the PRIMARY comp lane through approved LandOS Chrome (CDP
in `.env`; foreign Edge rejected); Zillow/Redfin supplements (2+2 with LandPortal,
5+5 without). `e9ce958`: immediate-transaction task claiming, one-running-per-agent,
bounded `withBusyRetry`, provider-meaning-first failure classification. `1b4f320`:
War Room loopback bind, pino redaction chokepoint, exfiltration scan, fail-closed
migration guard, closed CORS allowlist; 19 npm audit findings need semver-MAJOR
bumps. `0fccf8b`: mandatory visual checkpoints, screenshot-quality contract into the
evidence set, canonical identity propagation, reads never write.

## Accepted property proof to preserve

- Deal 32 (Roane County, TN): identity `confirmed` on the official Tennessee
  Comptroller layer. APN `073090 04200`, owner `SACHAN DILEEP S`, situs
  `OLD RIDGE RD`, 12.28 deeded acres, coordinates + source URL. One artifact (PNG
  2,949,777 bytes, SHA-256
  `df2e1d2c898c9726daca94fbdb0db600ced3a59339a4ca9d012fdbb850ea09f3`), nine
  candidates, no duplicates through restart.
- Deal 32 APN reconciliation PROVEN equivalent, canonical unchanged: the TN layer
  returns ONE Roane parcel for both spellings; the state prefixes county NUMBER 073
  onto county-local `090 04200`. Both forms retained.
- Deal 31 verified (snapshot v1, nine immutable evidence items), Deal 10 unresolved,
  Deal 14 gov-record snapshot v5 (seven pages for instrument 1997O31519, SHA-256 +
  source). All must persist through restart.

## Exclusions

Never stage `.claude`, `.kilo`, debug scripts, `tmp_query*` or `verify-deal30.mjs`.
Throwaway scripts use the `scripts/_*` convention; `scripts/data/` is gitignored;
operational scripts live in `scripts/sprint/`.

## Required invariants

1. One accepted property identity version is current.
2. Candidate and confirmed states cannot coexist in the owner read model.
3. Accepted facts link to evidence and the researched identity version.
4. Operator corrections beat weaker automation.
5. GET requests perform no provider work or reconciliation writes.
6. Collector failures are isolated and restart-resumable.
7. Unresolved identity cannot show parcel-specific imagery, comps, FMV or strategy.
8. Screenshot text/geometry never establishes official identity or boundaries;
   lead/seller identity need not match screenshot owner.
9. A missing specialist result is always visible; completeness is never claimed over
   a failed, blocked or skipped contribution.
10. APN formatting differences never create a false parcel conflict; transaction
    type is never inferred from a price.
11. The seller/lead contact is never written into owner of record.
12. A complete APN reaches the card unaltered; a truncated parcel number is a
    DIFFERENT parcel, not a partial one.
13. A parent mission never completes while a child is non-terminal, and never
    reports success over a failed, blocked, skipped or outstanding child.

## Known limitations and next action

- The New Lead parser stored "9.4 acres of vacant land on Hardin Valley Rd" as the
  address "4 Acres Of Vacant Land On Hardin Valley Rd" (Deal 52). PRE-EXISTING and
  OUTSIDE Item 14; documented, deliberately not fixed. County and state parsed
  correctly, so the mission was unaffected. Deal 52 kept.
- Item 14 children run in-process in the parent's wave loop. The durable claim
  and await-with-deadline machinery already supports an external worker settling a
  child. Wiring one is NOT required merely by Item 15, which concerns agent
  identity, roles, relationships, completion status and structured handback routing.
- `extractApnCandidates` misses a letter-led APN such as `R1234-567A`, so
  `apnVariants`/`apnAlternates` are empty for that shape; the stored APN is still
  complete. Making Deal 32 priceable needs a source stating transaction type, or
  acreage on the accepted Redfin sale.
- No zoning, future-land-use or utility adapter is wired for Roane or Fayette;
  per-county source configuration is the largest open gap. Laurel County, KY has no
  tested official parcel source.
- Phase 2 stays visually unverified; `/overlay/aerial` returns an honest 502 for
  Roane. Raw `console.*` in CLI paths bypasses the redactor.
- Professional deed/title/lien, tax, zoning, access, septic and utility checks
  remain required before relying on those conclusions.
- Next: Phase 4 Item 15. Nothing uncommitted; nothing awaits push.
