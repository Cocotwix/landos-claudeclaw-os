# Forge Portability and Repo Strategy

Forge Core is universal. This first install lives inside the ClaudeClaw/LandOS repo so it can appear and operate in the current dashboard, but Forge is meant to outlive this repo and run inside any operating system Tyler builds.

---

## Why Portability Matters

- **ClaudeClaw** is only the first technical chassis.
- **LandOS** is only the first host operating system.
- Future hosts: TikTok Creator OS, Agency OS, Service Business OS, any future Tyler-built or non-ClaudeClaw AI operating system.

Forge should drop into any of these with minimal rework. The way to guarantee that is to keep Forge Core clean and push everything host-specific behind the Active Project Adapter.

---

## What Belongs in Forge Core (portable)

- Persona and identity (`CLAUDE.md`)
- Core policy (`Forge_Core_Policy.md`)
- The workflow rhythm (`Forge_Workflow.md`)
- All templates and checklists (interview, assumption summary, milestone review, QA, security, promotion)
- The Active Project Adapter *concept* (how to read and respect a host's rules)

## What Does NOT Belong in Forge Core (host-specific)

- Any specific host's business rules (LandOS property rules, Duke, LandPortal, comp-credit logic, land-investing logic)
- Host discovery wiring details (how a particular chassis lists agents)
- Host-specific secrets, config, or accounts

In this repo, those LandOS rules stay owned by LandOS docs and LandOS agents. Forge preserves them through the adapter; Forge is not them.

---

## Current Install Shape (ClaudeClaw chassis)

Forge is installed as a repo-backed agent at `landos-agents/forge/`, following this chassis's existing agent convention:

- `agent.yaml` with `name`, `description`, `telegram_bot_token_env`, `model`
- `CLAUDE.md` persona
- `docs/` for policy, workflow, templates, checklists

Discovery is automatic: the chassis scans `landos-agents/` (`listAgentIds()`), so Forge appears in the dashboard agent list with no code changes and no Telegram token value required. The `telegram_bot_token_env` key is present for schema compatibility; an empty value simply means Forge shows as a non-running agent, which is correct for a build department that operates inside Forge sessions rather than as a standalone Telegram bot.

---

## Extraction Path (later milestone)

When Forge graduates to its own repo:

1. **Create a standalone repo.** Candidate names: `universal-forge`, `forge-core`, `tyler-forge`.
2. **Move the portable set.** `CLAUDE.md` plus all of `docs/` become the core of the standalone repo. They are already written host-neutral.
3. **Define an adapter interface.** Each host OS provides a small adapter that tells Forge where the host's rules live and how the host discovers/registers agents. ClaudeClaw's adapter is the `landos-agents/<id>/` convention used here.
4. **Vendor or submodule into hosts.** Hosts pull Forge Core in by copy, git submodule, package, or vendor directory, then add their adapter.
5. **Keep one source of truth.** Improvements to Forge Core land in the standalone repo and propagate to hosts, instead of each host forking its own Forge.

---

## Design Rules That Keep This Cheap

- Write every Forge doc host-neutral. If a sentence only makes sense inside LandOS, it belongs in a LandOS doc, not a Forge doc.
- Never hardcode a host's domain concepts into Forge Core.
- Treat the chassis's discovery mechanism as an adapter detail, documented here, not as part of Forge's identity.
- Anything you would not want copied verbatim into a creator OS or agency OS does not belong in Forge Core.
