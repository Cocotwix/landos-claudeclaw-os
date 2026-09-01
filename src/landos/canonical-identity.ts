// LandOS — CANONICAL PROPERTY IDENTITY: one accepted identity, one precedence.
//
// A Deal Card carried TWO identity records that could disagree:
//
//   • the legacy verdict  (landos_parcel_identity)      — written when a parcel
//     is confirmed through Smart Intake / resolution;
//   • the versioned slice (landos_property_identity_version) — what the Property
//     Summary, government-records, zoning, imagery, comps, market, and strategy
//     eligibility projections all read.
//
// Confirming a parcel wrote the legacy verdict but did not always build the
// version. The Deal Card then showed a confirmed parcel at confidence 1.00 in one
// panel while another panel said the parcel was unverified and the pipeline was
// locked — two read models, one property, contradictory answers. Deal 32 (Roane
// County, TN) is the acceptance case; the defect is system-wide.
//
// This module is the single answer to "what identity is currently accepted?".
//
//   resolveCanonicalIdentity()  — PURE READ. Version first; when no version has
//     been built yet, the confirmed legacy verdict is PROJECTED from the accepted
//     property record. A GET never writes, so opening or refreshing a Deal Card
//     stays read-only, and no panel is left claiming "unresolved" about a parcel
//     the operator already accepted.
//
//   reconcileCanonicalIdentity() — WRITE, called at confirmation time and by
//     startup recovery. It builds the missing version so the durable read model
//     agrees with the accepted verdict.
//
// Historical unresolved attempts stay visible as history and are labeled
// superseded; they are never revoked and never presented as the current state.

import { getLandosDb } from './db.js';
import { getDealCard, updateDealCard } from './deal-card.js';
import { buildLeadCardTitle, isPlaceholderPropertyLabel } from './lead-identity.js';
import { getOpportunityByDealCardId, updateOpportunityTitle } from './opportunity.js';
import { readParcelIdentity, type ParcelIdentityRecord } from './parcel-identity.js';
import { readCurrentPropertyIdentity, type PropertyIdentityVersion, type PropertyIdentityStatus } from './property-summary-slice.js';

/** Where the currently accepted identity came from. */
export type CanonicalIdentitySource =
  | 'identity_version'          // the durable versioned slice
  | 'legacy_verdict_projection' // confirmed verdict, version not built yet
  | 'none';

export interface CanonicalIdentityView {
  dealCardId: number;
  status: PropertyIdentityStatus;
  /** True only for an accepted, confirmed canonical identity. */
  confirmed: boolean;
  source: CanonicalIdentitySource;
  propertyCardId: number | null;
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zip: string | null;
  apn: string | null;
  owner: string | null;
  acreage: number | null;
  lat: number | null;
  lng: number | null;
  basis: string;
  confidence: number;
  sourceRefs: string[];
  confirmedAt: number | null;
  /** True when the durable versioned slice has not been built for an already
   *  accepted identity — a reconciliation is owed, but the accepted identity is
   *  still authoritative for every projection right now. */
  versionPending: boolean;
  /** Row id of the durable identity version this view was built from, when one
   *  exists. The stable correlation key every consumer reports back. */
  versionId: number | null;
  /** Monotonic version number of that identity version. */
  versionNumber: number | null;
}

interface PropertyCardRow {
  id: number;
  active_input_address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zip: string | null;
  apn: string | null;
  owner: string | null;
  acres: number | null;
  lat: number | null;
  lng: number | null;
  verification_source: string | null;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The accepted property record behind a Deal Card's confirmed verdict. */
function subjectPropertyCard(dealCardId: number, subjectCardId: number | null): PropertyCardRow | null {
  const db = getLandosDb();
  if (subjectCardId != null) {
    const row = db.prepare('SELECT * FROM landos_property_card WHERE id = ?').get(subjectCardId) as PropertyCardRow | undefined;
    if (row) return row;
  }
  return (db.prepare(`
    SELECT pc.* FROM landos_property_card pc
    JOIN landos_deal_card_property dcp ON dcp.card_id = pc.id
    WHERE dcp.deal_card_id = ?
    ORDER BY CASE WHEN dcp.role = 'subject' THEN 0 ELSE 1 END, pc.id
    LIMIT 1
  `).get(dealCardId) as PropertyCardRow | undefined) ?? null;
}

function fromVersion(version: PropertyIdentityVersion, legacy: ParcelIdentityRecord | null, card: PropertyCardRow | null): CanonicalIdentityView {
  return {
    dealCardId: version.dealCardId,
    status: version.status,
    confirmed: version.status === 'confirmed',
    source: 'identity_version',
    propertyCardId: version.propertyCardId ?? card?.id ?? null,
    address: version.address ?? null,
    city: version.city ?? null,
    county: version.county ?? null,
    state: version.state ?? null,
    zip: version.zip ?? null,
    apn: version.apn ?? null,
    owner: version.owner ?? null,
    acreage: version.acreage ?? null,
    lat: card ? num(card.lat) : null,
    lng: card ? num(card.lng) : null,
    basis: version.basis,
    confidence: version.confidence,
    sourceRefs: version.sourceRefs,
    confirmedAt: legacy?.confirmedAt ?? null,
    versionPending: false,
    versionId: version.id,
    versionNumber: version.version,
  };
}

/**
 * PURE READ. The identity every Deal Card projection must evaluate from.
 *
 * Precedence: the versioned slice when one exists; otherwise the confirmed legacy
 * verdict projected from the accepted property record. Performs SELECTs only —
 * rendering or refreshing a Deal Card never writes and never triggers research.
 */
export function resolveCanonicalIdentity(dealCardId: number): CanonicalIdentityView {
  const legacy = readParcelIdentity(dealCardId);
  const card = subjectPropertyCard(dealCardId, legacy?.subjectCardId ?? null);
  const version = readCurrentPropertyIdentity(dealCardId);

  // A built version is the durable read model — unless it still says unresolved
  // while the operator has already accepted a confirmed verdict. In that case the
  // version is stale history, not the current state, and the accepted verdict
  // wins: a confirmed Deal Card never presents its identity as unverified.
  if (version && !(version.status !== 'confirmed' && legacy?.state === 'confirmed')) {
    return fromVersion(version, legacy, card);
  }

  if (legacy?.state === 'confirmed') {
    return {
      dealCardId,
      status: 'confirmed',
      confirmed: true,
      source: 'legacy_verdict_projection',
      propertyCardId: card?.id ?? legacy.subjectCardId ?? null,
      address: card ? text(card.active_input_address) : null,
      city: card ? text(card.city) : null,
      county: card ? text(card.county) : null,
      state: card ? text(card.state) : null,
      zip: card ? text(card.zip) : null,
      apn: card ? text(card.apn) : null,
      owner: card ? text(card.owner) : null,
      acreage: card ? num(card.acres) : null,
      lat: card ? num(card.lat) : null,
      lng: card ? num(card.lng) : null,
      basis: legacy.basis || (card ? `Parcel identity confirmed from ${card.verification_source ?? 'an approved parcel-level source'}.` : 'Parcel identity confirmed.'),
      confidence: legacy.confidence,
      sourceRefs: legacy.evidenceRefs,
      confirmedAt: legacy.confirmedAt,
      versionPending: true,
      // No durable version row exists yet, so there is no version id to report.
      // Consumers correlate on the subject-version token instead, which stays
      // stable for this accepted verdict until the version is built.
      versionId: null,
      versionNumber: null,
    };
  }

  const status: PropertyIdentityStatus = legacy?.state === 'candidate' ? 'candidate' : 'unresolved';
  return {
    dealCardId,
    status,
    confirmed: false,
    source: 'none',
    propertyCardId: card?.id ?? null,
    address: card ? text(card.active_input_address) : null,
    city: card ? text(card.city) : null,
    county: card ? text(card.county) : null,
    state: card ? text(card.state) : null,
    zip: card ? text(card.zip) : null,
    apn: null, owner: null, acreage: null, lat: null, lng: null,
    basis: legacy?.basis || 'Exact parcel identity has not been confirmed.',
    confidence: legacy?.confidence ?? 0,
    sourceRefs: legacy?.evidenceRefs ?? [],
    confirmedAt: null,
    versionPending: false,
    versionId: null,
    versionNumber: null,
  };
}

/** Convenience: is this Deal Card's canonical parcel identity accepted? Every
 *  eligibility gate (imagery, comps, valuation, strategy, market) asks THIS. */
export function isCanonicalIdentityConfirmed(dealCardId: number): boolean {
  return resolveCanonicalIdentity(dealCardId).confirmed;
}

/**
 * How a stale attempt should be presented once a canonical identity is accepted.
 * History is preserved and labeled, never deleted and never shown as current.
 */
export function supersessionLabel(input: {
  canonical: CanonicalIdentityView;
  attemptStatus: PropertyIdentityStatus | 'unverified' | 'no_match' | string;
  attemptAtSeconds?: number | null;
}): { superseded: boolean; label: string | null } {
  if (!input.canonical.confirmed) return { superseded: false, label: null };
  const stale = input.attemptStatus !== 'confirmed';
  if (!stale) return { superseded: false, label: null };
  return {
    superseded: true,
    label: 'Superseded — historical attempt, retained for provenance. The accepted canonical parcel identity supersedes it.',
  };
}

/** Deal Cards whose parcel identity was accepted but whose versioned Property
 *  Summary was never built. The reconciliation WRITE lives in the legacy adapter
 *  (which owns the synchronize path); this module stays a pure read so nothing on
 *  a GET can ever write. */
export function dealCardsAwaitingCanonicalReconciliation(): number[] {
  return (getLandosDb().prepare(`
    SELECT pi.deal_card_id AS dealCardId
    FROM landos_parcel_identity pi
    LEFT JOIN landos_property_identity_version v
      ON v.deal_card_id = pi.deal_card_id AND v.is_current = 1 AND v.status = 'confirmed'
    WHERE pi.state = 'confirmed' AND v.id IS NULL
    ORDER BY pi.deal_card_id
  `).all() as Array<{ dealCardId: number }>).map((r) => r.dealCardId);
}

/**
 * NAME the card from the parcel its canonical identity names.
 *
 * Intake names a Deal Card from whatever it could read, and a lead that arrived
 * with only a town is stored as "Unresolved parcel, Fairview, TN". Resolution
 * then established the parcel and wrote it to the property record, but nothing
 * carried that back to the label: the pipeline row and the Deal Card kept
 * announcing an unresolved parcel while the same screen printed the address,
 * the APN, the owner of record and the acreage.
 *
 * A NAME IS NOT A VERIFICATION CLAIM. It says which property the card is about,
 * which is why a research-grade CANDIDATE names its card too: "Map 042 Parcel
 * 123, Fairview, TN" is what the card's own address field already reads, while
 * "Unresolved parcel" is simply untrue of a parcel LandOS has resolved to an
 * APN. How strongly that identity is held stays where it belongs — the identity
 * panel, its status and its basis — and invariants 2-4 are untouched: nothing
 * here confirms a parcel, and a title never becomes evidence of one.
 *
 * A DISPUTED, rejected, archived or genuinely unresolved identity names nothing
 * and renames nothing: the honest placeholder stays until the disagreement is
 * settled.
 *
 * Called wherever an identity is established or reconciled, never from a GET.
 * Idempotent, and two SELECTs when there is nothing to do.
 *
 * The rename happens ONLY over a LandOS placeholder. A title that says anything
 * real — an address, an APN, or the operator's own words — is accepted operator
 * information and is never rewritten by a background lane;
 * `isPlaceholderPropertyLabel` is exactly the line between the two. The intake
 * record is untouched: `raw_input` still holds what the operator pasted.
 */
export function nameCardFromCanonicalIdentity(
  dealCardId: number,
  actor: string,
): { renamed: boolean; title: string | null; reason: string } {
  const canonical = resolveCanonicalIdentity(dealCardId);
  if (!(canonical.confirmed || canonical.status === 'candidate')) {
    return { renamed: false, title: null, reason: `The canonical identity is ${canonical.status}, so it names no parcel to name the card with.` };
  }

  // The identity's address falls back to the Deal Card title on some paths, so
  // a placeholder can arrive dressed as an address. Feeding it back in would
  // build "Unresolved parcel, Fairview, TN, Fairview, TN".
  const title = buildLeadCardTitle({
    address: isPlaceholderPropertyLabel(canonical.address) ? null : canonical.address,
    apn: canonical.apn,
    city: canonical.city,
    county: canonical.county,
    state: canonical.state,
  });
  // A parcel LandOS still cannot name keeps the honest placeholder it has.
  if (!title || isPlaceholderPropertyLabel(title)) {
    return { renamed: false, title: null, reason: 'The canonical identity carries no address or APN to name the card with.' };
  }

  let renamed = false;
  try {
    const deal = getDealCard(dealCardId) as { title?: string } | undefined;
    const dealTitle = typeof deal?.title === 'string' ? deal.title : null;
    if (deal && isPlaceholderPropertyLabel(dealTitle) && dealTitle !== title) {
      updateDealCard(dealCardId, { title });
      renamed = true;
    }
  } catch { /* the accepted identity is the record; the label is a projection of it */ }
  try {
    const opportunity = getOpportunityByDealCardId(dealCardId);
    if (opportunity && isPlaceholderPropertyLabel(opportunity.title) && opportunity.title !== title) {
      updateOpportunityTitle(opportunity.id, title, {
        actor,
        note: `Canonical property identity (${canonical.status}) names this parcel; the placeholder title "${opportunity.title}" was replaced with "${title}". The title names the property, not its verification state. Original intake retained in raw_input.`,
      });
      renamed = true;
    }
  } catch { /* the pipeline label never blocks the identity it describes */ }

  return {
    renamed,
    title,
    reason: renamed
      ? `The card is named from its ${canonical.status} canonical identity: "${title}".`
      : 'The card already carries a real name; a canonical identity never overwrites one.',
  };
}
