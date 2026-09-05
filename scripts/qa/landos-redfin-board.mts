#!/usr/bin/env tsx
// Read ONE Redfin board URL through the owned automation browser and list the
// land cards it publishes, so board coverage can be compared route by route.
//
//   npx tsx scripts/qa/landos-redfin-board.mts <boardUrl>

import process from 'node:process';

import { openDisposableContextHandle } from '../../src/landos/automation-browser.js';

const url = process.argv[2];
if (!url) { console.error('usage: <boardUrl>'); process.exit(1); }

const READ = (): { text: string; cards: Array<{ address: string; text: string }> } => {
  const out: Array<{ address: string; text: string }> = [];
  const nodes = (document as any).querySelectorAll('[class*="HomeCard" i], [data-rf-test-name*="mapHomeCard" i], [class*="MapHomeCard" i]');
  for (let i = 0; i < (nodes as ArrayLike<any>).length; i += 1) {
    const t = String(nodes[i]?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t) out.push({ address: t.slice(0, 120), text: t.slice(0, 220) });
  }
  return { text: String((document as any).body?.innerText ?? '').slice(0, 4000), cards: out };
};

const browser = await openDisposableContextHandle('redfin-board') as any;
const page = await browser.newPage();
try {
  await page.setViewport?.({ width: 1440, height: 1400 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await new Promise((r) => setTimeout(r, 6000));
  for (let i = 0; i < 8; i += 1) {
    await page.evaluate('window.scrollBy(0,1400)');
    await new Promise((r) => setTimeout(r, 900));
  }
  const read = await page.evaluate(READ) as { text: string; cards: Array<{ address: string; text: string }> };
  const stated = /\b(\d{1,4}(?:,\d{3})?)\s+homes?\b/i.exec(read.text.slice(0, 6000));
  console.log(`URL          : ${url}`);
  console.log(`stated homes : ${stated ? stated[1] : '(not stated)'}`);
  console.log(`cards read   : ${read.cards.length}`);
  console.log();
  for (const c of read.cards) console.log(`  ${c.text}`);
} finally {
  try { await page.close(); } catch { /* gone */ }
  process.exit(0);
}
