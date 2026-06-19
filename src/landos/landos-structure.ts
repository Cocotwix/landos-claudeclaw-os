// LandOS-wide structure spine.
//
// This is the missing top-level structural layer for LandOS. It does NOT
// redefine departments or agents — department capability/model policy lives in
// department-registry.ts and the display registry lives in departments.ts. This
// file declares the LandOS-WIDE STRUCTURE: how every concept is categorized and
// how the pieces connect, so concepts are not all flattened into "departments".
//
// Four categories (architecture correction):
//   department_leg  — an internal app/department inside LandOS. Writes to
//                     contracts/surfaces/Deal Cards. A leg NEVER orchestrates
//                     other legs, and NO leg is the center of gravity.
//   shared_surface  — landos-command (the only orchestrator) and war-room (the
//                     existing cross-agent conversation surface, preserved).
//   shared_record   — deal-cards (the shared business record legs write into).
//   interface_layer — voice-layer (input/output over Command/War Room, never a
//                     business-logic department).
//
// No DB, no network, no secrets. Pure config + deterministic helpers.
//
// Reuse, not duplication: each department leg carries a `registryRef` pointing
// at the existing department-registry.ts id where one exists. New structural
// concepts (market-research as a distinct leg, the shared surfaces/records/
// interface layer) are represented here without churning existing registry IDs.

export type StructureCategory =
  | 'department_leg'
  | 'shared_surface'
  | 'shared_record'
  | 'interface_layer';

export type LegStatus = 'active' | 'shell' | 'planned';

/** The single orchestrator surface id. Nothing else may orchestrate. */
export const THE_ORCHESTRATOR_ID = 'landos-command' as const;

/** A department leg: an internal app inside LandOS. */
export interface DepartmentLeg {
  id: string;
  displayName: string;
  category: 'department_leg';
  purpose: string;
  /** What Tyler normally types/says that lands in this leg. */
  normalTylerInputs: string[];
  /** Actions the leg may take automatically (no per-action approval). */
  automaticActions: string[];
  /** Actions the leg performs only when explicitly requested. */
  onDemandActions: string[];
  /** Hard no-go rules this leg must never cross. */
  hardNoGoRules: string[];
  /** The fields/sections this leg is allowed to produce. */
  outputContract: string[];
  canRunParallel: boolean;
  /** Risky operations that require human approval before the leg proceeds. */
  requiresHumanApprovalFor: string[];
  /** Dashboard route/section target if known. */
  dashboardRoute: string | null;
  status: LegStatus;
  /** Label for the headline metric on the status tile. */
  summaryMetricLabel: string;
  /** Alert types this leg can surface to LandOS Command. */
  alertTypes: string[];
  /** Deal Card sections/keys this leg may write. Empty = read-only for now. */
  dealCardWritePermissions: string[];
  // ── Architecture invariants (literal types so the compiler enforces them) ──
  /** Legs never orchestrate. Only landos-command orchestrates. */
  orchestrator: false;
  /** No department leg is the center of the system. */
  centerOfGravity: false;
  /** Existing department-registry.ts id this leg maps to, or null if new. */
  registryRef: string | null;
  /** Future subareas this leg will eventually own (planning only). */
  futureSubareas?: string[];
}

/** A shared surface / shared record / interface layer. */
export interface SharedNode {
  id: string;
  displayName: string;
  category: 'shared_surface' | 'shared_record' | 'interface_layer';
  purpose: string;
  /** Routes / UI surfaces if known. */
  routes: string[];
  /** Inputs this node can receive. */
  inputs: string[];
  /** Outputs this node can show. */
  outputs: string[];
  /** Department leg ids this node connects to. */
  departmentConnections: string[];
  hardNoGoRules: string[];
  /** Preservation rules — what must NOT be removed/redesigned. */
  preservationRules: string[];
  /** True ONLY for landos-command. War Room is a surface but not an orchestrator. */
  orchestrator: boolean;
}

// ── Helpers to build legs without repeating the invariant fields ───────────
function leg(entry: Omit<DepartmentLeg, 'category' | 'orchestrator' | 'centerOfGravity'>): DepartmentLeg {
  return { ...entry, category: 'department_leg', orchestrator: false, centerOfGravity: false };
}

// ───────────────────────────────────────────────────────────────────────────
// Department legs (the sprint's canonical ten)
// ───────────────────────────────────────────────────────────────────────────

export const DEPARTMENT_LEGS: readonly DepartmentLeg[] = [
  leg({
    id: 'due-diligence-research',
    displayName: 'Due Diligence + Research',
    purpose:
      'Property-level research and due diligence: subject property facts, source attempts, ' +
      'confidence labels, data gaps, risk flags, supporting source links. Visual/source imagery ' +
      'is supporting context only and never verifies parcel identity.',
    normalTylerInputs: ['property address', 'APN + county', 'owner + county', 'LandPortal url', 'property id'],
    automaticActions: ['parse property identity', 'attempt exact-source verification', 'record source attempts and data gaps'],
    onDemandActions: ['run full due diligence pass', 'refresh source attempts'],
    hardNoGoRules: [
      'never verify identity from coordinates/geocoder/proximity/map pins',
      'never use a comp credit without explicit approval',
      'never store unverified info as a verified fact',
    ],
    outputContract: ['parcel_verification', 'due_diligence_facts', 'source_trace', 'data_gaps', 'risk_flags'],
    canRunParallel: true,
    requiresHumanApprovalFor: ['landportal_comp_report', 'comp_credit_use'],
    dashboardRoute: '/landos/legs/due-diligence-research',
    status: 'active',
    summaryMetricLabel: 'Parcels in research',
    alertTypes: ['parcel_unverified', 'data_gap', 'risk_flag'],
    dealCardWritePermissions: ['land_data_dd_facts', 'source_trace', 'data_gaps', 'risk_flags', 'imagery_panel'],
    registryRef: 'research_due_diligence',
  }),
  leg({
    id: 'strategy',
    displayName: 'Strategy',
    purpose:
      'Uses Deal Card + Due Diligence/Research + Market inputs to produce strategy candidates, the ' +
      'current recommended strategy, blockers, next confirmations, offer readiness, and pre-call ' +
      'strategy notes. Only recommends when verified facts support it.',
    normalTylerInputs: ['what should we do with this deal', 'is this a flip or subdivide', 'are we ready to offer'],
    automaticActions: ['assemble strategy candidates from available verified facts'],
    onDemandActions: ['produce recommended strategy', 'produce pre-call brief strategy notes'],
    hardNoGoRules: [
      'never recommend a strategy on an unverified parcel',
      'never anchor an offer on seller-stated price',
    ],
    outputContract: ['strategy_candidates', 'recommended_strategy', 'blockers', 'next_confirmations', 'offer_readiness', 'pre_call_strategy_notes'],
    canRunParallel: true,
    requiresHumanApprovalFor: ['final_offer_recommendation'],
    dashboardRoute: '/landos/legs/strategy',
    status: 'active',
    summaryMetricLabel: 'Deals awaiting strategy',
    alertTypes: ['strategy_blocked', 'offer_ready', 'needs_confirmation'],
    dealCardWritePermissions: ['exit_strategy_analysis', 'deal_economics_strategy_placeholders', 'pre_call_brief'],
    registryRef: 'strategy',
  }),
  leg({
    id: 'market-research',
    displayName: 'Market Research',
    purpose:
      'Market-level (not parcel-level) research: local market demand, active/sold area context, ' +
      'manufactured-home market questions, county growth plans, buyer demand, broader area strategy ' +
      'context. Separate lane from Due Diligence + Research.',
    normalTylerInputs: ['what is the market like in X county', 'is there demand for mobile homes here', 'county growth plans'],
    automaticActions: [],
    onDemandActions: ['summarize area market context', 'answer manufactured-home market questions'],
    hardNoGoRules: [
      'market data can never verify a parcel',
      'never invent market data when no approved adapter is connected',
    ],
    outputContract: ['area_market_context', 'buyer_demand', 'growth_plan_notes', 'manufactured_home_market'],
    canRunParallel: true,
    requiresHumanApprovalFor: [],
    dashboardRoute: '/landos/legs/market-research',
    status: 'shell',
    summaryMetricLabel: 'Market questions open',
    alertTypes: ['market_adapter_unavailable'],
    dealCardWritePermissions: ['land_data_market_context'],
    registryRef: null,
  }),
  leg({
    id: 'crm-acquisition-ghl',
    displayName: 'CRM / Acquisition / GHL',
    purpose:
      'Planned shell leg. Will eventually own pipeline, seller communication, follow-up queue, ' +
      'seller interaction log, lead intake, re-engagement, speed-to-lead, and the external CRM ' +
      'thread/history link. GHL is NOT connected; this leg never pretends it is.',
    normalTylerInputs: ['seller follow-up', 'what did the seller say', 'who needs a callback'],
    automaticActions: [],
    onDemandActions: ['summarize communication context (from Deal Card only)'],
    hardNoGoRules: [
      'GHL is not connected this sprint',
      'no external CRM writes',
      'no SMS/email sending',
      'no fake sync or fake CRM data',
      'never require GHL credentials to function',
    ],
    outputContract: ['communication_summary_placeholder', 'follow_up_placeholder'],
    canRunParallel: true,
    requiresHumanApprovalFor: ['ghl_integration_connect', 'external_crm_write', 'send_message'],
    dashboardRoute: '/landos/legs/crm-acquisition-ghl',
    status: 'planned',
    summaryMetricLabel: 'GHL: not connected',
    alertTypes: ['ghl_not_connected'],
    dealCardWritePermissions: [],
    registryRef: 'crm_manager',
    futureSubareas: [
      'pipeline',
      'seller communication',
      'lead intake',
      'follow-up queue',
      'seller interaction log',
      'speed-to-lead',
      're-engagement',
    ],
  }),
  leg({
    id: 'marketing',
    displayName: 'Marketing',
    purpose: 'Campaign and lead-source performance records. No live ad changes without approval.',
    normalTylerInputs: ['how are campaigns doing', 'which lead source is working'],
    automaticActions: [],
    onDemandActions: ['summarize campaign/lead-source performance (when data exists)'],
    hardNoGoRules: ['no live ad changes without approval'],
    outputContract: ['campaign_records', 'lead_source_performance'],
    canRunParallel: true,
    requiresHumanApprovalFor: ['live_ad_change'],
    dashboardRoute: '/landos/legs/marketing',
    status: 'shell',
    summaryMetricLabel: 'Active campaigns',
    alertTypes: ['lead_source_drop'],
    dealCardWritePermissions: [],
    registryRef: 'marketing',
  }),
  leg({
    id: 'dispositions',
    displayName: 'Dispositions',
    purpose: 'Buyer research, exit prep, listing strategy.',
    normalTylerInputs: ['who would buy this', 'how do we sell this'],
    automaticActions: [],
    onDemandActions: ['summarize buyer/exit options (when data exists)'],
    hardNoGoRules: ['no public listing without approval'],
    outputContract: ['buyer_research', 'exit_prep', 'listing_strategy'],
    canRunParallel: true,
    requiresHumanApprovalFor: ['public_listing'],
    dashboardRoute: '/landos/legs/dispositions',
    status: 'shell',
    summaryMetricLabel: 'Deals in disposition',
    alertTypes: ['buyer_interest'],
    dealCardWritePermissions: [],
    registryRef: 'dispositions',
  }),
  leg({
    id: 'transactions',
    displayName: 'Transactions',
    purpose: 'Signed-deal-through-closing coordination: title/closing checklist, deadlines, seller documents.',
    normalTylerInputs: ['where are we on closing', 'what is left on this contract'],
    automaticActions: [],
    onDemandActions: ['summarize closing checklist / deadlines (when data exists)'],
    hardNoGoRules: ['no document execution without approval'],
    outputContract: ['closing_checklist', 'deadline_tracking', 'document_status'],
    canRunParallel: true,
    requiresHumanApprovalFor: ['document_execution'],
    dashboardRoute: '/landos/legs/transactions',
    status: 'shell',
    summaryMetricLabel: 'Deals under contract',
    alertTypes: ['deadline_approaching'],
    dealCardWritePermissions: [],
    registryRef: 'transaction_coordinating',
  }),
  leg({
    id: 'finance',
    displayName: 'Finance',
    purpose: 'Deal economics, cost tracking, bookkeeping. Prefers deterministic calculation.',
    normalTylerInputs: ['what does this deal cost', 'what is the net on this'],
    automaticActions: ['deterministic deal-economics calculation when verified inputs exist'],
    onDemandActions: ['produce deal economics snapshot'],
    hardNoGoRules: ['never present an estimate as a verified value', 'never anchor on seller-stated price'],
    outputContract: ['deal_economics', 'cost_tracking', 'projected_net_profit'],
    canRunParallel: true,
    requiresHumanApprovalFor: [],
    dashboardRoute: '/landos/legs/finance',
    status: 'shell',
    summaryMetricLabel: 'Deals needing economics',
    alertTypes: ['below_min_net', 'cost_overrun'],
    dealCardWritePermissions: ['deal_economics'],
    registryRef: 'finance_bookkeeping',
  }),
  leg({
    id: 'ai-watcher',
    displayName: 'AI Watcher',
    purpose: 'Monitors agent outputs for failures; escalates and creates diagnostic tasks for Forge.',
    normalTylerInputs: ['is anything broken', 'what failed'],
    automaticActions: ['monitor outputs for failures', 'escalate real failures to Forge'],
    onDemandActions: ['summarize recent failures'],
    hardNoGoRules: ['never auto-repair production behavior without approval'],
    outputContract: ['failure_detection', 'escalation_to_forge'],
    canRunParallel: true,
    requiresHumanApprovalFor: ['auto_repair'],
    dashboardRoute: '/landos/legs/ai-watcher',
    status: 'shell',
    summaryMetricLabel: 'Open failures',
    alertTypes: ['agent_failure', 'quality_regression'],
    dealCardWritePermissions: [],
    registryRef: 'ai_watcher_qa',
  }),
  leg({
    id: 'forge',
    displayName: 'Forge',
    purpose:
      'System builder, debugger, QA repair, diagnostics, agent/workflow builder. NOT the deal ' +
      'orchestrator. Never auto-commits, pushes, deletes, reads .env, mutates CRM, or calls paid ' +
      'APIs without explicit approval.',
    normalTylerInputs: ['build an agent', 'fix this bug', 'add this workflow'],
    automaticActions: ['read-only diagnostics', 'scoped repair planning'],
    onDemandActions: ['build/repair (approved scope)', 'requirements interview'],
    hardNoGoRules: ['no auto commit/push/delete', 'no reading .env', 'no CRM mutation', 'no paid API without approval'],
    outputContract: ['diagnostic_report', 'repair_plan', 'build_plan', 'requirements_doc'],
    canRunParallel: true,
    requiresHumanApprovalFor: ['commit', 'push', 'delete', 'read_env', 'mutate_crm', 'paid_api'],
    dashboardRoute: '/landos/legs/forge',
    status: 'active',
    summaryMetricLabel: 'Open build tasks',
    alertTypes: ['build_failure', 'diagnostic_escalation'],
    dealCardWritePermissions: [],
    registryRef: 'forge_builder_diagnostics',
  }),
];

// ───────────────────────────────────────────────────────────────────────────
// Shared surfaces
// ───────────────────────────────────────────────────────────────────────────

/** The six War Room opening-page cards built by Mark/ClaudeClaw. Preserved. */
export const WAR_ROOM_PRESERVED_CARDS: readonly string[] = [
  'Voice',
  'Text',
  'Live Meetings',
  'Voice config',
  'Standup roster',
  'Open in classic',
];

export const SHARED_SURFACES: readonly SharedNode[] = [
  {
    id: 'landos-command',
    displayName: 'LandOS Command',
    category: 'shared_surface',
    purpose:
      'The CEO / executive assistant / main orchestrator. The ONLY orchestrator. Receives operator ' +
      'requests, classifies intent, selects department legs, and returns a business-first summary ' +
      'with separable technical detail. Helps Tyler decide; never makes the final decision.',
    routes: ['/landos', '/landos/command'],
    inputs: ['operator request (typed/voice/file/automation/external_event)', 'deal context'],
    outputs: ['request summary', 'selected departments', 'operator next action', 'business summary', 'collapsible technical detail'],
    departmentConnections: DEPARTMENT_LEGS.map((l) => l.id),
    hardNoGoRules: ['never make the final decision for Tyler', 'never bypass a leg hard no-go rule'],
    preservationRules: [],
    orchestrator: true,
  },
  {
    id: 'war-room',
    displayName: 'War Room',
    category: 'shared_surface',
    purpose:
      'The existing cross-agent / cross-department conversation surface built by Mark/ClaudeClaw. ' +
      'A shared conversation surface, NOT a department dashboard and NOT an orchestrator. LandOS adds ' +
      'a non-destructive routing connection around/behind it without changing the existing page.',
    routes: ['/warroom', '/warroom/text', '/warroom/classic'],
    inputs: ['voice', 'text', 'live meeting audio'],
    outputs: ['cross-agent conversation', 'standup', 'meeting transcripts'],
    departmentConnections: DEPARTMENT_LEGS.map((l) => l.id),
    hardNoGoRules: [
      'do not rebuild, redesign, rename, or overwrite the existing War Room page',
      'do not remove the existing cards or Gemini Live / Pipecat / Voice config / classic War Room / standup reminders',
      'do not turn War Room into a department dashboard',
      'do not create a duplicate War Room',
    ],
    preservationRules: [
      'preserve the existing opening-page cards: ' + WAR_ROOM_PRESERVED_CARDS.join(', '),
      'preserve existing Gemini Live, Pipecat, Voice config, classic War Room, and standup-roster language/reminders',
      'War Room routing connection must be additive and minimal, never a redesign',
    ],
    orchestrator: false,
  },
];

// ───────────────────────────────────────────────────────────────────────────
// Shared records
// ───────────────────────────────────────────────────────────────────────────

export const SHARED_RECORDS: readonly SharedNode[] = [
  {
    id: 'deal-cards',
    displayName: 'Deal Cards',
    category: 'shared_record',
    purpose:
      'The shared business record where department leg outputs come together. The source of truth for ' +
      'each deal, with every fact carrying a truth/source/status label. Persisted locally in the ' +
      'gitignored runtime store (see deal-card.ts). A record, not a department.',
    routes: ['/landos/deal-cards', '/landos/deal-cards/:id'],
    inputs: ['DD/research outputs', 'market context', 'strategy outputs', 'finance economics', 'communication summaries'],
    outputs: ['deal card header', 'imagery panel', 'deal economics', 'land data / DD facts', 'owner/seller panel', 'communication summary', 'exit strategy analysis', 'documents/activity/quick actions', 'pre-call brief'],
    departmentConnections: DEPARTMENT_LEGS.filter((l) => l.dealCardWritePermissions.length > 0).map((l) => l.id),
    hardNoGoRules: [
      'never store unverified info as a verified fact',
      'never let seller-stated price anchor a calculated offer',
      'never store property-specific work product in the GitHub repo',
    ],
    preservationRules: [],
    orchestrator: false,
  },
];

// ───────────────────────────────────────────────────────────────────────────
// Interface layers
// ───────────────────────────────────────────────────────────────────────────

export const INTERFACE_LAYERS: readonly SharedNode[] = [
  {
    id: 'voice-layer',
    displayName: 'Voice Layer',
    category: 'interface_layer',
    purpose:
      'An input/output layer over LandOS Command and War Room. Voice is request/response only this ' +
      'sprint (contract-ready), NOT a business-logic department. Existing Mark-created Voice setup ' +
      'reminders in War Room are preserved.',
    routes: [],
    inputs: ['voice transcript (typed-equivalent)'],
    outputs: ['voice-ready response intent'],
    departmentConnections: [THE_ORCHESTRATOR_ID, 'war-room'],
    hardNoGoRules: ['voice does not contain business logic', 'never remove existing Voice/Gemini/Pipecat reminders'],
    preservationRules: ['preserve existing Mark-created Voice setup reminders in War Room'],
    orchestrator: false,
  },
];

// ───────────────────────────────────────────────────────────────────────────
// Aggregates + helpers
// ───────────────────────────────────────────────────────────────────────────

export const REQUIRED_DEPARTMENT_LEG_IDS: readonly string[] = [
  'due-diligence-research',
  'strategy',
  'market-research',
  'crm-acquisition-ghl',
  'marketing',
  'dispositions',
  'transactions',
  'finance',
  'ai-watcher',
  'forge',
];

export const ALL_SHARED_NODES: readonly SharedNode[] = [
  ...SHARED_SURFACES,
  ...SHARED_RECORDS,
  ...INTERFACE_LAYERS,
];

export function getDepartmentLeg(id: string): DepartmentLeg | undefined {
  return DEPARTMENT_LEGS.find((l) => l.id === id);
}

export function getSharedNode(id: string): SharedNode | undefined {
  return ALL_SHARED_NODES.find((n) => n.id === id);
}

/** The single orchestrator id. There is exactly one. */
export function theOnlyOrchestrator(): string {
  return THE_ORCHESTRATOR_ID;
}

/** All nodes flagged as orchestrators. Must be exactly [landos-command]. */
export function orchestratorNodeIds(): string[] {
  const ids = ALL_SHARED_NODES.filter((n) => n.orchestrator).map((n) => n.id);
  // Department legs are typed orchestrator:false, so they can never appear here.
  return ids;
}

/** Throws if the no-center-of-gravity / single-orchestrator invariants break. */
export function assertNoCenterOfGravity(): void {
  const orchestrators = orchestratorNodeIds();
  if (orchestrators.length !== 1 || orchestrators[0] !== THE_ORCHESTRATOR_ID) {
    throw new Error(`Exactly one orchestrator (${THE_ORCHESTRATOR_ID}) is allowed; found: ${orchestrators.join(', ') || 'none'}`);
  }
  for (const l of DEPARTMENT_LEGS) {
    if (l.orchestrator !== false || l.centerOfGravity !== false) {
      throw new Error(`Department leg ${l.id} must not orchestrate or be the center of gravity.`);
    }
  }
}

/** Compact summary for the Command home department status tiles. */
export interface LegTileSummary {
  id: string;
  displayName: string;
  status: LegStatus;
  summaryMetricLabel: string;
  dashboardRoute: string | null;
  canAlert: boolean;
}

export function landosStructureSummary(): LegTileSummary[] {
  return DEPARTMENT_LEGS.map((l) => ({
    id: l.id,
    displayName: l.displayName,
    status: l.status,
    summaryMetricLabel: l.summaryMetricLabel,
    dashboardRoute: l.dashboardRoute,
    canAlert: l.alertTypes.length > 0,
  }));
}

/** War Room preservation contract, surfaced for the dashboard/tests. */
export function warRoomPreservation(): { cards: readonly string[]; preservationRules: readonly string[] } {
  const wr = getSharedNode('war-room')!;
  return { cards: WAR_ROOM_PRESERVED_CARDS, preservationRules: wr.preservationRules };
}

// ── War Room -> department routing connection contract ─────────────────────
// Non-destructive: this describes HOW War Room messages can reach department
// legs via LandOS Command. It adds a contract, not a redesign. The existing War
// Room page renders unchanged; routing happens behind it through Command.
export interface WarRoomRoutingContract {
  surface: 'war-room';
  routesThrough: typeof THE_ORCHESTRATOR_ID;
  /** War Room never routes directly to a leg; it always goes via Command. */
  directLegRouting: false;
  /** Existing page is canonical and untouched. */
  preservesExistingPage: true;
  connectableLegs: string[];
  note: string;
}

export const WAR_ROOM_ROUTING_CONTRACT: WarRoomRoutingContract = {
  surface: 'war-room',
  routesThrough: THE_ORCHESTRATOR_ID,
  directLegRouting: false,
  preservesExistingPage: true,
  connectableLegs: DEPARTMENT_LEGS.map((l) => l.id),
  note:
    'War Room messages reach department legs only via LandOS Command. This is an additive routing ' +
    'contract behind the existing War Room page; the existing cards and reminders are unchanged.',
};
