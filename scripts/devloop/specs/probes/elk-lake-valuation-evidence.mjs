// Evaluator-owned probe: 9490 Elk Lake Rd, Williamsburg MI 49690.
//
// The acceptance property. LandOS holds a 60-acre subject (property card 73,
// Grand Traverse County MI, APN 13-116-015-01) and five real LandPortal sold
// land records at 39.94, 40, 40, 40 and 85.32 acres, $9,375 to $12,893 per
// acre, every one of them carrying a stated sale date and NO coordinates and NO
// address. The old router priced the subject from zero of them.
//
// This probe drives the pure selection and valuation path with those exact
// records and requires that they become real valuation evidence, that distance
// is computed and visible where location resolves, that expansion past the old
// hard 20-mile cutoff is retained and explained, and that LandPortal is ranked
// with everything else rather than winning automatically.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const url = (rel) => JSON.stringify(pathToFileURL(path.join(root, rel)).href);

const script = `
import {
  selectWorkingComps, valuationFromWorkingSet, landPortalSaleStatus,
} from ${url('src/landos/deal-intelligence-comps.ts')};

function fail(reason: string): never { console.log('PROBE_FAIL: ' + reason); process.exit(1); }
function ok(cond: unknown, reason: string) { if (!cond) fail(reason); }

const NOW = Date.parse('2026-08-10T00:00:00Z');
const SUBJECT = {
  acres: 60,
  locality: 'Williamsburg',
  county: 'Grand Traverse',
  address: '9490 Elk Lake Rd, Williamsburg, MI 49690',
  apn: '13-116-015-01',
  lat: 44.822439610896,
  lng: -85.404821349666,
};

// ── A LandPortal comparable carrying a source-stated sale date is a stated sale. ──
ok(typeof landPortalSaleStatus === 'function', 'deal-intelligence-comps.ts must export landPortalSaleStatus so the LandPortal status decision has one pure home');

const stated = landPortalSaleStatus({ source: 'LandPortal', dateIso: '2025-04-04' });
ok(stated.statusBasis === 'closed_sale', "a LandPortal comparables-table row with a source-stated sale date is a closed sale, got '" + stated.statusBasis + "'");
ok(typeof stated.provenance === 'string' && /landportal/i.test(stated.provenance), 'the status must carry provenance naming LandPortal, got ' + JSON.stringify(stated.provenance));

ok(landPortalSaleStatus({ source: 'LandPortal', dateIso: null }).statusBasis === 'unconfirmed', 'a LandPortal row with NO stated date stays unconfirmed; a sale date is never invented');
ok(landPortalSaleStatus({ source: 'Zillow', dateIso: '2025-04-04' }).statusBasis === 'unconfirmed', 'landPortalSaleStatus governs LandPortal rows only; other marketplaces keep their own status');

// ── Scenario 1: the five real 9490 LandPortal records, no coordinates at all. ──
const LP = [
  { key: 'lp-954', acres: 40,    price: 400000,  pricePerAcre: 10000,    dateIso: '2025-03-21' },
  { key: 'lp-955', acres: 85.32, price: 1100000, pricePerAcre: 12892.64, dateIso: '2026-02-12' },
  { key: 'lp-956', acres: 40,    price: 400000,  pricePerAcre: 10000,    dateIso: '2025-03-21' },
  { key: 'lp-957', acres: 40,    price: 375000,  pricePerAcre: 9375,     dateIso: '2025-02-04' },
  { key: 'lp-958', acres: 39.94, price: 390000,  pricePerAcre: 9764.65,  dateIso: '2025-04-04' },
];

const lpRows = LP.map((row) => ({
  ...row,
  apn: null,
  address: null,
  source: 'LandPortal',
  sourceUrl: 'https://landportal.com/?property=example',
  distanceMiles: null,
  lat: null,
  lng: null,
  landClass: 'vacant_land' as const,
  locality: null,
  statusBasis: landPortalSaleStatus({ source: 'LandPortal', dateIso: row.dateIso }).statusBasis,
}));

const lpSet = selectWorkingComps({ subject: SUBJECT, rows: lpRows as never, nowMs: NOW });

ok(lpSet.sold.length >= 4,
  'the four distinct 9490 LandPortal sold land records (39.94, 40, 40 at a second price, 85.32 ac) must price the subject; got ' +
  lpSet.sold.length + ' sold comps. Selected: ' + JSON.stringify(lpSet.sold.map((c) => c.acres)) +
  ' Evidence buckets: ' + JSON.stringify(lpSet.evidence.map((b) => b.reason + ' x' + b.count)));

const soldAcres = lpSet.sold.map((c) => Number(c.acres));
for (const acres of [39.94, 85.32]) {
  ok(soldAcres.some((a) => Math.abs(a - acres) < 0.01),
    'the ' + acres + '-acre LandPortal sold land record must participate as valuation evidence for the 60-acre subject; sold set held ' + JSON.stringify(soldAcres));
}
ok(soldAcres.some((a) => Math.abs(a - 40) < 0.01), 'a 40-acre LandPortal sold land record must participate; sold set held ' + JSON.stringify(soldAcres));

ok(lpSet.conclusion === 'sold_supported',
  "the conclusion must be 'sold_supported' once qualifying closed sales exist, got '" + lpSet.conclusion + "'");

// Not one of them may be dropped for having no resolvable distance.
const droppedForDistance = lpSet.evidence.filter((b) => /distance|mile|radius|location/i.test(b.reason));
ok(droppedForDistance.length === 0,
  'no 9490 LandPortal record may be discarded for an unresolvable distance; dropped: ' + JSON.stringify(droppedForDistance));

// ── The routing and expansion are visible on the handback. ────────────────
ok(lpSet.acreageRouting && lpSet.acreageRouting.regime === 'large',
  "the working set must expose the acreage routing it used, and a 60-acre subject routes 'large'; got " + JSON.stringify(lpSet.acreageRouting));
ok(typeof lpSet.geographicExpansion === 'string' && lpSet.geographicExpansion.trim().length >= 30,
  'the working set must expose an operator-readable geographic-expansion explanation, got ' + JSON.stringify(lpSet.geographicExpansion));

// Structured acreage + market context, so a later Strategy agent reads the same
// numbers instead of re-deriving its own.
const ctx = lpSet.acreageMarketContext;
ok(ctx && ctx.route && ctx.route.regime === 'large', 'the working set must carry the shared acreage market context, got ' + JSON.stringify(ctx));
ok(ctx!.pricePerAcre && typeof ctx!.pricePerAcre.mid === 'number', 'the acreage market context must carry a per-acre mid, got ' + JSON.stringify(ctx!.pricePerAcre));
const mid = ctx!.pricePerAcre!.mid as number;
ok(mid >= 9000 && mid <= 13500, 'the 9490 per-acre mid must land inside the observed $9,375-$12,893 range, got ' + mid);
ok(typeof ctx!.expansionExplanation === 'string' && ctx!.expansionExplanation.trim().length > 0, 'the acreage market context must carry the expansion explanation');
ok(typeof ctx!.subjectAcres === 'number' && ctx!.subjectAcres === 60, 'the acreage market context must carry the subject acreage for a later whole-versus-subdivision comparison, got ' + JSON.stringify(ctx!.subjectAcres));

// ── The valuation is materially better than "0 comps price the subject". ──
const valuation = valuationFromWorkingSet(SUBJECT, lpSet, {});
ok(valuation.priceable === true, 'the 60-acre subject must be priceable from these sales; reason given: ' + String(valuation.notPriceableReason));
ok(valuation.range && valuation.range.low > 0 && valuation.range.high >= valuation.range.low, 'a value range must be produced, got ' + JSON.stringify(valuation.range));
ok(valuation.pricePerAcreRange && valuation.pricePerAcreRange.low >= 8000 && valuation.pricePerAcreRange.high <= 15000,
  'the per-acre range must sit in the evidenced $9,375-$12,893 neighbourhood, got ' + JSON.stringify(valuation.pricePerAcreRange));
ok(valuation.range!.low >= 60 * 7000 && valuation.range!.high <= 60 * 16000,
  'the value range must be the per-acre evidence scaled to 60 acres, got ' + JSON.stringify(valuation.range));

// ── Scenario 2: distance is computed and visible, and expansion is retained. ──
const located = [
  {
    key: 'near-12', apn: null, address: '1200 Skegemog Point Rd, Williamsburg, MI', source: 'Zillow',
    sourceUrl: null, price: 560000, acres: 52, pricePerAcre: 10769, dateIso: '2026-01-15',
    distanceMiles: null, lat: 44.9930, lng: -85.4630, landClass: 'vacant_land' as const,
    locality: 'Williamsburg', statusBasis: 'closed_sale' as const,
  },
  {
    key: 'far-26', apn: null, address: '9000 Rapid City Rd, Rapid City, MI', source: 'Redfin',
    sourceUrl: null, price: 780000, acres: 70, pricePerAcre: 11142, dateIso: '2025-11-02',
    distanceMiles: null, lat: 45.1900, lng: -85.2900, landClass: 'vacant_land' as const,
    locality: 'Rapid City', statusBasis: 'closed_sale' as const,
  },
];

const geoSet = selectWorkingComps({ subject: SUBJECT, rows: located as never, nowMs: NOW });
ok(geoSet.sold.length === 2,
  'both located closed sales must be retained; the 26-mile one proves the hard 20-mile cutoff is gone. Got ' +
  geoSet.sold.length + '; evidence: ' + JSON.stringify(geoSet.evidence.map((b) => b.reason + ' x' + b.count)));

const byKey = new Map(geoSet.sold.map((c) => [String(c.key), c]));
const near = byKey.get('near-12');
const farComp = byKey.get('far-26');
ok(near && typeof near.distanceMiles === 'number' && Number.isFinite(near.distanceMiles),
  'distance must be CALCULATED from coordinates when the row arrives without one; got ' + JSON.stringify(near?.distanceMiles));
ok(Math.abs((near!.distanceMiles as number) - 12) < 3,
  'the Skegemog Point sale is about 12 straight-line miles from 9490 Elk Lake Rd; got ' + near!.distanceMiles);
ok(farComp && typeof farComp.distanceMiles === 'number' && (farComp.distanceMiles as number) > 20,
  'the Rapid City sale is past 20 miles and must still show its distance; got ' + JSON.stringify(farComp?.distanceMiles));

const farText = String(farComp!.whyUseful ?? '') + ' ' + (farComp!.differences ?? []).join(' ') + ' ' + (farComp!.similarities ?? []).join(' ');
ok(/mile/i.test(farText), 'a comp beyond the local radius must state its distance to the operator: ' + farText);
ok(/expan|wider|widen|outward|beyond/i.test(farText + ' ' + geoSet.geographicExpansion),
  'the operator must be able to see that the search expanded outward and why: ' + farText + ' || ' + geoSet.geographicExpansion);

// ── LandPortal is ranked, never automatically first. ─────────────────────
const mixed = selectWorkingComps({
  subject: SUBJECT,
  rows: [...lpRows, ...located] as never,
  nowMs: NOW,
});
ok(mixed.sold.length > 0, 'the mixed set must still price the subject');
ok(mixed.sold.some((c) => /landportal/i.test(String(c.source))), 'LandPortal comps must be retained and ranked alongside the rest, not silently discarded');
const topSource = String(mixed.sold[0].source);
ok(mixed.sold.some((c) => !/landportal/i.test(String(c.source))) || true, 'sanity');
const lpRanks = mixed.sold.map((c, i) => (/landportal/i.test(String(c.source)) ? i : -1)).filter((i) => i >= 0);
ok(lpRanks.length > 0, 'at least one LandPortal comp must survive ranking in the mixed set');
// A 52-acre located sale 12 miles away is closer to the 60-acre subject on both
// acreage and geography than a 40-acre sale with no resolvable location; the
// ranking must be able to say so rather than seating LandPortal first by source.
ok(topSource !== 'LandPortal' || mixed.sold[0].acres === 85.32 || Math.abs(Number(mixed.sold[0].acres) - 52) < 0.01,
  'LandPortal must not win rank purely by being LandPortal; top comp was ' + topSource + ' at ' + String(mixed.sold[0].acres) + ' ac');

console.log('PROBE_OK 9490 Elk Lake Rd valuation evidence');
`;

const dir = mkdtempSync(path.join(os.tmpdir(), 'landos-probe-'));
const file = path.join(dir, 'probe.mts');
writeFileSync(file, script, 'utf8');

const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const run = spawnSync(process.execPath, [tsx, file], { cwd: root, encoding: 'utf8', timeout: 300000 });
const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
process.stdout.write(out);
if (run.status !== 0 && !out.includes('PROBE_FAIL')) {
  console.log(`PROBE_FAIL: 9490 acceptance probe could not run (exit ${run.status}): ${String(run.stderr ?? run.error ?? '').slice(0, 700)}`);
}
process.exit(run.status === 0 ? 0 : 1);
