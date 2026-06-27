// LandOS — County Records Browser Agent: post-discovery verification task model.
//
// This is the FOUNDATION (contracts + planning + guardrails) for the official-
// record verification specialist. It is NOT part of the automatic pre-discovery
// workflow — it runs only when manually triggered from a Deal Card after Tyler
// decides a lead is worth deeper DD. This module performs NO browsing; it plans
// targeted, bounded tasks and models their results. Actual execution is dormant
// (see browser-agents.ts placeholder) until the visual stack is wired + approved.
// Manual outcome records (Tyler recording a county call result / conflict) are
// persisted on the deal's subject property card via landos_card_activity (no
// schema migration).

import { getLandosDb } from './db.js';
import { attachCardActivity } from './property-card.js';

const ACTIVITY_KIND = 'county_verification';

export const COUNTY_VERIFICATION_TASKS = [
  'verify_owner',
  'verify_apn',
  'verify_legal_description',
  'verify_county_acreage',
  'verify_tax_status',
  'verify_zoning',
  'verify_road_access_frontage',
  'verify_gis_parcel_map',
  'verify_assessor_facts',
  'collect_evidence',
] as const;
export type CountyVerificationTask = (typeof COUNTY_VERIFICATION_TASKS)[number];

/** The DD field a task updates (for checklist/Deal Card integration). */
const TASK_FIELD: Record<CountyVerificationTask, string> = {
  verify_owner: 'owner',
  verify_apn: 'apn',
  verify_legal_description: 'legalDescription',
  verify_county_acreage: 'acres',
  verify_tax_status: 'taxStatus',
  verify_zoning: 'zoning',
  verify_road_access_frontage: 'roadAccessFrontage',
  verify_gis_parcel_map: 'gisParcelMap',
  verify_assessor_facts: 'assessorFacts',
  collect_evidence: 'evidence',
};

/** Bounded execution contract — no free-roaming, hard limits, clear stops. */
export interface CountyTaskContract {
  maxInteractions: number;
  maxDurationMs: number;
  stopConditions: string[];
  preferOfficialAssessorOverGis: true;
}

export const DEFAULT_COUNTY_TASK_CONTRACT: CountyTaskContract = {
  maxInteractions: 6,
  maxDurationMs: 60_000,
  stopConditions: [
    'login_or_account_required',
    'ambiguous_or_multiple_parcels',
    'no_exact_search_supported',
    'manual_map_or_layer_hunting',
    'coordinate_or_proximity_only',
    'interaction_or_time_limit_reached',
  ],
  preferOfficialAssessorOverGis: true,
};

/** Exact identifiers a county task may search by. NO coordinate/nearest/geocoder
 *  field exists — subject identity must come from official identifiers. */
export interface CountyTaskIdentifiers {
  apn?: string;
  ownerName?: string;
  legalDescription?: string;
  county?: string;
  state?: string;
  fullAddress?: string;
}

export interface CountyTaskPlan {
  task: CountyVerificationTask;
  fieldUpdated: string;
  /** True only when sufficient EXACT identifiers exist to run a targeted search. */
  allowed: boolean;
  reason: string;
  contract: CountyTaskContract;
  searchIdentifiers: CountyTaskIdentifiers;
}

/** Subject-identity rule: an exact search needs APN (+county/state), owner+county/
 *  state, legal description (+county/state), or a full address (+county/state).
 *  Coordinates / nearest parcel / geocoder-only can never authorize a verify. */
function hasExactIdentifier(ids: CountyTaskIdentifiers): boolean {
  const hasArea = !!(ids.county || ids.state);
  const hasId = !!(ids.apn || ids.ownerName || ids.legalDescription || ids.fullAddress);
  return hasArea && hasId;
}

/**
 * Plan a single county verification task. Pure: returns a bounded, targeted plan
 * or an explicit not-allowed reason. Never authorizes a search from coordinates/
 * proximity alone. No browsing happens here.
 */
export function planCountyVerification(task: CountyVerificationTask, ids: CountyTaskIdentifiers): CountyTaskPlan {
  const allowed = hasExactIdentifier(ids);
  return {
    task,
    fieldUpdated: TASK_FIELD[task],
    allowed,
    reason: allowed
      ? `Targeted ${task.replace(/_/g, ' ')} via official county records using exact identifiers. Bounded; assessor/property-record preferred over interactive GIS.`
      : 'Not allowed: an exact identifier (APN, owner, legal description, or full address) plus county/state is required. Coordinates, nearest parcel, or geocoder results can never verify subject identity.',
    contract: DEFAULT_COUNTY_TASK_CONTRACT,
    searchIdentifiers: ids,
  };
}

export type CountyTaskStatus = 'verified' | 'conflict' | 'needs_human_or_county_call' | 'not_found' | 'planned';

/** The result a county task produces once executed (modeled now; executed later). */
export interface CountyTaskResult {
  task: CountyVerificationTask;
  fieldUpdated: string;
  status: CountyTaskStatus;
  officialSourceUrl: string | null;
  sourceTitle: string | null;
  extractedFact: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  timestamp: string;
  /** Set when the official record conflicts with an existing Deal Card value. */
  conflictWith: string | null;
  /** Evidence references (screenshot paths/URLs) when captured. Never secrets. */
  evidenceRefs: string[];
  note: string;
}

/** Conflict detection: official value vs an existing (e.g. seller-stated) value.
 *  Pure string compare (trim/case-insensitive); numeric-aware when both parse. */
export function detectConflict(existing: string | number | null | undefined, official: string | number | null | undefined): { conflict: boolean; note: string } {
  if (existing === null || existing === undefined || existing === '' || official === null || official === undefined || official === '') {
    return { conflict: false, note: 'No comparison possible (one side missing).' };
  }
  const en = Number(existing); const on = Number(official);
  if (Number.isFinite(en) && Number.isFinite(on)) {
    const conflict = Math.abs(en - on) > 1e-9;
    return { conflict, note: conflict ? `Numeric conflict: existing ${existing} vs official ${official}.` : 'Values agree.' };
  }
  const conflict = String(existing).trim().toLowerCase() !== String(official).trim().toLowerCase();
  return { conflict, note: conflict ? `Conflict: existing "${existing}" vs official "${official}".` : 'Values agree.' };
}

// ── Manual county verification records (subject card; agent stays dormant) ────

/** Record a county verification outcome on the deal's subject property card
 *  (manual entry while the browser agent is dormant, or a future agent result). */
export function saveCountyVerificationRecord(cardId: number, result: CountyTaskResult, opts: { by?: string } = {}): void {
  attachCardActivity({ cardId, agentId: opts.by ?? 'tyler', kind: ACTIVITY_KIND, summary: `County ${result.task} (${result.status})`, ref: JSON.stringify(result) });
}

/** Load county verification records for a subject card (newest first). */
export function loadCountyVerificationRecords(cardId: number): CountyTaskResult[] {
  const rows = getLandosDb().prepare(`SELECT ref FROM landos_card_activity WHERE card_id = ? AND kind = ? ORDER BY created_at DESC, id DESC`)
    .all(cardId, ACTIVITY_KIND) as Array<{ ref: string }>;
  const out: CountyTaskResult[] = [];
  for (const r of rows) {
    try { out.push(JSON.parse(r.ref) as CountyTaskResult); } catch { /* skip */ }
  }
  return out;
}
