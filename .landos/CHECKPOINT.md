# LandOS Current Checkpoint

<!-- DERIVED:START -->
- **Generated:** 2026-07-26T18:05:00.000Z
- **HEAD at generation:** `f1beeff`
- **Worktree:** CLEAN; 0 modified/untracked paths at refresh time.
- **Latest tests:** PASS at 2026-07-26; 344 files, 4477 tests (vitest run, full suite). The only 2 failures were this file exceeding its byte budget; this refresh clears them.
- **Latest typecheck:** PASS at 2026-07-26; tsc --noEmit (server) clean. Frontend web/tsconfig.json stays pre-existing-red at 92 errors, zero in changed files.
- **Latest production build:** PASS at 2026-07-26; vite build + tsc passed; only the existing large-chunk advisory.
- **Managed runtime:** RUNNING healthy at 2026-07-26; PID 28200; http://localhost:3141.
- **Active sprint:** sprint-2026-07-24-zoning-land-use (complete); 3/3 accepted; none in flight; 0 open QA findings.
- **Sprint ledger:** .landos/sprints/sprint-2026-07-24-zoning-land-use/ledger.json; frozen capabilities: 3 (.landos/capabilities.json).
<!-- DERIVED:END -->

Live repository, database, runtime and owner-visible behavior
override anything written here. Detail lives under `docs/landos/`. Do not push
without Tyler's go-ahead.

## Current objective and state

No build is in flight. `main` and `origin/main` are SYNCHRONIZED at `f1beeff`,
the working tree is clean, and roadmap Items 1, 2 and 3 are complete. Item 4 has
not started.

An unauthorized Phase 4 government-records build was removed from active `main`
and NEVER pushed. `main` was restored to the approved baseline `179cd12` and only
the legitimate fresh-lead intake work was reapplied on top as `f1beeff`. Nothing
from that build survives: no government-record comp research, comp transaction
verification, fourteen-domain grading, decision-readiness gates, recommendation
downgrades, post-contract proof requirements in discovery, twelve-lane
government-record expansion, or government-record Deal Card presentation.

The removed work is preserved LOCALLY ONLY on two rescue branches, both at
`f1641a2`: `rescue/unauthorized-phase4-with-intake` and
`rescue/fresh-lead-intake-fix`. Neither is pushed. Do not delete them without
Tyler's go-ahead.

## Intake recovery shipped in `f1beeff`

Seller/lead identity is parsed from ordinary lead text and stays SEPARATE from
owner of record, which remains blank until an official source confirms it.
Addresses normalize at intake and match on one shared key, so "Rd" and "Road"
resolve to ONE property card; a derived-index migration recomputes `address_key`
on existing cards without touching any address, identity or evidence.

Deal Card titles are property-first, and a Deal Card label can no longer leak
into road, access or seller questions. An unidentified lead reads "Property not
yet identified" rather than exposing an internal storage handle.
Unresolved-property escalation names the REAL blocker (unknown county, or a
jurisdiction with no configured parcel source) and states that this is a LandOS
coverage gap, NOT evidence the parcel does not exist.

Complete APNs survive the New Lead route. `extractPropertyArgs` outranks the
other parsers in `fieldsFromArgs`, and its digits-only token class truncated
`073 090 04200 A-1` and missed `R1234-567A` entirely, storing a DIFFERENT parcel
number than the operator supplied. Parcel tokens may now open with a district
letter or close with an alphanumeric group; `apnTokenRun` preserves street-name
rejection. Verified live in Chrome for all three formats through refresh and
managed restart.

## Prior committed work to preserve

Phase 3 (`179cd12`, pushed): one parent mission, ten specialists in dependency
waves, joined snapshots, rerun-safe persistence, classified partial failures,
LandPortal sidebar + Show-on-Map as the PRIMARY comp lane through the approved
LandOS Chrome (CDP in `.env` only; a foreign Edge runtime stays rejected),
Zillow/Redfin supplements (2+2 with LandPortal, 5+5 without).

`e9ce958`: immediate-transaction SQLite task claiming, one-running-per-agent,
bounded `withBusyRetry`, provider-meaning-first failure classification.

`1b4f320` (pushed): War Room loopback bind by default with `WARROOM_BIND`
opt-in, pino redaction chokepoint, exfiltration scanning, fail-closed migration
guard, closed CORS allowlist. 19 npm audit findings need semver-MAJOR bumps.

`0fccf8b` (pushed): mandatory visual checkpoints, jurisdiction filters read back
off the page, a screenshot-quality contract as the only route into the evidence
set, operator-owned page preservation, canonical identity propagation with reads
never writing.

## Accepted property proof to preserve

- Deal 32 (Roane County, TN): identity `confirmed` on the official Tennessee
  Comptroller layer. APN `073090 04200`, owner `SACHAN DILEEP S`, situs
  `OLD RIDGE RD`, 12.28 deeded acres, coordinates + source URL. One artifact
  (PNG 2,949,777 bytes, SHA-256
  `df2e1d2c898c9726daca94fbdb0db600ced3a59339a4ca9d012fdbb850ea09f3`), nine
  candidates, no duplicates through restart.
- Deal 32 APN reconciliation PROVEN equivalent, canonical unchanged: the TN
  layer returns ONE Roane parcel for both spellings; the state prefixes county
  NUMBER 073 onto county-local `090 04200`. Both forms retained.
- Deal 31 verified (snapshot v1, nine immutable evidence items), Deal 10
  unresolved, Deal 14 gov-record snapshot v5 (seven pages for instrument
  1997O31519, SHA-256 + source). All must persist through restart.

## Exclusions

Never stage `.claude`, `.kilo`, debug scripts, `tmp_query*` or
`verify-deal30.mjs`. Throwaway scripts use the `scripts/_*` underscore
convention. `scripts/data/` is gitignored; operational scripts live in
`scripts/sprint/`.

## Required invariants

1. One accepted property identity version is current.
2. Candidate and confirmed states cannot coexist in the owner read model.
3. Accepted facts link to evidence and the researched identity version.
4. Operator corrections beat weaker automation.
5. GET requests perform no provider work or reconciliation writes.
6. Collector failures are isolated and restart-resumable.
7. Unresolved identity cannot show parcel-specific imagery, comps, FMV or
   actionable strategy.
8. Screenshot text/geometry never establishes official identity or boundaries,
   and lead/seller identity need not match screenshot owner.
9. A missing specialist result is always visible; completeness is never claimed
   over a failed, blocked or skipped contribution.
10. APN formatting differences never create a false parcel conflict, and
    transaction type is never inferred from the presence of a price.
11. The seller/lead contact is never written into owner of record.
12. A complete APN reaches the property card unaltered; a truncated parcel
    number is a DIFFERENT parcel, not a partial one.

## Known limitations and next action

- `extractApnCandidates` does not recognize a letter-led APN such as
  `R1234-567A`, so `apnVariants`/`apnAlternates` are empty for that shape. The
  stored APN is complete because `extractPropertyArgs` supplies it; only the
  extra lookup variants are absent.
- No zoning, future-land-use or utility adapter is wired for Roane or Fayette.
  Per-county source configuration is the largest open gap. Laurel County, KY has
  no tested official parcel source.
- Making Deal 32 priceable still needs a source stating transaction type, or
  acreage on the accepted Redfin sale.
- Phase 2 stays visually unverified. `/overlay/aerial` returns an honest 502 for
  Roane. Raw `console.*` in CLI paths bypasses the redactor.
- Professional deed/title/lien, tax, zoning, access, septic and utility
  verification remain required before relying on those conclusions.
- Next: roadmap Item 4. Nothing is uncommitted; nothing awaits push.
