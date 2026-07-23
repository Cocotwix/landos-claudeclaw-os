// LandOS Seller Lead / Deal Card + People / Contact model.
//
// Three distinct record types, never conflated:
//   1. Property Card  — a parcel research record (property-card.ts). Can exist
//      standalone with no seller and no deal.
//   2. Deal Card      — a seller opportunity / deal file (this module). Links
//      one OR MORE Property Cards. Holds deal-level facts (seller notes, asking
//      price, package strategy). Never holds parcel identity.
//   3. Person/Contact — people connected to a deal or property (seller, owner,
//      heir, attorney, ...). A role/relationship NEVER implies signing
//      authority.
//
// Hard rules enforced here:
//   - Linking property cards to a deal does NOT merge parcels. Each Property
//     Card keeps its own identity and verification status.
//   - Combined acreage is only "verified" when every linked parcel's identity
//     and acreage is verified; otherwise it is preliminary.
//   - Contiguity is never assumed: seller statements are seller_stated;
//     source_confirmed requires an official GIS/assessor/plat/deed source.
//   - A person's authority defaults to 'unknown' — being an heir/sibling/etc.
//     never makes them can_sign.
//
// No network, no .env, no secrets.

import {
  getLandosDb,
  landosAudit,
  type ContiguityStatus,
  type DealCardStatus,
  type DealPropertyRole,
  type LandosEntity,
  type PersonAuthorityStatus,
  type PersonRole,
  CONTIGUITY_STATUSES,
  DEAL_CARD_STATUSES,
  DEAL_PROPERTY_ROLES,
  PERSON_AUTHORITY_STATUSES,
  PERSON_ROLES,
  isLeadType,
  type LeadType,
} from './db.js';
import { getLandosStorageProfile } from './storage-profile.js';
import {
  getPropertyCardRow,
  upsertCardFromDukeRun,
  attachCardSourceEvidence,
  attachCardActivity,
  addCardNextAction,
  appendCardOpenRisks,
  hasStrongParcelIdentity,
  isProximityVerificationSource,
  type PropertyCardRow,
} from './property-card.js';
import { REPORT_STATUSES, type DukeReportStatus } from './duke-persist.js';
import { buildDukePartialContract, type DukePartialContract } from './duke-partial.js';
import { ownerFacingPersonName } from './lead-card-intake.js';

/** Reverse lookup so a persisted report-status string can be validated on read. */
const REPORT_STATUS_SET = new Set<string>(REPORT_STATUSES as readonly string[]);

// Score / value / offer language that must NEVER appear in an unverified /
// research Deal Card summary. Risks, data gaps, identity status, source links,
// and next actions are stored in their own fields and stay intact.
const VALUE_OFFER_LANGUAGE =
  /\bscore\b|\bvalue[ds]?\b|\bvaluation\b|\bEV\b|\bARV\b|\bMAO\b|\boffer\b|\bworth\b|\bprice\s*per\s*acre\b|\bppa\b|\$\s?\d|\brecommend|\bstrateg|\bcomp[\s-]*supported\b/i;

const UNVERIFIED_SAFE_SUMMARY =
  'Parcel not definitively verified. Research Deal Card created. Confirm APN, county/state/FIPS, or LandPortal property ID before scoring, valuing, or making offer guidance.';

/**
 * Defensive sanitizer for an unverified/research Deal Card summary. If the
 * summary carries any score/value/offer/pricing/strategy language, replace it
 * with a neutral research summary. Neutral text is left as-is. Pure.
 */
export function sanitizeUnverifiedSummary(summary?: string): string {
  const s = (summary ?? '').trim();
  if (!s) return '';
  return VALUE_OFFER_LANGUAGE.test(s) ? UNVERIFIED_SAFE_SUMMARY : s;
}

// Hearsay / relationship / proximity phrases that can NEVER stand in for
// official evidence (used to reject contiguity and authority claims).
const HEARSAY_OR_PROXIMITY =
  /\bseller\b|\bowner\s+says\b|\bsame\s+(owner|road|county)\b|\bnearest\b|\bproximity\b|coordinat|geocod|\bmap\s*pin\b|centroid|road\s*midpoint|\bvisual\b|\bzillow\b|\bredfin\b|\bcountyoffice\b|\bsays\s+(they|i|he|she)\b/i;

// Self-sufficient official parcel-boundary documents/sources. These words are
// inherently official AND contiguity/parcel-boundary specific.
const STRONG_CONTIGUITY_EVIDENCE =
  /\bplat\b|recorded\s+deed|\bdeed\b|legal\s+description|\bsurvey\b|register\s+of\s+deeds|\bassessor\b|\bgis\b/i;
// Parcel-boundary wording that is only acceptable when paired with an official
// signal (so a bare "parcel map" on a random page does not qualify).
const PARCEL_BOUNDARY_WORDING =
  /parcel\s*(map|viewer|boundary|line|layer)|adjoining\s+parcel|county\s+parcel/i;
const OFFICIAL_SIGNAL = /\.gov\b|\bcounty\b|\bcity\b|\btownship\b|\bplanning\b|\brecorder\b|\bregister\b/i;

/**
 * Official parcel-CONTIGUITY evidence only. A generic .gov URL is NOT enough:
 * the source must be parcel-boundary specific — a recorded plat/deed, legal
 * description, official survey, register of deeds, or a county GIS/assessor
 * parcel map/viewer. Seller statements, generic notes, marketplace pages,
 * proximity/visual signals, and unrelated .gov pages never qualify.
 */
export function isOfficialContiguitySource(source: string): boolean {
  const s = (source ?? '').trim();
  if (!s) return false;
  if (HEARSAY_OR_PROXIMITY.test(s)) return false;
  if (STRONG_CONTIGUITY_EVIDENCE.test(s)) return true;
  if (PARCEL_BOUNDARY_WORDING.test(s) && OFFICIAL_SIGNAL.test(s)) return true;
  return false;
}

// Authority-specific evidence. These words speak to ownership / signing
// authority, not merely "a government page".
const AUTHORITY_EVIDENCE =
  /title\s+(company|confirm)|\battorney\b|recorded\s+deed|\bdeed\b|\bprobate\b|court\s+order|letters\s+(testamentary|of\s+administration)|\bexecutor\b|personal\s+representative|\bPR\b|power\s+of\s+attorney|\bPOA\b|signed\s+authorization|official\s+county\s+(ownership\s+)?record|owner(ship)?\s+(record|authority)|owner\s+of\s+record/i;

/**
 * Source-backed SIGNING authority only. A generic .gov URL is NOT enough: the
 * source must be authority-specific — title/attorney confirmation, a recorded
 * deed showing ownership, probate court order / letters / PR / executor
 * documentation, a valid POA / signed authorization, or an official county
 * ownership record. Relationship alone (heir/sibling/spouse) or anyone simply
 * saying they can sign never qualifies.
 */
export function isSourceBackedAuthority(source: string): boolean {
  const s = (source ?? '').trim();
  if (!s) return false;
  if (HEARSAY_OR_PROXIMITY.test(s)) return false;
  // Relationship-only wording never grants authority on its own.
  if (/\b(sibling|heir|spouse|relationship|relative|family)\b/i.test(s) && !AUTHORITY_EVIDENCE.test(s)) {
    return false;
  }
  return AUTHORITY_EVIDENCE.test(s);
}

/**
 * Neutral lead-contact vs record-owner mismatch note. A mismatch is NOT
 * automatically probate/inheritance and is never an auto-rejection: a different
 * lead contact may be a wholesaler, family contact, stale record, or another
 * representative. Only confirm authority before contract/closing.
 */
export const LEAD_OWNER_MISMATCH_NOTE =
  'Lead contact differs from record owner. This could be a wholesaler, family contact, stale record, probate/inheritance situation, or another representative. Confirm relationship and authority before contract/closing.';

export function leadContactMismatchNote(
  leadName?: string,
  recordOwnerName?: string,
): { mismatch: boolean; note: string } {
  const lead = (leadName ?? '').trim().toLowerCase();
  const owner = (recordOwnerName ?? '').trim().toLowerCase();
  const mismatch = lead.length > 0 && owner.length > 0 && lead !== owner;
  return { mismatch, note: mismatch ? LEAD_OWNER_MISMATCH_NOTE : '' };
}

export interface DealCardRow {
  id: number;
  entity: string;
  title: string;
  status: DealCardStatus;
  seller_notes: string;
  asking_price: number | null;
  combined_strategy: string;
  package_notes: string;
  combined_acreage: number | null;
  combined_acreage_verified: number;
  created_at: number;
  updated_at: number;
  /** Soft-delete timestamp (epoch seconds). Non-null = in Trash. */
  deleted_at: number | null;
}

export function getDealCardRow(id: number): DealCardRow | undefined {
  return getLandosDb().prepare('SELECT * FROM landos_deal_card WHERE id = ?').get(id) as DealCardRow | undefined;
}

export function createDealCard(input: {
  entity: LandosEntity;
  title?: string;
  status?: DealCardStatus;
  sellerNotes?: string;
  askingPrice?: number;
  combinedStrategy?: string;
  packageNotes?: string;
  leadType?: LeadType;
}): DealCardRow {
  const db = getLandosDb();
  const status: DealCardStatus =
    input.status && (DEAL_CARD_STATUSES as readonly string[]).includes(input.status) ? input.status : 'new';
  const leadType: LeadType = isLeadType(input.leadType) ? input.leadType : 'actual';
  if (getLandosStorageProfile().syntheticOnly && leadType !== 'test') {
    throw new Error('Isolated QA storage accepts synthetic TEST LEAD records only');
  }
  const id = db.prepare(
    `INSERT INTO landos_deal_card (entity, title, status, seller_notes, asking_price, combined_strategy, package_notes, lead_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.entity,
    input.title ?? '',
    status,
    input.sellerNotes ?? '',
    input.askingPrice ?? null,
    input.combinedStrategy ?? '',
    input.packageNotes ?? '',
    leadType,
  ).lastInsertRowid as number;
  landosAudit('tyler', 'deal_card_created', `deal ${id}`, { entity: input.entity, refTable: 'landos_deal_card', refId: id });
  return getDealCardRow(id)!;
}

export function updateDealCard(
  id: number,
  patch: { title?: string; status?: DealCardStatus; sellerNotes?: string; askingPrice?: number; combinedStrategy?: string; packageNotes?: string },
): DealCardRow | undefined {
  const existing = getDealCardRow(id);
  if (!existing) return undefined;
  const db = getLandosDb();
  const now = Math.floor(Date.now() / 1000);
  const status = patch.status && (DEAL_CARD_STATUSES as readonly string[]).includes(patch.status) ? patch.status : existing.status;
  db.prepare(
    `UPDATE landos_deal_card SET
       title = CASE WHEN ? != '' THEN ? ELSE title END,
       status = ?,
       seller_notes = CASE WHEN ? != '' THEN ? ELSE seller_notes END,
       asking_price = COALESCE(?, asking_price),
       combined_strategy = CASE WHEN ? != '' THEN ? ELSE combined_strategy END,
       package_notes = CASE WHEN ? != '' THEN ? ELSE package_notes END,
       updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.title ?? '', patch.title ?? '',
    status,
    patch.sellerNotes ?? '', patch.sellerNotes ?? '',
    patch.askingPrice ?? null,
    patch.combinedStrategy ?? '', patch.combinedStrategy ?? '',
    patch.packageNotes ?? '', patch.packageNotes ?? '',
    now,
    id,
  );
  return getDealCardRow(id);
}

export function listDealCards(opts: { entity?: string; status?: DealCardStatus; limit?: number; trashed?: boolean } = {}): DealCardRow[] {
  const db = getLandosDb();
  const limit = Math.min(opts.limit ?? 200, 500);
  // Normal boards/lists show ONLY non-deleted cards; `trashed: true` returns ONLY
  // the Trash (soft-deleted) cards, most-recently-deleted first.
  const where: string[] = [opts.trashed ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'];
  const args: unknown[] = [];
  // Synthetic TEST LEAD records belong to the isolated QA profile. If legacy
  // fixtures remain in the operating database, preserve them for migration
  // safety but never present them as operating inventory (including Trash).
  if (!getLandosStorageProfile().syntheticOnly) where.push("lead_type <> 'test'");
  if (opts.entity) { where.push('entity = ?'); args.push(opts.entity); }
  if (opts.status) { where.push('status = ?'); args.push(opts.status); }
  const clause = `WHERE ${where.join(' AND ')} `;
  const order = opts.trashed ? 'deleted_at DESC, id DESC' : 'updated_at DESC, id DESC';
  return db.prepare(`SELECT * FROM landos_deal_card ${clause}ORDER BY ${order} LIMIT ?`)
    .all(...args, limit) as DealCardRow[];
}

/** Trash (soft-deleted) Deal Cards — restorable, hidden from normal lists. */
export function listTrashedDealCards(opts: { entity?: string; limit?: number } = {}): DealCardRow[] {
  return listDealCards({ ...opts, trashed: true });
}

/**
 * SOFT DELETE — move a Deal Card to Trash (sets deleted_at). It disappears from
 * normal boards/lists but is fully restorable. Idempotent; returns the row.
 */
export function softDeleteDealCard(id: number): DealCardRow | undefined {
  const existing = getDealCardRow(id);
  if (!existing) return undefined;
  if (existing.deleted_at == null) {
    const now = Math.floor(Date.now() / 1000);
    getLandosDb().prepare('UPDATE landos_deal_card SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
    landosAudit('tyler', 'deal_card_trashed', `deal ${id}`, { entity: existing.entity, refTable: 'landos_deal_card', refId: id });
  }
  return getDealCardRow(id);
}

/** RESTORE a Deal Card from Trash (clears deleted_at). Idempotent. */
export function restoreDealCard(id: number): DealCardRow | undefined {
  const existing = getDealCardRow(id);
  if (!existing) return undefined;
  if (existing.deleted_at != null) {
    const now = Math.floor(Date.now() / 1000);
    getLandosDb().prepare('UPDATE landos_deal_card SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now, id);
    landosAudit('tyler', 'deal_card_restored', `deal ${id}`, { entity: existing.entity, refTable: 'landos_deal_card', refId: id });
  }
  return getDealCardRow(id);
}

/**
 * PERMANENT (HARD) DELETE — irreversible. Only meaningful from Trash: the card
 * MUST already be soft-deleted (guards against skipping the Trash step). Removes
 * the deal card row plus every deal-scoped row (any landos_* table with a
 * deal_card_id column), in one transaction. Foreign keys aren't enforced, so this
 * also prevents orphan rows. Property Cards themselves are only UNLINKED (they may
 * be shared / independently owned), never deleted. Returns true when removed.
 */
export function hardDeleteDealCard(id: number): boolean {
  const db = getLandosDb();
  const existing = getDealCardRow(id);
  if (!existing) return false;
  if (existing.deleted_at == null) return false; // must be in Trash first (soft delete → then hard delete)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'landos_%'").all() as Array<{ name: string }>;
  const purge = db.transaction(() => {
    for (const { name } of tables) {
      if (name === 'landos_deal_card') continue;
      const cols = db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>;
      if (cols.some((col) => col.name === 'deal_card_id')) {
        db.prepare(`DELETE FROM ${name} WHERE deal_card_id = ?`).run(id);
      }
    }
    db.prepare('DELETE FROM landos_deal_card WHERE id = ?').run(id);
  });
  purge();
  landosAudit('tyler', 'deal_card_permanently_deleted', `deal ${id} (irreversible)`, { entity: existing.entity, refTable: 'landos_deal_card', refId: id });
  return true;
}

/**
 * Link a Property Card under a Deal Card. Does NOT merge parcels. Contiguity is
 * never assumed: 'source_confirmed' requires a contiguitySource; a seller's
 * claim must be stored as 'seller_stated'.
 */
export function linkPropertyToDeal(input: {
  dealCardId: number;
  cardId: number;
  role?: DealPropertyRole;
  contiguityStatus?: ContiguityStatus;
  contiguitySource?: string;
  note?: string;
}): { id?: number; error?: string; warning?: string; contiguityStatus?: ContiguityStatus } {
  const db = getLandosDb();
  const deal = getDealCardRow(input.dealCardId);
  if (!deal) return { error: 'deal card not found' };
  const card = getPropertyCardRow(input.cardId);
  if (!card) return { error: 'property card not found' };

  const role: DealPropertyRole =
    input.role && (DEAL_PROPERTY_ROLES as readonly string[]).includes(input.role) ? input.role : 'subject';
  let contiguity: ContiguityStatus =
    input.contiguityStatus && (CONTIGUITY_STATUSES as readonly string[]).includes(input.contiguityStatus)
      ? input.contiguityStatus
      : 'unknown';

  // source_confirmed contiguity requires OFFICIAL evidence (county GIS/assessor
  // parcel map, recorded plat/deed, legal description, or official survey). A
  // blank, generic, seller-stated, marketplace, or proximity source is
  // downgraded to seller_stated with a warning — it never becomes verified and
  // never merges or alters parcel identity.
  let warning: string | undefined;
  if (contiguity === 'source_confirmed' && !isOfficialContiguitySource(input.contiguitySource ?? '')) {
    contiguity = 'seller_stated';
    warning = 'source_confirmed contiguity downgraded to seller_stated: contiguity requires official evidence (county GIS/assessor parcel map, recorded plat or deed, legal description, or official survey).';
  }

  const existing = db.prepare(
    'SELECT id FROM landos_deal_card_property WHERE deal_card_id = ? AND card_id = ?',
  ).get(input.dealCardId, input.cardId) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      'UPDATE landos_deal_card_property SET role = ?, contiguity_status = ?, contiguity_source = ?, note = ? WHERE id = ?',
    ).run(role, contiguity, input.contiguitySource ?? '', input.note ?? '', existing.id);
    return { id: existing.id, warning, contiguityStatus: contiguity };
  }
  const id = db.prepare(
    `INSERT INTO landos_deal_card_property (deal_card_id, card_id, role, contiguity_status, contiguity_source, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(input.dealCardId, input.cardId, role, contiguity, input.contiguitySource ?? '', input.note ?? '').lastInsertRowid as number;
  landosAudit('tyler', 'deal_property_linked', `deal ${input.dealCardId} <- card ${input.cardId} (${role}, contiguity=${contiguity})`, {
    entity: deal.entity, refTable: 'landos_deal_card_property', refId: id,
  });
  return { id, warning, contiguityStatus: contiguity };
}

export function unlinkPropertyFromDeal(dealCardId: number, cardId: number): boolean {
  const res = getLandosDb().prepare(
    'DELETE FROM landos_deal_card_property WHERE deal_card_id = ? AND card_id = ?',
  ).run(dealCardId, cardId);
  return res.changes > 0;
}

export interface AddPersonInput {
  entity: LandosEntity;
  name: string;
  phone?: string;
  email?: string;
  mailingAddress?: string;
  preferredContactMethod?: string;
  notes?: string;
}

export function addPerson(input: AddPersonInput): number {
  const db = getLandosDb();
  const id = db.prepare(
    `INSERT INTO landos_person (entity, name, phone, email, mailing_address, preferred_contact_method, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.entity,
    input.name,
    input.phone ?? '',
    input.email ?? '',
    input.mailingAddress ?? '',
    input.preferredContactMethod ?? '',
    input.notes ?? '',
  ).lastInsertRowid as number;
  landosAudit('tyler', 'person_created', `person ${id}`, { entity: input.entity, refTable: 'landos_person', refId: id });
  return id;
}

/**
 * Link a person to a deal and/or a property with a role. authority_status
 * defaults to 'unknown' — a relationship role (heir, sibling, spouse, ...)
 * NEVER auto-grants can_sign. Promotion to can_sign requires an explicit,
 * source-backed authority_status passed by the caller.
 */
export function linkPerson(input: {
  personId: number;
  dealCardId?: number;
  cardId?: number;
  role: PersonRole;
  authorityStatus?: PersonAuthorityStatus;
  authoritySource?: string;
  note?: string;
}): { id?: number; error?: string; warning?: string; authorityStatus?: PersonAuthorityStatus } {
  if (input.dealCardId === undefined && input.cardId === undefined) {
    return { error: 'a person link needs a dealCardId and/or a cardId' };
  }
  const role: PersonRole =
    (PERSON_ROLES as readonly string[]).includes(input.role) ? input.role : 'unknown_relation';
  let authority: PersonAuthorityStatus =
    input.authorityStatus && (PERSON_AUTHORITY_STATUSES as readonly string[]).includes(input.authorityStatus)
      ? input.authorityStatus
      : 'unknown';

  // can_sign requires source-backed authority evidence (title/attorney
  // confirmation, recorded deed, probate documentation, valid POA, or official
  // county ownership record). A relationship role or a blank/generic/hearsay
  // source is downgraded to title_to_confirm with a warning — can_sign is never
  // implied and must not drive offer/closing logic without evidence.
  let warning: string | undefined;
  if (authority === 'can_sign' && !isSourceBackedAuthority(input.authoritySource ?? '')) {
    authority = 'title_to_confirm';
    warning = 'can_sign downgraded to title_to_confirm: signing authority requires source-backed evidence (title/attorney confirmation, recorded deed, probate documentation, valid POA, or official county ownership record).';
  }

  const db = getLandosDb();
  const id = db.prepare(
    `INSERT INTO landos_person_link (person_id, deal_card_id, card_id, role, authority_status, authority_source, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.personId,
    input.dealCardId ?? null,
    input.cardId ?? null,
    role,
    authority,
    input.authoritySource ?? '',
    input.note ?? '',
  ).lastInsertRowid as number;
  return { id, warning, authorityStatus: authority };
}

export interface DealCardDetail extends DealCardRow {
  /** Linked property cards (joined; each keeps its own identity/verification). */
  propertyCards: unknown[];
  /** People linked at the deal level. */
  people: unknown[];
  /** Combined acreage rollup with a preliminary/verified label. */
  combinedAcreage: { acres: number; verified: boolean; label: string };
  /** Review-panel rollups (read-only; computed from linked cards). */
  propertyCount: number;
  /** True only when at least one linked parcel is verified_property. */
  hasVerifiedProperty: boolean;
  /** True when any linked parcel is NOT verified_property (show a warning). */
  hasUnverifiedProperty: boolean;
  /** Aggregated open risks across linked properties (deduped). */
  risks: string[];
  /** Open next actions across linked properties. */
  nextActions: Array<Record<string, unknown>>;
  /** Manual/automated comp count for the deal. */
  compCount: number;
  /** Latest Duke writeback activity summary across linked properties. */
  latestWriteback: string | null;
  /** Latest Duke report status (delivered | partial | failed | not_generated),
   *  or null if none recorded. Partial is the default no-comp Duke workflow. */
  latestReportStatus: string | null;
  /** Standardized Duke Partial output contract derived from the fields above. */
  dukePartial: DukePartialContract;
}

/**
 * Full deal card: linked property cards, deal-level people, and a combined
 * acreage rollup. Combined acreage is "verified" only when EVERY linked parcel
 * is verified_property with a known acreage; otherwise it is preliminary.
 */
/** The Deal Card a property card is linked under, if any (oldest link wins). */
export function getDealCardIdForPropertyCard(cardId: number): number | undefined {
  const row = getLandosDb()
    .prepare('SELECT deal_card_id FROM landos_deal_card_property WHERE card_id = ? ORDER BY id ASC LIMIT 1')
    .get(cardId) as { deal_card_id: number } | undefined;
  return row?.deal_card_id;
}

/**
 * Find-or-create the Deal Card for a property card. Used by the comp UI so a
 * comp can be attached from a property view. Creating/linking a Deal Card never
 * changes the property's identity, verification status, or facts.
 */
export function ensureDealCardForProperty(input: {
  cardId: number;
  entity: LandosEntity;
  title?: string;
}): number {
  const existing = getDealCardIdForPropertyCard(input.cardId);
  if (existing) return existing;
  const deal = createDealCard({ entity: input.entity, title: input.title || `Deal ${input.cardId}` });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: input.cardId, role: 'subject' });
  return deal.id;
}

export function getDealCard(id: number): DealCardDetail | undefined {
  const db = getLandosDb();
  const deal = getDealCardRow(id);
  if (!deal) return undefined;
  const links = db.prepare(
    `SELECT dcp.role, dcp.contiguity_status, dcp.contiguity_source, dcp.note AS link_note, pc.*
     FROM landos_deal_card_property dcp
     JOIN landos_property_card pc ON pc.id = dcp.card_id
     WHERE dcp.deal_card_id = ?
     ORDER BY dcp.created_at ASC, dcp.id ASC`,
  ).all(id) as Array<Record<string, unknown>>;
  const rawPeople = db.prepare(
    `SELECT pl.role, pl.authority_status, pl.authority_source, pl.note AS link_note, p.*
     FROM landos_person_link pl
     JOIN landos_person p ON p.id = pl.person_id
     WHERE pl.deal_card_id = ?
     ORDER BY pl.created_at ASC, pl.id ASC`,
  ).all(id) as Array<Record<string, unknown>>;
  const peopleById = new Map<number, Record<string, unknown>>();
  for (const row of rawPeople) {
    const personId = Number(row.id);
    const existing = peopleById.get(personId);
    const roles = existing ? existing.roles as string[] : [];
    const role = String(row.role ?? '');
    if (role && !roles.includes(role)) roles.push(role);
    const preferredRole = roles.find((candidate) => candidate === 'seller')
      ?? roles.find((candidate) => candidate === 'lead_contact')
      ?? roles.find((candidate) => candidate === 'record_owner')
      ?? roles[0]
      ?? role;
    peopleById.set(personId, {
      ...(existing ?? row),
      ...row,
      name: ownerFacingPersonName(String(row.name ?? ''), id),
      role: preferredRole,
      roles,
    });
  }
  const people = [...peopleById.values()];

  let acres = 0;
  let allVerified = links.length > 0;
  for (const l of links) {
    const a = typeof l.acres === 'number' ? l.acres : null;
    const verified = l.verification_status === 'verified_property' && a !== null && a > 0;
    if (!verified) allVerified = false;
    if (a !== null) acres += a;
  }
  const combinedAcreage = {
    acres,
    verified: allVerified,
    label: allVerified
      ? 'Combined acreage verified (every linked parcel verified).'
      : 'Combined acreage PRELIMINARY — not every linked parcel identity/acreage is verified.',
  };

  // Review-panel rollups computed from the linked property cards.
  const cardIds = links.map((l) => l.id as number).filter((n) => typeof n === 'number');
  const risks: string[] = [];
  for (const l of links) {
    try {
      const arr = JSON.parse(String(l.open_risks ?? '[]'));
      if (Array.isArray(arr)) for (const r of arr) if (typeof r === 'string' && r.trim() && !risks.includes(r)) risks.push(r);
    } catch { /* ignore malformed */ }
  }
  let nextActions: Array<Record<string, unknown>> = [];
  let latestWriteback: string | null = null;
  let latestReportStatus: string | null = null;
  let compCount = 0;
  if (cardIds.length) {
    const placeholders = cardIds.map(() => '?').join(',');
    nextActions = db.prepare(
      `SELECT * FROM landos_card_next_action WHERE card_id IN (${placeholders}) AND status = 'open' ORDER BY created_at DESC, id DESC`,
    ).all(...cardIds) as Array<Record<string, unknown>>;
    const wb = db.prepare(
      `SELECT summary, ref FROM landos_card_activity WHERE card_id IN (${placeholders}) AND kind = 'duke_deal_writeback' ORDER BY created_at DESC, id DESC LIMIT 1`,
    ).get(...cardIds) as { summary: string; ref: string } | undefined;
    latestWriteback = wb?.summary ?? null;
    // Only surface a recognized report status; ignore legacy/empty ref values.
    latestReportStatus = wb && REPORT_STATUS_SET.has(wb.ref) ? wb.ref : null;
  }
  compCount = (db.prepare('SELECT COUNT(*) AS n FROM landos_comp WHERE deal_card_id = ?').get(id) as { n: number }).n;

  const hasVerifiedProperty = links.some((l) => l.verification_status === 'verified_property');
  const hasUnverifiedProperty = links.some((l) => l.verification_status !== 'verified_property');

  return {
    ...deal,
    propertyCards: links,
    people,
    combinedAcreage,
    propertyCount: links.length,
    hasVerifiedProperty,
    hasUnverifiedProperty,
    risks,
    nextActions,
    compCount,
    latestWriteback,
    latestReportStatus,
    dukePartial: buildDukePartialContract({
      latestReportStatus,
      hasVerifiedProperty,
      hasUnverifiedProperty,
      risks,
      nextActions,
      latestWriteback,
    }),
  };
}

// ── Live Duke run -> Deal Card writeback bridge ─────────────────────────────

export interface DukeDealWritebackInput {
  entity: LandosEntity;
  agentId?: string;
  /** The active input address (parcel situs or Tyler's raw input). */
  activeInputAddress: string;
  apn?: string;
  lpPropertyId?: string;
  fips?: string;
  lpUrl?: string;
  county?: string;
  state?: string;
  city?: string;
  owner?: string;
  acres?: number;
  verified?: boolean;
  verificationSource?: string;
  summary?: string;
  /** The lead/contact who reached out — separate from the record owner. */
  leadName?: string;
  /** The record owner of the parcel, if known. */
  recordOwnerName?: string;
  /** Risk / anomaly flags surfaced by the run. */
  risks?: string[];
  /** Additional next actions surfaced by the run. */
  nextActions?: string[];
  /** Source evidence links: { fact, url }. Stored on the property card. */
  sourceLinks?: Array<{ fact: string; url: string }>;
  /** Duke report status for this run (default Partial). Display only; persisted
   *  on the writeback activity ref so the dashboard can show it. */
  reportStatus?: DukeReportStatus;
}

export interface DukeDealWritebackResult {
  dealCardId: number;
  cardId: number;
  createdDeal: boolean;
  createdCard: boolean;
  verificationStatus: string;
  warnings: string[];
}

/** Per-parcel writeback fields for a multi-parcel Duke run. Each parcel keeps
 *  its own identity, verification, and evidence — never merged with another. */
export interface DukeParcelWriteback {
  activeInputAddress: string;
  apn?: string;
  lpPropertyId?: string;
  fips?: string;
  lpUrl?: string;
  county?: string;
  state?: string;
  city?: string;
  owner?: string;
  acres?: number;
  verified?: boolean;
  verificationSource?: string;
  summary?: string;
  leadName?: string;
  recordOwnerName?: string;
  risks?: string[];
  nextActions?: string[];
  sourceLinks?: Array<{ fact: string; url: string }>;
  reportStatus?: DukeReportStatus;
}

/** Upsert ONE property card from a parcel writeback, with the defensive
 *  unverified-summary sanitizer. Pure-ish (DB write); never merges APNs. */
function upsertParcelCard(
  p: DukeParcelWriteback,
  ctx: { entity: LandosEntity; agentId?: string },
): { card: PropertyCardRow; created: boolean; warnings: string[]; safeSummary?: string } {
  const address = (p.activeInputAddress ?? '').trim();
  const vsource = (p.verificationSource ?? '').trim();
  const willVerify =
    p.verified === true &&
    hasStrongParcelIdentity({ apn: p.apn, lpPropertyId: p.lpPropertyId, fips: p.fips, county: p.county, state: p.state }) &&
    vsource.length > 0 &&
    !isProximityVerificationSource(vsource);
  const safeSummary = willVerify ? p.summary : sanitizeUnverifiedSummary(p.summary);
  const cardRes = upsertCardFromDukeRun({
    entity: ctx.entity,
    agentId: ctx.agentId,
    activeInputAddress: address || `${p.apn || p.lpPropertyId} (no address)`,
    apn: p.apn,
    lpPropertyId: p.lpPropertyId,
    fips: p.fips,
    lpUrl: p.lpUrl, // only when provided; never fabricated
    county: p.county,
    state: p.state,
    city: p.city,
    owner: p.recordOwnerName ?? p.owner,
    acres: p.acres,
    verified: p.verified,
    verificationSource: p.verificationSource,
    summary: safeSummary,
  });
  return { card: cardRes.card, created: cardRes.created, warnings: cardRes.warnings, safeSummary };
}

/** Link a parcel's card to a deal and attach its evidence, risks, next actions,
 *  neutral lead/owner mismatch action, and the writeback activity entry. */
function attachParcelExtras(
  dealCardId: number,
  card: PropertyCardRow,
  p: DukeParcelWriteback,
  ctx: { entity: LandosEntity; agentId?: string },
  safeSummary?: string,
  opts?: { skipLink?: boolean },
): void {
  // linkPropertyToDeal is idempotent on (deal, card). Skip only when this card
  // is already linked to a DIFFERENT deal (conflict) so we never cross-merge.
  if (!opts?.skipLink) linkPropertyToDeal({ dealCardId, cardId: card.id, role: 'subject' });

  const parcelVerified = card.verification_status === 'verified_property';
  for (const link of p.sourceLinks ?? []) {
    if (link?.url) {
      attachCardSourceEvidence({ cardId: card.id, fact: link.fact || 'source', sourceUrl: link.url, parcelVerified });
    }
  }
  if (p.risks && p.risks.length) appendCardOpenRisks(card.id, p.risks);
  for (const a of p.nextActions ?? []) {
    const v = (a ?? '').trim();
    if (v) addCardNextAction({ cardId: card.id, action: v, createdBy: ctx.agentId ?? 'duke-due-diligence' });
  }
  const mismatch = leadContactMismatchNote(p.leadName, p.recordOwnerName);
  if (mismatch.mismatch) {
    attachCardActivity({
      cardId: card.id,
      agentId: ctx.agentId ?? 'duke-due-diligence',
      kind: 'lead_contact_differs_from_record_owner',
      summary: `Lead contact "${p.leadName}" differs from record owner "${p.recordOwnerName}". ${LEAD_OWNER_MISMATCH_NOTE}`,
    });
    addCardNextAction({
      cardId: card.id,
      action: 'Confirm relationship and authority before contract/closing.',
      createdBy: ctx.agentId ?? 'duke-due-diligence',
    });
  }
  attachCardActivity({
    cardId: card.id,
    agentId: ctx.agentId ?? 'duke-due-diligence',
    kind: 'duke_deal_writeback',
    summary: safeSummary || (parcelVerified ? 'Verified Duke run linked to deal' : 'Research Duke run linked to deal'),
    // Persist the Duke report status (Partial by default) in the existing ref
    // column so the dashboard can surface it. No schema change.
    ref: p.reportStatus ?? '',
  });
}

/**
 * Bridge a completed single-parcel live Duke run into the Deal Card system.
 * Creates/updates the property card (verified vs research per strong identity),
 * reuses an existing Deal Card linked to that card or creates one, and attaches
 * evidence/risks/next-actions/mismatch. Writes no score/value/offer for
 * unverified runs. Never merges APNs.
 */
export function upsertDealCardFromDukeRun(input: DukeDealWritebackInput): DukeDealWritebackResult | null {
  const address = (input.activeInputAddress ?? '').trim();
  const hasIdentity = !!(input.apn || input.lpPropertyId);
  if (!address && !hasIdentity) return null;

  const ctx = { entity: input.entity, agentId: input.agentId };
  const { card, created, warnings, safeSummary } = upsertParcelCard(input, ctx);

  const db = getLandosDb();
  const existingLink = db.prepare(
    'SELECT deal_card_id FROM landos_deal_card_property WHERE card_id = ? ORDER BY id ASC LIMIT 1',
  ).get(card.id) as { deal_card_id: number } | undefined;

  let dealCardId: number;
  let createdDeal = false;
  if (existingLink) {
    dealCardId = existingLink.deal_card_id;
  } else {
    const deal = createDealCard({ entity: input.entity, title: address || input.summary || `Deal ${card.id}` });
    dealCardId = deal.id;
    createdDeal = true;
  }
  attachParcelExtras(dealCardId, card, input, ctx, safeSummary);

  return {
    dealCardId,
    cardId: card.id,
    createdDeal,
    createdCard: created,
    verificationStatus: card.verification_status,
    warnings,
  };
}

export interface MultiParcelDukeWritebackInput {
  entity: LandosEntity;
  agentId?: string;
  parcels: DukeParcelWriteback[];
  /** Shared deal-level context for the run. */
  dealContext?: { title?: string; summary?: string };
}

export interface MultiParcelDukeWritebackResult {
  dealCardId: number;
  createdDeal: boolean;
  /** linkedToThisDeal is false for a conflict parcel that was left linked to a
   *  different Deal Card (not cross-merged); otherActiveDealId names that deal. */
  properties: Array<{ cardId: number; apn: string; verificationStatus: string; created: boolean; linkedToThisDeal: boolean; otherActiveDealId?: number }>;
  warnings: string[];
}

/**
 * Bridge a completed live Duke run that carries MULTIPLE parcels/APNs from one
 * seller/call context into ONE Deal Card with multiple distinct property
 * records. Each parcel keeps its own identity, verification status, evidence,
 * risks, owner, county/state/FIPS, LandPortal id/URL. APNs are NEVER merged and
 * contiguity is NEVER assumed (same owner is not contiguity). Falls back to the
 * single-parcel path for 0/1 parcels.
 */
export function upsertDealCardFromMultiParcelDukeRun(
  input: MultiParcelDukeWritebackInput,
): MultiParcelDukeWritebackResult | null {
  const parcels = (input.parcels ?? []).filter(
    (p) => (p.activeInputAddress ?? '').trim() || p.apn || p.lpPropertyId,
  );
  if (parcels.length === 0) return null;

  const ctx = { entity: input.entity, agentId: input.agentId };
  const warnings: string[] = [];

  // 1. Upsert all parcel/property cards FIRST (distinct cards; APNs never
  //    merged), then snapshot each card's existing Deal Card link.
  const upserted = parcels.map((p) => {
    const r = upsertParcelCard(p, ctx);
    warnings.push(...r.warnings);
    return { p, card: r.card, created: r.created, safeSummary: r.safeSummary, existingDealId: getDealCardIdForPropertyCard(r.card.id) };
  });

  // 2/3/4. Resolve ONE target Deal Card: reuse an existing linked deal when any
  //    upserted property already has one (deterministic: lowest deal id);
  //    otherwise create a new Deal Card. Never merge distinct deals.
  const linkedDealIds = [...new Set(upserted.map((u) => u.existingDealId).filter((x): x is number => typeof x === 'number'))].sort((a, b) => a - b);
  let dealCardId: number;
  let createdDeal = false;
  if (linkedDealIds.length === 0) {
    const firstAddr = (parcels[0].activeInputAddress ?? '').trim();
    const deal = createDealCard({
      entity: input.entity,
      title: input.dealContext?.title || firstAddr || `Multi-parcel deal (${parcels.length})`,
    });
    dealCardId = deal.id;
    createdDeal = true;
  } else {
    dealCardId = linkedDealIds[0];
  }
  const conflictDealIds = linkedDealIds.filter((id) => id !== dealCardId);
  if (conflictDealIds.length > 0) {
    warnings.push(
      `Conflicting Deal Card links across these parcels (Deal Cards ${conflictDealIds.join(', ')}). Reused Deal Card ${dealCardId}; conflicting parcels were NOT relinked or merged.`,
    );
  }

  // 5/6. Attach each parcel to the resolved deal. A card already linked to a
  //    DIFFERENT deal keeps its evidence/risks/actions but is NOT relinked
  //    (no cross-merge); it gets a conflict next-action instead. linkPropertyToDeal
  //    is idempotent so reruns never duplicate (deal, card) links.
  const properties: MultiParcelDukeWritebackResult['properties'] = [];
  for (const u of upserted) {
    const conflict = typeof u.existingDealId === 'number' && u.existingDealId !== dealCardId;
    attachParcelExtras(dealCardId, u.card, u.p, ctx, u.safeSummary, { skipLink: conflict });
    if (conflict) {
      addCardNextAction({
        cardId: u.card.id,
        action: `Resolve conflicting Deal Card linkage: this parcel is linked to Deal Card ${u.existingDealId}, not ${dealCardId}. Confirm the correct Deal Card before merging.`,
        createdBy: input.agentId ?? 'duke-due-diligence',
      });
    }
    properties.push({
      cardId: u.card.id,
      apn: u.card.apn,
      verificationStatus: u.card.verification_status,
      created: u.created,
      linkedToThisDeal: !conflict,
      otherActiveDealId: conflict ? (u.existingDealId as number) : undefined,
    });
  }

  // 7. Update the reused/created Deal Card's package notes (never a new card).
  //    Be precise: count only the parcels ACTUALLY attached to this Deal Card,
  //    and separately note any conflict parcels left linked elsewhere.
  const attached = properties.filter((x) => x.linkedToThisDeal);
  const conflicts = properties.filter((x) => !x.linkedToThisDeal);
  const attachedApns = attached.map((x) => x.apn).filter(Boolean);
  const verifiedAttached = attached.filter((x) => x.verificationStatus === 'verified_property').length;
  const conflictApns = conflicts.map((x) => x.apn).filter(Boolean);
  const packageNotes =
    `${attached.length} propert${attached.length === 1 ? 'y' : 'ies'}/APN${attached.length === 1 ? '' : 's'} attached to this Deal Card` +
    (attachedApns.length ? ` (APNs: ${attachedApns.join(', ')})` : '') +
    `. Verified: ${verifiedAttached}/${attached.length}. APNs are kept as distinct property records; contiguity is not assumed.` +
    (conflicts.length
      ? ` ${conflicts.length} propert${conflicts.length === 1 ? 'y' : 'ies'} seen in this run ` +
        `${conflicts.length === 1 ? 'was' : 'were'} left linked to another Deal Card` +
        (conflictApns.length ? ` (APNs: ${conflictApns.join(', ')}` : ' (') +
        `; Deal Cards: ${conflictDealIds.join(', ')}) and ${conflicts.length === 1 ? 'was' : 'were'} NOT merged.`
      : '') +
    (input.dealContext?.summary ? ` ${sanitizeUnverifiedSummary(input.dealContext.summary)}` : '');
  updateDealCard(dealCardId, { packageNotes });

  return { dealCardId, createdDeal, properties, warnings };
}
