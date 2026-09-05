#!/usr/bin/env tsx
// Runtime proof for the provider status mapping, WITHOUT contacting any
// provider.
//
// Every marketplace lane attempt retains its full provider payload, including
// the lane's own `execution.result.status`. This replays those REAL retained
// payloads through the shipped adapter mapping and reports, per attempt, the
// status that was persisted at the time versus the status the current code
// produces. No network call, no browser, no write.
//
//   npx tsx scripts/qa/landos-provider-status-replay.mts

import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

import { marketplaceProviderAdapter } from '../../src/landos/property-intelligence-live.js';
import type { CanonicalPropertyInput } from '../../src/landos/property-intelligence-contract.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');

const property: CanonicalPropertyInput = {
  propertyCardId: 0, dealCardId: 0, normalizedAddress: '', address: '', city: null,
  county: null, state: null, zip: null, apn: null, fips: null, landPortalPropertyId: null,
};

function mapStatus(laneId: string, laneStatus: string): string {
  const adapter = marketplaceProviderAdapter({
    laneId, providerId: laneId, execute: async () => ({}) as never,
  });
  const execution = { status: laneStatus, sold: [], active: [], note: null } as never;
  return adapter.status(property, execution, adapter.validate(property, execution), []);
}

const db = new Database(path.join(ROOT, 'store', 'landos.db'), { readonly: true, fileMustExist: true });
const rows = db.prepare(`
  SELECT id, deal_card_id, lane_id, status AS persisted, completed_at, result_json
    FROM landos_property_research_lane_attempt
   WHERE lane_id IN ('zillow','redfin','realtor','manufactured_home')
   ORDER BY completed_at DESC
`).all() as Array<{ id: number; deal_card_id: number; lane_id: string; persisted: string; completed_at: string; result_json: string }>;

const changed: Array<{ id: number; deal: number; lane: string; inner: string; was: string; now: string; at: string }> = [];
const tally = new Map<string, number>();
let replayed = 0;

for (const row of rows) {
  let inner: string | null = null;
  try { inner = JSON.parse(row.result_json)?.execution?.result?.status ?? null; } catch { inner = null; }
  if (!inner) continue;
  replayed += 1;
  const now = mapStatus(row.lane_id, inner);
  const key = `${row.lane_id} inner=${inner}: ${row.persisted} -> ${now}`;
  tally.set(key, (tally.get(key) ?? 0) + 1);
  if (now !== row.persisted) {
    changed.push({ id: row.id, deal: row.deal_card_id, lane: row.lane_id, inner, was: row.persisted, now, at: row.completed_at });
  }
}
db.close();

console.log(`retained marketplace lane attempts replayed: ${replayed}`);
console.log();
console.log('=== MAPPING, PER RETAINED PAYLOAD (persisted -> current code) ===');
for (const [key, n] of [...tally.entries()].sort()) console.log(`  ${key.padEnd(58)} x${n}`);
console.log();
console.log(`=== ATTEMPTS THE FIX CORRECTS: ${changed.length} ===`);
for (const c of changed.slice(0, 30)) {
  console.log(`  attempt #${String(c.id).padEnd(6)} deal ${String(c.deal).padEnd(5)} ${c.lane.padEnd(20)} own payload said "${c.inner}" · persisted "${c.was}" · now "${c.now}"  (${c.at})`);
}
if (changed.length > 30) console.log(`  ... and ${changed.length - 30} more`);
console.log();
const stillWrong = changed.filter((c) => c.inner === 'blocked' && c.now !== 'blocked');
console.log(`refusals still mis-mapped after the fix: ${stillWrong.length} (required: 0)`);
