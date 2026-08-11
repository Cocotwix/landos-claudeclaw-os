// Evaluator-owned probe: the LandPortal Overview capture.
//
// The operator must be able to look at ONE screenshot in the Overview section
// and immediately understand how the parcel sits relative to the road. That
// means the capture is DELIBERATELY FRAMED — subject boundary, the nearest
// public road, the road relationship, any apparent access route, and the
// surrounding parcels — not whatever default map state happened to be on
// screen, and not a county-scale frame where the parcel is a dot.
//
// Selection is equally deliberate: a rejected or default capture must never be
// promoted into Overview just because it is the only image present.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const url = (rel) => JSON.stringify(pathToFileURL(path.join(root, rel)).href);

const script = `
import {
  planOverviewCapture,
  assessOverviewFraming,
  selectOverviewVisual,
  OVERVIEW_CAPTURE_KEY,
} from ${url('src/landos/landportal-overview-capture.ts')};
import { contextZoomOutSteps } from ${url('src/landos/parcel-visual-framing.ts')};

function fail(reason: string): never { console.log('PROBE_FAIL: ' + reason); process.exit(1); }
function ok(cond: unknown, reason: string) { if (!cond) fail(reason); }

// ── 1. The plan is deliberate framing, not a default map state ──────────────
const plan = planOverviewCapture({ subjectAcres: 60, roadName: 'Elk Lake Rd' });
ok(plan, 'planOverviewCapture returned nothing for the 60-acre 9490 Elk Lake Rd subject');
ok(plan.view === 'parcel_context', "the Overview capture must use the parcel_context satellite framing, got '" + String(plan.view) + "'");
ok(plan.zoomOutSteps === contextZoomOutSteps(60),
  'the Overview zoom must reuse the proven parcel-context zoom rule (' + contextZoomOutSteps(60) + '), got ' + String(plan.zoomOutSteps));
ok(planOverviewCapture({ subjectAcres: 200, roadName: null }).zoomOutSteps === contextZoomOutSteps(200),
  'a very large parcel must follow the same shared zoom rule');
ok(typeof plan.purpose === 'string' && plan.purpose.trim().length > 0, 'the plan must carry a stable capture purpose key');
ok(typeof OVERVIEW_CAPTURE_KEY === 'string' && OVERVIEW_CAPTURE_KEY.trim().length > 0, 'OVERVIEW_CAPTURE_KEY must name the retained Overview artifact');

const intent = String(plan.framingIntent ?? '').toLowerCase();
ok(intent.length >= 60, 'framingIntent must be an operator-readable sentence explaining what the frame must show, got ' + JSON.stringify(plan.framingIntent));
for (const [needle, why] of [
  ['parcel', 'the subject parcel'],
  ['road', 'the nearest road and the road relationship'],
  ['access', 'the apparent access route'],
] as Array<[string, string]>) {
  ok(intent.includes(needle), 'framingIntent must name ' + why + ' (looking for "' + needle + '"), got ' + JSON.stringify(plan.framingIntent));
}
ok(intent.includes('elk lake rd'), 'a known road name must be carried into the framing intent, got ' + JSON.stringify(plan.framingIntent));

const mustShow = (plan.mustShow ?? []).map((entry: string) => String(entry).toLowerCase());
ok(mustShow.length >= 4, 'mustShow must enumerate at least four required elements of the frame, got ' + JSON.stringify(plan.mustShow));
for (const needle of ['boundar', 'road', 'access', 'surrounding']) {
  ok(mustShow.some((entry: string) => entry.includes(needle)),
    'mustShow must require "' + needle + '" in the frame, got ' + JSON.stringify(plan.mustShow));
}
ok(plan.requires?.boundaryVisible === true && plan.requires?.tilesLoaded === true && plan.requires?.roadInFrame === true,
  'the plan must require a visible boundary, painted tiles and the road in frame, got ' + JSON.stringify(plan.requires));

// ── 2. Framing is assessed, not assumed ─────────────────────────────────────
const good = {
  key: 'landportal_overview', label: 'Overview', requested_view: 'parcel_context', active_view: 'parcel_context',
  boundary_visible: true, tiles_loaded: true, camera_scale: 'context', clipped: false, obstructions: [] as string[],
};
const accepted = assessOverviewFraming(good);
ok(accepted.accepted === true, 'a boundary-visible, painted, context-scale, unclipped parcel_context capture must be accepted, reason: ' + String(accepted.reason));

const rejections: Array<[Record<string, unknown>, string]> = [
  [{ ...good, camera_scale: 'county' }, 'county-scale frame'],
  [{ ...good, camera_scale: 'national' }, 'national-scale frame'],
  [{ ...good, boundary_visible: false }, 'no visible subject boundary'],
  [{ ...good, tiles_loaded: false }, 'unpainted imagery tiles'],
  [{ ...good, clipped: true }, 'clipped frame'],
  [{ ...good, obstructions: ['cookie banner'] }, 'obstructed map viewport'],
  [{ ...good, active_view: 'default_3d' }, 'a 3D view standing in for the satellite overview'],
];
for (const [artifact, why] of rejections) {
  const verdict = assessOverviewFraming(artifact as never);
  ok(verdict.accepted === false, 'assessOverviewFraming must REJECT ' + why + ', it accepted it instead');
  ok(typeof verdict.reason === 'string' && verdict.reason.trim().length >= 20,
    'a rejection must state a readable reason for ' + why + ', got ' + JSON.stringify(verdict.reason));
}

// ── 3. Selection prefers the deliberate frame over whatever else exists ─────
const defaultThreeD = { ...good, key: 'default_3d', requested_view: 'default_3d', active_view: 'default_3d' };
const countyScale = { ...good, key: 'wide', camera_scale: 'county' };

const picked = selectOverviewVisual([defaultThreeD, countyScale, good] as never);
ok(picked.accepted === true, 'selectOverviewVisual must accept the correctly framed parcel_context capture, reason: ' + String(picked.reason));
ok(picked.artifact && (picked.artifact as { key?: string }).key === 'landportal_overview',
  'the deliberately framed parcel_context capture must win Overview, got ' + JSON.stringify(picked.artifact));
ok(typeof picked.reason === 'string' && picked.reason.trim().length >= 20, 'the selection must state why that artifact was chosen');

const orderInsensitive = selectOverviewVisual([good, defaultThreeD] as never);
ok((orderInsensitive.artifact as { key?: string } | null)?.key === 'landportal_overview',
  'selection must not depend on input order');

const noneUsable = selectOverviewVisual([defaultThreeD, countyScale] as never);
ok(noneUsable.accepted === false, 'no correctly framed satellite Overview exists here, so selection must NOT accept one');
ok(noneUsable.artifact === null, 'a default 3D or county-scale capture must never be promoted as the Overview screenshot, got ' + JSON.stringify(noneUsable.artifact));
ok(typeof noneUsable.reason === 'string' && noneUsable.reason.trim().length >= 20,
  'the operator must be told WHY no Overview screenshot is available, got ' + JSON.stringify(noneUsable.reason));

const empty = selectOverviewVisual([] as never);
ok(empty.accepted === false && empty.artifact === null, 'an empty artifact list yields no Overview and no invented one');

console.log('PROBE_OK landportal overview capture');
`;

const dir = mkdtempSync(path.join(os.tmpdir(), 'landos-probe-'));
const file = path.join(dir, 'probe.mts');
writeFileSync(file, script, 'utf8');

const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const run = spawnSync(process.execPath, [tsx, file], { cwd: root, encoding: 'utf8', timeout: 240000 });
const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
process.stdout.write(out);
if (run.status !== 0 && !out.includes('PROBE_FAIL')) {
  console.log(`PROBE_FAIL: overview capture probe could not run (exit ${run.status}): ${String(run.stderr ?? run.error ?? '').slice(0, 700)}`);
}
process.exit(run.status === 0 ? 0 : 1);
