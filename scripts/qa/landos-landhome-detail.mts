#!/usr/bin/env tsx
// Land Home Package evidence detail: the qualifying manufactured-home sales,
// every retained sold comp key, and why the other nearby discoveries were not
// admitted.
//
//   npx tsx scripts/qa/landos-landhome-detail.mts [dealCardId]

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

const money = (n: unknown) => (typeof n === 'number' ? `$${n.toLocaleString('en-US')}` : String(n ?? 'null'));

const res = await fetch(`http://localhost:3141/api/landos/deal-cards/${id}/comps-valuation?token=${encodeURIComponent(token)}`);
const body = await res.json() as any;
const cv = body.compsValuation;
const lhp = cv.valuationPackage.landHomePackage;

console.log('=== LAND HOME PACKAGE ===');
console.log(`triggered           : ${lhp.triggered}`);
console.log(`physical met        : ${lhp.physical.met} (${lhp.physical.usableAcres} usable ac, ${lhp.physical.slopeBasis})`);
console.log(`market met          : ${lhp.market.met}`);
console.log(`qualifying sales    : ${lhp.market.qualifyingSaleCount}`);
console.log(`top sale price      : ${money(lhp.market.topSalePrice)}`);
console.log(`search complete     : ${lhp.market.searchComplete}`);
console.log(`rule                : ${lhp.rule}`);
console.log(`brief               : ${lhp.market.brief ?? '(none)'}`);
console.log();

console.log(`=== ALL ${lhp.soldCompKeys.length} RETAINED SOLD COMP KEYS ===`);
const byKey = new Map<string, any>(cv.comps.map((c: any) => [c.key, c]));
for (const key of lhp.soldCompKeys) {
  const c = byKey.get(key);
  if (!c) { console.log(`  ${key}\n      (not present in the workspace comp list)`); continue; }
  console.log(`  ${key}`);
  console.log(`      ${c.address ?? '(no address)'} · ${money(c.price)} · ${c.acres ?? '?'} ac · ${c.dateIso ?? 'no date'} · ${c.distanceMiles ?? '?'} mi · ${c.homeType ?? ''}`);
}
console.log();

const QUALIFY_MIN = 200_000;
console.log(`=== QUALIFYING MANUFACTURED-HOME SALES (>= ${money(QUALIFY_MIN)}, within ~5 miles) ===`);
const qualifying = lhp.soldCompKeys
  .map((k: string) => byKey.get(k))
  .filter((c: any) => c && typeof c.price === 'number' && c.price >= QUALIFY_MIN);
for (const c of qualifying) {
  console.log(`  ${c.address} · ${money(c.price)} · ${c.acres ?? '?'} ac · sold ${c.dateIso ?? 'no date'} · ${c.distanceMiles ?? '?'} mi`);
}
console.log(`counted qualifying: ${qualifying.length} (screen reports ${lhp.market.qualifyingSaleCount})`);
console.log();

console.log('=== WHY THE OTHER NEARBY DISCOVERIES WERE NOT ADMITTED ===');
console.log(`market note: ${lhp.market.note}`);
console.log(`search outcome: ${lhp.market.searchOutcome ?? '(none)'}`);
console.log(`excludedCount: ${lhp.excludedCount}`);

const db = new Database(path.join(ROOT, 'store', 'landos.db'), { readonly: true });
const attempt = db.prepare(`
  SELECT result_json FROM landos_property_research_lane_attempt
   WHERE lane_id='manufactured_home'
     AND deal_card_id IN (SELECT id FROM landos_deal_card WHERE id=? OR canonical_deal_card_id=?)
   ORDER BY completed_at DESC LIMIT 1
`).get(id, id) as { result_json?: string } | undefined;
if (attempt?.result_json) {
  const proof = JSON.parse(attempt.result_json)?.execution?.result?.searchProof;
  console.log();
  console.log('=== MANUFACTURED-HOME SEARCH PROOF (retained lane attempt) ===');
  console.log(`  radiusMiles         : ${proof?.radiusMiles}`);
  console.log(`  timePeriodMonths    : ${proof?.timePeriodMonths}`);
  console.log(`  sourcesSearched     : ${(proof?.sourcesSearched ?? []).join(', ')}`);
  console.log(`  candidatesReviewed  : ${proof?.candidatesReviewed}`);
  console.log(`  qualifyingResults   : ${proof?.qualifyingResults}`);
  console.log(`  exclusionReasons    : ${JSON.stringify(proof?.exclusionReasons ?? [])}`);
}
db.close();
