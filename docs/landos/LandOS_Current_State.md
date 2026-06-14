# LandOS Current State

Session start reference. Update via `/landos-done` at end of each session. No property-specific data here.

---

## Latest Commit

`377b185` Fix LandOS shell agent YAML descriptions (last pushed)

Branch: main
Origin: staged changes pending Tyler approval for Foundation Sprint v1 + Duke runtime-mode refactor commit.

---

## Active Build Issue

Duke dashboard address-only smoke test has timed out four times on a real address.
Root cause: Duke's CLAUDE.md was too large (~2,700 lines loaded as system prompt on every turn).
Fix status: Duke runtime-mode refactor complete (2026-06-13). Files written, not yet committed.
Next step: Tyler approves commit, then smoke test to confirm Fast Default under 2 minutes (up to 3 minutes acceptable).

---

## Server Status

ClaudeClaw runs locally at `http://localhost:3141`. Server must be restarted to pick up new `/api/landos/*` routes and new agent folders. Tyler approves restarts.

---

## Known Untracked Files (not staged)

- `landos-agents/ClaudeClaw_Mark_Install_and_Update_Workflow_Fork_Upstream_Git_Pull.txt`
- `landos-agents/acquisition-copilot/.no-avatar`
- `start.bat`

---

## Current Active Agents

| Agent ID | Display Name | Status |
|---|---|---|
| main | Main Agent (LandOS) | Active |
| acquisition-copilot | Ace Acquisition Co-Pilot | Active |
| duke-due-diligence | Duke Due Diligence Agent | Active |

---

## New Shell Departments (this sprint)

| Agent ID | Display Name | Status |
|---|---|---|
| strategy | Strategy Agent | Shell created -- agent.yaml + CLAUDE.md |
| marketing | Mia Marketing & Lead Gen | Shell created -- agent.yaml + CLAUDE.md |
| dispositions | Drew Dispositions | Shell created -- agent.yaml + CLAUDE.md |
| transaction-coordination | TC Transaction Coordination | Shell created -- agent.yaml + CLAUDE.md |
| finance | Finn Finance & Risk | Shell created -- agent.yaml + CLAUDE.md |
| security | Security Agent | Shell created -- agent.yaml + CLAUDE.md |
| ai-watcher | AI Watcher | Shell created -- agent.yaml + CLAUDE.md |

---

## Foundation Sprint v1 Status

All sprint deliverables complete (2026-06-13). Pending Tyler approval to stage and commit.

| Deliverable | Status |
|---|---|
| Memory loop docs (Current State, Build Rules, Project Memory, Active Plans) | Done |
| sessions/ folder + README | Done |
| LandOS_Skill_Registry.md | Done |
| LandOS_Agent_Department_Index.md | Done |
| 7 department shell agent folders | Done |
| 3 Claude Code slash commands (landos-start, landos-done, landos-status) | Done |
| Build verification | Passes (npm run build clean) |

---

## Next Exact Action

1. Tyler approves staging and commit for Foundation Sprint v1 + Duke runtime-mode refactor (two commits or one combined commit -- Tyler decides).
2. Restart ClaudeClaw so dashboard picks up new agent folders and Duke's slim CLAUDE.md.
3. Run Duke smoke test: submit an address-only input in the dashboard, confirm Fast Default Report under 2 minutes (up to 3 minutes acceptable) with Read of duke-fast-default.md as the first action.
4. If smoke test passes: mark Duke runtime-mode refactor complete in LandOS_Active_Plans.md.
