# LandOS — Master Architecture (Source of Truth)

LandOS is the operating system for a land‑investing business. It is **not** a
Duke‑centric tool. Duke is one lane — the **Due Diligence Specialist**. The
center of the system is:

```
Executive Agent  →  Department Agents  →  Deal Cards  →  R2 Knowledge Layer  →  Provider Abstraction Layer
```

This document is the governing reference. Code may implement these ideas with the
best available approach; where this doc and the code disagree, the **intent** here
governs and the code is reconciled to it.

> Stack note: LandOS is implemented primarily in **Node/TypeScript** (the working
> foundation: agent SDK, Hono API, Preact/Vite dashboard, grammy Telegram, Pipecat
> voice, ~1,000 tests). The Vision document's Python/FastAPI/boto3 suggestions are
> honored by *intent* (local‑first, provider‑agnostic, privacy‑separated, tiered
> models) using first‑class Node equivalents. A thin Python sidecar is reserved
> only for local audio (Whisper/Kokoro) and local embeddings/RAG, and only when
> those phases arrive.

---

## 1. System layers

| Layer | Role | Implementation |
| :-- | :-- | :-- |
| Executive Agent | Single point of contact; interprets intent, routes to a department, returns results; voice + Telegram + dashboard | `src/landos/executive-orchestrator.ts` (wraps duke‑router / mission / delegate) |
| Department Agents | 14‑agent roster across 4 groups | `src/landos/agent-roster.ts` |
| Deal Cards | **Property‑level system of record** | `src/landos/deal-card*.ts`, `landos_deal` / `landos_comp` / property cards in SQLite |
| R2 Knowledge Layer | Business artifacts + agent knowledge/memory; streamed on demand | `src/landos/knowledge-store.ts` (local‑fs impl now; R2/S3 impl later) |
| Provider Abstraction | Swap data/model providers by config + adapter | models: model‑router (→ ClaudeClaw provider engine, Pass 3); data: `src/landos/providers/data-registry.ts` |

---

## 2. Storage boundaries (non‑negotiable)

- **SQLite (`store/claudeclaw.db`, `better-sqlite3`)** — *operational/transactional
  state only*: deals, comps, pipeline/Kanban, audit, cost records, approvals,
  model preferences, security reviews. Fast, ACID, local.
- **R2 Knowledge Layer** — *business artifacts and knowledge*: Discovery reports
  (MD/PDF), call transcripts, seller profiles, agent knowledge folders, County
  Scorecard, Strategy Library, playbooks. Privacy‑separated, zero‑egress.
- **GitHub repo** — *code only*. No business data, no secrets, no property work
  product. `.env` is gitignored and never synced.

R2 path conventions (see `knowledge-store.ts`):

```
agents/{agentKey}/knowledge/…     agents/{agentKey}/memory/…
reports/{apn}/…                   leads/{apn}/…            deals/{apn}/…
underwriting/{apn}/…              calls/{apn}/…
markets/county_scorecard.json     playbook/…               training/…
intelligence/…                    research/strategy_library.md
```

---

## 3. Deal Card attachment policy

Deal Cards are the property‑level system of record. Output routing rule
(codified in `deal-card-attachment-policy.ts`):

- **Property‑specific output → attaches to the Deal Card** for that parcel
  (DD facts, comps, Land Score, underwriting decision, call summaries, listing
  drafts, TC milestones).
- **Business / market / competitor / AI‑research / system output → does NOT
  attach to a Deal Card** — it lands in the R2 knowledge layer (e.g.,
  `markets/`, `intelligence/`, `research/`, `system/`) — **unless** it is tied to
  a specific property (e.g., a market pulse generated *for a parcel* attaches; a
  county‑wide scorecard does not).

---

## 4. The 14‑agent roster (4 groups)

**Orchestrator:** Executive Agent (`exec_bot`).
**Acquisitions pipeline:** Lead Manager (`lead_bot`), Due Diligence Specialist
(`dd_bot`, = Duke), Acquisitions Agent (`acquisitions_bot`), Underwriting Agent
(`uw_bot`).
**Operations & dispositions:** CRM Success Manager (`success_bot`), Transaction
Coordinator (`tc_bot`), Marketing Agent (`marketing_bot`), Dispositions Manager
(`dispo_bot`).
**Intelligence & research:** Market Research (`market_bot`), Competitor
Intelligence (`spy_bot`), AI Tech Researcher (`ai_bot`), Land Research
(`research_bot`), System Health (`sys_bot`).

Each agent carries: role, group, default model tier, knowledge path, memory
path, Deal‑Card attachment class, and a build status (`active | scaffold |
planned`). See `agent-roster.ts` for the authoritative table.

---

## 5. Discovery workflow (preserved)

```
Lead → DD Report → Discovery Call → Underwriting → Offer
Lead → DD Report → Discovery Call → Deeper DD → Underwriting → Offer   (alternate)
```

- **DD Report** (pre‑call): the existing one‑button Property Analysis — verify →
  source‑only DD facts → Market Pulse → comps → Land Score → six strategy lanes
  (mathematical 40–60% offer ranges) → verified Deal Card → Markdown + PDF. This
  is *not* deep underwriting.
- **Underwriting** (post‑call): the only offer approver (Tier‑3). Consumes the
  Deal Card + discovery‑call summary + any new disclosures → final approved offer
  range + strategy + talking points (`underwriting/{apn}/…`).
- **Deeper DD** (optional branch): a second DD loop when the discovery call
  surfaces new facts before underwriting.

Hard rules retained: no score/value/offer on an unverified parcel; identity only
from named sources (never coordinates/proximity); no fabricated data; provisional
comps never become subject comps until verification.

---

## 6. Provider abstraction

- **Model providers** — tiered routing (local‑first, cloud fallback). Migrates
  onto the ClaudeClaw provider engine in Pass 3; until then the existing
  model‑router / neutral model system stands.
- **Data providers** — `data-registry.ts` exposes `parcel | comps | crm | market`
  adapters, each normalizing to one internal schema. The current **LandPortal**
  integration is *wrapped* as the `parcel` adapter; a **Realie.ai** adapter stub
  sits behind the same interface, selectable by config — no agent/workflow change
  to swap. No live/paid calls are made from a stub.

---

## 7. Build status & remaining work

In place after this pass: architecture, shell, routing, storage boundaries,
provider abstraction layer, dashboard structure, Deal Card architecture, 14‑agent
roster, R2 integration scaffolds, memory architecture, workflow foundations, and
the safe upstream ClaudeClaw improvements.

Remaining (out of scope here, by design): external credentials/accounts (R2,
Realie.ai, Apify, GHL, model providers), agent‑specific training content (RAG
corpus, seller profiles, playbooks), the SDK 0.3 + provider‑engine integration
(Pass 3, risk‑isolated), and future deep specialization of each department.
