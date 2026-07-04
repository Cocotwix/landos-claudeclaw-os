# LandOS Governance

These documents prevent memory drift and architectural drift. They are concise,
current, and useful - not a documentation project.

## Authority Hierarchy

1. **[00_Founder_Vision.md](00_Founder_Vision.md)** - Tyler's original LandOS
   Vision. The founder's product constitution and highest authority.
2. **[05_Operating_Charter.md](05_Operating_Charter.md)** and
   **[07_Product_Principles.md](07_Product_Principles.md)** - operating
   doctrine.
3. **[01_Vision.md](01_Vision.md)** - lightweight Vision pointer/navigation.
4. Implementation-maintained:
   **[02_Decision_Log.md](02_Decision_Log.md)**,
   **[03_Roadmap.md](03_Roadmap.md)**,
   **[04_Architecture.md](04_Architecture.md)**,
   **[06_Build_Journal.md](06_Build_Journal.md)**.

## Autonomy Standard

Default is autonomy.

LandOS, Claude Code, Codex, future ClaudeClaw-based systems, and future build
agents continue until the business outcome is complete.

The only approval gates are:

- secrets
- `.env`
- API keys
- passwords
- paid APIs
- external accounts
- money
- destructive deletes
- `git push`
- production deployments or deployments

Everything else is approved for autonomous execution inside the current mission.

## Completion Standard

An implementation sprint is not complete until:

1. Engineering QA is complete or blocked by a true approval gate.
2. Operator QA verifies the real operator surface.
3. Business QA confirms the department/employee creates measurable business
   value.
4. Session memory is updated with the next exact task.

Passing tests alone is not completion.

## Reading the Vision

Foundational product decisions are stable: Deal Card philosophy,
dashboard-first operation, living OS behavior, Discovery workflow, DD
philosophy, capabilities, and operator experience.

Implementation examples in the Vision reflect the implementation at writing
time and are not permanent requirements. The capability is permanent; the
provider is replaceable. LandOS owns business capabilities, not vendors.

## Governance Workflow

Before major implementation sprints, synchronize against:

1. Founder Vision
2. Operating Charter
3. Product Principles
4. Decision Log
5. Roadmap
6. Architecture
7. Current implementation
8. `LANDOS_CURRENT_STATE.md` and `.landos` operating memory

Do not reintroduce approval-drip, micro-prompts, or premature stopping.

