# LANDOS SHARED FOUNDATION CONSOLIDATION
## One coherent production stabilization sprint — not four micro-sprints

We completed a read-only architecture audit of LandOS.

The audit found that LandOS DOES NOT need a new Agent / Skill / Tool architecture.

The important layers already exist:
- capability/tool registry
- deterministic research lanes
- Hermes skills and governed specialist profiles
- mission/orchestration infrastructure
- Research Readiness control plane
- evidence/provenance infrastructure
- Tools-page manual invocation
- governed MCP surfaces
- acceptance / visual QA infrastructure

The systemic problem is fragmentation between those layers.

The audit identified four shared contracts that need to become authoritative across LandOS:

1. Canonical Subject State
2. Declared Capability Prerequisites
3. Durable Run Identity + Cancellation
4. Unified Evidence Write + Status / Confidence Contract

This sprint implements ALL FOUR together as one coherent foundation.

Do not stop after completing only one contract and return asking for another prompt.

The end state matters more than arbitrary sprint duration.

---

# FIRST: TRUST ACTUAL CURRENT HEAD

The architecture audit was performed at an older repository HEAD.

DO NOT reset, checkout, revert, or otherwise move the repository back to the audit commit.

Start by inspecting:

- actual current HEAD
- working tree status
- commits since the audit baseline
- relevant current implementations

Reconcile the audit findings against the CURRENT code before editing.

Preserve all legitimate newer work, including any more recent fixes around:

- Intelligence run freshness
- evidence fingerprints
- progress UI
- refresh-safe run rejoining
- server-held in-flight state
- Deal Card behavior
- New Lead behavior
- Property Resolution improvements

The audit is architectural guidance, not a request to roll back the repository.

Do not modify or commit unrelated pre-existing untracked files.

---

# PRODUCT GOAL

This is not infrastructure for infrastructure's sake.

We are fixing the foundation so LandOS can reliably behave like this:

raw seller/operator input
→ establish the working property/context through any sufficient route
→ run every research capability whose own prerequisites are available
→ retain structured evidence
→ intelligently recover where deterministic research is incomplete
→ reconcile Research Readiness
→ build Property / Market / Seller / Deal Intelligence
→ hand the operator the most complete honest Deal Card possible

Future Deal Card specialists, Tools workflows, other departments, and eventually Jarvis/Max must consume these same shared contracts.

Do not build parallel foundations for them later.

---

# IMPORTANT LANDOS DOCTRINE

## Working subject vs official verification

These are DIFFERENT concepts.

A working research subject may be sufficiently established without official county verification.

Canonical/current state means:

LandOS's current best-supported working conclusion.

It does NOT mean an unquestionable legal source-of-truth.

Preserve:
- raw evidence
- competing claims
- provenance
- confidence
- contradictions
- superseded conclusions
- official verification state

But downstream systems must not independently re-decide the property identity once the working research subject has been sufficiently established.

Stronger official/legal evidence can upgrade confidence later.

Lack of official verification must not erase a research-grade established subject.

---

# PROPERTY ESTABLISHMENT DOCTRINE

LandOS is looking for THE PROPERTY, not a particular identifier.

Possible pointers include:
- APN / parcel ID
- full address
- partial-but-resolvable address
- LandPortal parcel URL
- survey
- deed
- owner
- uploaded documents
- other sufficiently specific evidence

If any valid route uniquely establishes the working property, LandOS may proceed.

Do not require every pointer to corroborate before research starts.

If APN fails but address succeeds, proceed.

If address fails but an exact LandPortal subject succeeds, proceed.

If a subject-matching survey/deed establishes the parcel, proceed.

Official verification can follow later.

---

# GOVERNING ACREAGE DOCTRINE

Canonical Subject State must support a single governing acreage conclusion while retaining alternate measurements as evidence.

For a valid subject-matching survey:

SURVEY GOVERNS surveyed parcel acreage, boundaries, and dimensions.

County GIS / assessor / LandPortal calculated acreage remain reference evidence.

Survey recency nuance:

- A subject-matching survey within roughly 5 years is generally current unless newer material parcel-change evidence exists.
- A survey within 0–60 days is especially fresh.
- During that 0–60 day window, county/GIS/assessor discrepancies should usually be treated as publication/update lag rather than a reason to reject the survey.
- After ~60 days, a material government-record discrepancy should be investigated/explained, but the survey still governs absent stronger conflicting legal/survey evidence.

Do not create a blocker merely because GIS acreage differs from a current survey.

---

# CONTRACT 1 — CANONICAL SUBJECT STATE

Inspect the existing:
- canonical identity code
- parcel identity code
- property resolution
- dossier assembly
- readiness consumers
- intelligence consumers
- UI consumers
- any other identity deciders/writers

Create/evolve ONE authoritative Subject State interface.

Do not create another parallel identity store if the current canonical identity infrastructure can be evolved.

The shared state should represent, at minimum, the concepts necessary for downstream prerequisite planning and research:

- subjectResolved
- officiallyVerified
- APN / normalized parcel identity
- situs / working address
- county
- state
- county FIPS where known
- ZIP where known
- owner where known
- governing acreage
- seller communications availability where relevant
- provenance / confidence sufficient to understand why the working subject is established

Use typed state rather than scattered prose flags.

Important:

`subjectResolved = true`
MUST NOT implicitly mean
`officiallyVerified = true`.

Migrate existing decision points so they CONSUME canonical state rather than independently re-deciding identity.

Find the real consumers instead of assuming the audit's count is still exact.

Eliminate contradictory logic.

When safe and demonstrably superseded, remove dead identity/resolution implementations instead of leaving ambiguous unused architecture in place.

Do not delete anything merely because the audit called it dead; verify actual current references first.

---

# CONTRACT 2 — DECLARED CAPABILITY PREREQUISITES

The current global parcel gate is wrong.

Capabilities should declare the minimum context THEY require.

Extend/reuse the existing Capability metadata/registry rather than creating another registry.

Support prerequisites conceptually equivalent to:

- county
- ZIP
- owner
- parcel / established subject
- seller communications
- potentially other genuinely necessary context discovered in current code

Do not over-model this.

The orchestrator should use declared prerequisites to determine what can run NOW.

Examples of desired behavior:

county known
→ County Market Research can run
→ County Market Pulse can run

ZIP known
→ ZIP Market Research can run

owner known
→ owner/public-record work that only needs owner/jurisdiction may run

seller communications available
→ Seller Intelligence/relevant analysis may run

exact working subject established
→ parcel-specific research may run

This means slow Property Resolution must no longer freeze unrelated market/seller work.

REUSE the existing mission graph scheduler if it already supports per-node/predecessor execution.

Fix declared edges/prerequisite planning instead of replacing the scheduler.

Research Readiness must also stop treating lack of exact parcel identity as a reason to invalidate requirements that do not need a parcel.

---

# MARKET PREREQUISITE BEHAVIOR TO PRESERVE

LandOS Market Research has two complementary geographies:

COUNTY = macro market
ZIP = local market pocket

When available, the system should eventually support both automatically.

Market Pulse should be able to begin county-wide as soon as county is known.

Subject/local relevance can refine later when ZIP/location is available.

Do not make Market Pulse wait for official parcel verification.

This sprint does NOT require redesigning Market Research or Market Pulse.

It DOES require ensuring the shared prerequisite architecture no longer prevents their existing valid execution.

---

# CONTRACT 3 — DURABLE RUN IDENTITY + REAL CANCELLATION

Fix the systemic class of bugs where:

- a run times out but its underlying work continues
- late work writes after the run is considered finished
- stale/superseded work overwrites newer work
- in-memory run maps wedge until restart
- refresh loses authoritative run state
- two overlapping runs mutate the same intelligence/evidence without ownership

Reuse existing run-identity/write-guard patterns where LandOS already implements them correctly.

Every long-running research/intelligence mission that can mutate shared state should have an authoritative durable run identity.

Writes from a superseded/cancelled/stale run must be rejected.

Implement/extend:

- durable run record
- runId propagation
- run status lifecycle
- abandonment ceiling
- cancellation state
- AbortSignal propagation where supported
- genuine cancellation endpoint for relevant research/intelligence runs
- guarded writes for derived intelligence/evidence/snapshots
- safe rejoin after page refresh/process reconnection where applicable

Do not create fake cancellation where the UI merely stops polling while work continues.

When a capability cannot technically be interrupted at the lowest layer, its late write MUST still be rejected if its run is no longer authoritative.

Timeout and cancellation are different:
- timeout may trigger cancellation/supersession
- cancellation prevents future authoritative writes

Preserve the progress behavior already implemented in current HEAD.

Do not regress:
- pending/running/complete/failed/skipped states
- elapsed time
- refresh-safe rejoin
- side-effect-free polling
- honest completion clearing

No fake percentage or ETA is required.

---

# CONTRACT 4 — ONE EVIDENCE WRITE + ONE RESULT VOCABULARY

LandOS currently has multiple evidence stores and multiple writers.

Do NOT necessarily collapse every storage table physically in this sprint if other stores serve legitimate specialized purposes.

Instead, establish ONE authoritative evidence admission/write contract for Deal research facts that downstream Deal Card/intelligence systems consume.

Prefer evolving the strongest current evidence table/path rather than inventing another.

Create/reuse something conceptually equivalent to:

`writeEvidence(...)`

All research lanes and adaptive recovery paths that produce Deal facts should enter through this contract.

The admission layer must preserve:

- subject/parcel scope
- source
- provenance
- timestamp
- confidence
- verification
- source type/tier
- evidence type
- extracted claim/fact
- supersession / contradiction where applicable
- originating capability
- originating runId

Browser/adaptive facts that are valid must be promotable into canonical Deal evidence.

A successful adaptive browser recovery cannot end as only a conversational paragraph.

Required path:

artifact retained
→ classified
→ structured facts/claims extracted
→ provenance recorded
→ evidence admitted
→ Research Readiness reconciled
→ downstream intelligence can consume it

---

# COMPLETION VOCABULARY

Unify the research/result state vocabulary.

Do not allow each subsystem to invent its own meaning of success.

Support the semantic states necessary to distinguish at least:

- SATISFIED / RETURNED
- PARTIAL
- NOT_RUN
- BLOCKED
- NOT_APPLICABLE
- NEEDS_OPERATOR_ACTION
- FAILED where technically appropriate

Map existing statuses into one authoritative contract instead of unnecessarily rewriting all storage.

Critical rule:

WORKER RAN ≠ REQUIRED OUTPUT RETURNED.

A capability invocation is successful for Research Readiness only when the required evidence/output actually landed and was recognized.

Examples:

A comp collector started but returned no valid comparable sales:
→ not satisfied.

Government workflow opened the correct county site but never established zoning:
→ not satisfied.

A paid deed is required and company doctrine prohibits purchase:
→ BLOCKED with exact reason.

CAPTCHA / legal human confirmation / account action requiring Tyler:
→ NEEDS_OPERATOR_ACTION.

Requirement irrelevant to the property:
→ NOT_APPLICABLE.

Do not use BLOCKED while a valid alternate route remains.

---

# CONFIDENCE / EVIDENCE WEIGHT

Consolidate the scattered confidence declarations into one shared semantic model.

Do not over-engineer a scoring system if the current evidence-ladder patterns are sufficient.

Reuse the strongest existing LandOS evidence-admission pattern.

Confidence must be derived from evidence quality, authority, agreement, recency, and scope — not asserted merely because an agent feels confident.

Preserve distinctions between:

- observed/source fact
- deterministic calculation
- interpretation
- assumption/hypothesis
- operator-confirmed working context
- decision/approval

Do not flatten those into a single field.

---

# RESEARCH READINESS

Research Readiness is the execution/control plane.

It must behave like:

Satisfied
→ reuse; stay satisfied

Missing + relevant
→ schedule appropriate capability

Partial
→ diagnose exactly what remains missing; attempt another valid route if available

New evidence
→ reconcile and re-plan

Not relevant
→ NOT_APPLICABLE

External source genuinely exhausted
→ BLOCKED with exact reason

Human action genuinely required
→ NEEDS_OPERATOR_ACTION

Do not mark attempted work as completed work.

Fix any current production path where `technicalSuccess` or equivalent means only "the process ran."

If the existing lane outcome already supports an `answered` concept, wire it correctly rather than creating another field.

---

# ADAPTIVE RECOVERY

The audit found adaptive-research-recovery logic exists but is not fully wired.

Where appropriate in this foundation sprint, connect existing recovery infrastructure into the shared result/evidence contract rather than building a new recovery framework.

The desired pattern is:

need
→ deterministic capability
→ validate required output
→ if incomplete, diagnose WHY
→ adaptive recovery if a valid route exists
→ structured evidence admission
→ readiness reconcile

Do not broadly introduce new specialist agents in this sprint.

The New Lead production-specialist work comes immediately after the shared foundation is stable.

This sprint should merely ensure the foundation can support that behavior.

---

# NO NEW ARCHITECTURE FOR ITS OWN SAKE

Do NOT add:

- another orchestration framework
- another agent dispatch framework
- Vercel Workflow as a runtime dependency
- Parallel Agent Dispatcher as a new runtime
- Smart Web Scraper
- new external MCP servers
- new generic plugin framework
- Jarvis/Max
- company-wide Skill Registry UI
- new UI redesign
- new department systems

Borrow useful patterns where appropriate.

Keep LandOS's existing governed infrastructure.

The architecture audit found existing MCP, mission, Hermes, capability, readiness and acceptance systems worth preserving.

Consolidate rather than replace.

---

# DEAD / DUPLICATE INFRASTRUCTURE

The audit identified probable dead or duplicated systems.

Verify against CURRENT HEAD.

If still genuinely unused/superseded and safe to remove, clean them up during this sprint so the new shared contracts do not coexist with misleading dead alternatives.

Potential areas include old resolution engines/snapshots/parallel-resolution paths and dormant dispatch infrastructure.

BUT:

Never delete based only on filename or audit text.

Prove:
- no live imports
- no dynamic usage
- no tests/fixtures depending on it
- no operational route depends on it

Prefer clearly retiring ambiguity over leaving five "canonical" implementations.

---

# CURRENT KNOWN REGRESSION CLASSES THAT THIS FOUNDATION MUST CLOSE

The implementation should eliminate the SYSTEMIC causes of:

1. property resolved in one subsystem but unresolved downstream
2. research-grade identity being erased because official verification is absent
3. market/seller work being blocked by exact-parcel resolution
4. stale intelligence immediately after successful completion
5. old asynchronous work overwriting newer results
6. capability rows appearing to run forever
7. timed-out work continuing to mutate Deal state
8. Research Readiness reporting success when the requested evidence never arrived
9. browser/adaptive findings failing to enter canonical evidence
10. competing acreage ladders producing different answers on different surfaces

Do not patch these individually at the UI layer.

Fix them through the four shared contracts.

---

# VALIDATION

Do not consider the sprint complete because TypeScript compiles.

Validate the foundation at multiple levels.

## Static / automated

Run the appropriate:
- typecheck
- unit tests
- integration tests
- architecture/contract tests
- relevant existing acceptance suites

Add focused regression tests for the new shared contracts.

At minimum prove:

A. Subject state:
- research subject may be resolved while officiallyVerified=false
- all migrated consumers see the same working subject
- governing acreage resolves consistently
- a fresh subject-matching survey can govern without GIS mismatch creating a blocker

B. Prerequisites:
- county-only capabilities can be scheduled without parcel resolution
- ZIP-only/local market capability can run with ZIP available
- parcel-specific capabilities wait for parcel
- seller-specific work does not depend on parcel unless genuinely required
- mission graph does not globally skip all research because one property lane is unresolved

C. Run identity:
- superseded run cannot write over current run
- cancelled run cannot perform authoritative late write
- timed-out work does not wedge run state forever
- refresh/rejoin behavior remains correct

D. Evidence:
- deterministic and adaptive evidence both enter through the shared admission path
- correct parcel/subject scope retained
- attempted-but-unanswered capability does not satisfy readiness
- PARTIAL/BLOCKED/NOT_APPLICABLE/NEEDS_OPERATOR_ACTION remain distinguishable

---

# REAL LANDOS ACCEPTANCE

After automated tests pass, exercise the actual local LandOS runtime.

Use existing acceptance/browser infrastructure.

Do not use a hardcoded old Deal as the sole proof.

Use current representative data and, where safe, create a fresh disposable test lead or controlled fixture to prove the new foundation.

We are not yet doing the full cold-lead matrix—that is the next production sprint—but this sprint must demonstrate at least:

1. New Lead creates/establishes a working subject.
2. Canonical Subject State is visible consistently to downstream consumers.
3. At least one county-only research capability can proceed independently of official parcel verification.
4. A parcel-specific capability correctly waits/runs based on its own prerequisite.
5. Research Readiness reflects actual returned evidence rather than invocation alone.
6. Intelligence/run state remains current after completion and refresh.
7. No superseded/late run can overwrite the accepted result.

Capture the evidence necessary under the existing LandOS sprint acceptance doctrine.

---

# PERFORMANCE / OPERATOR EXPERIENCE

This foundation must make LandOS more autonomous and faster, not slower.

Do not serialize work unnecessarily.

Independent safe capabilities should run concurrently once their prerequisites exist.

Avoid agent-to-agent uncontrolled spawning.

Primary mission/orchestrator owns the critical path.

No arbitrary 25-minute coding stop.

Work until the coherent foundation and its acceptance are complete.

Internal code defects encountered while implementing this scope are WORK, not external blockers.

A blocker is for genuine external impossibility:
- unavailable external service
- missing required secret that cannot be supplied
- payment prohibited
- human/legal action genuinely required
- etc.

Do not use BLOCKED because a test failed or a bug needs fixing.

---

# SECURITY / GOVERNANCE

Preserve:
- existing browser ownership controls
- approval spine
- secrets policy
- destructive-operation protections
- source licensing/provenance
- governed Hermes profiles
- MCP restrictions

Do not add Smart Web Scraper / anti-bot bypass behavior.

Do not expose secrets.

Do not purchase paid data/services.

Do not alter production infrastructure.

---

# GIT / COMPLETION

Work from actual current HEAD.

Do not reset legitimate newer commits.

Keep unrelated pre-existing changes/untracked files untouched.

When the complete foundation is accepted:

1. run final relevant tests
2. run final real acceptance
3. inspect git diff/status
4. commit the coherent sprint
5. push
6. verify the pushed remote commit
7. stop

Do not leave a successful completed sprint sitting uncommitted.

Do not push until acceptance really passes.

---

# FINAL REPORT

Return one concise but complete report containing:

## WHAT CHANGED
The four shared contracts and what existing infrastructure they replaced/wrapped.

## WHAT WAS REUSED
Existing LandOS systems preserved rather than recreated.

## WHAT WAS RETIRED
Only genuinely dead/duplicative infrastructure removed.

## BEHAVIORAL PROOF
Show the actual acceptance evidence for:
- canonical subject consistency
- independent prerequisites
- run identity/cancellation
- unified evidence/readiness

## TESTS
Commands and results.

## CURRENT ARCHITECTURE
Briefly show:

New Lead
→ shared Subject State
→ prerequisite-driven Mission Graph
→ existing Capabilities / Skills / governed recovery
→ unified Evidence admission
→ Research Readiness
→ Intelligence
→ Deal Brain

## DEFERRED — INTENTIONALLY NOT PART OF THIS SPRINT
- full New Lead specialist production slice
- Public Records recovery specialist
- Deal-specific SKILL.md authoring beyond anything strictly necessary for foundation validation
- MCP activation
- full cold-lead acceptance matrix
- Tools UI normalization
- UI/UX redesign
- Seller Call Prep / Daily Brief / department skills
- Jarvis / Forge

## GIT
- starting HEAD
- ending commit
- push result
- remote verification

Finish with exactly:

LANDOS_SPRINT_COMPLETE: PASS

If and only if a genuine external blocker prevents completion, use:

LANDOS_SPRINT_BLOCKED: <exact external blocker>

Do not use BLOCKED for an internal implementation problem.
