# LandOS Permanent Operating Memory

Compact rules for every LandOS coding session. Detailed history is retrieved
only when the current task needs it.

## Permanent rules

1. Every LandOS fix is system-wide. A property may be an acceptance example,
   but never implementation scope.
2. Previously accepted operator information cannot be changed without Tyler's
   confirmation.
3. Preserve existing property, seller, CRM, evidence, document, visual,
   Activity, research, and operator data.
4. Use only `npm run landos:status`, `landos:start`, `landos:stop`,
   `landos:restart`, `landos:logs`, and `landos:health` for the managed
   local runtime. Never kill generic Node processes or improvise runtime
   commands.
5. Do not commit or push without Tyler's explicit authorization.
6. The live localhost operator experience determines completion. Tests, build
   success, API correctness, and HTTP 200 alone do not establish completion.
7. Divide multi-project prompts into staged workstreams. Each major workstream
   must pass independent live browser QA before the next begins.
8. A failure pattern appearing twice triggers shared root-cause review and
   permanent regression coverage.
9. Tyler receives one full standalone implementation prompt, never patch
   fragments.
10. Do not use the prohibited three-word label for a canonical information
    authority.
11. Approval is required for secrets, `.env`, API keys or passwords, paid
    services, external accounts, money, destructive deletion or reset, git
    push, and deployment.
12. Live repository and managed-runtime inspection override memory-file narrative and outrank stale checkpoint
    implementation facts. Preserve unrelated dirty work.
13. Replace `.landos/CHECKPOINT.md` in place; never append session history to
    it. Do not put full prompts or reports, transcripts, raw logs, DOM dumps,
    browser/MCP output, secrets, tokenized URLs, or property histories in
    automatic memory.

## Compact bootstrap and local knowledge

- Current checkpoint: `.landos/CHECKPOINT.md`.
- Database: `store/landos.db` (inspect only when the task requires it).
- Reports and history: `docs/landos/` and legacy `.landos/` ledgers, on demand.
- Task-specific retrieval: `npm run landos:memory:retrieve -- <query>`.
- Memory checks: `npm run landos:memory:status`, `landos:memory:audit`, and
  `landos:memory:checkpoint`.
- Ordinary words such as "continue", "current", "existing", "LandOS",
  "build", or "sprint" never trigger broad recovery or browser startup.
- Substantial prompts run through the staged sprint lifecycle
  (`docs/landos/Staged_Sprint_Lifecycle.md`): `npm run landos:sprint` for the
  requirement ledger and gates, `npm run landos:operator-qa` for independent
  live browser QA. Completion claims require linked ledger evidence.
