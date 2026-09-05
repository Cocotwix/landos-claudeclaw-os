#!/usr/bin/env tsx
// Run the Redfin sold-land lane and persist its candidates through the shared
// canonical comp writer. Redfin only: no Zillow, no Realtor, no manufactured
// lane, no Property Intelligence cycle.
//
//   npx tsx scripts/qa/landos-redfin-persist.mts [dealCardId] [--apply]

import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

import { fetchRedfinLandComps } from '../../src/landos/redfin-land-comps.js';
import { upsertNormalizedComp } from '../../src/landos/comps.js';
import { getDealCard } from '../../src/landos/deal-card.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const dealCardId = Number(process.argv[2] ?? 90);
const APPLY = process.argv.includes('--apply');

const SUBJECT = {
  address: '19554 NW 137th Ln', city: 'Lake Butler', county: 'Bradford', state: 'FL',
  zip: '32054', apn: '00083A03400', subjectAcres: 1.5, mode: 'sold' as const,
  lat: 30.001566331787483, lng: -82.27218446874652,
};

const deal = getDealCard(dealCardId);
if (!deal) throw new Error(`deal ${dealCardId} not found`);

const db = new Database(path.join(ROOT, 'store', 'landos.db'), { readonly: true });
const cardRow = db.prepare("SELECT card_id FROM landos_deal_card_property WHERE deal_card_id=? AND role='subject'").get(dealCardId) as any;
const before = (db.prepare('SELECT COUNT(*) n FROM landos_comp WHERE deal_card_id=?').get(dealCardId) as any).n;
db.close();
const cardId = cardRow?.card_id as number | undefined;

const result = await fetchRedfinLandComps(SUBJECT as never, { force: true, timeoutMs: 90_000 } as never);
console.log(`lane status : ${result.status}`);
console.log(`candidates  : ${result.comps?.length ?? 0}`);
console.log(`note        : ${String(result.note ?? '').slice(0, 500)}`);
console.log(`comps before: ${before}`);
console.log();

const sold = (result.comps ?? []).filter((c: any) => c.status === 'sold' && typeof c.price === 'number' && c.price > 0);
console.log(`sold candidates to persist: ${sold.length}`);
if (!APPLY) {
  for (const c of sold as any[]) {
    console.log(`  ${String(c.address).slice(0, 46).padEnd(46)} $${c.price} ${c.acres ?? '?'}ac ${c.soldDate ?? 'no date'}`);
  }
  console.log('\nDry run. Re-run with --apply to persist through upsertNormalizedComp.');
  process.exit(0);
}

let written = 0;
for (const c of sold as any[]) {
  // The shared canonical writer owns dedupe (canonical_key), classification and
  // field-level merging. Nothing here decides admission or valuation.
  upsertNormalizedComp({
    entity: deal.entity as never,
    dealCardId,
    cardId,
    sourceLabel: 'Redfin',
    sourceUrl: c.url ?? null,
    addressDesc: c.address,
    price: c.price,
    priceKind: 'sale',
    acres: typeof c.acres === 'number' ? c.acres : null,
    saleOrListDate: c.soldDate ?? '',
    state: 'FL',
    lat: typeof c.lat === 'number' ? c.lat : null,
    lng: typeof c.lng === 'number' ? c.lng : null,
    propertyClass: c.homeType ? 'improved' : 'vacant_land',
    addedBy: 'redfin-coverage-repair',
  } as never);
  written += 1;
}

const db2 = new Database(path.join(ROOT, 'store', 'landos.db'), { readonly: true });
const after = (db2.prepare('SELECT COUNT(*) n FROM landos_comp WHERE deal_card_id=?').get(dealCardId) as any).n;
db2.close();
console.log(`upserted    : ${written}`);
console.log(`comps after : ${after}  (net new: ${after - before})`);
