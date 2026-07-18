// LandOS required core department registry.
//
// These are the first-class LandOS departments. Some are SHELLS for now (they
// exist in the registry so Tyler can be interviewed later to build them out),
// but Research and Due Diligence is OPERATIONAL today: Duke is a live parcel
// verification + due diligence agent, not a placeholder. This registry is the
// extensibility seam — a future department/agent is added as data here, not by
// rewriting the intake type or planner.
//
// This file is config + contracts: no DB, no network, no secrets. It does not
// replace the existing departments.ts display registry; it is the deeper
// capability/model-policy registry the intake foundation consumes.

import type {
  DepartmentRegistryEntry,
  AgentRegistryEntry,
  AgentModelPolicy,
  ModelEscalationRule,
} from './intake-types.js';

const noEscalation: ModelEscalationRule = { allowed: false, requiresTylerApproval: false };

function agentModelPolicy(
  agentId: string,
  defaultRoute: AgentModelPolicy['defaultRoute'],
  opts: Partial<AgentModelPolicy> = {},
): AgentModelPolicy {
  return {
    agentId,
    defaultRoute,
    escalation: opts.escalation ?? noEscalation,
    maxTokenBudget: opts.maxTokenBudget,
    paidApiRequiresApproval: opts.paidApiRequiresApproval ?? true,
  };
}

// ── Duke: the live Research & Due Diligence agent ──────────────────────────
// Duke is operational. Its model policy reflects deterministic/exact-source
// first: parcel verification runs in code + exact sources, not an expensive
// freeform model by default.
const DUKE: AgentRegistryEntry = {
  agentId: 'duke-due-diligence',
  name: 'Property Research Agent',
  role: 'Parcel verification, public-record research, and due diligence',
  departmentId: 'research_due_diligence',
  lifecycle: 'operational',
  capability: {
    id: 'parcel_due_diligence',
    label: 'Parcel verification + due diligence',
    requiredInputs: ['property_identity'], // address / APN+county / owner+county / LP url / property id
    blockedConditions: [
      'parcel_not_verified',
      'identity_from_coordinates_or_proximity', // never allowed
      'comp_credit_required_without_approval',
    ],
    canRunAsync: true,
    canCollaborate: true,
    canWriteDealCard: true,
    requiresTylerApprovalForRisk: true,
    canUsePaidApis: false, // LandPortal comp tools stay separately gated
    canMutateCrm: false,
    canAccessPrivateData: false,
    outputTypes: ['parcel_verification', 'due_diligence_summary', 'source_trace', 'discovery_gaps'],
    requiresWebBrowsing: false,
    modelPolicy: {
      workerId: 'duke-due-diligence',
      defaultRoute: 'deterministic_code',
      escalation: { allowed: true, toRoute: 'reasoning_oriented', reason: 'Summarize/explain anomalies only.', requiresTylerApproval: false },
      deterministicPreferred: true,
    },
  },
  permissions: {
    agentId: 'duke-due-diligence',
    canWriteDealCard: true,
    canMutateCrm: false,
    canUsePaidApis: false,
    canDeleteFiles: false,
    canCommitOrPush: false,
    canReadSecrets: false,
    requiresApprovalFor: [],
  },
  modelPolicy: agentModelPolicy('duke-due-diligence', 'deterministic_code', {
    escalation: { allowed: true, toRoute: 'reasoning_oriented', reason: 'Summary/anomaly explanation only.', requiresTylerApproval: false },
  }),
};

function shellAgent(
  agentId: string,
  name: string,
  role: string,
  departmentId: string,
  defaultRoute: AgentModelPolicy['defaultRoute'],
  lifecycle: AgentRegistryEntry['lifecycle'] = 'shell',
): AgentRegistryEntry {
  return {
    agentId,
    name,
    role,
    departmentId,
    lifecycle,
    capability: {
      id: `${agentId}_capability`,
      label: role,
      requiredInputs: [],
      blockedConditions: ['department_not_built_out'],
      canRunAsync: false,
      canCollaborate: true,
      canWriteDealCard: false,
      requiresTylerApprovalForRisk: true,
      canUsePaidApis: false,
      canMutateCrm: false,
      canAccessPrivateData: false,
      outputTypes: [],
      requiresWebBrowsing: false,
      modelPolicy: {
        workerId: agentId,
        defaultRoute,
        escalation: noEscalation,
        deterministicPreferred: defaultRoute === 'deterministic_code',
      },
    },
    permissions: {
      agentId,
      canWriteDealCard: false,
      canMutateCrm: false,
      canUsePaidApis: false,
      canDeleteFiles: false,
      canCommitOrPush: false,
      canReadSecrets: false,
      requiresApprovalFor: ['risky_actions'],
    },
    modelPolicy: agentModelPolicy(agentId, defaultRoute),
  };
}

const COMMON_BUILDOUT_TOPICS = [
  'purpose',
  'agents',
  'workflows',
  'tools',
  'permissions',
  'crm_behavior',
  'dashboards',
  'outputs',
  'automations',
  'safety_gates',
  'training_knowledge_sources',
  'model_default_policy',
  'cost_token_budgets',
];

export const DEPARTMENT_REGISTRY: readonly DepartmentRegistryEntry[] = [
  {
    id: 'acquisition',
    label: 'Acquisition',
    lifecycle: 'shell',
    description: 'Seller discovery preparation and internal communication drafts. The owner sends anything external.',
    capability: { departmentId: 'acquisition', operational: false, capabilities: ['seller_discovery_prep', 'seller_communication_prep'] },
    agents: [shellAgent('acquisition-copilot', 'Acquisitions Agent', 'Seller discovery preparation and reconciliation', 'acquisition', 'reasoning_oriented', 'operational')],
    buildoutInterview: { departmentId: 'acquisition', topics: COMMON_BUILDOUT_TOPICS },
    modelPolicy: { departmentId: 'acquisition', defaultRoute: 'reasoning_oriented', escalationRoute: 'approval_required' },
  },
  {
    id: 'research_due_diligence',
    label: 'Research and Due Diligence',
    lifecycle: 'operational',
    description:
      'Operational. The Property Research Agent performs parcel verification and parcel due diligence with deterministic/exact-source-first behavior. ' +
      'Local area vacant-land market research is a separate lane and returns an honest status until an approved browsing/search adapter is connected.',
    capability: {
      departmentId: 'research_due_diligence',
      operational: true,
      capabilities: [
        'parcel_verification',
        'parcel_due_diligence',
        'property_input_parsing',
        'landportal_authenticated_browser_lookup',
        'no_comp_credit_rule',
        'no_coordinate_verification_rule',
        'unverified_parcel_blocking',
        'local_market_research_lane',
      ],
    },
    agents: [DUKE],
    buildoutInterview: { departmentId: 'research_due_diligence', topics: COMMON_BUILDOUT_TOPICS },
    modelPolicy: { departmentId: 'research_due_diligence', defaultRoute: 'deterministic_code', escalationRoute: 'reasoning_oriented' },
  },
  {
    id: 'strategy',
    label: 'Strategy',
    lifecycle: 'shell',
    description: 'Exit strategy, deal structure, and final strategic recommendation — only when verified facts support it. Paired with Underwriting.',
    capability: { departmentId: 'strategy', operational: false, capabilities: ['exit_strategy', 'deal_structure', 'final_recommendation'] },
    agents: [shellAgent('strategy', 'Strategy', 'Exit strategy and final recommendation', 'strategy', 'reasoning_oriented')],
    buildoutInterview: { departmentId: 'strategy', topics: COMMON_BUILDOUT_TOPICS },
    modelPolicy: { departmentId: 'strategy', defaultRoute: 'reasoning_oriented', escalationRoute: 'approval_required' },
  },
  {
    id: 'underwriting',
    label: 'Underwriting',
    lifecycle: 'shell',
    description: 'Paired worker that runs the numbers, tests strategies, and validates whether a strategy actually works. Math is deterministic where possible.',
    capability: { departmentId: 'underwriting', operational: false, capabilities: ['run_numbers', 'validate_strategy', 'max_allowable_offer'] },
    agents: [shellAgent('underwriting', 'Underwriting', 'Runs and validates deal numbers', 'underwriting', 'deterministic_code')],
    buildoutInterview: { departmentId: 'underwriting', topics: COMMON_BUILDOUT_TOPICS },
    modelPolicy: { departmentId: 'underwriting', defaultRoute: 'deterministic_code', escalationRoute: 'reasoning_oriented' },
  },
  {
    id: 'marketing',
    label: 'Marketing',
    lifecycle: 'shell',
    description: 'Campaign and lead-source performance. No live ad changes without approval.',
    capability: { departmentId: 'marketing', operational: false, capabilities: ['campaign_records', 'lead_source_performance'] },
    agents: [shellAgent('mia-marketing', 'Marketing Agent', 'Marketing and lead generation', 'marketing', 'task_oriented')],
    buildoutInterview: { departmentId: 'marketing', topics: COMMON_BUILDOUT_TOPICS },
    modelPolicy: { departmentId: 'marketing', defaultRoute: 'task_oriented', escalationRoute: 'reasoning_oriented', defaultModelId: 'gemma-4-e4b' },
  },
  {
    id: 'dispositions',
    label: 'Dispositions',
    lifecycle: 'shell',
    description: 'Buyer research, exit prep, listing strategy.',
    capability: { departmentId: 'dispositions', operational: false, capabilities: ['buyer_research', 'exit_prep', 'listing_strategy'] },
    agents: [shellAgent('drew-dispositions', 'Dispositions Agent', 'Dispositions', 'dispositions', 'reasoning_oriented')],
    buildoutInterview: { departmentId: 'dispositions', topics: COMMON_BUILDOUT_TOPICS },
    modelPolicy: { departmentId: 'dispositions', defaultRoute: 'reasoning_oriented' },
  },
  {
    id: 'transaction_coordinating',
    label: 'Transaction Coordinating',
    lifecycle: 'shell',
    description: 'Signed-deal-through-closing coordination: title/closing checklist, deadlines, seller documents.',
    capability: { departmentId: 'transaction_coordinating', operational: false, capabilities: ['closing_checklist', 'deadline_tracking'] },
    agents: [shellAgent('transaction-coordination', 'TC', 'Transaction coordination', 'transaction_coordinating', 'task_oriented')],
    buildoutInterview: { departmentId: 'transaction_coordinating', topics: COMMON_BUILDOUT_TOPICS },
    modelPolicy: { departmentId: 'transaction_coordinating', defaultRoute: 'task_oriented', escalationRoute: 'reasoning_oriented', defaultModelId: 'gemma-4-e4b' },
  },
  {
    id: 'finance_bookkeeping',
    label: 'Finance / Bookkeeping',
    lifecycle: 'shell',
    description: 'Deal economics, cost tracking, bookkeeping. Prefers deterministic calculation and conservative models.',
    capability: { departmentId: 'finance_bookkeeping', operational: false, capabilities: ['cost_tracking', 'deal_economics', 'bookkeeping_hooks'] },
    agents: [shellAgent('finn-finance-risk', 'Finance Agent', 'Finance and bookkeeping', 'finance_bookkeeping', 'deterministic_code')],
    buildoutInterview: { departmentId: 'finance_bookkeeping', topics: COMMON_BUILDOUT_TOPICS },
    modelPolicy: { departmentId: 'finance_bookkeeping', defaultRoute: 'deterministic_code', escalationRoute: 'reasoning_oriented' },
  },
  {
    id: 'crm_manager',
    label: 'CRM Manager',
    lifecycle: 'shell',
    description: 'Monitors and routes CRM/GHL workflow health. Never modifies GHL without approval.',
    capability: { departmentId: 'crm_manager', operational: false, capabilities: ['pipeline_hygiene', 'lead_attribution', 'automation_health'] },
    agents: [shellAgent('crm-manager', 'CRM Manager', 'CRM/GHL success management', 'crm_manager', 'task_oriented')],
    buildoutInterview: { departmentId: 'crm_manager', topics: COMMON_BUILDOUT_TOPICS },
    modelPolicy: { departmentId: 'crm_manager', defaultRoute: 'task_oriented', defaultModelId: 'gemma-4-e4b' },
  },
  {
    id: 'ai_watcher_qa',
    label: 'AI Watcher / QA',
    lifecycle: 'shell',
    description: 'Monitors agent outputs for failures; escalates and creates diagnostic tasks for Forge. Cheap monitoring, escalate only on real failure.',
    capability: { departmentId: 'ai_watcher_qa', operational: false, capabilities: ['output_monitoring', 'failure_detection', 'escalation_to_forge'] },
    agents: [shellAgent('ai-watcher', 'Watcher', 'AI output QA and monitoring', 'ai_watcher_qa', 'task_oriented')],
    buildoutInterview: { departmentId: 'ai_watcher_qa', topics: COMMON_BUILDOUT_TOPICS },
    modelPolicy: { departmentId: 'ai_watcher_qa', defaultRoute: 'task_oriented', escalationRoute: 'reasoning_oriented', defaultModelId: 'gemma-4-e4b' },
  },
  {
    id: 'security_cybersecurity',
    label: 'Security / Cybersecurity',
    lifecycle: 'shell',
    description: 'Repo/package/MCP review, secrets hygiene, risk analysis. Strong reasoning for analysis; hard gates for secrets/destructive actions.',
    capability: { departmentId: 'security_cybersecurity', operational: false, capabilities: ['security_review', 'secrets_hygiene', 'risk_analysis'] },
    agents: [shellAgent('security', 'Security', 'Security and cybersecurity review', 'security_cybersecurity', 'reasoning_oriented')],
    buildoutInterview: { departmentId: 'security_cybersecurity', topics: COMMON_BUILDOUT_TOPICS },
    modelPolicy: { departmentId: 'security_cybersecurity', defaultRoute: 'reasoning_oriented', escalationRoute: 'approval_required' },
  },
  {
    id: 'ceo_war_room',
    label: 'CEO / War Room',
    lifecycle: 'shell',
    description: 'Visible group collaboration with Tyler present for strategy debates and high-level decisions. Separate from hidden inter-agent collaboration.',
    capability: { departmentId: 'ceo_war_room', operational: false, capabilities: ['group_decision_support', 'operator_meetings'] },
    agents: [shellAgent('war-room', 'War Room', 'Visible multi-agent decision room', 'ceo_war_room', 'reasoning_oriented')],
    buildoutInterview: { departmentId: 'ceo_war_room', topics: COMMON_BUILDOUT_TOPICS },
    modelPolicy: { departmentId: 'ceo_war_room', defaultRoute: 'reasoning_oriented', escalationRoute: 'approval_required' },
  },
  {
    id: 'forge_builder_diagnostics',
    label: 'Forge / Builder / Diagnostics',
    lifecycle: 'operational',
    description:
      'System builder, debugger, QA repair, diagnostics, and agent/workflow builder. NOT the normal deal orchestrator. ' +
      'Never auto-commits, pushes, deletes, reads .env, mutates CRM, or calls paid APIs without explicit approval.',
    capability: {
      departmentId: 'forge_builder_diagnostics',
      operational: true,
      capabilities: ['system_diagnostics', 'scoped_repair', 'agent_build', 'workflow_build', 'requirements_interview'],
    },
    agents: [
      {
        agentId: 'forge',
        name: 'Forge',
        role: 'System build/debug/repair/diagnostics',
        departmentId: 'forge_builder_diagnostics',
        lifecycle: 'operational',
        capability: {
          id: 'forge_build_diagnostics',
          label: 'Build/debug/repair/diagnostics',
          requiredInputs: ['build_or_repair_request'],
          blockedConditions: ['needs_approval_for_commit_push_delete_env_crm_paid_api'],
          canRunAsync: true,
          canCollaborate: true,
          canWriteDealCard: false,
          requiresTylerApprovalForRisk: true,
          canUsePaidApis: false,
          canMutateCrm: false,
          canAccessPrivateData: false,
          outputTypes: ['diagnostic_report', 'repair_plan', 'build_plan', 'requirements_doc'],
          requiresWebBrowsing: false,
          modelPolicy: {
            workerId: 'forge',
            defaultRoute: 'reasoning_oriented',
            escalation: noEscalation,
            deterministicPreferred: false,
          },
        },
        permissions: {
          agentId: 'forge',
          canWriteDealCard: false,
          canMutateCrm: false,
          canUsePaidApis: false,
          canDeleteFiles: false,
          canCommitOrPush: false,
          canReadSecrets: false,
          requiresApprovalFor: ['commit', 'push', 'delete', 'read_env', 'mutate_crm', 'paid_api'],
        },
        modelPolicy: agentModelPolicy('forge', 'reasoning_oriented'),
      },
    ],
    buildoutInterview: { departmentId: 'forge_builder_diagnostics', topics: COMMON_BUILDOUT_TOPICS },
    modelPolicy: { departmentId: 'forge_builder_diagnostics', defaultRoute: 'reasoning_oriented' },
  },
];

/** The required core department ids, for tests and capability checks. */
export const REQUIRED_DEPARTMENT_IDS: readonly string[] = DEPARTMENT_REGISTRY.map((d) => d.id);

export function getDepartment(id: string): DepartmentRegistryEntry | undefined {
  return DEPARTMENT_REGISTRY.find((d) => d.id === id);
}

export function getAgent(agentId: string): AgentRegistryEntry | undefined {
  for (const d of DEPARTMENT_REGISTRY) {
    const a = d.agents.find((x) => x.agentId === agentId);
    if (a) return a;
  }
  return undefined;
}

/** Compact summary used by the intake plan and the read-only route. */
export function departmentRegistrySummary(): Array<{
  id: string;
  label: string;
  lifecycle: DepartmentRegistryEntry['lifecycle'];
  operational: boolean;
}> {
  return DEPARTMENT_REGISTRY.map((d) => ({
    id: d.id,
    label: d.label,
    lifecycle: d.lifecycle,
    operational: d.capability.operational,
  }));
}
