// LandOS Property Card / Property Memory layer.
//
// A Property Card is the property-centered source-of-truth container for a
// lead/property. Every Duke (or Ace/Forge/future-agent) property-address run
// creates or updates a card, so Tyler can return later and pull the stored
// context instead of starting over. All agents read/write the SAME card.
//
// Identity rules (hard):
//   - An address-only lead is NEVER a definitive property. It is an
//     unverified_lead card keyed by the normalized active input address.
//   - A parcel verified via APN + county, official assessor/GIS record, or
//     LandPortal property id + FIPS becomes a verified_property card keyed by
//     those identifiers.
//   - Cards are NEVER keyed or merged by coordinates, geocoder results, map
//     pins, proximity, road midpoint, similar address, or nearest parcel. A
//     verified card with a proximity-based verification source is refused.
//   - A corrected address preserves the prior failed input in prior_inputs and
//     makes the corrected address the active input.
//
// No network, no .env, no secrets. landos.db is gitignored; this stores
// metadata and agent work references, never property work product in the repo.

import {
  getLandosDb,
  landosAudit,
  type CardVerificationStatus,
  type KanbanStatus,
  type LandosEntity,
  type LeadJobStatus,
  type NearbyReferenceRelationship,
  CARD_VERIFICATION_STATUSES,
  KANBAN_STATUSES,
  LEAD_JOB_STATUSES,
  NEARBY_REFERENCE_RELATIONSHIPS,
  NEARBY_REFERENCE_LABEL,
} from './db.js';
import { classifySource, evaluateFact, type SourceType } from './source-evidence.js';

// Proximity / coordinate verification sources are never acceptable. Mirrors the
// duke-persist hard parcel rule so the card layer cannot be tricked either.
const BANNED_VERIFICATION_PATTERNS: RegExp[] = [
  /coordinat/i, /geocod/i, /nearest[\s_-]*parcel/i, /map[\s_-]*pin/i,
  /pin[\s_-]*drop/i, /map[\s_-]*click/i, /lat[\s_-]*\/?[\s_-]*lon/i,
  /latitude/i, /longitude/i, /proximity/i, /road[\s_-]*midpoint/i,
  /centroid/i, /map[\s_-]*bounds/i, /visual/i, /satellite/i, /aerial/i,
  /street[\s_-]*view/i,
];

export function isProximityVerificationSource(source: string): boolean {
  return BANNED_VERIFICATION_PATTERNS.some((p) => p.test(source));
}

/**
 * Strong parcel identity evidence — the ONLY thing that can create a
 * verified_property card. Definitive identity requires a real parcel key:
 *   - APN / parcel ID plus county, state, or FIPS, OR
 *   - LandPortal property id plus FIPS.
 * Address alone, owner alone, a source label/URL alone, or any coordinate/
 * proximity signal is never strong identity. (Owner + county/state may support
 * a lookup but only becomes verified when it resolves to an APN/property id,
 * which then satisfies this check.)
 */
export function hasStrongParcelIdentity(input: {
  apn?: string;
  lpPropertyId?: string;
  fips?: string;
  county?: string;
  state?: string;
}): boolean {
  const apn = (input.apn ?? '').trim();
  const lp = (input.lpPropertyId ?? '').trim();
  const fips = (input.fips ?? '').trim();
  const county = (input.county ?? '').trim();
  const state = (input.state ?? '').trim();
  if (apn && (county || state || fips)) return true;
  if (lp && fips) return true;
  return false;
}

/** Normalize an address into a stable matching key. Lowercase, collapse
 *  whitespace, strip punctuation. Used ONLY for exact-ish address matching of
 *  unverified leads — never for proximity/fuzzy nearest-parcel matching. */
export function normalizeAddressKey(address: string): string {
  return (address ?? '')
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PropertyCardRow {
  id: number;
  entity: string;
  verification_status: CardVerificationStatus;
  kanban_status: KanbanStatus;
  active_input_address: string;
  address_key: string;
  prior_inputs: string;
  apn: string;
  lp_property_id: string;
  fips: string;
  lp_url: string;
  county: string;
  state: string;
  city: string;
  owner: string;
  acres: number | null;
  verification_source: string;
  property_id: number | null;
  parcel_id: number | null;
  open_risks: string;
  summary: string;
  last_refreshed_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface UpsertPropertyCardInput {
  entity: LandosEntity;
  activeInputAddress: string;
  city?: string;
  county?: string;
  state?: string;
  apn?: string;
  lpPropertyId?: string;
  fips?: string;
  /** LandPortal property URL, when available. NEVER fabricated: if absent, the
   *  lp_property_id + fips are kept and the URL is left blank. */
  lpUrl?: string;
  owner?: string;
  acres?: number;
  verified?: boolean;
  verificationSource?: string;
  /** A source appears to match the address but parcel identity is not locked.
   *  Produces an address_matched card (never verified_property). */
  addressMatched?: boolean;
  propertyId?: number | null;
  parcelId?: number | null;
  /** A prior failed/corrected input to preserve in history. */
  priorInputAddress?: string;
  /** Explicit existing card to update (e.g. corrected address in same thread). */
  cardId?: number;
  summary?: string;
  agentId?: string;
}

function parseJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function getPropertyCardRow(id: number): PropertyCardRow | undefined {
  return getLandosDb().prepare('SELECT * FROM landos_property_card WHERE id = ?').get(id) as
    | PropertyCardRow
    | undefined;
}

function findExistingCard(input: UpsertPropertyCardInput): PropertyCardRow | undefined {
  const db = getLandosDb();
  if (input.cardId) return getPropertyCardRow(input.cardId);

  // Strong identity: a card may only be found as a verified parcel by its
  // strong identity key — NEVER by loose address matching. This prevents an
  // address-only or weak input from latching onto / promoting a card.
  if (hasStrongParcelIdentity(input)) {
    if (input.lpPropertyId && input.fips) {
      const row = db.prepare(
        'SELECT * FROM landos_property_card WHERE entity = ? AND lp_property_id = ? AND fips = ?',
      ).get(input.entity, input.lpPropertyId, input.fips) as PropertyCardRow | undefined;
      if (row) return row;
    }
    if (input.apn) {
      const row = db.prepare(
        `SELECT * FROM landos_property_card
         WHERE entity = ? AND apn = ? AND (county = ? OR state = ? OR fips = ?)`,
      ).get(input.entity, input.apn, input.county ?? '', input.state ?? '', input.fips ?? '') as PropertyCardRow | undefined;
      if (row) return row;
    }
    // No strong-key match yet. Allow upgrading an existing same-address card
    // ONLY when it does not already carry a DIFFERENT strong identity (never
    // hijack another verified parcel). Exact normalized address — not proximity.
    const key = normalizeAddressKey(input.activeInputAddress);
    if (key) {
      const row = db.prepare(
        'SELECT * FROM landos_property_card WHERE entity = ? AND address_key = ?',
      ).get(input.entity, key) as PropertyCardRow | undefined;
      if (row) {
        const sameOrNoApn = !row.apn || (input.apn && row.apn === input.apn);
        const sameOrNoLp = !row.lp_property_id || (input.lpPropertyId && row.lp_property_id === input.lpPropertyId);
        if (sameOrNoApn && sameOrNoLp) return row;
      }
    }
    return undefined;
  }

  // Weak / unverified input (including verified:true WITHOUT a strong key):
  // match only NON-verified cards by exact address key. A weak/address-only
  // input must NEVER latch onto a verified_property card (that requires the
  // strong identity key handled above) and must never revive a terminal
  // rejected_mismatch/archived card. It can only create/update an
  // unverified_lead or address_matched card.
  const key = normalizeAddressKey(input.activeInputAddress);
  if (key) {
    return db.prepare(
      `SELECT * FROM landos_property_card
       WHERE entity = ? AND address_key = ?
         AND verification_status IN ('unverified_lead','address_matched')
       ORDER BY id DESC LIMIT 1`,
    ).get(input.entity, key) as PropertyCardRow | undefined;
  }
  return undefined;
}

/**
 * Create or update a Property Card from an agent run. Returns the card with a
 * flag for whether it was created. Enforces the identity rules above.
 */
export function upsertPropertyCard(
  input: UpsertPropertyCardInput,
): { card: PropertyCardRow; created: boolean; warnings: string[] } {
  const db = getLandosDb();
  const warnings: string[] = [];
  const verifiedRequested = input.verified === true;
  const strong = hasStrongParcelIdentity(input);
  const verificationSource = (input.verificationSource ?? '').trim();

  if (verifiedRequested) {
    if (isProximityVerificationSource(verificationSource)) {
      throw new Error(
        `property-card: verificationSource "${verificationSource}" is proximity/coordinate-based and can never verify a parcel`,
      );
    }
  }

  // A card becomes verified_property ONLY with strong parcel identity evidence
  // AND a non-empty, non-proximity verification source. verified:true without
  // strong identity is downgraded (never trusted) to address_matched with a
  // guardrail warning — address-only input can never create a verified card.
  const canVerify = verifiedRequested && strong && verificationSource.length > 0;
  if (verifiedRequested && !canVerify) {
    if (!strong) {
      warnings.push(
        'verified:true ignored — no strong parcel identity evidence (need APN + county/state/FIPS, or LandPortal property id + FIPS). Recorded as address_matched.',
      );
    } else if (!verificationSource) {
      warnings.push('verified:true ignored — verification requires a verificationSource. Recorded as address_matched.');
    }
  }

  const now = Math.floor(Date.now() / 1000);
  let existing = findExistingCard(input);

  // Defense in depth: a weak/address-only input (no strong identity) must never
  // attach to a verified_property card unless the caller explicitly targets it
  // by cardId. findExistingCard already enforces this for address matching;
  // this guard guarantees the status decision below can never preserve
  // verified_property from a weak match.
  if (existing?.verification_status === 'verified_property' && !strong && input.cardId === undefined) {
    existing = undefined;
  }

  // Decide the target status. Verification never downgrades: a verified card
  // stays verified on a later run that carries its strong identity key (or an
  // explicit cardId), even if that run is otherwise weak (e.g. a timeout).
  let verificationStatus: CardVerificationStatus;
  if (existing?.verification_status === 'verified_property') {
    verificationStatus = 'verified_property';
  } else if (canVerify) {
    verificationStatus = 'verified_property';
  } else if (verifiedRequested || input.addressMatched || existing?.verification_status === 'address_matched') {
    verificationStatus = 'address_matched';
  } else {
    verificationStatus = 'unverified_lead';
  }

  // Only persist a verification source on a genuinely verified card.
  const effectiveSource = verificationStatus === 'verified_property' ? verificationSource : '';
  const addressKey = normalizeAddressKey(input.activeInputAddress);

  // Build the preserved prior-inputs history.
  const prior = existing ? parseJsonArray(existing.prior_inputs) : [];
  const pushPrior = (addr?: string) => {
    const a = (addr ?? '').trim();
    if (a && a !== input.activeInputAddress && !prior.includes(a)) prior.push(a);
  };
  if (existing && existing.active_input_address && existing.active_input_address !== input.activeInputAddress) {
    pushPrior(existing.active_input_address);
  }
  pushPrior(input.priorInputAddress);

  const isVerifiedNow = verificationStatus === 'verified_property';

  if (existing) {
    const kanban: KanbanStatus =
      existing.kanban_status === 'new_lead' && isVerifiedNow ? 'researching' : existing.kanban_status;
    db.prepare(
      `UPDATE landos_property_card SET
         verification_status = ?,
         kanban_status = ?,
         active_input_address = ?,
         address_key = ?,
         prior_inputs = ?,
         apn = CASE WHEN ? != '' THEN ? ELSE apn END,
         lp_property_id = CASE WHEN ? != '' THEN ? ELSE lp_property_id END,
         fips = CASE WHEN ? != '' THEN ? ELSE fips END,
         lp_url = CASE WHEN ? != '' THEN ? ELSE lp_url END,
         county = CASE WHEN ? != '' THEN ? ELSE county END,
         state = CASE WHEN ? != '' THEN ? ELSE state END,
         city = CASE WHEN ? != '' THEN ? ELSE city END,
         owner = CASE WHEN ? != '' THEN ? ELSE owner END,
         acres = COALESCE(?, acres),
         verification_source = CASE WHEN ? != '' THEN ? ELSE verification_source END,
         property_id = COALESCE(?, property_id),
         parcel_id = COALESCE(?, parcel_id),
         summary = CASE WHEN ? != '' THEN ? ELSE summary END,
         last_refreshed_at = ?,
         updated_at = ?
       WHERE id = ?`,
    ).run(
      verificationStatus,
      kanban,
      input.activeInputAddress,
      addressKey,
      JSON.stringify(prior),
      input.apn ?? '', input.apn ?? '',
      input.lpPropertyId ?? '', input.lpPropertyId ?? '',
      input.fips ?? '', input.fips ?? '',
      input.lpUrl ?? '', input.lpUrl ?? '',
      input.county ?? '', input.county ?? '',
      input.state ?? '', input.state ?? '',
      input.city ?? '', input.city ?? '',
      input.owner ?? '', input.owner ?? '',
      input.acres ?? null,
      effectiveSource, effectiveSource,
      input.propertyId ?? null,
      input.parcelId ?? null,
      input.summary ?? '', input.summary ?? '',
      now,
      now,
      existing.id,
    );
    landosAudit(input.agentId ?? 'duke-due-diligence', 'property_card_updated', `card ${existing.id} (${verificationStatus})`, {
      entity: input.entity, refTable: 'landos_property_card', refId: existing.id,
    });
    return { card: getPropertyCardRow(existing.id)!, created: false, warnings };
  }

  const kanban: KanbanStatus = isVerifiedNow ? 'researching' : 'needs_parcel_verification';
  const id = db.prepare(
    `INSERT INTO landos_property_card
       (entity, verification_status, kanban_status, active_input_address, address_key,
        prior_inputs, apn, lp_property_id, fips, lp_url, county, state, city, owner, acres,
        verification_source, property_id, parcel_id, summary, last_refreshed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.entity,
    verificationStatus,
    kanban,
    input.activeInputAddress,
    addressKey,
    JSON.stringify(prior),
    input.apn ?? '',
    input.lpPropertyId ?? '',
    input.fips ?? '',
    input.lpUrl ?? '',
    input.county ?? '',
    input.state ?? '',
    input.city ?? '',
    input.owner ?? '',
    input.acres ?? null,
    effectiveSource,
    input.propertyId ?? null,
    input.parcelId ?? null,
    input.summary ?? '',
    now,
  ).lastInsertRowid as number;
  landosAudit(input.agentId ?? 'duke-due-diligence', 'property_card_created', `card ${id} (${verificationStatus})`, {
    entity: input.entity, refTable: 'landos_property_card', refId: id,
  });
  return { card: getPropertyCardRow(id)!, created: true, warnings };
}

export function setCardKanbanStatus(cardId: number, status: KanbanStatus, actor = 'tyler'): PropertyCardRow | undefined {
  if (!(KANBAN_STATUSES as readonly string[]).includes(status)) return undefined;
  const db = getLandosDb();
  const now = Math.floor(Date.now() / 1000);
  const res = db.prepare('UPDATE landos_property_card SET kanban_status = ?, updated_at = ? WHERE id = ?')
    .run(status, now, cardId);
  if (res.changes === 0) return undefined;
  landosAudit(actor, 'property_card_kanban_set', `card ${cardId} -> ${status}`, { refTable: 'landos_property_card', refId: cardId });
  return getPropertyCardRow(cardId);
}

/**
 * Workflow-only verification-status change for rejected_mismatch / archived.
 * This NEVER promotes to verified_property (that requires strong identity via
 * upsertPropertyCard) and it does NOT erase the card's identity evidence (apn /
 * lp id / fips / verification_source columns are left intact). A reason is
 * required and audited.
 */
export function setCardVerificationStatus(
  cardId: number,
  status: CardVerificationStatus,
  actor = 'tyler',
  reason = '',
): { card?: PropertyCardRow; error?: string } {
  if (status !== 'rejected_mismatch' && status !== 'archived') {
    return { error: 'verification_status can only be set to rejected_mismatch or archived here; verified_property requires strong identity evidence via the upsert path' };
  }
  if (!reason.trim()) return { error: 'a reason is required to reject or archive a card' };
  const db = getLandosDb();
  const card = getPropertyCardRow(cardId);
  if (!card) return { error: 'not found' };
  const now = Math.floor(Date.now() / 1000);
  // Identity evidence (apn/lp_property_id/fips/verification_source) is preserved.
  db.prepare('UPDATE landos_property_card SET verification_status = ?, updated_at = ? WHERE id = ?')
    .run(status, now, cardId);
  landosAudit(actor, 'property_card_verification_set', `card ${cardId} -> ${status} — ${reason}`, { refTable: 'landos_property_card', refId: cardId });
  return { card: getPropertyCardRow(cardId)! };
}

export function listPropertyCards(opts: { entity?: string; kanbanStatus?: KanbanStatus; verificationStatus?: CardVerificationStatus; limit?: number } = {}): PropertyCardRow[] {
  const db = getLandosDb();
  const limit = Math.min(opts.limit ?? 200, 500);
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.entity) { where.push('entity = ?'); args.push(opts.entity); }
  if (opts.kanbanStatus) { where.push('kanban_status = ?'); args.push(opts.kanbanStatus); }
  if (opts.verificationStatus) { where.push('verification_status = ?'); args.push(opts.verificationStatus); }
  const clause = where.length ? `WHERE ${where.join(' AND ')} ` : '';
  return db.prepare(`SELECT * FROM landos_property_card ${clause}ORDER BY updated_at DESC, id DESC LIMIT ?`)
    .all(...args, limit) as PropertyCardRow[];
}

// ── Source evidence / activity / next actions ──────────────────────────────

export interface AttachSourceEvidenceInput {
  cardId: number;
  fact: string;
  value?: string;
  sourceUrl?: string;
  sourceLabel?: string;
  dateAccessed?: string;
  note?: string;
  parcelVerified?: boolean;
}

export function attachCardSourceEvidence(input: AttachSourceEvidenceInput): { id: number; sourceType: SourceType; usableForOfferLogic: boolean } {
  const db = getLandosDb();
  const evaluated = evaluateFact({
    fact: input.fact,
    value: input.value,
    sourceUrl: input.sourceUrl,
    sourceLabel: input.sourceLabel,
    parcelVerified: input.parcelVerified,
  });
  const id = db.prepare(
    `INSERT INTO landos_card_source_evidence (card_id, fact, source_type, source_url, date_accessed, note, usable_for_offer_logic)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.cardId,
    input.fact,
    evaluated.sourceType,
    input.sourceUrl ?? '',
    input.dateAccessed ?? '',
    input.note ?? '',
    evaluated.usableForOfferLogic ? 1 : 0,
  ).lastInsertRowid as number;
  return { id, sourceType: evaluated.sourceType, usableForOfferLogic: evaluated.usableForOfferLogic };
}

export function attachCardActivity(input: { cardId: number; agentId: string; kind: string; summary: string; ref?: string }): number {
  return getLandosDb().prepare(
    `INSERT INTO landos_card_activity (card_id, agent_id, kind, summary, ref) VALUES (?, ?, ?, ?, ?)`,
  ).run(input.cardId, input.agentId, input.kind, input.summary, input.ref ?? '').lastInsertRowid as number;
}

export function addCardNextAction(input: { cardId: number; action: string; createdBy?: string }): number {
  return getLandosDb().prepare(
    `INSERT INTO landos_card_next_action (card_id, action, created_by) VALUES (?, ?, ?)`,
  ).run(input.cardId, input.action, input.createdBy ?? '').lastInsertRowid as number;
}

export function setNextActionStatus(id: number, status: string): void {
  const now = Math.floor(Date.now() / 1000);
  getLandosDb().prepare('UPDATE landos_card_next_action SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
}

// ── Nearby search reference ────────────────────────────────────────────────

export interface NearbySearchReferenceInput {
  cardId: number;
  address: string;
  relationship?: NearbyReferenceRelationship;
  sourceLink?: string;
  note?: string;
  dateAccessed?: string;
}

export interface NearbySearchReferenceResult {
  id?: number;
  label: string;
  error?: string;
}

/**
 * Attach a nearby search reference to a VERIFIED subject parcel. This is a
 * convenience for locating a verified vacant parcel that has no street/situs
 * address — it never identifies, verifies, values, merges, or overrides the
 * subject parcel, is never the active/situs address, and is always stored with
 * usable_for_identity = false and usable_for_offer_logic = false.
 *
 * Hard rule: it can only be attached once the subject parcel is verified by
 * strong identity (verification_status = verified_property). Attempting to
 * attach it to an unverified_lead or address_matched card is refused.
 */
export function attachNearbySearchReference(input: NearbySearchReferenceInput): NearbySearchReferenceResult {
  const db = getLandosDb();
  const card = getPropertyCardRow(input.cardId);
  if (!card) return { label: NEARBY_REFERENCE_LABEL, error: 'card not found' };
  if (card.verification_status !== 'verified_property') {
    return {
      label: NEARBY_REFERENCE_LABEL,
      error: 'a nearby search reference can only be saved on a verified_property card (verified by APN + county, official parcel record, or LandPortal property id + FIPS)',
    };
  }
  if (!input.address || !input.address.trim()) {
    return { label: NEARBY_REFERENCE_LABEL, error: 'address required' };
  }
  const relationship: NearbyReferenceRelationship =
    input.relationship && (NEARBY_REFERENCE_RELATIONSHIPS as readonly string[]).includes(input.relationship)
      ? input.relationship
      : 'unknown';
  const id = db.prepare(
    `INSERT INTO landos_card_nearby_reference
       (card_id, address, relationship, source_link, note, date_accessed, usable_for_identity, usable_for_offer_logic)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
  ).run(
    input.cardId,
    input.address.trim(),
    relationship,
    input.sourceLink ?? '',
    input.note ?? '',
    input.dateAccessed ?? '',
  ).lastInsertRowid as number;
  landosAudit('tyler', 'nearby_search_reference_added', `card ${input.cardId} (${relationship})`, {
    entity: card.entity, refTable: 'landos_card_nearby_reference', refId: id,
  });
  return { id, label: NEARBY_REFERENCE_LABEL };
}

export { NEARBY_REFERENCE_LABEL };

export interface PropertyCardDetail extends PropertyCardRow {
  priorInputs: string[];
  openRisks: string[];
  sourceEvidence: unknown[];
  activity: unknown[];
  nextActions: unknown[];
  facts: unknown[];
  nearbyReferences: unknown[];
  nearbyReferenceLabel: string;
}

/** Full property card with all attached memory: evidence, activity, next
 *  actions, and labeled facts (facts join via parcel_id). */
export function getPropertyCard(id: number): PropertyCardDetail | undefined {
  const db = getLandosDb();
  const card = getPropertyCardRow(id);
  if (!card) return undefined;
  const sourceEvidence = db.prepare('SELECT * FROM landos_card_source_evidence WHERE card_id = ? ORDER BY created_at DESC, id DESC').all(id);
  const activity = db.prepare('SELECT * FROM landos_card_activity WHERE card_id = ? ORDER BY created_at DESC, id DESC').all(id);
  const nextActions = db.prepare('SELECT * FROM landos_card_next_action WHERE card_id = ? ORDER BY created_at DESC, id DESC').all(id);
  const facts = card.parcel_id
    ? db.prepare('SELECT * FROM landos_fact WHERE parcel_id = ? ORDER BY created_at DESC, id DESC').all(card.parcel_id)
    : [];
  const nearbyReferences = db.prepare(
    'SELECT * FROM landos_card_nearby_reference WHERE card_id = ? ORDER BY created_at DESC, id DESC',
  ).all(id);
  return {
    ...card,
    priorInputs: parseJsonArray(card.prior_inputs),
    openRisks: parseJsonArray(card.open_risks),
    sourceEvidence,
    activity,
    nextActions,
    facts,
    nearbyReferences,
    nearbyReferenceLabel: NEARBY_REFERENCE_LABEL,
  };
}

// ── Duke run -> card writeback ─────────────────────────────────────────────

export interface DukeRunCardInput {
  entity: LandosEntity;
  agentId?: string;
  activeInputAddress: string;
  city?: string;
  county?: string;
  state?: string;
  apn?: string;
  lpPropertyId?: string;
  fips?: string;
  lpUrl?: string;
  owner?: string;
  acres?: number;
  verified?: boolean;
  verificationSource?: string;
  summary?: string;
  priorInputAddress?: string;
  cardId?: number;
  propertyId?: number | null;
  parcelId?: number | null;
}

/**
 * Bridge a completed Duke property-address run to a Property Card: create or
 * update the card (unverified_lead vs verified_property), record the run as
 * activity, and add a verification next-action for unverified leads. This is
 * the "every Duke property-address run updates a card" behavior.
 */
export function upsertCardFromDukeRun(
  input: DukeRunCardInput,
): { card: PropertyCardRow; created: boolean; warnings: string[] } {
  const result = upsertPropertyCard({
    entity: input.entity,
    activeInputAddress: input.activeInputAddress,
    city: input.city,
    county: input.county,
    state: input.state,
    apn: input.apn,
    lpPropertyId: input.lpPropertyId,
    fips: input.fips,
    lpUrl: input.lpUrl,
    owner: input.owner,
    acres: input.acres,
    verified: input.verified,
    verificationSource: input.verificationSource,
    propertyId: input.propertyId,
    parcelId: input.parcelId,
    summary: input.summary,
    priorInputAddress: input.priorInputAddress,
    cardId: input.cardId,
    agentId: input.agentId,
  });
  // Gate on the RESULTING status, not the requested flag: a verified:true run
  // that lacked strong identity was downgraded to address_matched and still
  // needs a verification next-action.
  const isVerified = result.card.verification_status === 'verified_property';
  attachCardActivity({
    cardId: result.card.id,
    agentId: input.agentId ?? 'duke-due-diligence',
    kind: isVerified ? 'duke_verified_run' : 'duke_unverified_run',
    summary: input.summary ?? (isVerified ? 'Verified parcel run' : 'Unverified parcel run'),
  });
  if (!isVerified) {
    addCardNextAction({
      cardId: result.card.id,
      action: 'Verify parcel: send APN + county, or owner + county.',
      createdBy: input.agentId ?? 'duke-due-diligence',
    });
  }
  return result;
}

// ── Batch lead intake ──────────────────────────────────────────────────────

export interface LeadJobRow {
  id: number;
  entity: string;
  batch_id: string;
  raw_input: string;
  status: LeadJobStatus;
  card_id: number | null;
  result_summary: string;
  next_action: string;
  error: string;
  created_at: number;
  updated_at: number;
}

/** Split pasted lead text into individual lead lines. One non-empty line per
 *  lead; commented (#) and blank lines are ignored. */
export function splitLeadLines(text: string): string[] {
  return (text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

/**
 * Create one isolated lead job per pasted lead. Jobs never share parcel state:
 * each carries only its own raw_input and starts 'queued'. Returns the batch id
 * and the created jobs.
 */
export function createLeadJobs(opts: { entity: LandosEntity; text: string; agentId?: string }): { batchId: string; jobs: LeadJobRow[] } {
  const db = getLandosDb();
  const lines = splitLeadLines(opts.text);
  const batchId = `batch_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const insert = db.prepare(
    `INSERT INTO landos_lead_job (entity, batch_id, raw_input, status) VALUES (?, ?, ?, 'queued')`,
  );
  const jobs: LeadJobRow[] = [];
  const tx = db.transaction(() => {
    for (const line of lines) {
      const id = insert.run(opts.entity, batchId, line).lastInsertRowid as number;
      jobs.push(getLeadJob(id)!);
    }
  });
  tx();
  landosAudit(opts.agentId ?? 'duke-due-diligence', 'batch_lead_jobs_created', `${jobs.length} jobs (${batchId})`, {
    entity: opts.entity, refTable: 'landos_lead_job',
  });
  return { batchId, jobs };
}

export function getLeadJob(id: number): LeadJobRow | undefined {
  return getLandosDb().prepare('SELECT * FROM landos_lead_job WHERE id = ?').get(id) as LeadJobRow | undefined;
}

export function listLeadJobs(opts: { entity?: string; batchId?: string; status?: LeadJobStatus; limit?: number } = {}): LeadJobRow[] {
  const db = getLandosDb();
  const limit = Math.min(opts.limit ?? 200, 500);
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.entity) { where.push('entity = ?'); args.push(opts.entity); }
  if (opts.batchId) { where.push('batch_id = ?'); args.push(opts.batchId); }
  if (opts.status) { where.push('status = ?'); args.push(opts.status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')} ` : '';
  return db.prepare(`SELECT * FROM landos_lead_job ${clause}ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...args, limit) as LeadJobRow[];
}

export function updateLeadJob(
  id: number,
  patch: { status?: LeadJobStatus; cardId?: number; resultSummary?: string; nextAction?: string; error?: string },
): LeadJobRow | undefined {
  const existing = getLeadJob(id);
  if (!existing) return undefined;
  if (patch.status && !(LEAD_JOB_STATUSES as readonly string[]).includes(patch.status)) return existing;
  const db = getLandosDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `UPDATE landos_lead_job SET
       status = ?, card_id = COALESCE(?, card_id),
       result_summary = CASE WHEN ? != '' THEN ? ELSE result_summary END,
       next_action = CASE WHEN ? != '' THEN ? ELSE next_action END,
       error = CASE WHEN ? != '' THEN ? ELSE error END,
       updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.status ?? existing.status,
    patch.cardId ?? null,
    patch.resultSummary ?? '', patch.resultSummary ?? '',
    patch.nextAction ?? '', patch.nextAction ?? '',
    patch.error ?? '', patch.error ?? '',
    now,
    id,
  );
  return getLeadJob(id);
}

export { classifySource };
