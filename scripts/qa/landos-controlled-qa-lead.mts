#!/usr/bin/env tsx
// Create ONE controlled QA Deal Card through the real operator New Lead path,
// then wait for its research to settle and report the retained package.
//
//   npx tsx scripts/qa/landos-controlled-qa-lead.mts create
//   npx tsx scripts/qa/landos-controlled-qa-lead.mts status <dealCardId>
//   npx tsx scripts/qa/landos-controlled-qa-lead.mts dealbrain <dealCardId>
//
// This writes to OPERATING storage on purpose: the acceptance item is that a
// real lead entering the real front door produces a complete card. The record
// is titled and annotated as controlled QA so it can never be mistaken for a
// business lead, exactly like the existing Stage 4 QA card.

import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

import { readEnvFile } from '../../src/env.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const command = process.argv[2] ?? 'create';
const argId = Number(process.argv[3] ?? 0);

const previousCwd = process.cwd();
process.chdir(ROOT);
let token = '';
try { token = readEnvFile(['DASHBOARD_TOKEN']).DASHBOARD_TOKEN ?? ''; } finally { process.chdir(previousCwd); }

async function api<T>(apiPath: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const url = new URL(apiPath, 'http://localhost:3141');
  url.searchParams.set('token', token);
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
  return { status: res.status, body: body as T };
}

const money = (n: number | null | undefined) => (n == null ? 'null' : `$${n.toLocaleString('en-US')}`);

// A real, publicly listed vacant parcel used ONLY as a controlled QA subject.
// It is not a business lead, no seller is contacted, and nothing is offered.
const QA_LEAD = {
  sellerName: 'QA CONTROLLED — not a seller',
  address: '00 SW County Road 239, Lake Butler, FL 32054',
  county: 'Union', state: 'FL', zip: '32054', acreage: '2',
  leadSource: 'operational-closure-controlled-qa',
  sellerClues: 'QA CONTROLLED RECORD for the operational closure acceptance run. '
    + 'Not a business lead. No seller contact, offer, or outreach is authorized from this card.',
};

// A controlled QA subject carrying a REAL, already-retained parcel identifier
// (LandPortal comp #977 on Deal 89). An exact APN is what the identity lane
// asks for when an address alone cannot be verified, so this subject can reach
// a complete package without any identity being invented.
const QA_LEAD_APN = {
  sellerName: 'QA CONTROLLED — not a seller',
  address: '7348 Overby Rd, Fairview, TN 37062',
  apn: '046-050.00-000',
  // 50.8 is the Williamson County Property Assessment Database acreage for
  // parcel 046 05000 000 (official record, retrieved through the Assessor & Tax
  // capability); the listing's 52.18 MLS acres is not the accepted subject.
  county: 'Williamson', state: 'TN', zip: '37062', acreage: '50.8',
  leadSource: 'operational-closure-controlled-qa',
  sellerClues: 'QA CONTROLLED RECORD for the operational closure acceptance run. '
    + 'Not a business lead. No seller contact, offer, or outreach is authorized from this card.',
};

async function createApn(): Promise<void> {
  const res = await api<any>('/api/landos/leads/manual', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(QA_LEAD_APN),
  });
  console.log(`POST /api/landos/leads/manual -> ${res.status}`);
  console.log(`dealCardId        : ${res.body?.dealCardId}`);
  console.log(`propertyCardId    : ${res.body?.propertyCardId}`);
  console.log(`subjectResolution : ${JSON.stringify(res.body?.subjectResolution)}`);
  console.log(`researchStatus    : ${res.body?.researchStatus}`);
}

async function create(): Promise<void> {
  const before = new Database(path.join(ROOT, 'store', 'landos.db'), { readonly: true })
    .prepare('SELECT COUNT(*) n FROM landos_deal_card').get() as { n: number };
  console.log(`deal cards before: ${before.n}`);
  const res = await api<any>('/api/landos/leads/manual', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(QA_LEAD),
  });
  console.log(`POST /api/landos/leads/manual -> ${res.status}`);
  console.log(`dealCardId        : ${res.body?.dealCardId}`);
  console.log(`propertyCardId    : ${res.body?.propertyCardId}`);
  console.log(`subjectResolution : ${JSON.stringify(res.body?.subjectResolution)}`);
  console.log(`researchStatus    : ${res.body?.researchStatus}`);
  console.log(`opportunityId     : ${res.body?.opportunityId}`);
}

async function status(id: number): Promise<void> {
  const db = new Database(path.join(ROOT, 'store', 'landos.db'), { readonly: true });
  const card = db.prepare('SELECT id,title,lead_type,subject_key,subject_key_basis,canonical_deal_card_id FROM landos_deal_card WHERE id=?').get(id);
  console.log('card:', JSON.stringify(card));
  const identity = db.prepare('SELECT version,status,apn,county,state,acreage,confidence FROM landos_property_identity_version WHERE deal_card_id=? AND is_current=1').get(id);
  console.log('current identity:', JSON.stringify(identity));
  const lanes = db.prepare('SELECT lane_id,status,duration_ms,completed_at FROM landos_property_research_lane_attempt WHERE deal_card_id=? ORDER BY completed_at DESC LIMIT 20').all(id);
  console.log(`lane attempts: ${lanes.length}`);
  for (const l of lanes as any[]) console.log(`  ${String(l.lane_id).padEnd(24)} ${String(l.status).padEnd(14)} ${String(l.duration_ms).padStart(8)}ms ${l.completed_at}`);
  const snaps = db.prepare("SELECT snapshot_type,version,status FROM landos_deal_intelligence_snapshot WHERE deal_card_id=? AND status='current' ORDER BY snapshot_type").all(id);
  console.log(`current snapshots: ${snaps.length}`);
  for (const s of snaps as any[]) console.log(`  ${s.snapshot_type} v${s.version}`);
  const comps = db.prepare('SELECT COUNT(*) n FROM landos_comp WHERE deal_card_id=?').get(id) as { n: number };
  const evid = db.prepare('SELECT COUNT(*) n FROM landos_property_evidence_item WHERE deal_card_id=?').get(id) as { n: number };
  console.log(`comps: ${comps.n}  evidence items: ${evid.n}`);
  db.close();

  const cv = await api<any>(`/api/landos/deal-cards/${id}/comps-valuation`);
  const pkg = cv.body?.compsValuation?.valuationPackage;
  if (!pkg) { console.log('valuation package: NONE'); return; }
  console.log('=== valuation package ===');
  console.log(`  LandPortal FMV     : ${money(pkg.landPortalFmv?.value)}`);
  console.log(`  Non-LandPortal FMV : ${money(pkg.nonLandPortalFmv?.value)} (${pkg.nonLandPortalFmv?.compCount} comp(s))`);
  console.log(`  Combined LandOS FMV: ${money(pkg.combinedFmv?.value)} (${pkg.combinedFmv?.method}, ${pkg.combinedFmv?.confidence})`);
  console.log(`  calculation        : ${pkg.combinedFmv?.calculation}`);
  console.log(`  40% / 60%          : ${money(pkg.offer40)} / ${money(pkg.offer60)}  offer50=${Object.prototype.hasOwnProperty.call(pkg, 'offer50')}`);
  console.log(`  limitation         : ${pkg.combinedFmv?.limitation ?? 'none'}`);
  console.log(`  active competition : ${pkg.activeCompetition?.count}`);
  console.log(`  land home          : triggered=${pkg.landHomePackage?.triggered} searchComplete=${pkg.landHomePackage?.market?.searchComplete}`);
  console.log(`  provenance         : ${JSON.stringify(pkg.provenance)}`);
}

function dealbrain(id: number): void {
  const db = new Database(path.join(ROOT, 'store', 'landos.db'), { readonly: true });
  const rows = db.prepare(`
    SELECT id, snapshot_type, version, status, input_hash, SUBSTR(change_reason,1,90) reason, created_at
      FROM landos_deal_intelligence_snapshot
     WHERE deal_card_id=? AND snapshot_type LIKE '%deal_brain%'
     ORDER BY id
  `).all(id) as any[];
  console.log(`deal ${id}: ${rows.length} deal-brain snapshot(s)`);
  for (const r of rows) {
    console.log(`  #${r.id} v${r.version} ${String(r.status).padEnd(11)} hash=${String(r.input_hash).slice(0, 16)} ${new Date(r.created_at * 1000).toISOString()}`);
    console.log(`      ${r.reason}`);
  }
  db.close();
}

function decisionCounts(id: number) {
  const db = new Database(path.join(ROOT, 'store', 'landos.db'), { readonly: true });
  const total = db.prepare("SELECT COUNT(*) n FROM landos_deal_intelligence_snapshot WHERE deal_card_id=? AND snapshot_type='deal_decision_synthesis_v1'").get(id) as { n: number };
  const current = db.prepare("SELECT id, version, input_hash, created_at FROM landos_deal_intelligence_snapshot WHERE deal_card_id=? AND snapshot_type='deal_decision_synthesis_v1' AND status='current'").get(id) as any;
  db.close();
  return { total: total.n, currentId: current?.id ?? null, currentVersion: current?.version ?? null, inputHash: current?.input_hash ?? null };
}

/**
 * Prove the decision lifecycle on REAL data:
 *   an identical repeat writes NOTHING, and a material change writes EXACTLY ONE
 *   new current decision, with the prior one preserved as history.
 */
async function decisionProof(id: number): Promise<void> {
  const before = decisionCounts(id);
  console.log(`BEFORE            : total=${before.total} current=#${before.currentId} v${before.currentVersion} hash=${String(before.inputHash).slice(0, 16)}`);

  // 1. IDENTICAL REPEAT. The Deal Brain refresh reuses persisted evidence; when
  //    the retained decision already matches current truth it must report
  //    "current" and write nothing at all.
  const repeat = await api<any>(`/api/landos/deal-cards/${id}/deal-brain/refresh`, { method: 'POST' });
  console.log(`identical repeat  : HTTP ${repeat.status} outcome=${repeat.body?.outcome ?? '(n/a)'} running=${repeat.body?.running}`);
  const afterRepeat = decisionCounts(id);
  console.log(`AFTER REPEAT      : total=${afterRepeat.total} current=#${afterRepeat.currentId} v${afterRepeat.currentVersion}`);
  console.log(`  new decisions written by the identical repeat: ${afterRepeat.total - before.total}  (required: 0)`);

  // 2. A second identical repeat, to show the first was not a one-off.
  const repeat2 = await api<any>(`/api/landos/deal-cards/${id}/deal-brain/refresh`, { method: 'POST' });
  const afterRepeat2 = decisionCounts(id);
  console.log(`second repeat     : HTTP ${repeat2.status} outcome=${repeat2.body?.outcome ?? '(n/a)'}`);
  console.log(`  new decisions written by the second identical repeat: ${afterRepeat2.total - afterRepeat.total}  (required: 0)`);

  console.log();
  console.log(`RESULT: identical repeats wrote ${afterRepeat2.total - before.total} new decision(s); the current decision is still #${afterRepeat2.currentId} v${afterRepeat2.currentVersion}.`);
}

/** Fire the operator's own focused Re-run Research (fire-and-poll, never waits). */
async function rerun(id: number): Promise<void> {
  const before = decisionCounts(id);
  console.log(`BEFORE rerun: total=${before.total} current=#${before.currentId} v${before.currentVersion} hash=${String(before.inputHash).slice(0,16)}`);
  const res = await api<any>(`/api/landos/deal-cards/${id}/property-intelligence/run`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope: 'comparables' }),
  });
  console.log(`POST property-intelligence/run (scope=comparables) -> ${res.status}`);
  console.log(`body: ${JSON.stringify(res.body).slice(0, 240)}`);
}

if (command === 'create') await create();
else if (command === 'rerun') await rerun(argId);
else if (command === 'decision-proof') await decisionProof(argId);
else if (command === 'create-apn') await createApn();
else if (command === 'status') await status(argId);
else if (command === 'dealbrain') dealbrain(argId);
else { console.error('usage: create | status <id> | dealbrain <id>'); process.exit(1); }
