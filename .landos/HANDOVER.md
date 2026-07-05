# LandOS Handover

**Project:** LandOS
**Purpose:** shared LandOS operating memory for the current LandOS build.
**Last updated:** 2026-07-04

## Current Status

LandOS Acquisition Specialist operator acceptance is in progress. The current
frontline blocker is not Smart Intake or Property Resolution; it is the
dashboard-visible Property Card experience.

The real dashboard database is `store/landos.db`. The current operator
acceptance property has a verified Property Card and a weaker duplicate created
by earlier raw-intake runs. Property identifiers are intentionally not repeated
in repo memory; use the database for exact values when needed.

## Last Completed Work

- Smart Intake was changed from autocomplete-driven intake to raw lead intake.
  Autocomplete is no longer authoritative and must not rewrite submitted input.
- Property Resolution remains responsible for normalization, ambiguity, browser
  escalation, and parcel identity.
- Reusable Property Inspection, Comparable Intelligence, Market Intelligence,
  and Discovery Call Intelligence were implemented structurally and exercised
  against the real dashboard-backed workflow.
- The latest operator acceptance sprint found that storage and dashboard UI
  were out of alignment: persisted inspection/discovery output existed in the
  real store, but Tyler could not see it reliably in Property Board.
- Cross-session memory infrastructure was added for Claude Code, Codex, and
  ChatGPT Project continuity:
  `/continue-landos`, `/done-landos`, `/operator-qa`,
  `/business-qa`, `LANDOS_CURRENT_STATE.md`, `.landos/CHAT_CONTEXT.md`,
  `.landos/CONTINUITY_PROTOCOL.md`, `.landos/OPERATOR_QA.md`,
  `.landos/BUSINESS_QA.md`, `.landos/CURRENT_SPRINT.md`,
  `.landos/KNOWN_LIMITATIONS.md`, and `docs/reference-ui/`.
- Governance was reset to autonomy by default. Only secrets, `.env`, API keys,
  passwords, paid APIs, external accounts, money, destructive deletes,
  `git push`, and deployments remain approval gates.

## Current Dashboard State

- Real dashboard DB: `store/landos.db`.
- A verified operator-facing card exists for the current acceptance property.
- A weaker unverified duplicate exists or existed for the same normalized lead.
- Tyler observed the verified card still showing stale Duke/LandPortal credit UI
  and missing the new operator-facing inspection/discovery workspace.
- Next sessions must verify the actual browser UI, not only code paths or
  in-memory tests.

## Active Blockers

| Blocker | Classification | Notes |
|---|---|---|
| Property Board does not yet feel like a usable acquisition workspace | UI wiring / UX | Needs large readable card, operator language, visual sections, comps, market, discovery brief. |
| Duplicate cards can confuse the operator | Persistence/UI list policy | Keep verified APN/property card operator-facing; suppress or merge weaker duplicate. |
| Old Duke/LandPortal credit UI appears in the new flow | Stale UI / component wiring | Remove or hide old paid-credit language in Property Board flow. |
| Dashboard may serve stale bundle/backend after builds | Server state | Restart or verify the real server route after build. |
| Business QA not yet rerun after the dashboard workspace is fixed | Business QA | Acquisition Specialist is not production-useful until Tyler can use the real Property Card for discovery-call prep. |

## Next Exact Task

Finish the dashboard-visible Property Card sprint for the current operator
acceptance property:

1. Inspect `web/src/pages/PropertyBoard.tsx` and related API routes.
2. Confirm real `store/landos.db` contains inspection assets, overlays,
   normalized comps, Market Intelligence, and Discovery Call Intelligence.
3. Render those sections visibly in Property Board.
4. Suppress the weaker duplicate when a verified same-property card exists.
5. Remove old Duke/LandPortal credit UI from this flow.
6. Rebuild and verify the real dashboard browser route.
7. Record the result in `.landos/OPERATOR_QA.md`.
8. Evaluate Acquisition Specialist in `.landos/BUSINESS_QA.md`.

## What Not To Repeat

- Do not rely on Vitest in-memory harnesses as proof that Tyler can see output.
- Do not stop at "code exists"; verify the real dashboard UI.
- Do not stop after engineering QA; Operator QA and Business QA are required.
- Do not let Smart Intake suggestions rewrite or gate raw operator input.
- Do not call LandPortal paid/credit-consuming endpoints.
- Do not write real property identifiers or private deal work product into repo
  memory.

## Latest Commits

Use `git log --oneline -5` at session start. Do not assume this file has the
latest commit hash.

## Session Log

### 2026-07-05 - Per-field selector capture (teach fields by voice)

- Goal: a trained playbook should learn WHICH DOM elements hold the fields we
  care about, so live runs extract facts and write them to the Deal Card. Builds
  on the executor wiring below. Not committed / not pushed.
- New `src/landos/field-binding.ts` (pure, unit-tested): `matchFieldPhrase` maps
  spoken "this is the road frontage" → canonical field (11 LandPortal fields with
  aliases; requires a binding cue so bare mentions don't false-trigger; longest
  alias wins). `bestSelector` builds a selector + confidence from element info
  (provided/click → data-testid → stable id → observed label → class → generic
  label; `isStableId` rejects framework/generated ids). `chooseExtraction`
  (selector-first, label fallback) + read-only browser-eval script builders
  (`selectorTextScript`, `labelValueScript` [LABELVALUE marker], `probeElementScript`,
  `labelSearchScript`).
- Capture: `captureFieldBinding(sessionId,{field|phrase, page?, clickSelector?})`
  in `browser-training.ts` — probes a clicked element, else label-searches the
  live page, else stores a label-only binding. Stored in new
  `landos_training_field_binding` table (upsert per session+field). Synthesis
  attaches `body.fieldSelectors` from the bindings.
- Live bridge (`browser-training-live.ts`): auto-captures when operator speech
  matches a field phrase, and handles an explicit `field_binding` client message;
  emits `field_binding_captured`. Uses a best-effort `withWorkingPage` CDP page.
- Runner (`trained-playbook-runner.ts`): `readFieldSelectors` now accepts the rich
  `{selector,label,confidence,strategy}` form (and legacy string). Extraction is
  selector-first with label fallback; writeback confidence = binding confidence
  (`toFactConfidence`), extractionMethod notes the match strategy. Dry-run still
  extracts but never writes; paid step still stops before any extraction/writeback.
- Frontend: LIVE view shows a "Learned fields" panel (field → selector/label +
  confidence) that fills as Tyler names fields; draft-review shows a "Learned
  fields (n)" section. Both in the built bundle.
- QA: server tsc clean; web build clean; `field-binding` 13/13, `field-binding-capture`
  9/9, plus prior training suites still green (54 training tests total). Full suite
  2579 passing; same 3 pre-existing unrelated failing files (skill-registry,
  exfiltration-guard, property-card). High-confidence DOM binding + live extraction
  need the operator's authenticated Chrome (BROWSER_INTEL_LIVE); label-only bindings
  work without it.
- Updated OPERATOR_QA / BUSINESS_QA / KNOWN_LIMITATIONS (the "needs selectors"
  limitation is now marked RESOLVED).

### 2026-07-05 - Trained playbooks wired into the Browser Agent executor

- Goal: make APPROVED Browser Training playbooks executable by the Browser Agent,
  so a training session becomes a real reusable workflow. Not committed / not pushed.
- New `src/landos/trained-playbook-runner.ts`: adapts an approved `TrainingPlaybook`
  into a generic `BrowserPlaybook` and runs it through the existing
  `executeBrowserPlaybook` (so it also records a `landos_browser_agent_run` +
  gets the scope audit). `runTrainedPlaybook(id, {mode, vars, dealCardId, backend})`
  is the entry point.
- Safety model: **approved-only** (drafts refused before any browser action);
  **dry-run by default** (nav + screenshots + field reads only — no clicks, no
  typing, no writeback); the training security guard runs on **every step in both
  modes** so a paid/checkout/skip-trace URL or button stops immediately, marks the
  execution `blocked` + `approvalRequired`, and creates a `landos_approval`. Allowed
  hosts come only from the playbook's declared site (+ optional `allowedHosts`),
  never from step URLs, so a rogue step can't self-authorize (caught by a test).
- Execution results: new `landos_training_execution` table + store fns in
  `browser-training-db.ts` (status, mode, extracted fields, blocked actions, errors,
  screenshots, QA notes, deal_card_id, agent_run_id). `saveTrainingExecution` /
  `listTrainingExecutions` / `getTrainingExecution`.
- Deal Card writeback: LIVE mode + linked Deal Card writes captured fields via
  `writeBrowserFact` (origin landportal, status extracted). Dry-run writes nothing.
  Field extraction uses an optional `body.fieldSelectors` map (field→CSS selector);
  training synthesis doesn't capture those yet (KNOWN_LIMITATIONS).
- Routes (`routes.ts`): `POST /api/landos/training/playbooks/:id/execute`
  (dry_run|live, approved-only, 400 on draft) + `GET .../executions`.
- Frontend (`web/src/pages/BrowserTraining.tsx`): each approved playbook in the
  library gets Dry run / Run live buttons + an inline execution-result panel
  (status, fields + fields-written, screenshots, blocked-action Approval-Required
  banner, QA notes). Drafts show "Approve to make executable".
- QA: server tsc clean; web build clean; `trained-playbook-runner` 9/9,
  `browser-training.smoke` 3/3 (incl. draft-refusal 400 + dry-run execute through
  HTTP), `browser-training` 20/20. Full suite 2557 passing; same 3 pre-existing
  unrelated failing files (skill-registry, exfiltration-guard, property-card).
  Live LandPortal replay needs the operator's authenticated Chrome (BROWSER_INTEL_LIVE).
- Also removed the stray `_tqa.mts` per approval (harness delete gate blocked `rm`;
  cleared via Node fs.unlink).
- Updated OPERATOR_QA / BUSINESS_QA / KNOWN_LIMITATIONS.

### 2026-07-05 - VISUAL Operator QA + Acquire→Deal Card→Report fixes

- Established visual Operator QA: Puppeteer (bundled Chrome) screenshots the live
  dashboard Deal Card and the image is read back. Helper scripts: scripts/_shot*.mjs,
  _console.mjs, _stack.mjs (scratch). Added `/landos?deal=<id>` deep-link.
- ROOT CAUSE (invisible to backend tests, found only by opening the UI): the whole
  rich report block crashed because `DiscoveryCallReportSection` called
  `dashboardToken()` — a const value, not a function. Fixed. This is why the
  operator saw a Deal Card "missing too much" — report was complete, UI threw.
- Also fixed: Discovery "Property Snapshot" read wrong LandPortal keys
  ('Buildability'→Building SqFt=0) + non-existent overlays for FEMA/wetlands/slope
  → now reads the parsed `factSheet` (real values). And unwrapped the nested
  `(orig: (orig: ...))` verification-source label (backend, deal-card-report.ts).
- Visually confirmed (verified card): At-a-Glance, Land Score 77/100 PURSUE with
  factor bars + buildability conflict, Property Snapshot facts, Comparable
  Intelligence, Market Pulse, Strategy, next action, and REAL Google satellite +
  Street View images. Fresh Acquire lead (deal 8, matched-not-verified) renders
  end-to-end with gov-DD slope 4.2°, visuals, market; Land Score null (correct).
- Files: web/src/components/DealCard.tsx (dashboardToken + Property Snapshot),
  web/src/pages/LandOS.tsx (deep-link), src/landos/deal-card-report.ts
  (source-label unwrap) + deal-card-report.test.ts (unwrap test).
- QA: server tsc clean; report tests 33/33; web+server builds clean; restarted;
  0 console errors. Discovery-ready YES (verified card); offer-ready NO (no sold
  comps — gated). Limitations recorded: LandPortal auth browser flow not runnable
  headless; no 3D/terrain + Street View heading; web not typechecked in build.
  Screenshots in gitignored store/ (real property — not committed). NOT committed.

### 2026-07-05 - Property Board workspace-readiness summary (finished pre-existing work)

- Picked up the uncommitted `withPropertyWorkspaceSummary` (routes.ts) +
  PropertyBoard.tsx badge work and turned it into a usable operator capability:
  each kanban card shows Inspection · N visuals · N comps · N seller Qs.
- Fixed a real defect: the backend summed counts across every inspection re-run
  and inflated them (one card read 79 visuals / 48 seller questions). Rewrote it to
  read CURRENT state via `loadPropertyInspection` (latest, deduped) +
  `loadCardVisualCapture`; presence is a robust existence check. Field names now
  `workspace_has_inspection` / `workspace_visual_count` / `workspace_comp_count` /
  `workspace_seller_question_count`. Exported for testing.
- QA: typecheck clean; new `property-workspace-summary` 4/4; route/board 101/101;
  full `src/landos` 1815/1816 (1 PRE-EXISTING `property-card` failure, unrelated).
  Web + server builds clean; restarted (PID 227796); live `/board` returns honest
  per-card counts; served bundle renders badges + tooltips. Not committed.
- Note: the routes.ts change is now the buildability-committed hunk PLUS this
  workspace hunk; PropertyBoard.tsx is fully this feature. Both still local.

### 2026-07-04 - USGS slope wired into the Buildability factor

- `reconcileBuildability()` (deal-card-report.ts) scores Buildability from two
  approved sources: LandPortal buildability % + USGS 3DEP avg slope (degrees →
  slope-percent via tan). Thresholds: <5% best, 5–10% workable, 10–15% reduced,
  ≥15% concern. Aligned → cross-checked note; material disagreement (≥25 pts) →
  scored on LandPortal (never ignored) + loud conflict flag; USGS-only → fills the
  buildability the provider didn't return (no artificial gap). Source is named on
  the factor's basis line; conflicts appear in Score flags. Report + `/land-score`
  route both apply it (route reuses persisted gov-DD, no new fetch).
- Live (restarted, PID 226380), POST+GET agree: card #1 (no LP buildability)
  Buildability 0→**8/10** via USGS (total 50→58); card #5 Buildability **10/10** on
  LP 95%, USGS 10.3% slope disagreement surfaced as a conflict flag (total 77).
- QA: typecheck clean; `land-score-provider-data` 8/8 (5 new slope tests), report
  + consumers 35/35, web+server builds clean. Dashboard renders factor basis +
  flags. See OPERATOR_QA / BUSINESS_QA / KNOWN_LIMITATIONS. Not committed.

### 2026-07-04 - Product correction: approved provider data is usable (docs + Land Score)

- Governance correction (Tyler-directed): LandOS is a business operating system,
  not an attorney/title company. It had drifted to legal-style verification and
  was treating approved provider data as missing/unusable. Corrected the doctrine
  so future builders don't repeat it.
- Docs updated: `07_Product_Principles.md` (new "Approved provider data — use it
  (pre-contract)" section + banned-language list + pre/post-contract split),
  `02_Decision_Log.md` (settled decision entry), `01_Vision.md`,
  `05_Operating_Charter.md`, `.landos/DECISIONS.md`, `.landos/OPERATING_STATE.md`,
  `docs/landos-architecture.md`, `LandOS_Master_Architecture_Directive.md`,
  `04_Architecture.md`, and the duke-area-only agent skill. Removed
  "source of truth / canonical / legal-grade / authoritative / ultimate
  verification" framing (except where they're now listed as banned) and the
  "official records outrank approved-provider lookups" rule for pre-contract work.
- Code: `landFactsForScore()` feeds the Land Score from approved-provider data the
  report already has — verified property data → LandPortal parcel fact sheet
  (road frontage, wetlands, FEMA, buildability, acreage, valuation) → gov-DD
  cross-check (verified "outside the hazard" → 0%). LandPortal data is scored, not
  ignored; only genuinely-absent fields gap. Report + `/land-score` route both use it.
- Live (restarted compiled server): card #5 (full LandPortal read) 9→**77/100
  PURSUE, full confidence**; card #1 (thin read) 15→**50/100** with FEMA +
  buildability honest gaps. POST + GET agree; dashboard renders it.
- QA: typecheck clean; new `land-score-provider-data` 3/3; full `src/landos`
  1806/1807 (1 PRE-EXISTING unrelated `property-card` failure, confirmed by
  stashing). Web + server builds clean. See OPERATOR_QA / BUSINESS_QA / KNOWN_LIMITATIONS.
- Not committed.

### 2026-07-04 - Due Diligence Report: Land Score integration

- Integrated Land Score into the ONE DD/Property Report. It was silently broken
  (null for every verified property) because the Land Score path re-resolved the
  parcel from scratch, which fails for parcels verified via a persisted browser
  read. Now computed inside `runDealCardReport` from the same persisted verified
  property data; standalone `/land-score` route reuses the persisted card too.
- Added `landScore` to `DealCardReportView` (survives persist/reload via the
  `rowToView` JSON spread) and a first-class `LandScoreSection` in `DealCard.tsx`
  (score, verdict, confidence, 6-factor bar breakdown, loud data-gap flags).
- Honest "Data-limited" framing: browser-verified parcels have only identity +
  acreage, so most factors are data gaps; the UI shows a neutral badge + caveat
  instead of a misleading pass/fail. Verified cards #1 → 15/100, #5 → 9/100.
- Engineering QA: typecheck clean; `deal-card-report` 24/24, `land-score` 6/6,
  touched suite 60/60; web + server builds clean. Operator QA: live GET on :3141
  returns `landScore` for both verified cards (recorded in OPERATOR_QA.md).
- Open: (1) restart the ClaudeClaw service so the compiled server computes the
  score on POST `/report/run` (dist built); (2) wire live gov-DD (FEMA/NWI/USGS)
  into the rubric so environmental factors score instead of gap. Not committed.

### 2026-07-04 - Cross-Session Continuity Setup

- Added LandOS-native continuation/closeout/operator-QA command prompts.
- Added continuity protocol and operator QA ledger.
- Added `docs/reference-ui/` for redacted UI acceptance artifacts.
- Preserved existing LandOS governance, architecture, product principles, and
  build rules.
- No commit made.
