// The derived-snapshot seam: one current reading per type, deduped on the
// input hash, superseded rather than overwritten.
//
// The defect class: a record that RETURNED to an earlier state (a seller
// communication removed, an upload withdrawn) produced a reading identical to
// a superseded row, the seam found that hash and wrote nothing, and the later,
// stale reading stayed current — carrying claims the record no longer held.
// The identical earlier reading is reinstated instead; the later row becomes
// history and nothing is deleted.

import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import { readDerivedSnapshotForParcel, writeDerivedSnapshot } from './derived-intelligence-store.js';
import { createPropertyIdentityVersion } from './property-summary-slice.js';

const DEAL = 77;
const TYPE = 'seller_discovery_v1';

function seedDeal(): void {
  const db = getLandosDb();
  db.prepare(`INSERT INTO landos_deal_card (id, entity, title, status) VALUES (?, 'TY_LAND_BIZ', 'Seam test', 'new')`).run(DEAL);
  createPropertyIdentityVersion({
    dealCardId: DEAL,
    status: 'confirmed',
    apn: '4870-90-2087',
    county: 'Iredell',
    state: 'NC',
    basis: 'Test identity.',
    confidence: 0.9,
    changeReason: 'seed',
    createdBy: 'test',
  });
}

const write = (payload: unknown) => writeDerivedSnapshot({
  dealCardId: DEAL,
  snapshotType: TYPE,
  payload,
  completeness: {},
  changeReason: 'test',
  actor: 'test',
});

const rows = () => getLandosDb().prepare(
  'SELECT id, status, version FROM landos_deal_intelligence_snapshot WHERE deal_card_id=? AND snapshot_type=? ORDER BY id',
).all(DEAL, TYPE) as Array<{ id: number; status: string; version: number }>;

describe('the derived-snapshot seam keeps the current reading true to the record', () => {
  beforeEach(() => {
    _initTestLandosDb();
    seedDeal();
  });

  it('an unchanged reading is reused, not rewritten', () => {
    const first = write({ claims: [] });
    const again = write({ claims: [] });
    expect(first.reused).toBe(false);
    expect(again).toMatchObject({ snapshotId: first.snapshotId, reused: true });
    expect(again.reinstated).toBeUndefined();
    expect(rows()).toHaveLength(1);
  });

  it('a changed reading supersedes the prior one and keeps it', () => {
    const first = write({ claims: [] });
    const second = write({ claims: ['$45,000'] });
    expect(second.reused).toBe(false);
    expect(rows()).toEqual([
      expect.objectContaining({ id: first.snapshotId, status: 'superseded' }),
      expect.objectContaining({ id: second.snapshotId, status: 'current' }),
    ]);
  });

  it('a record that returns to an earlier state reinstates the identical earlier reading, and the later one becomes history', () => {
    const first = write({ claims: [] });
    const second = write({ claims: ['$45,000'] });
    // The communication that carried the claim was removed.
    const back = write({ claims: [] });
    expect(back).toMatchObject({ snapshotId: first.snapshotId, reused: true, reinstated: true });
    expect(rows()).toEqual([
      expect.objectContaining({ id: first.snapshotId, status: 'current' }),
      expect.objectContaining({ id: second.snapshotId, status: 'superseded' }),
    ]);
    const current = readDerivedSnapshotForParcel<{ claims: string[] }>(DEAL, TYPE);
    expect(current?.value.claims).toEqual([]);
    // And the state is stable: the same reading again is a plain reuse.
    const onceMore = write({ claims: [] });
    expect(onceMore).toMatchObject({ snapshotId: first.snapshotId, reused: true });
    expect(onceMore.reinstated).toBeUndefined();
  });
});
