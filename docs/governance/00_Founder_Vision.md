# Land Operating System (Land OS) — Final Vision

The Land OS is a fully localized, multi-agent AI system designed specifically for a land investing business. It operates on a local machine, maintains absolute data privacy, routes complex tasks to the most efficient AI models, and provides a centralized Command Center for the human operator. Everything in this document was developed through a detailed design conversation to ensure the system reflects the real operational needs of the business.

> **Document Currency Note:** All model names, provider references, and cost estimates reflect the current state of the AI landscape as of **June 2026**. The AI model ecosystem changes rapidly — new models are released, providers update pricing, and capabilities shift week to week. The Land OS is intentionally built on a provider-agnostic, modular architecture so that any model or provider reference in this document can be swapped with a configuration change. Treat all specific model names as the best current option, not a permanent dependency. The AI Tech Researcher (`ai_bot`) is specifically tasked with monitoring this landscape and surfacing better options as they emerge.

---

## 1. System Architecture

The Land OS is built on a **local-first, hybrid-cloud architecture**. It separates code, secrets, and business data into three distinct, secure environments.

### Storage and Security Separation

The **GitHub Repository** contains only code, agent configurations (`CLAUDE.md` files), workflow scripts, and the Dashboard application. If the repository were ever compromised, the attacker would have a shell with no business intelligence — no training data, no property files, no seller information, and no API keys.

The **Local Machine** runs the system itself, hosts local AI models, and securely stores the `.env` file containing all API keys and secrets. This file is `.gitignore`d and never leaves the machine.

**Cloudflare R2** serves as the private Knowledge Base for all business data — training materials, SOPs, property files, call transcripts, Land Score Reports, market data, and the County Data Source Map. R2 has zero egress fees, meaning agents can read and write files constantly without incurring download costs. Storage at the expected volume (~3–5GB) costs approximately $0.05–$0.08/month.

| Storage Layer | Contents | Tech Stack | Security |
| :--- | :--- | :--- | :--- |
| GitHub Repository | Code, CLAUDE.md configs, workflow scripts, Dashboard app | Git / GitHub | Public or private repo — no business data |
| Local Machine | Running system, Ollama models, `.env` secrets file | Windows 10/11, Python 3.11+, Node.js 22 | `.gitignore`d secrets, never synced |
| Cloudflare R2 | All business data — reports, training, market data, call transcripts | Cloudflare R2 (S3-compatible), `boto3` / `rclone` for access | Private bucket, access via API key only |

### Access and Interfaces

**The Dashboard** is the primary interface when at the computer. It is a local web application running on `localhost` that features a Kanban board for deal tracking, a built-in document viewer that renders files from R2, and a call briefing panel for discovery and offer calls.

| Component | Tech Stack |
| :--- | :--- |
| Dashboard framework | React + TypeScript + TailwindCSS (Vite) |
| Backend API | FastAPI (Python) or Express (Node.js) |
| Kanban board | React-based drag-and-drop (e.g., `@dnd-kit`) |
| Document viewer | Markdown renderer + PDF.js for report viewing |
| R2 file access | `boto3` (Python S3-compatible client) |
| Local server | Runs on `localhost:3000` (frontend) + `localhost:8000` (API) |

**Telegram via Cloudflare Tunnel** is the mobile interface. A free Cloudflare Tunnel provides a stable public URL that routes securely to the local machine, allowing the Telegram bot to communicate with the Land OS from anywhere without exposing the machine directly to the internet.

| Component | Tech Stack |
| :--- | :--- |
| Telegram bot | `python-telegram-bot` library (Python) |
| Tunnel | Cloudflare Tunnel (`cloudflared` daemon, free tier) |
| Voice note transcription | OpenAI Whisper (local, via `faster-whisper`) |

**The Voice Interface** is built into the Executive Agent. It supports two modes: asynchronous voice notes via Telegram (transcribed by Whisper, responded to by text or voice audio), and live bidirectional voice calls between the operator and the Executive Agent.

The voice call channel is a **private, direct communication line between the operator and the Land OS** — no carrier involvement, no A2P registration, and no external messaging compliance requirements. This is not seller communication; it is an internal operator-to-system channel.

Three suggested implementation options are listed below. These are not set in stone — the voice channel follows the same provider-agnostic principle as the rest of the system and can be swapped as better options emerge.

**Suggested Option 1 — Gemini Live API (recommended for live bidirectional voice):**
The primary real-time voice interface uses the `gemini-3.1-flash-live-preview` model via the Gemini API. This allows for extremely low-latency, natural, bidirectional conversation with the Executive Agent, capable of handling interruptions and acoustic nuances. This is implemented in Phase 1 for internal operator-to-system communication.

**Suggested Option 2 — SIP / VoIP (alternative for phone access):**
A private SIP server runs locally via **Asterisk** or **FreePBX** (both fully open source). A free SIP client app on the operator's phone connects to the same server. Tunneled through Cloudflare for remote access. No carrier, no phone number, no registration.

**Suggested Option 3 — WebRTC in the Dashboard (alternative for desktop access):**
A WebRTC audio panel built directly into the Dashboard enables live voice sessions from the browser. Entirely local, zero external dependencies.

**Suggested Option 4 — Telegram Voice Notes (already in the system):**
For asynchronous use — the Executive Agent sends a voice message alert, the operator replies with a voice note, Whisper transcribes it. No additional infrastructure required.

| Component | Tech Stack | Cost |
| :--- | :--- | :--- |
| Live Voice | Gemini Live API (`gemini-3.1-flash-live-preview`) | ~$10-25/mo |
| Speech-to-text (Async) | `faster-whisper` (local, Apache 2.0) | Free |
| Text-to-speech (Async) | Kokoro TTS (local, Apache 2.0) | Free |
| VoIP audio capture | `PyAudio` / `sounddevice` (Python) | Free |
| SIP server (Option 2) | Asterisk or FreePBX (open source) | Free |
| SIP client app (Option 2) | Linphone or Zoiper (free apps) | Free |
| WebRTC panel (Option 3) | Browser-native WebRTC API + Dashboard integration | Free |
| Async voice notes (Option 4) | `python-telegram-bot` (already in system) | Free |

### CRM and Communication Integration

**GoHighLevel (GHL) / CloseBot** handles all automated, seller-facing communication including SMS sequences, email follow-ups, and A2P 10DLC compliance. The Land OS does not replace GHL — it operates as the intelligence layer behind it.

When a new lead submits a form, GHL fires a webhook to the Land OS. The Land OS runs the full due diligence workflow and pushes the completed Land Score Report and notes back into the GHL contact record.

For **partner deals** where the operator works inside a partner's GHL without webhook access, the Land OS Dashboard includes a manual intake form that triggers the exact same DD workflow. The report is generated identically; it simply does not sync back to GHL automatically.

| Component | Tech Stack |
| :--- | :--- |
| GHL webhook receiver | FastAPI endpoint (`/webhook/lead`) |
| GHL API integration | GHL REST API v2 (`requests` / `httpx`, Python) |
| Manual intake form | React form in Dashboard → FastAPI → DD workflow |
| Webhook payload parsing | Pydantic models (Python) for validation |

### System Resilience and Offline Access

The Land OS is designed to remain functional under common failure scenarios. No local cache of business data is maintained on the laptop — all business data streams from R2 on demand, keeping the machine lean. The resilience strategy is built around the following principles:

**What remains operational during an internet or Cloudflare outage:**
- The Dashboard on localhost — fully functional for any data already loaded in the browser session
- Local Ollama model inference — all AI reasoning continues uninterrupted
- The GitHub repo and agent configs — always available locally

**What is affected:**
- R2 file access — agents cannot read or write new files to the knowledge base
- External APIs (Realie.ai, Apify, FEMA, GHL webhooks, etc.) — data pulls unavailable
- Cloudflare Tunnel — remote phone access to the Land OS is interrupted

**Each agent's knowledge base and training playbook** lives in its own folder under `r2://agents/{agent_name}/knowledge/`. Multiple agents have their own training data — not just the Acquisitions Agent. This is all stored in R2 and streamed on demand.

---

**Suggested Offline and Resilience Options** *(these are guides, not fixed decisions — all are interchangeable as better solutions emerge)*

**Suggested Option A — Progressive Web App (PWA) with Offline Cache (preferred starting point):**
The Land OS Dashboard is built as a PWA with a service worker that caches a curated set of critical read-only content to the phone each morning — active deal briefs, playbook summaries, the daily pipeline brief, and key SOPs. When the internet is down, this content remains accessible on the phone without any connection. No new agent tasks can be run, but the operator can read all current deal status and reference materials from anywhere. The cache refreshes automatically each morning when connectivity is restored.

| Component | Tech Stack |
| :--- | :--- |
| PWA shell | React + Vite (`vite-plugin-pwa`) |
| Service worker | Workbox (Google, open source) |
| Offline cache | IndexedDB (browser-native) |
| Cache refresh trigger | Background sync API or morning cron |

**Suggested Option B — Local Network Access (same WiFi, no internet needed):**
If the internet goes down but the local WiFi router is still running, the phone and laptop are on the same local network. The Dashboard is accessible directly via the laptop's local IP address (e.g., `http://192.168.1.x:3000`) without Cloudflare. Covers the most common outage scenario where the ISP is down but the home network is functional.

**Suggested Option C — Mobile Hotspot Fallback:**
If both home internet and local network are down, the phone's cellular data connection becomes the internet source for the laptop. Connecting the laptop to the phone's hotspot restores the Cloudflare Tunnel and all remote access. The phone's cellular connection is an independent internet path that does not depend on the home ISP.

**Suggested Option D — Dedicated Always-On Mini PC (Phase 2 infrastructure):**
For a more robust long-term setup, the Land OS runs on a small always-on device (e.g., a Beelink mini PC or Intel NUC) rather than the laptop. The laptop becomes a client. The system stays running 24/7 regardless of whether the laptop is open or closed. Recommended when the system becomes mission-critical to daily operations.

**Secondary Backup for Training and SOP Documents:**
Training materials, playbooks, and SOPs are backed up from R2 to a secondary cloud location (e.g., Google Drive or OneDrive) once per day via an automated sync script. This is a read-only disaster recovery copy — not a working copy. If R2 were ever unavailable for an extended period, these documents remain accessible from any device. Property files and deal data are not included in this backup; only institutional knowledge documents that would be difficult to rebuild.

| Component | Tech Stack |
| :--- | :--- |
| R2 → secondary backup sync | `rclone` (open source, supports R2 + Google Drive / OneDrive) |
| Sync schedule | Windows Task Scheduler (nightly) |
| Scope | `r2://training/`, `r2://playbooks/`, `r2://sops/` only |

---

## 2. The Model Router

To balance intelligence, speed, and cost, the Land OS uses a tiered model routing system. The system defaults to local open-source models wherever possible. Both open-source and closed-source options are available at every tier — each agent's `CLAUDE.md` specifies its default model, a fallback, and any task-specific overrides.

| Tier | Task Type | Open-Source Options | Closed-Source Options | Inference Backend |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | Fast, high-volume, structured tasks (triage, API data formatting, comp calculations, pipeline monitoring, deadline tracking) | Gemma 4 E4B, Gemma 4 12B, Llama 3.1 8B | GPT-5.2, Gemini 3.1 Flash-Lite, Claude Haiku | Local via Ollama (preferred) or low-cost cloud API |
| **Tier 2** | Balanced reasoning and quality output (Land Score Reports, call prep briefs, ad copy, research digests, listing descriptions, competitor briefs) | Gemma 4 26B MoE, Gemma 4 12B, Llama 4 Scout | GPT-5.2, Gemini 3.5 Flash, Claude Sonnet 3.7 | Local via Ollama or Groq API (fast, low-cost) |
| **Tier 3** | Deep reasoning and high-stakes decisions (post-discovery underwriting, complex probate analysis, multi-department Executive coordination) | Gemma 4 31B, Llama 4 Maverick | GPT-5.5, Gemini 3.1 Pro Preview, Claude Opus 4 | Cloud API (OpenAI / Anthropic / Google) or local if VRAM ≥ 24GB |

**Model Router Tech Stack:**

| Component | Tech Stack |
| :--- | :--- |
| Local model inference | Ollama (open source, runs Gemma 4 / Llama 4 locally) |
| Fast cloud open-source inference | Groq API (`groq` Python SDK) |
| OpenAI cloud inference | OpenAI Python SDK (`openai`) |
| Anthropic cloud inference | Anthropic Python SDK (`anthropic`) |
| Model config per agent | `model_config.yaml` in each agent's directory |
| Fallback logic | Python router class — tries local first, falls back to cloud if Ollama unavailable |

> **Model Currency Note (June 2026):** The model names below are the best available options at the time of writing. The AI landscape changes rapidly — these references should be reviewed and updated regularly. The provider-agnostic `model_config.yaml` architecture means any model can be swapped with a one-line config change.

**Notes:**
- **Gemma 4** (released April 2026, Apache 2.0): Built for agentic workflows with native function-calling. The 26B MoE variant activates only 4B parameters per inference — efficient for local Tier 2 tasks. The 12B Unified model runs on a standard laptop with 16GB RAM and includes native audio ASR support. The E4B model also supports audio and runs on 8GB RAM.
- **GPT-5.5** (released April 23, 2026): Current OpenAI flagship. GPT-4.5 is being retired June 27, 2026. GPT-5.5 is the correct Tier 3 OpenAI reference.
- **Gemini Models (current lineup as of June 2026)**: `gemini-3.5-flash` (flagship fast), `gemini-3.1-flash-lite` (cheapest, high-volume), `gemini-3.1-pro-preview` (complex reasoning), `gemini-3.1-flash-live-preview` (real-time voice). *Legacy `gemini-2.0` and `gemini-1.5` models are deprecated and shut down as of June 1, 2026 — never use them.*
- **Llama 4 Scout / Maverick**: Available via Groq API at very low cost during current promotional pricing. Strong Tier 2 / Tier 3 open-source options.

---

## 3. The Data Stack

The data layer is built on a **provider-agnostic, modular architecture**. Every external data source connects through a standardized adapter layer — a Python class that normalizes the response into a consistent internal schema regardless of which provider is being used. Swapping one provider for another (e.g., replacing Realie.ai with a different parcel data API, or replacing GHL with a different CRM) requires only a configuration change and a new adapter class. No agent logic, no workflow, and no report template changes.

This applies to all data sources: parcel data, comps, CRM, and communication. The system is designed to outlast any individual provider.

**Current active providers are listed below. These are the providers in use today — not permanent dependencies.**

### Provider Configuration

```yaml
# data_sources.yaml — swap providers here without touching agent code
# All providers are current as of June 2026. This file is the single point
# of change if any provider is replaced — no agent code needs to be touched.
parcel_data:
  provider: realie_ai
comps:
  redfin: apify_redfin_actor
  zillow: apify_zillow_actor
  landwatch: apify_landwatch_actor
crm:
  provider: ghl
communication:
  provider: ghl
```

> **Provider-Agnostic Design:** Every data source connects through a standardized adapter layer. If any provider is replaced in the future, only this config file and a new adapter class need to change. No agent logic, no workflow, and no report template is affected. The system is designed to outlast any individual provider.

### Current Data Stack

| Data Need | Current Provider | Method | Tech Stack | Est. Cost |
| :--- | :--- | :--- | :--- | :--- |
| Parcel facts (owner, size, last sale, coordinates) | Realie.ai | REST API | Python `requests`, JSON → Pydantic adapter model | ~$50/mo |
| FEMA flood zone | FEMA Flood Map Service Center | REST API | `requests` → GeoJSON parse | Free |
| Wetlands coverage | National Wetlands Inventory (USFWS) | REST API | `requests` → GeoJSON parse | Free |
| Slope / terrain / buildability | USGS 3DEP Elevation | REST API | `requests` → elevation array → slope calculation | Free |
| Population density / growth | US Census Bureau | REST API | `requests` → Census ACS data | Free |
| Comps — Redfin | Apify (existing actor) | Apify REST API | `apify-client` Python SDK | Already owned |
| Comps — Zillow | Apify Zillow actor | Apify REST API | `apify-client` Python SDK | ~$1–3/mo |
| Comps — LandWatch (rural / 20+ acres) | Apify Price-per-Acre actor | Apify REST API | `apify-client` Python SDK | ~$2–6/mo |
| Local market pulse | Niche.com + local news | Constrained browser agent | Playwright (Python), 3-interaction hard limit | Free |
| County zoning / road frontage | County GIS portal | Constrained browser agent | Playwright (Python), County Data Source Map lookup | Free |

**Realie.ai Note:** Currently the active parcel data provider. Early-stage company (founded 2024) — test the free tier (25 calls/month) on past leads before full production use. Because the adapter layer isolates the provider, replacing Realie.ai in the future requires only a new adapter class and a one-line config change.

**Radius-Based Comp Logic:** All comp searches are driven by the parcel's GPS coordinates (not county), escalating as follows: 5-mile radius → if fewer than 3 comparable sold listings, expand to 10 miles → if still sparse, fall back to county-level with a flag in the report: *"Comps are sparse — county-level averages used. Verify independently before offering."*

**Constrained Browser Agent Rules:** Browser agents are always given a specific URL, a defined task, and a hard limit of 3 page interactions. If data is not found within that limit, the field is marked `UNAVAILABLE` and the workflow continues. The **County Data Source Map** (stored in R2 as `county_sources.json`) records the known GIS/assessor portal URL for every county previously worked. For new counties, the agent bootstraps the URL from NETR Online's public county records directory, saves it to the map, and uses it for all future leads from that county.

| Browser Agent Component | Tech Stack |
| :--- | :--- |
| Browser automation | Playwright (Python, async) |
| Interaction limit enforcement | Custom `BrowserSession` wrapper class with step counter |
| County Data Source Map | `county_sources.json` in R2, loaded at agent startup |
| NETR Online bootstrap | Playwright → NETR Online URL lookup → save to map |

---

## 4. The Discovery Call Briefing Report (PDF)

The centerpiece of the acquisitions workflow is a portable PDF briefing document generated before every discovery call. It is designed so that any acquisition person — whether the operator or a future hire — can pick it up and walk into a call fully prepared without needing to understand the underlying analysis.

**Tech Stack for Report Generation:**

| Component | Tech Stack |
| :--- | :--- |
| Report assembly | Python (`jinja2` templates → HTML → PDF) |
| PDF rendering | `weasyprint` or `reportlab` (Python) |
| Color-coded Land Score badge | SVG generated inline in the template |
| Comps table | Pandas DataFrame → HTML table → embedded in PDF |
| Storage | Exported to R2 as `reports/{APN}_{date}.pdf` |
| Dashboard viewer | PDF.js (browser-based, renders from R2 URL) |

The report contains five sections:

**Section 1 — Parcel Data:** Owner name, APN, county, state, lot size, road frontage (from GIS where available), land-locked status, last sale date and price, zoning, mortgage/lien status, and use code. An inherited property flag is noted here if the seller name does not match the owner of record.

**Section 2 — Property Score:** The Land Score (0–100) with its color-coded tier (green = PURSUE / 75+, amber = PURSUE WITH CAUTION / 50–74, red = PASS / below 50), the six-factor breakdown, and any auto-PASS triggers or tier-downgrade overrides applied.

| Factor | Max Points | Auto-PASS Trigger |
| :--- | :--- | :--- |
| Access / Road Frontage | 20 | Landlocked or frontage = 0 |
| Wetlands | 15 + 3 bonus | ≥75% wetlands coverage |
| FEMA Flood Zone | 15 | ≥75% in flood zone |
| Slope / Buildability | 10 | — |
| Valuation Gap | 25 | — (highest-weighted factor) |
| Size | 15 | ≤1 acre |

Tier-downgrade override: if 2 or more factors land in the lowest tier, the overall stance drops by one level.

**Section 3 — Market Pulse:** A concise local market context for the county or city. Includes population growth rate (Census API), notable upcoming developments, sales trend (up/down), and a Niche.com brief summary. Intentionally concise — a short paragraph, not a multi-page report.

**Section 4 — Comparable Sales:** The radius-based comps table showing all comps considered, with a checkmark on retained comps and a note on any excluded. Displays the search radius used and the resulting price-per-acre range derived from retained comps.

**Section 5 — Strategy Evaluation and Offer Ranges:** Each of the five exit strategies is evaluated against the parcel's physical attributes, location, and market data. Viable strategies are ranked with a specific offer range. Non-applicable strategies are noted with a brief reason.

The five strategies evaluated are:

- **Flip** — buy at discount, sell as-is or with minor improvements (clearing, driveway apron, perc test)
- **Subdivide by Right** — requires 5+ acres, sufficient road frontage, and permissive zoning
- **Land-Home Package** — requires half acre or more in a market where manufactured homes sell for $200–300K
- **Improvement then Flip** — when a specific improvement meaningfully increases value before sale
- **Novation / Double Close** — fallback for tight deals; operator markets the property transparently on behalf of the seller at an agreed price

A parcel can qualify for multiple strategies simultaneously. All offer ranges fall within the 40–60% of market value target, tightening based on the specific strategy's execution cost and expected return.

The DD Agent Opinion box states the recommended primary strategy, the offer range, and: *"If seller resists primary offer, consider [secondary strategy] at [adjusted range]."*

**Important:** This pre-call report uses a **mathematical offer range calculation** (comps → price-per-acre → 40–60% formula per strategy). It is not a deep underwriting judgment. The deep underwriting happens after the discovery call — see Section 5, Underwriting Agent.

---

## 5. The Agent Roster

The system operates with 14 specialized agents organized into four functional groups.

### The Orchestrator

**Executive Agent (`exec_bot`)**

The single point of contact for the operator. You never need to determine which agent to talk to — you communicate with the Executive Agent and it interprets your intent, routes the task to the correct department, and returns the result. It handles all voice interactions (async voice notes and live VoIP calls), manages multi-agent coordination, and serves as the daily interface for the entire system.

| Attribute | Detail |
| :--- | :--- |
| Default model tier | Tier 2 (standard routing) / Tier 3 (complex multi-department coordination) |
| Voice stack | `faster-whisper` (STT) + Kokoro TTS (TTS) + `PyAudio` (audio capture) |
| Telegram interface | `python-telegram-bot` — handles text, voice notes, and file attachments |
| VoIP interface | `pjsua2` (Python SIP library) or WebRTC via local Dashboard |
| Agent routing | Python dispatcher class — maps intent to agent module |
| Memory | Persistent context in `exec_memory.md` in R2 |

---

### The Acquisitions Pipeline

**Lead Manager (`lead_bot`)**

Handles the moment a form is submitted. Performs immediate triage: flags low-value infill lots where market value clearly cannot support a profitable offer (below ~$30–40K), and routes commercial properties with existing structures to a separate "Commercial Opportunity" column for potential partner referral. Vacant land with commercial zoning and no improvements goes through the standard pipeline. Sends the seller an automated acknowledgment via GHL.

| Attribute | Detail |
| :--- | :--- |
| Default model tier | Tier 1 |
| Trigger | GHL webhook POST to `/webhook/lead` (FastAPI) |
| Triage logic | Rule-based Python checks → agent reasoning for edge cases |
| GHL acknowledgment | GHL REST API v2 — creates contact note, triggers SMS workflow |
| Output | Lead record written to R2 `leads/{APN}/lead.json`, DD workflow triggered |

---

**Due Diligence Specialist (`dd_bot`)**

The data gatherer. Executes the full data pull, calculates the Land Score, runs radius-based comps, assembles the five-section briefing report, and exports it as a PDF to R2. Detects inherited property situations by comparing seller name against owner of record. The pre-call offer range calculation (40–60% formula per strategy) is performed here — this is a mathematical calculation, not a deep underwriting judgment.

| Attribute | Detail |
| :--- | :--- |
| Default model tier | Tier 2 (report generation) / Tier 1 (API data formatting) |
| Data source | Realie.ai + FEMA + NWI + USGS + Census |
| Comp source | Apify actors (Redfin, Zillow, LandWatch) via `apify-client` |
| Browser automation | Playwright (Python, async) with 3-interaction hard limit |
| Land Score calculation | Python scoring module (`land_score.py`) — deterministic rules |
| Report generation | Jinja2 → HTML → WeasyPrint PDF |
| Output | `reports/{APN}_{date}.pdf` written to R2, link pushed to GHL contact |

---

**Acquisitions Agent (`acquisitions_bot`)**

The sales intelligence layer and seller relationship expert. This agent knows everything about the sales process, human psychology, and the operator's specific communication style and language — front to back. It maintains a complete, evolving profile of every individual seller from the moment the lead arrives to the day the deal closes: motivation, timeline, price expectation, personality signals, communication history, and relationship dynamics.

When the CRM Success Manager flags that a seller needs attention, the Acquisitions Agent provides the *how* — not a generic response, but a tailored recommendation based on everything it knows about that specific person and where the relationship currently stands. It also prepares the pre-call brief before discovery and offer calls, summarizes calls from transcripts, and logs learnings after each debrief.

The distinction is clear: the CRM Success Manager says *"this seller needs follow-up."* The Acquisitions Agent says *"here is exactly what to say to this seller and why, based on everything we know about them."*

This agent is trained through a four-phase process: ingestion of all raw training material (MP3s transcribed via Whisper, existing transcripts), a foundation interview where the operator and agent work through the material together and establish override rules (inbound vs. outbound framing, close vs. wholesale preference), an ongoing post-call debrief loop, and periodic strategy reviews. It becomes smarter with every deal.

| Attribute | Detail |
| :--- | :--- |
| Default model tier | Tier 2 |
| Training material storage | R2 `training/raw/` (MP3s) + `training/transcripts/` (Whisper output) |
| RAG knowledge base | ChromaDB or LanceDB — indexes all transcripts for semantic search |
| Seller profile storage | `leads/{APN}/seller_profile.md` in R2 — updated after every interaction |
| Call transcript input | Whisper-transcribed `.txt` files from R2 |
| Call summary output | `calls/{APN}/summary_{date}.md` written to R2 |
| Learning log | `training/CallLearnings.md` in R2 — appended after each debrief |
| Seller Conversation Playbook | `playbook/AcquisitionsPlaybook.md` in R2 — living document, updated through onboarding conversation |
| Response drafts | Delivered to operator via Telegram or Dashboard for review before sending |

---

**Underwriting Agent (`uw_bot`)**

Performs the **deep underwriting review after the discovery call** — not before it. Reviews the Land Score Report, the discovery call summary, and any new information the seller disclosed. Synthesizes all available data to produce the final approved offer range and strategy recommendation that the acquisition person will use on the offer call. This is the only agent that can approve an offer going to a seller.

| Attribute | Detail |
| :--- | :--- |
| Default model tier | Tier 3 (always — financial stakes require best available reasoning) |
| Inputs | Land Score Report PDF (including parcel data, Land Score breakdown, comps table, and preliminary offer ranges), discovery call summary, seller profile, Seller Conversation Playbook |
| Output | `underwriting/{APN}/uw_decision_{date}.md` in R2 — approved offer range, final strategy, offer call talking points |
| Trigger | Manual trigger by operator after discovery call debrief |
| Probate / inherited property handling | Flags ownership chain complexity, recommends verification steps before going under contract |

---

### Operations and Dispositions

**CRM Success Manager (`success_bot`)**

The pipeline traffic controller. This agent's world is operational awareness across all leads — it has no opinion about how to talk to a seller, only about the state of every lead at all times. It monitors GHL daily, tracks every lead's stage and last touchpoint, identifies which sellers have not been contacted within the expected window, and flags stalled or at-risk deals before they go cold.

Every morning it delivers a prioritized daily brief to the acquisition person via Telegram: *"Here are the leads that need your attention today, where each one stands, and what the last touchpoint was."* It also tracks partner deals separately via the Dashboard manual intake, ensuring those do not fall through the cracks despite the lack of direct GHL access.

The CRM Success Manager surfaces *who* needs attention and *when*. The Acquisitions Agent then determines *how* to engage that specific seller.

| Attribute | Detail |
| :--- | :--- |
| Default model tier | Tier 1 |
| GHL data access | GHL REST API v2 — reads pipeline stages, contact activity, and last touchpoint timestamps |
| Partner deal tracking | R2 `leads/partner/` directory — manual intake records |
| Daily brief delivery | Telegram via `python-telegram-bot` — prioritized list of leads needing attention |
| Stall detection | Configurable windows per pipeline stage (e.g., no contact in 48 hrs = flag) |
| Schedule | Runs every morning via `APScheduler` (Python) |

---

**Transaction Coordinator (`tc_bot`)**

Manages the contract-to-close process. Tracks earnest money deadlines, title company communications, and closing timelines. Drafts status updates for private money lenders and flags any issues that could delay closing.

| Attribute | Detail |
| :--- | :--- |
| Default model tier | Tier 1 (deadline tracking) / Tier 2 (drafting lender updates) |
| Deal file storage | R2 `deals/{APN}/` — contracts, title docs, correspondence |
| Deadline tracking | `APScheduler` (Python) — calendar-based reminders to Telegram |
| Lender update drafts | Tier 2 model → Markdown draft → operator review before sending |

---

**Marketing Agent (`marketing_bot`)**

The in-house advertising department. Carries deep knowledge of Meta Ads (campaign structure, lead generation objectives, audience targeting, creative formats, compliance) and Google PPC (keyword strategy, match types, Quality Score, responsive search ads). Drafts ad copy, recommends budget allocation across the 8 core states based on Market Research Agent data, and delivers weekly optimization recommendations.

| Attribute | Detail |
| :--- | :--- |
| Default model tier | Tier 2 |
| Meta Ads data input | Meta Ads Manager export (CSV) or Meta Marketing API |
| Google Ads data input | Google Ads API or exported reports |
| Budget allocation input | Market Research Agent's County Scorecard from R2 |
| Output | `marketing/reports/{date}_optimization.md` in R2 + Telegram summary |
| Ad copy drafts | Stored in `marketing/copy/` in R2 for operator review |

---

**Dispositions Manager (`dispo_bot`)**

Drafts property listings and descriptions, analyzes the feasibility of land-home packages based on local manufactured home pricing data, manages buyer inquiries, and coordinates with the project manager on active manufactured home package deals.

| Attribute | Detail |
| :--- | :--- |
| Default model tier | Tier 2 |
| Listing platforms | Land.com, LandWatch, Zillow (manual post; agent drafts copy) |
| Manufactured home market data | Apify scraper or manual input of local MH pricing |
| Buyer inquiry management | GHL pipeline integration — dispo stage |
| Output | `dispositions/{APN}/listing_{date}.md` in R2 |

---

### Intelligence and Research

**Market Research Agent (`market_bot`)**

Evaluates counties against the seven-metric framework on demand or in batch scans. Maintains the County Scorecard in R2 — a growing proprietary database of every county ever analyzed. Alerts when a county currently receiving ad spend crosses a threshold in either direction.

| Metric | Target |
| :--- | :--- |
| Avg. Price Per Acre (2–5 Acres, 24 Mo) | Benchmarked per county |
| Population Density (statisticalatlas.com) | 50–150 per sq. mile |
| Days on Market (All Acreage, 90-Day) | Under 90 days |
| Absorption Rate (2–5 Acres, 90-Day) | Above 50% |
| Sales Density (All Acreage, 3-Year) | Above 400 transactions |
| For Sale Count (90-Day) | Tracked and benchmarked |
| Sell-Through Rate | Tracked and benchmarked |

| Attribute | Detail |
| :--- | :--- |
| Default model tier | Tier 2 |
| Data sources | Apify LandWatch actor (county-level data), Census API, statisticalatlas.com (constrained browser) |
| County Scorecard | `markets/county_scorecard.json` in R2 — updated after each analysis |
| Threshold alerts | Python comparison logic → Telegram alert via `python-telegram-bot` |
| Batch scan | Accepts a list of counties → parallel API calls → ranked output |

---

**Competitor Intelligence Agent (`spy_bot`)**

Monitors all available channels for each tracked competitor to maintain a complete picture of their strategy, messaging, and market activity.

**Monitored channels per competitor:**
- Meta Ad Library — current and historical ad creative, copy, and targeting signals
- Competitor website — messaging, seller offers, landing pages, any changes over time
- Facebook business page — posts, engagement, content strategy, new campaigns
- YouTube channel — video topics, frequency, subscriber growth, new strategies being taught
- Instagram — visual content, reels, stories (where present)
- LandWatch and Land.com listings — active inventory, pricing, markets being targeted

| Attribute | Detail |
| :--- | :--- |
| Default model tier | Tier 2 |
| Meta Ad Library | Playwright browser agent → Meta Ad Library public URL (no login required) |
| Website monitoring | Playwright → change detection via hash comparison of key pages |
| YouTube monitoring | YouTube Data API v3 (free, 10,000 units/day quota) |
| Facebook page monitoring | Playwright constrained browser agent |
| Listing monitoring | Apify LandWatch/Land.com actors |
| Output | `intelligence/competitor_brief_{date}.md` in R2 + bi-weekly Telegram delivery |
| Competitor list | `intelligence/competitors.json` in R2 — operator-maintained |

---

**AI Tech Researcher (`ai_bot`)**

Monitors the cutting edge of AI development and actively evaluates new findings against the current Land OS tech stack. Filters strictly for content relevant to: local model inference, agentic workflows, real-time audio processing, web scraping and data extraction, RAG and knowledge base systems, and API cost reduction. Ignores general AI news and hype. Can process YouTube video URLs via the Gemini API following the system's media processing rules.

**Monitored sources:**
- Reddit: r/LocalLLaMA, r/MachineLearning, r/ClaudeAI, r/ChatGPT, r/ollama, r/RealEstateTechnology
- Hugging Face: new model releases and leaderboard changes
- GitHub: trending repositories in relevant categories, explicitly monitoring `google-gemini/gemini-skills` for new API capabilities
- X (Twitter): curated list of AI researchers and practitioners (not mainstream accounts)
- arXiv: new papers on inference optimization, agentic systems, and audio processing
- YouTube: AI development tutorials and framework updates

| Attribute | Detail |
| :--- | :--- |
| Default model tier | Tier 2 |
| Reddit monitoring | Reddit API (`praw` Python library) |
| Hugging Face monitoring | Hugging Face Hub API (`huggingface_hub` Python library) |
| GitHub trending | GitHub REST API (`PyGithub` Python library) |
| X monitoring | X API v2 (filtered stream on curated accounts) |
| Stack comparison | Agent reads `tech_stack.md` from R2 and compares against new findings |
| Output | `intelligence/ai_brief_{date}.md` in R2 + twice-weekly Telegram delivery |

---

**Land Investing Research Agent (`research_bot`)**

Actively searches for emerging land strategies, unconventional deal structures, and creative exit options — not just mainstream land investing content. Follows practitioners on YouTube, Facebook, and X who are doing interesting things with land. Maintains and expands the **Strategy Library** in R2: a growing collection of documented exit strategies with notes on when they apply, requirements, and resources. 

Processes YouTube videos via the Gemini API following the system's media processing rules (transcript-first, escalating to video only on explicit approval).

When the DD Specialist or Underwriting Agent evaluates a parcel with unusual characteristics (transmission line easement, landlocked parcel, old structure, commercial zoning, utility corridor), it queries the Strategy Library for relevant options that might not be obvious from standard analysis.

**Monitored sources:**
- YouTube: land investing educators and practitioners (video summaries delivered without requiring the operator to watch)
- Facebook groups: land investing communities
- X: land investors and creative deal structurers
- BiggerPockets: land investing forums and blog posts

| Attribute | Detail |
| :--- | :--- |
| Default model tier | Tier 2 |
| YouTube monitoring | YouTube Data API v3 + Gemini API (`google-genai` SDK) for transcript extraction and video processing |
| Facebook monitoring | Playwright constrained browser agent (public groups only) |
| X monitoring | X API v2 filtered stream |
| BiggerPockets monitoring | Playwright constrained browser agent |
| Strategy Library | `research/strategy_library.md` in R2 — append-only, operator-reviewed |
| Output | `research/weekly_digest_{date}.md` in R2 + Friday Telegram delivery |

---

**System Health Agent (`sys_bot`)**

The DevOps watchdog and self-healing layer. Monitors all system components, attempts to auto-resolve minor issues, and alerts the operator immediately for anything it cannot fix on its own.

**What it monitors:**
- All external APIs (Realie.ai, Apify, FEMA, NWI, USGS, Census, GHL, Anthropic, OpenAI, Groq, Gemini)
- Ollama local inference — model availability and response time
- Cloudflare Tunnel uptime
- R2 storage accessibility and bucket integrity
- Agent output anomalies — if an agent stops producing expected outputs
- Dependency version updates for core libraries

| Attribute | Detail |
| :--- | :--- |
| Default model tier | Tier 1 |
| API health checks | Python `httpx` async pings on a schedule (`APScheduler`) |
| Ollama health check | Ollama REST API `/api/tags` endpoint |
| R2 integrity check | `boto3` list objects + hash verification of critical files |
| Auto-resolve actions | Restart Ollama models, clear temp caches, retry failed API calls (max 3 attempts) |
| Alert delivery | Immediate Telegram alert via `python-telegram-bot` for unresolved issues |
| Daily summary | `system/health_log_{date}.md` in R2 + morning Telegram summary |
| Schedule | Health checks every 15 minutes; full integrity scan every 6 hours |

---

## 6. Media Processing Rules

The Land OS interacts with significant amounts of audio and video content. To balance intelligence extraction with API costs, the system follows strict default rules for processing media. These rules are designed to use free or local resources wherever possible and reserve paid API calls for the one category where they genuinely cannot be replaced.

> **Model Currency Note:** The specific models named in this section reflect the best available options as of June 2026. The underlying routing logic — local-first, paid API only where irreplaceable — is permanent. The specific models are expected to be updated as better options emerge.

**Rule 1 — YouTube Videos (two modes based on content category):**

YouTube auto-captions are pulled first via `youtube-transcript-api` in all cases. What happens next depends on the content category:

- **Research / Strategy Content** (market analysis, deal structures, creative exit strategies, competitor watching, educational overviews): Auto-captions only. The value is in the information, not the delivery. Free, no API needed.

- **Acquisition Training Content** (seller conversations, objection handling, negotiation techniques, communication style, live call examples): Auto-captions are pulled first, then the audio is also processed via the Gemini API. The delivery, tone, pacing, and emotional signals are part of what is being studied — the same reason seller call recordings always get audio processing.

Content category is determined by one of two methods: (1) folder-based routing — anything added to `training/acquisition/` in R2 gets audio processing, anything added to `research/` gets transcript only; or (2) operator tag at time of ingestion — the operator tells the agent "process this for audio" and it routes accordingly. If the transcript contains visual reference signals (e.g., "as you can see here," "I'm showing this on screen"), the agent flags it and asks whether video processing is also wanted. The default answer is **no**.

**Rule 2 — Third-Party Training Content (MP3/MP4 — courses, podcasts, other investors' calls):** Transcribed locally and for free using **Gemma 4 E4B or 12B** via `llama.cpp` / Ollama. Gemma 4 has native audio ASR capability on these models and runs on the local machine at zero marginal cost. The transcript is then indexed into the RAG knowledge base.

**Rule 3 — Seller Call Recordings (MP3/MP4):** The only category that uses the Gemini API. Seller calls are ALWAYS processed as audio via `gemini-3.5-flash`. Tone, pacing, hesitation, and emotional signals are non-negotiable for acquisition training and cannot be captured by transcription alone. These are never processed as transcript-only. This is the sole category where the Gemini API cost is justified and irreplaceable.

**Rule 4 — Research Articles and PDFs:** Text only. No audio or video processing.

**Rule 5 — MP4 Defaults:** MP4 files default to audio-only processing unless explicitly tagged as `visual-content-required` in their R2 metadata. Audio-only processing is approximately 5x cheaper than full video processing.

**Rule 6 — Full Video Processing:** Rare. Requires explicit operator approval after the agent flags visual content in a transcript.

| Content Type | Processing Method | Tool | Cost |
| :--- | :--- | :--- | :--- |
| YouTube — research / strategy content | Auto-captions only | `youtube-transcript-api` (Python) | Free |
| YouTube — acquisition training content | Auto-captions + audio processing | `youtube-transcript-api` + Gemini API (`gemini-3.5-flash`) | Paid — ~$0.50/audio hour |
| Training MP3/MP4 (courses, podcasts) | Local ASR transcription | Gemma 4 E4B or 12B via Ollama / llama.cpp | Free |
| Seller call recordings (MP3/MP4) | Full audio understanding (tone + emotion) | Gemini API (`gemini-3.5-flash`) | Paid — ~$0.50/audio hour |
| Research articles / PDFs | Text extraction | Python (`pdfplumber`, `markdownify`) | Free |
| Full video processing | Frame + audio analysis | Gemini API (explicit approval only) | Paid — rare |

---

## 7. Conversational Training — The Acquisitions Agent

The Acquisitions Agent is an agentic, learning entity — not a static workflow script. It is trained through a structured four-phase process.

**Phase 1 — Ingestion:** Training materials are ingested according to the Media Processing Rules (Section 6). YouTube research and strategy videos use existing auto-captions only — free, no API needed. YouTube acquisition training videos (seller conversations, objection handling, live call examples) use auto-captions plus Gemini API audio processing, because the delivery and tone are part of what is being studied. Third-party training MP3/MP4s (courses, podcasts, other investors' recorded calls) are transcribed locally and for free using Gemma 4 E4B or 12B via Ollama. Seller call recordings are always processed as audio via the Gemini API to preserve tone, pacing, and emotional signals that transcription cannot capture. All resulting text is indexed into a RAG knowledge base using `chromadb` (local vector store, free) with `sentence-transformers` for embeddings (free, runs locally).

**Phase 2 — The Foundation Interview:** After ingestion, the agent conducts a structured back-and-forth conversation with the operator. The output is a **Seller Conversation Playbook** (`playbook/AcquisitionsPlaybook.md` in R2) that captures the operator's actual approach, including the critical override rules: all leads are inbound (not cold calls), the business closes on properties rather than wholesaling, and the opening framework differs from most training material which is outbound-oriented.

**Phase 3 — The Debrief Loop:** After every real discovery and offer call, the operator has a brief debrief conversation with the agent. Key learnings are appended to `CallLearnings.md` in R2. Over time, the operator's own call history becomes the most valuable training data in the system.

**Phase 4 — Strategy Reviews:** Periodically, the agent analyzes `CallLearnings.md` and proactively surfaces patterns and suggested playbook adjustments, initiating the conversation rather than waiting to be asked.

| Component | Tech Stack |
| :--- | :--- |
| YouTube transcript extraction | `youtube-transcript-api` (Python, free, no API key) |
| Local audio transcription (training content) | Gemma 4 E4B or 12B via Ollama / llama.cpp (free, local) |
| Seller call audio intelligence | Gemini API (`google-genai` SDK, `gemini-3.5-flash`) |
| Audio transcription (legacy fallback) | `faster-whisper` (Python, local) |
| Vector store / RAG | `chromadb` (local, free) + `sentence-transformers` (local embeddings) |
| Playbook storage | Markdown file in R2 (`playbook/AcquisitionsPlaybook.md`) |
| Call learning log | Markdown file in R2 (`playbook/CallLearnings.md`) |
| Debrief interface | Chat panel in Dashboard or Telegram |

---

## 8. Phase 2 — Real-Time Call Assistant (Teleprompter)

Once the Acquisitions Agent has mastered the operator's playbook, the system will be upgraded with a real-time teleprompter interface for live calls. Deferred to Phase 2 because the value of real-time suggestions depends entirely on the quality of the underlying playbook.

**How it works:** As the operator speaks with a seller, a small panel on the Dashboard surfaces context-aware suggestions in near-real-time (2–6 second lag). Suggestions are hyper-specific because the agent already knows the seller's full profile, motivation signals, and the operator's preferred approach for that situation.

| Component | Tech Stack | License | Cost |
| :--- | :--- | :--- | :--- |
| Real-time transcription | `faster-whisper` + `whisper-live` streaming | MIT / Apache 2.0 | Free |
| Speaker diarization | `pyannote.audio` + `diart` | MIT (free HuggingFace license) | Free |
| Audio capture | `PyAudio` / `sounddevice` (Python) | Free | Free |
| Agent inference | Ollama + Gemma 4 26B MoE | Apache 2.0 | Free |
| Teleprompter UI | React panel in Dashboard | Built-in | Free |

**Hardware note:** Running transcription, diarization, and a 26B MoE model simultaneously benefits from a GPU. An NVIDIA RTX 3060 or 4060 enables smooth real-time performance. The AI Tech Researcher will flag any improvements to this stack as they emerge from the open-source community.

---

## 9. Recommended Build Order

| Phase | Task | Key Tech |
| :--- | :--- | :--- |
| 1 | Set up local environment, GitHub repo, Cloudflare R2 bucket, `.env` secrets, Cloudflare Tunnel | Git, `cloudflared`, `boto3`, Python 3.11+, Node.js 22 |
| 2 | Build the System Health Agent — verify all APIs and connections before building on top of them | `httpx`, `APScheduler`, `python-telegram-bot` |
| 3 | Connect the data layer — Realie.ai, Apify actors, Federal APIs, seed County Data Source Map | `requests`, `apify-client`, Playwright, `county_sources.json` |
| 4 | Build the Executive Agent with voice interface and configure the Model Router | Ollama, Kokoro TTS, `faster-whisper`, `python-telegram-bot`, `model_config.yaml` |
| 5 | Build the Lead Manager and Due Diligence Specialist — core DD workflow and PDF report | FastAPI webhook, Pydantic, `land_score.py`, Jinja2, WeasyPrint |
| 6 | Build the Underwriting Agent — post-discovery deep underwriting | Tier 3 model config, R2 deal file integration |
| 7 | Conduct the Acquisitions Agent Foundation Interview — ingest training data, produce Seller Conversation Playbook | `faster-whisper`, `chromadb`, `sentence-transformers` |
| 8 | Connect GHL webhooks and build the CRM Success Manager | GHL REST API v2, `APScheduler`, Telegram alerts |
| 9 | Build the Market Research Agent and seed the County Scorecard for core 8 states | Apify, Census API, `county_scorecard.json` |
| 10 | Build the Marketing Agent and Dispositions Manager | Meta Marketing API, Google Ads API, Apify |
| 11 | Build the Competitor Intelligence Agent, AI Tech Researcher, and Land Investing Research Agent | YouTube Data API v3, Reddit `praw`, Hugging Face Hub API, X API v2, Playwright |
| 12 | Phase 2 — Implement the Real-Time Call Assistant (teleprompter) | `whisper-live`, `pyannote.audio`, `diart`, Ollama |

---

## 10. Estimated Monthly Operating Costs

| Service | Purpose | Tech | Estimated Cost |
| :--- | :--- | :--- | :--- |
| Realie.ai API | Core parcel data (owner, APN, size, coordinates, last sale) | REST API | ~$50.00/mo |
| Apify Actors | Redfin (owned) + Zillow + LandWatch comps | `apify-client` | ~$5.00/mo |
| Cloudflare R2 | Knowledge Base storage (~3–5GB) | S3-compatible, `boto3` | ~$0.05/mo |
| Cloudflare Tunnel | Remote Telegram / mobile access | `cloudflared` daemon | Free |
| Federal APIs | FEMA, NWI, USGS, Census | REST APIs | Free |
| Local Inference (Ollama) | Gemma 4, Llama 4 — Tier 1 and 2 tasks | Ollama | Free |
| Groq API | Llama 4 Scout — fast cloud Tier 2 overflow | `groq` Python SDK | ~$5.00/mo |
| Anthropic / OpenAI API | Claude Opus / GPT-5.5 — Tier 3 tasks only | `anthropic` / `openai` SDK | ~$10.00–$20.00/mo |
| Gemini API | Live voice (Exec Agent), media processing, YouTube summaries | `google-genai` SDK | ~$15.00–$30.00/mo |
| Kokoro TTS / Whisper | Local voice synthesis and transcription | Local Python libraries | Free |
| Twilio | Agent-initiated outbound calls only | Twilio Voice API | ~$1.00–$3.00/mo |
| YouTube Data API | Research and competitor monitoring | Google API | Free (10K units/day) |
| X API v2 | AI and research agent monitoring | X API | Free tier or ~$100/mo Basic |
| **Total Estimated** | | | **~$85.00–$110.00/mo** |

**Gemini API Cost Breakdown (June 2026):**
- Executive Agent voice (Gemini Live, `gemini-3.1-flash-live-preview`): ~$10–25/month (moderate use)
- Seller call audio processing (`gemini-3.5-flash`): ~$3–5/month (estimated ~6–10 hours of calls/month at ~$0.50/audio hour)
- YouTube summaries: **$0** — auto-captions pulled free via `youtube-transcript-api`
- Third-party training transcription: **$0** — handled locally by Gemma 4 via Ollama
- Training ingestion (one-time): ~$5–10 (seller calls only; everything else is free)

*Note: Gemini API costs will shift as Google updates pricing and as better local alternatives emerge. The AI Tech Researcher monitors for open-source models that could replace paid API calls.*

The majority of agent tasks run locally at zero marginal cost. The paid layer is limited to parcel data, comp scraping, and the occasional Tier 3 cloud model call for high-stakes decisions. The data layer is provider-agnostic — if a better or lower-cost parcel data provider emerges, replacing Realie.ai requires only a new adapter class and a one-line change in `data_sources.yaml`.
