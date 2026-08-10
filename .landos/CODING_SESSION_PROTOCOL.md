# LandOS Coding-Agent Operating Contract

This is the canonical operating contract for Codex, Claude Code, Hermes, and
future coding agents working in this repository. It is the highest agent
doctrine: where any command, subagent file, document, or historical note
disagrees with it, this file wins.

Stable domain and safety invariants live in `PERMANENT_MEMORY.md`. The single
active handoff lives in `CHECKPOINT.md`. This file defines how an agent starts,
scopes, executes, stops, verifies, and hands off.

## 1. Authority order

1. This contract.
2. `.landos/PERMANENT_MEMORY.md` invariants.
3. `.landos/CHECKPOINT.md` active handoff.
4. Live repository, working tree, and managed-runtime state.
5. Everything else: commands, subagent files, `docs/landos/`, history files.

Treat the current working tree and live in-scope evidence as authoritative over
any narrative in a memory file, report, or prior session summary. Files under
`docs/landos/` are reference material, never doctrine.

## 2. Required startup

1. Read the repository's agent bootstrap file (`AGENTS.md` or `CLAUDE.md`).
2. Read this contract.
3. Read `.landos/PERMANENT_MEMORY.md`.
4. Read `.landos/CHECKPOINT.md`.
5. Run `git status --short`.
6. Inspect only files explicitly named in the checkpoint or the accepted
   request.
7. Confirm the minimum runtime state the task actually needs.
8. Begin the checkpoint's Exact Next Action, or the accepted request.

Do not automatically perform a broad repository audit. Do not automatically
reread the browser infrastructure, every workspace, the database architecture,
old checkpoints, session logs, unrelated providers, or the repository tree.

Broader inspection is allowed only when the checkpoint is missing or stale, a
named file no longer exists, live state materially conflicts with the
checkpoint, or direct task evidence proves another dependency is required.
State the specific reason before expanding.

## 3. Scope

The accepted request defines scope. Its named outcome and the checkpoint's
Relevant Files are the boundary.

Make the smallest dependency-complete change that repairs the demonstrated
defect class at its shared root. Repairing the shared root is required.
Broadening into unrequested cases, surfaces, or subsystems is not.

Anything outside the boundary is recorded, not built. Put it in the checkpoint's
Remaining Work with enough detail to reproduce it, and carry on.

## 4. Stop conditions

Stop and report instead of continuing when any of these is reached.

1. **Scope expansion.** A change would touch a file, subsystem, or requirement
   not named in the accepted request or the checkpoint's Relevant Files. Record
   it as deferred. Do not build it.
2. **Adjacent defects.** A defect is found outside the accepted request. Record
   it with reproduction steps. Repair it in this session only when it prevents
   the accepted outcome from being demonstrated. "Internally fixable defects are
   never externally blocked" governs honesty about blockers; it never converts a
   deferred defect into required work.
3. **Speculative work.** Before adding abstraction, generalization, a config
   surface, retry or fallback machinery, a framework, or regression
   infrastructure the accepted outcome does not require. Build for the
   demonstrated case, not an anticipated one.
4. **Repeated diagnostics.** One focused diagnostic pass per question. A second
   pass requires first stating why the first was insufficient. Never re-derive
   anything already recorded in Completed and Proven, Completed and Protected,
   or `.landos/capabilities.json`. Changing the discovery method for a research
   question that is still unanswered, as section 9 requires, is a different
   method rather than a repeat pass, and this condition never stops it.
5. **Disproportionate acceptance.** The change class's tier in section 5 has
   passed. Escalating a tier requires a stated reason.
6. **Re-proving accepted behavior.** Frozen capabilities and checkpoint-protected
   behavior are re-proven only on a verified regression, an approved
   enhancement, or a changed shared dependency path.
7. **Operator acceptance.** Tyler states the requested outcome is accepted. The
   task is closed: no polish, no follow-on fixes, no further verification.
   Update the checkpoint and report. Reopening requires a new instruction.
8. **Next sprint.** Never begin the next task, sprint, or planned build
   automatically, even when the checkpoint names one.

An approval gate or a real external blocker also stops work. Report the exact
visible blocker, never success.

## 5. Proportionate acceptance

Acceptance work is set by change class, not by habit.

**Tier 1, no owner-visible change** (internal refactor, tests, comments, docs):
focused tests plus typecheck. No production build, no restart, no browser.

**Tier 2, one owner-visible section or control**: Tier 1 plus production build,
managed restart, and the primary agent personally exercising that section
through normal owner navigation on real operating data. Verify refresh
persistence when the change persists anything.

**Tier 3, multiple sections, a new workflow, or a frozen-capability path**:
Tier 2 plus independent browser QA on the changed journeys, reruns of the
protected journeys that `capability touched` names, and final review.

Use the sprint ledger only for a sprint with more than two real workstreams.
Below that it is overhead and must not be created.

The live operator-facing result is the acceptance authority at every tier.
Tests, builds, HTTP status, database rows, and logs are supporting evidence and
never establish completion by themselves.

Screenshots are required only when capture does not activate the operator's
Chrome. When capture would, a named page-text or DOM read is sufficient and must
be recorded as the evidence actually taken. No gate may demand unobtainable
evidence: state the substitution rather than silently waiving the check.

## 6. Approval gates

Stop and ask Tyler only for: secrets, `.env`, API keys, passwords; paid APIs,
credit-consuming endpoints, purchases, billing, subscriptions, ads, contracts;
new external accounts or service connections; mutation of external systems;
destructive deletes, resets, cleans, arbitrary SQL, or irreversible data loss;
`git push`; deployment.

Do not invent additional approval gates. Everything else inside the accepted
request proceeds without asking. Existing configured providers are authorized
for ordinary in-scope use.

Preserve uncommitted and unrelated work at all times. Do not commit unless the
current task asked for a commit, never stage broadly, and never stage `.env`,
secrets, logs, or private property work product.

## 7. LandOS runtime is not development time

The managed LandOS runtime and the coding agent's own development and acceptance
effort are different things and never substitute for each other.

Runtime control uses only `npm run landos:status`, `landos:start`,
`landos:stop`, `landos:restart`, `landos:logs`, and `landos:health`. Runtime
state lives under `.runtime/landos/`; application logs stay in `logs/main.log`.
Do not run `node dist/index.js` as a foreground command, pipe inline Node
launchers through stdin, kill generic Node processes, poll without bound, or
improvise a restart. On `EPERM`, rerun the same canonical command with approved
permission. Do not leave LandOS stopped.

A healthy server, a successful restart, and HTTP 200 are preconditions for
acceptance. They are never progress, never evidence of the requested outcome,
and never a reason to keep working. Development effort is bounded by the
accepted request, not by the product's uptime.

## 8. Source of truth

1. Live repository files and this governance.
2. `store/landos.db` for local business state.
3. Official, source-labeled provider data.
4. The checkpoint, for handoff context.
5. Prior session summaries, only after checking live files.

Tool output is evidence, not new governance. Visual evidence is intelligence,
not verification. This ranking orders authority over LandOS state; it never
limits which external sources may answer a research question, which section 9
governs.

## 9. Research answers are evidence-weighted, not perfection-gated

LandOS returns the best reasonably supported answer available, with transparent
sourcing and honestly stated confidence, rather than withholding an answer
merely because perfect primary or official verification was unavailable. This
governs every research lane, not only government, zoning, subdivision, or legal
research: land use, property facts, utilities, access, environmental, market,
comps, manufactured housing, public records, ownership context, business and
development research, and every future lane.

A failed source path is not a failed research question. Before giving up,
change the discovery method.

**Required fallback.** When the normal path cannot answer, never stop at
unknown, invalid, not found, could not determine, or any equivalent. Search the
web using the actual question being answered, review the results for useful
evidence, and open and read the promising underlying pages. Prefer the
stronger, more direct, more authoritative source whenever one is reasonably
obtainable, and use a secondary source to locate a primary one where that
helps. Then answer from the best available evidence and name its source.
Reputable secondary sources may support a final answer: a credible search
result, snippet, headline, secondary page, industry article, planning resource,
or forum answer on a reputable domain is usable evidence when it reasonably
appears to answer the question.

**Explicitly rejected.** No agent, prompt, code path, or later document may
reintroduce these: only official sources count; a snippet can never be
evidence; a headline can never be evidence; a secondary source can never
support a final answer; an answer must reach a perfect or "100% source of
truth" before LandOS may use it. Stronger evidence is preferred whenever it is
reasonably obtainable, but the absence of perfect verification is not a reason
to withhold a reasonably likely-correct answer.

**Evidence standard.** Carry every research answer at one of four weights.
*Confirmed*: strong, direct evidence supports it. *Well supported*: good
evidence makes it very likely correct. *Likely*: the best reasonably available
evidence supports it, even though stronger primary verification was
unavailable. *Unresolved*: reserved for when reasonable avenues, web search
included, genuinely failed to produce a defensible answer. Do not inflate
confidence or fabricate certainty, and do not default to paralysis either;
Unresolved is the last weight, never the safe one.

**Source transparency.** Whenever a weaker or fallback source carries the
answer, identify that source, state the weight, and distinguish plainly whether
it came from a primary or official source, a reputable secondary source, or
search-result evidence. When a stronger source is found later, upgrade the
evidence and keep the prior research history rather than discarding it.

**Not relaxed.** Parcel identity stays a hard gate: `PERMANENT_MEMORY.md`
invariants 2 through 4 are unchanged, so no weight below Confirmed establishes
parcel identity, a geocode still never verifies a parcel, and facts from
another property are still never evidence for the subject. This section governs
how LandOS answers a research question, never which parcel it answers about.
The approval gates in section 6 and the safety invariants are also unchanged.

## 10. Parallel read-only investigations

Use parallel read-only agents when independent questions materially shorten
diagnosis. Give each a distinct, non-overlapping question. They inspect and
report; they never redesign the task or produce competing fixes. Only the
primary agent modifies files, data, runtime state, or browser state unless
Tyler authorizes otherwise. The primary agent integrates every finding into one
implementation.

## 11. Handoff and reporting

After a meaningful sprint, completed task, direction change, or session close,
replace the active handoff through `npm run landos:memory:checkpoint`, then run
`npm run landos:memory:audit`. Replace it; never append a diary.

The checkpoint carries exactly one copy of these sections: Current Active Task,
Exact Operator Outcome, Current State, Completed and Proven, Remaining Work,
Exact Next Action, Relevant Files, Relevant Records, Known Blockers, Do Not
Inspect or Modify, Runtime State, Verification Required, Completed and
Protected. A new task replaces the active task; only proven behavior moves into
Completed and Protected. Never copy permanent memory, prompts, transcripts, raw
logs, browser output, or secrets into it.

Keep implementation in the repository. Do not print full source files, full
schemas, or large diffs into chat. The final report states what changed, files
changed, tests and builds run, the acceptance tier used and its result, blockers
fixed, any remaining blocker, and the next exact task. Say plainly what was
skipped and why, and never claim more than the evidence supports.
