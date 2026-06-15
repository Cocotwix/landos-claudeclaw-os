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
} from './db.js';
import { getPropertyCardRow } from './property-card.js';

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
}): DealCardRow {
  const db = getLandosDb();
  const status: DealCardStatus =
    input.status && (DEAL_CARD_STATUSES as readonly string[]).includes(input.status) ? input.status : 'new';
  const id = db.prepare(
    `INSERT INTO landos_deal_card (entity, title, status, seller_notes, asking_price, combined_strategy, package_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.entity,
    input.title ?? '',
    status,
    input.sellerNotes ?? '',
    input.askingPrice ?? null,
    input.combinedStrategy ?? '',
    input.packageNotes ?? '',
  ).lastInsertRowid as number;
  landosAudit('tyler', 'deal_card_created', `deal ${id}`, { entity: input.entity, refTable: 'landos_deal_card', refId: id });
  return getDealCardRow(id)!;
}

export function listDealCards(opts: { entity?: string; status?: DealCardStatus; limit?: number } = {}): DealCardRow[] {
  const db = getLandosDb();
  const limit = Math.min(opts.limit ?? 200, 500);
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.entity) { where.push('entity = ?'); args.push(opts.entity); }
  if (opts.status) { where.push('status = ?'); args.push(opts.status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')} ` : '';
  return db.prepare(`SELECT * FROM landos_deal_card ${clause}ORDER BY updated_at DESC, id DESC LIMIT ?`)
    .all(...args, limit) as DealCardRow[];
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
}

/**
 * Full deal card: linked property cards, deal-level people, and a combined
 * acreage rollup. Combined acreage is "verified" only when EVERY linked parcel
 * is verified_property with a known acreage; otherwise it is preliminary.
 */
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
  const people = db.prepare(
    `SELECT pl.role, pl.authority_status, pl.authority_source, pl.note AS link_note, p.*
     FROM landos_person_link pl
     JOIN landos_person p ON p.id = pl.person_id
     WHERE pl.deal_card_id = ?
     ORDER BY pl.created_at ASC, pl.id ASC`,
  ).all(id) as Array<Record<string, unknown>>;

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

  return { ...deal, propertyCards: links, people, combinedAcreage };
}
