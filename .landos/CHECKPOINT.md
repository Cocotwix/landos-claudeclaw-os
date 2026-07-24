# LandOS Current Checkpoint

<!-- DERIVED:START -->
- **Generated:** 2026-07-24T02:59:40Z
- **HEAD:** `31956f3`
- **Worktree:** DIRTY. Preserve unrelated work and investigation artifacts.
- **Latest full repository suite:** PASS; 304/304 files, 3718/3718 tests, 0 skipped, 0 failures.
- **Focused Smart Intake:** PASS; 75/75 tests across the Smart Intake and Deal Card visibility suites.
- **Typecheck/build:** PASS; server `tsc --noEmit`, server build, and Vite production build. Vite emitted only the existing large-chunk advisory.
- **Managed runtime:** RUNNING healthy; PID 18580; `http://localhost:3141`.
- **Branch:** `recovery/deal-card-preservation-2026-07-23`.
<!-- DERIVED:END -->

Live repository state, database state, runtime, and owner-visible behavior override anything written here.
Detailed reports remain under `docs/landos/`. Do not
commit or push until Tyler explicitly authorizes it.

## Current objective and state

Three uncommitted vertical slices coexist and must be preserved:

1. Canonical Property Version -> evidence -> versioned Property Summary.
2. Durable government-record collectors -> immutable pages/claims -> versioned
   Government Record Risk snapshot -> owner Documents panel.
3. Smart Intake native text paste + multi-image clipboard/upload/drop ->
   immutable artifact + exact multimodal transcription -> editable unconfirmed
   candidates -> approved-source resolution attempt with no screenshot promotion.

Final Roane County acceptance was reopened after the operator reported that the
retained original could not be opened from Deal 32. The image itself—not
production constants—supplied every candidate below.

## Smart Intake implementation and proof

- `LeadCardIntake.tsx` leaves text-only paste native, preserving Ctrl+V,
  right-click Paste, selections, undo, line breaks, large text, and editing.
  Image-bearing clipboard events insert `text/plain` once and append every
  supported image. File selection is multi-select; drag/drop and remove work.
- Client/server validation accepts PNG, JPEG/JPG, and WEBP up to 10 MB. Server
  verifies MIME, extension, and magic bytes. Rich HTML is never rendered.
- `landos_intake_submission` now has an idempotency key and resolution result.
  `landos_intake_artifact` retains Deal/submission association, original name,
  card-scoped URL, MIME, size, SHA-256, clipboard/upload/drop method, exact
  extracted text, full extraction JSON/status/model, and timestamp. UPDATE and
  DELETE triggers make artifact rows immutable.
- `landos_intake_candidate` stores editable candidate fields separately, so
  operator correction cannot change the original image or extraction.
- Original operator text is stored exactly; normalization is analysis-only.
- Screenshot candidates are saved with `candidate` status. They do not update
  canonical identity or geometry. Owner/contact mismatch is explicitly
  non-gating. Address/APN/county/state candidates begin the existing resolver;
  the handoff records that no canonical promotion occurred.
- One multimodal image call returns exact text, normalized candidates, other
  labels, uncertainty, missing fields, and notes. Failure preserves the image
  with honest `unavailable` status.

Live Deal 32 Roane proof:

- A blank card began with no accepted address, APN, owner, acreage, coordinates,
  or canonical identity. File selection visibly previewed the supplied PNG,
  original filename, 2,949,777-byte size, upload source, and Remove control.
- The configured multimodal path extracted exact visible text and nine editable
  candidates: owner `SACHAN DILEEP S`; address `OLD RIDGE RD, KINGSTON, TN
  37763`; road `OLD RIDGE RD`; city `KINGSTON`; state `TN`; ZIP `37763`; county
  `Roane County`; APN `073090 04200`; source platform `Regrid`. Acreage and
  coordinates stayed explicitly unread.
- The retained SHA-256 is
  `df2e1d2c898c9726daca94fbdb0db600ced3a59339a4ca9d012fdbb850ea09f3`.
- Resolution remained Candidate / pending; the UI explicitly said canonical
  promotion none, owner/contact match not required, and withheld all downstream
  property intelligence.
- Live testing found and fixed a resolution-only UI defect that hid Smart Intake.
  Candidate-resolution cards now retain the evidence/candidate panel without
  exposing gated property intelligence.
- Refresh and managed restart preserved one latest submission, one artifact,
  one candidate panel, and nine candidate inputs. No Earlier Intake appeared;
  reopening/reloading created no duplicate. Console errors: zero.

Final Deal 32 artifact acceptance:

- The original bytes were always durable; the defect was an unlabeled
  `target="_blank"` thumbnail link that did not open a viewer in the operator
  browser. The earlier accessibility claim was too broad.
- `LeadCardIntake.tsx` now provides a labeled thumbnail button, in-card
  full-resolution viewer with fit/100% controls, and full provenance. The
  viewer remains available in both pending-resolution and confirmed-card paths.
- After ordinary refresh and managed restart, Deal 32 retained exactly one
  submission, one artifact, nine editable candidates, the same artifact ID,
  capture timestamp, SHA-256, and complete extraction; no canonical promotion
  or console error occurred. The original loaded at 2045x1335 in the viewer.

## Prior slice proof to preserve

- Deal 31 verified control: identity/snapshot v1, 100% complete, nine immutable
  evidence items; accepted APN/owner/acreage persisted through restart.
- Deal 10 unresolved control: parcel-specific imagery, ranked comps, valuation,
  and actionable strategy remain withheld through restart.
- Deal 14 government record snapshot v5: identity v1, 60% screened, medium
  confidence; deed/ownership complete and other lanes honestly partial. Seven
  retained pages for instrument 1997O31519 remain visible with SHA-256 and
  official source. Refresh/restart were idempotent and console-clean.

## Preserved work and exclusions

Intended modified files include `.landos/CHECKPOINT.md`, `src/landos/db.ts`,
`src/landos/routes.ts`, `src/landos/lead-card-intake.ts` and tests,
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
- Obtain professional deed/title/lien, tax, zoning, access, septic, utility, and
  split verification before relying on those business conclusions.
- Do not commit or push without separate explicit authorization.
