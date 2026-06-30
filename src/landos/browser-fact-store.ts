// LandOS — Incremental browser-fact persistence + operator cancellation.
//
// Browser Intelligence writes each confidently-found public-record fact to the
// Deal Card IMMEDIATELY (not at session end), with full provenance and status.
// The operator can stop a run at any time; everything already found stays saved,
// and any still-requested items are marked "Stopped by Operator" (not Failed/
// Unknown). Verified Realie data is never overwritten by weaker browser text.

import { getLandosDb, landosAudit } from './db.js';
import type { BrowserFact } from './browser-intelligence.js';

export interface StoredBrowserFact extends BrowserFact { id: number; dealCardId: number; createdAt: number }

interface Row {
  id: number; deal_card_id: number; fact_key: string; label: string; value: string; source_name: string;
  source_type: string; source_url: string; origin: string; confidence: string; status: string; extraction_method: string; created_at: number;
}

function toFact(r: Row): StoredBrowserFact {
  return { id: r.id, dealCardId: r.deal_card_id, key: r.fact_key, label: r.label, value: r.value, sourceName: r.source_name, sourceType: r.source_type, sourceUrl: r.source_url, origin: r.origin as BrowserFact['origin'], confidence: r.confidence as BrowserFact['confidence'], status: r.status as BrowserFact['status'], extractionMethod: r.extraction_method, createdAt: r.created_at };
}

/** Write ONE browser fact to a Deal Card incrementally. Idempotent on
 *  (deal, key, source_url). Returns the stored fact. */
export function writeBrowserFact(dealCardId: number, fact: BrowserFact, actor = 'browser-intelligence'): StoredBrowserFact {
  getLandosDb().prepare(
    `INSERT INTO landos_browser_fact (deal_card_id, fact_key, label, value, source_name, source_type, source_url, origin, confidence, status, extraction_method)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(deal_card_id, fact_key, source_url) DO UPDATE SET value=excluded.value, label=excluded.label,
       source_name=excluded.source_name, source_type=excluded.source_type, origin=excluded.origin,
       confidence=excluded.confidence, status=excluded.status, extraction_method=excluded.extraction_method`,
  ).run(dealCardId, fact.key, fact.label, fact.value, fact.sourceName, fact.sourceType, fact.sourceUrl, fact.origin, fact.confidence, fact.status, fact.extractionMethod ?? '');
  const row = getLandosDb().prepare('SELECT * FROM landos_browser_fact WHERE deal_card_id = ? AND fact_key = ? AND source_url = ?').get(dealCardId, fact.key, fact.sourceUrl) as Row;
  return toFact(row);
}

export function listBrowserFacts(dealCardId: number): StoredBrowserFact[] {
  const rows = getLandosDb().prepare('SELECT * FROM landos_browser_fact WHERE deal_card_id = ? ORDER BY created_at ASC, id ASC').all(dealCardId) as Row[];
  return rows.map(toFact);
}

/** Record still-requested items the operator stopped before they were searched. */
export function markStoppedByOperator(dealCardId: number, requestedKeys: string[]): StoredBrowserFact[] {
  const have = new Set(listBrowserFacts(dealCardId).map((f) => f.key));
  const out: StoredBrowserFact[] = [];
  for (const key of requestedKeys) {
    if (have.has(key)) continue;
    out.push(writeBrowserFact(dealCardId, { key, label: key, value: 'Stopped by Operator', sourceName: '', sourceType: '', sourceUrl: `stopped:${key}`, origin: 'search_fallback', confidence: 'low', status: 'needs_verification', extractionMethod: 'stopped_by_operator' }));
  }
  if (out.length) landosAudit('tyler', 'browser_intel_stopped', `deal ${dealCardId}: ${out.length} item(s) Stopped by Operator`, { refTable: 'landos_browser_fact', refId: dealCardId });
  return out;
}

// ── Operator cancellation registry (in-memory; per Deal Card) ────────────────
const cancelled = new Set<number>();
export function requestCancel(dealCardId: number): void { cancelled.add(dealCardId); }
export function isCancelled(dealCardId: number): boolean { return cancelled.has(dealCardId); }
export function clearCancel(dealCardId: number): void { cancelled.delete(dealCardId); }
