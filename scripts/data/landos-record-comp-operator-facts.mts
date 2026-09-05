#!/usr/bin/env tsx
// Record OPERATOR-SUPPLIED facts about a retained comparable, with attribution.
//
//   npx tsx scripts/data/landos-record-comp-operator-facts.mts [--apply]
//
// Two corrections for the Bradford County subject's comparable set, each
// carrying its own provenance so no operator statement is ever mistaken for a
// provider's own published fact:
//
//   1. 9249 W SR 100 (comp 1016) carries sheds, a pole barn, a workshop and a
//      driveway. Redfin publishes "Property Type: Land" and states none of
//      that, so the improvement facts are the operator's own observation. A
//      parcel carrying substantial buildings is not clean vacant-land evidence:
//      it is preserved as improved CONTEXT and kept out of the clean set.
//
//   2. That record's sale date is reported as December 20, 2025 by the retained
//      capture and December 30, 2025 by the live Redfin page. Two credible
//      sources disagreeing only about the day inside one month establish the
//      MONTH. The comp is retained at month precision with the conflict
//      recorded, never rejected over the discrepancy.

import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const APPLY = process.argv.includes('--apply');

const COMP_ID = 1016;
const OPERATOR_IMPROVEMENTS = 'Operator-observed improvements: sheds, a pole barn, a workshop and a driveway. '
  + 'Redfin publishes Property Type: Land and states none of these, so this is the operator\'s own '
  + 'observation, not a provider fact. A parcel carrying substantial buildings is improved context and '
  + 'is excluded from the clean vacant-land valuation set.';
const DATE_CONFLICT = 'Sale date reported as 2025-12-20 by the retained search capture and DEC 30, 2025 by the '
  + 'live Redfin record page. The sources agree on the month, so the date is carried at month precision '
  + '(December 2025) with the conflict recorded; the sale is retained, never rejected over the day.';

const db = new Database(path.join(ROOT, 'store', 'landos.db'));
const row = db.prepare('SELECT id, address_desc, property_class, sale_or_list_date, notes, classification FROM landos_comp WHERE id = ?').get(COMP_ID) as any;
if (!row) throw new Error(`comp ${COMP_ID} not found`);

console.log('BEFORE:');
console.log(`  address        : ${row.address_desc}`);
console.log(`  property_class : ${row.property_class}`);
console.log(`  sale date      : ${row.sale_or_list_date}`);
console.log(`  classification : ${row.classification}`);
console.log();
console.log('WOULD WRITE:');
console.log(`  property_class : improved`);
console.log(`  classification : improved_property_context`);
console.log(`  sale date      : 2025-12  (month precision)`);
console.log(`  notes          : ${OPERATOR_IMPROVEMENTS}`);
console.log(`                   ${DATE_CONFLICT}`);

if (!APPLY) { console.log('\nDry run. Re-run with --apply.'); process.exit(0); }

const notes = [row.notes, OPERATOR_IMPROVEMENTS, DATE_CONFLICT].filter(Boolean).join(' ');
db.prepare(`UPDATE landos_comp
   SET property_class = 'improved',
       classification = 'improved_property_context',
       sale_or_list_date = '2025-12',
       notes = ?,
       updated_at = strftime('%s','now')
 WHERE id = ?`).run(notes, COMP_ID);

const after = db.prepare('SELECT id, property_class, classification, sale_or_list_date FROM landos_comp WHERE id = ?').get(COMP_ID);
console.log('\nAFTER:', JSON.stringify(after));
console.log('integrity:', (db.prepare('PRAGMA integrity_check').get() as any).integrity_check);
db.close();
