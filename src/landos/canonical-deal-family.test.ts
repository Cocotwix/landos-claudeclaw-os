import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  adoptFamilyArtifact,
  assertWritableDealCard,
  dealFamilyFilter,
  isArchivedAlias,
  resolveDealFamily,
} from './canonical-deal-family.js';

// A minimal stand-in for the deal-card table plus one immutable evidence table,
// so the family reach is proven on the same shape the migration produced: the
// evidence row keeps its ORIGINAL alias deal_card_id and is never rewritten.
function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE landos_deal_card (
      id INTEGER PRIMARY KEY,
      canonical_deal_card_id INTEGER REFERENCES landos_deal_card(id),
      archived_as_duplicate_at INTEGER
    );
    CREATE TABLE landos_property_evidence_item (
      id INTEGER PRIMARY KEY,
      deal_card_id INTEGER NOT NULL,
      fact_key TEXT NOT NULL
    );
    INSERT INTO landos_deal_card (id, canonical_deal_card_id, archived_as_duplicate_at)
      VALUES (90, NULL, NULL), (114, 90, 1000), (115, 90, 1000), (200, NULL, NULL);
    INSERT INTO landos_property_evidence_item (id, deal_card_id, fact_key) VALUES
      (1, 90,  'own'),
      (2, 114, 'immutable_on_alias_114'),
      (3, 115, 'immutable_on_alias_115'),
      (4, 200, 'unrelated_deal');
  `);
  return db;
}

describe('canonical deal family', () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => { db = makeDb(); });

  it('resolves the canonical card to itself plus its archived aliases', () => {
    const family = resolveDealFamily(db, 90);
    expect(family.canonicalId).toBe(90);
    expect(family.aliasIds).toEqual([114, 115]);
    expect(family.familyIds).toEqual([90, 114, 115]);
    expect(family.requestedIsAlias).toBe(false);
  });

  it('adopts an alias-produced artifact as the canonical card\'s own, and nothing outside the family', () => {
    // The retained Property Intelligence read on Deal 90 was produced under
    // alias 115; a rerun on 90 must merge with it instead of refusing it.
    const fromAlias = adoptFamilyArtifact(db, 90, { dealCardId: 115, runId: 'pi_alias' });
    expect(fromAlias).toEqual({ dealCardId: 90, runId: 'pi_alias' });
    const own = { dealCardId: 90, runId: 'pi_own' };
    expect(adoptFamilyArtifact(db, 90, own)).toBe(own);
    // An unrelated card's artifact keeps its id, so the cross-card refusal holds.
    const unrelated = { dealCardId: 200, runId: 'pi_other' };
    expect(adoptFamilyArtifact(db, 90, unrelated)).toBe(unrelated);
    // An alias never adopts anything: it owns no current lifecycle.
    const onAlias = { dealCardId: 90, runId: 'pi_canonical' };
    expect(adoptFamilyArtifact(db, 115, onAlias)).toBe(onAlias);
    expect(adoptFamilyArtifact(db, 90, null)).toBeNull();
  });

  it('resolves an archived alias to the same family as the canonical card', () => {
    const fromAlias = resolveDealFamily(db, 115);
    expect(fromAlias.canonicalId).toBe(90);
    expect(fromAlias.familyIds).toEqual([90, 114, 115]);
    expect(fromAlias.requestedIsAlias).toBe(true);
  });

  it('reaches immutable alias-owned evidence without moving or rewriting it', () => {
    const family = resolveDealFamily(db, 90);
    const filter = dealFamilyFilter(family);
    const rows = db.prepare(
      `SELECT fact_key FROM landos_property_evidence_item WHERE ${filter.sql} ORDER BY id`,
    ).all(...filter.params) as Array<{ fact_key: string }>;

    expect(rows.map((r) => r.fact_key)).toEqual([
      'own', 'immutable_on_alias_114', 'immutable_on_alias_115',
    ]);
    // The evidence rows still carry their ORIGINAL owner - reach changed, data did not.
    const owners = db.prepare(
      'SELECT deal_card_id FROM landos_property_evidence_item ORDER BY id',
    ).all() as Array<{ deal_card_id: number }>;
    expect(owners.map((o) => o.deal_card_id)).toEqual([90, 114, 115, 200]);
  });

  it('never widens into an unscoped union', () => {
    const family = resolveDealFamily(db, 90);
    const filter = dealFamilyFilter(family);
    const rows = db.prepare(
      `SELECT fact_key FROM landos_property_evidence_item WHERE ${filter.sql}`,
    ).all(...filter.params) as Array<{ fact_key: string }>;
    // Deal 200 is a different subject and must never appear.
    expect(rows.some((r) => r.fact_key === 'unrelated_deal')).toBe(false);
  });

  it('leaves an ordinary card as a family of one', () => {
    const family = resolveDealFamily(db, 200);
    expect(family.familyIds).toEqual([200]);
    expect(family.aliasIds).toEqual([]);
  });

  it('blocks writes to an archived alias and allows them on the canonical card', () => {
    expect(isArchivedAlias(db, 115)).toBe(true);
    expect(isArchivedAlias(db, 90)).toBe(false);
    expect(() => assertWritableDealCard(db, 115)).toThrow(/archived duplicate of Deal Card 90/);
    expect(() => assertWritableDealCard(db, 90)).not.toThrow();
  });
});
