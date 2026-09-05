#!/usr/bin/env tsx
// Small authenticated POST helper for acceptance runs.
//   npx tsx scripts/qa/landos-post.mts <apiPath> [jsonBody]

import path from 'node:path';
import process from 'node:process';

import { readEnvFile } from '../../src/env.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const apiPath = process.argv[2];
const body = process.argv[3] ?? '{}';
const method = (process.argv[4] ?? 'POST').toUpperCase();
if (!apiPath) { console.error('usage: <apiPath> [jsonBody]'); process.exit(1); }

const previousCwd = process.cwd();
process.chdir(ROOT);
let token = '';
try { token = readEnvFile(['DASHBOARD_TOKEN']).DASHBOARD_TOKEN ?? ''; } finally { process.chdir(previousCwd); }

const url = new URL(apiPath, 'http://localhost:3141');
url.searchParams.set('token', token);
const res = await fetch(url, {
  method,
  headers: { 'content-type': 'application/json' },
  ...(method === 'GET' || method === 'DELETE' ? {} : { body }),
  signal: AbortSignal.timeout(900_000),
});
console.log(`${method} ${apiPath} -> ${res.status}`);
const text = await res.text();
try {
  console.log(JSON.stringify(JSON.parse(text), null, 1).slice(0, 3000));
} catch {
  console.log(text.slice(0, 1500));
}
