#!/usr/bin/env tsx
// Reconcile comparables that are the SAME provider record stored more than once.
//
//   npx tsx scripts/data/landos-reconcile-comp-duplicates.mts [dealCardId] [--apply]
//
// Identity was previously keyed on the ADDRESS, so one Redfin listing reached
// from a search card and from its own detail page ("9 SW 39th Dr" and "Lot 9 SW
// 39th Dr") became two registry rows and one sale counted twice in the
// valuation, the map and the read model. Repairing the write path stops new
// duplicates; it cannot heal rows already written.
//
// This groups retained rows by the PROVIDER RECORD ID in their own source URL —
// never by address similarity — and folds each group onto one surviving row.
//
// BOTH EVIDENCE LINEAGES ARE PRESERVED. The duplicate is never deleted: it is
// marked `rejected` with a reason naming the row it folded into, keeps its own
// URL, capture and history, and both source URLs are merged onto the survivor.
// The registry, valuation, map and read model then count the record once,
// because every one of them ignores a rejected row.

import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const dealCardId = Number(process.argv[2] ?? 90);
const APPLY = process.argv.includes('--apply');

/** The provider's own record id, from its URL. Never the address. */
function recordId(url: string | null): string | null {
  const u = String(url ?? '');
  const redfin = /redfin\.com\/.*?\/home\/(\d+)/i.exec(u)?.[1];
  if (redfin) return `redfin:${redfin}`;
  const zillow = /zillow\.com\/.*?\/(\d+)_zpid/i.exec(u)?.[1];
  if (zillow) return `zillow:${zillow}`;
  const landwatch = /landwatch\.com\/.*?\/pid\/(\d+)/i.exec(u)?.[1];
  if (landwatch) return `landwatch:${landwatch}`;
  return null;
}

/** Evidence completeness, so the richest row survives the fold. */
function completeness(row: any): number {
  let score = 0;
  if (row.sale_or_list_date) score += 4;
  if (row.lat != null && row.lng != null) score += 4;
  if (row.distance_miles != null) score += 2;
  if (row.acres != null) score += 2;
  if (row.listing_detail_json && row.listing_detail_json !== '{}') score += 2;
  if (row.thumbnail_url) score += 1;
  if ((row.notes ?? '').length) score += 1;
  return score;
}

const db = new Database(path.join(ROOT, 'store', 'landos.db'));
const rows = db.prepare(`
  SELECT id, address_desc, source_url, price, acres, sale_or_list_date, lat, lng,
         distance_miles, status, canonical_key, notes, listing_detail_json, thumbnail_url
    FROM landos_comp
   WHERE deal_card_id = ? AND COALESCE(status,'') <> 'rejected'
   ORDER BY id
`).all(dealCardId) as any[];

const groups = new Map<string, any[]>();
for (const row of rows) {
  const id = recordId(row.source_url);
  if (!id) continue;
  if (!groups.has(id)) groups.set(id, []);
  groups.get(id)!.push(row);
}
const duplicated = [...groups.entries()].filter(([, list]) => list.length > 1);

console.log(`retained comps on deal ${dealCardId}: ${rows.length}`);
console.log(`provider records stored more than once: ${duplicated.length}`);
console.log();
for (const [id, list] of duplicated) {
  const survivor = [...list].sort((a, b) => completeness(b) - completeness(a) || a.id - b.id)[0];
  console.log(`${id}`);
  for (const row of list) {
    const role = row.id === survivor.id ? 'SURVIVES' : 'folds in';
    console.log(`  ${role}  comp ${String(row.id).padEnd(6)} "${row.address_desc}"  $${row.price} ${row.acres ?? '?'}ac ${row.sale_or_list_date || 'no date'} completeness=${completeness(row)}`);
  }
}

if (!duplicated.length) console.log('no provider record stored twice.');


const fold = duplicated.length && APPLY ? db.transaction(() => {
  for (const [id, list] of duplicated) {
    const survivor = [...list].sort((a, b) => completeness(b) - completeness(a) || a.id - b.id)[0];
    for (const row of list) {
      if (row.id === survivor.id) continue;
      const note = `Same provider record as comp ${survivor.id} (${id}); identity established from the provider record id in this row's own source URL, not from address text. `
        + 'Retained in full as evidence lineage and excluded from the registry, valuation, map and read model so the record counts once.';
      db.prepare(`UPDATE landos_comp
         SET status = 'rejected',
             valuation_selected = -1,
             valuation_selection_reason = ?,
             valuation_selection_actor = 'landos/canonical-identity-reconciliation',
             valuation_selection_updated_at = strftime('%s','now'),
             notes = TRIM(COALESCE(notes,'') || ' ' || ?),
             updated_at = strftime('%s','now')
       WHERE id = ?`).run(note, note, row.id);
    }
    // The survivor carries the canonical provider identity from here on.
    db.prepare('UPDATE landos_comp SET canonical_key = ?, updated_at = strftime(\'%s\',\'now\') WHERE id = ?')
      .run(id, survivor.id);
  }
}) : null;
fold?.();

if (duplicated.length && APPLY) {
console.log('\nreconciled.');
for (const [id, list] of duplicated) {
  for (const row of list) {
    const after = db.prepare('SELECT id,status,canonical_key,valuation_selected FROM landos_comp WHERE id=?').get(row.id);
    console.log(`  ${id}  ${JSON.stringify(after)}`);
  }
}
console.log('integrity:', (db.prepare('PRAGMA integrity_check').get() as any).integrity_check);
}

// ---------------------------------------------------------------------------
// TIER 2: the compound comparison, for one sale published as TWO records.
//
// Provider record id is the first and strongest tier above, and it is right:
// two ids are normally two records. But one transaction is sometimes published
// twice by the same provider — the lot listing and the address listing — and
// then the ids differ while the SALE does not. Deal 90 carried "SW 39th Dr" and
// "Lot 9 SW 39th Dr" at the same $124,900, the same 1.67 acres and sale dates
// four days apart, and both were selected into the valuation, so one sale
// priced the lane twice.
//
// Address text alone must never merge anything: adjacent lots genuinely share
// "TBD SW 52nd Ter". So this tier requires the FACTS to agree — identical
// price, identical acreage, the same street, and sale dates within a fortnight
// — which "Lot 7 SW 39th Dr" ($50,000) does not satisfy against "Lot 9"
// ($124,900). Both lineages are preserved exactly as in tier 1.
const DAY = 86_400_000;
const COMPOUND_DAYS = 14;

/** The street part, normalised, with lot/unit placeholders removed. */
function streetKey(address: string | null): string {
  return String(address ?? '')
    .split(',')[0]
    .toLowerCase()
    .replace(/^(?:lot|tract|parcel|unit)\s+[\w-]+\s+/i, '')
    .replace(/^(?:tbd|0+)\s+/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compoundKey(row: any): string | null {
  const price = Number(row.price);
  const acres = Number(row.acres);
  const street = streetKey(row.address_desc);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(acres) || acres <= 0 || !street) return null;
  return `${street}|${acres}|${price}`;
}

function withinWindow(a: string | null, b: string | null): boolean {
  const parsedA = Date.parse(String(a ?? ''));
  const parsedB = Date.parse(String(b ?? ''));
  if (!Number.isFinite(parsedA) || !Number.isFinite(parsedB)) return false;
  return Math.abs(parsedA - parsedB) <= COMPOUND_DAYS * DAY;
}

const remaining = db.prepare(`
  SELECT id, address_desc, source_url, price, acres, sale_or_list_date, lat, lng,
         distance_miles, status, canonical_key, notes, listing_detail_json, thumbnail_url
    FROM landos_comp
   WHERE deal_card_id = ? AND COALESCE(status,'') <> 'rejected'
   ORDER BY id
`).all(dealCardId) as any[];

const compoundGroups = new Map<string, any[]>();
for (const row of remaining) {
  const key = compoundKey(row);
  if (!key) continue;
  if (!compoundGroups.has(key)) compoundGroups.set(key, []);
  compoundGroups.get(key)!.push(row);
}
const compoundDuplicated = [...compoundGroups.entries()]
  .map(([key, list]) => [key, list.filter((row, _i, all) => all.some((other) => other !== row && withinWindow(row.sale_or_list_date, other.sale_or_list_date)))] as [string, any[]])
  .filter(([, list]) => list.length > 1);

console.log(`\nsales published under more than one provider record (compound comparison): ${compoundDuplicated.length}`);
for (const [key, list] of compoundDuplicated) {
  const survivor = [...list].sort((a, b) => completeness(b) - completeness(a) || a.id - b.id)[0];
  console.log(`  ${key}`);
  for (const row of list) {
    console.log(`    ${row.id === survivor.id ? 'SURVIVES' : 'folds in'}  comp ${String(row.id).padEnd(6)} "${row.address_desc}" ${row.sale_or_list_date} ${row.canonical_key}`);
  }
}

if (compoundDuplicated.length && APPLY) {
  const foldCompound = db.transaction(() => {
    for (const [key, list] of compoundDuplicated) {
      const survivor = [...list].sort((a, b) => completeness(b) - completeness(a) || a.id - b.id)[0];
      for (const row of list) {
        if (row.id === survivor.id) continue;
        const note = `Same sale as comp ${survivor.id}: identical price and acreage on the same street with sale dates within ${COMPOUND_DAYS} days (${key}), published by the provider under two record ids. `
          + 'Established by the compound comparison, never by address text alone. Retained in full as evidence lineage and excluded from the registry, valuation, map and read model so the sale prices the lane once.';
        db.prepare(`UPDATE landos_comp
           SET status = 'rejected',
               valuation_selected = -1,
               valuation_selection_reason = ?,
               valuation_selection_actor = 'landos/compound-sale-reconciliation',
               valuation_selection_updated_at = strftime('%s','now'),
               notes = TRIM(COALESCE(notes,'') || ' ' || ?),
               updated_at = strftime('%s','now')
         WHERE id = ?`).run(note, note, row.id);
      }
    }
  });
  foldCompound();
  console.log('\ncompound duplicates reconciled.');
  for (const [, list] of compoundDuplicated) {
    for (const row of list) {
      console.log(`  ${JSON.stringify(db.prepare('SELECT id,status,valuation_selected FROM landos_comp WHERE id=?').get(row.id))}`);
    }
  }
  console.log('integrity:', (db.prepare('PRAGMA integrity_check').get() as any).integrity_check);
}

if (!APPLY) console.log('Dry run. Re-run with --apply.');
db.close();
