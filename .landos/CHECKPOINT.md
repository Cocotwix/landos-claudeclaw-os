# Current Active Task

None. The repository reconciliation and the test-baseline correction are both
complete, committed and pushed. Awaiting Tyler's next instruction, which is
expected to be a development/build-system change.

# Exact Operator Outcome

`main` truthfully represents the LandOS that is accepted and running, it builds
and runs from a fresh checkout, and its test suite now describes the accepted
behavior rather than superseded source shapes.

# Current State

- **Generated:** 2026-08-11T01:34:08Z
- **HEAD at generation:** `ca21d0c` — the accepted CODE baseline,
  `ca21d0c876dab62594ed6034e0a03abc8418151b`, equal to origin/main when this was
  written. The checkpoint-only closeout that carries this file advances HEAD one
  commit past it BY DESIGN; that is not drift and must not trigger a rewrite.
- **Worktree:** clean. 0 dirty paths, 0 staged files.
- **Tests:** 6,045 passing across 445 files, 0 failures.
- **Typecheck:** `tsc --noEmit` clean. **Build:** production build clean, only
  pre-existing chunk-size warnings.
- **Runtime:** RUNNING healthy, PID 151780, http://localhost:3141, HTTP 200.
- **Dedicated LandOS Chrome:** running, CDP 9224, owned.

# Completed and Proven

RECONCILIATION — `395644d`, 378 files, then checkpoint closeout `37d2c12`. Dirty
paths went 411 to 0. One commit was the only correct shape: 22 untracked modules
were hard dependencies of tracked, modified production code. Committed the
acreage router, land-use and zoning stack, GIS transport with ArcGIS/Tyler/
Schneider adapters, public-record access and browser login, state-law retrieval,
subject-identity reconciliation, exact-address web discovery, access-evidence
ladder, comp-lane accountability, LandPortal canonical identity/comp drilldown/
overview capture, governed Hermes profile templates and capability snapshots,
knowledge registries, Playwright acceptance harness, Python MCP servers, and the
matching web components. Ignored rather than committed and left on disk: the
62 MB of Playwright acceptance artifacts, the devloop lesson queue, two CDP
dumps, and two stray root captures. Fixed in the same commit: a bare `data/`
ignore rule also matched `scripts/data/`, excluding the four scripts that
`landos:data:*` and `landos:qa:init` invoke; narrowed to `/data/`.

TEST BASELINE — `ca21d0c`, 24 files. All 13 failures were pre-existing.

REAL DEFECT, fixed in production: `duke-preflight.ts`'s labeled-APN fast path
applied no shape validation, so "Parcel: 12 Oak Street" resolved to the parcel
"12" and the street address was dropped. That path outranks every other APN
reader in `fieldsFromArgs()`, so the corrupt id won. Added a five-digit floor
plus a guard refusing any labeled value that runs on into a street, which closes
the wider class a floor alone cannot ("Parcel: 12345 Main St", "APN: 40126 Nolan
Ridge Road", "Parcel: 12345 Highway 153"). Long single-run and multi-group county
APNs still resolve; four regression cases added.

FIXTURE: `governance/mcp-bridge.test.ts` read a generated Playwright run under
the gitignored `.landos/acceptance/`, so it could never pass on a fresh
checkout. Replaced with a committed 23 KB package regenerable byte-identically
via `scripts/acceptance/build-fixture-package.mjs`. Its `.gitattributes` pins
`* -text` because `results.json` records each file's exact byteLength and
sha256, and `core.autocrlf=true` would rewrite the JSON on checkout.

STALE ASSERTIONS re-expressed against current structure, several strengthened,
none weakened: comp caps now read via named locals; CompRecordIdentity asserts
the active-before-valuation ORDERING; the offscreen-spawn invariant is asserted
where it now lives and is unconditional; `bringToFront` is pinned to exactly two
sites with the ungated one required to be the operator-initiated Open LandPortal
entry point; the capture loop asserts a bounded retry instead of a literal that
never matched; memory-bootstrap tracks the consolidated contract wording; and
the jurisdiction capture check asserts no parcel-identity rejection instead of
demanding verdicts a stub driver cannot satisfy. Also corrected
`fresh-session-local-proof.mjs`, where the same stale prose was emitted as
booleans, silently reporting the contract as neither agent-neutral nor
narrow-startup.

# Remaining Work

Deferred, unchanged: house valuation lane; Strategy agent; Pre/Post Discovery
Revaluation; the exact-address lane's `persistence.attempted` still false; no Run
Property Intelligence control in the V2 workspace.

Two browser-session items remain DEFERRED and were deliberately not built:
`BACKGROUND_CHROME_ARGS` and `defaultSpawn`/`SpawnLike` in `browser-session.ts`
are dead after the isolation refactor; and a `no_match` run retains a screenshot
in `ev.screenshots` while reporting that no visuals were accepted.

# Exact Next Action

Wait for Tyler's instruction on the development/build-system change. Do not
start it, the deferred browser-session items, or any Remaining Work item
without it.

# Relevant Files

- `src/landos/duke-preflight.ts` — labeled-APN street guard and digit floor
- `src/landos/fixtures/acceptance-package/` and
  `scripts/acceptance/build-fixture-package.mjs`
- `src/landos/browser-session.ts` — holds both deferred items
- `scripts/memory/fresh-session-local-proof.mjs`

# Relevant Records

Code baseline `ca21d0c`; reconciliation `395644d`; prior HEAD before
reconciliation was `d539e10`. Live run `di_msntkf8z_2vsoyp` (deal 83, sequence
43) is unchanged and still carries the three retrieved listing URLs the Property
Intelligence panel projects.

# Known Blockers

None in the repository. Deployed `~/.hermes` state has drifted from the
committed templates: `hermes:governed:check` fails all five profiles on CDP
scope, CLI allowlists and managed-file snapshots, and
`landos:hermes:profile:check` reports the LandPortal SKILL template mismatched.
Not run: `hermes:governed:provision --apply-external`, which mutates external
state and could strip capabilities. `image_gen`, `bfl` and `tts` remain enabled
and can incur cost, awaiting Tyler's decision.

Deal 83's Decision Summary still says no usable comparable survived selection
from 18 collected rows while the valuation above it prices off five.

`landos:memory:checkpoint` still refuses to write because generator output
exceeds the 8192-byte ceiling, so this file was written directly under it.

# Do Not Inspect or Modify

Do not expose `.env` or secrets, print either dashboard token, run destructive
SQL, or delete `store/backups/landos-pre-rescue-2026-08-03.db`. Deny rules
`Bash(git push*)`, `Bash(rm *)`, `Bash(git clean*)` and broad `git add` are
intact; Tyler pushes manually. Never disable TLS verification. Do not create a
second Chrome profile: LandOS uses the one automation Chrome on CDP 9224. Do not
regenerate the committed acceptance fixture or drop its `.gitattributes`.

# Runtime State

Healthy on http://localhost:3141, PID 151780, HTTP 200. Dedicated LandOS Chrome
on CDP 9224, owned. The live database was never touched by either task.

# Verification Required

Met. Full suite 6,045 passing across 445 files with 0 failures; `tsc --noEmit`
clean; production build clean; the nine previously failing files run first and
green before the full sweep. Both commits verified equal to origin/main with
`git fetch` after pushing.

# Completed and Protected

Retain everything previously protected. Plus: `main` must keep representing the
accepted running LandOS, so accepted production work is never left uncommitted
across a session boundary; generated acceptance, devloop and CDP artifacts stay
ignored rather than committed; an ignore rule that would exclude live tooling
must stay root-anchored, as `/data/` now is; a test fixture must be committed
and reproducible, never a gitignored generated run; a labeled parcel value that
runs on into a street address is refused rather than accepted as a parcel id,
because a wrong APN is a different parcel; and a stale assertion is re-expressed
against current structure or strengthened, never deleted, excluded, or weakened
into a tautology.
