// LandOS 14-agent roster — the Vision-aligned, authoritative agent model.
//
// LandOS is the operating system; this roster is its org chart. The Executive
// Agent is the orchestrator (single point of contact). The other 13 agents are
// department specialists across four groups. Duke is the Due Diligence Specialist
// lane — NOT the center of the system.
//
// Each agent declares: stable key, display name, group, role, default model tier,
// R2 knowledge + memory paths, a Deal-Card attachment class (see
// deal-card-attachment-policy.ts), an existing implementation agentId when one is
// already wired, and a build status. This is config/scaffold — no training
// content, credentials, or external accounts are required to define the roster.

export type AgentGroup = 'orchestrator' | 'acquisitions' | 'operations' | 'intelligence';
export type ModelTier = 'tier1' | 'tier2' | 'tier3';
export type AgentStatus = 'active' | 'scaffold' | 'planned';

/** How an agent's OUTPUT routes (codified in deal-card-attachment-policy.ts):
 *  - property: outputs attach to the subject parcel's Deal Card.
 *  - business: outputs go to the R2 knowledge layer, never a Deal Card.
 *  - conditional: attaches ONLY when the output is tied to a specific property. */
export type AttachmentClass = 'property' | 'business' | 'conditional';

export interface AgentDef {
  key: string;            // stable Vision key, e.g. 'dd_bot'
  name: string;           // display name
  group: AgentGroup;
  role: string;
  defaultTier: ModelTier;
  attachment: AttachmentClass;
  /** R2 knowledge + memory roots (path conventions; see knowledge-store.ts). */
  knowledgePath: string;
  memoryPath: string;
  /** Existing wired implementation agent id, when one already exists. */
  implAgentId?: string;
  status: AgentStatus;
  /** True for the single orchestrator. */
  orchestrator?: boolean;
}

export const AGENT_ROSTER: readonly AgentDef[] = [
  // ── Orchestrator ──────────────────────────────────────────────────────────
  {
    key: 'exec_bot', name: 'Executive Agent', group: 'orchestrator',
    role: 'Single point of contact. Interprets operator intent, routes to the right department, coordinates multi-agent work, returns results. Handles voice + Telegram + dashboard.',
    defaultTier: 'tier2', attachment: 'conditional',
    knowledgePath: 'agents/exec_bot/knowledge', memoryPath: 'agents/exec_bot/memory',
    implAgentId: 'main', status: 'active', orchestrator: true,
  },

  // ── Acquisitions pipeline ─────────────────────────────────────────────────
  {
    key: 'lead_bot', name: 'Lead Manager', group: 'acquisitions',
    role: 'Lead intake + triage. Flags low-value infill, routes commercial/structures aside, acknowledges seller via CRM, kicks off DD.',
    defaultTier: 'tier1', attachment: 'property',
    knowledgePath: 'agents/lead_bot/knowledge', memoryPath: 'agents/lead_bot/memory',
    status: 'scaffold',
  },
  {
    key: 'dd_bot', name: 'Due Diligence Specialist', group: 'acquisitions',
    role: 'Data gatherer. Parcel verification, DD facts, Land Score, radius/locality comps, five/six-section Discovery report (Markdown + PDF), pre-call 40-60% offer math. Mathematical, not deep underwriting.',
    defaultTier: 'tier2', attachment: 'property',
    knowledgePath: 'agents/dd_bot/knowledge', memoryPath: 'agents/dd_bot/memory',
    implAgentId: 'duke-due-diligence', status: 'active',
  },
  {
    key: 'acquisitions_bot', name: 'Acquisitions Agent', group: 'acquisitions',
    role: 'Sales-intelligence + seller relationship expert. Per-seller profiles, call prep/summaries, debrief learning loop, playbook. Says HOW to engage a specific seller.',
    defaultTier: 'tier2', attachment: 'property',
    knowledgePath: 'agents/acquisitions_bot/knowledge', memoryPath: 'agents/acquisitions_bot/memory',
    implAgentId: 'acquisition-copilot', status: 'active',
  },
  {
    key: 'uw_bot', name: 'Underwriting Agent', group: 'acquisitions',
    role: 'Post-discovery deep underwriting. The ONLY agent that approves an offer to a seller. Synthesizes Deal Card + call summary + disclosures into the final approved offer range + strategy.',
    defaultTier: 'tier3', attachment: 'property',
    knowledgePath: 'agents/uw_bot/knowledge', memoryPath: 'agents/uw_bot/memory',
    status: 'scaffold',
  },

  // ── Operations & dispositions ─────────────────────────────────────────────
  {
    key: 'success_bot', name: 'CRM Success Manager', group: 'operations',
    role: 'Pipeline traffic controller. Tracks every lead stage + last touchpoint, flags stalled/at-risk deals, delivers a prioritized daily brief. Says WHO needs attention and WHEN. Never mutates CRM.',
    defaultTier: 'tier1', attachment: 'conditional',
    knowledgePath: 'agents/success_bot/knowledge', memoryPath: 'agents/success_bot/memory',
    status: 'planned',
  },
  {
    key: 'tc_bot', name: 'Transaction Coordinator', group: 'operations',
    role: 'Contract-to-close coordination: earnest-money deadlines, title comms, closing timeline, lender update drafts.',
    defaultTier: 'tier1', attachment: 'property',
    knowledgePath: 'agents/tc_bot/knowledge', memoryPath: 'agents/tc_bot/memory',
    implAgentId: 'transaction-coordination', status: 'planned',
  },
  {
    key: 'marketing_bot', name: 'Marketing Agent', group: 'operations',
    role: 'In-house advertising. Meta/Google ad copy + budget allocation across core states from County Scorecards, weekly optimization. No live ad changes without approval.',
    defaultTier: 'tier2', attachment: 'business',
    knowledgePath: 'agents/marketing_bot/knowledge', memoryPath: 'agents/marketing_bot/memory',
    implAgentId: 'mia-marketing', status: 'planned',
  },
  {
    key: 'dispo_bot', name: 'Dispositions Manager', group: 'operations',
    role: 'Listing drafts/descriptions, land-home feasibility, buyer inquiries, project coordination.',
    defaultTier: 'tier2', attachment: 'property',
    knowledgePath: 'agents/dispo_bot/knowledge', memoryPath: 'agents/dispo_bot/memory',
    implAgentId: 'drew-dispositions', status: 'planned',
  },

  // ── Intelligence & research ───────────────────────────────────────────────
  {
    key: 'market_bot', name: 'Market Research Agent', group: 'intelligence',
    role: 'Evaluates counties on the seven-metric framework; maintains the County Scorecard; threshold alerts on ad-spend counties.',
    defaultTier: 'tier2', attachment: 'business',
    knowledgePath: 'agents/market_bot/knowledge', memoryPath: 'agents/market_bot/memory',
    implAgentId: 'rex-research', status: 'scaffold',
  },
  {
    key: 'spy_bot', name: 'Competitor Intelligence Agent', group: 'intelligence',
    role: 'Monitors competitors across ad library, websites, social, listings; maintains competitor briefs.',
    defaultTier: 'tier2', attachment: 'business',
    knowledgePath: 'agents/spy_bot/knowledge', memoryPath: 'agents/spy_bot/memory',
    status: 'planned',
  },
  {
    key: 'ai_bot', name: 'AI Tech Researcher', group: 'intelligence',
    role: 'Monitors the AI landscape against the current stack; surfaces better local/agentic/audio/RAG/cost options. Recommends only.',
    defaultTier: 'tier2', attachment: 'business',
    knowledgePath: 'agents/ai_bot/knowledge', memoryPath: 'agents/ai_bot/memory',
    status: 'planned',
  },
  {
    key: 'research_bot', name: 'Land Investing Research Agent', group: 'intelligence',
    role: 'Finds emerging land strategies + creative exits; maintains the Strategy Library; answers unusual-parcel queries from DD/Underwriting.',
    defaultTier: 'tier2', attachment: 'conditional',
    knowledgePath: 'agents/research_bot/knowledge', memoryPath: 'agents/research_bot/memory',
    status: 'planned',
  },
  {
    key: 'sys_bot', name: 'System Health Agent', group: 'intelligence',
    role: 'DevOps watchdog + self-healing. Monitors APIs/Ollama/R2/tunnel/agent outputs; auto-resolves minor issues; alerts on the rest.',
    defaultTier: 'tier1', attachment: 'business',
    knowledgePath: 'agents/sys_bot/knowledge', memoryPath: 'agents/sys_bot/memory',
    status: 'planned',
  },
] as const;

export const ROSTER_SIZE = AGENT_ROSTER.length;

export function getAgentDef(key: string): AgentDef | undefined {
  return AGENT_ROSTER.find((a) => a.key === key);
}

export function executiveAgent(): AgentDef {
  const exec = AGENT_ROSTER.find((a) => a.orchestrator);
  if (!exec) throw new Error('roster invariant: exactly one orchestrator (Executive Agent) is required');
  return exec;
}

export function agentsByGroup(group: AgentGroup): AgentDef[] {
  return AGENT_ROSTER.filter((a) => a.group === group);
}

/** Read-only roster summary for the dashboard. */
export function rosterSummary(): Array<Pick<AgentDef, 'key' | 'name' | 'group' | 'role' | 'defaultTier' | 'attachment' | 'status' | 'orchestrator'> & { implemented: boolean }> {
  return AGENT_ROSTER.map((a) => ({
    key: a.key, name: a.name, group: a.group, role: a.role, defaultTier: a.defaultTier,
    attachment: a.attachment, status: a.status, orchestrator: a.orchestrator,
    implemented: !!a.implAgentId,
  }));
}
