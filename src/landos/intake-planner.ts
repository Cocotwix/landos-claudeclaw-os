// LandOS Intake / Main Orchestrator — deterministic planner.
//
// This is the single entry path for every transport (dashboard text/voice,
// Telegram text/voice, CRM lead, manual API). It is READ-ONLY: it classifies
// the input and returns a WorkerDispatchPlan. It runs no agent, writes no DB
// row, calls no LandPortal/comp tool, and never fabricates market data.
//
// It deliberately keeps Duke/Due Diligence operational: a manual address / APN+
// county / owner+county still produces a real Duke plan. Strategy/Underwriting
// stay BLOCKED until parcel identity is verified (the planner never verifies a
// parcel itself — it reads caller-supplied verified context only). Market data
// can never verify a parcel.

import { extractPropertyArgs, looksLikePropertyInput } from './duke-preflight.js';
import { routeDukeRequest } from './duke-router.js';
import { selectModel } from './model-router.js';
import { departmentRegistrySummary } from './department-registry.js';
import { buildSourceAdapterPlan } from './source-adapters.js';
import type {
  StrategyCandidate,
  UnderwritingResult,
  LandOSIntake,
  WorkerDispatchPlan,
  IntakeClassificationResult,
  IntakeClassification,
  ParcelIdentityClass,
  ResponseModePlan,
  DealCardPersistencePlan,
  StrategyUnderwritingPlan,
  InterAgentCollaborationPlan,
  AgentKnowledgeRetrievalPlan,
  StoragePlan,
  DueDiligenceCapabilityStatus,
  PersistenceTarget,
  WorkerLane,
} from './intake-types.js';

// ─────────────────────────────────────────────────────────────────────────
// Market Research adapter detection.
//
// There is NO governed structured browsing/search adapter wired into LandOS
// for local vacant-land market data. (web_search exists only inside live agent
// SDK turns, which is not a deterministic, decision-grade source adapter.) So
// the Market Research lane is honest: not_available with a clear reason. If an
// approved adapter is added later, flip this and wire selectModel toolAvailable.
// ─────────────────────────────────────────────────────────────────────────
export const MARKET_RESEARCH_ADAPTER_AVAILABLE = false;
const MARKET_RESEARCH_BLOCKER =
  'Market Research not_available because no approved browsing/search adapter is connected. ' +
  'No active listings, sold counts, median $/acre, acre bands, or growth data are produced.';

// Voice/STT/TTS adapters: architecture hooks only this sprint.
const STT_CONNECTED = false;
const TTS_CONNECTED = false;

// Knowledge store: no approved retrieval store connected this sprint.
const KNOWLEDGE_STORE_CONNECTED = false;

const PERSISTENCE_RULE =
  'Failed/unvalidated/unverified info is NEVER stored as a deal-card fact. It may only be stored as a ' +
  'data gap, attempted-lookup trace, seller-stated item, or needs-verification item. Verified facts require a named source.';

const PRIVATE_DATA_BOUNDARY =
  'Raw call/training content is source evidence, not active operating truth. Only Tyler-approved material becomes ' +
  'active playbook knowledge. Raw/private training content is never indexed into the repo or a deal card.';

// ─────────────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────────────

const FORGE_BUILD_RE = /\bforge\b[^.\n]*\b(build|interview|create (me )?(an?|the) (agent|workflow|department)|build me)\b/i;
const FORGE_BUILD_GENERIC_RE = /\b(build me (an?|the)|interview me for)\b/i;
const FORGE_REPAIR_RE = /\bforge\b[^.\n]*\b(fix|debug|repair|diagnos|broken|wrong)\b/i;
const FORGE_REPAIR_GENERIC_RE = /\b(debug landos|this output is wrong|why is duke broken|fix this output|landos is broken)\b/i;
const WAR_ROOM_RE = /\b(open (the )?war ?room|war ?room with|start (a )?war ?room)\b/i;
const KNOWLEDGE_RE = /\b(use the .*(training|knowledge) (database|store|base)|seller call training|retrieve .*(knowledge|training)|from (the )?(training|playbook) (database|store))\b/i;
const SELLER_DISCOVERY_RE = /\b(seller call|call prep|prep (me )?(for )?(a |the )?call|discovery questions?|questions? to ask (the )?seller|seller prep)\b/i;
const FUTURE_DEPT_RE = /\b(add (a )?new .*(department|agent)|create (a )?new (department)|spin up (a )?(new )?department|later .* department)\b/i;
const MARKET_QUESTION_RE = /\b(market|comps?|price per acre|ppa|what'?s? land (worth|selling|going)|land values?|absorption|days on market|active listings?|sold (count|data)|growth)\b/i;

function classify(intake: LandOSIntake): IntakeClassificationResult {
  const text = (intake.text ?? '').trim();
  const matched: string[] = [];

  // CRM lead is classified by transport first (manual/CRM parity uses the same
  // downstream dispatch, but the classification records the lead origin).
  if (intake.transport === 'crm_lead') {
    matched.push('transport:crm_lead');
    const id = parcelIdentity(text);
    return {
      classification: 'crm_lead',
      parcelIdentity: id.cls,
      reason: 'CRM lead intake; routed through the same planner as manual input.',
      matched: [...matched, ...id.matched],
    };
  }

  // Forge build/interview before Forge repair before everything else: a Forge
  // command must never be mistaken for Duke due diligence.
  if (FORGE_BUILD_RE.test(text) || (/\bforge\b/i.test(text) && FORGE_BUILD_GENERIC_RE.test(text))) {
    return { classification: 'forge_build_interview', parcelIdentity: 'none', reason: 'Forge build/interview command.', matched: ['forge_build'] };
  }
  if (FORGE_REPAIR_RE.test(text) || FORGE_REPAIR_GENERIC_RE.test(text)) {
    return { classification: 'forge_repair', parcelIdentity: 'none', reason: 'Forge repair/debug command.', matched: ['forge_repair'] };
  }

  // War Room is a visible group mode — never normal hidden collaboration and
  // never a property-intake path.
  if (WAR_ROOM_RE.test(text)) {
    return { classification: 'war_room', parcelIdentity: 'none', reason: 'War Room request (visible group mode).', matched: ['war_room'] };
  }

  if (KNOWLEDGE_RE.test(text)) {
    return { classification: 'agent_knowledge_retrieval', parcelIdentity: 'none', reason: 'Agent knowledge/training retrieval request.', matched: ['knowledge_retrieval'] };
  }

  if (FUTURE_DEPT_RE.test(text)) {
    return { classification: 'future_department_route', parcelIdentity: 'none', reason: 'Future department/agent capability request.', matched: ['future_department'] };
  }

  // Caller-supplied parcel context (verified facts / a known card) makes this a
  // parcel-level turn even when the text alone has no identity, e.g. "what
  // should we do with this?" attached to a verified parcel.
  if (intake.context?.parcelVerified || intake.context?.propertyCardId || (intake.context?.verifiedFacts?.length ?? 0) > 0) {
    const idc = parcelIdentity(text);
    return { classification: 'parcel_level', parcelIdentity: idc.cls, reason: 'Caller supplied parcel context (verified facts / card).', matched: [...idc.matched, 'parcel_context'] };
  }

  // Parcel/area determination.
  const id = parcelIdentity(text);
  if (id.cls === 'apn_county' || id.cls === 'full_address' || id.cls === 'owner_county' || id.cls === 'lp_url' || id.cls === 'property_id' || id.cls === 'property_ambiguous') {
    return { classification: 'parcel_level', parcelIdentity: id.cls, reason: `Parcel-level input (${id.cls}).`, matched: id.matched };
  }

  // Seller discovery / call prep (no parcel identity present).
  if (SELLER_DISCOVERY_RE.test(text)) {
    return { classification: 'seller_discovery', parcelIdentity: 'none', reason: 'Seller call / discovery prep.', matched: ['seller_discovery'] };
  }

  // Street/city/state only -> area-only market. Or a generic market question.
  if (id.cls === 'street_city_state_only') {
    return { classification: 'area_only_market', parcelIdentity: 'street_city_state_only', reason: 'Street/city/state only; area-only market with missing parcel identity.', matched: id.matched };
  }
  if (MARKET_QUESTION_RE.test(text)) {
    return { classification: 'area_only_market', parcelIdentity: 'none', reason: 'Local market question (area-level only).', matched: ['market_question'] };
  }

  return { classification: 'general_chat', parcelIdentity: 'none', reason: 'No property/agent/department signal; general chat.', matched: [] };
}

/** Determine parcel identity strength using the existing Duke parsers. Never
 *  uses coordinates/proximity/visuals. */
function parcelIdentity(text: string): { cls: ParcelIdentityClass; matched: string[] } {
  const args = extractPropertyArgs(text);
  if (args) {
    if (args.lp_url) return { cls: 'lp_url', matched: ['lp_url'] };
    if (args.apn) return { cls: 'apn_county', matched: ['apn'] };
    if (args.owner && !args.address) return { cls: 'owner_county', matched: ['owner+county/state'] };
    if (args.propertyid) return { cls: 'property_id', matched: ['property_id+fips'] };
    if (args.address) return { cls: 'full_address', matched: ['address+city+state'] };
  }
  // Address-like but missing county/FIPS (e.g. "57 Church Road" alone).
  if (looksLikePropertyInput(text)) {
    // A bare street name + city/state with no house number is area-only; the
    // Duke parsers return null and looksLikePropertyInput is false for those,
    // so reaching here means an address-shaped input missing county.
    return { cls: 'property_ambiguous', matched: ['address_missing_county'] };
  }
  // Detect "Street Name, City ST" with no house number -> area-only.
  if (/,\s*[A-Za-z][A-Za-z .'\-]*\s*,?\s+[A-Z]{2}\b/.test(text) && /\b(rd|road|st|street|ave|avenue|dr|drive|ln|lane|hwy|highway|blvd|way|ct|court)\b/i.test(text)) {
    return { cls: 'street_city_state_only', matched: ['street+city+state_no_number'] };
  }
  return { cls: 'none', matched: [] };
}

// ─────────────────────────────────────────────────────────────────────────
// Lane builders
// ─────────────────────────────────────────────────────────────────────────

function isParcelLevel(c: IntakeClassification): boolean {
  return c === 'parcel_level' || c === 'crm_lead';
}

/** A parcel-level input where Duke can actually act on an identity. */
function dukeActionable(id: ParcelIdentityClass): boolean {
  return id === 'apn_county' || id === 'full_address' || id === 'owner_county' || id === 'lp_url' || id === 'property_id' || id === 'property_ambiguous';
}

function buildVoicePlan(intake: LandOSIntake): ResponseModePlan {
  const requested = intake.requestedResponseMode ?? 'text_only';
  const wantsVoice = requested !== 'text_only';
  return {
    responseMode: requested,
    spokenResponseEligible: wantsVoice,
    // Voice requested but TTS not connected -> not_available, never fake success.
    voiceStatus: wantsVoice ? (TTS_CONNECTED ? 'requested' : 'not_available') : 'not_requested',
    sttProviderStatus: STT_CONNECTED ? 'connected' : 'not_connected',
    ttsProviderStatus: TTS_CONNECTED ? 'connected' : 'not_connected',
    voiceAdapter: STT_CONNECTED || TTS_CONNECTED ? 'connected' : 'not_connected',
  };
}

function storagePlan(): StoragePlan {
  return {
    rawMediaLocation: 'onedrive_or_cloud',
    repoContainsRawTraining: false,
    obsidianContent: 'curated_processed_only',
    vectorStore: 'optional_bounded_disabled',
    note: 'Repo holds code/schemas/contracts/safe docs only. Raw media and private training stay in OneDrive/cloud; Obsidian holds curated processed knowledge.',
  };
}

function dueDiligenceCapability(marketStatus: 'planned' | 'not_available' | 'pending', marketReason: string): DueDiligenceCapabilityStatus {
  return {
    operational: true,
    dukeActive: true,
    preserves: [
      'duke_input_parsing',
      'landportal_exact_lookup',
      'no_comp_credit_rule',
      'no_coordinate_parcel_verification',
      'unverified_parcel_blocking',
    ],
    marketResearch: marketStatus,
    marketResearchReason: marketReason,
  };
}

function buildStrategyUnderwriting(parcelVerified: boolean, areaOnly: boolean): StrategyUnderwritingPlan {
  if (parcelVerified) {
    return {
      strategyStatus: 'planned',
      underwritingStatus: 'planned',
      strategyCandidates: [],
      underwritingResults: [],
      rejectedStrategies: [],
      finalStrategyStatus: 'pending',
      missingFactsBlockingDecision: [],
      feedbackLoopNote:
        'Strategy proposes viable exit paths; Underwriting runs the numbers for each; if Underwriting rejects a path, ' +
        'Strategy re-checks alternatives, downgrades, or marks pass/no-offer. Final recommendation never includes a strategy that failed underwriting.',
    };
  }
  return {
    strategyStatus: areaOnly ? 'not_applicable' : 'blocked',
    underwritingStatus: areaOnly ? 'not_applicable' : 'blocked',
    strategyCandidates: [],
    underwritingResults: [],
    rejectedStrategies: [],
    finalStrategyStatus: 'blocked',
    missingFactsBlockingDecision: ['verified_parcel_identity'],
    feedbackLoopNote:
      'Parcel identity unverified: Strategy and Underwriting are blocked from property-specific valuation/offer/recommendation. ' +
      'Only area-level context and missing-info questions are allowed. Market data cannot verify parcel identity.',
  };
}

/**
 * Deterministic Strategy ⇄ Underwriting feedback loop resolver.
 *
 * Strategy proposes candidates; Underwriting runs the numbers. A strategy that
 * Underwriting rejects can NEVER be the final recommendation. Strategy then
 * re-checks the remaining passing candidates; if none pass, the deal is
 * pass/no-offer. Both stay blocked when the parcel identity is unverified.
 */
export function resolveStrategyFeedback(
  candidates: StrategyCandidate[],
  underwritingResults: UnderwritingResult[],
  parcelVerified: boolean,
): StrategyUnderwritingPlan {
  const base: StrategyUnderwritingPlan = {
    strategyStatus: 'planned',
    underwritingStatus: 'planned',
    strategyCandidates: candidates,
    underwritingResults,
    rejectedStrategies: [],
    finalStrategyStatus: 'pending',
    missingFactsBlockingDecision: [],
    feedbackLoopNote:
      'Strategy proposes; Underwriting validates; rejected paths are removed and Strategy re-checks alternatives. ' +
      'The final recommendation never includes a strategy that failed underwriting.',
  };
  if (!parcelVerified) {
    return {
      ...base,
      strategyStatus: 'blocked',
      underwritingStatus: 'blocked',
      finalStrategyStatus: 'blocked',
      missingFactsBlockingDecision: ['verified_parcel_identity'],
      feedbackLoopNote: 'Parcel identity unverified: Strategy and Underwriting are blocked from property-specific valuation/offer/recommendation.',
    };
  }
  const resultByStrategy = new Map(underwritingResults.map((r) => [r.strategy, r]));
  const rejected = candidates
    .filter((c) => resultByStrategy.get(c.strategy)?.result === 'fail')
    .map((c) => ({ strategy: c.strategy, reasonRejected: resultByStrategy.get(c.strategy)?.reason ?? 'failed underwriting' }));
  const passing = candidates.filter((c) => resultByStrategy.get(c.strategy)?.result === 'pass');
  if (passing.length > 0) {
    return { ...base, rejectedStrategies: rejected, finalStrategyStatus: 'recommended', recommendedStrategy: passing[0].strategy };
  }
  return { ...base, rejectedStrategies: rejected, finalStrategyStatus: 'pass_no_offer' };
}

function buildPersistencePlan(
  classification: IntakeClassification,
  id: ParcelIdentityClass,
  ctx: LandOSIntake['context'],
): DealCardPersistencePlan {
  if (!isParcelLevel(classification) && classification !== 'area_only_market') {
    return { dealCardPersistence: 'not_applicable', persistenceTargets: [], rule: PERSISTENCE_RULE };
  }
  const targets: PersistenceTarget[] = [];
  // Parsed identity is needs_verification until Duke verifies it with a source.
  targets.push({ key: 'parsed_identity', label: 'needs_verification', note: `parcel identity class: ${id}` });
  targets.push({ key: 'apn_variants_tried', label: 'needs_verification', note: 'attempted-lookup trace only' });
  targets.push({ key: 'source_trace', label: 'needs_verification' });
  targets.push({ key: 'open_data_gaps', label: 'needs_verification' });
  if (classification === 'area_only_market') {
    targets.push({ key: 'market_research_snapshot', label: 'market_context_only', note: MARKET_RESEARCH_BLOCKER });
  }
  // Verified facts supplied by the caller may be persisted as verified — but
  // ONLY when they carry a named source.
  const verified = ctx?.verifiedFacts ?? [];
  for (const f of verified) {
    if (f.source && f.source.trim()) {
      targets.push({ key: `verified:${f.fact}`, label: 'verified', source: f.source, note: f.value });
    } else {
      targets.push({ key: `unsourced:${f.fact}`, label: 'needs_verification', note: 'no named source supplied' });
    }
  }
  return {
    dealCardPersistence: 'planned',
    propertyCardId: ctx?.propertyCardId,
    dealCardId: ctx?.dealCardId,
    persistenceTargets: targets,
    rule: PERSISTENCE_RULE,
  };
}

function buildCollaborationPlan(classification: IntakeClassification, parcelVerified: boolean): InterAgentCollaborationPlan {
  // War Room is NOT inter-agent collaboration. Normal property intake plans
  // hidden collaboration; it runs without Tyler present, bounded and summarized.
  if (classification === 'war_room') {
    return {
      status: 'not_applicable',
      collaborationParticipants: [],
      collaborationPurpose: 'War Room is a visible group mode with Tyler present, not hidden inter-agent collaboration.',
      allowedHandoffs: [],
      maxRounds: 0,
      requiresTylerApproval: false,
      collaborationSummaryRequired: false,
      outputOwner: 'war_room',
    };
  }
  if (isParcelLevel(classification)) {
    const handoffs = [
      { from: 'duke-due-diligence', to: 'acquisition-copilot', passes: 'missing parcel identity gaps -> seller discovery questions' },
    ];
    if (parcelVerified) {
      handoffs.push({ from: 'strategy', to: 'underwriting', passes: 'proposed exit paths -> run the numbers' });
      handoffs.push({ from: 'underwriting', to: 'strategy', passes: 'rejection + failure reasons -> re-check alternatives' });
    }
    return {
      status: 'planned',
      collaborationParticipants: parcelVerified
        ? ['duke-due-diligence', 'strategy', 'underwriting', 'acquisition-copilot']
        : ['duke-due-diligence', 'acquisition-copilot'],
      collaborationPurpose: 'Complete the due-diligence workflow without one agent becoming a do-it-all bottleneck.',
      allowedHandoffs: handoffs,
      maxRounds: 3,
      requiresTylerApproval: false,
      collaborationSummaryRequired: true,
      outputOwner: 'research_due_diligence',
    };
  }
  return {
    status: 'not_applicable',
    collaborationParticipants: [],
    collaborationPurpose: 'No multi-agent workflow required for this input.',
    allowedHandoffs: [],
    maxRounds: 0,
    requiresTylerApproval: false,
    collaborationSummaryRequired: false,
    outputOwner: 'main',
  };
}

function buildKnowledgePlan(classification: IntakeClassification, intake: LandOSIntake): AgentKnowledgeRetrievalPlan {
  if (classification !== 'agent_knowledge_retrieval') {
    return { status: 'not_applicable', reason: 'No knowledge/training retrieval requested.', privateDataBoundary: PRIVATE_DATA_BOUNDARY };
  }
  if (!KNOWLEDGE_STORE_CONNECTED) {
    return {
      status: 'not_available',
      request: { agentId: 'ace', query: intake.text, sourceTypes: ['approved_playbook', 'processed_obsidian'] },
      reason: 'No approved knowledge/training store is connected. Raw training content is not active knowledge.',
      privateDataBoundary: PRIVATE_DATA_BOUNDARY,
    };
  }
  return {
    status: 'planned',
    request: { agentId: 'ace', query: intake.text, sourceTypes: ['approved_playbook', 'processed_obsidian'] },
    reason: 'Retrieve only approved/processed knowledge with source/confidence/timestamp.',
    privateDataBoundary: PRIVATE_DATA_BOUNDARY,
  };
}

function lane<S extends string>(name: string, status: S, reason: string, extra: Partial<WorkerLane<S>> = {}): WorkerLane<S> {
  return { lane: name, status, reason, ...extra };
}

// ─────────────────────────────────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────────────────────────────────

export function planLandosIntake(intake: LandOSIntake): WorkerDispatchPlan {
  const cls = classify(intake);
  const c = cls.classification;
  const id = cls.parcelIdentity;
  const parcelVerified = intake.context?.parcelVerified === true;

  // A parcel-level turn (new identity OR caller-supplied parcel context).
  const parcelContext = isParcelLevel(c);
  // A FRESH parcel identity Duke can act on right now.
  const dukeFresh = parcelContext && dukeActionable(id);
  // Verified parcel context unblocks Strategy/Underwriting.
  const suVerified = parcelVerified && parcelContext;
  const areaOnly = c === 'area_only_market';

  // ── Duke parcel verification lane ──────────────────────────────────────
  const dukeRoute = dukeFresh ? routeDukeRequest(intake.text).route : undefined;
  const dukeParcelVerification = dukeFresh
    ? lane('Duke Parcel Verification', 'planned' as const,
        id === 'owner_county' ? 'Owner + county/state: plan Duke owner search.' : `Plan Duke parcel verification (${id}).`,
        { route: dukeRoute, modelRouting: selectModel({ taskType: 'parcel_verification' }) })
    : lane('Duke Parcel Verification', 'not_applicable' as const,
        areaOnly ? 'Area-only input: no parcel to verify.' : 'No parcel identity in input.');

  // ── Market Research lane (honest: no approved adapter) ──────────────────
  const marketPlanned = parcelContext || areaOnly;
  const marketResearch = marketPlanned
    ? lane('Market Research', MARKET_RESEARCH_ADAPTER_AVAILABLE ? ('planned' as const) : ('not_available' as const),
        MARKET_RESEARCH_ADAPTER_AVAILABLE ? 'Approved adapter connected: plan local vacant-land market research.' : MARKET_RESEARCH_BLOCKER,
        { modelRouting: selectModel({ taskType: 'market_research', requiresWeb: true, toolAvailable: MARKET_RESEARCH_ADAPTER_AVAILABLE }) })
    : lane('Market Research', 'pending' as const, 'No market lane for this input type.');

  const marketStatusForDd = MARKET_RESEARCH_ADAPTER_AVAILABLE ? 'planned' : 'not_available';

  // ── Strategy + Underwriting feedback loop ───────────────────────────────
  const su = buildStrategyUnderwriting(suVerified, areaOnly);
  const strategy = lane('Strategy', su.strategyStatus,
    suVerified ? 'Verified parcel facts: plan Strategy exit-path proposals.' : 'Parcel unverified: property-specific strategy blocked.',
    { modelRouting: selectModel({ taskType: 'strategy_reasoning', parcelVerified: suVerified, escalationAllowed: true }) });
  const underwriting = lane('Underwriting', su.underwritingStatus,
    suVerified ? 'Verified parcel facts: plan Underwriting math for each strategy.' : 'Parcel unverified: underwriting valuation/offer blocked.',
    { modelRouting: selectModel({ taskType: 'underwriting_math' }) });

  // ── Ace discovery prep ──────────────────────────────────────────────────
  // Plan Ace for seller discovery, for partial/property-level identity needing
  // missing-info questions, and for street/city/state-only inputs. A pure
  // market question (no location-specific identity) gets Market Research only.
  const aceNeeded =
    c === 'seller_discovery' ||
    (areaOnly && id === 'street_city_state_only') ||
    (dukeFresh && (id === 'property_ambiguous' || id === 'owner_county' || id === 'full_address' || id === 'apn_county'));
  const aceDiscoveryPrep = aceNeeded
    ? lane('Ace Discovery Prep', 'planned' as const,
        areaOnly || id === 'property_ambiguous' || id === 'street_city_state_only' ? 'Missing parcel identity: plan Ace missing-info questions.' : 'Plan Ace seller discovery prep.',
        { modelRouting: selectModel({ taskType: 'seller_prep', escalationAllowed: true }) })
    : lane('Ace Discovery Prep', 'not_applicable' as const, 'No seller discovery needed for this input.');

  // ── Deal-card persistence ───────────────────────────────────────────────
  const persistencePlan = buildPersistencePlan(c, id, intake.context);
  const dealCardPersistence = lane('Deal Card Persistence', persistencePlan.dealCardPersistence, persistencePlan.rule);

  // ── Voice response ──────────────────────────────────────────────────────
  const responseModePlan = buildVoicePlan(intake);
  const voiceResponse = lane('Voice Response', responseModePlan.voiceStatus,
    responseModePlan.voiceStatus === 'not_available'
      ? 'Voice requested but no TTS adapter is connected.'
      : responseModePlan.voiceStatus === 'requested'
        ? 'Voice response requested.'
        : 'No voice response requested.');

  // ── Forge lanes ─────────────────────────────────────────────────────────
  const forgeRepair = c === 'forge_repair'
    ? lane('Forge Repair', 'planned' as const, 'Forge repair/diagnostics; never auto-commit/push/delete/.env/CRM/paid-API.',
        { modelRouting: selectModel({ taskType: 'forge_diagnostics' }) })
    : lane('Forge Repair', 'not_applicable' as const, 'Not a Forge repair request.');
  const forgeBuildInterview = c === 'forge_build_interview'
    ? lane('Forge Build/Interview', 'planned' as const, 'Forge build/requirements-interview task.',
        { modelRouting: selectModel({ taskType: 'forge_build_planning' }) })
    : lane('Forge Build/Interview', 'not_applicable' as const, 'Not a Forge build/interview request.');

  // ── Agent knowledge retrieval ───────────────────────────────────────────
  const knowledgePlan = buildKnowledgePlan(c, intake);
  const agentKnowledgeRetrieval = lane('Agent Knowledge Retrieval', knowledgePlan.status, knowledgePlan.reason);

  // ── Inter-agent collaboration ───────────────────────────────────────────
  const collaborationPlan = buildCollaborationPlan(c, suVerified);
  const interAgentCollaboration = lane('Inter-Agent Collaboration', collaborationPlan.status, collaborationPlan.collaborationPurpose);

  // ── Future department/agent capability ──────────────────────────────────
  const futureDepartmentCapability = lane('Future Department/Agent Capability', 'supported' as const,
    'New departments/agents are added as registry data + capability declarations without changing the intake type.');

  // ── Model routing summary lane ──────────────────────────────────────────
  const modelRouting = lane('Model Routing', 'planned' as const,
    'Each worker lane carries its intended task route; task-oriented work prefers the local/open-source slot, escalation requires a reason, paid APIs gated separately.',
    { modelRouting: selectModel({ taskType: 'routing' }) });

  // ── Source adapter registry + Market Pulse (Sprint 6A, read-only) ────────
  // On-demand source lookup plan for the current subject/area. No live calls,
  // no installs, no third-party code, no paid/comp tools. Market Pulse stays
  // separate from parcel verification; seller ask is seller_stated only.
  const sourceAdapter = buildSourceAdapterPlan({
    text: intake.text,
    hasParcelIdentity: dukeFresh,
    parcelVerified: suVerified,
  });

  return {
    intake,
    classification: cls,
    dukeParcelVerification,
    marketResearch,
    strategy,
    underwriting,
    aceDiscoveryPrep,
    dealCardPersistence,
    voiceResponse,
    forgeRepair,
    forgeBuildInterview,
    agentKnowledgeRetrieval,
    interAgentCollaboration,
    futureDepartmentCapability,
    modelRouting,
    responseModePlan,
    dealCardPersistencePlan: persistencePlan,
    strategyUnderwritingPlan: su,
    interAgentCollaborationPlan: collaborationPlan,
    agentKnowledgeRetrievalPlan: knowledgePlan,
    storagePlan: storagePlan(),
    dueDiligenceCapability: dueDiligenceCapability(marketStatusForDd, MARKET_RESEARCH_ADAPTER_AVAILABLE ? 'Adapter connected.' : MARKET_RESEARCH_BLOCKER),
    departmentRegistrySummary: departmentRegistrySummary(),
    extensibilityNote:
      'Departments and agents are first-class registry citizens. Future additions declare capabilities, required inputs, ' +
      'blocked conditions, permissions, model policy, and output contracts — no rewrite of the intake/orchestrator core.',
    sourceAdapter,
    executionMode: 'read_only_plan',
  };
}
