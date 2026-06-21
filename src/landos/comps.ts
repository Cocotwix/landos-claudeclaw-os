// LandOS comps: manual comp storage, comp-source ordering, recency/staleness,
// and the paid-comp-tool guardrail.
//
// Comp source order (for future comp workflows):
//   1. LandPortal comp report — only when available, live-approved, and fresh.
//   2. Zillow sold land comps — preferred public fallback.
//   3. Redfin sold land comps — second public fallback.
//   4. Land.com / LandWatch / LandsOfAmerica — larger acreage / rural / niche,
//      or when Zillow/Redfin are thin.
// GIS/county is NEVER the first-pass comp engine (verification/legal only).
//
// Hard rules enforced here:
//   - Manual comps never verify parcel identity, never merge APNs, never
//     override source-confirmed parcel facts. Source label + confidence stay
//     visible.
//   - Paid LandPortal comp tools (lp_comp_report_create / lp_comp_report_get)
//     may ONLY run inside a live LandOS property workflow. This module exposes
//     the guardrail; it never calls those tools and never spends a credit.

import {
  getLandosDb,
  landosAudit,
  type CompPriceKind,
  type CompSourceLabel,
  type CompStatus,
  type LandosEntity,
  COMP_PRICE_KINDS,
  COMP_SOURCE_LABELS,
  COMP_STATUSES,
} from './db.js';

// ── Paid comp-tool guardrail ───────────────────────────────────────────────

// The ONLY context in which a paid LandPortal comp report may run.
export type CompWorkflowMode =
  | 'live_property_workflow'
  | 'build'
  | 'test'
  | 'mock'
  | 'smoke'
  | 'seed'
  | 'debug'
  | 'unknown';

export const PAID_COMP_TOOLS = ['lp_comp_report_create', 'lp_comp_report_get'] as const;

export function isPaidCompAllowed(mode: CompWorkflowMode): boolean {
  return mode === 'live_property_workflow';
}

/**
 * Guard a paid comp tool call. Throws unless the caller is a live LandOS
 * property workflow. Build/test/mock/smoke/seed/debug runs can never spend a
 * LandPortal comp credit. This bridge build never calls this with a live mode.
 */
export function assertPaidCompAllowed(mode: CompWorkflowMode, tool?: string): void {
  if (!isPaidCompAllowed(mode)) {
    throw new Error(
      `paid comp tool${tool ? ` "${tool}"` : ''} blocked: comp credits may only be spent inside a live LandOS property workflow (mode was "${mode}")`,
    );
  }
}

// ── Comp source ordering ────────────────────────────────────────────────────

export interface CompSourceRecommendation {
  order: CompSourceLabel[];
  notes: string[];
}

const LARGE_ACRE_THRESHOLD = 50;

/**
 * Recommend the comp-source order for a parcel. LandPortal only leads when
 * available AND fresh; otherwise public marketplaces lead with Zillow before
 * Redfin. Parcels over ~50 acres (or niche/rural) also suggest land
 * marketplaces. Deterministic; pure.
 */
export function recommendCompSources(input: {
  acres?: number | null;
  lpAvailable?: boolean;
  lpStale?: boolean;
  niche?: boolean;
}): CompSourceRecommendation {
  const notes: string[] = [];
  const order: CompSourceLabel[] = [];
  const large = (typeof input.acres === 'number' && input.acres > LARGE_ACRE_THRESHOLD) || !!input.niche;

  if (input.lpAvailable && !input.lpStale) {
    order.push('LandPortal');
  } else if (input.lpAvailable && input.lpStale) {
    notes.push('LandPortal comps are stale; lead with public marketplace comps and keep LandPortal as reference only.');
  }

  // Public fallback: Zillow always before Redfin.
  order.push('Zillow', 'Redfin');

  if (large) {
    order.push('Land.com', 'LandWatch', 'LandsOfAmerica');
    notes.push('Parcel is large or niche/rural: supplement Zillow/Redfin with land marketplaces (Land.com, LandWatch, LandsOfAmerica).');
  } else {
    notes.push('Parcel is 50 acres or below: Zillow then Redfin are acceptable first-pass land comp sources.');
  }

  return { order, notes };
}

// ── Comp recency / staleness ────────────────────────────────────────────────

function monthsBetween(olderISO: string, newerISO: string): number | null {
  const older = Date.parse(olderISO);
  const newer = Date.parse(newerISO);
  if (Number.isNaN(older) || Number.isNaN(newer)) return null;
  return (newer - older) / (1000 * 60 * 60 * 24 * 30.4375);
}

export interface CompRecencyResult {
  stale: boolean;
  note: string;
  supplement: CompSourceLabel[];
}

/**
 * Flag LandPortal comps as stale when the newest comp is older than 12 months
 * from the run date, and require Zillow-then-Redfin last-12-month
 * supplementation. Pure.
 */
export function evaluateCompRecency(newestCompDateISO: string | null | undefined, runDateISO: string): CompRecencyResult {
  if (!newestCompDateISO) {
    return {
      stale: true,
      note: 'No comp date available: treat LandPortal comps as unconfirmed and supplement with Zillow first and Redfin second for last-12-month sold comps.',
      supplement: ['Zillow', 'Redfin'],
    };
  }
  const months = monthsBetween(newestCompDateISO, runDateISO);
  const stale = months === null ? true : months > 12;
  if (!stale) return { stale: false, note: '', supplement: [] };
  return {
    stale: true,
    note: 'LandPortal comps are stale: newest returned comp is outside the last 12 months from today’s run date. Supplement with Zillow first and Redfin second for last-12-month sold comps.',
    supplement: ['Zillow', 'Redfin'],
  };
}

// ── Manual / automated comp storage ─────────────────────────────────────────

export interface CompRow {
  id: number;
  entity: string;
  deal_card_id: number;
  card_id: number | null;
  source_label: string;
  source_url: string;
  address_desc: string;
  apn: string;
  county: string;
  state: string;
  price: number | null;
  price_kind: string;
  sale_or_list_date: string;
  acres: number | null;
  price_per_acre: number | null;
  notes: string;
  added_by: string;
  status: string;
  created_at: number;
}

export interface AddCompInput {
  entity: LandosEntity;
  dealCardId: number;
  cardId?: number;
  sourceLabel?: CompSourceLabel;
  sourceUrl?: string;
  addressDesc?: string;
  apn?: string;
  county?: string;
  state?: string;
  price?: number;
  priceKind?: CompPriceKind;
  saleOrListDate?: string;
  acres?: number;
  pricePerAcre?: number;
  notes?: string;
  addedBy?: string;
  status?: CompStatus;
}

export function getComp(id: number): CompRow | undefined {
  return getLandosDb().prepare('SELECT * FROM landos_comp WHERE id = ?').get(id) as CompRow | undefined;
}

/**
 * Add a comp to a Deal Card (and optionally a specific property card). A comp
 * never verifies the subject parcel and defaults to manual_unverified. Computes
 * price-per-acre when price and acres are known and ppa was not supplied.
 */
export function addComp(input: AddCompInput): CompRow {
  const db = getLandosDb();
  const sourceLabel: CompSourceLabel =
    input.sourceLabel && (COMP_SOURCE_LABELS as readonly string[]).includes(input.sourceLabel) ? input.sourceLabel : 'Other';
  const priceKind: CompPriceKind =
    input.priceKind && (COMP_PRICE_KINDS as readonly string[]).includes(input.priceKind) ? input.priceKind : 'unknown';
  const status: CompStatus =
    input.status && (COMP_STATUSES as readonly string[]).includes(input.status) ? input.status : 'manual_unverified';
  let ppa = input.pricePerAcre ?? null;
  if (ppa === null && typeof input.price === 'number' && typeof input.acres === 'number' && input.acres > 0) {
    ppa = Math.round((input.price / input.acres) * 100) / 100;
  }
  const id = db.prepare(
    `INSERT INTO landos_comp
       (entity, deal_card_id, card_id, source_label, source_url, address_desc, apn, county, state,
        price, price_kind, sale_or_list_date, acres, price_per_acre, notes, added_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.entity,
    input.dealCardId,
    input.cardId ?? null,
    sourceLabel,
    input.sourceUrl ?? '',
    input.addressDesc ?? '',
    input.apn ?? '',
    input.county ?? '',
    input.state ?? '',
    input.price ?? null,
    priceKind,
    input.saleOrListDate ?? '',
    input.acres ?? null,
    ppa,
    input.notes ?? '',
    input.addedBy ?? 'tyler/manual',
    status,
  ).lastInsertRowid as number;
  landosAudit(input.addedBy ?? 'tyler/manual', 'comp_added', `deal ${input.dealCardId} comp ${id} (${sourceLabel}, ${status})`, {
    entity: input.entity, refTable: 'landos_comp', refId: id,
  });
  return getComp(id)!;
}

/**
 * Delete a single comp by id. Used by the Deal Card delete-comp-and-rerun flow:
 * removal is explicit and audited; there is NO backfill and NO re-search. Returns
 * true when a row was removed. Logs the override to the audit trail.
 */
export function deleteComp(id: number, opts: { actor?: string; reason?: string } = {}): boolean {
  const db = getLandosDb();
  const existing = getComp(id);
  if (!existing) return false;
  const res = db.prepare('DELETE FROM landos_comp WHERE id = ?').run(id);
  const removed = (res.changes ?? 0) > 0;
  if (removed) {
    landosAudit(
      opts.actor ?? 'tyler/manual',
      'comp_deleted',
      `deal ${existing.deal_card_id} comp ${id} removed (${existing.source_label})${opts.reason ? `: ${opts.reason}` : ''}; offer recomputed off survivors (no backfill, no re-search)`,
      { entity: existing.entity as LandosEntity, refTable: 'landos_comp', refId: id },
    );
  }
  return removed;
}

export function listComps(opts: { dealCardId?: number; cardId?: number; limit?: number } = {}): CompRow[] {
  const db = getLandosDb();
  const limit = Math.min(opts.limit ?? 200, 500);
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.dealCardId !== undefined) { where.push('deal_card_id = ?'); args.push(opts.dealCardId); }
  if (opts.cardId !== undefined) { where.push('card_id = ?'); args.push(opts.cardId); }
  const clause = where.length ? `WHERE ${where.join(' AND ')} ` : '';
  return db.prepare(`SELECT * FROM landos_comp ${clause}ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...args, limit) as CompRow[];
}
