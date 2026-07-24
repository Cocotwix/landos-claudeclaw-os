# LandOS Current Checkpoint

<!-- DERIVED:START -->
- **Generated:** 2026-07-24T04:20:10.830Z
- **HEAD at generation:** `e614d51`
- **Worktree:** DIRTY; 62 modified/untracked paths at refresh time. Preserve unrelated changes.
- **Latest tests:** PASS at 2026-07-23T16:00:56-04:00; 295 files, 3642 tests, 0 failures (vitest run, full suite).
- **Latest typecheck:** PASS at 2026-07-23T16:01:30-04:00; tsc --noEmit.
- **Latest production build:** PASS at 2026-07-23T16:02:30-04:00; server TypeScript build and Vite production bundle passed; Vite emitted only the existing large-chunk advisory.
- **Managed runtime:** RUNNING healthy at 2026-07-23T16:04:38-04:00; PID 60512; http://localhost:3141.
- **Active sprint:** sprint-2026-07-17-operator-useful-leads (complete); 3/3 accepted, 0 QA-passed; current workstream none in flight; 0 open QA findings.
- **Sprint ledger:** .landos/sprints/sprint-2026-07-17-operator-useful-leads/ledger.json; proof report .landos/sprints/sprint-2026-07-17-operator-useful-leads/report.md; frozen capabilities: 3 (.landos/capabilities.json).
<!-- DERIVED:END -->

Live repository state, database state, runtime, and owner-visible behavior override anything written here.
Detailed reports remain under `docs/landos/`. Do not
commit or push until Tyler explicitly authorizes it.

## Current objective and state

The derived block above is stale where it disagrees with this session's
verified results: full suite PASS 2026-07-24, 304 files / 3728 tests / 0
failures; server tsc, server build, and Vite production build PASS (only the
existing large-chunk advisory); managed runtime RUNNING healthy PID 53840 at
http://localhost:3141.

Four uncommitted vertical slices coexist and must be preserved:

1. Canonical Property Version -> evidence -> versioned Property Summary.
2. Durable government-record collectors -> immutable pages/claims -> versioned
   Government Record Risk snapshot -> owner Documents panel.
3. Smart Intake native text paste + multi-image clipboard/upload/drop ->
   immutable artifact + exact multimodal transcription -> editable unconfirmed
   candidates -> approved-source resolution attempt with no screenshot promotion.
4. Multi-path parcel resolution for the Smart Intake handoff: state/county +
   APN primary (normalization variants), LandPortal parcel-level browser search
   (property id/FIPS discovered, never required), county + owner as an
   independent lookup key (never a seller-authority gate), address as secondary
   corroboration with materially different roads rejected, full operator-visible
   evidence, and standard-path canonical promotion on confirmation.

## Multi-path resolution fix (2026-07-24)

Root cause: geocoder-first `liveResolutionDeps` (LandPortal lanes off), TN
adapter unable to decompose GISLINK-format APNs, trailing ZIP misread as house
number (wrong-road corroboration accepted), planner falling through to
"LandPortal property id + FIPS". Fixed in `instruction-consistency`
(first-token street number; `roadNamesCompatible`), `resolver-planner`
(honest next identifier), `landportal-client` (owner-variant extensions),
`public-property-intelligence-live` (TN APN clause generation + county+owner
path + corroboration-only address; collapsed GISLINK as APN),
`property-resolution-engine` (materially different suggested road rejected),
`routes` (LandPortal browser lane wired, browser-mission gate, full-evidence
handoff, `promoteConfirmedIntakeResolution` via the standard approved path,
accepted-parcel contradiction protection), and `LeadCardIntake.tsx`
(`ResolutionHandoffPanel` shows every path, source, fact, rejection, promotion).

Live Deal 32 acceptance via the operator button: TN Comptroller matched APN
`073090 04200` (GISLINK ordered-group, Roane-filtered) returning owner
`SACHAN DILEEP S`, `OLD RIDGE RD`, 12.28 ac, coordinates + source URL.
LandPortal genuinely searched (4 APN variants + owner + address) and honestly
refused a Davidson-county APN collision. No Ridge Trail Road in stored state;
regression test pins the rejection. Identity `confirmed` (1.0); property card
32 verified from the official record and linked subject; downstream follows
the confirmed-parcel gate. Refresh + managed restart preserved one
submission/artifact (same SHA-256) and nine candidates. Only console message:
pre-existing honest 502 from `/overlay/aerial` (no Roane aerial capability),
newly visible because the parcel is confirmed.

## Smart Intake implementation and proof

- `LeadCardIntake.tsx` keeps text-only paste fully native; image-bearing
  clipboard events insert `text/plain` once and append every supported image;
  multi-select, drag/drop, and remove work. PNG/JPEG/WEBP ≤10 MB validated by
  MIME + extension + magic bytes; rich HTML never rendered.
- Submissions carry an idempotency key and resolution result; artifact rows
  are immutable (UPDATE/DELETE triggers) with full provenance (name, URL,
  MIME, size, SHA-256, method, exact text, extraction JSON/status/model,
  timestamp). Candidates live in separate editable rows; operator corrections
  never change the original image or extraction; original text stored exactly.
- Screenshot candidates stay `candidate` status, never update canonical
  identity/geometry; owner/contact mismatch is non-gating; extraction failure
  preserves the image with honest `unavailable` status.

Deal 32 Roane proof (earlier sessions, now superseded by confirmation below):
the blank card's supplied PNG (2,949,777 bytes, SHA-256
`df2e1d2c898c9726daca94fbdb0db600ced3a59339a4ca9d012fdbb850ea09f3`) yielded
nine editable candidates (owner `SACHAN DILEEP S`, road `OLD RIDGE RD`,
KINGSTON TN 37763, Roane County, APN `073090 04200`, platform Regrid; acreage/
coordinates explicitly unread). A resolution-only UI defect hiding Smart
Intake and an unlabeled thumbnail link were fixed; the labeled in-card
full-resolution viewer (fit/100%) works in pending and confirmed paths.
Refresh/restart preserved one submission, one artifact, nine candidates with
no duplicates and no console errors.

## Prior slice proof to preserve

- Deal 31 verified control (identity/snapshot v1, 100%, nine immutable
  evidence items) and Deal 10 unresolved control (imagery/comps/valuation/
  strategy withheld) both persist through restart.
- Deal 14 government record snapshot v5: identity v1, 60% screened, medium
  confidence; deed/ownership complete, other lanes honestly partial; seven
  retained pages for instrument 1997O31519 with SHA-256 + official source.

## Preserved work and exclusions

Intended modified files include `.landos/CHECKPOINT.md`, `src/landos/db.ts`,
`src/landos/routes.ts`, `src/landos/lead-card-intake.ts` and tests,
`src/landos/instruction-consistency.ts` (+test), `src/landos/resolver-planner.ts`
(+test), `src/landos/landportal-client.ts`,
`src/landos/public-property-intelligence-live.ts` (+test),
`src/landos/property-resolution-engine.ts` (+test),
`web/src/components/LeadCardIntake.tsx`, plus the untracked government-record
and Smart Intake modules/tests/panels. Review the diff carefully.

Never stage local `.claude`, `.kilo`, root debug scripts, `tmp_query*`,
`verify-deal30.mjs`, or `scripts/tmp-*`; they are unrelated investigation
artifacts.

## Required invariants

1. One accepted property identity version is current.
2. Candidate and confirmed states cannot coexist in the owner read model.
3. Accepted facts link to evidence and the researched identity version.
4. Operator corrections beat weaker automation.
5. GET requests perform no provider work or reconciliation writes.
6. Collector failures are isolated and restart-resumable.
7. Unresolved identity cannot show parcel-specific imagery, ranked best comps,
   FMV, or actionable strategy.
8. Screenshot text/geometry never establishes official identity or boundaries.
9. Lead/seller/wholesaler identity never must match screenshot owner.

## External diligence and next action

- Deal 30 still needs a valid authenticated LandPortal 2D replacement image.
- Professional deed/title/lien, tax, zoning, access, septic, utility, and split
  verification remain required before relying on those conclusions.
