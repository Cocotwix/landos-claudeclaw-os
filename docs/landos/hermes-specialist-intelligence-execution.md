# Persistent Hermes Specialists as Production Intelligence Executors (Slice 6)

Established 2026-08-22. Production specialist intelligence execution moved onto
the four persistent Hermes profiles from Slice 5. The four products, their
contracts, persistence, fingerprints, deterministic pre-contact Seller, and the
bounded capability-reconciliation seam are unchanged; only the reasoning
EXECUTOR underneath them changed. War Room wiring is deliberately untouched
(Slice 7).

## Architecture

- `src/landos/specialist-intelligence-executor.ts` is the one LandOS-owned
  adapter. It implements the same `AcquisitionAnalyst` seam the stack already
  consumed, so the orchestrator, parser, validators, store and UI did not
  change shape.
- Layer → profile: property → `landos-property`, market → `landos-market`,
  seller → `landos-seller` (only when seller evidence is established),
  deal → `landos-deal-brain` (the chair, strictly after the specialists,
  synthesizing their fresh structured products).
- The stack passes BOTH the legacy combined prompt and a per-layer
  `specialistPlan` on the same `AnalystRunInput`; each executor uses its own
  and ignores the other. That one input is the whole rollback story.
- Independent stale layers run in PARALLEL (`Promise.allSettled`); Deal Brain
  runs after them. Fairview live proof: property 64s and market 90s
  overlapping, deal 115s, ~3m10s wall clock — inside the five-minute goal.

## Transport

Profile-scoped Hermes CLI **one-shot** (`--profile <bot> --provider … -m …
-t clarify --oneshot <prompt>`), spawned through the same argv-temp-file
bootstrap the production analyst uses (Windows ~32K argv cap). No
`API_SERVER_KEY` was provisioned; the Hermes gateway can replace this
transport behind the same adapter later without touching intelligence logic.

One-shot in v0.20.5 records an isolated per-run session in the profile's
`state.db` (auto-titled from the prompt); no session thread is ever reused
across runs, so Deal A context structurally cannot leak into Deal B. The
canonical `Bot Chat` sessions from Slice 5 are untouched and remain reserved
for the future War Room.

## Anti-contamination doctrine

Every specialist prompt carries an authoritative `LANDOS CURRENT DEAL CONTEXT`
envelope (deal card id, subject identity, canonical acreage, phase, generated
timestamp, dossier fingerprint) stating: profile memory may shape HOW the bot
reasons, never WHAT is currently true; where memory disagrees with the
context, the context wins; deal facts belong to LandOS, never to the profile.
Bounded dossier views per layer (aligned with each layer's fingerprint
inputs): Property never sees the comp universe or negotiation history (seller
PROPERTY statements travel as labeled seller-reported evidence); Market sees
identity/acreage/valuation/comps/market/land-use; Seller sees the seller
evidence record plus subject identity; Deal Brain consumes the specialist
PRODUCTS plus deterministic economics, not the raw dossiers.

Production runs write nothing into durable bot memory: profiles run
`clarify`-only with no skills, and SOUL.md / memories hashes were
byte-identical across the live runs and a managed restart.

## Rollback

`landos.acquisition_intelligence.executor` in `dashboard_settings`
(`specialists` default, `analyst` = the pre-Slice-6 single-profile executor).
Operate it with `npm run landos:intelligence:executor -- status|use
specialists|use analyst`; effective next run, no restart, no source edit. The
legacy analyst code path is retained intact.

## Provenance

Each persisted product's `runtime` names the producing profile
(`agentProfile`), provider/model, `transport: hermes-cli-oneshot`, duration,
and (runs after 2026-08-22) the governance-pinned `runtimeVersion`. The
existing "Read by" affordance on the Deal read now honestly shows
`landos-deal-brain`; specialist card footers are unchanged.

## Verified

Focused suites: `specialist-intelligence-executor.test.ts` (routing,
parallelism, chair ordering, envelope, bounding, cross-deal isolation with
persistent identity, malformed-output refusal, least-privilege argv, rollback)
plus stack tests for the plan seam, per-layer runtimes and
failure-retains-last-good; 605 related tests green. Live browser acceptance on
Deal 89: current 51.11-ac reads with the 75.91→51.11 split explained, $3.084M
raw-land FMV distinguished from development potential (no $4.5M resurrection),
Seller honestly deterministic pre-contact (0 model calls, no new profile
session), hard refresh GET-only with a clean console.

## Deferred / notes

- Products produced in the first live run carry `transport` but not
  `runtimeVersion` (field-name fix landed just after; next runs carry it).
- Slice 7 maps the same four profiles onto War Room seats; no duplicate
  personas.
- Test residue: harmless extra sessions in `landos-property` from the Slice 5/6
  smoke checks remain in `state.db` rather than deleting DB rows.
