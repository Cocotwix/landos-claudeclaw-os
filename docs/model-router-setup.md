# LandOS Model Router — operator setup (later)

The model router is **provider-agnostic** and **safe by default**. Out of the box
(`LANDOS_LIVE_ROUTING` unset) every routed task resolves to **Claude only**, and
all low-risk grunt-work helpers fall back to **deterministic** output — no extra
model calls, no external credentials, nothing to configure.

When you're ready to run local/open or other cloud providers for low-risk
grunt-work, add the values below to `.env`. **You do not need any of this now** —
the system already builds, tests, and runs without it.

> The agent never prints `.env` values and never edits the file. These are the
> keys *you* add when ready. (An existing credential may be read privately when
> an approved local workflow needs it; the value is never revealed.)

## Enable live routing
```
LANDOS_LIVE_ROUTING=1
```
With this off: Claude-only, deterministic helpers (current behavior).
With this on: low-risk grunt-work (summaries, classification, extraction,
research digestion, report-section/market-pulse/county drafts, media grunt-work)
routes to the best **available** model; **high-stakes always stays on Claude**.

## Local: Ollama + Gemma (recommended for grunt-work)
1. Install Ollama: https://ollama.com/download
2. Pull a Gemma model, e.g.:
   ```
   ollama pull gemma2:9b        # maps to the local open-source slot
   ```
3. Point LandOS at it:
   ```
   OLLAMA_HOST=http://127.0.0.1:11434
   ```
The router serves `gemma-4-e4b` / `gemma-4-12b-q4` via Ollama. If `OLLAMA_HOST`
is unset or Ollama isn't running, the provider reports **unavailable** and:
- automatic routing falls back to the best available model (else Claude);
- a manual override to a local model is **reported as unavailable** (never
  silently substituted) so you can start Ollama or pick another model.

## Other local servers (OpenAI-compatible)
```
LM_STUDIO_URL=http://127.0.0.1:1234/v1
VLLM_URL=http://127.0.0.1:8000/v1
```

## Cloud providers (optional)
```
OPENAI_API_KEY=...
OPENROUTER_API_KEY=...        # OpenAI-compatible aggregator
GOOGLE_API_KEY=...            # Gemini (also the War Room voice provider)
# Claude needs nothing new — it uses your existing ~/.claude session/login.
# ANTHROPIC_API_KEY only if you prefer API-key auth (see CLAUDECLAW_USE_ANTHROPIC_API_KEY).
```

## Verifying status (no secrets shown)
Dashboard → **Model Router** tab, or:
```
GET /api/landos/model-router/status      # flag + provider presence (booleans) + EE→provider tree + helpers
GET /api/landos/model-router/environments
POST /api/landos/model-router/preview    # deterministic routing preview, no model call
```
Each provider reports: installed / configured / reachable / healthy / enabled /
auth status / available models / capabilities / execution environment.

## Manual overrides
```
POST /api/landos/model-router/override        { scope: global|agent|task_type, key?, modelId }
POST /api/landos/model-router/override/reset   { scope, key? }
GET  /api/landos/model-router/override?agentId=&taskType=
```
Override always wins. If the selected model is unavailable it is **reported, not
substituted** — you decide whether to enable the provider or pick another model.

## Safety guarantees
- High-stakes work (underwriting, parcel verification, legal/zoning, offer
  approval, seller psychology, executive decisions) **never** routes off Claude.
- Model output is always labeled a non-authoritative **draft** and never
  overwrites verified facts.
- Tests never require credentials, never call paid APIs, and never need Ollama
  running.
