#!/usr/bin/env tsx
// Read ONE retained provider detail page through the same owned automation
// browser the enrichment lane uses, and print the parts that state a sale.
// Read-only: it opens the page, reads it, and closes the page it created.
//
//   npx tsx scripts/qa/landos-capture-detail.mts <url> [provider]

import process from 'node:process';

import { openDisposableContextHandle } from '../../src/landos/automation-browser.js';

const url = process.argv[2];
const provider = (process.argv[3] ?? 'redfin').toLowerCase();
if (!url) { console.error('usage: <url> [provider]'); process.exit(1); }

const READ = (): { url: string; title: string; text: string } => ({
  url: String((window as any).location?.href ?? ''),
  title: String((document as any).title ?? ''),
  text: String((document as any).body?.innerText ?? ''),
});

const browser = await openDisposableContextHandle(provider) as any;
const page = await browser.newPage();
try {
  await page.setViewport?.({ width: 1440, height: 1200 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await new Promise((r) => setTimeout(r, 6000));
  await page.evaluate(() => { (window as any).scrollTo(0, 4000); });
  await new Promise((r) => setTimeout(r, 3000));
  const read = await page.evaluate(READ) as { url: string; title: string; text: string };
  const text = String(read.text).replace(/ /g, ' ');
  console.log(`URL   : ${read.url}`);
  console.log(`TITLE : ${read.title}`);
  console.log(`LENGTH: ${text.length}`);
  console.log();
  console.log('=== lines mentioning SOLD / SALE / price / acres ===');
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, i) => {
    if (/\bsold\b|sale history|off market|\$[\d,]{3,}|\bacres?\b|lot size|property type|last sold/i.test(line)) {
      console.log(`  [${String(i).padStart(4)}] ${line.slice(0, 150)}`);
    }
  });
  console.log();
  console.log('=== has "Sale history for" heading? ===');
  console.log(`  ${/Sale history for/i.test(text)}`);
  console.log('=== first 40 lines ===');
  for (const l of lines.slice(0, 40)) console.log(`  ${l.slice(0, 140)}`);
} finally {
  try { await page.close(); } catch { /* page already gone */ }
}
