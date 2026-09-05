#!/usr/bin/env tsx
// Record an explicit operator comp-selection decision and report the effect on
// the Deal Brain decision artifact.
//
//   npx tsx scripts/qa/landos-comp-selection.mts <dealCardId> <compId> <action>
//
// The route recalculates the valuation and asks the Deal Brain to re-read it;
// the Deal Brain writes a new decision only when a material dimension moved, so
// running the identical action twice must write exactly one.

import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

import { readEnvFile } from '../../src/env.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const id = Number(process.argv[2] ?? 90);
const compId = Number(process.argv[3] ?? 1016);
const action = process.argv[4] ?? 'exclude';

const REASON = process.env.LANDOS_SELECTION_REASON
  ?? 'Improved property: operator-observed sheds, pole barn, workshop and driveway. '
  + 'Preserved as improved context; excluded from the clean vacant-land valuation set.';

const previousCwd = process.cwd();
process.chdir(ROOT);
let token = '';
try { token = readEnvFile(['DASHBOARD_TOKEN']).DASHBOARD_TOKEN ?? ''; } finally { process.chdir(previousCwd); }

function decisions() {
  const db = new Database(path.join(ROOT, 'store', 'landos.db'), { readonly: true });
  const total = (db.prepare("SELECT COUNT(*) n FROM landos_deal_intelligence_snapshot WHERE deal_card_id=? AND snapshot_type='deal_decision_synthesis_v1'").get(id) as any).n;
  const cur = db.prepare("SELECT id, version, input_hash FROM landos_deal_intelligence_snapshot WHERE deal_card_id=? AND snapshot_type='deal_decision_synthesis_v1' AND status='current'").get(id) as any;
  db.close();
  return { total, id: cur?.id ?? null, version: cur?.version ?? null, hash: String(cur?.input_hash ?? '').slice(0, 16) };
}

async function post() {
  const url = new URL(`/api/landos/deal-cards/${id}/comps-valuation/selection`, 'http://localhost:3141');
  url.searchParams.set('token', token);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ compId, action, reason: REASON, actor: 'tyler/operational-closure' }),
    signal: AbortSignal.timeout(300_000),
  });
  const body = await res.json().catch(() => null) as any;
  return { status: res.status, error: body?.error ?? null, fmv: body?.compsValuation?.valuationPackage?.combinedFmv?.value ?? null };
}

const before = decisions();
console.log(`BEFORE     : decisions=${before.total} current=#${before.id} v${before.version} hash=${before.hash}`);

const first = await post();
console.log(`selection 1: HTTP ${first.status}${first.error ? ` error=${first.error}` : ''} combinedFmv=${first.fmv}`);
await new Promise((r) => setTimeout(r, 4000));
const afterFirst = decisions();
console.log(`AFTER 1    : decisions=${afterFirst.total} current=#${afterFirst.id} v${afterFirst.version} hash=${afterFirst.hash}`);
console.log(`  new decisions from the material change: ${afterFirst.total - before.total}`);

const second = await post();
console.log(`selection 2: HTTP ${second.status}${second.error ? ` error=${second.error}` : ''} (identical repeat)`);
await new Promise((r) => setTimeout(r, 4000));
const afterSecond = decisions();
console.log(`AFTER 2    : decisions=${afterSecond.total} current=#${afterSecond.id} v${afterSecond.version} hash=${afterSecond.hash}`);
console.log(`  new decisions from the identical repeat: ${afterSecond.total - afterFirst.total}`);
