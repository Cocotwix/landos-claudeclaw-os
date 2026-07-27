# Phase 4 Items 15-17 — agent identity, mission acceptance, provider routing

Status: COMPLETE. Committed locally on top of `58673e0`, NOT pushed. Item 14 remains
complete and published at `fde34e1`. Phase 5 has not started.

This record documents the design as implemented. It does not change the approved
roadmap.

This is the detail record. `.landos/CHECKPOINT.md` carries only the compact pointer.

## Item 15 — identity, group, role, relationship, handback routing

A mission child spec now declares:

| field | meaning |
| --- | --- |
| `group` | mission group; several children may share one |
| `assignedRole` | the functional role the child serves in the parent's result |
| `agentKey` | `AGENT_ROSTER` key of the owning specialist |
| `contributionSlot` | where the child's handback belongs on the parent |

The specialist display name, roster group, roster role and wired `implAgentId`
resolve from `agent-roster.ts` rather than being re-typed, so one roster edit moves
every mission. An unassigned lane reports `Unassigned specialist` — no agent is ever
invented, because a fabricated owner makes a mission look accountable when nothing
owns the lane.

Identity is written WITH the child row in `createMission`, so the operator sees who
owns a lane and where its result belongs *before* the lane runs, not only after it
settles.

`planMissionWaves` refuses two new definition bugs, alongside the existing unknown
dependency and cycle checks:

- an `agentKey` that does not exist in the roster;
- two children claiming the same `contributionSlot` (one handback would silently
  overwrite the other).

`MissionJoin` gained `contributionsBySlot`, `routing` (one entry per child, routed or
not, with its slot, group, agent and acceptance state), `accepted`, `incomplete` and
`allRequiredAccepted`. `contributions` keyed by child key is unchanged, so the Item 14
surface still works.

### Store

Additive columns on `landos_mission_child`, applied in place with
`ALTER TABLE ADD COLUMN` so existing mission rows keep their recorded results:
`group_key`, `assigned_role`, `agent_key`, `agent_name`, `agent_group`, `agent_role`,
`impl_agent_id`, `contribution_slot`, `acceptance_json`, `provider_json`.
(`group` is a SQL keyword, hence `group_key`.)

## Item 16 — mission acceptance

`mission-acceptance.ts` is reusable and pure: no database, no clock, no I/O. The
executor reports what it believes happened; the declared contract decides what the
mission records. The runner settles a child on the verdict, never on process exit.

Six states stay deliberately distinct, because collapsing any two hides a different
kind of problem:

| state | meaning | contributes |
| --- | --- | --- |
| `accepted` | every required and expected term met | yes |
| `incomplete` | required met, an expected term missing | yes, never as a full result |
| `blocked` | a precise external gap stated by the lane | no |
| `rejected` | ran to completion, result does not meet the requirement — including a missing or unusable handback | no |
| `failed` | execution broke (throw, timeout) | no |
| `not_evaluated` | no contract declared, or the lane never delivered | no |

`rejected` is a NEW terminal child status. It is what process exit alone cannot catch.

Ordering is deliberate: a throw is a failure and is never re-read as an unacceptable
result; a stated block is a blocker and is never re-read as a failure; only then is
the handback judged. A self-reported `partial` can never be promoted to `accepted`.

A contract declares `requiredFields` (absence rejects), `expectedFields` (absence is
incomplete) and arbitrary pure `checks`. Reusable checks provided:
`scopeIntegrityCheck` (a handback naming a scope row must name THIS one — the
acceptance-level guard against cross-Deal contamination, and required because the
wrong parcel's facts are worse than none), `fieldEqualsCheck`, `anyFieldPresentCheck`.
A check that throws becomes a FAILED required check, never a silent pass.

An empty string is absent (a blank field is a missing fact wearing the shape of an
answer); an empty array is present (a lane that honestly found zero rows delivered a
real result).

Parent classification: a required `rejected` or `failed` child makes the parent
`failed`, but the outcome sentence names the two groups separately — "failed to
execute" versus "returned a result that did NOT meet their acceptance requirement" —
because they call for different operator action. Every outcome states acceptance
counts, so `joined` can never be misread as "everything was accepted".

### Contracts on the representative fan-out

- `parcel_identity` — required: `subjectCardId`, `identityState`,
  `verificationStatus`, scope integrity, and the parcel named by address or APN.
  Expected: `county`, `state`, and `identityState === 'confirmed'` (so a provisional
  lead is incomplete, never an accepted identity).
- `deal_context` — required: `propertyCount`, scope integrity. Expected: retained
  evidence or comps exist, so a thin card is incomplete.
- `market_coverage` — required: `county`, `state`, and a stated boolean coverage
  answer. The unseeded case is already the lane's own `blocked`, so no expected check
  duplicates it.

## Item 17 — provider engine gap analysis and selective completion

### Upstream comparison

`upstream/main` (`0774082`, the `earlyaidopters/claudeclaw-os` remote) is already an
ancestor of HEAD: `git merge-base --is-ancestor upstream/main HEAD` passes and
`git log HEAD..upstream/main` is empty. NO later upstream provider fix was missing.
(The remote itself now 404s, so the cached ref is the comparison baseline.)

The real gap was not a missing fix. It was that the mission graph had no way to reach
routing machinery the repository already had, and that two provider *surfaces* were
being conflated.

### Already present, reused verbatim

`capability-router.ts` (which model the capability needs imply), `provider-registry.ts`
(which provider can serve it), `model-execution.ts` (Claude / OpenAI / OpenRouter /
Gemini / Ollama / LM Studio / vLLM clients), `router-runtime-config.ts` (persisted
setting over env), `model-override.ts`, `router-telemetry.ts`, and
`model-router-service.ts` (safe mode, override handling, deterministic fallback,
telemetry). None of this was redesigned.

### Added — the bridge only

`mission-provider-routing.ts`:

- `resolveMissionProviderAssignment` — resolves a persisted assignment per child.
  Safe mode is mirrored exactly: with live routing off, availability is Claude-only,
  so enabling the bridge cannot silently move work onto another provider. An
  unavailable operator pin is reported, never substituted.
- `deterministicAssignment` — a lane that is LandOS code reading accepted data
  carries "no provider is engaged, no credit is spent" rather than naming a provider
  it never uses.
- `runRoutedMissionChild` — executes a model-routed lane through the existing
  `executeRoutedTask`. Failure meaning is preserved: an unavailable model is a
  precise BLOCKER (a configuration gap), a real error THROWS so the runner classifies
  it through the same failure-classification path as every other lane.
- `MISSION_PROVIDER_CATALOG` + `describeMissionProviderCatalog` — reconciles the two
  surfaces honestly.

Heavy modules (the Claude SDK via `model-router-service`) are imported lazily, so a
mission whose children are all deterministic never loads them.

### The two provider surfaces

- `completion` — a LandOS `ModelClient` exists, so a mission child can route a model
  call there now: claude, openai, openrouter, google, ollama, lmstudio, vllm, hermes.
- `agent_session` — the upstream provider engine (`src/provider.ts`) can drive a full
  agent session (SDK or ACP), but LandOS has no completion client: codex, opencode.
  These are reported as NOT mission-routable rather than being claimed. A CLI on PATH
  says nothing about whether a mission can route to it, so the two are computed
  independently and neither is inferred from the other.

### Hermes

Optional by construction. `HERMES_URL` (or the `landos.router.hermes_url` dashboard
setting) is empty by default, which means the provider is simply not installed and no
routing decision changes. When set, it is registered as another OpenAI-compatible
local endpoint serving the already-registered local open-model ids — so no new model
id is invented and `MODEL_CAPABILITIES` is untouched. Native LandOS missions run
fully without it; this was verified live with Hermes absent.

Additive edits only: one `ExecutionEnvironmentKind` + catalog entry, one optional
`buildProviderRegistry` client, one descriptor, one config constant, one resolver.

### New route

`GET /api/landos/model-router/mission-providers` — per provider, whether a mission
child can route to it now and whether the upstream engine can drive an agent session
on it, plus Hermes' optional status. Booleans only; no secret values.

## Regression fixed during this sprint

A join STORED before these fields existed has no `routing` / `accepted` /
`incomplete` / `contributionsBySlot`. Returning it raw handed callers a `MissionJoin`
whose declared arrays were `undefined`, which threw during render and blanked the
mission panel for every pre-existing mission (observed live on Deals 47 and 52).

Root cause fixed at the read path: `normalizeStoredMissionJoin` rebuilds the missing
routing and slot map from the definition and the stored children, so a pre-existing
mission still shows where each handback belongs. Acceptance is NEVER reconstructed —
a child that was never evaluated stays `not_evaluated` and is never counted as
accepted. The panel also defends itself, and unknown enum values fall back to
"not evaluated" instead of indexing a lookup blindly.

A related first-order defect was fixed the same way: a legacy row's slot fell back to
the child key, which then masqueraded as a stored value and masked the DECLARED slot.
Stored identity now stays empty when a column was never written, so the declared
identity wins.

Both are covered by permanent regression tests in `mission-graph-identity.test.ts`.

## Acceptance evidence

Full results in `.landos/verification-results.json` under
`missionGraphIdentityAcceptance`. Summary: fresh lead created through New Lead intake
for 3129 Old Walland Highway, Walland, TN 37886, Blount County (Deal 53; Blount was
absent from LandOS beforehand). Mission #1 JOINED, 3/3 settled, 1 accepted,
2 incomplete, 3/3 handbacks routed, all lanes deterministic. Identical through page
refresh and a full managed restart. No cross-Deal contamination across Deals 47, 52
and 53. Deal 52 still JOINED and Deal 47 still JOINED WITH GAPS.
