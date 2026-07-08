import { beforeEach, describe, it, expect } from 'vitest';
import { _initTestLandosDb, getLandosDb } from './db.js';
import {
  createDealCard, listDealCards, listTrashedDealCards, getDealCardRow,
  softDeleteDealCard, restoreDealCard, hardDeleteDealCard,
} from './deal-card.js';

beforeEach(() => { _initTestLandosDb(); });

const mkCard = (title = 'Trash test deal') => createDealCard({ entity: 'TY_LAND_BIZ', title }).id;

describe('Deal Card Trash — soft delete', () => {
  it('moves the card to Trash: hidden from normal lists, shown in Trash, still fetchable', () => {
    const id = mkCard();
    expect(listDealCards().some((d) => d.id === id)).toBe(true);
    expect(listTrashedDealCards().length).toBe(0);

    const row = softDeleteDealCard(id);
    expect(row?.deleted_at).toBeTypeOf('number');
    // Disappears from normal boards/lists…
    expect(listDealCards().some((d) => d.id === id)).toBe(false);
    // …but is in Trash and still individually fetchable (for restore/detail).
    expect(listTrashedDealCards().some((d) => d.id === id)).toBe(true);
    expect(getDealCardRow(id)).toBeTruthy();
  });

  it('is idempotent — deleting an already-trashed card keeps the original timestamp', () => {
    const id = mkCard();
    const first = softDeleteDealCard(id)!.deleted_at;
    const second = softDeleteDealCard(id)!.deleted_at;
    expect(second).toBe(first);
    expect(listTrashedDealCards().filter((d) => d.id === id).length).toBe(1);
  });

  it('returns undefined for a non-existent card', () => {
    expect(softDeleteDealCard(9999)).toBeUndefined();
  });
});

describe('Deal Card Trash — restore', () => {
  it('restores a trashed card back to the normal list', () => {
    const id = mkCard();
    softDeleteDealCard(id);
    const restored = restoreDealCard(id);
    expect(restored?.deleted_at).toBeNull();
    expect(listDealCards().some((d) => d.id === id)).toBe(true);
    expect(listTrashedDealCards().some((d) => d.id === id)).toBe(false);
  });

  it('is a no-op on a card that is not in Trash', () => {
    const id = mkCard();
    expect(restoreDealCard(id)?.deleted_at).toBeNull();
    expect(listDealCards().some((d) => d.id === id)).toBe(true);
  });
});

describe('Deal Card Trash — permanent (hard) delete', () => {
  it('refuses to hard-delete a card that is NOT in Trash (soft delete first)', () => {
    const id = mkCard();
    expect(hardDeleteDealCard(id)).toBe(false);
    expect(getDealCardRow(id)).toBeTruthy(); // still present
  });

  it('permanently removes a trashed card AND its deal-scoped rows', () => {
    const id = mkCard();
    // A deal-scoped dependent row (resolution snapshot references deal_card_id).
    getLandosDb().prepare(
      'INSERT INTO landos_resolution_snapshot (deal_card_id, snapshot_json, updated_at) VALUES (?, ?, ?)',
    ).run(id, '{}', Math.floor(Date.now() / 1000));
    expect(getLandosDb().prepare('SELECT count(*) c FROM landos_resolution_snapshot WHERE deal_card_id = ?').get(id)).toMatchObject({ c: 1 });

    softDeleteDealCard(id);
    expect(hardDeleteDealCard(id)).toBe(true);

    expect(getDealCardRow(id)).toBeUndefined();
    expect(listTrashedDealCards().some((d) => d.id === id)).toBe(false);
    // Deal-scoped dependent rows are gone too (no orphans).
    expect(getLandosDb().prepare('SELECT count(*) c FROM landos_resolution_snapshot WHERE deal_card_id = ?').get(id)).toMatchObject({ c: 0 });
  });

  it('returns false for a non-existent card', () => {
    expect(hardDeleteDealCard(9999)).toBe(false);
  });
});

describe('Deal Card Trash — list isolation', () => {
  it('active and trash lists never overlap', () => {
    const a = mkCard('A'); const b = mkCard('B'); const cc = mkCard('C');
    softDeleteDealCard(b);
    const active = listDealCards().map((d) => d.id);
    const trashed = listTrashedDealCards().map((d) => d.id);
    expect(active).toEqual(expect.arrayContaining([a, cc]));
    expect(active).not.toContain(b);
    expect(trashed).toEqual([b]);
    expect(active.filter((id) => trashed.includes(id))).toEqual([]);
  });
});
