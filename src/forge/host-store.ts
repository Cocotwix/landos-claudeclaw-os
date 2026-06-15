// Forge host-adapter persistence — ClaudeClaw/LandOS host layer.
//
// This is NOT Forge Core. Forge Core (engagement.ts, review-packet.ts,
// command-planner.ts) is pure and host-neutral. Persistence is a host concern:
// a future host (a creator OS, agency OS, etc.) would provide its own store
// and reuse the same pure core. This adapter uses the repo's existing storage
// convention (better-sqlite3, idempotent CREATE TABLE IF NOT EXISTS, WAL,
// chmod 0600) in a dedicated store/forge.db so Forge data never mixes with the
// framework DB or the LandOS business DB.
//
// No network, no .env, no secrets. Records are display/audit data only.

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from '../config.js';
import type { RedLaneHit } from './engagement.js';

export const FORGE_STATUSES = [
  'draft',
  'planned',
  'in_progress',
  'needs_review',
  'ready_to_push',
  'pushed',
  'blocked',
] as const;
export type ForgeStatus = (typeof FORGE_STATUSES)[number];

export function isForgeStatus(v: unknown): v is ForgeStatus {
  return typeof v === 'string' && (FORGE_STATUSES as readonly string[]).includes(v);
}

export interface StoredForgeEngagement {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  rawRequest: string;
  host: string;
  verdict: 'SAFE' | 'STOP';
  categories: string[];
  hits: RedLaneHit[];
  notice: string;
  decisionsNeeded: string[];
  markdown: string;
  status: ForgeStatus;
  notes: string;
  source: string;
}

export interface SaveForgeEngagementInput {
  title: string;
  rawRequest: string;
  host: string;
  verdict: 'SAFE' | 'STOP';
  categories: string[];
  hits: RedLaneHit[];
  notice: string;
  decisionsNeeded: string[];
  markdown: string;
  status?: ForgeStatus;
  notes?: string;
  source?: string;
}

let forgeDb: Database.Database | null = null;

function createForgeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS forge_engagement (
      id               TEXT PRIMARY KEY,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL,
      title            TEXT NOT NULL DEFAULT '',
      raw_request      TEXT NOT NULL DEFAULT '',
      host             TEXT NOT NULL DEFAULT '',
      verdict          TEXT NOT NULL DEFAULT 'SAFE',
      categories       TEXT NOT NULL DEFAULT '[]',
      hits             TEXT NOT NULL DEFAULT '[]',
      notice           TEXT NOT NULL DEFAULT '',
      decisions_needed TEXT NOT NULL DEFAULT '[]',
      markdown         TEXT NOT NULL DEFAULT '',
      status           TEXT NOT NULL DEFAULT 'draft',
      notes            TEXT NOT NULL DEFAULT '',
      source           TEXT NOT NULL DEFAULT 'dashboard'
    );
  `);
}

/** Open (or return) the Forge host store. Lazy so processes that never touch
 *  Forge never create the file. */
export function getForgeDb(): Database.Database {
  if (forgeDb) return forgeDb;
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const dbPath = path.join(STORE_DIR, 'forge.db');
  forgeDb = new Database(dbPath);
  forgeDb.pragma('journal_mode = WAL');
  forgeDb.pragma('busy_timeout = 5000');
  createForgeSchema(forgeDb);
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const f = dbPath + suffix;
      if (fs.existsSync(f)) fs.chmodSync(f, 0o600);
    }
  } catch { /* non-fatal on platforms without chmod */ }
  return forgeDb;
}

/** @internal — tests only. Fresh in-memory Forge store. */
export function _initTestForgeDb(): void {
  forgeDb = new Database(':memory:');
  createForgeSchema(forgeDb);
}

function genId(): string {
  // 8 hex chars, dependency-free. Collisions are astronomically unlikely at
  // this volume and the PRIMARY KEY would reject one anyway.
  let s = '';
  for (let i = 0; i < 8; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

interface ForgeRow {
  id: string;
  created_at: number;
  updated_at: number;
  title: string;
  raw_request: string;
  host: string;
  verdict: string;
  categories: string;
  hits: string;
  notice: string;
  decisions_needed: string;
  markdown: string;
  status: string;
  notes: string;
  source: string;
}

function parseArray<T>(json: string): T[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function rowToEngagement(row: ForgeRow): StoredForgeEngagement {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    title: row.title,
    rawRequest: row.raw_request,
    host: row.host,
    verdict: row.verdict === 'STOP' ? 'STOP' : 'SAFE',
    categories: parseArray<string>(row.categories),
    hits: parseArray<RedLaneHit>(row.hits),
    notice: row.notice,
    decisionsNeeded: parseArray<string>(row.decisions_needed),
    markdown: row.markdown,
    status: isForgeStatus(row.status) ? row.status : 'draft',
    notes: row.notes,
    source: row.source,
  };
}

export function saveEngagement(input: SaveForgeEngagementInput): StoredForgeEngagement {
  const db = getForgeDb();
  const now = Math.floor(Date.now() / 1000);
  const id = genId();
  const status: ForgeStatus = input.status && isForgeStatus(input.status) ? input.status : 'draft';
  db.prepare(
    `INSERT INTO forge_engagement
       (id, created_at, updated_at, title, raw_request, host, verdict, categories,
        hits, notice, decisions_needed, markdown, status, notes, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    now,
    now,
    input.title,
    input.rawRequest,
    input.host,
    input.verdict === 'STOP' ? 'STOP' : 'SAFE',
    JSON.stringify(input.categories ?? []),
    JSON.stringify(input.hits ?? []),
    input.notice,
    JSON.stringify(input.decisionsNeeded ?? []),
    input.markdown,
    status,
    input.notes ?? '',
    input.source ?? 'dashboard',
  );
  return getEngagement(id)!;
}

export function listEngagements(opts: { status?: ForgeStatus; limit?: number } = {}): StoredForgeEngagement[] {
  const db = getForgeDb();
  const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
  // Tiebreak on the implicit monotonic rowid, not the random text id, so
  // engagements created in the same second still list in insertion order.
  const rows = (
    opts.status
      ? db
          .prepare(
            'SELECT * FROM forge_engagement WHERE status = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
          )
          .all(opts.status, limit)
      : db
          .prepare('SELECT * FROM forge_engagement ORDER BY created_at DESC, rowid DESC LIMIT ?')
          .all(limit)
  ) as ForgeRow[];
  return rows.map(rowToEngagement);
}

export function getEngagement(id: string): StoredForgeEngagement | undefined {
  const row = getForgeDb().prepare('SELECT * FROM forge_engagement WHERE id = ?').get(id) as
    | ForgeRow
    | undefined;
  return row ? rowToEngagement(row) : undefined;
}

export interface UpdateForgeEngagementPatch {
  status?: ForgeStatus;
  notes?: string;
  title?: string;
}

export function updateEngagement(
  id: string,
  patch: UpdateForgeEngagementPatch,
): StoredForgeEngagement | undefined {
  const existing = getEngagement(id);
  if (!existing) return undefined;
  const db = getForgeDb();
  const now = Math.floor(Date.now() / 1000);
  const status = patch.status && isForgeStatus(patch.status) ? patch.status : existing.status;
  const notes = patch.notes !== undefined ? patch.notes : existing.notes;
  const title = patch.title !== undefined ? patch.title : existing.title;
  db.prepare(
    'UPDATE forge_engagement SET status = ?, notes = ?, title = ?, updated_at = ? WHERE id = ?',
  ).run(status, notes, title, now, id);
  return getEngagement(id);
}
