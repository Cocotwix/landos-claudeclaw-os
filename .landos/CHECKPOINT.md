# LandOS Current Checkpoint

<!-- DERIVED:START -->
- **Generated:** 2026-07-26T05:46:32.316Z
- **HEAD at generation:** `e9ce958`
- **Worktree:** DIRTY; 40 modified/untracked paths at refresh time. Preserve unrelated changes.
- **Latest tests:** PASS at 2026-07-26T01:41:11-04:00; 341 files, 4424 tests, 0 failures (vitest run, full suite)..
- **Latest typecheck:** PASS at 2026-07-26T01:41:20-04:00; tsc --noEmit (server) clean; frontend web/tsconfig.json stays pre-existing-red at 92 TS6133 unused-declaration errors, unchanged from the pre-phase baseline.
- **Latest production build:** PASS at 2026-07-26T01:38:00-04:00; vite build + tsc passed; Vite emitted only the existing large-chunk advisory.
- **Managed runtime:** RUNNING healthy at 2026-07-26T01:42:05-04:00; PID 59264; http://localhost:3141.
- **Active sprint:** sprint-2026-07-24-zoning-land-use (complete); 3/3 accepted, 0 QA-passed; current workstream none in flight; 0 open QA findings.
- **Sprint ledger:** .landos/sprints/sprint-2026-07-24-zoning-land-use/ledger.json; proof report .landos/sprints/sprint-2026-07-24-zoning-land-use/report.md; frozen capabilities: 3 (.landos/capabilities.json).
<!-- DERIVED:END -->

Live repository, database, runtime and owner-visible behavior
override anything written here. Detail lives under `docs/landos/`. Do not push
without Tyler's go-ahead.

## Current objective and state

Phase 3 Property Intelligence end to end is COMPLETE and UNCOMMITTED on `main`
(base `e9ce958`). Detail: `docs/landos/Property_Intelligence_Phase3_2026-07-26.md`.

One operator action starts ONE parent mission: ten specialists in dependency
waves with live status, classified failure and timing, joined into ONE snapshot
driving every Deal Card tab, including on an unresolved card.

LandPortal is the PRIMARY comp lane and reads BOTH surfaces live through the
approved LandOS Chrome (CDP endpoint configured in `.env` only; a foreign Edge
runtime stays rejected): the parcel sidebar block AND the expanded "Show on Map"
results. Rows merge on full APN, then street address, then price+acreage+date,
provenance sidebar/map/both; a truncated APN is never a dedupe key. Zillow/Redfin
then supplement (2+2 with LandPortal, 5+5 without); Realie and HomeHarvest never
price land.

Deal 32 APN reconciliation PROVEN equivalent, canonical unchanged: the official
TN layer returns ONE Roane parcel for both spellings — PARCELID
`073 090    04200 000 2026`, GISLINK `073090    04200`, CMAP 090 / PARCEL 042.00,
OWNER SACHAN DILEEP S. The state layer prefixes county NUMBER 073 onto the
county-local `090 04200`; both forms retained.

Deal 32 run #12: both surfaces reached; sidebar 6 rows, Show-on-Map 6, all 6
corroborated and merged to 6 unique; 0 street addresses, 0 stated statuses; 1
accepted sold comp (Redfin); 36 excluded/context-only each with a reason; 10
retained images all loading. Deal 32 stays NOT priceable — correctly: no accepted
closed sale carries acreage and LandPortal states no transaction type.

Eleven live defects fixed this phase, all with regressions: APN trailing
punctuation; padded TN PARCELID vs exact equality; an identity guard rejecting a
correct match (GISLINK is a PREFIX of PARCELID); a 25s lookup timeout on a 30-60s
provider; fabricated `listed` status; APN truncated at the first space; excluded
rows vanishing from the operator view; stale captures never re-read;
`Unknown key: Shift+ArrowRight` aborting the WHOLE capture; a stale "LandPortal
empty" claim after it answered; and the redactor destroying legitimate `key=`
asset URLs so no retained screenshot loaded.

## Prior committed work to preserve

Reliability + command-path hardening (`e9ce958`): immediate-transaction SQLite
task claiming with a one-running-per-agent guard, `claimScheduledTask`, bounded
`withBusyRetry`, provider-meaning-first failure classification, the store-aware
`hive-cli`, strict mission-CLI parsing.

Phase 2 security hardening (`1b4f320`, pushed): War Room loopback bind, the pino
log-redaction chokepoint, exfiltration scanning, a fail-closed migration guard,
3 pins + 5 overrides (npm audit 26 -> 19, protobufjs RCE gone), `.gitignore` env
coverage, closed CORS allowlist. The 19 left need semver-MAJOR bumps.

The LandPortal + Deal Card recovery sprint (`0fccf8b`) repaired the BROWSER AND
DEAL CARD FOUNDATION only: mandatory visual checkpoints, jurisdiction filters
read back off the page, owner ranking, a screenshot-quality contract as the only
route into the evidence set, operator-owned page preservation, canonical identity
propagation with reads never writing, read-only tabs, duplicate protection.

## Accepted property proof to preserve

- Deal 32 (Roane County, TN): identity `confirmed` on the official Tennessee
  Comptroller parcel layer. APN `073090 04200`, owner `SACHAN DILEEP S`, situs
  `OLD RIDGE RD`, 12.28 deeded acres, coordinates + source URL. One submission,
  one artifact (PNG 2,949,777 bytes, SHA-256
  `df2e1d2c898c9726daca94fbdb0db600ced3a59339a4ca9d012fdbb850ea09f3`), nine
  candidates, no duplicates through restart. That artifact is SURFACED by
  Property Intelligence, read append-only, and serves HTTP 200 unchanged.
- Deal 31 verified control (identity/snapshot v1, 100%, nine immutable evidence
  items) and Deal 10 unresolved control both persist through restart. Deal 10
  also has a `blocked_identity` Property Intelligence snapshot.
- Deal 14 government record snapshot v5: identity v1, 60% screened; seven
  retained pages for instrument 1997O31519 with SHA-256 + official source.

## Exclusions

Never stage `.claude`, `.kilo`, debug scripts, `tmp_query*`, `verify-deal30.mjs`
or `scripts/tmp-*`. `scripts/data/` is gitignored; operational scripts live in
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
8. Screenshot text/geometry never establishes official identity or boundaries.
9. Lead/seller identity need not match screenshot owner.
10. A missing specialist result is always visible; completeness is never claimed
    over a failed, blocked or skipped contribution.
11. APN formatting differences (spaces, dashes, leading zeros, trailing
    punctuation, county prefix) never create a false parcel conflict.
12. Transaction type is never inferred from the presence of a price.

## Known limitations and next action

- LandPortal's two surfaces supply price + acreage + full APN but NO street
  address and NO sale/list status, so its rows cannot establish closed-sale FMV.
  Making Deal 32 priceable needs a source that states transaction type, or
  acreage on the accepted Redfin sale.
- Government records reached 50% with 0 retained artifacts; zoning could not be
  established from the official sources searched. Deed, tax, survey, lien and
  zoning retrieval remain unfinished.
- Frontend `web/tsconfig.json` is not green: 92 pre-existing TS6133 errors,
  unchanged. The authoritative path (`vite build && tsc`) passes.
- Property Intelligence IS visually verified in Chrome across all seven tabs,
  launch, progress, rerun and unresolved-card behaviour. Panels clean at
  1280/1440/1600/1699 with zero page overflow; the maximized window would not
  resize below 1699, so narrower widths were checked by container constraint and
  breakpoint switching was not exercised. Phase 2 stays visually unverified.
- Redaction covers `logger.*`, the failure classifier and the PI store; only
  secret-shaped query keys redact. Raw `console.*` in CLI paths bypasses it.
- `/overlay/aerial` returns an honest 502 for Roane.
- Professional deed/title/lien, tax, zoning, access, septic and utility
  verification remain required before relying on those conclusions.
- Next: Phase 3 awaits Tyler's commit review. Nothing committed, nothing pushed.
