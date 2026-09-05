#!/usr/bin/env tsx
// Prove the Realtor.com lane for the Bradford County subject: search
// construction first (pure, no network), then live retrieval through the
// approved lane, then the indexed read-only fallback the lane already owns.
//
//   npx tsx scripts/qa/landos-realtor-verify.mts routes
//   npx tsx scripts/qa/landos-realtor-verify.mts fetch

import process from 'node:process';

import { realtorSearchRoutes, fetchRealtorLandComps } from '../../src/landos/realtor-land-comps.js';

const mode = process.argv[2] ?? 'routes';

// The acquisition subject, exactly as the Deal Card carries it.
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

if (mode === 'routes') {
  const routes = realtorSearchRoutes(SUBJECT as never);
  console.log(`Realtor.com sold-land routes constructed for the subject: ${routes.length}`);
  for (const r of routes) console.log(`  [${r.kind.padEnd(9)}] ${r.label}\n              ${r.url}`);
  process.exit(0);
}

const started = Date.now();
const result = await fetchRealtorLandComps(SUBJECT as never, {
  force: true,
  timeoutMs: 120_000,
});
console.log(`status        : ${result.status}`);
console.log(`elapsed       : ${Math.round((Date.now() - started) / 1000)}s`);
console.log(`sold rows     : ${result.sold?.length ?? 0}`);
console.log(`active rows   : ${result.active?.length ?? 0}`);
console.log(`note          : ${String(result.note ?? '').slice(0, 900)}`);
if (result.laneRoutes) {
  console.log('routes attempted:');
  for (const r of result.laneRoutes as any[]) {
    console.log(`  ${String(r.label).padEnd(34)} reached=${r.reached} blocked=${r.blocked} cards=${r.cardsFound ?? '-'} qualifying=${r.qualifying ?? '-'}`);
    if (r.outcome) console.log(`      ${String(r.outcome).slice(0, 190)}`);
  }
}
for (const row of (result.sold ?? []).slice(0, 20)) {
  console.log(`  SOLD ${String(row.address).slice(0, 46).padEnd(46)} $${row.price} ${row.acres ?? '?'}ac ${row.soldDate ?? 'no date'} ${row.url ?? ''}`);
}
process.exit(0);
