// Forge host-adapter persistence — the current host layer.
//
// This is NOT Forge Core. Forge Core (engagement.ts, review-packet.ts,
// command-planner.ts) is pure and host-neutral. Persistence is a host concern:
// a future host would provide its own store and reuse the same pure core. This
// adapter uses the repo's existing storage convention (better-sqlite3,
// idempotent CREATE TABLE IF NOT EXISTS, WAL, chmod 0600) in a dedicated
// store/forge.db so Forge data never mixes with the host's other databases.
//
// No network, no .env, no secrets. Records are display/audit data only.

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from '../config.js';
import type { RedLaneHit } from './engagement.js';
import type { ActivationMode, DepartmentAgentProfile } from './agent-profile.js';

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

export const FORGE_OWNER_DECISIONS = [
  'pending',
  'approved',
  'tweak_requested',
  'rejected',
  'hold',
] as const;
export type ForgeOwnerDecision = (typeof FORGE_OWNER_DECISIONS)[number];

export function isForgeOwnerDecision(v: unknown): v is ForgeOwnerDecision {
  return typeof v === 'string' && (FORGE_OWNER_DECISIONS as readonly string[]).includes(v);
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
  ownerDecision: ForgeOwnerDecision;
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
  ownerDecision?: ForgeOwnerDecision;
  notes?: string;
  source?: string;
}

let forgeDb: Database.Database | null = null;

// Saved department-agent profiles have their own lifecycle, distinct from the
// engagement lifecycle above. These are Forge configuration/build artifacts,
// not live business records.
export const FORGE_PROFILE_STATUSES = [
  'draft',
  'review_ready',
  'approved',
  'needs_revision',
  'held',
  'rejected',
  'promoted',
] as const;
export type ForgeProfileStatus = (typeof FORGE_PROFILE_STATUSES)[number];

export function isForgeProfileStatus(v: unknown): v is ForgeProfileStatus {
  return typeof v === 'string' && (FORGE_PROFILE_STATUSES as readonly string[]).includes(v);
}

/** Current schema marker for a saved profile record. */
export const FORGE_PROFILE_SCHEMA_VERSION = 1;

export interface StoredAgentProfile {
  id: string;
  createdAt: number;
  updatedAt: number;
  displayName: string;
  department: string;
  request: string;
  status: ForgeProfileStatus;
  ownerDecision: ForgeOwnerDecision;
  /** The normalized department-agent profile (parsed JSON). */
  profile: DepartmentAgentProfile;
  /** The owner-reviewable build packet (markdown). */
  buildPacket: string;
  /** The interview questionnaire (markdown), or '' if none was supplied. */
  interview: string;
  /** Plain-language authority summary at save time. */
  authoritySummary: string;
  activationMode: ActivationMode;
  notes: string;
  schemaVersion: number;
  source: string;
}

export interface SaveAgentProfileInput {
  displayName: string;
  department: string;
  request: string;
  profile: DepartmentAgentProfile;
  buildPacket: string;
  interview?: string;
  authoritySummary: string;
  activationMode: ActivationMode;
  status?: ForgeProfileStatus;
  ownerDecision?: ForgeOwnerDecision;
  notes?: string;
  source?: string;
}

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
      owner_decision   TEXT NOT NULL DEFAULT 'pending',
      notes            TEXT NOT NULL DEFAULT '',
      source           TEXT NOT NULL DEFAULT 'dashboard'
    );
  `);
  // Forward-compatible: add owner_decision to a forge.db created before this
  // column existed. CREATE TABLE IF NOT EXISTS never alters an existing table.
  const cols = db.prepare(`PRAGMA table_info(forge_engagement)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'owner_decision')) {
    db.exec(`ALTER TABLE forge_engagement ADD COLUMN owner_decision TEXT NOT NULL DEFAULT 'pending'`);
  }

  // Saved department-agent profiles. Same forge.db, separate table: no second
  // database, and Forge build artifacts stay out of the host's other stores.
  db.exec(`
    CREATE TABLE IF NOT EXISTS forge_agent_profile (
      id                TEXT PRIMARY KEY,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,
      display_name      TEXT NOT NULL DEFAULT '',
      department        TEXT NOT NULL DEFAULT '',
      request           TEXT NOT NULL DEFAULT '',
      status            TEXT NOT NULL DEFAULT 'draft',
      owner_decision    TEXT NOT NULL DEFAULT 'pending',
      profile_json      TEXT NOT NULL DEFAULT '{}',
      build_packet      TEXT NOT NULL DEFAULT '',
      interview         TEXT NOT NULL DEFAULT '',
      authority_summary TEXT NOT NULL DEFAULT '',
      activation_mode   TEXT NOT NULL DEFAULT 'sandbox',
      notes             TEXT NOT NULL DEFAULT '',
      schema_version    INTEGER NOT NULL DEFAULT 1,
      source            TEXT NOT NULL DEFAULT 'dashboard'
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
  owner_decision: string;
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
    ownerDecision: isForgeOwnerDecision(row.owner_decision) ? row.owner_decision : 'pending',
    notes: row.notes,
    source: row.source,
  };
}

export function saveEngagement(input: SaveForgeEngagementInput): StoredForgeEngagement {
  const db = getForgeDb();
  const now = Math.floor(Date.now() / 1000);
  const id = genId();
  const status: ForgeStatus = input.status && isForgeStatus(input.status) ? input.status : 'draft';
  const ownerDecision: ForgeOwnerDecision =
    input.ownerDecision && isForgeOwnerDecision(input.ownerDecision) ? input.ownerDecision : 'pending';
  db.prepare(
    `INSERT INTO forge_engagement
       (id, created_at, updated_at, title, raw_request, host, verdict, categories,
        hits, notice, decisions_needed, markdown, status, owner_decision, notes, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    ownerDecision,
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
  ownerDecision?: ForgeOwnerDecision;
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
  const ownerDecision =
    patch.ownerDecision && isForgeOwnerDecision(patch.ownerDecision)
      ? patch.ownerDecision
      : existing.ownerDecision;
  const notes = patch.notes !== undefined ? patch.notes : existing.notes;
  const title = patch.title !== undefined ? patch.title : existing.title;
  db.prepare(
    'UPDATE forge_engagement SET status = ?, owner_decision = ?, notes = ?, title = ?, updated_at = ? WHERE id = ?',
  ).run(status, ownerDecision, notes, title, now, id);
  return getEngagement(id);
}

// ── Saved department-agent profiles ──────────────────────────────────────

interface ProfileRow {
  id: string;
  created_at: number;
  updated_at: number;
  display_name: string;
  department: string;
  request: string;
  status: string;
  owner_decision: string;
  profile_json: string;
  build_packet: string;
  interview: string;
  authority_summary: string;
  activation_mode: string;
  notes: string;
  schema_version: number;
  source: string;
}

function parseProfileJson(json: string): DepartmentAgentProfile {
  try {
    const v = JSON.parse(json);
    if (v && typeof v === 'object') return v as DepartmentAgentProfile;
  } catch { /* fall through to empty */ }
  // Corrupted/empty row: return a deterministic empty shell so the record is
  // still listable. The generators tolerate empty fields.
  return {} as DepartmentAgentProfile;
}

function isActivationModeValue(v: string): v is ActivationMode {
  return v === 'sandbox' || v === 'assisted_live' || v === 'live';
}

function rowToProfile(row: ProfileRow): StoredAgentProfile {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    displayName: row.display_name,
    department: row.department,
    request: row.request,
    status: isForgeProfileStatus(row.status) ? row.status : 'draft',
    ownerDecision: isForgeOwnerDecision(row.owner_decision) ? row.owner_decision : 'pending',
    profile: parseProfileJson(row.profile_json),
    buildPacket: row.build_packet,
    interview: row.interview,
    authoritySummary: row.authority_summary,
    activationMode: isActivationModeValue(row.activation_mode) ? row.activation_mode : 'sandbox',
    notes: row.notes,
    schemaVersion: row.schema_version,
    source: row.source,
  };
}

export function saveAgentProfile(input: SaveAgentProfileInput): StoredAgentProfile {
  const db = getForgeDb();
  const now = Math.floor(Date.now() / 1000);
  const id = genId();
  const status: ForgeProfileStatus =
    input.status && isForgeProfileStatus(input.status) ? input.status : 'draft';
  const ownerDecision: ForgeOwnerDecision =
    input.ownerDecision && isForgeOwnerDecision(input.ownerDecision) ? input.ownerDecision : 'pending';
  const activationMode: ActivationMode = isActivationModeValue(input.activationMode)
    ? input.activationMode
    : 'sandbox';
  db.prepare(
    `INSERT INTO forge_agent_profile
       (id, created_at, updated_at, display_name, department, request, status,
        owner_decision, profile_json, build_packet, interview, authority_summary,
        activation_mode, notes, schema_version, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    now,
    now,
    input.displayName,
    input.department,
    input.request,
    status,
    ownerDecision,
    JSON.stringify(input.profile ?? {}),
    input.buildPacket,
    input.interview ?? '',
    input.authoritySummary,
    activationMode,
    input.notes ?? '',
    FORGE_PROFILE_SCHEMA_VERSION,
    input.source ?? 'dashboard',
  );
  return getAgentProfile(id)!;
}

export function listAgentProfiles(
  opts: { status?: ForgeProfileStatus; limit?: number } = {},
): StoredAgentProfile[] {
  const db = getForgeDb();
  const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
  const rows = (
    opts.status
      ? db
          .prepare(
            'SELECT * FROM forge_agent_profile WHERE status = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
          )
          .all(opts.status, limit)
      : db
          .prepare('SELECT * FROM forge_agent_profile ORDER BY created_at DESC, rowid DESC LIMIT ?')
          .all(limit)
  ) as ProfileRow[];
  return rows.map(rowToProfile);
}

export function getAgentProfile(id: string): StoredAgentProfile | undefined {
  const row = getForgeDb().prepare('SELECT * FROM forge_agent_profile WHERE id = ?').get(id) as
    | ProfileRow
    | undefined;
  return row ? rowToProfile(row) : undefined;
}

export interface UpdateAgentProfilePatch {
  status?: ForgeProfileStatus;
  ownerDecision?: ForgeOwnerDecision;
  notes?: string;
  displayName?: string;
}

export function updateAgentProfile(
  id: string,
  patch: UpdateAgentProfilePatch,
): StoredAgentProfile | undefined {
  const existing = getAgentProfile(id);
  if (!existing) return undefined;
  const db = getForgeDb();
  const now = Math.floor(Date.now() / 1000);
  const status =
    patch.status && isForgeProfileStatus(patch.status) ? patch.status : existing.status;
  const ownerDecision =
    patch.ownerDecision && isForgeOwnerDecision(patch.ownerDecision)
      ? patch.ownerDecision
      : existing.ownerDecision;
  const notes = patch.notes !== undefined ? patch.notes : existing.notes;
  const displayName = patch.displayName !== undefined ? patch.displayName : existing.displayName;
  db.prepare(
    'UPDATE forge_agent_profile SET status = ?, owner_decision = ?, notes = ?, display_name = ?, updated_at = ? WHERE id = ?',
  ).run(status, ownerDecision, notes, displayName, now, id);
  return getAgentProfile(id);
}
