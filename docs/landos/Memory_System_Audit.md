# LandOS Memory System Audit

Date: 2026-07-14
Scope: project instructions, Claude auto memory, checkpoint, continuation commands, local retrieval, tests, browser-context handling, and the Trejon reference kit.

## Before this sprint

LandOS had durable notes but no compact bootstrap. `.landos/` held about 148 KB (about 37k estimated tokens) across append-heavy handoffs, QA records, limitations, and conflicting current-state files. The prior `/continue-landos` read twelve files (about 155 KB, about 39k tokens), inspected broad reference documentation, and queried `store/landos.db` before live inspection. Browser/MCP results then accumulated in the same long session.

Claude Code also auto-loaded the first 200 lines of its machine-local project `MEMORY.md`. The discovered index was 16,646 bytes (about 4,162 tokens), contained dozens of detailed sprint summaries, and linked topic files. This automatic contributor was absent from the interrupted sprint's audit and budget calculation.

## Interrupted implementation found on disk

The interrupted session had created permanent memory, a checkpoint, compact continuation aliases, a memory script, package commands, a 19-test bootstrap suite, and an audit draft. Its basic repository-only budget passed.

Partial or incorrect items were:

- coding-agent/`AGENTS.md` and Claude auto-memory profiles were not measured;
- permanent rules were duplicated in `CLAUDE.md`;
- the repeated-failure rule was weaker than required and prohibited wording remained;
- the checkpoint omitted independent-browser-QA state and refresh derived only date, HEAD, and dirty count;
- no task-specific local retrieval command existed;
- status omitted isolated acceptance;
- prompt, final-report, browser/MCP, DOM, transcript, secret, and hard-budget coverage was incomplete;
- no full suite, typecheck, build, diff check, isolated attempt, or live safety proof had run.

## Current automatic bootstrap

Claude Code loads:

- `CLAUDE.md`;
- `.landos/PERMANENT_MEMORY.md`;
- `.landos/CHECKPOINT.md`;
- the machine-local Claude `MEMORY.md`, now a 709-byte pointer to the compact repository files.

Current Claude estimate: about 5,305 tokens. Coding agents load `AGENTS.md` plus the two `.landos` files, about 1,807 tokens. Both pass the 10,000-token target and 20,000-token hard maximum.

The prior Claude auto-memory index is preserved beside the new index as an on-demand recovery file. Its topic files remain searchable but are not startup context. No docs tree, sprint report, transcript, prompt, database, browser result, Chrome session, test suite, or server action loads automatically. Live files, git, tests, and managed runtime state override stale checkpoint implementation facts. Ordinary task words do not invoke recovery.

## Current behavior

`npm run landos:memory:retrieve -- <specific query>` searches local `.landos` and `docs/landos` Markdown, ranks matching sections, returns at most five bounded excerpts and paths, reports modification time and possible supersession, omits secret-shaped sections, and caps added context at 2,500 estimated tokens. It is offline and has no reference-repository dependency.

`/continue-landos` is optional. If explicitly invoked, it loads only permanent memory, the checkpoint, and small live git/runtime/memory status. It reports files, estimated tokens, and staleness; it does not read broad history, query the database, start a browser, or run tests.

Raw DOM, MCP/browser results, transcripts, terminal logs, and tokenized URLs remain ephemeral and are rejected from automatic memory. Only concise selectors, playbooks, decisions, blockers, and proof paths may be promoted.

## Reference-kit comparison

The Trejon kit was inspected read-only at commit `33c45bea7c34471607513e470d215e3ef460880a` in an isolated temporary clone. Adapted ideas: a small replaced handoff, compact startup context, separated durable lessons, freshness checks, and reporting of loaded context.

Rejected: broad continuation alignment audits, ordinary-word triggers, append-heavy session logs, self-editing hooks, destructive plan movement, post-edit full typechecks, automatic commit/push behavior, broad prime/piv loading, and runtime dependency on the kit. These conflict with LandOS context, Windows runtime, git, or approval rules.

## Commands

- `npm run landos:memory:status`
- `npm run landos:memory:audit`
- `npm run landos:memory:checkpoint`
- `npm run landos:memory:retrieve -- <specific query>`

The Trejon repository is not imported, executed, or required at runtime.

