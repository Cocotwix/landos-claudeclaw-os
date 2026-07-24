# LandOS Permanent Operating Memory

## Owner-facing completion gate

Do not stop or claim completion while an owner-requested, decision-critical
front-end result is missing, unusable, or not personally verified end to end.
Backend progress, tests, warnings, placeholders, and partial walkthroughs are
not completion. Only required new authority or a real external blocker may
pause work; report the exact visible blocker, never success.

## Permanent rules

1. Every fix is system-wide. A property may be an acceptance example, never
   implementation scope.
2. Previously accepted operator information cannot change without Tyler's
   confirmation. Preserve property, seller, CRM, evidence, document, visual,
   Activity, research, and operator data.
3. Use only `npm run landos:status`, `landos:start`, `landos:stop`,
   `landos:restart`, `landos:logs`, and `landos:health` for runtime control.
4. Do not commit, push, deploy, destructively reset/delete, create charges,
   change credentials, or add secrets without explicit authorization.
5. Existing configured providers are authorized for ordinary in-scope use.
   Environment files and stored credentials are read only. A credential may be
   entered privately into its intended approved login form, but must never be
   printed, summarized, copied, logged, passed in command arguments, placed in
   source/tests/docs/screenshots, sent elsewhere, committed, or pushed.
6. The live localhost owner experience is the completion authority. Tests,
   builds, APIs, database rows, HTTP status, staged workstreams, and independent
   QA are support only. The primary agent must personally use the visual
   browser, follow normal owner navigation, exercise every changed section and
   control, and verify real business output on operating data.
7. A failure pattern appearing twice requires root-cause review and permanent
   regression coverage.
8. Live repository and runtime inspection override memory-file narrative.
   Preserve unrelated dirty work.
9. Replace `.landos/CHECKPOINT.md` in place. Keep automatic memory compact: no
   prompts, transcripts, raw logs, DOM/browser output, secrets, or property
   history. Link detailed evidence under `docs/landos/` when needed.
10. A final response ends execution. Never imply work is continuing after it.
    Do not end a LandOS build while required acceptance remains unless a real
    external blocker or required authority prevents progress.
11. Every build uses one explicit checkpoint checklist covering implementation,
    tests/build, managed restart/health, changed owner-facing sections and
    controls, real business output, refresh, and restart persistence. Resume
    unchecked items; check them only after evidence proves them complete.
12. For a new non-trivial build session, use a tracked 100000-token goal when
    platform and current owner instructions permit. At its guardrail, finish
    the atomic action and write an exact continuation boundary. A budget never
    proves product completion.

## Compact contract phrases

- Do not commit or push without Tyler's explicit authorization.
- The live localhost owner experience controls completion; HTTP 200 alone do not establish completion.
- Staged workstreams and independent live browser QA are support only.
- Tyler receives one full standalone implementation prompt, never patch
  fragments.
- Approval is required for new secrets, charges, credential changes,
  destructive actions, git push, and deployment.

## Compact bootstrap

- Read this file and `.landos/CHECKPOINT.md` first; inspect live state next.
- Use `npm run landos:memory:retrieve -- <specific query>` only for focused
  history. Never load broad reports, database contents, or browser history by
  default.
- Use `landos:memory:status` and `landos:memory:audit` to check this bootstrap.
