# Launch Checklist: Handing the LandOS Operational Closure to a Coding Agent

## Decision

Use **Claude Code with Opus 5 at high effort** as the sole writing agent for this one operational-closure effort. Start a **fresh Claude Code conversation in the existing LandOS working tree**. A fresh conversation does not mean a clean Git tree. Do not reset, clean, stash, checkout, discard, or overwrite the current uncommitted changes. Do not resume an old implementation conversation that carries the feature-by-feature history.

Use **Fable 5.1** only if Opus 5 is unavailable. Keep Codex, Gemini CLI, OpenCode, or any other coding agent out of the working tree while this agent is building. A second agent may review only after a release candidate exists.

## Before launching the agent

| Check | What to do |
| --- | --- |
| **Repository** | Open the real local LandOS repository—the same working tree that runs the app and contains the current database/configuration. |
| **Baseline** | Have the agent inventory the existing working tree and explicitly preserve every current uncommitted change before beginning. Do not clean, reset, stash, checkout, discard, or overwrite the working tree. |
| **Handoff file** | Put the corrected `LandOS Operational Closure Handoff.md` in the repository as `docs/landos-operational-closure-handoff.md`; do not ask the agent to rely on pasted fragments alone. |
| **Sensitive data** | Keep required local environment configuration available to the app, but do not paste secrets into the prompt. |
| **Execution boundary** | Confirm the agent may make repository/database/test/runtime changes but may not send seller communications, make offers, submit applications, make payments, alter external records, rotate credentials, or bypass provider access controls. |
| **Time and focus** | Give it one uninterrupted operational-closure task. Do not feed it new feature ideas while it is satisfying the release contract. |

## Persistent execution setup

Start Claude Code in **Auto mode**. Before setting the goal, place this checklist and the handoff in the repository, verify the copied files match their sources, and have Claude read both documents completely. This preparation must happen before `/goal` because setting a goal starts the execution turn immediately.

Once both documents are installed and read, enter the following as one command. Do not send a separate launch prompt afterward:

> `/goal Execute docs/landos-operational-closure-handoff.md and docs/landos-operational-closure-launch-checklist.md as the governing LandOS operational closure contract. Own the closure from the current repository state. First inspect the actual repository, git status and log, database schema and runtime, New Lead route, Deal Card routes, current artifact, identity, comps, valuation paths, and the relevant Deal Cards. Verify facts directly and preserve every existing uncommitted change. Work forward using the smallest existing mechanisms necessary. Before any business data migration or alteration, create and verify the encrypted backup required by the handoff. Preserve immutable evidence, provenance, historical artifacts, canonical family lineage, and real transaction data. Continue across turns and context boundaries until npm run landos:deal-card:release passes exactly five consecutive controlled QA cases and every acceptance condition is verified. A partial fix, test pass, response boundary, context boundary, elapsed time, token usage, workload estimate, or desire to report progress is not completion. Do not add unrelated frameworks or features, create parallel data stores, use multiple write capable agents, bypass provider access controls, send external communications, make offers, make payments, modify external services, or rotate credentials. Interrupt only for an irreversible business evidence or transaction decision, required new paid, licensed, or credentialed access, or a verified internal contradiction. Local checkpoint commits are permitted only at verified stable boundaries. Do not push or create the final release commit. When the complete contract passes, return the required final report and stop for Tyler's approval.`

Auto mode handles routine tool permissions. The `/goal` is the persistent completion mechanism and starts the first implementation turn immediately. If the conversation is compacted, paused, or resumed, continue the same active goal from the current repository state. Do not return the unfinished work to Tyler merely because one response or context window ends.

## What the first response should contain

The agent should acknowledge the handoff and begin inspection. It may state a short execution plan, but it should **not** ask you to choose between ordinary implementation details, propose a new platform, or start new features. It should start with repository/database/runtime fact gathering and backup preparation only when a real migration is necessary.

## What to do while it runs

Do not repeatedly redirect it. Let it work through the release contract. If it reaches one of the permitted interruption gates, answer only the exact question it asks. If it returns with a completion claim, do not immediately push: collect its final report, git status, release-command output, and test/browser evidence for review.

## Release-candidate review

After the primary builder claims completion, use a second agent in **read-only mode**. Codex with GPT-5.6 Sol at Extra High is the recommended independent reviewer. Give it the final report, current diff, commit log, migration plan, release output, five-case results, and browser evidence. Its allowed outcomes are only:

1. **Approve**; or
2. a ranked, evidence-linked list of true release blockers.

It must not edit files, database, configuration, or browser state. If it finds a blocker, return that evidence to the same primary builder for a focused repair. Do not start a new independent implementation path.

## Final decision gate

Approve the final release commit only when the primary-builder report and the read-only review agree that the operational acceptance contract has passed. After Tyler gives approval, the final commit should be focused on this closure alone, with no package-lock, dependency cache, secret, tool-config, or unrelated file changes. Do not push unless Tyler separately authorizes the push.

**Basis:** The operator-approved LandOS Operational Closure Handoff, September 3, 2026. **Assumptions:** Claude Code can access the true local LandOS repository and runtime. **Sources & confidence:** High confidence in the one-writer/one-release-contract workflow; the selected model must be available in the user’s Claude Code model picker.
