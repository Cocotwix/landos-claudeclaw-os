# Forge Portability and Repo Strategy

Forge Core is universal. This first install lives inside the current host's repo so it can appear and operate in the current dashboard, but Forge is meant to outlive this repo and run inside any operating system the owner builds.

---

## Why Portability Matters

- The current runtime is only the first technical chassis.
- The current host is only the first host operating system.
- Future hosts: any operating system the owner builds, in any industry or domain.

Forge should drop into any of these with minimal rework. The way to guarantee that is to keep Forge Core clean and push everything host-specific behind the Active Project Adapter.

---

## What Belongs in Forge Core (portable)

- Persona and identity (`CLAUDE.md`)
- Core policy (`Forge_Core_Policy.md`)
- The workflow rhythm (`Forge_Workflow.md`)
- All templates and checklists (interview, assumption summary, milestone review, QA, security, promotion)
- The Active Project Adapter *concept* (how to read and respect a host's rules)

## What Does NOT Belong in Forge Core (host-specific)

- Any specific host's business rules (the active host's domain logic and business-specific agents)
- Host discovery wiring details (how a particular chassis lists agents)
- Host-specific secrets, config, or accounts

The host's business rules stay owned by that host's docs and agents. Forge respects them through the adapter and keeps its core universal.

---

## Current Install Shape

Forge is installed as a repo-backed agent at `landos-agents/forge/`, following this chassis's existing agent convention:

- `agent.yaml` with `name`, `description`, `telegram_bot_token_env`, `model`
- `CLAUDE.md` persona
- `docs/` for policy, workflow, templates, checklists

Discovery is automatic: the chassis scans `landos-agents/` (`listAgentIds()`), so Forge appears in the dashboard agent list with no code changes and no Telegram token value required. The `telegram_bot_token_env` key is present for schema compatibility; an empty value simply means Forge shows as a non-running agent, which is correct for a build department that operates inside Forge sessions rather than as a standalone Telegram bot.

---

## Extraction Path (later milestone)

When Forge graduates to its own repo:

1. **Create a standalone repo.** Candidate names: `universal-forge`, `forge-core`, `forge-os`.
2. **Move the portable set.** `CLAUDE.md` plus all of `docs/` become the core of the standalone repo. They are already written host-neutral.
3. **Define an adapter interface.** Each host OS provides a small adapter that tells Forge where the host's rules live and how the host discovers/registers agents. The current host's adapter is the `landos-agents/<id>/` convention used here.
4. **Vendor or submodule into hosts.** Hosts pull Forge Core in by copy, git submodule, package, or vendor directory, then add their adapter.
5. **Keep one source of truth.** Improvements to Forge Core land in the standalone repo and propagate to hosts, instead of each host forking its own Forge.

---

## Design Rules That Keep This Cheap

- Write every Forge doc host-neutral. If a sentence only makes sense inside one host, it belongs in that host's doc, not a Forge doc.
- Never hardcode a host's domain concepts into Forge Core.
- Treat the chassis's discovery mechanism as an adapter detail, documented here, not as part of Forge's identity.
- Anything you would not want copied verbatim into another host operating system does not belong in Forge Core.
