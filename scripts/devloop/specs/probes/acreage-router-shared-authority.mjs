// Evaluator-owned probe: the router is the SHARED acreage input.
//
// Before this repair, three modules each invented their own acreage assumption
// for the same subject: comp-recency-window gated valuation at 40-160 acres for
// a 60-acre subject (throwing away a 39.94-acre sale), deal-intelligence-comps
// used 30-150, and comparable-intelligence used a label band plus a 0.5x-2x
// ratio. Comp selection and valuation must now read ONE router.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const url = (rel) => JSON.stringify(pathToFileURL(path.join(root, rel)).href);

function fail(reason) {
  console.log(`PROBE_FAIL: ${reason}`);
  process.exit(1);
}

// Every consumer must actually import the router; a copied constant is not a
// shared authority and would drift again.
for (const consumer of [
  'src/landos/comp-recency-window.ts',
  'src/landos/deal-intelligence-comps.ts',
  'src/landos/comparable-intelligence.ts',
  'src/landos/comps-valuation.ts',
]) {
  let text;
  try {
    text = readFileSync(path.join(root, consumer), 'utf8');
  } catch (error) {
    fail(`could not read ${consumer} (${error.message})`);
  }
  if (!/from\s+['"][^'"]*acreage-router(\.js)?['"]/.test(text)) {
    fail(`${consumer} does not import ./acreage-router — comp selection and valuation must read the shared router instead of keeping their own acreage assumption`);
  }
}

const script = `
import { routeAcreage, inAcreagePool } from ${url('src/landos/acreage-router.ts')};
import { valuationAcreageBand, inAcreageBand } from ${url('src/landos/comp-recency-window.ts')};
import { acreageBand } from ${url('src/landos/deal-intelligence-comps.ts')};

function fail(reason: string): never { console.log('PROBE_FAIL: ' + reason); process.exit(1); }
function ok(cond: unknown, reason: string) { if (!cond) fail(reason); }
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

const route = routeAcreage(60);
ok(route, 'routeAcreage(60) returned null');
const pool = route!.pool;

// ── Valuation window (comp-recency-window) reads the router. ───────────────
const band = valuationAcreageBand(60);
ok(band, 'valuationAcreageBand(60) returned null');
ok(near(band!.min, pool.min) && near(band!.max, pool.max),
  'valuationAcreageBand(60) = ' + JSON.stringify({ min: band!.min, max: band!.max }) +
  ' must equal the router pool ' + JSON.stringify({ min: pool.min, max: pool.max }));

for (const acres of [39.94, 40, 85.32]) {
  ok(inAcreageBand(acres, band), acres + ' acres must be inside the valuation acreage band for a 60-acre subject; the old 40-160 window discarded the 39.94-acre sale outright');
}

// ── Comp selection (deal-intelligence-comps) reads the same router. ────────
const sel = acreageBand(60);
ok(sel, 'acreageBand(60) returned null');
ok(near(sel!.lo, pool.min) && near(sel!.hi, pool.max),
  'deal-intelligence-comps acreageBand(60) = ' + JSON.stringify(sel) +
  ' must equal the router pool ' + JSON.stringify({ min: pool.min, max: pool.max }) + '; comp selection and valuation may not hold different acreage assumptions');

// ── Small acreage still gated tightly, through the same one authority. ─────
const smallRoute = routeAcreage(3);
const smallBand = valuationAcreageBand(3);
const smallSel = acreageBand(3);
ok(smallBand && near(smallBand.min, smallRoute!.pool.min) && near(smallBand.max, smallRoute!.pool.max), 'valuationAcreageBand(3) must equal the router pool for a 3-acre subject');
ok(smallSel && near(smallSel.lo, smallRoute!.pool.min) && near(smallSel.hi, smallRoute!.pool.max), 'acreageBand(3) must equal the router pool for a 3-acre subject');
ok(!inAcreageBand(40, smallBand), 'a 40-acre sale must still be outside a 3-acre subject valuation band');
ok(!inAcreagePool(40, smallRoute), 'a 40-acre sale must still be outside a 3-acre subject router pool');

// ── No subject acreage: nothing is invented on either surface. ─────────────
ok(valuationAcreageBand(null) === null, 'valuationAcreageBand(null) must stay null');
ok(acreageBand(null) === null, 'acreageBand(null) must stay null');

console.log('PROBE_OK shared acreage authority');
`;

const dir = mkdtempSync(path.join(os.tmpdir(), 'landos-probe-'));
const file = path.join(dir, 'probe.mts');
writeFileSync(file, script, 'utf8');

const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const run = spawnSync(process.execPath, [tsx, file], { cwd: root, encoding: 'utf8', timeout: 240000 });
const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
process.stdout.write(out);
if (run.status !== 0 && !out.includes('PROBE_FAIL')) {
  console.log(`PROBE_FAIL: shared-authority probe could not run (exit ${run.status}): ${String(run.stderr ?? run.error ?? '').slice(0, 700)}`);
}
process.exit(run.status === 0 ? 0 : 1);
