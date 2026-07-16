# LandOS Handover (superseded — history only)

Superseded 2026-07-15 by `.landos/CHECKPOINT.md` (auto-loaded current state)
and `.landos/PERMANENT_MEMORY.md` (durable rules). Do not update this file and
do not treat it as current; the content below is a stale 2026-07-04 snapshot
retained as on-demand history.

**Project:** LandOS
**Purpose:** historical LandOS operating memory snapshot.
**Last updated:** 2026-07-04 (frozen)

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

### 2026-07-06 - Property Resolution + Acquisition Workflow ordering (identity gate)

- Root cause of the failing acquisition workflow: downstream Property Intelligence began before the parcel was confidently identified. `deriveConfidence` gave a non-verified property up to 0.7 from the operator's OWN echoed input (address 0.3 + county/state 0.2 + APN 0.2), and the acquire route ran full Property Intelligence/comps/Market Pulse on any `matched` (conf ≥0.7) property — so a bare road name + pasted APN auto-generated a report for an unconfirmed parcel.
- Architectural fix — Property Resolution is now the MANDATORY GATE:
  - New `parcelIdentityEstablished(property, browserEvidence)` in `property-resolution-engine.ts`. Established ONLY when: (1) `parcelVerified` (named source), (2) Browser Agent read the parcel on LandPortal (APN + jurisdiction + real source URL), (3) ≥2 INDEPENDENT corroborating identity lanes (seeded operator input is not an evidence lane), or (4) a full house-numbered street address corroborated by a geocoder and resolved to a point in a known county/state. Exposed as `identityEstablished` + `identityBasis` on `PropertyResolution`.
  - `acquire/run` route now gates: if `!identityEstablished`, it creates the lead card + public-records research plan + a clear "parcel not yet confirmed" next action and returns `status: resolution_pending` (or the existing `research_card` path when not even matched). Property Inspection + Deal Card report run ONLY when identity is established, so the pipeline stays continuous for confirmed parcels with no second button.
  - Browser Agent improvement: `BrowserSearchKey.apnAlternates` threaded from `ParsedIntakeFields`; `runLandPortalAgentic` now tries each alternate APN format before owner (keeps investigating instead of one search). Verified live: it searched `094-020.08` then `094 02008 000`.
- Comparable sales + Market Pulse: already unified/mature (LandPortal browser comps merge with Zillow/Redfin/HomeHarvest/Realie into `landos_comp` with per-comp `sourceLabel`; sold drives the PPA band, actives kept separate and never mislabeled; comp/market query uses the verified `vid` county/state). The gate ensures they now consume a CONFIRMED parcel's geography. No rebuild needed — verified by tests, not reimplemented.
- Live verification (`:3141`, real acquire pipeline): Scott County example → research card, no downstream, alternate-APN search fired, 4 official county sources retrieved. Messy battery: county-only/APN-only → research_card; partial road-name address → NEW gate `resolution_pending` (matched 0.7 but not established). Visual QA screenshot `store/operator-qa-resolution/property-board-gate.png` shows gated leads in "Needs Parcel Verification" (unverified, correct Scott/TN geography, no parcel comps) while verified cards keep full intelligence.
- Engineering QA: server tsc clean; web build clean; resolution 14/14 (5 new), 60/60 browser/comp/market/acquisitions sweep, 86/86 deal-card/intake/inspection sweep. No new regressions.
- Files changed: `src/landos/property-resolution-engine.ts` (+ test), `src/landos/routes.ts`, `src/landos/browser-intelligence.ts`, `src/landos/landportal-browser.ts`.
- Remaining (KNOWN_LIMITATIONS): live authenticated LandPortal confirmation of the Scott County parcel (the continuous positive path) is Tyler's operator step; headless geocoders/LandPortal couldn't confirm that specific parcel. Not committed, not pushed.

### 2026-07-06 - LIVE Property Intelligence dashboard acceptance

- Rebuilt and restarted the local dashboard (`node dist/index.js`) so QA used current server/UI code, not stale `dist`.
- Started/reused the existing Browser Intelligence Chrome session via the dashboard browser routes. LandPortal auth check returned authenticated; no credentials were printed or committed.
- Found and fixed a live coordination gap before acceptance: the Deal Card button was labeled Property Intelligence but only regenerated the report. `POST /api/landos/deal-cards/:id/report/run` now first runs the existing Property Inspection workflow (`runPropertyInspection` with LandPortal + County browser services), persists that package, then regenerates the existing Deal Card report. No parallel report system.
- Live runs:
  - Unverified fresh lead: correctly stayed data-limited. Google visuals/report generated, but no fabricated parcel identity, APN, owner, comps, Land Score, or offer guidance.
  - Verified property card: PASS for Operator QA. The dashboard action produced LandPortal parcel page, wetlands, FEMA/flood, 3D terrain, comps-map screenshots; extracted visible comps; refreshed Google visuals; included Market Pulse, Strategy, Land Score; updated Property Board counts; and generated a downloadable PDF with screenshots.
- Visual artifacts saved locally in `store/operator-qa-property-intel/`:
  - `deal-5-after-run.png`
  - `property-board-after-run.png`
  - `deal-5-property-intelligence-report.pdf`
  - `deal-5-pdf-page-1.png`
  - `deal-5-pdf-last-page.png`
  - `deal-5-qa-summary.json`
- PDF QA: valid `%PDF-1.3`, 8 pages, 5 embedded images. Rendered page 1 shows the readable Property Intelligence Report and parcel facts; rendered last page shows a LandPortal comps-map screenshot.
- Engineering QA after the route coordination fix:
  - `npm run build:server` clean.
  - `npx vitest run src/landos/property-inspection.test.ts src/landos/landportal-agentic.test.ts src/landos/deal-card-report.test.ts --testTimeout 20000` passed 29/29.
- Business QA result: usable for pre-discovery due diligence. Still not offer-final because official source evidence, sold comps, title/access/utilities, and seller-confirmed constraints remain required before final pricing.
- No commit or push.

### 2026-07-06 - Property Intelligence Run completion pass

- Continued the existing Browser Agent / Property Inspection / Deal Card report workflow. No parallel system, no replacement report engine, no paid report calls.
- LandPortal/browser changes:
  - `BrowserDriver.captureLandPortalVisuals` now returns overlay shots and terrain/3D shot metadata in addition to parcel/comps map shots.
  - Live browser capture tries visible Base Maps/Overlays controls, captures Contour/Topo, Wetlands/NWI, FEMA/Flood, and 3D/Terrain when available, and returns only evidence actually captured.
  - `landportal-browser.ts` persists overlay/terrain assets and overlay observations into the existing Property Inspection package, then the existing Deal Card report surfaces them.
- Report/UI changes:
  - Added `/api/landos/deal-cards/:id/report/download` with PDF by default and markdown via `?format=md`. It uses the current persisted Deal Card report, Discovery Report, Market Pulse, Strategy, Land Score, and saved screenshots; no new report store.
  - Deal Card action renamed to Run/Re-run Property Intelligence, section renamed Property Intelligence Report, and Download Report appears when a report exists. Acquire button also says Run Property Intelligence.
- Verification:
  - Stopped lingering Vitest watch processes per Tyler's request.
  - `npx vitest run src/landos/property-inspection.test.ts` 2/2.
  - `npx vitest run src/landos/landportal-agentic.test.ts` 2/2.
  - `npx vitest run src/landos/browser-session.test.ts src/landos/browser-intelligence.test.ts src/landos/deal-card-report.test.ts --testTimeout 20000` effectively covered those suites; report suite 25/25, browser-session 17/17, browser-intelligence 15/15 in the prior split run.
  - `npm run build:server` clean; `npm run build:web` clean.
- Honest acceptance state: engineering/build QA passed, but full Operator QA still requires Tyler's live authenticated Chrome/LandPortal session and a real property run to visually confirm overlay screenshots, comps map extraction, Market Pulse, Strategy, Land Score, Google visuals, and the downloaded PDF.
- Docs updated: OPERATOR_QA, BUSINESS_QA, KNOWN_LIMITATIONS, HANDOVER. Not committed, not pushed.

### 2026-07-06 - Make Browser Training session produce a useful playbook

- 2nd acceptance: AI spoke, but ~20s latency, 0 steps, 0 fields, 380 frames/0 shots,
  empty playbook, word-shard transcript.
- Root truth: `getDisplayMedia` screen-share of Tyler's own tab = pixels, no DOM. No
  CDP → DOM-based steps/fields/shots were structurally always 0. Owned it + captured
  visually instead.
- Backend (`browser-training.ts`, `browser-training-live.ts`):
  - `makeTranscriptCoalescer` merges Gemini word-fragments into utterances (flush on
    turnComplete / speaker-switch / 1.4s pause); one speech event per utterance;
    client gets `transcript_partial` (live) + `transcript` final.
  - `recordScreenshot(sessionId, {dataBase64,label,reason})` saves to
    `store/training-shots/<id>` (0600, gitignored) + records a screenshot event.
  - `browser_events {connected:false, reason}` sent up-front (no silent 0).
  - Field binding from speech is label-only now (page:null) — stops probing the wrong
    LandOS Chrome; sends a "needs selector confirmation" note.
  - Narrated synthesis: no DOM events + transcript/shots → `captureMode:'visual_narrated'`,
    `needsSelectorConfirmation:true`, narrated steps (`narratedStepsFromSpeech`) + shot
    anchors + a `learningSummary`. Never emits an empty playbook.
- Frontend (`BrowserTraining.tsx`):
  - Frame throttling: send a frame only on material change (8×8 grayscale signature
    diff) or 6s heartbeat, q0.55 — was constant 1fps (the latency cause).
  - Client screenshots: start / voice-cue ("take screenshot"/"important") / page-change.
  - Status strip adds Screenshots-saved, Browser-events, Steps/Fields, Frames, Latency
    (operator-utterance→AI-audio). Coalesced transcript + live partial. Field note shown.
  - Review shows the visual/narrated `learningSummary` banner.
- Verified LIVE (`scripts/_live_ws_probe.mjs`): connecting→live→greeting_sent; 87 audio
  chunks; transcript FINALS=1 full sentence (coalesced, not shards); browser_events
  connected=false+reason; screenshot_saved count=1. New UI strings in the bundle.
- Tests: `browser-training-live` 6/6 (coalescing), `browser-training` 21/21 (narrated
  synthesis). Full suite 2585 passing; same 3 pre-existing unrelated failures. Rebuilt +
  restarted. Not committed.
- Next: CDP training mode (drive the instrumented Chrome, not a screen-share) for
  DOM-accurate steps/selectors + auto-extract. Real-latency tuning after Tyler's run.

### 2026-07-06 - Fix Browser Training live session (silent-session acceptance failure)

- Problem: Tyler ran a live session — LandOS never talked back, never showed it was
  listening. Silent run = fail.
- Root cause (diagnosed with `scripts/_live_probe.mjs`): the Live model id
  `gemini-2.5-flash-preview-native-audio-dialog` is NOT available on this Google key
  ("not found for API version v1beta / not supported for bidiGenerateContent"); the
  socket opened then closed immediately, so nothing was ever spoken. Only
  `gemini-2.5-flash-native-audio-preview-09-2025` works on this key. Also: the bridge
  never greeted, and the UI surfaced no subsystem state.
- Backend (`browser-training.ts`, `browser-training-live.ts`): switched
  `GEMINI_LIVE_MODEL` to the working id; added a spoken greeting ~500ms after connect;
  added `errText()` so connect-fail / model-error / close send the EXACT reason; widened
  `onclose` to carry the close reason.
- Frontend (`web/src/pages/BrowserTraining.tsx`): full operator-visible LiveView — the 15
  states incl. live audio METER (WebAudio analyser), live SCREEN PREVIEW (video element),
  Live-AI status + exact reason, local Web-Speech transcript fallback, AI "speaking…"
  indicator, and LOUD red/amber banners ("Microphone not connected.", "Live AI not
  connected: <reason>"). Fixed stale-closure bugs (paused via ref). Review screen now
  shows transcript + captured steps + screenshots/frames + learned fields + playbook +
  knowledge. Added greeting/reason unit tests (`browser-training-live.test.ts`, 4/4).
- Verified LIVE (localhost:3141, real Gemini): in-process bridge greeting "I can see your
  screen now. Please walk me through the workflow." + 65 audio chunks; through the real
  dashboard WebSocket: connecting→live→greeting_sent + 72 ai_audio chunks + transcript +
  usage delivered. Operator would hear LandOS within ~2s. Rebuilt + restarted (PID 235916).
- Tests: training 58/58; full suite 2583 passing; same 3 pre-existing unrelated failures.
- Remaining (KNOWN_LIMITATIONS): the mic-driven half (LandOS responding to Tyler's speech)
  needs a real browser to accept; the key rate-limits concurrent Live sessions. Not committed.
- Diagnostic scripts left in `scripts/` (ignored scratch): `_live_probe.mjs`,
  `_live_ws_probe.mjs`, `_live_bridge_probe.mjs`.

### 2026-07-05 - Runtime wiring fix: Browser Training usage 404 (stale build)

- Symptom: `/browser-training` loaded then showed `GET /api/landos/training/usage failed: 404`.
- Diagnosis: not a routing bug. `app.get('/api/landos/training/usage')` is in `routes.ts`
  and `registerLandosRoutes` is mounted in `dashboard.ts`. The LIVE service was
  `node dist\index.js` (PID 218872) built from a STALE `dist` (Jul 5 02:13, pre-sprint),
  so the compiled server had none of the training routes. Confirmed: running server
  404'd training/usage but 200'd the older browser-agent/status. No prod hot reload.
- Fix: `npm run build` (vite + tsc) recompiled `dist` (17:03) — `dist/landos/routes.js`
  now contains `training/usage` + all training modules. Killed the stale :3141 listener
  and started a fresh detached `node dist/index.js` (PID 45932) with start.bat-style log
  redirection.
- Verified LIVE (:3141): `/browser-training` 200; training usage/sessions/playbooks/
  knowledge all 200; usage returns a real body; WS bridge logged
  "Browser Training WebSocket active at /ws/landos/training". Exercised the session flow
  via API: create → nav event (ok) → paid "Buy Report" click STOPPED by guard
  (Approval Required, session paused) → `/end` synthesized a draft. 404 resolved.
- Remaining: the live voice/screen loop (getDisplayMedia + mic + Gemini Live WS) needs a
  real browser to accept — headless can't drive it. QA residue: one test session + a
  `qa_runtime_wiring_test` DRAFT playbook in the live DB (inert; no delete endpoint).
- No source changed (source was already correct); only `dist` rebuilt + service restarted.
  Not committed. Updated OPERATOR_QA / BUSINESS_QA / KNOWN_LIMITATIONS.

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

### 2026-07-06 - Smart Intake acceptance sprint

- Business objective: Smart Intake is the front door; every downstream
  department (Browser Agent, Property Intelligence, Discovery Report, Deal Card,
  Property Board, Market Pulse/Intelligence, Strategy, Offer, Acquisition)
  depends on it producing the correct property identity and structured deal
  info. Fixed the root cause instead of building around it.
- Root causes fixed (parsing was reading field LABELS as VALUES):
  - "Parcel ID" was parsed as State = ID (Idaho), dropping Tennessee, and city
    became "Parcel". New `maskFieldLabels()` (`src/landos/intake-normalize.ts`)
    blanks label phrases (Parcel/Owner/Tax/GIS/Record/Property ID …) before
    state/city extraction, in `duke-preflight.extractState` and
    `source-adapters.extractAreaSignals`. Numeric values stay intact.
  - Bare 2-letter state CODES now require UPPERCASE in the source (stops the
    words "in"/"or"/"me" → Indiana/Oregon/Maine); spelled-out names stay
    case-insensitive.
  - County: Title-Case tokens, horizontal-whitespace-only connectors (never
    grows across a newline: "Lithonia GA\nDeKalb County" → "DeKalb"), excludes
    "County Road/Rd/Line/Route/Highway", plus a labeled "County: X" form for CRM
    exports; redundant city==county echo suppressed.
  - US phone (3-3-4) is never parsed as an APN (seller texts / transcripts).
  - Owner strips a leading linking verb ("Owner is Betty" → "Betty").
- APN normalization: `normalizeApn` + `extractApnCandidates` generate county
  formats (dash/dot/space/concat), capture a parenthetical ALTERNATE APN, and
  drop contained fragments. Threaded as `apnVariants`/`apnAlternates` on
  `ParsedIntakeFields`; a bounded single alternate-APN retry was added to the
  `property-resolution-engine` verify lane (proven: recovers a parcel a county
  indexes under the alternate format — primary `094-020.08` fails, alt
  `094 02008 000` verifies, confidence 0.95).
- New intelligence layer: `src/landos/smart-intake.ts` `buildSmartIntake(text)`
  composes classify + APN normalization + `identityConfidence`
  (Verified/Likely/Possible/Insufficient + percent + reasons; caps at Likely
  pre-resolution) + `categorizeDealIntelligence` (13 buckets, per-item evidence
  status: Official Source / Seller Stated / Estimated / Needs Verification /
  Unknown — never mixes verified facts with seller claims). Exposed additively
  on `POST /api/landos/intake/classify` as `smartIntake`; the resolve/acquire
  pipeline is unchanged in shape and auto-continues into Property Intelligence
  when confidence clears the threshold.
- QA: new `smart-intake.test.ts` 18/18 pass; typecheck clean (0 errors); full
  suite green except 13 PRE-EXISTING failures in unrelated subsystems
  (exfiltration-guard, skill-registry, acquire-ui SRC read, property-card
  DB-ordering — none import intake modules). Fixed the one regression I
  introduced (duke-preflight county over-grab). Operator QA: the acceptance
  input now yields state=TN, county=Scott, normalized APNs + alternate, Likely
  83%, ready → Property Intelligence. Business QA: raw parcel paste, seller text,
  CRM export, and call transcript all organize/label/route without manual
  cleanup.
- Live provider/browser verification stays gated (no paid calls made).
- Files (in-repo): new `intake-normalize.ts`, `smart-intake.ts`,
  `smart-intake.test.ts`; modified `duke-preflight.ts`, `source-adapters.ts`,
  `intake-router.ts`, `property-resolution-engine.ts`, `routes.ts`.
- Not committed, not pushed.
