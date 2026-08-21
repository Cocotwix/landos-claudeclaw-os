// One targeted capture: the persisted reconciliation panel + the retained
// Improvements conflict, scrolled into view. Read-only page load.
import puppeteer from 'puppeteer';

const token = process.env.DASHBOARD_TOKEN || '';
const browser = await puppeteer.launch({ headless: 'new', args: ['--window-size=1560,1400'] });
const page = await browser.newPage();
await page.setViewport({ width: 1560, height: 1400 });
await page.goto(`http://localhost:3141/dept/acquisitions/v2?deal=89&token=${encodeURIComponent(token)}`, { waitUntil: 'networkidle2', timeout: 60_000 });
await page.waitForSelector('[data-testid="specialist-property-reconciliation"]', { timeout: 60_000 });
await page.evaluate(() => {
  document.querySelector('[data-testid="specialist-property-reconciliation"]')?.scrollIntoView({ block: 'center' });
});
await new Promise((resolve) => setTimeout(resolve, 800));
const info = await page.evaluate(() => ({
  improvementsConflict: Array.from(document.querySelectorAll('[data-testid="specialist-property-conflicts"] p, [data-testid="specialist-property-conflicts"] details p'))
    .map((p) => p.textContent ?? '').find((t) => /1,534|Improvements/i.test(t))?.slice(0, 300) ?? null,
  groundedObsSummary: Array.from(document.querySelectorAll('[data-testid="specialist-read-property"] details summary'))
    .map((s) => s.textContent ?? '').find((t) => /Grounded visual observations/i.test(t)) ?? null,
}));
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: 'store/operator-qa-slice4-reconcile/04-reconciliation-panel.png' });
console.log('screenshot: store/operator-qa-slice4-reconcile/04-reconciliation-panel.png');
await browser.close();
