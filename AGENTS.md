# ⛔ DO NOT STOP ON PARTIAL LANDOS WORK — OWNER-FACING COMPLETION GATE

**THE PRIMARY IMPLEMENTING AGENT MUST NOT STOP, PAUSE FOR A STATUS REPORT, SWITCH TO COSMETIC/TECHNICAL WORK, OR CLAIM ANY DEGREE OF COMPLETION WHILE ANY OWNER-REQUESTED, DECISION-CRITICAL FRONT-END RESULT IS MISSING, UNUSABLE, OR NOT PERSONALLY VISUALLY VERIFIED END TO END. KEEP WORKING THE REAL OPERATING WORKFLOW UNTIL THE LIVE CARD OR WORKFLOW ACTUALLY SHOWS EVERY REQUESTED RESULT WITH REAL EVIDENCE AND USABLE BUSINESS OUTPUT. A PARTIAL WALKTHROUGH, A CORRECTED UI DEFECT, BACKEND PROGRESS, A WARNING/PLACEHOLDER, OR AN EXPLANATION OF WHAT IS MISSING IS NOT A VALID STOPPING POINT. ONLY A REQUIRED NEW AUTHORITY OR A REAL EXTERNAL BLOCKER MAY PAUSE THE WORK; IN THAT CASE, REPORT THE EXACT VISIBLE BLOCKER—NEVER A SUCCESS.**

# 🚨 LANDOS FRONT-END ACCEPTANCE RULE — NON-NEGOTIABLE

**FOR EVERY LANDOS BUILD, FIX, FEATURE, OR WORKFLOW, THE PRIMARY IMPLEMENTING AGENT MUST SYSTEMATICALLY OPEN, VISUALLY INSPECT, AND FUNCTIONALLY EXERCISE EVERY RELEVANT OWNER-FACING SECTION OF THE ENTIRE CHANGED CARD OR WORKFLOW IN `http://localhost:3141`. VERIFY EACH SECTION IS USABLE END TO END WITH REAL OPERATING DATA AND ACTUAL RETURNED BUSINESS OUTPUT. DO NOT CLAIM COMPLETION FROM BACKEND RESULTS, A PARTIAL WALKTHROUGH, OR A SINGLE WORKING SECTION. IF EVERY RELEVANT FRONT-END SECTION HAS NOT BEEN VISUALLY RE-CHECKED, THE WORK IS INCOMPLETE.**

# LandOS Agent Runtime Rules

## Fresh-session bootstrap

This is the LandOS repository. Before LandOS work, load first
`.landos/PERMANENT_MEMORY.md` and `.landos/CHECKPOINT.md`; they are the
compact automatic operating memory and current checkpoint. Inspect live disk
state because it outranks stale checkpoint implementation facts. Preserve
unrelated dirty work. Retrieve detailed history only when relevant with
`npm run landos:memory:retrieve -- <task-specific query>`.

After that compact bootstrap, immediately inspect any live files, runtime
state, provider wiring, browser state, or operating records needed to deliver
the requested outcome. The compact bootstrap is not a restriction on relevant
investigation or execution.

The primary database is `store/landos.db`; detailed reports are under
`docs/landos/`. Neither is automatically loaded or queried.

## Owner-visible acceptance is the completion authority

For every LandOS build, fix, feature, department, or workflow change, backend
work is only implementation progress. Tests passing, a successful build, API
responses, database rows, logs, HTTP 200, planned provider paths, queued jobs,
and automated assertions can never establish completion by themselves.

After implementation and restart, the **primary implementing agent must
personally control the visual browser**, open the managed operator site at
`http://localhost:3141`, enter the changed workflow through the normal
owner-facing navigation, physically click its controls, run the real workflow
end to end, and visually inspect the resulting screen and business output. Do
this for every changed segment, regardless of department or technical scope.

The personal visual check must prove the requested business outcome, not merely
that UI elements exist. Use a real existing operating record when the workflow
depends on real data. If the workflow invokes browser research or another
agent, observe the actual work occur and verify the returned facts, artifacts,
screenshots, documents, and other useful results on the correct owner-facing
record. A provider name, plan, status row, count, placeholder, warning, or
missing-data message is not proof that the provider work occurred.

Independent browser QA may supplement this check, but it never replaces the
primary agent's personal visual walkthrough. Do not make a completion claim
until both the implementation and the personally observed live workflow are
correct and usable. If the live workflow cannot be completed, the work remains
incomplete; report the exact visible blocker instead of claiming success.

## Canonical Windows runtime

Use only: `npm run landos:status`, `landos:start`, `landos:stop`,
`landos:restart`, `landos:logs`, and `landos:health`.

Runtime state and stdout/stderr live under `.runtime/landos/`; application
logs remain in `logs/main.log`. Use `status` for ownership, `start` only
when stopped, `restart` after a rebuild, `stop` for verified shutdown,
`health` for bounded automation, and `logs` for diagnostics.

Do not run `node dist/index.js` as a foreground long-running command, pipe
inline Node launchers through stdin, kill generic Node processes, use unbounded
polling, or improvise restart commands. If process control fails with `EPERM`,
rerun the same canonical command with approved permission.

## Outcome-first execution; internal process is secondary

The requested owner-visible business outcome controls sequencing and effort.
Internal ledgers, staged workstreams, evidence bookkeeping, automated QA, and
review commands are optional support tools. Use them only when they materially
help deliver or protect the real outcome. They must never delay the actual
workflow, consume the majority of a session, force work onto the wrong scope,
or serve as the reason for a completion claim.

When a sprint ledger already exists, preserve it and record useful proof where
practical, but do not optimize the work around passing its gates. A ledger may
say complete while the product remains incomplete. Owner-visible usability and
the mandatory personal browser walkthrough always outrank internal status.

## Existing connected providers are authorized

Ordinary in-scope use of providers already configured in LandOS is authorized,
including existing authenticated browser sessions and configured APIs such as
Realie.ai. Do not ask for separate permission merely to use an existing
connection to perform the requested workflow. Let the application consume its
configured credentials through the existing secret-loading path.

Environment files and stored credentials are **read only**. An agent may
securely read and use an existing credential from `.env` when an explicitly
approved local LandOS workflow requires it, including signing into LandPortal
through the visible browser. An agent must never:

1. Modify `.env` or any stored credential unless Tyler explicitly directs that
   exact change.
2. Print, echo, display, summarize, or reveal a secret value.
3. Include a credential in a response, report, screenshot, terminal output, log,
   test fixture, browser console output, source file, prompt, commit, or
   documentation.
4. Copy a secret into another file, or expose it through command arguments where
   it may be recorded.
5. Commit or push `.env` or any secret.
6. Send a credential to an unapproved external service.

Reading a credential privately and entering it into its intended approved login
form is permitted. The secret value must remain concealed throughout the
operation.

Approval is still required before creating a new paid account, purchasing
credits or reports, upgrading a plan, initiating an unapproved charge, changing
credentials, or adding a new secret. Existing normal provider usage is not a
new purchase. LandPortal API documentation and API/MCP use are intentionally
absent/off-limits for now; authenticated LandPortal browser use remains allowed.

## Live-local finish requirement

After tests and build, restart if needed, confirm `localhost:3141` responds,
perform the mandatory personal visual walkthrough above, and report the exact
workflow exercised, visible business result, current server PID, and exact URL.
Do not leave LandOS stopped.

## Output discipline

Keep implementation in the repository. Do not print full source files, full schemas, large diffs, or lengthy implementation output into chat. Edit and inspect files directly. Use brief progress checkpoints only. Store detailed implementation notes and continuation state in a repository worklog if needed. The final response must be a concise report referencing file paths, test results, live URLs, blockers, and remaining work.
