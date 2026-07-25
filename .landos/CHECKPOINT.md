# LandOS Current Checkpoint

<!-- DERIVED:START -->
- **Generated:** 2026-07-25T19:26:01.153Z
- **HEAD at generation:** `1b4f320`
- **Worktree:** DIRTY; 8 modified/untracked paths at refresh time. Preserve unrelated changes.
- **Latest tests:** PASS at 2026-07-25T15:24:41-04:00; 325 files, 4117 tests, 0 failures (vitest run, full suite).
- **Latest typecheck:** PASS at 2026-07-25T15:19:02-04:00; tsc --noEmit (server) clean; frontend web/tsconfig.json stays pre-existing-red, see Known limitations.
- **Latest production build:** PASS at 2026-07-25T15:19:28-04:00; server TypeScript build and Vite production bundle passed; Vite emitted only the existing large-chunk advisory.
- **Managed runtime:** RUNNING healthy at 2026-07-25T15:25:28-04:00; PID 8892; http://localhost:3141.
- **Active sprint:** sprint-2026-07-24-zoning-land-use (complete); 3/3 accepted, 0 QA-passed; current workstream none in flight; 0 open QA findings.
- **Sprint ledger:** .landos/sprints/sprint-2026-07-24-zoning-land-use/ledger.json; proof report .landos/sprints/sprint-2026-07-24-zoning-land-use/report.md; frozen capabilities: 3 (.landos/capabilities.json).
<!-- DERIVED:END -->

Live repository, database, runtime and owner-visible behavior
override anything written here. Detail lives under `docs/landos/`. Do not push
without Tyler's go-ahead.

## Current objective and state

Phase 2 security hardening is COMPLETE and committed locally on `main` (not
pushed). Isolated hardening only: NO business behavior changed, and it did not
touch Property Intelligence, Deal Cards, LandPortal, browser intelligence, agent
personas or orchestration. Hand-adapted from upstream ClaudeClaw v1.7.1 commit
`77e0959`; never merged, rebased or cherry-picked.

1. War Room binds `127.0.0.1` by DEFAULT via `warroom/config.py resolve_bind()`;
   LAN exposure is opt-in via `WARROOM_BIND`; blank reads as unset. No listener
   keeps an all-interfaces default; the proxy still dials loopback.
2. Centralized log redaction: `src/log-redact.ts` wired as ONE pino
   `hooks.logMethod` chokepoint in `src/logger.ts`. Covers strings, errors and
   `cause`, nested objects/arrays, request/response metadata, URLs, query
   params, headers, cookies, stacks, and registered env secret VALUES via
   `withEnvFileSecrets`. Ordinary content, including the `server_startup` line
   the managed runtime parses, is unchanged.
3. Exfiltration guard scans the RAW registered secret value alongside the
   existing base64 and URL-encoded variants; encoded detection intact.
4. Migration guard fails CLOSED: a `version.json`/`.applied.json` present but
   corrupt, malformed, unreadable, structurally invalid or inconsistent refuses
   startup with an actionable message that never echoes file contents. Genuine
   absence still skips, as the architecture allows.
5. Dependency hardening: three direct pins (hono 4.12.32, js-yaml 4.3.0,
   dompurify 3.4.12) and five overrides (ws 8.21.1, protobufjs 7.6.5,
   @protobufjs/utf8 1.1.2, basic-ftp 5.3.1, form-data 4.0.6). Lockfile updated;
   13 entries changed, all intended targets or forced transitives. `npm audit`
   improved 26 -> 19; the protobufjs CRITICAL RCE (GHSA-xq3m-2v4x-88gg) is GONE,
   7 advisory groups removed, 0 introduced. axios was skipped as already clean.
   No `npm audit fix` was ever run.
6. `.gitignore` covers secret-bearing env backup/rotation copies and deploy
   config via deny-then-allow; documented templates stay tracked.
7. Dashboard CORS default changed from `*` to a closed allowlist: loopback
   origins, the `DASHBOARD_URL` host and explicit `DASHBOARD_CORS_ORIGINS`
   entries, plus `Vary: Origin`. Hashed `SameSite=Strict` sessions, the token
   gate and the CSRF origin check are UNCHANGED and were re-proved live.
8. 156 new test cases: 4 new files, 3 extended.

The 19 remaining findings are deliberate: vitest + @vitest/coverage-v8
(2 CRITICAL, dev-only, unreachable since the Vitest UI server never starts),
vite, and monaco-editor's nested dompurify. Each needs a semver-MAJOR upgrade,
out of scope for a hardening phase.

## Prior committed sprint to preserve

The LandPortal + Deal Card recovery sprint repaired the BROWSER AND DEAL CARD
FOUNDATION only: shared LandPortal capability with mandatory visual checkpoints
at every consequential action; jurisdiction filters applied AND read back off
the page; owner ranking for surname-first records and rural road-only situs
matching; a screenshot-quality contract as the only route into the evidence set,
pinned by a structural test; page cleanup preserving operator-owned pages;
canonical identity propagation into the versioned Property Summary, reads never
writing; read-only Deal Card tabs with card-level Smart Intake evidence; and
duplicate protection across submissions, artifacts, candidates, identity
versions and resources.

## Accepted property proof to preserve

- Deal 32 (Roane County, TN): identity `confirmed` (1.0) on the official
  Tennessee Comptroller parcel layer. APN `073090 04200` (GISLINK ordered-group
  match, Roane-filtered), owner `SACHAN DILEEP S`, situs `OLD RIDGE RD`, 12.28
  deeded acres, coordinates + source URL. One submission, one artifact (PNG
  2,949,777 bytes, SHA-256
  `df2e1d2c898c9726daca94fbdb0db600ced3a59339a4ca9d012fdbb850ea09f3`), nine
  candidates, no duplicates through restart. Card 32 verified from the official
  record, never screenshot text. Tests pin the wrong-road rejection (no Ridge
  Trail Road) and the Davidson-county APN collision refusal.

- Deal 31 verified control (identity/snapshot v1, 100%, nine immutable evidence
  items) and Deal 10 unresolved control (imagery/comps/valuation/strategy
  withheld) both persist through restart.
- Deal 14 government record snapshot v5: identity v1, 60% screened, medium
  confidence; deed/ownership complete, other lanes partial; seven retained pages
  for instrument 1997O31519 with SHA-256 + official source.

## Exclusions

Never stage `.claude`, `.kilo`, root debug scripts, `tmp_query*`,
`verify-deal30.mjs` or `scripts/tmp-*`; unrelated artifacts, stay uncommitted.

## Required invariants

1. One accepted property identity version is current.
2. Candidate and confirmed states cannot coexist in the owner read model.
3. Accepted facts link to evidence and the researched identity version.
4. Operator corrections beat weaker automation.
5. GET requests perform no provider work or reconciliation writes.
6. Collector failures are isolated and restart-resumable.
7. Unresolved identity cannot show parcel-specific imagery, ranked comps, FMV or
   actionable strategy.
8. Screenshot text/geometry never establishes official identity or boundaries.
9. Lead/seller/wholesaler identity need not match screenshot owner.

## Known limitations and next action

- Property Intelligence end to end, LandPortal comps, government-records
  research and full Deal Card research are NOT finished.
- Redaction covers `logger.*`. Raw `console.*` in CLI paths bypasses the
  chokepoint by design; routing it through would rewrite CLI output.
- Frontend `web/tsconfig.json` is not green, no npm script: 92 pre-existing
  errors. The authoritative path (`vite build && tsc`) passes.
- Phase 2 had NO visual browser verification: the Chrome extension was not
  connected, so live proof was scripted HTTP against the running process.
- The screenshot contract judges parcel identity, boundary visibility, tile
  load, byte size and obstruction, but not zoom framing.
- LandPortal's collapsed parcel panel shows no county, state or coordinates;
  those stay honestly unverified on that view.
- `readScope` reads select2 and native selects; a bespoke dropdown downgrades
  filter checks to unverified.
- `/overlay/aerial` returns an honest 502 for Roane (no county aerial overlay
  configured); it surfaces once a parcel is confirmed.
- Deal 30 still needs a valid authenticated LandPortal 2D replacement image.
- Professional deed/title/lien, tax, zoning, access, septic, utility and split
  verification remain required before relying on those conclusions.
- Next: no phase in flight; Phase 3 scope is Tyler's call.
