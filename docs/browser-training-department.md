# Browser Training Department

A LandOS department that lets Tyler teach browser agents the way you train a new
employee: share a browser tab / window / desktop, talk while demonstrating a
workflow, and LandOS watches, listens, talks back, records exactly what happened,
extracts the business rules, and produces a reusable Browser Playbook that future
browser agents execute.

This is the "teach it once, run it forever" front-end to the existing Browser
Agent department. Browser Agent *executes* playbooks; Browser Training *creates*
them from a live demonstration.

---

## 1. Architecture evaluation

The feature needs five things at once, in real time:

1. Live screen understanding (what page is this, what are the fields/buttons).
2. Two-way natural voice (Tyler talks, LandOS answers, asks, warns).
3. Low latency (< ~1s round trip or the conversation feels broken).
4. Browser workflow capture (URLs, clicks, selectors, DOM, navigation).
5. Reusable playbook generation from the captured session.

### Local / open-source stack considered

| Component | Local option evaluated | Verdict |
|---|---|---|
| Speech-to-text | `whisper.cpp` / faster-whisper | Works, but streaming partials + barge-in on a CPU/consumer-GPU Windows box add 300-900ms and jitter. |
| Text-to-speech | Piper / Coqui / XTTS | Piper is fast but robotic; XTTS is natural but 500ms+/utterance on CPU. |
| Vision-language | LLaVA / Qwen2-VL via Ollama | A 7B VLM on this workstation runs ~2-6s/frame. Unusable for *continuous* live screen understanding. |
| Orchestration | Ollama routing | Fine for text, but ties three heavy models together and multiplies latency. |
| Realtime transport | LiveKit / WebRTC | Mature, but only moves bytes — it does not solve the model latency above. |
| Browser instrumentation | Playwright / CDP | **Kept local.** Already implemented in `browser-session.ts`. |
| Screen/audio capture | Browser `getDisplayMedia` + `getUserMedia` | **Kept local/native.** Standard browser APIs, no server round trip to capture. |

**Hardware limitation:** the target is a Windows 11 consumer workstation with no
dedicated inference GPU budget reserved for this. Chaining local STT + a local
VLM doing *continuous* frame understanding + local TTS produces a conversation
that lags 2-6 seconds per turn and cannot barge-in. That is not "talk to it like
an employee"; it is "submit a request and wait." The prompt is explicit: **do not
fake capability.**

### Chosen architecture: hybrid (local capture + CDP, cloud realtime brain)

| Layer | Where it runs | Why |
|---|---|---|
| Screen capture (tab/window/desktop) | Local — browser `getDisplayMedia` | No native agent needed; user picks the surface. |
| Microphone capture | Local — browser `getUserMedia`, PCM16 @ 16kHz | Native, zero-latency capture. |
| Browser event capture (URL/click/selector/DOM/nav) | Local — CDP via `browser-session.ts` | Exact "how", already built, deterministic. |
| Realtime brain (audio-in, audio-out, vision, transcription, tool calls) | **Cloud — Gemini Live** (`@google/genai` `ai.live.connect`) | One socket does STT + reasoning over live video + TTS + function calling with sub-second latency. |
| Playbook synthesis | Cloud — Gemini text (`generateContent`) at session end | One structured pass over the transcript + captured events. |
| Storage, redaction, replay, usage, review UI | Local | Deterministic, testable, no cloud dependency. |

**What stays local:** all capture, all browser instrumentation, all storage, the
security redaction guard, replay execution, playbook review/versioning, usage
accounting, and the entire dashboard.

**What requires cloud AI:** the realtime conversation socket (Gemini Live) and the
end-of-session playbook/knowledge synthesis. Nothing else.

### Why Gemini Live specifically

- The repo already depends on `@google/genai` and a Google key is already
  configured and in active use (memory extraction, embeddings). No new account,
  no new secret, no new paid provider onboarding.
- Gemini Live is a single bidirectional socket that natively accepts realtime
  audio + video frames and returns audio + input/output transcripts + function
  calls. That collapses the STT + VLM + TTS + tool-calling stack into one
  low-latency service.
- The provider is swappable: the realtime brain lives entirely behind
  `browser-training-live.ts`. If a local stack later becomes viable, or a superior
  realtime provider appears, only that file changes. Nothing else knows the brand.

### Cost posture

No hard caps (per Tyler's instruction). The dashboard *displays* provider, model,
session duration, estimated tokens, estimated cost, and today/week/month/lifetime
rollups plus playbooks created. Tyler decides whether to keep going. Estimates use
published Gemini Live rates in `browser-training.ts` (`GEMINI_LIVE_RATES`) and are
labelled "estimated".

---

## 2. Data model

Five tables (all `landos_training_*`, created in `db.ts` `ensureSchema`):

- `landos_training_session` — one row per training session (status, surface,
  provider/model, timing, usage totals, linked deal card).
- `landos_training_event` — ordered timeline: transcript turns (operator/AI),
  browser events (nav/click/input/screenshot), and system notes (guard blocks).
- `landos_training_playbook` — draft/approved/rejected playbooks with a full
  version history (each edit bumps `version`, old rows retained).
- `landos_training_knowledge` — org knowledge extracted separately from the
  workflow (business rules, provider quirks, operator preferences).
- `landos_training_usage` — per-session usage/cost snapshot for fast rollups.

## 3. Security

The redaction guard (`training-security.ts`) refuses to record or transmit:
passwords, `.env` contents, cookies, auth headers, tokens, `localStorage`,
`sessionStorage`, billing/payment pages. Password-type inputs are captured as
`[redacted]`. Any URL or action matching the paid/checkout/billing/skip-trace
patterns immediately stops and marks **Approval Required** — never auto-purchases.

## 4. Prohibited vs allowed actions

**Allowed:** login, property search, parcel selection, map search, visible data
extraction, screenshots, Deal Card population.

**Prohibited (auto-stop → Approval Required):** purchasing reports/comps/sold
reports, skip trace, checkout, billing, subscriptions, account settings, paid
exports, any purchase.

## 5. Replay

`browser-training-replay.ts` re-executes the captured non-paid steps against a
test/alternate property via CDP and reports pass/fail per step. Paid steps are
skipped and flagged. Replay never buys anything.

## 6. First supported workflow

LandPortal Map Search (login → search → parcel select → sidebar extraction: owner,
APN, acreage, road frontage, landlocked, wetlands, FEMA, buildability, slope,
screenshots, sidebar counts, visible comps map → Deal Card population). Paid
LandPortal report flows are never taught. LandPortal credentials are read only
from `.env` (`LANDPORTAL_EMAIL`, `LANDPORTAL_PASSWORD`), never printed, logged,
committed, or sent to the model.
