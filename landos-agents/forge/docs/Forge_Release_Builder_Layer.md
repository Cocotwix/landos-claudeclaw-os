# Forge Security and Release Builder Layer

This layer is what makes Forge a builder and architecture operator rather than a
planning assistant. Forge builds as far as is safely possible, stops only at
true owner-owned gates, and returns a completed-product handoff with an
approve / tweak / reject / hold decision.

Engine: `src/forge/release.ts` (pure Forge Core — deterministic, dependency-
free, host-neutral, business-neutral, text/JSON only). It never executes,
connects, deploys, subscribes, pushes, reads `.env`, or touches secrets.

---

## What Forge returns on a completed build

1. What was built
2. What works
3. How to test / demo it
4. What is blocked only because it needs owner-owned keys/accounts/subscriptions/approval
5. What the owner must supply
6. Whether it is ready for local use, review, staging, or production
7. Owner options: approve, tweak, reject, or hold

---

## Security / release gate classifier

`classifySecurityGates(rawRequest)` separates work into release lanes, ordered
least-to-most restrictive. The overall lane is the most restrictive gate found.

| Lane | Meaning |
|---|---|
| `forge_safe` | No owner gate. Forge builds and verifies locally. |
| `owner_setup_required` | Forge builds; owner must supply accounts/config before it works end to end. |
| `release_approval_required` | Forge builds and prepares; release/push/deploy needs owner approval. |
| `blocked_until_credentials` | Code can be written, but it stays blocked from running end to end until the owner supplies credentials. |
| `never_automate` | Forge will not perform it (destructive / real customer data). Owner handles directly. |

Owner-owned gates detected: API keys, OAuth credentials, billing/subscription,
production deploy, domain/DNS, email/SMS provider, database credentials, real
customer data, account connections, push/release approval, destructive actions,
secret handling, paid APIs/tools. Output is metadata only.

---

## Generators (all text only)

- **Owner setup checklist** — `generateSetupChecklist()`. What the owner must
  supply: accounts, billing, OAuth redirect, webhooks, domain/DNS, `.env` keys
  as `.env.example`-style placeholders. Never emits real secrets; never reads
  `.env`.
- **Demo / trial runbook** — `generateDemoRunbook()`. How to start the app,
  where to open it, what to click, the expected result, what an error means
  (missing owner setup), what is safe to test locally, and what not to test
  without approval. Host-neutral.
- **Completion report** — `generateCompletionReport()`. The "Forge built it,
  owner decides" artifact: built / works / files / tests / security gates /
  owner setup / demo steps / limitations / release readiness / owner decision.

---

## Owner decision loop

A saved engagement carries an `ownerDecision`: `pending`, `approved`,
`tweak_requested`, `rejected`, or `hold`. The host endpoint
`PATCH /api/forge/engagements/:id/decision` records it; the `/forge` UI shows it
in the detail and history. Recording a decision is a host record update — it
never triggers any action.

---

## Host adapter endpoints (this host)

All generate/record only. None execute, connect, subscribe, deploy, push, or
read secrets.

- `POST /api/forge/security-check`
- `POST /api/forge/setup-checklist`
- `POST /api/forge/demo-runbook`
- `POST /api/forge/completion-report`
- `PATCH /api/forge/engagements/:id/decision`

Each accepts either explicit fields or a saved engagement `id` (the server pulls
the stored request). See `Forge_Host_Adapter_Layer.md` for the Core/Adapter
boundary; the classifier and generators are Core, the routes/store/UI are host.
