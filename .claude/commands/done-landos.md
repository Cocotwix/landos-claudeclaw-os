---
description: "Close a LandOS session: replace the compact active handoff"
---

# /done-landos

Close the current LandOS coding session without confusing backend progress with
owner-visible completion.

## 1. Verify

- Run `git status --short`.
- Record focused tests, typecheck, builds, managed restart, and operator QA only
  when they actually ran.

## 2. Replace the checkpoint handoff

Update `.landos/CHECKPOINT.md`, then run
`npm run landos:memory:checkpoint`. Keep exactly the section structure required
by `.landos/CODING_SESSION_PROTOCOL.md` and one Current Active Task. A newly
selected task replaces the prior active task; only important proven behavior
moves to Completed and Protected.

The checkpoint command replaces derived metadata in place and validates useful
task, next-action, file-scope, size, placeholder, duplication, and single-task
requirements. It never appends session history or changes permanent memory.

## 3. Audit

Run `npm run landos:memory:audit`. Fix checkpoint validation, budget, duplicate,
staleness, or excluded-content failures before ending the session.

## Rules

- Follow the shared coding-session protocol and permanent-memory safety rules.
- Do not push, deploy, or commit without Tyler approval.
- Do not write secrets, tokens, `.env` contents, or private property data.
- Do not stop early when an in-scope blocker is safely fixable. An out-of-scope
  blocker is recorded in Remaining Work, not fixed.
- Do not begin the next task or sprint after closing this one.
