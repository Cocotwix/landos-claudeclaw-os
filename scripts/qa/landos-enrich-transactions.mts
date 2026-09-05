#!/usr/bin/env tsx
// Run the retained-comparable transaction enrichment for one Deal Card and
// report what became a qualified closed sale. Adds no comparable and runs no
// search: it revisits already-retained candidate URLs only.
//
//   npx tsx scripts/qa/landos-enrich-transactions.mts <dealCardId> [limit]

import path from 'node:path';
import process from 'node:process';

import { readEnvFile } from '../../src/env.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const id = Number(process.argv[2] ?? 128);
const limit = Number(process.argv[3] ?? 12);

const previousCwd = process.cwd();
process.chdir(ROOT);
let token = '';
try { token = readEnvFile(['DASHBOARD_TOKEN']).DASHBOARD_TOKEN ?? ''; } finally { process.chdir(previousCwd); }

const url = `http://localhost:3141/api/landos/deal-cards/${id}/comps-valuation/enrich-transactions?token=${encodeURIComponent(token)}`;
console.log(`POST enrich-transactions deal=${id} limit=${limit}`);
const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ limit }),
  signal: AbortSignal.timeout(900_000),
});
console.log(`HTTP ${res.status}`);
const body = await res.json() as Record<string, any>;
console.log(`enrichedCount: ${body.enrichedCount}`);
for (const r of (body.results ?? []).slice(0, 15)) {
  console.log(`  enriched=${r.enriched} ${String(r.address ?? r.compKey ?? '').slice(0, 46).padEnd(46)} ${JSON.stringify(r.patch ?? r.reason ?? '').slice(0, 110)}`);
}
