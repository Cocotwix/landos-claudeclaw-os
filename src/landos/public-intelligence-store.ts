import { getLandosDb } from './db.js';
import { sanitizePublicIntelligenceRun } from './evidence-language.js';
import type { PublicIntelligenceRun } from './public-property-intelligence.js';
import type { OrchestratorRun } from './property-intelligence-orchestrator.js';

export interface StoredPublicIntelligenceRun {
  dealCardId: number;
  parcelKey: string;
  run: PublicIntelligenceRun;
  orchestration: OrchestratorRun | null;
  updatedAt: string;
}

const SENSITIVE_KEY = /password|secret|token|cookie|credential|authorization|verification.?code|recovery.?link/i;
const SENSITIVE_QUERY = /([?&](?:password|secret|token|cookie|credential|authorization|code)=)[^&]*/ig;

function ensureTable(): void {
  getLandosDb().exec(`
    CREATE TABLE IF NOT EXISTS landos_public_intelligence_run (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_card_id INTEGER NOT NULL,
      parcel_key TEXT NOT NULL,
      status TEXT NOT NULL,
      capture_mode TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      orchestration_json TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(deal_card_id, parcel_key)
    );
    CREATE INDEX IF NOT EXISTS idx_landos_public_intelligence_deal
      ON landos_public_intelligence_run(deal_card_id, updated_at DESC);
  `);
  const columns = getLandosDb().prepare('PRAGMA table_info(landos_public_intelligence_run)').all() as Array<{ name?: string }>;
  if (!columns.some((column) => column.name === 'orchestration_json')) {
    getLandosDb().exec('ALTER TABLE landos_public_intelligence_run ADD COLUMN orchestration_json TEXT');
  }
}

function redact(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string') return value.replace(SENSITIVE_QUERY, '$1[redacted]');
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
  }
  return value;
}

function parseRun(value: unknown): PublicIntelligenceRun | null {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value) as PublicIntelligenceRun; } catch { return null; }
}

function parseOrchestration(value: unknown): OrchestratorRun | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return JSON.parse(value) as OrchestratorRun; } catch { return null; }
}

function storedFromRow(row: unknown): StoredPublicIntelligenceRun | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const run = parseRun(record.payload_json);
  if (!run) return null;
  // Read-time sanitation: historically persisted runs predate the shared
  // safe-language rules (frontage → proximity; point-sample slope), so the
  // rules apply on every load, not only on new saves.
  const safeRun = sanitizePublicIntelligenceRun(run);
  const parsedOrchestration = parseOrchestration(record.orchestration_json);
  const orchestration = parsedOrchestration
    ? { ...parsedOrchestration, propertyIntelligence: safeRun }
    : null;
  return {
    dealCardId: Number(record.deal_card_id),
    parcelKey: String(record.parcel_key),
    run: safeRun,
    orchestration,
    updatedAt: String(record.updated_at),
  };
}

export class PublicIntelligenceStore {
  save(dealCardId: number, parcelKey: string, run: PublicIntelligenceRun, orchestration?: OrchestratorRun | null): StoredPublicIntelligenceRun {
    if (!Number.isInteger(dealCardId) || dealCardId < 1) throw new Error('A valid Deal Card is required.');
    const key = parcelKey.trim();
    if (!key) throw new Error('A resolved parcel key is required.');
    ensureTable();
    const safeRun = sanitizePublicIntelligenceRun(redact(run) as PublicIntelligenceRun);
    const safeOrchestration = orchestration == null ? null : redact({ ...orchestration, propertyIntelligence: safeRun }) as OrchestratorRun;
    const now = new Date().toISOString();
    getLandosDb().prepare(`
      INSERT INTO landos_public_intelligence_run
        (deal_card_id, parcel_key, status, capture_mode, started_at, completed_at, payload_json, orchestration_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(deal_card_id, parcel_key) DO UPDATE SET
        status=excluded.status, capture_mode=excluded.capture_mode, started_at=excluded.started_at,
        completed_at=excluded.completed_at, payload_json=excluded.payload_json,
        orchestration_json=COALESCE(excluded.orchestration_json, landos_public_intelligence_run.orchestration_json),
        updated_at=excluded.updated_at
    `).run(dealCardId, key, safeRun.status, safeRun.captureMode, safeRun.startedAt, safeRun.completedAt, JSON.stringify(safeRun), safeOrchestration ? JSON.stringify(safeOrchestration) : null, now);
    return { dealCardId, parcelKey: key, run: safeRun, orchestration: safeOrchestration, updatedAt: now };
  }

  load(dealCardId: number, parcelKey?: string): StoredPublicIntelligenceRun | null {
    ensureTable();
    const row = parcelKey
      ? getLandosDb().prepare('SELECT * FROM landos_public_intelligence_run WHERE deal_card_id=? AND parcel_key=?').get(dealCardId, parcelKey)
      : getLandosDb().prepare('SELECT * FROM landos_public_intelligence_run WHERE deal_card_id=? ORDER BY updated_at DESC, id DESC LIMIT 1').get(dealCardId);
    return storedFromRow(row);
  }

  /** Latest officially resolved parcel run for a Deal Card. A newer provisional
   * retry must never erase the last accepted official identity handoff. */
  loadLatestResolved(dealCardId: number): StoredPublicIntelligenceRun | null {
    ensureTable();
    const row = getLandosDb().prepare(`
      SELECT * FROM landos_public_intelligence_run
      WHERE deal_card_id=? AND parcel_key NOT LIKE 'unresolved:%'
        AND status IN ('complete', 'complete_with_gaps')
      ORDER BY updated_at DESC, id DESC LIMIT 1
    `).get(dealCardId);
    return storedFromRow(row);
  }
}

export function redactPublicIntelligencePersistence(value: unknown): unknown { return redact(value); }
