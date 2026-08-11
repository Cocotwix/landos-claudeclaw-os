// Evaluator-owned probe: the Improved Acreage Router's regime + pool behaviour.
//
// Large-acreage subjects (roughly 30 through 100 acres) must route into a BROAD
// comp pool, because narrow acreage buckets are too thin to be useful there. A
// 40-acre sale has to be able to reach a 60-acre subject. Small acreage keeps
// tight matching, because $/acre behaviour changes materially between small
// size bands.
//
// The probe drives the real TypeScript module through tsx from a temp directory
// outside the worktree, so the builder cannot weaken it by editing a test file.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const url = (rel) => JSON.stringify(pathToFileURL(path.join(root, rel)).href);

const script = `
import { routeAcreage, inAcreagePool, routedAcreageSimilarity } from ${url('src/landos/acreage-router.ts')};

function fail(reason: string): never { console.log('PROBE_FAIL: ' + reason); process.exit(1); }
function ok(cond: unknown, reason: string) { if (!cond) fail(reason); }

// ── No subject acreage means no route. A route is never invented. ────────────
for (const bad of [null, undefined, 0, -5, Number.NaN]) {
  if (routeAcreage(bad as number) !== null) fail('routeAcreage(' + String(bad) + ') must be null; a route is never invented without a subject acreage');
}

// ── The 9490 Elk Lake Rd subject: 60 acres. ─────────────────────────────────
const subject = routeAcreage(60);
ok(subject, 'routeAcreage(60) returned null for the 60-acre 9490 Elk Lake Rd subject');
ok(subject!.subjectAcres === 60, 'route.subjectAcres should echo 60, got ' + String(subject!.subjectAcres));
ok(subject!.regime === 'large', "a 60-acre subject must route into the 'large' regime, got '" + String(subject!.regime) + "'");
ok(subject!.tightAcreageMatching === false, 'a 60-acre subject must NOT use tight acreage matching; narrow buckets are too thin at that size');

const pool = subject!.pool;
ok(pool && Number.isFinite(pool.min) && Number.isFinite(pool.max) && pool.max > pool.min, 'route.pool must be a finite {min,max} window, got ' + JSON.stringify(pool));

// The real LandPortal sold land records LandOS already holds for 9490.
for (const acres of [39.94, 40, 85.32]) {
  ok(inAcreagePool(acres, subject), acres + '-acre sold land must sit inside the 60-acre subject broad comp pool ' + JSON.stringify(pool) + '; it is real valuation evidence, not context');
}
ok(pool.min <= 39.94, 'the large-acreage pool floor (' + pool.min + ') must reach at or below 39.94 acres; the old 40-acre floor discarded a 39.94-acre sale by six hundredths of an acre');
ok(pool.max >= 85.32, 'the large-acreage pool ceiling (' + pool.max + ') must reach at or above 85.32 acres');
const largeSpread = pool.max / pool.min;
ok(largeSpread >= 3, 'the large-acreage pool must be genuinely broad (max/min >= 3), got ' + largeSpread.toFixed(2));

ok(typeof subject!.rationale === 'string' && subject!.rationale.trim().length >= 40, 'route.rationale must be an operator-readable explanation of why the pool is this wide, got ' + JSON.stringify(subject!.rationale));
ok(Array.isArray(subject!.rankingEmphasis) && subject!.rankingEmphasis.length >= 3, 'route.rankingEmphasis must name what does the ranking once acreage stops discriminating, got ' + JSON.stringify(subject!.rankingEmphasis));
ok(typeof subject!.regimeLabel === 'string' && subject!.regimeLabel.trim().length > 0, 'route.regimeLabel must be a non-empty operator-facing label');

// A preferred window still exists inside the pool, so similarity can still rank.
const pref = subject!.preferred;
ok(pref && pref.min >= pool.min && pref.max <= pool.max && pref.max > pref.min, 'route.preferred must be a narrower window inside the pool, got ' + JSON.stringify(pref) + ' inside ' + JSON.stringify(pool));

// ── Small acreage keeps tight matching. ─────────────────────────────────────
const small = routeAcreage(3);
ok(small, 'routeAcreage(3) returned null');
ok(small!.tightAcreageMatching === true, 'a 3-acre subject must keep tight acreage matching');
ok(!inAcreagePool(40, small), 'a 40-acre sale must NOT enter a 3-acre subject comp pool ' + JSON.stringify(small!.pool));
const smallSpread = small!.pool.max / small!.pool.min;
ok(smallSpread < largeSpread, 'the small-acreage pool (spread ' + smallSpread.toFixed(2) + ') must be materially tighter than the large-acreage pool (spread ' + largeSpread.toFixed(2) + ')');

const micro = routeAcreage(1);
ok(micro && micro.tightAcreageMatching === true, 'a 1-acre subject must keep tight acreage matching');

// ── Regime boundaries follow the operator rule: broad from about 30 up to about 100. ──
ok(routeAcreage(32)!.regime === 'large', "a 32-acre subject must already be in the 'large' regime, got '" + routeAcreage(32)!.regime + "'");
ok(routeAcreage(95)!.regime === 'large', "a 95-acre subject must still be in the 'large' regime, got '" + routeAcreage(95)!.regime + "'");
ok(routeAcreage(20)!.regime !== 'large', "a 20-acre subject must not be in the 'large' regime");
ok(routeAcreage(20)!.tightAcreageMatching === true, 'a 20-acre subject keeps tighter acreage matching');
ok(routeAcreage(400)!.regime === 'very_large', "a 400-acre subject must route into 'very_large', got '" + routeAcreage(400)!.regime + "'");
ok(routeAcreage(400)!.tightAcreageMatching === false, 'a 400-acre subject must not use tight acreage matching');

// ── Similarity still ranks inside the broad pool. ───────────────────────────
const at60 = routedAcreageSimilarity(60, subject);
const at55 = routedAcreageSimilarity(55, subject);
const at40 = routedAcreageSimilarity(40, subject);
const at85 = routedAcreageSimilarity(85.32, subject);
ok(at60 > 0.99, 'an exact 60-acre match must score ~1, got ' + at60);
ok(at55 > at40, 'a 55-acre sale must rank above a 40-acre sale for a 60-acre subject (' + at55 + ' vs ' + at40 + ')');
ok(at40 > 0, 'a 40-acre sale must carry NON-ZERO acreage weight for a 60-acre subject; zero weight is the defect being repaired');
ok(at85 > 0, 'an 85.32-acre sale must carry non-zero acreage weight for a 60-acre subject');
ok(routedAcreageSimilarity(400, subject) === 0, 'a 400-acre sale is outside the pool and must score 0');
for (const v of [at60, at55, at40, at85]) ok(v >= 0 && v <= 1, 'routedAcreageSimilarity must stay within 0..1, got ' + v);

console.log('PROBE_OK acreage router regimes and pools');
`;

const dir = mkdtempSync(path.join(os.tmpdir(), 'landos-probe-'));
const file = path.join(dir, 'probe.mts');
writeFileSync(file, script, 'utf8');

const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const run = spawnSync(process.execPath, [tsx, file], { cwd: root, encoding: 'utf8', timeout: 240000 });
const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
process.stdout.write(out);
if (run.status !== 0 && !out.includes('PROBE_FAIL')) {
  console.log(`PROBE_FAIL: acreage router probe could not run (exit ${run.status}): ${String(run.stderr ?? run.error ?? '').slice(0, 700)}`);
}
process.exit(run.status === 0 ? 0 : 1);
