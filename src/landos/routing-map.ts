// LandOS kanban_status -> role-lane routing map.
//
// Display/config only. Maps the EXISTING kanban_status values (defined in
// db.ts) to role lanes so the dashboard can show who owns each stage and which
// lanes support it. This file renames nothing, persists nothing, and adds no
// schema. Unknown/legacy statuses resolve to a safe default.
//
// Role lanes are display labels for ownership; they mirror the department lanes
// in departments.ts conceptually but stay deliberately short for badges.

import { type KanbanStatus } from './db.js';

export const ROLE_LANES = [
  'Command Center',
  'Acquisitions',
  'Due Diligence',
  'Valuation / Comps',
  'Market Intelligence',
  'Marketing / Lead Gen',
  'CRM / GHL Success',
  'Transaction Coordination',
  'Finance / Risk',
  'Dispositions',
  'Operations / Systems / Forge',
] as const;
export type RoleLane = (typeof ROLE_LANES)[number];

export interface StageRouting {
  /** Role lane that owns this stage. */
  primary: RoleLane;
  /** Lanes that support/contribute at this stage. */
  supporting: RoleLane[];
  /** Short human label for the stage. */
  label: string;
  /** True when the stage is a hard gate / blocker-heavy step. */
  blockerEmphasis?: boolean;
}

// Typed as Record<KanbanStatus, ...> so the compiler guarantees every existing
// kanban_status is covered. Parcel Verification is owned by Due Diligence and
// flagged as a gate. Underwriting (value) is owned by Valuation / Comps.
// Strategy/offer-ready is owned by Command Center (it owns Strategy synthesis
// until a dedicated strategy lane is justified). Contract/closing is owned by
// Transaction Coordination. CRM / GHL Success appears only as a supporting
// feeder lane, never as a deal-stage owner. Operations / Systems / Forge is not
// a default deal owner.
export const KANBAN_ROUTING: Record<KanbanStatus, StageRouting> = {
  new_lead:                  { primary: 'Marketing / Lead Gen',     supporting: ['CRM / GHL Success', 'Acquisitions'],                          label: 'New Lead' },
  needs_parcel_verification: { primary: 'Due Diligence',            supporting: [],                                                             label: 'Parcel Verification', blockerEmphasis: true },
  needs_seller_discovery:    { primary: 'Acquisitions',             supporting: ['Due Diligence'],                                              label: 'Seller Discovery' },
  researching:               { primary: 'Due Diligence',            supporting: ['Valuation / Comps', 'Market Intelligence'],                   label: 'Researching' },
  underwriting:              { primary: 'Valuation / Comps',        supporting: ['Due Diligence', 'Finance / Risk'],                            label: 'Underwriting' },
  offer_ready:               { primary: 'Command Center',           supporting: ['Acquisitions', 'Finance / Risk'],                             label: 'Strategy / Offer Ready' },
  offer_sent:                { primary: 'Acquisitions',             supporting: ['Command Center'],                                             label: 'Offer Sent' },
  follow_up:                 { primary: 'Acquisitions',             supporting: ['CRM / GHL Success'],                                          label: 'Follow Up' },
  under_contract:            { primary: 'Transaction Coordination', supporting: ['Finance / Risk', 'Due Diligence'],                            label: 'Under Contract' },
  due_diligence:             { primary: 'Due Diligence',            supporting: ['Transaction Coordination'],                                   label: 'Due Diligence (Contract Period)' },
  disposition:               { primary: 'Dispositions',             supporting: ['Valuation / Comps', 'Market Intelligence', 'Marketing / Lead Gen'], label: 'Disposition' },
  closed:                    { primary: 'Transaction Coordination', supporting: ['Finance / Risk', 'Command Center'],                           label: 'Closed' },
  dead:                      { primary: 'Command Center',           supporting: [],                                                             label: 'Dead' },
  archived:                  { primary: 'Command Center',           supporting: [],                                                             label: 'Archived' },
};

const DEFAULT_ROUTING: StageRouting = {
  primary: 'Command Center',
  supporting: [],
  label: 'Unrouted',
};

/** Safe lookup that never throws for unknown/legacy statuses. */
export function routingForStatus(status: string): StageRouting {
  return (KANBAN_ROUTING as Record<string, StageRouting>)[status] ?? DEFAULT_ROUTING;
}

/** Primary owner role lane for a status (safe for unknown statuses). */
export function ownerForStatus(status: string): RoleLane {
  return routingForStatus(status).primary;
}
