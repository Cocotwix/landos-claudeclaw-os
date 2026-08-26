# LandOS — Hermes Bot Mode + Intelligence + War Room Integration Audit

Read-only audit, 2026-08-21. Accepted main at audit time: `5a1e4b44059700ab8475d0f3ef1a616f463bb144`.
Runtime verified RUNNING/healthy on port 3141 during the audit. No code, config, runtime, or Hermes
changes were made. War Room visually inspected read-only at `http://localhost:3141/warroom`
(picker and Text pane render; text-meeting list is empty — the surface works and has never been used).

**Verdict in one sentence:** LandOS already owns the hard 80% — a contracted deterministic capability
layer, a working four-product intelligence stack with a Deal Brain chat, a bounded deal dossier, and a
production-grade multi-agent War Room turn engine — so the shortest path is to deal-scope the existing
War Room, ground vision, feed the starved seller layer, and move the four specialists onto persistent
Hermes profiles driven through the Hermes API server; nothing new needs to be invented.

---

## 1. What exists today

### 1.1 The intelligence stack (Property / Market / Seller / Deal) — one engine, one pass

- Orchestrator: `src/landos/intelligence-stack.ts` — `runIntelligenceStack()` (:335) produces all
  four products in **one coordinated model pass** over one shared evidence package.
- Reasoning executor ("Sol"): `src/landos/acquisition-analyst.ts` — Hermes CLI **one-shot subprocess**,
  profile `landos-acquisition-analyst`, provider `openai-codex`, model `gpt-5.6-sol` (defaults :59-60,
  overridable via `dashboard_settings`). Toolset is `clarify` only — the analyst structurally cannot
  browse, research, or write files.
- Evidence package: `src/landos/acquisition-intelligence-dossier.ts` — `buildAcquisitionDossier()`,
  a pure, bounded JSON "property file" (MAX_RULES=18, MAX_LIST=10, MAX_VISUALS=12) with explicit
  `coverage`, `truncation[]`, `conflicts`, `openQuestions`, `missingInformation`.
- Persistence: `src/landos/derived-intelligence-store.ts` → `landos_deal_intelligence_snapshot` in
  `store/landos.db`; one `current` row per snapshot type, priors superseded, never overwritten.
- Trigger: `POST /api/landos/deal-cards/:id/intelligence/run` (fire-and-poll, `routes.ts:~10161`) with
  a readiness preflight that auto-backfills only red ∧ machine-owned ∧ intelligence-critical gaps.
- **Deal Brain chat exists and works**: `GET/POST /api/landos/deal-cards/:id/deal-brain`
  (`routes.ts:~10205-10265`) → `landos_deal_brain_guidance`; operator guidance is folded into the
  deal-layer fingerprint so adding guidance automatically stales and re-runs the deal layer. Guidance
  is an input, never a fact; the chat cannot write property records.
- Empirically proven on exactly one deal: 13 snapshot rows, all on deal card 89 (Fairview), change
  reasons like "Property Intelligence read by landos-acquisition-analyst on gpt-5.6-sol", ~152-155s
  per layer.

Per-product status:

| Product | Generated | Persisted | Rendered | Verdict |
|---|---|---|---|---|
| Property (deterministic research pipeline) | yes | yes | yes | Working |
| Property (Sol reasoning product) | yes | yes | **score only** | Working, output orphaned |
| Market (Sol reasoning product: liquidityRead, areaStory, buyerPool, exitImplications…) | yes | yes | **score only** | Working, 100% invisible |
| Market Matrix / comps valuation (deterministic) | yes | yes | yes | Working (separate product) |
| Seller (pre-contact deterministic) | yes | yes | yes | Working, honest ("Unknown — pre-contact") |
| Seller (established, model path) | wired | — | yes | **Starved — never actually run** |
| Deal Intelligence + Deal Brain chat | yes | yes | yes | Working |
| Research Readiness (19-item deterministic preflight) | yes | yes | yes | Working |

The two structural gaps inside this stack:

1. **Orphaned reads.** `AcquisitionWorkspaceV2.tsx` reads only `products.deal` and `products.seller`
   (:352, :362). The Property and Market products' prose (strengths, constraints, liquidity read,
   area story, buyer pool, exit implications) is generated, paid for, persisted — and never rendered.
2. **Starved seller layer.** `dossier.seller` is only `{present, name, askingPrice}`
   (`acquisition-intelligence-dossier.ts:205-209`). The comm log, discovery extractions,
   seller-stated facts, and transcripts exist in five places (`landos_acquisition` JSON blobs,
   `landos_card_activity` kind `seller_stated_fact`, `landos_opportunity_transcript`,
   `landos_note`, contacts tables) but are **never assembled into the dossier**. Live DB:
   `landos_acquisition` and `landos_opportunity_transcript` are both empty — the seller side has
   never been populated in practice. No LLM analyzes a call or note anywhere in the system.

### 1.2 Vision

Two stacks with opposite image handling:

- **Gemini genuinely sees pixels.** `src/gemini.ts:62-91` `generateVisionContent()` builds real
  `inlineData` base64 parts (model `gemini-3-flash-preview`, `BROWSER_VISION_MODEL` override).
  Three live call sites: `browser-vision.ts:175` (visual intelligence),
  `deal-operator-analysis.ts:2174` (whole-card multimodal analyst, wired at `routes.ts:8675-8691`),
  `smart-intake-image.ts:185`. A persisted structured **`VisualObservation`** already exists
  (`browser-vision.ts:55-61`: category ∈ access, road_frontage, landlocked_risk, easement, clearing,
  wetlands_water, terrain_slope, neighboring_development, improvements, other; signal; confidence;
  sourceImage), stored as `landos_card_activity` kind `vision_analysis`, with high confidence
  deliberately downgraded to medium — imagery is a signal, never a verified fact.
- **The Sol visual pass is ungrounded.** `acquisition-analyst.ts:118-123` injects an image
  **file path as prompt text** and assumes "naming the file path is what ATTACHES the image."
  Nothing in the repo encodes bytes on that path; the prompt travels as a CLI string argument to a
  `clarify`-only toolset with no file-read tool. Unless the Hermes runtime independently auto-attaches
  (unverified, no test), Sol receives the literal string `store/visuals/landportal_5_....png` and
  nothing else — up to 3 images × 10 min timeouts spent on possibly zero pixels, with the resulting
  `visualObservations` merged into the operator-visible read. The 60-char plausibility filter
  suppresses only trivially fake output, not confident hallucination.
- Imagery storage: `store/visuals/` (1,134 PNGs, content-addressed names), `landos_landportal_capture`
  is the one properly-columned image table; most image metadata is JSON-in-`ref` on
  `landos_card_activity`. Served only via proxy endpoints; parcel-association eligibility gating
  (`visual-eligibility.ts`) already excludes unproven captures from analysis.
- Anthropic/Claude path sends no pixels anywhere (`model-router-service.ts:46-47` flattens to string).
- Hermes-side: only the `landos-acquisition-analyst` profile has an `auxiliary.vision` block
  (ollama `gemma4:12b`); the `landos` worker and five governed profiles have the vision toolset but
  no auxiliary model configured.

### 1.3 War Room

- Frontend: `web/src/pages/WarRoom.tsx` at route `/warroom` (sidebar, `g w`); the actual chat UI is
  legacy-served HTML `src/warroom-text-html.ts` (3,248 lines) reached via
  `/warroom/text?token=…&meetingId=wr_…&chatId=…`.
- Backend (text path): `warroom-text-orchestrator.ts` (2,051 lines, turn engine),
  `warroom-text-router.ts` (Haiku speaker classifier + intervention gate),
  `warroom-text-events.ts` (SSE MeetingChannel with seq replay), `warroom-tool-policy.ts`
  (default-deny tool boundary), full API under `/api/warroom/*` (`dashboard.ts:1072-1930`).
- Agents: roster is **directory-driven, not hardcoded** — `getRoster()` enumerates the 11 LandOS
  department agents (`landos-agents/`) plus `main` and 4 legacy agents. All Anthropic via
  `@anthropic-ai/claude-agent-sdk` `query()` on the subscription OAuth path; per-agent model from
  `agent.yaml` (sonnet-4-6, forge on opus-4-6); each agent's identity is its own CLAUDE.md loaded
  via `cwd`.
- Turn mechanics: serialized per meeting; speaker-selection ladder (@mentions → pin → sticky
  addressee → router), primary + up to 2 gated interveners, per-agent time/turn/tool budgets, and a
  working **`/discuss <topic>` council primitive** (`pickSlashRoster()`, cap 8 speakers, 270s budget,
  round-robin over-cap cycling, parallel SDK prewarm).
- Persistence: real — `warroom_meetings` + `warroom_transcript` with SSE replay, memory ingestion,
  token/audit logging. **But in `store/claudeclaw.db`, not `store/landos.db`.**
- Voice path (Python/Pipecat + Gemini Live) is off by default (`WARROOM_ENABLED=false`) and its
  hardcoded personas cover only the old agents. Ignore it for this effort.

**Verdict: functional, tested, production-grade infrastructure — not a demo.** What it is not:
deal-aware. `POST /api/warroom/text/new` takes only `{chatId}`; the meeting row has no
`deal_card_id`; there is zero read of deal cards/parcels/comps anywhere in the orchestrator; and no
Deal Card component has a War Room launch point. `landos-structure.ts:335-385` codifies it as a
shared surface with "do not rebuild/redesign/rename" rules; `WAR_ROOM_ROUTING_CONTRACT` routing is
declared, not implemented.

### 1.4 Hermes integration (as installed)

- Install: `%LOCALAPPDATA%\hermes\hermes-agent`, git clone of
  `github.com/NousResearch/hermes-agent`, **v0.20.0 (2026.8.3)**, commit `715d26cd` (2026-08-12),
  Python venv, CLI on PATH.
- 7 provisioned profiles: `landos` (LandPortal worker: subject/comps/visuals work units, CDP :9224),
  `landos-acquisition-analyst` (Sol), and 5 governed profiles (research / visual-qa / debug /
  knowledge / automation) with role-scoped toolsets and an `approvals.deny` safety net.
- Invocation is strictly `--oneshot` (`hermes-landportal-auto.ts:250-281`); a second transport
  reuses the Hermes venv python for keyless `ddgs` search (`hermes-free-search.ts`).
- **No Bot Mode usage anywhere in the lane**: no persistent bots, no bot chats, no group sessions;
  `profiles/landos/sessions/` has 2 request dumps. Memory exists per profile
  (`memories/MEMORY.md`/`USER.md`, `state.db`) but the analyst is invoked statelessly.
- Governance drift, already durable: skill-source manifest pins Hermes `0.19.1` /
  commit `3f497e2b` while `0.20.0` / `715d26cd` is installed; per the manifest's own update policy
  this **blocks audit** until skills are re-reviewed and repinned. `landos:hermes:profile:check` and
  `hermes:governed:check` both recorded exiting 1. `docs/landos/governed-hermes-profiles.md` still
  says 0.19.1 (stale). Also two on-their-face contradictions: visual-qa's contract forbids the
  shared operator CDP session but its provisioned config sets `cdp_url: 127.0.0.1:9224`; `.hermes.md`
  forbids MCP servers while governed profile.json files declare `landos-read`/`landos-acceptance`
  (reconciled only by the `--activate-mcp` gate).
- `.omp/` + `scripts/omp/` are **unrelated to Hermes**: OMP 17.2.15 session-stop guard for sprints.
- `.hermes.md` rule worth keeping in mind: the Hermes lane must not use the Anthropic provider.

### 1.5 Capability layer and orchestration

- **11 contracted runtime capabilities** in `src/landos/capability-registry.ts:72-114`:
  `property-resolution` (identity gate), `assessor-tax`, `landportal-research`,
  `landportal-property-characteristics`, `landportal-visual-capture`, `landportal-comp-search`,
  `comps-valuation`, `zoning-subdivision`, `property-development-history`,
  `utility-service-screen`, `acquisition-intelligence`.
- Governance envelope: `capability-contract.ts` — caller typing, subject resolution states,
  SHA-256 idempotency keys, reuse mode, durable FAILED/ERROR results; ledger tables
  `landos_capability_invocation` + `landos_capability_evidence` (source_label/url/type/retrieved_at
  provenance) written transactionally in `capability-store.ts:334-419`; file-lock concurrency.
- **The question→capability map already exists**: `research-readiness.ts` (712 lines, pure) — 19
  items, each with a question, an owning capability, machine-backfill eligibility, freshness; and
  `runResearchReadinessBackfill()` invokes each owning capability of a red machine item exactly once,
  hard-bounded.
- Bounded-research machinery already exists: `gis-escalation.ts` (staged escalation with request /
  wall-clock / interaction / alternate-source budgets and first-class stop reasons), per-lane
  maxQueries/maxPages/deadlineMs bounds on land-use, zoning, ecode360, comp retrieval.
- **Agent-requestable today: partially.** The governed MCP bridge
  (`mcp/landos/landos_mcp/policy.py`, `src/landos/governance/mcp-bridge.ts:43-64`) gives an agent
  narrow reads (`get_property_context`, `get_accepted_evidence`, …) and governed evidence write-back
  (`save_verified_property_fact/comp/visual_artifact`), fail-closed with deny filters. It
  deliberately excludes capability **invocation**. `GET /api/landos/capabilities` publishes a
  catalog but no parameter schema. No model anywhere chooses work.
- **Deal context pack: the pieces exist, unassembled as a named thing.** The development Control
  Context Pack (`scripts/control/context-pack.mjs`) is coding-governance-only and cannot produce a
  deal context, but its pattern (canonical JSON + hash + delivery ledger) is right. The real seeds:
  `AcquisitionDossier` (already is an agent context pack), the Research Readiness manifest
  (read-only "what's unresolved and who owns it"), `businessSpine`/`whatBlocksThisDeal`
  (`business-object-spine.ts:968,1056`), and per-agent RAG (`rag-knowledge.ts:383-447`,
  `GET /deal-cards/:id/rag-context/:agent`).

---

## 2. Working vs placeholder / disconnected

**Working:** deterministic property research pipeline; the four-product intelligence stack run;
Deal Brain chat with guidance-driven re-runs; research readiness + bounded backfill; comps/valuation
and Market Matrix; Gemini vision (three real call sites, persisted VisualObservations); the entire
capability contract/ledger layer; the War Room text path end-to-end (chat-scoped); the Hermes
LandPortal worker lane; keyless ddgs search.

**Working but orphaned/starved:** Property and Market Sol products (persisted, unrendered);
Seller established path (wired, never fed, never run); Deal Brain output rendered but the chat has
been used once.

**Broken assumption:** the Sol per-image visual pass (filename-as-attachment premise, unverified,
merged into operator-visible output).

**Placeholder / dead / disconnected:** `executive-orchestrator.ts` intent router (zero callers);
V1 `acquisition-intelligence-capability` run endpoint (still writes the same snapshot type as V2 —
latent two-writer conflict); `model-providers.ts` registry (inert relative to the stack; Sol not in
it); War Room voice personas (stale agent names); `WAR_ROOM_ROUTING_CONTRACT` (declaration only);
no cost accounting on the Sol path (`landos_model_call` never populated by it); Hermes governance
checks exiting 1 with a stale skill-manifest pin.

---

## 3. Current Hermes Bot Mode capabilities (official, verified 2026-08-21)

Source: `github.com/NousResearch/hermes-agent` releases + `hermes-agent.nousresearch.com` docs,
all fetched 2026-08-21. **Current release v0.20.5 (2026-08-19).** Installed locally: v0.20.0
(2026-08-03) — three patch releases and ~520 PRs behind, and critically **before Bot Mode entered
core**: Bot Mode was a separate desktop plugin repo, merged into core as a default-on plugin in
v0.20.3 (2026-08-16, "teammate protocol"); the standalone repo was archived 2026-08-17. v0.20.4
added the SESSIONS|BOTS sidebar; v0.20.5 added group-room threads, file/PDF attachments, keyless
web tier.

What Bot Mode / current Hermes offers that matters to LandOS:

- **Persistent named Bots = full Hermes profiles** (isolated config, SOUL.md, memory, skills,
  credentials, chat history under `profiles/<name>/`), created via CLI `hermes profile create`;
  a canonical pinned "Bot Chat" per bot survives sessions (`/new` becomes `/compact` there).
- **Per-bot model/provider pin** — different bots on different models side by side.
- **Bot-to-bot messaging and group chats** (2-6 bots), **bounded**: one user message triggers up to
  3 serial rounds, max 10 messages; bots may pass; @mention escalation. Group mechanics are
  desktop/gateway-centric. Known open defect: b2b reply silently drops when the receiver has no Bot
  Chat session (#88059).
- **Skills**: SKILL.md format, agent-authored via `skill_manage`, `/learn`, and — key for anti-drift —
  a built-in staging mechanism: with `skills.write_approval: true`, self-improvement review **stages
  suggested skill changes under `~/.hermes/pending/skills/`** for human approval; hash-manifest
  protection against upstream overwrite; mandatory security scanning.
- **Memory**: per-profile MEMORY.md/USER.md injected at session start, auto-consolidation, FTS5
  session search.
- **Vision**: the API server accepts OpenAI-style `image_url` content parts including
  `data:image/...;base64` — local images can be sent programmatically. File-path attachment via CLI
  is NOT a confirmed feature (this matters: it is exactly the unverified premise of the current Sol
  visual pass).
- **Programmatic embedding (the piece LandOS needs most)**: an API server (port 8642) with
  OpenAI-compatible `POST /v1/chat/completions` and stateful `POST /v1/responses`
  (`previous_response_id` / named conversations), SSE streaming with `hermes.tool.progress` events,
  a RESTful Sessions API (create/fork/chat/stream), `X-Hermes-Session-Id`/`X-Hermes-Session-Key`
  scoping, **multi-profile routing via `/p/<profile>/…` path prefixes**, per-profile API keys,
  concurrency caps, CORS allowlist. Plus HMAC webhooks and an ACP stdio adapter.

**Implication:** the embeddable primitives LandOS should build on are *profiles + API server +
per-profile memory/skills* — which is what Bot Mode itself is built on. The desktop group-room UX is
not needed: LandOS's own War Room turn engine already provides bounded group deliberation. Adopting
"Bot Mode" for LandOS means **persistent specialist profiles driven through the Hermes API server**,
not embedding Hermes' desktop rooms. Reaching any of this requires upgrading the installed Hermes to
≥0.20.3 (target 0.20.5) and, per LandOS's own governance manifest, re-reviewing and repinning skills
first (the pin currently blocks audit at 0.19.1).

---

## 4. Gap analysis against the target

| Target | Today | Gap |
|---|---|---|
| Persistent Property/Market/Seller/Deal specialists | One stateless coordinated Sol pass; one Hermes profile; no persistence between runs | Split into 4 Hermes profiles with per-bot SOUL/memory; API-server transport instead of oneshot CLI |
| Specialists reason, notice contradictions | Stack contract already demands conflicts/unknowns; dossier carries `conflicts[]` | Doctrine mostly exists; needs per-specialist mandates + genuinely grounded inputs (vision, seller) |
| Vision: bots see pixels | Gemini sees pixels (aux path); Sol pass is filename-text theater | Route images as base64 (Hermes API server) or feed persisted Gemini VisualObservations into the dossier; delete/verify the filename pass |
| Seller Bot with full comms history | Data scattered in 5 stores, never assembled; dossier.seller = name + price | Deterministic dossier assembly of comm log, stated facts, transcripts, notes |
| Bots request bounded capabilities | Readiness backfill exists (deterministic); MCP bridge has read + write-back but no invoke | One allowlisted `invoke_capability` / `request_backfill` bridge operation |
| Deal Brain chairs, synthesizes | Deal Intelligence product + Deal Brain chat both working | Mostly done; add cross-bot disagreement surfacing |
| War Room scoped to current deal | Production turn engine, chat-scoped, no deal_card_id, no Deal Card button | Add deal scoping column + context injection + launch button |
| New evidence returns to shared record, bots reconsider | Capability evidence ledger + fingerprint-staleness re-runs already work | Wire capability completion → stack refresh → War Room notice |
| Learning without drift | Hermes has pending-skills staging + LandOS has skill provenance pinning | Define the 5-level promotion ladder over existing mechanisms |
| Time-sensitive area intelligence | property-development-history + zoning capabilities + bounded web lanes + ddgs | A jurisdiction-scoped "current planning/news screen" capability (later) |
| Fast normal leads | Stack is one pass; readiness prevents rework | Preserve: specialists parallel-where-useful is already how the stack batches; no per-lead group debate |

---

## 5. Reuse map (existing component → future role)

| Existing | Future role |
|---|---|
| `intelligence-stack.ts` + `intelligence-stack-contract.ts` | Stays the normal-lead engine; its four layers become the four Bots' briefs; layer fingerprints stay the staleness/re-run mechanism |
| `acquisition-analyst.ts` Hermes transport | Replaced by Hermes API server calls (`/p/<profile>/v1/responses`) — same profile concept, now stateful, streamable, image-capable |
| `config/hermes/acquisition-analyst/` SOUL + SKILL | Template for four specialist profiles (persona + reasoning doctrine per bot) |
| `acquisition-intelligence-dossier.ts` | THE Deal Context Pack (already bounded + honest); gains seller + visual-observation sections |
| `research-readiness.ts` + `research-readiness-backfill.ts` | The question→capability map bots use to ask for evidence |
| Capability registry/contract/store + evidence ledger | Unchanged — LandOS keeps owning HOW evidence is obtained and persisted |
| MCP bridge (`mcp-bridge.ts` + `policy.py`) | Gains one `invoke_capability`/`request_backfill` allowlisted operation |
| `browser-vision.ts` + `VisualObservation` + Gemini `generateVisionContent` | The grounded eyes; observations flow into the dossier |
| War Room orchestrator + SSE events + tool policy + persistence | The boardroom turn engine, deal-scoped; specialists join the roster |
| `/discuss` council primitive (`pickSlashRoster`, budgets) | The "convene the specialists on this deal" mechanic |
| Deal Brain chat (`landos_deal_brain_guidance`) | Chair's direct line on the Deal Card; unchanged |
| `businessSpine` / `whatBlocksThisDeal` / RAG context | On-demand retrieval endpoints for bots (beyond the default pack) |
| Governed profile manager + skill provenance manifest | The Level-4 promotion gate (skills repinned only with approval) |
| `gis-escalation.ts` budget pattern | Template for bounding any future time-sensitive research capability |

Not reused (leave alone): War Room voice path, `executive-orchestrator.ts`, V1 acquisition-intelligence
run endpoint (should eventually be retired, separately), OMP stop-guard, `model-providers.ts` registry.

---

## 6. Proposed final architecture

Simple statement: **LandOS stays the deterministic spine; four persistent Hermes profiles become the
cognitive layer; the existing War Room becomes the deal-scoped boardroom; the MCP bridge gains one
bounded "request evidence" verb.**

- Four Hermes profiles as persistent Bots: `landos-property-bot`, `landos-market-bot`,
  `landos-seller-bot`, `landos-deal-brain` — cloned from the acquisition-analyst template, each with
  its own SOUL (specialist mandate + shared reasoning doctrine: observe → model → compare → flag
  what doesn't reconcile → decide if uncertainty matters → request cheapest bounded evidence →
  reconcile → stop when not decision-useful), own MEMORY.md, own skills dir, per-bot model pin.
- Transport: Hermes API server, per-profile routing, SSE streaming; `X-Hermes-Session-Key =
  landos:deal:<dealCardId>:<bot>` so each bot's memory of a deal persists across sessions without
  cross-deal bleed. Base64 images on vision turns. (Requires Hermes ≥0.20.3; governance repin first.)
- Normal lead flow: unchanged one-stack run; the three specialist layers may run as parallel
  API-server calls where useful, Deal Brain synthesizes. No group debate on normal leads.
- War Room: existing orchestrator, deal-scoped. Specialist roster entries are backed by a Hermes
  transport in `runAgentTurn()` (roster is already data-driven; the Claude department agents remain
  available alongside). Opening context = the Deal Context Pack. Bots may disagree; the chair does
  not manufacture consensus.
- Evidence loop: a bot never writes canonical facts. It calls `request_capability` (bridge op) →
  LandOS runs the governed capability → evidence lands in `landos_capability_evidence` → layer
  fingerprints go stale → affected products re-run → War Room gets a system note "new assessor
  evidence retained; Property read updated."

## 7. Exact data / control flow (normal + War Room)

```
Deal Card intelligence run (normal, fast)
  readiness preflight (red+machine+critical backfill, bounded)
  → buildAcquisitionDossier(deal)                      [now incl. seller comms + visual observations]
  → Property Bot ── /p/landos-property-bot/v1/responses (dossier slice + base64 images)
    Market Bot  ── /p/landos-market-bot/v1/responses   (market slice)          } parallel
    Seller Bot  ── /p/landos-seller-bot/v1/responses   (seller slice)          }
  → Deal Brain ── synthesis over three reads + deterministic economics (verbatim, never recomputed)
  → landos_deal_intelligence_snapshot (4 products, current-row supersede)
  → Deal Card UI renders all four reads

Contradiction path (the Fairview standard)
  Property Bot sees: provider says 1,534 sqft 1968 structure; VisualObservations say no meaningful
  dwelling; seller-stated fact says raw land
  → flags conflict + hypotheses (stale record / removed structure / stale imagery)
  → decides current assessor improvement data is the cheapest strongest check
  → request_capability{capabilityId: assessor-tax, mode: refresh, reason}   [MCP bridge, allowlisted]
  → LandOS invokeRuntimeCapability → governed run → landos_capability_evidence (provenance)
  → property layer fingerprint stale → Property Bot re-reads → revised product
  → Deal Brain re-synthesizes → Deal Card + open War Room meeting get the update note
```

## 8. War Room integration (exact)

1. Schema: add nullable `deal_card_id` (+ optional `deal_label`) to `warroom_meetings`
   (`src/db.ts:263-282`); accept it in `POST /api/warroom/text/new` (`dashboard.ts:1304`).
2. Launch: a "War Room" button on `AcquisitionWorkspaceV2` header → creates/reuses the deal's
   meeting → opens `/warroom/text?...&meetingId=…`. One canonical meeting per deal (reuse if open),
   so the room accumulates the deal's deliberation history.
3. Context: in `runAgentTurn()` context assembly (`warroom-text-orchestrator.ts:1416-1500`), when the
   meeting has a `deal_card_id`, inject `<untrusted source="deal_context">…</untrusted>` containing
   the Deal Context Pack (dossier + current four reads + readiness headline + unresolved conflicts +
   what-blocks-this-deal). Cross-DB read of `store/landos.db` from the orchestrator (read-only,
   via the existing landos accessors). Tyler never re-explains the property.
4. Roster: seed the deal meeting's standup config with the four specialist bots + chair; `/discuss`
   already gives ordered, budgeted, capped council turns. Deal Brain is pinned or listed first
   (chair). Tyler @mentions any bot directly — the ladder already supports it.
5. Capability requests from the room: a bot's `request_capability` surfaces as a system note in the
   transcript ("Property Bot requested Assessor & Tax refresh — running"), and completion posts the
   evidence-updated note. The tool boundary stays `warroom-tool-policy.ts` default-deny plus the
   MCP allowlist — no free tools.
6. Persistence: unchanged (`warroom_transcript`); the meeting IS the deliberation record, linked to
   the deal by the new column.

The 3,248-line hand-written chat HTML is the ugliest part but works; reskinning it into React is
explicitly NOT part of this effort.

## 9. Memory + skill learning model (anti-drift)

| Level | What | Lives in | Promotion gate |
|---|---|---|---|
| 1 Deal observation | "On this deal, X" | LandOS: `landos_deal_intelligence_snapshot`, `landos_card_activity`, War Room transcript; Hermes session under `landos:deal:<id>:<bot>` key | none — it's the record |
| 2 Pattern / hypothesis | "I've now seen X twice; maybe Y" | The bot's own `MEMORY.md` (Hermes auto-consolidation), tagged as hypothesis with deal refs | bot writes freely; hypotheses are never authoritative |
| 3 Validated pattern | Confirmed across ≥3 deals or by Tyler | Promoted section of MEMORY.md and/or a **staged skill draft** in Hermes `pending/skills/` (`skills.write_approval: true`) | Tyler reviews the pending change |
| 4 Promoted skill | Durable specialist behavior | Governed skill in the profile, recorded in the skill provenance manifest via the governed-profile-manager flow | explicit approval + repin (the same manifest that currently blocks on drift) |
| 5 Deterministic LandOS rule | Stable enough to be code | LandOS source via the normal development process (Control spine, browser acceptance) | full dev acceptance; removed from bot doctrine once codified |

Anti-drift mechanics, all already existing: `skills.write_approval` staging (Hermes), hash-manifest
protection + provenance repin (LandOS governance), per-deal session keys (one strange deal pollutes
only its own session, not MEMORY.md, unless the bot deliberately writes a Level-2 hypothesis), and
the standing rule that bot memory is never canonical property fact — canonical facts only enter via
governed capabilities and the evidence ledger. Tyler's corrections in War Room/Deal Brain chat are
Level-1 by default; a bot may propose (never self-apply) promotion.

## 10. Vision wiring (exact recommended path)

Two steps, one immediate and one at the Hermes upgrade:

1. **Now (no Hermes change needed): make the grounded path the only path.** Feed persisted Gemini
   `VisualObservation` rows (and the whole-card operator analysis) into
   `dossier.visuals`/a new `dossier.visualObservations` section, so every reasoning pass receives
   *actual observations from a model that saw pixels*, with confidence and sourceImage refs. Gate the
   Sol per-image pass behind a one-time verification (does the Hermes runtime actually attach a named
   file? — no official doc supports it); if unverified, remove it. This alone meets the Fairview
   standard: the provider-record/imagery/seller contradiction becomes visible in structured inputs.
2. **At upgrade (≥0.20.3): direct pixels to the Property Bot.** Send the top-priority eligible
   images (existing `VISUAL_PRIORITY` + eligibility gating, cap ~3) as base64 `image_url` parts on
   the API-server call to a vision-capable model pinned on `landos-property-bot` (the
   `auxiliary.vision` ollama `gemma4:12b` already configured on the analyst profile is the local
   fallback). Bot output lands in the same `VisualObservation` shape — observations, never canonical
   facts, high confidence still capped to medium.

Do not build: a new image store, a new observation schema (two already exist — converge on
`browser-vision.ts`'s), or automatic canonicalization of visual reads.

## 11. First 4 implementation slices

### Slice 1 — Deal-scoped War Room from the Deal Card
- **Purpose:** open the War Room from a Deal Card already knowing the deal; end blank-chat re-explanation.
- **Reuses:** entire War Room text stack, `/discuss` roster machinery, `buildAcquisitionDossier`,
  readiness manifest, `whatBlocksThisDeal`.
- **Touches:** `src/db.ts` (meeting column), `src/dashboard.ts` (`/text/new` param),
  `src/warroom-text-orchestrator.ts` (deal context block in context assembly),
  `web/src/pages/AcquisitionWorkspaceV2.tsx` (button), small read-only accessor into `landos.db`.
- **Browser acceptance:** from the Fairview deal card, click War Room → the room opens, ask "what's
  the biggest open risk on this deal?" → an agent answers with deal-specific facts (APN, acreage,
  valuation band) that were never typed into the chat; hard refresh → transcript persists.
- **Complexity:** low-medium. **Not yet:** Hermes-backed bots, capability requests, UI reskin.

### Slice 2 — Vision truth into intelligence
- **Purpose:** reasoning inputs contain real visual observations; no ungrounded visual pass.
- **Reuses:** `browser-vision.ts` observations, `visual-eligibility.ts`, Gemini client, dossier.
- **Touches:** `acquisition-intelligence-dossier.ts` (visual-observations section),
  `acquisition-analyst.ts` (verify-or-remove the filename pass), `intelligence-stack-contract.ts`
  (prompt tells the analyst observations came from a vision model with image refs).
- **Browser acceptance:** run intelligence on a deal with retained imagery → the Property read on the
  workspace cites a concrete visual observation (e.g. "no visible improvements in aerial …") that
  matches a retained image, and flags the provider-record conflict when one exists.
- **Complexity:** low-medium. **Not yet:** Hermes upgrade, direct base64 path, new schemas.

### Slice 3 — Seller evidence assembly + render the orphaned reads
- **Purpose:** Seller Intelligence gets its raw material; the paid-for Property/Market prose becomes
  visible on the workspace.
- **Reuses:** all five seller stores, `seller-stated-facts.ts`, dossier bounds/truncation pattern,
  existing snapshot products, `AcquisitionWorkspaceV2` section components.
- **Touches:** `acquisition-intelligence-dossier.ts` (real `dossier.seller`: comm timeline, stated
  facts, contradictions, unanswered questions), `AcquisitionWorkspaceV2.tsx` (+ Property/Market read
  panels).
- **Browser acceptance:** record a seller-stated fact on a deal → run intelligence → the Seller read
  references it, and Property/Market strengths/constraints/liquidity prose is visible on the page
  and survives refresh.
- **Complexity:** medium. **Not yet:** LLM call analysis, outreach automation, CRM redesign.

### Slice 4 — Persistent specialists + bounded capability requests
- **Purpose:** the four Bots become persistent Hermes profiles with memory, and can request governed
  evidence; the full contradiction→evidence→revised-read loop closes.
- **Reuses:** Hermes profile provisioning (`scripts/hermes/provision-acquisition-analyst.mjs` as
  template), governed-profile-manager + provenance manifest (upgrade gate), API server, MCP bridge
  allowlist pattern, `invokeRuntimeCapability`, readiness backfill, layer-fingerprint staleness.
- **Touches:** Hermes upgrade to 0.20.5 + skill re-review/repin (approval-gated), 4 profile templates
  under `config/hermes/`, a small API-server transport module replacing the oneshot exec in
  `acquisition-analyst.ts`, `mcp-bridge.ts`/`policy.py` (+`invoke_capability`), stack/War Room
  notification wiring.
- **Browser acceptance:** in the deal's War Room, ask the Property Bot about the structure
  contradiction → it requests Assessor & Tax refresh → a visible system note appears, the capability
  runs, and the Property read updates on the workspace with the new evidence cited.
- **Complexity:** high (and contains the two approval gates: Hermes upgrade, bridge expansion).
- **Not yet:** Bot Mode desktop group rooms, peers/webhooks, voice War Room, time-sensitive
  news-screen capability, skill self-promotion automation, cost accounting.

## 12. Recommended first slice

**Slice 1 — Deal-scoped War Room.** It is the marquee operator ask, it produces immediate visible
value on real deals (the room already works; it just doesn't know the deal), it requires no Hermes
upgrade, no new agent system, and no approval gates, and every later slice (specialist bots,
capability requests) plugs into the deal-scoped meeting it creates.

---

### Boundary notes

- No LandOS rewrite is proposed; every flow above reuses a named existing component.
- No new orchestration system: the War Room turn engine + Hermes profiles + the capability
  contract cover the target; the only new verb is one allowlisted bridge operation.
- Deterministic capabilities remain the only writers of canonical facts.
- The Hermes upgrade (0.20.0 → 0.20.5) is a prerequisite only for Slice 4 and is gated by the
  existing skill-provenance repin policy plus Tyler's approval; nothing was upgraded in this audit.
- This audit ran read-only: the only file created is this report. The governance checkpoint
  (`landos:memory:checkpoint`) was deliberately not run because it regenerates `.landos/STATE.md`,
  which the task's read-only mandate excludes.
