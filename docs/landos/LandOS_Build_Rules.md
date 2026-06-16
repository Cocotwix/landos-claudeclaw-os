# LandOS Build Rules

Autonomy policy and safety rules for all LandOS build sessions.

---

## Autonomy Lanes

### Green Lane — proceed without stopping

- Inspect files, logs, git status, git log, git diff
- Read any repo file for context
- Run tests, typecheck, build
- Make scoped non-secret edits inside an approved mission
- Create LandOS docs and agent shell files scoped to the approved mission
- Run safe read-only verification checks

### Yellow Lane — proceed, then report

- Stage, commit, and push only after Tyler gives final approval
- No broad staging (never `git add .`)
- Report what you did and what the exact staged file list would be

### Red Lane — full stop, ask Tyler

- Read or print `.env`
- Print tokens, JWTs, API keys, credentials, or secrets of any kind
- Use `git add .` or stage unrelated files
- Delete files
- Reset, clean, or discard work
- Call paid APIs
- Call lp_comp_report_create or lp_comp_report_get
- Write property-specific work product into the repo
- Modify Land Ally systems, documents, workflows, or records
- Use worktrees without Tyler approval
- Dispatch subagents without Tyler approval
- Install packages
- Stage, commit, or push without Tyler's explicit approval

---

## Session Hygiene Rule

At the start of every LandOS build session, read:

1. `docs/landos/LandOS_Current_State.md` — latest commit, active issue, server status, next action
2. `docs/landos/LandOS_Active_Plans.md` — active and next plans
3. `docs/landos/LandOS_Project_Memory.md` — durable lessons and architecture decisions
4. `docs/landos/LandOS_Execution_Overlay.md` — execution guidance for CC and LandOS agent build sessions

Do not ask Tyler to re-explain what is already in these docs.

The Execution Overlay is execution guidance only. These Build Rules and all LandOS
hard rules override it. Property/parcel verification, secrets and repo safety, paid
tool and comp credit approval, destructive-command, and approval rules always
override the overlay; load it for posture, never to relax a hard rule.

---

## Agent View Rule

Before editing any agent file, read the current agent.yaml and CLAUDE.md for that agent.
Understand what exists before proposing changes.
Never overwrite an agent's CLAUDE.md without knowing what it contains.

---

## Worktree Rule

Do not use git worktrees in LandOS build sessions unless Tyler explicitly approves it for a specific session.

---

## Secrets and .env Rules

Never read or print `.env`.
Never print tokens, JWTs, API keys, credentials, Telegram tokens, dashboard tokens, Gemini keys, or LandPortal tokens.
Never commit or stage `.env`.
If a build step requires a secret to be checked, describe what is needed and ask Tyler to verify it themselves.

---

## Comp Credit Rule

Never call `lp_comp_report_create` or `lp_comp_report_get` unless Tyler explicitly approves spending one LandPortal comp credit in the same exchange.
Never test Duke's comp workflow against a real property without explicit Tyler approval.

---

## Property Work Product Boundary

The repo is for code, agent personas, MCP server code, safe config, and documentation only.
Business data stays in the Obsidian vault or local non-repo folders.

Never write into the repo:
- Property-specific DD reports
- Comp analyses
- Seller records, deal files, APNs, or addresses tied to real deals
- Private financial figures
- Raw training files
- Obsidian work product of any kind

---

## Commit and Staging Rules

Stage only the exact files approved by Tyler for the current commit.
Write clear commit messages scoped to the actual changes.
Do not stage logs, `.env`, Obsidian work product, temporary files, or unrelated changes.
Never commit or push without Tyler's explicit sign-off on the exact staged file list.
