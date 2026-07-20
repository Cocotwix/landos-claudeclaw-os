// Durable auto-retry for unfinished Market Research acreage bands.
//
// Waits out LandPortal outages (maintenance mode, auth prompts, transient
// stalls) and finishes every band that is not yet complete, then runs the
// front-end verification once. Safe to leave running: it only works when the
// provider is actually serving Drill Deep, backs off politely otherwise, and
// resumes at unit granularity so nothing is recollected or fabricated.
//
// Usage:  node scripts/mr-band-autoretry.mjs [band ...]      (default: 100+ all)
// Log:    logs/mr-band-autoretry.log      Status: store/mr-band-autoretry.json
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import Database from 'better-sqlite3';

const run = promisify(execFile);
const ROOT = process.cwd();
const BANDS = process.argv.slice(2).length ? process.argv.slice(2) : ['100+', 'all'];
const LOG = path.join(ROOT, 'logs', 'mr-band-autoretry.log');
const STATUS = path.join(ROOT, 'store', 'mr-band-autoretry.json');
const token = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^DASHBOARD_TOKEN=(.*)$/m)[1].trim();

fs.mkdirSync(path.dirname(LOG), { recursive: true });
const log = (m) => {
  const line = `${new Date().toISOString()} ${m}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch { /* logging must never kill the run */ }
};
const writeStatus = (o) => { try { fs.writeFileSync(STATUS, JSON.stringify({ updatedAt: new Date().toISOString(), ...o }, null, 1)); } catch { /* ignore */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const notify = (m) => new Promise((r) => execFile('bash', [path.join(ROOT, 'scripts', 'notify.sh'), m], () => r()));

/** Band is done when its snapshot has every state's counties AND no unit left
 *  failed/pending. Read straight from the ledger (source of truth). */
function bandState(band) {
  const db = new Database(path.join(ROOT, 'store', 'landos.db'), { readonly: true });
  try {
    const snap = db.prepare(`SELECT id FROM landos_mr_snapshot WHERE quarter = ? AND filter_key LIKE ?`)
      .get(quarterNow(), `%|${band}`);
    if (!snap) return { exists: false, retained: 0, empty: 0, failed: 0, counties: 0, zips: 0 };
    const u = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM landos_mr_band_unit WHERE snapshot_id = ? GROUP BY status').all(snap.id).map((r) => [r.status, r.n]));
    const lv = Object.fromEntries(db.prepare(`SELECT g.level, COUNT(*) n FROM landos_mr_metric m JOIN landos_mr_geography g ON g.id = m.geography_id WHERE m.snapshot_id = ? GROUP BY g.level`).all(snap.id).map((r) => [r.level, r.n]));
    return { exists: true, snapshotId: snap.id, retained: u.retained ?? 0, empty: u.empty ?? 0, failed: u.failed ?? 0, counties: lv.county ?? 0, zips: lv.zip ?? 0 };
  } finally { db.close(); }
}
function quarterNow() {
  const d = new Date();
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

async function ensureBrowser() {
  try {
    const r = await fetch(`http://localhost:3141/api/landos/browser/start?token=${encodeURIComponent(token)}`, { method: 'POST' });
    const j = await r.json();
    return j.start?.status === 'live';
  } catch { return false; }
}

/** One collection attempt. Returns the CLI's parsed result (or null). */
async function attempt(band) {
  try {
    const { stdout } = await run('node', ['dist/landos/mr-band-collect-cli.js', band], { cwd: ROOT, maxBuffer: 1024 * 1024 * 64 });
    const lines = stdout.trim().split('\n');
    return JSON.parse(lines[lines.length - 1]);
  } catch (e) {
    const out = (e.stdout ?? '').trim().split('\n');
    try { return JSON.parse(out[out.length - 1]); } catch { return null; }
  }
}

const MAX_HOURS = 48;
const started = Date.now();
log(`auto-retry started for band(s): ${BANDS.join(', ')}`);

const done = [];
for (const band of BANDS) {
  let backoffMin = 2;
  let attempts = 0;
  for (;;) {
    if (Date.now() - started > MAX_HOURS * 3600 * 1000) {
      log(`giving up after ${MAX_HOURS}h`);
      writeStatus({ state: 'gave_up', band, done });
      await notify(`Market Research auto-retry gave up after ${MAX_HOURS}h; band ${band} still incomplete. ⚠️`);
      process.exit(4);
    }
    attempts++;
    const live = await ensureBrowser();
    if (!live) {
      log(`band ${band}: browser session not live; retrying in ${backoffMin}m`);
      writeStatus({ state: 'waiting_browser', band, attempts, done });
      await sleep(backoffMin * 60000);
      backoffMin = Math.min(backoffMin * 2, 30);
      continue;
    }
    log(`band ${band}: attempt ${attempts} starting`);
    writeStatus({ state: 'collecting', band, attempts, done, bandState: bandState(band) });
    const res = await attempt(band);
    const st = bandState(band);
    log(`band ${band}: ${res ? res.status : 'no-result'} — units r/e/f ${st.retained}/${st.empty}/${st.failed}, counties ${st.counties}, zips ${st.zips}`);

    if (res?.status === 'completed') {
      done.push({ band, ...st });
      writeStatus({ state: 'band_complete', band, done });
      await notify(`Market Research band ${band} COMPLETE: ${st.counties} counties, ${st.zips} ZIP rows retained. ✅`);
      break;
    }
    // 'stalled' usually means the provider is down/maintenance → wait longer.
    // 'partial' means real progress; retry promptly to continue.
    if (res?.status === 'partial') { backoffMin = 2; await sleep(20000); continue; }
    if (res?.status === 'auth_needed') {
      log(`band ${band}: LandPortal wants a login — pausing ${backoffMin}m (owner action may be needed)`);
      writeStatus({ state: 'auth_needed', band, attempts, done });
    } else {
      log(`band ${band}: provider unavailable (${res?.note ?? 'no result'}); waiting ${backoffMin}m`);
      writeStatus({ state: 'waiting_provider', band, attempts, done, note: res?.note ?? null });
    }
    await sleep(backoffMin * 60000);
    backoffMin = Math.min(backoffMin * 2, 30);
  }
}

log('all requested bands complete — running front-end verification');
writeStatus({ state: 'verifying', done });
try {
  const { stdout } = await run('node', ['scripts/tmp-mr-band-verify.mjs'], { cwd: ROOT, maxBuffer: 1024 * 1024 * 64 });
  const tail = stdout.trim().split('\n').slice(-3).join(' | ');
  log(`verification: ${tail}`);
  writeStatus({ state: 'done', done, verification: tail });
  await notify(`Market Research all bands complete. Verification: ${tail} ✅`);
} catch (e) {
  log(`verification failed to run: ${String(e).slice(0, 200)}`);
  writeStatus({ state: 'done_verify_failed', done });
  await notify('Market Research bands complete, but the verification script failed to run. ⚠️');
}
log('AUTO-RETRY DONE');
