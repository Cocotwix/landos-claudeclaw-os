# Current Active Task

None. The one-time repository reconciliation is complete: the accepted LandOS
is fully committed and pushed, and the working tree is clean. Awaiting Tyler's
next instruction.

# Exact Operator Outcome

`main` truthfully represents the LandOS that is accepted and running. A fresh
checkout of the pushed baseline builds and runs it, no accepted production work
sits uncommitted, and the operator's live data was untouched throughout.

# Current State

- **Generated:** 2026-08-11T00:59:40Z
- **HEAD at generation:** `395644d`. main = origin/main, ahead/behind 0/0.
- **Worktree:** clean. 0 dirty paths, 0 staged files.
- **Build:** PASS (vite + tsc), only pre-existing chunk-size warnings.
- **Runtime:** RUNNING healthy, PID 151780, http://localhost:3141, HTTP 200.
- **Dedicated LandOS Chrome:** running, CDP 9224, owned.

# Completed and Proven

Reconciliation baseline `395644db3f5ab403923696e91500d7d13da092e8`, one commit,
378 files, pushed to origin/main and verified equal after `git fetch`.

Dirty paths went 411 to 0. One commit was the only correct shape: 22 untracked
modules are hard dependencies of tracked, currently-modified production code,
and `routes.ts` alone imports 13 of them, so no sprint-only slice could compile.

Committed and proven reachable, zero orphans: acreage router; land-use and
zoning stack; GIS transport with ArcGIS, Tyler and Schneider adapters;
public-record access and browser login; state-law retrieval; subject-identity
reconciliation; exact-address web discovery; access-evidence ladder; comp-lane
accountability; LandPortal canonical identity, comp drilldown and overview
capture; governed Hermes profile templates and capability snapshots; knowledge
registries; Playwright acceptance harness; Python MCP servers; matching web
components.

Ignored rather than committed, all left on disk: Playwright acceptance run
artifacts (62 MB of trace, video and png, reproducible via
`npm run landos:acceptance:run`); the devloop candidate-lesson queue; two CDP
target dumps; two stray shell-redirect captures at the repo root, one of whose
filename was a real property address.

Defect found and fixed in the same commit: the bare `data/` ignore rule also
matched `scripts/data/`, silently excluding the four scripts that
`landos:data:backup`, `:restore`, `:drill` and `landos:qa:init` invoke, so a
fresh checkout could not run them. Narrowed to `/data/` and those four
committed.

Verification: `tsc --noEmit` clean; production build clean; managed restart
healthy; all 1,098 committed code files resolve their relative imports, the
only exceptions being one usage-string self-reference and eight `dist/`
build-output imports that `npm run build` produces. Two independent scans agree
no secret reached the commit. Deal 83 read live and unchanged: land-only
indication $625,500, whole-property value pending, five source-stated sales,
and Property Intelligence naming zillow.com, realtor.com and redfin.com.

# Remaining Work

Nothing for reconciliation. Still deferred and untouched: the house valuation
lane that would turn the land-only figure into a whole-property value; Strategy
agent; Pre/Post Discovery Revaluation; the exact-address lane's
`persistence.attempted` still false; no Run Property Intelligence control in the
V2 workspace, only legacy `/legacy/deal/:id`.

# Exact Next Action

Wait for Tyler's instruction. Do not start the house valuation lane or any
Remaining Work item, and do not begin a repository or test cleanup, without it.

# Relevant Files

- `.gitignore` — the narrowed `/data/` rule plus the new ignore block
- `scripts/data/landos-business-backup.mjs`, `scripts/data/landos-data.mjs`,
  `scripts/data/init-landos-qa.ts`, `scripts/data/landos-dpapi.ps1`
- `src/landos/governance/mcp-bridge.test.ts` — stale acceptance fixture
- `src/dashboard.ts` — hardcoded Obsidian allowlist paths, pre-existing

# Relevant Records

Baseline commit `395644d` on origin/main; prior HEAD was `d539e10`. Live run
`di_msntkf8z_2vsoyp` (deal 83, sequence 43) is unchanged and still carries the
three retrieved listing URLs the Property Intelligence panel projects.

# Known Blockers

Full suite: 6,032 pass, 13 fail across 9 files, all pre-existing and none
touched by the reconciliation. Most assert exact source text that later
refactors moved; `governance/mcp-bridge.test.ts` (2) points at an acceptance
fixture directory that no longer exists, and two devloop specs already
`--exclude` it. Awaiting Tyler's decision on whether to repair them.

Hermes templates are committed and complete, but deployed `~/.hermes` state has
drifted: `hermes:governed:check` fails all five profiles on CDP scope, CLI
allowlists and managed-file snapshots, and `landos:hermes:profile:check`
reports the LandPortal SKILL template mismatched. Not run:
`hermes:governed:provision --apply-external`, which mutates external state and
could strip capabilities. `image_gen`, `bfl` and `tts` remain enabled and can
incur cost, still awaiting Tyler's decision.

Deal 83's Decision Summary still says no usable comparable survived selection
from 18 collected rows while the valuation above it prices off five.

Sprint artifacts for 1487 Onionville carry that parcel's sale price, deed book
and assessed value. The identical data was already committed in `d539e10` via
that sprint's tracked `ledger.json`, so the baseline added no new exposure;
scrubbing history remains Tyler's call.

`landos:memory:checkpoint` still refuses to write because generator output
exceeds the 8192-byte ceiling, so this file was written directly under it.

# Do Not Inspect or Modify

Do not expose `.env` or secrets, print either dashboard token, run destructive
SQL, or delete `store/backups/landos-pre-rescue-2026-08-03.db`. Deny rules
`Bash(git push*)`, `Bash(rm *)`, `Bash(git clean*)` and broad `git add` are
intact; Tyler pushes manually. Never disable TLS verification. Do not create a
second Chrome profile: LandOS uses the one automation Chrome on CDP 9224. Do not
delete the ignored acceptance artifacts or the two devloop worktrees under
`.runtime/devloop/` without asking.

# Runtime State

Healthy on http://localhost:3141, PID 151780, HTTP 200, after
`npm run landos:restart` on the reconciled tree. Dedicated LandOS Chrome on
CDP 9224, owned. The live database was never touched by the reconciliation.

# Verification Required

Met for reconciliation. `tsc --noEmit` clean; production build clean; managed
restart healthy; full suite run twice with identical results; staged tree
audited for size, forbidden extensions, credentials and fresh-checkout
completeness before committing; deal 83 exercised live through Overview and
Property Intelligence. Push verified with `git fetch`: local and origin/main
both at `395644db3f5ab403923696e91500d7d13da092e8`.

# Completed and Protected

Retain everything previously protected. The prior sprint's protections stand
unchanged and were re-read live on the reconciled tree: a vacant-land comp set
is never presented as a whole-property value on an improved subject; a comp row
whose closed status was inferred from a printed date is labelled source-stated,
keeps full participation and provenance, and is never shown as verified or
above low confidence; merged comp counts, the summary sentence and the
priceability verdict are always re-derived together; exact-address discovery
reads engines and listing pages through the dedicated LandOS browser, never a
bare fetch; retained listing evidence is shown per provider with URL, facts and
provenance at listing-reported confidence.

New and protected: `main` must keep representing the accepted running LandOS, so
accepted production work is never left uncommitted across a session boundary;
generated acceptance, devloop and CDP artifacts stay ignored rather than
committed; and an ignore rule that would exclude live tooling must stay
root-anchored, as `/data/` now is.
