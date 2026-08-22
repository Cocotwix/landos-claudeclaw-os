# LandOS Knowledge Compiler Foundation Blueprint

Date: 2026-08-22
Repository baseline: `429785c5059e3a3bd3e1385d082cd41db994f9c1`
Mode: read-only architecture / implementation blueprint
Scope: compiled company knowledge only; no runtime, schema, data, Hermes, War Room, voice, or UI change was made by this audit.

## 1. Executive verdict

**Build the Knowledge Compiler foundation now, but build it as a small LandOS-owned compilation and retrieval layer inside the existing operating database—not as a new memory platform.**

The missing capability is not evidence capture, reasoning, or specialist continuity. LandOS already has all three. The missing capability is a canonical, cross-deal record of reusable conclusions that were derived from verified evidence, remain linked to that evidence, can become stale or superseded, and can be retrieved by scope before research begins.

Today, a future property can reuse some source-routing knowledge and regulation document URLs, but it cannot reliably ask one canonical service for “the current accepted rules LandOS already knows for this controlling jurisdiction.” The extracted rule values themselves remain attached to a prior Deal Card's evidence and derived snapshot. Likewise, LandOS can reason about a property pattern in a specialist prompt, but it has no governed company-knowledge record that says the pattern was proposed, validated across evidence, promoted, invalidated, or superseded.

The practical architecture is:

```text
canonical evidence + deterministic retained records
                    |
                    v
       bounded candidate compilation
                    |
                    v
     LandOS knowledge records + support links
                    |
         +----------+----------+
         |                     |
         v                     v
 exact/structured reads   rebuildable FTS projection
         |                     |
         +----------+----------+
                    v
       capabilities and specialists
```

The existing primitives are sufficient to build most of this by connection. The genuinely new foundation is small: one canonical knowledge-record contract, one evidence-support link contract, deterministic freshness/supersession/conflict rules, and scoped retrieval. No vector database, graph database, queueing platform, or Kernel Memory service is justified for V1.

## 2. What LandOS already has

### 2.1 Canonical and source-labeled evidence

LandOS already has several evidence stores with real provenance rather than a single undifferentiated facts table:

| Existing primitive | Current owner and behavior | Reuse for compiler |
| --- | --- | --- |
| `landos_property_evidence_item` | Append-only, Deal Card and property-identity-version scoped; raw and normalized values; source name/URL/tier; verification status; confidence; retrieved/effective/fresh-until dates; `supersedes_evidence_id`; `dispute_group`; idempotency key | Primary support source for verified property, jurisdiction, zoning, and rule evidence |
| `landos_capability_evidence` | Durable evidence per capability invocation; source label/URL/type, retrieval time, subject scope, details JSON | Support source for runtime-capability results and compile triggers |
| `landos_card_source_evidence` | Older Property Card evidence with source type, URL, access date, and offer-logic admission flag | Legacy support only; do not make it the preferred compiler input |
| `landos_property_record_artifact` and `landos_property_zoning_artifact` | Append-only artifact registries with hash, official provenance, identity version, collector lineage, source references, and retrieval time; bytes stay in the gitignored artifact store | Source/artifact lineage and source actions |
| `landos_opportunity_transcript` | Immutable raw seller transcript | Deal/contact-private evidence; never broad company knowledge |
| `landos_opportunity_canonical_fact` | Append-only seller-stated or verified fact history, transcript/reconciliation provenance, conflict status, and supersession | Same-opportunity or same-contact retrieval only; possible support for a later de-identified pattern, never raw cross-deal retrieval |
| `landos_comp`, Market Matrix, and Market Research stores | Structured comp and geography records plus retained snapshot/metric provenance | Future market-knowledge inputs; not needed in first slice |

The strongest evidence seam is `landos_property_evidence_item`. It already carries most of the conceptual fields the prompt expected: identity, provenance, source authority, verification, confidence, effective time, freshness, supersession, dispute grouping, and dedupe identity.

### 2.2 Versioned derived intelligence

`src/landos/derived-intelligence-store.ts` already implements the correct derived-read pattern:

- append evidence only after current property identity exists;
- derive an input hash from identity, type, and payload;
- no-op when the same input has already been processed;
- keep one current snapshot per Deal Card and snapshot type;
- mark the prior snapshot `superseded` instead of overwriting history;
- keep evidence lineage and an audit event.

`landos_deal_intelligence_snapshot` is used by land-use reads, official-document intelligence, Property/Market/Seller/Deal intelligence, and other current products. It proves LandOS already understands that a judgment is not evidence and that a refreshed judgment must not erase the prior one.

It is not, however, the canonical knowledge store: every row is Deal Card scoped, and `summary_json` is a current-deal product rather than a normalized cross-deal knowledge record.

### 2.3 Jurisdiction and procedural reuse already in production

LandOS already has multiple narrow examples of company knowledge:

- `landos_county_source_map` retains public-record routing by state/county and applies a 30-day freshness check when deciding whether to reuse it.
- `landos_official_site` retains a verified government's official site and applies a 90-day reuse window.
- `landos_regulation_document` retains the stable adopted subdivision-document set by jurisdiction, unit type, and document kind, including adoption/as-of metadata, draft/proposed state, rule count, and last verification.
- `landos_gis_platform_knowledge` retains demonstrated capabilities of a GIS platform family.
- `landos_gis_deployment` retains how a deployment host is shaped and mechanically rejects property evidence from the shared store.
- `landos_state_law_source` retains how to locate and parse a state's legal publication while mechanically rejecting legal conclusions from the shared locator row.
- `landos_platform_intel` and approved browser playbooks retain reusable source-navigation method.

These are not prototypes. They encode the right foundational boundary: **share the method and jurisdiction-level source knowledge; never leak one property's values into another.**

### 2.4 A nearly complete Jurisdiction Knowledge read model

`src/landos/zoning-subdivision-capability.ts` already defines:

- a jurisdiction-scoped `rulePackageKey`;
- `rulePackageReused`;
- retained jurisdiction documents;
- controlling zoning and subdivision authorities;
- one structured rule row per rule, with key, label, value, unresolved state, section, source label/URL, authority, confidence, and `scope: 'jurisdiction'`;
- a deterministic `retained_rules` lane distinct from live research;
- source facts and a parcel-specific zoning boundary.

The existing V2 Zoning & Subdivision component already renders “Jurisdiction rule package (reused for this jurisdiction).” The gap is narrower than a new system: the document set is cross-deal, but the accepted rule values used to assemble the package still come from a Deal Card-scoped derived snapshot and evidence rows. A future Deal Card does not yet retrieve the prior jurisdiction's compiled rule values as its canonical starting point.

### 2.5 Research Readiness and reuse/refresh semantics

`src/landos/research-readiness.ts` already separates:

- green: usable;
- blue: usable but stale;
- red: missing or technically failed;
- yellow: a proper attempt returned an honest unresolved result;
- gray: human expected/not applicable.

It also refuses blind reruns: green is not rerun, yellow is not looped, gray is not automated, and blue requires explicit refresh. The runtime capability contract and `landos_capability_invocation` already carry `mode: 'reuse' | 'refresh'`, idempotency, durable failures, and a `findReusable` path.

The compiler should reuse this posture, not introduce a second meaning of stale or a second execution mode.

### 2.6 Market retained records

LandOS already retains factual market data in two compatible systems:

- Market Matrix: geography + acreage band + side + period, with provider/source/extraction provenance and read-time derived scores.
- Market Research quarterly snapshots: immutable retained snapshot/metric rows, geography identity, collection ledger, and audited corrections as the only mutation path.

These are suitable future inputs for compiled market relationships. They are not yet sufficient by themselves to promote “submarket X has a durable premium” because LandOS lacks a promotion contract, repeat-observation threshold, invalidation rule, and knowledge freshness policy.

### 2.7 Exact, structured, and long-form retrieval

LandOS already has:

- exact/structured SQLite reads and indexes for APN/property identity, county/FIPS/geography, capability subject, Deal Card, source URL, snapshot type, jurisdiction key, regulation-document kind, and market dimensions;
- repository Markdown search for governed operating knowledge under `docs/landos/knowledge`;
- local SQLite FTS5 in `src/landos/rag-knowledge.ts` for long-form context;
- idempotent document ingestion, content hashes, paragraph-aware chunking, metadata filters, current-vs-historical evidence filtering, citations/source URLs, and retrieval logging;
- a bridge in `src/landos/rag-ingest.ts` that can rebuild chunks from existing Card evidence, canonical projections, documents, and repository playbooks.

The FTS layer is already the right V1 long-form index. It is explicitly non-authoritative. It should remain a projection of canonical evidence/knowledge, not become the canonical knowledge record.

### 2.8 Hermes specialist memory and skills

The four persistent specialist profiles own identity, reasoning style, cognitive memory, validated reasoning lessons, and eventually approved skills. LandOS remains authoritative for facts, evidence, operational state, calculations, capability execution, current intelligence, and deal scope.

The existing Level 1–5 anti-drift ladder is sound:

1. deal observation;
2. pattern/hypothesis;
3. validated recurring pattern;
4. promoted specialist skill;
5. deterministic LandOS rule.

Production specialist and War Room prompts already state that current LandOS context outranks profile memory. Production runs use isolated one-shots and do not write permanent specialist memory. That boundary should not change.

### 2.9 Existing tables that should not be repurposed

Several names look tempting but do not satisfy the contract:

- `landos_aip_knowledge` has proposed content, citations, confidence, version, and source asset, but lacks normalized scope, freshness, effective dates, conflict state, multi-evidence support, supersession, and retrieval policy. It belongs to the Acquisition Intelligence Program content system.
- `landos_training_knowledge` is output from browser-training sessions, with categories and proposed/saved/discarded state. It is not verified company/world knowledge.
- `landos_rule` is an approved business/software rule registry, not a factual world-knowledge store.
- `memories` in `store/claudeclaw.db` is chat-scoped, LLM-extracted, decayed/salience-ranked, and optionally embedding-backed. It is cognitive/conversation memory, not an authoritative business record.
- `docs/landos/knowledge` explicitly documents repository operating knowledge and explicitly refuses to duplicate canonical business data.
- `landos_rag_document`/chunks are a derived retrieval index whose content can be re-chunked and replaced. They are not canonical knowledge.

## 3. Current gaps

The exact missing pieces are:

1. **No canonical cross-deal knowledge owner.** Reusable conclusions are scattered across specialized cache tables, per-deal evidence, prompts, and docs.
2. **No normalized knowledge identity.** There is no stable `(domain, scope, subject)` key for “Fairview/subdivision/minimum-road-frontage” or “global/property-pattern/provider-improvement-conflict.”
3. **No general support-link contract.** Evidence IDs exist, but across different namespaces and ID types. No knowledge record can link to several supporting or conflicting evidence rows without copying them.
4. **Jurisdiction values remain per deal.** Official sites and document sets are shared; extracted authority/rule/standard values remain Deal Card snapshots/evidence.
5. **No first-class compiled freshness policy.** Existing freshness behavior is correct but distributed: evidence `fresh_until`, Readiness `freshnessDays`, county routing 30 days, official sites 90 days, market periods, and snapshot fingerprints.
6. **No cross-deal supersession contract.** Evidence and per-deal snapshots support supersession; retained jurisdiction caches generally upsert and lose historical transitions.
7. **No knowledge-level conflict response.** Evidence can have dispute groups and current products carry conflicts, but a reusable knowledge lookup cannot return “conflicting/unresolved” as the controlling company state.
8. **No promotion workflow for patterns.** A specialist can hold a hypothesis, and governed skills have review, but there is no audited bridge from evidence-backed pattern candidate to accepted company knowledge.
9. **No scoped knowledge-retrieval API.** Consumers have many targeted reads but no single contract returning current knowledge, stale knowledge, conflicts, provenance actions, and a `REUSE/REFRESH/RESEARCH_NEW` decision.
10. **The FTS index is not fully declared rebuildable.** Its ingestion bridges are idempotent, but there is no one canonical rebuild command that can drop/recreate the projection from canonical sources and knowledge records.
11. **No outcome-learning loop.** Decisions/outcomes can be recorded operationally, but they do not yet validate or invalidate knowledge patterns.

## 4. Ownership model

| Layer | Canonical owner | May contain | Must not contain / decide |
| --- | --- | --- | --- |
| Canonical evidence | Existing LandOS evidence/artifact/transcript/market stores | What a source said/showed, raw and normalized values, source provenance, identity scope, retrieval/effective time | Cross-source conclusion presented as fact |
| Operational state | Existing LandOS operational tables in `store/landos.db` | Opportunity/deal/seller/contact/stage/workflow/task/offer/transaction/capability execution | General company/world knowledge |
| Compiled knowledge | New additive LandOS knowledge records and support links in `store/landos.db` | Reusable factual, reconciled, procedural, market, and validated pattern knowledge; scope, freshness, conflict, supersession, evidence links | Raw seller transcript; unverified LLM assertion; current parcel fact for a different parcel |
| Hermes memory/skills | Isolated governed Hermes profiles plus repo-governed skill sources | How to reason/work, validated investigative method, operator reasoning corrections | Current world/property/deal truth |
| Current intelligence | Existing Property/Market/Seller/Deal products in `landos_deal_intelligence_snapshot` | What evidence + relevant knowledge mean for this deal now | Canonical evidence or cross-deal truth ownership |
| Retrieval index | Existing SQLite FTS5 plus future optional derived indexes | Search projection, chunks, rank, metadata, source pointers | Canonical acceptance, freshness, supersession, or conflict resolution |

Authority order at consumption time:

```text
current verified subject evidence
  > current accepted compiled knowledge
  > stale/superseded/conflicting knowledge (context only, explicitly labeled)
  > Hermes cognitive memory
```

Compiled knowledge does not outrank current evidence merely because it is cross-deal. If current evidence conflicts, the consumer receives the conflict and asks whether a bounded verification matters.

## 5. Microsoft Kernel Memory assessment

### 5.1 Source status

The current Microsoft repository describes itself as an **archived research project**, a learning resource rather than production software, with no support. It describes Kernel Memory as a service/reference implementation for document ingestion and RAG: [Microsoft Kernel Memory repository](https://github.com/microsoft/kernel-memory).

The repository's default ingestion pipeline is extract text → partition/chunk → generate embeddings → save to a vector index. It supports document IDs, tags/filters, source lineage/citations, custom ordered pipeline handlers, swappable file/vector/queue/model providers, in-process execution for smaller inputs, and asynchronous service execution for larger workloads. Its service architecture separates upload/query HTTP handling from background ingestion and externalizes document storage, memory/vector storage, embeddings, text generation, and queues: [Kernel Memory service architecture](https://github.com/microsoft/kernel-memory/blob/main/service/Service/README.md).

The code is MIT licensed, so selective borrowing is legally possible if the notice is preserved: [Kernel Memory license](https://github.com/microsoft/kernel-memory/blob/main/LICENSE).

### 5.2 Directly useful concepts

1. **Stable document identity and idempotent ingestion.** LandOS already has `doc_key`, source hashes, evidence idempotency keys, and artifact hashes. Knowledge should use the same pattern.
2. **Source storage separated from search partitions.** Canonical evidence/artifacts remain the source; chunks and future embeddings are disposable projections.
3. **Ordered bounded handlers.** Candidate extraction, lookup, comparison, reconciliation, acceptance, and indexing should be explicit stages with typed inputs/outputs.
4. **Metadata-first filtering.** Scope, jurisdiction, status, freshness, evidence lifecycle, privacy, and document type must filter before ranking.
5. **Citations returned with retrieval.** A knowledge hit must return the knowledge record plus useful source actions, not just generated prose.
6. **Swappable processing handlers.** Long-document extraction or a future semantic index should sit behind a LandOS interface, not become the owner of the data.
7. **Async only when workload requires it.** V1 compilation is small/event-driven and belongs in-process or in the existing durable capability flow; no queue service is warranted.
8. **Hybrid search as an optional retrieval mode.** Exact/structured filters remain mandatory even if semantic ranking is added later.

### 5.3 What LandOS already has

LandOS already overlaps with most of the useful architecture:

- content extraction and chunking;
- source/document metadata and URLs;
- content hashes and idempotent ingestion;
- FTS5 lexical ranking;
- evidence-status and geography/deal filters;
- current-versus-historical retrieval separation;
- citation/source return;
- retrieval audit logging;
- swappable provider/capability adapters;
- durable execution ledgers and idempotency;
- canonical evidence separated from derived reads and indexes.

### 5.4 What LandOS should implement itself

LandOS should implement the domain-specific part Kernel Memory does not provide:

- canonical knowledge scope and identity;
- evidence admission and source-authority rules;
- jurisdiction/property privacy boundaries;
- deterministic freshness status;
- effective dates and supersession;
- unresolved conflict representation;
- promotion from candidate to accepted company knowledge;
- `REUSE/REFRESH/RESEARCH_NEW` decisions;
- specialist consumption without factual memory contamination.

### 5.5 Unnecessary for V1

- embeddings;
- a hosted/local vector database;
- Kernel Memory's Docker/web service;
- RabbitMQ/Azure Queues or a new worker fleet;
- a second file store;
- a .NET runtime/service boundary;
- connector breadth for many vector/file/model providers;
- LLM answer generation over the knowledge store;
- synthetic memory.

### 5.6 Code reuse verdict

**Conceptual reuse only for V1.** Although MIT permits copying, the useful ideas already have native TypeScript/SQLite equivalents in LandOS. Translating Kernel Memory's .NET service abstractions would add a second framework without closing the LandOS-specific governance gap. If a future implementation borrows a small algorithm or interface directly, preserve the MIT notice and record the exact upstream commit; do not import or run the archived service.

### 5.7 Rebuildability rule

Any search/vector index must be reproducible from:

1. canonical source/artifact/evidence records;
2. accepted compiled knowledge records and support links;
3. a versioned projection/indexer implementation.

Deleting the FTS/vector projection must lose ranking speed only, never evidence, acceptance, freshness, conflict, or supersession state. A rebuild must produce a manifest containing projection version, source high-water marks/content hashes, record/chunk counts, start/end time, and failures. Failed indexing must never demote canonical knowledge.

## 6. Knowledge record contract

### 6.1 Taxonomy

Use five knowledge types:

- `factual`: a reusable verified proposition stated by authoritative evidence;
- `reconciled`: a reusable conclusion produced by a deterministic LandOS reconciliation over multiple evidence items;
- `procedural`: where/how an authority or source must be reached and how the process works;
- `pattern`: a validated recurring relationship, never one clever observation;
- `market`: a quantified recurring market/submarket relationship derived from retained market records.

“Time-sensitive” should be a freshness policy, not a separate content type. A factual, procedural, pattern, or market record can all decay at different rates. Historical events remain evidence; they become knowledge only when a reusable statement about them is justified.

### 6.2 Smallest canonical record

Recommended logical contract (names may be adjusted to repository conventions):

```ts
interface LandosKnowledgeRecord {
  id: string;                    // stable LandOS knowledge id
  domain: 'jurisdiction' | 'property_pattern' | 'market';
  knowledgeType: 'factual' | 'reconciled' | 'procedural' | 'pattern' | 'market';
  scopeKind: 'global' | 'state' | 'jurisdiction' | 'market' | 'submarket' | 'property' | 'deal' | 'seller' | 'contact';
  scopeKey: string;              // normalized, deterministic
  subjectKey: string;            // e.g. subdivision.minimum_road_frontage
  statement: string;             // bounded human-readable projection
  value: unknown;                // normalized structured value
  sourceAuthority: string;       // existing source-tier vocabulary
  confidence: 'confirmed' | 'well_supported' | 'likely' | 'unresolved';
  status: 'candidate' | 'active' | 'conflicting' | 'unresolved' | 'superseded' | 'rejected';
  sensitivity: 'public' | 'internal' | 'deal_private' | 'seller_private';
  effectiveFrom: string | null;
  effectiveTo: string | null;
  retrievedAt: string;
  lastVerifiedAt: string;
  freshnessPolicy: string;
  freshUntil: string | null;
  supersedesKnowledgeId: string | null;
  disputeGroup: string | null;
  contentHash: string;
  compilerVersion: string;
  createdBy: string;
  createdAt: string;
}
```

Do not duplicate `superseded_by`; it is the inverse lookup of `supersedesKnowledgeId`. Do not embed a provenance dump in the record. Keep source lineage in a support table:

```ts
interface LandosKnowledgeSupport {
  knowledgeId: string;
  evidenceNamespace:
    | 'property_evidence'
    | 'capability_evidence'
    | 'regulation_document'
    | 'record_artifact'
    | 'market_metric'
    | 'seller_fact';
  evidenceRef: string;
  role: 'supports' | 'conflicts' | 'supersedes';
  evidenceFingerprint: string;
}
```

The namespace is necessary because LandOS currently has several valid evidence ID domains. V1 should support only the namespaces it actually compiles; it should not pretend a polymorphic string is a database foreign key. A deterministic resolver must verify every referenced row at compile/read time, and acceptance must fail if a required support reference cannot resolve.

Use the existing `landos_audit_log` for acceptance/rejection/supersession events. Add a separate knowledge-event table only if the existing audit payload cannot reconstruct the transition without copying private data.

### 6.3 Stable identity

Knowledge identity should be deterministic from normalized semantics, not generated prose:

```text
domain | scope_kind | scope_key | subject_key | effective_from/version
```

Examples:

- `jurisdiction | jurisdiction | TN:local:fairview | subdivision.minimum_road_frontage`
- `jurisdiction | state | TN | legal_source.publisher_route`
- `property_pattern | global | global | provider_improvement_vs_current_visual_conflict`

`statement` is a readable projection. `value` and the typed subject key drive comparison, supersession, and retrieval.

## 7. Freshness and supersession model

### 7.1 Reuse current semantics

V1 must not create one universal TTL. Resolve freshness in this order:

1. explicit source/evidence `fresh_until`, when present;
2. existing source-specific policy (for example county routing's current 30-day rule or official-site routing's current 90-day rule);
3. a deterministic knowledge-type policy owned in code;
4. otherwise `freshUntil = null` and a required source-version check before reuse—not “fresh forever.”

Recommended policy classes:

| Policy | Examples | V1 behavior |
| --- | --- | --- |
| `volatile_current` | proposed moratorium, utility capacity, active approval/listing, current seller posture | Very short explicit expiry; generally not compiled beyond its narrow scope in V1 |
| `current_subject_state` | owner, parcel configuration, current zoning district, current market state | Refresh before material use when expired; parcel-specific evidence always wins |
| `jurisdiction_procedure` | authority, approval body, subdivision procedure, adopted road/private-street rules | Reuse while current; targeted source/version check when stale |
| `source_locator` | official site, assessor/GIS route, state-law publisher shape | Reuse existing 30/90-day cache semantics by locator type |
| `historical_event` | recorded deed event, historical meeting event, prior seller communication | Does not decay as an event; may be superseded only as a current-state interpretation |
| `validated_pattern` | approved cross-deal property pattern | No clock-only expiry; revalidate on contradicting outcomes/evidence and periodic governance review |

The first implementation slice should not invent a universal number for adopted rules. It should mark the policy `jurisdiction_procedure`, retain `lastVerifiedAt`, use source version/effective date when available, and require a bounded official-source refresh when the policy says stale. A policy ceiling can be chosen in the implementation acceptance fixture after examining actual jurisdiction update frequency; it belongs in one policy resolver, not scattered rows.

### 7.2 Read-time state

Freshness is computed, not trusted from a cached label:

```text
ACTIVE + within policy       -> CURRENT
ACTIVE + outside policy      -> STALE / REFRESH_REQUIRED
CONFLICTING                  -> CONFLICTING, regardless of age
SUPERSEDED                   -> HISTORICAL_ONLY
UNRESOLVED/CANDIDATE         -> NOT_REUSABLE_AS_FACT
```

A stale record can inform the next check, but cannot silently carry a current conclusion.

### 7.3 Supersession decision table

For the same `(domain, scope, subject)`:

| New evidence/result | Action |
| --- | --- |
| Same normalized value, same effective state | Attach new support, advance `lastVerifiedAt`, keep one current record |
| Different value with authoritative effective date/version proving replacement | Insert new active record; transactionally mark old superseded and set old effective end when known |
| Different value but authority/vintage cannot resolve which controls | Do not supersede; place competing records in one dispute group and return `CONFLICTING` |
| Older evidence describing a prior state | Retain as historical/effective-ended knowledge; do not disturb current record |
| Current subject evidence conflicts with compiled knowledge | Current evidence wins for the deal; mark knowledge refresh/conflict candidate and schedule a bounded re-verification |

“Newer retrieval time” is never sufficient by itself. Effective date, source authority, subject identity, and source version decide whether the world changed.

## 8. Conflict model

The compiler must preserve competing claims, not synthesize fake certainty.

1. Normalize all candidates to the same scope and subject key.
2. Compare structured values and effective periods.
3. Apply deterministic authority/effective-date rules only where the domain defines them.
4. If no rule resolves the difference, set a stable `disputeGroup` and keep each claim with its support link.
5. Structured retrieval returns:

```ts
{
  state: 'CONFLICTING',
  subjectKey: '...',
  claims: [{ value, confidence, effectiveFrom, sourceActions }],
  cheapestVerification: '...'
}
```

6. The current specialist sees the conflict, the provenance actions, and whether verification is material. It never receives a generated “best guess” under the active-fact field.

Existing `dispute_group`, current intelligence conflict arrays, seller `conflict_status`, and yellow Readiness semantics should supply the vocabulary and behavior.

## 9. Knowledge scope and privacy model

| Scope | Retrieval boundary | Suitable content |
| --- | --- | --- |
| Global | Any deal, subject to sensitivity | Approved generalized patterns and procedures |
| State | Same state | State-law source routes and state procedures |
| Jurisdiction | Exact normalized controlling authority + state + authority level | Authority, official sources, adopted procedures/rules |
| Market/submarket | Exact geography identity and time/band filters | Validated market relationships |
| Property | Same confirmed APN + county/state or LandPortal ID + FIPS | Property history/pattern specific to that parcel; not V1 cross-deal knowledge |
| Deal | Same Deal Card/opportunity only | Deal hypotheses, decisions, private evidence |
| Seller/contact | Same canonical seller/contact only | Communications and seller-specific state |

Rules:

- V1 Jurisdiction Knowledge accepts only `public` or safe `internal` records.
- Raw seller communications and transcript chunks never enter global/state/jurisdiction/market retrieval.
- Seller/contact/deal knowledge is excluded from broad searches even on a single-user local system; local-only is not a substitute for structural scope.
- A generalized negotiation pattern may later be supported by private evidence, but the accepted pattern record is de-identified, retrieval does not return raw support text, and promotion requires explicit approval.
- Property-scoped knowledge requires the same hard parcel-identity gate as current evidence.
- Semantic search, if added, must apply scope/privacy filters before similarity ranking.

## 10. Jurisdiction Knowledge V1

### 10.1 Exact contents

Compile only facts that are true because of the controlling government, not because of the subject parcel:

- normalized jurisdiction identity: state, authority level, normalized key, display name;
- zoning authority and subdivision authority, including determination basis;
- official jurisdiction site and relevant department/source URLs;
- regulation document set, document identity, adopted/as-of/effective version, draft/proposed state;
- approval/review body and process where the official source establishes them;
- minor/major subdivision definitions and thresholds;
- plat/survey/submission requirements;
- minimum lot-size rule source and whether the rule defers to parcel zoning;
- frontage, public/private road, shared-drive, flag-lot, parent-tract/lookback, utility/septic authority/rules where established;
- known ambiguity/conflict records;
- source version, last verification, and freshness state.

### 10.2 Explicit exclusions

Do not compile as jurisdiction knowledge:

- the current zoning district for a parcel;
- whether this parcel has legal access or enough frontage;
- a parcel's theoretical or approved lot yield;
- improvement/structure status;
- owner, acreage, geometry, APN, seller, price, or deal history;
- a historical planning project's facts merely because the project was in the jurisdiction.

The future property still must establish its controlling jurisdiction and current parcel zoning. Jurisdiction knowledge answers “what does this government require?”; current evidence answers “which rule/district applies to this parcel now?”

### 10.3 Compilation source and acceptance

Primary inputs already exist:

- typed controlling-authority and subdivision-rule evidence from `landos_property_evidence_item`;
- current retained land-use snapshots;
- `landos_official_site`;
- `landos_regulation_document`;
- `landos_county_source_map`;
- GIS deployment/platform and state-law locator knowledge;
- official artifact/source hashes where available.

Auto-accept is allowed only for a typed factual/procedural record when all are true:

1. controlling jurisdiction identity is resolved;
2. the support row is verified and resolvable;
3. the source tier meets that subject key's policy;
4. draft/proposed content is not promoted as adopted/current;
5. normalized value and scope are deterministic;
6. no unresolved conflict exists;
7. compiler version and content hash are recorded.

Otherwise create a candidate, conflicting, or unresolved record. An LLM summary never satisfies these gates.

### 10.4 Reuse behavior

At property intake/capability execution:

1. resolve the property's controlling jurisdiction;
2. exact lookup by normalized jurisdiction scope key;
3. classify each required subject as current, stale, conflicting, or absent;
4. `REUSE` current records and preserve source links;
5. `REFRESH` only stale/conflicting material rules;
6. `RESEARCH_NEW` only missing material subjects;
7. always establish current parcel zoning and property-specific inputs separately;
8. compile newly accepted jurisdiction evidence back into the same records.

The capability response should report which rule subjects were reused/refreshed/newly researched and which official source actions support them. It should not rerun the old land-use workflow when current compiled knowledge satisfies the question.

## 11. Property Pattern Knowledge V1

### 11.1 Purpose

Property Pattern Knowledge is a governed registry of validated cross-deal empirical relationships. It is not a copy of specialist doctrine and not a dumping ground for every deal observation.

### 11.2 Ownership of the prompt's examples

| Example | Clean owner now |
| --- | --- |
| “Always question source conflict before deciding” | Hermes SOUL/skill reasoning doctrine |
| “No demolition permit is not proof the building remains” | Already LandOS intelligence evidence doctrine; do not duplicate as compiled knowledge |
| “LandOS-generated `0 Road` has no evidentiary meaning” | Already deterministic display/identity convention in `operator-display-location.ts`; Level 5 rule, not learned knowledge |
| “Visible route is physical evidence, not legal easement proof” | Already deterministic access-evidence ladder and UI doctrine; do not duplicate |
| “Historical project acreage must not become current parcel acreage” | Already deterministic acreage reconciliation and identity logic; do not duplicate |
| “Provider improvement record may be stale after removal” | Reasoning doctrine today; eligible for pattern knowledge only after cross-deal validation or Tyler approval |
| “Separate manufactured-home tax account changes improvement interpretation” | Candidate observation; the field exists, but current repo evidence does not establish a validated recurring pattern |
| “Williamson County requires its county assessment system rather than a statewide layer” | Jurisdiction/procedural knowledge if verified and scoped; not a specialist memory fact |

The first Property Pattern V1 release should therefore be allowed to contain **zero active patterns**. Shipping the promotion and retrieval contract without seeding prompt examples is a success.

### 11.3 Record additions and promotion rules

Pattern records add:

- hypothesis statement;
- applicability predicates;
- counterexamples/invalidating evidence;
- supporting deal/evidence count without exposing private raw content;
- proposed-by and approved-by;
- validation state;
- recommended investigative action;
- explicit boundary to any deterministic rule or specialist skill.

Promotion ladder:

| Transition | Automatic? | Rule |
| --- | --- | --- |
| Level 1 observation → Level 2 candidate | Yes | May be model-assisted, but must cite exact evidence and stay non-retrievable as fact |
| Level 2 candidate → validation-ready | Yes | Deterministic evidence count/diversity and absence of disqualifying conflict may flag it for review |
| Validation-ready → Level 3 validated pattern | No in V1 | Tyler/governed reviewer approves evidence and applicability |
| Level 3 → Level 4 company knowledge or specialist skill | No | Explicit owner decision; choose one canonical home and link to the other if needed |
| Level 4 → Level 5 deterministic rule | No | Normal code change, tests, browser acceptance, and Git acceptance |

A pattern record states **what recurring relationship LandOS has validated**. A specialist skill states **what the specialist should do when the situation occurs**. They may reference one another but must not duplicate the full lesson.

## 12. Retrieval architecture

### 12.1 Needed now

**Exact retrieval** from canonical structured knowledge:

- scope key;
- normalized jurisdiction;
- subject key;
- status/freshness;
- ordinance section/document identity;
- APN/property scope where permitted.

**Structured retrieval**:

- all current jurisdiction knowledge for one controlling authority;
- current and stale subsets;
- unresolved/conflicting subjects;
- superseded history;
- records supported by a particular evidence reference;
- active property-pattern records applicable to a typed situation.

Return contract:

```ts
interface KnowledgeBundle {
  decision: 'REUSE' | 'REFRESH' | 'RESEARCH_NEW';
  current: KnowledgeRecordWithSourceActions[];
  stale: KnowledgeRecordWithSourceActions[];
  conflicts: KnowledgeConflict[];
  missingSubjectKeys: string[];
  generatedAt: string;
}
```

Every source action is concise: `Assessor ↗`, `County GIS ↗`, `Deed 9433/325 ↗`, `Official ordinance ↗`. Rich internal support links remain available on demand.

### 12.2 Existing FTS5 role

Use `src/landos/rag-knowledge.ts` for:

- long ordinance/document passages;
- planning minutes and prior discussions;
- broad pattern discovery;
- source-linked contextual excerpts.

Extend its projection later with accepted knowledge record IDs and scope metadata. Do not query FTS for exact APN, current status, supersession, freshness, or authority decisions when structured SQL can answer directly.

### 12.3 Semantic/hybrid later

V1 does not need semantic/vector retrieval. The first two domains have small controlled taxonomies and exact scope keys. FTS5 already handles long-form lexical retrieval.

Add a semantic index only after measured misses show that operators/specialists cannot find relevant long-form patterns or discussions with exact/FTS retrieval. Before adoption, define:

- a representative query set;
- FTS baseline recall/latency;
- target improvement;
- filtered-scope correctness tests;
- index rebuild proof;
- local resource and model cost.

If added, hybrid retrieval must pre-filter canonical scope/privacy/status, merge lexical and semantic candidates, and always resolve final records from the canonical knowledge tables.

## 13. Compilation flow

### 13.1 Event triggers

Compile only on bounded events:

- verified evidence accepted;
- relevant capability completes successfully or honestly unresolved;
- jurisdiction research persists a typed authority/rule/document result;
- operator approves/rejects a reusable pattern;
- source version/effective date proves supersession;
- freshness scheduler marks a targeted record due for verification;
- a real outcome validates/invalidates a future pattern.

Do not compile on GET, page open, hard refresh, or every model response. Freshness expiry creates a refresh candidate; it does not itself run research.

### 13.2 Ordered pipeline

```text
1. ACCEPTED EVIDENCE EVENT
   - namespace/ref, subject identity, source authority, effective/retrieval time

2. CANDIDATE EXTRACTION
   - deterministic mapper first
   - model assistance only for long unstructured text

3. SCOPE + IDENTITY VALIDATION
   - exact jurisdiction/property/deal scope
   - privacy classification

4. EXISTING KNOWLEDGE LOOKUP
   - domain + scope key + subject key

5. COMPARE + RECONCILE
   - same / superseding / historical / conflicting / unresolved

6. AUTHORITY + FRESHNESS VALIDATION
   - typed source policy, effective dates, source version, support resolution

7. ACCEPT / CANDIDATE / CONFLICT / SUPERSEDE
   - one transaction; audit transition

8. INDEX PROJECTION UPDATE
   - FTS now; optional vector later

9. CONSUMER INVALIDATION
   - mark only affected knowledge-dependent intelligence layers stale
```

### 13.3 Deterministic versus model-assisted boundary

Models may:

- extract candidate subjects/values/sections from long documents;
- summarize a cited passage;
- suggest related evidence or a possible supersession relationship;
- propose a reusable pattern and applicability conditions.

Models may not decide:

- record ID or scope;
- parcel/jurisdiction identity;
- source authority;
- evidence admission;
- effective/current status;
- freshness;
- acceptance/promotion;
- supersession or conflict resolution without a deterministic domain rule;
- support association not present in the input;
- privacy/sensitivity;
- index authority.

Model output is a candidate envelope. LandOS validates every field and stores accepted state.

## 14. Hermes integration

Current Property, Market, Seller, and Deal Brain execution should eventually receive three separately labeled blocks:

```text
LANDOS CURRENT DEAL EVIDENCE
RELEVANT CURRENT COMPILED KNOWLEDGE
SPECIALIST COGNITIVE MEMORY / SKILLS
```

Rules:

- current evidence is the only block allowed to establish this deal's current facts;
- compiled knowledge is filtered by scope, freshness, sensitivity, and specialist domain;
- stale/conflicting knowledge is labeled and cannot populate current-fact fields;
- profile memory is never cited as a source;
- the knowledge bundle participates in the layer fingerprint, so a material accepted/superseded record can stale only affected intelligence layers;
- Seller sees no unrelated seller/contact knowledge;
- Deal Brain receives specialist products and selected knowledge summaries, not an unbounded evidence/knowledge dump;
- production execution remains clarify-only and does not self-write knowledge or permanent memory.

Pattern/skill boundary:

- knowledge: “Across N validated cases, condition X was associated with Y, within these applicability limits.”
- skill: “When condition X appears, compare A/B and request bounded check C before concluding.”

One can link to the other by ID; neither copies the other's full text.

## 15. War Room future integration

No War Room change belongs in the first implementation slice.

Later, extend the existing SELECT-only `seatContext` provider with a bounded `KnowledgeBundle` read:

- Property seat: current jurisdiction rules and approved property patterns;
- Market seat: current market/submarket knowledge;
- Seller seat: no broad seller data; only approved general patterns plus this deal's current seller evidence;
- Deal Brain: small synthesized index of what the participating seats received.

Retrieval happens when a turn/question needs it, not on room open/refresh. The prompt must continue to state that fresh current evidence outranks compiled knowledge. Source links and stale/conflict labels travel with every hit. A seat may request a bounded refresh through LandOS later; it may not edit knowledge directly.

## 16. Control and governance

### 16.1 Acceptance policy

| Candidate type | May auto-accept? | Required control |
| --- | --- | --- |
| Typed factual/procedural jurisdiction record from current verified official evidence, no conflict | Yes | Deterministic mapper + support resolution + scope/effective-date checks |
| Deterministic reconciled record | Yes, when the existing accepted reconciler is explicitly allowlisted | Record reconciler/version and every input support ref |
| Model-extracted factual candidate | No until deterministic validation confirms source passage/value | Candidate only |
| Property pattern | No | Cross-deal validation + explicit owner/governed approval |
| Market relationship | No in V1 | Quantitative method/version, sample and period checks, explicit approval |
| Seller/deal-derived general pattern | No | De-identification/privacy review + explicit approval |

### 16.2 Audit events

At minimum record:

- `knowledge_candidate_created`;
- `knowledge_accepted`;
- `knowledge_reverified`;
- `knowledge_conflict_opened`;
- `knowledge_superseded`;
- `knowledge_rejected`;
- `knowledge_promotion_approved`;
- `knowledge_refresh_due`;
- `knowledge_index_rebuilt`.

Audit detail should name record ID, domain, scope key, subject key, actor/policy, compiler version, and support refs—not private source text.

### 16.3 Anti-drift rules

- One deal may automatically create a Level 2 pattern candidate, never durable doctrine.
- An LLM cannot approve its own candidate.
- A skill proposal and a company-knowledge proposal are separate reviews.
- A deterministic rule requires a normal repository change and acceptance; the knowledge compiler cannot write application code.
- Rejected/superseded records remain queryable as history and are excluded from current retrieval by default.
- A compiler/version change must be able to re-evaluate candidates without silently rewriting accepted history.

## 17. Data model and storage recommendation

### 17.1 Canonical store

**Use new additive tables in the existing LandOS business database, `store/landos.db`.**

Recommended minimum:

- `landos_knowledge_record`;
- `landos_knowledge_support`;
- existing `landos_audit_log` for transitions.

Optional only when proven necessary:

- `landos_knowledge_event` if audit rows cannot express lifecycle history cleanly;
- a due-refresh queue if existing tasks/capability invocations cannot own refresh work.

Reasons:

- this is company/business knowledge, not development control or conversation memory;
- SQLite already owns evidence, operational state, derived reads, market records, caches, and FTS;
- transactional supersession/conflict updates need to be atomic with support links;
- local-first single-operator scale does not justify distributed infrastructure;
- backup/security/permissions already exist for the business DB.

### 17.2 What remains derived

- FTS documents/chunks and retrieval logs;
- future embeddings/vector index;
- operator summaries and source-action labels;
- specialist prompt projections;
- freshness status labels computed at read time.

### 17.3 No new infrastructure

Do not use:

- `store/claudeclaw.db` memories;
- repository Markdown/files as canonical business knowledge;
- a separate SQLite database;
- Kernel Memory service;
- a vector or graph database;
- a new queue/orchestrator.

### 17.4 Migration posture

The schema change is additive. Do not rewrite or move existing evidence. An idempotent bounded backfill may compile **candidates** from existing accepted land-use snapshots/evidence only when every support reference resolves and the controlling jurisdiction is deterministic. No candidate is accepted merely because an old snapshot exists.

## 18. First four implementation slices

### Slice 1 — Jurisdiction Knowledge V1 (recommended)

**Purpose**

Persist the jurisdiction-scoped rule package LandOS already builds, retrieve it for a different property controlled by the same government, and research only stale/conflicting/missing rule subjects.

**Likely files/systems touched**

- `src/landos/db.ts` — additive knowledge/support tables and indexes;
- new `src/landos/knowledge-contract.ts` — record/support/read contracts and enums;
- new `src/landos/knowledge-store.ts` — transactional accept/reverify/conflict/supersede and structured reads;
- new `src/landos/jurisdiction-knowledge.ts` — deterministic mappers, scope keys, freshness policy, bundle decision;
- `src/landos/land-use-intelligence-store.ts` — emit typed candidates after accepted authority/regulation/standard persistence;
- `src/landos/zoning-subdivision-capability.ts` — exact jurisdiction lookup and per-subject `REUSE/REFRESH/RESEARCH_NEW` planning;
- focused new tests plus `subdivision-regulation-retention.test.ts`, `zoning-subdivision-capability.test.ts`, and land-use store tests;
- existing `AcquisitionWorkspaceV2ZoningSubdivision.tsx` should need no behavior change unless the current reused label cannot show the exact new outcome.

**Data migration**

Additive tables only. Optional idempotent backfill from current accepted authority/subdivision evidence into candidates; no evidence move or rewrite.

**Operator-visible acceptance outcome**

On a second confirmed property in the same controlling jurisdiction, the existing Zoning & Subdivision surface shows the retained jurisdiction rule package and official source links, marks it reused, does not run jurisdiction-wide research, and separately shows any parcel-specific zoning/current gaps.

**Performance expectation**

Current structured lookup should be local SQLite latency (target under 50 ms excluding UI/network). A fully current jurisdiction bundle should avoid search/document retrieval and materially shorten the capability from network-scale seconds/minutes to a local read plus parcel-specific checks.

**Do not build**

Patterns, market compilation, semantic search, embeddings, graph relations, operator knowledge-management UI, Kernel Memory, or generalized background workers.

### Slice 2 — Knowledge-aware research planning

**Purpose**

Make the `REUSE/REFRESH/RESEARCH_NEW` decision a shared contract used by Research Readiness and capabilities, so reuse actually skips satisfied work rather than adding knowledge retrieval before the same full workflow.

**Likely files/systems touched**

- `src/landos/knowledge-contract.ts` and `knowledge-store.ts`;
- new `src/landos/knowledge-retrieval.ts`;
- `src/landos/research-readiness.ts` and reconciler/backfill files;
- `src/landos/capability-contract.ts`, `capability-router.ts`, and relevant capability adapters;
- affected capability tests and readiness regression tests.

**Data migration**

None.

**Operator-visible acceptance outcome**

Research Readiness distinguishes “reusable,” “refresh due,” and “not yet researched”; targeted backfill runs only refresh/new subjects and reports exactly what it skipped.

**Performance expectation**

Knowledge planning under 100 ms locally; zero provider/model calls for reuse-only subjects; no research on page open/refresh.

**Do not build**

A generic workflow engine, new scheduler, broad capability rewrites, or vector search.

### Slice 3 — Property Pattern promotion contract

**Purpose**

Create a safe candidate/validation/approval path for cross-deal property patterns without seeding prompt examples or allowing Hermes to write doctrine.

**Likely files/systems touched**

- `src/landos/knowledge-contract.ts` and `knowledge-store.ts`;
- new `src/landos/property-pattern-knowledge.ts`;
- existing `landos_audit_log` integration;
- a narrow route/read model for pending/accepted patterns;
- a minimal operator approval surface only if no existing governance surface can carry the decision;
- focused promotion, privacy, cross-deal-isolation, and invalidation tests.

**Data migration**

None. Start with zero active records. Existing prompt/doctrine examples are not imported.

**Operator-visible acceptance outcome**

Tyler can inspect one evidence-linked candidate, see applicability/counterevidence and affected system ownership, approve or reject it, and confirm that an approved pattern is retrievable while a candidate is not presented as fact.

**Performance expectation**

Exact/structured pattern lookup under 50 ms; zero automatic model calls on retrieval.

**Do not build**

Automatic pattern promotion, outcome learning, skill self-editing, or bulk mining of all historical deals.

### Slice 4 — Specialist consumption and rebuildable long-form projection

**Purpose**

Inject bounded accepted knowledge into current Property/Market/Deal intelligence, include knowledge in layer fingerprints, and make the FTS projection explicitly rebuildable from canonical evidence/knowledge.

**Likely files/systems touched**

- `src/landos/intelligence-stack-contract.ts`;
- `src/landos/specialist-intelligence-executor.ts`;
- intelligence dossier/assembly and fingerprint code;
- `src/landos/rag-knowledge.ts` and `rag-ingest.ts`;
- a new bounded index rebuild script under `scripts/knowledge/`;
- specialist prompt, staleness, privacy, retrieval, and rebuild tests.

**Data migration**

No canonical migration. Rebuild the derived FTS projection from canonical inputs and record a rebuild manifest.

**Operator-visible acceptance outcome**

A refreshed Property/Market/Deal read states which current compiled knowledge informed it, retains source actions and stale/conflict labels, and changes only the affected layer when knowledge is superseded. Hard refresh performs SELECTs only.

**Performance expectation**

Knowledge bundle assembly should remain bounded (target under 100 ms and a fixed record/character cap). FTS rebuild runs offline/bounded and is never on the request path.

**Do not build**

War Room writes, semantic/vector search, knowledge graph, outcome learning, or automatic permanent Hermes memory updates.

## 19. Recommended first implementation slice

**Choose Slice 1: Jurisdiction Knowledge V1.**

It is the smallest high-value slice because:

1. LandOS already pays the expensive jurisdiction research cost.
2. The typed rule package, source links, jurisdiction key, retained document set, capability envelope, and operator reused label already exist.
3. The missing work is a narrow canonical storage/retrieval bridge, not new extraction or UI.
4. Jurisdiction facts are mostly public and have a clean cross-deal scope, avoiding seller/privacy complexity.
5. Success is measurable: second-property execution reuses current rules, avoids jurisdiction-wide research, keeps parcel-specific verification, and exposes source links.
6. It proves the core record, freshness, conflict, supersession, support-link, and retrieval contracts before patterns or market knowledge broaden the system.

The first acceptance fixture should demonstrate two Deal Cards controlled by the same normalized jurisdiction. The first supplies verified official rule evidence; the second retrieves current jurisdiction knowledge locally. A changed official version should then supersede or conflict correctly without erasing the old record. No model call or research should occur on page open/refresh.

## 20. Deferred items

- **Semantic/vector retrieval:** deferred until exact + structured + FTS retrieval has measured misses. Any future index is derived/rebuildable.
- **Kernel Memory dependency/service:** rejected for production V1; concepts only, archived/unsupported reference.
- **Knowledge graph/graph database:** deferred; current relationships fit normalized keys and support links.
- **Parcel & Development Context Inspection:** deferred. Its findings begin as Deal Evidence; only later validated cross-deal conclusions may compile.
- **Outcome learning:** deferred. Preserve compatibility with action/decision → outcome → evidence → retrospective → pattern validation/invalidation.
- **Operator UI cleanup:** deferred. The architecture supports concise current conclusion + key fact + useful source action, with provenance/details collapsed.
- **War Room integration:** deferred until current intelligence consumption is proven; read-only scoped retrieval only.
- **Market Knowledge V1:** deferred until jurisdiction and pattern contracts prove scope/freshness/promotion.
- **Seller/contact knowledge:** deferred beyond private same-scope retrieval; no broad compilation.
- **Bulk migration/mining of prior evidence:** deferred. Start with bounded typed jurisdiction backfill only if every support reference resolves.
- **Automated monitoring/watchers:** deferred and separately approval-gated; freshness due state does not activate research or delivery.

## Final architecture decision

LandOS already has enough primitives to build the Knowledge Compiler mostly by connecting verified evidence, existing retained records, a small new canonical knowledge contract, and existing exact/FTS retrieval. The correct canonical home is new additive knowledge/support tables in `store/landos.db`; SQLite FTS5 remains a rebuildable long-form projection. Vector search is not needed in V1. Kernel Memory is a useful conceptual blueprint for ingestion stages, metadata filtering, source preservation, citations, and swappable derived indexes, but its archived service should not become a LandOS dependency. The first implementation should compile and reuse jurisdiction rule knowledge. The largest risk is allowing stale, conflicting, private, or model-generated material to look like current company truth—or duplicating the same lesson across evidence, compiled knowledge, Hermes memory, and deterministic rules.
