# LandOS Handover

**Project:** LandOS
**Purpose:** shared LandOS operating memory for the current LandOS build.
**Last updated:** 2026-07-04

## Current Status

LandOS Acquisition Specialist operator acceptance is in progress. The current
frontline blocker is not Smart Intake or Property Resolution; it is the
dashboard-visible Property Card experience.

The real dashboard database is `store/landos.db`. The current operator
acceptance property has a verified Property Card and a weaker duplicate created
by earlier raw-intake runs. Property identifiers are intentionally not repeated
in repo memory; use the database for exact values when needed.

## Last Completed Work

- Smart Intake was changed from autocomplete-driven intake to raw lead intake.
  Autocomplete is no longer authoritative and must not rewrite submitted input.
- Property Resolution remains responsible for normalization, ambiguity, browser
  escalation, and parcel identity.
- Reusable Property Inspection, Comparable Intelligence, Market Intelligence,
  and Discovery Call Intelligence were implemented structurally and exercised
  against the real dashboard-backed workflow.
- The latest operator acceptance sprint found that storage and dashboard UI
  were out of alignment: persisted inspection/discovery output existed in the
  real store, but Tyler could not see it reliably in Property Board.
- Cross-session memory infrastructure was added for Claude Code, Codex, and
  ChatGPT Project continuity:
  `/continue-landos`, `/done-landos`, `/operator-qa`,
  `/business-qa`, `LANDOS_CURRENT_STATE.md`, `.landos/CHAT_CONTEXT.md`,
  `.landos/CONTINUITY_PROTOCOL.md`, `.landos/OPERATOR_QA.md`,
  `.landos/BUSINESS_QA.md`, `.landos/CURRENT_SPRINT.md`,
  `.landos/KNOWN_LIMITATIONS.md`, and `docs/reference-ui/`.
- Governance was reset to autonomy by default. Only secrets, `.env`, API keys,
  passwords, paid APIs, external accounts, money, destructive deletes,
  `git push`, and deployments remain approval gates.

## Current Dashboard State

- Real dashboard DB: `store/landos.db`.
- A verified operator-facing card exists for the current acceptance property.
- A weaker unverified duplicate exists or existed for the same normalized lead.
- Tyler observed the verified card still showing stale Duke/LandPortal credit UI
  and missing the new operator-facing inspection/discovery workspace.
- Next sessions must verify the actual browser UI, not only code paths or
  in-memory tests.

## Active Blockers

| Blocker | Classification | Notes |
|---|---|---|
| Property Board does not yet feel like a usable acquisition workspace | UI wiring / UX | Needs large readable card, operator language, visual sections, comps, market, discovery brief. |
| Duplicate cards can confuse the operator | Persistence/UI list policy | Keep verified APN/property card operator-facing; suppress or merge weaker duplicate. |
| Old Duke/LandPortal credit UI appears in the new flow | Stale UI / component wiring | Remove or hide old paid-credit language in Property Board flow. |
| Dashboard may serve stale bundle/backend after builds | Server state | Restart or verify the real server route after build. |
| Business QA not yet rerun after the dashboard workspace is fixed | Business QA | Acquisition Specialist is not production-useful until Tyler can use the real Property Card for discovery-call prep. |

## Next Exact Task

Finish the dashboard-visible Property Card sprint for the current operator
acceptance property:

1. Inspect `web/src/pages/PropertyBoard.tsx` and related API routes.
2. Confirm real `store/landos.db` contains inspection assets, overlays,
   normalized comps, Market Intelligence, and Discovery Call Intelligence.
3. Render those sections visibly in Property Board.
4. Suppress the weaker duplicate when a verified same-property card exists.
5. Remove old Duke/LandPortal credit UI from this flow.
6. Rebuild and verify the real dashboard browser route.
7. Record the result in `.landos/OPERATOR_QA.md`.
8. Evaluate Acquisition Specialist in `.landos/BUSINESS_QA.md`.

## What Not To Repeat

- Do not rely on Vitest in-memory harnesses as proof that Tyler can see output.
- Do not stop at "code exists"; verify the real dashboard UI.
- Do not stop after engineering QA; Operator QA and Business QA are required.
- Do not let Smart Intake suggestions rewrite or gate raw operator input.
- Do not call LandPortal paid/credit-consuming endpoints.
- Do not write real property identifiers or private deal work product into repo
  memory.

## Latest Commits

Use `git log --oneline -5` at session start. Do not assume this file has the
latest commit hash.

## Session Log

### 2026-07-04 - Cross-Session Continuity Setup

- Added LandOS-native continuation/closeout/operator-QA command prompts.
- Added continuity protocol and operator QA ledger.
- Added `docs/reference-ui/` for redacted UI acceptance artifacts.
- Preserved existing LandOS governance, architecture, product principles, and
  build rules.
- No commit made.
