// Evaluator-owned probe: the Hermes capture contract and the wiring.
//
// The new modules are worthless if nothing calls them. This probe requires
// three things:
//   1. The live Hermes work-unit assignment, the SOP, and the LandPortal skill
//      all instruct the new capture behaviour consistently — the deliberate
//      Overview frame, landlocked triggering visual access investigation, the
//      Street View pass on the nearest public road, comp drill-down, and comp
//      image retention.
//   2. The importer actually admits what those workers now hand back: enriched
//      comp fields, an Overview artifact, and structured access evidence.
//   3. The new modules are wired into the real code paths rather than sitting
//      beside them.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const url = (rel) => JSON.stringify(pathToFileURL(path.join(root, rel)).href);

let failed = false;
function fail(reason) { console.log('PROBE_FAIL: ' + reason); failed = true; }

// ── 3. Wiring, checked at the source level ─────────────────────────────────
const wiring = [
  ['src/landos/hermes-landportal-import.ts', 'landportal-comp-drilldown', 'the importer must persist LandPortal comps through the drill-down module'],
  ['src/landos/hermes-landportal-import.ts', 'access-evidence-ladder', 'the importer must file access findings through the evidence ladder'],
  ['src/landos/hermes-landportal-import.ts', 'landportal-overview-capture', 'the importer must select the Overview visual through the overview module'],
  ['src/landos/comp-source-policy.ts', 'comp-lane-accountability', 'the comp source policy must report lane accountability'],
  ['src/landos/property-intelligence-live.ts', 'exact-address-web-discovery', 'the live orchestrator must run the exact-address web discovery lane'],
  ['src/landos/property-intelligence-live.ts', 'comp-lane-accountability', 'the live orchestrator must record each comp lane outcome'],
  ['src/landos/discovery-access-presentation.ts', 'access-evidence-ladder', 'the operator access presentation must be driven by the evidence ladder'],
];
for (const [file, moduleName, why] of wiring) {
  let text = '';
  try { text = readFileSync(path.join(root, file), 'utf8'); } catch { fail(`${file} could not be read`); continue; }
  const importsIt = new RegExp(`from\\s+['"][^'"]*${moduleName}(?:\\.js)?['"]`).test(text);
  if (!importsIt) fail(`${file} does not import ${moduleName}: ${why}`);
}

// ── 1. The Hermes capture contract, stated consistently in all three places ─
const collapse = (value) => value.replace(/\s+/g, ' ').toLowerCase();
const surfaces = [
  ['docs/landos/property-intelligence-sop.md', 'the Property Intelligence SOP'],
  ['config/hermes/landos-profile/skills/landos-landportal/SKILL.md', 'the live LandPortal skill'],
];
const requirements = [
  [/overview/, 'the Overview capture'],
  [/nearest (?:public )?road|road relationship/, 'framing the parcel against the nearest road'],
  [/land ?locked/, 'the land locked flag'],
  [/street ?view/, 'the Street View pass'],
  [/apparent (?:gravel |physical )?(?:drive|access)|access route|driveway/, 'apparent access route evidence'],
  [/comp(?:arable)? detail|show on map|drill/, 'the comp drill-down'],
  [/thumbnail|comp image|comparable image/, 'retaining the comp image'],
];
for (const [file, label] of surfaces) {
  let text = '';
  try { text = collapse(readFileSync(path.join(root, file), 'utf8')); } catch { fail(`${label} (${file}) could not be read`); continue; }
  for (const [pattern, why] of requirements) {
    if (!pattern.test(text)) fail(`${label} does not state ${why} (${file})`);
  }
}

// Each new module ships a real suite of its own, not a placeholder.
for (const [suite, minimum] of [
  ['src/landos/access-evidence-ladder.test.ts', 10],
  ['src/landos/landportal-overview-capture.test.ts', 8],
  ['src/landos/exact-address-web-discovery.test.ts', 10],
  ['src/landos/landportal-comp-drilldown.test.ts', 10],
  ['src/landos/comp-lane-accountability.test.ts', 8],
]) {
  let text = '';
  try { text = readFileSync(path.join(root, suite), 'utf8'); } catch { fail(`${suite} is missing: every new module needs its own suite`); continue; }
  const count = (text.match(/(?:^|\s)(?:it|test)(?:\.each\([\s\S]*?\))?\(/g) ?? []).length;
  if (count < minimum) fail(`${suite} has ${count} test(s); at least ${minimum} are required for this module`);
  if (/\.(?:skip|todo)\s*\(/.test(text)) fail(`${suite} contains a skipped or todo test`);
}

// The live work-unit assignment itself must carry the new instructions, not
// only the reference documents.
let autoText = '';
try { autoText = collapse(readFileSync(path.join(root, 'src/landos/hermes-landportal-auto.ts'), 'utf8')); } catch { fail('hermes-landportal-auto.ts could not be read'); }
for (const [pattern, why] of [
  [/landportal_overview|overview/, 'the Overview capture in the requested visuals'],
  [/land ?locked/, 'the landlocked access investigation trigger'],
  [/comp(?:arable)? detail|show on map|drill/, 'the comp drill-down'],
  [/image_url|comp image|thumbnail/, 'retaining the comp image'],
]) {
  if (!pattern.test(autoText)) fail(`the Hermes work-unit assignment does not state ${why} (src/landos/hermes-landportal-auto.ts)`);
}

if (failed) process.exit(1);

// ── 2. The importer admits the enriched handback ───────────────────────────
const script = `
import { parseHermesLandPortalSubject } from ${url('src/landos/hermes-landportal-import.ts')};

function fail(reason: string): never { console.log('PROBE_FAIL: ' + reason); process.exit(1); }
function ok(cond: unknown, reason: string) { if (!cond) fail(reason); }

const handback = {
  subject_url: 'https://landportal.com/?property=subject',
  subject_verification_status: 'exact_match',
  address: '9490 Elk Lake Rd',
  apn: '13-116-015-01',
  county: 'Grand Traverse',
  landlocked_status: 'Yes',
  road_frontage_ft: 0,
  street_view_available: true,
  street_view_note: 'Street View marker placed on Elk Lake Rd at the nearest public road frontage.',
  street_view_observations: [
    { label: 'Apparent entrance', detail: 'An apparent gravel driveway runs from Elk Lake Rd back toward the subject parcel.', basis: 'direct_observation' },
  ],
  access_evidence: [
    {
      tier: 'parcel_flag',
      statement: 'LandPortal flags the parcel as land locked: it does not directly front a recognized named road.',
      source_label: 'LandPortal parcel page',
      source_kind: 'landportal_parcel_flag',
      basis: 'source_stated',
      weight: 'confirmed',
    },
    {
      tier: 'apparent_physical',
      statement: 'Satellite view shows an apparent gray gravel drive from Elk Lake Rd toward the parcel.',
      source_label: 'LandPortal satellite view',
      source_kind: 'satellite_imagery',
      basis: 'direct_observation',
      weight: 'well_supported',
    },
  ],
  visual_artifacts: [{
    key: 'landportal_overview', label: 'Overview', kind: 'parcel_page', purpose: 'landportal_overview',
    source_path: 'overview.png', timestamp: '2026-08-10T12:00:00Z',
    requested_view: 'parcel_context', active_view: 'parcel_context',
    boundary_required: true, boundary_visible: true, tiles_loaded: true,
    camera_scale: 'context', clipped: false, obstructions: [],
  }],
  comps: [{
    price: 400000, acres: 40.12, apn: '12-004-006-00', sale_date: '2025-03-21', price_per_acre: 9970,
    address: '4821 Bates Rd', city: 'Williamsburg', state: 'MI', zip: '49690',
    lat: 44.86, lng: -85.44,
    image_url: 'https://images.thelandportal.com/comps/c1.jpg', image_source: 'LandPortal',
    detail_url: 'https://landportal.com/?property=comp-c1',
    source_url: 'https://landportal.com/?property=comp-c1',
    drilled_down: true,
  }],
};

let parsed;
try { parsed = parseHermesLandPortalSubject(handback); } catch (error) {
  fail('the importer rejected an enriched Hermes handback it must now admit: ' + (error as Error).message);
}

const comp = parsed!.comps[0] as unknown as Record<string, unknown>;
for (const field of ['address', 'city', 'state', 'zip', 'lat', 'lng', 'image_url', 'detail_url']) {
  ok(comp[field] != null && comp[field] !== '', 'the parsed comp lost the drilled-down field "' + field + '": ' + JSON.stringify(comp));
}
ok(comp.lat === 44.86 && comp.lng === -85.44, 'comp coordinates must survive parsing exactly, got ' + JSON.stringify([comp.lat, comp.lng]));
ok(comp.image_url === 'https://images.thelandportal.com/comps/c1.jpg', 'the comp image url must survive parsing');

const access = (parsed as unknown as Record<string, unknown>).access_evidence as Array<Record<string, unknown>> | undefined;
ok(Array.isArray(access) && access.length === 2, 'structured access evidence must be parsed, got ' + JSON.stringify(access));
ok(access![0].tier === 'parcel_flag' && access![1].tier === 'apparent_physical', 'each access evidence item must keep its tier');

ok((parsed!.visual_artifacts ?? []).some((artifact) => artifact.purpose === 'landportal_overview' || artifact.key === 'landportal_overview'),
  'the Overview artifact must survive parsing');

// Nothing is invented when the worker returns nothing extra.
const minimal = parseHermesLandPortalSubject({
  subject_url: 'https://landportal.com/?property=subject',
  subject_verification_status: 'exact_match',
  address: '9490 Elk Lake Rd', apn: '13-116-015-01',
  comps: [{ price: 400000, acres: 40 }],
});
const bare = minimal.comps[0] as unknown as Record<string, unknown>;
for (const field of ['lat', 'lng', 'image_url', 'city']) {
  ok(bare[field] == null || bare[field] === '', 'field "' + field + '" must stay absent when the worker did not return it, got ' + JSON.stringify(bare[field]));
}

// An access evidence item claiming verified legal access from imagery is a
// contract violation the importer must not silently accept as verified.
const overclaim = parseHermesLandPortalSubject({
  subject_url: 'https://landportal.com/?property=subject',
  subject_verification_status: 'exact_match',
  address: '9490 Elk Lake Rd', apn: '13-116-015-01',
  access_evidence: [{
    tier: 'verified_legal', statement: 'The drive has clearly been there for years.',
    source_label: 'LandPortal Street View', source_kind: 'street_view',
    basis: 'reasonable_interpretation', weight: 'likely',
  }],
  comps: [],
});
const claimed = (overclaim as unknown as Record<string, unknown>).access_evidence as Array<Record<string, unknown>>;
ok(Array.isArray(claimed) && claimed.length === 1, 'the item is retained as evidence');
ok(claimed[0].basis === 'reasonable_interpretation', 'the stated basis must be preserved verbatim so the ladder can refuse to verify on it');

console.log('PROBE_OK hermes capture contract and wiring');
`;

const dir = mkdtempSync(path.join(os.tmpdir(), 'landos-probe-'));
const file = path.join(dir, 'probe.mts');
writeFileSync(file, script, 'utf8');

const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const run = spawnSync(process.execPath, [tsx, file], { cwd: root, encoding: 'utf8', timeout: 240000 });
const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
process.stdout.write(out);
if (run.status !== 0 && !out.includes('PROBE_FAIL')) {
  console.log(`PROBE_FAIL: hermes contract probe could not run (exit ${run.status}): ${String(run.stderr ?? run.error ?? '').slice(0, 700)}`);
}
process.exit(run.status === 0 ? 0 : 1);
