#!/usr/bin/env tsx
// Why is each retained non-LandPortal candidate not in the valuation set?
//
// Walks the stages a candidate must clear — extraction, detail enrichment,
// coordinates, persistence, classification, closed-sale admission, geographic
// relevance, valuation selection, read-model presentation — and prints the FIRST
// stage each record fails, with the field that failed it. Read-only.
//
//   npx tsx scripts/qa/landos-comp-admission-trace.mts [dealCardId]

import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

import { readEnvFile } from '../../src/env.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const id = Number(process.argv[2] ?? 90);

const previousCwd = process.cwd();
process.chdir(ROOT);
let token = '';
try { token = readEnvFile(['DASHBOARD_TOKEN']).DASHBOARD_TOKEN ?? ''; } finally { process.chdir(previousCwd); }

const money = (n: unknown) => (typeof n === 'number' ? `$${n.toLocaleString('en-US')}` : 'null');
const pad = (s: unknown, n: number) => String(s ?? '').slice(0, n).padEnd(n);

const db = new Database(path.join(ROOT, 'store', 'landos.db'), { readonly: true, fileMustExist: true });

const rows = db.prepare(`
  SELECT id, address_desc, source_label, canonical_source, source_url, price, price_kind, acres,
         sale_or_list_date, status, classification, property_class, lat, lng, geo_lat, geo_lng,
         geo_precision, geo_tier, distance_miles, county, state, zip, valuation_selected,
         valuation_selection_reason, inclusion_reason, canonical_key, retrieved_at
    FROM landos_comp
   WHERE deal_card_id IN (SELECT id FROM landos_deal_card WHERE id=? OR canonical_deal_card_id=?)
     AND LOWER(COALESCE(source_label,'')||' '||COALESCE(canonical_source,'')||' '||COALESCE(source_url,''))
         NOT LIKE '%landportal%'
   ORDER BY id
`).all(id, id) as any[];

const res = await fetch(`http://localhost:3141/api/landos/deal-cards/${id}/comps-valuation?token=${encodeURIComponent(token)}`);
const body = await res.json() as any;
const cv = body.compsValuation;
const view = new Map<string, any>(cv.comps.map((c: any) => [String(c.key), c]));

const SUBJECT_MIN = 0.5;
const SUBJECT_MAX = 2.5;

/** The first gate this record fails on its way to the valuation set. */
function firstBlocker(row: any, wc: any): { stage: string; detail: string } {
  if (row.price == null || row.price <= 0) return { stage: '3 extraction', detail: 'no price extracted' };
  if (row.price_kind !== 'sale') return { stage: '8 closed-sale admission', detail: `price_kind=${row.price_kind} (not a closed sale)` };
  if (!row.sale_or_list_date) return { stage: '4 detail enrichment', detail: 'NO SALE DATE — never enriched from the record page' };
  if (row.acres == null || row.acres <= 0) return { stage: '4 detail enrichment', detail: 'no acreage' };
  if (row.lat == null || row.lng == null) return { stage: '5 coordinate recovery', detail: `no parcel coordinates (geo_precision=${row.geo_precision || 'none'})` };
  if (row.distance_miles == null) return { stage: '9 geographic relevance', detail: 'no distance (unresolved location)' };
  if (!wc) return { stage: '11 read model', detail: 'row not present in the workspace comp list' };
  if (wc.category !== 'accepted_closed_sale') return { stage: '7 classification', detail: `category=${wc.category} :: ${wc.classificationReason ?? ''}`.slice(0, 150) };
  if (!wc.inValuationSet) return { stage: '10 valuation selection', detail: wc.zeroWeightReason ?? wc.selectionMode ?? 'not selected' };
  return { stage: 'ADMITTED', detail: 'in the valuation set' };
}

console.log(`non-LandPortal candidates retained on the deal-90 family: ${rows.length}`);
console.log();
console.log(`${pad('id', 6)} ${pad('address', 42)} ${pad('price', 10)} ${pad('ac', 6)} ${pad('date', 11)} ${pad('first blocker', 26)} detail`);
const byStage = new Map<string, number>();
for (const row of rows) {
  const wc = view.get(`comp:${row.id}`);
  const b = firstBlocker(row, wc);
  byStage.set(b.stage, (byStage.get(b.stage) ?? 0) + 1);
  const band = row.acres != null && row.acres >= SUBJECT_MIN && row.acres <= SUBJECT_MAX ? '*' : ' ';
  console.log(`${pad(row.id, 6)} ${pad(row.address_desc, 42)} ${pad(money(row.price), 10)} ${pad(row.acres, 5)}${band} ${pad(row.sale_or_list_date, 11)} ${pad(b.stage, 26)} ${b.detail.slice(0, 90)}`);
}
console.log();
console.log('=== FIRST BLOCKER, BY STAGE ===');
for (const [stage, n] of [...byStage.entries()].sort()) console.log(`  ${pad(stage, 28)} ${n}`);
console.log();
console.log(`(* = acreage inside the ${SUBJECT_MIN}-${SUBJECT_MAX} acre band for a ${cv.subject?.acres ?? '?'}-acre subject)`);
const inBand = rows.filter((r) => r.acres != null && r.acres >= SUBJECT_MIN && r.acres <= SUBJECT_MAX);
console.log(`candidates already retained inside the band: ${inBand.length}`);
console.log(`of those, with a sale date: ${inBand.filter((r) => !!r.sale_or_list_date).length}`);
console.log(`of those, with real coordinates: ${inBand.filter((r) => r.lat != null).length}`);
db.close();
