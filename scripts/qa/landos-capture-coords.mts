#!/usr/bin/env tsx
// Does a provider detail page publish parcel coordinates?
// Reads one retained record page through the owned automation browser and
// reports every latitude/longitude-looking value it exposes. Read-only.
//
//   npx tsx scripts/qa/landos-capture-coords.mts <url> [provider]

import process from 'node:process';

import { openDisposableContextHandle } from '../../src/landos/automation-browser.js';

const url = process.argv[2];
const provider = (process.argv[3] ?? 'redfin').toLowerCase();
if (!url) { console.error('usage: <url> [provider]'); process.exit(1); }

const READ = (): { url: string; scriptText: string; text: string } => {
  const nodes = (document as any).querySelectorAll('script');
  let scriptText = '';
  for (let i = 0; i < (nodes as ArrayLike<any>).length; i += 1) {
    const t = String((nodes as any)[i]?.textContent ?? '');
    if (/latitude|latLong|"lat"/i.test(t)) scriptText += `${t}\n`;
  }
  return {
    url: String((window as any).location?.href ?? ''),
    scriptText: scriptText.slice(0, 200000),
    text: String((document as any).body?.innerText ?? '').slice(0, 4000),
  };
};

const browser = await openDisposableContextHandle(provider) as any;
const page = await browser.newPage();
let done = false;
try {
  await page.setViewport?.({ width: 1440, height: 1200 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 5000));
  const read = await page.evaluate(READ) as { url: string; scriptText: string; text: string };
  console.log(`URL: ${read.url}`);
  console.log(`script blocks carrying coordinate keys: ${read.scriptText.length} chars`);
  const pairs = [...read.scriptText.matchAll(/"lat(?:itude)?"\s*:\s*(-?\d+\.\d+)[\s\S]{0,120}?"l(?:ng|on|ongitude)"\s*:\s*(-?\d+\.\d+)/gi)]
    .map((m) => `${m[1]}, ${m[2]}`);
  console.log(`coordinate pairs found: ${pairs.length}`);
  for (const p of [...new Set(pairs)].slice(0, 10)) console.log(`  ${p}`);
  if (!pairs.length) {
    const any = [...read.scriptText.matchAll(/"lat(?:itude)?"\s*:\s*(-?\d+\.\d+)/gi)].map((m) => m[1]);
    console.log(`bare latitude values: ${[...new Set(any)].slice(0, 10).join(', ') || '(none)'}`);
    console.log(read.scriptText.slice(0, 600));
  }
  done = true;
} finally {
  try { await page.close(); } catch { /* already gone */ }
  if (done) process.exit(0);
}
