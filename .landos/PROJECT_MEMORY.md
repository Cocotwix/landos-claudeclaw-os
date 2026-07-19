# LandOS Project Memory

This file stores durable lessons, solved problems, and gotchas.

## Durable Lessons

- Do not let Duke become the LandOS brain.
- Do not build one-agent-does-everything patterns.
- Do not use propertyid + FIPS as the main happy path.
- Do not block area market context when parcel verification fails.
- Do not show developer trace as the main operator UI.
- Do not rely on one source as truth.
- Keep coding sprints focused and preserve handoff.
- Smart Intake must never read a field LABEL as a VALUE. "Parcel ID / Owner ID /
  Tax ID / GIS ID / Record ID" must never resolve to a state (ID → Idaho), and a
  phone number must never resolve to an APN. Parse the label, keep the value.

## Gotchas

- Area-level context is useful even when parcel verification is not finished.
- A single source failure should not erase other honest context.
- Product memory must preserve the next action, not just the last command.
- Most LandOS machinery already exists: deal cards persist to the local SQLite
  store (gitignored), the orchestrator is planLandosIntake(), and there are
  already two registries. Check before building; reuse and harden, do not
  rebuild.
- .gitignore already keeps property data/media/reports out of the repo
  (data/, deals/, transcripts/, training/, *.pdf, *.csv, *.xlsx, *.mp3, ...).
  Storage policy formalizes this; it does not need new ignore rules.
- The LandOS structure spine lives in src/landos/landos-structure.ts and
  references existing department-registry IDs via registryRef.
- Cross-session continuity must be repo-native, LandOS-native, and
  vendor-neutral. Use `LANDOS_CURRENT_STATE.md`, `.landos/HANDOVER.md`,
  `.landos/OPERATOR_QA.md`, `.landos/BUSINESS_QA.md`,
  `.landos/PROJECT_MEMORY.md`, `.landos/CHAT_CONTEXT.md`, and
  `/continue-landos` instead of asking Tyler to restate current status.
- Operator acceptance is browser-visible, not code-visible. A test pass or
  persisted DB row is not enough if Tyler cannot see the output in the real
  dashboard.
- Reference UI artifacts belong in `docs/reference-ui/` only when they are
  redacted and do not contain secrets, real APNs, seller details, private
  addresses, or property work product.
- Default governance is autonomy. Do not create approval-drip, micro-prompts, or
  premature stopping. Stop only for new secrets, `.env` or credential changes, API keys/passwords, paid
  APIs, external accounts, money, destructive deletes, `git push`, or
  deployments.
- Every implementation sprint must end with engineering QA, Operator QA,
  Business QA, and durable memory updates. Tests alone are not done.
- Shared parsers (`duke-preflight`, `source-adapters`) feed the whole intake
  pipeline via `classifySmartIntake` → `resolveProperty`. Fixes there ripple
  everywhere, so re-run the FULL suite: a state/county regex tweak can regress
  `duke-preflight`/`property-card` tests. Keep the deterministic parse as a floor
  and validator (it is the guardrail if an AI reasoning layer is added later).
- Intake normalization primitives live in `src/landos/intake-normalize.ts`
  (`maskFieldLabels`, `normalizeApn`, `extractApnCandidates`); the front-door
  intelligence (confidence engine + deal-intelligence categorization) lives in
  `src/landos/smart-intake.ts` (`buildSmartIntake`). Reuse these, do not
  re-implement parsing in a new place.
