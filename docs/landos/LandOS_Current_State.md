# LandOS Current State

Session start reference. Update via `/done-landos` when current state changes.
No property-specific private data here.

---

## Latest Commit

Use `git log --oneline -5` at session start. Do not rely on this file for the
latest hash.

Branch: main.

## Governance

Default is autonomy.

Only approval gates:

- secrets
- `.env`
- API keys/passwords
- paid APIs
- external accounts
- money
- destructive deletes
- `git push`
- deployments

Everything else is approved for autonomous execution inside the active mission.

## Active Build Issue

The current Acquisition Specialist sprint is blocked at dashboard-visible
Property Card usability. Smart Intake and Property Resolution are no longer the
frontline blocker.

## Dashboard State

ClaudeClaw/LandOS runs locally from the repo and uses `store/landos.db` for the
real dashboard-backed LandOS state. Local server restarts and local dashboard
verification are autonomous execution work when needed to complete a sprint.

## Current Active Agents

| Agent ID | Display Name | Status |
|---|---|---|
| main | Main Agent (LandOS) | Active |
| acquisition-copilot | Ace Acquisition Co-Pilot | Active |
| duke-due-diligence | Duke Due Diligence Agent | Active |

## Current Sprint

See `LANDOS_CURRENT_STATE.md`, `.landos/CURRENT_SPRINT.md`, and
`.landos/CHAT_CONTEXT.md`.

## Required Session Loop

1. Use `/continue-landos`.
2. Continue from the stored next exact task.
3. Run engineering QA.
4. Run Operator QA.
5. Run Business QA.
6. Update `LANDOS_CURRENT_STATE.md`, `.landos/CHAT_CONTEXT.md`,
   `.landos/HANDOVER.md`, `.landos/OPERATOR_QA.md`,
   `.landos/BUSINESS_QA.md`, and `.landos/CURRENT_SPRINT.md`.

## Next Exact Action

Finish the dashboard-visible Property Card workspace for the Acquisition
Specialist acceptance sprint, then verify the real dashboard and update QA
memory.

