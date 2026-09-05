// Canonical Deal Card family resolution.
//
// After duplicate Deal Cards are canonicalized, one acquisition subject is
// represented by a canonical card plus its archived aliases. Most evidence is
// physically relinked onto the canonical card, but some rows deliberately CANNOT
// move: intake artifacts, intake links, land-use determinations and property
// evidence items are protected by immutability triggers, so they keep the alias
// Deal Card id they were written with.
//
// Those rows are still the canonical subject's evidence. This module resolves
// the family so a read path can reach them WITHOUT moving, rewriting,
// duplicating or weakening the immutability protection, and without ever
// widening into an unscoped union: membership is only ever the canonical card
// plus aliases whose `canonical_deal_card_id` resolves to exactly that card.

import type { Database } from 'better-sqlite3';

export interface DealFamily {
  /** The one active card that owns current output. */
  canonicalId: number;
  /** Archived duplicates that resolve to it. Empty for an ordinary card. */
  aliasIds: number[];
  /** canonicalId + aliasIds, for evidence reads. */
  familyIds: number[];
  /** True when the requested id was itself an archived alias. */
  requestedIsAlias: boolean;
}

/**
 * Resolve the canonical family for any Deal Card id.
 *
 * Passing an alias id resolves to the same family as passing the canonical id,
 * so an operator arriving on an archived route reads the canonical record.
 */
export function resolveDealFamily(db: Database, dealCardId: number): DealFamily {
  const row = db.prepare(
    'SELECT id, canonical_deal_card_id AS canonical FROM landos_deal_card WHERE id = ?',
  ).get(dealCardId) as { id: number; canonical: number | null } | undefined;

  if (!row) {
    return { canonicalId: dealCardId, aliasIds: [], familyIds: [dealCardId], requestedIsAlias: false };
  }

  // An alias points at its canonical card. A canonical card points at nothing.
  // Only one hop is followed: the migration always writes the terminal canonical
  // id, so a chain would mean corrupted data rather than deeper nesting.
  const canonicalId = row.canonical ?? row.id;
  const aliasIds = (db.prepare(
    'SELECT id FROM landos_deal_card WHERE canonical_deal_card_id = ? ORDER BY id',
  ).all(canonicalId) as Array<{ id: number }>).map((r) => r.id);

  return {
    canonicalId,
    aliasIds,
    familyIds: [canonicalId, ...aliasIds],
    requestedIsAlias: row.canonical != null,
  };
}

/**
 * A `deal_card_id IN (...)` fragment plus its bound parameters.
 *
 * Read paths use this instead of `deal_card_id = ?` so immutable alias-owned
 * evidence stays reachable. Ownership, lineage and timestamps on those rows are
 * untouched — only the query's reach changes.
 */
export function dealFamilyFilter(
  family: DealFamily,
  column = 'deal_card_id',
): { sql: string; params: number[] } {
  const placeholders = family.familyIds.map(() => '?').join(',');
  return { sql: `${column} IN (${placeholders})`, params: [...family.familyIds] };
}

export interface PropertyFamily {
  canonicalId: number;
  aliasIds: number[];
  familyIds: number[];
  requestedIsAlias: boolean;
}

/**
 * The canonical family for a PROPERTY card.
 *
 * Deal Cards and Property Cards were canonicalized together, but some records
 * are keyed by property card rather than deal card — the canonical research
 * record is one row per `property_card_id`. Those rows cannot be relinked
 * (the key is the identity), so the subject's research package stayed under the
 * alias property card that produced it while the canonical card kept an older
 * record of its own. Resolving the family is how the canonical card reaches it
 * without moving or duplicating anything.
 */
export function resolvePropertyFamily(db: Database, propertyCardId: number): PropertyFamily {
  const row = db.prepare(
    'SELECT id, canonical_property_card_id AS canonical FROM landos_property_card WHERE id = ?',
  ).get(propertyCardId) as { id: number; canonical: number | null } | undefined;

  if (!row) {
    return { canonicalId: propertyCardId, aliasIds: [], familyIds: [propertyCardId], requestedIsAlias: false };
  }
  const canonicalId = row.canonical ?? row.id;
  const aliasIds = (db.prepare(
    'SELECT id FROM landos_property_card WHERE canonical_property_card_id = ? ORDER BY id',
  ).all(canonicalId) as Array<{ id: number }>).map((r) => r.id);

  return {
    canonicalId,
    aliasIds,
    familyIds: [canonicalId, ...aliasIds],
    requestedIsAlias: row.canonical != null,
  };
}

/**
 * Read an alias-produced artifact as the canonical card's own.
 *
 * Canonicalization relinks retained research rows onto the canonical card, but
 * a snapshot PAYLOAD still names the alias card that produced it. A rerun that
 * compared the retained read's `dealCardId` with its own then refused to
 * promote: "Snapshot belongs to a different Deal Card", which left the
 * canonical card unable to ever get a current read again. Within one family
 * the alias-produced artifact IS the subject's artifact, so it is adopted under
 * the canonical id; anything outside the family is returned untouched so the
 * cross-card refusal still holds where it should.
 */
export function adoptFamilyArtifact<T extends { dealCardId: number }>(
  db: Database,
  dealCardId: number,
  artifact: T | null,
): T | null {
  if (!artifact || artifact.dealCardId === dealCardId) return artifact;
  const family = resolveDealFamily(db, dealCardId);
  if (family.canonicalId !== dealCardId || !family.aliasIds.includes(artifact.dealCardId)) return artifact;
  return { ...artifact, dealCardId };
}

/** True when this card must refuse writes because it is an archived duplicate. */
export function isArchivedAlias(db: Database, dealCardId: number): boolean {
  const row = db.prepare(
    'SELECT canonical_deal_card_id AS canonical FROM landos_deal_card WHERE id = ?',
  ).get(dealCardId) as { canonical: number | null } | undefined;
  return row?.canonical != null;
}

/**
 * Guard for every write path on a Deal Card.
 *
 * An archived alias may still be READ (its history is part of the subject's
 * record) but never edited, researched, valued or decided on: those all belong
 * to the canonical card, and allowing them would recreate the second active
 * opportunity that canonicalization just removed.
 */
export function assertWritableDealCard(db: Database, dealCardId: number): void {
  const family = resolveDealFamily(db, dealCardId);
  if (family.requestedIsAlias) {
    throw new Error(
      `Deal Card ${dealCardId} is an archived duplicate of Deal Card ${family.canonicalId}. `
      + 'Write to the canonical Deal Card instead.',
    );
  }
}
