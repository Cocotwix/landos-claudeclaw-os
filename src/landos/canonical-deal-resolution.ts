// Intake-side canonical subject resolution.
//
// `canonical-subject-identity` decides WHETHER two records describe the same
// acquisition subject. `canonical-deal-family` resolves an already-canonicalized
// family for reads. This module is the missing third piece: the gate that runs
// BEFORE a Deal Card is created, so a second active card for one subject is
// never born in the first place.
//
// Three separate cards existed for one Bradford County parcel because the New
// Lead path created a Deal Card unconditionally and only reconciled identity
// afterwards, fire-and-forget. Property Cards were deduplicated; Deal Cards were
// not. Nothing consulted whether the resolved property already had an active
// card, and nothing revisited the question once a corrected APN arrived.
//
// The repair is deliberately narrow:
//   * resolve the subject key before creating the card;
//   * an existing ACTIVE CANONICAL card for that key is RESOLVED onto, not
//     duplicated;
//   * a UNIQUE partial index makes SQLite, not application timing, the arbiter
//     of two overlapping submissions;
//   * a provisional key is reversible and rematched when an official APN lands.
//
// What it must NOT do: collapse genuinely distinct acquisitions. A partial
// conveyance, a split boundary and an assemblage each carry their own scope in
// the key, so they stay separate subjects on the same parent APN.

import type { Database } from 'better-sqlite3';

import { subjectKey, type SubjectIdentityInput, type SubjectKey } from './canonical-subject-identity.js';

export interface SubjectResolution {
  dealCardId: number;
  /** False when an existing active card already owned this subject. */
  created: boolean;
  key: SubjectKey;
  /** Why an existing card was used, when one was. */
  resolvedFrom?: 'existing_active_card' | 'concurrent_insert' | 'provisional_card_rematched';
}

/** SQLite reports a violated UNIQUE index this way, whatever the column. */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
}

/**
 * The one active canonical Deal Card holding this subject key, if any.
 *
 * Archived aliases and trashed cards are excluded deliberately: an alias is
 * history that already resolves elsewhere, and a trashed card has released its
 * subject so the operator can start the deal over.
 */
export function findActiveDealCardBySubject(db: Database, key: string): number | undefined {
  if (!key) return undefined;
  const row = db.prepare(
    `SELECT id FROM landos_deal_card
       WHERE subject_key = ? AND canonical_deal_card_id IS NULL AND deleted_at IS NULL
       ORDER BY id LIMIT 1`,
  ).get(key) as { id: number } | undefined;
  return row?.id;
}

/** Read a card's stored subject key. */
export function getDealCardSubjectKey(db: Database, dealCardId: number): SubjectKey {
  const row = db.prepare(
    'SELECT subject_key AS key, subject_key_basis AS basis FROM landos_deal_card WHERE id = ?',
  ).get(dealCardId) as { key: string; basis: string } | undefined;
  if (!row || !row.key) return { key: '', basis: 'none', official: false };
  return { key: row.key, basis: row.basis as SubjectKey['basis'], official: row.basis === 'apn' };
}

/**
 * Resolve the acquisition subject to exactly one active Deal Card.
 *
 * `createCard` is invoked only when no active card owns the subject yet. It runs
 * inside the same transaction as the claim, so a card is never created without
 * its key or left holding a key it lost a race for.
 *
 * A subject LandOS cannot key at all (`basis: 'none'`) is still allowed to
 * create a card — refusing the lead would lose it. That card simply carries a
 * blank key, is not constrained, and is rematched by {@link rematchDealSubject}
 * as soon as identity evidence arrives.
 */
export function resolveDealCardForSubject(
  db: Database,
  input: SubjectIdentityInput,
  createCard: () => number,
): SubjectResolution {
  const key = subjectKey(input);

  const claim = db.transaction((): SubjectResolution => {
    if (key.basis !== 'none') {
      const existing = findActiveDealCardBySubject(db, key.key);
      if (existing !== undefined) {
        return { dealCardId: existing, created: false, key, resolvedFrom: 'existing_active_card' };
      }
    }
    // The identifier arriving for a card that was waiting for it. An
    // address-only lead is keyed provisionally and asks the operator for the
    // parcel number; when the answer comes back through the same New Lead path
    // (same address, now with the APN), the official key is new and no card
    // holds it yet — so this used to create a SECOND active card for the same
    // subject, beside the provisional one still asking its question. The
    // provisional card is the subject's card: claim the official key for it
    // and resolve onto it, so the answer resumes that card's lifecycle.
    if (key.official) {
      // The waiting card was keyed from what the FIRST submission carried; the
      // answer may add a ZIP the question never had, so both spellings of the
      // provisional key are tried.
      const candidates = [subjectKey({ ...input, apn: null }), subjectKey({ ...input, apn: null, zip: null })]
        .filter((candidate, index, all) => candidate.basis !== 'none'
          && all.findIndex((other) => other.key === candidate.key) === index);
      for (const provisional of candidates) {
        const waiting = findActiveDealCardBySubject(db, provisional.key);
        if (waiting === undefined) continue;
        db.prepare('UPDATE landos_deal_card SET subject_key = ?, subject_key_basis = ? WHERE id = ?')
          .run(key.key, key.basis, waiting);
        return { dealCardId: waiting, created: false, key, resolvedFrom: 'provisional_card_rematched' };
      }
    }
    const dealCardId = createCard();
    if (key.basis !== 'none') {
      db.prepare('UPDATE landos_deal_card SET subject_key = ?, subject_key_basis = ? WHERE id = ?')
        .run(key.key, key.basis, dealCardId);
    }
    return { dealCardId, created: true, key };
  });

  try {
    return claim.immediate();
  } catch (error) {
    // Another submission claimed the same subject between our SELECT and our
    // UPDATE. The index did its job; adopt the winner rather than retrying into
    // a second card.
    if (isUniqueViolation(error) && key.basis !== 'none') {
      const winner = findActiveDealCardBySubject(db, key.key);
      if (winner !== undefined) {
        return { dealCardId: winner, created: false, key, resolvedFrom: 'concurrent_insert' };
      }
    }
    throw error;
  }
}

export interface RematchOutcome {
  /** The key now stored on the card. */
  key: SubjectKey;
  /** True when the card moved from one subject key to another. */
  changed: boolean;
  /**
   * Set when the corrected identity proves this card is a duplicate of an
   * existing active card. The caller decides how to canonicalize; this module
   * never archives a card on its own, because that moves operator evidence.
   */
  collidesWithDealCardId?: number;
}

/**
 * Re-derive a card's subject key after its identity was corrected.
 *
 * This is the step whose absence left three active cards for one parcel: each
 * card's APN WAS eventually corrected, and nothing revisited the duplicate
 * question afterwards. It claims the corrected key when it is free, and reports
 * a collision when it is not — it does not archive, merge or move anything.
 */
export function rematchDealSubject(
  db: Database,
  dealCardId: number,
  input: SubjectIdentityInput,
): RematchOutcome {
  const next = subjectKey(input);
  const previous = getDealCardSubjectKey(db, dealCardId);
  if (next.basis === 'none' || next.key === previous.key) return { key: previous, changed: false };

  const holder = findActiveDealCardBySubject(db, next.key);
  if (holder !== undefined && holder !== dealCardId) {
    return { key: previous, changed: false, collidesWithDealCardId: holder };
  }
  db.prepare('UPDATE landos_deal_card SET subject_key = ?, subject_key_basis = ? WHERE id = ?')
    .run(next.key, next.basis, dealCardId);
  return { key: next, changed: true };
}
