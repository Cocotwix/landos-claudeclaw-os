# LandOS development context

Durable orientation for a coding agent working in this repository. It answers
"what is this and how do I work here" once, so a task can be a task instead of a
briefing. It is not process doctrine: `.landos/CODING_SESSION_PROTOCOL.md` is
the canonical contract and `.landos/PERMANENT_MEMORY.md` holds the invariants.
Where they disagree with this file, they win.

## What LandOS is

LandOS is Tyler's land-acquisition operating system: a local-first Node/TypeScript
service with a browser dashboard that an operator uses to find, research,
evaluate, and pursue rural land deals. It runs on the operator's own machine
against real business data. There is no multi-tenant deployment and no staging
environment: localhost is production.

The product's job is decision-grade property intelligence. A screen that renders
without answering the operator's question has not shipped.

## Architecture map

- `src/` — Node/TypeScript service. `src/index.ts` is the entry point,
  `src/dashboard.ts` serves the dashboard and its HTTP API, `src/db.ts` owns
  SQLite access.
- `src/landos/` — the product domain: property intelligence, parcel identity,
  comps and valuation, acquisitions, market research, provider adapters,
  governance. Most real work happens here.
- `web/src/` — the Preact dashboard. `web/src/App.tsx` declares every route;
  `web/src/pages/` holds one component per operator surface.
- `scripts/` — operational tooling by area (`runtime/`, `memory/`, `data/`,
  `knowledge/`, `dev/`). Not product code.
- `scripts/control/` — the thin development Control Spine: canonical tasks,
  attempts, evidence, verification, durable failures, and Integration Gate.
- `.landos/control/landos-control.db` — local canonical development-control
  state, deliberately separate from business data.
- `.landos/STATE.md` — reproducible generated next-builder projection from the
  control database plus live Git; never edit it as truth.
- `store/landos.db` — real local business state. Never a test fixture.
- `.runtime/` — local runtime and tool state, gitignored.

## Conventions

- ESM everywhere (`"type": "module"`). TypeScript for `src/` and `web/src/`,
  plain `.mjs` for `scripts/`.
- Tests sit beside the code they cover: `foo.ts` with `foo.test.ts`, `foo.mjs`
  with `foo.test.mjs`. Vitest collects only `src/**/*.test.ts` and
  `web/src/**/*.test.ts`; `scripts/**` tests run under `node --test`.
- Comments explain why a decision was made, not what the next line does.
- Provider adapters label their data with its source. Unsourced facts are not
  product output.

## Standard commands

    npm run typecheck                 tsc --noEmit
    npm test                          full vitest suite
    npx vitest run <files>            focused suites
    npx vitest related --run <files>  suites covering changed sources
    node --test <files>               scripts/** tests
    npm run build                     vite build + tsc (production)

    npm run landos:status             managed runtime state
    npm run landos:start|stop|restart runtime control
    npm run landos:health             health probe
    npm run landos:logs               runtime logs

    npm run landos:control -- status  development state plus live Git
    npm run landos:control -- state generate
                                      regenerate .landos/STATE.md
    npm run landos:control:test       focused Control Spine lifecycle proof

Runtime control is only those commands. Do not run `node dist/index.js` in the
foreground, kill Node processes by name, or improvise a restart. The dashboard
is at http://localhost:3141.

## A correct operator-facing result

For any change an operator can see, correct means all of:

1. The operator's question is answered on the screen they would actually use,
   reached by normal navigation, on real operating data.
2. Anything persisted survives a refresh.
3. Every fact shown names its source, and confidence is stated honestly rather
   than inflated. "Unresolved" is an allowed answer; a confident wrong answer
   is not.
4. Parcel identity is confirmed before any property intelligence is attached to
   it. Coordinates, geocodes, and map pins never establish identity.

Green tests, a clean build, a healthy process, and HTTP 200 are preconditions.
None of them is evidence that the operator got the result.

## Repository state

The working tree is routinely dirty with unrelated work in progress. Preserve
it. Do not stage broadly, commit, push, reset, clean, stash, or revert anything
you did not create, and never touch `store/` or `logs/`. Confirm with Tyler
before paid APIs, external mutations, destructive data operations, `git push`,
or deployment.

## Secrets

`.env` and every other secret or credential file are permanently read only.
Never create, modify, replace, delete, rename, reformat, stage, or commit one.
Verification fingerprints them before and after every run and fails hard on any
content change, so this is enforced, not advisory.

Never read a secret file whole: no `cat .env`, no dumping the environment, no
copying values into a prompt, a log, a trace, a result, or a summary. Ask about
one named variable at a time:

    node scripts/dev/env-guard.mjs status <NAME>        configured | not configured
    node scripts/dev/env-guard.mjs run <NAME> -- <cmd>  run <cmd> with that one
                                                      variable in its environment

`status` answers without the value existing anywhere outside that process. Use
`run` when a command genuinely needs the value; it reaches the child process and
nothing else. If neither fits, stop and ask Tyler rather than opening the file.

## Boundaries

Make the smallest dependency-complete change that produces the requested
outcome, repairing the shared root of the defect rather than one symptom. Record
adjacent problems instead of building them. Do not add abstraction, config
surfaces, retry machinery, or frameworks the requested outcome does not need.
