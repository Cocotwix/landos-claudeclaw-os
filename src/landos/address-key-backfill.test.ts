import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { recomputePropertyCardAddressKeys } from './db.js';
import { normalizeAddressKey } from './property-card.js';
import { normalizeAddressMatchKey } from './address-normalize.js';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE landos_property_card (
    id INTEGER PRIMARY KEY,
    active_input_address TEXT NOT NULL,
    address_key TEXT NOT NULL
  )`);
  return db;
}

describe('property-card address_key backfill', () => {
  it('recomputes stale keys under the canonical normalizer without touching addresses', () => {
    const db = makeDb();
    db.prepare('INSERT INTO landos_property_card (id, active_input_address, address_key) VALUES (?, ?, ?)')
      .run(1, '4713 sinking creek rd, London KY', '4713 sinking creek rd london ky');
    db.prepare('INSERT INTO landos_property_card (id, active_input_address, address_key) VALUES (?, ?, ?)')
      .run(2, '4713 Sinking Creek Road, London KY', '4713 sinking creek road london ky');

    expect(recomputePropertyCardAddressKeys(db)).toBeGreaterThan(0);

    const rows = db.prepare('SELECT id, active_input_address, address_key FROM landos_property_card ORDER BY id').all() as
      Array<{ id: number; active_input_address: string; address_key: string }>;
    // Both spellings now key to the same lead...
    expect(rows[0].address_key).toBe(rows[1].address_key);
    // ...and the operator's original address text is untouched.
    expect(rows[0].active_input_address).toBe('4713 sinking creek rd, London KY');
    expect(rows[1].active_input_address).toBe('4713 Sinking Creek Road, London KY');
    db.close();
  });

  it('is idempotent — a second run corrects nothing', () => {
    const db = makeDb();
    db.prepare('INSERT INTO landos_property_card (id, active_input_address, address_key) VALUES (?, ?, ?)')
      .run(1, '473 SEASIDE RD, Saint Helena Island SC', 'stale');
    expect(recomputePropertyCardAddressKeys(db)).toBe(1);
    expect(recomputePropertyCardAddressKeys(db)).toBe(0);
    db.close();
  });

  it('uses the same key definition the runtime lookup uses', () => {
    for (const address of ['4713 Sinking Creek Road', '1200 N Main St', '83 Bub Wise Rd., Swansea SC', '']) {
      expect(normalizeAddressMatchKey(address)).toBe(normalizeAddressKey(address));
    }
  });
});
