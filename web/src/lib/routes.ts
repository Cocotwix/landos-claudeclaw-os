import {
  LayoutGrid, ListTodo, Users, MessageSquare,
  Brain, Network, Activity, ShieldCheck,
  Swords, Landmark, Hammer,
  Settings,
} from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { DEPARTMENTS } from './departments';

// Sections reflect the LandOS Vision & Architecture: the executive layer
// (Company), the eleven business departments, and the underlying system
// surfaces. See docs/LANDOS_VISION_AND_ARCHITECTURE.md.
export type RouteSection = 'company' | 'departments' | 'system';

export interface RouteDef {
  path: string;
  label: string;
  section: RouteSection;
  icon: typeof LayoutGrid;
  shortcut?: string;
}

// Executive layer — Max / Command. Mission Control is the executive
// dashboard ("what do I need to know first?"); Max is the natural
// conversation + coordination layer (the Chat surface).
const COMPANY_ROUTES: RouteDef[] = [
  { path: '/mission', label: 'Mission Control', section: 'company', icon: LayoutGrid,    shortcut: 'g m' },
  { path: '/chat',    label: 'Max',             section: 'company', icon: MessageSquare, shortcut: 'g c' },
];

// The eleven business departments, derived from the single department model
// so the sidebar, command palette, and router never drift from the Vision.
const DEPARTMENT_ROUTES: RouteDef[] = DEPARTMENTS.map((d) => ({
  path: `/dept/${d.slug}`,
  label: d.label,
  section: 'departments' as const,
  icon: d.icon,
}));

// System surfaces — the operating machinery beneath the business. The LandOS
// Spine (records/approvals overview), the builder, agents, and diagnostics.
// Kept visually separate from the business so normal operation reads as a
// company, not a tool grid.
const SYSTEM_ROUTES: RouteDef[] = [
  { path: '/landos',    label: 'LandOS Spine', section: 'system', icon: Landmark,     shortcut: 'g l' },
  { path: '/forge',     label: 'Forge',        section: 'system', icon: Hammer,       shortcut: 'g f' },
  { path: '/agents',    label: 'Agents',       section: 'system', icon: Users,        shortcut: 'g a' },
  { path: '/scheduled', label: 'Scheduled',    section: 'system', icon: ListTodo,     shortcut: 'g s' },
  { path: '/warroom',   label: 'War Room',     section: 'system', icon: Swords,       shortcut: 'g w' },
  { path: '/memories',  label: 'Memories',     section: 'system', icon: Brain,        shortcut: 'g e' },
  { path: '/hive',      label: 'Hive Mind',    section: 'system', icon: Network,      shortcut: 'g h' },
  { path: '/usage',     label: 'Usage',        section: 'system', icon: Activity,     shortcut: 'g u' },
  { path: '/audit',     label: 'Audit',        section: 'system', icon: ShieldCheck               },
  { path: '/settings',  label: 'Settings',     section: 'system', icon: Settings                  },
];

// Single source of truth for the sidebar, command palette, and router.
export const ROUTES: RouteDef[] = [
  ...COMPANY_ROUTES,
  ...DEPARTMENT_ROUTES,
  ...SYSTEM_ROUTES,
];

export const SECTION_LABEL: Record<RouteSection, string> = {
  company:     'Company',
  departments: 'Departments',
  system:      'System',
};

export const DEFAULT_ROUTE = '/mission';

// Lightly typed children helper for placeholder pages.
export type PageProps = { children?: ComponentChildren };
