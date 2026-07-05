// LandOS department/module registry — OS Spine v1.
//
// Departments are modules inside the single LandOS app, not separate apps.
// Department architecture matters more than names; agent names are
// changeable config. Planned departments are config-only: no agent folders
// are created until Tyler approves building each agent.

export interface DepartmentAgent {
  agentId: string;
  name: string;
  role: string;
  status: 'active' | 'planned';
}

export interface Department {
  id: string;
  label: string;
  status: 'active' | 'planned';
  description: string;
  agents: DepartmentAgent[];
}

export const DEPARTMENTS: readonly Department[] = [
  {
    id: 'command_center',
    label: 'Command Center',
    status: 'active',
    description: 'Coordination, approvals queue, daily brief.',
    agents: [
      { agentId: 'main', name: 'Main', role: 'Coordination and triage', status: 'active' },
    ],
  },
  {
    id: 'acquisitions',
    label: 'Acquisitions',
    status: 'active',
    description: 'Seller psychology, call prep and analysis, follow-ups, offer-call framing. Seller-facing drafts only; Tyler sends.',
    agents: [
      { agentId: 'acquisition-copilot', name: 'Ace', role: 'Acquisition co-pilot and seller communication support', status: 'active' },
    ],
  },
  {
    id: 'due_diligence_comps',
    label: 'Due Diligence + Comps & Valuation',
    status: 'active',
    description: 'First-pass DD, LandPortal workflow, scoring, EV, anomaly flags, comp workflows.',
    agents: [
      { agentId: 'duke-due-diligence', name: 'Duke', role: 'Due diligence and LandPortal workflow', status: 'active' },
    ],
  },
  {
    id: 'market_intelligence',
    label: 'Market Intelligence',
    status: 'active',
    description: 'Owns the Market Matrix — the master market-intelligence database answering "where should Tyler buy land?". Builds county-level market facts (PPA, DOM, sell-through, absorption, population growth) by geography + acreage band + quarter, runs deterministic MarketQueries + rankings, and serves every other department instead of duplicate market analysis. Facts only; the database computes, the AI interprets.',
    agents: [
      { agentId: 'market-intelligence', name: 'Mara', role: 'Market intelligence and the Market Matrix', status: 'active' },
    ],
  },
  {
    id: 'browser_agent',
    label: 'Browser Agent',
    status: 'active',
    description: 'Owns browser automation for LandOS. Executes Browser Playbooks (reusable per-website navigation + extraction recipes) and returns validated-shape structured data to whichever department delegated the work. Playbook #1 is LandPortal Market Research (Market Research → Drill Deep only). It does NOT own any business domain — Market Intelligence owns market data and delegates browser collection here; future departments (county GIS, FEMA, assessor, zoning) will add their own playbooks. Read-only; never stores credentials.',
    agents: [
      { agentId: 'browser-agent', name: 'Web', role: 'Browser automation and Browser Playbook execution', status: 'active' },
    ],
  },
  {
    id: 'browser_training',
    label: 'Browser Training',
    status: 'active',
    description:
      'Teaches browser agents by live demonstration. Tyler shares a tab/window/desktop and talks through a workflow; LandOS watches, listens, holds a two-way voice conversation, records the browser events, extracts business rules, and generates a reusable Browser Playbook the Browser Agent department can execute. Training is always started manually and never auto-starts. Never teaches paid report flows; any billing/checkout/paid action stops with Approval Required. Reads LandPortal credentials only from .env; never stores secrets or property work product.',
    agents: [
      { agentId: 'browser-training', name: 'Tutor', role: 'Live browser-workflow training and playbook authoring', status: 'active' },
    ],
  },
  {
    id: 'finance_risk',
    label: 'Finance & Risk',
    status: 'planned',
    description: 'Deal economics review, cost tracking, risk scoring, bookkeeping hooks.',
    agents: [
      { agentId: 'finn-finance-risk', name: 'Finn', role: 'Finance and risk (planned)', status: 'planned' },
    ],
  },
  {
    id: 'dispositions',
    label: 'Dispositions',
    status: 'planned',
    description: 'Buyer research, exit prep, listing strategy.',
    agents: [
      { agentId: 'drew-dispositions', name: 'Drew', role: 'Dispositions (planned)', status: 'planned' },
    ],
  },
  {
    id: 'marketing_leadgen',
    label: 'Marketing & Lead Gen',
    status: 'planned',
    description: 'Campaign and lead-source performance records. No live ad changes without approval.',
    agents: [
      { agentId: 'mia-marketing', name: 'Mia', role: 'Marketing and lead gen (planned)', status: 'planned' },
    ],
  },
  {
    id: 'crm_ghl_success',
    label: 'CRM / GHL Success Management',
    status: 'planned',
    description: 'Monitors and routes CRM/GHL workflow health: pipeline hygiene, missed-lead and follow-up alerts, source/campaign attribution, automation health, duplicate/contact data quality. GHL/CRM is one operating leg inside LandOS, not LandOS itself; this lane never modifies GHL.',
    agents: [],
  },
  {
    id: 'transaction_coordination',
    label: 'Transaction Coordination',
    status: 'planned',
    description: 'Signed-deal-through-closing coordination: title/closing checklist, deadlines, seller documents, earnest-money status, attorney/title-company coordination. Sits between Acquisitions, Due Diligence, Finance, and Dispositions.',
    agents: [
      { agentId: 'transaction-coordination', name: 'TC', role: 'Transaction coordination (planned)', status: 'planned' },
    ],
  },
  {
    id: 'research',
    label: 'Research',
    status: 'planned',
    description: 'Market intelligence, industry intelligence, and AI evolution monitoring. Recommends only; never installs or switches anything without approval.',
    agents: [
      { agentId: 'rex-research', name: 'Rex', role: 'Research (planned)', status: 'planned' },
    ],
  },
  {
    id: 'security_ai_systems',
    label: 'Security & AI Systems',
    status: 'planned',
    description: 'Repo/package/MCP review checklists, secrets hygiene, MCP allowlists, veto power via security_review records.',
    agents: [],
  },
];
