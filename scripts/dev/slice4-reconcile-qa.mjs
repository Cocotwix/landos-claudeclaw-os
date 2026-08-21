// Slice 4 browser acceptance driver — Fairview Deal 89 bounded reconciliation.
//
// Opens the real operator workspace in a DEDICATED Puppeteer Chromium (never
// the operator's Chrome), proves the persisted improvement conflict is visible,
// clicks the explicit Verify action, waits for the bounded capability + one
// targeted re-read to finish, and captures real pixel screenshots before,
// after, and after a hard refresh. Console errors and every /api network
// request are logged so the run can prove no unintended research ran.
//
// Auth: DASHBOARD_TOKEN from the environment (run via env-guard). The token is
// used in the local URL only and never printed.

import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const token = process.env.DASHBOARD_TOKEN || '';
if (!token) { console.error('DASHBOARD_TOKEN is not in the environment'); process.exit(1); }

const OUT = 'store/operator-qa-slice4-reconcile';
mkdirSync(OUT, { recursive: true });

const DEAL_URL = `http://localhost:3141/dept/acquisitions/v2?deal=89&token=${encodeURIComponent(token)}`;
const phase = process.argv[2] || 'full';

const consoleErrors = [];
const apiRequests = [];

const browser = await puppeteer.launch({ headless: 'new', args: ['--window-size=1560,1400'] });
const page = await browser.newPage();
await page.setViewport({ width: 1560, height: 1400 });
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
});
page.on('request', (request) => {
  const url = request.url();
  if (url.includes('/api/')) apiRequests.push(`${request.method()} ${url.replace(/token=[^&]+/, 'token=***')}`);
});

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`screenshot: ${OUT}/${name}.png`);
};

const scrollToReads = async () => {
  await page.evaluate(() => {
    document.querySelector('[data-testid="specialist-read-property"]')?.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -60);
  });
  await new Promise((resolve) => setTimeout(resolve, 800));
};

const pageState = async () => page.evaluate(() => {
  const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
  return {
    conflictVisible: !!Array.from(document.querySelectorAll('[data-testid="specialist-property-conflicts"] p'))
      .find((p) => /Recorded improvement versus visible condition/i.test(p.textContent ?? '')),
    verifyButton: text('[data-testid="reconcile-run"]'),
    reconciliationPanel: text('[data-testid="specialist-property-reconciliation"]'),
    reconcileStatus: text('[data-testid="reconcile-status"]'),
    reconcileError: text('[data-testid="reconcile-error"]'),
    visualObsPresent: !!document.querySelector('[data-testid="specialist-read-property"] details summary')?.textContent?.match(/Grounded visual observations/),
  };
});

console.log('opening', DEAL_URL.replace(/token=[^&]+/, 'token=***'));
await page.goto(DEAL_URL, { waitUntil: 'networkidle2', timeout: 60_000 });
await page.waitForSelector('[data-testid="specialist-read-property"]', { timeout: 60_000 });
await scrollToReads();

const before = await pageState();
console.log('BEFORE:', JSON.stringify(before, null, 1));

if (phase === 'before' || phase === 'full') {
  await shot('01-conflict-before-resolution');
}

if (phase === 'full') {
  if (!before.conflictVisible) { console.error('FAIL: the improvement conflict is not visible before action'); await browser.close(); process.exit(1); }
  if (!before.verifyButton) { console.error('FAIL: the Verify action is not present'); await browser.close(); process.exit(1); }

  apiRequests.length = 0;
  await page.click('[data-testid="reconcile-run"]');
  console.log('clicked Verify — waiting for the bounded run (capability + one targeted re-read)…');

  // The run takes minutes (assessor lookup + one analyst pass). Poll the DOM,
  // which itself polls the SELECT-only GET every 5s while the run is live.
  const deadline = Date.now() + 12 * 60_000;
  let finished = null;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    const state = await pageState();
    if (state.reconcileError) { finished = state; break; }
    if (state.reconciliationPanel && !/Verifying against the official record/.test(state.verifyButton ?? '')) { finished = state; break; }
  }
  if (!finished) { console.error('FAIL: the reconciliation did not finish within 12 minutes'); await shot('timeout'); await browser.close(); process.exit(1); }
  await scrollToReads();
  console.log('AFTER:', JSON.stringify(await pageState(), null, 1));
  await shot('02-capability-result-and-reconciled-read');

  // Hard refresh: persisted state must survive and nothing may auto-rerun.
  apiRequests.length = 0;
  consoleErrors.length = 0;
  await page.reload({ waitUntil: 'networkidle2', timeout: 60_000 });
  await page.waitForSelector('[data-testid="specialist-read-property"]', { timeout: 60_000 });
  await scrollToReads();
  const afterRefresh = await pageState();
  console.log('AFTER HARD REFRESH:', JSON.stringify(afterRefresh, null, 1));
  await shot('03-reconciled-state-after-hard-refresh');

  const mutations = apiRequests.filter((request) => request.startsWith('POST') || request.startsWith('PUT') || request.startsWith('DELETE'));
  console.log('post-refresh API mutations (must be none):', JSON.stringify(mutations));
  console.log('post-refresh console errors:', JSON.stringify(consoleErrors));
  writeFileSync(`${OUT}/network-and-console.json`, JSON.stringify({ postRefreshRequests: apiRequests, mutations, consoleErrors }, null, 2));
}

await browser.close();
console.log('done');
