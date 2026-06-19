// Deal Card — Due Diligence / Research worksheet.
//
// A safe local landing place for the DD/Research department leg. Every parcel
// fact entered here is MANUAL/LOCAL and carries a confidence label, so research
// data is never shown as a verified fact. Parcel identity defaults to
// local-area-context and is never inferred from coordinates, proximity, map
// pins, geocoders, or nearest parcel.
//
// Hard rules enforced here:
//   - A DD field can only be labeled 'Verified' when the worksheet carries at
//     least one named source link; otherwise the label is downgraded to
//     'Needs verification' with a warning.
//   - parcel_identity_status can only be 'source_verified' with a named source
//     link; otherwise it is downgraded to 'local_area_context_not_verified'.
//   - One worksheet row per Deal Card (upsert; never a duplicate).
//   - No network, no .env, no secrets, no paid/LandPortal calls. File-backed
//     SQLite (store/landos.db, gitignored).

import {
  getLandosDb,
  landosAudit,
  type DdFieldLabel,
  type DdParcelIdentityStatus,
  DD_FIELD_LABELS,
  DD_PARCEL_IDENTITY_STATUSES,
} from './db.js';
import { getDealCardRow } from './deal-card.js';

const FIELD_LABEL_SET = new Set<string>(DD_FIELD_LABELS);
const IDENTITY_SET = new Set<string>(DD_PARCEL_IDENTITY_STATUSES);

/** Validate a confidence label, falling back to a safe default. */
function asLabel(v: unknown, fallback: DdFieldLabel = 'Unknown'): DdFieldLabel {
  return typeof v === 'string' && FIELD_LABEL_SET.has(v) ? (v as DdFieldLabel) : fallback;
}

/** Validate a parcel identity status, falling back to a safe default. */
function asIdentity(
  v: unknown,
  fallback: DdParcelIdentityStatus = 'local_area_context_not_verified',
): DdParcelIdentityStatus {
  return typeof v === 'string' && IDENTITY_SET.has(v) ? (v as DdParcelIdentityStatus) : fallback;
}

/** Parse a JSON string array column into a clean, trimmed, non-empty list. */
function parseStrArray(s: string | null | undefined): string[] {
  try {
    const a = JSON.parse(s ?? '[]');
    if (!Array.isArray(a)) return [];
    return a.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
  } catch {
    return [];
  }
}

export interface DealCardSourceLink {
  label: string;
  url: string;
}

/** Parse the source_links JSON column into {label,url} entries with a url. */
function parseSourceLinks(s: string | null | undefined): DealCardSourceLink[] {
  try {
    const a = JSON.parse(s ?? '[]');
    if (!Array.isArray(a)) return [];
    return a
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).url === 'string')
      .map((x) => ({ label: typeof x.label === 'string' ? x.label.trim() : '', url: String(x.url).trim() }))
      .filter((x) => x.url !== '');
  } catch {
    return [];
  }
}

/** Raw DB row. */
interface DealCardDdRow {
  id: number;
  deal_card_id: number;
  parcel_identity_status: DdParcelIdentityStatus;
  apn: string;
  apn_label: DdFieldLabel;
  county: string;
  state: string;
  location_label: DdFieldLabel;
  acreage: number | null;
  acreage_label: DdFieldLabel;
  zoning: string;
  zoning_label: DdFieldLabel;
  access_status: string;
  access_label: DdFieldLabel;
  utilities_status: string;
  utilities_label: DdFieldLabel;
  flood_status: string;
  flood_label: DdFieldLabel;
  wetlands_status: string;
  wetlands_label: DdFieldLabel;
  road_frontage_notes: string;
  source_links: string;
  data_gaps: string;
  risk_flags: string;
  notes: string;
  updated_by: string;
  created_at: number;
  updated_at: number;
}

/** Normalized worksheet shape returned to the API/UI (lists parsed). When no
 *  worksheet exists yet, exists=false with honest empty defaults. */
export interface DealCardDdView {
  exists: boolean;
  dealCardId: number;
  parcelIdentityStatus: DdParcelIdentityStatus;
  apn: string;
  apnLabel: DdFieldLabel;
  county: string;
  state: string;
  locationLabel: DdFieldLabel;
  acreage: number | null;
  acreageLabel: DdFieldLabel;
  zoning: string;
  zoningLabel: DdFieldLabel;
  accessStatus: string;
  accessLabel: DdFieldLabel;
  utilitiesStatus: string;
  utilitiesLabel: DdFieldLabel;
  floodStatus: string;
  floodLabel: DdFieldLabel;
  wetlandsStatus: string;
  wetlandsLabel: DdFieldLabel;
  roadFrontageNotes: string;
  sourceLinks: DealCardSourceLink[];
  dataGaps: string[];
  riskFlags: string[];
  notes: string;
  updatedBy: string;
  updatedAt: number | null;
}

export interface DealCardDdPatch {
  parcelIdentityStatus?: DdParcelIdentityStatus;
  apn?: string;
  apnLabel?: DdFieldLabel;
  county?: string;
  state?: string;
  locationLabel?: DdFieldLabel;
  acreage?: number | null;
  acreageLabel?: DdFieldLabel;
  zoning?: string;
  zoningLabel?: DdFieldLabel;
  accessStatus?: string;
  accessLabel?: DdFieldLabel;
  utilitiesStatus?: string;
  utilitiesLabel?: DdFieldLabel;
  floodStatus?: string;
  floodLabel?: DdFieldLabel;
  wetlandsStatus?: string;
  wetlandsLabel?: DdFieldLabel;
  roadFrontageNotes?: string;
  sourceLinks?: DealCardSourceLink[];
  dataGaps?: string[];
  riskFlags?: string[];
  notes?: string;
  updatedBy?: string;
}

export interface DealCardDdResult {
  dd: DealCardDdView;
  warnings: string[];
}

function rowToView(row: DealCardDdRow): DealCardDdView {
  return {
    exists: true,
    dealCardId: row.deal_card_id,
    parcelIdentityStatus: row.parcel_identity_status,
    apn: row.apn,
    apnLabel: row.apn_label,
    county: row.county,
    state: row.state,
    locationLabel: row.location_label,
    acreage: row.acreage,
    acreageLabel: row.acreage_label,
    zoning: row.zoning,
    zoningLabel: row.zoning_label,
    accessStatus: row.access_status,
    accessLabel: row.access_label,
    utilitiesStatus: row.utilities_status,
    utilitiesLabel: row.utilities_label,
    floodStatus: row.flood_status,
    floodLabel: row.flood_label,
    wetlandsStatus: row.wetlands_status,
    wetlandsLabel: row.wetlands_label,
    roadFrontageNotes: row.road_frontage_notes,
    sourceLinks: parseSourceLinks(row.source_links),
    dataGaps: parseStrArray(row.data_gaps),
    riskFlags: parseStrArray(row.risk_flags),
    notes: row.notes,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

/** Honest empty worksheet for a Deal Card that has no DD row yet. */
function emptyView(dealCardId: number): DealCardDdView {
  return {
    exists: false,
    dealCardId,
    parcelIdentityStatus: 'local_area_context_not_verified',
    apn: '',
    apnLabel: 'Unknown',
    county: '',
    state: '',
    locationLabel: 'Unknown',
    acreage: null,
    acreageLabel: 'Unknown',
    zoning: '',
    zoningLabel: 'Unknown',
    accessStatus: '',
    accessLabel: 'Unknown',
    utilitiesStatus: '',
    utilitiesLabel: 'Unknown',
    floodStatus: '',
    floodLabel: 'Unknown',
    wetlandsStatus: '',
    wetlandsLabel: 'Unknown',
    roadFrontageNotes: '',
    sourceLinks: [],
    dataGaps: [],
    riskFlags: [],
    notes: '',
    updatedBy: '',
    updatedAt: null,
  };
}

function getDealCardDdRow(dealCardId: number): DealCardDdRow | undefined {
  return getLandosDb()
    .prepare('SELECT * FROM landos_deal_card_dd WHERE deal_card_id = ?')
    .get(dealCardId) as DealCardDdRow | undefined;
}

/** Read the DD worksheet for a Deal Card. Returns an honest empty worksheet
 *  (exists=false) when none has been saved yet. */
export function getDealCardDd(dealCardId: number): DealCardDdView {
  const row = getDealCardDdRow(dealCardId);
  return row ? rowToView(row) : emptyView(dealCardId);
}

/**
 * Create-or-update the DD/Research worksheet for a Deal Card (one row per deal).
 * Applies only the provided patch fields over the existing worksheet (or safe
 * defaults), validates every confidence label, normalizes the JSON lists, and
 * enforces the verification guardrails:
 *   - any field labeled 'Verified' without a named source link is downgraded to
 *     'Needs verification';
 *   - parcel_identity_status 'source_verified' without a named source link is
 *     downgraded to 'local_area_context_not_verified'.
 * Returns the normalized worksheet plus any guardrail warnings. Returns null if
 * the Deal Card does not exist.
 */
export function upsertDealCardDd(
  dealCardId: number,
  patch: DealCardDdPatch,
): DealCardDdResult | null {
  const deal = getDealCardRow(dealCardId);
  if (!deal) return null;

  const db = getLandosDb();
  const existing = getDealCardDdRow(dealCardId);
  const base: DealCardDdView = existing ? rowToView(existing) : emptyView(dealCardId);

  // Merge patch over the existing/default worksheet (only provided keys change).
  const pick = <T>(v: T | undefined, cur: T): T => (v === undefined ? cur : v);

  const merged: DealCardDdView = {
    exists: true,
    dealCardId,
    parcelIdentityStatus: asIdentity(pick(patch.parcelIdentityStatus, base.parcelIdentityStatus), base.parcelIdentityStatus),
    apn: pick(patch.apn, base.apn).trim(),
    apnLabel: asLabel(pick(patch.apnLabel, base.apnLabel)),
    county: pick(patch.county, base.county).trim(),
    state: pick(patch.state, base.state).trim(),
    locationLabel: asLabel(pick(patch.locationLabel, base.locationLabel)),
    acreage: patch.acreage === undefined ? base.acreage : normalizeAcreage(patch.acreage),
    acreageLabel: asLabel(pick(patch.acreageLabel, base.acreageLabel)),
    zoning: pick(patch.zoning, base.zoning).trim(),
    zoningLabel: asLabel(pick(patch.zoningLabel, base.zoningLabel)),
    accessStatus: pick(patch.accessStatus, base.accessStatus).trim(),
    accessLabel: asLabel(pick(patch.accessLabel, base.accessLabel)),
    utilitiesStatus: pick(patch.utilitiesStatus, base.utilitiesStatus).trim(),
    utilitiesLabel: asLabel(pick(patch.utilitiesLabel, base.utilitiesLabel)),
    floodStatus: pick(patch.floodStatus, base.floodStatus).trim(),
    floodLabel: asLabel(pick(patch.floodLabel, base.floodLabel)),
    wetlandsStatus: pick(patch.wetlandsStatus, base.wetlandsStatus).trim(),
    wetlandsLabel: asLabel(pick(patch.wetlandsLabel, base.wetlandsLabel)),
    roadFrontageNotes: pick(patch.roadFrontageNotes, base.roadFrontageNotes).trim(),
    sourceLinks: normalizeSourceLinks(patch.sourceLinks === undefined ? base.sourceLinks : patch.sourceLinks),
    dataGaps: normalizeStrList(patch.dataGaps === undefined ? base.dataGaps : patch.dataGaps),
    riskFlags: normalizeStrList(patch.riskFlags === undefined ? base.riskFlags : patch.riskFlags),
    notes: pick(patch.notes, base.notes).trim(),
    updatedBy: (pick(patch.updatedBy, base.updatedBy) || 'tyler/manual').trim(),
    updatedAt: null,
  };

  // ── Verification guardrails ───────────────────────────────────────────────
  const warnings: string[] = [];
  const hasSource = merged.sourceLinks.length > 0;

  const labeledFields: Array<{ name: string; key: keyof DealCardDdView }> = [
    { name: 'APN', key: 'apnLabel' },
    { name: 'County/State', key: 'locationLabel' },
    { name: 'Acreage', key: 'acreageLabel' },
    { name: 'Zoning', key: 'zoningLabel' },
    { name: 'Access', key: 'accessLabel' },
    { name: 'Utilities', key: 'utilitiesLabel' },
    { name: 'Flood', key: 'floodLabel' },
    { name: 'Wetlands', key: 'wetlandsLabel' },
  ];
  if (!hasSource) {
    for (const f of labeledFields) {
      if (merged[f.key] === 'Verified') {
        (merged[f.key] as DdFieldLabel) = 'Needs verification';
        warnings.push(`${f.name} downgraded from Verified to Needs verification: a Verified DD fact requires at least one named source link.`);
      }
    }
    if (merged.parcelIdentityStatus === 'source_verified') {
      merged.parcelIdentityStatus = 'local_area_context_not_verified';
      warnings.push('Parcel identity downgraded from source_verified to local_area_context_not_verified: source-verified identity requires at least one named source link.');
    }
  }

  // ── Persist (upsert) ──────────────────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  const cols = [
    merged.parcelIdentityStatus,
    merged.apn, merged.apnLabel,
    merged.county, merged.state, merged.locationLabel,
    merged.acreage, merged.acreageLabel,
    merged.zoning, merged.zoningLabel,
    merged.accessStatus, merged.accessLabel,
    merged.utilitiesStatus, merged.utilitiesLabel,
    merged.floodStatus, merged.floodLabel,
    merged.wetlandsStatus, merged.wetlandsLabel,
    merged.roadFrontageNotes,
    JSON.stringify(merged.sourceLinks),
    JSON.stringify(merged.dataGaps),
    JSON.stringify(merged.riskFlags),
    merged.notes,
    merged.updatedBy,
  ];

  if (existing) {
    db.prepare(
      `UPDATE landos_deal_card_dd SET
         parcel_identity_status = ?,
         apn = ?, apn_label = ?,
         county = ?, state = ?, location_label = ?,
         acreage = ?, acreage_label = ?,
         zoning = ?, zoning_label = ?,
         access_status = ?, access_label = ?,
         utilities_status = ?, utilities_label = ?,
         flood_status = ?, flood_label = ?,
         wetlands_status = ?, wetlands_label = ?,
         road_frontage_notes = ?,
         source_links = ?, data_gaps = ?, risk_flags = ?,
         notes = ?, updated_by = ?, updated_at = ?
       WHERE deal_card_id = ?`,
    ).run(...cols, now, dealCardId);
  } else {
    db.prepare(
      `INSERT INTO landos_deal_card_dd
         (deal_card_id, parcel_identity_status, apn, apn_label, county, state, location_label,
          acreage, acreage_label, zoning, zoning_label, access_status, access_label,
          utilities_status, utilities_label, flood_status, flood_label, wetlands_status, wetlands_label,
          road_frontage_notes, source_links, data_gaps, risk_flags, notes, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(dealCardId, ...cols, now);
  }

  landosAudit(merged.updatedBy, existing ? 'deal_card_dd_updated' : 'deal_card_dd_created', `deal ${dealCardId} DD worksheet`, {
    entity: deal.entity, refTable: 'landos_deal_card_dd', refId: dealCardId,
  });

  return { dd: getDealCardDd(dealCardId), warnings };
}

function normalizeAcreage(v: number | null): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

function normalizeStrList(list: string[]): string[] {
  return list.filter((x) => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
}

function normalizeSourceLinks(list: DealCardSourceLink[]): DealCardSourceLink[] {
  return (Array.isArray(list) ? list : [])
    .filter((x) => x && typeof x.url === 'string' && x.url.trim() !== '')
    .map((x) => ({ label: typeof x.label === 'string' ? x.label.trim() : '', url: x.url.trim() }));
}
