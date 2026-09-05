#!/usr/bin/env tsx
// Ask the Deal Brain one operator question and wait for its reply, then report
// the decision-artifact count before and after so a material change can be
// shown to write exactly one, and an identical repeat to write none.
//
//   npx tsx scripts/qa/landos-dealbrain-ask.mts <dealCardId>

import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

import { readEnvFile } from '../../src/env.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const id = Number(process.argv[2] ?? 90);

const MESSAGE = 'The comparable evidence has been corrected. State the current supported value, '
  + 'the qualified non-LandPortal closed sales behind it, and the single next action.';

const previousCwd = process.cwd();
process.chdir(ROOT);
let token = '';
try { token = readEnvFile(['DASHBOARD_TOKEN']).DASHBOARD_TOKEN ?? ''; } finally { process.chdir(previousCwd); }

function counts() {
  const db = new Database(path.join(ROOT, 'store', 'landos.db'), { readonly: true });
  const total = (db.prepare("SELECT COUNT(*) n FROM landos_deal_intelligence_snapshot WHERE deal_card_id=? AND snapshot_type='deal_decision_synthesis_v1'").get(id) as any).n;
  const current = db.prepare("SELECT id, version FROM landos_deal_intelligence_snapshot WHERE deal_card_id=? AND snapshot_type='deal_decision_synthesis_v1' AND status='current'").get(id) as any;
  const replies = (db.prepare("SELECT COUNT(*) n FROM landos_deal_brain_guidance WHERE deal_card_id=? AND role<>'operator'").get(id) as any).n;
  db.close();
  return { total, currentId: current?.id ?? null, currentVersion: current?.version ?? null, replies };
}

const before = counts();
console.log(`BEFORE: decisions=${before.total} current=#${before.currentId} v${before.currentVersion} replies=${before.replies}`);

const url = new URL(`/api/landos/deal-cards/${id}/deal-brain`, 'http://localhost:3141');
url.searchParams.set('token', token);
const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: MESSAGE }),
  signal: AbortSignal.timeout(120_000),
});
console.log(`POST deal-brain -> ${res.status}`);

const deadline = Date.now() + 600_000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 10_000));
  if (counts().replies > before.replies) break;
}

const after = counts();
console.log(`AFTER : decisions=${after.total} current=#${after.currentId} v${after.currentVersion} replies=${after.replies}`);
console.log(`new decisions written: ${after.total - before.total}`);
console.log(`new replies written  : ${after.replies - before.replies}`);

const db = new Database(path.join(ROOT, 'store', 'landos.db'), { readonly: true });
const reply = db.prepare("SELECT text FROM landos_deal_brain_guidance WHERE deal_card_id=? AND role<>'operator' ORDER BY id DESC LIMIT 1").get(id) as any;
db.close();
console.log('\n=== Deal Brain reply ===');
console.log(String(reply?.text ?? '(none)').slice(0, 2000));
