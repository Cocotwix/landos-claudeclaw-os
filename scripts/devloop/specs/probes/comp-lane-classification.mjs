// Evaluator-owned probe: a house listing is never "active vacant-land
// competition".
//
// On 9490 Elk Lake Rd the operator was shown improved-property listings under
// the vacant-land active-competition heading. Improved-property context and
// vacant-land competition are different questions and must stay separate lanes.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const url = (rel) => JSON.stringify(pathToFileURL(path.join(root, rel)).href);

const script = `
import { selectWorkingComps } from ${url('src/landos/deal-intelligence-comps.ts')};
import { WORKSPACE_CATEGORY_LABELS, detectImprovedProperty } from ${url('src/landos/comps-valuation.ts')};

function fail(reason: string): never { console.log('PROBE_FAIL: ' + reason); process.exit(1); }
function ok(cond: unknown, reason: string) { if (!cond) fail(reason); }

// ── The improved-property detector reads what the row actually says. ───────
ok(typeof detectImprovedProperty === 'function', 'comps-valuation.ts must export detectImprovedProperty so the improved/vacant split is testable');

const houseRows = [
  { notes: 'Charming 3 bd 2 ba 1,850 sqft home on 42 acres' },
  { descriptionText: '4 bedroom ranch house with attached garage' },
  { propertyClass: 'residential', notes: '' },
  { notes: 'Single family residence, built 1998' },
  { buildingSqft: 2100 },
  // THE REAL LIVE SHAPE. Zillow rows reach LandOS with their card fragments
  // concatenated and no separator, so the structure keyword is glued to the
  // fragment before it: 'sqftHouse', not 'sqft House'. A word-boundary check
  // cannot see it. These exact strings are the eleven listings that were filed
  // as active vacant-land competition on 9490 Elk Lake Rd, and any fixture that
  // only uses well-spaced prose will PASS while the live screen stays broken.
  { addressDesc: '208 sqftHouse for sale10892 Lakeshore Rd, Elk Rapids, MI 49629' },
  { addressDesc: '757 sqftHouse for sale8739 Skegemog Point Rd, Williamsburg, MI 49690' },
  { addressDesc: '813 sqftHouse for sale4648 Truax Lake Rd, Williamsburg, MI 49690' },
  { addressDesc: '1,240 sqftTownhouse for sale12 Example Ct, Traverse City, MI 49686' },
  { notes: '3 bdHouse for sale on 5 acres' },
];
for (const row of houseRows) {
  const verdict = detectImprovedProperty(row);
  ok(verdict && verdict.improved === true, 'detectImprovedProperty must flag ' + JSON.stringify(row) + ' as improved, got ' + JSON.stringify(verdict));
  ok(typeof verdict.evidence === 'string' && verdict.evidence.trim().length > 0, 'an improved verdict must name the evidence that produced it, for ' + JSON.stringify(row));
}

const landRows = [
  { propertyClass: 'land', notes: '40 acres of wooded vacant land, no structures' },
  { propertyClass: 'land', classification: 'landportal_context', notes: '' },
  { notes: 'Vacant parcel with road frontage' },
  {},
  // The same concatenated Zillow shape, but genuinely vacant land. Separating
  // the glued tokens must not invent a structure that is not there.
  { addressDesc: '40 acresLot / Land for sale0 Vacant Ridge Rd, Williamsburg, MI 49690' },
  { addressDesc: '5.2 acresLand for saleTBD Elk Lake Rd, Williamsburg, MI 49690' },
];
for (const row of landRows) {
  const verdict = detectImprovedProperty(row);
  ok(verdict && verdict.improved === false, 'detectImprovedProperty must NOT flag ' + JSON.stringify(row) + ' as improved, got ' + JSON.stringify(verdict));
}

// The vacant-land competition heading itself is unchanged; what may ENTER it is.
ok(/vacant-land competition/i.test(String(WORKSPACE_CATEGORY_LABELS.active_competition)),
  'the active-competition lane must still be labelled vacant-land competition, got ' + JSON.stringify(WORKSPACE_CATEGORY_LABELS.active_competition));
ok(/improved/i.test(String(WORKSPACE_CATEGORY_LABELS.improved_context)),
  'a separate improved-property context lane must exist, got ' + JSON.stringify(WORKSPACE_CATEGORY_LABELS.improved_context));

// ── The working set keeps houses out of the vacant-land active lane. ───────
const NOW = Date.parse('2026-08-10T00:00:00Z');
const base = {
  sourceUrl: null as string | null,
  dateIso: '2026-05-01',
  distanceMiles: 6,
  locality: 'Williamsburg',
  statusBasis: 'active_listing' as const,
};

const rows = [
  {
    ...base,
    key: 'vacant-active',
    address: '0 Vacant Ridge Rd, Williamsburg, MI',
    source: 'Zillow',
    price: 495000,
    acres: 45,
    pricePerAcre: 11000,
    landClass: 'vacant_land' as const,
  },
  {
    ...base,
    key: 'house-improved',
    address: '1234 House Ln, Williamsburg, MI',
    source: 'Zillow',
    price: 720000,
    acres: 42,
    pricePerAcre: 17142,
    landClass: 'improved' as const,
    improvedClass: 'residential' as const,
  },
  {
    ...base,
    key: 'house-unknown-class',
    address: '5678 Farmhouse Rd, Williamsburg, MI',
    source: 'Redfin',
    price: 680000,
    acres: 44,
    pricePerAcre: 15454,
    landClass: 'unknown' as const,
    homeSizeSqft: 1850,
    yearBuilt: 1998,
    homeType: 'Single Family Residence',
  },
];

const ws = selectWorkingComps({
  subject: { acres: 60, locality: 'Williamsburg', county: 'Grand Traverse', lat: 44.822439610896, lng: -85.404821349666 },
  rows: rows as never,
  nowMs: NOW,
});

const activeKeys = ws.active.map((c) => String(c.address ?? c.key ?? ''));
ok(ws.active.some((c) => /Vacant Ridge/.test(String(c.address ?? ''))),
  'the genuine vacant-land active listing must appear as vacant-land competition; active lane held: ' + JSON.stringify(activeKeys));
ok(!ws.active.some((c) => /House Ln/.test(String(c.address ?? ''))),
  'an improved residential listing must NOT appear as active vacant-land competition; active lane held: ' + JSON.stringify(activeKeys));
ok(!ws.active.some((c) => /Farmhouse Rd/.test(String(c.address ?? ''))),
  'a listing carrying home size and year built is a house, not vacant land, and must NOT appear as active vacant-land competition; active lane held: ' + JSON.stringify(activeKeys));

for (const comp of ws.active) {
  if (/vacant/i.test(String(comp.whyUseful ?? ''))) {
    ok(/Vacant Ridge/.test(String(comp.address ?? '')),
      'only an affirmatively vacant row may be described as vacant-land competition; "' + String(comp.address) + '" was: ' + String(comp.whyUseful));
  }
}

// The house rows are not deleted — they stay counted, with a stated reason.
const evidenceText = ws.evidence.map((b) => b.reason).join(' | ');
ok(ws.evidence.length > 0, 'the improved rows must be retained as counted evidence with a stated reason, not silently dropped');
ok(/improve|structure|home|house|building/i.test(evidenceText),
  'the evidence reasons must say why the improved rows left the vacant-land lane, got: ' + evidenceText);

// The subject-side lanes stay separate: sold vacant-land value is untouched.
ok(!ws.sold.some((c) => /House Ln|Farmhouse Rd/.test(String(c.address ?? ''))),
  'no improved property may enter the sold vacant-land valuation lane');

console.log('PROBE_OK comp lane classification');
`;

const dir = mkdtempSync(path.join(os.tmpdir(), 'landos-probe-'));
const file = path.join(dir, 'probe.mts');
writeFileSync(file, script, 'utf8');

const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const run = spawnSync(process.execPath, [tsx, file], { cwd: root, encoding: 'utf8', timeout: 240000 });
const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
process.stdout.write(out);
if (run.status !== 0 && !out.includes('PROBE_FAIL')) {
  console.log(`PROBE_FAIL: lane-classification probe could not run (exit ${run.status}): ${String(run.stderr ?? run.error ?? '').slice(0, 700)}`);
}
process.exit(run.status === 0 ? 0 : 1);
