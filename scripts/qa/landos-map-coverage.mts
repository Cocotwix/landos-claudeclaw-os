#!/usr/bin/env tsx
// Combined-map coverage: which records carry a real location, by role.
//   npx tsx scripts/qa/landos-map-coverage.mts [dealCardId]

import path from 'node:path';
import process from 'node:process';

import { readEnvFile } from '../../src/env.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const id = Number(process.argv[2] ?? 90);

const previousCwd = process.cwd();
process.chdir(ROOT);
let token = '';
try { token = readEnvFile(['DASHBOARD_TOKEN']).DASHBOARD_TOKEN ?? ''; } finally { process.chdir(previousCwd); }

const res = await fetch(`http://localhost:3141/api/landos/deal-cards/${id}/comps-valuation?token=${encodeURIComponent(token)}`);
const body = await res.json() as any;
const cv = body.compsValuation;
const pkg = cv.valuationPackage;

console.log(`subject point : ${cv.subject?.lat ?? 'none'}, ${cv.subject?.lng ?? 'none'} (${cv.subject?.locationSource ?? '-'})`);
console.log(`mapCounts     : ${JSON.stringify(cv.mapCounts)}`);
console.log();

const lp = new Set<string>(pkg.landPortalFmv.compKeys ?? []);
const nonLp = new Set<string>(pkg.nonLandPortalFmv.compKeys ?? []);
const located = (c: any) => c.lat != null && c.lng != null;

const roleOf = (c: any) => {
  if (c.category === 'active_competition') return 'active competition';
  if (lp.has(c.key)) return 'selected LandPortal comp';
  if (nonLp.has(c.key)) return 'selected Non-LandPortal comp';
  if (c.inValuationSet) return 'valuation-set comp';
  return 'context';
};

const roles = new Map<string, { located: number; total: number }>();
for (const c of cv.comps) {
  const r = roleOf(c);
  const e = roles.get(r) ?? { located: 0, total: 0 };
  e.total += 1;
  if (located(c)) e.located += 1;
  roles.set(r, e);
}
console.log('=== MAP COVERAGE BY ROLE ===');
for (const [role, e] of [...roles.entries()].sort()) {
  console.log(`  ${role.padEnd(30)} ${e.located}/${e.total} located`);
}
console.log();

console.log('=== EVERY RECORD THAT MUST APPEAR ON THE MAP ===');
for (const c of cv.comps) {
  const role = roleOf(c);
  if (role === 'context') continue;
  console.log(`  [${role}] ${String(c.address ?? '(no address)').slice(0, 44).padEnd(44)} ${located(c) ? `${c.lat?.toFixed(5)},${c.lng?.toFixed(5)}` : 'NO LOCATION'} ${c.distanceMiles != null ? `${c.distanceMiles} mi` : ''}`);
}
