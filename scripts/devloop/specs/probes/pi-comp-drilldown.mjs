// Evaluator-owned probe: the LandPortal comp drill-down, images and location.
//
// Hermes currently copies the five sold rows out of the subject-page sidebar
// and stops. That is not the comp workflow. Each sidebar row must be followed
// through LandPortal's own Show-on-Map / comp-detail surface, and whatever that
// surface exposes — address, city/state/ZIP, APN, acreage, sold price, sale
// date, $/acre, a usable map location, the comp image — must be retained with
// its source.
//
// Nothing is invented. A comp whose location genuinely cannot be resolved after
// the drill-down stays honestly unresolved and keeps the reduced geographic
// weight the acreage router already defines, rather than being deleted or given
// a made-up distance.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const url = (rel) => JSON.stringify(pathToFileURL(path.join(root, rel)).href);

const script = `
import {
  planCompDrilldown,
  mergeCompDetail,
  buildLandPortalCompPersistence,
  compVisualForLandPortalComp,
} from ${url('src/landos/landportal-comp-drilldown.ts')};
import { resolveGeographicTier, compDistanceMiles } from ${url('src/landos/acreage-router.ts')};

function fail(reason: string): never { console.log('PROBE_FAIL: ' + reason); process.exit(1); }
function ok(cond: unknown, reason: string) { if (!cond) fail(reason); }
function near(a: number, b: number, tol: number) { return Number.isFinite(a) && Math.abs(a - b) <= tol; }

// The real 9490 Elk Lake Rd subject and its five real LandPortal sidebar rows.
const SUBJECT = { lat: 44.822439610896, lng: -85.404821349666, fips: '26055' };
const SIDEBAR = [
  { propertyId: 'c1', apn: '12-004-006-00', price: 400000, acres: 40, saleDate: '2025-03-21' },
  { propertyId: 'c2', apn: '08-002-001-00', price: 1100000, acres: 85.32, saleDate: '2026-02-12' },
  { propertyId: 'c3', apn: '03-104-001-00', price: 400000, acres: 40, saleDate: '2025-03-21' },
  { propertyId: 'c4', apn: '03-231-013-00', price: 375000, acres: 40, saleDate: '2025-02-04' },
  { propertyId: 'c5', apn: '03-106-009-11', price: 390000, acres: 39.94, saleDate: '2025-04-04' },
];

// ── 1. Every sidebar comp gets an actual drill-down step ────────────────────
const steps = planCompDrilldown(SIDEBAR as never, SUBJECT);
ok(Array.isArray(steps) && steps.length === SIDEBAR.length,
  'every LandPortal sidebar comp must get a drill-down step; got ' + (steps?.length ?? 0) + ' step(s) for ' + SIDEBAR.length + ' comps');
ok(new Set(steps.map((s: { compKey: string }) => s.compKey)).size === SIDEBAR.length, 'each step must key to a distinct comp');
for (const step of steps) {
  ok(['open_comp_detail', 'show_on_map'].includes(step.action),
    'a drill-down step must open the comp detail or the Show-on-Map surface, got "' + String(step.action) + '"');
  ok(Array.isArray(step.capture) && step.capture.length >= 3,
    'each step must name what to capture from the comp surface, got ' + JSON.stringify(step.capture));
  const wants = step.capture.map((c: string) => String(c).toLowerCase()).join(' ');
  for (const needle of ['address', 'acre', 'image']) {
    ok(wants.includes(needle), 'a drill-down step must capture "' + needle + '", got ' + JSON.stringify(step.capture));
  }
  ok(typeof step.reason === 'string' && step.reason.trim().length >= 20, 'each step must state why it is being taken');
}
ok(planCompDrilldown([] as never, SUBJECT).length === 0, 'no comps means no steps, not an invented one');

// ── 2. A resolvable comp gets a real, computed distance ─────────────────────
const resolved = mergeCompDetail(
  SIDEBAR[0] as never,
  {
    address: '4821 Bates Rd', city: 'Williamsburg', state: 'MI', zip: '49690',
    apn: '12-004-006-00', acres: 40.12, price: 400000, saleDate: '2025-03-21', pricePerAcre: 9970,
    lat: 44.86, lng: -85.44,
    imageUrl: 'https://images.thelandportal.com/comps/c1.jpg', imageSourceLabel: 'LandPortal',
    detailUrl: 'https://landportal.com/?property=comp-c1',
  } as never,
  SUBJECT,
);
ok(resolved.address === '4821 Bates Rd', 'the comp street address from the detail surface must be retained');
ok(resolved.city === 'Williamsburg' && resolved.state === 'MI' && resolved.zip === '49690', 'city/state/ZIP must be retained');
ok(resolved.apn === '12-004-006-00', 'the comp APN must be retained');
ok(resolved.acres === 40.12, 'the comp detail page is the stronger surface, so its acreage wins over the sidebar figure, got ' + String(resolved.acres));
ok(resolved.price === 400000 && resolved.saleDate === '2025-03-21', 'price and sale date must survive the merge');
ok(resolved.detailUrl === 'https://landportal.com/?property=comp-c1', 'the comp detail url must be retained as provenance');
ok(resolved.drilledDown === true, 'a comp merged with detail data must be marked as drilled down, not sidebar-only');
ok(Array.isArray(resolved.provenance) && resolved.provenance.some((p: string) => /detail|comp page|drill/i.test(p)),
  'provenance must record that the values came from the comp detail surface, got ' + JSON.stringify(resolved.provenance));

const expected = compDistanceMiles(SUBJECT, { lat: 44.86, lng: -85.44 });
ok(expected != null, 'the shared router must compute a distance for two located points');
ok(resolved.locationResolution.resolved === true, 'a comp with coordinates must resolve its location');
ok(resolved.locationResolution.basis === 'coordinates', "basis must be 'coordinates', got '" + String(resolved.locationResolution.basis) + "'");
ok(near(resolved.locationResolution.distanceMiles, expected as number, 0.01),
  'straight-line distance must be the router computation (' + String(expected) + '), got ' + String(resolved.locationResolution.distanceMiles));
ok(near(resolved.locationResolution.distanceMiles, 3.115, 0.05),
  'the 3.1-mile comp must compute to roughly 3.115 miles from the 9490 subject, got ' + String(resolved.locationResolution.distanceMiles));
ok(resolved.locationResolution.tierId === resolveGeographicTier(expected as number).id,
  'the tier must come from the shared router ladder, got ' + String(resolved.locationResolution.tierId));
ok(resolved.locationResolution.weightMultiplier === resolveGeographicTier(expected as number).weightMultiplier,
  'the geographic weight must come from the shared router ladder');
ok(/mile/i.test(String(resolved.locationResolution.statement)), 'the operator statement must state the distance in miles, got ' + JSON.stringify(resolved.locationResolution.statement));

// A far comp is retained and its expansion stated, never discarded.
const far = mergeCompDetail(SIDEBAR[1] as never, { lat: 45.10, lng: -85.70, address: '1200 Torch Lake Dr' } as never, SUBJECT);
ok(far.locationResolution.resolved === true, 'a 24-mile comp still resolves');
ok(near(far.locationResolution.distanceMiles, 24.0, 0.1), 'the far comp must compute to roughly 24 miles, got ' + String(far.locationResolution.distanceMiles));
ok(far.locationResolution.tierId !== 'distance_unresolved', 'a located comp is never filed as location-unresolved');
ok(resolveGeographicTier(far.locationResolution.distanceMiles as number).expanded === true, 'a 24-mile comp sits in an expanded tier');

// ── 3. An unresolvable comp stays honestly unresolved ──────────────────────
const unresolved = mergeCompDetail(SIDEBAR[4] as never, {} as never, SUBJECT);
ok(unresolved.address === null, 'no address on the detail surface means address null, never a guess; got ' + JSON.stringify(unresolved.address));
ok(unresolved.lat === null && unresolved.lng === null, 'coordinates are never invented');
ok(unresolved.acres === 39.94 && unresolved.price === 390000, 'the sidebar figures must survive a detail surface that added nothing');
ok(unresolved.locationResolution.resolved === false, 'a comp with no location must report resolved=false');
ok(unresolved.locationResolution.basis === 'unresolved', "basis must be 'unresolved'");
ok(unresolved.locationResolution.distanceMiles === null, 'an unresolved comp must carry a null distance, never a fabricated one');
ok(unresolved.locationResolution.tierId === 'distance_unresolved', 'an unresolved comp must sit in the router distance_unresolved tier');
const unresolvedTier = resolveGeographicTier(null);
ok(unresolved.locationResolution.weightMultiplier === unresolvedTier.weightMultiplier,
  'an unresolved comp keeps the router reduced weight, got ' + String(unresolved.locationResolution.weightMultiplier));
ok(unresolvedTier.retained === true && unresolved.locationResolution.weightMultiplier > 0,
  'an unresolved comp is RANKED DOWN, never deleted and never zero-weighted');
ok(/could not|unresolved|not resolved/i.test(String(unresolved.locationResolution.statement)),
  'the operator statement must say plainly that the location could not be resolved, got ' + JSON.stringify(unresolved.locationResolution.statement));
ok(unresolved.drilledDown === false || unresolved.provenance.some((p: string) => /no (?:usable )?location|nothing/i.test(p)),
  'a drill-down that exposed no location must say so rather than implying enrichment happened');

// ── 4. Comp images are retained with correct source labelling ──────────────
const photo = compVisualForLandPortalComp(resolved);
ok(photo.url === 'https://images.thelandportal.com/comps/c1.jpg', 'the retained LandPortal comp image must be surfaced');
ok(photo.provenance === 'listing_photo', 'a genuine LandPortal comp image must not be downgraded, got "' + String(photo.provenance) + '"');
ok(/landportal/i.test(String(photo.label)) && /thumbnail/i.test(String(photo.label)),
  'a LandPortal comp image must be labelled a LandPortal listing thumbnail, got ' + JSON.stringify(photo.label));

const noPhoto = compVisualForLandPortalComp(unresolved);
ok(noPhoto.provenance !== 'listing_photo', 'fallback imagery must NEVER be labelled a listing photo, got "' + String(noPhoto.provenance) + '"');
ok(noPhoto.isPhotograph === false, 'a comp with no retained image must not claim a photograph is on screen');

// ── 5. What actually gets persisted ────────────────────────────────────────
const row = buildLandPortalCompPersistence(resolved);
ok(row.address_desc === '4821 Bates Rd', 'the persisted row must carry the comp address');
ok(row.city === 'Williamsburg' && row.zip === '49690', 'the persisted row must carry city and ZIP');
ok(row.lat === 44.86 && row.lng === -85.44, 'the persisted row must carry the resolved coordinates');
ok(near(row.distance_miles as number, 3.115, 0.05), 'the persisted row must carry the computed distance, got ' + String(row.distance_miles));
ok(row.thumbnail_url === 'https://images.thelandportal.com/comps/c1.jpg', 'the persisted row must carry the comp image url');
ok(row.source_url === 'https://landportal.com/?property=comp-c1', 'the persisted row must carry the comp detail url as its source');
ok(row.price_kind === 'sale', 'a LandPortal comp with a source-stated sale date persists as a sale, got "' + String(row.price_kind) + '"');
ok(typeof row.notes === 'string' && /landportal/i.test(row.notes), 'the persisted row must carry LandPortal provenance in its notes');

const unresolvedRow = buildLandPortalCompPersistence(unresolved);
ok(unresolvedRow.lat === null && unresolvedRow.lng === null && unresolvedRow.distance_miles === null,
  'an unresolved comp must persist null location fields, never zeros or guesses');
ok(!unresolvedRow.thumbnail_url, 'a comp with no retained image must persist no thumbnail url, got ' + JSON.stringify(unresolvedRow.thumbnail_url));

console.log('PROBE_OK landportal comp drill-down, images and location');
`;

const dir = mkdtempSync(path.join(os.tmpdir(), 'landos-probe-'));
const file = path.join(dir, 'probe.mts');
writeFileSync(file, script, 'utf8');

const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const run = spawnSync(process.execPath, [tsx, file], { cwd: root, encoding: 'utf8', timeout: 240000 });
const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
process.stdout.write(out);
if (run.status !== 0 && !out.includes('PROBE_FAIL')) {
  console.log(`PROBE_FAIL: comp drill-down probe could not run (exit ${run.status}): ${String(run.stderr ?? run.error ?? '').slice(0, 700)}`);
}
process.exit(run.status === 0 ? 0 : 1);
