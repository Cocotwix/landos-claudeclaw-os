# Forge Universal Department Agent Profile Standard

This is the universal standard Forge uses to build department agents for any host operating system. It is industry-neutral. It applies in every host Forge runs inside, now or later. Host-specific detail is supplied through the interview and stays with the host, not in this standard.

Engine: `src/forge/agent-profile.ts`. Neutrality guard: `src/forge/neutrality.ts`.

---

## 1. Core concept

Forge builds department agents. A department agent belongs to a host operating system. Each department agent needs a profile before it becomes active.

A profile is the operating contract for that agent. It states the agent's mission, the input it takes, the actions it may perform automatically, the actions that require owner authority, its tools, its memory and storage boundaries, how it is verified, how it hands off, how it appears on the dashboard, how it is activated, audited, and rolled back, and how the owner approves its work.

The standard stays universal. It carries positive defaults that fit a department agent in any business operating system. Concrete, business-specific detail comes from the interview and is poured into the profile by the operator.

---

## 2. The profile fields

Every department-agent profile defines the following fields. The builder fills any field the operator leaves unset with a universal, industry-neutral default.

| Field | Meaning |
|---|---|
| Agent name | Stable lower-kebab slug identity. |
| Display name | The human-facing name shown on the dashboard. |
| Department | The department this agent owns. |
| Primary mission | One line: what the agent is for. |
| Normal owner input | The everyday requests the owner gives it. |
| Automatic actions | What it may do automatically inside the safe lane. |
| Live-action authority | Whether the owner scoped and authorized live external actions, and which ones. |
| Hard stops | Actions that always require an explicit owner decision. |
| Allowed tools | The exact tools it may use. |
| Cost rules | How it treats cost and paid capability. |
| Memory boundaries | What it may remember and what it must keep out. |
| Output format | How it formats what it returns. |
| Storage behavior | Where and how it may write. |
| Verification rules | How it proves its own work before reporting done. |
| Handoff rules | How it passes work to another department agent. |
| Dashboard behavior | How it appears and behaves on the host dashboard. |
| Activation mode | sandbox, assisted-live, or live. |
| Audit expectations | What it records for audit. |
| Rollback expectations | How its actions can be undone. |
| Pass / fail test | The concrete check that proves it works. |
| Owner approval loop | How the owner approves, tweaks, rejects, or holds its work. |

---

## 3. Authority model

Forge may build agents, integrations, workflows, dashboards, automation managers, communication systems, and external-platform tooling end to end. Forge may also build the authorization model, sandbox mode, live mode, audit logs, rollback path, and owner controls those agents need.

Live external actions are allowed only when the responsible agent has been explicitly scoped and authorized by the owner. Until that authorization exists, Forge builds the capability, runs it in sandbox with test data, and presents the activation steps for owner approval.

This rule is enforced in code. `buildAgentProfile` forces the activation mode to `sandbox` whenever live actions are unauthorized, and `deriveAuthorityModel` reports the effective mode plus everything gated until the owner authorizes it. A requested `live` or `assisted_live` mode takes effect only once the owner sets `authorized: true` and names the approved live actions.

---

## 4. Activation modes

| Mode | Meaning |
|---|---|
| `sandbox` | The agent runs locally on test data. No live external action. The default for any unauthorized agent. |
| `assisted_live` | The agent prepares live actions and runs them with an owner in the loop on each one. |
| `live` | The agent runs its scoped, approved live actions on its own, inside the authorized set, with every hard stop still gated. |

An agent can only reach `assisted_live` or `live` after the owner scopes and authorizes its live actions.

---

## 5. Universal defaults

When a field is left unset, the builder applies a positive, industry-neutral default. The defaults cover hard stops, cost rules, memory boundaries, output format, storage behavior, verification rules, handoff rules, dashboard behavior, audit expectations, rollback expectations, and the owner approval loop. They describe a safe, reviewable department agent for any host and carry no business-, industry-, or customer-type-specific detail.

The defaults keep an agent inside the safe lane by default: it reads no secrets, spends no money, connects no private accounts, performs no destructive action, releases nothing outside the safe lane, sends no real external communication, and touches no real customer or production data without an owner decision.

---

## 6. The build flow

1. **Interview.** `generateAgentInterview` produces a questionnaire whose sections map one-to-one onto the profile contract: identity, input and actions, authority and activation, tools and cost, memory and storage, output and verification, handoff/dashboard/audit, and the owner approval loop.
2. **Profile.** The operator pours the answers into `buildAgentProfile`, which normalizes identity and fills any gaps with universal defaults.
3. **Authority model.** `deriveAuthorityModel` states the requested mode, the effective mode, the approved live actions, and everything gated until authorization.
4. **Build packet.** `generateAgentBuildPacket` renders one owner-reviewable document: profile, dashboard behavior, permissions, authority model, tool plan, memory rules, output rules, storage rules, test plan, activation checklist, and owner decision options.
5. **Owner decision.** The owner chooses approve, tweak, reject, or hold.

---

## 7. Build packet sections

The build packet is the single artifact the owner reviews. It contains:

1. Profile
2. Dashboard behavior
3. Permissions (automatic vs owner-gated)
4. Authority model
5. Tool plan
6. Memory rules
7. Output rules
8. Storage rules
9. Test plan
10. Activation checklist
11. Owner decision options

---

## 8. Neutrality protection

Forge core, generated output, and this standard stay universal and industry-neutral, and they describe Forge in positive language.

`src/forge/neutrality.ts` provides `scanForNeutralityIssues`, a deterministic guard that flags two things: defining Forge or an agent by negation, and business-, industry-, or legacy-project-specific terms. The patterns are narrow on purpose so a precise technical caveat is left alone.

`src/forge/neutrality.test.ts` runs the guard over Forge's generated output and over this document, so a future edit cannot quietly reintroduce a business-specific example or negative self-framing.

---

## 9. Host adapter boundary

The pure core lives in `src/forge/agent-profile.ts` and `src/forge/neutrality.ts`: deterministic, dependency-free, host-neutral, text and JSON only. Persistence, routing, and UI stay in the host adapter (`src/dashboard.ts`, `web/`). The dashboard exposes generate endpoints for the interview, the profile, and the build packet, and the `/forge` page lets the owner generate them from a request. Generation only: nothing here runs, connects, deploys, subscribes, pushes, sends, or reads secrets.
