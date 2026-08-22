#!/usr/bin/env node
// LandOS — production intelligence executor selection (Slice 6).
//
// The Intelligence Stack's reasoning executor is a persisted setting, never a
// source edit:
//
//   node scripts/landos/intelligence-executor.mjs status
//   node scripts/landos/intelligence-executor.mjs use specialists   # persistent Hermes specialist profiles (default)
//   node scripts/landos/intelligence-executor.mjs use analyst       # governed rollback: pre-Slice-6 single-profile analyst
//
// Writes the same `dashboard_settings` KV row the runtime reads
// (`landos.acquisition_intelligence.executor`). Takes effect on the next
// intelligence run — no restart or rebuild required.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const KEY = 'landos.acquisition_intelligence.executor';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dbPath = path.join(repoRoot, 'store', 'claudeclaw.db');

const db = new Database(dbPath);
const read = () => {
  const row = db.prepare('SELECT value FROM dashboard_settings WHERE key = ?').get(KEY);
  const value = (row?.value ?? '').trim().toLowerCase();
  return value === 'analyst' ? 'analyst' : 'specialists';
};

const [command, choice] = process.argv.slice(2);
if (command === 'status' || command === undefined) {
  const effective = read();
  console.log(`intelligence executor: ${effective}${effective === 'specialists' ? ' (persistent Hermes specialist profiles)' : ' (legacy single-profile analyst — rollback path)'}`);
} else if (command === 'use' && (choice === 'specialists' || choice === 'analyst')) {
  db.prepare(
    `INSERT INTO dashboard_settings (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(KEY, choice);
  console.log(`intelligence executor set to: ${choice} (effective on the next intelligence run)`);
} else {
  console.error('usage: intelligence-executor.mjs [status | use specialists | use analyst]');
  process.exitCode = 2;
}
db.close();
