import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  findActiveDealCardBySubject,
  getDealCardSubjectKey,
  rematchDealSubject,
  resolveDealCardForSubject,
} from './canonical-deal-resolution.js';

// A minimal stand-in for the columns this module actually reads and writes.
// The real schema is created by `createLandosSchema`; mirroring only the shape
// under test keeps the gate's contract legible and the test independent of
// unrelated schema churn.
function db(): Database.Database {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE landos_deal_card (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      title                  TEXT NOT NULL DEFAULT '',
      deleted_at             INTEGER,
      canonical_deal_card_id INTEGER REFERENCES landos_deal_card(id),
      subject_key            TEXT NOT NULL DEFAULT '',
      subject_key_basis      TEXT NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX idx_landos_deal_card_subject_active
      ON landos_deal_card(subject_key)
      WHERE subject_key <> '' AND canonical_deal_card_id IS NULL AND deleted_at IS NULL;
  `);
  return database;
}

function insertCard(database: Database.Database, title = ''): number {
  return database.prepare('INSERT INTO landos_deal_card (title) VALUES (?)').run(title)
    .lastInsertRowid as number;
}

const BRADFORD = { apn: '00083-A-03400', state: 'FL', county: 'Bradford', address: '19554 NW 137th Ln' };

describe('canonical subject resolution at intake', () => {
  let database: Database.Database;
  beforeEach(() => { database = db(); });

  it('creates a Deal Card for a subject nothing owns yet', () => {
    const resolution = resolveDealCardForSubject(database, BRADFORD, () => insertCard(database));
    expect(resolution.created).toBe(true);
    expect(resolution.key.basis).toBe('apn');
    expect(resolution.key.official).toBe(true);
    expect(getDealCardSubjectKey(database, resolution.dealCardId).key).toBe(resolution.key.key);
  });

  it('resolves a repeat submission onto the existing active card instead of duplicating it', () => {
    const first = resolveDealCardForSubject(database, BRADFORD, () => insertCard(database));
    let createdAgain = false;
    const second = resolveDealCardForSubject(database, BRADFORD, () => {
      createdAgain = true;
      return insertCard(database);
    });
    expect(second.created).toBe(false);
    expect(second.dealCardId).toBe(first.dealCardId);
    expect(second.resolvedFrom).toBe('existing_active_card');
    // The whole point: no second card was ever built.
    expect(createdAgain).toBe(false);
    expect(database.prepare('SELECT COUNT(*) AS n FROM landos_deal_card').get()).toEqual({ n: 1 });
  });

  it('matches the same parcel through APN formatting differences', () => {
    const first = resolveDealCardForSubject(database, BRADFORD, () => insertCard(database));
    const second = resolveDealCardForSubject(
      database,
      { ...BRADFORD, apn: '00083A03400' },
      () => insertCard(database),
    );
    expect(second.dealCardId).toBe(first.dealCardId);
  });

  it('matches a parcel whose APN absorbed the seller-stated acreage', () => {
    // The exact defect that created Deal 114: "00083-A-03400" + "1.5" acres.
    const first = resolveDealCardForSubject(database, BRADFORD, () => insertCard(database));
    const second = resolveDealCardForSubject(
      database,
      { ...BRADFORD, apn: '00083-A-034001.5' },
      () => insertCard(database),
    );
    expect(second.created).toBe(false);
    expect(second.dealCardId).toBe(first.dealCardId);
  });

  it('keeps a genuinely distinct partial conveyance separate from the whole parcel', () => {
    const whole = resolveDealCardForSubject(database, BRADFORD, () => insertCard(database));
    const partial = resolveDealCardForSubject(
      database,
      { ...BRADFORD, scope: { kind: 'partial', label: '1.5-acre conveyed portion' } },
      () => insertCard(database),
    );
    expect(partial.created).toBe(true);
    expect(partial.dealCardId).not.toBe(whole.dealCardId);
  });

  it('resolves the APN answer for an address-only lead onto the card that asked for it', () => {
    // Address-only intake: LandOS keys the card provisionally and asks for the
    // parcel number. The operator answers through the same New Lead path with
    // the same address plus the APN. That must resume the waiting card, never
    // open a second active card for the same subject.
    const waiting = resolveDealCardForSubject(
      database,
      { address: '4210 Release Harness Rd, Testville, NC', state: 'NC' },
      () => insertCard(database),
    );
    expect(waiting.key.basis).toBe('provisional_address');
    let createdAgain = false;
    const answered = resolveDealCardForSubject(
      database,
      { address: '4210 Release Harness Rd, Testville, NC', state: 'NC', county: 'Test County', zip: '28752', apn: '0771-00-11-5566' },
      () => { createdAgain = true; return insertCard(database); },
    );
    expect(createdAgain).toBe(false);
    expect(answered.created).toBe(false);
    expect(answered.dealCardId).toBe(waiting.dealCardId);
    expect(answered.resolvedFrom).toBe('provisional_card_rematched');
    // The card now holds the official key, so the next repeat resolves by APN.
    expect(getDealCardSubjectKey(database, waiting.dealCardId)).toEqual(answered.key);
    const repeat = resolveDealCardForSubject(
      database,
      { address: '4210 RELEASE HARNESS RD, TESTVILLE, NC', state: 'NC', county: 'Test', apn: '0771 00 11 5566' },
      () => insertCard(database),
    );
    expect(repeat.dealCardId).toBe(waiting.dealCardId);
    expect(repeat.resolvedFrom).toBe('existing_active_card');
    expect(database.prepare('SELECT COUNT(*) AS n FROM landos_deal_card').get()).toEqual({ n: 1 });
  });

  it('does not rematch a provisional card onto a different partial-conveyance scope', () => {
    const whole = resolveDealCardForSubject(
      database,
      { address: '19554 NW 137th Ln', state: 'FL' },
      () => insertCard(database),
    );
    const partial = resolveDealCardForSubject(
      database,
      { ...BRADFORD, scope: { kind: 'partial', label: '1.5-acre conveyed portion' } },
      () => insertCard(database),
    );
    expect(partial.created).toBe(true);
    expect(partial.dealCardId).not.toBe(whole.dealCardId);
  });

  it('still creates a card when the subject cannot be keyed at all', () => {
    const resolution = resolveDealCardForSubject(database, { address: null, apn: null }, () => insertCard(database));
    expect(resolution.created).toBe(true);
    expect(resolution.key.basis).toBe('none');
    // Unkeyed, therefore unconstrained: losing the lead would be worse.
    expect(getDealCardSubjectKey(database, resolution.dealCardId).key).toBe('');
  });

  it('does not resolve two unkeyable leads onto one another', () => {
    const first = resolveDealCardForSubject(database, { apn: null }, () => insertCard(database));
    const second = resolveDealCardForSubject(database, { apn: null }, () => insertCard(database));
    expect(second.dealCardId).not.toBe(first.dealCardId);
  });

  it('refuses to key prose that a parser mistook for an address', () => {
    // Three Marion NC cards shared the key "parcel number and i am not".
    const resolution = resolveDealCardForSubject(
      database,
      { address: 'parcel number and i am not', state: 'NC' },
      () => insertCard(database),
    );
    expect(resolution.key.basis).toBe('none');
  });

  it('leaves an archived alias free to hold its own historical key', () => {
    const canonical = resolveDealCardForSubject(database, BRADFORD, () => insertCard(database));
    const alias = insertCard(database, 'archived duplicate');
    database.prepare('UPDATE landos_deal_card SET canonical_deal_card_id = ?, subject_key = ?, subject_key_basis = ? WHERE id = ?')
      .run(canonical.dealCardId, getDealCardSubjectKey(database, canonical.dealCardId).key, 'apn', alias);
    // The unique index is scoped to ACTIVE CANONICAL cards, so the alias keeping
    // its history does not collide with the card it resolves to.
    expect(findActiveDealCardBySubject(database, getDealCardSubjectKey(database, canonical.dealCardId).key))
      .toBe(canonical.dealCardId);
  });

  it('frees a subject when its card is trashed', () => {
    const first = resolveDealCardForSubject(database, BRADFORD, () => insertCard(database));
    database.prepare('UPDATE landos_deal_card SET deleted_at = 1 WHERE id = ?').run(first.dealCardId);
    const second = resolveDealCardForSubject(database, BRADFORD, () => insertCard(database));
    expect(second.created).toBe(true);
    expect(second.dealCardId).not.toBe(first.dealCardId);
  });
});

describe('rematch after an identity correction', () => {
  let database: Database.Database;
  beforeEach(() => { database = db(); });

  it('claims the corrected subject key when it is free', () => {
    const provisional = resolveDealCardForSubject(
      database,
      { address: '19554 NW 137th Ln', state: 'FL' },
      () => insertCard(database),
    );
    expect(provisional.key.basis).toBe('provisional_address');
    const outcome = rematchDealSubject(database, provisional.dealCardId, BRADFORD);
    expect(outcome.changed).toBe(true);
    expect(outcome.key.basis).toBe('apn');
    expect(outcome.collidesWithDealCardId).toBeUndefined();
  });

  it('reports a collision instead of archiving a card on its own', () => {
    const owner = resolveDealCardForSubject(database, BRADFORD, () => insertCard(database));
    const provisional = resolveDealCardForSubject(
      database,
      { address: '19554 NW 137th Ln', state: 'FL' },
      () => insertCard(database),
    );
    const outcome = rematchDealSubject(database, provisional.dealCardId, BRADFORD);
    expect(outcome.collidesWithDealCardId).toBe(owner.dealCardId);
    expect(outcome.changed).toBe(false);
    // Nothing was archived and nothing moved: that decision is the operator's.
    const alias = database.prepare('SELECT canonical_deal_card_id AS c FROM landos_deal_card WHERE id = ?')
      .get(provisional.dealCardId) as { c: number | null };
    expect(alias.c).toBeNull();
  });

  it('is a no-op when the identity did not actually change', () => {
    const card = resolveDealCardForSubject(database, BRADFORD, () => insertCard(database));
    const outcome = rematchDealSubject(database, card.dealCardId, BRADFORD);
    expect(outcome.changed).toBe(false);
    expect(outcome.collidesWithDealCardId).toBeUndefined();
  });
});
