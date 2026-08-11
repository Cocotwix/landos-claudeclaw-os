// Evaluator-owned probe: distance is calculated and visible, and geographic
// expansion is intentional and explainable.
//
// The old behaviour failed at a hard 20-mile cutoff and silently dropped any
// comp whose distance could not be established. Expansion must instead step
// outward on purpose, stay visible, and never discard a row on distance alone.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const url = (rel) => JSON.stringify(pathToFileURL(path.join(root, rel)).href);

const script = `
import {
  routeAcreage, compDistanceMiles, resolveGeographicTier,
  describeGeographicExpansion, GEOGRAPHIC_TIERS,
} from ${url('src/landos/acreage-router.ts')};

function fail(reason: string): never { console.log('PROBE_FAIL: ' + reason); process.exit(1); }
function ok(cond: unknown, reason: string) { if (!cond) fail(reason); }

// 9490 Elk Lake Rd, Williamsburg MI — the acceptance subject.
const SUBJECT = { lat: 44.822439610896, lng: -85.404821349666 };

// Independent haversine, computed here so the probe never trusts the module.
function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.7613;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ── Straight-line distance from the subject. ───────────────────────────────
for (const target of [
  { lat: 44.9, lng: -85.5 },
  { lat: 44.7612, lng: -85.6206 },
  { lat: 45.02, lng: -85.20 },
  { lat: 44.822439610896, lng: -85.404821349666 },
]) {
  const got = compDistanceMiles(SUBJECT, target);
  const want = haversine(SUBJECT, target);
  ok(typeof got === 'number' && Number.isFinite(got), 'compDistanceMiles returned ' + JSON.stringify(got) + ' for ' + JSON.stringify(target));
  ok(Math.abs((got as number) - want) < 0.5, 'compDistanceMiles gave ' + got + ' mi but straight-line distance is ' + want.toFixed(2) + ' mi for ' + JSON.stringify(target));
}

// Never invented: no coordinates on either side means no distance.
ok(compDistanceMiles(null, { lat: 44.9, lng: -85.5 }) === null, 'compDistanceMiles must return null when the subject has no coordinates');
ok(compDistanceMiles(SUBJECT, null) === null, 'compDistanceMiles must return null when the comp has no coordinates');
ok(compDistanceMiles(SUBJECT, { lat: Number.NaN, lng: -85.5 } as { lat: number; lng: number }) === null, 'compDistanceMiles must return null for a non-finite coordinate');

// ── Expansion ladder. ─────────────────────────────────────────────────────
ok(Array.isArray(GEOGRAPHIC_TIERS) && GEOGRAPHIC_TIERS.length >= 4, 'GEOGRAPHIC_TIERS must publish the expansion ladder, got ' + JSON.stringify(GEOGRAPHIC_TIERS));
for (const tier of GEOGRAPHIC_TIERS) {
  ok(typeof tier.id === 'string' && tier.id.length > 0, 'every geographic tier needs an id');
  ok(typeof tier.label === 'string' && tier.label.trim().length > 0, 'every geographic tier needs an operator-facing label, tier ' + tier.id);
  ok(typeof tier.rationale === 'string' && tier.rationale.trim().length > 0, 'every geographic tier needs a rationale, tier ' + tier.id);
  ok(tier.retained === true, 'tier ' + tier.id + ' must be retained; nothing is discarded on distance alone');
  ok(typeof tier.weightMultiplier === 'number' && tier.weightMultiplier > 0 && tier.weightMultiplier <= 1, 'tier ' + tier.id + ' needs a 0<w<=1 weight multiplier, got ' + tier.weightMultiplier);
}

const local = resolveGeographicTier(4);
ok(local.expanded === false, 'a 4-mile comp is local, not an expansion, got ' + JSON.stringify(local));
ok(local.weightMultiplier === 1, 'a local comp must carry full geographic weight, got ' + local.weightMultiplier);

const near20 = resolveGeographicTier(16);
ok(near20.expanded === true, 'a 16-mile comp must be marked as an expansion');
ok(near20.retained === true, 'a 16-mile comp must be retained');

// The old hard 20-mile cutoff is gone.
const past20 = resolveGeographicTier(26);
ok(past20.retained === true, 'a 26-mile comp must still be retained; the hard 20-mile cutoff was the defect');
ok(past20.expanded === true, 'a 26-mile comp must be marked as an expansion');
ok(past20.id !== local.id, 'a 26-mile comp must not resolve to the same tier as a 4-mile comp');
ok(past20.weightMultiplier < local.weightMultiplier, 'a 26-mile comp must rank below a local comp, got ' + past20.weightMultiplier + ' vs ' + local.weightMultiplier);

const far = resolveGeographicTier(47);
ok(far.retained === true && far.expanded === true, 'a 47-mile comp must be retained and marked as an expansion');
ok(far.weightMultiplier <= past20.weightMultiplier, 'weight must not increase with distance (' + far.weightMultiplier + ' at 47mi vs ' + past20.weightMultiplier + ' at 26mi)');

// Unresolvable location is a stated condition, not a silent deletion. The real
// 9490 LandPortal rows carry no coordinates and no address.
const unresolved = resolveGeographicTier(null);
ok(unresolved.id === 'distance_unresolved', "a comp with no resolvable location must resolve to the 'distance_unresolved' tier, got '" + unresolved.id + "'");
ok(unresolved.retained === true, 'a comp with no resolvable location must be RETAINED and ranked, never dropped for a missing distance');
ok(unresolved.weightMultiplier < 1, 'an unresolved-distance comp must rank below a located comp');
ok(/distance|location/i.test(unresolved.label + ' ' + unresolved.rationale), 'the unresolved tier must say plainly that the distance could not be resolved');

// Monotonic ladder: farther never resolves to a nearer tier's maxMiles.
const ladder = [2, 9, 12, 19, 24, 33, 44, 60].map((d) => resolveGeographicTier(d));
for (let i = 1; i < ladder.length; i += 1) {
  ok(ladder[i].weightMultiplier <= ladder[i - 1].weightMultiplier, 'geographic weight must be non-increasing with distance; ' + ladder[i - 1].id + ' -> ' + ladder[i].id);
}

// ── Expansion is explainable to the operator. ─────────────────────────────
const route = routeAcreage(60);
const text = describeGeographicExpansion({
  route,
  tiersUsed: [local.id, past20.id, unresolved.id],
  usableCount: 6,
});
ok(typeof text === 'string' && text.trim().length >= 40, 'describeGeographicExpansion must return an operator-readable explanation, got ' + JSON.stringify(text));
ok(/mile/i.test(text), 'the expansion explanation must state distances in miles: ' + text);
for (const tier of [local, past20, unresolved]) {
  ok(text.includes(tier.label), 'the expansion explanation must name the tier it used ("' + tier.label + '"): ' + text);
}

const noExpansion = describeGeographicExpansion({ route, tiersUsed: [local.id], usableCount: 5 });
ok(typeof noExpansion === 'string' && noExpansion.trim().length > 0, 'describeGeographicExpansion must still explain the local-only case');

console.log('PROBE_OK distance and geographic expansion');
`;

const dir = mkdtempSync(path.join(os.tmpdir(), 'landos-probe-'));
const file = path.join(dir, 'probe.mts');
writeFileSync(file, script, 'utf8');

const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const run = spawnSync(process.execPath, [tsx, file], { cwd: root, encoding: 'utf8', timeout: 240000 });
const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
process.stdout.write(out);
if (run.status !== 0 && !out.includes('PROBE_FAIL')) {
  console.log(`PROBE_FAIL: distance/expansion probe could not run (exit ${run.status}): ${String(run.stderr ?? run.error ?? '').slice(0, 700)}`);
}
process.exit(run.status === 0 ? 0 : 1);
