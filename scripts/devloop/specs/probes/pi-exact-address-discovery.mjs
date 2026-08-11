// Evaluator-owned probe: the default exact-address web discovery lane.
//
// Once LandOS establishes the canonical property address, it must run a normal
// web search for that exact address as a first-class research lane, open the
// useful property-specific results, and extract listing evidence with source
// and provenance preserved.
//
// The hard rule this probe enforces: a listing sentence saying the property has
// legal / easement access is REPORTED LISTING EVIDENCE. It never becomes a
// recorded easement, and it never sets verified legal access.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const url = (rel) => JSON.stringify(pathToFileURL(path.join(root, rel)).href);

const script = `
import {
  EXACT_ADDRESS_LANE_ID,
  buildExactAddressQueries,
  classifyDiscoveryResult,
  extractListingEvidence,
  listingAccessEvidenceItems,
} from ${url('src/landos/exact-address-web-discovery.ts')};
import { reconcileAccessEvidence } from ${url('src/landos/access-evidence-ladder.ts')};

function fail(reason: string): never { console.log('PROBE_FAIL: ' + reason); process.exit(1); }
function ok(cond: unknown, reason: string) { if (!cond) fail(reason); }

ok(typeof EXACT_ADDRESS_LANE_ID === 'string' && EXACT_ADDRESS_LANE_ID.trim().length > 0, 'the lane must have a stable id');

// ── 1. Plain-English queries an operator would actually type ────────────────
const subject = { address: '9490 Elk Lake Rd', city: 'Williamsburg', state: 'MI', zip: '49690', apn: '13-116-015-01' };
const queries = buildExactAddressQueries(subject);
ok(Array.isArray(queries) && queries.length >= 4, 'at least four exact-address queries are required, got ' + JSON.stringify(queries));
ok(queries.every((q: string) => typeof q === 'string' && q.trim().length > 0), 'no query may be blank');
ok(new Set(queries).size === queries.length, 'queries must be distinct, got ' + JSON.stringify(queries));
const first = queries[0].toLowerCase();
for (const part of ['9490 elk lake rd', 'williamsburg', 'mi']) {
  ok(first.includes(part), 'the first query must be the full canonical address (missing "' + part + '"), got ' + JSON.stringify(queries[0]));
}
const joined = queries.join(' \\n ').toLowerCase();
for (const [needle, why] of [
  ['for sale', 'a for-sale / listing query'],
  ['listing', 'a listing-history query'],
  ['access', 'an access / easement query'],
] as Array<[string, string]>) {
  ok(joined.includes(needle), 'the query set must include ' + why + ' (looking for "' + needle + '"), got ' + JSON.stringify(queries));
}
ok(queries.every((q: string) => !/site:|inurl:|filetype:/i.test(q)), 'queries stay plain English as an operator would type them, got ' + JSON.stringify(queries));

// ── 2. Results are classified so the useful ones get opened ─────────────────
const cases: Array<[string, string, boolean]> = [
  ['https://www.zillow.com/homedetails/9490-Elk-Lake-Rd-Williamsburg-MI-49690/12345_zpid/', 'zillow', true],
  ['https://www.zillow.com/mi/williamsburg/', 'zillow', false],
  ['https://www.redfin.com/MI/Williamsburg/9490-Elk-Lake-Rd-49690/home/98765', 'redfin', true],
  ['https://www.realtor.com/realestateandhomes-detail/9490-Elk-Lake-Rd_Williamsburg_MI_49690_M12345-67890', 'realtor', true],
  ['https://www.landwatch.com/grand-traverse-county-michigan-land-for-sale/pid/456', 'land_listing', true],
  ['https://www.auction.com/details/9490-elk-lake-rd-williamsburg-mi-49690', 'auction', true],
];
for (const [href, family, specific] of cases) {
  const verdict = classifyDiscoveryResult(href);
  ok(verdict.family === family, 'classifyDiscoveryResult(' + href + ') must report family "' + family + '", got "' + String(verdict.family) + '"');
  ok(verdict.propertySpecific === specific,
    'classifyDiscoveryResult(' + href + ') must report propertySpecific=' + String(specific) + ', got ' + String(verdict.propertySpecific));
  ok(typeof verdict.host === 'string' && verdict.host.length > 0, 'the host must be reported for ' + href);
}
const brokerage = classifyDiscoveryResult('https://www.someuprealty.com/listings/9490-elk-lake-rd');
ok(['brokerage', 'mls_mirror', 'other'].includes(brokerage.family),
  'an unfamiliar brokerage page must still be classified, got "' + String(brokerage.family) + '"');
ok(classifyDiscoveryResult('not a url').host === null, 'an unparseable url must yield host null rather than throwing');

// ── 3. Listing evidence is extracted with provenance, never fabricated ──────
const LISTING_URL = 'https://www.zillow.com/homedetails/9490-Elk-Lake-Rd-Williamsburg-MI-49690/12345_zpid/';
const LISTING_TEXT = [
  '9490 Elk Lake Rd, Williamsburg, MI 49690. 60 acres of rolling wooded acreage.',
  'The property has deeded legal easement access from Elk Lake Rd.',
  'A gravel driveway runs from the road back to the building site.',
  'The home is 1,850 sqft with 3 beds and 2 baths, built 1996.',
  'Private well and septic in place. Electric at the road.',
  'Listed for $495,000. Price cut to $469,000 on 03/14/2024. Sold 06/02/2024 for $455,000.',
].join(' ');

const evidence = extractListingEvidence({
  url: LISTING_URL,
  sourceLabel: 'Zillow',
  title: '9490 Elk Lake Rd, Williamsburg, MI 49690',
  text: LISTING_TEXT,
  retrievedAt: '2026-08-10T13:00:00Z',
});
ok(evidence.sourceUrl === LISTING_URL, 'extracted evidence must carry its source url');
ok(typeof evidence.sourceLabel === 'string' && evidence.sourceLabel.length > 0, 'extracted evidence must carry its source label');
ok(evidence.retrievedAt === '2026-08-10T13:00:00Z', 'extracted evidence must carry when it was retrieved');
ok(evidence.legalAccessStatements.length >= 1, 'the easement sentence must be captured as a legal-access statement');
ok(/easement/i.test(evidence.legalAccessStatements[0].text ?? ''), 'the captured statement must be the actual listing sentence, got ' + JSON.stringify(evidence.legalAccessStatements[0]));
ok(evidence.legalAccessStatements.every((s: { tier: string }) => s.tier === 'reported_legal'),
  'a listing access sentence is REPORTED legal access, never verified; got ' + JSON.stringify(evidence.legalAccessStatements.map((s: { tier: string }) => s.tier)));
ok(evidence.drivewayStatements.length >= 1 && /gravel/i.test(evidence.drivewayStatements.join(' ')), 'the gravel driveway sentence must be captured');
ok(evidence.buildingSqft === 1850, 'building square footage must be extracted, got ' + String(evidence.buildingSqft));
ok(evidence.acres === 60, 'acreage must be extracted, got ' + String(evidence.acres));
ok(evidence.well === true && evidence.septic === true, 'well and septic must be extracted, got well=' + String(evidence.well) + ' septic=' + String(evidence.septic));
ok(evidence.priorAskingPrice === 495000, 'the prior asking price must be extracted, got ' + String(evidence.priorAskingPrice));
ok(Array.isArray(evidence.listingHistory) && evidence.listingHistory.length >= 2, 'listing history events must be captured, got ' + JSON.stringify(evidence.listingHistory));
ok(Array.isArray(evidence.remarks) && evidence.remarks.length >= 1, 'listing remarks must be retained');

const empty = extractListingEvidence({ url: LISTING_URL, sourceLabel: 'Zillow', title: null, text: '', retrievedAt: null });
ok(empty.legalAccessStatements.length === 0, 'an empty page must not produce access statements');
ok(empty.buildingSqft === null && empty.acres === null && empty.priorAskingPrice === null, 'nothing may be invented from an empty page');
ok(empty.well === null && empty.septic === null, 'absent utilities must be null, never false-by-default');

// ── 4. Listing evidence enters the access ladder at REPORTED, never VERIFIED ─
const items = listingAccessEvidenceItems(evidence);
ok(items.length >= 1, 'the listing must contribute at least one access evidence item');
ok(items.every((item: { tier: string }) => item.tier === 'reported_legal'), 'every listing-derived access item must be tier reported_legal, got ' + JSON.stringify(items.map((i: { tier: string }) => i.tier)));
ok(items.every((item: { sourceKind: string }) => item.sourceKind === 'listing'), 'listing-derived items must be sourceKind "listing"');
ok(items.every((item: { sourceUrl?: string | null }) => item.sourceUrl === LISTING_URL), 'provenance (the source url) must survive onto the evidence item');
ok(items.every((item: { basis: string }) => item.basis === 'source_stated'), 'a listing statement is source_stated, not an observation');
ok(items.every((item: { weight: string }) => item.weight !== 'confirmed'), 'reported listing evidence may not carry Confirmed weight, got ' + JSON.stringify(items.map((i: { weight: string }) => i.weight)));

const ladder = reconcileAccessEvidence(items);
ok(ladder.reportedLegalAccess === true, 'the ladder must read the listing evidence as reported legal access');
ok(ladder.verifiedLegalAccess === false, 'listing evidence must NEVER establish verified legal access');
ok(ladder.outstanding.some((entry: string) => /recorded|easement|instrument|deed/i.test(entry)),
  'recorded easement verification stays outstanding after listing rediscovery, got ' + JSON.stringify(ladder.outstanding));

console.log('PROBE_OK exact address web discovery');
`;

const dir = mkdtempSync(path.join(os.tmpdir(), 'landos-probe-'));
const file = path.join(dir, 'probe.mts');
writeFileSync(file, script, 'utf8');

const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const run = spawnSync(process.execPath, [tsx, file], { cwd: root, encoding: 'utf8', timeout: 240000 });
const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
process.stdout.write(out);
if (run.status !== 0 && !out.includes('PROBE_FAIL')) {
  console.log(`PROBE_FAIL: exact address discovery probe could not run (exit ${run.status}): ${String(run.stderr ?? run.error ?? '').slice(0, 700)}`);
}
process.exit(run.status === 0 ? 0 : 1);
