# LandOS Full Read-Only Architecture Audit

Audit basis: 2026-08-16, authoritative repository `C:\Users\tbutt\claudeclaw-os`. Inspection was strictly read-only. No tests, builds, services, browsers, databases, files, branches, or sessions were modified.

## A. Executive Findings

- LandOS does not have one canonical development control plane. Build execution, sprint state, memory, verification, OMP, Hermes, worktrees, and Git handoff are separate systems.
- `npm run landos:build` is the documented current build runner, but `npm run landos:task` remains an active alternative and ordinary manual coding remains possible.
- The current build runner supports Claude Code and Codex only. It runs concurrent workers directly in the primary dirty working tree and deliberately does not use worktrees.
- Development continuity is repository-owned in principle through the protocol, permanent memory, checkpoint, sprint ledgers, recurrence registry, tests, and Git.
- Completion does not automatically update that continuity state. Checkpoint, verification record, sprint state, Git commit, and human acceptance are separate manual actions.
- The checkpoint is the doctrinal active handoff, but its live audit marks it stale: embedded HEAD `822ce15` differs from live `76e2cd4`, and its dirty-count parser reports `106` versus live `9`.
- `.landos/verification-results.json` is separately stale at commit `57b7d9f`; it does not contain the evidence described for current HEAD.
- Fresh Claude Code and fresh Codex receive different bootstrap surfaces. Both can reach the shared checkpoint, but neither automatically receives all sprint, failure, verification, worktree, and historical decision state.
- Prior failure patterns are persisted and automatically inserted into Tier-3 QA briefs, but they are not automatically retrieved for builders.
- OMP is only an OMP-session stop-marker guard. It neither runs nor verifies builds and is disconnected from normal Claude, Codex, sprint, and memory paths.
- Hermes actively participates in the runtime Property Intelligence LandPortal lane, not normal LandOS development. Its external profile is a separate memory silo and currently fails both profile-template and governed-install checks.
- Runtime LandOS is only partially provider-agnostic: mission-completion interfaces are provider-neutral, but normal Ace/Duke/main agents execute directly through the Anthropic Claude Agent SDK.
- Frozen capabilities and extensive regression tests exist, but capability impact detection and protected journeys are manual and are not called by either development runner.
- The live managed runtime is healthy, uniquely associated with this repository, and listening on port 3141 at PID `171908`.

## B. Current Git + Worktree State

| Item | Current fact |
|---|---|
| Branch | `main` |
| HEAD | `76e2cd4f847323b414883c07616e89614a07709b` |
| HEAD subject | `fix(landos): surface the intelligence a New Lead run already collects` |
| Commit time | `2026-08-16T16:58:19-04:00` |
| `origin/main` | Same SHA as HEAD |
| Ahead/behind | `0 / 0` |
| Runtime | Healthy, PID `171908`, HTTP 200, one verified server |

Complete status:

```text
## main...origin/main
 M src/dashboard.contract.test.ts
 M src/dashboard.ts
 M web/src/pages/BrowserConnect.tsx
?? .landos/tasks/
?? .omp/
?? scripts/landos/comp-lane-probe.mjs
?? scripts/landportal/capture-comp-locations.mjs
?? scripts/omp/
```

The three modified files contain 279 insertions and 15 deletions and are identified by the checkpoint as pre-existing browser-pairing work.

Registered worktrees:

| Worktree | Branch | HEAD | State |
|---|---|---|---|
| `C:\Users\tbutt\claudeclaw-os` | `main` | `76e2cd4` | Dirty as listed above |
| `C:\Users\tbutt\claudeclaw-os-upr` | `sprint/universal-property-resolution` | `fe266445` | Clean; tracks its origin branch |

Current unfinished activity:

- Checkpoint: no active task; awaiting Tyler.
- Dirty modified files: browser-pairing implementation.
- Untracked `.omp/` and `scripts/omp/`: OMP stop guard and tests.
- Untracked `.landos/tasks/retained-comp-reconciliation.md`: stale task packet describing conditions that no longer match the tree.
- Latest direct-builder result is a failed 2026-08-12 retained-comp run.
- Newer commit `eab05a2` subsequently implemented retained-comp reconciliation.
- No current pending build-runner mission was found. Existing `.runtime/devloop` records are older `ready` or `closed` artifacts.

## C. Control Surface Inventory

| Category | Authoritative current surface | Other candidates | Actual status |
|---|---|---|---|
| Build entry point | `package.json` → `landos:build` | `landos:task`, direct coding | Multiple active paths |
| Build runner | `scripts/devloop/build.mjs` | `scripts/dev/task.mjs` | Documented runner plus active alternative |
| Builder adapters | `scripts/devloop/builders.mjs` | `scripts/dev/providers.mjs` | Claude and Codex only |
| Operating contract | `.landos/CODING_SESSION_PROTOCOL.md` | Claude commands/docs | Authoritative by doctrine |
| Permanent rules | `.landos/PERMANENT_MEMORY.md` | `CLAUDE.md`, old docs | Authoritative stable invariants |
| Active handoff | `.landos/CHECKPOINT.md` | task packet, legacy state files | Authoritative by doctrine, currently stale |
| Development orientation | `.landos/DEVELOPMENT_CONTEXT.md` | `docs/landos/*` | Durable orientation, live code wins |
| Memory tooling | `scripts/memory/landos-memory.mjs` | `/continue-landos`, `/done-landos` | Manual commands; startup profile inspection |
| Verification record | `.landos/verification-results.json` | checkpoint prose, sprint evidence | Separate and currently stale |
| Current sprint pointer | `.landos/sprints/current.json` | `.landos/CURRENT_SPRINT.md` | Pointer authoritative; points to completed sprint |
| Sprint state | `.landos/sprints/<id>/ledger.json` | reports/QA briefs | Authoritative for tracked Tier-3 sprint |
| Current task | `.landos/CHECKPOINT.md` | `.landos/tasks/*.md` | Checkpoint says none; task packet stale |
| Failure recurrence | `.landos/qa/recurrence.json` | ledgers, Git, tests, docs | Active only through sprint CLI |
| Accepted capabilities | `.landos/capabilities.json` | checkpoint protected list | Active/manual, partly dated |
| Development provider routing | `scripts/devloop/builders.mjs` | `scripts/dev/providers.mjs` | Claude/Codex |
| Claude integration | `CLAUDE.md`, Claude CLI descriptors | `.claude/commands`, agents | Active |
| Codex integration | `AGENTS.md`, Codex descriptors | none | Active |
| Hermes runtime | `.hermes.md`, `src/landos/hermes-landportal-*.ts` | external Hermes profile | Active but profile-drifted |
| OMP | `.omp/extensions/landos-session-stop.ts` | `scripts/omp/*` | OMP-only, untracked |
| Worktrees | Native Git worktree registry | Deleted `scripts/devloop/worktree.mjs` | Manual only |
| Definition of DONE | Protocol acceptance tiers | runner `ready`, task `verified`, sprint `complete`, acceptance gate, OMP marker | Multiple disconnected states |
| Runtime process state | `.runtime/landos/runtime.json`, `scripts/runtime/landos-runtime.mjs` | logs/process table | Active and enforced |
| Runtime business/workflow state | `store/landos.db` | model session history | Active |
| Runtime agent sessions | `store/claudeclaw.db`, Claude session IDs | provider session encodings | Active, Claude-specific normal path |
| Runtime agent definitions | `landos-agents/<id>/agent.yaml` and `CLAUDE.md` | external/repo fallback agent directories | Active |
| Runtime model routing | `src/landos/mission-provider-routing.ts`, `model-router-service.ts` | `src/provider.ts` | Active for mission completion; bypassed by core agents |

## D. Actual Development Pipeline

There is no single mandatory pipeline. The reachable current paths are:

| Stage | Current mechanism | Reads | Writes | Mode/status |
|---|---|---|---|---|
| Tyler requests work | Chat/prompt | Human request | Nothing automatically | Manual |
| Task representation | Build request, task packet, or sprint ledger | Prompt/file | `.runtime/devloop/request.md`, `.landos/tasks/*.md`, or ledger | Optional alternatives |
| Startup context | `CLAUDE.md` or `AGENTS.md` | Protocol, memory, checkpoint | None | Provider-dependent |
| Sprint creation | `npm run landos:sprint -- create ...` | Prompt/spec | pointer and ledger | Manual, not called by runners |
| Provider selection | Auto-detected Claude/Codex in build runner; explicit engine in direct builder | CLI availability/options | Mission/result metadata | Automatic inside invoked runner |
| Builder starts | `launchWorker()` or `runEngine()` | Prompt/request/tree | Working files and runtime artifacts | Automatic after command |
| Worktree assignment | None in current runners | Current repo root | Same primary tree | Bypassed |
| Implementation | Claude/Codex CLI | Request and inspected files | Repository working tree | Automatic worker action |
| Focused verification | `deriveChecks()` / `runChecks()` | Changed paths | Result/event files | Automatic |
| Repair | `repairUntilStable()` or one same-session repair | Failure evidence | Same working tree | Automatic but runner-specific |
| Runtime check | `--serve` for build runner; lightweight health for direct builder | Runtime status | May restart only when explicitly invoked | Optional |
| Browser/operator QA | Protocol and sprint QA agents | Live UI/API/DB | QA reports/ledger | Manual, Tier-dependent |
| DONE decision | Protocol, sprint ledger, acceptance package, Tyler | Separate evidence | Separate status fields | No unified transaction |
| Memory update | `landos:memory:checkpoint`, then audit | Manually edited checkpoint, Git, verification record, sprint ledger | Checkpoint derived block | Manual |
| Git handoff | Git commit/push | Working tree and approval | Git history/remote | Manual, approval-gated |
| Next builder | New Claude/Codex startup | Its provider-specific bootstrap | None | Partial continuity |

Actual recent work can also bypass both packaged runners: a coding session may follow the protocol, edit directly, verify manually, commit, and update the checkpoint.

## E. Current Control Plane

No single system coordinates all development concerns.

| System | Classification | Scope actually controlled |
|---|---|---|
| Protocol + permanent memory | ACTIVE + AUTOMATIC at compliant startup | Doctrine, scope, acceptance tiers, handoff rules |
| Checkpoint | ACTIVE + MANUAL | Compact current handoff |
| `landos:build` | ACTIVE + MANUAL | Planning, Claude/Codex workers, checks, repair |
| `landos:task` | ACTIVE + MANUAL | Single explicit builder, checks, one repair |
| Sprint ledger | ACTIVE + MANUAL | Workstreams, evidence, QA, final review, completion |
| Memory script | ACTIVE + MANUAL | Status, audit, checkpoint derivation, retrieval |
| Runtime manager | ACTIVE + MANUAL | One verified server on port 3141 |
| OMP guard | PARTIAL | OMP session-stop marker only |
| Hermes LandPortal lane | PARTIAL | Runtime PI evidence lane |
| Mission provider router | PARTIAL | Model-completion mission children |
| `src/provider.ts` main-provider abstraction | BYPASSED for normal agents | Configuration/catalog code; core bot does not call it |
| Old mission/devloop harness | DEAD/SUPERSEDED | Removed by `61e62c7` |
| Legacy current-state Markdown | DOCUMENTATION ONLY / SUPERSEDED | Historical context |
| Native Git worktrees | ACTIVE + MANUAL | Independent filesystem/branch checkout only |

## F. Memory + Context Injection

| Mechanism | Writer/update | Reader/injection | Freshness and contents |
|---|---|---|---|
| `CLAUDE.md` | Manual Git change | Claude Code automatically | General project instructions; imports protocol, permanent memory, checkpoint |
| `AGENTS.md` | Manual Git change | Codex automatically | Orders Codex to read four bootstrap files |
| Protocol | Manual Git change | Claude import; Codex instructed read | Stable process doctrine |
| Permanent memory | Manual Git change | Claude import; Codex instructed read | Stable invariants; not task history |
| Checkpoint | Agent manually edits, then checkpoint command refreshes derived fields | Claude import; Codex instructed read | Active task, completed work, remaining work, files, tests, evidence paths; can be stale |
| Development context | Manual Git change | Codex instructed read; direct-builder prompt names it | Not imported by `CLAUDE.md` |
| Claude machine `MEMORY.md` | Claude machine memory process/manual | Claude Code automatic | Pointer/index plus seven topic files; Codex does not receive it |
| `landos-memory.mjs` | Checkpoint command writes only checkpoint derived block | Manual commands | Detects staleness but audit permits warnings |
| Verification results | Manual workflow | Checkpoint refresh reads it | Separate evidence record; currently at `57b7d9f` |
| Sprint ledgers | Sprint CLI | Sprint CLI, QA/final reviewers, checkpoint derivation | Durable structured sprint state |
| Recurrence registry | Sprint `qa-result` | QA brief generator and acceptance gate | Durable prior failure patterns; not builder startup |
| Capabilities registry | Sprint capability commands | Manual impact query and QA roles | Accepted contracts; not runner-enforced |
| Legacy handover/QA/decision docs | Historical/manual append | Manual retrieval only | Can be stale or superseded |
| `.runtime/dev*` and `.runtime/devloop*` | Development runners | Runner status/resume/manual inspection | Run-local state; not startup memory |
| `store/claudeclaw.db` memories/conversations | Running ClaudeClaw workflows | Running application | Not injected into fresh Claude Code by any project hook |
| Hermes external profile memory | Hermes | Hermes only | Separate silo; currently differs from templates |

Current memory audit facts:

- Claude profile: approximately 10,229 tokens; soft-budget warning.
- Generic coding-agent profile: approximately 6,643 tokens.
- Checkpoint: exactly 8,192 bytes, at its ceiling.
- Checkpoint status: stale.
- Audit result: `AUDIT PASS` with warnings.
- Fresh-session proof: `PARTIAL`; real isolated attempt was network-blocked, offline contract passed.

The dirty-count warning is itself imprecise: the checkpoint says only `DIRTY` without a numeric count, so the staleness regex reaches the later `106 pass` test text and treats `106` as the recorded dirty count.

Successful completion does **not** automatically create the state received by the next builder. Neither runner invokes checkpoint refresh, memory audit, sprint completion, capability freeze, verification-record update, Git commit, or handoff.

### Trejon-derived system

The provable reference was the Trejon `ix-claude-code-starter-kit`, inspected read-only at commit `33c45bea7c34471607513e470d215e3ef460880a`. Historical guards also name `Trejon-888`.

Adapted concepts:

- Small replaced handoff.
- Compact startup context.
- Durable lessons separated from the active handoff.
- Freshness checks.
- Reporting loaded-context size.

The reference repository is not imported or executed. The implementation provides compact checkpoint continuity and bounded manual retrieval, not automatic semantic continuation across providers. Later runner replacement did not delete the memory script, but neither the old nor current runner connects completion to it.

## G. Fresh Claude Code Startup

Automatically loaded before manual searching:

1. `CLAUDE.md`.
2. `.landos/CODING_SESSION_PROTOCOL.md` through `@` import.
3. `.landos/PERMANENT_MEMORY.md` through `@` import.
4. `.landos/CHECKPOINT.md` through `@` import.
5. `C:\Users\tbutt\.claude\projects\C--Users-tbutt-claudeclaw-os\memory\MEMORY.md`.

No Claude project Stop/start hook is configured in `.claude/settings.local.json`.

A fresh Claude Code session automatically receives:

| Knowledge | Result |
|---|---|
| What LandOS is | Partial, through `CLAUDE.md` and checkpoint |
| Architecture | Partial; no automatic `DEVELOPMENT_CONTEXT.md` |
| Current sprint | Only checkpoint summary, not current pointer/ledger |
| Latest accepted work | Checkpoint narrative, currently stale metadata |
| Latest accepted commit | Embedded checkpoint HEAD, currently wrong |
| Unfinished work | Checkpoint plus subsequent manual Git status |
| Failure history | Only failures selected into checkpoint/machine-memory index |
| Rejected approaches | Permanent-memory subset only |
| Accepted decisions | Partial |
| Relevant tests | Checkpoint-selected tests |
| Current worktree | Not until Git inspection |
| Previous handoff | Yes, checkpoint |
| Full verification evidence | No |
| Recurrence registry | No |
| Sprint reports | No |
| Runtime/database state | No |

The `CLAUDE.md` statement that persistent database memory is injected into every message describes the running ClaudeClaw agent environment. No repository hook was found that injects `store/claudeclaw.db` into a fresh Claude Code CLI session.

## H. Fresh Codex Startup

Codex automatically receives `AGENTS.md`. That file then instructs it to read:

1. Protocol.
2. Permanent memory.
3. Checkpoint.
4. Development context.
5. Live Git status.

Therefore, equivalent core repository context is available after Codex complies with the instructions, but it is not one native injected bundle.

Codex does not automatically receive:

- Claude’s machine-local memory index or topic files.
- ClaudeClaw conversation/memory database.
- Sprint ledger.
- Failure recurrence registry.
- Verification-results record.
- Runtime state.
- Git worktree list.
- Prior runner result artifacts.

Claude Code can stop and Codex can start with the same checkpoint, but Codex does not receive an exactly equivalent context surface and must inspect live Git and retrieve additional history manually.

## I. Future Builder Agnosticism

There is no provider-neutral context-injection interface.

Provider-neutral assets exist as files:

- Protocol.
- Permanent memory.
- Checkpoint.
- Development context.
- Sprint ledgers.
- Memory status/retrieval commands.

A future coding CLI would currently require:

- A descriptor in `scripts/devloop/builders.mjs` and/or an engine in `scripts/dev/providers.mjs`.
- Correct invocation, output, session/resume, timeout, and completion parsing.
- Explicit bootstrap behavior or an instruction to read the shared files.
- Its own handling of repair continuation.
- Its own handling of tool/sandbox semantics.

The build runner’s lane prompt points workers to the request and current tree but does not package the complete LandOS context. Context equivalence consequently depends on each CLI’s own startup conventions.

## J. Sprint + Task State

Current pointer:

```text
sprint-2026-08-04-pi-workflow-finish
```

That sprint is complete:

- Five workstreams accepted.
- Every requirement verified.
- Zero open findings.
- Final regression passed 2026-08-04.
- Final review passed 2026-08-08.

The pointer represents the prior tracked sprint, not an active sprint. The checkpoint says the current task is `None`.

Structured sprint state includes:

- Original prompt/objective.
- Workstreams and dependencies.
- Requirements.
- Lifecycle phases.
- Evidence IDs.
- Findings and repairs.
- Browser-QA verdicts.
- Final regression.
- Independent final review.
- Completion state.

Persistence is JSON in Git, so old sprints survive sessions and another provider can resume them manually with `--sprint`. The latest task state is not fully deterministic because it is duplicated across:

- Checkpoint.
- Sprint pointer/ledger.
- Stale `.landos/CURRENT_SPRINT.md`.
- Untracked task packet.
- Runner-local mission/result artifacts.

## K. Runner + Harness

### Current build runner

`npm run landos:build -- "<request>"`

- Entry: `scripts/devloop/build.mjs`.
- Worker registry: `scripts/devloop/builders.mjs`.
- Providers: Claude Code and Codex.
- Auto-probes available providers.
- First provider plans disjoint lanes.
- Up to six concurrent workers edit the same primary tree.
- Derived checks cover changed/sibling tests and TypeScript.
- Repair continues until pass, repeated identical failure, or cap.
- Optional `--serve` restarts runtime and checks HTTP reachability.
- Final success state is `ready`.
- Does not commit or update shared memory/sprint/verification state.
- Browser acceptance is explicitly outside the runner.

Lane ownership prevents only identical path strings in the plan. Directory/file overlaps, edits outside ownership, and multiple agents entering the same tree are not mechanically blocked.

### Direct builder

`npm run landos:task -- <packet> --engine claude|codex`

- One explicitly selected provider.
- Reads development context through its prompt.
- Snapshots the dirty tree.
- Derives changed/related tests, TypeScript, Node checks, route information, scope violations, and protected paths.
- Uses one same-session repair.
- Returns `verified`, `unverified`, `failed`, or `blocked`.
- Does not perform sprint, browser, memory, Git, or acceptance completion.

### Superseded harness

Commit `61e62c7` removed approximately 9,421 lines of the prior mission harness, including:

- `mission-cli.mjs`
- `mission-exec.mjs`
- `evaluator.mjs`
- `author.mjs`
- `run-state.mjs`
- `watcher.mjs`
- `worktree.mjs`
- patch/integration machinery
- lessons and plan-doctor machinery

The old provider-neutral front door from `9c3ca02` and parallel harness from `d8c74d2` are dead except for Git history and stale runtime artifacts.

## L. OMP

Current machine facts:

- Executable: `C:\Users\tbutt\AppData\Local\omp\omp.exe`
- Version: `17.2.15`
- Project extension: `.omp/extensions/landos-session-stop.ts`
- Guard: `scripts/omp/session-stop-guard.mjs`
- Tests: `scripts/omp/session-stop-guard.test.mjs`
- All project OMP files are untracked.

Actual behavior:

| Behavior | Result |
|---|---|
| Orchestrates builds | No |
| Selects models | No |
| Invokes builders | No |
| Stores memory | No |
| Stores sprint state | No |
| Verifies work | No |
| Determines factual completion | No |
| Stops an OMP session without a marker | Yes |
| Accepts `LANDOS_SPRINT_COMPLETE: PASS` | Yes, syntactically |
| Accepts exhausted external blocker text | Yes, syntactically |
| Participates in normal build path | No |
| Requires OMP invocation | Yes |

The guard detects an “active sprint” from transcript wording and repository location, not from the checkpoint or sprint ledger. Whether an actual previous OMP session loaded it was not established; default OMP extension discovery makes it reachable when OMP starts in this repository.

## M. Hermes

Runtime Hermes is a bounded LandPortal worker under LandOS:

```text
Property Intelligence run
  → runHermesLandPortalLane()
  → three sibling Hermes work units: subject, comps, visuals
  → exact-subject validation
  → importHermesLandPortalFile()
  → canonical LandOS persistence
```

Current facts:

- Project contract: `.hermes.md`.
- Templates: `config/hermes/landos-profile/`.
- External profile: `%LOCALAPPDATA%\hermes\profiles\landos`.
- Authenticated browser endpoint: `127.0.0.1:9224`.
- LandOS launches Hermes; Hermes does not orchestrate external builders.
- Each specialist owns one tab and cannot delegate.
- Verified categories are imported incrementally into LandOS state.
- In-process progress maps are ephemeral; imported categories persist.
- Hermes memory, sessions, `SOUL.md`, `USER.md`, and skills form a separate silo.
- Claude Code and Codex do not automatically read Hermes memory.
- Hermes does not update development checkpoint, sprint ledger, Git, or accepted coding decisions.

Current validation:

```text
landos:hermes:profile:check     exit 1
hermes:governed:check           exit 1
```

Drift detected:

- External `memories\MEMORY.md` differs from template.
- External `memories\USER.md` differs.
- External `landos-landportal` skill differs.
- Installed Hermes commit differs from audited manifest.
- `domain-intel` skill digest differs.

Hermes is active for the runtime LandPortal lane, disconnected from normal development builds, and not canonical memory.

## N. Coding Provider Agnosticism

| Provider | Can build through current runner? | Equivalent context? | Same verification? | Continuity |
|---|---|---|---|---|
| Claude Code | Yes | Claude-specific bootstrap plus shared checkpoint | Yes within chosen runner | Partial |
| Codex | Yes | AGENTS-directed shared files; no Claude machine memory | Yes within chosen runner | Partial |
| Hermes | No | Separate Hermes profile | No development path | No |
| Grok/xAI | No implementation found | No | No | No |
| Gemini | No build descriptor | Runtime agent/completion catalog only | No development path | No |
| DeepSeek | No direct implementation | Mentioned as possible OpenCode provider only | No | No |
| Ollama/local models | No coding descriptor | Runtime completion only | No development path | No |
| LM Studio/vLLM | No coding descriptor | Runtime completion only | No development path | No |
| OpenRouter | No coding descriptor | Runtime completion and upstream catalog | No development path | No |
| OpenCode | No coding descriptor | Runtime agent-session catalog only | No development path | No |

Provider-agnostic language is strongest in `scripts/devloop/builders.mjs`, but actual support is two hard-coded descriptors. Provider-specific assumptions remain in command syntax, output parsing, permission modes, session resume, auto-loaded instructions, and Claude-specific runtime agents.

## O. Worktrees

- Worktrees are created manually through Git; no current LandOS worktree script exists.
- Current runner comments and documentation explicitly say worktrees are gone.
- The deleted old harness previously included `scripts/devloop/worktree.mjs`.
- Branch naming is not mechanically governed by current tooling.
- Builder-to-worktree ownership is not stored.
- Two writable agents can enter the same working directory.
- The build runner intentionally places concurrent workers in the same tree.
- Git protects a branch from normal duplicate checkout across registered worktrees, but it does not prevent multiple processes from editing one worktree.
- Returning completed work to main is manual Git integration.
- Dirty state is represented only by Git status and selected checkpoint prose.
- No global owner/lease exists for worktree, runtime, or browser resources.

Port 3141 has strong process/repository identity protection, but it is a machine-global resource. A second worktree invoking runtime operations can encounter or contend with the existing owner.

CDP 9224 is also machine-global. The automation browser verifies process/profile ownership and lanes are instructed to own tabs, but no worktree-level coordinator exists. Historical QA reports explicitly record CDP contention.

## P. Verification + DONE

| Check | Automatic where | Mandatory scope |
|---|---|---|
| Focused tests | Both development runners | Derived from changes |
| Typecheck | Both runners for TypeScript paths | Runner-derived |
| Production build | Protocol Tier 2/3 | Manual outside runners |
| Managed restart | Protocol Tier 2/3 | Manual; build runner only with `--serve` |
| Live owner navigation | Protocol Tier 2/3 | Manual |
| Independent browser QA | Tier 3 | Manual QA-agent invocation |
| Protected journeys | Tier 3 when `capability touched` reports impact | Manual |
| Final reviewer | Ledger-based Tier 3 | Manual |
| Full test suite | Not generally mandatory | Not automatically run |
| Acceptance package gate | `landos:acceptance:gate <dir>` | Separate/manual |
| OMP completion marker | OMP only | Syntactic, not evidentiary |
| Tyler acceptance | Protocol stop condition | Human |

DONE has several non-equivalent meanings:

- Worker: `WORK_COMPLETE`.
- Build runner: `ready`.
- Direct builder: `verified`.
- Acceptance evidence package: gate `PASS`.
- Sprint ledger: `complete`.
- OMP: `LANDOS_SPRINT_COMPLETE: PASS`.
- Protocol: proportionate acceptance plus live operator result.
- Human: Tyler accepts the outcome.

An independent evaluator exists only in the Tier-3 sprint path. Tier 1 and Tier 2 rely on the primary agent and deterministic checks. UI proof is required by protocol for owner-visible changes but is not enforced by the runners.

Verification evidence can persist in sprint ledgers/reports, acceptance packages, checkpoint prose, and verification-results JSON. No completion mechanism automatically makes all of it available to the next builder.

## Q. Completion State Update

After accepted work, the following are separate operations:

| State | Automatic after runner success? |
|---|---|
| Checkpoint | No |
| Permanent memory | No |
| Latest accepted commit | No |
| Completed task | No |
| Sprint progress | No |
| Failure history | No |
| Architectural decisions | No |
| Verification record | No |
| Runtime/UI evidence | No |
| Capability registry | No |
| Next-builder handoff | No |
| Git commit/push | No |

`landos:memory:checkpoint` refreshes derived Git, dirty-tree, verification-record, runtime, and sprint summaries. It does not author the completed-work narrative, remaining work, next action, decisions, or failure history.

Completion is not one coherent transaction.

## R. Failure Memory + Repeat Work Prevention

Persisted failure/decision knowledge exists in:

- `.landos/qa/recurrence.json`
- Sprint ledger findings and repair records.
- Checkpoint Remaining Work and Completed/Protected sections.
- `.landos/DECISIONS.md`
- `.landos/HANDOVER.md`
- `.landos/KNOWN_LIMITATIONS.md`
- `.runtime/dev*/result.json`
- `.runtime/devloop/*/mission.json`
- Focused regression tests and comments.
- Capability known limitations and proof artifacts.
- Git history.

LandOS can answer “was this attempted?” only by searching these separate sources. It has no unified attempt/decision index.

For Tier-3 QA, `qa-brief` automatically inserts recurrence summaries. For a fresh builder, relevant prior failure and decision history is not automatically retrieved. The builder receives only what was promoted to the checkpoint, permanent memory, machine memory, request, or a manually generated task packet.

## S. Cross-Sprint Regression Protection

Existing protection:

- Unit and contract tests.
- Route/integration tests.
- Sprint requirement ledgers.
- Frozen capability invariants and journeys.
- `capability touched --paths`.
- Independent browser QA and final review for Tier 3.
- Recurrence root-cause gates.
- Live operator acceptance.

Automatic gaps:

- Neither development runner calls `capability touched`.
- Neither runner automatically runs protected journeys.
- Build runner derives a narrow changed/sibling suite rather than the full suite.
- Direct builder derives changed/related suites but still does not consult capabilities.
- Tier 1/2 do not use independent reviewers.
- Frozen acquisitions capability paths name the older `DealCard.tsx`/`Acquisitions.tsx` surfaces, while the default V2 workspace now lives under `AcquisitionWorkspaceV2*`.
- Regression protection depends on task classification and manual changed-path reporting.

Therefore a later sprint can break previously accepted functionality without immediate automatic detection when the broken contract lies outside derived tests or outdated capability paths.

## T. Lead/Deal Card Continuity Sample

| Example | Evidence | Continuity result |
|---|---|---|
| Lead Workspace replaced by canonical Deal Card | `c5d422d` accepted/froze Lead Workspace; `7081d89` completed canonical Deal Card; capabilities were later re-baselined and say the old Lead Workspace is retired/orphaned | The decision is persisted, but only through capability/docs/checkpoint inspection, not automatically retrieved by a builder |
| Property Intelligence repeatedly completed and repaired | `179cd12` end-to-end PI; `7081d89` canonical workflow; `9780877` fresh-lead research/valuation repair; `41c40c1` V2 PI completion; `5816a5e` Fairview acceptance repair; `76e2cd4` surfaces already-collected intelligence | Tests and Git preserve the sequence; automatic startup surfaces only the latest selected checkpoint summary |
| Comps/valuation repeatedly expanded and reconciled | `7a56bf6` Comps & Valuation polish; `eab05a2` retained-comp location repair; `b53787c` provenance surface; `76e2cd4` per-surface generation and retained-centroid corrections | Prior implementations existed, but the later surface-generation defect was not automatically prevented by earlier acceptance |
| Failed direct-builder attempt later implemented elsewhere | `.runtime/dev/t-20260812044925-7d8802/result.json` records a failed Claude run; its prose was misread as shell verification commands. Untracked task packet remains. `eab05a2` later completed the feature | Failure was not promoted into canonical handoff automatically; stale task state remains beside completed code |
| V2 workspace became default, then was redesigned and repaired | `00a89ac` made V2 default; `2ad8f98` redesigned it; `5816a5e` and `76e2cd4` repaired visible PI behavior | Capability paths still emphasize older Deal Card files, so the current UI lineage is discoverable mainly through Git and tests |

## U. Runtime LandOS Agent Agnosticism

### Core agents

Agent definitions live under `landos-agents/`. Resolution priority is implemented by:

- `resolveAgentDir()`
- `resolveAgentClaudeMd()`
- `listAgentIds()`
- `loadAgentConfig()`

Configured workhorses include acquisition-copilot/Ace, Duke, Forge, finance, marketing, strategy, security, dispositions, transaction coordination, and others.

Every checked `agent.yaml` names a Claude model:

- Mostly `claude-sonnet-4-6`.
- Forge uses `claude-opus-4-6`.
- Main has no YAML and uses main `CLAUDE.md` plus optional model override.

Normal execution:

```text
src/index.ts
  → src/bot.ts / scheduler / orchestrator
  → runAgent() or runAgentWithRetry()
  → @anthropic-ai/claude-agent-sdk query()
  → resume Claude session ID
```

Thus normal Ace/Duke/main workhorses are Claude-specific. Their conversational continuity is partly trapped in Claude session history, with the session ID stored in `store/claudeclaw.db`.

### LandOS-owned mission workflows

The runtime mission path is more neutral:

- Mission schemas and dependencies: `mission-graph.ts`.
- Execution: `mission-graph-runner.ts`.
- State: `mission-graph-store.ts`.
- Persistence: `landos_mission` and `landos_mission_child` tables in `store/landos.db`.
- Atomic child claims.
- Stored provider assignments, structured results, acceptance verdicts, failures, and evidence.
- Incomplete missions are reclaimed as interrupted after restart and cannot resume in place.

Provider-neutral completion components exist:

- `model-execution.ts`
- `provider-registry.ts`
- `model-router-service.ts`
- `mission-provider-routing.ts`

Supported completion surfaces include Anthropic, OpenAI, Google, OpenRouter, Ollama, LM Studio, vLLM, and optional Hermes. Codex and OpenCode are catalogued only as agent sessions, not mission-completion clients.

Current persisted router settings:

```text
landos.router.live_routing=1
landos.router.ollama_host=http://localhost:11434
```

No persisted Hermes completion endpoint or main-provider config file exists.

Current Deal Intelligence mission lanes explicitly declare themselves deterministic and do not engage a model. Hermes remains a specialized external evidence lane.

Runtime provider agnosticism is therefore partial: LandOS owns durable mission state, schemas, evidence, tools, and deterministic workflow logic, but normal conversational workhorses and their instruction files remain Claude-bound.

## V. Sources of Truth

| Category | Sources | Authority/enforcement |
|---|---|---|
| Permanent rules | Protocol, permanent memory, CLAUDE/AGENTS, docs | Protocol/permanent memory authoritative; duplicated guidance can drift |
| Development architecture | Live `package.json` and source, development context, runner docs | Live code wins; no enforcement that docs stay synchronized |
| Development memory | Checkpoint, permanent memory, Claude machine memory, history docs | Checkpoint is active handoff; histories manual |
| Current sprint | `current.json` and referenced ledger | Structured and deterministic for tracked sprint |
| Current task | Checkpoint; task packet; runner artifacts | Checkpoint authoritative by doctrine; conflicting stale packet exists |
| Latest accepted work | Git, checkpoint, Tyler acceptance, verification record | No transactional authority; sources currently disagree |
| Unfinished work | Git status, checkpoint, worktree state, runner artifacts | Live Git strongest; no ownership registry |
| Failures | Recurrence registry, ledgers, checkpoint, runner artifacts, tests, Git | Structured only inside sprint subsystem |
| Decisions | Permanent memory, checkpoint, capabilities, DECISIONS, docs, Git | Distributed |
| Development providers | Build/direct registries | Enforced by runner code |
| Runtime providers | Agent YAML, Claude SDK path, provider registry, dashboard settings | Multiple layers; normal agents bypass neutral registry |
| Agent configuration | `landos-agents`, external/repo fallbacks | Enforced by resolution priority |
| Verification requirements | Protocol, runner check derivation, sprint ledger, acceptance gate | Multiple disconnected enforcement points |
| Completion state | Runner status, ledger, OMP marker, checkpoint, Git | No single authority |
| Worktree ownership | Git registry and instructions | No LandOS ownership record |
| Runtime workflow state | `store/landos.db`; Claude sessions in `store/claudeclaw.db`; Hermes profile | Split between LandOS state and provider history |

## W. Duplicate / Bypassed / Disconnected / Dead Systems

| System | Classification |
|---|---|
| Current build runner | ACTIVE + MANUAL |
| Direct builder | ACTIVE + MANUAL, duplicate execution entry |
| Manual coding session | ACTIVE + MANUAL, bypasses runners |
| Sprint ledger | ACTIVE + MANUAL, disconnected from runners |
| Memory checkpoint/audit | ACTIVE + MANUAL, disconnected from completion |
| Recurrence registry | ACTIVE + MANUAL except QA-brief injection |
| Acceptance package gate | ACTIVE + MANUAL, separate from sprint completion |
| OMP guard | PARTIAL, OMP-only |
| Hermes LandPortal lane | ACTIVE runtime component, disconnected from development |
| Hermes development builder | BYPASSED / not implemented |
| Neutral runtime model router | PARTIAL; mission path only |
| `src/provider.ts` for normal agents | BYPASSED |
| Old mission harness and worktree integrator | DEAD/SUPERSEDED |
| `.landos/CURRENT_SPRINT.md` | SUPERSEDED |
| `.landos/OPERATING_STATE.md` | SUPERSEDED history |
| `LANDOS_CURRENT_STATE.md` | DOCUMENTATION ONLY / superseded |
| Trejon repository | DOCUMENTATION/REFERENCE ONLY |
| Untracked retained-comp task packet | STALE, non-authoritative |
| `.landos/verification-results.json` | ACTIVE format, stale current content |

## X. Actual Development Architecture Diagram

Legend: `──▶` automatic active after invocation, `- ->` manual/optional, `X` disconnected or bypassed.

```text
Tyler request
    |
    + - -> manual task packet / sprint ledger / plain prompt
    |
    +──▶ provider startup
           |
           +──▶ Claude: CLAUDE.md ──▶ protocol + permanent memory + checkpoint
           |
           +──▶ Codex: AGENTS.md - -> reads protocol + memory + checkpoint + dev context
           |
           + - -> live Git/runtime inspection

Development execution alternatives
    |
    + - -> npm run landos:build
    |        ──▶ planner
    |        ──▶ Claude/Codex lanes in SAME primary working tree
    |        ──▶ derived tests/typecheck
    |        ──▶ repair loop
    |        ──▶ status = READY
    |
    + - -> npm run landos:task
    |        ──▶ one explicit Claude/Codex builder
    |        ──▶ deterministic verification
    |        ──▶ one repair
    |        ──▶ status = VERIFIED/FAILED
    |
    + - -> direct manual coding and verification

All execution paths
    |
    + X sprint ledger automatic update
    + X capability-impact check
    + X independent browser QA automatic invocation
    + X verification-results update
    + X checkpoint update
    + X Git commit/push
    |
    + - -> manual Tier 2/3 acceptance
    + - -> manual sprint/QA/final-review commands
    + - -> manual checkpoint + memory audit
    + - -> manual Git handoff
    |
    └──▶ next session's provider-specific bootstrap

OMP X normal runner
Hermes X development runner
Old worktree/mission harness X superseded
```

## Y. Actual Runtime Architecture Diagram

```text
Telegram / dashboard / scheduler / war room
    ──▶ src/index.ts / src/bot.ts / src/orchestrator.ts
    ──▶ agent-config.ts
    ──▶ landos-agents/<id>/agent.yaml + CLAUDE.md
    ──▶ src/agent.ts
    ──▶ Anthropic Claude Agent SDK
    ──▶ Claude session history
              |
              └──▶ session ID + conversation records in store/claudeclaw.db

src/provider.ts neutral main-provider config X normal agent execution


Deal Card / Property Intelligence API
    ──▶ routes.ts / property-intelligence-live.ts / deal-intelligence-run.ts
    ──▶ mission-graph-runner.ts
    ──▶ MissionGraphStore
    ──▶ store/landos.db
          |
          +──▶ deterministic LandOS research/assembly lanes
          |
          +──▶ Hermes LandPortal lane
          |       ──▶ three Hermes specialists on CDP 9224
          |       ──▶ exact-subject importer
          |       ──▶ canonical LandOS evidence/state
          |
          + - -> provider-routed completion child
                  ──▶ mission-provider-routing.ts
                  ──▶ model-router-service.ts
                  ──▶ Anthropic / OpenAI / Google / OpenRouter
                       / Ollama / LM Studio / vLLM / optional Hermes

store/landos.db ──▶ snapshots/read models ──▶ V2 Deal Card UI
```

## Z. 20 Direct Answers

1. **NO** — Memory, execution, sprint, verification, completion, runtime, and Git handoff are coordinated by separate systems.

2. **NO** — The checkpoint is the active handoff, but permanent memory, machine memory, ledgers, recurrence data, verification, runtime artifacts, and Git contain other necessary state.

3. **YES** — Claude Code automatically imports permanent memory and checkpoint through `CLAUDE.md`; this is compact memory, not complete project history.

4. **PARTIAL** — Codex automatically receives `AGENTS.md`, which instructs it to read the shared files; it lacks Claude’s machine memory and does not receive them as one native injected bundle.

5. **NO** — Shared files exist, but there is no provider-neutral injection/handshake that supplies equivalent state to a new CLI.

6. **PARTIAL** — Live code HEAD is deterministic, but accepted-state metadata is split and checkpoint/verification records are currently stale.

7. **PARTIAL** — The checkpoint describes the latest completed work, but its metadata is stale and updates are manual.

8. **PARTIAL** — The checkpoint records remaining work, but live dirty work, stale task packets, and runner artifacts require manual reconciliation.

9. **YES** — Sprint findings, recurrence reviews, checkpoint sections, tests, docs, artifacts, and Git persist failures and rejected approaches.

10. **NO** — Builders do not automatically retrieve relevant failure/decision history; Tier-3 QA briefs do retrieve recurrence summaries.

11. **NO** — Build runner, direct builder, and manual coding are all active.

12. **NO** — Protocol acceptance, runner states, sprint completion, acceptance-gate PASS, OMP markers, and Tyler acceptance are separate definitions/states.

13. **NO** — Completion does not automatically update checkpoint, memory, verification, sprint, or Git handoff.

14. **NO** — Git worktrees are not assigned or leased to builders; the current runner intentionally shares one writable tree.

15. **PARTIAL** — They share repository memory, but context surfaces differ and both must manually reconstruct live Git, sprint, failure, and evidence state.

16. **NO** — These systems are separately invoked and several are bypassed or scoped only to runtime/OMP.

17. **YES** — Protected journeys and capability impact checks are manual and runner-derived tests are incomplete.

18. **PARTIAL** — Mission state/completion routing is provider-neutral, but normal Ace/Duke/main agents are Claude SDK sessions.

19. **NO** — The architecture functions as multiple cooperating but non-transactional subsystems.

20. **PARTIAL** — Bootstrap files expose doctrine and handoff, but actual runner duplication, stale state, provider bypasses, OMP, Hermes, and runtime splits require manual tracing.

## AA. Continuity Breakpoints

| Information that should flow | Source | Destination | Where flow stops | Consequence | Exact evidence |
|---|---|---|---|---|---|
| Successful build result | Build/direct runner | Checkpoint | Runners return `ready`/`verified` only | Next builder may not know completion | No memory imports/calls in runner completion paths |
| Latest accepted commit | Git | Checkpoint | Checkpoint command/manual content not run after every commit | Embedded HEAD stale | Checkpoint `822ce15`; live `76e2cd4` |
| Current verification | Tests/build/runtime | Verification record | Record updated separately | Evidence references older code/runtime | `verification-results.json` at `57b7d9f` |
| Dirty-tree truth | Git status | Checkpoint freshness | Regex finds later `106 pass` text | Incorrect dirty-count warning | Audit: `106` versus live `9` |
| Current task completion | Task/runner | Sprint ledger | Runners do not call sprint CLI | Runner success does not advance workstream | No sprint import in runner |
| Sprint completion | Ledger | Checkpoint | Only manual checkpoint command derives it | Next session may see old sprint summary | Checkpoint refresh is separate command |
| Failure evidence | Direct-builder result | Recurrence/checkpoint | Only sprint `qa-result` records recurrence | Failed attempts remain in `.runtime` | Failed retained-comp result not promoted |
| Accepted capability impact | Changed paths | Protected journey rerun | `capability touched` is manual | Cross-sprint regression may escape | No runner call site |
| Provider-neutral context | Shared memory files | New builder | No common context packaging/injection | New provider needs bespoke adapter/startup | Builder descriptors only |
| Claude handoff | Claude machine memory | Codex | Machine memory is Claude-local | Context differs after provider swap | Codex profile excludes machine MEMORY |
| Hermes learning | Hermes profile/session | LandOS development memory | Only validated runtime evidence importer crosses boundary | Hermes lessons do not become builder knowledge | No checkpoint/memory call in Hermes lane |
| OMP completion | OMP transcript | Sprint/verification state | Marker is not checked against ledger/tests | OMP can allow stop on text alone | Guard regex for PASS marker |
| Worktree ownership | Git worktree | Builder scheduler | No ownership registry or lease | Multiple writers can share one tree | Runner explicitly removes worktrees |
| Runtime agent provider selection | Neutral provider config | Core agents | `bot.ts` calls `runAgent()` directly | Core agents remain Claude-bound | `agent.ts` imports Anthropic SDK |
| Model conversation state | Claude session | LandOS workflow state | Session history remains provider-specific | Provider swap loses equivalent conversational context | Resume ID in `store/claudeclaw.db` |
| Accepted UI evidence | QA reports/screenshots | Fresh builder | Paths are not automatically loaded | Builder must rediscover or retrieve evidence | Startup excludes sprint reports/screenshots |
| Completed retained-comp task | Commit `eab05a2` | Task state cleanup | Untracked task packet remains | Disk contains a stale unfinished-task signal | `.landos/tasks/retained-comp-reconciliation.md` |
| Current V2 architecture | V2 source/commits | Capability registry | Registry paths emphasize older Deal Card surface | Impact query may miss current UI files | Capability shared dependency paths |

## AB. Evidence Index

### Core instructions and memory

- `AGENTS.md`
- `CLAUDE.md`
- `.landos/CODING_SESSION_PROTOCOL.md`
- `.landos/PERMANENT_MEMORY.md`
- `.landos/CHECKPOINT.md`
- `.landos/DEVELOPMENT_CONTEXT.md`
- `scripts/memory/landos-memory.mjs`
- `.landos/verification-results.json`
- `docs/landos/Memory_System_Audit.md`
- `docs/landos/Fresh_Session_Acceptance.md`
- `.claude/commands/continue-landos.md`
- `.claude/commands/done-landos.md`
- Claude machine `memory\MEMORY.md`

### Development execution

- `package.json`
- `scripts/devloop/build.mjs`
- `scripts/devloop/builders.mjs`
- `scripts/devloop/build.test.mjs`
- `docs/landos/build-runner.md`
- `scripts/dev/task.mjs`
- `scripts/dev/providers.mjs`
- `scripts/dev/verify.mjs`
- `scripts/dev/env-guard.mjs`
- `docs/landos/direct-builder.md`
- `.runtime/dev/`
- `.runtime/devloop/`

Important commands:

- `npm run landos:build`
- `npm run landos:task`
- `npm run landos:memory:status`
- `npm run landos:memory:audit`
- `npm run landos:memory:checkpoint`
- `npm run landos:sprint`
- `npm run landos:operator-qa`
- `npm run landos:acceptance:gate`
- `npm run landos:status`

### Sprint, failures, and acceptance

- `.landos/sprints/current.json`
- `.landos/sprints/sprint-2026-08-04-pi-workflow-finish/ledger.json`
- `.landos/sprints/sprint-2026-08-04-pi-workflow-finish/report.md`
- `.landos/capabilities.json`
- `.landos/qa/recurrence.json`
- `scripts/sprint/landos-sprint-cli.ts`
- `src/landos/sprint-system/orchestrator.ts`
- `src/landos/sprint-system/ledger.ts`
- `src/landos/sprint-system/capabilities.ts`
- `src/landos/sprint-system/recurrence.ts`
- `src/landos/sprint-system/qa-brief.ts`
- `.claude/agents/landos-browser-qa.md`
- `.claude/agents/landos-final-reviewer.md`
- `scripts/acceptance/completion-gate.mjs`
- `scripts/acceptance/contract-validator.mjs`
- `scripts/acceptance/generate-report.mjs`

### OMP and Hermes

- `.omp/extensions/landos-session-stop.ts`
- `scripts/omp/session-stop-guard.mjs`
- `scripts/omp/session-stop-guard.test.mjs`
- `.hermes.md`
- `config/hermes/landos-profile/SOUL.md`
- `config/hermes/landos-profile/memories/MEMORY.md`
- `config/hermes/landos-profile/memories/USER.md`
- `scripts/hermes/provision-landos-profile.mjs`
- `scripts/hermes/governed-profile-manager.mjs`
- `src/landos/hermes-landportal-auto.ts`
- `src/landos/hermes-landportal-import.ts`

### Runtime agents and providers

- `landos-agents/`
- `src/agent-config.ts`
- `src/index.ts`
- `src/bot.ts`
- `src/agent.ts`
- `src/orchestrator.ts`
- `src/scheduler.ts`
- `src/provider.ts`
- `src/landos/provider-model-bridge.ts`
- `src/landos/model-execution.ts`
- `src/landos/provider-registry.ts`
- `src/landos/model-router-service.ts`
- `src/landos/router-runtime-config.ts`
- `src/landos/mission-provider-routing.ts`
- `src/landos/mission-graph.ts`
- `src/landos/mission-graph-runner.ts`
- `src/landos/mission-graph-store.ts`
- `src/landos/deal-intelligence-mission.ts`
- `store/landos.db`
- `store/claudeclaw.db`

### Runtime and browser ownership

- `scripts/runtime/landos-runtime.mjs`
- `.runtime/landos/runtime.json`
- `src/landos/automation-browser.ts`
- `src/landos/automation-browser.test.ts`
- `src/landos/browser-cdp-identity.test.ts`
- `docs/landos/property-intelligence-sop.md`

### Representative commits

- `ec3da15` — operating memory and continuity workflow.
- `69dff67` — handoff/sprint/capability documentation.
- `189c49d` — runtime, sprint, and memory tooling.
- `d539e10` — agent-agnostic development improvement loop.
- `d8c74d2` — parallel mission harness.
- `9c3ca02` — provider-neutral front door.
- `23aa8bb` — direct-builder path.
- `61e62c7` — replaced mission harness with current build runner.
- `e7f46a4`, `f25d7a5` — Hermes foundation and incremental persistence.
- `c3158f6`, `fde34e1` — native runtime missions/fan-out.
- `c5d422d` — accepted Lead Workspace foundation.
- `7081d89` — canonical Deal Card workflow.
- `179cd12` — end-to-end Property Intelligence.
- `9780877` — fresh-lead research/valuation repair.
- `41c40c1` — V2 Property Intelligence workflow.
- `00a89ac` — V2 default workspace.
- `7a56bf6` — Comps & Valuation polish.
- `2ad8f98` — lead acquisition workspace redesign.
- `eab05a2` — retained-comp location reconciliation.
- `5816a5e` — Fairview PI acceptance repairs.
- `76e2cd4` — current HEAD, surfaces already-collected New Lead intelligence.

LANDOS_FULL_READ_ONLY_ARCHITECTURE_AUDIT_COMPLETE