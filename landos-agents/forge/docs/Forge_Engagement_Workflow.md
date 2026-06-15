# Forge Engagement Workflow (Operator Guide)

This is how Tyler turns a raw build request into a structured Forge engagement
artifact. Milestone 1 gave Forge its identity and docs. Milestone 2 makes it
operational: a runnable workflow with a safe/stop lane gate and a reviewable
Markdown output.

The engine is a pure, dependency-free module: `src/forge/engagement.ts`. It has
no network calls, no `.env` reads, no secrets, and writes no files. It is
business-neutral and host-agnostic, so it can later move into a standalone
forge-core repo unchanged.

---

## How to start an engagement

From the repo root, pass the raw request to the CLI. It prints the engagement
artifact to stdout; redirect to a file to save it for review.

```bash
# Dev (no build step needed)
npx tsx src/forge/engagement-cli.ts "Add a date helper to src/utils with a test"

# With a label and host
npx tsx src/forge/engagement-cli.ts --title "Date utils" --host "LandOS on ClaudeClaw" "Add a date helper with a test"

# Read the request from stdin
echo "Add a logging helper and a test" | npx tsx src/forge/engagement-cli.ts --stdin

# Save the artifact for later review
npx tsx src/forge/engagement-cli.ts "..." > forge-engagement.md

# After a build (dist/)
node dist/forge/engagement-cli.js "..."
```

If the lane gate returns STOP, the artifact still prints (it is valid output),
and the CLI also writes a one-line `[forge] Lane gate: STOP ...` note to stderr
so the gate is impossible to miss.

---

## The lane gate (safe vs stop)

Every request runs through `classifyLane()`, which scans for Tyler-owned
red-lane triggers and returns:

- **SAFE** — no red-lane trigger detected. Forge can build inside its
  repo-local lane with normal operator judgment.
- **STOP** — a Tyler-owned decision is involved. Forge does not build it until
  Tyler decides.

The gate is a **conservative triage aid, not a security boundary**. STOP is
intentionally over-eager (better to ask Tyler than to act unasked). SAFE means
"no trigger matched" — the operator still applies judgment.

### Red-lane stop list (Tyler-owned)

A request stops if it touches any of these:

| Category | Examples it catches |
|---|---|
| Secrets / credentials | secret, credential, password, API key, JWT, auth token, `.env` |
| Paid tools / paid APIs | paid api, paid tool, metered, OpenRouter, Fusion, pay per/for |
| Subscriptions / billing | subscription, billing, invoice, credit card, upgrade plan |
| Private account connection | connect/link my account, log in to, OAuth, private account |
| Destructive / file deletion | delete, rm -rf, drop table/schema, truncate, wipe, destroy, overwrite, purge |
| Broad repo rewrite | rewrite the whole repo, refactor everything, mass rename/rewrite |
| Git push / deploy | git push, push to origin/main, force push, deploy to prod |
| Financial / legal platform | Stripe, bank account, wire money, payment processor, DocuSign |
| Dependency install | npm install, yarn add, install a package/dependency |

The list lives in one place in code (`RED_LANE_RULES` in
`src/forge/engagement.ts`) so it stays the single source of truth.

---

## The artifact: four output formats

A Forge engagement produces one Markdown artifact built from four structured
pieces:

1. **Engagement Request** — Tyler's raw ask plus optional title and host.
   This is the input. Keep it in plain words; the workflow does the structuring.

2. **Assumption Summary** — what Forge heard, the objective, in/out of scope,
   assumptions, expected files, risk gates (auto-filled from the lane gate),
   the success check, and the exact Tyler decisions needed before building.
   Operator fields are pre-stubbed with `(operator: ...)` prompts to fill in.

3. **Milestone Build Plan** — the objective, the lane verdict, the ordered
   build steps (a STOP request gets a leading "STOP: resolve the Tyler-owned
   decision first" step), expected files, and the guardrails.

4. **Review Packet** — the Security, QA, and Promotion checklists scoped to
   this engagement, each pointing at the canonical Forge checklist doc.

The rendered artifact walks the full Forge rhythm: Lane Gate → Interview →
Assumption Summary → Milestone Build Plan → Review Packet → Tyler Direction
Review → Next Milestone.

---

## Bundling and checkpoint rules (baked into every plan)

Every build plan carries two guardrails, so Forge stays useful instead of
turning into approval spam:

- **Bundle safe work.** Group safe repo-local work into one cohesive milestone.
  Do not ask for approval per command for ordinary safe work (reading,
  searching, writing approved artifacts, tests, builds, typechecks).
- **Ask at real checkpoints only.** Ask Tyler at genuine business-direction
  checkpoints: red-lane gates, paid-tool decisions, secrets, destructive
  changes, external account connections, git push, or a major architecture
  tradeoff. Not for every safe command.

---

## Sample artifact (abridged)

Input:

```
npx tsx src/forge/engagement-cli.ts "Add a date helper to src/utils with a test"
```

Output (trimmed):

```markdown
# Forge Engagement — Forge: Add a date helper to src/utils with

**Lane verdict:** SAFE

## Lane Gate
No red-lane trigger detected. Safe to build inside Forge's repo-local lane.

## 2. Assumption Summary
**Objective:** Add a date helper to src/utils with a test.
**Risk gates:**
- None detected by the lane gate.
**Tyler decisions needed before build:**
- None required to start safe-lane work.

## 3. Milestone Build Plan
**Steps:**
1. Inspect the active project's conventions first (Active Project Adapter).
2. Confirm the Assumption Summary with Tyler for anything non-trivial.
3. Build the approved scope as one cohesive milestone.
...
```

A STOP example (`"Add the Stripe API key and git push to main"`) flags three
Tyler-owned categories (secrets, financial platform, git push), lists them as
risk gates and required decisions, and prepends a STOP step to the build plan.

---

## Tests

The workflow is covered by `src/forge/engagement.test.ts`:

```bash
npx vitest run src/forge/engagement.test.ts
```

It proves SAFE vs STOP classification across every red-lane category, multi-
category detection, matched-text reporting, deterministic rendering, the full
set of artifact sections, and business-neutrality (no host-domain leakage).

---

## Not in this milestone (next up)

Dashboard UI wiring for a one-click Forge engagement kickoff was intentionally
deferred to keep this milestone small and avoid touching large, fragile
dashboard files. That is the recommended Milestone 3. For now the engagement
runs via the CLI above.
