# STOP: OWNER-FACING COMPLETION GATE

**DO NOT STOP, PAUSE TO REPORT, SWITCH TO COSMETIC/TECHNICAL WORK, OR CLAIM COMPLETION WHILE ANY OWNER-REQUESTED, DECISION-CRITICAL FRONT-END RESULT IS MISSING, UNUSABLE, OR NOT PERSONALLY VISUALLY VERIFIED END TO END. KEEP WORKING THE REAL WORKFLOW UNTIL THE LIVE CARD SHOWS REAL EVIDENCE AND USABLE BUSINESS OUTPUT. A PARTIAL WALKTHROUGH, UI FIX, BACKEND PROGRESS, PLACEHOLDER, WARNING, OR EXPLANATION OF WHAT IS MISSING IS NOT A STOPPING POINT. ONLY A REQUIRED NEW AUTHORITY OR A REAL EXTERNAL BLOCKER MAY PAUSE WORK; REPORT THAT VISIBLE BLOCKER, NEVER SUCCESS.**

# LandOS Permanent Operating Memory

## Permanent rules

1. Every LandOS fix is system-wide. A property may be an acceptance example,
   but never implementation scope.
2. Previously accepted operator information cannot change without Tyler's
   confirmation.
3. Preserve property, seller, CRM, evidence, document, visual, Activity,
   research, and operator data.
4. Use only `npm run landos:status`, `landos:start`, `landos:stop`,
   `landos:restart`, `landos:logs`, and `landos:health` for runtime control.
5. Do not commit or push without Tyler's explicit authorization.
6. The live localhost owner experience is the completion authority; tests,
   builds, APIs, database rows, and HTTP 200 alone do not establish completion.
   The primary agent must personally use the visual browser and complete the
   normal owner-facing workflow on real data.
7. Staged workstreams and independent live browser QA are support only; they
   never replace owner-visible acceptance.
8. A failure pattern appearing twice requires root-cause review and permanent
   regression coverage.
9. Tyler receives one full standalone implementation prompt, never patch
   fragments.
10. Approval is required for new secrets, paid accounts/charges, credential
    changes, destructive deletion/reset, git push, and deployment. Existing
    configured providers are authorized for ordinary in-scope use.
    **Environment files and stored credentials are read only.** An agent may
    securely read and use an existing credential from `.env` when an explicitly
    approved local LandOS workflow requires it, including signing into
    LandPortal through the visible browser. An agent must never (a) modify
    `.env` or any stored credential unless Tyler directs that exact change;
    (b) print, echo, display, summarize, or otherwise reveal a secret value;
    (c) include a credential in any response, report, screenshot, terminal
    output, log, test fixture, browser console output, source file, prompt,
    commit, or document; (d) copy a secret into another file or pass it through
    command arguments where it may be recorded; (e) commit or push `.env` or any
    secret; or (f) send a credential to an unapproved external service. Reading
    a credential privately and entering it into its intended approved login form
    is permitted; the value stays concealed throughout.
11. Live repository and runtime inspection override memory-file narrative.
    Preserve unrelated dirty work.
12. Replace `.landos/CHECKPOINT.md` in place. Keep automatic memory compact:
    no prompts, transcripts, raw logs, DOM/browser output, or property history.
13. **Turn-boundary honesty:** a final response ends active execution. Never say
    "I am continuing," "still working," or imply a live clock/process after a
    final response has been sent. If the build is incomplete at that boundary,
    say plainly that work has stopped and name the exact visible blocker. During
    active execution, status language must match actual work currently being
    performed; distinguish an incomplete project from an active work turn.
    Do not end a LandOS build turn while owner-required acceptance work remains
    unless a real external blocker or required new authority prevents progress.
14. **Mandatory build task list — every build, every session:** Before acting on
    any build/change request, create or resume one explicit checklist covering
    the entire owner request, not merely the current subtask. Store it in the
    active checkpoint and treat it as the build's controlling task list across
    sessions. Check an item only after real evidence proves it complete:
    implementation, relevant tests/build, managed restart/health, every changed
    card/workflow section, every required control, and the requested business
    output through normal owner navigation. On every resumption, read the list
    first and continue from its unchecked items. An unchecked item means the
    build is incomplete. Do not end, pause, claim to be continuing, or send a
    completion-style final response while any required item is unchecked unless
    an exact external blocker or a required new authority is recorded beside
    that item. This rule applies to all LandOS builds, not just the current one.

15. **Context-safe continuation boundary:** For every new, non-trivial LandOS
    build session, create a tracked goal with a `100000`-token budget before
    implementation work begins. Check that goal's tracked usage before each
    material implementation/research phase. At `80000` goal tokens (or earlier
    if the visible Codex context meter reaches 60% used), stop starting new
    work, complete the current atomic action safely, update this checkpoint
    with live disk/runtime/browser evidence and exact next action, then create
    a fresh same-project continuation thread containing that checkpoint and the
    remaining unchecked owner-facing tasks. The fresh thread, not the old one,
    resumes implementation. Never wait for automatic compaction to protect an
    active LandOS build. A token-goal budget is a guardrail, not proof of owner
    completion; all existing owner-facing acceptance requirements still apply.

## Compact bootstrap

- Read this file and `.landos/CHECKPOINT.md` first; inspect live state next.
- Use `npm run landos:memory:retrieve -- <specific query>` only for focused
  history. Never load broad reports, database contents, or browser history by
  default.
- Check memory with `npm run landos:memory:status` and `landos:memory:audit`.
