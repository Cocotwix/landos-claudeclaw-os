// LandOS department model — the operator-facing company structure.
//
// This is the SINGLE SOURCE OF TRUTH for the Vision & Architecture navigation
// (docs/LANDOS_VISION_AND_ARCHITECTURE.md). It defines the executive layer +
// the eleven business departments the operator navigates. Each department maps
// to the working surfaces that already exist in the app (Property Board, Deal
// Card, Market Intelligence, Model Router, etc.) so nothing is rebuilt — the
// architecture reorganizes presentation around the business, not a tool grid.
//
// `routes.ts` derives the sidebar/router entries from this file. The Department
// page renders each department's purpose, records, capabilities, and the live
// surfaces that back it. Shell departments describe what will live there without
// overbuilding.

import {
  Landmark, Users, Megaphone, Map, Binoculars, GraduationCap,
  Tag, FileSignature, DollarSign, Cpu, Wrench,
} from 'lucide-preact';

export type DeptStatus = 'operational' | 'partial' | 'shell';

// A concrete, working area of the app a department currently surfaces. `live`
// links open real functionality; `planned` entries name a future surface.
export interface DeptSurface {
  label: string;
  href: string;
  description: string;
  status: 'live' | 'planned';
}

// A row in the AI Research tech-stack shell.
export interface TechStackRow {
  name: string;
  kind: 'closed source' | 'open source' | 'local';
  role: string;
  status: 'in use' | 'candidate' | 'under review';
}

export interface DepartmentDef {
  slug: string;
  label: string;
  icon: typeof Landmark;
  status: DeptStatus;
  /** One-line business purpose (Vision language, not backend language). */
  purpose: string;
  /** The department's primary question, when it has one. */
  primaryQuestion?: string;
  /** Shared company records this department creates or enriches. */
  records: string[];
  /** Units of work this department provides. */
  capabilities: string[];
  /** Working (or planned) surfaces that back this department today. */
  surfaces: DeptSurface[];
  /** AI Research only: the visible AI Tech Stack shell. */
  techStack?: TechStackRow[];
}

// The eleven business departments, in Vision order. Acquisitions is fully
// operational; Market Research, Strategy & Training, Finance, AI Research, and
// Operations surface existing functionality (partial); the rest are clean
// shells awaiting build-out.
export const DEPARTMENTS: DepartmentDef[] = [
  {
    slug: 'acquisitions',
    label: 'Acquisitions',
    icon: Landmark,
    status: 'operational',
    purpose: 'Acquire profitable land while improving acquisition performance. Property Intelligence + Seller Intelligence = Acquisition Intelligence.',
    records: ['Lead', 'Seller', 'Property', 'Deal Card', 'Offer', 'Discovery Notes'],
    capabilities: [
      'Property Intelligence Report', 'Parcel verification', 'Comps & valuation',
      'Offer analysis', 'Seller discovery prep', 'Negotiation support',
    ],
    surfaces: [
      { label: 'Property Board', href: '/board', description: 'Pipeline of every deal. Click a card to open its Deal Card.', status: 'live' },
      { label: 'Deal Card', href: '/landos?view=dealcard', description: 'The living Property Intelligence Report for one opportunity.', status: 'live' },
      { label: 'New Acquisition', href: '/landos?view=acquire', description: 'Resolve a parcel and open its Deal Card.', status: 'live' },
      { label: 'Intake Planner', href: '/landos?view=intake', description: 'Turn raw lead input into a structured acquisition.', status: 'live' },
      { label: 'Browser Intelligence', href: '/browser-agent', description: 'Live parcel + website research the Deal Card consumes.', status: 'live' },
      { label: 'Browser Training', href: '/browser-training', description: 'Teach research playbooks by demonstration.', status: 'live' },
    ],
  },
  {
    slug: 'crm',
    label: 'CRM',
    icon: Users,
    status: 'shell',
    purpose: 'Manage relationships, contacts, communication, follow up, and pipeline. Provider agnostic; manual entry always supported.',
    records: ['Lead', 'Seller', 'Buyer', 'Contact', 'Conversation', 'Follow up', 'Pipeline Stage'],
    capabilities: ['Contact management', 'Follow-up tracking', 'Pipeline hygiene', 'GoHighLevel connector (optional)'],
    surfaces: [
      { label: 'GoHighLevel connector', href: '/dept/crm', description: 'Optional CRM provider connection. A native LandOS CRM can replace it later.', status: 'planned' },
      { label: 'Manual contact entry', href: '/dept/crm', description: 'Add and manage contacts by hand — never requires an integration.', status: 'planned' },
    ],
  },
  {
    slug: 'marketing',
    label: 'Marketing',
    icon: Megaphone,
    status: 'shell',
    purpose: 'Generate and optimize leads across PPC, social, and landing pages.',
    records: ['Campaign', 'Ad', 'Landing Page', 'Audience', 'Keyword', 'Creative', 'Lead Source'],
    capabilities: ['Campaign performance', 'Cost per lead', 'Creative testing', 'Attribution', 'Marketing recommendations'],
    surfaces: [],
  },
  {
    slug: 'market-research',
    label: 'Market Research',
    icon: Map,
    status: 'partial',
    purpose: 'Decide which markets, counties, and territories to explore, expand, reduce, or avoid.',
    primaryQuestion: 'Where should we focus?',
    records: ['Market', 'County', 'Region', 'Territory', 'Market Report'],
    capabilities: ['County rankings', 'Market Pulse', 'Sell-through & absorption', 'DOM & inventory', 'Growth signals', 'Territory reports'],
    surfaces: [
      { label: 'Market Intelligence', href: '/market', description: 'The Market Matrix: county-level facts answering where to buy.', status: 'live' },
    ],
  },
  {
    slug: 'competitor-intelligence',
    label: 'Competitor Intelligence',
    icon: Binoculars,
    status: 'shell',
    purpose: 'Study major land investors and serious operators to learn what the best are doing.',
    primaryQuestion: 'What are the best operators doing, and what can we learn?',
    records: ['Competitor Profile', 'Investor Watchlist', 'Industry Trend', 'Research Brief', 'Playbook'],
    capabilities: ['Major investor tracking', 'Public content review', 'Strategy & marketing trend tracking', 'Weekly competitor brief'],
    surfaces: [],
  },
  {
    slug: 'strategy-training',
    label: 'Strategy & Training',
    icon: GraduationCap,
    status: 'partial',
    purpose: 'Build and preserve company knowledge. Teach and document strategies, skills, systems, and lessons.',
    records: ['Playbook', 'Training Module', 'Framework', 'Case Study', 'Knowledge Article', 'Lesson Library'],
    capabilities: ['Land strategies (subdivision, land-home, improvement)', 'Sales & negotiation systems', 'SOPs', 'Case studies', 'Lessons learned'],
    surfaces: [
      { label: 'Knowledge Base', href: '/landos?view=knowledge', description: 'Company knowledge, playbooks, and training material.', status: 'live' },
    ],
  },
  {
    slug: 'dispositions',
    label: 'Dispositions',
    icon: Tag,
    status: 'shell',
    purpose: 'Sell company inventory efficiently and profitably.',
    records: ['Property', 'Buyer', 'Listing', 'Disposition Plan', 'Sales Material', 'Buyer Lead'],
    capabilities: ['Pricing', 'Listing strategy', 'Buyer matching', 'Owner financing', 'Disposition planning'],
    surfaces: [],
  },
  {
    slug: 'transaction-coordination',
    label: 'Transaction Coordination',
    icon: FileSignature,
    status: 'shell',
    purpose: 'Move deals from signed agreement through closing.',
    records: ['Transaction', 'Contract', 'Title File', 'Document', 'Deadline', 'Vendor', 'Closing Checklist'],
    capabilities: ['Contracts & title', 'Escrow & survey', 'Deadline tracking', 'Closing checklists', 'Closing-risk review'],
    surfaces: [],
  },
  {
    slug: 'finance',
    label: 'Finance',
    icon: DollarSign,
    status: 'partial',
    purpose: 'Track financial performance and business health.',
    records: ['Budget', 'Expense', 'Revenue', 'Profit Report', 'Cash Flow', 'Deal Economics'],
    capabilities: ['Cash flow', 'Deal economics', 'Marketing ROI', 'Cost per acquisition', 'Profitability', 'KPIs'],
    surfaces: [
      { label: 'Cost Control', href: '/landos?view=costcontrol', description: 'Model and provider spend across the business.', status: 'live' },
    ],
  },
  {
    slug: 'ai-research',
    label: 'AI Research',
    icon: Cpu,
    status: 'partial',
    purpose: 'Continuously improve LandOS through AI, automation, and technology research. Owns and monitors the AI tech stack.',
    records: ['AI Tool Profile', 'Model Profile', 'Tech Stack Record', 'Research Note', 'Automation Proposal', 'Technology Evaluation'],
    capabilities: ['Model comparisons', 'Model router configuration', 'Automation ideas', 'New-release tracking', 'Cost & performance reviews'],
    surfaces: [
      { label: 'Model Router', href: '/landos?view=router', description: 'How work is routed across models, and current router configuration.', status: 'live' },
    ],
    techStack: [
      { name: 'Claude (Opus / Sonnet / Haiku)', kind: 'closed source', role: 'Reasoning, complex analysis, orchestration', status: 'in use' },
      { name: 'Gemini 2.5 Flash', kind: 'closed source', role: 'Vision, fast extraction, classification', status: 'in use' },
      { name: 'Gemma (local)', kind: 'open source', role: 'Task-oriented / cheap routing lanes', status: 'candidate' },
      { name: 'Local open-source LLMs', kind: 'local', role: 'Privacy-sensitive + offline capable work', status: 'under review' },
    ],
  },
  {
    slug: 'operations',
    label: 'Operations',
    icon: Wrench,
    status: 'partial',
    purpose: 'Improve how the company functions: tasks, projects, vendors, internal systems, and processes.',
    records: ['Task', 'Project', 'Vendor', 'SOP', 'Operations Report'],
    capabilities: ['Task & project tracking', 'Vendor management', 'Process reviews', 'Bottleneck detection', 'Agent org health'],
    surfaces: [
      { label: 'Org & Agents', href: '/landos?view=org', description: 'The LandOS agent org chart and department roster.', status: 'live' },
      { label: 'Agents', href: '/agents', description: 'Runtime agents operating the business.', status: 'live' },
      { label: 'Scheduled', href: '/scheduled', description: 'Recurring automated work.', status: 'live' },
    ],
  },
];

export function getDepartment(slug: string): DepartmentDef | undefined {
  return DEPARTMENTS.find((d) => d.slug === slug);
}

export const DEPARTMENT_STATUS_LABEL: Record<DeptStatus, string> = {
  operational: 'Operational',
  partial: 'Live surfaces',
  shell: 'Shell',
};
