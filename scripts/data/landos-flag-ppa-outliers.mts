#!/usr/bin/env tsx
// Hold gross price-per-acre outliers out of the cleaned valuation set.
//
//   npx tsx scripts/data/landos-flag-ppa-outliers.mts [dealCardId] [--apply]
//
// WHY THIS EXISTS. The adopted cleaned FMV reconciles a weighted indication
// with the cleaned MEAN and median. A mean is fully exposed to one extreme
// record: a single 1-acre sale at $380,000/acre in a market whose other
// qualified sales run $9,500-$140,000/acre moved the non-LandPortal FMV by tens
// of thousands on its own.
//
// A price per acre several times the rest of the market is not a market fact.
// It is a signal that the record is something other than what it claims — an
// improved sale carrying a structure, a wrong acreage, or a bundled parcel —
// and none of those price this subject. LandOS cannot always verify which, so
// it does not assert a defect it has not evidenced: the record is held out of
// the cleaned set, stays fully visible with its reason, and is restorable.
//
// The comparison population is the SUBJECT ACREAGE BAND, never every sale on
// the deal. Price per acre falls with parcel size, so judging a 40-acre sale
// against 1-acre sales flags the acreage effect itself: on this deal that
// marked four ordinary large-parcel sales as "outliers" and missed the point.
//
// The rule is computed from the data, never from a named property. It needs a
// real set to be meaningful, so it does nothing below four qualified sales.

import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

import { valuationAcreageBand } from '../../src/landos/comp-recency-window.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const dealCardId = Number(process.argv[2] ?? 90);
const APPLY = process.argv.includes('--apply');

// HIGH SIDE ONLY, AND GENEROUSLY.
//
// The defect this catches is a record carrying value the land does not: an
// improved sale read as vacant, a wrong acreage, a bundled parcel. All of those
// push price per acre UP. Cheap land is not the same phenomenon — rural lots
// vary enormously on frontage, wetland, access and clearing, and a genuinely
// low sale is ordinary market evidence. A symmetric floor discarded a real
// $12,000/acre sale on those grounds, which is exactly the over-reach that made
// this market look thinner than it is.
//
// The multiple is deliberately generous so that only a record no land-quality
// story explains is held out.
const OUTLIER_MULTIPLE = 4;
/** Below this, "the rest of the market" is not established enough to judge. */
const MIN_QUALIFIED = 4;

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const money = (value: number) => `$${Math.round(value).toLocaleString('en-US')}`;

const db = new Database(path.join(ROOT, 'store', 'landos.db'));
const rows = db.prepare(`
  SELECT id, address_desc, source_url, price, acres, sale_or_list_date, valuation_selected, valuation_selection_actor
    FROM landos_comp
   WHERE deal_card_id = ? AND COALESCE(status,'') <> 'rejected'
     AND price_kind = 'sale' AND price > 0 AND acres > 0
     AND COALESCE(sale_or_list_date,'') <> ''
`).all(dealCardId) as any[];

// The subject's working acreage, from the deal's own subject card.
const subjectCard = db.prepare(`SELECT c.acres AS acres
    FROM landos_deal_card_property p JOIN landos_property_card c ON c.id = p.card_id
   WHERE p.deal_card_id = ? AND p.role = 'subject'`).get(dealCardId) as any;
const subjectAcres = Number(subjectCard?.acres);
const band = valuationAcreageBand(Number.isFinite(subjectAcres) ? subjectAcres : null);
if (!band) { console.log('no valuation acreage band for this subject; nothing is judged.'); db.close(); process.exit(0); }
console.log(`subject ${subjectAcres} acres -> valuation band ${band.label} (${band.min} to ${band.max} acres)`);

const qualified = rows.filter((row) => row.valuation_selected >= 0
  && Number(row.acres) >= band.min && Number(row.acres) <= band.max);
const ppa = (row: any) => Number(row.price) / Number(row.acres);
console.log(`qualified in-band closed sales on deal ${dealCardId}: ${qualified.length}`);
if (qualified.length < MIN_QUALIFIED) {
  console.log(`fewer than ${MIN_QUALIFIED} qualified sales; the rest of the market is not established, so nothing is judged.`);
  db.close(); process.exit(0);
}

const med = median(qualified.map(ppa)) as number;
const ceiling = med * OUTLIER_MULTIPLE;
console.log(`median price per acre: ${money(med)}  -> credible ceiling ${money(ceiling)} (${OUTLIER_MULTIPLE}x; no floor is applied)`);

const outliers = qualified.filter((row) => ppa(row) > ceiling);
console.log(`\ngross price-per-acre outliers: ${outliers.length}`);
for (const row of outliers) {
  console.log(`  comp ${String(row.id).padEnd(6)} "${row.address_desc}" ${money(row.price)} / ${row.acres} ac = ${money(ppa(row))}/acre  (${(ppa(row) / med).toFixed(1)}x the median)`);
}
if (!outliers.length || !APPLY) { console.log(APPLY ? '' : '\nDry run. Re-run with --apply.'); db.close(); process.exit(0); }

const apply = db.transaction(() => {
  for (const row of outliers) {
    const multiple = (ppa(row) / med).toFixed(1);
    const reason = `Price per acre is ${money(ppa(row))} against an in-band qualified-market median of ${money(med)} — ${multiple}x, beyond the ${OUTLIER_MULTIPLE}x credible ceiling for its acreage band. `
      + 'A sale several times the rest of its own acreage band carries value the land does not: an improved sale read as vacant, a wrong acreage, or a bundled parcel. None of those price this subject. '
      + 'LandOS has not evidenced which, so it asserts no defect: the sale is held out of the cleaned valuation set, stays fully visible with this reason, and is restorable.';
    db.prepare(`UPDATE landos_comp
       SET valuation_selected = -1,
           valuation_selection_reason = ?,
           valuation_selection_actor = 'landos/ppa-outlier-rule',
           valuation_selection_updated_at = strftime('%s','now'),
           updated_at = strftime('%s','now')
     WHERE id = ?`).run(reason, row.id);
  }
});
apply();
console.log('\napplied.');
for (const row of outliers) {
  console.log(`  ${JSON.stringify(db.prepare('SELECT id,valuation_selected,valuation_selection_actor FROM landos_comp WHERE id=?').get(row.id))}`);
}
console.log('integrity:', (db.prepare('PRAGMA integrity_check').get() as any).integrity_check);
db.close();
