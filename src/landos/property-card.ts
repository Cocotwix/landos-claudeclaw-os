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

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getLandosStorageProfile, landosArtifactPath } from './storage-profile.js';

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
import { normalizeAddressMatchKey } from './address-normalize.js';
import { filterEligibleAssetMap, type VisualAssociation } from './visual-eligibility.js';
import { classifySource, evaluateFact, type SourceType } from './source-evidence.js';
import {
  isVerifiedLandPortalSubjectUrl,
  operatorLandPortalEntryUrl,
  sameLandPortalParcel,
  validateLandPortalSubjectUrl,
  type LandPortalParcelUrlRecord,
  type ThreeDCaptureEligibility,
} from './landportal-operating-rules.js';
import type { LandPortalVisualValidation } from './landportal-evidence-validation.js';
import { apnIdentifiersEquivalent } from './landportal-capability.js';
import {
  addressVariantsCompatible,
  evaluatePropertyInstructionConsistency,
  recordInstructionContradiction,
  type InstructionConsistencyInput,
} from './instruction-consistency.js';

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

/** Normalize an address into a stable matching key. Case, whitespace and
 *  punctuation are collapsed, and street suffixes/directionals are canonicalized
 *  through the shared address normalizer, so "4713 Sinking Creek Road" and
 *  "4713 Sinking Creek Rd" are one lead instead of two. Used ONLY for exact-ish
 *  address matching of unverified leads — never for proximity/fuzzy
 *  nearest-parcel matching. */
export function normalizeAddressKey(address: string): string {
  return normalizeAddressMatchKey(address);
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
  zip: string;
  owner: string;
  acres: number | null;
  verification_source: string;
  property_id: number | null;
  parcel_id: number | null;
  /** Verified-parcel coordinates (ENRICHMENT OUTPUT only — never identity). */
  lat: number | null;
  lng: number | null;
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
  zip?: string;
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
  /** Verified-parcel coordinates from the provider — persisted as ENRICHMENT
   *  OUTPUT (comps/imagery/map context), NEVER an identity/merge input. */
  lat?: number | null;
  lng?: number | null;
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
    // Public/official address normalization may add one missing street token
    // (for example Davidson -> Camp Davidson). Reuse one existing unresolved
    // lead only when the jurisdiction agrees and near-identical coordinates
    // corroborate the same candidate. This is not parcel verification: the
    // incoming accepted APN/source still supplies the strong identity.
    const candidates = db.prepare(
      `SELECT * FROM landos_property_card
       WHERE entity = ? AND verification_status IN ('unverified_lead','address_matched')
         AND apn = ''
         AND (? = '' OR state = '' OR state = ?)
         AND (? = '' OR county = '' OR lower(county) = lower(?))
       ORDER BY id DESC LIMIT 20`,
    ).all(input.entity, input.state ?? '', input.state ?? '', input.county ?? '', input.county ?? '') as PropertyCardRow[];
    const normalizedMatches = candidates.filter((candidate) => {
      if (!addressVariantsCompatible(candidate.active_input_address, input.activeInputAddress)) return false;
      if (input.lat == null || input.lng == null || candidate.lat == null || candidate.lng == null) return false;
      const check = evaluatePropertyInstructionConsistency({
        action: 'canonicalize', instruction: 'official/public address normalization',
        incomingAddress: input.activeInputAddress, incomingCounty: input.county, incomingState: input.state,
        incomingCoordinates: { lat: input.lat, lng: input.lng }, externalNormalizedAddress: input.activeInputAddress,
        existing: { cardId: candidate.id, address: candidate.active_input_address, aliases: parseJsonArray(candidate.prior_inputs), apn: candidate.apn, county: candidate.county, state: candidate.state, city: candidate.city, coordinates: { lat: candidate.lat, lng: candidate.lng }, verificationSource: candidate.verification_source },
      });
      return check.hardConflicts.length === 0 && check.harmlessNormalizations.includes('near-identical accepted coordinates');
    });
    if (normalizedMatches.length === 1) return normalizedMatches[0];
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
    const weak = db.prepare(
      `SELECT * FROM landos_property_card
       WHERE entity = ? AND address_key = ?
         AND verification_status IN ('unverified_lead','address_matched')
       ORDER BY id DESC LIMIT 1`,
    ).get(input.entity, key) as PropertyCardRow | undefined;
    if (weak) return weak;

    // Once an operator-confirmed normalization alias is stored, a later weak
    // prompt using that alias must resolve to the accepted card instead of
    // silently creating a second active lead. The canonical address and strong
    // identifiers remain untouched below.
    const verified = db.prepare(
      `SELECT * FROM landos_property_card
       WHERE entity = ? AND verification_status = 'verified_property'
       ORDER BY id DESC LIMIT 100`,
    ).all(input.entity) as PropertyCardRow[];
    const aliasMatches = verified.filter((row) => parseJsonArray(row.prior_inputs).some((alias) => normalizeAddressKey(alias) === key));
    if (aliasMatches.length === 1) return aliasMatches[0];

    // A verified card is deliberately not an address-only match target. If the
    // same address is submitted without a strong parcel key, keep that lead
    // separate and unresolved until independent identity evidence arrives.
    return undefined;
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

  // ── A PARCEL LINK, OR NOTHING ─────────────────────────────────────────────
  //
  // `lp_url` is meant to hold the LandPortal record for THIS parcel. A run that
  // fails to reach a parcel ends on the site root, and persisting that as the
  // parcel URL both destroyed the operator's own saved-map link and made every
  // later run believe it already had an entry point. A LandPortal address that
  // addresses no parcel and no saved map is not a parcel link; it is dropped,
  // and whatever the card already holds is left alone. Non-LandPortal URLs (a
  // county parcel page, for instance) are unaffected — this module has no
  // authority to judge those.
  const suppliedLpUrl = (input.lpUrl ?? '').trim();
  const lpUrlToPersist = suppliedLpUrl && /landportal\.com/i.test(suppliedLpUrl)
    && !operatorLandPortalEntryUrl(suppliedLpUrl)
    ? ''
    : suppliedLpUrl;
  if (suppliedLpUrl && !lpUrlToPersist) {
    warnings.push(`lpUrl "${suppliedLpUrl}" addresses no LandPortal parcel or saved map, so it was not stored as the parcel link; the existing link is unchanged.`);
  }

  const now = Math.floor(Date.now() / 1000);
  let existing = findExistingCard(input);

  // Defense in depth: a weak/address-only input (no strong identity) must never
  // attach to a verified_property card unless the caller explicitly targets it
  // by cardId. findExistingCard already enforces this for address matching;
  // this guard guarantees the status decision below can never preserve
  // verified_property from a weak match.
  const weakAcceptedAliasMatch = !!existing && existing.verification_status === 'verified_property' && !strong && input.cardId === undefined
    && parseJsonArray(existing.prior_inputs).some((alias) => normalizeAddressKey(alias) === normalizeAddressKey(input.activeInputAddress));
  if (existing?.verification_status === 'verified_property' && !strong && input.cardId === undefined && !weakAcceptedAliasMatch) {
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
  const addressToPersist = weakAcceptedAliasMatch && existing ? existing.active_input_address : input.activeInputAddress;
  const addressKey = normalizeAddressKey(addressToPersist);

  // Build the preserved prior-inputs history.
  const prior = existing ? parseJsonArray(existing.prior_inputs) : [];
  const pushPrior = (addr?: string) => {
    const a = (addr ?? '').trim();
    if (a && a !== addressToPersist && !prior.includes(a)) prior.push(a);
  };
  if (existing && existing.active_input_address && existing.active_input_address !== input.activeInputAddress) {
    pushPrior(existing.active_input_address);
  }
  pushPrior(input.priorInputAddress);
  if (weakAcceptedAliasMatch) pushPrior(input.activeInputAddress);

  const isVerifiedNow = verificationStatus === 'verified_property';
  let summaryToPersist = existing?.verification_status === 'verified_property' && !strong ? '' : (input.summary ?? '');

  // ── Accepted-identity preservation (permanent rule: previously accepted
  // operator information cannot change without Tyler's confirmation). An
  // IMPLICIT match onto an already-verified card — the caller did not target
  // it by cardId — must never rewrite its accepted identity records, whatever
  // the new run resolved (QA finding W2-F2: a QA intake with this card's APN
  // and a different address overwrote the accepted owner, county, and
  // verification provenance). The run is recorded as activity by the caller;
  // the accepted card returns unchanged.
  if (existing && existing.verification_status === 'verified_property' && input.cardId === undefined) {
    warnings.push(
      'existing verified card matched — accepted identity records preserved; the new run\'s values were NOT applied. Target the card explicitly (cardId) with Tyler\'s confirmation to change accepted records.',
    );
    return { card: existing!, created: false, warnings };
  }

  // A deliberately owner-reconciled official parcel identity is a hard guard
  // against a later automated provider resolving a neighboring/similar parcel.
  // The provider may still enrich this card when it confirms the same APN, but
  // it may never replace the accepted APN through an automated refresh.
  const normalized = (value?: string | null) => (value ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  const preserveOwnerReconciledIdentity = !!(
    existing
    && /owner-confirmed official parcel record/i.test(existing.verification_source ?? '')
    && input.agentId !== 'owner-verified-parcel-reconciliation'
  );
  if (
    preserveOwnerReconciledIdentity
    && input.apn
    && normalized(input.apn) !== normalized(existing!.apn)
  ) {
    warnings.push('owner-confirmed official parcel identity preserved; automated research returned a conflicting APN and was not applied.');
    return { card: existing!, created: false, warnings };
  }

  if (existing) {
    // A same-APN automated run used to replace the owner-confirmed provenance
    // with "LandPortal authenticated browser." That removed the hard guard
    // above, letting the *next* automated run replace the parcel entirely.
    // Keep the complete owner-confirmed identity immutable for every automated
    // update, while still allowing non-identity enrichment (such as acreage or
    // coordinates) on the same card. Only the explicit reconciliation action
    // may change these accepted fields and their provenance.
    const preservedAddress = preserveOwnerReconciledIdentity ? existing.active_input_address : addressToPersist;
    const preservedAddressKey = preserveOwnerReconciledIdentity ? existing.address_key : addressKey;
    if (preserveOwnerReconciledIdentity) summaryToPersist = '';
    // A verified parcel no longer "needs parcel verification": advance the kanban
    // off the pre-verification stages so the card stops reading as unverified.
    const kanban: KanbanStatus =
      isVerifiedNow && existing.kanban_status === 'new_lead' ? 'researching'
      : isVerifiedNow && existing.kanban_status === 'needs_parcel_verification' ? 'needs_seller_discovery'
      : existing.kanban_status;
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
         zip = CASE WHEN ? != '' THEN ? ELSE zip END,
         owner = CASE WHEN ? != '' THEN ? ELSE owner END,
         acres = COALESCE(?, acres),
         lat = COALESCE(?, lat),
         lng = COALESCE(?, lng),
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
      preservedAddress,
      preservedAddressKey,
      JSON.stringify(prior),
      preserveOwnerReconciledIdentity ? '' : input.apn ?? '', preserveOwnerReconciledIdentity ? '' : input.apn ?? '',
      preserveOwnerReconciledIdentity ? '' : input.lpPropertyId ?? '', preserveOwnerReconciledIdentity ? '' : input.lpPropertyId ?? '',
      preserveOwnerReconciledIdentity ? '' : input.fips ?? '', preserveOwnerReconciledIdentity ? '' : input.fips ?? '',
      preserveOwnerReconciledIdentity ? '' : lpUrlToPersist, preserveOwnerReconciledIdentity ? '' : lpUrlToPersist,
      preserveOwnerReconciledIdentity ? '' : input.county ?? '', preserveOwnerReconciledIdentity ? '' : input.county ?? '',
      preserveOwnerReconciledIdentity ? '' : input.state ?? '', preserveOwnerReconciledIdentity ? '' : input.state ?? '',
      preserveOwnerReconciledIdentity ? '' : input.city ?? '', preserveOwnerReconciledIdentity ? '' : input.city ?? '',
      preserveOwnerReconciledIdentity ? '' : input.zip ?? '', preserveOwnerReconciledIdentity ? '' : input.zip ?? '',
      preserveOwnerReconciledIdentity ? '' : input.owner ?? '', preserveOwnerReconciledIdentity ? '' : input.owner ?? '',
      input.acres ?? null,
      input.lat ?? null,
      input.lng ?? null,
      preserveOwnerReconciledIdentity ? existing!.verification_source : effectiveSource, preserveOwnerReconciledIdentity ? existing!.verification_source : effectiveSource,
      preserveOwnerReconciledIdentity ? null : input.propertyId ?? null,
      preserveOwnerReconciledIdentity ? null : input.parcelId ?? null,
      summaryToPersist, summaryToPersist,
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
        prior_inputs, apn, lp_property_id, fips, lp_url, county, state, city, zip, owner, acres,
        lat, lng, verification_source, property_id, parcel_id, summary, last_refreshed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    lpUrlToPersist,
    input.county ?? '',
    input.state ?? '',
    input.city ?? '',
    input.zip ?? '',
    input.owner ?? '',
    input.acres ?? null,
    input.lat ?? null,
    input.lng ?? null,
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
  consistency?: Partial<Omit<InstructionConsistencyInput, 'action' | 'instruction' | 'existing'>> & { instruction?: string },
): { card?: PropertyCardRow; error?: string } {
  if (status !== 'rejected_mismatch' && status !== 'archived') {
    return { error: 'verification_status can only be set to rejected_mismatch or archived here; verified_property requires strong identity evidence via the upsert path' };
  }
  if (!reason.trim()) return { error: 'a reason is required to reject or archive a card' };
  const db = getLandosDb();
  const card = getPropertyCardRow(cardId);
  if (!card) return { error: 'not found' };
  if (status === 'rejected_mismatch' && card.verification_status === 'verified_property') {
    const aliases = parseJsonArray(card.prior_inputs);
    const normalizationOnlyClaim = /(?:extra|missing|added|restored)\s+(?:street[- ]name\s+)?token|harmless\s+normaliz|road\s+(?:versus|vs\.?|to)\s+rd\b/i.test(reason);
    const incomingAddress = consistency?.incomingAddress ?? (normalizationOnlyClaim ? aliases[0] ?? card.active_input_address : undefined);
    if (consistency || normalizationOnlyClaim) {
      const instructionInput: InstructionConsistencyInput = {
        action: 'reject',
        instruction: consistency?.instruction ?? reason,
        incomingAddress,
        incomingApn: consistency?.incomingApn,
        incomingCounty: consistency?.incomingCounty,
        incomingState: consistency?.incomingState,
        incomingCoordinates: consistency?.incomingCoordinates,
        incomingParcelGeometryKey: consistency?.incomingParcelGeometryKey,
        externalNormalizedAddress: consistency?.externalNormalizedAddress,
        operatorCorrection: consistency?.operatorCorrection,
        existing: {
          cardId: card.id,
          address: card.active_input_address,
          aliases,
          apn: card.apn,
          county: card.county,
          state: card.state,
          city: card.city,
          coordinates: card.lat != null && card.lng != null ? { lat: card.lat, lng: card.lng } : null,
          verificationSource: card.verification_source,
        },
      };
      const check = evaluatePropertyInstructionConsistency(instructionInput);
      if (check.contradiction && !check.allowed) {
        recordInstructionContradiction(instructionInput, check, actor);
        return { card, error: 'instruction conflicts with stronger accepted parcel evidence; the verified property was preserved and the contradiction was recorded' };
      }
    }
  }
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
  // Preserve historic QA fixtures in storage, but never surface TEST LEAD
  // property cards in the operating workspace.
  if (!getLandosStorageProfile().syntheticOnly) where.push("lead_type <> 'test'");
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

export interface CardActivityEvent {
  id: number;
  kind: string;
  summary: string;
  agentId: string;
  createdAt: number;
}

/** The Deal Card activity timeline — real recorded events (report runs, visual
 *  intelligence/capture, comp research, inspections, stage moves, notes), newest
 *  first. Powers the Activity tab; never fabricated. */
export function getCardActivity(cardId: number, limit = 60): CardActivityEvent[] {
  const rows = getLandosDb()
    .prepare('SELECT id, kind, summary, agent_id, created_at FROM landos_card_activity WHERE card_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(cardId, limit) as Array<{ id: number; kind: string; summary: string; agent_id: string; created_at: number }>;
  return rows.map((r) => ({ id: r.id, kind: r.kind, summary: r.summary, agentId: r.agent_id, createdAt: r.created_at }));
}

// ── Visual capture persistence (Google Visual Property Context) ──────────────
// Captured image metadata is stored as a card activity (kind='visual_capture').
// Supporting context only — never parcel verification. Stored paths live under
// the gitignored store/visuals; only dashboard-safe URLs reach the browser.

export interface CardVisualAsset {
  storedPath: string;
  timestamp: string;
  /** Parcel-association evidence (visual-eligibility.ts). Captures made before
   *  the eligibility model carry none and are therefore never eligible. */
  association?: VisualAssociation | null;
}

/** Persist the latest visual capture for a property card (newest wins on read). */
export function saveCardVisualCapture(
  cardId: number,
  assets: Record<string, CardVisualAsset>,
  meta: { provider: string },
): void {
  attachCardActivity({
    cardId,
    agentId: 'tyler/visual',
    kind: 'visual_capture',
    summary: `Captured ${Object.keys(assets).length} ${meta.provider} verified parcel image(s).`,
    ref: JSON.stringify({ provider: meta.provider, assets }),
  });
}

/** Mark every persisted visual_capture record for a card superseded (kept for
 *  the audit trail, never again eligible to render). Used when captures are
 *  found to depict the wrong place. */
export function supersedeCardVisualCaptures(cardId: number, reason: string): number {
  const db = getLandosDb();
  const rows = db
    .prepare("SELECT id, ref FROM landos_card_activity WHERE card_id = ? AND kind = 'visual_capture'")
    .all(cardId) as Array<{ id: number; ref: string }>;
  let updated = 0;
  for (const row of rows) {
    let j: Record<string, unknown> = {};
    try { j = JSON.parse(row.ref) as Record<string, unknown>; } catch { j = {}; }
    if (j.superseded === true) continue;
    j.superseded = true;
    j.supersededReason = reason;
    j.supersededAt = new Date().toISOString();
    const assets = (j.assets ?? {}) as Record<string, CardVisualAsset>;
    for (const a of Object.values(assets)) {
      if (a && typeof a === 'object') {
        a.association = {
          ...(a.association ?? { targetKind: 'unknown', basis: 'unknown' }),
          eligibility: 'superseded',
          ineligibilityReason: reason,
        } as CardVisualAsset['association'];
      }
    }
    db.prepare('UPDATE landos_card_activity SET ref = ? WHERE id = ?').run(JSON.stringify(j), row.id);
    updated += 1;
  }
  return updated;
}

/** Load the most recent NON-SUPERSEDED persisted visual capture for a card
 *  (empty when none). Superseded records stay in the DB as audit trail but are
 *  never served. */
export function loadCardVisualCapture(cardId: number): Record<string, CardVisualAsset> {
  const rows = getLandosDb()
    .prepare("SELECT ref FROM landos_card_activity WHERE card_id = ? AND kind = 'visual_capture' ORDER BY created_at DESC, id DESC LIMIT 10")
    .all(cardId) as Array<{ ref: string }>;
  for (const row of rows) {
    try {
      const j = JSON.parse(row.ref) as { assets?: Record<string, CardVisualAsset>; superseded?: boolean };
      if (j?.superseded === true) continue;
      return j && typeof j.assets === 'object' && j.assets ? j.assets : {};
    } catch {
      continue;
    }
  }
  return {};
}

/** Load ONLY the visuals whose parcel association passes the eligibility model.
 *  This is the loader every serving layer (report, image route, Visual
 *  Intelligence) must use — a card-scoped filename alone never qualifies. */
export function loadEligibleCardVisualCapture(cardId: number): Record<string, CardVisualAsset> {
  return filterEligibleAssetMap(loadCardVisualCapture(cardId), cardId);
}

// ── Visual Intelligence persistence ─────────────────────────────────────────
// The operator-grade multi-source visual workflow (visual-intelligence.ts) stores
// its full record (per-source status + gallery + hero + observations + blockers)
// as a card activity. Stored as generic JSON here to avoid an import cycle with
// visual-intelligence (which imports browser-vision → property-card).

/** Persist the latest Visual Intelligence record for a card (newest wins). */
export function saveVisualIntelligence(cardId: number, record: unknown): void {
  attachCardActivity({
    cardId,
    agentId: 'tyler/visual-intel',
    kind: 'visual_intelligence',
    summary: 'Visual Intelligence run — visual signals only, never parcel verification.',
    ref: JSON.stringify(record ?? {}),
  });
}

/** Load the most recent Visual Intelligence record (null when none). */
export function loadVisualIntelligence(cardId: number): unknown | null {
  const row = getLandosDb()
    .prepare("SELECT ref FROM landos_card_activity WHERE card_id = ? AND kind = 'visual_intelligence' ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(cardId) as { ref?: string } | undefined;
  if (!row?.ref) return null;
  try { return JSON.parse(row.ref); } catch { return null; }
}

export interface LandPortalInspectionAsset {
  key: string;
  label: string;
  kind: 'parcel_page' | 'parcel_3d' | 'parcel_boundary' | 'overlay' | 'comparables_map' | 'street_view';
  purpose: string;
  storedPath: string;
  timestamp: string;
  overlay?: string;
  note?: string;
  /** Admission proof. Missing/rejected assets remain history but never project. */
  validation?: LandPortalVisualValidation | null;
}

export interface LandPortalOverlayObservation {
  overlay: string;
  status: 'captured' | 'observed' | 'not_found';
  note: string;
  confidence: 'medium' | 'low';
  screenshotKey?: string;
}

export interface LandPortalVisualObservation {
  label: string;
  detail: string;
  confidence: 'medium' | 'low';
  evidence: string;
}

export interface LandPortalComparableRecord {
  rawText: string;
  sourceUrl: string;
  /**
   * Which LandPortal surface supplied this row: the parcel sidebar block, the
   * expanded "Show on Map" results, or 'both' when the two corroborate the same
   * property. Provenance is retained so a corroborated comp is visibly one
   * record rather than two, and so the operator can see where a field came from.
   */
  surface?: 'sidebar' | 'map' | 'both';
  apn?: string | null;
  address?: string | null;
  saleDate?: string;
  acres?: number | null;
  price?: number | null;
  pricePerAcre?: number | null;
  distanceMiles?: number | null;
  status: 'sold' | 'active' | 'listed' | 'unknown';
  saleListIndicator?: 'sale' | 'list' | 'unknown';
  improvement: 'vacant' | 'improved' | 'unknown';
  confidence: 'high' | 'medium' | 'low';

  // ── Two-surface fields (Phase 5 comp correction) ──────────────────────────
  /**
   * Where the transaction status came from. LandPortal publishes it as a card
   * ATTRIBUTE and again on the comp's own parcel page; the row text never says.
   * Recording the origin is what stops a stated status from being quietly
   * downgraded to 'unknown' by a later normalization step.
   */
  statusSource?: 'card_attribute' | 'detail_surface' | 'row_text' | 'section_label' | null;
  /** LandPortal's own identity for the comp, from the comparable card. */
  landPortalPropertyId?: string | null;
  fips?: string | null;
  mlsPropertyId?: string | null;
  /** Detail-surface locality. */
  city?: string | null;
  county?: string | null;
  state?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Assessor parcel acreage from the detail surface, which is NOT always the
   *  MLS acreage the comparable row was priced on. */
  parcelAcres?: number | null;
  /** Improvement evidence from the detail surface. A structure with a nominal
   *  improvement value is a land sale; a material one is not. */
  buildingSqft?: number | null;
  improvementValue?: number | null;
  useDescription?: string | null;
  landMarketValue?: number | null;
  totalMarketValue?: number | null;
  /**
   * True when the row acreage and the detail parcel acreage cannot be
   * reconciled (the live case: a row reading "17.75 ac" whose parcel page is
   * 574 acres). Such a row can never carry a price-per-acre.
   */
  acreageConflict?: boolean;
  /**
   * Which PAIR — price together with the acreage it was paid over — this row is
   * priced on. `mls_listing` is the `similars` feed's listing figures;
   * `parcel_deed_record` is the parcel's own recorded sale, adopted whole when
   * the listing pair's area contradicts the parcel's own. The two are never
   * mixed, because a price from one over an acreage from the other is a
   * price-per-acre no source ever stated.
   */
  pricingBasis?: 'mls_listing' | 'parcel_deed_record' | null;
  /** Operator-readable reason the deed pair replaced the listing pair. */
  pricingBasisNote?: string | null;
  /** The comp's own LandPortal parcel URL — the second surface actually read. */
  detailUrl?: string | null;
  /**
   * When the capture that produced this row ran.
   *
   * Property inspection is CUMULATIVE, which is right for evidence and wrong for
   * "what are this parcel's comparables right now": a provider's comparable set
   * changes between runs, so rows from superseded captures kept reappearing in
   * the operator's current comp set — unenriched, status-unknown, and no longer
   * part of what the provider returns. Stamping the generation lets the current
   * set be read without deleting the history.
   */
  capturedAtIso?: string | null;
}

export interface PropertyInspectionSource {
  provider: string;
  stage: string;
  status: 'used' | 'fallback' | 'not_attempted' | 'not_configured' | 'partial' | 'error';
  /** Business-level result from a source that was actually attempted. */
  resultKind?: 'retrieved' | 'useful_indication' | 'attempted_inconclusive' | 'source_unavailable' | 'not_found' | 'execution_failure';
  attemptedAt?: string | null;
  confidence: 'high' | 'medium' | 'low';
  url?: string | null;
  note: string;
}

export interface PropertyInspectionEvidence {
  label: string;
  status: 'verified' | 'observed' | 'estimated' | 'unknown' | 'needs_verification';
  detail: string;
  confidence: 'high' | 'medium' | 'low';
  source?: string | null;
  url?: string | null;
}

export interface PropertyInspectionRecord {
  parcelUrl: string | null;
  parcelUrlRecord?: LandPortalParcelUrlRecord | null;
  threeDCapture?: ThreeDCaptureEligibility | null;
  comparablesUrl: string | null;
  /** Timestamp of the latest completed comparable-set read, even when it returned zero rows. */
  comparablesCapturedAt?: string | null;
  parcelFacts: Record<string, string>;
  assets: LandPortalInspectionAsset[];
  overlays: LandPortalOverlayObservation[];
  visualObservations: LandPortalVisualObservation[];
  comparables: LandPortalComparableRecord[];
  sources: PropertyInspectionSource[];
  evidence: PropertyInspectionEvidence[];
  discoveryQuestions: string[];
  missingInformation: string[];
}

interface PendingLandPortalInspectionAsset {
  key: string;
  label: string;
  kind: LandPortalInspectionAsset['kind'];
  purpose: string;
  sourcePath: string;
  timestamp: string;
  overlay?: string;
  note?: string;
  validation?: LandPortalVisualValidation | null;
}

export interface PendingPropertyInspectionRecord {
  parcelUrl: string | null;
  parcelUrlRecord?: LandPortalParcelUrlRecord | null;
  threeDCapture?: ThreeDCaptureEligibility | null;
  comparablesUrl: string | null;
  comparablesCapturedAt?: string | null;
  parcelFacts: Record<string, string>;
  assets: PendingLandPortalInspectionAsset[];
  overlays: LandPortalOverlayObservation[];
  visualObservations: LandPortalVisualObservation[];
  comparables: LandPortalComparableRecord[];
  sources?: PropertyInspectionSource[];
  evidence?: PropertyInspectionEvidence[];
  discoveryQuestions?: string[];
  missingInformation?: string[];
}

export type LandPortalInspectionRecord = PropertyInspectionRecord;
export type PendingLandPortalInspectionRecord = PendingPropertyInspectionRecord;

function inspectionFileName(cardId: number, key: string, sourcePath: string): string {
  const ext = path.extname(sourcePath).toLowerCase() || '.png';
  const digest = crypto.createHash('sha256').update(`${cardId}:${key}:${sourcePath}`).digest('hex').slice(0, 12);
  const safeKey = key.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  return `landportal_${cardId}_${safeKey}_${digest}${ext}`;
}

function visualsDir(): string {
  return landosArtifactPath('visuals');
}

function copyInspectionAsset(cardId: number, asset: PendingLandPortalInspectionAsset): LandPortalInspectionAsset | null {
  if (!asset.sourcePath) return null;
  try {
    const source = path.resolve(asset.sourcePath);
    if (!fs.existsSync(source)) return null;
    const dir = visualsDir();
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, inspectionFileName(cardId, asset.key, source));
    fs.copyFileSync(source, dest);
    return {
      key: asset.key,
      label: asset.label,
      kind: asset.kind,
      purpose: asset.purpose,
      storedPath: dest,
      timestamp: asset.timestamp,
      overlay: asset.overlay,
      note: asset.note,
      validation: asset.validation ?? null,
    };
  } catch {
    return null;
  }
}

function nonBlank(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : value != null;
}

/**
 * Collapse comparable rows across cumulative inspections, newest read winning.
 *
 * Comparables are identified by the PARCEL, not by the URL that happened to
 * supply the row. A later, enriched capture of the same comp carries a different
 * source URL (the comp's own parcel page) and a street address the earlier row
 * lacked, so a URL/address/price key let the stale, status-unknown copy survive
 * beside its corrected replacement and doubled the operator's comp count.
 *
 * APN alone is not enough either: an extractor that mis-assigns one APN to
 * several rows would silently delete real comps. So two rows are the same comp
 * when they share an APN AND do not state two DIFFERENT addresses. That merges
 * "no address yet" with "address now known" while keeping genuinely distinct
 * properties apart.
 */
export function mergeComparableRows(rows: LandPortalComparableRecord[]): LandPortalComparableRecord[] {
  const normApn = (value: unknown): string => String(value ?? '').replace(/[^0-9a-z]/gi, '').toLowerCase();
  const normAddress = (value: unknown): string => String(value ?? '').replace(/[^0-9a-z]/gi, '').toLowerCase();
  const merged = new Map<string, LandPortalComparableRecord>();
  for (const row of rows) {
    const apn = normApn(row.apn);
    const address = normAddress(row.address);
    let key: string;
    if (apn.length >= 5) {
      // Reuse the APN slot only when the addresses do not contradict.
      const existingKey = [...merged.keys()].find((candidate) => {
        if (!candidate.startsWith(`apn:${apn}|`)) return false;
        const held = merged.get(candidate)!;
        const heldAddress = normAddress(held.address);
        return !heldAddress || !address || heldAddress === address;
      });
      key = existingKey ?? `apn:${apn}|${address}`;
    } else {
      key = `${row.sourceUrl ?? ''}|${row.address ?? ''}|${row.acres ?? ''}|${row.price ?? ''}`;
    }
    if (!key) continue;
    // A comparable settled on the parcel's OWN recorded deed is not replaced by
    // a later row that was not. This merge is otherwise last-writer-wins, and
    // the Hermes comps import rewrites the comparable set from its own
    // handback — which reports the `similars` feed. So the settled tuple was
    // produced, persisted, and then clobbered one lane later, which is how APN
    // 044 068.01 kept reverting to $200,000 over 20.55 acres (the figures
    // belonging to the neighbouring parcel 043 042) after being corrected to
    // its own $550,000 warranty deed over 5.05 acres.
    const held = merged.get(key);
    if (held?.pricingBasis === 'parcel_deed_record' && row.pricingBasis !== 'parcel_deed_record') continue;
    merged.set(key, row);
  }
  return [...merged.values()];
}

function mergeUniqueBy<T>(rows: T[], keyOf: (row: T) => string): T[] {
  const merged = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    merged.set(key, row);
  }
  return [...merged.values()];
}

function mergeInspectionAssets(rows: LandPortalInspectionAsset[]): LandPortalInspectionAsset[] {
  const merged = new Map<string, LandPortalInspectionAsset>();
  for (const row of rows) {
    const key = row.key || row.storedPath;
    if (!key) continue;
    const held = merged.get(key);
    if (!held) { merged.set(key, row); continue; }
    const heldAccepted = held.validation?.status === 'accepted';
    const incomingAccepted = row.validation?.status === 'accepted';
    if (heldAccepted && !incomingAccepted) continue;
    if (incomingAccepted && !heldAccepted) { merged.set(key, row); continue; }
    merged.set(key, {
      ...held,
      ...row,
      label: row.label || held.label,
      purpose: row.purpose || held.purpose,
      storedPath: row.storedPath || held.storedPath,
      timestamp: row.timestamp || held.timestamp,
      overlay: row.overlay || held.overlay,
      note: row.note || held.note,
      validation: row.validation ?? held.validation ?? null,
    });
  }
  return [...merged.values()];
}

/**
 * Property inspection is cumulative evidence. A later county-only gap-fill may
 * add official facts, but it must never erase an earlier LandPortal parcel page,
 * visual, overlay, or comparable. Later non-empty values win only within the
 * same field/key; arrays are deduplicated and retained across runs.
 */
export function mergePropertyInspections(records: Array<PropertyInspectionRecord | null | undefined>): PropertyInspectionRecord | null {
  const usable = records.filter((record): record is PropertyInspectionRecord => !!record);
  if (!usable.length) return null;
  // A verified operator-entry record counts here too. It is not a canonical
  // parcel key — it carries no fips or propertyId and never will — but it does
  // record that this exact URL was opened and its parcel confirmed on screen,
  // which is the association this field exists to state. Dropping it left a
  // verified parcel reading as unverified.
  const canonicalRecords = usable.flatMap((record) => [record.parcelUrlRecord ?? null])
    .filter((record): record is LandPortalParcelUrlRecord => !!record && record.verifiedSubject
      && (isVerifiedLandPortalSubjectUrl(record.url) || operatorLandPortalEntryUrl(record.url) !== null));
  let latestCanonical: LandPortalParcelUrlRecord | null = null;
  for (const record of canonicalRecords) {
    if (!latestCanonical || sameLandPortalParcel(
      { fips: latestCanonical.fips, apn: latestCanonical.apn, propertyId: latestCanonical.propertyId },
      { fips: record.fips, apn: record.apn, propertyId: record.propertyId },
    )) latestCanonical = record;
  }
  const factRecords = latestCanonical
    ? usable.filter((record) => record.parcelUrl === latestCanonical!.url || record.parcelUrlRecord?.url === latestCanonical!.url)
    // ── FACTS FROM ANOTHER PARCEL ARE NEVER THIS PARCEL'S FACTS ──────────────
    //
    // Without a canonical parcel URL to segregate on, every retained inspection
    // used to merge into one fact set — including ones captured for a DIFFERENT
    // parcel. That is how a subject whose own record says "Building SqFt 0,
    // Vacant Land" carried a 1,404 sqft house: an earlier failed run had read
    // the neighbouring parcel, and its facts merged in and outranked nothing,
    // because nothing compared the two records' own stated identity.
    //
    // The records themselves state which parcel they describe. The most recent
    // stated parcel is the subject; a record stating a different one is evidence
    // about another property (permanent memory invariant 4) and is left out of
    // the merged facts. It is NOT deleted — the activity row stays exactly as
    // captured, so the history of what was read and when is intact. A record
    // that states no parcel at all contradicts nothing and still merges.
    : (() => {
      const statedApn = (record: PropertyInspectionRecord): string | null => {
        const facts = record.parcelFacts ?? {};
        const value = facts['Parcel ID'] ?? facts['APN'] ?? facts['Parcel Number'];
        const trimmed = String(value ?? '').trim();
        return trimmed && trimmed !== '-' ? trimmed : null;
      };
      const subjectApn = [...usable].reverse().map(statedApn).find((apn): apn is string => !!apn) ?? null;
      if (!subjectApn) return usable;
      return usable.filter((record) => {
        const apn = statedApn(record);
        return apn == null || apnIdentifiersEquivalent(apn, subjectApn);
      });
    })();
  const facts: Record<string, string> = {};
  for (const record of factRecords) {
    for (const [key, value] of Object.entries(record.parcelFacts ?? {})) {
      if (nonBlank(value)) facts[key] = value;
    }
  }
  const landPortalUrl = latestCanonical?.url
    ?? [...usable].reverse().map((r) => r.parcelUrl).find((url) => !!url && /landportal/i.test(url));
  const latestParcelUrl = [...usable].reverse().map((r) => r.parcelUrl).find((url) => nonBlank(url));
  const latestComparablesUrl = [...usable].reverse().map((r) => r.comparablesUrl).find((url) => nonBlank(url));
  const all = <T>(pick: (record: PropertyInspectionRecord) => T[]) => usable.flatMap((record) => pick(record) ?? []);
  // ── PARCEL-SPECIFIC EVIDENCE FOLLOWS THE PARCEL ──────────────────────────
  //
  // Segregation used to stop at the fact sheet, so a capture of the WRONG
  // parcel still contributed its imagery, its overlay and terrain observations,
  // and the comparables it was searched for. A photograph of the neighbouring
  // lot is not a photograph of this one, and a comp set assembled around
  // another parcel's location and acreage is not this subject's comp set —
  // both were being presented as the subject's own (permanent memory invariant
  // 4, the same rule the facts already follow).
  //
  // These four are parcel-specific and are taken only from records that state
  // THIS parcel. `sources`, `evidence`, `discoveryQuestions` and
  // `missingInformation` deliberately still come from every record: they are
  // the provenance trail and market/jurisdiction context, which do not become
  // false because the subject was corrected. Nothing is deleted here either —
  // the superseded capture's activity row is untouched and readable.
  const ofSubjectParcel = <T>(pick: (record: PropertyInspectionRecord) => T[]) =>
    factRecords.flatMap((record) => pick(record) ?? []);
  return {
    parcelUrl: landPortalUrl ?? latestParcelUrl ?? null,
    parcelUrlRecord: latestCanonical,
    threeDCapture: [...factRecords].reverse().map((r) => r.threeDCapture ?? null).find((value): value is ThreeDCaptureEligibility => !!value) ?? null,
    comparablesUrl: latestComparablesUrl ?? null,
    comparablesCapturedAt: [...usable].reverse().map((r) => r.comparablesCapturedAt ?? null).find(nonBlank) ?? null,
    parcelFacts: facts,
    assets: mergeInspectionAssets(ofSubjectParcel((r) => r.assets)),
    overlays: mergeUniqueBy(ofSubjectParcel((r) => r.overlays), (row) => `${row.overlay}|${row.screenshotKey ?? ''}`),
    visualObservations: mergeUniqueBy(ofSubjectParcel((r) => r.visualObservations), (row) => `${row.label}|${row.detail}|${row.evidence}`),
    comparables: mergeComparableRows(ofSubjectParcel((r) => r.comparables)),
    sources: mergeUniqueBy(all((r) => r.sources ?? []), (row) => `${row.provider}|${row.stage}|${row.url ?? ''}`),
    evidence: mergeUniqueBy(all((r) => r.evidence ?? []), (row) => `${row.label}|${row.source ?? ''}|${row.url ?? ''}|${row.detail}`),
    discoveryQuestions: [...new Set(all((r) => r.discoveryQuestions ?? []).filter(nonBlank))],
    missingInformation: [...new Set(all((r) => r.missingInformation ?? []).filter(nonBlank))],
  };
}

/** Persist cumulative property-inspection evidence for a property card. */
export function savePropertyInspection(cardId: number, inspection: PendingPropertyInspectionRecord): void {
  const assets = inspection.assets
    .map((asset) => copyInspectionAsset(cardId, asset))
    .filter((asset): asset is LandPortalInspectionAsset => !!asset);
  const captured: PropertyInspectionRecord = {
    parcelUrl: inspection.parcelUrl,
    parcelUrlRecord: inspection.parcelUrlRecord ?? null,
    threeDCapture: inspection.threeDCapture ?? null,
    comparablesUrl: inspection.comparablesUrl,
    comparablesCapturedAt: inspection.comparablesCapturedAt ?? null,
    parcelFacts: inspection.parcelFacts,
    assets,
    overlays: inspection.overlays,
    visualObservations: inspection.visualObservations,
    comparables: inspection.comparables,
    sources: inspection.sources ?? [],
    evidence: inspection.evidence ?? [],
    discoveryQuestions: inspection.discoveryQuestions ?? [],
    missingInformation: inspection.missingInformation ?? [],
  };
  const payload = mergePropertyInspections([loadPropertyInspection(cardId), captured]) ?? captured;
  attachCardActivity({
    cardId,
    agentId: 'acquisition-specialist',
    kind: 'property_inspection',
    summary: `Captured property inspection (${assets.length} image(s), ${payload.comparables.length} comparable row(s)).`,
    ref: JSON.stringify(payload),
  });
  promoteRetainedParcelEnrichment(cardId, payload.parcelFacts);
}

/**
 * Carry the retained parcel record's ZIP and centroid onto the property card.
 *
 * FILL-ONLY, and enrichment only. It writes nothing that is already set, so no
 * accepted operator value can be changed, and it never touches identity: a
 * centroid places a parcel, it never establishes which parcel this is.
 *
 * Without this the two facts sat in the inspection record and nowhere else.
 * Every later reader looks on the CARD — the comparable map and its distance
 * bands, the ZIP market record, the data-center radius screen — so a subject
 * whose own centroid and ZIP had been captured still read as having neither,
 * and the surfaces that depend on a subject point reported everything
 * "location unresolved".
 */
function promoteRetainedParcelEnrichment(cardId: number, facts: Record<string, string>): void {
  const text = (...labels: string[]): string | null => {
    for (const label of labels) {
      const raw = facts[label];
      if (typeof raw === 'string' && raw.trim() && !/^(?:-|--|n\/?a)$/i.test(raw.trim())) return raw.trim();
    }
    return null;
  };
  const number = (...labels: string[]): number | null => {
    const raw = text(...labels);
    if (raw == null) return null;
    const value = Number(raw.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0] ?? Number.NaN);
    return Number.isFinite(value) ? value : null;
  };
  const zipRaw = text('Parcel Address Zip Code', 'Parcel Address ZIP Code');
  const zip = zipRaw && /^\d{5}/.test(zipRaw) ? zipRaw.slice(0, 5) : null;
  const lat = number('Centroid Latitude', 'Latitude', 'Situs Latitude');
  const lng = number('Centroid Longitude', 'Longitude', 'Situs Longitude');
  const pointUsable = lat != null && lng != null
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  if (!zip && !pointUsable) return;
  const db = getLandosDb();
  try {
    if (zip) {
      db.prepare("UPDATE landos_property_card SET zip = ? WHERE id = ? AND (zip IS NULL OR trim(zip) = '')")
        .run(zip, cardId);
    }
    if (pointUsable) {
      db.prepare('UPDATE landos_property_card SET lat = ?, lng = ? WHERE id = ? AND lat IS NULL AND lng IS NULL')
        .run(lat, lng, cardId);
    }
  } catch { /* enrichment must never fail a capture */ }
}

/**
 * The comparable rows belonging to the CURRENT capture generation.
 *
 * Cumulative inspection keeps every comparable ever read, which is correct for
 * evidence. It is not the answer to "what are this parcel's comparables now":
 * a provider's comparable set changes between runs, and rows from superseded
 * captures were resurfacing in the operator's working set carrying none of the
 * status, address or date the current capture establishes.
 *
 * Rows stamped with the newest capture time are the current set. When nothing is
 * stamped at all — only pre-stamping history exists — every row is returned, so
 * an older card never loses its comps to this rule.
 *
 * A GENERATION IS PER SURFACE. The provider publishes its comparables on more
 * than one surface — the parcel sidebar and the "Show on Map" expansion — and
 * they are captured by different writers, minutes apart. Treating the whole
 * record as one generation meant whichever surface was written last silently
 * deleted the other from every read: rows only the map published were captured,
 * retained, and then filtered out of the registry, the research lanes, and the
 * operator's comparable list. Each surface keeps its own newest generation, so
 * re-reading one surface replaces only that surface and never erases another.
 */
export function currentComparables(
  inspection: PropertyInspectionRecord | null | undefined,
): LandPortalComparableRecord[] {
  const rows = inspection?.comparables ?? [];
  if (!rows.length) return rows;
  const stampOf = (row: LandPortalComparableRecord): string | null =>
    (typeof row.capturedAtIso === 'string' && row.capturedAtIso ? row.capturedAtIso : null);
  const surfaceOf = (row: LandPortalComparableRecord): string =>
    (typeof row.surface === 'string' && row.surface.trim() ? row.surface.trim().toLowerCase() : 'sidebar');
  if (!rows.some(stampOf)) return rows;

  // Newest generation WITHIN each surface. A surface a newer capture did not
  // re-read keeps its own most recent generation instead of being erased by it.
  const newestBySurface = new Map<string, string>();
  for (const row of rows) {
    const stamp = stampOf(row);
    if (!stamp) continue;
    const surface = surfaceOf(row);
    const seen = newestBySurface.get(surface);
    if (!seen || stamp > seen) newestBySurface.set(surface, stamp);
  }
  // A completed generation still pins the surfaces IT wrote, so a newer but
  // partially written capture of the same surface cannot supersede it. It pins
  // only its own surfaces; that is the whole difference from the rule that was
  // deleting the other surface's rows.
  const completedGeneration = inspection?.comparablesCapturedAt ?? null;
  if (completedGeneration) {
    const generationRows = rows.filter((row) => stampOf(row) === completedGeneration);
    if (generationRows.length) {
      for (const row of generationRows) newestBySurface.set(surfaceOf(row), completedGeneration);
    } else {
      // A COMPLETED capture that returned nothing at all names no surface, and
      // it is the newest statement about this parcel's comparables: the
      // provider now publishes none. Every earlier generation is superseded,
      // exactly as before — an empty answer is still an answer.
      return [];
    }
  }
  const current = rows.filter((row) => {
    const stamp = stampOf(row);
    return !!stamp && newestBySurface.get(surfaceOf(row)) === stamp;
  });

  // One record per parcel. Where surfaces disagree the NEWEST observation of
  // that parcel wins, so a re-read that reclassifies a row cannot leave the
  // superseded copy of the same parcel standing beside it.
  const newestForParcel = new Map<string, string>();
  const parcelKey = (row: LandPortalComparableRecord): string | null =>
    (row.apn ? `apn:${row.apn.replace(/[^0-9a-z]/gi, '').toLowerCase()}` : null);
  for (const row of current) {
    const key = parcelKey(row);
    const stamp = stampOf(row);
    if (!key || !stamp) continue;
    const seen = newestForParcel.get(key);
    if (!seen || stamp > seen) newestForParcel.set(key, stamp);
  }
  return current.filter((row) => {
    const key = parcelKey(row);
    if (!key) return true;
    return newestForParcel.get(key) === stampOf(row);
  });
}

/** Load the cumulative, non-destructive property inspection for a card. */
export function loadPropertyInspection(cardId: number): PropertyInspectionRecord | null {
  const rows = getLandosDb()
    .prepare(`SELECT a.ref FROM landos_card_activity a
      WHERE a.card_id = ?
        AND a.kind IN ('property_inspection','landportal_inspection')
        AND NOT EXISTS (SELECT 1 FROM landos_quarantined_card_evidence q WHERE q.activity_id = a.id)
      ORDER BY a.created_at ASC, a.id ASC`)
    .all(cardId) as Array<{ ref: string }>;
  const parsedRows: PropertyInspectionRecord[] = [];
  for (const row of rows) try {
    const parsed = JSON.parse(row.ref) as PropertyInspectionRecord;
    if (!parsed || typeof parsed !== 'object') continue;
    parsedRows.push({
      parcelUrl: typeof parsed.parcelUrl === 'string' ? parsed.parcelUrl : null,
      parcelUrlRecord: parsed.parcelUrlRecord && typeof parsed.parcelUrlRecord === 'object' ? parsed.parcelUrlRecord : null,
      threeDCapture: parsed.threeDCapture && typeof parsed.threeDCapture === 'object' ? parsed.threeDCapture : null,
      comparablesUrl: typeof parsed.comparablesUrl === 'string' ? parsed.comparablesUrl : null,
      comparablesCapturedAt: typeof parsed.comparablesCapturedAt === 'string' ? parsed.comparablesCapturedAt : null,
      parcelFacts: parsed.parcelFacts && typeof parsed.parcelFacts === 'object' ? parsed.parcelFacts : {},
      assets: Array.isArray(parsed.assets) ? parsed.assets : [],
      overlays: Array.isArray(parsed.overlays) ? parsed.overlays : [],
      visualObservations: Array.isArray(parsed.visualObservations) ? parsed.visualObservations : [],
      comparables: Array.isArray(parsed.comparables) ? parsed.comparables : [],
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
      discoveryQuestions: Array.isArray(parsed.discoveryQuestions) ? parsed.discoveryQuestions : [],
      missingInformation: Array.isArray(parsed.missingInformation) ? parsed.missingInformation : [],
    });
  } catch { /* one corrupt historic activity must not hide other valid evidence */ }
  return mergePropertyInspections(parsedRows);
}

function retainedParcelUrlCandidates(value: unknown, pathName = ''): Array<{ url: string; path: string; verified: boolean; capturedAt: string | null }> {
  if (Array.isArray(value)) return value.flatMap((item, index) => retainedParcelUrlCandidates(item, `${pathName}[${index}]`));
  if (!value || typeof value !== 'object') return [];
  const obj = value as Record<string, unknown>;
  const pathLower = pathName.toLowerCase();
  if (/(?:market|comp|search|login|paid|report|skip)/i.test(pathLower)) return [];
  const verified = /parcel_match["']?\s*:\s*["']confirmed|verified["']?\s*:\s*true/i.test(JSON.stringify(obj));
  const capturedAt = ['capturedAtIso', 'capturedAt', 'finishedAt', 'timestamp', 'retrievedAt']
    .map((key) => obj[key])
    .find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0) ?? null;
  const direct = ['parcelUrl', 'pageUrl']
    .flatMap((key) => typeof obj[key] === 'string' ? [{ url: obj[key] as string, path: pathName ? `${pathName}.${key}` : key, verified: verified || key === 'parcelUrl', capturedAt }] : []);
  return [...direct, ...Object.entries(obj).flatMap(([key, child]) => retainedParcelUrlCandidates(child, pathName ? `${pathName}.${key}` : key))];
}

/** Promote an already retained, verified subject URL without running a provider. */
export function promoteRetainedLandPortalParcelUrl(cardId: number, dealCardId: number | null = null): LandPortalParcelUrlRecord | null {
  const current = loadPropertyInspection(cardId);
  const currentValidation = validateLandPortalSubjectUrl(current?.parcelUrlRecord?.url ?? current?.parcelUrl);
  const currentIdentity = currentValidation.identity;
  const dbRows = getLandosDb().prepare(
    `SELECT id, kind, ref, created_at FROM landos_card_activity
     WHERE card_id = ?
       AND kind IN ('property_inspection','landportal_inspection','landportal_browseruse_stage','landportal_browseruse')
     ORDER BY created_at ASC, id ASC`,
  ).all(cardId) as Array<{ id: number; kind: string; ref: string; created_at: number }>;
  const candidates: Array<{ url: string; source: string; verified: boolean; capturedAt: string }> = [];
  if (currentValidation.valid && currentValidation.canonicalUrl) {
    candidates.push({
      url: currentValidation.canonicalUrl,
      source: current?.parcelUrlRecord?.source ?? 'retained:property_inspection.parcelUrl',
      verified: current?.parcelUrlRecord?.verifiedSubject ?? true,
      capturedAt: current?.parcelUrlRecord?.capturedAt ?? new Date().toISOString(),
    });
  }
  for (const row of dbRows) {
    let parsed: unknown;
    try { parsed = JSON.parse(row.ref); } catch { continue; }
    for (const candidate of retainedParcelUrlCandidates(parsed)) {
      const validation = validateLandPortalSubjectUrl(candidate.url);
      if (!validation.valid || !validation.canonicalUrl || !candidate.verified) continue;
      if (currentIdentity && validation.identity && !sameLandPortalParcel(currentIdentity, validation.identity)) continue;
      const capturedAt = candidate.capturedAt ?? new Date(row.created_at * 1000).toISOString();
      candidates.push({ url: validation.canonicalUrl, source: `retained:activity:${row.id}:${row.kind}:${candidate.path}`, verified: true, capturedAt });
    }
  }
  const selected = candidates.filter((candidate) => candidate.verified).at(-1);
  if (!selected) return null;
  const validation = validateLandPortalSubjectUrl(selected.url);
  if (!validation.valid || !validation.identity) return null;
  const card = getPropertyCard(cardId);
  const record: LandPortalParcelUrlRecord = {
    url: selected.url,
    source: selected.source,
    capturedAt: selected.capturedAt,
    propertyCardId: cardId,
    dealCardId,
    verifiedSubject: true,
    apn: validation.identity.apn ?? (card?.apn ? String(card.apn) : null),
    fips: validation.identity.fips,
    propertyId: validation.identity.propertyId,
  };
  if (current?.parcelUrlRecord?.url === record.url
      && current.parcelUrlRecord.propertyCardId === record.propertyCardId
      && current.parcelUrlRecord.dealCardId === record.dealCardId) return current.parcelUrlRecord;
  savePropertyInspection(cardId, {
    parcelUrl: record.url,
    parcelUrlRecord: record,
    comparablesUrl: current?.comparablesUrl ?? null,
    parcelFacts: {},
    assets: [], overlays: [], visualObservations: [], comparables: [],
  });
  return record;
}

export function saveLandPortalInspection(cardId: number, inspection: PendingLandPortalInspectionRecord): void {
  savePropertyInspection(cardId, inspection);
}

export function loadLandPortalInspection(cardId: number): LandPortalInspectionRecord | null {
  return loadPropertyInspection(cardId);
}

export interface CardNextActionInput {
  cardId: number;
  action: string;
  createdBy?: string;
  dueDate?: string;
  assignedOwner?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  reminderAt?: string;
}

export function addCardNextAction(input: CardNextActionInput): number {
  return getLandosDb().prepare(
    `INSERT INTO landos_card_next_action
      (card_id, action, created_by, due_date, assigned_owner, priority, reminder_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.cardId,
    input.action,
    input.createdBy ?? '',
    input.dueDate ?? '',
    input.assignedOwner ?? '',
    input.priority ?? 'normal',
    input.reminderAt ?? '',
  ).lastInsertRowid as number;
}

export function setNextActionStatus(id: number, status: string): void {
  const now = Math.floor(Date.now() / 1000);
  getLandosDb().prepare('UPDATE landos_card_next_action SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
}

export function updateCardNextAction(
  cardId: number,
  id: number,
  patch: {
    action?: string;
    status?: 'open' | 'completed';
    dueDate?: string;
    assignedOwner?: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    reminderAt?: string;
  },
): boolean {
  const current = getLandosDb().prepare(
    'SELECT * FROM landos_card_next_action WHERE id = ? AND card_id = ?',
  ).get(id, cardId) as Record<string, unknown> | undefined;
  if (!current) return false;
  const now = Math.floor(Date.now() / 1000);
  const result = getLandosDb().prepare(
    `UPDATE landos_card_next_action SET
       action = ?, status = ?, due_date = ?, assigned_owner = ?, priority = ?, reminder_at = ?, updated_at = ?
     WHERE id = ? AND card_id = ?`,
  ).run(
    patch.action ?? String(current.action ?? ''),
    patch.status ?? String(current.status ?? 'open'),
    patch.dueDate ?? String(current.due_date ?? ''),
    patch.assignedOwner ?? String(current.assigned_owner ?? ''),
    patch.priority ?? String(current.priority ?? 'normal'),
    patch.reminderAt ?? String(current.reminder_at ?? ''),
    now,
    id,
    cardId,
  );
  return result.changes > 0;
}

export function deleteCardNextAction(cardId: number, id: number): boolean {
  return getLandosDb().prepare(
    'DELETE FROM landos_card_next_action WHERE id = ? AND card_id = ?',
  ).run(id, cardId).changes > 0;
}

/** Merge risk/anomaly flags into a card's open_risks (deduped). Returns the
 *  merged list. */
export function appendCardOpenRisks(cardId: number, risks: string[]): string[] {
  const db = getLandosDb();
  const card = getPropertyCardRow(cardId);
  if (!card) return [];
  const current = parseJsonArray(card.open_risks);
  for (const r of risks) {
    const v = (r ?? '').trim();
    if (v && !current.includes(v)) current.push(v);
  }
  const now = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE landos_property_card SET open_risks = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(current), now, cardId);
  return current;
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
  zip?: string;
  county?: string;
  state?: string;
  apn?: string;
  lpPropertyId?: string;
  fips?: string;
  lpUrl?: string;
  owner?: string;
  acres?: number;
  /** Verified-parcel coordinates (ENRICHMENT OUTPUT only — never identity). */
  lat?: number | null;
  lng?: number | null;
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
    zip: input.zip,
    county: input.county,
    state: input.state,
    apn: input.apn,
    lpPropertyId: input.lpPropertyId,
    fips: input.fips,
    lpUrl: input.lpUrl,
    owner: input.owner,
    acres: input.acres,
    lat: input.lat,
    lng: input.lng,
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
