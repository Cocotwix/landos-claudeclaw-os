// Deal Card create / edit / save / reload / update hardening.
//
// Proves the Deal Card record round-trips through the LandOS DB: a created card
// is read back via a FRESH query (not a cached object), edits persist, and a
// re-read reflects them. Production persists to the file-backed store/landos.db
// (gitignored); tests use the in-memory test DB, so durability is proven at the
// query level (every getDealCardRow call hits the DB).

import { beforeEach, describe, it, expect } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { createDealCard, updateDealCard, getDealCardRow, getDealCard, listDealCards } from './deal-card.js';

beforeEach(() => {
  _initTestLandosDb();
});

describe('Deal Card create/edit/save/reload/update', () => {
  it('creates a card and reads it back from a fresh DB query', () => {
    const created = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Seller A', sellerNotes: 'initial note' });
    expect(created.id).toBeGreaterThan(0);

    // "Reload": fresh query, not the returned object.
    const reloaded = getDealCardRow(created.id)!;
    expect(reloaded).toBeTruthy();
    expect(reloaded.title).toBe('Seller A');
    expect(reloaded.seller_notes).toBe('initial note');
    expect(reloaded.entity).toBe('TY_LAND_BIZ');
    expect(reloaded.status).toBe('new');
  });

  it('edits persist and a re-read reflects them', () => {
    const created = createDealCard({ entity: 'LAND_ALLY', title: 'Seller B' });
    const updated = updateDealCard(created.id, { title: 'Seller B (renamed)', status: 'researching', askingPrice: 42000 });
    expect(updated).toBeTruthy();

    const reloaded = getDealCardRow(created.id)!;
    expect(reloaded.title).toBe('Seller B (renamed)');
    expect(reloaded.status).toBe('researching');
    expect(reloaded.asking_price).toBe(42000);
  });

  it('partial updates do not clobber untouched fields', () => {
    const created = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Seller C', sellerNotes: 'keep me', askingPrice: 10000 });
    // Update only status; title/notes/price must survive.
    updateDealCard(created.id, { status: 'follow_up' });
    const reloaded = getDealCardRow(created.id)!;
    expect(reloaded.status).toBe('follow_up');
    expect(reloaded.title).toBe('Seller C');
    expect(reloaded.seller_notes).toBe('keep me');
    expect(reloaded.asking_price).toBe(10000);
  });

  it('a saved card appears in listDealCards and getDealCard detail', () => {
    const created = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Seller D' });
    const list = listDealCards({ entity: 'TY_LAND_BIZ' });
    expect(list.some((d) => d.id === created.id)).toBe(true);

    const detail = getDealCard(created.id)!;
    expect(detail.id).toBe(created.id);
    expect(detail.title).toBe('Seller D');
    // Research-mode card: no fabricated properties or people.
    expect(detail.propertyCards.length).toBe(0);
    expect(detail.people.length).toBe(0);
  });

  it('update of a missing card returns undefined and creates nothing', () => {
    const before = listDealCards({}).length;
    const res = updateDealCard(999999, { title: 'ghost' });
    expect(res).toBeUndefined();
    expect(listDealCards({}).length).toBe(before);
  });

  it('multiple sequential updates each persist (durable across reads)', () => {
    const created = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Seller E' });
    updateDealCard(created.id, { status: 'researching' });
    expect(getDealCardRow(created.id)!.status).toBe('researching');
    updateDealCard(created.id, { status: 'offer_ready' });
    expect(getDealCardRow(created.id)!.status).toBe('offer_ready');
    updateDealCard(created.id, { combinedStrategy: 'subdivide' });
    const final = getDealCardRow(created.id)!;
    expect(final.status).toBe('offer_ready');
    expect(final.combined_strategy).toBe('subdivide');
  });
});
