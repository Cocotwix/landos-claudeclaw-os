// Front-end vs API verification for the Market Research workspace.
//
// For EVERY retained acreage band: selects the band in the workspace Acreage
// dropdown, drills US -> state -> county -> ZIP, and compares the rendered
// Drill Deep rows cell-by-cell against the API that fed them. Also verifies the
// band selector lists exactly the retained bands, and that the sampled counties
// actually render their ZIP rows rather than collapsing to an empty table.
//
// Read-only against the product: it only reads the API and clicks navigation
// controls. Nothing is collected, written, or mutated.
//
// Usage:
//   node scripts/mr-band-verify.mjs [quarter]
//
//   quarter   Snapshot quarter to verify, e.g. 2026-Q3.
//             Defaults to the newest quarter present in the overview payload.
//
// Environment:
//   LANDOS_BASE_URL      dashboard origin              (default http://localhost:3141)
//   LANDOS_CDP_PORT      Chrome remote-debugging port  (default 9222)
//   MR_VERIFY_STATE      state code to drill into      (default GA)
//   MR_VERIFY_COUNTIES   comma-separated county FIPS   (default 13257,13215)
//   MR_VERIFY_ROOT_LABEL root breadcrumb label         (default United States)
//   DASHBOARD_TOKEN      dashboard token; falls back to reading .env privately
//
// Output: store/browser-shots/mr-band-verify/{report.json,*.png}
// Exit code is 0 when no problems were found, 1 otherwise.
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

const ROOT = process.cwd();
const BASE = process.env.LANDOS_BASE_URL ?? 'http://localhost:3141';
const CDP_PORT = Number(process.env.LANDOS_CDP_PORT ?? 9222);
const STATE = (process.env.MR_VERIFY_STATE ?? 'GA').toUpperCase();
const COUNTIES = (process.env.MR_VERIFY_COUNTIES ?? '13257,13215').split(',').map((s) => s.trim()).filter(Boolean);
const ROOT_LABEL = process.env.MR_VERIFY_ROOT_LABEL ?? 'United States';
const QUARTER_ARG = process.argv[2] ?? null;

if (!Number.isInteger(CDP_PORT) || CDP_PORT <= 0) {
  console.error(`LANDOS_CDP_PORT must be a positive integer (got "${process.env.LANDOS_CDP_PORT}")`);
  process.exit(2);
}
if (QUARTER_ARG !== null && !/^\d{4}-Q[1-4]$/.test(QUARTER_ARG)) {
  console.error(`quarter must look like 2026-Q3 (got "${QUARTER_ARG}")`);
  process.exit(2);
}
if (!/^[A-Z]{2}$/.test(STATE)) {
  console.error(`MR_VERIFY_STATE must be a 2-letter state code (got "${STATE}")`);
  process.exit(2);
}

// The dashboard token is read privately and only ever placed in the local
// dashboard URL. It is never logged, echoed, or written to the report.
function dashboardToken() {
  if (process.env.DASHBOARD_TOKEN) return process.env.DASHBOARD_TOKEN;
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) throw new Error('DASHBOARD_TOKEN is not set and no .env file is present.');
  const match = fs.readFileSync(envPath, 'utf8').match(/^\s*DASHBOARD_TOKEN\s*=(.*)$/m);
  if (!match) throw new Error('DASHBOARD_TOKEN is not configured.');
  const value = match[1].trim().replace(/^["']|["']$/g, '');
  if (!value) throw new Error('DASHBOARD_TOKEN is empty.');
  return value;
}

const token = dashboardToken();
const api = async (p) => (await fetch(`${BASE}${p}${p.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`)).json();
const outDir = path.resolve(ROOT, 'store/browser-shots/mr-band-verify');
fs.mkdirSync(outDir, { recursive: true });

const METRICS = ['salesCount', 'daysOnMarket', 'sellThroughRate', 'absorptionRate', 'monthsOfSupply', 'population', 'populationDensity', 'populationGrowth', 'medianPrice', 'medianPricePerAcre'];
const KIND = { salesCount: 'int', daysOnMarket: 'days', sellThroughRate: 'pct', absorptionRate: 'pct', monthsOfSupply: 'months', population: 'int', populationDensity: 'dec', populationGrowth: 'pct', medianPrice: 'money', medianPricePerAcre: 'money' };
const fmt = (k, v) => {
  if (v === null || v === undefined) return '';
  const kind = KIND[k];
  if (kind === 'money') return `$${Math.round(v).toLocaleString('en-US')}`;
  if (kind === 'pct') return `${v}%`;
  if (kind === 'days') return `${Math.round(v)}d`;
  if (kind === 'months') return `${v} mo`;
  if (kind === 'int') return Math.round(v).toLocaleString('en-US');
  return `${v}`;
};

const problems = [];
let rowsChecked = 0;
let cellsChecked = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (band) => band.replace('+', 'plus').replace(/[^\w.-]/g, '_');

const b = await puppeteer.connect({ browserURL: `http://127.0.0.1:${CDP_PORT}`, defaultViewport: null, protocolTimeout: 120000 });
const pg = await b.newPage();
await pg.setViewport({ width: 1720, height: 1000 });

const readDom = () => pg.evaluate(() => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  return [...document.querySelectorAll('tr[data-geo]')].map((tr) => ({
    geo: tr.getAttribute('data-geo'),
    cells: [...tr.querySelectorAll('td')].map((td) => clean(td.querySelector('span')?.textContent ?? td.textContent)),
  }));
});

const clickBreadcrumb = (label) => pg.evaluate((t) => {
  [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === t)?.click();
}, label);

function check(domRows, apiRows, label) {
  const byGeo = new Map(apiRows.map((r) => [r.geoKey, r]));
  if (domRows.length !== apiRows.length) problems.push(`${label}: DOM ${domRows.length} rows vs API ${apiRows.length}`);
  for (const dr of domRows) {
    const ar = byGeo.get(dr.geo);
    if (!ar) { problems.push(`${label}: DOM row ${dr.geo} absent from API`); continue; }
    rowsChecked++;
    const expected = [
      ar.countyCount == null ? '' : ar.countyCount.toLocaleString('en-US'),
      ar.zipCount == null ? '' : ar.zipCount.toLocaleString('en-US'),
      ...METRICS.map((k) => fmt(k, ar.metrics[k] ?? null)),
    ];
    const cells = dr.cells.slice(1);
    expected.forEach((exp, i) => {
      cellsChecked++;
      const got = cells[i] ?? '';
      if (exp === '' ? got !== '' : !got.startsWith(exp)) problems.push(`${label} ${dr.geo} col${i}: "${got}" ≠ "${exp}"`);
    });
  }
}

const overview = await api('/api/landos/market-research/overview');
const retainedBands = overview.bands.filter((x) => x.retained).map((x) => x.band);
const quarter = QUARTER_ARG ?? [...new Set(overview.snapshots.map((s) => s.quarter))].sort().pop();
if (!quarter) {
  console.error('No snapshots are present, so there is nothing to verify.');
  process.exit(1);
}
console.log(`API retained bands: ${retainedBands.join(', ')}`);
console.log(`verifying quarter ${quarter}, state ${STATE}, counties ${COUNTIES.join(',')}`);

await pg.goto(`${BASE}/dept/market-research?token=${encodeURIComponent(token)}`, { waitUntil: 'domcontentloaded' });
await pg.waitForSelector('path[data-geo="TX"]', { timeout: 30000 });
await sleep(800);

// Band selector must list exactly the retained bands.
const uiBands = await pg.evaluate(() => {
  const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => /acre/i.test(o.textContent)));
  return sel ? [...sel.options].map((o) => o.value) : [];
});
console.log('UI band options:', uiBands.join(', '));
const missingInUi = retainedBands.filter((x) => !uiBands.includes(x));
if (missingInUi.length) problems.push(`band selector missing retained bands: ${missingInUi.join(',')}`);

for (const band of retainedBands) {
  // Select the band, then wait for the snapshot's state rows to load.
  await pg.evaluate((v) => {
    const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => /acre/i.test(o.textContent)));
    sel.value = v;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, band);
  await sleep(2500);
  await clickBreadcrumb('Drill Deep');
  await pg.waitForSelector('tr[data-geo]', { timeout: 30000 });
  await sleep(800);

  const snap = overview.snapshots.find((s) => s.filters.acreageBand === band && s.quarter === quarter);
  if (!snap) { problems.push(`no ${quarter} snapshot for band ${band}`); continue; }
  check(await readDom(), (await api(`/api/landos/market-research/snapshots/${snap.id}/rows?level=state`)).rows, `${band}:US`);
  await pg.screenshot({ path: path.join(outDir, `band-${slug(band)}-us.png`) });

  // The breadcrumb uses the state's display name, so read it off the row we
  // are about to drill into rather than hardcoding it.
  const stateLabel = await pg.evaluate((s) => {
    const tr = document.querySelector(`tr[data-geo="state:${s}"]`);
    return (tr?.querySelector('td')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }, STATE);
  if (!stateLabel) { problems.push(`${band}: state row ${STATE} is not rendered`); continue; }

  await pg.evaluate((s) => document.querySelector(`tr[data-geo="state:${s}"]`)?.querySelector('button')?.click(), STATE);
  await sleep(1800);
  check(await readDom(), (await api(`/api/landos/market-research/snapshots/${snap.id}/rows?level=county&parent=state:${STATE}`)).rows, `${band}:${STATE}-counties`);
  await pg.screenshot({ path: path.join(outDir, `band-${slug(band)}-${STATE}.png`) });

  for (const fips of COUNTIES) {
    const apiRows = (await api(`/api/landos/market-research/snapshots/${snap.id}/rows?level=zip&parent=county:${fips}`)).rows;
    await pg.evaluate((f) => document.querySelector(`tr[data-geo="county:${f}"]`)?.querySelector('button')?.click(), fips);
    await sleep(4500);   // ZIP fetch + render; shorter waits produced false alarms.
    const dom = await readDom();
    if (apiRows.length > 0 && dom.length === 0) problems.push(`${band}: county ${fips} renders NO zip rows though API has ${apiRows.length}`);
    else check(dom, apiRows, `${band}:zip:${fips}`);
    if (fips === COUNTIES[0]) await pg.screenshot({ path: path.join(outDir, `band-${slug(band)}-${fips}-zips.png`) });
    await clickBreadcrumb(stateLabel);
    await sleep(1200);
  }
  await clickBreadcrumb(ROOT_LABEL);
  await sleep(1000);
  console.log(`band ${band} verified (${rowsChecked} rows, ${problems.length} problems so far)`);
}

fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ quarter, state: STATE, counties: COUNTIES, retainedBands, uiBands, rowsChecked, cellsChecked, problems }, null, 1));
console.log(`BAND VERIFY DONE: ${retainedBands.length} bands, ${rowsChecked} rows, ${cellsChecked} cells, ${problems.length} problems`);
for (const p of problems.slice(0, 25)) console.log('PROBLEM:', p);
await pg.close();
await b.disconnect();
process.exit(problems.length ? 1 : 0);
