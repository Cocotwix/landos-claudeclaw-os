#!/usr/bin/env tsx
// Read-only: print the Deal Brain projection state for one Deal Card.
//   npx tsx scripts/qa/landos-dealbrain-state.mts <dealCardId>

import path from 'node:path';
import process from 'node:process';

import { readEnvFile } from '../../src/env.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const id = Number(process.argv[2] ?? 128);

const previousCwd = process.cwd();
process.chdir(ROOT);
let token = '';
try { token = readEnvFile(['DASHBOARD_TOKEN']).DASHBOARD_TOKEN ?? ''; } finally { process.chdir(previousCwd); }

const res = await fetch(`http://localhost:3141/api/landos/deal-cards/${id}/deal-brain?token=${encodeURIComponent(token)}`);
console.log(`HTTP ${res.status}`);
const body = await res.json() as Record<string, any>;
console.log(`top-level keys: ${Object.keys(body).join(', ')}`);
const dump = JSON.stringify(body, null, 1);
console.log(dump.length > 2600 ? `${dump.slice(0, 2600)}\n... (${dump.length} bytes total)` : dump);
