# LandOS Governance

These documents prevent memory drift and architectural drift. They are concise, current, and useful — not a documentation project.

## Authority hierarchy
1. **[00_Founder_Vision.md](00_Founder_Vision.md)** — Tyler's original LandOS Vision. The founder's product constitution and **highest authority**. Never rewritten without Tyler's explicit instruction.
2. **[05_Operating_Charter.md](05_Operating_Charter.md)** and **[07_Product_Principles.md](07_Product_Principles.md)** — founder-controlled operating doctrine.
3. **[01_Vision.md](01_Vision.md)** — lightweight Vision pointer/navigation (founder-controlled).
4. Implementation-maintained: **[02_Decision_Log.md](02_Decision_Log.md)**, **[03_Roadmap.md](03_Roadmap.md)**, **[04_Architecture.md](04_Architecture.md)**, **[06_Build_Journal.md](06_Build_Journal.md)**.

## Ownership / update rules
- **Founder-controlled** (00, 01, 05, 07): CC may recommend improvements but **never modifies without Tyler's approval**.
- **Implementation-maintained** (02, 03, 04, 06): CC keeps current as the project evolves, committed when major business milestones complete.

## Reading the Vision
- **Foundational product decisions** (Deal Card philosophy, dashboard-first, living OS, Discovery workflow, DD philosophy, capabilities, operator experience) are stable.
- **Implementation examples** in the Vision (providers, APIs, AI models, storage, browser agents, infra — Realie, R2, Claude, OpenAI, Gemini, Ollama, OpenRouter, LM Studio, vLLM, Python/FastAPI, …) reflect the implementation at writing time and are **not permanent requirements**. The capability is permanent; the provider is replaceable. LandOS owns business capabilities, not vendors.

## Execution policy (working-product mode, 2026-06-27)
LandOS is in working-product mode. Configured operational providers may be used to complete approved business milestones without per-step approval. **Required protections only:** (1) protect Tyler's local machine from security risks / harmful commands, (2) protect `.env` and all keys/secrets, (3) no deletion or destructive action without Tyler's approval, (4) no irreversible data loss. Otherwise, the agent builds. Log provider usage, avoid runaway loops and duplicate calls, preserve provenance. Realie is call-budgeted; everything else configured (Apify Redfin, Google Maps/Street View/Static Maps, free government APIs) is approved for normal operational use. See Decision Log → "Execution policy — working-product mode".

## Governance workflow
Before every major bundled implementation sprint, synchronize against: (1) Founder Vision, (2) Operating Charter, (3) Product Principles, (4) Decision Log, (5) Roadmap, (6) Architecture, (7) current implementation, (8) latest Build Journal entry. Do not re-introduce per-call paid-approval friction — working-product mode is the standing policy.
