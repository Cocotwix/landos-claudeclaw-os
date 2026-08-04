# Current Active Task

The V2 property-intelligence functional baseline is committed on `main`
(single clean commit replacing the oversized local commit `2a60346`, which
had swept in the whole dirty worktree; nothing was pushed). The commit holds
only the approved scope plus compiler/test-proven dependencies: V2 route +
Overview + Property Intelligence tab, desktop rendering corrections, scores
at top, uncropped hero, LandPortal subject links, Property Score
recalculation, Hermes v0.20 import/auto lanes, SOP 10B, and the
property-market-context join. No new task is active.

# Exact Operator Outcome

`http://localhost:3141/dept/acquisitions/v2?deal=81` (and
`&section=property-intelligence`) open with Property 74 Strong / Market 57
Moderate / Seller Pending at the top of both pages, each with a transparent
ledger explanation and +/− factors. The Overview hero renders the retained
close-parcel aerial at natural aspect: complete boundary, Onionville Rd,
Sterling Creek, no LandPortal sidebar; facts and caption fill the right pane.
"View in LandPortal" (header, both pages) and "Open this subject in
LandPortal" (hero) open the verified subject (fips 36011 / APN / 89525293)
in a new tab. PI gallery thumbnails are 367×230 and click through to full
size; market context stays labeled "LandOS Market Research — not
LandPortal". Both pages survive refresh and managed restart.

# Current State

<!-- DERIVED:START -->
- **Generated:** 2026-08-04T05:45:00.000Z
- **HEAD at generation:** `f25d7a5` (parent; this checkpoint ships inside the replacement baseline commit built on it)
- **Worktree:** DIRTY by design; the excluded workstreams below remain uncommitted. Preserve them.
- **Latest tests:** PASS at 2026-08-04T05:32:40Z; focused suites on the exact committed tree in an isolated worktree: deal-operator-analysis.contract, property-market-context, property-intelligence.routes, hermes-landportal-auto, hermes-landportal-import; 52 tests, 0 failures.
- **Latest typecheck:** PASS at 2026-08-04T05:34:00Z on the exact committed tree (the parent alone had 19 errors; this commit repairs them).
- **Latest production build:** PASS at 2026-08-04T05:35:00Z; server (tsc) and web (vite) on the exact committed tree; only pre-existing chunk-size warnings.
- **Managed runtime:** RUNNING healthy at 2026-08-04T03:44:00Z; PID 128224; http://localhost:3141.
<!-- DERIVED:END -->

# Completed and Proven

Committed baseline (54 files): V2 page/component/stylesheet + App route;
deal-operator-analysis (metric-aware Property Score: frontage/buildability/
coverage govern sign, retained parcel imagery counts as boundary evidence,
% normalization, base-58 ledger explanation, quarantine preserved);
property-market-context read-time join; routes.ts PI projection
(marketContext, subjectParcelUrl, visualKey separation); Hermes v0.20
import/auto lanes; SOP 10B doc + landos-landportal SKILL; and the 35
compiler/test-proven server dependencies (snapshot/assembly/inspection/
card/db schema with the zip column, market-scan, landportal evidence
validation + operating rules, live collectors, etc.). The set was proven by
building the tree at the parent, adding only files tsc/vitest demanded, then
passing typecheck, both builds, and 52 focused tests on that exact tree.

# Remaining Work

Uncommitted workstreams intentionally left dirty in the worktree, each
needing its own review-and-commit decision from Tyler: governed multi-agent
architecture + governance schemas; governed Hermes profiles; MCP servers;
knowledge registries + docs; acceptance/visual-QA architecture (playwright
config, acceptance scripts/schemas); Browser Use pilots (scripts +
LandPortalBrowserUsePanel); memory/protocol revamp (CLAUDE.md, AGENTS.md,
.hermes.md, .landos protocol files, memory/runtime scripts); Deal Card V1
UI + test updates; dashboard/db root changes; package.json/lock additions
(zod, @playwright/test, infra scripts). Functional follow-ups: other V2
tabs; valuation still not priceable; creek/water feature has no structured
fact so the score omits it.

# Exact Next Action

On Tyler's direction, pick one uncommitted workstream from Remaining Work to
review and commit separately (suggested first: memory/protocol revamp or
Deal Card V1 updates), or start the next functional V2 tab. No implicit
action is pending.

# Relevant Files

- `src/landos/deal-operator-analysis.ts` (+contract test)
- `src/landos/property-market-context.ts` (+test)
- `src/landos/routes.ts`, `src/landos/hermes-landportal-{auto,import}.ts`
  (+tests), `src/landos/property-intelligence.routes.test.ts`
- `web/src/pages/AcquisitionWorkspaceV2.tsx`,
  `web/src/components/AcquisitionWorkspaceV2PropertyIntelligence.tsx`,
  `web/src/styles/workspace-v2.css`, `web/src/App.tsx`
- `docs/landos/property-intelligence-sop.md`,
  `config/hermes/landos-profile/skills/landos-landportal/SKILL.md`

# Relevant Records

- Deal Card 81; Property Card 71; LandPortal 89525293; APN
  `055689 10.00-1-64.22`; 10 accepted visuals (hero natural 920×890).
- Screenshots under `store/browser-shots/acceptance-deal81/`:
  `v2-overview-desktop-correction.png`, `v2-overview-after-restart.png`,
  `v2-property-intelligence-desktop-correction.png`,
  `v2-property-intelligence-after-restart.png`.

# Known Blockers

None.

# Do Not Inspect or Modify

Do not expose `.env` or secrets, run destructive SQL, discard the dirty
worktree (it holds the uncommitted workstreams), or delete
`store/backups/landos-pre-rescue-2026-08-03.db` without Tyler's
authorization. Do not push without authorization. Do not weaken the
visual-evidence validation, comp source policy, SOP 10B, score-quarantine
logic, or completion gates.

# Runtime State

Managed LandOS healthy at `http://localhost:3141` (PID 128224); root and
/health 200. Authenticated LandPortal Chrome remains on CDP 9224 (operator
session, untouched).

# Verification Required

For follow-on changes to the score projection or V2 layout: rerun
deal-operator-analysis.contract, property-market-context,
property-intelligence.routes, and hermes-landportal suites; typecheck; both
builds; managed restart + health; live walkthrough of BOTH V2 pages at
desktop width incl. refresh + restart; memory audit; secret scan.

# Completed and Protected

Retain: the metric-aware propertyScore recalculation with ledger
explanation; imagery-as-boundary-evidence with survey upgrade path; the
score strip on both sections; the contain-based hero; verified-URL-only
LandPortal links; the enlarged clickable gallery; SOP 10B labeling; the four
correction screenshots; the isolated-worktree proof method for minimal
commits. Standing protections: no secret exposure, no destructive SQL, no
cross-property evidence, dirty-state preservation.
