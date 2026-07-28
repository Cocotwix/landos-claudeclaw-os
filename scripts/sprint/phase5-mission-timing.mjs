#!/usr/bin/env node
// Phase 5 mission timing breakdown — READ-ONLY.
//
// Prints the timing profile of a deal_intelligence mission: parent wall clock,
// per-child start/end/duration/status, which lanes overlapped vs ran strictly
// serial, time-to-identity, time-to-first-useful-result, and the observed
// critical path. Opens the LandOS database with { readonly: true } and issues
// SELECT/PRAGMA only. Prints timing, statuses and child keys — never
// result_json, summaries, or any handback content.
//
// Usage:
//   node scripts/sprint/phase5-mission-timing.mjs --latest
//   node scripts/sprint/phase5-mission-timing.mjs <dealCardId>
//   node scripts/sprint/phase5-mission-timing.mjs <dealCardId> --seq <n>
//   node scripts/sprint/phase5-mission-timing.mjs --mission <missionId>
//   node scripts/sprint/phase5-mission-timing.mjs --db <path-to-landos.db> ...

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB = path.resolve(HERE, '..', '..', 'store', 'landos.db');

function parseArgs(argv) {
  const out = { dealCardId: null, latest: false, missionId: null, seq: null, db: DEFAULT_DB };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--latest') out.latest = true;
    else if (a === '--mission') out.missionId = argv[++i] ?? null;
    else if (a === '--seq') out.seq = Number(argv[++i]);
    else if (a === '--db') out.db = argv[++i] ?? DEFAULT_DB;
    else if (/^\d+$/.test(a)) out.dealCardId = Number(a);
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (!out.latest && out.dealCardId == null && !out.missionId) {
    console.error('Usage: phase5-mission-timing.mjs (--latest | <dealCardId> [--seq n] | --mission <id>) [--db path]');
    process.exit(2);
  }
  return out;
}

const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const fmtS = (v) => (Number.isFinite(v) ? `${(v / 1000).toFixed(1)}s` : 'n/a');
const fmtMs = (v) => (v == null || !Number.isFinite(v) ? 'n/a' : v >= 10_000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`);

function columnSet(db, table) {
  try {
    return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
  } catch {
    return new Set();
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = new Database(args.db, { readonly: true, fileMustExist: true });
  try {
    report(db, args);
  } finally {
    db.close();
  }
}

function pickMission(db, args) {
  if (args.missionId) {
    return db.prepare(`SELECT * FROM landos_mission WHERE mission_id = ?`).get(args.missionId) ?? null;
  }
  if (args.dealCardId != null && args.seq != null) {
    return db.prepare(
      `SELECT * FROM landos_mission WHERE kind='deal_intelligence' AND scope='deal_card' AND scope_id=? AND sequence=?`,
    ).get(args.dealCardId, args.seq) ?? null;
  }
  if (args.dealCardId != null) {
    return db.prepare(
      `SELECT * FROM landos_mission WHERE kind='deal_intelligence' AND scope='deal_card' AND scope_id=?
       ORDER BY sequence DESC LIMIT 1`,
    ).get(args.dealCardId) ?? null;
  }
  return db.prepare(
    `SELECT * FROM landos_mission WHERE kind='deal_intelligence' ORDER BY started_at DESC LIMIT 1`,
  ).get() ?? null;
}

function report(db, args) {
  const mission = pickMission(db, args);
  if (!mission) {
    console.error('No matching deal_intelligence mission found.');
    process.exit(1);
  }

  const children = db.prepare(
    `SELECT child_key, role, depends_on, status, attempt, started_at, completed_at, duration_ms
     FROM landos_mission_child WHERE mission_id = ? ORDER BY id ASC`,
  ).all(mission.mission_id);

  const p0 = ms(mission.started_at);
  const pEnd = ms(mission.completed_at);
  const total = Number.isFinite(pEnd) ? pEnd - p0 : null;

  console.log(`Mission ${mission.mission_id}  (deal_card ${mission.scope_id}, sequence ${mission.sequence})`);
  console.log(`Parent: ${mission.status}  started ${mission.started_at}  completed ${mission.completed_at ?? 'STILL RUNNING'}`);
  console.log(`Total wall clock: ${total == null ? 'in flight' : fmtS(total)}`);
  console.log('');

  // ── Per-child table ────────────────────────────────────────────────────────
  const rows = children.map((c) => {
    const s = ms(c.started_at);
    const e = ms(c.completed_at);
    return { ...c, s, e, rel: Number.isFinite(s) ? s - p0 : null, relEnd: Number.isFinite(e) ? e - p0 : null };
  });
  const pad = (v, n) => String(v).padEnd(n);
  console.log(pad('child', 24) + pad('status', 11) + pad('start(rel)', 12) + pad('end(rel)', 12) + pad('duration', 10) + 'attempt');
  for (const r of rows) {
    console.log(
      pad(r.child_key, 24) +
      pad(r.status, 11) +
      pad(r.rel == null ? 'never ran' : fmtS(r.rel), 12) +
      pad(r.relEnd == null ? 'n/a' : fmtS(r.relEnd), 12) +
      pad(fmtMs(r.duration_ms), 10) +
      String(r.attempt),
    );
  }
  console.log('');

  // ── Overlap analysis ───────────────────────────────────────────────────────
  const ran = rows.filter((r) => Number.isFinite(r.s) && Number.isFinite(r.e));
  const overlaps = [];
  const serialAfter = [];
  for (let i = 0; i < ran.length; i += 1) {
    for (let j = i + 1; j < ran.length; j += 1) {
      const a = ran[i]; const b = ran[j];
      if (a.s < b.e && b.s < a.e) overlaps.push(`${a.child_key} ~ ${b.child_key}`);
    }
  }
  for (const b of ran) {
    for (const a of ran) {
      if (a === b) continue;
      const gap = b.s - a.e;
      if (gap >= 0 && gap <= 100) serialAfter.push(`${b.child_key} started ${gap}ms after ${a.child_key} finished`);
    }
  }
  console.log('Overlapping lanes (intervals intersect):');
  console.log(overlaps.length ? overlaps.map((x) => `  ${x}`).join('\n') : '  none');
  console.log('Strictly-serial handoffs (started within 100ms of another lane finishing):');
  console.log(serialAfter.length ? serialAfter.map((x) => `  ${x}`).join('\n') : '  none');
  console.log('');

  // ── Key latencies ──────────────────────────────────────────────────────────
  const byKey = new Map(rows.map((r) => [r.child_key, r]));
  const identity = byKey.get('parcel_identity');
  const contributedStatuses = new Set(['completed', 'partial']);
  const contributed = ran
    .filter((r) => contributedStatuses.has(r.status))
    .sort((a, b) => a.e - b.e);

  console.log(`Time to parcel_identity completion: ${identity?.relEnd == null ? 'n/a' : fmtS(identity.relEnd)} (status ${identity?.status ?? 'missing'})`);
  console.log(`Time to FIRST contributed child: ${contributed.length ? `${fmtS(contributed[0].e - p0)} (${contributed[0].child_key})` : 'none contributed'}`);
  const useful = ['comparables', 'valuation', 'market_intelligence']
    .map((k) => byKey.get(k))
    .filter((r) => r && contributedStatuses.has(r.status) && Number.isFinite(r.e))
    .sort((a, b) => a.e - b.e);
  console.log(`Time to first useful market/value result (comparables|valuation|market_intelligence): ${useful.length ? `${fmtS(useful[0].e - p0)} (${useful[0].child_key})` : 'none contributed'}`);

  // Progressive content on the run row — the column may not exist yet.
  // Degrade gracefully: report which progressive-ish columns exist and, if a
  // timestamp-bearing one does, when the run row first carried content.
  const runCols = columnSet(db, 'landos_property_intelligence_run');
  const progressiveCols = [...runCols].filter((c) => /prelim|progress|partial/i.test(c));
  if (progressiveCols.length === 0) {
    console.log('Progressive run-row content: no progressive/preliminary column exists yet (pre-integration schema).');
  } else {
    const run = db.prepare('SELECT * FROM landos_property_intelligence_run WHERE run_id = ?').get(mission.mission_id);
    if (!run) {
      console.log(`Progressive columns present (${progressiveCols.join(', ')}) but no run row shares this mission id.`);
    } else {
      const populated = progressiveCols.filter((c) => run[c] != null && String(run[c]).length > 0);
      console.log(`Progressive columns on the run row: ${progressiveCols.join(', ')}; populated for this run: ${populated.length ? populated.join(', ') : 'none'}.`);
      const tsCol = progressiveCols.find((c) => /_at$|_iso$/i.test(c) && run[c]);
      if (tsCol) {
        const t = ms(run[tsCol]);
        console.log(`Run row first carried progressive content at rel ${Number.isFinite(t) ? fmtS(t - p0) : String(run[tsCol])} (${tsCol}).`);
      }
    }
  }
  console.log('');

  // ── Observed critical path ─────────────────────────────────────────────────
  // Greedy backwards walk: from the child that finished last, repeatedly hop to
  // the lane that finished closest before this one started (the handoff), until
  // a lane starts at (or before) the parent start.
  if (ran.length) {
    const last = [...ran].sort((a, b) => b.e - a.e)[0];
    const chain = [last];
    const visited = new Set([last.child_key]);
    let cur = last;
    for (let guard = 0; guard < ran.length; guard += 1) {
      if (cur.s - p0 < 50) break;
      const prev = ran
        .filter((r) => !visited.has(r.child_key) && r.e <= cur.s + 5 && r.s < cur.s)
        .sort((a, b) => b.e - a.e)[0];
      if (!prev) break;
      chain.unshift(prev);
      visited.add(prev.child_key);
      cur = prev;
    }
    const desc = chain.map((r) => `${r.child_key} (${fmtMs(r.duration_ms)})`).join(' -> ');
    const covered = chain.reduce((acc, r) => acc + (r.duration_ms ?? 0), 0);
    console.log(`Observed critical path: ${desc}`);
    if (total != null) {
      console.log(`Critical-path child time: ${fmtS(covered)} of ${fmtS(total)} wall clock (${((covered / total) * 100).toFixed(1)}%; the remainder is scheduling/join).`);
    }
  }
}

main();
