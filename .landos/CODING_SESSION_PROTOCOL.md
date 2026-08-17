# LandOS Coding-Agent Operating Contract

Canonical contract for every coding agent here. Highest doctrine: where any
command, subagent file, document, or note disagrees, this file wins. Invariants
live in `PERMANENT_MEMORY.md`; the Control DB is canonical development state and
generated `STATE.md` is its active human-readable handoff.
This file defines how an agent starts, scopes, executes, stops, verifies, and
hands off.

## 1. Authority order

1. This contract.
2. `.landos/PERMANENT_MEMORY.md` invariants.
3. Live Git `main` for accepted source and
   `<Git common dir>/landos/control/landos-control.db` for canonical development
   tasks, attempts, failures, evidence, verification, and acceptance. The Git
   common directory makes this one physical database across all worktrees.
4. Live repository, working tree, and managed-runtime state.
5. Generated `.landos/STATE.md` human-readable handoff.
6. Everything else: the compatibility `CHECKPOINT.md` pointer, commands, subagent files,
   `docs/landos/`, history files.

The working tree and live in-scope evidence outrank any narrative in a memory
file, report, or prior summary. `docs/landos/` is reference, never doctrine.

## 2. Required startup

1. Read the agent bootstrap file (`AGENTS.md` or `CLAUDE.md`).
2. Read this contract, `.landos/PERMANENT_MEMORY.md`, and `.landos/DEVELOPMENT_CONTEXT.md`.
3. Regenerate and read `.landos/STATE.md` with
   `npm run landos:control -- state generate` when Development Control has been
   initialized for the repository.
4. Run `git status --short`.
5. Inspect only files named by the generated state or the accepted request.
6. Confirm the minimum runtime state the task needs.
7. Begin the generated state's Next action, or the accepted request.

Never automatically audit the repository broadly, or reread browser
infrastructure, workspaces, database architecture, old checkpoints, session
logs, unrelated providers, or the tree. Expand only when the checkpoint is
missing or stale, a named file is gone, live state materially conflicts with it,
or task evidence proves another dependency is required; state the reason first.

## 3. Scope

The accepted request defines scope; its named outcome and the checkpoint's
Relevant Files are the boundary. Make the smallest dependency-complete change
repairing the demonstrated defect class at its shared root. Repairing that root
is required; broadening into unrequested cases, surfaces, or subsystems is not.
Anything outside the boundary is recorded, not built: put it in Remaining Work
with enough detail to reproduce, and carry on.

## 4. Stop conditions

Stop and report instead of continuing when any of these is reached.

1. **Scope expansion.** A change would touch a file, subsystem, or requirement
   not named in the accepted request or the checkpoint's Relevant Files. Record
   it as deferred; do not build it.
2. **Adjacent defects.** A defect outside the accepted request. Record it with
   repro steps. Repair it this session only when it blocks demonstrating the
   accepted outcome. "Internally fixable defects are never externally blocked"
   governs honesty about blockers; it never converts a deferred defect into
   required work.
3. **Speculative work.** Before adding abstraction, generalization, a config
   surface, retry or fallback machinery, a framework, or regression
   infrastructure the accepted outcome does not require. Build for the
   demonstrated case, not an anticipated one.
4. **Repeated diagnostics.** One focused diagnostic pass per question; a second
   requires stating why the first was insufficient. Never re-derive anything in
   Completed and Proven, Completed and Protected, or
   `.landos/capabilities.json`. Changing method for a still unanswered research
   question, as section 9 requires, is a different method, not a repeat pass,
   and this never stops it.
5. **Disproportionate acceptance.** The change class's tier in section 5 has
   passed. Escalating a tier requires a stated reason.
6. **Re-proving accepted behavior.** Frozen capabilities and checkpoint-protected
   behavior are re-proven only on a verified regression, approved
   enhancement, or changed shared dependency path.
7. **Operator acceptance.** Tyler states the outcome is accepted. The task is
   closed: no polish, no follow-on fixes, no further verification. Update the
   checkpoint and report; reopening requires a new instruction.
8. **Next sprint.** Never begin the next task, sprint, or planned build
   automatically, even when the checkpoint names one.

An approval gate or real external blocker also stops work. Report the exact
visible blocker, never success.

## 5. Proportionate acceptance

Acceptance work is set by change class, not habit.

**Tier 1, no owner-visible change** (internal refactor, tests, comments, docs):
focused tests plus typecheck. No production build, no restart, no browser.

**Tier 2, one owner-visible section or control**: Tier 1 plus production build,
managed restart, and the primary agent personally exercising it
through normal owner navigation on real operating data. Verify refresh
persistence when anything is persisted.

**Tier 3, multiple sections, a new workflow, or a frozen-capability path**:
Tier 2 plus independent browser QA on the changed journeys, reruns of the
protected journeys that `capability touched` names, and final review.

Use the sprint ledger only for a sprint with more than two real workstreams;
below that it is overhead and must not be created.

The live operator-facing result is the acceptance authority at every tier.

Screenshots are required only when capture does not activate the operator's
Chrome; when it would, a named page-text or DOM read suffices and must be
recorded as the evidence taken. No gate may demand unobtainable
evidence: state the substitution rather than silently waiving the check.

## 6. Approval gates

Stop and ask Tyler only for: secrets, `.env`, API keys, passwords; paid APIs,
credit-consuming endpoints, purchases, billing, subscriptions, ads, contracts;
new external accounts or service connections; mutation of external systems;
destructive deletes, resets, cleans, arbitrary SQL, or irreversible data loss;
`git push`; deployment.

Do not invent additional gates. Everything else inside the accepted request
proceeds without asking; existing configured providers are authorized for
ordinary in-scope use. Preserve uncommitted and unrelated work at all times. Do
not commit unless the task asked for one, never stage broadly, and never stage
`.env`, secrets, logs, or private property work product.

## 7. LandOS runtime is not development time

The managed runtime and the agent's development and acceptance effort are
different and never substitute for each other.

Runtime control uses only `npm run landos:status`, `landos:start`,
`landos:stop`, `landos:restart`, `landos:logs`, and `landos:health`. Runtime
state lives under `.runtime/landos/`; application logs stay in `logs/main.log`.
Do not run `node dist/index.js` in the foreground, pipe inline Node launchers
through stdin, kill generic Node processes, poll without bound, or improvise a
restart. On `EPERM`, rerun the same canonical command with approved permission.
Do not leave LandOS stopped.

A healthy server, successful restart, and HTTP 200 are preconditions for
acceptance, never progress, never evidence of the requested outcome, and never a
reason to keep working. Development effort is bounded by the accepted request,
not the product's uptime.

## 8. Source of truth

1. Live repository files and this governance; Git `main` is accepted source.
2. `<Git common dir>/landos/control/landos-control.db` for the one shared
   development-control state across every worktree and provider.
3. `store/landos.db` for local business state; it is never merged with the
   development-control database.
4. Official, source-labeled provider data.
5. The checkpoint, for narrative handoff context.
6. Prior session summaries, only after checking live files.

Only the Development Control Spine Integration Gate may write `ACCEPTED`, and
it may do so only for an exact verified commit promoted to its authority ref.
PASS, reviewer approval, and worker completion are not acceptance. Both PASS
and FAIL remain durable control records. `.landos/STATE.md` is regenerated from
canonical control state plus live Git and is never manually maintained truth.

Tool output is evidence, not governance. Visual evidence is intelligence, not
verification. This ranking orders authority over LandOS state; it never limits
which external sources may answer a research question; section 9 governs that.

## 9. Research answers are evidence-weighted, not perfection-gated

LandOS returns the best reasonably supported answer available, with transparent
sourcing and honest confidence, rather than withholding it because perfect
official verification was unavailable. It governs every research lane without
exception, current and future. A failed source path is not a failed research
question; change the discovery method instead of giving up.

**Required fallback, every time, every lane.** When the normal path cannot
answer, run this before reporting anything negative.

1. Retry the blocked route once, only if plausibly useful, then leave it. Never
   spend the session on one blocked route.
2. Bring up the dedicated LandOS browser and confirm it is usable:
   `npm run landos:browser status`, then `start`. It is a separate profile from
   the operator's Chrome.
3. Google the actual question in plain English, as an operator would type it.
4. Read the results, open the promising pages, follow useful links and citations
   out of them.
5. Reword or re-aim the search until the best reasonably supported answer is
   in hand.

Never return search unavailable, could not find it, unknown, or any equivalent
until that procedure has actually been run.

**Blocked search engine.** On an explicit CAPTCHA or anti-bot challenge you get
one more attempt or two minutes, whichever comes first, then switch immediately
to another engine, a direct source, or a reputable secondary source and continue
the same question there.

**Tool use is not scope expansion.** Using, starting, restarting, reconnecting,
or switching among approved LandOS research tools and browsers is part of the
research. Building or redesigning new tooling is scope expansion and stops under
section 4.

Prefer the stronger, more direct source whenever reasonably obtainable, and use
a secondary source to locate a primary one. Reputable secondary sources may
carry a final answer: a credible search result, snippet, headline, secondary
page, article, or forum answer on a reputable domain is usable evidence when it
reasonably appears to answer the question.

**Explicitly rejected.** No agent, prompt, code path, or document may
reintroduce these: only official sources count; a snippet, headline, or
secondary source can never support a final answer; an answer must reach perfect
or "100% source of truth" verification before LandOS may use it.

**Evidence standard.** Carry every answer at one weight. *Confirmed*: strong,
direct evidence. *Well supported*: good evidence makes it very likely correct.
*Likely*: the best reasonably available evidence supports it without stronger
primary verification. *Unresolved*: only when the fallback above genuinely ran
and still produced no defensible answer. Do not inflate confidence or default
to paralysis; Unresolved is the last weight, never the safe one.

**Source transparency.** Name the source that carried the answer, state its
weight, and say plainly whether it is primary/official, reputable secondary, or
search-result evidence. Upgrade the weight when a stronger source appears;
keep the prior history.

**Not relaxed.** Parcel identity stays a hard gate: `PERMANENT_MEMORY.md`
invariants 2-4 are unchanged, so no weight below Confirmed establishes parcel
identity, a geocode never verifies a parcel, and facts from another property are
never evidence for the subject. This section governs how LandOS answers a
question, never which parcel it answers about. Section 6 gates and the safety
invariants are unchanged.

## 10. Parallel read-only investigations

Use parallel read-only agents when independent questions materially shorten
diagnosis; give each a distinct, non-overlapping question. They inspect and
report, never redesigning the task or producing competing fixes. Only the
primary agent modifies files, data, runtime, or browser state unless Tyler
authorizes otherwise, and it integrates every finding into one implementation.

## 11. Handoff and reporting

After a meaningful sprint, completed task, direction change, or session close,
persist the lifecycle facts in the canonical Control DB, then run
`npm run landos:memory:checkpoint` and `npm run landos:memory:audit`. The
checkpoint command regenerates `.landos/STATE.md`; `.landos/CHECKPOINT.md` is a
static compatibility pointer and `.landos/verification-results.json` is
non-authoritative compatibility history. Never copy prompts, transcripts, raw
logs, browser output, or secrets into any handoff projection.

**Clean up before reporting complete.** Every agent and automation lane here,
Claude Code, Codex, Hermes, and browser automation alike, closes what it opened.
At the end of a sprint or build, close every browser tab the session opened,
including the duplicate LandOS, LandPortal, Zillow, Redfin, county and GIS,
search, and testing tabs it created, and stop leftover watchers, test processes,
and temporary browser sessions no longer needed. Never close a tab that was
already open before the session unless it clearly belongs to the dedicated
LandOS automation browser. Leave the dedicated browser and the managed runtime
available for LandOS, but clean, carrying no unnecessary tabs; section 7 still
forbids leaving LandOS stopped. The sprint is not complete, and must not be
reported complete, until this cleanup is done.

Keep implementation in the repository; never print full source files, schemas,
or large diffs into chat. The final report states what changed, files
changed, tests and builds run, the acceptance tier and its result, blockers
fixed, any remaining blocker, and the next exact task. Say plainly what was
skipped and why, and never claim more than the evidence supports.
