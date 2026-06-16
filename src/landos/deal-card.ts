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
}

export interface DukeDealWritebackResult {
  dealCardId: number;
  cardId: number;
  createdDeal: boolean;
  createdCard: boolean;
  verificationStatus: string;
  warnings: string[];
}

/**
 * Bridge a completed live Duke run into the Deal Card system. Creates/updates
 * the property card (verified vs research per strong identity — never verified
 * from address-only/weak/timeout), ensures a Deal Card exists and links the
 * property, then attaches source links, risks, next actions, the LandPortal URL
 * (only if provided), and a neutral lead-vs-owner mismatch action. Writes no
 * score/value/offer for unverified runs. Never merges APNs.
 */
export function upsertDealCardFromDukeRun(input: DukeDealWritebackInput): DukeDealWritebackResult | null {
  const address = (input.activeInputAddress ?? '').trim();
  const hasIdentity = !!(input.apn || input.lpPropertyId);
  // Nothing to anchor a card on (e.g. a bare timeout with no echoed address).
  if (!address && !hasIdentity) return null;

  // Defensive summary sanitizer: unless this run is unambiguously verifying the
  // parcel (verified flag + strong identity + a real non-proximity source),
  // strip any score/value/offer language from the persisted summary. Erring
  // toward sanitizing a rare weak-follow-up-on-verified run is safe.
  const vsource = (input.verificationSource ?? '').trim();
  const willVerify =
    input.verified === true &&
    hasStrongParcelIdentity({
      apn: input.apn, lpPropertyId: input.lpPropertyId, fips: input.fips,
      county: input.county, state: input.state,
    }) &&
    vsource.length > 0 &&
    !isProximityVerificationSource(vsource);
  const safeSummary = willVerify ? input.summary : sanitizeUnverifiedSummary(input.summary);

  const cardRes = upsertCardFromDukeRun({
    entity: input.entity,
    agentId: input.agentId,
    activeInputAddress: address || `${input.apn || input.lpPropertyId} (no address)`,
    apn: input.apn,
    lpPropertyId: input.lpPropertyId,
    fips: input.fips,
    lpUrl: input.lpUrl,
    county: input.county,
    state: input.state,
    city: input.city,
    owner: input.recordOwnerName ?? input.owner,
    acres: input.acres,
    verified: input.verified,
    verificationSource: input.verificationSource,
    summary: safeSummary,
  });
  const card: PropertyCardRow = cardRes.card;
  const warnings = [...cardRes.warnings];

  const db = getLandosDb();
  // Find an existing Deal Card already linking this property card.
  const existingLink = db.prepare(
    'SELECT deal_card_id FROM landos_deal_card_property WHERE card_id = ? ORDER BY id ASC LIMIT 1',
  ).get(card.id) as { deal_card_id: number } | undefined;

  let dealCardId: number;
  let createdDeal = false;
  if (existingLink) {
    dealCardId = existingLink.deal_card_id;
  } else {
    const deal = createDealCard({
      entity: input.entity,
      title: address || input.summary || `Deal ${card.id}`,
    });
    dealCardId = deal.id;
    createdDeal = true;
    linkPropertyToDeal({ dealCardId, cardId: card.id, role: 'subject' });
  }

  // Source evidence links (offer-usability gated by the standard; verified
  // parcels only become offer-usable downstream).
  const parcelVerified = card.verification_status === 'verified_property';
  for (const link of input.sourceLinks ?? []) {
    if (link?.url) {
      attachCardSourceEvidence({ cardId: card.id, fact: link.fact || 'source', sourceUrl: link.url, parcelVerified });
    }
  }

  // Risk / anomaly flags.
  if (input.risks && input.risks.length) appendCardOpenRisks(card.id, input.risks);

  // Extra next actions.
  for (const a of input.nextActions ?? []) {
    const v = (a ?? '').trim();
    if (v) addCardNextAction({ cardId: card.id, action: v, createdBy: input.agentId ?? 'duke-due-diligence' });
  }

  // Lead-contact vs record-owner: store both neutrally and require confirming
  // relationship/authority. Never auto-tag probate/inheritance or reject.
  const mismatch = leadContactMismatchNote(input.leadName, input.recordOwnerName);
  if (mismatch.mismatch) {
    attachCardActivity({
      cardId: card.id,
      agentId: input.agentId ?? 'duke-due-diligence',
      kind: 'lead_contact_differs_from_record_owner',
      summary: `Lead contact "${input.leadName}" differs from record owner "${input.recordOwnerName}". ${LEAD_OWNER_MISMATCH_NOTE}`,
    });
    addCardNextAction({
      cardId: card.id,
      action: 'Confirm relationship and authority before contract/closing.',
      createdBy: input.agentId ?? 'duke-due-diligence',
    });
  }

  attachCardActivity({
    cardId: card.id,
    agentId: input.agentId ?? 'duke-due-diligence',
    kind: 'duke_deal_writeback',
    summary: safeSummary || (parcelVerified ? 'Verified Duke run linked to deal' : 'Research Duke run linked to deal'),
  });

  return {
    dealCardId,
    cardId: card.id,
    createdDeal,
    createdCard: cardRes.created,
    verificationStatus: card.verification_status,
    warnings,
  };
}
