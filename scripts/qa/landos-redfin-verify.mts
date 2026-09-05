#!/usr/bin/env tsx
// Run the real Redfin sold-land lane for the Bradford County subject and report
// every candidate it retrieves, so search coverage can be judged on what the
// lane actually returns rather than on what it was expected to return.
//
//   npx tsx scripts/qa/landos-redfin-verify.mts

import process from 'node:process';

import { fetchRedfinLandComps } from '../../src/landos/redfin-land-comps.js';

const SUBJECT = {
  address: '19554 NW 137th Ln',
  city: 'Lake Butler',
  county: 'Bradford',
  state: 'FL',
  zip: '32054',
  apn: '00083A03400',
  subjectAcres: 1.5,
  mode: 'sold' as const,
  lat: 30.001566331787483,
  lng: -82.27218446874652,
};

const started = Date.now();
const result = await fetchRedfinLandComps(SUBJECT as never, { force: true, timeoutMs: 90_000 } as never);
console.log(`status   : ${result.status}`);
console.log(`elapsed  : ${Math.round((Date.now() - started) / 1000)}s`);
console.log(`candidates: ${result.comps?.length ?? 0}`);
console.log(`note     : ${String(result.note ?? '').slice(0, 700)}`);
console.log();
console.log('routes:');
for (const r of (result.routes ?? []) as any[]) {
  console.log(`  ${String(r.label).padEnd(38)} reached=${r.reached} cards=${r.cardsFound ?? '-'} qualifying=${r.qualifying ?? '-'}`);
  console.log(`      url: ${r.url}`);
  if (r.outcome) console.log(`      ${String(r.outcome).slice(0,200)}`);
}
console.log();
console.log('candidates inside the 0.50-2.50 acre band:');
for (const c of (result.comps ?? []) as any[]) {
  if (typeof c.acres !== 'number' || c.acres < 0.5 || c.acres > 2.5) continue;
  console.log(`  ${String(c.address).slice(0, 48).padEnd(48)} $${c.price} ${c.acres}ac ${c.soldDate ?? 'no date'}`);
  console.log(`      ${c.url ?? ''}`);
}
console.log();
console.log('ALL candidates:');
for (const c of (result.comps ?? []) as any[]) {
  console.log(`  ${String(c.address).slice(0, 48).padEnd(48)} $${c.price} ${c.acres ?? '?'}ac ${c.status} ${c.soldDate ?? ''}`);
}
process.exit(0);
